"""Tests for immi_case_downloader.sources.federal_court — Phase 5."""

import os
import responses

import pytest

from immi_case_downloader.sources.federal_court import FederalCourtScraper, FEDCOURT_BASE
from immi_case_downloader.config import FEDERAL_COURT_SEARCH
from immi_case_downloader.models import ImmigrationCase


FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _load_fixture(name: str) -> str:
    with open(os.path.join(FIXTURES_DIR, name), encoding="utf-8") as f:
        return f.read()


class TestParseResults:
    """Test _parse_results with fixture HTML."""

    def test_parses_search_results(self, fedcourt_search_html):
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(fedcourt_search_html, "lxml")
        scraper = FederalCourtScraper(delay=0)
        cases = scraper._parse_results(soup, 2020, 2026)

        assert len(cases) >= 1
        assert all(c.source == "Federal Court" for c in cases)

    def test_extracts_citation(self, fedcourt_search_html):
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(fedcourt_search_html, "lxml")
        scraper = FederalCourtScraper(delay=0)
        cases = scraper._parse_results(soup, 2020, 2026)

        citations = [c.citation for c in cases if c.citation]
        assert any("FCA" in c or "FCCA" in c for c in citations)

    def test_year_filter(self, fedcourt_search_html):
        """Cases outside year range are excluded."""
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(fedcourt_search_html, "lxml")
        scraper = FederalCourtScraper(delay=0)
        cases = scraper._parse_results(soup, 2025, 2026)

        # All 2024 cases should be filtered out
        for c in cases:
            if c.year:
                assert c.year >= 2025

    def test_court_code_detection(self, fedcourt_search_html):
        """FCCA citations correctly detect FCCA court code."""
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(fedcourt_search_html, "lxml")
        scraper = FederalCourtScraper(delay=0)
        cases = scraper._parse_results(soup, 2020, 2026)

        court_codes = {c.court_code for c in cases}
        # Should have detected at least one court code
        assert court_codes.intersection({"FCA", "FCCA"})


class TestSearchCases:
    @responses.activate
    def test_deduplicates_across_terms(self, fedcourt_search_html):
        """Same case from different search terms is not duplicated."""
        responses.add(responses.GET, FEDERAL_COURT_SEARCH, body=fedcourt_search_html, status=200)
        # Second term also returns same results
        responses.add(responses.GET, FEDERAL_COURT_SEARCH, body=fedcourt_search_html, status=200)

        scraper = FederalCourtScraper(delay=0)
        cases = scraper.search_cases(start_year=2020, end_year=2026, max_results_per_db=100)

        urls = [c.url for c in cases]
        assert len(urls) == len(set(urls))

    @responses.activate
    def test_max_results_respected(self, fedcourt_search_html):
        """max_results caps the total."""
        responses.add(responses.GET, FEDERAL_COURT_SEARCH, body=fedcourt_search_html, status=200)

        scraper = FederalCourtScraper(delay=0)
        cases = scraper.search_cases(start_year=2020, end_year=2026, max_results_per_db=1)
        assert len(cases) <= 1

    @responses.activate
    def test_handles_connection_failure(self):
        """Connection failure returns empty list."""
        import requests as req
        responses.add(responses.GET, FEDERAL_COURT_SEARCH, body=req.ConnectionError("DNS fail"))

        scraper = FederalCourtScraper(delay=0)
        cases = scraper.search_cases(start_year=2024, end_year=2024, max_results_per_db=10)
        assert cases == []


class TestDownloadCaseDetail:
    @responses.activate
    def test_success(self):
        """Successful download extracts text."""
        html = """<html><body>
        <div class="judgment">
        <p>BEFORE: Justice Smith</p>
        <p>DATE OF ORDER: 15 March 2024</p>
        <p>CATCHWORDS: Migration - judicial review</p>
        <p>The Court orders that the appeal is dismissed.</p>
        </div>
        </body></html>"""
        case_url = "https://www.fedcourt.gov.au/judgments/2024/fca50"
        responses.add(responses.GET, case_url, body=html, status=200)

        scraper = FederalCourtScraper(delay=0)
        case = ImmigrationCase(url=case_url, court_code="FCA")
        text = scraper.download_case_detail(case)

        assert text is not None
        assert "dismissed" in text.lower()

    @responses.activate
    def test_no_url(self):
        scraper = FederalCourtScraper(delay=0)
        case = ImmigrationCase(url="")
        assert scraper.download_case_detail(case) is None

    @responses.activate
    def test_extracts_judges(self):
        html = "<html><body><article><p>BEFORE: Justice Williams</p><p>Some text</p></article></body></html>"
        case_url = "https://www.fedcourt.gov.au/judgments/2024/test"
        responses.add(responses.GET, case_url, body=html, status=200)

        scraper = FederalCourtScraper(delay=0)
        case = ImmigrationCase(url=case_url)
        scraper.download_case_detail(case)

        assert "Williams" in case.judges

    @responses.activate
    def test_fallback_body_when_no_content_div(self):
        """Falls back to body text when no judgment div found."""
        html = "<html><body><p>Just some plain text content</p></body></html>"
        case_url = "https://www.fedcourt.gov.au/judgments/2024/plain"
        responses.add(responses.GET, case_url, body=html, status=200)

        scraper = FederalCourtScraper(delay=0)
        case = ImmigrationCase(url=case_url)
        text = scraper.download_case_detail(case)

        assert text is not None
        assert "plain text" in text.lower()
