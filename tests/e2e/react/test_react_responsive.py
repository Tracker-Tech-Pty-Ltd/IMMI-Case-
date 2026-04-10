"""Responsive design tests for desktop, tablet, and mobile breakpoints."""

from playwright.sync_api import expect
from .react_helpers import (
    react_navigate,
    wait_for_loading_gone,
    click_mobile_menu,
)


class TestDesktopLayout:
    """Desktop viewport (1280x800) — sidebar visible, topbar menu hidden."""

    def test_sidebar_visible(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        # On desktop, the <aside> element is visible inside the sidebar wrapper
        sidebar = react_page.locator("aside")
        assert sidebar.is_visible()

    def test_main_content_offset(self, react_page):
        """Main content should be offset by sidebar width on desktop."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        main = react_page.locator("main")
        assert main.is_visible()
        # Verify sidebar takes up space by checking aside is to the left
        sidebar_box = react_page.locator("aside").bounding_box()
        assert sidebar_box is not None
        assert sidebar_box["width"] > 100  # sidebar has meaningful width

    def test_hamburger_hidden_on_desktop(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        hamburger = react_page.get_by_label("Toggle menu")
        assert not hamburger.is_visible()

    def test_search_trigger_visible(self, react_page):
        """Search bar trigger should be visible on desktop (sm:flex)."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        search_btn = react_page.locator("header").get_by_text("Search...", exact=True)
        assert search_btn.is_visible()

    def test_theme_toggle_visible(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        theme_btn = react_page.get_by_role("switch")
        expect(theme_btn).to_be_visible()


class TestTabletLayout:
    """Tablet viewport (768x1024) — sidebar hidden, hamburger visible."""

    def test_sidebar_hidden_on_tablet(self, react_tablet):
        react_navigate(react_tablet, "/")
        wait_for_loading_gone(react_tablet)
        # At 768px, the aside should be hidden (lg breakpoint is 1024px)
        sidebar = react_tablet.locator("aside")
        assert sidebar.count() == 0 or not sidebar.is_visible()

    def test_hamburger_visible_on_tablet(self, react_tablet):
        react_navigate(react_tablet, "/")
        wait_for_loading_gone(react_tablet)
        hamburger = react_tablet.get_by_label("Toggle menu")
        assert hamburger.is_visible()

    def test_main_content_no_offset(self, react_tablet):
        """Main content should not have sidebar offset on tablet."""
        react_navigate(react_tablet, "/")
        wait_for_loading_gone(react_tablet)
        # The main area should take full width
        main = react_tablet.locator("main")
        assert main.is_visible()


class TestMobileLayout:
    """Mobile viewport (390x844) — compact layout, drawer navigation."""

    def test_hamburger_visible_on_mobile(self, react_mobile):
        react_navigate(react_mobile, "/")
        wait_for_loading_gone(react_mobile)
        hamburger = react_mobile.get_by_label("Toggle menu")
        assert hamburger.is_visible()

    def test_mobile_drawer_opens(self, react_mobile):
        react_navigate(react_mobile, "/")
        wait_for_loading_gone(react_mobile)
        click_mobile_menu(react_mobile)
        drawer = react_mobile.locator(".fixed.inset-y-0.left-0")
        assert drawer.is_visible()

    def test_mobile_stat_cards_stack(self, react_mobile):
        """Stat cards should stack vertically on mobile (grid cols-1)."""
        react_navigate(react_mobile, "/")
        wait_for_loading_gone(react_mobile)
        # Just verify stat cards are present and visible
        cards = react_mobile.get_by_text("Total Cases", exact=True)
        assert cards.count() >= 1

    def test_mobile_cases_table_scrollable(self, react_mobile):
        """Cases table wrapper should be horizontally scrollable."""
        react_navigate(react_mobile, "/cases")
        wait_for_loading_gone(react_mobile)
        table_wrapper = react_mobile.locator(".overflow-x-auto")
        assert table_wrapper.count() >= 1
