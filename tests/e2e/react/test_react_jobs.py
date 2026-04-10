"""Job-related page tests: Download, JobStatus, Pipeline."""

from .react_helpers import (
    react_navigate,
    wait_for_loading_gone,
)


class TestDownloadPage:
    """Download page: full text download form and export buttons."""

    def test_heading(self, react_page):
        react_navigate(react_page, "/download")
        wait_for_loading_gone(react_page)
        assert "Download" in react_page.locator("h1").inner_text()

    def test_download_full_text_section(self, react_page):
        react_navigate(react_page, "/download")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Download Full Text", exact=True).is_visible()

    def test_start_download_button(self, react_page):
        react_navigate(react_page, "/download")
        wait_for_loading_gone(react_page)
        btn = react_page.get_by_role("button", name="Start Download")
        assert btn.is_visible()

    def test_export_data_section(self, react_page):
        react_navigate(react_page, "/download")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Export Data", exact=True).is_visible()

    def test_export_csv_button(self, react_page):
        react_navigate(react_page, "/download")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_role("button", name="Export CSV").is_visible()

    def test_export_json_button(self, react_page):
        react_navigate(react_page, "/download")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_role("button", name="Export JSON").is_visible()


class TestJobStatusPage:
    """Job Status monitoring page."""

    def test_heading(self, react_page):
        react_navigate(react_page, "/jobs")
        wait_for_loading_gone(react_page)
        assert "Job Status" in react_page.locator("h1").inner_text()

    def test_shows_idle_state(self, react_page):
        """With no running job, should show some status indication."""
        react_navigate(react_page, "/jobs")
        wait_for_loading_gone(react_page)
        # The page should render with content when no job is running
        main = react_page.locator("main")
        assert main.is_visible()
        text = main.inner_text()
        assert len(text) > 10  # Should have meaningful content


class TestPipelinePage:
    """Smart Pipeline page."""

    def test_heading(self, react_page):
        react_navigate(react_page, "/pipeline")
        wait_for_loading_gone(react_page)
        heading = react_page.locator("h1").inner_text()
        assert "Pipeline" in heading

    def test_quick_presets_section(self, react_page):
        react_navigate(react_page, "/pipeline")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_role("heading", name="Quick Update").is_visible()

    def test_quick_update_button(self, react_page):
        react_navigate(react_page, "/pipeline")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_role("button", name="Quick Update").first.is_visible()

    def test_log_viewer(self, react_page):
        react_navigate(react_page, "/pipeline")
        wait_for_loading_gone(react_page)
        # Use h2 scope to avoid matching "No logs yet."
        assert react_page.locator("h2").filter(has_text="Logs").is_visible()

    def test_log_toggle(self, react_page):
        react_navigate(react_page, "/pipeline")
        wait_for_loading_gone(react_page)
        # Click the logs section header to collapse
        react_page.get_by_role("button", name="Collapse").click()
        react_page.wait_for_timeout(300)
        assert react_page.get_by_role("button", name="Expand").is_visible()
        # Click again to expand
        react_page.get_by_role("button", name="Expand").click()
        react_page.wait_for_timeout(300)
        assert react_page.get_by_role("button", name="Collapse").is_visible()

    def test_pipeline_shows_idle_status(self, react_page):
        react_navigate(react_page, "/pipeline")
        wait_for_loading_gone(react_page)
        assert react_page.get_by_text("Idle", exact=True).is_visible()
