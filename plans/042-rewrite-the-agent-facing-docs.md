# Plan 042: Make AGENTS.md and CLAUDE.md describe the architecture that exists

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 42826a3..HEAD -- AGENTS.md CLAUDE.md Makefile`
> If any of those three files changed since this plan was written, compare the
> "Current state" excerpts below against the live files before proceeding. Line
> numbers in this plan are from commit `42826a3`; if plans 001 or 002 have
> already run, the `Makefile` line numbers **will** have shifted. Match on the
> quoted text, not on the line number. If a quoted excerpt is nowhere to be
> found in the live file, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md`,
  `plans/002-fix-test-collection-and-install.md` — ordering only. Both edit
  `Makefile`; 001 rewrites the `typecheck`/`lint` targets and their help lines
  (help lines 32/34/35), 002 rewrites the `PYTHON` resolution and the
  `audit-rls-guards` target. This plan touches only the `make test` help line
  and adds a `make test-workers` help line, so the edits do not collide — but
  running after them avoids reconciling shifted line numbers by hand.
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
- `Makefile` — 115 lines. Only the `help:` target's `@echo` lines are in scope.

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

### Verbatim excerpt to be changed — `Makefile`

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
this `@echo` behind.

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
| Drift check | `git diff --stat 42826a3..HEAD -- AGENTS.md CLAUDE.md Makefile` | empty, or changes you have reconciled |
| Makefile help | `make help` | prints the target list; exit 0 |
| Worker tests | `make test-workers` | `Test Files 25 passed (25)`, `Tests 345 passed (345)` |
| Python lint | `make lint` | `All checks passed!` |
| Python tests | `make test-py` | 1,141 passed / 3 failed / 7 skipped — see note below |
| Frontend tests | `cd frontend && npx vitest run` | `Test Files 55 passed`, `Tests 490 passed` |
| GitNexus block hash (macOS) | `sed -n '/<!-- gitnexus:start -->/,/<!-- gitnexus:end -->/p' AGENTS.md \| md5` | `5b42ede6f90290a95c990201c12d2dc6` |
| GitNexus block hash (Linux) | `sed -n '/<!-- gitnexus:start -->/,/<!-- gitnexus:end -->/p' AGENTS.md \| md5sum` | `5b42ede6f90290a95c990201c12d2dc6  -` |
| Changed-file check | `git status --short` | only `AGENTS.md`, `CLAUDE.md`, `Makefile`, `plans/042-*.md` |

**Note on `make test-py`**: at `42826a3` this reports **3 failures** caused by a
Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch that breaks the `pypdf`
import in `tests/test_backfill_judge_overrides_from_pdf.py`. That is an
environment problem, not repo code, and **not** this plan's problem. This plan
changes only Markdown and Makefile `@echo` lines, so it cannot change any test
result. Running the suites is a cheap regression guard, not a gate you must
turn green.

The Python virtualenv is at `.venv/`. Use `.venv/bin/python`, `.venv/bin/pytest`
and `.venv/bin/ruff` — never global `pip`. The `Makefile` already resolves
`$(PYTHON)` to `.venv/bin/python` when the venv exists.

## Scope

**In scope** (the only files you may modify):

- `AGENTS.md` — replaced wholesale (except its GitNexus block, preserved
  byte-for-byte)
- `CLAUDE.md` — targeted edits only
- `Makefile` — **only** the `@echo` lines inside the `help:` target

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
- `Makefile` recipes, the `.PHONY` line, `typecheck:`, `lint:`, `migrate:`,
  `audit-rls-guards:`. `typecheck`/`lint` belong to plan 001; the `PYTHON`
  resolution and `audit-rls-guards` belong to plan 002; retargeting
  `migrate:` (today `supabase db push`, while the production schema lives in
  `migrations/d1/{account,catalog,ops}/`) is a separate decision that is not
  this plan's to make.
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
- **🛑 Production data cleanup rule (D1)** — the production corpus lives in D1 `IMMI_CATALOG_DB` (149,016 cases) plus R2 `IMMI_CONTENT`, and **this repo documents no D1 backup or restore procedure** — `grep -rn "wrangler d1 export\|Time Travel" .` finds nothing. Treat any bulk UPDATE/DELETE as irreversible. Before running one: (1) take and verify your own snapshot first — there is no `_backup` column trick and no dashboard restore to fall back on; (2) dry-run on a `LIMIT 100` sample and **eyeball** matches against ground truth (local `case_texts/*.txt`) — pattern-shape "garbage" rules had a ~10–15% false-positive rate on legitimate names like `Michael Cooke (NSW)` / `general member cosgrave`; (3) remember writes are fail-closed behind `IMMI_CASE_MUTATIONS_ENABLED` (default `"false"`) — if you had to flip it, flip it back. `docs/JUDGE_DATA_QUALITY.md` is the 2026-05-02 post-mortem; it describes the **Supabase-era** incident and its Postgres-specific remedies no longer apply, but the false-positive analysis still does.
```

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

Replace `CLAUDE.md:386` (one long line) with this block:

```
- **Test suite** — four independently runnable suites. Counts are source-counted
  at commit `42826a3` (`grep -c "def test_"` for Python; `it(`/`test(` call sites
  for Vitest); `@pytest.mark.parametrize` expansion makes the pytest *collected*
  count higher than the source count.
  - `make test-py` — 1,106 tests in 70 files (`tests/`, excluding `tests/e2e/`)
  - `make test-fe` — 490 tests in 55 files (`frontend/__tests__/`, flat directory)
  - `make test-workers` — 345 tests in 25 files (`workers/__tests__/`). Covers the
    whole production request path (auth, mutations, Council, the
    `cloudflare-native.js` bundle) and is a CI gate: `.github/workflows/ci.yml`
    runs `npm run test:workers`.
  - `make test-e2e` — 260 Playwright tests in 25 files (all of `tests/e2e/`:
    `tests/e2e/react/`, `tests/e2e/playwright/`, and root-level `test_smoke.py` /
    `test_export.py` / `test_credentialed_auth_smoke.py`). Requires a running server.
  `make test` runs the first three. Re-verify file counts with
  `find tests -name 'test_*.py' -not -path '*/e2e/*' | wc -l`,
  `find frontend/__tests__ -name '*.test.*' | wc -l`,
  `find workers/__tests__ -name '*.test.*' | wc -l`.
```

**Verify**:

```
grep -n "71 files\|1,107 Python\|1,857 tests" CLAUDE.md
```
→ no matches (exit 1)

```
grep -c "make test-workers" CLAUDE.md
```
→ `2` (one in the Commands block from Step 1, one here)

```
find workers/__tests__ -name '*.test.*' | wc -l
```
→ `25`

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
make api          # Flask API only, local dev (http://localhost:8080)
make ui           # Vite dev server only (http://localhost:5173, HMR)
make build        # Build React frontend → immi_case_downloader/static/react/
make test         # Python unit + frontend Vitest + Worker Vitest
make test-py      # Python unit tests only (excludes E2E)
make test-fe      # Frontend Vitest tests only
make test-workers # Worker Vitest tests only (workers/__tests__)
make test-e2e     # Playwright E2E (requires a running server)
make lint         # Ruff lint Python source
make typecheck    # TypeScript type check
```

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

### Step 7: Fix the `Makefile` help text

Two edits, both inside the `help:` target, both `@echo` lines. Do not touch any
recipe.

**7a.** Replace the `make test` help line:

```make
	@echo "  make test         All tests (Python unit + frontend Vitest)"
```

with:

```make
	@echo "  make test         All tests (Python unit + frontend Vitest + Worker Vitest)"
```

**7b.** Insert a `make test-workers` row immediately after the `make test-fe`
row. Replace:

```make
	@echo "  make test-fe      Frontend Vitest tests only"
```

with:

```make
	@echo "  make test-fe      Frontend Vitest tests only"
	@echo "  make test-workers Worker Vitest tests only (workers/__tests__)"
```

If plans 001 or 002 have already run, the surrounding help lines will differ
from the excerpts above; match on the two quoted `@echo` strings only.

**Verify**:

```
make help | grep "make test "
```
→ `  make test         All tests (Python unit + frontend Vitest + Worker Vitest)`

```
make help | grep -c "make test-workers"
```
→ `1`

```
make test-workers
```
→ `Test Files  25 passed (25)`, `Tests  345 passed (345)`

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

```
git status --short
```
→ exactly `M AGENTS.md`, `M CLAUDE.md`, `M Makefile` (plus this plan file and
any pre-existing untracked entries such as `.claude/STATE.md` and `plans/`).
No other file may appear as modified.

```
make lint
```
→ `All checks passed!`

```
make test-workers
```
→ `Test Files  25 passed (25)`, `Tests  345 passed (345)`

## Test plan

This plan changes only Markdown prose and three `Makefile` `@echo` lines. There
is no code path to test and **no new tests are required or wanted** — adding a
test that asserts doc contents would create the same drift problem one layer
down.

The suites are run purely as regression guards, to prove nothing was touched by
accident:

- `make test-workers` → 345 passed in 25 files. Must be identical before and
  after; this suite has no dependency on any file in scope.
- `make lint` → `All checks passed!`.
- `cd frontend && npx vitest run` → 490 passed, 55 files (optional; slower).
- `make test-py` → 1,141 passed / 3 failed / 7 skipped. The 3 failures are the
  pre-existing Homebrew-Python `pyexpat`/`libexpat` ABI problem breaking `pypdf`
  in `tests/test_backfill_judge_overrides_from_pdf.py`. If you see a **different**
  count of failures, or failures in a different file, STOP — something outside
  this plan changed.

The real verification for this plan is the grep set in each step's **Verify**
block plus Step 8's sweep.

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
- [ ] `grep -c "make test-workers" CLAUDE.md` → `2`
- [ ] `sed -n '/<!-- gitnexus:start -->/,/<!-- gitnexus:end -->/p' CLAUDE.md | md5` → `5b42ede6f90290a95c990201c12d2dc6` (unchanged)
- [ ] `make help | grep -c "make test-workers"` → `1`
- [ ] `make help | grep -q "Python unit + frontend Vitest + Worker Vitest"` → exit 0
- [ ] `make test-workers` → `Test Files  25 passed (25)`, `Tests  345 passed (345)`
- [ ] `make lint` → `All checks passed!`
- [ ] `git status --short` shows no modified file other than `AGENTS.md`, `CLAUDE.md`, `Makefile`
- [ ] `git diff --stat` shows zero lines changed in any `Makefile` recipe (only `@echo` lines inside `help:`)
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
- **A `Makefile` recipe line appears in `git diff`.** You are only allowed to
  change `@echo` lines inside `help:`. Revert and redo.
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
- **Deliberately not done**: retargeting `make migrate`. `Makefile:107-108` runs
  `supabase db push`, but the production schema lives in
  `migrations/d1/{account,catalog,ops}/*.sql` and nothing in CI applies it.
  `supabase/migrations/` still holds 18 files for the local-dev Supabase
  backend. Deciding whether the target should be renamed
  (`migrate-supabase-legacy`) or retargeted at D1 is a separate call; this plan
  only owns help text.
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
</content>
</invoke>
