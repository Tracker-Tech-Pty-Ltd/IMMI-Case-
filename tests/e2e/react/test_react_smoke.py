"""Smoke tests: verify all React SPA pages load and all API endpoints respond."""

import pytest
import requests

from .react_helpers import (
    SMOKE_PAGES,
    API_ENDPOINTS,
    react_navigate,
    assert_no_js_errors,
    get_heading,
    wait_for_loading_gone,
)


# ---------------------------------------------------------------------------
# Page smoke tests — parametrised over all React SPA pages
# ---------------------------------------------------------------------------


class TestPageSmoke:
    """Each React page loads without JS errors and renders expected content."""

    @pytest.mark.parametrize("name,path", SMOKE_PAGES, ids=[p[0] for p in SMOKE_PAGES])
    def test_page_loads(self, react_page, name, path):
        """Page returns 200 and React hydrates #root."""
        react_navigate(react_page, path)
        assert react_page.locator("#root").is_visible()

    @pytest.mark.parametrize("name,path", SMOKE_PAGES, ids=[p[0] for p in SMOKE_PAGES])
    def test_no_js_errors(self, react_page, name, path):
        """No JavaScript errors on any page."""
        react_navigate(react_page, path)
        wait_for_loading_gone(react_page)
        assert_no_js_errors(react_page)

    def test_dashboard_has_heading(self, react_page):
        react_navigate(react_page, "/")
        wait_for_loading_gone(react_page)
        assert "Dashboard" in get_heading(react_page)

    def test_cases_has_heading(self, react_page):
        react_navigate(react_page, "/cases")
        wait_for_loading_gone(react_page)
        assert "Cases" in get_heading(react_page)

    def test_download_has_heading(self, react_page):
        # /download now redirects to the merged /data-tools page
        # (frontend/src/App.tsx: <Navigate to="/data-tools" replace />).
        react_navigate(react_page, "/download")
        wait_for_loading_gone(react_page)
        assert "Data Tools" in get_heading(react_page)

    def test_pipeline_has_heading(self, react_page):
        # /pipeline now redirects to the merged /data-tools page
        # (frontend/src/App.tsx: <Navigate to="/data-tools" replace />).
        react_navigate(react_page, "/pipeline")
        wait_for_loading_gone(react_page)
        heading = get_heading(react_page)
        assert "Data Tools" in heading

    def test_data_dictionary_has_heading(self, react_page):
        react_navigate(react_page, "/data-dictionary")
        wait_for_loading_gone(react_page)
        assert "Data Dictionary" in get_heading(react_page)

    def test_design_tokens_has_heading(self, react_page):
        react_navigate(react_page, "/design-tokens")
        wait_for_loading_gone(react_page)
        assert "Design Tokens" in get_heading(react_page)

    def test_job_status_has_heading(self, react_page):
        # /jobs now redirects to the merged /data-tools page
        # (frontend/src/App.tsx: <Navigate to="/data-tools" replace />).
        react_navigate(react_page, "/jobs")
        wait_for_loading_gone(react_page)
        assert "Data Tools" in get_heading(react_page)


# ---------------------------------------------------------------------------
# API endpoint smoke tests
# ---------------------------------------------------------------------------


class TestAPISmoke:
    """All JSON API endpoints respond with 200 and valid JSON."""

    @pytest.mark.parametrize("endpoint", API_ENDPOINTS)
    def test_api_returns_200(self, base_url, endpoint):
        resp = requests.get(f"{base_url}{endpoint}", timeout=10)
        assert resp.status_code == 200, f"{endpoint} returned {resp.status_code}"

    @pytest.mark.parametrize("endpoint", API_ENDPOINTS)
    def test_api_returns_json(self, base_url, endpoint):
        resp = requests.get(f"{base_url}{endpoint}", timeout=10)
        data = resp.json()
        assert isinstance(data, (dict, list))

    def test_stats_has_total_cases(self, base_url):
        resp = requests.get(f"{base_url}/api/v1/stats", timeout=10)
        data = resp.json()
        assert "total_cases" in data
        assert data["total_cases"] >= 10  # seed data (may grow from CRUD tests)
        assert "courts" in data
        assert "recent_cases" in data

    def test_cases_returns_paginated(self, base_url):
        resp = requests.get(f"{base_url}/api/v1/cases", timeout=10)
        data = resp.json()
        assert "cases" in data
        assert "total" in data
        assert data["total"] >= 10

    def test_filter_options_has_courts(self, base_url):
        resp = requests.get(f"{base_url}/api/v1/filter-options", timeout=10)
        data = resp.json()
        assert "courts" in data
        assert len(data["courts"]) > 0

    def test_data_dictionary_has_fields(self, base_url):
        resp = requests.get(f"{base_url}/api/v1/data-dictionary", timeout=10)
        data = resp.json()
        assert "fields" in data
        assert len(data["fields"]) >= 20
