# E2E Tests

## Credentialed Auth Smoke

`test_credentialed_auth_smoke.py` is an opt-in smoke test for the real Worker auth surface. It signs a synthetic Telegram Login Widget payload, then verifies:

- `POST /api/v1/auth/telegram`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/switch-tenant`
- credentialed `POST /api/v1/cases` with CSRF
- `POST /api/v1/llm-council/sessions`
- `GET /api/v1/llm-council/sessions`
- `POST /api/v1/llm-council/sessions/restore`
- `DELETE /api/v1/llm-council/sessions/:id`

The test is skipped unless explicitly enabled. It creates real rows and cleans up the generated user, test tenant, smoke case, and council session in `finally`.

Required env vars:

```bash
export IMMI_AUTH_SMOKE=1
export IMMI_AUTH_SMOKE_BASE_URL="https://immi.trackit.today"
export IMMI_AUTH_SMOKE_TELEGRAM_BOT_TOKEN="<same token as Worker TELEGRAM_BOT_TOKEN>"
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
