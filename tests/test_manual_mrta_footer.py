"""A local MRTA decision footer must match the case and identify its sole member."""
from types import SimpleNamespace

import pytest

from immi_case_downloader.repair_workflow import _validate_mrta_signed_footer


@pytest.fixture
def record():
    row = {"citation": "[2009] MRTA 1245", "title": "0804735 [2009] MRTA 1245 (8 July 2009)",
           "date": "8 July 2009", "url": "https://example.org/mrta/1245", "applicant_name": "Mrs Eun Ju Jang"}
    footer = "Peter Tyler\tDate: 8 July 2009\nMember\n"
    source = (f"Title: {row['title']}\nCitation: {row['citation']}\nURL: {row['url']}\n"
              + "=" * 40 + "\n" + row["title"] + "\nDECISION RECORD\nAPPLICANT:\nMrs Eun Ju Jang\nMRT CASE NUMBER:\n0804735\n"
              "TRIBUNAL MEMBER:\n0804735\nDATE:\n8 July 2009\n"
              "STATEMENT OF DECISION AND REASONS\nFINDINGS AND REASONS\n6.\nThe Tribunal considers the case.\nDECISION\n7. No jurisdiction.\n"
              + footer)
    return row, source, {"value": "Peter Tyler", "quote": footer}, SimpleNamespace(source_status="checked", values={})


def test_exact_terminal_member_passes(record):
    _validate_mrta_signed_footer(*record)


@pytest.mark.parametrize("mutation", ["wrong_citation", "wrong_case_number", "conflicting_member", "header_date",
                                     "footer_date", "extra_member", "extra_signature", "trailing_member",
                                     "wrong_quote", "source_unchecked", "header_extra_member", "other_case",
                                     "wrong_applicant", "missing_applicant", "inline_member", "parenthesized_member",
                                     "mrt_member", "parenthesized_signed", "other_case_before_decision",
                                     "other_case_in_findings"])
def test_wrong_or_incomplete_footer_rejected(record, mutation):
    row, source, evidence, assessment = record
    if mutation == "wrong_citation":
        row["citation"] = "[2009] MRTA 1246"
    elif mutation == "wrong_case_number":
        source = source.replace("MRT CASE NUMBER:\n0804735", "MRT CASE NUMBER:\n9999999")
    elif mutation == "conflicting_member":
        source = source.replace("TRIBUNAL MEMBER:\n0804735", "TRIBUNAL MEMBER:\nJane Doe")
    elif mutation == "header_date":
        source = source.replace("DATE:\n8 July 2009", "DATE:\n9 July 2009")
    elif mutation == "footer_date":
        source = source.replace("Peter Tyler\tDate: 8 July 2009", "Peter Tyler\tDate: 9 July 2009")
    elif mutation == "extra_member":
        source = source.replace("7. No jurisdiction.\n", "7. No jurisdiction.\nMembers: Jane Doe\n")
    elif mutation == "extra_signature":
        source = source.replace("7. No jurisdiction.\n", "7. No jurisdiction.\nSigned: Jane Doe\n")
    elif mutation == "trailing_member":
        source += "Jane Doe\tDate: 8 July 2009\nMember\n"
    elif mutation == "wrong_quote":
        evidence["quote"] = "Peter Tyler"
    elif mutation == "header_extra_member":
        source = source.replace("TRIBUNAL MEMBER:\n0804735", "TRIBUNAL MEMBER:\n0804735\nMembers: Jane Doe")
    elif mutation == "other_case":
        source = source.replace("7. No jurisdiction.", "7. [2001] AATA 1")
    elif mutation == "wrong_applicant":
        source = source.replace("Mrs Eun Ju Jang", "Jane Doe")
    elif mutation == "missing_applicant":
        row["applicant_name"] = ""
    elif mutation == "inline_member":
        source = source.replace("7. No jurisdiction.\n", "7. No jurisdiction.\nJane Doe Date: 8 July 2009 Member\n")
    elif mutation == "parenthesized_member":
        source = source.replace("7. No jurisdiction.\n", "7. No jurisdiction.\nJane Doe\n(Tribunal Member)\n")
    elif mutation == "mrt_member":
        source = source.replace("7. No jurisdiction.\n", "7. No jurisdiction.\nJane Doe\nMRT Member\n")
    elif mutation == "parenthesized_signed":
        source = source.replace("7. No jurisdiction.\n", "7. No jurisdiction.\nJane Doe\n(Signed)\n")
    elif mutation == "other_case_before_decision":
        source = source.replace("The Tribunal considers the case.\nDECISION", "The Tribunal considers the case.\n[2001] MRTA 456\nDECISION")
    elif mutation == "other_case_in_findings":
        source = source.replace("FINDINGS AND REASONS\n", "FINDINGS AND REASONS\n[2001] MRTA 456\n")
    else:
        assessment.source_status = "identity_unverified"
    with pytest.raises(ValueError):
        _validate_mrta_signed_footer(row, source, evidence, assessment)
