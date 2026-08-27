# Plan 041: Give the 2,821 unmeasured extraction lines a coverage story

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index, or `plans/README.md` does not exist (it did not exist
> when this plan was written; if it is still absent, skip that update
> silently).
>
> **Drift check (run first)**:
>
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> git diff --stat 42826a3..HEAD -- \
>   pytest.ini \
>   extract_structured_fields.py \
>   immi_case_downloader/extraction/regex.py \
>   tests/test_extraction_regex.py \
>   tests/test_extraction_container_boundary.py
> ```
>
> Empty output means no drift — proceed. If any of those files changed since
> this plan was written, compare the "Current state" excerpts against the live
> code before proceeding; on a mismatch, treat it as a STOP condition. In
> particular, a diff on `extract_structured_fields.py` or
> `immi_case_downloader/extraction/regex.py` most likely means
> `plans/032-consolidate-the-extraction-scripts.md` has landed — see STOP
> condition 1.
>
> **Every expected value in this plan was measured by running the real code at
> commit `42826a3`.** They are not guesses. If a value you transcribe does not
> reproduce, that is drift, not a typo — STOP and report.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

`extract_structured_fields.py` is 1,136 lines of hand-tuned regex that decides
the `applicant_name`, `country_of_origin`, `visa_subclass_number`,
`hearing_date`, `is_represented`, `representative`, `visa_outcome_reason` and
`legal_test_applied` values for all 149,016 rows in the case catalog — and it
is not a dead script: the installable package imports seven of its functions
(`immi_case_downloader/extraction/regex.py:14`), which is how the production
extraction path reaches them. Exactly **one** test asserts anything about any of
it, and that test makes six assertions about one synthetic document.

Worse, no coverage report has ever mentioned the file. `pytest.ini:3` scopes
`--cov` to `immi_case_downloader` only, so all six root-level extraction
scripts — 2,821 lines — are invisible to every coverage run the project makes.
A one-character change to any of these regexes silently reshapes a field across
149K rows, and neither a failing test nor a dropped coverage line would say so.
That is precisely the failure documented in `docs/JUDGE_DATA_QUALITY.md` (the
2026-05-02 judges-column incident), which is why
`tests/test_postprocess_judges.py` exists for `postprocess.py` — this plan
gives `extract_structured_fields.py` the same protection, and makes the number
visible so the next gap is noticed rather than discovered.

After this plan: `extract_structured_fields.py` goes from 27% covered by one
transitive test to **at least 60%** covered by 56 explicit characterization
tests, both root scripts that tests can reach appear in every coverage report,
and the four scripts that cannot currently be imported at all say so in an
executable, skipped-with-a-reason test instead of being silently absent.

## Current state

### The files this plan touches, and what each is

- `pytest.ini` — pytest config; line 3 defines the `--cov` scope for every run,
  including CI's bare `.venv/bin/pytest`.
- `extract_structured_fields.py` — 1,136-line CLI script, the regex extractor.
  **Read-only for this plan**; the tests pin its current behaviour, they do not
  change it.
- `immi_case_downloader/extraction/regex.py` — the package module that imports
  from the script above. This is why the script is reachable from tests at all.
- `tests/test_extraction_regex.py` — the single existing test, 24 lines.
- `tests/test_extraction_structured_fields.py` — **you create this**.
- `tests/test_extraction_script_imports.py` — **you create this**.

### `pytest.ini` — verbatim, all 9 lines

```ini
[pytest]
testpaths = tests
addopts = -v --cov=immi_case_downloader --cov-report=term-missing
asyncio_mode = auto
asyncio_default_fixture_loop_scope = function
filterwarnings =
    ignore::pytest.PytestDeprecationWarning:pytest_asyncio
    ignore:.*asyncio.iscoroutinefunction.*:DeprecationWarning:pytest_asyncio
    ignore:.*asyncio.get_event_loop_policy.*:DeprecationWarning:pytest_asyncio
```

Line 3 is the whole problem: `--cov=immi_case_downloader` can never report a
repo-root module.

### `immi_case_downloader/extraction/regex.py:1-24` — verbatim

```python
"""Regex extraction helpers for text already loaded in memory.

The legacy ``extract_structured_fields.py`` script is CLI-shaped and reads text
from case_text files. This module reuses its helper functions without changing
that script's behaviour, so the Cloudflare container endpoint can extract from
R2-provided text directly.
"""

from __future__ import annotations

import re
from typing import Any

from extract_structured_fields import (
    RE_AATA_APPLICANT,
    RE_AATA_REPRESENTATIVE,
    extract_country,
    extract_from_title,
    extract_hearing_date,
    extract_legal_test,
    extract_representation,
    extract_visa_outcome_reason,
    extract_visa_subclass_number,
)
```

The repo root is already on `sys.path` during a pytest run — that is how
`tests/test_postprocess_judges.py:13` does `from postprocess import ...`
without any path manipulation. **Your new test files must not add
`sys.path.insert` lines.**

### `tests/test_extraction_regex.py` — verbatim, the entire existing test

```python
from immi_case_downloader.extraction.regex import extract_regex


def test_extract_regex_from_loaded_text():
    text = """
    APPLICANT:

    Jane Citizen
    CASE NUMBER: 123

    The applicant is a citizen of India and applied for a Subclass 500 visa.
    The matter was heard on 12 March 2024.
    The applicant was represented by Ms Counsel.
    CATCHWORDS: MIGRATION - student visa - genuine temporary entrant
    """

    fields = extract_regex(text, {"title": "Jane Citizen v Minister [2024] AATA 1"})

    assert fields["applicant_name"]["value"] == "Jane Citizen"
    assert fields["country_of_origin"]["value"] == "India"
    assert fields["visa_subclass_number"]["value"] == "500"
    assert fields["hearing_date"]["value"] == "12 March 2024"
    assert fields["is_represented"]["value"] == "Yes"
    assert fields["case_nature"]["value"] == "Student visa"
```

That single test is what produces the current 27% figure. Leave this file
alone.

### Measured baseline coverage (reproduced at `42826a3`)

```
$ .venv/bin/python -m pytest tests/test_extraction_regex.py -q -o addopts="" \
    --cov=extract_structured_fields --cov-report=term
Name                           Stmts   Miss  Cover
--------------------------------------------------
extract_structured_fields.py     514    373    27%
```

`postprocess.py` measures **39%** (292 stmts, 179 missed) under
`tests/test_postprocess_judges.py`.

### The functions you will characterize

All in `extract_structured_fields.py`. Signatures verbatim:

```python
def extract_from_title(title: str) -> tuple[str, str]:           # line 376
def _demonym_to_country(demonym: str) -> str:                     # line 417
def _clean_country_value(val: str) -> str:                        # line 425
def _normalise_country(val: str) -> str:                          # line 436
def extract_country(text: str) -> str:                            # line 467
def extract_visa_subclass_number(text: str, existing_subclass: str, visa_type: str = "") -> str:   # line 598
def extract_hearing_date(text: str) -> str:                       # line 646
def extract_representation(text: str) -> tuple[str, str]:         # line 694
def extract_visa_outcome_reason(text: str) -> str:                # line 807
def extract_legal_test(text: str) -> str:                         # line 830
def process_case(case_row: dict) -> dict:                         # line 876
```

`process_case` returns exactly these nine keys
(`extract_structured_fields.py:959-969`, verbatim):

```python
    return {
        "applicant_name": applicant_name,
        "respondent": respondent,
        "country_of_origin": country,
        "visa_subclass_number": visa_num,
        "hearing_date": hearing_date,
        "is_represented": is_represented,
        "representative": representative,
        "visa_outcome_reason": visa_outcome_reason,
        "legal_test_applied": legal_test_applied,
    }
```

### ⚠️ The corpus hazard in `process_case` — read this before writing any test

`extract_structured_fields.py:896-903`, verbatim:

```python
    # Also try constructing path from citation
    if not text and citation:
        constructed_path = CASES_DIR / f"{citation}.txt"
        if constructed_path.exists():
            try:
                text = constructed_path.read_text(encoding="utf-8", errors="replace")
            except (OSError, IOError):
                pass
```

`CASES_DIR` is `Path("downloaded_cases/case_texts")`
(`extract_structured_fields.py:29`). That directory is **gitignored**
(`.gitignore:17`) but on a developer machine it holds ~142,966 files named by
citation — real filenames look like `[1938] HCA 34.txt`, `[1956] HCA 80.txt`.

**Consequence**: any test that passes a real-looking `citation` and no
`full_text_path` will read the local corpus on a developer machine and read
nothing in CI, producing different results on different machines. Every test
you write must either pass `citation: ""` / omit it, or pass an explicit
`full_text_path`. Never put a plausible citation string in a
`process_case` test row.

For the same reason **no test in this plan may read from
`downloaded_cases/`**. All fixtures are inline strings or `tempfile` files.

### Repo conventions this plan must match

- **Test style exemplar**: `tests/test_postprocess_judges.py`. It is the
  closest analogue — it tests a repo-root script directly, uses
  `from __future__ import annotations`, `@pytest.mark.parametrize` tables with
  a trailing explanatory comment per row, and a `tempfile.mkstemp` helper for
  file-reading functions. Model your files on it. Its header, verbatim
  (`tests/test_postprocess_judges.py:1-13`):

  ```python
  """Tests for the judges-field extraction sanity check in postprocess.py.

  Covers the regex bug fix from docs/JUDGE_DATA_QUALITY.md (autopilot scope D).
  """

  from __future__ import annotations

  import os
  import tempfile

  import pytest

  from postprocess import _looks_like_judge_name, extract_metadata
  ```

  and its tempfile helper (`tests/test_postprocess_judges.py:69-74`), verbatim:

  ```python
  def _make_row_with_text(text: str) -> tuple[dict, str]:
      """Helper: create a row dict pointing at a tempfile containing `text`."""
      fd, path = tempfile.mkstemp(suffix=".txt", text=True)
      with os.fdopen(fd, "w", encoding="utf-8") as f:
          f.write(text)
      return {"full_text_path": path, "judges": ""}, path
  ```

- **Python style** (from the project's rules): PEP 8, type annotations on
  function signatures, pytest as the framework, ruff as the linter. The repo
  has **no ruff configuration file** — ruff 0.15.18 runs with its default
  rule set (E4, E7, E9, F). Your files must pass `ruff check` cleanly.
- **Commit convention** (from `git log`): `<type>: <description>` where type is
  one of `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Real example from history: `fix: install root node_modules in make install`.
- **Characterization, not correction.** These tests pin what the code does
  today so that a future change to it is visible. If a measured value looks
  wrong to you, write the test asserting the measured value anyway and note the
  oddity in your final report. Do **not** "fix" `extract_structured_fields.py`
  — changing its output changes 149,016 rows and is the job of
  `plans/032-consolidate-the-extraction-scripts.md`, not this one.

### Why the other four scripts cannot simply be tested

Measured at `42826a3` in the project venv:

```
$ .venv/bin/python -c "import extract_llm_structured"
ModuleNotFoundError: No module named 'anthropic'
```

The same failure occurs for `extract_structured_fields_llm`,
`extract_llm_fields` and `extract_with_llm`. `anthropic` is not installed in
`.venv` and is not in the test requirements. `download_fulltext` **does**
import cleanly (~1s, no network at import time).

Also measured: listing a never-imported module under `--cov` does **not**
produce a 0% row. It produces
`CoverageWarning: Module <name> was never imported. (module-not-imported)` and
the module is omitted from the report entirely. So "just widen `--cov`" cannot
by itself make those four visible — which is why step 4 makes the gap
executable instead.

## Commands you will need

All commands run from `/Users/d/Developer/Active Projects/IMMI-Case-`.
Always use the project venv — never global `pip`/`python`.

| Purpose | Command | Expected on success |
|---|---|---|
| Python unit tests | `make test-py` | `1198 passed, 3 failed, 11 skipped` after this plan (see note below) |
| Just the new characterization file | `.venv/bin/python -m pytest tests/test_extraction_structured_fields.py -q -o addopts=""` | `56 passed` |
| Just the new import-smoke file | `.venv/bin/python -m pytest tests/test_extraction_script_imports.py -q -o addopts=""` | `1 passed, 4 skipped` |
| Coverage of the target script | `.venv/bin/python -m pytest tests/test_extraction_structured_fields.py -q -o addopts="--cov=extract_structured_fields --cov-report=term"` | row `extract_structured_fields.py  514  ≤205  ≥60%` |
| Lint the two new files | `.venv/bin/ruff check tests/test_extraction_structured_fields.py tests/test_extraction_script_imports.py` | `All checks passed!` |
| Repo lint gate (unchanged scope) | `make lint` | `All checks passed!` |
| Confirm nothing else changed | `git status --short` | only the three in-scope paths |

**Note on the 3 failures**: at `42826a3`, `make test-py` reports
`1141 passed, 3 failed, 7 skipped`. The 3 failures are **environmental** —
Homebrew Python 3.14.7 has a `pyexpat`/`libexpat` ABI mismatch that breaks the
`pypdf` import in `tests/test_backfill_judge_overrides_from_pdf.py`. They are
not caused by repo code and are **not** this plan's problem. If your machine
shows `1141 passed, 0 failed`, that is fine too — expect the passed count to
rise by 57 and the skipped count by 4, whatever the failure count is.

## Scope

**In scope** (the only files you may modify or create):

- `tests/test_extraction_structured_fields.py` — **create**
- `tests/test_extraction_script_imports.py` — **create**
- `pytest.ini` — **edit line 3 only**

**Out of scope** (do NOT touch, even though they look related):

- `extract_structured_fields.py` — read it, do not modify it. Its output feeds
  149,016 catalog rows and the production extraction container via
  `immi_case_downloader/extraction/regex.py`. Restructuring it is
  `plans/032-consolidate-the-extraction-scripts.md`'s job.
- `extract_llm_structured.py`, `extract_structured_fields_llm.py`,
  `extract_llm_fields.py`, `extract_with_llm.py` — cannot be imported in the
  test venv (`anthropic` missing). Step 4 records that fact; do not add
  `anthropic` to any requirements file to work around it, and do not edit the
  scripts to make them importable. Plan 032 is consolidating all four.
- `download_fulltext.py` — step 4 adds an import smoke test for it; do not
  modify the script itself (it performs network I/O).
- `postprocess.py` and `tests/test_postprocess_judges.py` — already tested;
  step 5 only makes the existing number visible.
- `requirements-test.txt`, `requirements.txt`, `Makefile`,
  `.github/workflows/ci.yml` — no dependency or gate changes in this plan.
- `tests/test_extraction_regex.py`, `tests/test_extraction_container_boundary.py`
  — leave both exactly as they are.
- `downloaded_cases/` in any form — gitignored, machine-local, never read by a
  test.
- Adding `--cov-fail-under` to `pytest.ini` — repo-wide coverage is 13%, so a
  global floor would fail every run. Out of scope deliberately.

## Git workflow

- Branch: `advisor/041-cover-the-extraction-scripts`
  (`git checkout -b advisor/041-cover-the-extraction-scripts`)
- One commit per step group is fine; suggested messages:
  - `test: characterize extract_structured_fields regex extractors`
  - `test: smoke-test importability of the root extraction scripts`
  - `chore: report coverage for the root extraction scripts`
- Do **not** push, do **not** open a PR, do **not** merge. The operator
  commits and ships.

## Steps

### Step 1: Confirm the baseline before changing anything

Run the drift check at the top of this file, then reproduce the two numbers
this plan is built on.

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
grep -n "from extract_structured_fields import" immi_case_downloader/extraction/regex.py
.venv/bin/python -m pytest tests/test_extraction_regex.py -q -o addopts="" \
  --cov=extract_structured_fields --cov-report=term 2>&1 | tail -6
```

The `grep` must print a hit on line 14. If it prints nothing, plan 032 has
landed — STOP (condition 1).

**Verify**: the coverage table shows exactly
`extract_structured_fields.py     514    373    27%` and `1 passed`.
If the statement count is not 514, the script has drifted — STOP (condition 2).

### Step 2: Create the characterization tests for the pure functions

Create `tests/test_extraction_structured_fields.py` with the content below,
**transcribed exactly**. Every expected value was produced by running the real
functions at `42826a3`.

```python
"""Characterization tests for extract_structured_fields.py.

This module pins the CURRENT behaviour of the regex extractors that populate
applicant_name / respondent / country_of_origin / visa_subclass_number /
hearing_date / is_represented / representative / visa_outcome_reason /
legal_test_applied across the 149,016-row case catalog.

These are characterization tests, not specifications: several assertions below
record behaviour that is arguably wrong (see
test_outcome_reason_without_terminator_* in particular). They exist so that a
change to a regex in that script shows up as a failing test instead of silently
reshaping a field across the whole dataset — the failure mode documented in
docs/JUDGE_DATA_QUALITY.md. Do not "fix" the script to make one of these pass
differently without a deliberate, separately reviewed data migration.

No test here may read from downloaded_cases/ — that directory is gitignored and
machine-local. process_case() falls back to reading
downloaded_cases/case_texts/<citation>.txt, so every process_case row below
either omits `citation` or sets it to "".
"""

from __future__ import annotations

import os
import tempfile

import pytest

from extract_structured_fields import (
    _clean_country_value,
    _demonym_to_country,
    _normalise_country,
    extract_country,
    extract_from_title,
    extract_hearing_date,
    extract_legal_test,
    extract_representation,
    extract_visa_outcome_reason,
    extract_visa_subclass_number,
    process_case,
)


# ---------------------------------------------------------------------------
# extract_from_title
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("title,expected", [
    # "X v Y" — FCA / FCCA / HCA style
    ("SZTAL v Minister for Immigration and Border Protection [2017] HCA 34",
     ("SZTAL", "Minister for Immigration and Border Protection")),
    # "X and Minister..." — AATA / ARTA style
    ("Nguyen and Minister for Immigration [2019] AATA 1234",
     ("Nguyen", "Minister for Immigration")),
    # anonymised numeric AATA id is rejected, not returned as a name
    ("1606474 (Migration) [2017] AATA 1", ("", "")),
    # AATA surname-only form yields an applicant but no respondent
    ("Singh (Migration) [2018] AATA 99", ("Singh", "")),
    ("", ("", "")),
])
def test_extract_from_title(title: str, expected: tuple[str, str]) -> None:
    assert extract_from_title(title) == expected


# ---------------------------------------------------------------------------
# country normalisation helpers
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("China MEMBER: John Smith", "China"),      # horizontal-format label bleed
    ("People's Republic of China", "China"),
    ("P.R.C.", "China"),
    ("Indian", "India"),                         # demonym fallback
    ("Republic of Korea", "Korea"),              # longest-substring match
    ("india.", "India"),                         # trailing punctuation + case
    ("", ""),
])
def test_normalise_country(raw: str, expected: str) -> None:
    assert _normalise_country(raw) == expected


@pytest.mark.parametrize("raw,expected", [
    ("China MEMBER: John Smith", "China"),
    ("P.R.C.", "P.R.C"),                         # strips only the final period
    ("india.", "india"),                         # does NOT normalise case
    ("", ""),
])
def test_clean_country_value(raw: str, expected: str) -> None:
    assert _clean_country_value(raw) == expected


@pytest.mark.parametrize("demonym,expected", [
    ("Indian", "India"),
    ("Chinese", "China"),
    ("iranian", "Iran"),                         # case-insensitive
    ("Nowhereian", ""),
])
def test_demonym_to_country(demonym: str, expected: str) -> None:
    assert _demonym_to_country(demonym) == expected


@pytest.mark.parametrize("text,expected", [
    ("COUNTRY OF REFERENCE: Iran\n\nDECISION", "Iran"),
    ("The applicant is a citizen of Nepal and arrived in 2019.", "Nepal"),
    ("Nationality: Viet Nam\n", "Viet Nam"),
    ("The applicant is an Indian national.", "India"),
    ("no country mentioned", ""),
    ("", ""),
])
def test_extract_country(text: str, expected: str) -> None:
    assert extract_country(text) == expected


# ---------------------------------------------------------------------------
# extract_visa_subclass_number
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("args,expected", [
    (("", "Subclass 500 Student", ""), "500"),                    # existing field
    (("", "", "Protection visa (subclass 866)"), "866"),          # visa_type field
    (("applied for a Subclass 482 visa", "", ""), "482"),         # body text
    (("no numbers here", "", ""), ""),
    # existing_subclass wins over the body text, even when they disagree
    (("Subclass 482", "820", ""), "820"),
])
def test_extract_visa_subclass_number(args: tuple[str, str, str], expected: str) -> None:
    assert extract_visa_subclass_number(*args) == expected


# ---------------------------------------------------------------------------
# extract_hearing_date
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("Date of hearing: 12 March 2024\nsome body", "12 March 2024"),
    ("DATE:\n\n5 July 2019\n\nMEMBER: A Person", "5 July 2019"),   # AATA block
    ("Statement made on 9 September 2016 at Sydney", "9 September 2016"),
    ("Date of judgment: 1 February 2021", "1 February 2021"),      # fallback
    ("nothing here at all", ""),
    ("", ""),
])
def test_extract_hearing_date(text: str, expected: str) -> None:
    assert extract_hearing_date(text) == expected


# ---------------------------------------------------------------------------
# extract_representation
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    # 2015+ DECISION RECORD label, MARN suffix stripped
    ("REPRESENTATIVE:\n\nMs J Smith (MARN: 1234567) CASE NUMBER: 1712345\n\nDECISION:",
     ("Yes", "Ms J Smith")),
    ("REPRESENTATIVE:\n\nMr A Nguyen\n\nDECISION:", ("Yes", "Mr A Nguyen")),
    ("The applicant was represented by Ms K Counsel\nat the hearing.",
     ("Yes", "Ms K Counsel")),
    ("The applicant appeared in person before the Tribunal.", ("No", "")),
    # FCA multiline appearance block
    ("Counsel for the Appellant:\nMr B Barrister\nSolicitor for the Appellant: Acme Legal",
     ("Yes", "Mr B Barrister")),
    # absence is "" (unknown), not "No"
    ("no representation information", ("", "")),
])
def test_extract_representation(text: str, expected: tuple[str, str]) -> None:
    assert extract_representation(text) == expected


# ---------------------------------------------------------------------------
# extract_visa_outcome_reason
# ---------------------------------------------------------------------------

def test_extract_visa_outcome_reason_happy_path() -> None:
    text = (
        "CATCHWORDS: MIGRATION - Student visa - genuine temporary entrant - "
        "decision affirmed\nLEGISLATION:\n"
    )
    assert extract_visa_outcome_reason(text) == (
        "Student visa - genuine temporary entrant - decision affirmed"
    )


def test_extract_visa_outcome_reason_no_catchwords() -> None:
    assert extract_visa_outcome_reason("no catchwords section") == ""
    assert extract_visa_outcome_reason("") == ""


def test_outcome_reason_without_terminator_drops_the_field() -> None:
    """CHARACTERIZATION OF A DEFECT — see the module docstring.

    RE_CATCHWORDS_SECTION only terminates on LEGISLATION / STATEMENT OF /
    DECISION AND REASONS / end-of-string. A document with none of those and no
    trailing newline yields NO match at all, so the field is silently dropped
    rather than partially extracted.
    """
    body = "CATCHWORDS: MIGRATION - Student visa\n\n" + ("filler words " * 60)
    assert extract_visa_outcome_reason(body) == ""


def test_outcome_reason_without_terminator_overcaptures_when_text_ends_in_newline() -> None:
    """CHARACTERIZATION OF A DEFECT — the mirror image of the test above.

    Add a trailing newline to the same document and the end-of-string branch
    matches instead, swallowing the entire body into the catchwords field,
    truncated to 300 chars plus an ellipsis.
    """
    body = "CATCHWORDS: MIGRATION - Student visa\n\n" + ("filler words " * 60) + "\n"
    got = extract_visa_outcome_reason(body)
    assert got.startswith("Student visa filler words")
    assert got.endswith("...")
    assert len(got) == 301


# ---------------------------------------------------------------------------
# extract_legal_test
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("CATCHWORDS: MIGRATION - protection visa - s.36 of the Act", "s.36 refugee test"),
    ("CATCHWORDS: MIGRATION - visa cancellation under s 501", "s.501 character test"),
    ("CATCHWORDS: MIGRATION - genuine temporary entrant criterion",
     "genuine temporary entrant test"),
    ("nothing legal here", ""),
    ("", ""),
])
def test_extract_legal_test(text: str, expected: str) -> None:
    assert extract_legal_test(text) == expected
```

**Verify**:

```bash
.venv/bin/python -m pytest tests/test_extraction_structured_fields.py -q -o addopts=""
```
→ `52 passed`

(52 at this point; step 3 adds the remaining 4 for a file total of 56.)

### Step 3: Add the `process_case` integration tests to the same file

Append the following to `tests/test_extraction_structured_fields.py`,
transcribed exactly. `process_case` is the seam the batch job actually calls,
and it is the largest uncovered block in the script
(`extract_structured_fields.py:876-969`).

```python
# ---------------------------------------------------------------------------
# process_case — the integration seam the batch job calls
#
# NOTE: every row below omits `citation` or sets it to "". process_case falls
# back to reading downloaded_cases/case_texts/<citation>.txt (see
# extract_structured_fields.py:896-903); a plausible citation would make these
# tests read a gitignored, machine-local corpus and behave differently in CI.
# ---------------------------------------------------------------------------

PROCESS_CASE_KEYS = (
    "applicant_name",
    "respondent",
    "country_of_origin",
    "visa_subclass_number",
    "hearing_date",
    "is_represented",
    "representative",
    "visa_outcome_reason",
    "legal_test_applied",
)


def _tmp_case_text(text: str) -> str:
    """Write `text` to a tempfile and return its path (caller unlinks)."""
    fd, path = tempfile.mkstemp(suffix=".txt", text=True)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    return path


def test_process_case_extracts_every_field_from_an_aata_style_document() -> None:
    text = (
        "CATCHWORDS: MIGRATION - Student visa - genuine temporary entrant - "
        "decision affirmed\n"
        "LEGISLATION:\n\n"
        "APPLICANT:\n\nJane Citizen CASE NUMBER: 1712345\n\n"
        "REPRESENTATIVE:\n\nMs J Smith (MARN: 1234567) CASE NUMBER: 1712345\n\n"
        "COUNTRY OF REFERENCE: Nepal\n\n"
        "Date of hearing: 12 March 2024\n\n"
        "The applicant applied for a Subclass 500 visa.\n"
    )
    path = _tmp_case_text(text)
    try:
        got = process_case({
            "title": "Citizen and Minister for Immigration [2024] AATA 1",
            "citation": "",
            "visa_subclass": "",
            "visa_type": "",
            "full_text_path": path,
        })
    finally:
        os.unlink(path)

    assert got["applicant_name"] == "Citizen"
    assert got["respondent"] == "Minister for Immigration"
    assert got["country_of_origin"] == "Nepal"
    assert got["visa_subclass_number"] == "500"
    assert got["hearing_date"] == "12 March 2024"
    assert got["is_represented"] == "Yes"
    assert got["representative"] == "Ms J Smith"
    assert got["legal_test_applied"] == "genuine temporary entrant test"


def test_process_case_empty_row_returns_all_nine_keys_blank() -> None:
    assert process_case({}) == {key: "" for key in PROCESS_CASE_KEYS}


def test_process_case_falls_back_to_structured_labels_when_title_is_useless() -> None:
    text = (
        "REVIEW APPLICANT: Ali Hassan CASE NUMBER: 1512345\n\n"
        "Respondent: Minister for Home Affairs\n\n"
        "APPLICANT'S REPRESENTATIVE:\n\nMr P Agent\n\nDECISION\n"
    )
    path = _tmp_case_text(text)
    try:
        got = process_case({"title": "", "citation": "", "full_text_path": path})
    finally:
        os.unlink(path)

    assert got["applicant_name"] == "Ali Hassan"
    assert got["respondent"] == "Minister for Home Affairs"


def test_process_case_missing_text_file_is_not_an_error() -> None:
    got = process_case({
        "title": "A v B [2020] FCA 1",
        "citation": "",
        "full_text_path": "/nonexistent/definitely-not-here.txt",
    })
    assert got["applicant_name"] == "A"
    assert got["respondent"] == "B"
    assert got["country_of_origin"] == ""
```

**Verify** (both must hold):

```bash
.venv/bin/python -m pytest tests/test_extraction_structured_fields.py -q -o addopts=""
```
→ `56 passed`

```bash
.venv/bin/python -m pytest tests/test_extraction_structured_fields.py -q \
  -o addopts="--cov=extract_structured_fields --cov-report=term" 2>&1 | tail -6
```
→ a table row reading `extract_structured_fields.py     514    204    60%`
(the `Miss` column must be **≤ 205** and `Cover` **≥ 60%**; an exact match of
`204 / 60%` is what was measured at `42826a3`).

### Step 4: Record the importability of the remaining root extraction scripts

Create `tests/test_extraction_script_imports.py` with exactly this content.
This turns "four scripts cannot be imported in the test environment" from an
invisible fact into a skipped test with a stated reason — and it means the day
someone adds `anthropic` to the test requirements, these start running instead
of staying silently absent.

```python
"""Import smoke tests for the repo-root extraction scripts.

Six root-level scripts totalling 2,821 lines drive the case-catalog extraction
pipeline. Only extract_structured_fields.py is meaningfully covered (see
tests/test_extraction_structured_fields.py). This module records the import
status of the rest so the gap is visible in test output rather than absent from
it: a module that is never imported does NOT appear in a --cov report at all,
it only emits a CoverageWarning.

Importing a module is a weak test, but it is strictly better than nothing: it
catches syntax errors, bad top-level constants and import-time side effects,
none of which any other test in this repo would catch for these files.
"""

from __future__ import annotations

import importlib

import pytest


def test_download_fulltext_imports_cleanly() -> None:
    """download_fulltext has no third-party deps beyond the app requirements."""
    module = importlib.import_module("download_fulltext")
    assert hasattr(module, "main")


# These four import `anthropic`, which is deliberately NOT in the test
# requirements — see plans/041 "Why the other four scripts cannot simply be
# tested". They skip today and start running if that dependency is ever added.
LLM_EXTRACTION_SCRIPTS = [
    "extract_llm_structured",
    "extract_structured_fields_llm",
    "extract_llm_fields",
    "extract_with_llm",
]


@pytest.mark.parametrize("module_name", LLM_EXTRACTION_SCRIPTS)
def test_llm_extraction_script_imports_cleanly(module_name: str) -> None:
    pytest.importorskip(
        "anthropic",
        reason="anthropic is not a test dependency; these scripts are unimportable here",
    )
    importlib.import_module(module_name)
```

**Verify**:

```bash
.venv/bin/python -m pytest tests/test_extraction_script_imports.py -q -o addopts="" -rs
```
→ `1 passed, 4 skipped`, and the skip reason mentions `anthropic`.

### Step 5: Widen the coverage scope in `pytest.ini`

Edit `pytest.ini` line 3 only. Change:

```ini
addopts = -v --cov=immi_case_downloader --cov-report=term-missing
```

to:

```ini
addopts = -v --cov=immi_case_downloader --cov=extract_structured_fields --cov=postprocess --cov-report=term-missing
```

Add **only** those two modules. Do not add the four `anthropic`-dependent
scripts or `download_fulltext` — a module that no test imports is omitted from
the report and emits a `CoverageWarning` instead, which is noise, not signal.
Do not add `--cov-fail-under`.

Leave every other line of `pytest.ini` untouched.

**Verify**:

```bash
.venv/bin/python -m pytest tests/test_extraction_structured_fields.py \
  tests/test_postprocess_judges.py -q --no-header -p no:cacheprovider 2>&1 \
  | grep -E "^extract_structured_fields|^postprocess"
```
→ two rows, e.g.
`extract_structured_fields.py   514   204   60% ...` and
`postprocess.py                 292   179   39% ...`

### Step 6: Full-suite verification

```bash
make lint
.venv/bin/ruff check tests/test_extraction_structured_fields.py tests/test_extraction_script_imports.py
make test-py
git status --short
```

**Verify**:
- `make lint` → `All checks passed!`
- the `ruff check` on the two new files → `All checks passed!`
- `make test-py` → passed count is **1141 + 57 = 1198**, skipped is
  **7 + 4 = 11**. The failure count is whatever it was before you started
  (3 on Homebrew Python 3.14.7, 0 elsewhere) and must not have increased.
- `git status --short` lists exactly three paths:
  `pytest.ini`, `tests/test_extraction_structured_fields.py`,
  `tests/test_extraction_script_imports.py`
  (plus `plans/` if you updated the index). Nothing else.

## Test plan

**New file `tests/test_extraction_structured_fields.py` — 56 tests:**

| Function under test | Tests | Cases covered |
|---|---:|---|
| `extract_from_title` | 5 | `X v Y`; `X and Minister`; anonymised numeric id rejected; AATA surname-only; empty |
| `_normalise_country` | 7 | label bleed; PRC long form; `P.R.C.`; demonym; longest-substring; punctuation/case; empty |
| `_clean_country_value` | 4 | label bleed; trailing period; case preserved; empty |
| `_demonym_to_country` | 4 | two known; case-insensitive; unknown |
| `extract_country` | 6 | `COUNTRY OF REFERENCE:`; `citizen of X`; `Nationality:`; `X national`; absent; empty |
| `extract_visa_subclass_number` | 5 | existing field; visa_type; body text; absent; precedence when sources disagree |
| `extract_hearing_date` | 6 | `Date of hearing:`; AATA `DATE:` block; `Statement made on`; `Date of judgment:` fallback; absent; empty |
| `extract_representation` | 6 | DECISION RECORD + MARN strip; plain label; `represented by`; self-represented; FCA counsel block; unknown-is-`""` |
| `extract_visa_outcome_reason` | 4 | happy path; no catchwords/empty; **defect: silently drops field with no terminator**; **defect: swallows whole body when text ends in newline** |
| `extract_legal_test` | 5 | s.36; s.501; genuine temporary entrant; absent; empty |
| `process_case` | 4 | all nine fields from an AATA-style doc; empty row → nine blank keys; title-less doc falls back to structured labels; missing text file does not raise |

**New file `tests/test_extraction_script_imports.py` — 5 tests** (1 passing,
4 skipped): `download_fulltext` import smoke, and one parametrized
`importorskip`-gated import per `anthropic`-dependent script.

**Structural pattern to model after**: `tests/test_postprocess_judges.py` —
same repo-root-script import style, same `@pytest.mark.parametrize` tables with
a per-row comment, same `tempfile.mkstemp` helper shape.

**Regression this locks in**: any edit to a regex in
`extract_structured_fields.py` that changes what a field extracts now fails a
named test. The two `test_outcome_reason_without_terminator_*` tests
deliberately pin known-bad behaviour so that a future fix is a *deliberate*,
reviewed change with a visible data-migration decision attached — not a silent
reshape of 149,016 rows.

**Verification**: `make test-py` → 1198 passed, 11 skipped, failure count
unchanged from baseline.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.venv/bin/python -m pytest tests/test_extraction_structured_fields.py -q -o addopts=""` → `56 passed`
- [ ] `.venv/bin/python -m pytest tests/test_extraction_script_imports.py -q -o addopts=""` → `1 passed, 4 skipped`
- [ ] `.venv/bin/python -m pytest tests/test_extraction_structured_fields.py -q -o addopts="--cov=extract_structured_fields --cov-report=term" 2>&1 | grep "^extract_structured_fields"` shows `Miss` ≤ 205 and `Cover` ≥ 60%
- [ ] `grep -c -- "--cov=extract_structured_fields" pytest.ini` → `1`
- [ ] `grep -c -- "--cov=postprocess" pytest.ini` → `1`
- [ ] `grep -c -- "--cov-fail-under" pytest.ini` → `0`
- [ ] `.venv/bin/python -m pytest tests/test_extraction_structured_fields.py tests/test_postprocess_judges.py -q --no-header 2>&1 | grep -cE "^(extract_structured_fields|postprocess)\.py"` → `2`
- [ ] `make lint` → `All checks passed!`
- [ ] `.venv/bin/ruff check tests/test_extraction_structured_fields.py tests/test_extraction_script_imports.py` → `All checks passed!`
- [ ] `make test-py` → `1198 passed` and `11 skipped`; failure count not higher than the baseline you recorded in step 1
- [ ] `grep -rn "downloaded_cases" tests/test_extraction_structured_fields.py tests/test_extraction_script_imports.py` → no matches
- [ ] `git diff --stat 42826a3..HEAD -- extract_structured_fields.py` → empty (the script was not modified)
- [ ] `git status --short` lists only `pytest.ini`, `tests/test_extraction_structured_fields.py`, `tests/test_extraction_script_imports.py` (and `plans/` if the index was updated)
- [ ] `plans/README.md` status row updated, **if that file exists**

## STOP conditions

Stop and report back (do not improvise) if:

1. **Plan 032 has already landed.**
   `grep -n "from extract_structured_fields import" immi_case_downloader/extraction/regex.py`
   returns nothing, or `extract_structured_fields.py` no longer exists at the
   repo root. `plans/032-consolidate-the-extraction-scripts.md` moves these
   helper functions into the package and inverts the import direction. Every
   import line and several expected values in this plan would then be wrong.
   Report which module now owns `extract_from_title` / `extract_country` /
   `process_case` and stop — do not guess the new import path.

2. **The script has drifted.** Step 1's coverage table does not report
   `514` statements for `extract_structured_fields.py`, or any expected value
   you transcribe fails to reproduce. These are measured constants; a mismatch
   means the regexes changed since `42826a3` and the correct expected values
   must be re-measured rather than adjusted by hand.

3. **A test's result depends on the machine.** If
   `tests/test_extraction_structured_fields.py` passes on your machine but you
   cannot explain a value without referring to `downloaded_cases/`, you have
   hit the corpus-fallback hazard described in "Current state". Stop and
   report — a test that reads the local 142,966-file corpus will behave
   differently in CI and is worse than no test.

4. **A characterization assertion tempts you to edit the script.** If making a
   test pass appears to require changing `extract_structured_fields.py`, that
   is out of scope by construction — the script feeds 149,016 catalog rows and
   the production extraction container. Record the assertion's *measured*
   value, note the defect in your report, and move on.

5. **`make test-py` failures increase.** If the failure count rises above the
   baseline you recorded in step 1, a new test is interacting with an existing
   one (most likely via the corpus fallback or a leaked tempfile). Do not
   delete or `skip` the failing test to get green.

6. **You are tempted to add `anthropic` to a requirements file** to make the
   four skipped tests run. That is a dependency decision with cost and
   licensing implications, it is out of scope, and plan 032 is consolidating
   those four scripts anyway.

7. Any step's verification fails twice after one reasonable fix attempt.

## Maintenance notes

For whoever owns this code next:

- **Single-file pytest runs now emit two harmless warnings.** After step 5,
  running e.g. `.venv/bin/pytest tests/test_models.py` prints
  `CoverageWarning: Module extract_structured_fields was never imported` and
  the same for `postprocess`, because neither is imported by that file. The
  warning is cosmetic, does not fail anything, and disappears on a full-suite
  run. Suppressing it would require an `omit`/`source` rework in a
  `.coveragerc` that is not worth the complexity today.

- **These are characterization tests, not a specification.** Four assertions
  pin behaviour that is arguably wrong: `_clean_country_value("P.R.C.")`
  returning `"P.R.C"`, `extract_representation` returning `""` (not `"No"`)
  when representation is simply unstated, and both
  `test_outcome_reason_without_terminator_*` cases. A reviewer should confirm
  each such test carries the "CHARACTERIZATION OF A DEFECT" comment or an
  explanatory row comment, so nobody later reads them as intended behaviour.

- **The catchwords defect is the one worth fixing next, separately.**
  `RE_CATCHWORDS_SECTION` (`extract_structured_fields.py:354-357`) terminates
  only on `LEGISLATION`, `STATEMENT OF`, `DECISION AND REASONS` or
  end-of-string within an 8,000-char window. Documents with none of those
  either lose `visa_outcome_reason` entirely or have the whole body dumped into
  it. Fixing it changes real values across the catalog, so it needs its own
  plan with a `<col>_backup` column and a `LIMIT 100` dry-run — see the
  "Production data cleanup rule" in `CLAUDE.md` and the post-mortem in
  `docs/JUDGE_DATA_QUALITY.md`.

- **This plan is a de-risker for plan 032, so run it first.** Plan 032
  restructures these exact functions. Landing these 56 tests beforehand turns
  that refactor from "hope the regexes survived" into a mechanical
  green/red check. If 032 lands first, these tests must be rewritten against
  the new module layout (STOP condition 1).

- **Deliberately deferred**: raising `extract_structured_fields.py` above 60%
  (the remaining uncovered blocks are `load_csv`/`save_csv`/`main` — CSV I/O
  and argparse plumbing, low value per test); any coverage for the four
  `anthropic`-dependent scripts; and any coverage floor
  (`--cov-fail-under`), which cannot be set repo-wide while the total sits at
  13%. Once plan 032 consolidates the LLM scripts, a per-module floor becomes
  worth revisiting.

## Findings reconsidered

Two claims in the audit that produced this plan did not survive verification
against the code at `42826a3`. Both are corrected above; recorded here so
nobody re-audits them.

- **"3,425 lines are imported by zero tests" — the number is wrong and so is
  one of the files.** `postprocess.py` (509 lines) *is* tested:
  `tests/test_postprocess_judges.py:13` does
  `from postprocess import _looks_like_judge_name, extract_metadata` and the
  file contributes 37 collected tests, measuring `postprocess.py` at 39%.
  Excluding it, the genuinely thin set is 2,821 lines:
  `extract_structured_fields.py` (1,136), `extract_llm_structured.py` (546),
  `extract_structured_fields_llm.py` (450), `extract_llm_fields.py` (275),
  `extract_with_llm.py` (211), `download_fulltext.py` (203) — line counts
  confirmed with `wc -l`. The plan uses 2,821 throughout.

- **"`extract_structured_fields.py` imports nothing from
  `immi_case_downloader`, so `immi_case_downloader/extraction/regex.py` is a
  separate implementation, not the same code" — false, and backwards.** The
  dependency runs the other way: `immi_case_downloader/extraction/regex.py:14`
  imports seven functions and two compiled regexes *from* the root script.
  Consequently `tests/test_extraction_regex.py` does execute that script
  transitively, and it measures at **27%** (514 stmts, 373 missed), not 0%.
  "Zero tests import it" is therefore wrong; the accurate statement — and the
  real problem — is that the script has **one** happy-path test making six
  assertions, and `pytest.ini:3` scopes `--cov` to `immi_case_downloader` so
  the 27% has never appeared in any report. The plan is written against the
  corrected picture.

- **The fix sketch's "write characterization tests from a corpus of real
  case_texts/\*.txt" is not safely implementable and was rejected.**
  `downloaded_cases/` is gitignored (`.gitignore:17`); the corpus exists only
  on developer machines (142,966 files locally, zero in CI). A corpus-derived
  test either fails in CI or skips there, providing no gate. Worse,
  `process_case` *already* silently falls back to reading
  `downloaded_cases/case_texts/<citation>.txt`
  (`extract_structured_fields.py:896-903`), so a careless fixture would read
  the corpus by accident. The plan uses inline fixtures with values measured
  from the real code instead, and adds an explicit prohibition on reading
  `downloaded_cases/` from any test.

- **The fix sketch's "widen pytest.ini's `--cov` to include the top-level
  scripts so the gap becomes visible" does not work as stated, and was
  narrowed.** Measured with coverage 7.14.0: a module listed under `--cov`
  that no test imports produces
  `CoverageWarning: Module <name> was never imported (module-not-imported)`
  and is **omitted from the report entirely** — it does not appear as a 0%
  row. Also measured: `--cov=<file>.py` (a path rather than a module name)
  yields `WARNING: Failed to generate report: No data to report.` So step 5
  adds only the two modules that tests actually import, and step 4 makes the
  remaining gap visible through an executable skipped test instead.

- **TEST-18 ("the ~1,857 headline test count overstates production coverage")
  is out of this plan's territory and is not addressed here.** Its remedy is
  editing the counts in `CLAUDE.md` and the `Makefile` help text to split
  production-Worker from local-dev-Flask coverage — files this plan does not
  own and must not touch. One correction for whoever picks it up:
  `tests/test_internal_extract.py` is **not** "a test defending a retired
  design". The `X-Internal-Route` guard it exercises is live in
  `extract_container.py:26-28` (the deployed extraction container behind
  `Dockerfile.extractor` and `workers/extraction-container.js`);
  `immi_case_downloader/web/internal_extract.py:15-19` is a Flask mirror of
  it. The fair criticism is that the test covers the local-dev mirror rather
  than the container, not that the pattern is dead. Note also that the "578 of
  1,106 tests are Flask" figure is file-level attribution — it counts every
  test in any file mentioning `test_client`/`create_app`, so it is an upper
  bound.
