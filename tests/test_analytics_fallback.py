"""Tests for the analytics fallback path — application context, timeouts,
per-backend RPC gating, cancellation, cache key whitelisting, and the
per-repository scoping of the module-level case caches.

Covers PYCORR-03 (app context), PYCORR-13 (cache key), PYCORR-14
(cancel-on-timeout), and the Step 1b / Step 6b fixes discovered during
review (cross-thread close() leak, cross-repository cache bleed).
"""

import os
import threading
import time
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
