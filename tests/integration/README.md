# Integration & Load Test Suite

Verification scripts for the 5 infrastructure-dependent ACs from the auth sprint.
All production code is already implemented — these scripts confirm the live system behaves correctly.

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
- Authed `GET /api/v1/collections` at 100 RPS × 30s → **p95 < 40ms**
- Error rate < 1% for both scenarios

**PASS** = k6 exits 0 and prints `✓` next to all threshold lines.
**FAIL** = k6 exits non-zero and prints `✗` with actual p95 value.

> **Note**: Anon `GET /api/v1/cases` is served by the Cloudflare Worker's native Hyperdrive
> path — cold-start latency may inflate p95 on the very first run. Warm up the Worker
> (any request to the domain) ~30s before running k6 for stable numbers.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `psql: error: connection refused` | Wrong `SUPABASE_DB_URL` | Use the **service-role** connection string from Supabase dashboard → Settings → Database |
| `AC5 FAIL` on SELECT | RLS policy missing or `auth_tenant_id()` function not deployed | Run `supabase db push` to apply pending migrations |
| `test_revoke_member` gets 401 on first POST | `JWT_SECRET_CURRENT` mismatch | Confirm the secret matches `wrangler secret list` for the Worker |
| k6 p95 > threshold on first run | Cold-start penalty | Warm up the Worker, then re-run |
| `psycopg2.OperationalError` | DB not reachable from local machine | Check Supabase project network restrictions (IP allow-list) |
