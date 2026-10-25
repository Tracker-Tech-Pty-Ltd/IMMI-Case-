"""Legacy job routes redirect to Data Tools; retained data/export controls work.

The historical test identifiers remain stable, but the expected surface is the
read-only Data Tools dashboard. No test starts a real download or pipeline.
"""

import re

from playwright.sync_api import expect

from .react_helpers import (
    react_navigate,
    wait_for_loading_gone,
)


class TestDownloadPage:
    """The former Download route exposes database coverage via Data Tools."""

    def test_heading(self, react_page):
        react_navigate(react_page, "/download")
        wait_for_loading_gone(react_page)
        expect(react_page).to_have_url(re.compile(r"/data-tools$"))
        expect(react_page.get_by_role("heading", name="Data Tools", exact=True)).to_be_visible()

    def test_download_full_text_section(self, react_page):
        react_navigate(react_page, "/download")
        wait_for_loading_gone(react_page)
        expect(react_page.get_by_role("heading", name="Database snapshot", exact=True)).to_be_visible()
        expect(react_page.get_by_text("With Full Text", exact=True)).to_be_visible()
        expect(react_page.get_by_text("Remaining", exact=True)).to_be_visible()

    def test_start_download_button(self, react_page):
        """The public monitoring page must not expose the retired start action."""
        react_navigate(react_page, "/download")
        wait_for_loading_gone(react_page)
        expect(react_page.get_by_role("heading", name="Pipeline activity", exact=True)).to_be_visible()
        expect(react_page.get_by_role("button", name="Start Download", exact=True)).to_have_count(0)
        expect(react_page.get_by_text("Pipeline is idle", exact=True)).to_be_visible()

    def test_export_data_section(self, react_page):
        react_navigate(react_page, "/download")
        wait_for_loading_gone(react_page)
        expect(react_page.get_by_role("heading", name="Database snapshot", exact=True)).to_be_visible()
        expect(react_page.get_by_role("heading", name="Most recent job", exact=True)).to_be_visible()

    def test_export_csv_button(self, react_page):
        """The retained cases toolbar offers CSV export after selection."""
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        react_page.locator("tbody input[type='checkbox']").first.check()
        expect(react_page.get_by_test_id("cases-batch-bar").get_by_role("button", name="Export CSV")).to_be_visible()

    def test_export_json_button(self, react_page):
        """JSON export remains available as a download endpoint."""
        response = react_page.request.get("/api/v1/export/json")
        assert response.ok
        assert "attachment" in response.headers.get("content-disposition", "")
        data = response.json()
        assert len(data if isinstance(data, list) else data["cases"]) >= 10


class TestJobStatusPage:
    """Job Status monitoring page."""

    def test_heading(self, react_page):
        react_navigate(react_page, "/jobs")
        wait_for_loading_gone(react_page)
        expect(react_page).to_have_url(re.compile(r"/data-tools$"))
        expect(react_page.get_by_role("heading", name="Most recent job", exact=True)).to_be_visible()

    def test_shows_idle_state(self, react_page):
        """With no running job, show the explicit empty-job state."""
        react_navigate(react_page, "/jobs")
        wait_for_loading_gone(react_page)
        expect(react_page.get_by_text("No recent jobs", exact=True)).to_be_visible()


class TestPipelinePage:
    """The former Pipeline route retains monitoring and log expansion."""

    def test_heading(self, react_page):
        react_navigate(react_page, "/pipeline")
        wait_for_loading_gone(react_page)
        expect(react_page).to_have_url(re.compile(r"/data-tools$"))
        expect(react_page.get_by_role("heading", name="Data Tools", exact=True)).to_be_visible()

    def test_quick_presets_section(self, react_page):
        react_navigate(react_page, "/pipeline")
        wait_for_loading_gone(react_page)
        expect(react_page.get_by_role("heading", name="Pipeline activity", exact=True)).to_be_visible()
        expect(react_page.get_by_text("Pipeline is idle", exact=True)).to_be_visible()

    def test_quick_update_button(self, react_page):
        """Public status reads are available without a pipeline start control."""
        with react_page.expect_response(lambda response: "/api/v1/pipeline-status" in response.url) as status:
            react_navigate(react_page, "/pipeline")
        assert status.value.ok
        assert status.value.json()["running"] is False
        expect(react_page.get_by_role("button", name="Quick Update", exact=True)).to_have_count(0)

    def test_log_viewer(self, react_page):
        react_navigate(react_page, "/pipeline")
        wait_for_loading_gone(react_page)
        # Use h2 scope to avoid matching "No logs yet."
        assert react_page.locator("h2").filter(has_text="Logs").is_visible()

    def test_log_toggle(self, react_page):
        react_navigate(react_page, "/pipeline")
        wait_for_loading_gone(react_page)
        toggle = react_page.locator('button[aria-controls="pipeline-logs-panel"]')
        panel = react_page.locator("#pipeline-logs-panel")
        expect(toggle).to_have_attribute("aria-expanded", "true")
        expect(panel).to_be_visible()
        toggle.click()
        expect(toggle).to_have_attribute("aria-expanded", "false")
        expect(panel).not_to_be_visible()
        toggle.click()
        expect(toggle).to_have_attribute("aria-expanded", "true")
        expect(panel).to_be_visible()

    def test_pipeline_shows_idle_status(self, react_page):
        react_navigate(react_page, "/pipeline")
        wait_for_loading_gone(react_page)
        expect(react_page.get_by_text("Pipeline is idle", exact=True)).to_be_visible()
