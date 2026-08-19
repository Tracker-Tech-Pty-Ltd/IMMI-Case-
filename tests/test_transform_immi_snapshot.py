from __future__ import annotations

import json
import hashlib
import sqlite3
from pathlib import Path

from scripts.reconcile_immi_transform import inspect, read_rows
from scripts.transform_immi_snapshot import load_rows, main


CASE_ID = "0123456789ab"
USER_ID = "11111111-2222-4333-8444-555555555555"
TENANT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
SESSION_ID = "AbCdEfGhIjKlMnOpQrStU"
TURN_ID = "TuSrQpOnMlKjIhGfEdCbA"


def write_rows(snapshot: Path, table: str, rows: list[dict]) -> None:
    path = snapshot / "tables" / f"{table}.ndjson"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def test_transform_and_reconcile_read_chunked_export_parts(tmp_path: Path) -> None:
    snapshot = tmp_path / "snapshot"
    table_dir = snapshot / "tables" / "immi_users"
    table_dir.mkdir(parents=True)
    (table_dir / "part-000002.ndjson").write_text('{"id": "second"}\n', encoding="utf-8")
    (table_dir / "part-000001.ndjson").write_text('{"id": "first"}\n', encoding="utf-8")

    assert load_rows(snapshot, "immi_users") == [{"id": "first"}, {"id": "second"}]
    assert read_rows(snapshot, "immi_users") == [{"id": "first"}, {"id": "second"}]


def test_transform_builds_d1_r2_mirrors_and_row_manifests(tmp_path: Path) -> None:
    snapshot = tmp_path / "snapshot"
    (snapshot / "artifacts" / "cases").mkdir(parents=True)
    (snapshot / "artifacts" / "cases" / f"{CASE_ID}.txt").write_text("The canonical case text", encoding="utf-8")
    write_rows(snapshot, "immigration_cases", [{
        "case_id": CASE_ID,
        "citation": "[2026] FCA 1",
        "title": "Example v Minister",
        "court": "Federal Court",
        "court_code": "FCA",
        "year": 2026,
        "visa_subclass": "482",
        "case_nature": "Protection",
        "visa_outcome_reason": "Procedural fairness",
        "legal_test_applied": "Natural justice",
        "judges": "Justice Example",
        "legal_concepts": "procedural fairness; jurisdictional error",
    }])
    write_rows(snapshot, "immi_tenants", [{"id": TENANT_ID, "kind": "organization", "name": "Example Pty"}])
    write_rows(snapshot, "immi_users", [{"id": USER_ID, "telegram_id": 123456, "first_name": "Ada", "primary_tenant_id": TENANT_ID}])
    write_rows(snapshot, "immi_tenant_members", [{"tenant_id": TENANT_ID, "user_id": USER_ID, "role": "owner"}])
    write_rows(snapshot, "immi_collections", [{
        "id": "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
        "tenant_id": TENANT_ID,
        "created_by": USER_ID,
        "name": "Example cases",
        "case_ids": [CASE_ID],
    }])
    write_rows(snapshot, "judge_bios", [{
        "id": "justice-example",
        "full_name": "Justice Example",
        "role": "Judge",
        "education": ["Example University"],
    }])
    write_rows(snapshot, "council_sessions", [{
        "session_id": SESSION_ID,
        "tenant_id": TENANT_ID,
        "created_by": USER_ID,
        "title": "Example Council",
        "retrieve_code": "ABC234",
        "total_turns": 1,
    }])
    write_rows(snapshot, "council_turns", [{
        "turn_id": TURN_ID,
        "session_id": SESSION_ID,
        "turn_index": 0,
        "user_message": "What is the issue?",
        "payload": {"opinions": []},
    }])

    output = tmp_path / "output"
    assert main([str(snapshot), str(output)]) == 0

    catalog = sqlite3.connect(output / "catalog.sqlite")
    try:
        row = catalog.execute("SELECT case_id, content_key, semantic_ready FROM cases").fetchone()
        assert row[0] == CASE_ID
        assert row[2] == 0
        assert catalog.execute("SELECT visa_outcome_reason, legal_test_applied FROM cases").fetchone() == (
            "Procedural fairness", "Natural justice"
        )
        assert (output / "r2" / row[1]).read_text(encoding="utf-8") == "The canonical case text"
        assert catalog.execute("SELECT COUNT(*) FROM case_text_fts").fetchone()[0] == 1
        assert catalog.execute("SELECT COUNT(*) FROM case_judges").fetchone()[0] == 1
        assert catalog.execute("SELECT COUNT(*) FROM case_concepts").fetchone()[0] == 2
        assert catalog.execute("SELECT COUNT(*) FROM case_visas").fetchone()[0] == 1
        assert catalog.execute("SELECT case_count FROM aggregate_court_year_outcome").fetchone()[0] == 1
        assert catalog.execute("SELECT case_count FROM aggregate_scope").fetchone()[0] == 1
        assert catalog.execute("SELECT case_count FROM aggregate_court_nature_outcome").fetchone()[0] == 1
        assert catalog.execute("SELECT case_count FROM aggregate_concept_scope").fetchone()[0] == 1
        assert catalog.execute("SELECT case_count FROM aggregate_concept_pair").fetchone()[0] == 1
        assert catalog.execute("SELECT case_count FROM aggregate_judge_outcome").fetchone()[0] == 1
        assert catalog.execute("SELECT case_count FROM aggregate_judge_year").fetchone()[0] == 1
        assert catalog.execute("SELECT case_count FROM aggregate_judge_visa").fetchone()[0] == 1
        assert catalog.execute("SELECT option_value FROM filter_options WHERE filter_name = 'court'").fetchone()[0] == "FCA"
        source_bio_id, key, checksum = catalog.execute(
            "SELECT source_bio_id, bio_key, bio_sha256 FROM judges WHERE source_bio_id IS NOT NULL"
        ).fetchone()
        assert source_bio_id == "justice-example"
        assert key.startswith("judges/")
        assert len(checksum) == 64
        assert json.loads((output / "r2" / key).read_text(encoding="utf-8"))["full_name"] == "Justice Example"
    finally:
        catalog.close()
    account = sqlite3.connect(output / "account.sqlite")
    try:
        assert account.execute("SELECT kind FROM tenants WHERE tenant_id = ?", (TENANT_ID,)).fetchone()[0] == "organisation"
        assert account.execute("SELECT role FROM memberships WHERE user_id = ?", (USER_ID,)).fetchone()[0] == "owner"
        assert account.execute("SELECT primary_tenant_id FROM users WHERE user_id = ?", (USER_ID,)).fetchone()[0] == TENANT_ID
        assert account.execute("SELECT COUNT(*) FROM collection_items").fetchone()[0] == 1
        assert account.execute("SELECT retrieve_code FROM council_sessions WHERE session_id = ?", (SESSION_ID,)).fetchone()[0] == "ABC234"
        assert account.execute("SELECT COUNT(*) FROM council_turns WHERE session_id = ?", (SESSION_ID,)).fetchone()[0] == 1
    finally:
        account.close()
    manifest = json.loads((output / "transform-manifest.json").read_text(encoding="utf-8"))
    assert manifest["target_counts"]["immigration_cases"] == 1
    assert manifest["target_counts"]["judge_bios"] == 1
    assert manifest["vectorize"]["status"] == "pending"
    assert manifest["vectorize"]["expected_ids"] == 1
    assert json.loads((output / "vectorize/expected-ids.ndjson").read_text()) ["id"] == CASE_ID
    assert (output / "source-row-manifests" / "immigration_cases.ndjson").is_file()
    assert inspect(snapshot, output).ok
    vector_ids = tmp_path / "vectorize-ids.ndjson"
    vector_ids.write_text(json.dumps({"id": CASE_ID}) + "\n", encoding="utf-8")
    assert inspect(snapshot, output, vector_ids).ok
    vector_ids.write_text(json.dumps({"id": "abcdefabcdef"}) + "\n", encoding="utf-8")
    vector_report = inspect(snapshot, output, vector_ids)
    assert vector_report.vector_missing == [CASE_ID]
    assert vector_report.vector_extra == ["abcdefabcdef"]

    catalog = sqlite3.connect(output / "catalog.sqlite")
    try:
        catalog.execute("DELETE FROM case_judges")
        catalog.commit()
    finally:
        catalog.close()
    relation_report = inspect(snapshot, output)
    judge_id = hashlib.sha256("judge:justice example".encode()).hexdigest()[:32]
    assert relation_report.relation_missing == [f"case_judges:{CASE_ID}:{judge_id}"]


def test_reconciliation_rejects_missing_r2_object(tmp_path: Path) -> None:
    snapshot = tmp_path / "snapshot"
    (snapshot / "artifacts" / "cases").mkdir(parents=True)
    (snapshot / "artifacts" / "cases" / f"{CASE_ID}.txt").write_text("The canonical case text", encoding="utf-8")
    write_rows(snapshot, "immigration_cases", [{"case_id": CASE_ID, "title": "Example"}])
    output = tmp_path / "output"
    assert main([str(snapshot), str(output)]) == 0
    catalog = sqlite3.connect(output / "catalog.sqlite")
    try:
        key = catalog.execute("SELECT content_key FROM cases").fetchone()[0]
    finally:
        catalog.close()
    (output / "r2" / key).unlink()
    report = inspect(snapshot, output)
    assert not report.ok
    assert report.missing == [f"r2:{key}"]


def test_transform_carries_legislation_artifacts_with_r2_checksums(tmp_path: Path) -> None:
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir()
    legislation = tmp_path / "legislations.json"
    legislation.write_text(json.dumps({
        "legislations": [{"id": "migration-act-1958", "title": "Migration Act 1958", "sections": [{"id": "s1", "text": "Short title"}]}],
    }), encoding="utf-8")
    output = tmp_path / "output"
    assert main([str(snapshot), str(output), "--legislation-json", str(legislation)]) == 0
    key = output / "r2" / "legislations/migration-act-1958.json"
    assert key.is_file()
    assert inspect(snapshot, output).ok
    key.unlink()
    report = inspect(snapshot, output)
    assert report.missing == ["r2:legislations/migration-act-1958.json"]


def test_transform_rejects_nonempty_staging_before_creating_output(tmp_path: Path) -> None:
    snapshot = tmp_path / "snapshot"
    write_rows(snapshot, "immigration_cases_staging", [{"case_id": CASE_ID}])
    output = tmp_path / "output"

    assert main([str(snapshot), str(output)]) == 2
    assert not output.exists()
