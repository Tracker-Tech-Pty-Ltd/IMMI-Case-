"""Tests for the shared catalog batch-job plumbing."""

from __future__ import annotations

import csv

import pytest

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
    csv_path = tmp_path / "catalog.csv"
    lock_path = csv_path.with_name(csv_path.name + ".lock")

    with pytest.raises(ValueError):
        with catalog_lock(csv_path, "a"):
            raise ValueError("boom")

    assert not lock_path.exists()


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
