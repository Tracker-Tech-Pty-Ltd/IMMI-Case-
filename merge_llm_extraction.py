"""
Merge LLM extraction results back into the main CSV.

Reads all batch_*_results.json files and updates outcome + legal_concepts.

Usage: python merge_llm_extraction.py [--dry-run]
"""

import json
import sys
import shutil
import pandas as pd
from datetime import datetime
from pathlib import Path

CSV_PATH = "downloaded_cases/immigration_cases.csv"
RESULTS_DIR = "downloaded_cases/llm_extraction_results"

VALID_OUTCOMES = {
    "affirmed", "dismissed", "set aside", "remitted", "allowed",
    "granted", "refused", "quashed", "withdrawn", "no jurisdiction",
    "upheld", "adjourned", "by consent", "struck out", "discontinued",
}


def main():
    dry_run = "--dry-run" in sys.argv

    # Load all result files
    results_dir = Path(RESULTS_DIR)
    if not results_dir.exists():
        print(f"No results directory: {RESULTS_DIR}")
        return

    all_results = {}
    files = sorted(results_dir.glob("batch_*_results.json"))
    print(f"Found {len(files)} result files")

    for f in files:
        with open(f) as fh:
            batch = json.load(fh)
            for item in batch:
                cid = item.get("case_id", "")
                if cid:
                    all_results[cid] = item
        print(f"  {f.name}: {len(batch)} results")

    print(f"\nTotal unique results: {len(all_results):,}")

    if not all_results:
        print("No results to merge.")
        return

    df = pd.read_csv(CSV_PATH, low_memory=False)
    print(f"CSV: {len(df):,} records")

    outcome_updated = 0
    lc_updated = 0

    for idx, row in df.iterrows():
        cid = str(row["case_id"])
        if cid not in all_results:
            continue

        result = all_results[cid]

        # Update outcome if currently Unknown
        if str(row.get("outcome", "")) == "Unknown":
            new_outcome = result.get("outcome", "")
            if new_outcome and new_outcome.lower() in VALID_OUTCOMES:
                df.at[idx, "outcome"] = new_outcome.title() if new_outcome.lower() != "set aside" else "Set aside"
                outcome_updated += 1

        # Update legal_concepts if missing
        current_lc = str(row.get("legal_concepts", ""))
        if current_lc.strip() in ("", "nan"):
            new_lc = result.get("legal_concepts", "")
            if new_lc and new_lc.strip() and new_lc.lower() != "none":
                df.at[idx, "legal_concepts"] = new_lc
                lc_updated += 1

    print(f"\nOutcome updated: {outcome_updated:,}")
    print(f"Legal concepts updated: {lc_updated:,}")

    if dry_run:
        print("\n[DRY RUN] No files written.")
    else:
        backup = f"{CSV_PATH}.bak-{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(CSV_PATH, backup)
        df.to_csv(CSV_PATH, index=False)
        print(f"\nCSV saved. Backup: {backup}")

    # Final stats
    remaining_unknown = (df["outcome"] == "Unknown").sum()
    remaining_no_lc = (df["legal_concepts"].isna() | df["legal_concepts"].astype(str).str.strip().isin(["", "nan"])).sum()
    print(f"\nRemaining Unknown outcome: {remaining_unknown:,}")
    print(f"Remaining missing legal_concepts: {remaining_no_lc:,}")


if __name__ == "__main__":
    main()
