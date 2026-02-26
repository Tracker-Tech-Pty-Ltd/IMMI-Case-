# IMMI-Case Makefile — common development commands
# Usage: make <target>

.PHONY: help dev build test test-py test-fe test-e2e lint typecheck clean

# ── Defaults ──────────────────────────────────────────────────────────────────

PORT   ?= 8080
BACKEND ?= auto

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
	@echo ""
	@echo "  make lint         Ruff lint Python source"
	@echo "  make typecheck    TypeScript type check (tsc --noEmit)"
	@echo "  make clean        Remove build artifacts"
	@echo ""
	@echo "  make install      Install all Python + Node dependencies"
	@echo "  make migrate      Push pending Supabase migrations"
	@echo ""
	@echo "Options: PORT=8080 BACKEND=auto|sqlite|csv|supabase"

# ── Running ───────────────────────────────────────────────────────────────────

api:
	python web.py --port $(PORT) --backend $(BACKEND)

ui:
	cd frontend && npm run dev

dev:
	@echo "Run 'make api' in one terminal and 'make ui' in another."
	@echo "(Or use 'make api' alone if building first with 'make build'.)"

# ── Building ──────────────────────────────────────────────────────────────────

build:
	cd frontend && npm run build

# ── Testing ───────────────────────────────────────────────────────────────────

test: test-py test-fe

test-py:
	python3 -m pytest tests/ --ignore=tests/e2e -q

test-fe:
	cd frontend && npx vitest run

test-e2e:
	python3 -m pytest tests/e2e/ -v --timeout=60

coverage:
	python3 -m pytest tests/ --ignore=tests/e2e --cov=immi_case_downloader --cov-report=html -q
	@echo "Report: htmlcov/index.html"

# ── Code Quality ──────────────────────────────────────────────────────────────

lint:
	python3 -m ruff check immi_case_downloader/ scripts/ *.py

typecheck:
	cd frontend && npx tsc --noEmit

# ── Setup ─────────────────────────────────────────────────────────────────────

install:
	pip install -r requirements.txt
	pip install -r requirements-test.txt
	cd frontend && npm install

migrate:
	supabase db push

# ── Cleanup ───────────────────────────────────────────────────────────────────

clean:
	rm -rf frontend/dist htmlcov .coverage __pycache__
	find . -name "*.pyc" -delete
	find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
