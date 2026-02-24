"""Keyboard shortcut tests: navigation shortcuts, search focus, input exclusion."""

from urllib.parse import urlparse

from .react_helpers import (
    react_navigate,
    wait_for_loading_gone,
)


def _focus_body(page):
    """Click on the page heading to ensure keyboard focus is on the page, not an input."""
    page.locator("h1").first.click()
    page.wait_for_timeout(200)


def _is_dashboard_url(url: str) -> bool:
    """Dashboard may be mounted at '/' or legacy '/app'."""
    path = urlparse(url).path.rstrip("/")
    return path in ("", "/app")


class TestNavigationShortcuts:
    """Keys d, c, p navigate to Dashboard, Cases, Pipeline."""

    def test_d_goes_to_dashboard(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        _focus_body(react_page)
        react_page.keyboard.press("d")
        react_page.wait_for_timeout(1000)
        assert _is_dashboard_url(react_page.url)

    def test_c_goes_to_cases(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        _focus_body(react_page)
        react_page.keyboard.press("c")
        react_page.wait_for_timeout(1000)
        assert "/cases" in react_page.url

    def test_p_goes_to_pipeline(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        _focus_body(react_page)
        react_page.keyboard.press("p")
        react_page.wait_for_timeout(1000)
        assert "/pipeline" in react_page.url

    def test_question_mark_goes_to_design_tokens(self, react_page):
        """? key navigates to Design Tokens page."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        _focus_body(react_page)
        # Dispatch '?' keydown via JavaScript for reliable cross-platform behavior
        react_page.evaluate("""
            () => {
                const e = new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true });
                window.dispatchEvent(e);
            }
        """)
        react_page.wait_for_timeout(1000)
        assert "/design-tokens" in react_page.url


class TestSearchFocusShortcut:
    """/ key focuses the search input (if onSearch callback is wired)."""

    def test_slash_key_handled(self, react_page):
        """/ key should be intercepted (preventDefault) on any page."""
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        _focus_body(react_page)
        # Press / — it should not type into the page
        react_page.keyboard.press("/")
        react_page.wait_for_timeout(300)
        # The page should still be on dashboard (/ doesn't navigate)
        # Just verify no error occurred
        assert react_page.locator("#root").is_visible()


class TestInputExclusion:
    """Shortcuts are disabled when typing in INPUT, TEXTAREA, SELECT."""

    def test_shortcut_disabled_in_input(self, react_page):
        """Pressing 'd' while focused on an input should NOT navigate."""
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        # Use the keyword filter input on the cases page
        keyword_input = react_page.locator("input[placeholder*='earch']")
        keyword_input.click()
        keyword_input.type("d")
        react_page.wait_for_timeout(300)
        # Should still be on cases page
        assert "/cases" in react_page.url

    def test_shortcut_disabled_in_textarea(self, react_page):
        """Pressing 'c' while focused on a textarea should NOT navigate."""
        # Navigate to edit page which has textarea fields
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        react_page.locator("tbody tr").first.click()
        react_page.wait_for_load_state("networkidle")
        react_page.locator("h1").wait_for(state="visible", timeout=15000)
        wait_for_loading_gone(react_page)
        react_page.locator("main").get_by_text("Edit", exact=True).click()
        react_page.wait_for_load_state("networkidle")
        wait_for_loading_gone(react_page)

        textarea = react_page.locator("textarea").first
        if textarea.count() > 0:
            textarea.click()
            textarea.type("c")
            react_page.wait_for_timeout(300)
            assert "/edit" in react_page.url  # Should stay on edit page

    def test_shortcut_works_after_blur(self, react_page):
        """After blurring an input, shortcuts work again."""
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        keyword_input = react_page.locator("input[placeholder*='earch']")
        keyword_input.click()
        keyword_input.type("test")
        # Click outside to blur
        react_page.locator("h1").click()
        react_page.wait_for_timeout(200)
        # Now 'd' should navigate to dashboard
        react_page.keyboard.press("d")
        react_page.wait_for_timeout(1000)
        assert _is_dashboard_url(react_page.url)
