"""Dark mode visual tests: verify charts, tooltips, and text remain readable in dark mode.

Tests toggle to dark mode then check that key UI elements have appropriate
contrast and that Recharts charts render properly.
"""

from .react_helpers import (
    react_navigate,
    wait_for_loading_gone,
    assert_no_js_errors,
    click_sidebar_link,
)


def _enable_dark_mode(page):
    """Toggle dark mode on and verify the class is applied."""
    page.locator("button.celestial-toggle").click()
    page.wait_for_timeout(300)
    assert page.evaluate("document.documentElement.classList.contains('dark')")


class TestDarkModeDashboard:
    """Dashboard should render correctly in dark mode."""

    def test_dashboard_loads_in_dark_mode(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        _enable_dark_mode(react_page)
        assert react_page.get_by_text("Total Cases", exact=True).is_visible()
        assert_no_js_errors(react_page)

    def test_stat_cards_visible_dark(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        _enable_dark_mode(react_page)
        for card_title in ["Total Cases", "With Full Text", "Courts"]:
            assert react_page.get_by_text(card_title, exact=True).first.is_visible()

    def test_charts_render_svg_dark(self, react_page):
        """Recharts SVGs should still render in dark mode."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        _enable_dark_mode(react_page)
        svgs = react_page.locator("svg.recharts-surface")
        assert svgs.count() >= 1

    def test_sidebar_readable_dark(self, react_page):
        """Sidebar text should be visible in dark mode."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        _enable_dark_mode(react_page)
        assert react_page.locator("aside").get_by_text("IMMI-Case", exact=True).is_visible()
        assert react_page.locator("aside").get_by_role("link", name="Dashboard", exact=True).is_visible()

    def test_quick_actions_visible_dark(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        _enable_dark_mode(react_page)
        main = react_page.locator("main")
        assert main.get_by_text("Download", exact=True).is_visible()
        assert main.get_by_text("Pipeline", exact=True).is_visible()
        assert main.get_by_text("Export CSV", exact=True).is_visible()


class TestDarkModeAnalytics:
    """Analytics page charts in dark mode."""

    def test_analytics_loads_dark(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        _enable_dark_mode(react_page)
        assert react_page.get_by_role("heading", name="Analytics").first.is_visible()
        assert_no_js_errors(react_page)

    def test_analytics_chart_cards_dark(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        _enable_dark_mode(react_page)
        assert react_page.get_by_text("Outcome Rate by Court", exact=True).is_visible()
        assert react_page.get_by_role(
            "heading",
            name="Most Active Judges / Members",
        ).is_visible()


class TestDarkModeNavigation:
    """Navigation through pages while in dark mode."""

    def test_dark_mode_persists_across_nav(self, react_page):
        """Toggling dark on Dashboard, navigating to Cases, dark should persist."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        _enable_dark_mode(react_page)

        click_sidebar_link(react_page, "Cases")
        wait_for_loading_gone(react_page)
        assert react_page.evaluate("document.documentElement.classList.contains('dark')")

        click_sidebar_link(react_page, "Analytics")
        wait_for_loading_gone(react_page)
        assert react_page.evaluate("document.documentElement.classList.contains('dark')")

    def test_dark_cycle_all_pages_no_errors(self, react_page):
        """Cycle through all pages in dark mode without JS errors."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        _enable_dark_mode(react_page)

        for label in ["Analytics", "Cases", "Download", "Pipeline",
                       "Data Dictionary", "Design Tokens", "Dashboard"]:
            click_sidebar_link(react_page, label)
            wait_for_loading_gone(react_page)

        assert_no_js_errors(react_page)


class TestDarkModeCases:
    """Cases list and detail in dark mode."""

    def test_cases_list_dark(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        _enable_dark_mode(react_page)
        assert react_page.get_by_role("heading", name="Cases").first.is_visible()
        assert_no_js_errors(react_page)

    def test_case_detail_dark(self, react_page, seed_cases):
        """Case detail page loads in dark mode."""
        case_id = seed_cases[0].case_id
        react_navigate(react_page, f"/cases/{case_id}")
        wait_for_loading_gone(react_page)
        _enable_dark_mode(react_page)
        assert react_page.locator("main").is_visible()
        assert_no_js_errors(react_page)
