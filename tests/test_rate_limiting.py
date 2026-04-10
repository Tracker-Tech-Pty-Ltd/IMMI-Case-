"""Tests for rate limiting and API caching."""
from __future__ import annotations

import time
from unittest.mock import patch


def test_flask_limiter_installed():
    """flask-limiter must be importable."""
    import flask_limiter
    assert flask_limiter is not None


def test_in_memory_rate_limiter_allows_within_limit():
    """InMemoryRateLimiter should allow requests within the window."""
    from immi_case_downloader.web.security import InMemoryRateLimiter

    limiter = InMemoryRateLimiter()
    for _ in range(5):
        allowed, retry_after = limiter.allow("test-key", max_requests=5, window_seconds=60)
        assert allowed is True
        assert retry_after == 0


def test_in_memory_rate_limiter_blocks_over_limit():
    """InMemoryRateLimiter should block once limit is exceeded."""
    from immi_case_downloader.web.security import InMemoryRateLimiter

    limiter = InMemoryRateLimiter()
    for _ in range(3):
        limiter.allow("test-key", max_requests=3, window_seconds=60)

    allowed, retry_after = limiter.allow("test-key", max_requests=3, window_seconds=60)
    assert allowed is False
    assert retry_after >= 1


def test_in_memory_rate_limiter_reset():
    """InMemoryRateLimiter.reset() clears all state."""
    from immi_case_downloader.web.security import InMemoryRateLimiter

    limiter = InMemoryRateLimiter()
    for _ in range(3):
        limiter.allow("test-key", max_requests=3, window_seconds=60)

    limiter.reset()
    allowed, _ = limiter.allow("test-key", max_requests=3, window_seconds=60)
    assert allowed is True


def test_stats_cache_returns_consistent_results(client):
    """Two consecutive calls to /api/v1/stats should return the same payload."""
    r1 = client.get("/api/v1/stats")
    r2 = client.get("/api/v1/stats")
    assert r1.status_code == 200
    assert r1.json == r2.json


def test_csrf_token_endpoint_exists(client):
    """CSRF token endpoint should respond with a token."""
    r = client.get("/api/v1/csrf-token")
    assert r.status_code == 200
    data = r.get_json()
    assert "csrf_token" in data
    assert isinstance(data["csrf_token"], str)
    assert len(data["csrf_token"]) > 0


def test_search_endpoint_exists(client):
    """Search endpoint should respond (even with empty results)."""
    r = client.get("/api/v1/search?q=test")
    assert r.status_code in (200, 400, 401, 404)


def test_cases_list_endpoint_exists(client):
    """Cases list endpoint should respond."""
    r = client.get("/api/v1/cases?page=1&per_page=10")
    assert r.status_code in (200, 400, 401)


def test_rate_limit_decorator_returns_429_when_exceeded(app):
    """rate_limit decorator should return HTTP 429 after limit is reached."""
    from immi_case_downloader.web.security import rate_limit, rate_limiter

    rate_limiter.reset()

    with app.test_request_context("/api/v1/csrf-token"):
        from flask import Flask
        mini_app = Flask(__name__)

        @mini_app.route("/test-rl")
        @rate_limit(2, 60, scope="test-endpoint")
        def _test_view():
            return "ok", 200

        with mini_app.test_client() as c:
            r1 = c.get("/test-rl")
            r2 = c.get("/test-rl")
            r3 = c.get("/test-rl")

        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r3.status_code == 429
        assert "Retry-After" in r3.headers


def test_rate_limit_disabled_by_config(app):
    """When RATELIMIT_ENABLED=False, rate_limit decorator should pass all requests."""
    from immi_case_downloader.web.security import rate_limit

    mini_app = app.__class__(__name__)
    mini_app.config["RATELIMIT_ENABLED"] = False
    mini_app.config["TESTING"] = True
    mini_app.secret_key = "test"

    @mini_app.route("/test-disabled")
    @rate_limit(1, 60, scope="test-disabled")
    def _test_view():
        return "ok", 200

    with mini_app.test_client() as c:
        for _ in range(5):
            r = c.get("/test-disabled")
            assert r.status_code == 200


def test_filter_options_cache(client):
    """Two calls to filter-options should return consistent results."""
    r1 = client.get("/api/v1/filter-options")
    r2 = client.get("/api/v1/filter-options")
    assert r1.status_code == 200
    assert r1.json == r2.json
