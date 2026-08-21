#!/usr/bin/env python3
"""Extract visa_subclass and visa_class_code from existing case data.

Step 1: Copy visa_subclass_number → visa_subclass (strip .0 suffix)
Step 2: Regex extract from catchwords/visa_type/full text for missing records
Step 3: Fill visa_class_code from regex + lookup table
Step 4: Atomic write back to CSV
"""

import csv
import os
import re
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from immi_case_downloader.storage import CASE_FIELDS

BASE_DIR = Path(__file__).resolve().parent.parent / "downloaded_cases"
CSV_PATH = BASE_DIR / "immigration_cases.csv"
TEXT_DIR = BASE_DIR / "case_texts"

# Regex patterns for extraction
RE_SUBCLASS = re.compile(r"[Ss]ub[-\s]?[Cc]lass\s+(\d{3})")
RE_CLASS_CODE = re.compile(r"\(Class\s+([A-Z]{2})\)")
RE_VISA_NUM = re.compile(r"(?:visa|subclass)\s*(\d{3})", re.IGNORECASE)

# Subclass → Class code mapping (common Australian visa subclasses)
SUBCLASS_TO_CLASS = {
    # Protection visas
    "866": "XA", "790": "XA", "200": "XB", "201": "XB",
    "202": "XB", "203": "XB", "204": "XB",
    # Skilled visas
    "189": "SK", "190": "SN", "191": "PR", "457": "UC", "482": "TS",
    "494": "ER", "491": "SB", "186": "EN", "187": "RS",
    # Student visas
    "500": "TU", "573": "HE", "572": "VT", "574": "MR",
    # Partner visas
    "309": "UF", "820": "UF", "801": "BS", "100": "BS", "300": "PT",
    # Parent visas
    "103": "OF", "143": "DF", "804": "AG", "884": "DP",
    # Visitor visas
    "600": "TV", "601": "EC", "651": "EF", "400": "TA",
    "417": "WH", "462": "WA",
    # Business visas
    "188": "BI", "888": "BL", "132": "BX",
    # Other
    "050": "WE", "051": "WF",  # Bridging
    "449": "ND",  # Humanitarian stay
    "444": "NZ",  # New Zealand citizen
    "155": "NF", "157": "NV",  # Resident return
    "802": "CH",  # Child
    "445": "DL",  # Dependent child
    "116": "CG",  # Close family member
    "836": "TO",  # Temporary protection
    "785": "TP",  # Temporary protection (override)
    "070": "WB", "080": "WD",  # Bridging (removal pending)
}


def load_csv_rows() -> list[dict]:
    """Load all rows from the CSV."""
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        return list(reader)


def save_csv_rows(rows: list[dict]) -> None:
    """Atomic write rows back to CSV."""
    tmp_path = str(CSV_PATH) + ".tmp"
    with open(tmp_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CASE_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    os.replace(tmp_path, CSV_PATH)


def clean_subclass_number(val: str) -> str:
    """Clean a subclass number: strip .0 suffix, whitespace."""
    if not val or val == "nan":
        return ""
    val = val.strip()
    if val.endswith(".0"):
        val = val[:-2]
    # Ensure it looks like a valid subclass number (1-4 digits)
    if re.match(r"^\d{1,4}$", val):
        return val
    return ""


def extract_subclass_from_text(text: str) -> str:
    """Extract visa subclass number from text content."""
    match = RE_SUBCLASS.search(text)
    if match:
        return match.group(1)
    match = RE_VISA_NUM.search(text)
    if match:
        return match.group(1)
    return ""


def extract_class_code_from_text(text: str) -> str:
    """Extract visa class code from text content."""
    match = RE_CLASS_CODE.search(text)
    if match:
        return match.group(1)
    return ""


def get_full_text_content(row: dict) -> str:
    """Read first 3000 chars of full text for a case."""
    path = row.get("full_text_path", "")
    if not path:
        return ""
    # Try the path directly, then relative to TEXT_DIR
    for candidate in [path, TEXT_DIR / Path(path).name]:
        try:
            with open(candidate, "r", encoding="utf-8", errors="ignore") as f:
                return f.read(3000)
        except (FileNotFoundError, OSError):
            continue
    return ""


def main():
    print("Loading CSV...")
    rows = load_csv_rows()
    total = len(rows)
    print(f"Loaded {total:,} rows")

    # Stats tracking
    stats = {
        "step1_copied": 0,
        "step2_regex_catchwords": 0,
        "step2_regex_visa_type": 0,
        "step2_regex_fulltext": 0,
        "step3_class_from_text": 0,
        "step3_class_from_lookup": 0,
        "already_had_subclass": 0,
        "already_had_class_code": 0,
    }

    # Step 1: Copy visa_subclass_number → visa_subclass
    print("\n--- Step 1: Copy visa_subclass_number → visa_subclass ---")
    for row in rows:
        existing = (row.get("visa_subclass") or "").strip()
        if existing and existing != "nan":
            stats["already_had_subclass"] += 1
            continue

        vsn = clean_subclass_number(row.get("visa_subclass_number", ""))
        if vsn:
            row["visa_subclass"] = vsn
            stats["step1_copied"] += 1

    print(f"  Copied: {stats['step1_copied']:,}")
    print(f"  Already had: {stats['already_had_subclass']:,}")

    # Step 2: Regex extract for remaining missing records
    print("\n--- Step 2: Regex extract for missing records ---")
    missing_count = sum(1 for r in rows if not (r.get("visa_subclass") or "").strip() or r.get("visa_subclass") == "nan")
    print(f"  Still missing: {missing_count:,}")

    for i, row in enumerate(rows):
        existing = (row.get("visa_subclass") or "").strip()
        if existing and existing != "nan":
            continue

        # Try catchwords first
        catchwords = row.get("catchwords", "")
        if catchwords:
            subclass = extract_subclass_from_text(catchwords)
            if subclass:
                row["visa_subclass"] = subclass
                stats["step2_regex_catchwords"] += 1
                continue

        # Try visa_type field
        visa_type = row.get("visa_type", "")
        if visa_type:
            subclass = extract_subclass_from_text(visa_type)
            if subclass:
                row["visa_subclass"] = subclass
                stats["step2_regex_visa_type"] += 1
                continue

        # Try full text (first 3000 chars)
        full_text = get_full_text_content(row)
        if full_text:
            subclass = extract_subclass_from_text(full_text)
            if subclass:
                row["visa_subclass"] = subclass
                stats["step2_regex_fulltext"] += 1

    print(f"  From catchwords: {stats['step2_regex_catchwords']:,}")
    print(f"  From visa_type: {stats['step2_regex_visa_type']:,}")
    print(f"  From full text: {stats['step2_regex_fulltext']:,}")

    # Step 3: Fill visa_class_code
    print("\n--- Step 3: Fill visa_class_code ---")
    for row in rows:
        existing_cc = (row.get("visa_class_code") or "").strip()
        if existing_cc and existing_cc != "nan":
            stats["already_had_class_code"] += 1
            continue

        # Try regex from catchwords/visa_type/full text
        for field_name in ["catchwords", "visa_type"]:
            text = row.get(field_name, "")
            if text:
                cc = extract_class_code_from_text(text)
                if cc:
                    row["visa_class_code"] = cc
                    stats["step3_class_from_text"] += 1
                    break
        else:
            # Fallback: lookup table
            subclass = (row.get("visa_subclass") or "").strip()
            if subclass and subclass in SUBCLASS_TO_CLASS:
                row["visa_class_code"] = SUBCLASS_TO_CLASS[subclass]
                stats["step3_class_from_lookup"] += 1

    print(f"  Already had: {stats['already_had_class_code']:,}")
    print(f"  From text regex: {stats['step3_class_from_text']:,}")
    print(f"  From lookup table: {stats['step3_class_from_lookup']:,}")

    # Clean up nan values
    for row in rows:
        for field in ["visa_subclass", "visa_class_code"]:
            val = row.get(field, "")
            if val == "nan" or val is None:
                row[field] = ""

    # Final stats
    has_subclass = sum(1 for r in rows if (r.get("visa_subclass") or "").strip())
    has_class_code = sum(1 for r in rows if (r.get("visa_class_code") or "").strip())
    print("\n--- Final Results ---")
    print(f"  visa_subclass: {has_subclass:,} / {total:,} ({has_subclass/total*100:.1f}%)")
    print(f"  visa_class_code: {has_class_code:,} / {total:,} ({has_class_code/total*100:.1f}%)")

    # Step 4: Atomic write
    print("\nSaving CSV...")
    save_csv_rows(rows)
    print("Done!")


if __name__ == "__main__":
    main()
