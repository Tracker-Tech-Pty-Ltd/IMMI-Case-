"""Local CSV/API/lifecycle regressions; every file lives under tmp_path."""

import csv
import threading
from argparse import Namespace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from immi_case_downloader import cli
from immi_case_downloader.csv_write_lock import csv_write_lock
from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.pipeline import PipelineConfig, SmartPipeline
from immi_case_downloader.storage import (
    CASE_FIELDS,
    CASES_CSV,
    ensure_output_dirs,
    load_all_cases,
    save_cases_csv,
)


def _case(number, **values):
    case = ImmigrationCase.from_dict({
        "citation": f"[2024] AATA {number}",
        "title": f"Applicant {number} v Minister",
        "url": f"https://example.invalid/{number}",
        "court_code": "AATA",
        "source": "AustLII",
        **values,
    })
    case.ensure_id()
    return case


def _write_as_another_process(output, cases):
    """Commit real rows without touching this process's in-memory cache."""
    path = Path(output) / CASES_CSV
    with csv_write_lock(path):
        with path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=CASE_FIELDS)
            writer.writeheader()
            writer.writerows(case.to_dict() for case in cases)


def _read_disk(output):
    return {case.case_id: case for case in load_all_cases(str(output), use_cache=False)}


def _args(output, **values):
    return Namespace(
        output=str(output), sources=["austlii"], databases=["AATA"],
        start_year=2024, end_year=2024, max_results=10, delay=0,
        courts=None, limit=1, **values,
    )


def test_cli_download_preserves_concurrent_add_edit_and_delete(tmp_path):
    original = _case(1, citation="", user_notes="old note", judges="Original judge")
    deleted = _case(2)
    added = _case(3, user_notes="new record")
    ensure_output_dirs(str(tmp_path))
    save_cases_csv([original, deleted], str(tmp_path))

    def download(target):
        edited = ImmigrationCase.from_dict(original.to_dict())
        edited.user_notes = "saved while downloading"
        edited.judges = "Manually corrected judge"
        _write_as_another_process(tmp_path, [edited, added])
        target.judges = "Scraped judge"
        target.outcome = "Allowed"
        target.citation = "[2024] AATA 101"
        return "Complete judgment body"

    with patch.object(cli, "AustLIIScraper") as scraper:
        scraper.return_value.download_case_detail.side_effect = download
        cli.cmd_download(_args(tmp_path))

    stored = _read_disk(tmp_path)
    assert set(stored) == {original.case_id, added.case_id}
    assert stored[original.case_id].user_notes == "saved while downloading"
    assert stored[original.case_id].judges == "Manually corrected judge"
    assert stored[original.case_id].outcome == "Allowed"
    # Intake preserves the catalog identity; downloads fill factual gaps only.
    assert stored[original.case_id].citation == original.citation
    assert Path(stored[original.case_id].full_text_path).read_text().endswith(
        "Complete judgment body"
    )


def test_cli_search_merges_onto_disk_instead_of_its_warm_cache(tmp_path):
    original = _case(1, user_notes="old note")
    added_elsewhere = _case(2)
    discovered = _case(3)
    ensure_output_dirs(str(tmp_path))
    save_cases_csv([original], str(tmp_path))
    load_all_cases(str(tmp_path))

    def search(**kwargs):
        edited = ImmigrationCase.from_dict(original.to_dict())
        edited.user_notes = "saved by another process"
        _write_as_another_process(tmp_path, [edited, added_elsewhere])
        return [discovered]

    with patch.object(cli, "AustLIIScraper") as scraper:
        scraper.return_value.search_cases.side_effect = search
        cli.cmd_search(_args(tmp_path))

    stored = _read_disk(tmp_path)
    assert set(stored) == {original.case_id, added_elsewhere.case_id, discovered.case_id}
    assert stored[original.case_id].user_notes == "saved by another process"


@pytest.mark.parametrize("command", ["search", "download"])
def test_cli_writer_obeys_the_shared_catalog_lock(tmp_path, monkeypatch, command):
    original = _case(1)
    ensure_output_dirs(str(tmp_path))
    save_cases_csv([original], str(tmp_path))

    def impatient(path, **kwargs):
        return csv_write_lock(path, timeout=0.05, **kwargs)

    monkeypatch.setattr(cli, "csv_write_lock", impatient, raising=False)
    # Downloads share the storage writer's lock rather than holding it during HTTP.
    monkeypatch.setattr("immi_case_downloader.csv_write_lock.csv_write_lock", impatient)
    with patch.object(cli, "AustLIIScraper") as scraper:
        scraper.return_value.search_cases.return_value = [_case(2)]
        scraper.return_value.download_case_detail.return_value = "Complete body"
        with csv_write_lock(tmp_path / CASES_CSV):
            with pytest.raises(TimeoutError):
                getattr(cli, f"cmd_{command}")(_args(tmp_path))
    assert set(_read_disk(tmp_path)) == {original.case_id}


def test_pipeline_clean_preserves_external_changes_after_cache_warmup(tmp_path):
    original = _case(1, year=0, user_notes="old note")
    added = _case(2, year=2024)
    ensure_output_dirs(str(tmp_path))
    save_cases_csv([original], str(tmp_path))
    load_all_cases(str(tmp_path))
    edited = ImmigrationCase.from_dict(original.to_dict())
    edited.user_notes = "new note from another process"
    _write_as_another_process(tmp_path, [edited, added])

    pipeline = SmartPipeline(PipelineConfig(download_enabled=False), str(tmp_path))
    pipeline._run_clean_phase()

    stored = _read_disk(tmp_path)
    assert set(stored) == {original.case_id, added.case_id}
    assert stored[original.case_id].user_notes == "new note from another process"
    assert stored[original.case_id].year == 2024


def test_pipeline_download_merges_metadata_without_reverting_external_changes(tmp_path):
    original = _case(1, citation="", user_notes="old note", judges="Original judge")
    deleted = _case(2)
    added = _case(3)
    ensure_output_dirs(str(tmp_path))
    save_cases_csv([original, deleted], str(tmp_path))
    load_all_cases(str(tmp_path))

    def download(target):
        edited = ImmigrationCase.from_dict(original.to_dict())
        edited.user_notes = "new note from another process"
        edited.judges = "Manually corrected judge"
        _write_as_another_process(tmp_path, [edited, added])
        target.judges = "Scraped judge"
        target.outcome = "Allowed"
        target.citation = "[2024] AATA 101"
        return "Complete pipeline judgment"

    pipeline = SmartPipeline(
        PipelineConfig(download_enabled=True, download_batch_size=1), str(tmp_path)
    )
    with patch("immi_case_downloader.sources.austlii.AustLIIScraper") as scraper:
        scraper.return_value.download_case_detail.side_effect = download
        pipeline._run_download_phase()

    stored = _read_disk(tmp_path)
    assert set(stored) == {original.case_id, added.case_id}
    assert stored[original.case_id].user_notes == "new note from another process"
    assert stored[original.case_id].judges == "Manually corrected judge"
    assert stored[original.case_id].outcome == "Allowed"
    assert stored[original.case_id].citation == original.citation
    assert Path(stored[original.case_id].full_text_path).read_text().endswith(
        "Complete pipeline judgment"
    )


_EXTENDED_EDITS = {
    "visa_subclass": "500", "visa_class_code": "TU",
    "applicant_name": "Corrected applicant", "respondent": "Minister",
    "country_of_origin": "India", "visa_subclass_number": "500",
    "hearing_date": "15 October 2026", "is_represented": "Yes",
    "representative": "Example solicitor",
}


@pytest.mark.parametrize("backend", ["csv", "sqlite"])
def test_api_persists_each_extended_edit_without_a_title_update(tmp_path, backend):
    from immi_case_downloader.web import close_app, create_app

    app = create_app(str(tmp_path), backend=backend)
    app.config.update(TESTING=True, WTF_CSRF_ENABLED=False, RATELIMIT_ENABLED=False)
    app.extensions["immi_warmup_stop_event"].set()
    app.extensions["immi_warmup_thread"].join(timeout=5)
    original = _case(1)
    app.config["REPO"].add(original)
    try:
        with app.test_client() as client:
            for field, value in _EXTENDED_EDITS.items():
                response = client.put(
                    f"/api/v1/cases/{original.case_id}", json={field: value}
                )
                assert response.status_code == 200, (field, response.get_json())
                assert response.get_json()["case"][field] == value
                persisted = client.get(f"/api/v1/cases/{original.case_id}")
                assert persisted.get_json()["case"][field] == value
        if backend == "csv":
            stored = _read_disk(tmp_path)[original.case_id]
        else:
            from immi_case_downloader.sqlite_repository import SqliteRepository

            independent = SqliteRepository(str(tmp_path / "cases.db"))
            try:
                stored = independent.get_by_id(original.case_id)
            finally:
                independent.close()
        for field, value in _EXTENDED_EDITS.items():
            assert getattr(stored, field) == value
    finally:
        close_app(app, wait=True)
        close_repository = getattr(app.config["REPO"], "close", None)
        if close_repository:
            close_repository()


def test_supabase_update_accepts_extended_edits_and_rejects_sensitive_fields():
    from immi_case_downloader.supabase_repository import SupabaseRepository

    repo = object.__new__(SupabaseRepository)
    repo._client = MagicMock()
    query = repo._client.table.return_value
    query.update.return_value.eq.return_value.execute.return_value = SimpleNamespace(
        data=[{"case_id": "aaaaaaaaaaaa", **_EXTENDED_EDITS}]
    )
    assert repo.update("aaaaaaaaaaaa", {
        **_EXTENDED_EDITS, "case_id": "changed", "source": "changed",
        "full_text_path": "/outside.txt",
    })
    query.update.assert_called_once_with(_EXTENDED_EDITS)


def test_close_app_cannot_miss_warmup_finishing_during_close(tmp_path, monkeypatch):
    from immi_case_downloader.web import close_app, create_app
    from immi_case_downloader.web.routes import api

    entered = threading.Event()
    release = threading.Event()

    def fill_stats():
        entered.set()
        assert release.wait(timeout=10), "warmup was not released"

    monkeypatch.setattr(api, "_fill_stats_cache", fill_stats)
    monkeypatch.setattr(api, "_fill_analytics_cases_cache", lambda: None)
    monkeypatch.setattr(api, "_fill_analytics_cache", lambda app: None)
    app = create_app(str(tmp_path), backend="csv")
    executor = app.extensions["immi_rpc_executor"]
    warmup = app.extensions["immi_warmup_thread"]

    class FinishDuringObservation:
        """Freeze the legal interleaving that previously lost shutdown ownership."""

        def is_alive(self):
            alive_at_entry = warmup.is_alive()
            release.set()
            warmup.join(timeout=5)
            assert not warmup.is_alive()
            return alive_at_entry

        def join(self):
            warmup.join(timeout=5)

    try:
        assert entered.wait(timeout=5), "warmup did not reach the controlled operation"
        assert executor.submit(lambda: "started").result(timeout=2) == "started"
        app.extensions["immi_warmup_thread"] = FinishDuringObservation()
        close_app(app)
        release.set()
        warmup.join(timeout=5)
        assert not warmup.is_alive()
        with pytest.raises(RuntimeError, match="shutdown"):
            executor.submit(lambda: "must not run")
        assert not app.extensions["immi_rpc_executor_finalizer"].alive
    finally:
        release.set()
        warmup.join(timeout=5)
        executor.shutdown(wait=True, cancel_futures=True)
