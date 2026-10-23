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


SAME_TARGET_CITATION = "[2005] FCA 912"
SAME_PARENT_CITATION = "[2005] FCA 693"
SAME_TARGET_URL = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/FCA/2005/912.html"
SAME_PARENT_URL = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/FCA/2005/693.html"
SAME_TITLE = "Zhang v Minister for Immigration & Multicultural & Indigenous Affairs"
SAME_TARGET_TITLE = SAME_TITLE + " [2005] FCA 912 (4 July 2005)"
SAME_PARENT_TITLE = SAME_TITLE + " [2005] FCA 693 (31 May 2005)"
SAME_TARGET_QUOTE = (
    "SUPPLEMENTARY REASONS FOR JUDGMENT\n"
    "1 In reasons for judgment published on 31 May 2005 I indicated that an argument "
    "might have been available to the Minister concerning subcl 457.222(1)(a)."
)
SAME_PARENT_QUOTE = "application for a subclass 457 visa before his student visa had been cancelled"


def _same_proceeding_fixture(tmp_path):
    data = tmp_path / "downloaded_cases"
    source_dir = data / "case_texts"
    source_dir.mkdir(parents=True)
    target_path = source_dir / "supplementary.txt"
    parent_path = source_dir / "earlier-reasons.txt"
    target_text = _source(
        SAME_TARGET_TITLE,
        SAME_TARGET_CITATION,
        SAME_TARGET_URL,
        SAME_TARGET_TITLE.split(" (")[0] + "\n"
        "IN THE FEDERAL COURT OF AUSTRALIA\n"
        "VICTORIA DISTRICT REGISTRY\nV 580 of 2004\n"
        "BETWEEN:\nJIAN ZHANG\nApplicant\nAND:\nTHE MINISTER\nSecond Respondent\n"
        "JUDGES: RYAN J\nDATE: 4 JULY 2005\n\n"
        + SAME_TARGET_QUOTE
        + "\n2 Accordingly, the order of the Court is made.",
    )
    parent_text = _source(
        SAME_PARENT_TITLE,
        SAME_PARENT_CITATION,
        SAME_PARENT_URL,
        SAME_PARENT_TITLE.split(" (")[0] + "\n"
        "IN THE FEDERAL COURT OF AUSTRALIA\n"
        "VICTORIA DISTRICT REGISTRY\nV 580 of 2004\n"
        "BETWEEN:\nJIAN ZHANG\nApplicant\nAND:\nTHE MINISTER\nSecond Respondent\n"
        "JUDGES: RYAN J\nDATE: 31 MAY 2005\n\n"
        "REASONS FOR JUDGMENT\n"
        "The matter before the Court is a review of the Tribunal's decision not to grant "
        "the applicant a Temporary Business Entry (Class UC) subclass 457 business visa. "
        "The applicant made an application for a subclass 457 visa before his student "
        "visa had been cancelled.",
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
        conn.executemany(
            "INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    "supplementary-id", SAME_TARGET_CITATION, SAME_TARGET_TITLE,
                    SAME_TARGET_URL, "downloaded_cases/case_texts/supplementary.txt",
                    "", "MIGRATION - supplementary reasons",
                ),
                (
                    "earlier-id", SAME_PARENT_CITATION, SAME_PARENT_TITLE,
                    SAME_PARENT_URL, "downloaded_cases/case_texts/earlier-reasons.txt",
                    "Subclass 457 visa", "MIGRATION - business visa refusal",
                ),
            ],
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "case_id": "supplementary-id",
        "field": "visa_type",
        "source_path": "downloaded_cases/case_texts/supplementary.txt",
        "source_sha256": hashlib.sha256(target_path.read_bytes()).hexdigest(),
        "reviewer": "Codex source-bound review",
        "review_note": "The supplementary judgment identifies the earlier reasons in the same docket.",
        "evidence": {
            "value": "Subclass 457 visa",
            "quote": SAME_TARGET_QUOTE,
            "method": "manual_same_proceeding_visa_review",
            "linked_case": {
                "citation": SAME_PARENT_CITATION,
                "source_path": "downloaded_cases/case_texts/earlier-reasons.txt",
                "source_sha256": hashlib.sha256(parent_path.read_bytes()).hexdigest(),
                "url": SAME_PARENT_URL,
                "quote": SAME_PARENT_QUOTE,
                "source_value": "subclass 457 visa",
            },
        },
    }


def test_same_proceeding_visa_approval_checks_exact_supplementary_and_parent_sources(tmp_path):
    approval = _same_proceeding_fixture(tmp_path)

    validate_approvals(tmp_path, [approval])


def test_same_proceeding_visa_approval_accepts_business_descriptor_on_subclass_457(tmp_path):
    approval = _same_proceeding_fixture(tmp_path)
    parent_path = tmp_path / approval["evidence"]["linked_case"]["source_path"]
    parent_text = parent_path.read_text(encoding="utf-8")
    old_quote = "The applicant made an application for a subclass 457 visa before his student visa had been cancelled."
    parent_quote = (
        "The application for a Temporary Business Entry (Class UC) subclass 457 "
        "business visa was refused."
    )
    if old_quote not in parent_text:
        raise AssertionError("Fixture parent quote was not found")
    parent_path.write_text(parent_text.replace(old_quote, parent_quote), encoding="utf-8")
    linked = approval["evidence"]["linked_case"]
    linked["source_sha256"] = hashlib.sha256(parent_path.read_bytes()).hexdigest()
    linked["quote"] = parent_quote
    linked["source_value"] = "subclass 457 business visa"

    validate_approvals(tmp_path, [approval])


def test_same_proceeding_visa_approval_rejects_a_different_numbered_subclass(tmp_path):
    approval = _same_proceeding_fixture(tmp_path)
    parent_path = tmp_path / approval["evidence"]["linked_case"]["source_path"]
    parent_text = parent_path.read_text(encoding="utf-8")
    old_sentence = (
        "The matter before the Court is a review of the Tribunal's decision not to grant "
        "the applicant a Temporary Business Entry (Class UC) subclass 457 business visa."
    )
    replacement = (
        "The matter before the Court is a review of the Tribunal's decision not to grant "
        "the applicant a Temporary Protection (Class XD) visa (subclass 785)."
    )
    if old_sentence not in parent_text:
        raise AssertionError("Fixture parent sentence was not found")
    parent_path.write_text(parent_text.replace(old_sentence, replacement), encoding="utf-8")
    linked = approval["evidence"]["linked_case"]
    linked["source_sha256"] = hashlib.sha256(parent_path.read_bytes()).hexdigest()
    linked["quote"] = replacement
    linked["source_value"] = "Temporary Protection (Class XD) visa"
    approval["evidence"]["value"] = "Protection visa (subclass 866)"

    conn = sqlite3.connect(tmp_path / "downloaded_cases/cases.db")
    try:
        conn.execute(
            "UPDATE cases SET visa_type=? WHERE case_id=?",
            ("Protection visa (subclass 866)", "earlier-id"),
        )
        conn.commit()
    finally:
        conn.close()

    with pytest.raises(ValueError, match="specific class or subclass"):
        validate_approvals(tmp_path, [approval])


def test_same_proceeding_visa_approval_rejects_a_different_docket(tmp_path):
    approval = _same_proceeding_fixture(tmp_path)
    target_path = tmp_path / approval["source_path"]
    target_text = target_path.read_text(encoding="utf-8")
    target_path.write_text(target_text.replace("V 580 of 2004", "V 581 of 2004"), encoding="utf-8")
    approval["source_sha256"] = hashlib.sha256(target_path.read_bytes()).hexdigest()

    with pytest.raises(ValueError, match="matching court, docket, applicant, judge"):
        validate_approvals(tmp_path, [approval])


def test_same_proceeding_visa_approval_rejects_an_unrelated_named_applicant(tmp_path):
    approval = _same_proceeding_fixture(tmp_path)
    target_path = tmp_path / approval["source_path"]
    target_text = target_path.read_text(encoding="utf-8")
    target_path.write_text(target_text.replace("JIAN ZHANG", "JANE CHEN"), encoding="utf-8")
    approval["source_sha256"] = hashlib.sha256(target_path.read_bytes()).hexdigest()

    with pytest.raises(ValueError, match="matching court, docket, applicant, judge"):
        validate_approvals(tmp_path, [approval])


def test_same_proceeding_visa_approval_rejects_a_mismatched_prior_judgment_date(tmp_path):
    approval = _same_proceeding_fixture(tmp_path)
    target_path = tmp_path / approval["source_path"]
    target_text = target_path.read_text(encoding="utf-8")
    target_text = target_text.replace("published on 31 May 2005", "published on 30 May 2005")
    target_path.write_text(target_text, encoding="utf-8")
    approval["source_sha256"] = hashlib.sha256(target_path.read_bytes()).hexdigest()
    approval["evidence"]["quote"] = approval["evidence"]["quote"].replace(
        "published on 31 May 2005", "published on 30 May 2005"
    )

    with pytest.raises(ValueError, match="matching court, docket, applicant, judge"):
        validate_approvals(tmp_path, [approval])


LOWER_TARGET_CITATION = "[2007] FCA 785"
LOWER_PARENT_CITATION = "[2007] FMCA 101"
LOWER_TARGET_URL = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/FCA/2007/785.html"
LOWER_PARENT_URL = "https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/FMCA/2007/101.html"
LOWER_TARGET_TITLE = "NBLV v Minister for Immigration & Citizenship [2007] FCA 785 (14 May 2007)"
LOWER_PARENT_TITLE = "NBLV & Ors v Minister for Immigration & Anor [2007] FMCA 101 (8 February 2007)"
LOWER_TARGET_QUOTE = (
    "This is an appeal from a decision of the Federal Magistrates Court, given by "
    "Emmett FM, which dismissed an application for judicial review of a decision "
    "adverse to the appellants given by the Refugee Review Tribunal."
)
LOWER_PARENT_QUOTE = (
    "On 10 February 2003, the Applicant lodged an application for a protection "
    "(Class XA) visa with the Department."
)


def _lower_court_appeal_fixture(tmp_path, *, parent_judge="Emmett FM", add_ambiguous_parent=False):
    data = tmp_path / "downloaded_cases"
    source_dir = data / "case_texts"
    source_dir.mkdir(parents=True)
    target_path = source_dir / "target.txt"
    parent_path = source_dir / "parent.txt"
    target_text = _source(
        LOWER_TARGET_TITLE,
        LOWER_TARGET_CITATION,
        LOWER_TARGET_URL,
        LOWER_TARGET_TITLE.split(" (")[0] + "\n" + LOWER_TARGET_CITATION + "\n"
        "IN THE FEDERAL COURT OF AUSTRALIA\n"
        "ON APPEAL FROM THE FEDERAL MAGISTRATES COURT OF AUSTRALIA\n"
        "BETWEEN: NBLV First Appellant; NBLW Second Appellant; NBLX Third Appellant\n"
        "AND: MINISTER FOR IMMIGRATION AND CITIZENSHIP; REFUGEE REVIEW TRIBUNAL\n"
        "JUDGE: MADGWICK J\nDATE: 14 MAY 2007\nREASONS FOR JUDGMENT\n"
        + LOWER_TARGET_QUOTE,
    )
    parent_text = _source(
        LOWER_PARENT_TITLE,
        LOWER_PARENT_CITATION,
        LOWER_PARENT_URL,
        LOWER_PARENT_TITLE.split(" (")[0] + "\n" + LOWER_PARENT_CITATION + "\n"
        "FEDERAL MAGISTRATES COURT OF AUSTRALIA\n"
        "BETWEEN: NBLV Applicant; NBLW; NBLX\n"
        "AND: MINISTER FOR IMMIGRATION; REFUGEE REVIEW TRIBUNAL\n"
        f"JUDGE: {parent_judge}\nDATE: 8 FEBRUARY 2007\n"
        "REASONS FOR JUDGMENT\n"
        "This is an application for judicial review of the Refugee Review Tribunal's "
        "decision. "
        + LOWER_PARENT_QUOTE,
    )
    target_path.write_text(target_text, encoding="utf-8")
    parent_path.write_text(parent_text, encoding="utf-8")

    conn = sqlite3.connect(data / "cases.db")
    try:
        conn.execute(
            "CREATE TABLE cases (case_id TEXT, citation TEXT, title TEXT, url TEXT, "
            "full_text_path TEXT, visa_type TEXT, catchwords TEXT, court_code TEXT, "
            "date TEXT, judges TEXT, applicant_name TEXT)"
        )
        conn.executemany(
            "INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    "target-id", LOWER_TARGET_CITATION, LOWER_TARGET_TITLE,
                    LOWER_TARGET_URL, "downloaded_cases/case_texts/target.txt", "",
                    "MIGRATION - appeal from judicial review", "FCA", "14 MAY 2007",
                    "MADGWICK J", "NBLV",
                ),
                (
                    "parent-id", LOWER_PARENT_CITATION, LOWER_PARENT_TITLE,
                    LOWER_PARENT_URL, "downloaded_cases/case_texts/parent.txt",
                    "Protection visa", "MIGRATION - protection visa", "FMCA",
                    "7 February 2007", parent_judge, "NBLV & Ors",
                ),
            ],
        )
        if add_ambiguous_parent:
            conn.execute(
                "INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "other-parent-id", "[2007] FMCA 102",
                    "NBLV & Ors v Minister for Immigration & Anor [2007] FMCA 102",
                    LOWER_PARENT_URL.replace("101.html", "102.html"),
                    "downloaded_cases/case_texts/other-parent.txt", "",
                    "", "FMCA", "8 February 2007", "Emmett FM", "NBLV & Ors",
                ),
            )
        conn.commit()
    finally:
        conn.close()

    return {
        "case_id": "target-id",
        "field": "visa_type",
        "source_path": "downloaded_cases/case_texts/target.txt",
        "source_sha256": hashlib.sha256(target_path.read_bytes()).hexdigest(),
        "reviewer": "Codex source-bound linked-case review",
        "review_note": (
            "The appeal source names the lower-court judge; the same masked applicant "
            "has one earlier matching lower-court source, which directly identifies the visa."
        ),
        "evidence": {
            "value": "Protection visa",
            "quote": LOWER_TARGET_QUOTE,
            "method": "manual_lower_court_linked_visa_review",
            "linked_case": {
                "citation": LOWER_PARENT_CITATION,
                "source_path": "downloaded_cases/case_texts/parent.txt",
                "source_sha256": hashlib.sha256(parent_path.read_bytes()).hexdigest(),
                "url": LOWER_PARENT_URL,
                "quote": LOWER_PARENT_QUOTE,
                "source_value": "protection (Class XA) visa",
            },
        },
    }


def test_lower_court_linked_visa_approval_requires_same_applicant_judge_and_sources(tmp_path):
    approval = _lower_court_appeal_fixture(tmp_path)

    validate_approvals(tmp_path, [approval])


def test_lower_court_linked_visa_approval_rejects_a_different_lower_court_judge(tmp_path):
    approval = _lower_court_appeal_fixture(tmp_path, parent_judge="Smith FM")

    with pytest.raises(ValueError, match="same masked applicant, named lower-court judge"):
        validate_approvals(tmp_path, [approval])


def test_lower_court_linked_visa_approval_rejects_ambiguous_matching_cases(tmp_path):
    approval = _lower_court_appeal_fixture(tmp_path, add_ambiguous_parent=True)

    with pytest.raises(ValueError, match="ambiguous for the same applicant and judge"):
        validate_approvals(tmp_path, [approval])


def _source_quote_review_fixture(
    tmp_path, linked_quote, value, source_value, *, target_title=TARGET_TITLE
):
    approval = _fixture(tmp_path, target_title=target_title)
    parent_path = tmp_path / approval["evidence"]["linked_case"]["source_path"]
    parent_text = _source(
        PARENT_TITLE,
        PARENT_CITATION,
        PARENT_URL,
        PARENT_TITLE.split(" (")[0] + "\n" + linked_quote,
    )
    parent_path.write_text(parent_text, encoding="utf-8")

    linked = approval["evidence"]["linked_case"]
    linked["source_sha256"] = hashlib.sha256(parent_path.read_bytes()).hexdigest()
    linked["quote"] = linked_quote
    linked["source_value"] = source_value
    approval["evidence"]["value"] = value
    approval["evidence"]["method"] = "manual_linked_case_source_quote_review"
    return approval


def test_linked_source_quote_review_accepts_explicit_refusal_over_conflicting_stored_value(tmp_path):
    quote = "The delegate refused to grant the applicant a protection visa."
    approval = _source_quote_review_fixture(
        tmp_path,
        quote,
        value="protection visa",
        source_value="protection visa",
    )

    validate_approvals(tmp_path, [approval])


def test_linked_source_quote_review_rejects_a_historical_visa_without_refusal_context(tmp_path):
    quote = "The applicant last held a Subclass 456 visa."
    approval = _source_quote_review_fixture(
        tmp_path,
        quote,
        value="Subclass 456 visa",
        source_value="Subclass 456 visa",
    )

    with pytest.raises(ValueError, match="applicant-specific refusal or cancellation evidence"):
        validate_approvals(tmp_path, [approval])


def test_linked_source_quote_review_accepts_a_formal_leave_to_appeal_heading(tmp_path):
    quote = "The delegate refused to grant the applicant a protection visa."
    approval = _source_quote_review_fixture(
        tmp_path,
        quote,
        value="protection visa",
        source_value="protection visa",
    )
    target_path = tmp_path / approval["source_path"]
    target_text = target_path.read_text(encoding="utf-8")
    target_quote = f"Application for leave to appeal: {PARENT_CITATION}"
    target_path.write_text(target_text.replace(TARGET_QUOTE, target_quote), encoding="utf-8")
    approval["source_sha256"] = hashlib.sha256(target_path.read_bytes()).hexdigest()
    approval["evidence"]["quote"] = target_quote

    validate_approvals(tmp_path, [approval])


def test_linked_source_quote_review_accepts_same_named_party_with_title_variation(tmp_path):
    quote = "The delegate refused to grant the applicant a protection visa."
    approval = _source_quote_review_fixture(
        tmp_path,
        quote,
        value="protection visa",
        source_value="protection visa",
        target_title=(
            "Singh & Anor v Minister for Immigration and Multicultural Affairs "
            "[2026] FCA 1449 (1 October 2026)"
        ),
    )

    validate_approvals(tmp_path, [approval])


def test_linked_source_quote_review_uses_matching_court_caption_when_metadata_alias_differs(tmp_path):
    target_title = (
        "UH17 v Minister for Immigration and Border Protection "
        "[2026] FCA 1449 (1 October 2026)"
    )
    parent_title = (
        "CUH17 v Minister for Immigration and Border Protection "
        "[2024] FedCFamC2G 1268 (22 November 2024)"
    )
    approval = _fixture(
        tmp_path,
        target_title=target_title,
        parent_title=parent_title,
    )

    target_path = tmp_path / approval["source_path"]
    target_text = target_path.read_text(encoding="utf-8")
    target_metadata, target_body = target_text.split(
        "========================================\n", 1
    )
    target_body = target_body.replace(
        "UH17 v Minister for Immigration and Border Protection [2026] FCA 1449\n",
        "FEDERAL COURT OF AUSTRALIA\n"
        "CUH17 v Minister for Immigration and Border Protection [2026] FCA 1449\n",
        1,
    )
    target_quote = (
        "Application for leave to appeal:\n"
        "CUH17 v Minister for Immigration and Border Protection\n"
        "[2024] FedCFamC2G 1268"
    )
    target_body = target_body.replace(TARGET_QUOTE, target_quote, 1)
    target_path.write_text(
        target_metadata + "========================================\n" + target_body,
        encoding="utf-8",
    )

    parent_path = tmp_path / approval["evidence"]["linked_case"]["source_path"]
    parent_body = (
        parent_title.split(" (")[0]
        + "\nThe delegate refused to grant the applicant a subclass 790 visa."
    )
    parent_path.write_text(
        _source(parent_title, PARENT_CITATION, PARENT_URL, parent_body),
        encoding="utf-8",
    )

    approval["source_sha256"] = hashlib.sha256(target_path.read_bytes()).hexdigest()
    approval["evidence"]["value"] = "Subclass 790 visa"
    approval["evidence"]["quote"] = target_quote
    approval["evidence"]["method"] = "manual_linked_case_source_quote_review"
    approval["evidence"]["linked_case"].update(
        {
            "source_sha256": hashlib.sha256(parent_path.read_bytes()).hexdigest(),
            "quote": "The delegate refused to grant the applicant a subclass 790 visa.",
            "source_value": "Subclass 790 visa",
        }
    )

    validate_approvals(tmp_path, [approval])


def test_linked_source_quote_review_rejects_a_different_party_despite_citation_link(tmp_path):
    quote = "The delegate refused to grant the applicant a protection visa."
    approval = _source_quote_review_fixture(
        tmp_path,
        quote,
        value="protection visa",
        source_value="protection visa",
        target_title=(
            "Chen v Minister for Immigration and Multicultural Affairs "
            "[2026] FCA 1449 (1 October 2026)"
        ),
    )

    with pytest.raises(ValueError, match="same case title or named applicant"):
        validate_approvals(tmp_path, [approval])


def test_linked_source_quote_review_accepts_applicant_specific_cancellation(tmp_path):
    quote = (
        "The applicant sought review of a decision about his migration application and "
        "provided a statement about the relevant events. The Tribunal reviewed the "
        "documents and submissions received from the applicant and the respondent and "
        "considered whether the original decision should be set aside. The Tribunal "
        "decided not to revoke the cancellation of the applicant's Subclass 204 visa. "
        "The Court considered the application for judicial review and dismissed it "
        "because no reviewable error was established."
    )
    approval = _source_quote_review_fixture(
        tmp_path,
        quote,
        value="Subclass 204 visa",
        source_value="Subclass 204 visa",
    )

    validate_approvals(tmp_path, [approval])


def test_linked_source_quote_review_accepts_plural_and_first_person_applicant_evidence(tmp_path):
    quote = (
        "The applicants asked the Court to review the delegate's decision. In a written "
        "statement the first applicant said that the Department and Tribunal had both "
        "refused my visa application for a Subclass 485 visa because I had not supplied "
        "the required English test result. The applicant gave additional background and "
        "the Court considered that statement in determining the application."
    )
    approval = _source_quote_review_fixture(
        tmp_path,
        quote,
        value="Subclass 485 visa",
        source_value="Subclass 485 visa",
    )

    validate_approvals(tmp_path, [approval])


def test_linked_source_quote_review_accepts_plural_visa_wording_with_grounded_singular_value(tmp_path):
    quote = (
        "The applicants sought judicial review after the Tribunal considered their "
        "evidence. The Tribunal refused to grant the applicants protection visas. "
        "The Court considered the applicants' submissions and dismissed the "
        "application after finding no reviewable error in the decision."
    )
    approval = _source_quote_review_fixture(
        tmp_path,
        quote,
        value="Protection visa",
        source_value="protection visas",
    )

    validate_approvals(tmp_path, [approval])


def test_linked_source_quote_review_accepts_a_value_normalized_from_grounded_source_text(tmp_path):
    quote = (
        "The delegate refused to grant the applicant a Skilled (Provisional)(class VC)\n"
        "subclass Skilled \ufffdC Graduate (485)\nvisa."
    )
    approval = _source_quote_review_fixture(
        tmp_path,
        quote,
        value="Subclass 485 visa",
        source_value=quote,
    )

    validate_approvals(tmp_path, [approval])


def test_linked_source_quote_review_accepts_a_visa_suffix_for_a_source_verified_subclass(tmp_path):
    quote = (
        "The decision under review dated 4 December 2019, not to revoke the mandatory "
        "cancellation of the applicant's Class BA Subclass 204 Women at Risk visa, is "
        "set aside and the matter is remitted. The Court reviewed the written "
        "submissions and supporting documents and dismissed the application because "
        "no reviewable error was established."
    )
    approval = _source_quote_review_fixture(
        tmp_path,
        quote,
        value="Subclass 204 visa",
        source_value="Class BA Subclass 204 Women at Risk visa",
    )

    validate_approvals(tmp_path, [approval])


def test_linked_source_quote_review_rejects_normalization_that_disagrees_with_source_extraction(tmp_path):
    quote = (
        "The delegate refused to grant the applicant a Skilled (Provisional)(class VC)\n"
        "subclass Skilled \ufffdC Graduate (485)\nvisa."
    )
    approval = _source_quote_review_fixture(
        tmp_path,
        quote,
        value="Subclass 600 visa",
        source_value=quote,
    )

    with pytest.raises(ValueError, match="must match the source-grounded extraction"):
        validate_approvals(tmp_path, [approval])
