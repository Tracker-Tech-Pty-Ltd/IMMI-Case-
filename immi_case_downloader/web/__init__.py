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
import mimetypes
import threading
import weakref
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from flask import Flask

from ..config import OUTPUT_DIR
from ..storage import ensure_output_dirs

load_dotenv()
from .security import (  # noqa: E402
    csrf,
    add_security_headers,
    configure_session_security,
    require_secret_key,
)

logger = logging.getLogger(__name__)


def _shutdown_rpc_executor(executor: ThreadPoolExecutor, *, wait: bool) -> None:
    """Stop accepting RPC work without interrupting work already running."""
    executor.shutdown(wait=wait, cancel_futures=True)


def close_app(app: Flask, *, wait: bool = False) -> None:
    """Release the app-owned RPC executor when the app stops serving.

    Flask has no app-lifetime teardown hook: ``teardown_appcontext`` runs for
    every request and for the short-lived contexts used by RPC worker threads.
    Calling this function is therefore an app-owner responsibility, after no
    new requests will be accepted.  Queued futures are cancelled, while
    already-started work is allowed to finish.  ``wait=True`` is useful for a
    server owner that wants a graceful process shutdown; the default is
    non-blocking so disposal cannot hold up an in-flight request.
    """
    warmup_stop_event = app.extensions.get("immi_warmup_stop_event")
    if warmup_stop_event is not None:
        warmup_stop_event.set()

    lifecycle_lock = app.extensions.setdefault("immi_rpc_executor_lifecycle_lock", threading.Lock())
    with lifecycle_lock:
        finalizer = app.extensions.get("immi_rpc_executor_finalizer")
        if finalizer is not None and finalizer.alive:
            # The explicit owner path takes over from the GC fallback.
            finalizer.detach()

        warmup_thread = app.extensions.get("immi_warmup_thread")
        warmup_done = app.extensions.get("immi_warmup_done_event")
        warmup_is_active = (
            warmup_thread is not None
            and warmup_thread is not threading.current_thread()
            and warmup_done is not None
            and not warmup_done.is_set()
        )
        if warmup_is_active:
            # The done marker and this handoff share the warmup's finalization
            # lock. is_alive() alone can stay true after its finally block has
            # run, which used to leave the newly-written flag unread forever.
            app.extensions["immi_rpc_executor_close_deferred"] = True

    if warmup_is_active:
        # The warmup owns the same executor and may be between two submissions.
        # Let it observe the stop event and perform the deferred shutdown after
        # its current operation, rather than racing it with executor.shutdown.
        if not wait:
            return
        warmup_thread.join()

    executor = app.extensions.get("immi_rpc_executor")
    if executor is not None:
        _shutdown_rpc_executor(executor, wait=wait)


def _finalize_app_resources(
    app_ref: "weakref.ReferenceType[Flask]",
    executor: ThreadPoolExecutor,
) -> None:
    """Clean up an app that lost its owner without interrupting warmup work."""
    app = app_ref()
    if app is not None:
        warmup_stop_event = app.extensions.get("immi_warmup_stop_event")
        if warmup_stop_event is not None:
            warmup_stop_event.set()
        warmup_thread = app.extensions.get("immi_warmup_thread")
        if (
            warmup_thread is not None
            and warmup_thread is not threading.current_thread()
            and warmup_thread.is_alive()
        ):
            warmup_thread.join()
    _shutdown_rpc_executor(executor, wait=False)


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

    # Secret key: required in production-like environments, lenient in dev/test.
    _secret = os.environ.get("SECRET_KEY")
    if not _secret:
        if require_secret_key():
            raise RuntimeError(
                "SECRET_KEY must be set when APP_ENV/IMMI_ENV/FLASK_ENV is "
                "production or staging.",
            )
        warnings.warn(
            "SECRET_KEY not set! Using random key (sessions won't persist across restarts).",
            RuntimeWarning,
            stacklevel=2,
        )
        _secret = secrets.token_hex(32)
    app.secret_key = _secret

    configure_session_security(app)

    # CSRF protection
    csrf.init_app(app)

    # Per-app RPC executor for blocking Supabase/SQLite calls made through
    # _call_with_timeout() / _call_in_app_context() (routes/api.py). This MUST
    # be per-application-instance, not a module-global: two Flask apps sharing
    # one fixed-size pool means one app's abandoned work (future.cancel() is a
    # no-op once a task has actually started) permanently occupies a worker
    # and starves the other app's requests until they time out too.
    rpc_executor = ThreadPoolExecutor(max_workers=4)
    app.extensions["immi_rpc_executor"] = rpc_executor
    rpc_executor_lifecycle_lock = threading.Lock()
    app.extensions["immi_rpc_executor_lifecycle_lock"] = rpc_executor_lifecycle_lock
    # Flask does not expose an app-disposed callback.  Keep a non-blocking
    # last-resort cleanup for callers that simply drop the app object; explicit
    # owners (web.py, test harnesses, WSGI lifecycle code) should call close_app.
    rpc_executor_finalizer = weakref.finalize(
        app,
        _finalize_app_resources,
        weakref.ref(app),
        rpc_executor,
    )
    # concurrent.futures already joins executor threads during interpreter
    # shutdown.  Avoid a later atexit finalizer racing Flask warmup threads
    # after the interpreter has marked ThreadPoolExecutor unavailable.
    rpc_executor_finalizer.atexit = False
    app.extensions["immi_rpc_executor_finalizer"] = rpc_executor_finalizer

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
        logger.info("Backend: Supabase REST API")
    elif backend == "sqlite":
        from ..sqlite_repository import SqliteRepository
        app.config["REPO"] = SqliteRepository(db_path)
        app.config["BACKEND"] = "sqlite"
    else:
        from ..csv_repository import CsvRepository
        app.config["REPO"] = CsvRepository(output_dir)
        app.config["BACKEND"] = "csv"

    @app.teardown_appcontext
    def close_repository(_exc):
        repo = app.config.get("REPO")
        close = getattr(repo, "close", None)
        if callable(close):
            close()

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

    # Register Export API blueprint (cq-001 Phase A — extracted from api.py)
    from .routes.api_export import api_export_bp
    app.register_blueprint(api_export_bp)

    # Register Pipeline + LLM Council API blueprint (cq-001 Phase B)
    from .routes.api_pipeline import api_pipeline_bp
    app.register_blueprint(api_pipeline_bp)

    # Register Taxonomy + Court Lineage API blueprint (cq-001 Phase C)
    from .routes.api_taxonomy import api_taxonomy_bp
    app.register_blueprint(api_taxonomy_bp)

    # Register Cases CRUD + Search + Filter-options blueprint (cq-001 Phase D1)
    from .routes.api_cases import api_cases_bp
    app.register_blueprint(api_cases_bp)

    # Register internal Cloudflare pipeline endpoint. It has its own Worker
    # service-binding guard and is CSRF-exempt because it is not browser-facing.
    from .internal_extract import internal_extract_bp
    app.register_blueprint(internal_extract_bp)

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
        # Static assets (JS, CSS, images) — serve the actual file.
        # Containment guard: resolve symlinks and reject anything that escapes
        # the build directory BEFORE opening it. The app.testing branch below
        # opens the path directly instead of going through send_from_directory,
        # which is where the framework's own traversal check lives. Mirrors the
        # resolve()+relative_to guard in routes/api.py:2548-2554.
        react_root = os.path.realpath(react_dir)
        asset_path = os.path.realpath(os.path.join(react_dir, path)) if path else ""
        if path and not (
            asset_path == react_root or asset_path.startswith(react_root + os.sep)
        ):
            abort(404)
        if path and os.path.exists(asset_path):
            if not app.testing:
                return send_from_directory(react_dir, path)

            mime_type, encoding = mimetypes.guess_type(asset_path)
            with open(asset_path, "rb") as asset_file:
                response = app.response_class(
                    asset_file.read(),
                    mimetype=mime_type or "application/octet-stream",
                )
            if encoding:
                response.headers["Content-Encoding"] = encoding
            return response
        # All other routes → React index.html (client-side routing handles the rest)
        index_path = os.path.join(react_dir, "index.html")
        with open(index_path, "rb") as index_file:
            return app.response_class(index_file.read(), mimetype="text/html")

    # Background warmup: pre-fetch and pre-compute caches so the first browser
    # request is instant instead of paying the cold-start penalty.
    # Order:
    #   1. stats (fast, ~5s)
    #   2. analytics cases (7 cols, ~13s on free tier)
    #   3. computed analytics results (4 endpoints, uses test_client, ~2-5s RPC)
    warmup_stop_event = threading.Event()
    app.extensions["immi_warmup_stop_event"] = warmup_stop_event
    warmup_done_event = threading.Event()
    app.extensions["immi_warmup_done_event"] = warmup_done_event

    def _warmup_stats_cache():
        try:
            if warmup_stop_event.wait(2):
                return
            # Let Flask finish binding to the port first, but stop cleanly if
            # the app owner closes the server during this delay.
            from .routes.api import (
                _fill_stats_cache,
                _fill_analytics_cases_cache,
                _fill_analytics_cache,
            )
            with app.app_context():
                if warmup_stop_event.is_set():
                    return
                _fill_stats_cache()
                if warmup_stop_event.is_set():
                    return
                _fill_analytics_cases_cache()
                if warmup_stop_event.is_set():
                    return
                _fill_analytics_cache(app)
        except Exception:
            pass  # warmup failure is silent — browser request will fill it
        finally:
            with rpc_executor_lifecycle_lock:
                warmup_done_event.set()
                close_deferred = app.extensions.pop("immi_rpc_executor_close_deferred", False)
            if close_deferred:
                executor = app.extensions.get("immi_rpc_executor")
                if executor is not None:
                    _shutdown_rpc_executor(executor, wait=False)

    _warmup_thread = threading.Thread(target=_warmup_stats_cache, daemon=True)
    app.extensions["immi_warmup_thread"] = _warmup_thread
    _warmup_thread.start()

    return app
