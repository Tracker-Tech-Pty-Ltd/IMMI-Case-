# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Australian immigration court/tribunal case downloader and manager. Scrapes case metadata and full text from AustLII, stores as CSV/JSON (or Supabase/SQLite), and provides both a **Flask API** and a **React SPA** for browsing, editing, and exporting.

## Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run tests
pip install -r requirements-test.txt
python3 -m pytest                           # all Python tests (296 unit + 231 E2E)
python3 -m pytest tests/test_models.py      # models only
python3 -m pytest tests/e2e/react/ -x       # React E2E only
python3 -m pytest -x                        # stop on first failure

# Frontend unit tests (Vitest)
cd frontend && npx vitest run               # 83 frontend unit tests (14 test files)

# CLI - search for cases
python run.py search
python run.py search --databases AATA FCA --start-year 2020 --end-year 2025
python run.py download --courts FCA --limit 50
python run.py list-databases

# Web interface (React SPA at /app/, Legacy Jinja2 at /)
python web.py --port 8080                   # http://localhost:8080/app/

# React frontend development
cd frontend && npm run dev                  # Vite dev server (HMR)
cd frontend && npm run build                # Production build → static/react/

# Bulk download full text (resumable, saves every 200)
python download_fulltext.py

# LLM-based field extraction (case_nature, legal_concepts)
python extract_llm_fields.py               # uses Claude Sonnet, batched
python merge_llm_results.py                 # merge batch results into CSV
```

## Architecture

```
run.py                → CLI entry point → immi_case_downloader.cli.main()
web.py                → Web entry point → immi_case_downloader.webapp.create_app()
postprocess.py        → Post-download field extraction (regex + LLM sub-agents)
download_fulltext.py  → Bulk full-text downloader (resumable, saves every 200)

immi_case_downloader/
  models.py           → ImmigrationCase dataclass (22 fields, SHA-256 ID generation)
  config.py           → Constants: AustLII URLs, court database definitions, keywords
  storage.py          → CSV/JSON persistence (pandas), CRUD helpers
  repository.py       → CaseRepository Protocol (runtime_checkable)
  csv_repository.py   → Wraps storage.py for backward compat
  sqlite_repository.py→ SQLite+FTS5+WAL, thread-local connections
  supabase_repository.py → Supabase (PostgreSQL) backend, 15 methods, native FTS
  pipeline.py         → SmartPipeline: 3-phase auto-fallback (crawl → clean → download)
  cli.py              → argparse CLI with search/download/list-databases subcommands
  web/
    __init__.py       → Flask factory with API blueprint + SPA catch-all at /app/
    helpers.py        → get_repo(), safe_int(), safe_float(), EDITABLE_FIELDS
    jobs.py           → 4 background job runners with repo param
    security.py       → CSRF config
    routes/
      api.py          → /api/v1/* JSON endpoints (22 endpoints) for React SPA
      legislations.py → /api/v1/legislations/* endpoints (3 routes: list, detail, search)
      dashboard.py    → Legacy Jinja2 dashboard
      cases.py        → Legacy Jinja2 case CRUD
      search.py       → Legacy Jinja2 search
      export.py       → CSV/JSON export
      pipeline_routes.py → Pipeline actions
      update_db.py    → Legacy update DB
  sources/
    base.py           → BaseScraper: requests.Session with retry, rate limiting
    austlii.py        → AustLIIScraper: browse year listings + keyword search fallback
    federal_court.py  → FederalCourtScraper: search2.fedcourt.gov.au with pagination
  templates/          → 14 Jinja2 templates (legacy, accessible at original routes)
  static/
    style.css         → Legacy CSS
    react/            → Vite build output (served by Flask at /app/)

frontend/             → React SPA (Vite 6 + React 18 + TypeScript + Tailwind v4)
  src/
    pages/            → 14 pages (Dashboard, Analytics, Cases CRUD, Compare, Download, Pipeline, **Legislations**, etc.)
    components/       → Shared (Breadcrumb, CourtBadge, ConfirmModal, etc.) + layout
    hooks/            → TanStack Query hooks (use-cases, use-stats, use-theme, use-keyboard, **use-legislations**)
    lib/api.ts        → CSRF-aware fetch wrapper for all API calls (includes legislations endpoints)
    tokens/           → Design tokens JSON → CSS + TS build pipeline
  scripts/build-tokens.ts → Token pipeline: JSON → CSS + TS
```

### Key Design Patterns

- **Dual UI**: React SPA at `/app/` + legacy Jinja2 at `/`. API at `/api/v1/*`.
- **CaseRepository Protocol**: Abstracts storage backend. CSV (default), SQLite (FTS5+WAL), Supabase (PostgreSQL).
- **Scraper hierarchy**: `BaseScraper` handles HTTP session, rate limiting (1s delay), retry. `AustLIIScraper` and `FederalCourtScraper` inherit.
- **Two-phase data collection**: Stage 1 (search) populates basic metadata. Stage 2 (download) extracts detailed fields via regex.
- **Background jobs**: Daemon threads with `_job_status` dict for progress tracking. One job at a time.
- **Smart Pipeline**: 3-phase workflow (crawl → clean → download) with auto-fallback strategies.
- **Case identification**: `case_id` = first 12 chars of SHA-256 hash of citation/URL/title.

### Data Flow

1. Scraper fetches listing pages → parses HTML with BeautifulSoup/lxml → creates `ImmigrationCase` objects
2. Cases deduplicated by URL across sources
3. Repository persists via CSV, SQLite, or Supabase
4. React SPA reads from `/api/v1/*` endpoints, filters/sorts on backend
5. Download phase fetches individual case pages → extracts metadata via regex → saves full text

## Data Sources

| Code | Source | URL Pattern | Years |
|------|--------|-------------|-------|
| AATA | AustLII | `austlii.edu.au/au/cases/cth/AATA/{year}/` | 2000-2024 |
| ARTA | AustLII | `austlii.edu.au/au/cases/cth/ARTA/{year}/` | 2024+ |
| FCA | AustLII | `austlii.edu.au/au/cases/cth/FCA/{year}/` | 2000+ |
| FMCA | AustLII | `austlii.edu.au/au/cases/cth/FMCA/{year}/` | 2000-2013 |
| FCCA | AustLII | `austlii.edu.au/au/cases/cth/FCCA/{year}/` | 2013-2021 |
| FedCFamC2G | AustLII | `austlii.edu.au/au/cases/cth/FedCFamC2G/{year}/` | 2021+ |
| HCA | AustLII | `austlii.edu.au/au/cases/cth/HCA/{year}/` | 2000+ |
| RRTA | AustLII | `austlii.edu.au/au/cases/cth/RRTA/{year}/` | 2000-2015 |
| MRTA | AustLII | `austlii.edu.au/au/cases/cth/MRTA/{year}/` | 2000-2015 |
| fedcourt | Federal Court | `search2.fedcourt.gov.au/s/search.html` | (DNS broken) |

### Court Lineage

- **Lower court**: FMCA (2000-2013) → FCCA (2013-2021) → FedCFamC2G (2021+)
- **Tribunal**: RRTA + MRTA (pre-2015) → AATA (2015-2024) → ARTA (2024+)
- **AATA 2025-2026**: direct listing returns 500; use ARTA for 2025+
- **RRTA/MRTA/ARTA**: `IMMIGRATION_ONLY_DBS` — all cases are immigration-related, keyword filter skipped

## Gotchas

- **`cmd_search` merge logic** — merges by URL dedup; `max_results` defaults to 500/db
- **`config.py START_YEAR`** — dynamic (`CURRENT_YEAR - 10`); use `--start-year` flag to override
- **pandas NaN** — empty CSV fields become `float('nan')`; always use `ImmigrationCase.from_dict()`
- **Federal Court DNS** — `search2.fedcourt.gov.au` doesn't resolve; all FCA data via AustLII
- **RRTA/MRTA** — case titles use anonymized IDs (e.g. `N00/12345`), not keywords; `IMMIGRATION_ONLY_DBS` skips filter
- **Port 5000** — conflicts with macOS AirPlay; use `--port 8080`
- **AustLII 410 blocking** — rejects default `python-requests` User-Agent with HTTP 410; `BaseScraper` uses browser-like UA
- **AustLII rate limiting** — bulk scraping triggers IP block; typically resolves in hours

## React Frontend Gotchas

- **Recharts dark mode tooltips** — ALL Tooltip `contentStyle` must include `color: "var(--color-text)"` or text is invisible on dark backgrounds
- **TanStack Query navigation flash** — use `keepPreviousData` in all filter-dependent hooks to prevent empty state flash during rapid page switching
- **Theme system** — `use-theme-preset.ts` (current), NOT `use-theme.ts` (legacy). localStorage keys: `theme-preset`, `theme-dark`, `theme-custom-vars`
- **Dashboard empty state** — shows "Welcome to IMMI-Case" when `stats.total_cases === 0 && !isFetching`; guard with `isFetching` to avoid false empty state
- **E2E tests must match UI** — after renaming Dashboard sections, update test assertions in `tests/e2e/react/test_react_dashboard.py`
- **Analytics page** — at `/analytics` route, uses 4 API endpoints: `/api/v1/analytics/{outcomes,judges,legal-concepts,nature-outcome}`
- **i18n defaultValue pattern** — always use `t("key", { defaultValue: "English text" })` for UI text; i18n mock in tests returns the key string without `defaultValue`, causing test assertion failures
- **localStorage must be try-catch wrapped** — all `localStorage.getItem/setItem/removeItem` calls are wrapped in try-catch; throws in incognito/private mode and when quota exceeded
- **Use `.toSorted()` not `.sort()`** — never mutate arrays in React; `.toSorted()` returns a new array (ES2023, requires `"lib": ["ES2023"]` in `frontend/tsconfig.app.json`)
- **animate-spin on wrapper div** — put `animate-spin` on a `<div>` wrapper, NOT on `<Loader2>` or `<RefreshCw>` directly; SVG elements are not hardware-accelerated for CSS animations
- **useCallback deps must include `t`** — `const { t } = useTranslation()` — `t` must be in the dependency array of all `useCallback`/`useMemo` that call it

## Legislations Feature (NEW - 2026-02-20)

**新增功能**：澳洲移民法律瀏覽器
- **Pages**: `LegislationsPage` (列表 + 搜尋 + 分頁), `LegislationDetailPage` (詳細內容)
- **API**: `/api/v1/legislations/` (list, detail, search) — 3 個端點，28 個單元測試
- **Hooks**: `useListLegislations`, `useGetLegislation`, `useSearchLegislations` (TanStack Query v5)
- **Data**: `immi_case_downloader/data/legislations.json` (6 部澳洲移民相關法律)
- **i18n**: 英文 + 繁體中文翻譯完整支援
- **Navigation**: Sidebar 中的「法律法規」導航項目已配置
- **Routing**: `/legislations` 主頁面，`/legislations/<id>` 詳細頁面
- **Tests**: API 單元測試 28/28 通過 ✓，覆蓋率 76%
- **Build**: 前端構建成功，無 TypeScript 錯誤

**架構說明**：
- 資料源：靜態 JSON 檔案（無需爬蟲）
- API 層：Flask Blueprint 模式，3 個 REST 端點
- 前端層：React SPA，支援搜尋（最少 2 個字）、分頁、多語言
- 禁用功能：下載/匯出（按需求）

## Judge Features (Improved - 2026-02-20)

**法官分析功能改進**：
- **Pages**: `JudgeProfilesPage` (排行榜), `JudgeDetailPage` (詳細分析), `JudgeComparePage` (對比)
- **Components**: `JudgeHero` (統一展示), `JudgeCard` (列表項), `JudgeLeaderboard` (排名)
- **Navigation**: JudgeDetailPage 新增分段導航 (section-outcomes, section-trend, section-court, section-visa, section-nature, section-representation, section-country, section-concepts, section-recent)
- **i18n**: 完整繁體中文翻譯，包含法官分析頁面標籤
- **Styling**: 改進響應式布局，優化代碼格式化
- **Data**: 15,465 個獨特法官記錄，需進行名字正規化（模糊匹配）
- **Features**:
  - 法官成功率分析（按法庭、簽證類別、案件性質分類）
  - 法官概念有效性追蹤
  - 法官對比分析功能
  - 多層級過濾和排序

**已知限制**：
- 法官名字標準化（15,465 記錄需要整合至 ~3,000-4,000 實人）
- 缺少律師代理數據（representative_name 僅為 Y/N 標記）
- 法律概念需要大小寫正規化

## MCP Servers Configuration (2026-02-20)

**已配置的 MCP 伺服器**（位置：`.mcp.json`）：

| MCP | 用途 | 狀態 |
|-----|------|------|
| **context7** | 文件上下文關聯與知識檢索 | ✅ 啟用 |
| **supabase** | Supabase PostgreSQL 資料庫操作 | ✅ 啟用 |

**Supabase MCP 可用工具**：
- 資料庫查詢 (SQL 執行)
- 表格管理 (CRUD 操作)
- 行數據批次處理
- RPC 函數調用
- 實時事件監聽

**相關文件**：
- Supabase 專案 URL: `https://urntbuqczarkuoaosjxd.supabase.co`
- 數據狀態: 149,016 個案件記錄已同步至 Supabase
- 認證方式: Publishable API Key (環境變數: `SUPABASE_ANON_KEY`)

## Structured Field Extraction (`extract_structured_fields.py`)

- Run: `python3 extract_structured_fields.py --workers 8` (parallel, ~12min for 149K cases)
- Re-extract all: `python3 extract_structured_fields.py --workers 8 --overwrite`
- Dry-run test: `python3 extract_structured_fields.py --dry-run --sample 500 --workers 4`
- **Fill rates (2026-02-22)**: applicant_name 90.0% | visa_subclass 91.6% | hearing_date 78.7% | country 67.8% | respondent 32.7% | is_represented **42.4%** | representative **25.1%** | visa_outcome_reason **58.7%** | legal_test_applied **36.2%**
- **New fields**: `visa_outcome_reason` (from CATCHWORDS, ≤300 chars) + `legal_test_applied` (from section refs, ≤80 chars)
- **respondent ceiling is ~33%** — MRTA/RRTA/AATA are one-party tribunal reviews; no legal respondent exists
- **is_represented ceiling ~55% with regex** — many older MRTA cases lack explicit representation text
- **After running**, re-sync: `python3 migrate_csv_to_supabase.py`
- Uses `ProcessPoolExecutor.map(chunksize=500)` — do NOT use `executor.submit()` for 149K+ rows (OOM)
- Do NOT run two instances simultaneously — both write to same CSV

## LLM-Assisted Structured Extraction (`extract_structured_fields_llm.py`)

- Requires `ANTHROPIC_API_KEY` in `.env` (Claude Code's built-in key does NOT work for user scripts)
- Run: `python3 extract_structured_fields_llm.py --workers 8` (targets unfilled fields only)
- Test: `python3 extract_structured_fields_llm.py --sample 500 --workers 4 --dry-run`
- Batches 20 cases per API call, 8 parallel threads, checkpoint saves every 500 cases
- After running, re-sync: `python3 migrate_csv_to_supabase.py`

## Extraction Validation (`validate_extraction.py`)

- Run: `python3 validate_extraction.py` — fill rates by field + court, garbage value check, samples
- `python3 validate_extraction.py --court AATA` — filter by court
- `python3 validate_extraction.py --field country_of_origin` — sample one field
- `python3 validate_extraction.py --compare-to baseline.csv` — regression detection

## Important Notes

- `downloaded_cases/` is gitignored — all scraped data is local only
- **149,016 case records** (2000-2026): **148,966 with full text** (99.96%), 9 structured fields extracted (31 total fields)
- 9 courts/tribunals: MRTA 52,970 | AATA 39,203 | FCA 14,987 | RRTA 13,765 | FCCA 11,157 | FMCA 10,395 | FedCFamC2G 4,109 | ARTA 2,260 | HCA 176
- **Supabase Cloud**: 149,016 records fully synced (Project: Bsmart, `urntbuqczarkuoaosjxd`)
- Rate limiting enforced at `BaseScraper` level; respect default 1-second delay
- Test suite: 610 tests total — 296 Python unit + 231 Playwright E2E (`python3 -m pytest`) + 83 frontend unit (`cd frontend && npx vitest run`)
- CSRF protection via flask-wtf; `/api/v1/csrf-token` endpoint for React SPA
- Security headers (CSP, X-Frame-Options, etc.) set via `@app.after_request`
- Default host is `127.0.0.1` (localhost only); use `--host 0.0.0.0` to expose externally
- React SPA build: `cd frontend && npm run build` → outputs to `immi_case_downloader/static/react/`
