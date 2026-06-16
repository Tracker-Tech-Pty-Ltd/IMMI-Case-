"""
Download full text for the 22 cases identified as missing.

Fixes known URL issues (trailing dots) before attempting download.
Safe to run multiple times — skips already-downloaded cases.

Usage: python download_missing_22.py
"""

import os
import sys
import pandas as pd
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from immi_case_downloader.sources.austlii import AustLIIScraper
from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.storage import save_case_text

CSV_PATH = "downloaded_cases/immigration_cases.csv"
DELAY = 1.5  # Be gentle — AustLII may have rate-limited us


def log(msg):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] {msg}", flush=True)


def main():
    df = pd.read_csv(CSV_PATH, low_memory=False)
    log(f"Loaded {len(df):,} records")

    # Find cases without full_text_path
    mask = df["full_text_path"].isna() | (df["full_text_path"].astype(str).isin(["", "nan"]))
    # Exclude test junk (no URL = not a real case)
    mask = mask & df["url"].notna()
    missing = df[mask].copy()
    log(f"Found {len(missing)} cases missing full text")

    if len(missing) == 0:
        log("Nothing to download!")
        return

    # Fix known URL issues: trailing dots on ARTA URLs
    fixed = 0
    for idx in missing.index:
        url = str(missing.at[idx, "url"])
        if url.endswith("."):
            clean_url = url.rstrip(".")
            missing.at[idx, "url"] = clean_url
            df.at[idx, "url"] = clean_url
            fixed += 1
    if fixed:
        log(f"Fixed {fixed} URLs with trailing dots")

    scraper = AustLIIScraper(delay=DELAY)
    downloaded = 0
    failed = 0

    for i, (idx, row) in enumerate(missing.iterrows()):
        case = ImmigrationCase.from_dict(row.to_dict())

        # Skip if file already exists on disk
        if case.full_text_path and os.path.exists(case.full_text_path):
            log(f"  [{i+1}/{len(missing)}] SKIP (exists): {case.citation or case.title[:50]}")
            continue

        log(f"  [{i+1}/{len(missing)}] Downloading: {case.citation or case.title[:50]}...")

        try:
            text = scraper.download_case_detail(case)
            if text:
                filepath = save_case_text(case, text)
                df.at[idx, "full_text_path"] = filepath

                # Update extracted metadata
                for field in ("date", "judges", "catchwords", "outcome",
                              "visa_type", "legislation", "citation"):
                    val = getattr(case, field, "")
                    if val and str(val) != "nan":
                        df.at[idx, field] = val

                downloaded += 1
                log(f"    OK → {filepath}")
            else:
                failed += 1
                log("    FAILED (no content)")
        except Exception as e:
            failed += 1
            log(f"    FAILED: {e}")

    # Save updated CSV
    if downloaded > 0:
        df.to_csv(CSV_PATH, index=False)
        log(f"CSV saved with {downloaded} new full texts")

    log(f"\nDone! Downloaded: {downloaded}, Failed: {failed}, Total missing: {len(missing)}")


if __name__ == "__main__":
    main()
