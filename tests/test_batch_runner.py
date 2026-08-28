"""Tests for the shared catalog batch-job plumbing."""

from __future__ import annotations

import csv
import os
import threading

import pytest

from immi_case_downloader.csv_write_lock import csv_write_lock, lock_path_for
from immi_case_downloader.extraction.batch_runner import (
    CatalogLockedError,
    atomic_write_rows,
    catalog_lock,
    load_project_env,
    temp_path_for,
)


def test_temp_path_for_returns_distinct_sibling_paths(tmp_path):
    csv_path = tmp_path / "catalog.csv"

    first = temp_path_for(csv_path, "job_a")
    second = temp_path_for(csv_path, "job_b")

    assert first != second
    assert first.parent == csv_path.parent
    assert second.parent == csv_path.parent


def test_temp_path_for_rejects_bad_job_name(tmp_path):
    csv_path = tmp_path / "catalog.csv"

    with pytest.raises(ValueError):
        temp_path_for(csv_path, "Bad Name")


def test_atomic_write_rows_round_trips_with_no_leftover_tmp(tmp_path):
    csv_path = tmp_path / "catalog.csv"
    csv_path.write_text("a,b\n1,2\n", encoding="utf-8-sig")

    atomic_write_rows(csv_path, [{"a": "9", "b": "8"}], job_name="probe")

    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    assert rows == [{"a": "9", "b": "8"}]
    assert sorted(tmp_path.glob("*.tmp")) == []


def test_atomic_write_rows_with_empty_rows_leaves_catalog_untouched(tmp_path):
    csv_path = tmp_path / "catalog.csv"
    csv_path.write_text("a,b\n1,2\n", encoding="utf-8-sig")

    atomic_write_rows(csv_path, [], job_name="probe")

    assert csv_path.read_text(encoding="utf-8-sig") == "a,b\n1,2\n"


def test_atomic_write_rows_backup_once_does_not_overwrite_existing_backup(tmp_path):
    csv_path = tmp_path / "catalog.csv"
    csv_path.write_text("a,b\n1,2\n", encoding="utf-8-sig")
    backup_path = csv_path.with_suffix(".csv.bak_test")
    backup_path.write_text("older,backup\ncontent,here\n", encoding="utf-8-sig")

    atomic_write_rows(
        csv_path,
        [{"a": "9", "b": "8"}],
        job_name="probe",
        backup_suffix=".csv.bak_test",
        backup_once=True,
    )

    assert backup_path.read_text(encoding="utf-8-sig") == "older,backup\ncontent,here\n"


def test_atomic_write_rows_without_backup_once_creates_backup(tmp_path):
    csv_path = tmp_path / "catalog.csv"
    csv_path.write_text("a,b\n1,2\n", encoding="utf-8-sig")
    backup_path = csv_path.with_suffix(".csv.bak_test")

    atomic_write_rows(
        csv_path,
        [{"a": "9", "b": "8"}],
        job_name="probe",
        backup_suffix=".csv.bak_test",
    )

    assert backup_path.exists()
    with open(backup_path, encoding="utf-8-sig", newline="") as f:
        assert list(csv.DictReader(f)) == [{"a": "1", "b": "2"}]


def test_catalog_lock_raises_when_already_held(tmp_path):
    csv_path = tmp_path / "catalog.csv"

    with catalog_lock(csv_path, "first_job"):
        with pytest.raises(CatalogLockedError) as excinfo:
            with catalog_lock(csv_path, "second_job"):
                pass

    assert "first_job" in str(excinfo.value)


def test_catalog_lock_releases_on_exception(tmp_path):
    """Released means re-acquirable — not "the lock file is gone".

    The lock file deliberately outlives its holder: unlinking it would let a
    waiting process hold a lock on an orphaned inode while the next process
    locks a fresh one. Exclusion is the ``flock``, not the file's existence.
    """
    csv_path = tmp_path / "catalog.csv"

    with pytest.raises(ValueError):
        with catalog_lock(csv_path, "a"):
            raise ValueError("boom")

    with catalog_lock(csv_path, "b"):
        pass


# ── One lock protocol across both entry points ───────────────────────────
#
# csv_write_lock() (web/CLI writers) and catalog_lock() (repo-root batch jobs)
# guard the same master CSV. They used to disagree about what "locked" means —
# flock versus an O_EXCL sentinel file — so each was invisible to the other.
# Every test below crosses the two entry points on one path; a test that
# exercises only one of them cannot see that class of bug at all.


def _lock_holder_thread(acquire, ready, release):
    """Run ``acquire()`` in a thread, holding it until ``release`` is set."""

    def hold():
        with acquire():
            ready.set()
            release.wait(timeout=5)

    thread = threading.Thread(target=hold)
    thread.start()
    assert ready.wait(timeout=5), "lock holder never signalled ready"
    return thread


def test_catalog_lock_is_available_after_csv_write_lock_released(tmp_path):
    """A finished csv_write_lock must not wedge every later batch job.

    Under the old split protocol csv_write_lock left ``<csv>.lock`` on disk
    forever and catalog_lock read mere existence as "held", so one web save
    made every extraction job fail permanently — and the advice it printed
    ("delete the lock file") would disarm a live lock.
    """
    csv_path = tmp_path / "catalog.csv"

    with csv_write_lock(str(csv_path)):
        pass

    with catalog_lock(csv_path, "structured_fields"):
        pass

    # ...and repeatedly, in either order.
    with catalog_lock(csv_path, "structured_fields"):
        pass
    with csv_write_lock(str(csv_path), timeout=1):
        pass


def test_csv_write_lock_waits_for_a_held_catalog_lock(tmp_path):
    """A running batch job must block the web/CLI writers.

    The old catalog_lock created a sentinel file but took no flock, so
    csv_write_lock acquired straight through it and both processes could
    os.replace() the catalog concurrently.
    """
    csv_path = tmp_path / "catalog.csv"
    ready, release = threading.Event(), threading.Event()
    holder = _lock_holder_thread(
        lambda: catalog_lock(csv_path, "structured_fields"), ready, release
    )
    try:
        with pytest.raises(TimeoutError):
            with csv_write_lock(str(csv_path), timeout=0.2):
                pass
    finally:
        release.set()
        holder.join(timeout=5)
    assert not holder.is_alive()

    with csv_write_lock(str(csv_path), timeout=2):
        pass


def test_catalog_lock_reports_the_csv_write_lock_holder(tmp_path):
    """A blocked batch job must name who is in the way, not just refuse."""
    csv_path = tmp_path / "catalog.csv"
    ready, release = threading.Event(), threading.Event()
    holder = _lock_holder_thread(
        lambda: csv_write_lock(str(csv_path), job_name="web_save"), ready, release
    )
    try:
        with pytest.raises(CatalogLockedError) as excinfo:
            with catalog_lock(csv_path, "structured_fields"):
                pass
    finally:
        release.set()
        holder.join(timeout=5)

    message = str(excinfo.value)
    assert "web_save" in message
    assert f"pid={os.getpid()}" in message


def test_csv_write_lock_names_the_catalog_lock_holder_on_timeout(tmp_path):
    """The reverse direction: a waiting web writer names the batch job."""
    csv_path = tmp_path / "catalog.csv"
    ready, release = threading.Event(), threading.Event()
    holder = _lock_holder_thread(
        lambda: catalog_lock(csv_path, "merge_llm_results"), ready, release
    )
    try:
        with pytest.raises(TimeoutError) as excinfo:
            with csv_write_lock(str(csv_path), timeout=0.2):
                pass
    finally:
        release.set()
        holder.join(timeout=5)

    assert "merge_llm_results" in str(excinfo.value)


def test_both_entry_points_use_one_lock_file(tmp_path):
    """Same path, or the exclusion above is coincidence."""
    csv_path = tmp_path / "catalog.csv"

    with catalog_lock(csv_path, "probe"):
        pass
    assert lock_path_for(csv_path) == f"{csv_path}.lock"
    assert os.path.exists(lock_path_for(csv_path))


def test_load_project_env_discovers_env_from_cwd(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("BATCH_RUNNER_TEST_VAR=from-cwd\n", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("BATCH_RUNNER_TEST_VAR", raising=False)

    load_project_env()

    import os

    assert os.environ.get("BATCH_RUNNER_TEST_VAR") == "from-cwd"


def test_load_project_env_skips_auto_claude_directories(tmp_path, monkeypatch):
    auto_claude_dir = tmp_path / ".auto-claude" / "nested"
    auto_claude_dir.mkdir(parents=True)
    (tmp_path / ".auto-claude" / ".env").write_text(
        "BATCH_RUNNER_TEST_VAR=from-auto-claude\n", encoding="utf-8"
    )
    monkeypatch.chdir(auto_claude_dir)
    monkeypatch.delenv("BATCH_RUNNER_TEST_VAR", raising=False)

    load_project_env()

    import os

    assert os.environ.get("BATCH_RUNNER_TEST_VAR") is None
