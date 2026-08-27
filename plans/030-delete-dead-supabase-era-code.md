# Plan 030: Delete the pre-cutover Supabase/Hyperdrive modules that production no longer loads

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. There is no `plans/README.md` in this repository
> at the time of writing; if one exists when you finish, update this plan's
> status row in it, otherwise skip that.
>
> **Drift check (run first)**:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
> git diff --stat 42826a3..HEAD -- \
>   workers/auth/handlers.js \
>   workers/llm-council/handlers.js \
>   workers/llm-council/storage.js \
>   workers/__tests__/auth-handlers-cloudflare.test.js \
>   workers/__tests__/llm-council-handlers.test.js \
>   workers/__tests__/llm-council-storage.test.js \
>   immi_case_downloader/hyperdrive_repository.py \
>   immi_case_downloader/web/__init__.py \
>   tests/test_app_factory.py \
>   Makefile
> ```
>
> Expected: **no output** (nothing has changed since this plan was written).
> If any in-scope file changed, compare the "Current state" excerpts below
> against the live code before proceeding; on a mismatch, treat it as a STOP
> condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `42826a3`, 2026-08-27

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
| Worker tests | `make test-workers` | before: `25 passed (25)` files / `345 passed (345)` tests; after this plan: `22 passed (22)` / `296 passed (296)` |
| Python unit tests | `make test-py` | at HEAD `42826a3`: `1141 passed, 3 failed, 7 skipped`. The 3 failures are **environmental** (Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch breaks the `pypdf` import in `tests/test_backfill_judge_overrides_from_pdf.py`) and are not caused by repo code. On an interpreter with working `pypdf` the baseline is `1144 passed, 7 skipped`. |
| One Python test file | `.venv/bin/python -m pytest tests/test_app_factory.py -q` | `8 passed, 1 skipped` before; `6 passed, 1 skipped` after |
| Python lint | `make lint` | `All checks passed!` |
| Frontend tests | `cd frontend && npx vitest run` | `490 passed`, 55 files (unchanged by this plan) |
| Worker bundle closure gate | `node scripts/check_cloudflare_native_bundle.mjs` | `Cloudflare-native bundle closure passed (<N> bytes): /tmp/...`, exit 0 |
| Native config gate | `.venv/bin/python scripts/check_cloudflare_native_target.py` | exit 0 |
| Changed-file check | `git status --short` | only files from the In-scope list |

## Scope

**In scope** (the only files you may modify or delete):

- `workers/llm-council/handlers.js` — **delete** (Step 1)
- `workers/llm-council/storage.js` — **delete** (Step 1)
- `workers/__tests__/llm-council-handlers.test.js` — **delete** (Step 1)
- `workers/__tests__/llm-council-storage.test.js` — **delete** (Step 1)
- `workers/auth/handlers.js` — **delete** (Step 2)
- `workers/__tests__/auth-handlers-cloudflare.test.js` — **delete** (Step 2)
- `immi_case_downloader/web/__init__.py` — remove the `_capture_hyperdrive_url`
  hook (Step 3) and the `HyperdriveRepository` sub-branch (Step 4)
- `immi_case_downloader/hyperdrive_repository.py` — **delete** (Step 4)
- `tests/test_app_factory.py` — remove `TestCaptureHyperdriveUrl` and fix the
  module docstring (Step 3)
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
- **Never run `make migrate-legacy-supabase CONFIRM=1`.** Step 5 creates that
  target; running it would push schema to a real remote database.
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
make test-py 2>&1 | tail -3
```

Write both result lines down. At HEAD `42826a3` they are
`Test Files 25 passed (25)` / `Tests 345 passed (345)` and
`1141 passed, 3 failed, 7 skipped`.

**Verify**: `git status --short` → shows no modifications you introduced
(a pre-existing ` M .claude/STATE.md` may be present; leave it alone).

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
2. `make test-workers 2>&1 | tail -4` → `Test Files 23 passed (23)`, `Tests 302 passed (302)` (43 fewer tests: 36 + 7).
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
2. `make test-workers 2>&1 | tail -4` → `Test Files 22 passed (22)`, `Tests 296 passed (296)`.
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
2. `.venv/bin/python -m pytest tests/test_app_factory.py -q 2>&1 | tail -3` → `6 passed, 1 skipped`.
3. `.venv/bin/python -m pytest tests/test_supabase_repository.py tests/test_security.py -q 2>&1 | tail -3` → all pass, no new failures.
4. `make lint` → `All checks passed!`

### Step 4: Delete the unreachable `HyperdriveRepository` backend

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

This is not a capability loss worth worrying about: `SupabaseRepository` still
reads `HYPERDRIVE_DATABASE_URL` itself
(`immi_case_downloader/supabase_repository.py:17` and `:134-136`) to accelerate
analytics through a direct `psycopg2` connection, so setting that env var keeps
working — it just no longer swaps in a whole second repository implementation.

Then delete the module:

```bash
git rm immi_case_downloader/hyperdrive_repository.py
```

**Verify**:

1. `grep -rn "hyperdrive_repository\|HyperdriveRepository" immi_case_downloader/ scripts/ tests/ *.py` → **no output** (exit 1).
2. `.venv/bin/python -c "from immi_case_downloader.web import create_app; print('ok')"` → prints `ok`.
3. `.venv/bin/python -m pytest tests/test_app_factory.py -q 2>&1 | tail -3` → `6 passed, 1 skipped`.
4. `make lint` → `All checks passed!`
5. `make test-py 2>&1 | tail -3` → `1139 passed, 3 failed, 7 skipped` — i.e. **exactly 2 fewer passing than your Step 0 baseline, with the failure count unchanged**. If the failure count went up, **STOP**.

### Step 5: Make `make migrate` refuse to push to the retired Supabase project

In `Makefile`, replace lines 107-108:

```make
migrate:
	supabase db push
```

with (every recipe line below must start with a literal **TAB**, and the
`$(CONFIRM)` reference must keep its `$(...)` form so make expands it):

```make
# `supabase db push` targets the RETIRED Supabase Postgres project. Production
# schema lives in Cloudflare D1 (migrations/d1/{catalog,account,ops}/*.sql).
# The Supabase migrations are kept as one-time ETL tooling (docs/ARCHITECTURE.md),
# so the push is gated rather than removed.
migrate:
	@echo "REFUSING: 'supabase db push' targets the RETIRED Supabase Postgres project."
	@echo "Production schema lives in Cloudflare D1:"
	@echo "  migrations/d1/catalog/*.sql  migrations/d1/account/*.sql  migrations/d1/ops/*.sql"
	@echo "Apply those with wrangler against the operator-supplied D1 database ids."
	@echo "To push to the legacy Supabase project anyway (one-time ETL tooling only):"
	@echo "  make migrate-legacy-supabase CONFIRM=1"
	@exit 1

migrate-legacy-supabase:
	@if [ "$(CONFIRM)" != "1" ]; then \
	  echo "REFUSING: this pushes schema to the retired Supabase Postgres project."; \
	  echo "Re-run as: make migrate-legacy-supabase CONFIRM=1"; \
	  exit 1; \
	fi
	supabase db push
```

Then update the help line at `Makefile:39` from:

```make
	@echo "  make migrate      Push pending Supabase migrations"
```

to:

```make
	@echo "  make migrate      Where migrations live (legacy Supabase push is gated)"
```

Change nothing else in the Makefile.

**Verify**:

1. `make migrate >/tmp/immi-migrate.txt 2>&1; echo "exit=$?"` → `exit=2`
   (GNU Make 3.81 reports 2 when a recipe fails), and
   `grep -c "REFUSING" /tmp/immi-migrate.txt` → `1`.
2. `make migrate-legacy-supabase >/tmp/immi-migrate2.txt 2>&1; echo "exit=$?"` → `exit=2`, and
   `grep -c "Re-run as" /tmp/immi-migrate2.txt` → `1`.
   **Do not run it with `CONFIRM=1`.**
3. `make help >/dev/null 2>&1; echo "exit=$?"` → `exit=0`.
4. `make lint` → `All checks passed!` and `make test-py 2>&1 | tail -3` →
   unchanged from Step 4.

### Step 6: Final full verification

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-workers 2>&1 | tail -4
make test-py 2>&1 | tail -3
make lint
cd frontend && npx vitest run 2>&1 | tail -4
```

**Verify**: `22 passed (22)` files / `296 passed (296)` Worker tests;
`1139 passed, 3 failed, 7 skipped` Python (2 fewer passing than Step 0, same
failures); `All checks passed!`; `490 passed` frontend tests across 55 files.

## Test plan

This plan **deletes** tests rather than adding them; the deleted tests all
exercised modules that no production code path can reach.

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

Net expected suite movement: Worker `345 → 296`; Python `1141 → 1139` passing
(same 3 environmental failures, same 7 skips); frontend unchanged at 490.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn "llm-council/handlers\|llm-council/storage" workers/ scripts/ frontend/src wrangler.toml` → no output
- [ ] `grep -rn "auth/handlers\.js" workers/ scripts/ frontend/src wrangler.toml` → exactly one line, `workers/auth/cloudflare_handlers.js:4` (a prose comment)
- [ ] `grep -rn "X-Hyperdrive-Url\|_capture_hyperdrive_url" immi_case_downloader/ tests/` → no output
- [ ] `grep -rn "hyperdrive_repository\|HyperdriveRepository" immi_case_downloader/ scripts/ tests/ *.py` → no output
- [ ] `ls workers/auth/handlers.js workers/llm-council/handlers.js workers/llm-council/storage.js immi_case_downloader/hyperdrive_repository.py` → all four report "No such file or directory"
- [ ] `ls supabase/migrations | wc -l` → `18` (nothing under `supabase/` was moved or deleted)
- [ ] `make test-workers` → `Test Files 22 passed (22)`, `Tests 296 passed (296)`
- [ ] `make test-py` → `1139 passed, 3 failed, 7 skipped` (2 fewer passing than the Step 0 baseline; failure count unchanged)
- [ ] `cd frontend && npx vitest run` → `490 passed`, 55 files
- [ ] `make lint` → `All checks passed!`
- [ ] `node scripts/check_cloudflare_native_bundle.mjs` → exit 0
- [ ] `.venv/bin/python scripts/check_cloudflare_native_target.py` → exit 0
- [ ] `make migrate >/dev/null 2>&1; echo $?` → `2`
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
- **`make test-py` failure count rises above your Step 0 baseline.** Two tests
  should disappear (`TestCaptureHyperdriveUrl`) and nothing should start
  failing. A *new* failure means something still depended on
  `g.hyperdrive_url` or `HyperdriveRepository`.
- **`make test-workers` reports fewer than 296 tests, or any failure.** The
  expected arithmetic is exactly `345 − 36 − 7 − 6 = 296`. Any other number
  means a test file you did not intend to remove was affected.
- **You find yourself needing to edit `workers/auth/refresh_sessions.js`,
  `workers/auth/cloudflare_handlers.js`, `workers/llm-council/cloudflare_handlers.js`,
  `immi_case_downloader/supabase_repository.py`, `wrangler.toml`, or anything
  under `supabase/`** to make a step pass. All are out of this plan's file
  territory and are owned by other in-flight changes.
- **`make migrate-legacy-supabase CONFIRM=1` is about to run.** Never run it —
  it pushes schema to a live remote database.

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
5. `CLAUDE.md:25` documents `make migrate      # Push pending Supabase migrations (supabase db push)`.
   After Step 5 that is wrong; replace with a line pointing at
   `migrations/d1/{catalog,account,ops}/*.sql` and noting the legacy push is
   gated behind `make migrate-legacy-supabase CONFIRM=1`.
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
- That the Makefile diff touches only lines 39 and 107-108 and that every new
  recipe line begins with a TAB.
- That the Worker test arithmetic is exactly `345 − 49 = 296`.

**Coverage the deleted Worker tests provided that the live suite may not** —
worth auditing in a follow-up that owns
`workers/__tests__/cloudflare-council-handlers.test.js` (8 tests today, versus
the 36 just removed). Check whether the live suite asserts, against
`workers/llm-council/cloudflare_handlers.js`: 401 on a missing/invalid/expired
Bearer token for each Council route; 400 on a missing message and on a
6-character-check failure for a retrieve code (`cloudflare_handlers.js:298`);
404 on session-not-found (`:219`, `:253`, `:262`, `:286`, `:301`); 409 at the
15-turn cap (`:220`); 429 when rate-limited (`:174`, `:212`, `:295`, `:313`,
`:339`); and that `hmac_sig` / `session_token` / `retrieve_code` never appear
in list or get response bodies. Port only the cases genuinely missing — do not
re-import the deleted file.

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

- **The `HYPERDRIVE_DATABASE_URL` env branch was described as still usable in
  local dev, so removing it is narrower than "delete the branch".** That is
  correct about the *env var* but not about the *repository class*: Step 4
  deletes only `HyperdriveRepository` and its selection, while
  `SupabaseRepository` keeps reading `HYPERDRIVE_DATABASE_URL` at
  `supabase_repository.py:17` and using it at `:134-136` for direct-`psycopg2`
  analytics. A developer who sets that env var still gets the direct-Postgres
  analytics path; they just no longer get a second, untested, 461-line
  repository implementation swapped in underneath them.

- **Line-number corrections made while verifying**: the `make migrate` recipe
  is at `Makefile:107-108`, not 106; its help line is at `Makefile:39`, not 41.
  `supabase/` holds **18** files under `supabase/migrations/` (41 `.sql` files
  in total across `migrations/` and the pre-existing `archive/`), not 41 under
  `migrations/`. `tests/test_supabase_repository.py`'s Flask-`g` precedence
  test is `test_returns_conn_via_flask_g` at lines 674-690, as claimed. The
  import in `workers/__tests__/auth-handlers-cloudflare.test.js` spans lines
  30-35, with `} from "../auth/handlers.js";` on line 35.
