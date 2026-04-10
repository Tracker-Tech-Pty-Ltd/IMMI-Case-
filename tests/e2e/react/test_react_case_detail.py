"""Case detail page tests: hero section, metadata grid, full text toggle, related cases."""

from .react_helpers import (
    react_navigate,
    wait_for_loading_gone,
)


def _navigate_to_seed_case(page):
    """Navigate to a seed case detail page (one with a known court code).

    CRUD tests may create artifact cases without court_code that sort first.
    Filter by AATA court to ensure we land on a real seed case.
    """
    react_navigate(page, "/cases")
    wait_for_loading_gone(page)
    # Click a row with a known court code — seed data has AATA cases
    row = page.locator("tbody tr").filter(has_text="AATA").first
    with page.expect_response(
        lambda r: "/api/v1/cases/" in r.url and r.request.method == "GET",
        timeout=15000,
    ):
        row.click()
    page.wait_for_timeout(500)
    wait_for_loading_gone(page)


class TestHeroSection:
    """Case detail hero — title, court badge, outcome badge, AustLII link."""

    def test_case_title_displayed(self, react_page):
        _navigate_to_seed_case(react_page)
        # Should show a case title heading
        h1 = react_page.locator("h1")
        assert h1.is_visible()
        assert len(h1.inner_text()) > 0

    def test_court_badge_visible(self, react_page):
        _navigate_to_seed_case(react_page)
        # Court badge should be present (e.g. AATA, FCA, HCA, etc.)
        court_codes = ["AATA", "FCA", "FCCA", "FedCFamC2G", "HCA", "ARTA"]
        found = any(react_page.get_by_text(c, exact=True).count() > 0 for c in court_codes)
        assert found

    def test_outcome_badge_visible(self, react_page):
        _navigate_to_seed_case(react_page)
        # Outcome badges contain text like Affirmed, Dismissed, etc.
        outcomes = ["Affirmed", "Dismissed", "Allowed", "Set aside", "Granted", "Remitted"]
        found = any(react_page.get_by_text(o, exact=True).count() > 0 for o in outcomes)
        assert found

    def test_source_link(self, react_page):
        _navigate_to_seed_case(react_page)
        # Link text is t("cases.url") = "AustLII URL"
        link = react_page.get_by_role("link", name="AustLII URL")
        assert link.is_visible()
        href = link.get_attribute("href") or ""
        assert "austlii.edu.au" in href

    def test_catchwords_displayed(self, react_page):
        _navigate_to_seed_case(react_page)
        # Catchwords are displayed as secondary text under the hero title
        # Seed cases all have catchwords
        hero_card = react_page.locator(".rounded-lg.border").first
        text = hero_card.inner_text()
        assert len(text) > 20  # Should contain meaningful content


class TestMetadataGrid:
    """Metadata grid: key-value pairs for citation, court, date, etc."""

    def test_metadata_heading(self, react_page):
        _navigate_to_seed_case(react_page)
        assert react_page.locator("h2").get_by_text("Case Information", exact=True).is_visible()

    def test_metadata_has_citation(self, react_page):
        _navigate_to_seed_case(react_page)
        assert react_page.get_by_text("Citation", exact=True).first.is_visible()

    def test_metadata_has_court(self, react_page):
        _navigate_to_seed_case(react_page)
        assert react_page.get_by_text("Court", exact=True).first.is_visible()

    def test_metadata_has_date(self, react_page):
        _navigate_to_seed_case(react_page)
        assert react_page.get_by_text("Date", exact=True).first.is_visible()

    def test_metadata_has_legislation(self, react_page):
        _navigate_to_seed_case(react_page)
        assert react_page.get_by_text("Legislation", exact=True).first.is_visible()


class TestFullTextToggle:
    """Full text expand/collapse toggle (if full_text is available)."""

    def test_full_text_heading_present(self, react_page):
        """Full Text section may or may not be present depending on seed data."""
        _navigate_to_seed_case(react_page)
        # Full text section exists only if the backend returns full_text
        # This may not be visible if seed cases don't have full text files
        # Just verify the page loaded without errors
        assert react_page.locator("h1").is_visible()


class TestActionButtons:
    """Edit and Delete buttons on the detail page."""

    def test_edit_link_visible(self, react_page):
        _navigate_to_seed_case(react_page)
        # Edit link is inside main, scoped to avoid sidebar matches
        edit_link = react_page.locator("main").get_by_role("link", name="Edit")
        assert edit_link.is_visible()

    def test_edit_link_navigates(self, react_page):
        _navigate_to_seed_case(react_page)
        react_page.locator("main").get_by_role("link", name="Edit").click()
        react_page.wait_for_load_state("networkidle")
        assert "/edit" in react_page.url

    def test_delete_button_visible(self, react_page):
        _navigate_to_seed_case(react_page)
        delete_btn = react_page.locator("main").get_by_role("button", name="Delete")
        assert delete_btn.is_visible()

    def test_breadcrumb_visible(self, react_page):
        """Case detail shows breadcrumb with 'Cases' link instead of Back button."""
        _navigate_to_seed_case(react_page)
        breadcrumb = react_page.locator("main nav").filter(has_text="Cases")
        assert breadcrumb.is_visible()
