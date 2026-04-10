"""Batch operations tests: select-all, individual select, batch tag/delete, clear."""

from .react_helpers import (
    react_navigate,
    wait_for_loading_gone,
    get_toast_text,
    setup_dialog_handler,
)


class TestBatchSelection:
    """Selecting cases for batch operations."""

    @staticmethod
    def _visible_rows(page):
        return page.locator("[data-testid='cases-row']:visible")

    @classmethod
    def _visible_case_ids(cls, page, limit: int = 2):
        return page.evaluate(
            """(limit) => {
                const isVisible = (element) => {
                    const rects = element.getClientRects();
                    return Boolean(rects.length && (element.offsetWidth || element.offsetHeight));
                };

                return Array.from(document.querySelectorAll('[data-testid="cases-row"]'))
                    .filter(isVisible)
                    .slice(0, limit)
                    .map((row) => row.dataset.caseId);
            }""",
            limit,
        )

    @classmethod
    def _row_checkbox(cls, page, case_id: str):
        return page.locator(
            f"[data-testid='cases-row-checkbox'][data-case-id='{case_id}']",
        )

    @classmethod
    def _row_citation(cls, page, case_id: str):
        return page.locator(
            f"[data-testid='cases-row-citation'][data-case-id='{case_id}']",
        )

    @classmethod
    def _set_checkbox_state(cls, page, case_id: str, checked: bool):
        checkbox = cls._row_checkbox(page, case_id)
        if checkbox.is_checked() == checked:
            return checkbox

        checkbox.evaluate("(el) => el.click()")
        page.wait_for_function(
            """([targetCaseId, expected]) => {
                const checkbox = document.querySelector(
                    `[data-testid="cases-row-checkbox"][data-case-id="${targetCaseId}"]`,
                );
                return checkbox ? checkbox.checked === expected : false;
            }""",
            arg=[case_id, checked],
        )
        return checkbox

    @classmethod
    def _checked_checkboxes(cls, page):
        return page.locator("[data-testid='cases-row-checkbox']:checked")

    @classmethod
    def _select_first_visible_cases(cls, page, count: int = 2):
        case_ids = cls._visible_case_ids(page, count)
        assert len(case_ids) >= count
        for case_id in case_ids:
            cls._set_checkbox_state(page, case_id, True)
        return case_ids

    @classmethod
    def _select_first_visible_case(cls, page):
        case_id = cls._visible_case_ids(page, 1)[0]
        cls._set_checkbox_state(page, case_id, True)
        return case_id

    @classmethod
    def _checked_visible_checkboxes(cls, page):
        return page.locator(
            "[data-testid='cases-row-checkbox']:checked",
        )

    def test_select_all_shows_batch_bar(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        select_all = react_page.get_by_test_id("cases-select-all")
        select_all.click()
        batch_bar = react_page.get_by_test_id("cases-batch-bar")
        assert batch_bar.is_visible()
        checked = self._checked_visible_checkboxes(react_page)
        assert checked.count() == self._visible_rows(react_page).count()

    def test_individual_select_shows_count(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        self._select_first_visible_case(react_page)
        checked = self._checked_checkboxes(react_page)
        assert checked.count() == 1

    def test_select_multiple(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        self._select_first_visible_cases(react_page, 2)
        checked = self._checked_checkboxes(react_page)
        assert checked.count() == 2
        assert react_page.get_by_test_id("cases-compare-button").is_visible()

    def test_deselect_reduces_count(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        first_case_id, second_case_id = self._select_first_visible_cases(
            react_page,
            2,
        )
        first_cb = self._row_checkbox(react_page, first_case_id)
        second_cb = self._row_checkbox(react_page, second_case_id)
        checked = self._checked_checkboxes(react_page)
        assert checked.count() == 2
        self._set_checkbox_state(react_page, first_case_id, False)
        assert second_cb.is_checked()
        assert not first_cb.is_checked()
        assert checked.count() == 1

    def test_visible_rows_drive_batch_selection(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        first_case_id, second_case_id = self._visible_case_ids(react_page, 2)
        first_citation = self._row_citation(react_page, first_case_id).inner_text()
        second_citation = self._row_citation(react_page, second_case_id).inner_text()
        self._set_checkbox_state(react_page, first_case_id, True)
        self._set_checkbox_state(react_page, second_case_id, True)
        batch_bar = react_page.get_by_test_id("cases-batch-bar")
        assert batch_bar.is_visible()
        assert first_citation
        assert second_citation
        assert react_page.get_by_test_id("cases-compare-button").is_visible()


class TestBatchBar(TestBatchSelection):
    """Batch action bar: Tag, Delete, Clear buttons."""

    def test_batch_bar_has_tag_button(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        react_page.get_by_test_id("cases-select-all").click()
        assert react_page.get_by_text("Tags", exact=True).is_visible()

    def test_batch_bar_has_delete_button(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        react_page.get_by_test_id("cases-select-all").click()
        assert react_page.get_by_text("Delete", exact=True).is_visible()

    def test_clear_selection(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        react_page.get_by_test_id("cases-select-all").click()
        assert react_page.get_by_test_id("cases-batch-bar").is_visible()
        react_page.get_by_role("button", name="Clear").click()
        # Batch bar should disappear
        assert react_page.get_by_test_id("cases-batch-bar").count() == 0

    def test_batch_tag_with_prompt(self, react_page, skip_if_live):
        """Batch tag triggers a prompt dialog."""
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        self._select_first_visible_case(react_page)
        setup_dialog_handler(react_page, accept=True, prompt_text="e2e-batch-tag")
        react_page.get_by_text("Tags", exact=True).click()
        react_page.wait_for_load_state("networkidle")
        toast = get_toast_text(react_page)
        assert "updated" in toast.lower() or "cases updated" in toast.lower()

    def test_batch_tag_cancel(self, react_page):
        """Cancelling the tag prompt does nothing."""
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        self._select_first_visible_case(react_page)
        setup_dialog_handler(react_page, accept=False)
        react_page.get_by_text("Tags", exact=True).click()
        react_page.wait_for_timeout(500)
        # Selection should still be active
        checked = self._checked_checkboxes(react_page)
        assert checked.count() == 1
