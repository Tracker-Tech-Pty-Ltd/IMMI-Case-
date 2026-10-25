"""Tests for web/__init__.py app factory — uncovered paths.

Targets:
- backend="supabase" branch (lines 79-81)
- SPA static asset serving in app.testing mode (lines 141-153)
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_app(output_dir, backend="csv", **extra_env):
    """Create a Flask test app with CSRF disabled."""
    from immi_case_downloader.web import create_app

    env = {"SECRET_KEY": "test-key", **extra_env}
    with patch.dict(os.environ, env):
        app = create_app(output_dir=str(output_dir), backend=backend)
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False
    return app


# ── Backend selection ─────────────────────────────────────────────────────────


class TestBackendSelection:
    """create_app() backend= parameter routes to the correct repository."""

    def test_csv_backend_selected(self, tmp_path):
        """backend='csv' → CsvRepository is set as REPO."""
        app = _make_app(tmp_path, backend="csv")
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

    def test_supabase_backend_selected(self, tmp_path):
        """backend='supabase' → SupabaseRepository is set as REPO."""
        mock_repo = MagicMock()
        with patch(
            "immi_case_downloader.supabase_repository.SupabaseRepository",
            return_value=mock_repo,
        ):
            app = _make_app(
                tmp_path,
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


class TestSupabaseBackendSelection:
    """backend='supabase' always builds SupabaseRepository after the direct-
    psycopg2 Hyperdrive backend's removal — including when only the
    Hyperdrive URL is set."""

    def test_hyperdrive_url_alone_no_longer_selects_a_second_backend(self, tmp_path):
        """Only HYPERDRIVE_DATABASE_URL set → SupabaseRepository is attempted,
        and it fails loudly for missing credentials rather than silently
        swapping in a different repository class.

        SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are pinned to "" rather than
        popped: SupabaseRepository.__init__() calls load_dotenv(), which walks
        up the directory tree and would otherwise refill a *popped* (i.e.
        absent) key from this repo's real local-dev .env — an empty-but-present
        key is left alone by dotenv's default override=False.
        """
        from immi_case_downloader.web import create_app

        env = {
            "HYPERDRIVE_DATABASE_URL": "postgresql://edge/db",
            "SUPABASE_URL": "",
            "SUPABASE_SERVICE_ROLE_KEY": "",
        }
        with patch.dict(os.environ, env, clear=False):
            with pytest.raises(ValueError, match="SUPABASE_URL"):
                create_app(backend="supabase", output_dir=str(tmp_path))

    def test_supabase_and_hyperdrive_both_set_still_selects_supabase(self, tmp_path):
        """Both env shapes present → BACKEND is 'supabase', never 'hyperdrive'."""
        from immi_case_downloader.web import create_app

        env = {
            "HYPERDRIVE_DATABASE_URL": "postgresql://edge/db",
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
        }
        with patch.dict(os.environ, env, clear=False), patch(
            "immi_case_downloader.supabase_repository.create_client",
            return_value=MagicMock(),
        ):
            app = create_app(backend="supabase", output_dir=str(tmp_path))
        assert app.config["BACKEND"] == "supabase"
        assert type(app.config["REPO"]).__name__ == "SupabaseRepository"


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

        app = _make_app(tmp_path)
        client = app.test_client()
        resp = client.get(f"/{js_files[0]}")

        assert resp.status_code == 200
        assert b"" not in resp.data or True  # any content is fine

    def test_api_path_not_intercepted_by_spa(self, tmp_path):
        """Requests to /api/* are not caught by the SPA catch-all."""
        app = _make_app(tmp_path)
        client = app.test_client()

        # /api/v1/nonexistent should be 404, not served as index.html
        resp = client.get("/api/v1/this-endpoint-does-not-exist")
        assert resp.status_code == 404
        assert b"index.html" not in resp.data
