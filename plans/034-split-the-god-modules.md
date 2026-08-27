# Plan 034: Break up api.py, CloudflareCaseStore and the duplicated council engine

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index. **`plans/README.md` does not exist at the commit this
> plan was written against; if it still does not exist when you finish, skip
> that update — do not create it.**
>
> Every path in this file is relative to the repository root
> `/Users/d/Developer/Active Projects/IMMI-Case-`. The directory name contains
> a space and a trailing hyphen, so always quote it in shell commands.
>
> **Drift check (run first)**. A `42826a3..HEAD` diff is blind to uncommitted,
> staged and untracked work, so run **all four** commands below; a dirty tree
> would otherwise hand you a false all-clear. Any in-scope path appearing in any
> of them is a STOP condition, and you must **never** run an unconditional
> `git checkout -- …`, `git restore …` or `git clean -f` to clear it — those
> changes may be the operator's.
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> PATHS='immi_case_downloader/web/routes/api.py
> immi_case_downloader/web/routes/api_taxonomy.py
> immi_case_downloader/web/routes/api_cases.py
> immi_case_downloader/llm_council.py
> immi_case_downloader/data/council_prompts.json
> workers/llm-council/runner.js
> workers/llm-council/prompts.js
> workers/storage/cloudflare.js
> tests/test_analytics_api.py
> tests/test_taxonomy_countries_and_judges_api.py
> tests/test_api_helpers.py'
> git status --short --branch
> git diff --stat 42826a3..HEAD -- $PATHS
> git diff --stat               -- $PATHS   # unstaged
> git diff --cached --stat      -- $PATHS   # staged
> git status --short --untracked-files=all -- $PATHS
> ```
>
> On a mismatch, compare the "Current state" excerpts against the live code; if
> they differ, STOP.
>
> **Note for whoever sequences this batch**: this plan creates
> `immi_case_downloader/data/council_prompts.json`.
> `plans/033-single-source-the-domain-vocabulary.md` also writes into
> `immi_case_downloader/data/` (it creates `visa_registry.json`). The two files
> do not collide, and 033's drift check has been narrowed to the specific files
> it owns, so either order works — but do not run them in parallel in the same
> worktree.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `42826a3`, 2026-08-27

Why "none" for dependencies: this plan's gates are `make test-py`,
`make test-workers` and `make lint`, all of which are usable at `42826a3`
(re-verified while writing this plan: `make test-workers` → 345 passed / 25
files; `make lint` → "All checks passed!"). It never runs the frontend
TypeScript compile, so the plan that repairs that gate is not a prerequisite.
It edits three existing files under `tests/` (`tests/test_analytics_api.py`,
`tests/test_taxonomy_countries_and_judges_api.py`, `tests/test_api_helpers.py`);
none of those three has any ruff finding at `42826a3` — I ran
`.venv/bin/ruff check . --output-format=concise` and listed the 43 findings by
file — so this plan does not collide with the test-suite lint cleanup.

## Why this matters

Three modules in this repo have grown past the point where anyone can review
them safely, and one of them has already produced a live behavioural defect.

`workers/llm-council/runner.js` and `immi_case_downloader/llm_council.py`
each carry their own copy of the four council system prompts. The Worker test
suite still describes them as "exported verbatim from Python source"
(`workers/__tests__/llm-council-runner.test.js:792`), but two of the four have
drifted apart, and the drift is not cosmetic: the Worker's Gemini prompt tells
the model "you have google_search grounding enabled" while **no live Gemini
path attaches that tool** — the native path was abandoned on 2026-05-11 and
the surviving compat path cannot expose it (`workers/llm-council/runner.js:1825-1826`).
Telling a model it has a search tool it does not have is how you get confident,
unverifiable citations, and the reader of those citations is a self-representing
immigration applicant. This plan makes one JSON file the single source of truth
for all four prompts, keeps the grounded variant only on the one path that
actually attaches `web_search`, and adds a test that fails if the two runtimes
ever diverge again.

`workers/storage/cloudflare.js` is 1,905 lines holding six unrelated stores,
including `CloudflareIdentityStore.assertMembership()` — the app-layer
tenant-isolation boundary with no database-level backstop behind it. The module
that most needs careful security review is the one hardest to review. Splitting
it by store is a pure file move with no signature changes.

`immi_case_downloader/web/routes/api.py` is 2,657 lines with 64 module-level
helpers and 22 routes, and a half-finished extraction ("cq-001") left a genuine
import cycle behind it: `api_taxonomy.py` imports `api.py` at module scope and
`api.py` imports `api_taxonomy.py` back from inside a function body to dodge it.
A cycle broken by a deferred import fails at app startup, not in a test, the
next time someone moves a constant. This plan finishes enough of cq-001 to
delete the cycle and lifts the self-contained judge-name domain out, taking
api.py under ~2,250 lines. It does **not** claim to finish the split — the
remaining work is named in "Maintenance notes".

## Current state

### Files this plan touches, and their role

- `immi_case_downloader/llm_council.py` — 1,514 lines. Local-dev-only Python
  council engine. Defines the four `DEFAULT_*_SYSTEM_PROMPT` literals at
  lines 52–110 and consumes them in `CouncilConfig.from_env()` at lines 213–228.
- `workers/llm-council/runner.js` — 2,043 lines. Production council engine
  inside the Cloudflare Worker. Defines its own copy of the same four
  constants at lines 109–170.
- `workers/storage/cloudflare.js` — 1,905 lines. Six store classes plus the
  `createCloudflareStores` factory.
- `immi_case_downloader/web/routes/api.py` — 2,657 lines, 64 module-level
  helpers, 22 routes.
- `immi_case_downloader/web/routes/api_taxonomy.py` — 727 lines. Imports
  constants and helpers from `api.py`.
- `immi_case_downloader/web/routes/api_cases.py` — 1,366 lines. Imports 22
  constants and two helpers from `api.py`.
- `tests/test_analytics_api.py`, `tests/test_taxonomy_countries_and_judges_api.py`
  — patch judge-loader functions by their `...routes.api.*` dotted path; those
  patch targets must move with the code in Step 9.

### The council prompt drift (verified by reconstructing all four strings)

At `42826a3` the four concatenated strings compare like this — I built each
one from both files and diffed them byte-for-byte:

| Constant | Python chars | JS chars | Identical? |
|---|---|---|---|
| `DEFAULT_OPENAI_SYSTEM_PROMPT` | 793 | 793 | yes |
| `DEFAULT_MODERATOR_SYSTEM_PROMPT` | 1146 | 1146 | yes |
| `DEFAULT_GEMINI_PRO_SYSTEM_PROMPT` | 868 | 1139 | **no** |
| `DEFAULT_ANTHROPIC_SYSTEM_PROMPT` | 851 | 1168 | **no** |

`workers/llm-council/runner.js:123-127` (verbatim):

```js
export const DEFAULT_GEMINI_PRO_SYSTEM_PROMPT =
  "Role: Senior legal research counsel specialized in grounded-source verification for Australian immigration matters. " +
  "Search tool: you have google_search grounding enabled. Actively use it to verify recent statutory amendments, " +
  "AAT/ART decisions, Federal Court judgments, DFAT country reports, UNHCR guidance, and case-law citations. " +
  "Always prefer 2024-2026 primary sources. Cite via groundingMetadata where possible. " +
```

`immi_case_downloader/llm_council.py:67-70` (verbatim) — same constant, no
search-tool paragraph:

```python
DEFAULT_GEMINI_PRO_SYSTEM_PROMPT = (
    "Role: Senior legal research counsel specialized in grounded-source verification for Australian immigration matters. "
    "Primary duty: use grounded search evidence and clearly cite source links when available. "
    "Source hierarchy: legislation and delegated legislation first, then tribunal/court decisions, then official policy guidance. "
```

`workers/llm-council/runner.js:139-142` (verbatim):

```js
export const DEFAULT_ANTHROPIC_SYSTEM_PROMPT =
  "Role: Senior adversarial legal analyst for Australian immigration research. " +
  "Search tool: you have web_search enabled (max 5 uses per turn). Use it strategically to verify the most " +
  "current Australian Migration Act amendments, AAT/ART/Federal Court decisions on jurisdictional error, " +
```

`immi_case_downloader/llm_council.py:82-84` (verbatim) — same constant, no
search-tool paragraph:

```python
DEFAULT_ANTHROPIC_SYSTEM_PROMPT = (
    "Role: Senior adversarial legal analyst for Australian immigration research. "
    "Primary duty: stress-test the case theory by identifying strongest and weakest arguments on both sides. "
```

### Which council paths actually attach a search tool

Only one does. `streamAnthropicNative` sends a tool block —
`workers/llm-council/runner.js:1515-1521` (verbatim):

```js
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5,
      },
    ],
```

Gemini attaches nothing on any live path. `streamGeminiNative` (defined at
`workers/llm-council/runner.js:1624`) has `tools: [{ google_search: {} }]` at
line 1647 but **is never called** — `grep -rn "streamGeminiNative"` over the
repo returns only its own definition and the comment below. That comment is
`workers/llm-council/runner.js:1817-1828` (verbatim):

```js
    if (providerKey === "gemini_pro") {
      // Switched 2026-05-11 from streamGeminiNative → compat path.
      // The native passthrough was silently dropping all candidate text in
      // production (direct AI Gateway probe yielded 75 text events; Worker
      // got 0) despite identical request bodies. Root cause unknown but
      // likely a parser edge case with the native SSE delivery shape under
      // streaming load. Compat path (used by gpt-5 path successfully) is
      // proven reliable and supports gemini-2.5-pro via the openai-compatible
      // gateway endpoint. Trade-off: lose `google_search` grounding tool
      // (compat doesn't expose it). Anthropic still has web_search grounding,
      // so the council retains 1 live-search expert.
      return streamGatewayChatCompletion({
```

The non-streaming orchestrator `runCouncil` calls `runExpert` for all three
experts (`workers/llm-council/runner.js:1121`, `1133`, `1145`), and `runExpert`
goes through `gatewayChatCompletion` (`workers/llm-council/runner.js:403`) —
the OpenAI-compat endpoint, which sends no `tools` at all. The Python engine
sends no tools either; `immi_case_downloader/llm_council.py:721` (verbatim):

```python
    del with_grounding  # Unified API does not surface Google grounding tools.
```

So after this plan: the tool-free text becomes the default everywhere, and the
grounded text survives only on `streamAnthropicNative`, the single path that
actually attaches `web_search`.

### The intent that this plan restores

`workers/__tests__/llm-council-runner.test.js:791-793` (verbatim):

```js
// ---------------------------------------------------------------------------
// System prompt constants — exported verbatim from Python source
// ---------------------------------------------------------------------------
```

The four assertions under that heading check only substrings
(`"Senior legal research counsel"`, `"grounded-source verification"`,
`"adversarial legal analyst"`, `"Presiding legal moderator"`). All four
substrings are present in the Python variants, so those tests keep passing
after the switch.

### The api.py ↔ api_taxonomy.py import cycle

`immi_case_downloader/web/routes/api_taxonomy.py:22-25` (verbatim):

```python
# ── Import api module by reference so unit-test patches on api.* propagate here ──
from . import api as _api
# Constants are immutable — direct import is safe (no patch needed for these).
from .api import DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, SUPABASE_RPC_TIMEOUT_SECONDS
```

`immi_case_downloader/web/routes/api.py:2643-2645` (verbatim) — the other half
of the cycle, deferred into a function body:

```python
    # Lineage cache lives in api_taxonomy.py; use lazy import to avoid circular dependency.
    from .api_taxonomy import _reset_lineage_cache
    _reset_lineage_cache()
```

`immi_case_downloader/web/routes/api_cases.py:44-45` (verbatim, opening of a
22-name import list that runs to line 66):

```python
from . import api as _api
from .api import (
```

### The constants block in api.py, and who actually uses it

`immi_case_downloader/web/routes/api.py:38-63` (verbatim):

```python
# ── API configuration constants ───────────────────────────────────────
MAX_BATCH_SIZE = 200
MAX_TAG_LENGTH = 50
MAX_COMPARE_CASES = 5
DEFAULT_PAGE_SIZE = 100
MAX_PAGE_SIZE = 200
DEFAULT_SEARCH_LIMIT = 50
MAX_SEARCH_LIMIT = 200
DEFAULT_SEARCH_MODE = "lexical"
ALLOWED_SEARCH_MODES = frozenset({"lexical", "semantic", "hybrid"})
ALLOWED_SEARCH_PROVIDERS = frozenset({"openai", "gemini"})
DEFAULT_SEMANTIC_CANDIDATE_LIMIT = 150
MAX_SEMANTIC_CANDIDATE_LIMIT = 500
DEFAULT_RELATED_LIMIT = 5
MAX_RELATED_LIMIT = 20
ALLOWED_SORT_FIELDS = frozenset({
    "date", "year", "title", "court", "citation", "outcome",
    "visa_subclass_number", "applicant_name", "hearing_date", "case_id",
})
ALLOWED_SORT_DIRS = frozenset({"asc", "desc"})
ALLOWED_COUNT_MODES = frozenset({"exact", "planned", "estimated"})
# RPC timeout — generous enough for cold-start (Supabase free-tier wakes from sleep in ~4-6s).
SUPABASE_RPC_TIMEOUT_SECONDS = 8.0
# Analytics RPC timeout — analytics/outcomes calls 3 sequential RPCs (each ≤8s server timeout),
# so client-side must allow 3×8s = 24s.  Other analytics RPCs return ≤3000 rows; also bounded here.
ANALYTICS_RPC_TIMEOUT_SECONDS = 25.0
```

I counted each of these names in `api.py` itself. Seventeen of them occur
exactly once — the definition — meaning **api.py does not use them at all**;
they exist there only for `api_cases.py` and `api_taxonomy.py` to import.
The four that api.py genuinely uses are:

- `SUPABASE_RPC_TIMEOUT_SECONDS` — used once, at `api.py:1284`
- `ANALYTICS_RPC_TIMEOUT_SECONDS` — used at `api.py:1689, 1759, 1826, 1870`
- `TRIBUNAL_CODES` / `COURT_CODES` (defined at `api.py:140-141`) — used at
  `api.py:393, 404, 416, 421` (inside the judge domain that Step 9 moves out)
  and at `api.py:759, 760, 777, 779` (inside `_determine_court_type` and
  `_is_win`, which stay).

No test imports any of these constants; `grep -rn` for them across `tests/`
(excluding `tests/e2e`) returns nothing.

### The judge-name domain inside api.py

These module-level definitions form a closed unit — I checked every free name
in each of their bodies. Their only dependencies outside the group are
`logger`, `re`/`os`/`json`/`Path`/`lru_cache`, `get_output_dir` (from
`..helpers`), `ImmigrationCase` (a type annotation on
`_collect_cases_for_judge`), and `TRIBUNAL_CODES`/`COURT_CODES`:

| Lines | Symbol |
|---|---|
| 145–156 | `_JUDGE_BLOCKLIST` |
| 159–168 | `_JUDGE_TITLE_RE` |
| 171–174 | `_JUDGE_SUFFIX_RE` |
| 177–188 | `_NAME_DISQUALIFIERS` |
| 207–234 | `_is_real_judge_name` |
| 237–265 | `_normalise_judge_name` |
| 269–290 | `_load_judge_bios` (`@lru_cache(maxsize=1)`) |
| 294–332 | `_load_judge_name_overrides` (`@lru_cache(maxsize=1)`) |
| 335–357 | `_judge_query_aliases` |
| 360–361 | `_normalise_court_code` |
| 364–369 | `_normalise_year_value` |
| 372–427 | `_resolve_contextual_judge_name` |
| 430–472 | `_resolve_judge_display_name` |
| 475–481 | `_known_singleton_judge_names` |
| 485–496 | `_judge_identity` (`@lru_cache(maxsize=32768)`) |
| 499–528 | `_collect_cases_for_judge` |
| 711–753 | `_split_judges` |

`_normalise_court_code` and `_normalise_year_value` are called from nowhere
else in the package — only from `_resolve_contextual_judge_name:379` and
`_resolve_judge_display_name:438`.

`_judge_profile_payload` (`api.py:790-1025`, 236 lines — the only function in
the file meaningfully over the repo's <50-line guidance) is **not** in this
group and stays put: it depends on `_determine_court_type`, `_is_win`,
`_normalise_outcome`, `_round_rate` and `_split_concepts`, which are analytics
helpers, not judge-name helpers. Moving it would create a new cycle.

### Repo conventions this plan must match

- **Commit style** — `<type>: <description>`, type ∈
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines. Real
  example from `git log`: `fix: install root node_modules in make install`.
- **Python** — always use the repo venv at
  `/Users/d/Developer/Active Projects/IMMI-Case-/.venv`. Never global `pip`.
- **Python file size** — the project's own guidance is 200–400 lines typical,
  800 max, and functions under 50 lines.
- **`ImmigrationCase.from_dict()`** — cases are always constructed through it
  because pandas turns empty CSV fields into `float('nan')`. This plan moves
  no case-construction code, so it just must not introduce any.
- **Tenant isolation is app-layer** —
  `CloudflareIdentityStore.assertMembership()` in
  `workers/storage/cloudflare.js` is the whole boundary; there is no Postgres
  and no RLS behind it. When you move that class in Step 6, its body must come
  across byte-for-byte.
- **Worker D1 bindings** — `env.IMMI_CATALOG_DB`, `env.IMMI_ACCOUNT_DB`,
  `env.IMMI_OPS_DB` are D1 bindings, not Postgres connections. A live test
  (`workers/__tests__/cloudflare-storage-contracts.test.js:95-100`) asserts
  those binding names appear in **no** Worker source file outside
  `workers/storage/`; every new file in Steps 4–7 lives inside that directory,
  so the assertion keeps holding.
- **Do NOT "fix" these, they are deliberate**: the placeholder resource IDs in
  the checked-in `wrangler.toml`; `IMMI_CASE_MUTATIONS_ENABLED` and the
  pipeline flags defaulting to `"false"`;
  `workers/austlii-scraper/scripts/rollback_run.ts` still targeting legacy
  Supabase; the "Performance Baseline (2026-05-05)" section of `CLAUDE.md`
  being historical.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Python tests | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py` | see the **delta rule** below |
| Worker tests | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-workers` | see the **delta rule** below |
| Python lint | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint` | `All checks passed!`, exit 0 |
| Single Python test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/<file>.py -q` | all pass — per-file counts are stable across sibling plans, so prefer them |
| Single Worker test file | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && npx vitest run --config workers/vitest.config.js __tests__/<file>.test.js` | all pass |
| Import-cycle probe | `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -c "import immi_case_downloader.web.routes.api_taxonomy"` | exit 0, no output |
| Line count | `wc -l < <path>` | as stated per step |

**Delta rule (Step 0 — do this before anything else).** Sibling plans in this
batch add and remove tests in these same suites, so absolute totals such as
"350 passed" are not usable gates: they break the moment another plan merges,
and an executor who edits the expected number has destroyed the gate. Record:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-workers 2>&1 | tail -4                            # → WORKER_FILES_BEFORE / WORKER_TESTS_BEFORE
make test-py 2>&1 | grep -E "^(FAILED|ERROR)" | sort -u      # → PY_FAIL_NAMES
make test-py 2>&1 | tail -3                                  # → PY_PASS_BEFORE / PY_SKIP_BEFORE
cp workers/storage/cloudflare.js /tmp/immi-cloudflare-storage-baseline.js
```

Every expectation below is a delta from those. This plan adds **7** Worker tests
(Step 3) and **4 + 2** Python tests (Steps 3 and 9), and moves code without
changing behaviour otherwise; so the required movement is
`WORKER_TESTS_BEFORE + 7` across `WORKER_FILES_BEFORE + 1` files, and
`PY_PASS_BEFORE + 6` with `PY_SKIP_BEFORE` unchanged. Count the tests you
actually write and state both the baseline and the final numbers in your report.
At `42826a3` the baseline happened to be 25/345 and 1141/7 — informational only.
Prefer the **per-file** counts as your real gate, since they do not move when a
sibling plan lands: `council-prompt-parity.test.js` → `7 passed`,
`tests/test_council_prompt_source.py` → `4 passed`,
`tests/test_cache_registry.py` → `2 passed`.

**Whatever `PY_PASS_BEFORE` is, the Python failures must remain exactly the
three named `pypdf` ImportErrors in `tests/test_backfill_judge_overrides_from_pdf.py`**
(Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch — environmental, not
repo code). On an interpreter with a working `pypdf` there are none; that is
also fine. A failure with any *other* name means this plan cannot start.

The `cp` in Step 0 is load-bearing, not a nicety: Steps 5–7 slice
`workers/storage/cloudflare.js` by line range, and Step 4 has already deleted
lines from it by then. **Every line range in Steps 5 and 6 refers to
`/tmp/immi-cloudflare-storage-baseline.js`, the pristine snapshot — never to the
live file.** See Step 4 for why.

## Scope

**In scope** (the only files you may modify or create):

Council prompts (Steps 1–3):
- `immi_case_downloader/data/council_prompts.json` — create
- `scripts/generate_council_prompts.py` — create (the checked-in generator with
  a `--check` staleness mode; the plan text's heredoc is its body, not a
  substitute for it)
- `immi_case_downloader/llm_council.py` — replace the four literal blocks with
  a loader, and export `COUNCIL_PROMPTS_VERSION`
- `workers/llm-council/prompts.js` — create (**generated**; never hand-edited)
- `workers/llm-council/runner.js` — re-export from `prompts.js`; use the
  grounded variant on the one native-tool path; add `prompts_version` to the
  existing structured log line
- `workers/__tests__/council-prompt-parity.test.js` — create
- `tests/test_council_prompt_source.py` — create

Worker storage split (Steps 4–7):
- `workers/storage/cloudflare_shared.js` — create
- `workers/storage/object.js`, `case.js`, `identity.js`, `council.js`,
  `pipeline.js`, `semantic.js` — create
- `workers/storage/cloudflare.js` — reduce to a barrel + the three factories

Flask route module (Steps 8–10):
- `immi_case_downloader/web/routes/api_constants.py` — create
- `immi_case_downloader/web/cache_registry.py` — create
- `immi_case_downloader/web/judge_names.py` — create
- `immi_case_downloader/web/routes/api.py` — remove moved code, add imports
- `immi_case_downloader/web/routes/api_taxonomy.py` — import from the new
  modules; register its invalidator
- `immi_case_downloader/web/routes/api_cases.py` — import constants from
  `api_constants.py`
- `tests/test_cache_registry.py` — create
- `tests/test_analytics_api.py` — patch-target strings only (5 occurrences)
- `tests/test_taxonomy_countries_and_judges_api.py` — patch-target strings only
  (7 occurrences)
- `tests/test_api_helpers.py` — import path for three judge-name helpers only
  (Step 10)
- `plans/034-split-the-god-modules.md` — this file, status line only

**Out of scope** (do NOT touch, even though they look related):

- `immi_case_downloader/web/routes/api.py`'s `_judge_profile_payload`
  (lines 790–1025), `stats` (1370–1492) and `analytics_success_rate`
  (1915–2050). They are the three oversized functions in the file, but
  splitting an analytics aggregation is a behaviour-bearing refactor with no
  characterisation tests behind it. Deferred deliberately; see
  "Maintenance notes".
- `workers/llm-council/handlers.js` — the retired pre-cutover module. It
  imports the four prompt constants from `runner.js` (lines 37–40) and keeps
  working through the re-export. Do not edit it.
- `workers/llm-council/retrieval.js`, `session_do.js`,
  `cloudflare_handlers.js`, `auth.js` — untouched.
- `streamGeminiNative` (`workers/llm-council/runner.js:1624-1759`) — dead but
  out of scope. Deleting dead code is a separate change; see "Maintenance
  notes".
- `workers/storage/contracts.js` — the shared contract module. Every new
  storage file imports from it; none of them modifies it.
- Any change to a public function signature, route path, JSON response shape,
  or SQL string. Every move in this plan is byte-for-byte.
- `frontend/**` — no frontend file references any symbol this plan moves
  (verified by grep for the four prompt constants across `frontend/src`:
  only `frontend/src/lib/api.ts:1263` declares a `system_prompt_preview`
  *type*, which is unaffected).
- `wrangler.toml`, `Makefile`, `.github/workflows/**`, `CLAUDE.md`.
- Anything under `.omc/` or `.claude/`.

## Git workflow

- Branch: `advisor/034-split-the-god-modules` (create it before Step 1; do not
  work on `main`).
- Commit after each numbered step, or after each coherent pair of steps.
  Message style is conventional commits, e.g.
  `refactor: make council_prompts.json the single prompt source`,
  `refactor: split cloudflare storage into per-store modules`,
  `test: cover the web cache invalidator registry`.
- Do NOT push, do NOT open a PR, do NOT merge. The operator commits and
  decides what happens next.

## Steps

### Step 1: Make one JSON file the canonical source of the four council prompts

Create `immi_case_downloader/data/council_prompts.json`. **Do not transcribe
the prompt text by hand** — transcription errors are exactly the failure mode
this step exists to eliminate. Generate the file with this script, which reads
both current sources and writes them out:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python - <<'PY'
import json, pathlib, re, sys
sys.path.insert(0, ".")
from immi_case_downloader.llm_council import (
    DEFAULT_OPENAI_SYSTEM_PROMPT,
    DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
    DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
    DEFAULT_MODERATOR_SYSTEM_PROMPT,
)
js = pathlib.Path("workers/llm-council/runner.js").read_text()
m = re.search(r'export const DEFAULT_ANTHROPIC_SYSTEM_PROMPT =\n(.*?);\n', js, re.S)
parts = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))
grounded_anthropic = "".join(p.encode().decode("unicode_escape") for p in parts)
assert len(grounded_anthropic) == 1168, len(grounded_anthropic)
payload = {
    "_comment": (
        "Canonical LLM Council system prompts. Single source of truth for BOTH "
        "runtimes: immi_case_downloader/llm_council.py loads this file directly; "
        "workers/llm-council/prompts.js mirrors it as JS literals and "
        "workers/__tests__/council-prompt-parity.test.js fails if the two drift. "
        "'base' is the tool-free text used on every path that attaches no "
        "provider search tool. 'grounded' variants are used ONLY on a path that "
        "actually attaches the named tool."
    ),
    "base": {
        "openai": DEFAULT_OPENAI_SYSTEM_PROMPT,
        "gemini_pro": DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
        "anthropic": DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
        "moderator": DEFAULT_MODERATOR_SYSTEM_PROMPT,
    },
    "grounded": {
        "anthropic": grounded_anthropic,
    },
}
out = pathlib.Path("immi_case_downloader/data/council_prompts.json")
out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print("wrote", out, {k: len(v) for k, v in payload["base"].items()})
PY
```

Then replace `immi_case_downloader/llm_council.py:52-110` — the four
`DEFAULT_*_SYSTEM_PROMPT = ( ... )` literal blocks — with a loader. Add
`from pathlib import Path` to the import block at the top of the file (`json`
is already imported at line 25). The replacement:

```python
_COUNCIL_PROMPTS_PATH = Path(__file__).resolve().parent / "data" / "council_prompts.json"


def _load_council_prompts() -> dict[str, dict[str, str]]:
    """Load the canonical council system prompts.

    This JSON file is the single source of truth shared with the Cloudflare
    Worker engine (workers/llm-council/prompts.js mirrors it, and
    workers/__tests__/council-prompt-parity.test.js fails on drift). A missing
    or malformed file is a broken install, so fail loudly rather than running
    the council with empty prompts.
    """
    try:
        payload = json.loads(_COUNCIL_PROMPTS_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Cannot load council prompts from {_COUNCIL_PROMPTS_PATH}") from exc
    base = payload.get("base")
    required = ("openai", "gemini_pro", "anthropic", "moderator")
    if not isinstance(base, dict) or not all(
        isinstance(base.get(key), str) and base.get(key) for key in required
    ):
        raise RuntimeError(f"council prompts at {_COUNCIL_PROMPTS_PATH} are missing a 'base' entry")
    return payload


_COUNCIL_PROMPTS = _load_council_prompts()

DEFAULT_OPENAI_SYSTEM_PROMPT = _COUNCIL_PROMPTS["base"]["openai"]
DEFAULT_GEMINI_PRO_SYSTEM_PROMPT = _COUNCIL_PROMPTS["base"]["gemini_pro"]
DEFAULT_ANTHROPIC_SYSTEM_PROMPT = _COUNCIL_PROMPTS["base"]["anthropic"]
DEFAULT_MODERATOR_SYSTEM_PROMPT = _COUNCIL_PROMPTS["base"]["moderator"]
```

Nothing else in `llm_council.py` changes: the four names keep their identity
and their values, so `CouncilConfig.from_env()` (lines 213–228) is untouched.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -c "
from immi_case_downloader.llm_council import (DEFAULT_OPENAI_SYSTEM_PROMPT as o,
  DEFAULT_GEMINI_PRO_SYSTEM_PROMPT as g, DEFAULT_ANTHROPIC_SYSTEM_PROMPT as a,
  DEFAULT_MODERATOR_SYSTEM_PROMPT as m)
print(len(o), len(g), len(a), len(m))"
```
→ exactly `793 868 851 1146`

and `cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint` → `All checks passed!`

### Step 2: Mirror the canonical prompts into the Worker and keep the grounded text on the one path with a tool

Generate `workers/llm-council/prompts.js` from the JSON — again, do not
transcribe:

**This must be a checked-in generator, not a one-shot heredoc.** A heredoc that
exists only in a plan document is unreproducible: the next person to edit a
prompt has no way to regenerate `prompts.js`, and nothing detects a hand-edit
that drifts from the JSON. Write the script below to
**`scripts/generate_council_prompts.py`** and commit it, with a `--check` mode,
exactly mirroring the generator convention `plans/033-single-source-the-domain-vocabulary.md`
establishes for `scripts/generate_visa_registry.py`:

- no arguments → regenerate `workers/llm-council/prompts.js`, print
  `Wrote .../workers/llm-council/prompts.js`
- `--check` → regenerate into memory, compare byte-for-byte with the file on
  disk, print `OK: generated council prompts are up to date` and exit 0 on a
  match, or print a unified diff and exit 1 on a mismatch

The body it writes is:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python - <<'PY'
import hashlib, json, pathlib
raw = pathlib.Path("immi_case_downloader/data/council_prompts.json").read_bytes()
p = json.loads(raw.decode("utf-8"))
version = hashlib.sha256(raw).hexdigest()[:12]
def lit(s): return json.dumps(s, ensure_ascii=False)
body = f"""/**
 * Council system prompts for the Cloudflare Worker engine.
 *
 * GENERATED MIRROR — the canonical text lives in
 * immi_case_downloader/data/council_prompts.json, which the Python engine
 * loads directly. workers/__tests__/council-prompt-parity.test.js fails if
 * this file and that JSON ever diverge, so edit the JSON and regenerate,
 * never edit the strings here.
 *
 * DEFAULT_* are the tool-free variants used on every path that attaches no
 * provider search tool (the OpenAI-compat gateway path, which is all three
 * experts in runCouncil and the OpenAI + Gemini experts in streamCouncil).
 * ANTHROPIC_GROUNDED_SYSTEM_PROMPT is used only by streamAnthropicNative,
 * the one path that actually sends a web_search tool block.
 */

export const DEFAULT_OPENAI_SYSTEM_PROMPT = {lit(p["base"]["openai"])};

export const DEFAULT_GEMINI_PRO_SYSTEM_PROMPT = {lit(p["base"]["gemini_pro"])};

export const DEFAULT_ANTHROPIC_SYSTEM_PROMPT = {lit(p["base"]["anthropic"])};

export const DEFAULT_MODERATOR_SYSTEM_PROMPT = {lit(p["base"]["moderator"])};

export const ANTHROPIC_GROUNDED_SYSTEM_PROMPT = {lit(p["grounded"]["anthropic"])};

/** sha256(council_prompts.json)[:12] — identifies the exact prompt set in logs. */
export const COUNCIL_PROMPTS_VERSION = {lit(version)};
"""
pathlib.Path("workers/llm-council/prompts.js").write_text(body, encoding="utf-8")
print("wrote workers/llm-council/prompts.js")
PY
```

`COUNCIL_PROMPTS_VERSION` exists so a council answer can be traced back to the
prompt text that produced it. Export the same value from the Python side as
`COUNCIL_PROMPTS_VERSION` in `immi_case_downloader/llm_council.py`, computed the
same way (`sha256` of the file's bytes, first 12 hex chars), and have the
parity test in Step 3 assert the two agree — otherwise the version string is
decoration.

Now edit `workers/llm-council/runner.js`:

1. Delete lines 105–170 — the comment banner
   `// System prompts (ported verbatim from llm_council.py DEFAULT_*_SYSTEM_PROMPT)`
   and all four `export const DEFAULT_*_SYSTEM_PROMPT = ...;` blocks.
2. In their place put:

```js
// ---------------------------------------------------------------------------
// System prompts — canonical text lives in
// immi_case_downloader/data/council_prompts.json (see ./prompts.js).
// Imported and re-exported here so existing importers of runner.js keep
// their import path: workers/llm-council/handlers.js:37-40 and
// workers/__tests__/llm-council-runner.test.js:21-24 both pull these four
// names from runner.js.
// ---------------------------------------------------------------------------
import {
  ANTHROPIC_GROUNDED_SYSTEM_PROMPT,
  DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
  DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
  DEFAULT_MODERATOR_SYSTEM_PROMPT,
  DEFAULT_OPENAI_SYSTEM_PROMPT,
} from "./prompts.js";

export {
  ANTHROPIC_GROUNDED_SYSTEM_PROMPT,
  DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
  DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
  DEFAULT_MODERATOR_SYSTEM_PROMPT,
  DEFAULT_OPENAI_SYSTEM_PROMPT,
};
```

Use exactly that shape — one `import` that binds the names locally (the rest of
`runner.js` uses all four) followed by one plain `export { ... }` that
re-exports them. Do not use `export { ... } from "./prompts.js"`, which
re-exports without binding locally and would leave the names undefined inside
the module.

3. In `pickStreamGenerator`, the `anthropic` branch currently reads:

```js
    if (providerKey === "anthropic") {
      return streamAnthropicNative({
        env, model, systemPrompt, userPrompt,
        externalSignal: orchestrationAbort.signal,
      });
    }
```

Change `systemPrompt` to the grounded variant and say why:

```js
    if (providerKey === "anthropic") {
      // The only live path that actually attaches a search tool (see the
      // web_search_20250305 tools block in streamAnthropicNative), so it is
      // the only path allowed to tell the model it has one.
      return streamAnthropicNative({
        env, model, systemPrompt: ANTHROPIC_GROUNDED_SYSTEM_PROMPT, userPrompt,
        externalSignal: orchestrationAbort.signal,
      });
    }
```

Leave every other call site alone. In particular `runStreamExpert("anthropic",
..., DEFAULT_ANTHROPIC_SYSTEM_PROMPT)` keeps passing the tool-free variant —
that value is what gets recorded and logged for the turn, and the grounded
substitution happens only at the wire.

**Because of that substitution, the recorded value is no longer the value that
was sent.** That is a reproducibility hole: the streaming payload records the
model but not which prompt text actually reached the provider, so a council
answer cannot be traced back to the prompt that produced it. Close the operator
half of it here, in the existing structured-log line rather than in any
persisted payload (payload shapes are out of this plan's scope — see "Out of
scope"): wherever `runner.js` already emits
`console.log(JSON.stringify({event, ...}))` for a council turn, add
`prompts_version: COUNCIL_PROMPTS_VERSION` and, on the Anthropic native branch,
`grounded: true`. Import `COUNCIL_PROMPTS_VERSION` alongside the other five
names in the import block above.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-workers
```
→ `WORKER_TESTS_BEFORE` (Step 2 adds no tests; Step 3 is what adds them)

and
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
grep -c "google_search grounding enabled" workers/llm-council/prompts.js workers/llm-council/runner.js
grep -c "prompts_version" workers/llm-council/runner.js
.venv/bin/python scripts/generate_council_prompts.py --check; echo "check exit=$?"
```
→ `workers/llm-council/prompts.js:0` and `workers/llm-council/runner.js:0`;
`prompts_version` appears at least once; `OK: generated council prompts are up
to date` with `check exit=0`.

Then prove `--check` can fail: append a space to `workers/llm-council/prompts.js`,
re-run it, confirm a diff and `check exit=1`, then regenerate.

### Step 3: Add the parity tests that make this drift impossible to land again

**Constant-equality is necessary but not sufficient.** Five tests that compare
`DEFAULT_ANTHROPIC_SYSTEM_PROMPT` to `canonical.base.anthropic` prove the two
*files* agree; they prove nothing about which string reaches a provider. The
whole defect this plan exists to fix is that a model was told it had a tool it
did not have — a **wire** property. So the file below has five constant tests
*plus* two request-body tests, and it is the request-body tests that actually
guard the fix.

Create `workers/__tests__/council-prompt-parity.test.js` with **seven**
tests. Model it on `workers/__tests__/cloudflare-storage-contracts.test.js`,
which already reads files from disk with `node:fs` in this suite (line 1:
`import { readdirSync, readFileSync } from "node:fs";`):

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENAI_SYSTEM_PROMPT,
  DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
  DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
  DEFAULT_MODERATOR_SYSTEM_PROMPT,
  ANTHROPIC_GROUNDED_SYSTEM_PROMPT,
} from "../llm-council/prompts.js";

const canonical = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../immi_case_downloader/data/council_prompts.json", import.meta.url)),
    "utf8",
  ),
);

describe("council prompt parity with the canonical JSON", () => {
  it("openai matches byte-for-byte", () => {
    expect(DEFAULT_OPENAI_SYSTEM_PROMPT).toBe(canonical.base.openai);
  });
  it("gemini_pro matches byte-for-byte", () => {
    expect(DEFAULT_GEMINI_PRO_SYSTEM_PROMPT).toBe(canonical.base.gemini_pro);
  });
  it("anthropic matches byte-for-byte", () => {
    expect(DEFAULT_ANTHROPIC_SYSTEM_PROMPT).toBe(canonical.base.anthropic);
  });
  it("moderator matches byte-for-byte", () => {
    expect(DEFAULT_MODERATOR_SYSTEM_PROMPT).toBe(canonical.base.moderator);
  });
  it("claims a search tool only in the grounded anthropic variant", () => {
    for (const prompt of [
      DEFAULT_OPENAI_SYSTEM_PROMPT,
      DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
      DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
      DEFAULT_MODERATOR_SYSTEM_PROMPT,
    ]) {
      expect(prompt).not.toMatch(/google_search|web_search/);
    }
    expect(ANTHROPIC_GROUNDED_SYSTEM_PROMPT).toBe(canonical.grounded.anthropic);
    expect(ANTHROPIC_GROUNDED_SYSTEM_PROMPT).toContain("web_search");
  });
});
```

Then add the two **wire-level** tests, in the same file. Model their fetch stub
on `workers/__tests__/llm-council-runner.test.js`, which already does
`vi.spyOn(globalThis, "fetch")` for this module — read it and reuse its idiom
rather than inventing one. The assertions are on the JSON body actually posted:

```js
describe("the grounded variant reaches only the path that sends a tool", () => {
  it("streamAnthropicNative posts the grounded prompt AND a web_search tool block", async () => {
    // Arrange: stub fetch, drive the anthropic branch of pickStreamGenerator.
    // Assert on the captured request:
    //   body.system     === ANTHROPIC_GROUNDED_SYSTEM_PROMPT
    //   body.tools.some((t) => t.name === "web_search")
    // Both must hold together — a grounded prompt with no tool block is the
    // exact defect this plan removes, and so is a tool block with the base
    // prompt.
  });

  it("the OpenAI-compat gateway path posts the BASE prompt and no tools", async () => {
    // Drive gatewayChatCompletion / streamGatewayChatCompletion for each of
    // openai, gemini_pro and anthropic. For every captured request:
    //   the posted system message === the corresponding DEFAULT_* constant
    //   body.tools is undefined  (the compat endpoint cannot expose one)
    // The gemini_pro case is the regression that motivated this plan: before
    // it, the compat path sent a prompt claiming google_search grounding.
  });
});
```

Write the bodies against the real module — do **not** stub `pickStreamGenerator`
or the prompt constants themselves, or the tests degrade back into constant
comparison. If a branch cannot be driven without a network binding, assert on
the request object the code builds immediately before `fetch`, but never delete
the test: a plan whose entire justification is "a model was told it had a tool
it does not have" must have at least one test that reads the outgoing body.

Prove both can fail: temporarily swap `ANTHROPIC_GROUNDED_SYSTEM_PROMPT` back to
`DEFAULT_ANTHROPIC_SYSTEM_PROMPT` in `pickStreamGenerator`, confirm the first
test goes red, and restore.

Create `tests/test_council_prompt_source.py` with exactly **four** tests:

```python
"""The Python council engine must read its prompts from the canonical JSON."""
import json

from immi_case_downloader.llm_council import (
    _COUNCIL_PROMPTS_PATH,
    DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
    DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
    DEFAULT_MODERATOR_SYSTEM_PROMPT,
    DEFAULT_OPENAI_SYSTEM_PROMPT,
)


def test_constants_come_from_the_canonical_json():
    payload = json.loads(_COUNCIL_PROMPTS_PATH.read_text(encoding="utf-8"))
    assert DEFAULT_OPENAI_SYSTEM_PROMPT == payload["base"]["openai"]
    assert DEFAULT_GEMINI_PRO_SYSTEM_PROMPT == payload["base"]["gemini_pro"]
    assert DEFAULT_ANTHROPIC_SYSTEM_PROMPT == payload["base"]["anthropic"]
    assert DEFAULT_MODERATOR_SYSTEM_PROMPT == payload["base"]["moderator"]


def test_base_prompts_claim_no_search_tool():
    """The Python engine attaches no tools (see llm_council.py `del with_grounding`)."""
    for prompt in (
        DEFAULT_OPENAI_SYSTEM_PROMPT,
        DEFAULT_GEMINI_PRO_SYSTEM_PROMPT,
        DEFAULT_ANTHROPIC_SYSTEM_PROMPT,
        DEFAULT_MODERATOR_SYSTEM_PROMPT,
    ):
        assert "google_search" not in prompt
        assert "web_search" not in prompt


def test_grounded_anthropic_variant_is_available_for_the_worker():
    payload = json.loads(_COUNCIL_PROMPTS_PATH.read_text(encoding="utf-8"))
    assert "web_search" in payload["grounded"]["anthropic"]


def test_generated_worker_mirror_is_not_stale():
    """`scripts/generate_council_prompts.py --check` must pass in-tree.

    Without this, prompts.js can be hand-edited and nothing notices — the same
    failure mode this whole step exists to remove. Run the generator as a
    subprocess, exactly as tests/test_visa_registry_parity.py does for the visa
    registry generator.
    """
    import subprocess
    import sys

    result = subprocess.run(
        [sys.executable, "scripts/generate_council_prompts.py", "--check"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr
```

Also assert, in one of the tests above, that the Python and JavaScript
`COUNCIL_PROMPTS_VERSION` values agree — read the JS constant out of
`workers/llm-council/prompts.js` with a regex rather than importing it.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-workers
npx vitest run --config workers/vitest.config.js __tests__/council-prompt-parity.test.js
.venv/bin/python -m pytest tests/test_council_prompt_source.py -q
make lint
```
→ `WORKER_FILES_BEFORE + 1` / `WORKER_TESTS_BEFORE + 7`; the single-file run
reports `7 passed`; then `4 passed`; then `All checks passed!`.

(If you wrote a different number of wire-level tests, use your number
consistently and state it in your report — but never fewer than one test that
inspects an outgoing request body.)

Commit here: `refactor: make council_prompts.json the single prompt source`.

### Step 4: Extract the shared D1 helpers out of workers/storage/cloudflare.js

> **Read this before Steps 4, 5 and 6 — the line ranges are snapshot-relative.**
> Step 4 deletes 27 lines from `workers/storage/cloudflare.js` and adds one
> import; Step 5 then removes over a thousand more. Any line number measured
> against the *live* file after those edits is wrong, so an earlier draft that
> said "move `cloudflare.js:246-1294`" in Step 5 and "`1295-1875`" in Step 6
> would have sliced the wrong code.
>
> All ranges in Steps 4, 5 and 6 therefore refer to
> **`/tmp/immi-cloudflare-storage-baseline.js`**, the untouched copy you made in
> Step 0. Extract from the snapshot, delete from the live file by locating the
> same symbols (not by line number), and verify the snapshot is genuinely
> pristine first:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> diff <(git show 42826a3:workers/storage/cloudflare.js) /tmp/immi-cloudflare-storage-baseline.js \
>   && echo "snapshot matches 42826a3"
> wc -l < /tmp/immi-cloudflare-storage-baseline.js   # → 1905
> ```
>
> If the `diff` is non-empty, the file drifted since `42826a3`; re-derive every
> range by symbol boundary from your snapshot before proceeding, and say so in
> your handoff.

Create `workers/storage/cloudflare_shared.js` and move
**snapshot lines 36-62** into it verbatim — the four functions
`requireD1`, `rows`, `changeCount`, `bindAll` — adding `export` to each. Its
import block is exactly:

```js
import { D1_MAX_BOUND_PARAMETERS, StorageBoundaryError } from "./contracts.js";
```

In `cloudflare.js`, delete those four definitions and import them back:

```js
import { bindAll, changeCount, requireD1, rows } from "./cloudflare_shared.js";
```

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-workers
```
→ `WORKER_TESTS_BEFORE + 5` (the 5 added in Step 3), no failures

### Step 5: Move CloudflareObjectStore and CloudflareCaseStore into their own modules

All line ranges below are **snapshot** ranges — see the box at the top of
Step 4. Create `workers/storage/object.js` containing, verbatim and in this
order:

- snapshot `32-34` — `MAX_COUNCIL_PAYLOAD_BYTES`, `JUDGE_PHOTO_EXTS`,
  `JUDGE_PHOTO_NAME_RE`
- snapshot `178-184` — `contentKeyFor`
- snapshot `246-433` — `export class CloudflareObjectStore`

Its imports:

```js
import {
  assertAuthContext,
  assertCaseId,
  assertObjectKey,
  assertObjectPointer,
  assertSha256,
  sha256Hex,
  StorageBoundaryError,
} from "./contracts.js";
import { rows } from "./cloudflare_shared.js";
```

Create `workers/storage/case.js` containing, verbatim and in this order:

- snapshot `64-176` — `safeCaseFilters`, `LEGACY_CASE_PROJECTION`,
  `COMPAT_SORT_COLUMNS`, `compatPageNumber`, `compatCaseFilters`
- snapshot `220-244` — `normaliseRelationLabels`, `normaliseJsonObject`
- snapshot `434-1294` — `export class CloudflareCaseStore`

Its imports:

```js
import {
  assertCaseId,
  assertObjectPointer,
  clampLimit,
  D1_MAX_BOUND_PARAMETERS,
  FTS_CHUNK_MAX_BYTES,
  sha256Hex,
  StorageBoundaryError,
  toFtsMatch,
  utcNow,
} from "./contracts.js";
import { bindAll, changeCount, requireD1, rows } from "./cloudflare_shared.js";
```

Delete all of that from `cloudflare.js` (locate the symbols; do **not** use the
snapshot's line numbers against the live file) and re-export the two classes
there.

**Use the import-then-export form, never a bare `export … from`:**

```js
import { CloudflareObjectStore } from "./object.js";
import { CloudflareCaseStore } from "./case.js";

export { CloudflareObjectStore, CloudflareCaseStore };
```

`export { X } from "./y.js"` is a *re-export*: it forwards the binding to
importers **without creating a local `X`**. `createCloudflareStores` calls
`new CloudflareCaseStore(env)` and `new CloudflareObjectStore(env)` in the same
module (`cloudflare.js:1880-1885`), so the bare re-export form compiles and then
throws `ReferenceError` at runtime — and the Worker suite mocks
`../storage/cloudflare.js` in several files, so it may not even be the thing
that catches it. Import first, then export the local bindings.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-workers && wc -l < workers/storage/case.js
node --input-type=module -e '
import { createCloudflareStores } from "./workers/storage/cloudflare.js";
console.log(typeof createCloudflareStores);
'
```
→ `WORKER_TESTS_BEFORE + 5`; `case.js` is roughly 1,000 lines; the `node` probe
prints `function` and does not throw. (The probe loads the real module graph
with no mocks, which is exactly what the mocked test files cannot do.)

Note that `case.js` is still over the project's 800-line guidance. That is
expected and accepted here: `CloudflareCaseStore` is one class with 38 methods,
and carving it into read and write halves is an interface decision, not a file
move. See "Findings reconsidered".

### Step 6: Move the identity, council, pipeline and semantic stores

Create four more modules, each holding one class plus only its own private
helpers, verbatim:

All ranges are **snapshot** ranges (`/tmp/immi-cloudflare-storage-baseline.js`),
not live-file ranges — by this point the live file is over a thousand lines
shorter.

| New file | Moves from the snapshot | `./contracts.js` imports | `./cloudflare_shared.js` imports |
|---|---|---|---|
| `identity.js` | `186-218` (`assertTelegramId`, `asJwtTelegramId`, `refreshSessionError`, `refreshDraftValues`) + `1295-1522` (`CloudflareIdentityStore`) | `assertAuthContext, assertUuid, clampLimit, StorageBoundaryError, utcNow` | `changeCount, requireD1, rows` |
| `council.js` | `1523-1620` (`CloudflareCouncilStore`) | `assertAuthContext, assertObjectPointer, StorageBoundaryError, utcNow` | `changeCount, requireD1, rows` |
| `pipeline.js` | `1621-1791` (`CloudflarePipelineStore`) | `assertCaseId, assertSha256, clampLimit, StorageBoundaryError, utcNow` | `changeCount, requireD1, rows` |
| `semantic.js` | `31` (`VECTOR_FILTER_KEYS`) + `1792-1875` (`CloudflareSemanticIndex`) | `assertCaseId, clampLimit, StorageBoundaryError, VECTOR_DIMENSIONS, VECTOR_MODEL` | — |

`CloudflareIdentityStore` contains `assertMembership()`, the entire tenant
isolation boundary for this stack. Move its body byte-for-byte; do not
reformat, reorder or "tidy" a single line of it.

Delete those blocks from `cloudflare.js` (by symbol, not by line number) and, as
in Step 5, **import each class locally and then export the local binding** —
never `export { X } from "./y.js"`. All four of these classes are `new`ed inside
`createCloudflareStores` in the same module, so a bare re-export leaves the
constructor undefined at runtime.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-workers && .venv/bin/python -m pytest tests/ --ignore=tests/e2e -q 2>&1 | tail -2
node --input-type=module -e '
import * as m from "./workers/storage/cloudflare.js";
for (const n of ["CloudflareCaseStore","CloudflareIdentityStore","CloudflareCouncilStore",
                 "CloudflarePipelineStore","CloudflareSemanticIndex","CloudflareObjectStore"]) {
  if (typeof m[n] !== "function") { console.error("MISSING EXPORT", n); process.exit(1); }
}
console.log("all six classes exported");
'
```
→ `WORKER_TESTS_BEFORE + 5`; the Python numbers equal `PY_PASS_BEFORE + 3`
(the 3 added in Step 3, before Step 9 adds its own); the `node` probe prints
`all six classes exported`

### Step 7: Reduce workers/storage/cloudflare.js to a barrel

What must remain in `workers/storage/cloudflare.js`:

- the module header comment (snapshot lines 1–8), updated to say it is now the
  public entry point that re-exports the per-store modules
- **local imports of all six classes, followed by a single `export { … }` of
  those six local bindings.** Concretely:

  ```js
  import { CloudflareObjectStore } from "./object.js";
  import { CloudflareCaseStore } from "./case.js";
  import { CloudflareIdentityStore } from "./identity.js";
  import { CloudflareCouncilStore } from "./council.js";
  import { CloudflarePipelineStore } from "./pipeline.js";
  import { CloudflareSemanticIndex } from "./semantic.js";

  export {
    CloudflareObjectStore,
    CloudflareCaseStore,
    CloudflareIdentityStore,
    CloudflareCouncilStore,
    CloudflarePipelineStore,
    CloudflareSemanticIndex,
  };
  ```

  **Not** `export { CloudflareIdentityStore } from "./identity.js";` and its
  five siblings. That form re-exports the binding for importers but creates no
  local variable, and `createCloudflareStores` `new`s all six in this file — the
  result is a `ReferenceError` the first time a request builds the stores. This
  is the single most likely way to get Steps 5–7 wrong.
- `import { assertCloudflareBindings, assertCloudflareRuntimeMode } from "./contracts.js";`
  and `import { requireD1 } from "./cloudflare_shared.js";`
- the three factory functions verbatim: `createCloudflareStores`
  (snapshot 1876–1887), `createCloudflareCaseStore` (snapshot 1894–1898),
  `createCloudflareIdentityStore` (snapshot 1901–1905), with their existing doc
  comments

Do **not** change any factory signature or body. Twenty-nine files import from
this path — nine Worker source modules and twenty test files, several of which
`vi.mock("../storage/cloudflare.js", ...)` — and all of them must keep working
untouched. That is the single acceptance criterion for this whole part.

Note: `textBytes` is in the current import block at `cloudflare.js:24` but is
referenced nowhere in the file. It is a pre-existing dead import and simply
does not survive the split. That is correct — do not add it back to any new
module.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-workers
wc -l < workers/storage/cloudflare.js
grep -c "^export class" workers/storage/cloudflare.js
grep -c 'export {.*} from "' workers/storage/cloudflare.js
node --input-type=module -e '
import { createCloudflareStores } from "./workers/storage/cloudflare.js";
try { createCloudflareStores({}); } catch (err) {
  if (err instanceof ReferenceError) { console.error("BARE RE-EXPORT BUG:", err.message); process.exit(1); }
  console.log("ok — rejected with", err.constructor.name);  // a binding/StorageBoundaryError is expected
}
'
```
→ `WORKER_TESTS_BEFORE + 5`; `cloudflare.js` is under 140 lines; the first
`grep -c` prints `0`; the second `grep -c` prints `0` (**no bare
`export … from` survives — that is the Step 5/6/7 trap**); the `node` probe
prints `ok — rejected with …` and **not** `BARE RE-EXPORT BUG`.

That last probe is the point of this step: it calls the factory with an empty
env, which must fail on a *binding* assertion (`assertCloudflareRuntimeMode` /
`assertCloudflareBindings`), never on an undefined constructor. The mocked
Worker tests cannot distinguish the two.

Commit here: `refactor: split cloudflare storage into per-store modules`.

### Step 8: Move the shared route constants out of api.py and delete the import cycle

Create `immi_case_downloader/web/routes/api_constants.py` and move
`api.py:38-63` into it verbatim (comments included), plus `api.py:140-141`:

```python
TRIBUNAL_CODES = {"AATA", "ARTA", "MRTA", "RRTA"}
COURT_CODES = {"FCA", "FCCA", "FMCA", "FedCFamC2G", "HCA"}
```

Move **only** those two lines from that region. `api.py:142-144`
(`_TRIBUNAL_WIN_OUTCOMES`, `_COURT_WIN_OUTCOMES`, `_MIXED_WIN_OUTCOMES`) stay in
`api.py` — they are private to `_win_outcomes_for_court_type` and `_is_win`,
which stay. Likewise `_OUTCOME_MAP` (`api.py:120-138`) stays.

Give the new module this docstring:

```python
"""Shared configuration constants for the /api/v1 route modules.

Lives here rather than in api.py so that no route module has to import
another one — the api.py <-> api_taxonomy.py cycle that cq-001 left behind
was created by exactly that. Import from this module, never from a sibling
route module.
"""
```

Also move `CASE_LIST_COLUMNS` (`api.py:66-88`) into it — it is used only by
`api_cases.py`.

Then:

1. In `api.py`, delete the moved definitions and add
   `from .api_constants import COURT_CODES, TRIBUNAL_CODES, ANALYTICS_RPC_TIMEOUT_SECONDS, SUPABASE_RPC_TIMEOUT_SECONDS`.
   Import **only** those four — the other seventeen constants are not
   referenced anywhere in `api.py`, and an unused import is an `F401` that
   fails `make lint`.
2. In `api_taxonomy.py`, replace line 25
   (`from .api import DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, SUPABASE_RPC_TIMEOUT_SECONDS`)
   with
   `from .api_constants import DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, SUPABASE_RPC_TIMEOUT_SECONDS`
   and delete the now-wrong comment on line 24. Leave line 23
   (`from . import api as _api`) alone — `api_taxonomy.py` calls nine `_api.*`
   helpers and that is a separate, later cleanup.
3. In `api_cases.py`, change the 22-name `from .api import (...)` block at
   lines 45–66 to `from .api_constants import (...)` with the same 22 names.
   Leave line 44 (`from . import api as _api`) alone.

Now create `immi_case_downloader/web/cache_registry.py`:

```python
"""Registry of in-memory cache invalidators owned by the route modules.

POST /api/v1/cache/invalidate has to clear caches that live in several route
modules. Having api.py import its siblings to reach them created a genuine
import cycle, which api.py used to dodge with a function-body import. Each
module now registers its own invalidator at import time instead, so imports
only ever point one way.
"""
from typing import Callable

_invalidators: list[Callable[[], None]] = []


def register_cache_invalidator(fn: Callable[[], None]) -> Callable[[], None]:
    """Register `fn` to run on POST /api/v1/cache/invalidate. Idempotent."""
    if fn not in _invalidators:
        _invalidators.append(fn)
    return fn


def invalidate_registered_caches() -> None:
    """Run every registered invalidator."""
    for fn in _invalidators:
        fn()
```

In `api_taxonomy.py`, decorate `_reset_lineage_cache` (line 38) with
`@register_cache_invalidator`, import it
(`from ..cache_registry import register_cache_invalidator`), and update the
docstring from
`"""Reset the lineage cache. Called by api.py's /cache/invalidate endpoint."""`
to
`"""Reset the lineage cache. Registered with the web cache registry."""`.

In `api.py`, replace lines 2643–2645 with:

```python
    invalidate_registered_caches()
```

and add `from ..cache_registry import invalidate_registered_caches` to the
import block at the top of the file. After this edit, `api.py` must contain no
import of any sibling route module at all.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -n "from \.api_taxonomy\|from \.api_cases\|from \.api_export\|from \.api_pipeline" immi_case_downloader/web/routes/api.py; echo "grep-exit=$?"
```
→ prints nothing and `grep-exit=1`

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -c "import immi_case_downloader.web.routes.api_taxonomy" && .venv/bin/python -c "import immi_case_downloader.web.routes.api_cases" && make lint
```
→ both imports exit 0 with no output; `All checks passed!`

### Step 9: Add a test for the invalidator registry

Create `tests/test_cache_registry.py` with exactly two tests:

```python
"""POST /api/v1/cache/invalidate reaches every route module's cache."""
from immi_case_downloader.web.cache_registry import (
    invalidate_registered_caches,
    register_cache_invalidator,
)


def test_registered_invalidator_is_called():
    calls = []
    register_cache_invalidator(lambda: calls.append(1))
    invalidate_registered_caches()
    assert calls == [1]


def test_taxonomy_lineage_cache_is_registered():
    from immi_case_downloader.web.routes import api_taxonomy

    api_taxonomy._lineage_cache_payload = {"lineages": []}
    api_taxonomy._lineage_cache_ts = 12345.0
    invalidate_registered_caches()
    assert api_taxonomy._lineage_cache_payload is None
    assert api_taxonomy._lineage_cache_ts == 0.0
```

The first test intentionally leaks one throwaway invalidator into the
process-wide registry; that is harmless because the registry only ever runs
what it holds, and the appended lambda has no side effect beyond its own list.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -m pytest tests/test_cache_registry.py -q
```
→ `2 passed`

### Step 10: Lift the judge-name domain into immi_case_downloader/web/judge_names.py

Create `immi_case_downloader/web/judge_names.py` and move the seventeen
definitions listed in the "Current state" table into it **verbatim, in the same
relative order**. Header:

```python
"""Judge name resolution: normalisation, aliasing, bios and identity.

Extracted from web/routes/api.py — this is the name-resolution domain only.
Analytics aggregation over judges (e.g. _judge_profile_payload) stays in
api.py because it depends on the outcome/concept helpers there.
"""
```

Its imports are exactly:

```python
import json
import logging
import os
import re
from functools import lru_cache
from pathlib import Path

from ..models import ImmigrationCase
from .helpers import get_output_dir
from .routes.api_constants import COURT_CODES, TRIBUNAL_CODES

logger = logging.getLogger(__name__)
```

**One line must NOT move verbatim.** `_load_judge_name_overrides`
(`api.py:294-332`) resolves the packaged fallback relative to its own file
depth — `api.py:296-298` (verbatim):

```python
    package_default = (
        Path(__file__).resolve().parents[2] / "data" / "judge_name_overrides.json"
    )
```

From `web/routes/api.py`, `parents[2]` is `immi_case_downloader/`. From
`web/judge_names.py` it would be the **repository root**, and the function
would silently return `{}` instead of the packaged overrides — a quiet data
regression no existing test catches, because the loader treats a missing file
as "no overrides". Change it to `parents[1]` when you move it.

In `api.py`, delete those seventeen definitions and add **exactly** this import
— six names, no more:

```python
from ..judge_names import (
    _collect_cases_for_judge,
    _judge_identity,
    _judge_query_aliases,
    _load_judge_bios,
    _normalise_judge_name,
    _split_judges,
)
```

Those six and only those six are still referenced by code remaining in
`api.py` — I counted the references outside the seventeen moved ranges:
`_judge_identity` 7, `_split_judges` 4, `_collect_cases_for_judge` 3,
`_normalise_judge_name` 2, `_load_judge_bios` 1, `_judge_query_aliases` 1.
The other eleven names are called only from inside the moved group, so
importing any of them back would be an `F401` and `make lint` would fail.
`api_taxonomy.py` reaches four of the six through `_api.*`
(`_collect_cases_for_judge`, `_judge_identity`, `_normalise_judge_name`,
`_split_judges`), so they must stay in `api.py`'s namespace regardless.

Confirm the reference counts against the file you actually have before you
write the import list:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && for n in _collect_cases_for_judge _is_real_judge_name _judge_identity _judge_query_aliases _normalise_judge_name _split_judges _load_judge_bios _load_judge_name_overrides _known_singleton_judge_names _resolve_contextual_judge_name _resolve_judge_display_name _normalise_court_code _normalise_year_value; do printf "%-34s %s\n" "$n" "$(grep -c "\b$n\b" immi_case_downloader/web/routes/api.py)"; done
```

**`_is_real_judge_name` is the exception you must handle.** No code in `api.py`
calls it — only `tests/test_api_helpers.py` does, via
`from immi_case_downloader.web.routes.api import (...)` at lines 11–25. Do not
add it to the import above just to keep that test working; that is an unused
import. Instead, in `tests/test_api_helpers.py`, move the three judge-name
symbols out of the `...routes.api` import list into a second import from their
new home, leaving the other ten names in the original list:

```python
from immi_case_downloader.web.judge_names import (
    _is_real_judge_name,
    _normalise_judge_name,
    _split_judges,
)
```

Finally, update the two test files that patch the moved loaders by dotted path.
`mock.patch("immi_case_downloader.web.routes.api._load_judge_bios")` no longer
works once the internal caller lives in `judge_names.py`, because the patch
would rebind the re-exported alias and not the name the moved code resolves.
Rewrite both dotted paths in place:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && sed -i '' \
  -e 's/immi_case_downloader\.web\.routes\.api\._load_judge_bios/immi_case_downloader.web.judge_names._load_judge_bios/g' \
  -e 's/immi_case_downloader\.web\.routes\.api\._load_judge_name_overrides/immi_case_downloader.web.judge_names._load_judge_name_overrides/g' \
  tests/test_analytics_api.py tests/test_taxonomy_countries_and_judges_api.py
```

That rewrites 5 patch pairs in `tests/test_analytics_api.py` and 7 in
`tests/test_taxonomy_countries_and_judges_api.py`. The
`api_routes._judge_identity.cache_clear()` calls in both files need no change —
the re-exported `lru_cache` wrapper is the same object.

**Verify**:
```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make test-py 2>&1 | tail -3 && make lint && wc -l < immi_case_downloader/web/routes/api.py
```
→ Python results equal your Step-0 baseline plus 5 new passing tests (3 from
Step 3, 2 from Step 9) with the same failure and skip counts;
`All checks passed!`; `api.py` is under 2,300 lines

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && grep -rn "routes\.api\._load_judge_bios\|routes\.api\._load_judge_name_overrides" tests/; echo "grep-exit=$?"
```
→ prints nothing and `grep-exit=1`

And prove the packaged-overrides path still resolves after the move. (Do not
try to call `_load_judge_name_overrides()` directly here — it calls
`get_output_dir()`, which reads `current_app.config` and needs a Flask app
context. Check the resolved path instead:)

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -c "
from pathlib import Path
import immi_case_downloader.web.judge_names as jn
p = Path(jn.__file__).resolve().parents[1] / 'data' / 'judge_name_overrides.json'
print(p, p.exists())"
```
→ prints a path ending
`immi_case_downloader/data/judge_name_overrides.json` and `True`. If it prints
a path directly under the repository root, or `False`, the `parents[1]` fix did
not land.

Commit here: `refactor: finish the cq-001 constant split and lift judge names out of api.py`.

## Test plan

New test files, and what each covers:

- `workers/__tests__/council-prompt-parity.test.js` — 7 tests. Four assert the
  JS mirror is byte-identical to `immi_case_downloader/data/council_prompts.json`
  (this is the regression gate: it fails the moment anyone edits one runtime's
  prompt without the other). The fifth asserts that no default prompt claims a
  `google_search` or `web_search` tool, and that the grounded Anthropic variant
  does. The **sixth and seventh are the ones that matter**: they inspect the
  actual outgoing request body, asserting that `streamAnthropicNative` sends the
  grounded prompt *together with* a `web_search` tool block, and that every
  OpenAI-compat gateway request sends a base prompt and no tools. Constant
  equality alone cannot detect the defect this plan fixes — a model being told
  it has a tool it does not have is a property of the wire, not of a file.
  Structural models: `workers/__tests__/cloudflare-storage-contracts.test.js`
  for the `node:fs` reads, `workers/__tests__/llm-council-runner.test.js` for
  the `vi.spyOn(globalThis, "fetch")` idiom.
- `tests/test_council_prompt_source.py` — 4 tests. Asserts the Python engine's
  four constants come from the JSON (guards the loader against a typo'd key or
  a missing file), that no Python-side prompt claims a search tool since the
  Python engine attaches none (`llm_council.py:721`), that the grounded variant
  exists for the Worker, and that
  `scripts/generate_council_prompts.py --check` passes in-tree — the staleness
  gate that makes `prompts.js` a *generated* file rather than a hand-maintained
  second copy.
- `tests/test_cache_registry.py` — 2 tests. Happy path for the registry, and
  the specific regression: `api_taxonomy`'s lineage cache is actually reached
  by `invalidate_registered_caches()` now that `api.py` no longer imports it
  directly. There is currently **no** test covering the deferred-import path
  this replaces, which is exactly why one is being added.

No new *test files* for the Worker storage split and the constants move — both
are byte-for-byte relocations whose acceptance criterion is that the existing
Worker and Python suites keep passing unchanged. Writing new tests for moved
code would test the move, not the behaviour. The split does get two non-pytest
gates, because the mocked Worker tests are blind to the failure mode it risks:
the `node --input-type=module` probes in Steps 5, 6 and 7, which load
`workers/storage/cloudflare.js` unmocked and would surface a `ReferenceError`
from a bare `export … from` barrel.

Final verification:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-workers
make test-py 2>&1 | grep -E "^(FAILED|ERROR)" | sort -u
make test-py 2>&1 | tail -3
make lint
.venv/bin/python scripts/generate_council_prompts.py --check
```

→ `WORKER_TESTS_BEFORE + 7` across `WORKER_FILES_BEFORE + 1` files; the failing
Python test **names** identical to `PY_FAIL_NAMES`; passed `PY_PASS_BEFORE + 6`
with `PY_SKIP_BEFORE` unchanged; `All checks passed!`; `OK: generated council
prompts are up to date`.

## Done criteria

ALL must hold:

- [ ] `make test-workers` → `WORKER_FILES_BEFORE + 1` files, `WORKER_TESTS_BEFORE + 7` tests
- [ ] `npx vitest run --config workers/vitest.config.js __tests__/council-prompt-parity.test.js` → `7 passed`
- [ ] `.venv/bin/pytest tests/test_council_prompt_source.py -q` → `4 passed`
- [ ] `.venv/bin/pytest tests/test_cache_registry.py -q` → `2 passed`
- [ ] `make test-py` → passed `= PY_PASS_BEFORE + 6`; skipped `= PY_SKIP_BEFORE`;
      failing test **names** identical to `PY_FAIL_NAMES`
- [ ] `.venv/bin/python scripts/generate_council_prompts.py --check` exits 0, and you
      have demonstrated it exiting 1 on a hand-edited `prompts.js`
- [ ] `grep -c 'export {.*} from "' workers/storage/cloudflare.js` → `0` (no bare
      re-export; the barrel imports locally then exports)
- [ ] The Step 7 `node --input-type=module` probe prints `ok — rejected with …`
      and never `BARE RE-EXPORT BUG`
- [ ] `make lint` → `All checks passed!`, exit 0
- [ ] `.venv/bin/python -c "import immi_case_downloader.web.routes.api_taxonomy"` exits 0
- [ ] `.venv/bin/python -c "import immi_case_downloader.web.routes.api_cases"` exits 0
- [ ] `grep -n "from \.api_taxonomy\|from \.api_cases" immi_case_downloader/web/routes/api.py`
      returns no matches
- [ ] `grep -rn "routes\.api\._load_judge_bios\|routes\.api\._load_judge_name_overrides" tests/`
      returns no matches
- [ ] `grep -c "^export class" workers/storage/cloudflare.js` prints `0`
- [ ] `wc -l < workers/storage/cloudflare.js` is under 140
- [ ] `wc -l < immi_case_downloader/web/routes/api.py` is under 2300
- [ ] `grep -c "google_search grounding enabled" workers/llm-council/runner.js`
      prints `0`
- [ ] All six files exist: `workers/storage/{cloudflare_shared,object,case,identity,council,pipeline,semantic}.js`
- [ ] `git status --short` shows changes only to files listed under "In scope"
- [ ] `plans/README.md` status row updated — or skipped, if that file still
      does not exist

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check prints any changed file and the "Current state" excerpts no
  longer match what you read at those line numbers.
- The Step 1 generator script's assertion
  `assert len(grounded_anthropic) == 1168` fails. That means the Worker's
  Anthropic prompt has been edited since this plan was written, and you must
  not silently capture a different string as canonical.
- Step 1's verify does not print exactly `793 868 851 1146`. Any other number
  means the JSON did not round-trip the text byte-for-byte, and a prompt whose
  bytes you cannot account for must not be shipped.
- `make test-workers` drops below `WORKER_TESTS_BEFORE + 7` at any point in
  Steps 4–7, or any test fails. Every one of those steps is a byte-for-byte
  move; a single failure means something was transcribed, not moved. Do not
  "fix" the test — revert the step and report.
- `/tmp/immi-cloudflare-storage-baseline.js` is missing, or differs from
  `git show 42826a3:workers/storage/cloudflare.js`, when you reach Step 5.
  Every line range in Steps 4–6 is relative to that snapshot; slicing the live
  file by those numbers after Step 4's deletion cuts the wrong code. Re-take the
  snapshot from a clean checkout, or re-derive every range by symbol boundary,
  and say which you did.
- Any of the six store classes is exported from `workers/storage/cloudflare.js`
  with `export { X } from "./y.js"` rather than a local import plus
  `export { X }`. That form compiles and then throws at runtime inside
  `createCloudflareStores`, and the mocked Worker suite may not catch it.
- Splitting `workers/storage/cloudflare.js` appears to need a change to any
  factory signature, or to `workers/storage/contracts.js`. Twenty-nine call
  sites depend on those signatures, twenty of them through `vi.mock`.
- `make lint` reports `F401` after Step 8 or Step 10. That means you
  re-exported a constant or helper that the receiving module does not actually
  use. Remove the import rather than adding a `# noqa`.
- The judge extraction in Step 10 turns out to need `_judge_profile_payload`,
  `_determine_court_type`, `_is_win`, `_normalise_outcome`, `_round_rate` or
  `_split_concepts` to move as well. Those are analytics helpers; pulling them
  in creates a new `api.py` ↔ `judge_names.py` cycle, which is the exact defect
  this plan exists to remove. Stop and report instead.
- You find yourself editing a test **assertion** (as opposed to a `mock.patch`
  dotted-path string) to make a test pass. Nothing in this plan changes
  behaviour except the two prompt substitutions in Step 2, and those are
  covered by new tests, not by changing old ones.
- The assumption "no live Gemini path attaches `google_search`" turns out to be
  false — i.e. you find a caller of `streamGeminiNative`, or a `tools:` block
  on the Gemini compat request. Then removing the grounding paragraph from the
  Gemini prompt would be wrong, and you need a `grounded.gemini_pro` variant
  instead.

## Maintenance notes

For whoever owns this code next:

- **The prompt JSON is now load-bearing in two runtimes.** Editing
  `immi_case_downloader/data/council_prompts.json` changes production council
  behaviour. After any edit, run
  `.venv/bin/python scripts/generate_council_prompts.py` and re-run
  `make test-workers`. `tests/test_council_prompt_source.py` runs the same
  generator with `--check`, so a forgotten regenerate fails the suite rather
  than silently shipping a stale mirror.
- **Blocking follow-up: persist the effective prompt version with the council
  result.** This plan records `prompts_version` in the Worker's structured log
  only, because changing a persisted payload shape is out of its scope (see
  "Out of scope"). That leaves a real gap: a stored council answer still cannot
  be traced to the prompt text that produced it, and the Anthropic native path
  now sends a *different* string from the one recorded for the turn. The fix is
  a `prompts_version` (and `grounded`) field on the persisted turn payload plus
  a migration for existing rows, owned by whoever owns
  `workers/llm-council/cloudflare_handlers.js` and the council D1 schema. Do not
  close this plan claiming prompt provenance is solved end-to-end; it is solved
  for operators reading logs, not for readers of a stored answer.
- **Grounding text belongs with the tool, not with the provider.** The rule
  this plan establishes: a prompt may claim a search tool only on a code path
  that literally sends a `tools:` block. If `streamGeminiNative` is ever
  revived, add a `grounded.gemini_pro` entry to the JSON and wire it in the
  same way `ANTHROPIC_GROUNDED_SYSTEM_PROMPT` is wired — do not put the claim
  back into the default.
- **The original Gemini grounding paragraph is recoverable** from
  `workers/llm-council/runner.js:123-136` at commit `42826a3` if it is ever
  needed again.
- **`streamGeminiNative` (`runner.js:1624-1759`) is dead code** — nothing calls
  it. Deleting it is a clean follow-up that this plan deliberately did not take
  on, because deleting the native adapter would also delete the reference
  implementation someone would need to re-enable grounding.
- **api.py is smaller but still oversized.** After this plan it is roughly
  2,240 lines. The remaining candidates, in order of value:
  `_judge_profile_payload` (236 lines, the only function meaningfully over the
  repo's 50-line guidance), `analytics_success_rate` (136) and `stats` (123);
  then the analytics cache plumbing (`_get_all_cases` through `_apply_filters`,
  roughly lines 1030–1221) into a `web/analytics_cache.py`. None of those is a
  pure move — they carry behaviour and have no characterisation tests — so each
  needs its own plan with tests written first.
- **`from . import api as _api` still exists in two siblings.**
  `api_taxonomy.py:23` and `api_cases.py:44` still reach nine and two `_api.*`
  helpers respectively. That is a dependency, not a cycle — `api.py` imports
  neither of them back — so it is now safe, but it is the next thing to unwind
  if someone continues cq-001. The blocker is that the helpers are patched by
  dotted path in the tests, so each move costs a test-patch update, exactly as
  Step 10 did.
- **What a reviewer should scrutinise**: (1) that
  `CloudflareIdentityStore.assertMembership()` came across into
  `workers/storage/identity.js` with zero edits — `git diff` should show it as
  a pure relocation, and it is the whole tenant-isolation boundary; (2) that
  the two prompt substitutions in Step 2 are the only behavioural change in the
  entire diff; (3) that no `from .api import` remains in any sibling route
  module for anything other than the `_api` module handle.

## Findings reconsidered

- **"`_normalise_outcome` at api.py:531 is 151 lines, 3× the project's own
  guidance."** Not real. I measured the file's AST: `_normalise_outcome` spans
  lines 531–539 — **9 lines**. The figure appears to be a miscount, and it was
  the one carrying the "3× the guidance" claim, so that claim is dropped. The
  correct oversized-function list for `api.py` is `_judge_profile_payload`
  (790–1025, 236 lines), `analytics_success_rate` (1915–2050, 136) and `stats`
  (1370–1492, 123). Two related figures were also slightly off and are
  corrected in this plan: `_judge_profile_payload` is 236 lines, not 252, and
  `analytics_success_rate` is 136, not 141.
- **"The JS Anthropic prompt is 1,166 characters."** It is 1,168. I
  reconstructed and measured all four strings from both files; the full table
  is in "Current state". This matters because Step 1 asserts on the exact
  length before capturing the string as canonical.
- **The Steps 5–7 barrel was specified with bare `export … from` — corrected.**
  An earlier draft told Step 5 to add local imports for
  `CloudflareObjectStore` / `CloudflareCaseStore` but told Steps 6 and 7 only to
  "re-export each class". `export { X } from "./y.js"` forwards a binding to
  importers without creating a local `X`, and `createCloudflareStores`
  (`cloudflare.js:1880-1885`) constructs **all six** classes in that same
  module — so four of them would have been `ReferenceError`s at first request.
  Twenty of the twenty-nine importers `vi.mock` the module, so the Worker suite
  might not have caught it either. Steps 5, 6 and 7 now specify import-then-export
  for all six, with an unmocked `node --input-type=module` probe that fails on
  exactly this mistake.
- **The Steps 5–6 line ranges were measured against a file the plan had already
  edited — corrected.** Step 4 deletes snapshot lines 36–62 and adds an import,
  after which the live file's `246-1294` is no longer `CloudflareObjectStore` +
  `CloudflareCaseStore`; Step 5 then removes over a thousand more lines, so
  Step 6's `1295-1875` is off by more than the block it names. Every range is
  now explicitly relative to `/tmp/immi-cloudflare-storage-baseline.js`, a
  snapshot taken in Step 0 and diffed against `42826a3`.
- **The prompt work had no maintainable generator and no wire-level proof —
  corrected.** `prompts.js` was produced by a heredoc that existed only inside
  this document (nothing to re-run, nothing to detect a hand-edit), and the
  parity tests compared constants only, which cannot distinguish "the grounded
  prompt is defined" from "the grounded prompt is sent on the path that
  attaches the tool". Step 2 now writes a checked-in
  `scripts/generate_council_prompts.py` with a `--check` staleness mode
  (mirroring plan 033's generator convention), Step 3 adds two request-body
  tests, and `COUNCIL_PROMPTS_VERSION` makes the effective prompt set
  identifiable in logs. The persisted-payload half is recorded as a blocking
  follow-up above rather than smuggled into a plan whose scope forbids response
  shape changes.
- **Splitting `CloudflareCaseStore`'s 38 methods into read/write halves** —
  raised in the DEBT-13 fix sketch as a possible follow-on. Not attempted here.
  The file split in Steps 4–7 is verifiable by `make test-workers` alone
  because nothing moves across a module boundary that wasn't already a single
  class; carving one class into two is a design decision about the store's
  interface, and the plan that makes it should say what the interface becomes.
  Recorded, not done.
