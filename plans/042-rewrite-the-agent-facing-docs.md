# Plan 042: Make AGENTS.md and CLAUDE.md describe the architecture that exists

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)** — all four commands. `42826a3..HEAD` cannot see a
> dirty working tree, so on its own it gives a false all-clear:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- AGENTS.md CLAUDE.md Makefile
> git diff --stat -- AGENTS.md CLAUDE.md Makefile
> git diff --cached --stat -- AGENTS.md CLAUDE.md Makefile
> ```
> If `AGENTS.md` or `CLAUDE.md` appears in the **unstaged or staged** diff, stop:
> that is someone's uncommitted work and this plan rewrites one of those files
> wholesale. Never `git checkout --` or `git clean -f` to clear it.
>
> `Makefile` **is expected** to differ once plans 001 and 002 have landed — they
> are this plan's declared dependencies. This plan no longer edits the `Makefile`
> at all (see Step 7), so its drift is informational.
>
> Line numbers in this plan are from commit `42826a3` and will have shifted.
> Match on the quoted text, never on the line number. If a quoted excerpt is
> nowhere to be found in the live file, treat it as a STOP condition.
>
> **Parallel execution**: this plan rewrites `AGENTS.md` wholesale and asserts on
> `git status --short`. Run it in its own worktree or clone if anything else is
> in flight.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md`,
  `plans/002-fix-test-collection-and-install.md` (hard), and **after**
  `plans/038`, `plans/039`, `plans/040` and `plans/041` — those four change what
  the test-suite paragraph in `CLAUDE.md` (Step 5) must say, and rewriting it
  before they land guarantees it is wrong on arrival. Run this plan late.
  - Plan 002 Step 10 rewrites the entire `make help` block, including the
    `make test` line, and **adds `make test-workers` and `make test-pipeline`
    help lines** — the exact edits Step 7 of this plan used to make. Step 7 is
    therefore now a **verification-only** step and this plan **no longer edits
    the `Makefile`**. See Step 7.
  - Plan 002 Step 3 also changes `make test` itself from three suites to four
    (`test: test-py test-fe test-workers test-pipeline`). Step 5 reflects that.
- **Category**: docs
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

`AGENTS.md` is the file Codex, Cursor, aider and every other `AGENTS.md`-reading
agent loads as the complete project model. Today it describes a production stack
that was **deleted**: it tells an agent that reads flow through
`workers/proxy.js` via Hyperdrive to Supabase Postgres, that writes are proxied
to a Flask container behind an `X-Internal-Route: worker` ingress guard, that
tenant isolation comes from Postgres RLS via `getSqlAsUser()`, and that new
endpoints should be written with `getSql(env)` + postgres.js template literals.
None of those files or mechanisms exist. Every one of those instructions, if
followed, produces a real code-level regression against the shipped D1-native
Worker — and `CLAUDE.md` explicitly forbids re-introducing the ingress-guard
pattern, so the two agent-facing docs actively contradict each other.

`CLAUDE.md` is mostly correct but carries the same retired-stack advice in its
short "Gotchas" list — the part an agent skims and obeys — including a
🛑-flagged data-cleanup procedure written entirely in Postgres/Supabase terms
for a corpus that now lives in D1. It also misstates the frontend stack
(React 18/Vite 6 vs the pinned React 19/Vite 7), the `ImmigrationCase` field
count (22 vs 31), the Flask route modules (six of the eight listed do not
exist), and omits the 345-test Worker suite that gates production deploys.
`AGENTS.md` additionally carries find-and-replace damage that corrupts a model
identifier into `Codex-sonnet-4-6`, a string that will fail at the Cloudflare AI
Gateway if anyone pastes it into an env var.

After this plan: `CLAUDE.md` is the single source of truth and is accurate, and
`AGENTS.md` is a short pointer to it that carries only the non-negotiables — so
the two can never mechanically diverge again.

## Current state

### Files this plan owns

- `AGENTS.md` — 440 lines. A drifted mechanical fork of `CLAUDE.md`; the
  retired-stack content spans roughly lines 9, 136–140, 157–182, 184–235,
  277–279 and 335–342. Ends with a machine-managed GitNexus block.
- `CLAUDE.md` — 444 lines. Architecture sections are current; the Commands
  block, Architecture tree, Gotchas list and Important Notes are stale.
  Ends with the same machine-managed GitNexus block.
- `Makefile` — 115 lines at `42826a3`. **Read-only for this plan.** Its help
  block is rewritten by `plans/002` Step 10; Step 7 here only verifies the
  result.

### Ground truth verified at `42826a3` (I ran each of these)

```
$ ls workers/proxy.js
ls: workers/proxy.js: No such file or directory
$ ls workers/db
ls: workers/db: No such file or directory
$ ls workers/
__tests__  admin  austlii-scraper  auth  case-api  cloudflare-native.js
extraction-container.js  llm-council  node_modules  pipeline  storage  vitest.config.js
```

```
$ grep -nE '"(react|react-dom|vite|typescript)"' frontend/package.json
37:    "react": "^19.2.4",
38:    "react-dom": "^19.2.4",
66:    "typescript": "~5.9.3",
68:    "vite": "^7.3.1",
```

```
$ ls frontend/src/pages/*.tsx | wc -l
27
$ ls frontend/src/pages/
AdminPipelineRunsPage.tsx   AnalyticsPage.tsx          CaseAddPage.tsx
CaseComparePage.tsx         CaseDetailPage.tsx         CaseEditPage.tsx
CasesPage.tsx               CollectionDetailPage.tsx   CollectionsPage.tsx
CourtLineagePage.tsx        DashboardPage.tsx          DataDictionaryPage.tsx
DataToolsPage.tsx           DesignTokensPage.tsx       GuidedSearchPage.tsx
JudgeComparePage.tsx        JudgeDetailPage.tsx        JudgeProfilesPage.tsx
LegislationDetailPage.tsx   LegislationsPage.tsx       LlmCouncilPage.tsx
LlmCouncilSessionsPage.tsx  LoginPage.tsx              SavedSearchesPage.tsx
SearchTaxonomyPage.tsx      SemanticSearchPage.tsx     TaxonomyPage.tsx
```

`DownloadPage.tsx`, `PipelinePage.tsx` and `JobStatusPage.tsx` do **not** exist.
`AdminPipelineRunsPage.tsx`, `DataToolsPage.tsx` and `LoginPage.tsx` do, and are
absent from both docs' page lists. The count 27 is right only by coincidence:
three phantoms offset three omissions.

```
$ ls immi_case_downloader/web/routes/
__init__.py  __pycache__  api_cases.py  api_export.py  api_pipeline.py
api_taxonomy.py  api.py  bookmarks.py  legislations.py
```

`dashboard.py`, `cases.py`, `search.py`, `export.py`, `pipeline_routes.py` and
`update_db.py` do **not** exist. Blueprint prefixes, read from the sources:

| Module | Blueprint prefix |
|---|---|
| `api.py:35` | `/api/v1` (csrf-token, stats, stats/trends, analytics/*) |
| `api_cases.py:70` | `/api/v1` (cases, cases/count, cases/`<case_id>`) |
| `api_export.py:22` | `/api/v1` (export/csv, export/json) |
| `api_pipeline.py:22` | `/api/v1` (job-status, download/start, pipeline-status, pipeline-action, llm-council/*) |
| `api_taxonomy.py:29` | `/api/v1` (court-lineage, visa-registry, taxonomy/*) |
| `bookmarks.py:12` | `/api/v1/collections` |
| `legislations.py:29` | `/api/v1/legislations` |

There is no `immi_case_downloader/templates/` directory (`ls` → No such file or
directory) and no Jinja2 blueprint is registered. `immi_case_downloader/web/__init__.py:158-163`:

```python
    # React SPA catch-all: serve all non-API requests from the React build.
...
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
```

So the catch-all is at `/`, not `/app/`, and the "legacy Jinja2 at `/`" half of
the Dual-UI claim is gone.

```
$ grep -cE '^    [a-z_]+\s*:' immi_case_downloader/models.py
31
```

`immi_case_downloader/models.py:11-41` declares 31 annotated fields, `case_id`
through `legal_test_applied`. `README.md:373` already says "31 fields".

```
$ find tests -name 'test_*.py' -not -path '*/e2e/*' | wc -l
70
$ find tests -name 'test_*.py' -not -path '*/e2e/*' -exec grep -c "def test_" {} + | awk -F: '{s+=$2} END{print s}'
1106
$ find tests/e2e -name 'test_*.py' | wc -l
25
$ find tests/e2e -name 'test_*.py' -exec grep -c "def test_" {} + | awk -F: '{s+=$2} END{print s}'
260
$ find frontend/__tests__ -name '*.test.*' | wc -l
55
$ find workers/__tests__ -name '*.test.*' | wc -l
25
$ cd workers && npx vitest run
 Test Files  25 passed (25)
      Tests  345 passed (345)
```

`frontend/src/__tests__` does not exist (`ls` → No such file or directory); the
55 frontend test files live flat in `frontend/__tests__/`. A working
single-file invocation, verified:

```
$ cd frontend && npx vitest run __tests__/judge-pages.test.tsx
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

`workers/auth/handlers.js` **exists** (25501 bytes), is imported only by
`workers/__tests__/auth-handlers-cloudflare.test.js:35`, and branches on
`env.HYPERDRIVE` at lines 287/368/469/524/695. `workers/cloudflare-native.js`
imports `./auth/cloudflare_handlers.js` (lines 11–19), never `auth/handlers.js`.
So it is dead-to-production but **not deleted**.

No D1 backup or rollback procedure is documented anywhere in the repo:

```
$ grep -rln "time travel\|Time Travel\|wrangler d1 export\|d1 backup" \
    --include="*.md" --include="*.py" --include="*.ts" --include="*.js" --include="*.yml" . \
    | grep -v node_modules
(no output)
```

`docs/JUDGE_DATA_QUALITY.md:1-4` is explicitly Supabase-era:

```
# Judge Field Data Quality Report

**Date**: 2026-05-02
**Source**: Supabase `public.immigration_cases` (149,016 rows)
```

`docs/ARCHITECTURE.md:153-155` retires the Flask fall-through language:

```
- **Tag filtering and other Flask-era "fall through" comments in older
  docs no longer apply** — there is nothing left to fall through to.
  An unhandled `/api/*` route is a genuine `503`.
```

The correct LLM Council Anthropic model id, from three independent sources:

```
$ sed -n '36p' .env.example
LLM_COUNCIL_ANTHROPIC_MODEL=anthropic/claude-sonnet-4-6
$ sed -n '40p' workers/llm-council/runner.js
const DEFAULT_ANTHROPIC_MODEL = "anthropic/claude-sonnet-4-6";
```

`workers/llm-council/runner-helpers.js:22-26` shows why the corrupted string is
dangerous — a bare name is auto-prefixed, not corrected:

```js
export function normalizeGatewayModel(model, defaultPrefix) {
  const name = (model || "").trim();
  if (name.includes("/")) return name;
  return name ? `${defaultPrefix}/${name}` : name;
}
```

So `Codex-sonnet-4-6` becomes `anthropic/Codex-sonnet-4-6` and is rejected
downstream.

### Verbatim excerpts to be changed — `AGENTS.md`

`AGENTS.md:3`:

```
This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.
```

`AGENTS.md:9`:

```
**Production data layer**: Cloudflare Worker (`workers/proxy.js`) handles all read traffic natively via Hyperdrive → Supabase PostgreSQL — Flask Container is only used for writes, LLM search, CSRF, and React SPA serving.
```

`AGENTS.md:43`:

```
python extract_llm_fields.py               # uses Codex Sonnet, batched
```

`AGENTS.md:68` (the corrupted model id):

```
- Model routing requires provider prefix on compat endpoint: `openai/<model>`, `anthropic/<model>`, `google-ai-studio/<model>`. Defaults: gpt-5-mini, gemini-3.1-pro-preview, Codex-sonnet-4-6, gemini-2.5-flash (moderator).
```

`AGENTS.md:135-140`:

```
workers/
  proxy.js            → Main Cloudflare Worker: read-path via Hyperdrive, write-path
                        via Flask Container, React SPA serving (see §Worker Architecture)
  austlii-scraper/    → Separate Cloudflare Worker for async bulk AustLII scraping
                        Uses Cloudflare Queue (SCRAPE_QUEUE) + R2 bucket (CASE_RESULTS)
                        max_batch_size=5, max_concurrency=20, dead_letter_queue configured
```

`AGENTS.md:160-161`:

```
3. Subsequent reads: `Authorization: Bearer <access_token>` header → Worker verifies JWT → `getSqlAsUser()` wraps query in `sql.begin() + SET LOCAL request.jwt.claims` → RLS enforces tenant isolation
4. Writes proxied to Flask with `Authorization` + `X-Internal-Route: worker` headers → Flask re-verifies JWT with same `JWT_SECRET_CURRENT`
```

`AGENTS.md:167-168` and `:170` name deleted files:

```
- `workers/auth/handlers.js` — Auth route handlers
- `workers/db/getSqlAsUser.js` — Transaction-wrapped DB client with SET LOCAL
```
```
- `supabase/migrations/20260503_001_tenancy.sql` — Schema: users, tenants, tenant_members
```

`AGENTS.md:186`:

```
All GET requests to `/api/v1/*` are intercepted by `proxy.js` first. If a native Hyperdrive handler exists, Flask is **never called**. Only unmatched paths fall through.
```

`AGENTS.md:224` and `:337` reference line numbers inside the deleted file:

```
└── Everything else → Flask Container (Durable Object "flask-v15" — bumped from v13. See `workers/proxy.js:2725` for current)
```
```
- **Durable Object name**: `idFromName("flask-v15")` (current; was v13/v14 in earlier revisions). Bumping suffix creates fresh container state; keep stable unless intentionally resetting. Authoritative reference: `workers/proxy.js:2475` and `docs/ARCHITECTURE.md`
```

`AGENTS.md:335` and `:339`:

```
- **CI must `npm ci` before `wrangler deploy`** — `postgres` package imported by `workers/proxy.js` not auto-installed
```
```
- **austlii-scraper Worker**: separate deploy in `workers/austlii-scraper/`; set `AUTH_TOKEN` via `wrangler secret put AUTH_TOKEN`
```

`AGENTS.md:342` heads the perf baseline with no HISTORICAL label (its
`CLAUDE.md` twin at :344 is labelled):

```
## Performance Baseline (2026-05-05)
```

`AGENTS.md:376`:

```
LLM-assisted extraction (`extract_structured_fields_llm.py`) requires `ANTHROPIC_API_KEY` in `.env` (Codex's built-in key does NOT work for user scripts).
```

`AGENTS.md:398-440` is a machine-managed GitNexus block delimited by
`<!-- gitnexus:start -->` / `<!-- gitnexus:end -->`, 43 lines,
`md5 = 5b42ede6f90290a95c990201c12d2dc6`. `CLAUDE.md:402-444` holds a
byte-identical copy (same md5).

### Verbatim excerpts to be changed — `CLAUDE.md`

`CLAUDE.md:18-25` (Commands block — no `make test-workers` row despite line 18
promising the Worker suite):

```
make test         # All tests: Python unit + frontend Vitest + Worker Vitest
make test-py      # Python unit tests only (excludes E2E)
make test-fe      # Frontend Vitest tests only
make test-e2e     # Playwright E2E (requires running server)
make coverage     # Python unit tests with HTML coverage report
make lint         # Ruff lint Python source
make typecheck    # TypeScript type check (tsc --noEmit)
make migrate      # Push pending Supabase migrations (supabase db push)
```

`CLAUDE.md:31-32`:

```
# Run a single Vitest test file
cd frontend && npx vitest run src/__tests__/components/judges/
```

`CLAUDE.md:81`:

```
  models.py           → ImmigrationCase dataclass (22 fields, SHA-256 ID generation)
```

`CLAUDE.md:91-92`:

```
  visa_registry.py    → VISA_REGISTRY: canonical subclass→name→family lookup; used by
                        Worker proxy and Flask analytics for visa family grouping
```

`CLAUDE.md:95`:

```
    __init__.py       → Flask factory with API blueprint + SPA catch-all at /app/
```

`CLAUDE.md:100-108`:

```
    routes/
      api.py          → /api/v1/* JSON endpoints (~30 endpoints) for React SPA
      legislations.py → /api/v1/legislations/* endpoints (3 routes: list, detail, search)
      dashboard.py    → Legacy Jinja2 dashboard
      cases.py        → Legacy Jinja2 case CRUD
      search.py       → Legacy Jinja2 search
      export.py       → CSV/JSON export
      pipeline_routes.py → Pipeline actions
      update_db.py    → Legacy update DB
```

`CLAUDE.md:114`:

```
frontend/             → React SPA (Vite 6 + React 18 + TypeScript + Tailwind v4)
```

`CLAUDE.md:116-126`:

```
    pages/            → 27 pages including:
                        DashboardPage, CasesPage, CaseDetailPage, CaseEditPage,
                        CaseAddPage, CaseComparePage, AnalyticsPage,
                        JudgeProfilesPage, JudgeDetailPage, JudgeComparePage,
                        LegislationsPage, LegislationDetailPage,
                        CourtLineagePage, DownloadPage, PipelinePage,
                        CollectionsPage, CollectionDetailPage,
                        GuidedSearchPage, SemanticSearchPage, SavedSearchesPage,
                        LlmCouncilPage, LlmCouncilSessionsPage, DataDictionaryPage,
                        TaxonomyPage, SearchTaxonomyPage,
                        DesignTokensPage, JobStatusPage
```

`CLAUDE.md:159`:

```
- **Dual UI**: React SPA at `/app/` + legacy Jinja2 at `/`. API at `/api/v1/*`.
```

`CLAUDE.md:181` (asserts a deletion that did not happen):

```
- `workers/auth/cloudflare_handlers.js` — Auth route handlers, D1-backed (replaces the deleted Supabase-era `workers/auth/handlers.js` path)
```

`CLAUDE.md:275-277` (the three retired-stack gotchas; note :275 directly
contradicts `CLAUDE.md:233`, which says D1 bindings mean "there is no
per-request client to construct"):

```
- **Worker postgres client** — always create per-request via `getSql(env)`, never module-level singleton (I/O context binding)
- **Tag filtering** — `buildCasesWhere()` returns `null` for `tag` param; Worker falls back to Flask (pipe-delimited array logic)
- **🛑 Production data cleanup rule** — Before ANY bulk UPDATE/DELETE on `public.immigration_cases` (especially regex/pattern-shape based cleanup of mixed-content fields like `judges`): (1) `ALTER TABLE … ADD COLUMN <col>_backup text; UPDATE … SET <col>_backup = <col>` first — gives sub-second rollback; (2) dry-run on `LIMIT 100` and **eyeball** matches against ground-truth (local `case_texts/*.txt`) — pattern-shape garbage rules have ~10–15% false-positive rate on legitimate names like `Michael Cooke (NSW)` / `general member cosgrave`; (3) Supabase Free tier daily backups are **Dashboard-only restore** (`supabase backups restore` CLI returns 400 "PITR not enabled"). See `docs/JUDGE_DATA_QUALITY.md` post-mortem for the 2026-05-02 incident.
```

`CLAUDE.md:386`:

```
- **Test suite** (source-counted via `grep "def test_"` / `it\|test\(`, not pytest collect — re-verify with `pytest --collect-only -q | tail -1`): ~1,857 tests — 1,107 Python unit (71 files) + 260 Playwright E2E (25 files, all of `tests/e2e/` — `tests/e2e/react/` (236 tests/21 files) + `tests/e2e/playwright/` + root-level `test_smoke.py`/`test_export.py`/`test_credentialed_auth_smoke.py`) + 490 frontend unit (55 files, Vitest). `@pytest.mark.parametrize` expansion makes pytest collect count higher.
```

### Verbatim excerpt for reference only — `Makefile` (NOT edited by this plan)

`Makefile:28` (help text), while `Makefile:62` actually runs three suites and
`Makefile:70-71` defines the third:

```make
	@echo "  make test         All tests (Python unit + frontend Vitest)"
```
```make
test: test-py test-fe test-workers
```
```make
test-workers:
	cd "$(REPO_ROOT)/workers" && npx vitest run
```

`test-workers` is already declared `.PHONY` at `Makefile:4`. Commit `be67616`
("docs: make test also runs the Worker suite") updated the agent docs and left
this `@echo` behind. **Plan 002 Step 10 fixes it**, along with adding
`make test-workers` and `make test-pipeline` help lines; this plan verifies
rather than duplicates that work.

### Repo conventions that must survive this edit

These are documented rules the docs describe and that must remain stated after
the rewrite — do not delete them while trimming:

- React: use `.toSorted()` not `.sort()`; wrap every `localStorage` call in
  try/catch; use `t("key", { defaultValue: "..." })` for UI strings;
  filter-dependent TanStack Query hooks use `placeholderData`/`keepPreviousData`
  to avoid empty-state flash; every Recharts `Tooltip` `contentStyle` must set
  `color: "var(--color-text)"`; put `animate-spin` on a wrapper `<div>`, not on
  the SVG icon; all spacing/shadow/radius/colour values come from
  `frontend/src/tokens/tokens.json` — no magic numbers.
- Design direction is decided and named **"Legal Codex"**: warm off-white
  `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text serif
  headings, 9 court-specific colour codes. Primary user is a self-representing
  immigration applicant, not a lawyer; brand is authoritative, precise,
  academic.
- Python: dataclass `ImmigrationCase` in `immi_case_downloader/models.py`;
  `CaseRepository` Protocol in `repository.py`; always construct cases via
  `ImmigrationCase.from_dict()` because pandas turns empty CSV fields into
  `float('nan')`.
- Worker: tenant isolation is app-layer via
  `CloudflareIdentityStore.assertMembership()` (`workers/storage/cloudflare.js`)
  — there is **no** Postgres and **no** RLS. `env.IMMI_CATALOG_DB` /
  `IMMI_ACCOUNT_DB` / `IMMI_OPS_DB` are D1 bindings.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Drift check | the four commands above | see the drift-check block |
| Makefile help | `make help` | prints the target list; exit 0 |
| Worker tests | `make test-workers` | exit 0; count unchanged (this plan adds none) |
| Python lint | `make lint-py` (`make lint` before plan 001) | `All checks passed!` |
| Python tests | `make test-py` | exit status and the **set of failing files** unchanged — see note |
| Frontend tests | `cd frontend && npx vitest run` | exit 0; count unchanged |
| GitNexus block hash (macOS) | `sed -n '/<!-- gitnexus:start -->/,/<!-- gitnexus:end -->/p' AGENTS.md \| md5` | `5b42ede6f90290a95c990201c12d2dc6` |
| GitNexus block hash (Linux) | `sed -n '/<!-- gitnexus:start -->/,/<!-- gitnexus:end -->/p' AGENTS.md \| md5sum` | `5b42ede6f90290a95c990201c12d2dc6  -` |
| Changed-file check | `git status --short` | only `AGENTS.md`, `CLAUDE.md`, `plans/042-*.md` |

**Step 0 — record the baseline.** This plan asserts no absolute suite totals:
plans 038, 039, 040 and 041 all move them, and a docs plan that pins one would
go red for reasons that have nothing to do with docs.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-py > /tmp/immi-042-py-before.txt 2>&1; echo "test-py exit=$?"
grep -E '^(FAILED|ERROR) ' /tmp/immi-042-py-before.txt | sort > /tmp/immi-042-pyfail-before.txt
cat /tmp/immi-042-pyfail-before.txt
make test-workers > /tmp/immi-042-workers-before.txt 2>&1; echo "workers exit=$?"; tail -3 /tmp/immi-042-workers-before.txt
```

**Note on `make test-py`**: on the planning machine
`/tmp/immi-042-pyfail-before.txt` holds exactly 3 lines, all in
`tests/test_backfill_judge_overrides_from_pdf.py`, all `ImportError` from a
Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch that breaks `pypdf`.
That is an environment problem, not repo code, and **not** this plan's problem.
This plan changes only Markdown, so it cannot change any test result — the
suites are a cheap regression guard. Compare the failing **set by name** at the
end, not a count.

The Python virtualenv is at `.venv/`. Use `.venv/bin/python`, `.venv/bin/pytest`
and `.venv/bin/ruff` — never global `pip`. The `Makefile` already resolves
`$(PYTHON)` to `.venv/bin/python` when the venv exists.

## Scope

**In scope** (the only files you may modify):

- `AGENTS.md` — replaced wholesale (except its GitNexus block, preserved
  byte-for-byte)
- `CLAUDE.md` — targeted edits only

**`Makefile` was in scope in an earlier draft and is now out.** Plan 002 Step 10
makes exactly the same two help-line changes (and more), so this plan's Step 7
would either conflict or find its anchor strings already gone. Step 7 is now a
read-only verification that 002's help lines are present.

**Out of scope** (do NOT touch, even though they look related):

- `README.md` — it carries its own version of the same drift (`README.md:589`
  says "React 18, TypeScript, Vite 7"; `:16`, `:95` and `:396` say 24 pages;
  `:570` promises "ESLint + Prettier" when no Prettier config or dependency
  exists; `:118` documents a venv-less `pip install`). `README.md` belongs to
  other plans (`plans/002-fix-test-collection-and-install.md` and
  `plans/037-align-the-worker-toolchains.md` both list it in scope). Editing it
  here would collide with them. After this plan, `README.md` will still say
  "24 pages" and "React 18" while `CLAUDE.md` says 27 and React 19 — that is
  expected and is those plans' job.
- The whole `Makefile`, recipes and help lines alike. `typecheck`/`lint` belong
  to plan 001; the `PYTHON` resolution, `audit-rls-guards` and the entire `help:`
  block belong to plan 002. Retargeting or fail-closing `migrate:` (today
  `supabase db push`, while the production schema lives in
  `migrations/d1/{account,catalog,ops}/`) is a real safety fix that this plan
  cannot make — it is escalated with a concrete patch under "Maintenance notes"
  → OPEN SAFETY GAP.
- `docs/ARCHITECTURE.md` — its reconciliation table at lines 236–246 lists
  `README.md`, `CLAUDE.md` and three `.omc/plans/*` but not `AGENTS.md`. Adding
  a row is unnecessary once `AGENTS.md` no longer contains architecture prose to
  reconcile. Leave the file alone.
- `docs/JUDGE_DATA_QUALITY.md` — a correctly-dated Supabase-era post-mortem.
  Keep it; both docs will keep linking to it, labelled as historical.
- `workers/**`, `immi_case_downloader/**`, `frontend/**`, `.github/**`,
  `wrangler.toml`, `.env.example` — this is a docs-only plan. Do not "fix" any
  code you notice while reading.
- The `<!-- gitnexus:start -->` … `<!-- gitnexus:end -->` blocks in both files
  — machine-managed. Preserve byte-for-byte.
- `CLAUDE.md:344-359`, the section headed
  `## Performance Baseline (2026-05-05) — HISTORICAL, Hyperdrive-era`. It is
  already explicitly labelled historical, which is by design. Its
  `getSql(env)` mention at `CLAUDE.md:357` therefore **stays**.
- Placeholder resource IDs in `wrangler.toml`,
  `IMMI_CASE_MUTATIONS_ENABLED`/pipeline flags defaulting to `"false"`, and
  `workers/austlii-scraper/scripts/rollback_run.ts` targeting legacy Supabase —
  all correct by design. Do not describe any of them as bugs.

## Git workflow

- Branch: `advisor/042-rewrite-the-agent-facing-docs` (create from `main`;
  do not work directly on `main`).
- One commit for the whole plan is fine, or one per step. Message style is
  conventional commits, `<type>: <description>`, type from
  `feat|fix|refactor|docs|test|chore|perf|ci`. Example from `git log`:
  `fix: install root node_modules in make install`. Suggested message for this
  plan: `docs: describe the D1-native architecture in AGENTS.md and CLAUDE.md`.
- No AI attribution lines, co-author trailers, or emoji in commit messages.
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and ships.

## Steps

### Step 1: Fix the `CLAUDE.md` Commands block

Two edits in `CLAUDE.md`.

**1a.** Add a `make test-workers` row. Replace this line:

```
make test-fe      # Frontend Vitest tests only
```

with these two lines:

```
make test-fe      # Frontend Vitest tests only
make test-workers # Worker Vitest tests only (workers/__tests__)
```

**1b.** Replace the stale single-Vitest-file example. Replace:

```
cd frontend && npx vitest run src/__tests__/components/judges/
```

with:

```
cd frontend && npx vitest run __tests__/judge-pages.test.tsx
```

(`frontend/src/__tests__` does not exist; the 55 test files live flat in
`frontend/__tests__/`.)

**Verify**:

```
grep -c "make test-workers" CLAUDE.md
```
→ `1`

```
grep -n "src/__tests__" CLAUDE.md
```
→ no matches (exit 1)

```
cd frontend && npx vitest run __tests__/judge-pages.test.tsx
```
→ `Test Files  1 passed (1)`, `Tests  11 passed (11)`

### Step 2: Correct the `CLAUDE.md` architecture tree

Five edits inside the fenced ``` block that starts at `CLAUDE.md:74`.

**2a.** Field count. Replace:

```
  models.py           → ImmigrationCase dataclass (22 fields, SHA-256 ID generation)
```

with:

```
  models.py           → ImmigrationCase dataclass (31 fields, SHA-256 ID generation);
                        always build instances via ImmigrationCase.from_dict()
```

**2b.** Drop the dead "Worker proxy" reference. Replace:

```
  visa_registry.py    → VISA_REGISTRY: canonical subclass→name→family lookup; used by
                        Worker proxy and Flask analytics for visa family grouping
```

with:

```
  visa_registry.py    → VISA_REGISTRY: canonical subclass→name→family lookup; used by
                        the Worker and Flask analytics for visa family grouping
```

**2c.** Fix the catch-all path. Replace:

```
    __init__.py       → Flask factory with API blueprint + SPA catch-all at /app/
```

with:

```
    __init__.py       → Flask factory: registers 7 API blueprints + internal_extract_bp,
                        plus a React-build catch-all at / (every non-/api/ path)
```

**2d.** Replace the entire `routes/` sub-block. Replace these nine lines:

```
    routes/
      api.py          → /api/v1/* JSON endpoints (~30 endpoints) for React SPA
      legislations.py → /api/v1/legislations/* endpoints (3 routes: list, detail, search)
      dashboard.py    → Legacy Jinja2 dashboard
      cases.py        → Legacy Jinja2 case CRUD
      search.py       → Legacy Jinja2 search
      export.py       → CSV/JSON export
      pipeline_routes.py → Pipeline actions
      update_db.py    → Legacy update DB
```

with:

```
    routes/           → 7 blueprints; no Jinja2 routes remain
      api.py          → /api/v1: csrf-token, stats, stats/trends, analytics/*
      api_cases.py    → /api/v1: cases, cases/count, cases/<case_id> (CRUD)
      api_export.py   → /api/v1: export/csv, export/json
      api_pipeline.py → /api/v1: job-status, download/start, pipeline-status,
                        pipeline-action, llm-council/*
      api_taxonomy.py → /api/v1: court-lineage, visa-registry, taxonomy/*
      bookmarks.py    → /api/v1/collections/* (collections + bookmarks)
      legislations.py → /api/v1/legislations/* (list, search, detail, update)
```

**2e.** Frontend stack + page list. Replace this block (from the `frontend/`
line through `DesignTokensPage, JobStatusPage`):

```
frontend/             → React SPA (Vite 6 + React 18 + TypeScript + Tailwind v4)
  src/
    pages/            → 27 pages including:
                        DashboardPage, CasesPage, CaseDetailPage, CaseEditPage,
                        CaseAddPage, CaseComparePage, AnalyticsPage,
                        JudgeProfilesPage, JudgeDetailPage, JudgeComparePage,
                        LegislationsPage, LegislationDetailPage,
                        CourtLineagePage, DownloadPage, PipelinePage,
                        CollectionsPage, CollectionDetailPage,
                        GuidedSearchPage, SemanticSearchPage, SavedSearchesPage,
                        LlmCouncilPage, LlmCouncilSessionsPage, DataDictionaryPage,
                        TaxonomyPage, SearchTaxonomyPage,
                        DesignTokensPage, JobStatusPage
```

with:

```
frontend/             → React SPA (Vite 7 + React 19 + TypeScript 5.9 + Tailwind v4)
  src/
    pages/            → 27 pages (authoritative list: ls frontend/src/pages/):
                        DashboardPage, CasesPage, CaseDetailPage, CaseEditPage,
                        CaseAddPage, CaseComparePage, AnalyticsPage,
                        JudgeProfilesPage, JudgeDetailPage, JudgeComparePage,
                        LegislationsPage, LegislationDetailPage,
                        CourtLineagePage, CollectionsPage, CollectionDetailPage,
                        GuidedSearchPage, SemanticSearchPage, SavedSearchesPage,
                        LlmCouncilPage, LlmCouncilSessionsPage, DataDictionaryPage,
                        TaxonomyPage, SearchTaxonomyPage, DataToolsPage,
                        AdminPipelineRunsPage, LoginPage, DesignTokensPage
```

**Verify**:

```
grep -n "22 fields\|Vite 6\|React 18\|DownloadPage\|PipelinePage\|JobStatusPage\|dashboard.py\|update_db.py\|pipeline_routes.py\|Worker proxy" CLAUDE.md
```
→ no matches (exit 1)

```
grep -c "31 fields" CLAUDE.md
```
→ `1`

```
for p in AdminPipelineRunsPage DataToolsPage LoginPage; do grep -q "$p" CLAUDE.md && echo "$p ok"; done
```
→ three `ok` lines

```
ls frontend/src/pages/*.tsx | wc -l
```
→ `27` (confirms the count in the doc is still right)

### Step 3: Fix the `CLAUDE.md` Dual-UI pattern and the false deletion claim

**3a.** Replace `CLAUDE.md:159`:

```
- **Dual UI**: React SPA at `/app/` + legacy Jinja2 at `/`. API at `/api/v1/*`.
```

with:

```
- **Single UI**: the React SPA is the only UI. In production the Worker serves it
  from Workers Static Assets; in local dev Flask serves the React build from a
  catch-all at `/`. The legacy Jinja2 dashboard is gone — there is no
  `immi_case_downloader/templates/` directory and no Jinja2 blueprint. API at
  `/api/v1/*`.
```

**3b.** `workers/auth/handlers.js` still exists on disk (25 KB, imported only by
`workers/__tests__/auth-handlers-cloudflare.test.js`), so calling it "deleted" is
false. Replace `CLAUDE.md:181`:

```
- `workers/auth/cloudflare_handlers.js` — Auth route handlers, D1-backed (replaces the deleted Supabase-era `workers/auth/handlers.js` path)
```

with a claim that stays true whether or not the dead file is later removed:

```
- `workers/auth/cloudflare_handlers.js` — the D1-backed auth route handlers; the only auth handler module `workers/cloudflare-native.js` imports
```

**Verify**:

```
grep -n "legacy Jinja2 at\|the deleted Supabase-era" CLAUDE.md
```
→ no matches (exit 1)

```
grep -n "cloudflare_handlers.js" workers/cloudflare-native.js
```
→ at least the `./auth/cloudflare_handlers.js` import (confirms 3b's claim)

```
ls immi_case_downloader/templates
```
→ `No such file or directory` (confirms 3a's claim)

### Step 4: Replace the three retired-stack gotchas in `CLAUDE.md`

Delete `CLAUDE.md:275` and `:276` outright and rewrite `:277`.

**4a.** Delete this line entirely (it contradicts `CLAUDE.md:233`, which says D1
bindings mean "there is no per-request client to construct"):

```
- **Worker postgres client** — always create per-request via `getSql(env)`, never module-level singleton (I/O context binding)
```

**4b.** Delete this line entirely (`docs/ARCHITECTURE.md:153-155`: "there is
nothing left to fall through to. An unhandled `/api/*` route is a genuine
`503`."):

```
- **Tag filtering** — `buildCasesWhere()` returns `null` for `tag` param; Worker falls back to Flask (pipe-delimited array logic)
```

**4c.** Replace the whole 🛑 line with a D1-accurate version. Replace:

```
- **🛑 Production data cleanup rule** — Before ANY bulk UPDATE/DELETE on `public.immigration_cases` (especially regex/pattern-shape based cleanup of mixed-content fields like `judges`): (1) `ALTER TABLE … ADD COLUMN <col>_backup text; UPDATE … SET <col>_backup = <col>` first — gives sub-second rollback; (2) dry-run on `LIMIT 100` and **eyeball** matches against ground-truth (local `case_texts/*.txt`) — pattern-shape garbage rules have ~10–15% false-positive rate on legitimate names like `Michael Cooke (NSW)` / `general member cosgrave`; (3) Supabase Free tier daily backups are **Dashboard-only restore** (`supabase backups restore` CLI returns 400 "PITR not enabled"). See `docs/JUDGE_DATA_QUALITY.md` post-mortem for the 2026-05-02 incident.
```

with:

```
- **🛑 Production data cleanup rule (D1)** — the production corpus lives in D1 `IMMI_CATALOG_DB` (~150K cases) plus R2 `IMMI_CONTENT`. **Distinguish two paths.** The Worker API is fail-closed behind `IMMI_CASE_MUTATIONS_ENABLED` (checked-in default `"false"`; enforced at `workers/case-api/cloudflare_mutations.js:302`) — but that flag gates **only** the Worker. An operator running `wrangler d1 execute --remote --command "UPDATE …"` bypasses it entirely, and that is how bulk cleanups actually get run. Before ANY bulk UPDATE/DELETE by either path: (1) **take and verify a snapshot** — `wrangler d1 export <BINDING> --remote --output=…`, then prove the dump restores by importing it into a scratch local D1 and comparing row counts; a dump you have not restored is not a backup; (2) **rehearse on a clone**, not on production — import that dump into a scratch database and run the statement there first; (3) **dry-run on `LIMIT 100`** and **eyeball** matches against ground truth (local `case_texts/*.txt`) — pattern-shape "garbage" rules had a ~10–15% false-positive rate on legitimate names like `Michael Cooke (NSW)` / `general member cosgrave`; (4) **give yourself an in-database undo**: D1 is SQLite, so `ALTER TABLE … ADD COLUMN <col>_backup TEXT; UPDATE … SET <col>_backup = <col>;` works, as does a shadow table (`CREATE TABLE <t>_backup AS SELECT * FROM <t>`) when several columns change — pick per table and check the row-size and statement limits before doing it on the largest ones; (5) **know your rollback and its cost before you start**: confirm the restore command for your Wrangler version (`npx wrangler d1 --help`, `npx wrangler d1 time-travel --help`) and write down the RTO and the maximum acceptable data loss — a whole-database point-in-time restore also discards every case the weekly VPS crawler ingested since that point. Full procedure: `docs/ops/d1-migrations.md`. `docs/JUDGE_DATA_QUALITY.md` is the 2026-05-02 post-mortem; it describes the **Supabase-era** incident and its Postgres-specific remedies no longer apply, but the false-positive analysis still does.
```

Three claims from an earlier draft of this rule were wrong and must not be
reinstated:

- **"there is no `_backup` column trick"** — false. D1 is SQLite and supports
  `ALTER TABLE … ADD COLUMN`; the checked-in migrations use SQLite DDL
  throughout. Whether a backup column or a shadow table is the right shape is a
  per-table judgement (row-size limits, index count), not a blanket "impossible".
- **"writes are fail-closed behind `IMMI_CASE_MUTATIONS_ENABLED`"** as a general
  safety net — false for the path that matters. That flag is checked inside
  `dispatchCloudflareCaseMutation` only; a `wrangler d1 execute` is not gated by
  anything.
- **"take your own snapshot"** with no procedure — not actionable. A backup step
  with no verify step and no restore command is a sentence, not a safeguard.

**Verify**:

```
grep -n "falls back to Flask\|ALTER TABLE\|public.immigration_cases\|PITR not enabled" CLAUDE.md
```
→ no matches (exit 1)

```
grep -c "getSql(env)" CLAUDE.md
```
→ `1` — the single surviving mention is inside the
`## Performance Baseline (2026-05-05) — HISTORICAL, Hyperdrive-era` section,
which is deliberately preserved. Confirm with:

```
grep -n "getSql(env)" CLAUDE.md
```
→ one line number, and it must be **greater** than the line number returned by
`grep -n "HISTORICAL, Hyperdrive-era" CLAUDE.md`. If it is smaller, you deleted
the wrong occurrence — restore and redo.

### Step 5: Fix the `CLAUDE.md` test-suite bullet

**Do not write test counts into this block.** Plans 038, 039, 040 and 041 each
add tests, and plan 002 changes which suites `make test` runs. Any number typed
here is stale within days — that is precisely the class of drift this plan
exists to remove, and re-introducing it one paragraph lower would be
self-defeating. Name the command and the regeneration recipe instead.

Replace `CLAUDE.md:386` (one long line) with this block:

```
- **Test suite** — five independently runnable suites. **Counts are deliberately
  not written here**; they drift with every test added. Run the command, or
  regenerate a source count with the recipe next to it.
  - `make test-py` — Python unit tests (`tests/`, excluding `tests/e2e/` and
    `tests/integration/`).
    Source count: `grep -rn "def test_" tests/ --include="*.py" | grep -v "/e2e/" | wc -l`
  - `make test-fe` — frontend Vitest (`frontend/__tests__/`, a flat directory
    plus one `auth/` subdirectory).
    File count: `find frontend/__tests__ -name '*.test.*' | wc -l`
  - `make test-workers` — main Cloudflare Worker Vitest (`workers/__tests__/`).
    Covers the whole production request path (auth, mutations, Council, the
    `cloudflare-native.js` bundle) and is a CI gate: `.github/workflows/ci.yml`
    runs `npm run test:workers`.
    File count: `find workers/__tests__ -name '*.test.*' | wc -l`
  - `make test-pipeline` — the austlii-scraper (pipeline Worker) Vitest suite
    (`workers/austlii-scraper/src/**/*.test.ts`).
  - `make test-e2e` — Playwright E2E (`tests/e2e/`). The pytest fixture
    **launches its own seeded Flask server** in a daemon thread
    (`tests/e2e/conftest.py:232-274`); setting `E2E_BASE_URL` is what switches it
    to an external server (`conftest.py:229`, `:278-282`). Needs the extra deps
    in `requirements-e2e.txt` — `make install-e2e` first.
  `make test` runs the first four (`test-py test-fe test-workers test-pipeline`).
  `@pytest.mark.parametrize` expansion makes the pytest *collected* count higher
  than any `grep "def test_"` source count, so the two never agree — prefer the
  command's own output.
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
# The stale figures are gone:
grep -n "71 files\|1,107 Python\|1,857 tests\|490 frontend unit\|345 tests in" CLAUDE.md; echo "stale-count grep exit=$? (want 1)"
grep -c "make test-workers" CLAUDE.md      # -> 2 (Commands block + here)
grep -c "make test-pipeline" CLAUDE.md     # -> 1
# The claim about make test must match the Makefile, not this plan's memory:
grep -E '^test:' Makefile
```
→ the stale-count grep prints nothing (`exit=1`); `2`; `1`; and the `^test:`
line must list exactly the four suites the block names. If the `Makefile` says
something else, **write what the `Makefile` says** and report the discrepancy —
do not copy this plan's wording.

### Step 6: Replace `AGENTS.md` with a pointer file

Rewrite `AGENTS.md` so it no longer duplicates architecture prose at all. This
is what fixes DOCS-01, DEBT-01 and DOCS-18 permanently: a pointer cannot drift,
and there is no copied body left for a find-and-replace pass to corrupt.

**Preserve the GitNexus block.** Before editing, extract it:

```
sed -n '/<!-- gitnexus:start -->/,/<!-- gitnexus:end -->/p' AGENTS.md > /tmp/gitnexus-block.md
wc -l /tmp/gitnexus-block.md          # → 43
md5 /tmp/gitnexus-block.md            # → 5b42ede6f90290a95c990201c12d2dc6
```

Then write `AGENTS.md` as **exactly** the following content, with the extracted
43-line block appended verbatim in place of the `<<< GITNEXUS BLOCK >>>` marker.
Do not retype the GitNexus block by hand.

````markdown
# AGENTS.md

Guidance for coding agents (Codex, Cursor, aider, and anything else that reads
`AGENTS.md`) working in this repository.

## Read this first

**`CLAUDE.md`, in this same directory, is the single source of truth for this
project's architecture, commands, conventions and gotchas. Read it in full
before making any change.**

This file deliberately carries no architecture description of its own. An
earlier revision of it was a mechanical copy of `CLAUDE.md` that drifted into
describing a production stack which had already been deleted — agents acting on
it tried to re-create removed files. A pointer cannot drift.

| Need | Read |
|---|---|
| Architecture, request flow, auth model, deployment, commands, gotchas | `CLAUDE.md` |
| Longer architecture narrative + a table reconciling older docs | `docs/ARCHITECTURE.md` |
| What a deployable production config may look like (machine-checked, fail-closed — trust these over any prose, `CLAUDE.md` included) | `scripts/check_cloudflare_native_target.py`, `scripts/check_immi_activation_evidence.py` |

## Non-negotiables

These are the mistakes that cost real code. Hold them even if some other
document, comment or plan suggests otherwise:

1. **Production is one Cloudflare Worker on D1.** There is no Postgres, no
   Hyperdrive, no Supabase and no Flask container in the production request
   path. The entrypoint is `workers/cloudflare-native.js`. `workers/proxy.js`
   and `workers/db/getSqlAsUser.js` were deleted in commit `f91f45f` — do not
   reference, import or re-create them.
2. **Never add a "fall through to Flask" path.** An unhandled `/api/*` route
   returns a real `503 cloudflare_route_unavailable`; that is the design, not a
   bug. Do not re-introduce the `X-Internal-Route: worker` ingress-guard
   pattern — it belonged to the deleted proxy.
3. **Do not construct a per-request SQL client.** `env.IMMI_CATALOG_DB`,
   `env.IMMI_ACCOUNT_DB` and `env.IMMI_OPS_DB` are D1 bindings. There is no
   connection pooler and nothing to instantiate.
4. **Tenant isolation is app-layer.** It is enforced by
   `CloudflareIdentityStore.assertMembership()` in
   `workers/storage/cloudflare.js`. There is no Postgres RLS backstop — a route
   that forgets to call it is a real cross-tenant leak.
5. **The Flask app is local-dev only.** `immi_case_downloader/`, `web.py` and
   `make api` are not wired to production traffic. Changing them does not change
   what users see.
6. **Fail-closed defaults are intentional.** Placeholder resource IDs in
   `wrangler.toml`, `IMMI_CASE_MUTATIONS_ENABLED = "false"` and the pipeline
   enable flags are all by design. Do not "fix" them.
7. **New GET endpoints go in the Worker**, as a D1 query in
   `workers/case-api/cloudflare.js` or the relevant `workers/storage/cloudflare.js`
   store method.

## Commands

```bash
make install      # Install all Python + Node dependencies
make install-e2e  # Extra deps for the E2E suite (pytest-playwright + chromium)
make api          # Flask API only, local dev (http://localhost:8080)
make ui           # Vite dev server only (http://localhost:5173, HMR)
make build        # Build React frontend → immi_case_downloader/static/react/
make test         # Python unit + frontend + both Worker suites
make test-py      # Python unit tests only (no E2E, no integration)
make test-fe      # Frontend Vitest tests only
make test-workers # Main Cloudflare Worker Vitest suite
make test-pipeline # austlii-scraper (pipeline Worker) Vitest suite
make test-e2e     # Playwright E2E — starts its own seeded Flask fixture server;
                  # set E2E_BASE_URL only if you want an external target
make lint         # Ruff (Python) + ESLint (frontend)
make lint-py      # Ruff lint Python source only
make typecheck    # TypeScript type check
```

Before writing this block, run `make help` and copy what it actually prints —
plan 002 owns those help lines and this list must agree with them, not with this
plan's snapshot. **Do not** describe `make test-e2e` as "requires a running
server": `tests/e2e/conftest.py:232-274` launches Flask itself with 10 seeded
cases, and `E2E_BASE_URL` is the opt-in switch to an external server
(`conftest.py:229`, `:278-282`). That sentence is one of the errors this plan
exists to remove.

Python work uses the repo virtualenv at `.venv/` (`.venv/bin/python`,
`.venv/bin/pytest`, `.venv/bin/ruff`) — never a global `pip`. The full command
list, including the CLI and the extraction scripts, is in `CLAUDE.md`.

## Conventions you will be held to

The full lists are in `CLAUDE.md`; these are the ones most often got wrong:

- **React**: use `.toSorted()`, never `.sort()` — never mutate arrays. Wrap every
  `localStorage` call in try/catch. Use `t("key", { defaultValue: "..." })` for
  UI strings. Filter-dependent TanStack Query hooks need
  `placeholderData`/`keepPreviousData`. Every Recharts `Tooltip` `contentStyle`
  must set `color: "var(--color-text)"`. Put `animate-spin` on a wrapper `<div>`,
  not on the SVG icon. All spacing, shadow, radius and colour values come from
  `frontend/src/tokens/tokens.json` — no magic numbers.
- **Python**: build `ImmigrationCase` instances via
  `ImmigrationCase.from_dict()` — pandas turns empty CSV fields into
  `float('nan')`. Storage backends implement the `CaseRepository` Protocol in
  `immi_case_downloader/repository.py`.
- **Git**: commit messages are `<type>: <description>` with type from
  `feat|fix|refactor|docs|test|chore|perf|ci`. No attribution lines.

## Design context

The primary user is a **self-representing immigration applicant** under stress,
not a lawyer. The brand is authoritative, precise, academic.

The visual direction is decided and named **"Legal Codex"**: warm off-white
background `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text
serif headings, 9 court-specific colour codes, Grafana/Metabase-style analytics
charts. It is not up for redesign. Full design principles are in `CLAUDE.md`
§Design Context.

<<< GITNEXUS BLOCK >>>
````

**Verify**:

```
grep -n "Codex-sonnet\|Codex\.ai/code\|Codex Sonnet\|Codex's built-in" AGENTS.md
```
→ no matches (exit 1)

```
grep -n "flask-v15\|getSqlAsUser\|handleGetCases\|44 endpoints\|Flask Container\|wrangler secret put AUTH_TOKEN\|postgres\.js\|Performance Baseline" AGENTS.md
```
→ no matches (exit 1)

```
grep -c "proxy\.js" AGENTS.md
```
→ `1` (non-negotiable #1 only)

```
sed -n '/<!-- gitnexus:start -->/,/<!-- gitnexus:end -->/p' AGENTS.md | md5
```
→ `5b42ede6f90290a95c990201c12d2dc6` (use `md5sum` on Linux; expected
`5b42ede6f90290a95c990201c12d2dc6  -`)

```
test "$(wc -l < AGENTS.md)" -lt 160 && echo SHORT
```
→ `SHORT`

```
grep -c "CLAUDE.md" AGENTS.md
```
→ `6` or more

### Step 7: Verify the `Makefile` help text — do not edit it

**This step edits nothing.** An earlier draft made two `@echo` edits inside the
`help:` target. Plan 002 Step 10 replaces that whole block, including the
`make test` line and *adding* `make test-workers` and `make test-pipeline` help
lines — the same edits. Doing them here would either conflict with 002 or fail
to find its anchor strings, because after 002 the line
`@echo "  make test         All tests (Python unit + frontend Vitest)"` no
longer exists.

Instead, confirm 002's help lines are in place and that `AGENTS.md` and
`CLAUDE.md` agree with them:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make help > /tmp/immi-042-help.txt; echo "make help exit=$?"
grep -E "make test( |-)" /tmp/immi-042-help.txt
for t in test-workers test-pipeline; do
  grep -q "make $t" /tmp/immi-042-help.txt || echo "MISSING from make help: $t"
  grep -q "make $t" AGENTS.md            || echo "MISSING from AGENTS.md: $t"
done
grep -E '^test:' Makefile
git diff --stat -- Makefile; git diff --cached --stat -- Makefile
```

**Verify**: `make help exit=0`; no `MISSING …` line is printed; the `^test:`
recipe lists the same suites the help text and both docs claim; and **both
`git diff` commands on `Makefile` print nothing** — this plan must leave that
file untouched.

If a `MISSING` line appears, plan 002 has not landed. That is a STOP condition:
this plan is meant to run after it, and writing `make test-pipeline` into
`AGENTS.md` while no such target exists would be exactly the kind of false
instruction this plan removes.

### Step 8: Final consistency sweep

Run the whole-repo checks below and confirm no in-scope file still asserts a
retired-stack fact.

**Verify**:

```
grep -n "workers/proxy\.js\|getSqlAsUser\|Hyperdrive → Supabase\|X-Internal-Route" AGENTS.md CLAUDE.md
```
→ only these are allowed, and nothing else:
- `AGENTS.md` non-negotiable #1 (`workers/proxy.js`, `workers/db/getSqlAsUser.js`)
- `AGENTS.md` non-negotiable #2 (`X-Internal-Route: worker`)
- `CLAUDE.md:9` (the "were deleted in commit `f91f45f`" sentence)
- `CLAUDE.md` §Auth Architecture Critical Gotchas (the "Do not re-introduce an
  `X-Internal-Route` / Flask-ingress-guard pattern" line)
- `CLAUDE.md` §Production Deployment (the "the `flask-v15`/`getSqlAsUser`/
  Hyperdrive era is gone from production" line)
- `CLAUDE.md:346` inside the HISTORICAL performance section

Every match must be a sentence saying the thing is **gone or forbidden**, never
a sentence describing it as current. Read each match before accepting it.

```bash
git status --short
git diff --stat -- Makefile; git diff --cached --stat -- Makefile
```
→ exactly `M AGENTS.md` and `M CLAUDE.md` (plus this plan file and any
pre-existing untracked entries such as `.claude/STATE.md` and `plans/`). **No
other file may appear as modified, `Makefile` included** — both `git diff`
commands on it must print nothing.

```bash
make lint-py; echo "lint-py exit=$?"       # `make lint` before plan 001 lands
make test-workers > /tmp/immi-042-workers-after.txt 2>&1; echo "workers exit=$?"
diff <(tail -3 /tmp/immi-042-workers-before.txt) <(tail -3 /tmp/immi-042-workers-after.txt); echo "workers unchanged=$?"
make test-py > /tmp/immi-042-py-after.txt 2>&1; echo "test-py exit=$?"
grep -E '^(FAILED|ERROR) ' /tmp/immi-042-py-after.txt | sort > /tmp/immi-042-pyfail-after.txt
diff /tmp/immi-042-pyfail-before.txt /tmp/immi-042-pyfail-after.txt; echo "pyfail set unchanged=$?"
```
→ `lint-py exit=0` with `All checks passed!`; `workers unchanged=0`;
`pyfail set unchanged=0` — the same test files fail **by name** as in Step 0
(on the planning machine, still exactly the 3 pyexpat/pypdf `ImportError`s in
`tests/test_backfill_judge_overrides_from_pdf.py`). A docs-only change that
moves either result means you edited source.

## Test plan

This plan changes only Markdown prose — two files, `AGENTS.md` and `CLAUDE.md`.
It touches no `Makefile` line (see Step 7). There is no code path to test and
**no new tests are required or wanted** — a test asserting doc contents would
recreate the same drift problem one layer down.

The suites are run purely as regression guards, to prove nothing was touched by
accident. All are **delta / identity** checks against the Step 0 baseline; no
absolute total is asserted, because plans 038–041 move every one of them:

- `make test-workers` → exit 0, and the last three summary lines identical
  before and after. This suite has no dependency on any file in scope.
- `make lint-py` → `All checks passed!` (`make lint` before plan 001 lands).
- `cd frontend && npx vitest run` → exit 0, count unchanged (optional; slower).
- `make test-py` → the **set of failing files unchanged by name** vs.
  `/tmp/immi-042-pyfail-before.txt`. On the planning machine that set is the 3
  pre-existing Homebrew-Python `pyexpat`/`libexpat` `ImportError`s breaking
  `pypdf` in `tests/test_backfill_judge_overrides_from_pdf.py`. If a *different*
  file appears in that set, STOP — something outside this plan changed. Compare
  the set, not the count: a count check passes when one new real failure
  replaces one environmental one.

The real verification for this plan is the grep set in each step's **Verify**
block plus Step 8's sweep. Note that a `grep` for an absent string is a weak
check — it passes for a document that is empty, truncated, or that never
contained the string in the first place. That is why Step 8 requires you to
*read* the six allowed matches rather than only counting them, and why the
counts of positive strings (`31 fields`, `make test-workers`) are asserted
alongside the negatives.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "Codex-sonnet\|Codex\.ai/code\|Codex Sonnet\|Codex's built-in" AGENTS.md` → no matches (exit 1)
- [ ] `grep -n "flask-v15\|getSqlAsUser\|handleGetCases\|44 endpoints\|Flask Container\|postgres\.js\|Performance Baseline" AGENTS.md` → no matches (exit 1)
- [ ] `grep -c "proxy\.js" AGENTS.md` → `1`
- [ ] `sed -n '/<!-- gitnexus:start -->/,/<!-- gitnexus:end -->/p' AGENTS.md | md5` → `5b42ede6f90290a95c990201c12d2dc6`
- [ ] `test "$(wc -l < AGENTS.md)" -lt 160` → exit 0
- [ ] `grep -n "22 fields\|Vite 6\|React 18\|DownloadPage\|PipelinePage\|JobStatusPage\|dashboard.py\|update_db.py\|pipeline_routes.py\|Worker proxy\|legacy Jinja2 at" CLAUDE.md` → no matches (exit 1)
- [ ] `grep -n "falls back to Flask\|ALTER TABLE\|public.immigration_cases\|PITR not enabled\|71 files\|1,107 Python\|1,857 tests\|src/__tests__\|the deleted Supabase-era" CLAUDE.md` → no matches (exit 1)
- [ ] `grep -c "getSql(env)" CLAUDE.md` → `1`, and its line number is greater than that of `grep -n "HISTORICAL, Hyperdrive-era" CLAUDE.md`
- [ ] `grep -c "31 fields" CLAUDE.md` → `1`
- [ ] `grep -c "make test-workers" CLAUDE.md` → `2`; `grep -c "make test-pipeline" CLAUDE.md` → `1`
- [ ] `grep -n "requires a running server" CLAUDE.md AGENTS.md` → no matches
      (the E2E fixture starts its own server; `conftest.py:232-274`)
- [ ] No test count is written into `CLAUDE.md`'s test-suite block:
      `grep -nE "(1,1[0-9]{2}|1,857|490 (frontend|tests)|345 tests|260 Playwright)" CLAUDE.md` → no matches
- [ ] `sed -n '/<!-- gitnexus:start -->/,/<!-- gitnexus:end -->/p' CLAUDE.md | md5` → `5b42ede6f90290a95c990201c12d2dc6` (unchanged)
- [ ] `make help` lists `make test-workers` **and** `make test-pipeline`, and
      `grep -E '^test:' Makefile` lists the same suites the docs claim
- [ ] `make test-workers` exits 0 with the same last three summary lines as the
      Step 0 baseline (`diff` of the two tails is empty)
- [ ] `make lint-py` → `All checks passed!`
- [ ] `git status --short` shows no modified file other than `AGENTS.md` and `CLAUDE.md`
- [ ] `git diff --stat -- Makefile` and `git diff --cached --stat -- Makefile`
      are both empty — this plan no longer edits the `Makefile` at all
- [ ] `diff /tmp/immi-042-pyfail-before.txt /tmp/immi-042-pyfail-after.txt` is empty
- [ ] `plans/README.md` status row updated, if that file exists

## STOP conditions

Stop and report back (do not improvise) if:

- **The GitNexus block hash does not match** `5b42ede6f90290a95c990201c12d2dc6`
  before you start, in either file. That means the GitNexus tooling regenerated
  it since this plan was written. Do not hand-edit the block; report the new
  hash and ask whether to adopt it as the new baseline.
- **`ls workers/proxy.js` succeeds**, or `ls workers/db/` succeeds. That would
  mean the deleted stack was restored and this plan's entire premise is wrong.
  Stop immediately — do not "correct" the docs toward a stack you did not expect.
- **`grep -c '^    [a-z_]+\s*:' immi_case_downloader/models.py` (use `grep -cE`)
  does not return `31`**, or `ls frontend/src/pages/*.tsx | wc -l` does not
  return `27`, or `grep '"react"' frontend/package.json` does not show a `^19.`
  version. Those are the three counts this plan writes into `CLAUDE.md` as fact.
  If any differs, write the number you measured, and say so in your report —
  do not copy this plan's number.
- **Step 4c's replacement would be a lie**: before writing it, re-run
  `grep -rln "wrangler d1 export\|Time Travel\|d1 backup" --include="*.md" --include="*.py" --include="*.ts" --include="*.js" --include="*.yml" . | grep -v node_modules`.
  If it now returns files, a D1 backup procedure has been documented since this
  plan was written. Stop and report — the new 🛑 rule must describe that
  procedure instead of saying none exists.
- **`Makefile` appears in `git diff` at all.** This plan no longer edits it —
  plan 002 Step 10 owns the help block. Revert your `Makefile` change and redo.
- **Step 7 prints a `MISSING` line.** Plan 002 has not landed. Stop rather than
  writing `make test-pipeline` into `AGENTS.md` when no such target exists.
- **You cannot find one of the quoted excerpts** in the live file after checking
  both the exact text and a shortened distinctive substring of it.
- **A step's verification fails twice** after a reasonable fix attempt.
- **You find yourself wanting to edit `README.md`, `docs/ARCHITECTURE.md`, or any
  file under `workers/`, `frontend/` or `immi_case_downloader/`.** Those are
  out of scope and owned by other plans. Note the issue in your report instead.

## Maintenance notes

For whoever owns these docs next:

- **The whole point of Step 6 is that `AGENTS.md` must stay a pointer.** If a
  future change adds architecture prose back into it, the two files will
  diverge again — that is exactly how the corrupted `Codex-sonnet-4-6` model id
  and the deleted-`proxy.js` request diagram got in. If `AGENTS.md` ever needs
  new content, ask first whether it belongs in `CLAUDE.md` with a pointer added
  here.
- **Deliberately not done**: adding an `AGENTS.md` row to the reconciliation
  table at `docs/ARCHITECTURE.md:236-246`. That table exists to flag docs whose
  architecture prose disagrees with reality; after this plan `AGENTS.md` has no
  architecture prose, so a row would be noise. Revisit only if someone
  reintroduces prose there.
- **Deliberately not done**: `README.md`. It still says "React 18", "24 pages",
  and promises ESLint + Prettier when no Prettier config or dependency exists
  (`git ls-files | grep -i prettier` → nothing). Owned by plans 002 and 037.
  After both land, cross-check that `README.md` and `CLAUDE.md` agree on the
  page count and the React/Vite versions — they currently do not.
- **OPEN SAFETY GAP — `make migrate` still runs `supabase db push`.** This is
  not merely "deliberately not done"; it is a live footgun that documentation
  alone cannot close, and it needs an owner. `Makefile:107-108` defines a target
  named `migrate` — the generic name an agent or a new contributor will reach
  for — that pushes migrations to the **retired** Supabase project and has no
  effect on production D1. `plans/044` documents the correct D1 procedure in
  `docs/ops/d1-migrations.md` and warns against `make migrate`; both are prose,
  and prose does not stop a command from running.
  **Required follow-up, owned by whichever plan owns the `Makefile` (001/002):**
  rename the target to `migrate-supabase-legacy`, and either delete `migrate` or
  make it fail closed —
  ```make
  migrate:
  	@echo "make migrate is retired. Production schema lives in migrations/d1/;"
  	@echo "see docs/ops/d1-migrations.md. For the legacy Supabase ETL project"
  	@echo "use: make migrate-supabase-legacy"
  	@exit 1
  ```
  Until that lands, `CLAUDE.md`, `AGENTS.md` and `make help` all still advertise
  a production-sounding command that touches a retired database.
- **Known dead target**: `audit-rls-guards` (`Makefile:75-81`) greps
  `workers/**/*.js` for `set_config(` calls. That grep now returns nothing —
  there is no Postgres left — so the target always passes vacuously. Left alone
  here; it is plan 002's territory.
- **What a reviewer should scrutinise**: the six matches allowed by Step 8's
  first grep. Each must read as "this is gone / do not do this", never as a
  description of current behaviour. That grep is the cheapest recurring guard
  against this class of drift; consider running it before any future docs edit.
- **Counts that will drift**: `31 fields`, `27 pages`, and the four test counts
  in `CLAUDE.md`. Each is written next to the command that regenerates it, so
  the next person can re-derive rather than guess. Prefer regenerating over
  hand-editing.

## Findings reconsidered

Two sub-claims from the audit did not survive verification and were corrected
rather than acted on as stated:

- **"AGENTS.md contains ~230 lines of retired-stack content"** — measured, it is
  closer to ~120 lines (roughly `AGENTS.md:9`, `:136-140`, `:157-182`,
  `:184-235`, `:277-279`, `:335-342`) out of 440. The finding stands; only the
  scale estimate was wrong. Step 6 replaces the file wholesale anyway, so the
  correction changes nothing about the work.
- **`CLAUDE.md:181` calls `workers/auth/handlers.js` "deleted"** — it is not.
  `ls -la workers/auth/` shows it present at 25,501 bytes, imported by
  `workers/__tests__/auth-handlers-cloudflare.test.js:35`, branching on
  `env.HYPERDRIVE` at lines 287/368/469/524/695. It is dead-to-production (
  `workers/cloudflare-native.js` imports only `./auth/cloudflare_handlers.js`)
  but undeleted. Step 3b therefore rewrites the line to describe what
  `cloudflare_handlers.js` **is**, rather than asserting a deletion status —
  a claim that would be wrong today and would silently become right later if
  another plan removes the file. Do not "improve" it back into a deletion claim.

One item from the audit's fix sketches is intentionally not implemented, with
reasoning, rather than being dropped silently:

- **"Add a CI check that diffs `AGENTS.md` against `CLAUDE.md` modulo the title
  line."** Not implemented, because Step 6 removes the duplication entirely —
  there is nothing left to diff. A diff check would also be actively wrong after
  Step 6, since the two files are now intentionally different documents. If a
  future change reintroduces a full copy, revisit.
