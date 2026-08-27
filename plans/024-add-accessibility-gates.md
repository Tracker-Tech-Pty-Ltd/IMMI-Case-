# Plan 024: Make lint and tests able to catch contrast and a11y regressions

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index, or the file does not exist (at the time of writing it
> does not, so skip it).
>
> **Drift check (run first)**:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> git diff --stat 42826a3..HEAD -- \
>   frontend/eslint.config.js \
>   frontend/package.json \
>   frontend/package-lock.json \
>   frontend/__tests__/css-tokens.test.ts \
>   frontend/__tests__/a11y-components.test.tsx \
>   frontend/__tests__/a11y-hardcoded-colors.test.tsx
> ```
>
> Expected: `frontend/package.json` and `frontend/package-lock.json` **may**
> appear (plan 001 adds one devDependency to them). Everything else must be
> **absent**. If `frontend/eslint.config.js` or
> `frontend/__tests__/css-tokens.test.ts` is listed, compare the "Current
> state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> This plan also reads — but never modifies — `frontend/src/**` and
> `frontend/src/tokens/tokens.json`. Three of its steps encode a *baseline*
> measured from those files at commit `42826a3`. Each step tells you exactly
> what to do if the live measurement differs from the recorded baseline.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md`
- **Category**: tests
- **Planned at**: commit `42826a3`, 2026-08-27

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
pairs out of a possible 119 and one of those five *documents* a sub-AA ratio
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

This plan installs three gates and, just as importantly, **writes down the
debt that already exists** as three explicit, self-shrinking allowlists: 39
below-threshold token pairs, 30 files with raw hex, 7 files with `jsx-a11y`
violations. Each allowlist is enforced in both directions — an unlisted
offender fails the build, and a *listed* entry that no longer offends also
fails the build, so the lists can only shrink. After this lands, 80 of the 119
token contrast pairs, 137 of the 167 source files, and 162 of the 169 source
files respectively are locked against regression.

## Current state

### Files this plan changes

- `frontend/eslint.config.js` — 31 lines, flat config. Loads
  `js.recommended`, `typescript-eslint`, `react-hooks`, `react-refresh`. No
  accessibility plugin.
- `frontend/package.json` — 71 lines. `devDependencies` begins at line 48 and
  contains no `axe-core`, no `vitest-axe`, no `@axe-core/playwright`, no
  `eslint-plugin-jsx-a11y`.
- `frontend/__tests__/css-tokens.test.ts` — 512 lines, 44 tests in 8 groups.
  Group 3 (lines 156–216) is the entire contrast surface.
- `frontend/__tests__/a11y-components.test.tsx` — **create**.
- `frontend/__tests__/a11y-hardcoded-colors.test.tsx` — **create**.

### Files this plan reads but must never modify

- `frontend/src/tokens/tokens.json` — the design tokens. All 119 contrast
  pairs are computed from it.
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
| Whole frontend suite | `npx vitest run` | all pass (490 tests at `42826a3`) |
| Whole repo suite (from repo root) | `make test` | Python + frontend + worker suites pass |

Note: `npx tsc --noEmit` (no `-b`) compiles **zero files** at `42826a3` and is
worthless as a check — plan 001 fixes the `Makefile`/CI invocation. Always use
`npx tsc -b --noEmit` here.

`make test-py` reports `1141 passed, 3 failed, 7 skipped` on this machine. The
3 failures are environmental (Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI
mismatch breaking the `pypdf` import in
`tests/test_backfill_judge_overrides_from_pdf.py`). They are unrelated to this
plan. Do not try to fix them and do not treat them as a regression.

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

**Out of scope** (do NOT touch, even though they look related):

- **Anything under `frontend/src/`.** This is the hard boundary of this plan.
  Three baselines here record real defects in `src/` files; recording them is
  the deliverable. Fixing them is a different plan with a different file
  territory, and editing `src/` here would collide with plans running in
  parallel.
- `frontend/src/tokens/tokens.json` in particular — 39 token pairs are below
  their WCAG threshold. Changing a token value shifts the whole palette and is
  a design decision, not a test decision.
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

- Branch: `advisor/024-add-accessibility-gates`, cut from `main` (or from the
  branch where plan 001 landed, if it has not been merged yet).
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

→ `Tests  490 passed (490)` (or whatever total plan 001 left behind — the
point is that the number did not drop and there are 0 failures).

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

The preset sets its rules to severity `error`. Nineteen violations exist in
seven `src/` files at `42826a3`, and `src/` is out of scope for this plan, so
those seven files are pinned to `warn` — per file, per rule, so that a
*different* violation appearing in the same file still fails the build:

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

**Verify** (exit code and totals):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx eslint . > /tmp/eslint-024.txt 2>&1; echo "exit=$?"; tail -3 /tmp/eslint-024.txt
```

(Written without a pipe on purpose: `$PIPESTATUS` is bash-only and 0-indexed,
while this repo's default shell is zsh where the equivalent is `$pipestatus`
and 1-indexed. Redirecting to a file avoids the difference entirely.)

→ `exit=0` and the last lines contain
`✖ 44 problems (0 errors, 44 warnings)`.
(25 pre-existing warnings + 19 newly-visible jsx-a11y warnings.)

**Verify** (the gate is actually armed, and nothing outside the baseline
errors):

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

→ exactly `jsx-a11y errors: 0 warnings: 19` and no `ERR` lines.

If it prints a non-zero error count, the tree drifted since `42826a3`: a new
`src/` file introduced a violation. **Do not fix it in `src/` and do not widen
the baseline** — that is a STOP condition.

Commit: `test: gate frontend lint on jsx-a11y with an explicit baseline`

### Step 3: Replace the 5-pair contrast spot-check with the full 119-pair matrix

In `frontend/__tests__/css-tokens.test.ts`, delete lines 156–216 (the whole
Group 3 banner + `describe` block quoted verbatim in "Current state", from the
`// ═══` banner down to and including its closing `});`) and put this in its
place. Do not touch any other group, and do not redefine `getLuminance` /
`getContrastRatio` — they already exist at lines 13–30.

```ts
// ══════════════════════════════════════════════════════════════════════
// Group 3: WCAG contrast compliance — full token matrix
// ══════════════════════════════════════════════════════════════════════
//
// Every foreground token is checked against every background token it can
// realistically sit on, in BOTH themes: 119 pairs.
//
// Thresholds (WCAG 2.1):
//   4.5:1  normal-size text          — SC 1.4.3 Contrast (Minimum)
//   3.0:1  UI components & graphics  — SC 1.4.11 Non-text Contrast
//
// 39 pairs are below threshold as of commit 42826a3. They are listed in
// KNOWN_BELOW_THRESHOLD so that the other 80 are locked against regression.
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
  // text-xs (normal size) — see src/components/shared/CourtBadge.tsx.
  const courts = tokensJSON.color.court as Record<string, string>;
  for (const [key, value] of Object.entries(courts)) {
    add(`badge:text.white on court.${key}`, "#ffffff", value, 4.5);
  }

  return pairs;
}

describe("Group 3 – WCAG contrast compliance (full token matrix)", () => {
  const pairs = buildContrastPairs();

  it("covers all 119 documented foreground/background combinations", () => {
    // Guards the matrix itself: if a token group is renamed or dropped from
    // tokens.json the count moves and this fails before the other two tests
    // can pass vacuously.
    expect(pairs).toHaveLength(119);
    expect(new Set(pairs.map((p) => p.key)).size).toBe(119);
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

→ `Tests  42 passed (42)` (was 44: six Group 3 tests removed, four added).

If instead you get a failure listing offenders or stale entries, the tokens
drifted since `42826a3`. Correct the constant to match reality — add newly
failing keys with the measured ratio in the trailing comment, delete keys the
test reports as stale — and say so in the commit message. If more than five
keys move, that is a STOP condition: someone re-themed the app and this plan's
premises need re-checking.

Commit: `test: check all 119 token contrast pairs instead of five`

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

  it("FilterPill still has exactly one known violation: button-name", async () => {
    // KNOWN DEFECT (commit 42826a3): the remove control in
    // src/components/shared/FilterPill.tsx is an icon-only <button> wrapping
    // a lucide <X /> with no accessible name, so screen-reader users hear
    // only "button". Fix by adding
    //   aria-label={t("filters.remove", { defaultValue: `Remove ${label} filter` })}
    // to that button — then change this expectation to `[]`.
    // Fixing src/ is out of scope for the plan that created this file.
    const { container } = render(
      <FilterPill label="Court" value="AATA" onRemove={() => {}} />,
    );
    expect(await violationIds(container)).toEqual(["button-name"]);
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
the way the `FilterPill` test does. More than four distinct violation ids
across all six components is a STOP condition — it means axe is misconfigured,
not that six small components suddenly broke.

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

**Verify**, in order:

- `npm ci` → exit 0, no `ERESOLVE`.
- `npx tsc -b --noEmit` → exit 0, no output.
- `npx eslint .` → `✖ 44 problems (0 errors, 44 warnings)`, `eslint exit=0`.
- `npx vitest run` → 0 failed. Total should be **497** (490 at `42826a3`, −2
  in `css-tokens.test.ts`, +3 in `a11y-hardcoded-colors.test.tsx`, +6 in
  `a11y-components.test.tsx`). A different total is acceptable **only** if
  plan 001 changed the baseline; in that case confirm the per-file counts
  instead: `npx vitest run __tests__/css-tokens.test.ts __tests__/a11y-hardcoded-colors.test.tsx __tests__/a11y-components.test.tsx`
  → `Tests  51 passed (51)` (42 + 3 + 6).
- Worker suite → `345 passed` (unchanged; this plan does not touch `workers/`).

Commit (only if `npm ci` regenerated anything): `chore: refresh frontend lockfile`

## Test plan

New and changed tests, all under `frontend/__tests__/`:

**`css-tokens.test.ts` — Group 3 rewritten (6 tests → 4).** Model: the file's
own existing groups, which read token files once at module scope and assert
with the two-argument `expect(value, message)` form. Cases:

1. *Matrix shape* — 119 pairs, all keys unique. Catches a token group being
   renamed or dropped, which would otherwise make the next two tests pass
   vacuously.
2. *No new debt* — every pair not in `KNOWN_BELOW_THRESHOLD` meets its
   threshold (4.5:1 for text, 3:1 for borders/charts). This is the regression
   gate for the 80 currently-passing pairs, including `text.secondary` in both
   themes, all nine `CourtBadge` white-on-colour combinations, every semantic
   status colour, and both themes' `accent.DEFAULT`.
3. *No stale exemptions* — every allowlisted key still fails. Forces the debt
   list to shrink when a token is fixed.
4. *Format check* — kept verbatim from the old Group 3.

**`a11y-hardcoded-colors.test.tsx` — new (3 tests).** Model: the source-scan
style of `analytics-charts-tokens.test.tsx` Group 1, including its exact
comment-stripping regexes. Cases: walker sanity (≥150 files found, exempt
files present); no unlisted file contains 6-digit hex; no stale
`KNOWN_HEX_FILES` entry.

**`a11y-components.test.tsx` — new (6 tests).** Model:
`analytics-charts-tokens.test.tsx` Group 4 (render-level smoke tests with
`@testing-library/react`). One test per shared component: `CourtBadge` (all
nine courts), `OutcomeBadge`, `NatureBadge`, `Pagination`, `EmptyState`
(happy paths, expected `[]`), and `FilterPill` (the one known
`button-name` defect, expected `["button-name"]`).

No new mocks are needed: `__tests__/legislations-setup.ts` already supplies
`ResizeObserver`, `IntersectionObserver`, `localStorage`, `window.scrollTo`
and the `react-i18next` mock globally, and none of the six components needs a
Router or a QueryClient.

Verification: `npx vitest run` → 0 failures; the three files together report
51 passing tests.

## Done criteria

Machine-checkable. ALL must hold, run from
`/Users/d/Developer/Active Projects/IMMI-Case-/frontend` unless noted:

- [ ] `npm ci` exits 0 (no `ERESOLVE`, no `--legacy-peer-deps`, no `--force`)
- [ ] `node -e "const p=require('./package.json');process.exit(p.devDependencies['axe-core']&&p.devDependencies['eslint-plugin-jsx-a11y']&&p.overrides?0:1)"` exits 0
- [ ] `grep -c "jsx-a11y" eslint.config.js` returns a value ≥ 9 (the import,
      the `extends` entry, and the 7 baseline blocks)
- [ ] `npx eslint .` exits 0 and its summary line reads
      `✖ 44 problems (0 errors, 44 warnings)`
- [ ] `npx eslint . --format json` contains **zero** messages with
      `severity: 2` and a `ruleId` starting `jsx-a11y/`
- [ ] `npx tsc -b --noEmit` exits 0
- [ ] `npx vitest run __tests__/css-tokens.test.ts` → 42 passed
- [ ] `npx vitest run __tests__/a11y-hardcoded-colors.test.tsx` → 3 passed
- [ ] `npx vitest run __tests__/a11y-components.test.tsx` → 6 passed
- [ ] `npx vitest run` → 0 failed
- [ ] `cd ../workers && npx vitest run` → 345 passed (unchanged)
- [ ] `git status --porcelain` lists only: `frontend/package.json`,
      `frontend/package-lock.json`, `frontend/eslint.config.js`,
      `frontend/__tests__/css-tokens.test.ts`,
      `frontend/__tests__/a11y-components.test.tsx`,
      `frontend/__tests__/a11y-hardcoded-colors.test.tsx`, plus the
      pre-existing `.claude/STATE.md`
- [ ] `git diff --stat 42826a3..HEAD -- frontend/src` is empty (no `src/` file
      was modified)

## STOP conditions

Stop and report back (do not improvise) if:

- `npm install` still fails with `ERESOLVE` after the `overrides` block is in
  place. Do **not** fall back to `--legacy-peer-deps` or `--force`: CI runs
  `npm ci`, and a lockfile built that way is not reliably reproducible. Report
  the npm and eslint versions you observed.
- Step 2's JSON check reports **any** `jsx-a11y` message at severity 2. That
  means a `src/` file gained a violation after `42826a3`. Fixing it requires
  editing `frontend/src/**`, which is out of scope for this plan, and widening
  the baseline block would defeat the gate. Report the file, line and rule id.
- Step 3 reports more than five contrast keys moving (new offenders + stale
  entries combined). The palette was re-themed and this plan's 39-entry
  baseline was written against a palette that no longer exists.
- Step 4 reports more than five files moving in or out of `KNOWN_HEX_FILES`.
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

- **The 39-entry `KNOWN_BELOW_THRESHOLD` list is the app's real accessibility
  debt ledger.** The three worst clusters, in priority order:
  1. `border.DEFAULT` in **dark mode** is `#4a5060` on `#111820` — 2.22:1,
     below the 3:1 required for UI boundaries, and it fails against all five
     dark surfaces. Every card outline and table rule in dark mode is
     effectively invisible. One token change fixes ten entries.
  2. `text.muted` is below AA in **both** themes on **every** surface (2.84 –
     3.95:1). It is used for timestamps, counts and helper text — exactly the
     secondary information a self-representing applicant needs.
  3. Light-mode `chart.3` (`#10b981`) and `chart.5` (`#f59e0b`) are 1.95 –
     2.54:1 against the warm off-white background, below the 3:1 required for
     graphical objects.
  Fixing any of these means editing `frontend/src/tokens/tokens.json`, running
  `npm run tokens` to regenerate `tokens.css`/`tokens.ts`, and deleting the
  corresponding keys — the "no stale exemptions" test names them for you.
- **The 19 `jsx-a11y` baseline warnings are not all real.** Eight
  `heading-has-content` hits plus one `anchor-has-content` are false positives
  from react-markdown component overrides (`h1: (p) => <h1 ... {...p} />`), and
  the five `no-redundant-roles` hits on `<ul role="list">` in `DataToolsPage`
  are a deliberate Safari/VoiceOver workaround. Those thirteen should be
  closed with a targeted `eslint-disable-next-line` plus a reason, not by
  changing markup. The other six — `no-autofocus`, two interaction rules,
  `no-noninteractive-tabindex`, `role-supports-aria-props` — are worth fixing
  properly.
- **What a reviewer should scrutinise**: that no allowlist *grew*. A diff that
  adds a key to `KNOWN_BELOW_THRESHOLD`, a file to `KNOWN_HEX_FILES`, or a
  block to the `eslint.config.js` baseline is the failure mode this plan
  exists to prevent. Each such addition needs a written reason in the same
  diff.
- **Deferred: the E2E half.** Adding axe and a 320px no-horizontal-overflow
  check to end-to-end flows was considered and deliberately left out — see
  "Findings reconsidered" for why, and what a follow-up plan would need to
  cover.
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
