"""
Data refinement Phase 3 — deeper extraction and standardization.

Targets:
1. hearing_date — "before the Tribunal on [date]" pattern
2. visa_subclass_number — infer from visa_type
3. visa_type standardization — merge case variants
4. country_of_origin standardization — normalize names
5. applicant_name — more title patterns

Usage:
    python scripts/refine_data_p3.py              # dry run
    python scripts/refine_data_p3.py --apply      # apply
"""

import argparse
import os
import re
from pathlib import Path

import pandas as pd

CSV_PATH = Path("downloaded_cases/immigration_cases.csv")

# ──────────────────────────────────────────
# Visa type → subclass number mapping
# ──────────────────────────────────────────
VISA_TYPE_TO_SUBCLASS = {
    "protection visa": "866",
    "protection": "866",
    "refugee": "866",
    "student visa": "500",
    "student": "500",
    "visitor visa": "600",
    "visitor": "600",
    "tourist visa": "600",
    "partner visa": "820",
    "partner": "820",
    "spouse visa": "820",
    "skilled worker": "457",
    "temporary work": "457",
    "business visa": "188",
    "bridging visa e": "050",
    "bridging visa a": "010",
    "bridging e": "050",
    "bridging a": "010",
    "employer nomination": "186",
    "skilled independent": "189",
    "skilled nominated": "190",
    "child visa": "101",
    "parent visa": "143",
    "contributory parent": "143",
    "prospective marriage": "300",
    "temporary graduate": "485",
}

# ──────────────────────────────────────────
# Visa type normalization
# ──────────────────────────────────────────
VISA_TYPE_NORMALIZE = {
    # Protection / Refugee
    "protection visa": "Protection visa",
    "protection": "Protection visa",
    "refugee": "Protection visa",
    # Student
    "student visa": "Student visa",
    # Visitor / Tourist
    "visitor visa": "Visitor visa",
    "tourist visa": "Visitor visa",
    # Partner / Spouse
    "partner visa": "Partner visa",
    "spouse visa": "Partner visa",
    # Skilled
    "skilled worker": "Skilled Worker visa",
    "skilled visa": "Skilled visa",
    # Bridging
    "bridging visa": "Bridging visa",
    "bridging visa e": "Bridging visa E",
    "bridging visa a": "Bridging visa A",
    "bridging e": "Bridging visa E",
    "bridging a": "Bridging visa A",
    # Permanent / Temporary
    "permanent visa": "Permanent visa",
    "temporary visa": "Temporary visa",
    # Others
    "character cancellation (s.501)": "Character cancellation (s.501)",
    "judicial review (migration)": "Judicial review",
    "citizenship": "Citizenship",
    "migration (general)": "Migration (general)",
}

# ──────────────────────────────────────────
# Country normalization
# ──────────────────────────────────────────
COUNTRY_NORMALIZE = {
    "china": "China",
    "prc": "China",
    "peoples republic of china": "China",
    "people's republic of china": "China",
    "india": "India",
    "iran": "Iran",
    "iraq": "Iraq",
    "sri lanka": "Sri Lanka",
    "bangladesh": "Bangladesh",
    "pakistan": "Pakistan",
    "vietnam": "Vietnam",
    "viet nam": "Vietnam",
    "philippines": "Philippines",
    "the philippines": "Philippines",
    "indonesia": "Indonesia",
    "malaysia": "Malaysia",
    "nepal": "Nepal",
    "afghanistan": "Afghanistan",
    "lebanon": "Lebanon",
    "fiji": "Fiji",
    "thailand": "Thailand",
    "south korea": "South Korea",
    "korea": "South Korea",
    "republic of korea": "South Korea",
    "north korea": "North Korea",
    "dprk": "North Korea",
    "burma": "Myanmar",
    "myanmar": "Myanmar",
    "turkey": "Turkey",
    "egypt": "Egypt",
    "syria": "Syria",
    "jordan": "Jordan",
    "saudi arabia": "Saudi Arabia",
    "united kingdom": "United Kingdom",
    "uk": "United Kingdom",
    "united states": "United States",
    "usa": "United States",
    "new zealand": "New Zealand",
    "south africa": "South Africa",
    "nigeria": "Nigeria",
    "ethiopia": "Ethiopia",
    "eritrea": "Eritrea",
    "somalia": "Somalia",
    "sudan": "Sudan",
    "south sudan": "South Sudan",
    "colombia": "Colombia",
    "brazil": "Brazil",
    "mexico": "Mexico",
    "taiwan": "Taiwan",
    "roc": "Taiwan",
    "hong kong": "Hong Kong",
    "cambodia": "Cambodia",
    "laos": "Laos",
    "tonga": "Tonga",
    "samoa": "Samoa",
    "papua new guinea": "Papua New Guinea",
    "png": "Papua New Guinea",
    "east timor": "East Timor",
    "timor-leste": "East Timor",
    "democratic republic of congo": "DR Congo",
    "drc": "DR Congo",
    "congo": "Congo",
    "zimbabwe": "Zimbabwe",
    "kenya": "Kenya",
    "uganda": "Uganda",
    "tanzania": "Tanzania",
    "ghana": "Ghana",
    "sierra leone": "Sierra Leone",
    "liberia": "Liberia",
    "ivory coast": "Ivory Coast",
    "russia": "Russia",
    "russian federation": "Russia",
    "ukraine": "Ukraine",
    "georgia": "Georgia",
    "armenia": "Armenia",
    "azerbaijan": "Azerbaijan",
    "uzbekistan": "Uzbekistan",
    "kazakhstan": "Kazakhstan",
    "kyrgyzstan": "Kyrgyzstan",
    "tajikistan": "Tajikistan",
    "turkmenistan": "Turkmenistan",
    "belarus": "Belarus",
    "moldova": "Moldova",
    "albania": "Albania",
    "serbia": "Serbia",
    "bosnia": "Bosnia",
    "croatia": "Croatia",
    "kosovo": "Kosovo",
    "macedonia": "North Macedonia",
    "north macedonia": "North Macedonia",
    "romania": "Romania",
    "bulgaria": "Bulgaria",
    "hungary": "Hungary",
    "poland": "Poland",
    "czech": "Czech Republic",
    "czech republic": "Czech Republic",
    "slovakia": "Slovakia",
    "slovenia": "Slovenia",
}


def read_text(filepath: str, max_chars: int = 10000) -> str:
    if not filepath or not os.path.exists(filepath):
        return ""
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            return f.read(max_chars)
    except Exception:
        return ""


DATE_RE = r'(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})'

HEARING_PATTERNS = [
    re.compile(r'before\s+the\s+Tribunal\s+on\s+' + DATE_RE, re.IGNORECASE),
    re.compile(r'appeared?\s+before\s+(?:the\s+)?(?:Tribunal|Court|Judge).*?on\s+' + DATE_RE, re.IGNORECASE),
    re.compile(r'hearing\s+on\s+' + DATE_RE, re.IGNORECASE),
    re.compile(r'hearing\s+(?:was\s+)?(?:held|conducted)\s+(?:on\s+)?' + DATE_RE, re.IGNORECASE),
    re.compile(r'oral\s+evidence\s+.*?(?:on|dated)\s+' + DATE_RE, re.IGNORECASE),
    re.compile(r'(?:HEARING\s+DATE|DATE\s+OF\s+HEARING)\s*[:\t]\s*' + DATE_RE, re.IGNORECASE),
    re.compile(r'(?:Heard|HEARD)\s*[:\t]\s*' + DATE_RE, re.IGNORECASE),
    re.compile(r'Tribunal\s+(?:held|conducted)\s+(?:a\s+)?hearing.*?' + DATE_RE, re.IGNORECASE),
    re.compile(r'gave\s+(?:oral\s+)?evidence\s+(?:to\s+the\s+Tribunal\s+)?on\s+' + DATE_RE, re.IGNORECASE),
]


def extract_hearing_date(text: str) -> str:
    for pat in HEARING_PATTERNS:
        m = pat.search(text)
        if m:
            return m.group(1).strip()
    return ""


def infer_subclass_from_visa_type(visa_type: str) -> str:
    if not visa_type:
        return ""
    vt_lower = visa_type.lower().strip()
    for key, subclass in VISA_TYPE_TO_SUBCLASS.items():
        if key in vt_lower:
            return subclass
    return ""


def normalize_visa_type(raw: str) -> str:
    """Normalize visa_type to consistent format.

    Strategy: if it has "(subclass NNN)" keep the full official name.
    Otherwise, map common variants to a standard form.
    """
    if not raw:
        return raw
    s = raw.strip()
    key = s.lower()

    # Already has official format "X visa (subclass NNN)"? Keep it, just fix casing
    if "(subclass" in key:
        return s

    # Direct mapping
    mapped = VISA_TYPE_NORMALIZE.get(key)
    if mapped:
        return mapped

    # Pattern: "subclass NNN visa" → "Subclass NNN visa"
    m = re.match(r"^subclass\s+(\d{3})\s+visa$", key)
    if m:
        return f"Subclass {m.group(1)} visa"

    # Capitalize first letter
    if s and s[0].islower():
        return s[0].upper() + s[1:]

    return s


def normalize_country(raw: str) -> str:
    if not raw:
        return raw
    key = raw.lower().strip()
    return COUNTRY_NORMALIZE.get(key, raw.strip())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    df = pd.read_csv(CSV_PATH, dtype={"visa_subclass": str}, low_memory=False)
    total = len(df)
    print(f"Loaded {total:,} records\n")

    changes = {
        "hearing_date": 0,
        "visa_subclass_number": 0,
        "visa_type_normalized": 0,
        "country_normalized": 0,
    }

    batch = 5000
    for start in range(0, total, batch):
        end = min(start + batch, total)

        for idx in range(start, end):
            # --- hearing_date ---
            cur_hd = str(df.at[idx, "hearing_date"]) if pd.notna(df.at[idx, "hearing_date"]) else ""
            if not cur_hd or cur_hd == "nan":
                filepath = str(df.at[idx, "full_text_path"]) if pd.notna(df.at[idx, "full_text_path"]) else ""
                text = read_text(filepath)
                if text:
                    hd = extract_hearing_date(text)
                    if hd:
                        df.at[idx, "hearing_date"] = hd
                        changes["hearing_date"] += 1

            # --- visa_subclass_number from visa_type ---
            cur_vsn = str(df.at[idx, "visa_subclass_number"]) if pd.notna(df.at[idx, "visa_subclass_number"]) else ""
            if not cur_vsn or cur_vsn == "nan":
                vt = str(df.at[idx, "visa_type"]) if pd.notna(df.at[idx, "visa_type"]) else ""
                if vt and vt != "nan":
                    inferred = infer_subclass_from_visa_type(vt)
                    if inferred:
                        df.at[idx, "visa_subclass_number"] = inferred
                        changes["visa_subclass_number"] += 1

            # --- visa_type normalization ---
            cur_vt = str(df.at[idx, "visa_type"]) if pd.notna(df.at[idx, "visa_type"]) else ""
            if cur_vt and cur_vt != "nan":
                normalized = normalize_visa_type(cur_vt)
                if normalized != cur_vt:
                    df.at[idx, "visa_type"] = normalized
                    changes["visa_type_normalized"] += 1

            # --- country_of_origin normalization ---
            cur_co = str(df.at[idx, "country_of_origin"]) if pd.notna(df.at[idx, "country_of_origin"]) else ""
            if cur_co and cur_co != "nan":
                normalized = normalize_country(cur_co)
                if normalized != cur_co:
                    df.at[idx, "country_of_origin"] = normalized
                    changes["country_normalized"] += 1

        if end % 20000 < batch or end == total:
            print(f"  {end:,}/{total:,}... " +
                  " | ".join(f"{k}:+{v:,}" for k, v in changes.items()))

    # Print final stats
    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print("=" * 60)
    for key, count in changes.items():
        print(f"  {key:30s}: +{count:>7,}")

    # Field coverage
    print("\nField coverage:")
    for f in ["hearing_date", "visa_subclass_number", "visa_type", "country_of_origin"]:
        non_empty = (df[f].notna() & (df[f].astype(str).str.strip() != "") & (df[f].astype(str) != "nan")).sum()
        print(f"  {f:25s}: {non_empty:>7,} ({non_empty/total*100:.1f}%)")

    # Top values
    print("\nTop visa_type values:")
    vt = df["visa_type"].dropna().astype(str).str.strip()
    vt = vt[(vt != "") & (vt != "nan")]
    for v, c in vt.value_counts().head(10).items():
        print(f"  {c:>6,}  {v[:60]}")

    print("\nTop country_of_origin values:")
    co = df["country_of_origin"].dropna().astype(str).str.strip()
    co = co[(co != "") & (co != "nan")]
    for v, c in co.value_counts().head(15).items():
        print(f"  {c:>6,}  {v}")

    if args.apply:
        tmp = str(CSV_PATH) + ".tmp"
        backup = str(CSV_PATH) + ".bak_refine3"
        df.to_csv(tmp, index=False)
        if os.path.exists(backup):
            os.remove(backup)
        os.replace(str(CSV_PATH), backup)
        os.replace(tmp, str(CSV_PATH))
        print(f"\nBackup: {backup}")
        print(f"Saved: {CSV_PATH}")
    else:
        print("\n[DRY RUN] Use --apply to save.")


if __name__ == "__main__":
    main()
