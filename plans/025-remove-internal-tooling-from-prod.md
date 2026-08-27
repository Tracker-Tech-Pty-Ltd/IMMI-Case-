# Plan 025: Unadvertise DesignTokensPage and single-source the colour maths

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. **Do NOT edit `plans/README.md`.** That index is
> maintained by the integration owner; several plans run in parallel and a
> shared status file is a guaranteed conflict. Report your status instead.
>
> **Read the title literally.** This plan removes one **navigation entry** and
> extracts a shared module. It does **not** remove the page from production, and
> it does **not** make the route private — see "What this plan does and does not
> achieve" below before writing any completion claim.
>
> **Drift check (run first)**. A commit-range diff cannot see uncommitted,
> staged or untracked work, so run all four commands:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> P="frontend/src/components/layout/nav-config.ts \
>    frontend/src/App.tsx \
>    frontend/src/pages/DesignTokensPage.tsx \
>    frontend/__tests__/css-tokens.test.ts \
>    frontend/src/lib/color.ts"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $P    # committed since the plan was written
> git diff --stat -- $P                  # unstaged
> git diff --cached --stat -- $P         # staged
> ```
>
> Expected: the last three print nothing, and `git status --short` lists no
> in-scope path. If any in-scope file appears in **any** of them, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> Never run `git checkout --` or `git clean -f` to "clean up" a dirty tree.
> Those destroy the operator's work. Stop and report instead.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-restore-the-frontend-compile-gate.md` — **soft, but
  real.** Every command below uses the working `npx tsc -b --noEmit` form, so
  this plan runs standalone. What 001 adds is `frontend/tsconfig.test.json`:
  without it, `frontend/__tests__/` is in no TypeScript project, so the new
  `__tests__/color.test.ts` compiles only inside Vitest's esbuild transform,
  which strips types without checking them. `frontend/src/lib/color.ts` *is*
  covered by `tsconfig.app.json` either way. Prefer running after 001; if you
  run before it, say so in your report.
- **Depends on**: `plans/021-restore-legal-codex-default.md` — **hard.** Plan
  021's drift check requires `frontend/src/pages/DesignTokensPage.tsx` to be
  unmodified since `42826a3`, and its Step 3 pins its type change against
  `getBaseColor()` at `DesignTokensPage.tsx:264-274`. This plan deletes ~176
  lines above that function, moving every line number in the file. Running this
  first makes 021 STOP on a drift it cannot distinguish from a real conflict.
- **Must run BEFORE**: `plans/024-add-accessibility-gates.md`. Both edit
  `frontend/__tests__/css-tokens.test.ts` — this plan removes the file's local
  `getLuminance` / `getContrastRatio` (Step 4), and 024 rewrites its Group 3
  contrast block, which *uses* `getContrastRatio`. If 024 runs first it will
  assume the helpers are still defined locally at lines 13–30 and its edit will
  land on the wrong lines. 024's drift check requires this plan's change to be
  present.
- **Category**: tech-debt
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

`frontend/src/pages/DesignTokensPage.tsx` is a 2,663-line internal design
showcase — colour-tone generators, an OKLCH playground, a WCAG contrast
checker, a colour-blindness simulator, a live CSS-variable editor. It is
written almost entirely in Traditional Chinese: 286 of its 2,663 lines contain
CJK characters, and the whole file makes exactly **two** `t()` i18n calls (the
page title and subtitle). Today it is registered as a top-level destination in
`APP_NAV_GROUPS`, so it renders in the sidebar and the mobile drawer for
**every** visitor, beside Cases and Analytics. This project's stated primary
user is a self-representing immigration applicant, not a lawyer and not a
designer; offering them "Design Tokens" and dropping them onto an untranslated
internal palette browser is an information-architecture and i18n defect.

Separately, that page privately defines eleven colour-science functions, and
`frontend/__tests__/css-tokens.test.ts` re-implements two of them
(`getLuminance`, `getContrastRatio`) with a *different* sRGB linearization
threshold. The suite's WCAG contrast assertions therefore validate the test's
own copy of the maths, not the copy the rendered page uses — the two can drift
apart silently and the tests will still pass.

After this plan: the page is no longer advertised in the sidebar or the mobile
drawer, and the colour maths lives in one exported module that both the page and
the test import, so a change to the algorithm is caught by the test.

### What this plan does and does not achieve

Be exact about this in the commit message and in the completion report. An
earlier draft was titled "take it out of the user-facing app", which overstates
what one nav-entry deletion can do.

**It does:**
- Remove `/design-tokens` from `APP_NAV_GROUPS`, so it disappears from
  `Sidebar.tsx` and `MobileNav.tsx` — the only two places the app advertises it.
- Give the colour maths a single implementation shared by the page and the test.

**It does not:**
- Remove the route. `App.tsx:412-418` still registers `path="design-tokens"`,
  deliberately (it is the design team's working surface).
- Make the page private. Any visitor who types `/design-tokens` gets the full
  untranslated internal showcase, including a live CSS-variable editor.
- Close the keyboard path. **`frontend/src/hooks/use-keyboard.ts:50` maps the
  `?` key to `navigate("/design-tokens")`, and `useKeyboard()` is mounted
  app-wide from `AppLayout.tsx:20`.** So pressing `?` on any page still takes
  *any* user straight there. That is a discoverable, user-facing path, not an
  obscure direct-URL one — "no longer advertised" is true of the navigation
  chrome only, and this shortcut is the reason the claim has to be qualified.
  Retargeting it needs `use-keyboard.ts` **and**
  `tests/e2e/react/test_react_keyboard.py`, neither of which this plan owns.
- Shrink the bundle. `App.tsx:81-85` already `lazy()`-loads the page.
- Remove the prefetch entry (`frontend/src/lib/prefetch.ts:18`), which is now
  simply never triggered.

**If the requirement is genuinely "internal-only", this plan is not enough** and
should not be signed off as satisfying it. That version needs: a build-time flag
or an admin role check on the route, the `?` shortcut retargeted to a real
keyboard-help overlay, the prefetch entry removed, and a verification against a
production `frontend/dist` build that an unauthenticated visitor cannot reach
the page while an authorised role still can. All of that spans `App.tsx`,
`use-keyboard.ts`, `prefetch.ts`, `MobileNav.tsx` and the E2E suite — a
different plan with a different file territory. Say so explicitly rather than
letting an IA change be read as an access-control change.

## Current state

### Files involved

- `frontend/src/components/layout/nav-config.ts` (100 lines) — the single
  source of navigation truth. Consumed by `Sidebar.tsx:75` and
  `MobileNav.tsx:64`. Line 97 registers `/design-tokens`.
- `frontend/src/App.tsx` (434 lines) — route table. Lazy-loads the page at
  lines 81–85 and registers the route at lines 412–418. **This plan does not
  modify it**; the route must keep working.
- `frontend/src/pages/DesignTokensPage.tsx` (2,663 lines) — the showcase.
  Lines 33–235 are the private colour-science library.
- `frontend/__tests__/css-tokens.test.ts` (511 lines, 44 tests) — validates
  `tokens.json` / `tokens.css` / `tokens.ts` consistency and WCAG contrast.
  Lines 13–30 are the duplicate colour maths.

### The nav entry

`frontend/src/components/layout/nav-config.ts:84-100` — verbatim:

```ts
  {
    titleKey: "nav.reference",
    items: [
      {
        to: "/legislations",
        icon: BookMarked,
        labelKey: "nav.legislations",
      },
      {
        to: "/data-dictionary",
        icon: BookOpen,
        labelKey: "nav.data_dictionary",
      },
      { to: "/design-tokens", icon: Palette, labelKey: "nav.design_tokens" },
    ],
  },
];
```

`frontend/src/components/layout/nav-config.ts:1-19` — verbatim (note `Palette`
on line 8; it is imported **only** for the entry above):

```ts
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  FileText,
  Activity,
  BookOpen,
  BookMarked,
  Palette,
  TrendingUp,
  Users,
  Network,
  Bookmark,
  BookmarkCheck,
  Tags,
  Search,
  Scale,
  ShieldCheck,
  Zap,
} from "lucide-react";
```

### The route (must survive unchanged)

`frontend/src/App.tsx:81-85` — verbatim:

```tsx
const DesignTokensPage = lazy(() =>
  import("@/pages/DesignTokensPage").then((m) => ({
    default: m.DesignTokensPage,
  })),
);
```

`frontend/src/App.tsx:412-418` — verbatim:

```tsx
              <Route
                path="design-tokens"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <DesignTokensPage />
                  </Suspense>
                }
              />
```

Because the import is `lazy()`, the page is in its own chunk and costs nothing
in the entry bundle. Removing the nav entry is therefore an IA fix, not a
bundle-size fix — do not expect the built `index-*.js` to shrink.

### The untranslated content

`frontend/src/pages/DesignTokensPage.tsx:418-426` — verbatim:

```tsx
function ThemePresetSwitcher() {
  const { preset, isDark, setPreset, toggleDark } = useThemePreset();

  return (
    <section>
      <SectionHeading id="theme">主題預設</SectionHeading>
      <p className="mb-4 text-sm text-muted-text">
        點選預設可切換全站主題顏色。切換預設時，下方的自訂顏色覆寫會一併清除。
      </p>
```

The only two i18n calls in the entire file, at
`frontend/src/pages/DesignTokensPage.tsx:2635-2642` — verbatim:

```tsx
export function DesignTokensPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-12">
      <PageHeader
        title={t("pages.design_tokens.title")}
        description={t("pages.design_tokens.subtitle")}
      />
```

### The duplicated colour maths

`frontend/src/pages/DesignTokensPage.tsx:33-56` — verbatim (start of the block
to extract; note the `0.04045` threshold on line 48):

```tsx
/* ═══════════════════════════════════════════════════════════════
   Color Utilities — OKLCH-based perceptually uniform tones
   ═══════════════════════════════════════════════════════════════ */

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  ];
}

function rgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToRgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// sRGB → Linear RGB → XYZ-D65 → Oklab
function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
```

`frontend/src/pages/DesignTokensPage.tsx:147-169` — verbatim:

```tsx
// ── WCAG helpers ────────────────────────────────────────────
function getLuminance(h: string): number {
  const rgb = hexToRgb(h);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map(rgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

type WcagLevel = "AAA" | "AA" | "AA Large" | "Fail";
function getWcagLevel(ratio: number): WcagLevel {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA Large";
  return "Fail";
}
```

The test's private twin, `frontend/__tests__/css-tokens.test.ts:11-30` —
verbatim (note the **different** threshold, `0.03928`, on line 20):

```ts
// ── Helpers ────────────────────────────────────────────────────────────

function getLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return 0.5; // fallback for non-hex (rgba etc)
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
```

`getContrastRatio` is called by the test at lines 163, 171, 182, 193 and 202.
**This threshold difference is numerically harmless for the current token
set** — it was checked before writing this plan by evaluating all five asserted
colour pairs under both thresholds; every ratio was identical to four decimal
places (13.5678 / 13.4439 / 8.4461 / 2.1598 / 6.6014). Adopting the page's
`0.04045` version therefore must not change any assertion outcome. If a test
does flip, that is a STOP condition, not something to paper over.

### Exact symbol inventory (measured, not guessed)

Defined privately in `DesignTokensPage.tsx`, none exported:

| Symbol | Line | Used outside the colour block? |
|---|---|---|
| `hexToRgb` | 37 | no — internal only |
| `rgbToLinear` | 47 | no — internal only |
| `linearToRgb` | 51 | no — internal only |
| `rgbToOklab` | 56 | no — internal only |
| `oklabToRgb` | 75 | no — internal only |
| `rgbToHex` | 98 | no — internal only |
| `generateTones` | 110 | **yes** — lines 624, 648, 710, 735 |
| `getLuminance` | 148 | no — internal only |
| `getContrastRatio` | 155 | **yes** — line 2082 |
| `type WcagLevel` | 163 | **yes** — line 2061 (`Record<WcagLevel, string>`) |
| `getWcagLevel` | 164 | **yes** — line 2083 |
| `type ColorBlindType` | 180 | **yes** — line 2167 |
| `simulateColorBlindness` | 186 | **yes** — lines 2244–2247, 2312 |

Three symbols sit *inside* lines 33–235 but must **stay** in the page because
they are not pure colour science:

- `TONE_LABELS` (lines 130–140) and `toLabelled` (lines 142–145) — presentation
  labels for the tone grid.
- `getCssVar` (lines 171–176) — reads `document.documentElement`; DOM-bound, and
  used 8 times in the page.

### Repo conventions that apply here

Quoted from `CLAUDE.md` — the executor has not read it:

- "**Use `.toSorted()` not `.sort()`** — never mutate arrays in React;
  `.toSorted()` returns a new array (ES2023, requires `"lib": ["ES2023"]` in
  `frontend/tsconfig.app.json`)."
- "**i18n defaultValue pattern** — always use
  `t("key", { defaultValue: "English text" })` for UI text."
- "**localStorage must be try-catch wrapped**."
- "**Recharts dark mode tooltips** — ALL Tooltip `contentStyle` must include
  `color: "var(--color-text)"`."
- "**animate-spin on wrapper div** — put `animate-spin` on a `<div>` wrapper,
  NOT on `<Loader2>` or `<RefreshCw>` directly."
- "**tsconfig layering** — root `frontend/tsconfig.json` is project-references
  only; do NOT add `baseUrl`/`paths`/`compilerOptions` there. All path aliases
  live in `tsconfig.app.json` only."
- "**Vitest i18n test assertions** — `__tests__/` are NOT in
  `tsconfig.app.json`'s `include: ["src"]`, so `@/*` path aliases show as TS
  errors in the editor but resolve correctly at Vitest runtime via vite alias
  config."

Design direction is already decided and is named **"Legal Codex"**: warm
off-white `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text
serif headings, nine court-specific colour codes. All spacing / shadow / radius
/ colour values come from `frontend/src/tokens/tokens.json` — no magic numbers.
`frontend/src/tokens/tokens.ts` is generated from that JSON (`npm run tokens`,
header comment `/* Auto-generated from tokens.json — do not edit manually */`)
and all three token files are git-tracked.

`frontend/tsconfig.app.json` sets `"strict": true`, `"noUnusedLocals": true`,
`"noUnusedParameters": true`, `"verbatimModuleSyntax": true`,
`"erasableSyntaxOnly": true`, and `"paths": { "@/*": ["./src/*"] }`.

Two consequences the executor must respect:

1. `noUnusedLocals` means **an unused import is a compile error**. Removing the
   nav entry without also removing the `Palette` icon import breaks `tsc -b`.
2. `verbatimModuleSyntax` means **type-only imports must use `import type`**.
   Write `import type { ColorBlindType, WcagLevel } from "@/lib/color";` as a
   separate statement from the value import.

`frontend/vitest.config.ts:23-27` provides the `@` alias to Vitest:

```ts
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
```

so `import { ... } from "@/lib/color"` resolves at test runtime. Other files in
`frontend/__tests__/` already import that way (e.g.
`__tests__/llm-council-thread.test.tsx:81` imports from `@/lib/api-llm-council`).

### Baselines measured at commit `42826a3`

| Command | Result |
|---|---|
| `cd frontend && npx tsc -b --noEmit` | exit 0 (169 source files) |
| `cd frontend && npx vitest run` | recorded as `FE_BEFORE` / `FEFILES_BEFORE` in Step 0 — this plan asserts a **delta**, never an absolute |
| `cd frontend && npx vitest run __tests__/css-tokens.test.ts` | 44 passed (a **per-file** count, stable across sibling plans, and unchanged by this plan) |
| `cd frontend && npx eslint src/pages/DesignTokensPage.tsx src/components/layout/nav-config.ts src/App.tsx __tests__/css-tokens.test.ts` | clean, no output |

**`make typecheck` is a broken gate right now** — it runs `npx tsc --noEmit`,
which exits 0 while loading **zero** files, because `frontend/tsconfig.json`
has `files: []` plus project references only. Always use `npx tsc -b --noEmit`
in this plan. (A separate plan fixes the Makefile target; do not fix it here.)

## Commands you will need

Run all frontend commands from
`/Users/d/Developer/Active Projects/IMMI-Case-/frontend`.

| Purpose | Command | Expected on success |
|---|---|---|
| Real typecheck | `npx tsc -b --noEmit` | exit 0, no output |
| Full frontend tests | `npx vitest run` | 0 failed; `Tests passed` == `FE_BEFORE` through step 4, then `FE_BEFORE + <it count in color.test.ts>` after step 5 |
| One test file | `npx vitest run __tests__/css-tokens.test.ts` | 44 passed, before and after |
| New colour test | `npx vitest run __tests__/color.test.ts` | all pass |

Absolute suite totals are deliberately absent from this table and from "Done
criteria". Several frontend plans run in parallel; a hard-coded
`490 passed / 55 files` turns any sibling plan landing first into a false STOP
and teaches the executor to edit the yardstick.
| Lint the touched files | `npx eslint src/lib/color.ts src/pages/DesignTokensPage.tsx src/components/layout/nav-config.ts __tests__/css-tokens.test.ts __tests__/color.test.ts` | exit 0, no output |
| Confirm route still registered | `grep -n 'path="design-tokens"' src/App.tsx` | prints line 413 (unchanged) |
| Confirm scope | `git status --short` (from repo root) | only the in-scope files listed |

Do **not** run `npm install` or `npm ci`; dependencies are already installed and
this plan adds none.

## Scope

**In scope** (the only files you may modify or create):

- `frontend/src/components/layout/nav-config.ts` — modify: delete one nav item
  and one now-unused icon import.
- `frontend/src/pages/DesignTokensPage.tsx` — modify: delete three blocks of
  private colour helpers, add two import statements.
- `frontend/src/lib/color.ts` — **create**. Does not exist at `42826a3`.
- `frontend/__tests__/css-tokens.test.ts` — modify: delete the two duplicated
  helpers, import them instead.
- `frontend/__tests__/color.test.ts` — **create**. Does not exist at `42826a3`.

**Out of scope** (do NOT touch, even though they look related):

- `frontend/src/App.tsx` — the route registration at lines 412–418 and the
  `lazy()` import at lines 81–85 must stay **exactly as they are**. Keeping the
  route is the whole point: the page remains reachable at `/design-tokens` for
  internal use. It is listed in the drift check because this plan's correctness
  depends on it not changing, not because you should edit it.
- `frontend/src/components/layout/Sidebar.tsx` and `MobileNav.tsx` — they read
  `APP_NAV_GROUPS` and need no change once the entry is gone.
- `frontend/src/hooks/use-keyboard.ts` — line 50 makes the `?` key navigate to
  `/design-tokens`. Leave it. It is covered by an E2E test
  (`tests/e2e/react/test_react_keyboard.py:50-63`) and changing it belongs in a
  plan that owns both files. See "Maintenance notes".
- `frontend/src/lib/prefetch.ts` — line 18 prefetches the page chunk on nav
  hover. With the nav entry gone the entry is simply never triggered; a dead
  map key is harmless and removing it belongs to the dead-code plan.
- `frontend/src/i18n/locales/en.json` and `zh-TW.json` — `nav.design_tokens`
  and `nav_descriptions.design_tokens` become unused keys. Leave them. The i18n
  catalogue is owned by another plan and an unused key breaks nothing.
- **All translation of `DesignTokensPage.tsx`'s Chinese strings.** Do not add
  `t()` calls to the showcase. It is now an internal-only surface; translating
  2,663 lines of internal tooling is not worth it and is not this plan's job.
- Anything under `tests/` (the Python/Playwright E2E suite). See "Maintenance
  notes" for why those tests are already stale independently of this change.
- `frontend/src/tokens/*` — generated artefacts.

## Git workflow

- Branch: `advisor/025-remove-internal-tooling-from-prod`
- One commit per step, or two commits total (one per finding). Message style is
  conventional commits, no AI attribution lines — matching `git log`, e.g.
  `fix: install root node_modules in make install`. Types allowed:
  `feat|fix|refactor|docs|test|chore|perf|ci`. Suggested messages:
  - Step 1 → `refactor: drop design-tokens from the user-facing nav`
  - Steps 2–4 → `refactor: extract shared colour utilities to lib/color`
  - Step 5 → `test: cover the extracted colour utilities`
- Do **not** push, open a PR, or merge. The operator commits and ships.

## Steps

### Step 0: Record the test baseline

Every suite gate below is a delta against these; nothing in this plan compares
against a number written into the file.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run 2>&1 | tail -5
#   FE_BEFORE      = "Tests  N passed"
#   FEFILES_BEFORE = "Test Files  N passed"
npx vitest run __tests__/css-tokens.test.ts 2>&1 | tail -3
#   must read 44 passed — a per-file count this plan must leave unchanged
```

### Step 1: Remove `/design-tokens` from the navigation

In `frontend/src/components/layout/nav-config.ts`:

1. Delete line 97 in its entirety:

   ```ts
         { to: "/design-tokens", icon: Palette, labelKey: "nav.design_tokens" },
   ```

2. Delete `  Palette,` from the `lucide-react` import block (line 8). It has no
   other consumer in this file, and `noUnusedLocals` turns a leftover import
   into a compile error.

Change nothing else. The `nav.reference` group keeps its two remaining items
(`/legislations`, `/data-dictionary`), so no group becomes empty and no
renderer needs a guard.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
grep -c "design-tokens\|Palette" src/components/layout/nav-config.ts; \
  grep -c 'to: "/' src/components/layout/nav-config.ts; \
  npx tsc -b --noEmit && echo TSC_OK
```

→ first `grep -c` prints `0` (it prints `2` today, before your edit); second
prints `15` (16 nav destinations today, 15 after); then `TSC_OK`.

Note `grep -c` exits 1 when the count is 0, so run it as its own statement —
do not chain it with `&&`.

**Verify the route is untouched**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -n 'path="design-tokens"' src/App.tsx
```

→ `413:                path="design-tokens"`

### Step 2: Create `frontend/src/lib/color.ts`

Create the file with the eleven colour functions and two types, **copied
verbatim** from `DesignTokensPage.tsx` lines 37–128, 148–169 and 180–235, with
`export` added to each declaration. Do not change any numeric constant, any
threshold, or any matrix coefficient — the point of this step is that the page
keeps behaving exactly as it does today.

Target shape (the header comment and the export keywords are the only
additions; the bodies are byte-for-byte the current ones):

```ts
/**
 * Shared colour utilities — OKLCH-based perceptually uniform tones and
 * WCAG contrast maths.
 *
 * Single source of truth: imported by `@/pages/DesignTokensPage` (the design
 * showcase) and by `__tests__/css-tokens.test.ts` (the token contrast gate).
 * Both must use the same implementation, otherwise the test can pass against
 * maths the app never runs.
 */

export function hexToRgb(hex: string): [number, number, number] | null { /* … */ }
export function rgbToLinear(c: number): number { /* … */ }
export function linearToRgb(c: number): number { /* … */ }
export function rgbToOklab(r: number, g: number, b: number): [number, number, number] { /* … */ }
export function oklabToRgb(L: number, a: number, b: number): [number, number, number] { /* … */ }
export function rgbToHex(r: number, g: number, b: number): string { /* … */ }
export function generateTones(hex: string, count = 8): string[] { /* … */ }
export function getLuminance(h: string): number { /* … */ }
export function getContrastRatio(hex1: string, hex2: string): number { /* … */ }
export type WcagLevel = "AAA" | "AA" | "AA Large" | "Fail";
export function getWcagLevel(ratio: number): WcagLevel { /* … */ }
export type ColorBlindType =
  | "protanopia"
  | "deuteranopia"
  | "tritanopia"
  | "achromatopsia";
export function simulateColorBlindness(hex: string, type: ColorBlindType): string { /* … */ }
```

Keep the inline comments that document provenance — the `// sRGB → Linear RGB
→ XYZ-D65 → Oklab` note above `rgbToOklab`, the
`// Based on Brettel et al. (1997) and Viénot et al. (1999) algorithms` note
above the colour-blindness section, and the JSDoc on `generateTones`.

Do **not** move `TONE_LABELS`, `toLabelled`, or `getCssVar` — they stay in the
page (see the symbol inventory in "Current state").

The file must have no imports. It is pure TypeScript with no DOM access, so it
loads cleanly in both the browser bundle and the Vitest jsdom environment.

At this point the code is duplicated (page + lib). That is intentional: the
codebase still compiles and every test still passes between steps.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -c "^export function\|^export type" src/lib/color.ts && \
  npx tsc -b --noEmit && echo TSC_OK && npx vitest run 2>&1 | tail -5
```

→ `grep -c` prints `13`; then `TSC_OK`; then 0 failed with `Tests passed` still
equal to `FE_BEFORE` (this step only duplicates code; no test result may move).

**Verify the module exports the right thirteen symbols, not merely thirteen of
something** — a count cannot tell a missing `oklabToRgb` from a stray helper:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && python3 - <<'PY'
import re, sys
src = open('src/lib/color.ts').read()
found = set(re.findall(r'^export (?:function|type) (\w+)', src, re.M))
want = {"hexToRgb","rgbToLinear","linearToRgb","rgbToOklab","oklabToRgb",
        "rgbToHex","generateTones","getLuminance","getContrastRatio",
        "WcagLevel","getWcagLevel","ColorBlindType","simulateColorBlindness"}
print("missing:", sorted(want - found))
print("unexpected:", sorted(found - want))
sys.exit(0 if found == want else 1)
PY
```
→ prints two empty lists and exits 0.

### Step 3: Point `DesignTokensPage.tsx` at the shared module

In `frontend/src/pages/DesignTokensPage.tsx`:

1. Delete these three regions (line numbers are as at `42826a3`; work from the
   bottom up so earlier line numbers stay valid):

   - Lines **178–235**: from `// ── Color Blindness Simulation ────────────────────────────`
     through the closing `}` of `simulateColorBlindness`.
   - Lines **147–169**: from `// ── WCAG helpers ────────────────────────────────────────────`
     through the closing `}` of `getWcagLevel`.
   - Lines **33–128**: from the `/* ═══…  Color Utilities — OKLCH-based perceptually uniform tones … ═══ */`
     banner comment through the closing `}` of `generateTones`.

   **Do not delete lines 130–145** (`TONE_LABELS` and `toLabelled`) or lines
   **171–176** (`getCssVar`). They sit between the deleted regions and must
   remain.

2. Add these two statements at the end of the import block at the top of the
   file — i.e. immediately after line 31,
   `import type { ImmigrationCase } from "@/types/case";`, which is the last
   import in the file:

   ```tsx
   import {
     generateTones,
     getContrastRatio,
     getWcagLevel,
     simulateColorBlindness,
   } from "@/lib/color";
   import type { ColorBlindType, WcagLevel } from "@/lib/color";
   ```

   Import **only** those six symbols. `hexToRgb`, `rgbToLinear`,
   `linearToRgb`, `rgbToOklab`, `oklabToRgb`, `rgbToHex` and `getLuminance`
   have no call site left in the page, and `noUnusedLocals` would reject them.

   The `import type` must be a separate statement — `verbatimModuleSyntax` is
   on.

Nothing else in the file changes. The page's rendered output must be
byte-identical.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -c "^function hexToRgb\|^function getLuminance\|^function simulateColorBlindness\|^function generateTones" src/pages/DesignTokensPage.tsx; \
  grep -c "^function getCssVar\|^function toLabelled" src/pages/DesignTokensPage.tsx; \
  npx tsc -b --noEmit && echo TSC_OK && npx vitest run 2>&1 | tail -5
```

→ first `grep -c` prints `0` (all four moved out); second prints `2`
(`getCssVar` and `toLabelled` still there); then `TSC_OK`; then 0 failed with
`Tests passed` still equal to `FE_BEFORE` — this step is behaviour-neutral, so
any movement in that number means something else changed.

**Verify the file shrank by roughly the extracted block**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  wc -l src/pages/DesignTokensPage.tsx
```

→ a number between `2480` and `2500` (was 2,663; ~176 lines removed, ~7 added).
If it is still 2,663 or below 2,400, something went wrong — STOP.

A line count is a smoke check, not a correctness check. The identity check is
the one that matters:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && python3 - <<'PY'
import re, sys
src = open('src/pages/DesignTokensPage.tsx').read()
gone = ["hexToRgb","rgbToLinear","linearToRgb","rgbToOklab","oklabToRgb",
        "rgbToHex","generateTones","getLuminance","getContrastRatio",
        "getWcagLevel","simulateColorBlindness"]
stay = ["getCssVar","toLabelled"]
bad  = [n for n in gone if re.search(r'^(?:function|const) %s\b' % n, src, re.M)]
lost = [n for n in stay if not re.search(r'^function %s\b' % n, src, re.M)]
print("still defined locally (should be none):", bad)
print("missing but must stay:", lost)
sys.exit(1 if bad or lost else 0)
PY
```
→ prints two empty lists and exits 0.

### Step 4: Make `css-tokens.test.ts` assert against the real implementation

In `frontend/__tests__/css-tokens.test.ts`:

1. Delete lines **13–30** — the local `getLuminance` and `getContrastRatio`
   definitions, including the `// ── Helpers ───` comment banner on line 11 only
   if nothing else lives under it (`collectLeafValues` on line 33 does, so keep
   the banner).
2. Add to the import block at the top, after line 3
   (`import * as path from "path";`):

   ```ts
   import { getContrastRatio } from "@/lib/color";
   ```

   Import only `getContrastRatio`. `getLuminance` is not called directly by
   this file — it is only used by the local `getContrastRatio`, which is now
   gone.

The five call sites at lines 163, 171, 182, 193 and 202 keep their exact
arguments and exact expectations. Do not adjust a single threshold. As stated
in "Current state", the five asserted pairs produce identical ratios under both
linearization thresholds, so all five assertions must still hold.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  grep -c "^function getLuminance\|^function getContrastRatio" __tests__/css-tokens.test.ts; \
  grep -n 'from "@/lib/color"' __tests__/css-tokens.test.ts; \
  npx vitest run __tests__/css-tokens.test.ts 2>&1 | tail -5
```

→ `grep -c` prints `0`; the import line prints; then `Tests  44 passed (44)`.

### Step 5: Add a unit test for the extracted module

Create `frontend/__tests__/color.test.ts`. Model it structurally on
`frontend/__tests__/css-tokens.test.ts` (plain `describe` / `it` / `expect`,
Vitest globals are enabled via `vitest.config.ts` `globals: true`, so imports of
`describe`/`it`/`expect` are optional but css-tokens.test.ts imports them
explicitly — match that).

Cover exactly these cases. Every expected value below was computed against the
current implementation before this plan was written, so they are facts, not
guesses:

**`getContrastRatio`**
- `getContrastRatio("#000000", "#ffffff")` → exactly `21`.
- `getContrastRatio("#ffffff", "#ffffff")` → exactly `1`.
- Symmetry: `getContrastRatio("#1b2838", "#f5f4f1")` equals
  `getContrastRatio("#f5f4f1", "#1b2838")`.
- Legal Codex navy on Legal Codex off-white:
  `getContrastRatio("#1b2838", "#f5f4f1")` → `toBeCloseTo(13.5678, 3)`.
- Non-hex input falls back rather than throwing:
  `getContrastRatio("rgba(0,0,0,0.5)", "#ffffff")` returns a finite number
  (`Number.isFinite(...)` is `true`).

**`getWcagLevel`** — boundary behaviour:
- `getWcagLevel(21)` → `"AAA"`; `getWcagLevel(7)` → `"AAA"`
- `getWcagLevel(6.99)` → `"AA"`; `getWcagLevel(4.5)` → `"AA"`
- `getWcagLevel(4.49)` → `"AA Large"`; `getWcagLevel(3)` → `"AA Large"`
- `getWcagLevel(2.99)` → `"Fail"`; `getWcagLevel(1)` → `"Fail"`

**`generateTones`**
- `generateTones("#1b2838")` has length `8`.
- Every returned entry matches `/^#[0-9a-f]{6}$/`.
- Luminance decreases strictly across the scale: for each adjacent pair,
  `getLuminance(tones[i]) > getLuminance(tones[i + 1])`.
- `generateTones("#1b2838", 3)` has length `3`.
- Invalid input falls back to `count` copies of the input:
  `generateTones("nope")` equals `Array(8).fill("nope")`.

**`simulateColorBlindness`**
- `simulateColorBlindness("#d4a017", "achromatopsia")` → exactly `"#a8a8a8"`,
  and its three channels are equal (it is a true grey).
- `simulateColorBlindness("#d4a017", "deuteranopia")` → exactly `"#d49d17"`.
- Invalid input is returned unchanged:
  `simulateColorBlindness("nope", "achromatopsia")` → `"nope"`.

**Round-trip sanity**
- `rgbToHex(...hexToRgb("#d4a017")!)` → `"#d4a017"`.
- `hexToRgb("#12345")` → `null` (wrong length).

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  npx vitest run __tests__/color.test.ts 2>&1 | tail -6
```

→ `Test Files  1 passed (1)` and all new tests pass, zero failures.

### Step 6: Run the full gates

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  npx tsc -b --noEmit && echo TSC_OK && \
  npx vitest run 2>&1 | tail -6 && \
  npx eslint src/lib/color.ts src/pages/DesignTokensPage.tsx \
    src/components/layout/nav-config.ts __tests__/css-tokens.test.ts \
    __tests__/color.test.ts && echo LINT_OK
```

→ `TSC_OK`; 0 failed, with `Test Files passed` == `FEFILES_BEFORE + 1` and
`Tests passed` == `FE_BEFORE + N`, where N is the number of `it` blocks you
added in step 5. State that arithmetic in your report. Every pre-existing test
must still pass — none may be lost. Then `LINT_OK`.

**Verify the per-file counts** (these stay valid however many sibling plans
land, unlike a suite total):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && \
  npx vitest run __tests__/css-tokens.test.ts __tests__/color.test.ts 2>&1 | tail -5
```
→ `css-tokens.test.ts` still reports 44 tests, `color.test.ts` reports N, 0
failed overall.

**Verify nothing outside scope was touched** (from the repo root):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short
```

→ exactly these five lines and nothing else (order may vary):

```
 M frontend/__tests__/css-tokens.test.ts
 M frontend/src/components/layout/nav-config.ts
 M frontend/src/pages/DesignTokensPage.tsx
?? frontend/__tests__/color.test.ts
?? frontend/src/lib/color.ts
```

(`.claude/STATE.md` may also appear as modified — it is a session-state file
this plan does not own; leave it alone.) If anything else appears, **stop and
report** — do not run `git checkout --` or `git clean`, which cannot tell your
mistake from the operator's own work.

## Test plan

- **New file `frontend/__tests__/color.test.ts`** — unit tests for the extracted
  module, enumerated in step 5: `getContrastRatio` (black/white extreme,
  identity, symmetry, the project's own navy-on-off-white pair, non-hex
  fallback), `getWcagLevel` (all four bands, tested at both sides of each of the
  three boundaries — this is the regression this plan protects, since the
  boundaries are the only place a refactor can silently change a verdict),
  `generateTones` (length, hex validity, monotonic luminance, custom count,
  invalid-input fallback), `simulateColorBlindness` (achromatopsia produces a
  true grey, deuteranopia produces the known value, invalid-input passthrough),
  and hex round-tripping.
- **Modified `frontend/__tests__/css-tokens.test.ts`** — the regression this
  plan actually fixes: its five WCAG contrast assertions now run the same
  `getContrastRatio` the page runs. Same 44 tests, same expectations, one
  implementation. Use it as the structural pattern for the new file.
- **No new component/render tests.** `DesignTokensPage.tsx` has no Vitest
  coverage today and this plan deliberately does not add any — the page is
  being demoted to internal tooling, not promoted.
- Verification: `cd frontend && npx vitest run` → **0 failed**, with
  `Test Files passed` == `FEFILES_BEFORE + 1` and `Tests passed` ==
  `FE_BEFORE + <it count in color.test.ts>` (baselines from Step 0). No absolute
  suite total is asserted anywhere in this plan — sibling frontend plans land in
  parallel and any hard-coded figure would turn one of them into a false STOP.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `cd frontend && npx vitest run` exits 0 with **0 failed**, `Tests passed`
      == `FE_BEFORE + <it count in color.test.ts>` and `Test Files passed` ==
      `FEFILES_BEFORE + 1`
- [ ] `cd frontend && npx vitest run __tests__/css-tokens.test.ts` → 44 passed
      (unchanged by this plan)
- [ ] `cd frontend && npx vitest run __tests__/color.test.ts` → 1 file passed, 0 failed
- [ ] `cd frontend && npx eslint src/lib/color.ts src/pages/DesignTokensPage.tsx src/components/layout/nav-config.ts __tests__/css-tokens.test.ts __tests__/color.test.ts` exits 0 with no output
- [ ] `grep -c "design-tokens" frontend/src/components/layout/nav-config.ts` → `0`
- [ ] `grep -c "Palette" frontend/src/components/layout/nav-config.ts` → `0`
- [ ] `grep -c 'path="design-tokens"' frontend/src/App.tsx` → `1` (route preserved)
- [ ] `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat -- frontend/src/App.tsx`
      and `git diff --cached --stat -- frontend/src/App.tsx` are both empty
      (this plan modified nothing in `App.tsx`; the commit-range form cannot
      show this once sibling plans have landed)
- [ ] `grep -c "^function getLuminance\|^function getContrastRatio" frontend/__tests__/css-tokens.test.ts` → `0`
- [ ] `grep -c 'from "@/lib/color"' frontend/__tests__/css-tokens.test.ts` → `1`
- [ ] Step 3's python identity check exits 0 (all eleven helpers gone from the
      page, `getCssVar` and `toLabelled` still present)
- [ ] Step 2's python export check exits 0 (`src/lib/color.ts` exports exactly
      the thirteen named symbols — not merely thirteen symbols)
- [ ] `git status --short` from the repo root lists no files outside the In-scope list (`.claude/STATE.md` excepted)
- [ ] The completion report states plainly that the route stays public and that
      the `?` keyboard shortcut (`use-keyboard.ts:50`) still navigates any user
      to `/design-tokens` — i.e. this is an information-architecture change, not
      an access-control one (see "What this plan does and does not achieve")
- [ ] The completion report hands the stale
      `tests/e2e/react/react_helpers.py:SIDEBAR_NAV_ITEMS` row to the operator
      (see Maintenance notes) — it is unowned by any plan in this batch
- [ ] `plans/README.md` is **unchanged** — the integration owner maintains it

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check prints any changed file, or a "Current state" excerpt does not
  match the live code at the quoted line numbers.
- **Any of the five WCAG assertions in `css-tokens.test.ts` fails after step 4.**
  That would mean the `0.03928` → `0.04045` threshold change is *not* neutral
  for the current token set, contradicting the measurement recorded in "Current
  state". Do not relax the assertion, do not keep the test's old threshold in
  the shared module, and do not edit `tokens.json`. Report the failing pair and
  both computed ratios.
- `npx tsc -b --noEmit` reports an unused-local error you cannot resolve by
  removing an import you actually made unused. In particular: if it says
  `'getLuminance' is declared but its value is never read` in
  `DesignTokensPage.tsx`, you imported too many symbols — import only the six
  listed in step 3.
- After step 3 the total Vitest count is anything other than `FE_BEFORE`. This
  step is meant to be behaviour-neutral; a changed count means something moved
  that should not have.
- The drift check shows `frontend/src/hooks/use-theme-preset.ts` unchanged since
  `42826a3` — that means `plans/021-restore-legal-codex-default.md` has **not**
  landed, and this plan is running out of order. Deleting ~176 lines from
  `DesignTokensPage.tsx` will make 021's drift check fire on arrival. Report and
  stop. (Check with
  `grep -c 'DEFAULT_PRESET' frontend/src/hooks/use-theme-preset.ts` → must be
  `5` once 021 has landed.)
- `DesignTokensPage.tsx` fails to compile because `TONE_LABELS`, `toLabelled`,
  or `getCssVar` went missing — you deleted past the boundaries in step 3.
- You find yourself wanting to edit `frontend/src/App.tsx`, `use-keyboard.ts`,
  `prefetch.ts`, `MobileNav.tsx`, `Sidebar.tsx`, or any locale JSON to make a
  step pass. All are out of scope; report instead.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

For the human or agent who owns this code next:

- **What a reviewer should scrutinise.** That `frontend/src/lib/color.ts` is a
  byte-faithful copy of the removed page code — diff the function bodies, not
  just the signatures. A single altered coefficient in `rgbToOklab` /
  `oklabToRgb` would silently change every generated tone swatch, and nothing in
  the suite renders those swatches.
- **`/design-tokens` is still reachable** at `https://<host>/design-tokens` by
  direct URL **and by pressing `?`**, and that is deliberate — it is the design
  team's working surface. If it should become genuinely private, the next step
  is an `adminOnly`-style gate **plus** retargeting the shortcut and removing
  the prefetch entry, verified against a production `frontend/dist` build (an
  unauthenticated visitor blocked, an authorised role still admitted).
  **Be aware that today's `adminOnly` flag would not have been enough:**
  `Sidebar.tsx:86` filters on it (`.filter((item) => !item.adminOnly || canViewAdmin)`)
  but `MobileNav.tsx:64-66` maps `group.items` with **no such filter**, so an
  `adminOnly` item still renders in the mobile drawer for everyone. That is a
  pre-existing leak affecting `/admin/pipeline-runs` (`nav-config.ts:75-81`)
  right now, independent of this plan; fixing it needs `MobileNav.tsx`, which
  this plan does not own. Worth a follow-up plan.
- **Two paths to the page remain and were deliberately left alone**, and the
  first of them undercuts any "users can no longer reach it" claim:
  `frontend/src/hooks/use-keyboard.ts:50` maps the `?` key to
  `navigate("/design-tokens")`, and `useKeyboard()` is mounted app-wide from
  `AppLayout.tsx:20`, so **`?` on any page still takes any user there** — a
  discoverable shortcut, not an obscure URL. `frontend/src/lib/prefetch.ts:18`
  also keeps a prefetch entry (harmless once the nav entry that triggers it is
  gone). The shortcut is asserted by
  `tests/e2e/react/test_react_keyboard.py:50-63`, so retargeting it (a global
  help/shortcuts overlay would be the obvious replacement) must be done in a
  plan that owns both the hook and that test file. Until then, keep the
  completion claim at "unadvertised", never "removed" or "internal-only".
- **HANDOFF — this plan knowingly makes an E2E helper staler, and nobody owns
  fixing it.** `tests/e2e/react/react_helpers.py:75-88` defines
  `SIDEBAR_NAV_ITEMS`, which at `42826a3` already lists `("Download", "/download")`
  and `("Pipeline", "/pipeline")` — labels that no longer exist in
  `APP_NAV_GROUPS` (they were consolidated into `/data-tools`). Since
  `click_sidebar_link` (`react_helpers.py:155-162`) does an exact-name
  `get_by_role("link", ...)` lookup, `test_react_rapid_nav.py` and
  `test_react_dark_mode.py:108-114` already fail on those entries. After this
  plan `("Design Tokens", "/design-tokens")` joins them as a **third** stale
  row — one this plan caused.

  Two honest points about that:
  1. `tests/e2e/react/**` is out of this plan's territory, and E2E is not part
     of `make test` (it needs a running Flask server and a built SPA), so it
     does not gate this work.
  2. **It is also not covered by `plans/040-revive-the-e2e-suites.md`.** That
     plan's in-scope list names `.github/workflows/ci.yml`, `frontend/e2e/**`,
     `frontend/playwright.config.ts`, `tests/e2e/README.md`,
     `tests/e2e/test_smoke.py`, `tests/e2e/react/test_react_smoke.py` and two
     Worker test files — **not** `react_helpers.py`. So "040 will fix it" would
     be false. Report this to the operator as an unowned follow-up needing
     either an addition to 040's scope or a small plan of its own.

  The right fix when someone does own it: derive `SIDEBAR_NAV_ITEMS` from
  `frontend/src/components/layout/nav-config.ts` at test-collection time (parse
  the `to:` values and resolve `labelKey` against `en.json`) rather than
  hand-maintaining a parallel list — that is what let it drift three entries out
  of date in the first place. Also retarget the `?` shortcut assertion in
  `tests/e2e/react/test_react_keyboard.py:50-63` at the same time, since it is
  the same coupling.
- **Unused i18n keys left behind on purpose**: `nav.design_tokens`
  (`en.json:28`, `zh-TW.json:28`) and `nav_descriptions.design_tokens`
  (`en.json:50`, `zh-TW.json:50`). The `pages.design_tokens.*` keys are still
  live — the page header uses them. Deleting the two nav keys belongs to the
  i18n-catalogue plan.
- **Future interaction**: if anyone adds a *user-facing* theme picker, the
  widget to lift is `ThemePresetSwitcher` (`DesignTokensPage.tsx:418`), which
  wraps `useThemePreset().setPreset`. Note the dark/light half of that control
  already exists app-wide as `frontend/src/components/layout/CelestialToggle.tsx`,
  so only the *preset* selector would be new — and it would need real `t()`
  strings, unlike the showcase.
- **Deferred out of this plan on purpose**: translating the showcase; splitting
  the still-~2,490-line `DesignTokensPage.tsx` into per-section components. The
  latter is worth doing but is a pure-churn refactor on a file no user reaches
  any more, so it ranks below almost everything else.

## Findings reconsidered

Corrections made while verifying the audit's claims against the code at
`42826a3`. These are recorded so nobody re-audits them.

- **"None of the mock form controls are labelled" (cited as
  `DesignTokensPage.tsx:1520`) — rejected, not a defect.** The block actually
  starts at line 1518, and every control there is *wrapped* in
  `<label className="block">` containing a `<span>` with the field name — e.g.
  lines 1518–1524 wrap the text input in
  `<label className="block"><span …>文字輸入</span><input … /></label>`. That is
  valid implicit label association and gives each control a proper accessible
  name. No work needed.
- **"The pagination controls are unlabelled" (cited around line 1718) —
  rejected, not a defect.** At lines 1716–1721 the previous-page arrow carries
  `aria-label="上一頁"` (and `title="上一頁"`); lines 1732–1736 do the same with
  `"下一頁"`. The numbered 1/2/3 buttons have visible text content as their
  accessible name. No work needed. With both a11y sub-claims dropped, FEUX-14
  is an information-architecture and i18n finding only — which is why this plan
  has no accessibility step.
- **"164 hardcoded Chinese strings" — corrected to a measured figure.** The
  count of *strings* was not reproducible. What is measurable:
  `grep -c '[一-鿿]' frontend/src/pages/DesignTokensPage.tsx` → `286` lines
  contain CJK characters, and the file makes exactly **2** i18n `t()` calls
  (lines 2640 and 2641). The plan quotes those numbers instead.
- **"`DEFAULT_LIGHT`/`DEFAULT_DARK` form a third source of token truth alongside
  tokens.json and the generated CSS" — rejected, and dropped from the steps.**
  They are *not* hardcoded. `DesignTokensPage.tsx:241-262` builds both maps
  entirely from the generated token module imported on line 19
  (`import { tokens, courtColors, semanticColors } from "@/tokens/tokens";`) —
  e.g. `"--color-primary": tokens.color.primary.DEFAULT`. `src/tokens/tokens.ts`
  is itself generated from `tokens.json` by `npm run tokens`
  (`scripts/build-tokens.ts`) and carries the header
  `/* Auto-generated from tokens.json — do not edit manually */`. So these maps
  are a CSS-variable-name → token-value mapping derived from the single source
  of truth, not a competing one. The audit's suggested fix ("replace them with
  reads from the generated token module") describes what the code already does.
  Left untouched.
- **"Gate it behind an env flag or an admin check like AdminPipelineRunsPage" —
  considered and rejected as the primary fix.** Adding `adminOnly: true` to the
  nav entry would hide it in `Sidebar.tsx` (which filters at line 86) but **not**
  in `MobileNav.tsx` (which does not filter at all, lines 64–66), so mobile
  users would still see it. Making that route work correctly requires editing
  `MobileNav.tsx`, which is outside this plan's file territory. Removing the nav
  entry outright achieves the finding's goal in one file with no such hole. The
  `MobileNav` filtering gap is written up in "Maintenance notes" as a follow-up.
- **"DesignTokensPage ships to end users / take it out of the shipped app" —
  scoped down.** `App.tsx:81-85` loads the page with `lazy()`, so it is already
  in its own chunk and contributes nothing to the entry bundle. There is no
  bundle-size win available here, and this plan does not claim one. The route
  is kept on purpose.
