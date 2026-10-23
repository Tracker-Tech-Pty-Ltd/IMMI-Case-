import hashlib
import sqlite3

import pytest

from immi_case_downloader.repair_workflow import validate_approvals


TARGET_CITATION = "[2026] FCA 1449"
PARENT_CITATION = "[2024] FedCFamC2G 1268"
TARGET_URL = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/FCA/2026/1449.html"
PARENT_URL = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/FedCFamC2G/2024/1268.html"
TARGET_TITLE = (
    "Singh v Minister for Immigration and Multicultural Affairs "
    "[2026] FCA 1449 (1 October 2026)"
)
PARENT_TITLE = (
    "Singh v Minister for Immigration and Multicultural Affairs "
    "[2024] FedCFamC2G 1268 (22 November 2024)"
)
TARGET_QUOTE = (
    "Appeal from:\nApplication for leave to appeal from\n"
    "Singh v Minister for Immigration and Multicultural Affairs\n"
    "[2024] FedCFamC2G 1268"
)
PARENT_QUOTE = "Mr Singh applied for a student visa."


def _source(title: str, citation: str, url: str, body: str) -> str:
    return (
        f"Title: {title}\nCitation: {citation}\nURL: {url}\n"
        "========================================\n"
        f"{body}\n"
    )


def _fixture(tmp_path, *, target_title=TARGET_TITLE, parent_title=PARENT_TITLE):
    data = tmp_path / "downloaded_cases"
    source_dir = data / "case_texts"
    source_dir.mkdir(parents=True)
    target_path = source_dir / "target.txt"
    parent_path = source_dir / "parent.txt"
    target_text = _source(
        target_title,
        TARGET_CITATION,
        TARGET_URL,
        target_title.split(" (")[0] + "\n"
        + TARGET_QUOTE
        + "\nFile number: VID 1321 of 2024\n"
        "REASONS FOR JUDGMENT\n"
        "The Court requested dates of mutual availability and proposed orders. The "
        "applicant did not respond to the directions or file the required written "
        "submissions. The respondent provided the material requested by the Court. "
        "The matter was listed for hearing, but the applicant did not appear. The "
        "proceeding concerns compliance with procedural directions and no substantive "
        "submissions were received. The application for leave to appeal is dismissed.",
    )
    parent_text = _source(
        parent_title,
        PARENT_CITATION,
        PARENT_URL,
        parent_title.split(" (")[0] + "\n"
        "Catchwords: MIGRATION - Student visa - reinstatement application\n"
        "REASONS FOR JUDGMENT\nMr Singh applied for a student visa. The Tribunal "
        "refused the application because it was not satisfied that he intended to stay "
        "in Australia temporarily. Mr Singh applied for judicial review and later asked "
        "the Court to reinstate that proceeding. The Court considered his explanation "
        "for non-attendance, the effect on the Minister, and whether the proposed review "
        "grounds were reasonably arguable. The reinstatement application was dismissed.",
    )
    target_path.write_text(target_text, encoding="utf-8")
    parent_path.write_text(parent_text, encoding="utf-8")

    db_path = data / "cases.db"
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "CREATE TABLE cases (case_id TEXT, citation TEXT, title TEXT, url TEXT, "
            "full_text_path TEXT, visa_type TEXT, catchwords TEXT)"
        )
        conn.execute(
            "INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                "target-id",
                TARGET_CITATION,
                target_title,
                TARGET_URL,
                "downloaded_cases/case_texts/target.txt",
                "",
                "MIGRATION - leave to appeal",
            ),
        )
        conn.execute(
            "INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                "parent-id",
                PARENT_CITATION,
                parent_title,
                PARENT_URL,
                "downloaded_cases/case_texts/parent.txt",
                "Student visa",
                "MIGRATION - Student visa",
            ),
        )
        conn.commit()
    finally:
        conn.close()
    approval = {
        "case_id": "target-id",
        "field": "visa_type",
        "source_path": "downloaded_cases/case_texts/target.txt",
        "source_sha256": hashlib.sha256(target_path.read_bytes()).hexdigest(),
        "reviewer": "Codex source-bound review",
        "review_note": "The appeal source names the same case; the appealed judgment states the visa type.",
        "evidence": {
            "value": "Student visa",
            "quote": TARGET_QUOTE,
            "method": "manual_linked_case_visa_review",
            "linked_case": {
                "citation": PARENT_CITATION,
                "source_path": "downloaded_cases/case_texts/parent.txt",
                "source_sha256": hashlib.sha256(parent_path.read_bytes()).hexdigest(),
                "url": PARENT_URL,
                "quote": PARENT_QUOTE,
                "source_value": "student visa",
            },
        },
    }
    return approval


def test_linked_visa_approval_checks_both_exact_sources(tmp_path):
    approval = _fixture(tmp_path)

    validate_approvals(tmp_path, [approval])


def test_linked_visa_approval_accepts_a_line_wrapped_appealed_citation(tmp_path):
    approval = _fixture(tmp_path)
    target_path = tmp_path / approval["source_path"]
    target_text = target_path.read_text(encoding="utf-8")
    target_text = target_text.replace(PARENT_CITATION, "[2024]\nFedCFamC2G 1268")
    target_path.write_text(target_text, encoding="utf-8")
    approval["source_sha256"] = hashlib.sha256(target_path.read_bytes()).hexdigest()

    validate_approvals(tmp_path, [approval])


def test_linked_visa_approval_rejects_a_citation_number_prefix(tmp_path):
    approval = _fixture(tmp_path)
    target_path = tmp_path / approval["source_path"]
    target_text = target_path.read_text(encoding="utf-8")
    target_text = target_text.replace(PARENT_CITATION, PARENT_CITATION + "0")
    target_path.write_text(target_text, encoding="utf-8")
    approval["source_sha256"] = hashlib.sha256(target_path.read_bytes()).hexdigest()
    approval["evidence"]["quote"] = TARGET_QUOTE.replace(
        PARENT_CITATION, PARENT_CITATION + "0"
    )

    with pytest.raises(ValueError, match="not the case identified under Appeal from"):
        validate_approvals(tmp_path, [approval])


def test_linked_visa_approval_allows_minister_title_changes_for_same_applicant(tmp_path):
    approval = _fixture(
        tmp_path,
        parent_title=(
            "Singh v Minister for Immigration & Anor "
            "[2024] FedCFamC2G 1268 (22 November 2024)"
        ),
    )

    validate_approvals(tmp_path, [approval])


def test_linked_visa_approval_rejects_a_different_named_applicant(tmp_path):
    approval = _fixture(
        tmp_path,
        target_title=(
            "Chen v Minister for Immigration and Multicultural Affairs "
            "[2026] FCA 1449 (1 October 2026)"
        ),
    )

    with pytest.raises(ValueError, match="same case title or named applicant"):
        validate_approvals(tmp_path, [approval])


def test_linked_visa_approval_rejects_a_different_appealed_citation(tmp_path):
    approval = _fixture(tmp_path)
    approval["evidence"]["linked_case"]["citation"] = "[2024] FCA 555"

    with pytest.raises(ValueError, match="not the case identified under Appeal from"):
        validate_approvals(tmp_path, [approval])


def test_linked_visa_approval_rejects_parent_value_that_conflicts_with_its_source(tmp_path):
    approval = _fixture(tmp_path)
    conn = sqlite3.connect(tmp_path / "downloaded_cases" / "cases.db")
    try:
        conn.execute(
            "UPDATE cases SET visa_type=? WHERE case_id=?",
            ("Protection visa (subclass 866)", "parent-id"),
        )
        conn.commit()
    finally:
        conn.close()
    approval["evidence"]["value"] = "Protection visa (subclass 866)"

    with pytest.raises(ValueError, match="source wording does not support"):
        validate_approvals(tmp_path, [approval])
