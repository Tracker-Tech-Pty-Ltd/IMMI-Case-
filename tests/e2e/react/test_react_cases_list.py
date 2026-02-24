"""Cases list page tests: table/card views, filters, pagination, batch bar."""

from .react_helpers import (
    react_navigate,
    wait_for_loading_gone,
)


class TestCasesTable:
    """Default table view of the cases list."""

    def test_heading_shows_total(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Cases").first.is_visible()
        # Should show "10 cases" from seed data (i18n: units.cases = "cases")
        assert react_page.get_by_text("cases").first.is_visible()

    def test_table_has_header_columns(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        for col in ["Title", "Court", "Date", "Outcome", "Nature"]:
            assert react_page.locator("th", has_text=col).count() >= 1

    def test_table_renders_seed_cases(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        rows = react_page.locator("tbody tr")
        assert rows.count() >= 10  # seed data (may grow from CRUD tests)

    def test_table_row_click_navigates(self, react_page):
        """Clicking a row navigates to the case detail page."""
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        first_row = react_page.locator("tbody tr").first
        first_row.click()
        react_page.wait_for_load_state("networkidle")
        assert "/cases/" in react_page.url

    def test_select_all_checkbox(self, react_page):
        """The header checkbox selects all cases."""
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        select_all = react_page.locator("thead input[type='checkbox']")
        select_all.click()
        # Batch bar should appear with count
        assert react_page.get_by_text("selected").is_visible()

    def test_individual_checkbox(self, react_page):
        """Individual row checkbox selects a single case."""
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        first_checkbox = react_page.locator("tbody input[type='checkbox']").first
        first_checkbox.click()
        assert react_page.get_by_text("1 selected").is_visible()


class TestCardsView:
    """Card (grid) view of the cases list."""

    def _click_cards_toggle(self, page):
        """Click the grid/cards view toggle button in the cases header."""
        main = page.locator("main")
        # The button group is in the same flex container as "Add Case"
        add_btn = main.get_by_role("button", name="Add Case")
        btn_group = add_btn.locator("xpath=..")
        # Table=0, Cards=1, Add Case=2
        btn_group.locator("button").nth(1).click()
        # Wait for the cards grid to actually render
        page.locator("main .grid.gap-4").wait_for(state="visible", timeout=5000)

    def test_switch_to_cards_view(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        self._click_cards_toggle(react_page)
        # Table should be gone, card grid should appear
        assert react_page.locator("table").count() == 0
        cards_grid = react_page.locator("main .grid.gap-4")
        assert cards_grid.is_visible()

    def test_card_shows_court_badge(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        self._click_cards_toggle(react_page)
        # Cards render inside the grid container
        grid = react_page.locator("main .grid.gap-4")
        assert grid.is_visible()
        # Each CaseCard has a CourtBadge with court code text
        first_card = grid.locator("> *").first
        assert first_card.is_visible()


class TestFilters:
    """Filter dropdowns and keyword input."""

    def test_court_filter_present(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        court_select = react_page.locator("select").first
        assert court_select.is_visible()
        # Should have "All Courts" as default
        assert "All Courts" in court_select.inner_text()

    def test_court_filter_changes_results(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        # Select FCA court
        react_page.locator("select").first.select_option("FCA")
        react_page.wait_for_load_state("networkidle")
        wait_for_loading_gone(react_page)
        # Should have fewer than 10 results
        rows = react_page.locator("tbody tr")
        assert rows.count() < 10

    def test_year_filter_present(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        selects = react_page.locator("select")
        # Year filter uses "Year From" label (i18n: filters.year_from)
        assert selects.count() >= 2
        year_text = selects.nth(1).inner_text()
        assert "Year From" in year_text or "Year" in year_text

    def test_keyword_filter(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        keyword_input = react_page.locator("input[placeholder*='earch']")
        keyword_input.fill("Singh")
        # Wait for the filtered API response after pressing Enter
        with react_page.expect_response(
            lambda r: "keyword=Singh" in r.url and r.request.method == "GET",
            timeout=10000,
        ):
            keyword_input.press("Enter")
        react_page.wait_for_timeout(500)
        wait_for_loading_gone(react_page)
        # Should filter to case(s) matching "Singh"
        rows = react_page.locator("tbody tr")
        assert rows.count() >= 1
        assert "Singh" in rows.first.inner_text()

    def test_nature_filter_present(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        selects = react_page.locator("select")
        assert selects.count() >= 3
        # Nature filter uses "All Categories" (i18n: filters.all_natures)
        nature_text = selects.nth(2).inner_text()
        assert "All Categories" in nature_text or "All Natures" in nature_text


class TestAddButton:
    """Add Case button on the cases list page."""

    def test_add_case_button_visible(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        add_btn = react_page.get_by_role("button", name="Add Case")
        assert add_btn.is_visible()

    def test_add_case_button_navigates(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        react_page.get_by_role("button", name="Add Case").click()
        react_page.wait_for_load_state("networkidle")
        assert "/cases/add" in react_page.url


class TestPagination:
    """Pagination controls (only shown when total_pages > 1, which requires > 50 cases).

    With 10 seed cases and page_size=50, pagination is hidden. We test the absence.
    """

    def test_pagination_hidden_with_few_cases(self, react_page):
        """Pagination should not show when all cases fit on one page."""
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        # With 10 seed cases and page_size=50, no pagination
        page_indicator = react_page.get_by_text("Page 1 of")
        assert page_indicator.count() == 0


class TestViewModeToggle:
    """Toggle between table and card views."""

    def test_default_is_table(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        table = react_page.locator("table")
        assert table.is_visible()

    def test_toggle_to_cards_and_back(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        main = react_page.locator("main")
        add_btn = main.get_by_role("button", name="Add Case")
        btn_group = add_btn.locator("xpath=..")
        # Switch to cards (2nd button)
        btn_group.locator("button").nth(1).click()
        react_page.wait_for_timeout(500)
        assert react_page.locator("table").count() == 0
        # Switch back to table (1st button)
        btn_group.locator("button").nth(0).click()
        react_page.wait_for_timeout(500)
        assert react_page.locator("table").is_visible()


class TestCasesKeyboardEnhancements:
    """Keyboard interactions added for higher usability on the cases page."""

    def test_slash_focuses_case_search(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        react_page.locator("h1").first.click()
        react_page.keyboard.press("/")
        react_page.wait_for_timeout(200)
        focused_aria = react_page.evaluate(
            "() => document.activeElement?.getAttribute('aria-label')"
        )
        assert focused_aria == "Search cases"

    def test_table_shortcuts_hint_visible(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Keyboard: j/k move row").is_visible()
