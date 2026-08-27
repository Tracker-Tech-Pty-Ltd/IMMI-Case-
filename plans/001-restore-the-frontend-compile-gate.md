# Plan 001: Make CI actually type-check and build the frontend

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index, or the file does not exist (in which case skip it).
>
> **Drift check (run first)**:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> git diff --stat 42826a3..HEAD -- \
>   .github/workflows/ci.yml \
>   Makefile \
>   frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json \
>   frontend/vitest.config.ts frontend/eslint.config.js \
>   frontend/package.json frontend/package-lock.json \
>   frontend/__tests__ frontend/scripts
> ```
>
> Expected: **empty output** (no in-scope file has changed since this plan was
> written). If any file is listed, compare the "Current state" excerpts below
> against the live code before proceeding; on a mismatch, treat it as a STOP
> condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
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

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend install | `cd frontend && npm ci` | exit 0 |
| Typecheck (correct form) | `cd frontend && npx tsc -b --noEmit` | exit 0, no output |
| Typecheck non-vacuity probe | `cd frontend && npx tsc -b --noEmit --force --listFiles \| grep -c '/frontend/src/'` | `169` |
| Test-project typecheck | `cd frontend && npx tsc --noEmit -p tsconfig.test.json` | exit 0 after Step 5 |
| Frontend lint | `cd frontend && npm run lint` | `✖ 25 problems (0 errors, 25 warnings)`, exit 0 |
| Frontend unit tests | `cd frontend && npx vitest run` | `490 passed`, 55 files, exit 0 |
| Frontend coverage | `cd frontend && npx vitest run --coverage` | `490 passed` + a coverage table, exit 0 |
| Production build | `cd frontend && npm run build:cloudflare` | exit 0, writes gitignored `frontend/dist/` |
| Worker tests | `cd workers && npx vitest run` | `345 passed`, 25 files |
| Python tests | `make test-py` | `1141 passed, 3 failed, 7 skipped` — see note below |
| Python lint | `make lint-py` (after Step 3) | `All checks passed!` |
| Makefile typecheck | `make typecheck` | exit 0 |
| Makefile lint (after Step 3) | `make lint` | ruff `All checks passed!` **and** eslint 0 errors |
| YAML sanity | `python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/ci.yml'))"` | exit 0, no output |

**Python test note — do not chase these**: `make test-py` reports
**3 pre-existing failures** in `tests/test_backfill_judge_overrides_from_pdf.py`.
They are environmental: Homebrew Python 3.14.7 has a `pyexpat`/`libexpat` ABI
mismatch that breaks the `pypdf` import. They are not caused by repo code and
are not this plan's problem. The baseline is `1141 passed, 3 failed, 7 skipped`
and must be unchanged when you finish.

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

Note: `.claude/STATE.md` is already modified in the working tree at `42826a3`.
That is pre-existing and not yours — leave it alone and do not stage it.

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
nothing will say so. `150` is a floor, not a target — today the count is 169.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make typecheck && echo "TYPECHECK_OK"
python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML_OK"
cd frontend && npx tsc -b --noEmit --force --listFiles | grep -c '/frontend/src/'
```

→ prints `TYPECHECK_OK`, then `YAML_OK`, then `169`.

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
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npm run build:cloudflare && echo "BUILD_OK"
cd .. && git status --short
```

→ prints `BUILD_OK`; `git status --short` shows only ` M .claude/STATE.md`,
your own in-scope edits, and `?? plans/`. It must **not** list anything under
`frontend/src/tokens/` — `npm run build:cloudflare` runs `npm run tokens`,
which rewrites the tracked files `frontend/src/tokens/tokens.css` and
`frontend/src/tokens/tokens.ts` in place. Those are generated from the
committed `tokens.json`, so a clean regeneration produces no diff. If a diff
appears there, that is a STOP condition (the committed generated files are
stale) — report it, do not commit the regeneration.

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
`make lint-fe` prints `✖ 25 problems (0 errors, 25 warnings)` and
`lint-fe exit=0`; `make lint` runs both and prints `LINT_ALL_OK`;
then `YAML_OK`.

Commit: `ci: run ESLint on the frontend in CI and make lint`

### Step 4: Make the Vitest coverage thresholds real

Three things are wrong at once: the coverage provider is not installed, the
thresholds are in a shape Vitest 4 does not recognise, and no automation ever
passes `--coverage`.

**4a.** Install the provider, pinned to the exact installed Vitest version.
`@vitest/coverage-v8@4.0.18` declares `peerDependencies: { vitest: '4.0.18' }`
— an exact pin — and `frontend/node_modules/vitest` is `4.0.18`. Use the exact
version, **not** a caret range: `^4.0.18` resolves to 4.1.x and would drag
`vitest` itself forward across 490 tests.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npm install --save-dev --save-exact @vitest/coverage-v8@4.0.18
```

**4b.** Measure the real coverage before choosing any number:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run --coverage
```

Record the four percentages from the `All files` row of the printed table:
`% Stmts`, `% Branch`, `% Funcs`, `% Lines`.

**4c.** `frontend/vitest.config.ts` — replace lines 13-21:

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

with the nested form Vitest 4 actually reads:

```ts
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "./__tests__/", "**/*.config.*", "**/*.d.ts"],
      // Vitest 4 only reads thresholds nested under `thresholds`. The four
      // flat `80`s that used to live here were not recognised options and
      // never gated anything. These numbers are a RATCHET pinned to the
      // coverage measured on 2026-08-27 — raise them, never lower them.
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

Leave the `exclude` array exactly as-is. It is not the defect: in Vitest 4
`coverageConfigDefaults.exclude` is `[]` (verified by importing
`coverageConfigDefaults` from `vitest/config`), so supplying an `exclude` list
does not clobber any default.

**4d.** `.github/workflows/ci.yml` — change the Vitest step from:

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

**4e.** `Makefile` — add a target after `test-workers` (after line 71) so the
CI command is reproducible locally:

```make
coverage-fe:
	cd "$(REPO_ROOT)/frontend" && npx vitest run --coverage
```

Leave `test-fe` as the fast, no-coverage local loop. `.PHONY` already lists
`coverage-fe` from Step 3c.

**4f.** `Makefile:32` — add a help line next to the existing `make coverage`
entry:

```make
	@echo "  make coverage-fe  Frontend Vitest with coverage thresholds"
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make coverage-fe && echo "COVERAGE_OK"
grep -n 'thresholds' frontend/vitest.config.ts
grep -n '"@vitest/coverage-v8"' frontend/package.json
python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML_OK"
```

→ `make coverage-fe` prints `490 passed`, a coverage table, **no**
`ERROR: Coverage for ... does not meet threshold` line, then `COVERAGE_OK`;
`grep thresholds` shows the nested block; `grep @vitest/coverage-v8` shows
`"@vitest/coverage-v8": "4.0.18"` (exact, no caret); then `YAML_OK`.

Sanity check that the gate is live rather than decorative: temporarily raise
`lines` to `100`, re-run `npx vitest run --coverage`, confirm it **fails** with
a threshold error, then restore your measured value and confirm it passes
again. Do not commit the `100`.

Commit: `test: enforce Vitest coverage thresholds instead of declaring them`

### Step 5: Create the test tsconfig and clear the 20 errors it surfaces

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
npx tsc --noEmit -p tsconfig.test.json 2>&1 | grep -c 'error TS'
```

→ Expect **19** (20 minus the `vitest.config.ts` TS2769, which Step 4 already
fixed). If you instead see four errors reading
`error TS2688: Cannot find type definition file for ...`, the file is not at
`frontend/tsconfig.test.json` — move it there and re-run.

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

**5d.** Fix the eleven fixture-shape errors. Each is a test fixture that has
drifted behind its source type. Add the missing fields; do not weaken the
source types and do not add `as any`.

- `frontend/__tests__/analytics-charts-tokens.test.tsx:145-147` — each of the
  three `concepts` entries needs `by_court`, per
  `frontend/src/types/case.ts:295` (`by_court: Record<string, { total: number; win_rate: number }>`).
  Add `by_court: {},` to each object.
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
npx vitest run
```

→ prints `TEST_PROJECT_CLEAN` with no error output, then `490 passed`
across 55 files. **The test count must still be 490** — you changed fixtures,
not assertions.

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

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make typecheck && echo "TYPECHECK_OK"
cd frontend
npx tsc -b --noEmit --force --listFiles > /tmp/verify-listfiles.txt
echo "src=$(grep -c '/frontend/src/' /tmp/verify-listfiles.txt) tests=$(grep -c '/frontend/__tests__/' /tmp/verify-listfiles.txt)"
npm run build:cloudflare && echo "BUILD_OK"
cd .. && python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML_OK"
```

→ `TYPECHECK_OK`; the counts line shows `src=169` and `tests` at least `55`;
then `BUILD_OK` (this proves `npm run build`'s own `tsc -b` still passes with
three references, which is what the deploy workflow runs); then `YAML_OK`.

Commit: `ci: reference the test tsconfig so 55 test files are type-checked`

### Step 7: Confirm the whole suite, exactly as CI will run it

Run every gate end to end, in the order CI runs them, and compare against the
baselines in "Commands you will need".

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"

# frontend job, in CI order
cd frontend
npx tsc -b --noEmit --force --listFiles | grep -c '/frontend/src/'   # 169
npm run lint                                                          # 0 errors
npm run build:cloudflare                                              # exit 0
npx vitest run --coverage                                             # 490 passed, thresholds met
cd ..

# worker job
cd workers && npx vitest run; cd ..                                   # 345 passed, 25 files

# python job
make test-py                                                          # 1141 passed, 3 failed, 7 skipped
make lint                                                             # ruff clean + eslint 0 errors

# nothing outside scope touched
git status --short
```

`git status --short` must list only `.claude/STATE.md` (pre-existing),
`plans/` (untracked), and files from the In-scope list. Nothing under
`immi_case_downloader/static/react/` and nothing under `frontend/src/tokens/`.

## Test plan

This plan writes **no new tests**. It makes the existing 490 frontend tests,
345 worker tests and 1141 Python tests actually gate merges, and it brings
the 55 previously-unchecked frontend test files under a type-checker.

- **Existing tests as the regression net**: `frontend/__tests__` (55 files,
  490 tests) must stay at exactly 490 passing throughout. The only edits to
  test files are fixture-shape corrections (adding fields the source type
  already requires) and deleting unused imports. Neither changes any assertion.
  If the count moves off 490 in either direction, you have changed behaviour —
  STOP.
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
- **Negative test of the non-vacuity assertion** (optional, not committed):
  temporarily empty the `references` array in `frontend/tsconfig.json`, run the
  Step 1 assertion body locally, and confirm it exits 1 with the
  `project graph collapsed` message. Restore immediately.
- **Verification**: `cd frontend && npx vitest run --coverage` → `490 passed`,
  55 files, no threshold error, exit 0.

## Done criteria

Machine-checkable. ALL must hold.

- [ ] `cd frontend && npx tsc --noEmit --listFiles | wc -l` still returns `0` —
      and **no command in `Makefile` or `.github/workflows/ci.yml` uses that
      form**: `grep -rn 'tsc --noEmit' Makefile .github/workflows/ci.yml`
      returns no matches.
- [ ] `make typecheck` exits 0.
- [ ] `cd frontend && npx tsc -b --noEmit --force --listFiles | grep -c '/frontend/src/'` returns `169`.
- [ ] `cd frontend && npx tsc -b --noEmit --force --listFiles | grep -c '/frontend/__tests__/'` returns at least `55`.
- [ ] `cd frontend && npx tsc --noEmit -p tsconfig.test.json` exits 0 with no output.
- [ ] `frontend/tsconfig.json` contains exactly three entries in `references`,
      including `{ "path": "./tsconfig.test.json" }`, and still has
      `"files": []` and no `compilerOptions` key.
- [ ] `make lint` exits 0; `make lint-py` and `make lint-fe` both exist and
      exit 0 independently.
- [ ] `grep -c 'eslint\|npm run lint' .github/workflows/ci.yml` returns at
      least `1` (it returned 0 before this plan).
- [ ] `grep -c 'build:cloudflare' .github/workflows/ci.yml` returns at least `1`.
- [ ] `grep -c 'vitest run --coverage' .github/workflows/ci.yml` returns at least `1`.
- [ ] `cd frontend && npm run build:cloudflare` exits 0.
- [ ] `cd frontend && npx vitest run --coverage` exits 0, reports `490 passed`
      across 55 files, and prints no `does not meet threshold` line.
- [ ] `frontend/vitest.config.ts` has no top-level `lines:` / `functions:` /
      `branches:` / `statements:` key directly under `coverage` — they are
      nested under `thresholds`:
      `grep -A6 'thresholds: {' frontend/vitest.config.ts` shows all four.
- [ ] `grep '"@vitest/coverage-v8"' frontend/package.json` shows `"4.0.18"`
      exactly (no `^`, no `~`).
- [ ] `cd workers && npx vitest run` reports `345 passed`, 25 files.
- [ ] `make test-py` reports `1141 passed, 3 failed, 7 skipped` — the same
      3 pre-existing pyexpat failures, no more, no fewer.
- [ ] `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))"` exits 0.
- [ ] `git status --short` lists no file outside the In-scope list (ignoring
      the pre-existing `.claude/STATE.md` and the untracked `plans/`).
- [ ] Nothing under `immi_case_downloader/static/react/` and nothing under
      `frontend/src/tokens/` is modified.
- [ ] Nothing was pushed and no PR was opened.

## STOP conditions

Stop and report back — do not improvise — if any of these occur.

1. **The drift check is not empty** and the "Current state" excerpts no longer
   match the live files. Line numbers in this plan were read at `42826a3`;
   a mismatch means the codebase moved under you.
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
4. **The Vitest test count moves off 490**, in either direction, at any point.
   You are only supposed to be adding fields to fixtures and deleting unused
   imports.
5. **`npx tsc --noEmit -p tsconfig.test.json` reports substantially more than
   19 errors in Step 5b**, or reports errors in files not on the enumerated
   list. The 20-error backlog was measured directly; a much larger number means
   your `tsconfig.test.json` differs from the one specified (most likely
   `include` is wrong, or you included `frontend/e2e/**`).
6. **`npm install --save-dev --save-exact @vitest/coverage-v8@4.0.18` bumps
   `vitest` itself** in `frontend/package-lock.json`. Check with
   `git diff frontend/package-lock.json | grep -n '"vitest"'`. The pin exists
   precisely to avoid that; a bump puts 490 tests on an untested runner version.
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
10. **`make test-py` deviates from `1141 passed, 3 failed, 7 skipped`.** The 3
   failures are the known Homebrew `pyexpat`/`pypdf` ABI problem; any other
   number means something in this plan reached the Python side, which it
   should not have.

## Maintenance notes

For whoever owns this next.

**What a reviewer should scrutinise in the PR**

- That `frontend/tsconfig.json` gained *only* a `references` entry. Any
  `compilerOptions` there is a TS5101 landmine.
- That the coverage `thresholds` numbers are the measured floor, not a
  copy-paste of `80`. Ask what was measured; the commit message should say.
- That the non-vacuity assertion is present in `ci.yml` and its two floors
  (`150` src, `50` tests) are below the real counts (169 / 55) but far above
  zero. The assertion is the whole point: without it this exact regression can
  reappear silently.
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
- **`CLAUDE.md:32` documents a path that does not exist**:
  `cd frontend && npx vitest run src/__tests__/components/judges/`. There is no
  `frontend/src/__tests__` directory; the tests live in `frontend/__tests__`
  (55 files). An agent following that line runs Vitest against nothing. Fix it
  to `cd frontend && npx vitest run __tests__/` in whichever plan owns
  `CLAUDE.md`. Also update the `make lint` description there once Step 3 lands,
  since `make lint` is no longer Python-only.
- **`@eslint/js` is `^9.39.1` while `eslint` is `^10.0.0`.** Investigated and
  deliberately not changed — see "Findings reconsidered".
- **`eslint.config.js:19` sets `ecmaVersion: 2020`** while
  `tsconfig.app.json:6` sets `lib: ["ES2023"]` and the repo mandates ES2023
  `.toSorted()`. Latent only: `typescript-eslint` supplies its own parser and
  `.toSorted()` is a method call, not syntax, so nothing misparses today. Worth
  aligning to `2023` + `globals.es2023` alongside the `@eslint/js` bump if that
  is ever done.

**What will interact with this later**

- Any future change to `frontend/tsconfig*.json` must keep the CI assertion's
  floors honest. If the app legitimately shrinks below 150 source files, raise
  or lower the floor **deliberately and in the same commit** — never delete the
  assertion.
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
