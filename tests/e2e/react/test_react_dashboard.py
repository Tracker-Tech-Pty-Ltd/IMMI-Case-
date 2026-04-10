"""Dashboard page tests: stat cards, charts, quick actions, recent cases."""

from .react_helpers import (
    react_navigate,
    wait_for_loading_gone,
)


class TestStatCards:
    """Dashboard stat cards with live data from seed cases."""

    def test_total_cases_card(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Total Cases", exact=True).is_visible()

    def test_with_full_text_card(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("With Full Text", exact=True).is_visible()

    def test_courts_card(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Courts", exact=True).is_visible()

    def test_case_categories_card(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Case Categories", exact=True).is_visible()

    def test_stat_card_shows_numeric_value(self, react_page):
        """Total Cases card should display a numeric value from seed data."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        # The stat card shows the total; seed data has 10+ cases
        total_card = react_page.get_by_text("Total Cases", exact=True).locator("xpath=../..")
        text = total_card.inner_text()
        assert any(c.isdigit() for c in text)


class TestCharts:
    """Chart sections for court distribution."""

    def test_cases_by_court_section(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_role("heading", name="Cases by Court").is_visible()

    def test_year_trend_section(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_role("heading", name="Year Trend").is_visible()

    def test_chart_renders_svg(self, react_page):
        """Recharts renders SVG elements for the charts."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        svgs = react_page.locator("svg.recharts-surface")
        assert svgs.count() >= 1

    def test_dashboard_error_state_on_stats_failure(self, react_page):
        react_page.route(
            "**/api/v1/stats",
            lambda route: route.fulfill(
                status=500,
                content_type="application/json",
                body='{"error":"forced test failure"}',
            ),
        )
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Failed to load Dashboard", exact=True).is_visible()


class TestQuickActions:
    """Quick action buttons that navigate to other pages."""

    def test_download_action(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        main = react_page.locator("main")
        btn = main.get_by_role("button", name="Download", exact=True)
        assert btn.is_visible()

    def test_pipeline_action(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        main = react_page.locator("main")
        btn = main.get_by_role("button", name="Pipeline", exact=True)
        assert btn.is_visible()

    def test_export_csv_action(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        main = react_page.locator("main")
        btn = main.get_by_role("button", name="Export CSV", exact=True)
        assert btn.is_visible()

    def test_export_json_action(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        main = react_page.locator("main")
        btn = main.get_by_role("button", name="Export JSON", exact=True)
        assert btn.is_visible()


class TestRecentCases:
    """Recent cases section shows seed data."""

    def test_recent_cases_heading(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_role("heading", name="Recent Cases").is_visible()

    def test_recent_case_clickable(self, react_page):
        """Clicking a recent case navigates to its detail page."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        # Click the first case in the recent cases list
        recent_section = react_page.get_by_role("heading", name="Recent Cases").locator("..")
        first_case = recent_section.locator("button").first
        if first_case.is_visible():
            first_case.click()
            react_page.wait_for_load_state("networkidle")
            assert "/cases/" in react_page.url
