# Integration & Load Test Suite

> **READ THIS FIRST — two of these three scripts verify a retired stack.**
> `rls_isolation.sql` and `test_revoke_member.py` were written for the
> Supabase Postgres + row-level-security stack that was removed from
> production in commit `f91f45f` (2026-08-21). **Production has no Postgres
> and no RLS.** Tenant isolation is enforced in application code by
> `CloudflareIdentityStore.assertMembership()` in
> `workers/storage/cloudflare.js`, against D1 `IMMI_ACCOUNT_DB` — see
> `docs/ARCHITECTURE.md` "Layer 3 — Auth & Tenancy" and
> `docs/adr/0002-app-layer-tenant-isolation.md`.
>
> Consequences:
> - A green `rls_isolation.sql` run says **nothing** about production tenant
>   isolation. It exercises a database that is no longer in the request path.
> - Coverage of the real mechanism is **partial, not absent**.
>   `workers/__tests__/cloudflare-storage-contracts.test.js:127-134` asserts the
>   SQL text and bound parameters of `assertMembership()` against a SQL-blind
>   fake, and `plans/038` adds behavioural store-level tests (absent / revoked /
>   wrong-tenant deny against the real `migrations/d1/account` schema) plus a
>   route-level deny matrix for `GET /api/v1/admin/pipeline-runs`. What is still
>   missing is a **full route security matrix**: seven other entrypoints call
>   `assertMembership()` (`workers/case-api/cloudflare_mutations.js:70`,
>   `workers/case-api/cloudflare_actions.js:47`,
>   `workers/pipeline/control_handlers.js:51`,
>   `workers/llm-council/cloudflare_handlers.js:79` and five call sites in
>   `workers/llm-council/storage.js`), and none of them is proven to reach it.
>   That gap is tracked as an operator-blocked item ("租戶隔離測試矩陣") in
>   `.claude/STATE.md`.
> - Both Supabase-backed scripts hard-skip when `SUPABASE_DB_URL` is unset
>   (`test_revoke_member.py:33-36`), so they are inert unless an operator
>   deliberately points them at a still-live Supabase project.
> - `../k6/auth-latency.js` (AC7) is the only script here that still targets
>   production — it hits the Cloudflare-native Worker over HTTP and needs no
>   database access.

Verification scripts for the 5 infrastructure-dependent ACs from the 2026-05
auth sprint, retained as a historical record of that sprint's acceptance
criteria.

## Tests at a glance

| File | ACs | Runner | Infra needed |
|---|---|---|---|
| `rls_isolation.sql` | AC5, AC9, AC10 | psql | Supabase service-role connection |
| `test_revoke_member.py` | AC8 | pytest | Supabase + running Flask/Worker |
| `../k6/auth-latency.js` | AC7 | k6 | Running production Worker |

---

## Prerequisites

### Common

```bash
# Supabase service-role DB URL (bypasses RLS for setup/teardown)
export SUPABASE_DB_URL="postgresql://postgres:<service_role_key>@<project>.supabase.co:5432/postgres"
```

### For `test_revoke_member.py`

```bash
pip install psycopg2-binary PyJWT requests pytest

# Same secrets as Cloudflare Worker:
export JWT_SECRET_CURRENT="<wrangler secret JWT_SECRET_CURRENT>"
export JWT_KID_CURRENT="k1"                          # default kid
export FLASK_BASE_URL="https://immi.trackit.today"   # or http://localhost:8080
```

### For `auth-latency.js`

```bash
brew install k6   # macOS; or https://k6.io/docs/get-started/installation/

# A valid access JWT (from /api/v1/auth/telegram or a test account):
export AUTH_TOKEN="<access_jwt>"
```

---

## Running the tests

### AC5 + AC9 + AC10 — RLS cross-tenant isolation

```bash
psql "$SUPABASE_DB_URL" -f tests/integration/rls_isolation.sql
```

**Expected output:**
```
NOTICE:  AC5 PASS: Cross-tenant SELECT isolation verified
NOTICE:  AC9 PASS: Cross-tenant UPDATE isolation verified
NOTICE:  AC10 PASS: Canary tenant returns 0 rows verified
NOTICE:  AC5b PASS: Tenant A self-read verified
NOTICE:  ============================================
NOTICE:  All AC5/AC9/AC10 tests passed
NOTICE:  ============================================
ROLLBACK
```

**PASS** = script exits 0 and prints all four `PASS` notices.
**FAIL** = script aborts mid-run with an `ASSERT` error showing which AC failed.
All test data is cleaned up via `ROLLBACK` — no manual teardown needed.

---

### AC8 — Revoked member gets 403

```bash
pytest tests/integration/test_revoke_member.py -v
```

**Expected output:**
```
tests/integration/test_revoke_member.py::test_revoked_member_returns_403 PASSED
```

**PASS** = First POST returns 201, second POST (after DELETE from `tenant_members`) returns 403.
**FAIL** = Either assertion fails with a descriptive message showing the actual status code.
Cleanup runs in `finally` regardless of pass/fail — no orphan rows left.

---

### AC7 — p95 latency SLO

```bash
k6 run tests/k6/auth-latency.js \
  -e BASE_URL=https://immi.trackit.today \
  -e AUTH_TOKEN="$AUTH_TOKEN"
```

**SLO thresholds:**
- Anon `GET /api/v1/cases?limit=20` at 100 RPS × 30s → **p95 < 15ms**
- Authed `GET /api/v1/auth/me` at 100 RPS × 30s → **p95 < 1000ms**
- Error rate < 1% for both scenarios

**PASS** = k6 exits 0 and prints `✓` next to all threshold lines.
**FAIL** = k6 exits non-zero and prints `✗` with actual p95 value.

> **Note**: These scenarios target the Cloudflare-native Worker. Warm the Worker
> before running k6; cold-start latency may inflate the first sample window.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `psql: error: connection refused` | Wrong `SUPABASE_DB_URL` | Use the **service-role** connection string from Supabase dashboard → Settings → Database |
| `AC5 FAIL` on SELECT | RLS policy missing or `auth_tenant_id()` function not deployed | Historical answer: `supabase db push`. **This applies only to the retired Supabase project — it does not touch production D1.** For D1 schema changes see `docs/ops/d1-migrations.md`. |
| `test_revoke_member` gets 401 on first POST | `JWT_SECRET_CURRENT` mismatch | Confirm the secret matches `wrangler secret list` for the Worker |
| k6 p95 > threshold on first run | Cold-start penalty | Warm up the Worker, then re-run |
| `psycopg2.OperationalError` | DB not reachable from local machine | Check Supabase project network restrictions (IP allow-list) |
