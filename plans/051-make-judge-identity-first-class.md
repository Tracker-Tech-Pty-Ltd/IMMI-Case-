# Plan 051: Spike — decide how judge identity gets fixed before wiring the normaliser into production

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index. (`plans/README.md` does not exist at
> the time of writing; do **not** create it.)
>
> **Drift check (run first)**:
> `git diff --stat 42826a3..HEAD -- docs/adr immi_case_downloader/normalize_judge_names.py tests/test_judge_normalization.py workers/storage/cloudflare.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
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
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `42826a3`, 2026-08-27

> On "Depends on: none" — this plan's verification gates are `make lint`,
> `.venv/bin/pytest`, and `node --check`. All three pass at `42826a3`. It
> touches no TypeScript and no frontend file, so it does not depend on the
> frontend-compile-gate work in `plans/001-*`. It shares two files with
> `plans/036-bound-the-python-dependencies.md`, but only by mention: 036
> edits `requirements-app.txt` comments and explicitly states it does **not**
> modify `immi_case_downloader/normalize_judge_names.py` or
> `tests/test_judge_normalization.py`. There is no ordering constraint.

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
- **`make lint`** runs `ruff check immi_case_downloader/ scripts/ *.py`. It
  does **not** cover `tests/`, which has 43 pre-existing ruff errors owned by
  `plans/003-lint-the-test-suite.md`. One of them is in
  `tests/test_judge_normalization.py` (unused `import pytest`, F401). **Do not
  fix it** — it is another plan's territory and touching it creates a merge
  conflict.
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
- **ADR numbering** — `docs/adr/` does not exist yet. Three sibling plans each
  create an ADR there: `0001-austlii-ingestion-architecture.md`,
  `0001-user-data-persistence.md`, `0002-app-layer-tenant-isolation.md` and
  `0003-council-lexical-retrieval.md` are all claimed. **This plan uses
  `0004`** and creates `docs/adr/README.md` only if it is absent, so the
  plans can land in any order.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Drift check | `git diff --stat 42826a3..HEAD -- docs/adr immi_case_downloader/normalize_judge_names.py tests/test_judge_normalization.py workers/storage/cloudflare.js` | no output |
| Judge unit tests | `.venv/bin/pytest tests/test_judge_normalization.py -q` | `16 passed` before Step 4, `21 passed` after |
| Full Python suite | `make test-py` | `1141 passed, 3 failed, 7 skipped` — the 3 failures are environmental (see STOP conditions) |
| Python lint | `make lint` | `All checks passed!` |
| Worker syntax | `node --check workers/storage/cloudflare.js` | exit 0, no output |
| Worker tests | `cd workers && npx vitest run` | `345 passed`, 25 files |
| Live read (safe) | `curl -s --max-time 90 "https://immi.trackit.today/api/v1/analytics/judge-leaderboard?limit=10&sort_by=cases"` | HTTP 200 JSON |

Every `curl` in this plan is a **GET against a public read endpoint**. Do not
issue POST/PUT/DELETE against production for any reason.

## Scope

**In scope** (the only files you may modify):

- `docs/adr/README.md` — create **only if absent**; if present, append one row.
- `docs/adr/0004-judge-identity.md` — create.
- `immi_case_downloader/normalize_judge_names.py` — one bug fix + one docstring.
- `tests/test_judge_normalization.py` — add 5 tests. Do not touch its imports.
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
  - `docs: point the D1 judge_id derivation at ADR 0004`
  - `docs: record the judge identity decision as ADR 0004`
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
_BRACKET_PATTERN = re.compile(r"[(\[][^)\]]*[)\]]")
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

See docs/adr/0004-judge-identity.md for the decision and the ordering of
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
      and N('Müller')=='muller' and N(None)=='' and N('')=='')
print('PASS' if ok else 'FAIL')
" 2>/dev/null && make lint
```
→ prints `PASS`, then `All checks passed!`

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

    def test_distinct_people_sharing_a_surname_collide(self):
        """Documented limitation: surname folding merges different people.

        This is why the module must not drive a merge without an alias file.
        See docs/adr/0004-judge-identity.md.
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
→ contains `21 passed`

### Step 5: Point the production judge_id derivation at the ADR

Two comment insertions in `workers/storage/cloudflare.js`. No behaviour change.

**5a.** Immediately **above** the line

```javascript
      const labels = normaliseRelationLabels(updates.judges, "judge");
```

insert (matching its 6-space indentation):

```javascript
      // judge_id is a hash of the RAW label, so every spelling variant and
      // every prose fragment becomes a separate judge. See docs/adr/0004-judge-identity.md.
```

**5b.** Immediately **above** the line

```javascript
    const judgeLabels = normaliseRelationLabels(record.judges, "judge");
```

insert (matching its 4-space indentation):

```javascript
    // judge_id is a hash of the RAW label, so every spelling variant and
    // every prose fragment becomes a separate judge. See docs/adr/0004-judge-identity.md.
```

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && node --check workers/storage/cloudflare.js \
  && grep -c "docs/adr/0004-judge-identity.md" workers/storage/cloudflare.js \
  && git diff --numstat workers/storage/cloudflare.js
```
→ `node --check` exits 0 with no output; `grep -c` prints `2`; `git diff
--numstat` shows `4  0  workers/storage/cloudflare.js` (4 lines added, **0
deleted** — if any line was deleted you have edited code, which is out of
scope).

### Step 6: Create the ADR directory and README (idempotent)

If `docs/adr/README.md` already exists (a sibling plan landed first), **do not
overwrite it** — append one row to its table and skip the rest of this step.

If it does not exist, create `docs/adr/README.md` with exactly this content:

```markdown
# Architecture Decision Records

Each file records one decision that is expensive to reverse: the context that
forced it, the options weighed, the choice, and what it costs.

Naming: `NNNN-kebab-slug.md`, numbered in the order decisions were made.

Status values: `Proposed` | `Accepted` | `Superseded by NNNN` | `Rejected`.
Never edit a decision after it is Accepted — write a new ADR that supersedes it,
so the reasoning behind the old choice stays readable.

| ADR | Title | Status |
|---|---|---|
| [0004](0004-judge-identity.md) | How judge identity is repaired | Proposed |
```

**Verify**:
`head -1 docs/adr/README.md && grep -c "0004-judge-identity.md" docs/adr/README.md`
→ prints `# Architecture Decision Records`, then `1`

### Step 7: Write ADR 0004

Create `docs/adr/0004-judge-identity.md`, in English. You are recording a
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
   3. **The canonical seed set is
      `immi_case_downloader/data/judge_name_overrides.json`, not
      `judge_bios`.** It holds 490 human-reviewed `alias → full name` entries
      built from judge bios (103) plus official FCFCOA and Federal Court
      listings; 115 of the top 200 live leaderboard names hit it on an exact
      lowercase key. `judge_bios` (103 entries) is one of its inputs, not a
      competing source. Merges happen only where this file says two labels
      are the same person. Growing the file is a human review task; the
      normaliser's job is reduced to generating *candidates* for that review.
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
   - Judge counts will drop when this lands (garbage rows disappear), and a
     handful of judges' case counts will rise (variants merge). Both are
     user-visible changes to numbers people may have screenshotted.
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

7. `## Follow-up work, in order` — four items, each one line, each explicitly
   **not** done by this ADR:
   1. Fix the upstream extraction that puts catchword prose into the `judges`
      field (the root cause; look at where `judges` is populated during
      download/extraction, not at the Worker).
   2. Remove existing garbage rows from `judges` / `case_judges` /
      `aggregate_judge`, with a backup column and a hand-eyeballed
      `LIMIT 100` dry run first, per the `CLAUDE.md` rule.
   3. Migration adding nullable `judges.judge_canonical_id` + a
      `judge_canonical` table (no backfill in the same deploy).
   4. Offline candidate generation from `normalize_judge_name`, human review
      into `judge_name_overrides.json`, then ship the frozen map to the
      Worker.

**Verify**:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && test -f docs/adr/0004-judge-identity.md \
  && grep -c "^## " docs/adr/0004-judge-identity.md \
  && for s in "## Status" "## Context" "## Decision" "## Consequences" "## Options rejected" "## Follow-up work"; do \
       grep -q "$s" docs/adr/0004-judge-identity.md && echo "ok $s" || echo "MISSING $s"; done \
  && grep -q "judge_name_overrides.json" docs/adr/0004-judge-identity.md && echo "ok seed-set" \
  && grep -q "workers/storage/cloudflare.js" docs/adr/0004-judge-identity.md && echo "ok code-ref"
```
→ `grep -c "^## "` prints `7`; every line prints `ok …`, none prints
`MISSING`.

### Step 8: Full verification

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && make lint \
  && .venv/bin/pytest tests/test_judge_normalization.py -q 2>&1 | tail -2 \
  && node --check workers/storage/cloudflare.js \
  && (cd workers && npx vitest run 2>&1 | tail -4) \
  && git status --short
```

**Verify**: `All checks passed!`; `21 passed`; `node --check` silent;
`345 passed` from the Worker suite; and `git status --short` shows **only**:

- ` M immi_case_downloader/normalize_judge_names.py`
- ` M tests/test_judge_normalization.py`
- ` M workers/storage/cloudflare.js`
- `?? docs/adr/` (git collapses new directories — expand with
  `git status --short --untracked-files=all` to confirm it contains exactly
  `docs/adr/README.md` and `docs/adr/0004-judge-identity.md`)
- `?? plans/` or ` M plans/051-make-judge-identity-first-class.md`, depending
  on whether `plans/` is tracked yet

At `42826a3` the working tree also has a pre-existing ` M .claude/STATE.md`
that is not yours — leave it alone. Anything else in the list is out of scope.

Then run the full Python suite once:

```bash
make test-py 2>&1 | tail -3
```

**Verify**: `1141 passed, 3 failed, 7 skipped` — count unchanged except the
5 new tests, so expect `1146 passed`. The 3 failures must still be only in
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
  → `21 passed` (16 existing + 5 new).
- **No new Worker tests.** Step 5 adds comments only; `node --check` plus the
  unchanged `345 passed` from `cd workers && npx vitest run` is the gate.

## Done criteria

ALL must hold:

- [ ] `make lint` exits 0 and prints `All checks passed!`
- [ ] `.venv/bin/pytest tests/test_judge_normalization.py -q` reports `21 passed`
- [ ] `make test-py` reports `1146 passed` and the only failures are the 3
      pre-existing ones in `tests/test_backfill_judge_overrides_from_pdf.py`
- [ ] `node --check workers/storage/cloudflare.js` exits 0
- [ ] `cd workers && npx vitest run` reports `345 passed`
- [ ] `.venv/bin/python -c "import sys; sys.path.insert(0,'.'); from immi_case_downloader.normalize_judge_names import normalize_judge_name as N; print(N('Michael Cooke (NSW)'))"`
      prints `cooke`
- [ ] `git diff --numstat workers/storage/cloudflare.js` shows `4` added and
      `0` deleted lines
- [ ] `grep -c "docs/adr/0004-judge-identity.md" workers/storage/cloudflare.js`
      returns `2`
- [ ] `test -f docs/adr/0004-judge-identity.md && grep -c "^## " docs/adr/0004-judge-identity.md`
      returns `7`
- [ ] `grep -c "0004-judge-identity.md" docs/adr/README.md` returns `1`
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
- **`make lint` reports errors in `immi_case_downloader/`.** The bracket regex
  contains `[`, `]`, `(` and `)` inside a character class; a mistyped escape
  is the likely cause. Do not "fix" it by reformatting other lines.
- **Any existing test in `tests/test_judge_normalization.py` starts failing.**
  The bracket substitution runs before title-stripping and before accent
  folding; if `Müller` or `O'Brien` breaks, the regex is eating more than
  brackets. Revert Step 3 and report.
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

- **The ADR is `Proposed`, not `Accepted`.** It records a recommendation and
  the evidence for it. An operator has to accept it before the four follow-up
  items become work.
- **What a reviewer should scrutinise**: (1) that the ADR's numbers were
  re-measured, not copied from this plan — the dates should be the day the
  work ran; (2) that `git diff workers/storage/cloudflare.js` really is four
  added comment lines and nothing else; (3) that no SQL appears anywhere in
  the diff.
- **The bracket regex is deliberately narrow.** `[(\[][^)\]]*[)\]]` requires a
  balanced pair. Unbalanced fragments like
  `'to order the Minister to answer interrogatories (see'` — which exist in
  live data — are untouched by design, because they are garbage rows for the
  extraction fix (follow-up item 1) to remove, not names to normalise.
- **Two tests are limitation-pins, not behaviour specs.**
  `test_distinct_people_sharing_a_surname_collide` and
  `test_garbage_labels_are_not_rejected` assert that the module is *wrong* in
  documented ways. If a future change makes them fail, that is a signal to
  revisit ADR 0004 — not to delete the tests.
- **`judge_name_overrides.json` is the asset that matters.** 490 curated
  entries, read today only by local-dev Flask. Whoever does follow-up item 4
  should treat growing that file as the deliverable; the Python normaliser is
  only a candidate generator feeding human review.
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
