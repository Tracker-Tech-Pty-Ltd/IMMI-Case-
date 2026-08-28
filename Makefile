# IMMI-Case Makefile — common development commands
# Usage: make <target>

.PHONY: help dev build test test-py test-fe test-workers test-e2e lint lint-py lint-fe typecheck coverage-fe audit-rls-guards clean test-pipeline test-integration test-preflight check check-vitest-collection check-native typecheck-pipeline build-fe install install-e2e

# ── Defaults ──────────────────────────────────────────────────────────────────

PORT   ?= 8080
BACKEND ?= auto

# Resolve repo root from make's working directory. GNU Make 3.81 treats spaces
# in MAKEFILE_LIST as word separators, so deriving this from abspath/lastword
# breaks under "Active Projects" paths.
REPO_ROOT := $(CURDIR)
VENV_PYTHON := $(REPO_ROOT)/.venv/bin/python

# Detect the repo venv with the shell, NOT $(wildcard). Make's text functions
# are word-oriented, so under a path containing a space they see two words:
#   $(words /Users/d/Developer/Active Projects/IMMI-Case-/.venv/bin/python) -> 2
#   $(wildcard <same>)                                -> /Users/d/Developer/Active
# The first word happens to be an existing directory on this machine, so the
# old `$(if $(wildcard $(VENV_PYTHON)),...)` always took the true branch and the
# python3 fallback never fired. In the main checkout that is accidentally right
# (the venv does exist); in a fresh worktree with no venv it resolves PYTHON to
# a path that is not there, and every Python target dies with
# "No such file or directory" instead of falling back.
# `test -x` gets a single quoted argument from the shell, so the space is safe.
PYTHON ?= $(shell test -x "$(VENV_PYTHON)" && printf '%s' "$(VENV_PYTHON)" || printf '%s' python3)

# ── Meta ──────────────────────────────────────────────────────────────────────

help:
	@echo "IMMI-Case development commands:"
	@echo ""
	@echo "  make dev          Run Flask API + Vite dev server (two tabs needed)"
	@echo "  make api          Flask API only  (http://localhost:$(PORT))"
	@echo "  make ui           Vite dev server only (http://localhost:5173)"
	@echo "  make build        Build React frontend → static/react/"
	@echo ""
	@echo "  make check        Everything CI checks, in one command (start here)"
	@echo "  make check-vitest-collection  Assert every Vitest file on disk is collected once"
	@echo "  make check-native Cloudflare-native reference + bundle boundary gates"
	@echo "  make build-fe     Production bundle (build:cloudflare -> gitignored dist/)"
	@echo ""
	@echo "  make test         Python unit + frontend + both Worker suites"
	@echo "  make test-py      Python unit tests only (no E2E, no integration)"
	@echo "  make test-fe      Frontend Vitest tests only"
	@echo "  make test-workers Main Cloudflare Worker Vitest suite"
	@echo "  make test-pipeline  austlii-scraper (pipeline Worker) Vitest suite"
	@echo "  make test-preflight Deploy secret-preflight parser tests"
	@echo "  make test-e2e     Python Playwright E2E (needs make install-e2e + a server)"
	@echo "  make test-integration  Supabase-era checks, opt-in (needs env vars)"
	@echo "  make coverage     Python unit tests with HTML coverage report"
	@echo "  make coverage-fe  Frontend Vitest with coverage thresholds"
	@echo ""
	@echo "  make lint         Ruff (Python) + ESLint (frontend)"
	@echo "  make lint-py      Ruff lint Python source only"
	@echo "  make lint-fe      ESLint the frontend only"
	@echo "  make typecheck    TypeScript type check (tsc -b --noEmit, all projects)"
	@echo "  make typecheck-pipeline  tsc gate for workers/austlii-scraper"
	@echo "  make clean        Remove build artifacts"
	@echo ""
	@echo "  make install      Install all Python + Node deps (creates .venv)"
	@echo "  make install-e2e  Playwright + chromium, for make test-e2e"
	@echo "  make migrate      Where migrations live (the legacy Supabase push is manual)"
	@echo ""
	@echo "Options: PORT=8080 BACKEND=auto|sqlite|csv|supabase"

# ── Running ───────────────────────────────────────────────────────────────────

api:
	"$(PYTHON)" web.py --port $(PORT) --backend $(BACKEND)

ui:
	cd "$(REPO_ROOT)/frontend" && npm run dev

dev:
	@echo "Run 'make api' in one terminal and 'make ui' in another."
	@echo "(Or use 'make api' alone if building first with 'make build'.)"

# ── Building ──────────────────────────────────────────────────────────────────

build:
	cd "$(REPO_ROOT)/frontend" && npm run build

# ── Testing ───────────────────────────────────────────────────────────────────

test: test-py test-fe test-workers test-pipeline

test-py:
	"$(PYTHON)" -m pytest tests/ --ignore=tests/e2e --ignore=tests/integration -q

test-fe:
	cd "$(REPO_ROOT)/frontend" && npx vitest run

test-workers:
	cd "$(REPO_ROOT)/workers" && npx vitest run

# workers/austlii-scraper is a separate npm package with its own manifest,
# lockfile, node_modules, vitest config and tsc gate. Until this target existed
# its 7 test files ran only in CI (.github/workflows/ci.yml, "Run native
# pipeline tests"), so `make test` could be green while the production
# case-ingestion Worker was broken.
test-pipeline:
	cd "$(REPO_ROOT)/workers/austlii-scraper" && npm test

# Opt-in. tests/integration targets the retired Supabase/Postgres-RLS stack and
# self-skips unless SUPABASE_DB_URL and JWT_SECRET_CURRENT are exported. It is
# excluded from test-py and from CI (.github/workflows/ci.yml passes the same
# --ignore) so local and CI collect the same set. Whether to retire it outright
# is an operator decision about auth acceptance criteria — do not delete it.
test-integration:
	"$(PYTHON)" -m pytest tests/integration/ -v

coverage-fe:
	cd "$(REPO_ROOT)/frontend" && npx vitest run --coverage

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

# AC4 safety guard: reject any set_config call without transaction-local flag (true).
# A literal `false` or missing third argument leaks JWT claims across pooled connections.
audit-rls-guards:
	@echo "Checking set_config calls for transaction-local flag..."
	@BAD=$$(grep -rn "set_config(" "$(REPO_ROOT)/workers" --include="*.js" | grep -v "set_config('request.jwt.claims'.*true)" || true); \
	if [ -n "$$BAD" ]; then \
	  echo "ERROR: set_config without transaction-local=true (cross-tenant leak risk):"; \
	  echo "$$BAD"; exit 1; \
	else echo "OK: all set_config calls verified with transaction-local=true"; fi

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

coverage:
	"$(PYTHON)" -m pytest tests/ --ignore=tests/e2e --ignore=tests/integration --cov=immi_case_downloader --cov-report=html -q
	@echo "Report: htmlcov/index.html"

# ── Code Quality ──────────────────────────────────────────────────────────────

lint: lint-py lint-fe

lint-py:
	"$(PYTHON)" -m ruff check immi_case_downloader/ scripts/ tests/ *.py

lint-fe:
	cd "$(REPO_ROOT)/frontend" && npm run lint

typecheck:
	cd "$(REPO_ROOT)/frontend" && npx tsc -b --noEmit

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

# ── Setup ─────────────────────────────────────────────────────────────────────

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
	"$(VENV_PYTHON)" -m pip install -c constraints.txt -r requirements-app.txt -r requirements-test.txt
	# Root deps hold vitest + wrangler; workers/ has no package.json of its own,
	# so test-workers resolves against the root node_modules.
	npm install
	cd "$(REPO_ROOT)/frontend" && npm install
	# workers/austlii-scraper is its own package; without this, `make test-pipeline`
	# and the CI-gated `npm run typecheck` there are unrunnable on a clean clone.
	# npm ci (not npm install) so a lockfile drift is an error, never a silent rewrite.
	cd "$(REPO_ROOT)/workers/austlii-scraper" && npm ci --ignore-scripts

install-e2e:
	"$(VENV_PYTHON)" -m pip install -c constraints.txt -r requirements-e2e.txt
	"$(VENV_PYTHON)" -m playwright install chromium

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

# ── Cleanup ───────────────────────────────────────────────────────────────────

clean:
	rm -rf frontend/dist htmlcov .coverage __pycache__
	find . -name "*.pyc" -delete
	find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
