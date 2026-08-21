"""
Data refinement Phase 2 — improve coverage for mid-tier fields.

Targets:
1. respondent — extract from full text (Minister for...) → 32.7% → ~80%+
2. is_represented — detect from text patterns → 17.2% → ~50%+
3. representative — extract lawyer/agent name → 11.1% → ~30%+
4. country_of_origin — extract from text headers/mentions → 64.9% → ~75%+
5. hearing_date — extract from text patterns → 78.7% → ~85%+
6. applicant_name — extract from title for tribunal cases → 89.8% → ~95%+

Usage:
    python scripts/refine_data.py              # dry run
    python scripts/refine_data.py --apply      # apply
"""

import argparse
import os
import re
from pathlib import Path

import pandas as pd

CSV_PATH = Path("downloaded_cases/immigration_cases.csv")

# Known respondent abbreviations (same as clean_data.py)
RESPONDENT_NORMALIZE = {
    "Minister for Immigration and Border Protection": "MIBP",
    "Minister for Immigration and Citizenship": "MIC",
    "Minister for Immigration and Multicultural Affairs": "MIMA",
    "Minister for Immigration and Multicultural and Indigenous Affairs": "MIMIA",
    "Minister for Immigration, Citizenship, Migrant Services and Multicultural Affairs": "MICMSMA",
    "Minister for Immigration, Citizenship and Multicultural Affairs": "MICMA",
    "Minister for Home Affairs": "MHA",
    "Minister for Immigration and Ethnic Affairs": "MIEA",
    "Minister for Immigration & Multicultural & Indigenous Affairs": "MIMIA",
    "Minister for Immigration & Multicultural Affairs": "MIMA",
    "Minister for Immigration & Citizenship": "MIC",
    "Minister for Immigration & Border Protection": "MIBP",
    "Minister for Immigration, Multicultural and Indigenous Affairs": "MIMIA",
    "Minister for Immigration and Multicultural Affairs and Another": "MIMA",
}

# Comprehensive country list for extraction
COUNTRIES = [
    "Afghanistan", "Albania", "Algeria", "Angola", "Argentina", "Armenia",
    "Azerbaijan", "Bahrain", "Bangladesh", "Belarus", "Bhutan", "Bolivia",
    "Bosnia", "Brazil", "Brunei", "Bulgaria", "Burma", "Burundi", "Cambodia",
    "Cameroon", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo",
    "Croatia", "Cuba", "Cyprus", "Czech", "Djibouti", "Dominican Republic",
    "East Timor", "Ecuador", "Egypt", "El Salvador", "Eritrea", "Estonia",
    "Ethiopia", "Fiji", "Gambia", "Georgia", "Ghana", "Greece", "Guatemala",
    "Guinea", "Haiti", "Honduras", "Hong Kong", "Hungary", "India",
    "Indonesia", "Iran", "Iraq", "Israel", "Ivory Coast", "Jamaica", "Japan",
    "Jordan", "Kazakhstan", "Kenya", "Korea", "Kosovo", "Kurdistan", "Kuwait",
    "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Liberia", "Libya",
    "Lithuania", "Macedonia", "Malawi", "Malaysia", "Maldives", "Mali",
    "Mauritania", "Mauritius", "Mexico", "Moldova", "Mongolia", "Morocco",
    "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "New Zealand",
    "Nicaragua", "Niger", "Nigeria", "North Korea", "Oman", "Pakistan",
    "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru",
    "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia",
    "Rwanda", "Samoa", "Saudi Arabia", "Senegal", "Serbia", "Sierra Leone",
    "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia",
    "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka",
    "Sudan", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan",
    "Tanzania", "Thailand", "Tibet", "Togo", "Tonga", "Trinidad",
    "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda", "Ukraine",
    "United Arab Emirates", "United Kingdom", "United States", "Uruguay",
    "Uzbekistan", "Vanuatu", "Venezuela", "Vietnam", "Yemen", "Zambia",
    "Zimbabwe",
    # Common alternative names
    "PRC", "People's Republic of China", "Peoples Republic of China",
    "DRC", "Democratic Republic of Congo",
    "UAE", "UK", "USA",
    "ROC",  # Republic of China / Taiwan
    "DPRK",  # North Korea
    "Timor-Leste", "Türkiye",
]

# Build regex pattern for countries
COUNTRY_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(c) for c in sorted(COUNTRIES, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)

# Country normalization
COUNTRY_NORMALIZE = {
    "prc": "China", "people's republic of china": "China",
    "peoples republic of china": "China",
    "burma": "Myanmar", "drc": "Congo",
    "democratic republic of congo": "Congo",
    "uae": "United Arab Emirates", "uk": "United Kingdom",
    "usa": "United States", "roc": "Taiwan",
    "dprk": "North Korea", "timor-leste": "East Timor",
    "türkiye": "Turkey", "korea": "South Korea",
}


def read_text_cached(filepath: str, max_chars: int = 8000) -> str:
    """Read first N chars of a text file."""
    if not filepath or not os.path.exists(filepath):
        return ""
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            return f.read(max_chars)
    except Exception:
        return ""


def extract_respondent(text: str) -> str:
    """Extract respondent (Minister name) from case text."""
    # Pattern 1: RESPONDENT header
    m = re.search(r"RESPONDENT\s*[:：]\s*(Minister\s+for\s+[^\n]{10,80})", text, re.IGNORECASE)
    if m:
        return clean_minister_name(m.group(1))

    # Pattern 2: "and Minister for..." in title-like context
    m = re.search(
        r"(?:and|&)\s+(Minister\s+for\s+(?:Immigration|Home)[^\n]{0,60}?)(?:\s*[\[\(]|\s*$|\s*\n)",
        text[:2000], re.IGNORECASE,
    )
    if m:
        return clean_minister_name(m.group(1))

    # Pattern 3: Any Minister for Immigration mention
    m = re.search(
        r"(Minister\s+for\s+(?:Immigration|Home\s+Affairs)[^\n,]{0,60}?)(?:\s+(?:to|on|in|at|has|had|was|is|did|who|under)\b|[,\.]|\s*\n)",
        text[:5000], re.IGNORECASE,
    )
    if m:
        return clean_minister_name(m.group(1))

    return ""


def clean_minister_name(raw: str) -> str:
    """Clean and normalize a minister name."""
    s = raw.strip()
    # Remove trailing junk
    s = re.sub(r"\s*[\(\[].*$", "", s)
    s = re.sub(r"\s+(?:to|on|in|at|has|had|was|is|did)\b.*$", "", s, flags=re.IGNORECASE)
    s = s.strip().rstrip(".,;:")

    # Normalize to abbreviation
    for long_name, short in sorted(RESPONDENT_NORMALIZE.items(), key=lambda x: -len(x[0])):
        if long_name.lower() in s.lower():
            return short

    # If still long, try to abbreviate
    if len(s) > 30 and "Minister" in s:
        return s[:60]

    return s if s else ""


def extract_representation(text: str) -> tuple[str, str]:
    """Extract is_represented and representative from text.
    Returns (is_represented: 'Yes'|'No'|'', representative: str).
    """
    # Self-represented patterns
    self_rep_patterns = [
        r"(?:self[- ]represented|appeared?\s+in\s+person|unrepresented|no\s+representative)",
        r"(?:Applicant|Appellant|Review\s+applicant)\s*[:：]?\s*(?:appeared?\s+in\s+person|self[- ]represented)",
        r"(?:The\s+applicant\s+)?(?:was\s+)?not\s+represented",
    ]
    for pat in self_rep_patterns:
        if re.search(pat, text, re.IGNORECASE):
            return ("No", "")

    # Represented patterns
    rep_patterns = [
        # "Counsel for the Applicant: Mr Smith"
        (r"(?:Counsel|Solicitor|Solicitors?|Agent|Representative|Adviser)\s+for\s+(?:the\s+)?(?:Applicant|Appellant|Review\s+Applicant)\s*[:：]\s*([^\n]{3,60})", True),
        # "REPRESENTATIVE: Mr Smith"
        (r"REPRESENTATIVE\s*[:：]\s*([^\n]{3,60})", True),
        # "represented by Mr Smith"
        (r"represented\s+by\s+([A-Z][^\n,]{2,40})", True),
        # "Mr Smith appeared for the applicant"
        (r"((?:Mr|Ms|Mrs|Dr)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:appeared?|acting)\s+for\s+(?:the\s+)?(?:applicant|appellant)", True),
    ]
    for pat, has_name in rep_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m and has_name:
            name = m.group(1).strip().rstrip(".,;:")
            # Skip if it looks like a firm/generic
            if name and len(name) > 2 and not re.match(r"^(nil|none|n/?a)$", name, re.IGNORECASE):
                return ("Yes", name)

    return ("", "")


def extract_country(text: str) -> str:
    """Extract country of origin from text."""
    # Pattern 1: Explicit header
    headers = [
        r"Country\s+of\s+(?:Reference|Origin|Nationality|Birth)\s*[:：]\s*([^\n]{2,40})",
        r"COUNTRY\s*[:：]\s*([^\n]{2,40})",
        r"Nationality\s*[:：]\s*([^\n]{2,40})",
    ]
    for pat in headers:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            country = m.group(1).strip().rstrip(".,;:")
            normalized = COUNTRY_NORMALIZE.get(country.lower(), country)
            return normalized

    # Pattern 2: "citizen/national of [Country]"
    m = re.search(
        r"(?:citizen|national|born\s+in|from|native\s+of)\s+(?:of\s+)?(?:the\s+)?(\w[\w\s]{2,25}?)(?:\s+who|\s+and|\s+seeking|[,\.]|\s*$)",
        text[:5000], re.IGNORECASE,
    )
    if m:
        candidate = m.group(1).strip()
        # Verify it's a real country
        cm = COUNTRY_PATTERN.match(candidate)
        if cm:
            country = cm.group(1)
            return COUNTRY_NORMALIZE.get(country.lower(), country.title())

    # Pattern 3: First country mentioned in first 3000 chars (less reliable)
    m = COUNTRY_PATTERN.search(text[:3000])
    if m:
        country = m.group(1)
        # Skip Australia itself and common false positives
        if country.lower() not in ("australia", "australian", "new south wales", "victoria", "queensland"):
            return COUNTRY_NORMALIZE.get(country.lower(), country.title())

    return ""


def extract_hearing_date(text: str) -> str:
    """Extract hearing date from text."""
    patterns = [
        r"(?:HEARING\s+DATE|Date\s+of\s+(?:Hearing|hearing))\s*[:：]\s*(\d{1,2}\s+\w+\s+\d{4})",
        r"(?:hearing|oral\s+evidence)\s+(?:was\s+)?(?:held|conducted|took\s+place)\s+(?:on\s+)?(\d{1,2}\s+\w+\s+\d{4})",
        r"AT\s+HEARING\s*[:：].*?(\d{1,2}\s+\w+\s+\d{4})",
    ]
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return ""


def extract_applicant_from_title(title: str, court: str) -> str:
    """Extract applicant name from case title."""
    if not title:
        return ""

    # MRTA/RRTA: "Surname, Given Name [year] MRTA xxx"
    m = re.match(r"^([A-Z][a-z]+(?:[-'][A-Z][a-z]+)*),\s+([A-Z][^\[]+)\s*\[", title)
    if m:
        surname = m.group(1).strip()
        given = m.group(2).strip()
        return f"{given} {surname}"

    # AATA: "1234567 (Migration) [year] AATA xxx" — no name, skip
    if re.match(r"^\d{5,}", title):
        return ""

    # FCA/FCCA: "Name v Minister..." or "SZXXX v Minister..."
    m = re.match(r"^([A-Z][^\sv]+(?:\s+[A-Z][^\sv]+)*)\s+v\s+", title)
    if m:
        return m.group(1).strip()

    # HCA: "Re Minister...; Ex parte Name"
    m = re.search(r"Ex\s+parte\s+([A-Z][^\[;]+)", title)
    if m:
        return m.group(1).strip()

    return ""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    df = pd.read_csv(CSV_PATH, dtype={"visa_subclass": str}, low_memory=False)
    total = len(df)
    print(f"Loaded {total:,} records\n")

    changes = {
        "respondent": 0,
        "is_represented": 0,
        "representative": 0,
        "country_of_origin": 0,
        "hearing_date": 0,
        "applicant_name": 0,
    }

    batch = 5000
    for start in range(0, total, batch):
        end = min(start + batch, total)

        for idx in range(start, end):
            filepath = str(df.at[idx, "full_text_path"]) if pd.notna(df.at[idx, "full_text_path"]) else ""
            court = str(df.at[idx, "court_code"]) if pd.notna(df.at[idx, "court_code"]) else ""
            title = str(df.at[idx, "title"]) if pd.notna(df.at[idx, "title"]) else ""

            text = ""  # Lazy load

            def get_text():
                nonlocal text
                if not text:
                    text = read_text_cached(filepath)
                return text

            # --- Respondent ---
            current = str(df.at[idx, "respondent"]) if pd.notna(df.at[idx, "respondent"]) else ""
            if not current or current == "nan":
                resp = extract_respondent(get_text())
                if resp:
                    df.at[idx, "respondent"] = resp
                    changes["respondent"] += 1

            # --- is_represented & representative ---
            cur_rep = str(df.at[idx, "is_represented"]) if pd.notna(df.at[idx, "is_represented"]) else ""
            if not cur_rep or cur_rep == "nan":
                is_rep, rep_name = extract_representation(get_text())
                if is_rep:
                    df.at[idx, "is_represented"] = is_rep
                    changes["is_represented"] += 1
                if rep_name:
                    cur_name = str(df.at[idx, "representative"]) if pd.notna(df.at[idx, "representative"]) else ""
                    if not cur_name or cur_name == "nan":
                        df.at[idx, "representative"] = rep_name
                        changes["representative"] += 1

            # --- Country of origin ---
            cur_country = str(df.at[idx, "country_of_origin"]) if pd.notna(df.at[idx, "country_of_origin"]) else ""
            if not cur_country or cur_country == "nan":
                country = extract_country(get_text())
                if country:
                    df.at[idx, "country_of_origin"] = country
                    changes["country_of_origin"] += 1

            # --- Hearing date ---
            cur_hd = str(df.at[idx, "hearing_date"]) if pd.notna(df.at[idx, "hearing_date"]) else ""
            if not cur_hd or cur_hd == "nan":
                hd = extract_hearing_date(get_text())
                if hd:
                    df.at[idx, "hearing_date"] = hd
                    changes["hearing_date"] += 1

            # --- Applicant name ---
            cur_app = str(df.at[idx, "applicant_name"]) if pd.notna(df.at[idx, "applicant_name"]) else ""
            if not cur_app or cur_app == "nan":
                app = extract_applicant_from_title(title, court)
                if app:
                    df.at[idx, "applicant_name"] = app
                    changes["applicant_name"] += 1

        if (end) % 10000 < batch or end == total:
            print(f"  Processed {end:,}/{total:,}... " +
                  " | ".join(f"{k}:+{v:,}" for k, v in changes.items()))

    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print("=" * 60)
    for key, count in changes.items():
        non_empty = ((df[key].astype(str).str.strip() != "") & (df[key].astype(str) != "nan")).sum() if key in df.columns else 0
        pct = non_empty / total * 100
        print(f"  {key:25s}: +{count:>7,} new  →  {non_empty:>7,} total ({pct:.1f}%)")

    if args.apply:
        tmp = str(CSV_PATH) + ".tmp"
        backup = str(CSV_PATH) + ".bak_refine"
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
