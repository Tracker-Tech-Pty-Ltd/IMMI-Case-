"""Historical repairs require case identity and the decision's own member."""
from types import SimpleNamespace

import pytest

from immi_case_downloader.repair_workflow import _validate_legacy_tribunal_judges


@pytest.fixture(params=["tribunal_decision_heading", "signed_reasons_heading"])
def legacy_case(request):
    row = {"citation": "[2000] AATA 287", "title": "Iefata and Minister [2000] AATA 287 (13 April 2000)",
           "url": "https://example.org/287", "date": "13 April 2000"}
    source = (f"Title: {row['title']}\nCitation: {row['citation']}\nDate: {row['date']}\nURL: {row['url']}\n"
              + "=" * 30 + "\nDECISION AND REASONS FOR DECISION [2000] AATA 287\n"
              "Re IUTA IEFATA\nApplicant\nAnd MINISTER FOR IMMIGRATION AND MULTICULTURAL AFFAIRS\nRespondent\n")
    if request.param == "tribunal_decision_heading":
        quote = "DECISION\nTribunal Associate Professor S D Hotop, Deputy President\nDate 13 April 2000"
        source += quote
        value = "Associate Professor S D Hotop, Deputy President"
    else:
        quote = "REASONS FOR DECISION\n13 April 2000 Deputy President DP Breen, Presidential Member"
        source += "DECISION\n(Sgd) DP BREEN\nCATCHWORDS\n" + quote
        value = "Deputy President DP Breen"
    return row, source, {"format": request.param, "value": value, "quote": quote}, SimpleNamespace(source_status="checked", values={})


def test_matching_decision_and_member_passes(legacy_case):
    _validate_legacy_tribunal_judges(*legacy_case)


def test_extra_named_member_is_rejected(legacy_case):
    row, source, evidence, assessment = legacy_case
    if evidence["format"] != "tribunal_decision_heading":
        pytest.skip("decision-heading format only")
    source += "\nTribunal Member Jane Doe\n"
    with pytest.raises(ValueError):
        _validate_legacy_tribunal_judges(row, source, evidence, assessment)


def test_extra_signature_and_reasons_are_rejected(legacy_case):
    row, source, evidence, assessment = legacy_case
    if evidence["format"] != "signed_reasons_heading":
        pytest.skip("signed-reasons format only")
    source = source.replace("(Sgd) DP BREEN", "(Sgd) DP BREEN\n(Sgd) SM DOE")
    source += "\nREASONS FOR DECISION\n13 April 2000 Senior Member Jane Doe\n"
    with pytest.raises(ValueError):
        _validate_legacy_tribunal_judges(row, source, evidence, assessment)


def test_other_case_between_citation_and_parties_is_rejected(legacy_case):
    row, source, evidence, assessment = legacy_case
    source = source.replace("Re IUTA IEFATA", "[2000] AATA 288\nRe IUTA IEFATA")
    with pytest.raises(ValueError, match="Another case"):
        _validate_legacy_tribunal_judges(row, source, evidence, assessment)


@pytest.mark.parametrize("marker", ["Member: Jane Doe", "Members: Jane Doe", "Tribunal Member: Jane Doe",
                                    "Member:\nJane Doe", "Senior Members: Jane Doe", "Panel: Jane Doe",
                                    "Before: Jane Doe", "Member(s): Jane Doe", "Signed: Jane Doe"])
def test_extra_member_and_signature_variants_are_rejected(legacy_case, marker):
    row, source, evidence, assessment = legacy_case
    if evidence["format"] == "signed_reasons_heading":
        source = source.replace("(Sgd) DP BREEN", "(Sgd) DP BREEN\n" + marker)
    else:
        source += "\n" + marker
    with pytest.raises(ValueError):
        _validate_legacy_tribunal_judges(row, source, evidence, assessment)


@pytest.mark.parametrize("mutation", ["wrong_case", "wrong_applicant", "wrong_date", "wrong_member", "unverified", "wrong_signature"])
def test_mismatch_does_not_pass(legacy_case, mutation):
    row, source, evidence, assessment = legacy_case
    if mutation == "wrong_case":
        source = source.replace("DECISION [2000] AATA 287", "DECISION [2000] AATA 288")
    elif mutation == "wrong_applicant":
        source = source.replace("Re IUTA IEFATA", "Re DIFFERENT PERSON")
    elif mutation == "wrong_date":
        row["date"] = "14 April 2000"
        source = source.replace("Date: 13 April 2000", "Date: 14 April 2000")
    elif mutation == "wrong_member":
        evidence["value"] = "Another person"
    elif mutation == "unverified":
        assessment.source_status = "identity_unverified"
    elif evidence["format"] == "signed_reasons_heading":
        source = source.replace("(Sgd) DP BREEN", "(Sgd) DP OTHER")
    else:
        source = source.replace("Tribunal Associate", "Another case Tribunal Associate")
    with pytest.raises(ValueError):
        _validate_legacy_tribunal_judges(row, source, evidence, assessment)
