#!/usr/bin/env python3
"""Migrate cases from CSV to Supabase (PostgreSQL).

Usage:
    python migrate_csv_to_supabase.py                     # default directory
    python migrate_csv_to_supabase.py --batch-size 200    # smaller batches
    python migrate_csv_to_supabase.py --dry-run            # count only
"""

import argparse
import sys
import time

from immi_case_downloader.config import OUTPUT_DIR
from immi_case_downloader.storage import load_all_cases
from immi_case_downloader.supabase_repository import SupabaseRepository
import immi_case_downloader.supabase_repository as supa_mod


def main():
    parser = argparse.ArgumentParser(description="Migrate CSV data to Supabase")
    parser.add_argument("--output", default=OUTPUT_DIR, help="Data directory")
    parser.add_argument("--batch-size", type=int, default=500, help="Upsert batch size")
    parser.add_argument("--dry-run", action="store_true", help="Count only, don't upload")
    args = parser.parse_args()

    print(f"Loading cases from {args.output}...")
    cases = load_all_cases(args.output)
    print(f"  Loaded {len(cases)} cases from CSV.")

    if not cases:
        print("No cases to migrate.")
        sys.exit(0)

    if args.dry_run:
        print(f"  Dry run: would upload {len(cases)} cases in "
              f"{(len(cases) + args.batch_size - 1) // args.batch_size} batches.")
        sys.exit(0)

    print("Connecting to Supabase...")
    repo = SupabaseRepository(output_dir=args.output)

    # Override the default batch size if specified
    original_batch = supa_mod.BATCH_SIZE
    if args.batch_size != 500:
        supa_mod.BATCH_SIZE = args.batch_size

    t0 = time.time()
    total = len(cases)
    batch_sz = args.batch_size

    # Upsert with progress reporting
    count = 0
    for i in range(0, total, batch_sz):
        chunk = cases[i:i + batch_sz]
        repo.save_many(chunk)
        count += len(chunk)
        elapsed = time.time() - t0
        rate = count / elapsed if elapsed > 0 else 0
        eta = (total - count) / rate if rate > 0 else 0
        print(f"  {count:,}/{total:,} ({count * 100 // total}%) "
              f"| {rate:.0f}/s | ETA: {eta:.0f}s", flush=True)

    elapsed = time.time() - t0
    print(f"  Upserted {count:,} cases in {elapsed:.1f}s.")

    # Restore batch size
    supa_mod.BATCH_SIZE = original_batch

    # Verify count via statistics RPC
    print("Verifying...")
    stats = repo.get_statistics()
    db_count = stats.get("total", 0)
    print(f"  Supabase row count: {db_count}")

    if db_count >= len(cases):
        print("Migration successful!")
    else:
        print(f"WARNING: Row count mismatch! CSV={len(cases)}, Supabase={db_count}")

    # FTS test
    test_query = "visa refusal"
    fts_results = repo.search_text(test_query, limit=5)
    print(f"\n  FTS test '{test_query}': {len(fts_results)} results")
    for c in fts_results[:3]:
        print(f"    - {c.citation}: {c.title[:60]}")

    print("\nDone! Supabase database ready.")
    print("  Run: python web.py --backend supabase --port 8080")


if __name__ == "__main__":
    main()
