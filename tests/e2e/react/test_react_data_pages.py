"""Data Dictionary and Design Tokens page tests."""

from .react_helpers import (
    react_navigate,
    wait_for_loading_gone,
)


class TestDataDictionaryPage:
    """Data Dictionary page: grouped tables of field definitions."""

    def test_heading(self, react_page):
        react_navigate(react_page, "/data-dictionary")
        wait_for_loading_gone(react_page)
        assert "Data Dictionary" in react_page.locator("h1").inner_text()

    def test_table_has_columns(self, react_page):
        react_navigate(react_page, "/data-dictionary")
        wait_for_loading_gone(react_page)
        # 5 group tables share the same headers; check first occurrence
        for col in ["Field", "Type", "Description", "Example"]:
            assert react_page.locator("th").get_by_text(col, exact=True).first.is_visible()

    def test_table_has_fields(self, react_page):
        react_navigate(react_page, "/data-dictionary")
        wait_for_loading_gone(react_page)
        rows = react_page.locator("tbody tr")
        assert rows.count() >= 20  # 22 fields (incl. visa_subclass, visa_class_code)

    def test_case_id_field_present(self, react_page):
        react_navigate(react_page, "/data-dictionary")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("case_id", exact=True).is_visible()

    def test_citation_field_present(self, react_page):
        react_navigate(react_page, "/data-dictionary")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("citation", exact=True).first.is_visible()


class TestDesignTokensPage:
    """Design Tokens page: color palette, typography, spacing, badges."""

    def test_heading(self, react_page):
        react_navigate(react_page, "/design-tokens")
        wait_for_loading_gone(react_page)
        assert "Design Tokens" in react_page.locator("h1").inner_text()

    def test_color_palette_section(self, react_page):
        react_navigate(react_page, "/design-tokens")
        wait_for_loading_gone(react_page)
        assert react_page.locator("#colors").is_visible()

    def test_typography_section(self, react_page):
        react_navigate(react_page, "/design-tokens")
        wait_for_loading_gone(react_page)
        assert react_page.locator("#typography").is_visible()

    def test_spacing_section(self, react_page):
        react_navigate(react_page, "/design-tokens")
        wait_for_loading_gone(react_page)
        assert react_page.locator("#spacing").is_visible()

    def test_court_badges_section(self, react_page):
        react_navigate(react_page, "/design-tokens")
        wait_for_loading_gone(react_page)
        # Court Badges appear inside Component Gallery; check for any court badge
        assert react_page.get_by_text("AATA", exact=True).first.is_visible()

    def test_outcome_badges_section(self, react_page):
        react_navigate(react_page, "/design-tokens")
        wait_for_loading_gone(react_page)
        # Outcome badges render inside the Component Gallery section
        assert react_page.get_by_text("Affirmed", exact=True).first.is_visible()

    def test_usage_guide_section(self, react_page):
        react_navigate(react_page, "/design-tokens")
        wait_for_loading_gone(react_page)
        assert react_page.locator("#usage").is_visible()

    def test_component_gallery_section(self, react_page):
        react_navigate(react_page, "/design-tokens")
        wait_for_loading_gone(react_page)
        assert react_page.locator("#components").is_visible()
