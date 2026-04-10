"""Tests for CaseScraper protocol and MetadataExtractor."""

import pytest
from immi_case_downloader.sources.protocol import CaseScraper
from immi_case_downloader.sources.austlii import AustLIIScraper
from immi_case_downloader.sources.federal_court import FederalCourtScraper
from immi_case_downloader.sources.metadata_extractor import MetadataExtractor


def test_austlii_scraper_implements_protocol():
    scraper = AustLIIScraper()
    assert isinstance(scraper, CaseScraper)


def test_federal_court_scraper_implements_protocol():
    scraper = FederalCourtScraper()
    assert isinstance(scraper, CaseScraper)


def test_metadata_extractor_with_empty_html():
    extractor = MetadataExtractor()
    result = extractor.extract("", citation="AATA [2024] 100", base_url="https://example.com")
    assert isinstance(result, dict)


def test_metadata_extractor_with_malformed_html():
    extractor = MetadataExtractor()
    result = extractor.extract("<html><br><></>", citation="FCA [2023] 50", base_url="https://example.com")
    assert isinstance(result, dict)


def test_metadata_extractor_with_binary_data():
    extractor = MetadataExtractor()
    result = extractor.extract("\x00\xff\xfe garbage", citation="HCA [2022] 1", base_url="https://example.com")
    assert isinstance(result, dict)


def test_metadata_extractor_extracts_judges():
    extractor = MetadataExtractor()
    text = "BEFORE: Justice Smith\nSome case content here."
    result = extractor.extract(text)
    assert result.get("judges") == "Justice Smith"


def test_metadata_extractor_extracts_coram():
    extractor = MetadataExtractor()
    text = "Coram: Senior Member Jones\nDecision follows."
    result = extractor.extract(text)
    assert result.get("judges") == "Senior Member Jones"


def test_metadata_extractor_extracts_date():
    extractor = MetadataExtractor()
    text = "DATE OF DECISION: 15 March 2024\nSome content."
    result = extractor.extract(text)
    assert result.get("date") == "15 March 2024"


def test_metadata_extractor_extracts_catchwords():
    extractor = MetadataExtractor()
    text = "CATCHWORDS: Migration Act 1958 — protection visa — applicant\n\nSome further text."
    result = extractor.extract(text)
    assert "catchwords" in result
    assert "protection visa" in result["catchwords"]


def test_metadata_extractor_extracts_citation_when_not_provided():
    extractor = MetadataExtractor()
    text = "This is the case [2023] AATA 456 which was decided on..."
    result = extractor.extract(text, citation="")
    assert result.get("citation") == "[2023] AATA 456"


def test_metadata_extractor_skips_citation_when_provided():
    extractor = MetadataExtractor()
    text = "This is the case [2023] AATA 456 which was decided on..."
    result = extractor.extract(text, citation="[2023] AATA 456")
    assert "citation" not in result


def test_metadata_extractor_extracts_visa_type():
    extractor = MetadataExtractor()
    text = "The applicant applied for a protection visa under the Migration Act."
    result = extractor.extract(text)
    assert result.get("visa_type", "").lower().startswith("protection visa")


def test_metadata_extractor_extracts_legislation():
    extractor = MetadataExtractor()
    text = "Under the Migration Act 1958, the tribunal considered the application."
    result = extractor.extract(text)
    assert "legislation" in result
    assert "Migration Act 1958" in result["legislation"]


def test_metadata_extractor_returns_empty_dict_for_unrecognised_text():
    extractor = MetadataExtractor()
    result = extractor.extract("Nothing relevant here at all.")
    assert isinstance(result, dict)


def test_austlii_has_download_case_text():
    scraper = AustLIIScraper()
    assert callable(getattr(scraper, "download_case_text", None))


def test_federal_court_has_download_case_text():
    scraper = FederalCourtScraper()
    assert callable(getattr(scraper, "download_case_text", None))


def test_federal_court_search_cases_signature_accepts_protocol_params():
    """FederalCourtScraper.search_cases must accept all Protocol parameters."""
    import inspect
    sig = inspect.signature(FederalCourtScraper.search_cases)
    params = set(sig.parameters.keys())
    assert "databases" in params
    assert "keywords" in params
    assert "start_year" in params
    assert "end_year" in params
    assert "max_results_per_db" in params
