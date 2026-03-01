"""Flask web application factory.

Serves the React SPA at / with the JSON API at /api/v1/*.
- helpers.py   — utility functions (safe_int, safe_float, _filter_cases, etc.)
- security.py  — CSRF setup and security headers
- jobs.py      — background job state and runner functions
- routes/api.py          — /api/v1/* JSON endpoints (React SPA)
- routes/legislations.py — /api/v1/legislations/* endpoints
- routes/bookmarks.py    — /api/v1/bookmarks and /api/v1/collections endpoints
"""

import os
import secrets
import warnings
import logging

from dotenv import load_dotenv
from flask import Flask

from ..config import OUTPUT_DIR
from ..storage import ensure_output_dirs

load_dotenv()
from .security import csrf, add_security_headers

logger = logging.getLogger(__name__)


def create_app(output_dir: str = OUTPUT_DIR, backend: str = "auto"):
    """Application factory — creates and configures a Flask instance.

    Args:
        output_dir: Directory for case data files.
        backend: Storage backend — "sqlite", "csv", "supabase", or "auto".
    """
    pkg_dir = os.path.dirname(os.path.dirname(__file__))
    app = Flask(
        __name__,
        static_folder=os.path.join(pkg_dir, "static"),
    )

    # Secret key: prefer env var, fall back to random per-process key with warning
    _secret = os.environ.get("SECRET_KEY")
    if not _secret:
        warnings.warn(
            "SECRET_KEY not set! Using random key (sessions won't persist across restarts).",
            RuntimeWarning,
            stacklevel=2,
        )
        _secret = secrets.token_hex(32)
    app.secret_key = _secret

    # CSRF protection
    csrf.init_app(app)

    # App config
    app.config["OUTPUT_DIR"] = output_dir
    ensure_output_dirs(output_dir)

    # Repository backend
    db_path = os.path.join(output_dir, "cases.db")
    if backend == "auto":
        backend = "sqlite" if os.path.exists(db_path) else "csv"

    if backend == "supabase":
        from ..supabase_repository import SupabaseRepository
        app.config["REPO"] = SupabaseRepository(output_dir=output_dir)
        app.config["BACKEND"] = "supabase"
    elif backend == "sqlite":
        from ..sqlite_repository import SqliteRepository
        app.config["REPO"] = SqliteRepository(db_path)
        app.config["BACKEND"] = "sqlite"
    else:
        from ..csv_repository import CsvRepository
        app.config["REPO"] = CsvRepository(output_dir)
        app.config["BACKEND"] = "csv"

    # Security headers on every response
    @app.after_request
    def security_headers(response):
        return add_security_headers(response)

    # Register JSON API blueprint for React SPA
    from .routes.api import api_bp
    app.register_blueprint(api_bp)

    # Register Legislations API blueprint
    from .routes.legislations import legislations_bp
    app.register_blueprint(legislations_bp)

    # Register Bookmarks/Collections API blueprint
    from .routes.bookmarks import bookmarks_bp
    app.register_blueprint(bookmarks_bp)

    # React SPA catch-all: serve all non-API requests from the React build.
    # /api/* is handled by the blueprints above; everything else gets index.html.
    react_dir = os.path.join(pkg_dir, "static", "react")

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_spa(path):
        """Serve the React SPA at the root path."""
        from flask import send_from_directory, abort
        # API paths must never be intercepted by the SPA catch-all.
        # Blueprint routes handle /api/*, but trailing-slash variants can
        # fall through to this catch-all. Return 404 so Flask propagates
        # the "not found" correctly instead of serving index.html.
        if path.startswith("api/"):
            abort(404)
        # Static assets (JS, CSS, images) — serve the actual file
        if path and os.path.exists(os.path.join(react_dir, path)):
            return send_from_directory(react_dir, path)
        # All other routes → React index.html (client-side routing handles the rest)
        return send_from_directory(react_dir, "index.html")

    # Background warmup: pre-fetch and pre-compute caches so the first browser
    # request is instant instead of paying the cold-start penalty.
    # Order:
    #   1. stats (fast, ~5s)
    #   2. analytics cases (7 cols, ~13s on free tier)
    #   3. computed analytics results (4 endpoints, uses test_client, ~2-5s RPC)
    def _warmup_stats_cache():
        import time as _time
        _time.sleep(2)  # let Flask finish binding to the port first
        try:
            from .routes.api import (
                _fill_stats_cache,
                _fill_analytics_cases_cache,
                _fill_analytics_cache,
            )
            with app.app_context():
                _fill_stats_cache()
                _fill_analytics_cases_cache()
                _fill_analytics_cache(app)
        except Exception:
            pass  # warmup failure is silent — browser request will fill it

    import threading as _threading
    _warmup_thread = _threading.Thread(target=_warmup_stats_cache, daemon=True)
    _warmup_thread.start()

    return app
