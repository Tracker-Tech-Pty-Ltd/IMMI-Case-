# IMMI-Case Makefile — common development commands
# Usage: make <target>

.PHONY: help dev build test test-py test-fe test-workers test-e2e lint lint-py lint-fe typecheck coverage-fe audit-rls-guards clean

# ── Defaults ──────────────────────────────────────────────────────────────────

PORT   ?= 8080
BACKEND ?= auto

# Resolve repo root from make's working directory. GNU Make 3.81 treats spaces
# in MAKEFILE_LIST as word separators, so deriving this from abspath/lastword
# breaks under "Active Projects" paths.
REPO_ROOT := $(CURDIR)
VENV_PYTHON := $(REPO_ROOT)/.venv/bin/python
PYTHON ?= $(if $(wildcard $(VENV_PYTHON)),$(VENV_PYTHON),python3)

# ── Meta ──────────────────────────────────────────────────────────────────────

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
	@echo "  make coverage-fe  Frontend Vitest with coverage thresholds"
	@echo ""
	@echo "  make lint         Ruff (Python) + ESLint (frontend)"
	@echo "  make lint-py      Ruff lint Python source only"
	@echo "  make lint-fe      ESLint the frontend only"
	@echo "  make typecheck    TypeScript type check (tsc -b --noEmit, all projects)"
	@echo "  make clean        Remove build artifacts"
	@echo ""
	@echo "  make install      Install all Python + Node dependencies"
	@echo "  make migrate      Push pending Supabase migrations"
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
	"$(PYTHON)" -m pytest tests/ --ignore=tests/e2e -q

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

test-e2e:
	"$(PYTHON)" -m pytest tests/e2e/ -v --timeout=60

coverage:
	"$(PYTHON)" -m pytest tests/ --ignore=tests/e2e --cov=immi_case_downloader --cov-report=html -q
	@echo "Report: htmlcov/index.html"

# ── Code Quality ──────────────────────────────────────────────────────────────

lint: lint-py lint-fe

lint-py:
	"$(PYTHON)" -m ruff check immi_case_downloader/ scripts/ *.py

lint-fe:
	cd "$(REPO_ROOT)/frontend" && npm run lint

typecheck:
	cd "$(REPO_ROOT)/frontend" && npx tsc -b --noEmit

# ── Setup ─────────────────────────────────────────────────────────────────────

install:
	"$(PYTHON)" -m pip install -r requirements-app.txt -r requirements-test.txt
	# Root deps hold vitest + wrangler; workers/ has no package.json of its own,
	# so test-workers resolves against the root node_modules.
	npm install
	cd "$(REPO_ROOT)/frontend" && npm install

migrate:
	supabase db push

# ── Cleanup ───────────────────────────────────────────────────────────────────

clean:
	rm -rf frontend/dist htmlcov .coverage __pycache__
	find . -name "*.pyc" -delete
	find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
