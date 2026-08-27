# Plan 031: Remove the abandoned api.ts split and 8 unreferenced modules

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index.
>
> **Drift check (run first)**:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> git diff --stat 42826a3..HEAD -- \
>   frontend/src/lib/api.ts \
>   frontend/src/lib/api-cases.ts \
>   frontend/src/lib/api-analytics.ts \
>   frontend/src/pages/TaxonomyPage.tsx \
>   frontend/src/pages/SearchTaxonomyPage.tsx \
>   frontend/src/hooks/use-llm-council.ts \
>   frontend/src/components/dashboard/TrendChart.tsx \
>   frontend/src/components/judges/ComparisonTable.tsx \
>   frontend/src/components/judges/SpecializationBadge.tsx \
>   frontend/src/components/judges/DualMetricChart.tsx \
>   frontend/src/components/shared/DatabaseCard.tsx \
>   frontend/src/components/shared/ProgressRing.tsx \
>   frontend/src/components/taxonomy/JudgeAutocomplete.tsx \
>   frontend/__tests__/dual-metric-chart.test.tsx \
>   frontend/src/App.tsx \
>   CLAUDE.md AGENTS.md .claude/skills/add-chart/SKILL.md
> ```
> Empty output means no drift — proceed. If any in-scope file changed since
> this plan was written, compare the "Current state" excerpts against the live
> code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

Somebody started splitting the 1,402-line `frontend/src/lib/api.ts` into
`api-cases.ts` and `api-analytics.ts`, copied 27 functions across, and then
stopped without ever pointing a consumer at the new files. The result is two
live definitions of `fetchCases`, `fetchCaseCount`, `fetchFilterOptions`,
`fetchVisaFamilies` and 23 more, where exactly one copy is reachable from the
app. Anyone who fixes a bug by grepping for `fetchFilterOptions` has a coin-flip
chance of editing the copy nothing imports, shipping a "fix" that changes
nothing at runtime and passes every test. Nine more modules — a duplicate page,
an orphaned hook, and seven components — are in the same state.

Deleting them removes 1,269 lines that no build output contains, shrinks the
grep surface for every future change, and eliminates a class of silent no-op
edit. Nothing is refactored, nothing is rewired: every file removed here has
zero importers today, proven by the greps quoted below.

## Current state

### The repo at a glance

- Frontend is React 19 + TypeScript + Vite 7, source in
  `/Users/d/Developer/Active Projects/IMMI-Case-/frontend/`.
- `frontend/src/lib/api.ts` (1,402 lines) is **the** HTTP client for the SPA.
  Every page imports from it.
- `frontend/src/lib/api-cases.ts` (109 lines) and
  `frontend/src/lib/api-analytics.ts` (281 lines) are the abandoned split.
- Vitest collects **only** `__tests__/**` at the frontend root — see
  `frontend/vitest.config.ts:11` below. Tests under `frontend/src/**` are not run.
- TypeScript compiles **only** `src` — `frontend/tsconfig.app.json` ends with
  `"include": ["src"]`.

### The abandoned split — `api-cases.ts`

`frontend/src/lib/api-cases.ts:1-21` — verbatim:

```ts
import { apiFetch } from "@/lib/api";
import type { ApiRequestOptions } from "@/lib/api";
import type {
  ImmigrationCase,
  CaseFilters,
  PaginatedCases,
  FilterOptions,
} from "@/types/case";

export type CaseCountMode = "exact" | "planned" | "estimated";

// ─── Cases ─────────────────────────────────────────────────────
export function fetchCases(filters: CaseFilters): Promise<PaginatedCases> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  return apiFetch(`/api/v1/cases?${params}`);
}
```

The live twin, `frontend/src/lib/api.ts:567-576` — verbatim:

```ts
// ─── Cases ─────────────────────────────────────────────────────
export function fetchCases(filters: CaseFilters): Promise<PaginatedCases> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  return apiFetch(`/api/v1/cases?${params}`);
}
```

`api-cases.ts` exports 11 functions. **Ten are byte-identical** to their
`api.ts` counterparts (`fetchCases`, `fetchCaseCount`, `fetchCase`,
`createCase`, `updateCase`, `deleteCase`, `batchCases`, `compareCases`,
`fetchRelated`, `searchCases`). Exactly one diverges structurally.

`frontend/src/lib/api-cases.ts:104-109` — verbatim:

```ts
// ─── Filters ───────────────────────────────────────────────────
export function fetchFilterOptions(): Promise<FilterOptions> {
  return apiFetch("/api/v1/filter-options", {
    timeoutMs: 8_000,
  });
}
```

`frontend/src/lib/api.ts:661-666` — verbatim:

```ts
// ─── Filters ───────────────────────────────────────────────────
export function fetchFilterOptions(): Promise<FilterOptions> {
  return apiFetch("/api/v1/filter-options", {
    timeoutMs: FILTER_OPTIONS_TIMEOUT_MS,
  });
}
```

`frontend/src/lib/api.ts:40` — verbatim:

```ts
const FILTER_OPTIONS_TIMEOUT_MS = 8_000;
```

So the two are **numerically identical today**: the dead copy hardcodes the
literal, the live one reads the named constant. That is the drift *mechanism*,
not drift that has happened yet — retuning `FILTER_OPTIONS_TIMEOUT_MS` would
silently not apply to the copy. (See "Findings reconsidered" — the audit
claimed they *had* already drifted, which is not what the code shows.)

### The abandoned split — `api-analytics.ts`

`frontend/src/lib/api-analytics.ts:1` — verbatim:

```ts
import { apiFetch } from "@/lib/api";
```

`frontend/src/lib/api-analytics.ts:272-281` — verbatim:

```ts
export function fetchVisaFamilies(
  params: AnalyticsFilterParams = {},
): Promise<VisaFamiliesData> {
  const qs = new URLSearchParams();
  appendAnalyticsFilters(qs, params);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch(`/api/v1/analytics/visa-families${suffix}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}
```

The live twin, `frontend/src/lib/api.ts:556-565` — verbatim:

```ts
export function fetchVisaFamilies(
  params: AnalyticsFilterParams = {},
): Promise<VisaFamiliesData> {
  const qs = new URLSearchParams();
  appendAnalyticsFilters(qs, params);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch(`/api/v1/analytics/visa-families${suffix}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}
```

All **16** functions exported by `api-analytics.ts` are byte-identical to their
`api.ts` counterparts (verified function-by-function at commit `42826a3`).

### Proof that nothing imports either file

```
$ cd "/Users/d/Developer/Active Projects/IMMI-Case-"
$ grep -rn -e 'api-cases' -e 'api-analytics' frontend/ --exclude-dir=node_modules
frontend/.omc/project-memory.json:239:        "api-analytics.ts",
frontend/.omc/project-memory.json:240:        "api-cases.ts",
```

Those two hits are inside `frontend/.omc/project-memory.json`, which is
**gitignored** (`.gitignore:58` matches `**/.omc/`). It is agent scratch state,
not code. Do not edit it.

There is **no** `frontend/src/lib/index.ts` barrel file, so no re-export can be
resolving these modules indirectly. `frontend/src/lib/` contains:
`__tests__ api-analytics.ts api-cases.ts api-llm-council.ts api.ts auth.ts
council-celebrations.ts court-events.ts dashboard-insights.ts display.ts
lineage-data.ts lineage-transforms.ts prefetch.ts router.ts saved-searches.ts
trends.ts utils.ts`.

### The duplicate page — `TaxonomyPage.tsx`

`frontend/src/pages/TaxonomyPage.tsx` — the **entire file**, verbatim (5 lines):

```tsx
import { GuidedSearchPage } from "@/pages/GuidedSearchPage";

export function TaxonomyPage() {
  return <GuidedSearchPage />;
}
```

`frontend/src/pages/SearchTaxonomyPage.tsx` — the **entire file**, verbatim
(5 lines), i.e. the same component under a different name:

```tsx
import { GuidedSearchPage } from "@/pages/GuidedSearchPage";

export function SearchTaxonomyPage() {
  return <GuidedSearchPage />;
}
```

Only `SearchTaxonomyPage` is routed. `frontend/src/App.tsx:134-138` — verbatim:

```tsx
const SearchTaxonomyPage = lazy(() =>
  import("@/pages/SearchTaxonomyPage").then((m) => ({
    default: m.SearchTaxonomyPage,
  })),
);
```

and `frontend/src/App.tsx:280-295` — verbatim, note **both** routes render
`SearchTaxonomyPage`:

```tsx
              <Route
                path="taxonomy"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <SearchTaxonomyPage />
                  </Suspense>
                }
              />
              <Route
                path="search-taxonomy"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <SearchTaxonomyPage />
                  </Suspense>
                }
              />
```

`App.tsx` is therefore already correct and **must not be modified** by this plan.

### The orphaned hook — `use-llm-council.ts`

`frontend/src/hooks/use-llm-council.ts` — the **entire file**, verbatim
(19 lines):

```ts
import { useMutation } from "@tanstack/react-query";
import { checkLlmCouncilHealth, runLlmCouncil } from "@/lib/api";
import type {
  LlmCouncilHealthResponse,
  LlmCouncilRequest,
  LlmCouncilResponse,
} from "@/lib/api";

export function useLlmCouncil() {
  return useMutation<LlmCouncilResponse, Error, LlmCouncilRequest>({
    mutationFn: runLlmCouncil,
  });
}

export function useLlmCouncilHealthCheck() {
  return useMutation<LlmCouncilHealthResponse, Error, { live: boolean }>({
    mutationFn: ({ live }) => checkLlmCouncilHealth(live),
  });
}
```

Both council pages import the **sessions** hook instead:
`frontend/src/pages/LlmCouncilPage.tsx:54` and
`frontend/src/pages/LlmCouncilSessionsPage.tsx:24` both end an import block with
`} from "@/hooks/use-llm-council-sessions";`. A repo-wide grep for
`hooks/use-llm-council"` and `hooks/use-llm-council'` (i.e. the exact specifier,
not the `-sessions` one) returns zero hits.

### The seven unreferenced components

Each of these is exported but imported by nothing in `src/`, `__tests__/`,
`e2e/`, `scripts/` or `index.html`:

| File | Lines | Exported symbol |
|---|---|---|
| `frontend/src/components/dashboard/TrendChart.tsx` | 132 | `TrendChart` (`memo(TrendChartInner)`, line 132) |
| `frontend/src/components/judges/ComparisonTable.tsx` | 129 | `ComparisonTable` (line 23) |
| `frontend/src/components/judges/SpecializationBadge.tsx` | 44 | `SpecializationBadge` (line 14) |
| `frontend/src/components/judges/DualMetricChart.tsx` | 155 | `DualMetricChart` (line 36) |
| `frontend/src/components/shared/DatabaseCard.tsx` | 79 | `DatabaseCard` (line 22) |
| `frontend/src/components/shared/ProgressRing.tsx` | 56 | `ProgressRing` (line 12) |
| `frontend/src/components/taxonomy/JudgeAutocomplete.tsx` | 189 | `JudgeAutocomplete` (line 9) |

**`DualMetricChart` is the one exception**: it has exactly one referrer, its own
test. `frontend/__tests__/dual-metric-chart.test.tsx:3` — verbatim:

```ts
import { DualMetricChart } from "@/components/judges/DualMetricChart";
```

That test file is 71 lines and contains 7 `it(...)` cases. It is the only thing
keeping `DualMetricChart` alive, so both go together.

Beware two near-miss names that are **live and must not be touched**:
`frontend/src/components/analytics/ConceptTrendChart.tsx` and
`frontend/src/components/analytics/OutcomeTrendChart.tsx`. A naive
`grep TrendChart` hits all three.

Corroborating evidence that `JudgeAutocomplete.tsx` was never shipped: its i18n
keys — `taxonomy.judge_autocomplete_desc` (line 74) and `taxonomy.judge_min_chars`
(line 134) — **are** defined in `frontend/src/i18n/locales/en.json` and
`zh-TW.json`, yet appear **nowhere** in the committed production bundle under
`immi_case_downloader/static/react/`. The strings were translated; the component
was never bundled, because nothing imports it.

### Docs that name files this plan deletes

`CLAUDE.md:116` and `AGENTS.md:116` are identical — verbatim:

```
    pages/            → 27 pages including:
```

`frontend/src/pages/` currently holds exactly 27 `.tsx` files, so that count is
accurate right now and becomes wrong at 26 after the deletion.

`CLAUDE.md:125` and `AGENTS.md:125` are identical — verbatim (leading spaces are
significant; the line is part of an indented code block):

```
                        TaxonomyPage, SearchTaxonomyPage,
```

`.claude/skills/add-chart/SKILL.md:72-77` — verbatim (the `TrendChart.tsx`
bullet is line **75**):

```
## Reference Files

- `CourtChart.tsx` — bar/pie with toggle, click navigation
- `TrendChart.tsx` — stacked area with custom tooltip filtering zeros
- `NatureChart.tsx` — horizontal bar with truncated labels
- `OutcomeByCourtChart.tsx` — grouped bar with percentage labels
```

The other three exist (`frontend/src/components/dashboard/CourtChart.tsx`,
`.../NatureChart.tsx`, `frontend/src/components/analytics/OutcomeByCourtChart.tsx`);
only the `TrendChart.tsx` bullet is broken by this plan.

`design/capture-screenshots.mjs:39` contains `["TaxonomyPage", "/taxonomy"]`.
That entry keeps working — the `/taxonomy` **route** survives (it renders
`SearchTaxonomyPage`, see `App.tsx:280-287` above). Only the label is a stale
component name. **Out of scope**; see "Out of scope".

### Config the verification depends on

`frontend/vitest.config.ts:11` — verbatim:

```ts
    include: ["__tests__/**/*.{test,spec}.{ts,tsx}"],
```

`frontend/tsconfig.json` — the **entire file**, verbatim. This is why plain
`npx tsc --noEmit` exits 0 while loading zero files, and why this plan uses
`npx tsc -b --noEmit --force` instead:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`frontend/tsconfig.app.json` ends with `"include": ["src"]` and sets
`"noUnusedLocals": true`, `"noUnusedParameters": true`, `"strict": true`.

`frontend/eslint.config.js` sets `'@typescript-eslint/no-unused-vars': ['error', …]`
and `'no-console': ['warn', …]`. It does **not** flag unused *exports*, which is
precisely why 12 dead files sat here undetected.

### Repo conventions this plan must honour

- **Commit format**: `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines, no
  `Co-Authored-By`. Real examples from `git log`:
  `fix: install root node_modules in make install`,
  `ci: stop ignoring the separation preflight suite`.
- **Branch naming** observed on the remote is `<type>/<slug>`, e.g.
  `chore/immi-migration-phase1-provisioning`,
  `chore/update-tokens-timestamp-and-plugin`.
- **Do not push, do not open a PR, do not merge.** The operator commits.
- **No fake completion**: do not resolve any step by adding `// eslint-disable`,
  `@ts-ignore`, `test.skip`, `it.skip`, or a TODO placeholder.

## Commands you will need

Run everything from `/Users/d/Developer/Active Projects/IMMI-Case-` unless the
command says `cd frontend`.

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend typecheck | `cd frontend && npx tsc -b --noEmit --force` | exit 0, no output (~60s) |
| Frontend unit tests | `cd frontend && npx vitest run` | **before**: `Test Files 55 passed (55)` / `Tests 490 passed (490)`; **after**: `54 passed (54)` / `483 passed (483)` (~50s) |
| Frontend lint | `cd frontend && npx eslint .` | exit 0, `✖ 25 problems (0 errors, 25 warnings)` — identical before and after |
| Worker unit tests | `cd workers && npx vitest run` | `345 passed`, 25 files — unchanged by this plan |
| Python unit tests | `make test-py` | `3 failed, 1141 passed, 7 skipped` — unchanged by this plan (~6 min) |
| Worktree state | `git status --short` | see Done criteria |

Notes on the gates:

- **Do not use `make typecheck`.** Its recipe is
  `cd "$(REPO_ROOT)/frontend" && npx tsc --noEmit`, which resolves
  `frontend/tsconfig.json` — a project-references stub with `"files": []`. It
  exits 0 while checking **zero** files, so it can never catch a regression from
  this plan. Use `npx tsc -b --noEmit --force`.
- **The `--force` flag matters.** `tsc -b` is incremental against
  `frontend/node_modules/.tmp/tsconfig.app.tsbuildinfo`; `--force` guarantees a
  full re-check after files disappear.
- **The 3 `make test-py` failures are pre-existing and environmental** — all in
  `tests/test_backfill_judge_overrides_from_pdf.py`, caused by a Homebrew Python
  3.14.7 `pyexpat`/`libexpat` ABI mismatch that breaks the `pypdf` import. They
  are not this plan's problem. Running `make test-py` is optional here (this
  plan touches no Python), and is listed only so you recognise the baseline.
- **`npx eslint .` currently emits 25 warnings and 0 errors, and exits 0.** None
  of the 12 files this plan deletes contributes any of them (verified
  file-by-file with `npx eslint --format json` at commit `42826a3`), so the
  number must be **unchanged** afterwards. A different number means you deleted
  something else.

## Scope

**In scope** — delete these 12 files, in full:

1. `frontend/src/lib/api-cases.ts` (109 lines)
2. `frontend/src/lib/api-analytics.ts` (281 lines)
3. `frontend/src/pages/TaxonomyPage.tsx` (5 lines)
4. `frontend/src/hooks/use-llm-council.ts` (19 lines)
5. `frontend/src/components/dashboard/TrendChart.tsx` (132 lines)
6. `frontend/src/components/judges/ComparisonTable.tsx` (129 lines)
7. `frontend/src/components/judges/SpecializationBadge.tsx` (44 lines)
8. `frontend/src/components/judges/DualMetricChart.tsx` (155 lines)
9. `frontend/src/components/shared/DatabaseCard.tsx` (79 lines)
10. `frontend/src/components/shared/ProgressRing.tsx` (56 lines)
11. `frontend/src/components/taxonomy/JudgeAutocomplete.tsx` (189 lines)
12. `frontend/__tests__/dual-metric-chart.test.tsx` (71 lines)

Total: **1,269 lines**, all currently tracked by git.

**In scope** — edit these 3 files, one or two lines each, because they name a
file being deleted:

13. `CLAUDE.md` — line 116 (`27 pages` → `26 pages`), line 125 (drop `TaxonomyPage, `)
14. `AGENTS.md` — the same two lines, same line numbers, identical content
15. `.claude/skills/add-chart/SKILL.md` — line 75 (the `TrendChart.tsx` bullet)

> **Note on file territory.** This plan was scoped as owning `frontend/src/lib/**`,
> but the work it describes necessarily reaches into `frontend/src/components/`,
> `frontend/src/pages/`, `frontend/src/hooks/`, `frontend/__tests__/` and three
> docs. Every file outside `frontend/src/lib/**` is either **deleted because it
> has zero importers** (so no other plan can be editing it meaningfully) or a
> **single doc line that names a deleted file**. If a merge conflict appears in
> `CLAUDE.md` or `AGENTS.md`, take the other side's content and re-apply only
> the two line edits described in Step 5.

**Out of scope** (do NOT touch, even though they look related):

- **`frontend/src/lib/api.ts`.** Not one byte. In particular, do **not** delete
  `runLlmCouncil` (line 1288) or `checkLlmCouncilHealth` (line 1298) even though
  Step 3 makes them unreferenced. They are the only typed client for two **live**
  Worker routes — `workers/llm-council/cloudflare_handlers.js:409` handles
  `GET /api/v1/llm-council/health` and `:412` handles
  `POST /api/v1/llm-council/run`. Unlike `api-cases.ts`, they are not a duplicate
  of anything; removing them would delete a working client, not dead weight.
  Same for the ~155-line `LlmCouncilRequest` / `LlmCouncilResponse` /
  `LlmCouncilHealthResponse` type block at `api.ts:1150-1305`.
- **`frontend/src/App.tsx`.** Already routes `SearchTaxonomyPage` for both
  `/taxonomy` and `/search-taxonomy`; it never mentions `TaxonomyPage`. No edit
  is needed and any edit here is a red flag.
- **`frontend/src/pages/SearchTaxonomyPage.tsx`** — the surviving twin. Keep it.
- **`frontend/src/components/analytics/ConceptTrendChart.tsx`** and
  **`frontend/src/components/analytics/OutcomeTrendChart.tsx`** — both live and
  imported (`ConceptIntelligenceSection.tsx:7`, `SuccessRateDeepModal.tsx:11`,
  `OutcomeAnalysisSection.tsx:5`). They only *look* like `TrendChart`.
- **`frontend/src/lib/api-llm-council.ts`** — 366 lines, alive: imported by
  `frontend/__tests__/api-llm-council.test.ts` and by the council UI. Keep it.
- **`frontend/src/contexts/AuthContext.tsx`** — see "Findings reconsidered".
- **`frontend/.omc/project-memory.json`** — gitignored agent scratch state
  (`.gitignore:58` matches `**/.omc/`). It mentions `api-cases.ts`; leave it.
- **`design/capture-screenshots.mjs`** — its `["TaxonomyPage", "/taxonomy"]`
  entry still resolves, because the `/taxonomy` route survives.
- **Running `npm run build` / `make build`.** The Vite build writes to
  `../immi_case_downloader/static/react` (`frontend/vite.config.ts:34`) and
  **93 of those artifacts are tracked in git**. A build would rewrite hashed
  asset filenames and dirty the tree far outside this plan's scope. None of the
  deleted modules is present in the committed bundle (verified: their i18n keys
  do not appear in `immi_case_downloader/static/react/`), so no rebuild is owed.
- **`frontend/src/i18n/locales/en.json` and `zh-TW.json`.** Deleting
  `JudgeAutocomplete.tsx` orphans the whole `taxonomy` namespace (5 keys) in
  both files — it is the only `taxonomy.*` consumer in `src/`. Leave them;
  orphan keys are inert and the sweep belongs to a dedicated pass. (`TrendChart.tsx`
  uses only `t("filters.date")` at line 93, which
  `src/components/cases/CasesFilters.tsx:34` still uses, so nothing is orphaned
  by that deletion.)
- **Any Python, Worker, `Makefile`, or CI file.**

## Git workflow

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
git checkout -b chore/remove-dead-frontend-modules
```

Suggested commits, matching the repo's convention:

- `refactor: delete the abandoned api.ts split`
- `refactor: delete unreferenced frontend pages, hooks and components`
- `docs: drop references to deleted frontend modules`

Do **not** push, do **not** open a PR, do **not** merge.

> When this plan was written, `git status --short` showed a pre-existing
> ` M .claude/STATE.md`. That is agent state, not yours — leave it alone and do
> not include it in any commit.

## Steps

### Step 1: Record the baseline

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx tsc -b --noEmit --force; echo "tsc exit=$?"
npx vitest run 2>&1 | tail -4
npx eslint . 2>&1 | tail -2; 
npx eslint . > /dev/null 2>&1; echo "eslint exit=$?"
```

**Verify**:
- `tsc exit=0`
- vitest tail shows `Test Files  55 passed (55)` and `Tests  490 passed (490)`
- eslint tail shows `✖ 25 problems (0 errors, 25 warnings)` and `eslint exit=0`

If any of the three baselines differs, STOP — the tree has drifted from commit
`42826a3` and this plan's expected numbers are invalid.

### Step 2: Prove the 12 files have no importers, then delete the api.ts split

First, re-run the reachability proof. All four commands must produce the stated
result **before** you delete anything:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"

# (a) nothing imports the split (the only hits must be the gitignored .omc file)
grep -rn -e 'api-cases' -e 'api-analytics' . --exclude-dir=node_modules

# (b) nothing imports the other nine modules by path
grep -rn \
  -e 'components/dashboard/TrendChart' \
  -e 'judges/ComparisonTable' \
  -e 'judges/SpecializationBadge' \
  -e 'judges/DualMetricChart' \
  -e 'shared/DatabaseCard' \
  -e 'shared/ProgressRing' \
  -e 'taxonomy/JudgeAutocomplete' \
  -e 'pages/TaxonomyPage' \
  src __tests__ e2e scripts index.html

# (c) nothing imports the orphaned hook (note: `-sessions` is a DIFFERENT module)
grep -rn -e 'hooks/use-llm-council"' -e "hooks/use-llm-council'" src __tests__ e2e

# (d) there is no barrel that could re-export the split
ls src/lib/index.ts
```

**Verify**:
- (a) prints exactly two lines, both `./.omc/project-memory.json:…`
- (b) prints exactly one line:
  `__tests__/dual-metric-chart.test.tsx:3:import { DualMetricChart } from "@/components/judges/DualMetricChart";`
- (c) prints nothing (exit 1 is the expected "no match")
- (d) prints `ls: src/lib/index.ts: No such file or directory`

If any command returns more than that, STOP.

Now delete the split:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
git rm frontend/src/lib/api-cases.ts frontend/src/lib/api-analytics.ts
```

**Verify**:
```bash
cd frontend && npx tsc -b --noEmit --force; echo "tsc exit=$?"
```
→ `tsc exit=0`.

### Step 3: Delete the duplicate page and the orphaned hook

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
git rm frontend/src/pages/TaxonomyPage.tsx frontend/src/hooks/use-llm-council.ts
```

Do **not** touch `frontend/src/App.tsx` — it already references only
`SearchTaxonomyPage`. Do **not** remove `runLlmCouncil` /
`checkLlmCouncilHealth` from `frontend/src/lib/api.ts`; they now have no
in-repo caller, and that is intentional (see "Out of scope").

**Verify**:
```bash
cd frontend
npx tsc -b --noEmit --force; echo "tsc exit=$?"
ls src/pages/*.tsx | wc -l
grep -c "SearchTaxonomyPage" src/App.tsx
git -C .. diff --stat -- frontend/src/App.tsx frontend/src/lib/api.ts
```
→ `tsc exit=0`; `ls | wc -l` prints `26`; the `grep -c` prints `5`; the
`git diff --stat` prints **nothing** (App.tsx and api.ts untouched).

### Step 4: Delete the seven components and the one test that holds one of them up

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
git rm \
  frontend/src/components/dashboard/TrendChart.tsx \
  frontend/src/components/judges/ComparisonTable.tsx \
  frontend/src/components/judges/SpecializationBadge.tsx \
  frontend/src/components/judges/DualMetricChart.tsx \
  frontend/src/components/shared/DatabaseCard.tsx \
  frontend/src/components/shared/ProgressRing.tsx \
  frontend/src/components/taxonomy/JudgeAutocomplete.tsx \
  frontend/__tests__/dual-metric-chart.test.tsx
```

`frontend/__tests__/dual-metric-chart.test.tsx` goes with
`DualMetricChart.tsx` because it is that component's only referrer — a test for
a component nothing renders proves nothing about the product. Deleting it is a
deletion of dead coverage, not a weakening of live coverage: its 7 cases assert
only on `DualMetricChart`, which ceases to exist in the same commit.

**Verify**:
```bash
cd frontend
npx tsc -b --noEmit --force; echo "tsc exit=$?"
npx vitest run 2>&1 | tail -4
ls src/components/dashboard/ | wc -l
ls src/components/analytics/ConceptTrendChart.tsx src/components/analytics/OutcomeTrendChart.tsx
```
→ `tsc exit=0`; vitest reports `Test Files  54 passed (54)` and
`Tests  483 passed (483)`; `ls src/components/dashboard/ | wc -l` prints `5`;
both analytics chart files still exist.

### Step 5: Update the three docs that name a deleted file

**Edit A** — `CLAUDE.md:116`. Change exactly one word:

```
    pages/            → 26 pages including:
```

**Edit B** — `CLAUDE.md:125`. Drop `TaxonomyPage, ` from the start of the list,
keeping the leading indentation identical to the surrounding lines:

```
                        SearchTaxonomyPage,
```

**Edit C and D** — apply the identical two edits to `AGENTS.md`, at the same
line numbers 116 and 125. The two files' content at those lines is byte-identical.

**Edit E** — `.claude/skills/add-chart/SKILL.md:75`. Replace the broken bullet
with a live exemplar. Before:

```
- `TrendChart.tsx` — stacked area with custom tooltip filtering zeros
```

After:

```
- `OutcomeTrendChart.tsx` (analytics/) — multi-series area chart with token-driven gradient fills
```

(`frontend/src/components/analytics/OutcomeTrendChart.tsx` is an `AreaChart`
whose `<linearGradient>` stops use `var(--color-chart-3)` / `var(--color-chart-4)`
— verified at lines 49-61. The other three bullets in that list still point at
existing files and stay as-is.)

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
grep -rn "TaxonomyPage" CLAUDE.md AGENTS.md
grep -n "26 pages\|27 pages" CLAUDE.md AGENTS.md
grep -rn "TrendChart" .claude/skills/add-chart/SKILL.md
diff <(sed -n '110,130p' CLAUDE.md) <(sed -n '110,130p' AGENTS.md) && echo IDENTICAL
```
→ the first grep prints exactly two lines, both containing
`SearchTaxonomyPage,` and neither containing a bare `TaxonomyPage,`; the second
prints two `26 pages` lines and no `27 pages`; the third prints one line
containing `OutcomeTrendChart.tsx`; the `diff` prints `IDENTICAL`.

### Step 6: Full-suite regression pass

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx tsc -b --noEmit --force; echo "tsc exit=$?"
npx vitest run 2>&1 | tail -4
npx eslint . 2>&1 | tail -2
npx eslint . > /dev/null 2>&1; echo "eslint exit=$?"
cd ../workers && npx vitest run 2>&1 | tail -4
```

**Verify**:
- `tsc exit=0`
- frontend vitest: `Test Files  54 passed (54)`, `Tests  483 passed (483)`
- eslint: `✖ 25 problems (0 errors, 25 warnings)`, `eslint exit=0` — **exactly
  the Step 1 number**; a different count means an unintended file was removed
- workers vitest: `Test Files  25 passed (25)`, `Tests  345 passed (345)`

### Step 7: Confirm the worktree contains only the intended changes

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
git status --porcelain --untracked-files=all
git diff --cached --stat
```

**Verify**: `git diff --cached --stat` lists exactly the 12 deletions and shows
`1269 deletions(-)` for them; `git status --porcelain` shows the 3 doc files as
` M` (or `M `), no other `M`, and no `??` other than `plans/` and any
pre-existing agent state such as `.claude/STATE.md`.

## Test plan

This plan writes **no new tests**. It is a pure deletion, and the entire test
strategy is "prove the deletions are invisible":

| Gate | Before | After | What a deviation would mean |
|---|---|---|---|
| `npx tsc -b --noEmit --force` | exit 0 | exit 0 | a deleted file was actually imported |
| `npx vitest run` (frontend) | 55 files / 490 tests | 54 files / 483 tests | anything other than the 7 `dual-metric-chart` cases changed |
| `npx eslint .` | 25 problems, 0 errors | 25 problems, 0 errors | you removed a file that was contributing lint findings — i.e. not one of these 12 |
| `npx vitest run` (workers) | 25 files / 345 tests | 25 files / 345 tests | you strayed outside `frontend/` |
| `make test-py` (optional) | 1141 passed / 3 env-failed / 7 skipped | identical | you strayed outside `frontend/` |

The **only** intended test-count change is the removal of
`frontend/__tests__/dual-metric-chart.test.tsx`: −1 file, −7 tests
(490 → 483). Any other delta is a STOP condition.

Deliberately **not** verified by a build: `npm run build` writes into the
git-tracked `immi_case_downloader/static/react/` tree. Instead, the equivalent
assurance was obtained statically — the deleted modules' distinctive strings
(e.g. the i18n keys `taxonomy.judge_autocomplete_desc` and
`taxonomy.judge_min_chars` from `JudgeAutocomplete.tsx`) do **not** appear
anywhere under `immi_case_downloader/static/react/`, confirming Rollup never
reached them.

## Done criteria

Machine-checkable. ALL must hold. Run from
`/Users/d/Developer/Active Projects/IMMI-Case-`.

- [ ] `git ls-files frontend/src/lib/api-cases.ts frontend/src/lib/api-analytics.ts frontend/src/pages/TaxonomyPage.tsx frontend/src/hooks/use-llm-council.ts frontend/src/components/dashboard/TrendChart.tsx frontend/src/components/judges/ComparisonTable.tsx frontend/src/components/judges/SpecializationBadge.tsx frontend/src/components/judges/DualMetricChart.tsx frontend/src/components/shared/DatabaseCard.tsx frontend/src/components/shared/ProgressRing.tsx frontend/src/components/taxonomy/JudgeAutocomplete.tsx frontend/__tests__/dual-metric-chart.test.tsx | wc -l` prints `0`
- [ ] `cd frontend && npx tsc -b --noEmit --force` exits 0
- [ ] `cd frontend && npx vitest run` reports `Test Files  54 passed (54)` and `Tests  483 passed (483)`
- [ ] `cd frontend && npx eslint .` exits 0 and reports `✖ 25 problems (0 errors, 25 warnings)`
- [ ] `cd workers && npx vitest run` reports `Test Files  25 passed (25)` and `Tests  345 passed (345)`
- [ ] `ls frontend/src/pages/*.tsx | wc -l` prints `26`
- [ ] `ls frontend/src/components/dashboard/ | wc -l` prints `5`
- [ ] `grep -rn -e 'api-cases' -e 'api-analytics' frontend/src frontend/__tests__ frontend/e2e frontend/scripts` returns no matches
- [ ] `grep -rn 'DualMetricChart\|ComparisonTable\|SpecializationBadge\|DatabaseCard\|ProgressRing\|JudgeAutocomplete' frontend/src frontend/__tests__` returns no matches
- [ ] `grep -rn 'dashboard/TrendChart' frontend/src frontend/__tests__` returns no matches, **and** `ls frontend/src/components/analytics/ConceptTrendChart.tsx frontend/src/components/analytics/OutcomeTrendChart.tsx` succeeds
- [ ] `git diff --stat 42826a3..HEAD -- frontend/src/App.tsx frontend/src/lib/api.ts frontend/src/pages/SearchTaxonomyPage.tsx frontend/src/lib/api-llm-council.ts` prints nothing
- [ ] `grep -c '27 pages' CLAUDE.md AGENTS.md` prints `0` for both; `grep -c '26 pages' CLAUDE.md AGENTS.md` prints `1` for both
- [ ] `grep -rn 'TaxonomyPage' CLAUDE.md AGENTS.md` returns exactly 2 lines, both reading `                        SearchTaxonomyPage,`
- [ ] `grep -c 'TrendChart' .claude/skills/add-chart/SKILL.md` prints `1`, and that line contains `OutcomeTrendChart.tsx`
- [ ] `git status --porcelain` shows no modification outside the 15 in-scope files, `plans/`, and pre-existing agent state (`.claude/STATE.md`)
- [ ] `git status --porcelain --untracked-files=all immi_case_downloader/static/react` returns no matches (no accidental rebuild)
- [ ] `plans/README.md` status row updated (only if that file exists)

## STOP conditions

Stop and report back — do not improvise — if any of these occur:

- **A "Current state" excerpt does not match the live file** at the quoted line
  numbers. In particular: `frontend/src/lib/api.ts:40` must read
  `const FILTER_OPTIONS_TIMEOUT_MS = 8_000;`, and
  `frontend/src/pages/TaxonomyPage.tsx` must be the 5-line re-export of
  `GuidedSearchPage` shown above. If `TaxonomyPage.tsx` has grown real content
  since commit `42826a3`, it is no longer a duplicate and must not be deleted.
- **Step 2's grep (b) returns any line other than the single
  `__tests__/dual-metric-chart.test.tsx:3` hit.** Some file started importing
  one of the seven components; that component is no longer dead.
- **Step 2's grep (a) returns a hit outside `./.omc/project-memory.json`.**
  Something now imports the split; deleting it would break the build.
- **`npx tsc -b --noEmit --force` reports `TS2307: Cannot find module`** after
  any deletion. Restore the file with `git checkout -- <path>` (or
  `git restore --staged --worktree <path>`) and report which module referenced
  it — do **not** "fix" it by adding an import to `api.ts`.
- **The frontend vitest count is anything other than 54 files / 483 tests.**
  Specifically: 55/490 means a deletion did not take effect; fewer than 54 files
  means you deleted a test that was not `dual-metric-chart.test.tsx`.
- **`npx eslint .` reports a number other than `25 problems (0 errors, 25 warnings)`.**
  None of the 12 doomed files produces a lint finding, so this number is a
  fingerprint of "you deleted exactly the right set".
- **`git diff` shows a change inside `frontend/src/lib/api.ts` or
  `frontend/src/App.tsx`.** Both are explicitly out of scope; revert with
  `git checkout -- <path>`.
- **`immi_case_downloader/static/react/` becomes dirty.** That means a build
  ran. Revert those files (`git checkout -- immi_case_downloader/static/react`)
  and do not run `npm run build` or `make build` again.
- **You are tempted to delete `runLlmCouncil` / `checkLlmCouncilHealth` from
  `api.ts`** because Step 3 orphaned them. Don't — they serve live Worker routes
  (`workers/llm-council/cloudflare_handlers.js:409` and `:412`). Report it as a
  follow-up instead.
- **A merge conflict appears in `CLAUDE.md` or `AGENTS.md`.** Take the other
  side's content wholesale, then re-apply only the two line edits from Step 5.
- **A step's verification fails twice after a reasonable fix attempt.**

## Maintenance notes

For the human or agent who owns this next:

- **What a reviewer should scrutinise**: that the diff is deletions only. Any
  `+` line in `frontend/src/` is out of place — the sole additions in this plan
  are three doc lines. Also confirm
  `frontend/src/components/analytics/ConceptTrendChart.tsx` and
  `OutcomeTrendChart.tsx` survived; a careless `grep TrendChart` sweep is the
  most likely way this plan goes wrong.
- **The api.ts split is now a decision, not a half-finished job.** By deleting
  `api-cases.ts` / `api-analytics.ts` this plan records that
  `frontend/src/lib/api.ts` **stays monolithic** at ~1,400 lines. If a future
  change re-opens that decision, do the split properly in one commit: create the
  new module, move (not copy) the functions, repoint every consumer, and
  re-export from `api.ts` only if a compatibility shim is genuinely needed.
  Never leave a second unreferenced copy behind again.
- **Deferred: `runLlmCouncil` and `checkLlmCouncilHealth` are now unreferenced
  exports** in `frontend/src/lib/api.ts` (lines 1288 and 1298), along with the
  ~155-line type block at `api.ts:1150-1305` that only they use. They are kept
  because they are the only typed client for two live Worker routes
  (`/api/v1/llm-council/health`, `/api/v1/llm-council/run`). Revisit if those
  routes are retired; the council UI itself now goes through
  `frontend/src/lib/api-llm-council.ts` + `hooks/use-llm-council-sessions.ts`.
- **Deferred, and found while writing this plan:
  `frontend/src/lib/__tests__/saved-searches.test.ts` (332 lines) never runs.**
  `frontend/vitest.config.ts:11` sets `include: ["__tests__/**/*.{test,spec}.{ts,tsx}"]`,
  which is relative to the frontend root and therefore does not match
  `src/lib/__tests__/`. Confirmed empirically: `npx vitest list` returns zero
  entries matching `saved-searches`. It is 332 lines of coverage that has been
  silently absent. Fixing it (widen the `include` glob, or move the file) is a
  different file territory and a different risk profile — it will surface real
  failures, not just delete lines — so it is deliberately not bundled here.
- **Deferred: the now-orphaned `taxonomy` i18n namespace.**
  `frontend/src/components/taxonomy/JudgeAutocomplete.tsx` was the **only** file
  in `frontend/src/` referencing any `taxonomy.*` key, and all five of the keys
  it used (`judge_autocomplete`, `judge_autocomplete_desc`,
  `judge_search_placeholder`, `judge_min_chars`, `no_judge_results`) are defined
  and translated in both `frontend/src/i18n/locales/en.json` and `zh-TW.json`.
  After this plan they are dead data. They are deliberately left in place:
  orphan keys are inert at runtime, no test asserts key-usage parity
  (`__tests__/i18n-hardcoded.test.ts` only checks `analytics.total` in both
  locales), and the locale files are shared territory that parallel work is
  likely to touch. Sweep them in a dedicated locale-hygiene pass that covers
  every namespace at once, not piecemeal.
- **What future changes interact with this**: any tool that reports "unused
  exports" (`knip`, `ts-prune`) would have caught all twelve of these years ago.
  `eslint.config.js` only flags unused *locals*, which is exactly why they
  accumulated. Adding such a check to CI is the durable fix; this plan is the
  one-time cleanup.
- **`design/capture-screenshots.mjs:39`** still labels the `/taxonomy` route
  `"TaxonomyPage"`. The route works (it renders `SearchTaxonomyPage`), so the
  script is functional; the label is just a stale name. Rename it if that file
  is ever touched for another reason.

## Findings reconsidered

- **DEBT-03's claim that the duplicate functions "have already drifted"** —
  **corrected**. A function-by-function comparison at commit `42826a3` shows all
  16 exports of `api-analytics.ts` and 10 of the 11 exports of `api-cases.ts` are
  **byte-identical** to their `api.ts` counterparts. The single divergence is
  `fetchFilterOptions`, where `api-cases.ts:107` hardcodes `timeoutMs: 8_000`
  while `api.ts:664` reads `timeoutMs: FILTER_OPTIONS_TIMEOUT_MS` — and
  `api.ts:40` defines that constant as `8_000`, so the two are behaviourally
  identical today. The deletion still stands: a literal that shadows a named
  constant is the *mechanism* by which the copies would drift the moment anyone
  retunes the timeout. The plan says "drift mechanism", not "drift".
- **DEBT-03's line count of 1,198** — **corrected to 1,269**. The 1,198 figure
  omitted `frontend/__tests__/dual-metric-chart.test.tsx` (71 lines), which this
  plan deletes alongside the component it is the sole referrer of.
  1,269 − 71 = 1,198, so the two numbers are reconcilable; this plan uses the
  inclusive one because it is what `git diff --stat` will show.
- **TEST-21's claim that `api-cases.ts` "has none of api.ts's timeout/CSRF/
  mutation-freeze handling"** — **rejected as stated**. `api-cases.ts:1` is
  `import { apiFetch } from "@/lib/api";`, and every one of its 11 functions
  calls that shared `apiFetch` (`api.ts:95`), which injects the CSRF token, the
  `Authorization` header, and `timeoutMs`. `isCaseMutationsDisabledError`
  (`api.ts:91`) matches on `ApiError.code`, so it works regardless of which
  module issued the request. `api-cases.ts` is therefore not a guard-bypassing
  client — it is a redundant one. The deletion is kept, on the duplication
  ground rather than the security ground; TEST-21's underlying instinct
  ("nothing imports it, delete it") was right and is fully verified above.
- **DEBT-15 ("three coexisting frontend data-fetching conventions")** —
  **dropped from this plan**, not disputed. Two of the three "conventions" the
  finding counted were `api-cases.ts` and `api-analytics.ts`, which this plan
  deletes; that removes the inconsistency it was pointing at. What genuinely
  survives is the verifier's corrected item: `frontend/src/contexts/AuthContext.tsx`
  issues raw `fetch` calls at lines 47, 87, 121, 149 and 168 (to
  `/api/v1/auth/{refresh,me,telegram,logout,switch-tenant}`) with no
  `AbortSignal` and no unified error envelope — verified. That is an auth-layer
  change in `src/contexts/`, security-sensitive, and belongs with the auth
  hardening work rather than a P3 dead-code sweep; bundling it here would turn a
  zero-behaviour-change deletion into a behaviour-changing refactor. The
  finding's other two accusations do not hold and should not be re-raised:
  `api.ts:1317-1335` (`exportCollection`) already fetches a CSRF token at line
  1320 **and** sets `signal: AbortSignal.timeout(30_000)` at line 1328, and
  `frontend/src/lib/api-llm-council.ts:151-156` builds its own `AbortController`
  with an explicit `timeoutMs` — both verified verbatim.
