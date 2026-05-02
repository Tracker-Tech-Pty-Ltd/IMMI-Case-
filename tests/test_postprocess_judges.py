"""Tests for the judges-field extraction sanity check in postprocess.py.

Covers the regex bug fix from docs/JUDGE_DATA_QUALITY.md (autopilot scope D).
"""

from __future__ import annotations

import os
import tempfile

import pytest

from postprocess import _looks_like_judge_name, extract_metadata


# ---------------------------------------------------------------------------
# _looks_like_judge_name unit tests
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", [
    "Smith J",
    "Kira Raif",
    "Richard Derewlany",
    "Michael Cooke",
    "Justice Allsop",
    "Justice Kenny",
    "Lucinda Wright",
    "T Delofski",          # initial + surname is legitimate
    "C Packer",
    "David B. Mitchell",   # middle initial with period kept
])
def test_accepts_real_judge_names(name: str) -> None:
    assert _looks_like_judge_name(name) is True, f"should accept: {name!r}"


@pytest.mark.parametrize("garbage", [
    "DATE",                                    # the 2,180-row placeholder
    "date",                                    # lowercase placeholder
    "of the family unit",                      # prose with "of the"
    "OF THE REFUGEE REVIEW TRIBUNAL",          # uppercase but prose
    "to make the order; and",                  # prose with "the"
    "of a group. The persecution",             # multi-sentence garbage
    "1 October 2001 was substantially to the same effect.)", # date prose
    "and the requirements of s.424A of the",   # phrase with "the"
    "(Judge Street) dismissed the",            # has parens AND prose
    "Smith — Anderson",                   # em-dash
    "Smith [REDACTED] Anderson",               # brackets
    "the Tribunal",                            # starts lowercase
    "smith j",                                 # lowercase start
    "",                                        # empty
    "   ",                                     # whitespace only
    "JUDGE",                                   # bad token
    "MEMBER",                                  # bad token
    "x" * 100,                                 # too long
    "DATE\nOF ORDER",                          # multi-line column collision (real bug from prod dry-run)
    "Smith J\nDATE",                           # newline anywhere
    "Smith\tJ",                                # tab anywhere
])
def test_rejects_garbage(garbage: str) -> None:
    assert _looks_like_judge_name(garbage) is False, (
        f"should reject: {garbage!r}"
    )


# ---------------------------------------------------------------------------
# extract_metadata integration tests (judges field only)
# ---------------------------------------------------------------------------

def _make_row_with_text(text: str) -> tuple[dict, str]:
    """Helper: create a row dict pointing at a tempfile containing `text`."""
    fd, path = tempfile.mkstemp(suffix=".txt", text=True)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    return {"full_text_path": path, "judges": ""}, path


def test_extracts_clean_judge_name() -> None:
    text = (
        "[2024] AATA 123\n"
        "JUDGES: Smith J\n"
        "DATE: 15 March 2024\n"
        "...body of the judgment...\n"
    )
    row, path = _make_row_with_text(text)
    try:
        extract_metadata([row])
        assert row["judges"] == "Smith J"
    finally:
        os.unlink(path)


def test_rejects_date_placeholder_collision() -> None:
    """The exact bug pattern that produced the 2,180-row 'DATE' cluster."""
    text = (
        "[2024] AATA 123\n"
        "JUDGE: DATE:\n"           # PDF column collision
        "15 March 2024\n"
        "Body text follows.\n"
    )
    row, path = _make_row_with_text(text)
    try:
        extract_metadata([row])
        assert row["judges"] == "" or row["judges"] != "DATE", (
            f"should NOT capture 'DATE' as judge name, got: {row['judges']!r}"
        )
    finally:
        os.unlink(path)


def test_rejects_prose_after_label() -> None:
    """Greedy [^\\n]+ would have captured the prose; new regex + sanity must not."""
    text = (
        "Reasons for decision:\n"
        "JUDGES of the same family unit are required to attend the hearing.\n"
        # Note: deliberately no proper "JUDGES: Name" label here
    )
    row, path = _make_row_with_text(text)
    try:
        extract_metadata([row])
        # Must not have captured "of the same family unit are required to..."
        if row["judges"]:
            assert _looks_like_judge_name(row["judges"]), (
                f"captured invalid judge: {row['judges']!r}"
            )
    finally:
        os.unlink(path)


def test_handles_before_coram_label() -> None:
    text = (
        "FEDERAL COURT OF AUSTRALIA\n"
        "Before: Justice Allsop\n"
        "...\n"
    )
    row, path = _make_row_with_text(text)
    try:
        extract_metadata([row])
        assert row["judges"] == "Justice Allsop"
    finally:
        os.unlink(path)


def test_skips_membership_word_match() -> None:
    """Old regex's lack of \\b matched inside 'MEMBERS', 'DISMEMBERED'.

    With \\b boundary and label-after-colon shape, prose like
    'TRIBUNAL MEMBERS are required to attend' should NOT trigger a match.
    """
    text = (
        "All TRIBUNAL MEMBERS are required to attend the hearing.\n"
        "The TRIBUNAL MEMBER assigned was unable to participate.\n"
    )
    row, path = _make_row_with_text(text)
    try:
        extract_metadata([row])
        # No properly-formatted "MEMBER: Name" pattern, so judges stays empty,
        # OR if a match happened it must pass sanity (which prose won't).
        if row["judges"]:
            assert _looks_like_judge_name(row["judges"]), (
                f"unexpectedly captured: {row['judges']!r}"
            )
    finally:
        os.unlink(path)
