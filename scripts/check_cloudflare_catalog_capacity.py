#!/usr/bin/env python3
"""Fail-closed capacity gate for a transformed local IMMI catalog SQLite DB.

Run this only after a local transform/import has completed. It measures both
the SQLite logical size and sidecar files, and rejects any materialized table
row over the migration's 256 KiB safety budget. Passing this gate is required
before an operator creates the production IMMI_CATALOG_DB resource.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


GIB = 1024**3
DEFAULT_MAX_DATABASE_BYTES = 8 * GIB
DEFAULT_MAX_ROW_BYTES = 256 * 1024


@dataclass(frozen=True)
class TableMeasurement:
    name: str
    rows: int
    max_materialized_row_bytes: int


@dataclass(frozen=True)
class CapacityReport:
    database: str
    logical_bytes: int
    physical_bytes: int
    headroom_percent: float
    max_database_bytes: int
    max_row_bytes: int
    tables: list[TableMeasurement]
    violations: list[str]

    @property
    def ok(self) -> bool:
        return not self.violations


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def database_files_size(path: Path) -> int:
    return sum(
        candidate.stat().st_size
        for candidate in (path, Path(f"{path}-wal"), Path(f"{path}-shm"))
        if candidate.exists()
    )


def table_measurements(connection: sqlite3.Connection) -> list[TableMeasurement]:
    rows = connection.execute(
        """
        SELECT name, sql
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
        """
    ).fetchall()
    virtual_names = {
        name
        for name, create_sql in rows
        if create_sql and "VIRTUAL TABLE" in create_sql.upper()
    }
    internal_names = {"_cf_METADATA", "d1_migrations"}
    measurements: list[TableMeasurement] = []
    for name, create_sql in rows:
        # FTS5 virtual tables keep their materialized source in case_text_chunks.
        # Measuring the virtual index as if it were an application row produces a
        # false capacity failure and does not answer the D1 row-size question.
        if (
            name in internal_names
            or name in virtual_names
            or any(name.startswith(f"{virtual_name}_") for virtual_name in virtual_names)
        ):
            continue
        columns = [item[1] for item in connection.execute(f"PRAGMA table_info({quote_identifier(name)})")]
        if not columns:
            continue
        expression = " + ".join(
            f"COALESCE(length(CAST({quote_identifier(column)} AS BLOB)), 0)"
            for column in columns
        )
        table = quote_identifier(name)
        row_count, max_bytes = connection.execute(
            f"SELECT COUNT(*), COALESCE(MAX({expression}), 0) FROM {table}"
        ).fetchone()
        measurements.append(
            TableMeasurement(
                name=name,
                rows=int(row_count),
                max_materialized_row_bytes=int(max_bytes),
            )
        )
    return measurements


def inspect_catalog(
    database: Path,
    *,
    max_database_bytes: int = DEFAULT_MAX_DATABASE_BYTES,
    max_row_bytes: int = DEFAULT_MAX_ROW_BYTES,
) -> CapacityReport:
    if max_database_bytes <= 0 or max_row_bytes <= 0:
        raise ValueError("capacity limits must be positive")
    if not database.is_file():
        raise ValueError(f"SQLite database does not exist: {database}")
    uri = f"file:{database.resolve()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    try:
        page_count = int(connection.execute("PRAGMA page_count").fetchone()[0])
        page_size = int(connection.execute("PRAGMA page_size").fetchone()[0])
        measurements = table_measurements(connection)
    finally:
        connection.close()

    logical_bytes = page_count * page_size
    physical_bytes = database_files_size(database)
    used_bytes = max(logical_bytes, physical_bytes)
    headroom_percent = max(0.0, (max_database_bytes - used_bytes) / max_database_bytes * 100)
    violations: list[str] = []
    if logical_bytes > max_database_bytes:
        violations.append(
            f"logical catalog size {logical_bytes} exceeds {max_database_bytes} bytes"
        )
    if physical_bytes > max_database_bytes:
        violations.append(
            f"physical catalog size {physical_bytes} exceeds {max_database_bytes} bytes"
        )
    for table in measurements:
        if table.max_materialized_row_bytes > max_row_bytes:
            violations.append(
                f"{table.name} row {table.max_materialized_row_bytes} exceeds {max_row_bytes} bytes"
            )
    return CapacityReport(
        database=str(database),
        logical_bytes=logical_bytes,
        physical_bytes=physical_bytes,
        headroom_percent=headroom_percent,
        max_database_bytes=max_database_bytes,
        max_row_bytes=max_row_bytes,
        tables=measurements,
        violations=violations,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path, help="local transformed catalog SQLite file")
    parser.add_argument("--max-database-bytes", type=int, default=DEFAULT_MAX_DATABASE_BYTES)
    parser.add_argument("--max-row-bytes", type=int, default=DEFAULT_MAX_ROW_BYTES)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    try:
        report = inspect_catalog(
            args.database,
            max_database_bytes=args.max_database_bytes,
            max_row_bytes=args.max_row_bytes,
        )
    except (OSError, sqlite3.Error, ValueError) as exc:
        print(f"capacity gate failed: {exc}", file=sys.stderr)
        return 2
    payload: dict[str, Any] = asdict(report) | {"ok": report.ok}
    if args.as_json:
        print(json.dumps(payload, sort_keys=True))
    else:
        print(
            "capacity gate " + ("PASS" if report.ok else "BLOCKED") +
            f": logical={report.logical_bytes} physical={report.physical_bytes} "
            f"headroom={report.headroom_percent:.2f}%"
        )
        for violation in report.violations:
            print(f"BLOCKED: {violation}")
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
