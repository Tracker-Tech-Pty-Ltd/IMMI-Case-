# Plan 022: Bring the colour tokens up to WCAG AA in both themes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` if that file exists — unless a reviewer dispatched you and
> told you they maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> git diff --stat 42826a3..HEAD -- \
>   frontend/src/tokens/tokens.json \
>   frontend/src/tokens/tokens.css \
>   frontend/src/tokens/tokens.ts \
>   frontend/src/index.css \
>   frontend/src/components/analytics/RiskGauge.tsx \
>   frontend/src/components/judges/constants.ts \
>   frontend/src/components/shared/OutcomeStackedBar.tsx \
>   frontend/__tests__/risk-gauge.test.tsx \
>   frontend/__tests__/css-tokens.test.ts \
>   frontend/src/hooks/use-theme-preset.ts
> ```
>
> Expected: the only file that may appear is
> `frontend/src/hooks/use-theme-preset.ts` (plan 021 modifies it — Step 9 below
> handles that case explicitly). If **any other** file is listed, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/021-restore-legal-codex-default.md` (which itself
  depends on `plans/001-restore-the-frontend-compile-gate.md`)
- **Category**: bug
- **Planned at**: commit `42826a3`, 2026-08-27

Why the dependency is real, stated here because the executor has not read plan
021: plan 021 Step 1 replaces the `parchment` preset's empty `vars: {}` /
`darkVars: {}` with a 17-key map whose hex strings are **copied verbatim from
`frontend/src/tokens/tokens.json`**, and plan 021 Step 5 adds a test that
"asserts an exact match against `tokens.json`". Three of the values this plan
changes (`text.muted` light, `text.muted` dark, `border.DEFAULT` dark) are in
that copied set. If 021 lands first and this plan changes `tokens.json` without
re-syncing the copy, 021's own test fails. Step 9 handles both orderings.

Plan 001 matters because it repairs the frontend typecheck gate: `make
typecheck` and CI currently run `npx tsc --noEmit`, which loads **zero** files
(`frontend/tsconfig.json` is a project-references stub with `"files": []`).
Every typecheck command in this plan uses the working form, `npx tsc -b
--noEmit`, so this plan is executable standalone.

## Why this matters

The primary user of this app is a self-representing immigration applicant
reading tribunal outcomes under stress — not a lawyer with a second screen. Six
colour defects make the app's own judgements unreadable for anyone with reduced
contrast sensitivity, and every one of them is in the token layer or in a
component that bypassed it:

- The risk-gauge caption — the single headline verdict on the analytics page —
  renders at **1.74:1** in light mode for the middle band, because
  `RiskGauge.tsx` hardcodes `text-yellow-500` instead of using the semantic
  token. Below 1.74:1 text is not "hard to read", it is not text.
- The dark-mode semantic `danger` colour is **3.44:1** on a card, so every
  failure state in dark mode misses AA.
- All nine court colours are byte-identical between light and dark mode; on the
  dark backgrounds HCA measures **1.00–1.16:1**, i.e. the app's primary
  categorical encoding stops carrying information.
- The dark border token is **1.91–2.22:1**, so form-field and table-cell
  boundaries fall under the WCAG 1.4.11 3:1 floor for UI components.
- Every primary CTA is `bg-accent text-white`; white on the dark-mode accent is
  **2.62–2.71:1**. There is no foreground token to fix it with.
- 117 hex literals across 27 component files never move when the theme changes,
  which is *why* the court fix cannot be applied centrally today.

After this plan the token layer is AA-clean in both themes, there is a
foreground token for solid-fill backgrounds, the outcome and chart scales exist
as tokens, three components stop carrying stranded literals, and a regression
test (`frontend/__tests__/token-contrast.test.ts`) fails the build if any of it
drifts back.

## Current state

### Files and their role

| File | Role |
|---|---|
| `frontend/src/tokens/tokens.json` | Hand-edited source of truth for every design token. 105 lines. |
| `frontend/src/tokens/tokens.css` | **Generated** from `tokens.json` by `frontend/scripts/build-tokens.ts` (`npm run tokens`). Emits `:root { … }` and `.dark { … }`. Tracked in git. Never hand-edit. |
| `frontend/src/tokens/tokens.ts` | **Generated** from the same source. Exports `tokens`, `courtColors`, `getCourtColor`, `semanticColors`, `spacing`, `radius`, `shadow`, `zIndex`, `opacity`, `animationDuration`, `animationEasing`. Tracked in git. Never hand-edit. |
| `frontend/src/index.css` | Tailwind v4 `@theme` mapping + base styles + form-control styles. 396 lines. |
| `frontend/src/components/analytics/RiskGauge.tsx` | Semi-circle score gauge. 96 lines. Hardcodes Tailwind-palette classes and hex strokes. |
| `frontend/src/components/judges/constants.ts` | 6-entry bare-hex chart palette + a badge-class helper. 14 lines. |
| `frontend/src/components/shared/OutcomeStackedBar.tsx` | Stacked outcome bar + legend. 133 lines. 16 hex literals. |
| `frontend/__tests__/risk-gauge.test.tsx` | 6 tests for `RiskGauge`; one asserts the exact Tailwind palette classes this plan replaces. |
| `frontend/__tests__/css-tokens.test.ts` | 512-line existing token test suite. This plan must not break it. |
| `frontend/src/hooks/use-theme-preset.ts` | The theme engine: 11 presets applied as **inline** CSS custom properties on `document.documentElement`. Owned by plan 021; touched here only under the Step 9 condition. |

### The generated-file contract (load-bearing)

`frontend/package.json` scripts, verbatim:

```json
"tokens": "tsx scripts/build-tokens.ts",
"dev": "npm run tokens && vite",
"build": "npm run tokens && tsc -b && vite build",
```

`npm run build` regenerates `tokens.css` **and** `tokens.ts` before compiling.
Any hand-edit to those two files is silently reverted on the next build. All
token changes in this plan go into `tokens.json` followed by `npm run tokens`.
Verified at commit `42826a3`: regenerating from the committed `tokens.json`
reproduces the committed `tokens.css` and `tokens.ts` byte-for-byte, so a clean
`npm run tokens` must produce **no diff** other than your own edits.

`scripts/build-tokens.ts` flattens nested colour objects and **lowercases** each
key, with `DEFAULT` collapsing to the bare prefix. Verified by trial run:

- `color.accent.DEFAULT` → `--color-accent`
- `color["on-solid"]` → `--color-on-solid`
- `color.chart["6"]` → `--color-chart-6`
- `color.outcome["set-aside"]` → `--color-outcome-set-aside`
- `color.court.AATA` → `--color-court-aata`
- everything under `color.dark.*` is emitted into the `.dark { }` block under
  the **same** variable names (no `dark` segment in the name).

The generator also runs `validateDarkLightSymmetry(tokens.color,
tokens.color.dark)` and prints `⚠ WARN: …` for any light key with no dark
counterpart. Every new block this plan adds under `color` must get a mirror
under `color.dark`.

### tokens.json — the values this plan changes

`frontend/src/tokens/tokens.json:1-41`, verbatim:

```json
{
  "color": {
    "primary": { "DEFAULT": "#1b2838", "light": "#2a3f55", "lighter": "#3a5572" },
    "accent": { "DEFAULT": "#5c4306", "light": "#d4a017", "muted": "rgba(184,134,11,0.12)" },
    "background": { "DEFAULT": "#f5f4f1", "card": "#ffffff", "sidebar": "#faf9f7", "surface": "#f0efec", "surface-hover": "#e6e4e0" },
    "chart": {
      "2": "#8b5cf6",
      "3": "#10b981",
      "4": "#3b82f6",
      "5": "#f59e0b"
    },
    "border": { "DEFAULT": "#6e7177", "light": "#eae8e3" },
    "text": { "DEFAULT": "#1b2838", "secondary": "#4a5568", "muted": "#8b8680" },
    "semantic": { "success": "#236238", "warning": "#7d5b07", "danger": "#a83232", "info": "#2a6496" },
    "court": {
      "AATA": "#1a5276", "ARTA": "#6c3483", "FCA": "#117864",
      "FCCA": "#b9770e", "FedCFamC2G": "#a93226", "HCA": "#1b2631",
      "RRTA": "#1e8449", "MRTA": "#922b5f", "FMCA": "#b84c00"
    },
    "overlay": { "DEFAULT": "#111820" },
    "dark": {
      "primary": { "DEFAULT": "#d0d4da", "light": "#a8b2be", "lighter": "#5a7f9f" },
      "accent": { "DEFAULT": "#c9942e", "light": "#e0b04a", "muted": "rgba(201, 148, 46, 0.12)" },
      "overlay": { "DEFAULT": "#000000" },
      "background": { "DEFAULT": "#111820", "card": "#192230", "sidebar": "#141c28", "surface": "#1c2535", "surface-hover": "#243144" },
      "chart": {
        "2": "#a78bfa",
        "3": "#34d399",
        "4": "#60a5fa",
        "5": "#fbbf24"
      },
      "border": { "DEFAULT": "#4a5060", "light": "#2d3748" },
      "text": { "DEFAULT": "#e2dfda", "secondary": "#a4acb8", "muted": "#6d7788" },
      "semantic": { "success": "#3da55d", "warning": "#d4a017", "danger": "#d04848", "info": "#4a90c4" },
      "court": {
        "AATA": "#1a5276", "ARTA": "#6c3483", "FCA": "#117864",
        "FCCA": "#b9770e", "FedCFamC2G": "#a93226", "HCA": "#1b2631",
        "RRTA": "#1e8449", "MRTA": "#922b5f", "FMCA": "#b84c00"
      }
    }
  },
```

Note that `color.dark.court` (lines 35-39) is a **byte-for-byte copy** of
`color.court` (lines 15-19) — all nine values, diffed and confirmed.

### Measured contrast ratios at commit `42826a3`

Computed with the WCAG 2.x relative-luminance formula (the same one
`frontend/__tests__/css-tokens.test.ts:13-30` implements). Light backgrounds are
`#f5f4f1` (page) / `#ffffff` (card) / `#f0efec` (surface); dark backgrounds are
`#111820` / `#192230` / `#1c2535`.

| Token | value | page | card | surface | required | verdict |
|---|---|---|---|---|---|---|
| light `text.muted` | `#8b8680` | 3.28 | 3.61 | 3.14 | 4.5 | **FAIL ×3** |
| dark `text.muted` | `#6d7788` | 3.95 | 3.54 | 3.40 | 4.5 | **FAIL ×3** |
| light `text.secondary` | `#4a5568` | 6.84 | 7.53 | 6.54 | 4.5 | pass |
| dark `text.secondary` | `#a4acb8` | 7.80 | 6.99 | 6.72 | 4.5 | pass |
| light `border.DEFAULT` | `#6e7177` | 4.45 | 4.89 | 4.26 | 3.0 | pass |
| dark `border.DEFAULT` | `#4a5060` | 2.22 | 1.99 | 1.91 | 3.0 | **FAIL ×3** |
| dark `semantic.danger` | `#d04848` | 4.00 | 3.58 | 3.44 | 4.5 | **FAIL ×3** |
| dark `semantic.info` | `#4a90c4` | 5.17 | 4.63 | 4.45 | 4.5 | **FAIL ×1** |
| light `chart.3` | `#10b981` | 2.31 | 2.54 | 2.21 | 3.0 | **FAIL ×3** |
| light `chart.5` | `#f59e0b` | 1.95 | 2.15 | 1.87 | 3.0 | **FAIL ×3** |
| dark `court.HCA` | `#1b2631` | 1.16 | 1.04 | 1.00 | 3.0 | **FAIL ×3** |
| dark `court.ARTA` | `#6c3483` | 2.09 | 1.87 | 1.80 | 3.0 | **FAIL ×3** |
| dark `court.AATA` | `#1a5276` | 2.14 | 1.91 | 1.84 | 3.0 | **FAIL ×3** |
| dark `court.MRTA` | `#922b5f` | 2.33 | 2.08 | 2.00 | 3.0 | **FAIL ×3** |
| dark `court.FedCFamC2G` | `#a93226` | 2.70 | 2.42 | 2.32 | 3.0 | **FAIL ×3** |
| dark `court.FCA` | `#117864` | 3.31 | 2.97 | 2.85 | 3.0 | FAIL ×2 |
| dark `court.FMCA` | `#b84c00` | 3.46 | 3.10 | 2.98 | 3.0 | FAIL ×1 |
| dark `court.RRTA` | `#1e8449` | 3.79 | 3.39 | 3.26 | 3.0 | pass |
| dark `court.FCCA` | `#b9770e` | 4.86 | 4.35 | 4.18 | 3.0 | pass |

(Court rows are ordered worst-first. `RRTA` and `FCCA` are the only two that
already clear 3:1 on all three dark backgrounds — Step 3 leaves exactly those
two unchanged.)

White (`#ffffff`) on the accent, across the tokens.json baseline **and** all ten
themed presets in `frontend/src/hooks/use-theme-preset.ts` — this is the
`bg-accent text-white` button label:

| preset | light | dark |
|---|---|---|
| parchment (tokens.json baseline) | 9.29 | **2.71** |
| claude (shipped default) | 5.59 | **2.62** |
| ocean | 5.31 | **2.36** |
| forest | 5.02 | **3.19** |
| slate | 4.93 | **2.98** |
| rose | 5.03 | **1.81** |
| midnight | 5.33 | **2.68** |
| amber | 5.02 | **2.42** |
| nordic | 5.12 | **2.41** |
| terracotta | 5.08 | **2.93** |
| lavender | 5.16 | **2.81** |

Light mode passes everywhere; **dark mode fails 4.5:1 in all eleven**, most fail
even 3:1. This is theme-independent in the sense that no preset rescues it.

### Why the token layer is the right place (and where its reach ends)

`applyTheme()` at `frontend/src/hooks/use-theme-preset.ts:432-460` writes each
preset's vars as **inline** custom properties on `document.documentElement`,
which beat the `:root`/`.dark` rules in `tokens.css`. But presets only declare
these keys (verified across all ten themed presets): `--color-primary*`,
`--color-accent`, `--color-accent-light`, `--color-accent-muted`,
`--color-background*`, `--color-border`, `--color-border-light`, `--color-text`,
`--color-text-secondary`, `--color-text-muted`.

Therefore `--color-semantic-*`, `--color-court-*`, `--color-chart-*`, and any
new token this plan introduces come **only** from `tokens.css` and are the same
under every preset. Fixing them in `tokens.json` fixes them app-wide. In
contrast, `--color-text-muted` and `--color-border` are per-preset, so this plan
can only fix their `tokens.json` baseline (the `parchment` preset, which is
selectable from the Design Tokens page — `frontend/src/pages/DesignTokensPage.tsx:454-464`
renders a button per `Object.entries(PRESETS)` calling `setPreset(name)`).
Sweeping the other ten presets is deferred; see "Out of scope".

### RiskGauge.tsx — current state

`frontend/src/components/analytics/RiskGauge.tsx:17-27`, verbatim:

```tsx
function scoreColorClass(score: number): string {
  if (score < 40) return "text-red-500";
  if (score < 65) return "text-yellow-500";
  return "text-green-500";
}

function arcStrokeColor(score: number): string {
  if (score < 40) return "#ef4444";
  if (score < 65) return "#eab308";
  return "#22c55e";
}
```

`frontend/src/components/analytics/RiskGauge.tsx:43-44`, verbatim (note the
`<svg>` has no `role` and no `aria-label`):

```tsx
    <div data-testid="risk-gauge" className="flex flex-col items-center">
      <svg width={180} height={100} viewBox="0 0 180 100">
```

`frontend/src/components/analytics/RiskGauge.tsx:88-93`, verbatim:

```tsx
      <span
        data-testid="risk-gauge-label"
        className={`-mt-2 text-sm font-medium ${colorClass}`}
      >
        {label}
      </span>
```

On the light page background `#f5f4f1`, those three Tailwind palette colours
measure **3.42 / 1.74 / 2.07:1**. None has a `dark:` variant, so no theme
rescues them. Measured `#ef4444`=3.42, `#eab308`=1.74, `#22c55e`=2.07.

The direct test, `frontend/__tests__/risk-gauge.test.tsx:29-38`, verbatim:

```tsx
  it("applies color classes based on score thresholds", () => {
    const { rerender } = render(<RiskGauge score={25} label="Poor" />);
    expect(screen.getByTestId("risk-gauge-label")).toHaveClass("text-red-500");

    rerender(<RiskGauge score={55} label="Moderate" />);
    expect(screen.getByTestId("risk-gauge-label")).toHaveClass("text-yellow-500");

    rerender(<RiskGauge score={80} label="Good" />);
    expect(screen.getByTestId("risk-gauge-label")).toHaveClass("text-green-500");
  });
```

This test **will** fail when the classes change. Updating it is in scope.

### OutcomeStackedBar.tsx — current state

`frontend/src/components/shared/OutcomeStackedBar.tsx:4-25`, verbatim:

```tsx
// Semantic colors for common outcomes
const OUTCOME_SEGMENT_COLORS: Record<string, string> = {
  Affirmed: "#a93226",      // red - tribunal upholds rejection
  Dismissed: "#922b5f",
  Refused: "#b64040",
  Withdrawn: "#7d8a9a",
  Remitted: "#1e8449",      // green - applicant wins
  "Set Aside": "#1a5276",   // blue - set aside
  Allowed: "#117864",
  Granted: "#28b463",
  Other: "#6b7280",
};

const FALLBACK_COLORS = [
  "#1a5276",
  "#117864",
  "#6c3483",
  "#b9770e",
  "#a93226",
  "#1e8449",
  "#2e86c1",
];
```

`frontend/src/components/shared/OutcomeStackedBar.tsx:84-90`, verbatim — note
the hardcoded `text-white` on the segment percentage label:

```tsx
          {segments.map((seg) => (
            <div
              key={seg.outcome}
              title={`${seg.outcome}: ${seg.count.toLocaleString()} (${seg.pct.toFixed(1)}%)`}
              style={{ width: `${seg.pct}%`, backgroundColor: seg.color }}
              className="flex items-center justify-center text-white transition-all"
            >
```

White on the current `Withdrawn` (`#7d8a9a`) is 3.52:1 and on `Granted`
(`#28b463`) is 2.69:1 — both already fail for the 10px semibold label, and both
would get worse once dark-mode variants exist. Step 4 fixes those two values and
Step 5 replaces `text-white` with the new foreground token.

### judges/constants.ts — current state

`frontend/src/components/judges/constants.ts:1-8`, verbatim:

```ts
export const OUTCOME_COLORS = [
  "#1a5276",
  "#2d7d46",
  "#6c3483",
  "#b9770e",
  "#a83232",
  "#117864",
];
```

Consumed at `frontend/src/components/judges/JudgeCompareCard.tsx:148` and `:204`
as `fill={OUTCOME_COLORS[idx % OUTCOME_COLORS.length]}` — a Recharts `fill`
prop, which accepts a `var(--x)` string. `approvalBadgeClass` in the same file
already uses semantic tokens (`bg-success/15 text-success`) and must not change.

### index.css — current state

`frontend/src/index.css:10-12`, verbatim (the `@theme` block's accent entries;
every entry in this block uses the same self-referential `--x: var(--x)` shape —
match it):

```css
  --color-accent: var(--color-accent);
  --color-accent-light: var(--color-accent-light);
  --color-accent-muted: var(--color-accent-muted);
```

`frontend/src/index.css:27-30`, verbatim (the semantic aliases that give
Tailwind `text-danger` / `text-warning` / `text-success`):

```css
  --color-success: var(--color-semantic-success);
  --color-warning: var(--color-semantic-warning);
  --color-danger: var(--color-semantic-danger);
  --color-info: var(--color-semantic-info);
```

`frontend/src/index.css:259-276`, verbatim (`select`; note the chevron's stroke
colour `%236e7177` is `#6e7177` URL-encoded — a light-theme value baked into a
data URI, so dark mode keeps a light-theme chevron):

```css
select {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  padding: var(--spacing-2, 0.5rem) var(--spacing-8, 2rem) var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background-color: var(--color-background-card);
  background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236e7177' stroke-width='2'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right var(--spacing-2, 0.5rem) center;
  background-size: 1.25em 1.25em;
  color: var(--color-text);
  font-family: var(--font-body);
  font-size: 0.875rem;
  cursor: pointer;
  transition: border-color var(--duration-normal, 300ms) ease;
}
```

### Existing test suite this plan must not break

`frontend/__tests__/css-tokens.test.ts` (512 lines, currently green) asserts,
among other things:

- `:176-185` light `accent.DEFAULT` ≥ 4.5 on light background → `#5c4306`
  is **not changed** by this plan.
- `:187-197` light `accent.light` is `< 4.5` and is documented as a "known
  low-contrast decorative color … NOT for body text" → `#d4a017` is **not
  changed** by this plan.
- `:199-205` dark `accent.DEFAULT` ≥ 3.0 on dark background → `#c9942e` is
  **not changed** by this plan.
- `:89-105` `color.dark` contains the keys `primary, accent, background, chart,
  border, text, semantic` (a `toContain` check — adding keys is safe).
- `:112-133` every leaf under `color` and `color.dark` matches
  `/^#[0-9a-fA-F]{6}$|^rgba?\(/` — **every value you add must be a 6-digit hex
  or an `rgba(...)` string. A `color-mix(...)` value in `tokens.json` would fail
  this test**, which is why `--color-accent-hover` is defined in `index.css`
  instead.
- `:261-265` `--color-chart-2` … `--color-chart-5` exist in `tokens.css`
  (adding 1, 6, 7 is safe).

### Repo conventions this plan must honour

Quoted from `CLAUDE.md` and the codebase, because the executor has not read them:

- **Design direction is decided and named "Legal Codex"**: warm off-white
  `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text serif
  headings, 9 court-specific colour codes. Primary user is a self-representing
  immigration applicant, not a lawyer; the brand is authoritative, precise,
  academic. Do not restyle anything — only raise contrast within the existing
  hues.
- "所有間距、陰影、圓角必須從 `tokens.json` 取值,不得出現魔法數字" — all
  spacing / shadow / radius values come from `tokens.json`; no magic numbers.
  This plan extends the same rule to colour.
- "深色模式主題切換動畫速度**不得改變**" — the dark-mode toggle animation speed
  must not change. Do not touch `.theme-transitioning`, `.celestial-toggle`,
  `.ct-*` or any `--ct-*` variable.
- React: use `.toSorted()` not `.sort()`; wrap every `localStorage` call in
  try/catch; use `t("key", { defaultValue: "..." })` for UI strings; every
  Recharts `Tooltip` `contentStyle` must set `color: "var(--color-text)"`; put
  `animate-spin` on a wrapper `<div>`, not on the SVG icon.
- **i18n in tests**: the global mock in `frontend/__tests__/legislations-setup.ts`
  makes `t(key)` return the key string, ignoring `defaultValue`. Never assert on
  `defaultValue` text.
- Commit message format: `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines. Example
  from `git log`: `fix: install root node_modules in make install`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Regenerate tokens | `cd frontend && npm run tokens` | `✓ tokens.css generated` / `✓ tokens.ts generated`, **no `⚠ WARN` and no `WARN color value` lines** |
| Typecheck (working form) | `cd frontend && npx tsc -b --noEmit` | exit 0, no output |
| Frontend tests | `cd frontend && npx vitest run` | baseline at `42826a3` is `490 passed`, 55 files, 0 failed |
| Frontend lint | `cd frontend && npx eslint .` | exit 0, 0 errors |
| Production build | `cd frontend && npm run build` | exit 0 |
| Single test file | `cd frontend && npx vitest run __tests__/token-contrast.test.ts` | all pass |
| Generated files in sync | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --porcelain frontend/src/tokens/` | only your intended files listed |

Do **not** use `npx tsc --noEmit` (without `-b`): `frontend/tsconfig.json` is a
project-references stub with `"files": []`, so that form compiles zero files and
always exits 0.

## Scope

**In scope** (the only files you may modify or create):

- `frontend/src/tokens/tokens.json` — the source of truth. Hand-edited.
- `frontend/src/tokens/tokens.css` — **generated**; changes only via
  `npm run tokens`. Listed because it is tracked in git and will show in the
  diff. Never hand-edit.
- `frontend/src/tokens/tokens.ts` — same: generated, tracked, never hand-edited.
- `frontend/src/index.css`
- `frontend/src/components/analytics/RiskGauge.tsx`
- `frontend/src/components/judges/constants.ts`
- `frontend/src/components/shared/OutcomeStackedBar.tsx`
- `frontend/__tests__/risk-gauge.test.tsx` — three string literals only; it is
  the direct test of an in-scope component and cannot be left stale.
- `frontend/__tests__/token-contrast.test.ts` — **create**. New file; no other
  plan creates it.
- `frontend/src/hooks/use-theme-preset.ts` — **only under the Step 9
  condition** (plan 021 has already landed), and then only the four values
  inside the `parchment` entry. If the condition does not hold, this file must
  end the plan byte-identical to `42826a3`; Step 9 tells you what to report
  instead.

**Out of scope** (do NOT touch, even though they look related):

- `frontend/scripts/build-tokens.ts` — the generator. It is correct as it
  stands, and changing it is the first half of the deferred court-colour wiring
  (see below), not this plan.
- **The other ten theme presets** in `frontend/src/hooks/use-theme-preset.ts`
  (`claude`, `ocean`, `forest`, `slate`, `rose`, `midnight`, `amber`, `nordic`,
  `terracotta`, `lavender`). Their `--color-border` values are 1.12–1.53:1 in
  light mode and 1.28–1.99:1 in dark against their own card colours, and their
  dark `--color-text-muted` is 3.79–4.36:1 on a card — 20+ real values that need
  a coordinated palette pass. That is a separate plan and it collides with plan
  021, which owns this file. Do not start it here.
- **The 51 `bg-accent text-white` call sites and the 14 `hover:bg-accent-light`
  call sites.** This plan lands the `--color-on-solid` and
  `--color-accent-hover` tokens plus the Tailwind utilities `text-on-solid` and
  `hover:bg-accent-hover`; migrating the call sites is a mechanical follow-up
  across ~30 component files that would collide with plans 015–020 and 031.
- **The eight chart call sites that read `getCourtColor()`**
  (`TrendChart.tsx:121-122`, `CourtChart.tsx:76`, `CourtSparklineGrid.tsx:52`,
  `CourtVolumeTable.tsx:105`, `LineageFilters.tsx:150`,
  `LineageExplainer.tsx:79`, `TimelineChart.tsx:250-251,272`,
  `CourtLineagePage.tsx:343`) and the `getCourtColor` generator itself. Step 3
  authors correct dark court **values**; making the charts *read* them needs
  `scripts/build-tokens.ts` to emit a `darkCourtColors` record plus a
  theme-aware helper, then eight call-site edits. Deferred deliberately — see
  "Maintenance notes" for the exact recipe.
- `frontend/src/components/analytics/VisaFamiliesSection.tsx` — has the same
  no-`dark:`-variant defect as `RiskGauge` at lines 204-210
  (`text-emerald-500` / `text-amber-500` / `text-rose-500` on the win-rate
  figure, 2.54 / 2.15 / 3.67:1 on a white card) and five raw hexes at lines
  25-29. Real, and a direct sibling of the fix in Step 6 — but the file is
  outside this plan's territory. Recorded in "Maintenance notes".
- `frontend/src/components/analytics/OutcomeBySubclassChart.tsx`,
  `OutcomeByCourtChart.tsx`, `LegalConceptsChart.tsx` and the other 24 files
  holding the remaining hex literals.
- The eleven `--ct-*` custom properties at `frontend/src/index.css:297-309` and
  everything under "Celestial Theme Toggle". They are self-contained decorative
  values for one animated control whose behaviour `CLAUDE.md` freezes.
- `frontend/src/index.css:114-121` (`h1 { font-size: 3rem }` / `h2 { font-size:
  2rem }`) — a typography concern, not colour.
- `frontend/__tests__/css-tokens.test.ts` — leave it exactly as it is. Verified
  that none of this plan's changes breaks any of its 40 assertions; the new
  assertions go in a new file so the two plans cannot conflict.
- `frontend/src/pages/DesignTokensPage.tsx` — the token gallery. It reads
  tokens dynamically and needs no change.

## Git workflow

- Branch: `advisor/022-fix-contrast-tokens`
- Commit per step or per logical unit. Message style, matching `git log`:
  - `fix: raise the failing colour tokens to WCAG AA in both themes`
  - `feat: add on-solid foreground and accent-hover tokens`
  - `fix: give the nine court colours real dark-mode values`
  - `refactor: route outcome and judge chart colours through tokens`
  - `fix: use semantic tokens and add an aria-label in RiskGauge`
  - `test: assert token contrast in both themes`
- No AI attribution lines.
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits.

## Steps

### Step 1: Raise the six failing baseline colour values in `tokens.json`

Edit `frontend/src/tokens/tokens.json` only. Change exactly these six values,
leaving every other value byte-identical:

| JSON path | line | from | to | new ratios (page / card / surface) |
|---|---|---|---|---|
| `color.text.muted` | 13 | `#8b8680` | `#6e6a65` | 4.88 / 5.37 / 4.67 |
| `color.chart.3` | 8 | `#10b981` | `#0d9b6c` | 3.22 / 3.55 / 3.08 |
| `color.chart.5` | 10 | `#f59e0b` | `#bd7a08` | 3.21 / 3.53 / 3.07 |
| `color.dark.border.DEFAULT` | 32 | `#4a5060` | `#687087` | 3.62 / 3.24 / 3.12 |
| `color.dark.text.muted` | 33 | `#6d7788` | `#858e9e` | 5.41 / 4.84 / 4.66 |
| `color.dark.semantic.danger` | 34 | `#d04848` | `#d96d6d` | 5.41 / 4.84 / 4.66 |
| `color.dark.semantic.info` | 34 | `#4a90c4` | `#5094c6` | 5.44 / 4.87 / 4.68 |

(That table lists seven rows because `color.dark.semantic` holds two of them on
one line — seven values, six JSON lines.)

Note on `chart.3` / `chart.5`: these are chart series marks, which WCAG 1.4.11
holds to 3:1, not 4.5:1 — the new values clear 3:1 on all three light
backgrounds (worst case 3.07 on the surface background). Both currently sit at
1.87–2.54 and are the only two light chart tokens below 3:1.

Do **not** change: `color.accent.*` (the `#5c4306` / `#d4a017` pair is asserted
by three existing tests), `color.dark.accent.*` (`#c9942e` is asserted at
`css-tokens.test.ts:199-205`), `color.border.light`, `color.dark.border.light`,
`color.text.secondary`, `color.dark.text.secondary`, or any light `semantic`
value — all already pass.

Then regenerate:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npm run tokens
```

**Verify**: `cd frontend && npm run tokens` → prints `✓ tokens.css generated`
and `✓ tokens.ts generated`, and prints **no** line containing `WARN`.

**Verify**: `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --porcelain frontend/src/tokens/`
→ exactly three lines, one each for `tokens.json`, `tokens.css`, `tokens.ts`.

**Verify**: `cd frontend && grep -c '#8b8680\|#6d7788\|#4a5060\|#d04848\|#4a90c4' src/tokens/tokens.json`
→ `0`.

**Verify**: `cd frontend && npx vitest run __tests__/css-tokens.test.ts` → all
pass (this proves none of the 40 existing token assertions regressed).

### Step 2: Add the `on-solid` foreground token and the accent hover token

Two pieces: a data token in `tokens.json`, and two derived declarations plus two
`@theme` aliases in `index.css`.

**2a — `frontend/src/tokens/tokens.json`.** Add a top-level `on-solid` entry
under `color` and its mirror under `color.dark`. Place `"on-solid"` immediately
after the `"overlay"` line in each block so the generator's warning check sees a
matching pair:

- `color["on-solid"].DEFAULT` = `"#ffffff"`
- `color.dark["on-solid"].DEFAULT` = `"#111820"`

Use the `{ "DEFAULT": "…" }` shape (matching `overlay`) so the generated
variable is `--color-on-solid`, not `--color-on-solid-default`.

Why those two values, verified: `#ffffff` clears 4.5:1 against the light accent
of the tokens.json baseline and all ten presets (minimum 4.93, `slate`).
`#111820` clears 4.5:1 against the dark accent of all eleven (minimum **5.61**,
`forest`); the next-worst is 5.99. `#111820` is already the Legal Codex dark
page background, so this introduces no new colour to the palette.

Regenerate with `npm run tokens`.

**2b — `frontend/src/index.css`.** Add two aliases inside the existing `@theme`
block, immediately after line 12 (`--color-accent-muted: var(--color-accent-muted);`),
using the same self-referential shape every other entry in that block uses:

```css
  --color-accent-hover: var(--color-accent-hover);
  --color-on-solid: var(--color-on-solid);
```

Then add the derived hover colour. Insert this block **immediately before** the
`select {` rule (currently line 259), i.e. after the
`input::placeholder, textarea::placeholder { … }` rule:

```css
/* ─── Derived interaction colours ───────────────────────────── */
/* Hover darkens the accent in light mode and lightens it in dark mode, so the
   foreground (--color-on-solid) gains contrast on hover instead of losing it.
   Resolved against whatever --color-accent the active preset wrote inline on
   <html>, so it follows every preset automatically. */
:root {
  --color-accent-hover: color-mix(in oklab, var(--color-accent) 86%, black);
}

.dark {
  --color-accent-hover: color-mix(in oklab, var(--color-accent) 86%, white);
}
```

The `.dark` rule must come **after** the `:root` rule: both have specificity
(0,1,0), so source order decides.

**Verify**: `cd frontend && grep -n -- '--color-on-solid' src/tokens/tokens.css`
→ exactly two hits, `#ffffff` in the `:root` block and `#111820` in the `.dark`
block.

**Verify**: `cd frontend && grep -c 'color-mix(in oklab, var(--color-accent)' src/index.css`
→ `2`.

**Verify**: `cd frontend && npx vitest run __tests__/css-tokens.test.ts` → all
pass.

### Step 3: Give the nine court colours real dark-mode values

Edit `frontend/src/tokens/tokens.json` only. Replace the nine values in
`color.dark.court` (lines 35-39) with the palette below. `color.court` (the
light block, lines 15-19) stays **unchanged**.

| court | light (unchanged) | new dark | dark ratios (page / card / surface) | hue |
|---|---|---|---|---|
| AATA | `#1a5276` | `#2679ae` | 3.77 / 3.37 / 3.24 | 203 |
| ARTA | `#6c3483` | `#9d53bb` | 3.73 / 3.34 / 3.21 | 283 |
| FCA | `#117864` | `#12816b` | 3.72 / 3.33 / 3.21 | 168 |
| FCCA | `#b9770e` | `#b9770e` | 4.86 / 4.35 / 4.18 | 37 |
| FedCFamC2G | `#a93226` | `#d03e2f` | 3.75 / 3.36 / 3.23 | 6 |
| HCA | `#1b2631` | `#94a3b8` | 6.97 / 6.24 / 6.00 | 215 |
| RRTA | `#1e8449` | `#1e8449` | 3.79 / 3.39 / 3.26 | 145 |
| MRTA | `#922b5f` | `#c63c82` | 3.72 / 3.33 / 3.20 | 330 |
| FMCA | `#b84c00` | `#c25000` | 3.78 / 3.38 / 3.25 | 25 |

Every value clears the WCAG 1.4.11 3:1 floor on all three dark backgrounds, all
nine are distinct, and the hues stay spread across the wheel (6, 25, 37, 145,
168, 203, 215, 283, 330), so the categorical encoding still reads. `FCCA` and
`RRTA` already passed and are left identical on purpose — continuity for the two
courts that did not need changing. `HCA` moves furthest (from a near-black navy
to a light steel) because at `#1b2631` it measured 1.04:1 and was invisible; it
is deliberately desaturated so it separates from `AATA` by lightness even though
their hues are 12° apart.

Regenerate with `npm run tokens`.

**Verify**: `cd frontend && npm run tokens` → no `WARN` lines.

**Verify**:
```bash
cd frontend && python3 -c "
import json,sys
t=json.load(open('src/tokens/tokens.json'))
l,d=t['color']['court'],t['color']['dark']['court']
same=[k for k in l if l[k]==d[k]]
print('identical to light:',same)
sys.exit(0 if same==['FCCA','RRTA'] else 1)"
```
→ prints `identical to light: ['FCCA', 'RRTA']` and exits 0.

**Verify**: `cd frontend && npx vitest run __tests__/css-tokens.test.ts` → all
pass.

### Step 4: Add the outcome scale and extend the chart ramp to seven steps

Edit `frontend/src/tokens/tokens.json` only.

**4a — new `color.outcome` and `color.dark.outcome` blocks.** Add
`"outcome"` immediately after `"court"` in the light block, and after `"court"`
in the `dark` block. Nine keys each, in this order:

| key | light | dark | white-on-light | `#111820`-on-dark |
|---|---|---|---|---|
| `affirmed` | `#a93226` | `#d7594c` | 6.62 | 4.61 |
| `dismissed` | `#922b5f` | `#cd5692` | 7.68 | 4.55 |
| `refused` | `#b64040` | `#c86363` | 5.53 | 4.61 |
| `withdrawn` | `#697787` | `#7d8a9a` | 4.58 | 5.08 |
| `remitted` | `#1e8449` | `#219351` | 4.72 | 4.56 |
| `set-aside` | `#1a5276` | `#2b87c3` | 8.36 | 4.56 |
| `allowed` | `#117864` | `#159179` | 5.39 | 4.56 |
| `granted` | `#1e874a` | `#28b463` | 4.55 | 6.64 |
| `other` | `#6b7280` | `#7a8190` | 4.83 | 4.57 |

Seven of the nine light values are the existing literals from
`OutcomeStackedBar.tsx` verbatim. Two are corrected because the current values
fail the white segment label: `withdrawn` was `#7d8a9a` (white = 3.52) and
`granted` was `#28b463` (white = 2.69). Both new values keep the same hue and
saturation and only shift lightness. Every light value clears 4.5:1 against
`#ffffff` (= the light `--color-on-solid`) and every dark value clears 4.5:1
against `#111820` (= the dark `--color-on-solid`), which is what makes the
percentage labels in Step 5 legible in both themes.

**4b — extend `color.chart` and `color.dark.chart` from four keys to seven.**
Keys `"1"` through `"7"` in order, in both blocks:

| key | light | dark | light min (3 bgs) | dark min (3 bgs) |
|---|---|---|---|---|
| 1 | `#1a5276` | `#2679ae` | 7.27 | 3.24 |
| 2 | `#8b5cf6` | `#a78bfa` | 3.68 | 5.65 |
| 3 | `#0d9b6c` | `#34d399` | 3.08 | 8.00 |
| 4 | `#3b82f6` | `#60a5fa` | 3.20 | 6.05 |
| 5 | `#bd7a08` | `#fbbf24` | 3.07 | 9.21 |
| 6 | `#c2410c` | `#fb923c` | 4.50 | 6.80 |
| 7 | `#0f766e` | `#2dd4bf` | 4.76 | 8.26 |

Keys 2 and 4 are unchanged; 3 and 5 already carry the Step 1 corrections; 1, 6
and 7 are new. All seven clear 3:1 on all three backgrounds in their own mode.

Regenerate with `npm run tokens`.

**Verify**: `cd frontend && npm run tokens` → no `WARN` lines (this is the check
that both new blocks got a dark mirror).

**Verify**: `cd frontend && grep -c -- '--color-outcome-' src/tokens/tokens.css`
→ `18` (nine light + nine dark).

**Verify**: `cd frontend && grep -c -- '--color-chart-' src/tokens/tokens.css`
→ `14`.

**Verify**: `cd frontend && npx vitest run __tests__/css-tokens.test.ts` → all
pass.

### Step 5: Route `OutcomeStackedBar` and `judges/constants` through the tokens

**5a — `frontend/src/components/shared/OutcomeStackedBar.tsx`.** Replace lines
4-25 (the two constant blocks quoted in "Current state") with:

```tsx
// Outcome colours come from the token layer (src/tokens/tokens.json →
// color.outcome / color.dark.outcome) so they follow the active theme.
const OUTCOME_SEGMENT_COLORS: Record<string, string> = {
  Affirmed: "var(--color-outcome-affirmed)",
  Dismissed: "var(--color-outcome-dismissed)",
  Refused: "var(--color-outcome-refused)",
  Withdrawn: "var(--color-outcome-withdrawn)",
  Remitted: "var(--color-outcome-remitted)",
  "Set Aside": "var(--color-outcome-set-aside)",
  Allowed: "var(--color-outcome-allowed)",
  Granted: "var(--color-outcome-granted)",
  Other: "var(--color-outcome-other)",
};

const FALLBACK_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-7)",
  "var(--color-chart-2)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
];
```

Leave `getSegmentColor`, the `Segment` interface, `useMemo` usage and the
`.toSorted()` call at line 57 exactly as they are.

Then, on the segment `<div>` at line 89, replace `text-white` with
`text-on-solid`. The full className becomes:

```tsx
              className="flex items-center justify-center text-on-solid transition-all"
```

Do not change any other className in the file (`text-muted-text`,
`text-foreground` and `bg-surface` are already tokenised).

**5b — `frontend/src/components/judges/constants.ts`.** Replace lines 1-8 with:

```ts
// Chart series colours from the token layer (src/tokens/tokens.json →
// color.chart / color.dark.chart) so they follow the active theme.
export const OUTCOME_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-3)",
  "var(--color-chart-2)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
];
```

Leave `approvalBadgeClass` (lines 10-14) untouched — it already uses semantic
tokens.

**Verify**: `cd frontend && grep -cE '#[0-9a-fA-F]{6}' src/components/shared/OutcomeStackedBar.tsx src/components/judges/constants.ts`
→ both report `0`.

**Verify**: `cd frontend && npx tsc -b --noEmit` → exit 0, no output.

**Verify**: `cd frontend && npx vitest run __tests__/outcome-stacked-bar.test.tsx __tests__/judge-pages.test.tsx`
→ all pass (neither file asserts on colour values; checked at `42826a3`).

### Step 6: Use semantic tokens and add an accessible name in `RiskGauge`

**6a — `frontend/src/components/analytics/RiskGauge.tsx:17-27`.** Replace both
helpers with:

```tsx
function scoreColorClass(score: number): string {
  if (score < 40) return "text-danger";
  if (score < 65) return "text-warning";
  return "text-success";
}

function arcStrokeColor(score: number): string {
  if (score < 40) return "var(--color-semantic-danger)";
  if (score < 65) return "var(--color-semantic-warning)";
  return "var(--color-semantic-success)";
}
```

`text-danger` / `text-warning` / `text-success` are real Tailwind utilities here:
`frontend/src/index.css:27-30` maps `--color-danger: var(--color-semantic-danger)`
and its three siblings inside `@theme`. After Step 1, all four semantic colours
clear 4.5:1 on all three backgrounds in both modes (worst case: dark `success`
at 4.94 on the surface background).

**6b — accessible name.** The `<svg>` at line 44 currently has no `role` and no
`aria-label`, so a screen reader announces nothing for the gauge. Change it to:

```tsx
      <svg
        width={180}
        height={100}
        viewBox="0 0 180 100"
        role="img"
        aria-label={t("analytics.risk_gauge_aria", {
          score: clamped,
          label,
          defaultValue: `Score ${clamped} out of 100: ${label}`,
        })}
      >
```

`t` is already in scope (`const { t } = useTranslation();` at line 30). The
i18n mock in tests returns the key string and ignores `defaultValue`, so do not
write a test that asserts on the English wording.

**6c — `frontend/__tests__/risk-gauge.test.tsx:29-38`.** Change three string
literals, nothing else:

- `"text-red-500"` → `"text-danger"`
- `"text-yellow-500"` → `"text-warning"`
- `"text-green-500"` → `"text-success"`

Do not add or remove `it` blocks in this file; the count must stay at 6.

**Verify**: `cd frontend && grep -cE '#[0-9a-fA-F]{6}|text-(red|yellow|green)-500' src/components/analytics/RiskGauge.tsx`
→ `0`.

**Verify**: `cd frontend && npx vitest run __tests__/risk-gauge.test.tsx __tests__/risk-gauge-baseline.test.tsx`
→ `13 passed` (6 + 7), 0 failed.

### Step 7: Make the `select` chevron follow the theme

`frontend/src/index.css`. The chevron's stroke is `%236e7177` — `#6e7177`
URL-encoded — baked into a `background-image` data URI, so it stays a
light-theme grey in dark mode. A data URI is a separate document, so
`currentColor` does not resolve inside it; ship one URI per theme behind a
custom property instead.

Add this block **immediately before** the `select {` rule (and after the
"Derived interaction colours" block added in Step 2b):

```css
/* Select chevron: one data URI per theme — currentColor does not resolve
   inside a background-image document, so the stroke must be baked in.
   %23 is a URL-encoded "#". Colours match --color-text-muted in each mode. */
:root {
  --select-chevron: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236e6a65' stroke-width='2'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
}

.dark {
  --select-chevron: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23858e9e' stroke-width='2'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
}
```

Then, inside the `select { … }` rule, replace the whole
`background-image: url("data:…");` line with:

```css
  background-image: var(--select-chevron);
```

As in Step 2b, the `.dark` rule must come after the `:root` rule.

**Verify**: `cd frontend && grep -c 'data:image/svg+xml' src/index.css` → `2`.

**Verify**: `cd frontend && grep -c '%236e7177' src/index.css` → `0`.

**Verify**: `cd frontend && grep -c 'background-image: var(--select-chevron);' src/index.css`
→ `1`.

### Step 8: Add the contrast regression test

Create `frontend/__tests__/token-contrast.test.ts`. Model it structurally on the
two existing token tests: `frontend/__tests__/css-tokens.test.ts` (same
`getLuminance` / `getContrastRatio` helpers, same `fs.readFileSync` +
`JSON.parse` of `tokens.json`) and `frontend/__tests__/analytics-charts-tokens.test.tsx`
(reading component **source** with `fs` and asserting on it — that is the
established pattern in this repo for "no hardcoded hex" checks).

Do **not** `import` from `@/hooks/use-theme-preset` — that module calls
`applyTheme()` at import time (`use-theme-preset.ts:509`), which reaches
`window.matchMedia`, and jsdom does not define `matchMedia` in this repo's test
setup (only two individual test files stub it). Read the file as text and
extract the accent values with a regex instead.

Write exactly these 15 `it` blocks:

1. `light text.muted clears 4.5:1 on background, card and surface`
2. `dark text.muted clears 4.5:1 on background, card and surface`
3. `light text.secondary clears 4.5:1 on background, card and surface`
4. `dark text.secondary clears 4.5:1 on background, card and surface`
5. `light border.DEFAULT clears 3:1 on background, card and surface`
6. `dark border.DEFAULT clears 3:1 on background, card and surface`
7. `light on-solid clears 4.5:1 on the baseline accent and on every preset's light accent`
8. `dark on-solid clears 4.5:1 on the baseline accent and on every preset's dark accent`
9. `light semantic colours all clear 4.5:1 on background, card and surface`
10. `dark semantic colours all clear 4.5:1 on background, card and surface`
11. `dark court palette is distinct from the light palette and internally unique`
12. `dark court colours all clear 3:1 on background, card and surface`
13. `chart ramp 1-7 clears 3:1 on all three backgrounds in both modes`
14. `outcome colours clear 4.5:1 against on-solid in both modes`
15. `the three tokenised components hold no hex colour literals`

Implementation notes that make these mechanical:

- Background triples: light `["#f5f4f1", "#ffffff", "#f0efec"]` read from
  `tokensJSON.color.background.{DEFAULT,card,surface}`; dark the same paths under
  `color.dark.background`. Read them from the JSON, do not hardcode.
- For 7 and 8, extract the preset accents from the source text of
  `../src/hooks/use-theme-preset.ts` with
  `/"--color-accent":\s*"(#[0-9a-fA-F]{6})"/g` and assert there are **at least
  10** matches before looping (a guard so a refactor that renames the key fails
  loudly instead of silently testing nothing). `PRESETS` has 11 entries but
  `parchment` may declare `vars: {}` depending on whether plan 021 has landed,
  so the count is `>= 10`, not `=== 11`.
- For 11, assert exactly `["FCCA", "RRTA"]` are the keys where
  `color.court[k] === color.dark.court[k]`, and that
  `new Set(Object.values(color.dark.court)).size === 9`.
- For 15, read the three files with `fs.readFileSync`, strip `//` and `/* */`
  comments the way `frontend/__tests__/analytics-charts-tokens.test.tsx:58-60`
  does (`src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")`), then assert
  `src.match(/#[0-9a-fA-F]{6}/g) ?? []` has length 0. The three paths are
  `../src/components/analytics/RiskGauge.tsx`,
  `../src/components/judges/constants.ts`,
  `../src/components/shared/OutcomeStackedBar.tsx`.
- Every numeric assertion uses `expect(ratio).toBeGreaterThanOrEqual(4.5)` (or
  `3.0`) with a message string naming the token and the background, e.g.
  `` expect(r, `text.muted on ${bgName} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5) ``,
  so a future failure says which token broke.

**Verify**: `cd frontend && npx vitest run __tests__/token-contrast.test.ts` →
`15 passed`, 0 failed.

**Verify**: revert one value temporarily to prove the test bites —
set `color.dark.semantic.danger` back to `#d04848` in `tokens.json`, run
`cd frontend && npx vitest run __tests__/token-contrast.test.ts` → the
`dark semantic colours` test **fails**. Then restore `#d96d6d` and re-run →
`15 passed`. Do not commit the temporary revert. (Do **not** run `npm run
tokens` during this check; `tokens.json` alone drives the test.)

### Step 9: Re-sync the `parchment` preset — only if plan 021 has already landed

Plan 021 copies four of this plan's values into the `parchment` preset in
`frontend/src/hooks/use-theme-preset.ts` and adds a test asserting they match
`tokens.json` exactly. Run the condition check:

```bash
cd frontend && grep -c '"--color-text-muted": "#8b8680"' src/hooks/use-theme-preset.ts
```

- **Result `0`** — plan 021 has not landed. At commit `42826a3`, `parchment`
  declares `vars: {}` / `darkVars: {}` at `use-theme-preset.ts:64-70`, so there
  is nothing to re-sync. **Do not open this file for writing**, and instead
  **STOP and report** the following to the operator before finishing, because it
  is a live hazard the operator has to route around:

  > Plan 022 changed `tokens.json` values that plan 021's Step 1 quotes
  > verbatim. Before plan 021 runs, three hex strings in its Step 1 code block
  > must be updated: `"--color-text-muted": "#8b8680"` → `"#6e6a65"`,
  > `"--color-text-muted": "#6d7788"` → `"#858e9e"`, `"--color-border":
  > "#4a5060"` → `"#687087"`, and the `darkColors` array's 4th element
  > `"#4a5060"` → `"#687087"`. Otherwise plan 021's Step 5 test — which asserts
  > an exact match against `tokens.json` — will fail.

  Then continue to Step 10. Note that `#4a5060` still appears once in this file
  at `use-theme-preset.ts:67` (the `parchment.darkColors` swatch array); leave it
  — plan 021 rewrites that whole block.
- **Result `1`** — plan 021 has landed. Make exactly these four edits inside the
  `parchment` entry, and touch nothing else in the file:

  | location | from | to |
  |---|---|---|
  | `parchment.vars["--color-text-muted"]` | `"#8b8680"` | `"#6e6a65"` |
  | `parchment.darkVars["--color-text-muted"]` | `"#6d7788"` | `"#858e9e"` |
  | `parchment.darkVars["--color-border"]` | `"#4a5060"` | `"#687087"` |
  | `parchment.darkColors` 4th element | `"#4a5060"` | `"#687087"` |

  The fourth row is the preset-picker swatch array
  (`darkColors: ["#111820", "#c9942e", "#192230", "#4a5060"]` at
  `use-theme-preset.ts:67`); leaving it stale would show the old border colour in
  the picker.

  Do **not** touch `parchment.colors` (its 4th element is `#6e7177`, the light
  border, which this plan does not change), and do **not** touch any of the ten
  other presets.

**Verify** (branch `1` only): `cd frontend && grep -c '#8b8680\|#6d7788\|#4a5060' src/hooks/use-theme-preset.ts`
→ `0`.

**Verify** (branch `0` only): `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --porcelain frontend/src/hooks/use-theme-preset.ts`
→ **empty output** (the file must be untouched), and
`cd frontend && grep -c '#8b8680\|#6d7788' src/hooks/use-theme-preset.ts` → `0`
(those two never appear in this file at `42826a3`; only `#4a5060` does, at line
67).

**Verify** (either branch): `cd frontend && npx vitest run` → 0 failed.

### Step 10: Full verification sweep

Run all five gates from the repo root, in this order, and confirm each:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npm run tokens          # no WARN lines
npx tsc -b --noEmit     # exit 0, no output
npx eslint .            # exit 0, 0 errors
npx vitest run          # 505 passed, 0 failed
npm run build           # exit 0
```

Then confirm the generated files are exactly what the generator produces (i.e.
nobody hand-edited them):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
git status --porcelain
```

**Verify**: `npx vitest run` → `505 passed` (the `42826a3` baseline of 490, plus
the 15 new tests from Step 8; `risk-gauge.test.tsx` keeps its 6). If your Step 8
file has a different number of `it` blocks, the hard requirement is **0 failed**
and `490 + <your it count>` passed.

**Verify**: `git status --porcelain` lists **only** these paths (plus
`frontend/src/hooks/use-theme-preset.ts` if and only if the Step 9 condition
held):

```
frontend/src/tokens/tokens.json
frontend/src/tokens/tokens.css
frontend/src/tokens/tokens.ts
frontend/src/index.css
frontend/src/components/analytics/RiskGauge.tsx
frontend/src/components/judges/constants.ts
frontend/src/components/shared/OutcomeStackedBar.tsx
frontend/__tests__/risk-gauge.test.tsx
frontend/__tests__/token-contrast.test.ts
```

## Test plan

**New file**: `frontend/__tests__/token-contrast.test.ts` — 15 tests, listed
verbatim in Step 8. They cover:

- *Happy path / the AA contract*: text, border, semantic, chart, court and
  outcome tokens all meet their WCAG threshold against all three backgrounds in
  both themes.
- *The specific regressions this plan fixes*: light `text.muted` at 3.28:1
  (test 1), dark `text.muted` at 3.54:1 on a card (test 2), dark
  `border.DEFAULT` at 1.91:1 (test 6), dark `semantic.danger` at 3.44:1
  (test 10), the byte-identical court palette (tests 11 and 12), light `chart.3`
  at 2.21:1 and `chart.5` at 1.87:1 (test 13).
- *The new tokens*: `on-solid` measured against the baseline accent **and** every
  preset accent (tests 7 and 8), which is the assertion that would have caught
  the `bg-accent text-white` failure at 1.81–3.19:1.
- *Named edge cases*: `FCCA` and `RRTA` are asserted as the **only** two court
  colours identical between themes (test 11), so someone re-copying the whole
  block fails loudly; the preset-accent regex is asserted to find at least 10
  matches before looping, so a rename cannot make the test silently vacuous.
- *Anti-drift*: test 15 re-reads the three tokenised component sources and
  asserts zero hex literals, mirroring the existing guard in
  `frontend/__tests__/analytics-charts-tokens.test.tsx:45-68`.

**Modified file**: `frontend/__tests__/risk-gauge.test.tsx` — three class-name
literals updated in the existing `applies color classes based on score
thresholds` test. Test count unchanged at 6.

**Structural pattern to follow**: `frontend/__tests__/css-tokens.test.ts` for
the luminance/contrast helpers and the tokens.json loading;
`frontend/__tests__/analytics-charts-tokens.test.tsx` for the
read-source-and-assert-no-hex pattern.

**Negative test performed once, not committed**: Step 8's second verify reverts
`color.dark.semantic.danger` to `#d04848` and confirms the suite fails, proving
the assertions are live.

**Full-suite verification**: `cd frontend && npx vitest run` → 505 passed, 0
failed.

## Done criteria

ALL must hold:

- [ ] `cd frontend && npm run tokens` prints no line containing `WARN`
- [ ] `cd frontend && npx tsc -b --noEmit` exits 0 with no output
- [ ] `cd frontend && npx eslint .` exits 0 with 0 errors
- [ ] `cd frontend && npx vitest run` reports 0 failed and 505 passed (or
      `490 + <it count in token-contrast.test.ts>`)
- [ ] `cd frontend && npm run build` exits 0
- [ ] `cd frontend && npx vitest run __tests__/token-contrast.test.ts` reports
      15 passed
- [ ] `cd frontend && grep -cE '#[0-9a-fA-F]{6}' src/components/analytics/RiskGauge.tsx src/components/judges/constants.ts src/components/shared/OutcomeStackedBar.tsx`
      reports `0` for all three files
- [ ] `cd frontend && grep -cE 'text-(red|yellow|green)-500' src/components/analytics/RiskGauge.tsx`
      reports `0`
- [ ] `cd frontend && grep -c '#8b8680\|#6d7788\|#4a5060\|#d04848\|#4a90c4\|#10b981\|#f59e0b' src/tokens/tokens.json`
      reports `0`
- [ ] `cd frontend && grep -c '%236e7177' src/index.css` reports `0`
- [ ] `cd frontend && grep -c -- '--color-on-solid' src/tokens/tokens.css`
      reports `2`
- [ ] `cd frontend && grep -c -- '--color-outcome-' src/tokens/tokens.css`
      reports `18`
- [ ] `cd frontend && grep -c -- '--color-chart-' src/tokens/tokens.css`
      reports `14`
- [ ] `cd frontend && python3 -c "import json;t=json.load(open('src/tokens/tokens.json'));l,d=t['color']['court'],t['color']['dark']['court'];print(sorted(k for k in l if l[k]==d[k]))"`
      prints `['FCCA', 'RRTA']`
- [ ] `git status --porcelain` lists no file outside the "In scope" list
- [ ] `plans/README.md` status row updated — **only if that file exists**. It
      does **not** exist at commit `42826a3`; do not create it.

## STOP conditions

Stop and report back — do not improvise — if any of these occur:

- **Plan 021 is IN PROGRESS.** Check `plans/README.md`. Plan 021 rewrites the
  `parchment` preset with hex strings copied from `tokens.json` and adds a test
  asserting an exact match. Running both at once guarantees a merge conflict in
  `frontend/src/hooks/use-theme-preset.ts` and a failing test in whichever lands
  second.
- **The drift check lists any file other than `frontend/src/hooks/use-theme-preset.ts`.**
  The hex values in "Current state" are the whole basis of every number in this
  plan; if `tokens.json` moved, re-measure before touching anything.
- **`npm run tokens` prints a `⚠ WARN` line.** That means a block you added under
  `color` has no mirror under `color.dark` (or vice versa), which will leave a
  token defined in only one theme — exactly the class of bug this plan exists to
  fix. Fix the mirror; do not proceed with the warning present.
- **`git status --porcelain` shows `frontend/src/tokens/tokens.css` or
  `tokens.ts` changed without `tokens.json` also changing.** Someone (possibly
  you) hand-edited a generated file. Revert it and re-run `npm run tokens`.
- **`frontend/__tests__/css-tokens.test.ts` starts failing.** Its assertions
  about `accent.DEFAULT` (light ≥4.5), `accent.light` (light <4.5) and dark
  `accent.DEFAULT` (≥3.0) were checked against this plan's changes and should
  stay green. A failure means you changed an accent value — this plan does not.
- **You find yourself wanting to edit a preset other than `parchment`, or a
  component outside the three named files, to make a verification pass.** That
  is the deferred work in "Out of scope". Report what you found instead.
- **A verification fails twice after a reasonable fix attempt.**
- **The assumption "presets never declare `--color-semantic-*`,
  `--color-court-*`, `--color-chart-*`, `--color-outcome-*` or
  `--color-on-solid`" turns out to be false.** Check with
  `grep -c -- '--color-semantic\|--color-court\|--color-chart\|--color-outcome\|--color-on-solid' frontend/src/hooks/use-theme-preset.ts`
  → must be `0`. If it is not, the whole "fix it in tokens.json and it applies
  everywhere" premise of Steps 1, 3, 4 and 6 is broken.

## Maintenance notes

For whoever owns this code next:

- **The token pipeline is one-directional.** `tokens.json` → `npm run tokens` →
  `tokens.css` + `tokens.ts`. Both outputs are tracked in git and both are
  rewritten by `npm run build`. A hand-edit to either is guaranteed to be lost.
- **Two follow-ups are deliberately deferred, in priority order:**
  1. **Wire the dark court colours to the charts.** Step 3 authors correct
     values, but all eight chart call sites read `getCourtColor()` from the
     generated `frontend/src/tokens/tokens.ts:224`, which is a plain lookup into
     a light-mode-only record with no theme parameter. The recipe:
     (a) in `frontend/scripts/build-tokens.ts`, emit a second record
     `darkCourtColors` from `tokens.color.dark.court` alongside the existing
     `courtColors` block, and change the generated `getCourtColor` to accept an
     `isDark` argument; (b) update the eight call sites — `TrendChart.tsx:121-122`,
     `CourtChart.tsx:76`, `CourtSparklineGrid.tsx:52`, `CourtVolumeTable.tsx:105`,
     `LineageFilters.tsx:150`, `LineageExplainer.tsx:79`,
     `TimelineChart.tsx:250-251,272`, `CourtLineagePage.tsx:343` — to pass
     `isDark` from `useThemePreset()`. Until that lands, dark-mode charts still
     render the light court palette. Note those same call sites also carry the
     literal fallback `?? "#8b8680"`, which is now a stale copy of the old
     `text.muted`; fold it into the same pass.
  2. **Migrate the button call sites onto the new tokens.** 51 sites combine
     `bg-accent` with `text-white` and 14 use `hover:bg-accent-light`. After
     this plan the replacements exist: `text-white` → `text-on-solid`, and
     `hover:bg-accent-light` → `hover:bg-accent-hover`. Both are mechanical.
     Until then those buttons still measure 1.81–3.19:1 in dark mode.
- **Two sibling defects were found but are outside this plan's file territory:**
  - `frontend/src/components/analytics/VisaFamiliesSection.tsx:204-210` uses
    `text-emerald-500` / `text-amber-500` / `text-rose-500` on the win-rate
    figure with no `dark:` variant — 2.54 / 2.15 / 3.67:1 on a white card. It is
    the exact same defect Step 6 fixes in `RiskGauge`, and the same fix applies
    (`text-success` / `text-warning` / `text-danger`). The same file holds five
    raw hexes at lines 25-29 sitting in an array whose lines 21-24 are already
    `var(--color-chart-2..5)`.
  - The other ten theme presets fail the 3:1 non-text floor for
    `--color-border` in **both** modes (1.12–1.53 light, 1.28–1.99 against their
    own card), and nine of ten fail 4.5:1 for dark `--color-text-muted` on a
    card (3.79–4.36, `slate` worst). That is a 20-value palette pass across
    `frontend/src/hooks/use-theme-preset.ts` and needs a designer in the loop,
    not a mechanical nudge.
- **What a reviewer should scrutinise**: (1) that `tokens.css` and `tokens.ts`
  in the diff are exactly what `npm run tokens` emits — regenerate and diff;
  (2) the `HCA` dark value `#94a3b8`, which is the largest visual departure in
  the palette and the one most likely to draw a design objection; (3) the two
  corrected light outcome values (`withdrawn`, `granted`) — they change existing
  on-screen colours, unlike the other seven; (4) that `--color-accent-hover`'s
  `color-mix()` resolves against the **inline** `--color-accent` the active
  preset writes on `<html>`, not against the `tokens.css` default.
- **Known-stale comment left alone on purpose**:
  `frontend/__tests__/css-tokens.test.ts:89-91` still says `color.dark` is
  expected to lack `court`. That was true before Step 3 only in the sense that
  the values were a duplicate; the key has always existed. Editing that file was
  kept out of scope to avoid a collision, and the new `token-contrast.test.ts`
  covers court parity properly.
- **`--color-border-light` is intentionally left below 3:1** in both themes. It
  is used 71 times, essentially all as `border-t` / `border-b` dividers inside
  cards (`CaseCard.tsx:56`, `JudgeCard.tsx:81`,
  `ConceptEffectivenessTable.tsx:45`, `JudgeLeaderboard.tsx:116`, …). Purely
  decorative separators are exempt from WCAG 1.4.11, which applies to components
  needed to identify state or boundaries — that role belongs to
  `--color-border`, which this plan raises. If `border-light` ever starts
  carrying a form-control boundary, it needs the same treatment.

## Findings reconsidered

Nothing was dropped, but two of the six findings were materially narrower or
broader than reported, and one carried a factual error. Recorded so nobody
re-audits them:

- **"`--color-text-muted` fails in both themes and carries 585 usages" is
  overstated.** The 585 `text-muted-text` occurrences across 96 of 125 `.tsx`
  files are exact — I counted them. But the failing `#8b8680` / `#6d7788` pair
  lives in `tokens.json`, and `applyTheme()`
  (`frontend/src/hooks/use-theme-preset.ts:432-460`) writes each preset's own
  `--color-text-muted` as an **inline style on `<html>`**, which beats the
  `tokens.css` rule. Under the shipped default (`claude`) the real values are
  `#6d6857` light and `#b0ad9f` dark: 4.71 / 5.29 / 4.45 and 8.18 / 7.41 / 6.39
  — all pass. Across all ten themed presets, light muted is 4.52–4.71 on the
  page background and dark muted is 4.51–8.18. So this is **not** a 585-site
  systemic failure. It is (a) a real failure of the `parchment` preset, which is
  selectable from `DesignTokensPage.tsx:454-464` — that is why Step 1 fixes the
  baseline — and (b) a marginal miss on **cards** in dark mode for nine of ten
  presets (3.79–4.36), which is out of this plan's file territory and recorded
  in "Maintenance notes". The claim that "the app never boots on parchment" is
  also imprecise: `readStoredPreset()` migrates a *stored* `"parchment"` back to
  `"claude"` on load, so the choice does not survive a reload, but it does apply
  within the session.
- **"`--color-border` is a dark-mode-only, two-value fix" is understated.** Only
  the two `tokens.json` values are in this plan's territory, and they are fixed
  in Step 1. But I measured border-against-card for all ten themed presets and
  not one reaches 3:1 in **either** mode: 1.12–1.53 light, 1.28–1.99 dark
  (default `claude`: 1.43 light / 1.87 dark). Light `border.DEFAULT` in
  `tokens.json` (`#6e7177`, 4.26–4.89) is the *only* border value in the repo
  that passes today. The remaining 20 preset values are recorded in "Maintenance
  notes".
- **One cited location is wrong and the example it supports does not hold.** The
  primary-button finding cites `ConfirmModal.tsx:82` as the destructive
  variant's class list. Line 82 is the **default** variant; the danger branch is
  line 81 and uses `bg-danger`, which measures 6.63:1 light / 4.47:1 dark
  against white. So "the delete dialog's label fades under the pointer" is not
  true — that button is fine. The finding itself survives on the 51
  `bg-accent text-white` sites and the 14 `hover:bg-accent-light` sites, which I
  counted and confirmed, and on the dark-mode measurements tabled above.
