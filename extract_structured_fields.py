#!/usr/bin/env python3
"""
Extract structured fields from immigration case text files.

Extracts: applicant_name, respondent, country_of_origin,
visa_subclass_number, hearing_date, is_represented, representative,
visa_outcome_reason, legal_test_applied

Usage:
    python extract_structured_fields.py                    # process all
    python extract_structured_fields.py --dry-run          # preview without saving
    python extract_structured_fields.py --sample 100       # process 100 random
    python extract_structured_fields.py --court ARTA       # only ARTA cases
    python extract_structured_fields.py --overwrite        # re-extract already-filled fields
"""

import argparse
import csv
import os
import re
import shutil
import sys
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime
from pathlib import Path

# ── Constants ────────────────────────────────────────────────────────────

CASES_DIR = Path("downloaded_cases/case_texts")
CSV_PATH = Path("downloaded_cases/immigration_cases.csv")

# Rows between on-disk checkpoints during a long extraction run.
CHECKPOINT_EVERY = 5000

COUNTRIES = [
    "Afghanistan", "Albania", "Algeria", "Angola", "Argentina", "Armenia",
    "Azerbaijan", "Bangladesh", "Belarus", "Bhutan", "Bolivia", "Bosnia",
    "Brazil", "Brunei", "Bulgaria", "Burma", "Burundi", "Cambodia",
    "Cameroon", "Central African Republic", "Chad", "Chile", "China",
    "Colombia", "Comoros", "Congo", "Croatia", "Cuba", "Czech Republic",
    "Djibouti", "Dominican Republic", "East Timor", "Ecuador", "Egypt",
    "El Salvador", "Eritrea", "Estonia", "Ethiopia", "Fiji", "France",
    "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Guatemala",
    "Guinea", "Guinea-Bissau", "Guyana", "Haiti", "Honduras", "Hungary",
    "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy",
    "Ivory Coast", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya",
    "Kiribati", "Korea", "Kosovo", "Kuwait", "Kyrgyzstan", "Laos",
    "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Lithuania",
    "Macedonia", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali",
    "Malta", "Mauritania", "Mauritius", "Mexico", "Moldova", "Mongolia",
    "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru",
    "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria",
    "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan",
    "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru",
    "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia",
    "Rwanda", "Samoa", "Saudi Arabia", "Senegal", "Serbia", "Sierra Leone",
    "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia",
    "South Africa", "South Korea", "South Sudan", "Spain", "Sri Lanka",
    "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan",
    "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga",
    "Trinidad", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu", "Uganda",
    "Ukraine", "United Arab Emirates", "United Kingdom", "United States",
    "Uruguay", "Uzbekistan", "Vanuatu", "Venezuela", "Vietnam", "Yemen",
    "Zambia", "Zimbabwe",
]

# Demonym → Country mapping for "X citizen" patterns
DEMONYMS = {
    "Afghan": "Afghanistan", "Albanian": "Albania", "Algerian": "Algeria",
    "Angolan": "Angola", "Argentine": "Argentina", "Armenian": "Armenia",
    "Azerbaijani": "Azerbaijan", "Bangladeshi": "Bangladesh",
    "Belarusian": "Belarus", "Bhutanese": "Bhutan", "Bolivian": "Bolivia",
    "Bosnian": "Bosnia", "Brazilian": "Brazil", "Bulgarian": "Bulgaria",
    "Burmese": "Myanmar", "Burundian": "Burundi", "Cambodian": "Cambodia",
    "Cameroonian": "Cameroon", "Chadian": "Chad", "Chilean": "Chile",
    "Chinese": "China", "Colombian": "Colombia", "Congolese": "Congo",
    "Croatian": "Croatia", "Cuban": "Cuba", "Czech": "Czech Republic",
    "Dominican": "Dominican Republic", "Ecuadorian": "Ecuador",
    "Egyptian": "Egypt", "Eritrean": "Eritrea", "Estonian": "Estonia",
    "Ethiopian": "Ethiopia", "Fijian": "Fiji", "French": "France",
    "Georgian": "Georgia", "German": "Germany", "Ghanaian": "Ghana",
    "Greek": "Greece", "Guatemalan": "Guatemala", "Guinean": "Guinea",
    "Guyanese": "Guyana", "Haitian": "Haiti", "Honduran": "Honduras",
    "Hungarian": "Hungary", "Indian": "India", "Indonesian": "Indonesia",
    "Iranian": "Iran", "Iraqi": "Iraq", "Irish": "Ireland",
    "Israeli": "Israel", "Italian": "Italy", "Jamaican": "Jamaica",
    "Japanese": "Japan", "Jordanian": "Jordan", "Kazakh": "Kazakhstan",
    "Kenyan": "Kenya", "Korean": "Korea", "Kosovar": "Kosovo",
    "Kuwaiti": "Kuwait", "Kyrgyz": "Kyrgyzstan", "Laotian": "Laos",
    "Latvian": "Latvia", "Lebanese": "Lebanon", "Liberian": "Liberia",
    "Libyan": "Libya", "Lithuanian": "Lithuania", "Macedonian": "Macedonia",
    "Malagasy": "Madagascar", "Malawian": "Malawi", "Malaysian": "Malaysia",
    "Maldivian": "Maldives", "Malian": "Mali", "Maltese": "Malta",
    "Mauritian": "Mauritius", "Mexican": "Mexico", "Moldovan": "Moldova",
    "Mongolian": "Mongolia", "Montenegrin": "Montenegro",
    "Moroccan": "Morocco", "Mozambican": "Mozambique",
    "Namibian": "Namibia", "Nauruan": "Nauru", "Nepalese": "Nepal",
    "Nepali": "Nepal", "Dutch": "Netherlands",
    "New Zealander": "New Zealand", "Nicaraguan": "Nicaragua",
    "Nigerian": "Nigeria", "Norwegian": "Norway", "Omani": "Oman",
    "Pakistani": "Pakistan", "Palestinian": "Palestine",
    "Panamanian": "Panama", "Papua New Guinean": "Papua New Guinea",
    "Paraguayan": "Paraguay", "Peruvian": "Peru", "Filipino": "Philippines",
    "Philippine": "Philippines", "Polish": "Poland",
    "Portuguese": "Portugal", "Qatari": "Qatar", "Romanian": "Romania",
    "Russian": "Russia", "Rwandan": "Rwanda", "Samoan": "Samoa",
    "Saudi": "Saudi Arabia", "Senegalese": "Senegal", "Serbian": "Serbia",
    "Sierra Leonean": "Sierra Leone", "Singaporean": "Singapore",
    "Slovak": "Slovakia", "Slovenian": "Slovenia",
    "Somali": "Somalia", "South African": "South Africa",
    "South Sudanese": "South Sudan", "Spanish": "Spain",
    "Sri Lankan": "Sri Lanka", "Sudanese": "Sudan",
    "Surinamese": "Suriname", "Swedish": "Sweden", "Swiss": "Switzerland",
    "Syrian": "Syria", "Taiwanese": "Taiwan", "Tajik": "Tajikistan",
    "Tanzanian": "Tanzania", "Thai": "Thailand",
    "Timorese": "Timor-Leste", "Togolese": "Togo", "Tongan": "Tonga",
    "Trinidadian": "Trinidad", "Tunisian": "Tunisia", "Turkish": "Turkey",
    "Turkmen": "Turkmenistan", "Tuvaluan": "Tuvalu", "Ugandan": "Uganda",
    "Ukrainian": "Ukraine", "Emirati": "United Arab Emirates",
    "British": "United Kingdom", "American": "United States",
    "Uruguayan": "Uruguay", "Uzbek": "Uzbekistan",
    "Venezuelan": "Venezuela", "Vietnamese": "Vietnam", "Yemeni": "Yemen",
    "Zambian": "Zambia", "Zimbabwean": "Zimbabwe",
}

# Interpreter language → Country mapping
LANGUAGE_COUNTRY = {
    "Mandarin": "China", "Cantonese": "China", "Putonghua": "China",
    "Arabic": "Egypt",  # default; may be overridden by context
    "Dari": "Afghanistan", "Pashto": "Afghanistan", "Hazaragi": "Afghanistan",
    "Farsi": "Iran", "Persian": "Iran",
    "Vietnamese": "Vietnam",
    "Tamil": "Sri Lanka",
    "Sinhalese": "Sri Lanka", "Sinhala": "Sri Lanka",
    "Hindi": "India", "Punjabi": "India", "Bengali": "Bangladesh",
    "Urdu": "Pakistan",
    "Burmese": "Myanmar", "Karen": "Myanmar",
    "Nepali": "Nepal",
    "Khmer": "Cambodia",
    "Thai": "Thailand",
    "Indonesian": "Indonesia", "Bahasa Indonesia": "Indonesia",
    "Tagalog": "Philippines", "Filipino": "Philippines",
    "Tigrinya": "Eritrea", "Tigre": "Eritrea",
    "Amharic": "Ethiopia", "Oromo": "Ethiopia",
    "Somali": "Somalia",
    "Swahili": "Tanzania",
    "Rohingya": "Myanmar",
    "Kurdish": "Iraq", "Kurmanji": "Iraq", "Sorani": "Iraq",
    "Hazara": "Afghanistan",
    "Uzbek": "Uzbekistan",
    "Turkmen": "Turkmenistan",
    "Georgian": "Georgia",
    "Ukrainian": "Ukraine",
    "Russian": "Russia",
    "Bahasa Malaysia": "Malaysia", "Malay": "Malaysia",
}

# Build regex patterns
_countries_pattern = "|".join(re.escape(c) for c in sorted(COUNTRIES, key=len, reverse=True))
_demonyms_pattern = "|".join(re.escape(d) for d in sorted(DEMONYMS.keys(), key=len, reverse=True))

# ── Label keywords used as terminators in horizontal-format DECISION RECORD ──
_LABEL_STOP = (
    r"(?:MEMBER|CASE\s+NUMBER|HOME\s+AFFAIRS|APPLICANTS?|TRIBUNAL\s+MEMBER|"
    r"DATE|DECISION|CATCHWORDS|DIVISION|PLACE|LEGISLATION|STATEMENT\s+OF|"
    r"MRT|RRT|DIAC|DIBP|DIMA)\s*:"
)

RE_CITIZEN_OF = re.compile(
    rf"(?:citizen|national|resident)\s+of\s+({_countries_pattern})",
    re.IGNORECASE,
)
RE_DEMONYM_CITIZEN = re.compile(
    rf"(?:an?\s+)?({_demonyms_pattern})\s+(?:citizen|national)",
    re.IGNORECASE,
)
RE_BORN_IN = re.compile(
    rf"born\s+in\s+({_countries_pattern})",
    re.IGNORECASE,
)
RE_FROM_COUNTRY = re.compile(
    rf"(?:arrived|came|fled|travelled|traveled)\s+(?:in\s+Australia\s+)?from\s+({_countries_pattern})",
    re.IGNORECASE,
)

RE_SUBCLASS = re.compile(r"[Ss]ubclass\s+(\d{3})")
RE_HEARING_DATE = re.compile(
    r"(?:heard|hearing)[^\n]{0,40}?(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})",
    re.IGNORECASE,
)
RE_HEARING_DATE2 = re.compile(
    r"Date\s+of\s+(?:hearing|hearing\s+and\s+decision)[:\s]+(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})",
    re.IGNORECASE,
)
RE_DATE_HEARD = re.compile(
    r"Date\s+heard\s*:?\s*(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})",
    re.IGNORECASE,
)

# Title parsing
RE_TITLE_V = re.compile(r"^(.+?)\s+v\s+(.+?)(?:\s*\[\d{4}\]|\s*$)", re.IGNORECASE)
RE_TITLE_AND = re.compile(r"^(.+?)\s+and\s+(Minister.+?)(?:\s*\[\d{4}\]|\s*$)", re.IGNORECASE)
# AATA/ARTA style: "Surname (Migration) [2019] AATA 2398 (date)"
RE_TITLE_AATA = re.compile(r"^(.+?)\s+\((?:Migration|Refugee|Character|Citizenship)\)\s*\[", re.IGNORECASE)
# "X and Migration Agents Registration Authority" / "X and Secretary, Department..."
RE_TITLE_AND_ORG = re.compile(
    r"^(.+?)\s+and\s+((?:Migrations?\s+Agents?\s+Registration\s+Authority|"
    r"Secretary,?\s+Department.+?|Department\s+of.+?|Migration\s+Review\s+Tribunal|"
    r"Military\s+Rehabilitation.+?))(?:\s*\(|\s*\[\d{4}\]|\s*$)",
    re.IGNORECASE,
)
# "X; Secretary, Department..." (semicolon separator in FOI cases)
RE_TITLE_SEMICOLON = re.compile(
    r"^(.+?);\s*(Secretary,?\s+Department.+?)(?:\s+and\s*\(|\s*\[\d{4}\]|\s*$)",
    re.IGNORECASE,
)

# AATA structured preamble fields (name on next line after label)
RE_AATA_APPLICANT = re.compile(
    r"APPLICANT(?:\(S\))?:\s*\n\s*\n?\s*(.+?)(?:\s*CASE\s*NUMBER|\s*\n\s*\n)",
    re.IGNORECASE,
)
RE_AATA_REPRESENTATIVE = re.compile(
    r"(?:APPLICANT(?:'?S)?\s+REPRESENTATIVE|REPRESENTATIVE\s+FOR\s+(?:THE\s+)?APPLICANT)\s*:\s*\n\s*\n?\s*(.+?)(?:\s*\n\s*\n|\s*DECISION|\s*DATE)",
    re.IGNORECASE,
)

# NEW: REPRESENTATIVE: label in newer AATA/RRTA/ARTA DECISION RECORD format (2015+)
# Format: "...applicant(s) REPRESENTATIVE:\n\nName (MARN: XXXXX) CASE NUMBER:..."
RE_DECISION_RECORD_REP = re.compile(
    r"REPRESENTATIVE\s*:\s*\n{1,3}\s*(.+?)(?:\s+" + _LABEL_STOP + r"|\n{2,})",
    re.IGNORECASE | re.DOTALL,
)

# "X national" pattern (e.g., "Indian national", "a Sri Lankan national")
RE_DEMONYM_NATIONAL = re.compile(
    rf"(?:an?\s+)?({_demonyms_pattern})\s+(?:national|citizen|born)",
    re.IGNORECASE,
)

# Representation patterns
RE_SELF_REP = re.compile(
    r"(?:self[- ]represented|appeared?\s+(?:in\s+person|on\s+(?:his|her|their)\s+own\s+behalf)|unrepresented|without\s+representation)",
    re.IGNORECASE,
)
RE_REP_BY = re.compile(
    r"(?:represented\s+by|Counsel\s+for\s+the\s+Applicant)\s*:?\s*(.+?)(?:\n|,\s*instructed|$)",
    re.IGNORECASE,
)
RE_APPLICANT_REP = re.compile(
    r"Applicant(?:'s)?\s+Representative\s*:?\s*\n?\s*(.+?)(?:\n|$)",
    re.IGNORECASE,
)
# FCA/FCCA multiline format: "Counsel for the Appellant:\nMr X Solicitor for the Appellant:"
RE_FCA_COUNSEL_APPELLANT = re.compile(
    r"(?:Counsel|Solicitor)\s+for\s+(?:the\s+)?(?:Appellant|Applicant)s?:?\s*\n\s*"
    r"([^\n]{3,80}?)(?:\s+(?:Solicitor|Counsel|Appearing)\s+for\s+the\s+|\s*\n|$)",
    re.IGNORECASE,
)
# "For the Appellant: Mr Smith" pattern
RE_FOR_APPELLANT = re.compile(
    r"^For\s+(?:the\s+)?(?:Appellant|Applicant)s?:?\s+(.{3,80}?)(?:\n|$)",
    re.IGNORECASE | re.MULTILINE,
)
# "Migration Agent: [name]" label (MRTA/AATA cases)
RE_MIGRATION_AGENT = re.compile(
    r"(?:Migration\s+Agent|Registered\s+Migration\s+Agent)\s*:\s*\n?\s*(.+?)(?:\n|$)",
    re.IGNORECASE,
)
# "appeared/appearing for the applicant: name"
RE_APPEARED_FOR = re.compile(
    r"(?:appeared?|appearing)\s+(?:on\s+behalf\s+of|for)\s+(?:the\s+)?(?:appellant|applicant)s?"
    r"[:\s]+([A-Z][^\n]{2,60}?)(?:\n|$)",
    re.IGNORECASE,
)

# NEW: "represented in relation to the review" — common AATA/RRTA/MRTA body text pattern
RE_REPRESENTED_IN_REVIEW = re.compile(
    r"represented\s+in\s+relation\s+to\s+the\s+review\s+by\s+(?:his|her|their|a)\s+"
    r"(?:registered\s+)?(?:migration\s+agent|solicitor|barrister|counsel|adviser|advisor|lawyer)"
    r"(?:,?\s+([A-Z][^\n,\.]{2,60}?))?(?:\.|,|\n)",
    re.IGNORECASE,
)
# Broader: any "represented in relation to review" mention (no name extraction)
RE_REPR_IN_REVIEW_GENERIC = re.compile(
    r"(?:applicants?\s+were\s+represented|represented\s+in\s+relation\s+to\s+the\s+review)",
    re.IGNORECASE,
)

# NEW: "appeared before the Tribunal in person / unrepresented"
RE_APPEARED_UNREPRESENTED = re.compile(
    r"(?:applicant|review\s+applicant|appellant)\s+appeared\s+(?:at|before)\s+the\s+tribunal\s+"
    r"(?:in\s+person|unrepresented|without\s+(?:legal\s+)?representation|on\s+(?:his|her|their)\s+own\s+behalf)",
    re.IGNORECASE,
)
# "not represented" / "no representative" / explicit no-representation phrases
RE_NOT_REPRESENTED = re.compile(
    r"(?:was\s+(?:not|never)\s+(?:legally\s+)?represented|"
    r"no\s+(?:legal\s+)?representative|"
    r"applicant\s+(?:was\s+)?unrepresented|"
    r"did\s+not\s+have\s+(?:a\s+)?(?:legal\s+)?representative)",
    re.IGNORECASE,
)

# Country of Reference label (RRTA structured header)
# Fixed: stops before horizontal-format label keywords
RE_COUNTRY_REF = re.compile(
    rf"Country\s+of\s+(?:Reference|Origin|Citizenship)\s*:\s*\n{{0,2}}\s*(.+?)"
    rf"(?:\s+(?:{_LABEL_STOP})|[\n]|$)",
    re.IGNORECASE,
)
# Nationality label
RE_NATIONALITY_LABEL = re.compile(
    rf"Nationality\s*:\s*\n{{0,2}}\s*(.+?)"
    rf"(?:\s+(?:{_LABEL_STOP})|[\n]|$)",
    re.IGNORECASE,
)
# "People's Republic of China" alias
RE_PRC = re.compile(
    r"(?:People'?s?\s+Republic\s+of\s+China|P\.R\.C\.?)\b",
    re.IGNORECASE,
)

# NEW: "a national of [Country]" / "national of [Country]"
RE_NATIONAL_OF = re.compile(
    rf"(?:a\s+)?national\s+of\s+({_countries_pattern})",
    re.IGNORECASE,
)

# NEW: "claimed/claims to be a citizen/national of [Country]"
RE_CLAIMED_NATIONAL = re.compile(
    rf"claims?\s+to\s+be\s+(?:a\s+)?(?:citizen|national|passport\s+holder)\s+of\s+({_countries_pattern})",
    re.IGNORECASE,
)

# NEW: Citizenship label (alternative to Nationality)
RE_CITIZENSHIP_LABEL = re.compile(
    rf"Citizenship\s*:\s*\n{{0,2}}\s*(.+?)"
    rf"(?:\s+(?:{_LABEL_STOP})|[\n]|$)",
    re.IGNORECASE,
)

# NEW: MRTA old format: "(Name, DOB, Sex, Nationality)\tFirst Last, dd/mm/yy, male/female, Country"
RE_MRTA_NAT_HEADER = re.compile(
    r"\(Name,\s*DOB,\s*Sex,\s*Nationality\)\s+[^\n]+?(?:male|female|M\b|F\b)[^\n]*?,\s*"
    r"((?:People'?s?\s+Republic\s+of\s+)?[A-Z][^\n,]{1,40}?)(?:\s*\n|\s*$)",
    re.IGNORECASE,
)

# NEW: INTERPRETER label → language to country
RE_INTERPRETER = re.compile(
    r"INTERPRETER\s*:\s*\n?\s*(.+?)(?:\n|$)",
    re.IGNORECASE,
)

# ── Catchwords and legal test patterns ──────────────────────────────────
RE_CATCHWORDS_SECTION = re.compile(
    r"CATCHWORDS?\s*[:\n]+\s*(.+?)(?=\n\s*(?:LEGISLATION|STATEMENT\s+OF|DECISION\s+AND\s+REASONS|$))",
    re.IGNORECASE | re.DOTALL,
)
RE_LEGISLATION_SECTION = re.compile(
    r"LEGISLATION\s*\n+(.+?)(?=\n\s*(?:STATEMENT\s+OF|CATCHWORDS|$))",
    re.IGNORECASE | re.DOTALL,
)
# Section reference patterns
RE_SECTION_REF = re.compile(
    r"\bs(?:ection)?\s*\.?\s*(\d+[A-Z]?(?:\([^\)]{1,20}\))?)\b",
    re.IGNORECASE,
)
RE_CLAUSE_REF = re.compile(
    r"\bcl(?:ause)?\s*\.?\s*([\d]{3}\.\d+(?:\([^\)]{1,20}\))?)\b",
    re.IGNORECASE,
)


# ── Extraction Functions ─────────────────────────────────────────────────


def extract_from_title(title: str) -> tuple[str, str]:
    """Extract applicant_name and respondent from case title."""
    if not title:
        return "", ""

    # Try "X v Y" pattern first (FCA, FCCA, HCA style)
    m = RE_TITLE_V.match(title.strip())
    if m:
        return m.group(1).strip(), m.group(2).strip()

    # Try "X and Minister..." pattern (AATA, ARTA style)
    m = RE_TITLE_AND.match(title.strip())
    if m:
        return m.group(1).strip(), m.group(2).strip()

    # Try "X and [Organization]" (MARA, Secretary, Department, etc.)
    m = RE_TITLE_AND_ORG.match(title.strip())
    if m:
        return m.group(1).strip(), m.group(2).strip()

    # Try "X; Secretary, Department..." (FOI cases with semicolon)
    m = RE_TITLE_SEMICOLON.match(title.strip())
    if m:
        return m.group(1).strip(), m.group(2).strip()

    # Try "Surname (Migration/Refugee)" pattern (AATA surname-only)
    m = RE_TITLE_AATA.match(title.strip())
    if m:
        name = m.group(1).strip()
        # Skip anonymous numeric IDs (e.g. "1606474")
        if not name.replace(" ", "").isdigit():
            return name, ""

    # Last resort: handle "Xv Minister" (no space before v) — rare typo
    m = re.match(r"^(.+?)v\s+(Minister.+?)(?:\s*\[\d{4}\]|\s*$)", title.strip(), re.IGNORECASE)
    if m:
        return m.group(1).strip(), m.group(2).strip()

    return "", ""


def _demonym_to_country(demonym: str) -> str:
    """Resolve a demonym string to its country name."""
    for key, country in DEMONYMS.items():
        if key.lower() == demonym.lower():
            return country
    return ""


def _clean_country_value(val: str) -> str:
    """Strip trailing label fragments from country value (horizontal format bug fix)."""
    if not val:
        return val
    # Strip anything after uppercase label-like pattern (e.g. "China MEMBER:" → "China")
    cleaned = re.sub(r"\s+[A-Z][A-Z0-9\s]*:.*$", "", val).strip()
    # Strip trailing punctuation
    cleaned = cleaned.rstrip(".,;:")
    return cleaned.strip()


def _normalise_country(val: str) -> str:
    """Normalise a raw country string to a canonical country name."""
    if not val:
        return ""
    val = _clean_country_value(val)
    if not val:
        return ""

    # People's Republic of China → China
    if re.search(r"People'?s?\s+Republic\s+of\s+China|P\.R\.C\.?", val, re.IGNORECASE):
        return "China"

    # Exact match in COUNTRIES list
    for c in COUNTRIES:
        if c.lower() == val.lower():
            return c

    # Try partial match (e.g. "Republic of Korea" → "Korea")
    for c in sorted(COUNTRIES, key=len, reverse=True):
        if c.lower() in val.lower():
            return c

    # Try demonym
    d = _demonym_to_country(val)
    if d:
        return d

    # Return cleaned value as-is (might be legitimate but unlisted)
    return val


def extract_country(text: str) -> str:
    """Extract country of origin from case text."""
    if not text:
        return ""

    preamble = text[:4000]
    body = text[:15000]

    # 1. Try structured "Country of Reference/Origin:" label first (RRTA/AATA, most reliable)
    m = RE_COUNTRY_REF.search(preamble)
    if m:
        result = _normalise_country(m.group(1))
        if result:
            return result

    # 2. Try "Nationality:" label
    m = RE_NATIONALITY_LABEL.search(preamble)
    if m:
        val = m.group(1).strip().rstrip(".,")
        result = _normalise_country(val)
        if result:
            return result

    # 3. Try "Citizenship:" label
    m = RE_CITIZENSHIP_LABEL.search(preamble)
    if m:
        val = m.group(1).strip().rstrip(".,")
        result = _normalise_country(val)
        if result:
            return result

    # 4. MRTA old format: "(Name, DOB, Sex, Nationality) [name], [date], [sex], [country]"
    m = RE_MRTA_NAT_HEADER.search(preamble)
    if m:
        result = _normalise_country(m.group(1))
        if result:
            return result

    # 5. People's Republic of China → China (high confidence, early)
    if RE_PRC.search(body):
        return "China"

    # 6. "INTERPRETER: [language]" → map language to country
    m = RE_INTERPRETER.search(preamble)
    if m:
        lang = m.group(1).strip().split("(")[0].strip()
        for lang_key, country in LANGUAGE_COUNTRY.items():
            if lang_key.lower() in lang.lower():
                return country

    # 7. "citizen/national of [Country]" (explicit)
    m = RE_CITIZEN_OF.search(body)
    if m:
        return m.group(1)

    # 8. "claims/claimed to be a citizen/national of [Country]"
    m = RE_CLAIMED_NATIONAL.search(body)
    if m:
        return m.group(1)

    # 9. "a national of [Country]"
    m = RE_NATIONAL_OF.search(body)
    if m:
        return m.group(1)

    # 10. "[Demonym] citizen/national" (e.g. "an Indian citizen")
    m = RE_DEMONYM_CITIZEN.search(body)
    if m:
        result = _demonym_to_country(m.group(1))
        if result:
            return result

    # 11. "[Demonym] national/born" (e.g. "Indian national", "Sri Lankan born")
    m = RE_DEMONYM_NATIONAL.search(body)
    if m:
        result = _demonym_to_country(m.group(1))
        if result:
            return result

    # 12. "born in [Country]"
    m = RE_BORN_IN.search(body)
    if m:
        return m.group(1)

    # 13. "arrived/fled from [Country]"
    m = RE_FROM_COUNTRY.search(body)
    if m:
        return m.group(1)

    # 14. "the applicant is/was from [Country]" or "applicant from [Country]"
    m = re.search(
        rf"(?:the\s+)?applicant\s+(?:is\s+)?(?:a\s+)?(?:from|of)\s+({_countries_pattern})",
        body, re.IGNORECASE,
    )
    if m:
        return m.group(1)

    # 15. "from [Country]" near "applicant" (within 200 chars)
    for match in re.finditer(r"applicant", body[:10000], re.IGNORECASE):
        chunk = body[match.start():match.start() + 200]
        m = re.search(rf"from\s+({_countries_pattern})\b", chunk, re.IGNORECASE)
        if m and m.group(1) != "Australia":
            return m.group(1)

    # 16. "[Country] passport"
    m = re.search(rf"({_countries_pattern})\s+passport", body[:10000], re.IGNORECASE)
    if m:
        return m.group(1)

    # Skip AustLII navigation bar — find body text after separator line
    _SKIP_COUNTRIES = {"Australia", "New Zealand"}
    body_start = text.find("=" * 20)
    body_text = text[body_start + 80:] if body_start > 0 else text[500:]

    # 17. "fear of persecution/harm in [Country]" or "return to [Country]"
    m = re.search(
        rf"(?:persecution|harm|return(?:ed)?|refoul)\s+(?:in|to)\s+({_countries_pattern})",
        body_text[:10000], re.IGNORECASE,
    )
    if m and m.group(1) not in _SKIP_COUNTRIES:
        return m.group(1)

    # 18. First non-AU/NZ country mentioned in text body
    for m in re.finditer(rf"\b({_countries_pattern})\b", body_text[:6000], re.IGNORECASE):
        country = m.group(1)
        if country not in _SKIP_COUNTRIES:
            return country

    return ""


def extract_visa_subclass_number(text: str, existing_subclass: str, visa_type: str = "") -> str:
    """Extract visa subclass number (3-digit) from text or existing fields."""
    # First try existing visa_subclass field
    if existing_subclass:
        m = re.search(r"(\d{3})", existing_subclass)
        if m:
            return m.group(1)

    # Try visa_type field (e.g. "Protection visa (subclass 866)")
    if visa_type:
        m = re.search(r"(?:subclass|Subclass)\s+(\d{3})", visa_type)
        if m:
            return m.group(1)

    # Search in text
    if text:
        m = RE_SUBCLASS.search(text)
        if m:
            return m.group(1)

    return ""


_MONTHS = r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
RE_AATA_DATE = re.compile(
    rf"DATE\s*:\s*\n\s*\n?\s*(\d{{1,2}}\s+{_MONTHS}\s+\d{{4}})",
    re.IGNORECASE,
)
RE_STATEMENT_MADE = re.compile(
    rf"Statement\s+made\s+on\s+(\d{{1,2}}\s+{_MONTHS}\s+\d{{4}})",
    re.IGNORECASE,
)
RE_DECISION_ON = re.compile(
    rf"(?:decision|decided|delivered|handed\s+down)\s+(?:on\s+)?(\d{{1,2}}\s+{_MONTHS}\s+\d{{4}})",
    re.IGNORECASE,
)
# Fallback: "Date of judgment: DD Month YYYY" or "Judgment of: ... Date of judgment: ..."
RE_JUDGMENT_DATE = re.compile(
    rf"Date\s+of\s+(?:judgment|decision|orders?)\s*:\s*\n?\s*(\d{{1,2}}\s+{_MONTHS}\s+\d{{4}})",
    re.IGNORECASE,
)
# Fallback: "Judgment: DD Month YYYY" on its own line
RE_JUDGMENT_LINE = re.compile(
    rf"(?:^|\n)\s*(?:Judgment|Decision|Delivered\s+on)\s*:\s*\n?\s*(\d{{1,2}}\s+{_MONTHS}\s+\d{{4}})",
    re.IGNORECASE,
)


def extract_hearing_date(text: str) -> str:
    """Extract hearing date from case text."""
    if not text:
        return ""

    # Try "Date of hearing: [date]" first (most explicit)
    m = RE_HEARING_DATE2.search(text)
    if m:
        return m.group(1)

    # Try "heard/hearing ... [date]"
    m = RE_HEARING_DATE.search(text)
    if m:
        return m.group(1)

    # Try AATA structured "DATE:\n\nDD Month YYYY" field
    m = RE_AATA_DATE.search(text[:3000])
    if m:
        return m.group(1)

    # Try "Statement made on DD Month YYYY"
    m = RE_STATEMENT_MADE.search(text[:5000])
    if m:
        return m.group(1)

    # Try "decision on / delivered DD Month YYYY"
    m = RE_DECISION_ON.search(text[:5000])
    if m:
        return m.group(1)

    # Fallback: "Date of judgment/decision: DD Month YYYY"
    m = RE_JUDGMENT_DATE.search(text[:5000])
    if m:
        return m.group(1)

    # Fallback: "Judgment: DD Month YYYY" on its own
    m = RE_JUDGMENT_LINE.search(text[:5000])
    if m:
        return m.group(1)

    # Fallback: "Date heard: DD Month YYYY"
    m = RE_DATE_HEARD.search(text[:5000])
    if m:
        return m.group(1)

    return ""


def extract_representation(text: str) -> tuple[str, str]:
    """Extract representation info. Returns (is_represented, representative)."""
    # Widen to 15000 chars — newer AATA/RRTA/FCA appearance sections can be deeper
    preamble = text[:15000]

    # 1. Check newer AATA/RRTA DECISION RECORD "REPRESENTATIVE:" label (most reliable for 2015+)
    m = RE_DECISION_RECORD_REP.search(text[:5000])
    if m:
        rep_name = m.group(1).strip()
        # Clean up: strip trailing label fragments and MARN numbers
        rep_name = re.sub(r"\s*\(MARN\s*:.*?\)", "", rep_name, flags=re.IGNORECASE | re.DOTALL).strip()
        rep_name = re.sub(r"\s+[A-Z][A-Z\s]*:.*$", "", rep_name, flags=re.DOTALL).strip()
        rep_name = rep_name.replace("\n", " ")
        rep_name = rep_name.rstrip(".,;:")
        if rep_name and not re.search(r"nil|none|n/a|not\s+applicable", rep_name, re.IGNORECASE):
            return "Yes", rep_name
        elif re.search(r"nil|none|n/a|not\s+applicable", rep_name, re.IGNORECASE):
            return "No", ""

    # 2. Check for explicit self-representation
    if RE_SELF_REP.search(preamble):
        # Could also have a representative mentioned elsewhere
        m = RE_REP_BY.search(preamble)
        if m:
            rep_name = m.group(1).strip()
            if rep_name.lower() not in ("the applicant is self-represented", "self-represented", ""):
                return "Yes", rep_name
        return "No", ""

    # 3. Check for "not represented / unrepresented" explicit markers
    if RE_NOT_REPRESENTED.search(preamble):
        return "No", ""

    # 4. Check for "appeared before Tribunal in person / unrepresented"
    if RE_APPEARED_UNREPRESENTED.search(preamble):
        return "No", ""

    # 5. Check for "represented in relation to the review by registered migration agent"
    m = RE_REPRESENTED_IN_REVIEW.search(preamble)
    if m:
        # Try to get representative name
        rep_name = ""
        if m.group(1):
            rep_name = m.group(1).strip()
        # Also try broader name extraction after the pattern
        if not rep_name:
            # Look for name near "represented in relation"
            name_chunk = preamble[max(0, m.start() - 10):m.end() + 150]
            nm = re.search(r"(?:by\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})", name_chunk)
            if nm and nm.group(1) not in ("The", "In", "His", "Her", "Their", "The Tribunal", "A Migration"):
                rep_name = nm.group(1)
        return "Yes", rep_name

    # Generic "represented in relation to review" mention (no name)
    if RE_REPR_IN_REVIEW_GENERIC.search(preamble):
        return "Yes", ""

    # 6. Check for "Applicant's Representative: [name]"
    m = RE_APPLICANT_REP.search(preamble)
    if m:
        rep_name = m.group(1).strip()
        if re.search(r"self[- ]represented|nil|none|n/a", rep_name, re.IGNORECASE):
            return "No", ""
        return "Yes", rep_name

    # 7. Check for "represented by [name]"
    m = RE_REP_BY.search(preamble)
    if m:
        rep_name = m.group(1).strip()
        if rep_name.lower() not in ("the applicant is self-represented", "self-represented", ""):
            return "Yes", rep_name

    # 8. FCA/FCCA multiline: "Counsel for the Appellant:\nMr X Solicitor for the..."
    m = RE_FCA_COUNSEL_APPELLANT.search(preamble)
    if m:
        rep_name = m.group(1).strip()
        rep_name = re.sub(r"\s+(?:Solicitor|Counsel|Appearing)\s+.*$", "", rep_name, flags=re.IGNORECASE).strip()
        if rep_name and len(rep_name) > 2 and not re.search(r"self[- ]represented|nil|none|n/a", rep_name, re.IGNORECASE):
            return "Yes", rep_name

    # 9. "For the Appellant: Mr Smith" pattern
    m = RE_FOR_APPELLANT.search(preamble)
    if m:
        rep_name = m.group(1).strip()
        if rep_name and len(rep_name) > 2:
            return "Yes", rep_name

    # 10. Migration Agent label (MRTA/AATA cases)
    m = RE_MIGRATION_AGENT.search(preamble)
    if m:
        agent = m.group(1).strip()
        if agent and not re.search(r"nil|none|n/a|unrepresented", agent, re.IGNORECASE):
            return "Yes", agent

    # 11. "appeared for the applicant: name" pattern
    m = RE_APPEARED_FOR.search(preamble)
    if m:
        rep_name = m.group(1).strip()
        if rep_name and len(rep_name) > 2:
            return "Yes", rep_name

    # 12. AATA structured representative field (old format)
    m = RE_AATA_REPRESENTATIVE.search(text[:5000])
    if m:
        rep_name = m.group(1).strip()
        if rep_name and not re.search(r"self[- ]represented|nil|none|n/a", rep_name, re.IGNORECASE):
            return "Yes", rep_name
        elif re.search(r"self[- ]represented|nil|none|n/a", rep_name, re.IGNORECASE):
            return "No", ""

    return "", ""


def extract_visa_outcome_reason(text: str) -> str:
    """Extract the reason for visa outcome from CATCHWORDS section."""
    if not text:
        return ""

    # Extract CATCHWORDS section
    m = RE_CATCHWORDS_SECTION.search(text[:8000])
    if not m:
        return ""

    catchwords = m.group(1).strip()
    # Clean up: remove newlines and extra whitespace
    catchwords = re.sub(r"\s+", " ", catchwords).strip()
    # Remove leading "MIGRATION –" prefix
    catchwords = re.sub(r"^(?:MIGRATION|IMMIGRATION)\s*[–\-]\s*", "", catchwords, flags=re.IGNORECASE).strip()

    # Limit to 300 chars
    if len(catchwords) > 300:
        catchwords = catchwords[:300].rsplit(" ", 1)[0] + "..."

    return catchwords


def extract_legal_test(text: str) -> str:
    """Extract primary legal test/section applied from CATCHWORDS and LEGISLATION."""
    if not text:
        return ""

    # Key section markers with their legal test names
    LEGAL_TESTS = [
        (r"\bs\.?\s*36\b", "s.36 refugee test"),
        (r"\bs\.?\s*501\b", "s.501 character test"),
        (r"\bs\.?\s*499\b", "s.499 ministerial direction"),
        (r"\bs\.?\s*48A\b", "s.48A bar on re-application"),
        (r"\bs\.?\s*417\b", "s.417 ministerial intervention"),
        (r"\bs\.?\s*351\b", "s.351 ministerial intervention (MRTA)"),
        (r"\bs\.?\s*195A\b", "s.195A ministerial intervention"),
        (r"\bs\.?\s*48B\b", "s.48B ministerial direction"),
        (r"\bs\.?\s*101\b\s+character", "s.101 character (citizenship)"),
        (r"\bs\.?\s*24\b.*citizenship", "s.24 citizenship refusal"),
        (r"\brisk\s+(?:of|to)\s+(?:significant|serious)\s+harm\b", "complementary protection"),
        (r"\bcharacter\s+test\b", "character test"),
        (r"\bgenuine\s+temporary\s+entrant\b", "genuine temporary entrant test"),
        (r"\bgenuine\s+applicant\s+for\s+entry\b", "genuine student test"),
        (r"\bbalance\s+of\s+family\s+test\b", "balance of family test"),
        (r"\bprotection\s+obligations\b", "refugee/protection obligations"),
    ]

    search_text = text[:6000]

    for pattern, label in LEGAL_TESTS:
        if re.search(pattern, search_text, re.IGNORECASE):
            return label

    # Try to extract primary section from LEGISLATION section
    m = RE_LEGISLATION_SECTION.search(text[:6000])
    if m:
        leg_text = m.group(1)[:500]
        sections = RE_SECTION_REF.findall(leg_text)
        if sections:
            # Return most frequently cited meaningful section
            non_trivial = [s for s in sections if re.search(r"\d+", s) and int(re.search(r"\d+", s).group()) > 30]  # type: ignore[union-attr]
            if non_trivial:
                counter = Counter(non_trivial)
                return f"s.{counter.most_common(1)[0][0]}"

    return ""


# Reserved result key: process_case() reports a swallowed worker exception
# through it, because a worker runs in another process and cannot increment
# a counter in the parent. main() pops it before merging fields into the row.
EXTRACTION_ERROR_KEY = "__extraction_error__"


def process_case(case_row: dict) -> dict:
    """Worker entry point. Never raises.

    ProcessPoolExecutor.map re-raises a worker exception when the result is
    consumed and then cancels every remaining future, so one unparseable row
    would throw away a 149k-row run that is 11 minutes in. Swallow per row,
    loudly, and keep going — but report the failure back to the parent so it
    can be counted and listed, rather than only writing to a stderr stream
    that interleaves across workers and scrolls away.
    """
    try:
        return _extract_case_fields(case_row)
    except Exception as exc:  # noqa: BLE001 - one bad row must not abort the run
        identifier = case_row.get("case_id") or case_row.get("citation") or "?"
        print(f"  warn: extraction failed for {identifier}: {exc}", file=sys.stderr)
        return {EXTRACTION_ERROR_KEY: f"{type(exc).__name__}: {exc}"}


def _extract_case_fields(case_row: dict) -> dict:
    """Process a single case and extract all structured fields."""
    # csv.DictReader fills a short row's missing cells with None, so `or ""`
    # rather than a get() default is what actually guarantees a str here.
    title = case_row.get("title") or ""
    citation = case_row.get("citation") or ""
    visa_subclass = case_row.get("visa_subclass") or ""
    visa_type = case_row.get("visa_type") or ""

    # Extract from title
    applicant_name, respondent = extract_from_title(title)

    # Read full text file if available
    text = ""
    text_path = case_row.get("full_text_path") or ""
    if text_path and os.path.exists(text_path):
        try:
            with open(text_path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        except (OSError, IOError):
            pass

    # Also try constructing path from citation
    if not text and citation:
        constructed_path = CASES_DIR / f"{citation}.txt"
        if constructed_path.exists():
            try:
                text = constructed_path.read_text(encoding="utf-8", errors="replace")
            except (OSError, IOError):
                pass

    # Extract from text
    country = extract_country(text) if text else ""
    visa_num = extract_visa_subclass_number(text, visa_subclass, visa_type)
    hearing_date = extract_hearing_date(text) if text else ""
    is_represented, representative = extract_representation(text) if text else ("", "")
    visa_outcome_reason = extract_visa_outcome_reason(text) if text else ""
    legal_test_applied = extract_legal_test(text) if text else ""

    # If no applicant from title, try structured fields in text
    if not applicant_name and text:
        preamble = text[:3000]
        # Try MRTA structured "REVIEW APPLICANT: Name" format (same-line or next-line)
        m = re.search(r"REVIEW\s+APPLICANT\s*:\s*\n?\s*([^\n]{2,80}?)(?:\n|$)", preamble, re.IGNORECASE)
        if m:
            name = m.group(1).strip()
            name = re.sub(r"\s*(?:CASE\s*NUMBER|FILE\s*NUMBER|DIBP\s*REF|PRESIDING|TRIBUNAL|MRT).*$", "", name, flags=re.IGNORECASE).strip()
            if name and not name.replace(" ", "").isdigit() and len(name) > 1:
                applicant_name = name
        # Try AATA structured "APPLICANT:\n\nName CASE NUMBER:" format
        m = RE_AATA_APPLICANT.search(preamble)
        if m and not applicant_name:
            name = m.group(1).strip()
            # Clean trailing "CASE NUMBER:" fragment
            name = re.sub(r"\s*CASE\s*NUMBER.*$", "", name, flags=re.IGNORECASE).strip()
            if name and not name.replace(" ", "").isdigit():
                applicant_name = name
        # Fallback: inline "Applicant: Name" on same line
        if not applicant_name:
            m = re.search(r"Applicant/?s?\s*:\s*(.+?)(?:\n|$)", preamble, re.IGNORECASE)
            if m:
                name = m.group(1).strip()
                # Clean trailing "CASE NUMBER:" or "File Number:" fragment
                name = re.sub(r"\s*(?:CASE\s*NUMBER|FILE\s*NUMBER|DIBP\s*REF).*$", "", name, flags=re.IGNORECASE).strip()
                # Skip if it's just a label fragment
                if name and len(name) > 2 and not name.replace(" ", "").isdigit():
                    applicant_name = name

    # If no respondent from title, try "Respondent:" field in text
    if not respondent and text:
        m = re.search(r"Respondent\s*:\s*(.+?)(?:\n|$)", text[:3000], re.IGNORECASE)
        if m:
            respondent = m.group(1).strip()

    # If no representative found, try AATA structured representative field
    if not representative and text:
        m = RE_AATA_REPRESENTATIVE.search(text[:5000])
        if m:
            rep_name = m.group(1).strip()
            if rep_name and not re.search(r"self[- ]represented|nil|none|n/a", rep_name, re.IGNORECASE):
                is_represented = "Yes"
                representative = rep_name
            elif re.search(r"self[- ]represented|nil|none|n/a", rep_name, re.IGNORECASE):
                is_represented = "No"

    return {
        "applicant_name": applicant_name,
        "respondent": respondent,
        "country_of_origin": country,
        "visa_subclass_number": visa_num,
        "hearing_date": hearing_date,
        "is_represented": is_represented,
        "representative": representative,
        "visa_outcome_reason": visa_outcome_reason,
        "legal_test_applied": legal_test_applied,
    }


# ── Main ─────────────────────────────────────────────────────────────────


def load_csv() -> list[dict]:
    """Load the immigration cases CSV."""
    if not CSV_PATH.exists():
        print(f"Error: {CSV_PATH} not found")
        sys.exit(1)

    with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        return list(reader)


def backup_csv() -> Path | None:
    """Take one timestamped snapshot before a run's first write.

    The old fixed backup filename meant a second run's copy destroyed the
    first run's backup — the only surviving copy of a corpus that is
    gitignored and lives on one machine. A seconds-resolution stamp has the
    same failure in miniature: two runs started in the same second collide.
    Create the file exclusively (O_EXCL) so the name is proven free rather
    than assumed free.
    """
    if not CSV_PATH.exists():
        return None

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    for attempt in range(100):
        suffix = f".{attempt}" if attempt else ""
        backup_path = CSV_PATH.with_name(f"{CSV_PATH.name}.bak-{stamp}{suffix}")
        try:
            fd = os.open(str(backup_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            continue
        os.close(fd)
        shutil.copy2(CSV_PATH, backup_path)
        print(f"Backup saved to {backup_path}")
        return backup_path
    raise RuntimeError(f"could not find a free backup name for {CSV_PATH}")


def _union_fieldnames(rows: list[dict]) -> list[str]:
    """Header covering every key any row carries, in first-seen order.

    Raises if any row carries the csv.DictReader None restkey — see
    _assert_no_overflow_cells for why that is a hard stop rather than a
    dropped column.
    """
    names: list[str] = []
    seen: set = set()
    for row in rows:
        for key in row:
            if key is None:
                raise ValueError(
                    "row carries csv.DictReader's None restkey (overflow "
                    "cells); refusing to build a header that would discard it"
                )
            if key in seen:
                continue
            seen.add(key)
            names.append(key)
    return names


def _assert_no_overflow_cells(rows: list[dict]) -> None:
    """Fail before writing if any row has more cells than the header.

    csv.DictReader parks a long row's overflow cells under the None restkey.
    Dropping that key and writing with extrasaction="ignore" would delete
    those cells and then os.replace() the result over the master CSV — a
    loud, recoverable "this CSV is malformed" turned into silent data loss
    in a file that is gitignored and exists only on this machine. Refuse
    instead, and name the rows so the operator can look at them.
    """
    bad = [
        (index, row.get("case_id") or "?")
        for index, row in enumerate(rows)
        if None in row
    ]
    if not bad:
        return
    preview = ", ".join(f"row {i} (case_id={cid})" for i, cid in bad[:10])
    raise ValueError(
        f"{len(bad)} row(s) in {CSV_PATH} have more cells than the header — "
        f"{preview}{' …' if len(bad) > 10 else ''}. The source CSV is "
        f"malformed; nothing has been written. Fix or quarantine those rows "
        f"before re-running."
    )


def save_csv(rows: list[dict]):
    """Save rows back to CSV with an atomic replace.

    Deliberately does not back up: call backup_csv() once before the first
    save of a run, so periodic checkpoints do not litter the directory with
    one snapshot each.
    """
    if not rows:
        return

    _assert_no_overflow_cells(rows)
    fieldnames = _union_fieldnames(rows)

    # Per-process temp name: other writers of this file (storage.save_cases_csv,
    # download_fulltext.py) use "<path>.tmp" too, and two writers sharing one
    # temp path interleave into it before one of them replaces the master.
    tmp_path = CSV_PATH.with_name(f"{CSV_PATH.name}.tmp.{os.getpid()}")
    with open(tmp_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    os.replace(str(tmp_path), str(CSV_PATH))
    print(f"Saved {len(rows)} rows to {CSV_PATH}")


def _write_failure_manifest(case_ids: list[str]) -> Path | None:
    """List the rows whose extraction raised, so the run can be repeated.

    Without this, a swallowed worker exception exists only as one line on an
    interleaved stderr stream — which is not a record you can act on after a
    12-minute run over 149k rows.
    """
    if not case_ids:
        return None
    path = CSV_PATH.with_name(f"{CSV_PATH.name}.extraction-failures.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(case_ids) + "\n")
    print(f"{len(case_ids)} row(s) failed extraction; ids written to {path}")
    return path


def main():
    parser = argparse.ArgumentParser(description="Extract structured fields from case texts")
    parser.add_argument("--dry-run", action="store_true", help="Preview without saving")
    parser.add_argument("--sample", type=int, default=0, help="Process N random cases")
    parser.add_argument("--court", type=str, default="", help="Filter by court code")
    parser.add_argument("--workers", type=int, default=8, help="Number of parallel workers")
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Re-extract even if field already has a value (useful for fixing garbage values)",
    )
    args = parser.parse_args()

    all_rows = load_csv()
    print(f"Loaded {len(all_rows)} cases from CSV")
    _assert_no_overflow_cells(all_rows)

    # Determine which rows to process vs. save
    rows = all_rows

    # Filter
    if args.court:
        rows = [r for r in rows if (r.get("court_code") or "") == args.court]
        print(f"Filtered to {len(rows)} {args.court} cases")

    # Sample (only affects which rows to process, not what gets saved)
    if args.sample > 0:
        import random
        rows = random.sample(rows, min(args.sample, len(rows)))
        print(f"Sampled {len(rows)} cases")

    # Ensure new columns exist in ALL rows
    new_fields = [
        "applicant_name", "respondent", "country_of_origin",
        "visa_subclass_number", "hearing_date", "is_represented", "representative",
        "visa_outcome_reason", "legal_test_applied",
    ]
    for row in all_rows:
        for field in new_fields:
            if field not in row:
                row[field] = ""
    # Also ensure in the working subset
    for row in rows:
        for field in new_fields:
            if field not in row:
                row[field] = ""

    # Process cases
    stats = Counter()
    total = len(rows)

    print(f"Processing {total} cases with {args.workers} workers...")
    if args.overwrite:
        print("  (--overwrite: will re-extract all fields, including already-filled)")

    if not args.dry_run:
        backup_csv()

    failed_case_ids: list[str] = []

    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        for completed, (row, extracted) in enumerate(
            zip(rows, executor.map(process_case, rows, chunksize=500))
        ):
            error = extracted.pop(EXTRACTION_ERROR_KEY, "")
            if error:
                failed_case_ids.append(row.get("case_id") or "?")
                stats["extraction_failures"] += 1

            for field, value in extracted.items():
                if value:
                    if args.overwrite or not row.get(field):
                        row[field] = value
                        stats[f"{field}_extracted"] += 1
                    else:
                        stats["skipped_existing"] += 1

            if (completed + 1) % CHECKPOINT_EVERY == 0:
                print(f"  Processed {completed + 1}/{total}...")
                if not args.dry_run:
                    # `rows` holds the same dict objects as `all_rows` (the
                    # filter and random.sample both keep references, they do
                    # not copy), so writing all_rows persists everything the
                    # loop has mutated so far.
                    save_csv(all_rows)
                    _write_failure_manifest(failed_case_ids)
                    print(f"  Checkpoint written at {completed + 1}/{total}")

    # Summary
    print(f"\n{'='*60}")
    print("Extraction Summary")
    print(f"{'='*60}")
    print(f"Total processed: {total}")
    print(f"Skipped (existing): {stats.get('skipped_existing', 0)}")
    print(f"Extraction failures: {stats.get('extraction_failures', 0)}")
    print()
    for field in new_fields:
        key = f"{field}_extracted"
        count = stats.get(key, 0)
        pct = (count / total * 100) if total > 0 else 0
        print(f"  {field:25s}: {count:>6,} ({pct:5.1f}%)")

    # Fill rate summary (after extraction)
    print(f"\n{'='*60}")
    print("Fill Rates (processed rows after extraction)")
    print(f"{'='*60}")
    for field in new_fields:
        filled = sum(1 for r in rows if (r.get(field) or "").strip())
        pct = (filled / total * 100) if total > 0 else 0
        print(f"  {field:25s}: {filled:>7,} / {total:,} = {pct:5.1f}%")

    if args.dry_run:
        print("\nDry run — no changes saved.")
        # Show some samples
        print("\nSample extractions:")
        samples = [r for r in rows if r.get("applicant_name")][:5]
        for s in samples:
            print(
                f"  {s.get('citation') or '?':30s} | "
                f"{s.get('applicant_name') or '':20s} | "
                f"{s.get('country_of_origin') or '':20s} | "
                f"SC{s.get('visa_subclass_number') or '':>3s} | "
                f"{s.get('is_represented') or ''}"
            )
    else:
        # Reload full CSV to merge (in case we filtered/sampled)
        if args.court or args.sample:
            all_rows = load_csv()
            # Ensure new columns in all rows
            for row in all_rows:
                for f in new_fields:
                    if f not in row:
                        row[f] = ""
            # Build lookup by case_id
            extracted_map = {r["case_id"]: r for r in rows if r.get("case_id")}
            for row in all_rows:
                cid = row.get("case_id") or ""
                if cid in extracted_map:
                    src = extracted_map[cid]
                    for f in new_fields:
                        if src.get(f) and (args.overwrite or not row.get(f)):
                            row[f] = src[f]
            save_csv(all_rows)
            _write_failure_manifest(failed_case_ids)
        else:
            save_csv(rows)
            _write_failure_manifest(failed_case_ids)


if __name__ == "__main__":
    main()
