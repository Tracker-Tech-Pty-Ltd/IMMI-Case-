# E2E Tests

## Credentialed Auth Smoke

`test_credentialed_auth_smoke.py` is an opt-in smoke test for the real Worker auth surface. It signs a synthetic Telegram Login Widget payload, then verifies:

- `POST /api/v1/auth/telegram`
- `POST /api/v1/auth/refresh`
- old refresh-token replay is rejected after rotation
- `POST /api/v1/auth/switch-tenant`
- credentialed `POST /api/v1/cases` with CSRF
- `POST /api/v1/llm-council/sessions`
- `GET /api/v1/llm-council/sessions`
- `POST /api/v1/llm-council/sessions/restore`
- `DELETE /api/v1/llm-council/sessions/:id`
- `POST /api/v1/auth/logout` revokes the current refresh token

The test is skipped unless explicitly enabled. It creates real rows and attempts to clean up the generated user, test tenant, smoke case, and council session in `finally`.

> **⚠ THE TEARDOWN DELETES FROM THE WRONG DATABASE AND REPORTS SUCCESS. Do not
> run this against production.** The cleanup path connects via
> `SUPABASE_DB_URL`, but production auth, tenant and case rows live in
> Cloudflare D1 (`IMMI_ACCOUNT_DB`, `IMMI_CATALOG_DB`) since commit `f91f45f`
> (2026-08-21) — there is no Postgres in the production path
> (`docs/ARCHITECTURE.md`). Pointing `IMMI_AUTH_SMOKE_BASE_URL` at
> `https://immi.trackit.today` therefore creates real users, tenants, cases and
> council sessions in production D1, while the `finally` block deletes from a
> retired Supabase project and exits green. Every run leaks a real tenant.
>
> **This warning is not a safeguard.** A comment in a README does not stop a
> command from running, and the env vars above are copy-pasteable. The test
> itself must fail closed. Until it does, run this **only** against a disposable
> staging Worker whose data you are willing to orphan — and treat a run against
> `immi.trackit.today` as an incident, not a mistake.
>
> **Required fix, owned by whichever plan owns `tests/e2e/*.py`** (this is a
> docs plan and must not edit the test): at the top of
> `tests/e2e/test_credentialed_auth_smoke.py`, refuse to run when the target is
> production or when the teardown backend does not match the target — e.g. skip
> (or fail) unless `urlparse(IMMI_AUTH_SMOKE_BASE_URL).hostname` is in an
> explicit allow-list that excludes `immi.trackit.today`, and require an
> `IMMI_AUTH_SMOKE_TEARDOWN=d1|supabase` that must agree with the target.
> Then port the teardown to D1 (`wrangler d1 execute`, or a Worker-side
> test-cleanup endpoint gated by a secret) and drop the allow-list.

Required env vars:

```bash
export IMMI_AUTH_SMOKE=1
export IMMI_AUTH_SMOKE_BASE_URL="https://immi.trackit.today"
export IMMI_AUTH_SMOKE_TELEGRAM_BOT_TOKEN="<same token as Worker TELEGRAM_BOT_TOKEN>"
# Retired-stack teardown connection — see the warning above. Only a still-live
# Supabase project satisfies this; it does NOT clean up production D1 rows.
export SUPABASE_DB_URL="postgresql://postgres:<service_role_password>@<project>.supabase.co:5432/postgres"
```

Optional env vars:

```bash
export IMMI_AUTH_SMOKE_TELEGRAM_ID="9900000001"  # omit to generate and delete a synthetic user
export IMMI_AUTH_SMOKE_HTTP_TIMEOUT=240          # LLM Council create can be slow
export IMMI_AUTH_SMOKE_SHORT_TIMEOUT=30
```

Run:

```bash
python3 -m pytest tests/e2e/test_credentialed_auth_smoke.py -q --timeout=300
```

Notes:

- Do not hardcode secrets in the test file or commit shell exports.
- Use a staging Worker URL when validating unreleased auth changes.
- The runner does not need `CF_AIG_TOKEN`, but the target Worker must have LLM Council configured or the session-create step should fail.
