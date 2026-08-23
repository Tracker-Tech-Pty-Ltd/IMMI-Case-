#!/usr/bin/env python3
"""Read-only verification for the local IMMI PostgreSQL restore.

The default target is the local Docker container created by the restore run.
The verifier refuses to inspect the shared Supabase project and emits a
deterministic JSON report suitable for repeated evidence checks.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


EXPECTED_ROWS = {
    "council_sessions": 34,
    "council_turns": 34,
    "extraction_audit": 0,
    "immi_collections": 0,
    "immi_saved_searches": 0,
    "immi_tenant_invites": 0,
    "immi_tenant_members": 0,
    "immi_tenants": 0,
    "immi_users": 0,
    "immigration_cases": 149016,
    "immigration_cases_staging": 0,
    "judge_bios": 104,
    "pipeline_runs": 16,
}
EXPECTED_METRICS = {
    "table_count": 13,
    "foreign_keys": 15,
    "indexes": 91,
    "policies": 17,
    "triggers": 2,
}
SOURCE_REF = "urntbuqczarkuoaosjxd"


def _query(container: str, database: str) -> dict[str, object]:
    row_sql = ",\n".join(
        f"    '{name}', (SELECT count(*) FROM public.{name})"
        for name in EXPECTED_ROWS
    )
    sql = f"""
SELECT jsonb_build_object(
  'server_version', current_setting('server_version'),
  'extensions', (SELECT COALESCE(jsonb_agg(extname ORDER BY extname), '[]'::jsonb)
                FROM pg_extension WHERE extname IN ('plpgsql', 'vector')),
  'row_counts', jsonb_build_object({row_sql}),
  'table_count', (SELECT count(*) FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'),
  'foreign_keys', (SELECT count(*) FROM pg_constraint
                   WHERE contype = 'f' AND connamespace = 'public'::regnamespace),
  'indexes', (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public'),
  'policies', (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'),
  'triggers', (SELECT count(*) FROM pg_trigger t
               JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND NOT t.tgisinternal)
)::text;
"""
    result = subprocess.run(
        ["docker", "exec", container, "psql", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-c", sql],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "docker exec psql failed")
    try:
        return json.loads(result.stdout.strip())
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"local psql returned invalid JSON: {exc}") from exc


def build_report(container: str, database: str) -> dict[str, object]:
    if SOURCE_REF in database or SOURCE_REF in container:
        return {"status": "error", "error": "shared Supabase project reference is forbidden"}
    try:
        observed = _query(container, database)
    except (OSError, RuntimeError) as exc:
        return {"status": "error", "error": str(exc)}

    mismatches: dict[str, object] = {}
    if not str(observed.get("server_version", "")).startswith("17."):
        mismatches["server_version"] = observed.get("server_version")
    if set(observed.get("extensions", [])) != {"plpgsql", "vector"}:
        mismatches["extensions"] = observed.get("extensions")
    if observed.get("row_counts") != EXPECTED_ROWS:
        mismatches["row_counts"] = {"expected": EXPECTED_ROWS, "observed": observed.get("row_counts")}
    for key, expected in EXPECTED_METRICS.items():
        if observed.get(key) != expected:
            mismatches[key] = {"expected": expected, "observed": observed.get(key)}
    return {
        "status": "ready" if not mismatches else "blocked",
        "target": {"container": container, "database": database, "shared_project_ref_rejected": True},
        "observed": observed,
        "mismatches": mismatches,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", default="immi-local-pg17")
    parser.add_argument("--database", default="immi_local")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = build_report(args.container, args.database)
    encoded = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0 if report["status"] == "ready" else 1 if report["status"] == "blocked" else 2


if __name__ == "__main__":
    raise SystemExit(main())
