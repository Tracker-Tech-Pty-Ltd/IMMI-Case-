# Multi-Tenant Auth: Worker JWT + Supabase RLS via GUC

**Status**: IMPLEMENTED (2026-05-04) — 7/12 ACs verified; 5 deferred to infra phase
**Mode**: Consensus — DELIBERATE
**Date**: 2026-05-03

## Implementation Status (2026-05-04)

| AC | Description | Status |
|----|-------------|--------|
| 1 | JWT HS256 + kid + key rotation | ✅ `workers/auth/jwt.js` |
| 2 | Telegram HMAC + auth_date >1hr (+ >60s future) → 401 | ✅ `workers/auth/telegram.js` + 19 tests |
| 3 | DO nonce dedup (atomic put) | ✅ `workers/auth/nonce_do.js` |
| 4 | Every auth query wraps sql.begin + SET LOCAL | ✅ `workers/db/getSqlAsUser.js` + `make audit-rls-guards` |
| 5 | Cross-tenant RLS isolation test matrix | ⏳ DEFERRED — requires real DB + test tenants |
| 6 | Anonymous reads (tenant_id IS NULL) succeed without JWT | ✅ `supabase/migrations/20260503_002_rls_policies.sql` |
| 7 | p95 latency: anon <15ms, auth <40ms (k6 100 RPS) | ⏳ DEFERRED — requires k6 infra |
| 8 | Revoked member: write 403 within request boundary | ⏳ DEFERRED — requires real DB (Flask `require_tenant_membership` in place) |
| 9 | Two-thread concurrent test: 0 cross-tenant rows | ⏳ DEFERRED — requires real DB |
| 10 | Canary tenant CI test (0 rows on empty tenant) | ⏳ DEFERRED — requires CI DB fixture |
| 11 | AUTH_ENABLED=false restores anon-only behaviour | ✅ `workers/proxy.js:2729` |
| 12 | Structured logs {kid, tenant_id, user_id, connection_id, query_ms} | ✅ `workers/db/getSqlAsUser.js` |

**All 7 phases implemented** — Phases 1–7 complete. 201/201 worker tests pass.

---

## 1. RALPLAN-DR Summary

### Principles
1. **Zero-trust at the DB**: RLS is the only enforcement boundary; Worker/Flask compromise must not leak cross-tenant data.
2. **Single source of truth for identity**: one JWT, one secret, verified by every consumer (Worker → Flask → Postgres).
3. **Preserve anonymous read perf**: 149K public cases stay on the unauthenticated fast path.
4. **Fail closed, observable**: every auth-bearing query carries `kid`, `tenant_id`, `connection_id` for forensic replay.
5. **Tenancy is opt-in per row**: dual-mode (anonymous + tenant-owned) co-exist via nullable `tenant_id`.

### Decision Drivers (top 3)
- **D1 Cross-tenant isolation correctness** (RLS via GUC must be transaction-scoped)
- **D2 Read latency budget** (anon p95 <15ms, auth p95 <40ms)
- **D3 Operational simplicity** (one secret, no Supabase Auth dependency)

### Options Considered
- **A** *(chosen)* Worker HS256 JWT + RLS via `SET LOCAL request.jwt.claims` inside `sql.begin()` transactions; Durable Object nonce; Flask re-verifies same JWT.
- **B** Supabase Auth (GoTrue) end-to-end. *Invalidated*: Telegram-Login-only flow conflicts with GoTrue's email/OAuth-centric model; would require custom JWT bridge anyway.
- **C** App-layer tenant filter (no RLS). *Invalidated*: violates D1 — single missed `WHERE tenant_id=` causes silent leak.

### Pre-mortem (4 scenarios)
1. **Stolen JWT replay**: mitigated by 5-min access TTL + DO nonce + httpOnly refresh cookie.
2. **Telegram secret leak**: rotate `TELEGRAM_BOT_TOKEN`; HMAC verification fails for old tokens.
3. **DB perf regression** from RLS: monitored via split p95 SLOs; rollback via `AUTH_ENABLED=false`.
4. **GUC cross-tenant leak** (session-scope bug): canary tenant CI test asserts 0 rows; rollback via `AUTH_ENABLED=false` reverts to anon role.

### Test Plan (expanded)
- **Unit**: JWT sign/verify, HMAC Telegram verify, claims parser, kid rotation.
- **Integration**: two-thread concurrent query test asserting zero GUC bleed; RLS policy matrix (owner/member/anon × read/write); refresh-token rotation.
- **E2E**: full Telegram-Widget login → collection create → second tenant cannot read; revoked-member test (kick → 403 within 5min).
- **Observability**: structured logs `{kid, tenant_id, user_id, connection_id, query_ms}` per authenticated query; Grafana dashboard for p50/p95 split by auth mode.

---

## 2. Phased Implementation (7 phases)

### Phase 1 — DB schema + RLS policies
- `supabase/migrations/20260503_001_tenancy.sql`: tables `users`, `tenants`, `tenant_members`, `tenant_invites`; add nullable `tenant_id`, `created_by` to `collections`, `saved_searches`, `llm_council_sessions`.
- `supabase/migrations/20260503_002_rls_policies.sql`: enable RLS on all tenant-aware tables; helper `auth.current_user_id()` and `auth.current_tenant_ids()` reading from `current_setting('request.jwt.claims', true)::jsonb`.
- `supabase/migrations/20260503_003_indexes.sql`: see DDL below.

### Phase 2 — Worker auth module
- `workers/auth/jwt.js`: HS256 sign/verify with `kid`-based key map (`JWT_SECRET_CURRENT` + `JWT_SECRET_PREVIOUS` for rotation).
- `workers/auth/telegram.js`: verify Telegram Login Widget HMAC against `TELEGRAM_BOT_TOKEN`; check `auth_date` within 1hr.
- `workers/auth/nonce_do.js`: `AuthNonce` Durable Object — `Map<hash,timestamp>`; `put(hash,ts)` returns true only if absent; sweep entries >1hr.
- `workers/auth/handlers.js`: `POST /api/v1/auth/telegram` (login), `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`.

### Phase 3 — Worker DB layer (`sql.begin` everywhere)
- `workers/db/getSqlAsUser.js`: returns `{ tx: (fn) => sql.begin(async tx => { await tx\`SELECT set_config('request.jwt.claims', ${claimsJson}, true)\`; return fn(tx); }) }`.
- Refactor every authenticated handler to: `const rows = await db.tx(tx => tx\`SELECT ...\`)`.
- Anonymous handlers continue using `getSql(env)` (no transaction overhead).

### Phase 4 — Flask JWT verification
- `immi_case_downloader/web/auth.py`: `verify_jwt(token)` using `JWT_SECRET_CURRENT` (same secret); decorator `@require_auth`.
- Worker forwards `Authorization: Bearer <jwt>` to Flask container; Flask verifies signature + sets `flask.g.claims`.
- All write endpoints check `tenant_members` in DB on every request (instant revocation).

### Phase 5 — Frontend
- `frontend/src/lib/auth.ts`: Telegram Widget integration; `useAuth()` hook; access token in memory, refresh via httpOnly cookie.
- `frontend/src/components/TenantSwitcher.tsx`: switches active `tenant_id` claim (triggers refresh).
- Update `lib/api.ts` to attach `Authorization` header when access token present.

### Phase 6 — Anonymous data migration
- `scripts/migrate_anon_data.py`: existing collections/searches stay `tenant_id IS NULL`; RLS policy permits public read for nulls.

### Phase 7 — Observability + rollback
- Worker: structured log per query with `kid`, `tenant_id`, `connection_id`, `query_ms`.
- Env flag `AUTH_ENABLED=false` → Worker skips JWT injection, all reads go via anon role.
- Grafana dashboard split by auth mode.

---

## 3. SQL DDL (key indexes)

```sql
-- users
CREATE TABLE users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id  bigint NOT NULL,
  username     text,
  created_at   timestamptz DEFAULT now(),
  deleted_at   timestamptz
);
CREATE UNIQUE INDEX users_telegram_id_uniq ON users(telegram_id) WHERE deleted_at IS NULL;

-- tenants + membership
CREATE TABLE tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE tenant_members (
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id   uuid REFERENCES users(id)   ON DELETE CASCADE,
  role      text NOT NULL CHECK (role IN ('owner','member')),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX tenant_members_user_idx ON tenant_members(user_id, tenant_id);  -- reverse lookup

-- invites
CREATE TABLE tenant_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX tenant_invites_cleanup_idx ON tenant_invites(tenant_id, expires_at);

-- tenant-aware columns on existing tables
ALTER TABLE collections        ADD COLUMN tenant_id uuid REFERENCES tenants(id), ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE saved_searches     ADD COLUMN tenant_id uuid REFERENCES tenants(id), ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE llm_council_sessions ADD COLUMN tenant_id uuid REFERENCES tenants(id), ADD COLUMN created_by uuid REFERENCES users(id);
CREATE INDEX collections_tenant_idx        ON collections(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX saved_searches_tenant_idx     ON saved_searches(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX llm_council_sessions_tenant_idx ON llm_council_sessions(tenant_id) WHERE tenant_id IS NOT NULL;
```

---

## 4. Auth Flow (text diagram)

```
Browser                Worker                    AuthNonce DO       Postgres (Hyperdrive)
   |                      |                            |                     |
   | Telegram Widget hash |                            |                     |
   |--------------------->| verify HMAC(TG_TOKEN)      |                     |
   |                      | hash(payload) ------------>| put(hash, now)      |
   |                      |                  <---------| {fresh:true}        |
   |                      | UPSERT users (by tg_id) ----------------------->|
   |                      | sign JWT(kid, sub=user_id, tenants=[...], exp=5m)
   |                      | set httpOnly refresh cookie (7d)                |
   |  access JWT (mem) <--|                                                 |
   |                      |                                                 |
   | GET /collections     |                                                 |
   |  Authorization: JWT  |                                                 |
   |--------------------->| verify(JWT, kid map)                            |
   |                      | sql.begin(tx => {                               |
   |                      |   SET LOCAL request.jwt.claims = ${claims} ----->| RLS reads claims
   |                      |   SELECT * FROM collections                    -->| filtered by policy
   |                      | })  -- COMMIT releases GUC + connection         |
   |  rows  <-------------|                                                 |
```

Public-anon reads (`/api/v1/cases`, `/api/v1/stats`) skip `sql.begin` entirely → no perf regression.

---

## 5. Acceptance Criteria (≥10, all testable)

1. JWT signed HS256 with `kid`; both current+previous keys verify; rotation drops previous after 7d.
2. Telegram HMAC verified; `auth_date` >1hr → 401.
3. Durable Object rejects duplicate nonce (atomic `put` returns false → 401).
4. Every authenticated query wraps `sql.begin(tx => tx\`SET LOCAL request.jwt.claims = ...\`; ...)` — verified by ESLint custom rule + grep CI check.
5. Cross-tenant isolation: tenant A cannot SELECT/UPDATE/DELETE tenant B rows (RLS test matrix).
6. Anonymous reads of public collections (`tenant_id IS NULL`) succeed without JWT.
7. **p95 latency split**: anon `/api/v1/cases` <15ms; authenticated `/api/v1/collections` <40ms (k6 load test, 100 RPS).
8. Revoked member: removal from `tenant_members` → next write returns 403 within request boundary; reads expire within 5min (access TTL).
9. Two-thread concurrent test: 1000 interleaved queries from tenant A and B over pooled connections show 0 cross-tenant rows.
10. Canary tenant CI test (tenant C, no rows) returns 0 results on every authenticated endpoint.
11. `AUTH_ENABLED=false` rollback restores anon-only behaviour; public endpoints still serve 149K cases.
12. Structured logs include `{kid, tenant_id, user_id, connection_id, query_ms}` for every authenticated query.

---

## 6. Environment Variables

**Added**
- `JWT_SECRET_CURRENT`, `JWT_SECRET_PREVIOUS` (HS256, ≥32 bytes; same value used by Worker AND Flask)
- `JWT_KID_CURRENT`, `JWT_KID_PREVIOUS`
- `TELEGRAM_BOT_TOKEN` (already present for bot; reused for HMAC verification)
- `AUTH_ENABLED` (default `true`; `false` = kill switch)

**Wrangler bindings** (`wrangler.toml`)
- `[[durable_objects.bindings]] name="AUTH_NONCE_DO" class_name="AuthNonce"`
- `[[migrations]] tag="v1" new_classes=["AuthNonce"]`

**Removed (per Critic Fix #2)**
- ~~`WORKER_FLASK_HMAC_SECRET`~~ (Flask re-verifies the same JWT directly).

---

## 6b. Architect Round-2 Fixes (incorporated)

### Fix A — Worker→Flask uses service binding (not public hostname)
Flask Container is reached exclusively via `env.FLASK.fetch()` (Cloudflare service binding — private, no public ingress). Flask must reject any request where `CF-Connecting-IP` is present from an external source. As defense-in-depth (not replacing JWT verification), Flask also checks `X-Internal-Route: worker` header set by the Worker on every proxied request.

### Fix B — AuthNonce DO pinned to Oceania
```js
// workers/auth/nonce_do.js
const doId = env.AUTH_NONCE_DO.idFromName("auth-nonce-singleton");
// Pin to Oceania so au-east users get ~30ms DO roundtrip, not ~180ms
const stub = env.AUTH_NONCE_DO.get(doId, { locationHint: "oc" });
```
This keeps DO roundtrip within the 40ms auth p95 budget. Document in `wrangler.toml` comment.

### Fix C — Code comment guard on set_config
```js
// workers/db/getSqlAsUser.js
// CRITICAL: third argument MUST be `true` (transaction-local / SET LOCAL equivalent).
// `false` = session-local — leaks JWT claims across pooled Hyperdrive connections.
await tx`SELECT set_config('request.jwt.claims', ${claimsJson}, true)`;
```
ESLint custom rule will also grep for `set_config` calls with literal `false` in third position.

---

## 7. ADR

- **Decision**: Worker-issued HS256 JWT + Postgres RLS via `SET LOCAL request.jwt.claims` inside `sql.begin()`; Durable Object nonce; Flask re-verifies same JWT.
- **Drivers**: cross-tenant isolation correctness; preserve anon-read p95; one-secret simplicity.
- **Alternatives considered**: Supabase Auth (incompatible with Telegram-Login-only); app-layer filter (violates zero-trust).
- **Why chosen**: GUC inside transaction provides connection-pool-safe isolation; HS256+kid rotation avoids JWKS infra; DO nonce gives strong consistency that KV cannot.
- **Consequences**: +25ms p95 on auth endpoints (Hyperdrive RTT for `SET LOCAL`); operational discipline required (every authenticated handler must use `sql.begin`); 5-min revocation lag for reads.
- **Follow-ups**: ESLint rule enforcing `sql.begin` for authenticated handlers; quarterly key rotation runbook; observability dashboard.

---

## Open Questions
- [ ] Tenant deletion cascade vs. soft-delete policy — defer to product decision before Phase 6.
- [ ] Should refresh-token rotation be sliding (refresh-on-use) or fixed 7-day window?

(Append to `.omc/plans/open-questions.md` per Planner protocol.)
