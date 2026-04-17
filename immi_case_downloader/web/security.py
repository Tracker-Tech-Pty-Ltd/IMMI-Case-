"""Security helpers for Flask app setup and API protection."""

from __future__ import annotations

from collections import defaultdict
from functools import wraps
import os
import threading
import time
from typing import Callable

from flask import current_app, jsonify, request
from flask_wtf.csrf import CSRFProtect

# CSRF instance — init_app() is called by the factory in web/__init__.py
csrf = CSRFProtect()


def _runtime_env() -> str:
    for key in ("IMMI_ENV", "APP_ENV", "FLASK_ENV"):
        value = os.environ.get(key, "").strip().lower()
        if value:
            return value
    return "development"


def _env_flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def require_secret_key() -> bool:
    """Return True when the current runtime must provide SECRET_KEY explicitly."""
    return _runtime_env() in {"production", "staging"}


def secure_cookie_required() -> bool:
    """Return True when cookies should be marked Secure by default."""
    return _runtime_env() in {"production", "staging"}


def configure_session_security(app) -> None:
    """Apply secure-by-default Flask and CSRF cookie settings."""
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_SECURE"] = secure_cookie_required()
    app.config["WTF_CSRF_HEADERS"] = ["X-CSRFToken", "X-CSRF-Token"]
    app.config["WTF_CSRF_METHODS"] = ["POST", "PUT", "PATCH", "DELETE"]
    app.config["WTF_CSRF_TIME_LIMIT"] = 60 * 60
    app.config.setdefault("RATELIMIT_ENABLED", True)
    app.config.setdefault(
        "TRUST_PROXY_HEADERS",
        _env_flag("TRUST_PROXY_HEADERS", default=False),
    )


class InMemoryRateLimiter:
    """Simple per-process sliding-window rate limiter for API endpoints."""

    def __init__(self):
        self._lock = threading.Lock()
        self._hits: dict[str, list[float]] = defaultdict(list)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def _prune(self, key: str, now: float, window_seconds: int) -> list[float]:
        window_start = now - window_seconds
        recent = [ts for ts in self._hits.get(key, []) if ts > window_start]
        if recent:
            self._hits[key] = recent
        else:
            self._hits.pop(key, None)
        return recent

    def allow(
        self,
        key: str,
        *,
        max_requests: int,
        window_seconds: int,
    ) -> tuple[bool, int]:
        now = time.time()
        with self._lock:
            hits = self._prune(key, now, window_seconds)
            if len(hits) >= max_requests:
                retry_after = max(1, int(window_seconds - (now - hits[0])))
                return False, retry_after
            hits.append(now)
            self._hits[key] = hits
        return True, 0


rate_limiter = InMemoryRateLimiter()


def _rate_limit_key(scope: str) -> str:
    client_ip = request.remote_addr or "unknown"
    if current_app.config.get("TRUST_PROXY_HEADERS", False):
        forwarded_for = request.headers.get("X-Forwarded-For", "")
        trusted_ip = forwarded_for.split(",", 1)[0].strip()
        if trusted_ip:
            client_ip = trusted_ip
    return f"{scope}:{client_ip}"


def rate_limit(
    max_requests: int,
    window_seconds: int,
    *,
    scope: str | None = None,
) -> Callable:
    """Decorate a Flask view with a lightweight in-process rate limit."""

    def decorator(view_func: Callable) -> Callable:
        limiter_scope = scope or view_func.__name__

        @wraps(view_func)
        def wrapped(*args, **kwargs):
            if not current_app.config.get("RATELIMIT_ENABLED", True):
                return view_func(*args, **kwargs)

            allowed, retry_after = rate_limiter.allow(
                _rate_limit_key(limiter_scope),
                max_requests=max_requests,
                window_seconds=window_seconds,
            )
            if allowed:
                return view_func(*args, **kwargs)

            response = jsonify(
                {
                    "success": False,
                    "error": (
                        "Rate limit exceeded for this endpoint. "
                        f"Try again in {retry_after} seconds."
                    ),
                },
            )
            response.status_code = 429
            response.headers["Retry-After"] = str(retry_after)
            return response

        return wrapped

    return decorator


def add_security_headers(response):
    """Add security headers to every response."""
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; "
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; "
        "img-src 'self' data:; "
        "connect-src 'self' https://cloudflareinsights.com; "
        "worker-src 'self' blob:"
    )
    return response
