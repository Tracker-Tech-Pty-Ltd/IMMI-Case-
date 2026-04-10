"""Navigation tests: sidebar links, mobile drawer, back buttons, URL routing."""

import pytest

from .react_helpers import (
    SIDEBAR_NAV_ITEMS,
    react_navigate,
    wait_for_loading_gone,
    click_sidebar_link,
    click_mobile_menu,
    close_mobile_menu,
)


class TestDesktopSidebar:
    """Desktop sidebar navigation (visible at lg breakpoint: 1280px)."""

    def test_sidebar_visible(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        sidebar = react_page.locator("aside")
        assert sidebar.is_visible()

    def test_sidebar_has_logo(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        assert react_page.locator("aside").get_by_text("IMMI-Case", exact=True).is_visible()

    @pytest.mark.parametrize(
        "label,expected_path",
        SIDEBAR_NAV_ITEMS,
        ids=[item[0] for item in SIDEBAR_NAV_ITEMS],
    )
    def test_sidebar_link_navigates(self, react_page, label, expected_path):
        """Clicking each sidebar link navigates to the correct route."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        click_sidebar_link(react_page, label)
        wait_for_loading_gone(react_page)
        # Normalise trailing slashes for comparison
        actual = react_page.url.rstrip("/")
        expected = expected_path.rstrip("/")
        assert actual.endswith(expected)

    def test_active_link_highlighted(self, react_page):
        """The current page link should have the active style."""
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        # NavLink classes are on the <a> element, not the inner <span>
        cases_link = react_page.locator("aside a").filter(has_text="Cases").first
        classes = cases_link.get_attribute("class") or ""
        assert "text-accent" in classes or "bg-accent" in classes

    def test_sidebar_footer_text(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        footer = react_page.locator("aside").get_by_text("Australian Immigration Case Database", exact=True)
        assert footer.is_visible()


class TestMobileDrawer:
    """Mobile navigation drawer (visible below lg breakpoint: 390px)."""

    def test_sidebar_hidden_on_mobile(self, react_mobile):
        react_navigate(react_mobile, "/")
        wait_for_loading_gone(react_mobile)
        # Desktop aside should be hidden (lg:block means hidden below lg)
        sidebar = react_mobile.locator("aside")
        assert sidebar.count() == 0 or not sidebar.is_visible()

    def test_hamburger_visible(self, react_mobile):
        react_navigate(react_mobile, "/")
        wait_for_loading_gone(react_mobile)
        hamburger = react_mobile.get_by_label("Toggle menu")
        assert hamburger.is_visible()

    def test_open_mobile_drawer(self, react_mobile):
        react_navigate(react_mobile, "/")
        wait_for_loading_gone(react_mobile)
        click_mobile_menu(react_mobile)
        # Scope to the mobile drawer to avoid matching desktop sidebar
        drawer = react_mobile.locator(".fixed.inset-y-0.left-0")
        assert drawer.get_by_text("IMMI-Case", exact=True).is_visible()

    def test_close_mobile_drawer(self, react_mobile):
        react_navigate(react_mobile, "/")
        wait_for_loading_gone(react_mobile)
        click_mobile_menu(react_mobile)
        close_mobile_menu(react_mobile)
        # Drawer should be gone
        drawer = react_mobile.locator(".fixed.inset-y-0.left-0")
        assert drawer.count() == 0 or not drawer.is_visible()

    def test_mobile_drawer_navigate(self, react_mobile):
        """Clicking a mobile nav link navigates and closes the drawer."""
        react_navigate(react_mobile, "/")
        wait_for_loading_gone(react_mobile)
        click_mobile_menu(react_mobile)
        # Click Cases link in mobile drawer
        drawer = react_mobile.locator(".fixed.inset-y-0.left-0")
        drawer.get_by_text("Cases", exact=True).click()
        react_mobile.wait_for_load_state("networkidle")
        wait_for_loading_gone(react_mobile)
        assert "/cases" in react_mobile.url

    def test_mobile_drawer_has_all_browse_links(self, react_mobile):
        """Mobile drawer should include all browse links available on desktop."""
        react_navigate(react_mobile, "/")
        wait_for_loading_gone(react_mobile)
        click_mobile_menu(react_mobile)
        drawer = react_mobile.locator(".fixed.inset-y-0.left-0")
        for label in [
            "Dashboard",
            "Analytics",
            "Judge Profiles",
            "Court Lineage",
            "Cases",
            "Collections",
            "Saved Searches",
        ]:
            assert drawer.get_by_text(label, exact=True).is_visible()


class TestBackNavigation:
    """Breadcrumb navigation in detail/add/edit pages (no Back button)."""

    def test_breadcrumb_from_add(self, react_page):
        """CaseAddPage shows a Breadcrumb with a 'Cases' link to go back."""
        react_navigate(react_page, "/cases/add")
        wait_for_loading_gone(react_page)
        breadcrumb = react_page.locator("main nav").filter(has_text="Cases")
        assert breadcrumb.is_visible()
        # "Cases" in the breadcrumb should be a link
        cases_link = breadcrumb.get_by_role("link", name="Cases", exact=True)
        assert cases_link.is_visible()
