# Plan 020: Debounce search, memoise the dashboard, and stop double-rendering the case list

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` **only if that file exists** — at planning time it does
> not, and creating it is out of scope.
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 42826a3..HEAD -- \
>   frontend/src/components/shared/GlobalSearch.tsx \
>   frontend/src/components/cases/CaseTextViewer.tsx \
>   frontend/src/components/cases/CasesTable.tsx \
>   frontend/src/pages/DashboardPage.tsx \
>   frontend/src/components/analytics/SuccessRateCalculator.tsx \
>   frontend/src/components/analytics/OutcomeAnalysisSection.tsx \
>   frontend/src/hooks/use-cases.ts \
>   frontend/src/hooks/use-analytics.ts
> ```
>
> Expected: empty output. If any in-scope file changed since this plan was
> written, compare the "Current state" excerpts against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `42826a3`, 2026-08-27

> On "Depends on: none": plan 001 restores the frontend compile gate
> (`make typecheck` currently runs a form of `tsc` that loads zero files). This
> plan does **not** wait for it, because every command below invokes the
> working form (`npx tsc -b --noEmit`) directly. If plan 001 has already
> landed when you run this, `make typecheck` will also work — either is fine.

## Why this matters

Five of the app's most-used surfaces do avoidable work on every keystroke or
every render. The Cmd+K global search fires one full-text query per character
typed against a 149,016-row corpus with no debounce; the case full-text reader
rebuilds the entire judgment's React tree on each keystroke of its in-text
search; the dashboard mints fresh object identities for five chart datasets on
every render, so all five `memo()`-wrapped Recharts components recompute scales
and replay entry animations when you merely toggle chart-vs-table view; the
Cases list mounts ~100 `CaseCard` subtrees on desktop purely to be
`display: none`; and the Analytics page issues two separate aggregations for
the same legal-concepts data because two components ask for it with different
`limit` values. The primary user is a self-representing immigration applicant
working under stress — jank and chart flicker on the reading and analysis
surfaces directly undermine the product's "authoritative, precise, academic"
brand. After this plan, typing is debounced, chart datasets are identity-stable
so the existing memos actually pay off, and one redundant full-table
aggregation disappears.

## Current state

### Files in play

- `frontend/src/components/shared/GlobalSearch.tsx` — the Cmd+K dialog, mounted
  app-wide from `AppLayout`. Feeds raw input state straight into a query hook.
- `frontend/src/hooks/use-cases.ts` — `useSearchCases`; **read-only reference
  here, do not modify** (see Scope).
- `frontend/src/components/cases/CaseTextViewer.tsx` — 511 lines; the full-text
  judgment reader with in-text search, TOC, print and download.
- `frontend/src/components/cases/CasesTable.tsx` — renders the Cases list in
  either "cards" mode (early return) or "table" mode (a mobile card grid **and**
  a desktop table, both always mounted, switched by CSS only).
- `frontend/src/pages/DashboardPage.tsx` — 5 charts fed from `useStats`/`useTrends`.
- `frontend/src/components/analytics/SuccessRateCalculator.tsx` — quick-estimate
  widget on the Analytics page.
- `frontend/src/components/analytics/OutcomeAnalysisSection.tsx` — **read-only
  reference here**; it is the component whose legal-concepts query the
  calculator should share.

### FEPERF-02 — global search has no debounce

`frontend/src/components/shared/GlobalSearch.tsx:20-24`:

```tsx
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { data } = useSearchCases(query, 8);
```

`frontend/src/components/shared/GlobalSearch.tsx:64-68` — the raw setter:

```tsx
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
```

`frontend/src/hooks/use-cases.ts:88-95` — every prefix is a distinct cache key,
and there is no `retry` option, so React Query's default of 3 retries applies:

```ts
export function useSearchCases(query: string, limit = 50) {
  return useQuery({
    queryKey: ["search", query, limit],
    queryFn: () => searchCases(query, limit),
    enabled: query.length > 0,
    staleTime: 15_000,
  });
}
```

The Worker rejects 1-character queries cheaply —
`workers/case-api/cloudflare.js:195`:

```js
  if (q.length < 2) return jsonErr("query too short");
```

`jsonErr` defaults to HTTP 400 (`workers/case-api/cloudflare.js:78`). So typing
`migration` (9 chars) today costs **8 real full-text D1 scans** plus one 400
that React Query may retry up to 3 more times.

The repo already debounces the *other* autocomplete —
`frontend/src/components/taxonomy/JudgeAutocomplete.tsx:36-52`:

```tsx
  const handleSearchChange = useCallback((value: string) => {
    setInputValue(value);
    setActiveIndex(-1); // reset keyboard nav on each keystroke

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer (300ms debounce)
    const timer = setTimeout(() => {
      setDebouncedQuery(value);
    }, 300);

    // Store timer in ref for cleanup
    debounceTimerRef.current = timer;
  }, []);
```

There are three hand-rolled copies of this logic
(`JudgeAutocomplete.tsx:19,46`, `LegislationsPage.tsx:41,105`,
`JudgeProfilesPage.tsx:42`) and **no** shared hook —
`ls frontend/src/hooks/` contains no `use-debounce*` file.

### FEPERF-03 — full-text viewer rebuilds the whole judgment per keystroke

`frontend/src/components/cases/CaseTextViewer.tsx:217-229` — unbounded match
collection, recomputed on every `searchTerm` change:

```tsx
  // Find all matches
  const matches = useMemo(() => {
    if (!searchTerm || searchTerm.length < 2) return [];
    const results: number[] = [];
    const lower = text.toLowerCase();
    const term = searchTerm.toLowerCase();
    let idx = lower.indexOf(term);
    while (idx !== -1) {
      results.push(idx);
      idx = lower.indexOf(term, idx + 1);
    }
    return results;
  }, [text, searchTerm]);
```

`frontend/src/components/cases/CaseTextViewer.tsx:316-321` and `:362-364` — the
whole tree is rebuilt, and reading mode re-runs `renderSmartLines(text)` (one
classified `<div>` per line for the entire document) whenever `searchTerm` or
`activeMatch` changes even though neither is used on that path:

```tsx
  // Render text with search highlights and section formatting
  const rendered = useMemo(() => {
    if (!text) return null;

    // Search mode: preserve existing whitespace-pre-wrap + span rendering
    if (searchTerm && searchTerm.length >= 2 && matches.length > 0) {
```

```tsx
    // Reading mode: use smart line classification rendering
    return renderSmartLines(text);
  }, [text, searchTerm, matches, activeMatch]);
```

`frontend/src/components/cases/CaseTextViewer.tsx:377-384` — the raw setter:

```tsx
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setActiveMatchIdx(0);
                }}
```

The `expanded` state (`:208`) is **not** an escape hatch: `grep -n expanded`
shows it is used only at `:262`, `:446`, `:449`, `:454`, `:469` and `:503`, and
at `:469`/`:503` it only toggles `max-h-none` vs `max-h-[600px]` — pure CSS
clipping. The entire document is always in the DOM.

### FEPERF-07 — dashboard defeats its own chart memos

`frontend/src/pages/DashboardPage.tsx:84-97` returns a brand-new object literal
on every call:

```tsx
function toRenderableDistribution(
  distribution: Record<string, unknown> | undefined,
): Record<string, number> {
  return Object.entries(distribution ?? {}).reduce<Record<string, number>>(
    (acc, [key, value]) => {
      const name = key.trim();
      const numeric = typeof value === "number" ? value : Number(value);
      if (!name || !Number.isFinite(numeric) || numeric <= 0) return acc;
      acc[name] = Math.trunc(numeric);
      return acc;
    },
    {},
  );
}
```

`frontend/src/pages/DashboardPage.tsx:433-451` — six bare `const`s in the render
body, **after** the early returns at `:253`, `:338`, `:360` and `:378`:

```tsx
  const courtDistribution = toRenderableDistribution(
    stats.courts as Record<string, unknown>,
  );
  const isDegradedStats = Boolean(stats.degraded);
  const yearDistribution = toRenderableDistribution(
    stats.years as Record<string, unknown>,
  );
  const sourceDistribution = toRenderableDistribution(
    stats.sources as Record<string, unknown>,
  );
  const natureDistribution = toRenderableDistribution(
    stats.natures as Record<string, unknown>,
  );
  const visaSubclassDistribution = toRenderableDistribution(
    normalizeVisaSubclassKeys(stats.visa_subclasses || {}) as Record<string, unknown>,
  );
  const trends = normalizeTrendEntries(
    (trendsData?.trends ?? []) as Record<string, unknown>[],
  );
```

`frontend/src/pages/DashboardPage.tsx:462-464`:

```tsx
  const sortedCourts = Object.entries(courtDistribution).toSorted(
    ([, a], [, b]) => b - a,
  );
```

Those values go straight into memoised charts at `:957`
(`<CourtChart data={courtDistribution} />`), `:989`
(`<CourtSparklineGrid data={trends} />`), `:991`
(`<CourtChart data={yearDistribution} />`), `:1031`
(`<NatureChart data={natureDistribution} />`), `:1033` and `:1060`
(`<CourtChart data={fallbackDistribution} />`) and `:1058`
(`<SubclassChart data={visaSubclassDistribution} />`). The memos are real:

```
frontend/src/components/dashboard/CourtChart.tsx:86:export const CourtChart = memo(CourtChartInner);
frontend/src/components/dashboard/NatureChart.tsx:114:export const NatureChart = memo(NatureChartInner);
frontend/src/components/dashboard/SubclassChart.tsx:145:export const SubclassChart = memo(SubclassChartInner);
frontend/src/components/dashboard/CourtSparklineGrid.tsx:120:export const CourtSparklineGrid = memo(CourtSparklineGridInner);
```

Shallow prop comparison can never hit against a new object identity, so all four
memoised components pay their comparison cost and deliver nothing. The
component's own re-render triggers are `court`/`yearFrom`/`yearTo`
(`:111-113`), `loadingPhase` (`:131`) and `courtView` (`:133`), plus every
TanStack Query settle.

There is also a DEV-only diagnostics effect at `:153-251` that recomputes six
more copies of the same values (`devCourtDistribution` … `devTrends`) inside
`useEffect`. It is guarded by `import.meta.env.DEV` and keyed on
`[stats, trendsData, filters.court, filters.yearFrom, filters.yearTo]`, so it is
not a per-render cost — but it is duplicated logic that should reuse the memos.

### FEPERF-08 — Analytics fetches legal-concepts twice over a limit mismatch

`frontend/src/components/analytics/OutcomeAnalysisSection.tsx:38-44`:

```tsx
  const {
    data: conceptsData,
    isLoading: loadingConcepts,
    isError: isConceptsError,
    error: conceptsError,
    refetch: refetchConcepts,
  } = useLegalConcepts(filters);
```

`frontend/src/components/analytics/SuccessRateCalculator.tsx:43-44`:

```tsx
  const { data: conceptOptions, isError: isConceptOptionsError } =
    useLegalConcepts(filters, 18);
```

`frontend/src/hooks/use-analytics.ts:65-73` puts `limit` in the query key, so
`18` and the default `20` are two different cache entries and therefore two
network requests:

```ts
export function useLegalConcepts(filters?: AnalyticsFilterParams, limit = 20) {
  return useQuery({
    queryKey: ["analytics", "concepts", limit, ...filterKey(filters)],
    queryFn: () => fetchLegalConcepts(filters, limit),
    retry: 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}
```

That this is a bug and not a design choice is proved by the sibling call:
`useOutcomes(filters)` is invoked at **both**
`OutcomeAnalysisSection.tsx:30` and `SuccessRateCalculator.tsx:42` with
identical arguments, and React Query correctly collapses those into one request.

The `18` buys nothing, because the calculator only ever renders 12 —
`frontend/src/components/analytics/SuccessRateCalculator.tsx:65` and `:120`:

```tsx
  const conceptList = conceptOptions?.concepts ?? [];
```

```tsx
          {conceptList.slice(0, 12).map((concept) => {
```

And the server returns a deterministically ordered list, so the first 12 of a
`limit=20` response are byte-identical to the first 12 of a `limit=18` response
— `workers/case-api/cloudflare.js:556-568`:

```js
async function handleAnalyticsLegalConcepts(url, stores) {
  const limit = intParam(url.searchParams.get("limit"), 20, 1, 100);
  const rows = await stores.caseStore.analyticsConcepts(100);
  const counts = new Map();
  for (const row of rows) {
    const concept = canonicalConcept(row.concept);
    if (!concept) continue;
    counts.set(concept, (counts.get(concept) || 0) + Number(row.cnt || 0));
  }
  return jsonOk({ concepts: [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit).map(([name, count]) => ({ name, count })) },
  "public, max-age=600, stale-while-revalidate=120");
```

### FEPERF-09 — Cases list mounts the mobile card grid on desktop too

`frontend/src/components/cases/CasesTable.tsx:60-79` — in "table" mode, a mobile
note, a mobile card grid, and the desktop table are **all** mounted; only CSS
hides two of them:

```tsx
  return (
    <>
      <div className="md:hidden rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-text">
        {t("cases.mobile_table_note", {
          defaultValue:
            "Table view is optimized for larger screens. Showing card view on mobile for easier reading.",
        })}
      </div>
      <div className="grid auto-rows-fr gap-4 md:hidden">
        {cases.map((c) => (
          <CaseCard
            key={c.case_id}
            case_={c}
            onClick={() => navigate(`/cases/${c.case_id}`)}
            className="h-full"
          />
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
        <table data-testid="cases-table" className="w-full min-w-[1100px] text-sm">
```

`frontend/src/pages/CasesPage.tsx:63` hardcodes `page_size: 100`, and
`frontend/src/components/cases/CaseCard.tsx` is 100 lines composing three badge
components — so ~100 non-trivial subtrees exist only to be `display: none` on
desktop.

**Two hard constraints on how far this may be fixed** (both verified, both
narrow the fix — read them before writing code):

1. `CLAUDE.md:294` documents this exact CSS-only pattern as the app-wide
   standard: *"**JudgeLeaderboard 雙視圖** — `md:hidden` 手機卡片視圖 +
   `hidden md:block overflow-x-auto` 桌面表格，是整個 app 響應式表格的標準模式。"*
2. `tests/e2e/react/test_react_responsive.py:101-105` asserts, at a **390 px**
   mobile viewport, that the desktop table wrapper is still in the DOM:

   ```python
       def test_mobile_cases_table_scrollable(self, react_mobile):
           """Cases table wrapper should be horizontally scrollable."""
           react_navigate(react_mobile, "/cases")
           wait_for_loading_gone(react_mobile)
           table_wrapper = react_mobile.locator(".overflow-x-auto")
           assert table_wrapper.count() >= 1
   ```

   `grep -rn "overflow-x-auto" frontend/src/pages/CasesPage.tsx frontend/src/components/cases/*.tsx`
   returns exactly one hit — `CasesTable.tsx:78` — so removing the table branch
   on mobile would break that test.

Therefore the fix in Step 5 is **asymmetric**: skip the mobile card grid when
the viewport is desktop-width; never remove the table branch. Desktop is where
the ~100 wasted subtrees are, and mobile behaviour stays byte-identical.

### Repo conventions this plan must honour

Quoted from `CLAUDE.md` (the executor has not read it):

- `CLAUDE.md:282` — *"**TanStack Query navigation flash** — use
  `keepPreviousData` in all filter-dependent hooks to prevent empty state flash
  during rapid page switching"*
- `CLAUDE.md:284` — *"**Dashboard empty state** — shows "Welcome to IMMI-Case"
  when `stats.total_cases === 0 && !isFetching`; guard with `isFetching` to
  avoid false empty state"*
- `CLAUDE.md:287` — *"**i18n defaultValue pattern** — always use
  `t("key", { defaultValue: "English text" })` for UI text; i18n mock in tests
  returns the key string without `defaultValue`, causing test assertion
  failures"*
- `CLAUDE.md:288` — *"**localStorage must be try-catch wrapped**"*
- `CLAUDE.md:289` — *"**Use `.toSorted()` not `.sort()`** — never mutate arrays
  in React"*
- `CLAUDE.md:281` — *"**Recharts dark mode tooltips** — ALL Tooltip
  `contentStyle` must include `color: "var(--color-text)"`"*
- `CLAUDE.md:290` — *"**animate-spin on wrapper div** — put `animate-spin` on a
  `<div>` wrapper, NOT on `<Loader2>` or `<RefreshCw>` directly"*
- `CLAUDE.md:398` — *"所有間距、陰影、圓角必須從 `tokens.json` 取值，不得出現
  魔法數字"* (all spacing / shadow / radius values come from
  `frontend/src/tokens/tokens.json`; no magic numbers). This plan changes **no**
  visual styling — reuse the existing Tailwind class strings verbatim.

Design direction is already decided and named **"Legal Codex"**: warm off-white
`#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text serif
headings, 9 court-specific colour codes. Do not restyle anything.

Environment facts:

- `jsdom` **does not define `window.matchMedia`**. The repo says so itself:
  `frontend/__tests__/llm-council-page.test.tsx:72` — *"jsdom does not define
  navigator.vibrate nor window.matchMedia by default"*. Any `matchMedia` use
  needs a defined fallback.
- React 19.2, `@tanstack/react-query` 5.90, Vitest 4.0, `@testing-library/react`
  16.3, jsdom 24. `renderHook` is already used in
  `frontend/__tests__/use-llm-council-sessions.test.ts` — use it as the
  structural exemplar for hook tests.
- Source-scanning tests are an established pattern in this repo — see
  `frontend/__tests__/no-as-any.test.tsx` and
  `frontend/__tests__/i18n-hardcoded.test.ts`, both of which `readFileSync` a
  source file and assert on its contents.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend typecheck (**working form**) | `cd frontend && npx tsc -b --noEmit` | exit 0, no output |
| Frontend unit tests | `cd frontend && npx vitest run` | baseline 490 passed / 55 files; after this plan **more** passed, 0 failed |
| Single frontend test file | `cd frontend && npx vitest run __tests__/<file>` | all pass |
| Worker tests (must stay green) | `cd workers && npx vitest run` | 345 passed, 25 files |
| Python unit tests (must stay green) | `make test-py` | 1141 passed, 3 failed, 7 skipped — **the 3 failures are pre-existing and environmental** (Homebrew Python 3.14.7 pyexpat/libexpat ABI mismatch breaks the `pypdf` import in `tests/test_backfill_judge_overrides_from_pdf.py`). Not caused by, and not fixable in, this plan. |
| Confirm nothing outside scope changed | `git status --short` | only files listed in Scope |

Do **not** use `make typecheck` as your gate: `Makefile:95-96` runs
`cd frontend && npx tsc --noEmit`, which exits 0 while loading **zero** files
(`frontend/tsconfig.json` is `files: []` plus project references). Fixing that
is plan 001's job, not this plan's.

## Scope

**In scope** (the only files you may modify or create):

- `frontend/src/hooks/use-debounced-value.ts` — **create**
- `frontend/src/components/shared/GlobalSearch.tsx`
- `frontend/src/components/cases/CaseTextViewer.tsx`
- `frontend/src/components/cases/CasesTable.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/components/analytics/SuccessRateCalculator.tsx`
- `frontend/__tests__/use-debounced-value.test.ts` — **create**
- `frontend/__tests__/global-search-debounce.test.tsx` — **create**
- `frontend/__tests__/cases-table-responsive.test.tsx` — **create**
- `frontend/__tests__/render-perf-guards.test.ts` — **create**
- `plans/020-fix-render-performance.md` — this file, status line only

**Out of scope** (do NOT touch, even though they look related):

- `frontend/src/hooks/use-cases.ts` — adding `retry: 0` and raising the
  `enabled` gate to `>= 2` there is tempting, but this hook is shared and the
  same effect is achieved inside `GlobalSearch.tsx` by passing `""` below the
  2-character threshold (which trips the existing `enabled: query.length > 0`
  gate). Leave the hook alone; see **Maintenance notes**.
- `frontend/src/hooks/use-analytics.ts` — no signature or gating changes.
- `frontend/src/pages/AnalyticsPage.tsx` — lazy-loading the below-the-fold
  analytics sections was considered and rejected; see **Findings reconsidered**.
- `frontend/src/components/analytics/OutcomeAnalysisSection.tsx` — it already
  calls `useLegalConcepts(filters)` with the default limit. It is the *correct*
  caller; the calculator moves to match it.
- `frontend/src/components/llm-council/StreamingCouncilView.tsx` — real finding,
  outside this plan's file territory; see **Findings reconsidered**.
- `frontend/src/components/taxonomy/JudgeAutocomplete.tsx`,
  `frontend/src/pages/LegislationsPage.tsx`,
  `frontend/src/pages/JudgeProfilesPage.tsx` — they have working hand-rolled
  debounces. Migrating them to the new shared hook is a follow-up, not this
  plan (it would collide with other plans' territory).
- `frontend/src/pages/CasesPage.tsx` — do not change `page_size: 100`.
- `tests/e2e/**` — Playwright E2E is not part of this plan's gate and its
  assertions constrain the design (see Step 5); do not edit it.
- Any visual styling, Tailwind class strings, `tokens.json`, or i18n locale
  JSON beyond adding `t("...", { defaultValue: "..." })` call sites.
- Anything under `workers/`, `immi_case_downloader/`, `.omc/` or `.claude/`.

## Git workflow

- Branch: `advisor/020-fix-render-performance`
- One commit per step, or per logical unit. Message style is conventional
  commits, type from `feat|fix|refactor|docs|test|chore|perf|ci`, no AI
  attribution lines. Real example from `git log`:
  `fix: install root node_modules in make install`
- Suggested messages: `perf: debounce global search input`,
  `perf: debounce and cap case full-text search highlighting`,
  `perf: memoise dashboard chart distributions`,
  `perf: skip mobile case cards on desktop viewports`,
  `perf: share the analytics legal-concepts query`,
  `test: cover the render-performance guards`
- Do **NOT** push, open a PR, or merge. The operator commits and ships.

## Steps

### Step 1: Add a shared `useDebouncedValue` hook

Create `frontend/src/hooks/use-debounced-value.ts`:

```ts
import { useEffect, useState } from "react";

/**
 * Returns `value` delayed by `delayMs`. The returned value only updates once
 * `value` has stopped changing for `delayMs`. Used to keep high-frequency
 * input state (typing) from driving expensive work (network queries, full
 * document re-renders) on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
```

Notes: the cleanup `clearTimeout` is what makes this a debounce rather than a
throttle — do not omit it. Do not add `localStorage`, refs, or a leading-edge
option; nothing here needs them.

**Verify**: `cd frontend && npx tsc -b --noEmit` → exit 0, no output.

### Step 2: Debounce the Cmd+K global search and gate it at 2 characters

Edit `frontend/src/components/shared/GlobalSearch.tsx` only.

1. Add the import next to the existing `useSearchCases` import (line 6):

   ```tsx
   import { useDebouncedValue } from "@/hooks/use-debounced-value";
   ```

2. Replace line 24 (`const { data } = useSearchCases(query, 8);`) with:

   ```tsx
     const debouncedQuery = useDebouncedValue(query, 250);
     // The Worker rejects queries shorter than 2 characters with HTTP 400
     // (workers/case-api/cloudflare.js:195). Passing "" trips useSearchCases'
     // existing `enabled: query.length > 0` gate, so no request is made at all.
     const searchQuery =
       debouncedQuery.trim().length >= 2 ? debouncedQuery.trim() : "";
     const { data, isFetching } = useSearchCases(searchQuery, 8);
   ```

3. Line 32 currently reads
   `const isExpanded = hasResults && query.length > 0;`. Change `query.length`
   to `searchQuery.length` so the combobox `aria-expanded` state tracks the
   query that was actually issued.

4. Line 140 currently reads `{query.length > 0 && cases.length === 0 && (`.
   Change it to:

   ```tsx
          {searchQuery.length > 0 && !isFetching && cases.length === 0 && (
   ```

   The `!isFetching` guard matches the documented dashboard convention
   (`CLAUDE.md:284`) and stops the "no results" panel flashing while the
   debounced request is in flight.

Do not change `query`/`setQuery` themselves — the `<input value={query}>`
binding at line 64 must stay on the immediate state so typing feels instant.
Do not touch the keyboard-navigation block (lines 69-88) or `activeIdx`.

**Verify**: `cd frontend && npx tsc -b --noEmit` → exit 0, and
`cd frontend && npx vitest run` → 0 failed.

### Step 3: Debounce and cap the case full-text search

Edit `frontend/src/components/cases/CaseTextViewer.tsx` only.

1. Add the import alongside the other `@/` imports at the top of the file:

   ```tsx
   import { useDebouncedValue } from "@/hooks/use-debounced-value";
   ```

2. Add a module-level constant next to the file's other top-level constants
   (above `function renderSmartLines` at line 57 is fine):

   ```tsx
   /** Upper bound on highlighted hits, so a 1-letter term cannot blow up the tree. */
   const MAX_HIGHLIGHTED_MATCHES = 500;
   ```

3. Immediately after the `sections` memo (currently line 215,
   `const sections = useMemo(() => parseSections(text), [text]);`) add:

   ```tsx
     const debouncedSearchTerm = useDebouncedValue(searchTerm, 200);
   ```

4. Replace the whole `matches` memo (lines 217-229) with a capped version that
   also reports the true total:

   ```tsx
     // Find matches, capped so a pathological term cannot blow up the tree.
     const { matches, totalMatches } = useMemo(() => {
       if (!debouncedSearchTerm || debouncedSearchTerm.length < 2) {
         return { matches: [] as number[], totalMatches: 0 };
       }
       const results: number[] = [];
       const lower = text.toLowerCase();
       const term = debouncedSearchTerm.toLowerCase();
       let idx = lower.indexOf(term);
       let total = 0;
       while (idx !== -1) {
         total += 1;
         if (results.length < MAX_HIGHLIGHTED_MATCHES) results.push(idx);
         idx = lower.indexOf(term, idx + 1);
       }
       return { matches: results, totalMatches: total };
     }, [text, debouncedSearchTerm]);
   ```

5. Add a reading-mode memo that depends on `text` alone, so typing never
   rebuilds it. Put it immediately before the existing `rendered` memo
   (line 316):

   ```tsx
     // Reading-mode tree depends on `text` alone: typing must not rebuild it.
     const readingModeNodes = useMemo(
       () => (text ? renderSmartLines(text) : null),
       [text],
     );
   ```

6. In the `rendered` memo (lines 317-364):
   - change the search-mode condition on line 321 from
     `if (searchTerm && searchTerm.length >= 2 && matches.length > 0) {` to
     `if (debouncedSearchTerm && debouncedSearchTerm.length >= 2 && matches.length > 0) {`
   - inside that branch, replace both uses of `searchTerm.length` (lines 334 and
     338, in `text.slice(start, start + searchTerm.length)` and
     `lastEnd = start + searchTerm.length;`) with `debouncedSearchTerm.length`
   - replace the reading-mode `return renderSmartLines(text);` (line 363) with
     `return readingModeNodes;`
   - change the dependency array (line 364) to
     `}, [text, debouncedSearchTerm, matches, activeMatch, readingModeNodes]);`

7. Surface the cap in the match counter. Replace lines 391-395:

   ```tsx
               {matches.length > 0 && (
                 <span className="text-xs text-muted-text whitespace-nowrap">
                   {activeMatch + 1}/{matches.length}
                 </span>
               )}
   ```

   with:

   ```tsx
               {matches.length > 0 && (
                 <span className="text-xs text-muted-text whitespace-nowrap">
                   {activeMatch + 1}/{matches.length}
                   {totalMatches > matches.length
                     ? ` ${t("components.case_text_viewer.match_cap_note", {
                         defaultValue: `(first ${MAX_HIGHLIGHTED_MATCHES} of ${totalMatches})`,
                         shown: MAX_HIGHLIGHTED_MATCHES,
                         total: totalMatches,
                       })}`
                     : ""}
                 </span>
               )}
   ```

   The `defaultValue` pattern is mandatory here (`CLAUDE.md:287`).

Leave `searchTerm`/`setSearchTerm`, the `<input value={searchTerm}>` binding
(line 380), the Escape handler (lines 272-275), `goToMatch`, `handleDownload`,
`handlePrint`, `parseSections` and the TOC `IntersectionObserver` exactly as
they are.

**Verify**: `cd frontend && npx tsc -b --noEmit` → exit 0, and
`cd frontend && npx vitest run` → 0 failed.

### Step 4: Memoise the dashboard chart distributions

Edit `frontend/src/pages/DashboardPage.tsx` only.

The memos **must** be hoisted above the four early returns at lines 253, 338,
360 and 378 so hook order stays stable, and they must tolerate `stats` being
`undefined` at that point (use optional chaining).

1. Insert the following block **between** the closing `}, [isInitialLoading, filters.court, filters.yearFrom, filters.yearTo]);`
   of the loading-phase effect (line 151) and the start of the DEV diagnostics
   effect (line 153):

   ```tsx
     // Chart datasets are memoised so the memo() wrappers on CourtChart /
     // NatureChart / SubclassChart / CourtSparklineGrid can actually hit.
     // These sit above the early returns below to keep hook order stable.
     const courtDistribution = useMemo(
       () => toRenderableDistribution(stats?.courts as Record<string, unknown>),
       [stats?.courts],
     );
     const yearDistribution = useMemo(
       () => toRenderableDistribution(stats?.years as Record<string, unknown>),
       [stats?.years],
     );
     const sourceDistribution = useMemo(
       () => toRenderableDistribution(stats?.sources as Record<string, unknown>),
       [stats?.sources],
     );
     const natureDistribution = useMemo(
       () => toRenderableDistribution(stats?.natures as Record<string, unknown>),
       [stats?.natures],
     );
     const visaSubclassDistribution = useMemo(
       () =>
         toRenderableDistribution(
           normalizeVisaSubclassKeys(stats?.visa_subclasses || {}) as Record<
             string,
             unknown
           >,
         ),
       [stats?.visa_subclasses],
     );
     const trends = useMemo(
       () =>
         normalizeTrendEntries(
           (trendsData?.trends ?? []) as Record<string, unknown>[],
         ),
       [trendsData?.trends],
     );
     const sortedCourts = useMemo(
       () => Object.entries(courtDistribution).toSorted(([, a], [, b]) => b - a),
       [courtDistribution],
     );
   ```

   `.toSorted()` (not `.sort()`) is mandatory — `CLAUDE.md:289`.

2. Delete the now-duplicated bare `const`s from the render body. In the block at
   lines 433-451, delete the declarations of `courtDistribution`,
   `yearDistribution`, `sourceDistribution`, `natureDistribution`,
   `visaSubclassDistribution` and `trends`. **Keep** `isDegradedStats`
   (line 436) exactly where it is. Then delete the `sortedCourts` declaration at
   lines 462-464.

   Everything from line 452 onward (`hasTrendSeries`, `hasYearBars`,
   `hasCourtData`, `hasNatureData`, `hasVisaSubclassData`,
   `fallbackDistribution`, `hasFallbackDistribution`, `natureCount`,
   `fallbackDataset`, and the four `*SourceState` objects) stays as plain
   `const`s — they are cheap, and `fallbackDistribution` is already
   identity-stable because it is a ternary returning one of the two memoised
   objects.

3. Simplify the DEV diagnostics effect (lines 153-251) to reuse the memos.
   Delete the six local recomputations (`devCourtDistribution`,
   `devYearDistribution`, `devSourceDistribution`, `devNatureDistribution`,
   `devVisaSubclassDistribution`, `devTrends` — lines 156-173) and replace every
   later reference to a `dev*` name with the corresponding memoised value
   (`devCourtDistribution` → `courtDistribution`, `devYearDistribution` →
   `yearDistribution`, `devSourceDistribution` → `sourceDistribution`,
   `devNatureDistribution` → `natureDistribution`,
   `devVisaSubclassDistribution` → `visaSubclassDistribution`, `devTrends` →
   `trends`). Then change the effect's dependency array (line 251) to:

   ```tsx
     }, [
       stats,
       courtDistribution,
       yearDistribution,
       sourceDistribution,
       natureDistribution,
       visaSubclassDistribution,
       trends,
     ]);
   ```

   Keep the `if (!import.meta.env.DEV || !stats) return;` guard on line 154 and
   the `console.warn` on lines 246-249 unchanged.

4. `useMemo` is already imported in this file (it is used at line 115) — confirm
   with `grep -n "^import { " frontend/src/pages/DashboardPage.tsx` rather than
   adding a duplicate import.

Change no JSX. The chart call sites at `:957`, `:989`, `:991`, `:1031`, `:1033`,
`:1058` and `:1060` keep referring to the same names.

**Verify**: `cd frontend && npx tsc -b --noEmit` → exit 0, then
`cd frontend && npx vitest run __tests__/dashboard-page.test.tsx` → all pass,
then `cd frontend && npx vitest run` → 0 failed.

### Step 5: Skip the mobile card grid on desktop viewports

Edit `frontend/src/components/cases/CasesTable.tsx` only.

Read the "two hard constraints" in *Current state → FEPERF-09* before starting.
The change is deliberately **one-sided**: the desktop table branch is *always*
rendered (an E2E test asserts `.overflow-x-auto` exists at a 390 px viewport);
only the mobile note + card grid become conditional.

1. Add imports at the top of the file:

   ```tsx
   import { useCallback, useSyncExternalStore } from "react";
   ```

2. Add a module-level media-query subscription above `formatDateCompact`
   (line 10). `useSyncExternalStore` is the repo's established pattern for
   external stores — see `frontend/src/hooks/use-bookmarks.ts:1` and `:203`.

   ```tsx
   const DESKTOP_QUERY = "(min-width: 768px)"; // Tailwind `md`

   function subscribeToDesktopQuery(onChange: () => void): () => void {
     if (typeof window === "undefined" || !window.matchMedia) return () => {};
     const mql = window.matchMedia(DESKTOP_QUERY);
     mql.addEventListener("change", onChange);
     return () => mql.removeEventListener("change", onChange);
   }

   // jsdom does not implement matchMedia, and neither does SSR. Default to
   // desktop so the table branch (and its tests) behave exactly as before.
   function isDesktopViewport(): boolean {
     if (typeof window === "undefined" || !window.matchMedia) return true;
     return window.matchMedia(DESKTOP_QUERY).matches;
   }
   ```

3. Inside `CasesTable`, after `const navigate = useNavigate();` (line 43), add:

   ```tsx
     const isDesktop = useSyncExternalStore(
       subscribeToDesktopQuery,
       isDesktopViewport,
       () => true,
     );
   ```

4. Wrap the mobile note (lines 62-67) and the mobile card grid (lines 68-77) in
   a single `{!isDesktop && ( ... )}` guard, using a fragment so both stay
   siblings of the table:

   ```tsx
     return (
       <>
         {!isDesktop && (
           <>
             <div className="md:hidden rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-text">
               {t("cases.mobile_table_note", {
                 defaultValue:
                   "Table view is optimized for larger screens. Showing card view on mobile for easier reading.",
               })}
             </div>
             <div className="grid auto-rows-fr gap-4 md:hidden">
               {cases.map((c) => (
                 <CaseCard
                   key={c.case_id}
                   case_={c}
                   onClick={() => navigate(`/cases/${c.case_id}`)}
                   className="h-full"
                 />
               ))}
             </div>
           </>
         )}
         <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
   ```

   Keep every Tailwind class string byte-identical, including the now-redundant
   `md:hidden` classes — they are the safety net if `matchMedia` reports stale
   values mid-resize, and removing them would change the design.

5. Do **not** touch the `viewMode === "cards"` early return (lines 45-58), the
   `<tbody ref={tableRef}>` (line 121), `data-testid="cases-table"`,
   `data-testid="cases-row"`, or `data-testid="cases-select-all"`.

`useCallback` is imported in step 5.1 only if you end up needing it; if your
final code does not use it, drop it from the import to keep lint clean.

**Verify**: `cd frontend && npx tsc -b --noEmit` → exit 0, then
`cd frontend && npx vitest run __tests__/cases-page.test.tsx __tests__/cases-page-font.test.tsx`
→ all pass (these rely on the jsdom `matchMedia`-absent fallback resolving to
desktop, so `cases-table` and `cases-row` still render).

### Step 6: Share the analytics legal-concepts query

Edit `frontend/src/components/analytics/SuccessRateCalculator.tsx` only.

Replace lines 43-44:

```tsx
  const { data: conceptOptions, isError: isConceptOptionsError } =
    useLegalConcepts(filters, 18);
```

with:

```tsx
  // Default limit (20) on purpose: this shares one cache entry — and therefore
  // one request — with OutcomeAnalysisSection's useLegalConcepts(filters).
  // `limit` is part of the query key (hooks/use-analytics.ts:67), so any other
  // value forks a second full-table aggregation. Only 12 are rendered below.
  const { data: conceptOptions, isError: isConceptOptionsError } =
    useLegalConcepts(filters);
```

Change nothing else. `conceptList.slice(0, 12)` on line 120 already bounds what
is displayed, and the server returns a deterministically sorted list
(`workers/case-api/cloudflare.js:566`), so the rendered chips are unchanged.

**Verify**:

```bash
cd frontend && grep -n "useLegalConcepts" src/components/analytics/SuccessRateCalculator.tsx
```

→ exactly two lines: the import (line 18) and `useLegalConcepts(filters);` —
no line containing `, 18)`.

Then `cd frontend && npx vitest run` → 0 failed.

### Step 7: Add the regression tests

Create four files under `frontend/__tests__/`.

**7a. `frontend/__tests__/use-debounced-value.test.ts`** — model the imports and
`renderHook` usage on `frontend/__tests__/use-llm-council-sessions.test.ts`.
Cover three cases with `vi.useFakeTimers()`:

1. returns the initial value synchronously on first render;
2. does **not** update before `delayMs` has elapsed
   (`act(() => vi.advanceTimersByTime(delay - 1))` → still the old value);
3. collapses rapid changes into one update — rerender with `"m"`, `"mi"`,
   `"mig"` in quick succession, advance past the delay once, and assert the
   result is `"mig"` (never `"m"` or `"mi"`).

Call `vi.useRealTimers()` in an `afterEach`.

**7b. `frontend/__tests__/global-search-debounce.test.tsx`** — mock
`@/hooks/use-cases` with `vi.mock` and capture the arguments
`useSearchCases` is called with. Render `GlobalSearch` with `open` true inside
whatever providers the existing page tests use (copy the provider wrapper from
`frontend/__tests__/cases-page.test.tsx`). With fake timers, type `a` then `ab`
into the input (`data-global-search`) and assert:

1. before the debounce elapses, every recorded first argument is `""`;
2. after advancing 250 ms, the last recorded first argument is `"ab"`;
3. a single-character query never reaches the hook — no recorded first
   argument is ever `"a"`.

**7c. `frontend/__tests__/cases-table-responsive.test.tsx`** — render
`CasesTable` with `viewMode="table"` and two cases (mock `@/components/cases/CaseCard`
to a `data-testid="case-card"` stub, exactly as `cases-page.test.tsx:39-48`
does). Two tests:

1. with `window.matchMedia` **undefined** (jsdom default), the table is present
   (`getByTestId("cases-table")`) and `queryAllByTestId("case-card")` has
   length 0 — the desktop fallback;
2. with `window.matchMedia` stubbed via `Object.defineProperty(window, "matchMedia", …)`
   to return `{ matches: false, addEventListener, removeEventListener, … }`
   (copy the stub shape from `frontend/__tests__/council-celebrations.test.ts:24`),
   both `cases-table` **and** two `case-card` stubs are present — the mobile
   path is unchanged. Delete the stub in `afterEach`.

**7d. `frontend/__tests__/render-perf-guards.test.ts`** — a source-scanning
guard file in the style of `frontend/__tests__/no-as-any.test.tsx`. Use
`readFileSync` + `path.resolve(__dirname, "../src/...")` and assert:

1. `SuccessRateCalculator.tsx` contains `useLegalConcepts(filters)` and does
   **not** match `/useLegalConcepts\(\s*filters\s*,/`;
2. `DashboardPage.tsx` does **not** contain the bare string
   `const courtDistribution = toRenderableDistribution(` (it must be inside a
   `useMemo`), and **does** contain `const sortedCourts = useMemo(`;
3. `GlobalSearch.tsx` contains `useDebouncedValue(query, 250)`;
4. `CaseTextViewer.tsx` contains `useDebouncedValue(searchTerm, 200)` and
   `MAX_HIGHLIGHTED_MATCHES`;
5. `CasesTable.tsx` contains `useSyncExternalStore` and still contains
   `overflow-x-auto` (the E2E assertion in
   `tests/e2e/react/test_react_responsive.py:104` depends on that class).

**Verify**:

```bash
cd frontend && npx vitest run __tests__/use-debounced-value.test.ts __tests__/global-search-debounce.test.tsx __tests__/cases-table-responsive.test.tsx __tests__/render-perf-guards.test.ts
```

→ all pass. Then `cd frontend && npx vitest run` → 0 failed, and the total
"passed" count is **greater than** the 490 baseline.

### Step 8: Full gate

Run every gate and confirm nothing regressed elsewhere.

**Verify**:

```bash
cd frontend && npx tsc -b --noEmit          # exit 0
cd frontend && npx vitest run               # 0 failed, >490 passed
cd workers  && npx vitest run               # 345 passed, 25 files
make test-py                                # 1141 passed, 3 failed (pre-existing pyexpat), 7 skipped
git status --short                          # only files from "In scope"
```

## Test plan

New tests, all under `frontend/__tests__/`:

| File | Covers | Cases |
|---|---|---|
| `use-debounced-value.test.ts` | the new hook | initial value; no update before the delay; rapid changes collapse to the last value |
| `global-search-debounce.test.tsx` | FEPERF-02 | no query before the debounce; final query after it; 1-char query never issued |
| `cases-table-responsive.test.tsx` | FEPERF-09 | desktop fallback renders table only; mobile renders table **and** cards |
| `render-perf-guards.test.ts` | FEPERF-03, 07, 08, 09 | source-level guards so a future refactor cannot silently reintroduce any of the five defects |

Structural patterns to copy:

- hook tests → `frontend/__tests__/use-llm-council-sessions.test.ts` (`renderHook`)
- component tests with provider wrappers and a mocked `CaseCard` →
  `frontend/__tests__/cases-page.test.tsx:38-48`
- a `window.matchMedia` stub →
  `frontend/__tests__/council-celebrations.test.ts:24` (and its `delete
  window.matchMedia` teardown at `:48`)
- source-scanning guards → `frontend/__tests__/no-as-any.test.tsx`

Existing tests that must stay green without modification (they are the real
regression net for Steps 4 and 5):
`frontend/__tests__/dashboard-page.test.tsx`,
`frontend/__tests__/cases-page.test.tsx`,
`frontend/__tests__/cases-page-font.test.tsx`,
`frontend/__tests__/analytics-filter-integration.test.tsx`,
`frontend/__tests__/court-chart.test.tsx`,
`frontend/__tests__/nature-chart.test.tsx`,
`frontend/__tests__/subclass-chart.test.tsx`,
`frontend/__tests__/court-sparkline-grid.test.tsx`.

If any of them needs editing to pass, that is a STOP condition — it means the
change altered behaviour, not just performance.

## Done criteria

ALL must hold:

- [ ] `cd frontend && npx tsc -b --noEmit` exits 0 with no output
- [ ] `cd frontend && npx vitest run` reports 0 failed and more than 490 passed
- [ ] `cd workers && npx vitest run` reports 345 passed, 25 files
- [ ] `make test-py` reports 1141 passed / 3 failed / 7 skipped — the same 3
      pre-existing `tests/test_backfill_judge_overrides_from_pdf.py` failures,
      no new ones
- [ ] `cd frontend && grep -c "useLegalConcepts(filters, 18)" src/components/analytics/SuccessRateCalculator.tsx`
      returns `0`
- [ ] `cd frontend && grep -c "const courtDistribution = toRenderableDistribution(" src/pages/DashboardPage.tsx`
      returns `0`
- [ ] `cd frontend && grep -c "useSearchCases(query, 8)" src/components/shared/GlobalSearch.tsx`
      returns `0`
- [ ] `cd frontend && grep -c "overflow-x-auto" src/components/cases/CasesTable.tsx`
      returns `1`
- [ ] `git status --short` lists only files named in the "In scope" list
- [ ] `plans/README.md` status row updated **if** that file exists

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check at the top prints anything, or any excerpt in "Current state"
  does not match the live file at the cited line.
- Removing `useLegalConcepts(filters, 18)` changes which concept chips render in
  `SuccessRateCalculator`. This plan asserts it cannot, because the server sorts
  deterministically (`workers/case-api/cloudflare.js:566`,
  `.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))`)
  and the component slices to 12. If you observe a different chip set, the
  ordering assumption is false — stop.
- `frontend/__tests__/cases-page.test.tsx` or
  `frontend/__tests__/cases-page-font.test.tsx` starts failing after Step 5.
  That means the `matchMedia`-absent fallback is not resolving to desktop, and
  the fix would ship a mobile layout to every desktop user.
- `grep -rn "overflow-x-auto" frontend/src/components/cases/CasesTable.tsx`
  returns 0 hits at any point. `tests/e2e/react/test_react_responsive.py:104`
  asserts that class exists in the DOM at a 390 px viewport, and CasesTable.tsx
  is its only source on the Cases page.
- `frontend/__tests__/dashboard-page.test.tsx` fails after Step 4. Hoisting the
  memos above the early returns changes hook order if done wrongly; a "Rendered
  fewer hooks than expected" error means a `useMemo` landed below one of the
  early returns at lines 253 / 338 / 360 / 378.
- Any step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching a file in the "Out of scope" list —
  especially `frontend/src/hooks/use-cases.ts` or
  `frontend/src/hooks/use-analytics.ts`.
- You find yourself editing an existing test's assertions to make it pass.

## Maintenance notes

For whoever owns this code next:

- **What a reviewer should scrutinise**: (1) that every `useMemo` added to
  `DashboardPage.tsx` sits above the early return at line 253 — hook order is
  the one way this change can break at runtime rather than at compile time;
  (2) that `CasesTable.tsx` still renders the `overflow-x-auto` table wrapper
  unconditionally; (3) that no Tailwind class string or token value changed.
- **`useSearchCases` still has no `retry` option**
  (`frontend/src/hooks/use-cases.ts:88-95`), unlike every analytics hook, which
  sets `retry: 0`. After this plan the 1-character 400 is never issued, so the
  retry storm is gone in practice — but a future caller that passes a short
  query directly will hit it again. Adding `retry: 0` there is a one-line
  follow-up owned by whoever next touches that hook.
- **Three hand-rolled debounces remain**:
  `frontend/src/components/taxonomy/JudgeAutocomplete.tsx:36-52` (300 ms),
  `frontend/src/pages/LegislationsPage.tsx:105`, and
  `frontend/src/pages/JudgeProfilesPage.tsx:42`. They should migrate to
  `useDebouncedValue`; deliberately left out here to avoid colliding with other
  plans' file territory.
- **Windowing the full-text viewer was deliberately not done.** It is the third
  item in the original recommendation and it is genuinely blocked, not merely
  deferred: `CaseTextViewer.tsx:237` scrolls via
  `containerRef.current?.querySelector(".active-match")` and `:242-262` runs a
  TOC `IntersectionObserver` over `document.getElementById(s.id)` for every
  section anchor emitted by `renderSmartLines`. Both require the full document
  in the DOM. Virtualising the line list means redesigning scroll-to-match and
  TOC navigation first. Revisit only with that redesign in hand.
- **If `page_size` on the Cases page ever becomes configurable**
  (`frontend/src/pages/CasesPage.tsx:63`, currently hardcoded to 100), revisit
  Step 5 — the saving scales linearly with it, and a much larger page size would
  justify true virtualisation over a media-query branch.
- **`MAX_HIGHLIGHTED_MATCHES = 500`** is a judgement call, not a measurement.
  If users report missing highlights on common terms in long judgments, raise it
  — the counter already tells them the list is truncated.

## Findings reconsidered

- **FEPERF-04 (LLM Council streaming re-parses markdown per SSE delta)** — real
  and verified, but **out of this plan's file territory**, so it gets no step
  here. Verified at HEAD `42826a3`:
  `frontend/src/components/llm-council/StreamingCouncilView.tsx:207-211` commits
  React state on every delta with no throttle, and — the higher-leverage half —
  `function ExpertColumn(...)` at `:426` is **not** wrapped in `memo()`, so a
  delta on any one provider re-renders all three columns and re-runs all three
  `remark → mdast → hast` pipelines at `:473`. Note plan 004 explicitly lists
  this file as out of scope too, so it is currently unowned: memoising
  `ExpertColumn` on `state.text` is the smallest high-value fix and should be
  its own plan. One correction to the original framing: React 18/19 batches the
  microtask-driven `for await (const ev of parseSseStream(res.body))` loop at
  `:245`, so the commit rate is one per SSE *network flush*, not one per token.
- **FEPERF-08, second half (lazy-load the below-the-fold analytics sections)** —
  **rejected.** Gating `FlowTrendsSection` / `ConceptIntelligenceSection` /
  `VisaFamiliesSection` behind an `IntersectionObserver` would break five live
  E2E tests in `tests/e2e/react/test_react_concept_intelligence.py`
  (`test_effectiveness_chart_visible`, `test_cooccurrence_heatmap_visible`,
  `test_trend_chart_visible`, `test_emerging_badges_visible`,
  `test_no_js_errors`), every one of which asserts those charts are visible
  right after `wait_for_loading_gone()` with no scroll. The legal-concepts
  dedupe (Step 6) delivers the verified, zero-risk part of this finding; the
  deferral needs an E2E redesign and should be planned with it.
- **FEPERF-09, as originally specified** — **corrected, and implemented in a
  narrower form.** Switching the whole dual view from CSS to
  `useMediaQuery` would (a) contradict `CLAUDE.md:294`, which names this exact
  pattern the app-wide standard responsive-table convention, and (b) break
  `tests/e2e/react/test_react_responsive.py:101-105`, which asserts
  `.overflow-x-auto` is in the DOM at a 390 px viewport — and `CasesTable.tsx:78`
  is that class's only source on the Cases page. Step 5 therefore removes only
  the desktop-side waste (the ~100 `CaseCard` subtrees) and leaves mobile
  byte-identical. Also dropped from the original write-up: the claim that the
  dual render slows `tableRef.current.children[idx]` at `CasesPage.tsx:314`.
  It does not — `tableRef` is typed `useRef<HTMLTableSectionElement>(null)`
  (`CasesPage.tsx:46`) and attached to `<tbody>` (`CasesTable.tsx:121`), so the
  card grid is a sibling `<div>` and that lookup is unaffected.

### Line-number corrections made while verifying

- FEPERF-02: `useSearchCases` is defined at `frontend/src/hooks/use-cases.ts:88-95`
  (reported as `:90`). The Worker's short-query rejection is at
  `workers/case-api/cloudflare.js:195` — confirmed exactly. The
  `JudgeAutocomplete` debounce is at `:36-52` (reported as `:45` / `:40-53`).
- FEPERF-07: `sortedCourts` is at `frontend/src/pages/DashboardPage.tsx:462`
  — reported variously as `:461` and `:463`; both were off by one. Also,
  `TrendChart` is memoised but is **not** imported by `DashboardPage.tsx`
  (imports at `:28-31` are `CourtChart`, `NatureChart`, `CourtSparklineGrid`,
  `SubclassChart`), so the defeated memos number **four** components across
  seven call sites, not five components.
- FEPERF-08: the Analytics page has **15** query-hook call sites resolving to
  **14** distinct requests, not 14/13 as reported. `SuccessRateCalculator`
  makes four, not three: `useFilterOptions()` (`:40-41`), `useOutcomes(filters)`
  (`:42`), `useLegalConcepts(filters, 18)` (`:43-44`) and
  `useSuccessRate(successParams)` (`:56-57`, ungated — it fires on mount).
  The duplication mechanism is otherwise exactly as reported.
- FEPERF-03: all cited locations verified verbatim. The `matches` block runs
  `:217-229` (`:217` is the `// Find all matches` comment, `:218` the
  `const matches = useMemo(() => {` line); `rendered` is `:317-364`;
  `return renderSmartLines(text);` is `:363`; the un-debounced `onChange` is
  `:381-384`; the match counter is `:391-395`.
