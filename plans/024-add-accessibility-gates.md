# Plan 024: Make lint and tests able to catch contrast and a11y regressions

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. **Do NOT edit `plans/README.md`.** That index is
> maintained by the integration owner; several plans run in parallel and a
> shared status file is a guaranteed conflict. Report your status instead.
>
> ## ⚠️ Read this before anything else: this plan runs LAST
>
> This plan measures the frontend and freezes the measurement into gates. Four
> sibling plans change what it would measure, so running it early bakes in a
> baseline that is wrong on arrival:
>
> | must land first | what it changes under this plan's feet |
> |---|---|
> | `plans/022-fix-contrast-tokens.md` | adds `color.outcome` (9×2) and `color.on-solid`, extends `color.chart` from 4 to 7 steps, rewrites 7 of 9 dark court values, and fixes 6 baseline values. **Step 3's 119-pair count, its 39-entry `KNOWN_BELOW_THRESHOLD` list and its "more than five keys moved is a STOP" rule are all invalidated.** |
> | `plans/023-fix-accessibility-semantics.md` | gives `FilterPill`'s remove button an `aria-label`, so **Step 5's `["button-name"]` expectation becomes `[]`**; also changes `Pagination` and `CourtBadge`, both of which Step 5 renders |
> | `plans/025-remove-internal-tooling-from-prod.md` | moves `getLuminance` / `getContrastRatio` out of `frontend/__tests__/css-tokens.test.ts` into `frontend/src/lib/color.ts`. **Step 3 must import them, not assume they are defined at lines 13–30.** |
> | `plans/001-restore-the-frontend-compile-gate.md` | wires `eslint` into CI (without it a rule added here gates nothing) and creates `frontend/tsconfig.test.json` so the new test files are type-checked |
>
> The design consequence: **Step 3 no longer hard-codes a matrix. It measures,
> records, then locks.** Do not try to reconcile a live measurement against a
> number written in this file — the numbers here are illustrative of the shape,
> not the contract.
>
> **Drift check (run first)**. A commit-range diff cannot see uncommitted,
> staged or untracked work, so run all four commands:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> P="frontend/eslint.config.js \
>    frontend/package.json \
>    frontend/package-lock.json \
>    frontend/__tests__/css-tokens.test.ts \
>    frontend/__tests__/a11y-components.test.tsx \
>    frontend/__tests__/a11y-hardcoded-colors.test.tsx"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $P    # committed since the plan was written
> git diff --stat -- $P                  # unstaged
> git diff --cached --stat -- $P         # staged
> ```
>
> Expected:
>
> - `frontend/package.json` / `package-lock.json` **may** appear in the committed
>   diff (plan 001 adds a devDependency).
> - `frontend/__tests__/css-tokens.test.ts` **must** appear in the committed
>   diff — that is plan 025 having extracted the colour helpers, and it is a
>   prerequisite. If it is *absent*, 025 has not landed: STOP.
> - `frontend/eslint.config.js`, `a11y-components.test.tsx` and
>   `a11y-hardcoded-colors.test.tsx` must be **absent** everywhere. If
>   `eslint.config.js` is listed, compare the "Current state" excerpt against
>   the live code; on a mismatch, treat it as a STOP condition.
> - Nothing in-scope may appear in the unstaged or staged diffs.
>
> Also confirm the two token prerequisites are in place before measuring:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
> grep -c -- '--color-on-solid' src/tokens/tokens.css      # must be 2  → plan 022 landed
> grep -c 'aria-label' src/components/shared/FilterPill.tsx # must be 1  → plan 023 landed
> grep -c 'from "@/lib/color"' __tests__/css-tokens.test.ts # must be 1  → plan 025 landed
> ```
>
> Any of those returning the wrong value is a STOP condition, not something to
> work around.
>
> Never run `git checkout --` or `git clean -f` to "clean up" a dirty tree.
> Those destroy the operator's work. Stop and report instead.
>
> This plan also reads — but never modifies — `frontend/src/**` and
> `frontend/src/tokens/tokens.json`.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on** (all four are hard — see the boxed note at the top):
  `plans/001-restore-the-frontend-compile-gate.md`,
  `plans/022-fix-contrast-tokens.md`,
  `plans/023-fix-accessibility-semantics.md`,
  `plans/025-remove-internal-tooling-from-prod.md`
- **Category**: tests
- **Planned at**: commit `42826a3`, 2026-08-27. **The measurements in this file
  are from that commit and are now stale by design** — Steps 2, 3 and 5 each
  re-measure against the live tree and record the result. Treat every number
  printed here as an example of the shape, never as an expected value.

### Why it depends on 001

Plan 001 is what makes an ESLint failure *matter*: today CI never runs
`eslint` at all, so a rule added to `frontend/eslint.config.js` gates nothing.
001 wires `eslint` into `.github/workflows/ci.yml` and the `Makefile`, makes
`tsc` compile real files, and creates `frontend/tsconfig.test.json` so the
files under `frontend/__tests__/` are type-checked. The two new test files
this plan creates are written to type-check under that project. 001 also edits
`frontend/package.json` / `package-lock.json`, so running this plan first would
create an avoidable merge conflict.

## Why this matters

The frontend has a decided visual identity ("Legal Codex") and a token system
that is supposed to own every colour — but **nothing in lint, unit tests, or
E2E can fail on an accessibility or contrast regression**. `eslint.config.js`
loads no `jsx-a11y` plugin, so an icon-only button with no accessible name
lints clean. `__tests__/css-tokens.test.ts` checks exactly five contrast
pairs out of a possible 119 (measured at `42826a3`; the real figure is higher
after plan 022 extends the chart ramp — Step 3a measures it) and one of those
five *documents* a sub-AA ratio
rather than failing it — `text.muted`, `text.secondary`, both border tokens
and every white-on-coloured badge are untested. `__tests__/analytics-charts-tokens.test.tsx`
hand-enumerates five component files while 32 files under `src/` contain raw
hex colour literals, so the "no hardcoded colours" guard reaches about 15% of
its own subject. There is no `axe-core`, `vitest-axe` or `@axe-core/playwright`
anywhere in the dependency tree.

The concrete cost: every contrast, labelling or overflow defect that gets
fixed can silently come back, because no gate exists to fail on it. The
primary user of this app is a self-representing immigration applicant reading
tribunal outcomes under stress — low-contrast body text and unlabelled
controls are not cosmetic for that person.

This plan installs four gates and, just as importantly, **writes down the
debt that already exists** as three explicit, self-shrinking allowlists:
below-threshold token pairs, files with raw hex, and `{file, rule}` `jsx-a11y`
violations. Each allowlist is enforced in both directions — an unlisted
offender fails the build, and a *listed* entry that no longer offends also
fails the build, so the lists can only shrink.

**The sizes of those allowlists are measured at execution time, not stated
here.** At `42826a3` they were 39 pairs / 30 files / 7 files, but this plan now
runs after plans 022, 023 and 025, each of which changes what gets measured —
022 alone fixes over twenty of the token pairs and adds new ones. Every step
that needs a baseline generates it first. Numbers that appear in this file are
illustrative of the shape and are labelled as such.

## Current state

### Files this plan changes

- `frontend/eslint.config.js` — 31 lines, flat config. Loads
  `js.recommended`, `typescript-eslint`, `react-hooks`, `react-refresh`. No
  accessibility plugin.
- `frontend/package.json` — 71 lines. `devDependencies` begins at line 48 and
  contains no `axe-core`, no `vitest-axe`, no `@axe-core/playwright`, no
  `eslint-plugin-jsx-a11y`.
- `frontend/__tests__/css-tokens.test.ts` — 512 lines, 44 tests in 8 groups at
  `42826a3`. Group 3 (lines 156–216 **at that commit**) is the entire contrast
  surface. Plan 025 has since replaced this file's local `getLuminance` /
  `getContrastRatio` with `import { getContrastRatio } from "@/lib/color";`,
  which shifts every line number — **locate Group 3 by its `// ═══` banner
  text, not by line number.**
- `frontend/__tests__/a11y-components.test.tsx` — **create**.
- `frontend/__tests__/a11y-hardcoded-colors.test.tsx` — **create**.
- `frontend/__tests__/a11y-lint-baseline.test.ts` — **create**.

### Files this plan reads but must never modify

- `frontend/src/tokens/tokens.json` — the design tokens. Every contrast pair is
  computed from it (119 at `42826a3`; more after plan 022 extends the chart
  ramp and adds the outcome scale — Step 3a measures the real number).
- `frontend/src/lib/color.ts` — created by plan 025; the single implementation
  of `getLuminance` / `getContrastRatio` that both the Design Tokens page and
  `css-tokens.test.ts` use. Import from it; never re-implement it.
- `frontend/src/**` — 167 `.ts`/`.tsx` files. The hex baseline and the
  `jsx-a11y` baseline are measured from them.
- `frontend/__tests__/analytics-charts-tokens.test.tsx` — the existing
  five-file hex guard. **Leave it alone**; plan 001 already edits it, and the
  new repo-wide scan is additive, not a replacement.

### `frontend/eslint.config.js` — the whole file, verbatim

```js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'playwright-report', 'test-results', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
])
```

Baseline measured at `42826a3`: `cd frontend && npx eslint .` →
`✖ 25 problems (0 errors, 25 warnings)`, exit code **0**. The 25 warnings are
unused `eslint-disable` directives and `no-console`; they are pre-existing and
out of scope.

### `frontend/package.json:48-70` — `devDependencies`, verbatim

```json
  "devDependencies": {
    "@eslint/js": "^9.39.1",
    "@playwright/test": "^1.58.2",
    "@testing-library/dom": "^10.4.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/node": "^24.10.13",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.4",
    "@vitest/ui": "^4.0.18",
    "eslint": "^10.0.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.4.26",
    "globals": "^16.5.0",
    "jsdom": "^24.1.3",
    "tsx": "^4.21.0",
    "typescript": "~5.9.3",
    "typescript-eslint": "^8.56.0",
    "vite": "^7.3.1",
    "vitest": "^4.0.18"
  }
```

There is **no** top-level `"overrides"` key in this file today. Step 1 adds
one, and it is load-bearing — see the next subsection.

### The ESLint 10 / jsx-a11y peer-dependency conflict (verified, will bite you)

`eslint-plugin-jsx-a11y@6.10.2` (latest) declares:

```
peerDependencies = { eslint: '^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9' }
```

This repo runs `eslint@10.9.1` (`npx eslint --version` → `v10.0.0` spec,
`10.9.1` installed) under `npm@10.9.8`. A plain install therefore fails:

```
$ npm install --save-dev eslint-plugin-jsx-a11y@6.10.2
npm error code ERESOLVE
npm error Could not resolve dependency:
npm error peer eslint@"^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9" from eslint-plugin-jsx-a11y@6.10.2
```

**Do not reach for `--legacy-peer-deps` or `--force`.** Both leave the
lockfile in a state `npm ci` can reproduce only by accident, and CI runs
`npm ci`. The correct fix — verified to resolve cleanly with these exact
versions — is an `overrides` entry in `package.json` that points the plugin's
`eslint` peer at the root's own spec:

```json
  "overrides": {
    "eslint-plugin-jsx-a11y": {
      "eslint": "$eslint"
    }
  }
```

The plugin itself was verified to **run correctly under ESLint 10**: linting a
copy of `frontend/src` with `jsxA11y.flatConfigs.recommended` produced 19
findings at severity `error` across 7 files and no plugin crash.

### `frontend/__tests__/css-tokens.test.ts:156-216` — the block Step 3 replaces, verbatim

```ts
// ══════════════════════════════════════════════════════════════════════
// Group 3: WCAG contrast compliance
// ══════════════════════════════════════════════════════════════════════
describe("Group 3 – WCAG contrast compliance", () => {
  it("light mode: text.DEFAULT on background.DEFAULT meets WCAG AA (≥4.5:1)", () => {
    const textColor = tokensJSON.color.text.DEFAULT as string;
    const bgColor = tokensJSON.color.background.DEFAULT as string;
    const ratio = getContrastRatio(textColor, bgColor);
    // Actual ratio: ~13.57:1 — well above WCAG AA (4.5) and AAA (7.0)
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("dark mode: text.DEFAULT on background.DEFAULT meets WCAG AA (≥4.5:1)", () => {
    const textColor = tokensJSON.color.dark.text.DEFAULT as string;
    const bgColor = tokensJSON.color.dark.background.DEFAULT as string;
    const ratio = getContrastRatio(textColor, bgColor);
    // Actual ratio: ~13.44:1 — well above WCAG AA
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("light mode: accent.DEFAULT on background.DEFAULT has sufficient contrast for UI (≥4.5:1)", () => {
    // accent.DEFAULT (#5c4306 dark brown) is used for interactive elements like checkboxes/focus rings.
    // accent.light (#d4a017 gold) is used for decorative/highlight purposes only (ratio ~2.16 on light bg),
    // so we test the DEFAULT accent which is the accessibility-relevant value.
    const accentColor = tokensJSON.color.accent.DEFAULT as string;
    const bgColor = tokensJSON.color.background.DEFAULT as string;
    const ratio = getContrastRatio(accentColor, bgColor);
    // Actual ratio: ~8.45:1
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("light mode: accent.light is a known low-contrast decorative color (ratio < 4.5 on light bg)", () => {
    // accent.light (#d4a017) is used for decorative highlights and chart accents,
    // NOT for body text. Its contrast ratio against the light background is ~2.16:1,
    // which is intentionally below WCAG AA for text. This test documents the known limitation.
    const accentLight = tokensJSON.color.accent.light as string;
    const bgColor = tokensJSON.color.background.DEFAULT as string;
    const ratio = getContrastRatio(accentLight, bgColor);
    // Known: ~2.16:1 — acceptable for decorative/non-text use (WCAG 1.4.11 allows 3:1 for UI components,
    // but decorative elements are exempt under WCAG 1.4.1)
    expect(ratio).toBeLessThan(4.5);
  });

  it("dark mode: accent.DEFAULT on background.DEFAULT has sufficient contrast (≥3.0:1 for UI components)", () => {
    const accentColor = tokensJSON.color.dark.accent.DEFAULT as string;
    const bgColor = tokensJSON.color.dark.background.DEFAULT as string;
    const ratio = getContrastRatio(accentColor, bgColor);
    // Dark accent (#c9942e) on dark bg (#111820) — WCAG 1.4.11 requires 3:1 for UI components
    expect(ratio).toBeGreaterThanOrEqual(3.0);
  });

  it("semantic success/warning/danger/info are valid hex (format check)", () => {
    const semantic = tokensJSON.color.semantic as Record<string, string>;
    for (const [name, value] of Object.entries(semantic)) {
      expect(
        /^#[0-9a-fA-F]{6}$/.test(value),
        `semantic.${name} = "${value}" is not valid hex`,
      ).toBe(true);
    }
  });
});
```

Six `it` blocks; five compute a ratio; one (`accent.light`) asserts the ratio
is *below* 4.5, i.e. it records a failure as acceptable rather than gating it.

The helpers Step 3 reuses already exist higher in the same file and must
**not** be redefined:

```ts
// frontend/__tests__/css-tokens.test.ts:13-30
function getLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return 0.5; // fallback for non-hex (rgba etc)
  ...
}

function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
```

Note the `return 0.5` fallback: any non-6-digit-hex value (e.g.
`accent.muted: "rgba(184,134,11,0.12)"`) yields a meaningless ratio. Step 3's
pair builder must therefore skip non-hex values explicitly.

### Why `CourtBadge` is checked as white-on-colour

`frontend/src/components/shared/CourtBadge.tsx:36-47` renders the court colour
as a **background** with white text:

```tsx
    <span
      title={fullName}
      className={cn(
        "inline-flex shrink-0 cursor-default items-center whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-medium text-white",
        bg,
        className
      )}
    >
      {court}
    </span>
```

So the meaningful assertion for the nine court tokens is `#ffffff` against the
court colour at 4.5:1 (the text is `text-xs`, i.e. normal size, not large).
Eight of nine pass; `court.FCCA` (`#b9770e`) is 3.68:1 and is the single
allowlisted badge entry.

### Repo conventions this plan must honour

Quoted from `CLAUDE.md` and the surrounding code, because you have not read
those files:

- **`.toSorted()` not `.sort()`** — never mutate arrays in React code or its
  tests. `.toSorted()` is ES2023 and `frontend/tsconfig.app.json` already sets
  `"lib": ["ES2023", "DOM", "DOM.Iterable"]`.
- **All spacing / shadow / radius / colour values come from
  `frontend/src/tokens/tokens.json`** — no magic numbers, no raw hex in
  components. That is the rule the new hex scan enforces.
- **Design direction is decided and named "Legal Codex"**: warm off-white
  `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text serif
  headings, nine court-specific colour codes. Do not "improve" any colour
  value — this plan measures tokens, it never changes them.
- **Recharts `Tooltip` `contentStyle` must set `color: "var(--color-text)"`**
  or the text is invisible in dark mode. Already structurally solved: only
  `frontend/src/components/shared/ChartTooltip.tsx` imports `Tooltip` from
  recharts, and it injects `color: "var(--color-text)"` at line 17.
- **Commit style**: `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines. Real
  example from `git log`: `fix: install root node_modules in make install`.
- **Vitest picks up** `__tests__/**/*.{test,spec}.{ts,tsx}` (see
  `frontend/vitest.config.ts`), environment `jsdom`, globals on, with
  `__tests__/legislations-setup.ts` as the global setup. That setup file
  already mocks `ResizeObserver`, `IntersectionObserver`, `window.scrollTo`,
  `localStorage`, and `react-i18next`'s `useTranslation` (its `t` returns
  `options.defaultValue` when one is supplied, otherwise the key string). New
  tests get all of that for free — do not re-mock any of it.
- **`@/` resolves to `frontend/src`** via the `resolve.alias` in
  `frontend/vitest.config.ts`.

## Commands you will need

All commands run from `/Users/d/Developer/Active Projects/IMMI-Case-/frontend`
unless stated otherwise.

| Purpose | Command | Expected on success |
|---|---|---|
| Install frontend deps | `npm install` | exit 0, no `ERESOLVE` |
| Reproduce CI install | `npm ci` | exit 0 |
| Lint | `npx eslint .` | exit 0 (warnings allowed, errors not) |
| Lint, machine-readable | `npx eslint . --format json` | JSON on stdout |
| Typecheck (the real one) | `npx tsc -b --noEmit` | exit 0 |
| One test file | `npx vitest run __tests__/<file>` | all pass |
| Whole frontend suite | `npx vitest run` | 0 failed; the total is accounted for as a delta against the `FE_BEFORE` you record in Step 6, **never** compared to a number written in this file |
| Whole repo suite (from repo root) | `make test` | Python + frontend + worker suites pass, with the only Python failures being the 3 pre-existing `tests/test_backfill_judge_overrides_from_pdf.py` pyexpat/pypdf ImportErrors, **named individually** |

Note: `npx tsc --noEmit` (no `-b`) compiles **zero files** at `42826a3` and is
worthless as a check — plan 001 fixes the `Makefile`/CI invocation. Always use
`npx tsc -b --noEmit` here.

`make test-py` fails on this machine, and the failures are environmental. Assert
them **by name**, not by count — a count can stay the same while a real
regression replaces an environmental failure:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py 2>&1 | grep -E '^FAILED' | sort
```

→ exactly three lines, all naming
`tests/test_backfill_judge_overrides_from_pdf.py` (a Homebrew Python 3.14.7
`pyexpat`/`libexpat` ABI mismatch breaking the `pypdf` import). They are
unrelated to this plan, which touches no Python. Do not try to fix them, and do
not treat them as a regression — but if the list contains anything else, stop
and report, because that is a regression someone else caused.

## Suggested executor toolkit

- Skills, if available in your environment: `frontend-a11y` or
  `wcag-audit-patterns` for the WCAG threshold rules; `vitest` for runner
  flags.
- Reference: WCAG 2.1 SC 1.4.3 (Contrast Minimum, 4.5:1 for normal text) and
  SC 1.4.11 (Non-text Contrast, 3:1 for UI components and graphical objects).
  Those are the only two thresholds this plan uses.

## Scope

**In scope** (the only files you may create or modify):

- `frontend/package.json` — two devDependencies plus one `overrides` block
- `frontend/package-lock.json` — regenerated by `npm install`; never hand-edit
- `frontend/eslint.config.js`
- `frontend/__tests__/css-tokens.test.ts`
- `frontend/__tests__/a11y-hardcoded-colors.test.tsx` — **create**
- `frontend/__tests__/a11y-components.test.tsx` — **create**
- `frontend/__tests__/a11y-lint-baseline.test.ts` — **create** (Step 2b)

**Out of scope** (do NOT touch, even though they look related):

- **Anything under `frontend/src/`.** This is the hard boundary of this plan.
  Three baselines here record real defects in `src/` files; recording them is
  the deliverable. Fixing them is a different plan with a different file
  territory, and editing `src/` here would collide with plans running in
  parallel.
- `frontend/src/tokens/tokens.json` in particular. Changing a token value shifts
  the whole palette and is a design decision, not a test decision — and it is
  `plans/022-fix-contrast-tokens.md`'s territory, which by the time this plan
  runs has already fixed six baseline values, the nine dark court colours, and
  added the `outcome` / `on-solid` / `chart-1,6,7` tokens. Whatever
  `KNOWN_BELOW_THRESHOLD` entries remain after Step 3a are the debt 022
  explicitly deferred (its "What is still broken after this plan" section);
  record them, do not fix them here.
- `frontend/__tests__/analytics-charts-tokens.test.tsx` — plan 001 already
  edits this file. The new repo-wide scan is additive.
- `frontend/e2e/**` and `tests/e2e/**` — the E2E half of this work is
  deliberately deferred; see "Findings reconsidered".
- `.github/workflows/ci.yml` and `Makefile` — plan 001 owns both.
- `frontend/vitest.config.ts` and `frontend/tsconfig*.json` — plan 001 owns
  them; the new tests are written to fit what 001 produces.
- The 25 pre-existing ESLint warnings. Leave them.
- `.claude/STATE.md` is already modified in the working tree at `42826a3`.
  That is pre-existing and not yours — do not stage it.

## Git workflow

- Branch: `advisor/024-add-accessibility-gates`, cut from `main` **after** plans
  001, 022, 023 and 025 have landed there. Cutting it earlier means measuring a
  tree that is about to change, which is the one thing this plan must not do.
- Commit after each step, conventional-commit style: `<type>: <description>`,
  types `feat|fix|refactor|docs|test|chore|perf|ci`. Suggested messages are
  given per step.
- **No AI attribution lines** in commit messages — attribution is disabled
  globally for this repo.
- Do **NOT** push, do **NOT** open a PR, do **NOT** merge. The operator commits
  and ships.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
git checkout -b advisor/024-add-accessibility-gates
```

## Steps

### Step 1: Add the two devDependencies with the peer-conflict override

Edit `frontend/package.json` by hand, in this order, **before** running any
install:

1. In `devDependencies`, insert `"axe-core": "^4.13.0",` between
   `"@vitest/ui": "^4.0.18",` and `"eslint": "^10.0.0",`.
2. In `devDependencies`, insert `"eslint-plugin-jsx-a11y": "^6.10.2",`
   between `"eslint": "^10.0.0",` and `"eslint-plugin-react-hooks": "^7.1.1",`.
3. Add a new top-level `"overrides"` key after the closing brace of
   `devDependencies` (remember the comma after `}` of `devDependencies`):

```json
  "overrides": {
    "eslint-plugin-jsx-a11y": {
      "eslint": "$eslint"
    }
  }
```

Why the override: `eslint-plugin-jsx-a11y@6.10.2` declares
`peerDependencies.eslint` as `^3 || … || ^9`, this repo is on `eslint@10`, and
npm refuses the tree with `ERESOLVE`. `"$eslint"` tells npm to satisfy that
peer with the root project's own `eslint` spec. This was verified to resolve
cleanly on `npm@10.9.8` with `eslint@10.9.1`.

`axe-core@4.13.0` has **zero** dependencies and **zero** peer dependencies and
ships its own `axe.d.ts`, so it needs no override and no `@types/*` package.

Then install:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npm install
```

Do **not** pass `--legacy-peer-deps` or `--force`. If the install still fails,
that is a STOP condition.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
node -e "const p=require('./package.json');console.log(p.devDependencies['axe-core'], p.devDependencies['eslint-plugin-jsx-a11y'], JSON.stringify(p.overrides))" \
  && node -e "console.log(require('./node_modules/axe-core/package.json').version, require('./node_modules/eslint-plugin-jsx-a11y/package.json').version)"
```

→ exactly:

```
^4.13.0 ^6.10.2 {"eslint-plugin-jsx-a11y":{"eslint":"$eslint"}}
4.13.0 6.10.2
```

**Verify nothing else broke**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run 2>&1 | tail -5
```

→ 0 failed, and `Tests passed` equal to the `FE_BEFORE` you recorded before
starting. Adding two devDependencies must not change any test result; the point
is that the number did not move and there are 0 failures.

Commit: `chore: add axe-core and eslint-plugin-jsx-a11y devDependencies`

### Step 2: Turn on the jsx-a11y lint gate with an explicit 7-file baseline

Edit `frontend/eslint.config.js`:

1. Add the import, after the `reactRefresh` import:
   ```js
   import jsxA11y from 'eslint-plugin-jsx-a11y'
   ```
2. Add `jsxA11y.flatConfigs.recommended,` to the `extends` array of the
   existing `files: ['**/*.{ts,tsx}']` block, as the last entry after
   `reactRefresh.configs.vite,`.
3. Append the baseline block below **after** that config object, still inside
   the `defineConfig([...])` array.

The preset sets its rules to severity `error`. Nineteen violations existed in
seven `src/` files at `42826a3`, and `src/` is out of scope for this plan, so
those files are pinned to `warn` — per file, per rule.

**Be precise about what that buys, because an earlier draft of this plan was
not.** A `{ files: [...], rules: { 'jsx-a11y/x': 'warn' } }` override does
exactly one thing: it lowers rule `x` in that file to `warn`. Therefore:

| scenario | caught? |
|---|---|
| a **new file** with any jsx-a11y violation | ✅ error — the gate works |
| an **existing baseline file** violating a **different** jsx-a11y rule | ✅ error |
| an **existing baseline file** violating the **same** rule a second time | ❌ warning only |
| someone **fixes** a baseline violation, leaving a stale override | ❌ nothing fails |

The last two rows are real holes, and the config alone cannot close them —
ESLint has no "this override must still be needed" concept. Step 2b closes both
with an explicit `{file, rule}` snapshot test. Do not skip it and do not
describe the config as self-policing.

**Re-measure before you write the list.** Plans 022, 023 and 025 all touch
`src/` files; the seven-file / nineteen-violation baseline below is from
`42826a3` and may no longer be accurate. Generate the real list first:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
# Temporarily add jsxA11y.flatConfigs.recommended (steps 1 and 2 above) with NO
# baseline block, then:
npx eslint . --format json 2>/dev/null | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const rows=[];
  for(const f of JSON.parse(d))for(const m of f.messages){
    if(m.ruleId&&m.ruleId.startsWith('jsx-a11y/'))
      rows.push(f.filePath.replace(process.cwd()+'/','')+'\t'+m.ruleId);}
  rows.sort();
  console.log(rows.join('\n'));
  console.log('--- total: '+rows.length+' violations in '+new Set(rows.map(r=>r.split('\t')[0])).size+' files');
});" | tee /tmp/024-jsxa11y-baseline.txt
```

Write the baseline block from **that** output, one `{ files, rules }` entry per
file with the rules it actually violates. The block below is the `42826a3`
shape, kept as a worked example of the format and of the per-file commentary
each entry should carry:

```js
  // ── jsx-a11y baseline, measured at commit 42826a3 ─────────────────────
  // These 7 files carry the 19 jsx-a11y violations that existed when the
  // gate was switched on. They are pinned to `warn` per-rule so the gate can
  // be an error everywhere else in the 169-file tree.
  //
  // DO NOT ADD FILES OR RULES TO THIS LIST. Fix the violation and delete the
  // entry instead. Notes on what is actually wrong, for whoever fixes them:
  //   * heading-has-content / anchor-has-content in the llm-council files are
  //     false positives: they are react-markdown component overrides of the
  //     form `h1: (p) => <h1 ... {...p} />`, so the content arrives via the
  //     spread. Fix with a targeted eslint-disable-next-line + reason.
  //   * no-redundant-roles on DataToolsPage's `<ul role="list">` is a
  //     deliberate Safari/VoiceOver workaround (VoiceOver drops list
  //     semantics when list-style is none). Same treatment.
  //   * The interaction rules on the judges components and no-autofocus on
  //     SortableCaseItem are real defects worth fixing properly.
  {
    files: ['src/components/collections/SortableCaseItem.tsx'],
    rules: { 'jsx-a11y/no-autofocus': 'warn' },
  },
  {
    files: ['src/components/judges/JudgeCard.tsx'],
    rules: { 'jsx-a11y/no-noninteractive-element-interactions': 'warn' },
  },
  {
    files: ['src/components/judges/JudgeLeaderboard.tsx'],
    rules: {
      'jsx-a11y/no-static-element-interactions': 'warn',
      'jsx-a11y/no-noninteractive-tabindex': 'warn',
    },
  },
  {
    files: ['src/components/llm-council/StreamingCouncilView.tsx'],
    rules: { 'jsx-a11y/heading-has-content': 'warn' },
  },
  {
    files: ['src/components/llm-council/TurnCard.tsx'],
    rules: {
      'jsx-a11y/heading-has-content': 'warn',
      'jsx-a11y/anchor-has-content': 'warn',
    },
  },
  {
    files: ['src/pages/DataToolsPage.tsx'],
    rules: { 'jsx-a11y/no-redundant-roles': 'warn' },
  },
  {
    files: ['src/pages/DesignTokensPage.tsx'],
    rules: { 'jsx-a11y/role-supports-aria-props': 'warn' },
  },
```

Flat-config `files` patterns are resolved relative to the directory containing
the config file, so these `src/...` paths are correct as written.

**Verify** (exit code):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx eslint . > /tmp/eslint-024.txt 2>&1; echo "exit=$?"; tail -3 /tmp/eslint-024.txt
```

(Written without a pipe on purpose: `$PIPESTATUS` is bash-only and 0-indexed,
while this repo's default shell is zsh where the equivalent is `$pipestatus`
and 1-indexed. Redirecting to a file avoids the difference entirely.)

→ `exit=0`. **Do not gate on the total problem count.** `✖ 44 problems` was the
`42826a3` figure (25 pre-existing warnings + 19 newly-visible jsx-a11y ones);
sibling plans move both halves, and pinning the total would make any of them a
false failure here. What matters is `exit=0` — i.e. zero errors — plus the
identity check below.

**Verify** (the gate is armed, and nothing outside the baseline errors):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx eslint . --format json 2>/dev/null | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const r=JSON.parse(d);let e=0,w=0;const bad=[];
  for(const f of r)for(const m of f.messages){
    if(m.ruleId&&m.ruleId.startsWith('jsx-a11y/')){
      if(m.severity===2){e++;bad.push(f.filePath+':'+m.line+' '+m.ruleId);}else w++;}}
  console.log('jsx-a11y errors:',e,'warnings:',w);bad.forEach(x=>console.log('  ERR',x));});
"
```

→ `jsx-a11y errors: 0` and no `ERR` lines. The warning count must equal the
number of rows you measured into `/tmp/024-jsxa11y-baseline.txt`; report it,
do not assume 19.

If it prints a non-zero error count, a `src/` file has a violation your baseline
does not cover. **Do not fix it in `src/` and do not widen the baseline** — that
is a STOP condition.

### Step 2b: Lock the baseline with a `{file, rule}` snapshot test

The config override cannot detect a second violation of the same rule in a
baseline file, nor a stale exemption after someone fixes one. Close both holes
with a test that runs ESLint programmatically and compares the **identity** of
the jsx-a11y result set, not its size.

Create `frontend/__tests__/a11y-lint-baseline.test.ts`:

```ts
/**
 * a11y-lint-baseline.test.ts
 *
 * The jsx-a11y overrides in eslint.config.js pin known violations to `warn`.
 * ESLint cannot tell you when one of those overrides is (a) hiding a NEW
 * violation of the same rule in the same file, or (b) no longer needed because
 * someone fixed the violation. This test does both, by asserting the exact set
 * of "<relative path>\t<rule id>" pairs.
 *
 * When you FIX a violation: run this test, read the "no longer failing" list,
 * delete those entries from BOTH this array and eslint.config.js.
 * When you ADD one: don't. Fix it.
 *
 * Runtime: this lints the whole frontend tree (~15-30s). That is why it is a
 * single test in its own file.
 */
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import * as path from "path";

// Measured with the command in Step 2 of plans/024. One entry per
// (file, rule) violation. Sorted. Duplicates are meaningful: two entries for
// the same pair mean the rule fires twice in that file.
const BASELINE: readonly string[] = [
  // ← paste the sorted rows from /tmp/024-jsxa11y-baseline.txt here
];

describe("jsx-a11y lint baseline", () => {
  it(
    "the set of jsx-a11y violations is exactly the recorded baseline",
    async () => {
      const cwd = path.resolve(__dirname, "..");
      const eslint = new ESLint({ cwd });
      const results = await eslint.lintFiles(["."]);
      const actual = results
        .flatMap((r) =>
          r.messages
            .filter((m) => m.ruleId?.startsWith("jsx-a11y/"))
            .map((m) => `${path.relative(cwd, r.filePath)}\t${m.ruleId}`),
        )
        .toSorted();

      const expected = [...BASELINE].toSorted();

      const added = actual.filter(
        (x, i) => expected.indexOf(x) === -1 || actual.indexOf(x) !== i && expected.filter((e) => e === x).length < actual.filter((a) => a === x).length,
      );
      const removed = expected.filter((x) => !actual.includes(x));

      expect(
        actual,
        [
          added.length ? `NEW jsx-a11y violations (fix them):\n  ${added.join("\n  ")}` : "",
          removed.length ? `STALE baseline entries (delete them from BASELINE and from eslint.config.js):\n  ${removed.join("\n  ")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      ).toEqual(expected);
    },
    60_000, // linting the whole tree is slow; default 5s timeout is not enough
  );
});
```

Two implementation notes:

- `import { ESLint } from "eslint"` uses the Node API of the `eslint`
  devDependency already in `frontend/package.json`. Vitest's environment is
  `jsdom`, but the test still runs in a Node process, so `fs`/`path` and the
  ESLint API work normally — the same way
  `frontend/__tests__/i18n-hardcoded.test.ts` reads files from disk.
- If `new ESLint({ cwd })` cannot find the flat config, pass
  `{ cwd, overrideConfigFile: path.join(cwd, "eslint.config.js") }`. Do not
  silence the test or mark it `skip` — a skipped baseline test is the same as no
  gate at all, and this plan exists to add gates.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run __tests__/a11y-lint-baseline.test.ts 2>&1 | tail -5
```

→ `Tests  1 passed (1)`.

**Verify it bites in both directions** (do both, then undo them). This is the
whole point of the step:

1. **New same-rule violation.** In one of the baseline files, duplicate the
   offending element so the same rule fires twice. Re-run → the test **fails**
   with a `NEW jsx-a11y violations` message. Revert.
2. **Stale exemption.** Delete one entry from `BASELINE` (leaving the real
   violation in place is not the test — deleting the *entry* simulates the
   opposite, so instead delete the entry **and** fix the violation; or more
   cheaply, add a fabricated entry such as
   `"src/pages/DoesNotExist.tsx\tjsx-a11y/alt-text"` to `BASELINE`). Re-run →
   the test **fails** with a `STALE baseline entries` message. Revert.

If either rehearsal passes instead of failing, the test is vacuous — most likely
`lintFiles(["."])` resolved no files. Print `results.length` and fix it before
continuing.

Commit: `test: gate frontend lint on jsx-a11y with a locked baseline`

### Step 3: Replace the 5-pair contrast spot-check with the full token matrix

**Measure first, then lock. Do not copy the numbers below.**

Three things about this step changed after review, and all three matter:

1. **The pair count is not 119 any more.** Plan 022 extends `color.chart` from 4
   keys to 7 (that alone adds 12 pairs across both themes) and adds
   `color.outcome` and `color.on-solid`. The matrix builder below derives its
   pairs from `tokens.json`, so the count follows the data — which is why the
   count assertion is now "equals the number you measured and wrote down", not
   "equals 119".
2. **`KNOWN_BELOW_THRESHOLD` is not the 39-entry list below.** Plan 022 fixes
   light `text.muted` (×5), light `chart.3` and `chart.5`, dark `text.muted`
   (×5), dark `border.DEFAULT` (×5), dark `semantic.danger` (×2) and five dark
   court entries — well over twenty of the `42826a3` entries become **stale**,
   which the "no stale exemptions" test correctly reports as failures. That is
   the test working, not the tree being broken. Measure the real list.
3. **`getLuminance` / `getContrastRatio` are no longer defined in this file.**
   Plan 025 extracted them to `frontend/src/lib/color.ts` and replaced the local
   copies with `import { getContrastRatio } from "@/lib/color";`. Use that
   import. If you need `getLuminance` too, add it to the same import statement —
   do **not** reintroduce a local copy, since removing the duplicate implementation
   was the entire point of plan 025.

**3a — measure.** With plans 022/023/025 landed, generate the live matrix:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && python3 - <<'PY' | tee /tmp/024-contrast-baseline.txt
import json
t = json.load(open('src/tokens/tokens.json'))['color']
def lum(h):
    h = h.lstrip('#'); r, g, b = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
def cr(a, b):
    la, lb = lum(a), lum(b); hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)
BG = ["DEFAULT", "card", "sidebar", "surface", "surface-hover"]
ishex = lambda v: isinstance(v, str) and len(v) == 7 and v.startswith('#')
pairs = []
for theme, s in (("light", t), ("dark", t["dark"])):
    for k in ("DEFAULT", "secondary", "muted"):
        for b in BG: pairs.append((f"{theme}:text.{k} on background.{b}", cr(s['text'][k], s['background'][b]), 4.5))
    for k in ("DEFAULT", "light"):
        for b in BG: pairs.append((f"{theme}:border.{k} on background.{b}", cr(s['border'][k], s['background'][b]), 3.0))
    for k in s['semantic']:
        for b in ("DEFAULT", "card"): pairs.append((f"{theme}:semantic.{k} on background.{b}", cr(s['semantic'][k], s['background'][b]), 4.5))
    for g in ("accent", "primary"):
        for k, v in s[g].items():
            if ishex(v): pairs.append((f"{theme}:{g}.{k} on background.DEFAULT", cr(v, s['background']['DEFAULT']), 4.5))
    for k in s['chart']:
        for b in ("DEFAULT", "card"): pairs.append((f"{theme}:chart.{k} on background.{b}", cr(s['chart'][k], s['background'][b]), 3.0))
    for k in s['court']:
        pairs.append((f"{theme}:court.{k} on background.DEFAULT", cr(s['court'][k], s['background']['DEFAULT']), 3.0))
    # CourtBadge: the label colour is hardcoded white in CourtBadge.tsx:39,
    # and bg-court-* resolves --color-court-* from the ACTIVE theme block —
    # so both themes must be checked, not just light.
    for k in s['court']:
        pairs.append((f"badge:{theme}:text.white on court.{k}", cr('#ffffff', s['court'][k]), 4.5))
print(f"# total pairs: {len(pairs)}")
print("# below threshold:")
for key, ratio, th in pairs:
    if ratio < th: print(f'  "{key}", // {ratio:.2f} (needs {th})')
PY
```

**3b — write the test from that output.** Paste the printed
`below threshold` lines into `KNOWN_BELOW_THRESHOLD` verbatim, and put the
printed total into the count assertion. In
`frontend/__tests__/css-tokens.test.ts`, delete the whole Group 3 banner +
`describe` block (from the `// ═══` banner down to and including its closing
`});` — locate it by the banner text, **not** by line numbers 156–216, which
plan 025's edits have already moved) and put the block below in its place.

Two required changes from the `42826a3` shape shown here:

- The `badge:` loop must cover **both** themes (`light` and `dark`), matching
  the measurement script. An earlier draft only checked
  `tokensJSON.color.court`, i.e. light — which is exactly how a broken dark
  court value would have slipped through. `CourtBadge.tsx:39` hardcodes
  `text-white` on `bg-court-*`, and `tokens.css` redefines `--color-court-*`
  inside `.dark`, so the dark values are just as user-facing as the light ones.
- `getContrastRatio` comes from `@/lib/color`, not from a local definition.

Do not touch any other group.

```ts
// ══════════════════════════════════════════════════════════════════════
// Group 3: WCAG contrast compliance — full token matrix
// ══════════════════════════════════════════════════════════════════════
//
// Every foreground token is checked against every background token it can
// realistically sit on, in BOTH themes.
//
// Thresholds (WCAG 2.1):
//   4.5:1  normal-size text          — SC 1.4.3 Contrast (Minimum)
//   3.0:1  UI components & graphics  — SC 1.4.11 Non-text Contrast
//
// TOTAL_PAIRS and KNOWN_BELOW_THRESHOLD are MEASURED from the live
// src/tokens/tokens.json (see plans/024 Step 3a), not copied from a plan.
// Two assertions keep the list honest, in both directions:
//   * a pair NOT on the list must meet its threshold  → no new debt
//   * a pair ON the list must still fail              → no stale exemptions
// When you fix a token in src/tokens/tokens.json, DELETE its entries here —
// the "no stale exemptions" test will tell you exactly which ones.

type ColorScope = {
  text: Record<string, string>;
  border: Record<string, string>;
  background: Record<string, string>;
  semantic: Record<string, string>;
  accent: Record<string, string>;
  primary: Record<string, string>;
  chart: Record<string, string>;
  court: Record<string, string>;
};

type ContrastPair = { key: string; ratio: number; threshold: number };

const BACKGROUND_KEYS = [
  "DEFAULT",
  "card",
  "sidebar",
  "surface",
  "surface-hover",
] as const;

/**
 * The number of pairs buildContrastPairs() produces, measured from the live
 * tokens.json (plans/024 Step 3a). It guards the matrix itself: if a token
 * group is renamed or dropped, the count moves and this fails loudly instead
 * of the other assertions passing vacuously over a shrunken set.
 * It was 119 at commit 42826a3, before plan 022 extended the chart ramp.
 */
const TOTAL_PAIRS = /* ← paste the measured total from Step 3a */ 0;

/**
 * MEASURED, NOT COPIED. Paste the `below threshold` output of Step 3a here.
 * The list below is the commit-42826a3 shape, retained only as a format
 * example — most of these entries are FIXED by plan 022 and will be reported
 * as stale exemptions if you paste them unchanged.
 */
const KNOWN_BELOW_THRESHOLD: readonly string[] = [
  // ── Light theme ────────────────────────────────────────────────────
  "light:text.muted on background.DEFAULT", // 3.28 (needs 4.5)
  "light:text.muted on background.card", // 3.61 (needs 4.5)
  "light:text.muted on background.sidebar", // 3.43 (needs 4.5)
  "light:text.muted on background.surface", // 3.14 (needs 4.5)
  "light:text.muted on background.surface-hover", // 2.84 (needs 4.5)
  "light:border.light on background.DEFAULT", // 1.11 (needs 3.0)
  "light:border.light on background.card", // 1.22 (needs 3.0)
  "light:border.light on background.sidebar", // 1.16 (needs 3.0)
  "light:border.light on background.surface", // 1.06 (needs 3.0)
  "light:border.light on background.surface-hover", // 1.04 (needs 3.0)
  "light:accent.light on background.DEFAULT", // 2.16 (needs 4.5) — decorative gold
  "light:chart.3 on background.DEFAULT", // 2.31 (needs 3.0)
  "light:chart.3 on background.card", // 2.54 (needs 3.0)
  "light:chart.5 on background.DEFAULT", // 1.95 (needs 3.0)
  "light:chart.5 on background.card", // 2.15 (needs 3.0)
  // ── Dark theme ─────────────────────────────────────────────────────
  "dark:text.muted on background.DEFAULT", // 3.95 (needs 4.5)
  "dark:text.muted on background.card", // 3.54 (needs 4.5)
  "dark:text.muted on background.sidebar", // 3.79 (needs 4.5)
  "dark:text.muted on background.surface", // 3.40 (needs 4.5)
  "dark:text.muted on background.surface-hover", // 2.91 (needs 4.5)
  "dark:border.DEFAULT on background.DEFAULT", // 2.22 (needs 3.0)
  "dark:border.DEFAULT on background.card", // 1.99 (needs 3.0)
  "dark:border.DEFAULT on background.sidebar", // 2.13 (needs 3.0)
  "dark:border.DEFAULT on background.surface", // 1.91 (needs 3.0)
  "dark:border.DEFAULT on background.surface-hover", // 1.63 (needs 3.0)
  "dark:border.light on background.DEFAULT", // 1.49 (needs 3.0)
  "dark:border.light on background.card", // 1.33 (needs 3.0)
  "dark:border.light on background.sidebar", // 1.43 (needs 3.0)
  "dark:border.light on background.surface", // 1.28 (needs 3.0)
  "dark:border.light on background.surface-hover", // 1.10 (needs 3.0)
  "dark:semantic.danger on background.DEFAULT", // 4.00 (needs 4.5)
  "dark:semantic.danger on background.card", // 3.58 (needs 4.5)
  "dark:primary.lighter on background.DEFAULT", // 4.23 (needs 4.5)
  "dark:court.AATA on background.DEFAULT", // 2.14 (needs 3.0)
  "dark:court.ARTA on background.DEFAULT", // 2.09 (needs 3.0)
  "dark:court.FedCFamC2G on background.DEFAULT", // 2.70 (needs 3.0)
  "dark:court.HCA on background.DEFAULT", // 1.16 (needs 3.0)
  "dark:court.MRTA on background.DEFAULT", // 2.33 (needs 3.0)
  // ── CourtBadge: white label on the court colour ────────────────────
  "badge:text.white on court.FCCA", // 3.68 (needs 4.5)
];

function buildContrastPairs(): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  const isHex = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);
  const add = (key: string, fg: string, bg: string, threshold: number) => {
    pairs.push({ key, ratio: getContrastRatio(fg, bg), threshold });
  };

  const scopes = [
    ["light", tokensJSON.color as ColorScope],
    ["dark", tokensJSON.color.dark as ColorScope],
  ] as const;

  for (const [theme, scope] of scopes) {
    // Body text on every surface it can land on — 4.5:1.
    for (const key of ["DEFAULT", "secondary", "muted"]) {
      for (const bg of BACKGROUND_KEYS) {
        add(
          `${theme}:text.${key} on background.${bg}`,
          scope.text[key],
          scope.background[bg],
          4.5,
        );
      }
    }
    // Borders are non-text UI boundaries — 3:1.
    for (const key of ["DEFAULT", "light"]) {
      for (const bg of BACKGROUND_KEYS) {
        add(
          `${theme}:border.${key} on background.${bg}`,
          scope.border[key],
          scope.background[bg],
          3.0,
        );
      }
    }
    // Status colours are rendered as text (badges, inline labels) — 4.5:1.
    for (const key of Object.keys(scope.semantic)) {
      for (const bg of ["DEFAULT", "card"] as const) {
        add(
          `${theme}:semantic.${key} on background.${bg}`,
          scope.semantic[key],
          scope.background[bg],
          4.5,
        );
      }
    }
    // Accent + primary carry links and headings — 4.5:1.
    // accent.muted is an rgba() wash, not a foreground: skipped by isHex.
    for (const group of ["accent", "primary"] as const) {
      for (const [key, value] of Object.entries(scope[group])) {
        if (!isHex(value)) continue;
        add(
          `${theme}:${group}.${key} on background.DEFAULT`,
          value,
          scope.background.DEFAULT,
          4.5,
        );
      }
    }
    // Chart series are non-text graphical objects — 3:1.
    for (const key of Object.keys(scope.chart)) {
      for (const bg of ["DEFAULT", "card"] as const) {
        add(
          `${theme}:chart.${key} on background.${bg}`,
          scope.chart[key],
          scope.background[bg],
          3.0,
        );
      }
    }
    // Court colours are also used as chart fills — 3:1.
    for (const key of Object.keys(scope.court)) {
      add(
        `${theme}:court.${key} on background.DEFAULT`,
        scope.court[key],
        scope.background.DEFAULT,
        3.0,
      );
    }
  }

  // CourtBadge renders `text-white` on the court colour as a background at
  // text-xs (normal size) — see src/components/shared/CourtBadge.tsx:39.
  //
  // BOTH themes, deliberately: the badge uses the Tailwind class `bg-court-*`,
  // which resolves --color-court-*, and tokens.css redefines every one of those
  // inside `.dark`. So a dark court value is a badge background too, not just a
  // chart fill. Checking only the light block (as an earlier draft did) is how a
  // dark court colour that is illegible under the hardcoded white label reaches
  // production unnoticed.
  for (const [theme, scope] of scopes) {
    for (const [key, value] of Object.entries(scope.court)) {
      add(`badge:${theme}:text.white on court.${key}`, "#ffffff", value, 4.5);
    }
  }

  return pairs;
}

describe("Group 3 – WCAG contrast compliance (full token matrix)", () => {
  const pairs = buildContrastPairs();

  it("covers every documented foreground/background combination", () => {
    // Guards the matrix itself: if a token group is renamed or dropped from
    // tokens.json the count moves and this fails before the other two tests
    // can pass vacuously.
    expect(pairs).toHaveLength(TOTAL_PAIRS);
    expect(new Set(pairs.map((p) => p.key)).size).toBe(TOTAL_PAIRS);
  });

  it("no unlisted token pair falls below its WCAG threshold", () => {
    const offenders = pairs
      .filter(
        (p) => !KNOWN_BELOW_THRESHOLD.includes(p.key) && p.ratio < p.threshold,
      )
      .map(
        (p) => `${p.key} = ${p.ratio.toFixed(2)}:1 (needs ${p.threshold}:1)`,
      );
    expect(
      offenders,
      `New low-contrast token pair(s). Fix the value in src/tokens/tokens.json and re-run \`npm run tokens\`. Only add a key to KNOWN_BELOW_THRESHOLD with a written reason.\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every KNOWN_BELOW_THRESHOLD entry is still failing (no stale exemptions)", () => {
    const byKey = new Map(pairs.map((p) => [p.key, p]));
    const stale: string[] = [];
    for (const key of KNOWN_BELOW_THRESHOLD) {
      const pair = byKey.get(key);
      if (!pair) {
        stale.push(`${key} — no such pair (token renamed or removed?)`);
        continue;
      }
      if (pair.ratio >= pair.threshold) {
        stale.push(
          `${key} — now ${pair.ratio.toFixed(2)}:1, passes ${pair.threshold}:1`,
        );
      }
    }
    expect(
      stale,
      `Delete these entries from KNOWN_BELOW_THRESHOLD — they no longer fail:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("semantic success/warning/danger/info are valid hex (format check)", () => {
    const semantic = tokensJSON.color.semantic as Record<string, string>;
    for (const [name, value] of Object.entries(semantic)) {
      expect(
        /^#[0-9a-fA-F]{6}$/.test(value),
        `semantic.${name} = "${value}" is not valid hex`,
      ).toBe(true);
    }
  });
});
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run __tests__/css-tokens.test.ts 2>&1 | tail -6
```

→ 0 failed. The file's test count moves by `−6 +4` relative to whatever it is
when you start (plan 025 does not change the count, so it should be 44 → 42);
report the before and after numbers rather than asserting an absolute.

If you get a failure listing offenders or stale entries, your
`KNOWN_BELOW_THRESHOLD` does not match the measurement from Step 3a. Re-run 3a
and paste again — **do not** hand-edit entries to make the test pass, and do not
touch `tokens.json` (out of scope; contrast values are plan 022's).

**Verify it bites** (do this, then undo it): delete one entry from
`KNOWN_BELOW_THRESHOLD` and re-run → the "no unlisted token pair falls below its
threshold" test fails naming that pair. Restore it. Then add a fabricated entry
(e.g. `"light:text.DEFAULT on background.card"`, which passes comfortably) and
re-run → the "no stale exemptions" test fails naming it. Remove it.

The old "more than five keys move → STOP" rule has been **deleted**. It was
written assuming this plan ran on the `42826a3` tokens; running after plan 022,
as it now must, moves well over twenty keys legitimately. Correctness comes from
re-measuring in Step 3a, not from a movement threshold.

Commit: `test: check the whole token contrast matrix instead of five pairs`

### Step 4: Add the repo-wide hardcoded-colour scan

Create `frontend/__tests__/a11y-hardcoded-colors.test.tsx` with exactly this
content. (The `.tsx` extension is deliberate — it keeps every new file in this
plan under one `a11y*.test.tsx` glob. The file contains no JSX, which is
legal.)

```tsx
/**
 * a11y-hardcoded-colors.test.tsx
 *
 * Repo-wide guard: no raw hex colour literals in application source.
 *
 * Every spacing/shadow/radius/colour value must come from
 * src/tokens/tokens.json, so that both themes and the WCAG contrast matrix in
 * __tests__/css-tokens.test.ts actually govern what ships. A raw `#2d7d46` in
 * a component is invisible to that matrix and does not flip in dark mode.
 *
 * __tests__/analytics-charts-tokens.test.tsx guards five specific analytics
 * components in more depth; this file guards the whole tree, shallowly.
 *
 * 30 files carry raw hex as of commit 42826a3 and are listed in
 * KNOWN_HEX_FILES. The list is enforced in both directions:
 *   * a file NOT on the list must have no hex   → no new debt
 *   * a file ON the list must still have hex    → no stale entries
 * When you migrate a file to tokens, DELETE its entry — the second test tells
 * you which ones to delete.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const FRONTEND_ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(FRONTEND_ROOT, "src");

/** Six-digit hex only, matching the convention in analytics-charts-tokens.test.tsx. */
const HEX_RE = /#[0-9a-fA-F]{6}\b/;

/** Permanent exemptions: these files ARE the palette. */
const EXEMPT_PREFIXES = ["src/tokens/"] as const;
const EXEMPT_FILES = ["src/hooks/use-theme-preset.ts"] as const;

/** Debt baseline at commit 42826a3. Shrink it; never grow it. */
const KNOWN_HEX_FILES: readonly string[] = [
  "src/components/analytics/ConceptCourtBreakdown.tsx",
  "src/components/analytics/ConceptTrendChart.tsx",
  "src/components/analytics/FlowSankeyChart.tsx",
  "src/components/analytics/MonthlyTrendsChart.tsx",
  "src/components/analytics/OutcomeByCourtChart.tsx",
  "src/components/analytics/OutcomeBySubclassChart.tsx",
  "src/components/analytics/OutcomeFunnelChart.tsx",
  "src/components/analytics/RiskGauge.tsx",
  "src/components/analytics/VisaFamiliesSection.tsx",
  "src/components/dashboard/CourtChart.tsx",
  "src/components/dashboard/CourtSparklineGrid.tsx",
  "src/components/dashboard/TrendChart.tsx",
  "src/components/judges/CountryOriginChart.tsx",
  "src/components/judges/JudgeCompareCard.tsx",
  "src/components/judges/NatureBreakdownChart.tsx",
  "src/components/judges/VisaBreakdownChart.tsx",
  "src/components/judges/constants.ts",
  "src/components/lineage/CourtVolumeTable.tsx",
  "src/components/lineage/LineageExplainer.tsx",
  "src/components/lineage/LineageFilters.tsx",
  "src/components/lineage/TimelineChart.tsx",
  "src/components/llm-council/AchievementToast.tsx",
  "src/components/llm-council/StreamingCouncilView.tsx",
  "src/components/shared/OutcomeStackedBar.tsx",
  "src/lib/council-celebrations.ts",
  "src/lib/court-events.ts",
  "src/pages/CourtLineagePage.tsx",
  "src/pages/DesignTokensPage.tsx",
  "src/pages/JudgeDetailPage.tsx",
  "src/pages/LlmCouncilPage.tsx",
];

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(absolute, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(path.relative(FRONTEND_ROOT, absolute).split(path.sep).join("/"));
    }
  }
  return acc;
}

/** Same comment-stripping as analytics-charts-tokens.test.tsx:58. */
function stripComments(source: string): string {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function hasHardcodedHex(relativePath: string): boolean {
  const source = fs.readFileSync(path.join(FRONTEND_ROOT, relativePath), "utf-8");
  return HEX_RE.test(stripComments(source));
}

function isExempt(relativePath: string): boolean {
  return (
    EXEMPT_PREFIXES.some((prefix) => relativePath.startsWith(prefix)) ||
    EXEMPT_FILES.includes(relativePath as (typeof EXEMPT_FILES)[number])
  );
}

const sourceFiles = listSourceFiles(SRC_DIR).toSorted();

describe("Hardcoded colour scan – src/ tree", () => {
  it("walks the whole source tree", () => {
    // A broken walker would make the next two tests pass vacuously.
    expect(sourceFiles.length).toBeGreaterThanOrEqual(150);
    for (const exempt of EXEMPT_FILES) {
      expect(sourceFiles, `${exempt} is exempt but was not found`).toContain(
        exempt,
      );
    }
  });

  it("no unlisted source file contains a raw hex colour", () => {
    const offenders = sourceFiles.filter(
      (file) =>
        !isExempt(file) &&
        !KNOWN_HEX_FILES.includes(file) &&
        hasHardcodedHex(file),
    );
    expect(
      offenders,
      `Raw hex colour literal(s) found. Use a token from src/tokens/tokens.json (import from "@/tokens/tokens" or a CSS var such as var(--color-chart-2)) instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every KNOWN_HEX_FILES entry still contains hex (no stale entries)", () => {
    const stale = KNOWN_HEX_FILES.filter(
      (file) => !sourceFiles.includes(file) || !hasHardcodedHex(file),
    );
    expect(
      stale,
      `Delete these entries from KNOWN_HEX_FILES — they are clean now (or gone):\n${stale.join("\n")}`,
    ).toEqual([]);
  });
});
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run __tests__/a11y-hardcoded-colors.test.tsx 2>&1 | tail -6
```

→ `Tests  3 passed (3)`.

If it reports offenders or stale entries, `src/` drifted since `42826a3`.
Update `KNOWN_HEX_FILES` to match the printed lists and note it in the commit
message. If more than five files move, that is a STOP condition.

Commit: `test: scan the whole src tree for hardcoded hex colours`

### Step 5: Add the axe-core component accessibility suite

Create `frontend/__tests__/a11y-components.test.tsx` with exactly this
content:

```tsx
/**
 * a11y-components.test.tsx
 *
 * Runs axe-core over the shared presentational components that appear on
 * nearly every page. Each test asserts the EXACT set of violation rule ids,
 * so a new violation fails and a fixed violation also fails (telling you to
 * delete the expectation). Baseline measured at commit 42826a3.
 *
 * Scope notes:
 *  * runOnly wcag2a + wcag2aa — axe "best-practice" rules (region,
 *    page-has-heading-one, ...) are page-level and meaningless for an
 *    isolated component render.
 *  * color-contrast is DISABLED: jsdom cannot rasterise text, so axe throws
 *    "Not implemented: HTMLCanvasElement.prototype.getContext" and reports
 *    the rule as "incomplete" rather than pass/fail. Token contrast is
 *    covered exhaustively by __tests__/css-tokens.test.ts instead.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import axe from "axe-core";
import { CourtBadge } from "@/components/shared/CourtBadge";
import { OutcomeBadge } from "@/components/shared/OutcomeBadge";
import { NatureBadge } from "@/components/shared/NatureBadge";
import { FilterPill } from "@/components/shared/FilterPill";
import { Pagination } from "@/components/shared/Pagination";
import { EmptyState } from "@/components/shared/EmptyState";

const AXE_OPTIONS: axe.RunOptions = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
  rules: { "color-contrast": { enabled: false } },
};

async function violationIds(container: HTMLElement): Promise<string[]> {
  const results = await axe.run(container, AXE_OPTIONS);
  return results.violations.map((violation) => violation.id).toSorted();
}

const COURTS = [
  "AATA",
  "ARTA",
  "FCA",
  "FCCA",
  "FedCFamC2G",
  "HCA",
  "RRTA",
  "MRTA",
  "FMCA",
];

describe("Shared component accessibility (axe-core, WCAG 2.1 A + AA)", () => {
  it("CourtBadge has no violations for any of the 9 courts", async () => {
    const { container } = render(
      <div>
        {COURTS.map((court) => (
          <CourtBadge key={court} court={court} />
        ))}
      </div>,
    );
    expect(await violationIds(container)).toEqual([]);
  });

  it("OutcomeBadge has no violations", async () => {
    const { container } = render(
      <div>
        <OutcomeBadge outcome="Decision under review affirmed" />
        <OutcomeBadge outcome="Decision under review set aside" />
      </div>,
    );
    expect(await violationIds(container)).toEqual([]);
  });

  it("NatureBadge has no violations", async () => {
    const { container } = render(
      <div>
        <NatureBadge nature="Protection visa" />
        <NatureBadge nature="Partner visa" />
      </div>,
    );
    expect(await violationIds(container)).toEqual([]);
  });

  it("Pagination has no violations", async () => {
    const { container } = render(
      <Pagination
        currentPage={3}
        totalPages={12}
        totalItems={240}
        pageSize={20}
        onPageChange={() => {}}
      />,
    );
    expect(await violationIds(container)).toEqual([]);
  });

  it("EmptyState has no violations", async () => {
    const { container } = render(
      <EmptyState
        title="No cases found"
        description="Try widening the date range or clearing a filter."
        action={<button type="button">Clear filters</button>}
      />,
    );
    expect(await violationIds(container)).toEqual([]);
  });

  it("FilterPill has no violations", async () => {
    // At commit 42826a3 this expected ["button-name"]: the remove control was
    // an icon-only <button> wrapping a lucide <X /> with no accessible name.
    // plans/023-fix-accessibility-semantics.md Step 7a added
    //   aria-label={`${removeLabel}: ${label}: ${value}`}
    // and 023 is a hard prerequisite of this plan, so the expectation is now [].
    // If this fails with ["button-name"], 023 has NOT landed — STOP rather than
    // re-pinning the old expectation, which would bake in a defect that is
    // already fixed and then fail the moment 023 arrives.
    const { container } = render(
      <FilterPill label="Court" value="AATA" onRemove={() => {}} />,
    );
    expect(await violationIds(container)).toEqual([]);
  });
});
```

Two notes on the import of `axe-core`, both verified against this repo's exact
compiler options:

- `import axe from "axe-core"` type-checks even though `axe-core` uses
  `export =`, because `moduleResolution: "bundler"` in
  `frontend/tsconfig.app.json` implies `allowSyntheticDefaultImports`. The
  `axe.RunOptions` type annotation is what makes `runOnly.type: "tag"`
  type-check — without it the string literal widens and TypeScript rejects it.
- If at runtime you get `axe.run is not a function`, replace the import with
  `const axe = (await import("axe-core")).default;` and keep everything else.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run __tests__/a11y-components.test.tsx 2>&1 | tail -8
```

→ `Tests  6 passed (6)`, and **no** `Not implemented: HTMLCanvasElement`
lines in the output (that string appearing means `color-contrast` was not
disabled).

If a test fails with a diff, read the reported ids. Adjust the expectation
array to the reported set **only** when you can name the defect in a comment
and can say which plan owns fixing it. In particular:

- `FilterPill` reporting `["button-name"]` means plan 023 has not landed →
  **STOP**, do not re-pin the old expectation.
- `Pagination` reporting anything means plan 023's Step 6 changed it in a way
  axe dislikes (it adds `role="status"` + `aria-live="polite"` and `flex-wrap`)
  → report the id; do not weaken the assertion.

More than four distinct violation ids across all six components is a STOP
condition — it means axe is misconfigured, not that six small components
suddenly broke.

**What this suite cannot see.** axe in jsdom has no layout and no rasteriser:
`color-contrast` is explicitly disabled above, and every rule that depends on
geometry (target size, focus visibility, reflow) is inert. So this file proves
*markup* accessibility for six components in isolation. It proves nothing about
focus order, keyboard traps, responsive overflow, or whether a colour is
actually readable on screen. `plans/023-fix-accessibility-semantics.md` hands
`plans/040-revive-the-e2e-suites.md` six browser scenarios covering exactly
those gaps; say in your report that they remain uncovered until 040 lands, so
"we added axe" is not read as "the app is accessible".

Commit: `test: add axe-core accessibility checks for shared components`

### Step 6: Verify the whole thing the way CI will

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
rm -rf node_modules && npm ci                       # proves the lockfile is CI-reproducible
npx tsc -b --noEmit                                 # the REAL typecheck (not `tsc --noEmit`)
npx eslint .; echo "eslint exit=$?"
npx vitest run
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run
```

Record the frontend baseline **before** you start editing (do it alongside the
drift check):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run 2>&1 | tail -5
#   FE_BEFORE      = "Tests  N passed"
#   FEFILES_BEFORE = "Test Files  N passed"
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run 2>&1 | tail -5
#   WK_BEFORE = "Tests  N passed"
```

**Verify**, in order:

- `npm ci` → exit 0, no `ERESOLVE`.
- `npx tsc -b --noEmit` → exit 0, no output.
- `npx eslint .` → `eslint exit=0`, i.e. **0 errors**. Do **not** assert a
  problem total: `✖ 44 problems` was the `42826a3` figure and every sibling
  plan moves it. The jsx-a11y identity check is Step 2b's job, and it is a real
  test rather than a one-shot eyeball.
- `npx vitest run` → 0 failed, and `Tests passed` ==
  `FE_BEFORE − 2 + 3 + 6 + 1` (−2 from rewriting `css-tokens.test.ts`'s Group 3,
  +3 `a11y-hardcoded-colors`, +6 `a11y-components`, +1 `a11y-lint-baseline`),
  with `Test Files passed` == `FEFILES_BEFORE + 3`. State the arithmetic in your
  report. If your own files ended up with different `it` counts, use those —
  the contract is that you can account for every test, not that you hit 497.
- The per-file check, which is the one that stays valid however many sibling
  plans land:
  `npx vitest run __tests__/css-tokens.test.ts __tests__/a11y-hardcoded-colors.test.tsx __tests__/a11y-components.test.tsx __tests__/a11y-lint-baseline.test.ts`
  → 4 files passed, 0 failed.
- Worker suite → 0 failed, `Tests passed` unchanged from `WK_BEFORE` (this plan
  does not touch `workers/`).

Commit (only if `npm ci` regenerated anything): `chore: refresh frontend lockfile`

## Test plan

New and changed tests, all under `frontend/__tests__/`:

**`css-tokens.test.ts` — Group 3 rewritten (6 tests → 4).** Model: the file's
own existing groups, which read token files once at module scope and assert
with the two-argument `expect(value, message)` form. Cases:

1. *Matrix shape* — `TOTAL_PAIRS` pairs (a number **measured** in Step 3a from
   the live `tokens.json`, not copied from this plan), all keys unique. Catches
   a token group being renamed or dropped, which would otherwise make the next
   two tests pass vacuously.
2. *No new debt* — every pair not in `KNOWN_BELOW_THRESHOLD` meets its
   threshold (4.5:1 for text, 3:1 for borders/charts). This is the regression
   gate for the passing majority, including `text.secondary` in both themes,
   **all eighteen `CourtBadge` white-on-colour combinations — nine light and
   nine dark**, every semantic status colour, and both themes'
   `accent.DEFAULT`. The dark half of the badge matrix is the addition that
   catches a dark court value chosen for chart legibility that is illegible
   under the badge's hardcoded white label.
3. *No stale exemptions* — every allowlisted key still fails. Forces the debt
   list to shrink when a token is fixed. Expect this test to do real work the
   first time it runs after plan 022: over twenty `42826a3`-era entries are
   fixed by that plan and must be deleted.
4. *Format check* — kept verbatim from the old Group 3.

Both directions are rehearsed once (Step 3's "Verify it bites") so the file is
known to be able to fail.

**`a11y-hardcoded-colors.test.tsx` — new (3 tests).** Model: the source-scan
style of `analytics-charts-tokens.test.tsx` Group 1, including its exact
comment-stripping regexes. Cases: walker sanity (≥150 files found, exempt
files present); no unlisted file contains 6-digit hex; no stale
`KNOWN_HEX_FILES` entry.

**`a11y-components.test.tsx` — new (6 tests).** Model:
`analytics-charts-tokens.test.tsx` Group 4 (render-level smoke tests with
`@testing-library/react`). One test per shared component: `CourtBadge` (all
nine courts), `OutcomeBadge`, `NatureBadge`, `Pagination`, `EmptyState`, and
`FilterPill` — **all six expecting `[]`**, since plan 023 (a prerequisite) fixed
the `button-name` defect the `42826a3` draft pinned.

No new mocks are needed: `__tests__/legislations-setup.ts` already supplies
`ResizeObserver`, `IntersectionObserver`, `localStorage`, `window.scrollTo`
and the `react-i18next` mock globally, and none of the six components needs a
Router or a QueryClient.

**`a11y-lint-baseline.test.ts` — new (1 test).** Runs ESLint over the frontend
tree via its Node API and asserts the exact `{file, rule}` set of jsx-a11y
results. This is the only thing that can catch (a) a second violation of an
already-pinned rule in an already-pinned file, and (b) a stale override left
behind after someone fixes a violation — neither of which the `warn` overrides
in `eslint.config.js` can detect on their own. Slow (~15–30s), hence its own
file and a 60s timeout.

**What none of this covers.** Every test here runs in jsdom or reads source
text. axe's `color-contrast` rule is disabled because jsdom cannot rasterise,
and nothing here exercises focus order, keyboard traps, responsive overflow or
real rendering. Those belong to `plans/040-revive-the-e2e-suites.md`; plan 023
hands it six concrete scenarios. Report that gap rather than presenting this
plan as closing the accessibility findings.

Verification: `npx vitest run` → 0 failures, with every test accounted for
against the `FE_BEFORE` baseline (see Step 6).

## Done criteria

Machine-checkable. ALL must hold, run from
`/Users/d/Developer/Active Projects/IMMI-Case-/frontend` unless noted:

- [ ] `npm ci` exits 0 (no `ERESOLVE`, no `--legacy-peer-deps`, no `--force`)
- [ ] `node -e "const p=require('./package.json');process.exit(p.devDependencies['axe-core']&&p.devDependencies['eslint-plugin-jsx-a11y']&&p.overrides?0:1)"` exits 0
- [ ] `grep -c "jsx-a11y" eslint.config.js` returns the import + the `extends`
      entry + one line per baseline block you measured in Step 2 — state the
      number and where it comes from, do not assert a figure from this plan
- [ ] `npx eslint .` exits 0 (**0 errors**). Do **not** assert a problem total —
      sibling plans move both the pre-existing and the jsx-a11y warning counts
- [ ] `npx eslint . --format json` contains **zero** messages with
      `severity: 2` and a `ruleId` starting `jsx-a11y/`
- [ ] `npx tsc -b --noEmit` exits 0
- [ ] `npx vitest run __tests__/css-tokens.test.ts` → 0 failed, and its test
      count is exactly 2 lower than the count you recorded before Step 3
      (6 Group-3 tests removed, 4 added)
- [ ] `npx vitest run __tests__/a11y-hardcoded-colors.test.tsx` → 3 passed
- [ ] `npx vitest run __tests__/a11y-components.test.tsx` → 6 passed
- [ ] `npx vitest run __tests__/a11y-lint-baseline.test.ts` → 1 passed
- [ ] Step 2b's two deliberate-failure rehearsals were performed: a duplicated
      same-rule violation produced `NEW jsx-a11y violations`, and a fabricated
      `BASELINE` entry produced `STALE baseline entries`
- [ ] Step 3's two deliberate-failure rehearsals were performed: deleting a
      `KNOWN_BELOW_THRESHOLD` entry failed the "no unlisted pair" test, and
      adding a passing pair failed the "no stale exemptions" test
- [ ] `npx vitest run` → 0 failed, with the total accounted for as
      `FE_BEFORE − 2 + 3 + 6 + 1`
- [ ] `cd ../workers && npx vitest run` → 0 failed, count unchanged from
      `WK_BEFORE`
- [ ] `git status --porcelain` lists only: `frontend/package.json`,
      `frontend/package-lock.json`, `frontend/eslint.config.js`,
      `frontend/__tests__/css-tokens.test.ts`,
      `frontend/__tests__/a11y-components.test.tsx`,
      `frontend/__tests__/a11y-hardcoded-colors.test.tsx`,
      `frontend/__tests__/a11y-lint-baseline.test.ts`, plus the pre-existing
      `.claude/STATE.md`
- [ ] `git diff --stat -- frontend/src` and
      `git diff --cached --stat -- frontend/src` are both empty (this plan
      modified no `src/` file — note the commit-range form cannot show this,
      because plans 022/023/025 legitimately changed `src/` before you ran)
- [ ] `plans/README.md` is **unchanged** — the integration owner maintains it

## STOP conditions

Stop and report back (do not improvise) if:

- `npm install` still fails with `ERESOLVE` after the `overrides` block is in
  place. Do **not** fall back to `--legacy-peer-deps` or `--force`: CI runs
  `npm ci`, and a lockfile built that way is not reliably reproducible. Report
  the npm and eslint versions you observed.
- Any of the three prerequisite probes in the drift check fails:
  `grep -c -- '--color-on-solid' frontend/src/tokens/tokens.css` ≠ 2 (plan 022
  has not landed), `grep -c 'aria-label' frontend/src/components/shared/FilterPill.tsx`
  ≠ 1 (plan 023 has not landed), or
  `grep -c 'from "@/lib/color"' frontend/__tests__/css-tokens.test.ts` ≠ 1 (plan
  025 has not landed). This plan freezes measurements; running it before those
  three land bakes in a baseline that is wrong on arrival.
- Step 2's JSON check reports **any** `jsx-a11y` message at severity 2 after
  your measured baseline block is in place. Fixing it requires editing
  `frontend/src/**`, which is out of scope, and widening the baseline would
  defeat the gate. Report the file, line and rule id.
- Step 2b's rehearsals do not fail the test. A baseline snapshot that cannot go
  red is worse than none — it advertises a gate that does not exist.
- Step 3a's measurement script errors (most likely a `KeyError` on a token group
  that was renamed). Report the traceback; do not guess a substitute path.
- Step 4 reports more than five files moving in or out of `KNOWN_HEX_FILES`.
  (Note the analogous rule for Step 3 has been **deleted** — after plan 022 far
  more than five contrast keys move, legitimately, which is why Step 3 now
  re-measures instead of comparing against a frozen list.)
- Step 5 reports more than four distinct axe violation ids across the six
  components, or the output contains
  `Not implemented: HTMLCanvasElement.prototype.getContext` (the
  `color-contrast: { enabled: false }` option did not take effect).
- `npx tsc -b --noEmit` reports `Property 'toSorted' does not exist on type
  'string[]'`. That means the tsconfig project covering `__tests__/` does not
  inherit `"lib": ["ES2023", ...]` from `frontend/tsconfig.app.json`. Fixing
  that file belongs to plan 001, not here.
- The fix for anything appears to require touching a file under
  `frontend/src/`, `frontend/vitest.config.ts`, `frontend/tsconfig*.json`,
  `Makefile` or `.github/workflows/ci.yml`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

For whoever owns this next:

- **`KNOWN_BELOW_THRESHOLD` is the app's real accessibility debt ledger**, and
  after plan 022 it is a much shorter one. The three clusters that dominated it
  at `42826a3` — dark `border.DEFAULT` at 2.22:1, `text.muted` below AA in both
  themes on every surface, and light `chart.3`/`chart.5` under 3:1 — are all
  fixed by 022. What is expected to *remain*, and is therefore what the ledger
  is actually for, is the debt 022 explicitly deferred:
  `border.light` in both themes (decorative dividers, exempt from 1.4.11 by
  intent — 022's Maintenance notes explain the reasoning), `accent.light` in
  light mode (a documented decorative gold, never body text), and
  `badge:*:text.white on court.FCCA`, which fails in both themes because
  `CourtBadge.tsx:39` hardcodes `text-white` and `#b9770e` is 3.68:1 against it.
  Fixing any of these means editing `frontend/src/tokens/tokens.json`, running
  `npm run tokens` to regenerate `tokens.css`/`tokens.ts`, and deleting the
  corresponding keys — the "no stale exemptions" test names them for you.
- **The biggest contrast failures are not in this ledger at all**, because they
  are not token values: 51 `bg-accent text-white` call sites and 14
  `hover:bg-accent-light` sites measure 1.81–3.19:1 in dark mode, and eight
  chart call sites read a light-only `getCourtColor()`. Plan 022 documents both
  under "What is still broken after this plan". A green run of this plan's
  gates does **not** mean the app passes AA. Nothing here can see a call site.
- **The `jsx-a11y` baseline warnings are not all real.** Eight
  `heading-has-content` hits plus one `anchor-has-content` are false positives
  from react-markdown component overrides (`h1: (p) => <h1 ... {...p} />`), and
  the five `no-redundant-roles` hits on `<ul role="list">` in `DataToolsPage`
  are a deliberate Safari/VoiceOver workaround. Those thirteen should be
  closed with a targeted `eslint-disable-next-line` plus a reason, not by
  changing markup. The other six — `no-autofocus`, two interaction rules,
  `no-noninteractive-tabindex`, `role-supports-aria-props` — are worth fixing
  properly.
- **What a reviewer should scrutinise**: that no allowlist *grew*. A diff that
  adds a key to `KNOWN_BELOW_THRESHOLD`, a file to `KNOWN_HEX_FILES`, or an
  entry to `BASELINE` in `a11y-lint-baseline.test.ts` is the failure mode this
  plan exists to prevent. Each such addition needs a written reason in the same
  diff. Also check that the `eslint.config.js` `warn` overrides and the
  `BASELINE` array in the test agree with each other — they are two views of the
  same list and only the test can notice when they diverge.
- **Deferred: the E2E half — and it is the larger half.** Everything here runs
  in jsdom or scans source text. axe's `color-contrast` rule is disabled
  (jsdom cannot rasterise), and nothing exercises focus order, keyboard traps,
  focus restoration, responsive overflow at 320px, or real rendering.
  `plans/023-fix-accessibility-semantics.md` hands
  `plans/040-revive-the-e2e-suites.md` six concrete browser scenarios covering
  exactly those gaps. Until 040 lands, this repo's accessibility gates check
  markup and token arithmetic, nothing more — and any report that says
  otherwise is overstating what shipped.
- **Deferred: 3- and 8-digit hex.** The scan matches `#rrggbb` only. Five
  files contain 3-digit hex (`#fff`, `#ccc`) and two contain 8-digit hex; the
  8-digit ones are already caught because those files also carry 6-digit hex.
  Widening the regex means re-measuring the baseline.
- **Considered and rejected: a repo-wide Recharts `Tooltip` `contentStyle`
  scan.** Only one file in `src/` references `<Tooltip` —
  `src/components/shared/ChartTooltip.tsx`, the shared wrapper, which injects
  `color: "var(--color-text)"` at line 17. The dark-mode-invisible-tooltip
  class of bug is already solved structurally, so a scan would be near-vacuous.
  If someone reintroduces a direct `import { Tooltip } from "recharts"` in a
  component, revisit this.

## Findings reconsidered

The finding this plan addresses (FEUX-09, "nothing in lint, unit tests, or E2E
can catch any contrast or a11y finding") is **confirmed** and fully addressed
for lint and unit tests. Corrections to the supporting evidence, and the one
part deliberately not done:

- **`frontend/package.json:53` → `:48`.** The audit cited line 53 for the
  missing a11y dependencies; line 53 is `"@testing-library/react"`.
  `devDependencies` opens at line **48**. The substance is unchanged: no
  `axe-core`, `vitest-axe`, `@axe-core/playwright` or `eslint-plugin-jsx-a11y`
  anywhere in the file.
- **"Group 3 tests precisely four pairs" → six `it` blocks, five ratios.**
  `css-tokens.test.ts:159-216` has six tests; five compute a contrast ratio and
  one is a hex-format check. The audit's point stands and is if anything
  understated: one of those five (`accent.light`, line 187) asserts the ratio
  is *below* 4.5, recording a failure as acceptable rather than gating it.
- **"analytics-charts-tokens.test.tsx hand-enumerates four files" → five.**
  `OutcomeTrendChart`, `ConceptEffectivenessChart`, `LegalConceptsChart`,
  `FlowSankeyChart` and `TopJudgesChart`. The coverage ratio the audit gives is
  right in spirit: 27 `.tsx` files under `src/` contain hex (32 files when
  `.ts` is included and comments are stripped), so the guard reaches roughly a
  sixth of its subject.
- **`color.dark` does contain `court` and `overlay` keys.** The comment at
  `css-tokens.test.ts:90-91` lists seven expected dark keys and omits both; it
  is only harmless because the assertion uses `toContain`. Step 3's matrix
  relies on `color.dark.court` existing — verified present with all nine
  courts.
- **Deferred, not rejected: `@axe-core/playwright` in E2E, and a 320px
  overflow test.** Three verified reasons, all of which make it a poor fit for
  *this* plan:
  1. **No CI job runs Playwright at all.** `.github/workflows/ci.yml` has three
     jobs (`test-python`, `test-frontend`, `test-worker`) and none of them
     invokes `playwright test` or `pytest tests/e2e`. An axe assertion added
     there would gate nothing until an E2E job exists.
  2. **There are two different E2E stacks and the Node package only fits one.**
     `frontend/e2e/*.spec.ts` is Node Playwright (where `@axe-core/playwright`
     applies); `tests/e2e/react/*.py` is pytest-playwright (which would need
     `axe-playwright-python` instead). The audit's fix sketch names only the
     Node package.
  3. **`frontend/playwright.config.ts` boots the Flask dev server**
     (`webServer.command` runs `python web.py --port 8080 --backend sqlite`),
     which per `CLAUDE.md` is local-dev-only and not the production request
     path. Any E2E a11y work needs that dependency thought through first.
  The gap itself is real and confirmed: `grep -rn "scrollWidth" tests/e2e/`
  returns nothing, and the smallest viewport in the suite is the 390×844
  `react_mobile` fixture (`tests/e2e/react/test_react_responsive.py:77-99`),
  so a 320px overflow can ship undetected. A follow-up plan owning
  `frontend/e2e/**` + `.github/workflows/ci.yml` should pick this up.

## Review points not applied

One reviewer sub-claim does not hold against the plan text as written. The
*concern* behind it was real and has been applied in full (Step 2b), but the
specific accusation is recorded here as refuted so nobody "fixes" a correct
sentence.

- **"The plan says a new violation will fail and a stale entry will fail; both
  are wrong."** Two separate mechanisms were conflated.

  1. **The jsx-a11y config baseline.** What Step 2 claimed at `42826a3` was
     narrower than the reviewer read it: the comment says the files are pinned
     "per file, per rule, so that a **different** violation appearing in the
     same file still fails the build". That is accurate — an override is
     `{ files: [...], rules: { 'jsx-a11y/<one-rule>': 'warn' } }`, so any *other*
     jsx-a11y rule in that same file is still `error`. The plan never asserted
     that a *second violation of the same rule* would fail, nor that a stale
     override would fail. So the sentence quoted is not a false claim.
  2. **The contrast allowlist.** The "a listed entry that no longer offends also
     fails the build" claim belongs to Step 3, not to the lint baseline, and
     there it is **true and enforced** by the dedicated
     `every KNOWN_BELOW_THRESHOLD entry is still failing (no stale exemptions)`
     test, which iterates the list and reports any pair that now passes.

  Where the reviewer was right, and what changed: the *config alone* genuinely
  cannot detect (a) a repeat violation of an already-pinned rule in an
  already-pinned file or (b) a stale override after a fix, and the plan's
  one-shot `warnings: 19` verification was execution-time only, not a durable
  gate. Step 2b now closes both with
  `frontend/__tests__/a11y-lint-baseline.test.ts`, an ESLint-Node-API test that
  compares the exact `{file, rule}` set and fails in both directions, with two
  mandatory deliberate-failure rehearsals.

  The reviewer's alternative — per-line `eslint-disable-next-line` with a reason
  — was **not** adopted, on scope grounds that are structural rather than
  stylistic: it requires editing the seven `src/` files, and
  `frontend/src/**` is this plan's hard out-of-scope boundary precisely because
  plans 020, 022, 023 and 025 are editing files in that tree. It remains the
  better end state for the thirteen false-positive warnings (react-markdown
  overrides and the deliberate `<ul role="list">` Safari workaround) and is
  already recorded as such in Maintenance notes.
