from __future__ import annotations

import importlib.util
import sqlite3
import sys
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_cloudflare_catalog_capacity.py"
SPEC = importlib.util.spec_from_file_location("catalog_capacity", SCRIPT)
assert SPEC and SPEC.loader
catalog_capacity = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = catalog_capacity
SPEC.loader.exec_module(catalog_capacity)


def create_database(path: Path, payload: str) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.execute("CREATE TABLE cases (case_id TEXT PRIMARY KEY, title TEXT, content TEXT)")
        connection.execute("CREATE VIRTUAL TABLE case_text_fts USING fts5(case_id UNINDEXED, content)")
        connection.execute("INSERT INTO cases VALUES ('case-1', 'Title', ?)", (payload,))
        connection.execute("INSERT INTO case_text_fts VALUES ('case-1', ?)", (payload,))
        connection.commit()
    finally:
        connection.close()


def test_capacity_gate_accepts_small_catalog(tmp_path: Path):
    database = tmp_path / "catalog.sqlite"
    create_database(database, "small")

    report = catalog_capacity.inspect_catalog(database)

    assert report.ok
    assert report.headroom_percent > 99.0
    assert report.tables == [
        catalog_capacity.TableMeasurement(
            name="cases", rows=1, max_materialized_row_bytes=len("case-1Titlesmall")
        )
    ]


def test_capacity_gate_rejects_oversized_materialized_row(tmp_path: Path):
    database = tmp_path / "catalog.sqlite"
    create_database(database, "x" * 1024)

    report = catalog_capacity.inspect_catalog(database, max_row_bytes=512)

    assert not report.ok
    assert report.headroom_percent > 0
    assert any("cases row" in violation for violation in report.violations)
