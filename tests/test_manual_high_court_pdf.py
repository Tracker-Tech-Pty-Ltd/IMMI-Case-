"""The reviewed first page must come from pinned PDF bytes and contain the whole panel."""
import hashlib
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from immi_case_downloader.repair_workflow import _validate_high_court_pdf_judges


@pytest.fixture
def record(tmp_path):
    pdf = tmp_path / "official.pdf"
    pdf.write_bytes(b"pinned PDF bytes")
    row = {"citation": "[2021] HCA 4", "title": "Minister v Benbrika [2021] HCA 4 (10 February 2021)",
           "date": "10 February 2021"}
    page = ("HIGH COURT OF AUSTRALIA\n\nKIEFEL CJ,\nBELL, GAGELER AND STEWARD JJ\n\n"
            "MINISTER v BENBRIKA\n[2021] HCA 4\nDate of Judgment: 10 February 2021\n")
    evidence = {"source_url": "https://www.hcourt.gov.au/sites/default/files/eresources/2021/HCA/4.pdf",
                "pdf_path": str(pdf), "pdf_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
                "value": "KIEFEL CJ, BELL, GAGELER AND STEWARD JJ",
                "quote": "KIEFEL CJ, BELL, GAGELER AND STEWARD JJ"}
    return tmp_path, row, page, evidence, pdf


def check(root, row, page, evidence, extracted=None):
    reader = SimpleNamespace(pages=[SimpleNamespace(extract_text=lambda: page if extracted is None else extracted)])
    with patch("pypdf.PdfReader", return_value=reader):
        _validate_high_court_pdf_judges(root, row, page, evidence)


def test_complete_panel_passes(record):
    root, row, page, evidence, _ = record
    check(root, row, page, evidence)


def test_real_pdf_with_blank_line_inside_panel_cannot_drop_other_judges(record):
    root, row, _, evidence, pdf = record
    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"),
                             NameObject("/Subtype"): NameObject("/Type1"),
                             NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"):
        DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
    stream = DecodedStreamObject()
    stream.set_data(b"BT /F1 12 Tf 40 750 Td (HIGH COURT OF AUSTRALIA) Tj "
                    b"0 -20 Td (KIEFEL CJ) Tj 0 -20 Td ( ) Tj "
                    b"0 -20 Td (BELL, GAGELER AND STEWARD JJ) Tj "
                    b"0 -20 Td (Minister v Benbrika) Tj 0 -20 Td ([2021] HCA 4) Tj "
                    b"0 -20 Td (Date of Judgment: 10 February 2021) Tj ET")
    page[NameObject("/Contents")] = writer._add_object(stream)
    with pdf.open("wb") as handle:
        writer.write(handle)
    actual_text = PdfReader(pdf).pages[0].extract_text()
    evidence["pdf_sha256"] = hashlib.sha256(pdf.read_bytes()).hexdigest()
    evidence.update(value="KIEFEL CJ", quote="KIEFEL CJ")
    with pytest.raises(ValueError):
        _validate_high_court_pdf_judges(root, row, actual_text, evidence)
    evidence.update(value="KIEFEL CJ BELL, GAGELER AND STEWARD JJ",
                    quote="KIEFEL CJ BELL, GAGELER AND STEWARD JJ")
    _validate_high_court_pdf_judges(root, row, actual_text, evidence)


def test_older_judgment_date_directly_after_citation_passes(record):
    root, row, page, evidence, _ = record
    page = page.replace("Date of Judgment: 10 February 2021", "10 February 2021")
    check(root, row, page, evidence)


def test_explicit_hearing_date_may_match_existing_catalogue_date(record):
    root, row, page, evidence, _ = record
    row["date"] = "10 December 2020"
    page = page.replace("Date of Judgment:", "Date of Hearing: 10 December 2020\nDate of Judgment:")
    check(root, row, page, evidence)


def test_unlabelled_judgment_date_cannot_use_hearing_date_exception(record):
    root, row, page, evidence, _ = record
    row["date"] = "10 December 2020"
    page = page.replace("Date of Judgment: 10 February 2021",
                        "10 February 2021\nDate of Hearing: 10 December 2020")
    with pytest.raises(ValueError, match="database date"):
        check(root, row, page, evidence)


def test_conflicting_hearing_dates_do_not_allow_exception(record):
    root, row, page, evidence, _ = record
    row["date"] = "10 December 2020"
    page = page.replace("Date of Judgment:",
                        "Date of Hearing: 10 December 2020\nDate of Hearing: 11 December 2020\nDate of Judgment:")
    with pytest.raises(ValueError, match="database date"):
        check(root, row, page, evidence)


def test_hearing_date_is_not_accepted_as_judgment_date(record):
    root, row, page, evidence, _ = record
    page = page.replace("Date of Judgment: 10 February 2021",
                        "Date of Hearing: 10 February 2021\nDate of Judgment: 7 April 2021")
    with pytest.raises(ValueError, match="judgment date"):
        check(root, row, page, evidence)


def test_incidental_date_is_not_accepted_as_judgment_date(record):
    root, row, page, evidence, _ = record
    page = page.replace("Date of Judgment: 10 February 2021",
                        "Date of Hearing: 10 February 2021")
    with pytest.raises(ValueError, match="judgment date"):
        check(root, row, page, evidence)


def test_conflicting_label_is_not_overridden_by_legacy_date(record):
    root, row, page, evidence, _ = record
    page = page.replace("Date of Judgment: 10 February 2021",
                        "10 February 2021\nDate of Judgment: 7 April 2021")
    with pytest.raises(ValueError, match="judgment date"):
        check(root, row, page, evidence)


@pytest.mark.parametrize("mutation", ["missing_member", "wrong_case", "wrong_title", "wrong_date", "wrong_url", "altered_pdf", "invented_text"])
def test_unsafe_evidence_is_rejected(record, mutation):
    root, row, page, evidence, pdf = record
    extracted = None
    if mutation == "missing_member":
        evidence["value"] = "KIEFEL CJ, BELL JJ"
    elif mutation == "wrong_case":
        row["citation"] = "[2021] HCA 10"
    elif mutation == "wrong_title":
        row["title"] = "Other party [2021] HCA 4 (10 February 2021)"
    elif mutation == "wrong_date":
        row["date"] = "10 December 2020"
    elif mutation == "wrong_url":
        evidence["source_url"] = "https://example.com/4.pdf"
    elif mutation == "altered_pdf":
        pdf.write_bytes(b"different bytes")
    else:
        extracted = page + " fabricated"
    with pytest.raises(ValueError):
        check(root, row, page, evidence, extracted=extracted)
