"""Analytics page tests: chart cards, filters, outcome data, judges, legal concepts."""

from .react_helpers import (
    react_navigate,
    wait_for_loading_gone,
    assert_no_js_errors,
    get_heading,
)


class TestAnalyticsPage:
    """Analytics page loads and renders chart sections."""

    def test_analytics_heading(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        heading = get_heading(react_page)
        assert "Analytics" in heading

    def test_no_js_errors(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        assert_no_js_errors(react_page)

    def test_outcome_by_court_section(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Outcome Rate by Court").is_visible()

    def test_affirmed_rate_trend_section(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Affirmed Rate Trend").is_visible()

    def test_top_judges_section(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        # Use heading role to avoid matching nav link text with the same substring
        assert react_page.get_by_role("heading", name="Most Active Judges", exact=False).is_visible()

    def test_legal_concepts_section(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Legal Concepts Frequency").is_visible()

    def test_chart_cards_render(self, react_page):
        """ChartCard components should render with loading or content state."""
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        cards = react_page.locator(".rounded-lg.border")
        assert cards.count() >= 4

    def test_filter_scope_panel_visible(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        assert react_page.locator("[data-testid='analytics-filter-scope']").is_visible()


class TestAnalyticsFilters:
    """Filter bar on Analytics page: court pills and year range."""

    def test_all_courts_button_active_by_default(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        all_btn = react_page.get_by_text("All Courts", exact=True)
        assert all_btn.is_visible()
        classes = all_btn.get_attribute("class") or ""
        assert "bg-accent" in classes

    def test_court_filter_buttons_visible(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        for court in ["AATA", "FCA", "FCCA", "HCA"]:
            assert react_page.get_by_text(court, exact=True).first.is_visible()

    def test_click_court_filter(self, react_page):
        """Clicking a court pill activates it and deactivates 'All Courts'."""
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        fca_btn = react_page.get_by_text("FCA", exact=True).first
        fca_btn.click()
        react_page.wait_for_timeout(500)
        classes = fca_btn.get_attribute("class") or ""
        assert "bg-accent" in classes

    def test_time_preset_buttons(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("All Time", exact=True).is_visible()
        assert react_page.get_by_text("Last 5y", exact=True).is_visible()
        assert react_page.get_by_text("Last 10y", exact=True).is_visible()

    def test_click_time_preset(self, react_page):
        """Clicking a time preset activates it."""
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        btn = react_page.get_by_text("Last 5y", exact=True)
        btn.click()
        react_page.wait_for_timeout(500)
        classes = btn.get_attribute("class") or ""
        assert "bg-accent" in classes

    def test_year_select_dropdowns(self, react_page):
        """Year range selectors are visible and functional."""
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        selects = react_page.locator("select")
        assert selects.count() >= 2

    def test_reset_button_shows_after_filter_change(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        react_page.get_by_text("FCA", exact=True).first.click()
        react_page.wait_for_timeout(300)
        assert react_page.get_by_text("Reset Filters", exact=True).is_visible()

    def test_keyboard_r_resets_filters(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        react_page.get_by_text("FCA", exact=True).first.click()
        react_page.wait_for_timeout(300)
        react_page.locator("h1").first.click()
        react_page.keyboard.press("r")
        react_page.wait_for_timeout(400)
        all_btn = react_page.get_by_text("All Courts", exact=True)
        classes = all_btn.get_attribute("class") or ""
        assert "bg-accent" in classes
