# Plan 021: Ship the decided Legal Codex palette instead of migrating users off it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. **Do NOT edit `plans/README.md`.** That index is
> maintained by the integration owner; several plans run in parallel and a
> shared status file is a guaranteed conflict. Report your status instead.
>
> **Drift check (run first)**. A commit-range diff cannot see uncommitted,
> staged or untracked work, so run all four commands:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> P="frontend/src/hooks/use-theme-preset.ts frontend/__tests__/theme-preset.test.ts"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $P    # committed since the plan was written
> git diff --stat -- $P                  # unstaged
> git diff --cached --stat -- $P         # staged
> ```
> Expected: the last three print nothing, and `git status --short` lists no
> in-scope path. If either file appears in **any** of them, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> Also check the read-only reference files this plan depends on — their drift
> invalidates the hex values in Step 1 and Step 2:
> ```bash
> R="frontend/src/tokens/tokens.json frontend/src/tokens/tokens.css frontend/src/pages/DesignTokensPage.tsx"
> git diff --stat 42826a3..HEAD -- $R
> git diff --stat -- $R
> git diff --cached --stat -- $R
> ```
> Expected: **no output** from all three.
>
> If `frontend/src/pages/DesignTokensPage.tsx` is the *only* file listed and its
> `getBaseColor()` body still matches the excerpt in "Current state", that is
> `plans/025-remove-internal-tooling-from-prod.md` having landed first — which
> it should not have (see Status). Only the line numbers moved. Re-locate
> `getBaseColor` by name, confirm the body is unchanged, and continue; report
> the out-of-order execution.
>
> Never run `git checkout --` or `git clean -f` to "clean up" a dirty tree.
> Those destroy the operator's work. Stop and report instead.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md`
- **Must run BEFORE** these two, both of which are blocked on it:
  - `plans/022-fix-contrast-tokens.md` — 022 changes four `tokens.json` values
    that Step 1 below copies verbatim into the `parchment` preset, and Step 5's
    test asserts an exact match against `tokens.json`. If 022 lands first, that
    test fails on arrival. 022's Step 9 assumes this ordering and re-syncs the
    four values afterwards.
  - `plans/025-remove-internal-tooling-from-prod.md` — 025 deletes ~176 lines
    from `frontend/src/pages/DesignTokensPage.tsx`, which this plan's drift
    check requires to be unmodified and whose `getBaseColor()` (cited at
    `:264-274`) constrains the type change in Step 3.
- **Category**: direction
- **Planned at**: commit `42826a3`, 2026-08-27

Note on the dependency: plan 001 repairs the repo's frontend typecheck gate
(`make typecheck` / CI currently run `npx tsc --noEmit`, which loads **zero**
files because `frontend/tsconfig.json` is a project-references stub with
`files: []`). This plan introduces a compile-time contract whose entire value is
that CI enforces it, so 001 should land first. This plan is still fully
executable standalone: every typecheck command below uses the working form
`npx tsc -b --noEmit` explicitly, never the broken `npx tsc --noEmit`.

## Why this matters

The project's design direction is decided and documented: a "Legal Codex"
palette — warm off-white `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017`,
Crimson Text serif headings — aimed at a self-representing immigration
applicant who needs the tool to read as authoritative and precise. That palette
is the baseline in `frontend/src/tokens/tokens.json` and the generated
`frontend/src/tokens/tokens.css`, and it is what the `parchment` theme preset
resolves to. But the running app never shows it: `readStoredPreset()` returns
the `claude` preset (Anthropic-brand warm grey `#eeece2` + orange `#da7756`) in
every branch, **and** it unconditionally rewrites a stored `"parchment"` to
`"claude"` on every page load. That second behaviour is an outright defect
independent of any product opinion: a user who deliberately picks Parchment in
the Design Tokens page has the choice silently reverted on the next reload, so
one of the eleven advertised presets cannot be kept at all.

Separately, ten of the eleven presets omit two themeable custom properties —
`--color-background-surface-hover` and `--color-overlay`. Because `applyTheme()`
writes only the keys a preset declares, those two always fall through to the
Legal Codex values in `tokens.css`. Every alternate theme therefore renders
hover states and modal scrims borrowed from a palette it is supposed to have
replaced (most visibly: the Forest dark theme's background is `#0e1f16` and the
inherited scrim is `#111820`, so modal overlays barely darken anything). The
preset shape is an untyped `Record<string, string>`, so the next token added to
`tokens.json` will silently miss all ten presets the same way.

After this plan: the app boots on the decided Legal Codex palette, an explicit
preset choice survives a reload, every preset owns every themeable property, and
the TypeScript compiler rejects a preset that forgets one.

## Current state

### Files

- `frontend/src/hooks/use-theme-preset.ts` — the only theme engine. Declares the
  11 presets, applies them as inline CSS custom properties on
  `document.documentElement`, and persists the choice in `localStorage`. 601
  lines. **The only file this plan modifies.**
- `frontend/src/tokens/tokens.json` — hand-edited source of truth for design
  tokens. **Read-only for this plan** (the values in Step 1 are copied from it).
- `frontend/src/tokens/tokens.css` — generated from `tokens.json` by
  `frontend/scripts/build-tokens.ts` (`npm run tokens`). Holds the `:root` and
  `.dark` fallbacks that the presets currently leak through. **Read-only.**
- `frontend/src/pages/DesignTokensPage.tsx` — the preset picker and colour
  editor; the only consumer that reads `PRESETS[...].vars` directly.
  **Read-only** — but its `getBaseColor()` constrains the type change in Step 3.
- `frontend/src/components/layout/AppLayout.tsx` — imports the hook module for
  its boot side effect. **Read-only.**

### The theme module runs at boot on every route

`frontend/src/components/layout/AppLayout.tsx:9`:

```
import "@/hooks/use-theme-preset" // eagerly apply stored theme preset on load
```

`AppLayout` is imported eagerly by `frontend/src/App.tsx:6`, so the module-level
side effect below runs before React mounts, on every page load.

`frontend/src/hooks/use-theme-preset.ts:504-509`:

```
/* ── Eagerly apply on module load (before React mounts) ──────── */

const _initialPreset = readStoredPreset();
const _initialDark = readStoredDark();
const _initialCustom = readStoredCustom();
applyTheme(_initialPreset, _initialDark, _initialCustom);
```

### Defect 1 — the default is `claude` and a stored `parchment` is rewritten

`frontend/src/hooks/use-theme-preset.ts:464-481`:

```
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

The migration block at lines 468-476 has no one-shot flag and no way to tell a
legacy default apart from a deliberate choice. `setPreset()` persists the chosen
name at line 547, so picking Parchment writes `"parchment"` and the next boot
overwrites it:

`frontend/src/hooks/use-theme-preset.ts:544-552`:

```
  _state = next;
  applyTheme(next.preset, next.isDark, next.customVars);
  try {
    localStorage.setItem(PRESET_KEY, next.preset);
    localStorage.setItem(DARK_KEY, String(next.isDark));
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(next.customVars));
  } catch {
    // Silently ignore storage errors (private mode, quota exceeded)
  }
```

The same hard-coded default appears in the reset path,
`frontend/src/hooks/use-theme-preset.ts:575-577`:

```
  const resetPreset = useCallback(() => {
    setState({ preset: "claude", isDark: false, customVars: {} });
  }, []);
```

(`resetPreset` is exported but currently has no caller outside this file.)

### `parchment` **is** the Legal Codex palette

`frontend/src/hooks/use-theme-preset.ts:64-70`:

```
  parchment: {
    label: "Parchment",
    colors: ["#1b2838", "#5c4306", "#f5f4f1", "#6e7177"],
    darkColors: ["#111820", "#c9942e", "#192230", "#4a5060"],
    vars: {},
    darkVars: {},
  },
```

`vars` and `darkVars` are empty, so selecting Parchment simply lets the
`tokens.css` baseline show through. That baseline is the documented direction —
`frontend/src/tokens/tokens.css:5`, `:11`, `:9`:

```
  --color-primary: #1b2838;
  --color-background: #f5f4f1;
  --color-accent-light: #d4a017;
```

and `CLAUDE.md:394-395` (project instructions, quoted verbatim — the executor
has not read that file):

```
**已確認美學方向：「法律典籍」（Legal Codex）**
- 暖米白背景（`#f5f4f1`）+ 深海軍藍（`#1b2838`）+ 琥珀金 accent（`#d4a017`）
```

By contrast the `claude` preset (`use-theme-preset.ts:25-63`) paints
`--color-background: #eeece2` and `--color-accent-light: #e08a6d`.

### Defect 2 — two themeable properties are missing from every preset

`applyTheme()` clears all inline custom properties, then writes back only the
keys the selected preset declares —
`frontend/src/hooks/use-theme-preset.ts:437-454`:

```
  const el = document.documentElement;
  const preset = PRESETS[name];
  const vars = dark ? preset.darkVars : preset.vars;

  el.classList.toggle("dark", dark);

  // Clear ALL inline CSS custom properties for a clean slate
  const toRemove: string[] = [];
  for (let i = 0; i < el.style.length; i++) {
    const prop = el.style[i];
    if (prop.startsWith("--")) toRemove.push(prop);
  }
  toRemove.forEach((p) => el.style.removeProperty(p));

  // Apply preset vars
  for (const [k, v] of Object.entries(vars)) {
    el.style.setProperty(k, v);
  }
```

Machine-verified at commit `42826a3`: each of the ten non-`parchment` presets
declares exactly **15** keys in `vars` and the same 15 in `darkVars`.
`--color-background-surface-hover` and `--color-overlay` appear **zero** times in
the whole of `use-theme-preset.ts`. Both are defined only in `tokens.css` —
`:15` (`#e6e4e0`) and `:38` (`#111820`) for light, `:126` (`#243144`) and `:121`
(`#000000`) for dark — and both have real consumers:

- `--color-background-surface-hover` is aliased by `frontend/src/index.css:18`
  (`--color-surface-hover: var(--color-background-surface-hover);`) and used via
  Tailwind's `hover:bg-surface-hover` in `frontend/src/pages/CourtLineagePage.tsx`
  (3 call sites) and `frontend/src/components/lineage/LineageFilters.tsx` (3).
- `--color-overlay` backs every modal scrim:
  `frontend/src/components/shared/ConfirmModal.tsx:35`,
  `frontend/src/components/shared/TagInputModal.tsx:34`,
  `frontend/src/components/shared/GlobalSearch.tsx:41`,
  `frontend/src/components/layout/MobileNav.tsx:36`,
  `frontend/src/components/analytics/SuccessRateDeepModal.tsx:49`,
  `frontend/src/components/saved-searches/SaveSearchModal.tsx:120`,
  `frontend/src/components/collections/CollectionEditor.tsx:111`.

The preset shape has no per-key contract —
`frontend/src/hooks/use-theme-preset.ts:16-22`:

```
interface ThemePreset {
  readonly label: string;
  readonly colors: readonly [string, string, string, string];
  readonly darkColors: readonly [string, string, string, string];
  readonly vars: Readonly<Record<string, string>>;
  readonly darkVars: Readonly<Record<string, string>>;
}
```

### The one consumer that constrains the type change

`frontend/src/pages/DesignTokensPage.tsx:264-274` indexes `vars` with an
arbitrary `string`. This file is **out of scope**, so the new type must keep
string indexing legal:

```
function getBaseColor(
  preset: PresetName,
  isDark: boolean,
  cssVar: string,
): string {
  const p = PRESETS[preset];
  const presetVars = isDark ? p.darkVars : p.vars;
  if (presetVars[cssVar]) return presetVars[cssVar];
  const defaults = isDark ? DEFAULT_DARK : DEFAULT_LIGHT;
  return defaults[cssVar] || "";
}
```

The intersection type specified in Step 3 was probe-compiled against
`tsc --strict` before this plan was written: a complete preset compiles, an
incomplete one raises `TS2322`, and `presetVars[cssVar]` with `cssVar: string`
still resolves to `string`.

### Repo conventions that apply here

- Commit messages: `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Real example from `git log`: `fix: install root node_modules in make install`.
- React/TS: never mutate arrays — use `.toSorted()`, not `.sort()`
  (`"lib": ["ES2023"]` is set in `frontend/tsconfig.app.json`). Every
  `localStorage` call must be wrapped in try/catch (throws in private mode and
  on quota). No magic colour/spacing numbers — values come from
  `frontend/src/tokens/tokens.json`.
- `frontend/tsconfig.app.json` sets `"strict": true`, `"noUnusedLocals": true`,
  `"noUnusedParameters": true`, `"erasableSyntaxOnly": true` (no `enum`, no
  `namespace`), `"verbatimModuleSyntax": true` (type-only imports must use
  `import type`).
- Frontend unit tests live in `frontend/__tests__/` (vitest `include` is
  `__tests__/**/*.{test,spec}.{ts,tsx}` relative to `frontend/`; files under
  `frontend/src/**/__tests__/` are **not** picked up). Environment is `jsdom`,
  `globals: true`, setup file `frontend/__tests__/legislations-setup.ts`.
  Model the new test on `frontend/__tests__/css-tokens.test.ts` — it imports
  `{ describe, it, expect } from "vitest"` explicitly, reads `tokens.json` with
  `fs.readFileSync(path.resolve(__dirname, "../src/tokens/tokens.json"))`, and
  passes a message string as the second argument to `expect()` for readable
  failures.
- The setup file mocks `localStorage` (with a working `clear()`), but **not**
  `window.matchMedia`. `readStoredDark()` at `use-theme-preset.ts:491` calls
  `window.matchMedia(...)` at module load, so any test that imports the module
  must stub `window.matchMedia` first or the import throws.

## Commands you will need

Run everything from the repo root `/Users/d/Developer/Active Projects/IMMI-Case-`
unless the command itself changes directory.

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend typecheck (working form) | `cd frontend && npx tsc -b --noEmit` | exit 0, no output (first run can take several minutes) |
| Run only this plan's test | `cd frontend && npx vitest run __tests__/theme-preset.test.ts` | `Test Files 1 passed (1)`, `Tests 9 passed (9)` — a **per-file** count, which is stable regardless of what sibling plans land |
| Full frontend unit suite | `cd frontend && npx vitest run` | **0 failed**, and `Tests passed` == `FE_BEFORE + 9` (`FE_BEFORE` recorded in Step 0) |
| Frontend lint (touched files) | `cd frontend && npx eslint src/hooks/use-theme-preset.ts __tests__/theme-preset.test.ts` | exit 0, no output |
| Full frontend lint | `cd frontend && npm run lint` | exit 0 with **0 errors**; the warning count is not a gate |
| Preset shape probe (see Step 2) | the `python3` heredoc in Step 2 | `vars=17 dark=17` for all 11 presets |
| Worker tests (regression guard) | `cd workers && npx vitest run` | 0 failed, `Tests passed` unchanged from `WK_BEFORE` (Step 0) |

Absolute suite totals are deliberately absent from this table and from "Done
criteria". Several frontend plans run in parallel; a hard-coded
`499 passed / 56 files` turns any sibling plan landing first into a false STOP
and teaches the executor to edit the yardstick. The one exact number kept is the
**per-file** `9 passed` for this plan's own new test file, which no other plan
can move.

Do **not** use `npx tsc --noEmit` (without `-b`): in this repo it exits 0 while
loading zero files, so it proves nothing.

## Scope

**In scope** (the only files you may modify or create):

- `frontend/src/hooks/use-theme-preset.ts` — modify.
- `frontend/__tests__/theme-preset.test.ts` — create.

**Out of scope** (do NOT touch, even though they look related):

- `frontend/src/tokens/tokens.json` and `frontend/src/tokens/tokens.css` — this
  plan owns them in the sense that nothing else may change them while it runs,
  but their values must stay exactly as they are. `tokens.css` is generated by
  `npm run tokens`; editing it by hand is always wrong, and the Legal Codex
  values in it are the target this plan aligns the presets *to*.
- `frontend/src/pages/DesignTokensPage.tsx` — the preset picker. If your type
  change breaks its typecheck, the type is wrong, not the page (see STOP
  conditions).
- `frontend/src/index.css`, any component using `bg-surface-hover` or
  `var(--color-overlay)` — they are already correct; they were reading the right
  variable all along.
- `CLAUDE.md` — it already documents Legal Codex as the confirmed direction, so
  this plan brings the code to the doc, not the reverse. Do not edit it.
- Any Python file, Worker file, or E2E test. No E2E test asserts a preset name
  (`tests/e2e/react/test_react_theme.py` only asserts the `dark` class and the
  `theme-dark` storage key), so none needs updating.
- Do not run `npm run tokens`, `npm install`, or any build/deploy command.

## Git workflow

- Branch: `advisor/021-restore-legal-codex-default` (create from `main`; do not
  work directly on `main`).
- Commit per step or per logical unit. Message style, matching `git log`:
  - `fix: give every theme preset the surface-hover and overlay tokens`
  - `refactor: make the theme preset var set a compile-time contract`
  - `fix: default the theme to Legal Codex and stop rewriting a stored preset`
  - `test: cover theme preset boot behaviour and var completeness`
- **Step 4 must be its own commit** and must not be combined with any other
  step. It carries the one change that is a product decision rather than a bug
  fix (the default palette flip), and Step 0's rollback instruction depends on
  it being revertible in isolation. The migration deletion inside Step 4 is a
  bug fix and can ride along — reverting the commit reinstates the old default
  *and* the old migration, which is the honest all-or-nothing rollback.
- Do NOT push, do NOT open a PR, do NOT merge. The operator commits and ships.

## Steps

### Step 0: Record the baselines, and pin a rollback point

**Baselines.** Every suite gate in this plan is a delta against these, not
against a number written into this file:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run 2>&1 | tail -5
#   FE_BEFORE      = "Tests  N passed"
#   FEFILES_BEFORE = "Test Files  N passed"
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run 2>&1 | tail -5
#   WK_BEFORE = "Tests  N passed"
```

**Rollback point.** This plan changes what every user sees on first paint: the
default palette flips from `claude` (warm grey + orange) to `parchment` (Legal
Codex off-white + navy), and it rewrites hover and scrim colours in all eleven
presets. That is the largest single visual change in this batch, and it is a
direction call that the owner may want to undo without unpicking Steps 1–3.
Record the exact revert instruction now:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git rev-parse HEAD
#   PRE_021_SHA — write this into your final report
```

Then state in your report, verbatim:

> Visual rollback: `git revert <the commit that changed DEFAULT_PRESET>` undoes
> the default-palette flip on its own. Steps 1, 2, 3 and 5 (explicit parchment
> vars, the two missing tokens in all presets, the compile-time contract, the
> tests) are independent of that decision and should be kept. Full rollback of
> everything: `git revert` the whole branch, or reset to `PRE_021_SHA`.

Keeping the default-flip in its own commit is therefore **required**, not
stylistic — see "Git workflow".

### Step 1: Make `parchment` self-describing with the Legal Codex baseline

`parchment` currently declares `vars: {}` / `darkVars: {}` and relies on the
`tokens.css` cascade. Replace those two empty objects with the explicit 17-key
maps below so that every preset has the same shape (required by Step 3) and so
the default palette is stated in one place instead of implied.

The values are copied verbatim from `frontend/src/tokens/tokens.json` — copy the
strings exactly, including the `rgba(...)` spacing, which differs between light
(`rgba(184,134,11,0.12)`, no spaces) and dark (`rgba(201, 148, 46, 0.12)`, with
spaces). Step 5's test asserts an exact match against `tokens.json`, so a typo
will fail loudly.

Replace `frontend/src/hooks/use-theme-preset.ts:64-70` with:

```ts
  parchment: {
    label: "Parchment",
    colors: ["#1b2838", "#5c4306", "#f5f4f1", "#6e7177"],
    darkColors: ["#111820", "#c9942e", "#192230", "#4a5060"],
    // The "Legal Codex" baseline. These are the same values the generated
    // src/tokens/tokens.css writes to :root / .dark — stated explicitly here so
    // the default preset is not defined by the absence of overrides.
    vars: {
      "--color-primary": "#1b2838",
      "--color-primary-light": "#2a3f55",
      "--color-primary-lighter": "#3a5572",
      "--color-accent": "#5c4306",
      "--color-accent-light": "#d4a017",
      "--color-accent-muted": "rgba(184,134,11,0.12)",
      "--color-background": "#f5f4f1",
      "--color-background-card": "#ffffff",
      "--color-background-sidebar": "#faf9f7",
      "--color-background-surface": "#f0efec",
      "--color-background-surface-hover": "#e6e4e0",
      "--color-border": "#6e7177",
      "--color-border-light": "#eae8e3",
      "--color-text": "#1b2838",
      "--color-text-secondary": "#4a5568",
      "--color-text-muted": "#8b8680",
      "--color-overlay": "#111820",
    },
    darkVars: {
      "--color-primary": "#d0d4da",
      "--color-primary-light": "#a8b2be",
      "--color-primary-lighter": "#5a7f9f",
      "--color-accent": "#c9942e",
      "--color-accent-light": "#e0b04a",
      "--color-accent-muted": "rgba(201, 148, 46, 0.12)",
      "--color-background": "#111820",
      "--color-background-card": "#192230",
      "--color-background-sidebar": "#141c28",
      "--color-background-surface": "#1c2535",
      "--color-background-surface-hover": "#243144",
      "--color-border": "#4a5060",
      "--color-border-light": "#2d3748",
      "--color-text": "#e2dfda",
      "--color-text-secondary": "#a4acb8",
      "--color-text-muted": "#6d7788",
      "--color-overlay": "#000000",
    },
  },
```

This is behaviour-preserving: `applyTheme()` now writes inline properties whose
values are identical to what the `:root` / `.dark` rules already supplied.

**Verify**: `cd frontend && npx tsc -b --noEmit` → exit 0, no output.
**Verify**: `cd frontend && npx vitest run` → 0 failed, `Tests passed` still
equal to `FE_BEFORE` (unchanged; no new tests yet).

### Step 2: Give the other ten presets the two missing properties

For each of the ten non-`parchment` presets, insert
`"--color-background-surface-hover"` immediately **after** the existing
`"--color-background-surface"` line, and `"--color-overlay"` as the **last**
entry — in both the `vars` and the `darkVars` block. Keeping that position makes
the diff minimal and the key order identical across all 11 presets.

Use exactly these values. They are derived by rule, not taste, so they stay
reviewable: light `surface-hover` = the preset's own light
`--color-background-surface` scaled to 96% per channel (a hair darker); dark
`surface-hover` = its dark `--color-background-surface` scaled to 130% (a hair
lighter); light `--color-overlay` = the preset's **own dark-mode**
`--color-background`; dark `--color-overlay` = `#000000`. That is precisely the
relationship the Legal Codex baseline already has in `tokens.css`.

| preset | `vars` `--color-background-surface-hover` | `vars` `--color-overlay` | `darkVars` `--color-background-surface-hover` | `darkVars` `--color-overlay` |
|---|---|---|---|---|
| `claude` | `#dfddd3` | `#141413` | `#373733` | `#000000` |
| `ocean` | `#dfe7ee` | `#0a1929` | `#1a3453` | `#000000` |
| `forest` | `#e1e6e3` | `#0e1f16` | `#274534` | `#000000` |
| `slate` | `#e7ebef` | `#0f172a` | `#30425e` | `#000000` |
| `rose` | `#efe4e7` | `#1f0f17` | `#4f2a3e` | `#000000` |
| `midnight` | `#dbdbe6` | `#0d0d1f` | `#272756` | `#000000` |
| `amber` | `#e6dfd2` | `#1a1208` | `#41301a` | `#000000` |
| `nordic` | `#d9dfe3` | `#121a22` | `#2c3e4f` | `#000000` |
| `terracotta` | `#e4dbd2` | `#1c120c` | `#452f1f` | `#000000` |
| `lavender` | `#dfd7e6` | `#150e20` | `#372a53` | `#000000` |

Worked example — the `claude` preset's `vars` block becomes (only the two new
lines shown in context; leave every other line untouched):

```ts
      "--color-background-surface": "#e8e6dc",
      "--color-background-surface-hover": "#dfddd3",
      "--color-border": "#d5d3c8",
      "--color-border-light": "#e0ded5",
      "--color-text": "#3d3929",
      "--color-text-secondary": "#6b6651",
      "--color-text-muted": "#6d6857",
      "--color-overlay": "#141413",
```

**Verify** — every preset now declares 17 keys in each mode. Run from the repo
root:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && python3 - <<'PY'
import re
src = open("src/hooks/use-theme-preset.ts").read()
block = src[src.index("export const PRESETS"):src.index("\n};", src.index("export const PRESETS"))]
for name in re.findall(r"\n  (\w+): \{", block):
    i = block.index("\n  %s: {" % name); j = block.index("\n  },", i); seg = block[i:j]
    def keys(label):
        k = seg.find(label + ": {"); e = seg.index("},", k)
        return re.findall(r'"(--[a-z0-9-]+)"\s*:', seg[k:e])
    v, d = keys("vars"), keys("darkVars")
    print(f"{name:12s} vars={len(v)} dark={len(d)} "
          f"hover={'--color-background-surface-hover' in v and '--color-background-surface-hover' in d} "
          f"overlay={'--color-overlay' in v and '--color-overlay' in d}")
PY
```

Expected — 11 lines, all identical in shape:

```
claude       vars=17 dark=17 hover=True overlay=True
parchment    vars=17 dark=17 hover=True overlay=True
ocean        vars=17 dark=17 hover=True overlay=True
forest       vars=17 dark=17 hover=True overlay=True
slate        vars=17 dark=17 hover=True overlay=True
rose         vars=17 dark=17 hover=True overlay=True
midnight     vars=17 dark=17 hover=True overlay=True
amber        vars=17 dark=17 hover=True overlay=True
nordic       vars=17 dark=17 hover=True overlay=True
terracotta   vars=17 dark=17 hover=True overlay=True
lavender     vars=17 dark=17 hover=True overlay=True
```

**Verify**: `cd frontend && npx tsc -b --noEmit` → exit 0.
**Verify**: `cd frontend && npx vitest run` → 0 failed, `Tests passed` still
equal to `FE_BEFORE` (no test file added yet).

### Step 3: Turn the preset var set into a compile-time contract

Insert the following immediately **above** the `interface ThemePreset`
declaration at `frontend/src/hooks/use-theme-preset.ts:16`, and change the two
field types on that interface.

```ts
/**
 * Every CSS custom property a theme preset is responsible for.
 *
 * A preset that omits one does not fall back to something neutral — it inherits
 * the Legal Codex value from the generated src/tokens/tokens.css, because
 * applyTheme() writes back only the keys the preset declares. That is why this
 * list is a compile-time contract rather than a comment.
 */
export const THEME_VAR_NAMES = [
  "--color-primary",
  "--color-primary-light",
  "--color-primary-lighter",
  "--color-accent",
  "--color-accent-light",
  "--color-accent-muted",
  "--color-background",
  "--color-background-card",
  "--color-background-sidebar",
  "--color-background-surface",
  "--color-background-surface-hover",
  "--color-border",
  "--color-border-light",
  "--color-text",
  "--color-text-secondary",
  "--color-text-muted",
  "--color-overlay",
] as const;

export type ThemeVarName = (typeof THEME_VAR_NAMES)[number];

/**
 * The Record<ThemeVarName, string> half makes an omitted token a type error.
 * The Record<string, string> half keeps arbitrary-string indexing legal for
 * consumers such as getBaseColor() in src/pages/DesignTokensPage.tsx.
 */
type ThemePresetVars = Readonly<Record<ThemeVarName, string>> &
  Readonly<Record<string, string>>;
```

Then update the interface (this is the only change to it):

```ts
interface ThemePreset {
  readonly label: string;
  readonly colors: readonly [string, string, string, string];
  readonly darkColors: readonly [string, string, string, string];
  readonly vars: ThemePresetVars;
  readonly darkVars: ThemePresetVars;
}
```

Leave `export const PRESETS: Record<PresetName, ThemePreset> = {` exactly as it
is — the annotation is what forces each literal to satisfy `ThemePresetVars`.

**Verify**: `cd frontend && npx tsc -b --noEmit` → exit 0, no output.

**Verify the gate actually bites** (do this, then undo it):

1. Delete the single line `"--color-overlay": "#000000",` from the `lavender`
   preset's `darkVars` block.
2. Run `cd frontend && npx tsc -b --noEmit`.
   Expected: non-zero exit with an error naming the missing property, e.g.
   `error TS2322: Type '{ ... }' is not assignable to type 'ThemePresetVars'.`
   followed by `Property '"--color-overlay"' is missing`.
3. Restore the deleted line.
4. Re-run `cd frontend && npx tsc -b --noEmit` → exit 0, and re-run the Step 2
   python probe → all 11 rows still read `vars=17 dark=17 hover=True overlay=True`.

**Verify**: `cd frontend && npx vitest run` → 0 failed, `Tests passed` still
equal to `FE_BEFORE` (no test file added yet).

### Step 4: Default to Legal Codex and stop rewriting a stored preset

Add a named default constant directly above `readStoredPreset()` (i.e. just
after the `/* ── Stored state readers ── */` banner at
`frontend/src/hooks/use-theme-preset.ts:462`):

```ts
/**
 * The shipped design direction ("Legal Codex"): warm off-white #f5f4f1, deep
 * navy #1b2838, amber #d4a017. Its values are the same ones tokens.json feeds
 * into :root, so changing this constant is the only edit needed to change the
 * app's default palette.
 */
const DEFAULT_PRESET: PresetName = "parchment";
```

Then replace the whole of `readStoredPreset()` (lines 464-481) with:

```ts
function readStoredPreset(): PresetName {
  if (typeof window === "undefined") return DEFAULT_PRESET;
  try {
    const stored = localStorage.getItem(PRESET_KEY);
    return stored && stored in PRESETS ? (stored as PresetName) : DEFAULT_PRESET;
  } catch {
    return DEFAULT_PRESET;
  }
}
```

The migration block is deleted outright, not gated: reading must never write.
The surrounding `try`/`catch` stays, per the repo's localStorage rule.

Finally, update the reset path at what was `use-theme-preset.ts:575-577`:

```ts
  const resetPreset = useCallback(() => {
    setState({ preset: DEFAULT_PRESET, isDark: false, customVars: {} });
  }, []);
```

**Verify** — the only remaining quoted `"claude"` in the file is the member of
the `PresetName` union at line 4, and the migration comment is gone:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -c '"claude"' src/hooks/use-theme-preset.ts; \
  grep -n 'Migrate old default' src/hooks/use-theme-preset.ts; \
  grep -n 'DEFAULT_PRESET' src/hooks/use-theme-preset.ts
```

Expected: the count prints `1`; the `Migrate old default` grep prints nothing
(exit 1); the `DEFAULT_PRESET` grep prints exactly **5** lines — the declaration,
three uses inside `readStoredPreset()`, and one inside `resetPreset()`.

**Verify**: `cd frontend && npx tsc -b --noEmit` → exit 0.
**Verify**: `cd frontend && npx vitest run` → 0 failed, `Tests passed` still
equal to `FE_BEFORE` (no test file added yet).

### Step 5: Add the regression test

Create `frontend/__tests__/theme-preset.test.ts` with exactly this content. It
stubs `window.matchMedia` before importing the module (jsdom does not provide
it, and `readStoredDark()` calls it at module load), and re-imports the module
per scenario so the boot-time side effect runs again. Note the stub is a plain
function, not `vi.fn()`, because the shared setup file calls
`vi.clearAllMocks()` after every test.

```ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

type ThemeModule = typeof import("@/hooks/use-theme-preset");

const TOKENS = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../src/tokens/tokens.json"),
    "utf-8",
  ),
);

/** jsdom has no matchMedia; readStoredDark() calls it at module load. */
function stubMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

let mod: ThemeModule;

beforeAll(async () => {
  stubMatchMedia();
  mod = await import("@/hooks/use-theme-preset");
});

/** Re-run the module's boot-time applyTheme() with a given stored preset. */
async function boot(stored: string | null): Promise<void> {
  localStorage.clear();
  if (stored !== null) localStorage.setItem("theme-preset", stored);
  document.documentElement.removeAttribute("style");
  vi.resetModules();
  stubMatchMedia();
  await import("@/hooks/use-theme-preset");
}

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name).trim();
}

function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const [r, g, b] = [0, 2, 4].map(
    (i) => parseInt(clean.slice(i, i + 2), 16) / 255,
  );
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// ══════════════════════════════════════════════════════════════════════
// Boot behaviour — the default palette and preset persistence
// ══════════════════════════════════════════════════════════════════════
describe("theme preset boot behaviour", () => {
  it("boots on the Legal Codex palette when nothing is stored", async () => {
    await boot(null);
    expect(cssVar("--color-background")).toBe("#f5f4f1");
    expect(cssVar("--color-text")).toBe("#1b2838");
    expect(cssVar("--color-accent-light")).toBe("#d4a017");
  });

  it("does not write to localStorage while reading the stored preset", async () => {
    await boot(null);
    expect(localStorage.getItem("theme-preset")).toBeNull();
  });

  it("keeps an explicitly stored parchment preset across a reload", async () => {
    await boot("parchment");
    expect(localStorage.getItem("theme-preset")).toBe("parchment");
    expect(cssVar("--color-background")).toBe("#f5f4f1");
  });

  it("keeps an explicitly stored claude preset across a reload", async () => {
    await boot("claude");
    expect(localStorage.getItem("theme-preset")).toBe("claude");
    expect(cssVar("--color-background")).toBe("#eeece2");
  });

  it("falls back to the Legal Codex palette for an unknown stored preset", async () => {
    await boot("not-a-real-preset");
    expect(cssVar("--color-background")).toBe("#f5f4f1");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Preset var contract — no preset may silently inherit from tokens.css
// ══════════════════════════════════════════════════════════════════════
describe("theme preset var contract", () => {
  it("every preset defines every themeable var in both light and dark", () => {
    const expected = [...mod.THEME_VAR_NAMES].toSorted();
    expect(expected).toHaveLength(17);
    for (const [name, preset] of Object.entries(mod.PRESETS)) {
      expect(Object.keys(preset.vars).toSorted(), `${name}.vars`).toEqual(
        expected,
      );
      expect(
        Object.keys(preset.darkVars).toSorted(),
        `${name}.darkVars`,
      ).toEqual(expected);
    }
  });

  it("parchment mirrors the tokens.json Legal Codex baseline exactly", () => {
    const c = TOKENS.color;
    expect(mod.PRESETS.parchment.vars).toEqual({
      "--color-primary": c.primary.DEFAULT,
      "--color-primary-light": c.primary.light,
      "--color-primary-lighter": c.primary.lighter,
      "--color-accent": c.accent.DEFAULT,
      "--color-accent-light": c.accent.light,
      "--color-accent-muted": c.accent.muted,
      "--color-background": c.background.DEFAULT,
      "--color-background-card": c.background.card,
      "--color-background-sidebar": c.background.sidebar,
      "--color-background-surface": c.background.surface,
      "--color-background-surface-hover": c.background["surface-hover"],
      "--color-border": c.border.DEFAULT,
      "--color-border-light": c.border.light,
      "--color-text": c.text.DEFAULT,
      "--color-text-secondary": c.text.secondary,
      "--color-text-muted": c.text.muted,
      "--color-overlay": c.overlay.DEFAULT,
    });
    const d = TOKENS.color.dark;
    expect(mod.PRESETS.parchment.darkVars).toEqual({
      "--color-primary": d.primary.DEFAULT,
      "--color-primary-light": d.primary.light,
      "--color-primary-lighter": d.primary.lighter,
      "--color-accent": d.accent.DEFAULT,
      "--color-accent-light": d.accent.light,
      "--color-accent-muted": d.accent.muted,
      "--color-background": d.background.DEFAULT,
      "--color-background-card": d.background.card,
      "--color-background-sidebar": d.background.sidebar,
      "--color-background-surface": d.background.surface,
      "--color-background-surface-hover": d.background["surface-hover"],
      "--color-border": d.border.DEFAULT,
      "--color-border-light": d.border.light,
      "--color-text": d.text.DEFAULT,
      "--color-text-secondary": d.text.secondary,
      "--color-text-muted": d.text.muted,
      "--color-overlay": d.overlay.DEFAULT,
    });
  });

  it("surface-hover is distinct from surface and moves the right way", () => {
    for (const [name, p] of Object.entries(mod.PRESETS)) {
      const ls = p.vars["--color-background-surface"];
      const lh = p.vars["--color-background-surface-hover"];
      expect(lh, `${name} light hover equals surface`).not.toBe(ls);
      expect(
        luminance(lh),
        `${name} light hover must be darker than surface`,
      ).toBeLessThan(luminance(ls));

      const ds = p.darkVars["--color-background-surface"];
      const dh = p.darkVars["--color-background-surface-hover"];
      expect(dh, `${name} dark hover equals surface`).not.toBe(ds);
      expect(
        luminance(dh),
        `${name} dark hover must be lighter than surface`,
      ).toBeGreaterThan(luminance(ds));
    }
  });

  it("overlay is black in dark mode and the preset's own dark background in light mode", () => {
    for (const [name, p] of Object.entries(mod.PRESETS)) {
      expect(p.darkVars["--color-overlay"], `${name} dark overlay`).toBe(
        "#000000",
      );
      expect(p.vars["--color-overlay"], `${name} light overlay`).toBe(
        p.darkVars["--color-background"],
      );
    }
  });
});
```

**Verify**: `cd frontend && npx vitest run __tests__/theme-preset.test.ts` →
`Test Files 1 passed (1)`, `Tests 9 passed (9)`.

### Step 6: Visual acceptance matrix (required — this is not automated)

The JSON contrast assertions in Step 5 check *values*. They cannot see a modal
scrim that is now too dark to read through, a hover tint that vanishes against
its own surface, or a court badge that stopped separating from its card. This
plan changes the default palette **and** two colours in all eleven presets, so a
single manual glance at Forest is not adequate evidence.

Start the dev server (`make ui`) and walk this matrix. There is no visual
regression harness in this repo today (see Maintenance notes), so this is
manual and it is the only coverage these surfaces get.

For **each of the 11 presets** (switch them from `/design-tokens`), in **both**
light and dark:

| Surface | What to look for |
|---|---|
| Any confirm dialog (delete a saved search, or `/collections` → delete) | The scrim visibly darkens the page behind it. Dark mode must now be near-black, not the old barely-there `#111820`. |
| A `<select>` and a text input on `/cases` filters | Border is visible against the card; the focus ring is visible. |
| A `CourtBadge` row on `/cases` | All nine codes readable; none disappears into its card. |
| One chart on `/` (Dashboard) | Series are distinguishable from each other and from the background. |
| A hover state on `/court-lineage` court chips and `LineageFilters` | The hover tint belongs to the active theme, not to Legal Codex. This is the specific defect Step 2 fixes — before it, every preset borrowed `#e6e4e0` / `#243144`. |

Capture a screenshot of the Dashboard and of one open modal for **at least**:
`parchment` (the new default), `claude` (the old default — the change users will
actually notice), `forest` and `slate` (the two whose derived hover values moved
furthest), in both modes. That is 8 screenshots minimum. Attach them to your
report. If you cannot take screenshots in your environment, say so explicitly
and list which presets you checked by eye — do not report this step as verified.

**Rollback if the matrix fails**: the default-palette flip lives in its own
commit (Step 0 / Git workflow). Reverting that one commit restores the previous
first-paint experience while keeping Steps 1, 2, 3 and 5. Report which preset
and surface failed rather than nudging a hex to make it look acceptable — the
ten alternate palettes are explicitly out of scope here (see Maintenance notes).

### Step 7: Full verification sweep

**Verify**: `cd frontend && npx tsc -b --noEmit` → exit 0.
**Verify**: `cd frontend && npx vitest run __tests__/theme-preset.test.ts` →
`Test Files 1 passed (1)`, `Tests 9 passed (9)`.
**Verify**: `cd frontend && npx vitest run` → **0 failed**, and `Tests passed`
== `FE_BEFORE + 9`, `Test Files passed` == `FEFILES_BEFORE + 1` (Step 0).
**Verify**: `cd frontend && npm run lint` → exit 0 with 0 errors.
**Verify**: `cd workers && npx vitest run` → 0 failed, `Tests passed` unchanged
from `WK_BEFORE` (proves no cross-package damage).
**Verify**: `git status --short frontend/` from the repo root lists exactly two
paths: `M frontend/src/hooks/use-theme-preset.ts` and
`?? frontend/__tests__/theme-preset.test.ts`. If anything else under `frontend/`
appears, **stop and report** — do not run `git checkout --` or `git clean`,
because those cannot tell your mistake from the operator's own work. (Outside
`frontend/`, a pre-existing modification to `.claude/STATE.md` and the untracked
`plans/` directory are expected and not yours to clean up.)

## Test plan

New file `frontend/__tests__/theme-preset.test.ts`, 9 tests in 2 groups,
structurally modelled on `frontend/__tests__/css-tokens.test.ts` (explicit
vitest imports, `fs` + `path.resolve(__dirname, ...)` to read `tokens.json`,
message strings as the second `expect()` argument).

Boot behaviour (5 tests) — these are the regression tests for the defect:

1. Empty `localStorage` boots the Legal Codex palette (asserts the three
   documented brand colours land as inline custom properties).
2. Reading the stored preset performs **no** write — this is the assertion that
   fails if the `parchment` → `claude` migration is ever reintroduced.
3. A stored `"parchment"` survives a reload unchanged (the un-keepable-preset
   bug).
4. A stored `"claude"` survives a reload unchanged (proves step 4 did not simply
   invert the bug).
5. An unrecognised stored value falls back to Legal Codex.

Var contract (4 tests) — these are the drift guards:

6. All 11 presets declare exactly the 17 names in `THEME_VAR_NAMES`, in both
   modes. Adding an 18th token to `THEME_VAR_NAMES` without filling the presets
   fails here *and* at typecheck.
7. `parchment` equals the `tokens.json` baseline value-for-value in both modes,
   so a future `tokens.json` edit that is not mirrored into the preset is caught.
8. Every preset's `surface-hover` differs from its `surface` and moves the right
   direction (darker in light mode, lighter in dark) — catches a copy-paste that
   duplicates `surface` or swaps light/dark.
9. Every preset's dark `overlay` is `#000000` and its light `overlay` equals its
   own dark background — catches an overlay copied from the wrong preset.

Not covered by automated tests: everything visual. The nine JSON assertions
check token *values*; they cannot see an unreadable scrim, an invisible hover
tint, or a badge that stopped separating from its card. **Step 6 is the coverage
for that** — an 11-preset × 2-mode × 5-surface manual matrix with screenshots.
It is required, not optional, and a single spot-check of one preset is not a
substitute. Read Step 6 before declaring this plan done.

## Done criteria

ALL must hold:

- [ ] `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `cd frontend && npx vitest run` exits 0 with **0 failed**, `Tests passed`
      == `FE_BEFORE + 9` and `Test Files passed` == `FEFILES_BEFORE + 1`
- [ ] `cd frontend && npx vitest run __tests__/theme-preset.test.ts` exits 0 with `Tests 9 passed (9)`
- [ ] `cd frontend && npm run lint` exits 0 with 0 errors
- [ ] `cd workers && npx vitest run` exits 0 with 0 failed and `Tests passed`
      unchanged from `WK_BEFORE`
- [ ] Step 3's "verify the gate actually bites" rehearsal was performed: deleting
      `lavender`'s dark `--color-overlay` produced a TS2322, and restoring it
      cleared the error
- [ ] Step 6's visual matrix was walked for all 11 presets × light/dark, with at
      least 8 screenshots attached — or the report states explicitly which parts
      could not be performed
- [ ] The `DEFAULT_PRESET` change is isolated in its own commit, and the report
      names that commit's SHA as the rollback handle
- [ ] `grep -c '"claude"' frontend/src/hooks/use-theme-preset.ts` returns `1`
- [ ] `grep -n 'Migrate old default' frontend/src/hooks/use-theme-preset.ts` returns no matches (exit 1)
- [ ] The Step 2 python probe prints `vars=17 dark=17 hover=True overlay=True` for all 11 presets
- [ ] `git status --short frontend/` lists only `frontend/src/hooks/use-theme-preset.ts` (modified) and `frontend/__tests__/theme-preset.test.ts` (new)
- [ ] `git status --short frontend/src/tokens/` returns no output (`tokens.json` and `tokens.css` untouched)
- [ ] `plans/README.md` is **unchanged** — the integration owner maintains it

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows `frontend/src/hooks/use-theme-preset.ts` changed since
  `42826a3`, or any "Current state" excerpt does not match the live file
  verbatim — especially if `readStoredPreset()` no longer contains the
  `// Migrate old default "parchment" → "claude"` block (someone may have fixed
  this already, and re-fixing it could invert the default a second time).
- `npx tsc -b --noEmit` reports errors in `frontend/src/pages/DesignTokensPage.tsx`
  after Step 3 — most likely `TS7053` on `presetVars[cssVar]`. That means the
  `ThemePresetVars` intersection lost its `Readonly<Record<string, string>>`
  half. Fix the type, **never** the page (it is out of scope). If you cannot get
  both halves to hold, stop: fall back to reverting Step 3 only and report that
  Steps 1, 2, 4, 5 landed without the compile-time contract.
- The Step 3 "verify the gate actually bites" check does **not** produce a
  TypeScript error after you delete the `lavender` dark `--color-overlay` line.
  A silently-passing contract is worse than none — restore the line, then stop
  and report.
- `frontend/src/tokens/tokens.json` or `frontend/src/tokens/tokens.css` differ
  from the values quoted in Step 1. Do not "fix" either file and do not run
  `npm run tokens`; report the mismatch, because it means the Legal Codex
  baseline itself moved and the plan's hex values need re-deriving.
- The new test file cannot import `@/hooks/use-theme-preset` (for example a
  `TypeError: window.matchMedia is not a function` at import time). Do not
  "solve" it by editing `readStoredDark()` in the source — the stub belongs in
  the test. Report if the stub does not work.
- The full frontend suite reports any failure, or `Tests passed` is anything
  other than `FE_BEFORE + 9`. Existing tests do not reference preset names, so
  a failure means something unexpected — report rather than adjusting the
  existing test. (If the number is *higher* than `FE_BEFORE + 9`, a sibling plan
  landed mid-run; re-record `FE_BEFORE` and say so, do not silently accept it.)
- Step 6's visual matrix shows a surface that is worse than before on **any**
  preset. Revert the Step 4 commit, keep the rest, and report which preset,
  which mode and which surface. Do not adjust a hex in
  `use-theme-preset.ts` to rescue it — the ten alternate palettes need a
  designer, and their contrast pass is explicitly out of scope here.
- Any step's verification fails twice after a reasonable fix attempt.
- You conclude the fix requires touching a file outside the In-scope list.

## Maintenance notes

For whoever owns this code next:

- **Changing the default palette is now a one-line edit**: the `DEFAULT_PRESET`
  constant in `frontend/src/hooks/use-theme-preset.ts`. Do not reintroduce a
  localStorage rewrite to move existing users — a read function must not write.
  If a future default change genuinely needs to migrate stored values, gate it
  behind a separate one-shot key (e.g. `theme-preset-migrated-v2`) so an explicit
  user choice is never clobbered more than once.
- **Users already migrated cannot be recovered.** Anyone who selected Parchment
  before this change had their stored value overwritten to `"claude"` by the old
  migration; there is no record of the original choice. They will stay on the
  Claude palette until they pick again. That is accepted, not an oversight.
- **What a reviewer should scrutinise**: (1) the 40 hex values added in Step 2 —
  check a couple against the rule stated there rather than eyeballing them all;
  (2) that `ThemePresetVars` still has both halves of the intersection, since
  dropping `Readonly<Record<string, string>>` breaks `DesignTokensPage`, and
  dropping `Readonly<Record<ThemeVarName, string>>` silently disables the whole
  guard while still compiling; (3) that `parchment`'s explicit vars still equal
  `tokens.json` — test 7 covers it, so a green suite is sufficient evidence.
- **Adding a new design token** that presets should own now takes three edits:
  `tokens.json` (then `npm run tokens` to regenerate `tokens.css`), the
  `THEME_VAR_NAMES` array, and all 11 preset blocks. The compiler will name every
  block you missed. Tokens that are *not* preset-owned (chart colours, semantic
  colours, the 9 court colours, fonts, spacing, radii, shadows) stay out of
  `THEME_VAR_NAMES` and continue to come from `tokens.css` — that is deliberate,
  since a preset switch must not recolour court badges.
- **Deferred out of this plan**: `readStoredDark()` at
  `use-theme-preset.ts:491` calls `window.matchMedia(...)` without guarding for
  its absence, so importing this module throws in any environment that lacks it.
  `frontend/src/lib/council-celebrations.ts:64` already shows the guarded shape
  (`if (typeof window === "undefined" || !window.matchMedia) return false;`).
  Left alone here to keep the diff to the two findings; the new test stubs
  `matchMedia` instead.
- **Also deferred**: contrast auditing of the ten alternate palettes. An
  existing internal audit note flags `slate`'s accent (`#5a5df0`) against white
  at roughly 3.9:1, below WCAG AA for text. This plan changes only hover and
  overlay tokens and does not touch accents.
  `plans/022-fix-contrast-tokens.md` measured the same file independently and
  found the ten alternate presets fail the 3:1 non-text floor for
  `--color-border` in **both** modes (1.12–1.53 light, 1.28–1.99 against their
  own card), and nine of ten fail 4.5:1 for dark `--color-text-muted` on a card.
  That is a ~20-value coordinated palette pass across this file. It is unowned
  by any plan in this batch and needs a designer in the loop — worth its own
  plan, and worth saying out loud rather than letting it disappear between 021
  and 022.
- **There is no visual regression harness in this repo.** Step 6's matrix is
  manual because nothing automates it: `frontend/playwright.config.ts` and
  `frontend/e2e/**` are slated for deletion by
  `plans/040-revive-the-e2e-suites.md`, and the surviving `tests/e2e/react/`
  suite takes no screenshots. If theme work continues, the highest-value
  follow-up is a Playwright screenshot matrix over 11 presets × 2 modes × 4
  surfaces, wired into the E2E job 040 creates. Until then every theme change
  costs a human 20 minutes of clicking, which is why theme changes keep shipping
  unverified.

## Findings reconsidered

Nothing was dropped; two items were re-framed or corrected against the code as
it actually reads at `42826a3`.

- **"The app boots on the wrong preset" is half defect, half product call.** The
  migration at `use-theme-preset.ts:468-476` carries an explicit comment,
  `// Migrate old default "parchment" → "claude"`, so switching the default was
  deliberate, not drift. The unambiguous defect is narrower: the migration is
  unconditional and runs on every read, so a preset a user explicitly selected is
  silently reverted — one of eleven shipped presets cannot be kept. This plan
  fixes that outright (Step 4, deleting the block). It *also* moves the default
  back to `parchment`, which is a direction call, made on the grounds that
  `CLAUDE.md:394-395` names Legal Codex as the confirmed aesthetic direction and
  `tokens.json` / `tokens.css` encode exactly that palette as the baseline. If
  the owner has in fact decided otherwise, the correct response is to revert only
  the `DEFAULT_PRESET` value to `"claude"` and update `CLAUDE.md` — Steps 1, 2, 3
  and the migration deletion stand either way.
- **Evidence line numbers corrected.** The audit cited
  `use-theme-preset.ts:437-439` as the code that writes a preset's vars; at
  `42826a3` line 439 only *selects* `vars`, lines 443-449 clear all inline custom
  properties, and lines 451-454 do the writing. The audit also cited line 29 for
  the "untyped preset shape"; line 29 is the `claude` preset's `vars: {` opener —
  the untyped shape is the `Readonly<Record<string, string>>` fields at lines
  20-21. Everything else checked out: lines 465/477/479 return `"claude"`,
  468-476 rewrite a stored `"parchment"`, 547 persists the chosen preset, 576
  resets to `"claude"`, `AppLayout.tsx:9` imports the module for its boot side
  effect, and `--color-background-surface-hover` / `--color-overlay` appear zero
  times in the hook.
