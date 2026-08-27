# Plan 016: Fix stale-data bleed, query keys and CSRF token lifetime

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, report the new status for this plan's
> row in `plans/README.md`. **That file now exists** (it was created after this
> plan was written) and all four of plans 015–018 touch adjacent rows of the
> same status table, so **do not edit it yourself when running in parallel** —
> report your row and let the integration coordinator write it. Edit it only if
> you are running this plan alone.
>
> Every path in this file is relative to the repository root
> `/Users/d/Developer/Active Projects/IMMI-Case-`. The directory name contains
> a space and a trailing hyphen, so **always quote it** in shell commands.
>
> **Drift check (run first)**:
>
> `git diff 42826a3..HEAD` is blind to uncommitted, staged and untracked work,
> so on a dirty tree it hands you a false all-clear. Run **all four**:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> SCOPE='frontend/src/hooks/use-judges.ts
> frontend/src/hooks/use-stats.ts
> frontend/src/hooks/use-cases.ts
> frontend/src/hooks/use-bookmarks.ts
> frontend/src/lib/api.ts'
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $SCOPE          # committed drift
> git diff --stat -- $SCOPE                        # unstaged drift
> git diff --cached --stat -- $SCOPE               # staged drift
> git status --porcelain=v1 -uall > /tmp/immi-016-baseline-status.txt
> ```
>
> Expected: the three `git diff` commands print nothing and no in-scope path
> appears in `git status`. If **any** in-scope file appears anywhere, treat it as
> a STOP condition: compare the "Current state" excerpts below against the live
> code and report before proceeding.
>
> **Never run `git checkout --` or `git clean -f` to "clean" the tree** — that
> destroys the operator's or a parallel agent's uncommitted work. Report and
> stop. Keep `/tmp/immi-016-baseline-status.txt`; Step 7 diffs against it so
> pre-existing dirt is not mistaken for your output.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md`
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

Why the dependency: this plan adds three files under `frontend/__tests__/`.
At `42826a3` that directory is in **no** TypeScript project, so nothing type-checks
it (`frontend/tsconfig.json` has `files: []` plus project references, and
`frontend/tsconfig.app.json` has `include: ["src"]`). Plan 001 creates
`frontend/tsconfig.test.json` and wires `frontend/__tests__` into the build, which
is what makes the new test files compile-checked rather than silently untyped.
This plan's own verification commands do **not** require plan 001 — they work
as written at `42826a3` — so if plan 001 is blocked you may still run this plan,
but say so in your report.

### Sequencing — read before dispatching this plan in parallel

- **`frontend/src/hooks/use-cases.ts` is shared with
  `plans/017-fix-frontend-async-and-navigation.md`.** This plan **writes** one
  line to it (Step 5). 017 only **reads** it, but 017's drift check originally
  listed it as a hard STOP-on-any-change, which would have blocked 017 for no
  reason the moment this plan committed. 017 has been revised to treat its
  read-only references as *re-verify*, not *stop*. Either order works now; if
  you land Step 5 first, tell whoever runs 017 so they re-read the excerpt.
- **Steps 1 and 2 must land as ONE commit.** The Step 1 test file imports
  `analyticsFilterKey`, which Step 2 creates. Committing Step 1 alone leaves a
  tree whose `frontend/__tests__/` does not compile — and once
  `plans/001-restore-the-frontend-compile-gate.md` has landed, `__tests__/` is
  inside the `tsc -b` project, so that is a genuinely broken commit, not a
  cosmetic one. Do the two steps back to back and commit once:
  `fix: key analytics queries on every wire filter and stop judge identity bleed`.
- **Do not edit `plans/README.md`** while running in parallel (see the executor
  instructions above).

## Why this matters

Five independent correctness defects live in the React SPA's data layer, and
all five are cheap to fix in one pass because they sit in four hook files and
one API module.

1. The judge detail page can render one judge's name, photo and biography on
   top of another judge's statistics — a mis-attribution defect in a product
   whose primary user is a self-representing immigration applicant deciding
   how to argue their case. Attributing a decision record to the wrong
   decision-maker is the worst class of error this product can make.
2. Every non-GET request (create/update/delete a case, batch tagging, guided
   search, LLM Council turns) breaks permanently on any browser tab left open
   for more than one hour, and stays broken until the user reloads the page —
   because the client caches the CSRF token for the tab's lifetime while the
   server expires it after 60 minutes, and there is no recovery path.
3. If the CSRF endpoint ever fails, the client silently sends the literal
   string `undefined` as its CSRF header, turning a clear server
   misconfiguration into a confusing 403.
4. The dashboard's `stats` / `trends` query keys omit three of the six filter
   fields the request actually puts on the wire, so TanStack Query's in-memory
   cache and the module's own `localStorage` cache disagree about what
   identifies a result. Latent today, wrong the moment anyone wires the
   existing advanced filters into the dashboard.
5. One malformed `immi-bookmarks` value in `localStorage` crashes every page
   that reads bookmarks, and — because the value is re-read on every load —
   the crash is permanent until the user clears site data.

After this plan lands: a judge page never shows another judge's identity; a
stale CSRF token self-heals with exactly one replay; a broken CSRF endpoint
fails loudly; analytics query keys are derived from the same normalised filter
object as the `localStorage` cache key, so the two can never disagree; and a
corrupt bookmarks blob degrades to an empty bookmark list instead of a white
screen.

## Current state

### Files in play

| File | Role |
|---|---|
| `frontend/src/hooks/use-judges.ts` | Four TanStack Query hooks for judge data. Two of them are identity-keyed (one judge) and wrongly use a list affordance. |
| `frontend/src/hooks/use-stats.ts` | `useStats` / `useTrends` — the dashboard's two queries. Their query keys omit three filter fields. |
| `frontend/src/hooks/use-cases.ts` | Case list/count/detail hooks. `useCaseCount` is the only list-shaped query here missing `placeholderData`. |
| `frontend/src/hooks/use-bookmarks.ts` | `useSyncExternalStore`-backed bookmark store persisted to `localStorage` under the key `immi-bookmarks`. Parses stored JSON with no shape validation. |
| `frontend/src/lib/api.ts` | The CSRF-aware `fetch` wrapper plus every REST call. Holds the module-level CSRF token cache, the dashboard `localStorage` cache key builder, and the filter → query-string builders. |

### `frontend/src/hooks/use-judges.ts:37-74` (verbatim)

```ts
export function useJudgeProfile(
  name: string,
  params: { yearFrom?: number; yearTo?: number } = {},
) {
  return useQuery({
    queryKey: ["judges", "profile", name, params.yearFrom, params.yearTo],
    queryFn: () => fetchJudgeProfile(name, params),
    enabled: !!name,
    retry: 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useJudgeCompare(
  names: string[],
  params: { yearFrom?: number; yearTo?: number } = {},
) {
  return useQuery({
    queryKey: ["judges", "compare", ...names, params.yearFrom, params.yearTo],
    queryFn: () => fetchJudgeCompare(names, params),
    enabled: names.length >= 2,
    retry: 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useJudgeBio(name: string) {
  return useQuery({
    queryKey: ["judges", "bio", name],
    queryFn: () => fetchJudgeBio(name),
    enabled: !!name,
    retry: 0,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}
```

`placeholderData: keepPreviousData` at line **47** (`useJudgeProfile`) and line
**72** (`useJudgeBio`) is the defect. `keepPreviousData` is a pagination /
filter-change affordance: it keeps the *previous key's* data visible while the
new key loads. On an identity-keyed query the "previous key" is a **different
judge**.

The only consumer is `frontend/src/pages/JudgeDetailPage.tsx` (do **not** edit
that file; it is listed as out of scope). Its guard at lines 41-47 is:

```tsx
  const { data, isLoading, isError, error, refetch } =
    useJudgeProfile(decodedName);
  const { data: bioData, isLoading: bioLoading } = useJudgeBio(decodedName);

  if (isLoading) {
    return <PageLoader />;
  }
```

In TanStack Query v5 `isLoading` is `isPending && isFetching`, and a query
holding placeholder data is **not** pending — so this guard is bypassed while
placeholder data is present. Lines 104-107 then pass both payloads straight
through with no `isPlaceholderData` check:

```tsx
      <JudgeHero
        profile={data}
        bio={bioData ?? { found: false }}
        isLoading={bioLoading}
      />
```

and `frontend/src/components/judges/JudgeHero.tsx:72-73` and `:77` let the
stale `bio` override the fresh `profile`'s identity:

```tsx
  const displayName =
    bio.found && bio.full_name ? bio.full_name : profile.judge.name;
```
```tsx
  const hasPhoto = bio.found && bio.photo_url && !imgError;
```

**Correction to the original report** (verified while writing this plan): the
mixed render requires `JudgeDetailPage` to stay **mounted** while the `:name`
route param changes. No in-app link does that — `grep -rn "judge-profiles/"
frontend/src` returns only `App.tsx` route definitions, `JudgeAutocomplete.tsx:58`,
`JudgeProfilesPage.tsx:92`/`:96`, `GuidedSearchPage.tsx:165` and a URL built in
`lib/api.ts:1129-1131`, none of which live on the detail page; and no component
under `frontend/src/components/judges/` links to another judge at all. Going
judge A → leaderboard → judge B unmounts the page, so the remount correctly
shows `PageLoader`. The reachable triggers are **browser back/forward between
two adjacent judge-detail history entries** and **editing the URL by hand**.
The defect is real and worth fixing; its exposure is narrower than "any
navigation between judges".

### `frontend/src/hooks/use-stats.ts` (verbatim, whole file)

```ts
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { fetchStats, fetchTrends } from "@/lib/api";
import type { AnalyticsFilterParams } from "@/types/case";

export function useStats(filters?: AnalyticsFilterParams) {
  return useQuery({
    queryKey: ["stats", filters?.court, filters?.yearFrom, filters?.yearTo],
    queryFn: () => fetchStats(filters),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useTrends(filters?: AnalyticsFilterParams) {
  return useQuery({
    queryKey: ["trends", filters?.court, filters?.yearFrom, filters?.yearTo],
    queryFn: () => fetchTrends(filters),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
```

`AnalyticsFilterParams` has **six** fields (`frontend/src/types/case.ts:117-124`):

```ts
export interface AnalyticsFilterParams {
  court?: string;
  yearFrom?: number;
  yearTo?: number;
  caseNatures?: string[];
  visaSubclasses?: string[];
  outcomeTypes?: string[];
}
```

`fetchStats` (`frontend/src/lib/api.ts:294-323`) and `fetchTrends` (`:325-342`)
both build their URL through `buildFilterParams` (`:265-276`), which calls
`appendAdvancedFilters` (`:252-263`) and **does** put the three missing fields
on the wire:

```ts
function appendAdvancedFilters(
  params: URLSearchParams,
  filters?: AnalyticsFilterParams,
): void {
  if (!filters) return;
  if (filters.caseNatures?.length)
    params.set("case_natures", filters.caseNatures.join(","));
  if (filters.visaSubclasses?.length)
    params.set("visa_subclasses", filters.visaSubclasses.join(","));
  if (filters.outcomeTypes?.length)
    params.set("outcome_types", filters.outcomeTypes.join(","));
}
```

And the `localStorage` layer for the *same* call already keys on all six —
`frontend/src/lib/api.ts:193-206` (find it by the function name
`buildDashboardCacheKey` if the numbers have shifted):

```ts
function buildDashboardCacheKey(
  baseKey: string,
  filters?: AnalyticsFilterParams,
): string {
  const keyObject = {
    court: filters?.court ?? "",
    yearFrom: filters?.yearFrom ?? 0,
    yearTo: filters?.yearTo ?? 0,
    caseNatures: (filters?.caseNatures ?? []).slice().sort(),
    visaSubclasses: (filters?.visaSubclasses ?? []).slice().sort(),
    outcomeTypes: (filters?.outcomeTypes ?? []).slice().sort(),
  };
  return `${baseKey}:${JSON.stringify(keyObject)}`;
}
```

Today the only callers are `frontend/src/pages/DashboardPage.tsx:127-128`
(whose `filters` memo at `:115-118` yields exactly `{court, yearFrom, yearTo}`)
and `frontend/src/pages/DataToolsPage.tsx:79` (no arguments), so nothing is
stale in production yet. This is a latent defect: the first person to feed the
existing advanced filters into the dashboard gets the unfiltered payload from
the memory cache and the correct one from `localStorage`.

A correct six-field key helper already exists in a sibling file,
`frontend/src/hooks/use-analytics.ts:18-25` — but it is **not exported**, and
`frontend/src/hooks/use-analytics.ts` is out of scope for this plan:

```ts
const filterKey = (f?: AnalyticsFilterParams) => [
  f?.court,
  f?.yearFrom,
  f?.yearTo,
  f?.caseNatures?.join(","),
  f?.visaSubclasses?.join(","),
  f?.outcomeTypes?.join(","),
];
```

This plan therefore creates the shared source of truth in `lib/api.ts`, next to
`buildFilterParams`/`buildDashboardCacheKey` — the two functions it must mirror.

### `frontend/src/lib/api.ts` — CSRF token lifetime

Line **29**, the module-level cache:

```ts
let csrfToken: string | null = null;
```

Lines **48-54**, the reader — no `res.ok` check, and a non-null assertion on a
value that can be `undefined`:

```ts
async function fetchCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await fetch("/api/v1/csrf-token", { credentials: "include" });
  const data = await res.json();
  csrfToken = data.csrf_token;
  return csrfToken!;
}
```

Lines **109-111**, the only caller:

```ts
  if (requestOptions.method && requestOptions.method !== "GET") {
    headers["X-CSRFToken"] = await fetchCsrfToken();
  }
```

Lines **154-162**, the error path — no 403 handling of any kind:

```ts
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(
      error.error || `API error: ${res.status}`,
      res.status,
      error.code,
    );
  }

  return res.json();
```

Lines **1399-1402**, a purpose-built invalidator with **zero callers**
(`grep -rn "clearCsrfToken" frontend workers tests` returns only this
definition):

```ts
// ─── Invalidate CSRF (call on auth errors) ─────────────────────
export function clearCsrfToken(): void {
  csrfToken = null;
}
```

**Correction to the original report**: the token is *not* bound to a user,
tenant or session, so login/logout/switch-tenant do **not** need to rotate it.
`workers/auth/csrf.js:19-33` (`getCsrfToken`) mints a stateless double-submit
token — 16 random bytes plus an expiry, HMAC-signed with `CSRF_SECRET`,
mirrored into a `__Host-csrf` cookie — and `verifyCsrf` (`:35-49`) only checks
header === cookie, expiry, and signature. The live trigger is purely the TTL,
`workers/auth/csrf.js:1`:

```js
const CSRF_TTL_MS = 60 * 60 * 1000;
```

The cookie's `Max-Age` matches (`workers/auth/csrf.js:29`), so after one hour
both halves are gone while the client still holds its cached token forever.
`verifyCsrf` returns HTTP **403** with `code: "csrf_expired"` when the payload
expiry has passed (`:46`) and `code: "csrf"` when header and cookie disagree —
which is what a vanished cookie produces (`:39`). Those two codes are the exact
retry signal. Every CSRF-guarded write path uses this one verifier
(`workers/case-api/cloudflare_mutations.js:65`,
`workers/case-api/cloudflare_actions.js:42`,
`workers/pipeline/control_handlers.js:46`).

The other 403s in the Worker carry different codes and must **not** be retried:
`admin_auth_disabled`, `admin_required` (`workers/admin/cloudflare_handlers.js:15`,
`:21`), `operator_role_required` (`workers/pipeline/control_handlers.js:53`),
`forbidden` (`workers/auth/handlers.js:692`, `:711`). A missing `CSRF_SECRET`
returns **503**, not 403, so a status check already excludes it.

Every mutation body in `lib/api.ts` is a `JSON.stringify(...)` **string**
(lines 606, 617, 633, 678, 738, 847, 1114, 1293, 1327) — there is no `FormData`
and no `ReadableStream` anywhere in the module, so replaying a request is safe.

### `frontend/src/hooks/use-cases.ts:24-60` (verbatim)

```ts
export function useCases(
  filters: CaseFilters,
  options?: Omit<
    UseQueryOptions<Awaited<ReturnType<typeof fetchCases>>>,
    "queryKey" | "queryFn"
  >,
) {
  const query = useQuery({
    queryKey: ["cases", filters],
    queryFn: () => fetchCases(filters),
    staleTime: 10_000,
    placeholderData: keepPreviousData,
    ...options,
  });

  return {
    ...query,
    /** Opaque cursor token for the next page, or null if there are no more pages. */
    nextCursor: query.data?.next_cursor ?? null,
  };
}

export function useCaseCount(
  filters: CaseFilters,
  countMode: CaseCountMode = "planned",
  options?: Omit<
    UseQueryOptions<Awaited<ReturnType<typeof fetchCaseCount>>>,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: ["cases-count", filters, countMode],
    queryFn: () => fetchCaseCount(filters, countMode),
    staleTime: 60_000,
    ...options,
  });
}
```

`useCaseCount` is filter-keyed exactly like its neighbour `useCases` but omits
`placeholderData: keepPreviousData`, breaking the documented convention. Its
only caller today is `frontend/src/components/saved-searches/SavedSearchCard.tsx:28-36`,
which passes a per-card constant (`search.filters` from a saved search) plus
`refetchOnMount: false` and `staleTime: 120_000` — so the key never changes and
nothing blanks in production yet. This is convention alignment, not a live bug.

### `frontend/src/hooks/use-bookmarks.ts:9-23` (verbatim)

```ts
const STORAGE_KEY = "immi-bookmarks";

// ── Read ──────────────────────────────────────────────────────────
function readFromStorage(): BookmarksState {
  if (typeof window === "undefined") return { bookmarks: [], collections: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { bookmarks: [], collections: [] };
  } catch {
    return { bookmarks: [], collections: [] };
  }
}

// ── External Store ────────────────────────────────────────────────
let _state: BookmarksState = readFromStorage();
```

`JSON.parse(raw)` is returned straight as `BookmarksState` with only a
syntax-error catch. Line 23 runs it at **module-import time**, and every
consumer dereferences the result unconditionally — e.g. line 206:

```ts
    (case_id: string) => state.bookmarks.some((b) => b.case_id === case_id),
```

and every mutation helper (`cur.bookmarks`, `cur.collections`, lines 50, 64-68,
99, 110, 122, 133, 152, 173, 189). A stored value of `null`, `[]`, `42`,
`"text"` or `{"bookmarks":[]}` makes all of these throw during render.

The app itself can never write a bad shape (`setState` always serialises a
well-formed object), so the trigger is external: a browser extension, a hand
edit, a quota-truncated write, or a future schema change. This is defensive
hardening rather than a live defect — but it is cheap, and the repo already has
the exemplar to copy.

**The exemplar to match** — `frontend/src/lib/saved-searches.ts:57-74`:

```ts
export function loadSavedSearches(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);

    // Validate that it's an array
    if (!Array.isArray(parsed)) {
      console.warn(VALIDATION_ERRORS.CORRUPTED_DATA);
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }

    // Filter out invalid entries and limit to MAX_SAVED_SEARCHES
    const valid = parsed
      .filter(isValidSavedSearch)
      .slice(0, MAX_SAVED_SEARCHES);
```

and its per-item guard, `frontend/src/lib/saved-searches.ts:21-35`:

```ts
function isValidSavedSearch(obj: unknown): obj is SavedSearch {
  if (!obj || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;

  return (
    typeof s.id === "string" &&
    s.id.length > 0 &&
    typeof s.name === "string" &&
    s.name.length > 0 &&
    typeof s.filters === "object" &&
    s.filters !== null &&
    typeof s.createdAt === "string" &&
    (s.lastExecutedAt === undefined || typeof s.lastExecutedAt === "string") &&
    (s.resultCount === undefined || typeof s.resultCount === "number")
  );
}
```

The types being validated — `frontend/src/types/bookmarks.ts` (whole file):

```ts
export type CollectionColor =
  | "blue"
  | "green"
  | "amber"
  | "rose"
  | "purple"
  | "slate";

export interface BookmarkEntry {
  case_id: string;
  case_title: string;
  case_citation: string;
  court_code: string;
  date: string;
  note: string;
  bookmarked_at: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  tags: string[];
  case_order: string[];
  case_notes: Record<string, string>;
  created_at: string;
  updated_at: string;
  color?: CollectionColor;
}

export interface BookmarksState {
  bookmarks: BookmarkEntry[];
  collections: Collection[];
}
```

All of `BookmarkEntry`'s fields and all of `Collection`'s non-optional fields
are always written by the current code (`addBookmark` sets `note: ""` and
`bookmarked_at`; `createCollection` sets every field), so validating them
strictly cannot drop a legitimate entry.

### Repo conventions this plan must honour

Quoted from `CLAUDE.md` (the executor has not read it):

- "**Use `.toSorted()` not `.sort()`** — never mutate arrays in React;
  `.toSorted()` returns a new array (ES2023, requires `"lib": ["ES2023"]` in
  `frontend/tsconfig.app.json`)." — confirmed: `frontend/tsconfig.app.json`
  has `"lib": ["ES2023", "DOM", "DOM.Iterable"]`, and `.toSorted()` is already
  used at `frontend/src/components/dashboard/TrendChart.tsx:47` and four other
  places.
- "**localStorage must be try-catch wrapped** — all
  `localStorage.getItem/setItem/removeItem` calls are wrapped in try-catch;
  throws in incognito/private mode and when quota exceeded."
- "**TanStack Query navigation flash** — use `keepPreviousData` in all
  filter-dependent hooks to prevent empty state flash during rapid page
  switching." Note the qualifier **filter-dependent**: this plan *adds* it to a
  filter-keyed hook (`useCaseCount`) and *removes* it from two identity-keyed
  hooks (`useJudgeProfile`, `useJudgeBio`). Those are not in conflict.
- "**i18n defaultValue pattern** — always use
  `t("key", { defaultValue: "English text" })` for UI text." — this plan adds
  no UI text, so no new i18n keys are needed.
- "all spacing/shadow/radius/colour values come from
  `frontend/src/tokens/tokens.json` — no magic numbers" — this plan touches no
  styling.
- TypeScript strictness is on: `frontend/tsconfig.app.json` sets
  `"strict": true`, `"noUnusedLocals": true`, `"noUnusedParameters": true`,
  `"verbatimModuleSyntax": true`. Type-only imports must use
  `import type { ... }`.

### Baseline at `42826a3` (re-verified while writing this plan)

| Command | Result |
|---|---|
| `cd frontend && npx tsc -b --noEmit` | exit 0 |
| `cd frontend && npx vitest run` | 55 files, 490 tests, all pass |
| `cd frontend && npx eslint .` | **0 errors**, 25 warnings |

Those two numbers are the state at `42826a3` **only**, recorded for context.
They are *not* the gate: plans 015, 017 and 018 add tests to the same suite, so
by the time you run, the totals will legitimately differ. Take your own
`BEFORE_TESTS` / `BEFORE_FILES` / `BEFORE_WARNINGS` during the drift check and
assert a **delta** (Step 7). Never assert an absolute suite total — it makes
parallel execution impossible and teaches the next executor to edit the
yardstick instead of the code.

The 25 warnings are pre-existing (unused `eslint-disable` directives and unused
vars); one of them is at `frontend/src/hooks/use-bookmarks.ts:154`. Do not
"fix" them — this plan's bar is *no new errors and no new warnings*.

**Do not use `make typecheck` as your gate.** `Makefile:95-96` runs
`cd frontend && npx tsc --noEmit`, which exits 0 while loading **zero** files
(`frontend/tsconfig.json` is project-references-only with `files: []`). Use
`npx tsc -b --noEmit`, which really compiles the 169 source files.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Drift check | the four-command block in the Executor instructions (committed + unstaged + staged + `git status`) | no in-scope path listed anywhere |
| Typecheck (real) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit` | exit 0, no output |
| Frontend tests (all) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` | `0 failed`, and `AFTER_TESTS == BEFORE_TESTS + 28` / `AFTER_FILES == BEFORE_FILES + 3` |
| One test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run <path>` | the per-file count named in that step — **the stable unit under parallel execution** |
| One test by name | `cd "…/frontend" && npx vitest run <path> -t "<test name>"` | exit 0, `1 passed` |
| Lint | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx eslint .` | `0 errors`, warnings ≤ your recorded `BEFORE_WARNINGS` |
| **Production build** | `cd "…/frontend" && npm run build:cloudflare` | exit 0 — writes `frontend/dist`, which `wrangler.toml:15` serves |

`@typescript-eslint/no-unused-vars` is configured as an **error**
(`frontend/eslint.config.js:24-28`), and the Step 1 test scaffold declares mocks
(`mockFetchStats`, `mockFetchCaseCount`) and helpers (`makeStats`) that only get
used once Steps 2 and 5 land. Run `npx eslint .` **once, at Step 7** — not
between steps.
| Files changed | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only in-scope paths |

`npx tsc -b` writes `frontend/node_modules/.tmp/*.tsbuildinfo`; that path is
inside `node_modules` and is not tracked by git.

## Suggested executor toolkit

- The structural model for the hook tests is
  `frontend/__tests__/use-llm-council-sessions.test.ts` — a `.ts` (not `.tsx`)
  file that uses `renderHook` from `@testing-library/react` with a
  `QueryClientProvider` wrapper built via `React.createElement`, and
  `vi.mocked(...)` for typed mocks. Read its first 60 lines before writing
  Step 1's test.
- The structural model for the plain `fetch`-mocking tests is
  `frontend/__tests__/dashboard-api-fallback.test.ts` and
  `frontend/__tests__/use-cases-cursor.test.ts` — both define a local
  `jsonResponse<T>(data): Response` helper and use `vi.stubGlobal("fetch", …)`.
- `frontend/__tests__/legislations-setup.ts` is a **global** setup file applied
  to every test: it mocks `ResizeObserver`, `IntersectionObserver`,
  `window.scrollTo`, `window.localStorage` (an in-memory store with
  `getItem`/`setItem`/`removeItem`/`clear`), and `react-i18next`'s
  `useTranslation`. You do not need to mock any of those yourself.

## Scope

**In scope** (the only files you may modify or create):

- `frontend/src/hooks/use-judges.ts` (modify — Step 1)
- `frontend/src/lib/api.ts` (modify — Steps 2, 3, 4)
- `frontend/src/hooks/use-stats.ts` (modify — Step 2)
- `frontend/src/hooks/use-cases.ts` (modify — Step 5)
- `frontend/src/hooks/use-bookmarks.ts` (modify — Step 6)
- `frontend/__tests__/query-cache-correctness.test.ts` (**create** — Steps 1, 2, 5)
- `frontend/__tests__/api-csrf-lifecycle.test.ts` (**create** — Steps 3, 4)
- `frontend/__tests__/use-bookmarks-storage.test.ts` (**create** — Step 6)

**Out of scope** (do NOT touch, even though they look related):

- `frontend/src/pages/JudgeDetailPage.tsx` and
  `frontend/src/components/judges/JudgeHero.tsx`. Removing the placeholder from
  the two hooks makes `isLoading` true again on a name change, so the existing
  `if (isLoading) return <PageLoader />;` guard at `JudgeDetailPage.tsx:45`
  becomes sufficient on its own. Adding an `isPlaceholderData` check or
  threading `decodedName` into `JudgeHero` would be dead code after Step 1.
- `frontend/src/hooks/use-analytics.ts`. Its private `filterKey` helper
  (`:18-25`) is already correct; migrating its twelve hooks onto the new shared
  helper is a follow-up, not part of this plan. Editing it would also collide
  with any plan that owns the analytics hooks.
- `frontend/src/hooks/use-llm-council-sessions.ts`. See "Findings
  reconsidered".
- `frontend/src/contexts/AuthContext.tsx` and
  `frontend/src/pages/LegislationsPage.tsx`. Both carry real but unrelated
  defects recorded under "Findings reconsidered"; both are outside this plan's
  file territory and editing them risks a collision with a parallel plan.
- `frontend/src/hooks/use-judges.ts`'s `useJudgeLeaderboard` (line 33) and
  `useJudgeCompare` (line 61). Both are genuinely list-shaped —
  `useJudgeCompare`'s key is a *set* of judges that the compare page mutates
  while mounted — so `keepPreviousData` is correct there. Leave both alone.
- `frontend/vitest.config.ts`, `frontend/tsconfig*.json`, `Makefile`,
  `.github/workflows/ci.yml`. The broken `make typecheck` target and the
  Vitest `include` glob belong to other plans.
- `workers/auth/csrf.js` and everything else under `workers/`. The one-hour
  `CSRF_TTL_MS` is a deliberate server-side policy; this plan makes the client
  survive it rather than changing it.
- Any change to a public API response shape or to `frontend/src/types/*`.

## Git workflow

- Branch: `git checkout -b advisor/016-fix-query-cache-correctness` (branch
  from `main`; the repo's default and main branch are both `main`).
- Commit per step. Message style is conventional commits,
  `<type>: <description>` with type in `feat|fix|refactor|docs|test|chore|perf|ci`.
  Real example from `git log`: `fix: install root node_modules in make install`.
- **No AI attribution lines, no `Co-Authored-By` trailers.** Attribution is
  disabled globally for this repo.
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and ships.

## Steps

### Step 1: Stop the judge detail page from showing a previous judge's identity

**1a.** Edit `frontend/src/hooks/use-judges.ts`. Delete the line
`    placeholderData: keepPreviousData,` from **`useJudgeProfile`** (line 47)
and from **`useJudgeBio`** (line 72). Leave the identical lines inside
`useJudgeLeaderboard` (line 33) and `useJudgeCompare` (line 61) untouched, and
leave the `keepPreviousData` import on line 1 in place — those two hooks still
use it.

After the edit `useJudgeProfile` must read exactly:

```ts
export function useJudgeProfile(
  name: string,
  params: { yearFrom?: number; yearTo?: number } = {},
) {
  return useQuery({
    queryKey: ["judges", "profile", name, params.yearFrom, params.yearTo],
    queryFn: () => fetchJudgeProfile(name, params),
    enabled: !!name,
    retry: 0,
    staleTime: 5 * 60_000,
  });
}
```

and `useJudgeBio`:

```ts
export function useJudgeBio(name: string) {
  return useQuery({
    queryKey: ["judges", "bio", name],
    queryFn: () => fetchJudgeBio(name),
    enabled: !!name,
    retry: 0,
    staleTime: 10 * 60_000,
  });
}
```

**1b.** Create `frontend/__tests__/query-cache-correctness.test.ts` (a `.ts`
file — build React elements with `React.createElement`, not JSX). Start it with
this exact scaffold, then add the two tests below:

```ts
/**
 * frontend/__tests__/query-cache-correctness.test.ts
 *
 * Regression tests for TanStack Query cache identity in the SPA data layer:
 *   - identity-keyed judge queries must NOT reuse the previous judge's payload
 *   - analytics query keys must cover every filter field that reaches the wire
 *   - filter-keyed list/count queries must keep previous data (anti-flash)
 */
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type {
  AnalyticsFilterParams,
  DashboardStats,
  JudgeBio,
  JudgeProfile,
} from "@/types/case";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchJudgeProfile: vi.fn(),
    fetchJudgeBio: vi.fn(),
    fetchStats: vi.fn(),
    fetchCaseCount: vi.fn(),
  };
});

import * as api from "@/lib/api";
import { analyticsFilterKey } from "@/lib/api";
import { useJudgeProfile, useJudgeBio } from "@/hooks/use-judges";
import { useStats } from "@/hooks/use-stats";
import { useCaseCount } from "@/hooks/use-cases";

const mockFetchJudgeProfile = vi.mocked(api.fetchJudgeProfile);
const mockFetchJudgeBio = vi.mocked(api.fetchJudgeBio);
const mockFetchStats = vi.mocked(api.fetchStats);
const mockFetchCaseCount = vi.mocked(api.fetchCaseCount);

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

/** A promise that never settles — models a request still in flight. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

function makeProfile(name: string): JudgeProfile {
  return {
    judge: {
      name,
      total_cases: 10,
      courts: ["FCA"],
      active_years: { first: 2010, last: 2024 },
    },
    approval_rate: 40,
    court_type: "court",
    outcome_distribution: {},
    visa_breakdown: [],
    concept_effectiveness: [],
    yearly_trend: [],
    nature_breakdown: [],
    representation_analysis: { unknown_count: 0 },
    country_breakdown: [],
    court_comparison: [],
    recent_3yr_trend: [],
  };
}

function makeBio(fullName: string): JudgeBio {
  return { found: true, full_name: fullName, photo_url: "https://example.test/a.jpg" };
}

function makeStats(total: number): DashboardStats {
  return {
    total_cases: total,
    with_full_text: 0,
    courts: {},
    years: {},
    natures: {},
    visa_subclasses: {},
    sources: {},
    recent_cases: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
```

Then add these two tests (note the assertion **order**: wait for the second
fetch call first, so the test fails fast rather than timing out when the fix is
absent):

```ts
describe("useJudgeProfile / useJudgeBio — identity-keyed queries", () => {
  it("does not serve the previous judge's profile while a new judge loads", async () => {
    mockFetchJudgeProfile
      .mockResolvedValueOnce(makeProfile("Smith"))
      .mockImplementationOnce(() => pending<JudgeProfile>());

    const { result, rerender } = renderHook(
      ({ name }: { name: string }) => useJudgeProfile(name),
      { wrapper: makeWrapper(), initialProps: { name: "Smith" } },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.judge.name).toBe("Smith");

    rerender({ name: "Jones" });

    await waitFor(() =>
      expect(mockFetchJudgeProfile).toHaveBeenCalledTimes(2),
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });

  it("does not serve the previous judge's biography while a new judge loads", async () => {
    mockFetchJudgeBio
      .mockResolvedValueOnce(makeBio("Justice Smith"))
      .mockImplementationOnce(() => pending<JudgeBio>());

    const { result, rerender } = renderHook(
      ({ name }: { name: string }) => useJudgeBio(name),
      { wrapper: makeWrapper(), initialProps: { name: "Smith" } },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    rerender({ name: "Jones" });

    await waitFor(() => expect(mockFetchJudgeBio).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();
  });
});
```

This file will not compile until Step 2 adds `analyticsFilterKey`. That is
expected — run the file-level verification below with the whole file present
only after Step 2, and for **this** step verify with `git diff` instead:

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff -- frontend/src/hooks/use-judges.ts | grep -c '^-    placeholderData: keepPreviousData,'`
→ prints `2`

and
`cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -c 'placeholderData: keepPreviousData' frontend/src/hooks/use-judges.ts`
→ prints `2`

### Step 2: Give the analytics query key one source of truth with the localStorage cache key

**2a.** Edit `frontend/src/lib/api.ts`. Replace the whole `buildDashboardCacheKey`
function (currently at lines 193-206) with the three declarations below, keeping
them in this order and at the same place in the file:

```ts
interface NormalizedAnalyticsFilters {
  court: string;
  yearFrom: number;
  yearTo: number;
  caseNatures: string[];
  visaSubclasses: string[];
  outcomeTypes: string[];
}

/**
 * Canonical identity of an analytics filter set: every field that
 * `buildFilterParams` / `appendAdvancedFilters` can put on the wire, with
 * array order normalised so `["a","b"]` and `["b","a"]` are one cache entry.
 *
 * Both the localStorage dashboard cache key and the TanStack Query key are
 * derived from this, so the two layers can never disagree about what
 * identifies a result. If you add a field to `AnalyticsFilterParams` and send
 * it in `appendAdvancedFilters`, add it here too.
 */
function normalizeAnalyticsFilters(
  filters?: AnalyticsFilterParams,
): NormalizedAnalyticsFilters {
  return {
    court: filters?.court ?? "",
    yearFrom: filters?.yearFrom ?? 0,
    yearTo: filters?.yearTo ?? 0,
    caseNatures: (filters?.caseNatures ?? []).toSorted(),
    visaSubclasses: (filters?.visaSubclasses ?? []).toSorted(),
    outcomeTypes: (filters?.outcomeTypes ?? []).toSorted(),
  };
}

/**
 * Stable TanStack Query key fragment for an analytics filter set.
 * Use this for every hook whose queryFn passes `filters` to a `fetch*`
 * helper that calls `buildFilterParams` / `appendAnalyticsFilters`.
 */
export function analyticsFilterKey(filters?: AnalyticsFilterParams): string {
  return JSON.stringify(normalizeAnalyticsFilters(filters));
}

function buildDashboardCacheKey(
  baseKey: string,
  filters?: AnalyticsFilterParams,
): string {
  return `${baseKey}:${JSON.stringify(normalizeAnalyticsFilters(filters))}`;
}
```

The property order inside `normalizeAnalyticsFilters` must stay exactly
`court, yearFrom, yearTo, caseNatures, visaSubclasses, outcomeTypes` — that is
the order `JSON.stringify` serialises, and changing it would orphan every
`immi:dashboard:*` entry already in users' `localStorage`. `.toSorted()`
produces the same array as the old `.slice().sort()`, so existing cache entries
keep matching.

**2b.** Rewrite `frontend/src/hooks/use-stats.ts` to this exact content:

```ts
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { analyticsFilterKey, fetchStats, fetchTrends } from "@/lib/api";
import type { AnalyticsFilterParams } from "@/types/case";

export function useStats(filters?: AnalyticsFilterParams) {
  return useQuery({
    queryKey: ["stats", analyticsFilterKey(filters)],
    queryFn: () => fetchStats(filters),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useTrends(filters?: AnalyticsFilterParams) {
  return useQuery({
    queryKey: ["trends", analyticsFilterKey(filters)],
    queryFn: () => fetchTrends(filters),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
```

The key still **starts with** `["stats"]` / `["trends"]`, so the prefix
invalidations in `frontend/src/hooks/use-cases.ts` (`qc.invalidateQueries({
queryKey: ["stats"] })` at lines 103, 131, 150) keep working unchanged. Do not
change those.

**2c.** Append to `frontend/__tests__/query-cache-correctness.test.ts`:

```ts
describe("analyticsFilterKey", () => {
  it("distinguishes filter sets that produce different query strings", () => {
    const base: AnalyticsFilterParams = {
      court: "FCA",
      yearFrom: 2020,
      yearTo: 2024,
    };
    const withNature: AnalyticsFilterParams = {
      ...base,
      caseNatures: ["Protection"],
    };
    const withVisa: AnalyticsFilterParams = {
      ...base,
      visaSubclasses: ["866"],
    };
    const withOutcome: AnalyticsFilterParams = {
      ...base,
      outcomeTypes: ["affirmed"],
    };

    const keys = [base, withNature, withVisa, withOutcome].map(
      analyticsFilterKey,
    );
    expect(new Set(keys).size).toBe(4);
  });

  it("ignores ordering inside array filters", () => {
    expect(analyticsFilterKey({ visaSubclasses: ["866", "500"] })).toBe(
      analyticsFilterKey({ visaSubclasses: ["500", "866"] }),
    );
  });

  it("treats undefined and empty filters as the same identity", () => {
    expect(analyticsFilterKey(undefined)).toBe(analyticsFilterKey({}));
  });
});

describe("useStats — query key covers every wire filter", () => {
  it("refetches when only an advanced filter changes", async () => {
    mockFetchStats
      .mockResolvedValueOnce(makeStats(149_016))
      .mockResolvedValueOnce(makeStats(12_000));

    const base: AnalyticsFilterParams = {
      court: "FCA",
      yearFrom: 2020,
      yearTo: 2024,
    };

    const { rerender } = renderHook(
      ({ filters }: { filters: AnalyticsFilterParams }) => useStats(filters),
      { wrapper: makeWrapper(), initialProps: { filters: base } },
    );

    await waitFor(() => expect(mockFetchStats).toHaveBeenCalledTimes(1));

    rerender({ filters: { ...base, caseNatures: ["Protection"] } });

    await waitFor(() => expect(mockFetchStats).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
  });
});
```

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit`
→ exit 0, no output

then
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/query-cache-correctness.test.ts`
→ `Test Files  1 passed (1)`, `Tests  6 passed (6)`

### Step 3: Make a failing CSRF-token request fail loudly instead of sending `undefined`

**A correction you must apply — the mint must be single-flight.** The Worker's
`getCsrfToken` mints a fresh random token **and mirrors it into the `__Host-csrf`
cookie via `Set-Cookie`** (`workers/auth/csrf.js:19-33`), and `verifyCsrf` only
accepts a request whose `X-CSRFToken` header equals that cookie (`:35-49`). The
naive `if (csrfToken) return csrfToken; … await fetch(…)` shape has no in-flight
dedup: two concurrent mutations (two open tabs' worth of work in one tab — a
batch tag plus a council turn, say) both see `csrfToken === null` and both mint.
The **second** `Set-Cookie` overwrites the cookie, so the first request's header
no longer matches it and the server 403s. Under the Step 4 retry that failure
then *re-mints again*, racing the other request a second time — so the "self
healing" path can convert a transient race into a repeated one. Hold a single
in-flight promise instead.

Add a second module-level cache line immediately below the existing
`let csrfToken: string | null = null;` (line 29):

```ts
/** In-flight mint, so concurrent mutations share one token and one Set-Cookie. */
let csrfTokenInFlight: Promise<string> | null = null;
/** Bumped on every successful mint; lets a caller prove its token is the stale one. */
let csrfTokenGeneration = 0;
```

Then replace `fetchCsrfToken` (currently lines 48-54) with:

```ts
async function mintCsrfToken(): Promise<string> {
  const res = await fetch("/api/v1/csrf-token", { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.error || `CSRF token request failed: ${res.status}`,
      res.status,
      body.code,
    );
  }
  const body = await res.json().catch(() => ({}));
  const token: unknown = body?.csrf_token;
  if (typeof token !== "string" || token.length === 0) {
    throw new ApiError(
      "CSRF token missing from /api/v1/csrf-token response",
      res.status,
      "csrf_token_missing",
    );
  }
  csrfToken = token;
  csrfTokenGeneration += 1;
  return token;
}

async function fetchCsrfToken(): Promise<{ token: string; generation: number }> {
  if (csrfToken) return { token: csrfToken, generation: csrfTokenGeneration };
  // Single-flight: the Worker's mint also rewrites the __Host-csrf cookie, so
  // two concurrent mints leave one caller holding a header that no longer
  // matches the cookie and gets a 403 it cannot distinguish from a real one.
  if (!csrfTokenInFlight) {
    csrfTokenInFlight = mintCsrfToken().finally(() => {
      csrfTokenInFlight = null;
    });
  }
  const token = await csrfTokenInFlight;
  return { token, generation: csrfTokenGeneration };
}
```

The caller at lines 109-111 becomes:

```ts
  let csrfGeneration = -1;
  if (requestOptions.method && requestOptions.method !== "GET") {
    const minted = await fetchCsrfToken();
    headers["X-CSRFToken"] = minted.token;
    csrfGeneration = minted.generation;
  }
```

`apiFetchOnce` must make `csrfGeneration` visible to its caller so Step 4 can
tell "my token was the stale one" from "someone else already replaced it".
The cheapest way that does not change the return type: hang it on the thrown
`ApiError`. In the `if (!res.ok)` block (lines 154-162), after constructing the
error and before throwing, add:

```ts
    (error_ as ApiError & { csrfGeneration?: number }).csrfGeneration =
      csrfGeneration;
```

(where `error_` is the `ApiError` you are about to throw — restructure the
existing `throw new ApiError(...)` into `const error_ = new ApiError(...);` plus
`throw error_;`).

`ApiError` is declared later in the file (line 71) but is only referenced from
inside function bodies, which run after module evaluation — this is safe and
needs no reordering. Do **not** move the `ApiError` class.

`clearCsrfToken()` (line 1399-1402) must also drop the in-flight promise, or a
mint that was already in progress when the 403 arrived will repopulate the
stale token:

```ts
export function clearCsrfToken(): void {
  csrfToken = null;
  csrfTokenInFlight = null;
}
```

Now create `frontend/__tests__/api-csrf-lifecycle.test.ts` with this scaffold
plus the first test:

```ts
/**
 * frontend/__tests__/api-csrf-lifecycle.test.ts
 *
 * The Worker mints a stateless double-submit CSRF token that expires after
 * CSRF_TTL_MS = 1h (workers/auth/csrf.js:1), mirrored into the `__Host-csrf`
 * cookie with a matching Max-Age. The client caches the token for the tab's
 * lifetime, so it must (a) fail loudly when the token endpoint fails and
 * (b) recover from the resulting 403 by re-minting and replaying once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, clearCsrfToken } from "@/lib/api";

function jsonResponse<T>(data: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => data,
  } as Response;
}

const CSRF_URL = "/api/v1/csrf-token";
const MUTATION_URL = "/api/v1/cases";

beforeEach(() => {
  vi.restoreAllMocks();
  // The token cache is module-level; reset it so tests cannot bleed.
  clearCsrfToken();
});

describe("fetchCsrfToken", () => {
  it("throws instead of sending an undefined CSRF header when the endpoint fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(CSRF_URL)) {
        return jsonResponse(
          {
            error: "csrf_secret_not_configured",
            code: "csrf_secret_not_configured",
          },
          503,
        );
      }
      throw new Error(`Mutation must not be attempted. Got: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch(MUTATION_URL, { method: "POST", body: "{}" }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the endpoint returns 200 with no token", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(CSRF_URL)) return jsonResponse({});
      throw new Error(`Mutation must not be attempted. Got: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch(MUTATION_URL, { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ code: "csrf_token_missing" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
```

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/api-csrf-lifecycle.test.ts`
→ `Test Files  1 passed (1)`, `Tests  2 passed (2)`

### Step 4: Recover from an expired CSRF token with exactly one replay

Edit `frontend/src/lib/api.ts`.

**4a.** Rename the existing exported `apiFetch` (the declaration on line 95, `export async function apiFetch<T>(`) to a **non-exported**
`apiFetchOnce`. Change only that one line:

```ts
async function apiFetchOnce<T>(
  url: string,
  options: ApiRequestOptions = {},
): Promise<T> {
```

Leave the entire body of that function unchanged.

**4b.** Immediately **after** the closing brace of `apiFetchOnce` (after the
`return res.json();` at line 163 and the `}` at line 164), insert:

```ts
/**
 * True only for the 403s the Worker returns when the double-submit CSRF token
 * is stale — `csrf_expired` (payload TTL passed) or `csrf` (header and the
 * `__Host-csrf` cookie disagree, which is what an expired cookie produces).
 * See `workers/auth/csrf.js` `verifyCsrf`. Every other 403 the Worker emits
 * (`admin_required`, `operator_role_required`, `forbidden`, ...) is a real
 * authorization failure and must never be replayed.
 */
function isStaleCsrfError(error: unknown, method?: string): boolean {
  if (!method || method === "GET") return false;
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    (error.code === "csrf" || error.code === "csrf_expired")
  );
}

export async function apiFetch<T>(
  url: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  try {
    return await apiFetchOnce<T>(url, options);
  } catch (error) {
    if (!isStaleCsrfError(error, options.method)) throw error;
    // Both the token and the `__Host-csrf` cookie expire after CSRF_TTL_MS
    // (1h). Drop the tab-lifetime cache, mint a fresh pair and replay the
    // request exactly once — never more, so a genuinely rejected request
    // cannot loop. Every mutation body in this module is a JSON string, so
    // replaying is safe.
    //
    // Generation compare: only the caller whose token was current at send time
    // may invalidate the cache. If another concurrent mutation already re-minted
    // (generation moved on), our 403 is collateral from that race — replay with
    // the token that is now cached rather than minting a third one and racing
    // again.
    const failedGeneration = (error as ApiError & { csrfGeneration?: number })
      .csrfGeneration;
    if (
      failedGeneration === undefined ||
      failedGeneration === csrfTokenGeneration
    ) {
      clearCsrfToken();
    }
    return await apiFetchOnce<T>(url, options);
  }
}
```

`clearCsrfToken` is declared at the bottom of the file as a function
declaration, so it hoists — no reordering needed.

**4c.** Append to `frontend/__tests__/api-csrf-lifecycle.test.ts`:

```ts
describe("apiFetch — stale CSRF recovery", () => {
  it("clears the cached token and replays a mutation exactly once after 403 csrf_expired", async () => {
    const tokens = ["token-1", "token-2"];
    let tokenIdx = 0;
    const sentTokens: (string | undefined)[] = [];

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith(CSRF_URL)) {
          return jsonResponse({ csrf_token: tokens[tokenIdx++] });
        }
        const headers = (init?.headers ?? {}) as Record<string, string>;
        sentTokens.push(headers["X-CSRFToken"]);
        if (sentTokens.length === 1) {
          return jsonResponse({ error: "csrf", code: "csrf_expired" }, 403);
        }
        return jsonResponse({ success: true });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiFetch<{ success: boolean }>(MUTATION_URL, {
      method: "POST",
      body: "{}",
    });

    expect(result.success).toBe(true);
    expect(sentTokens).toEqual(["token-1", "token-2"]);
    expect(tokenIdx).toBe(2);
  });

  it("retries at most once and then surfaces the error", async () => {
    let posts = 0;
    let tokenRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(CSRF_URL)) {
        tokenRequests += 1;
        return jsonResponse({ csrf_token: `t${tokenRequests}` });
      }
      posts += 1;
      return jsonResponse({ error: "csrf", code: "csrf_expired" }, 403);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch(MUTATION_URL, { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ status: 403, code: "csrf_expired" });
    expect(posts).toBe(2);
    expect(tokenRequests).toBe(2);
  });

  it("does not retry a 403 that is not a CSRF failure", async () => {
    let posts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(CSRF_URL)) return jsonResponse({ csrf_token: "t1" });
      posts += 1;
      return jsonResponse(
        { error: "Admin access required", code: "admin_required" },
        403,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiFetch(MUTATION_URL, { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ status: 403, code: "admin_required" });
    expect(posts).toBe(1);
  });

  it("does not retry a GET", async () => {
    let gets = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(CSRF_URL)) {
        throw new Error("A GET must not request a CSRF token");
      }
      gets += 1;
      return jsonResponse({ error: "forbidden", code: "forbidden" }, 403);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch(MUTATION_URL)).rejects.toMatchObject({
      status: 403,
    });
    expect(gets).toBe(1);
  });

  it("mints exactly one token for two concurrent mutations", async () => {
    // Models the Worker's Set-Cookie mirror: the LAST token minted is the one
    // the cookie holds, and only a header matching that cookie is accepted.
    let cookieToken: string | null = null;
    let mints = 0;
    const rejected: string[] = [];

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith(CSRF_URL)) {
          mints += 1;
          cookieToken = `t${mints}`;
          // Mints are not instantaneous; give the second caller a chance to
          // observe the empty cache if the single-flight guard is missing.
          await new Promise((r) => setTimeout(r, 0));
          return jsonResponse({ csrf_token: cookieToken });
        }
        const headers = (init?.headers ?? {}) as Record<string, string>;
        const sent = headers["X-CSRFToken"];
        if (sent !== cookieToken) {
          rejected.push(String(sent));
          return jsonResponse({ error: "csrf", code: "csrf" }, 403);
        }
        return jsonResponse({ success: true });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([
      apiFetch<{ success: boolean }>(MUTATION_URL, {
        method: "POST",
        body: "{}",
      }),
      apiFetch<{ success: boolean }>(MUTATION_URL, {
        method: "POST",
        body: "{}",
      }),
    ]);

    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    // The binding assertions: one mint, and no request was ever rejected for
    // holding a token the cookie had already replaced.
    expect(mints).toBe(1);
    expect(rejected).toEqual([]);
  });
});
```

That last case is the one that fails without the single-flight guard: two
concurrent `apiFetch` calls both find `csrfToken === null`, both mint, and the
first one's header no longer matches the cookie.

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/api-csrf-lifecycle.test.ts`
→ `Test Files  1 passed (1)`, `Tests  7 passed (7)`

and
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && grep -c 'csrfTokenInFlight' src/lib/api.ts`
→ prints `5` (declaration, the `if (!…)` guard, the assignment, the `.finally`
reset, and the reset inside `clearCsrfToken`). A bare `grep -c clearCsrfToken`
is **not** a useful check on its own — the string also appears in comments and
in the export — so assert on the single-flight symbol, which nothing else uses.

### Step 5: Give `useCaseCount` the anti-flash affordance its sibling already has

Edit `frontend/src/hooks/use-cases.ts`. Add one line to `useCaseCount` (the
`useQuery` call currently at lines 54-59) so it reads:

```ts
  return useQuery({
    queryKey: ["cases-count", filters, countMode],
    queryFn: () => fetchCaseCount(filters, countMode),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    ...options,
  });
```

`keepPreviousData` is already imported at line 5. The `...options` spread stays
**last** so a caller can still opt out — `SavedSearchCard.tsx` passes
`refetchOnMount: false` and relies on that ordering.

Append to `frontend/__tests__/query-cache-correctness.test.ts`:

```ts
describe("useCaseCount — filter-keyed list query", () => {
  it("keeps the previous count visible while a new filter set loads", async () => {
    mockFetchCaseCount
      .mockResolvedValueOnce({ total: 10, count_mode: "planned" })
      .mockImplementationOnce(() =>
        pending<{ total: number; count_mode: "planned" }>(),
      );

    const { result, rerender } = renderHook(
      ({ court }: { court: string }) => useCaseCount({ court }),
      { wrapper: makeWrapper(), initialProps: { court: "FCA" } },
    );

    await waitFor(() => expect(result.current.data?.total).toBe(10));

    rerender({ court: "HCA" });

    await waitFor(() => expect(mockFetchCaseCount).toHaveBeenCalledTimes(2));
    expect(result.current.data?.total).toBe(10);
    expect(result.current.isFetching).toBe(true);
  });
});
```

If `pending<{ total: number; count_mode: "planned" }>()` does not satisfy the
mock's declared return type, use `pending<Awaited<ReturnType<typeof api.fetchCaseCount>>>()`
instead. Do not reach for `as any` — the repo forbids it.

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/query-cache-correctness.test.ts`
→ `Test Files  1 passed (1)`, `Tests  7 passed (7)`

### Step 6: Validate the shape of the stored bookmarks blob

Edit `frontend/src/hooks/use-bookmarks.ts`.

**6a.** Replace lines 11-20 (the `// ── Read ──` comment through the closing
brace of `readFromStorage`) with:

```ts
// ── Read ──────────────────────────────────────────────────────────
const COLLECTION_COLORS: readonly string[] = [
  "blue",
  "green",
  "amber",
  "rose",
  "purple",
  "slate",
];

function emptyState(): BookmarksState {
  return { bookmarks: [], collections: [] };
}

/**
 * NORMALISE, do not reject.
 *
 * The claim that "the app itself can never write a bad shape" is only true of
 * the code as it stands *today* — it is unverified for every version a user's
 * browser may have run since `immi-bookmarks` was introduced, and this store is
 * the user's own curated work (bookmarked cases, hand-written notes, collection
 * ordering) with no server copy to restore from. A predicate that drops any
 * entry missing one string is a silent data-loss machine the first time an older
 * or newer field set shows up. Require only the identity field; supply defaults
 * for the rest. That is strictly safer and still produces a value that satisfies
 * the declared type.
 */
function normalizeBookmarkEntry(value: unknown): BookmarkEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const b = value as Record<string, unknown>;
  if (typeof b.case_id !== "string" || b.case_id.length === 0) return null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    case_id: b.case_id,
    case_title: str(b.case_title),
    case_citation: str(b.case_citation),
    court_code: str(b.court_code),
    date: str(b.date),
    note: str(b.note),
    bookmarked_at: str(b.bookmarked_at),
  };
}

function normalizeCollection(value: unknown): Collection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.id !== "string" || c.id.length === 0) return null;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const strArray = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const notes: Record<string, string> = {};
  if (c.case_notes && typeof c.case_notes === "object" && !Array.isArray(c.case_notes)) {
    for (const [k, v] of Object.entries(c.case_notes as Record<string, unknown>)) {
      if (typeof v === "string") notes[k] = v;
    }
  }
  const color =
    typeof c.color === "string" && COLLECTION_COLORS.includes(c.color)
      ? (c.color as CollectionColor)
      : undefined; // an unknown colour drops to the default, it does not
                   // discard the collection and the notes inside it
  return {
    id: c.id,
    name: str(c.name),
    description: str(c.description),
    tags: strArray(c.tags),
    case_order: strArray(c.case_order),
    case_notes: notes,
    created_at: str(c.created_at),
    updated_at: str(c.updated_at),
    ...(color ? { color } : {}),
  };
}

/**
 * Read the persisted bookmark state, tolerating anything.
 *
 * The app itself can only ever write a well-formed `BookmarksState`, but the
 * value is user-writable storage: extensions, hand edits, quota-truncated
 * writes and future schema changes can all leave garbage behind. This module
 * reads at import time and every consumer dereferences `bookmarks` /
 * `collections` unconditionally, so an unvalidated parse turns one bad blob
 * into a permanent white screen. Mirrors `loadSavedSearches`
 * (`src/lib/saved-searches.ts`).
 *
 * Exported so it can be unit-tested without reloading the module graph.
 */
export const BOOKMARKS_QUARANTINE_KEY = "immi-bookmarks:unreadable";

/**
 * Move an unreadable blob aside instead of deleting it.
 *
 * `localStorage.removeItem(STORAGE_KEY)` on its own is irreversible: the user's
 * bookmarks and hand-written notes are gone with no server copy and no undo. If
 * the shape guard here turns out to be wrong about some past or future payload,
 * the quarantine copy is what lets an operator recover it — and it is one line.
 * Best effort only: storage can be full or unavailable, in which case we still
 * proceed rather than blocking startup.
 */
function quarantine(raw: string): void {
  try {
    localStorage.setItem(
      BOOKMARKS_QUARANTINE_KEY,
      JSON.stringify({ quarantined_at: new Date().toISOString(), raw }),
    );
  } catch {
    // Quota or private mode — nothing more we can do; continue.
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable — nothing to clean up.
  }
}

export function readBookmarksFromStorage(): BookmarksState {
  if (typeof window === "undefined") return emptyState();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();

    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Array.isArray((parsed as { bookmarks?: unknown }).bookmarks) ||
      !Array.isArray((parsed as { collections?: unknown }).collections)
    ) {
      quarantine(raw);
      return emptyState();
    }

    const candidate = parsed as {
      bookmarks: unknown[];
      collections: unknown[];
    };
    return {
      bookmarks: candidate.bookmarks
        .map(normalizeBookmarkEntry)
        .filter((b): b is BookmarkEntry => b !== null),
      collections: candidate.collections
        .map(normalizeCollection)
        .filter((c): c is Collection => c !== null),
    };
  } catch {
    if (raw !== null) quarantine(raw);
    return emptyState();
  }
}
```

`CollectionColor` must be imported as a **type** (`import type { CollectionColor }`)
if it is not already — `verbatimModuleSyntax` is on.

**6b.** Change line 23 (`let _state: BookmarksState = readFromStorage();`) to:

```ts
let _state: BookmarksState = readBookmarksFromStorage();
```

`readFromStorage` must no longer exist anywhere in the file. `BookmarkEntry`
and `Collection` are already imported at lines 2-7; `CollectionColor` stays
imported because `createCollection` still uses it.

Individually-invalid entries are dropped but **not** written back — the next
`setState` persists the cleaned state anyway, and writing to storage during
module evaluation is a side effect worth avoiding.

**6c.** Create `frontend/__tests__/use-bookmarks-storage.test.ts`:

```ts
/**
 * frontend/__tests__/use-bookmarks-storage.test.ts
 *
 * `immi-bookmarks` is user-writable storage read at module-import time and
 * dereferenced unconditionally by every consumer, so a malformed blob must
 * degrade to an empty bookmark list rather than crash the app.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readBookmarksFromStorage } from "@/hooks/use-bookmarks";
import type { BookmarkEntry, Collection } from "@/types/bookmarks";

const STORAGE_KEY = "immi-bookmarks";

const VALID_BOOKMARK: BookmarkEntry = {
  case_id: "a1b2c3d4e5f6",
  case_title: "Applicant v Minister for Immigration",
  case_citation: "[2024] FCA 123",
  court_code: "FCA",
  date: "2024-03-11",
  note: "",
  bookmarked_at: "2026-08-01T00:00:00.000Z",
};

const VALID_COLLECTION: Collection = {
  id: "col-1",
  name: "Protection visa refusals",
  description: "",
  tags: [],
  case_order: ["a1b2c3d4e5f6"],
  case_notes: { a1b2c3d4e5f6: "leading case" },
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  color: "amber",
};

function seed(raw: string): void {
  window.localStorage.setItem(STORAGE_KEY, raw);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("readBookmarksFromStorage", () => {
  it("returns the empty state when nothing is stored", () => {
    expect(readBookmarksFromStorage()).toEqual({
      bookmarks: [],
      collections: [],
    });
  });

  it("round-trips a well-formed payload unchanged", () => {
    seed(
      JSON.stringify({
        bookmarks: [VALID_BOOKMARK],
        collections: [VALID_COLLECTION],
      }),
    );
    expect(readBookmarksFromStorage()).toEqual({
      bookmarks: [VALID_BOOKMARK],
      collections: [VALID_COLLECTION],
    });
  });

  it.each([
    ["invalid JSON", "not json at all"],
    ["a truncated write", '{"bookmarks":[{"case_id":"a"'],
    ["a JSON null", "null"],
    ["a bare array", "[]"],
    ["a bare number", "42"],
    ["a bare string", '"text"'],
    ["a missing collections key", '{"bookmarks":[]}'],
    ["a missing bookmarks key", '{"collections":[]}'],
    ["non-array bookmarks", '{"bookmarks":{},"collections":[]}'],
  ])(
    "returns the empty state and quarantines rather than deletes for %s",
    (_label, raw) => {
      seed(raw);
      expect(readBookmarksFromStorage()).toEqual({
        bookmarks: [],
        collections: [],
      });
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
      // The blob must be recoverable, not gone.
      const quarantined = window.localStorage.getItem(
        BOOKMARKS_QUARANTINE_KEY,
      );
      expect(quarantined).not.toBeNull();
      expect(JSON.parse(quarantined as string).raw).toBe(raw);
    },
  );

  it("keeps entries whose identity is intact and defaults the rest", () => {
    // A legacy payload: identity present, later-added fields absent. Older
    // builds of this app are NOT proven to have written today's exact field
    // set, and this store has no server copy — so a missing string must not
    // cost the user a bookmark.
    seed(
      JSON.stringify({
        bookmarks: [
          VALID_BOOKMARK,
          { case_id: "legacy00001", case_title: "Older entry" },
          { case_id: 123 },
          null,
          "nope",
        ],
        collections: [
          VALID_COLLECTION,
          { id: "legacy-col", name: "Older collection" },
          { name: "no id at all" },
        ],
      }),
    );
    const state = readBookmarksFromStorage();
    expect(state.bookmarks).toEqual([
      VALID_BOOKMARK,
      {
        case_id: "legacy00001",
        case_title: "Older entry",
        case_citation: "",
        court_code: "",
        date: "",
        note: "",
        bookmarked_at: "",
      },
    ]);
    expect(state.collections).toEqual([
      VALID_COLLECTION,
      {
        id: "legacy-col",
        name: "Older collection",
        description: "",
        tags: [],
        case_order: [],
        case_notes: {},
        created_at: "",
        updated_at: "",
      },
    ]);
  });

  it("drops only the members it cannot type, not the whole record", () => {
    seed(
      JSON.stringify({
        bookmarks: [],
        collections: [
          { ...VALID_COLLECTION, case_order: ["ok", 1, 2], tags: ["a", 5] },
        ],
      }),
    );
    const [col] = readBookmarksFromStorage().collections;
    expect(col.case_order).toEqual(["ok"]);
    expect(col.tags).toEqual(["a"]);
    expect(col.id).toBe(VALID_COLLECTION.id);
  });

  it("drops an unknown colour but keeps the collection and its notes", () => {
    seed(
      JSON.stringify({
        bookmarks: [],
        collections: [{ ...VALID_COLLECTION, color: "chartreuse" }],
      }),
    );
    const [col] = readBookmarksFromStorage().collections;
    expect(col).toBeDefined();
    expect(col.color).toBeUndefined();
    expect(col.case_notes).toEqual(VALID_COLLECTION.case_notes);
  });
});
```

Import `BOOKMARKS_QUARANTINE_KEY` alongside `readBookmarksFromStorage`, and
clear both keys in `beforeEach`.

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/use-bookmarks-storage.test.ts`
→ `Test Files  1 passed (1)`, `Tests  14 passed (14)`

and
`cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -c 'readFromStorage(' frontend/src/hooks/use-bookmarks.ts`
→ prints `2` — both of them `readBookmarksFromStorage(` (the export and the
`_state` initialiser). Assert on the exact old name instead:
`grep -cE '(^|[^s])readFromStorage\(' frontend/src/hooks/use-bookmarks.ts` → `0`.
The naive `grep -c 'readFromStorage'` matches the *new* name as a substring and
can never fail, so it is not a check.

### Step 7: Full gate

Run all three gates and confirm nothing outside the in-scope list changed.

**Verify**:

```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit
```
→ exit 0, no output

Record the baseline **before** your first edit (or read it off the run you did
during the drift check):

```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run 2>&1 | tail -6
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx eslint . 2>&1 | tail -3
```
→ note `BEFORE_TESTS`, `BEFORE_FILES`, `BEFORE_WARNINGS`.

```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run
```
→ **`0 failed`**, `AFTER_FILES == BEFORE_FILES + 3`, and
`AFTER_TESTS == BEFORE_TESTS + 28`. **Do not assert an absolute suite total.**
Plans 015, 017 and 018 add tests to this same suite; an absolute number makes
parallel execution impossible and trains the next executor to edit the yardstick
instead of the code. The per-file counts asserted in Steps 2, 4, 5 and 6 are the
stable unit and each must hold exactly.

```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx eslint .
```
→ `0 errors` is binding, and warnings must be `<= BEFORE_WARNINGS` (this plan
introduces none).

```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npm run build:cloudflare
```
→ exit 0. This is the **production** build: it writes `frontend/dist`, which is
what `wrangler.toml:15` (`[assets] directory = "./frontend/dist"`) actually
serves. `npm run build` writes `../immi_case_downloader/static/react`
(`frontend/vite.config.ts:34`), the local-dev Flask surface, and proves nothing
about the artifact users receive. This plan touches `lib/api.ts`, which every
page imports, so run the production build.

```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --porcelain=v1 -uall > /tmp/immi-016-final-status.txt
diff /tmp/immi-016-baseline-status.txt /tmp/immi-016-final-status.txt
```
→ only **added** lines, and every added line is one of these eight paths:
```
 M frontend/src/hooks/use-bookmarks.ts
 M frontend/src/hooks/use-cases.ts
 M frontend/src/hooks/use-judges.ts
 M frontend/src/hooks/use-stats.ts
 M frontend/src/lib/api.ts
?? frontend/__tests__/api-csrf-lifecycle.test.ts
?? frontend/__tests__/query-cache-correctness.test.ts
?? frontend/__tests__/use-bookmarks-storage.test.ts
```
Pre-existing dirt recorded during the drift check must be unchanged. Do not
"clean" anything you did not create.

## Test plan

Three new files, 28 new tests (7 + 7 + 14). All under `frontend/__tests__/`, which is the
only directory the Vitest `include` glob covers
(`frontend/vitest.config.ts:11`: `include: ["__tests__/**/*.{test,spec}.{ts,tsx}"]`).

**`frontend/__tests__/query-cache-correctness.test.ts`** (7 tests) — modelled
structurally on `frontend/__tests__/use-llm-council-sessions.test.ts`
(`renderHook` + `QueryClientProvider` wrapper + `vi.mocked`):

| Test | Covers |
|---|---|
| previous judge's profile is not served while a new judge loads | the FECORR-01 regression |
| previous judge's biography is not served while a new judge loads | the FECORR-01 regression (bio half — the one that supplies the name and photo) |
| `analyticsFilterKey` distinguishes the four filter-set shapes | the three fields the old key omitted |
| `analyticsFilterKey` ignores array ordering | cache-thrash edge case |
| `analyticsFilterKey(undefined) === analyticsFilterKey({})` | the `DataToolsPage.tsx:79` no-arg call site |
| `useStats` refetches when only an advanced filter changes | end-to-end proof the key reaches TanStack |

**`frontend/__tests__/api-csrf-lifecycle.test.ts`** (7 tests) — modelled on
`frontend/__tests__/dashboard-api-fallback.test.ts` (`vi.stubGlobal("fetch", …)`
plus a local `jsonResponse` helper):

| Test | Covers |
|---|---|
| non-OK token endpoint throws, mutation never attempted | the `undefined` header path |
| 200 with no token throws `csrf_token_missing` | the non-null-assertion path |
| 403 `csrf_expired` → clear, re-mint, replay once, succeed | the one-hour-tab defect |
| replay happens at most once, then the error surfaces | the recursion guard |
| 403 `admin_required` is not replayed | no over-broad retry |
| a GET is never replayed and never requests a token | no over-broad retry |
| two concurrent mutations mint one token, neither is 403'd | the Set-Cookie race the single-flight guard closes |

**`frontend/__tests__/use-bookmarks-storage.test.ts`** (14 tests, 9 of them from
one `it.each`) — modelled on the plain-unit style of
`frontend/src/lib/__tests__/saved-searches.test.ts`:

| Test | Covers |
|---|---|
| empty state when nothing stored | baseline |
| well-formed payload round-trips unchanged | no false positives (no data loss) |
| 9 × malformed root → empty state, key cleared, **blob quarantined** | invalid JSON, truncated write, `null`, `[]`, `42`, `"text"`, missing `collections`, missing `bookmarks`, non-array `bookmarks` — and each asserts the raw string survives under `immi-bookmarks:unreadable` so the deletion is recoverable |
| a legacy entry with only `case_id` / only `id` survives with defaults | the data-loss risk in a strict predicate |
| untypeable array members dropped, record kept | per-field normalisation |
| unknown collection colour dropped, collection and its notes kept | avoids a `CollectionColor` type lie without discarding user work |

No Python, Worker or Playwright test is added or changed by this plan.
`make test-py` and `cd workers && npx vitest run` are untouched and need not be
run.

## Done criteria

ALL must hold:

- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit` exits 0 with no output
- [ ] `cd "…/frontend" && npx vitest run` reports **0 failed**, with
      `AFTER_FILES == BEFORE_FILES + 3` and `AFTER_TESTS == BEFORE_TESTS + 28`
      against the baseline recorded in Step 7 (never an absolute total)
- [ ] `cd "…/frontend" && npx vitest run __tests__/query-cache-correctness.test.ts` → 7 passed
- [ ] `cd "…/frontend" && npx vitest run __tests__/api-csrf-lifecycle.test.ts` → 7 passed
- [ ] `cd "…/frontend" && npx vitest run __tests__/use-bookmarks-storage.test.ts` → 14 passed
- [ ] The single-flight case passes **by name**:
      `npx vitest run __tests__/api-csrf-lifecycle.test.ts -t "mints exactly one token for two concurrent mutations"` → `1 passed`
- [ ] `cd "…/frontend" && npx eslint .` reports **0 errors** and no more warnings than the recorded baseline
- [ ] `cd "…/frontend" && npm run build:cloudflare` exits 0 (the artifact
      `wrangler.toml:15` actually serves)
- [ ] `grep -c 'placeholderData: keepPreviousData' frontend/src/hooks/use-judges.ts` → `2`
- [ ] `grep -c 'placeholderData: keepPreviousData' frontend/src/hooks/use-cases.ts` → `2`
- [ ] `grep -c 'csrfTokenInFlight' frontend/src/lib/api.ts` → `5`
- [ ] `grep -cE '(^|[^s])readFromStorage\(' frontend/src/hooks/use-bookmarks.ts` → `0`
      (a bare `grep -c readFromStorage` also matches the new
      `readBookmarksFromStorage` and therefore cannot fail)
- [ ] `grep -c 'BOOKMARKS_QUARANTINE_KEY' frontend/src/hooks/use-bookmarks.ts` → `2`
- [ ] `grep -c 'return csrfToken!' frontend/src/lib/api.ts` → `0`
- [ ] `grep -c 'filters?.court, filters?.yearFrom, filters?.yearTo' frontend/src/hooks/use-stats.ts` → `0`
- [ ] `diff /tmp/immi-016-baseline-status.txt /tmp/immi-016-final-status.txt`
      shows only added lines, all eight of them in-scope paths
- [ ] The new status for this plan's `plans/README.md` row is **reported**; the
      row is edited only if you are running this plan alone (see Sequencing)

## STOP conditions

Stop and report back — do not improvise — if any of these occur:

- The drift check prints output and any "Current state" excerpt no longer
  matches the live file. In particular, if `frontend/src/lib/api.ts` no longer
  has the `apiFetch` body verbatim as quoted (lines 95-164), do not attempt the
  Step 4 rename — the wrapper must preserve the existing body exactly.
- `npx tsc -b --noEmit` reports an error **before** you change anything. The
  baseline is exit 0; a pre-existing failure means the tree is not the one this
  plan was written against.
- Any pre-existing test outside your three new files starts failing. The most
  likely candidate is `frontend/__tests__/api-taxonomy-normalization.test.ts`,
  which mocks `/api/v1/csrf-token` (lines 65-66, 91-92) and relies on the
  module-level token cache; if the new `res.ok` check or the retry wrapper
  breaks it, stop rather than editing that test — it is out of scope.
- `frontend/__tests__/dashboard-api-fallback.test.ts` starts failing after Step
  2. That would mean `buildDashboardCacheKey` no longer produces the same
  string as before, which orphans real users' `localStorage` entries. Recheck
  the property order in `normalizeAnalyticsFilters` before doing anything else.
- The Step 1 test still passes **before** you make the Step 1 edit, or the
  Step 5 test still passes before the Step 5 edit. A test that is green both
  ways proves nothing; report it instead of accepting it.
- You find yourself wanting to edit `JudgeDetailPage.tsx`, `JudgeHero.tsx`,
  `use-analytics.ts`, `AuthContext.tsx`, `LegislationsPage.tsx`,
  `use-llm-council-sessions.ts`, or anything under `workers/`. All are out of
  scope; the fix does not require them.
- Any step's verification fails twice after a reasonable fix attempt.
- You discover the assumption "every non-GET body in `frontend/src/lib/api.ts`
  is a `JSON.stringify` string" is false — a `FormData` or stream body cannot be
  replayed, and the Step 4 retry would silently send an empty body.

## Maintenance notes

For whoever owns this code next:

- **`analyticsFilterKey` is now the contract.** If someone adds a field to
  `AnalyticsFilterParams` (`frontend/src/types/case.ts:117-124`) and sends it in
  `appendAdvancedFilters` (`frontend/src/lib/api.ts`), they must also add it to
  `normalizeAnalyticsFilters`. Otherwise the exact bug this plan fixed comes
  back. The doc comment on the function says so; keep it there.
- **Deferred on purpose**: `frontend/src/hooks/use-analytics.ts:18-25` still has
  its own private six-field `filterKey`. It is currently correct, so migrating
  its twelve hooks onto `analyticsFilterKey` is cleanup, not a fix — but it is
  the obvious follow-up, and until it happens there are two copies of the same
  rule.
- **`useJudgeCompare` (`use-judges.ts:51-63`) deliberately keeps
  `keepPreviousData`.** Its key is a *set* of judges that `JudgeComparePage`
  mutates while mounted, so it is genuinely filter-shaped. Do not "make it
  consistent" with the two hooks this plan changed.
- **The CSRF retry is capped at one replay by construction**, not by a counter:
  `apiFetch` calls `apiFetchOnce` twice at most and `apiFetchOnce` never
  recurses. If anyone later moves the retry *inside* `apiFetchOnce`, they must
  add an explicit guard.
- **The one-hour `CSRF_TTL_MS`** lives in `workers/auth/csrf.js:1` and is a
  server policy. If it is ever shortened, the client now degrades to one extra
  round trip per expiry rather than breaking — but a very short TTL would make
  that round trip frequent, and a proactive refresh would then be worth adding.
- **The bookmarks readers normalise rather than reject, on purpose.** Only
  `case_id` / `id` are required; everything else is defaulted. Adding a new
  **required** field to `BookmarkEntry` or `Collection` without giving
  `normalizeBookmarkEntry` / `normalizeCollection` a default for it will make
  every stored entry fail to type-check at build time — which is the right
  failure. Never "fix" that by adding the field to the required set: this store
  has no server copy and no undo.
- **`immi-bookmarks:unreadable` accumulates one entry per unreadable blob**
  (each write overwrites the previous). It is a recovery aid, not a schema. If
  bookmarks ever move server-side (`plans/050-move-user-data-server-side.md`),
  drain it during migration rather than dropping it.
- **The CSRF mint is single-flight and the replay is generation-compared.**
  Both exist because the Worker's mint rewrites the `__Host-csrf` cookie
  (`workers/auth/csrf.js:19-33`), so a second concurrent mint invalidates the
  first caller's header. If anyone removes `csrfTokenInFlight`, concurrent
  mutations start 403ing again and the retry turns the race into a loop.
- **What a reviewer should scrutinise**: (1) the property order inside
  `normalizeAnalyticsFilters` — it is load-bearing for `localStorage` cache
  continuity; (2) the code allow-list in `isStaleCsrfError` — widening it to
  "any 403" would replay real authorization failures; (3) that the `...options`
  spread stays last in `useCaseCount` so `SavedSearchCard` can still opt out;
  (4) that `clearCsrfToken()` clears `csrfTokenInFlight` as well as `csrfToken`.

## Findings reconsidered

Items from the audit that this plan does **not** turn into work, each with the
reason. Recorded so nobody re-audits them from scratch.

- **`useLlmCouncilSessions` missing `placeholderData`
  (`frontend/src/hooks/use-llm-council-sessions.ts:48-56`).** Real omission, but
  the stated symptom does not exist: the hook is invoked as
  `useLlmCouncilSessions()` with no arguments at
  `frontend/src/pages/LlmCouncilSessionsPage.tsx:56`, so `params` is permanently
  `undefined`, the query key never changes, and no pagination flash can occur.
  The file is also outside this plan's territory. Deferred as pure convention
  cleanup.
- **`SavedSearchCard` count flash
  (`frontend/src/components/saved-searches/SavedSearchCard.tsx:28-37`).** The
  claimed symptom is refuted: the card passes `search.filters`, a per-card
  constant belonging to a saved search rather than a live filter UI, plus
  `refetchOnMount: false` and `staleTime: 120_000`. The key never changes and no
  count ever blanks. Step 5 still adds `placeholderData` to `useCaseCount` for
  convention consistency, but the justification is uniformity, not a live bug.
- **`CaseTextViewer` never resets `activeMatchIdx` on a new search term
  (`frontend/src/components/cases/CaseTextViewer.tsx:207`).** Refuted by direct
  read: `setActiveMatchIdx(0)` is called at `:383` (the search input's
  `onChange`) and again at `:412` (the clear button). The state *is* reset. No
  defect.
- **`DashboardPage` stale `loadingPhase`
  (`frontend/src/pages/DashboardPage.tsx:137`).** Effectively unreachable:
  `loadingPhase` is read only inside `if (isInitialLoading)` at `:253-255`, and
  `isInitialLoading` is `isLoading && !stats` (`:135`). Once `stats` is
  populated it stays populated for the mount (`placeholderData: keepPreviousData`
  plus the app-wide `gcTime: 30 * 60 * 1000` set at `frontend/src/App.tsx:169`),
  so a stale `"timeout"` phase can never be displayed on a later load. No
  user-visible effect.
- **`AuthContext.scheduleRefresh` has no minimum floor
  (`frontend/src/contexts/AuthContext.tsx:40`,
  `Math.max(msUntilExpiry - 60_000, 0)`).** Confirmed real: a client clock more
  than ~4 minutes fast pins `refreshIn` to `0` every cycle, producing an
  RTT-bound request loop against `/api/v1/auth/refresh`. **Deferred, not
  rejected** — `AuthContext.tsx` is outside this plan's file territory and
  editing it risks colliding with a parallel plan. It needs its own plan: a
  floor (e.g. 10s) plus a consecutive-refresh counter so clock skew degrades to
  slow polling.
- **`LegislationsPage` search input never re-syncs from the URL
  (`frontend/src/pages/LegislationsPage.tsx:38`,
  `useState(searchQuery)`).** Confirmed real but cosmetic: browser back/forward
  changes the results while the input text stays stale. **Deferred** — outside
  this plan's file territory. Fix is a `useEffect` keyed on `searchQuery`.
- **"Call `clearCsrfToken()` from AuthContext's login / logout / switchTenant."**
  Rejected as unnecessary. The Worker's CSRF token is stateless and
  identity-independent (`workers/auth/csrf.js:19-33` mints 16 random bytes plus
  an expiry, HMAC-signed; `:35-49` verifies only header === cookie, expiry and
  signature), and no auth transition rotates it. Wiring `clearCsrfToken` into
  auth transitions would add cross-module coupling that fixes nothing. Step 4
  wires it where it actually helps: the 403 recovery path.
