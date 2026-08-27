# Plan 017: Clipboard, blob downloads, share links and stream re-entrancy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, report the new status for this plan's
> row in `plans/README.md`. That file **does** exist, and all four of plans
> 015–018 touch adjacent rows of the same table, so **do not edit it yourself
> when running in parallel** — report your row and let the integration
> coordinator write it.
>
> **Drift check (run first)**:
>
> `git diff 42826a3..HEAD` cannot see uncommitted, staged or untracked work, so
> on a dirty tree it gives a false all-clear. Run all four commands, and note
> that the scope is split into two lists with **different** failure policies:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> # Files this plan WRITES. Any change here is a STOP condition.
> OWNED='frontend/src/pages/CasesPage.tsx
> frontend/src/pages/CollectionDetailPage.tsx
> frontend/src/lib/saved-searches.ts
> frontend/src/components/shared/GlobalSearch.tsx
> frontend/src/components/llm-council/StreamingCouncilView.tsx'
> # Files this plan only READS. A change here means RE-VERIFY the excerpt, not stop.
> REFERENCED='frontend/src/lib/router.ts
> frontend/src/hooks/use-cases.ts
> frontend/src/components/taxonomy/JudgeAutocomplete.tsx'
>
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $OWNED $REFERENCED   # committed drift
> git diff --stat -- $OWNED $REFERENCED                 # unstaged drift
> git diff --cached --stat -- $OWNED $REFERENCED        # staged drift
> git status --porcelain=v1 -uall > /tmp/immi-017-baseline-status.txt
> ```
>
> - Any file from **`$OWNED`** appearing in any of those four → **STOP** and
>   report. Two owners on one region is not resolvable by a merge tool.
> - Any file from **`$REFERENCED`** appearing → **do not stop.** Re-read the
>   "Current state" excerpt for that file against the live code and continue if
>   it still supports the step that quotes it. This matters concretely:
>   `plans/016-fix-query-cache-correctness.md` Step 5 adds one line
>   (`placeholderData: keepPreviousData`) to `frontend/src/hooks/use-cases.ts`.
>   That change does not affect anything this plan does — the earlier draft
>   listed it as a hard stop and would have blocked this plan for no reason the
>   moment 016 committed.
>
> **Never run `git checkout --` or `git clean -f`** to make the tree "clean";
> that destroys the operator's or a parallel agent's uncommitted work.
> Keep `/tmp/immi-017-baseline-status.txt` — Step 12 diffs against it.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

`Depends on: none` is deliberate. Every verification command this plan uses
(`npx tsc -b --noEmit`, `npx vitest run`, `npx eslint .`, all run from
`frontend/`) already works correctly at commit `42826a3`. This plan does not
need the verification-gate plans (001–003) to land first. Note that
`plans/001-restore-the-frontend-compile-gate.md`, if it lands first, creates a
`frontend/tsconfig.test.json` that type-checks `frontend/__tests__/` — the four
test files this plan creates are written to be type-clean so they survive that.

### Sequencing — read before dispatching this plan in parallel

- **`frontend/src/components/llm-council/StreamingCouncilView.tsx` has exactly
  one owner at a time.** Steps 7–9 here rewrite `RecallCodeCard`, the `finally`
  arm of `start()`, and the unmount effect.
  `plans/015-surface-frontend-errors.md` Step 2 rewrites the **`catch` arm of
  the same `try/catch/finally`** and the same unmount effect. Those are not
  separable by a merge tool. **Run Steps 7–9 of this plan first, then 015's
  Step 2**, or hand both regions to one agent. 015 has been revised to expect
  this plan's unmount-cleanup change and to work whether or not it is already
  present; Step 8 below is written the same way.
- **`frontend/src/hooks/use-cases.ts` is written by `plans/016` Step 5.** This
  plan only reads it. See the drift check — a change there is a re-verify, not a
  stop.
- **`plans/018-complete-the-i18n-catalogue.md` runs after this plan.** Step 7
  below keeps the `aria-label="Copy recall code"` literal, which 018's ratchet
  already allowlists. Do not change that string without telling 018.
- **Do not edit `plans/README.md`** while running in parallel.

## Why this matters

Four independent defects, all in the React SPA, all in the "the UI told the
user it worked" category:

1. **The LLM Council recall code reports a copy that never happened.** The
   recall code is the *only* handle a user has for restoring a council session
   later. The copy handler fires `navigator.clipboard.writeText()` without
   `await` inside a `try` that therefore cannot catch its rejection, then flips
   the button to a green "Copied" unconditionally. In any non-secure context,
   denied-permission or unfocused-document case the user walks away believing
   they saved a code they do not have, plus one unhandled promise rejection per
   click.
2. **The global search box has no debounce** — the only search input in the app
   without one. An 11-character query issues 11 distinct full-text searches
   against the D1 catalog, and the result list plus the keyboard-selected row
   are replaced on every keystroke because nothing holds the previous page.
3. **Saved-search "share" links drop the router basename**, so a link generated
   while the SPA is served under `/app/` points outside the router.
4. **The council stream's teardown is not generation-guarded**, so a superseded
   run's `finally` block nulls the successor's `AbortController` and clears its
   `isStreaming` flag.

Plus one hardening item: three pages inline the same blob-download idiom, each
revoking the object URL in the same task as `a.click()` and never attaching the
anchor to the document. See "Findings reconsidered" for the honest limits on
items 3 and 4 and on the blob-download claim — none of them is a reproduced
production failure, and this plan says so rather than overselling them.

## Current state

### Files this plan modifies, and their role

- `frontend/src/components/llm-council/StreamingCouncilView.tsx` — the LLM
  Council SSE view. Exports `useCouncilStream()` (the stream hook, lines
  170–379) and `StreamingCouncilView` (the 3-column view, line 582). Contains
  the private `RecallCodeCard` (line 677) with the broken clipboard handler.
- `frontend/src/components/shared/GlobalSearch.tsx` — the Cmd-K global search
  dialog. 185 lines, one private `GlobalSearchDialog` component.
- `frontend/src/lib/saved-searches.ts` — saved-search persistence + URL
  encoding. `generateShareableUrl` is the last function in the file.
- `frontend/src/pages/CasesPage.tsx` — cases list; `exportCsv` builds a CSV
  blob and downloads it.
- `frontend/src/pages/CollectionDetailPage.tsx` — one collection; `handleExport`
  downloads a server-rendered HTML report.

### Read-only references (do NOT modify)

- `frontend/src/lib/router.ts` — 12 lines, the single source of truth for the
  SPA basename.
- `frontend/src/hooks/use-cases.ts` — TanStack Query hooks; `useSearchCases` at
  line 88.
- `frontend/src/components/taxonomy/JudgeAutocomplete.tsx` — **the debounce
  exemplar to copy** (lines 14–52).

### `frontend/src/components/llm-council/StreamingCouncilView.tsx:677-688` (verbatim)

```tsx
function RecallCodeCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      playHaptic();
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — non-fatal, code is visible on screen */
    }
  }, [code]);
```

`writeText()` returns a promise. A synchronous `try` cannot observe its
rejection, so the `catch` on line 685 is dead for every failure mode except
`navigator.clipboard` being `undefined` outright — and the comment on line 686
describes a state the code cannot observe. The 2 s timer on line 684 is never
cleared, on unmount or on re-copy.

The button that calls it, `StreamingCouncilView.tsx:716-734` (verbatim):

```tsx
          <button
            type="button"
            onClick={onCopy}
            data-testid="recall-code-copy"
            aria-label="Copy recall code"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-accent/60 hover:bg-accent/10 hover:text-accent"
          >
            {copied ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
```

Note: **this component has no i18n and no toast.** `StreamingCouncilView.tsx`
never imports `useTranslation` or `sonner`; all of its user-facing strings are
hardcoded English ("Copied", "Copy", "Save your recall code"). Do **not**
introduce `t()` or `toast` into this file — surface the failure with local
component state, matching what is already there. `AlertTriangle` is already
imported on line 21:

```tsx
import { AlertTriangle, Bot, CheckCircle2, Copy, ExternalLink, KeyRound, Loader2, Search, Sparkles } from "lucide-react";
import { playHaptic } from "@/lib/council-celebrations";
```

`playHaptic` (`frontend/src/lib/council-celebrations.ts:232-241`) already
feature-detects `navigator.vibrate` and swallows its own errors, so it is safe
to call from anywhere.

### `frontend/src/components/llm-council/StreamingCouncilView.tsx:192-211` (verbatim)

```tsx
  const start = useCallback(
    async (params: { message: string; case_context?: string }): Promise<CouncilStreamState> => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      const fresh = initialState();
      setState(fresh);
      setIsStreaming(true);

      const myGen = ++genRef.current;
      // Local mutable copy mirrored to React state. Guarded by myGen so
      // a previously-aborted loop's straggler updates cannot overwrite
      // a fresh stream's state.
      let curr: CouncilStreamState = fresh;
      const update = (next: CouncilStreamState) => {
        if (myGen !== genRef.current) return; // superseded
        curr = next;
        setState(next);
      };
```

and its `finally`, `StreamingCouncilView.tsx:362-366` (verbatim):

```tsx
      } finally {
        clearInterval(watchdog);
        controllerRef.current = null;
        setIsStreaming(false);
      }
```

Every other state-touching block in this hook is gated on
`myGen === genRef.current` (line 208 in `update`, line 221 in the watchdog
interval). This `finally` is the only one that is not. When `start()` is called
a second time, line 194 aborts run A's controller and line 196 installs run B's
before run A's microtask-delivered rejection reaches this `finally` — which then
nulls run B's controller and clears run B's `isStreaming`.

### `frontend/src/components/shared/GlobalSearch.tsx:18-37` (verbatim)

```tsx
function GlobalSearchDialog({ onClose }: GlobalSearchDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { data } = useSearchCases(query, 8);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const cases = data?.cases ?? [];
  const hasResults = cases.length > 0;
  const isExpanded = hasResults && query.length > 0;

  const clampedActiveIdx = useMemo(() => {
    if (!hasResults) return 0;
    return Math.min(activeIdx, cases.length - 1);
  }, [activeIdx, hasResults, cases.length]);
```

and its `onChange`, `GlobalSearch.tsx:64-68` (verbatim):

```tsx
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0);
              }}
```

and its no-results panel, `GlobalSearch.tsx:140-149` (verbatim):

```tsx
          {query.length > 0 && cases.length === 0 && (
            <div className="flex flex-col items-center gap-1 p-6 text-center">
              <p className="text-sm font-medium text-foreground">
                {t("common.no_results")}
              </p>
              <p className="text-xs text-muted-text">
                {t("tooltips.navigate_up_down")}
              </p>
            </div>
          )}
```

`frontend/src/components/shared/GlobalSearch.tsx:1` (verbatim) — note the
missing `useCallback`:

```tsx
import { useState, useRef, useEffect, useMemo } from "react";
```

The hook it drives, `frontend/src/hooks/use-cases.ts:88-95` (verbatim):

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

Every distinct prefix is a distinct `queryKey`, so a single typed character
triggers a full-text search. **`use-cases.ts` is out of scope for this plan** —
the debounce is added in `GlobalSearch.tsx` instead.

### The debounce exemplar to copy — `frontend/src/components/taxonomy/JudgeAutocomplete.tsx:13-52` (verbatim)

```tsx
  // State for search input with debounce
  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Fetch judge autocomplete data
  const { data, isLoading } = useJudgeAutocomplete(debouncedQuery, 20);

  const judgeResults = data?.judges ?? [];

  // Handle search input change with debounce
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

Note the bare `setTimeout` / `clearTimeout` (not `window.setTimeout`) and the
`ReturnType<typeof setTimeout>` ref type. Match both — bare `setTimeout` is
what Vitest's fake timers replace, `window.setTimeout` may not be.

### `frontend/src/lib/saved-searches.ts:298-305` (verbatim, end of file)

```ts
/**
 * Generate a shareable URL for a saved search
 */
export function generateShareableUrl(filters: CaseFilters): string {
  const params = encodeFiltersToUrl(filters);
  const baseUrl = `${window.location.origin}/cases`;
  return params ? `${baseUrl}?${params}` : baseUrl;
}
```

The whole file's import block is one line, `saved-searches.ts:1` (verbatim):

```ts
import type { SavedSearch, CaseFilters } from "@/types/case";
```

`encodeFiltersToUrl` (`saved-searches.ts:230-247`) always sets `page=1`, so
`params` is never empty and the `baseUrl` branch is dead. Insertion order of
the query string is: `court, year, visa_type, nature, source, tag, keyword,
sort_by, sort_dir, page`.

### `frontend/src/lib/router.ts` (verbatim, complete file)

```ts
const LEGACY_APP_PREFIX = "/app";

export function resolveRouterBasename(pathname: string): "/" | "/app" {
  if (
    pathname === LEGACY_APP_PREFIX ||
    pathname.startsWith(`${LEGACY_APP_PREFIX}/`)
  ) {
    return LEGACY_APP_PREFIX;
  }

  return "/";
}
```

It is wired into the router at `frontend/src/App.tsx:175`
(`const basename = resolveRouterBasename(window.location.pathname);`).
`generateShareableUrl` is the only URL builder in the app that ignores it.

The sole caller is `frontend/src/components/saved-searches/SavedSearchCard.tsx:78-86`
(verbatim) — **out of scope, do not edit it**; the fix below keeps its call
signature working unchanged:

```tsx
  const handleShare = useCallback(async () => {
    try {
      const url = generateShareableUrl(search.filters);
      await navigator.clipboard.writeText(url);
      toast.success(t("saved_searches.toast_url_copied"));
    } catch {
      toast.error(t("saved_searches.toast_url_copy_failed"));
    }
  }, [search.filters, t]);
```

This is also the repo's one **correct** clipboard call — awaited, inside
`try/catch`, with a real error path. It is the shape Step 7 reproduces.

### `frontend/src/pages/CasesPage.tsx:174-183` (verbatim)

```tsx
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cases-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("cases.exported", { count: data.cases.length }));
  }, [data, t]);
```

### `frontend/src/pages/CollectionDetailPage.tsx:96-103` (verbatim)

```tsx
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${collection.name.replace(/[^a-z0-9]/gi, "_")}.html`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("bookmarks.export_success", "Report downloaded"));
```

Both build a **detached** anchor (never appended to `document.body`) and revoke
the object URL on the statement immediately after `click()`.

### Test layout and conventions

Vitest collects **only** `frontend/__tests__/**/*.{test,spec}.{ts,tsx}` —
`frontend/vitest.config.ts` (verbatim):

```ts
    globals: true,
    environment: "jsdom",
    setupFiles: ["./__tests__/legislations-setup.ts"],
    include: ["__tests__/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
```

`CLAUDE.md:32` claims tests live in `frontend/src/__tests__/`. **That directory
does not exist**; ignore that line. There *is* an orphaned
`frontend/src/lib/__tests__/saved-searches.test.ts` (332 lines, 28 tests) that
Vitest does not collect — a separate plan owns making it run. It contains **no**
`generateShareableUrl` test (verified by grep), so Step 10 cannot break it.
Put all new tests in `frontend/__tests__/`.

The shared setup file `frontend/__tests__/legislations-setup.ts` already
provides: a `ResizeObserver` stub, an `IntersectionObserver` stub, a
`localStorage` mock, `afterEach(cleanup)`, and a global `react-i18next` mock
whose `t(key, opts)` returns `opts.defaultValue` when present and otherwise the
**key string**. So `t("common.no_results")` renders the literal text
`common.no_results` in tests. Assert on that, not on English.

Even though `globals: true` is set, every existing test file imports
`describe/it/expect/vi` explicitly from `"vitest"` — ESLint's
`languageOptions.globals` is `globals.browser` only, so an implicit `describe`
would be a `no-undef` error. **Always import them explicitly.**

Verified jsdom facts you will need (probed at this commit):

- `URL.createObjectURL` / `URL.revokeObjectURL` are **not implemented** by
  jsdom — a test must install them.
- `click` is an own property of `HTMLElement.prototype`, **not** of
  `HTMLAnchorElement.prototype`. Spy on `HTMLElement.prototype`.
- `navigator.clipboard` is **undefined** in jsdom — a test must define it.
- Radix's `Dialog` renders fine in jsdom (see
  `frontend/__tests__/success-rate-deep-modal.test.tsx`), but the Step 6 test
  runs under fake timers, so it replaces Radix with plain `div`s to keep the
  assertion about the debounce and nothing else.

### Repo conventions that apply here

Quoted from `CLAUDE.md` and `~/.claude/rules` so you do not have to go read
them:

- **Never mutate arrays in React** — use `.toSorted()`, not `.sort()`.
- **Every `localStorage` call is wrapped in try/catch** (throws in private mode
  and on quota).
- **UI strings use `t("key", { defaultValue: "English text" })`** — *except* in
  `StreamingCouncilView.tsx`, which has no i18n at all (see above). Do not add
  i18n to that file in this plan.
- **All spacing / shadow / radius / colour values come from
  `frontend/src/tokens/tokens.json`** via Tailwind classes and CSS variables —
  no magic numbers. Reuse the existing utility classes shown in the excerpts;
  do not invent new colour literals.
- **`animate-spin` goes on a wrapper `<div>`, never on the SVG icon.**
- **Commit style is conventional commits**: `<type>: <description>` with type in
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution or co-author
  lines. Example from `git log`: `fix: install root node_modules in make install`.

Design direction is decided and named **"Legal Codex"**: warm off-white
`#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text serif
headings, 9 court-specific colour codes. The primary user is a
self-representing immigration applicant under stress, not a lawyer; the brand is
authoritative, precise, academic. That is why "Copied" must not lie: the recall
code is the user's only route back to a session they may have paid for.

## Commands you will need

Run all of these from `/Users/d/Developer/Active Projects/IMMI-Case-/frontend`
unless stated otherwise.

| Purpose | Command | Expected on success |
|---|---|---|
| Type-check (the real one) | `npx tsc -b --noEmit` | exit 0, no output |
| Frontend unit tests | `npx vitest run` | **0 failed**; record `BEFORE_TESTS`/`BEFORE_FILES` and assert a delta of +23 tests / +4 files. Never assert an absolute total — three sibling plans add tests to this suite |
| One test file | `npx vitest run __tests__/download-blob.test.ts` | the per-file count named in that step. **Per-file counts are the stable unit** |
| One test by name | `npx vitest run <path> -t "<test name>"` | exit 0, `1 passed` |
| Lint | `npx eslint .` | exit 0, `0 errors`, warnings ≤ the recorded `BEFORE_WARNINGS` |
| **Production build** | `npm run build:cloudflare` | exit 0 — writes `frontend/dist`, which `wrangler.toml:15` serves. `npm run build` writes the Flask surface instead and is not the gate |
| Confirm scope | `git status --porcelain=v1 -uall`, diffed against the drift-check baseline | only additions, all in "In scope" |

**Do not** use `npx tsc --noEmit` (no `-b`). `frontend/tsconfig.json` is a
solution-style project (`"files": []` plus `references`), so the bare form
compiles **zero** files and always exits 0. Only `tsc -b --noEmit` checks
anything.

## Scope

**In scope** (the only files you may create or modify):

- `frontend/src/lib/download-blob.ts` — **create**
- `frontend/src/pages/CasesPage.tsx` — the `exportCsv` callback only (lines
  153–183) plus one added import
- `frontend/src/pages/CollectionDetailPage.tsx` — the `handleExport` function
  only (lines 86–110) plus one added import
- `frontend/src/components/shared/GlobalSearch.tsx`
- `frontend/src/components/llm-council/StreamingCouncilView.tsx` — exactly two
  regions: the `finally` block at lines 362–366, and `RecallCodeCard`
  (lines 677–739)
- `frontend/src/lib/saved-searches.ts` — the import line and
  `generateShareableUrl` only
- `frontend/__tests__/download-blob.test.ts` — **create**
- `frontend/__tests__/global-search-debounce.test.tsx` — **create**
- `frontend/__tests__/streaming-council-view.test.tsx` — **create**
- `frontend/__tests__/saved-search-share-url.test.ts` — **create**

**Out of scope** (do NOT touch, even though they look related):

- `frontend/src/pages/CaseDetailPage.tsx` — has the same unawaited clipboard
  bug at line 81 and a pointless dynamic re-import at line 422. **The clipboard
  half is now owned by `plans/015-surface-frontend-errors.md` Step 1b**, which
  already modifies this file and reproduces the exact shape Step 7 establishes
  here; do not fix it in this plan or the two will conflict. The dynamic
  re-import is cosmetic — see "Findings reconsidered".
- `frontend/src/pages/DesignTokensPage.tsx` — same clipboard bug at line 387,
  same blob idiom at line 2490. Same reason. It is a 2 500-line file; leave it.
- `frontend/src/components/cases/CaseTextViewer.tsx:296-304` — a **fourth**
  copy of the blob idiom the original audit missed. Recorded in "Maintenance
  notes"; not this plan's territory.
- `frontend/src/hooks/use-cases.ts` — adding `placeholderData: keepPreviousData`
  to `useSearchCases` is a correct follow-up, but the hook is shared by other
  callers and is not in this plan's territory. The debounce in Step 5 removes
  the request storm on its own.
- `frontend/src/components/saved-searches/SavedSearchCard.tsx` — Step 10 is
  deliberately designed so this caller needs no change.
- `frontend/src/lib/router.ts` — read it, do not change it.
- `frontend/src/lib/__tests__/saved-searches.test.ts` — the orphaned,
  uncollected test file. A different plan owns making it run.
- `CLAUDE.md` — its wrong `frontend/src/__tests__` path is owned elsewhere.
- Anything under `workers/`, `immi_case_downloader/`, `tests/`, or
  `frontend/e2e/`.

## Git workflow

- Branch: `git switch -c advisor/017-fix-frontend-async-and-navigation`
- One commit per logical unit. Suggested messages:
  - Steps 1–4: `refactor: extract a shared blob-download helper`
  - Steps 5–6: `fix: debounce the global search input`
  - Step 7: `fix: report clipboard failures on the council recall code`
  - Steps 8–9: `fix: guard council stream teardown on the generation token`
  - Steps 10–11: `fix: keep the router basename in saved-search share links`
- No AI attribution / co-author lines.
- Do **NOT** push, do **NOT** open a PR, do **NOT** merge. The operator commits
  and ships.

## Steps

### Step 1: Create the shared blob-download helper

Create `frontend/src/lib/download-blob.ts` with exactly this content:

```ts
/**
 * Shared blob-download helper.
 *
 * Three call sites previously inlined the same idiom, all of which built a
 * detached anchor and revoked the object URL in the same task as the click.
 * Neither is a reproduced failure on current Chromium / Firefox / WebKit —
 * this helper exists to remove the triplication and to stop relying on that
 * timing at all:
 *
 *   - the anchor is attached to the document before it is clicked, because a
 *     detached anchor is not clickable in every engine;
 *   - the object URL is revoked on a later macrotask, so the download is
 *     always started against a live URL.
 */
export const BLOB_URL_REVOKE_DELAY_MS = 1_000;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Bare setTimeout (not window.setTimeout) so Vitest fake timers can
    // deterministically advance it in the unit test.
    setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_DELAY_MS);
  }
}
```

**Verify**: `cd frontend && npx tsc -b --noEmit` → exit 0, no output.

### Step 2: Switch `CasesPage.exportCsv` to the helper

In `frontend/src/pages/CasesPage.tsx`:

1. Add this import immediately after the existing
   `import { cn } from "@/lib/utils";` (line 22):

   ```tsx
   import { downloadBlob } from "@/lib/download-blob";
   ```

2. Replace lines 175–181 (the six lines from `const url = URL.createObjectURL(blob);`
   through `URL.revokeObjectURL(url);`) with a single call, so the tail of
   `exportCsv` reads:

   ```tsx
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    downloadBlob(
      blob,
      `cases-export-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    toast.success(t("cases.exported", { count: data.cases.length }));
  }, [data, t]);
   ```

Do not change the CSV construction, the headers list, the quoting logic, the
`useCallback` dependency array, or the toast.

**Verify**:

```bash
cd frontend && npx tsc -b --noEmit && grep -c "URL.createObjectURL" src/pages/CasesPage.tsx
```

→ `tsc` exits 0, and `grep -c` prints `0`.

### Step 3: Switch `CollectionDetailPage.handleExport` to the helper

In `frontend/src/pages/CollectionDetailPage.tsx`:

1. Add this import immediately after
   `import { PageHeader } from "@/components/shared/PageHeader";` (line 25):

   ```tsx
   import { downloadBlob } from "@/lib/download-blob";
   ```

2. Replace lines 97–102 (from `const url = URL.createObjectURL(blob);` through
   `URL.revokeObjectURL(url);`) so the `try` block reads:

   ```tsx
      const blob = new Blob([html], { type: "text/html" });
      downloadBlob(blob, `${collection.name.replace(/[^a-z0-9]/gi, "_")}.html`);
      toast.success(t("bookmarks.export_success", "Report downloaded"));
   ```

Keep the surrounding `try` / `catch` / `finally` exactly as it is — the
`catch` already reports failure and the `finally` already clears `exporting`.

**Verify**:

```bash
cd frontend && npx tsc -b --noEmit && grep -c "URL.createObjectURL" src/pages/CollectionDetailPage.tsx
```

→ `tsc` exits 0, and `grep -c` prints `0`.

### Step 4: Cover the download helper

Create `frontend/__tests__/download-blob.test.ts` with exactly this content:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadBlob, BLOB_URL_REVOKE_DELAY_MS } from "@/lib/download-blob";

const createObjectURL = vi.fn(() => "blob:mock-url");
const revokeObjectURL = vi.fn();

describe("downloadBlob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    // jsdom implements neither of these.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("attaches the anchor to the document before clicking it", () => {
    let connectedAtClick = false;
    const clickSpy = vi
      .spyOn(HTMLElement.prototype, "click")
      .mockImplementation(function (this: HTMLElement) {
        connectedAtClick = this.isConnected;
      });

    downloadBlob(new Blob(["a,b"], { type: "text/csv" }), "cases.csv");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(connectedAtClick).toBe(true);
    clickSpy.mockRestore();
  });

  it("removes the anchor again once the click has been dispatched", () => {
    const clickSpy = vi
      .spyOn(HTMLElement.prototype, "click")
      .mockImplementation(() => {});

    downloadBlob(new Blob(["x"]), "x.txt");

    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    clickSpy.mockRestore();
  });

  it("does not revoke the object URL in the same task as the click", () => {
    const clickSpy = vi
      .spyOn(HTMLElement.prototype, "click")
      .mockImplementation(() => {});

    downloadBlob(new Blob(["x"]), "x.txt");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(BLOB_URL_REVOKE_DELAY_MS);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    clickSpy.mockRestore();
  });

  it("still detaches and revokes when click() throws", () => {
    const clickSpy = vi
      .spyOn(HTMLElement.prototype, "click")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    expect(() => downloadBlob(new Blob(["x"]), "x.txt")).toThrow("blocked");
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);

    vi.advanceTimersByTime(BLOB_URL_REVOKE_DELAY_MS);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    clickSpy.mockRestore();
  });
});
```

**Verify**: `cd frontend && npx vitest run __tests__/download-blob.test.ts` →
`Test Files 1 passed`, `Tests 4 passed`.

### Step 5: Debounce the global search input

In `frontend/src/components/shared/GlobalSearch.tsx`:

1. Change line 1 to add `useCallback`:

   ```tsx
   import { useState, useRef, useEffect, useMemo, useCallback } from "react";
   ```

2. Immediately after the `interface GlobalSearchDialogProps { ... }` block
   (which ends at line 16) and before `function GlobalSearchDialog(`, add:

   ```tsx
   /** Matches JudgeAutocomplete's debounce so the app searches at one rhythm. */
   const SEARCH_DEBOUNCE_MS = 300;
   /** Below this, a query is a prefix of everything and worth no round trip. */
   const MIN_SEARCH_CHARS = 2;
   ```

3. Replace the head of `GlobalSearchDialog` (current lines 19–28) with:

   ```tsx
     const { t } = useTranslation();
     const [query, setQuery] = useState("");
     const [debouncedQuery, setDebouncedQuery] = useState("");
     const [activeIdx, setActiveIdx] = useState(0);
     const inputRef = useRef<HTMLInputElement>(null);
     const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
     const navigate = useNavigate();
     const { data } = useSearchCases(debouncedQuery, 8);

     useEffect(() => {
       inputRef.current?.focus();
     }, []);

     // Cleanup debounce on unmount so a closed dialog cannot schedule state.
     useEffect(() => {
       return () => {
         if (debounceTimerRef.current) {
           clearTimeout(debounceTimerRef.current);
         }
       };
     }, []);

     const handleQueryChange = useCallback((value: string) => {
       setQuery(value);
       setActiveIdx(0); // reset keyboard nav on each keystroke

       if (debounceTimerRef.current) {
         clearTimeout(debounceTimerRef.current);
         debounceTimerRef.current = null;
       }

       const trimmed = value.trim();
       if (trimmed.length < MIN_SEARCH_CHARS) {
         // Nothing worth searching for — drop the query immediately so the
         // dialog never shows results left over from a longer prefix.
         setDebouncedQuery("");
         return;
       }

       debounceTimerRef.current = setTimeout(() => {
         setDebouncedQuery(trimmed);
       }, SEARCH_DEBOUNCE_MS);
     }, []);
   ```

   Then replace `cases`, `hasResults` and `isExpanded` (current lines 30–32).
   **A debounce on its own introduces a new lie**: for the 300 ms after a
   keystroke, `query` is the new text while `data` still holds the **previous**
   query's results. Those rows stay clickable, `aria-activedescendant` still
   points at one of them, and — worst — the `Enter` handler at
   `GlobalSearch.tsx:81-87` reads `cases[clampedActiveIdx]` and calls
   `navigate(\`/cases/${selectedCase.case_id}\`)`. Type `smith`, wait for
   results, type `jones`, press Enter within 300 ms, and you are navigated to a
   Smith case. Gate the results on the two queries agreeing:

   ```tsx
     // True while the user has typed something the hook has not been asked for
     // yet. Results on screen belong to `debouncedQuery`, not to `query`.
     const resultsAreStale = query.trim() !== debouncedQuery;
     const cases = resultsAreStale ? [] : (data?.cases ?? []);
     const hasResults = cases.length > 0;
     const isExpanded = hasResults && query.length > 0;
   ```

   Deriving `cases` as `[]` closes all three holes at once with no change to the
   keyboard handler, the list, or `clampedActiveIdx`: `hasResults` goes false so
   `onKeyDown` returns early on **every** key including `Enter`, the results
   `<ul>` (guarded by `cases.length > 0` at line 100) unmounts, and
   `aria-activedescendant` becomes `undefined`. Leave `clampedActiveIdx`
   (current lines 34–37) exactly as it is.

   Note `query.trim()` on the left: `handleQueryChange` stores the **trimmed**
   value into `debouncedQuery`, so comparing the raw `query` would leave the
   results permanently stale whenever the user types a trailing space.

4. Replace the `onChange` handler (current lines 65–68) with:

   ```tsx
                 onChange={(e) => handleQueryChange(e.target.value)}
   ```

5. Change the no-results guard on line 140 from `query.length > 0` to
   `debouncedQuery.length > 0`, so it reads:

   ```tsx
             {debouncedQuery.length > 0 && cases.length === 0 && (
   ```

   Without this, typing one character would render "no results" for a query
   that was never sent.

Do not change the keyboard handler, the results list, the shortcuts hint, or
the exported `GlobalSearch` wrapper.

**Verify**: `cd frontend && npx tsc -b --noEmit && npx eslint src/components/shared/GlobalSearch.tsx`
→ both exit 0 with no errors.

### Step 6: Cover the debounce

Create `frontend/__tests__/global-search-debounce.test.tsx` with exactly this
content:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const { mockUseSearchCases } = vi.hoisted(() => ({
  mockUseSearchCases: vi.fn(),
}));

vi.mock("@/hooks/use-cases", () => ({
  useSearchCases: mockUseSearchCases,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

// Radix's Dialog is only the presentation shell here. Replacing it with plain
// elements keeps this test about the debounce and avoids running Radix's
// focus-trap and scroll-lock timers under vi.useFakeTimers().
vi.mock("@radix-ui/react-dialog", () => {
  type P = { children?: React.ReactNode };
  return {
    Root: ({ children }: P) => <div>{children}</div>,
    Portal: ({ children }: P) => <div>{children}</div>,
    Overlay: () => null,
    Content: ({ children }: P) => <div>{children}</div>,
    Title: ({ children }: P) => <h2>{children}</h2>,
  };
});

import { GlobalSearch } from "@/components/shared/GlobalSearch";

function queriesSeen(): string[] {
  return mockUseSearchCases.mock.calls.map((call) => call[0] as string);
}

function typeAll(values: string[]) {
  const input = screen.getByRole("combobox");
  for (const value of values) {
    fireEvent.change(input, { target: { value } });
  }
}

describe("GlobalSearch debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseSearchCases.mockReset();
    mockUseSearchCases.mockReturnValue({ data: { cases: [] } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not issue a query for every keystroke", () => {
    render(<GlobalSearch open onClose={() => {}} />);
    typeAll(["m", "mi", "mig", "migr"]);

    expect(queriesSeen()).not.toContain("mi");
    expect(queriesSeen()).not.toContain("mig");
    expect(queriesSeen()).not.toContain("migr");
  });

  it("issues one query, for the final value, once the debounce elapses", () => {
    render(<GlobalSearch open onClose={() => {}} />);
    typeAll(["m", "mi", "mig", "migr"]);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(queriesSeen().filter((q) => q.length > 0)).toEqual(["migr"]);
  });

  it("never searches for a single character", () => {
    render(<GlobalSearch open onClose={() => {}} />);
    typeAll(["m"]);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(queriesSeen().every((q) => q === "")).toBe(true);
  });

  it("does not claim 'no results' while the debounce is still pending", () => {
    render(<GlobalSearch open onClose={() => {}} />);
    typeAll(["zz"]);

    // The i18n mock in __tests__/legislations-setup.ts returns the key string.
    expect(screen.queryByText("common.no_results")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText("common.no_results")).toBeTruthy();
  });

  it("does not navigate to a previous query's result during the debounce", () => {
    // The regression this guards: type "smith", let it resolve, type "jones",
    // press Enter inside the 300ms window. Without the staleness gate the
    // Enter handler reads cases[clampedActiveIdx] — still a Smith case — and
    // navigates there.
    const navigate = vi.fn();
    navigateMock.mockReturnValue(navigate);
    mockUseSearchCases.mockReturnValue({
      data: {
        cases: [
          {
            case_id: "smithcase01",
            title: "Smith v Minister",
            citation: "[2024] FCA 1",
            court_code: "FCA",
            date: "2024-01-01",
          },
        ],
      },
    });

    render(<GlobalSearch open onClose={() => {}} />);
    typeAll(["smith"]);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // The result is on screen and selectable for the settled query.
    expect(screen.getByText("Smith v Minister")).toBeTruthy();

    // Now type a different query and hit Enter before the debounce elapses.
    typeAll(["jones"]);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByText("Smith v Minister")).toBeNull();
  });

  it("does not let a click land on a previous query's result either", () => {
    const navigate = vi.fn();
    navigateMock.mockReturnValue(navigate);
    mockUseSearchCases.mockReturnValue({
      data: {
        cases: [
          {
            case_id: "smithcase01",
            title: "Smith v Minister",
            citation: "[2024] FCA 1",
            court_code: "FCA",
            date: "2024-01-01",
          },
        ],
      },
    });

    render(<GlobalSearch open onClose={() => {}} />);
    typeAll(["smith"]);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    typeAll(["jones"]);

    // The row must be gone, not merely non-navigating.
    expect(screen.queryByRole("option")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

Change the `react-router-dom` mock at the top of the file so the navigate
function is observable — replace `useNavigate: () => vi.fn()` with:

```tsx
const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigateMock() }));
```

and give it a default in `beforeEach`: `navigateMock.mockReturnValue(vi.fn());`.

**Verify**: `cd frontend && npx vitest run __tests__/global-search-debounce.test.tsx`
→ `Test Files 1 passed`, `Tests 6 passed`.

Confirm the two new cases genuinely bite before you accept them:
```bash
cd frontend && npx vitest run __tests__/global-search-debounce.test.tsx \
  -t "does not navigate to a previous query's result during the debounce"
```
→ `1 passed` after Step 5; it must **fail** if you temporarily revert the
`resultsAreStale` line to `const cases = data?.cases ?? [];`.

### Step 7: Make the recall-code copy tell the truth

In `frontend/src/components/llm-council/StreamingCouncilView.tsx`, replace
`RecallCodeCard`'s state and handler (current lines 677–688) with:

```tsx
function RecallCodeCard({ code }: { code: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const onCopy = useCallback(async () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    try {
      // navigator.clipboard is undefined outside a secure context, and
      // writeText() *rejects* on denied permission or an unfocused document.
      // Both must be observed before claiming success: this code is the only
      // handle the user has for restoring the session.
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
      playHaptic();
    } catch {
      setCopyState("failed");
    }
    resetTimerRef.current = setTimeout(() => setCopyState("idle"), 2000);
  }, [code]);
```

Then update the button (current lines 716–734) to render three states, and add
a manual-copy hint. The button becomes:

```tsx
          <button
            type="button"
            onClick={() => {
              void onCopy();
            }}
            data-testid="recall-code-copy"
            aria-label="Copy recall code"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:border-accent/60 hover:bg-accent/10 hover:text-accent"
          >
            {copyState === "copied" ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Copied
              </>
            ) : copyState === "failed" ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                Copy failed
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
```

The card's closing markup currently nests like this (lines 735–739):

```tsx
        </div>      {/* closes  flex items-center gap-2  (code + button) */}
      </div>        {/* closes  flex flex-wrap items-center justify-between gap-3 */}
    </div>          {/* closes the outer card div opened on line 690 (data-testid="recall-code-card") */}
  );
}
```

Insert the hint **between the second and third closing `</div>`** — i.e. as the
last child of the outer card, after the `justify-between` row closes:

```tsx
      {copyState === "failed" ? (
        <div
          data-testid="recall-code-copy-failed"
          className="mt-2 text-[11px] text-amber-700 dark:text-amber-400"
        >
          Copy failed — select the code above and copy it manually.
        </div>
      ) : null}
```

Keep the `<code data-testid="recall-code-value">` element, its `select-all`
class, and every other class name unchanged — the failure path relies on the
code staying selectable on screen. Do **not** import `toast` or
`useTranslation` into this file; it has neither today.

`AlertTriangle`, `useCallback`, `useEffect`, `useRef` and `useState` are all
already imported at the top of the file — add nothing.

**Verify**:

```bash
cd frontend && npx tsc -b --noEmit \
  && grep -n "await navigator.clipboard.writeText" src/components/llm-council/StreamingCouncilView.tsx
```

→ `tsc` exits 0 and grep prints exactly one line.

### Step 8: Guard the council stream's teardown on the generation token

In the same file, replace the `finally` block at lines 362–366 with:

```tsx
      } finally {
        clearInterval(watchdog);
        // Only tear down the shared ref/state if this run is still the
        // current one. A superseded run reaches here *after* start() has
        // installed the successor's controller and bumped genRef, so an
        // unguarded teardown would null the successor's AbortController and
        // clear its isStreaming flag. Every other state-touching block in
        // this hook is already gated the same way (see `update` and the
        // watchdog interval above).
        if (myGen === genRef.current) {
          controllerRef.current = null;
          setIsStreaming(false);
        }
      }
```

`clearInterval(watchdog)` stays **outside** the guard — a superseded run must
still stop its own interval.

**The guard alone is not sufficient: unmount must also be handled.** There are
three producers of the rejection that reaches this `finally` —
a superseding `start()` (`:194`), the watchdog (`:226`), and the **unmount
cleanup** (`:371-376`, `return () => { controllerRef.current?.abort(); }`). Only
the first bumps `genRef`. On unmount `myGen === genRef.current` still holds, so
the new guard lets the teardown through and it calls `setIsStreaming(false)` on
an unmounted component. Bump the generation in the cleanup, **before** aborting,
so every `myGen`-gated block in the hook — this `finally`, `update()`, and the
watchdog interval — becomes a no-op together:

```tsx
  // Cleanup on unmount. Bump the generation FIRST: the abort below makes the
  // in-flight fetch reject on a later microtask, and every state-touching block
  // in start() is gated on `myGen === genRef.current`.
  useEffect(() => {
    return () => {
      genRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, []);
```

> If `plans/015-surface-frontend-errors.md` Step 2 has already landed, this
> effect will already contain the `genRef.current += 1;` line — 015 needs the
> same bump so its watchdog-timeout branch does not fire on unmount. In that
> case leave it as it is and only confirm the ordering is bump-then-abort.

Change nothing else in `start()`, `abort()` or `reset()`.

**Verify**:
```bash
cd frontend && npx tsc -b --noEmit \
  && npx eslint src/components/llm-council/StreamingCouncilView.tsx \
  && grep -c "genRef.current += 1" src/components/llm-council/StreamingCouncilView.tsx
```
→ `tsc` and `eslint` exit 0 with no errors, and the grep prints exactly `1` —
the unmount bump. (`start()`'s existing `const myGen = ++genRef.current;` uses a
different form and does not match this pattern.) If it prints `2` you have
duplicated the bump, most likely because 015 landed first and you added it
again; delete yours.

### Step 9: Cover the clipboard states and the stream re-entrancy

Create `frontend/__tests__/streaming-council-view.test.tsx` with exactly this
content:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import {
  StreamingCouncilView,
  useCouncilStream,
  type CouncilStreamState,
} from "@/components/llm-council/StreamingCouncilView";

function doneStateWithCode(code: string): CouncilStreamState {
  const expert = { text: "", status: "done" as const };
  return {
    openai: expert,
    gemini_pro: expert,
    anthropic: expert,
    moderator: { status: "complete" },
    council: { status: "done" },
    session: { sessionId: "s-1", sessionToken: "t-1", retrieveCode: code },
    startedAt: Date.now(),
  };
}

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("RecallCodeCard clipboard", () => {
  afterEach(() => {
    setClipboard(undefined);
  });

  it("confirms the copy only after writeText resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(<StreamingCouncilView state={doneStateWithCode("ABC123")} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("recall-code-copy"));
    });

    expect(writeText).toHaveBeenCalledWith("ABC123");
    expect(screen.getByTestId("recall-code-copy").textContent).toContain(
      "Copied",
    );
    expect(screen.queryByTestId("recall-code-copy-failed")).toBeNull();
  });

  it("reports failure when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    setClipboard({ writeText });

    render(<StreamingCouncilView state={doneStateWithCode("ABC123")} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("recall-code-copy"));
    });

    expect(screen.getByTestId("recall-code-copy").textContent).toContain(
      "Copy failed",
    );
    expect(screen.getByTestId("recall-code-copy-failed")).toBeTruthy();
    // The code itself must stay on screen so it can be copied by hand.
    expect(screen.getByTestId("recall-code-value").textContent).toBe("ABC123");
  });

  it("reports failure when the Clipboard API is absent entirely", async () => {
    setClipboard(undefined);

    render(<StreamingCouncilView state={doneStateWithCode("ABC123")} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("recall-code-copy"));
    });

    expect(screen.getByTestId("recall-code-copy").textContent).toContain(
      "Copy failed",
    );
  });
});

describe("useCouncilStream re-entrancy", () => {
  const signals: AbortSignal[] = [];
  const rejecters: Array<(reason: unknown) => void> = [];

  beforeEach(() => {
    signals.length = 0;
    rejecters.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init: { signal: AbortSignal }) => {
        signals.push(init.signal);
        // The mock MUST honour the signal. A promise that only ever settles
        // when the test calls rejecters[i] does not model the browser: an
        // abort the test never explicitly rejects (an unmount, a second
        // start() the test does not tear down) would leave the promise
        // pending forever, so the hook's finally/catch never runs, the
        // watchdog interval is never cleared, and the "assertion" passes
        // because the code under test never executed. Reject on abort.
        return new Promise((_resolve, reject) => {
          rejecters.push(reject);
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function startTwoRuns() {
    const hook = renderHook(() => useCouncilStream());
    await act(async () => {
      void hook.result.current.start({ message: "first" });
    });
    await act(async () => {
      void hook.result.current.start({ message: "second" });
    });
    // The abort listener above already rejected run A's promise; flush the
    // microtasks so its catch/finally runs after the successor installed its
    // own controller. (rejecters[0] is left in place as a belt-and-braces
    // escape hatch; calling it a second time is a no-op on a settled promise.)
    await flush();
    return hook;
  }

  /**
   * Every test in this block MUST settle its runs before finishing. A hook
   * left mid-stream keeps a 5s watchdog interval alive into the next test.
   * Use this in place of a bare `unmount()`.
   */
  async function unmountAndSettle(hook: { unmount: () => void }) {
    hook.unmount();
    await flush();
  }

  it("aborts the previous run and opens a second request", async () => {
    const hook = await startTwoRuns();
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    await unmountAndSettle(hook);
  });

  it("keeps isStreaming true when the superseded run tears down", async () => {
    const hook = await startTwoRuns();
    expect(hook.result.current.isStreaming).toBe(true);
    await unmountAndSettle(hook);
  });

  it("leaves the successor's AbortController reachable by abort()", async () => {
    const hook = await startTwoRuns();

    await act(async () => {
      hook.result.current.abort();
    });
    await flush();

    expect(signals[1].aborted).toBe(true);
    expect(hook.result.current.isStreaming).toBe(false);
    await unmountAndSettle(hook);
  });

  it("still clears isStreaming when the only run fails", async () => {
    const hook = renderHook(() => useCouncilStream());
    await act(async () => {
      void hook.result.current.start({ message: "only" });
    });
    await act(async () => {
      rejecters[0](new Error("boom"));
      await Promise.resolve();
    });
    await flush();

    expect(hook.result.current.isStreaming).toBe(false);
    expect(hook.result.current.state.council.status).toBe("error");
    await unmountAndSettle(hook);
  });

  it("touches no state when the component unmounts mid-stream", async () => {
    // The guard added in Step 8 is gen-based, and unmount does not bump the
    // generation on its own — hence the cleanup change. Without it, React
    // logs a setState-after-unmount warning here and the hook's teardown runs
    // against a dead component.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const hook = renderHook(() => useCouncilStream());
    await act(async () => {
      void hook.result.current.start({ message: "only" });
    });
    expect(hook.result.current.isStreaming).toBe(true);

    await unmountAndSettle(hook);

    // The abort listener in the fetch mock has rejected by now; if the hook
    // did not bump genRef, its finally/catch ran against the unmounted tree.
    const messages = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(messages).not.toMatch(/unmounted|not wrapped in act/i);
    errorSpy.mockRestore();
  });

  it("leaves no live watchdog interval behind after unmount", async () => {
    vi.useFakeTimers();
    try {
      const hook = renderHook(() => useCouncilStream());
      await act(async () => {
        void hook.result.current.start({ message: "only" });
      });
      const during = vi.getTimerCount();
      await unmountAndSettle(hook);
      // Compare against the count while the run was live — an absolute
      // "0 timers" assertion is not safe under jsdom, but the delta is.
      expect(vi.getTimerCount()).toBeLessThan(during);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

The fourth case is the regression guard for Step 8's guard itself: it proves the
new `myGen` check did not break the ordinary single-run teardown. The fifth and
sixth are the regression guards for the unmount half — they are the ones that
fail if you add the `finally` guard without the `genRef` bump in the cleanup.

**Verify**: `cd frontend && npx vitest run __tests__/streaming-council-view.test.tsx`
→ `Test Files 1 passed`, `Tests 9 passed`.

### Step 10: Make share links basename-aware

In `frontend/src/lib/saved-searches.ts`:

1. Add a second import line directly under line 1:

   ```ts
   import { resolveRouterBasename } from "@/lib/router";
   ```

2. Replace `generateShareableUrl` (lines 298–305) with:

   ```ts
   /**
    * Generate a shareable URL for a saved search.
    *
    * The SPA is served at "/" in production (Cloudflare Worker static assets)
    * and at "/app" on the legacy local-dev Flask surface. resolveRouterBasename()
    * is the single source of truth for which one is live — App.tsx feeds it to
    * BrowserRouter. A share URL that drops the basename lands outside the router.
    *
    * `basename` is injectable so the function is unit-testable without
    * mutating window.location; callers should omit it.
    */
   export function generateShareableUrl(
     filters: CaseFilters,
     basename: string = resolveRouterBasename(window.location.pathname),
   ): string {
     const params = encodeFiltersToUrl(filters);
     const prefix = basename === "/" ? "" : basename.replace(/\/$/, "");
     const baseUrl = `${window.location.origin}${prefix}/cases`;
     return params ? `${baseUrl}?${params}` : baseUrl;
   }
   ```

The new parameter is optional, so
`frontend/src/components/saved-searches/SavedSearchCard.tsx:80` keeps compiling
and behaving unchanged. **Do not edit that file.**

**Verify**: `cd frontend && npx tsc -b --noEmit` → exit 0, no output.

### Step 11: Cover the share-URL basename

Create `frontend/__tests__/saved-search-share-url.test.ts` with exactly this
content:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { generateShareableUrl } from "@/lib/saved-searches";
import type { CaseFilters } from "@/types/case";

const filters: CaseFilters = { court: "FCA", keyword: "visa" };

describe("generateShareableUrl", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("builds a root-basename URL when the SPA is served at /", () => {
    expect(generateShareableUrl(filters, "/")).toBe(
      `${window.location.origin}/cases?court=FCA&keyword=visa&page=1`,
    );
  });

  it("keeps the /app basename so the link lands inside the router", () => {
    expect(generateShareableUrl(filters, "/app")).toBe(
      `${window.location.origin}/app/cases?court=FCA&keyword=visa&page=1`,
    );
  });

  it("derives the basename from the current location by default", () => {
    window.history.pushState({}, "", "/app/cases");
    expect(generateShareableUrl(filters)).toBe(
      `${window.location.origin}/app/cases?court=FCA&keyword=visa&page=1`,
    );
  });

  it("always pins shared searches to page 1", () => {
    expect(generateShareableUrl({}, "/")).toBe(
      `${window.location.origin}/cases?page=1`,
    );
  });
});
```

**Verify**: `cd frontend && npx vitest run __tests__/saved-search-share-url.test.ts`
→ `Test Files 1 passed`, `Tests 4 passed`.

### Step 12: Run the full gate

Record the baseline **before** your first edit (or read it off the run you did
during the drift check):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run 2>&1 | tail -6   # BEFORE_TESTS, BEFORE_FILES
npx eslint . 2>&1 | tail -3     # BEFORE_WARNINGS
```

Then:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx tsc -b --noEmit
npx vitest run
npx eslint .
npm run build:cloudflare
```

**Verify**:

- `npx tsc -b --noEmit` → exit 0, no output.
- `npx vitest run` → **0 failed**, `AFTER_FILES == BEFORE_FILES + 4`, and
  `AFTER_TESTS == BEFORE_TESTS + 23`. **Do not assert an absolute suite total** —
  plans 015, 016 and 018 add tests to the same suite, so an absolute number
  would make parallel execution impossible and train the next executor to edit
  the yardstick. The binding per-file counts are 4 + 6 + 9 + 4 = 23:
  ```bash
  npx vitest run __tests__/download-blob.test.ts             # 4 passed
  npx vitest run __tests__/global-search-debounce.test.tsx   # 6 passed
  npx vitest run __tests__/streaming-council-view.test.tsx   # 9 passed
  npx vitest run __tests__/saved-search-share-url.test.ts    # 4 passed
  ```
- `npx eslint .` → exit 0, `0 errors`, and no more warnings than
  `BEFORE_WARNINGS` (this plan introduces none).
- `npm run build:cloudflare` → exit 0. **This is the binding build**, not
  `npm run build`: `npm run build` writes
  `../immi_case_downloader/static/react` (`frontend/vite.config.ts:34`, the
  local-dev Flask surface), while `build:cloudflare` writes `frontend/dist`,
  which is what `wrangler.toml:15` (`[assets] directory = "./frontend/dist"`)
  actually serves in production.

Then, from the repo root, confirm scope against the baseline you saved:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --porcelain=v1 -uall > /tmp/immi-017-final-status.txt
diff /tmp/immi-017-baseline-status.txt /tmp/immi-017-final-status.txt
```

→ only **added** lines, and every one of them is one of the ten files named in
"In scope" (five `M`, five `??`). Pre-existing dirt must be unchanged, and you
must not remove it.

## Test plan

Four new files under `frontend/__tests__/`, 19 tests total. Model them on
`frontend/__tests__/collection-pages.test.tsx` (hoisted `vi.hoisted` mock
factories, module-level `vi.mock`, explicit imports from `"vitest"`) — the exact
content is given verbatim in Steps 4, 6, 9 and 11, so transcribe rather than
invent.

| File | Tests | Covers |
|---|---|---|
| `download-blob.test.ts` | 4 | anchor attached before click; anchor detached after; revoke deferred past the click task; detach + revoke still happen when `click()` throws |
| `global-search-debounce.test.tsx` | 6 | intermediate prefixes never reach the hook; exactly one query for the final value after 300 ms; a 1-character query is never sent; no "no results" panel while the debounce is pending; **Enter during the debounce does not navigate to the previous query's result**; **the previous query's rows are not on screen to be clicked** |
| `streaming-council-view.test.tsx` | 9 | copy confirmed only after `writeText` resolves; failure shown on rejection; failure shown when `navigator.clipboard` is absent; second `start()` aborts the first; `isStreaming` survives the superseded teardown; the successor's controller stays reachable by `abort()`; a lone failing run still clears `isStreaming`; **unmount mid-stream touches no state**; **unmount leaves no live watchdog interval** |
| `saved-search-share-url.test.ts` | 4 | root basename; `/app` basename; basename derived from `window.location`; `page=1` always pinned |

Each of the four files fails against the code as it exists at `42826a3` and
passes after its step — that is the point of writing them in this order.

Do **not** add Playwright E2E coverage; `tests/e2e/` needs a running server and
is out of scope.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd frontend && npx tsc -b --noEmit` exits 0 with no output
- [ ] `cd frontend && npx vitest run` reports **0 failed**, with
      `AFTER_FILES == BEFORE_FILES + 4` and `AFTER_TESTS == BEFORE_TESTS + 23`
      against the baseline recorded in Step 12 (never an absolute total)
- [ ] Each new file hits its own count: `download-blob.test.ts` → 4;
      `global-search-debounce.test.tsx` → 6;
      `streaming-council-view.test.tsx` → 9;
      `saved-search-share-url.test.ts` → 4
- [ ] The two staleness cases pass **by name**:
      `npx vitest run __tests__/global-search-debounce.test.tsx -t "does not navigate to a previous query's result during the debounce"`
      and `-t "touches no state when the component unmounts mid-stream"` on
      `__tests__/streaming-council-view.test.tsx`
- [ ] `cd frontend && npx eslint .` exits 0 with `0 errors` and no more warnings
      than the recorded baseline
- [ ] `cd frontend && npm run build:cloudflare` exits 0 (the artifact
      `wrangler.toml:15` actually serves)
- [ ] `cd frontend && grep -rn "URL.createObjectURL" src/pages/CasesPage.tsx src/pages/CollectionDetailPage.tsx`
      returns no matches
- [ ] `cd frontend && grep -c "downloadBlob" src/pages/CasesPage.tsx src/pages/CollectionDetailPage.tsx`
      prints `2` for each file (the import and the call)
- [ ] `cd frontend && grep -n "await navigator.clipboard.writeText" src/components/llm-council/StreamingCouncilView.tsx`
      returns exactly one line
- [ ] `cd frontend && grep -c "if (myGen === genRef.current)" src/components/llm-council/StreamingCouncilView.tsx`
      returns `1`
- [ ] `cd frontend && grep -c "genRef.current += 1" src/components/llm-council/StreamingCouncilView.tsx`
      returns `1` (the unmount bump)
- [ ] `cd frontend && grep -n "useSearchCases(debouncedQuery, 8)" src/components/shared/GlobalSearch.tsx`
      returns exactly one line
- [ ] `cd frontend && grep -c "resultsAreStale" src/components/shared/GlobalSearch.tsx`
      returns `2` (the declaration and its use)
- [ ] `cd frontend && grep -n "resolveRouterBasename" src/lib/saved-searches.ts`
      returns exactly two lines (the import and the default argument)
- [ ] `diff /tmp/immi-017-baseline-status.txt /tmp/immi-017-final-status.txt`
      shows only added lines, all of them in the "In scope" list
- [ ] The new status for this plan's `plans/README.md` row is **reported**; the
      row is edited only if you are running this plan alone (see Sequencing)

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check prints any file, and the live code does not match the
  verbatim excerpts in "Current state".
- `npx vitest run` shows any test failing that was passing before your change —
  in particular `__tests__/llm-council-page.test.tsx`, which renders
  `StreamingCouncilView` through `LlmCouncilPage` and is the most likely
  casualty of Step 7's markup change.
- The `useCouncilStream` re-entrancy tests in Step 9 fail **after** Step 8 with
  a message about `DOMException` being undefined, or hang. That would mean this
  Vitest/jsdom combination does not expose the globals the test assumes; report
  it rather than rewriting the hook to suit the test.
- The Step 6 debounce tests fail with a Radix or focus-trap error despite the
  `@radix-ui/react-dialog` mock. Report the error; do not start disabling fake
  timers or reaching for `waitFor` loops, which would make the test
  non-deterministic.
- `npx eslint .` reports more warnings than the baseline you recorded, or any
  error. In particular a `react-hooks/exhaustive-deps` error on the new
  `useCallback`s means the dependency arrays in Steps 5 or 7 were transcribed
  wrong — fix the array, never silence the rule.
- Fixing something appears to require editing
  `frontend/src/components/saved-searches/SavedSearchCard.tsx`,
  `frontend/src/pages/CaseDetailPage.tsx`, or
  `frontend/src/pages/DesignTokensPage.tsx`. All three are explicitly out of
  scope and are owned by, or deferred to, other work
  (`CaseDetailPage.tsx` is owned by `plans/015` Step 1b).
- **`frontend/src/hooks/use-cases.ts` is the exception**: if it has changed
  since `42826a3`, that is expected — `plans/016` Step 5 adds one line to it.
  Re-read the `useSearchCases` excerpt and continue. Do not stop, and do not
  edit the file.
- You discover that `StreamingCouncilView.tsx` has grown an i18n or `toast`
  dependency since this plan was written. The Step 7 design assumes it has
  neither; re-check before choosing how to surface the failure.

## Maintenance notes

For the human or agent who owns this code next:

- **What a reviewer should scrutinise.** Step 7 changes a `boolean` into a
  three-state union in a component whose markup an existing test renders
  (`__tests__/llm-council-page.test.tsx`). Check the button's `data-testid`
  and `aria-label` are unchanged, and that the `select-all` class on
  `recall-code-value` survives — the manual-copy fallback depends on it.
  Step 8 is three lines but changes teardown ordering in a hook with a
  watchdog interval; confirm `clearInterval(watchdog)` is still **outside**
  the guard.

- **Two more unawaited clipboard writes existed at `42826a3`; one is now
  claimed:**
  - `frontend/src/pages/CaseDetailPage.tsx:79-84` — no `await`, no `catch` at
    all, and a 2 s `setTimeout` that is never cleared on unmount or re-copy.
    **Now fixed by `plans/015-surface-frontend-errors.md` Step 1b**, which
    already owns that file. Not a leftover.
  - `frontend/src/pages/DesignTokensPage.tsx:386-389` — fires the write, then
    `toast.success` unconditionally. **Still open**; no plan owns that file.

  The correct shape for both is
  `frontend/src/components/saved-searches/SavedSearchCard.tsx:78-86`.

- **Two more copies of the blob idiom remain**, and should adopt
  `downloadBlob()` from Step 1 when someone owns those files:
  - `frontend/src/pages/DesignTokensPage.tsx:2487-2495`
  - `frontend/src/components/cases/CaseTextViewer.tsx:296-304` — a fourth site
    the original audit did not find.

  Once all four call sites use the helper, a repo-wide
  `grep -rn "createObjectURL" frontend/src` should return only
  `frontend/src/lib/download-blob.ts`.

- **Deferred: `placeholderData: keepPreviousData` on `useSearchCases`**
  (`frontend/src/hooks/use-cases.ts:88-95`). The 300 ms debounce stops the
  request storm, but the result list still empties for one render between
  debounced queries. Adding `placeholderData` there would fix that for every
  caller of the hook, not just `GlobalSearch`. It was left out because
  `use-cases.ts` is shared and outside this plan's territory.

- **Future interaction — `MIN_SEARCH_CHARS = 2`.** If the backend ever grows a
  prefix/typeahead endpoint where single-character queries are meaningful, the
  floor in `GlobalSearch.tsx` must be revisited. It is a client-side policy,
  deliberately not enforced in `useSearchCases`.

- **Future interaction — the `/app` basename.** Production serves the SPA at
  the root of `immi.trackit.today` from the Cloudflare Worker's `ASSETS`
  binding, so `resolveRouterBasename` returns `"/"` there and Step 10 is a
  no-op in production today. It matters on the legacy local-dev Flask mount at
  `/app/`. If that mount is ever deleted, `resolveRouterBasename`,
  `frontend/__tests__/router-basename.test.ts` and the `basename` parameter
  added in Step 10 can all be deleted together.

- **Future interaction — `frontend/tsconfig.test.json`.** If
  `plans/001-restore-the-frontend-compile-gate.md` lands, `frontend/__tests__/`
  starts being type-checked by `tsc -b`. The four test files added here are
  written to be type-clean (no `any`, explicit parameter types on every mock
  factory), but re-run `npx tsc -b --noEmit` after that plan merges.

## Findings reconsidered

- **"Rapid re-submit corrupts `useCouncilStream` state" — trigger corrected,
  fix kept (Step 8).** The code defect is real and the lines are exact: the
  `finally` at `StreamingCouncilView.tsx:362-366` is the only state-touching
  block in the hook not gated on `myGen === genRef.current`. But the stated
  trigger — "submit A, then submit B a second later" — is **not reachable
  through the UI today**. Every submit route is gated on `stream.isStreaming`:
  the Send button is `disabled={stream.isStreaming || !message.trim()}`
  (`frontend/src/pages/LlmCouncilPage.tsx:934`), the composer is
  `disabled={disabled || isPending}` with `isPending={stream.isStreaming}`
  (`:571`, `:900`), the Cmd/Ctrl+Enter handler and the swipe-to-send handle
  both funnel through `canSubmit()` (`:516-517`, `:525`, `:547`) and the handle
  is hidden while pending (`:559`), and `abort()` is wired to no UI control at
  all. So the "two concurrent paid council runs" consequence does not follow.
  This is **latent hardening**, kept because the fix is three lines and the
  guard becomes load-bearing the moment any programmatic re-run is added.

- **"Blob downloads revoke the object URL synchronously" — severity corrected,
  refactor kept (Steps 1–3).** All three cited sites match exactly. But the
  browser-behaviour claim is not demonstrated: click-then-revoke-in-the-same-turn
  is a very widespread idiom and current Chromium, Firefox and WebKit all
  resolve the blob during click dispatch. No failure was reproduced and there
  is no evidence of one in this repo. Steps 1–3 are therefore framed as
  **de-duplication plus portability hardening**, not as a bug fix — and the
  helper's doc comment says so, so nobody later reads it as a fixed defect.

- **"Share links drop the basename" — deployment relevance corrected, fix kept
  (Step 10).** `frontend/src/lib/saved-searches.ts:303` really does hardcode
  `${window.location.origin}/cases`, and `resolveRouterBasename` really does
  return `/app` for `/app/*` paths. But production serves the SPA at the **root**
  of `immi.trackit.today` from the Worker's `ASSETS` binding, so
  `resolveRouterBasename` returns `"/"` there and the generated URL is already
  correct in production. The `/app/` basename is the legacy Flask mount, which
  `CLAUDE.md` marks local-dev-only. This is a **local-dev-only defect today**,
  which is why this plan is P3. Fixed anyway because the fix is one optional
  parameter and it removes the app's only URL builder that ignores the router.

- **"`handleNewCollection` dynamically re-imports an already-imported module" —
  rejected; no step.** The code is exactly as cited
  (`frontend/src/pages/CaseDetailPage.tsx:416-433` calls `createCollection` at
  `:419` and `addCaseToCollection` at `:420`, then a floating
  `import("@/hooks/use-bookmarks").then(...)` at `:422-430` with no `.catch()`,
  while the same module is statically imported at `:29-33`). Both stated
  consequences fail. Because the module is imported both statically **and**
  dynamically from the same file, Rollup/Vite keeps it in the same chunk —
  it emits the "dynamic import will not move module into another chunk"
  warning for exactly this shape — so `import()` resolves on a microtask with
  no network fetch, and the described post-deploy chunk-fetch failure cannot
  occur. The "collection references a case with no bookmark" window closes
  before the browser can paint, let alone before a user can navigate; the
  orphan filter at `frontend/src/pages/CollectionDetailPage.tsx:166-168` never
  observes it. What remains is cosmetic (a pointless dynamic import and an
  uncaught floating promise) in a file this plan does not own. Recorded here so
  it is not re-audited as a defect.

- **Clipboard sites outside this plan's territory — reassigned, not dropped.**
  `frontend/src/pages/CaseDetailPage.tsx:81` and
  `frontend/src/pages/DesignTokensPage.tsx:387` have the same unawaited-write
  bug as Step 7 and are genuinely broken. `CaseDetailPage.tsx` is now fixed by
  `plans/015-surface-frontend-errors.md` Step 1b — 015 already modifies that
  file, so it is the natural owner and the "two behaviours after the abstraction
  lands" objection does not apply to it. `DesignTokensPage.tsx` remains open;
  it is listed with exact line numbers and the correct fix shape under
  "Maintenance notes".

- **The debounce introduced a second lie, now fixed in the same step
  (revised 2026-08-28).** Adding a 300 ms debounce without gating the results
  leaves a window where `query` is the new text while `data` still holds the
  previous query's results. Verified against the live code:
  `GlobalSearch.tsx:81-87`'s `Enter` handler reads `cases[clampedActiveIdx]` and
  calls `navigate(\`/cases/${selectedCase.case_id}\`)`, and the `<li>` buttons at
  `:107-113` do the same on click — so the debounce alone would let a user
  navigate to a *Smith* case while the input reads *jones*. Step 5 now derives
  `cases` from a `resultsAreStale` check so the rows, the keyboard selection and
  `aria-activedescendant` all disappear together, and Step 6 tests both the
  Enter path and the click path.

## Review points not applied

One point from the 2026-08-28 cross-plan review was checked and **not** turned
into work here, with the evidence:

- **"Migrate `CaseTextViewer`'s blob download to the new helper too, otherwise
  two behaviours survive the abstraction."** The observation is correct —
  `frontend/src/components/cases/CaseTextViewer.tsx:296-304` is a fourth copy of
  the idiom — but the file is **already claimed by another plan**:
  `plans/020-fix-render-performance.md` lists
  `frontend/src/components/cases/CaseTextViewer.tsx` in its **In scope** block.
  Taking it here would put two plans on one file, which is exactly the failure
  mode the file-territory partition exists to prevent, and this plan is P3 while
  020 is not. It stays in "Maintenance notes" with the exact line range and the
  `grep -rn "createObjectURL" frontend/src` completion check, so 020 (or whoever
  follows) can finish the migration in one move.
