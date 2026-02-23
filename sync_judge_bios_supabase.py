#!/usr/bin/env python3
"""
sync_judge_bios_supabase.py

Sync downloaded_cases/judge_bios.json → Supabase judge_bios table.
Uses upsert so it's safe to re-run after updates.

Usage:
    python3 sync_judge_bios_supabase.py            # full sync (104 members)
    python3 sync_judge_bios_supabase.py --dry-run  # preview only
"""

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv


def _find_and_load_env():
    p = Path(__file__).parent
    for _ in range(8):
        candidate = p / ".env"
        if candidate.exists():
            load_dotenv(candidate, override=True)
            return
        p = p.parent


_find_and_load_env()

JUDGE_BIOS_PATH = Path("downloaded_cases/judge_bios.json")
SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")


def load_judge_bios() -> dict:
    if not JUDGE_BIOS_PATH.exists():
        print(f"ERROR: {JUDGE_BIOS_PATH} not found", file=sys.stderr)
        sys.exit(1)
    with open(JUDGE_BIOS_PATH, encoding="utf-8") as f:
        return json.load(f)


def transform_member(name_key: str, member: dict) -> dict:
    """Convert one judge_bios entry into a flat Supabase row."""
    # education and notable_cases are already JSON-serialisable
    row = {
        "id":                       name_key,
        "full_name":                member.get("full_name") or name_key.title(),
        "role":                     member.get("role"),
        "court":                    member.get("court"),
        "appointed_year":           str(member["appointed_year"]) if member.get("appointed_year") else None,
        "registry":                 member.get("registry"),
        "specialization":           member.get("specialization"),
        "formerly_known_as":        member.get("formally_known_as") or member.get("formerly_known_as"),
        "birth_year":               member.get("birth_year"),
        "previously":               member.get("previously"),
        "current_role_desc":        member.get("current_role_desc"),
        "source_url":               member.get("source_url"),
        "photo_url":                member.get("photo_url"),
        "has_legal_qualification":  member.get("has_legal_qualification"),
        "no_legal_qualification":   member.get("no_legal_qualification"),
        "qualification_confidence": member.get("qualification_confidence"),
        "qualification_notes":      member.get("qualification_notes"),
        "found":                    member.get("found"),
        "source":                   member.get("source"),
        # JSONB fields — pass as Python objects; supabase-py serialises to JSON
        "education":                member.get("education") or [],
        "notable_cases":            member.get("notable_cases") or [],
        "appointment_history":      member.get("appointment_history") or [],
        "sources":                  member.get("sources"),
        "social_media":             member.get("social_media"),
    }
    # Remove None values (Supabase will use column defaults / set NULL)
    return {k: v for k, v in row.items() if v is not None}


def sync_to_supabase(rows: list[dict], dry_run: bool) -> None:
    try:
        from supabase import create_client
    except ImportError:
        print("ERROR: pip install supabase", file=sys.stderr)
        sys.exit(1)

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env", file=sys.stderr)
        sys.exit(1)

    if dry_run:
        print(f"[dry-run] Would upsert {len(rows)} rows to judge_bios")
        for r in rows[:3]:
            print(f"  {r['id']}: {r['full_name']} — education={len(r.get('education', []))} entries")
        print("  ... (showing 3 of", len(rows), ")")
        return

    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Upsert in batches of 50
    batch_size = 50
    total = len(rows)
    synced = 0

    for i in range(0, total, batch_size):
        batch = rows[i : i + batch_size]
        result = client.table("judge_bios").upsert(batch, on_conflict="id").execute()
        synced += len(batch)
        print(f"  ✓ Upserted {synced}/{total} members")

    print(f"\n✅ Done — {total} judge bios synced to Supabase judge_bios table")


def main():
    parser = argparse.ArgumentParser(description="Sync judge_bios.json to Supabase")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    args = parser.parse_args()

    print(f"Loading {JUDGE_BIOS_PATH}...")
    data = load_judge_bios()
    print(f"Found {len(data)} members")

    rows = [transform_member(k, v) for k, v in data.items()]

    # Quick stats
    has_education = sum(1 for r in rows if r.get("education"))
    has_legal = sum(1 for r in rows if r.get("has_legal_qualification"))
    no_legal = sum(1 for r in rows if r.get("no_legal_qualification"))
    print(f"  Education data:     {has_education}/104")
    print(f"  Confirmed legal:    {has_legal}")
    print(f"  Confirmed no legal: {no_legal}")
    print()

    sync_to_supabase(rows, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
