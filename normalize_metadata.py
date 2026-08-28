"""
Normalize and clean metadata fields in immigration_cases.csv.

Targets:
  1. visa_type  — merge 851 variants → ~30 canonical types
  2. outcome    — extract decision from raw text → ~10 clean categories
  3. case_nature — normalize 1607 variants → ~15 categories
  4. Fill missing case_nature (11,558) from catchwords/title/court
  5. Fill missing legal_concepts (12,436) from catchwords

Usage: python normalize_metadata.py [--dry-run]
"""

import os
import re
import sys
import shutil
import pandas as pd
from datetime import datetime
from pathlib import Path

from immi_case_downloader.extraction.batch_runner import catalog_lock, temp_path_for

CSV_PATH = "downloaded_cases/immigration_cases.csv"
JOB_NAME = "normalize_metadata"


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ── visa_type normalization ──────────────────────────────────────────────

VISA_TYPE_MAP = {
    # Protection / Refugee
    r"protection": "Protection visa",
    r"refugee": "Protection visa",
    r"class xa": "Protection visa",
    r"subclass 866": "Protection visa",
    r"subclass 785": "Protection visa",
    r"subclass 790": "Protection visa",
    # Student
    r"student": "Student visa",
    r"subclass 500\b": "Student visa",
    r"subclass 57[0-9]": "Student visa",
    # Skilled / Work
    r"subclass 457": "Temporary Work (Skilled) visa",
    r"subclass 482": "Temporary Skill Shortage visa",
    r"subclass 186": "Employer Nomination Scheme visa",
    r"subclass 187": "Regional Sponsored Migration visa",
    r"subclass 189": "Skilled Independent visa",
    r"subclass 190": "Skilled Nominated visa",
    r"subclass 491": "Skilled Work Regional visa",
    r"skilled": "Skilled visa",
    # Partner / Family
    r"partner": "Partner visa",
    r"spouse": "Partner visa",
    r"subclass 309": "Partner visa",
    r"subclass 820": "Partner visa",
    r"subclass 801": "Partner visa",
    r"subclass 300": "Prospective Marriage visa",
    r"subclass 101": "Child visa",
    r"subclass 117": "Orphan Relative visa",
    r"subclass 143": "Contributory Parent visa",
    r"subclass 802": "Child visa",
    r"subclass 836": "Contributory Parent visa",
    # Visitor
    r"visitor": "Visitor visa",
    r"subclass 600": "Visitor visa",
    r"subclass 601": "Electronic Travel Authority",
    r"class fa": "Visitor visa",
    # Bridging
    r"bridging": "Bridging visa",
    r"subclass 050": "Bridging visa",
    r"subclass 051": "Bridging visa",
    # Temporary
    r"subclass 408": "Temporary Activity visa",
    r"subclass 417": "Working Holiday visa",
    r"subclass 462": "Work and Holiday visa",
    r"subclass 485": "Temporary Graduate visa",
    r"subclass 444": "Special Category visa (NZ)",
    r"class tu": "Temporary visa",
    # Citizenship
    r"citizenship": "Citizenship",
    # Character / Cancellation
    r"character.*cancel|s\.?\s*501|section 501": "Character cancellation (s.501)",
    r"character": "Character cancellation (s.501)",
    # Catch-all
    r"judicial review \(migration\)": "Judicial review (migration)",
    r"permanent": "Permanent visa",
    r"temporary": "Temporary visa",
    r"migration \(general\)": "Migration (general)",
    r"^migration$": "Migration (general)",
}


def normalize_visa_type(val):
    if pd.isna(val) or str(val).strip() in ("", "nan"):
        return val
    text = str(val).lower().strip()
    text = re.sub(r"\s+", " ", text)

    for pattern, canonical in VISA_TYPE_MAP.items():
        if re.search(pattern, text):
            return canonical
    # Catch-all for "subclass NNN visa" patterns not in map
    m = re.match(r"subclass (\d+)", text)
    if m:
        return f"Subclass {m.group(1)} visa"
    if text == "class of visa":
        return "Migration (general)"
    return str(val).strip()


# ── outcome normalization ────────────────────────────────────────────────

def normalize_outcome(val):
    if pd.isna(val) or str(val).strip() in ("", "nan"):
        return val
    text = str(val)
    # Strip newlines, tabs, excess whitespace
    text = re.sub(r"[\n\r\t]+", " ", text).strip()
    text = re.sub(r"\s+", " ", text)
    t = text.lower()

    if "dismiss" in t:
        return "Dismissed"
    if "affirm" in t:
        return "Affirmed"
    if "set aside" in t or "substitut" in t:
        return "Set aside"
    if "remit" in t:
        return "Remitted"
    if "quash" in t:
        return "Quashed"
    if "uphold" in t or "upheld" in t:
        return "Upheld"
    if "allow" in t:
        return "Allowed"
    if "grant" in t:
        return "Granted"
    if "refuse" in t:
        return "Refused"
    if "withdraw" in t:
        return "Withdrawn"
    if "discontinu" in t:
        return "Discontinued"
    if "adjourn" in t:
        return "Adjourned"
    if "consent" in t:
        return "By consent"
    if "struck out" in t or "strike out" in t:
        return "Struck out"
    # More specific patterns
    if "the decision under review is taken to be" in t:
        return "Affirmed"
    if "no jurisdiction" in t or "does not have jurisdiction" in t:
        return "No jurisdiction"
    if "writ" in t and ("certiorari" in t or "mandamus" in t or "prohibition" in t):
        return "Allowed"
    if "not competent" in t or "incompetent" in t:
        return "Dismissed"
    # Document headers masquerading as outcomes
    if re.match(r"^(decision|order|procedural|tribunal|the applicat|protection)", t):
        return "Unknown"
    return text[:80]  # Keep truncated original if truly unknown


# ── case_nature normalization ────────────────────────────────────────────

CASE_NATURE_MAP = [
    (r"judicial review", "Judicial review"),
    (r"merits review", "Merits review"),
    (r"protection.*visa|refugee.*protection|class xa", "Protection visa"),
    (r"refugee|well.founded fear|complementary protection|non.refoulement", "Refugee assessment"),
    (r"cancel", "Visa cancellation"),
    (r"refus", "Visa refusal"),
    (r"appeal", "Appeal"),
    (r"character.*test|s\.?\s*501|section 501", "Character test (s.501)"),
    (r"detention|habeas|unlawful.*detent", "Detention challenge"),
    (r"student.*visa", "Student visa application"),
    (r"partner|spouse|family.*reunion", "Partner/Family visa"),
    (r"skilled|employer.*nomin|subclass.*(186|187|189|457|482)", "Skilled migration"),
    (r"bridging.*visa", "Bridging visa"),
    (r"citizenship|naturalisation", "Citizenship"),
    (r"migration.*review|migration.*application|visa.*application.*review", "Migration review"),
    (r"administrat.*review", "Administrative review"),
    (r"^migration\b", "Migration (general)"),
]


def normalize_case_nature(val):
    if pd.isna(val) or str(val).strip() in ("", "nan"):
        return val
    text = str(val).lower().strip()
    text = re.sub(r"\s+", " ", text)

    for pattern, canonical in CASE_NATURE_MAP:
        if re.search(pattern, text):
            return canonical
    return str(val).strip().title()  # Title-case if unmapped


# ── Infer missing case_nature from catchwords/title/court ────────────────

INFER_RULES = [
    (r"judicial review|jurisdictional error|unreasonableness", "Judicial review"),
    (r"merits review|tribunal.*affirm|tribunal.*set aside", "Merits review"),
    (r"protection.*visa|refugee|well.founded fear|complementary protection|non.refoulement|persecution|serious harm", "Protection visa"),
    (r"cancel.*visa|visa.*cancel|s\.?\s*501|character.*test|character.*ground", "Visa cancellation"),
    (r"refus.*visa|visa.*refus", "Visa refusal"),
    (r"appeal|appellant", "Appeal"),
    (r"detention|habeas|unlawful.*detent", "Detention challenge"),
    (r"student.*visa|subclass 500|subclass 57[0-9]", "Student visa application"),
    (r"partner.*visa|spouse|subclass (309|820|801)", "Partner/Family visa"),
    (r"skilled|employer.*nomin|subclass.*(186|187|189|457|482)", "Skilled migration"),
    (r"bridging.*visa|subclass 050", "Bridging visa"),
    (r"citizenship|naturalisation", "Citizenship"),
]


def infer_case_nature(row):
    """Infer case_nature from catchwords, title, and court."""
    text_parts = []
    for field in ("catchwords", "title", "text_snippet"):
        val = row.get(field, "")
        if pd.notna(val) and str(val).strip() not in ("", "nan"):
            text_parts.append(str(val).lower())
    combined = " ".join(text_parts)

    for pattern, nature in INFER_RULES:
        if re.search(pattern, combined):
            return nature

    # Court-based fallback
    court = str(row.get("court_code", "")).upper()
    if court in ("FCA", "FCCA", "FedCFamC2G", "HCA"):
        return "Judicial review"  # These courts handle judicial review
    if court in ("AATA", "ARTA"):
        return "Merits review"  # Tribunals handle merits review

    return "Migration (general)"


# ── Infer missing legal_concepts from catchwords ─────────────────────────

CONCEPT_PATTERNS = [
    (r"jurisdictional error", "Jurisdictional error"),
    (r"procedural fairness|natural justice", "Procedural fairness"),
    (r"unreasonableness|illogical|irrational", "Unreasonableness"),
    (r"credibility", "Credibility assessment"),
    (r"well.founded fear", "Well-founded fear of persecution"),
    (r"complementary protection", "Complementary protection"),
    (r"serious harm", "Serious harm"),
    (r"particular social group", "Particular social group"),
    (r"s\.?\s*501|character.*test|character.*ground", "Character test (s.501)"),
    (r"visa.*cancel", "Visa cancellation"),
    (r"time.*limit|out of time|extension of time", "Time limitation"),
    (r"no.case.*submission|s\.?\s*424a|s\.?\s*425", "Tribunal hearing obligations"),
    (r"minister.*interven|s\.?\s*417|s\.?\s*48b", "Ministerial intervention"),
    (r"country.*information|dfat|country.*report", "Country information"),
    (r"migration agent|omara|mara", "Migration agent issues"),
    (r"public interest criteria|pic 4020|pic 4014", "Public interest criteria"),
    (r"genuine.*relationship|genuine.*spouse", "Genuine relationship"),
    (r"health.*requirement|medical", "Health requirements"),
    (r"english.*language|ielts", "English language requirements"),
    (r"merits review", "Merits review"),
    (r"costs|indemnity", "Costs"),
]


def infer_legal_concepts(row):
    """Extract legal concepts from catchwords."""
    text = str(row.get("catchwords", ""))
    if pd.isna(row.get("catchwords")) or text.strip() in ("", "nan"):
        text = str(row.get("title", "")).lower()
    else:
        text = text.lower()

    concepts = []
    for pattern, concept in CONCEPT_PATTERNS:
        if re.search(pattern, text):
            concepts.append(concept)

    return "; ".join(concepts) if concepts else None


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        return _run(dry_run=True)
    # Read and write inside one lock: this is a read-modify-write over the
    # whole catalog, so anything committed between the read and the write
    # would be erased by it.
    with catalog_lock(Path(CSV_PATH), JOB_NAME):
        return _run(dry_run=False)


def _run(dry_run: bool):
    df = pd.read_csv(
        CSV_PATH,
        encoding="utf-8-sig",
        dtype={"visa_subclass": str, "visa_subclass_number": str},
        low_memory=False,
    )
    log(f"Loaded {len(df):,} records")

    if not dry_run:
        # Microseconds and pid, not seconds: two runs started in the same
        # second used to overwrite each other's backup, and the backup is the
        # only copy of a 149k-row file that cannot be regenerated.
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        backup = f"{CSV_PATH}.bak-{stamp}-{os.getpid()}"
        shutil.copy2(CSV_PATH, backup)
        log(f"Backup: {backup}")

    # 1. Normalize visa_type
    log("Step 1: Normalizing visa_type...")
    before_vt = df["visa_type"].nunique()
    df["visa_type"] = df["visa_type"].apply(normalize_visa_type)
    after_vt = df["visa_type"].nunique()
    log(f"  visa_type: {before_vt} → {after_vt} unique values")

    # 2. Normalize outcome
    log("Step 2: Normalizing outcome...")
    before_oc = df["outcome"].nunique()
    df["outcome"] = df["outcome"].apply(normalize_outcome)
    after_oc = df["outcome"].nunique()
    log(f"  outcome: {before_oc} → {after_oc} unique values")

    # 3. Normalize existing case_nature
    log("Step 3: Normalizing case_nature...")
    before_cn = df["case_nature"].nunique()
    df["case_nature"] = df["case_nature"].apply(normalize_case_nature)
    after_cn = df["case_nature"].nunique()
    log(f"  case_nature: {before_cn} → {after_cn} unique values")

    # 4. Fill missing case_nature
    missing_cn = df["case_nature"].isna() | (df["case_nature"].astype(str).str.strip().isin(["", "nan"]))
    missing_cn_count = missing_cn.sum()
    log(f"Step 4: Filling {missing_cn_count:,} missing case_nature...")
    df.loc[missing_cn, "case_nature"] = df.loc[missing_cn].apply(infer_case_nature, axis=1)
    filled_cn = missing_cn_count - (df["case_nature"].isna() | (df["case_nature"].astype(str).str.strip().isin(["", "nan"]))).sum()
    log(f"  Filled: {filled_cn:,}")

    # 5. Fill missing legal_concepts
    missing_lc = df["legal_concepts"].isna() | (df["legal_concepts"].astype(str).str.strip().isin(["", "nan"]))
    missing_lc_count = missing_lc.sum()
    log(f"Step 5: Filling {missing_lc_count:,} missing legal_concepts...")
    df.loc[missing_lc, "legal_concepts"] = df.loc[missing_lc].apply(infer_legal_concepts, axis=1)
    filled_lc = missing_lc_count - (df["legal_concepts"].isna() | (df["legal_concepts"].astype(str).str.strip().isin(["", "nan"]))).sum()
    log(f"  Filled: {filled_lc:,}")

    # Summary
    log("\n=== Summary ===")
    log(f"  visa_type:      {before_vt} → {after_vt} unique values")
    log(f"  outcome:        {before_oc} → {after_oc} unique values")
    log(f"  case_nature:    {before_cn} → {after_cn} unique (+ {filled_cn:,} filled)")
    log(f"  legal_concepts: {filled_lc:,} filled from catchwords")

    # Final field coverage
    log("\n=== Final Coverage ===")
    for field in ("visa_type", "outcome", "case_nature", "legal_concepts"):
        filled = (df[field].notna() & (~df[field].astype(str).str.strip().isin(["", "nan"]))).sum()
        pct = filled / len(df) * 100
        log(f"  {field:<20s}: {filled:>6,} / {len(df):,} ({pct:.1f}%)")

    if dry_run:
        log("\n[DRY RUN] No files written.")
        # Show examples
        log("\nvisa_type distribution:")
        print(df["visa_type"].value_counts().head(15).to_string())
        log("\noutcome distribution:")
        print(df["outcome"].value_counts().head(15).to_string())
        log("\ncase_nature distribution:")
        print(df["case_nature"].value_counts().head(20).to_string())
    else:
        # tmp-then-replace, not a direct write: writing onto the live path
        # meant an interruption mid-write left a truncated master catalog.
        tmp_path = temp_path_for(Path(CSV_PATH), JOB_NAME)
        try:
            df.to_csv(tmp_path, index=False)
            os.replace(str(tmp_path), CSV_PATH)
        except BaseException:
            tmp_path.unlink(missing_ok=True)
            raise
        log(f"\nCSV saved: {CSV_PATH}")


if __name__ == "__main__":
    main()
