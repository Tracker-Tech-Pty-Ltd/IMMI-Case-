"""Dashboard page tests: stat cards, charts, quick actions, recent cases."""

import re
from datetime import date
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect

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
        assert react_page.get_by_text("Courts / Tribunals", exact=True).is_visible()

    def test_case_categories_card(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Case Categories", exact=True).first.is_visible()

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
        """The former download quick action now opens the merged Data Tools."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        main = react_page.locator("main")
        btn = main.get_by_role("button", name="Data Tools", exact=True)
        btn.click()
        expect(react_page).to_have_url(re.compile(r"/data-tools$"))
        expect(react_page.get_by_role("heading", name="Data Tools", exact=True)).to_be_visible()

    def test_pipeline_action(self, react_page):
        """The dashboard's current analytics quick action navigates correctly."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        main = react_page.locator("main")
        btn = main.get_by_role("button", name="Analytics", exact=True)
        btn.click()
        expect(react_page).to_have_url(re.compile(r"/analytics\?"))
        scope = parse_qs(urlsplit(react_page.url).query)
        assert scope["year_from"] == ["2000"]
        assert scope["year_to"] == [str(date.today().year)]
        expect(react_page.get_by_role("heading", name="Analytics", exact=True)).to_be_visible()

    def test_export_csv_action(self, react_page):
        """CSV export lives on the cases selection toolbar; verify a real download."""
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        react_page.locator("tbody input[type='checkbox']").first.check()
        btn = react_page.get_by_test_id("cases-batch-bar").get_by_role("button", name="Export CSV", exact=True)
        with react_page.expect_download() as downloaded:
            btn.click()
        download = downloaded.value
        assert download.failure() is None
        assert download.suggested_filename.endswith(".csv")
        content = download.path().read_text(encoding="utf-8")
        assert "citation,title,court_code" in content
        assert "Minister for Immigration" in content

    def test_export_json_action(self, react_page):
        """The retained JSON download endpoint returns the actual seed data."""
        response = react_page.request.get("/api/v1/export/json")
        assert response.ok
        assert "attachment" in response.headers.get("content-disposition", "")
        data = response.json()
        cases = data if isinstance(data, list) else data.get("cases", [])
        assert len(cases) >= 10
        assert any("Minister for Immigration" in case["title"] for case in cases)

    def test_guided_search_action(self, react_page):
        react_navigate(react_page, "/")
        react_page.locator("main").get_by_role("button", name="Guided Search", exact=True).click()
        expect(react_page).to_have_url(re.compile(r"/guided-search$"))
        expect(react_page.get_by_role("heading", name="Guided Search", exact=True)).to_be_visible()


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
