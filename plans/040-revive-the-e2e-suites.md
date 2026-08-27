# Plan 040: Pick one E2E stack, make it run, and gate it

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git diff --stat 42826a3..HEAD -- \
>   tests/e2e \
>   frontend/e2e \
>   frontend/playwright.config.ts \
>   .github/workflows/ci.yml \
>   requirements-test.txt \
>   workers/austlii-scraper/src/__tests__ \
>   workers/austlii-scraper/src/parser.ts \
>   workers/austlii-scraper/src/index.ts
> ```
>
> **Expected drift, which is NOT a stop condition** (these are the plans this
> one depends on; see "Status"):
>
> - `.github/workflows/ci.yml` — plans 001, 002 and 003 each edit one existing
>   job or step. This plan only *appends* new jobs and extends the `on:` block,
>   so their edits and yours do not overlap.
> - `tests/e2e/react/test_react_saved_searches.py` and
>   `tests/e2e/playwright/test_council_thread_visual.py` — plan 003 removes
>   unused imports and one unused local from these two files. Neither file is
>   edited by this plan.
>
> **Unexpected drift IS a stop condition.** In particular, if
> `workers/austlii-scraper/src/index.ts`,
> `tests/e2e/conftest.py`, `tests/e2e/test_smoke.py`,
> `tests/e2e/react/react_helpers.py` or
> `tests/e2e/react/test_react_smoke.py` shows up in that diff, the "Current
> state" excerpts and the exact expected strings in Steps 7 and 8 may no longer
> hold. Re-read those files and compare before proceeding; on a mismatch, stop
> and report.
>
> **If `workers/austlii-scraper/src/parser.ts` shows up in that diff**, plan 033
> has already landed and changed the judge regexes. Do not stop — instead
> re-derive every expected string in Step 7 mechanically with the probe recipe
> in "Re-deriving Step 7's expected values" below, and use what the probe
> prints. Then say in your handoff which values changed.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/002-fix-test-collection-and-install.md` (hard — it
  creates `requirements-e2e.txt` and the `make install-e2e` / `make test-e2e`
  recipes this plan builds on). Run after
  `plans/001-restore-the-frontend-compile-gate.md` and
  `plans/003-lint-the-test-suite.md` as well, to avoid merge churn in
  `.github/workflows/ci.yml` and `tests/`.
  Prefer to run **before** `plans/033-single-source-the-domain-vocabulary.md`,
  which rewrites the judge regexes in
  `workers/austlii-scraper/src/parser.ts`; if 033 has already landed, follow
  "Re-deriving Step 7's expected values" instead of using this plan's literals.
- **Category**: tests
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

This repository carries **two** end-to-end suites for the **same** React SPA —
a Python/pytest-playwright suite under `tests/e2e/` (31 files, 260 `def test_`
definitions) and a TypeScript/Playwright suite under `frontend/e2e/` (9 spec
files, 78 unique tests run twice as `desktop` + `mobile` = 156). **Neither one
runs anywhere.** CI passes `--ignore=tests/e2e` to pytest and has no Playwright
job at all, and the Python suite cannot even be *collected* in the project venv
because `pytest-playwright` is not installed and is in no requirements file.
Meanwhile the 260 Python tests are counted in the ~1,857-test headline in
`CLAUDE.md`, so the repo advertises coverage it does not have.

Both suites have rotted behind the app while nobody was looking. The
TypeScript suite last changed on 2026-03-09; `frontend/src/` last changed on
2026-08-26 — a ~5.5-month gap — and two of the eleven routes it navigates to
(`/search`, `/update-db`) **no longer exist** in `frontend/src/App.tsx`.

Separately, the production AustLII ingestion parser
(`workers/austlii-scraper/src/parser.ts`, 339 lines) has **no direct test**, and
the single test that executes it asserts nothing about what it parsed. While
writing this plan the parser was driven by hand and it is **actively losing
content** on realistic AustLII HTML (see "Current state" §4) — exactly the
silent-regression class the missing tests were supposed to catch.

After this plan: one E2E suite, installable and collectible; a fast blocking
smoke gate on every PR; the full suite on a nightly schedule; the second suite
deleted; and the ingestion parser pinned by 22 direct tests plus a real
round-trip assertion on what the scrape phase writes to R2.

## Current state

### 1. The Python E2E suite cannot be collected

`.venv` has `pytest`, `pytest-asyncio`, `pytest-cov`, `pytest-timeout` — and no
`playwright` / `pytest-playwright`. Verified at `42826a3`:

```
$ .venv/bin/python -m pytest tests/e2e/ --collect-only -q
    from playwright.sync_api import Page
E   ModuleNotFoundError: No module named 'playwright'
ERROR tests/e2e/playwright/test_council_thread_visual.py
ERROR tests/e2e/react/test_react_analytics.py
... (20 ERROR lines total)
!!!!!!!!!!!!!!!!!!! Interrupted: 20 errors during collection !!!!!!!!!!!!!!!!!!!
==================== 42 tests collected, 20 errors in 4.61s ====================
```

`grep -rn playwright requirements*.txt Makefile .github/workflows/` returns
nothing. The three files that *do* collect (`tests/e2e/test_smoke.py`,
`test_export.py`, `test_credentialed_auth_smoke.py`) still fail at run time,
because their `page` fixture depends on a `browser` fixture that only the
`pytest-playwright` plugin provides — see `tests/e2e/conftest.py:296-297`
(verbatim):

```python
@pytest.fixture
def page(browser, base_url):
```

**Plan 002 fixes the packaging half of this.** It creates
`requirements-e2e.txt` containing `pytest-playwright>=0.9.0`, adds a
`make install-e2e` recipe (`pip install -r requirements-e2e.txt` then
`python -m playwright install chromium`), and rewrites `make test-e2e` with a
self-diagnosing import guard. This plan assumes all three exist — Step 1
verifies it.

### 2. CI ignores `tests/e2e` and has no Playwright job

`.github/workflows/ci.yml:38-46` (verbatim):

```yaml
      - name: Run Python unit tests
        run: >-
          .venv/bin/pytest
          tests/
          -q --timeout=120
          --ignore=tests/e2e
          --ignore=tests/integration
          --ignore=tests/test_cloudflare_native_bundle.py
          --ignore=tests/test_native_effective_references.py
```

`grep -rn -i "playwright\|e2e" .github/workflows/` returns exactly one line —
the `--ignore=tests/e2e` above. There are two workflow files (`ci.yml`,
`deploy-worker.yml`) and three jobs (`test-python`, `test-frontend`,
`test-worker`). `ci.yml:1-14` (verbatim):

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

### 3. The duplicate TypeScript suite is dead against the current UI

`frontend/e2e/` holds 13 tracked files. `frontend/e2e/smoke.spec.ts:1-2`
(verbatim):

```typescript
import { test, expect } from "@playwright/test"
import { ALL_PAGES, waitForReact } from "./helpers"
```

`frontend/e2e/helpers.ts:4-16` (verbatim) — the routes it drives:

```typescript
export const ROUTES = {
  dashboard: "/",
  cases: "/cases",
  caseAdd: "/cases/add",
  caseCompare: "/cases/compare",
  search: "/search",
  download: "/download",
  updateDb: "/update-db",
  jobs: "/jobs",
  pipeline: "/pipeline",
  dataDictionary: "/data-dictionary",
  designTokens: "/design-tokens",
} as const
```

`grep -n 'path="search"\|path="update-db"' frontend/src/App.tsx` returns
nothing — the SPA has no `/search` and no `/update-db` route any more, so
`smoke.spec.ts` is guaranteed red on 2 of its 11 pages (× 2 projects) before
anyone even looks at the other 7 spec files. `npx playwright test --list`
reports `Total: 156 tests in 9 files`.

`frontend/playwright.config.ts:36-43` boots the app itself:

```typescript
  webServer: {
    command: `cd .. && ${pythonCommand} web.py --port 8080 --backend sqlite --output /tmp/immi_e2e_test_data`,
    url: "http://127.0.0.1:8080/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
  },
```

The Python suite does the same thing but in-process and with richer seed data —
`tests/e2e/conftest.py:232-274` launches Flask on a free port in a daemon
thread with 10 seeded `ImmigrationCase` rows across 5 courts, and
`reset_fixture_dataset` (`conftest.py:332-355`) re-seeds before every test. That
self-containment is why the Python suite is the survivor.

### 4. The ingestion parser has no test, and its one caller asserts nothing

`workers/austlii-scraper/src/parser.ts` exports exactly two functions —
`extractFullText` at line 30 and `extractMetadata` at line 247. The only
importer anywhere is `workers/austlii-scraper/src/index.ts:12`:

```typescript
import { extractFullText, extractMetadata } from "./parser";
```

`grep -rn "parser\|extractMetadata\|extractFullText" workers/austlii-scraper/src/__tests__/`
returns nothing.

`workers/austlii-scraper/src/__tests__/pipeline-scrape.test.ts:15-22` drives it
indirectly with this stub (verbatim):

```typescript
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><body>
        <h1>Applicant v Minister [2026] FCA 42</h1>
        <p>CATCHWORDS: MIGRATION - protection visa - Subclass 866</p>
        <p>The applicant is a citizen of India. The applicant was represented by Mr Smith.</p>
        <p>This body is intentionally longer than fifty characters so extraction succeeds.</p>
      </body></html>
    `, { status: 200 })));
```

…and then asserts only the two R2 key strings and the forwarded queue message
(`pipeline-scrape.test.ts:57-68`, verbatim):

```typescript
    const jsonKey = "runs/11111111-1111-4111-8111-111111111111/FCA/abcdef123456.json";
    expect(puts.has(jsonKey)).toBe(true);
    expect(puts.has("runs/11111111-1111-4111-8111-111111111111/FCA/abcdef123456.html")).toBe(true);
    expect(extractMessages).toEqual([
      expect.objectContaining({
        phase: "extract",
        run_id: job.run_id,
        case_id: job.case_id,
        court_code: "FCA",
        r2_key: jsonKey,
      }),
    ]);
```

It captures the R2 body in a `Map` called `puts` and never `JSON.parse`s it.

**Three real parser defects were found by driving these functions by hand while
writing this plan.** All three were reproduced against `parser.ts` at `42826a3`.
You are NOT fixing them here — see "Scope"/"STOP conditions" — you are pinning
them so they become visible:

- **(D1) Content loss between consecutive tags.** `parser.ts:211` (verbatim):

  ```typescript
    .replace(/<(?:p|div|h[1-6]|li|tr|blockquote|pre|section|article)[\s>][^>]*>/gi, "\n");
  ```

  `[\s>]` already consumes the tag's own `>`, so `[^>]*` then runs on to the
  **next** `>` anywhere in the document, deleting everything in between.
  `extractFullText('<div id="page-main"><p>FIRST PARAGRAPH</p><p>SECOND …</p></div>')`
  returns text starting `"SECOND PARAGRAPH"` — `FIRST PARAGRAPH` is gone. The
  same happens before any inline tag: `<p>Text with an <a href="/l">inline
  link</a> …` yields `"inline link inside …"` — `Text with an ` is gone.
  On the realistic sample in Step 7 this drops the `<h1>` citation, the
  `CATCHWORDS` line and the outcome sentence, which is why the stub above
  produces `citation_extracted: ""`, `outcome: ""` and empty `judges`/`date`.

- **(D2) `outcome` matches "decision" inside CATCHWORDS.** `parser.ts:303` uses
  `/(?:DECISION|ORDER|ORDERS|THE COURT ORDERS)[:\s]*\n?(.*?)(?:\n\s*\n)/is`, and
  the `/i` flag makes it match the lowercase word `decision` in a catchwords
  line. For the AATA sample in Step 7 it returns `"decision affirmed"` instead
  of `"The Tribunal affirms the decision under review."`.

- **(D3) `legislation` truncates at the first `.`.** `parser.ts:325-326` uses
  `/Migration Regulations 1994[^.]*/gi`, so `Migration Regulations 1994 (Cth)
  reg 2.03` is cut to `"Migration Regulations 1994 (Cth) reg 2"`.

Baseline for that package: `cd workers/austlii-scraper && npm test` →
`Test Files 7 passed (7)` / `Tests 28 passed (28)`; `npm run typecheck` → exit 0.
`workers/austlii-scraper/vitest.config.ts` sets `include: ["src/**/*.test.ts"]`
and `globals: false`, so a new file at `src/__tests__/parser.test.ts` is picked
up automatically and **must import `describe`/`it`/`expect` from `"vitest"`**.

### 5. Repo conventions that apply

- **Commit messages**: `<type>: <description>`, type ∈
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines. Real
  example from `git log`: `fix: install root node_modules in make install`.
- **Python**: always use `.venv/bin/python`, `.venv/bin/pytest`,
  `.venv/bin/ruff` — never a global `pip`/`python3`.
- **Ruff**: `tests/e2e/test_smoke.py` and `tests/e2e/react/test_react_smoke.py`
  are currently ruff-clean (`.venv/bin/ruff check tests/e2e/` reports 3 errors,
  all in `tests/e2e/react/test_react_saved_searches.py`). Keep them clean.
- **The Flask app is LOCAL-DEV ONLY.** Production is the Cloudflare Worker
  `workers/cloudflare-native.js`. Both E2E suites drive Flask, so they are a
  local-dev-parity gate, not a production gate. Say so in the README you write
  in Step 6 — do not let a future reader believe these tests cover production.
- The built SPA bundle **is committed** (`git ls-files
  immi_case_downloader/static/react | wc -l` → 93, including `index.html`), so
  CI does **not** need `npm run build` before running the Python E2E suite.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install E2E deps (from plan 002) | `make install-e2e` | exit 0; chromium downloaded |
| Collect Python E2E | `.venv/bin/pytest tests/e2e --collect-only -q --no-cov 2>&1 \| tail -1` | a line ending `tests collected in …` with **no** `error` in it |
| Run E2E smoke subset | `.venv/bin/pytest tests/e2e/test_smoke.py tests/e2e/react/test_react_smoke.py -q --no-cov --timeout=180` | `100 passed` |
| Run full E2E (nightly command) | `.venv/bin/pytest tests/e2e -q --no-cov --timeout=300 --ignore=tests/e2e/playwright` | `… passed`, 0 failed |
| Python unit tests | `make test-py` | `1141 passed, 3 failed, 7 skipped` (the 3 are a pre-existing local `pypdf`/`pyexpat` ABI failure — see STOP conditions) |
| Ruff (repo scope) | `make lint` | `All checks passed!` |
| Ruff (tests scope) | `.venv/bin/ruff check tests/e2e/` | no *new* findings vs. baseline |
| Scraper Worker tests | `cd workers/austlii-scraper && npm test` | `Test Files 8 passed (8)` / `Tests 50 passed (50)` after Steps 7–8 |
| Scraper Worker typecheck | `cd workers/austlii-scraper && npm run typecheck` | exit 0, no output |
| Main Worker tests | `npm run test:workers` | `345 passed` |
| Frontend tests | `cd frontend && npx vitest run` | `490 passed`, 55 files |
| YAML sanity | `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/ci.yml'))" && echo YAML_OK` | `YAML_OK` |

Note: `pytest.ini` sets `addopts = -v --cov=immi_case_downloader
--cov-report=term-missing`. Every E2E command above passes `--no-cov` because
coverage of a Flask server running in a daemon thread is meaningless and slow.

## Scope

**In scope** (the only files you may create, modify or delete):

- `.github/workflows/ci.yml` — extend the `on:` block; **append** two new jobs.
  Do not edit the existing `test-python`, `test-frontend` or `test-worker` jobs.
- `frontend/e2e/**` — **delete all 13 tracked files** (Step 5).
- `frontend/playwright.config.ts` — **delete** (Step 5).
- `tests/e2e/README.md` — **create** (Step 6).
- `tests/e2e/test_smoke.py` — modify **only** if Step 3 finds a stale assertion.
- `tests/e2e/react/test_react_smoke.py` — same.
- `workers/austlii-scraper/src/__tests__/parser.test.ts` — **create** (Step 7).
- `workers/austlii-scraper/src/__tests__/pipeline-scrape.test.ts` — modify
  (Step 8).
- `plans/040-revive-the-e2e-suites.md` (this file) and `plans/README.md` —
  status rows only.

**Out of scope** (do NOT touch, even though they look related):

- `requirements-test.txt`. It is inside this plan's file territory and is
  deliberately left unchanged. Plan 002 established that `pytest-playwright`
  goes in a separate `requirements-e2e.txt` so the CI `test-python` job does not
  download a ~40 MB browser driver for a suite it never runs. Putting it in
  `requirements-test.txt` would undo that. The `ruff==0.15.18` pin on line 7 is
  deliberate and documented in its own comment.
- `workers/austlii-scraper/src/parser.ts`. **Plan 033 owns this file** (it
  rewrites the judge regexes at lines 259-262 and the docstring at 243-246).
  Defects D1/D2/D3 are real and are recorded in "Maintenance notes" for
  whoever owns the fix — pin them, do not fix them here. Editing this file would
  collide with plan 033.
- `workers/austlii-scraper/src/index.ts` and every other file under
  `workers/austlii-scraper/src/` that is not in `__tests__/`.
- `frontend/package.json`. It still has `"e2e"`, `"e2e:ui"`, `"e2e:headed"`
  scripts and an `@playwright/test` devDependency that become dead after Step 5.
  Plans 001, 024 and 035 all edit this file; a fourth editor guarantees a
  conflict. Record it in your handoff instead — see "Maintenance notes".
- `frontend/src/**`. If an E2E test fails because the app is genuinely broken,
  that is a STOP condition, not a licence to edit the app.
- `Makefile` and `pytest.ini` — plans 001, 002 and 003 own them. In particular
  do **not** add an `e2e_smoke` pytest marker: registering a marker means
  editing `pytest.ini`. Select the smoke subset by **file path**, as the
  commands in this plan do.
- `tests/e2e/playwright/test_council_thread_visual.py`. Plan 003 edits it, and
  it defaults to `E2E_BASE_URL=https://immi.trackit.today` and makes **real LLM
  calls against production** (`test_council_thread_visual.py:39`). It must never
  run in CI. Its one `@pytest.mark.skip` (line 320) stays — see "Findings
  reconsidered".
- `tests/e2e/react/test_react_saved_searches.py` — plan 003 owns it.
- `tests/integration/**`, `tests/test_backfill_judge_overrides_from_pdf.py`.
- `wrangler.toml` placeholder resource IDs, `IMMI_CASE_MUTATIONS_ENABLED` and
  the pipeline flags defaulting to `"false"`,
  `workers/austlii-scraper/scripts/rollback_run.ts` targeting legacy Supabase —
  all fail-closed / break-glass **by design**.
- `CLAUDE.md`. Its test-count line becomes stale once `frontend/e2e/` is gone.
  Report it; do not edit it.

## Git workflow

- Branch: `advisor/040-revive-the-e2e-suites`
- One commit per step, or per logical unit. Suggested messages:
  - Step 4: `ci: gate the E2E smoke subset on PRs and run the full suite nightly`
  - Step 5: `chore: delete the duplicate TypeScript E2E suite`
  - Step 6: `docs: record the single-E2E-suite decision`
  - Step 7: `test: cover the AustLII ingestion parser directly`
  - Step 8: `test: assert the scrape phase R2 payload round-trips`
- Do NOT push, do NOT open a PR, do NOT merge. The operator commits.

## Steps

### Step 1: Verify plan 002's E2E packaging has landed

This plan depends on artefacts plan 002 creates. Confirm all three exist before
doing anything else.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  test -f requirements-e2e.txt && \
  grep -c 'pytest-playwright' requirements-e2e.txt && \
  grep -c '^install-e2e:' Makefile
```

**Verify**: the command above → exits 0 and prints `1` then `1`.
If `requirements-e2e.txt` does not exist, or `install-e2e:` is not a Makefile
target, **STOP** — plan 002 has not landed and this plan cannot proceed.

### Step 2: Install the E2E dependencies and prove the suite collects

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make install-e2e
```

Then:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/pytest tests/e2e --collect-only -q --no-cov 2>&1 | tail -1
```

**Verify**: the last line matches `NNN tests collected in X.XXs` and contains
**no** `error`. Before this step it was
`42 tests collected, 20 errors in 4.61s`. Record the `NNN` you get — you will
quote it in Step 6.

If any collection error remains, **STOP** and report the error text.

### Step 3: Get the smoke subset green

The smoke subset is exactly two files, chosen because they are cheap, they
exercise every SPA route the app still has, and they are ruff-clean:

- `tests/e2e/test_smoke.py` — 25 tests: SPA shell loads, 12 SPA routes return
  200, 4 security headers present, 2 JSON API routes, 2 export downloads.
- `tests/e2e/react/test_react_smoke.py` — 75 tests: 14 SPA pages × (loads,
  no JS errors) = 28, 7 heading assertions, 18 API endpoints × (200, JSON) = 36,
  4 payload-shape assertions.

Run them:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/pytest tests/e2e/test_smoke.py tests/e2e/react/test_react_smoke.py \
  -q --no-cov --timeout=180
```

**Expected**: `100 passed`.

All 14 routes in `SMOKE_PAGES` (`tests/e2e/react/react_helpers.py:32-46`) and
all 12 in `SPA_ROUTES` (`tests/e2e/helpers.py:7-19`) were checked against
`frontend/src/App.tsx` at `42826a3` and every one still exists. All 18
`API_ENDPOINTS` (`react_helpers.py:50-69`) were checked against
`immi_case_downloader/web/routes/` and every one is still registered. All four
`EXPECTED_SECURITY_HEADERS` are set in
`immi_case_downloader/web/security.py:154-157`. So a failure here is most likely
a **UI text drift** (a renamed heading) or a **genuine app bug**.

Triage rules — follow them exactly:

- **Heading/label drift** (e.g. `get_heading` no longer contains `"Dashboard"`):
  fix the assertion in the test file. Confirm the new text by reading the page
  component under `frontend/src/pages/`. Use the *current* UI string.
- **A page renders a JS error, 500s, or `#root` stays empty**: that is a real
  application defect. **STOP** and report it. Do not edit `frontend/src/`.
- **A test is flaky** (passes on rerun): rerun twice more. If it fails 1-in-3 or
  worse, **STOP** and report which test and what it waits on. Do not paper over
  it with `time.sleep`.

**Verify**: the command above → `100 passed`, and

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/ruff check tests/e2e/test_smoke.py tests/e2e/react/test_react_smoke.py
```

→ `All checks passed!`

### Step 4: Add the CI gates

Two edits to `.github/workflows/ci.yml`. Do not touch the three existing jobs.

**4a.** Replace the `on:` block (`ci.yml:3-7`) with:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  # Nightly full E2E run. 15:30 UTC is ~02:30 in Australia/Sydney, i.e. after
  # the working day for this project's only operator.
  schedule:
    - cron: "30 15 * * *"
  workflow_dispatch:
```

**4b.** Append these two jobs at the end of the file, after the existing
`test-worker` job. Keep the two-space job indentation the file already uses.

```yaml
  e2e-smoke:
    # Blocking PR gate. Runs the two E2E files proven green in plan 040 Step 3.
    # The Flask app is local-dev only (production is workers/cloudflare-native.js),
    # so this is a local-dev-parity gate, not a production gate.
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install Python + E2E dependencies
        run: |
          python3 -m venv .venv
          .venv/bin/pip install --quiet -r requirements-app.txt -r requirements-test.txt -r requirements-e2e.txt

      - name: Install Playwright chromium
        run: .venv/bin/python -m playwright install --with-deps chromium

      # The built SPA bundle is committed under immi_case_downloader/static/react/,
      # so no `npm run build` is needed here. tests/e2e/conftest.py launches Flask
      # in-process on a free port with 10 seeded cases.
      - name: Run E2E smoke subset
        run: >-
          .venv/bin/pytest
          tests/e2e/test_smoke.py
          tests/e2e/react/test_react_smoke.py
          -q --no-cov --timeout=180

  e2e-nightly:
    # Full suite — too slow for every PR. Scheduled and manual only.
    # tests/e2e/playwright/ is excluded on purpose: test_council_thread_visual.py
    # defaults to E2E_BASE_URL=https://immi.trackit.today and makes real LLM calls
    # against production. It must never run from CI.
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install Python + E2E dependencies
        run: |
          python3 -m venv .venv
          .venv/bin/pip install --quiet -r requirements-app.txt -r requirements-test.txt -r requirements-e2e.txt

      - name: Install Playwright chromium
        run: .venv/bin/python -m playwright install --with-deps chromium

      - name: Run full E2E suite
        run: >-
          .venv/bin/pytest
          tests/e2e
          -q --no-cov --timeout=300
          --ignore=tests/e2e/playwright
```

Now run the **exact** nightly command locally:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/pytest tests/e2e -q --no-cov --timeout=300 --ignore=tests/e2e/playwright
```

The `tests/e2e/react/` directory last changed on 2026-04-27 while
`frontend/src/` changed through 2026-08-26, so some of these ~250 tests are
expected to be stale. Triage them with the **same three rules as Step 3**
(assertion drift → fix the assertion; real app defect → STOP; flaky → STOP).

**Bounded escape hatch**: if, after triage, one or more *whole files* are
irrecoverably red for a reason that is not an app defect (for example they
assert against a feature that was intentionally removed), add each one as an
explicit `--ignore=` line in the `Run full E2E suite` step **and** record the
file plus its one-line reason in the README you write in Step 6. Silent
`pytest.mark.skip` is not acceptable — the ignore must be visible in the
workflow file. Never ignore more than 5 files; if you need a sixth, **STOP** and
report.

**Verify**, all three:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  python3 -c "import yaml;d=yaml.safe_load(open('.github/workflows/ci.yml'));print(sorted(d['jobs']))" && \
  python3 -c "import yaml;d=yaml.safe_load(open('.github/workflows/ci.yml'));print(sorted(d[True]))"
```

→ first line `['e2e-nightly', 'e2e-smoke', 'test-frontend', 'test-python', 'test-worker']`
→ second line `['pull_request', 'push', 'schedule', 'workflow_dispatch']`
(PyYAML parses the bare key `on` as the boolean `True`; that is expected.)

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/pytest tests/e2e -q --no-cov --timeout=300 --ignore=tests/e2e/playwright 2>&1 | tail -1
```

→ a summary line containing `passed` and **not** containing `failed` or `error`.

### Step 5: Delete the duplicate TypeScript E2E suite

Only after Steps 2–4 prove the Python suite runs.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  git rm -r frontend/e2e && git rm frontend/playwright.config.ts
```

That removes 13 + 1 = 14 tracked files.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  git ls-files frontend/e2e frontend/playwright.config.ts | wc -l && \
  cd frontend && npx tsc -b --noEmit; echo "tsc=$?" && npx vitest run 2>&1 | tail -3
```

→ `0`, then `tsc=0`, then `Tests  490 passed (490)`.

Note: plan 001 creates `frontend/tsconfig.test.json` with
`include: ["__tests__", "vitest.config.ts", "playwright.config.ts", "scripts"]`.
A literal `include` entry that matches nothing is silently skipped by
TypeScript as long as other entries match, so the `tsc -b` check above is the
proof that the deletion is safe. If `tsc=0` does not hold, **STOP**.

### Step 6: Record the decision in `tests/e2e/README.md`

Create `tests/e2e/README.md`. It exists so nobody re-adds a second E2E runner in
six months. Include, in your own words but covering all of this:

- **One suite only.** `tests/e2e/` (pytest + `pytest-playwright`) is the
  project's only E2E suite. `frontend/e2e/` (TypeScript + `@playwright/test`)
  was deleted in this change: it duplicated the same SPA with 78 unique tests
  against `tests/e2e`'s 260, had not been touched since 2026-03-09, and drove
  two routes (`/search`, `/update-db`) the SPA no longer has.
- **What it actually covers.** These tests drive the **Flask app**
  (`web.py` / `immi_case_downloader/web/`), which is **local-dev only**.
  Production is the Cloudflare Worker `workers/cloudflare-native.js`. Treat this
  suite as a local-dev-parity gate, not a production gate.
- **How to run it.** `make install-e2e` once, then `make test-e2e`; the smoke
  subset is
  `.venv/bin/pytest tests/e2e/test_smoke.py tests/e2e/react/test_react_smoke.py -q --no-cov --timeout=180`.
- **How it is gated.** `e2e-smoke` blocks every PR (the two smoke files);
  `e2e-nightly` runs the rest on the `30 15 * * *` schedule and on
  `workflow_dispatch`. Both live in `.github/workflows/ci.yml`.
- **`tests/e2e/playwright/` is excluded from CI on purpose.**
  `test_council_thread_visual.py` targets `https://immi.trackit.today` by
  default and makes real LLM calls that cost Cloudflare AI Gateway credits. Run
  it by hand, after a deploy, only when you mean to.
- **The collected test count** you recorded in Step 2.
- **Any files you added to the nightly `--ignore=` list in Step 4**, one line of
  reason each. Omit this section if the list is empty.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  test -f tests/e2e/README.md && \
  grep -c "local-dev" tests/e2e/README.md && \
  grep -c "e2e-nightly" tests/e2e/README.md
```

→ exits 0 and prints a number ≥ 1 twice.

### Step 7: Add direct tests for the ingestion parser

Create `workers/austlii-scraper/src/__tests__/parser.test.ts` with **22** tests.
Import style must match the package (`globals: false`):

```typescript
import { describe, expect, it } from "vitest";
import { extractFullText, extractMetadata } from "../parser";
```

Every expected value below was produced by executing the real `parser.ts` at
commit `42826a3`. Use them verbatim. Define `const FILLER = "x".repeat(120);`
(and `"y".repeat(120)` where noted) — `extractFullText` requires >100 characters
before it accepts a strategy's output (`parser.ts:33,37,41`).

**`describe("extractFullText")` — 7 tests**

| # | Input | `toBe(...)` |
|---|---|---|
| 1 | `` `<html><body><div id="page-main">PRIMARY ${FILLER}</div><div id="cases_doc">SECONDARY ${FILLER}</div></body></html>` `` | `` `PRIMARY ${FILLER}` `` |
| 2 | `` `<html><body><div id="cases_doc">FALLBACK2 ${FILLER}</div></body></html>` `` | `` `FALLBACK2 ${FILLER}` `` |
| 3 | `` `<html><body><div class="document">FALLBACK3 ${FILLER}</div></body></html>` `` | `` `FALLBACK3 ${FILLER}` `` |
| 4 | `` `<html><body><nav>NAVLINKS</nav><script>var a=1;</script><style>.x{}</style>BODYTEXT ${FILLER}<footer>FOOT</footer></body></html>` `` | `` `BODYTEXT ${FILLER}` `` |
| 5 | `"not html"` | `""` |
| 6 | `` `<html><body><div id="page-main">tiny</div>BODYWINS ${FILLER}</body></html>` `` | `` `tiny\nBODYWINS ${FILLER}` `` |
| 7 | `` `<html><body><div id="page-main">R &amp;amp; R v Minister &amp;#8212; s&amp;nbsp;501 &amp;lt;test&amp;gt; ${FILLER}</div></body></html>` `` | `` `R & R v Minister — s 501 <test> ${FILLER}` `` |

(For test 7 write the entities literally in the source: `&amp;`, `&#8212;`,
`&nbsp;`, `&lt;`, `&gt;`. The em dash in the expectation is U+2014.)

Name them after what they prove — e.g. test 1 `prefers id="page-main" over
id="cases_doc"`, test 4 `falls back to <body> and strips nav/script/style/footer`,
test 6 `ignores a page-main shorter than 100 characters`.

**`describe("extractMetadata")` — 11 tests**

Define two fixtures:

```typescript
const AATA_TEXT = [
  "ADMINISTRATIVE APPEALS TRIBUNAL",
  "Singh and Minister for Immigration [2024] AATA 100",
  "TRIBUNAL MEMBER: Senior Member A Jones",
  "CATCHWORDS: MIGRATION - protection visa - character test - decision affirmed",
  "",
  "Date of decision: 15 March 2024",
  "The Tribunal affirms the decision under review.",
  "",
  "Migration Act 1958 (Cth) s 501 was considered.",
].join("\n");

const FCA_TEXT = [
  "FEDERAL COURT OF AUSTRALIA",
  "Patel v Minister for Immigration [2023] FCA 500",
  "Coram: Williams J",
  "CATCHWORDS: MIGRATION - judicial review - jurisdictional error",
  "",
  "Date of judgment: 10 September 2023",
  "The Court orders that the application be allowed.",
  "",
  "Migration Regulations 1994 (Cth) reg 2.03 applies.",
].join("\n");
```

Assert, one `it` per row:

| # | Expression | `toBe(...)` |
|---|---|---|
| 8 | `extractMetadata(AATA_TEXT).judges` | `"Senior Member A Jones"` |
| 9 | `extractMetadata(AATA_TEXT).date` | `"15 March 2024"` |
| 10 | `extractMetadata(AATA_TEXT).catchwords` | `"MIGRATION - protection visa - character test - decision affirmed"` |
| 11 | `extractMetadata(AATA_TEXT).citation_extracted` | `"[2024] AATA 100"` |
| 12 | `extractMetadata(AATA_TEXT).visa_type` | `"protection visa"` |
| 13 | `extractMetadata(FCA_TEXT).judges` | `"Williams J"` (proves the `Coram:` pattern at `parser.ts:261`) |
| 14 | `extractMetadata(FCA_TEXT).date` | `"10 September 2023"` |
| 15 | `extractMetadata(FCA_TEXT).citation_extracted` | `"[2023] FCA 500"` |
| 16 | `extractMetadata(FCA_TEXT).outcome` | `"The Court orders that the application be allowed."` |
| 17 | `extractMetadata("")` | `toEqual` the all-empty-string object (all 7 keys `""`) |
| 18 | `extractMetadata("Nothing useful here at all.")` | same all-empty object |

**`describe("known defects — pinned, not endorsed")` — 4 tests**

Put this comment above the block, verbatim:

```typescript
// These four assertions pin behaviour that is WRONG. They exist so the defects
// are visible in CI and so that fixing them produces an obvious, intentional
// test failure rather than a silent change in ingested data.
// parser.ts is owned by plans/033-single-source-the-domain-vocabulary.md — do
// not "fix" it from here. See plans/040 "Maintenance notes" for D1/D2/D3.
```

| # | Name | Expression | `toBe(...)` |
|---|---|---|---|
| 19 | `D1: drops the text of a block element followed by another tag` | `` extractFullText(`<div id="page-main"><p>FIRST PARAGRAPH</p><p>SECOND PARAGRAPH ${FILLER_Y}</p></div>`) `` | `` `SECOND PARAGRAPH ${FILLER_Y}` `` — correct would keep `FIRST PARAGRAPH` |
| 20 | `D1: drops the text before an inline <a> inside a block` | `` extractFullText(`<div id="page-main"><p>Text with an <a href="/l">inline link</a> inside ${FILLER_Y}</p></div>`) `` | `` `inline link inside ${FILLER_Y}` `` — correct would keep `Text with an ` |
| 21 | `D2: outcome matches "decision" inside CATCHWORDS` | `extractMetadata(AATA_TEXT).outcome` | `"decision affirmed"` — correct would be `"The Tribunal affirms the decision under review."` |
| 22 | `D3: legislation truncates at the first "."` | `extractMetadata(FCA_TEXT).legislation` | `"Migration Regulations 1994 (Cth) reg 2"` — correct would be `"Migration Regulations 1994 (Cth) reg 2.03"` |

Put the "correct would be" text in a trailing comment on each assertion.
`FILLER_Y` is `"y".repeat(120)`.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && \
  npm test 2>&1 | tail -5 && npm run typecheck; echo "tsc=$?"
```

→ `Test Files  8 passed (8)` / `Tests  50 passed (50)`, then `tsc=0`.

If any of tests 1–18 fails, **STOP** — `parser.ts` has drifted from `42826a3`
and these expectations are stale (unless the drift check flagged `parser.ts`, in
which case re-derive below instead). If any of 19–22 fails, `parser.ts` has been
*fixed* by another plan; also **STOP** and report which one, so the pin can be
replaced with the correct expectation rather than deleted.

#### Re-deriving Step 7's expected values

Only needed if the drift check showed `workers/austlii-scraper/src/parser.ts`
changed since `42826a3` (plan 033 rewrites its judge regexes). This is exactly
how the literals in the tables above were produced. It creates no files.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && ./node_modules/.bin/tsx -e '
import("/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper/src/parser.ts").then((mm) => {
  // tsx transpiles to CJS, so the named exports arrive under .default
  const m = mm.default;
  const F = "x".repeat(120), Y = "y".repeat(120);
  const P = (l, v) => console.log("### " + l + "\n" + JSON.stringify(v, null, 2) + "\n");

  P("1 page-main wins",   m.extractFullText(`<html><body><div id="page-main">PRIMARY ${F}</div><div id="cases_doc">SECONDARY ${F}</div></body></html>`));
  P("2 cases_doc",        m.extractFullText(`<html><body><div id="cases_doc">FALLBACK2 ${F}</div></body></html>`));
  P("3 class=document",   m.extractFullText(`<html><body><div class="document">FALLBACK3 ${F}</div></body></html>`));
  P("4 body strip",       m.extractFullText(`<html><body><nav>NAVLINKS</nav><script>var a=1;</script><style>.x{}</style>BODYTEXT ${F}<footer>FOOT</footer></body></html>`));
  P("5 no body",          m.extractFullText("not html"));
  P("6 short page-main",  m.extractFullText(`<html><body><div id="page-main">tiny</div>BODYWINS ${F}</body></html>`));
  P("7 entities",         m.extractFullText(`<html><body><div id="page-main">R &amp; R v Minister &#8212; s&nbsp;501 &lt;test&gt; ${F}</div></body></html>`));
  P("19 D1 block",        m.extractFullText(`<div id="page-main"><p>FIRST PARAGRAPH</p><p>SECOND PARAGRAPH ${Y}</p></div>`));
  P("20 D1 inline",       m.extractFullText(`<div id="page-main"><p>Text with an <a href="/l">inline link</a> inside ${Y}</p></div>`));

  const AATA = ["ADMINISTRATIVE APPEALS TRIBUNAL","Singh and Minister for Immigration [2024] AATA 100","TRIBUNAL MEMBER: Senior Member A Jones","CATCHWORDS: MIGRATION - protection visa - character test - decision affirmed","","Date of decision: 15 March 2024","The Tribunal affirms the decision under review.","","Migration Act 1958 (Cth) s 501 was considered."].join("\n");
  const FCA  = ["FEDERAL COURT OF AUSTRALIA","Patel v Minister for Immigration [2023] FCA 500","Coram: Williams J","CATCHWORDS: MIGRATION - judicial review - jurisdictional error","","Date of judgment: 10 September 2023","The Court orders that the application be allowed.","","Migration Regulations 1994 (Cth) reg 2.03 applies."].join("\n");
  P("8-12,21 AATA", m.extractMetadata(AATA));
  P("13-16,22 FCA", m.extractMetadata(FCA));
  P("17 empty",     m.extractMetadata(""));
  P("18 no match",  m.extractMetadata("Nothing useful here at all."));

  const STUB = `
      <html><body><div id="page-main">
        <p>Applicant v Minister [2026] FCA 42<br/>
        Coram: Brown J<br/>
        CATCHWORDS: MIGRATION - protection visa - Subclass 866<br/>
        Date of judgment: 3 February 2026<br/>
        The Court orders that the application be dismissed.<br/>
        This body is intentionally longer than fifty characters so extraction succeeds.<br/>
        Migration Act 1958 (Cth) s 476.</p>
      </div></body></html>
    `;
  P("Step 8 stub meta", m.extractMetadata(m.extractFullText(STUB)));
});
'
```

Use whatever this prints. If a *defect* pin (19, 20, 21, 22) now shows correct
behaviour, delete that pin and fold the value into the ordinary assertion above
it, and note the change in your handoff.

### Step 8: Make the scrape-phase test assert what it wrote to R2

Edit `workers/austlii-scraper/src/__tests__/pipeline-scrape.test.ts`. Two
changes inside the first `it(...)` block only.

**8a.** Replace the stub HTML at lines 15-22 with one whose fields the parser
can actually reach. `<br/>` becomes a newline in `stripHtmlTags`
(`parser.ts:209`) and does not trigger defect D1, unlike consecutive `<p>`
tags:

```typescript
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`
      <html><body><div id="page-main">
        <p>Applicant v Minister [2026] FCA 42<br/>
        Coram: Brown J<br/>
        CATCHWORDS: MIGRATION - protection visa - Subclass 866<br/>
        Date of judgment: 3 February 2026<br/>
        The Court orders that the application be dismissed.<br/>
        This body is intentionally longer than fifty characters so extraction succeeds.<br/>
        Migration Act 1958 (Cth) s 476.</p>
      </div></body></html>
    `, { status: 200 })));
```

Also change the job's `citation` (line 47) from `"[2026] FCA 42"` to
`"PLACEHOLDER-CITATION"`. `index.ts:366` is
`citation: metadata.citation_extracted || job.citation`, so asserting the stored
citation is `"[2026] FCA 42"` now **proves the parser ran** instead of silently
passing through the job field.

**8b.** After the existing `expect(puts.has(...))` assertions (currently lines
58-59) and before the `extractMessages` assertion, add:

```typescript
    // Round-trip: the JSON we just wrote to R2 must carry parsed fields, not
    // nulls. Values verified against parser.ts at commit 42826a3.
    const stored = JSON.parse(puts.get(jsonKey) as string);
    expect(stored).toMatchObject({
      case_id: "abcdef123456",
      url: job.url,
      citation: "[2026] FCA 42",          // extracted, not job.citation
      court_code: "FCA",
      title: "Applicant v Minister [2026] FCA 42",
      success: true,
      judges: "Brown J",
      date: "3 February 2026",
      catchwords: "MIGRATION - protection visa - Subclass 866",
      outcome: "The Court orders that the application be dismissed.",
      visa_type: "protection visa",
      legislation: "Migration Act 1958 (Cth) s 476",
    });
    expect(stored.full_text).toContain("This body is intentionally longer than fifty characters");
    expect(typeof stored.scraped_at).toBe("string");
```

Do **not** add a new `it` block — the count in Step 7's verification assumes
this stays one test.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && \
  npm test 2>&1 | tail -5 && npm run typecheck; echo "tsc=$?"
```

→ `Test Files  8 passed (8)` / `Tests  50 passed (50)`, then `tsc=0`.

### Step 9: Full regression pass

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint && make test-py 2>&1 | tail -2
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && npm run test:workers 2>&1 | tail -3
cd "/Users/d/Developer/Active Projects/IMMI-Case-/frontend" && npx vitest run 2>&1 | tail -3 && npx tsc -b --noEmit; echo "tsc=$?"
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && npm test 2>&1 | tail -3
```

**Verify**: `All checks passed!`; `1141 passed, 3 failed, 7 skipped` (the 3 are
the pre-existing `pypdf`/`pyexpat` ABI failures, unchanged); `345 passed`;
`490 passed` and `tsc=0`; `Tests  50 passed (50)`.

Then confirm nothing outside scope moved:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && git status --short
```

→ only the files listed in "Scope / In scope".

## Test plan

**New tests**

- `workers/austlii-scraper/src/__tests__/parser.test.ts` — 22 tests
  (Step 7). Coverage: all four `extractFullText` strategies and their
  precedence; the <100-char fall-through; the empty/garbage input path; HTML
  entity decoding; `extractMetadata` field extraction for the two dominant court
  families (tribunal-style `TRIBUNAL MEMBER:` + `Date of decision:`, and
  court-style `Coram:` + `Date of judgment:` + `The Court orders`); the
  all-empty result for empty and non-matching input; and four pinned known
  defects (D1 ×2, D2, D3).
- `tests/e2e/README.md` — documentation, not a test.

**Strengthened tests**

- `workers/austlii-scraper/src/__tests__/pipeline-scrape.test.ts` — the existing
  `writes pipeline scrape results under the run prefix and forwards to extract`
  test gains a `JSON.parse` of the captured R2 body and 12 field assertions plus
  a `full_text` containment check (Step 8). It previously asserted only two key
  strings, so `extractMetadata` could have returned all-nulls and the test would
  still have passed.

**Structural patterns to follow**

- Model `parser.test.ts` on
  `workers/austlii-scraper/src/__tests__/pipeline-config.test.ts` for shape
  (named imports from `"vitest"`, top-level `describe`, one behaviour per `it`).
- Model the CI job shape on the existing `test-python` job in
  `.github/workflows/ci.yml:17-46` — same `actions/checkout@v5`,
  `actions/setup-python@v5` with `python-version: "3.12"`, and the same
  `python3 -m venv .venv` + `.venv/bin/pip install` idiom.

**Verification**

- `cd workers/austlii-scraper && npm test` → `Test Files 8 passed (8)`,
  `Tests 50 passed (50)` (was 7 / 28; +1 file, +22 tests).
- `.venv/bin/pytest tests/e2e/test_smoke.py tests/e2e/react/test_react_smoke.py -q --no-cov --timeout=180`
  → `100 passed` (was: could not collect).
- `.venv/bin/pytest tests/e2e -q --no-cov --timeout=300 --ignore=tests/e2e/playwright`
  → 0 failed.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.venv/bin/pytest tests/e2e --collect-only -q --no-cov 2>&1 | tail -1`
      prints a `tests collected` line containing no `error`.
- [ ] `.venv/bin/pytest tests/e2e/test_smoke.py tests/e2e/react/test_react_smoke.py -q --no-cov --timeout=180`
      exits 0 with `100 passed`.
- [ ] `.venv/bin/pytest tests/e2e -q --no-cov --timeout=300 --ignore=tests/e2e/playwright`
      exits 0.
- [ ] `python3 -c "import yaml;d=yaml.safe_load(open('.github/workflows/ci.yml'));print(sorted(d['jobs']))"`
      → `['e2e-nightly', 'e2e-smoke', 'test-frontend', 'test-python', 'test-worker']`
- [ ] `python3 -c "import yaml;d=yaml.safe_load(open('.github/workflows/ci.yml'));print(sorted(d[True]))"`
      → `['pull_request', 'push', 'schedule', 'workflow_dispatch']`
- [ ] `grep -c 'ignore=tests/e2e/playwright' .github/workflows/ci.yml` → `1`
- [ ] `git ls-files frontend/e2e frontend/playwright.config.ts | wc -l` → `0`
- [ ] `test -f tests/e2e/README.md` exits 0
- [ ] `test -f workers/austlii-scraper/src/__tests__/parser.test.ts` exits 0
- [ ] `cd workers/austlii-scraper && npm test` → `Test Files  8 passed (8)` and
      `Tests  50 passed (50)`
- [ ] `cd workers/austlii-scraper && npm run typecheck` exits 0
- [ ] `grep -c 'JSON.parse' workers/austlii-scraper/src/__tests__/pipeline-scrape.test.ts` → `1`
- [ ] `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `cd frontend && npx vitest run` → `490 passed`
- [ ] `npm run test:workers` → `345 passed`
- [ ] `make lint` → `All checks passed!`
- [ ] `.venv/bin/ruff check tests/e2e/` reports no findings in
      `test_smoke.py` or `test_react_smoke.py`
- [ ] `make test-py 2>&1 | tail -2` → `1141 passed, 3 failed, 7 skipped`
      (unchanged; the 3 are the pre-existing `pypdf`/`pyexpat` ABI failures)
- [ ] `git status --short` shows no file outside the "In scope" list
- [ ] `git diff 42826a3..HEAD -- workers/austlii-scraper/src/parser.ts | wc -l` → `0`
- [ ] `plans/README.md` status row for 040 updated

## STOP conditions

Stop and report back (do not improvise) if:

- **Step 1 fails** — `requirements-e2e.txt` or the `install-e2e:` Makefile
  target is missing. Plan 002 has not landed; this plan has no foundation.
- **A smoke test fails because the app is broken**, not because an assertion is
  stale: a page throws a JS error, returns 500, or leaves `#root` empty. The
  fix is in `frontend/src/` or `immi_case_downloader/web/`, both out of scope.
  Report the page, the route and the error.
- **Any of `parser.test.ts` tests 1–18 fails.** Those 18 expectations were
  produced by running the real `parser.ts` at `42826a3`. A failure means the
  file drifted; the plan's expected values are stale and must be re-derived, not
  hand-adjusted.
- **Any of `parser.test.ts` tests 19–22 passes with a *different* value**, i.e.
  a defect was fixed elsewhere. Report which, so the pin becomes a real
  assertion instead of being deleted.
- **You are tempted to edit `workers/austlii-scraper/src/parser.ts`.** Plan 033
  owns that file. Defects D1/D2/D3 are recorded, not fixed here.
- **You are tempted to edit `frontend/package.json`** to remove the now-dead
  `e2e*` scripts or the `@playwright/test` devDependency. Three other plans edit
  that file. Report it instead.
- **The nightly suite needs more than 5 files on the `--ignore=` list** to go
  green. That means the Python suite has rotted past the point where this plan's
  budget is honest; report the file list and the failure reasons and stop.
- **Any E2E test tries to reach `austlii.edu.au`, `immi.trackit.today`, or an
  LLM provider.** The fixture server is local and seeded; a real network call
  means a fixture is not being used, and in the LLM case it costs Cloudflare AI
  Gateway credits.
- **`tests/e2e/playwright/` ends up inside either CI job's selection.** That
  directory hits production by default.
- **`.venv/bin/python -m playwright install --with-deps chromium` fails on the
  GitHub runner.** Do not switch to a container image or a third-party action to
  work around it; report the error.
- **`make test-py` changes from `1141 passed, 3 failed, 7 skipped`.** Installing
  `pytest-playwright` registers new fixtures and CLI options; if that perturbs
  the unit suite, that is a packaging problem worth reporting rather than
  absorbing.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **Three real parser defects are pinned, not fixed.** All three live in
  `workers/austlii-scraper/src/parser.ts`, which
  `plans/033-single-source-the-domain-vocabulary.md` owns. Whoever fixes them
  must update `parser.test.ts` tests 19–22 in the same commit:
  - **D1 — content loss (highest severity).** `parser.ts:211`:
    `.replace(/<(?:p|div|h[1-6]|li|tr|blockquote|pre|section|article)[\s>][^>]*>/gi, "\n")`.
    `[\s>]` already eats the tag's own `>`, so `[^>]*` runs to the next `>`
    anywhere in the document. Every AustLII page loses the text of any block
    element that is immediately followed by another tag — including the `<h1>`
    citation and any paragraph containing an inline `<a>`. Likely fix: make the
    attribute part optional and non-greedy —
    `/<(?:p|div|h[1-6]|li|tr|blockquote|pre|section|article)(?:\s[^>]*)?>/gi`.
    Re-run a real saved AustLII page before and after; the "after" text should
    be strictly longer.
  - **D2 — `outcome` false positive.** `parser.ts:303` uses `/i`, so the
    alternative `DECISION` matches the lowercase word `decision` inside a
    catchwords line. Anchor the pattern to a line start (`/^\s*(?:DECISION|…)/im`)
    or require the uppercase form.
  - **D3 — `legislation` truncation.** `parser.ts:325-326` use `[^.]*`, which
    stops at the `.` inside regulation numbers like `reg 2.03`, and in the other
    direction swallow trailing prose to the end of the sentence.
  - The Python twin, `immi_case_downloader/sources/austlii.py:_extract_metadata()`,
    is the stated source of these regexes (`parser.ts:7-8`) — check whether it
    shares D2/D3 before fixing only one side.
- **`frontend/package.json` still has dead E2E wiring** after Step 5: the
  `"e2e"`, `"e2e:ui"` and `"e2e:headed"` scripts and the `@playwright/test`
  devDependency (`^1.58.2`). Removing them is a 4-line change for whichever plan
  next edits that file (001, 024 or 035 all do). Until then `npm run e2e` fails
  with "no config found", which is loud and therefore acceptable.
- **Plan 001's `frontend/tsconfig.test.json`** lists `"playwright.config.ts"` in
  its `include`. That entry is dead after Step 5. Harmless (TypeScript ignores
  non-matching `include` entries when others match) but worth tidying.
- **`CLAUDE.md` is now stale** in two places: the test-count paragraph still
  counts `frontend/e2e/`, and `make test-e2e` is described as "requires running
  server" when the pytest fixture launches its own. Fix in whichever plan owns
  `CLAUDE.md`.
- **What a reviewer should scrutinise**: (a) that the `e2e-nightly` job really is
  gated by `if: github.event_name == 'schedule' || …` — without it, every PR
  pays for the full suite; (b) that `--ignore=tests/e2e/playwright` is present in
  the nightly step, because without it CI calls production and burns LLM credits;
  (c) that the `--ignore=` escape-hatch list, if non-empty, is mirrored in
  `tests/e2e/README.md`; (d) that `parser.test.ts` tests 19–22 are clearly marked
  as pinned defects and not mistaken for desired behaviour.
- **Deliberately deferred**: adding `schedule:` to `on:` makes *all* jobs run
  nightly, and `concurrency: cancel-in-progress: true` means a scheduled run on
  `main` can cancel an in-flight push run on `main`. Both are acceptable at this
  repo's traffic; revisit if CI minutes or cancelled runs become a problem.

## Findings reconsidered

- **"the Python suite has ~29x the tests" — corrected.** The real ratio is
  260 Python `def test_` definitions versus 78 unique TypeScript tests
  (`npx playwright test --list` reports `Total: 156 tests in 9 files`, but that
  counts the `desktop` and `mobile` projects separately). ~3.3x, not 29x. The
  conclusion — keep the Python suite — is unchanged and is reinforced by three
  other facts the original finding did not have: the Python suite is
  self-hosting (`tests/e2e/conftest.py` launches Flask in-process with 10 seeded
  cases), the TypeScript suite drives two routes that no longer exist
  (`/search`, `/update-db`), and plan 002 has already invested in packaging the
  Python suite (`requirements-e2e.txt`, `make install-e2e`).
- **"tests/e2e last touched 18a5b0c, 2026-06-17" — refined.** That is the last
  commit touching `tests/e2e` as a whole. `tests/e2e/react/` — where 236 of the
  260 tests live — last changed at `6318403`, 2026-04-27.
- **"replace the skipped turn-2 visual test with a fixture-seeded variant" —
  rejected for this plan.** `tests/e2e/playwright/test_council_thread_visual.py`
  documents at lines 22-24 that it deliberately does **not** inherit the Flask
  fixture conftest, because "Council endpoints are Worker-native and only exist
  in production — there is no local fixture mode for US-012." Building the
  fixture-seeded variant therefore means building a local Council fixture that
  does not exist, which is a feature, not a test fix. The file is also owned by
  `plans/003-lint-the-test-suite.md`. The `@pytest.mark.skip` at line 320 stays;
  the whole directory is excluded from CI instead, for the stronger reason that
  it calls production and costs LLM credits.
- **"`visa_subclass`" — corrected to `visa_type`.** The `ParsedCase` interface
  (`workers/austlii-scraper/src/parser.ts:11-20`) and `ScrapeResult`
  (`index.ts:363-378`) both use `visa_type`. There is no `visa_subclass` field
  anywhere in the scraper Worker.
- **TEST-05 (LLM Council streaming is only ever mocked) — confirmed real, but
  deferred out of this plan's file territory. Not rejected.** Verified at
  `42826a3`: `workers/llm-council/runner.js` is 2043 lines and exports
  `streamGatewayChatCompletion` (line 1304), `streamAnthropicNative` (1494),
  `streamGeminiNative` (1624) and `streamCouncil` (1761);
  `grep -c stream workers/__tests__/llm-council-runner.test.js` returns `0`; both
  handler suites replace the module at the boundary
  (`workers/__tests__/cloudflare-council-handlers.test.js:22` —
  `streamCouncil: (...args) => mockStreamCouncil(...args)` — note **line 22**,
  not line 20 as originally cited; `llm-council-handlers.test.js:34` —
  `streamCouncil: vi.fn()`), so across all 345 Worker tests no `stream*` function
  ever executes. `frontend/src/components/llm-council/StreamingCouncilView.tsx`
  is 739 lines and is referenced only by itself and `LlmCouncilPage.tsx` — no
  test file mentions it. Fixing this needs new files under `workers/__tests__/`
  and `frontend/__tests__/`, both of which belong to
  `plans/038-test-the-production-sql-layer.md` and
  `plans/039-fix-the-frontend-test-harness.md`. It needs its own plan: drive
  each `stream*` async generator with a hand-built `ReadableStream` emitting a
  delta split mid-JSON, a keepalive, `data: [DONE]` and a mid-stream error frame,
  asserting the yielded sequence; and an RTL test for `StreamingCouncilView`
  with a mocked stream asserting incremental render and cleanup on unmount.
