#!/usr/bin/env python3
"""Transform a read-only IMMI NDJSON snapshot into local Cloudflare mirrors.

Input layout (produced only from a fresh, operator-approved source snapshot):

  SNAPSHOT/
    tables/<postgres-table>.ndjson
    artifacts/cases/<case_id>.txt
    artifacts/council/<turn_id>.json   (optional when payload is in the row)

The transformer writes three SQLite files using the actual D1 migrations, an
R2 directory mirror, and per-source-row SHA-256 manifests. It has no network
client and deliberately refuses lossy mappings. Vector generation is a later
Workers AI/Vectorize import phase, so this tool records it as pending rather
than claiming a complete import.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations" / "d1"
SUPPORTED_TABLES = {
    "immigration_cases",
    "immi_users",
    "immi_tenants",
    "immi_tenant_members",
    "immi_tenant_invites",
    "immi_collections",
    "immi_saved_searches",
    "immi_refresh_sessions",
    "council_sessions",
    "council_turns",
    "pipeline_runs",
    "extraction_audit",
    "judge_bios",
}
LOWERCASE_SOURCE_IDENTITIES = {
    "immigration_cases", "immi_users", "immi_tenants", "immi_tenant_invites",
    "immi_collections", "immi_saved_searches", "immi_refresh_sessions", "pipeline_runs",
}
SOURCE_ID_FIELDS = {
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


class TransformError(RuntimeError):
    """A fail-closed source/target mapping error."""


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def sha256_text(value: str | bytes) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(payload).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def string(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def required(value: Any, label: str) -> str:
    result = optional_string(value)
    if result is None:
        raise TransformError(f"{label} is required for a lossless transform")
    return result


def normalise_timestamp(value: Any, fallback: str) -> str:
    return optional_string(value) or fallback


def load_rows(snapshot: Path, table: str) -> list[dict[str, Any]]:
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
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise TransformError(f"{path}:{line_no}: invalid JSON: {exc.msg}") from exc
            if not isinstance(row, dict):
                raise TransformError(f"{path}:{line_no}: every NDJSON row must be an object")
            rows.append(row)
    return rows


def source_identity(table: str, row: dict[str, Any], ordinal: int) -> str:
    if table == "immi_tenant_members":
        return f"{required(row.get('tenant_id'), 'membership.tenant_id').lower()}:{required(row.get('user_id'), 'membership.user_id').lower()}"
    key = SOURCE_ID_FIELDS.get(table)
    if key and optional_string(row.get(key)):
        value = required(row[key], f"{table}.{key}")
        return value.lower() if table in LOWERCASE_SOURCE_IDENTITIES else value
    return f"line-{ordinal}"


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(canonical_json(payload) + "\n", encoding="utf-8")


def parse_jsonish(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except json.JSONDecodeError:
        return default


def split_labels(value: Any) -> list[str]:
    values = value if isinstance(value, list) else string(value).replace(";", ",").split(",")
    labels = [string(item).strip() for item in values if string(item).strip()]
    return list(dict.fromkeys(labels))


def parse_case_ids(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return [string(item) for item in value]
    parsed = parse_jsonish(value, None)
    if isinstance(parsed, list):
        return [string(item) for item in parsed]
    text = string(value).strip()
    if text.startswith("{") and text.endswith("}"):
        return [item.strip().strip('"') for item in text[1:-1].split(",") if item.strip()]
    raise TransformError("collection.case_ids is not a JSON or PostgreSQL text array")


def split_utf8(text: str, maximum: int = 128 * 1024) -> list[str]:
    encoded = text.encode("utf-8")
    chunks: list[str] = []
    start = 0
    while start < len(encoded):
        end = min(start + maximum, len(encoded))
        while end > start:
            try:
                chunks.append(encoded[start:end].decode("utf-8"))
                break
            except UnicodeDecodeError:
                end -= 1
        if end == start:
            raise TransformError("unable to split UTF-8 case text under the D1 chunk limit")
        start = end
    return chunks


def exec_migration(connection: sqlite3.Connection, name: str) -> None:
    files = {
        "catalog": MIGRATIONS / "catalog" / "0001_catalog.sql",
        "account": MIGRATIONS / "account" / "0001_account.sql",
        "ops": MIGRATIONS / "ops" / "0001_ops.sql",
    }
    migration = files[name]
    connection.executescript(migration.read_text(encoding="utf-8"))
    connection.execute("PRAGMA foreign_keys = ON")


@dataclass
class Output:
    root: Path
    catalog: sqlite3.Connection
    account: sqlite3.Connection
    ops: sqlite3.Connection
    r2: Path
    snapshot_time: str


def create_output(path: Path, snapshot_time: str) -> Output:
    if path.exists():
        raise TransformError(f"output directory already exists: {path}; choose a new path to preserve evidence")
    path.mkdir(parents=True)
    catalog = sqlite3.connect(path / "catalog.sqlite")
    account = sqlite3.connect(path / "account.sqlite")
    ops = sqlite3.connect(path / "ops.sqlite")
    for connection, name in ((catalog, "catalog"), (account, "account"), (ops, "ops")):
        exec_migration(connection, name)
    return Output(path, catalog, account, ops, path / "r2", snapshot_time)


def case_text(snapshot: Path, row: dict[str, Any]) -> str:
    case_id = required(row.get("case_id"), "immigration_cases.case_id")
    inline = optional_string(row.get("full_text"))
    artifact = snapshot / "artifacts" / "cases" / f"{case_id}.txt"
    if inline:
        return inline
    if artifact.is_file():
        return artifact.read_text(encoding="utf-8")
    raise TransformError(f"case {case_id} has no full text artifact; refusing lossy FTS/R2 import")


def transform_cases(snapshot: Path, output: Output, rows: Iterable[dict[str, Any]]) -> int:
    count = 0
    for row in rows:
        case_id = required(row.get("case_id"), "immigration_cases.case_id").lower()
        if len(case_id) != 12 or any(char not in "0123456789abcdef" for char in case_id):
            raise TransformError(f"invalid case_id: {case_id}")
        text = case_text(snapshot, row)
        digest = sha256_text(text)
        key = f"cases/{case_id}/source/{digest}.txt"
        object_path = output.r2 / key
        object_path.parent.mkdir(parents=True, exist_ok=True)
        object_path.write_text(text, encoding="utf-8")
        created = normalise_timestamp(row.get("created_at"), output.snapshot_time)
        updated = normalise_timestamp(row.get("updated_at"), created)
        represented = optional_string(row.get("is_represented"))
        if represented and represented.lower() not in {"0", "1", "true", "false", "yes", "no", "y", "n"}:
            raise TransformError(f"case {case_id} has unrecognised is_represented value: {represented}")
        case_values = (
            case_id, string(row.get("citation")), string(row.get("title")), string(row.get("court")),
            string(row.get("court_code")), string(row.get("date")), int(row.get("year") or 0),
            string(row.get("outcome")), string(row.get("visa_type")), string(row.get("visa_subclass")),
            string(row.get("visa_class_code")), string(row.get("visa_subclass_number")),
            string(row.get("applicant_name")), string(row.get("respondent")), string(row.get("country_of_origin")),
            string(row.get("hearing_date")), None if represented is None else int(represented.lower() in {"1", "true", "yes", "y"}),
            string(row.get("representative")), string(row.get("source")), string(row.get("case_nature")),
            string(row.get("url")), string(row.get("catchwords")), string(row.get("legislation")),
            string(row.get("text_snippet")) or text[:500], string(row.get("tags")), string(row.get("user_notes")),
            string(row.get("visa_outcome_reason")), string(row.get("legal_test_applied")),
            optional_string(row.get("last_extraction_run_id")), canonical_json(parse_jsonish(row.get("extraction_confidence"), {})),
            key, digest, len(text.encode("utf-8")), created, updated,
        )
        # Keep parameter count mechanically coupled to the values tuple: 33 columns
        # precede the literal semantic_ready=0 and two timestamps follow it.
        case_value_slots = ",".join(["?"] * 33 + ["0", "?", "?"])
        output.catalog.execute(
            f"""
            INSERT INTO cases (
              case_id,citation,title,court,court_code,decision_date,year,outcome,visa_type,visa_subclass,
              visa_class_code,visa_subclass_number,applicant_name,respondent,country_of_origin,hearing_date,
              is_represented,representative,source,case_nature,url,catchwords,legislation,text_snippet,tags,
              user_notes,visa_outcome_reason,legal_test_applied,last_extraction_run_id,extraction_confidence_json,
              content_key,content_sha256,content_size,semantic_ready,created_at,updated_at
            ) VALUES ({case_value_slots})
            """,
            case_values,
        )
        for index, chunk in enumerate(split_utf8(text)):
            output.catalog.execute(
                "INSERT INTO case_text_chunks (case_id,chunk_index,content,content_sha256,created_at) VALUES (?,?,?,?,?)",
                (case_id, index, chunk, sha256_text(chunk), created),
            )
        for label in split_labels(row.get("judges")):
            judge_id = sha256_text("judge:" + label.casefold())[:32]
            output.catalog.execute("INSERT OR IGNORE INTO judges (judge_id,canonical_name,created_at,updated_at) VALUES (?,?,?,?)", (judge_id, label, created, updated))
            output.catalog.execute("INSERT OR IGNORE INTO case_judges (case_id,judge_id) VALUES (?,?)", (case_id, judge_id))
        for label in split_labels(row.get("legal_concepts")):
            concept_id = sha256_text("concept:" + label.casefold())[:32]
            output.catalog.execute("INSERT OR IGNORE INTO concepts (concept_id,label) VALUES (?,?)", (concept_id, label))
            output.catalog.execute("INSERT OR IGNORE INTO case_concepts (case_id,concept_id) VALUES (?,?)", (case_id, concept_id))
        for subclass in split_labels(row.get("visa_subclass")):
            visa_id = sha256_text("visa:" + subclass.casefold())[:32]
            output.catalog.execute(
                "INSERT OR IGNORE INTO visas (visa_id,subclass) VALUES (?,?)",
                (visa_id, subclass),
            )
            output.catalog.execute(
                "INSERT OR IGNORE INTO case_visas (case_id,visa_id) VALUES (?,?)",
                (case_id, visa_id),
            )
        count += 1
    output.catalog.commit()
    return count


def rebuild_catalog_aggregates(output: Output) -> None:
    """Materialise every public aggregate once during import, never per request."""
    catalog = output.catalog
    catalog.execute("DELETE FROM aggregate_court_year_outcome")
    catalog.execute("DELETE FROM aggregate_visa")
    catalog.execute("DELETE FROM aggregate_country")
    catalog.execute("DELETE FROM aggregate_judge")
    catalog.execute("DELETE FROM aggregate_judge_court")
    catalog.execute("DELETE FROM aggregate_nature_outcome")
    catalog.execute("DELETE FROM aggregate_source")
    catalog.execute("DELETE FROM catalog_summary")
    catalog.execute("DELETE FROM aggregate_concept")
    catalog.execute("DELETE FROM aggregate_scope")
    catalog.execute("DELETE FROM aggregate_court_nature_outcome")
    catalog.execute("DELETE FROM aggregate_concept_scope")
    catalog.execute("DELETE FROM aggregate_concept_pair")
    catalog.execute("DELETE FROM aggregate_judge_outcome")
    catalog.execute("DELETE FROM aggregate_judge_year")
    catalog.execute("DELETE FROM aggregate_judge_visa")
    catalog.execute("DELETE FROM filter_options")
    catalog.execute(
        """
        INSERT INTO aggregate_court_year_outcome (court_code,year,outcome,case_count,updated_at)
        SELECT court_code, year, outcome, COUNT(*), ?
        FROM cases GROUP BY court_code, year, outcome
        """,
        (output.snapshot_time,),
    )
    catalog.execute(
        """
        INSERT INTO aggregate_source (source,case_count,updated_at)
        SELECT source, COUNT(*), ? FROM cases WHERE source <> '' GROUP BY source
        """,
        (output.snapshot_time,),
    )
    catalog.executemany(
        "INSERT INTO catalog_summary (summary_key,value_int,updated_at) VALUES (?,?,?)",
        (
            ("total_cases", catalog.execute("SELECT COUNT(*) FROM cases").fetchone()[0], output.snapshot_time),
            ("with_full_text", catalog.execute("SELECT COUNT(*) FROM cases WHERE content_key <> ''").fetchone()[0], output.snapshot_time),
        ),
    )
    catalog.execute(
        """
        INSERT INTO aggregate_judge_court (judge_id,court_code,case_count)
        SELECT cj.judge_id, c.court_code, COUNT(DISTINCT cj.case_id)
        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
        WHERE c.court_code <> ''
        GROUP BY cj.judge_id, c.court_code
        """,
    )
    catalog.execute(
        """
        INSERT INTO aggregate_nature_outcome (case_nature,outcome,case_count)
        SELECT case_nature, outcome, COUNT(*)
        FROM cases WHERE case_nature <> ''
        GROUP BY case_nature, outcome
        """,
    )
    catalog.execute(
        """
        INSERT INTO aggregate_concept (concept_id,label,case_count)
        SELECT cc.concept_id, c.label, COUNT(DISTINCT cc.case_id)
        FROM case_concepts cc JOIN concepts c ON c.concept_id = cc.concept_id
        GROUP BY cc.concept_id, c.label
        """,
    )
    catalog.execute(
        """
        INSERT INTO aggregate_country (country,case_count,updated_at)
        SELECT country_of_origin, COUNT(*), ?
        FROM cases WHERE country_of_origin <> ''
        GROUP BY country_of_origin
        """,
        (output.snapshot_time,),
    )
    catalog.execute(
        """
        INSERT INTO aggregate_judge (judge_id,canonical_name,case_count,updated_at)
        SELECT j.judge_id, j.canonical_name, COUNT(DISTINCT cj.case_id), ?
        FROM judges j JOIN case_judges cj ON cj.judge_id = j.judge_id
        GROUP BY j.judge_id, j.canonical_name
        """,
        (output.snapshot_time,),
    )
    catalog.execute(
        """
        INSERT INTO aggregate_visa (visa_subclass,court_code,outcome,case_count,updated_at)
        SELECT visa_subclass, court_code, outcome, COUNT(*), ?
        FROM cases WHERE visa_subclass <> '' GROUP BY visa_subclass, court_code, outcome
        """,
        (output.snapshot_time,),
    )
    catalog.execute(
        """
        INSERT INTO aggregate_scope
          (court_code,year,outcome,visa_subclass,visa_type,source,case_nature,country_of_origin,has_full_text,case_count)
        SELECT COALESCE(court_code,''), COALESCE(year,0), COALESCE(outcome,''),
               COALESCE(visa_subclass,''), COALESCE(visa_type,''), COALESCE(source,''),
               COALESCE(case_nature,''), COALESCE(country_of_origin,''),
               CASE WHEN content_key <> '' THEN 1 ELSE 0 END, COUNT(*)
        FROM cases
        GROUP BY COALESCE(court_code,''), COALESCE(year,0), COALESCE(outcome,''),
                 COALESCE(visa_subclass,''), COALESCE(visa_type,''), COALESCE(source,''),
                 COALESCE(case_nature,''), COALESCE(country_of_origin,''),
                 CASE WHEN content_key <> '' THEN 1 ELSE 0 END
        """,
    )
    catalog.execute(
        """
        INSERT INTO aggregate_court_nature_outcome (court_code,case_nature,outcome,case_count)
        SELECT court_code, case_nature, outcome, COUNT(*)
        FROM cases WHERE case_nature <> ''
        GROUP BY court_code, case_nature, outcome
        """,
    )
    catalog.execute(
        """
        INSERT INTO aggregate_concept_scope (concept_id,court_code,year,outcome,case_count)
        SELECT cc.concept_id, c.court_code, COALESCE(c.year,0), c.outcome, COUNT(DISTINCT cc.case_id)
        FROM case_concepts cc JOIN cases c ON c.case_id = cc.case_id
        GROUP BY cc.concept_id, c.court_code, COALESCE(c.year,0), c.outcome
        """,
    )
    catalog.execute(
        """
        INSERT INTO aggregate_concept_pair
          (concept_id_a,concept_id_b,court_code,outcome,case_count)
        SELECT a.concept_id, b.concept_id, c.court_code, c.outcome,
               COUNT(DISTINCT a.case_id)
        FROM case_concepts a
        JOIN case_concepts b ON b.case_id = a.case_id AND a.concept_id < b.concept_id
        JOIN cases c ON c.case_id = a.case_id
        GROUP BY a.concept_id, b.concept_id, c.court_code, c.outcome
        """,
    )
    catalog.execute(
        """
        INSERT INTO aggregate_judge_outcome (judge_id,court_code,outcome,case_count)
        SELECT cj.judge_id, c.court_code, c.outcome, COUNT(DISTINCT cj.case_id)
        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
        GROUP BY cj.judge_id, c.court_code, c.outcome
        """,
    )
    catalog.execute(
        """
        INSERT INTO aggregate_judge_year (judge_id,year,case_count)
        SELECT cj.judge_id, c.year, COUNT(DISTINCT cj.case_id)
        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
        WHERE c.year IS NOT NULL
        GROUP BY cj.judge_id, c.year
        """,
    )
    catalog.execute(
        """
        INSERT INTO aggregate_judge_visa (judge_id,visa_subclass,case_count)
        SELECT cj.judge_id, c.visa_subclass, COUNT(DISTINCT cj.case_id)
        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
        WHERE c.visa_subclass <> ''
        GROUP BY cj.judge_id, c.visa_subclass
        """,
    )
    for filter_name, column in (("court", "court_code"), ("year", "year"), ("outcome", "outcome"), ("visa_type", "visa_type"), ("visa_subclass", "visa_subclass"), ("source", "source"), ("case_nature", "case_nature")):
        values = [row[0] for row in catalog.execute(
            f"SELECT DISTINCT {column} FROM cases WHERE {column} IS NOT NULL AND {column} <> '' ORDER BY {column}"
        )]
        catalog.executemany(
            "INSERT INTO filter_options (filter_name,option_value,sort_order) VALUES (?,?,?)",
            ((filter_name, str(value), index) for index, value in enumerate(values)),
        )
    catalog.commit()


def transform_judge_bios(output: Output, rows: Iterable[dict[str, Any]]) -> int:
    """Preserve each legacy judge bio as checksum-addressed R2 JSON.

    Case-to-judge relations remain normalised from the case data.  The source
    bio ID is separately retained so the public judge lookup and reconciliation
    do not depend on heuristic display-name matching.
    """
    count = 0
    for row in rows:
        source_bio_id = required(row.get("id"), "judge_bios.id")
        canonical_name = required(row.get("full_name"), "judge_bios.full_name")
        created = normalise_timestamp(row.get("created_at"), output.snapshot_time)
        updated = normalise_timestamp(row.get("updated_at"), created)
        encoded = canonical_json(row)
        digest = sha256_text(encoded)
        source_hash = sha256_text(source_bio_id.casefold())[:32]
        key = f"judges/{source_hash}/bio/{digest}.json"
        target = output.r2 / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(encoded, encoding="utf-8")
        judge_id = sha256_text("judge:" + canonical_name.casefold())[:32]
        output.catalog.execute(
            """
            INSERT INTO judges (
              judge_id, canonical_name, source_bio_id, bio_key, bio_sha256,
              bio_size, bio_content_type, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(judge_id) DO UPDATE SET
              canonical_name=excluded.canonical_name, source_bio_id=excluded.source_bio_id,
              bio_key=excluded.bio_key,
              bio_sha256=excluded.bio_sha256, bio_size=excluded.bio_size,
              bio_content_type=excluded.bio_content_type, updated_at=excluded.updated_at
            """,
            (
                judge_id, canonical_name, source_bio_id, key, digest,
                len(encoded.encode("utf-8")), "application/json", created, updated,
            ),
        )
        count += 1
    output.catalog.commit()
    return count


def transform_legislations(output: Output, source_path: Path | None) -> int:
    """Copy the filesystem legislation corpus into checksum-addressed R2.

    Legislation is an artifact rather than a PostgreSQL row. Requiring the
    operator to pass the exact snapshot file keeps it in the same immutable
    export boundary as cases, bios and Council payloads.
    """
    if source_path is None:
        return 0
    if not source_path.is_file():
        raise TransformError(f"legislation artifact does not exist: {source_path}")
    try:
        payload = json.loads(source_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TransformError(f"invalid legislation artifact: {source_path}: {exc}") from exc
    laws = payload.get("legislations") if isinstance(payload, dict) else None
    if not isinstance(laws, list):
        raise TransformError("legislation artifact must contain a legislations[] array")
    manifest_path = output.root / "r2-artifact-manifest.ndjson"
    count = 0
    with manifest_path.open("a", encoding="utf-8") as manifest:
        for law in laws:
            if not isinstance(law, dict):
                raise TransformError("every legislation artifact must be an object")
            law_id = required(law.get("id"), "legislation.id").lower()
            if not all(char.isalnum() or char == "-" for char in law_id):
                raise TransformError(f"legislation id is unsafe: {law_id}")
            encoded = canonical_json(law) + "\n"
            digest = sha256_text(encoded)
            key = f"legislations/{law_id}.json"
            target = output.r2 / key
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(encoded, encoding="utf-8")
            manifest.write(canonical_json({"key": key, "sha256": digest, "size": len(encoded.encode("utf-8"))}) + "\n")
            count += 1
    return count


def transform_identity(output: Output, tables: dict[str, list[dict[str, Any]]]) -> dict[str, int]:
    account = output.account
    counts: dict[str, int] = {}
    for row in tables["immi_tenants"]:
        kind = string(row.get("kind"))
        if kind == "organization":
            kind = "organisation"
        if kind not in {"individual", "organisation"}:
            raise TransformError(f"unsupported tenant kind: {kind}")
        created = normalise_timestamp(row.get("created_at"), output.snapshot_time)
        account.execute("INSERT INTO tenants (tenant_id,kind,name,created_at,updated_at) VALUES (?,?,?,?,?)", (required(row.get("id"), "immi_tenants.id").lower(), kind, required(row.get("name"), "immi_tenants.name"), created, created))
    counts["immi_tenants"] = len(tables["immi_tenants"])
    for row in tables["immi_users"]:
        if optional_string(row.get("deleted_at")):
            raise TransformError("soft-deleted IMMI users require an approved retention mapping")
        created = normalise_timestamp(row.get("created_at"), output.snapshot_time)
        account.execute(
            "INSERT INTO users (user_id,telegram_id,first_name,last_name,username,photo_url,primary_tenant_id,last_login_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (required(row.get("id"), "immi_users.id").lower(), optional_string(row.get("telegram_id")), optional_string(row.get("first_name")), optional_string(row.get("last_name")), optional_string(row.get("username")), optional_string(row.get("photo_url")), optional_string(row.get("primary_tenant_id")) and required(row.get("primary_tenant_id"), "immi_users.primary_tenant_id").lower(), optional_string(row.get("last_login_at")), created, created),
        )
    counts["immi_users"] = len(tables["immi_users"])
    for row in tables["immi_tenant_members"]:
        role = string(row.get("role"))
        if role not in {"owner", "admin", "member", "viewer"}:
            raise TransformError(f"unsupported membership role: {role}")
        account.execute("INSERT INTO memberships (tenant_id,user_id,role,created_at) VALUES (?,?,?,?)", (required(row.get("tenant_id"), "membership.tenant_id").lower(), required(row.get("user_id"), "membership.user_id").lower(), role, normalise_timestamp(row.get("joined_at"), output.snapshot_time)))
    counts["immi_tenant_members"] = len(tables["immi_tenant_members"])
    for row in tables["immi_tenant_invites"]:
        inviter = optional_string(row.get("invited_by"))
        account.execute("INSERT INTO invites (invite_id,tenant_id,email,role,code_hash,expires_at,accepted_at,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)", (required(row.get("id"), "invite.id").lower(), required(row.get("tenant_id"), "invite.tenant_id").lower(), optional_string(row.get("email")), "member", required(row.get("token_hash"), "invite.token_hash"), required(row.get("expires_at"), "invite.expires_at"), optional_string(row.get("consumed_at")), inviter.lower() if inviter else None, normalise_timestamp(row.get("created_at"), output.snapshot_time)))
    counts["immi_tenant_invites"] = len(tables["immi_tenant_invites"])
    for row in tables["immi_collections"]:
        collection_id = required(row.get("id"), "collection.id").lower()
        tenant_id = required(row.get("tenant_id"), "collection.tenant_id").lower()
        owner_id = required(row.get("created_by"), "collection.created_by").lower()
        created = normalise_timestamp(row.get("created_at"), output.snapshot_time)
        account.execute("INSERT INTO collections (collection_id,tenant_id,owner_id,title,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", (collection_id, tenant_id, owner_id, required(row.get("name"), "collection.name"), string(row.get("description")), created, normalise_timestamp(row.get("updated_at"), created)))
        for case_id in parse_case_ids(row.get("case_ids")):
            account.execute("INSERT OR IGNORE INTO collection_items (collection_id,case_id,created_at) VALUES (?,?,?)", (collection_id, string(case_id), created))
    counts["immi_collections"] = len(tables["immi_collections"])
    for row in tables["immi_saved_searches"]:
        created = normalise_timestamp(row.get("created_at"), output.snapshot_time)
        account.execute("INSERT INTO saved_searches (saved_search_id,tenant_id,owner_id,title,query_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", (required(row.get("id"), "saved_search.id").lower(), required(row.get("tenant_id"), "saved_search.tenant_id").lower(), required(row.get("created_by"), "saved_search.created_by").lower(), required(row.get("name"), "saved_search.name"), canonical_json(parse_jsonish(row.get("filters"), {})), created, created))
    counts["immi_saved_searches"] = len(tables["immi_saved_searches"])
    for row in tables["immi_refresh_sessions"]:
        account.execute("INSERT INTO immi_refresh_sessions (jti,user_id,family_id,expires_at,revoked_at,revoked_reason,replaced_by_jti,last_used_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)", (required(row.get("jti"), "refresh.jti").lower(), required(row.get("user_id"), "refresh.user_id").lower(), required(row.get("family_id"), "refresh.family_id").lower(), required(row.get("expires_at"), "refresh.expires_at"), optional_string(row.get("revoked_at")), optional_string(row.get("revoked_reason")), optional_string(row.get("replaced_by_jti")), optional_string(row.get("last_used_at")), normalise_timestamp(row.get("created_at"), output.snapshot_time)))
    counts["immi_refresh_sessions"] = len(tables["immi_refresh_sessions"])
    account.commit()
    return counts


def transform_council(snapshot: Path, output: Output, tables: dict[str, list[dict[str, Any]]]) -> dict[str, int]:
    account = output.account
    sessions = {required(row.get("session_id"), "council_sessions.session_id"): row for row in tables["council_sessions"]}
    for session_id, row in sessions.items():
        tenant_id = optional_string(row.get("tenant_id"))
        created_by = optional_string(row.get("created_by"))
        if not tenant_id or not created_by:
            raise TransformError(f"Council session {session_id} lacks tenant ownership")
        created = normalise_timestamp(row.get("created_at"), output.snapshot_time)
        account.execute("INSERT INTO council_sessions (session_id,tenant_id,created_by,case_id,title,status,retrieve_code,total_turns,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)", (session_id, tenant_id.lower(), created_by.lower(), optional_string(row.get("case_id")), string(row.get("title")), string(row.get("status"), "active"), optional_string(row.get("retrieve_code")), int(row.get("total_turns") or 0), created, normalise_timestamp(row.get("updated_at"), created)))
    for row in tables["council_turns"]:
        session_id = required(row.get("session_id"), "council_turns.session_id")
        session = sessions.get(session_id)
        if not session:
            raise TransformError(f"Council turn references missing session {session_id}")
        turn_id = required(row.get("turn_id"), "council_turns.turn_id")
        payload = parse_jsonish(row.get("payload"), None)
        artifact = snapshot / "artifacts" / "council" / f"{turn_id}.json"
        if payload is None and artifact.is_file():
            payload = json.loads(artifact.read_text(encoding="utf-8"))
        if payload is None:
            raise TransformError(f"Council turn {turn_id} lacks payload artifact")
        encoded = canonical_json({"user_message": string(row.get("user_message")), "user_case_context": row.get("user_case_context"), "payload": payload, "retrieved_cases": parse_jsonish(row.get("retrieved_cases"), None), "total_tokens": row.get("total_tokens"), "total_latency_ms": row.get("total_latency_ms")})
        digest = sha256_text(encoded)
        key = f"council/{required(session.get('tenant_id'), 'session.tenant_id').lower()}/{session_id}/{turn_id}.json"
        target = output.r2 / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(encoded, encoding="utf-8")
        account.execute("INSERT INTO council_turns (turn_id,session_id,tenant_id,turn_index,role,payload_key,payload_sha256,payload_size,payload_content_type,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", (turn_id, session_id, required(session.get("tenant_id"), "session.tenant_id").lower(), int(row.get("turn_index") or 0), "user", key, digest, len(encoded.encode("utf-8")), "application/json", normalise_timestamp(row.get("created_at"), output.snapshot_time)))
    account.commit()
    return {"council_sessions": len(sessions), "council_turns": len(tables["council_turns"])}


def transform_ops(output: Output, tables: dict[str, list[dict[str, Any]]]) -> dict[str, int]:
    ops = output.ops
    for row in tables["pipeline_runs"]:
        ops.execute("INSERT INTO pipeline_runs (run_id,trigger,court,phase,status,discovered,scraped,extracted,upserted,llm_calls,cost_usd,errors,detail_json,abort_reason,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (required(row.get("run_id"), "pipeline.run_id"), required(row.get("trigger"), "pipeline.trigger"), optional_string(row.get("court")), required(row.get("phase"), "pipeline.phase"), required(row.get("status"), "pipeline.status"), int(row.get("discovered") or 0), int(row.get("scraped") or 0), int(row.get("extracted") or 0), int(row.get("upserted") or 0), int(row.get("llm_calls") or 0), float(row.get("cost_usd") or 0), int(row.get("errors") or 0), canonical_json(parse_jsonish(row.get("errors_json"), {})), optional_string(row.get("abort_reason")), normalise_timestamp(row.get("started_at"), output.snapshot_time), optional_string(row.get("finished_at"))))
    for ordinal, row in enumerate(tables["extraction_audit"], 1):
        ops.execute("INSERT INTO extraction_audit (audit_id,run_id,case_id,field_name,old_value,new_value,source,confidence,created_at) VALUES (?,?,?,?,?,?,?,?,?)", (string(row.get("id"), f"audit-{ordinal}"), required(row.get("run_id"), "audit.run_id"), required(row.get("case_id"), "audit.case_id"), required(row.get("field"), "audit.field"), optional_string(row.get("old_value")), optional_string(row.get("new_value")), required(row.get("source"), "audit.source"), row.get("confidence"), normalise_timestamp(row.get("created_at"), output.snapshot_time)))
    ops.commit()
    return {"pipeline_runs": len(tables["pipeline_runs"]), "extraction_audit": len(tables["extraction_audit"])}


def source_manifest(snapshot: Path, tables: dict[str, list[dict[str, Any]]], destination: Path) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for table, rows in tables.items():
        output = destination / "source-row-manifests" / f"{table}.ndjson"
        output.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        with output.open("w", encoding="utf-8") as handle:
            for ordinal, row in enumerate(rows, 1):
                payload = canonical_json(row)
                row_hash = sha256_text(payload)
                digest.update((row_hash + "\n").encode("ascii"))
                handle.write(canonical_json({"source_id": source_identity(table, row, ordinal), "sha256": row_hash}) + "\n")
        result[table] = {"rows": len(rows), "manifest_sha256": digest.hexdigest()}
    return result


def write_vectorize_expected(output: Output) -> int:
    """Record the exact case IDs that the deterministic re-embedding must cover."""
    rows = output.catalog.execute("SELECT case_id, content_sha256 FROM cases ORDER BY case_id").fetchall()
    path = output.root / "vectorize" / "expected-ids.ndjson"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for case_id, content_sha256 in rows:
            handle.write(canonical_json({"id": case_id, "content_sha256": content_sha256}) + "\n")
    return len(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--legislation-json", type=Path, default=None, help="immutable legislation JSON artifact to copy into R2")
    args = parser.parse_args(argv)
    output: Output | None = None
    try:
        snapshot = args.snapshot.resolve()
        if not snapshot.is_dir():
            raise TransformError(f"snapshot directory does not exist: {snapshot}")
        staging = load_rows(snapshot, "immigration_cases_staging")
        if staging:
            raise TransformError("non-empty immigration_cases_staging requires an approved target scope; refusing silent loss")
        tables = {name: load_rows(snapshot, name) for name in SUPPORTED_TABLES}
        unknown = [path.stem for path in (snapshot / "tables").glob("*.ndjson") if path.stem not in SUPPORTED_TABLES | {"immigration_cases_staging"}]
        if unknown:
            raise TransformError(f"unknown in-scope table(s): {', '.join(sorted(unknown))}")
        snapshot_time = utc_now()
        output = create_output(args.output.resolve(), snapshot_time)
        manifest = source_manifest(snapshot, tables, output.root)
        counts = {"immigration_cases": transform_cases(snapshot, output, tables["immigration_cases"])}
        counts["judge_bios"] = transform_judge_bios(output, tables["judge_bios"])
        counts["legislations"] = transform_legislations(output, args.legislation_json.resolve() if args.legislation_json else None)
        rebuild_catalog_aggregates(output)
        vector_expected = write_vectorize_expected(output)
        counts.update(transform_identity(output, tables))
        counts.update(transform_council(snapshot, output, tables))
        counts.update(transform_ops(output, tables))
        write_json(output.root / "transform-manifest.json", {
            "source_snapshot": str(snapshot),
            "transformed_at": snapshot_time,
            "source_tables": manifest,
            "target_counts": counts,
            "vectorize": {"status": "pending", "expected_ids": vector_expected, "model": "@cf/qwen/qwen3-embedding-0.6b", "dimensions": 1024, "metric": "cosine"},
            "reconciliation": {"status": "pending", "required": ["missing=0", "extra=0", "orphan=0", "checksum_mismatch=0"]},
        })
    except (OSError, sqlite3.Error, TransformError, ValueError) as exc:
        print(f"transform blocked: {exc}", file=sys.stderr)
        return 2
    finally:
        if output is not None:
            for connection in (output.catalog, output.account, output.ops):
                connection.close()
    print(f"transform complete: {args.output}")
    print("Vectorize/reconciliation remain pending; this is not cutover approval.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
