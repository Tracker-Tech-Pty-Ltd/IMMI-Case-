"""Tests for immi_case_downloader.sources.austlii — Phase 5 scraper tests."""

import os
import responses

import pytest

from immi_case_downloader.sources.austlii import AustLIIScraper, YearListingUnavailable
from immi_case_downloader.config import AUSTLII_BASE, AUSTLII_DATABASES, IMMIGRATION_KEYWORDS


FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _load_fixture(name: str) -> str:
    with open(os.path.join(FIXTURES_DIR, name), encoding="utf-8") as f:
        return f.read()


class TestIsImmigrationCase:
    """Test the static _is_immigration_case method."""

    @pytest.mark.parametrize("text", [
        "XYZB v Minister for Immigration (Migration)",
        "Smith v Minister for Home Affairs",
        "Application for protection visa",
        "Re: Department of Home Affairs",
        "Section 501 character test",
        "ABCD (Refugee) review",
        "Migration Act 1958 application",
        "Visa cancellation review",
        "Bridging visa application",
    ])
    def test_immigration_cases_detected(self, text):
        assert AustLIIScraper._is_immigration_case(text, IMMIGRATION_KEYWORDS) is True

    @pytest.mark.parametrize("text", [
        "Jones v Commissioner of Taxation",
        "Smith v Smith (Family Law)",
        "ABC Pty Ltd v DEF Pty Ltd",
        "Environmental Protection Authority v XYZ",
        "Workers Compensation Appeal",
    ])
    def test_non_immigration_cases_rejected(self, text):
        assert AustLIIScraper._is_immigration_case(text, IMMIGRATION_KEYWORDS) is False

    def test_custom_keywords_match(self):
        assert AustLIIScraper._is_immigration_case("special keyword match", ["special keyword"]) is True

    def test_case_insensitive(self):
        assert AustLIIScraper._is_immigration_case("MINISTER FOR IMMIGRATION", IMMIGRATION_KEYWORDS) is True


class TestBrowseYear:
    """Test _browse_year with mocked HTTP responses."""

    @responses.activate
    def test_direct_url_success(self, austlii_year_html):
        """Year listing page parses immigration cases correctly."""
        url = f"{AUSTLII_BASE}/au/cases/cth/AATA/2024/"
        responses.add(responses.GET, url, body=austlii_year_html, status=200)

        scraper = AustLIIScraper(delay=0)
        db_info = AUSTLII_DATABASES["AATA"]
        cases = scraper._browse_year("AATA", db_info, 2024, IMMIGRATION_KEYWORDS)

        # Should find immigration cases (Migration/Refugee markers) but skip tax case
        assert len(cases) >= 2
        assert all(c.court_code == "AATA" for c in cases)
        assert all(c.year == 2024 for c in cases)
        assert all(c.source == "AustLII" for c in cases)

    @responses.activate
    def test_fallback_to_viewdb(self, austlii_year_html):
        """Falls back to viewdb when direct URL fails."""
        direct_url = f"{AUSTLII_BASE}/au/cases/cth/AATA/2024/"
        viewdb_url = f"{AUSTLII_BASE}/cgi-bin/viewdb/au/cases/cth/AATA/"

        responses.add(responses.GET, direct_url, status=500)
        responses.add(responses.GET, viewdb_url, body=austlii_year_html, status=200)

        scraper = AustLIIScraper(delay=0)
        db_info = AUSTLII_DATABASES["AATA"]
        cases = scraper._browse_year("AATA", db_info, 2024, IMMIGRATION_KEYWORDS)

        assert len(cases) >= 2
        # Retry adapter may cause more than 2 calls on 500 errors
        assert len(responses.calls) >= 2

    @responses.activate
    def test_both_fail_raises_year_listing_unavailable(self):
        """Both direct and viewdb failing is a signalled failure, not an empty year."""
        direct_url = f"{AUSTLII_BASE}/au/cases/cth/AATA/2024/"
        viewdb_url = f"{AUSTLII_BASE}/cgi-bin/viewdb/au/cases/cth/AATA/"

        responses.add(responses.GET, direct_url, status=500)
        responses.add(responses.GET, viewdb_url, status=500)

        scraper = AustLIIScraper(delay=0)
        db_info = AUSTLII_DATABASES["AATA"]
        with pytest.raises(YearListingUnavailable) as excinfo:
            scraper._browse_year("AATA", db_info, 2024, IMMIGRATION_KEYWORDS)
        assert "AATA/2024" in str(excinfo.value)

    @responses.activate
    def test_listing_without_matches_returns_empty_list(self):
        """A listing that loads but holds no immigration cases is [] — not a failure."""
        url = f"{AUSTLII_BASE}/au/cases/cth/AATA/2024/"
        responses.add(
            responses.GET,
            url,
            body="<html><body><a href='/au/cases/cth/AATA/2024/1.html'>"
                 "Jones v Commissioner of Taxation</a></body></html>",
            status=200,
        )

        scraper = AustLIIScraper(delay=0)
        db_info = AUSTLII_DATABASES["AATA"]
        assert scraper._browse_year("AATA", db_info, 2024, IMMIGRATION_KEYWORDS) == []

    @responses.activate
    def test_citation_extracted(self, austlii_year_html):
        """Citations are extracted from link text."""
        url = f"{AUSTLII_BASE}/au/cases/cth/AATA/2024/"
        responses.add(responses.GET, url, body=austlii_year_html, status=200)

        scraper = AustLIIScraper(delay=0)
        db_info = AUSTLII_DATABASES["AATA"]
        cases = scraper._browse_year("AATA", db_info, 2024, IMMIGRATION_KEYWORDS)

        citations = [c.citation for c in cases if c.citation]
        assert any("[2024] AATA" in c for c in citations)


class TestParseSearchResults:
    """Test _parse_search_results with fixture HTML."""

    @responses.activate
    def test_li_format(self, austlii_search_html):
        """Parses <li class="result"> format correctly."""
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(austlii_search_html, "lxml")
        scraper = AustLIIScraper(delay=0)
        db_info = AUSTLII_DATABASES["AATA"]
        cases = scraper._parse_search_results(soup, "AATA", db_info)

        assert len(cases) == 2
        assert cases[0].year == 2024
        assert cases[1].year == 2023
        assert cases[0].source == "AustLII"

    @responses.activate
    def test_citation_extraction(self, austlii_search_html):
        """Citations are extracted from search result titles."""
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(austlii_search_html, "lxml")
        scraper = AustLIIScraper(delay=0)
        cases = scraper._parse_search_results(soup, "AATA", AUSTLII_DATABASES["AATA"])

        assert any("[2024] AATA 200" in c.citation for c in cases)


class TestSearchCases:
    """Test the public search_cases method."""

    @responses.activate
    def test_unknown_database_skipped(self):
        """Unknown database code is skipped without error."""
        scraper = AustLIIScraper(delay=0)
        cases = scraper.search_cases(databases=["UNKNOWN_DB"])
        assert cases == []

    @responses.activate
    def test_max_results_respected(self, austlii_year_html):
        """max_results_per_db limits total results."""
        url = f"{AUSTLII_BASE}/au/cases/cth/AATA/2024/"
        responses.add(responses.GET, url, body=austlii_year_html, status=200)

        scraper = AustLIIScraper(delay=0)
        cases = scraper.search_cases(
            databases=["AATA"],
            start_year=2024,
            end_year=2024,
            max_results_per_db=1,
        )
        assert len(cases) <= 1

    @responses.activate
    def test_keyword_search_fallback(self):
        """When browse finds < 10, keyword search is attempted."""
        # Direct URL returns empty page
        direct_url = f"{AUSTLII_BASE}/au/cases/cth/AATA/2024/"
        responses.add(responses.GET, direct_url, body="<html><body></body></html>", status=200)

        # Keyword search returns results
        from immi_case_downloader.config import AUSTLII_SEARCH
        search_html = _load_fixture("austlii_search_results.html")
        responses.add(responses.GET, AUSTLII_SEARCH, body=search_html, status=200)

        scraper = AustLIIScraper(delay=0)
        cases = scraper.search_cases(
            databases=["AATA"],
            start_year=2024,
            end_year=2024,
        )
        # Should have found cases via keyword search
        assert len(cases) >= 1


class TestDownloadCaseDetail:
    """Test download_case_detail with fixture HTML."""

    @responses.activate
    def test_success(self, austlii_case_html):
        """Successful download returns text and extracts metadata."""
        from immi_case_downloader.models import ImmigrationCase

        case_url = "https://www.austlii.edu.au/au/cases/cth/AATA/2024/100.html"
        responses.add(responses.GET, case_url, body=austlii_case_html, status=200)

        scraper = AustLIIScraper(delay=0)
        case = ImmigrationCase(url=case_url, court_code="AATA", year=2024)
        text = scraper.download_case_detail(case)

        assert text is not None
        assert "protection visa" in text.lower() or "affirms" in text.lower()

    @responses.activate
    def test_no_url_returns_none(self):
        from immi_case_downloader.models import ImmigrationCase
        scraper = AustLIIScraper(delay=0)
        case = ImmigrationCase(url="")
        assert scraper.download_case_detail(case) is None

    @responses.activate
    def test_fetch_failure_returns_none(self):
        from immi_case_downloader.models import ImmigrationCase

        case_url = "https://www.austlii.edu.au/au/cases/cth/AATA/2024/999.html"
        responses.add(responses.GET, case_url, status=500)

        scraper = AustLIIScraper(delay=0)
        case = ImmigrationCase(url=case_url)
        assert scraper.download_case_detail(case) is None


class TestExtractMetadata:
    """Test _extract_metadata with fixture HTML."""

    @responses.activate
    def test_extracts_judges(self, austlii_case_html):
        from immi_case_downloader.models import ImmigrationCase
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(austlii_case_html, "lxml")
        scraper = AustLIIScraper(delay=0)
        case = ImmigrationCase()
        scraper._extract_metadata(soup, case)

        assert "Smith" in case.judges or "Member" in case.judges

    @responses.activate
    def test_extracts_date(self, austlii_case_html):
        from immi_case_downloader.models import ImmigrationCase
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(austlii_case_html, "lxml")
        scraper = AustLIIScraper(delay=0)
        case = ImmigrationCase()
        scraper._extract_metadata(soup, case)

        assert "March" in case.date or "2024" in case.date

    @responses.activate
    def test_extracts_catchwords(self, austlii_case_html):
        from immi_case_downloader.models import ImmigrationCase
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(austlii_case_html, "lxml")
        scraper = AustLIIScraper(delay=0)
        case = ImmigrationCase()
        scraper._extract_metadata(soup, case)

        assert case.catchwords != ""

    @responses.activate
    def test_extracts_visa_type(self, austlii_case_html):
        from immi_case_downloader.models import ImmigrationCase
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(austlii_case_html, "lxml")
        scraper = AustLIIScraper(delay=0)
        case = ImmigrationCase()
        scraper._extract_metadata(soup, case)

        assert "protection" in case.visa_type.lower() or "866" in case.visa_type

    @responses.activate
    def test_extracts_legislation(self, austlii_case_html):
        from immi_case_downloader.models import ImmigrationCase
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(austlii_case_html, "lxml")
        scraper = AustLIIScraper(delay=0)
        case = ImmigrationCase()
        scraper._extract_metadata(soup, case)

        assert "Migration Act" in case.legislation

    @responses.activate
    def test_extracts_citation_when_missing(self, austlii_case_html):
        from immi_case_downloader.models import ImmigrationCase
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(austlii_case_html, "lxml")
        scraper = AustLIIScraper(delay=0)
        case = ImmigrationCase(citation="")
        scraper._extract_metadata(soup, case)

        assert "[2024] AATA 100" in case.citation


class TestSearchDatabase:
    """Test _search_database's per-year failure handling and result cap."""

    def _scraper(self):
        scraper = AustLIIScraper(delay=0)
        scraper._keyword_search = lambda *a, **k: []
        return scraper

    def test_failed_year_is_skipped_not_fatal(self):
        """One unavailable year must not lose the years that did load."""
        from immi_case_downloader.models import ImmigrationCase
        from immi_case_downloader.sources.austlii import YearListingUnavailable

        scraper = self._scraper()

        def browse(db_code, db_info, year, keywords):
            if year == 2023:
                raise YearListingUnavailable("AATA/2023: listing unavailable (http_500)")
            return [ImmigrationCase(title=f"case {year}", year=year,
                                    url=f"https://example.test/{year}")]

        scraper._browse_year = browse
        cases = scraper._search_database(
            "AATA", AUSTLII_DATABASES["AATA"], IMMIGRATION_KEYWORDS, 2023, 2024, 500
        )
        assert [c.year for c in cases] == [2024]

    def test_truncation_keeps_the_newest_years(self):
        """max_results must drop the oldest cases, not the newest."""
        from immi_case_downloader.models import ImmigrationCase

        scraper = self._scraper()
        scraper._browse_year = lambda db_code, db_info, year, keywords: [
            ImmigrationCase(title=f"case {year}-{n}", year=year,
                            citation=f"[{year}] AATA {n}",
                            url=f"https://example.test/{year}/{n}.html")
            for n in range(6)
        ]

        cases = scraper._search_database(
            "AATA", AUSTLII_DATABASES["AATA"], IMMIGRATION_KEYWORDS, 2020, 2024, 6
        )

        assert len(cases) == 6
        assert {c.year for c in cases} == {2024}

    def test_truncation_keeps_the_highest_decision_numbers_within_a_year(self):
        """Within one year, decision 100 is newer than decision 99.

        A reversed sort on the citation string puts "[2024] AATA 99" ahead of
        "[2024] AATA 100", which is exactly backwards — this is the test that
        catches it.
        """
        from immi_case_downloader.models import ImmigrationCase

        scraper = self._scraper()
        scraper._browse_year = lambda db_code, db_info, year, keywords: [
            ImmigrationCase(title=f"case {n}", year=2024,
                            citation=f"[2024] AATA {n}",
                            url=f"https://example.test/2024/{n}.html")
            for n in (7, 9, 12, 88, 99, 100, 101, 250, 3, 41, 5, 60)
        ]

        cases = scraper._search_database(
            "AATA", AUSTLII_DATABASES["AATA"], IMMIGRATION_KEYWORDS, 2024, 2024, 3
        )

        assert [c.citation for c in cases] == [
            "[2024] AATA 250", "[2024] AATA 101", "[2024] AATA 100",
        ]

    def test_truncation_is_stable_when_no_decision_number_is_available(self):
        """A case with no parseable number sorts oldest, and nothing raises."""
        from immi_case_downloader.models import ImmigrationCase

        scraper = self._scraper()
        scraper._browse_year = lambda db_code, db_info, year, keywords: [
            ImmigrationCase(title="numbered", year=2024,
                            citation="[2024] AATA 5",
                            url="https://example.test/2024/5.html"),
            ImmigrationCase(title="bare", year=2024, url="https://example.test/x"),
        ] * 6

        cases = scraper._search_database(
            "AATA", AUSTLII_DATABASES["AATA"], IMMIGRATION_KEYWORDS, 2024, 2024, 6
        )

        assert len(cases) == 6
        assert all(c.title == "numbered" for c in cases)


class TestExtractMetadataGuard:
    """Unknown extractor keys must be dropped loudly, not set silently."""

    def test_unknown_metadata_key_is_dropped(self, monkeypatch):
        from bs4 import BeautifulSoup
        from immi_case_downloader.models import ImmigrationCase

        scraper = AustLIIScraper(delay=0)
        monkeypatch.setattr(
            scraper._metadata_extractor,
            "extract",
            lambda *a, **k: {"judges": "Smith J", "not_a_field": "x"},
        )

        case = ImmigrationCase.from_dict({"url": "https://example.test/1", "citation": "[2024] FCA 12"})
        scraper._extract_metadata(BeautifulSoup(
            "<html><h1>Example [2024] FCA 12</h1><p>JUDGE: Smith J</p></html>", "lxml"
        ), case)

        assert case.judges == "Smith J"
        assert not hasattr(case, "not_a_field")
