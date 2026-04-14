"""Extended tests for immi_case_downloader.web — SPA + API v1 architecture."""

import json


# ── Route status codes ─────────────────────────────────────────────────────


class TestRouteStatusCodes:
    """Verify routes return expected status codes under the SPA-at-root architecture."""

    # UI routes → 200 (served by React SPA catch-all)
    def test_dashboard_serves_spa(self, client):
        assert client.get("/").status_code == 200

    def test_cases_serves_spa(self, client):
        assert client.get("/cases").status_code == 200

    def test_case_add_serves_spa(self, client):
        assert client.get("/cases/add").status_code == 200

    def test_search_serves_spa(self, client):
        assert client.get("/search").status_code == 200

    def test_download_serves_spa(self, client):
        assert client.get("/download").status_code == 200

    def test_pipeline_serves_spa(self, client):
        assert client.get("/pipeline").status_code == 200

    def test_data_dictionary_serves_spa(self, client):
        assert client.get("/data-dictionary").status_code == 200

    def test_unknown_deep_path_serves_spa(self, client):
        """Any unknown path falls through to React router (200, not 404)."""
        assert client.get("/some/nonexistent/route").status_code == 200

    # JSON API routes → 200 (at /api/v1/*)
    def test_job_status_api_ok(self, client):
        resp = client.get("/api/v1/job-status")
        assert resp.status_code == 200
        assert "running" in resp.get_json()

    def test_pipeline_status_api_ok(self, client):
        resp = client.get("/api/v1/pipeline-status")
        assert resp.status_code == 200
        assert "running" in resp.get_json()

    def test_export_csv_ok(self, client):
        assert client.get("/api/v1/export/csv").status_code == 200

    def test_export_json_ok(self, client):
        assert client.get("/api/v1/export/json").status_code == 200

    def test_api_path_not_caught_by_spa(self, client):
        """API paths are NOT served as SPA — they return JSON or 404."""
        resp = client.get("/api/v1/stats")
        assert resp.status_code == 200
        assert "application/json" in resp.content_type

    def test_api_trailing_slash_returns_404_not_spa(self, client):
        """Trailing slash on an unknown API path → 404, never SPA index.html."""
        resp = client.get("/api/v1/nonexistent-endpoint/")
        assert resp.status_code == 404


# ── Pipeline JSON API ──────────────────────────────────────────────────────


class TestPipelineApi:
    def test_pipeline_action_stop(self, client):
        resp = client.post(
            "/api/v1/pipeline-action",
            data=json.dumps({"action": "stop"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        assert resp.get_json()["ok"] is True

    def test_pipeline_action_unknown(self, client):
        resp = client.post(
            "/api/v1/pipeline-action",
            data=json.dumps({"action": "unknown"}),
            content_type="application/json",
        )
        assert resp.status_code == 400
