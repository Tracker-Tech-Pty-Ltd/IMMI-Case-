#!/usr/bin/env python3
"""Export an immutable, repeatable-read IMMI snapshot as NDJSON.

The database URL is accepted only from ``IMMI_SOURCE_DATABASE_URL`` and is
never printed. The allowlisted host is the current shared source; this command
is read-only and exists solely to produce migration input for the offline
transformer. Full-text artifacts are read from ``IMMI_SOURCE_TEXT_ROOT`` so
the transform never silently loses FTS/R2 content.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import sys
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
from uuid import UUID


SOURCE_HOST = "db.urntbuqczarkuoaosjxd.supabase.co"
TABLES = (
    "council_sessions",
    "council_turns",
    "immi_users",
    "immi_tenants",
    "immi_tenant_members",
    "immi_tenant_invites",
    "immi_collections",
    "immi_saved_searches",
    "immi_refresh_sessions",
    "immigration_cases",
    "immigration_cases_staging",
    "judge_bios",
    "pipeline_runs",
    "extraction_audit",
)

# Avoid exporting pgvector payloads: the native index is deterministically
# regenerated with Workers AI, never copied from the legacy dimensions.
CASE_COLUMNS = (
    "case_id,citation,title,court,court_code,date,year,url,judges,catchwords,outcome,"
    "visa_type,legislation,text_snippet,full_text_path,source,user_notes,tags,case_nature,"
    "legal_concepts,created_at,updated_at,visa_subclass,visa_class_code,applicant_name,"
    "respondent,country_of_origin,visa_subclass_number,hearing_date,is_represented,"
    "representative,visa_outcome_reason,legal_test_applied,date_sort"
)

EXPORTER_SCHEMA_VERSION = "immi-native-export-v2"
MAX_CHUNK_BYTES = 16 * 1024 * 1024
PRIMARY_KEY_FIELDS: dict[str, tuple[str, ...]] = {
    "council_sessions": ("session_id",),
    "council_turns": ("turn_id",),
    "immi_users": ("id",),
    "immi_tenants": ("id",),
    "immi_tenant_members": ("tenant_id", "user_id"),
    "immi_tenant_invites": ("id",),
    "immi_collections": ("id",),
    "immi_saved_searches": ("id",),
    "immi_refresh_sessions": ("jti",),
    "immigration_cases": ("case_id",),
    "immigration_cases_staging": ("case_id",),
    "judge_bios": ("id",),
    "pipeline_runs": ("run_id",),
    "extraction_audit": ("id",),
}


def validate_source_dsn(dsn: str) -> None:
    if not dsn or "@" not in dsn:
        raise ValueError("IMMI_SOURCE_DATABASE_URL is missing or malformed")
    parsed = urlparse(dsn)
    if parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname != SOURCE_HOST:
        raise ValueError("refusing a database host outside the authoritative shared IMMI source")
    if parsed.query and any(key in parse_qs(parsed.query) for key in ("sslmode",)):
        # sslmode is allowed; this branch makes the URL parsing explicit while
        # ensuring no query value is ever emitted in logs.
        return


def json_default(value: Any) -> Any:
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, bytes):
        return {"__base64__": base64.b64encode(value).decode("ascii")}
    raise TypeError(f"unsupported database value: {type(value).__name__}")


def safe_text_path(root: Path, source_path: str) -> Path:
    name = Path(source_path).name
    if not name or name in {".", ".."}:
        raise ValueError("full_text_path does not contain a file name")
    candidate = (root / name).resolve()
    resolved_root = root.resolve()
    if candidate.parent != resolved_root:
        raise ValueError("full_text_path escapes the approved text root")
    return candidate


def canonical_row(row: dict[str, Any]) -> str:
    return json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=json_default)


def _primary_key(row: dict[str, Any], table: str, ordinal: int) -> dict[str, str]:
    fields = PRIMARY_KEY_FIELDS.get(table, ())
    if not fields:
        return {"ordinal": str(ordinal)}
    values: dict[str, str] = {}
    for field in fields:
        value = row.get(field)
        if value is None or str(value) == "":
            raise ValueError(f"{table}.{field} is required for the primary-key manifest")
        values[field] = str(value)
    return values


def _schema_manifest(cursor: Any) -> dict[str, list[dict[str, str]]]:
    cursor.execute(
        """
        SELECT table_name, column_name, data_type, is_nullable, ordinal_position
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY(%s)
        ORDER BY table_name, ordinal_position
        """,
        (list(TABLES),),
    )
    manifest: dict[str, list[dict[str, str]]] = {table: [] for table in TABLES}
    for row in cursor.fetchall():
        table_name, column_name, data_type, is_nullable, ordinal = row
        manifest.setdefault(str(table_name), []).append({
            "column_name": str(column_name),
            "data_type": str(data_type),
            "is_nullable": str(is_nullable),
            "ordinal_position": str(ordinal),
        })
    return manifest


def _write_chunk(handle: Any, encoded: str, chunk_bytes: int) -> int:
    encoded_bytes = len(encoded.encode("utf-8"))
    if chunk_bytes and chunk_bytes + encoded_bytes > MAX_CHUNK_BYTES:
        return -encoded_bytes
    handle.write(encoded)
    return chunk_bytes + encoded_bytes


def write_table(cursor: Any, output: Path, table: str, text_root: Path | None) -> dict[str, Any]:
    if table == "immigration_cases":
        cursor.execute(f"SELECT {CASE_COLUMNS} FROM public.immigration_cases ORDER BY case_id")
    else:
        cursor.execute(f"SELECT * FROM public.{table} ORDER BY 1")
    columns = [description.name for description in cursor.description]
    table_dir = output / "tables" / table
    table_dir.mkdir(parents=True, exist_ok=True)
    row_manifest_path = output / "row-manifests" / f"{table}.ndjson"
    primary_key_path = output / "primary-keys" / f"{table}.ndjson"
    row_manifest_path.parent.mkdir(parents=True, exist_ok=True)
    primary_key_path.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    count = 0
    chunks: list[dict[str, Any]] = []
    chunk_index = 0
    chunk_bytes = 0
    handle = None
    try:
        row_manifest = row_manifest_path.open("w", encoding="utf-8")
        primary_manifest = primary_key_path.open("w", encoding="utf-8")
        for values in cursor:
            row = dict(zip(columns, values))
            if table == "immigration_cases" and not row.get("full_text"):
                if not text_root:
                    raise ValueError("IMMI_SOURCE_TEXT_ROOT is required for immigration_cases full text")
                source_path = str(row.get("full_text_path") or "")
                text_path = safe_text_path(text_root, source_path)
                if not text_path.is_file():
                    raise ValueError(f"missing full-text artifact for case {row.get('case_id')}: {text_path}")
                row["full_text"] = text_path.read_text(encoding="utf-8")
            encoded = canonical_row(row) + "\n"
            encoded_bytes = len(encoded.encode("utf-8"))
            if handle is None or (chunk_bytes and chunk_bytes + encoded_bytes > MAX_CHUNK_BYTES):
                if handle is not None:
                    handle.close()
                chunk_index += 1
                chunk_path = table_dir / f"part-{chunk_index:06d}.ndjson"
                handle = chunk_path.open("w", encoding="utf-8")
                chunks.append({"path": chunk_path.relative_to(output).as_posix(), "rows": 0, "sha256": ""})
                chunk_bytes = 0
            handle.write(encoded)
            chunk_bytes += encoded_bytes
            chunks[-1]["rows"] += 1
            digest.update(encoded.encode("utf-8"))
            row_hash = hashlib.sha256(encoded.rstrip("\n").encode("utf-8")).hexdigest()
            primary_key = _primary_key(row, table, count + 1)
            row_manifest.write(canonical_row({
                "primary_key": primary_key,
                "sha256": row_hash,
            }) + "\n")
            primary_manifest.write(canonical_row({
                "primary_key": primary_key,
            }) + "\n")
            count += 1
        for chunk in chunks:
            chunk_bytes_digest = hashlib.sha256()
            with (output / chunk["path"]).open("rb") as chunk_handle:
                for part in iter(lambda: chunk_handle.read(1024 * 1024), b""):
                    chunk_bytes_digest.update(part)
            chunk["sha256"] = chunk_bytes_digest.hexdigest()
    finally:
        if handle is not None:
            handle.close()
        if 'row_manifest' in locals():
            row_manifest.close()
        if 'primary_manifest' in locals():
            primary_manifest.close()
    return {"rows": count, "sha256": digest.hexdigest(), "chunks": chunks}


def export_snapshot(output: Path, dsn: str, text_root: Path | None) -> dict[str, Any]:
    validate_source_dsn(dsn)
    try:
        import psycopg2
        from psycopg2.extensions import ISOLATION_LEVEL_REPEATABLE_READ
    except ImportError as exc:  # pragma: no cover - environment-specific
        raise RuntimeError("psycopg2-binary is required in the repository virtualenv") from exc

    output.mkdir(parents=True, exist_ok=False)
    connection = psycopg2.connect(dsn)
    try:
        connection.set_session(readonly=True, deferrable=True, autocommit=False)
        connection.set_isolation_level(ISOLATION_LEVEL_REPEATABLE_READ)
        with connection.cursor() as cursor:
            cursor.execute("SELECT transaction_timestamp()::text")
            snapshot_at = str(cursor.fetchone()[0])
            schema = _schema_manifest(cursor)
            schema_payload = {
                "exporter_schema_version": EXPORTER_SCHEMA_VERSION,
                "tables": schema,
                "primary_key_fields": {
                    table: list(fields) for table, fields in PRIMARY_KEY_FIELDS.items()
                },
            }
            schema_digest = hashlib.sha256(canonical_row(schema_payload).encode("utf-8")).hexdigest()
            schema_manifest = {
                **schema_payload,
                "schema_version": f"sha256:{schema_digest}",
            }
            table_manifest = {}
            for table in TABLES:
                table_manifest[table] = write_table(cursor, output, table, text_root)
        connection.rollback()
    finally:
        connection.close()

    manifest = {
        "source": "authoritative-shared-immi",
        "source_host": SOURCE_HOST,
        "snapshot_at": snapshot_at,
        "consistency": "single-repeatable-read-transaction",
        "exporter_schema_version": EXPORTER_SCHEMA_VERSION,
        "schema_version": schema_manifest["schema_version"],
        "primary_key_fields": schema_manifest["primary_key_fields"],
        "schema_manifest": "schema-manifest.json",
        "tables": table_manifest,
        "vectorize": {"status": "pending", "reason": "regenerate with Workers AI"},
    }
    (output / "schema-manifest.json").write_text(
        json.dumps(schema_manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    (output / "snapshot-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--text-root", type=Path, default=None)
    args = parser.parse_args(argv)
    dsn = os.environ.get("IMMI_SOURCE_DATABASE_URL", "")
    text_root = args.text_root or (Path(os.environ["IMMI_SOURCE_TEXT_ROOT"]) if os.environ.get("IMMI_SOURCE_TEXT_ROOT") else None)
    try:
        manifest = export_snapshot(args.output.resolve(), dsn, text_root.resolve() if text_root else None)
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"snapshot export blocked: {exc}", file=sys.stderr)
        return 2
    print(f"snapshot export complete: {args.output} tables={len(manifest['tables'])}")
    print("No shared database mutation was attempted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
