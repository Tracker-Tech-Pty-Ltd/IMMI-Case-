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

## The E2E suite (plan 040)

**One suite only.** `tests/e2e/` (pytest + `pytest-playwright`) is this
project's only E2E suite. A second, duplicate suite at `frontend/e2e/`
(TypeScript + `@playwright/test`) was deleted in this change: it covered the
same React SPA with 78 unique tests against this suite's 260+, had not been
touched since 2026-03-09, and drove two routes (`/search`, `/update-db`) the
SPA no longer has.

**What it actually covers.** These tests drive the **Flask app** (`web.py` /
`immi_case_downloader/web/`), which is **local-dev only**. Production is the
Cloudflare Worker `workers/cloudflare-native.js`. Treat this suite as a
local-dev-parity gate, not a production gate.

**How to run it.**

```bash
make install-e2e   # once: pytest-playwright + chromium
make test-e2e
```

Smoke subset only (the two files this plan gates on every PR):

```bash
.venv/bin/pytest tests/e2e/test_smoke.py tests/e2e/react/test_react_smoke.py -q --no-cov --timeout=180
```

**How it is gated.** `.github/workflows/ci.yml`:

- `e2e-smoke` blocks every PR — the two smoke files above (100 tests total).
- `e2e-nightly` runs the rest of `tests/e2e` (excluding `tests/e2e/playwright`)
  on the `30 15 * * *` schedule and on `workflow_dispatch`. **It is not
  currently green — see "Known gap" below.**

Both jobs build the PR's/the checkout's own `frontend/src` before running
pytest, with an explicit guard step that fails loudly if that build step is
ever silently skipped.

**`tests/e2e/playwright/` is excluded from CI on purpose**, not because it is
quarantined work waiting to be fixed. `test_council_thread_visual.py` targets
`https://immi.trackit.today` by default and makes real LLM calls that cost
Cloudflare AI Gateway credits. Run it by hand, after a deploy, only when you
mean to.

**Collected test count** (`.venv/bin/pytest tests/e2e --collect-only -q --no-cov`,
verified 2026-08-28): **361 tests collected, 0 errors** — up from
`42 tests collected, 20 errors` before `pytest-playwright` was packaged
(plan 002).

### Known gap: the nightly full suite is not green

**No quarantine `--ignore=` list was added to `e2e-nightly`.** A local
rehearsal of the exact nightly command —
`.venv/bin/pytest tests/e2e -q --no-cov --timeout=300 --ignore=tests/e2e/playwright`
— currently exits **1** with **31 failed, 323 passed, 1 skipped** (verified
2026-08-28, against a fresh `frontend/src` build). Failures span **8 files**:

| File | Failing tests | Why (best evidence found) |
|---|---:|---|
| `tests/e2e/react/test_react_jobs.py` | 12 | Tests the old separate Download/Job Status/Pipeline pages. `frontend/src/App.tsx` now redirects `/download`, `/jobs`, `/pipeline` to a merged `/data-tools` page (`<DataToolsPage />`). |
| `tests/e2e/react/test_react_rapid_nav.py` | 4 | Cycles through sidebar nav items that included distinct Download/Pipeline entries; those entries no longer exist in `frontend/src/components/layout/nav-config.ts` (single `/data-tools` entry replaces them). |
| `tests/e2e/react/test_react_keyboard.py` | 4 | `p` keyboard shortcut asserted to navigate to `/pipeline`; two further failures (`d`-shortcut, blur-then-shortcut) not yet root-caused. |
| `tests/e2e/react/test_react_dashboard.py` | 4 | `TestQuickActions` asserts "Download"/"Pipeline"/"Export CSV"/"Export JSON" buttons on the Dashboard. Those strings no longer appear anywhere in `frontend/src/pages/DashboardPage.tsx` — the Dashboard was redesigned into a report/briefing layout, not merely renamed. |
| `tests/e2e/react/test_react_navigation.py` | 2 | `TestDesktopSidebar` asserts distinct Download/Pipeline sidebar links — same nav-config consolidation as above. |
| `tests/e2e/react/test_react_dark_mode.py` | 2 | Depends on the same removed Quick Actions buttons and the same sidebar cycle as above, under the dark theme. |
| `tests/e2e/react/test_react_case_crud.py` | 2 | `TestDeleteCase` times out clicking a "Delete" button/modal; not yet root-caused — may be a real defect, not UI drift. |
| `tests/e2e/react/test_react_cases_list.py` | 1 | `test_court_filter_changes_results` asserts `rows.count() < 10` after filtering to a single court; observed `10 < 10` (filter did not reduce the row count). Not yet root-caused — may be a real defect. |

**Why this plan does not close the gap.** Plan 040's Scope section authorizes
editing only `tests/e2e/test_smoke.py` and `tests/e2e/react/test_react_smoke.py`
among the test files (both are green — see the smoke-subset count above); the
8 files above are out of scope. The plan's own escape hatch — up to 5 files
on an explicit `--ignore=` line in `e2e-nightly`, each with a manifest row
here — cannot cover 8 files. Per plan 040's STOP condition ("the nightly
suite needs more than 5 files on the `--ignore=` list to go green... report
the file list and the failure reasons and stop"), this was reported rather
than worked around by editing out-of-scope files or silently expanding the
quarantine past its budget.

**Required follow-up**, owned by whoever picks this up next (no plan number
assigned yet as of 2026-08-28): for each file above, either (a) update its
assertions to match the current UI (nav consolidation, Dashboard redesign),
turning it back into a real regression gate, or (b) confirm
`test_react_case_crud.py`'s delete-modal timeout and
`test_react_cases_list.py`'s filter-count assertion are genuine application
defects and fix the app. Until this lands, `e2e-nightly` will fail on every
scheduled run and on every manual `workflow_dispatch` — that failure is
expected and should not be treated as a new regression when it first fires.

### Leftover `frontend/package.json` E2E wiring (plan 040 Step 5)

Deleting `frontend/e2e/` and `frontend/playwright.config.ts` left three
things behind, deliberately not touched because `frontend/package.json` has
three other concurrent editors (plans 001, 024, 035):

| Leftover | Where | Exact removal |
|---|---|---|
| `"e2e"`, `"e2e:ui"`, `"e2e:headed"` scripts | `frontend/package.json` `scripts` | delete the three lines |
| `"@playwright/test": "^1.58.2"` | `frontend/package.json` `devDependencies` | delete the line, then `npm install` to drop it (and its transitive entries) from `frontend/package-lock.json` |
| `"playwright.config.ts"` | `frontend/tsconfig.test.json` `include` | delete the array entry (harmless — TypeScript silently skips a non-matching `include` entry when others match) |

Until this is done, `npm run e2e` fails with `TypeError: Cannot redefine
property: Symbol($$jest-matchers-object)` / `Error: No tests found` (exit 1)
— loud, therefore acceptable, and confirmed to stay that way (it does not
silently discover another config and report success).
