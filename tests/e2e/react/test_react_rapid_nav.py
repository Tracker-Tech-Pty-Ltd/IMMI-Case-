"""Rapid navigation stability tests: quickly switching between all pages.

Verifies that rapid sidebar clicking does not cause:
- Empty states to flash (the "Welcome to IMMI-Case" issue)
- JavaScript errors
- Broken layouts
- Stale data display
"""

import pytest

from .react_helpers import (
    SIDEBAR_NAV_ITEMS,
    react_navigate,
    wait_for_loading_gone,
    assert_no_js_errors,
    click_sidebar_link,
)


class TestRapidNavigation:
    """Quickly clicking through all sidebar items should not break the app."""

    def test_rapid_cycle_all_pages(self, react_page):
        """Click through every sidebar link rapidly, then verify final page is stable."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)

        for label, _ in SIDEBAR_NAV_ITEMS:
            click_sidebar_link(react_page, label)

        # After cycling, we should be on the last page (Design Tokens)
        wait_for_loading_gone(react_page)
        assert react_page.locator("#root").is_visible()
        assert_no_js_errors(react_page)

    def test_rapid_back_to_dashboard(self, react_page):
        """Navigate away from Dashboard and back quickly — should show data, not empty state."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)

        # Verify data is loaded initially
        assert react_page.get_by_text("Total Cases", exact=True).is_visible()

        # Navigate away
        click_sidebar_link(react_page, "Cases")
        # Immediately go back
        click_sidebar_link(react_page, "Dashboard")
        wait_for_loading_gone(react_page)

        # Dashboard should show stat cards, NOT the "Welcome" empty state
        assert react_page.get_by_text("Total Cases", exact=True).is_visible()
        welcome = react_page.get_by_text("Welcome to IMMI-Case", exact=True)
        assert welcome.count() == 0 or not welcome.is_visible()

    def test_rapid_cycle_no_welcome_flash(self, react_page):
        """Rapidly navigate all pages and return to Dashboard — no empty state."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)

        # Quick cycle through all pages
        for label, _ in SIDEBAR_NAV_ITEMS:
            click_sidebar_link(react_page, label)
            # Minimal wait — just enough for click to register
            react_page.wait_for_timeout(100)

        # Return to Dashboard
        click_sidebar_link(react_page, "Dashboard")
        wait_for_loading_gone(react_page)

        # Must show real data, not the welcome screen
        assert react_page.get_by_text("Total Cases", exact=True).is_visible()
        assert_no_js_errors(react_page)

    @pytest.mark.parametrize(
        "label,expected_path",
        SIDEBAR_NAV_ITEMS,
        ids=[item[0] for item in SIDEBAR_NAV_ITEMS],
    )
    def test_navigate_twice_to_same_page(self, react_page, label, expected_path):  # noqa: ARG002  # pyright: ignore[reportUnusedParameter]
        """Clicking the same sidebar link twice should not cause errors."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        click_sidebar_link(react_page, label)
        click_sidebar_link(react_page, label)
        wait_for_loading_gone(react_page)
        assert react_page.locator("#root").is_visible()
        assert_no_js_errors(react_page)


class TestDashboardFilterStability:
    """Dashboard filter interactions should not cause empty state or errors."""

    def test_court_filter_keeps_data(self, react_page):
        """Clicking a court filter pill should show filtered data, not empty state."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Total Cases", exact=True).is_visible()

        # Click a court filter
        fca_btn = react_page.get_by_text("FCA", exact=True).first
        if fca_btn.is_visible():
            fca_btn.click()
            react_page.wait_for_timeout(1000)
            # Should still show stat cards (possibly with lower numbers)
            assert react_page.get_by_text("Total Cases", exact=True).is_visible()
            welcome = react_page.get_by_text("Welcome to IMMI-Case", exact=True)
            assert welcome.count() == 0 or not welcome.is_visible()

    def test_time_preset_keeps_data(self, react_page):
        """Clicking time presets should update charts without showing empty state."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)

        last5 = react_page.get_by_text("Last 5y", exact=True)
        if last5.is_visible():
            last5.click()
            react_page.wait_for_timeout(1000)
            assert react_page.get_by_text("Total Cases", exact=True).is_visible()

    def test_all_time_preset_shows_all_data(self, react_page):
        """All Time preset should show the full dataset."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)

        all_time = react_page.get_by_text("All Time", exact=True)
        if all_time.is_visible():
            all_time.click()
            react_page.wait_for_timeout(1000)
            assert react_page.get_by_text("Total Cases", exact=True).is_visible()
            assert_no_js_errors(react_page)
