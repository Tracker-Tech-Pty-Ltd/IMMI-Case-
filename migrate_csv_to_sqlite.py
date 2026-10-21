#!/usr/bin/env python3
"""Migrate cases from CSV to SQLite database.

Usage:
    python migrate_csv_to_sqlite.py                    # default directory
    python migrate_csv_to_sqlite.py --output mydata    # custom directory
"""

import argparse
import os
import sys
import time
from pathlib import Path

from immi_case_downloader.config import OUTPUT_DIR
from immi_case_downloader.storage import load_all_cases
from immi_case_downloader.sqlite_repository import SqliteRepository
from immi_case_downloader.ingestion import import_local_cases
from immi_case_downloader.repair_workflow import write_json


def main():
    parser = argparse.ArgumentParser(description="Migrate CSV data to SQLite")
    parser.add_argument("--output", default=OUTPUT_DIR, help="Data directory")
    args = parser.parse_args()

    csv_path = os.path.join(args.output, "immigration_cases.csv")
    db_path = os.path.join(args.output, "cases.db")

    if not os.path.exists(csv_path):
        print(f"CSV file not found: {csv_path}")
        sys.exit(1)

    print(f"Loading cases from {csv_path}...")
    cases = load_all_cases(args.output, use_cache=False)
    print(f"  Loaded {len(cases)} cases from CSV.")

    print(f"Creating SQLite database: {db_path}...")
    repo = SqliteRepository(db_path)

    t0 = time.time()
    result = import_local_cases(repo, cases, args.output)
    count = result["changed_rows"]
    write_json(Path(args.output) / ".last-import-review.json", result)
    elapsed = time.time() - t0
    print(f"  Inserted/filled {count} cases in {elapsed:.1f}s; preserved existing values.")

    # Verify
    db_count = len(repo.load_all())
    print(f"  Verification: {db_count} cases in SQLite.")

    expected = {case.case_id for case in cases}
    present = {case.case_id for case in repo.load_all()}
    unresolved = expected - present
    if not unresolved:
        print("Migration successful! All CSV case IDs are present; local-only rows retained.")
    else:
        print(f"WARNING: {len(unresolved)} CSV identities require review; see .last-import-review.json")
        sys.exit(1)

    # Show FTS test
    test_query = "visa refusal"
    fts_results = repo.search_text(test_query, limit=5)
    print(f"\n  FTS test '{test_query}': {len(fts_results)} results")
    for c in fts_results[:3]:
        print(f"    - {c.citation}: {c.title[:60]}")

    print(f"\nDone! SQLite database ready at {db_path}")
    print(f"  File size: {os.path.getsize(db_path) / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
