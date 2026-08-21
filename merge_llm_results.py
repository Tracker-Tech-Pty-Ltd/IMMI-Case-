#!/usr/bin/env python3
"""Merge LLM extraction results into the main CSV.

Reads all result_XXXX.json files and updates case_nature/legal_concepts in the CSV.
Safe to run multiple times — only updates empty/missing fields.
"""

import csv
import json
import os
import glob

CSV_PATH = "downloaded_cases/immigration_cases.csv"
BATCH_DIR = "downloaded_cases/llm_batches"


def load_csv():
    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def save_csv(rows):
    if not rows:
        return
    fieldnames = list(rows[0].keys())
    tmp_path = CSV_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    os.replace(tmp_path, CSV_PATH)


def main():
    print("Loading CSV...")
    rows = load_csv()
    print(f"  {len(rows)} records")

    # Find all result files
    result_files = sorted(glob.glob(os.path.join(BATCH_DIR, "result_*.json")))
    print(f"  Found {len(result_files)} result files")

    if not result_files:
        print("No result files found!")
        return

    updated_cn = 0
    updated_lc = 0
    errors = 0
    total_results = 0

    for rf in result_files:
        try:
            with open(rf, "r", encoding="utf-8") as f:
                results = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"  Error reading {rf}: {e}")
            errors += 1
            continue

        for item in results:
            total_results += 1
            idx = item.get("idx")
            if idx is None:
                continue
            idx = int(idx)
            if idx < 0 or idx >= len(rows):
                continue

            cn = item.get("case_nature", "").strip()
            lc = item.get("legal_concepts", "").strip()

            # Only update if currently empty
            if cn and not rows[idx].get("case_nature", "").strip():
                rows[idx]["case_nature"] = cn
                updated_cn += 1
            if lc and not rows[idx].get("legal_concepts", "").strip():
                rows[idx]["legal_concepts"] = lc
                updated_lc += 1

    print(f"\nResults processed: {total_results}")
    print(f"  case_nature updated: {updated_cn}")
    print(f"  legal_concepts updated: {updated_lc}")
    print(f"  File errors: {errors}")

    print("\nSaving CSV...")
    save_csv(rows)
    print("  Done!")

    # Coverage report
    filled_cn = sum(1 for r in rows if r.get("case_nature", "").strip())
    filled_lc = sum(1 for r in rows if r.get("legal_concepts", "").strip())
    print("\nCoverage:")
    print(f"  case_nature: {filled_cn}/{len(rows)} ({filled_cn*100/len(rows):.1f}%)")
    print(f"  legal_concepts: {filled_lc}/{len(rows)} ({filled_lc*100/len(rows):.1f}%)")


if __name__ == "__main__":
    main()
