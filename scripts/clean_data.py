"""
Data cleaning & refinement for immigration_cases.csv.

Fixes:
1. Outcome standardization — 15,941 unique values → ~10 standard categories
2. Re-extract outcome from full text for DECISION RECORD/REASONS cases
3. Normalize respondent field
4. Clean up visa_type formatting

Usage:
    python scripts/clean_data.py              # dry run with stats
    python scripts/clean_data.py --apply      # apply changes
"""

import argparse
import os
import re
from pathlib import Path

import pandas as pd

CSV_PATH = Path("downloaded_cases/immigration_cases.csv")


# ──────────────────────────────────────────
# 1. Outcome standardization
# ──────────────────────────────────────────

OUTCOME_MAP = {
    # Standard categories
    "Affirmed": "Affirmed",
    "Dismissed": "Dismissed",
    "Remitted": "Remitted",
    "Set aside": "Set aside",
    "Allowed": "Allowed",
    "Granted": "Granted",
    "Refused": "Refused",
    "No jurisdiction": "No jurisdiction",
    "Withdrawn": "Withdrawn",
    "Quashed": "Quashed",
}


def standardize_outcome(raw: str) -> str:
    """Map a raw outcome string to a standard category."""
    if not raw or raw == "nan":
        return ""

    s = raw.strip()

    # Direct match
    for key, val in OUTCOME_MAP.items():
        if s.lower() == key.lower():
            return val

    # Known non-outcome headers — these need text extraction
    non_outcomes = [
        r"^DECISION\s*RECORD$",
        r"^DECISION\s*$",
        r"^DECISION\s+AND\s+REASONS",
        r"^ORDERS?$",
        r"^ORDER\s*:",
        r"^DECISION\s*:",
        r"^decision\s*\.\s*$",
        r"^decision\s*$",
    ]
    for pat in non_outcomes:
        if re.match(pat, s, re.IGNORECASE):
            return ""  # Signal: need text extraction

    # Pattern matching (order matters — most specific first)
    checks = [
        (r"\baffirm", "Affirmed"),
        (r"\bset\s+aside", "Set aside"),
        (r"\bremit", "Remitted"),
        (r"\bdismiss", "Dismissed"),
        (r"\ballow", "Allowed"),
        (r"\bgrant", "Granted"),
        (r"\brefus", "Refused"),
        (r"\bcancel", "Cancelled"),
        (r"\bno\s+jurisdiction", "No jurisdiction"),
        (r"\bjurisdictional\s+error", "Set aside"),
        (r"\bno\s+reviewable\s+error", "Dismissed"),
        (r"\bwithdra", "Withdrawn"),
        (r"\bquash", "Quashed"),
    ]
    for pattern, category in checks:
        if re.search(pattern, s, re.IGNORECASE):
            return category

    return ""  # Couldn't classify


def extract_outcome_from_text(filepath: str) -> str:
    """Extract the actual outcome from a case's full text file."""
    if not filepath or not os.path.exists(filepath):
        return ""

    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
    except Exception:
        return ""

    # Search for outcome patterns (ordered by reliability)
    patterns = [
        # Tribunal affirms/remits/sets aside
        (r"(?:The|the)\s+Tribunal\s+(affirms|sets\s+aside|remits)", None),
        # "The application is dismissed/allowed"
        (r"(?:The|the)\s+(?:application|appeal|review)\s+(?:is|was|be)\s+(affirmed|dismissed|allowed|remitted|refused|set\s+aside|granted|withdrawn)", None),
        # "visa is/was granted/refused/cancelled"
        (r"(?:visa|application)\s+(?:is|was|be)\s+(granted|refused|cancelled)", None),
        # DECISION: The Tribunal affirms...
        (r"DECISION\s*[:：]\s*(?:The\s+)?(?:Tribunal\s+)?(affirms|remits|sets\s+aside|dismisses)", None),
        # The matter is remitted
        (r"(?:The|the)\s+(?:matter|case)\s+(?:is|was|be)\s+(remitted|dismissed|allowed)", None),
        # "I affirm/set aside/remit"
        (r"\bI\s+(affirm|set\s+aside|remit)", None),
        # "appeal dismissed/allowed" near end
        (r"(?:appeal|application)\s+(dismissed|allowed|refused|granted)", None),
    ]

    for pattern, _ in patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            found = m.group(1).strip().lower()
            # Map to standard
            if "affirm" in found:
                return "Affirmed"
            elif "set" in found and "aside" in found:
                return "Set aside"
            elif "remit" in found:
                return "Remitted"
            elif "dismiss" in found:
                return "Dismissed"
            elif "allow" in found:
                return "Allowed"
            elif "grant" in found:
                return "Granted"
            elif "refus" in found:
                return "Refused"
            elif "cancel" in found:
                return "Cancelled"
            elif "withdraw" in found:
                return "Withdrawn"

    return ""


# ──────────────────────────────────────────
# 2. Respondent normalization
# ──────────────────────────────────────────

RESPONDENT_MAP = {
    # Full names → abbreviations
    "Minister for Immigration and Border Protection": "MIBP",
    "Minister for Immigration and Citizenship": "MIC",
    "Minister for Immigration and Multicultural Affairs": "MIMA",
    "Minister for Immigration and Multicultural and Indigenous Affairs": "MIMIA",
    "Minister for Immigration, Citizenship, Migrant Services and Multicultural Affairs": "MICMSMA",
    "Minister for Immigration, Citizenship and Multicultural Affairs": "MICMA",
    "Minister for Home Affairs": "MHA",
    "Minister for Immigration and Ethnic Affairs": "MIEA",
    # Common abbreviations in data (with &)
    "Minister for Immigration & Multicultural & Indigenous Affairs": "MIMIA",
    "Minister for Immigration & Multicultural Affairs": "MIMA",
    "Minister for Immigration & Anor": "Minister for Immigration",
    "Minister for Immigration & Citizenship": "MIC",
    "Minister for Immigration & Border Protection": "MIBP",
}


def normalize_respondent(raw: str) -> str:
    """Standardize long minister titles to abbreviations."""
    if not raw or raw == "nan":
        return ""
    s = raw.strip()
    # Try exact match first (case-insensitive), then substring
    for long_name, short in sorted(RESPONDENT_MAP.items(), key=lambda x: -len(x[0])):
        if long_name.lower() == s.lower():
            return short
    for long_name, short in sorted(RESPONDENT_MAP.items(), key=lambda x: -len(x[0])):
        if long_name.lower() in s.lower():
            return short
    return s


# ──────────────────────────────────────────
# 3. Visa type cleanup
# ──────────────────────────────────────────

def clean_visa_type(raw: str) -> str:
    """Clean up visa_type formatting artifacts."""
    if not raw or raw == "nan":
        return ""
    s = raw.strip()
    # Remove trailing colons/semicolons
    s = re.sub(r"[;:]+$", "", s).strip()
    # Collapse multiple spaces
    s = re.sub(r"\s+", " ", s)
    return s


# ──────────────────────────────────────────
# Main
# ──────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    df = pd.read_csv(CSV_PATH, dtype={"visa_subclass": str}, low_memory=False)
    total = len(df)
    print(f"Loaded {total:,} records")
    print()

    changes = {
        "outcome_standardized": 0,
        "outcome_from_text": 0,
        "respondent_normalized": 0,
        "visa_type_cleaned": 0,
    }

    # ── Step 1: Standardize outcome ──
    print("Step 1: Standardizing outcome field...")
    needs_text_extraction = []

    for idx in range(total):
        raw = str(df.at[idx, "outcome"]) if pd.notna(df.at[idx, "outcome"]) else ""
        if not raw or raw == "nan":
            needs_text_extraction.append(idx)
            continue

        standardized = standardize_outcome(raw)
        if standardized:
            if standardized != raw.strip():
                changes["outcome_standardized"] += 1
                df.at[idx, "outcome"] = standardized
            # Already standard, no change needed
        else:
            # Couldn't classify (e.g. "DECISION RECORD", "ORDERS") — need full text
            needs_text_extraction.append(idx)
            df.at[idx, "outcome"] = ""  # Clear the non-outcome value

    print(f"  Standardized from field value: {changes['outcome_standardized']:,}")
    print(f"  Need text extraction: {len(needs_text_extraction):,}")

    # ── Step 2: Extract outcome from full text for unresolved cases ──
    print("\nStep 2: Extracting outcome from full text...")
    batch_size = 5000
    for i in range(0, len(needs_text_extraction), batch_size):
        batch = needs_text_extraction[i : i + batch_size]
        for idx in batch:
            filepath = str(df.at[idx, "full_text_path"]) if pd.notna(df.at[idx, "full_text_path"]) else ""
            extracted = extract_outcome_from_text(filepath)
            if extracted:
                df.at[idx, "outcome"] = extracted
                changes["outcome_from_text"] += 1
        done = min(i + batch_size, len(needs_text_extraction))
        if done % 10000 < batch_size:
            print(f"  Processed {done:,}/{len(needs_text_extraction):,}...")

    print(f"  Extracted from text: {changes['outcome_from_text']:,}")

    # ── Step 2b: Second pass — standardize any remaining messy values ──
    print("\nStep 2b: Second-pass standardization...")
    second_pass = 0
    still_bad = 0
    for idx in range(total):
        raw = str(df.at[idx, "outcome"]) if pd.notna(df.at[idx, "outcome"]) else ""
        if not raw or raw == "nan":
            continue
        # Already standard?
        if raw.strip() in {"Affirmed", "Dismissed", "Remitted", "Set aside", "Allowed",
                           "Granted", "Refused", "No jurisdiction", "Withdrawn",
                           "Quashed", "Cancelled", "Unknown"}:
            continue
        standardized = standardize_outcome(raw)
        if standardized:
            df.at[idx, "outcome"] = standardized
            second_pass += 1
        else:
            still_bad += 1

    print(f"  Second-pass fixes: {second_pass:,}")
    print(f"  Still unresolvable: {still_bad:,}")
    changes["outcome_second_pass"] = second_pass

    # ── Step 3: Normalize respondent ──
    print("\nStep 3: Normalizing respondent field...")
    for idx in range(total):
        raw = str(df.at[idx, "respondent"]) if pd.notna(df.at[idx, "respondent"]) else ""
        if not raw or raw == "nan":
            continue
        normalized = normalize_respondent(raw)
        if normalized != raw.strip():
            df.at[idx, "respondent"] = normalized
            changes["respondent_normalized"] += 1

    print(f"  Normalized: {changes['respondent_normalized']:,}")

    # ── Step 4: Clean visa_type ──
    print("\nStep 4: Cleaning visa_type field...")
    for idx in range(total):
        raw = str(df.at[idx, "visa_type"]) if pd.notna(df.at[idx, "visa_type"]) else ""
        if not raw or raw == "nan":
            continue
        cleaned = clean_visa_type(raw)
        if cleaned != raw.strip():
            df.at[idx, "visa_type"] = cleaned
            changes["visa_type_cleaned"] += 1

    print(f"  Cleaned: {changes['visa_type_cleaned']:,}")

    # ── Summary ──
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for key, count in changes.items():
        print(f"  {key:30s}: {count:>7,}")

    # Final outcome distribution
    outcomes = df["outcome"].dropna().astype(str).str.strip()
    outcomes = outcomes[outcomes != ""]
    print(f"\nOutcome distribution ({outcomes.nunique()} unique):")
    for v, c in outcomes.value_counts().head(15).items():
        print(f"  {c:>7,}  {v[:80]}")

    still_empty = total - len(outcomes)
    print(f"\n  Still empty/unknown: {still_empty:,} ({still_empty/total*100:.1f}%)")

    if args.apply:
        tmp = str(CSV_PATH) + ".tmp"
        backup = str(CSV_PATH) + ".bak_clean"
        df.to_csv(tmp, index=False)
        if os.path.exists(backup):
            os.remove(backup)
        os.replace(str(CSV_PATH), backup)
        os.replace(tmp, str(CSV_PATH))
        print(f"\nBackup: {backup}")
        print(f"Saved: {CSV_PATH}")
    else:
        print("\n[DRY RUN] Use --apply to save changes.")


if __name__ == "__main__":
    main()
