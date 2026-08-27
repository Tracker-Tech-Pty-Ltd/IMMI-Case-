# Plan 043: Fix the counts, the stack facts and the commands that do not work

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — **only if that file already exists**; do not create it.
>
> This plan edits **documentation only**. It must not change a single line of
> Python, TypeScript, JavaScript, SQL, TOML, YAML or JSON.
>
> **Drift check (run first)**:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
>   git diff --stat 42826a3..HEAD -- README.md frontend/README.md .env.example
> ```
> If any of those files changed since this plan was written, compare the
> "Current state" excerpts below against the live files before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/002-fix-test-collection-and-install.md` (which itself
  depends on `plans/001-restore-the-frontend-compile-gate.md`)
- **Category**: docs
- **Planned at**: commit `42826a3`, 2026-08-27

**Why the dependency is hard, not advisory**: this plan tells readers to run
`.venv/bin/python -m pip install -r requirements-e2e.txt` before `make test-e2e`.
That file **does not exist at `42826a3`** — plan 002 creates it. Writing an
install instruction for a file that is not there is the exact failure this plan
exists to eliminate. Plan 002 also widens the Vitest `include` glob in
`frontend/vitest.config.ts`, which changes what `frontend/README.md` should say
about where tests live. Run 002 first.

## Why this matters

`README.md` is the front door: it is what a new contributor, and every agent
that lands in this repo, reads first. Right now three classes of statement in it
are false. (1) **Commands that cannot work**: §4.5 tells you to run
`python3 -m pytest`, which aborts with `20 errors during collection` on a fresh
clone because `tests/e2e/**` imports `playwright.sync_api` and no requirements
file installs it — and no document anywhere in the repo says to install it.
(2) **Counts that drifted**: `149,016` cases appears five times in `README.md`
while the repo's own state record says production is at `151,295` and grows every
Tuesday; the §13 per-court rows do not even sum to the total they print
(149,022 vs 149,016); and the SPA is described as 24 pages when there are 27.
(3) **Stack facts from the retired architecture**: the two sections a reader
actually reads say semantic search is "pgvector HNSW + OpenAI/Gemini 嵌入", while
production runs Cloudflare Vectorize with 1024-dim Workers AI `qwen3-embedding-0.6b`
— a dimension mismatch that `scripts/check_immi_activation_evidence.py` exists to
reject, so the README actively steers people into a fail-closed gate. On top of
that, the troubleshooting section routes AustLII-IP-block recovery through Worker
HTTP endpoints deleted in `d0972db`, points at a migration file that moved to
`supabase/archive/`, and the roadmap invites someone to build multi-user auth
that shipped on 2026-05-03. Finally `frontend/README.md` is still the unmodified
Vite scaffold, so a frontend-scoped contributor gets zero project information.

After this plan, every command in `README.md` runs, every number is either
correct or explicitly stamped/derived, and the stack description matches
`docs/ARCHITECTURE.md`.

## Current state

### Files this plan touches

- `README.md` — 636 lines, the project front door. Sections §4.2 Install,
  §4.3 Configure, §4.5 Test, §5.2 API, §7 Project Structure, §9 Roadmap,
  §10 Troubleshooting, §12 Tech Stack, §13 Data Coverage, §14 License all
  contain at least one of the three defect classes.
- `frontend/README.md` — 74 lines, verbatim `npm create vite@latest` output.

### Files read for evidence but NOT modified

- `.env.example` — 25 assignments; source of truth for env vars.
- `Makefile`, `requirements-test.txt`, `frontend/vitest.config.ts`,
  `frontend/package.json`, `docs/ARCHITECTURE.md`, `.claude/STATE.md`,
  `scripts/enqueue_urls.py`, `frontend/src/pages/LoginPage.tsx`.

### Verbatim excerpts (read at `42826a3` on 2026-08-27)

`README.md:3` — the headline number:

```
> 149,016 個案件。9 個法院。26 年判決紀錄。一個可搜尋的真相。
```

`README.md:16` — the page count (there are 27 `.tsx` files in
`frontend/src/pages/`, verified with `ls frontend/src/pages/*.tsx | wc -l`):

```
- **React SPA**：24 個頁面，雙語（English + 繁體中文），完整深色模式，設計令牌系統
```

`README.md:20` — the stack fact that contradicts `docs/ARCHITECTURE.md`:

```
- 語意搜尋：pgvector HNSW + OpenAI/Gemini 嵌入，支援 lexical / semantic / hybrid 三模式
```

`README.md:40` — the same stale number inside the ASCII poem:

```
149,016 threads.
```

`README.md:89` — the feature table repeats the retired stack:

```
| **語意搜尋** | pgvector HNSW，三模式（lexical/semantic/hybrid） | 關鍵字搜不到的案件，語意能找到 | 判決策略研究效率 10× |
```

`README.md:110-122` — §4.2 Install. Installs into the ambient interpreter (no
venv) and never installs the **root** `node_modules`, which `make test-workers`
needs:

```
### 4.2 Install

```bash
# Clone
git clone <repo-url>
cd IMMI-Case-

# Python dependencies
pip install -r requirements-app.txt -r requirements-test.txt

# Frontend dependencies
cd frontend && npm install && cd ..
```
```

`README.md:131-133` — §4.3's env table header and first two table lines. The
table has **15 rows**; `.env.example` has **25** assignments; **10 keys are
absent from the table entirely** (the four `JWT_*`, `VITE_TELEGRAM_BOT_NAME`,
`LLM_COUNCIL_TIMEOUT_SECONDS`, and the four `LLM_COUNCIL_SYSTEM_PROMPT_*`), and
two rows (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) document keys that are **not**
in `.env.example` at all:

```
**環境變數表**：

| Key | Required | Default | Description |
```

`README.md:176-191` — §4.5 Test. The first command aborts on a fresh clone:

```
### 4.5 Test

```bash
# Python 單元 + E2E 測試（~1,367 個 — 1,107 unit + 260 E2E，source-counted via `grep "def test_"`）
python3 -m pytest

# 僅前端單元測試（490 個 — 55 files，source-counted via `grep "(it|test)\("`）
cd frontend && npx vitest run

# 僅 E2E
python3 -m pytest tests/e2e/

# 快捷（Makefile）
make test-py
make test-fe
```
```

`README.md:257-258` — the local-dev Supabase curl example, presented with no
label distinguishing it from production:

```
# 語意搜尋（需要 pgvector + embeddings）
curl "http://localhost:8080/api/v1/search?q=well-founded+fear&mode=semantic&provider=openai"
```

`README.md:477` — the roadmap item for work that shipped on 2026-05-03:

```
| 多用戶認證（JWT + RBAC） | 🔴 高 | 🔴 高 | 🔴 高 | 中期 |
```

`README.md:500` — the AustLII-block workaround pointing at deleted endpoints:

```
- **Fix**：等待數小時（通常 4-12 小時自動解封）；或切換至 Cloudflare Workers 模式（`scripts/enqueue_urls.py`）
```

`README.md:528` — the migration pointer whose target moved:

```
- **Prevention**：`supabase/migrations/20260226040000_drop_hnsw_for_bulk_load.sql` 已處理此流程
```

`README.md:602-613` — §13 Data Coverage. The nine per-court rows sum to
**149,022**, but the Total row prints **149,016**:

```
| 法院 / 仲裁庭 | 代碼 | 案件數 | 年份 |
|---------------|------|:------:|------|
| Migration Review Tribunal | MRTA | 52,970 | 2000–2015 |
```
…
```
| **Total** | — | **149,016** | **2000–2026** |
```

`frontend/README.md:1-3` — the scaffold:

```
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.
```

### Corroborating facts (verified, not quoted from the README)

- `grep -rn playwright requirements*.txt` → **zero matches**.
  `requirements-test.txt` is exactly 7 lines: pytest, pytest-asyncio,
  pytest-cov, pytest-timeout, responses, freezegun, `ruff==0.15.18`.
- `.venv/bin/python -c 'import playwright'` → `ModuleNotFoundError`.
- `.venv/bin/python -m pytest tests/e2e --collect-only -q` →
  `42 tests collected, 20 errors` / `Interrupted: 20 errors during collection`.
- `tests/e2e/conftest.py:297` defines `def page(browser, base_url)`; the
  `browser` fixture is **not** defined anywhere in the repo, so it comes from
  the `pytest-playwright` plugin. Both `playwright` and `pytest-playwright` are
  required; installing `pytest-playwright` pulls `playwright` transitively.
- `.claude/STATE.md:69` records `生產：**151,295 total / 2026 年 2,478 筆**`
  (2026-08-25 snapshot) and `.claude/STATE.md:57` records the weekly VPS
  crawler cron `0 14 * * 1` UTC covering ARTA / FCA / FedCFamC2G / HCA. The
  case count therefore rises every Tuesday and must never be hardcoded again.
- `docs/ARCHITECTURE.md:43-46`: "Reads: Worker → D1 (`IMMI_CATALOG_DB`)
  directly, with FTS5 for lexical search and Vectorize (`CASE_VECTORS`) +
  Workers AI (`@cf/qwen/qwen3-embedding-0.6b`, 1024-dim) for semantic/
  related-case search."
- `docs/ARCHITECTURE.md:208-213`: `workers/austlii-scraper/` is
  "**cron-triggered only** since commit `d0972db` — its `fetch()` now serves
  only `/health` and 404s everything else; the `/enqueue`, `/scrape`,
  `/progress`, `/list`, `/batch-get`, and `/admin/discovery-diff` HTTP
  endpoints (and the `AUTH_TOKEN` secret they required) were removed."
  `scripts/enqueue_urls.py:5-6` still drives `/scrape` and `/enqueue`, so it
  cannot work against the deployed Worker.
- `find supabase -name '*drop_hnsw*'` →
  `supabase/archive/migrations-pre-baseline-2026-05-12/20260226040000_drop_hnsw_for_bulk_load.sql`.
  `ls supabase/migrations/` (18 entries) does **not** contain it.
- Auth shipped: `workers/auth/` contains `jwt.js`, `telegram.js`, `nonce_do.js`,
  `cloudflare_handlers.js`, `refresh_sessions.js`;
  `migrations/d1/account/0001_account.sql:29` declares
  `role TEXT NOT NULL CHECK(role IN ('owner','admin','member','viewer'))`;
  `CLAUDE.md`'s "Auth Architecture (Telegram Login + Multi-Tenant)" section is
  stamped `**Added**: 2026-05-03`.
- `frontend/src/pages/LoginPage.tsx:7`:
  `const BOT_NAME = import.meta.env.VITE_TELEGRAM_BOT_NAME || "immi_case_bot";`
  — so `VITE_TELEGRAM_BOT_NAME` silently falls back to a hardcoded bot name.
  It appears in **no** markdown file in the repo.
- `.env.example:55` comments the JWT block as
  `# JWT secrets (Wrangler secrets for Worker; also needed by Flask)` — they
  belong in **both** places, so do not tell readers to keep them out of `.env`.
- `frontend/vitest.config.ts:11` (not `vite.config.ts`) holds
  `include: ["__tests__/**/*.{test,spec}.{ts,tsx}"]`. `frontend/vite.config.ts`
  has no `test` block at all; its `build.outDir` is
  `"../immi_case_downloader/static/react"` (`frontend/vite.config.ts:34`).
- `frontend/src/__tests__/` **does not exist**. `ls frontend/__tests__/*.ts*`
  → 55 flat files plus one `auth/` subdirectory. `judge-pages.test.tsx` is one
  of them and is a valid single-file target.
- `frontend/tsconfig.json` is `{"files": [], "references": [...]}` only — path
  aliases live in `tsconfig.app.json`.
- `frontend/package.json`: react `^19.2.4`, vite `^7.3.1`; scripts `tokens`,
  `dev`, `build`, `build:cloudflare`, `dev:cloudflare`, `deploy:cloudflare`,
  `lint`, `preview`, `test`, `test:ui`, `test:coverage`, `e2e`, `e2e:ui`,
  `e2e:headed`.

### Repo conventions this plan must honor

These come from the project's own `CLAUDE.md` and must be reproduced faithfully
in the new `frontend/README.md` (they are the four things most likely to trip a
frontend contributor):

- **`.toSorted()` not `.sort()`** — never mutate arrays in React (ES2023;
  requires `"lib": ["ES2023"]` in `frontend/tsconfig.app.json`).
- **Every `localStorage.getItem/setItem/removeItem` call is wrapped in
  try/catch** — it throws in private mode and on quota exhaustion.
- **UI strings use `t("key", { defaultValue: "English text" })`** — the test
  i18n mock returns the key without `defaultValue`, so assertions use key
  strings.
- **Filter-dependent TanStack Query hooks use `placeholderData` /
  `keepPreviousData`** to avoid empty-state flash during rapid page switching.
- **Every Recharts `<Tooltip contentStyle={...}>` must set
  `color: "var(--color-text)"`** or the text is invisible in dark mode.
- **`animate-spin` goes on a wrapper `<div>`, never on the SVG icon.**
- **All spacing / shadow / radius / colour values come from
  `frontend/src/tokens/tokens.json`** — no magic numbers.
- **Design direction is decided and named "Legal Codex"**: warm off-white
  `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text serif
  headings, 9 court-specific colour codes. The primary user is a
  self-representing immigration applicant, not a lawyer; the brand is
  authoritative, precise, academic.

Commit convention (`git log`, e.g. `fix: install root node_modules in make install`):
`<type>: <description>` with type ∈ `feat|fix|refactor|docs|test|chore|perf|ci`.
No AI attribution lines.

## Commands you will need

Always run from the repo root: `/Users/d/Developer/Active Projects/IMMI-Case-`.

| Purpose | Command | Expected on success |
|---|---|---|
| Drift check | `git diff --stat 42826a3..HEAD -- README.md frontend/README.md .env.example` | no output (or only your own commits) |
| Python unit tests | `make test-py` | `1141 passed, 3 failed, 7 skipped` — the 3 failures are a **local Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch** breaking the `pypdf` import in `tests/test_backfill_judge_overrides_from_pdf.py`. Not this plan's problem; do not fix them. |
| Frontend tests | `cd frontend && npx vitest run` | all pass (`55 files / 490 tests` at `42826a3`; `56 files / 518 tests` after plan 002) |
| Worker tests | `cd workers && npx vitest run` | `345 passed`, 25 files |
| Frontend typecheck | `cd frontend && npx tsc -b --noEmit` | exit 0 |
| Python lint | `make lint` | `All checks passed!` |
| Page count | `ls frontend/src/pages/*.tsx \| wc -l` | `27` |
| Python unit-test source count | `grep -rn "def test_" tests/ --include="*.py" \| grep -v "/e2e/" \| wc -l` | `1107` |
| E2E source count | `grep -rn "def test_" tests/e2e/ --include="*.py" \| wc -l` | `260` |
| E2E collection (proves the bug) | `.venv/bin/python -m pytest tests/e2e --collect-only -q 2>&1 \| tail -2` | `Interrupted: 20 errors during collection` before plan 002 + the E2E install; clean collection after |
| Env-key coverage gate | see Step 4 | `MISSING: []` |
| Nothing else changed | `git status --porcelain` | only `README.md`, `frontend/README.md` (and `plans/README.md` if it exists) |

## Scope

**In scope** (the only files you may modify):

- `README.md`
- `frontend/README.md` — rewritten wholesale
- `plans/README.md` — this plan's status row **only, and only if the file
  already exists**. Do not create it.

**Out of scope** (do NOT touch, even though they look related):

- `.env.example`. This plan owns its documentation territory but deliberately
  makes **no edit** to it: the fix is to make `README.md` match `.env.example`,
  not the reverse. `.env.example` is the source of truth and is already correct.
  Never print or copy any value from it into `README.md` — key names, required
  flags and human descriptions only.
- `CLAUDE.md` and `AGENTS.md`. They carry the same `149,016` figure (`:327`,
  `:385` / `:329`, `:381`), the same stale single-file Vitest path at `:32`
  (`cd frontend && npx vitest run src/__tests__/components/judges/` — that
  directory does not exist at either level), and the "已同步至 Supabase" clause.
  All real, all a different plan's file territory. Report them in your handoff;
  do not edit them here. Editing them would also collide with a parallel plan.
- `docs/ARCHITECTURE.md`. It is the declared source of truth for architecture
  and this plan's job is to make `README.md` agree with it. It does carry
  `149,016` at `:110` — leave it; same reason as above.
- `scripts/enqueue_urls.py`. The README stops recommending it; whether the
  script itself should be deleted is a code decision, not a docs decision.
- `requirements-app.txt`, `requirements-test.txt`, `requirements-e2e.txt`,
  `Makefile`, `.github/workflows/**`, `frontend/vitest.config.ts`. Plans 001
  and 002 own these. This plan only *documents* what they already do.
- `frontend/e2e/README.md`. It is genuine, accurate project documentation for
  the TypeScript Playwright suite. Leave it; the new `frontend/README.md` links
  to it.
- `README.md:526`'s `149K 向量建立 HNSW` inside troubleshooting ⑤. That number
  describes a **past incident** on the retired Supabase stack, so it is correct
  as a historical statement. Leave it.
- `wrangler.toml` placeholder resource IDs, `IMMI_CASE_MUTATIONS_ENABLED` and
  the pipeline flags defaulting to `"false"`,
  `workers/austlii-scraper/scripts/rollback_run.ts` targeting legacy Supabase,
  and `CLAUDE.md`'s "Performance Baseline (2026-05-05)" section — all
  fail-closed / historical **by design**. Do not "fix" any of them, and do not
  describe them as broken in the README.
- Any screenshot file or the §2 image manifest. Not audited by this plan.

## Git workflow

- Branch: `git checkout -b advisor/043-correct-the-readme`
- One commit per step is fine; a single commit for the whole plan is also fine.
  Message style, matching `git log`:
  - `docs: make every README test and install command runnable`
  - `docs: stamp or derive every count in README`
  - `docs: align README with the Vectorize production stack`
  - `docs: replace the Vite scaffold frontend README`
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits.

## Steps

### Step 1: Make §4.2 Install and §4.5 Test runnable

**1a.** Replace `README.md:110-122` (the whole `### 4.2 Install` block, from the
heading through the closing fence) with:

````markdown
### 4.2 Install

```bash
# Clone
git clone <repo-url>
cd IMMI-Case-

# Python virtualenv（Homebrew Python 禁止全域 pip）
python3 -m venv .venv

# 一次裝好 Python 相依 + 根目錄 node_modules + frontend node_modules
make install
```

`make install` 等同於下列三步（`Makefile` 的 `install:` target）：

```bash
.venv/bin/python -m pip install -r requirements-app.txt -r requirements-test.txt
npm install                        # 根目錄：vitest + wrangler，`make test-workers` 靠它解析
cd frontend && npm install
```

> 根目錄的 `npm install` 不可省略 —— `workers/` 沒有自己的 `package.json`，
> Worker 測試是對著根目錄的 `node_modules` 解析的。

**只有要跑 E2E 才需要**的額外相依（刻意不放進 `requirements-test.txt`，
以免 CI 的單元測試 job 每次都下載瀏覽器驅動）：

```bash
.venv/bin/python -m pip install -r requirements-e2e.txt
.venv/bin/python -m playwright install chromium
```
````

**1b.** Replace `README.md:176-191` (the whole `### 4.5 Test` block, from the
heading through the closing fence) with:

````markdown
### 4.5 Test

```bash
# Python 單元測試（排除 tests/e2e）
make test-py

# 前端 Vitest 單元測試
make test-fe

# Worker Vitest 測試
make test-workers

# 上面三個一次跑完
make test

# Playwright E2E（需先照 §4.2 裝 requirements-e2e.txt + chromium，且需有可連線的 server）
make test-e2e
```

> **不要直接跑裸 `pytest`（不帶 `--ignore=tests/e2e`）。**
> `tests/e2e/**` 匯入 `playwright.sync_api`，而 `requirements-app.txt` 與
> `requirements-test.txt` 都不含 playwright，收集階段就會整批 error。
> `make test-py` 已帶 `--ignore=tests/e2e`，是唯一保證能在乾淨環境跑綠的 Python 指令。
>
> 測試數量以指令輸出為準，本文不再硬編。要 source-count：
> `grep -rn "def test_" tests/ --include="*.py" | grep -v "/e2e/" | wc -l`
> （單元）、`grep -rn "def test_" tests/e2e/ --include="*.py" | wc -l`（E2E）。
````

**1c.** In troubleshooting ③ at `README.md:509`, replace the **Fix** line:

```
- **Fix**：永遠從專案根目錄執行：`cd /path/to/IMMI-Case- && python3 -m pytest tests/`
```

with:

```
- **Fix**：永遠從專案根目錄執行：`cd /path/to/IMMI-Case- && make test-py`（`pytest tests/` 會連 `tests/e2e/` 一起收集而失敗，見 §4.5）
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -n 'python3 -m pytest' README.md ; \
  grep -c 'requirements-e2e.txt' README.md ; \
  grep -c 'make test-workers' README.md ; \
  grep -c 'playwright install chromium' README.md
```
→ the first `grep` prints **nothing** (exit 1 is expected and fine); then `2`,
then `2`, then `1`. (`requirements-e2e.txt` becomes `3` after Step 2d adds the
third mention — check this one again at the end of Step 2, not here.)

Then confirm the documented command still passes:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py 2>&1 | tail -3
```
→ `1141 passed, 3 failed, 7 skipped` (the 3 are the known local `pypdf`/`pyexpat`
environment failures described in "Commands you will need" — leave them).

### Step 2: Correct or de-hardcode every count

**2a — case counts.** Make these five edits in `README.md`:

| Line | From | To |
|---|---|---|
| 3 | `> 149,016 個案件。9 個法院。26 年判決紀錄。一個可搜尋的真相。` | `> 15 萬+ 個案件。9 個法院。26 年判決紀錄。一個可搜尋的真相。` |
| 40 | `149,016 threads.` | `More than 150,000 threads.` |
| 91 | `| **LLM 欄位萃取** | 10 個 Claude Sonnet 平行 Agent | 149K 案件的結構化資訊無法純手工 | 萃取覆蓋率 90%+ |` | same row with `149K 案件` → `15 萬筆案件` |
| 284 | `# regex 結構化萃取（8 個平行 worker，約 12 分鐘處理 149K 案件）` | `# regex 結構化萃取（8 個平行 worker，約 12 分鐘處理 15 萬筆案件）` |
| 418 | `│   ├── immigration_cases.csv       #   149,016 案件 × 31 欄位` | `│   ├── immigration_cases.csv       #   本機案件快照 × 31 欄位（列數依匯出時間而異）` |
| 629 | `| **AustLII 原始判決** | 全文與基本元資料（149,016 cases） | ...` | same row with `（149,016 cases）` → `（全部已收錄案件）` |

**2b — §13 Data Coverage.** Insert this note **immediately above** the table at
`README.md:602`:

```markdown
> 下表是 **2026-05 全量匯入完成時的快照**，不是即時數字。ARTA / FCA /
> FedCFamC2G / HCA 由外部 VPS crawler 的每週 cron（`0 14 * * 1` UTC）持續增補，
> 所以實際數量只會比表中更高。最近一次記錄到的生產總量是 **151,295**
> （`.claude/STATE.md`，2026-08-25 快照）。要看當下數字請查 `.claude/STATE.md`
> 或呼叫 `/api/v1/stats`。
```

Then fix the Total row at `README.md:613` — the nine per-court rows sum to
**149,022**, not 149,016:

```
| **Total（2026-05 快照）** | — | **149,022** | **2000–2026** |
```

**2c — page count.** `frontend/src/pages/` contains 27 `.tsx` files. Change
`24` → `27` at these three places:

- `README.md:16` — `- **React SPA**：24 個頁面，…` → `27 個頁面`
- `README.md:95` — `… | 統一視覺語言跨 24 個頁面 | …` → `跨 27 個頁面`
- `README.md:397` — `│   │   ├── pages/                  #   24 頁面 (lazy-loaded)`
  → `27 頁面 (lazy-loaded)`

**2d — test counts.** These drift with every test added, so stop hardcoding
them. Replace the three tree comments and the Tech Stack row:

- `README.md:402`
  from `│   └── __tests__/                  #   490 Vitest 單元測試（55 files）`
  to `│   └── __tests__/                  #   Vitest 單元測試（收集範圍見 frontend/vitest.config.ts 的 include）`
- `README.md:410`
  from `│   ├── test_models.py              #   1,107 Python 單元測試（71 files）`
  to `│   ├── test_models.py              #   Python 單元測試（make test-py）`
- `README.md:411`
  from `│   └── e2e/                        #   260 Playwright E2E 測試（25 files，含 tests/e2e/react/ + playwright/ + 根層 smoke/export）`
  to `│   └── e2e/                        #   Playwright E2E（make test-e2e；需 requirements-e2e.txt，見 §4.2）`
- `README.md:592`
  from `| **Testing** | pytest (1,107 unit + 260 E2E Playwright), Vitest (490 frontend unit) — source-counted via grep, see CLAUDE.md for verification command |`
  to `| **Testing** | pytest（單元 `make test-py`；Playwright E2E `make test-e2e`）、Vitest（frontend `make test-fe`、workers `make test-workers`）。數量以指令輸出為準，文件不硬編 |`

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c '149,016' README.md ; \
  grep -n '149K' README.md ; \
  grep -cE '24 (個)?頁面' README.md ; \
  grep -c '149,022' README.md ; \
  grep -c '151,295' README.md ; \
  grep -c 'requirements-e2e.txt' README.md ; \
  ls frontend/src/pages/*.tsx | wc -l
```
→ `0`; then **exactly one** `149K` line, and it must be the troubleshooting ⑤
line `…PgBouncer \`session_lifetime = 2 小時\`；149K 向量建立 HNSW (m=16, ef=64) 超時`
(that number describes a past incident and is deliberately kept — see "Out of
scope"); then `0`, `1`, `1`, `3`, `27`.

(`grep -c` prints `0` and exits 1 for no matches — that is the expected result
for `149,016` and for the `24 頁面` pattern, not a failure.)

Then re-check the arithmetic you just asserted:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -c "
print(sum([52970,39203,14987,13765,11157,10395,4109,2260,176]))"
```
→ `149022`.

### Step 3: Align the semantic-search description with the production stack

**3a.** `README.md:20` — replace:

```
- 語意搜尋：pgvector HNSW + OpenAI/Gemini 嵌入，支援 lexical / semantic / hybrid 三模式
```

with:

```
- 語意搜尋（正式環境）：Cloudflare Vectorize（`CASE_VECTORS`）+ Workers AI `@cf/qwen/qwen3-embedding-0.6b`（1024-dim），支援 lexical / semantic / hybrid 三模式；pgvector + OpenAI/Gemini 只存在於本機開發腳本
```

**3b.** `README.md:89` — replace the 語意搜尋 row's second cell:

```
| **語意搜尋** | pgvector HNSW，三模式（lexical/semantic/hybrid） | 關鍵字搜不到的案件，語意能找到 | 判決策略研究效率 10× |
```

with:

```
| **語意搜尋** | 正式環境 Vectorize + Workers AI 嵌入，三模式（lexical/semantic/hybrid） | 關鍵字搜不到的案件，語意能找到 | 判決策略研究效率 10× |
```

**3c.** `README.md:251-262` — §5.2 is a **local Flask** example and must say so.
Insert this line immediately under the `### 5.2 API — 搜尋端點` heading, before
the fenced block:

```markdown
> 以下 `localhost:8080` 範例是**本機 Flask 開發**路徑（`python web.py --backend supabase`，
> pgvector + OpenAI/Gemini 嵌入）。正式環境 `https://immi.trackit.today` 由 Worker 直查
> D1 FTS5 + Vectorize（Workers AI 嵌入），不接受 `provider` 參數。
```

and change the comment at `README.md:257` from
`# 語意搜尋（需要 pgvector + embeddings）` to
`# 語意搜尋（本機：需要 pgvector + embeddings）`.

**3d.** `README.md:448-452` — the §8 Function Atlas entry for
`SupabaseRepository.semantic_search()` says `pgvector HNSW 語意搜尋`. That is
**correct in context** (this symbol really is the Supabase/pgvector path), so do
**not** rewrite it. Add one label line so nobody reads it as production. After
the `**\`SupabaseRepository.semantic_search()\`** / …` header line at
`README.md:448`, the first bullet is `- Purpose：…`. Insert directly above that
bullet:

```
- Scope：**本機開發專用**（`--backend supabase`）。正式環境的語意搜尋在 Worker 內，走 Vectorize + Workers AI
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -n 'pgvector' README.md
```
→ exactly **four** lines, and every one of them is explicitly scoped to local
dev: the rewritten `:20` (which now says pgvector 只存在於本機開發腳本), the new
§5.2 note, the `# 語意搜尋（本機：…）` comment, and the §8 `Purpose：pgvector HNSW …`
line that now sits under a `Scope：**本機開發專用**` bullet. If any `pgvector`
line lacks a local-dev qualifier within two lines of it, fix it.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c 'qwen3-embedding-0.6b' README.md
```
→ `3` (the mermaid node at `:327`, the new `:20` text, and the §12 Embeddings
row at `:594`).

### Step 4: Regenerate the env-var table from `.env.example`

Replace `README.md:131-149` — that is the `**環境變數表**：` line plus the whole
15-row table, ending with the `~~SUPABASE_ANON_KEY~~` row — with the two tables
below. Keep the `安全基線：` bullet list at `README.md:151-155` unchanged.

````markdown
**環境變數表**（**單一真相來源是 `.env.example`** —— 有出入時以該檔為準，
本表只補充「這個 key 是做什麼的」）：

**本機 Flask / Vite 開發**

| Key | Required | Default | Description |
|-----|:--------:|---------|-------------|
| `BACKEND_HOST` | ✗ | `127.0.0.1` | Flask 綁定 IP（對外服務改為 `0.0.0.0`） |
| `BACKEND_PORT` | ✗ | `8080` | Flask 服務埠號（5000 與 macOS AirPlay 衝突） |
| `SECRET_KEY` | 生產必填 | 開發模式自動生成 | Flask session / CSRF 簽章金鑰 |
| `APP_ENV` | ✗ | `development` | 設為 `production` / `staging` 會啟用嚴格安全模式 |
| `TRUST_PROXY_HEADERS` | ✗ | `false` | 只有部署在可信任反向代理後方才設 `true`，否則 `X-Forwarded-For` 可被偽造繞過限流 |
| `SUPABASE_URL` | 條件 | — | Supabase 專案 URL（`python web.py --backend supabase` 時必填） |
| `SUPABASE_SERVICE_ROLE_KEY` | 條件 | — | Supabase Service Role Key（伺服器端操作用） |
| `VITE_TELEGRAM_BOT_NAME` | ✗ | `immi_case_bot` | Telegram Login Widget 綁定的 bot 帳號（不含 `@`）。未設定時 `frontend/src/pages/LoginPage.tsx:7` 會 fallback 到硬編值，登入按鈕會綁到錯的 bot 而不會報錯 |

**LLM Council（走 Cloudflare AI Gateway，統一計費）**

| Key | Required | Default | Description |
|-----|:--------:|---------|-------------|
| `CF_AIG_TOKEN` | 條件 | — | **LLM Council 主路徑**：CF AI Gateway 統一計費 token（`cfut_*`），auth header 為 `cf-aig-authorization`。OpenAI / Anthropic / Google AI Studio 都從此扣額 |
| `LLM_COUNCIL_CF_GATEWAY_URL` | ✗ | 專案的 `immi-council` compat endpoint | CF AI Gateway compat endpoint URL |
| `LLM_COUNCIL_OPENAI_MODEL` | ✗ | 見 `.env.example` | 需 provider 前綴：`openai/<model>` |
| `LLM_COUNCIL_ANTHROPIC_MODEL` | ✗ | 見 `.env.example` | 需 provider 前綴：`anthropic/<model>` |
| `LLM_COUNCIL_GEMINI_PRO_MODEL` | ✗ | 見 `.env.example` | 需 provider 前綴：`google-ai-studio/<model>` |
| `LLM_COUNCIL_GEMINI_FLASH_MODEL` | ✗ | 見 `.env.example` | 仲裁（moderator）模型，同樣需 `google-ai-studio/` 前綴 |
| `LLM_COUNCIL_MAX_OUTPUT_TOKENS` | ✗ | `4096` | 專家模型 token 上限（probe-validated：`gemini-2.5-pro` 在 2400 會回傳 completion=0） |
| `LLM_COUNCIL_MODERATOR_MAX_TOKENS` | ✗ | `8192` | 仲裁模型 token 上限（14-field JSON 輸出） |
| `LLM_COUNCIL_TIMEOUT_SECONDS` | ✗ | `120` | 單次模型呼叫逾時秒數 |
| `LLM_COUNCIL_SYSTEM_PROMPT_OPENAI` | ✗ | 見 `.env.example` | 覆寫 OpenAI 專家的 system prompt |
| `LLM_COUNCIL_SYSTEM_PROMPT_ANTHROPIC` | ✗ | 見 `.env.example` | 覆寫 Anthropic 專家的 system prompt |
| `LLM_COUNCIL_SYSTEM_PROMPT_GEMINI_PRO` | ✗ | 見 `.env.example` | 覆寫 Gemini Pro 專家的 system prompt |
| `LLM_COUNCIL_SYSTEM_PROMPT_MODERATOR` | ✗ | 見 `.env.example` | 覆寫仲裁模型的 system prompt |

**JWT / 認證**（`.env.example` 的註解寫明：`wrangler secret put` 設給 Worker，
本機 Flask JWT middleware 也讀同名值，所以本機 `.env` 同樣要填）

| Key | Required | Default | Description |
|-----|:--------:|---------|-------------|
| `JWT_SECRET_CURRENT` | 認證啟用時必填 | — | HS256 簽章金鑰（現行 kid）。用 `python3 -c "import secrets; print(secrets.token_hex(32))"` 產生 |
| `JWT_SECRET_PREVIOUS` | ✗ | — | 輪替期間仍需驗證的舊金鑰 |
| `JWT_KID_CURRENT` | 認證啟用時必填 | — | 現行 key id（寫進 JWT header 的 `kid`） |
| `JWT_KID_PREVIOUS` | ✗ | — | 舊 key id，配合 `JWT_SECRET_PREVIOUS` |

**不在 `.env.example` 內、只有跑特定獨立腳本才要自己加**

| Key | 誰要用 | Description |
|-----|--------|-------------|
| `ANTHROPIC_API_KEY` | `extract_structured_fields_llm.py` | 直連 Anthropic。LLM Council **不需要**（走 CF Gateway） |
| `OPENAI_API_KEY` | `backfill_case_embeddings.py` | 產生本機開發用嵌入向量。LLM Council **不需要** |

> 已移除：`SUPABASE_ANON_KEY`。目前 `.env.example` 不再使用 anon key
> （前端讀取一律走 Worker / service role）。
````

**Verify** — every key in `.env.example` must now appear somewhere in
`README.md`:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python - <<'PY'
import re, pathlib
env = [l.split("=", 1)[0]
       for l in pathlib.Path(".env.example").read_text().splitlines()
       if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", l)]
readme = pathlib.Path("README.md").read_text()
print("KEYS:", len(env))
print("MISSING:", [k for k in env if k not in readme])
PY
```
→ `KEYS: 25` and `MISSING: []`.

Also confirm you did not touch the source of truth:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat -- .env.example
```
→ no output.

### Step 5: Fix the troubleshooting entries and the roadmap

**5a — troubleshooting ② (`README.md:496-501`).** The Cloudflare workaround
points at HTTP endpoints deleted in `d0972db`. Replace the **Fix** and
**Prevention** lines:

```
- **Fix**：等待數小時（通常 4-12 小時自動解封）；或切換至 Cloudflare Workers 模式（`scripts/enqueue_urls.py`）
- **Prevention**：`BaseScraper` 預設 1 秒間隔；勿同時執行多個爬蟲實例
```

with:

```
- **Fix**：等待數小時（通常 4-12 小時自動解封）。**沒有 Cloudflare 手動繞道可用**：`workers/austlii-scraper/` 自 commit `d0972db` 起只剩 cron 觸發，`/scrape`、`/enqueue`、`/progress`、`/list`、`/batch-get`、`/admin/discovery-diff` 全部已移除，`fetch()` 只服務 `/health`。`scripts/enqueue_urls.py` 打的正是那些已不存在的端點，現在跑只會失敗
- **Prevention**：`BaseScraper` 預設 1 秒間隔；勿同時執行多個爬蟲實例。正式環境的案件增補不靠本機爬蟲，而是外部 VPS crawler 每週 cron（`0 14 * * 1` UTC）帶 `CRAWLER_WRITE_TOKEN` POST 到主 Worker 的 `/api/v1/cases`
```

**5b — §3 feature table row for Cloudflare Workers (`README.md:92`).** It still
advertises the removed on-demand scraping surface. Replace:

```
| **Cloudflare Workers** | 分散式爬蟲 + R2 儲存 | 本地爬蟲易觸發 AustLII IP 封鎖 | 86K 案件 20 分鐘完成 |
```

with:

```
| **Cloudflare Workers** | cron 排程爬蟲 + R2 儲存；正式寫入由外部 VPS crawler POST | 本地爬蟲易觸發 AustLII IP 封鎖 | 每週自動增補當年度案件 |
```

**5c — troubleshooting ⑤ (`README.md:528`).** The file moved to
`supabase/archive/`. Replace:

```
- **Prevention**：`supabase/migrations/20260226040000_drop_hnsw_for_bulk_load.sql` 已處理此流程
```

with:

```
- **Prevention**：`supabase/archive/migrations-pre-baseline-2026-05-12/20260226040000_drop_hnsw_for_bulk_load.sql` 已處理此流程（該 migration 在 2026-05-12 baseline 之後被歸檔；正式環境已無 Postgres，本項僅適用於本機 Supabase 開發）
```

**5d — §9 Roadmap (`README.md:469-481`).** Delete the row at `README.md:477`:

```
| 多用戶認證（JWT + RBAC） | 🔴 高 | 🔴 高 | 🔴 高 | 中期 |
```

and add a shipped list **below** the roadmap table (after `README.md:481`,
before the `---` at `:483`):

```markdown
**已交付（不要再排進 roadmap）**

| 項目 | 交付日 | 位置 |
|------|--------|------|
| 多用戶認證（Telegram Login + HS256 JWT + refresh 輪替） | 2026-05-03 | `workers/auth/`（`jwt.js`、`telegram.js`、`nonce_do.js`、`refresh_sessions.js`、`cloudflare_handlers.js`） |
| 租戶隔離與角色 | 2026-05-03 | `CloudflareIdentityStore.assertMembership()`（`workers/storage/cloudflare.js`）；角色 `owner`/`admin`/`member`/`viewer` 定義於 `migrations/d1/account/0001_account.sql` |

> 租戶隔離是 **app 層**（每次請求對 `IMMI_ACCOUNT_DB` 做一次 membership 查詢），
> 不是 Postgres RLS —— 這條路徑上沒有 Postgres。忘記呼叫 `assertMembership()`
> 的新路由就是真實的越權漏洞。
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c 'RBAC' README.md ; \
  grep -c 'supabase/migrations/20260226040000' README.md ; \
  grep -c 'supabase/archive/migrations-pre-baseline-2026-05-12' README.md ; \
  grep -c 'assertMembership' README.md ; \
  test -f supabase/archive/migrations-pre-baseline-2026-05-12/20260226040000_drop_hnsw_for_bulk_load.sql && echo MIGRATION_PATH_OK
```
→ `0`, `0`, `1`, `2`, `MIGRATION_PATH_OK`.

And confirm the README no longer recommends the dead script:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -n 'enqueue_urls' README.md
```
→ exactly one line, and it is the new **Fix** line that says the script now
fails. If it appears anywhere else, fix that occurrence too.

### Step 6: Replace `frontend/README.md`

Overwrite `frontend/README.md` entirely (all 74 lines of Vite scaffold go) with
the content below. Two placeholders must be resolved by running commands, not
guessed:

- `<INCLUDE_GLOBS>`: run
  `grep -n -A6 'include:' frontend/vitest.config.ts` and transcribe the literal
  glob strings from the `include:` array verbatim. At `42826a3` that is
  `__tests__/**/*.{test,spec}.{ts,tsx}`; after plan 002 there is a second glob
  covering `src/**/__tests__/`. Write exactly what the file contains.
- `<DATE>`: today's date in `YYYY-MM-DD`.

````markdown
# IMMI-Case — Frontend (React SPA)

澳洲移民司法案件情報平台的前端。React 19 + TypeScript + Vite 7 + Tailwind CSS v4
+ TanStack Query v5 + react-i18next（English / 繁體中文雙語）。27 個 lazy-loaded
頁面，正式環境由 Cloudflare Workers Static Assets 提供。

專案總覽、後端與資料層請見上層的 [`../README.md`](../README.md)；
架構真相來源是 [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)。

## Commands

```bash
npm install            # 或在 repo 根目錄跑 make install（同時裝根目錄 node_modules）

npm run dev            # Vite dev server（先跑 tokens），proxy 到 http://127.0.0.1:8080
npm run build          # tokens → tsc -b → vite build，輸出 ../immi_case_downloader/static/react
npm run build:cloudflare   # 同上但輸出到 dist/
npm run lint           # eslint .
npx tsc -b --noEmit    # 真正的型別檢查（見下方 tsconfig 說明）

npx vitest run                              # 全部單元測試
npx vitest run __tests__/judge-pages.test.tsx   # 單一檔案
npm run test:coverage                       # v8 coverage（門檻 80%）

npm run e2e            # Playwright E2E（TypeScript，見 e2e/README.md）
```

## Layout

```
frontend/
├── src/
│   ├── pages/          27 個頁面，全部 lazy-loaded
│   ├── components/     共用元件 + chart 元件 + layout
│   ├── hooks/          TanStack Query hooks
│   ├── contexts/       AuthContext 等
│   ├── lib/
│   │   ├── api.ts      CSRF-aware fetch wrapper；各類端點的 timeout 常數也在這
│   │   └── router.ts   resolveRouterBasename()：自動判斷 / 或 /app/
│   └── tokens/tokens.json   設計令牌的單一來源
├── scripts/build-tokens.ts  tokens.json → CSS + TS（npm run tokens）
├── __tests__/          Vitest 單元測試
├── e2e/                Playwright E2E（TypeScript，另有自己的 README）
├── vite.config.ts      dev server / proxy / build.outDir
├── vitest.config.ts    測試設定（include glob、jsdom、coverage 門檻）
└── tsconfig.app.json   ← 路徑 alias 只在這裡
```

### 測試放在哪裡（容易踩雷）

- 單元測試由 `vitest.config.ts` 的 `include` glob 決定，目前是
  `<INCLUDE_GLOBS>`。
- **`frontend/src/__tests__/` 不存在。** 任何指向
  `src/__tests__/components/...` 的指令都是錯的；用
  `npx vitest run __tests__/judge-pages.test.tsx` 這種真實路徑。
- `e2e/` 是**另一套**測試（TypeScript Playwright，`npm run e2e`），與 repo 根目錄
  的 Python Playwright 套件 `../tests/e2e/`（`make test-e2e`）互相獨立。
  `vitest.config.ts` 刻意把 `e2e/**` 排除在單元測試之外。

### tsconfig（容易踩雷）

- `tsconfig.json` 只有 `files: []` + project references。**`npx tsc --noEmit`
  會 exit 0 但一個檔案都沒載入** —— 真正的型別檢查是 `npx tsc -b --noEmit`。
- 路徑 alias（`@/*`）只定義在 `tsconfig.app.json`。不要在 root `tsconfig.json`
  加 `baseUrl` / `paths` / `compilerOptions`，重複的 `baseUrl` 會觸發 TS5101。

## Design system

視覺方向已經定案，代號 **Legal Codex**，不要另起爐灶：

- 暖米白背景 `#f5f4f1`、深海軍藍 `#1b2838`、琥珀金 accent `#d4a017`
- Crimson Text 襯線標題、9 種法院專屬色碼
- 主要使用者是**自助辦理的移民申請人**，不是律師；品牌調性是權威、精準、學術

所有間距 / 陰影 / 圓角 / 顏色一律取自 `src/tokens/tokens.json`（`npm run tokens`
會產出 CSS 變數與 TS 型別）。**不得出現魔法數字。**

## Conventions（送審會被擋的項目）

- 陣列用 `.toSorted()`，不要用 `.sort()`（React 內禁止就地變異）。
- 每一個 `localStorage` 讀寫都要包 try/catch —— 無痕模式與配額用盡都會 throw。
- UI 字串一律 `t("key", { defaultValue: "English text" })`；測試裡的 i18n mock
  只回傳 key，所以斷言要用 key 字串。
- 依賴 filter 的 TanStack Query hook 要設 `placeholderData` / `keepPreviousData`，
  否則快速換頁會閃空狀態。
- 每個 Recharts `<Tooltip contentStyle={...}>` 都必須帶
  `color: "var(--color-text)"`，否則深色模式下文字看不見。
- `animate-spin` 放在外層 `<div>`，不要直接放在 SVG icon 上。
- 呼叫 `t()` 的 `useCallback` / `useMemo`，依賴陣列要包含 `t`。

更完整的踩雷清單見 `../CLAUDE.md` 的 “React Frontend Gotchas”。

---

最後更新：<DATE>。這份檔案原本是 `npm create vite` 的樣板，已於此次改寫為專案文件。
````

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c 'This template provides a minimal setup' frontend/README.md ; \
  grep -c 'Legal Codex' frontend/README.md ; \
  grep -c 'tsc -b --noEmit' frontend/README.md ; \
  grep -c 'toSorted' frontend/README.md ; \
  grep -c '不存在' frontend/README.md ; \
  grep -c '__tests__/judge-pages.test.tsx' frontend/README.md ; \
  test -f frontend/__tests__/judge-pages.test.tsx && echo EXAMPLE_TEST_EXISTS ; \
  test -d frontend/src/__tests__ && echo UNEXPECTED_DIR || echo NO_SRC_TESTS_DIR
```
→ `0`, `1`, `2`, `1`, `1`, `2`, `EXAMPLE_TEST_EXISTS`, `NO_SRC_TESTS_DIR`.
(`tsc -b --noEmit` appears twice — Commands block and the tsconfig note;
`__tests__/judge-pages.test.tsx` twice — Commands block and the “測試放在哪裡” note.)
(`__tests__/judge-pages.test.tsx` appears twice: once in the Commands block,
once in the “測試放在哪裡” note.)

Then prove the example command in the new README actually runs:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  npx vitest run __tests__/judge-pages.test.tsx 2>&1 | tail -5
```
→ `Test Files  1 passed (1)` with a non-zero test count. If it reports
`No test files found`, your `<INCLUDE_GLOBS>` transcription or the path is
wrong — fix before continuing.

### Step 7: Final sweep

Run the full gate set and confirm nothing outside scope moved.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  git status --porcelain && \
  echo "--- tests ---" && \
  make test-py 2>&1 | tail -2 && \
  (cd frontend && npx vitest run 2>&1 | tail -3) && \
  (cd workers && npx vitest run 2>&1 | tail -3) && \
  (cd frontend && npx tsc -b --noEmit && echo TSC_OK) && \
  make lint
```
→ `git status --porcelain` lists **only** ` M README.md`, ` M frontend/README.md`
(plus ` M plans/README.md` if that file exists and you updated it, and
`?? plans/043-correct-the-readme.md` if the plan itself is untracked).
`make test-py` → `1141 passed, 3 failed, 7 skipped` (the 3 known environmental
failures). Vitest frontend and workers suites pass. `TSC_OK`. `make lint` →
`All checks passed!`.

If `plans/README.md` exists, set this plan's row to `DONE`.

## Test plan

This plan writes no code, so there are **no new automated tests**. Its
correctness is enforced by the greps and existence checks in each step, which
are collected into "Done criteria" below. The three test suites are run as
**regression guards only** — they must be exactly as green after this plan as
before it. Any change in their results means you edited something you should
not have; that is a STOP condition.

Manual read-through (do this once at the end, it catches what grep cannot):

1. Read `README.md` §4.2 → §4.5 top-to-bottom as a newcomer would and execute
   every command in order in a scratch shell. Every one must exit 0 except
   `make test-py` (3 known environmental failures) and `make test-e2e`, which
   additionally needs a running server.
2. Read the new `frontend/README.md` top-to-bottom and run every command in its
   "Commands" block except `npm run dev`, `npm run e2e` and the `build*`
   targets (`npm run build` writes into the tracked directory
   `immi_case_downloader/static/react/` and would dirty ~80 files — do **not**
   run it).

## Done criteria

Machine-checkable. ALL must hold, from the repo root
`/Users/d/Developer/Active Projects/IMMI-Case-`:

- [ ] `grep -c '149,016' README.md` → `0`
- [ ] `grep -c '149K' README.md` → `1` (only the troubleshooting ⑤ historical line)
- [ ] `grep -c '149,022' README.md` → `1`
- [ ] `grep -c '151,295' README.md` → `1`
- [ ] `grep -cE '24 (個)?頁面' README.md` → `0`
- [ ] `ls frontend/src/pages/*.tsx | wc -l` → `27` and `grep -c '27 個頁面' README.md` → `2`
- [ ] `grep -n 'python3 -m pytest' README.md` → no output
- [ ] `grep -c 'requirements-e2e.txt' README.md` → `3`
- [ ] `grep -c 'playwright install chromium' README.md` → `1`
- [ ] `grep -c 'make test-workers' README.md` → `2`
- [ ] `grep -c 'RBAC' README.md` → `0`
- [ ] `grep -c 'assertMembership' README.md` → `2`
- [ ] `grep -c 'supabase/migrations/20260226040000' README.md` → `0`
- [ ] `test -f supabase/archive/migrations-pre-baseline-2026-05-12/20260226040000_drop_hnsw_for_bulk_load.sql`
- [ ] `grep -n 'enqueue_urls' README.md` → exactly one line, and it states the script now fails
- [ ] `grep -c 'qwen3-embedding-0.6b' README.md` → `3`
- [ ] Every `pgvector` occurrence in `README.md` is qualified as local-dev within two lines
- [ ] The env-key script in Step 4 prints `KEYS: 25` and `MISSING: []`
- [ ] `git diff --stat -- .env.example` → no output
- [ ] `grep -c 'This template provides a minimal setup' frontend/README.md` → `0`
- [ ] `grep -c 'Legal Codex' frontend/README.md` → `1`
- [ ] `grep -c 'tsc -b --noEmit' frontend/README.md` → `2`
- [ ] `cd frontend && npx vitest run __tests__/judge-pages.test.tsx` → `Test Files  1 passed (1)`
- [ ] `make test-py` → `1141 passed, 3 failed, 7 skipped` (unchanged from before this plan)
- [ ] `cd frontend && npx vitest run` → all pass, count unchanged from before this plan
- [ ] `cd workers && npx vitest run` → `345 passed`
- [ ] `cd frontend && npx tsc -b --noEmit` → exit 0
- [ ] `make lint` → `All checks passed!`
- [ ] `git status --porcelain` shows no modified file outside
      `README.md`, `frontend/README.md`, `plans/README.md`
- [ ] `plans/README.md` row updated **if that file exists**

## STOP conditions

Stop and report back (do not improvise) if:

- **`requirements-e2e.txt` does not exist** when you reach Step 1. This plan
  depends on `plans/002-fix-test-collection-and-install.md`, which creates it.
  Do **not** create the file yourself — it is outside this plan's territory, and
  a docs plan inventing a requirements file is how the two drift apart again.
  Stop and report that 002 has not landed.
- **The `README.md` line you are about to edit does not match the excerpt in
  "Current state".** Line numbers drift; content should not. Re-locate by
  content (`grep -n`). If the *content* is gone or already different, the README
  was edited by someone else after `42826a3` — stop and report.
- **`git status --porcelain` shows a modified file outside the in-scope list**
  at any point. Most likely you ran `npm run build`, which rewrites ~80 tracked
  files under `immi_case_downloader/static/react/`. Revert those
  (`git checkout -- immi_case_downloader/static/react/`) and never run a build
  target in this plan.
- **Any of the three test suites changes its pass/fail count.** A docs-only plan
  cannot move a test result; if one moves, you edited source. Revert and report.
- **The env-key script in Step 4 reports a key you cannot classify.** Someone
  added a key to `.env.example` after `42826a3`. Do not guess what it does and
  do not omit it — stop and ask, because a wrong description in the env table is
  exactly the defect this step exists to remove.
- **You find yourself wanting to edit `CLAUDE.md`, `AGENTS.md`, or
  `docs/ARCHITECTURE.md`** to make a number consistent. They carry the same
  stale `149,016` and the same broken Vitest path, and they are a parallel
  plan's territory. Note it in your handoff instead; editing them will cause a
  merge conflict.
- **A `.env.example` value is about to be copied into `README.md`.** Never
  reproduce a value — key name, required flag and human description only. If a
  key looks like it holds a live credential rather than a placeholder, stop,
  report it, and recommend rotating that credential before anything is
  committed.

## Maintenance notes

For whoever owns these docs next:

- **The case count will drift again the moment anyone types it.** The chosen
  defence is: no exact production figure in `README.md` except one dated,
  attributed sentence pointing at `.claude/STATE.md`. The §13 per-court table is
  explicitly framed as a frozen 2026-05 snapshot whose Total (149,022) is the
  arithmetic sum of its own rows. If a future editor wants a live number, wire
  it to `/api/v1/stats` — do not retype it.
- **Test counts are deliberately gone from prose.** `README.md` now names the
  `make` target and the `grep` source-count instead. Plan 002 moves the frontend
  suite from 490 to 518 tests; a README that hardcoded 490 would have been wrong
  the day after. Keep it that way.
- **Still stale after this plan, by design (different file territory):**
  - `CLAUDE.md:327` / `AGENTS.md:329` — "數據狀態: 149,016 個案件記錄已同步至
    Supabase". The clause is doubly wrong now: the number drifted and production
    has no Supabase.
  - `CLAUDE.md:385` / `AGENTS.md:381` — the same per-court breakdown, with the
    same 6-case arithmetic error.
  - `docs/ARCHITECTURE.md:110` — `(149,016 cases)`.
  - `CLAUDE.md:32` / `AGENTS.md:32` — `cd frontend && npx vitest run
    src/__tests__/components/judges/`. That path is wrong at **both** levels:
    `frontend/src/__tests__` does not exist, and `frontend/__tests__/` has no
    `components/` subdirectory. The working form is
    `npx vitest run __tests__/judge-pages.test.tsx`, which the new
    `frontend/README.md` documents. Whoever owns `CLAUDE.md` should copy it.
  - `CLAUDE.md` also states `ImmigrationCase` has 22 fields; the dataclass has
    **31** (verified via `dataclasses.fields`). `README.md:373` already says 31
    and is correct.
- **A reviewer should scrutinise**: (a) that the diff is confined to the two
  README files — `git diff --name-only` is the whole review gate for scope;
  (b) that no `.env.example` **value** leaked into the env table, only names;
  (c) that the §13 note's `151,295` is attributed to `.claude/STATE.md` with its
  date rather than presented as current truth.
- **Deferred out of this plan**: deciding whether `scripts/enqueue_urls.py`
  should be deleted now that the endpoints it drives are gone. The README stops
  recommending it; deleting the script is a code decision for a dead-code plan.

## Findings reconsidered

Nothing was rejected outright, but two pieces of the incoming evidence were
wrong and are corrected here so the next reader is not misled:

- **The Vitest `include` glob is at `frontend/vitest.config.ts:11`, not
  `frontend/vite.config.ts:10`.** `frontend/vite.config.ts` contains no `test`
  block at all (it ends at line 53 with the dev-server proxy config). Verified
  by reading both files. The rest of that finding holds:
  `frontend/src/__tests__/` does not exist and `frontend/__tests__/` has no
  `components/` subdirectory, so the documented single-file Vitest command
  cannot work.
- **`README.md:449`'s "pgvector HNSW 語意搜尋" is correct, not stale.** It sits
  in §8 Function Atlas describing `SupabaseRepository.semantic_search()`, which
  genuinely is the pgvector code path in the local-dev Supabase backend. It is
  therefore **not** rewritten in Step 3; it gets a `Scope：**本機開發專用**`
  label so a reader cannot mistake it for the production path. Only
  `README.md:20` and `README.md:89` — which describe the system as a whole —
  were factually wrong and are rewritten.
- **The env-table gap is 10 keys, not 9.** `.env.example` has 25 assignments;
  `README.md`'s table had 15 rows, of which two (`ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`) document keys that are not in `.env.example` at all, and one
  (`LLM_COUNCIL_OPENAI_MODEL` 等) was a catch-all deferring the four model keys.
  Genuinely undocumented: the four `JWT_*`, `VITE_TELEGRAM_BOT_NAME`,
  `LLM_COUNCIL_TIMEOUT_SECONDS`, and the four `LLM_COUNCIL_SYSTEM_PROMPT_*`.
  Step 4's gate is written against the full 25 so the arithmetic cannot rot.
- **`VITE_TELEGRAM_BOT_NAME`'s failure mode is milder than reported.**
  `frontend/src/pages/LoginPage.tsx:7` falls back to a hardcoded
  `"immi_case_bot"` rather than rendering a broken widget — so a misconfigured
  deployment binds the login button to the *wrong* bot silently instead of
  failing loudly. The env-table entry says exactly that.
- **A count error the audit did not flag**: §13's nine per-court rows sum to
  **149,022**, while the Total row printed **149,016** — a 6-case internal
  contradiction inside one table. Fixed in Step 2b.
