# Plan 035: Clear the 8 production advisories and the manifest hygiene issues

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — if that file does not exist, skip that (do not create it).
>
> **Drift check (run first)**. A `42826a3..HEAD` diff is blind to uncommitted,
> staged and untracked work, so run **all four** commands; a dirty tree would
> otherwise hand you a false all-clear. Any in-scope path appearing in any of
> them is a STOP condition, and you must **never** run an unconditional
> `git checkout -- …`, `git restore …` or `git clean -f` to clear it — those
> changes may be the operator's.
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> PATHS='frontend/package.json frontend/package-lock.json frontend/__tests__'
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $PATHS
> git diff --stat               -- $PATHS   # unstaged
> git diff --cached --stat      -- $PATHS   # staged
> git status --short --untracked-files=all -- $PATHS
> ```
> On a mismatch, compare the "Current state" excerpts against the live files; if
> they differ, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

`frontend/package-lock.json` has not been regenerated since 2026-08-24 and now
carries **17 npm advisories (2 low, 1 moderate, 12 high, 2 critical)**, every one
of which npm reports as `fixAvailable: true` — i.e. fixable *inside the caret
ranges already declared in `package.json`*, with no semver-major bump and no
`--force`.

Be precise about exposure, because the headline number overstates it. The
production-reachable set is much smaller than 17:

- `npm audit --omit=dev` reports **8 vulnerabilities (1 low, 7 high)** — but
  **7 of those 8 are only in the "production" query because build-only tooling
  is misfiled as a runtime dependency**. `@tailwindcss/vite` sits in
  `dependencies`, and it drags `vite → {rollup, postcss → nanoid, picomatch,
  esbuild}` into the production closure. None of that ships to a browser.
- The genuinely browser-reachable defects are the two **moderate** open-redirect
  bugs in `react-router` (`Open redirect via backslash in <Link> and
  useNavigate`, and `same-origin redirect with path starting //` reinterpreted as
  a protocol-relative URL). Every **high**/**critical** react-router advisory is
  SSR / RSC / single-fetch / `__manifest` server-side, and this SPA mounts a
  plain client-side `<BrowserRouter>` with no SSR anywhere, so those paths do
  not exist here. The two criticals are the single `@vitest/ui` advisory, which
  only fires when someone runs `vitest --ui`.

So the value of this plan is: (a) close two real open-redirect bugs in a product
whose primary user is a self-representing immigration applicant — exactly the
population a redirect-based phishing lure targets; (b) restore
`npm audit --omit=dev` as a *trustworthy* signal by getting build tooling out of
the production closure, so the next person triaging this repo is not reading
seven phantom highs; (c) drop a dependency (`class-variance-authority`) that has
zero references anywhere in the codebase.

After this plan, both `npm audit` and `npm audit --omit=dev` report
**"found 0 vulnerabilities"**, and the production lockfile closure shrinks from
297 entries to 192.

## Current state

Files in scope, and their role:

- `frontend/package.json` — manifest for the React 19 / TypeScript / Vite 7 SPA.
  Misfiles three build/type-only packages in `dependencies` and declares one
  unused package.
- `frontend/package-lock.json` — resolved dependency tree; carries the stale
  versions that produce the 17 advisories.

### `frontend/package.json` — the `dependencies` block, verbatim (lines 22–47)

```json
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/modifiers": "^9.0.0",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@radix-ui/react-dialog": "^1.1.15",
    "@tailwindcss/vite": "^4.2.0",
    "@tanstack/react-query": "^5.90.21",
    "@types/canvas-confetti": "^1.9.0",
    "canvas-confetti": "^1.9.4",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "i18next": "^25.8.11",
    "i18next-browser-languagedetector": "^8.2.1",
    "lucide-react": "^0.564.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-i18next": "^16.5.4",
    "react-markdown": "^10.1.0",
    "react-router-dom": "^7.13.0",
    "recharts": "^3.7.0",
    "remark-gfm": "^4.0.1",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.5.0",
    "tailwindcss": "^4.1.18"
  },
```

Key lines: `frontend/package.json:28` `@tailwindcss/vite`,
`:30` `@types/canvas-confetti`, `:32` `class-variance-authority`,
`:41` `react-router-dom`, `:46` `tailwindcss`.

### `frontend/package.json` — the `devDependencies` block, verbatim (lines 48–70)

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

Key lines: `frontend/package.json:59` `@vitest/ui`, `:64` `jsdom`,
`:65` `tsx`, `:68` `vite`, `:69` `vitest`.

### Evidence that the four misfiled/unused packages really are misfiled

1. **`class-variance-authority` has zero code references.** Verified with
   `grep -rn "class-variance-authority\|\bcva(" src __tests__ e2e scripts` in
   `frontend/` — no matches. The only occurrences repo-wide are the manifest
   entry, the lockfile entries, and a stale index artifact under `.aperant/`.
2. **`tailwindcss` and `@tailwindcss/vite` are build-time only.** The sole
   references are `frontend/vite.config.ts:4`
   (`import tailwindcss from "@tailwindcss/vite";`), `frontend/vite.config.ts:27`
   (`plugins: [react(), tailwindcss()],`), and `frontend/src/index.css:2`
   (`@import "tailwindcss";`). All three are consumed by the bundler, never at
   runtime in a browser.
3. **`@types/canvas-confetti` is types-only.** The runtime package
   `canvas-confetti` is genuinely used (`frontend/src/lib/council-celebrations.ts:12`,
   `import confetti from "canvas-confetti";`) and stays in `dependencies`; only
   the `@types/*` package moves.
4. **The whole phantom production advisory set hangs off one edge.**
   `npm ls postcss nanoid picomatch rollup vite --omit=dev` in `frontend/`
   prints, verbatim:

   ```
   frontend@0.0.0 /Users/d/Developer/Active Projects/IMMI-Case-/frontend
   └─┬ @tailwindcss/vite@4.2.0
     └─┬ vite@7.3.1
       ├─┬ fdir@6.5.0
       │ └── picomatch@4.0.3 deduped
       ├── picomatch@4.0.3
       ├─┬ postcss@8.5.6
       │ └── nanoid@3.3.11
       ├── rollup@4.57.1
       └─┬ tinyglobby@0.2.15
         └── picomatch@4.0.3 deduped
   ```

### Evidence that the SPA is client-only (why the react-router HIGHs are unreachable)

`frontend/src/App.tsx:2`:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
```

`frontend/src/App.tsx:181`:

```tsx
          <BrowserRouter basename={basename}>
```

`frontend/src/main.tsx:2` uses `createRoot` (client render). A repo-wide grep for
`hydrateRoot`, `renderToString`, `createBrowserRouter` and `RouterProvider`
across `frontend/src` returns no matches. The SPA is served as Workers Static
Assets by `workers/cloudflare-native.js`; there is no Node/SSR server.

### Why one `npm audit fix` is not enough (two hard blockers you must know about)

- **`vitest` ↔ `@vitest/ui` form a mutual *exact-version* peer cycle.**
  In `frontend/package-lock.json`, `node_modules/@vitest/ui` peer-depends on
  `vitest: "4.0.18"` (exact) and `node_modules/vitest` peer-depends on
  `@vitest/ui: "4.0.18"` (exact). npm cannot move either one alone, so both
  `npm audit fix` and `npm update vitest @vitest/ui` leave them at 4.0.18 and
  keep reporting "fix available" forever. They must be installed **together at
  the same target version** — Step 3.
- **`tsx@4.21.0` pins `esbuild` to `~0.27.0`.** The esbuild advisory needs
  `>= 0.28.1`. `vite@7.3.6` already permits `^0.27.0 || ^0.28.0`, so the only
  thing holding the hoisted esbuild back is `tsx`. `tsx@^4.23.12` requires
  `~0.28.0` and releases the pin — Step 4.

### CI parity you must not break

`.github/workflows/ci.yml:60-61` runs `npm ci` with `working-directory: frontend`,
and `.github/workflows/deploy-worker.yml:93-95` runs `cd frontend && npm ci &&
npm run build:cloudflare`. Both are plain `npm ci` — devDependencies **are**
installed in CI and at deploy time, which is why moving build tooling to
`devDependencies` is safe. A repo-wide grep for `--omit=dev` / `--production`
in workflows, shell scripts and Makefiles returns no production-only install
anywhere.

### Repo conventions that apply

- Commit message format is `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Real example from `git log`: `fix: install root node_modules in make install`.
- **`immi_case_downloader/static/react/` is a TRACKED build output directory
  (93 tracked files).** `frontend/vite.config.ts:34` sets
  `outDir: "../immi_case_downloader/static/react",` with
  `emptyOutDir: true`. Running `npm run build` therefore rewrites tracked files
  **outside this plan's scope**. Do not run `npm run build`. Step 5 uses an
  explicit `--outDir` into `/tmp` instead.
- **`npm run tokens` rewrites tracked files too** — `frontend/scripts/build-tokens.ts:304,407`
  write `frontend/src/tokens/tokens.css` and `frontend/src/tokens/tokens.ts`.
  `npm run build` invokes it. Another reason not to run `npm run build`.
- The frontend design direction is fixed and named "Legal Codex" (warm off-white
  `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017`, Crimson Text serif headings,
  9 court-specific colour codes), driven from `frontend/src/tokens/tokens.json`.
  This plan deliberately does **not** bump `tailwindcss` (it stays at the
  lockfile's 4.2.0), precisely so no CSS-engine minor can perturb that design.

## Commands you will need

All frontend commands run from `/Users/d/Developer/Active Projects/IMMI-Case-/frontend`.

| Purpose | Command | Expected on success |
|---|---|---|
| Full advisory count | `npm audit` | see per-step expectations below |
| Production-only advisory count | `npm audit --omit=dev` | `found 0 vulnerabilities` at the end |
| Reconcile lock after a manifest edit | `npm install` | exit 0 |
| Apply semver-compatible fixes | `npm audit fix` | exit 0 (never add `--force`) |
| CI-parity install | `npm ci` | exit 0, `found 0 vulnerabilities` |
| Typecheck (the working form) | `npx tsc -b --noEmit` | exit 0, no output |
| Frontend unit tests | `npx vitest run` | **delta**: `FE_TESTS_BEFORE + N_NEW` across `FE_FILES_BEFORE + 1` (Step 6 adds one file) |
| Named-test gate | `npx vitest run __tests__/router-open-redirect.test.tsx` | after Step 6: all pass |
| Production bundle (safe outDir) | `npx vite build --outDir /tmp/immi-plan-035-build --emptyOutDir` | exit 0, ends `✓ built in …` |
| Frontend lint | `npm run lint` | exit 0, triple identical to `ESLINT_BEFORE`, `0 errors` |
| Repo cleanliness | `git status --short` (from repo root) | only in-scope files listed |

**Delta rule (Step 0 — before you change anything).** Sibling plans in this
batch add and remove frontend tests, so absolute totals such as "490 passed" are
not usable gates: they break the moment
`plans/031-delete-dead-frontend-modules.md` (which removes 7) merges, and an
executor who edits the expected number has destroyed the gate. Record:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run 2>&1 | tail -4     # → FE_FILES_BEFORE / FE_TESTS_BEFORE
npm run lint 2>&1 | tail -2       # → ESLINT_BEFORE (the whole ✖ line)
npm audit 2>&1 | grep -E "^[0-9]+ vulnerabilit"   # → AUDIT_BEFORE
```

Everything below is a delta from those. There is **no** ordering dependency on
plan 031 once both plans use deltas; run them in either order, just not in
parallel in the same `node_modules`.

Note on `npx tsc --noEmit` (no `-b`): in this repo that form exits 0 while
loading **zero** files, because `frontend/tsconfig.json` is
`{ "files": [], "references": [...] }`. It is not a real gate. Always use
`npx tsc -b --noEmit`. Fixing the Makefile/CI form is a different plan's job —
do not touch it here.

## Scope

**In scope** (the only files you may modify or create):

- `frontend/package.json` (including the new `engines` block, Step 4b)
- `frontend/package-lock.json`
- `frontend/__tests__/router-open-redirect.test.tsx` — **create** (Step 6). A
  new file, so it collides with nothing;
  `plans/031-delete-dead-frontend-modules.md` only deletes from `__tests__/`.

**Out of scope** (do NOT touch, even though they look related):

- `.github/workflows/ci.yml` — adding an `npm audit --omit=dev --audit-level=high`
  gate to the `test-frontend` job is a good follow-up, but CI files belong to a
  different plan and an audit step needs network access in CI, which has not been
  established. Recorded in "Maintenance notes".
- Any Dependabot / Renovate config under `.github/` — same reason.
- `frontend/src/**`, `frontend/e2e/**`, and every **existing** file under
  `frontend/__tests__/` — if a test or a source file breaks under the new
  dependency versions, that is a STOP condition, not a licence to edit it. The
  one new file created in Step 6 is the sole exception.
- `immi_case_downloader/static/react/**` — tracked build output. Never
  regenerate it in this plan.
- `frontend/src/tokens/tokens.css` and `frontend/src/tokens/tokens.ts` —
  generated by `npm run tokens`; leave them exactly as committed.
- `jsdom` (`frontend/package.json:64`) — stays at `^24.1.3`. See
  "Findings reconsidered".
- `tailwindcss` / `@tailwindcss/vite` **versions** — only their *classification*
  changes; do not bump 4.2.0 → 4.3.3.
- The root `package.json` / `package-lock.json` and `workers/**` — a separate
  dependency closure, and `npm audit --omit=dev` at the repo root already
  reports 0.

## Git workflow

- Branch: `advisor/035-fix-frontend-dependency-advisories`
  (`git checkout -b advisor/035-fix-frontend-dependency-advisories` from `main`).
- One commit per step is fine; a single squashed commit is also fine. Message
  style, matching `git log`:
  - `chore: move frontend build tooling out of production dependencies`
  - `fix: clear frontend npm advisories within existing semver ranges`
- Do **NOT** push, do **NOT** open a PR, do **NOT** merge. The operator commits
  and ships.
- If `frontend/package.json` has gained a `typecheck` script or similar since
  this plan was written (another plan may add one), keep it — merge around it,
  do not delete it.

## Steps

### Step 1: Reclassify the manifest and drop the unused dependency

Edit `frontend/package.json` only. Make exactly four changes:

1. Delete the line `"class-variance-authority": "^0.7.1",` from `dependencies`.
2. Move `"@tailwindcss/vite": "^4.2.0",` from `dependencies` to
   `devDependencies`, keeping the version range byte-for-byte.
3. Move `"@types/canvas-confetti": "^1.9.0",` from `dependencies` to
   `devDependencies`, keeping the version range byte-for-byte.
4. Move `"tailwindcss": "^4.1.18"` from `dependencies` to `devDependencies`,
   keeping the version range byte-for-byte.

Keep both blocks alphabetically sorted and keep valid JSON (mind the trailing
comma on the last entry of each block). The result must be exactly:

```json
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/modifiers": "^9.0.0",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@radix-ui/react-dialog": "^1.1.15",
    "@tanstack/react-query": "^5.90.21",
    "canvas-confetti": "^1.9.4",
    "clsx": "^2.1.1",
    "i18next": "^25.8.11",
    "i18next-browser-languagedetector": "^8.2.1",
    "lucide-react": "^0.564.0",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-i18next": "^16.5.4",
    "react-markdown": "^10.1.0",
    "react-router-dom": "^7.13.0",
    "recharts": "^3.7.0",
    "remark-gfm": "^4.0.1",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.5.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.1",
    "@playwright/test": "^1.58.2",
    "@tailwindcss/vite": "^4.2.0",
    "@testing-library/dom": "^10.4.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/canvas-confetti": "^1.9.0",
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
    "tailwindcss": "^4.1.18",
    "tsx": "^4.21.0",
    "typescript": "~5.9.3",
    "typescript-eslint": "^8.56.0",
    "vite": "^7.3.1",
    "vitest": "^4.0.18"
  }
```

(Steps 3 and 4 will later change `@vitest/ui`, `vitest` and `tsx` in this
block. Leave them alone for now.)

Then reconcile the lockfile:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npm install
```

`npm install` here only removes `class-variance-authority` and re-marks the
moved packages as dev; it does **not** bump any version, because every existing
lock entry still satisfies its range.

**Verify (a)** — classification:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
node -e "const p=require('./package.json'); console.log(['class-variance-authority','@tailwindcss/vite','tailwindcss','@types/canvas-confetti'].map(n=>n+'='+(p.dependencies[n]?'dep':p.devDependencies[n]?'dev':'absent')).join(' '))"
```

→ exactly:
`class-variance-authority=absent @tailwindcss/vite=dev tailwindcss=dev @types/canvas-confetti=dev`

**Verify (b)** — the phantom production advisories are gone, leaving only the
genuinely browser-reachable ones:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npm audit --omit=dev 2>&1 | tail -3
```

→ ends with `2 high severity vulnerabilities` (this is `react-router` +
`react-router-dom` only; it drops to 0 in Step 2). The count went 8 → 2.

**Verify (c)** — the full count is unchanged so far:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npm audit 2>&1 | grep -E "^[0-9]+ vulnerabilit"
```

→ `17 vulnerabilities (2 low, 1 moderate, 12 high, 2 critical)`

### Step 2: Apply every semver-compatible advisory fix

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npm audit fix
```

Never add `--force`. Every advisory in this tree reports `fixAvailable: true`
(a boolean, meaning semver-compatible), so `--force` is neither needed nor
allowed.

This bumps lockfile entries only — it does **not** widen any range in
`package.json`.

**`npm audit fix` is not deterministic, so the version list below is a
prediction, not a gate.** It resolves against the registry at the moment you run
it, so a patch published since this plan was written will land instead. Do not
treat a different-but-still-clean result as a failure. What you must do instead
is **review the lockfile diff**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
git diff --stat -- frontend/package-lock.json
git diff -- frontend/package-lock.json | grep -E '^[-+]\s+"version"' | sort | uniq -c | head -40
node -e "const l=require('./frontend/package-lock.json').packages;for(const k of ['node_modules/react','node_modules/react-dom','node_modules/recharts','node_modules/@tanstack/react-query','node_modules/@radix-ui/react-dialog','node_modules/i18next','node_modules/tailwindcss'])console.log(k.replace('node_modules/',''), l[k].version);"
```

The **allowlist** is: anything under `react-router*`, `vite`, `rollup`,
`postcss`, `nanoid`, `picomatch`, `ws`, `form-data`, `flatted`, `minimatch`,
`brace-expansion`, `ajv`, `@babel/*`, `esbuild`, and their transitives.
`react`, `react-dom`, `recharts`, `@tanstack/react-query`,
`@radix-ui/react-dialog`, `i18next` and `tailwindcss` **must not move** — that
last command is the check, and a change in any of those is a STOP condition.

Expected lockfile moves include: `react-router` and
`react-router-dom` 7.13.0 → 7.18.2, `vite` 7.3.1 → 7.3.6, `rollup` 4.57.1 →
4.63.0, `postcss` 8.5.6 → 8.5.26, `nanoid` 3.3.11 → 3.3.18, `picomatch` 4.0.3 →
4.0.7, `ws` 8.19.0 → 8.21.3, `form-data` 4.0.5 → 4.0.6, `flatted` 3.3.3 →
3.4.4, `minimatch` 9.0.5 → 9.0.9 and 10.2.2 → 10.2.6, `brace-expansion` 2.0.2 →
2.1.4 and 5.0.2 → 5.0.9, `ajv` 6.12.6 → 6.15.0, `@babel/core` 7.29.0 → 7.29.7.
`react`, `react-dom`, `recharts`, `@tanstack/react-query`, `tailwindcss`,
`@radix-ui/react-dialog` and `i18next` are **not** touched.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npm audit 2>&1 | grep -E "^[0-9]+ vulnerabilit"
```

→ `3 vulnerabilities (1 low, 2 critical)`

The 3 that remain are the two blockers described in "Current state": the
`vitest`/`@vitest/ui` exact-peer cycle (2 critical) and the `tsx`-pinned
`esbuild` (1 low). `npm audit fix` will keep claiming it can fix them; it
cannot. Do not run it repeatedly.

### Step 3: Break the `vitest` ↔ `@vitest/ui` exact-peer cycle

Install both at the same target version in one command, so npm can satisfy both
exact peer constraints simultaneously:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npm install --save-dev vitest@4.1.11 "@vitest/ui@4.1.11"
```

**Request the exact versions, not the caret range.** `npm install
"vitest@^4.1.11"` asks npm for *the highest version satisfying `^4.1.11`*, which
on any day after this plan was written may be 4.1.12, 4.2.0, … — and then
Verify (a) below fails for a reason that has nothing to do with your work.
Asking for `vitest@4.1.11` pins **this** resolution while npm's default
`save-prefix` still writes `"^4.1.11"` into `package.json`, which is the range
this plan wants recorded. If your npm is configured with
`save-exact=true` (check with `npm config get save-exact`), pass
`--save-prefix='^'` so the manifest still gets a caret.

This moves the lock to 4.1.11 for `vitest`, `@vitest/ui`, and the
`@vitest/{expect,mocker,pretty-format,runner,snapshot,spy,utils}` internals.

**Verify (a)**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest --version
node -p "require('./package.json').devDependencies.vitest"
```

→ the first starts with `vitest/4.1.11`; the second prints `^4.1.11`

**Verify (b)**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npm audit 2>&1 | tail -4
```

→ ends with `1 low severity vulnerability` (the remaining one is the esbuild
Windows-dev-server file-read advisory, cleared in Step 4).

### Step 4: Bump `tsx` to release the `esbuild` pin

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npm install --save-dev tsx@4.23.12
```

Exact version for the same reason as Step 3: `"tsx@^4.23.12"` resolves to
whatever the registry's newest 4.x is today, which would break Verify (b)'s
`tsx 4.23.12` expectation without anything actually being wrong. npm's default
save-prefix still records `"^4.23.12"` in the manifest.

`tsx@4.21.0` requires `esbuild: ~0.27.0`; `tsx@4.23.12` requires `~0.28.0`,
which lets the hoisted `esbuild` move to 0.28.2 (the advisory needs `>= 0.28.1`).

**Verify (a)** — both audit surfaces are clean:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npm audit 2>&1 | tail -1
npm audit --omit=dev 2>&1 | tail -1
```

→ both print `found 0 vulnerabilities`

**Verify (b)** — the resolved versions are what this plan predicted:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && node -e "const l=require('./package-lock.json').packages;for(const k of ['node_modules/react-router-dom','node_modules/react-router','node_modules/vite','node_modules/vitest','node_modules/@vitest/ui','node_modules/tsx','node_modules/esbuild','node_modules/tailwindcss','node_modules/class-variance-authority'])console.log(k.replace('node_modules/',''), l[k]?l[k].version:'ABSENT');"
```

→ exactly:

```
react-router-dom 7.18.2
react-router 7.18.2
vite 7.3.6
vitest 4.1.11
@vitest/ui 4.1.11
tsx 4.23.12
esbuild 0.28.2
tailwindcss 4.2.0
class-variance-authority ABSENT
```

### Step 4b: Declare the Node floor this manifest actually needs

The repo standardises on Node 22 and `plans/037-align-the-worker-toolchains.md`
adds `"engines": {"node": ">=22"}` to the root and pipeline manifests — but it
explicitly defers `frontend/package.json` to "whichever frontend plan touches
that manifest next". That is this plan. Without it, "one declared Node version"
is not true and npm has nothing to warn a contributor from.

Add to `frontend/package.json`, as a sibling of `devDependencies`:

```json
  "engines": {
    "node": ">=22.13"
  }
```

**`>=22.13`, not `>=22`.** Read from the lockfile: `eslint@10.0.0` declares
`"node": "^20.19.0 || ^22.13.0 || >=24"`, so Node 22.0–22.12 does **not**
satisfy it; `vite@7.x` and `@vitejs/plugin-react` need `>=22.12`. A flat
`>=22` here would declare a floor the toolchain does not actually accept. Say so
in your handoff so plan 037's author knows the two numbers differ on purpose:
root/pipeline are constrained by wrangler (`>=22`), frontend by eslint
(`>=22.13`); both are satisfied by the Node 22 that CI pins.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
node -p "require('./package.json').engines.node"          # → >=22.13
node -p "process.version"                                  # must satisfy it
npm ci 2>&1 | grep -i "EBADENGINE" ; echo "engine-warn grep exit=$?"
```

→ `>=22.13`; your Node satisfies it; the grep exits `1` (no `EBADENGINE`
warning). If it exits `0`, your local Node is below the declared floor — report
that rather than lowering the floor to match your machine.

### Step 5: Re-run every gate from a clean, CI-identical install

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npm ci
npx tsc -b --noEmit
npx vitest run
rm -rf /tmp/immi-plan-035-build && npx vite build --outDir /tmp/immi-plan-035-build --emptyOutDir
npm run lint
```

`npm ci` is run first because it is exactly what `.github/workflows/ci.yml:60`
and `.github/workflows/deploy-worker.yml:94` do — it fails loudly (`EUSAGE`) if
`package.json` and `package-lock.json` have drifted apart.

The `vite build` uses an explicit `--outDir` into `/tmp` on purpose: the
configured `outDir` is the **tracked** directory
`immi_case_downloader/static/react/`, which is out of scope for this plan.

**Verify** — each command in order:

- `npm ci` → exit 0, last line `found 0 vulnerabilities`
- `npx tsc -b --noEmit` → exit 0, **no output at all**
- `npx vitest run` → `FE_FILES_BEFORE + 1` files and `FE_TESTS_BEFORE + N_NEW`
  tests, where `N_NEW` is the number of cases you wrote in Step 6
- `npx vite build …` → exit 0, ends with `✓ built in …`; the emitted
  `assets/index-*.js` is ~267 kB and `assets/charts-*.js` is ~413 kB
  (same as before this plan — hashes will differ, sizes must not move materially)
- `npm run lint` → exit 0, triple identical to `ESLINT_BEFORE`, `0 errors`

**Verify (repo cleanliness)**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short
```

→ the only modified paths are `frontend/package.json`,
`frontend/package-lock.json` and the one new test file from Step 6. (An
untracked `plans/` entry and a modified `.claude/STATE.md` may already have been
present before you started; leave them as you found them. Anything else modified
is a STOP condition.)

### Step 6: Pin the two open-redirect fixes with regression tests

This is the only part of this plan that produces durable value beyond a version
bump. The two advisories it actually closes are behavioural — `react-router`
before 7.18 treated a `<Link to="\\evil.com">` backslash path and a
`//evil.com` protocol-relative path as same-origin navigations — and after this
plan nothing in the repository would notice if a future bump, a downgrade, or a
`resolutions` override reintroduced them. "83 `MemoryRouter` usages exercise
routing" is not the same claim: none of them feeds a hostile path.

Create `frontend/__tests__/router-open-redirect.test.tsx`. Read an existing
router test in `frontend/__tests__/` first and copy its `MemoryRouter` +
`@testing-library/react` idiom rather than inventing one. Cover, at minimum:

1. `useNavigate()("//evil.example.com")` inside a `MemoryRouter` leaves the
   router on a **same-origin** path — assert the resulting `location.pathname`
   is the escaped/relative form, not that the app navigated off-site. (In a
   `MemoryRouter` there is no real navigation; the assertion is on the location
   the router resolves to.)
2. The same for a backslash path, `"\\\\evil.example.com"`.
3. `<Link to="//evil.example.com">` renders an `href` that is **not** a
   protocol-relative URL — assert on `getAttribute("href")`.
4. The same for a `<Link>` with a backslash path.

Then prove the tests can fail: they must be red against the *pre-bump* router.
You cannot easily downgrade mid-plan, so instead assert the exact resolved value
(e.g. `expect(href).toBe("/evil.example.com")`) rather than a loose
`not.toContain("//")` — an exact-value assertion fails if the resolution changes
in either direction, which is what a regression test is for. State the values
your router version actually produces; do not copy a guess from this plan.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend"
npx vitest run __tests__/router-open-redirect.test.tsx 2>&1 | tail -3
npx tsc -b --noEmit; echo "tsc exit=$?"
npm run lint 2>&1 | tail -2
```

→ all cases pass; `tsc exit=0`; the eslint triple is still identical to
`ESLINT_BEFORE` (a new test file must not add a warning).

**Also run a basename smoke pass.** `frontend/src/lib/router.ts`
(`resolveRouterBasename()`) resolves `/` versus `/app/`, and the router bumped
five minors, so basename resolution is exactly the surface a routing regression
would hit. Run the Playwright suite against a local server for both basenames if
you can (`make test-e2e`); if you cannot stand one up, say so explicitly in your
handoff — do not silently omit it and do not claim navigation was verified.

## Test plan

This plan writes **one** new test file — `frontend/__tests__/router-open-redirect.test.tsx`
(Step 6) — and otherwise relies on the existing suites as the regression
detector. The one that matters most is the frontend unit suite, because
`react-router` moves five minors (7.13.0 → 7.18.2) and `vitest` moves one
(4.0.18 → 4.1.11).

**Why the new file is not optional.** The existing coverage is broad but not
adversarial: `MemoryRouter` appears 83 times, `useNavigate` 64,
`BrowserRouter` 26, `useParams` 14, `useSearchParams` 8, across 24 test files —
and **none of them feeds a hostile path**. They prove ordinary navigation still
works; they cannot prove that `//evil.example.com` and `\\evil.example.com` stop
resolving off-origin, which is the entire security value of the react-router
bump. Without Step 6, a future downgrade or `overrides` entry silently
reintroduces both advisories with a fully green suite.

- **Existing suite to run**: `npx vitest run` in `frontend/`. Required movement
  is `FE_FILES_BEFORE + 1` / `FE_TESTS_BEFORE + N_NEW` against the Step 0
  baseline you recorded — never an absolute total, because
  `plans/031-delete-dead-frontend-modules.md` removes 7 tests from the same
  suite. A drop below the baseline means a test was silently skipped, not that
  the suite got smaller.
- **Compile gate**: `npx tsc -b --noEmit` in `frontend/` → exit 0
  (169 source files). Catches any type-shape change in the bumped `@types` or
  in `react-router-dom`'s own d.ts.
- **Bundle gate**: `npx vite build --outDir /tmp/immi-plan-035-build --emptyOutDir`
  → exit 0. Catches resolution/plugin breakage from moving `@tailwindcss/vite`
  and `tailwindcss` into `devDependencies` and from `vite` 7.3.1 → 7.3.6.
- **Lint gate**: `npm run lint` → exit 0, `0 errors`, warning count identical to
  `ESLINT_BEFORE`.
- **Security regression gate**: `npx vitest run __tests__/router-open-redirect.test.tsx`
  → all cases pass, with exact-value assertions (see Step 6).
- **Basename smoke**: Playwright against a local server for `/` and `/app/`, per
  Step 6. If it cannot be run, that must be **declared**, not omitted.

The dependency gates above were pre-verified against a clean `npm ci` of the
exact post-Step-4 manifest and lockfile before this plan was written; they
passed with identical numbers to the `42826a3` baseline. The Step 6 test file
did not exist then and has **not** been pre-verified — write it and prove it.

## Done criteria

Machine-checkable. ALL must hold. Run from
`/Users/d/Developer/Active Projects/IMMI-Case-/frontend` unless noted.

- [ ] `npm audit 2>&1 | tail -1` prints `found 0 vulnerabilities`
- [ ] `npm audit --omit=dev 2>&1 | tail -1` prints `found 0 vulnerabilities`
- [ ] `node -e "const p=require('./package.json'); console.log(p.dependencies['class-variance-authority'] ?? 'absent')"` prints `absent`
- [ ] `node -e "const p=require('./package.json'); console.log(['@tailwindcss/vite','tailwindcss','@types/canvas-confetti'].every(n=>p.devDependencies[n] && !p.dependencies[n]))"` prints `true`
- [ ] `grep -c "class-variance-authority" package-lock.json` prints `0`
- [ ] `node -p "require('./package.json').engines.node"` prints `>=22.13`
- [ ] `npm ci` exits 0 and emits no `EBADENGINE` warning
- [ ] `npx tsc -b --noEmit` exits 0 with no output
- [ ] `npx vitest run` reports `FE_FILES_BEFORE + 1` files and `FE_TESTS_BEFORE + N_NEW` tests
- [ ] `npx vitest run __tests__/router-open-redirect.test.tsx` passes, with at least four cases covering `//host` and backslash paths through both `useNavigate` and `<Link>`
- [ ] `npx vite build --outDir /tmp/immi-plan-035-build --emptyOutDir` exits 0
- [ ] `npm run lint` exits 0 with `0 errors` and a warning count identical to `ESLINT_BEFORE`
- [ ] `node -e "const l=require('./package-lock.json').packages;for(const k of ['node_modules/react','node_modules/react-dom','node_modules/recharts','node_modules/@tanstack/react-query','node_modules/@radix-ui/react-dialog','node_modules/i18next','node_modules/tailwindcss'])console.log(k,l[k].version);"` shows every one of those seven **unchanged** from the pre-plan lockfile
- [ ] From the repo root, `git status --short` shows no modified file other than
      `frontend/package.json`, `frontend/package-lock.json` and the new
      `frontend/__tests__/router-open-redirect.test.tsx`
- [ ] `git diff --stat -- immi_case_downloader/static/react frontend/src` is empty
- [ ] `plans/README.md` status row updated (skip if that file does not exist)

## STOP conditions

Stop and report back — do not improvise — if any of these happen:

1. **`npm audit fix` asks for `--force`, or any advisory reports
   `fixAvailable` as an object containing `isSemVerMajor: true`.** Every fix in
   this plan is semver-compatible by design. A major-version fix means the
   registry state moved after 2026-08-27 and the plan needs re-planning. Never
   run `npm audit fix --force`.
2. **The advisory counts do not match at a step boundary** — Step 1 verify (c)
   is not `AUDIT_BEFORE`, Step 2 is not `3 vulnerabilities (1 low, 2 critical)`,
   Step 3 is not `1 low severity vulnerability`, or Step 4 is not
   `found 0 vulnerabilities`. New advisories are published continuously; report
   the actual numbers and the package names rather than inventing extra bumps.
   The **hard** gate is the final `found 0 vulnerabilities` on both audit
   surfaces plus the allowlisted lockfile diff in Step 2 — not the intermediate
   counts, and not the predicted version list.
2b. **`npm audit fix` moved a package outside the Step 2 allowlist** — in
   particular `react`, `react-dom`, `recharts`, `@tanstack/react-query`,
   `@radix-ui/react-dialog`, `i18next` or `tailwindcss`. Report the diff; do not
   accept it because the audit came out clean.
3. **`npx vitest run` fails, or its delta against your Step 0 baseline is
   anything other than `+1` file / `+N_NEW` tests.** The most likely cause is a
   `react-router` 7.13 → 7.18
   behaviour change (the open-redirect fixes changed how backslash and `//`
   prefixed paths are normalised in `<Link>` / `useNavigate`). Report the failing
   test names and the assertion diff. **Do not edit any file under
   `frontend/src/` or `frontend/__tests__/` to make a test pass** — those are
   out of scope, and a green suite bought by editing an assertion hides exactly
   the regression this gate exists to catch.
4. **`npx tsc -b --noEmit` reports errors.** Report the full error list; do not
   add `@ts-expect-error`, do not widen types, do not touch `tsconfig*.json`.
5. **`npm ci` fails with `EUSAGE` / "lock file does not satisfy package.json".**
   The manifest and lockfile drifted apart — most likely a hand-edit to
   `package.json` that was not followed by `npm install`. Re-run `npm install`
   once; if `npm ci` still fails, stop.
6. **`git status --short` shows a modification under
   `immi_case_downloader/static/react/` or `frontend/src/tokens/`.** That means
   `npm run build` or `npm run tokens` was run. Revert those paths with
   `git checkout -- immi_case_downloader/static/react frontend/src/tokens` and
   stop — then re-read the "Repo conventions" note in "Current state".
7. **The drift check at the top of this file is non-empty and the "Current
   state" excerpts no longer match the live `frontend/package.json`.** Another
   plan touched this file territory; report the diff instead of merging blind.
8. **You find yourself wanting to run `npm update` (bare) or bump `jsdom`.**
   Both are deliberately excluded — see "Findings reconsidered".

## Maintenance notes

For the human or agent who owns this next:

- **What a reviewer should scrutinise in the diff.** `frontend/package.json`
  should show exactly seven line-level changes plus one added block: one
  deletion (`class-variance-authority`), three moves (`@tailwindcss/vite`,
  `@types/canvas-confetti`, `tailwindcss`), three version bumps
  (`@vitest/ui` and `vitest` to `^4.1.11`, `tsx` to `^4.23.12`), and the new
  `"engines": {"node": ">=22.13"}`. Plus one new test file. Nothing else.
  In `frontend/package-lock.json` the only *runtime*-facing version change is
  `react-router` / `react-router-dom` 7.13.0 → 7.18.2; everything else is
  build/test tooling or a transitive of it. If you see `react`, `react-dom`,
  `recharts`, `@tanstack/react-query`, `@radix-ui/react-dialog`, `i18next` or
  `tailwindcss` move, something went wrong.
- **The Playwright basename smoke is now part of Step 6, not a nice-to-have.**
  Given `react-router` moved five minors, run `make test-e2e` against a local
  server before this ships, paying particular attention to navigation, the
  `/app/` vs `/` basename resolution in `frontend/src/lib/router.ts`, and any
  redirect assertions. If it could not be run, the handoff must say so
  explicitly — an omitted gate that nobody names is indistinguishable from a
  passed one.
- **The caret floors were intentionally left alone.** `react-router-dom` still
  declares `^7.13.0` and `vite` still declares `^7.3.1`, even though the lock
  now resolves 7.18.2 / 7.3.6. `npm ci` and `npm install` both honour the lock,
  and a lock-less resolve would pick the newest satisfying version, so the low
  floor creates no exposure. Raising the floors is cosmetic churn; skip it.
- **Deferred: a CI regression gate.** The natural follow-up is a step in the
  `test-frontend` job of `.github/workflows/ci.yml` (after `npm ci`, around
  line 62):

  ```yaml
      - name: Audit production dependencies
        run: npm audit --omit=dev --audit-level=high
        working-directory: frontend
  ```

  It was left out of this plan because `.github/` is another plan's file
  territory and because an audit step needs registry network access from the CI
  runner, which has not been verified. Same reasoning for adding a
  Dependabot/Renovate config scoped to `frontend/`.
- **Deferred: general dependency drift.** 25 of the 31 packages `npm outdated`
  lists in `frontend/` have a newer in-range version — notably
  `@tanstack/react-query` 5.90.21 → 5.102.6, `recharts` 3.7.0 → 3.10.1,
  `tailwindcss` 4.2.0 → 4.3.3, `@playwright/test` 1.58.2 → 1.62.1. A bare
  `npm update` would take all of them at once and make any visual or behavioural
  regression un-attributable — and `tailwindcss` 4.2 → 4.3 in particular could
  perturb the "Legal Codex" design system. Do that as its own plan, in small
  batches, with a screenshot pass.
- **`class-variance-authority` will come back if anyone runs `npx shadcn add`.**
  `frontend/components.json` exists, and generated shadcn components import
  `cva`. If a future component genuinely needs it, re-adding it to
  `dependencies` is correct — this plan removed it because nothing imports it
  today, not because it is forbidden.
- **The `vitest` ↔ `@vitest/ui` exact-peer cycle will recur** on every future
  vitest advisory. The fix is always the same: install both together at the same
  version in one `npm install --save-dev` command. `npm audit fix` and
  `npm update` will never resolve it on their own.

## Findings reconsidered

- **DEPS-09 — "jsdom is six majors behind (24.1.3 vs 30.0.1)".** The version
  facts hold exactly (`frontend/package.json:64` declares `^24.1.3`, the lock
  resolves 24.1.3, the caret cannot cross the major, and
  `frontend/vitest.config.ts:9` is `environment: "jsdom"`, so it does back all
  490 tests). But there is no consequence to fix: `npm audit` reports **zero**
  advisories against jsdom, and no instance was produced of a test passing on
  stale DOM semantics. A 6-major jsdom bump is genuinely risky (`M` effort, and
  jsdom majors change CSS/layout/`getComputedStyle` behaviour that
  `@testing-library` assertions depend on), and folding it into this plan would
  make the 490-test suite a second moving variable — so a failure could not be
  attributed to either the security bumps or the jsdom bump. Deferred to its own
  plan, stepping 24 → 26 → 28 → 30 with a full `npx vitest run` between each, or
  evaluating `happy-dom` instead.

- **Severity attribution corrected on DEPS-01 and SEC-12.** Both findings led
  with "high/critical" framing for react-router. Pulling the per-advisory `via`
  records out of `npm audit --json` shows that is not right for this codebase:
  the two advisories a client-side SPA can actually hit — `Open redirect via
  backslash in <Link> and useNavigate` (`>=6.0.0 <7.18.0`) and `same-origin
  redirect with path starting // … protocol-relative URL reinterpretation`
  (`>=7.0.0 <7.14.1`) — are both rated **moderate**. Every **high** react-router
  advisory in range is server-side (vendored turbo-stream deserialisation RCE,
  `__manifest` DoS, single-fetch reflected-input DoS, RSC-mode CSRF, and
  `Unauthenticated Denial of Service via Inefficient Route Matching`, which is a
  server route-matcher issue). `frontend/src/App.tsx:181` mounts a plain
  `<BrowserRouter>`, `frontend/src/main.tsx:2` uses `createRoot`, there is no
  `hydrateRoot` / `renderToString` / `createBrowserRouter` / `RouterProvider`
  anywhere in `frontend/src`, and the SPA is served as static assets by the
  Worker — so none of those has a reachable path here. Likewise both
  **criticals** are the single `@vitest/ui` advisory, reachable only via
  `vitest --ui` (`frontend/package.json:16`, the `test:ui` script), which CI
  never runs, and the `vite` highs are dev-server-only.
  **Neither finding is dropped** — the remediation is identical and every step
  above still applies. What changed is the justification: this is high-value
  hygiene plus two real moderate open-redirects, not an active
  high-severity production exposure. Anyone reading the "12 high, 2 critical"
  headline as production risk is reading it wrong.

- **This plan originally shipped two security fixes with no test behind
  either — corrected.** It argued that 83 `MemoryRouter` and 64 `useNavigate`
  usages already exercise the risky surface. They exercise *navigation*; none of
  them feeds `//host` or a backslash path, so none of them can fail if the
  open-redirect behaviour comes back. Step 6 adds four adversarial cases and a
  basename smoke pass, and Step 4b adds the `engines` floor that
  `plans/037-align-the-worker-toolchains.md` explicitly deferred to "whichever
  frontend plan touches this manifest next".

- **The version pins were requested as caret ranges — corrected to exact.**
  `npm install "vitest@^4.1.11"` resolves to the newest 4.x on the day it runs,
  so the plan's own `vitest --version → 4.1.11` and lockfile assertions could
  fail for reasons unrelated to the work. Requesting `vitest@4.1.11` pins this
  resolution while npm's default save-prefix still writes `^4.1.11`. Same for
  `tsx@4.23.12`. `npm audit fix` is inherently non-deterministic and its
  predicted version list has been demoted from a gate to a prediction, backed
  instead by an allowlisted lockfile-diff review.

- **Two items from the findings' fix sketches were moved out of scope, not
  rejected**: adding an `npm audit --omit=dev --audit-level=high` step to the
  `test-frontend` CI job, and adding Dependabot/Renovate scoped to `frontend/`.
  Both require editing `.github/**`, which is outside this plan's file
  territory. Exact recipe is in "Maintenance notes" so the next plan can pick
  them up.
