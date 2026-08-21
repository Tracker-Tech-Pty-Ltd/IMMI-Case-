"""Tests for Phase 0: CRITICAL security fixes.

Covers:
- Issue 0.1: CSRF protection (CWE-352)
- Issue 0.2: Secret key hardcoding (CWE-798)
- Issue 0.3: Default host binding (CWE-668)
- Issue 0.4: Security HTTP headers (CWE-693)
"""

import os
from unittest.mock import patch

import pytest


# ── Fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture
def csrf_app(populated_dir):
    """Flask test app with CSRF protection ENABLED (for security tests)."""
    from immi_case_downloader.webapp import create_app

    application = create_app(str(populated_dir))
    application.config["TESTING"] = True
    # Keep CSRF enabled — this fixture is specifically for CSRF tests
    return application


@pytest.fixture
def csrf_client(csrf_app):
    """Test client with CSRF enabled."""
    return csrf_app.test_client()



# ── Issue 0.1: CSRF Protection ─────────────────────────────────────────────


class TestCSRFProtection:
    """Verify CSRF is configured for the application.

    CSRF protection applies to the JSON API layer (used by the React SPA).
    """

    def test_api_pipeline_action_requires_csrf_token(self, csrf_client):
        """Pipeline action endpoint must reject requests without a CSRF token."""
        resp = csrf_client.post(
            "/api/v1/pipeline-action",
            json={"action": "stop"},
            content_type="application/json",
        )
        # Must return 400 for missing CSRF token (destructive operation)
        assert resp.status_code in (400, 403), (
            f"Expected CSRF rejection (400/403), got {resp.status_code}. "
            "@csrf.exempt must not be present on this endpoint."
        )

    def test_csrf_token_endpoint_accessible(self, csrf_client):
        """React SPA CSRF token endpoint returns a token."""
        resp = csrf_client.get("/api/v1/csrf-token")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "csrf_token" in data


# ── Issue 0.2: Secret Key ──────────────────────────────────────────────────


class TestSecretKey:
    """Verify secret key is not hardcoded and uses env var or random."""

    def test_secret_key_from_env(self, populated_dir):
        """When SECRET_KEY env var is set, it should be used."""
        test_key = "test-secret-key-from-env-var-12345"
        with patch.dict(os.environ, {"SECRET_KEY": test_key}):
            from immi_case_downloader.web import create_app
            app = create_app(str(populated_dir))
            assert app.secret_key == test_key

    def test_secret_key_no_hardcoded_fallback(self):
        """The string 'immi-case-dev-key' must NOT appear in web/__init__.py."""
        import immi_case_downloader.web as web_mod
        source_path = web_mod.__file__
        with open(source_path) as f:
            source = f.read()
        assert "immi-case-dev-key" not in source, (
            "Hardcoded development key still present in source code"
        )

    def test_secret_key_random_when_missing(self, populated_dir):
        """Without SECRET_KEY env var, a random key should be generated."""
        env = os.environ.copy()
        env.pop("SECRET_KEY", None)
        env.pop("APP_ENV", None)
        env.pop("IMMI_ENV", None)
        env.pop("FLASK_ENV", None)
        with patch.dict(os.environ, env, clear=True):
            from immi_case_downloader.web import create_app
            with pytest.warns(
                RuntimeWarning,
                match="SECRET_KEY not set",
            ):
                app = create_app(str(populated_dir))
            # Should not be the old hardcoded value
            assert app.secret_key != "immi-case-dev-key-change-in-prod"
            # Should be a non-empty string
            assert app.secret_key is not None and len(app.secret_key) >= 32

    def test_secret_key_required_in_production(self, populated_dir):
        """Production-like environments must provide SECRET_KEY explicitly."""
        env = os.environ.copy()
        env.pop("SECRET_KEY", None)
        env["APP_ENV"] = "production"
        with patch.dict(os.environ, env, clear=True):
            from immi_case_downloader.web import create_app

            with pytest.raises(RuntimeError, match="SECRET_KEY must be set"):
                create_app(str(populated_dir))

    def test_cookie_flags_default_to_secure_baseline(self, populated_dir):
        """Session and CSRF cookies should be configured defensively."""
        test_key = "cookie-flags-dev-key"
        with patch.dict(os.environ, {"SECRET_KEY": test_key, "APP_ENV": "development"}):
            from immi_case_downloader.web import create_app

            app = create_app(str(populated_dir))
            assert app.config["SESSION_COOKIE_HTTPONLY"] is True
            assert app.config["SESSION_COOKIE_SAMESITE"] == "Lax"
            assert app.config["SESSION_COOKIE_SECURE"] is False
            assert "X-CSRFToken" in app.config["WTF_CSRF_HEADERS"]

    def test_cookie_secure_flag_enabled_in_production(self, populated_dir):
        """Production-like environments should force Secure cookies."""
        test_key = "cookie-flags-prod-key"
        with patch.dict(os.environ, {"SECRET_KEY": test_key, "APP_ENV": "production"}):
            from immi_case_downloader.web import create_app

            app = create_app(str(populated_dir))
            assert app.config["SESSION_COOKIE_SECURE"] is True


# ── Issue 0.3: Default Host Binding ────────────────────────────────────────


class TestDefaultHost:
    """Verify web.py defaults to localhost, not 0.0.0.0."""

    def test_default_host_is_localhost(self):
        """web.py argparse default should be 127.0.0.1, not 0.0.0.0."""
        import ast
        with open("web.py") as f:
            source = f.read()
        tree = ast.parse(source)
        # Find the add_argument call for --host
        for node in ast.walk(tree):
            if (isinstance(node, ast.Call) and
                    hasattr(node, 'args') and
                    any(isinstance(a, ast.Constant) and a.value == "--host"
                        for a in node.args)):
                # Check the default= keyword
                for kw in node.keywords:
                    if kw.arg == "default":
                        assert isinstance(kw.value, ast.Constant)
                        assert kw.value.value == "127.0.0.1", (
                            f"Default host is '{kw.value.value}', should be '127.0.0.1'"
                        )
                        return
        pytest.fail("Could not find --host argument definition in web.py")

    def test_debug_with_public_host_warns(self):
        """Using debug mode with 0.0.0.0 should produce a warning."""
        import subprocess
        import sys
        result = subprocess.run(
            [sys.executable, "-c", """
import warnings
import sys
sys.argv = ['web.py', '--host', '0.0.0.0', '--debug', '--port', '0']
# Import web first so we can patch create_app via patch.object.
# Patching create_app prevents the real Flask app (and its background
# warmup thread) from starting — which could otherwise block the subprocess
# for tens of seconds while loading case data.
# The warning under test is issued BEFORE create_app() is called, so
# this patch does not affect the behaviour we are testing.
from unittest.mock import patch, MagicMock
import web
with patch.object(web, "create_app", return_value=MagicMock()):
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        web.main()
        for w in caught:
            if 'public' in str(w.message).lower() or '0.0.0.0' in str(w.message):
                print('WARNING_FOUND')
                break
        else:
            print('NO_WARNING')
"""],
            capture_output=True, text=True, timeout=10
        )
        assert "WARNING_FOUND" in result.stdout, (
            f"No warning about public host in debug mode. stdout={result.stdout}, stderr={result.stderr}"
        )


# ── Issue 0.4: Security HTTP Headers ───────────────────────────────────────


class TestSecurityHeaders:
    """Verify security headers are set on all responses."""

    EXPECTED_HEADERS = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "strict-origin-when-cross-origin",
    }

    def test_security_headers_present(self, client):
        """All responses should include security headers."""
        resp = client.get("/")
        for header, value in self.EXPECTED_HEADERS.items():
            assert resp.headers.get(header) == value, (
                f"Missing or wrong header {header}: "
                f"expected '{value}', got '{resp.headers.get(header)}'"
            )

    def test_csp_header_value(self, client):
        """Content-Security-Policy should be set with reasonable defaults."""
        resp = client.get("/")
        csp = resp.headers.get("Content-Security-Policy")
        assert csp is not None, "Content-Security-Policy header missing"
        # Should at least restrict default-src
        assert "default-src" in csp
        # Telegram Login Widget is the only supported auth entry point.
        assert "https://telegram.org" in csp
        assert "https://oauth.telegram.org" in csp

    def test_security_headers_on_all_pages(self, client):
        """Security headers should appear on various page types."""
        for path in ["/", "/cases", "/analytics", "/api/v1/export/json"]:
            resp = client.get(path)
            assert resp.headers.get("X-Content-Type-Options") == "nosniff", (
                f"X-Content-Type-Options missing from {path}"
            )

    def test_security_headers_on_spa_fallback(self, client):
        """Security headers should appear even on SPA fallback routes."""
        resp = client.get("/nonexistent-deep/route/123")
        # SPA catch-all returns 200 with index.html
        assert resp.headers.get("X-Content-Type-Options") == "nosniff"


class TestRateLimiting:
    """Verify high-risk POST endpoints are protected by rate limits."""

    def test_pipeline_action_rate_limited(self, client):
        for _ in range(10):
            resp = client.post(
                "/api/v1/pipeline-action",
                json={"action": "stop"},
                content_type="application/json",
            )
            assert resp.status_code == 200

        limited = client.post(
            "/api/v1/pipeline-action",
            json={"action": "stop"},
            content_type="application/json",
        )
        assert limited.status_code == 429
        assert limited.headers.get("Retry-After")
        payload = limited.get_json()
        assert "Rate limit exceeded" in payload["error"]

    def test_pipeline_action_ignores_spoofed_forwarded_for_by_default(self, client):
        for idx in range(10):
            resp = client.post(
                "/api/v1/pipeline-action",
                json={"action": "stop"},
                content_type="application/json",
                headers={"X-Forwarded-For": f"198.51.100.{idx}"},
                environ_overrides={"REMOTE_ADDR": "203.0.113.10"},
            )
            assert resp.status_code == 200

        limited = client.post(
            "/api/v1/pipeline-action",
            json={"action": "stop"},
            content_type="application/json",
            headers={"X-Forwarded-For": "198.51.100.250"},
            environ_overrides={"REMOTE_ADDR": "203.0.113.10"},
        )
        assert limited.status_code == 429

    def test_pipeline_action_can_trust_forwarded_for_when_opted_in(self, client):
        client.application.config["TRUST_PROXY_HEADERS"] = True
        try:
            for _ in range(10):
                resp = client.post(
                    "/api/v1/pipeline-action",
                    json={"action": "stop"},
                    content_type="application/json",
                    headers={"X-Forwarded-For": "198.51.100.10"},
                    environ_overrides={"REMOTE_ADDR": "203.0.113.10"},
                )
                assert resp.status_code == 200

            limited = client.post(
                "/api/v1/pipeline-action",
                json={"action": "stop"},
                content_type="application/json",
                headers={"X-Forwarded-For": "198.51.100.10"},
                environ_overrides={"REMOTE_ADDR": "203.0.113.10"},
            )
            assert limited.status_code == 429

            fresh_bucket = client.post(
                "/api/v1/pipeline-action",
                json={"action": "stop"},
                content_type="application/json",
                headers={"X-Forwarded-For": "198.51.100.11"},
                environ_overrides={"REMOTE_ADDR": "203.0.113.10"},
            )
            assert fresh_bucket.status_code == 200
        finally:
            client.application.config["TRUST_PROXY_HEADERS"] = False


# ── sec-001: Debug endpoint removed ───────────────────────────────────────


class TestDebugEndpointRemoved:
    """Regression tests for sec-001: /api/v1/debug must not exist.

    The endpoint previously leaked SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY,
    HYPERDRIVE_DATABASE_URL, /etc/resolv.conf, and /etc/hosts to any
    unauthenticated caller.  These tests ensure it is permanently gone.
    """

    def test_debug_endpoint_returns_404(self, client):
        """GET /api/v1/debug must return 404 in all environments."""
        resp = client.get("/api/v1/debug")
        assert resp.status_code == 404, (
            f"Expected 404 (endpoint removed), got {resp.status_code}. "
            "The /api/v1/debug route must not be registered."
        )

    def test_debug_endpoint_does_not_leak_env_keys(self, client):
        """Even on 404, the response body must not contain env var fragments."""
        resp = client.get("/api/v1/debug")
        body = resp.get_data(as_text=True).lower()
        for forbidden in ("secret_key", "service_role", "hyperdrive", "resolv.conf"):
            assert forbidden not in body, (
                f"Response body contains '{forbidden}' — sensitive data still leaking."
            )

    def test_debug_endpoint_post_also_404(self, client):
        """POST to /api/v1/debug must also return 404 (no method-routing gap)."""
        resp = client.post("/api/v1/debug", json={})
        assert resp.status_code in (404, 405), (
            f"Expected 404 or 405 for POST /api/v1/debug, got {resp.status_code}."
        )
