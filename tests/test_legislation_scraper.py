"""Tests for LegislationScraper.

Uses unittest.mock to stub HTTP responses so no real network calls are made.
Tests cover TOC parsing, section text extraction, last_amended detection,
and the full scrape_one() pipeline.
"""

from unittest.mock import MagicMock, patch

import pytest
import requests

from immi_case_downloader.sources.legislation_scraper import (
    KNOWN_LAWS,
    LegislationScraper,
)

# ── HTML fixtures ─────────────────────────────────────────────────────────────

TOC_HTML = """
<html><body>
<div class="body">
  <p>Series as amended to 1 December 2025</p>
  <h2>Part 1—Preliminary</h2>
  <ul>
    <li><a href="s1.html">1  Short title</a></li>
    <li><a href="s2.html">2  Commencement</a></li>
  </ul>
  <h2>Part 9—Deportation</h2>
  <h3>Division 2—Cancellation of visas</h3>
  <ul>
    <li><a href="s501.html">501  Character test</a></li>
    <li><a href="s501a.html">501A  Revocation of character cancellation</a></li>
  </ul>
  <h2>Schedule 1</h2>
  <ul>
    <li><a href="sch1.html">Schedule 1  Points table</a></li>
  </ul>
</div>
</body></html>
"""

SECTION_HTML = """
<html><body>
<nav>Navigation</nav>
<div class="body">
  <h2>Section 501 Character test</h2>
  <p>(501) The Minister may refuse to grant a visa to a person if the person
  does not pass the character test under section 501A.</p>
  <p>The Minister must consider:</p>
  <p>(a) criminal history</p>
  <p>(b) national interest</p>
</div>
<footer>Footer</footer>
</body></html>
"""

SECTION_HTML_NO_BODY = """
<html><body>
<p>Section 1 — Short title</p>
<p>This Act may be cited as the Migration Act 1958.</p>
</body></html>
"""


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def scraper():
    return LegislationScraper(delay=0)  # No delay in tests


def make_response(text: str, status: int = 200) -> MagicMock:
    """Create a mock requests.Response."""
    resp = MagicMock(spec=requests.Response)
    resp.text = text
    resp.status_code = status
    resp.raise_for_status = MagicMock()
    return resp


# ── TOC parsing ───────────────────────────────────────────────────────────────

class TestParseToc:
    def test_finds_section_links(self, scraper):
        links = scraper._parse_toc(TOC_HTML, "https://www.austlii.edu.au/au/legis/cth/consol_act/ma1958116/")
        assert len(links) == 4  # s1, s2, s501, s501a (sch1 excluded — not s*.html)

    def test_section_id_stripped(self, scraper):
        links = scraper._parse_toc(TOC_HTML, "https://example.com/")
        ids = [lk.section_id for lk in links]
        assert "s1" in ids
        assert "s501" in ids
        assert "s501a" in ids

    def test_part_context_tracked(self, scraper):
        links = scraper._parse_toc(TOC_HTML, "https://example.com/")
        by_id = {lk.section_id: lk for lk in links}

        assert by_id["s1"].part == "Part 1—Preliminary"
        assert by_id["s501"].part == "Part 9—Deportation"

    def test_division_context_tracked(self, scraper):
        links = scraper._parse_toc(TOC_HTML, "https://example.com/")
        by_id = {lk.section_id: lk for lk in links}

        assert by_id["s501"].division == "Division 2—Cancellation of visas"
        assert by_id["s1"].division == ""  # Part 1 has no division

    def test_number_and_title_parsed(self, scraper):
        links = scraper._parse_toc(TOC_HTML, "https://example.com/")
        by_id = {lk.section_id: lk for lk in links}

        assert by_id["s501"].number == "501"
        assert by_id["s501"].title == "Character test"
        assert by_id["s1"].number == "1"
        assert by_id["s1"].title == "Short title"

    def test_absolute_url_built(self, scraper):
        links = scraper._parse_toc(TOC_HTML, "https://www.austlii.edu.au/au/legis/cth/consol_act/ma1958116/")
        assert links[0].url.startswith("https://")
        assert "ma1958116" in links[0].url

    def test_no_duplicate_section_ids(self, scraper):
        # If TOC links same section twice, dedup should apply
        duplicate_toc = TOC_HTML + '<a href="s1.html">1  Short title</a>'
        links = scraper._parse_toc(duplicate_toc, "https://example.com/")
        ids = [lk.section_id for lk in links]
        assert ids.count("s1") == 1

    def test_empty_body_returns_empty_list(self, scraper):
        links = scraper._parse_toc("<html><body></body></html>", "https://example.com/")
        assert links == []


# ── Text extraction ───────────────────────────────────────────────────────────

class TestExtractSectionText:
    def test_removes_nav_and_footer(self, scraper):
        text = scraper._extract_section_text(SECTION_HTML)
        assert "Navigation" not in text
        assert "Footer" not in text

    def test_includes_section_content(self, scraper):
        text = scraper._extract_section_text(SECTION_HTML)
        assert "Character test" in text
        assert "criminal history" in text

    def test_fallback_to_body_when_no_body_div(self, scraper):
        text = scraper._extract_section_text(SECTION_HTML_NO_BODY)
        assert "Short title" in text
        assert "Migration Act 1958" in text

    def test_collapses_excess_blank_lines(self, scraper):
        html = "<html><body><div class='body'>Line 1\n\n\n\n\nLine 2</div></body></html>"
        text = scraper._extract_section_text(html)
        assert "\n\n\n" not in text

    def test_returns_stripped_string(self, scraper):
        text = scraper._extract_section_text(SECTION_HTML)
        assert text == text.strip()


# ── Last amended parsing ──────────────────────────────────────────────────────

class TestParseLastAmended:
    def test_extracts_amended_to_date(self, scraper):
        html = "<p>Series as amended to 1 December 2025</p>"
        assert scraper._parse_last_amended(html) == "1 December 2025"

    def test_extracts_as_at_date(self, scraper):
        html = "<p>Authoritative version as at 15 November 2025</p>"
        assert scraper._parse_last_amended(html) == "15 November 2025"

    def test_returns_empty_string_when_not_found(self, scraper):
        assert scraper._parse_last_amended("<p>No date here</p>") == ""

    def test_case_insensitive(self, scraper):
        html = "<p>AMENDED TO 5 January 2026</p>"
        assert scraper._parse_last_amended(html) == "5 January 2026"


# ── scrape_one() integration ──────────────────────────────────────────────────

class TestScrapeOne:
    def test_returns_none_for_unknown_law(self, scraper):
        result = scraper.scrape_one("nonexistent-law-id")
        assert result is None

    def test_returns_none_when_toc_fetch_fails(self, scraper):
        with patch.object(scraper, "fetch", return_value=None):
            result = scraper.scrape_one("migration-act-1958")
        assert result is None

    def test_returns_dict_with_required_keys(self, scraper):
        toc_resp = make_response(TOC_HTML)
        sec_resp = make_response(SECTION_HTML)

        responses = [toc_resp, sec_resp, sec_resp, sec_resp, sec_resp]
        with patch.object(scraper, "fetch", side_effect=responses):
            result = scraper.scrape_one("migration-act-1958")

        assert result is not None
        required = {"id", "title", "austlii_id", "shortcode", "type",
                    "jurisdiction", "description", "sections_count",
                    "last_amended", "last_scraped", "sections"}
        assert required.issubset(result.keys())

    def test_sections_count_matches_sections_list(self, scraper):
        toc_resp = make_response(TOC_HTML)
        sec_resp = make_response(SECTION_HTML)
        responses = [toc_resp] + [sec_resp] * 4

        with patch.object(scraper, "fetch", side_effect=responses):
            result = scraper.scrape_one("migration-act-1958")

        assert result is not None
        assert result["sections_count"] == len(result["sections"])

    def test_law_id_preserved(self, scraper):
        toc_resp = make_response(TOC_HTML)
        sec_resp = make_response(SECTION_HTML)
        responses = [toc_resp] + [sec_resp] * 4

        with patch.object(scraper, "fetch", side_effect=responses):
            result = scraper.scrape_one("migration-act-1958")

        assert result is not None
        assert result["id"] == "migration-act-1958"

    def test_section_fetch_failure_uses_placeholder(self, scraper):
        """If a section page 404s, placeholder text is used instead of crashing."""
        toc_resp = make_response(TOC_HTML)
        responses = [toc_resp, None, make_response(SECTION_HTML), None, make_response(SECTION_HTML)]

        with patch.object(scraper, "fetch", side_effect=responses):
            result = scraper.scrape_one("migration-act-1958")

        assert result is not None
        placeholder_sections = [
            s for s in result["sections"]
            if "[Section text could not be loaded]" in s["text"]
        ]
        assert len(placeholder_sections) == 2

    def test_progress_callback_called(self, scraper):
        toc_resp = make_response(TOC_HTML)
        sec_resp = make_response(SECTION_HTML)
        responses = [toc_resp] + [sec_resp] * 4

        calls = []
        def callback(law_id, current, total, section_id):
            calls.append((law_id, current, total, section_id))

        with patch.object(scraper, "fetch", side_effect=responses):
            scraper.scrape_one("migration-act-1958", progress_callback=callback)

        # Should have calls for each section + final "done"
        assert len(calls) > 0
        last = calls[-1]
        assert last[3] == "done"
        assert last[1] == last[2]  # current == total on "done"

    def test_last_amended_extracted(self, scraper):
        toc_resp = make_response(TOC_HTML)  # Contains "amended to 1 December 2025"
        sec_resp = make_response(SECTION_HTML)
        responses = [toc_resp] + [sec_resp] * 4

        with patch.object(scraper, "fetch", side_effect=responses):
            result = scraper.scrape_one("migration-act-1958")

        assert result is not None
        assert "2025" in result["last_amended"]


# ── scrape_all() ──────────────────────────────────────────────────────────────

class TestScrapeAll:
    def test_returns_list(self, scraper):
        with patch.object(scraper, "scrape_one", return_value=None):
            result = scraper.scrape_all()
        assert isinstance(result, list)

    def test_skips_failed_laws(self, scraper):
        results = [{"id": "migration-act-1958"}, None, {"id": "australian-citizenship-act-2007"}]
        with patch.object(scraper, "scrape_one", side_effect=results):
            output = scraper.scrape_all(["migration-act-1958", "migration-regulations-1994", "australian-citizenship-act-2007"])
        assert len(output) == 2

    def test_only_scrapes_requested_ids(self, scraper):
        scraped_ids = []
        def mock_scrape(law_id, **kwargs):
            scraped_ids.append(law_id)
            return {"id": law_id}

        with patch.object(scraper, "scrape_one", side_effect=mock_scrape):
            scraper.scrape_all(["migration-act-1958"])

        assert scraped_ids == ["migration-act-1958"]

    def test_default_scrapes_all_known_laws(self, scraper):
        scraped_ids = []
        def mock_scrape(law_id, **kwargs):
            scraped_ids.append(law_id)
            return {"id": law_id}

        with patch.object(scraper, "scrape_one", side_effect=mock_scrape):
            scraper.scrape_all()

        assert set(scraped_ids) == set(KNOWN_LAWS.keys())


# ── KNOWN_LAWS sanity check ───────────────────────────────────────────────────

class TestKnownLaws:
    def test_all_required_keys_present(self):
        required = {"austlii_id", "title", "shortcode", "type", "jurisdiction", "description"}
        for law_id, meta in KNOWN_LAWS.items():
            missing = required - set(meta.keys())
            assert not missing, f"{law_id} is missing keys: {missing}"

    def test_austlii_id_format(self):
        for law_id, meta in KNOWN_LAWS.items():
            assert "/" in meta["austlii_id"], f"{law_id} austlii_id has no '/'"
            assert meta["austlii_id"].startswith("consol_"), f"{law_id} austlii_id should start with consol_"

    def test_five_laws_defined(self):
        # AATA 1975 was repealed Oct 2024 (replaced by ARTA 2024) and removed from AustLII.
        assert len(KNOWN_LAWS) == 5

    def test_austlii_ids_are_current(self):
        """Verify the AustLII IDs match confirmed live URLs (updated 2026-02-21)."""
        expected = {
            "migration-act-1958": "consol_act/ma1958118",
            "migration-regulations-1994": "consol_reg/mr1994227",
            "australian-citizenship-act-2007": "consol_act/aca2007254",
            "australian-border-force-act-2015": "consol_act/abfa2015225",
            "administrative-review-tribunal-act-2024": "consol_act/arta2024336",
        }
        for law_id, expected_id in expected.items():
            assert KNOWN_LAWS[law_id]["austlii_id"] == expected_id, (
                f"{law_id}: expected {expected_id}, got {KNOWN_LAWS[law_id]['austlii_id']}"
            )
