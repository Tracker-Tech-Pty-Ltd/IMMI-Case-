#!/usr/bin/env python3
"""Verify a local IMMI snapshot transform before any Cloudflare import.

This is intentionally offline: it compares the immutable NDJSON snapshot to
the three SQLite D1 mirrors and the R2 directory created by
``transform_immi_snapshot.py``.  It fails closed on missing, extra, orphan or
checksum-mismatched data, so passing it is evidence for a later *staging*
import, never a production-cutover approval.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


LOWERCASE_SOURCE_IDENTITIES = {
    "immigration_cases", "immi_users", "immi_tenants", "immi_tenant_invites",
    "immi_collections", "immi_saved_searches", "immi_refresh_sessions", "pipeline_runs",
}


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_rows(snapshot: Path, table: str) -> list[dict[str, Any]]:
    legacy_path = snapshot / "tables" / f"{table}.ndjson"
    if legacy_path.exists():
        paths = [legacy_path]
    else:
        table_dir = snapshot / "tables" / table
        paths = sorted(table_dir.glob("part-*.ndjson")) if table_dir.is_dir() else []
    if not paths:
        return []
    rows: list[dict[str, Any]] = []
    for path in paths:
        for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_no} is not a JSON object")
            rows.append(value)
    return rows


def nonempty(value: Any, label: str) -> str:
    result = str(value or "").strip()
    if not result:
        raise ValueError(f"{label} is missing")
    return result


def source_ids(table: str, rows: list[dict[str, Any]]) -> set[str]:
    if table == "immi_tenant_members":
        return {
            f"{nonempty(row.get('tenant_id'), table + '.tenant_id').lower()}:"
            f"{nonempty(row.get('user_id'), table + '.user_id').lower()}"
            for row in rows
        }
    fields = {
        "immigration_cases": "case_id",
        "judge_bios": "id",
        "immi_users": "id",
        "immi_tenants": "id",
        "immi_tenant_invites": "id",
        "immi_collections": "id",
        "immi_saved_searches": "id",
        "immi_refresh_sessions": "jti",
        "council_sessions": "session_id",
        "council_turns": "turn_id",
        "pipeline_runs": "run_id",
        "extraction_audit": "id",
    }
    field = fields[table]
    values = {nonempty(row.get(field), f"{table}.{field}") for row in rows}
    return {value.lower() for value in values} if table in LOWERCASE_SOURCE_IDENTITIES else values


@dataclass
class ReconciliationReport:
    missing: list[str] = field(default_factory=list)
    extra: list[str] = field(default_factory=list)
    orphan: list[str] = field(default_factory=list)
    checksum_mismatch: list[str] = field(default_factory=list)
    source_manifest_mismatch: list[str] = field(default_factory=list)
    relation_missing: list[str] = field(default_factory=list)
    relation_extra: list[str] = field(default_factory=list)
    vector_missing: list[str] = field(default_factory=list)
    vector_extra: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any((self.missing, self.extra, self.orphan, self.checksum_mismatch, self.source_manifest_mismatch, self.relation_missing, self.relation_extra, self.vector_missing, self.vector_extra))


def compare_sets(report: ReconciliationReport, label: str, expected: set[str], actual: set[str]) -> None:
    report.missing.extend(f"{label}:{item}" for item in sorted(expected - actual))
    report.extra.extend(f"{label}:{item}" for item in sorted(actual - expected))


def compare_relation_sets(report: ReconciliationReport, label: str, expected: set[str], actual: set[str]) -> None:
    report.relation_missing.extend(f"{label}:{item}" for item in sorted(expected - actual))
    report.relation_extra.extend(f"{label}:{item}" for item in sorted(actual - expected))


def split_labels(value: Any) -> list[str]:
    values = value if isinstance(value, list) else str(value or "").replace(";", ",").split(",")
    return list(dict.fromkeys(str(item).strip() for item in values if str(item).strip()))


def parse_case_ids(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return [str(item).strip().lower() for item in value if str(item).strip()]
    try:
        parsed = json.loads(str(value))
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, list):
        return [str(item).strip().lower() for item in parsed if str(item).strip()]
    text = str(value).strip()
    if text.startswith("{") and text.endswith("}"):
        return [item.strip().strip('"').lower() for item in text[1:-1].split(",") if item.strip()]
    raise ValueError("collection.case_ids is not a JSON or PostgreSQL text array")


def stable_relation_id(prefix: str, label: str) -> str:
    return hashlib.sha256(f"{prefix}:{label.casefold()}".encode("utf-8")).hexdigest()[:32]


def verify_relation_sets(
    tables: dict[str, list[dict[str, Any]]],
    catalog: Path,
    account: Path,
    ops: Path,
    report: ReconciliationReport,
) -> None:
    expected_judges: set[str] = set()
    expected_concepts: set[str] = set()
    expected_visas: set[str] = set()
    for row in tables["immigration_cases"]:
        case_id = nonempty(row.get("case_id"), "immigration_cases.case_id").lower()
        expected_judges.update(f"{case_id}:{stable_relation_id('judge', label)}" for label in split_labels(row.get("judges")))
        expected_concepts.update(f"{case_id}:{stable_relation_id('concept', label)}" for label in split_labels(row.get("legal_concepts")))
        expected_visas.update(f"{case_id}:{stable_relation_id('visa', label)}" for label in split_labels(row.get("visa_subclass")))

    connection = sqlite3.connect(catalog)
    try:
        actual_judges = {f"{case_id}:{judge_id}" for case_id, judge_id in connection.execute("SELECT case_id, judge_id FROM case_judges")}
        actual_concepts = {f"{case_id}:{concept_id}" for case_id, concept_id in connection.execute("SELECT case_id, concept_id FROM case_concepts")}
        actual_visas = {f"{case_id}:{visa_id}" for case_id, visa_id in connection.execute("SELECT case_id, visa_id FROM case_visas")}
    finally:
        connection.close()
    compare_relation_sets(report, "case_judges", expected_judges, actual_judges)
    compare_relation_sets(report, "case_concepts", expected_concepts, actual_concepts)
    compare_relation_sets(report, "case_visas", expected_visas, actual_visas)

    expected_items: set[str] = set()
    for row in tables["immi_collections"]:
        collection_id = nonempty(row.get("id"), "immi_collections.id").lower()
        expected_items.update(f"{collection_id}:{case_id}" for case_id in parse_case_ids(row.get("case_ids")))
    connection = sqlite3.connect(account)
    try:
        actual_items = {f"{collection_id}:{case_id.lower()}" for collection_id, case_id in connection.execute("SELECT collection_id, case_id FROM collection_items")}
    finally:
        connection.close()
    compare_relation_sets(report, "collection_items", expected_items, actual_items)

    session_tenants = {
        nonempty(row.get("session_id"), "council_sessions.session_id"): nonempty(row.get("tenant_id"), "council_sessions.tenant_id").lower()
        for row in tables["council_sessions"]
    }
    expected_turns = {
        f"{nonempty(row.get('turn_id'), 'council_turns.turn_id')}:{nonempty(row.get('session_id'), 'council_turns.session_id')}:{session_tenants[nonempty(row.get('session_id'), 'council_turns.session_id')] }"
        for row in tables["council_turns"]
        if nonempty(row.get("session_id"), "council_turns.session_id") in session_tenants
    }
    connection = sqlite3.connect(account)
    try:
        actual_turns = {f"{turn_id}:{session_id}:{tenant_id.lower()}" for turn_id, session_id, tenant_id in connection.execute("SELECT turn_id, session_id, tenant_id FROM council_turns")}
    finally:
        connection.close()
    compare_relation_sets(report, "council_turns", expected_turns, actual_turns)


def sqlite_ids(database: Path, query: str, *, lowercase: bool) -> set[str]:
    connection = sqlite3.connect(database)
    try:
        values = {str(row[0]) for row in connection.execute(query)}
        return {value.lower() for value in values} if lowercase else values
    finally:
        connection.close()


def verify_source_manifests(snapshot: Path, output: Path, tables: dict[str, list[dict[str, Any]]], report: ReconciliationReport) -> None:
    for table, rows in tables.items():
        path = output / "source-row-manifests" / f"{table}.ndjson"
        if not path.exists():
            report.source_manifest_mismatch.append(f"missing:{table}")
            continue
        actual = {
            item["source_id"]: item["sha256"]
            for item in (json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
        }
        expected = {
            # An ID normalisation mismatch is also evidence the snapshot no
            # longer equals the transform input, so it must block import.
            next(iter(source_ids(table, [row]))): hashlib.sha256(canonical_json(row).encode("utf-8")).hexdigest()
            for row in rows
        }
        if actual != expected:
            report.source_manifest_mismatch.append(table)


def verify_r2(output: Path, catalog: Path, account: Path, report: ReconciliationReport) -> None:
    pointers: dict[str, tuple[str, int]] = {}
    catalog_db = sqlite3.connect(catalog)
    account_db = sqlite3.connect(account)
    try:
        pointer_rows = list(catalog_db.execute("SELECT content_key, content_sha256, content_size FROM cases"))
        pointer_rows += list(catalog_db.execute("SELECT bio_key, bio_sha256, bio_size FROM judges WHERE source_bio_id IS NOT NULL"))
        pointer_rows += list(account_db.execute("SELECT payload_key, payload_sha256, payload_size FROM council_turns"))
    finally:
        catalog_db.close()
        account_db.close()
    for key, checksum, size in pointer_rows:
        if key in pointers:
            report.orphan.append(f"duplicate-pointer:{key}")
            continue
        pointers[str(key)] = (str(checksum), int(size))
    artifact_manifest = output / "r2-artifact-manifest.ndjson"
    if artifact_manifest.is_file():
        for line_no, line in enumerate(artifact_manifest.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
                key = nonempty(item.get("key"), f"r2-artifact-manifest:{line_no}.key")
                checksum = nonempty(item.get("sha256"), f"r2-artifact-manifest:{line_no}.sha256")
                size = int(item.get("size"))
            except (TypeError, ValueError, json.JSONDecodeError) as exc:
                raise ValueError(f"invalid R2 artifact manifest line {line_no}: {exc}") from exc
            if key in pointers:
                report.orphan.append(f"duplicate-pointer:{key}")
            else:
                pointers[key] = (checksum, size)
    r2_root = output / "r2"
    actual = {
        path.relative_to(r2_root).as_posix()
        for path in r2_root.rglob("*") if path.is_file()
    } if r2_root.exists() else set()
    compare_sets(report, "r2", set(pointers), actual)
    for key, (checksum, size) in pointers.items():
        path = r2_root / key
        if not path.is_file():
            continue
        if path.stat().st_size != size or sha256_file(path) != checksum:
            report.checksum_mismatch.append(key)


def read_vector_ids(path: Path) -> set[str]:
    ids: set[str] = set()
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if isinstance(value, dict):
            value = value.get("id")
        if not isinstance(value, str) or not value:
            raise ValueError(f"{path}:{line_no} has no vector id")
        ids.add(value)
    return ids


def verify_vectorize(output: Path, actual_path: Path | None, report: ReconciliationReport) -> None:
    if actual_path is None:
        return
    expected_path = output / "vectorize" / "expected-ids.ndjson"
    if not expected_path.is_file():
        report.source_manifest_mismatch.append("missing:vectorize/expected-ids.ndjson")
        return
    expected = read_vector_ids(expected_path)
    actual = read_vector_ids(actual_path)
    report.vector_missing.extend(sorted(expected - actual))
    report.vector_extra.extend(sorted(actual - expected))


def verify_relation_orphans(catalog: Path, account: Path, ops: Path, report: ReconciliationReport) -> None:
    checks = (
        (catalog, "SELECT c.case_id FROM case_text_chunks c LEFT JOIN cases p ON p.case_id = c.case_id WHERE p.case_id IS NULL", "catalog:case_text_chunks"),
        (catalog, "SELECT r.case_id FROM case_judges r LEFT JOIN cases p ON p.case_id = r.case_id WHERE p.case_id IS NULL", "catalog:case_judges"),
        (catalog, "SELECT r.judge_id FROM case_judges r LEFT JOIN judges p ON p.judge_id = r.judge_id WHERE p.judge_id IS NULL", "catalog:case_judges.judge"),
        (catalog, "SELECT r.case_id FROM case_concepts r LEFT JOIN cases p ON p.case_id = r.case_id WHERE p.case_id IS NULL", "catalog:case_concepts"),
        (catalog, "SELECT r.concept_id FROM case_concepts r LEFT JOIN concepts p ON p.concept_id = r.concept_id WHERE p.concept_id IS NULL", "catalog:case_concepts.concept"),
        (account, "SELECT r.collection_id FROM collection_items r LEFT JOIN collections p ON p.collection_id = r.collection_id WHERE p.collection_id IS NULL", "account:collection_items.collection"),
    )
    for database, query, label in checks:
        try:
            connection = sqlite3.connect(database)
            try:
                rows = connection.execute(query).fetchall()
            finally:
                connection.close()
        except sqlite3.OperationalError as exc:
            if "cases_shadow" in str(exc):
                continue
            raise
        report.orphan.extend(f"{label}:{row[0]}" for row in rows)
    # D1 keeps the catalog and account databases separate; explicitly compare
    # collection-item case IDs across the two local mirrors.
    catalog_connection = sqlite3.connect(catalog)
    account_connection = sqlite3.connect(account)
    try:
        case_ids = {row[0] for row in catalog_connection.execute("SELECT case_id FROM cases")}
        item_ids = [row[0] for row in account_connection.execute("SELECT case_id FROM collection_items")]
    finally:
        catalog_connection.close()
        account_connection.close()
    report.orphan.extend(f"account:collection_items.case:{case_id}" for case_id in item_ids if case_id not in case_ids)
    # Ops foreign keys are local to Ops D1.
    connection = sqlite3.connect(ops)
    try:
        rows = connection.execute(
            "SELECT audit_id FROM extraction_audit a LEFT JOIN pipeline_runs p ON p.run_id = a.run_id WHERE p.run_id IS NULL"
        ).fetchall()
    finally:
        connection.close()
    report.orphan.extend(f"ops:extraction_audit:{row[0]}" for row in rows)


def inspect(snapshot: Path, output: Path, vectorize_ids: Path | None = None) -> ReconciliationReport:
    tables = {
        name: read_rows(snapshot, name)
        for name in (
            "immigration_cases", "judge_bios", "immi_users", "immi_tenants",
            "immi_tenant_members", "immi_tenant_invites", "immi_collections",
            "immi_saved_searches", "immi_refresh_sessions", "council_sessions",
            "council_turns", "pipeline_runs", "extraction_audit",
        )
    }
    report = ReconciliationReport()
    catalog = output / "catalog.sqlite"
    account = output / "account.sqlite"
    ops = output / "ops.sqlite"
    for path in (catalog, account, ops):
        if not path.is_file():
            raise ValueError(f"transformed database is missing: {path}")
    checks = (
        ("immigration_cases", catalog, "SELECT case_id FROM cases"),
        ("judge_bios", catalog, "SELECT source_bio_id FROM judges WHERE source_bio_id IS NOT NULL"),
        ("immi_users", account, "SELECT user_id FROM users"),
        ("immi_tenants", account, "SELECT tenant_id FROM tenants"),
        ("immi_tenant_members", account, "SELECT tenant_id || ':' || user_id FROM memberships"),
        ("immi_tenant_invites", account, "SELECT invite_id FROM invites"),
        ("immi_collections", account, "SELECT collection_id FROM collections"),
        ("immi_saved_searches", account, "SELECT saved_search_id FROM saved_searches"),
        ("immi_refresh_sessions", account, "SELECT jti FROM immi_refresh_sessions"),
        ("council_sessions", account, "SELECT session_id FROM council_sessions"),
        ("council_turns", account, "SELECT turn_id FROM council_turns"),
        ("pipeline_runs", ops, "SELECT run_id FROM pipeline_runs"),
        ("extraction_audit", ops, "SELECT audit_id FROM extraction_audit"),
    )
    for table, database, query in checks:
        compare_sets(
            report,
            table,
            source_ids(table, tables[table]),
            sqlite_ids(database, query, lowercase=table in LOWERCASE_SOURCE_IDENTITIES or table == "immi_tenant_members"),
        )
    verify_source_manifests(snapshot, output, tables, report)
    verify_r2(output, catalog, account, report)
    verify_relation_orphans(catalog, account, ops, report)
    verify_relation_sets(tables, catalog, account, ops, report)
    verify_vectorize(output, vectorize_ids, report)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--vectorize-ids", type=Path, default=None, help="operator export of Vectorize IDs; required for the semantic-ready reconciliation gate")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    try:
        report = inspect(args.snapshot.resolve(), args.output.resolve(), args.vectorize_ids.resolve() if args.vectorize_ids else None)
    except (OSError, sqlite3.Error, ValueError, json.JSONDecodeError) as exc:
        print(f"reconciliation blocked: {exc}", file=sys.stderr)
        return 2
    payload = asdict(report) | {"ok": report.ok}
    if args.as_json:
        print(json.dumps(payload, sort_keys=True))
    else:
        print("reconciliation " + ("PASS" if report.ok else "BLOCKED"))
        for category, values in asdict(report).items():
            for value in values:
                print(f"{category}: {value}")
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
