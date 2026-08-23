# Architecture (Production)

**Last verified**: 2026-08-23
**Source of truth for**: how a request actually flows through IMMI-Case
in production.

> If a description in `README.md`, `CLAUDE.md`, or any other doc
> conflicts with this file, **this file wins** for production behaviour.
> Production has run on `workers/cloudflare-native.js` (Cloudflare D1 +
> R2 + Vectorize + Queues + Durable Objects) since ~2026-08-11. The
> legacy Flask-Container / Hyperdrive / Supabase Postgres stack this
> file used to describe was deleted from the Worker path in commit
> `f91f45f` and is gone from production. For the current machine-checked
> spec of what a deployable config must look like, see
> `scripts/check_cloudflare_native_target.py` and
> `scripts/check_immi_activation_evidence.py` — trust those over any
> prose, including this file, when they disagree.

---

## TL;DR

```
                                    ┌───────────────────────────────────┐
                                    │  Cloudflare Worker                │
   Browser / API client ───HTTP───►│  workers/cloudflare-native.js     │
                                    │  "immi-case-standalone"           │
                                    └──┬────────┬────────┬────────┬─────┘
                                       │        │        │        │
                                       ▼        ▼        ▼        ▼
                              ┌──────────┐ ┌────────┐ ┌────────┐ ┌───────────────┐
                              │ D1 (×3)  │ │   R2   │ │Vectorize│ │ Durable Objects│
                              │ catalog/ │ │ immi-  │ │ case-   │ │ AuthNonce,     │
                              │ account/ │ │content │ │ vectors │ │ CouncilSessionDO│
                              │ ops      │ │        │ │         │ │                │
                              └──────────┘ └────────┘ └────────┘ └───────────────┘
```

- **No Postgres, no Hyperdrive, no Flask container anywhere in this
  stack.** `workers/cloudflare-native.js`'s own header comment states it
  "intentionally does not import the legacy proxy, Flask container, or
  postgres.js."
- **Reads**: Worker → D1 (`IMMI_CATALOG_DB`) directly, with FTS5 for
  lexical search and Vectorize (`CASE_VECTORS`) + Workers AI
  (`@cf/qwen/qwen3-embedding-0.6b`, 1024-dim) for semantic/related-case
  search.
- **Writes** (`POST/PUT/DELETE /api/v1/cases*`): handled **in the Worker
  itself** by `dispatchCloudflareCaseMutation`, gated by
  `IMMI_CASE_MUTATIONS_ENABLED` (fail-closed default `"false"`). Queued
  through `CASE_MUTATION_QUEUE` with a dead-letter queue
  (`immi-case-mutation-dlq`).
- **Case ingestion**: an external VPS AustLII crawler POSTs cases
  directly to the Worker, authenticating with a `CRAWLER_WRITE_TOKEN`
  shared secret instead of a user JWT (commit `abe5b02`). The
  `workers/austlii-scraper/` Worker itself is cron-triggered only
  (commit `d0972db`) — its HTTP trigger endpoints were removed.
- **LLM Council**: `CouncilSessionDO` (Durable Object) + D1 FTS5 lexical
  retrieval. An earlier Vectorize-based retrieval design was shipped
  and then deliberately replaced by lexical retrieval (commit
  `93cace7`) — Vectorize is still used elsewhere (case semantic search),
  just not for Council grounding.
- **Auth**: Telegram Login + HS256 JWT (unchanged design) backed by D1
  (`IMMI_ACCOUNT_DB`) instead of Supabase. Tenant isolation is
  **app-layer** (`CloudflareIdentityStore.assertMembership()`), not
  Postgres RLS.
- **SPA serving**: Workers Static Assets (`[assets]` binding `ASSETS`,
  `not_found_handling = "single-page-application"`) — the Worker serves
  `/` and `/app/*` directly. There is no Flask fallback.
- **Flask app** (`immi_case_downloader/`, `web.py`, `make api`) is
  **local-dev only**. It is not deployed, not proxied to, and not part
  of the production request path in any way.

---

## Layer 1 — Cloudflare Worker (`workers/cloudflare-native.js`)

### Dispatch order

`fetch()` tries each concern in a fixed sequence and falls through to
the next on a `null` return; unmatched `/api/*` paths get a `503`, and
anything else falls to static-asset serving:

```
GET /health                              → static ok/worker-identity JSON
GET /api/v1/csrf-token                   → getCsrfToken(env)
dispatchAuth()                           → auth/cloudflare_handlers.js (D1 IMMI_ACCOUNT_DB)
                                            telegram / bootstrap / callback / me / logout /
                                            refresh / switch-tenant; returns null (route
                                            unhandled → eventual 503) if AUTH_ENABLED=false
dispatchCloudflareCaseAction()           → case-api/cloudflare_actions.js
dispatchCloudflarePipelineControl()      → pipeline/control_handlers.js (PIPELINE_CONTROL_QUEUE)
dispatchCloudflareCaseMutation()         → case-api/cloudflare_mutations.js
                                            POST/PUT/DELETE /api/v1/cases* — gated by
                                            IMMI_CASE_MUTATIONS_ENABLED; CRAWLER_WRITE_TOKEN
                                            bypass in requireWriter() for the VPS crawler
GET /api/v1/admin/pipeline-runs          → admin/cloudflare_handlers.js (D1 IMMI_OPS_DB)
GET /api/v1/job-status, /pipeline-status → pipeline/cloudflare_handlers.js
dispatchCloudflareCouncil()              → llm-council/cloudflare_handlers.js (CouncilSessionDO)
(GET only) dispatchCloudflareCaseRead()  → case-api/cloudflare.js
                                            cases, stats, analytics, judge profiles,
                                            legislations, semantic/related search
/api/* still unmatched                   → 503 cloudflare_route_unavailable
everything else                          → env.ASSETS.fetch(request) (SPA) or 503
```

### Storage bindings (`wrangler.toml`)

| Binding | Kind | Purpose |
|---|---|---|
| `IMMI_CATALOG_DB` | D1 | Cases, chunks, FTS5 index, aggregates (149,016 cases) |
| `IMMI_ACCOUNT_DB` | D1 | Users, tenants, memberships, refresh sessions |
| `IMMI_OPS_DB` | D1 | Pipeline runs, extraction audit, import reconciliation |
| `IMMI_CONTENT` | R2 | Full case text objects (content-addressed, SHA-256 verified) |
| `CASE_VECTORS` | Vectorize | Case embeddings for semantic/related-case search |
| `PIPELINE_KV` | KV | Pipeline coordination state |
| `AI` | Workers AI | `@cf/qwen/qwen3-embedding-0.6b` embeddings (1024-dim) |
| `CASE_MUTATION_QUEUE` / DLQ | Queues | Async case reindex + aggregate rebuild after writes |
| `PIPELINE_CONTROL_QUEUE` | Queues | Pipeline start/stop control messages |
| `AUTH_NONCE` (class `AuthNonce`) | Durable Object | Telegram login replay protection, Oceania-pinned |
| `COUNCIL_SESSION` (class `CouncilSessionDO`) | Durable Object | LLM Council multi-turn session state |
| `ASSETS` | Workers Static Assets | React SPA (`frontend/dist`), SPA fallback routing |

Resource IDs in the checked-in `wrangler.toml` are **deliberately
placeholder UUIDs** (`00000000-0000-0000-0000-00000000000N`) — real IDs
are supplied only inside the gated `workflow_dispatch` of
`deploy-worker.yml`, never committed. `scripts/check_cloudflare_native_target.py`
enforces this shape as a read-only, fail-closed gate.

### Fail-closed feature gates

| Var | Checked-in default | Effect when false/unset |
|---|---|---|
| `IMMI_CASE_MUTATIONS_ENABLED` | `"false"` | All case writes rejected before touching D1 |
| `CUTOVER_WRITE_FREEZE` | `"false"` | (reserved) freezes writes during a cutover window |
| `AUTH_ENABLED` | `"true"` | `"false"` disables all `/api/v1/auth/*` routes |

`scripts/check_immi_activation_evidence.py` additionally verifies the
embedding model/dimensions, D1 size caps (catalog DB must stay under
8 GiB), and required D1 bindings before an activation is considered
evidenced.

### Critical conventions

- **D1, not a Postgres client** — there is no per-request connection
  object to construct and no connection-pooler concept in this stack.
  `env.IMMI_CATALOG_DB.prepare(...).bind(...).run()` / `.first()` /
  `.all()` is the whole interface.
- **Mutations are queued, not synchronous end-to-end** — a successful
  write enqueues a `case.reindex` (or similar) message on
  `CASE_MUTATION_QUEUE`; `handleCaseMutationQueue` in
  `cloudflare-native.js` consumes it to update the Vectorize index and
  aggregates. Poison messages land on `immi-case-mutation-dlq`.
- **Tag filtering and other Flask-era "fall through" comments in older
  docs no longer apply** — there is nothing left to fall through to.
  An unhandled `/api/*` route is a genuine `503`.

---

## Layer 2 — LLM Council (`workers/llm-council/`)

- Entry: `dispatchCloudflareCouncil()` → `cloudflare_handlers.js`.
- Session state: `CouncilSessionDO` (Durable Object), not Postgres.
- Retrieval (`retrieval.js`): **D1 FTS5 lexical retrieval** against
  `IMMI_CATALOG_DB`. An earlier design (commit `763ec5f`) grounded the
  Council in Vectorize semantic retrieval; that was deliberately
  replaced by lexical retrieval in commit `93cace7` (see that commit's
  message for the rationale) and further hardened for pagination and
  non-blocking streaming in `167a84b`. Vectorize (`CASE_VECTORS`) is
  still live in the stack — it backs case semantic/related-case search
  in `case-api/cloudflare.js` — it is simply not what Council grounding
  reads from.
- Runs entirely inside the Worker; there is no container hop, no
  Flask, no `flask-v*` Durable Object naming scheme.

---

## Layer 3 — Auth & Tenancy (`workers/auth/`, `workers/storage/cloudflare.js`)

- **JWT**: HS256, `kid` rotation, 5-minute access token, 7-day httpOnly
  refresh cookie — design unchanged from the original 2026-05 auth
  build (`workers/auth/jwt.js`).
- **Telegram login**: HMAC-SHA256 verification (`telegram.js`) +
  `AuthNonce` Durable Object replay protection, pinned to Oceania
  (`{ locationHint: "oc" }`) — unchanged.
- **Identity storage**: `CloudflareIdentityStore` in
  `workers/storage/cloudflare.js`, backed by D1 `IMMI_ACCOUNT_DB`
  (`users`, `memberships`, `immi_refresh_sessions` tables — see
  `migrations/d1/account/0001_account.sql`).
- **Tenant isolation is app-layer, not RLS**: `assertMembership(auth)`
  runs a D1 `SELECT role FROM memberships WHERE tenant_id = ? AND
  user_id = ? AND revoked_at IS NULL` and throws a 403
  (`tenant_membership_denied`) on a miss. This is the design the
  original 2026-05 auth plan explicitly considered and rejected
  ("Option C — App-layer tenant filter (no RLS)... violates D1 — single
  missed WHERE tenant_id= causes silent leak") — it is nonetheless what
  shipped once the stack moved off Postgres, because D1 has no RLS
  equivalent. There is no database-level backstop; every route that
  touches tenant-scoped data must call `assertMembership()` itself.
- **What's gone**: `workers/db/getSqlAsUser.js` (the
  `sql.begin() + SET LOCAL request.jwt.claims` transaction wrapper) was
  deleted in `f91f45f` along with `proxy.js`. There is no GUC-based RLS
  anywhere in production.

---

## Layer 4 — Case ingestion & the pipeline Worker

- `workers/austlii-scraper/` is a **separate** Cloudflare Worker,
  **cron-triggered only** since commit `d0972db` — its `fetch()` now
  serves only `/health` and 404s everything else; the `/enqueue`,
  `/scrape`, `/progress`, `/list`, `/batch-get`, and
  `/admin/discovery-diff` HTTP endpoints (and the `AUTH_TOKEN` secret
  they required) were removed.
- **Production case writes** come from an **external VPS crawler**
  POSTing directly to the main Worker's `/api/v1/cases` mutation
  endpoint, authenticated with a `CRAWLER_WRITE_TOKEN` shared secret
  compared in constant time (`requireWriter()` in
  `workers/case-api/cloudflare_mutations.js`, commit `abe5b02`) — this
  bypasses the normal JWT/CSRF/membership flow by design, since the
  crawler is a headless cron job, not a logged-in user.
- The case-mutation JSON body ceiling is **1 MiB** (raised from 128 KiB
  in commit `5e1d560` — some full-text judgements, e.g. AATA 2, exceed
  170 KiB).
- **Supabase-related scripts and migrations in this repo are one-time
  ETL/migration tooling**, not a live dependency — they were used to
  populate the original D1/R2/Vectorize import and are not invoked by
  the production Worker.
- **Emergency rollback**: `workers/austlii-scraper/scripts/rollback_run.ts`
  still targets legacy Supabase (`HYPERDRIVE_SERVICE_URL` /
  `DATABASE_URL` / `SUPABASE_DB_URL`) — this is intentional, a
  break-glass script kept for the retired stack, not a sign that
  Supabase is still live.

---

## Where the older Flask/Hyperdrive references in other docs come from

| Doc | Said | Reality since ~2026-08-11 |
|---|---|---|
| `README.md` (older revisions) | "Cloudflare Worker (Hyperdrive 直連 Supabase)" | `workers/cloudflare-native.js` on D1/R2/Vectorize; no Hyperdrive/Supabase in the path |
| `CLAUDE.md` (older revisions) | `workers/proxy.js`, `flask-v15`, `getSqlAsUser()` + RLS | `workers/cloudflare-native.js`; app-layer `assertMembership()`; `proxy.js` + `getSqlAsUser.js` deleted in `f91f45f` |
| `.omc/plans/hyperdrive-full-migration.md` | Plan to migrate Flask endpoints to Workers via Hyperdrive | Superseded — the destination (Worker-native, Flask retired) was reached via a D1-native rewrite, not the Hyperdrive-incremental path this plan describes |
| `.omc/plans/llm-council-worker-migration.md` | Plan: Worker-native Council with Postgres/Hyperdrive session storage | Partially shipped — Worker-native Council shipped as `CouncilSessionDO`, but session storage is D1/DO-based, not Postgres |
| `.omc/plans/auth-multitenant-jwt-rls.md` | "IMPLEMENTED" Postgres RLS via GUC | Superseded at the DB layer — RLS/Postgres replaced by D1 + app-layer `assertMembership()`; JWT/Telegram/nonce-DO design survived |

---

## Verification commands

Re-run these to confirm the document hasn't drifted:

```bash
# Production Worker entrypoint and its explicit "no legacy" header
sed -n '1,10p' workers/cloudflare-native.js

# Legacy proxy/Hyperdrive/Flask code is gone
git show --stat f91f45f | head -5
test -f workers/proxy.js && echo "STILL PRESENT (bug)" || echo "confirmed deleted"
test -f workers/db/getSqlAsUser.js && echo "STILL PRESENT (bug)" || echo "confirmed deleted"

# Wrangler bindings actually present
grep -E "d1_databases|r2_buckets|vectorize|durable_objects|queues\." wrangler.toml

# Fail-closed gates
grep -E "IMMI_CASE_MUTATIONS_ENABLED|AUTH_ENABLED|CUTOVER_WRITE_FREEZE" wrangler.toml

# Machine-checked config spec still present and runnable
python3 scripts/check_cloudflare_native_target.py --help
python3 scripts/check_immi_activation_evidence.py --help
```

If `workers/proxy.js` or `workers/db/getSqlAsUser.js` reappear, or a
new GET handler is added outside `workers/case-api/cloudflare.js`,
architecture is regressing from this document — open an RFC.
