"""Tests for immi_case_downloader.web — SPA serving and API v1 endpoints."""

import json
import time

import pytest

import immi_case_downloader.web.routes.api as api_module
import immi_case_downloader.web.routes.legislations as legislations_module
from immi_case_downloader.models import ImmigrationCase


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

    def test_legacy_app_root_serves_spa(self, client):
        """Legacy /app entrypoint still serves the React SPA for old links."""
        resp = client.get("/app")
        assert resp.status_code == 200

    def test_legacy_app_deep_route_serves_spa(self, client):
        """Legacy /app/* routes still return the SPA shell."""
        resp = client.get("/app/cases")
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

    def test_cases_accepts_per_page_alias(self, client):
        resp = client.get("/api/v1/cases?page=1&per_page=2")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["page"] == 1
        assert data["page_size"] == 2
        assert len(data["cases"]) <= 2

    def test_cases_page_size_wins_over_per_page(self, client):
        resp = client.get("/api/v1/cases?page=1&page_size=3&per_page=1")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["page_size"] == 3

    def test_cases_seek_strategy_used_for_year_sort(self, client, monkeypatch):
        case = ImmigrationCase(case_id="abc123def456", title="Seek Case", year=2024)

        class _Repo:
            supports_seek_pagination = True
            pagination_backend_kind = "test-sql"

            def __init__(self):
                self.seek_calls = 0
                self.fast_calls = 0

            def count_cases(self, **_kwargs):
                return 25

            def list_cases_seek(self, **_kwargs):
                self.seek_calls += 1
                return [case]

            def list_cases_fast(self, **_kwargs):
                self.fast_calls += 1
                return []

        repo = _Repo()
        monkeypatch.setattr(api_module, "get_repo", lambda: repo)
        resp = client.get("/api/v1/cases?sort_by=year&sort_dir=desc&page=1&page_size=1")
        assert resp.status_code == 200
        data = resp.get_json()
        assert repo.seek_calls == 1
        assert repo.fast_calls == 0
        assert data["cases"][0]["case_id"] == "abc123def456"

    def test_cases_q_alias_forces_offset_fallback_when_keyword_present(self, client, monkeypatch):
        case = ImmigrationCase(case_id="abc123def456", title="Keyword Case", year=2024)

        class _Repo:
            supports_seek_pagination = True
            pagination_backend_kind = "test-sql"

            def __init__(self):
                self.seek_calls = 0
                self.fast_calls = 0
                self.last_keyword = None

            def count_cases(self, **_kwargs):
                return 25

            def list_cases_seek(self, **kwargs):
                self.seek_calls += 1
                self.last_keyword = kwargs.get("keyword")
                return [case]

            def list_cases_fast(self, **kwargs):
                self.fast_calls += 1
                self.last_keyword = kwargs.get("keyword")
                return [case]

        repo = _Repo()
        monkeypatch.setattr(api_module, "get_repo", lambda: repo)
        resp = client.get("/api/v1/cases?sort_by=year&q=Minister&page=1&page_size=1")
        assert resp.status_code == 200
        assert repo.seek_calls == 0
        assert repo.fast_calls == 1
        assert repo.last_keyword == "Minister"

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

    def test_download_start_reserves_job_slot_before_worker_runs(self, client, monkeypatch):
        class _ThreadStub:
            def __init__(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs

            def start(self):
                return None

        from immi_case_downloader.web.jobs import job_manager

        monkeypatch.setattr(api_module.threading, "Thread", _ThreadStub)
        job_manager.reset()

        try:
            first = client.post(
                "/api/v1/download/start",
                data=json.dumps({"limit": 1}),
                content_type="application/json",
            )
            assert first.status_code == 200
            assert job_manager.snapshot()["running"] is True

            second = client.post(
                "/api/v1/download/start",
                data=json.dumps({"limit": 1}),
                content_type="application/json",
            )
            assert second.status_code == 400
            assert "already running" in second.get_json()["error"]
        finally:
            job_manager.reset()

    def test_legislation_update_reserves_job_slot_before_worker_runs(self, client, monkeypatch):
        class _ThreadStub:
            def __init__(self, *args, **kwargs):
                self.args = args
                self.kwargs = kwargs

            def start(self):
                return None

        monkeypatch.setattr(legislations_module.threading, "Thread", _ThreadStub)
        legislations_module.legislation_job_manager.reset()

        try:
            first = client.post(
                "/api/v1/legislations/update",
                data=json.dumps({}),
                content_type="application/json",
            )
            assert first.status_code == 200
            assert legislations_module.legislation_job_manager.snapshot()["running"] is True

            second = client.post(
                "/api/v1/legislations/update",
                data=json.dumps({}),
                content_type="application/json",
            )
            assert second.status_code == 409
            assert "already running" in second.get_json()["error"]
        finally:
            legislations_module.legislation_job_manager.reset()

    def test_legislation_update_invalid_law_id_does_not_lock_job_slot(self, client):
        legislations_module.legislation_job_manager.reset()

        resp = client.post(
            "/api/v1/legislations/update",
            data=json.dumps({"law_id": "not-a-real-law"}),
            content_type="application/json",
        )

        assert resp.status_code == 400
        assert legislations_module.legislation_job_manager.snapshot()["running"] is False

    def test_cases_fast_path_uses_planned_count(self, client, monkeypatch):
        class _Case:
            def to_dict(self):
                return {"case_id": "abc"}

        class _Repo:
            last_mode = None

            def list_cases_fast(self, **_kwargs):
                return [_Case()]

            def count_cases(self, **kwargs):
                self.last_mode = kwargs["count_mode"]
                return 7

        repo = _Repo()
        monkeypatch.setattr(api_module, "get_repo", lambda: repo)

        resp = client.get("/api/v1/cases?page=1&page_size=1")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 7
        assert data["count_mode"] == "planned"
        assert repo.last_mode == "planned"

    def test_cases_fast_path_rejects_invalid_count_mode(self, client, monkeypatch):
        class _Repo:
            def list_cases_fast(self, **_kwargs):
                return []

            def count_cases(self, **_kwargs):
                return 0

        monkeypatch.setattr(api_module, "get_repo", lambda: _Repo())
        resp = client.get("/api/v1/cases?count_mode=bad")
        assert resp.status_code == 400
        assert "Invalid count_mode" in resp.get_json()["error"]

    def test_cases_fast_path_exact_count_falls_back_to_planned(self, client, monkeypatch):
        class _Case:
            def to_dict(self):
                return {"case_id": "abc"}

        class _Repo:
            def list_cases_fast(self, **_kwargs):
                return [_Case()]

            def count_cases(self, **kwargs):
                if kwargs.get("count_mode") == "exact":
                    raise RuntimeError("statement timeout")
                return 42

        monkeypatch.setattr(api_module, "get_repo", lambda: _Repo())
        monkeypatch.setattr(api_module, "_call_with_timeout", lambda fn, **_kwargs: fn())

        resp = client.get("/api/v1/cases?count_mode=exact&page=1&page_size=1")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 42
        assert data["count_mode"] == "planned"

    def test_case_count_endpoint_exact_falls_back_to_planned(self, client, monkeypatch):
        class _Repo:
            def count_cases(self, **kwargs):
                if kwargs.get("count_mode") == "exact":
                    raise RuntimeError("statement timeout")
                return 13

        monkeypatch.setattr(api_module, "get_repo", lambda: _Repo())
        monkeypatch.setattr(api_module, "_call_with_timeout", lambda fn, **_kwargs: fn())

        resp = client.get("/api/v1/cases/count?count_mode=exact")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 13
        assert data["count_mode"] == "planned"

    def test_filter_options_failure_uses_sample_fallback(self, client, monkeypatch):
        class _Case:
            court_code = "AATA"
            year = 2024
            source = "AustLII"
            case_nature = "Appeal"
            visa_type = "Subclass 866"
            tags = "urgent,important"

        class _Repo:
            def get_filter_options(self):
                raise RuntimeError("rpc failed")

            def list_cases_fast(self, **_kwargs):
                return [_Case()]

        monkeypatch.setattr(api_module, "get_repo", lambda: _Repo())
        monkeypatch.setattr(api_module, "_filter_options_cache_payload", None)
        monkeypatch.setattr(api_module, "_filter_options_cache_ts", 0.0)

        resp = client.get("/api/v1/filter-options")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["courts"] == ["AATA"]
        assert data["years"] == [2024]
        assert data["sources"] == ["AustLII"]
        assert data["natures"] == ["Appeal"]
        assert data["visa_types"] == ["Subclass 866"]
        assert data["tags"] == ["important", "urgent"]

    def test_stats_timeout_returns_empty_payload(self, client, monkeypatch):
        class _Repo:
            def count_cases(self, count_mode="planned"):
                return 0

            def get_statistics(self):
                return {"total": 123}

        monkeypatch.setattr(api_module, "get_repo", lambda: _Repo())
        monkeypatch.setattr(
            api_module,
            "_call_with_timeout",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(api_module.FuturesTimeoutError()),
        )
        monkeypatch.setattr(api_module, "_stats_cache_payload", None)
        monkeypatch.setattr(api_module, "_stats_cache_ts", 0.0)

        resp = client.get("/api/v1/stats")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total_cases"] == 0
        assert data["recent_cases"] == []

    def test_stats_timeout_uses_recent_cache(self, client, monkeypatch):
        class _Repo:
            def count_cases(self, count_mode="planned"):
                return 0

            def get_statistics(self):
                return {"total": 123}

        cached = {"total_cases": 77, "recent_cases": [{"case_id": "x"}]}

        monkeypatch.setattr(api_module, "get_repo", lambda: _Repo())
        monkeypatch.setattr(
            api_module,
            "_call_with_timeout",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(api_module.FuturesTimeoutError()),
        )
        monkeypatch.setattr(api_module, "_stats_cache_payload", cached)
        monkeypatch.setattr(api_module, "_stats_cache_ts", time.time())

        resp = client.get("/api/v1/stats")
        assert resp.status_code == 200
        assert resp.get_json() == cached

    def test_stats_trends_rpc_failure_returns_empty(self, client, monkeypatch):
        class _RpcCall:
            def execute(self):
                raise RuntimeError("rpc failed")

        class _Client:
            def rpc(self, _name):
                return _RpcCall()

        class _Repo:
            _client = _Client()

        monkeypatch.setattr(api_module, "get_repo", lambda: _Repo())

        resp = client.get("/api/v1/stats/trends")
        assert resp.status_code == 200
        assert resp.get_json() == {"trends": []}

    def test_stats_trends_rpc_timeout_returns_empty(self, client, monkeypatch):
        class _Repo:
            _client = object()

        monkeypatch.setattr(api_module, "get_repo", lambda: _Repo())
        monkeypatch.setattr(
            api_module,
            "_call_with_timeout",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(api_module.FuturesTimeoutError()),
        )

        resp = client.get("/api/v1/stats/trends")
        assert resp.status_code == 200
        assert resp.get_json() == {"trends": []}


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
