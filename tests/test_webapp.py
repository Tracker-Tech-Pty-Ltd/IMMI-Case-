"""Tests for immi_case_downloader.web — SPA serving and API v1 endpoints."""

import json

import pytest


# ── SPA serving ───────────────────────────────────────────────────────────


class TestSPAServing:
    """Root and non-API paths serve the React SPA (index.html)."""

    def test_root_serves_spa(self, client):
        """GET / returns 200 (React index.html)."""
        resp = client.get("/")
        assert resp.status_code == 200

    def test_unknown_path_serves_spa(self, client):
        """Any unknown path falls through to React router (200, not 404)."""
        resp = client.get("/some/deep/route")
        assert resp.status_code == 200

    def test_api_path_not_caught_by_spa(self, client):
        """API paths are NOT caught by the SPA catch-all."""
        resp = client.get("/api/v1/stats")
        # Must be JSON, not HTML
        assert resp.status_code == 200
        assert "application/json" in resp.content_type


# ── Export via API v1 ─────────────────────────────────────────────────────


class TestExport:
    def test_export_csv(self, client):
        resp = client.get("/api/v1/export/csv")
        assert resp.status_code == 200
        assert resp.content_type.startswith("text/csv")

    def test_export_csv_filtered(self, client):
        resp_all = client.get("/api/v1/export/csv")
        resp_filtered = client.get("/api/v1/export/csv?court=FCA")
        assert resp_filtered.status_code == 200
        all_lines = resp_all.data.decode().strip().split("\n")
        filtered_lines = resp_filtered.data.decode().strip().split("\n")
        assert len(filtered_lines) < len(all_lines)

    def test_export_json(self, client):
        resp = client.get("/api/v1/export/json")
        assert resp.status_code == 200
        data = json.loads(resp.data)
        assert "total_cases" in data
        assert "cases" in data


# ── Core API v1 routes ─────────────────────────────────────────────────────


class TestApiRoutes:
    def test_case_count_api(self, client):
        resp = client.get("/api/v1/cases/count")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "total" in data
        assert data.get("count_mode") == "exact"

    def test_case_count_api_rejects_invalid_mode(self, client):
        resp = client.get("/api/v1/cases/count?count_mode=invalid")
        assert resp.status_code == 400
        data = resp.get_json()
        assert "error" in data

    def test_job_status_api(self, client):
        resp = client.get("/api/v1/job-status")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "running" in data

    def test_pipeline_status_api(self, client):
        resp = client.get("/api/v1/pipeline-status")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "running" in data

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


# ── Security headers ───────────────────────────────────────────────────────


class TestSecurityHeaders:
    def test_spa_response_has_security_headers(self, client):
        """Root SPA response includes security headers."""
        resp = client.get("/")
        for header in ("X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"):
            assert header in resp.headers, f"Missing {header}"

    def test_api_response_has_security_headers(self, client):
        resp = client.get("/api/v1/job-status")
        for header in ("X-Content-Type-Options", "X-Frame-Options"):
            assert header in resp.headers, f"Missing {header}"
