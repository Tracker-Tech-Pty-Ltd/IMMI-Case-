# Plan 039: Make the mocks able to fail and the assertions about behaviour

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` **only if that file already exists**; if it does not, skip
> that — do not create it (it is outside this plan's file territory).
>
> **Drift check (run first)** — all four commands. A `42826a3..HEAD` diff cannot
> see uncommitted, staged or untracked changes, so on a dirty tree it gives a
> false all-clear:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> IN_SCOPE=(frontend/__tests__/legislations-setup.ts frontend/__tests__/i18n-hardcoded.test.ts frontend/__tests__/route-guards.test.tsx frontend/__tests__/no-as-any.test.tsx frontend/__tests__/hooks frontend/src/contexts/AuthContext.tsx frontend/src/hooks/use-theme-preset.ts frontend/src/hooks/use-keyboard.ts frontend/vitest.config.ts)
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $IN_SCOPE   # committed since planning
> git diff --stat -- $IN_SCOPE                 # unstaged
> git diff --cached --stat -- $IN_SCOPE        # staged
> ```
> The last three must print nothing. **Expected exception**: `frontend/vitest.config.ts`
> *will* appear once `plans/002-fix-test-collection-and-install.md` has landed —
> that is this plan's declared dependency, not drift. Anything else appearing in
> any of the three diffs is a STOP condition: compare the "Current state"
> excerpts against the live code before proceeding.
>
> Never run `git checkout --` or `git clean -f` to "clear" drift — that destroys
> the operator's or a parallel plan's work. Report and stop.
>
> **Parallel execution**: run this plan in its own `git worktree` or clone if
> anything else is running. It asserts on `git status --short`, which a shared
> checkout makes meaningless.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/002-fix-test-collection-and-install.md` (hard —
  ordering), and transitively `plans/001-restore-the-frontend-compile-gate.md`
  because 002 depends on it. **Run 002 first.**
- **Category**: tests
- **Planned at**: commit `42826a3`, 2026-08-27
- **Executed**: 2026-08-28, branch `fix-frontend-test-harness-039`,
  commits `9b76a9d`..`f219053` (Steps 1–8, all done criteria verified). Branched
  from current `main` (`bc0af27`), 20+ commits past the plan's `42826a3` base;
  plan 002 (and, transitively, 001) had already landed, so the declared
  dependency was satisfied. Two pieces of the plan's evidence had drifted by
  execution time and were adapted rather than followed literally — see the
  executor's report for the diagnostic detail: (1) `use-theme-preset.ts`'s
  shipped default preset changed from `"claude"` to `"parchment"` the same day,
  and the `readStoredPreset()` migration branch the plan quoted was deleted, so
  Step 5's two fallback assertions target `"parchment"`; (2) Step 7's
  boundary-precision timer test flaked under the plan's one authorized
  adjustment (`shouldAdvanceTime: true`) — confirmed via instrumentation to be
  real-time drift leaking into the fake clock, not an AuthContext.tsx defect —
  so `waitFor` was replaced with a deterministic microtask-flush helper
  instead, verified drift-free across 12+ repeated runs.

Why the 002 dependency is hard, not advisory: plan 002 Step 1 widens the Vitest
`include` glob in `frontend/vitest.config.ts` so that
`frontend/src/lib/__tests__/saved-searches.test.ts` (28 tests) is collected for
the first time. That file calls
`Object.defineProperty(window, "localStorage", ...)` at its line 31 — the same
property this plan's Step 1 redefines in the shared setup file. Running this
plan first would make plan 002's own "Cannot redefine property" analysis stale,
and every count in this plan would be measured against a suite that is about to
grow. Run 002, then this.

Note on plan 001: it repairs the frontend compile gate. This plan does **not**
require it directly — files under `frontend/__tests__/` are not included by any
tsconfig today (`frontend/tsconfig.app.json` has `include: ["src"]`), so
`tsc -b` never sees them, and this plan's gates are `vitest` and `eslint`. It is
pulled in transitively through 002. See "Maintenance notes" for what changes if
plan 001 later pulls `__tests__/` into a tsconfig.

## Why this matters

Four things in the frontend test harness look like coverage and are not. The
global `localStorage` mock has no failure path at all, so every
`try { localStorage... } catch {}` block the project mandates is **unreachable
in every one of the collected tests (490 of them at `42826a3`)** — delete one and CI stays green while
the SPA breaks for private-window users. That same mock is never cleared between
tests, so keys written by one test leak into the next within a file. Separately,
three test files assert on the *source text* of components rather than their
behaviour: they go red when a formatter moves a line break and stay green when
the guard they claim to test sits in an unreachable branch. And the whole theme
system (`use-theme-preset`, which reads `localStorage` at module import time)
plus the keyboard shortcut hook have zero tests of any kind.

After this plan: the mock can be told to throw per-operation, it is cleared after
every test, the route-guard tests actually render the pages and assert a real
redirect, the source-text assertions that ESLint already covers are gone, and the
two highest-blast-radius untested hooks have behavioural tests.

## Current state

### Files in play

- `frontend/__tests__/legislations-setup.ts` — the **global** Vitest setup file.
  `frontend/vitest.config.ts` declares `setupFiles: ["./__tests__/legislations-setup.ts"]`,
  so it runs before every one of the 55 test files.
- `frontend/__tests__/route-guards.test.tsx` — 4 tests, `.tsx` extension but
  renders nothing; all four `readFileSync` a page's source and regex-match it.
- `frontend/__tests__/no-as-any.test.tsx` — 14 lines, 1 test, one `readFileSync`
  regex scoped to a single page file.
- `frontend/__tests__/i18n-hardcoded.test.ts` — 7 tests; three of them pin exact
  `useCallback` dependency-array strings from `CasesPage.tsx` source.
- `frontend/src/hooks/use-theme-preset.ts` — the theme system; reads
  `localStorage` **at module import time** and has no test file anywhere.
- `frontend/src/hooks/use-keyboard.ts` — global keydown listener + `g`-chord
  navigation; no test file anywhere.

### The mock cannot fail, and is never cleared

`frontend/__tests__/legislations-setup.ts:30-61` — verbatim:

```ts
// Cleanup after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Mock window.scrollTo
beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});
```

No `getItem`/`setItem`/`removeItem` can throw. The `afterEach` never calls
`localStorageMock.clear()`. Only 2 of 55 test files clear it themselves
(`dashboard-api-fallback.test.ts`, `api-llm-council.test.ts`). The
`Object.defineProperty` call has neither `configurable: true` nor
`writable: true`, so the property cannot be redefined later.

### The unreachable error branches this hides

`frontend/src/hooks/use-theme-preset.ts:483-492` — verbatim:

```ts
function readStoredDark(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem(DARK_KEY);
    if (stored !== null) return stored === "true";
  } catch {
    // Fall through to system preference
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
```

`frontend/src/hooks/use-theme-preset.ts:537-554` — verbatim:

```ts
function setState(next: ThemeState) {
  if (
    _state.preset === next.preset &&
    _state.isDark === next.isDark &&
    _state.customVars === next.customVars
  )
    return;
  _state = next;
  applyTheme(next.preset, next.isDark, next.customVars);
  try {
    localStorage.setItem(PRESET_KEY, next.preset);
    localStorage.setItem(DARK_KEY, String(next.isDark));
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(next.customVars));
  } catch {
    // Silently ignore storage errors (private mode, quota exceeded)
  }
  _listeners.forEach((fn) => fn());
}
```

Note the ordering: `_state` is assigned (line 544) **before** the storage write
is attempted (546-549). So a failing `setItem` must still leave the in-memory
state updated. That is the behaviour to assert.

`frontend/src/hooks/use-theme-preset.ts:464-481` — verbatim:

```ts
function readStoredPreset(): PresetName {
  if (typeof window === "undefined") return "claude";
  try {
    const stored = localStorage.getItem(PRESET_KEY);
    // Migrate old default "parchment" → "claude"
    if (stored === "parchment") {
      try {
        localStorage.setItem(PRESET_KEY, "claude");
      } catch {
        /* ignore */
      }
      return "claude";
    }
    return stored && stored in PRESETS ? (stored as PresetName) : "claude";
  } catch {
    return "claude";
  }
}
```

**Two hazards you must handle when testing this module:**

1. The module runs `applyTheme(...)` at **import time**
   (`use-theme-preset.ts:506-509`), reading `localStorage` before any test body
   executes. To control what it reads you must set storage state first, then
   `vi.resetModules()`, then `await import("@/hooks/use-theme-preset")`.
2. `readStoredDark` falls through to `window.matchMedia(...)`
   (line 491). **jsdom does not define `window.matchMedia`.** So when `getItem`
   throws, the `catch` is entered and `matchMedia` is called — if it is not
   stubbed, the module import dies with a `TypeError` and your test fails for
   the wrong reason. Stub it before importing.

The repo already has the exact stub helper. `frontend/__tests__/council-celebrations.test.ts:23-37` — verbatim:

```ts
function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
```

### The route guards are real, but only source-grepped

The guards exist and are reachable. `frontend/src/pages/CaseDetailPage.tsx:86-88` — verbatim:

```tsx
  if (!id) {
    return <Navigate to="/cases" replace />;
  }
```

`frontend/src/pages/CaseEditPage.tsx:127-129` — verbatim (identical shape):

```tsx
  if (!id) {
    return <Navigate to="/cases" replace />;
  }
```

The guard sits **after** the hook calls and **before** the loading branch. In
`CaseDetailPage.tsx:35-44` — verbatim:

```tsx
export function CaseDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useCase(id ?? "");
  const { data: related } = useRelatedCases(id ?? "");
  const { data: similarData, isLoading: similarLoading } = useSimilarCases(
    id ?? "",
  );
  const deleteMutation = useDeleteCase();
```

`CaseEditPage.tsx:78-84` — verbatim:

```tsx
export function CaseEditPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const caseId = id ?? "";
  const navigate = useNavigate();
  const { data, isLoading, isError, error, refetch } = useCase(caseId);
  const updateMutation = useUpdateCase();
```

Both are **named** exports. Both hooks run unconditionally, so
`@/hooks/use-cases` and (for the detail page) `@/hooks/use-similar-cases` must be
mocked or the render will attempt a real query with no `QueryClient`.

What the current file asserts instead —
`frontend/__tests__/route-guards.test.tsx:26-42` — verbatim:

```tsx
  it("CaseDetailPage contains Navigate guard for missing id", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/pages/CaseDetailPage.tsx"),
      "utf-8",
    );
    expect(source).toMatch(/if \(!id\)/);
    expect(source).toMatch(/Navigate to="\/cases"/);
  });

  it("CaseEditPage contains Navigate guard for missing id", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/pages/CaseEditPage.tsx"),
      "utf-8",
    );
    expect(source).toMatch(/if \(!id\)/);
    expect(source).toMatch(/Navigate to="\/cases"/);
  });
```

`Navigate to="\/cases"` fails if a formatter switches to single quotes or wraps
the attribute onto its own line, and passes even if the guard is placed after an
unconditional `return`.

### `no-as-any.test.tsx` is already covered by ESLint

`frontend/__tests__/no-as-any.test.tsx` — verbatim, entire file:

```tsx
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("No as-any type casts", () => {
  it("LegislationsPage does not use 'as any'", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../src/pages/LegislationsPage.tsx"),
      "utf-8",
    );
    const matches = source.match(/as any/g);
    expect(matches).toBeNull();
  });
});
```

`frontend/eslint.config.js` extends `tseslint.configs.recommended` over
`files: ['**/*.{ts,tsx}']`. Verified with
`npx eslint --print-config src/pages/LegislationsPage.tsx`:

```
@typescript-eslint/no-explicit-any: [2]      <- error, repo-wide
react-hooks/exhaustive-deps:        [1]      <- warn
react-hooks/rules-of-hooks:         [2]
no-undef:                           [0]      <- off
```

ESLint enforces this at **error** level across every `.ts`/`.tsx` file in the
package, not just one page. `npx eslint .` currently exits 0 with 25 warnings
and 0 errors. Deleting the test loses nothing.

### The `useCallback` deps string-matches

`frontend/__tests__/i18n-hardcoded.test.ts:22-47` — verbatim:

```ts
  it('CasesPage handleBatch should include t in useCallback deps', () => {
    const content = readFileSync(
      join(__dirname, '../src/pages/CasesPage.tsx'),
      'utf8'
    );
    // Direct string match for the exact deps array
    expect(content).toContain('[selected, batchMutation, t]');
  });

  it('CasesPage exportCsv should include t in useCallback deps', () => {
    const content = readFileSync(
      join(__dirname, '../src/pages/CasesPage.tsx'),
      'utf8'
    );
    // Direct string match for the exact deps array
    expect(content).toContain('[data, t]');
  });

  it('CasesPage handleExecuteSavedSearch should include t in useCallback deps', () => {
    const content = readFileSync(
      join(__dirname, '../src/pages/CasesPage.tsx'),
      'utf8'
    );
    // Direct string match for the exact deps array
    expect(content).toContain('[setSearchParams, t]');
  });
```

Any reordering, a trailing comma, or a Prettier line-wrap of those arrays turns
all three red without a behaviour change. `react-hooks/exhaustive-deps` already
flags a genuinely missing dependency.

### The two untested hooks

`frontend/src/hooks/use-keyboard.ts:20-32` and `:34-41` and `:75-80` — verbatim:

```ts
export function useKeyboard({ onSearch }: KeyboardShortcuts = {}) {
  const navigate = useNavigate()
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inGoToModeRef = useRef(false)

  useEffect(() => {
    function clearChord() {
      inGoToModeRef.current = false
      if (chordTimerRef.current) {
        clearTimeout(chordTimerRef.current)
        chordTimerRef.current = null
      }
    }
```

```ts
    function handler(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if ((e.target as HTMLElement).isContentEditable) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === "/") {
```

```ts
    window.addEventListener("keydown", handler)
    return () => {
      window.removeEventListener("keydown", handler)
      clearChord()
    }
  }, [navigate, onSearch])
```

It calls `useNavigate()`, so `renderHook` needs a Router wrapper.

`grep -rl` over `frontend/__tests__/` returns **zero** files referencing
`use-theme-preset`, `use-keyboard`, `use-taxonomy`, `use-semantic-search` or
`use-lineage-data`.

### Repo conventions that apply here

Quoted from `CLAUDE.md` — the executor has not read it:

- "**localStorage must be try-catch wrapped** — all `localStorage.getItem/setItem/removeItem`
  calls are wrapped in try-catch; throws in incognito/private mode and when quota exceeded"
- "**Theme system** — `use-theme-preset.ts` (current), NOT `use-theme.ts` (legacy).
  localStorage keys: `theme-preset`, `theme-dark`, `theme-custom-vars`"
- "**Use `.toSorted()` not `.sort()`** — never mutate arrays in React"
- "**i18n defaultValue pattern** — always use `t("key", { defaultValue: "English text" })`
  for UI text; i18n mock in tests returns the key string without `defaultValue`,
  causing test assertion failures"
- "**Vitest i18n test assertions** — `__tests__/` are NOT in `tsconfig.app.json`'s
  `include: ["src"]`, so `@/*` path aliases show as TS errors in the editor but
  resolve correctly at Vitest runtime via vite alias config."

Note the i18n mock in `legislations-setup.ts:64-82` **does** honour
`defaultValue` (it returns `options.defaultValue` when present, else the key).
So `PageLoader` renders the literal string `Loading` under test — that is what
`case-detail-page.test.tsx:191` already asserts.

**Structural pattern to copy for the new render tests**:
`frontend/__tests__/case-detail-page.test.tsx` — specifically its `vi.hoisted`
mock factories (lines 10-22), its `vi.mock("@/hooks/use-cases", ...)` block
(lines 27-31), and its `renderPage()` helper (lines 96-104). Your version
differs in one deliberate way: **do not mock `react-router-dom`.** That file
mocks `useParams`/`useNavigate`, which is exactly why it cannot observe a real
redirect (its test 7 at lines 261-268 settles for
`expect(() => renderPage()).not.toThrow()`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Working dir | `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"` | — |
| Full frontend suite | `npx vitest run` | exit 0; count checked as a **delta** against the Step 0 baseline |
| One file | `npx vitest run __tests__/route-guards.test.tsx` | `Tests  4 passed (4)`, exit 0 |
| Hook tests only | `npx vitest run __tests__/hooks/` | `Test Files  3 passed (3)` / `Tests  11 passed (11)` |
| Lint | `npx eslint .` | exit 0, **0 errors** (warnings are pre-existing and allowed) |
| Changed files | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` | only in-scope paths |

**Step 0 — record the baseline before touching anything.** Do not copy a total
out of this plan into a check: sibling plans move it, and a pinned total trains
you to edit the yardstick instead of the code.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
set -o pipefail
npx vitest run 2>&1 | tee /tmp/immi-039-before.txt | tail -5; echo "exit=$?"
BEFORE_FILES=$(grep -oE 'Test Files +[0-9]+ passed \(([0-9]+)\)' /tmp/immi-039-before.txt | grep -oE '\([0-9]+\)' | tr -d '()')
BEFORE_TESTS=$(grep -oE 'Tests +[0-9]+ passed \(([0-9]+)\)' /tmp/immi-039-before.txt | grep -oE '\([0-9]+\)' | tr -d '()')
echo "BEFORE_FILES=$BEFORE_FILES BEFORE_TESTS=$BEFORE_TESTS"
```

Record both numbers in your handoff. For reference only: `55 / 490` at
`42826a3`, and `56 / 518` once plan 002 has landed — this plan expects the
latter, but uses **your** measured values, not these.

Per-file contributions this plan changes (these are stable and *are* asserted
directly): `no-as-any` 1 (deleted), `route-guards` 4 → 4 (rewritten, no delta),
`i18n-hardcoded` 7 → 4, plus three new files at 4 / 3 / 4.

Expected deltas: `AFTER_TESTS == BEFORE_TESTS + 7`
(`−1 −3 +4 +3 +4`), `AFTER_FILES == BEFORE_FILES + 2` (`−1 deleted, +3 new`).

## Scope

**In scope** (the only files you may create, modify or delete):

- `frontend/__tests__/legislations-setup.ts` (modify)
- `frontend/__tests__/route-guards.test.tsx` (rewrite in place)
- `frontend/__tests__/i18n-hardcoded.test.ts` (modify)
- `frontend/__tests__/no-as-any.test.tsx` (**delete**)
- `frontend/__tests__/hooks/use-theme-preset.test.ts` (create)
- `frontend/__tests__/hooks/use-keyboard.test.tsx` (create)
- `frontend/__tests__/hooks/use-auth.test.tsx` (create)
- `plans/039-fix-the-frontend-test-harness.md` (this file — status only)

**Out of scope** (do NOT touch, even though they look directly related):

- `frontend/eslint.config.js` — raising `react-hooks/exhaustive-deps` from
  `warn` to `error` is the correct long-term replacement for the deleted deps
  tests, but it would fail `npx eslint .` on the pre-existing warning at
  `frontend/src/components/auth/TelegramLoginButton.tsx:50`, which is a
  different file and a different fix. Deferred — see "Maintenance notes".
- `frontend/vitest.config.ts` — do not change `include`, `setupFiles` or the
  coverage thresholds. The new `__tests__/hooks/` directory is already matched
  by the existing `include: ["__tests__/**/*.{test,spec}.{ts,tsx}"]`.
- `frontend/__tests__/css-tokens.test.ts` — 44 `readFileSync` assertions over
  token files. It is the same *kind* of source-level check, but it is a
  legitimate design-system contract for the "Legal Codex" token set. Leave it
  exactly as it is; just stop counting it as behavioural coverage.
- Any file under `frontend/src/` — this plan writes tests only. If a new test
  reveals a genuine source bug, that is a STOP condition, not a licence to edit.
- `frontend/__tests__/case-detail-page.test.tsx` — its weak test 7 is superseded
  by your new route-guards tests, but removing it is churn in another file's
  territory. Leave it.
- `frontend/__tests__/auth/` — the existing `auth-utils.test.ts` covers the pure
  helpers in `src/lib/auth.ts` and stays as it is. The new AuthContext test goes
  in `__tests__/hooks/use-auth.test.tsx` (Step 7), not here.
- `frontend/__tests__/llm-council-page.test.tsx`,
  `llm-council-thread.test.tsx`, `admin-pipeline-runs.test.tsx` — these three
  mock `@/contexts/AuthContext` wholesale. That is fine for what they test; do
  not unpick their mocks.
- `src/lib/__tests__/saved-searches.test.ts` — see "Findings reconsidered".

## Git workflow

- Branch: `advisor/039-fix-the-frontend-test-harness`
- Commit per step or per logical unit. Message style is conventional commits:
  `<type>: <description>` with type in `feat|fix|refactor|docs|test|chore|perf|ci`.
  Real example from `git log`: `fix: install root node_modules in make install`.
  For this plan every commit should be `test: ...`.
- Add **no** AI attribution lines, `Co-Authored-By`, or `Generated with` footers.
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and ships.

## Steps

### Step 1: Give the localStorage mock a failure switch and clear it between tests

Edit `frontend/__tests__/legislations-setup.ts`.

**1a.** Replace the mock IIFE (currently lines 41-57) so each accessor can be
made to throw independently. Keep `getItem`'s `store[key] || null` expression
**exactly as it is** — switching it to `?? null` would change what the mock
returns for a stored empty string and risks unrelated failures in the other 54
test files. That fidelity gap is deliberately deferred (see "Maintenance notes").

Target shape:

```ts
// Mock localStorage.
// `failures` lets a test simulate private-mode / quota-exceeded errors, which
// real browsers throw and which the app's try-catch wrappers are supposed to
// absorb. Flags are per-operation on purpose: some callers (e.g.
// src/lib/saved-searches.ts loadSavedSearches) call removeItem from inside the
// catch handler for getItem, so a single global "throw on everything" switch
// would cascade instead of exercising the recovery path.
export const localStorageFailures = {
  getItem: false,
  setItem: false,
  removeItem: false,
};

function storageError(op: string): Error {
  const err = new Error(
    `localStorage.${op} failed (simulated private-mode / quota error)`,
  );
  err.name = "QuotaExceededError";
  return err;
}

const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => {
      if (localStorageFailures.getItem) throw storageError("getItem");
      return store[key] || null;
    },
    setItem: (key: string, value: string) => {
      if (localStorageFailures.setItem) throw storageError("setItem");
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      if (localStorageFailures.removeItem) throw storageError("removeItem");
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
```

**1b.** Add `configurable: true` to the `defineProperty` call (currently lines
59-61). Without it, a test that calls `vi.resetModules()` and then re-imports
this module would hit "Cannot redefine property: localStorage". Target:

```ts
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  configurable: true,
});
```

**1c.** Also expose the switch on `globalThis` immediately after the
`defineProperty` call, as a fallback access path for tests:

```ts
// Secondary access path, so a test can reach the switch without importing this
// setup module. `__tests__/` is outside every tsconfig `include`, so this is
// untyped by design and no typecheck gate sees it.
(globalThis as Record<string, unknown>).__localStorageFailures =
  localStorageFailures;
```

**1d.** Extend the global `afterEach` (currently lines 30-34) to reset both the
failure flags and the store. Reset the flags **before** clearing, so a test that
left `removeItem: true` set cannot interfere with cleanup:

```ts
// Cleanup after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorageFailures.getItem = false;
  localStorageFailures.setItem = false;
  localStorageFailures.removeItem = false;
  localStorageMock.clear();
});
```

Note `localStorageMock` is declared below `afterEach` in the current file
ordering. `const` declarations are hoisted to the top of the module but sit in
the temporal dead zone until evaluated — that is fine here, because the
`afterEach` **callback** only runs after the whole module body has executed.
Do not reorder the file to "fix" this.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run`
→ exit 0, and both counts **exactly equal** `BEFORE_FILES` / `BEFORE_TESTS` from
Step 0. You have not added or removed any test yet, so any movement at all is a
signal. If a test now fails, it was relying on localStorage leaking between
tests; that is the exact defect being fixed, but per STOP conditions report it
rather than editing another test file.

### Step 2: Delete `no-as-any.test.tsx`

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && rm __tests__/no-as-any.test.tsx
```

It is fully redundant: `@typescript-eslint/no-explicit-any` is active at **error**
level (`[2]`) across `**/*.{ts,tsx}` via `tseslint.configs.recommended` in
`frontend/eslint.config.js`, covering every file rather than the single page the
test checked.

**Verify (both must hold)**:

```bash
npx eslint --print-config src/pages/LegislationsPage.tsx | grep -o '"@typescript-eslint/no-explicit-any":\[2\]'
```
→ prints `"@typescript-eslint/no-explicit-any":[2]`

```bash
npx eslint .
```
→ exit 0, `0 errors` (warnings are pre-existing).

### Step 3: Drop the three `useCallback`-deps string matches from `i18n-hardcoded.test.ts`

Edit `frontend/__tests__/i18n-hardcoded.test.ts`. Delete exactly the three
`it(...)` blocks currently at lines 22-47 — the ones asserting
`toContain('[selected, batchMutation, t]')`, `toContain('[data, t]')` and
`toContain('[setSearchParams, t]')`.

**Keep** the other four tests unchanged: the two `TimelineChart` checks and the
two locale-JSON checks. The locale checks (`en.json` / `zh-TW.json`) parse real
JSON and assert real key values — those are data contracts, not formatting
checks. The two `TimelineChart` checks are source greps, but for a stable
substring (`analytics.total`) that survives reformatting; they stay as a
declared source-level contract rather than being passed off as behaviour.

Replace the `describe` title and add a header comment so the file's status is
unambiguous to the next reader:

```ts
/**
 * i18n contract checks.
 *
 * These are deliberately SOURCE-LEVEL assertions, not behavioural coverage:
 * two greps that a component routes a label through i18n rather than
 * hardcoding English, plus two real data assertions over the locale JSON.
 * Do not add `useCallback` dependency-array string matches here — those pin
 * exact formatting, go red on a Prettier line-wrap, and stay green when the
 * dependency is present but unused. `react-hooks/exhaustive-deps` in
 * frontend/eslint.config.js is the right gate for that.
 */
```

and

```ts
describe('i18n source-level contract checks', () => {
```

**Verify**: `npx vitest run __tests__/i18n-hardcoded.test.ts` → `4 passed`, exit 0.

### Step 4: Rewrite `route-guards.test.tsx` as real renders

Replace the entire contents of `frontend/__tests__/route-guards.test.tsx`.

The mechanism: render the page inside a `MemoryRouter` on a route path that has
**no** `:id` segment, so the component's own `useParams()` returns `{}` and `id`
is `undefined`. A sibling `/cases` route renders a sentinel. If the sentinel
appears, a real redirect happened. Critically, **do not mock `react-router-dom`** —
`Navigate`, `useParams` and the router must all be genuine or the test proves
nothing.

Both pages call their data hooks unconditionally before the guard, so
`@/hooks/use-cases` must be mocked, and `@/hooks/use-similar-cases` too for the
detail page. Return `isLoading: true` so the non-redirect case lands on
`PageLoader`, which renders the literal text `Loading` under the setup file's
i18n mock.

Target file:

```tsx
/**
 * Route parameter guards — behavioural.
 *
 * Renders the real pages inside a real MemoryRouter and asserts that a missing
 * :id route param actually redirects to /cases. react-router-dom is
 * deliberately NOT mocked: mocking useParams/Navigate would make these tests
 * pass against a guard sitting in an unreachable branch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react"; // needed for the React.ReactElement type below

const { mockUseCase } = vi.hoisted(() => ({ mockUseCase: vi.fn() }));

vi.mock("@/hooks/use-cases", () => ({
  useCase: mockUseCase,
  useRelatedCases: vi.fn(() => ({ data: { cases: [] }, isLoading: false })),
  useDeleteCase: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateCase: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock("@/hooks/use-similar-cases", () => ({
  useSimilarCases: vi.fn(() => ({
    data: { similar: [], available: false },
    isLoading: false,
    isError: false,
    error: null,
  })),
}));

import { CaseDetailPage } from "@/pages/CaseDetailPage";
import { CaseEditPage } from "@/pages/CaseEditPage";

const CASES_SENTINEL = "cases-list-sentinel";

/**
 * Render `page` at `entry`. `paramlessPath` is a route pattern with no :id
 * segment, so useParams() yields {} and the component's `id` is undefined.
 */
function renderAt(
  page: React.ReactElement,
  routePath: string,
  entry: string,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path={routePath} element={page} />
          <Route
            path="/cases"
            element={<div data-testid={CASES_SENTINEL}>Cases list</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Route parameter guards", () => {
  beforeEach(() => {
    mockUseCase.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("CaseDetailPage redirects to /cases when the :id route param is absent", () => {
    renderAt(<CaseDetailPage />, "/cases/detail", "/cases/detail");
    expect(screen.getByTestId(CASES_SENTINEL)).toBeInTheDocument();
  });

  it("CaseDetailPage does not redirect when :id is present", () => {
    renderAt(<CaseDetailPage />, "/cases/:id", "/cases/abc123456789");
    expect(screen.queryByTestId(CASES_SENTINEL)).not.toBeInTheDocument();
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });

  it("CaseEditPage redirects to /cases when the :id route param is absent", () => {
    renderAt(<CaseEditPage />, "/cases/edit", "/cases/edit");
    expect(screen.getByTestId(CASES_SENTINEL)).toBeInTheDocument();
  });

  it("CaseEditPage does not redirect when :id is present", () => {
    renderAt(<CaseEditPage />, "/cases/:id/edit", "/cases/abc123456789/edit");
    expect(screen.queryByTestId(CASES_SENTINEL)).not.toBeInTheDocument();
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });
});
```

**Discriminating power without mutating the app.** Tests 1 and 2 are a matched
pair, and that pairing is what makes them meaningful: nothing renders the
sentinel route except a real `<Navigate to="/cases">`, so deleting the
`if (!id)` guard fails test 1 (no sentinel) while test 2 still passes. You do
not need to break the source to establish that.

**Do not** comment out the `if (!id)` block in
`frontend/src/pages/CaseDetailPage.tsx` to "prove" it. That file is explicitly
out of this plan's scope; a parallel agent may be reading or building it, an
interrupted run leaves the app broken on disk, and `frontend/src/` appearing in
`git status` is itself a STOP condition here. If you want an explicit mutation
drill anyway, run it in a **throwaway clone** so the shared checkout is never
touched:

```bash
DRILL="$(mktemp -d)"; trap 'rm -rf "$DRILL"' EXIT INT TERM
git clone --quiet --no-hardlinks "/Users/d/Developer/Active Projects/IMMI-Case-" "$DRILL/repo"
# copy your new route-guards.test.tsx into the clone, mutate the page there,
# run vitest there, then let the trap delete the whole clone.
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run __tests__/route-guards.test.tsx; echo "exit=$?"
npx vitest run __tests__/route-guards.test.tsx \
  -t "CaseDetailPage redirects to /cases when the :id route param is absent"; echo "named exit=$?"
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short -- frontend/src
```

→ `Tests  4 passed (4)` with `exit=0`; the named-test run also `exit=0`; the
`git status` prints **nothing**.

### Step 5: Add `__tests__/hooks/use-theme-preset.test.ts`

Create the directory and file. Four tests. This is the sharpest gap: a throw here
takes down the whole app shell, not one route, because the module reads storage
at import time.

Two mechanics you must get right, both explained in "Current state":

- Set storage state / failure flags **first**, then `vi.resetModules()`, then
  `await import("@/hooks/use-theme-preset")`. A static import would evaluate the
  module before your test body runs.
- Stub `window.matchMedia` before every import. jsdom has no `matchMedia`, and
  `readStoredDark`'s `catch` falls straight through to it.

Import `localStorageFailures` **statically at the top of the file**. Do not
`await import("../legislations-setup")` after `vi.resetModules()` — that would
re-execute the setup module and re-run its `Object.defineProperty` call. (Step 1b
adds `configurable: true`, so it would no longer throw, but it would swap in a
fresh empty store mid-test and silently invalidate your arrangement.) If the
static import misbehaves for any reason, fall back to
`(globalThis as Record<string, unknown>).__localStorageFailures` from Step 1c.

Target file:

```ts
/**
 * use-theme-preset — behavioural tests for the storage-failure paths.
 *
 * The module reads localStorage at IMPORT time and applies the theme before
 * React mounts, so every test arranges storage state first, then resets the
 * module registry, then dynamically imports. window.matchMedia must be stubbed
 * before each import: jsdom does not define it, and readStoredDark() falls
 * through to it whenever localStorage.getItem throws.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { localStorageFailures } from "../legislations-setup";

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

async function loadHook() {
  vi.resetModules();
  return (await import("@/hooks/use-theme-preset")).useThemePreset;
}

describe("useThemePreset", () => {
  beforeEach(() => {
    mockMatchMedia(false);
  });

  afterEach(() => {
    // @ts-expect-error - removing a DOM property this file defines per-test
    delete window.matchMedia;
  });

  it("restores a stored preset and dark flag on module load", async () => {
    localStorage.setItem("theme-preset", "ocean");
    localStorage.setItem("theme-dark", "true");

    const useThemePreset = await loadHook();
    const { result } = renderHook(() => useThemePreset());

    expect(result.current.preset).toBe("ocean");
    expect(result.current.isDark).toBe(true);
  });

  it("falls back to the claude preset when localStorage.getItem throws (private mode)", async () => {
    localStorageFailures.getItem = true;

    const useThemePreset = await loadHook();
    const { result } = renderHook(() => useThemePreset());

    expect(result.current.preset).toBe("claude");
    expect(result.current.isDark).toBe(false);
    expect(result.current.customVars).toEqual({});
  });

  it("ignores an unknown stored preset name and falls back to claude", async () => {
    localStorage.setItem("theme-preset", "not-a-real-preset");

    const useThemePreset = await loadHook();
    const { result } = renderHook(() => useThemePreset());

    expect(result.current.preset).toBe("claude");
  });

  it("still updates in-memory state when localStorage.setItem throws (quota exceeded)", async () => {
    const useThemePreset = await loadHook();
    const { result } = renderHook(() => useThemePreset());

    localStorageFailures.setItem = true;

    expect(() => {
      act(() => result.current.setPreset("forest"));
    }).not.toThrow();
    expect(result.current.preset).toBe("forest");
  });
});
```

If test 2 fails on module import with a `TypeError` mentioning `matchMedia`,
your stub is running after the import — move `mockMatchMedia(false)` so it
executes before `loadHook()`.

**Verify**: `npx vitest run __tests__/hooks/use-theme-preset.test.ts` →
`4 passed`, exit 0.

### Step 6: Add `__tests__/hooks/use-keyboard.test.tsx`

Three tests. The unmount test is the one that matters: it proves the effect's
cleanup actually removes the window listener.

`useKeyboard` calls `useNavigate()`, so `renderHook` needs a Router wrapper — use
the `wrapper` option with `MemoryRouter`. Dispatch events on `document.body`
(which has a `tagName`, unlike `window`) with `bubbles: true` so they reach the
window listener, and `cancelable: true` so `preventDefault()` is meaningful.

Target file:

```tsx
/**
 * use-keyboard — behavioural tests for the global keydown listener.
 *
 * Events are dispatched on document.body with bubbles:true so they reach the
 * window-level listener the hook installs, and so e.target has a real tagName
 * (window does not), which is what the INPUT/TEXTAREA guard reads.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { useKeyboard } from "@/hooks/use-keyboard";

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

function pressKey(key: string, target: EventTarget = document.body) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

describe("useKeyboard", () => {
  it("calls onSearch when '/' is pressed", () => {
    const onSearch = vi.fn();
    renderHook(() => useKeyboard({ onSearch }), { wrapper });

    pressKey("/");

    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("ignores keystrokes originating in an input field", () => {
    const onSearch = vi.fn();
    renderHook(() => useKeyboard({ onSearch }), { wrapper });

    const input = document.createElement("input");
    document.body.appendChild(input);
    pressKey("/", input);
    input.remove();

    expect(onSearch).not.toHaveBeenCalled();
  });

  it("removes its keydown listener on unmount", () => {
    const onSearch = vi.fn();
    const { unmount } = renderHook(() => useKeyboard({ onSearch }), {
      wrapper,
    });

    pressKey("/");
    expect(onSearch).toHaveBeenCalledTimes(1);

    unmount();
    pressKey("/");

    expect(onSearch).toHaveBeenCalledTimes(1);
  });
});
```

**Verify**: `npx vitest run __tests__/hooks/use-keyboard.test.tsx` → `3 passed`,
exit 0.

### Step 7: Add `__tests__/hooks/use-auth.test.tsx`

`frontend/src/contexts/AuthContext.tsx` (206 lines) has **zero** tests. The only
three test files that touch auth — `llm-council-page.test.tsx:53`,
`llm-council-thread.test.tsx:44`, `admin-pipeline-runs.test.tsx:12` — mock the
whole module, so `AuthProvider` never renders under test. The existing
`__tests__/auth/auth-utils.test.ts` covers only the 59-line pure helpers in
`src/lib/auth.ts`.

Two realistic regressions are invisible to typecheck, lint and every collected
test: a refresh timer that never fires bounces every user to the login screen
mid-session, and one that fires too often becomes a refresh storm burning
`immi_refresh_sessions` rows in D1.

This file lives under `__tests__/hooks/` — the directory this plan owns — because
`useAuth` is the hook under test and `AuthProvider` is its wrapper. Do not put it
in `__tests__/auth/`; that directory is outside this plan's territory.

The relevant source, `frontend/src/contexts/AuthContext.tsx:36-43` — verbatim:

```tsx
  const scheduleRefresh = useCallback((token: string) => {
    const payload = parseJwtPayload(token);
    if (!payload || typeof payload.exp !== "number") return;
    const msUntilExpiry = payload.exp * 1000 - Date.now();
    const refreshIn = Math.max(msUntilExpiry - 60_000, 0); // refresh 1min before expiry
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => { refreshRef.current?.(); }, refreshIn);
  }, []);
```

and the 401 fallback, `AuthContext.tsx:103-109` — verbatim:

```tsx
        } else if (r.status === 401) {
          // Access cookie expired — try silent refresh before giving up
          const refreshed = await refresh();
          if (refreshed) {
            setState((s) => ({ ...s, isLoading: false }));
            return;
          }
        }
```

`parseJwtPayload` (`src/lib/auth.ts:39-52`) really base64-decodes the token, so
your fixture must be a genuinely shaped `header.payload.signature` string — a
placeholder like `"fake-token"` returns `null` and `scheduleRefresh` silently
returns without arming a timer, which would make test 1 pass for the wrong
reason.

**Two things the first draft of this plan got wrong, and which the file below
fixes. Do not revert them.**

1. **The timer test must bracket the boundary, not just advance past it.**
   Advancing by `exp − 60s + 10ms` once and asserting "one refresh happened"
   passes just as happily against a timer armed at `exp − 240s`, or at `0ms`.
   The only way to pin `exp − 60s` is to freeze the clock with
   `vi.setSystemTime()`, assert **0 calls at boundary − 1 ms**, advance 2 ms,
   and assert **exactly 1**. `Date.now()` must be frozen because
   `scheduleRefresh` computes `payload.exp * 1000 - Date.now()`
   (`AuthContext.tsx:39`) — with a live clock the arithmetic drifts between
   building the token and arming the timer.

2. **The `/auth/me` 401 path leaves the context in an inconsistent state, and
   the test must say so rather than bless it.** `refresh()` at
   `AuthContext.tsx:65-68` sets `accessToken` and `isAuthenticated: true` but
   leaves `user`, `tenant` and `tenants` at their previous values — which, on
   the mount path, are `null` / `null` / `[]` from the initial state at
   `AuthContext.tsx:24-29`. So after a 401 the app is "authenticated" with no
   identity. Asserting only `isAuthenticated === true` would enshrine that as
   correct. The test below pins the **whole** observed snapshot, with the defect
   named in a comment, so that when someone fixes `refresh()` (re-fetch
   `/auth/me`, or have the endpoint return a full identity snapshot) the test
   fails loudly and is updated in the same change. Fixing `AuthContext.tsx` is
   out of this plan's scope — see "Maintenance notes" → AUTH-REFRESH-IDENTITY.

Target file:

```tsx
/**
 * AuthContext — behavioural tests for silent token refresh.
 *
 * These use fake timers, so every advance goes through the *Async timer helpers
 * to let the fetch promises inside the timer callback settle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

/** Build a real, parseable JWT whose `exp` is `secondsFromNow` in the future. */
function makeToken(secondsFromNow: number): string {
  const payload = { exp: Math.floor(Date.now() / 1000) + secondsFromNow };
  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `hdr.${b64}.sig`;
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const ACCESS_TTL_SECONDS = 300; // matches the 5-min access token in production
// AuthContext.tsx:40 — setTimeout(..., Math.max(msUntilExpiry - 60_000, 0))
const REFRESH_FIRES_AFTER_MS = (ACCESS_TTL_SECONDS - 60) * 1000;
const FROZEN_NOW = new Date("2026-08-27T00:00:00.000Z");

let fetchMock: ReturnType<typeof vi.fn>;

function refreshCallCount() {
  return fetchMock.mock.calls.filter((c) =>
    String(c[0]).includes("/api/v1/auth/refresh"),
  ).length;
}

describe("AuthProvider silent refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Freeze the clock: scheduleRefresh computes payload.exp * 1000 - Date.now(),
    // so a live clock makes the armed delay drift and the boundary assertions
    // below meaningless.
    vi.setSystemTime(FROZEN_NOW);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("arms the refresh at exactly exp - 60s: nothing fires 1ms early, exactly one fires 1ms late", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/auth/me")) {
        return Promise.resolve(
          jsonResponse({
            user: { id: "u1" },
            tenant: { id: "t1" },
            tenants: [{ id: "t1" }],
            access_token: makeToken(ACCESS_TTL_SECONDS),
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({ access_token: makeToken(ACCESS_TTL_SECONDS) }),
      );
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(refreshCallCount()).toBe(0);

    // 1 ms BEFORE the boundary: still zero. This is the half that a plain
    // "advance past it and assert >= 1" test cannot detect — a timer armed too
    // early (or at 0ms) would already have fired by here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_FIRES_AFTER_MS - 1);
    });
    expect(refreshCallCount()).toBe(0);

    // Cross the boundary by 2 ms: exactly one refresh, never a storm.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(refreshCallCount()).toBe(1);
  });

  it("falls back to a silent refresh when /auth/me returns 401, and ends authenticated-but-identityless", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/auth/me")) {
        return Promise.resolve(jsonResponse(null, 401));
      }
      return Promise.resolve(
        jsonResponse({ access_token: makeToken(ACCESS_TTL_SECONDS) }),
      );
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(refreshCallCount()).toBe(1);

    // CHARACTERIZATION OF A DEFECT (AUTH-REFRESH-IDENTITY), not a specification.
    // AuthContext.tsx:65-68 sets isAuthenticated: true and the new accessToken,
    // but never refetches identity — so after this path the app is
    // "authenticated" with user === null and tenant === null. The whole snapshot
    // is pinned deliberately: when refresh() is fixed to re-fetch /auth/me (or
    // the endpoint is changed to return a full identity snapshot), THIS TEST
    // MUST FAIL and be updated in the same commit. Do not weaken it to
    // `expect(isAuthenticated).toBe(true)` — that would silently bless the bug.
    expect({
      isAuthenticated: result.current.isAuthenticated,
      user: result.current.user,
      tenant: result.current.tenant,
      tenants: result.current.tenants,
    }).toEqual({ isAuthenticated: true, user: null, tenant: null, tenants: [] });
  });

  it("logout clears the pending refresh timer", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/auth/me")) {
        return Promise.resolve(
          jsonResponse({
            user: { id: "u1" },
            tenant: { id: "t1" },
            tenants: [{ id: "t1" }],
            access_token: makeToken(ACCESS_TTL_SECONDS),
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.logout();
    });
    const afterLogout = refreshCallCount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_FIRES_AFTER_MS + 10);
    });

    expect(refreshCallCount()).toBe(afterLogout);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("switchTenant updates the active tenant in context", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/auth/me")) {
        return Promise.resolve(
          jsonResponse({
            user: { id: "u1" },
            tenant: { id: "t1" },
            tenants: [{ id: "t1" }, { id: "t2" }],
            access_token: makeToken(ACCESS_TTL_SECONDS),
          }),
        );
      }
      if (String(url).includes("/auth/switch-tenant")) {
        return Promise.resolve(
          jsonResponse({
            tenant: { id: "t2" },
            access_token: makeToken(ACCESS_TTL_SECONDS),
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.switchTenant("t2");
    });

    expect(result.current.tenant).toEqual({ id: "t2" });
  });
});
```

If `waitFor` hangs under fake timers, switch the `beforeEach` to
`vi.useFakeTimers({ shouldAdvanceTime: true })` — that is the one adjustment you
may make without reporting. If it still hangs after that, STOP and report; do not
convert these to real timers, because the whole point is deterministic control of
the refresh schedule.

**Verify**: `npx vitest run __tests__/hooks/use-auth.test.tsx` → `4 passed`, exit 0.

### Step 8: Run every gate

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
set -o pipefail
npx vitest run 2>&1 | tee /tmp/immi-039-after.txt | tail -5; echo "vitest exit=$?"
npx eslint .; echo "eslint exit=$?"
AFTER_FILES=$(grep -oE 'Test Files +[0-9]+ passed \(([0-9]+)\)' /tmp/immi-039-after.txt | grep -oE '\([0-9]+\)' | tr -d '()')
AFTER_TESTS=$(grep -oE 'Tests +[0-9]+ passed \(([0-9]+)\)' /tmp/immi-039-after.txt | grep -oE '\([0-9]+\)' | tr -d '()')
echo "files: $BEFORE_FILES -> $AFTER_FILES ; tests: $BEFORE_TESTS -> $AFTER_TESTS"
```

**Verify**:
- `vitest exit=0` and `eslint exit=0` with `0 errors`.
- `AFTER_FILES == BEFORE_FILES + 2` and `AFTER_TESTS == BEFORE_TESTS + 7`,
  against the Step 0 baseline you recorded. Do **not** substitute a total copied
  out of this plan.
- `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short` →
  entries only under `frontend/__tests__/` and `plans/`.

## Test plan

New and changed tests, all under `frontend/__tests__/`:

**`hooks/use-theme-preset.test.ts` (new, 4 tests)** — model after
`__tests__/council-celebrations.test.ts` for the `matchMedia` stub and its
`afterEach` teardown.
- happy path: a stored `theme-preset` + `theme-dark` are restored at module load
- **regression this plan fixes**: `getItem` throws → hook yields the `claude`
  default and `isDark: false` instead of propagating the throw (exercises
  `use-theme-preset.ts:478-480` and `:488-491`, previously unreachable)
- edge: an unknown stored preset name falls back to `claude`
  (`use-theme-preset.ts:477`)
- **regression this plan fixes**: `setItem` throws → `setPreset` does not throw
  and in-memory state still updates (exercises `use-theme-preset.ts:546-552`,
  previously unreachable)

**`hooks/use-keyboard.test.tsx` (new, 3 tests)** — model after any
`renderHook`-based test; wrapper pattern from
`__tests__/case-detail-page.test.tsx:96-104`.
- happy path: `/` invokes `onSearch`
- edge: a keystroke targeted at an `<input>` is ignored
  (`use-keyboard.ts:36-38`)
- **regression**: after `unmount()` the listener is gone and `onSearch` is not
  called again (`use-keyboard.ts:75-79`)

**`route-guards.test.tsx` (rewritten, 4 tests)** — model after
`__tests__/case-detail-page.test.tsx`, **minus** its `react-router-dom` mock.
- `CaseDetailPage` with no `:id` → real redirect to `/cases` observed via a
  sentinel route
- `CaseDetailPage` with `:id` → no redirect; `PageLoader` renders
- `CaseEditPage` with no `:id` → real redirect
- `CaseEditPage` with `:id` → no redirect; `PageLoader` renders

**`i18n-hardcoded.test.ts` (reduced, 7 → 4 tests)** — three formatting-pinned
`useCallback` deps assertions removed; two `TimelineChart` source greps and two
locale-JSON data assertions retained and relabelled.

**`no-as-any.test.tsx`** — deleted (1 test); superseded by
`@typescript-eslint/no-explicit-any` at error level.

**`hooks/use-auth.test.tsx` (new, 4 tests)** — no existing structural model in
this repo; `AuthProvider` has never been rendered under test. Uses fake timers
plus a mocked `global.fetch`.
- **regression this plan fixes**: the refresh timer fires exactly once at
  `exp − 60s` — a timer that never fires logs every user out mid-session, one
  that fires repeatedly is a refresh storm against `immi_refresh_sessions` in D1
  (`AuthContext.tsx:36-43`)
- **regression this plan fixes**: a 401 from `/auth/me` triggers exactly one
  silent `/auth/refresh` and ends authenticated (`AuthContext.tsx:103-109`)
- edge: `logout()` clears the pending timer, so no refresh fires afterwards
  (`AuthContext.tsx:154`)
- happy path: `switchTenant()` updates the active tenant in context
  (`AuthContext.tsx:166-190`)

**`legislations-setup.ts`** — no tests of its own; its correctness is
demonstrated by the two new storage-failure tests in
`hooks/use-theme-preset.test.ts`, which cannot pass unless the switch works.

Verification: `npx vitest run` exits 0 with `AFTER_FILES == BEFORE_FILES + 2` and
`AFTER_TESTS == BEFORE_TESTS + 7` against the Step 0 baseline, plus the six
named-test checks in "Done criteria".

## Done criteria

Machine-checkable. ALL must hold, run from
`/Users/d/Developer/Active Projects/IMMI-Case-/frontend` unless noted:

- [ ] `npx vitest run` exits 0, and `AFTER_FILES == BEFORE_FILES + 2` and
      `AFTER_TESTS == BEFORE_TESTS + 7` against the Step 0 baseline
      (no absolute total is asserted anywhere — a sibling plan moves it)
- [ ] `npx eslint .` exits 0 with `0 errors`
- [ ] `test -f __tests__/no-as-any.test.tsx` returns non-zero (file is gone)
- [ ] `test -f __tests__/hooks/use-theme-preset.test.ts` returns 0
- [ ] `test -f __tests__/hooks/use-keyboard.test.tsx` returns 0
- [ ] `test -f __tests__/hooks/use-auth.test.tsx` returns 0
- [ ] `npx vitest run __tests__/hooks/` reports `Test Files  3 passed (3)` / `Tests  11 passed (11)`
- [ ] `npx vitest run __tests__/hooks/use-auth.test.tsx -t "arms the refresh at exactly exp - 60s"` → passes
- [ ] `npx vitest run __tests__/hooks/use-theme-preset.test.ts -t "falls back to the claude preset when localStorage.getItem throws"` → passes
      (this is the check that proves the new failure switch actually throws;
      it cannot pass against the old mock)
- [ ] `npx vitest run __tests__/route-guards.test.tsx -t "CaseDetailPage redirects to /cases when the :id route param is absent"` → passes
- [ ] `grep -c "localStorageMock.clear()" __tests__/legislations-setup.ts` returns `1`
- [ ] `grep -c "configurable: true" __tests__/legislations-setup.ts` returns `1`
- [ ] `grep -c "readFileSync" __tests__/route-guards.test.tsx` returns `0`
- [ ] `grep -c 'vi.mock("react-router-dom"' __tests__/route-guards.test.tsx` returns `0`
- [ ] `npx vitest run __tests__/i18n-hardcoded.test.ts` reports `Tests  4 passed (4)`
      and the run does **not** contain `batchMutation`
- [ ] From the repo root, `git status --short` lists modified/added paths only
      under `frontend/__tests__/` and `plans/`
- [ ] From the repo root, all three of these produce empty output:
      `git diff --stat -- frontend/src frontend/eslint.config.js`,
      `git diff --cached --stat -- frontend/src frontend/eslint.config.js`,
      `git status --short -- frontend/src frontend/eslint.config.js`
      (`frontend/vitest.config.ts` is deliberately excluded: plan 002 edits it,
      and this plan runs after 002)
- [ ] `plans/README.md` status row updated **if that file exists**; not created if it does not

## STOP conditions

Stop and report back (do not improvise) if:

- **Step 1 changes the test count.** After adding `localStorage.clear()` to the
  global `afterEach`, `npx vitest run` must still report exactly `BEFORE_FILES` /
  `BEFORE_TESTS` from Step 0. If a test now fails, it was depending on storage
  leaking between tests — that is a real defect in *that* test file, but every
  candidate file is out of this plan's territory. Report which file and which
  test, with the failure output.
- **A new hook test fails for a reason in `frontend/src/`.** For example, if
  `use-theme-preset` genuinely propagates a storage throw rather than absorbing
  it, that is a source bug, and `frontend/src/hooks/` is explicitly out of scope.
  Report it; do not "fix" the hook and do not weaken the assertion to make it
  pass.
- **`git status --short -- frontend/src` is non-empty at any point.** The
  route-guard step must not mutate the page it tests; do the mutation drill in a
  throwaway clone or not at all. If `frontend/src/` is dirty, a parallel agent
  may already have read a broken component — report, and do **not** run
  `git checkout --` to tidy it yourself.
- **The route-guard pair does not discriminate**: test 1 (no `:id` → sentinel)
  and test 2 (`:id` present → no sentinel, `Loading` rendered) must both pass. If
  test 2 also renders the sentinel, the redirect is unconditional and the pair
  proves nothing — report it.
- **The `route-guards.test.tsx` render throws** because a page calls a hook or
  module you did not anticipate mocking, and the fix would require mocking
  something under `frontend/src/`. Report the exact error; do not add
  `vi.mock("react-router-dom", ...)` as a workaround — that would reintroduce the
  precise defect this step exists to remove.
- **`vi.resetModules()` plus the dynamic import in `use-theme-preset.test.ts`
  produces "Cannot redefine property: localStorage"**. That means Step 1b's
  `configurable: true` was not applied, or the setup module is being re-imported
  dynamically. Re-check Step 1b and confirm the test only ever statically imports
  `../legislations-setup`.
- **The AuthContext tests hang or flake under fake timers** after you have tried
  `vi.useFakeTimers({ shouldAdvanceTime: true })` (the one adjustment you may
  make unilaterally). Report it. Do not switch them to real timers and do not
  replace the assertions with `toHaveBeenCalled()` — asserting the refresh fires
  *exactly once at the right moment* is the entire point; "at least once" would
  pass against a refresh storm, which is one of the two regressions being
  guarded.
- **Step 7 test 1 passes but `refreshCallCount()` is 0 before the advance and 0
  after.** That means `parseJwtPayload` returned `null` and no timer was ever
  armed, so the test proves nothing. Check that `makeToken` produces a real
  three-segment base64url JWT, not a placeholder string.
- **Step 7 test 1's "1 ms early" assertion fails with 1 call instead of 0.** The
  refresh is being armed *earlier* than `exp − 60s` — a real defect (more refresh
  traffic than designed, more `immi_refresh_sessions` churn in D1). Report it;
  do not relax the assertion to `toBeLessThanOrEqual(1)`.
- **Step 7 test 2's full-snapshot assertion fails because `user` is now
  populated.** That means someone fixed `refresh()` to re-fetch identity. Good —
  but do not just delete the assertion: update it to the new correct snapshot and
  remove the AUTH-REFRESH-IDENTITY note from "Maintenance notes" in the same
  change, so the record stays honest.
- Any step's verification fails twice after one reasonable fix attempt.
- The fix appears to require touching `frontend/eslint.config.js`,
  `frontend/vitest.config.ts`, or anything under `frontend/src/`.

## Maintenance notes

For whoever owns this code next:

- **What a reviewer should scrutinise.** The single highest-value line in the
  whole diff is `localStorageMock.clear()` in the global `afterEach`. Everything
  else is additive; that one line changes the isolation guarantees for every
  collected test file. Confirm the executor actually recorded the Step 0
  baseline and checked `+2 files / +7 tests` against it, rather than pattern-
  matching a total copied out of this document.
- **AUTH-REFRESH-IDENTITY — an open source defect this plan pins but does not
  fix.** `AuthContext.tsx:44-74`: `refresh()` sets `isAuthenticated: true` and
  the new `accessToken`, but never refreshes `user` / `tenant` / `tenants`. On
  the mount path (`AuthContext.tsx:103-109`, the `/auth/me` 401 branch) those are
  still the initial `null` / `null` / `[]`, so the app ends up authenticated with
  no identity: anything rendering `user.*` sees null, and tenant-scoped UI has no
  active tenant to send. The fix is one of (a) re-fetch `/auth/me` after a
  successful `refresh()`, or (b) have `POST /api/v1/auth/refresh` return the full
  identity snapshot the way `/auth/me` does — (b) also removes a round trip but
  needs a Worker change in `workers/auth/cloudflare_handlers.js`. Both are
  outside this plan (`frontend/src/**` and `workers/**` are out of scope). The
  test in Step 7 pins the current snapshot **with the defect named in a
  comment**, so the fix produces an intentional, visible failure rather than a
  silent behaviour change. Whoever fixes it updates that test in the same commit
  and deletes this note.
- **The deps-test replacement is only half-done, on purpose.**
  `react-hooks/exhaustive-deps` is configured at `warn` (`[1]`), and
  `npx eslint .` exits 0 on warnings — so deleting the three `useCallback` deps
  string-matches leaves a warn-only gate rather than a blocking one. Raising it
  to `error` is the correct follow-up but needs
  `frontend/src/components/auth/TelegramLoginButton.tsx:50` fixed first (a
  pre-existing ref-cleanup warning), and both files are outside this plan's
  territory. Track it separately.
- **The mock's `getItem` still returns `null` for a stored empty string.** It
  uses `store[key] || null`, kept byte-for-byte from the original to avoid
  unrelated fallout across the other 54 test files. Real `localStorage` returns
  `""`. If a future bug turns on that distinction, switch to `?? null` and re-run
  the full suite as a standalone change.
- **The failure switch is per-operation for a reason.**
  `frontend/src/lib/saved-searches.ts:85-87` calls `localStorage.removeItem`
  from *inside* the `catch` handler for `getItem`. A single global "throw on
  everything" flag would cascade out of that catch instead of exercising the
  recovery path. Keep the three flags separate when extending this.
- **`use-theme-preset` is import-time stateful.** It calls `applyTheme()` at
  module scope and keeps `_state` in a module-level variable. Any future test of
  it must use the `vi.resetModules()` + dynamic import dance, and must stub
  `window.matchMedia` first. If someone refactors that module to defer its
  side effect until first render, these tests get much simpler — revisit then.
- **Deferred out of this plan, with reasons:**
  - Converting the two `TimelineChart` source greps in `i18n-hardcoded.test.ts`
    into a real render assertion. It needs a `LineageData` fixture and Recharts
    under jsdom — meaningful work and non-trivial flake risk, for a check that is
    already stable under reformatting.
  - `frontend/__tests__/css-tokens.test.ts` (44 `readFileSync` assertions). It is
    the same technique, but it is a legitimate contract for the "Legal Codex"
    design tokens (warm off-white `#f5f4f1`, deep navy `#1b2838`, amber
    `#d4a017`), where the token file genuinely *is* the artefact under test.
    Left untouched — just do not count it toward behavioural coverage.
  - Tests for `use-taxonomy`, `use-semantic-search` and `use-lineage-data`, all
    of which also have zero direct tests. They are ordinary data hooks whose
    failure blast radius is one page each, unlike `use-theme-preset` (app shell)
    and `use-keyboard` (global listener). Assess their page-level tests first —
    some may be adequately covered indirectly.
- **The AuthContext tests are the most delicate file in this plan.** They pin the
  refresh schedule to `exp − 60s`, which is a literal in
  `AuthContext.tsx:40` (`Math.max(msUntilExpiry - 60_000, 0)`). If that offset is
  ever tuned, `REFRESH_FIRES_AFTER_MS` in the test must move with it — the test
  will fail loudly rather than silently, which is intended. They do **not** cover
  `login()` (the Telegram path) or refresh-token rotation against
  `immi_refresh_sessions`; rotation is enforced Worker-side and belongs in the
  Worker suite, not here.
- **If plan 001 later adds `__tests__/` to a tsconfig `include`**, these files
  must then typecheck. They are written to be type-clean, with two known
  exceptions that already exist elsewhere in the suite: the
  `@ts-expect-error` on `delete window.matchMedia` (copied verbatim from
  `council-celebrations.test.ts:45-48`) and the
  `(globalThis as Record<string, unknown>)` cast in the setup file. Re-run
  `tsc -b` after that plan lands.

## Findings reconsidered

Nothing was dropped, but three pieces of the supplied evidence did not survive
first-hand checking and are corrected here:

- **"Roughly 80 of the 490 collected tests" are source-text assertions** —
  overstated. Counted with `grep -c "^\s*it("`: `i18n-hardcoded.test.ts` 7 +
  `route-guards.test.tsx` 4 + `no-as-any.test.tsx` 1 + `css-tokens.test.ts` 44 =
  **56**, not ~80. The finding stands; the magnitude was inflated by about 40%.
- **`no-as-any.test.tsx:11` cited as the assertion** — line 11 is
  `const matches = source.match(/as any/g);`. The assertion is line **12**,
  `expect(matches).toBeNull();`. The file is 14 lines with one `it()`, exactly as
  described otherwise.
- **"Move `no-as-any` into ESLint rules"** — no ESLint change is needed, because
  the rule is *already* there. `npx eslint --print-config src/pages/LegislationsPage.tsx`
  reports `@typescript-eslint/no-explicit-any: [2]` (error), inherited from
  `tseslint.configs.recommended` over `files: ['**/*.{ts,tsx}']` in
  `frontend/eslint.config.js`. So Step 2 is a pure deletion with zero coverage
  loss, which is stronger than the original finding assumed. The sibling claim
  about `exhaustive-deps` is weaker than assumed in the other direction: it is
  configured at `warn` (`[1]`), and `npx eslint .` exits 0 despite 25 warnings,
  so it does not block CI. That residual gap is recorded in "Maintenance notes"
  rather than papered over.

One adjacent defect was found while verifying and is **deliberately not** acted
on here, so it is not rediscovered from scratch:

- **`frontend/src/lib/__tests__/saved-searches.test.ts` is never executed.**
  `frontend/vitest.config.ts` sets `include: ["__tests__/**/*.{test,spec}.{ts,tsx}"]`,
  resolved from the `frontend/` root, so a test directory nested under `src/` is
  not matched. Confirmed: `npx vitest list | grep -c saved-searches` → `0`, while
  the same command reports 490 collected tests overall. Fixing it means editing
  `frontend/vitest.config.ts` (out of scope here) and would surface an unknown
  number of previously unrun assertions — that belongs in its own plan, not
  bundled into this one.
