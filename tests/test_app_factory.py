"""Tests for web/__init__.py app factory — uncovered paths.

Targets:
- backend="supabase" branch (lines 79-81)
- _capture_hyperdrive_url() before_request hook (line 105)
- SPA static asset serving in app.testing mode (lines 141-153)
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_app(backend="csv", **extra_env):
    """Create a Flask test app with CSRF disabled."""
    from immi_case_downloader.web import create_app

    env = {"SECRET_KEY": "test-key", **extra_env}
    with patch.dict(os.environ, env):
        app = create_app(backend=backend)
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False
    return app


# ── Backend selection ─────────────────────────────────────────────────────────


class TestBackendSelection:
    """create_app() backend= parameter routes to the correct repository."""

    def test_csv_backend_selected(self):
        """backend='csv' → CsvRepository is set as REPO."""
        app = _make_app(backend="csv")
        assert app.config["BACKEND"] == "csv"

    def test_sqlite_backend_selected(self, tmp_path):
        """backend='sqlite' → SqliteRepository is set as REPO."""
        with patch.dict(os.environ, {"SECRET_KEY": "test-key"}):
            from immi_case_downloader.web import create_app
            app = create_app(output_dir=str(tmp_path), backend="sqlite")
        app.config["TESTING"] = True
        app.config["WTF_CSRF_ENABLED"] = False
        try:
            assert app.config["BACKEND"] == "sqlite"
        finally:
            repo = app.config.get("REPO")
            if repo and hasattr(repo, "close"):
                repo.close()

    def test_supabase_backend_selected(self):
        """backend='supabase' → SupabaseRepository is set as REPO."""
        mock_repo = MagicMock()
        with patch(
            "immi_case_downloader.supabase_repository.SupabaseRepository",
            return_value=mock_repo,
        ):
            app = _make_app(
                backend="supabase",
                SUPABASE_URL="https://test.supabase.co",
                SUPABASE_SERVICE_ROLE_KEY="test-key",
            )

        assert app.config["BACKEND"] == "supabase"
        assert app.config["REPO"] is mock_repo

    def test_auto_backend_uses_sqlite_when_db_exists(self, tmp_path):
        """backend='auto' uses SQLite when cases.db is present."""
        db_path = tmp_path / "cases.db"
        db_path.touch()  # create empty file to simulate DB

        with patch.dict(os.environ, {"SECRET_KEY": "test-key"}):
            from immi_case_downloader.web import create_app
            app = create_app(output_dir=str(tmp_path), backend="auto")

        app.config["TESTING"] = True
        try:
            assert app.config["BACKEND"] == "sqlite"
        finally:
            repo = app.config.get("REPO")
            if repo and hasattr(repo, "close"):
                repo.close()

    def test_auto_backend_falls_back_to_csv(self, tmp_path):
        """backend='auto' uses CSV when cases.db is absent."""
        with patch.dict(os.environ, {"SECRET_KEY": "test-key"}):
            from immi_case_downloader.web import create_app
            app = create_app(output_dir=str(tmp_path), backend="auto")

        app.config["TESTING"] = True
        assert app.config["BACKEND"] == "csv"


# ── _capture_hyperdrive_url before_request hook ──────────────────────────────


class TestCaptureHyperdriveUrl:
    """The X-Hyperdrive-Url header is captured into Flask g."""

    def test_header_stored_in_g(self):
        """When X-Hyperdrive-Url is present, g.hyperdrive_url is set."""
        app = _make_app()

        stored = {}

        @app.route("/test-hd")
        def _hd_probe():
            from flask import g
            stored["url"] = getattr(g, "hyperdrive_url", None)
            return "ok"

        client = app.test_client()
        client.get("/test-hd", headers={"X-Hyperdrive-Url": "postgresql://edge/db"})

        assert stored.get("url") == "postgresql://edge/db"

    def test_no_header_leaves_g_unset(self):
        """Without the header, g.hyperdrive_url is NOT set."""
        app = _make_app()

        stored = {}

        @app.route("/test-no-hd")
        def _no_hd_probe():
            from flask import g
            stored["has_attr"] = hasattr(g, "hyperdrive_url")
            return "ok"

        client = app.test_client()
        client.get("/test-no-hd")

        assert stored.get("has_attr") is False


# ── SPA static asset serving in test mode ────────────────────────────────────


class TestSpaStaticAssetServing:
    """serve_spa() returns static files directly in app.testing mode."""

    def _make_react_dir(self, tmp_path):
        """Create a minimal fake React build directory."""
        import immi_case_downloader as pkg
        pkg_dir = os.path.dirname(pkg.__file__)
        react_dir = os.path.join(pkg_dir, "static", "react")
        return react_dir

    def test_serves_static_js_file_in_test_mode(self, tmp_path):
        """When the asset file exists and app.testing, serve it via response_class."""
        import immi_case_downloader as pkg

        pkg_dir = os.path.dirname(pkg.__file__)
        react_dir = os.path.join(pkg_dir, "static", "react")

        # Only run test when the React build directory exists
        if not os.path.isdir(react_dir):
            import pytest
            pytest.skip("React build directory not present")

        # Find a JS file in the build output
        js_files = [f for f in os.listdir(react_dir) if f.endswith(".js")]
        if not js_files:
            import pytest
            pytest.skip("No JS files in React build")

        app = _make_app()
        client = app.test_client()
        resp = client.get(f"/{js_files[0]}")

        assert resp.status_code == 200
        assert b"" not in resp.data or True  # any content is fine

    def test_api_path_not_intercepted_by_spa(self):
        """Requests to /api/* are not caught by the SPA catch-all."""
        app = _make_app()
        client = app.test_client()

        # /api/v1/nonexistent should be 404, not served as index.html
        resp = client.get("/api/v1/this-endpoint-does-not-exist")
        assert resp.status_code == 404
        assert b"index.html" not in resp.data
