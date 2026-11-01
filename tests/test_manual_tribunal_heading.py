"""Manual repair must bind the entire tribunal panel to the actual case heading."""
from types import SimpleNamespace

import pytest

from immi_case_downloader.repair_workflow import _validate_tribunal_heading_judges


@pytest.fixture
def source_case():
    row = {
        "citation": "[2019] AATA 2998",
        "title": "Bhargava (Migration) [2019] AATA 2998 (9 May 2019)",
        "url": "https://www.austlii.edu.au/au/cases/cth/AATA/2019/2998.html",
        "date": "9 May 2019",
    }
    heading = "MEMBERS:\n\nBridget Cullen (Presiding)\nJens Streit DATE:"
    source = (
        f"Title: {row['title']}\nCitation: {row['citation']}\n"
        f"Date: {row['date']}\nURL: {row['url']}\n" + "=" * 40 + "\n"
        f"{row['title']}\nDECISION RECORD\n{heading}\n9 May 2019\n"
    )
    evidence = {"value": "Bridget Cullen; Jens Streit", "quote": heading}
    return row, source, evidence, SimpleNamespace(source_status="checked", values={})


def test_full_panel_is_accepted(source_case):
    _validate_tribunal_heading_judges(*source_case)


def test_single_tribunal_heading_is_accepted(source_case):
    row, source, evidence, assessment = source_case
    source = source.replace("MEMBERS:\n\nBridget Cullen (Presiding)\nJens Streit DATE:",
                            "Tribunal SM P W Taylor SC Date")
    evidence.update(value="SM P W Taylor SC", quote="Tribunal SM P W Taylor SC Date")
    _validate_tribunal_heading_judges(row, source, evidence, assessment)


@pytest.mark.parametrize("mutation", ["none", "no_hearing_label", "wrong_hearing", "wrong_order", "wrong_member", "two_hearings"])
def test_certified_hearing_date_exception(source_case, mutation):
    row, source, evidence, assessment = source_case
    row["date"] = "8 May 2019"
    source = source.replace("Date: 9 May 2019", "Date: 8 May 2019")
    source = source.replace(evidence["quote"], "Tribunal Deputy President S D Hotop Date")
    evidence.update(value="Deputy President S D Hotop", quote="Tribunal Deputy President S D Hotop Date")
    footer = ("\nI certify that the preceding paragraphs are reasons for the order herein of "
              "Deputy President S D Hotop\nDate of Hearing 8 May 2019\nDate of Order 9 May 2019\n")
    if mutation == "no_hearing_label":
        footer = footer.replace("Date of Hearing", "Hearing")
    elif mutation == "wrong_hearing":
        footer = footer.replace("8 May 2019", "7 May 2019")
    elif mutation == "wrong_order":
        footer = footer.replace("Date of Order 9 May 2019", "Date of Order 10 May 2019")
    elif mutation == "wrong_member":
        footer = footer.replace("Deputy President S D Hotop", "Deputy President Other")
    elif mutation == "two_hearings":
        footer += "Date of Hearing 7 May 2019\n"
    source += footer
    if mutation == "none":
        _validate_tribunal_heading_judges(row, source, evidence, assessment)
    else:
        with pytest.raises(ValueError, match="hearing date"):
            _validate_tribunal_heading_judges(row, source, evidence, assessment)


def test_other_case_heading_inside_reasons_is_not_accepted(source_case):
    row, source, evidence, assessment = source_case
    source = source.replace(evidence["quote"],
                            "CATCHWORDS\nReasons quote [2018] AATA 123:\n" + evidence["quote"])
    with pytest.raises(ValueError):
        _validate_tribunal_heading_judges(row, source, evidence, assessment)


def test_other_case_citation_before_panel_is_not_accepted(source_case):
    row, source, evidence, assessment = source_case
    source = source.replace(evidence["quote"], "[2018] AATA 123\n" + evidence["quote"])
    with pytest.raises(ValueError):
        _validate_tribunal_heading_judges(row, source, evidence, assessment)


def test_wrapper_date_cannot_override_actual_decision_date(source_case):
    row, source, evidence, assessment = source_case
    source = source.replace("Date: 9 May 2019", "Date: 10 May 2019")
    row["date"] = "10 May 2019"
    with pytest.raises(ValueError, match="date"):
        _validate_tribunal_heading_judges(row, source, evidence, assessment)


def test_title_date_cannot_override_actual_decision_date(source_case):
    row, source, evidence, assessment = source_case
    source = source.replace("\n9 May 2019\n", "\n10 May 2019\n")
    with pytest.raises(ValueError, match="heading date"):
        _validate_tribunal_heading_judges(row, source, evidence, assessment)


def test_additional_member_after_date_is_rejected(source_case):
    row, source, evidence, assessment = source_case
    source += "Senior Member Jane Doe\n"
    with pytest.raises(ValueError, match="Additional tribunal member"):
        _validate_tribunal_heading_judges(row, source, evidence, assessment)


@pytest.mark.parametrize("marker", ["Member: Jane Doe", "Members: Jane Doe", "Tribunal Member: Jane Doe",
                                    "Member:\nJane Doe", "Senior Members: Jane Doe", "Panel: Jane Doe",
                                    "Before: Jane Doe", "Member(s): Jane Doe"])
def test_member_label_variants_are_rejected(source_case, marker):
    row, source, evidence, assessment = source_case
    source += marker + "\n"
    with pytest.raises(ValueError, match="Additional tribunal member"):
        _validate_tribunal_heading_judges(row, source, evidence, assessment)


def test_additional_persons_signature_is_rejected(source_case):
    row, source, evidence, assessment = source_case
    source += "(Sgd) SM DOE\n"
    with pytest.raises(ValueError, match="Signature names another"):
        _validate_tribunal_heading_judges(row, source, evidence, assessment)


@pytest.mark.parametrize("mutation", ["omit_member", "wrong_case", "wrong_date", "wrong_title", "quote_fragment", "unchecked", "ambiguous"])
def test_unreliable_or_incomplete_evidence_is_rejected(source_case, mutation):
    row, source, evidence, assessment = source_case
    if mutation == "omit_member":
        evidence["value"] = "Bridget Cullen"
    elif mutation == "wrong_case":
        row["citation"] = "[2019] AATA 3007"
    elif mutation == "wrong_date":
        row["date"] = "10 May 2019"
    elif mutation == "wrong_title":
        source = source.replace(row["title"] + "\nDECISION RECORD", "Different party\nDECISION RECORD")
    elif mutation == "quote_fragment":
        evidence["quote"] = "Bridget Cullen (Presiding)"
    elif mutation == "unchecked":
        assessment.source_status = "identity_unverified"
    else:
        source += "\nMEMBERS: Another Member DATE: 9 May 2019\n"
    with pytest.raises(ValueError):
        _validate_tribunal_heading_judges(row, source, evidence, assessment)
