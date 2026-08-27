# Plan 019: Stop preloading charts, both locales and a render-blocking font on every route

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` **only if that file already exists**; do not create it.
>
> All paths in this file are relative to the repository root
> `/Users/d/Developer/Active Projects/IMMI-Case-`. Use absolute paths in
> commands when your shell resets its working directory between calls.
>
> **Drift check (run first)**:
> ```bash
> git diff --stat 42826a3..HEAD -- frontend/vite.config.ts frontend/index.html frontend/src/index.css frontend/src/i18n frontend/src/lib/council-celebrations.ts
> ```
> Expected: empty output. If any in-scope file changed since this plan was
> written, compare the "Current state" excerpts below against the live code
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none. (Plan 001 repairs the repo's *typecheck gate*; this plan
  does not rely on it because every command below invokes the working
  `tsc -b` form directly rather than the broken `tsc --noEmit` form.)
- **Category**: perf
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

Every visitor to every route of the IMMI-Case SPA — including `/login`, which
draws no chart — currently downloads, parses and top-level-evaluates the entire
Recharts + d3 bundle (413,005 B raw / 119,544 B gzip), plus the Traditional
Chinese locale catalogue they are probably not using (~18.5 KB gzip), and then
waits on a fully serialised extra network round trip before a single webfont can
begin downloading. The eager critical path is 1,001,203 B raw / 307,130 B gzip
of JavaScript, of which ~40% is a charting library most routes never touch.

The primary user of this product is a self-representing immigration applicant on
an unknown connection, under stress, who needs to trust what they are looking
at. A slow, blank, font-flashing first paint is a trust cost, not just a metric.
After this plan the eager set drops to roughly 170 KB gzip, the fonts start
downloading one round trip earlier with 6 fewer faces requested, and the LLM
Council page stops shipping a confetti library before the user can type their
first question.

## Current state

### Files this plan touches

- `frontend/vite.config.ts` — Vite build config; the `manualChunks` function
  (lines 38–44) is what decides which node_modules package lands in which chunk.
- `frontend/index.html` — the SPA's HTML entry template (Vite processes it and
  emits the built `index.html`).
- `frontend/src/index.css` — global stylesheet; line 1 is a Google Fonts
  `@import`.
- `frontend/src/i18n/index.ts` — i18next bootstrap; statically imports both
  locale catalogues.
- `frontend/src/lib/council-celebrations.ts` — LLM Council delight module
  (confetti / sound / haptics / achievements).

### `frontend/vite.config.ts:33-47` (verbatim)

```ts
    build: {
      outDir: "../immi_case_downloader/static/react",
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes("node_modules/recharts") || id.includes("node_modules/victory-vendor") || id.includes("node_modules/d3-")) return "charts";
            if (id.includes("node_modules/i18next") || id.includes("node_modules/react-i18next")) return "i18n";
            if (id.includes("node_modules/@dnd-kit")) return "dnd";
            if (id.includes("node_modules/@tanstack/react-query")) return "query";
            if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/react-router")) return "vendor";
          },
        },
      },
    },
```

Recharts, victory-vendor and d3 are already in their own `charts` chunk. The
problem is **not** a missing manual chunk — it is that `clsx` (a ~200-byte
utility imported by `frontend/src/lib/utils.ts` and, transitively, by recharts)
returns `undefined` from this function, so Rollup folds it **into** the `charts`
chunk. The entry chunk then has to statically import `charts-*.js` to get it.

Proof, measured in the built artifact at HEAD:

```
$ grep -o 'from"\./charts-[A-Za-z0-9_-]*\.js"' frontend/dist/assets/index-BSeTUT7e.js
from"./charts-CTmBbytW.js"

$ grep -o 'export{[^}]*}' frontend/dist/assets/charts-CTmBbytW.js | head -1
export{jz as A,...,Y as c,...}          # `Y` is the clsx implementation
```

A static ES import evaluates the *whole* chunk, so all of Recharts and d3 is
parsed and top-level-evaluated on first paint of every route.

### `frontend/src/lib/utils.ts` (verbatim, all 6 lines)

```ts
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

(Note: this file does **not** import recharts. It is the `clsx` edge only.)

### `frontend/index.html` (verbatim, all 14 lines)

```html
<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>IMMI-Case</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

There are preconnects but **no** `<link rel="stylesheet">` for the font CSS.
A preconnect warms a socket; it cannot make an undiscovered request start
earlier.

### `frontend/src/index.css:1-3` (verbatim)

```css
@import url("https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400&family=DM+Sans:wght@300;400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600;700&family=Merriweather:wght@300;400;700;900&display=swap");
@import "tailwindcss";
@import "./tokens/tokens.css";
```

The bundler **preserves** this as the literal first rule of the emitted
`index-*.css`, so the request chain is serialised:
HTML → app CSS (94,891 B) → fonts.googleapis.com → fonts.gstatic.com.

The URL requests 18 faces: Crimson Text 4 + DM Sans 5 + IBM Plex Sans 5 +
Merriweather 4. Two of those families are waste:

- `frontend/src/tokens/tokens.css:43` — `--font-data: "DM Sans", "IBM Plex Sans", system-ui, sans-serif;`
  IBM Plex Sans is a **fallback behind DM Sans**, never a selected design font.
  Grep across `frontend/src` finds it only in that stack, in the token source
  files, and in the `DesignTokensPage` specimen list. 5 webfont weights are
  fetched for a font the design system never selects.
- `grep -rEn "font-black|font-weight:\s*900|--font-weight-black" frontend/src`
  returns **zero hits**, and `frontend/src/tokens/tokens.css:58-62` defines
  weights 300/400/500/600/700 only. Merriweather 900 is dead weight.

### `frontend/src/i18n/index.ts` (verbatim, all 47 lines)

```ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'
import zhTW from './locales/zh-TW.json'

const BCP47_MAP: Record<string, string> = {
  en: 'en-AU',
  'en-AU': 'en-AU',
  'zh-TW': 'zh-Hant-AU',
}

function syncHtmlLang(lng: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = BCP47_MAP[lng] ?? lng
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en },
      'zh-TW': { common: zhTW },
    },
    ns: ['common'],
    defaultNS: 'common',
    fallbackLng: 'en',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  })

// Sync <html lang> on every language switch (WCAG 3.1.1)
i18n.on('languageChanged', syncHtmlLang)

// Set initial value once the detected language is known
if (i18n.language) {
  syncHtmlLang(i18n.language)
}

export default i18n
```

Measured: `en.json` 59,887 B raw / 16,888 B gzip; `zh-TW.json` 59,674 B raw /
18,453 B gzip. Both land in the **entry** chunk, not the `i18n` vendor chunk:

```
$ grep -c $'[一-鿿]' frontend/dist/assets/index-BSeTUT7e.js   # → 1 (CJK present)
$ grep -c $'[一-鿿]' frontend/dist/assets/i18n-MbUvcAwQ.js    # → 0
```

Two facts the fix relies on, both already assumed by the code above:
`main.tsx` does a side-effect `import "./i18n"` before rendering, and
`i18n.language` is populated synchronously once `.init()` returns (that is
exactly what lines 43–45 depend on).

The only runtime language switcher is
`frontend/src/components/layout/Topbar.tsx:61`:
`onClick={() => i18n.changeLanguage(isZhTW ? "en" : "zh-TW")}`.

### `frontend/src/lib/council-celebrations.ts:1-12` (verbatim)

```ts
/**
 * frontend/src/lib/council-celebrations.ts
 *
 * Delight orchestration for the LLM Council — confetti, achievements,
 * sound cues, easter eggs. All effects honour prefers-reduced-motion
 * and are skippable. localStorage-tracked achievements persist across
 * sessions but degrade gracefully in incognito.
 *
 * Client-only (window/localStorage). Lazy-import in components.
 */

import confetti from "canvas-confetti";
```

The file's own header says "Lazy-import in components", yet line 12 is a
top-level static import. `canvas-confetti` therefore ships inside
`LlmCouncilPage-*.js` (231,607 B raw / 68,474 B gzip — 3.5× the next-largest
page chunk) and downloads before the user can type their first Council question.

The three functions that use it are `fireSubmitGavelBurst` (line 255),
`fireCouncilDoneCelebration` (line 271) and `fireFinalVerdictCelebration`
(line 295). All three already early-return on `prefersReducedMotion()` and
`canRunConfetti()`, all three return `void`, and no caller uses the return
value — so making the confetti load asynchronous requires **no caller changes**.

### Repo conventions that apply here

Quoted from `CLAUDE.md` and `~/.claude/rules/` — the executor has not read them:

- **localStorage must be try-catch wrapped** — every `localStorage.getItem/setItem/removeItem`
  call is wrapped; it throws in incognito/private mode and on quota exceed.
  `council-celebrations.ts:24-57` is the exemplar; do not add unwrapped calls.
- **i18n `defaultValue` pattern** — UI text uses `t("key", { defaultValue: "English text" })`.
- **Use `.toSorted()` not `.sort()`** — never mutate arrays in React.
- **No magic numbers** — all spacing/shadow/radius/colour values come from
  `frontend/src/tokens/tokens.json`.
- **Design direction is decided and named "Legal Codex"**: warm off-white
  `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text serif
  headings, 9 court-specific colour codes. Brand is authoritative, precise,
  academic. Do not change any colour, font family or motion timing in this plan
  — this is a delivery-mechanics change only.
- **Immutability / small files / explicit error handling** — see
  `~/.claude/rules/coding-style.md`. Never silently swallow an error *except*
  where the existing code deliberately does so for non-essential effects, and
  then say so in a comment (see `council-celebrations.ts:139-141`).
- **Commit format**: `<type>: <description>` where type ∈
  feat|fix|refactor|docs|test|chore|perf|ci. No AI attribution lines.
  Real example from `git log`: `fix: install root node_modules in make install`.

### Two build outputs — know which is which

- `npm run build` writes to `immi_case_downloader/static/react/` — that path is
  **tracked in git** (93 files) and is the *local-dev Flask* copy. Its committed
  content was last regenerated at commit `18a5b0c` (2026-06-17) and is already
  stale relative to HEAD. **Do not run `npm run build` in this plan** — it would
  dirty 93 tracked files that are outside this plan's scope.
- `npm run build:cloudflare` writes to `frontend/dist/` — **gitignored**
  (`frontend/.gitignore:11`) and it is the artifact production actually serves
  (`wrangler.toml:14-15` → `[assets] directory = "./frontend/dist"`; CI runs
  `npm run build:cloudflare` before `wrangler deploy`). **Use this one for every
  build in this plan.**

Both outputs exhibit the same leak because they share `vite.config.ts`; only
`outDir` differs.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install deps (only if `frontend/node_modules` is missing) | `cd frontend && npm ci` | exit 0 |
| Production build (gitignored output) | `cd frontend && npm run build:cloudflare` | exit 0, ends with `✓ built in …` |
| Typecheck | `cd frontend && npx tsc -b --noEmit` | exit 0, no output |
| Frontend unit tests | `cd frontend && npx vitest run` | `Tests  490 passed (490)`, `Test Files  55 passed (55)` |
| Frontend lint | `cd frontend && npm run lint` | exit 0; `✖ 25 problems (0 errors, 25 warnings)` at HEAD — **0 errors** is the gate, warning count may shift by ±1 |
| Working-tree check | `git status --short` | only in-scope files listed |

Baseline measured at HEAD (`42826a3`) in `frontend/dist/assets`, for comparison:

| Chunk | raw | gzip |
|---|---|---|
| `index-*.js` (entry) | 267,836 | 85,815 |
| `vendor-*.js` | 229,719 | 73,296 |
| `charts-*.js` | 413,005 | 119,544 |
| `i18n-*.js` | 55,321 | 18,013 |
| `query-*.js` | 35,322 | 10,462 |
| `index-*.css` | 94,891 | 16,042 |
| `LlmCouncilPage-*.js` | 231,607 | 68,474 |
| **eager JS total** | **1,001,203** | **307,130** |

## Scope

**In scope** (the only files you may modify):

- `frontend/vite.config.ts`
- `frontend/index.html`
- `frontend/src/index.css`
- `frontend/src/i18n/index.ts`
- `frontend/src/lib/council-celebrations.ts`

**Out of scope** (do NOT touch, even though they look related):

- `immi_case_downloader/static/react/**` — tracked build output. It is already
  stale (last built at `18a5b0c`, 2026-06-17). Regenerating it here would put
  93 unrelated files in the diff and collide with every other frontend plan.
  The operator runs one `chore: rebuild frontend bundle` after all frontend
  plans land.
- `frontend/src/components/llm-council/StreamingCouncilView.tsx` and
  `frontend/src/components/llm-council/TurnCard.tsx` — these statically import
  `react-markdown` + `remark-gfm` (the ~150 KB bulk of the Council chunk).
  Lazy-loading the markdown renderer is a real follow-up but needs a plain-text
  streaming fallback so the first SSE tokens still render; it is owned by
  another plan. Leave both files alone.
- `frontend/src/pages/LlmCouncilPage.tsx` — its line 69 value-import of
  `@/lib/council-celebrations` stays as-is. Step 5 removes the heavy dependency
  from *inside* the module, so no call site needs to change.
- `frontend/src/tokens/**` — `--font-data` keeps `"IBM Plex Sans"` in its
  fallback stack. Step 3 only stops *fetching* the webfont; the local-font
  fallback is untouched, and `frontend/__tests__/css-tokens.test.ts` asserts
  against these files.
- `frontend/package.json`, `Makefile`, `.github/workflows/**` — no build-script
  or CI wiring in this plan (see Maintenance notes for the deferred guard).
- Any colour, font family, spacing token, or animation duration. This is a
  delivery-mechanics change; the "Legal Codex" design is not being revisited.

## Git workflow

- Branch: `advisor/019-fix-the-entry-bundle` (create from `main`).
- One commit per step, conventional format, e.g.:
  - `perf: pin clsx to the vendor chunk so the entry stops preloading charts`
  - `perf: load google fonts from index.html and drop 6 unused faces`
  - `perf: load the zh-TW catalogue on demand instead of bundling it`
  - `perf: lazy-load canvas-confetti out of the council page chunk`
- Do **NOT** push, open a PR, or merge. If the operator has said they will make
  the commits themselves, leave the changes uncommitted and report instead.

## Steps

### Step 1: Establish the baseline build

Confirm the toolchain works and the leak is present before changing anything.

```bash
cd frontend && npm run build:cloudflare
```

Then record the current state:

```bash
cd frontend
grep -o 'charts-[A-Za-z0-9_-]*\.js' dist/index.html | wc -l
grep -o 'from"\./charts-[A-Za-z0-9_-]*\.js"' dist/assets/index-*.js | wc -l
grep -c $'[一-鿿]' dist/assets/index-*.js
grep -o 'fonts.googleapis.com' dist/assets/index-*.css | wc -l
grep -o '26ccff' dist/assets/LlmCouncilPage-*.js | wc -l
```

`26ccff` is a colour literal from `canvas-confetti`'s own default palette — it
is the marker used throughout this plan to prove where that library landed.

**Verify**: the build exits 0, and the five commands print, in order:
`1`, `1`, `1`, `1`, `1`. (Every `1` here is the bug.)

### Step 2: Pin the tiny shared utilities to the `vendor` chunk

Edit `frontend/vite.config.ts`. Inside `manualChunks`, insert one rule
**immediately before** the existing `charts` rule at line 39, so the block reads:

```ts
          manualChunks: (id) => {
            // Tiny shared utilities (clsx / tailwind-merge / class-variance-authority)
            // are imported by nearly every component AND by recharts. Left
            // unassigned, Rollup folds them into the "charts" chunk, which forces
            // the entry chunk to statically import charts-*.js — 413 kB raw /
            // 120 kB gzip of Recharts + d3 downloaded, parsed and top-level
            // evaluated on every route, including chart-free ones. Pinning them
            // to the always-eager "vendor" chunk makes that edge impossible.
            if (id.includes("node_modules/clsx") || id.includes("node_modules/tailwind-merge") || id.includes("node_modules/class-variance-authority")) return "vendor";
            if (id.includes("node_modules/recharts") || id.includes("node_modules/victory-vendor") || id.includes("node_modules/d3-")) return "charts";
            if (id.includes("node_modules/i18next") || id.includes("node_modules/react-i18next")) return "i18n";
            if (id.includes("node_modules/@dnd-kit")) return "dnd";
            if (id.includes("node_modules/@tanstack/react-query")) return "query";
            if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/react-router")) return "vendor";
          },
```

Change nothing else in the file.

**Verify**:

```bash
cd frontend && npm run build:cloudflare \
  && echo "html-preload: $(grep -o 'charts-[A-Za-z0-9_-]*\.js' dist/index.html | wc -l)" \
  && echo "entry-import: $(grep -o 'from"\./charts-[A-Za-z0-9_-]*\.js"' dist/assets/index-*.js | wc -l)"
```

→ build exits 0; output contains `html-preload:        0` and
`entry-import:        0` (leading whitespace from `wc -l` is fine — the digit
must be `0`).

### Step 3: Move the Google Fonts request into the HTML and trim 6 dead faces

**3a.** Delete line 1 of `frontend/src/index.css` (the
`@import url("https://fonts.googleapis.com/...")` line) entirely. The file must
now begin:

```css
@import "tailwindcss";
@import "./tokens/tokens.css";
```

**3b.** In `frontend/index.html`, add a stylesheet link directly after the two
existing preconnects, so `<head>` reads:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      rel="stylesheet"
      href="https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400&family=DM+Sans:wght@300;400;500;600;700&family=Merriweather:wght@300;400;700&display=swap"
    />
```

Two deliberate differences from the old URL: `IBM+Plex+Sans` is gone entirely
(it is a fallback in `--font-data`, never a selected design font, so 5 weights
were being fetched for nothing), and Merriweather's `900` weight is gone (no
`font-black`, no `font-weight: 900`, and no weight token above 700 exists).
That takes the request from 18 faces to 12. Keep the family names, order and
`display=swap` otherwise identical — the "Legal Codex" typography is unchanged.

**Verify**:

```bash
cd frontend && npm run build:cloudflare \
  && echo "css-import: $(grep -o 'fonts.googleapis.com' dist/assets/index-*.css | wc -l)" \
  && echo "html-link:  $(grep -o 'fonts.googleapis.com/css2' dist/index.html | wc -l)" \
  && echo "ibm-plex:   $(grep -o 'IBM+Plex+Sans' dist/index.html | wc -l)" \
  && echo "w900:       $(grep -o '700;900' dist/index.html | wc -l)"
```

→ `css-import: 0`, `html-link: 1`, `ibm-plex: 0`, `w900: 0`.

Also confirm the emitted CSS no longer starts with the import:

```bash
head -c 24 frontend/dist/assets/index-*.css
```

→ prints `@layer` / `@theme` / `:root` / `*,:before` or similar Tailwind output —
anything except `@import"https://fonts`.

### Step 4: Load the `zh-TW` catalogue on demand

Replace the entire contents of `frontend/src/i18n/index.ts` with:

```ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'

type CatalogueLoader = () => Promise<{ default: Record<string, unknown> }>

/**
 * Locale catalogues that are deliberately NOT bundled into the entry chunk.
 *
 * `en` stays a static import because it is the `fallbackLng` — every session
 * needs it. Every other catalogue is fetched on demand so a visitor never
 * downloads ~18.5 KB gzip of a language they are not using on the critical
 * path. When adding a locale, add it HERE — never as a static import.
 */
const LAZY_CATALOGUES: Record<string, CatalogueLoader> = {
  'zh-TW': () => import('./locales/zh-TW.json'),
}

const BCP47_MAP: Record<string, string> = {
  en: 'en-AU',
  'en-AU': 'en-AU',
  'zh-TW': 'zh-Hant-AU',
}

function syncHtmlLang(lng: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = BCP47_MAP[lng] ?? lng
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en },
    },
    ns: ['common'],
    defaultNS: 'common',
    fallbackLng: 'en',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      // `addResourceBundle` emits `added` on the resource STORE, not on the
      // i18n instance, so react-i18next needs `bindI18nStore` to re-render
      // once a lazily fetched catalogue arrives. Without this, switching
      // language at runtime would register the strings but never repaint.
      bindI18n: 'languageChanged loaded',
      bindI18nStore: 'added',
    },
  })

/**
 * Fetch and register a lazily bundled catalogue. Idempotent: the
 * `hasResourceBundle` guard both avoids a second network request and stops the
 * `changeLanguage` call below from recursing through the `languageChanged`
 * listener.
 */
async function ensureCatalogue(lng: string | undefined): Promise<void> {
  if (!lng) return
  const load = LAZY_CATALOGUES[lng]
  if (!load) return
  if (i18n.hasResourceBundle(lng, 'common')) return
  const mod = await load()
  i18n.addResourceBundle(lng, 'common', mod.default, true, true)
  // Re-emit languageChanged so `resolvedLanguage` and any listener bound to
  // that event pick up the newly available catalogue.
  await i18n.changeLanguage(lng)
}

// Sync <html lang> on every language switch (WCAG 3.1.1), and pull in the
// catalogue when the user switches to a lazily bundled locale at runtime
// (frontend/src/components/layout/Topbar.tsx:61).
i18n.on('languageChanged', (lng: string) => {
  syncHtmlLang(lng)
  void ensureCatalogue(lng)
})

// Top-level await: `main.tsx` does a side-effect `import "./i18n"` before it
// renders, so blocking here guarantees a zh-TW visitor never sees a frame of
// English or of raw i18n keys. English visitors load nothing extra.
await ensureCatalogue(i18n.language)

// Set initial value once the detected language is known
if (i18n.language) {
  syncHtmlLang(i18n.language)
}

export default i18n
```

Two things that may need a small, pre-authorised adjustment:

- **If `npm run build:cloudflare` fails with "Top-level await is not available
  in the configured target environment"**, add `target: "es2022",` as the first
  property of the `build` object in `frontend/vite.config.ts` (that file is in
  scope) and rebuild. `frontend/tsconfig.app.json` already sets
  `"target": "ES2022"` and `"module": "ESNext"`, so this is only about Vite's
  own default browser target.
- **If `npx tsc -b --noEmit` reports that the JSON module type is not assignable
  to `Record<string, unknown>`**, change the loader to
  `() => import('./locales/zh-TW.json').then((m) => ({ default: m.default as Record<string, unknown> }))`.

Do not make any other adjustment — anything else is a STOP condition.

**Verify (build + artifact)**:

```bash
cd frontend && npx tsc -b --noEmit && npm run build:cloudflare \
  && echo "cjk-in-entry: $(grep -c $'[一-鿿]' dist/assets/index-*.js)" \
  && echo "zh-chunks:    $(ls dist/assets/ | grep -ci 'zh-tw')" \
  && echo "cjk-chunks:   $(grep -rli $'[一-鿿]' dist/assets --include='*.js' | wc -l)"
```

→ typecheck exits 0 with no output; build exits 0; `cjk-in-entry: 0` and
`zh-chunks: 1`.

`cjk-chunks` is informational, not a gate: it is **3** at HEAD
(`index-*.js`, `LlmCouncilPage-*.js`, `DesignTokensPage-*.js` — the last two
carry their own inline CJK strings) and should still be 3 afterwards, with the
new `zh-TW-*.js` chunk taking the entry's place in that list. If
`zh-chunks` is `0`, Rollup named the dynamic-import chunk something unexpected;
run `grep -rli $'[一-鿿]' dist/assets --include='*.js'` and confirm a new,
previously absent filename appears — then treat the step as verified and note
the actual chunk name in your report.

**Verify (runtime smoke — required)**: the artifact greps prove the catalogue
moved; this proves it still *works*. Run from the repo root:

```bash
cd frontend
npx vite preview --port 4173 --strictPort > /tmp/immi-preview.log 2>&1 &
PREVIEW_PID=$!
sleep 4
node --input-type=module -e "
import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage();
const urls = [];
p.on('request', r => urls.push(r.url()));
await p.goto('http://127.0.0.1:4173/', { waitUntil: 'load' });
await p.evaluate(() => localStorage.setItem('i18nextLng', 'zh-TW'));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(2000);
const html = await p.content();
console.log('CJK_RENDERED=' + /[一-鿿]/.test(html));
console.log('ZH_CHUNK_FETCHED=' + urls.some(u => /zh.?tw/i.test(u)));
await b.close();
"
kill $PREVIEW_PID
```

→ prints `CJK_RENDERED=true` and `ZH_CHUNK_FETCHED=true`.

API calls will 404 against `vite preview` (there is no backend) — that is
expected and does not affect this check; the navigation shell renders localised
strings regardless.

If Playwright's browser binary is missing, run `npx playwright install chromium`
once and retry. If no browser can be installed in your environment, open
`http://127.0.0.1:4173/` manually, run
`localStorage.setItem('i18nextLng','zh-TW')` in the console, reload, and confirm
the navigation is in Traditional Chinese with no flash of English or of raw keys
like `nav.dashboard`. If you cannot run the smoke at all, say so explicitly in
your report — do not mark this step verified.

### Step 5: Lazy-load `canvas-confetti` out of the Council chunk

Edit `frontend/src/lib/council-celebrations.ts`. Do **not** change any function
signature, any early-return guard, any exported name, or the `COUNCIL_PALETTE`
values — call sites must keep working untouched.

**5a.** Replace line 12:

```ts
import confetti from "canvas-confetti";
```

with a type-only import (`verbatimModuleSyntax` is on, so `import type` is
required and is fully erased — it creates no runtime edge):

```ts
import type confettiDefault from "canvas-confetti";
```

**5b.** In the `// Confetti — courtroom-tasteful palette` section, immediately
after the `COUNCIL_PALETTE` array (currently lines 247–253), add:

```ts
type ConfettiFn = typeof confettiDefault;

let confettiModule: Promise<ConfettiFn> | null = null;

/**
 * canvas-confetti only ever runs after a Council run succeeds, but as a static
 * import it shipped inside the LlmCouncilPage chunk — downloaded and parsed
 * before the user could type their first question. Loading it on first use
 * keeps it out of that chunk entirely. The promise is cached so repeated
 * celebrations do not re-import.
 */
function withConfetti(run: (confetti: ConfettiFn) => void): void {
  if (!confettiModule) {
    confettiModule = import("canvas-confetti").then((m) => m.default);
  }
  confettiModule.then(run).catch(() => {
    /* swallow — confetti is non-essential delight, same policy as playCue() */
  });
}
```

**5c.** Wrap the body of each of the three confetti functions in
`withConfetti((confetti) => { ... })`, keeping the guards *outside* the wrapper
so behaviour is unchanged. The result:

```ts
export function fireSubmitGavelBurst(): void {
  if (prefersReducedMotion()) return;
  if (!canRunConfetti()) return;
  // Downward burst from top-center suggesting a gavel strike
  withConfetti((confetti) => {
    confetti({
      particleCount: 30,
      spread: 40,
      startVelocity: 35,
      angle: 270, // straight down
      origin: { x: 0.5, y: 0 },
      colors: COUNCIL_PALETTE,
      scalar: 0.7,
      ticks: 80,
    });
  });
}

export function fireCouncilDoneCelebration(): void {
  if (prefersReducedMotion()) return;
  if (!canRunConfetti()) return;
  withConfetti((confetti) => {
    // Two-side sweep — applause feel
    const end = Date.now() + 600;
    (function frame() {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: COUNCIL_PALETTE,
      });
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: COUNCIL_PALETTE,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  });
}

export function fireFinalVerdictCelebration(label: string): void {
  if (prefersReducedMotion()) return;
  if (!canRunConfetti()) return;
  const intensity =
    label.toLowerCase() === "high"
      ? 1.3
      : label.toLowerCase() === "low"
        ? 0.6
        : 1.0;
  withConfetti((confetti) => {
    confetti({
      particleCount: Math.round(120 * intensity),
      spread: 100,
      startVelocity: 45,
      origin: { y: 0.55 },
      colors: COUNCIL_PALETTE,
      ticks: 200,
    });
    if (intensity > 1.1) {
      setTimeout(() => {
        confetti({
          particleCount: 40,
          angle: 60,
          spread: 80,
          origin: { x: 0, y: 0.8 },
          colors: COUNCIL_PALETTE,
        });
        confetti({
          particleCount: 40,
          angle: 120,
          spread: 80,
          origin: { x: 1, y: 0.8 },
          colors: COUNCIL_PALETTE,
        });
      }, 250);
    }
  });
}
```

**Verify**:

```bash
cd frontend && npx tsc -b --noEmit && npm run build:cloudflare \
  && echo "confetti-in-council: $(grep -o '26ccff' dist/assets/LlmCouncilPage-*.js | wc -l)" \
  && echo "confetti-chunks:     $(grep -rl '26ccff' dist/assets | wc -l)" \
  && echo "council-bytes:       $(wc -c < $(ls dist/assets/LlmCouncilPage-*.js))"
```

→ typecheck and build exit 0; `confetti-in-council: 0`; `confetti-chunks: 1`
(one standalone chunk now owns the library); `council-bytes` is **below
231607** (expect roughly 224,000–228,000 — canvas-confetti is ~7 KB raw; the
remaining bulk is `react-markdown` + `micromark`, deliberately out of scope).

The existing unit test `frontend/__tests__/council-celebrations.test.ts` covers
`playHaptic` only and must still pass — it imports this module, which after this
change no longer pulls `canvas-confetti` into jsdom at import time.

### Step 6: Full verification sweep

```bash
cd frontend && npx tsc -b --noEmit
cd frontend && npx vitest run
cd frontend && npm run lint
cd frontend && npm run build:cloudflare
git status --short
```

**Verify**:
- `tsc -b --noEmit` → exit 0, no output.
- `vitest run` → `Test Files  55 passed (55)`, `Tests  490 passed (490)`.
- `npm run lint` → exit 0, `0 errors` (warnings ≈ 25; the count is not a gate).
- `build:cloudflare` → exit 0.
- `git status --short` lists **only** the five in-scope files (plus this plan
  file and any pre-existing `.claude/STATE.md` modification). In particular
  nothing under `immi_case_downloader/static/react/` may appear.

Then print the final eager-set comparison for the report:

```bash
cd frontend/dist/assets && for f in index-*.js vendor-*.js query-*.js i18n-*.js index-*.css; do
  printf "%-30s raw=%8d gzip=%7d\n" "$f" "$(wc -c < "$f")" "$(gzip -9 -c "$f" | wc -c)"
done
grep -o 'modulepreload' ../index.html | wc -l
```

Expected: no `charts-*.js` in that list at all, and the modulepreload count is
**3** (down from 4 — vendor, i18n, query remain; charts is gone).

## Test plan

No new test files are added. Three reasons, all verified:

1. `frontend/vitest.config.ts` sets `include: ["__tests__/**/*.{test,spec}.{ts,tsx}"]`
   resolved from the **project root**, so a test placed under
   `frontend/src/i18n/__tests__/` would be silently never collected —
   `frontend/__tests__/council-celebrations.test.ts:12-18` documents this exact
   trap, and `frontend/src/lib/__tests__/saved-searches.test.ts` is a
   pre-existing dead test file because of it.
2. `frontend/__tests__/legislations-setup.ts:64-82` globally `vi.mock`s
   `react-i18next`, so a unit test of the real i18next bootstrap cannot run
   under this setup without unpicking a global mock every other test depends on.
3. `frontend/__tests__/` is outside this plan's file territory.

Coverage therefore comes from three existing suites plus the artifact/runtime
checks embedded in the steps:

- `frontend/__tests__/council-celebrations.test.ts` — 5 tests over `playHaptic`.
  Must still pass after Step 5; it proves importing the module no longer drags
  `canvas-confetti` into jsdom.
- `frontend/__tests__/css-tokens.test.ts` — reads `frontend/src/index.css` and
  asserts the `@theme` block plus specific token declarations
  (`indexCSS` assertions at lines 335–376). None of them reference the font
  `@import`, so Step 3 must not change the result.
- `frontend/__tests__/i18n-hardcoded.test.ts` — reads
  `src/i18n/locales/en.json` and `src/i18n/locales/zh-TW.json` from disk. Step 4
  does not modify either JSON file, so it must still pass.
- Step 4's Playwright smoke is the behavioural test for lazy locale loading.
- The `grep` assertions in Steps 2–5 are the regression evidence for the four
  bundle defects.

Full-suite verification: `cd frontend && npx vitest run` → 490 passed, 55 files
(identical to the HEAD baseline — this plan adds and removes zero tests).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `cd frontend && npx vitest run` → `Test Files 55 passed`, `Tests 490 passed`
- [ ] `cd frontend && npm run lint` exits 0 with `0 errors`
- [ ] `cd frontend && npm run build:cloudflare` exits 0
- [ ] `grep -o 'charts-[A-Za-z0-9_-]*\.js' frontend/dist/index.html | wc -l` → `0`
- [ ] `grep -o 'from"\./charts-[A-Za-z0-9_-]*\.js"' frontend/dist/assets/index-*.js | wc -l` → `0`
- [ ] `grep -o 'modulepreload' frontend/dist/index.html | wc -l` → `3`
- [ ] `grep -c $'[一-鿿]' frontend/dist/assets/index-*.js` → `0`
- [ ] `ls frontend/dist/assets/ | grep -ci 'zh-tw'` → `1` (a standalone locale
      chunk now exists)
- [ ] `grep -o 'fonts.googleapis.com' frontend/dist/assets/index-*.css | wc -l` → `0`
- [ ] `grep -o 'fonts.googleapis.com/css2' frontend/dist/index.html | wc -l` → `1`
- [ ] `grep -o 'IBM+Plex+Sans' frontend/dist/index.html | wc -l` → `0`
- [ ] `grep -o '26ccff' frontend/dist/assets/LlmCouncilPage-*.js | wc -l` → `0`
- [ ] `wc -c < $(ls frontend/dist/assets/LlmCouncilPage-*.js)` → less than `231607`
- [ ] `grep -c '^import confetti from "canvas-confetti";' frontend/src/lib/council-celebrations.ts` → `0`
- [ ] `grep -c 'import("canvas-confetti")' frontend/src/lib/council-celebrations.ts` → `1`
- [ ] `grep -c "locales/zh-TW.json" frontend/src/i18n/index.ts` → `1`, and that
      one occurrence is inside `import(...)`, not a static `import … from`
- [ ] `git status --short` shows no modified file under
      `immi_case_downloader/static/react/`
- [ ] `git status --short` shows no modified file outside the five In-scope paths
      (plus `plans/019-fix-the-entry-bundle.md` and any pre-existing
      `.claude/STATE.md` change)
- [ ] Step 4's runtime smoke printed `CJK_RENDERED=true` and
      `ZH_CHUNK_FETCHED=true` (or its manual-browser equivalent was performed
      and is reported)
- [ ] `plans/README.md` status row updated **if that file exists**

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check at the top of this file shows changes to any in-scope path, or
  any "Current state" excerpt does not match the live file byte-for-byte.
- After Step 2 the entry chunk **still** statically imports `charts-*.js`. That
  means a different shared package leaked into the manual chunk. Report the
  import line verbatim — `grep -o 'import{[^}]*}from"\./charts-[^"]*"' frontend/dist/assets/index-*.js`
  names the binding — and stop. Do **not** start dissolving the `charts` manual
  chunk or reshaping unrelated chunk rules to force the number down.
- The build fails on top-level await **and** adding `target: "es2022"` to the
  `build` block in `frontend/vite.config.ts` does not fix it. Do not fall back to
  a non-blocking i18n init that would show zh-TW users a flash of English — that
  is a user-visible regression and needs a human decision.
- The Step 4 smoke shows raw i18n keys (`nav.dashboard`, `analytics.total`, …)
  or English text for a `zh-TW` session. The lazy catalogue is not reaching
  react-i18next; report and stop rather than papering over it with a timeout.
- `npx vitest run` reports fewer than 490 passing tests, or any test that
  currently passes starts failing.
- `npm run lint` reports any **error** (warnings are fine).
- `git status --short` shows anything modified under
  `immi_case_downloader/static/react/` — that means `npm run build` was run
  instead of `npm run build:cloudflare`. Run `git checkout --
  immi_case_downloader/static/react` to restore it, then re-read the
  "Two build outputs" note above before continuing.
- Fixing something appears to require editing `StreamingCouncilView.tsx`,
  `TurnCard.tsx`, `LlmCouncilPage.tsx`, `frontend/package.json`, the `Makefile`,
  or anything under `frontend/src/tokens/` — all out of scope.
- You discover the assumption "`main.tsx` imports `./i18n` for side effects
  before rendering, and `i18n.language` is populated synchronously after
  `.init()` returns" is false.

## Maintenance notes

For the human/agent who owns this code next:

- **The fragile invariant is the entry→charts edge.** Any future tiny
  node_modules package that is imported by both app code and by recharts (a new
  `cn`-style helper, an icon utility, a date formatter) will get folded into the
  `charts` chunk again and silently re-eagerize 120 KB gzip. The cheap guard is
  a post-build check that greps the emitted `dist/index.html` for
  `modulepreload.*charts-` and fails the build on a hit. That guard was
  **deliberately deferred** out of this plan because wiring it in means editing
  `frontend/package.json` / CI, which is owned elsewhere and would collide with
  parallel work. Wire it up in a follow-up.
- **Deferred, and the bigger half of the Council win**: `react-markdown` +
  `remark-gfm` are still statically imported at
  `StreamingCouncilView.tsx:19-20` and `TurnCard.tsx:32-33`, and account for the
  ~150 KB raw that remains in `LlmCouncilPage-*.js` after Step 5. Lazy-loading
  the renderer needs a plain-text fallback so the first SSE tokens still paint
  while the parser loads; that is a behavioural change to streaming, not a build
  tweak, and belongs in its own plan.
- **Adding a locale**: add it to `LAZY_CATALOGUES` in
  `frontend/src/i18n/index.ts` — never as a static `import`. `en` is the only
  catalogue that may be static, because it is `fallbackLng`.
- **`bindI18nStore: 'added'`** in the i18n init is load-bearing: without it,
  a runtime language switch to a lazily bundled locale registers the strings but
  never repaints. A reviewer should look specifically at that option and at the
  `hasResourceBundle` recursion guard in `ensureCatalogue`.
- **The committed `immi_case_downloader/static/react/` bundle is stale** — last
  regenerated at commit `18a5b0c` (2026-06-17), so it does not reflect HEAD even
  before this plan. It is the local-dev Flask copy; production serves
  `frontend/dist` (`wrangler.toml:14-15`). It also happens to be what
  `frontend/playwright.config.ts`'s `webServer` serves, so the frontend E2E suite
  is testing a two-month-old bundle. Regenerating and committing it is a
  standalone `chore:` change the operator should run once, after all frontend
  plans have landed.
- **What a reviewer should scrutinise in the PR**: (1) that no colour, font
  family or motion timing changed — "Legal Codex" is settled design; (2) that
  the trimmed font URL still lists Crimson Text, DM Sans and Merriweather with
  every weight the tokens actually declare (300/400/500/600/700 and Crimson's
  italic 400); (3) the zh-TW first-paint smoke result.

## Findings reconsidered

- **FEPERF-01's cited evidence was wrong; the conclusion was not.** The audit
  cited `frontend/src/lib/utils.ts:5` as importing recharts. It does not — the
  whole file is 6 lines and imports only `clsx` and `tailwind-merge`
  (line 5 is `return twMerge(clsx(inputs))`). The real mechanism, verified in the
  built artifact, is that `clsx` returns `undefined` from `manualChunks` and
  Rollup folds it into the `charts` chunk, so the entry must statically import
  `charts-*.js` to reach it. Step 2 fixes the actual edge. The audit also cited
  `immi_case_downloader/static/react/index.html:13` as "the production
  artifact"; that path is the local-dev Flask copy and its committed content is
  from 2026-06-17. Production serves `frontend/dist/index.html`
  (`wrangler.toml:14-15`). Both files show the leak, so the finding stands.

- **FEPERF-11 (chunk graph over-fragmentation) — not actioned, deliberately.**
  Re-counted at HEAD in `frontend/dist/assets`: **90** JS chunks, **51** of them
  under 2 KB (the audit said 49/90, the verifier 50/89). The per-icon splitting
  is real. But the load-bearing claim is not: the DashboardPage `__vite__mapDeps`
  list includes the vendor, query, i18n and charts chunks, all already
  modulepreloaded from `index.html`, so the incremental fan-out on that
  navigation is ~20 requests, not 24 — small, immutably-cached, HTTP/2-muxed
  responses to Cloudflare. The audit itself rated this LOW and recommended
  measuring before acting. Acting on it *now* would also mean reshaping
  `manualChunks` in the same commit that repairs a `manualChunks` mistake, which
  is exactly how the eager-edge class of bug gets reintroduced. Re-measure real
  route-transition timing after this plan lands; if it still matters, the
  cheapest lever is `if (id.includes("node_modules/lucide-react")) return "icons";`
  plus `<link rel="prefetch">`-on-hover for the primary nav routes.

- **FEPERF-10 is only half-fixed here, on purpose.** Step 5 removes
  `canvas-confetti` (~7 KB raw) from the Council chunk, which is the part that
  lives inside this plan's file territory and the part the module's own docstring
  already promised. `react-markdown` + `remark-gfm` — the ~150 KB majority —
  require editing `StreamingCouncilView.tsx` and `TurnCard.tsx`, which are out of
  scope; see Maintenance notes. The audit's third claimed call site,
  `AchievementToast.tsx:14`, is an erased `import type` and is not a violation at
  all, so nothing there needed changing.
