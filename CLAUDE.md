# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Australian immigration court/tribunal case downloader and manager. Scrapes case metadata and full text from AustLII, stores as CSV/JSON (or Supabase/SQLite), and provides a **React SPA** for browsing, editing, and exporting.

**Production data layer**: Cloudflare Worker (`workers/proxy.js`) handles all read traffic natively via Hyperdrive → Supabase PostgreSQL — Flask Container is only used for writes, LLM search, CSRF, and React SPA serving.

## Commands

```bash
make install      # Install all Python + Node dependencies
make api          # Flask API only (http://localhost:8080)
make ui           # Vite dev server only (http://localhost:5173, HMR)
make build        # Build React frontend → immi_case_downloader/static/react/
make test         # All tests: Python unit + frontend Vitest
make test-py      # Python unit tests only (excludes E2E)
make test-fe      # Frontend Vitest tests only
make test-e2e     # Playwright E2E (requires running server)
make coverage     # Python unit tests with HTML coverage report
make lint         # Ruff lint Python source
make typecheck    # TypeScript type check (tsc --noEmit)
make migrate      # Push pending Supabase migrations (supabase db push)

# Run a single Python test file
python3 -m pytest tests/test_models.py -x
python3 -m pytest tests/e2e/react/ -x --timeout=60

# Run a single Vitest test file
cd frontend && npx vitest run src/__tests__/components/judges/

# CLI
python run.py search --databases AATA FCA --start-year 2020
python run.py download --courts FCA --limit 50
python run.py list-databases

# Full-text bulk download (resumable, saves every 200)
python download_fulltext.py

# LLM field extraction
python extract_llm_fields.py               # uses Claude Sonnet, batched
python merge_llm_results.py               # merge batch results into CSV
```

Use `PORT=8080 BACKEND=auto|sqlite|csv|supabase make api` to override defaults.

## Environment Variables (Critical)

Source of truth: `.env.example` (NOT this section — re-verify with `cat .env.example` if anything looks off). Real keys grouped by purpose:

**Flask security**
- `SECRET_KEY` — generate with `python3 -c "import secrets; print(secrets.token_hex(32))"`. **Required when `APP_ENV=production` or `staging`** (server refuses to start without it); dev mode auto-generates ephemeral.
- `APP_ENV` — `development` (default) | `staging` | `production`. Production-like values enable `Secure` cookie + strict CSRF.
- `TRUST_PROXY_HEADERS` — `false` (default). Only set `true` behind a trusted reverse proxy that rewrites `X-Forwarded-For`; otherwise rate-limit / IP rules can be bypassed by a forged header.

**Local dev endpoint** (read by both Flask and Vite proxy)
- `BACKEND_HOST=127.0.0.1` (use `0.0.0.0` to expose externally)
- `BACKEND_PORT=8080` (5000 conflicts with macOS AirPlay)

**Supabase backend** (required only when `python web.py --backend supabase`)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side; **no anon key in `.env.example`** despite what older docs say)

**LLM Council via Cloudflare AI Gateway — unified billing** (the LLM architecture this project actually uses; commonly missed)
- `CF_AIG_TOKEN` (`cfut_*`) — single Cloudflare token for unified billing across OpenAI / Anthropic / Google AI Studio. Auth header is `cf-aig-authorization`. Credits at `dash.cloudflare.com → AI → AI Gateway`.
- `LLM_COUNCIL_CF_GATEWAY_URL` — defaults to the project's `immi-council` compat endpoint.
- Model routing requires provider prefix on compat endpoint: `openai/<model>`, `anthropic/<model>`, `google-ai-studio/<model>`. Defaults: gpt-5-mini, gemini-3.1-pro-preview, claude-sonnet-4-6, gemini-2.5-flash (moderator).
- Token caps: `LLM_COUNCIL_MAX_OUTPUT_TOKENS=4096` (experts), `LLM_COUNCIL_MODERATOR_MAX_TOKENS=8192` (14-field JSON), `LLM_COUNCIL_TIMEOUT_SECONDS=120`. The 4096 cap was probe-validated — `gemini-2.5-pro` returned `completion=0` at 2400.
- **Do NOT add per-provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) for LLM Council** — credits flow through CF Gateway. Per-provider keys are only needed by standalone scripts (e.g. `extract_structured_fields_llm.py` direct Anthropic calls, `backfill_case_embeddings.py` OpenAI embeddings) and must be supplied by the user separately if running those.

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
  cases_pagination.py → Seek pagination planner for /api/v1/cases (date/year sorts);
                        maintains an in-memory anchor cache (TTL 300s, max 128 entries)
  visa_registry.py    → VISA_REGISTRY: canonical subclass→name→family lookup; used by
                        Worker proxy and Flask analytics for visa family grouping
  cli.py              → argparse CLI with search/download/list-databases subcommands
  web/
    __init__.py       → Flask factory with API blueprint + SPA catch-all at /app/
    helpers.py        → get_repo(), safe_int(), safe_float(), EDITABLE_FIELDS
    cache.py          → AnalyticsCache: TTL-based in-memory cache for analytics RPCs
    jobs.py           → 4 background job runners with repo param
    security.py       → CSRF config + rate_limit decorator
    routes/
      api.py          → /api/v1/* JSON endpoints (~30 endpoints) for React SPA
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
    federal_court.py  → FederalCourtScraper: search2.fedcourt.gov.au (DNS broken)

frontend/             → React SPA (Vite 6 + React 18 + TypeScript + Tailwind v4)
  src/
    pages/            → 25 pages including:
                        DashboardPage, CasesPage, CaseDetailPage, CaseEditPage,
                        CaseAddPage, CaseComparePage, AnalyticsPage,
                        JudgeProfilesPage, JudgeDetailPage, JudgeComparePage,
                        LegislationsPage, LegislationDetailPage,
                        CourtLineagePage, DownloadPage, PipelinePage,
                        CollectionsPage, CollectionDetailPage,
                        GuidedSearchPage, SemanticSearchPage, SavedSearchesPage,
                        LlmCouncilPage, DataDictionaryPage,
                        TaxonomyPage, SearchTaxonomyPage,
                        DesignTokensPage, JobStatusPage
    components/       → Shared (Breadcrumb, CourtBadge, ConfirmModal, etc.) + layout
    hooks/            → TanStack Query hooks (use-cases, use-stats, use-theme,
                        use-keyboard, use-legislations, etc.)
    lib/api.ts        → CSRF-aware fetch wrapper; defines per-endpoint timeout constants
    lib/router.ts     → resolveRouterBasename(): auto-detects / vs /app/ basename
    tokens/           → Design tokens JSON → CSS + TS build pipeline
  scripts/build-tokens.ts → Token pipeline: JSON → CSS + TS

workers/
  proxy.js            → Main Cloudflare Worker: read-path via Hyperdrive, write-path
                        via Flask Container, React SPA serving (see §Worker Architecture)
  austlii-scraper/    → Separate Cloudflare Worker for async bulk AustLII scraping
                        Uses Cloudflare Queue (SCRAPE_QUEUE) + R2 bucket (CASE_RESULTS)
                        max_batch_size=5, max_concurrency=20, dead_letter_queue configured
```

### Key Design Patterns

- **Dual UI**: React SPA at `/app/` + legacy Jinja2 at `/`. API at `/api/v1/*`.
- **CaseRepository Protocol**: Abstracts storage backend. CSV (default), SQLite (FTS5+WAL), Supabase (PostgreSQL).
- **Scraper hierarchy**: `BaseScraper` handles HTTP session, rate limiting (1s delay), retry. `AustLIIScraper` and `FederalCourtScraper` inherit.
- **Two-phase data collection**: Stage 1 (search) populates basic metadata. Stage 2 (download) extracts detailed fields via regex.
- **Background jobs**: Daemon threads with `_job_status` dict for progress tracking. One job at a time.
- **Smart Pipeline**: 3-phase workflow (crawl → clean → download) with auto-fallback strategies.
- **Case identification**: `case_id` = first 12 chars of SHA-256 hash of citation/URL/title.

### Worker Architecture (Production)

All GET requests to `/api/v1/*` are intercepted by `proxy.js` first. If a native Hyperdrive handler exists, Flask is **never called**. Only unmatched paths fall through.

```
Request → Cloudflare Worker (proxy.js)
│
├── GET /api/v1/*  ── Native Hyperdrive path (44 endpoints as of 2026-05-02 — verify with `grep -c "^async function handle\\|^function handle" workers/proxy.js`)
│   │
│   ├── /api/v1/cases                          → handleGetCases
│   ├── /api/v1/cases/count                    → handleGetCasesCount
│   ├── /api/v1/cases/:id  (12 hex chars)      → handleGetCase
│   ├── /api/v1/cases/compare                  → handleCompareCases       (batch SQL)
│   ├── /api/v1/cases/:id/related              → handleRelatedCases       (find_related_cases RPC)
│   ├── /api/v1/stats                          → handleGetStats
│   ├── /api/v1/stats/trends                   → handleStatsTrends
│   ├── /api/v1/filter-options                 → handleGetFilterOptions
│   ├── /api/v1/court-lineage                  → handleCourtLineage       (get_court_year_trends RPC + JS structure)
│   ├── /api/v1/data-dictionary                → handleDataDictionary     (static JS const, no DB)
│   ├── /api/v1/visa-registry                  → handleVisaRegistry       (static JS const, no DB)
│   ├── /api/v1/taxonomy/countries             → handleTaxonomyCountries  (GROUP BY SQL)
│   ├── /api/v1/analytics/outcomes             → handleAnalyticsOutcomes
│   ├── /api/v1/analytics/judges               → handleAnalyticsJudges
│   ├── /api/v1/analytics/legal-concepts       → handleAnalyticsLegalConcepts
│   ├── /api/v1/analytics/nature-outcome       → handleAnalyticsNatureOutcome
│   ├── /api/v1/analytics/filter-options       → handleAnalyticsFilterOptions
│   ├── /api/v1/analytics/monthly-trends       → handleAnalyticsMonthlyTrends
│   ├── /api/v1/analytics/flow-matrix          → handleAnalyticsFlowMatrix
│   ├── /api/v1/analytics/judge-bio            → handleAnalyticsJudgeBio
│   ├── /api/v1/analytics/visa-families        → handleAnalyticsVisaFamilies
│   ├── /api/v1/analytics/success-rate         → handleAnalyticsSuccessRate
│   ├── /api/v1/analytics/concept-effectiveness→ handleAnalyticsConceptEffectiveness
│   ├── /api/v1/analytics/concept-cooccurrence → handleAnalyticsConceptCooccurrence
│   ├── /api/v1/analytics/concept-trends       → handleAnalyticsConceptTrends
│   ├── /api/v1/analytics/judge-leaderboard    → handleAnalyticsJudgeLeaderboard
│   ├── /api/v1/analytics/judge-profile        → handleAnalyticsJudgeProfile
│   └── /api/v1/analytics/judge-compare        → handleAnalyticsJudgeCompare
│       ↳ handler returns null → falls through to Flask (e.g. tag filter active)
│       ↳ handler throws → falls through to Flask (Hyperdrive error recovery)
│
└── Everything else → Flask Container (Durable Object "flask-v15" — bumped from v13. See `workers/proxy.js:2475` for current)
    ├── POST/PUT/DELETE /api/v1/*   (writes — need Python validation)
    ├── GET /api/v1/search          (semantic/LLM — needs OpenAI/Gemini SDK)
    ├── GET /api/v1/csrf-token      (session-based)
    ├── GET /api/v1/legislations/*  (3 endpoints, static JSON)
    ├── /app/*  and  /             (React SPA catch-all → index.html)
    └── Any unmatched GET /api/v1/* path
```

**Adding a new GET endpoint?** If it only reads DB → implement in Worker with `getSql(env)` + postgres.js template literal. Do NOT add to Flask just because it's easier.

**Critical**: `getSql(env)` creates a new `postgres` client **per request** — module-level singletons cause "Cannot perform I/O on behalf of a different request" errors in Workers. Hyperdrive manages actual connection pooling.

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
- **Worker postgres client** — always create per-request via `getSql(env)`, never module-level singleton (I/O context binding)
- **Tag filtering** — `buildCasesWhere()` returns `null` for `tag` param; Worker falls back to Flask (pipe-delimited array logic)

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
- **Tailwind v4 `@layer base` 必要** — `index.css` 全域 heading 樣式必須在 `@layer base {}` 內。未分層的 CSS 優先於所有 `@layer` 樣式，導致 `h1 { font-size: 3rem }` 覆蓋所有 `text-[clamp(...)]` utility 類別。
- **響應式 flex-wrap 防孤立** — filter row 相關元素（separator + 下拉選單）需包在同一 `<div>` 一起換行；裝飾性分隔符用 `hidden sm:inline`；輸入框用 `flex-1 min-w-[X]` 防止寬度歸零。
- **JudgeLeaderboard 雙視圖** — `md:hidden` 手機卡片視圖 + `hidden md:block overflow-x-auto` 桌面表格，是整個 app 響應式表格的標準模式。
- **API timeouts** — `lib/api.ts` defines per-category timeouts: analytics heavy=20s, analytics=15s, filter-options=8s, dashboard stats=12s, general=20s. Analytics RPCs have a 25s server-side timeout (`ANALYTICS_RPC_TIMEOUT_SECONDS`); dashboard stats cache TTL=5min.

## Legislations Feature

**澳洲移民法律瀏覽器**
- **Pages**: `LegislationsPage` (列表 + 搜尋 + 分頁), `LegislationDetailPage` (詳細內容)
- **API**: `/api/v1/legislations/` (list, detail, search) — 3 個端點，28 個單元測試
- **Data**: `immi_case_downloader/data/legislations.json` (6 部澳洲移民相關法律)
- **Routing**: `/legislations` 主頁面，`/legislations/<id>` 詳細頁面
- 下載/匯出功能已禁用（按需求）

## Judge Features

- **Pages**: `JudgeProfilesPage` (排行榜), `JudgeDetailPage` (詳細分析), `JudgeComparePage` (對比)
- **Navigation**: JudgeDetailPage 新增分段導航 (section-outcomes, section-trend, section-court, section-visa, section-nature, section-representation, section-country, section-concepts, section-recent)
- **Data**: 15,465 個獨特法官記錄，需進行名字正規化（模糊匹配）

## Judge Bios Database

**104 位 MRT/AAT/ART 成員傳記資料**（`downloaded_cases/judge_bios.json`，gitignored）：
- **資料表**: `judge_bios` — SQLite (`cases.db`) 和 Supabase（含 FTS5 全文搜索）
- **API**: `GET /api/v1/analytics/judge-bio?name=<judge_name>` — 回傳完整傳記含 `legal_status`
- **Migration**: `supabase/migrations/20260227100000_add_judge_bios_legal_status.sql`
- **同步**: 修改 `judge_bios.json` 後需手動執行 `python sync_judge_bios_supabase.py`

## MCP Servers Configuration

**已配置的 MCP 伺服器**（位置：`.mcp.json`）：context7（文件上下文）、supabase（PostgreSQL 操作）

- Supabase 專案 URL: `https://urntbuqczarkuoaosjxd.supabase.co`
- 數據狀態: 149,016 個案件記錄已同步至 Supabase

## Production Deployment (Cloudflare Workers)

- **Production URL**: `https://immi.trackit.today`
- **Worker custom domain syntax**: `[[routes]]` + `pattern = "host"` + `custom_domain = true`. **NOT** `[[custom_domains]]` (invalid). `pattern = "host/*"` only works if DNS already exists.
- **CI must `npm ci` before `wrangler deploy`** — `postgres` package imported by `workers/proxy.js` not auto-installed
- **SPA basename** — `resolveRouterBasename()` in `frontend/src/lib/router.ts` auto-detects `/` vs `/app/`
- **Durable Object name**: `idFromName("flask-v13")` — bumping suffix creates fresh container state; keep stable unless intentionally resetting
- **Testing fresh domains**: macOS DNS cache lies — use `curl --resolve host:443:<CF_IP>` to bypass; flush with `sudo dscacheutil -flushcache`
- **austlii-scraper Worker**: separate deploy in `workers/austlii-scraper/`; set `AUTH_TOKEN` via `wrangler secret put AUTH_TOKEN`

## Structured Field Extraction

```bash
python3 extract_structured_fields.py --workers 8        # parallel, ~12min for 149K cases
python3 extract_structured_fields.py --workers 8 --overwrite  # re-extract all
python3 extract_structured_fields.py --dry-run --sample 500 --workers 4

python3 validate_extraction.py                          # fill rates + garbage check
python3 validate_extraction.py --court AATA             # filter by court
python3 validate_extraction.py --field country_of_origin  # sample one field

# After any extraction run, re-sync:
python3 migrate_csv_to_supabase.py
```

**Fill rates (2026-02-22)**: applicant_name 90.0% | visa_subclass 91.6% | hearing_date 78.7% | country 67.8% | is_represented 42.4% | representative 25.1%

Uses `ProcessPoolExecutor.map(chunksize=500)` — do NOT use `executor.submit()` for 149K+ rows (OOM). Do NOT run two instances simultaneously — both write to same CSV.

LLM-assisted extraction (`extract_structured_fields_llm.py`) requires `ANTHROPIC_API_KEY` in `.env` (Claude Code's built-in key does NOT work for user scripts).

## Important Notes

- `downloaded_cases/` is gitignored — all scraped data is local only
- **149,016 case records** (2000-2026): 9 courts/tribunals: MRTA 52,970 | AATA 39,203 | FCA 14,987 | RRTA 13,765 | FCCA 11,157 | FMCA 10,395 | FedCFamC2G 4,109 | ARTA 2,260 | HCA 176
- **Test suite** (source-counted via `grep "def test_"` / `it\|test\(`, not pytest collect — re-verify with `pytest --collect-only -q | tail -1`): ~1,740 tests — 1,032 Python unit (50 files) + 259 Playwright E2E (24 files) + 449 frontend unit (50 files, Vitest). `@pytest.mark.parametrize` expansion makes pytest collect count higher.
- CSRF protection via flask-wtf; `/api/v1/csrf-token` endpoint for React SPA
- Default host is `127.0.0.1`; use `--host 0.0.0.0` to expose externally

## Design Context

**主要使用者：移民申請人（自助申請者）**。非法律專業人士，在壓力情境下使用此工具。品牌：**權威（Authoritative）、精準（Precise）、學術（Academic）**。

**已確認美學方向：「法律典籍」（Legal Codex）**
- 暖米白背景（`#f5f4f1`）+ 深海軍藍（`#1b2838`）+ 琥珀金 accent（`#d4a017`）
- Crimson Text（標題 serif）、法庭專屬色彩編碼（9 種）、深色模式主題切換動畫速度**不得改變**
- Analytics 圖表採 Data Dashboard 視覺語言（Grafana/Metabase 風格）
- 所有間距、陰影、圓角必須從 `tokens.json` 取值，不得出現魔法數字

**設計原則**：信任優先於美觀 > 深度理解感 > 分析頁是數據主角 > 效率感貫穿全局 > 系統性一致性
