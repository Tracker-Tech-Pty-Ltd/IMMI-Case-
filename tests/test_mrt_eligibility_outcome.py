from __future__ import annotations

import hashlib
import sqlite3
from contextlib import closing
from tempfile import TemporaryDirectory
from pathlib import Path

import pytest

from immi_case_downloader.extraction.grounded import assess_case
from immi_case_downloader.repair_workflow import validate_approvals


def test_mrt_non_reviewable_notice_can_support_no_jurisdiction_review():
    citation = "[2003] MRTA 409"
    title = "Liu, Xin Rong [2003] MRTA 409 (30 May 2003)"
    url = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/MRTA/2003/409.html"
    source_text = (
        f"Title: {title}\n"
        f"Citation: {citation}\n"
        f"URL: {url}\n"
        + "=" * 80
        + "\nAustLII page-title metadata: "
        + title
        + "\n\nADVICE OF ELIGIBILITY DECISION\n"
        "CATCHWORDS: Eligibility - ineligible for review - not an MRT-reviewable decision\n"
        "REVIEW APPLICANTS: Ms Xin Rong Liu\n"
        "TRIBUNAL: Migration Review Tribunal\n"
        "PRESIDING MEMBER: Julie Bail\n"
        "DATE OF DECISION: 30 May 2003\n"
        "DECISION: The Tribunal has made a decision that the application for review of "
        "your subclass 457 (Business (Long Stay)) visa refusal was ineligible for the "
        "following reason: _the decision for which the applicant has sought review is "
        "not an_ _MRT-reviewable decision under section 338 of the Migration Act 1958._\n"
    )
    assessment = assess_case(
        source_text, citation=citation, title=title, url=url
    )
    assert assessment.source_status == "checked"
    proof = assessment.values["outcome"]
    assert proof.rule == "published_operative_table"

    with TemporaryDirectory() as directory:
        root = Path(directory)
        data = root / "downloaded_cases"
        data.mkdir()
        source = data / "case.txt"
        source.write_text(source_text, encoding="utf-8")
        with closing(sqlite3.connect(data / "cases.db")) as conn:
            conn.execute(
                "CREATE TABLE cases (case_id TEXT PRIMARY KEY, citation TEXT, "
                "title TEXT, url TEXT, full_text_path TEXT, outcome TEXT)"
            )
            conn.execute(
                "INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?)",
                (
                    "case-409",
                    citation,
                    title,
                    url,
                    "downloaded_cases/case.txt",
                    "No jurisdiction",
                ),
            )
            conn.commit()

        approval = {
            "case_id": "case-409",
            "field": "outcome",
            "expected_current_by_store": {
                "database": "No jurisdiction",
                "csv": "",
                "json": "an unnormalized notice",
            },
            "source_path": "downloaded_cases/case.txt",
            "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "evidence": {
                "value": "No jurisdiction",
                "source_value": proof.value,
                "quote": proof.quote,
                "method": "manual_source_bound_outcome_review",
            },
            "reviewer": "independent-source-review",
            "review_note": "The exact MRT eligibility notice says this was not an MRT-reviewable decision.",
        }
        validate_approvals(root, [approval])

        invalid = dict(approval)
        invalid["evidence"] = dict(approval["evidence"], value="Refused")
        with pytest.raises(ValueError, match="exact, matching operative decision"):
            validate_approvals(root, [invalid])
