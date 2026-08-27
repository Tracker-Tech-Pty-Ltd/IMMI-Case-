# Plan 002: Collect every test that exists and make a fresh clone installable

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: four commands, not one. A committed-history diff
> cannot see uncommitted, staged or untracked work, so an executor starting
> from a dirty tree would otherwise get a false all-clear.
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> IN_SCOPE=(
>   Makefile pytest.ini requirements-test.txt requirements-e2e.txt
>   frontend/vitest.config.ts workers/vitest.config.js
>   .github/workflows/ci.yml
> )
> git status --short --branch
> git diff --stat 42826a3..HEAD -- "${IN_SCOPE[@]}"   # committed since planning
> git diff --stat -- "${IN_SCOPE[@]}"                  # unstaged
> git diff --cached --stat -- "${IN_SCOPE[@]}"         # staged
> ```
>
> Any in-scope path that appears as **unstaged, staged or untracked (`??`)** is
> a STOP condition regardless of what the committed-history diff says — it means
> someone else is mid-edit in your territory. Never `git checkout --`,
> `git restore`, `git stash` or `git clean` a path you did not create; report
> instead.
>
> **Expected in the committed-history diff**: `Makefile`, `.github/workflows/ci.yml` and
> `frontend/vitest.config.ts` **will** appear in that diff if
> `plans/001-restore-the-frontend-compile-gate.md` has already landed. That is
> normal and expected — plan 001 is a hard dependency of this one (see
> "Depends on") and it edits those three files. Section
> "What plan 001 changes before you start" below lists exactly what it changes
> so you can tell an expected difference from real drift.
>
> `pytest.ini`, `requirements-test.txt` and `workers/vitest.config.js` must be
> **unchanged** since `42826a3`. If either of those shows a diff, or if the
> Makefile / ci.yml differences go beyond what plan 001 is documented to do,
> compare the "Current state" excerpts against the live files before
> proceeding; on a mismatch, treat it as a STOP condition.
>
> **Every edit in this plan is anchored on unique text, never on a line
> number.** Re-read the file with `Read` immediately before each edit. Line
> numbers in "Current state" are the ones observed at `42826a3` and will have
> shifted if plan 001 landed.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md` — a **hard,
  integrated** dependency. Cut this plan's branch from the tip that already has
  001 merged, not from `main`.
- **Blocks**: `plans/003-lint-the-test-suite.md`. **001 → 002 → 003 is strictly
  serial and must not be run in parallel**: all three edit `Makefile`, two edit
  `.github/workflows/ci.yml`, and 001 and 002 both edit
  `frontend/vitest.config.ts` (001 owns the `coverage` block's shape; this plan
  owns re-measuring its thresholds after Step 1 — see Step 1a).
- **Category**: tests
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

A green local test run currently proves less than it looks like it proves.
28 frontend tests covering `frontend/src/lib/saved-searches.ts` — the
localStorage CRUD and shareable-URL encoding behind the Cases page, the saved
search panel, the sidebar and the mobile nav — sit in the tree looking like
coverage while no Vitest config collects them. Seven more test files and a
whole TypeScript gate for the production case-ingestion Worker
(`workers/austlii-scraper/`) run only in CI, and a clean checkout cannot even
run them locally because nothing ever installs that package's dependencies. On
top of that, `make install` — the first documented command on a fresh clone —
never creates the `.venv` that `make test-py`, `make lint` and `make coverage`
all assume, so it either pip-installs pandas/numpy/lxml/psycopg2 into the
user's global Python or hard-fails under PEP 668.

After this plan there is one command, `make check`, whose green result means
"CI will pass"; every test file that exists on disk is collected by some
config, and a machine-checked guard fails the moment that stops being true;
and `make install` on a fresh clone produces a working virtualenv without
touching global Python.

## Current state

### Files this plan changes, and their role

| File | Role |
|---|---|
| `Makefile` | All developer entry points. `test:` covers three of the four test suites; `install:` never creates a venv; `test-e2e:` fails with an unactionable import error. |
| `frontend/vitest.config.ts` | Vitest config for the React SPA. Its `include` glob is anchored at `frontend/__tests__/` only. |
| `pytest.ini` | Forces `-v --cov --cov-report=term-missing` onto every pytest invocation, including single-file runs and CI. |
| `.github/workflows/ci.yml` | Three jobs: `test-python`, `test-frontend`, `test-worker`. No pip cache; Python pinned to a single version two minors behind local dev. |
| `requirements-e2e.txt` | **Does not exist yet.** You create it in Step 7. |
| `workers/vitest.config.js` | Read-only for this plan — see "Findings reconsidered". |

### What plan 001 changes before you start

`plans/001-restore-the-frontend-compile-gate.md` runs first and edits three
files this plan also touches. Expect to find these already applied. Do **not**
re-apply or revert them:

- `Makefile` — `typecheck:` recipe becomes `npx tsc -b --noEmit`; `lint:`
  becomes `lint: lint-py lint-fe` with new `lint-py:` and `lint-fe:` targets;
  a `coverage-fe:` target is added after `test-workers:`; the `.PHONY` line is
  rewritten; three `@echo` help lines change (`make coverage`, `make lint`,
  `make typecheck`).
- `.github/workflows/ci.yml` — the `test-frontend` job gains an ESLint step, a
  `build:cloudflare` step, a `git diff --exit-code` assertion on the generated
  design tokens, a `tsconfig.json` references-identity assertion, and its Vitest
  step becomes `npx vitest run --coverage`.
- `frontend/vitest.config.ts` — the `coverage: { ... }` block is rewritten:
  the four flat `80`s move under a nested `thresholds: { ... }` key,
  `include: ["src/**/*.{ts,tsx}"]` is added (without it Vitest 4 counts only
  files some test imported), and `exclude` is rewritten to cover both test
  roots.

**Only one of those overlaps with the edits in this plan, and the overlap is
deliberate**: Step 1 of this plan widens the Vitest `include` glob, which
executes `frontend/src/lib/saved-searches.ts` for the first time and therefore
moves the coverage numbers that 001's ratchet was pinned to. **Step 1a of this
plan owns re-measuring those four threshold numbers.** That is the single
exception to "001 owns the coverage block"; everything else in it — `provider`,
`reporter`, `include`, `exclude`, the nested shape — stays exactly as 001 left
it.

Otherwise this plan does not touch `lint:`, `lint-py:`, `lint-fe:`,
`typecheck:`, `coverage-fe:`, or the `test-frontend` job.

### `frontend/vitest.config.ts` (verbatim, lines 5–28 at `42826a3`)

```ts
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./__tests__/legislations-setup.ts"],
    include: ["__tests__/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "./__tests__/", "**/*.config.*", "**/*.d.ts"],
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

Line 11 is the defect: `include: ["__tests__/**/*.{test,spec}.{ts,tsx}"]`.
Vitest resolves it against `root`, which is `frontend/`, so it matches
`frontend/__tests__/**` and nothing else.

The one file this misses today (verified — it is the *only* test file under
`frontend/src/`):

```
frontend/src/lib/__tests__/saved-searches.test.ts   332 lines, 28 `it()` blocks
frontend/src/lib/saved-searches.ts                  305 lines (the code under test)
```

Its first two cases, `frontend/src/lib/__tests__/saved-searches.test.ts:42-52`,
are exactly the crash-on-load paths:

```ts
    it("returns empty array for corrupted JSON", () => {
      localStorageMock.setItem("saved-searches", "invalid json{{{");
      const result = loadSavedSearches();
      expect(result).toEqual([]);
    });

    it("returns empty array for non-array data", () => {
      localStorageMock.setItem("saved-searches", JSON.stringify({ foo: "bar" }));
      const result = loadSavedSearches();
      expect(result).toEqual([]);
    });
```

**Measured, not assumed**: with the widened glob, all 28 pass and the suite
gains **exactly +1 test file and +28 tests**. Verified on 2026-08-27 by running
Vitest against a copy of this config with the widened `include`; at that commit
the totals moved 55 → 56 files and 490 → 518 tests. Assert on the **delta**,
not on `56`/`518`: those absolutes break the moment any sibling plan adds a
frontend test, and an executor who "fixes" a failing check by editing the
expected total has broken the gate rather than the code. Capture `BEFORE` in
the baseline step and require `AFTER == BEFORE + 1` files / `BEFORE + 28`
tests.

You should expect a clean green run, not new failures.

### `Makefile` (verbatim, lines 1–16 at `42826a3`)

```make
# IMMI-Case Makefile — common development commands
# Usage: make <target>

.PHONY: help dev build test test-py test-fe test-workers test-e2e lint typecheck audit-rls-guards clean

# ── Defaults ──────────────────────────────────────────────────────────────────

PORT   ?= 8080
BACKEND ?= auto

# Resolve repo root from make's working directory. GNU Make 3.81 treats spaces
# in MAKEFILE_LIST as word separators, so deriving this from abspath/lastword
# breaks under "Active Projects" paths.
REPO_ROOT := $(CURDIR)
VENV_PYTHON := $(REPO_ROOT)/.venv/bin/python
PYTHON ?= $(if $(wildcard $(VENV_PYTHON)),$(VENV_PYTHON),python3)
```

`Makefile:16` is the DX-03 defect: when `.venv` is absent — precisely the
fresh-clone case — `$(PYTHON)` silently becomes bare `python3`.

### `Makefile` (verbatim, lines 60–105 at `42826a3`)

```make
# ── Testing ───────────────────────────────────────────────────────────────────

test: test-py test-fe test-workers

test-py:
	"$(PYTHON)" -m pytest tests/ --ignore=tests/e2e -q

test-fe:
	cd "$(REPO_ROOT)/frontend" && npx vitest run

test-workers:
	cd "$(REPO_ROOT)/workers" && npx vitest run

# AC4 safety guard: reject any set_config call without transaction-local flag (true).
# A literal `false` or missing third argument leaks JWT claims across pooled connections.
audit-rls-guards:
	@echo "Checking set_config calls for transaction-local flag..."
	@BAD=$$(grep -rn "set_config(" "$(REPO_ROOT)/workers" --include="*.js" | grep -v "set_config('request.jwt.claims'.*true)" || true); \
	if [ -n "$$BAD" ]; then \
	  echo "ERROR: set_config without transaction-local=true (cross-tenant leak risk):"; \
	  echo "$$BAD"; exit 1; \
	else echo "OK: all set_config calls verified with transaction-local=true"; fi

test-e2e:
	"$(PYTHON)" -m pytest tests/e2e/ -v --timeout=60

coverage:
	"$(PYTHON)" -m pytest tests/ --ignore=tests/e2e --cov=immi_case_downloader --cov-report=html -q
	@echo "Report: htmlcov/index.html"

# ── Code Quality ──────────────────────────────────────────────────────────────

lint:
	"$(PYTHON)" -m ruff check immi_case_downloader/ scripts/ *.py

typecheck:
	cd "$(REPO_ROOT)/frontend" && npx tsc --noEmit

# ── Setup ─────────────────────────────────────────────────────────────────────

install:
	"$(PYTHON)" -m pip install -r requirements-app.txt -r requirements-test.txt
	# Root deps hold vitest + wrangler; workers/ has no package.json of its own,
	# so test-workers resolves against the root node_modules.
	npm install
	cd "$(REPO_ROOT)/frontend" && npm install
```

Note: the comment about `workers/` having no `package.json` is **accurate** —
verified: `workers/node_modules` exists but is empty (0 entries), and
`cd workers && npx vitest run` resolves against the root `node_modules`. Do not
"fix" that comment.

### `Makefile` help block (verbatim, lines 20–41 at `42826a3`)

```make
help:
	@echo "IMMI-Case development commands:"
	@echo ""
	@echo "  make dev          Run Flask API + Vite dev server (two tabs needed)"
	@echo "  make api          Flask API only  (http://localhost:$(PORT))"
	@echo "  make ui           Vite dev server only (http://localhost:5173)"
	@echo "  make build        Build React frontend → static/react/"
	@echo ""
	@echo "  make test         All tests (Python unit + frontend Vitest)"
	@echo "  make test-py      Python unit tests only (pytest, no E2E)"
	@echo "  make test-fe      Frontend Vitest tests only"
	@echo "  make test-e2e     Playwright E2E tests (requires running server)"
	@echo "  make coverage     Python unit tests with HTML coverage report"
	@echo ""
	@echo "  make lint         Ruff lint Python source"
	@echo "  make typecheck    TypeScript type check (tsc --noEmit)"
	@echo "  make clean        Remove build artifacts"
	@echo ""
	@echo "  make install      Install all Python + Node dependencies"
	@echo "  make migrate      Push pending Supabase migrations"
	@echo ""
	@echo "Options: PORT=8080 BACKEND=auto|sqlite|csv|supabase"
```

Note the help block never mentions `make test-workers`, which already exists.

### The pipeline Worker suite that no `make` target runs

`workers/austlii-scraper/` is a **separate npm package** with its own manifest,
lockfile, `node_modules`, Vitest config and TypeScript gate.

`workers/austlii-scraper/package.json:9-10` (verbatim):

```json
    "typecheck": "tsc --noEmit",
    "test": "vitest run --config vitest.config.ts",
```

Its seven test files live at `workers/austlii-scraper/src/__tests__/`:
`discover.test.ts`, `extract-native.test.ts`, `legislation.test.ts`,
`pipeline-config.test.ts`, `pipeline-control.test.ts`,
`pipeline-db-outbox.test.ts`, `pipeline-scrape.test.ts` — **7 files, 28 tests,
all passing today** (verified by running `npm test` there on 2026-08-27).

`workers/vitest.config.js:7-13` (verbatim) cannot reach them — wrong directory
*and* wrong extension:

```js
export default defineConfig({
  root: __dirname,
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.js"],
    globals: false,
  },
});
```

`.github/workflows/ci.yml:96-106` is the only place they are installed,
typechecked and run (verbatim):

```yaml
      - name: Install native pipeline dependencies
        run: npm ci --ignore-scripts
        working-directory: workers/austlii-scraper

      - name: Typecheck native pipeline
        run: npm run typecheck
        working-directory: workers/austlii-scraper

      - name: Run native pipeline tests
        run: npm test
        working-directory: workers/austlii-scraper
```

### `pytest.ini` (verbatim, whole file at `42826a3`)

```ini
[pytest]
testpaths = tests
addopts = -v --cov=immi_case_downloader --cov-report=term-missing
asyncio_mode = auto
asyncio_default_fixture_loop_scope = function
filterwarnings =
    ignore::pytest.PytestDeprecationWarning:pytest_asyncio
    ignore:.*asyncio.iscoroutinefunction.*:DeprecationWarning:pytest_asyncio
    ignore:.*asyncio.get_event_loop_policy.*:DeprecationWarning:pytest_asyncio
```

Measured effect of the `addopts` line (verified 2026-08-27):

- Single-file run (the documented inner loop at `CLAUDE.md:28`,
  `python3 -m pytest tests/test_models.py -x`): **5.22s → 1.44s** without
  coverage. 3.6× on the tightest feedback loop.
- Full suite: **no meaningful difference** (243s with coverage vs 259s
  without — inside run-to-run variance; the suite is I/O-bound, not
  trace-bound). Do not claim a full-suite speedup.
- `-v` in `addopts` fights the `-q` that `make test-py` and CI both pass.
  Verified: with the current `addopts`, `pytest -q` still prints the full
  `test session starts` banner, `platform`, `rootdir`, `configfile`,
  `plugins` and `collected N items`. With `addopts` cleared it is genuinely
  quiet.
- `make coverage` (`Makefile:87`) already passes
  `--cov=immi_case_downloader --cov-report=html` explicitly, so removing the
  global default costs the only caller that wants coverage nothing.

### `.github/workflows/ci.yml` (verbatim, lines 17–29 at `42826a3`)

```yaml
  test-python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install Python dependencies
        run: |
          python3 -m venv .venv
          .venv/bin/pip install --quiet -r requirements-app.txt -r requirements-test.txt
```

No `cache:` key, so every push and PR reinstalls `pandas` (`requirements-app.txt:8`),
`numpy` (`:17`), `lxml` (`:7`), `Pillow` (`:18`), `psycopg2-binary` (`:14`) and
`supabase` (`:13`) from cold. The two Node jobs both already use `cache: "npm"`.

CI pins `3.12`; the local `.venv` is Python **3.14.7** and `README.md:105`
records the supported range as `Python | 3.11+ | 3.14 已驗證可用`. `3.12` is not
arbitrary — `Dockerfile:4` is `FROM python:3.12-slim`, so 3.12 must stay
covered.

`.github/workflows/ci.yml:76-79` (verbatim), the `test-worker` job's Node setup:

```yaml
      - uses: actions/setup-node@v5
        with:
          node-version: "22"
          cache: "npm"
```

No `cache-dependency-path`, so it keys on the root lockfile only while a second
`npm ci --ignore-scripts` runs in `workers/austlii-scraper` at line 97.

### The opt-in integration suite

`.github/workflows/ci.yml:44` passes `--ignore=tests/integration`;
`Makefile:65` does not. `tests/integration/test_revoke_member.py:32-36`
(verbatim):

```python
if not DB_URL or not JWT_SECRET:
    pytest.skip(
        "SUPABASE_DB_URL and JWT_SECRET_CURRENT are required for revoke-member integration",
        allow_module_level=True,
    )
```

It self-skips today, so this is latent, not live. `tests/integration/README.md:10-11`
names its infrastructure as `Supabase service-role connection` and
`Supabase + running Flask/Worker`, and the directory's other artifact is
`rls_isolation.sql` — Postgres RLS, which production no longer has. **Do not
delete this suite**: retiring it is an operator decision about auth acceptance
criteria, not a mechanical cleanup. This plan only makes local and CI collect
the same set.

Measured (verified 2026-08-27), so you know the exact expected numbers:

- `pytest tests/ --ignore=tests/e2e -q` → `3 failed, 1141 passed, 7 skipped`
- `pytest tests/ --ignore=tests/e2e --ignore=tests/integration -q` →
  `3 failed, 1141 passed, 6 skipped`

The skip count drops by exactly 1 (the module-level skip). Passes and failures
are unchanged.

### The 3 pre-existing Python failures are environmental — do not try to fix them

`make test-py` reports **3 failed** at `42826a3` and will still report 3 failed
when you are done. All three are in
`tests/test_backfill_judge_overrides_from_pdf.py` and all three are the same
root cause — the Homebrew Python 3.14.7 that this repo's `.venv` was built on
has a `pyexpat` extension linked against a newer libexpat than
`/usr/lib/libexpat.1.dylib`:

```
E   ImportError: dlopen(.../lib-dynload/pyexpat.cpython-314-darwin.so, 0x0002):
    Symbol not found: _XML_SetAllocTrackerActivationThreshold
```

This is a machine problem, not a repo problem. It is out of scope. Treat
"3 failed, 1141 passed" as the passing baseline.

### KNOWN LOCAL DEFECT — `pip` is broken inside this repo's `.venv`

Verified 2026-08-27, and it constrains how Step 7 can be verified. The same
`pyexpat` ABI mismatch breaks `pip` itself, because `pip` imports
`xml.parsers.expat` transitively:

```
$ .venv/bin/pip --version
pip 26.1.1 from .../.venv/lib/python3.14/site-packages/pip (python 3.14)

$ .venv/bin/pip download pytest-playwright --no-deps -d /tmp/wheels
ImportError: dlopen(.../pyexpat.cpython-314-darwin.so, 0x0002):
  Symbol not found: _XML_SetAllocTrackerActivationThreshold
```

So **you cannot run a live `pip install` on this machine**. Step 4 and Step 7
are therefore verified by dry-run (`make -n`) plus a scratch-directory test of
the venv-creation branch, not by a live install. That is deliberate; do not
substitute a live install and do not try to repair the interpreter.

For the record, the fix that Step 4 introduces is already proven to produce a
*working* environment. Verified against a scratch directory:

```
$ python3 -m venv /tmp/scratch/.venv
$ /tmp/scratch/.venv/bin/python -c "import xml.parsers.expat; print('expat OK')"
expat OK
$ /tmp/scratch/.venv/bin/python -VV
Python 3.14.0 (v3.14.0:ebf955df7a8, Oct  7 2025, ...)   # python.org build, not Homebrew
$ /tmp/scratch/.venv/bin/pip download pytest-playwright --no-deps -d /tmp/wheels
Successfully downloaded pytest-playwright
```

`python3` on this machine resolves to
`/Library/Frameworks/Python.framework/Versions/3.14/bin/python3` (3.14.0,
python.org), whose `pyexpat` is fine.

### The Python E2E suite cannot even be collected

`grep -in playwright requirements*.txt` matches **nothing** in any of the four
requirements files (`requirements.txt`, `-app`, `-test`, `-extractor`), yet
`tests/e2e/react/react_helpers.py:3` is:

```python
from playwright.sync_api import Page
```

and `tests/e2e/conftest.py:296-297` consumes a `browser` fixture that is
defined nowhere in `tests/` (`grep -rn "def browser" tests/` → no matches):

```python
@pytest.fixture
def page(browser, base_url):
```

That `browser` fixture comes from the **`pytest-playwright`** plugin — so
`pytest-playwright` (not bare `playwright`) is the required package.

Verified today:

```
$ .venv/bin/python -m pytest tests/e2e -q --collect-only
42 tests collected, 20 errors
!!!!!!!!!!!!!!!!!!! Interrupted: 20 errors during collection !!!!!!!!!!!!!!!!!!!
```

`Makefile:84` advertises `make test-e2e` and `Makefile:31` lists it in
`make help`, so both the Makefile target and the README's headline
`python3 -m pytest` abort with an unactionable traceback.

Compatibility checked from the wheel metadata (downloaded with a working
interpreter, never installed): `pytest_playwright-0.9.0` requires
`pytest <10.0.0,>=6.2.4` and `Requires-Python: >=3.10`. This repo has
pytest 9.0.3. Compatible.

`frontend/package.json` does declare `@playwright/test`, but that is the
JavaScript runner for the separate `frontend/e2e/*.spec.ts` suite. It is not
the Python API these 25 files import and it does not help here.

### Repo conventions that apply to this plan

- **Commit convention** (`<type>: <description>`, types
  `feat|fix|refactor|docs|test|chore|perf|ci`; no AI attribution lines).
  Real examples from `git log`:
  `fix: install root node_modules in make install`,
  `ci: stop ignoring the separation preflight suite`,
  `docs: make test also runs the Worker suite`.
- **Python is venv-only.** Use `.venv/bin/python`, `.venv/bin/pytest`,
  `.venv/bin/ruff`. Never global `pip`.
- **Makefile style**: recipes use tabs; paths are quoted as
  `"$(REPO_ROOT)/frontend"` because this repo lives under a path containing a
  space (`Active Projects`). Every path you write must be quoted the same way.
- `make lint` is Python-only and passes today (`All checks passed!`, scoped to
  `immi_case_downloader/ scripts/ *.py`). `.venv/bin/ruff check .` reports 43
  errors, all under `tests/` — that is
  `plans/003-lint-the-test-suite.md`'s territory, not yours.
- The `frontend/e2e/` directory (12 `.ts` files) is the JS Playwright suite and
  is deliberately excluded from Vitest by
  `exclude: ["e2e/**", "node_modules/**"]`. Keep it excluded.

## Commands you will need

All commands assume `cd "/Users/d/Developer/Active Projects/IMMI-Case-"`.

### Baseline capture (do this before Step 1)

Every expected number below is a **delta against a baseline you measure
yourself**. Absolute suite totals rot as soon as a sibling plan lands and they
train the next executor to edit the yardstick instead of the code. Run this
first, on the post-001 tip, and keep the output:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
cd frontend
FE_FILES_BEFORE=$(npx vitest list --filesOnly | grep -c .)
npx vitest run 2>&1 | tail -6      # read "Tests N passed" -> FE_TESTS_BEFORE
npx vitest run --coverage 2>&1 | grep -A2 'All files'   # the four ratchet numbers 001 pinned
cd ..
cd workers && npx vitest run 2>&1 | tail -4; cd ..      # -> WK_TESTS_BEFORE
cd workers/austlii-scraper && npm test 2>&1 | tail -4; cd ../..   # -> PIPE_TESTS_BEFORE
make test-py 2>&1 | tail -3        # -> PY_PASSED_BEFORE / PY_SKIPPED_BEFORE
```

| Baseline | Symbol | Value at `42826a3` (re-measure; do not trust this column) |
|---|---|---|
| frontend test files collected | `FE_FILES_BEFORE` | 55 |
| frontend tests passing | `FE_TESTS_BEFORE` | 490 |
| main Worker tests passing | `WK_TESTS_BEFORE` | 345 |
| pipeline Worker tests passing | `PIPE_TESTS_BEFORE` | 28 |
| python passed / skipped | `PY_PASSED_BEFORE` / `PY_SKIPPED_BEFORE` | 1141 / 7 |

### Command reference

| Purpose | Command | Expected on success |
|---|---|---|
| Python unit tests | `make test-py` | `PY_PASSED_BEFORE` passed and `PY_SKIPPED_BEFORE - 1` skipped after Step 6 (`PY_SKIPPED_BEFORE` before it), plus the 3 named environmental failures. ~4 min. |
| Frontend tests | `cd frontend && npx vitest run` | `FE_FILES_BEFORE + 1` files, `FE_TESTS_BEFORE + 28` tests, after Step 1. |
| Frontend collected-file list | `cd frontend && npx vitest list --filesOnly` | `FE_FILES_BEFORE + 1` lines after Step 1. |
| Main Worker tests | `cd workers && npx vitest run` | exactly `WK_TESTS_BEFORE` — unchanged by this plan. |
| Pipeline Worker tests | `cd workers/austlii-scraper && npm test` | exactly `PIPE_TESTS_BEFORE` — unchanged by this plan. |
| Pipeline Worker typecheck | `cd workers/austlii-scraper && npm run typecheck` | exit 0, no output. |
| Python lint | `make lint-py` | `All checks passed!` |
| Frontend lint | `cd frontend && npm run lint` | exit 0 with **0 errors** (the warning count — 25 at `42826a3` — is not gated and is not yours to fix). |
| Deploy-secret preflight | `bash scripts/test_preflight_secrets.sh` | `ALL PREFLIGHT TESTS PASSED`, exit 0. |
| Makefile dry run | `make -n <target>` | prints the recipe without executing it. **`make -n` proves a target resolves; it never proves the recipe works.** Never cite it as evidence that something ran. |
| Workflow lint | `actionlint .github/workflows/ci.yml` | Exits 1 with **exactly one** pre-existing `SC2035` finding on the `ruff check ... *.py` line. That single finding is the baseline; anything more is a regression. |
| Workflow YAML parse | `.venv/bin/python -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))" && echo YAML_OK` | `YAML_OK` |

`actionlint` is installed at `/opt/homebrew/bin/actionlint`. PyYAML 6.0.3 is
available in `.venv`.

**The 3 Python failures must still be exactly these three, by name**, when you
finish — assert on the names, not on the number `3`:

```
tests/test_backfill_judge_overrides_from_pdf.py::test_clean_line_does_not_destroy_words
tests/test_backfill_judge_overrides_from_pdf.py::test_extract_judiciary_names_filters_non_judicial_judging
tests/test_backfill_judge_overrides_from_pdf.py::test_merge_treats_postnominal_variant_as_equivalent
```

## Scope

**In scope** (the only files you may modify or create):

- `Makefile`
- `pytest.ini`
- `frontend/vitest.config.ts` — the `test.include` glob (Step 1) **and the four
  numbers inside `coverage.thresholds` (Step 1a only)**. Nothing else in the
  `coverage` block: `provider`, `reporter`, `include`, `exclude` and the nested
  shape are plan 001's and must be left byte-identical.
- `.github/workflows/ci.yml` — the `test-python` job header and the
  `test-worker` job's `setup-node` step only
- `requirements-e2e.txt` — **create**
- `plans/README.md` — status row for this plan only

**Out of scope** (do NOT touch, even though they look related):

- `requirements-test.txt`. It is in this plan's file territory but is
  deliberately left unchanged: putting `pytest-playwright` there would make the
  CI `test-python` job install a ~40 MB browser driver on every run for a suite
  that job never executes — directly undoing the CI-cost work in Step 9. The
  E2E dependency goes in its own `requirements-e2e.txt` instead. The
  `ruff==0.15.18` pin at line 7 is deliberate and documented in its own
  comment; leave it.
- `workers/vitest.config.js`. Merging the two Worker suites into one Vitest
  workspace would force a Vitest major reconciliation (root `^2.0.0` vs
  `austlii-scraper` `^4.1.8` vs `frontend` `^4.0.18`) with no test-coverage
  gain. See "Findings reconsidered".
- `frontend/vitest.config.ts`'s `coverage: { ... }` block — plan 001 owns it,
  **except** the four numbers under `coverage.thresholds`, which Step 1a of
  this plan re-measures because Step 1 changes what is covered.
- `Makefile`'s `lint:`, `lint-py:`, `lint-fe:`, `typecheck:` and `coverage-fe:`
  recipes — plans 001 and 003 own them. In particular, **do not** "fix"
  `make typecheck`; plan 001 already changes it to `tsc -b --noEmit` and
  `make check` picks that up for free. `make check` may *depend on* those
  targets (that is the point of it) without editing their recipes.
- The `test-frontend` job in `.github/workflows/ci.yml` — plan 001 owns it. The
  `Lint with ruff` step — plan 003 owns it.
- `tests/**` — no test file is edited by this plan. In particular
  `tests/integration/` is **not** deleted; see Step 6.
- `README.md` and `CLAUDE.md`. Both go stale as a result of this plan (the
  README install block at `README.md:118` omits the venv and the root
  `npm install`; the frontend test count at `README.md:182` gains 28 tests and
  one file). Documentation is a different plan's territory and it has **named
  owners**: `plans/043-correct-the-readme.md` for `README.md`,
  `plans/042-rewrite-the-agent-facing-docs.md` for `CLAUDE.md` / `AGENTS.md`.
  Both must run after this chain. Hand them the specifics in your handoff
  instead of editing.
- `make build` (the `npm run build` form) and adding **that** to `make check`.
  `npm run build` writes into the **tracked** directory
  `immi_case_downloader/static/react/`, so running it dirties ~80 files with
  new content hashes every time. A one-command check that leaves the tree dirty
  is worse than one that does not. Confirmed empirically on 2026-08-27.
  **This does not apply to `npm run build:cloudflare`**, which writes to
  `frontend/dist/` — ignored by `.gitignore:7` (`dist/`) — and which is
  precisely what CI and the gated deploy workflow run. Step 8 therefore *does*
  add a `build:cloudflare` gate to `make check`; the two commands were
  conflated in an earlier draft of this plan.
- `wrangler.toml` placeholder resource IDs, `IMMI_CASE_MUTATIONS_ENABLED` and
  the pipeline flags defaulting to `"false"`,
  `workers/austlii-scraper/scripts/rollback_run.ts` targeting legacy Supabase —
  all fail-closed / break-glass **by design**.

## Git workflow

- Branch: `advisor/002-fix-test-collection-and-install`, created from `main`.
- Commit per step (or per logical pair of steps). Message style is conventional
  commits, matching `git log`:
  - Step 1–1a: `test: collect colocated frontend tests and re-measure the coverage ratchet`
  - Step 2: `test: guard vitest include globs by comparing collected file sets`
  - Step 3: `test: run the pipeline Worker suite from make test`
  - Step 4: `fix: make install create and use the repo venv`
  - Step 5: `chore: stop forcing coverage on every pytest run`
  - Step 6: `test: split the opt-in integration suite out of make test-py`
  - Step 7: `test: make the Python E2E suite installable and self-diagnosing`
  - Step 8: `chore: add make check as the single local CI mirror`
    (also introduces `check-native`, `typecheck-pipeline` and `build-fe`)
  - Step 9: `ci: cache python deps and add a python 3.14 matrix leg`
  - Step 10: `docs: refresh make help for the new targets`
- No AI attribution / `Co-Authored-By` lines.
- Do **NOT** push, do **NOT** open a PR, do **NOT** merge. The operator commits
  and pushes.
- Before committing, per this repo's `CLAUDE.md` GitNexus rules, run
  `detect_changes()` and report the affected symbol set. If the index is stale
  (it lagged `HEAD` on 2026-08-28), refresh it with
  `node .gitnexus/run.cjs analyze` or record the check as **unverified** — do
  not silently skip it.
- Whatever the drift check showed as already-dirty at the start is pre-existing:
  leave it alone, do not stage it, and never `git checkout --`, `git restore`,
  `git stash` or `git clean` a path you did not create. Record what was dirty in
  your handoff so a reviewer can tell your diff from the operator's.

## Steps

### Step 1: Widen the frontend Vitest `include` so colocated tests are collected

Edit `frontend/vitest.config.ts`. Replace this single line:

```ts
    include: ["__tests__/**/*.{test,spec}.{ts,tsx}"],
```

with:

```ts
    // Two roots on purpose: the historical suite under frontend/__tests__/ and
    // tests colocated next to the module they cover (src/**/__tests__/). Before
    // the second glob existed, src/lib/__tests__/saved-searches.test.ts was in
    // the tree but collected by nothing. `make check-vitest-collection` now
    // fails if any test file on disk is missed again.
    include: [
      "__tests__/**/*.{test,spec}.{ts,tsx}",
      "src/**/*.{test,spec}.{ts,tsx}",
    ],
```

Change nothing else in this file — in particular leave the `coverage: { ... }`
block exactly as plan 001 left it.

You may see a claim elsewhere that widening this glob makes
`saved-searches.test.ts` throw `Cannot redefine property: localStorage` at
module load, because both `frontend/__tests__/legislations-setup.ts:59` and
`frontend/src/lib/__tests__/saved-searches.test.ts:31` call
`Object.defineProperty(window, "localStorage", { value: ... })` without
`configurable: true`. **That is false and was disproved empirically** — jsdom
installs `window.localStorage` as a *configurable* accessor, and
`Object.defineProperty` preserves `[[Configurable]]` when converting an
accessor to a data property, so the second call succeeds and simply wins. Do
not "pre-emptively" delete either mock. If the run below is green, there is
nothing to fix.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run 2>&1 | tail -5
```

→ `Test Files` = `FE_FILES_BEFORE + 1` and `Tests` = `FE_TESTS_BEFORE + 28`.
Zero failures. (At `42826a3` that is `56 passed (56)` and `518 passed (518)`,
but compare against your captured baseline, not against those literals.)

Also confirm it is the *right* file that got added, not merely that the count
went up:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest list --filesOnly | grep -Fx 'src/lib/__tests__/saved-searches.test.ts' \
  && echo "COLOCATED_FILE_COLLECTED"
npx vitest run src/lib/__tests__/saved-searches.test.ts -t "returns empty array for corrupted JSON"
```

→ `COLOCATED_FILE_COLLECTED`, then a passing single-test run. A count that rose
by one because a *different* file appeared would pass a count check and fail
this one.

If any of the 28 newly collected tests fails, STOP and report the failure text
— it was green on 2026-08-27 and a failure means something else changed.

### Step 1a: Re-measure the coverage ratchet that Step 1 just moved

Plan 001 pinned `coverage.thresholds` to numbers measured **before** this glob
was widened. Step 1 makes `frontend/src/lib/saved-searches.ts` (305 lines)
execute for the first time, which changes at least the `lines` and `functions`
figures. Leaving 001's numbers in place would leave the ratchet slack by
exactly the amount this plan just earned — the opposite of a ratchet.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run --coverage 2>&1 | grep -A2 'All files'
```

Read the four `All files` percentages. For each metric, set
`coverage.thresholds.<metric>` in `frontend/vitest.config.ts` to
`max(previous_value, floor(measured))`, capped at `80`:

- never **lower** a threshold below what plan 001 set — that is what makes it a
  ratchet;
- never set one **above** the measured value — that fails CI on the first run;
- once a metric reaches 80, stop at `80`; the repo's written policy is 80% and
  there is no reason to gate above it.

Change nothing else in the `coverage` block. In particular leave
`include: ["src/**/*.{ts,tsx}"]` and the `exclude` list exactly as 001 wrote
them — the exclude list already contains `**/__tests__/**`, which is what keeps
the newly collected `src/lib/__tests__/saved-searches.test.ts` from being
counted as source.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run --coverage 2>&1 | tail -12
grep -c '__tests__' coverage/coverage-summary.json
```

→ the run exits 0 with **no** `does not meet threshold` line, and the
`grep -c` prints `0` (no test file counted as source).

Then prove the ratchet is still live rather than decorative: temporarily raise
`thresholds.lines` by 5 points, re-run, confirm it **fails** with a threshold
error and a non-zero exit, restore your measured value, confirm it passes. Do
not commit the raised value.

Commit this together with Step 1:
`test: collect colocated frontend tests and re-measure the coverage ratchet`

### Step 2: Add `make check-vitest-collection`, the guard that would have caught this

The guard must compare **which files** are collected, not **how many**. A
count-only guard passes when one file is missed and another is collected twice
— exactly the class of bug it exists to catch — and it cannot name the offender
when it does fail. Build sorted path sets and `diff` them.

The target is named `check-vitest-collection`, not `check-test-collection`,
because that is honestly what it covers. The Python suites are guarded by
`pytest.ini`'s `testpaths = tests` (pytest walks the tree; it has no include
glob to drift), and the two Playwright suites — `frontend/e2e/*.spec.ts` and
`tests/e2e/**` — are deliberately outside it: they are run by different runners
that this guard does not invoke. Do not let the target claim more than that.

Add it to `Makefile`, in the Testing section after the `test-workers:` recipe
(or after `coverage-fe:` if plan 001 put that in the gap — order does not
matter):

```make
# Guard against include-glob drift: every Vitest-owned test file on disk must be
# collected by exactly one vitest config. This is what silently hid
# frontend/src/lib/__tests__/saved-searches.test.ts (28 tests) for as long as
# the frontend include was anchored at frontend/__tests__/ only.
#
# Compares SETS of repo-relative paths, not counts: a count check passes when one
# file is missed and another is double-collected, and cannot name the offender.
#
# NOT covered here (by design, different runners): frontend/e2e/*.spec.ts and
# tests/e2e/** are Playwright; tests/**/*.py is pytest, guarded by pytest.ini's
# `testpaths = tests`.
check-vitest-collection:
	@set -e; \
	TMP=$$(mktemp -d); trap 'rm -rf "$$TMP"' EXIT; \
	( cd "$(REPO_ROOT)" && find frontend workers -type f \
	    \( -name '*.test.js' -o -name '*.test.jsx' -o -name '*.test.ts' -o -name '*.test.tsx' \
	    -o -name '*.spec.js' -o -name '*.spec.jsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \) \
	    -not -path '*/node_modules/*' -not -path 'frontend/e2e/*' -not -path '*/dist/*' \
	  | sort -u ) > "$$TMP/disk"; \
	( cd "$(REPO_ROOT)/frontend" && npx vitest list --filesOnly 2>/dev/null | sed 's|^|frontend/|'; \
	  cd "$(REPO_ROOT)/workers" && npx vitest list --filesOnly 2>/dev/null | sed 's|^|workers/|'; \
	  cd "$(REPO_ROOT)/workers/austlii-scraper" && npx vitest list --filesOnly --config vitest.config.ts 2>/dev/null | sed 's|^|workers/austlii-scraper/|' \
	) | sed 's|^\./||' | sort > "$$TMP/collected.raw"; \
	sort -u "$$TMP/collected.raw" > "$$TMP/collected"; \
	DUPES=$$(uniq -d "$$TMP/collected.raw" || true); \
	MISSING=$$(comm -23 "$$TMP/disk" "$$TMP/collected"); \
	EXTRA=$$(comm -13 "$$TMP/disk" "$$TMP/collected"); \
	FAIL=0; \
	if [ -n "$$MISSING" ]; then echo "ERROR: on disk but collected by no vitest config:"; echo "$$MISSING"; FAIL=1; fi; \
	if [ -n "$$EXTRA" ]; then echo "ERROR: collected but not found on disk (stale path or wrong prefix):"; echo "$$EXTRA"; FAIL=1; fi; \
	if [ -n "$$DUPES" ]; then echo "ERROR: collected by more than one vitest config:"; echo "$$DUPES"; FAIL=1; fi; \
	if [ "$$FAIL" = "0" ]; then echo "OK: $$(wc -l < "$$TMP/disk" | tr -d ' ') vitest test files on disk, each collected exactly once"; fi; \
	exit $$FAIL
```

The `frontend/e2e/` exclusion in the `find` is intentional: that directory
holds 12 `.ts` files (9 `*.spec.ts` plus `global-setup.ts`,
`global-teardown.ts` and `helpers.ts`) belonging to the JavaScript Playwright
runner, and `frontend/vitest.config.ts` excludes them on purpose.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make check-vitest-collection; echo "exit=$?"
```

→ `OK: 88 vitest test files on disk, each collected exactly once` and `exit=0`.
(At `42826a3` the disk set is 56 frontend files after Step 1 plus 32 worker
files — 25 under `workers/__tests__/` and 7 under
`workers/austlii-scraper/src/__tests__/` — verified 2026-08-28. Do not hard-code
88 anywhere; the target derives it.)

Prove the guard is not vacuous, twice — both checks must fail for the right
reason and both are reversible in one edit:

1. **Missed file.** Temporarily revert the Step 1 `include` widening, re-run,
   and confirm the output is
   `ERROR: on disk but collected by no vitest config:` followed by exactly
   `frontend/src/lib/__tests__/saved-searches.test.ts`, exit 2. Restore.
2. **Double collection.** Temporarily add `"../workers/__tests__/**/*.test.js"`
   to the frontend `include`, re-run, and confirm it reports under
   `collected by more than one vitest config`. Restore.

A count-only guard passes test 2. That is why this one compares sets.

### Step 3: Add `make test-pipeline` and put it in `make test`

Add this target to `Makefile` immediately after the `test-workers:` recipe:

```make
# workers/austlii-scraper is a separate npm package with its own manifest,
# lockfile, node_modules, vitest config and tsc gate. Until this target existed
# its 7 test files ran only in CI (.github/workflows/ci.yml, "Run native
# pipeline tests"), so `make test` could be green while the production
# case-ingestion Worker was broken.
test-pipeline:
	cd "$(REPO_ROOT)/workers/austlii-scraper" && npm test
```

Then change the aggregate target from:

```make
test: test-py test-fe test-workers
```

to:

```make
test: test-py test-fe test-workers test-pipeline
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-pipeline 2>&1 | tail -4
```

→ exactly `PIPE_TESTS_BEFORE` tests passing (28 at `42826a3`, across 7 files).
This plan runs that suite; it does not change it, so the number must match your
baseline capture exactly.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make -n test | grep -c austlii-scraper
```

→ `1`. Note what this does and does not prove: `make -n` shows that `test`
resolves `test-pipeline` and would run it. It does **not** prove the suite
passes — the `make test-pipeline` run above is what proves that. Do not report
`make -n` output as evidence that anything executed.

### Step 4: Make `make install` create and use the repo's `.venv`

Replace the whole `install:` target. From:

```make
install:
	"$(PYTHON)" -m pip install -r requirements-app.txt -r requirements-test.txt
	# Root deps hold vitest + wrangler; workers/ has no package.json of its own,
	# so test-workers resolves against the root node_modules.
	npm install
	cd "$(REPO_ROOT)/frontend" && npm install
```

to:

```make
# Uses $(VENV_PYTHON), never $(PYTHON): on a fresh clone $(PYTHON) resolves to
# bare python3 (see the ?= above), which would install pandas/numpy/lxml/
# psycopg2 into the user's global site-packages — or hard-fail under PEP 668 —
# and would never produce the .venv that test-py, lint and coverage assume.
install:
	@if [ ! -x "$(VENV_PYTHON)" ]; then \
	  echo "==> creating virtualenv at $(REPO_ROOT)/.venv"; \
	  python3 -m venv "$(REPO_ROOT)/.venv"; \
	else \
	  echo "==> reusing existing virtualenv at $(REPO_ROOT)/.venv"; \
	fi
	"$(VENV_PYTHON)" -m pip install -r requirements-app.txt -r requirements-test.txt
	# Root deps hold vitest + wrangler; workers/ has no package.json of its own,
	# so test-workers resolves against the root node_modules.
	npm install
	cd "$(REPO_ROOT)/frontend" && npm install
	# workers/austlii-scraper is its own package; without this, `make test-pipeline`
	# and the CI-gated `npm run typecheck` there are unrunnable on a clean clone.
	# npm ci (not npm install) so a lockfile drift is an error, never a silent rewrite.
	cd "$(REPO_ROOT)/workers/austlii-scraper" && npm ci --ignore-scripts
```

`$(VENV_PYTHON)` is required rather than `$(PYTHON)`: GNU Make expands the
entire recipe before executing any of its lines, so `$(PYTHON)` would still
evaluate against the *pre-creation* state of `.venv` even though the venv is
created earlier in the same recipe.

**Do not run `make install` in this working copy.** `pip` is broken in this
repo's `.venv` (see "KNOWN LOCAL DEFECT" in Current state), and because the new
recipe *reuses* an existing `.venv`, running it here would exercise the broken
interpreter and tell you nothing about your change.

**But do run it somewhere clean — this step is not finished until you have.**
A `make -n` dry run proves the recipe resolves; it does not prove
`requirements-app.txt` + `requirements-test.txt` install, and that is the exact
claim this step makes. Use a disposable git worktree, which has no `.venv`, so
the new `python3 -m venv` branch is the one that executes. `python3` on this
machine resolves to
`/Library/Frameworks/Python.framework/Versions/3.14/bin/python3` (Python 3.14.0,
python.org build), whose `pyexpat` is healthy — verified 2026-08-28 with
`python3 -c "import xml.parsers.expat"`, which prints nothing and exits 0.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
WT=$(mktemp -d)/immi-install-probe
git worktree add "$WT" HEAD          # detached; your branch is untouched
cd "$WT"
git checkout "$(git -C "/Users/d/Developer/Active Projects/IMMI-Case-" rev-parse --abbrev-ref HEAD)" -- Makefile requirements-e2e.txt 2>/dev/null || true
time make install                     # THE acceptance run
./.venv/bin/python -c "import pandas, numpy, lxml, psycopg2; print('APP_DEPS_OK')"
./.venv/bin/python -m pytest tests/test_models.py -q -p no:cacheprovider | tail -2
```

→ `make install` exits 0; `APP_DEPS_OK`; the single-file pytest run passes.
Then clean up:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
git worktree remove --force "$WT"
```

If you cannot complete that run — no network, no disk, a wheel that will not
build — **report the step as `unverified` and say exactly which command you
could not run**. Do not mark it done on the strength of `make -n` alone, and do
not weaken the recipe to make a dry run look convincing.

**Verify** (three static checks, all non-mutating, *in addition to* the
worktree acceptance run above — not instead of it):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make -n install
```

→ the printed recipe must contain `python3 -m venv "` and must reference
`/.venv/bin/python -m pip install -r requirements-app.txt -r requirements-test.txt`.

Note: `make -n install` alone cannot prove the `$(PYTHON)` fallback is gone,
because on this machine `.venv` already exists so `$(PYTHON)` and
`$(VENV_PYTHON)` expand identically. Grep the **source** instead — use
`grep -F`, since `$` in a basic regex would be misread:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  echo "venv:      $(grep -cF 'python3 -m venv' Makefile)" && \
  echo "venv-pip:  $(grep -cF '"$(VENV_PYTHON)" -m pip install' Makefile)" && \
  echo "stale-pip: $(grep -cF '"$(PYTHON)" -m pip install' Makefile)" && \
  echo "npm-ci:    $(grep -cF 'npm ci --ignore-scripts' Makefile)"
```

→ `venv: 1`, `venv-pip: 1`, `stale-pip: 0`, `npm-ci: 1`.
(At `42826a3` the same commands give `0`, `0`, `1`, `0`.)

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npm ci --dry-run --ignore-scripts 2>&1 | tail -2
```

→ `added 104 packages in <time>` (the lockfile resolves cleanly; nothing is
written). `--dry-run` proves resolution only — the real `npm ci` runs inside the
worktree acceptance run above, and that is what proves installability.

### Step 5: Stop forcing coverage and `-v` onto every pytest run

Edit `pytest.ini`. Replace:

```ini
addopts = -v --cov=immi_case_downloader --cov-report=term-missing
```

with:

```ini
# No global addopts on purpose. Coverage is opt-in via `make coverage`, which
# passes --cov=immi_case_downloader --cov-report=html explicitly. Forcing --cov
# here made every single-file run pay coverage instrumentation (5.2s -> 1.4s on
# tests/test_models.py once removed) and rewrote .coverage on every invocation,
# and the -v fought the -q that make test-py and CI both pass.
```

That is: delete the `addopts` line entirely and leave the comment in its place.
Keep `testpaths`, `asyncio_mode`, `asyncio_default_fixture_loop_scope` and the
`filterwarnings` block exactly as they are.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_models.py -q -p no:cacheprovider 2>&1 | tail -3
```

→ no `test session starts` banner, no `plugins:` line, no `collected N items`
line; just the dot/progress output and a summary. Exit 0.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make -n coverage | grep -c -- '--cov=immi_case_downloader'
```

→ `1` (`make coverage` still asks for coverage explicitly — it never relied on
the global default).

### Step 6: Split the opt-in integration suite out of `make test-py`

`.github/workflows/ci.yml:44` already passes `--ignore=tests/integration`. Make
the Makefile agree, and give the suite its own explicit entry point so it stays
reachable.

Change:

```make
test-py:
	"$(PYTHON)" -m pytest tests/ --ignore=tests/e2e -q
```

to:

```make
test-py:
	"$(PYTHON)" -m pytest tests/ --ignore=tests/e2e --ignore=tests/integration -q
```

Change:

```make
coverage:
	"$(PYTHON)" -m pytest tests/ --ignore=tests/e2e --cov=immi_case_downloader --cov-report=html -q
```

to:

```make
coverage:
	"$(PYTHON)" -m pytest tests/ --ignore=tests/e2e --ignore=tests/integration --cov=immi_case_downloader --cov-report=html -q
```

Add this target immediately after `test-pipeline:`:

```make
# Opt-in. tests/integration targets the retired Supabase/Postgres-RLS stack and
# self-skips unless SUPABASE_DB_URL and JWT_SECRET_CURRENT are exported. It is
# excluded from test-py and from CI (.github/workflows/ci.yml passes the same
# --ignore) so local and CI collect the same set. Whether to retire it outright
# is an operator decision about auth acceptance criteria — do not delete it.
test-integration:
	"$(PYTHON)" -m pytest tests/integration/ -v
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py 2>&1 | tail -2
```

→ `PY_PASSED_BEFORE` passed (unchanged) and exactly `PY_SKIPPED_BEFORE - 1`
skipped — the one module-level skip in `tests/integration/` is what leaves the
set. The failures must still be the three named
`tests/test_backfill_judge_overrides_from_pdf.py` pyexpat ImportErrors, by
name. At `42826a3` that reads `3 failed, 1141 passed, 6 skipped`; compare
against your captured baseline, not against those literals. Takes ~4 minutes.

A stronger, order-independent form of the same check:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-py 2>&1 | grep '^FAILED' | sort
```

→ exactly three lines, all in `tests/test_backfill_judge_overrides_from_pdf.py`.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-integration 2>&1 | tail -3
```

→ `1 skipped` with the message
`SUPABASE_DB_URL and JWT_SECRET_CURRENT are required for revoke-member integration`.
Exit 0.

### Step 7: Create `requirements-e2e.txt`, add `make install-e2e`, make `make test-e2e` self-diagnosing

Create `requirements-e2e.txt` at the repo root:

```
# Browser-automation dependencies for the Python Playwright E2E suite
# (tests/e2e/**, 25 files). Deliberately NOT in requirements-test.txt: the CI
# test-python job never runs this suite, and pytest-playwright pulls a large
# driver plus a browser download that job would pay for on every run.
#
# tests/e2e/conftest.py consumes a session-scoped `browser` fixture that is
# defined nowhere in tests/ — it comes from the pytest-playwright plugin, so
# bare `playwright` is not enough.
#
# Install with:  make install-e2e     (also downloads the chromium binary)
pytest-playwright>=0.9.0
```

Add these two targets to `Makefile`. `install-e2e:` goes in the Setup section
right after `install:`:

```make
install-e2e:
	"$(VENV_PYTHON)" -m pip install -r requirements-e2e.txt
	"$(VENV_PYTHON)" -m playwright install chromium
```

and replace the `test-e2e:` recipe:

```make
test-e2e:
	"$(PYTHON)" -m pytest tests/e2e/ -v --timeout=60
```

with:

```make
# tests/e2e/react/react_helpers.py imports playwright.sync_api at module scope,
# so without the plugin this target dies with 20 collection errors and no hint
# about what to install. Fail early with an instruction instead.
#
# The guard checks the PLUGIN distribution, not `import playwright`. The two are
# different packages: `playwright` is the browser-automation library, while the
# session-scoped `browser` fixture that tests/e2e/conftest.py:297 consumes comes
# from the separate `pytest-playwright` plugin. `import playwright` succeeds with
# only the library installed, so that check would wave the run through and let it
# die later on a missing fixture. It also checks that a browser binary is really
# present, by launching one — `playwright install chromium` is a separate step
# from installing the package and is just as easy to forget.
test-e2e:
	@"$(PYTHON)" -c "import importlib.metadata as m; m.version('pytest-playwright')" 2>/dev/null || { \
	  echo "ERROR: the pytest-playwright plugin is not installed for $(PYTHON)."; \
	  echo "(Note: the 'playwright' library alone is NOT enough — tests/e2e needs"; \
	  echo " the plugin, which is what provides the 'browser' fixture.)"; \
	  echo "Run 'make install-e2e' first (requirements-e2e.txt + chromium),"; \
	  echo "then start a server ('make api') before running the E2E suite."; \
	  exit 1; }
	@"$(PYTHON)" -c "from playwright.sync_api import sync_playwright; p=sync_playwright().start(); b=p.chromium.launch(); b.close(); p.stop()" 2>/dev/null || { \
	  echo "ERROR: pytest-playwright is installed but chromium will not launch."; \
	  echo "Run '$(PYTHON) -m playwright install chromium' (or 'make install-e2e')."; \
	  exit 1; }
	"$(PYTHON)" -m pytest tests/e2e/ -v --timeout=60
```

**Do not run `make install-e2e` in this working copy.** `pip` is broken in this
repo's `.venv` (see "KNOWN LOCAL DEFECT"), so a live install here would fail
for reasons unrelated to your change.

**Verify** — the negative path here, the positive path in a clean worktree.

*(a) Negative path, in this working copy.* The guard must fire, and must fire
for the stated reason:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-e2e; echo "exit=$?"
```

→ prints `ERROR: the pytest-playwright plugin is not installed for .../.venv/bin/python`,
then the instruction lines, then `make: *** [test-e2e] Error 1` and `exit=2`.
Crucially it must **not** print a Python traceback or 20 collection errors.
(Verified 2026-08-28 that this venv has neither distribution:
`.venv/bin/python -c "import importlib.metadata as m; m.version('pytest-playwright')"`
raises `PackageNotFoundError`, and `import playwright` raises
`ModuleNotFoundError`.)

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && test -f requirements-e2e.txt && grep -c 'pytest-playwright' requirements-e2e.txt
```

→ `1`

*(b) Positive path — required, in a disposable worktree.* `make -n install-e2e`
proves the recipe resolves; it proves nothing about whether the plugin installs,
registers, or can drive a browser, which is the entire claim of this step. Reuse
the worktree from Step 4 (or create a fresh one the same way) and run it for
real:

```bash
cd "$WT"                       # the Step 4 worktree, which has a healthy .venv
make install-e2e
./.venv/bin/python -c "import importlib.metadata as m; print('plugin', m.version('pytest-playwright'))"
./.venv/bin/python -m pytest tests/e2e --fixtures 2>/dev/null | grep -E '^browser( |$)' && echo "BROWSER_FIXTURE_REGISTERED"
./.venv/bin/python -m pytest tests/e2e -q --collect-only 2>&1 | tail -2
./.venv/bin/python -c "from playwright.sync_api import sync_playwright; p=sync_playwright().start(); b=p.chromium.launch(); print('CHROMIUM_LAUNCHES'); b.close(); p.stop()"
make test-e2e 2>&1 | tail -5   # the guard must now fall through to pytest
```

→ a plugin version line; `BROWSER_FIXTURE_REGISTERED`; a collect-only line
matching `<N> tests collected` with **no** `errors` (it is
`42 tests collected, 20 errors` before this change); `CHROMIUM_LAUNCHES`; and
`make test-e2e` reaching pytest rather than exiting at the guard.

Actually *passing* the E2E suite additionally needs a live server (`make api`)
and is out of scope. If you cannot complete (b) — no network, no browser
download — **report Step 7 as `unverified` naming the command you could not
run**. `make -n` output is not a substitute and must not be presented as one.

### Step 8: Add `make check` — one command whose green means CI will pass

Add this target to `Makefile`, in the Code Quality section after the
`typecheck:` recipe:

The claim "green here means CI will pass" is only true if the prerequisite list
actually covers the CI job set. Read `.github/workflows/ci.yml` and enumerate it
rather than trusting this paragraph; at `42826a3`, after plan 001, the three
jobs run:

| CI job | Steps that can fail | Covered by |
|---|---|---|
| `test-python` | `ruff check …`; `pytest tests/ -q --ignore=…` | `lint-py`, `test-py` |
| `test-frontend` | `tsc -b`; non-vacuity + references assertions; `npm run lint`; **`npm run build:cloudflare`**; **stale-token `git diff --exit-code`**; **`vitest run --coverage`** | `typecheck`, `lint-fe`, **`build-fe`**, **`coverage-fe`** |
| `test-worker` | `test_preflight_secrets.sh`; **`check_native_effective_references.py`**; **`check_cloudflare_native_bundle.mjs`**; `npm run test:workers`; **`npm run typecheck` in `workers/austlii-scraper`**; `npm test` there | `test-preflight`, **`check-native`**, `test-workers`, **`typecheck-pipeline`**, `test-pipeline` |

The bolded entries are the ones an earlier draft of this plan omitted, which
would have let `make check` go green while CI failed on the frontend build, the
coverage ratchet, the pipeline typecheck or either native gate. Add targets for
them:

```make
# CI runs this in the test-worker job; nothing ran it locally.
test-preflight:
	bash "$(REPO_ROOT)/scripts/test_preflight_secrets.sh"

# The two Cloudflare-native boundary gates the test-worker job runs. Both are
# read-only checkers; neither writes to the tree.
check-native:
	python3 "$(REPO_ROOT)/scripts/check_native_effective_references.py" --json
	node "$(REPO_ROOT)/scripts/check_cloudflare_native_bundle.mjs"

# The pipeline Worker has its own tsc gate, run only in CI until now.
typecheck-pipeline:
	cd "$(REPO_ROOT)/workers/austlii-scraper" && npm run typecheck

# The production bundle, exactly as CI and deploy-worker.yml build it.
# build:cloudflare writes to frontend/dist/, which .gitignore:7 ignores — unlike
# `npm run build`, which rewrites the TRACKED immi_case_downloader/static/react/
# tree and would leave ~80 modified files behind on every run. The two are not
# interchangeable; do not "simplify" this to `build`.
build-fe:
	cd "$(REPO_ROOT)/frontend" && npm run build:cloudflare
	@git -C "$(REPO_ROOT)" diff --exit-code -- frontend/src/tokens/tokens.css frontend/src/tokens/tokens.ts \
	  || { echo "ERROR: the committed generated design tokens are stale (npm run tokens changed them)."; exit 1; }
```

and then the aggregate itself, in the Code Quality section after `typecheck:`:

```make
# The single command to run before pushing. Mirrors the CI job set in
# .github/workflows/ci.yml, job by job — see the table in plans/002. Ordered
# cheapest-first so failures surface early. ~8 minutes.
#
# coverage-fe, not test-fe: CI runs `vitest run --coverage`, so the thresholds
# are part of the gate. Running test-fe here would let a coverage regression
# pass locally and fail on the PR — and running both would run the suite twice.
check: lint typecheck typecheck-pipeline check-vitest-collection check-native \
       test-preflight build-fe test-py coverage-fe test-workers test-pipeline
	@echo ""
	@echo "make check: all gates passed."
```

`check` depends on `lint`, which plan 001 turned into `lint: lint-py lint-fe`
— so `make check` picks up ESLint automatically. It also depends on
`typecheck`, which plan 001 fixed to `tsc -b --noEmit`. Do not duplicate either
here.

**Known residual gap, stated rather than hidden**: nothing enforces that this
prerequisite list stays in step with `ci.yml`. They drift independently. The
Maintenance notes record this, and a reviewer should re-derive the table above
whenever `ci.yml` changes.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-preflight 2>&1 | tail -2
make check-native 2>&1 | tail -3
make typecheck-pipeline && echo "PIPELINE_TSC_OK"
make build-fe && echo "BUILD_FE_OK"
```

→ `ALL PREFLIGHT TESTS PASSED`; both native checkers exit 0;
`PIPELINE_TSC_OK`; `BUILD_FE_OK` with no stale-token error.

Now assert the aggregate really covers the CI job set. This check compares the
prerequisite list against `ci.yml` and fails when they diverge, which a
`make -n check | head -3` cannot do:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
.venv/bin/python - <<'PY'
import re, yaml
mk = open("Makefile").read()
prereqs = set(re.search(r"^check:((?:.*\\\n)*.*)$", mk, re.M).group(1).replace("\\\n", " ").split())
ci = yaml.safe_load(open(".github/workflows/ci.yml"))
runs = " ".join(s.get("run", "") for j in ci["jobs"].values() for s in j["steps"])
need = {
    "ruff check": "lint",
    "pytest": "test-py",
    "tsc -b": "typecheck",
    "npm run lint": "lint",
    "build:cloudflare": "build-fe",
    "vitest run --coverage": "coverage-fe",
    "test_preflight_secrets.sh": "test-preflight",
    "check_native_effective_references.py": "check-native",
    "check_cloudflare_native_bundle.mjs": "check-native",
    "npm run test:workers": "test-workers",
    "npm run typecheck": "typecheck-pipeline",
}
missing = sorted({t for frag, t in need.items() if frag in runs and t not in prereqs})
assert not missing, f"make check does not cover CI steps -> missing targets: {missing}"
print("CHECK_MIRRORS_CI_OK")
PY
```

→ `CHECK_MIRRORS_CI_OK`. Prove it can fail: temporarily delete `coverage-fe`
from the `check:` prerequisite list, re-run, confirm the assertion fires naming
`coverage-fe`, then restore.

Finally run the thing:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make check 2>&1 | tail -3
```

**Expected outcome on this machine: `make check` FAILS, and that is correct.**
It stops at the `test-py` gate, because `make test-py` exits 1 with the 3
environmental `pyexpat` failures described in "Current state". Takes ~7 minutes
to reach that point. What you must confirm is:

1. `lint`, `typecheck`, `typecheck-pipeline`, `check-vitest-collection`,
   `check-native`, `test-preflight` and `build-fe` all pass *before* `test-py`
   runs (they are ordered first, so you will see their output).
2. The `test-py` failure list is **exactly** the three named
   `tests/test_backfill_judge_overrides_from_pdf.py` cases with
   `ImportError: ... pyexpat`, and passed/skipped match
   `PY_PASSED_BEFORE` / `PY_SKIPPED_BEFORE - 1`.
3. Re-run the remaining gates individually so none of them goes unexercised
   just because `test-py` aborted the chain:
   `make coverage-fe && make test-workers && make test-pipeline`.

If a gate other than `test-py` fails, or `test-py` fails differently, STOP and
report. The `make check: all gates passed.` line is only reachable on a machine
with a working `pyexpat`; do not chase it here, and do not add a skip or an
`|| true` to make it appear.

### Step 9: Cache Python deps in CI and add a Python 3.14 matrix leg

Two edits to `.github/workflows/ci.yml`. Both were assembled and validated
against a copy of this file on 2026-08-27.

**9a.** In the `test-python` job, replace:

```yaml
  test-python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
```

with:

```yaml
  test-python:
    runs-on: ubuntu-latest
    # The 3.14 leg is advisory until it has had one green run; promote it to a
    # blocking leg (delete this line) once it is proven on ubuntu-latest.
    continue-on-error: ${{ matrix.python-version == '3.14' }}
    strategy:
      fail-fast: false
      matrix:
        # 3.12 matches the extraction container image (Dockerfile line 4,
        # `FROM python:3.12-slim`); 3.14 matches the local .venv developers run.
        python-version: ["3.12", "3.14"]
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
          cache: pip
          cache-dependency-path: |
            requirements-app.txt
            requirements-test.txt
```

Leave every step below it — the venv install, the ruff step, the pytest step
and its comment block — untouched. `cache: pip` caches `~/.cache/pip`, which the
job's `.venv/bin/pip install` uses too, so the venv-based install still benefits.

`continue-on-error` is deliberate and is not permanent: all six heavy
dependencies are known to have Python 3.14 wheels (verified locally:
`psycopg2-binary 2.9.12`, `pandas 3.0.3`, `numpy 2.4.5`, `lxml 6.1.0`,
`Pillow 12.2.0`, `supabase 2.30.0` all installed under Python 3.14.7), but that
was checked on macOS/arm64, not on the manylinux wheels `ubuntu-latest` pulls.
Making the new leg advisory for its first run means a wheel gap shows up as a
visible ✗ instead of blocking every PR.

**Operational gate — this step is not "done" when the YAML is written.** An
advisory CI leg that nobody ever looks at is worse than no leg: it consumes
runner minutes and reports nothing. This step therefore has a hard,
non-negotiable follow-through, and it needs a named owner before the branch is
handed over:

1. The change cannot be evaluated from this machine — remote CI is the only
   place it runs. **Deliver Step 9 as `pending operator observation`, not as
   done**, and say so explicitly in your handoff.
2. The **first remote CI run on this branch** is the acceptance evidence.
   Whoever pushes must report, per matrix leg: job conclusion and, for the 3.14
   leg, whether the failure (if any) is a missing manylinux wheel or a genuine
   test failure.
3. Then, **before merge**, exactly one of these must happen — the decision is
   the operator's, not the executor's:
   - 3.14 leg green → **delete the `continue-on-error:` line** so the leg is
     blocking. This is the intended outcome.
   - 3.14 leg red on a wheel gap → **delete the whole matrix leg**, reverting
     `python-version` to `["3.12"]`. Do not leave a permanently-advisory job.
   - 3.14 leg red on a real test failure → that is a finding, not a CI problem;
     stop and report it.
4. Rollback for the whole step is a single revert of the `test-python` job
   header back to the un-matrixed `python-version: "3.12"` form. The `cache:
   pip` addition is independent and can stay.

Do not claim this step is complete on the strength of `actionlint` and a YAML
parse. Those prove the file is well-formed; they prove nothing about whether
the 3.14 leg installs.

**9b.** In the `test-worker` job, replace:

```yaml
      - uses: actions/setup-node@v5
        with:
          node-version: "22"
          cache: "npm"
```

with:

```yaml
      - uses: actions/setup-node@v5
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: |
            package-lock.json
            workers/austlii-scraper/package-lock.json
```

Both lockfiles exist (`package-lock.json`, `workers/austlii-scraper/package-lock.json`).
Do not add `frontend/package-lock.json` here — that is the `test-frontend` job's
key, and it already sets its own `cache-dependency-path`.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))" && echo YAML_OK
```

→ `YAML_OK`

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && actionlint .github/workflows/ci.yml 2>&1 | grep -c '^\.github/workflows/ci\.yml:'
```

→ `1` — exactly the one pre-existing `SC2035` finding on the
`ruff check ... *.py` line, no new findings. (Verified: the modified file
produces the identical single finding, just at a shifted line number.)

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -c "
import yaml
d = yaml.safe_load(open('.github/workflows/ci.yml'))
j = d['jobs']['test-python']
assert j['strategy']['matrix']['python-version'] == ['3.12', '3.14'], j['strategy']
assert j['strategy']['fail-fast'] is False
assert j['steps'][1]['with']['cache'] == 'pip'
n = d['jobs']['test-worker']['steps'][1]['with']['cache-dependency-path']
assert 'workers/austlii-scraper/package-lock.json' in n, n
print('CI_SHAPE_OK')
"
```

→ `CI_SHAPE_OK`

### Step 10: Refresh `.PHONY` and `make help`

**10a.** `Makefile:4` — **append** to whatever the `.PHONY:` line currently
contains (plan 001 rewrote it, so read the live line first rather than
replacing it wholesale). Add these seven names:

```
test-pipeline test-integration test-preflight check check-vitest-collection check-native typecheck-pipeline build-fe install install-e2e
```

(`install` was already missing from `.PHONY` before this plan; adding it is
correct and harmless. `build-fe` in particular **must** be here — a file named
`build-fe` will never exist, but `.PHONY` is what documents that.)

**10b.** Help text. Make four **targeted** edits — do not replace the whole
help block, because plan 001 changed three lines inside it.

Insert after the `@echo "  make build ..."` line and the blank `@echo ""` that
follows it:

```make
	@echo "  make check        Everything CI checks, in one command (start here)"
	@echo "  make check-vitest-collection  Assert every Vitest file on disk is collected once"
	@echo "  make check-native Cloudflare-native reference + bundle boundary gates"
	@echo "  make build-fe     Production bundle (build:cloudflare -> gitignored dist/)"
	@echo ""
```

Replace:

```make
	@echo "  make test         All tests (Python unit + frontend Vitest)"
	@echo "  make test-py      Python unit tests only (pytest, no E2E)"
	@echo "  make test-fe      Frontend Vitest tests only"
```

with:

```make
	@echo "  make test         Python unit + frontend + both Worker suites"
	@echo "  make test-py      Python unit tests only (no E2E, no integration)"
	@echo "  make test-fe      Frontend Vitest tests only"
	@echo "  make test-workers Main Cloudflare Worker Vitest suite"
	@echo "  make test-pipeline  austlii-scraper (pipeline Worker) Vitest suite"
	@echo "  make test-preflight Deploy secret-preflight parser tests"
```

Replace:

```make
	@echo "  make test-e2e     Playwright E2E tests (requires running server)"
```

with:

```make
	@echo "  make test-e2e     Python Playwright E2E (needs make install-e2e + a server)"
	@echo "  make test-integration  Supabase-era checks, opt-in (needs env vars)"
```

Replace:

```make
	@echo "  make install      Install all Python + Node dependencies"
```

with:

```make
	@echo "  make install      Install all Python + Node deps (creates .venv)"
	@echo "  make install-e2e  Playwright + chromium, for make test-e2e"
```

Also add, next to the `make typecheck` line:

```make
	@echo "  make typecheck-pipeline  tsc gate for workers/austlii-scraper"
```

**Verify**: every new target must be reachable, listed in help, **and** in
`.PHONY`. Check all three properties in one pass rather than eyeballing
`make help` output:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
HELP=$(make help)
for t in check check-vitest-collection check-native typecheck-pipeline build-fe \
         test-workers test-pipeline test-preflight test-integration install install-e2e; do
  grep -q "^\.PHONY:.*[[:space:]]$t\([[:space:]]\|$\)" Makefile || echo "MISSING FROM .PHONY: $t"
  grep -q "^$t:" Makefile || echo "TARGET NOT DEFINED: $t"
  case "$HELP" in *"make $t"*) ;; *) echo "MISSING FROM help: $t";; esac
done
echo "TARGET_AUDIT_DONE"
```

→ `TARGET_AUDIT_DONE` with **no** `MISSING`/`NOT DEFINED` lines. Prove the
audit can fail by temporarily removing one name from `.PHONY` and re-running;
restore afterwards.

(`check-test-collection` is intentionally absent from that list — the target was
renamed to `check-vitest-collection` in Step 2. If any reference to the old name
survives, `grep -rn 'check-test-collection' Makefile .github/workflows/` will
find it; it must return nothing.)

## Test plan

This plan writes **no new test files**. Its whole point is that the tests
already exist and are not being run. What changes is which of them execute.

Newly executed as a result of this plan:

| Suite | File(s) | Tests | Previously |
|---|---|---|---|
| `frontend/src/lib/__tests__/saved-searches.test.ts` | 1 file | 28 | collected by nothing |
| `workers/austlii-scraper/src/__tests__/*.test.ts` | 7 files | 28 | CI only, never from `make` |

The 28 saved-search tests cover `frontend/src/lib/saved-searches.ts`:
`loadSavedSearches` (corrupt JSON, non-array payload, invalid-entry filtering,
the 50-entry cap), `addSavedSearch` (empty name, case-insensitive duplicate,
limit reached, no-active-filters, whitespace trimming),
`updateSavedSearch` (same validations plus non-existent id),
`decodeUrlToFilters` (invalid/out-of-range year, invalid/negative/zero/decimal
page, invalid `sort_dir`, missing params, valid params) and
`deleteSavedSearch`.

New non-test gates introduced:

- `make check-vitest-collection` — compares the **set** of Vitest test files on
  disk against the set collected by the three configs, and names every file
  that is missed, stale, or double-collected. Proven non-vacuous twice in
  Step 2: it names `frontend/src/lib/__tests__/saved-searches.test.ts` when the
  Step 1 glob is reverted, and reports a double-collection when a config is
  deliberately widened to overlap another.
- `make test-e2e`'s preflight guard — fails fast with an instruction instead of
  a 20-error traceback, and checks the `pytest-playwright` **plugin** plus a
  real Chromium launch rather than `import playwright`.
- `make check` — the aggregate, with a machine-checked assertion (Step 8) that
  its prerequisite list still covers every failing step in `ci.yml`.
- `make build-fe` — the production bundle plus a stale-generated-token
  assertion.

Full verification sequence at the end (compare every count against the values
captured in "Baseline capture" — no absolute totals):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make check-vitest-collection       # each file collected exactly once, exit 0
make test-fe 2>&1 | tail -3        # FE_FILES_BEFORE + 1 files, FE_TESTS_BEFORE + 28 tests
make coverage-fe 2>&1 | tail -12   # same counts, no "does not meet threshold"
make test-workers 2>&1 | tail -3   # WK_TESTS_BEFORE, unchanged
make test-pipeline 2>&1 | tail -3  # PIPE_TESTS_BEFORE, unchanged
make typecheck-pipeline            # exit 0
make build-fe                      # exit 0, no stale-token error
make check-native 2>&1 | tail -3   # both gates exit 0
make test-py 2>&1 | grep '^FAILED' | sort   # exactly the 3 named pyexpat cases
make test-preflight                # ALL PREFLIGHT TESTS PASSED
make lint                          # ruff clean + eslint 0 errors
actionlint .github/workflows/ci.yml 2>&1 | grep -c '^\.github'   # 1
```

## Done criteria

Machine-checkable. ALL must hold (run from
`/Users/d/Developer/Active Projects/IMMI-Case-`):

Every count is a **comparison against the baseline you captured**, never a
literal copied from this file — a literal breaks the moment `plans/003` or any
sibling plan lands, and tempts the next executor to edit the yardstick instead
of the code.

- [ ] `cd frontend && npx vitest run` reports exactly `FE_FILES_BEFORE + 1`
      test files and `FE_TESTS_BEFORE + 28` tests, zero failures.
- [ ] `cd frontend && npx vitest list --filesOnly | grep -Fx 'src/lib/__tests__/saved-searches.test.ts'`
      matches — the *right* file was added, not merely one more file.
- [ ] `cd frontend && npx vitest run src/lib/__tests__/saved-searches.test.ts -t "returns empty array for corrupted JSON"`
      passes.
- [ ] `make check-vitest-collection` exits 0 and prints
      `each collected exactly once`; and with the Step 1 glob reverted it exits
      non-zero **naming** `frontend/src/lib/__tests__/saved-searches.test.ts`.
- [ ] `make coverage-fe` exits 0 with no `does not meet threshold` line, and
      `grep -c '__tests__' frontend/coverage/coverage-summary.json` returns `0`.
- [ ] Each of the four `coverage.thresholds` numbers is `>=` the value plan 001
      committed (a ratchet never loosens) and `<=` the value measured in
      Step 1a (or the check would fail on the first CI run).
- [ ] `make test-pipeline` reports exactly `PIPE_TESTS_BEFORE` tests passing.
- [ ] `make -n test | grep -c austlii-scraper` returns `1` — *and*
      `make test-pipeline` has been run for real (the dry run alone proves only
      that the target resolves).
- [ ] `grep -cF 'python3 -m venv' Makefile` returns `1`
- [ ] `grep -cF '"$(VENV_PYTHON)" -m pip install' Makefile` returns `1`
- [ ] `grep -cF '"$(PYTHON)" -m pip install' Makefile` returns `0`
- [ ] `grep -cF 'npm ci --ignore-scripts' Makefile` returns `1`
- [ ] **`make install` completed successfully in a disposable worktree** and
      `./.venv/bin/python -c "import pandas, numpy, lxml, psycopg2"` succeeded
      there — or the step is reported as `unverified` with the blocking reason.
- [ ] `grep -c '^addopts' pytest.ini` returns `0`
- [ ] `make -n coverage | grep -c -- '--cov=immi_case_downloader'` returns `1`
- [ ] `make test-py` reports exactly `PY_PASSED_BEFORE` passed and
      `PY_SKIPPED_BEFORE - 1` skipped, and
      `make test-py 2>&1 | grep '^FAILED' | sort` returns exactly the three
      named `tests/test_backfill_judge_overrides_from_pdf.py` pyexpat cases.
- [ ] `make test-integration 2>&1 | tail -2 | grep -q "1 skipped"`
- [ ] `test -f requirements-e2e.txt && grep -c pytest-playwright requirements-e2e.txt`
      returns `1`
- [ ] `make test-e2e` in this working copy prints
      `the pytest-playwright plugin is not installed` and exits non-zero, with
      no Python traceback.
- [ ] **In the disposable worktree**: after `make install-e2e`,
      `pytest tests/e2e --collect-only -q` ends in `<N> tests collected` with
      **no** `errors`, the `browser` fixture is listed by
      `pytest tests/e2e --fixtures`, and Chromium launches — or Step 7 is
      reported as `unverified` with the blocking reason.
- [ ] `make test-preflight 2>&1 | grep -q "ALL PREFLIGHT TESTS PASSED"`
- [ ] `make check-native` exits 0; `make typecheck-pipeline` exits 0;
      `make build-fe` exits 0 and leaves
      `git diff --exit-code -- frontend/src/tokens/tokens.css frontend/src/tokens/tokens.ts`
      clean.
- [ ] The Step 8 `CHECK_MIRRORS_CI_OK` assertion passes, and has been shown to
      fail when a prerequisite is removed.
- [ ] `.venv/bin/python -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"`
      exits 0
- [ ] `actionlint .github/workflows/ci.yml 2>&1 | grep -c '^\.github/workflows/ci\.yml:'`
      returns `1`
- [ ] The Step 10 `TARGET_AUDIT_DONE` audit prints no `MISSING` / `NOT DEFINED`
      lines, and `grep -rn 'check-test-collection' Makefile .github/workflows/`
      returns nothing.
- [ ] `make lint` exits 0 (ruff `All checks passed!` plus ESLint 0 errors).
- [ ] `cd workers && npx vitest run` reports exactly `WK_TESTS_BEFORE` tests
      passing.
- [ ] Tracked-file changes are ONLY `Makefile`, `pytest.ini`,
      `frontend/vitest.config.ts`, `.github/workflows/ci.yml` — check with
      `git status --short | grep '^ M' | grep -vE 'Makefile|pytest\.ini|frontend/vitest\.config\.ts|\.github/workflows/ci\.yml'`
      which must print nothing, **after excluding whatever the drift check
      recorded as already dirty**. (`plans/` and `requirements-e2e.txt` are new
      untracked files, so they do not appear in `^ M` output.)
- [ ] `git status --short -- immi_case_downloader/static/react/` prints
      nothing. If it does not, you ran `npm run build` rather than
      `build:cloudflare`; that directory is **tracked**. Restore **only that
      path**, and only if you are certain you caused it:
      `git checkout -- immi_case_downloader/static/react/` then
      `git clean -f -- immi_case_downloader/static/react/`. Never run an
      unscoped `git checkout --` / `git clean -f`; the operator may have work in
      the tree.
- [ ] Step 9 is reported as **`pending operator observation`**, not done, with
      the three-way decision (promote / drop the leg / investigate) handed over.
- [ ] `plans/README.md` status row for 002 updated (create the row if the file
      exists; if `plans/README.md` does not exist, skip this and say so in your
      handoff)

## STOP conditions

Stop and report back (do not improvise) if:

- **Any of the 28 newly collected saved-search tests fails after Step 1.** All
  28 were measured green on 2026-08-27. A failure means
  `frontend/src/lib/saved-searches.ts` or the shared setup file changed. Do not
  "fix" the test to make it pass and do not delete either `localStorage` mock —
  report the failure text.
- **`make check-vitest-collection` names any file under `workers/`** as missed,
  stale or double-collected. A worker mismatch means a new worker test file
  landed somewhere neither config reaches, and `workers/vitest.config.js` is
  explicitly out of scope for this plan.
- **`make test-py` reports anything other than `PY_PASSED_BEFORE` passed and
  `PY_SKIPPED_BEFORE - 1` skipped** after Step 6, or the failing tests are not
  exactly the three named `tests/test_backfill_judge_overrides_from_pdf.py`
  pyexpat ImportErrors.
- **A step's verification fails twice** after a reasonable fix attempt.
- **`actionlint` reports more than one finding** on `.github/workflows/ci.yml`,
  or reports a finding that is not the pre-existing `SC2035` on the
  `ruff check ... *.py` line.
- **The fix appears to require touching an out-of-scope file** — especially
  `Makefile`'s `lint:` / `typecheck:` recipes, the `test-frontend` CI job,
  `requirements-test.txt`, or anything under `tests/`. Those belong to plans 001
  and 003. (`frontend/vitest.config.ts`'s `coverage.thresholds` numbers are the
  one deliberate exception — Step 1a. Every other key in that block is still
  001's.)
- **You conclude `tests/integration/` should be deleted.** It targets the
  retired Supabase/RLS stack, so the conclusion is defensible — but deleting a
  suite that encodes auth acceptance criteria (AC5/AC8/AC9/AC10) is an operator
  decision. Report the recommendation; do not act on it.
- **`make check` fails at a gate other than `test-py`.** On this machine the
  only expected failure inside `make check` is the 3-failure environmental
  `test-py` result. A failure in `lint`, `typecheck`, `typecheck-pipeline`,
  `check-vitest-collection`, `check-native`, `test-preflight`, `build-fe`,
  `coverage-fe`, `test-workers` or `test-pipeline` is real.
- **The Step 8 `CHECK_MIRRORS_CI_OK` assertion fails**, meaning `make check` no
  longer covers a step that `ci.yml` runs. Add the missing target rather than
  relaxing the assertion.
- **A measured coverage metric goes *down* after Step 1.** Widening the include
  glob makes `src/lib/saved-searches.ts` execute for the first time, so coverage
  should rise or hold. A drop means the new test file is being counted as source
  (check `coverage.exclude` still contains `**/__tests__/**`) or that something
  else changed. Report it; do not lower the threshold to compensate.
- **You are tempted to run `make install` or `make install-e2e` in this working
  copy.** Don't — `pip` is broken in this repo's `.venv` and a failure there
  tells you nothing about your change. Run them in the disposable worktree
  described in Steps 4 and 7 instead. If even that is impossible, report the
  step `unverified`; do not silently downgrade the evidence to `make -n`.

## Maintenance notes

For the human or agent who owns this after the change lands:

- **What a reviewer should scrutinise**: (1) that the Step 8
  `CHECK_MIRRORS_CI_OK` assertion is present and that its `need` map still
  lists every failing step in `ci.yml` — the assertion catches a missing
  *target*, but the map itself is hand-maintained and is the remaining weak
  link; (2) that `check-vitest-collection`'s `find` exclusions (`node_modules`,
  `frontend/e2e`, `dist`) still describe reality if a new top-level test
  directory appears; (3) that the `continue-on-error` line on the Python 3.14
  CI leg has been resolved one way or the other before merge.
- **Promote the 3.14 CI leg to blocking** after its first green run: delete the
  `continue-on-error:` line in the `test-python` job. If it is red because of a
  missing manylinux wheel, drop the leg entirely rather than leaving a
  permanently-advisory job that nobody reads. This is a **merge blocker**, not
  a nice-to-have — see the operational gate in Step 9.
- **Docs go stale the moment this lands, and the fix has named owners.** Do not
  leave this as a floating note:
  - `plans/043-correct-the-readme.md` owns `README.md`. Hand it:
    `README.md:118` documents a venv-less `pip install` and omits both the root
    `npm install` and `workers/austlii-scraper`; `README.md:182` states the
    frontend suite as "490 個 — 55 files", which this plan changes by +28 tests
    / +1 file; and `make help` now lists targets the README does not mention.
  - `plans/042-rewrite-the-agent-facing-docs.md` owns `CLAUDE.md` / `AGENTS.md`,
    which carry the same 490/55 figures and the old `make lint` /
    `make typecheck` descriptions.
  Both are documentation-only plans and must run **after** 001→002→003, because
  the numbers and command names they reconcile are set by that chain. Say so in
  your handoff; do not edit either file from this plan.
- **A green `make check` is not a clean dependency audit.** This plan makes one
  command mean "CI will pass". It does not mean "the dependencies are safe":
  `frontend/package-lock.json` still carries npm advisories (17 at the time
  `plans/035` was written, 2 of them critical; 8 reachable from production
  dependencies), and neither CI nor `make check` looks at them. The owner is
  **`plans/035-fix-frontend-dependency-advisories.md`**. Do not add an
  unreviewed `npm audit fix` here, and do not let "make check is green" be read
  as an all-clear on advisories.
- **`pytest-xdist` / `-n auto` was deliberately NOT added**, despite being part
  of one of the findings that motivated this plan. Measured: the Python suite is
  I/O-bound, not CPU-bound (243s with coverage vs 259s without — the difference
  is noise), so parallelism would buy far less than it looks like, and the suite
  has module-level singletons (`AnalyticsCache` in
  `immi_case_downloader/web/cache.py`, `_ANCHOR_CACHE` in
  `immi_case_downloader/cases_pagination.py`) that would have to be audited for
  cross-worker isolation first. Introducing flaky parallel failures would cost
  more than the minutes saved. Revisit only with an isolation audit attached.
- **Coverage excludes are handled, not deferred.** An earlier draft left this
  open. Plan 001 now sets `coverage.include: ["src/**/*.{ts,tsx}"]` and an
  `exclude` list containing `**/__tests__/**`, so the file this plan newly
  collects is not counted as source; Step 1a re-measures the thresholds on that
  universe. Whoever changes either list must re-run the Step 1a measurement.
- **`make build` (the `npm run build` form) is still not in any aggregate
  gate**, by design — it rewrites the tracked
  `immi_case_downloader/static/react/` tree. The gate added to `make check` is
  `build-fe`, which runs `build:cloudflare` into the gitignored
  `frontend/dist/`. Keep the two distinct.
- **Two npm ecosystems, three Vitest majors.** Root is `vitest ^2.0.0`,
  `frontend` is `^4.0.18`, `workers/austlii-scraper` is `^4.1.8`. Nothing here
  needs them aligned, but a future Vitest workspace consolidation does — see
  "Findings reconsidered" for why this plan did not attempt it.
- **`tests/integration/` retirement** is an open operator decision. It targets
  Supabase service-role Postgres and `rls_isolation.sql`; production has neither.
  It now has its own `make test-integration` entry point so it stays runnable
  while that decision is pending.

## Findings reconsidered

- **"Widening the frontend include glob will make `saved-searches.test.ts` fail
  at module load with `Cannot redefine property: localStorage`" — FALSE, and
  dropped from the plan.** The claim was that
  `frontend/__tests__/legislations-setup.ts:59` and
  `frontend/src/lib/__tests__/saved-searches.test.ts:31` both call
  `Object.defineProperty(window, "localStorage", { value: ... })` without a
  `configurable` flag, making the property non-configurable and the second call
  a throw. Both calls are real, but the conclusion is wrong: jsdom installs
  `window.localStorage` as a **configurable accessor**
  (`{configurable: true, enumerable: true, get, set}`), and per the ES
  `ValidateAndApplyPropertyDescriptor` rules an accessor→data conversion
  *preserves* `[[Configurable]]`. Verified directly against this repo's jsdom:
  after the first `defineProperty` the descriptor is
  `configurable=true, writable=false`, and the second `defineProperty` succeeds
  and simply wins. Then verified end to end: with the widened glob all 28 tests
  pass and the suite gains exactly one file and 28 tests (56 / 518 at
  `42826a3`). No step is needed, and the plan explicitly warns the executor not
  to pre-emptively delete either mock.

- **"Make `workers/vitest.config.js` a Vitest workspace covering both worker
  projects" — rejected in favour of a second Make target.** The workspace form
  was offered as an alternative that would "also collapse the vitest-major
  drift". It would not collapse it for free: root is `vitest ^2.0.0`,
  `workers/austlii-scraper` is `^4.1.8`, and a workspace requires one runner
  version for both, which means a Vitest 2→4 migration of the 25-file / 345-test
  main Worker suite as a side effect of a DX fix. `make test-pipeline` gets the
  same coverage in three lines with zero migration risk, and
  `make check-vitest-collection` independently guards the outcome the workspace
  was meant to guarantee. `workers/vitest.config.js` is therefore listed as
  out of scope.

- **"Fix the misleading comment at `Makefile:102-103`" — no defect; dropped.**
  The comment reads "Root deps hold vitest + wrangler; workers/ has no
  package.json of its own, so test-workers resolves against the root
  node_modules." Verified accurate: there is no `workers/package.json`,
  `workers/node_modules` exists but contains 0 entries, and
  `cd workers && npx vitest run` resolves upward to the root `node_modules`.
  The comment stays as written.

- **`pytest-xdist` / `-n auto` — the one sub-recommendation of the CI-speed
  finding that this plan does not implement.** The rest of that finding (pip
  cache, `cache-dependency-path` for the pipeline lockfile, moving `--cov` out
  of `addopts`) is implemented in Steps 5 and 9. Parallelism is deferred with
  measurements and a rationale recorded under "Maintenance notes"; it is a
  speculative change whose payoff was measured at roughly zero on this suite and
  whose risk (module-level cache singletons shared across workers) is real.

- **Adding `pytest-playwright` to `requirements-test.txt` — corrected to a
  separate `requirements-e2e.txt`.** The finding's fix sketch named
  `requirements-test.txt`. Putting it there would make the CI `test-python` job
  install a large browser driver on every push and PR for a suite that job never
  runs, which directly contradicts the CI-cost work in Step 9. Same outcome
  (`make test-e2e` becomes runnable), narrower blast radius.

- **`README.md` §4.2 / §4.5 updates — real staleness, wrong plan.** Two of the
  findings asked for README changes alongside the Makefile fixes. `README.md`
  is outside this plan's file territory and is likely owned by a docs plan
  running in parallel; editing it here would create a merge conflict for no
  functional gain. Recorded under "Maintenance notes" with exact line numbers so
  it is not rediscovered from scratch.
