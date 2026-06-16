"""
Sync immigration_cases.json → immigration_cases.csv.

JSON has 149,023 records (complete dataset).
CSV has ~62,544 records (subset with full_text_path populated).

This script merges JSON records into CSV, preserving CSV values where they exist
(e.g., full_text_path, extracted metadata fields).

Usage:
    python scripts/json_to_csv.py              # dry-run (show stats only)
    python scripts/json_to_csv.py --apply       # actually write merged CSV
    python scripts/json_to_csv.py --apply --backup  # backup CSV first
"""

import argparse
import json
import os
import shutil
import sys
from datetime import datetime

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from immi_case_downloader.models import ImmigrationCase

BASE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "downloaded_cases")
CSV_PATH = os.path.join(BASE_DIR, "immigration_cases.csv")
JSON_PATH = os.path.join(BASE_DIR, "immigration_cases.json")


def load_json_records(path: str) -> list[dict]:
    """Load and normalize JSON records using ImmigrationCase.from_dict()."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # JSON has a wrapper: {"total_cases": ..., "cases": [...]}
    raw = data["cases"] if isinstance(data, dict) and "cases" in data else data

    records = []
    for item in raw:
        case = ImmigrationCase.from_dict(item)
        case.ensure_id()
        records.append(case.to_dict())
    return records


def merge_dataframes(df_json: pd.DataFrame, df_csv: pd.DataFrame) -> pd.DataFrame:
    """Merge JSON and CSV DataFrames, preserving CSV values where non-empty.

    Strategy:
    - Use URL as the merge key (most reliable unique identifier)
    - For records in both: keep CSV values for non-empty fields, fill gaps from JSON
    - For records only in JSON: add them as new rows
    - For records only in CSV: keep them (shouldn't happen, but safety)
    """
    # Ensure URL columns are clean strings
    df_json["url"] = df_json["url"].astype(str).str.strip()
    df_csv["url"] = df_csv["url"].astype(str).str.strip()

    # Remove duplicates within JSON (keep first)
    df_json = df_json.drop_duplicates(subset="url", keep="first")

    csv_urls = set(df_csv["url"].tolist())
    json_urls = set(df_json["url"].tolist())

    only_in_csv = csv_urls - json_urls
    only_in_json = json_urls - csv_urls
    in_both = csv_urls & json_urls

    print(f"  Records in CSV only: {len(only_in_csv)}")
    print(f"  Records in JSON only: {len(only_in_json)}")
    print(f"  Records in both: {len(in_both)}")

    # Start with CSV records (they have priority)
    # For records in both, update empty CSV fields with JSON values
    df_csv_indexed = df_csv.set_index("url", drop=False)
    df_json_indexed = df_json.set_index("url", drop=False)

    # Update CSV records with JSON data for empty fields
    updated_count = 0
    for url in in_both:
        if url not in df_json_indexed.index:
            continue
        json_row = df_json_indexed.loc[url]
        if isinstance(json_row, pd.DataFrame):
            json_row = json_row.iloc[0]

        for col in df_json.columns:
            if col in ("url",):
                continue
            if col not in df_csv_indexed.columns:
                df_csv_indexed[col] = ""

            csv_val = df_csv_indexed.at[url, col] if url in df_csv_indexed.index else ""
            json_val = json_row.get(col, "")

            # Only fill if CSV value is empty/NaN
            is_csv_empty = (
                pd.isna(csv_val)
                or str(csv_val).strip() in ("", "nan", "0")
                and col not in ("year",)
            )

            if is_csv_empty and json_val and str(json_val).strip() not in ("", "nan"):
                df_csv_indexed.at[url, col] = json_val
                updated_count += 1

    print(f"  Fields updated from JSON for existing records: {updated_count}")

    # Add JSON-only records
    if only_in_json:
        new_rows = df_json_indexed.loc[df_json_indexed.index.isin(only_in_json)]
        # Ensure columns match
        for col in df_csv_indexed.columns:
            if col not in new_rows.columns:
                new_rows[col] = ""
        new_rows = new_rows[df_csv_indexed.columns]
        df_merged = pd.concat([df_csv_indexed, new_rows], ignore_index=True)
    else:
        df_merged = df_csv_indexed.reset_index(drop=True)

    # Remove duplicate URLs (keep first = CSV version)
    df_merged = df_merged.drop_duplicates(subset="url", keep="first")

    return df_merged


def main():
    parser = argparse.ArgumentParser(description="Sync JSON → CSV for immigration cases")
    parser.add_argument("--apply", action="store_true", help="Actually write the merged CSV")
    parser.add_argument("--backup", action="store_true", help="Create backup of CSV before writing")
    args = parser.parse_args()

    print("=" * 60)
    print("JSON → CSV Sync")
    print("=" * 60)

    # Validate files exist
    if not os.path.exists(JSON_PATH):
        print(f"ERROR: JSON file not found: {JSON_PATH}")
        sys.exit(1)
    if not os.path.exists(CSV_PATH):
        print(f"ERROR: CSV file not found: {CSV_PATH}")
        sys.exit(1)

    # Load JSON
    print(f"\nLoading JSON from {JSON_PATH}...")
    json_records = load_json_records(JSON_PATH)
    df_json = pd.DataFrame(json_records)
    print(f"  JSON records: {len(df_json)}")

    # Load CSV
    print(f"\nLoading CSV from {CSV_PATH}...")
    df_csv = pd.read_csv(CSV_PATH, encoding="utf-8-sig", dtype={"visa_subclass": str})
    print(f"  CSV records: {len(df_csv)}")

    # Merge
    print("\nMerging...")
    df_merged = merge_dataframes(df_json, df_csv)
    print(f"\n  Final merged record count: {len(df_merged)}")

    # Stats
    has_fulltext = df_merged["full_text_path"].notna() & (df_merged["full_text_path"].astype(str) != "") & (df_merged["full_text_path"].astype(str) != "nan")
    print(f"  Records with full_text_path: {has_fulltext.sum()}")
    print(f"  Records missing full text: {(~has_fulltext).sum()}")

    if args.apply:
        if args.backup:
            backup_path = CSV_PATH + f".backup.{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            shutil.copy2(CSV_PATH, backup_path)
            print(f"\n  Backup saved to: {backup_path}")

        df_merged.to_csv(CSV_PATH, index=False)
        print(f"\n  CSV written: {CSV_PATH}")
        print(f"  Total records: {len(df_merged)}")
    else:
        print("\n  DRY RUN — use --apply to write changes")
        print("  Use --apply --backup to create a backup first")


if __name__ == "__main__":
    main()
