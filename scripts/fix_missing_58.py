"""
Fix the 58 missing full-text cases:
- Download 56 real cases from AustLII (with proper browser UA)
- Remove 2 E2E test junk records (year=0, title=Create-Test-*)

Usage:
    python scripts/fix_missing_58.py           # dry run
    python scripts/fix_missing_58.py --apply   # actually fix
"""

import argparse
import os
import re
import sys
import time
from pathlib import Path

import pandas as pd
import requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CSV_PATH = Path("downloaded_cases/immigration_cases.csv")
TEXT_DIR = Path("downloaded_cases/case_texts")

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

HEADERS = {"User-Agent": USER_AGENT}


def extract_text_from_html(html: str) -> str:
    """Extract case text from AustLII HTML page."""
    soup = BeautifulSoup(html, "html.parser")

    # Try multiple selectors (same as Worker parser.ts)
    content = soup.find("div", id="cases_doc")
    if not content:
        content = soup.find("div", class_="document")
    if not content:
        content = soup.find("article")
    if not content:
        content = soup.body

    if not content:
        return ""

    return content.get_text(separator="\n", strip=True)


def extract_metadata(html: str) -> dict:
    """Extract metadata from HTML (judges, catchwords, outcome)."""
    meta = {}
    text = html

    # Judges
    judges_match = re.search(
        r"(?:JUDGE|MEMBER|JUSTICE|JUDICIAL MEMBER)[S]?\s*[:：]\s*(.+?)(?:\n|<)",
        text, re.IGNORECASE
    )
    if judges_match:
        meta["judges"] = judges_match.group(1).strip()

    # Catchwords
    cw_match = re.search(
        r"CATCHWORDS?\s*[:：]?\s*\n?\s*(.+?)(?:\n\n|\n[A-Z]{3,})",
        text, re.IGNORECASE | re.DOTALL
    )
    if cw_match:
        meta["catchwords"] = cw_match.group(1).strip()[:500]

    # Outcome/Decision
    for pattern in [
        r"DECISION\s*[:：]\s*\n?\s*(.+?)(?:\n\n)",
        r"(?:ORDER|ORDERS)\s*[:：]\s*\n?\s*(.+?)(?:\n\n)",
    ]:
        m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if m:
            meta["outcome"] = m.group(1).strip()[:300]
            break

    return meta


def save_text_file(citation: str, title: str, court: str, date: str, url: str, full_text: str) -> str:
    """Save case text in storage.py compatible format."""
    TEXT_DIR.mkdir(parents=True, exist_ok=True)

    filename_base = citation or title
    filename = "".join(c if c.isalnum() or c in " -_[]" else "_" for c in filename_base)
    filename = filename.strip()[:100] + ".txt"
    filepath = TEXT_DIR / filename

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(f"Title: {title}\n")
        f.write(f"Citation: {citation}\n")
        f.write(f"Court: {court}\n")
        f.write(f"Date: {date}\n")
        f.write(f"URL: {url}\n")
        f.write(f"{'=' * 80}\n\n")
        f.write(full_text)

    return str(filepath)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Actually apply changes")
    args = parser.parse_args()

    df = pd.read_csv(CSV_PATH, dtype={"visa_subclass": str}, low_memory=False)
    print(f"Loaded {len(df):,} records")

    missing = df[df["full_text_path"].isna()]
    print(f"Missing full text: {len(missing)}")

    # --- Step 1: Remove test junk ---
    test_mask = df["title"].astype(str).str.startswith("Create-Test-")
    test_count = test_mask.sum()
    print(f"\nStep 1: Found {test_count} test junk records")

    if args.apply and test_count > 0:
        df = df[~test_mask].reset_index(drop=True)
        print(f"  Removed {test_count} test records")

    # --- Step 2: Download missing cases ---
    real_missing = df[df["full_text_path"].isna() & (df["url"].notna())]
    print(f"\nStep 2: {len(real_missing)} cases to download")

    session = requests.Session()
    session.headers.update(HEADERS)

    downloaded = 0
    failed = 0

    for idx, row in real_missing.iterrows():
        url = str(row["url"]).strip()
        citation = str(row["citation"]) if pd.notna(row["citation"]) else ""
        court = str(row["court_code"]) if pd.notna(row["court_code"]) else ""
        title = str(row["title"]) if pd.notna(row["title"]) else ""
        date_str = str(row["date"]) if pd.notna(row["date"]) else ""

        if not args.apply:
            print(f"  [DRY RUN] Would download: {citation}")
            continue

        try:
            resp = session.get(url, timeout=30, allow_redirects=True)
            if resp.status_code != 200:
                print(f"  FAIL ({resp.status_code}): {citation} — {url}")
                failed += 1
                continue

            html = resp.text
            full_text = extract_text_from_html(html)

            if not full_text or len(full_text) < 50:
                print(f"  FAIL (empty text): {citation}")
                failed += 1
                continue

            filepath = save_text_file(citation, title, court, date_str, url, full_text)
            df.at[idx, "full_text_path"] = filepath

            # Extract metadata if missing
            meta = extract_metadata(html)
            for field, value in meta.items():
                current = str(df.at[idx, field]) if pd.notna(df.at[idx, field]) else ""
                if not current or current == "nan":
                    df.at[idx, field] = value

            downloaded += 1
            print(f"  OK: {citation} ({len(full_text):,} chars)")

            time.sleep(1)  # Respect rate limit

        except Exception as e:
            print(f"  ERROR: {citation} — {e}")
            failed += 1

    print("\n=== Summary ===")
    print(f"Test records removed: {test_count if args.apply else 0}")
    print(f"Downloaded: {downloaded}")
    print(f"Failed: {failed}")
    print(f"Total records: {len(df):,}")

    if args.apply:
        # Atomic save
        backup = str(CSV_PATH) + ".bak_fix58"
        pd.read_csv(CSV_PATH, nrows=0)  # verify readable
        tmp = str(CSV_PATH) + ".tmp"
        df.to_csv(tmp, index=False)
        os.replace(str(CSV_PATH), backup)
        os.replace(tmp, str(CSV_PATH))
        print(f"\nBackup: {backup}")
        print(f"Saved: {CSV_PATH}")
    else:
        print("\n[DRY RUN] No changes made. Use --apply to execute.")


if __name__ == "__main__":
    main()
