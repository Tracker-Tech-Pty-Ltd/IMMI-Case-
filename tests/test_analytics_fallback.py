"""Tests for the analytics fallback path — application context, timeouts,
per-backend RPC gating, cancellation, cache key whitelisting, and the
per-repository scoping of the module-level case caches.

Covers PYCORR-03 (app context), PYCORR-13 (cache key), PYCORR-14
(cancel-on-timeout), and the Step 1b / Step 6b fixes discovered during
review (cross-thread close() leak, cross-repository cache bleed).
"""

import os
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

import pytest

from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.sqlite_repository import SqliteRepository
from immi_case_downloader.storage import ensure_output_dirs, save_cases_csv, save_cases_json
from immi_case_downloader.web.routes.api import _call_with_timeout


# ── Fixtures ─────────────────────────────────────────────────────────────
# Self-contained: do NOT reuse the shared app/client fixtures from
# conftest.py, whose populated_dir cases have no judges, no visa subclass
# and a legal_concepts value that does not map to a canonical concept.


def _make_fallback_cases(n: int = 3) -> list[ImmigrationCase]:
    """N cases that exercise every analytics aggregation path at once."""
    cases = []
    for i in range(n):
        case = ImmigrationCase(
            case_id="",
            citation=f"[2024] AATA {100 + i}",
            title=f"Applicant {i} v Minister for Immigration",
            court="Administrative Appeals Tribunal",
            court_code="AATA",
            date="15 March 2024",
            year=2024,
            url=f"https://www.austlii.edu.au/au/cases/cth/AATA/2024/{100 + i}.html",
            judges="Member Alpha",
            outcome="Remitted",
            case_nature="Protection",
            legal_concepts="Character Test",
            visa_subclass="866",
            source="AustLII",
        )
        case.ensure_id()
        cases.append(case)
    return cases


@pytest.fixture
def fallback_cases():
    return _make_fallback_cases(3)


@pytest.fixture
def csv_app(tmp_path, fallback_cases):
    """A Flask app backed by the CSV repository, pre-populated with fallback_cases."""
    from immi_case_downloader.webapp import create_app

    ensure_output_dirs(str(tmp_path))
    save_cases_csv(fallback_cases, str(tmp_path))
    save_cases_json(fallback_cases, str(tmp_path))
    application = create_app(str(tmp_path))
    application.config["TESTING"] = True
    application.config["WTF_CSRF_ENABLED"] = False
    return application


@pytest.fixture
def sqlite_app(tmp_path, fallback_cases):
    """A Flask app backed by the SQLite repository, pre-populated with fallback_cases."""
    from immi_case_downloader.webapp import create_app

    repo = SqliteRepository(os.path.join(str(tmp_path), "cases.db"))
    repo.save_many(fallback_cases)
    repo.close()
    application = create_app(str(tmp_path), backend="sqlite")
    application.config["TESTING"] = True
    application.config["WTF_CSRF_ENABLED"] = False
    return application


# ── PYCORR-03: the fallback returns real data on both local backends ──────


class TestFallbackReturnsDataOnCsvBackend:
    def test_outcomes_fallback_returns_data_on_csv_backend(self, csv_app):
        resp = csv_app.test_client().get("/api/v1/analytics/outcomes")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["by_court"]["AATA"]["Remitted"] == 3

    def test_judges_fallback_returns_data_on_csv_backend(self, csv_app):
        resp = csv_app.test_client().get("/api/v1/analytics/judges")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["judges"]
        assert data["judges"][0]["count"] == 3

    def test_legal_concepts_fallback_returns_data_on_csv_backend(self, csv_app):
        resp = csv_app.test_client().get("/api/v1/analytics/legal-concepts")
        assert resp.status_code == 200
        data = resp.get_json()
        assert {"name": "Character Test", "count": 3} in data["concepts"]

    def test_nature_outcome_fallback_returns_data_on_csv_backend(self, csv_app):
        resp = csv_app.test_client().get("/api/v1/analytics/nature-outcome")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["matrix"]["Protection"]["Remitted"] == 3


# ── PYCORR-03 + Step 3: the fallback also runs on the sqlite backend ──────

_ANALYTICS_ENDPOINTS = [
    ("/api/v1/analytics/outcomes", "by_court"),
    ("/api/v1/analytics/judges", "judges"),
    ("/api/v1/analytics/legal-concepts", "concepts"),
    ("/api/v1/analytics/nature-outcome", "matrix"),
]


class TestFallbackReturnsDataOnSqliteBackend:
    @pytest.mark.parametrize("path,primary_key", _ANALYTICS_ENDPOINTS)
    def test_analytics_returns_data_on_sqlite_backend(self, sqlite_app, path, primary_key):
        resp = sqlite_app.test_client().get(path)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data[primary_key], f"{path} returned an empty {primary_key!r}"


# ── PYCORR-14: a timed-out, still-queued task must not run later ──────────


class TestCancelOnTimeout:
    def test_call_with_timeout_cancels_queued_work_on_timeout(self):
        pool = ThreadPoolExecutor(max_workers=1)
        block_event = threading.Event()
        recorder: list[int] = []

        def _blocker():
            block_event.wait(timeout=5.0)

        def _recorder_func():
            recorder.append(1)

        # Occupy the pool's single worker so the next submission only queues.
        pool.submit(_blocker)
        with pytest.raises(FuturesTimeoutError):
            _call_with_timeout(_recorder_func, timeout_seconds=0.1, executor=pool)

        block_event.set()
        pool.shutdown(wait=True)
        # The queued task must have been cancelled before it ever started.
        assert recorder == []


# ── PYCORR-13: the cache key is whitelist-driven ───────────────────────────


class TestAnalyticsCacheKey:
    def test_analytics_cache_key_ignores_unlisted_params(self, csv_app):
        from immi_case_downloader.web.routes.api import _analytics_cache_key

        with csv_app.test_request_context("/api/v1/analytics/outcomes?utm_source=news"):
            with_utm = _analytics_cache_key()
        with csv_app.test_request_context("/api/v1/analytics/outcomes"):
            without_utm = _analytics_cache_key()
        assert with_utm == without_utm

    def test_analytics_cache_key_distinguishes_limit(self, csv_app):
        from immi_case_downloader.web.routes.api import _analytics_cache_key

        with csv_app.test_request_context("/api/v1/analytics/judges?limit=5"):
            key_5 = _analytics_cache_key()
        with csv_app.test_request_context("/api/v1/analytics/judges?limit=50"):
            key_50 = _analytics_cache_key()
        assert key_5 != key_50

    def test_analytics_cache_key_distinguishes_court(self, csv_app):
        from immi_case_downloader.web.routes.api import _analytics_cache_key

        with csv_app.test_request_context("/api/v1/analytics/outcomes?court=AATA"):
            key_aata = _analytics_cache_key()
        with csv_app.test_request_context("/api/v1/analytics/outcomes?court=FCA"):
            key_fca = _analytics_cache_key()
        assert key_aata != key_fca


# ── Step 3: a filtered request must run the fallback without ever ─────────
# ── attempting an RPC, on a backend that has RPC methods ───────────────────


class _FakeRpcRepo:
    """A repo exposing analytics RPC methods that must never be called when
    a filter is present — the filtered path must go straight to the Python
    fallback (Step 3) rather than attempt (and skip on failure) an RPC.
    """

    def __init__(self, cases):
        self._cases = cases

    def count_cases(self):
        return len(self._cases)

    def get_analytics_outcomes(self):
        raise AssertionError("RPC must not be called")

    def get_analytics_judges_raw(self):
        raise AssertionError("RPC must not be called")

    def get_analytics_concepts_raw(self):
        raise AssertionError("RPC must not be called")

    def get_analytics_nature_outcome(self):
        raise AssertionError("RPC must not be called")

    def load_all(self):
        return self._cases


class TestFilteredRequestRunsFallbackWithoutAttemptingRpc:
    def test_filtered_request_still_runs_the_fallback_when_no_rpc_was_tried(self, csv_app, fallback_cases):
        csv_app.config["REPO"] = _FakeRpcRepo(fallback_cases)
        resp = csv_app.test_client().get("/api/v1/analytics/outcomes?court=AATA")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["by_court"]["AATA"]["Remitted"] == 3


# ── Step 1b: cross-thread close() must not untrack a live connection ──────


class TestCrossThreadClose:
    def test_close_from_another_thread_does_not_untrack_a_live_connection(self, tmp_path):
        db_path = os.path.join(str(tmp_path), "cases.db")
        repo = SqliteRepository(db_path)
        # Force a connection on the main thread.
        main_conn = repo._conn()
        assert main_conn in repo._all_conns

        other_thread_result = {}

        def _close_from_other_thread():
            other_thread_result["closed_ok"] = True
            repo.close()

        t = threading.Thread(target=_close_from_other_thread)
        t.start()
        t.join()

        assert other_thread_result.get("closed_ok") is True
        # The main thread's connection must still be tracked — the other
        # thread's sqlite3 check_same_thread guard could not close it.
        assert main_conn in repo._all_conns
        # And it must still be usable from the main thread.
        assert repo._conn().execute("SELECT COUNT(*) FROM cases").fetchone()[0] == 0

        # A subsequent close() on the main thread does empty the list.
        repo.close()
        assert repo._all_conns == []


# ── Step 6b: the module-level case caches must be scoped per repository ───


def _app_over(tmp_path, subdir: str, cases: list[ImmigrationCase]):
    """Build a CSV-backed Flask app over its own output directory."""
    from immi_case_downloader.webapp import create_app

    out_dir = os.path.join(str(tmp_path), subdir)
    ensure_output_dirs(out_dir)
    save_cases_csv(cases, out_dir)
    save_cases_json(cases, out_dir)
    application = create_app(out_dir)
    application.config["TESTING"] = True
    application.config["WTF_CSRF_ENABLED"] = False
    return application


class TestCaseCachesScopedPerRepository:
    def test_analytics_cases_cache_is_scoped_per_repository(self, tmp_path):
        from immi_case_downloader.web.routes.api import _get_analytics_cases

        app_a = _app_over(tmp_path, "dir_a", _make_fallback_cases(3))
        app_b = _app_over(tmp_path, "dir_b", _make_fallback_cases(1))

        with app_a.app_context():
            cases_a = _get_analytics_cases()
        assert len(cases_a) == 3

        with app_b.app_context():
            cases_b = _get_analytics_cases()
        # Must be B's single case, not A's three — a stale/shared cache would
        # return A's list here because both fall within the 5-minute TTL.
        assert len(cases_b) == 1

    def test_all_cases_cache_is_scoped_per_repository(self, tmp_path):
        from immi_case_downloader.web.routes.api import _get_all_cases

        app_a = _app_over(tmp_path, "dir_a", _make_fallback_cases(3))
        app_b = _app_over(tmp_path, "dir_b", _make_fallback_cases(1))

        with app_a.app_context():
            cases_a = _get_all_cases()
        assert len(cases_a) == 3

        with app_b.app_context():
            cases_b = _get_all_cases()
        assert len(cases_b) == 1


# ── /stats timeout must not cache a synthetic empty corpus ───────────────


class TestStatsTimeoutFallback:
    """A timed-out get_statistics used to log "returning lightweight fallback"
    and then not take it: it built an all-zero payload and cached it for the
    full stats TTL. One transient RPC or thread-pool timeout on a cold cache
    therefore made the dashboard report zero cases for five minutes — and the
    dashboard renders "Welcome to IMMI-Case" at zero, so it looked like a
    fresh install rather than an outage.
    """

    def test_timeout_reports_the_real_total_not_zero(self, sqlite_app):
        from immi_case_downloader.web.routes import api as api_mod

        def always_times_out(*args, **kwargs):
            raise FuturesTimeoutError()

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(api_mod, "_call_with_timeout", always_times_out)
            resp = sqlite_app.test_client().get("/api/v1/stats")

        assert resp.status_code == 200
        assert resp.get_json()["total_cases"] == 3

    def test_timeout_with_no_countable_total_does_not_poison_the_cache(
        self, sqlite_app
    ):
        """When the cheap count fails too, the zero is a guess — don't cache it."""
        from immi_case_downloader.web.routes import api as api_mod

        def always_times_out(*args, **kwargs):
            raise FuturesTimeoutError()

        def always_raises(*args, **kwargs):
            raise RuntimeError("backend down")

        client = sqlite_app.test_client()
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(api_mod, "_call_with_timeout", always_times_out)
            with sqlite_app.app_context():
                repo = api_mod.get_repo()
            mp.setattr(repo, "count_cases", always_raises)
            degraded = client.get("/api/v1/stats")

        assert degraded.get_json()["total_cases"] == 0

        # The outage is over; the very next request must re-query rather than
        # serve the cached zero for the rest of the TTL.
        recovered = client.get("/api/v1/stats")
        assert recovered.get_json()["total_cases"] == 3
