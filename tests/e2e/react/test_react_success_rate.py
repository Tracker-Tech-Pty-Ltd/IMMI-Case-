"""E2E tests for Success Rate Calculator on Analytics page."""

from .react_helpers import react_navigate, wait_for_loading_gone, assert_no_js_errors


class TestSuccessRateCalculator:
    def test_calculator_section_visible_on_analytics(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_role("heading", name="Success Rate Calculator").is_visible()

    def test_calculator_shows_success_rate_number(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        rate = react_page.locator('[data-testid="success-rate-number"]').first
        assert rate.is_visible()
        assert "%" in rate.inner_text()

    def test_calculator_no_js_errors(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)
        assert_no_js_errors(react_page)

    def test_calculator_filter_changes_results(self, react_page):
        react_navigate(react_page, "/analytics")
        wait_for_loading_gone(react_page)

        root = react_page.locator('[data-testid="success-rate-calculator"]')
        initial = root.get_by_text("matching cases", exact=False).first.inner_text()

        selector = root.locator("select").nth(0)
        options = selector.locator("option")

        if options.count() < 2:
            selector = root.locator("select").nth(1)
            options = selector.locator("option")

        assert options.count() >= 2
        second_value = options.nth(1).get_attribute("value")
        selector.select_option(second_value)

        react_page.wait_for_timeout(700)
        updated = root.get_by_text("matching cases", exact=False).first.inner_text()
        assert updated != initial
