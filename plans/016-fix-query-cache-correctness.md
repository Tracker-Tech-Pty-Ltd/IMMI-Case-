# Plan 016: Fix stale-data bleed, query keys and CSRF token lifetime

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — that file does not exist at the time of writing; if
> it still does not exist, skip that and say so in your report. Do not create
> it.
>
> Every path in this file is relative to the repository root
> `/Users/d/Developer/Active Projects/IMMI-Case-`. The directory name contains
> a space and a trailing hyphen, so **always quote it** in shell commands.
>
> **Drift check (run first)**:
> ```
> cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat 42826a3..HEAD -- frontend/src/hooks/use-judges.ts frontend/src/hooks/use-stats.ts frontend/src/hooks/use-cases.ts frontend/src/hooks/use-bookmarks.ts frontend/src/lib/api.ts
> ```
> If that prints nothing, the codebase has not drifted — proceed. If any
> in-scope file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

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
| Drift check | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat 42826a3..HEAD -- frontend/src/hooks/use-judges.ts frontend/src/hooks/use-stats.ts frontend/src/hooks/use-cases.ts frontend/src/hooks/use-bookmarks.ts frontend/src/lib/api.ts` | no output |
| Typecheck (real) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit` | exit 0, no output |
| Frontend tests (all) | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` | `0 failed` |
| One test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run <path>` | all pass |
| Lint | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx eslint .` | `0 errors`, at most 25 warnings |

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

Edit `frontend/src/lib/api.ts`. Replace `fetchCsrfToken` (currently lines 48-54)
with:

```ts
async function fetchCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
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
  return token;
}
```

`ApiError` is declared later in the file (line 71) but is only referenced from
inside a function body, which runs after module evaluation — this is safe and
needs no reordering. Do **not** move the `ApiError` class.

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
    clearCsrfToken();
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
});
```

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/api-csrf-lifecycle.test.ts`
→ `Test Files  1 passed (1)`, `Tests  6 passed (6)`

and
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && grep -c 'clearCsrfToken' src/lib/api.ts`
→ prints `2` (one call site inside `apiFetch`, one definition)

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

function isBookmarkEntry(value: unknown): value is BookmarkEntry {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.case_id === "string" &&
    b.case_id.length > 0 &&
    typeof b.case_title === "string" &&
    typeof b.case_citation === "string" &&
    typeof b.court_code === "string" &&
    typeof b.date === "string" &&
    typeof b.note === "string" &&
    typeof b.bookmarked_at === "string"
  );
}

function isCollection(value: unknown): value is Collection {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    c.id.length > 0 &&
    typeof c.name === "string" &&
    typeof c.description === "string" &&
    Array.isArray(c.tags) &&
    c.tags.every((tag) => typeof tag === "string") &&
    Array.isArray(c.case_order) &&
    c.case_order.every((id) => typeof id === "string") &&
    typeof c.case_notes === "object" &&
    c.case_notes !== null &&
    !Array.isArray(c.case_notes) &&
    Object.values(c.case_notes as Record<string, unknown>).every(
      (note) => typeof note === "string",
    ) &&
    typeof c.created_at === "string" &&
    typeof c.updated_at === "string" &&
    (c.color === undefined ||
      (typeof c.color === "string" && COLLECTION_COLORS.includes(c.color)))
  );
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
export function readBookmarksFromStorage(): BookmarksState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();

    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Array.isArray((parsed as { bookmarks?: unknown }).bookmarks) ||
      !Array.isArray((parsed as { collections?: unknown }).collections)
    ) {
      localStorage.removeItem(STORAGE_KEY);
      return emptyState();
    }

    const candidate = parsed as {
      bookmarks: unknown[];
      collections: unknown[];
    };
    return {
      bookmarks: candidate.bookmarks.filter(isBookmarkEntry),
      collections: candidate.collections.filter(isCollection),
    };
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable (private mode / quota) — nothing to clean up.
    }
    return emptyState();
  }
}
```

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
  ])("returns the empty state and clears the key for %s", (_label, raw) => {
    seed(raw);
    expect(readBookmarksFromStorage()).toEqual({
      bookmarks: [],
      collections: [],
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("drops malformed entries and keeps the valid ones", () => {
    seed(
      JSON.stringify({
        bookmarks: [VALID_BOOKMARK, { case_id: 123 }, null, "nope"],
        collections: [VALID_COLLECTION, { id: "x" }, { ...VALID_COLLECTION, case_order: [1, 2] }],
      }),
    );
    const state = readBookmarksFromStorage();
    expect(state.bookmarks).toEqual([VALID_BOOKMARK]);
    expect(state.collections).toEqual([VALID_COLLECTION]);
  });

  it("rejects a collection carrying an unknown colour", () => {
    seed(
      JSON.stringify({
        bookmarks: [],
        collections: [{ ...VALID_COLLECTION, color: "chartreuse" }],
      }),
    );
    expect(readBookmarksFromStorage().collections).toEqual([]);
  });
});
```

**Verify**:
`cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run __tests__/use-bookmarks-storage.test.ts`
→ `Test Files  1 passed (1)`, `Tests  13 passed (13)`

and
`cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -c 'readFromStorage' frontend/src/hooks/use-bookmarks.ts`
→ prints `0`

### Step 7: Full gate

Run all three gates and confirm nothing outside the in-scope list changed.

**Verify**:

```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit
```
→ exit 0, no output

```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run
```
→ `Test Files  58 passed (58)`, `Tests  516 passed (516)` — **`0 failed` is the
binding assertion**; the totals are the expected values at `42826a3` (55 files /
490 tests) plus this plan's 3 files / 26 tests. If another plan has landed since,
the totals will differ but `0 failed` must still hold and the three named files
must each pass.

```
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx eslint .
```
→ `✖ 25 problems (0 errors, 25 warnings)` — 0 errors is binding; the warning
count must not increase.

```
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short
```
→ exactly these eight paths and nothing else:
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

## Test plan

Three new files, 26 new tests. All under `frontend/__tests__/`, which is the
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

**`frontend/__tests__/api-csrf-lifecycle.test.ts`** (6 tests) — modelled on
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

**`frontend/__tests__/use-bookmarks-storage.test.ts`** (13 tests, 9 of them from
one `it.each`) — modelled on the plain-unit style of
`frontend/src/lib/__tests__/saved-searches.test.ts`:

| Test | Covers |
|---|---|
| empty state when nothing stored | baseline |
| well-formed payload round-trips unchanged | no false positives (no data loss) |
| 9 × malformed root → empty state + key cleared | invalid JSON, truncated write, `null`, `[]`, `42`, `"text"`, missing `collections`, missing `bookmarks`, non-array `bookmarks` |
| malformed entries dropped, valid ones kept | per-item guard |
| unknown collection colour rejected | avoids a `CollectionColor` type lie |

No Python, Worker or Playwright test is added or changed by this plan.
`make test-py` and `cd workers && npx vitest run` are untouched and need not be
run.

## Done criteria

ALL must hold:

- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx tsc -b --noEmit` exits 0 with no output
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run` reports **0 failed**
- [ ] `cd "…/frontend" && npx vitest run __tests__/query-cache-correctness.test.ts` → 7 passed
- [ ] `cd "…/frontend" && npx vitest run __tests__/api-csrf-lifecycle.test.ts` → 6 passed
- [ ] `cd "…/frontend" && npx vitest run __tests__/use-bookmarks-storage.test.ts` → 13 passed
- [ ] `cd "…/frontend" && npx eslint .` reports **0 errors** and no more than 25 warnings
- [ ] `grep -c 'placeholderData: keepPreviousData' frontend/src/hooks/use-judges.ts` → `2`
- [ ] `grep -c 'placeholderData: keepPreviousData' frontend/src/hooks/use-cases.ts` → `2`
- [ ] `grep -c 'clearCsrfToken' frontend/src/lib/api.ts` → `2`
- [ ] `grep -c 'readFromStorage' frontend/src/hooks/use-bookmarks.ts` → `0`
- [ ] `grep -c 'return csrfToken!' frontend/src/lib/api.ts` → `0`
- [ ] `grep -c 'filters?.court, filters?.yearFrom, filters?.yearTo' frontend/src/hooks/use-stats.ts` → `0`
- [ ] `git status --short` lists exactly the eight paths in Step 7 and nothing else
- [ ] `plans/README.md` status row updated **if that file exists** (it does not at `42826a3`; do not create it)

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
- **The bookmarks guards encode today's `BookmarksState`.** Adding a required
  field to `BookmarkEntry` or `Collection` without updating `isBookmarkEntry` /
  `isCollection` will silently discard every entry a user already has. Add the
  field as optional, or write a migration.
- **What a reviewer should scrutinise**: (1) the property order inside
  `normalizeAnalyticsFilters` — it is load-bearing for `localStorage` cache
  continuity; (2) the code allow-list in `isStaleCsrfError` — widening it to
  "any 403" would replay real authorization failures; (3) that the `...options`
  spread stays last in `useCaseCount` so `SavedSearchCard` can still opt out.

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
