"""E2E tests for judge intelligence pages."""

from .react_helpers import react_navigate, wait_for_loading_gone, assert_no_js_errors


def _filter_leaderboard(page, query="Judge"):
    search_input = page.locator("input[aria-keyshortcuts='/']").first
    search_input.fill(query)
    page.wait_for_timeout(700)
    wait_for_loading_gone(page)


class TestJudgeProfilesPage:
    def test_page_loads_with_heading(self, react_page):
        react_navigate(react_page, "/judge-profiles")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_role("heading", name="Judge Profiles").is_visible()

    def test_leaderboard_shows_judges(self, react_page):
        react_navigate(react_page, "/judge-profiles")
        wait_for_loading_gone(react_page)
        _filter_leaderboard(react_page)
        rows = react_page.locator("tbody tr")
        assert rows.count() > 0

    def test_sort_by_approval_rate(self, react_page):
        react_navigate(react_page, "/judge-profiles")
        wait_for_loading_gone(react_page)

        react_page.locator("select").last.select_option("approval_rate")
        _filter_leaderboard(react_page)

        rate_cells = react_page.locator("tbody tr td:nth-child(4) .text-xs")
        if rate_cells.count() >= 2:
            first_rate = float(rate_cells.nth(0).inner_text().replace("%", "").strip())
            second_rate = float(rate_cells.nth(1).inner_text().replace("%", "").strip())
            assert first_rate >= second_rate

    def test_click_judge_opens_profile(self, react_page):
        react_navigate(react_page, "/judge-profiles")
        wait_for_loading_gone(react_page)
        _filter_leaderboard(react_page)

        first_row = react_page.locator("tbody tr").first
        first_row.click()
        react_page.wait_for_load_state("networkidle")

        assert "/judge-profiles/" in react_page.url

    def test_profile_shows_outcome_chart(self, react_page):
        react_navigate(react_page, "/judge-profiles/Senior%20Member%20Jones")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_role("heading", name="Outcome Distribution").is_visible()

    def test_profile_no_js_errors(self, react_page):
        react_navigate(react_page, "/judge-profiles")
        wait_for_loading_gone(react_page)
        _filter_leaderboard(react_page)
        react_page.locator("tbody tr").first.click()
        react_page.wait_for_load_state("networkidle")

        assert_no_js_errors(react_page)

    def test_profile_shows_error_state_on_api_failure(self, react_page):
        react_page.route(
            "**/api/v1/analytics/judge-profile**",
            lambda route: route.fulfill(
                status=500,
                content_type="application/json",
                body='{"error":"forced test failure"}',
            ),
        )
        react_navigate(react_page, "/judge-profiles/Senior%20Member%20Jones")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Judge profile failed to load", exact=True).is_visible()

    def test_sidebar_nav_link_exists(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        assert react_page.locator("aside").get_by_role("link", name="Judge Profiles", exact=True).is_visible()

    def test_slash_focuses_judge_search(self, react_page):
        react_navigate(react_page, "/judge-profiles")
        wait_for_loading_gone(react_page)
        react_page.locator("h1").first.click()
        react_page.keyboard.press("/")
        react_page.wait_for_timeout(200)
        shortcut_attr = react_page.evaluate(
            "() => document.activeElement?.getAttribute('aria-keyshortcuts')"
        )
        assert shortcut_attr == "/"

    def test_table_row_enter_opens_profile(self, react_page):
        react_navigate(react_page, "/judge-profiles")
        wait_for_loading_gone(react_page)
        _filter_leaderboard(react_page)
        first_row = react_page.locator("tbody tr").first
        first_row.focus()
        react_page.keyboard.press("Enter")
        react_page.wait_for_load_state("networkidle")
        assert "/judge-profiles/" in react_page.url
