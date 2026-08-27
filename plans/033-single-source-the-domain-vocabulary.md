# Plan 033: One visa registry, generated for both runtimes

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
>   immi_case_downloader/visa_registry.py \
>   immi_case_downloader/sources/metadata_extractor.py \
>   immi_case_downloader/data/ \
>   workers/case-api/static.js \
>   workers/case-api/cloudflare.js \
>   workers/austlii-scraper/src/parser.ts \
>   scripts/ CLAUDE.md AGENTS.md
> ```
>
> Expected: empty output. If any in-scope file changed since this plan was
> written, compare the "Current state" excerpts against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/002-fix-test-collection-and-install.md` (soft — see below)
- **Category**: tech-debt
- **Planned at**: commit `42826a3`, 2026-08-27

**Why the dependency is soft.** Plan 002 adds a `make test-pipeline` target that
runs the `workers/austlii-scraper` Vitest suite, which `make test` does not
currently cover. This plan adds a new test to that suite. Everything in this
plan is executable and verifiable *without* plan 002 by using the direct
command `cd workers/austlii-scraper && npm test`, which is what every
verification step below uses. If plan 002 has already landed, `make test-pipeline`
is an equivalent shortcut. **Do not add a Makefile target yourself** — plan 002
owns `Makefile` and would conflict.

## Why this matters

The project keeps its Australian-immigration domain vocabulary — the visa
subclass → name → family table, and the case-metadata extraction regexes — in
two hand-maintained copies, one in Python and one in JavaScript/TypeScript.
Nothing in the test suite compares them, and they have already drifted in two
places that reach real users:

1. **Visa subclass 408 (Temporary Activity)** is bucketed as `Skilled` by the
   production Cloudflare Worker and as `Visitor` by the Flask analytics. The
   two APIs disagree about a visa family grouping today.
2. **Judge names** are extracted differently. On a routine Federal Court header
   (`BEFORE: Justice A Nguyen`) the Python scraper records
   `Justice A Nguyen` while the TypeScript scraper Worker records `A Nguyen`.
   The judge features key on that string across 15,465 distinct judge records,
   so the same judge splits into two leaderboard rows depending on which
   scraper ingested the case.

Both are silent: the wrong value is a plausible value, so it surfaces weeks
later as an analytics anomaly rather than an error. Worse, `CLAUDE.md` tells
the next contributor that `visa_registry.py` is the canonical lookup "used by
Worker proxy and Flask analytics", so someone adding a subclass edits the
Python file, watches local Flask pick it up, ships — and production silently
buckets the new subclass as `Other`.

After this plan there is exactly one authored copy of the visa registry
(`immi_case_downloader/data/visa_registry.json`), the Worker's copy is
generated from it, a test fails if the generated file goes stale, the two
extractors are pinned to identical output by a shared golden corpus, and the
docs describe what is actually true.

## Current state

### Files and their roles

- `immi_case_downloader/visa_registry.py` — Python visa table + `clean_subclass()`,
  `get_family()`, `group_by_family()`, `get_registry_for_api()`. Consumed by
  `immi_case_downloader/web/routes/api.py:24-28` and
  `immi_case_downloader/web/routes/api_taxonomy.py:18` (the local-dev Flask path).
- `workers/case-api/static.js` — the Worker's own copy of the same table plus
  unrelated `DATA_DICTIONARY_FIELDS` and `LEGISLATIONS_META` constants.
  Consumed by `workers/case-api/cloudflare.js:13` and
  `workers/pipeline/control_handlers.js:13`.
- `workers/case-api/cloudflare.js` — production read handlers. **Out of scope**;
  its `import` line must keep working unchanged.
- `immi_case_downloader/sources/metadata_extractor.py` — the single Python
  case-metadata extractor. `immi_case_downloader/sources/austlii.py:346-357`
  and `immi_case_downloader/sources/federal_court.py:246` are thin delegates
  to it.
- `workers/austlii-scraper/src/parser.ts` — the TypeScript re-implementation of
  the same extraction, called live at
  `workers/austlii-scraper/src/index.ts:360`.

### The 408 drift (verified by direct diff of the two tables)

`workers/case-api/static.js:34`:

```js
  ["408", "Temporary Activity", "Skilled"], ["500", "Student", "Student"],
```

`immi_case_downloader/visa_registry.py:89`:

```python
    "408": ("Temporary Activity", "Visitor"),
```

A full programmatic comparison of the two tables at commit `42826a3` returns:
80 entries each, no entry present in only one side, identical 9-family
description maps, and **exactly one** value difference — subclass `408`.

**`Visitor` is the correct value and `Skilled` is the transcription error.**
Three independent reasons, all checkable in the repo:

- The `Visitor` family description in *both* copies is
  `"Tourist, visitor, and temporary activity visas"` — it literally names this
  visa's category.
- `visa_registry.py` groups `408` inside its `# Visitor visas` block alongside
  `400 Temporary Work (Short Stay Activity)`, `417`, `462`; the `Skilled`
  description is `"Skilled migration and employer-sponsored visas"`.
- `git log` shows `visa_registry.py` predates `static.js`
  (`517e9e6`, 2026-02-22 vs `7fdf99c`, 2026-08-19), and in `static.js` the `408`
  entry was moved up next to `407 Training` while being flattened into a dense
  two-entries-per-line array — the shape of a copy-paste slip.

### `workers/case-api/static.js:1-19` (the region you will replace)

```js
/** Static IMMI API data used by the standalone Cloudflare Worker.
 *
 * This module intentionally has no database or legacy proxy imports.  Values
 * mirror the public shapes previously served by the Worker/Flask boundary.
 */

export const VISA_FAMILIES = Object.freeze({
  Protection: "Refugee and humanitarian protection visas",
  Skilled: "Skilled migration and employer-sponsored visas",
  Student: "Student and education visas",
  Partner: "Partner, spouse, and de facto visas",
  Parent: "Parent and family reunion visas",
  Visitor: "Tourist, visitor, and temporary activity visas",
  Business: "Business innovation and investment visas",
  Bridging: "Bridging visas (temporary stay while substantive visa processed)",
  Other: "Other visa categories",
});

const VISA_ENTRIES = [
```

`workers/case-api/static.js:65-74` (end of the region):

```js
];

export const VISA_REGISTRY_API = Object.freeze({
  entries: VISA_ENTRIES.map(([subclass, name, family]) => ({ subclass, name, family })),
  families: VISA_FAMILIES,
});

export const VISA_REGISTRY_RAW = Object.freeze(
  Object.fromEntries(VISA_ENTRIES.map(([subclass, name, family]) => [subclass, [name, family]])),
);
```

Line 76 onwards is `export const DATA_DICTIONARY_FIELDS = Object.freeze([` and
must be left untouched.

### `immi_case_downloader/visa_registry.py:1-12` and `:27` and `:125-129`

```python
"""Australian Visa Subclass Registry.

Canonical list of Australian visa subclasses with metadata for quick-lookup,
filtering, and search taxonomy features. Maps visa subclass numbers to their
official names and family categories.
"""

from typing import Any

# ── Visa Families (Categories) ────────────────────────────────────────────

VISA_FAMILIES = {
```

```python
VISA_REGISTRY: dict[str, tuple[str, str]] = {
```

```python
    "856": ("Employer Nomination Scheme (ENS)", "Other"),
    "858": ("Distinguished Talent", "Other"),
}

# ── Functions ──────────────────────────────────────────────────────────────
```

The `}` on line 127 closes `VISA_REGISTRY`. Everything from line 129 onward
(`clean_subclass`, `get_family`, `group_by_family`, `get_registry_for_api`) is
unchanged by this plan.

### How the Worker consumes it — `workers/case-api/cloudflare.js:13` and `:33`

```js
import { DATA_DICTIONARY_FIELDS, LEGISLATIONS_META, VISA_REGISTRY_API, VISA_REGISTRY_RAW } from "./static.js";
```

```js
  return VISA_REGISTRY_RAW[String(subclass || "").replace(/\.0$/, "")]?.[1] || "Other";
```

`VISA_REGISTRY_RAW` is also read at `cloudflare.js:422` (`handleVisaLookup`)
and `cloudflare.js:643` (analytics filter option labels). `VISA_REGISTRY_API`
is served verbatim at `cloudflare.js:361`. **These call sites must keep
working with no edit to `cloudflare.js`.**

### The extractor drift — `workers/austlii-scraper/src/parser.ts:243-262`

```ts
/**
 * Extract metadata from the full page text using regex patterns.
 * Ported from austlii.py:_extract_metadata()
 */
export function extractMetadata(text: string): Omit<ParsedCase, "full_text"> {
  const result = {
    judges: "",
    date: "",
    catchwords: "",
    outcome: "",
    visa_type: "",
    legislation: "",
    citation_extracted: "",
  };

  // --- Judges/Members ---
  const judgePatterns = [
    /(?:JUDGE|MEMBER|JUSTICE|TRIBUNAL MEMBER)[:\s]+([^\n]+)/i,
    /(?:Before|Coram)[:\s]+([^\n]+)/i,
  ];
```

`immi_case_downloader/sources/metadata_extractor.py:12-21`:

```python
# Shared regex patterns (compiled once at module load for efficiency)
# Pattern 1: header keyword at the start of a line (e.g. "BEFORE: Justice Smith")
# Pattern 2: "Before:" / "Coram:" label anywhere in text
_JUDGE_PATTERNS = [
    re.compile(
        r"^(?:BEFORE|JUDGE|JUSTICE|TRIBUNAL MEMBER)[:\s]+([^\n]+)",
        re.IGNORECASE | re.MULTILINE,
    ),
    re.compile(r"(?:Before|Coram)[:\s]+([^\n]+)", re.IGNORECASE),
]
```

The TypeScript first pattern is **not** anchored to a line start, **omits**
`BEFORE`, and **adds** a bare `MEMBER` alternative. Measured behaviour on
identical input at commit `42826a3` (all seven other fields agree exactly; only
`judges` differs):

| Input | Python `MetadataExtractor` | TS `extractMetadata` |
|---|---|---|
| `"IN THE FEDERAL COURT\nBEFORE: Justice A Nguyen\n…"` | `Justice A Nguyen` | `A Nguyen` |
| `"The presiding MEMBER: Jane Doe made the decision.\n"` | *(no judges key)* | `Jane Doe made the decision.` |
| `"Reasons of the JUDGE: K Nguyen follow.\n"` | *(no judges key)* | `K Nguyen follow.` |
| `"TRIBUNAL MEMBER: R Patel\n"` | `R Patel` | `R Patel` |

Also note the stale comment: the docstring says "Ported from
`austlii.py:_extract_metadata()`", but `austlii.py:346-357` is now a thin
delegate to `MetadataExtractor`. There are **two** implementations, not three.

### The docs that are wrong — `CLAUDE.md:91-92` and `AGENTS.md:91-92`

Both files contain these two lines, byte-identical, at the same line numbers:

```
  visa_registry.py    → VISA_REGISTRY: canonical subclass→name→family lookup; used by
                        Worker proxy and Flask analytics for visa family grouping
```

Two problems: nothing under `workers/` imports the Python module (the Worker
has its own copy), and "Worker proxy" refers to `workers/proxy.js`, deleted in
commit `f91f45f`.

### Repo conventions this plan must match

- **Static reference data lives as JSON under `immi_case_downloader/data/`.**
  That directory already holds `legislations.json` and `judge_name_overrides.json`
  plus a `README.md` describing the format, and states: *"This is
  version-controlled static data (not in `.gitignore`) … this data should be
  maintained in git."* Load it with the same idiom as
  `immi_case_downloader/web/routes/legislations.py:57-59`:

  ```python
  def _data_path() -> str:
      pkg_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
      return os.path.join(pkg_dir, "data", "legislations.json")
  ```

- **JSON source → generated, checked-in output** is an established pattern here.
  `frontend/scripts/build-tokens.ts` begins:

  ```
  /**
   * Token build pipeline: tokens.json → tokens.css + tokens.ts
   * Run: npx tsx scripts/build-tokens.ts
   *
   * Generated at build time — do not edit the output files manually.
   */
  ```

  Mirror that header style in the generators you write.

- **`scripts/` already uses `generate_*.py` and `check_*.py` names**
  (`generate_audit_batches.py`, `generate_missing_embeddings.py`,
  `check_progress.py`). `make lint` runs
  `ruff check immi_case_downloader/ scripts/ *.py`, so anything you add under
  `scripts/` must be ruff-clean.

- **Python cases are built via `ImmigrationCase.from_dict()`** because pandas
  turns empty CSV fields into `float('nan')`. Not touched by this plan, but do
  not introduce a second construction path.

- **Worker tenant isolation is app-layer** via
  `CloudflareIdentityStore.assertMembership()` in `workers/storage/cloudflare.js`;
  `env.IMMI_CATALOG_DB` / `IMMI_ACCOUNT_DB` / `IMMI_OPS_DB` are D1 bindings.
  There is no Postgres and no RLS. Nothing in this plan touches that boundary.

- **Worker test style** (`workers/__tests__/*.test.js`): explicit Vitest
  imports, no globals (`globals: false` in `workers/vitest.config.js`), and
  `node:fs` / `node:url` are already used for file-reading tests — see
  `workers/__tests__/cloudflare-native-entry.test.js:1-2` and
  `workers/__tests__/cloudflare-storage-contracts.test.js:1-3`.

- **`workers/austlii-scraper` tests** live at `src/__tests__/*.test.ts`, import
  extensionlessly (`import { scrapeLegislation } from "../legislation";`), and
  run under a tsconfig with `"types": ["@cloudflare/workers-types"]` and **no
  Node types**. `npm run typecheck` (`tsc --noEmit`) runs in CI over
  `src/**/*.ts`. **A test file there must not import `fs`, `path` or any other
  Node builtin** — it will not typecheck. That is why the shared corpus is
  compiled into a generated `.ts` module instead of being read from disk.

## Commands you will need

All commands assume `cd "/Users/d/Developer/Active Projects/IMMI-Case-"` first.
Use the repo venv — never global pip.

| Purpose | Command | Expected on success |
|---|---|---|
| Python tests (full) | `.venv/bin/python -m pytest tests/ --ignore=tests/e2e -q` | `1141 passed` → `1152 passed` after this plan, plus the 3 pre-existing environmental failures and 7 skips (see below) |
| Python tests (fast subset) | `.venv/bin/python -m pytest tests/test_visa_registry_parity.py tests/test_extractor_parity.py tests/test_scraper_protocol.py tests/test_visa_lookup_api.py -q -p no:cacheprovider --no-cov` | all pass |
| Python lint | `make lint` | `All checks passed!` |
| Test-suite lint | `.venv/bin/ruff check tests/` | 43 errors at `42826a3` — **must not increase** |
| Main Worker tests | `cd workers && npx vitest run` | `Test Files 25 passed` / `Tests 345 passed` at `42826a3` |
| Scraper Worker tests | `cd workers/austlii-scraper && npm test` | `Test Files 7 passed (7)` / `Tests 28 passed (28)` at `42826a3` |
| Scraper Worker typecheck | `cd workers/austlii-scraper && npm run typecheck` | exit 0, no output |
| Worker bundle gate | `node scripts/check_cloudflare_native_bundle.mjs` | `Cloudflare-native bundle closure passed (…)`, exit 0 |
| Regenerate visa registry | `.venv/bin/python scripts/generate_visa_registry.py` | `Wrote …/workers/case-api/visa_registry.generated.js` |
| Check visa registry staleness | `.venv/bin/python scripts/generate_visa_registry.py --check` | `OK: generated visa registry is up to date`, exit 0 |
| Regenerate extractor corpus | `.venv/bin/python scripts/generate_extractor_corpus.py` | `Wrote …/extractor-parity-corpus.ts` |
| Check extractor corpus staleness | `.venv/bin/python scripts/generate_extractor_corpus.py --check` | `OK: generated extractor corpus is up to date`, exit 0 |

**Known-good baseline, do not try to fix:** `make test-py` at `42826a3` reports
`1141 passed, 3 failed, 7 skipped`. The 3 failures are all in
`tests/test_backfill_judge_overrides_from_pdf.py` and are environmental — a
Homebrew Python 3.14.7 `pyexpat`/`libexpat` ABI mismatch breaks the `pypdf`
import. They are not caused by repo code and are not this plan's problem.

## Suggested executor toolkit

- `python-testing-patterns` / `vitest` skills, if available, when writing the
  new test files in Steps 5, 6 and 8.
- Read `immi_case_downloader/data/README.md` before creating the new JSON file
  — it documents the conventions for that directory.
- Read `frontend/scripts/build-tokens.ts` (first 30 lines) for the generator
  header style this repo already uses.

## Scope

**In scope** (the only files you may modify or create):

- `immi_case_downloader/data/visa_registry.json` — **create**
- `immi_case_downloader/visa_registry.py` — replace lines 8–127 only
- `immi_case_downloader/sources/metadata_extractor.py` — comment only (Step 7)
- `scripts/generate_visa_registry.py` — **create**
- `scripts/generate_extractor_corpus.py` — **create**
- `workers/case-api/visa_registry.generated.js` — **create** (machine-generated)
- `workers/case-api/static.js` — replace lines 7–74 only
- `workers/austlii-scraper/src/parser.ts` — the two judge regexes and the
  docstring above `extractMetadata` only
- `workers/austlii-scraper/src/__tests__/extractor-parity.test.ts` — **create**
- `workers/austlii-scraper/src/__tests__/extractor-parity-corpus.ts` —
  **create** (machine-generated)
- `workers/__tests__/visa-registry-parity.test.js` — **create**
- `tests/fixtures/extractor_parity/*.txt` and
  `tests/fixtures/extractor_parity/expected.json` — **create**
- `tests/test_visa_registry_parity.py` — **create**
- `tests/test_extractor_parity.py` — **create**
- `CLAUDE.md` — **lines 91–92 only**
- `AGENTS.md` — **lines 91–92 only**
- `plans/README.md` — status row for this plan only

**Out of scope** (do NOT touch, even though they look related):

- `Makefile`. Plans 001, 002 and 003 all edit it, and plan 002 already adds the
  `make test-pipeline` target that wires the `austlii-scraper` suite into
  `make test`. Adding your own target guarantees a merge conflict and duplicates
  work that is already planned.
- `workers/vitest.config.js`. Plan 002 evaluated turning it into a Vitest
  workspace covering both Worker projects and rejected it: root is
  `vitest ^2.0.0`, `workers/austlii-scraper` is `^4.1.8`, and a workspace needs
  one runner version for both — i.e. a Vitest 2→4 migration of the 345-test main
  Worker suite as a side effect. Do not reopen that.
- `workers/case-api/cloudflare.js`. Its import at line 13 must keep working
  unchanged; that is the acceptance criterion for Step 4, not a file to edit.
- `immi_case_downloader/web/routes/api.py` and
  `immi_case_downloader/web/routes/api_taxonomy.py`. They import
  `visa_registry`'s public names, which this plan preserves exactly. If you
  find yourself editing either, your Step 2 rewrite changed the public API —
  that is a STOP condition.
- `workers/case-api/legal_concepts.js` (37 lines) and
  `immi_case_downloader/legal_concepts_registry.py` (310 lines). These are a
  second duplicated table, but they were compared at `42826a3` and **agree
  exactly** (34 concepts each, zero value differences). Latent risk, not live
  drift; deferred to Maintenance notes.
- The `OUTCOME_MAP` / `TRIBUNAL_CODES` / `COURT_CODES` / win-outcome tables
  duplicated at `workers/case-api/cloudflare.js:18-25,51-55` and
  `immi_case_downloader/web/routes/api.py:120-144`. Verified in agreement at
  `42826a3`; both consumer files are out of territory. Deferred.
- `workers/austlii-scraper/tsconfig.json` and `wrangler.toml` — plan 011 owns
  them.
- `workers/austlii-scraper/src/__tests__/extract-native.test.ts`,
  `pipeline-scrape.test.ts`, `pipeline-control.test.ts`, `discover.test.ts` —
  plan 011 owns all four.
- The **quality** of the extraction regexes. The golden corpus you create in
  Step 8 records today's Python output verbatim, including obviously poor
  values such as `outcome: "DECISION: 3 March 2021"` (the outcome pattern
  matches the tail of `DATE OF DECISION:`). This plan is a **parity** gate, not
  a quality gate. Improving the regexes would change 149,016 stored records and
  is a separate, much larger decision.
- `wrangler.toml` placeholder resource IDs, `IMMI_CASE_MUTATIONS_ENABLED` and
  the pipeline flags defaulting to `"false"`,
  `workers/austlii-scraper/scripts/rollback_run.ts` targeting legacy Supabase,
  and the `CLAUDE.md` "Performance Baseline (2026-05-05)" section — all
  fail-closed / historical **by design**.
- Any other line of `CLAUDE.md` or `AGENTS.md`. Several other lines are stale
  (plans 001 and 002 both recorded specific ones); leave them for the docs plan.

## Git workflow

- Branch: `advisor/033-single-source-the-domain-vocabulary`
- Commit per step or per logical unit. Message style is conventional commits —
  `<type>: <description>` with type in
  `feat|fix|refactor|docs|test|chore|perf|ci`. Example from `git log`:
  `fix: install root node_modules in make install`.
- No AI attribution lines, co-author trailers, or emoji in commit messages.
- Suggested commits: `refactor: generate the Worker visa registry from one JSON source`,
  `fix: bucket visa subclass 408 as a Visitor visa in both runtimes`,
  `fix: align the TypeScript judge extraction with the Python extractor`,
  `test: pin the two case-metadata extractors to a shared golden corpus`,
  `docs: correct the visa_registry.py ownership note`.
- Do **NOT** push, open a PR, or merge. The operator commits and ships.

## Steps

### Step 1: Create the single source of truth, with 408 corrected

Create `immi_case_downloader/data/visa_registry.json` by dumping the current
Python table with the one correction applied, sorted canonically. Do **not**
hand-type 80 entries — run exactly this:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python - <<'PY'
import json
import sys
sys.path.insert(0, ".")
from immi_case_downloader.visa_registry import VISA_FAMILIES, VISA_REGISTRY

registry = dict(VISA_REGISTRY)
# The Worker's hand-maintained copy said "Skilled"; "Visitor" is correct — the
# Visitor family description is literally "Tourist, visitor, and temporary
# activity visas".
registry["408"] = ("Temporary Activity", "Visitor")

doc = {
    "families": VISA_FAMILIES,
    "entries": [
        {"subclass": s, "name": registry[s][0], "family": registry[s][1]}
        for s in sorted(registry, key=lambda value: value.zfill(4))
    ],
}
with open("immi_case_downloader/data/visa_registry.json", "w", encoding="utf-8") as fh:
    fh.write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
print("entries:", len(doc["entries"]), "families:", len(doc["families"]))
PY
```

Entries are sorted by `subclass.zfill(4)` deliberately: that is exactly the
order `get_registry_for_api()` already produces
(`immi_case_downloader/visa_registry.py`, the `sorted(..., key=lambda x: x.zfill(4))`
call), so after this plan the Flask and Worker `/api/v1/visa-registry`
responses are byte-identical rather than merely equivalent.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -c "
import json
d = json.load(open('immi_case_downloader/data/visa_registry.json'))
print('entries', len(d['entries']))
print('families', len(d['families']))
print('408', [e for e in d['entries'] if e['subclass'] == '408'])
print('first', d['entries'][0]['subclass'], 'last', d['entries'][-1]['subclass'])
"
```

→
```
entries 80
families 9
408 [{'subclass': '408', 'name': 'Temporary Activity', 'family': 'Visitor'}]
first 010 last 893
```

### Step 2: Make `visa_registry.py` read the JSON instead of holding the table

In `immi_case_downloader/visa_registry.py`, replace **lines 8 through 127**
(from `from typing import Any` through the `}` that closes `VISA_REGISTRY`)
with the block below, and extend the module docstring at lines 1–6 as shown.
Everything from line 129 (`# ── Functions ──…`) onward stays **byte-identical**.

New file head (lines 1 to the end of the replaced region):

```python
"""Australian Visa Subclass Registry.

Canonical list of Australian visa subclasses with metadata for quick-lookup,
filtering, and search taxonomy features. Maps visa subclass numbers to their
official names and family categories.

The table itself lives in ``immi_case_downloader/data/visa_registry.json``,
which is the single source of truth shared with the Cloudflare Worker. The
Worker's copy, ``workers/case-api/visa_registry.generated.js``, is generated
from that same JSON by ``scripts/generate_visa_registry.py``. Edit the JSON,
then regenerate — never hand-edit either derived copy.
"""

import json
import os
from typing import Any

# ── Data source ───────────────────────────────────────────────────────────


def _data_path() -> str:
    pkg_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(pkg_dir, "data", "visa_registry.json")


def _load_document() -> dict[str, Any]:
    with open(_data_path(), encoding="utf-8") as handle:
        return json.load(handle)


_DOCUMENT = _load_document()

# ── Visa Families (Categories) ────────────────────────────────────────────

VISA_FAMILIES: dict[str, str] = dict(_DOCUMENT["families"])

# ── Visa Subclass Registry ─────────────────────────────────────────────────
# Format: subclass → (name, family)

VISA_REGISTRY: dict[str, tuple[str, str]] = {
    entry["subclass"]: (entry["name"], entry["family"])
    for entry in _DOCUMENT["entries"]
}
```

The public names `VISA_FAMILIES`, `VISA_REGISTRY`, `clean_subclass`,
`get_family`, `group_by_family` and `get_registry_for_api` are unchanged, so
`api.py:24-28` and `api_taxonomy.py:18` need no edit.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -c "
from immi_case_downloader.visa_registry import (
    VISA_FAMILIES, VISA_REGISTRY, clean_subclass, get_family,
    group_by_family, get_registry_for_api,
)
print('entries', len(VISA_REGISTRY), 'families', len(VISA_FAMILIES))
print('408', VISA_REGISTRY['408'], get_family('408'))
print('866', get_family('866'), '| 866.0', get_family('866.0'), '| 999', get_family('999'))
print('clean', repr(clean_subclass('866.0')), repr(clean_subclass(None)))
print('group', group_by_family({'866': 100, '785': 50, '500': 200}))
api = get_registry_for_api()
print('api entries', len(api['entries']), 'first', api['entries'][0]['subclass'])
"
```

→
```
entries 80 families 9
408 ('Temporary Activity', 'Visitor') Visitor
866 Protection | 866.0 Protection | 999 Other
clean '866' ''
group {'Protection': 150, 'Student': 200}
api entries 80 first 010
```

Then:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint && \
  .venv/bin/python -m pytest tests/test_visa_lookup_api.py tests/test_taxonomy_countries_and_judges_api.py -q -p no:cacheprovider --no-cov 2>&1 | tail -3
```

→ `All checks passed!` then `21 passed`.

### Step 3: Add the visa registry generator

Create `scripts/generate_visa_registry.py` with exactly this content:

```python
#!/usr/bin/env python3
"""Generate the Worker's visa registry module from the shared JSON source.

Source of truth : immi_case_downloader/data/visa_registry.json
Generated output: workers/case-api/visa_registry.generated.js

Generated at build time — do not edit the output file manually.

Usage:
    python3 scripts/generate_visa_registry.py            # write the file
    python3 scripts/generate_visa_registry.py --check    # exit 1 if stale
"""

import argparse
import json
import os
import sys
from typing import Any

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(
    REPO_ROOT, "immi_case_downloader", "data", "visa_registry.json"
)
TARGET = os.path.join(
    REPO_ROOT, "workers", "case-api", "visa_registry.generated.js"
)

HEADER = """\
/** Australian visa subclass registry for the standalone Cloudflare Worker.
 *
 * @generated by scripts/generate_visa_registry.py from
 * immi_case_downloader/data/visa_registry.json - DO NOT EDIT BY HAND.
 * Regenerate with: python3 scripts/generate_visa_registry.py
 */
"""


def _js(value: str) -> str:
    """Render a Python string as a JavaScript string literal."""
    return json.dumps(value, ensure_ascii=False)


def render(doc: dict[str, Any]) -> str:
    """Render the generated JavaScript module for the given registry document."""
    lines = [HEADER, "export const VISA_FAMILIES = Object.freeze({"]
    for name, description in doc["families"].items():
        lines.append(f"  {_js(name)}: {_js(description)},")
    lines.extend(["});", "", "export const VISA_ENTRIES = Object.freeze(["])
    for entry in doc["entries"]:
        lines.append(
            f"  [{_js(entry['subclass'])}, {_js(entry['name'])}, "
            f"{_js(entry['family'])}],"
        )
    lines.extend(["]);", ""])
    return "\n".join(lines)


def load_source() -> dict[str, Any]:
    with open(SOURCE, encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate the Worker visa registry from the shared JSON source."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if the generated file is missing or stale; write nothing",
    )
    args = parser.parse_args()

    expected = render(load_source())

    if args.check:
        if not os.path.exists(TARGET):
            print(f"MISSING: {TARGET}", file=sys.stderr)
            return 1
        with open(TARGET, encoding="utf-8") as handle:
            actual = handle.read()
        if actual != expected:
            print(
                "STALE: workers/case-api/visa_registry.generated.js does not "
                "match immi_case_downloader/data/visa_registry.json.\n"
                "Run: python3 scripts/generate_visa_registry.py",
                file=sys.stderr,
            )
            return 1
        print("OK: generated visa registry is up to date")
        return 0

    with open(TARGET, "w", encoding="utf-8") as handle:
        handle.write(expected)
    print(f"Wrote {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Then run it once to create the generated module:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python scripts/generate_visa_registry.py
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python scripts/generate_visa_registry.py --check && \
  head -8 workers/case-api/visa_registry.generated.js && \
  grep -c '^  \[' workers/case-api/visa_registry.generated.js && \
  grep -n '"408"' workers/case-api/visa_registry.generated.js && \
  make lint
```

→ `OK: generated visa registry is up to date`, then the 6-line `@generated`
header plus a blank line and `export const VISA_FAMILIES = Object.freeze({`,
then `80`, then a line containing `["408", "Temporary Activity", "Visitor"],`,
then `All checks passed!`.

### Step 4: Rewire `static.js` onto the generated module

In `workers/case-api/static.js`, replace **lines 7 through 74** — that is, from
`export const VISA_FAMILIES = Object.freeze({` through the `);` that closes
`VISA_REGISTRY_RAW` — with:

```js
import { VISA_ENTRIES, VISA_FAMILIES } from "./visa_registry.generated.js";

export { VISA_FAMILIES };

export const VISA_REGISTRY_API = Object.freeze({
  entries: VISA_ENTRIES.map(([subclass, name, family]) => ({ subclass, name, family })),
  families: VISA_FAMILIES,
});

export const VISA_REGISTRY_RAW = Object.freeze(
  Object.fromEntries(VISA_ENTRIES.map(([subclass, name, family]) => [subclass, [name, family]])),
);
```

Also extend the file's existing header comment (lines 1–5) so the next reader
knows part of it is generated. Replace line 4
(` * mirror the public shapes previously served by the Worker/Flask boundary.`)
with:

```js
 * mirror the public shapes previously served by the Worker/Flask boundary.
 *
 * The visa registry is NOT authored here: it is generated into
 * ./visa_registry.generated.js from immi_case_downloader/data/visa_registry.json
 * by scripts/generate_visa_registry.py, so the Worker and the Flask analytics
 * cannot drift. Edit the JSON, then regenerate.
```

Lines 76+ (`export const DATA_DICTIONARY_FIELDS = …` and `LEGISLATIONS_META`)
must be untouched.

**Verify** — the exported shapes are unchanged apart from the intended 408 fix,
and no consumer needs editing:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --input-type=module -e '
import { readFileSync } from "node:fs";
import { VISA_REGISTRY_API, VISA_REGISTRY_RAW, VISA_FAMILIES, DATA_DICTIONARY_FIELDS, LEGISLATIONS_META } from "./workers/case-api/static.js";
const src = JSON.parse(readFileSync("immi_case_downloader/data/visa_registry.json", "utf8"));
console.log("entries:", VISA_REGISTRY_API.entries.length);
console.log("entries match json:", JSON.stringify(VISA_REGISTRY_API.entries) === JSON.stringify(src.entries));
console.log("families match json:", JSON.stringify(VISA_FAMILIES) === JSON.stringify(src.families));
console.log("408:", JSON.stringify(VISA_REGISTRY_RAW["408"]));
console.log("866:", JSON.stringify(VISA_REGISTRY_RAW["866"]));
console.log("other exports intact:", DATA_DICTIONARY_FIELDS.length, LEGISLATIONS_META.length);
'
```

→
```
entries: 80
entries match json: true
families match json: true
408: ["Temporary Activity","Visitor"]
866: ["Protection","Protection"]
other exports intact: 22 5
```

Then confirm the production Worker still bundles and its suite still passes
with no edit to `cloudflare.js`:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  node scripts/check_cloudflare_native_bundle.mjs && \
  git diff --name-only -- workers/case-api/cloudflare.js && \
  (cd workers && npx vitest run 2>&1 | tail -3)
```

→ `Cloudflare-native bundle closure passed (…)`, then **no output** from the
`git diff --name-only` (proving `cloudflare.js` is untouched), then
`Test Files 25 passed (25)` / `Tests 345 passed (345)`.

### Step 5: Add the Python parity + staleness test

Create `tests/test_visa_registry_parity.py`:

```python
"""Parity guards for the shared visa subclass registry.

The registry has one source of truth,
``immi_case_downloader/data/visa_registry.json``. The Cloudflare Worker's copy
at ``workers/case-api/visa_registry.generated.js`` is generated from it by
``scripts/generate_visa_registry.py``. These tests fail when the two drift.
"""

import json
import os
import re
import subprocess
import sys

from immi_case_downloader.visa_registry import (
    VISA_FAMILIES,
    VISA_REGISTRY,
    get_family,
    get_registry_for_api,
)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GENERATED_JS = os.path.join(
    REPO_ROOT, "workers", "case-api", "visa_registry.generated.js"
)
GENERATOR = os.path.join(REPO_ROOT, "scripts", "generate_visa_registry.py")

_ENTRY_RE = re.compile(r"^  (\[.*\]),$", re.MULTILINE)


def _worker_registry() -> dict[str, tuple[str, str]]:
    """Parse the generated Worker module back into a subclass -> (name, family) map."""
    with open(GENERATED_JS, encoding="utf-8") as handle:
        source = handle.read()
    entries = [json.loads(match.group(1)) for match in _ENTRY_RE.finditer(source)]
    return {subclass: (name, family) for subclass, name, family in entries}


def test_generated_worker_registry_is_not_stale():
    result = subprocess.run(
        [sys.executable, GENERATOR, "--check"],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, (
        "workers/case-api/visa_registry.generated.js is stale. Run: "
        "python3 scripts/generate_visa_registry.py\n" + result.stderr
    )


def test_worker_and_python_registries_agree():
    assert _worker_registry() == VISA_REGISTRY


def test_subclass_408_is_a_visitor_visa():
    # Regression: the Worker's hand-maintained copy bucketed 408 as "Skilled"
    # while the Flask analytics bucketed it as "Visitor". The Visitor family
    # description is literally "Tourist, visitor, and temporary activity visas".
    assert VISA_REGISTRY["408"] == ("Temporary Activity", "Visitor")
    assert get_family("408") == "Visitor"
    assert _worker_registry()["408"] == ("Temporary Activity", "Visitor")


def test_registry_api_entries_are_canonically_sorted():
    # Both runtimes serve /api/v1/visa-registry; sorting by zfill(4) on both
    # sides makes the two payloads byte-identical, not merely equivalent.
    payload = get_registry_for_api()
    subclasses = [entry["subclass"] for entry in payload["entries"]]
    assert subclasses == sorted(subclasses, key=lambda value: value.zfill(4))
    assert payload["families"] == VISA_FAMILIES


def test_every_family_used_by_an_entry_is_described():
    used = {family for _, family in VISA_REGISTRY.values()}
    assert used <= set(VISA_FAMILIES)
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python -m pytest tests/test_visa_registry_parity.py -q -p no:cacheprovider --no-cov 2>&1 | tail -3
```

→ `5 passed`.

Then prove the guard actually bites, using a temporary edit you immediately
revert:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  cp workers/case-api/visa_registry.generated.js /tmp/vrg.bak && \
  sed -i '' 's/\["408", "Temporary Activity", "Visitor"\]/["408", "Temporary Activity", "Skilled"]/' workers/case-api/visa_registry.generated.js && \
  .venv/bin/python -m pytest tests/test_visa_registry_parity.py -q -p no:cacheprovider --no-cov 2>&1 | tail -3 ; \
  cp /tmp/vrg.bak workers/case-api/visa_registry.generated.js && rm /tmp/vrg.bak && \
  .venv/bin/python -m pytest tests/test_visa_registry_parity.py -q -p no:cacheprovider --no-cov 2>&1 | tail -2
```

→ first run reports `3 failed, 2 passed`; after the restore, `5 passed`.

Finally confirm you did not add lint debt:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/ruff check tests/ 2>&1 | tail -2
```

→ still `Found 43 errors.` (the pre-existing count owned by plan 003) — **not 44+**.

### Step 6: Add the Worker-side parity test

Create `workers/__tests__/visa-registry-parity.test.js`:

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { VISA_FAMILIES, VISA_REGISTRY_API, VISA_REGISTRY_RAW } from "../case-api/static.js";

const sourcePath = fileURLToPath(
  new URL("../../immi_case_downloader/data/visa_registry.json", import.meta.url),
);
const source = JSON.parse(readFileSync(sourcePath, "utf8"));

describe("visa registry parity with the shared JSON source", () => {
  it("serves every entry from the JSON source in the same order", () => {
    expect(VISA_REGISTRY_API.entries).toEqual(source.entries);
  });

  it("serves the same family descriptions as the JSON source", () => {
    expect(VISA_FAMILIES).toEqual(source.families);
    expect(VISA_REGISTRY_API.families).toEqual(source.families);
  });

  it("keys the raw lookup by exactly the subclasses in the source", () => {
    expect(Object.keys(VISA_REGISTRY_RAW).sort()).toEqual(
      source.entries.map((entry) => entry.subclass).sort(),
    );
  });

  it("buckets subclass 408 (Temporary Activity) as a Visitor visa", () => {
    // Regression: this table said "Skilled" while the Flask analytics said
    // "Visitor", so the two APIs disagreed on a visa-family grouping.
    expect(VISA_REGISTRY_RAW["408"]).toEqual(["Temporary Activity", "Visitor"]);
  });
});
```

Note the key-order-insensitive comparison in the third test: `VISA_REGISTRY_RAW`
is built with `Object.fromEntries`, and V8 reorders integer-like keys (`"866"`)
ahead of non-canonical ones (`"010"`), so asserting raw key order would be
asserting an engine detail.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers" && npx vitest run 2>&1 | tail -3
```

→ `Test Files 26 passed (26)` / `Tests 349 passed (349)`.

### Step 7: Align the TypeScript judge extraction with the Python extractor

In `workers/austlii-scraper/src/parser.ts`, replace the docstring at lines
243–246 and the two judge regexes at lines 260–261.

Replace:

```ts
/**
 * Extract metadata from the full page text using regex patterns.
 * Ported from austlii.py:_extract_metadata()
 */
```

with:

```ts
/**
 * Extract metadata from the full page text using regex patterns.
 *
 * This is a port of the Python `MetadataExtractor` in
 * immi_case_downloader/sources/metadata_extractor.py, and must produce
 * identical output for identical input. The shared golden corpus in
 * tests/fixtures/extractor_parity/ pins both implementations; see
 * ./__tests__/extractor-parity.test.ts and tests/test_extractor_parity.py.
 */
```

Replace:

```ts
    /(?:JUDGE|MEMBER|JUSTICE|TRIBUNAL MEMBER)[:\s]+([^\n]+)/i,
    /(?:Before|Coram)[:\s]+([^\n]+)/i,
```

with:

```ts
    // Mirrors metadata_extractor.py `_JUDGE_PATTERNS`: anchored to a line
    // start (Python re.MULTILINE), includes BEFORE, and deliberately has no
    // bare MEMBER alternative — an unanchored /MEMBER/ matched prose such as
    // "The presiding MEMBER: Jane Doe made the decision." and an unanchored
    // /JUSTICE/ turned "BEFORE: Justice A Nguyen" into "A Nguyen".
    /^(?:BEFORE|JUDGE|JUSTICE|TRIBUNAL MEMBER)[:\s]+([^\n]+)/im,
    /(?:Before|Coram)[:\s]+([^\n]+)/i,
```

Also add a one-line pointer in
`immi_case_downloader/sources/metadata_extractor.py`. Change line 4 of its
module docstring from:

```python
AustLIIScraper._extract_metadata and FederalCourtScraper._extract_metadata.
```

to:

```python
AustLIIScraper._extract_metadata and FederalCourtScraper._extract_metadata.

The Cloudflare scraper Worker re-implements these patterns in
workers/austlii-scraper/src/parser.ts. The two must agree; the shared golden
corpus in tests/fixtures/extractor_parity/ is what keeps them honest.
```

Change nothing else in either file — no other regex, no control flow.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && \
  npm run typecheck && npm test 2>&1 | tail -3
```

→ typecheck exits 0 with no output; tests report
`Test Files 7 passed (7)` / `Tests 28 passed (28)` (unchanged — no existing
scraper test asserts on `judges`).

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  make lint && grep -n 'JUDGE|JUSTICE' workers/austlii-scraper/src/parser.ts
```

→ `All checks passed!` and one line containing
`/^(?:BEFORE|JUDGE|JUSTICE|TRIBUNAL MEMBER)[:\s]+([^\n]+)/im,`.

### Step 8: Pin both extractors to one shared golden corpus

**8a. Create the fixture texts.** Create these four files under
`tests/fixtures/extractor_parity/` with exactly this content (trailing newline
on each; no trailing whitespace).

`aata_protection_remitted.txt`:

```
ADMINISTRATIVE APPEALS TRIBUNAL

[2021] AATA 1234

TRIBUNAL MEMBER: Deputy President S Smith

DATE OF DECISION: 3 March 2021

CATCHWORDS
MIGRATION - refusal of a Protection visa - subclass 866 visa - well-founded fear of persecution - credibility findings

LEGISLATION
Migration Act 1958 (Cth) ss 36, 65

DECISION
The Tribunal remits the matter to the Minister for reconsideration.
```

`fca_judicial_review_dismissed.txt`:

```
FEDERAL COURT OF AUSTRALIA

BEFORE: Justice A Nguyen

DATE OF ORDER: 14 July 2022

CATCHWORDS
MIGRATION - judicial review - jurisdictional error - Migration Regulations 1994 considered

ORDERS
1. The application is dismissed with costs.
```

`member_label_mid_line.txt` (single line):

```
The presiding MEMBER: Jane Doe made the decision.
```

`judge_label_mid_line.txt` (single line):

```
Reasons of the JUDGE: K Nguyen follow.
```

**8b. Create `tests/fixtures/extractor_parity/expected.json`** with exactly
this content. These are the Python extractor's current outputs, measured at
commit `42826a3`, expressed in the Worker's field shape (all seven keys always
present, `""` for absent, Python's `citation` key renamed to
`citation_extracted`):

```json
{
  "aata_protection_remitted.txt": {
    "judges": "Deputy President S Smith",
    "date": "3 March 2021",
    "catchwords": "MIGRATION - refusal of a Protection visa - subclass 866 visa - well-founded fear of persecution - credibility findings",
    "outcome": "DECISION: 3 March 2021",
    "visa_type": "Protection visa",
    "legislation": "Migration Act 1958 (Cth) ss 36, 65\n\nDECISION\nThe Tribunal remits the matter to the Minister for reconsideration",
    "citation_extracted": "[2021] AATA 1234"
  },
  "fca_judicial_review_dismissed.txt": {
    "judges": "Justice A Nguyen",
    "date": "14 July 2022",
    "catchwords": "MIGRATION - judicial review - jurisdictional error - Migration Regulations 1994 considered",
    "outcome": "ORDER: 14 July 2022",
    "visa_type": "",
    "legislation": "Migration Regulations 1994 considered\n\nORDERS\n1",
    "citation_extracted": ""
  },
  "judge_label_mid_line.txt": {
    "judges": "",
    "date": "",
    "catchwords": "",
    "outcome": "",
    "visa_type": "",
    "legislation": "",
    "citation_extracted": ""
  },
  "member_label_mid_line.txt": {
    "judges": "",
    "date": "",
    "catchwords": "",
    "outcome": "",
    "visa_type": "",
    "legislation": "",
    "citation_extracted": ""
  }
}
```

`outcome: "DECISION: 3 March 2021"` and `legislation` swallowing the following
paragraph are **knowingly poor** extractions — see the Scope note. This is a
parity gate. Record them as-is.

**8c. Create `scripts/generate_extractor_corpus.py`:**

```python
#!/usr/bin/env python3
"""Compile the shared extractor corpus into a TypeScript module for the Worker.

Source of truth : tests/fixtures/extractor_parity/*.txt + expected.json
Generated output: workers/austlii-scraper/src/__tests__/extractor-parity-corpus.ts

The Worker's test tsconfig has no Node types, so its parity test cannot read
the fixtures from disk. Compiling them into a .ts module keeps one authored
copy of the corpus while staying inside that constraint.

Generated at build time — do not edit the output file manually.

Usage:
    python3 scripts/generate_extractor_corpus.py            # write the file
    python3 scripts/generate_extractor_corpus.py --check    # exit 1 if stale
"""

import argparse
import json
import os
import sys
from typing import Any

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE_DIR = os.path.join(REPO_ROOT, "tests", "fixtures", "extractor_parity")
EXPECTED = os.path.join(FIXTURE_DIR, "expected.json")
TARGET = os.path.join(
    REPO_ROOT,
    "workers",
    "austlii-scraper",
    "src",
    "__tests__",
    "extractor-parity-corpus.ts",
)

HEADER = """\
/** Shared case-metadata extractor corpus.
 *
 * @generated by scripts/generate_extractor_corpus.py from
 * tests/fixtures/extractor_parity/ - DO NOT EDIT BY HAND.
 * Regenerate with: python3 scripts/generate_extractor_corpus.py
 *
 * The same corpus drives tests/test_extractor_parity.py, so the Python
 * MetadataExtractor and this Worker's extractMetadata cannot drift apart.
 */
"""


def load_corpus() -> list[dict[str, Any]]:
    with open(EXPECTED, encoding="utf-8") as handle:
        expected = json.load(handle)
    cases = []
    for name in sorted(expected):
        path = os.path.join(FIXTURE_DIR, name)
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        cases.append({"name": name, "text": text, "expected": expected[name]})
    return cases


def render(cases: list[dict[str, Any]]) -> str:
    body = json.dumps(cases, indent=2, ensure_ascii=False)
    return f"{HEADER}\nexport const EXTRACTOR_PARITY_CASES = {body};\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compile the shared extractor corpus into a TypeScript module."
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit 1 if the generated file is missing or stale; write nothing",
    )
    args = parser.parse_args()

    expected = render(load_corpus())

    if args.check:
        if not os.path.exists(TARGET):
            print(f"MISSING: {TARGET}", file=sys.stderr)
            return 1
        with open(TARGET, encoding="utf-8") as handle:
            actual = handle.read()
        if actual != expected:
            print(
                "STALE: extractor-parity-corpus.ts does not match "
                "tests/fixtures/extractor_parity/.\n"
                "Run: python3 scripts/generate_extractor_corpus.py",
                file=sys.stderr,
            )
            return 1
        print("OK: generated extractor corpus is up to date")
        return 0

    with open(TARGET, "w", encoding="utf-8") as handle:
        handle.write(expected)
    print(f"Wrote {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Run it once:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python scripts/generate_extractor_corpus.py
```

**8d. Create `tests/test_extractor_parity.py`:**

```python
"""Golden-corpus guard for the two case-metadata extractors.

`immi_case_downloader/sources/metadata_extractor.py` (Python) and
`workers/austlii-scraper/src/parser.ts` (TypeScript) extract the same fields
from the same case text. These tests pin the Python side to the corpus in
`tests/fixtures/extractor_parity/`; the Worker side is pinned by
`workers/austlii-scraper/src/__tests__/extractor-parity.test.ts` against the
generated mirror of that same corpus.

The expected values record today's behaviour, warts included. This is a parity
gate, not a quality gate — changing an expectation means changing what 149k
stored records mean.
"""

import json
import os
import subprocess
import sys

import pytest

from immi_case_downloader.sources.metadata_extractor import MetadataExtractor

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE_DIR = os.path.join(REPO_ROOT, "tests", "fixtures", "extractor_parity")
EXPECTED_PATH = os.path.join(FIXTURE_DIR, "expected.json")
GENERATOR = os.path.join(REPO_ROOT, "scripts", "generate_extractor_corpus.py")

# The Worker returns every key, defaulting to "", and calls Python's "citation"
# key "citation_extracted". Map the Python result onto that shape to compare.
_PLAIN_KEYS = (
    "judges",
    "date",
    "catchwords",
    "outcome",
    "visa_type",
    "legislation",
)


def _load_expected() -> dict:
    with open(EXPECTED_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def _to_worker_shape(result: dict) -> dict:
    shaped = {key: result.get(key, "") for key in _PLAIN_KEYS}
    shaped["citation_extracted"] = result.get("citation", "")
    return shaped


@pytest.mark.parametrize("name", sorted(_load_expected()))
def test_python_extractor_matches_golden_corpus(name):
    with open(os.path.join(FIXTURE_DIR, name), encoding="utf-8") as handle:
        text = handle.read()
    actual = _to_worker_shape(MetadataExtractor().extract(text))
    assert actual == _load_expected()[name]


def test_generated_worker_corpus_is_not_stale():
    result = subprocess.run(
        [sys.executable, GENERATOR, "--check"],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, (
        "extractor-parity-corpus.ts is stale. Run: "
        "python3 scripts/generate_extractor_corpus.py\n" + result.stderr
    )


def test_corpus_covers_the_judge_label_regressions():
    # These three fixtures are the cases where the TypeScript extractor used to
    # disagree with Python: an unanchored /JUSTICE/ dropped the title from
    # "BEFORE: Justice A Nguyen", and a bare /MEMBER|JUDGE/ matched prose.
    expected = _load_expected()
    assert expected["fca_judicial_review_dismissed.txt"]["judges"] == "Justice A Nguyen"
    assert expected["member_label_mid_line.txt"]["judges"] == ""
    assert expected["judge_label_mid_line.txt"]["judges"] == ""
```

**8e. Create `workers/austlii-scraper/src/__tests__/extractor-parity.test.ts`:**

```ts
import { describe, expect, it } from "vitest";

import { extractMetadata } from "../parser";
import { EXTRACTOR_PARITY_CASES } from "./extractor-parity-corpus";

describe("extractMetadata parity with the Python MetadataExtractor", () => {
  for (const testCase of EXTRACTOR_PARITY_CASES) {
    it(`matches the golden output for ${testCase.name}`, () => {
      expect(extractMetadata(testCase.text)).toEqual(testCase.expected);
    });
  }

  it("keeps the judicial title when the header uses a BEFORE label", () => {
    // Regression: an unanchored /JUSTICE/ alternative captured "A Nguyen"
    // instead of "Justice A Nguyen", splitting one judge into two rows in the
    // judge leaderboard depending on which scraper ingested the case.
    expect(extractMetadata("IN THE FEDERAL COURT\nBEFORE: Justice A Nguyen\n").judges).toBe(
      "Justice A Nguyen",
    );
  });

  it("does not treat the word MEMBER inside prose as a judge label", () => {
    expect(extractMetadata("The presiding MEMBER: Jane Doe made the decision.\n").judges).toBe("");
  });
});
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  .venv/bin/python scripts/generate_extractor_corpus.py --check && \
  .venv/bin/python -m pytest tests/test_extractor_parity.py -q -p no:cacheprovider --no-cov 2>&1 | tail -3 && \
  make lint && .venv/bin/ruff check tests/ 2>&1 | tail -1
```

→ `OK: generated extractor corpus is up to date`, then `6 passed`, then
`All checks passed!`, then still `Found 43 errors.`

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && \
  npm run typecheck && npm test 2>&1 | tail -3
```

→ typecheck exits 0 with no output; tests report
`Test Files 8 passed (8)` / `Tests 34 passed (34)`.

Finally, prove the TypeScript side would have failed **before** Step 7, by
temporarily reverting just the regex:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-/workers/austlii-scraper" && \
  cp src/parser.ts /tmp/parser.bak && \
  sed -i '' 's#/\^(?:BEFORE|JUDGE|JUSTICE|TRIBUNAL MEMBER)\[:\\s\]+(\[^\\n\]+)/im,#/(?:JUDGE|MEMBER|JUSTICE|TRIBUNAL MEMBER)[:\\s]+([^\\n]+)/i,#' src/parser.ts && \
  npm test 2>&1 | tail -4 ; \
  cp /tmp/parser.bak src/parser.ts && rm /tmp/parser.bak && npm test 2>&1 | tail -3
```

→ the first run fails 5 tests in `extractor-parity.test.ts`; after the restore,
`Test Files 8 passed (8)` / `Tests 34 passed (34)`. If the `sed` does not
change the file (check with `git diff --stat src/parser.ts` — it must show
`1 file changed`), skip this optional demonstration rather than hand-editing;
it is a confidence check, not a gate.

### Step 9: Correct the two doc lines that misdescribe ownership

In **both** `CLAUDE.md` and `AGENTS.md`, replace lines 91–92 — which are
byte-identical in the two files — from:

```
  visa_registry.py    → VISA_REGISTRY: canonical subclass→name→family lookup; used by
                        Worker proxy and Flask analytics for visa family grouping
```

to:

```
  visa_registry.py    → VISA_REGISTRY: subclass→name→family lookup for the Flask
                        analytics. The data lives in data/visa_registry.json — the
                        single source of truth; the Worker's copy at
                        workers/case-api/visa_registry.generated.js is generated
                        from it by scripts/generate_visa_registry.py. Edit the JSON,
                        then regenerate; tests/test_visa_registry_parity.py fails if
                        the generated file goes stale.
```

Change nothing else in either file. Several other lines in both are stale, but
they belong to a docs plan.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  grep -c "Worker proxy and Flask analytics" CLAUDE.md AGENTS.md ; \
  grep -c "single source of truth" CLAUDE.md AGENTS.md ; \
  diff <(sed -n '85,100p' CLAUDE.md) <(sed -n '85,100p' AGENTS.md) && echo "CLAUDE.md and AGENTS.md still agree"
```

→ `CLAUDE.md:0` and `AGENTS.md:0` for the first grep, `1` and `1` for the
second, then `CLAUDE.md and AGENTS.md still agree` with no diff output.

## Test plan

New tests, by file:

- `tests/test_visa_registry_parity.py` — 5 tests:
  1. the generated Worker module is not stale relative to the JSON source
     (runs `scripts/generate_visa_registry.py --check` as a subprocess);
  2. the parsed Worker table equals the Python `VISA_REGISTRY` exactly;
  3. **the 408 regression** — Python, `get_family()`, and the Worker copy all
     say `("Temporary Activity", "Visitor")`;
  4. `get_registry_for_api()` entries are canonically sorted and families match;
  5. every family referenced by an entry has a description.
- `workers/__tests__/visa-registry-parity.test.js` — 4 tests: entries match the
  JSON source in order, families match, raw lookup covers the same subclass set,
  and the 408 regression on the Worker side.
- `tests/test_extractor_parity.py` — 6 tests (4 parametrised over the corpus +
  the corpus-staleness check + a guard that the three judge-label regression
  fixtures are actually in the corpus).
- `workers/austlii-scraper/src/__tests__/extractor-parity.test.ts` — 6 tests
  (4 parametrised over the generated corpus + the `BEFORE: Justice …` and prose
  `MEMBER:` regressions).

Arithmetic to self-check against: **+11 Python tests** (5 + 6), so
`1141 → 1152 passed`; **+4 main-Worker tests**, so `345 → 349` across
`25 → 26` files; **+6 scraper-Worker tests**, so `28 → 34` across `7 → 8`
files. If your counts differ, you added or dropped a test — reconcile before
moving on.

Structural patterns to model on: `tests/test_scraper_protocol.py` for the
Python extractor tests; `workers/__tests__/cloudflare-native-entry.test.js` for
the `node:fs` + `fileURLToPath` idiom in the Worker test;
`workers/austlii-scraper/src/__tests__/discover.test.ts` for the scraper
Worker's extensionless-import style.

Full verification:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  make lint && \
  .venv/bin/python -m pytest tests/ --ignore=tests/e2e -q 2>&1 | tail -3 && \
  (cd workers && npx vitest run 2>&1 | tail -3) && \
  (cd workers/austlii-scraper && npm run typecheck && npm test 2>&1 | tail -3) && \
  node scripts/check_cloudflare_native_bundle.mjs
```

→ `All checks passed!`; Python `1152 passed, 3 failed, 7 skipped` (the 3 are the
pre-existing `pypdf`/`libexpat` environmental failures, unchanged); Worker
`Test Files 26 passed (26)` / `Tests 349 passed (349)`; scraper Worker
`Test Files 8 passed (8)` / `Tests 34 passed (34)`; bundle gate passes.

## Done criteria

Machine-checkable. ALL must hold (run from the repo root):

- [ ] `.venv/bin/python scripts/generate_visa_registry.py --check` exits 0
- [ ] `.venv/bin/python scripts/generate_extractor_corpus.py --check` exits 0
- [ ] `make lint` prints `All checks passed!`
- [ ] `.venv/bin/ruff check tests/ 2>&1 | tail -1` still reports `Found 43 errors.` (no increase)
- [ ] `.venv/bin/python -m pytest tests/ --ignore=tests/e2e -q 2>&1 | tail -1` reports `1152 passed, 3 failed, 7 skipped`
- [ ] `cd workers && npx vitest run 2>&1 | grep -q "Tests  349 passed (349)"`
- [ ] `cd workers/austlii-scraper && npm run typecheck` exits 0
- [ ] `cd workers/austlii-scraper && npm test 2>&1 | grep -q "Tests  34 passed (34)"`
- [ ] `node scripts/check_cloudflare_native_bundle.mjs` exits 0
- [ ] `grep -c '\["408", "Temporary Activity", "Visitor"\]' workers/case-api/visa_registry.generated.js` returns `1`
- [ ] `grep -rn '"408"' immi_case_downloader/visa_registry.py workers/case-api/static.js` returns **no matches** (both tables now come from the JSON)
- [ ] `grep -c '"family": "Skilled"' immi_case_downloader/data/visa_registry.json` returns `13` and `grep -c '"family": "Visitor"' immi_case_downloader/data/visa_registry.json` returns `7` (408 sits in the Visitor bucket, matching the Python table; the Worker's old copy had 14/6)
- [ ] `git diff --name-only 42826a3..HEAD -- workers/case-api/cloudflare.js immi_case_downloader/web/routes/api.py immi_case_downloader/web/routes/api_taxonomy.py Makefile workers/vitest.config.js` returns no output
- [ ] `grep -c "Worker proxy and Flask analytics" CLAUDE.md AGENTS.md` returns `0` for both
- [ ] `git status --porcelain` lists only files from the "In scope" list
- [ ] `plans/README.md` status row for plan 033 updated

## STOP conditions

Stop and report back (do not improvise) if:

- **The 408 diff is not the only registry difference.** After Step 1, running
  the comparison below must report exactly one difference. If it reports more,
  the tables drifted further after `42826a3` and the plan's single-correction
  premise is wrong:

  ```bash
  cd "/Users/d/Developer/Active Projects/IMMI-Case-" && \
  git show 42826a3:workers/case-api/static.js > /tmp/static_at_plan.js && \
  node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const js = readFileSync("/tmp/static_at_plan.js", "utf8");
  const block = js.split("const VISA_ENTRIES = [")[1].split("\n];")[0];
  const old = Object.fromEntries([...block.matchAll(/\["(\d+)", "([^"]*)", "([^"]*)"\]/g)].map(m => [m[1], [m[2], m[3]]]));
  const src = JSON.parse(readFileSync("immi_case_downloader/data/visa_registry.json", "utf8"));
  const now = Object.fromEntries(src.entries.map(e => [e.subclass, [e.name, e.family]]));
  const keys = new Set([...Object.keys(old), ...Object.keys(now)]);
  const diffs = [...keys].filter(k => JSON.stringify(old[k]) !== JSON.stringify(now[k]));
  console.log("differences:", JSON.stringify(diffs));
  '
  ```

  → must print `differences: ["408"]`.

- **Any file listed under "Out of scope" needs to change to make a step pass.**
  In particular, if `workers/case-api/cloudflare.js` needs editing after Step 4,
  your `static.js` rewrite changed an export name or shape — revert and redo it,
  do not edit `cloudflare.js`.
- **`cd workers && npx vitest run` drops below 345 pre-existing passing tests**
  (i.e. any of the original 345 starts failing). A new-file addition should only
  ever add tests.
- **`cd workers/austlii-scraper && npm run typecheck` fails.** The most likely
  cause is a Node builtin import in the new `.ts` test — that tsconfig has no
  Node types. Do not "fix" it by editing `workers/austlii-scraper/tsconfig.json`;
  plan 011 owns that file.
- **`.venv/bin/ruff check tests/` reports more than 43 errors.** Plan 003 owns
  that count and expects exactly 43; your new test files must be clean.
- **The Python full suite reports anything other than 3 failures**, or the
  failures are outside `tests/test_backfill_judge_overrides_from_pdf.py`.
- **You conclude that `Skilled`, not `Visitor`, is the correct family for
  subclass 408.** The three reasons in "Current state" are the whole basis for
  the direction of this fix; if you find a fourth source that contradicts them,
  the correct move is to report it, not to silently flip the JSON — this value
  changes a production analytics bucket.
- **You find yourself wanting to improve an extraction regex** rather than only
  aligning the TypeScript one to the Python one. That changes the meaning of
  149,016 stored records and is explicitly out of scope.

## Maintenance notes

For whoever owns this code next:

- **Adding a visa subclass is now a one-file edit plus one command.** Edit
  `immi_case_downloader/data/visa_registry.json`, run
  `python3 scripts/generate_visa_registry.py`, commit both files.
  `tests/test_visa_registry_parity.py` fails if you forget the regenerate step.
- **Two things a reviewer should scrutinise in this PR**: (1) the diff of
  `workers/case-api/visa_registry.generated.js` against the old inline
  `VISA_ENTRIES` array — it should show reordering plus exactly one value
  change (408 `Skilled` → `Visitor`); (2) that
  `workers/case-api/cloudflare.js` is untouched, since it is the only
  production consumer.
- **User-visible effect of the 408 fix**: any analytics grouping that reads
  `visaFamily()` in the Worker moves subclass-408 cases from the `Skilled`
  bucket to the `Visitor` bucket. This is intentional — it makes production
  agree with the Flask analytics — but it will show as a step change in
  family-grouped charts the day it deploys. `VISA_REGISTRY_RAW`'s key ordering
  and therefore `handleVisaLookup`'s result ordering are verified **unchanged**
  (V8 normalises integer-like keys either way), so search behaviour is not
  affected.
- **User-visible effect of the parser fix**: cases ingested by the cron-driven
  `austlii-scraper` Worker after this deploy will record judge names *with*
  their title (`Justice A Nguyen`), matching the Python scraper and the
  existing 149k-record corpus. Cases ingested by that Worker **before** this
  fix still carry title-stripped names. A backfill to reconcile them is not in
  this plan; if judge-leaderboard duplicates persist, that backfill is the
  follow-up.
- **Deliberately deferred, with evidence, so nobody re-audits them:**
  - `OUTCOME_MAP` (`workers/case-api/cloudflare.js:18-25`) vs `_OUTCOME_MAP`
    (`immi_case_downloader/web/routes/api.py:120-138`) — same 13 stem→label
    pairs, same documented ordering constraint. Verified **in agreement** at
    `42826a3`.
  - `TRIBUNAL_CODES` / `COURT_CODES` / `TRIBUNAL_WIN` / `COURT_WIN`
    (`cloudflare.js:51-55`) vs `api.py:140-144` — verified **in agreement**.
  - `LEGAL_CONCEPTS` (`workers/case-api/legal_concepts.js`, 37 lines) vs
    `immi_case_downloader/legal_concepts_registry.py` (310 lines) — compared
    programmatically at `42826a3`: 34 concepts each, zero value differences.

    All three are latent duplication rather than live drift, and all three
    would require editing `cloudflare.js` and `api.py`, which are owned
    elsewhere. The generator pattern established here
    (`scripts/generate_*.py` + a `--check` staleness test) is the template to
    reuse when someone does claim that territory.
- **If the extractors are ever collapsed into one implementation** (e.g. the
  scraper Worker calls a shared WASM/regex bundle), the corpus in
  `tests/fixtures/extractor_parity/` is what proves the collapse was
  behaviour-preserving. Keep it and grow it — every real parsing bug found in
  production should land there as a new fixture first.

## Findings reconsidered

- **"Add an `austlii-scraper` step to the Makefile's `test-workers` target so
  local matches CI" — real, but already owned by plan 002; dropped from this
  plan's steps.** The underlying gap is confirmed:
  `workers/vitest.config.js:11` sets `include: ["__tests__/**/*.test.js"]` with
  `root` at `workers/`, which cannot match
  `workers/austlii-scraper/src/__tests__/*.test.ts`, and `Makefile:70-71` runs
  only that config — so `make test` covers none of the 28 tests in that suite
  while `.github/workflows/ci.yml:104-106` runs them via a separate
  `npm test`. But `plans/002-fix-test-collection-and-install.md` Step 3 already
  adds a `test-pipeline` target and wires it into `test:`, with a verification
  of `Test Files 7 passed (7)`. Duplicating it here would produce a guaranteed
  `Makefile` conflict. Recorded as this plan's soft dependency instead.

- **"Align the vitest/wrangler majors between the root and `austlii-scraper`"
  — rejected, and it is not needed for the parity work.** The divergence is
  real (`workers/austlii-scraper/package.json:13-20`: `vitest ^4.1.8`,
  `wrangler ^4.98.0`, plus its own `postgres` dep, versus the root's
  `vitest ^2.0.0`). Plan 002 already evaluated the reconciliation and rejected
  it: unifying the runners means migrating the 345-test main Worker suite from
  Vitest 2 to 4 as a side effect of a DX fix. The extractor parity test added
  in Step 8 runs fine under Vitest 4 in its own package, so nothing here needs
  the alignment.

- **"Case metadata extraction exists in a *third* implementation" — corrected
  to two.** `workers/austlii-scraper/src/parser.ts:245` does say "Ported from
  `austlii.py:_extract_metadata()`", but `immi_case_downloader/sources/austlii.py:346-357`
  is now a five-line delegate (`self._metadata_extractor.extract(text, citation=...)`)
  and `federal_court.py:246` likewise. The regexes live in exactly one Python
  module, `metadata_extractor.py`. Step 7 corrects the stale comment. The
  finding's substance — that a fix on one side never reaches the other, with no
  shared corpus to catch it — is real and is addressed by Step 8.

- **"visa_registry.py is documented as the Worker's lookup source" — confirmed,
  and fixed at the root rather than only in prose.** The finding offered two
  options: correct the doc to admit the duplication, or remove the duplication
  so the doc can go back to naming a single source. This plan takes the second,
  and Step 9 rewrites the doc to describe the generated arrangement. Note the
  doc was wrong in a second way the finding flagged: "Worker proxy" refers to
  `workers/proxy.js`, deleted in commit `f91f45f`.

- **"Treat 'should the Flask analytics endpoints exist at all' as a separate,
  explicitly recorded decision" — recorded here, not decided.** The Flask app
  is local-dev only and not in the production request path, so
  `immi_case_downloader/web/routes/api.py` and `api_taxonomy.py` are the only
  remaining consumers of the Python registry. Whether they should be retired is
  a product/architecture call for the operator, not a refactor this plan can
  make. Nothing in this plan depends on the answer: if those endpoints are
  deleted later, the JSON source of truth and the generator survive unchanged,
  and only `tests/test_visa_registry_parity.py`'s Python-side assertions would
  need trimming.
