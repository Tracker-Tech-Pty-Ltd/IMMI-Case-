"""Exercise real source files, review/cache databases and local catalogues."""
from contextlib import closing
import csv
import hashlib
import json
from pathlib import Path
import sqlite3
from unittest.mock import Mock, patch

import pytest

from immi_case_downloader.csv_repository import CsvRepository
from immi_case_downloader.ingestion import (
    append_discovered_cases, import_local_cases, ledger_path, persist_downloads, record_case_evidence, reuse_case_source, warm_jev_cache,
)
from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.repair_workflow import open_ledger
from immi_case_downloader.sources.austlii import AustLIIScraper
from immi_case_downloader.sources.federal_court import FederalCourtScraper
from immi_case_downloader.sqlite_repository import SqliteRepository
from immi_case_downloader.storage import save_case_text, save_cases_csv, save_cases_json

URL = "https://www.austlii.edu.au/au/cases/cth/FCA/2024/12.html"
BODY = ("Example v Minister [2024] FCA 12\nJUDGE:\nSMITH J\nORDERS:\n"
        "1. The application is dismissed.\nREASONS FOR JUDGMENT\n"
        "The decision under review was the decision to refuse a protection visa.\n"
        + "These are the court's reasons concerning the decision under review.\n" * 12)


def make_case(**values):
    case = ImmigrationCase.from_dict({"citation": "[2024] FCA 12", "url": URL, "title": "Example v Minister", **values})
    case.ensure_id()
    return case


def receipt(base, case):
    with closing(sqlite3.connect(ledger_path(base))) as conn:
        return json.loads(conn.execute("SELECT record FROM intake_reviews WHERE case_id=?", (case.case_id,)).fetchone()[0])


@pytest.mark.parametrize("scraper_type", [AustLIIScraper, FederalCourtScraper])
def test_download_save_then_cache_reuse_without_http_or_source_rewrite(tmp_path, scraper_type):
    scraper = scraper_type(delay=0)
    scraper.source_cache_dir = tmp_path
    scraper.fetch = Mock(return_value=Mock(text=f'<div id="cases_doc"><div id="judgment-content">{BODY}</div></div>'))
    case = make_case(judges="Correct existing judge", user_notes="Keep notes")
    text = scraper.download_case_detail(case)
    path = save_case_text(case, text, str(tmp_path))
    before = Path(path).read_bytes()
    assert case.judges == "Correct existing judge"
    assert case.user_notes == "Keep notes"
    assert receipt(tmp_path, case)["fields"] == []
    retry = make_case(judges="Correct existing judge")
    scraper.fetch = Mock(side_effect=AssertionError("HTTP called despite intact cache"))
    text = scraper.download_case_detail(retry)
    cached = save_case_text(retry, text, str(tmp_path))
    assert Path(cached).read_bytes() == before
    assert hashlib.sha256(Path(cached).read_bytes()).hexdigest() == receipt(tmp_path, retry)["source_sha256"]
    assert retry.outcome and retry.visa_type
    scraper.fetch.assert_not_called()


def test_idempotent_review_skips_parsing_and_database_writes(tmp_path):
    case = make_case()
    save_case_text(case, BODY, str(tmp_path))
    before = ledger_path(tmp_path).read_bytes()
    with patch("immi_case_downloader.ingestion.assess_case", side_effect=AssertionError("repeat parsing")):
        result = record_case_evidence(case, tmp_path)
    assert result["unchanged_evidence_skipped"]
    assert ledger_path(tmp_path).read_bytes() == before
    case.user_notes = "An unrelated new note"
    assert record_case_evidence(case, tmp_path)["unchanged_evidence_skipped"]


@pytest.mark.parametrize("text,status", [(BODY.replace("FCA 12", "FCA 13"), "identity_conflict"),
    ("Example [2024] FCA 12\nJUDGE: SMITH J", "checked"),
    (BODY + "\n[text truncated]", "checked")])
def test_wrong_case_or_short_excerpt_is_not_a_reusable_full_source(tmp_path, text, status):
    case = make_case()
    save_case_text(case, text, str(tmp_path))
    assert receipt(tmp_path, case)["source_status"] == status
    assert reuse_case_source(make_case(), tmp_path) is None


def test_changed_or_missing_cached_bytes_cannot_be_reused(tmp_path):
    case = make_case()
    save_case_text(case, BODY, str(tmp_path))
    with closing(sqlite3.connect(ledger_path(tmp_path))) as conn:
        cached = Path(conn.execute("SELECT path FROM source_cache").fetchone()[0])
    cached.write_text("damaged", encoding="utf-8")
    assert reuse_case_source(make_case(), tmp_path) is None
    cached.unlink()
    assert reuse_case_source(make_case(), tmp_path) is None


def test_conflicting_complete_versions_require_refetch_and_preserve_old_bytes(tmp_path):
    case = make_case()
    path = Path(save_case_text(case, BODY, str(tmp_path)))
    old = path.read_bytes()
    save_case_text(case, BODY + "\nAdditional final reasons.", str(tmp_path))
    assert any(p.read_bytes() == old for p in (tmp_path / ".case-source-cache").glob("*.txt"))
    assert reuse_case_source(make_case(), tmp_path) is None


def test_cache_requires_exact_url_and_citation(tmp_path):
    save_case_text(make_case(), BODY, str(tmp_path))
    assert reuse_case_source(make_case(url=URL + "?different=1"), tmp_path) is None
    assert reuse_case_source(make_case(citation="[2024] FCA 13"), tmp_path) is None


def test_old_file_without_index_can_be_recovered_without_network(tmp_path):
    case = make_case()
    saved = Path(save_case_text(case, BODY, str(tmp_path)))
    saved.rename(saved.parent / "[2024] FCA 12.txt")
    ledger_path(tmp_path).unlink()
    assert reuse_case_source(make_case(), tmp_path)


def test_failure_is_recorded_with_reasons_and_success_replaces_failure(tmp_path):
    scraper = AustLIIScraper(delay=0)
    scraper.source_cache_dir = tmp_path
    scraper.fetch = Mock(return_value=None)
    case = make_case()
    assert scraper.download_case_detail(case) is None
    assert {r["reason_code"] for r in receipt(tmp_path, case)["fields"]} == {"source_missing"}
    save_case_text(case, BODY, str(tmp_path))
    assert {r["fact_status"] for r in receipt(tmp_path, case)["fields"]} == {"candidate_review"}
    assert not case.judges  # Candidates require explicit approval, not confidence.


def test_existing_jev_cache_is_indexed_once_and_bound_to_exact_source(tmp_path):
    case = make_case()
    path = Path(save_case_text(case, BODY, str(tmp_path)))
    cache = tmp_path / "jev.sqlite3"
    with closing(sqlite3.connect(cache)) as conn:
        conn.execute("CREATE TABLE judgments (request_hash,payload,response,model)")
        state = {"citation": case.citation, "public_url": URL, "public_source_sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        for sha, request in [(state["public_source_sha256"], "correct"), ("wrong", "wrong")]:
            conn.execute("INSERT INTO judgments VALUES (?,?,?,?)", (request, json.dumps({"state": {**state, "public_source_sha256": sha}}), json.dumps({"answers": {"visa": "guess"}}), "jev"))
        conn.commit()
    with open_ledger(ledger_path(tmp_path)) as conn:
        conn.execute("INSERT INTO settings VALUES ('jev_cache',?)", (str(cache),))
    assert warm_jev_cache(tmp_path) == 2
    with patch("immi_case_downloader.ingestion.load_jev_cache", side_effect=AssertionError("cache rescanned")):
        result = record_case_evidence(case, tmp_path)
    assert [r["request_hash"] for r in result["jev_cached_advice"]] == ["correct"]
    assert not case.visa_type


@pytest.mark.parametrize("kind", ["csv", "sqlite"])
def test_guarded_persistence_preserves_concurrent_values_notes_deletions_and_backups(tmp_path, kind):
    case, deleted = make_case(user_notes="Original"), make_case(case_id="deleted", url=URL + "deleted")
    if kind == "sqlite":
        repo = SqliteRepository(str(tmp_path / "cases.db"))
        repo.initialize()
        repo.save_many([case, deleted])
    else:
        save_cases_csv([case, deleted], str(tmp_path))
        save_cases_json([case, deleted], str(tmp_path))
        repo = CsvRepository(str(tmp_path))
    originals = {c.case_id: c.to_dict() for c in [case, deleted]}
    repo.update(case.case_id, {"judges": "Concurrent correct judge", "user_notes": "New note"})
    repo.delete(deleted.case_id)
    case.judges, case.visa_type, case.full_text_path = "Downloaded judge", "protection visa", "new-source.txt"
    deleted.full_text_path = "deleted-source.txt"
    persist_downloads(repo, [case, deleted], originals, tmp_path)
    current = repo.get_by_id(case.case_id)
    assert current.judges == "Concurrent correct judge"
    assert current.user_notes == "New note"
    assert current.visa_type == "protection visa"
    assert current.full_text_path == "new-source.txt"
    assert repo.get_by_id(deleted.case_id) is None
    assert list((tmp_path / ".download-backups").iterdir())
    before = (tmp_path / ("cases.db" if kind == "sqlite" else "immigration_cases.csv")).read_bytes()
    assert persist_downloads(repo, [case], originals, tmp_path) == 0
    assert (tmp_path / ("cases.db" if kind == "sqlite" else "immigration_cases.csv")).read_bytes() == before


def test_csv_merge_retains_json_only_rows_envelope_order_unknown_columns(tmp_path):
    case = make_case()
    save_cases_csv([case], str(tmp_path))
    json_path = tmp_path / "immigration_cases.json"
    original = {"special": "keep", "cases": [{**case.to_dict(), "extra": "keep"}, {"case_id": "JSON-only", "extra": 7}]}
    json_path.write_text(json.dumps(original), encoding="utf-8")
    before = case.to_dict()
    case.full_text_path = "new.txt"
    persist_downloads(CsvRepository(str(tmp_path)), [case], {case.case_id: before}, tmp_path)
    data = json.loads(json_path.read_text(encoding="utf-8"))
    assert data["special"] == "keep"
    assert [r["case_id"] for r in data["cases"]] == [case.case_id, "JSON-only"]
    assert data["cases"][0]["extra"] == "keep"
    assert data["cases"][1] == original["cases"][1]


def test_intake_preserves_prior_na_and_relationship_hold(tmp_path):
    case = make_case()
    save_case_text(case, BODY, str(tmp_path))
    sha = receipt(tmp_path, case)["source_sha256"]
    with open_ledger(ledger_path(tmp_path)) as conn:
        for field, values in [("visa_type", {"fact_status": "not_applicable", "reason": "Confirmed N/A"}),
                              ("judges", {"reason": "來源錯配，待核對"})]:
            conn.execute("INSERT INTO prior_status VALUES (?,?,?)", (case.case_id, field, json.dumps({"source_sha256": sha, **values})))
    fields = {r["field"]: r for r in record_case_evidence(case, tmp_path)["fields"]}
    assert fields["visa_type"]["fact_status"] == "not_applicable"
    assert fields["judges"]["fact_status"] == "waiting_new_evidence"
    assert fields["judges"]["evidence"] is None


def test_arbitrary_file_path_is_not_read_as_case_evidence(tmp_path):
    base = tmp_path / "output"
    base.mkdir()
    source = tmp_path / "private.txt"
    source.write_text(BODY, encoding="utf-8")
    result = record_case_evidence(make_case(full_text_path=str(source)), base)
    assert result["source_status"] == "source_missing"


def test_custom_unsafe_upsert_repository_is_refused(tmp_path):
    repo = Mock(spec=["save_many"])
    case = make_case()
    with pytest.raises(TypeError, match="atomic merge_downloads"):
        persist_downloads(repo, [case], {case.case_id: case.to_dict()}, tmp_path)
    repo.save_many.assert_not_called()


@pytest.mark.parametrize("bulk", [False, True])
@pytest.mark.parametrize("kind", ["csv", "sqlite"])
def test_web_job_download_to_catalogue_and_intake_then_rerun(tmp_path, bulk, kind):
    from immi_case_downloader.web import jobs
    case = make_case(judges="Existing judge", user_notes="Keep")
    if kind == "sqlite":
        repo = SqliteRepository(str(tmp_path / "cases.db"))
        repo.initialize()
        repo.save_many([case])
    else:
        save_cases_csv([case], str(tmp_path))
        save_cases_json([case], str(tmp_path))
        repo = CsvRepository(str(tmp_path))
    run = (lambda: jobs._run_bulk_download_job("", 10, 0, str(tmp_path), repo=repo)) if bulk else (
        lambda: jobs._run_download_job("", 10, str(tmp_path), repo=repo))
    with patch.object(AustLIIScraper, "fetch", return_value=Mock(text=f'<div id="cases_doc">{BODY}</div>')) as fetch:
        run()
        assert jobs._job_status["errors"] == []
        assert fetch.call_count == 1
    current = repo.get_by_id(case.case_id)
    assert current.judges == "Existing judge"
    assert current.visa_type == "protection visa"
    assert Path(current.full_text_path).is_file()
    assert receipt(tmp_path, current)["source_sha256"]
    with patch.object(AustLIIScraper, "fetch", side_effect=AssertionError("rerun HTTP")) as fetch:
        run()
        fetch.assert_not_called()


def test_legacy_bulk_repairs_nonempty_missing_path_and_keeps_concurrent_edits(tmp_path, monkeypatch):
    import download_fulltext
    import pandas as pd
    case = make_case(full_text_path=str(tmp_path / "gone.txt"), user_notes="Keep")
    save_cases_csv([case], str(tmp_path))
    save_cases_json([case], str(tmp_path))
    path = tmp_path / "immigration_cases.csv"
    monkeypatch.setattr(download_fulltext, "CSV_PATH", str(path))
    monkeypatch.setattr(download_fulltext, "LOG_FILE", str(tmp_path / "progress.log"))
    repo = CsvRepository(str(tmp_path))
    scraper = AustLIIScraper(delay=0)

    def response(_url):
        repo.update(case.case_id, {"user_notes": "Concurrent note", "judges": "Concurrent judge"})
        return Mock(text=f'<div id="cases_doc">{BODY}</div>')

    scraper.fetch = Mock(side_effect=response)
    download_fulltext.download_missing_fulltext(scraper, pd.read_csv(path, dtype=str))
    current = repo.get_by_id(case.case_id)
    assert current.user_notes == "Concurrent note"
    assert current.judges == "Concurrent judge"
    assert current.visa_type == "protection visa"
    assert Path(current.full_text_path).is_file()
    assert scraper.fetch.call_count == 1


def test_legacy_resume_updates_persistence_without_refetch(tmp_path, monkeypatch):
    import download_fulltext
    import pandas as pd
    case = make_case()
    save_case_text(case, BODY, str(tmp_path))
    case.full_text_path = ""
    save_cases_csv([case], str(tmp_path))
    save_cases_json([case], str(tmp_path))
    path = tmp_path / "immigration_cases.csv"
    monkeypatch.setattr(download_fulltext, "CSV_PATH", str(path))
    monkeypatch.setattr(download_fulltext, "LOG_FILE", str(tmp_path / "progress.log"))
    scraper = AustLIIScraper(delay=0)
    scraper.fetch = Mock(side_effect=AssertionError("resume HTTP"))
    download_fulltext.download_missing_fulltext(scraper, pd.read_csv(path, dtype=str))
    assert Path(CsvRepository(str(tmp_path)).get_by_id(case.case_id).full_text_path).is_file()
    scraper.fetch.assert_not_called()


def test_review_export_is_available_before_database_import(tmp_path):
    import subprocess
    import sys
    case = make_case()
    save_case_text(case, BODY, str(tmp_path))
    output = tmp_path / "report"
    subprocess.run([sys.executable, "-X", "utf8", "-B", "scripts/review_download_intake.py", "--base-dir", str(tmp_path), "--output", str(output)], check=True, capture_output=True)
    with (output / "remaining-fields.csv").open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 3
    assert {r["fact_status"] for r in rows} == {"candidate_review"}
    assert all(r["reason"] and r["source_sha256"] for r in rows)


def test_import_fills_blanks_preserves_correct_values_local_rows_and_reviews_actual_row(tmp_path):
    repo = SqliteRepository(str(tmp_path / "cases.db"))
    stored = make_case(judges="Correct original judge", user_notes="Correct note")
    local = make_case(case_id="local-only", url="", citation="[2024] FCA 99")
    repo.save_many([stored, local])
    incoming = make_case(judges="Wrong incoming judge", user_notes="Stale note", visa_type="protection visa")
    save_case_text(incoming, BODY, str(tmp_path))
    original_csv_path = incoming.full_text_path
    result = import_local_cases(repo, [incoming], tmp_path)
    actual = repo.get_by_id(stored.case_id)
    assert actual.judges == "Correct original judge"
    assert actual.user_notes == "Correct note"
    assert actual.visa_type == "protection visa"
    assert actual.full_text_path == original_csv_path
    assert repo.get_by_id("local-only")
    assert [r["field"] for r in receipt(tmp_path, actual)["fields"]] == ["outcome"]
    assert result["changed_rows"] == 1
    assert result["backup"]
    assert result["conflicts"][0]["field"] == "judges"
    again = import_local_cases(repo, [incoming], tmp_path)
    assert again["changed_rows"] == 0
    assert again["backup"] == ""


def test_import_tracks_no_source_and_rejects_identity_conflicts(tmp_path):
    repo = SqliteRepository(str(tmp_path / "cases.db"))
    case = make_case()
    assert import_local_cases(repo, [case], tmp_path)["changed_rows"] == 1
    assert {r["reason_code"] for r in receipt(tmp_path, case)["fields"]} == {"source_missing"}
    mismatch = make_case(case_id=case.case_id, citation="[2024] FCA 13", judges="Wrong")
    duplicate = make_case(case_id="different-id")
    result = import_local_cases(repo, [mismatch, duplicate], tmp_path)
    assert result["changed_rows"] == 0
    assert {r["reason"] for r in result["conflicts"]} == {"identity_conflict", "url_already_has_another_case_id"}
    assert not repo.get_by_id(case.case_id).judges


def test_import_command_preserves_sqlite_only_rows(tmp_path):
    import subprocess
    import sys
    case = make_case()
    save_cases_csv([case], str(tmp_path))
    repo = SqliteRepository(str(tmp_path / "cases.db"))
    repo.save_many([make_case(case_id="local", url="", citation="[2024] FCA 99")])
    result = subprocess.run([sys.executable, "-X", "utf8", "-B", "migrate_csv_to_sqlite.py", "--output", str(tmp_path)], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert len(repo.load_all()) == 2
    assert json.loads((tmp_path / ".last-import-review.json").read_text())["changed_rows"] == 1


def test_discovery_keeps_current_rows_unknown_data_and_records_new_case(tmp_path):
    case = make_case(user_notes="Concurrent note")
    save_cases_csv([case], str(tmp_path))
    json_path = tmp_path / "immigration_cases.json"
    json_path.write_text(json.dumps({"extra": "keep", "cases": [case.to_dict(), {"case_id": "json-only"}]}), encoding="utf-8")
    duplicate = make_case(user_notes="Stale snapshot")
    fresh = make_case(citation="[2024] FCA 13", url=URL.replace("12.html", "13.html"))
    assert append_discovered_cases([duplicate, fresh], tmp_path) == 1
    assert CsvRepository(str(tmp_path)).get_by_id(case.case_id).user_notes == "Concurrent note"
    exported = json.loads(json_path.read_text(encoding="utf-8"))
    assert exported["extra"] == "keep"
    assert [row["case_id"] for row in exported["cases"]] == [case.case_id, "json-only", fresh.case_id]
    assert {r["reason_code"] for r in receipt(tmp_path, fresh)["fields"]} == {"source_missing"}
    before = (tmp_path / "immigration_cases.csv").read_bytes()
    assert append_discovered_cases([fresh], tmp_path) == 0
    assert (tmp_path / "immigration_cases.csv").read_bytes() == before


def test_changed_original_uses_new_path_and_identical_save_does_not_rewrite(tmp_path):
    case = make_case()
    path = Path(save_case_text(case, BODY, str(tmp_path)))
    before, modified = path.read_bytes(), path.stat().st_mtime_ns
    assert save_case_text(case, BODY, str(tmp_path)) == str(path)
    assert path.stat().st_mtime_ns == modified
    changed = Path(save_case_text(case, BODY + "\nFurther reasons", str(tmp_path)))
    assert changed != path
    assert path.read_bytes() == before
    assert changed.is_file()


def test_catalogue_review_roundtrips_fact_status_na_export(tmp_path):
    from immi_case_downloader.repair_workflow import review_catalogue
    data = tmp_path / "downloaded_cases"
    data.mkdir()
    case = make_case()
    path = Path(save_case_text(case, BODY, str(data)))
    repo = SqliteRepository(str(data / "cases.db"))
    repo.save_many([case])
    prior = tmp_path / "prior.csv"
    with prior.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["case_id", "field", "fact_status", "reason", "source_sha256"])
        writer.writeheader()
        writer.writerow({"case_id": case.case_id, "field": "visa_type", "fact_status": "not_applicable",
                         "reason": "Previously verified N/A", "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    output = tmp_path / "report"
    review_catalogue(tmp_path, output, ledger=ledger_path(data), prior_status=prior)
    fields = {r["field"]: r for r in json.loads((output / "review.json").read_text(encoding="utf-8"))}
    assert fields["visa_type"]["fact_status"] == "not_applicable"
    assert fields["visa_type"]["evidence"] is None
