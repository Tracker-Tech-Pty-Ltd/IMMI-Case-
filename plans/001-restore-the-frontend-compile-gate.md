# Plan 001: Make CI actually type-check and build the frontend

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index, or the file does not exist (in which case skip it).
>
> **Drift check (run first)**: three commands, not one. A committed-history
> diff cannot see uncommitted, staged or untracked work, so an executor
> starting from a dirty tree would otherwise get a false all-clear.
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> IN_SCOPE=(
>   .github/workflows/ci.yml
>   Makefile
>   frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json
>   frontend/vitest.config.ts frontend/eslint.config.js
>   frontend/package.json frontend/package-lock.json
>   frontend/__tests__ frontend/scripts frontend/src/tokens
> )
> git status --short --branch
> git diff --stat 42826a3..HEAD -- "${IN_SCOPE[@]}"   # committed since planning
> git diff --stat -- "${IN_SCOPE[@]}"                  # unstaged
> git diff --cached --stat -- "${IN_SCOPE[@]}"         # staged
> ```
>
> Expected: all three diffs **empty**. `git status --short --branch` may list
> files outside the in-scope set (for example `plans/`); that is fine. If any
> **in-scope** path appears in any of the three diffs, or appears as `??`
> untracked, that is a STOP condition: compare the "Current state" excerpts
> below against the live code and report before proceeding.
>
> Never "clean up" someone else's work to get a green drift check. Do **not**
> run `git checkout --`, `git restore`, `git stash` or `git clean` on any path
> you did not create in this plan.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Blocks**: `plans/002-fix-test-collection-and-install.md`, which in turn
  blocks `plans/003-lint-the-test-suite.md`. **001 → 002 → 003 is strictly
  serial and must not be run in parallel**: all three edit `Makefile`, two edit
  `.github/workflows/ci.yml`, and 001 and 002 both edit
  `frontend/vitest.config.ts`. This plan is the first of the three; start from
  a clean `main`.
- **Category**: dx
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

The frontend's TypeScript gate is **vacuous**. `frontend/tsconfig.json` is a
solution-style project (`"files": []` plus `references`), so the bare
`tsc --noEmit` that both `make typecheck` and CI run compiles **zero files**
and always exits 0. Verified: `npx tsc --noEmit --listFiles` inside `frontend/`
emits 0 lines, while `npx tsc -b --noEmit --listFiles` pulls in 169 source
files. On top of that, CI never runs `eslint`, never runs the production
`vite build`, and never collects coverage — so the React SPA (169 source files,
55 test files) merges to `main` with **no enforced static analysis at all**.
The only real typecheck in the repo is the `tsc -b` buried inside
`npm run build`, which executes exclusively in the operator-gated manual deploy
workflow (`deploy-worker.yml`, guarded by `if: inputs.confirm_native_deploy ==
'I_UNDERSTAND'`). A type error or a broken bundle is therefore discovered
*after* merge, at deploy time.

The backlog is empty **today**: `npx tsc -b --noEmit` exits 0 and
`npx eslint .` reports 0 errors. Switching the gates on costs nothing right
now, and every day this waits the switch gets more expensive. That is why this
plan is 001 and why almost everything else depends on it.

## Current state

### Files involved, and their role

| File | Role |
|---|---|
| `frontend/tsconfig.json` | Solution-style root project: `files: []` + two references. Compiles nothing on its own. |
| `frontend/tsconfig.app.json` | The real app project — `include: ["src"]`, 169 files. **Correct as-is; do not change.** |
| `frontend/tsconfig.node.json` | Covers `vite.config.ts` only. **Correct as-is; do not change.** |
| `frontend/vitest.config.ts` | Vitest config; declares coverage thresholds that are in the wrong shape for Vitest 4 and are never evaluated. |
| `frontend/eslint.config.js` | Working flat config. **Correct as-is; do not change.** |
| `frontend/package.json` | Has `lint`, `build`, `build:cloudflare`, `test:coverage` scripts that no automation calls. |
| `Makefile` | `typecheck` runs the vacuous form; `lint` is Python-only. |
| `.github/workflows/ci.yml` | Three jobs. `test-frontend` has exactly three steps: install, vacuous typecheck, vitest. |

### Verbatim excerpts (read at commit `42826a3`)

`frontend/tsconfig.json` — the whole file:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`frontend/tsconfig.app.json:28` (file is 29 lines long):

```json
  "include": ["src"]
```

`frontend/tsconfig.node.json:25` (file is 26 lines long):

```json
  "include": ["vite.config.ts"]
```

`Makefile:92-96`:

```make
lint:
	"$(PYTHON)" -m ruff check immi_case_downloader/ scripts/ *.py

typecheck:
	cd "$(REPO_ROOT)/frontend" && npx tsc --noEmit
```

`Makefile:4` (`.PHONY` line):

```make
.PHONY: help dev build test test-py test-fe test-workers test-e2e lint typecheck audit-rls-guards clean
```

`Makefile:34-35` (help text):

```make
	@echo "  make lint         Ruff lint Python source"
	@echo "  make typecheck    TypeScript type check (tsc --noEmit)"
```

`Makefile:62-71`:

```make
test: test-py test-fe test-workers

test-py:
	"$(PYTHON)" -m pytest tests/ --ignore=tests/e2e -q

test-fe:
	cd "$(REPO_ROOT)/frontend" && npx vitest run

test-workers:
	cd "$(REPO_ROOT)/workers" && npx vitest run
```

`.github/workflows/ci.yml:48-69` — the entire `test-frontend` job:

```yaml
  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json

      - name: Install frontend dependencies
        run: npm ci
        working-directory: frontend

      - name: TypeScript typecheck
        run: npx tsc --noEmit
        working-directory: frontend

      - name: Run Vitest tests
        run: npx vitest run
        working-directory: frontend
```

`frontend/package.json:6-21` (scripts block):

```json
  "scripts": {
    "tokens": "tsx scripts/build-tokens.ts",
    "dev": "npm run tokens && vite",
    "build": "npm run tokens && tsc -b && vite build",
    "build:cloudflare": "npm run tokens && tsc -b && vite build --outDir dist --emptyOutDir",
    "dev:cloudflare": "npm run build:cloudflare && wrangler pages dev dist",
    "deploy:cloudflare": "npm run build:cloudflare && wrangler pages deploy dist",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui",
    "e2e:headed": "playwright test --headed"
  },
```

`frontend/vitest.config.ts:13-21` (the coverage block):

```ts
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "./__tests__/", "**/*.config.*", "**/*.d.ts"],
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },
```

`frontend/vitest.config.ts:11-12`:

```ts
    include: ["__tests__/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
```

`.github/workflows/deploy-worker.yml:24` and `:93-95` — the only place any
build runs today:

```yaml
    if: ${{ inputs.confirm_native_deploy == 'I_UNDERSTAND' }}
```

```yaml
      - name: Build React SPA (static assets)
        run: |
          cd frontend
          npm ci
          npm run build:cloudflare
```

### Facts measured at commit `42826a3` (re-measured for this plan, not copied)

| Measurement | Result |
|---|---|
| `cd frontend && npx tsc --noEmit --listFiles \| wc -l` | **0**, exit 0 — the gate compiles nothing |
| `cd frontend && npx tsc -b --noEmit` | exit **0** — no latent errors; switching is free today |
| `cd frontend && npx tsc -b --noEmit --listFiles \| grep -c '/frontend/src/'` | **169** |
| `cd frontend && npx eslint .` | `✖ 25 problems (0 errors, 25 warnings)`, exit **0** |
| `grep -rn 'eslint' .github/workflows/ Makefile` | **no matches** (exit 1) |
| `grep -n 'build\|coverage' .github/workflows/ci.yml` | only a comment on line 34; **no build, no coverage step** |
| `find frontend/__tests__ -name '*.test.ts*' -o -name '*.spec.ts*' \| wc -l` | **55** |
| `ls -d frontend/src/__tests__` | **does not exist** |
| `ls frontend/node_modules/@vitest/` | `expect mocker pretty-format runner snapshot spy ui utils` — **no `coverage-v8`** |
| installed vitest version | **4.0.18** |
| `npm view @vitest/coverage-v8@4.0.18 peerDependencies` | `{ vitest: '4.0.18', '@vitest/browser': '4.0.18' }` — exact pin required |
| `git ls-files immi_case_downloader/static/react \| wc -l` | **93 tracked files** — the default `vite build` outDir |
| `.gitignore:7` | `dist/` — so `build:cloudflare`'s `frontend/dist` output is ignored |
| `git ls-files frontend/src/tokens/` | `tokens.css`, `tokens.json`, `tokens.ts` — all **tracked**; `npm run tokens` rewrites `.css` and `.ts` in place |

### The Vitest 4 coverage-threshold defect, proven

Type-checking `frontend/vitest.config.ts` produces:

```
vitest.config.ts(17,7): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Object literal may only specify known properties, and 'lines' does not
    exist in type '{ provider: "v8"; } & CoverageV8Options'.
```

In Vitest 4 the thresholds live under `coverage.thresholds`, confirmed in
`frontend/node_modules/vitest/dist/chunks/reporters.d.CWXNI2jG.d.ts:750`:

```ts
	thresholds?: Thresholds | ({
		[glob: string]: Pick<Thresholds, 100 | "statements" | "functions" | "branches" | "lines">;
	} & Thresholds);
```

So the four `80`s at `vitest.config.ts:17-20` are **not recognised options**.
They could never have gated anything, even if `--coverage` had been passed.

### What a test tsconfig surfaces (measured with a scratch config outside the repo)

Adding `frontend/__tests__`, `vitest.config.ts`, `playwright.config.ts` and
`frontend/scripts` to a TypeScript project surfaces **exactly 20 errors in 13
files**. All are mechanical. The full list, so you know the job is bounded:

```
__tests__/analytics-charts-tokens.test.tsx(145,7): TS2741 'by_court' missing
__tests__/analytics-charts-tokens.test.tsx(146,7): TS2741 'by_court' missing
__tests__/analytics-charts-tokens.test.tsx(147,7): TS2741 'by_court' missing
__tests__/analytics-filter-integration.test.tsx(10,1): TS6133 'React' unused
__tests__/auth/auth-utils.test.ts(120,11): TS6133 '_raw' unused
__tests__/case-add-page-mutations-disabled.test.tsx(13,1): TS6133 'React' unused
__tests__/case-detail-page.test.tsx(5,1): TS6133 'React' unused
__tests__/cases-page-font.test.tsx(5,1): TS6133 'React' unused
__tests__/cases-page.test.tsx(5,1): TS6133 'React' unused
__tests__/dashboard-page.test.tsx(5,1): TS6133 'React' unused
__tests__/llm-council-page.test.tsx(160,3): TS2741 'retrieve_code' missing
__tests__/llm-council-thread.test.tsx(139,3): TS2741 'retrieve_code' missing
__tests__/session-list-item-stale-closure.test.tsx(34,3): TS2739 case_id, status, created_at missing
__tests__/use-llm-council-sessions.test.ts(86,7): TS2741 'retrieve_code' missing
__tests__/use-llm-council-sessions.test.ts(273,43): TS2345 'retrieve_code' missing
__tests__/use-llm-council-sessions.test.ts(297,43): TS2345 'retrieve_code' missing
__tests__/use-llm-council-sessions.test.ts(324,43): TS2345 'retrieve_code' missing
__tests__/use-llm-council-sessions.test.ts(352,43): TS2345 'retrieve_code' missing
scripts/translate-locales.ts(91,7): TS2769 header value is string | undefined
vitest.config.ts(17,7): TS2769 'lines' is not a known coverage option
```

The last one disappears when you fix the coverage block in Step 4.

**This list is NOT closed — it is only the first batch.** TypeScript suppresses
a container's own assignability error when it has already reported errors
inside that container, so fixing a nested error can reveal a new one on the
same object. That happens here, and it was confirmed on 2026-08-28 with a
minimal reproduction run through this repo's own TypeScript:

```ts
interface Entry { name: string; total: number; win_rate: number; lift: number;
                  by_court: Record<string, { total: number; win_rate: number }>; }
interface Data  { baseline_rate: number; concepts: Entry[]; }

const b: Data = {                                    // after adding by_court:
  concepts: [{ name: "x", win_rate: 65, total: 200, lift: 1.3, by_court: {} }],
  baseline_win_rate: 50,
};
// error TS2561: Object literal may only specify known properties, but
// 'baseline_win_rate' does not exist in type 'Data'.
// Did you mean to write 'baseline_rate'?
```

That is exactly the shape of
`frontend/__tests__/analytics-charts-tokens.test.tsx`: the fixture writes
`baseline_win_rate: 50` at **line 149** while
`frontend/src/types/case.ts:298-301` declares

```ts
export interface ConceptEffectivenessData {
  baseline_rate: number;
  concepts: ConceptEffectivenessEntry[];
}
```

So a 21st error appears the moment Step 5d's three `by_court: {}` additions
land. Step 5d fixes it in the same pass. **Treat the enumerated list as a
starting inventory, not a completion criterion**: the completion criterion is
`npx tsc --noEmit -p tsconfig.test.json` exiting 0, and you re-run it after
every batch of fixes until it does.

The source types these fixtures must satisfy, read at `42826a3`:

`frontend/src/types/case.ts:290-296`:

```ts
export interface ConceptEffectivenessEntry {
  name: string;
  total: number;
  win_rate: number;
  lift: number;
  by_court: Record<string, { total: number; win_rate: number }>;
}
```

`frontend/src/lib/api-llm-council.ts:63-83`:

```ts
export interface LlmCouncilSession {
  session_id: string;
  case_id: string | null;
  title: string;
  status: "active" | "complete" | "abandoned";
  total_turns: number;
  /** 6-char user-facing recall code (Task C). Null on legacy rows. */
  retrieve_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface LlmCouncilSessionListItem {
  session_id: string;
  case_id: string | null;
  title: string;
  status: string;
  total_turns: number;
  created_at: string;
  updated_at: string;
}
```

The six unused-React sites are all the identical line
`import React from "react";` — verified individually at
`analytics-filter-integration.test.tsx:10`,
`case-add-page-mutations-disabled.test.tsx:13`,
`case-detail-page.test.tsx:5`, `cases-page-font.test.tsx:5`,
`cases-page.test.tsx:5`, `dashboard-page.test.tsx:5`. The project uses
`"jsx": "react-jsx"` (`tsconfig.app.json:15`), so the import is not needed for
JSX and deleting it is safe.

`frontend/__tests__/session-list-item-stale-closure.test.tsx:30-39`:

```tsx
function makeSession(
  id: string,
  title: string
): LlmCouncilSessionListItem {
  return {
    session_id: id,
    title,
    total_turns: 1,
    updated_at: new Date().toISOString(),
  };
}
```

`frontend/__tests__/analytics-charts-tokens.test.tsx:143-149`:

```tsx
  const effectivenessData: ConceptEffectivenessData = {
    concepts: [
      { name: "Procedural Fairness", win_rate: 65, total: 200, lift: 1.3 },
      { name: "Natural Justice", win_rate: 38, total: 150, lift: 0.9 },
      { name: "Jurisdictional Error", win_rate: 55, total: 100, lift: 1.1 },
    ],
    baseline_win_rate: 50,
  };
```

`frontend/scripts/translate-locales.ts:4-9` and `:89-96`:

```ts
const API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY

if (!API_KEY) {
  console.error('❌ GOOGLE_TRANSLATE_API_KEY environment variable is not set')
  process.exit(1)
}
```

```ts
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': API_KEY,
      },
      body: JSON.stringify(requestBody),
    })
```

`API_KEY` is `string | undefined` at the point of use; TypeScript does not
carry the module-level guard's narrowing into the function body.

### Repo conventions you must honour

Quoted from `CLAUDE.md` — you have not read that file, so these are inlined:

- **Commits**: `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Real example from `git log`: `fix: install root node_modules in make install`.
- **React**: use `.toSorted()` not `.sort()`; wrap every `localStorage` call in
  try/catch; use `t("key", { defaultValue: "..." })` for UI strings;
  TanStack Query filter-dependent hooks use `placeholderData` /
  `keepPreviousData`; every Recharts `Tooltip` `contentStyle` must set
  `color: "var(--color-text)"`; put `animate-spin` on a wrapper `<div>`, not on
  the SVG icon; all spacing/shadow/radius/colour values come from
  `frontend/src/tokens/tokens.json` — no magic numbers.
  *(You are not writing React components in this plan, but if a test fixture
  fix tempts you into component code, these apply.)*
- **tsconfig layering** (`CLAUDE.md`, "React Frontend Gotchas"): "root
  `frontend/tsconfig.json` is project-references only; do NOT add
  `baseUrl`/`paths`/`compilerOptions` there. All path aliases live in
  `tsconfig.app.json` only. Duplicating `baseUrl` in root causes TS5101
  deprecation error with no clean fix on TS 5.x." **This plan adds one entry to
  the `references` array of `tsconfig.json` and nothing else.**
- **Vitest test assertions** (`CLAUDE.md`): "`__tests__/` are NOT in
  `tsconfig.app.json`'s `include: ["src"]`, so `@/*` path aliases show as TS
  errors in the editor but resolve correctly at Vitest runtime via vite alias
  config." Step 5 is what fixes that editor/runtime split.
- **Python**: always use the repo venv at
  `/Users/d/Developer/Active Projects/IMMI-Case-/.venv` (`.venv/bin/python`,
  `.venv/bin/pytest`, `.venv/bin/ruff`). Never global `pip`.

## Commands you will need

Run all frontend commands from
`/Users/d/Developer/Active Projects/IMMI-Case-/frontend` unless stated.

### Baseline capture (do this before Step 1)

Every "expected" number in this plan is a **delta against a baseline you
measure yourself**, not a hard-coded suite total. Hard-coded totals rot the
moment a sibling plan lands and they train executors to edit the yardstick
instead of the code. Run this first and keep the output; the rest of the plan
refers to these variables by name.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"

# Frontend
cd frontend
FE_SRC_BEFORE=$(npx tsc -b --noEmit --force --listFiles | grep -c '/frontend/src/')
FE_TESTFILES_BEFORE=$(npx vitest list --filesOnly | grep -c .)
npx vitest run 2>&1 | tail -6      # read "Test Files N passed" / "Tests M passed"
cd ..

# Workers
cd workers && npx vitest run 2>&1 | tail -4; cd ..

# Python
make test-py 2>&1 | tail -3
```

Write down, in your handoff:

| Baseline | Symbol | Value observed at `42826a3` (re-measure; do not trust this column) |
|---|---|---|
| src files in the app tsc project | `FE_SRC_BEFORE` | 169 |
| frontend test files collected | `FE_TESTFILES_BEFORE` | 55 |
| frontend tests passing | `FE_TESTS_BEFORE` | 490 |
| worker tests passing | `WK_TESTS_BEFORE` | 345 |
| python passed / failed / skipped | `PY_*_BEFORE` | 1141 / 3 / 7 |

### Command reference

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend install | `cd frontend && npm ci` | exit 0 |
| Typecheck (correct form) | `cd frontend && npx tsc -b --noEmit` | exit 0, no output |
| Typecheck non-vacuity probe | `cd frontend && npx tsc -b --noEmit --force --listFiles \| grep -c '/frontend/src/'` | exactly `FE_SRC_BEFORE` (this plan adds and deletes no `src` file) |
| Test-project typecheck | `cd frontend && npx tsc --noEmit -p tsconfig.test.json` | exit 0 after Step 5 |
| Frontend lint | `cd frontend && npm run lint` | `0 errors` (warning count is not gated) , exit 0 |
| Frontend unit tests | `cd frontend && npx vitest run` | exactly `FE_TESTS_BEFORE` passed across `FE_TESTFILES_BEFORE` files, exit 0 |
| Frontend coverage | `cd frontend && npx vitest run --coverage` | same counts + a coverage table, exit 0 |
| Production build | `cd frontend && npm run build:cloudflare` | exit 0, writes gitignored `frontend/dist/` |
| Worker tests | `cd workers && npx vitest run` | exactly `WK_TESTS_BEFORE` passed |
| Python tests | `make test-py` | `PY_PASSED_BEFORE` passed, `PY_SKIPPED_BEFORE` skipped, `3 failed` — see note below |
| Python lint | `make lint-py` (after Step 3) | `All checks passed!` |
| Makefile typecheck | `make typecheck` | exit 0 |
| Makefile lint (after Step 3) | `make lint` | ruff `All checks passed!` **and** eslint 0 errors |
| YAML sanity | `python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/ci.yml'))"` | exit 0, no output |

**Python test note — do not chase these**: `make test-py` reports
**3 pre-existing failures**, and they must still be *exactly those three, by
name*, when you finish:

```
tests/test_backfill_judge_overrides_from_pdf.py::test_clean_line_does_not_destroy_words
tests/test_backfill_judge_overrides_from_pdf.py::test_extract_judiciary_names_filters_non_judicial_judging
tests/test_backfill_judge_overrides_from_pdf.py::test_merge_treats_postnominal_variant_as_equivalent
```

All three fail with `ImportError: ... pyexpat ... _XML_SetAllocTrackerActivationThreshold`.
They are environmental: the Homebrew Python 3.14.7 this repo's `.venv` was
built on has a `pyexpat`/`libexpat` ABI mismatch that breaks the `pypdf`
import. They are not caused by repo code and are not this plan's problem.
Assert on the three test **names**, not on the number `3` alone.

## Scope

**In scope** (the only files you may modify):

- `.github/workflows/ci.yml`
- `Makefile`
- `frontend/tsconfig.json` — add exactly one entry to `references`
- `frontend/tsconfig.test.json` — **create**
- `frontend/vitest.config.ts`
- `frontend/package.json` — one devDependency added
- `frontend/package-lock.json` — regenerated by npm; never hand-edit
- The 13 files that the new test project surfaces errors in, enumerated so a
  parallel plan can see the exact collision surface:
  - `frontend/__tests__/analytics-charts-tokens.test.tsx`
  - `frontend/__tests__/analytics-filter-integration.test.tsx`
  - `frontend/__tests__/auth/auth-utils.test.ts`
  - `frontend/__tests__/case-add-page-mutations-disabled.test.tsx`
  - `frontend/__tests__/case-detail-page.test.tsx`
  - `frontend/__tests__/cases-page-font.test.tsx`
  - `frontend/__tests__/cases-page.test.tsx`
  - `frontend/__tests__/dashboard-page.test.tsx`
  - `frontend/__tests__/llm-council-page.test.tsx`
  - `frontend/__tests__/llm-council-thread.test.tsx`
  - `frontend/__tests__/session-list-item-stale-closure.test.tsx`
  - `frontend/__tests__/use-llm-council-sessions.test.ts`
  - `frontend/scripts/translate-locales.ts`

**Out of scope** (do NOT touch, even though they look related):

- `frontend/tsconfig.app.json` and `frontend/tsconfig.node.json` — both were
  read and are correct as they stand. Changing `include: ["src"]` would
  double-check files or break the app project.
- `frontend/eslint.config.js` — `npx eslint .` already runs clean (0 errors).
  Do **not** raise severities, do **not** change `ecmaVersion`, do **not**
  add `--max-warnings 0`. Tightening lint rules is a separate decision; doing it
  here would make a free gate expensive and could block the plan.
- `frontend/src/**` — the 25 ESLint warnings live here (unused
  `eslint-disable` directives, `no-console`). Leave them. Fixing them is a
  follow-up, not this plan.
- `frontend/e2e/**` (12 `.ts` files) and their inclusion in any tsconfig — they
  need `@playwright/test` types and would surface an unmeasured number of new
  errors. Deliberately deferred; see "Maintenance notes".
- `pytest.ini` — it sets `--cov` with no `--cov-fail-under`. Real gap, but it is
  Python-side and belongs to a Python-testing plan. See "Findings reconsidered".
- `CLAUDE.md` — line 32 documents a stale path
  (`npx vitest run src/__tests__/components/judges/`; the real directory is
  `frontend/__tests__/` and `frontend/src/__tests__` does not exist). Correct
  observation, wrong plan. See "Maintenance notes".
- `.github/workflows/deploy-worker.yml` — the operator-gated deploy path. Do not
  weaken its `I_UNDERSTAND` gate or its `workflow_dispatch`-only trigger.
- `wrangler.toml` placeholder resource IDs, `IMMI_CASE_MUTATIONS_ENABLED` and
  the pipeline flags defaulting to `"false"` — all fail-closed **by design**.
- `package.json` at the repo root, `workers/**`, `immi_case_downloader/**`.

## Git workflow

- Branch: `advisor/001-restore-the-frontend-compile-gate`, cut from `main`.
- Commit after each step (or each logical unit), conventional-commit style:
  `<type>: <description>`, types `feat|fix|refactor|docs|test|chore|perf|ci`.
  Suggested messages are given per step.
- **No AI attribution lines** in commit messages — attribution is disabled
  globally for this repo.
- Do **NOT** push, do **NOT** open a PR, do **NOT** merge. The operator commits
  and ships.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
git checkout -b advisor/001-restore-the-frontend-compile-gate
```

Note: the working tree may already carry modifications that are not yours —
`.claude/STATE.md` was dirty at `42826a3`, and `plans/` may be dirty or
untracked. Whatever the drift check showed as already-dirty at the start is
pre-existing: leave it alone, do not stage it, and do not "clean" it. Record
what was dirty in your handoff so a reviewer can tell your diff from the
operator's.

Before committing, per this repo's `CLAUDE.md` GitNexus rules, run
`detect_changes()` and report the affected symbol set. If the index is stale,
refresh it (`node .gitnexus/run.cjs analyze`) or mark the check **unverified**.

## Steps

### Step 1: Make the TypeScript gate compile real files

Two edits. Both replace the bare `tsc --noEmit` (which loads a project with
`files: []`) with build mode, which follows the `references` array.

**1a.** `Makefile` — replace lines 95-96:

```make
typecheck:
	cd "$(REPO_ROOT)/frontend" && npx tsc --noEmit
```

with:

```make
typecheck:
	cd "$(REPO_ROOT)/frontend" && npx tsc -b --noEmit
```

**1b.** `Makefile:35` — update the help text so it stops advertising the broken
form. Replace:

```make
	@echo "  make typecheck    TypeScript type check (tsc --noEmit)"
```

with:

```make
	@echo "  make typecheck    TypeScript type check (tsc -b --noEmit, all projects)"
```

**1c.** `.github/workflows/ci.yml` — replace the `TypeScript typecheck` step
(lines 63-65):

```yaml
      - name: TypeScript typecheck
        run: npx tsc --noEmit
        working-directory: frontend
```

with these two steps:

```yaml
      - name: TypeScript typecheck (build mode)
        working-directory: frontend
        run: |
          set -euo pipefail
          npx tsc -b --noEmit --force --listFiles | tee /tmp/tsc-listfiles.txt

      - name: Assert the typecheck is not vacuous
        working-directory: frontend
        run: |
          set -euo pipefail
          src=$(grep -c '/frontend/src/' /tmp/tsc-listfiles.txt || true)
          echo "typechecked $src files under frontend/src/"
          if [ "$src" -lt 150 ]; then
            echo "::error::TypeScript project graph collapsed: only $src files under src/ were typechecked (expected >= 150). A tsconfig 'files'/'include'/'references' change has made the gate vacuous."
            exit 1
          fi
```

Why `--force`: build mode is incremental and can skip work when the
`.tsbuildinfo` says everything is up to date, which would empty `--listFiles`
and make the assertion flap. `--force` makes the count deterministic.

Why the assertion exists at all: this is the exact failure the plan is fixing.
Without it, any future tsconfig edit can silently empty the gate again and
nothing will say so. `150` is a floor, not a target — today the count is
`FE_SRC_BEFORE` (169 when this plan was written).

**The margin on that floor is thinner than it looks, so Step 6 adds a second,
identity-based assertion.** Measured on 2026-08-28 with a scratch project
outside the repo: the test project *on its own* transitively pulls in **122**
files under `frontend/src/` through its `@/*` imports. So deleting the
`tsconfig.app.json` reference would drop the count to 122 and the `>= 150`
floor would still catch it — but only by 28 files. One more import-heavy test
file and a count-only gate stops discriminating between "the app project is
wired in" and "the test project happens to reach enough files". Step 6b
therefore also asserts the *identity* of the `references` array, which cannot
drift silently regardless of file counts.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make typecheck && echo "TYPECHECK_OK"
python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML_OK"
cd frontend && npx tsc -b --noEmit --force --listFiles | grep -c '/frontend/src/'
```

→ prints `TYPECHECK_OK`, then `YAML_OK`, then a number equal to
`FE_SRC_BEFORE` from the baseline capture. This plan adds and deletes no file
under `frontend/src/`, so any change here is a STOP condition.

Commit: `ci: type-check the frontend in build mode instead of an empty project`

### Step 2: Run the production build in CI

`npm run build:cloudflare` is the exact command the gated deploy workflow runs
(`deploy-worker.yml:95`). Running it in CI means a broken bundle is caught on
the PR instead of at deploy time. Use `build:cloudflare` rather than `build`:
it writes to `frontend/dist/`, which `.gitignore:7` (`dist/`) ignores, whereas
plain `npm run build` writes into `immi_case_downloader/static/react/` — **93
tracked files**, with `emptyOutDir: true`. Running plain `build` locally would
produce a large, noisy diff of regenerated hashed asset names.

`.github/workflows/ci.yml` — add this step to `test-frontend`, **after** the
non-vacuity assertion and **before** the Vitest step:

```yaml
      - name: Build production bundle
        run: npm run build:cloudflare
        working-directory: frontend

      - name: Assert the committed design tokens are not stale
        run: git diff --exit-code -- frontend/src/tokens/tokens.css frontend/src/tokens/tokens.ts
```

The second step is not optional decoration. `npm run build:cloudflare` runs
`npm run tokens` first, and that generator rewrites the **tracked** files
`frontend/src/tokens/tokens.css` and `frontend/src/tokens/tokens.ts` in place
from `frontend/src/tokens/tokens.json`. Without this assertion the build would
silently regenerate them inside the CI runner and throw the result away, so a
pull request that edits `tokens.json` without regenerating its outputs — or
that hand-edits a generated file — merges green and ships stale tokens. The
generator is deterministic (verified 2026-08-28: `frontend/scripts/build-tokens.ts`
contains no `Date`/timestamp/`toISOString` call, and both outputs begin with
the fixed header `/* Auto-generated from tokens.json — do not edit manually */`),
so on a healthy tree this diff is empty and the step is silent. When it fires
it fires for a real reason.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npm run build:cloudflare && echo "BUILD_OK"
cd ..
git diff --exit-code -- frontend/src/tokens/tokens.css frontend/src/tokens/tokens.ts && echo "TOKENS_CLEAN"
git status --short
```

→ prints `BUILD_OK`, then `TOKENS_CLEAN`; `git status --short` shows your own
in-scope edits plus whatever was already dirty when you ran the drift check,
and **nothing** under `frontend/src/tokens/` or
`immi_case_downloader/static/react/`. If `TOKENS_CLEAN` does not print, that is
a STOP condition (the committed generated files are stale) — report it, do not
commit the regeneration.

Commit: `ci: build the production bundle on every pull request`

### Step 3: Wire ESLint into CI and the Makefile

ESLint is configured and working (`frontend/eslint.config.js` exists,
`frontend/package.json:13` defines `"lint": "eslint ."`), but
`grep -rn 'eslint' .github/workflows/ Makefile` matches **nothing**. Today
`npx eslint .` gives `0 errors, 25 warnings` and exits 0, so turning the gate
on is free and it will catch any **new** error immediately.

**3a.** `.github/workflows/ci.yml` — add to `test-frontend`, after the
non-vacuity assertion and before the build step:

```yaml
      - name: ESLint
        run: npm run lint
        working-directory: frontend
```

Do **not** add `--max-warnings 0`. There are 25 pre-existing warnings in
`frontend/src/**` (out of scope); the gate is on errors.

**3b.** `Makefile` — replace lines 92-93:

```make
lint:
	"$(PYTHON)" -m ruff check immi_case_downloader/ scripts/ *.py
```

with:

```make
lint: lint-py lint-fe

lint-py:
	"$(PYTHON)" -m ruff check immi_case_downloader/ scripts/ *.py

lint-fe:
	cd "$(REPO_ROOT)/frontend" && npm run lint
```

**3c.** `Makefile:4` — add the two new targets to `.PHONY`:

```make
.PHONY: help dev build test test-py test-fe test-workers test-e2e lint lint-py lint-fe typecheck coverage-fe audit-rls-guards clean
```

(`coverage-fe` is added now so you do not have to touch this line again in
Step 4.)

**3d.** `Makefile:34` — update the help text. Replace:

```make
	@echo "  make lint         Ruff lint Python source"
```

with:

```make
	@echo "  make lint         Ruff (Python) + ESLint (frontend)"
	@echo "  make lint-py      Ruff lint Python source only"
	@echo "  make lint-fe      ESLint the frontend only"
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make lint-py && echo "LINT_PY_OK"
make lint-fe; echo "lint-fe exit=$?"
make lint && echo "LINT_ALL_OK"
python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML_OK"
```

→ `make lint-py` prints `All checks passed!` then `LINT_PY_OK`;
`make lint-fe` prints a summary line whose **error** count is `0` (the warning
count is not gated and is expected to be non-zero — 25 at `42826a3`) and
`lint-fe exit=0`; `make lint` runs both and prints `LINT_ALL_OK`;
then `YAML_OK`.

Assert on the error count, not the warning count, and not on the exit code
alone — ESLint exits 0 for warnings, so `exit=0` on its own would also be
printed by a config that lints nothing. Confirm the run actually inspected
files:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx eslint . -f json | python3 -c "import json,sys; d=json.load(sys.stdin); print('files linted:', len(d)); print('errors:', sum(f['errorCount'] for f in d))"
```

→ `files linted:` in the low hundreds (measured **242** on 2026-08-28, with
`errors: 0` and `warnings: 25`). The number itself is not the gate; the point
is that it is not `0`, which is what a silently-broken flat config would give.

Commit: `ci: run ESLint on the frontend in CI and make lint`

### Step 4: Make the Vitest coverage thresholds real

Three things are wrong at once: the coverage provider is not installed, the
thresholds are in a shape Vitest 4 does not recognise, and no automation ever
passes `--coverage`.

**4a.** Record the exact installed Vitest version **before** touching anything,
so you can prove afterwards that it did not move:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
python3 -c "import json;print(json.load(open('package-lock.json'))['packages']['node_modules/vitest']['version'])" | tee /tmp/vitest-version-before.txt
```

→ `4.0.18` at `42826a3`.

Now install the provider, pinned to that exact version.
`@vitest/coverage-v8@4.0.18` declares `peerDependencies: { vitest: '4.0.18' }`
— an exact pin — and `frontend/node_modules/vitest` is `4.0.18`. Use the exact
version, **not** a caret range: `^4.0.18` resolves to 4.1.x and would drag
`vitest` itself forward across the whole suite.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npm install --save-dev --save-exact @vitest/coverage-v8@4.0.18
```

Then prove `vitest` itself did not move:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
python3 -c "import json;print(json.load(open('package-lock.json'))['packages']['node_modules/vitest']['version'])" > /tmp/vitest-version-after.txt
diff /tmp/vitest-version-before.txt /tmp/vitest-version-after.txt && echo "VITEST_PIN_HELD"
```

→ `VITEST_PIN_HELD`. **Do not** try to prove this with
`git diff frontend/package-lock.json | grep '"vitest"'`. That check cannot
fail usefully: `package-lock.json` is lockfileVersion 3, which records a
`peerDependencies` block per package, and the newly added
`node_modules/@vitest/coverage-v8` entry contains `"vitest": "4.0.18"` inside
its own `peerDependencies` — so the grep matches added lines even when
`vitest` is completely unchanged. (Verified 2026-08-28: two existing entries in
this lockfile, `node_modules/vitest` and `node_modules/@vitest/ui`, already
carry `vitest` inside `peerDependencies`.) Compare the parsed version field,
which is the only thing that answers the question.

**4b.** Fix the *coverage universe* before measuring anything, or the number
you measure will be meaningless.

Two independent defects in the current `coverage` block:

1. **No `coverage.include`.** Verified against the installed Vitest 4.0.18
   type definitions
   (`frontend/node_modules/vitest/dist/chunks/reporters.d.CWXNI2jG.d.ts`,
   `BaseCoverageOptions.include`): *"List of files included in coverage as glob
   patterns. **By default only files covered by tests are included.**"* — and
   `coverageConfigDefaults.include` really is `undefined` (checked by importing
   `coverageConfigDefaults` from `vitest/config`). So a `src` file that no test
   imports never enters the denominator at all. A ratchet measured on that
   universe is a ratchet on "the files we already test", which is close to
   meaningless: adding an untested module cannot lower it.
2. **`"./__tests__/"` does not describe where the tests live.** It was written
   when `frontend/__tests__/` was the only test root. It does not match
   `src/**/__tests__/**`, and `plans/002` is about to widen the Vitest
   `include` glob to collect exactly that directory — at which point the test
   file itself would be eligible to count as covered source.

Replace the whole block so the universe is stated explicitly:

```ts
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      // Explicit universe. Without `include`, Vitest 4 reports only files that
      // some test imported, so untested modules silently vanish from the
      // denominator and the thresholds below would measure nothing.
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/__tests__/**",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/*.d.ts",
        "**/*.config.*",
        "src/tokens/tokens.ts",
      ],
      // (thresholds follow — see 4d)
    },
```

`src/tokens/tokens.ts` is excluded because it is generated from
`tokens.json` by `npm run tokens`; gating coverage on generated data is noise.

**4c.** Now measure the real coverage, on the corrected universe:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run --coverage
```

Record the four percentages from the `All files` row of the printed table:
`% Stmts`, `% Branch`, `% Funcs`, `% Lines`.

**Prove the universe is what you asked for** — this is the check that fails if
`include` is being ignored:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
DISK=$(find src -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -not -path '*/__tests__/*' -not -name '*.d.ts' -not -name '*.config.*' \
  -not -name 'tokens.ts' | wc -l | tr -d ' ')
REPORTED=$(python3 -c "import json;d=json.load(open('coverage/coverage-summary.json'));print(len([k for k in d if k!='total']))")
echo "on disk: $DISK   in coverage report: $REPORTED"
[ "$DISK" = "$REPORTED" ] && echo "COVERAGE_UNIVERSE_OK" || echo "MISMATCH"
grep -c '__tests__' coverage/coverage-summary.json
```

→ `COVERAGE_UNIVERSE_OK`, and the `grep -c` prints `0` (no test file is being
counted as source). If the two numbers differ, do **not** paper over it by
adjusting the threshold — report the mismatch and the two file lists.

**4d.** `frontend/vitest.config.ts` — add the thresholds. Replace the
`// (thresholds follow — see 4d)` placeholder from 4b with the nested form
Vitest 4 actually reads, so the finished block is:

```ts
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/__tests__/**",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "**/*.d.ts",
        "**/*.config.*",
        "src/tokens/tokens.ts",
      ],
      // Vitest 4 only reads thresholds nested under `thresholds`. The four
      // flat `80`s that used to live here were not recognised options and
      // never gated anything. These numbers are a RATCHET pinned to the
      // coverage measured on the universe defined by `include` above —
      // raise them, never lower them.
      thresholds: {
        lines: LINES,
        functions: FUNCTIONS,
        branches: BRANCHES,
        statements: STATEMENTS,
      },
    },
```

Choose each number by this rule, so the gate is real and passes today:

- If the measured metric is **≥ 80**, use `80`. The written 80% policy becomes
  genuinely enforced.
- If the measured metric is **< 80**, use `Math.floor(measured)` — the largest
  whole percent that passes right now. Do **not** round up and do **not**
  aspirationally write 80; that would fail CI on the very first run.

Expect these numbers to be **much lower** than the ones a run without
`coverage.include` would have produced, because untested modules now count.
That is the point: a threshold measured on "only the files we already test" is
a threshold that no untested file can ever violate.

Note on the old `exclude` list (`["node_modules/", "./__tests__/", …]`): the
audit that fed this plan suspected the leading `./` was the defect. It is not —
in Vitest 4 `coverageConfigDefaults.exclude` is `[]`, so supplying an `exclude`
list clobbers no default. The list is being replaced because it describes the
wrong universe once `include` exists and once `plans/002` widens the test glob,
not because of the `./`.

**`plans/002` re-measures these numbers.** It widens the Vitest `include` glob
to collect `frontend/src/lib/__tests__/saved-searches.test.ts`, which executes
`src/lib/saved-searches.ts` for the first time and moves at least the `lines`
figure. Do not try to pre-compensate here; 002 Step 1a owns the re-measure and
says so.

**4e.** `.github/workflows/ci.yml` — change the Vitest step from:

```yaml
      - name: Run Vitest tests
        run: npx vitest run
        working-directory: frontend
```

to:

```yaml
      - name: Run Vitest tests with coverage thresholds
        run: npx vitest run --coverage
        working-directory: frontend
```

This is the same single test run, with thresholds enforced — not a second run.

**4f.** `Makefile` — add a target after `test-workers` (after line 71) so the
CI command is reproducible locally:

```make
coverage-fe:
	cd "$(REPO_ROOT)/frontend" && npx vitest run --coverage
```

Leave `test-fe` as the fast, no-coverage local loop. `.PHONY` already lists
`coverage-fe` from Step 3c.

**4g.** `Makefile:32` — add a help line next to the existing `make coverage`
entry:

```make
	@echo "  make coverage-fe  Frontend Vitest with coverage thresholds"
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make coverage-fe && echo "COVERAGE_OK"
python3 - <<'PY'
import re
s = open("frontend/vitest.config.ts").read()
cov = s.split("coverage:", 1)[1]
assert "thresholds: {" in cov, "thresholds block missing"
head = cov.split("thresholds: {", 1)[0]
for k in ("lines", "functions", "branches", "statements"):
    assert not re.search(rf"^\s*{k}\s*:", head, re.M), f"{k} is still a direct child of coverage"
assert 'include: ["src/**/*.{ts,tsx}"]' in cov, "coverage.include missing"
print("COVERAGE_CONFIG_SHAPE_OK")
PY
python3 -c "import json;print(json.load(open('frontend/package.json'))['devDependencies']['@vitest/coverage-v8'])"
python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML_OK"
```

→ `make coverage-fe` prints the same passing test counts as the baseline
capture, a coverage table, **no** `ERROR: Coverage for ... does not meet
threshold` line, then `COVERAGE_OK`; then `COVERAGE_CONFIG_SHAPE_OK`; then
`4.0.18` exactly (no `^`, no `~`); then `YAML_OK`.

The `python3` shape check replaces a bare `grep -n 'thresholds'`, which would
also have matched the explanatory comment above the block and so could not
have failed for the right reason.

Sanity check that the gate is live rather than decorative: temporarily raise
`lines` to `100`, re-run `npx vitest run --coverage`, confirm it **fails** with
a threshold error and a non-zero exit, then restore your measured value and
confirm it passes again. Do not commit the `100`.

Commit: `test: enforce Vitest coverage thresholds instead of declaring them`

### Step 5: Create the test tsconfig and clear every error it surfaces

Right now the 55 files under `frontend/__tests__`, plus `vitest.config.ts`,
`playwright.config.ts`, `scripts/build-tokens.ts` and
`scripts/translate-locales.ts`, belong to **no** TypeScript project:
`tsconfig.app.json` includes only `src`, `tsconfig.node.json` only
`vite.config.ts`. Even after Step 1 they are type-checked by nothing.

Create the project **without** wiring it in yet, so `main` stays green while
you clear the backlog. Wiring happens in Step 6.

**5a.** Create `frontend/tsconfig.test.json` with exactly this content:

```json
{
  "extends": "./tsconfig.app.json",
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.test.tsbuildinfo",
    "types": [
      "vite/client",
      "vitest/globals",
      "@testing-library/jest-dom",
      "node"
    ]
  },
  "include": ["__tests__", "vitest.config.ts", "playwright.config.ts", "scripts"]
}
```

Three details that matter and will bite if you change them:

- `tsBuildInfoFile` **must** be overridden. `tsconfig.app.json:3` sets
  `./node_modules/.tmp/tsconfig.app.tsbuildinfo`; inheriting it would make two
  projects in the same `tsc -b` graph fight over one incremental cache file.
- `types` **replaces** the inherited `["vite/client"]` rather than extending it.
  `vitest/globals` is required because `frontend/vitest.config.ts:8` sets
  `globals: true`, so `describe`/`it`/`expect` are ambient.
  `@testing-library/jest-dom` is required because
  `frontend/__tests__/legislations-setup.ts:3` does
  `import "@testing-library/jest-dom";`.
- `include` **replaces** the inherited `["src"]`. `src` files still get checked
  here transitively through `@/*` imports — that is intended and harmless.
  `frontend/e2e/**` is deliberately absent; see "Out of scope".

**5b.** Run the new project and confirm you see the expected backlog:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx tsc --noEmit -p tsconfig.test.json 2>&1 | tee /tmp/tsc-test-backlog.txt | grep -c 'error TS'
```

→ Expect **19** on the first run (the 20 enumerated above, minus the
`vitest.config.ts` TS2769 that Step 4 already fixed). If you instead see four
errors reading `error TS2688: Cannot find type definition file for ...`, the
file is not at `frontend/tsconfig.test.json` — move it there and re-run. (That
failure was reproduced deliberately on 2026-08-28: a copy of this config placed
outside `frontend/` cannot resolve `vite/client`, `vitest/globals`,
`@testing-library/jest-dom` or `node`, and reports exactly those four.)

**19 is a starting inventory, not a target.** As shown in "What a test tsconfig
surfaces", fixing the three `by_court` errors unmasks a 21st error on the same
object literal. After every batch of fixes, re-run:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx tsc --noEmit -p tsconfig.test.json 2>&1 | grep -c 'error TS'
```

and keep going until it prints `0`. Any error that appears at a file:line **not
on the enumerated list and not `analytics-charts-tokens.test.tsx:149`** is a
STOP condition — report it rather than guessing at a fix.

**5c.** Fix the seven unused-symbol errors (TS6133):

Delete the whole line `import React from "react";` from each of these six
files. `tsconfig.app.json:15` sets `"jsx": "react-jsx"`, so JSX does not need
the import and nothing else in these files references `React`:

- `frontend/__tests__/analytics-filter-integration.test.tsx:10`
- `frontend/__tests__/case-add-page-mutations-disabled.test.tsx:13`
- `frontend/__tests__/case-detail-page.test.tsx:5`
- `frontend/__tests__/cases-page-font.test.tsx:5`
- `frontend/__tests__/cases-page.test.tsx:5`
- `frontend/__tests__/dashboard-page.test.tsx:5`

In `frontend/__tests__/auth/auth-utils.test.ts:120`, delete the dead line
`const _raw = '{"ok":true}'; // ...`. The comment on the following line
(`// Actually let's just verify any 0-remainder case parses correctly.`)
already supersedes it, and the value is never read. Do not rename it — TypeScript's
`noUnusedLocals` does not honour a leading underscore for local variables (only
for parameters), so `_raw` cannot be silenced that way.

**5d.** Fix the twelve fixture-shape errors (eleven visible on the first run,
plus the one the first eleven are masking). Each is a test fixture that has
drifted behind its source type. Add or rename the fields; do not weaken the
source types and do not add `as any`.

- `frontend/__tests__/analytics-charts-tokens.test.tsx:145-147` — each of the
  three `concepts` entries needs `by_court`, per
  `frontend/src/types/case.ts:295` (`by_court: Record<string, { total: number; win_rate: number }>`).
  Add `by_court: {},` to each object.
- `frontend/__tests__/analytics-charts-tokens.test.tsx:149` — **in the same
  edit**, rename the key `baseline_win_rate` to `baseline_rate`.
  `ConceptEffectivenessData` (`frontend/src/types/case.ts:298-301`) declares
  `baseline_rate: number` and has no `baseline_win_rate` member; the fixture's
  key has been wrong the whole time and TypeScript was masking it behind the
  three `by_court` errors. The line becomes:

  ```tsx
      baseline_rate: 50,
  ```

  This is behaviourally inert — verified 2026-08-28 by
  `grep -rn 'baseline_rate\|baseline_win_rate' frontend/src frontend/__tests__`,
  whose only `frontend/src` hits are the two type declarations
  (`types/case.ts:268`, `:299`) and `components/judges/ConceptEffectivenessTable.tsx:8`.
  `ConceptEffectivenessChart`, the component this fixture is passed to, never
  reads the field, so the rename cannot change what the test asserts.
- `frontend/__tests__/llm-council-page.test.tsx:160` and
  `frontend/__tests__/llm-council-thread.test.tsx:139` — each fixture is an
  `LlmCouncilSession` missing `retrieve_code`. That field is
  `string | null` (`frontend/src/lib/api-llm-council.ts:70`, documented as
  "Null on legacy rows"), so add `retrieve_code: null,`.
- `frontend/__tests__/use-llm-council-sessions.test.ts:86` — same
  `LlmCouncilSession` shape; add `retrieve_code: null,`.
- `frontend/__tests__/use-llm-council-sessions.test.ts:273, 297, 324, 352` —
  these are `mockCreateSession.mockResolvedValue({...})` payloads whose target
  type requires a **non-nullable** `retrieve_code: string`. Add a realistic
  6-character code, e.g. `retrieve_code: "ABC123",`, to each of the four
  objects.
- `frontend/__tests__/session-list-item-stale-closure.test.tsx:34` — the
  `makeSession` helper returns an `LlmCouncilSessionListItem` missing
  `case_id`, `status` and `created_at`
  (`frontend/src/lib/api-llm-council.ts:75-83`). Add all three inside the
  returned object:

  ```ts
    case_id: null,
    status: "active",
    created_at: new Date().toISOString(),
  ```

**5e.** Fix `frontend/scripts/translate-locales.ts:91`. `API_KEY` is
`process.env.GOOGLE_TRANSLATE_API_KEY` (`string | undefined`) and TypeScript
does not carry the module-level `if (!API_KEY) { … process.exit(1) }` guard
into the function body where the header is built. Rename the raw read and
re-bind a narrowed constant, preserving runtime behaviour exactly. Replace
lines 4-9:

```ts
const API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY

if (!API_KEY) {
  console.error('❌ GOOGLE_TRANSLATE_API_KEY environment variable is not set')
  process.exit(1)
}
```

with:

```ts
const RAW_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY

if (!RAW_API_KEY) {
  console.error('❌ GOOGLE_TRANSLATE_API_KEY environment variable is not set')
  process.exit(1)
}

// process.exit() returns never, so RAW_API_KEY is narrowed to string here.
const API_KEY: string = RAW_API_KEY
```

Leave line 91's `'X-Goog-Api-Key': API_KEY,` unchanged. If TypeScript still
reports the TS2769 after this, fall back to `'X-Goog-Api-Key': API_KEY!,` and
say so in your report — but try the narrowing first, it is the cleaner fix.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx tsc --noEmit -p tsconfig.test.json && echo "TEST_PROJECT_CLEAN"
npx vitest run 2>&1 | tail -6
```

→ prints `TEST_PROJECT_CLEAN` with no error output, then a passing run whose
`Test Files` and `Tests` counts are **identical to `FE_TESTFILES_BEFORE` and
`FE_TESTS_BEFORE`** from the baseline capture. You changed fixtures, not
assertions, so any movement in either direction is a STOP condition.

Two named assertions that must specifically still pass (they are the ones whose
fixtures you edited):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run __tests__/analytics-charts-tokens.test.tsx -t "ConceptEffectivenessChart renders with data"
npx vitest run __tests__/session-list-item-stale-closure.test.tsx
```

→ both exit 0 with no failures.

Commit: `fix: bring the frontend test files and build scripts under a tsconfig`

### Step 6: Wire the test project in and defend the gate on both halves

**6a.** `frontend/tsconfig.json` — add the third reference. The whole file
becomes:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.test.json" }
  ]
}
```

Add nothing else to this file — no `compilerOptions`, no `baseUrl`, no `paths`.
`CLAUDE.md` records that duplicating `baseUrl` here causes a TS5101 deprecation
error with no clean fix on TS 5.x.

**6b.** `.github/workflows/ci.yml` — extend the non-vacuity assertion added in
Step 1 to guard the test project too. Replace the body of the
`Assert the typecheck is not vacuous` step with:

```yaml
        run: |
          set -euo pipefail
          src=$(grep -c '/frontend/src/' /tmp/tsc-listfiles.txt || true)
          tests=$(grep -c '/frontend/__tests__/' /tmp/tsc-listfiles.txt || true)
          echo "typechecked $src files under frontend/src/, $tests under frontend/__tests__/"
          if [ "$src" -lt 150 ]; then
            echo "::error::TypeScript project graph collapsed: only $src files under src/ were typechecked (expected >= 150)."
            exit 1
          fi
          if [ "$tests" -lt 50 ]; then
            echo "::error::TypeScript project graph collapsed: only $tests files under __tests__/ were typechecked (expected >= 50). Check that tsconfig.test.json is still referenced from tsconfig.json."
            exit 1
          fi
```

**6c.** Add an identity assertion on the `references` array itself, as a
separate CI step immediately after the one above. A file **count** cannot tell
you *which* project contributed the files: measured on 2026-08-28, the test
project alone reaches 122 files under `frontend/src/`, so the `>= 150` floor
survives the loss of the app reference today by a margin of only 28 files. The
`references` list is the thing that must not drift, so assert on it directly:

```yaml
      - name: Assert the tsconfig project graph is intact
        working-directory: frontend
        run: |
          set -euo pipefail
          node -e '
            const fs = require("fs");
            const raw = fs.readFileSync("tsconfig.json", "utf8").replace(/^\s*\/\/.*$/gm, "");
            const cfg = JSON.parse(raw);
            const want = ["./tsconfig.app.json", "./tsconfig.node.json", "./tsconfig.test.json"];
            const got = (cfg.references || []).map(r => r.path).sort();
            const missing = want.filter(p => !got.includes(p));
            if (missing.length) {
              console.error("::error::tsconfig.json is missing project reference(s): " + missing.join(", "));
              process.exit(1);
            }
            if (cfg.compilerOptions) {
              console.error("::error::tsconfig.json must stay references-only; compilerOptions here causes TS5101.");
              process.exit(1);
            }
            console.log("tsconfig references OK: " + got.join(", "));
          '
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make typecheck && echo "TYPECHECK_OK"
cd frontend
npx tsc -b --noEmit --force --listFiles > /tmp/verify-listfiles.txt
echo "src=$(grep -c '/frontend/src/' /tmp/verify-listfiles.txt) tests=$(grep -c '/frontend/__tests__/' /tmp/verify-listfiles.txt)"
node -e 'const c=JSON.parse(require("fs").readFileSync("tsconfig.json","utf8"));const g=(c.references||[]).map(r=>r.path).sort();console.log(JSON.stringify(g));if(g.length!==3||c.compilerOptions)process.exit(1)' && echo "REFS_OK"
npm run build:cloudflare && echo "BUILD_OK"
cd ..
git diff --exit-code -- frontend/src/tokens/tokens.css frontend/src/tokens/tokens.ts && echo "TOKENS_CLEAN"
python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML_OK"
```

→ `TYPECHECK_OK`; the counts line shows `src=` equal to `FE_SRC_BEFORE` and
`tests` at least equal to `FE_TESTFILES_BEFORE`; then the three reference paths
and `REFS_OK`; then `BUILD_OK` (this proves `npm run build`'s own `tsc -b`
still passes with three references, which is what the deploy workflow runs);
then `TOKENS_CLEAN`; then `YAML_OK`.

Negative check on the new assertion — it must be able to fail. Temporarily
delete the `./tsconfig.test.json` entry from `tsconfig.json`, re-run the `node
-e` line, confirm it exits non-zero, then restore. Do not commit the deletion.

Commit: `ci: reference the test tsconfig so 55 test files are type-checked`

### Step 7: Confirm the whole suite, exactly as CI will run it

Run every gate end to end, in the order CI runs them, and compare against the
baselines in "Commands you will need".

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"

# frontend job, in CI order
cd frontend
npx tsc -b --noEmit --force --listFiles | grep -c '/frontend/src/'   # == FE_SRC_BEFORE
npm run lint                                                          # 0 errors
npm run build:cloudflare                                              # exit 0
cd ..
git diff --exit-code -- frontend/src/tokens/tokens.css frontend/src/tokens/tokens.ts
cd frontend
npx vitest run --coverage 2>&1 | tail -8   # == FE_TESTS_BEFORE, thresholds met
cd ..

# worker job
cd workers && npx vitest run 2>&1 | tail -4; cd ..   # == WK_TESTS_BEFORE

# python job
make test-py 2>&1 | tail -6   # == PY_PASSED_BEFORE / PY_SKIPPED_BEFORE, 3 named failures
make lint                     # ruff clean + eslint 0 errors

# nothing outside scope touched
git status --short --branch
```

Every count above is compared against the value you wrote down in the baseline
capture, not against a number printed in this document. The only deviation
allowed anywhere is: none. This plan changes gates, not behaviour.

`git status --short` must list only files from the In-scope list plus whatever
was already dirty when you ran the drift check. Nothing under
`immi_case_downloader/static/react/` and nothing under `frontend/src/tokens/`.

**Before committing**, per this repo's `CLAUDE.md` GitNexus rules, run
`detect_changes()` and confirm the affected symbol set is limited to the test
fixtures you edited and `frontend/scripts/translate-locales.ts`. If the index
is stale (it lagged `HEAD` on 2026-08-28), either refresh it with
`node .gitnexus/run.cjs analyze` from the repo root or record the check as
**unverified** in your handoff — do not silently skip it.

## Test plan

This plan writes **no new tests**. It makes the existing frontend, worker and
Python suites actually gate merges, and it brings the previously-unchecked
frontend test files under a type-checker.

- **Existing tests as the regression net**: the frontend suite must stay at
  exactly `FE_TESTS_BEFORE` passing across `FE_TESTFILES_BEFORE` files
  throughout — the numbers you recorded in the baseline capture, not numbers
  copied from this document. The only edits to test files are fixture-shape
  corrections (adding or renaming fields the source type already requires) and
  deleting unused imports. Neither changes any assertion. If either count moves
  in either direction, you have changed behaviour — STOP.
- **Structural pattern to follow for fixture edits**:
  `frontend/__tests__/session-list-item-stale-closure.test.tsx:30-39` shows the
  house style for a typed fixture factory — an explicit return type annotation
  (`): LlmCouncilSessionListItem {`) with a plain object literal. Keep that
  shape; the fix is adding fields inside the literal, never loosening the
  annotation or reaching for `as any` / `as unknown as`.
- **Negative test of the coverage gate** (Step 4, not committed): raise
  `thresholds.lines` to `100`, confirm `npx vitest run --coverage` fails with a
  threshold error, restore the measured value, confirm it passes. This proves
  the gate is live rather than decorative — which was the entire defect.
- **Negative test of the non-vacuity assertion** (required, not committed):
  temporarily empty the `references` array in `frontend/tsconfig.json`, run the
  Step 1 assertion body locally, and confirm it exits 1 with the
  `project graph collapsed` message. Restore immediately.
- **Negative test of the reference-identity assertion** (required, not
  committed): delete only the `./tsconfig.test.json` entry, run the Step 6c
  `node -e` body, confirm it exits 1 naming the missing reference. Restore
  immediately. This one matters because the count-based floor alone would
  **not** catch that specific deletion for the `__tests__` half if the floor
  were ever loosened.
- **Verification**: `cd frontend && npx vitest run --coverage` → exactly
  `FE_TESTS_BEFORE` passing across `FE_TESTFILES_BEFORE` files, no threshold
  error, exit 0.

## Done criteria

Machine-checkable. ALL must hold. Every count is a **comparison against the
baseline you captured**, never a literal copied from this file — a literal
would rot the moment `plans/002` or any sibling plan lands, and would tempt the
next executor to edit the yardstick instead of the code.

- [ ] `cd frontend && npx tsc --noEmit --listFiles | wc -l` still returns `0` —
      and **no command in `Makefile` or `.github/workflows/ci.yml` uses that
      form**: `grep -rn 'tsc --noEmit' Makefile .github/workflows/ci.yml`
      returns no matches.
- [ ] `make typecheck` exits 0.
- [ ] `cd frontend && npx tsc -b --noEmit --force --listFiles | grep -c '/frontend/src/'`
      returns exactly `FE_SRC_BEFORE` (unchanged: this plan touches no `src` file).
- [ ] `cd frontend && npx tsc -b --noEmit --force --listFiles | grep -c '/frontend/__tests__/'`
      returns at least `FE_TESTFILES_BEFORE` minus the one colocated file
      (`FE_TESTFILES_BEFORE` counts only `frontend/__tests__` at this point in
      the chain, so the two are equal here).
- [ ] `cd frontend && npx tsc --noEmit -p tsconfig.test.json` exits 0 with no output.
- [ ] `frontend/tsconfig.json` contains exactly three entries in `references`,
      including `{ "path": "./tsconfig.test.json" }`, and still has
      `"files": []` and no `compilerOptions` key — checked with the Step 6c
      `node -e` one-liner, which exits non-zero on any of those three failures.
- [ ] `make lint` exits 0; `make lint-py` and `make lint-fe` both exist and
      exit 0 independently.
- [ ] `cd frontend && npx eslint . -f json` reports `0` total errors across a
      non-zero number of linted files (242 on 2026-08-28).
- [ ] CI actually runs ESLint, the build and coverage — asserted structurally,
      not by grep, since a grep also matches a comment:
      ```bash
      python3 - <<'PY'
      import yaml
      j = yaml.safe_load(open('.github/workflows/ci.yml'))['jobs']['test-frontend']['steps']
      runs = " ".join(s.get('run','') for s in j)
      assert 'npm run lint' in runs, 'no eslint step'
      assert 'build:cloudflare' in runs, 'no build step'
      assert 'vitest run --coverage' in runs, 'coverage not enforced'
      assert 'frontend/src/tokens/tokens.css' in runs, 'no stale-token assertion'
      print('CI_FRONTEND_SHAPE_OK')
      PY
      ```
- [ ] `cd frontend && npm run build:cloudflare` exits 0, and
      `git diff --exit-code -- frontend/src/tokens/tokens.css frontend/src/tokens/tokens.ts`
      exits 0 afterwards.
- [ ] `cd frontend && npx vitest run --coverage` exits 0, reports exactly
      `FE_TESTS_BEFORE` passing across `FE_TESTFILES_BEFORE` files, and prints
      no `does not meet threshold` line.
- [ ] `frontend/vitest.config.ts` has no `lines:` / `functions:` / `branches:` /
      `statements:` key directly under `coverage` (they are nested under
      `thresholds`) **and** has `include: ["src/**/*.{ts,tsx}"]` — checked with
      the Step 4g `python3` shape check, which fails on either.
- [ ] The coverage report's file set equals the on-disk `src` set minus the
      declared excludes (the Step 4c `COVERAGE_UNIVERSE_OK` check), and
      `grep -c '__tests__' coverage/coverage-summary.json` returns `0`.
- [ ] `python3 -c "import json;print(json.load(open('frontend/package.json'))['devDependencies']['@vitest/coverage-v8'])"`
      prints `4.0.18` exactly (no `^`, no `~`).
- [ ] The parsed `packages["node_modules/vitest"].version` in
      `frontend/package-lock.json` is byte-identical before and after Step 4a.
- [ ] `cd workers && npx vitest run` reports exactly `WK_TESTS_BEFORE` passing.
- [ ] `make test-py` reports exactly `PY_PASSED_BEFORE` passed and
      `PY_SKIPPED_BEFORE` skipped, and the failures are **still exactly the
      three named `tests/test_backfill_judge_overrides_from_pdf.py` pyexpat
      ImportErrors listed in "Commands you will need"** — assert on the names,
      not on the number.
- [ ] `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"` exits 0.
- [ ] `git status --short --branch` lists no file outside the In-scope list,
      other than paths that were already dirty at the drift check.
- [ ] Nothing under `immi_case_downloader/static/react/` and nothing under
      `frontend/src/tokens/` is modified.
- [ ] Nothing was pushed and no PR was opened.

## STOP conditions

Stop and report back — do not improvise — if any of these occur.

1. **Any in-scope path appears in any of the three drift diffs, or as an
   untracked `??` entry**, and the "Current state" excerpts no longer match the
   live files. Line numbers in this plan were read at `42826a3`; a mismatch
   means the codebase moved under you. Report it — never `git checkout --`,
   `git restore`, `git stash` or `git clean` a path you did not create.
2. **`npx tsc -b --noEmit` does not exit 0 at the start of Step 1.** The entire
   premise of this plan is that the latent-error backlog is empty today
   (verified at `42826a3`). If it is not, someone merged a type error behind
   the vacuous gate and the size of the cleanup must be re-scoped before you
   switch the gate on. Report the error count and the files.
3. **`npm run build:cloudflare` produces a diff under `frontend/src/tokens/`.**
   That means the committed generated files (`tokens.css`, `tokens.ts`) are out
   of sync with `tokens.json`. Report it; do not commit the regeneration —
   regenerated design tokens are a design-system change, and this repo's
   "Legal Codex" direction (warm off-white `#f5f4f1`, deep navy `#1b2838`,
   amber `#d4a017`, Crimson Text serif headings, 9 court-specific colour codes)
   is a decided, owned artifact, not a build by-product.
4. **The Vitest test-file or test count moves off `FE_TESTFILES_BEFORE` /
   `FE_TESTS_BEFORE`**, in either direction, at any point. You are only
   supposed to be adding or renaming fields in fixtures and deleting unused
   imports.
5. **`npx tsc --noEmit -p tsconfig.test.json` reports errors at a file:line
   that is neither on the enumerated list nor
   `analytics-charts-tokens.test.tsx:149`**, or reports substantially more than
   19 on the first run of Step 5b. The enumerated backlog was measured directly;
   a much larger number means your `tsconfig.test.json` differs from the one
   specified (most likely `include` is wrong, or you included
   `frontend/e2e/**`). Note that a *slightly* larger number as you fix things is
   expected and is not a STOP — see "This list is NOT closed".
6. **Step 4a's `diff /tmp/vitest-version-before.txt /tmp/vitest-version-after.txt`
   is not empty** — i.e. installing the coverage provider moved `vitest` itself
   in `frontend/package-lock.json`. The exact pin exists precisely to avoid
   that; a bump puts the whole suite on an untested runner version. Do not
   substitute `git diff frontend/package-lock.json | grep '"vitest"'` for this
   check: that grep matches the new provider's own `peerDependencies` block and
   so fires whether or not `vitest` moved.
7. **Any measured coverage metric is so low that a floor threshold looks
   meaningless** (below ~30%). Report the four numbers and ask whether to gate
   at the floor or to drop the threshold block entirely, rather than encoding a
   number nobody would defend.
8. **A fix appears to require editing a file outside the In-scope list** —
   in particular `frontend/src/**`, `frontend/tsconfig.app.json`,
   `frontend/tsconfig.node.json`, `frontend/eslint.config.js`, `pytest.ini`,
   or `CLAUDE.md`. If a fixture error can only be resolved by changing a source
   type, that is a real API question, not a test fix. Report it.
9. **Any step's verification fails twice** after one reasonable fix attempt.
10. **`make test-py` deviates from `PY_PASSED_BEFORE` / `PY_SKIPPED_BEFORE`, or
   the failing tests are not exactly the three named
   `tests/test_backfill_judge_overrides_from_pdf.py` pyexpat ImportErrors.**
   Those three are the known Homebrew `pyexpat`/`pypdf` ABI problem; anything
   else means something in this plan reached the Python side, which it should
   not have.
11. **The Step 4c `COVERAGE_UNIVERSE_OK` check prints `MISMATCH`.** The
   thresholds would then be measuring an unknown set of files. Report the two
   file lists; do not adjust the threshold to make the run pass.

## Maintenance notes

For whoever owns this next.

**What a reviewer should scrutinise in the PR**

- That `frontend/tsconfig.json` gained *only* a `references` entry. Any
  `compilerOptions` there is a TS5101 landmine.
- That the coverage `thresholds` numbers are the measured floor, not a
  copy-paste of `80`, **and that `coverage.include` is present**. Without
  `include`, Vitest 4 counts only files some test imported, so a threshold
  measured that way can never be violated by an untested module. Ask what was
  measured and on what universe; the commit message should say.
- That the non-vacuity assertion is present in `ci.yml`, that its two floors
  are below the real counts but far above zero, **and that the separate
  `references`-identity assertion (Step 6c) is there too**. The count floor
  alone has only a 28-file margin (the test project reaches 122 `src` files on
  its own), so the identity check is what actually pins the project graph.
- That no `--max-warnings 0` sneaked into the ESLint step. The 25 warnings are
  pre-existing and out of scope; gating on them would make a free change
  expensive.

**Deliberately deferred out of this plan**

- **`frontend/e2e/**` (12 `.ts` files) is still type-checked by nothing.**
  Bringing it in needs `@playwright/test` types and would surface an unmeasured
  error count. Do it as its own change: add a fourth project
  (`tsconfig.e2e.json`, `include: ["e2e", "playwright.config.ts"]`,
  `types: ["node", "@playwright/test"]`), reference it, clear what it finds,
  and extend the CI assertion with an `/frontend/e2e/` floor.
- **The 25 ESLint warnings in `frontend/src/**`.** Three are auto-fixable
  unused `eslint-disable` directives (in `StreamingCouncilView.tsx:388`,
  `ChartTooltip.tsx:43`, `use-bookmarks.ts:154`) and the rest are mostly
  `no-console`. Clear them, then tighten the CI step to
  `npm run lint -- --max-warnings 0` in the same commit so the count cannot
  creep back.
- **`pytest.ini:3` sets `--cov` with no `--cov-fail-under`,** so Python
  coverage is measured and then ignored, and `--cov=immi_case_downloader` does
  not cover the top-level scripts. Same defect class as the frontend one this
  plan fixes, but on the Python side and outside this plan's file territory.
- **Docs go stale the moment this lands, and the fix has named owners.** Do not
  leave this as a floating note:
  - `plans/042-rewrite-the-agent-facing-docs.md` owns `CLAUDE.md`, `AGENTS.md`
    and the `make help` correspondence. Hand it: (a) `CLAUDE.md:32` documents
    `cd frontend && npx vitest run src/__tests__/components/judges/`, a path
    that does not exist — there is no `frontend/src/__tests__` directory before
    `plans/002` and the historical suite lives in `frontend/__tests__`, so an
    agent following that line runs Vitest against nothing; it should become
    `npx vitest run __tests__/`; (b) `make lint` is no longer Python-only after
    Step 3 and the one-line description must change; (c) `make typecheck` is
    now `tsc -b --noEmit`, not `tsc --noEmit`.
  - `plans/043-correct-the-readme.md` owns `README.md`, including the frontend
    test counts, which this plan holds constant but `plans/002` changes.
  Both are documentation-only plans and must run **after** 001→002→003, since
  the numbers and command names they reconcile are set by that chain. Say so in
  your handoff; do not edit either file from this plan.
- **`@eslint/js` is `^9.39.1` while `eslint` is `^10.0.0`.** Investigated and
  deliberately not changed — see "Findings reconsidered".
- **`eslint.config.js:19` sets `ecmaVersion: 2020`** while
  `tsconfig.app.json:6` sets `lib: ["ES2023"]` and the repo mandates ES2023
  `.toSorted()`. Latent only: `typescript-eslint` supplies its own parser and
  `.toSorted()` is a method call, not syntax, so nothing misparses today. Worth
  aligning to `2023` + `globals.es2023` alongside the `@eslint/js` bump if that
  is ever done.

**A green CI is not a clean dependency audit — this plan does not claim it is**

Switching these gates on makes `.github/workflows/ci.yml` green on a frontend
whose `package-lock.json` still carries npm advisories (17 at the time
`plans/035` was written, of which 2 are critical; 8 of them reachable from
production dependencies). Nothing in this plan detects or reports that, and
adding an `npm audit` gate here would either fail the build on day one or
require an unreviewed `npm audit fix`, both of which are out of scope.

The owner is **`plans/035-fix-frontend-dependency-advisories.md`**, which
regenerates the lockfile deliberately. It is an independent plan and may run
before or after this chain; if it runs after, expect it to move
`frontend/package-lock.json`, which is in this plan's In-scope list, so the two
must not run concurrently. State in your handoff that CI going green here says
nothing about the advisory backlog and points at 035.

**What will interact with this later**

- Any future change to `frontend/tsconfig*.json` must keep the CI assertion's
  floors honest. If the app legitimately shrinks below 150 source files, raise
  or lower the floor **deliberately and in the same commit** — never delete the
  assertion, and never delete the Step 6c `references`-identity check, which is
  the half that does not depend on file counts at all.
- If `vitest` is upgraded past `4.0.18`, `@vitest/coverage-v8` must move in
  lockstep: it declares an exact peer pin on the vitest version.
- If a new `frontend/scripts/*.ts` file is added, it is now type-checked
  automatically (`tsconfig.test.json` includes `scripts`). That is intended.
- The coverage thresholds are a ratchet. When coverage rises, raise them.
  Lowering them to make a red build green defeats the point and should be
  rejected in review.

## Findings reconsidered

Two items from the audit that fed this plan did not survive verification as
stated, and one was corrected. Recorded here so nobody re-audits them.

- **`@eslint/js` on 9.x while `eslint` is on 10.x is not a defect.** Verified:
  `frontend/package.json:49` is `"@eslint/js": "^9.39.1"` alongside
  `"eslint": "^10.0.0"` (line 60), and `frontend/eslint.config.js:13` does
  consume `js.configs.recommended`. But `@eslint/js` declares **no**
  `peerDependencies` at all, `js.configs.recommended` is a plain rules object
  with no version coupling to the ESLint core, and `npx eslint .` run read-only
  at `42826a3` completes cleanly: `✖ 25 problems (0 errors, 25 warnings)`.
  There is no conflict and no observable behavioural gap — only a forgone
  opt-in to ESLint 10's updated recommended rule set. Bumping it could
  introduce new errors and break the lint gate this plan is switching on, for
  no demonstrated benefit. The *real* half of that finding — that
  `npm run lint` runs in no CI job — **is** fixed, in Step 3. The version bump
  is left as an optional follow-up in "Maintenance notes".

- **The Python half of the coverage finding is out of this plan's file
  territory.** `pytest.ini:3` sets `--cov` with no `--cov-fail-under`, and
  `grep -rn 'fail_under\|fail-under\|cov-fail' pytest.ini Makefile .github/workflows/`
  returns nothing — the gap is real and confirmed. But `pytest.ini` belongs to
  the Python test surface, not the frontend compile gate, and editing it here
  would collide with a Python-testing plan running in parallel. Carried
  forward explicitly in "Maintenance notes" rather than silently dropped.

- **Corrected: the coverage-`exclude` mechanism.** The audit suspected that the
  leading `./` in `"./__tests__/"` (`frontend/vitest.config.ts:16`) fails to
  match, and the verifier's alternative hypothesis was that supplying
  `coverage.exclude` at all replaces Vitest's defaults and so lets test files
  be counted. **Neither is the defect, and the second is wrong for Vitest 4**:
  importing `coverageConfigDefaults` from `vitest/config` in
  `frontend/node_modules` shows `exclude: []` — the default is already empty,
  so nothing is being clobbered. The actual, provable defect is the threshold
  *shape*: `lines`/`functions`/`branches`/`statements` sit directly under
  `coverage` where Vitest 4 requires them under `coverage.thresholds`, which
  TypeScript reports as
  `Object literal may only specify known properties, and 'lines' does not exist in type '{ provider: "v8"; } & CoverageV8Options'`.
  Step 4 fixes that and leaves `exclude` untouched.

- **Corrected line numbers.** Three citations in the audit pointed at lines
  that do not exist; the corrected ones were read directly at `42826a3` and are
  what this plan uses:
  `frontend/tsconfig.app.json:28` (not `:36`) for `"include": ["src"]` — the
  file is 29 lines long; `frontend/tsconfig.node.json:25` (not `:29`) for
  `"include": ["vite.config.ts"]` — the file is 26 lines long; and
  `frontend/package.json:13` (not `:18`) for `"lint": "eslint ."`. The three
  load-bearing citations (`frontend/tsconfig.json:2`, `Makefile:96`,
  `.github/workflows/ci.yml:64`) were all exact.

- **Corrected: `coverage.exclude` *is* part of the defect after all — but not
  for the reason first proposed.** The bullet above remains true (the leading
  `./` is not the bug, and `coverageConfigDefaults.exclude` really is `[]`), but
  a second, larger defect was found on 2026-08-28 and is now fixed in Step 4b:
  `coverageConfigDefaults.include` is `undefined`, and the installed Vitest
  4.0.18 documents `include` as *"By default only files covered by tests are
  included."* So the whole coverage universe was "files some test already
  imported", and a threshold measured on it could never be violated by an
  untested module. Step 4b now sets `include: ["src/**/*.{ts,tsx}"]` and
  rewrites `exclude` to cover both test roots, and Step 4c proves the resulting
  universe matches the on-disk file set.

## Review points not applied

One reviewer point did not survive verification and is deliberately **not**
applied. Recorded here so it is not re-raised.

- **"Even with the `tsconfig.app.json` reference removed, `tsconfig.test.json`
  could still pull in more than 150 `src` files through test imports, so the
  `src >= 150` floor is not a reliable non-vacuity gate." — measured false.**
  On 2026-08-28 the test project was built in isolation (a copy of the Step 5a
  config placed outside the repo, extending
  `frontend/tsconfig.app.json` and including only `frontend/__tests__`,
  `vitest.config.ts`, `playwright.config.ts` and `frontend/scripts`) and run as
  `npx tsc --noEmit --listFiles -p <that config> | grep -c '/frontend/src/'`.
  Result: **122**, against `169` for the full `tsc -b` graph
  (`npx tsc -b --noEmit --force --listFiles | grep -c '/frontend/src/'`). 122 is
  below the `150` floor, so deleting the app reference **does** fail the
  assertion as written. The floor is not vacuous today.

  The reviewer's *remedy* was nevertheless adopted, on the strength of that same
  measurement rather than the claim: a 28-file margin is thin, and a count can
  never say *which* project supplied the files. Step 6c therefore adds an
  assertion on the identity of the `references` array, which is immune to file
  counts entirely. What was rejected is the premise that the existing floor
  fails to discriminate — it does discriminate, and the plan says so with the
  number.
