# Plan 051: Spike — decide how judge identity gets fixed before wiring the normaliser into production

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index. (`plans/README.md` does not exist at
> the time of writing; do **not** create it.)
>
> **Drift check (run first)**. A committed-history diff cannot see uncommitted,
> staged or untracked work, so all four commands must run:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> SCOPE=(docs/adr/0051-judge-identity.md immi_case_downloader/normalize_judge_names.py tests/test_judge_normalization.py workers/storage/cloudflare.js)
> git status --short --branch
> git diff --stat 42826a3..HEAD -- "${SCOPE[@]}"     # committed since the plan was written
> git diff --stat -- "${SCOPE[@]}"                   # unstaged
> git diff --cached --stat -- "${SCOPE[@]}"          # staged
> ```
> Expected: the last three print nothing and no in-scope path appears in
> `git status` — `docs/adr/` merely existing (because
> `plans/044-retire-the-stale-planning-docs.md` owns and created it) is fine.
> **`tests/test_judge_normalization.py` appearing is a hard STOP**: it is shared
> with `plans/003-lint-the-test-suite.md`, which must land first (see "Depends
> on"). For any other in-scope path, compare the "Current state" excerpts
> against the live code and report. **Never** run `git checkout --` or
> `git clean -f` to force a clean tree — the uncommitted work is the operator's.
>
> **This is a decision/spike plan.** The main deliverable is a written
> Architecture Decision Record. There are exactly three small code changes
> (Steps 3, 4 and 5) and they are all local, reversible, and non-behavioural
> in production. Do **not** expand beyond them. In particular: this plan
> performs **no** database mutation of any kind — no `UPDATE`, no `DELETE`,
> no migration, no bulk merge. If you find yourself writing SQL that changes
> rows, you have left the plan.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/003-lint-the-test-suite.md` (which itself depends on
  `plans/002-fix-test-collection-and-install.md` → `plans/001-restore-the-frontend-compile-gate.md`).
  **Ordering constraint, not a preference.**
- **Category**: direction
- **Planned at**: commit `42826a3`, 2026-08-27

> **Why 003 must land first.** Step 4 of this plan appends seven test methods to
> `tests/test_judge_normalization.py`. `plans/003-lint-the-test-suite.md` edits
> that same file — it removes the unused `import pytest` (F401) that is one of
> the pre-existing ruff errors under `tests/`. Two agents editing the same file
> in parallel is a merge conflict, and an earlier draft of this plan tried to
> avoid it by simply declaring "do not fix the F401" — which prevents *this*
> plan from touching that line but does nothing about 003 touching the file
> underneath it. Sequence instead: let the normalisation-lint owner finish 003,
> then rebase this plan onto it and append the limitation tests. If you reach
> Step 4 and the drift check shows `tests/test_judge_normalization.py` has
> uncommitted or unmerged changes, STOP.
>
> Everything else here is independent: this plan touches no TypeScript and no
> frontend file, so it does not need `plans/001`'s compile gate for its own
> sake (only transitively, through 003). It shares two files with
> `plans/036-bound-the-python-dependencies.md` only by mention — 036 edits
> `requirements-app.txt` comments and explicitly states it does **not** modify
> `immi_case_downloader/normalize_judge_names.py` or
> `tests/test_judge_normalization.py`.

## Why this matters

The judge leaderboard is the most-cited "authority" surface in this product,
and its top row is not a person. Measured live against
`https://immi.trackit.today` on 2026-08-28, `/api/v1/analytics/judge-leaderboard`
returns 15,254 judges of whom **#1 is the literal string `"DATE"` with 2,409
cases and an 11% approval rate**, rendered with courts, active years and visa
breakdown exactly like a real judge. It is not an isolated artifact: at least
906 rows contain "tribunal", 242 contain "whether", and the corpus includes
entries such as `'MIGRATION - business skills visa - cancellation - whether
eligible'` and `'THE TRIBUNAL'` (119 cases) — sentence fragments from case
catchwords, each attributed a case count and an approval rate.

Meanwhile `immi_case_downloader/normalize_judge_names.py` — 190 lines, 16
passing tests — has existed since before this repository's Cloudflare
migration and is imported by nothing except its own test file. The obvious
next move ("just wire it into the Worker") is the wrong one, and this plan
exists to prove that in writing before somebody spends a week on it. Applied
naively to live data, that normaliser folds `Alison Murphy` and `Jade Murphy`
into one judge — they are two different tribunal members, both listed
separately in this repo's own curated `judge_name_overrides.json` — and it
turns `Michael Cooke (NSW)` into the surname `"nsw"`.

After this plan lands there is (a) an evidence-backed ADR that says which
fix comes first, what the canonical seed set is, and why the fuzzy tier is
rejected, (b) one real correctness bug fixed in the normaliser with tests,
and (c) a pointer in the production code at the exact line where judge
identity is minted, so the next person finds the decision instead of
rediscovering the problem.

## Current state

### The files that matter

- `immi_case_downloader/normalize_judge_names.py` — 190 lines. Defines
  `normalize_judge_name` (line 15), `find_duplicate_judges` (line 95) and
  `merge_judge_records` (line 152). **Not imported by any production code.**
- `tests/test_judge_normalization.py` — 153 lines, 16 tests, all passing. The
  module's only consumer.
- `workers/storage/cloudflare.js` — 1,905 lines. The D1 access layer. Contains
  `normaliseRelationLabels` (line 220) and the two places where a `judge_id`
  is minted (lines 914 and 1247).
- `workers/case-api/cloudflare.js` — the production read handlers, including
  the judge leaderboard (`analyticsJudgeAggregate` consumer, lines ~879–926).
- `migrations/d1/catalog/0001_catalog.sql` — the `judges` and `aggregate_judge`
  schema.
- `immi_case_downloader/data/judge_name_overrides.json` — 20 KB, 490
  human-curated `alias → full name` entries built from judge bios plus
  official FCFCOA / Federal Court listings. **Read only by Flask, which is
  local-dev only.**
- `immi_case_downloader/web/routes/api.py` — Flask analytics, local-dev only.
  Contains `_NAME_DISQUALIFIERS` (line 177) and `_is_real_judge_name`
  (line 207).
- `docs/JUDGE_DATA_QUALITY.md` — 332 lines. The 2026-05-02 post-mortem.

### The normaliser is not wired into anything

A repo-wide grep (excluding `node_modules/`, `.venv/`, `.git/`,
`downloaded_cases/`) for `normalize_judge_name`, `find_duplicate_judges` and
`merge_judge_records` returns hits in exactly three places: the module itself,
`tests/test_judge_normalization.py`, and prose inside `plans/*.md`. No Worker
file, no route, no script imports it.

`immi_case_downloader/normalize_judge_names.py:1-15` (verbatim):

```python
"""Judge name normalization and deduplication utilities."""

import re
from typing import Dict, List, Optional
from fuzzywuzzy import fuzz

# Titles to strip (case-insensitive)
_TITLE_PATTERN = re.compile(
    r"\b(Justice|Hon\.?|Judge|Mr\.?|Ms\.?|Mrs\.?|Dr\.?|ACJ|FCA|"
    r"Senior\s+Member|Deputy\s+President|Member|President)\b\.?\s*",
    re.IGNORECASE,
)


def normalize_judge_name(name: Optional[str]) -> str:
```

`immi_case_downloader/normalize_judge_names.py:44-45` (verbatim) — the two
lines Step 3 edits:

```python
    # Remove titles
    cleaned = _TITLE_PATTERN.sub("", name).strip()
```

### `docs/JUDGE_DATA_QUALITY.md:322-329` (verbatim) — the deferred work

```markdown
- Wire `normalize_judge_names` into the **Cloudflare Worker** judge
  analytics handlers (`workers/proxy.js`: `handleAnalyticsJudges`,
  `handleAnalyticsJudgeProfile`, `handleAnalyticsJudgeLeaderboard`,
  `handleAnalyticsJudgeCompare`, `handleAnalyticsJudgeBio`) — these
  are the production read path, not Flask. Persist `judge_canonical_id`
  via Supabase migration. (F production integration)
```

That paragraph is **stale in two ways** and the ADR must say so: `workers/proxy.js`
was deleted (commit `f91f45f`) and there is no Supabase in the production path
— the judge tables live in D1 (`migrations/d1/catalog/0001_catalog.sql`).

### Production mints one judge per raw label

`workers/storage/cloudflare.js:220-232` (verbatim) — the **only** judge-name
processing in production. Note it is shared with legal concepts, so it must
not be given judge-specific behaviour:

```javascript
function normaliseRelationLabels(value, field) {
  const raw = Array.isArray(value) ? value : [value];
  const labels = raw
    .flatMap((item) => String(item ?? "").split(/[;,]/))
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (labels.some((label) => label.length > 256)) {
    throw new StorageBoundaryError(`${field} label exceeds 256 characters`, {
      code: "invalid_relation_label",
      status: 400,
    });
  }
  return [...new Set(labels)].slice(0, 100);
}
```

Its four call sites are lines 911 and 922 (`updateCaseFields`) and 1243 and
1244 (`putImportedCase`); two are `"judge"`, two are `"legal concept"`.

`workers/storage/cloudflare.js:910-919` (verbatim) — identity is a hash of the
**raw** label, so every spelling variant is a separate judge:

```javascript
    if (Object.prototype.hasOwnProperty.call(updates, "judges")) {
      const labels = normaliseRelationLabels(updates.judges, "judge");
      relationStatements.push(this.db.prepare("DELETE FROM case_judges WHERE case_id = ?").bind(id));
      for (const label of labels) {
        const judgeId = (await sha256Hex(`judge:${label.toLocaleLowerCase("en-AU")}`)).hex.slice(0, 32);
        relationStatements.push(
          this.db.prepare("INSERT OR IGNORE INTO judges (judge_id, canonical_name, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(judgeId, label, now, now),
          this.db.prepare("INSERT OR IGNORE INTO case_judges (case_id, judge_id) VALUES (?, ?)").bind(id, judgeId),
        );
      }
    }
```

`workers/storage/cloudflare.js:1243-1247` (verbatim) — the same derivation in
the bulk-import path:

```javascript
    const judgeLabels = normaliseRelationLabels(record.judges, "judge");
    const conceptLabels = normaliseRelationLabels(record.legal_concepts, "legal concept");
    const judgeStatements = [this.db.prepare(`DELETE FROM case_judges WHERE case_id = ?`).bind(caseId)];
    for (const label of judgeLabels) {
      const judgeId = (await sha256Hex(`judge:${label.toLocaleLowerCase("en-AU")}`)).hex.slice(0, 32);
```

### The read path applies no filter at all

`workers/case-api/cloudflare.js:915-916` (verbatim) — the leaderboard's only
filter is a case-count floor and a substring match. Nothing rejects garbage,
nothing normalises:

```javascript
  let result = [...judges.values()]
    .filter((judge) => judge.total >= minCases && (!nameQ || judge.name.toLowerCase().includes(nameQ)))
```

`workers/case-api/cloudflare.js:880` (verbatim) — **a gotcha you need for
Step 1**: `name_q` is trimmed server-side, so a probe cannot rely on
surrounding spaces (`name_q=%20the%20` is received as `the` and matches
"Ca**the**rine"):

```javascript
  const nameQ = (url.searchParams.get("name_q") || "").trim().toLowerCase();
```

### `migrations/d1/catalog/0001_catalog.sql:85-90` and `:158-165` (verbatim)

```sql
CREATE TABLE IF NOT EXISTS judges (
  judge_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  -- Stable source identity makes every legacy judge_bios row reconcilable
  -- without relying on a display-name match.
  source_bio_id TEXT UNIQUE,
```

```sql
CREATE TABLE IF NOT EXISTS aggregate_judge (
  judge_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (judge_id) REFERENCES judges(judge_id)
);
CREATE INDEX IF NOT EXISTS aggregate_judge_name_idx ON aggregate_judge(canonical_name COLLATE NOCASE);
```

There is **no** `judge_canonical_id` column anywhere. `canonical_name` is
`NOT NULL UNIQUE` — it is the raw label, and it is what the SPA displays.

### Flask has a garbage filter; production does not; and it misses `DATE`

`immi_case_downloader/web/routes/api.py:207-213` (verbatim):

```python
def _is_real_judge_name(name: str) -> bool:
    """Return True only if name looks like an actual person's name."""
    words = name.split()
    # Allow longer forms for full names with titles/nicknames/post-nominals.
    if not words or len(words) > 8:
        return False
    if any(not re.fullmatch(r"[A-Za-z][A-Za-z'.-]*\.?", w) for w in words):
        return False
```

Measured locally at `42826a3` with `.venv/bin/python`:

| input | `_is_real_judge_name` |
|---|---|
| `'of'` | `False` |
| `'the'` | `False` |
| `'of the'` | `False` |
| `'DATE'` | **`True`** |
| `'KENDALL'` | `True` |
| `'EGAN'` | `True` |

`_NAME_DISQUALIFIERS` (api.py:177-188) has no `"date"` entry, so even the
local-dev filter would pass the #1 garbage row through. This is a real result
for the ADR, not a defect to fix here — Flask is not in the production path.

### The measured behaviour of the normaliser on live labels

Measured locally at `42826a3`:

| input | `normalize_judge_name` |
|---|---|
| `'Justice Smith'` | `'smith'` |
| `'SMITH J'` | `'smith'` |
| `'Nicholls'` | `'nicholls'` |
| `'Louise Nicholls'` | `'nicholls'` |
| `'Alison Murphy'` | `'murphy'` |
| `'Jade Murphy'` | `'murphy'` |
| `'Michael Cooke (NSW)'` | **`'nsw'`** |
| `'DATE'` | `'date'` |

Two facts fall out and both belong in the ADR:

1. **A real bug.** Bracketed qualifiers become the surname. `'Brown [2019]'`
   → `'2019'`; `'Kirk (Member)'` → `''`. `Michael Cooke (NSW)` exists in live
   production as a row distinct from `Michael Cooke` (1,170 cases), and is
   named in `CLAUDE.md` and `docs/JUDGE_DATA_QUALITY.md:21` as a legitimate
   name that a previous cleanup false-positived on. Step 3 fixes this.
2. **Naive surname folding produces false merges.** `Alison Murphy` and
   `Jade Murphy` are different people — this repo's own
   `judge_name_overrides.json` lists `'a murphy': 'Alison Murphy'` and
   `'j murphy': 'Jade Murphy'` separately.

### Repo conventions that apply here

- **Commit format** — `<type>: <description>`, type ∈
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Example from `git log`: `fix: install root node_modules in make install`.
- **Python** — always use the repo venv: `.venv/bin/python`,
  `.venv/bin/pytest`, `.venv/bin/ruff`. Never global `pip`, never
  `python3 -m pip`.
- **Python lint.** At `42826a3`, `make lint` runs
  `ruff check immi_case_downloader/ scripts/ *.py`; after `plans/001` Step 3 it
  becomes `lint: lint-py lint-fe` and also runs ESLint. Use the explicit
  `.venv/bin/ruff check immi_case_downloader/ scripts/ *.py` (or `make lint-py`
  once it exists) so this plan's gate cannot fail on a frontend problem it did
  not cause. Either way the Python path list does **not** cover `tests/`, which
  has pre-existing ruff errors owned by `plans/003-lint-the-test-suite.md` —
  including the unused `import pytest` (F401) at
  `tests/test_judge_normalization.py:3`, confirmed live with
  `.venv/bin/ruff check tests/test_judge_normalization.py`. **Do not fix it.**
  Note this is not merely "another plan's territory": 003's Step 6 runs
  `ruff check --fix tests/`, which *will* rewrite that exact line, and its
  Scope explicitly claims "any other file under `tests/**/*.py` touched only by
  `ruff check --fix`". That is the concrete shared edit behind this plan's
  `Depends on: plans/003` — see the Status note.
- **Production data cleanup rule** (`CLAUDE.md`, quoted because you have not
  read it): "Before ANY bulk UPDATE/DELETE on … mixed-content fields like
  `judges`: (1) `ALTER TABLE … ADD COLUMN <col>_backup text` … first — gives
  sub-second rollback; (2) dry-run on `LIMIT 100` and **eyeball** matches
  against ground-truth … pattern-shape garbage rules have ~10–15%
  false-positive rate on legitimate names like `Michael Cooke (NSW)` /
  `general member cosgrave`". This plan performs no bulk mutation, and the
  ADR must carry this constraint forward to whoever does.
- **Worker tenant isolation** is app-layer via
  `CloudflareIdentityStore.assertMembership()`; there is no Postgres and no
  RLS. `env.IMMI_CATALOG_DB` / `IMMI_ACCOUNT_DB` / `IMMI_OPS_DB` are D1
  bindings. Any ADR sentence about "the database" means D1.
- **ADR numbering is centrally assigned, not chosen by the executor.**
  `plans/044-retire-the-stale-planning-docs.md` **owns** `docs/adr/` — the
  directory, `README.md`, `TEMPLATE.md` and ADRs 0001–0003. Every other plan
  creates exactly one file named after its own plan number. **This plan's file
  is `docs/adr/0051-judge-identity.md`.** Do not create an index, do not append
  to one, and do not renumber another plan's ADR. (An earlier draft used
  `0004` and wrote its own `README.md` "only if absent"; three sibling plans
  were doing the same thing with different numbers, which is what forced
  central assignment.)

## Commands you will need

**Record baselines first; assert deltas, not absolute suite totals.** Sibling
plans add tests in parallel, so any total written here is stale on arrival:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
make test-py 2>&1 | tail -1                            # -> PY_BEFORE
make test-py 2>&1 | grep -E "^(FAILED|ERROR)" | sort   # -> PY_FAIL_BEFORE (named failures)
(cd workers && npx vitest run 2>&1 | tail -3)          # -> WK_BEFORE
```

| Purpose | Command | Expected on success |
|---|---|---|
| Drift check | see the four-command block at the top of this file | no in-scope path in any of them |
| Judge unit tests | `.venv/bin/pytest tests/test_judge_normalization.py -q` | `16 passed` before Step 4, `23 passed` after. This is a **per-file** count and is the number to assert on — only this plan and `plans/003` touch this file, and 003 removes an import, not a test |
| Full Python suite | `make test-py` | passed count = `PY_BEFORE + 7`; the failure set identical to `PY_FAIL_BEFORE`. Record both before you start — do **not** assert an absolute total, sibling plans move it |
| Python lint | `.venv/bin/ruff check immi_case_downloader/ scripts/ *.py` | `All checks passed!` (spelled out rather than `make lint`: `plans/001` Step 3 turns `lint:` into `lint: lint-py lint-fe`) |
| Worker syntax | `node --check workers/storage/cloudflare.js` | exit 0, no output |
| Worker tests | `cd workers && npx vitest run` | `WK_BEFORE` passed, **unchanged** (Step 5 adds comments only), 0 failed |
| Live read (safe) | `curl -s --max-time 90 "https://immi.trackit.today/api/v1/analytics/judge-leaderboard?limit=10&sort_by=cases"` | HTTP 200 JSON |

Every `curl` in this plan is a **GET against a public read endpoint**. Do not
issue POST/PUT/DELETE against production for any reason.

## Scope

**In scope** (the only files you may modify):

- `docs/adr/0051-judge-identity.md` — create.
- `immi_case_downloader/normalize_judge_names.py` — one bug fix + one docstring.
- `tests/test_judge_normalization.py` — add 7 tests. Do not touch its imports.
  **Shared with `plans/003`, which must land first — see "Depends on".**
- `workers/storage/cloudflare.js` — exactly two comment lines in the judge
  region (above lines 911 and 1243). No behaviour change.

**Out of scope** (do NOT touch, even though they look related):

- **Any database mutation.** No `UPDATE`, `DELETE`, migration, or backfill
  against D1, SQLite or any CSV. The garbage rows stay exactly where they are;
  this plan decides *how* they get removed, it does not remove them.
- `migrations/d1/catalog/0001_catalog.sql` — adding `judge_canonical_id` is
  the *next* plan's job and needs a deploy window. Describe it in the ADR;
  do not write it.
- `workers/case-api/cloudflare.js` — the leaderboard read path. Changing the
  filter here changes what 15,254 rows look like to users with no rollback
  story. The ADR decides the approach first.
- `normaliseRelationLabels` in `workers/storage/cloudflare.js` (line 220) —
  it is shared with `legal_concepts` (call sites 922 and 1244). Do not add
  judge-specific rules to it.
- `immi_case_downloader/web/routes/api.py`, `_NAME_DISQUALIFIERS`,
  `_is_real_judge_name` — Flask is local-dev only; changing it fixes nothing
  a user sees, and `plans/028` and `plans/034` both own that file.
- `frontend/` — no UI change. The leaderboard renders whatever the API sends.
- The `fuzzywuzzy` → `rapidfuzz` swap — recorded and deliberately dropped by
  `plans/036-bound-the-python-dependencies.md`.
- The pre-existing ruff F401 in `tests/test_judge_normalization.py` — owned by
  `plans/003-lint-the-test-suite.md`.
- The 3 environmental `make test-py` failures in
  `tests/test_backfill_judge_overrides_from_pdf.py` (Homebrew Python 3.14.7
  `pyexpat`/`libexpat` ABI mismatch breaking the `pypdf` import). Not caused
  by repo code, not yours to fix.

## Git workflow

- Branch: `advisor/051-judge-identity`
- Commit per logical unit; suggested messages:
  - `fix: stop bracketed qualifiers becoming the judge surname`
  - `test: cover bracketed qualifiers in judge normalisation`
  - `docs: point the D1 judge_id derivation at ADR 0051`
  - `docs: record the judge identity decision as ADR 0051`
- Do **not** push, open a PR, or merge. The operator commits.

## Steps

### Step 1: Reproduce the live measurement

The ADR must carry current numbers, not this plan's. Run these five read-only
requests and record every value; you will paste them into Step 7.

```bash
# 1. Headline: total judges and the top of the leaderboard.
curl -s --max-time 90 "https://immi.trackit.today/api/v1/analytics/judge-leaderboard?limit=10&sort_by=cases" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('total_judges',d['total_judges']); [print(f\"{j['name']!r} cases={j['total_cases']} approval={j['approval_rate']}\") for j in d['judges']]"

# 2..4. Prose contamination lower bounds. NOTE: name_q is .trim()ed
# server-side (workers/case-api/cloudflare.js:880), so probes must be single
# words with no spaces — a probe like " the " degrades to "the" and matches
# "Catherine".
for q in tribunal whether minister; do
  printf "%-10s " "$q"
  curl -s --max-time 90 "https://immi.trackit.today/api/v1/analytics/judge-leaderboard?limit=1&name_q=$q" \
    | python3 -c "import json,sys; print(json.load(sys.stdin)['total_judges'])"
done

# 5. Evidence sample: what those rows actually contain.
curl -s --max-time 90 "https://immi.trackit.today/api/v1/analytics/judge-leaderboard?limit=6&sort_by=cases&name_q=tribunal" \
  | python3 -c "import json,sys; [print(f\"cases={j['total_cases']:>4} {j['name'][:80]!r}\") for j in json.load(sys.stdin)['judges']]"
```

Reference values measured on 2026-08-28 (yours will differ slightly as the
corpus grows; that is expected and fine):

- `total_judges` = 15254; row 1 = `'DATE'`, 2409 cases, approval 11,
  courts `['AATA','FCA']`
- `tribunal` → 906, `whether` → 242, `minister` → 132
- sample: `'THE TRIBUNAL'` 119 cases, `'REFUGEE REVIEW TRIBUNAL'` 36 cases,
  `'the Tribunal.'` 36 cases

**Verify**: request 1 prints `total_judges` and 10 rows; requests 2–4 each
print an integer ≥ 100; request 5 prints 6 rows that are visibly sentence
fragments, not names. If the first request returns HTTP ≠ 200 or the top row
is a plausible human name, that is a STOP condition.

### Step 2: Confirm the normaliser's current behaviour locally

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -c "
import sys; sys.path.insert(0,'.')
from immi_case_downloader.normalize_judge_names import normalize_judge_name as N
for s in ['Michael Cooke (NSW)','Brown [2019]','Kirk (Member)','Alison Murphy','Jade Murphy','DATE']:
    print(repr(s),'->',repr(N(s)))
" 2>/dev/null
```

**Verify**: output is exactly

```
'Michael Cooke (NSW)' -> 'nsw'
'Brown [2019]' -> '2019'
'Kirk (Member)' -> ''
'Alison Murphy' -> 'murphy'
'Jade Murphy' -> 'murphy'
'DATE' -> 'date'
```

If `'Michael Cooke (NSW)'` already returns `'cooke'`, the bug is fixed and
Steps 3–4 are already done — skip to Step 5 and note it in your report.

### Step 3: Fix the bracketed-qualifier bug

Edit `immi_case_downloader/normalize_judge_names.py`.

**3a.** Insert a new module-level constant immediately **above** the line
`def normalize_judge_name(name: Optional[str]) -> str:` (currently line 15),
separated from the `_TITLE_PATTERN` block by one blank line and from the
`def` by two blank lines:

```python
# Bracketed qualifiers such as "(NSW)", "[2019]" or "(Deputy President)"
# would otherwise survive title-stripping and be taken as the surname.
#
# The two alternatives are deliberate: a character-class form like
# `[(\[][^)\]]*[)\]]` also matches MISMATCHED pairs — "(foo]" and "[foo)" —
# because a character class has no notion of pairing. Unbalanced fragments
# such as "to order the Minister to answer interrogatories (see" exist in live
# data; they are garbage rows for the extraction fix to remove, not names to
# normalise, so this pattern must leave them alone rather than silently eat
# half of one.
_BRACKET_PATTERN = re.compile(r"\([^)]*\)|\[[^\]]*\]")
```

**3b.** Replace these two lines (currently 44–45):

```python
    # Remove titles
    cleaned = _TITLE_PATTERN.sub("", name).strip()
```

with:

```python
    # Drop bracketed qualifiers first: "Michael Cooke (NSW)" -> "Michael Cooke".
    # Without this the bracket contents become the surname (-> "nsw").
    cleaned = _BRACKET_PATTERN.sub(" ", name)

    # Remove titles
    cleaned = _TITLE_PATTERN.sub("", cleaned).strip()
```

Note the substitution target changed from `name` to `cleaned` on the
`_TITLE_PATTERN` line — that is required, not a typo.

**3c.** Extend the module docstring on line 1 so the next reader does not
repeat the mistake this plan exists to prevent. Replace line 1:

```python
"""Judge name normalization and deduplication utilities."""
```

with:

```python
"""Judge name normalization and deduplication utilities.

NOT WIRED INTO PRODUCTION, AND NOT SAFE TO WIRE IN AS-IS.

`normalize_judge_name` reduces a label to a bare surname, so it merges
distinct people who share one: "Alison Murphy" and "Jade Murphy" both
become "murphy". Measured against the live leaderboard on 2026-08-28, 6 of
the 16 surname collisions it creates in the top 200 judges are different
people. Do not use it to merge judge records without a human-reviewed
alias file gating every merge.

See docs/adr/0051-judge-identity.md for the decision and the ordering of
the work that has to happen first.
"""
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -c "
import sys; sys.path.insert(0,'.')
from immi_case_downloader.normalize_judge_names import normalize_judge_name as N
ok = (N('Michael Cooke (NSW)')=='cooke' and N('Brown [2019]')=='brown'
      and N('Kirk (Member)')=='kirk' and N('Justice John Smith')=='smith'
      and N('SMITH J')=='smith' and N(\"O'Brien\")=='obrien'
      and N('Müller')=='muller' and N(None)=='' and N('')==''
      # Mismatched delimiters must NOT be stripped — this is what separates
      # the alternation from the character-class form.
      and N('Cooke (foo]')=='foo' and N('Cooke [foo)')=='foo')
print('PASS' if ok else 'FAIL')
" 2>/dev/null && .venv/bin/ruff check immi_case_downloader/ scripts/ *.py
```
→ prints `PASS`, then `All checks passed!`. (All eleven expectations were run
against the patched function before this plan was written; if the two
mismatched-delimiter cases return `''` instead of `'foo'`, you transcribed the
character-class regex rather than the alternation.)

### Step 4: Add tests for the fix

Append a new test method to the `TestNormalizeJudgeName` class in
`tests/test_judge_normalization.py`, after `test_none_input` (line 47). Match
the file's existing style: a docstring, then plain `assert` statements.

```python
    def test_strips_bracketed_qualifiers(self):
        """Bracketed qualifiers must not become the surname"""
        assert normalize_judge_name("Michael Cooke (NSW)") == "cooke"
        assert normalize_judge_name("Brown [2019]") == "brown"
        assert normalize_judge_name("Kirk (Member)") == "kirk"
        assert normalize_judge_name("Smith (Deputy President)") == "smith"

    def test_bracket_only_input(self):
        """A label that is nothing but brackets normalises to empty"""
        assert normalize_judge_name("(NSW)") == ""
        assert normalize_judge_name("[2019]") == ""

    def test_mismatched_delimiters_are_not_treated_as_brackets(self):
        """Only balanced pairs are stripped.

        A character-class pattern like `[(\\[][^)\\]]*[)\\]]` matches "(foo]"
        and "[foo)" too, because a character class cannot pair delimiters. The
        alternation form does not. Mismatched and unclosed fragments come from
        catchword prose, not from names — they are rows for the extraction fix
        (ADR 0051 follow-up 1) to remove, and this module must leave them
        recognisably intact rather than silently eating half of one.
        """
        assert normalize_judge_name("Cooke (foo]") == "foo"
        assert normalize_judge_name("Cooke [foo)") == "foo"

    def test_unclosed_bracket_is_left_alone(self):
        """Verified against live data: this exact shape exists in the corpus."""
        assert normalize_judge_name(
            "to order the Minister to answer interrogatories (see"
        ) == "see"

    def test_distinct_people_sharing_a_surname_collide(self):
        """Documented limitation: surname folding merges different people.

        This is why the module must not drive a merge without an alias file.
        See docs/adr/0051-judge-identity.md.
        """
        assert normalize_judge_name("Alison Murphy") == normalize_judge_name("Jade Murphy")

    def test_garbage_labels_are_not_rejected(self):
        """Documented limitation: the normaliser is not a garbage filter."""
        assert normalize_judge_name("DATE") == "date"
        assert normalize_judge_name("THE TRIBUNAL") == "tribunal"

    def test_full_name_and_surname_only_agree(self):
        """The one genuine split observed live in the top 200 judges"""
        assert normalize_judge_name("Louise Nicholls") == normalize_judge_name("Nicholls")
```

Do **not** add or remove any import in this file.

**Verify**: `.venv/bin/pytest tests/test_judge_normalization.py -q 2>&1 | tail -2`
→ contains `23 passed` (16 existing + 7 new)

### Step 5: Point the production judge_id derivation at the ADR

Two comment insertions in `workers/storage/cloudflare.js`. No behaviour change.

**5a.** Immediately **above** the line

```javascript
      const labels = normaliseRelationLabels(updates.judges, "judge");
```

insert (matching its 6-space indentation):

```javascript
      // judge_id is a hash of the RAW label, so every spelling variant and
      // every prose fragment becomes a separate judge. See docs/adr/0051-judge-identity.md.
```

**5b.** Immediately **above** the line

```javascript
    const judgeLabels = normaliseRelationLabels(record.judges, "judge");
```

insert (matching its 4-space indentation):

```javascript
    // judge_id is a hash of the RAW label, so every spelling variant and
    // every prose fragment becomes a separate judge. See docs/adr/0051-judge-identity.md.
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/storage/cloudflare.js \
  && grep -c "docs/adr/0051-judge-identity.md" workers/storage/cloudflare.js \
  && git diff --numstat workers/storage/cloudflare.js
```
→ `node --check` exits 0 with no output; `grep -c` prints `2`; `git diff
--numstat` shows `4  0  workers/storage/cloudflare.js` (4 lines added, **0
deleted** — if any line was deleted you have edited code, which is out of
scope).

### Step 6: Make the ADR directory available (no index file)

```bash
mkdir -p docs/adr
```

That is the whole step. **Do not create or edit `docs/adr/README.md` or
`docs/adr/TEMPLATE.md`.** ADR numbering is centrally assigned:
`plans/044-retire-the-stale-planning-docs.md` **owns** `docs/adr/` — the
directory, the index, the template, and ADRs 0001–0003. This plan's assigned
file is `docs/adr/0051-judge-identity.md` and nothing else. An earlier draft
of this plan created its own `README.md` "only if absent" and claimed `0004`;
three sibling plans had the same idea with different numbers, which is what
forced central assignment. The directory already existing is the normal case,
not a STOP condition.

**Verify**:
```bash
test -d docs/adr && git status --short -- docs/adr/README.md docs/adr/TEMPLATE.md
```
→ the directory exists and `git status` prints **nothing** for those two paths.

### Step 7: Write ADR 0051

Create `docs/adr/0051-judge-identity.md`, in English. You are recording a
decision that the evidence in Steps 1–2 already forces — do not invent new
options. It must contain these seven `##` sections, in this order, with this
substance. Use the numbers **you** measured in Step 1, and date the ADR the
day you run it.

1. `## Status` — `Proposed`, with the date and the commit you branched from.

2. `## Context` — state, with your Step 1 numbers:
   - The leaderboard's top row is not a person (`DATE`, ~2,409 cases, ~11%
     approval), and prose fragments from case catchwords are being counted as
     judges (≥906 rows containing "tribunal", ≥242 containing "whether"),
     each rendered with courts, active years and a visa breakdown.
   - `immi_case_downloader/normalize_judge_names.py` (190 lines, now 21 tests)
     has never been imported by production code. Grep evidence: its only
     consumer is `tests/test_judge_normalization.py`.
   - Production mints identity as `sha256("judge:" + label.toLocaleLowerCase("en-AU")).slice(0,32)`
     from the **raw** label, at `workers/storage/cloudflare.js:914` and
     `:1247`. `judges.canonical_name` is `NOT NULL UNIQUE` and is what the SPA
     shows.
   - The read path applies no filter (`workers/case-api/cloudflare.js:915-916`).
   - `docs/JUDGE_DATA_QUALITY.md:322-329` deferred this work but names
     `workers/proxy.js` (deleted in `f91f45f`) and a "Supabase migration"
     (there is no Supabase in production). That paragraph is stale.

3. `## Decision` — four numbered decisions:
   1. **Garbage removal comes first, and it is an extraction fix, not a
      merge.** The dominant defect is that non-names are in the `judges`
      relation at all. Fixing fragmentation while `DATE` still ranks #1
      changes no number a user complains about.
   2. **No fuzzy tier. No similarity threshold.** `find_duplicate_judges`'
      `fuzz.ratio` threshold is not tuned, it is rejected. Evidence: in the
      top 200 live judges, `normalize_judge_name` creates 16 surname
      collision groups, and 6 of them are demonstrably different people —
      `Gabrielle Cullen`/`Bridget Cullen`, `Lindsay Ford`/`Norma Ford`,
      `Robin Hunt`/`Sally Hunt`, `Kate Millar`/`Paul Millar`,
      `Alison Murphy`/`Jade Murphy`, `Carolyn Wilson`/`Robert Wilson`. A
      ~38% false-merge rate on the groups it creates is not a threshold
      problem; surname equality is simply not identity.
   3. **`immi_case_downloader/data/judge_name_overrides.json` is the best
      available seed, but it is NOT a merge authority as it stands.** It holds
      490 human-reviewed `alias → full name` entries built from judge bios
      (103) plus official FCFCOA and Federal Court listings, and 115 of the top
      200 live leaderboard names hit it on an exact lowercase key.
      `judge_bios` (103 entries) is one of its inputs, not a competing source.

      **The defect that blocks using it directly, measured:** 180 of its 490
      keys are bare surnames, and each maps to exactly one person —
      `"brown" → "Judge Stewart Brown"`, `"wilson" → "Justice Joshua Wilson"`.
      But this ADR's own Decision 2 cites `Carolyn Wilson` / `Robert Wilson` as
      *different people* in the top 200. Feeding a bare label `Wilson` through
      that map therefore asserts it is Joshua Wilson — a false merge produced
      by the very file that was supposed to prevent them. Rejecting the fuzzy
      tier (Decision 2) and then trusting a lookup table with the same
      collision built in would be inconsistent.

      **What the seed must become before it can drive a merge**, and each of
      these is a follow-up, not something this plan does:
      - **A stable person identifier.** Merges target a person id, not a
        display string. `judges.canonical_name` is `NOT NULL UNIQUE`, so a
        display name cannot serve as the key for two people who share one.
      - **Alias provenance per entry.** Where did this alias→person mapping
        come from — a bio, an official court listing, a human decision — and
        when. An entry sourced from an official listing of a currently-sitting
        judge does not license merging a 2003 tribunal record with the same
        surname.
      - **An explicit `ambiguous` / `no-merge` state.** A bare-surname key with
        more than one plausible person must be *recorded as ambiguous*, not
        silently resolved to whichever full name happened to be added first.
        All 180 bare-surname keys are ambiguous until reviewed one at a time.
      - **The rule**: never auto-merge on a single surname without unique
        evidence — a matching first name or initial, a court and date range
        that only one candidate could have sat in, or an explicit human
        decision recorded with provenance. Where the evidence is not unique,
        the correct outcome is two separate people, not a guess.

      Growing and qualifying that file is a human review task; the normaliser's
      job is reduced to generating *candidates* for it.
   4. **Persist, never overwrite.** Add a nullable
      `judges.judge_canonical_id` (and a `judge_canonical` table holding the
      display name) in a future migration. `judges.canonical_name` keeps the
      source string forever. Rollback is then "stop reading the new column",
      which costs nothing — as opposed to a destructive `UPDATE`, which
      `CLAUDE.md`'s production-cleanup rule requires a backup column and a
      hand-eyeballed `LIMIT 100` dry run for, because pattern-shape garbage
      rules have a ~10–15% false-positive rate on legitimate names like
      `Michael Cooke (NSW)`.

4. `## Where normalisation runs` — the mapping is **precomputed offline in
   Python and shipped to the Worker as a static lookup table**. Do not port
   `fuzzywuzzy` or any fuzzy matcher into the Worker: the merge decision is
   reviewed by a human once and then frozen, so the Worker only ever needs a
   dictionary lookup. This also keeps `normalize_judge_names.py` out of the
   request path, where its surname-folding limitation would be a live bug
   rather than an offline candidate generator.

5. `## Consequences` — at minimum:
   - The **displayed** judge count will drop when the follow-ups land (prose
     rows are filtered out of the read projection) and a handful of judges'
     case counts will rise (variants merge). Both are user-visible changes to
     numbers people may have screenshotted. Note the wording: rows are
     *filtered*, not deleted — the underlying `judges` / `case_judges` rows
     stay, per follow-up items 2–4.
   - Someone has to review alias candidates by hand. That is the cost of
     decision 2 and it is deliberate.
   - Until the follow-up plans land, the leaderboard stays wrong. This ADR
     buys correctness of *approach*, not of data.
   - `normalize_judge_name` is now correct on bracketed qualifiers
     (`Michael Cooke (NSW)` → `cooke`, was `nsw`) but is still not a garbage
     filter (`DATE` → `date`) and still folds distinct surnames. Both
     limitations are pinned by tests so they cannot regress silently.

6. `## Options rejected` — three, each with one line of reasoning:
   - *Wire `normalize_judge_name` into the Worker read path as-is* — creates
     false merges on live data (decision 2's evidence); the read path is also
     the worst place to discover that, since there is no rollback for a
     wrong aggregate.
   - *Bulk `UPDATE` on the `judges` table to rewrite `canonical_name`* —
     destroys the source string, and `canonical_name` is `NOT NULL UNIQUE`,
     so collisions during the update fail mid-batch with no clean resume.
   - *Reuse the Flask `_is_real_judge_name` filter* — it is local-dev only,
     and measured at `42826a3` it returns `True` for `DATE`, the single
     worst row in production. It rejects `of`, `the` and `of the`, so it is
     a useful *input* to a garbage rule, not the rule.

7. `## Follow-up work, in order` — five items, each explicitly **not** done by
   this ADR. **Every one of them is additive; none deletes a row.**
   1. Fix the upstream extraction that puts catchword prose into the `judges`
      field (the root cause; look at where `judges` is populated during
      download/extraction, not at the Worker).
   2. **Classify, do not delete.** Add a nullable classification to `judges`
      (e.g. `judges.row_class` ∈ `person | prose_fragment | unclassified`, or
      a side table keyed on `judge_id`) and populate it. **Do not `DELETE`
      from `judges`, `case_judges` or `aggregate_judge`.** Reasons, in order of
      weight: the raw label is the only evidence of what the extractor produced,
      so deleting it destroys the input to fixing item 1; `case_judges` rows
      are the link between a case and its label, and a case that loses all its
      judge links looks identical to a case that never had any; and
      `CLAUDE.md`'s production-cleanup rule exists because a pattern-shape
      garbage rule already false-positived on legitimate names in this repo
      (`Michael Cooke (NSW)`, `general member cosgrave` — see
      `docs/JUDGE_DATA_QUALITY.md`) at a measured ~10–15% rate. A
      classification column is reversible in one `UPDATE`; a delete is not
      reversible at all.
   3. **A filtered read projection**, not a filtered table. The leaderboard and
      judge profiles read a view (or a `WHERE row_class = 'person'` predicate)
      so users stop seeing `DATE` and `THE TRIBUNAL` — while the underlying
      rows stay exactly where they are. Rollback is "stop applying the
      predicate", which costs nothing.
   4. **A ground-truth benchmark and a soak period before anything is
      removed.** Hand-label a sample of at least 200 rows (stratified: high
      case-count rows, bare surnames, obvious prose) and measure the
      classifier's precision and recall against it; record both in a superseding
      ADR. Then run the filtered projection in production for a soak period —
      at least one full reporting cycle, so anyone who screenshotted a number
      has a chance to notice it moved. Only after the benchmark and the soak
      may anyone *propose* physical deletion, and that proposal needs its own
      ADR, a `<col>_backup` column, and a hand-eyeballed `LIMIT 100` dry run.
   5. Migration adding nullable `judges.judge_canonical_id` + a
      `judge_canonical` table (no backfill in the same deploy), then offline
      candidate generation from `normalize_judge_name`, human review into
      `judge_name_overrides.json` **with the provenance and ambiguity fields
      Decision 3 requires**, then ship the frozen map to the Worker.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && ADR=docs/adr/0051-judge-identity.md && test -f "$ADR" \
  && grep -c "^## " "$ADR" \
  && for s in "## Status" "## Context" "## Decision" "## Consequences" "## Options rejected" "## Follow-up work"; do \
       grep -q "$s" "$ADR" && echo "ok $s" || echo "MISSING $s"; done \
  && grep -q "judge_name_overrides.json" "$ADR" && echo "ok seed-set" \
  && grep -q "ambiguous" "$ADR" && echo "ok ambiguity" \
  && grep -q "Classify, do not delete" "$ADR" && echo "ok non-destructive" \
  && grep -q "workers/storage/cloudflare.js" "$ADR" && echo "ok code-ref" \
  && git status --short -- docs/adr/README.md docs/adr/TEMPLATE.md
```
→ `grep -c "^## "` prints `7`; every line prints `ok …`, none prints
`MISSING`; and the final `git status` prints **nothing** (plan 044 owns the
index and template).

The `ambiguity` and `non-destructive` greps are the two that matter most —
they are the parts of Decisions 3 and the follow-up list most likely to be
summarised into something weaker. An ADR that says "use the override map as
the canonical seed" without the bare-surname ambiguity rule, or that says
"remove garbage rows" without the classify-then-project ordering, has lost the
substance while keeping the headings.

### Step 8: Full verification

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/ruff check immi_case_downloader/ scripts/ *.py \
  && .venv/bin/pytest tests/test_judge_normalization.py -q 2>&1 | tail -2 \
  && node --check workers/storage/cloudflare.js \
  && (cd workers && npx vitest run 2>&1 | tail -4) \
  && git status --porcelain --untracked-files=all
```

**Verify**: `All checks passed!`; `23 passed`; `node --check` silent;
`WK_BEFORE` passed from the Worker suite, unchanged; and
`git status --porcelain --untracked-files=all` shows **only**:

- ` M immi_case_downloader/normalize_judge_names.py`
- ` M tests/test_judge_normalization.py`
- ` M workers/storage/cloudflare.js`
- `?? docs/adr/0051-judge-identity.md` and nothing else under `docs/adr/` — in
  particular **not** `docs/adr/README.md` or `docs/adr/TEMPLATE.md`, which plan
  044 owns. (`--untracked-files=all` is why this is visible: the plain
  `git status --short` collapses a new directory to `?? docs/adr/` and would
  hide an index file you accidentally created.)
- `?? plans/` or ` M plans/051-make-judge-identity-first-class.md`, depending
  on whether `plans/` is tracked yet

At `42826a3` the working tree also has a pre-existing ` M .claude/STATE.md`
that is not yours — leave it alone. Anything else in the list is out of scope.

Then run the full Python suite once:

```bash
make test-py 2>&1 | tail -3
```

**Verify**: the passed count is exactly `PY_BEFORE + 7` (the seven new tests).
Do not assert an absolute total. The failures must still be only in
`tests/test_backfill_judge_overrides_from_pdf.py`. Any *other* failure is a
STOP condition.

## Test plan

- **New tests**, all in `tests/test_judge_normalization.py`, class
  `TestNormalizeJudgeName`, modelled on the existing methods there
  (`test_removes_titles`, lines 14–18: docstring then bare `assert`):
  1. `test_strips_bracketed_qualifiers` — the regression this plan fixes:
     `Michael Cooke (NSW)`→`cooke`, `Brown [2019]`→`brown`,
     `Kirk (Member)`→`kirk`, `Smith (Deputy President)`→`smith`.
  2. `test_bracket_only_input` — edge case: `(NSW)` and `[2019]` → `""`.
  2b. `test_mismatched_delimiters_are_not_treated_as_brackets` — `Cooke (foo]`
     and `Cooke [foo)` → `"foo"`, proving the pattern is an alternation and not
     a character class. A character-class pattern passes tests 1 and 2
     identically, so **this is the only test that distinguishes the correct
     regex from the wrong one**.
  2c. `test_unclosed_bracket_is_left_alone` — an unclosed fragment that exists
     in live data is not half-eaten.
  3. `test_distinct_people_sharing_a_surname_collide` — pins the *known
     limitation* so a future change that silently "fixes" it by merging is
     caught and forced through the ADR.
  4. `test_garbage_labels_are_not_rejected` — pins that this module is not a
     garbage filter (`DATE`→`date`), so nobody wires it in expecting one.
  5. `test_full_name_and_surname_only_agree` — the one genuine split observed
     live (`Louise Nicholls` / `Nicholls`), so the surname folding that *is*
     wanted stays working.
- **Existing coverage that must not regress**: all 16 tests already in the
  file, in particular `test_handles_special_chars` (`O'Brien`→`obrien`) and
  `test_handles_accents` (`Müller`→`muller`) — the new bracket regex runs
  before both and must not disturb them.
- **Verification**: `.venv/bin/pytest tests/test_judge_normalization.py -q`
  → `23 passed` (16 existing + 7 new).
- **No new Worker tests.** Step 5 adds comments only; `node --check` plus the
  an unchanged `WK_BEFORE` from `cd workers && npx vitest run` is the gate.

## Done criteria

ALL must hold:

- [ ] `.venv/bin/ruff check immi_case_downloader/ scripts/ *.py` exits 0 and prints `All checks passed!`
- [ ] `.venv/bin/pytest tests/test_judge_normalization.py -q` reports `23 passed`
- [ ] `make test-py` reports `PY_BEFORE + 7` passed and the only failures are the 3
      pre-existing ones in `tests/test_backfill_judge_overrides_from_pdf.py`
- [ ] `node --check workers/storage/cloudflare.js` exits 0
- [ ] `cd workers && npx vitest run` reports `WK_BEFORE` passed, unchanged, 0 failed
- [ ] `.venv/bin/python -c "import sys; sys.path.insert(0,'.'); from immi_case_downloader.normalize_judge_names import normalize_judge_name as N; print(N('Michael Cooke (NSW)'))"`
      prints `cooke`
- [ ] `git diff --numstat workers/storage/cloudflare.js` shows `4` added and
      `0` deleted lines
- [ ] `grep -c "docs/adr/0051-judge-identity.md" workers/storage/cloudflare.js`
      returns `2`
- [ ] `test -f docs/adr/0051-judge-identity.md && grep -c "^## " docs/adr/0051-judge-identity.md`
      returns `7`
- [ ] `git status --short -- docs/adr/README.md docs/adr/TEMPLATE.md` prints nothing (plan 044 owns both)
- [ ] `git status --porcelain --untracked-files=all -- docs/adr` lists **only** `docs/adr/0051-judge-identity.md`
- [ ] `git diff --stat` touches no file outside the "In scope" list
- [ ] `git log --oneline -1` message matches `^(feat|fix|refactor|docs|test|chore|perf|ci): `

## STOP conditions

Stop and report back (do not improvise) if:

- **The drift check is non-empty.** Any change to
  `immi_case_downloader/normalize_judge_names.py` or the judge region of
  `workers/storage/cloudflare.js` since `42826a3` means the excerpts above may
  be stale — re-read before touching anything.
- **Step 1's first request does not return HTTP 200**, or the leaderboard's
  top row is a plausible human name. Either production changed materially or
  someone already ran the cleanup; the ADR's premise needs re-checking before
  you write it.
- **Step 2's output does not match exactly.** If `'Michael Cooke (NSW)'`
  already normalises to `'cooke'`, the fix landed elsewhere — skip Steps 3–4,
  say so, and continue.
- **ruff reports errors in `immi_case_downloader/`.** The bracket regex
  contains `[`, `]`, `(` and `)` inside a character class; a mistyped escape
  is the likely cause. Do not "fix" it by reformatting other lines.
- **Any existing test in `tests/test_judge_normalization.py` starts failing.**
  The bracket substitution runs before title-stripping and before accent
  folding; if `Müller` or `O'Brien` breaks, the regex is eating more than
  brackets. Revert Step 3 and report.
- **`tests/test_judge_normalization.py` is dirty, unmerged, or has uncommitted
  changes when you reach Step 4.** `plans/003-lint-the-test-suite.md` shares
  this file and must land first. Stop and let 003 finish; do not append tests
  on top of someone else's in-flight edit.
- **`git diff --numstat workers/storage/cloudflare.js` shows any deleted
  line.** Step 5 is comments only. A deletion means you edited executable code
  in a file 22 other plans also touch.
- **You conclude the ADR should recommend a bulk `UPDATE`/`DELETE`, a schema
  migration, or a change to the leaderboard filter.** All three are
  deliberately out of scope. Write the recommendation into
  `## Follow-up work, in order` and stop; do not implement it.
- **You cannot reach `https://immi.trackit.today`.** Do not write the ADR from
  this plan's 2026-08-28 numbers as if you had measured them. Report the
  network failure and stop — an ADR with unverifiable figures is worse than
  no ADR.
- **A verification fails twice** after one reasonable fix attempt.

## Maintenance notes

For whoever owns this next:

- **`docs/adr/README.md` is owned by plan 044; add the index row there when 044
  lands.** The row is
  `| [0051](0051-judge-identity.md) | How judge identity is repaired | Proposed |`.
  This plan writes no index and no template.
- **The ADR is `Proposed`, not `Accepted`.** It records a recommendation and
  the evidence for it. An operator has to accept it before the five follow-up
  items become work.
- **Nothing in the follow-up chain deletes a row, and that is deliberate.**
  Items 2–4 add a classification, a filtered read projection, a benchmark and a
  soak period. Physical deletion of "garbage" judge rows needs its own
  superseding ADR after the benchmark, because the raw labels are the only
  evidence of what the extractor produced — the input to fixing the root cause —
  and because this repo has already had a pattern-shape cleanup false-positive
  on legitimate names (`docs/JUDGE_DATA_QUALITY.md`, 2026-05-02). If someone
  proposes "just delete the obvious junk first", that is the shortcut the
  post-mortem exists to prevent.
- **What a reviewer should scrutinise**: (1) that the ADR's numbers were
  re-measured, not copied from this plan — the dates should be the day the
  work ran; (2) that `git diff workers/storage/cloudflare.js` really is four
  added comment lines and nothing else; (3) that no SQL appears anywhere in
  the diff.
- **The bracket regex is deliberately narrow, and the form matters.**
  `\([^)]*\)|\[[^\]]*\]` — an alternation, not a character class. A
  character-class version (`[(\[][^)\]]*[)\]]`, which an earlier draft of this
  plan specified and wrongly described as requiring "a balanced pair") also
  matches `(foo]` and `[foo)`, because a character class has no notion of
  pairing. Unbalanced or mismatched fragments like
  `'to order the Minister to answer interrogatories (see'` — which exist in
  live data — are untouched by design: they are garbage rows for the extraction
  fix (follow-up item 1) to remove, not names to normalise, and half-eating one
  makes it harder to recognise as garbage. Two tests pin this.
- **Two tests are limitation-pins, not behaviour specs.**
  `test_distinct_people_sharing_a_surname_collide` and
  `test_garbage_labels_are_not_rejected` assert that the module is *wrong* in
  documented ways. If a future change makes them fail, that is a signal to
  revisit ADR 0051 — not to delete the tests.
- **`judge_name_overrides.json` is the asset that matters — and it is not
  merge-ready.** 490 curated entries, read today only by local-dev Flask.
  **180 of its 490 keys are bare surnames**, each mapping to exactly one
  person (`"brown" → "Judge Stewart Brown"`, `"wilson" → "Justice Joshua
  Wilson"`) while the ADR itself documents `Carolyn Wilson` / `Robert Wilson`
  as different people. Using it as-is to merge would manufacture exactly the
  false merges Decision 2 rejects the fuzzy tier for. Whoever does the
  candidate-generation follow-up should treat *qualifying* that file as the
  deliverable — a stable person id, per-alias provenance, and an explicit
  ambiguous/no-merge state on every bare-surname key — before treating any of
  it as authoritative. The Python normaliser is only a candidate generator
  feeding that review.
- **Deferred out of this plan, deliberately**: the `fuzzywuzzy` → `rapidfuzz`
  swap (owned by `plans/036`); the ruff F401 in
  `tests/test_judge_normalization.py` (owned by `plans/003`); adding `"date"`
  to Flask's `_NAME_DISQUALIFIERS` (Flask is local-dev only and `plans/028`
  and `plans/034` both restructure that file).

## Findings reconsidered

The audit finding this plan came from ("DIR-05 — Make judge identity a
first-class entity") was directionally right about the code and wrong about
the magnitude. Corrections, all verified independently at `42826a3` and
against live production on 2026-08-28:

- **Cited line `immi_case_downloader/normalize_judge_names.py:16` is off by
  one.** `def normalize_judge_name(name: Optional[str]) -> str:` is at line
  **15**; line 16 is the opening `"""` of its docstring. The substance — that
  the function exists, is tested, and is imported by nothing but its test —
  holds. Cited lines `docs/JUDGE_DATA_QUALITY.md:324` and
  `workers/storage/cloudflare.js:220` are both correct as written.

- **The "15,465 judges → ~3,000 real people" figure is repo lore, not a
  measurement, and I could not reproduce anything like it.** The live count is
  15,254. Grouping the top 200 by normalised surname yields 16 collision
  groups covering 32 rows — and 6 of those groups are different people, not
  variants. Whatever inflates the judge count, it is not principally spelling
  fragmentation, so the plan does not chase a 5× consolidation.

- **The originally-proposed shape of the work — a fuzzy-merge project — is
  dropped, not deferred.** It is replaced by an ADR that explicitly rejects
  the fuzzy tier, on evidence generated in this session. The finding itself
  flagged the merge risk; the measurement quantifies it at ~38% false merges
  among the groups the normaliser creates.

- **The finding's own corrected framing ("garbage first") understated the
  problem.** It described `"DATE"` as the headline artifact. Confirmed — but
  live probing shows the `judges` relation also contains whole sentences from
  case catchwords (≥906 rows matching "tribunal", ≥242 matching "whether";
  e.g. `'MIGRATION - business skills visa - cancellation - whether eligible'`).
  That reframes the first follow-up item from "delete some bad rows" to "fix
  the extraction that produces them", which is what the ADR now says.

- **One measurement method that looks obvious is wrong, recorded so nobody
  repeats it.** Probing `name_q=" the "` to count prose rows returns 6,320 —
  but `workers/case-api/cloudflare.js:880` calls `.trim()` on `name_q`, so the
  probe degrades to `the` and matches `Catherine`, `Matheson`, `Theodore`.
  Single-word probes only.

- **Nothing in the finding was dropped without replacement.** The three open
  questions it raised (confidence threshold; whether `judge_bios` is the
  canonical seed; persist-vs-overwrite) are each answered explicitly in ADR
  0004 §Decision.
