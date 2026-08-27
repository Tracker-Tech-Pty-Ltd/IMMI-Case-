# Plan 030: Delete the pre-cutover Supabase/Hyperdrive modules that production no longer loads

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. There is no `plans/README.md` in this repository
> at the time of writing; if one exists when you finish, update this plan's
> status row in it, otherwise skip that.
>
> **Drift check (run first)**. A `42826a3..HEAD` diff cannot see uncommitted,
> staged or untracked work, so all four commands below are required — a dirty
> tree would otherwise give you a false all-clear:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> IN_SCOPE='workers/auth/handlers.js
> workers/llm-council/handlers.js
> workers/llm-council/storage.js
> workers/__tests__/auth-handlers-cloudflare.test.js
> workers/__tests__/llm-council-handlers.test.js
> workers/__tests__/llm-council-storage.test.js
> workers/__tests__/cloudflare-council-security-contracts.test.js
> immi_case_downloader/hyperdrive_repository.py
> immi_case_downloader/web/__init__.py
> tests/test_app_factory.py
> Makefile'
> git status --short --branch
> git diff --stat 42826a3..HEAD  -- $IN_SCOPE   # landed since the plan was written
> git diff --stat               -- $IN_SCOPE   # unstaged
> git diff --cached --stat      -- $IN_SCOPE   # staged
> git status --short --untracked-files=all -- $IN_SCOPE
> ```
>
> Expected: **no in-scope path appears in any of the four**. If one does,
> compare the "Current state" excerpts below against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.
>
> **Expected drift you should NOT stop for**: `Makefile`. Four other plans in
> this batch edit it — `plans/001`, `002` and `003` change the `lint:`,
> `test:` and `install:` recipes, and `plans/036-bound-the-python-dependencies.md`
> changes the `install:` recipe's pip arguments. This plan touches **only**
> lines 39 and 107-108 (the `migrate:` recipe and its help line), which none of
> them touches. Narrow your judgement to those two regions:
>
> ```bash
> git diff 42826a3..HEAD -- Makefile | grep -E '^[-+].*(migrate|Push pending Supabase)'
> ```
>
> If that prints nothing, the `migrate` territory is clean regardless of what
> else moved in the file — proceed. If it prints something, another plan has
> taken this territory: STOP and report.
>
> **Never** run an unconditional `git checkout -- …`, `git restore …` or
> `git clean -f` to "clean up" a dirty tree. Those changes may be the
> operator's. Report and stop instead.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/004-fix-council-429-outage.md` (soft — see below)
- **Category**: tech-debt
- **Planned at**: commit `42826a3`, 2026-08-27

**Why plan 004 is a soft dependency.** The 49 tests deleted here are the only
place several Council security contracts are asserted. Step 1A of this plan
ports the surviving ones into a **new** file this plan owns
(`workers/__tests__/cloudflare-council-security-contracts.test.js`) so nothing
is lost. The one contract Step 1A deliberately does *not* port is the 429
rate-limit case, because `plans/004-fix-council-429-outage.md` owns
`workers/__tests__/cloudflare-council-handlers.test.js` and adds exactly that
coverage there. If plan 004 has already landed, skip the 429 item in Step 1A;
if it has not, add the 429 case to *your new file* and note the duplication in
your handoff so plan 004's owner can collapse them. Everything else in this
plan is executable without plan 004.

## Why this matters

Production is served entirely by `workers/cloudflare-native.js` (Cloudflare D1
+ R2 + Vectorize + Queues + Durable Objects). The old Worker
(`workers/proxy.js`, Hyperdrive → Supabase Postgres) was deleted in commit
`f91f45f`, but three of its handler modules survived the cutover — 1,703 lines
that nothing imports any more. They are not merely unused: they **document a
security model this stack cannot provide**. `workers/llm-council/handlers.js:7-12`
tells the next reader that "Tenant isolation is enforced server-side via RLS",
while the shipped model is an app-layer `assertMembership()` D1 lookup with no
database-level backstop. `workers/auth/handlers.js` still branches on
`env.HYPERDRIVE`. Their 49 Vitest tests are 14% of the Worker suite and can
never catch a production defect, and any future auth or Council edit can land
in the file production never loads.

On the Python side the same cutover left a live header-injection path in the
local-dev Flask app: `create_app()` copies the client-supplied
`X-Hyperdrive-Url` request header into `flask.g`, and
`supabase_repository._get_hyperdrive_conn()` hands that value straight to
`psycopg2.connect()`. The only component that was ever supposed to set that
header was `proxy.js`, which no longer exists — so today the header is purely
attacker-controlled. It is local-dev-only, but it is free to delete.

After this plan: 1,703 lines of misleading Worker code and their 49 hollow
tests are gone, the header-injection path is closed, the dead
`HyperdriveRepository` backend goes with it, and `make migrate` can no longer
silently push schema into a retired Postgres project.

## Current state

### The three dead Worker modules

- `workers/cloudflare-native.js` — the production entrypoint. Its imports
  (lines 9-29) name `./llm-council/cloudflare_handlers.js` and
  `./auth/cloudflare_handlers.js`; neither `llm-council/handlers.js` nor
  `auth/handlers.js` appears anywhere in it. Verbatim, `workers/cloudflare-native.js:1-10`:

  ```js
  /**
   * Standalone IMMI Cloudflare-native Worker entrypoint.
   *
   * It intentionally does not import the legacy proxy, Flask container, or
   * postgres.js. This entrypoint cannot be deployed until the route-manifest,
   * import reconciliation, privacy, shadow, and rollback gates are all green.
   */

  import { dispatchCloudflareCaseRead } from "./case-api/cloudflare.js";
  import { dispatchCloudflareCouncil } from "./llm-council/cloudflare_handlers.js";
  ```

- `workers/llm-council/handlers.js` — 702 lines, imported only by its own test
  file. Its header teaches the wrong security model. Verbatim,
  `workers/llm-council/handlers.js:1-12`:

  ```js
  /**
   * workers/llm-council/handlers.js
   *
   * Endpoint handler functions for the LLM Council Worker.
   *
   * AUTH MODEL (plan §1.3 + §1.4):
   *   Every persistence-touching endpoint requires a verified JWT. Tenant
   *   isolation is enforced server-side via RLS using `auth_tenant_id()` —
   *   handlers MUST pass `claims` into every storage call so the D1
   *   transaction wrapper sets `SET LOCAL request.jwt.claims` before any DML
   *   runs. The legacy X-Session-Token HMAC is no longer accepted as a
   *   standalone auth — JWT is the sole gate.
   */
  ```

  There is no `SET LOCAL request.jwt.claims` and no RLS anywhere in this stack;
  D1 has no RLS equivalent.

- `workers/llm-council/storage.js` — 256 lines. Its **only** non-test importer
  is the dead `workers/llm-council/handlers.js:35` (`} from "./storage.js";`).
  Note it is *not* Supabase-era code — it is dead by unreachability. Verbatim,
  `workers/llm-council/storage.js:1-13`:

  ```js
  /**
   * workers/llm-council/storage.js
   *
   * Cloudflare-native CRUD layer for council_sessions + council_turns.
   *
   * All storage goes through createCloudflareStores() which owns D1, R2,
   * Vectorize, and Workers AI bindings. Legacy PostgreSQL/Hyperdrive paths
   * have been removed. The IMMI_STORAGE_MODE must be "cloudflare".
   */

  import { createCloudflareStores } from "../storage/cloudflare.js";
  import { getStorageMode, StorageBoundaryError } from "../storage/contracts.js";
  import { getCouncilSessionStub } from "./session_namespace.js";
  ```

- `workers/auth/handlers.js` — 745 lines, imported only by its own test file.
  It still carries `env.HYPERDRIVE` branches at lines 287, 368, 469, 524 and
  695. Verbatim, `workers/auth/handlers.js:287`:

  ```js
    if (!isCloudflareMode(env) && !env.HYPERDRIVE) {
  ```

### The three dead Worker test files

- `workers/__tests__/llm-council-handlers.test.js` — 466 lines, **36 tests**,
  imports the dead module. Verbatim, `workers/__tests__/llm-council-handlers.test.js:42-50`:

  ```js
  import {
    handleCreateSession,
    handleAddTurn,
    handleGetSession,
    handleListSessions,
    handleDeleteSession,
    handleRestoreByCode,
    handleLegacyRun,
  } from "../llm-council/handlers.js";
  ```

- `workers/__tests__/llm-council-storage.test.js` — 210 lines, **7 tests**. It
  imports five names the module does not export (`storage.js`'s first `export`
  is `generateRetrieveCode` at line 20). Vite's SSR transform resolves the
  missing names to `undefined` rather than throwing, so the file passes while
  those names test nothing. Verbatim,
  `workers/__tests__/llm-council-storage.test.js:36-51`:

  ```js
  import {
    getSql,
    getSqlFresh,
    withSql,
    withSqlAsUser,
    withSqlFreshAsUser,
    createSession,
    addTurn,
    getSession,
    getSessionByCode,
    listSessions,
    deleteSession,
    loadHistory,
    LIST_SESSION_COLUMNS,
    generateRetrieveCode,
  } from "../llm-council/storage.js";
  ```

- `workers/__tests__/auth-handlers-cloudflare.test.js` — 162 lines, **6 tests**.
  Verbatim, `workers/__tests__/auth-handlers-cloudflare.test.js:30-35`:

  ```js
  import {
    handleAuthLogout,
    handleAuthRefresh,
    handleAuthSwitchTenant,
    handleTelegramLogin,
  } from "../auth/handlers.js";
  ```

The three files together contribute **49 of the Worker suite's 345 tests**
(measured: `npx vitest run` on just those three files reports `3 passed (3)` /
`49 passed (49)`).

### The Flask `X-Hyperdrive-Url` capture hook and `HyperdriveRepository`

Verbatim, `immi_case_downloader/web/__init__.py:78-94`:

```python
    if backend == "supabase":
        # When HYPERDRIVE_DATABASE_URL is injected by the Cloudflare Worker proxy,
        # use direct psycopg2 via Hyperdrive (bypasses Supabase REST API and external
        # DNS — which is unreachable inside Cloudflare Containers).
        _hyperdrive_url = os.environ.get("HYPERDRIVE_DATABASE_URL")
        if _hyperdrive_url:
            from ..hyperdrive_repository import HyperdriveRepository
            app.config["REPO"] = HyperdriveRepository(
                _hyperdrive_url, output_dir=output_dir
            )
            app.config["BACKEND"] = "hyperdrive"
            logger.info("Backend: Hyperdrive (direct psycopg2 via Cloudflare edge)")
        else:
            from ..supabase_repository import SupabaseRepository
            app.config["REPO"] = SupabaseRepository(output_dir=output_dir)
            app.config["BACKEND"] = "supabase"
            logger.info("Backend: Supabase REST API")
```

Verbatim, `immi_case_downloader/web/__init__.py:111-118`:

```python
    # Capture Hyperdrive connection string injected by the Cloudflare Worker proxy.
    # Only set when running inside a Cloudflare Container (header added by proxy.js).
    @app.before_request
    def _capture_hyperdrive_url():
        from flask import g, request as req
        hd_url = req.headers.get("X-Hyperdrive-Url")
        if hd_url:
            g.hyperdrive_url = hd_url
```

`proxy.js` was deleted in commit `f91f45f` ("refactor(cloudflare): remove
legacy Supabase/Hyperdrive worker code"), so nothing sets that header any more
— every value now reaching `g.hyperdrive_url` comes from the HTTP client.
That value is consumed. Verbatim,
`immi_case_downloader/supabase_repository.py:20-39`:

```python
def _get_hyperdrive_conn():
    """Return a psycopg2 connection via Cloudflare Hyperdrive, or None.

    Priority:
      1. Flask request-scoped ``g.hyperdrive_url`` injected by proxy.js
      2. ``HYPERDRIVE_DATABASE_URL`` environment variable (local dev / CI)
    Returns None when neither is available so callers fall back to REST API.
    """
    url = None
    try:
        from flask import g
        url = getattr(g, "hyperdrive_url", None)
    except RuntimeError:
        pass  # Outside Flask app context (CLI / scripts)
    url = url or _HYPERDRIVE_URL
    if not url:
        return None
    try:
        import psycopg2  # type: ignore[import]
        return psycopg2.connect(url)
```

and `immi_case_downloader/supabase_repository.py:134-136`:

```python
        conn = _get_hyperdrive_conn()
        if conn:
            return self._load_analytics_via_pg(conn)
```

`immi_case_downloader/hyperdrive_repository.py` is 461 lines. Its **only**
reference in the whole repository is `web/__init__.py:84`; it has no test file.
Its own docstring ties it to a topology that no longer exists. Verbatim,
`immi_case_downloader/hyperdrive_repository.py:1-9`:

```python
"""PostgreSQL repository via Cloudflare Hyperdrive (psycopg2).

Used inside Cloudflare Containers where the Supabase REST API is unreachable
due to DNS resolution failures in the container's network environment.
Hyperdrive provides an internal Cloudflare connection string that routes
through Cloudflare's edge without requiring external DNS resolution.

Usage: automatically selected by create_app() when HYPERDRIVE_DATABASE_URL is set.
"""
```

Its two class attributes `supports_seek_pagination = True` and
`pagination_backend_kind = "hyperdrive"` (lines 55-56) are duck-typed
attributes read generically by `cases_pagination.py`; no code anywhere
special-cases the string `"hyperdrive"`.

The two tests that pin the capture hook — verbatim,
`tests/test_app_factory.py:98-136`:

```python
# ── _capture_hyperdrive_url before_request hook ──────────────────────────────


class TestCaptureHyperdriveUrl:
    """The X-Hyperdrive-Url header is captured into Flask g."""

    def test_header_stored_in_g(self):
        """When X-Hyperdrive-Url is present, g.hyperdrive_url is set."""
        app = _make_app()

        stored = {}

        @app.route("/test-hd")
        def _hd_probe():
            from flask import g
            stored["url"] = getattr(g, "hyperdrive_url", None)
            return "ok"

        client = app.test_client()
        client.get("/test-hd", headers={"X-Hyperdrive-Url": "postgresql://edge/db"})

        assert stored.get("url") == "postgresql://edge/db"

    def test_no_header_leaves_g_unset(self):
        """Without the header, g.hyperdrive_url is NOT set."""
        app = _make_app()

        stored = {}

        @app.route("/test-no-hd")
        def _no_hd_probe():
            from flask import g
            stored["has_attr"] = hasattr(g, "hyperdrive_url")
            return "ok"

        client = app.test_client()
        client.get("/test-no-hd")

        assert stored.get("has_attr") is False
```

`tests/test_app_factory.py:1-7` (its module docstring, which also needs
updating):

```python
"""Tests for web/__init__.py app factory — uncovered paths.

Targets:
- backend="supabase" branch (lines 79-81)
- _capture_hyperdrive_url() before_request hook (line 105)
- SPA static asset serving in app.testing mode (lines 141-153)
"""
```

### The `make migrate` target

Verbatim, `Makefile:107-108`:

```make
migrate:
	supabase db push
```

Verbatim, `Makefile:39` (inside the `help:` recipe):

```make
	@echo "  make migrate      Push pending Supabase migrations"
```

Investigation result (run before writing this plan): `supabase db push` /
`make migrate` appear in exactly three places repo-wide —
`Makefile:39`, `Makefile:108`, and `CLAUDE.md:25`. **No GitHub workflow, no
script, and no test invokes it.** The live production schema is
`migrations/d1/catalog/0001_catalog.sql`, `migrations/d1/account/0001_account.sql`,
`migrations/d1/ops/0001_ops.sql`, `migrations/d1/ops/0002_pipeline_control.sql`
— four files with no make target at all. `supabase/` holds 43 tracked files /
16,234 lines (18 under `supabase/migrations/`, 23 already under
`supabase/archive/migrations-pre-baseline-2026-05-12/`, plus `.gitignore` and
`config.toml`), including `supabase/migrations/20260503_002_rls_policies.sql`,
whose header begins:

```sql
-- Migration: Telegram Login + multi-tenant auth — RLS policies.
-- Enables Row Level Security on IMMI tenant-aware tables and defines access
-- policies. JWT claims are injected by the Worker via:
--   SET LOCAL "request.jwt.claims" = '<json>';
```

Retaining those files is deliberate. `docs/ARCHITECTURE.md:224-227` states:

> **Supabase-related scripts and migrations in this repo are one-time
> ETL/migration tooling**, not a live dependency — they were used to
> populate the original D1/R2/Vectorize import and are not invoked by
> the production Worker.

So this plan does **not** move or delete anything under `supabase/`. It only
stops `make migrate` from pushing to that retired project by muscle memory.

### Repo conventions this plan must match

- **Commit convention** — `<type>: <description>`, type in
  `feat|fix|refactor|docs|test|chore|perf|ci`. Real examples from `git log`:
  `fix: install root node_modules in make install`,
  `ci: stop ignoring the separation preflight suite`. No AI attribution lines.
- **Makefile** — `GNU Make 3.81` (macOS system make). Recipe lines are indented
  with a literal **TAB**, never spaces. `PYTHON` resolves to
  `$(REPO_ROOT)/.venv/bin/python` when that file exists.
- **Python** — always use the repo venv (`.venv/bin/python`, `.venv/bin/pytest`,
  `.venv/bin/ruff`); never global `pip`/`python3`.
- **Worker tenant isolation** — app-layer only, via
  `CloudflareIdentityStore.assertMembership()` in `workers/storage/cloudflare.js`.
  There is no Postgres and no RLS. `env.IMMI_CATALOG_DB` / `IMMI_ACCOUNT_DB` /
  `IMMI_OPS_DB` are D1 bindings. Do not write or preserve any comment that
  claims otherwise.

## Commands you will need

Run all of these from the repository root,
`/Users/d/Developer/Active Projects/IMMI-Case-`.

| Purpose | Command | Expected on success |
|---|---|---|
| Worker tests | `make test-workers` | see the **delta rule** below — never an absolute total |
| Python unit tests | `make test-py` | see the **delta rule** below. Whatever the pass count, the failures must remain **exactly the 3 named `pypdf`/`pyexpat` ImportErrors in `tests/test_backfill_judge_overrides_from_pdf.py`** (Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch — environmental, not repo code). On an interpreter with a working `pypdf` there are 0 failures; that is also fine. |
| One Python test file | `.venv/bin/python -m pytest tests/test_app_factory.py -q` | `8 passed, 1 skipped` before Step 3; `6 passed, 1 skipped` after Step 3; `8 passed, 1 skipped` again after Step 4 adds two |
| Python lint | `make lint` | `All checks passed!` |
| Frontend tests | `cd frontend && npx vitest run` | untouched by this plan — the count you record in Step 0 must be unchanged at the end |
| Worker bundle closure gate | `node scripts/check_cloudflare_native_bundle.mjs` | `Cloudflare-native bundle closure passed (<N> bytes): /tmp/...`, exit 0 |
| Native config gate | `.venv/bin/python scripts/check_cloudflare_native_target.py` | exit 0 |
| Changed-file check | `git status --short` | only files from the In-scope list |

**Delta rule (read this before quoting any number).** Other plans in this batch
land tests in the same suites, so absolute totals such as "296 passed" are not a
usable gate — they break the moment a sibling plan merges, and an executor who
"fixes" the yardstick has broken the gate. Every count in this plan is therefore
expressed as a **delta against the baseline you record yourself in Step 0**:

| Suite | Required movement |
|---|---|
| Worker (`make test-workers`) | files `WORKER_FILES_BEFORE − 2` (Step 1A adds one file, Steps 1–2 delete three); tests `WORKER_TESTS_BEFORE − 49 + N_NEW`, where `N_NEW` is the number of tests you write in Step 1A |
| Python (`make test-py`) | passed `PY_PASS_BEFORE − 2 + 2 = PY_PASS_BEFORE` (Step 3 removes 2, Step 4 adds 2); skipped unchanged; failures still exactly the 3 named `pypdf` ImportErrors |
| Frontend | unchanged |

## Scope

**In scope** (the only files you may modify or delete):

- `workers/llm-council/handlers.js` — **delete** (Step 1)
- `workers/llm-council/storage.js` — **delete** (Step 1)
- `workers/__tests__/llm-council-handlers.test.js` — **delete** (Step 1)
- `workers/__tests__/llm-council-storage.test.js` — **delete** (Step 1)
- `workers/auth/handlers.js` — **delete** (Step 2)
- `workers/__tests__/auth-handlers-cloudflare.test.js` — **delete** (Step 2)
- `workers/__tests__/cloudflare-council-security-contracts.test.js` —
  **create** (Step 1A). A new file, so it collides with nothing.
- `immi_case_downloader/web/__init__.py` — remove the `_capture_hyperdrive_url`
  hook (Step 3) and the `HyperdriveRepository` sub-branch (Step 4)
- `immi_case_downloader/hyperdrive_repository.py` — **delete** (Step 4)
- `tests/test_app_factory.py` — remove `TestCaptureHyperdriveUrl` and fix the
  module docstring (Step 3); add two backend-selection tests (Step 4)
- `Makefile` — the `migrate:` recipe (lines 107-108) and its help line (line 39)
  **only** (Step 5)
- `plans/030-delete-dead-supabase-era-code.md` — this file, status only

The four `workers/__tests__/*.test.js` files and `tests/test_app_factory.py`
are in scope because they are the dedicated test files for source files this
plan deletes; they cannot be separated from those deletions.

**Out of scope** (do NOT touch, even though they look related):

- **Anything under `supabase/`.** `docs/ARCHITECTURE.md:224-227` records the
  retention of those migrations as deliberate one-time ETL tooling. Do not
  delete, move, or archive them, and do not edit the stale file-path comments
  inside `supabase/migrations/20260510_council_retrieve_code.sql:17-19` or
  `supabase/migrations/20260503_001_tenancy.sql:9` — applied migration files
  are historical artifacts.
- **Never run `supabase db push`, `supabase link`, or any other `supabase`
  subcommand.** Step 5 deliberately does **not** create a convenience target for
  it (see Step 5 for why); the legacy push is documented as a runbook only.
- `workers/__tests__/cloudflare-council-handlers.test.js` — owned by
  `plans/004-fix-council-429-outage.md`, which adds three 429 tests to it. Do
  not edit it; put your ported contracts in the new file instead.
- `workers/auth/refresh_sessions.js` — the three `*Tx` helpers at lines 54, 61
  and 76 (including the Postgres `FOR UPDATE` row lock) become dead once Step 2
  lands, but this module is also imported live by
  `workers/auth/cloudflare_handlers.js:13-17` and is owned by another in-flight
  change. Leave it and `workers/__tests__/auth-refresh-sessions.test.js`
  exactly as they are; see "Maintenance notes".
- `workers/llm-council/cloudflare_handlers.js` and
  `workers/auth/cloudflare_handlers.js` — their header comments reference the
  modules you are deleting and will be stale afterwards, but both files are
  owned by other in-flight changes. Do not edit them; see "Maintenance notes".
- `immi_case_downloader/supabase_repository.py` — the `g.hyperdrive_url` read
  at lines 29-31 becomes unreachable once Step 3 lands (nothing sets the
  attribute), but removing it also means editing
  `tests/test_supabase_repository.py`, which is outside this plan's file
  territory. Leave both; see "Maintenance notes".
- `immi_case_downloader/web/auth.py` — the `X-Internal-Route` header check.
  See "Findings reconsidered".
- `wrangler.toml`, `workers/storage/contracts.js`,
  `scripts/verify_immi_separation.py`, `tests/test_separation_preflight.py` —
  the `CUTOVER_WRITE_FREEZE` / `STORAGE_MODES` cleanup. See "Findings
  reconsidered".
- `workers/extraction-container.js` — it looks orphaned but is **not**. It is
  the `ExtractionBackend` entrypoint declared at
  `workers/austlii-scraper/wrangler.toml:95-97`, required by the fail-closed
  gate at `scripts/check_cloudflare_native_target.py:193-194`, and read as
  source by `tests/test_extraction_container_boundary.py:27`. Deleting it
  breaks the deploy preflight.
- `CLAUDE.md`, `AGENTS.md`, `docs/**`, `.claude/**`, `.omc/**`, `.aperant/**`.
- Any other Makefile recipe (`lint:`, `typecheck:`, `test:`, `install:`, the
  `.PHONY` line). Other in-flight changes own those.
- `frontend/**` — nothing in this plan touches the SPA.

## Git workflow

- Branch: `git switch -c advisor/030-delete-dead-supabase-era-code`
- One commit per step. Suggested messages:
  - Step 1A: `test: pin the live Council security contracts before deleting the legacy suite`
  - Step 1: `refactor: delete the pre-cutover LLM Council handler and storage modules`
  - Step 2: `refactor: delete the pre-cutover Hyperdrive auth handlers`
  - Step 3: `fix: stop trusting the client-supplied X-Hyperdrive-Url header`
  - Step 4: `refactor: delete the unreachable HyperdriveRepository backend`
  - Step 5: `chore: stop make migrate from pushing to the retired Supabase project`
- Use `git rm` for deletions so the index stays consistent.
- Do **NOT** push, open a PR, or merge. The operator commits and ships.

## Steps

### Step 0: Record your baseline

Before changing anything, capture the numbers you will compare against. The
"expected" values in later steps assume the HEAD `42826a3` baseline; if your
machine differs (for example a working `pypdf`), compare against *your* numbers
using the stated deltas instead.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-workers 2>&1 | tail -4
make test-py 2>&1 | grep -E "^(FAILED|ERROR)" | sort -u
make test-py 2>&1 | tail -3
.venv/bin/python -m pytest tests/test_app_factory.py -q 2>&1 | tail -2
(cd frontend && npx vitest run 2>&1 | tail -3)
```

Write down, as named variables you will use for the rest of this plan:

- `WORKER_FILES_BEFORE`, `WORKER_TESTS_BEFORE`
- `PY_PASS_BEFORE`, `PY_SKIP_BEFORE`, and the **names** of every failing Python
  test (not just how many)
- `APP_FACTORY_BEFORE` (the `tests/test_app_factory.py` count)
- `FE_FILES_BEFORE`, `FE_TESTS_BEFORE`

At HEAD `42826a3` these happened to be 25 / 345, 1141 / 7, `8 passed, 1 skipped`
and 55 / 490 — but **do not treat those as the gate**. Your own recorded numbers
are the gate, and the deltas in the "Delta rule" table are what must hold.

**Verify**:

1. `git status --short` → shows no modifications you introduced (a pre-existing
   ` M .claude/STATE.md` may be present; leave it alone).
2. The failing-test names you recorded are **exactly** the three `pypdf` import
   failures in `tests/test_backfill_judge_overrides_from_pdf.py`, or there are
   none. Any other failing test is a STOP condition — this plan cannot start
   from an already-broken suite.

### Step 1A: Port the surviving Council security contracts onto the live handlers

**Do this before deleting anything.** The 36 tests in
`workers/__tests__/llm-council-handlers.test.js` are bound to a dead module, but
several of the *contracts* they assert are still real and are **not** asserted
anywhere against the live `workers/llm-council/cloudflare_handlers.js`. Measured
at `42826a3`: `workers/__tests__/cloudflare-council-handlers.test.js` has 8
tests and contains no `401`, `409` or `429` assertion at all, and no assertion
that a get or list response body withholds the retrieve code.

Create `workers/__tests__/cloudflare-council-security-contracts.test.js`. Model
its harness on the existing `workers/__tests__/cloudflare-council-handlers.test.js`
(same `vi.mock` shape for the stores and the runner) — read that file first, and
copy its mocking idiom rather than inventing one.

For **each** contract below, first confirm the live line still implements it,
then write the test. If a line no longer implements the contract, **do not write
a test asserting behaviour that does not exist** — record it in your handoff as
a real regression and STOP.

| Contract | Live implementation to confirm first | Test |
|---|---|---|
| 401 on missing/invalid/expired Bearer token | `requireSessionAuth(...)` at the top of each handler — `cloudflare_handlers.js:171`, `:206`, and the equivalent guard on list / get / delete / restore | one test per Council route: no `Authorization` header → status `401` |
| 400 on a missing/blank `message` | `validateBodyMessage(body)` (`:177`, `:214`) | POST create-session with `{}` → `400` |
| 400 on a malformed retrieve code | the 6-character check near `cloudflare_handlers.js:298` | restore-by-code with `"ABC"` → `400` |
| 404 on session-not-found | `readSession(...)` → `errorResponse("Session not found", 404)` (`:219`, and the equivalent in get/delete/restore around `:253`, `:262`, `:286`, `:301`) | add-turn to an unknown session id → `404` |
| 409 at the 15-turn cap | `current.session.total_turns >= MAX_TURNS` (`:220`) | add-turn when the mocked session reports `total_turns: 15` → `409` |
| get/list responses strip the retrieve code | `normalizeSessionResponse()` — `delete session.retrieve_code` at `cloudflare_handlers.js:155` | seed the mocked store with `retrieve_code: "LEAKME"`, GET the session, assert the serialised body does **not** contain `LEAKME`; same for the list route |

**Do not** write a test asserting that `hmac_sig` never appears in a response.
That column does not exist anywhere in this stack — a repo-wide grep finds it
only in the dead `workers/llm-council/handlers.js:449` and its two dead test
files — so the assertion would pass no matter what the handler did. See
"Review points not applied".

**Do not** assert that `retrieve_code` or `session_token` are absent from *every*
response either. `handleCreateSession` returns both by design
(`cloudflare_handlers.js:200-201`), as does `handleRestoreByCode` (`:304-305`) —
that is how a user receives their own code. The contract is that they are
stripped from the **get** and **list** paths, which is what the row above tests.

**Do not port** the 429 rate-limit case if `plans/004-fix-council-429-outage.md`
has already landed — it adds exactly that to
`workers/__tests__/cloudflare-council-handlers.test.js`, which you must not
edit. Check with `grep -c 429 workers/__tests__/cloudflare-council-handlers.test.js`;
if it prints `0`, add a 429 case to your new file and flag the future
duplication in your handoff.

**Do not** import `workers/llm-council/handlers.js` or
`workers/llm-council/storage.js` from the new file. The whole point is that the
contracts are asserted against the module production actually loads.

**Verify**:

1. `npx vitest run --config workers/vitest.config.js __tests__/cloudflare-council-security-contracts.test.js 2>&1 | tail -3`
   → all pass; record the count as `N_NEW`.
2. **The tests can fail.** Prove it for at least two of them: temporarily change
   the expected status (e.g. `409` → `410`), re-run, confirm a red run, then
   restore. A test that passes against both the real and a wrong expectation is
   not a test.
3. `grep -c "llm-council/handlers.js\|llm-council/storage.js" workers/__tests__/cloudflare-council-security-contracts.test.js`
   → `0`.
4. `make test-workers 2>&1 | tail -4` → files `WORKER_FILES_BEFORE + 1`, tests
   `WORKER_TESTS_BEFORE + N_NEW`.

### Step 1: Delete the LLM Council pre-cutover handler and storage modules

First prove they are unreachable:

```bash
grep -rn "llm-council/handlers\|llm-council/storage" workers/ scripts/ frontend/src wrangler.toml
```

Expected output — exactly these seven lines, all inside the two modules
themselves or their two test files, and **nothing** from a source module:

```
workers/__tests__/llm-council-storage.test.js:4: * Vitest unit tests for workers/llm-council/storage.js (post plan §1.3-§1.5
workers/__tests__/llm-council-storage.test.js:51:} from "../llm-council/storage.js";
workers/__tests__/llm-council-handlers.test.js:4: * Vitest integration tests for workers/llm-council/handlers.js (post plan
workers/__tests__/llm-council-handlers.test.js:20:vi.mock("../llm-council/storage.js", () => ({
workers/__tests__/llm-council-handlers.test.js:50:} from "../llm-council/handlers.js";
workers/llm-council/handlers.js:2: * workers/llm-council/handlers.js
workers/llm-council/storage.js:2: * workers/llm-council/storage.js
```

The point is that none of them is an `import` in a non-test source file: two
are the modules' own header comments, and the other five are inside the two
test files being deleted. If any line shows a non-test source module importing
either file, **STOP**.

Then delete all four files:

```bash
git rm workers/llm-council/handlers.js \
       workers/llm-council/storage.js \
       workers/__tests__/llm-council-handlers.test.js \
       workers/__tests__/llm-council-storage.test.js
```

**Verify**:

1. `grep -rn "llm-council/handlers\|llm-council/storage" workers/ scripts/ frontend/src wrangler.toml` → **no output** (exit 1).
2. `make test-workers 2>&1 | tail -4` → files `WORKER_FILES_BEFORE − 1`, tests
   `WORKER_TESTS_BEFORE + N_NEW − 43` (43 = 36 + 7).
3. `node scripts/check_cloudflare_native_bundle.mjs` → prints
   `Cloudflare-native bundle closure passed (...)`, exit 0.

### Step 2: Delete the pre-cutover Hyperdrive auth handlers

First prove unreachability:

```bash
grep -rn "auth/handlers" workers/ scripts/ frontend/src wrangler.toml
```

Expected output — exactly three lines, none of them an import in a source
module:

```
workers/auth/handlers.js:2: * auth/handlers.js — Route handlers for /api/v1/auth/* endpoints.
workers/auth/cloudflare_handlers.js:4: * This is deliberately separate from auth/handlers.js so the native bundle
workers/__tests__/auth-handlers-cloudflare.test.js:35:} from "../auth/handlers.js";
```

The `cloudflare_handlers.js:4` hit is a prose comment, not an import — leave
that file untouched (see "Out of scope"). If you see a real `import ... from
".../auth/handlers.js"` in any non-test source file, **STOP**.

Then delete:

```bash
git rm workers/auth/handlers.js workers/__tests__/auth-handlers-cloudflare.test.js
```

**Verify**:

1. `grep -rn "auth/handlers\.js" workers/ scripts/ frontend/src wrangler.toml` → exactly one line remains: `workers/auth/cloudflare_handlers.js:4: * This is deliberately separate from auth/handlers.js so the native bundle`.
2. `make test-workers 2>&1 | tail -4` → files `WORKER_FILES_BEFORE − 2`, tests
   `WORKER_TESTS_BEFORE + N_NEW − 49`.
3. `node scripts/check_cloudflare_native_bundle.mjs` → exit 0.
4. `.venv/bin/python scripts/check_cloudflare_native_target.py; echo "exit=$?"` → `exit=0`.

### Step 3: Stop copying the client-supplied `X-Hyperdrive-Url` header into `flask.g`

In `immi_case_downloader/web/__init__.py`, delete this entire block (lines
111-118 at HEAD `42826a3`) — the comment lines, the decorator, and the
function:

```python
    # Capture Hyperdrive connection string injected by the Cloudflare Worker proxy.
    # Only set when running inside a Cloudflare Container (header added by proxy.js).
    @app.before_request
    def _capture_hyperdrive_url():
        from flask import g, request as req
        hd_url = req.headers.get("X-Hyperdrive-Url")
        if hd_url:
            g.hyperdrive_url = hd_url
```

Leave the blank line separation tidy: the `@app.teardown_appcontext` block
above it and the `# Security headers on every response` block below it must
remain, separated by exactly one blank line.

In `tests/test_app_factory.py`, delete the section header comment, the whole
`TestCaptureHyperdriveUrl` class and its two methods (lines 98-136 at HEAD
`42826a3`, quoted verbatim in "Current state"). Then update the module
docstring at lines 1-7 by removing the middle bullet, so it reads:

```python
"""Tests for web/__init__.py app factory — uncovered paths.

Targets:
- backend="supabase" branch (lines 79-81)
- SPA static asset serving in app.testing mode (lines 141-153)
"""
```

Do **not** touch `immi_case_downloader/supabase_repository.py` or
`tests/test_supabase_repository.py`.

**Verify**:

1. `grep -rn "X-Hyperdrive-Url\|_capture_hyperdrive_url" immi_case_downloader/ tests/` → **no output** (exit 1).
2. `.venv/bin/python -m pytest tests/test_app_factory.py -q 2>&1 | tail -3` → `6 passed, 1 skipped`, i.e. `APP_FACTORY_BEFORE − 2`.
3. `.venv/bin/python -m pytest tests/test_supabase_repository.py tests/test_security.py -q 2>&1 | tail -3` → all pass, no new failures.
4. `make lint` → `All checks passed!`

### Step 4: Delete the `HyperdriveRepository` backend — a deliberate breaking removal

**Read this framing before you edit.** An earlier draft of this plan called the
change "not a capability loss worth worrying about". That was wrong, and the
executor must understand exactly what breaks so it can be reported honestly.

Today, `create_app(backend="supabase")` with **only** `HYPERDRIVE_DATABASE_URL`
set constructs `HyperdriveRepository` and never touches Supabase credentials.
After this step the same invocation constructs `SupabaseRepository`, whose
`__init__` raises when the credentials are absent —
`immi_case_downloader/supabase_repository.py:88-94` (verbatim):

```python
        url = url or os.environ.get("SUPABASE_URL", "")
        key = key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        if not url or not key:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set "
                "(via env vars or constructor args)."
            )
```

So this step is a **breaking removal of a local-dev backend**, with two
consequences to state in your handoff:

1. `BACKEND=supabase` now **requires** `SUPABASE_URL` **and**
   `SUPABASE_SERVICE_ROLE_KEY`. A developer who was running on
   `HYPERDRIVE_DATABASE_URL` alone will get a `ValueError` at app-factory time.
2. Even with all three env vars set, full CRUD moves from direct PostgreSQL
   (psycopg2, `HyperdriveRepository`) to the Supabase **REST API**. Only the
   analytics load keeps a direct connection, via
   `SupabaseRepository._get_hyperdrive_conn()`
   (`supabase_repository.py:20-39`, used at `:134-136`).

Both are acceptable — production has no Flask at all, and the deleted class is
461 untested lines pinned to a topology that no longer exists — but they are
losses, not no-ops, and the plan does not pretend otherwise.

First prove it has exactly one reference:

```bash
grep -rn "hyperdrive_repository\|HyperdriveRepository" immi_case_downloader/ scripts/ tests/ *.py
```

Expected output — exactly one line:

```
immi_case_downloader/web/__init__.py:84:            from ..hyperdrive_repository import HyperdriveRepository
```

If more lines appear, **STOP**.

Then, in `immi_case_downloader/web/__init__.py`, replace the whole
`if backend == "supabase":` block (lines 78-94 at HEAD `42826a3`, quoted
verbatim in "Current state") with:

```python
    if backend == "supabase":
        from ..supabase_repository import SupabaseRepository
        app.config["REPO"] = SupabaseRepository(output_dir=output_dir)
        app.config["BACKEND"] = "supabase"
        logger.info("Backend: Supabase REST API")
```

Then delete the module:

```bash
git rm immi_case_downloader/hyperdrive_repository.py
```

Now **pin the new behaviour with two tests**, because the old ones are gone and
a bare `import create_app` proves nothing about which branch runs. Add these to
`tests/test_app_factory.py`, next to the existing `TestBackendSelection`-style
cases (read the file and match its idiom — it uses `_make_app()` and
`unittest.mock.patch.dict(os.environ, ...)`):

```python
class TestSupabaseBackendSelection:
    """backend='supabase' always builds SupabaseRepository after the
    HyperdriveRepository removal — including when only the Hyperdrive URL is set."""

    def test_hyperdrive_url_alone_no_longer_selects_a_second_backend(self, tmp_path):
        """Only HYPERDRIVE_DATABASE_URL set → SupabaseRepository is attempted,
        and it fails loudly for missing credentials rather than silently
        swapping in a different repository class."""
        env = {"HYPERDRIVE_DATABASE_URL": "postgresql://edge/db"}
        with patch.dict(os.environ, env, clear=False):
            os.environ.pop("SUPABASE_URL", None)
            os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
            with pytest.raises(ValueError, match="SUPABASE_URL"):
                create_app(backend="supabase", output_dir=str(tmp_path))

    def test_supabase_and_hyperdrive_both_set_still_selects_supabase(self, tmp_path):
        """Both env shapes present → BACKEND is 'supabase', never 'hyperdrive'."""
        env = {
            "HYPERDRIVE_DATABASE_URL": "postgresql://edge/db",
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
        }
        with patch.dict(os.environ, env, clear=False):
            app = create_app(backend="supabase", output_dir=str(tmp_path))
        assert app.config["BACKEND"] == "supabase"
        assert type(app.config["REPO"]).__name__ == "SupabaseRepository"
```

`"test-service-role-key"` is a literal test fixture, not a credential — no real
key belongs in this repository. If `create_app` reaches the network with that
value, mock `immi_case_downloader.supabase_repository.create_client` for the
second test rather than weakening the assertion.

**Verify**:

1. `grep -rn "hyperdrive_repository\|HyperdriveRepository" immi_case_downloader/ scripts/ tests/ *.py` → **no output** (exit 1).
2. `.venv/bin/python -m pytest tests/test_app_factory.py -q 2>&1 | tail -3` →
   `8 passed, 1 skipped`, i.e. back to `APP_FACTORY_BEFORE` (Step 3 removed 2,
   this step adds 2). If it is `6 passed`, you did not add the tests.
3. **The new tests can fail.** Prove it: temporarily change the second test's
   expectation to `== "hyperdrive"`, re-run, confirm red, restore.
4. `grep -rn 'BACKEND"\] = "hyperdrive"' immi_case_downloader/` → no output.
5. `make lint` → `All checks passed!`
6. `make test-py 2>&1 | tail -3` → passed equals `PY_PASS_BEFORE` (−2 from
   Step 3, +2 here); skipped equals `PY_SKIP_BEFORE`; the failing test **names**
   are still exactly the ones you recorded in Step 0. If a *new* name appears,
   **STOP**.

### Step 5: Make `make migrate` refuse to push, and do **not** replace it with a one-flag bypass

**Why there is no `migrate-legacy-supabase` target.** An earlier draft of this
plan added one, gated on `CONFIRM=1`. That is not a safe design: `supabase db
push` acts on **whatever project the Supabase CLI is currently linked to**, and
the link is machine-local state, not repo state — `supabase/.temp/project-ref`
and `supabase/.temp/linked-project.json` exist on this machine and are gitignored
(`supabase/.gitignore` lists `.temp`). `CONFIRM=1` therefore confirms *intent*,
never *target*: an operator who has since linked the CLI to a live project would
get a real schema push against it with one extra word on the command line. A
make target cannot verify the target database, so this plan does not offer one.
The legacy push becomes a runbook a human executes deliberately.

In `Makefile`, replace lines 107-108:

```make
migrate:
	supabase db push
```

with (every recipe line below must start with a literal **TAB**):

```make
# `supabase db push` targets the RETIRED Supabase Postgres project, and it acts
# on whatever project the local Supabase CLI happens to be linked to — which is
# machine-local state this repository cannot see or verify. Production schema
# lives in Cloudflare D1 (migrations/d1/{catalog,account,ops}/*.sql). The
# Supabase migrations are kept as one-time ETL tooling (docs/ARCHITECTURE.md).
# There is deliberately NO make target that performs the legacy push: see
# docs/ARCHITECTURE.md and the runbook printed below.
migrate:
	@echo "REFUSING: 'supabase db push' targets the RETIRED Supabase Postgres project,"
	@echo "and it acts on whichever project your local Supabase CLI is linked to."
	@echo ""
	@echo "Production schema lives in Cloudflare D1:"
	@echo "  migrations/d1/catalog/*.sql  migrations/d1/account/*.sql  migrations/d1/ops/*.sql"
	@echo "Apply those with wrangler against the operator-supplied D1 database ids."
	@echo ""
	@echo "If you genuinely need the legacy Supabase ETL push, do it by hand:"
	@echo "  1. supabase projects list          # confirm which project you mean"
	@echo "  2. supabase link --project-ref <REF>   # state the target explicitly"
	@echo "  3. supabase db diff --linked       # READ the diff before applying"
	@echo "  4. supabase db push --linked       # only if step 3 is what you intended"
	@exit 1
```

Then update the help line at `Makefile:39` from:

```make
	@echo "  make migrate      Push pending Supabase migrations"
```

to:

```make
	@echo "  make migrate      Where migrations live (the legacy Supabase push is manual)"
```

Change nothing else in the Makefile. In particular, **do not add any target
whose recipe contains `supabase db push`.**

**Verify**:

1. `make migrate >/tmp/immi-migrate.txt 2>&1; echo "exit=$?"` → `exit=2`
   (GNU Make 3.81 reports 2 when a recipe fails), and
   `grep -c "REFUSING" /tmp/immi-migrate.txt` → `1`.
2. `grep -cE '^\t[^@]*supabase' Makefile` → `0`. This is the load-bearing
   check: no Makefile **recipe line** can invoke the Supabase CLI any more, with
   or without a flag. A plain `grep -c "supabase db push" Makefile` would be a
   useless gate here — it also matches the `@echo` runbook text, so it can never
   distinguish success from failure.
3. `make -n migrate | grep -cE '^[^@]*supabase (db|link|projects)'` → `0`
   (make's own dry-run expansion contains no executable supabase invocation).
4. `make help >/dev/null 2>&1; echo "exit=$?"` → `exit=0`.
5. `make lint` → `All checks passed!` and `make test-py 2>&1 | tail -3` →
   unchanged from Step 4.

### Step 6: Final full verification

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-workers 2>&1 | tail -4
make test-py 2>&1 | grep -E "^(FAILED|ERROR)" | sort -u
make test-py 2>&1 | tail -3
make lint
cd frontend && npx vitest run 2>&1 | tail -4
```

**Verify**, against the variables you recorded in Step 0:

- Worker: files `WORKER_FILES_BEFORE − 2`, tests `WORKER_TESTS_BEFORE − 49 + N_NEW`
- Python: passed `PY_PASS_BEFORE`, skipped `PY_SKIP_BEFORE`, and the failing
  test **names** identical to Step 0's list — still exactly the three
  `tests/test_backfill_judge_overrides_from_pdf.py` `pypdf` ImportErrors (or
  none, on an interpreter with a working `pypdf`)
- `make lint` → `All checks passed!`
- Frontend: `FE_FILES_BEFORE` / `FE_TESTS_BEFORE`, unchanged

## Test plan

This plan mostly **deletes** tests; the deleted tests all exercised modules that
no production code path can reach. It adds two small sets first, so nothing real
is lost.

- Added (Step 1A): `workers/__tests__/cloudflare-council-security-contracts.test.js`
  — the surviving auth/limit/leakage contracts, asserted against the **live**
  `workers/llm-council/cloudflare_handlers.js`. This is a prerequisite for the
  deletions, not a follow-up.
- Added (Step 4): two `tests/test_app_factory.py` cases pinning the post-removal
  backend selection under both env shapes (`HYPERDRIVE_DATABASE_URL` alone, and
  Supabase credentials + Hyperdrive URL together).
- Removed: `workers/__tests__/llm-council-handlers.test.js` (36 tests),
  `workers/__tests__/llm-council-storage.test.js` (7 tests),
  `workers/__tests__/auth-handlers-cloudflare.test.js` (6 tests) — 49 Worker
  tests total, 14% of the suite, all bound to unreachable modules.
- Removed: `TestCaptureHyperdriveUrl` in `tests/test_app_factory.py`
  (2 tests) — they asserted that a client-supplied header is copied into
  request state, which is the behaviour Step 3 removes.
- Retained and unchanged: `workers/__tests__/cloudflare-council-handlers.test.js`
  (8 tests against the live `llm-council/cloudflare_handlers.js`),
  `workers/__tests__/cloudflare-native-auth-handlers.test.js`,
  `workers/__tests__/auth-refresh-sessions.test.js`,
  `tests/test_supabase_repository.py`, `tests/test_security.py`.
- Regression gates that must stay green throughout:
  `node scripts/check_cloudflare_native_bundle.mjs` (bundle closure has no
  legacy DB markers) and
  `.venv/bin/python scripts/check_cloudflare_native_target.py` (deployable
  config shape).

Net expected suite movement, expressed only as deltas against your Step 0
baseline (see the "Delta rule"): Worker `−49 + N_NEW` tests across `−2` files;
Python passing unchanged (`−2` from Step 3, `+2` from Step 4), skips unchanged,
failures still exactly the same named three; frontend unchanged.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "llm-council/handlers\|llm-council/storage" workers/ scripts/ frontend/src wrangler.toml` → no output
- [ ] `grep -rn "auth/handlers\.js" workers/ scripts/ frontend/src wrangler.toml` → exactly one line, `workers/auth/cloudflare_handlers.js:4` (a prose comment)
- [ ] `grep -rn "X-Hyperdrive-Url\|_capture_hyperdrive_url" immi_case_downloader/ tests/` → no output
- [ ] `grep -rn "hyperdrive_repository\|HyperdriveRepository" immi_case_downloader/ scripts/ tests/ *.py` → no output
- [ ] `ls workers/auth/handlers.js workers/llm-council/handlers.js workers/llm-council/storage.js immi_case_downloader/hyperdrive_repository.py` → all four report "No such file or directory"
- [ ] `ls supabase/migrations | wc -l` → `18` (nothing under `supabase/` was moved or deleted)
- [ ] `test -f workers/__tests__/cloudflare-council-security-contracts.test.js`
- [ ] `npx vitest run --config workers/vitest.config.js __tests__/cloudflare-council-security-contracts.test.js` → all pass, and you have demonstrated at least two of them failing under a wrong expectation
- [ ] `make test-workers` → files `WORKER_FILES_BEFORE − 2`, tests `WORKER_TESTS_BEFORE − 49 + N_NEW`
- [ ] `.venv/bin/pytest tests/test_app_factory.py -q` → `8 passed, 1 skipped` (= `APP_FACTORY_BEFORE`)
- [ ] `make test-py` → passed `= PY_PASS_BEFORE`, skipped `= PY_SKIP_BEFORE`, and `make test-py 2>&1 | grep -E "^(FAILED|ERROR)" | sort -u` lists exactly the same test names as Step 0
- [ ] `cd frontend && npx vitest run` → `FE_FILES_BEFORE` / `FE_TESTS_BEFORE`, unchanged
- [ ] `make lint` → `All checks passed!`
- [ ] `node scripts/check_cloudflare_native_bundle.mjs` → exit 0
- [ ] `.venv/bin/python scripts/check_cloudflare_native_target.py` → exit 0
- [ ] `make migrate >/dev/null 2>&1; echo $?` → `2`
- [ ] `grep -cE '^\t[^@]*supabase' Makefile` → `0`
- [ ] `make help >/dev/null 2>&1; echo $?` → `0`
- [ ] `git status --short` lists only files from the "In scope" list (plus a possible pre-existing ` M .claude/STATE.md`)
- [ ] Nothing pushed, no PR opened (`git log origin/main..HEAD` shows local commits only)

## STOP conditions

Stop and report back (do not improvise) if:

- **The drift check is non-empty.** Any in-scope file changed since `42826a3`,
  so the line numbers and excerpts in "Current state" are unreliable.
- **A pre-deletion grep in Step 1, 2 or 4 shows a real importer.** If any
  non-test source file imports `workers/llm-council/handlers.js`,
  `workers/llm-council/storage.js`, `workers/auth/handlers.js`, or
  `immi_case_downloader/hyperdrive_repository.py`, the whole premise of this
  plan is wrong for that module. Delete nothing further and report which file.
- **`node scripts/check_cloudflare_native_bundle.mjs` fails at any point.**
  These deletions should only ever shrink the bundle closure. A failure means
  something unexpected is being pulled in — do not "fix" the gate.
- **`make test-py` reports a failing test whose name was not in your Step 0
  list.** Two tests should disappear (`TestCaptureHyperdriveUrl`), two should
  appear (Step 4), and nothing should start failing. A *new* failing name means
  something still depended on `g.hyperdrive_url` or `HyperdriveRepository`.
- **The Worker test delta is anything other than `−49 + N_NEW`.** The deletion
  arithmetic is exactly `36 + 7 + 6 = 49`. Any other delta means a test file you
  did not intend to remove was affected. Do **not** adjust the expected number
  to match what you got.
- **A Step 1A contract turns out not to be implemented by
  `workers/llm-council/cloudflare_handlers.js`.** Do not write a test that
  asserts the wrong behaviour, and do not "fix" the handler — that is another
  plan's territory. Report the missing contract and stop.
- **You are about to run any `supabase` CLI subcommand.** Never. `db push`
  targets whatever project the machine-local link points at, and this plan
  cannot verify that target.
- **You find yourself needing to edit `workers/auth/refresh_sessions.js`,
  `workers/auth/cloudflare_handlers.js`, `workers/llm-council/cloudflare_handlers.js`,
  `immi_case_downloader/supabase_repository.py`, `wrangler.toml`, or anything
  under `supabase/`** to make a step pass. All are out of this plan's file
  territory and are owned by other in-flight changes.
- **You are tempted to re-add a `migrate-legacy-supabase` (or similar) make
  target.** Step 5 explains why it was deliberately removed: no make target can
  verify which project the Supabase CLI is linked to, so a `CONFIRM=1` flag
  confirms intent without confirming target.

## Maintenance notes

For the human or agent who owns this code after the change lands.

**Deliberately deferred, in priority order** — each is a one-line follow-up
that this plan could not make because the file belongs to another in-flight
change:

1. `workers/llm-council/cloudflare_handlers.js:4-6` will be stale. It reads:
   *"The legacy handler module remains in place for the old Worker until
   cutover evidence permits retirement."* The legacy module is now gone;
   delete that sentence.
2. `workers/auth/cloudflare_handlers.js:4-6` will be stale. It reads:
   *"This is deliberately separate from auth/handlers.js so the native bundle
   cannot carry legacy Hyperdrive branch code."* Reword to drop the reference
   to the deleted file.
3. `workers/auth/refresh_sessions.js` — after Step 2, its three Postgres
   tagged-template helpers `insertRefreshSessionTx` (line 54),
   `revokeRefreshSessionTx` (line 61) and
   `loadActiveRefreshSessionForUpdateTx` (line 76, which uses a `FOR UPDATE`
   row lock D1 cannot provide) have **no** remaining production caller —
   `workers/auth/cloudflare_handlers.js:13-17` imports only
   `extractRefreshToken`, `generateRefreshSessionDraft` and
   `validateRefreshPayload`. Delete the three `*Tx` exports and the
   corresponding assertions in `workers/__tests__/auth-refresh-sessions.test.js`
   once that file is free.
4. `immi_case_downloader/supabase_repository.py:29-31` still reads
   `g.hyperdrive_url` first in `_get_hyperdrive_conn()`. After Step 3 nothing
   sets it, so the read is inert — but the docstring at lines 23-25 still says
   *"injected by proxy.js"*, a file deleted in `f91f45f`. Drop the `flask.g`
   branch and the corresponding
   `tests/test_supabase_repository.py::TestGetHyperdriveConn::test_returns_conn_via_flask_g`
   (lines 674-690) when that file is free.
5. **Blocking handoff, not an optional nicety** — `CLAUDE.md:25` and
   `AGENTS.md:25` both read
   `make migrate      # Push pending Supabase migrations (supabase db push)`.
   After Step 5 that instruction is not merely stale, it is **actively wrong**:
   it tells the next agent to run a command that now exits 1, and it describes a
   push this repository no longer offers. Both files are owned by
   `plans/042-rewrite-the-agent-facing-docs.md` (which quotes exactly that line),
   so this plan must not edit them. **State in your completion report that plan
   030 cannot ship to a shared branch until plan 042 corrects those two lines**,
   and give 042's owner the exact replacement text:
   `make migrate      # Prints where migrations live; production schema is Cloudflare D1`.
   The same handoff covers the wider problem the reviewer flagged: `AGENTS.md`
   still describes `proxy.js`, Hyperdrive, Postgres, RLS and "writes proxied to
   Flask" wholesale, which is the same wrong mental model this plan is deleting
   from the code.
6. `frontend/src/lib/api-llm-council.ts:12` says
   `// Types — mirror handlers.js JSON shapes`. Re-point it at
   `workers/llm-council/cloudflare_handlers.js`.
7. `AGENTS.md` (in particular lines 9, 136, 160-175, 186, 191, 222, 235) still
   describes the whole pre-cutover architecture — `proxy.js`,
   `workers/db/getSqlAsUser.js` (deleted in `f91f45f`), RLS, Hyperdrive pooling,
   and "writes proxied to Flask". It contradicts `CLAUDE.md` and
   `docs/ARCHITECTURE.md` wholesale. That is a documentation rewrite, not a
   side effect of this plan, but it is the largest remaining source of the same
   wrong mental model.

**What a reviewer should scrutinise in the PR**:

- That every deletion is a `git rm` of a *whole* file, with no partial edits
  smuggled into `workers/` beyond the four full-file removals.
- That the `immi_case_downloader/web/__init__.py` diff removes exactly two
  blocks (the `before_request` hook and the `HyperdriveRepository`
  sub-branch) and leaves the `SupabaseRepository`, `sqlite` and `csv` branches
  byte-identical apart from de-indentation.
- That the Makefile diff touches only lines 39 and 107-108, that every new
  recipe line begins with a TAB, and that **no** recipe line anywhere in the
  Makefile invokes the `supabase` CLI (`grep -cE '^\t[^@]*supabase' Makefile` → `0`).
- That the Worker test arithmetic is exactly `−49 + N_NEW` against the
  executor's own recorded baseline — not a fixed total.
- That Step 1A's new test file imports only
  `workers/llm-council/cloudflare_handlers.js`, never the deleted modules.
- That `tests/test_app_factory.py` ends at the same test count it started with.

**Coverage the deleted Worker tests provided** is now handled *inside* this plan
by Step 1A, not deferred — the earlier draft left it as a follow-up, which would
have meant deleting 49 tests and shipping a gap. What remains for the next owner
is consolidation: once both this plan and
`plans/004-fix-council-429-outage.md` have landed, the contracts will live in
two files (`cloudflare-council-security-contracts.test.js` and
`cloudflare-council-handlers.test.js`). Merging them into one is a tidy-up, and
the 429 case may be duplicated — check
`grep -c 429 workers/__tests__/cloudflare-council-*.test.js` and collapse.

**Follow-up unblocked by this plan**: `"freeze"` was one of four
`STORAGE_MODES` (`workers/storage/contracts.js:10`). After Steps 1-2 its only
two consumers (`workers/auth/handlers.js:47` and
`workers/llm-council/storage.js:51`) are gone, and `"legacy"` / `"shadow"` have
no consumers at all — so `STORAGE_MODES` can be reduced to `["cloudflare"]` by
whoever owns `workers/storage/contracts.js`. See "Findings reconsidered".

## Findings reconsidered

Items examined during planning that this plan deliberately does **not** do, so
nobody re-audits them from scratch.

- **`workers/extraction-container.js` is NOT dead — do not delete it.** An
  earlier reading of this cleanup listed it alongside the three dead modules.
  It is referenced by `workers/austlii-scraper/wrangler.toml:95-97`
  (`[[services]] binding = "EXTRACTION_BACKEND" / entrypoint = "ExtractionBackend"`),
  enforced by the fail-closed deploy gate at
  `scripts/check_cloudflare_native_target.py:193-194`, and read as source by
  `tests/test_extraction_container_boundary.py:27`. Deleting it breaks the
  preflight.

- **`workers/llm-council/storage.js` is not Supabase-era code.** It was
  described that way; its own header (lines 1-9, quoted in "Current state")
  says it is the Cloudflare-native D1/R2/Vectorize CRUD layer and that "Legacy
  PostgreSQL/Hyperdrive paths have been removed". It is deleted here purely
  because its only importer (`llm-council/handlers.js`) is being deleted.

- **The `X-Internal-Route` header check in `immi_case_downloader/web/auth.py`
  is deferred, and its line numbers were wrong.** The check is at
  `auth.py:102` (`return request.headers.get('X-Internal-Route') == 'worker'`),
  with the function defined at line 97 — not line 100 and not line 102 for the
  definition. In `require_auth` (line 118) the check runs *before* JWT
  verification, so spoofing the header grants nothing an attacker would not
  otherwise need a valid JWT for; it is a sole gate only in `optional_auth`
  (line 146), and only inside the local-dev-only Flask app. The real defect is
  the module docstring at `auth.py:10-11` claiming a protection that
  `CLAUDE.md` explicitly forbids re-introducing ("Do not re-introduce an
  `X-Internal-Route` / Flask-ingress-guard pattern"). Fixing it means deciding
  whether to delete `_is_internal_request()` outright or replace it with a
  shared-secret comparison — a judgment call about a non-production app, in a
  file outside this plan's territory. Deferred, not rejected.

- **`CUTOVER_WRITE_FREEZE` and the four `STORAGE_MODES` are deferred.** Verified:
  a repo-wide grep for `CUTOVER_WRITE_FREEZE` returns `wrangler.toml:93`,
  `scripts/verify_immi_separation.py` (lines 286, 292, 295, 300, 306),
  `tests/test_separation_preflight.py:74` and `docs/ARCHITECTURE.md` (134, 265)
  — no Worker module reads it, yet `verify_immi_separation.py:286-306`
  hard-fails activation on its declaration. Two qualifications matter:
  `docs/ARCHITECTURE.md:134` already labels it "(reserved)", so it is a
  documented placeholder rather than an unnoticed fossil, and `wrangler.toml:91`
  ships `IMMI_STORAGE_MODE = "cloudflare"`, so `getStorageMode`'s `"legacy"`
  default (`workers/storage/contracts.js:35`) only bites if an operator deletes
  that line. Every file involved is outside this plan's territory and
  `wrangler.toml` is owned by another in-flight change. This plan removes the
  blocker (the last `"freeze"` consumers) and hands the rest on — see
  "Maintenance notes".

- **`supabase/` is retained on purpose.** `docs/ARCHITECTURE.md:224-227`
  records the Supabase scripts and migrations as one-time ETL/migration
  tooling, not a live dependency. This plan gates the `make migrate` entry
  point rather than moving or deleting 16,234 lines. Whether `supabase/` should
  eventually join the existing `supabase/archive/migrations-pre-baseline-2026-05-12/`
  is a separate decision.

- **"Removing `HyperdriveRepository` is not a capability loss" — corrected; it
  is one, and Step 4 now says so.** The earlier draft argued that because
  `SupabaseRepository` still reads `HYPERDRIVE_DATABASE_URL`
  (`supabase_repository.py:17`, used at `:134-136`) for direct-`psycopg2`
  analytics, nothing is lost. Two things are lost, both verified in the code:
  (a) `SupabaseRepository.__init__` **raises** `ValueError` when
  `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are absent
  (`supabase_repository.py:88-94`), so `BACKEND=supabase` with only the
  Hyperdrive URL set goes from "works" to "refuses to start"; (b) full CRUD
  moves from direct PostgreSQL to the Supabase REST API — only analytics keeps
  the direct connection. The removal still stands (461 untested lines, a
  topology that no longer exists), but it is a documented breaking change with
  two pinning tests, not a no-op. The old verification
  (`python -c "from immi_case_downloader.web import create_app"`) could not have
  detected either consequence and has been replaced.

- **The `migrate-legacy-supabase CONFIRM=1` convenience target — removed, not
  softened.** `supabase db push` acts on the machine-local CLI link
  (`supabase/.temp/project-ref`, gitignored via `supabase/.gitignore`), which no
  make target can inspect. `CONFIRM=1` therefore confirms intent but never
  target, which is the wrong shape of guard for an irreversible remote schema
  push. Step 5 prints a four-step runbook (`projects list` → `link --project-ref`
  → `db diff --linked` → `db push --linked`) instead, and the plan now asserts
  that no Makefile recipe line invokes the CLI at all.

- **Line-number corrections made while verifying**: the `make migrate` recipe
  is at `Makefile:107-108`, not 106; its help line is at `Makefile:39`, not 41.
  `supabase/` holds **18** files under `supabase/migrations/` (41 `.sql` files
  in total across `migrations/` and the pre-existing `archive/`), not 41 under
  `migrations/`. `tests/test_supabase_repository.py`'s Flask-`g` precedence
  test is `test_returns_conn_via_flask_g` at lines 674-690, as claimed. The
  import in `workers/__tests__/auth-handlers-cloudflare.test.js` spans lines
  30-35, with `} from "../auth/handlers.js";` on line 35.

## Review points not applied

One sub-item of the external review was checked against the live code and does
**not** hold. It is recorded here so nobody re-raises it.

- **"The deleted tests assert that `hmac_sig` / token / retrieve code never
  appear in a response; port those contracts to the live handlers."** The
  `hmac_sig` half is not portable, and the blanket phrasing of the other half is
  wrong for this stack:

  - **`hmac_sig` does not exist in the Cloudflare-native path.** A repo-wide
    grep over `workers/` and `migrations/` returns four files, all of which this
    plan deletes or leaves untouched as dead:
    `workers/llm-council/handlers.js:449` (`delete session.hmac_sig;`),
    `workers/__tests__/llm-council-handlers.test.js:248,256,266,270,281` and
    `workers/__tests__/llm-council-storage.test.js:98-99`. There is **no**
    `hmac_sig` in `workers/llm-council/cloudflare_handlers.js`, in
    `workers/storage/cloudflare.js`, or in any D1 migration. A ported assertion
    that `hmac_sig` is absent from a live response would therefore pass
    unconditionally — a test that cannot fail is worse than no test, because it
    reads as coverage. Step 1A explicitly forbids writing it.
  - **`retrieve_code` and `session_token` are returned on purpose by two
    routes.** `cloudflare_handlers.js:200-201` (`handleCreateSession`) and
    `:304-305` (`handleRestoreByCode`) both include them in the response body,
    and the existing live test asserts exactly that
    (`workers/__tests__/cloudflare-council-handlers.test.js:117`:
    `expect(await response.json()).toMatchObject({ session_id: SESSION_ID, retrieve_code: "ABCDEF" })`).
    A blanket "never appears in a response" contract would assert the opposite
    of the shipped design.

  What **is** real, and what Step 1A ports instead, is the narrower contract the
  live code actually implements: `normalizeSessionResponse()` strips
  `retrieve_code` from the session row before responding
  (`cloudflare_handlers.js:153-155`), so the get and list paths must not carry
  it. The rest of the review's Q3.1 list — 401 per route, 400 on a malformed
  retrieve code, 404 on session-not-found, 409 at the 15-turn cap — was verified
  against `cloudflare_handlers.js:171`, `:206`, `:214`, `:219`, `:220`, `:298`
  and is ported in full.
