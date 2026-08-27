# Plan 037: One wrangler, one vitest, one declared Node version

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. There is no `plans/README.md` in this repository
> at the time of writing; if one exists when you finish, update this plan's
> status row in it, otherwise skip that.
>
> This plan changes **only** dependency declarations, lockfiles, one README
> table row, one new `.nvmrc`, and one added CI gate step. It changes **no**
> application code — no Python, no React, no Worker runtime `.js`/`.ts`. If
> you find yourself editing a `.py`, `.tsx`, or a Worker source or test file,
> you have left the plan.
>
> **Drift check (run first)**:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
> git diff --stat 42826a3..HEAD -- \
>   package.json \
>   package-lock.json \
>   workers/austlii-scraper/package.json \
>   workers/austlii-scraper/package-lock.json \
>   .github/workflows/deploy-worker.yml \
>   README.md \
>   .nvmrc
> ```
>
> If any of those files changed since commit `42826a3`, compare the
> "Current state" excerpts below against the live files before proceeding.
> On a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

The 345-test Worker suite in `workers/__tests__/` is the only automated
coverage of `workers/cloudflare-native.js`, the single file that serves every
production request. It runs on **vitest 2.1.9** — the last 2.x release,
published 2025-02-03, two majors behind the repo's other two test manifests
(`frontend/` and `workers/austlii-scraper/` are both on vitest 4). A mocking
idiom verified in either of those suites cannot be assumed to behave the same
in the one suite that guards the live request path.

Separately, the pipeline Worker is deployed by a wrangler its own manifest
never exercises: `.github/workflows/deploy-worker.yml:107` runs
`npx --no-install wrangler deploy` from the repo root, so the upload is done by
root's pinned **wrangler 4.120.0**, while `workers/austlii-scraper/package.json`
declares `^4.98.0` and its lockfile carries 4.98.0. A developer running
`wrangler dev` in that directory is emulating on a two-month-older
workerd/miniflare than the wrangler that actually bundles the shipped code.
The floating `^4.98.0` range is worse than stale — verified at plan time, a
fresh `npm install` in that directory (no lockfile) **fails outright** with an
`ERESOLVE` peer conflict, because current wrangler 4.x requires
`@cloudflare/workers-types@^5` and that manifest declares `^4`.

Finally, `README.md:106` tells a new contributor Node 18 is enough. It is not:
both wranglers require `>=22`, and no `package.json` in the repo declares an
`engines` field for npm to warn from. CI pins Node 22 everywhere, so CI will
never reproduce the discrepancy a contributor hits on their laptop.

After this plan: one wrangler version declared in both manifests that use it,
one vitest major across all three suites, a Node floor that matches reality and
is enforced by `engines` + `.nvmrc`, and a deploy-time gate that fails the
operator deploy if the two wrangler declarations ever drift apart again.

## Current state

### Files this plan touches, and their role

- `package.json` — root manifest. Owns the **production Worker test suite**
  (`test:workers`) and the wrangler that performs both production deploys.
- `package-lock.json` — regenerated as a consequence of editing the above.
- `workers/austlii-scraper/package.json` — the AustLII pipeline Worker's own
  manifest: its `dev`/`deploy`/`typecheck`/`test` scripts.
- `workers/austlii-scraper/package-lock.json` — regenerated as a consequence.
- `.github/workflows/deploy-worker.yml` — the operator-only, `workflow_dispatch`
  production deploy. Gains one gate step.
- `README.md` — one row of the Prerequisites table.
- `.nvmrc` — does not exist yet; this plan creates it.

### `package.json` — the entire file, verbatim (11 lines)

```json
{
  "name": "immi-case",
  "type": "module",
  "scripts": {
    "test:workers": "vitest run --config workers/vitest.config.js"
  },
  "devDependencies": {
    "vitest": "^2.0.0",
    "wrangler": "4.120.0"
  }
}
```

`vitest` is on line 8, `wrangler` on line 9. There is no `engines` key.

Resolved versions in `package-lock.json` today (verified by reading the lock):

| Package | Locked version | `engines.node` in lock |
|---|---|---|
| `vitest` | 2.1.9 | `^18.0.0 \|\| >=20.0.0` |
| `@vitest/expect`, `/runner`, `/snapshot`, `/spy`, `/utils` | 2.1.9 | — |
| `wrangler` | 4.120.0 | `>=22.0.0` |
| `miniflare` | 5.20260801.1-alpha | `>=22.0.0` |
| `workerd` | 1.20260801.1 | `>=16` |

### `workers/austlii-scraper/package.json` — the entire file, verbatim (21 lines)

```json
{
  "name": "austlii-scraper",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "tail": "wrangler tail",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --config vitest.config.ts",
    "rollback": "tsx scripts/rollback_run.ts"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20241205.0",
    "postgres": "^3.4.5",
    "tsx": "^4.21.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.8",
    "wrangler": "^4.98.0"
  }
}
```

`@cloudflare/workers-types` is on line 14, `postgres` on line 15, `vitest` on
line 18, `wrangler` on line 19. There is no `engines` key.

Resolved versions in `workers/austlii-scraper/package-lock.json` today:

| Package | Locked version |
|---|---|
| `@cloudflare/workers-types` | 4.20260608.1 (latest published is 5.20260827.1) |
| `postgres` | 3.4.9 |
| `vitest` | 4.1.8 |
| `wrangler` | 4.98.0 |
| `miniflare` | 4.20260603.0 |
| `workerd` | 1.20260603.1 |

### The wrangler ↔ workers-types coupling (verified at plan time)

```
$ npm view wrangler@4.120.0 peerDependencies
{ '@cloudflare/workers-types': '^5.20260801.1' }

$ npm view wrangler@4.98.0 peerDependencies
{ '@cloudflare/workers-types': '^4.20260603.1' }
```

This is why the wrangler bump and the workers-types major bump are **one
change, not two**. Bumping wrangler alone produces this, reproduced at plan
time in an isolated copy with no lockfile:

```
npm error code ERESOLVE
npm error While resolving: wrangler@4.126.0
npm error Found: @cloudflare/workers-types@4.20260702.1
npm error   dev @cloudflare/workers-types@"^4.20241205.0" from the root project
npm error Could not resolve dependency:
npm error peerOptional @cloudflare/workers-types@"^5.20260825.1" from wrangler@4.126.0
```

### `README.md:106` — verbatim

```
| Node.js | 18+ | 推薦 20 LTS |
```

This is the only mention of Node.js anywhere in `README.md`
(`grep -n -i "node" README.md` returns exactly this one line). The real floors,
read from the lockfiles:

| Package | `engines.node` | Node 18 OK? | Node 20.19 OK? |
|---|---|---|---|
| `wrangler` 4.120.0 (root) | `>=22.0.0` | no | **no** |
| `wrangler` 4.98.0 (pipeline) | `>=22.0.0` | no | **no** |
| `eslint` 10.0.0 (frontend) | `^20.19.0 \|\| ^22.13.0 \|\| >=24` | no | yes |
| `vite` 7.3.1 (frontend) | `^20.19.0 \|\| >=22.12.0` | no | yes |
| `@vitejs/plugin-react` 5.1.4 | `^20.19.0 \|\| >=22.12.0` | no | yes |
| `vitest` 4.x | `^20.0.0 \|\| ^22.0.0 \|\| >=24.0.0` | no | yes |

So the `18+` floor is wrong for every one of them, and `推薦 20 LTS` is
additionally wrong for both wranglers. CI already pins 22 in all three places:
`.github/workflows/ci.yml:55`, `ci.yml:78`, `.github/workflows/deploy-worker.yml:34`.
There is no `.nvmrc` in the repository.

### `.github/workflows/deploy-worker.yml` — the two relevant regions, verbatim

Lines 36–39 (the insertion anchor for the new gate step):

```yaml
      - name: Install Worker dependencies
        run: npm ci

      - name: Materialise operator-supplied native configs
```

Lines 97–107 (why root wrangler is the one that deploys — no
`working-directory:`, so both run from the repo root against root's
`node_modules/.bin/wrangler`):

```yaml
      - name: Deploy native main Worker
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npx --no-install wrangler deploy --config "$RUNNER_TEMP/immi-native-main.toml"

      - name: Deploy native pipeline Worker
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npx --no-install wrangler deploy --config "$RUNNER_TEMP/immi-native-pipeline.toml"
```

`deploy-worker.yml` never runs `npm ci` inside `workers/austlii-scraper`. That
is fine and must stay that way: every import in `workers/austlii-scraper/src/*.ts`
is relative (`grep -rn "^import" src/*.ts` shows only `./`-prefixed specifiers),
so the pipeline bundle has zero external dependencies and needs no local
`node_modules` to build.

### Supporting context the executor needs (do not edit these files)

- `workers/vitest.config.js:7-13` — the production Worker suite's config.
  Minimal; uses none of the options vitest 4 removed:
  ```js
  export default defineConfig({
    root: __dirname,
    test: {
      environment: "node",
      include: ["__tests__/**/*.test.js"],
      globals: false,
    },
  });
  ```
- `Makefile:70-71` — `test-workers: cd "$(REPO_ROOT)/workers" && npx vitest run`.
  A second entry point into the same suite; both forms were verified working
  under vitest 4.1.11 at plan time.
- `Makefile:100-105` — `make install` runs `npm install` at the root and in
  `frontend/`. Root `node_modules` is where `test:workers` and both deploys
  resolve their binaries from.
- `.github/workflows/ci.yml:96-98` — `npm ci --ignore-scripts` with
  `working-directory: workers/austlii-scraper`. This is why the pipeline
  lockfile **must** be regenerated and committed in step 3: `npm ci` fails if
  the lockfile and manifest disagree.
- `workers/austlii-scraper/tsconfig.json:15` — `"include": ["src/**/*.ts"]`.
  `scripts/` is outside the TypeScript program, so `npm run typecheck` never
  compiles `scripts/rollback_run.ts` and never resolves its
  `import postgres from "postgres"`.
- `tests/test_effective_native_ci.py:26-37` asserts on the **text** of
  `deploy-worker.yml`, including `assert "wrangler deploy\"" not in deploy`
  (case-insensitive: the file is lowercased before the check). The gate step
  added in step 5 must not introduce the literal substring `wrangler deploy"`.
- `scripts/check_native_effective_references.py:26-32` scans `deploy-worker.yml`
  for the markers `supabase`, `postgres`, `pgvector`, `hyperdrive`. The gate
  step added in step 5 must not contain any of those words.

### Repo conventions that apply

- Commit message format: `<type>: <description>`, type ∈
  `feat|fix|refactor|docs|test|chore|perf|ci`. Real example from `git log`:
  `fix: install root node_modules in make install`. **No AI attribution lines.**
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and deploys.
- Python work in this repo always uses the checked-out venv at `.venv/`
  (`.venv/bin/python`, `.venv/bin/pytest`) — never a global `pip`.
- Things that are **wrong on purpose** in this repo. Do not "fix" them, and do
  not let them distract you:
  - the placeholder resource IDs in the checked-in `wrangler.toml`;
  - `IMMI_CASE_MUTATIONS_ENABLED` and the pipeline flags defaulting to `"false"`;
  - `workers/austlii-scraper/scripts/rollback_run.ts` targeting legacy Supabase
    (it is a break-glass script for the retired stack) and the `postgres`
    devDependency that exists only to run it;
  - the `Performance Baseline (2026-05-05)` section of `CLAUDE.md` being
    historical.

## Commands you will need

All commands assume `cd "/Users/d/Developer/Active Projects/IMMI-Case-"` unless
a `working-directory` is stated.

| Purpose | Command | Expected on success |
|---|---|---|
| Install root deps | `npm install` | exit 0 |
| Production Worker suite | `npm run test:workers` | `Test Files 25 passed (25)`, `Tests 345 passed (345)` |
| Install pipeline deps | `cd workers/austlii-scraper && npm install --ignore-scripts` | exit 0 |
| Pipeline typecheck | `cd workers/austlii-scraper && npm run typecheck` | exit 0, no output after the npm banner |
| Pipeline tests | `cd workers/austlii-scraper && npm test` | `Test Files 7 passed (7)`, `Tests 28 passed (28)` |
| Wrangler identity | `npx wrangler --version` | `4.120.0` |
| CI-shape assertions | `.venv/bin/pytest tests/test_effective_native_ci.py tests/test_native_effective_references.py -q` | `7 passed` |
| Native reference scan | `python3 scripts/check_native_effective_references.py --json` | exit 0, `"ok": true`, all markers `0` |
| YAML validity | `.venv/bin/python -c "import yaml;yaml.safe_load(open('.github/workflows/deploy-worker.yml'));print('yaml ok')"` | `yaml ok` |
| Working-tree check | `git status --short` | only in-scope paths listed |

Not needed by this plan, listed so you do not run them by mistake:
`make test-py` (1141 passed / 3 failed / 7 skipped at `42826a3`; the 3 failures
are a Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch that breaks the
`pypdf` import in `tests/test_backfill_judge_overrides_from_pdf.py` — an
environment defect, unrelated to and unaffected by this plan) and
`cd frontend && npx vitest run` (490 passed; `frontend/` is out of scope here).

## Scope

**In scope** (the only files you may modify or create):

- `package.json`
- `package-lock.json` (regenerated by `npm install`, never hand-edited)
- `workers/austlii-scraper/package.json`
- `workers/austlii-scraper/package-lock.json` (regenerated, never hand-edited)
- `.github/workflows/deploy-worker.yml` (add exactly one step)
- `README.md` (line 106 only — the Node.js row of the Prerequisites table)
- `.nvmrc` (create)

**Out of scope** (do NOT touch, even though they look related):

- `workers/__tests__/**` — 25 files, 345 tests. The vitest 2 → 4 bump was
  verified at plan time against an isolated copy of `workers/` and **all 345
  tests pass unmodified**. If a test nevertheless fails on your machine, that
  is new information: STOP (see STOP conditions). Do not "fix" a worker test to
  make the bump green — those files are actively being edited by other plans
  and an edit here would collide.
- `frontend/package.json`, `frontend/package-lock.json` — an `engines` field
  belongs there too, but that file is owned by the frontend plans that may be
  running in parallel. Recorded as a deferred follow-up in Maintenance notes.
- `.github/workflows/ci.yml` — owned by the plans that repair the verification
  gates. Its `npx tsc --noEmit` step is a known separate defect; not yours.
- `Makefile` — both worker-suite entry points already work under vitest 4.
- `workers/austlii-scraper/scripts/rollback_run.ts` and the `postgres`
  devDependency — break-glass tooling for the retired Supabase stack, by design.
  `tsconfig.json` already excludes `scripts/`, so it is not part of any gate.
- `wrangler.toml`, `workers/austlii-scraper/wrangler.toml` — no config change
  is needed and the placeholder IDs are deliberate.
- Chasing latest: do **not** use wrangler 4.126.0, `@cloudflare/workers-types`
  pinned to today's exact build, or the vitest 5 beta/rc. The versions in this
  plan are the ones that were installed and exercised at plan time.

## Git workflow

- Branch: `advisor/037-align-the-worker-toolchains` (create from `main`).
- One commit per step group; suggested messages:
  - step 2 → `chore: run the Worker suite on vitest 4`
  - step 3 → `chore: align the pipeline Worker on wrangler 4.120.0`
  - step 4 → `docs: correct the Node floor to 22 and pin it with .nvmrc`
  - step 5 → `ci: gate wrangler declaration drift before the operator deploy`
- No AI attribution lines in commit messages.
- Do NOT push, do NOT open a PR, do NOT merge. The operator does that.

## Steps

### Step 1: Record the baselines you will be measured against

Do not change anything yet. If `node_modules/` is missing at the repo root, run
`npm install` first (that alone must not change `package.json` or
`package-lock.json`; if it does, STOP).

Run all four and write the numbers down:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
npm run test:workers 2>&1 | tail -4
(cd workers/austlii-scraper && npm run typecheck; echo "typecheck exit=$?")
(cd workers/austlii-scraper && npm test 2>&1 | tail -4)
npx wrangler --version
```

At commit `42826a3` these produce, respectively:
`Test Files 25 passed (25)` / `Tests 345 passed (345)`; `typecheck exit=0` with
no diagnostics; `Test Files 7 passed (7)` / `Tests 28 passed (28)`; `4.120.0`.

If your numbers differ from those, that is acceptable — another plan may have
landed since — but from here on **your** recorded numbers are the gate, and you
must state both the baseline and the final numbers in your completion report.

**Verify**: `git status --short` → shows no modification to any file listed in
"In scope".

### Step 2: Move the production Worker suite to vitest 4 and declare Node 22 at the root

Edit `package.json` so the whole file reads exactly:

```json
{
  "name": "immi-case",
  "type": "module",
  "scripts": {
    "test:workers": "vitest run --config workers/vitest.config.js"
  },
  "devDependencies": {
    "vitest": "^4.1.11",
    "wrangler": "4.120.0"
  },
  "engines": {
    "node": ">=22"
  }
}
```

Two changes only: `vitest` `^2.0.0` → `^4.1.11`, and a new `engines` block.
`wrangler` stays pinned at exactly `4.120.0` — that pin is correct and is the
version both production deploys already use.

Then regenerate the lockfile and re-run the suite:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
npm install
npm run test:workers 2>&1 | tail -4
```

`vitest 4.1.11` was published 2026-08-18 and is the current `latest`. The only
vitest-4 behaviour changes that could plausibly touch this suite are the mock
lifecycle ones: `mockReset()` now restores a mock's original implementation, and
`restoreAllMocks()` now only restores `vi.spyOn` spies. Neither bites here — all
five `mockReset()` call sites
(`workers/__tests__/llm-council-storage.test.js:71,77,78,79` and
`workers/__tests__/cloudflare-council-handlers.test.js:68`) target mocks created
as bare `vi.fn()` with no implementation, and the sole `restoreAllMocks()` user
(`workers/__tests__/llm-council-runner.test.js`) uses it exactly for
`vi.spyOn(globalThis, "fetch")`. This was confirmed empirically at plan time:
the full suite passes under 4.1.11 with zero test-file edits.

**Verify** (all four):

```bash
node -p "require('./package.json').devDependencies.vitest"                          # → ^4.1.11
node -p "require('./package-lock.json').packages['node_modules/vitest'].version"    # → 4.1.11
node -p "require('./package.json').engines.node"                                    # → >=22
npm run test:workers 2>&1 | tail -4
```

The last one must report the **same file and test counts you recorded in step 1**
(`25 passed (25)` / `345 passed (345)` at `42826a3`), and the run banner must
read `RUN v4.1.11`.

Also confirm the other entry point still works:

```bash
(cd workers && npx vitest run 2>&1 | tail -4)   # → same counts, RUN v4.1.11
```

Commit: `chore: run the Worker suite on vitest 4`

### Step 3: Align the pipeline Worker on the wrangler that actually deploys it

Edit `workers/austlii-scraper/package.json` so the whole file reads exactly:

```json
{
  "name": "austlii-scraper",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "tail": "wrangler tail",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --config vitest.config.ts",
    "rollback": "tsx scripts/rollback_run.ts"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^5.20260801.1",
    "postgres": "^3.4.5",
    "tsx": "^4.21.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.8",
    "wrangler": "4.120.0"
  },
  "engines": {
    "node": ">=22"
  }
}
```

Three changes: `wrangler` `^4.98.0` → exact `4.120.0` (matching root's pin
style, which is the right call for a deploy tool),
`@cloudflare/workers-types` `^4.20241205.0` → `^5.20260801.1`, and a new
`engines` block. `postgres`, `tsx`, `typescript` and `vitest` are untouched.

**The workers-types major must move with wrangler, not separately.** wrangler
4.120.0 declares `peerOptional @cloudflare/workers-types@^5.20260801.1`; 4.98.0
declared `^4.20260603.1`. Leaving the `^4` range in place while pinning wrangler
4.120.0 makes `npm install` fail with the `ERESOLVE` conflict quoted in
"Current state". `^5.20260801.1` is the lowest v5 range that satisfies the peer.

Then regenerate that lockfile — `--ignore-scripts` mirrors what CI does at
`.github/workflows/ci.yml:97`:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper"
npm install --ignore-scripts
npm run typecheck; echo "typecheck exit=$?"
npm test 2>&1 | tail -4
```

Expect no ERESOLVE, `typecheck exit=0` with no diagnostics, and the same test
counts you recorded in step 1. This exact combination was installed and
exercised at plan time: `tsc --noEmit` was clean across all 17 files in `src/`
and all 28 tests passed. `skipLibCheck: true` in `tsconfig.json` plus the fact
that `src/` imports nothing external is why a workers-types major is a
non-event here.

**Verify** (all five):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
node -p "require('./workers/austlii-scraper/package.json').devDependencies.wrangler"
#   → 4.120.0
node -p "require('./workers/austlii-scraper/package.json').devDependencies['@cloudflare/workers-types']"
#   → ^5.20260801.1
node -p "require('./workers/austlii-scraper/package-lock.json').packages['node_modules/wrangler'].version"
#   → 4.120.0
node -p "require('./workers/austlii-scraper/package-lock.json').packages['node_modules/@cloudflare/workers-types'].version.split('.')[0]"
#   → 5
node -p "require('./workers/austlii-scraper/package-lock.json').packages['node_modules/miniflare'].version"
#   → 5.20260801.1-alpha   (same as root's lock — that is the point of this step)
```

Then confirm the working tree contains nothing unexpected:

```bash
git status --short
# → besides the pre-existing ` M .claude/STATE.md` and `?? plans/` (both already
#   present at 42826a3 — leave them alone), only:
#      M package.json, M package-lock.json,
#      M workers/austlii-scraper/package.json,
#      M workers/austlii-scraper/package-lock.json
```

Commit: `chore: align the pipeline Worker on wrangler 4.120.0`

### Step 4: Tell contributors the truth about the Node floor

Replace `README.md` line 106, which currently reads exactly:

```
| Node.js | 18+ | 推薦 20 LTS |
```

with:

```
| Node.js | 22+ | CI 使用 22；wrangler 4.120.0 要求 >=22 |
```

Keep the surrounding table rows (`Python`, `npm`, `PostgreSQL`) untouched — the
Node.js row is the only one being corrected.

Then create `.nvmrc` at the repository root containing exactly one line:

```
22
```

`.nvmrc` is not covered by `.gitignore` (verified: `git check-ignore .nvmrc`
exits 1), so it will be committed. Nothing in CI reads it today; it exists so
`nvm use` / `fnm use` pick the right runtime locally, mirroring the `engines`
fields added in steps 2 and 3.

**Verify**:

```bash
grep -n "Node.js" README.md
# → 106:| Node.js | 22+ | CI 使用 22；wrangler 4.120.0 要求 >=22 |
cat .nvmrc
# → 22
grep -rn "18+\|20 LTS" README.md
# → no matches
```

Commit: `docs: correct the Node floor to 22 and pin it with .nvmrc`

### Step 5: Gate wrangler declaration drift before the operator deploy

Add exactly one step to `.github/workflows/deploy-worker.yml`, inserted between
the existing `Install Worker dependencies` step and the existing
`Materialise operator-supplied native configs` step (i.e. after line 37 at
`42826a3`). It runs before any secret is materialised, so drift fails fast.

The region must read:

```yaml
      - name: Install Worker dependencies
        run: npm ci

      - name: Gate wrangler toolchain alignment
        run: |
          node -e 'const r=require("./package.json").devDependencies.wrangler;const p=require("./workers/austlii-scraper/package.json").devDependencies.wrangler;if(r!==p){console.error("wrangler declaration mismatch: root "+r+" vs pipeline "+p);process.exit(1);}console.log("wrangler aligned at "+r);'

      - name: Materialise operator-supplied native configs
```

Notes that matter, do not "improve" around them:

- Use a YAML literal block (`run: |`) and single-quote the JS. Do not use
  backticks or template literals — string concatenation only.
- The one-liner must not contain the substring `wrangler deploy"`, which
  `tests/test_effective_native_ci.py:37` forbids, and must not contain the
  words `supabase`, `postgres`, `pgvector` or `hyperdrive`, which
  `scripts/check_native_effective_references.py` forbids. The text above
  satisfies both.
- `node -e` evaluates as CommonJS even though the root `package.json` sets
  `"type": "module"`, so `require()` works. Verified at plan time.

**Verify** (all four):

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"

.venv/bin/python -c "import yaml;yaml.safe_load(open('.github/workflows/deploy-worker.yml'));print('yaml ok')"
# → yaml ok

node -e 'const r=require("./package.json").devDependencies.wrangler;const p=require("./workers/austlii-scraper/package.json").devDependencies.wrangler;if(r!==p){console.error("wrangler declaration mismatch: root "+r+" vs pipeline "+p);process.exit(1);}console.log("wrangler aligned at "+r);'; echo "guard exit=$?"
# → wrangler aligned at 4.120.0
# → guard exit=0

.venv/bin/pytest tests/test_effective_native_ci.py tests/test_native_effective_references.py -q 2>&1 | tail -3
# → 7 passed

python3 scripts/check_native_effective_references.py --json
# → {"bundle_ok": true, "hits": [], "markers": {"hyperdrive": 0, "pgvector": 0, "postgres": 0, "supabase": 0}, "ok": true, "scope": "deployed-runtime-config-ci"}
```

Sanity-check that the guard actually guards: temporarily change the root
`wrangler` value to `4.120.1`, re-run the `node -e` guard, confirm it prints
`wrangler declaration mismatch: root 4.120.1 vs pipeline 4.120.0` and exits 1,
then **restore `4.120.0`** and re-run the guard until it prints
`wrangler aligned at 4.120.0`. Do not run `npm install` while the value is
tampered with, and confirm `git diff --stat package.json` is back to only the
step-2 changes before committing.

Commit: `ci: gate wrangler declaration drift before the operator deploy`

### Step 6: Final end-to-end verification

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
npm run test:workers 2>&1 | tail -4
(cd workers/austlii-scraper && npm run typecheck; echo "typecheck exit=$?")
(cd workers/austlii-scraper && npm test 2>&1 | tail -4)
.venv/bin/pytest tests/test_effective_native_ci.py tests/test_native_effective_references.py -q 2>&1 | tail -3
python3 scripts/check_native_effective_references.py --json
git status --short
git log --oneline 42826a3..HEAD
```

**Verify**: worker-suite and pipeline-suite counts equal your step-1 baselines;
typecheck exit 0; `7 passed`; reference scan `"ok": true`; `git status --short`
shows nothing beyond the pre-existing ` M .claude/STATE.md` and `?? plans/`
(everything of yours is committed); `git log` shows exactly the four commits
from steps 2–5 with `<type>: <description>` messages and no attribution lines.

## Test plan

This plan writes **no new tests**. It is a dependency-alignment change, and its
correctness criterion is that the existing suites keep passing at identical
counts under the new runner and the new type definitions. Adding tests here
would mean testing npm, not this repository.

What is exercised, and by what:

| Change | Exercised by | Gate |
|---|---|---|
| root vitest 2.1.9 → 4.1.11 | `npm run test:workers` (25 files, 345 tests) and `cd workers && npx vitest run` | identical counts to step-1 baseline, banner reads `RUN v4.1.11` |
| pipeline wrangler `^4.98.0` → `4.120.0` | `npm install --ignore-scripts` resolving without ERESOLVE; `npx wrangler --version` | exit 0; `4.120.0` |
| pipeline workers-types `^4` → `^5` | `cd workers/austlii-scraper && npm run typecheck` over all 17 files in `src/` | exit 0, no diagnostics |
| pipeline suite unaffected | `cd workers/austlii-scraper && npm test` (7 files, 28 tests) | identical counts to step-1 baseline |
| deploy-worker.yml gate step | `tests/test_effective_native_ci.py`, `tests/test_native_effective_references.py`, `scripts/check_native_effective_references.py --json`, PyYAML parse | `7 passed`; `"ok": true`; `yaml ok` |
| the gate actually fails on drift | the tamper-and-restore check in step 5 | exit 1 with the mismatch message, then exit 0 after restore |

Regression risk deliberately accepted and bounded: if the vitest 4 bump breaks
a worker test on your machine, the plan does **not** authorise editing that
test — it is a STOP condition, because those files belong to other in-flight
plans.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `node -p "require('./package.json').devDependencies.vitest"` prints `^4.1.11`
- [ ] `node -p "require('./package-lock.json').packages['node_modules/vitest'].version"` prints `4.1.11`
- [ ] `node -p "require('./package.json').engines.node"` prints `>=22`
- [ ] `node -p "require('./package.json').devDependencies.wrangler"` prints `4.120.0`
- [ ] `node -p "require('./workers/austlii-scraper/package.json').devDependencies.wrangler"` prints `4.120.0`
- [ ] `node -p "require('./workers/austlii-scraper/package.json').devDependencies['@cloudflare/workers-types']"` prints `^5.20260801.1`
- [ ] `node -p "require('./workers/austlii-scraper/package.json').engines.node"` prints `>=22`
- [ ] `node -p "require('./workers/austlii-scraper/package-lock.json').packages['node_modules/wrangler'].version"` prints `4.120.0`
- [ ] `node -p "require('./workers/austlii-scraper/package-lock.json').packages['node_modules/@cloudflare/workers-types'].version.split('.')[0]"` prints `5`
- [ ] `npm run test:workers` exits 0 with the same file/test counts as the step-1 baseline (`25 passed (25)` / `345 passed (345)` at `42826a3`)
- [ ] `cd workers/austlii-scraper && npm run typecheck` exits 0 with no diagnostics
- [ ] `cd workers/austlii-scraper && npm test` exits 0 with the same counts as the step-1 baseline (`7 passed (7)` / `28 passed (28)` at `42826a3`)
- [ ] `grep -c "Node.js | 22+" README.md` prints `1`
- [ ] `grep -rn "18+\|20 LTS" README.md` returns no matches
- [ ] `cat .nvmrc` prints `22`
- [ ] `grep -c "Gate wrangler toolchain alignment" .github/workflows/deploy-worker.yml` prints `1`
- [ ] `.venv/bin/python -c "import yaml;yaml.safe_load(open('.github/workflows/deploy-worker.yml'))"` exits 0
- [ ] `.venv/bin/pytest tests/test_effective_native_ci.py tests/test_native_effective_references.py -q` reports `7 passed`
- [ ] `python3 scripts/check_native_effective_references.py --json` exits 0 and prints `"ok": true` with all four markers `0`
- [ ] `git diff --name-only 42826a3..HEAD` lists **only**: `.github/workflows/deploy-worker.yml`, `.nvmrc`, `README.md`, `package-lock.json`, `package.json`, `workers/austlii-scraper/package-lock.json`, `workers/austlii-scraper/package.json`
- [ ] `git status --short` shows no uncommitted change to any of those seven paths. Pre-existing noise that is **not** yours and must be left alone: a modified `.claude/STATE.md` and an untracked `plans/` directory were both already present at `42826a3` — do not commit, revert, or clean them.
- [ ] `git log --oneline 42826a3..HEAD` shows four commits, each matching `^(feat|fix|refactor|docs|test|chore|perf|ci): `, with no AI attribution lines
- [ ] Nothing was pushed; no PR was opened

## STOP conditions

Stop and report back (do not improvise) if:

- **Any `workers/__tests__/*.test.js` test fails after the vitest bump in
  step 2.** All 345 were verified passing under vitest 4.1.11 at plan time
  against an isolated copy, so a failure means either the suite has changed
  since `42826a3` or something environment-specific is in play. Revert
  `package.json` and `package-lock.json` to their pre-step-2 state
  (`git checkout -- package.json package-lock.json`), and report which test
  files failed and their assertion messages. Do **not** edit a worker test to
  make the bump green — those files are owned by other in-flight plans.
- **`npm install --ignore-scripts` in `workers/austlii-scraper` reports
  `ERESOLVE`.** That means the wrangler/workers-types pairing in step 3 no
  longer matches upstream peer ranges. Report the full npm error and the output
  of `npm view wrangler@4.120.0 peerDependencies`. Do not reach for
  `--force` or `--legacy-peer-deps` — those would produce a lockfile that
  disagrees with what wrangler expects, and CI's `npm ci` would install it
  silently.
- **`npm run typecheck` in `workers/austlii-scraper` reports any diagnostic
  after the workers-types v5 bump.** It was clean at plan time. Report every
  diagnostic verbatim. If the diagnostics are more than a handful and are in
  `src/*.ts` rather than in the manifest, revert the workers-types line to
  `^4.20241205.0`, revert `wrangler` to `^4.98.0` (they must move together —
  see step 3), regenerate the lockfile, and report that the pairing is blocked.
- **`tests/test_effective_native_ci.py` or
  `scripts/check_native_effective_references.py` fails after step 5.** Your
  added YAML step has introduced a forbidden substring. Report the failing
  assertion; do not weaken the test or the scanner to accommodate the step.
- **The Node.js row is no longer at `README.md:106`, or reads something other
  than `| Node.js | 18+ | 推薦 20 LTS |`.** The README has drifted; report the
  actual line and its number rather than guessing which row to edit.
- **`git status --short` shows a modification to any file outside the "In
  scope" list** at any point — excluding the two pre-existing entries that were
  already there at `42826a3` (` M .claude/STATE.md` and `?? plans/`). Report
  which file and why you think it changed.
- **You discover the assumption "the pipeline Worker bundle has no external
  npm dependencies" is false** — i.e. some file under
  `workers/austlii-scraper/src/` imports a bare package specifier. If that is
  true, `deploy-worker.yml` deploying the pipeline from the repo root without
  installing that directory's `node_modules` is a live deploy bug that is
  bigger than this plan. Report it; do not attempt to fix it here.

## Maintenance notes

For whoever owns this next:

- **What a reviewer should scrutinise.** Two things, and only two: (1) that
  both lockfile diffs are pure `npm install` output — no hand edits, and that
  `workers/austlii-scraper/package-lock.json` now carries the same
  `miniflare@5.20260801.1-alpha` / `workerd@1.20260801.1` as the root lock,
  which is the concrete evidence that local `wrangler dev` and the CI deploy now
  emulate on the same runtime; (2) that the new `deploy-worker.yml` step
  contains no `wrangler deploy"` substring and none of the four banned legacy
  markers, since two separate checked-in gates assert on that file's raw text.
- **The wrangler pin and the workers-types major are joined at the hip.** Any
  future wrangler bump in either manifest must check
  `npm view wrangler@<version> peerDependencies` first and move
  `@cloudflare/workers-types` in the same commit. The new gate step catches
  root-vs-pipeline drift but cannot catch a wrangler/workers-types mismatch —
  the ERESOLVE at install time is what catches that.
- **Why the gate covers wrangler only.** wrangler is the tool whose version
  determines what bytes get uploaded, and both manifests pin it exactly, so
  string equality is a meaningful assertion. vitest ranges are deliberately not
  string-equal across the three manifests (root `^4.1.11`, pipeline `^4.1.8`,
  frontend `^4.0.18`) — they now agree on the major, which is what the
  divergence risk was actually about. If someone later wants a stricter vitest
  assertion, it belongs in `ci.yml`, not in the operator deploy workflow.
- **Deferred out of this plan, deliberately**: adding
  `"engines": {"node": ">=22"}` to `frontend/package.json`. It belongs there —
  frontend's eslint/vite/plugin-react floors are `^20.19.0 || >=22.12.0`-class,
  and the repo standardises on 22 — but that file is owned by frontend plans
  that may be landing in parallel, and a two-line manifest edit is not worth a
  merge conflict in a lockfile. Add it in whichever frontend plan touches that
  manifest next.
- **Also deferred**: `frontend/package.json:11-12` (`dev:cloudflare`,
  `deploy:cloudflare`) invoke `wrangler pages dev|deploy` on `dist/`. These are
  almost certainly vestigial — the SPA now ships through the main Worker's
  `[assets]` binding, built by `deploy-worker.yml:91-95` via
  `npm run build:cloudflare`. They are **not broken** (npm puts every ancestor
  `node_modules/.bin` on a run-script's PATH, so bare `wrangler` there resolves
  to root's 4.120.0 after `make install`), so this is a cleanup question, not a
  correctness one. Decide it in a frontend plan.
- **`npm audit` is untouched by this plan and stays noisy.** At `42826a3`,
  `cd frontend && npm audit` reports 17 vulnerabilities (2 low, 1 moderate, 12
  high, 2 critical) and `--omit=dev` reports 8 (1 low, 7 high). The root
  manifest's own advisories are dev-only and include the "Vitest UI server is
  listening" advisory for `<3.2.6` — which the vitest 4 bump in step 2 clears
  from the root tree as a side effect, though root never declared `@vitest/ui`
  or a `--ui` script, so it was unreachable there anyway. Do not treat audit
  output as a gate for this plan.

## Findings reconsidered

Three claims from the audit did not survive verification and are **not** part
of the steps above:

- **"`workers/austlii-scraper`'s `postgres` client is installed and typechecked
  on every CI run."** The typecheck half is false.
  `workers/austlii-scraper/tsconfig.json:15` is `"include": ["src/**/*.ts"]`,
  which excludes `scripts/`, so `npm run typecheck` never compiles
  `scripts/rollback_run.ts` and never resolves its
  `import postgres from "postgres"` (`rollback_run.ts:2`). Confirmed by running
  `npx tsc --noEmit` in that directory: exit 0. The audit's own proposed remedy
  — isolate `scripts/` from the type gate — is therefore already in place. The
  install half is true (`ci.yml:97` does install `postgres`) but is by design:
  it exists solely to run the break-glass Supabase rollback script, which this
  repo explicitly keeps.
- **"`frontend`'s `*:cloudflare` scripts silently fetch a wrangler over the
  network."** False. `frontend/package.json:11-12` call bare `wrangler`, not
  `npx wrangler`, and npm prepends every ancestor `node_modules/.bin` to a
  run-script's PATH — so after `make install` (which runs a root `npm install`)
  they resolve to root's wrangler 4.120.0. No network fetch, no third wrangler.
  Left as a possible cleanup in Maintenance notes rather than a fix.
- **"Production gets workerd 1.20260801."** Overstated. The locally-installed
  `workerd`/`miniflare` govern `wrangler dev` fidelity only; the deployed Worker
  runs on Cloudflare's edge runtime under the config's `compatibility_date`. The
  real exposure — and what step 3 fixes — is dev-versus-deploy bundler and
  emulation skew, not a production runtime mismatch. The `miniflare@5.x-alpha`
  in the root lock is wrangler 4.120.0's own transitive pin, not a repo choice,
  so it is not something to "fix" either.

One evidence correction, folded into the steps rather than dropped:

- The audit framed the README defect as "README says 18+, toolchain needs 22+".
  Reading the lockfiles, `eslint` 10.0.0, `vite` 7.3.1, `@vitejs/plugin-react`
  5.1.4 and `vitest` 4.x all accept Node 20.19+. Only the two wranglers require
  `>=22`. So the table's `推薦 20 LTS` column breaks wrangler alone, while the
  `18+` floor breaks all of them. Step 4's replacement text says exactly that.
