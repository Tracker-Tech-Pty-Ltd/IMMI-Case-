"""Characterization tests for extract_structured_fields.py.

This module pins the CURRENT behaviour of the regex extractors that populate
applicant_name / respondent / country_of_origin / visa_subclass_number /
hearing_date / is_represented / representative / visa_outcome_reason /
legal_test_applied across the 149,016-row case catalog.

These are characterization tests: they pin what the code does so that a change
to a regex shows up as a failing test instead of silently reshaping a field
across the whole dataset — the failure mode documented in
docs/JUDGE_DATA_QUALITY.md. Do not "fix" the script to make one of these pass
differently without a deliberate, separately reviewed data migration.

Two behaviours below are KNOWN DEFECTS. They are written as
@pytest.mark.xfail(strict=True) asserting the CORRECT value, never as green
assertions on the wrong value. A green assertion on wrong output turns data
loss into the specification: it reads to the next maintainer as intended
behaviour, and fixing the code then looks like breaking a test. strict=True
means an XPASS is a failure, so the day the defect is fixed the suite says so
loudly and the marker is removed in the same commit.

No test here may read the machine-local case corpus. process_case() falls back
to reading CASES_DIR/<citation>.txt (extract_structured_fields.py:896-903), and
CASES_DIR is a gitignored directory holding ~142,966 real files on a developer
machine and zero in CI. Two independent guards below:

  1. the autouse _isolate_case_corpus fixture repoints CASES_DIR at an empty
     tmp_path for every test in this module, so even a careless fixture cannot
     reach the real corpus; and
  2. every process_case row still omits `citation` or sets it to "".

Guard (1) is the load-bearing one, and it is tested — see
test_corpus_isolation_fixture_is_effective.

# The extraction coverage gate (run explicitly; not part of `make test-py`):
#   .venv/bin/pytest tests/test_extraction_structured_fields.py \
#     tests/test_postprocess_judges.py -q -p no:cacheprovider \
#     --cov=extract_structured_fields --cov=postprocess \
#     --cov-report=term --cov-fail-under=60
"""

from __future__ import annotations

import os
import tempfile

import pytest

import extract_structured_fields as esf
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
# Corpus isolation — a runtime guard, not a source-text convention
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _isolate_case_corpus(monkeypatch, tmp_path):
    """Repoint CASES_DIR at an empty temp dir for every test in this module.

    extract_structured_fields.CASES_DIR is Path("downloaded_cases/case_texts")
    (extract_structured_fields.py:29) and process_case() reads
    CASES_DIR/<citation>.txt when a row has a citation but no full_text_path
    (:896-903). On a developer machine that directory holds ~142,966 real case
    files; in CI it holds none. A test that reached it would therefore produce
    different results on different machines — worse than no test.

    Looked up as a module global at call time, so monkeypatching the attribute
    is sufficient; no import-order care is needed.
    """
    monkeypatch.setattr(esf, "CASES_DIR", tmp_path / "case_texts")


def test_corpus_isolation_fixture_is_effective(tmp_path) -> None:
    """Prove the guard actually redirects the lookup, rather than assuming it.

    Writes a file under the *redirected* CASES_DIR and shows process_case reads
    it. If the fixture ever stops applying, process_case would look in the real
    downloaded_cases/case_texts instead, find nothing for this citation, and
    return blanks — failing this test loudly.
    """
    corpus = esf.CASES_DIR
    corpus.mkdir(parents=True, exist_ok=True)
    (corpus / "ISOLATION-PROBE.txt").write_text(
        "COUNTRY OF REFERENCE: Nepal\n\nDECISION", encoding="utf-8"
    )
    got = process_case({"title": "", "citation": "ISOLATION-PROBE"})
    assert got["country_of_origin"] == "Nepal"
    assert str(esf.CASES_DIR) != "downloaded_cases/case_texts"


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


@pytest.mark.xfail(
    strict=True,
    reason=(
        "DEFECT: RE_CATCHWORDS_SECTION (extract_structured_fields.py:354-357) "
        "terminates only on LEGISLATION / STATEMENT OF / DECISION AND REASONS / "
        "end-of-string. With none of those and no trailing newline there is NO "
        "match at all, so visa_outcome_reason is silently dropped. Today this "
        "returns ''."
    ),
)
def test_outcome_reason_without_terminator_should_still_extract_the_catchwords() -> None:
    """EXPECTED TO FAIL — asserts the CORRECT value, not the current one.

    Written as xfail(strict=True) rather than as a green assertion on "" so
    that the right answer is recorded in the source and a fix produces a loud,
    intentional XPASS failure instead of looking like a broken test. The
    expected value is not invented: adding a terminator to the same document
    yields exactly "Student visa" today
    (extract_visa_outcome_reason("CATCHWORDS: MIGRATION - Student visa\\nLEGISLATION:\\n")).
    """
    body = "CATCHWORDS: MIGRATION - Student visa\n\n" + ("filler words " * 60)
    assert extract_visa_outcome_reason(body) == "Student visa"


@pytest.mark.xfail(
    strict=True,
    reason=(
        "DEFECT (mirror image): add a trailing newline to the same document and "
        "the end-of-string branch matches instead, swallowing the whole body "
        "into the catchwords field, truncated to 300 chars plus an ellipsis. "
        "Today this returns a 301-character string starting 'Student visa "
        "filler words'."
    ),
)
def test_outcome_reason_with_trailing_newline_should_not_swallow_the_body() -> None:
    """EXPECTED TO FAIL — asserts the CORRECT value.

    The same document must yield the same catchwords whether or not it happens
    to end in a newline. That it does not is the defect.
    """
    body = "CATCHWORDS: MIGRATION - Student visa\n\n" + ("filler words " * 60) + "\n"
    assert extract_visa_outcome_reason(body) == "Student visa"


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
