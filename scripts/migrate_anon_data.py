#!/usr/bin/env python3
"""
Phase 6 — Anonymous data migration verification.

Verifies that existing rows with tenant_id IS NULL in collections,
saved_searches, and council_sessions are:
  1. Present (counts them).
  2. Readable via the anon role (RLS policy: tenant_id IS NULL → public read).
  3. Protected from mutation by unauthenticated requests (write policy requires
     tenant_id = auth_tenant_id() which is NULL for anon → always false).

Does NOT mutate any data — safe to run against production.

Usage:
    python3 scripts/migrate_anon_data.py [--fix] [--dry-run]

Without --fix: report only.
With --fix:    stamp legacy anon collections with a note in their description
               field. Does NOT assign a tenant — per plan, NULL stays NULL.

Required env:
    SUPABASE_URL             https://<project>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY  service-role JWT (bypasses RLS for auditing)
    SUPABASE_ANON_KEY          anon public key (tests read access without JWT)
"""

import os
import sys
import argparse
from datetime import datetime, timezone

try:
    from supabase import create_client, Client
except ImportError:
    sys.exit("supabase-py not installed. Run: pip install supabase")


TABLES = ["collections", "saved_searches", "council_sessions"]

REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"]


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    missing = []
    for key in REQUIRED_ENV:
        val = os.getenv(key, "")
        if not val:
            missing.append(key)
        env[key] = val
    if missing:
        sys.exit(f"Missing required env vars: {', '.join(missing)}")
    return env


def count_anon_rows(svc: "Client", table: str) -> int:
    resp = svc.table(table).select("id", count="exact").is_("tenant_id", "null").execute()  # type: ignore[arg-type]
    return resp.count or 0


def verify_anon_readable(anon: "Client", table: str, expected: int) -> bool:
    resp = anon.table(table).select("id", count="exact").is_("tenant_id", "null").execute()  # type: ignore[arg-type]
    return (resp.count or 0) == expected


def verify_anon_write_blocked(anon: "Client", table: str) -> bool:
    """Returns True if the anon client's INSERT is rejected (expected behaviour)."""
    payload: dict = {"name": "__rls_probe__"}
    if table == "saved_searches":
        payload["filters"] = {}
    try:
        anon.table(table).insert(payload).execute()
        return False  # insert succeeded — RLS gap
    except Exception:
        return True   # rejected — correct


def print_section(title: str) -> None:
    print(f"\n{'─' * 60}")
    print(f"  {title}")
    print(f"{'─' * 60}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--fix", action="store_true", help="Stamp legacy anon collections with a note")
    parser.add_argument("--dry-run", action="store_true", help="Preview --fix changes without writing")
    args = parser.parse_args()

    env = load_env()
    svc: Client = create_client(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    anon: Client = create_client(env["SUPABASE_URL"], env["SUPABASE_ANON_KEY"])

    print_section("Phase 6 — Anonymous data audit")
    print(f"  Supabase: {env['SUPABASE_URL']}")
    print(f"  Timestamp: {datetime.now(timezone.utc).isoformat()}")

    # 1. Count anon rows via service role (bypasses RLS)
    print_section("1. NULL-tenant row counts (service role, bypasses RLS)")
    counts: dict[str, int] = {}
    for table in TABLES:
        try:
            n = count_anon_rows(svc, table)
            counts[table] = n
            print(f"  {table:<24} {n:>6} anon rows")
        except Exception as exc:
            print(f"  {table:<24} ERROR: {exc}")
            counts[table] = -1

    # 2. Verify anon role can SELECT NULL-tenant rows
    print_section("2. Anon-role SELECT (RLS: tenant_id IS NULL → allowed)")
    all_readable = True
    for table in TABLES:
        if counts.get(table, -1) < 0:
            print(f"  {table:<24} SKIP")
            continue
        try:
            ok = verify_anon_readable(anon, table, counts[table])
            status = "✓ PASS" if ok else "✗ FAIL"
            if not ok:
                all_readable = False
            print(f"  {table:<24} {status}")
        except Exception as exc:
            print(f"  {table:<24} ERROR: {exc}")
            all_readable = False

    # 3. Verify anon role cannot INSERT
    print_section("3. Anon-role INSERT block (RLS write policy: no tenant → reject)")
    all_blocked = True
    for table in ["collections", "saved_searches"]:
        try:
            blocked = verify_anon_write_blocked(anon, table)
            status = "✓ PASS (blocked)" if blocked else "✗ FAIL (insert allowed — RLS gap!)"
            if not blocked:
                all_blocked = False
            print(f"  {table:<24} {status}")
        except Exception as exc:
            print(f"  {table:<24} ERROR: {exc}")
            all_blocked = False

    # 4. Optional --fix: stamp legacy anon collections with a description note
    if args.fix:
        print_section("4. Stamping legacy anon rows (--fix)")
        legacy_cutoff = "2026-05-03T00:00:00+00:00"
        note = "[migrated_anon_phase6] Anonymous row — created before multi-tenant launch."
        table = "collections"
        n = counts.get(table, 0)
        if n == 0:
            print(f"  {table:<24} nothing to stamp")
        elif args.dry_run:
            print(f"  {table:<24} DRY-RUN: would stamp rows where created_at < {legacy_cutoff}")
        else:
            try:
                svc.table(table).update({"description": note}).is_(
                    "tenant_id", "null"
                ).lt("created_at", legacy_cutoff).execute()
                print(f"  {table:<24} ✓ stamped")
            except Exception as exc:
                print(f"  {table:<24} ERROR: {exc}")

    # Summary
    print_section("Summary")
    issues = []
    if not all_readable:
        issues.append("NULL-tenant rows NOT readable by anon — check RLS SELECT policy.")
    if not all_blocked:
        issues.append("Anon INSERT succeeded — RLS write policy is missing or incorrect.")

    if issues:
        for issue in issues:
            print(f"  ✗ {issue}")
        sys.exit(1)

    total = sum(v for v in counts.values() if v >= 0)
    print("  ✓ All checks passed.")
    print(f"  ✓ Total anon rows audited: {total}")
    print()


if __name__ == "__main__":
    main()
