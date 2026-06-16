"""Australian Visa Subclass Registry.

Canonical list of Australian visa subclasses with metadata for quick-lookup,
filtering, and search taxonomy features. Maps visa subclass numbers to their
official names and family categories.
"""

from typing import Any

# ── Visa Families (Categories) ────────────────────────────────────────────

VISA_FAMILIES = {
    "Protection": "Refugee and humanitarian protection visas",
    "Skilled": "Skilled migration and employer-sponsored visas",
    "Student": "Student and education visas",
    "Partner": "Partner, spouse, and de facto visas",
    "Parent": "Parent and family reunion visas",
    "Visitor": "Tourist, visitor, and temporary activity visas",
    "Business": "Business innovation and investment visas",
    "Bridging": "Bridging visas (temporary stay while substantive visa processed)",
    "Other": "Other visa categories",
}

# ── Visa Subclass Registry ─────────────────────────────────────────────────
# Format: subclass → (name, family)

VISA_REGISTRY: dict[str, tuple[str, str]] = {
    # Protection visas (XA, XB, XC, XD classes)
    "866": ("Protection", "Protection"),
    "785": ("Temporary Protection", "Protection"),
    "790": ("Safe Haven Enterprise", "Protection"),
    "200": ("Refugee (Permanent)", "Protection"),
    "201": ("In-Country Special Humanitarian (Permanent)", "Protection"),
    "202": ("Global Special Humanitarian (Permanent)", "Protection"),
    "203": ("Emergency Rescue", "Protection"),
    "204": ("Woman at Risk", "Protection"),
    "786": ("Temporary (Humanitarian Concern)", "Protection"),
    "449": ("Humanitarian Stay (Temporary)", "Protection"),

    # Skilled visas
    "189": ("Skilled Independent", "Skilled"),
    "190": ("Skilled Nominated", "Skilled"),
    "191": ("Permanent Residence (Skilled Regional)", "Skilled"),
    "186": ("Employer Nomination Scheme", "Skilled"),
    "187": ("Regional Sponsored Migration Scheme", "Skilled"),
    "457": ("Temporary Work (Skilled)", "Skilled"),
    "482": ("Temporary Skill Shortage", "Skilled"),
    "494": ("Skilled Employer Sponsored Regional (Provisional)", "Skilled"),
    "491": ("Skilled Work Regional (Provisional)", "Skilled"),
    "476": ("Skilled - Recognised Graduate", "Skilled"),
    "485": ("Temporary Graduate", "Skilled"),
    "489": ("Skilled Regional (Provisional)", "Skilled"),
    "407": ("Training", "Skilled"),

    # Student visas
    "500": ("Student", "Student"),
    "590": ("Student Guardian", "Student"),
    "570": ("Independent ELICOS Sector", "Student"),
    "571": ("Schools Sector", "Student"),
    "572": ("Vocational Education and Training Sector", "Student"),
    "573": ("Higher Education Sector", "Student"),
    "574": ("Postgraduate Research Sector", "Student"),
    "575": ("Non-award Sector", "Student"),
    "576": ("AusAID or Defence Sector", "Student"),

    # Partner visas
    "309": ("Partner (Provisional)", "Partner"),
    "820": ("Partner (Temporary)", "Partner"),
    "801": ("Partner (Permanent)", "Partner"),
    "100": ("Partner (Migrant)", "Partner"),
    "300": ("Prospective Marriage", "Partner"),
    "461": ("New Zealand Citizen Family Relationship (Temporary)", "Partner"),

    # Parent visas
    "103": ("Parent", "Parent"),
    "143": ("Contributory Parent", "Parent"),
    "173": ("Contributory Parent (Temporary)", "Parent"),
    "804": ("Aged Parent", "Parent"),
    "884": ("Contributory Aged Parent (Temporary)", "Parent"),
    "864": ("Contributory Aged Parent", "Parent"),

    # Visitor visas
    "600": ("Visitor", "Visitor"),
    "601": ("Electronic Travel Authority", "Visitor"),
    "651": ("eVisitor", "Visitor"),
    "400": ("Temporary Work (Short Stay Activity)", "Visitor"),
    "417": ("Working Holiday", "Visitor"),
    "462": ("Work and Holiday", "Visitor"),
    "408": ("Temporary Activity", "Visitor"),

    # Business visas
    "188": ("Business Innovation and Investment (Provisional)", "Business"),
    "888": ("Business Innovation and Investment (Permanent)", "Business"),
    "132": ("Business Talent (Permanent)", "Business"),
    "891": ("Investor", "Business"),
    "892": ("State/Territory Sponsored Business Owner", "Business"),
    "893": ("State/Territory Sponsored Senior Executive", "Business"),

    # Bridging visas
    "010": ("Bridging A", "Bridging"),
    "020": ("Bridging B", "Bridging"),
    "030": ("Bridging C", "Bridging"),
    "040": ("Bridging D", "Bridging"),
    "050": ("Bridging (General)", "Bridging"),
    "051": ("Bridging (Protection Visa Applicant)", "Bridging"),
    "060": ("Bridging E", "Bridging"),
    "070": ("Bridging (Removal Pending)", "Bridging"),
    "080": ("Bridging (Crew)", "Bridging"),

    # Child visas
    "101": ("Child", "Other"),
    "102": ("Adoption", "Other"),
    "802": ("Child", "Other"),
    "445": ("Dependent Child", "Other"),

    # Other common visas
    "155": ("Resident Return", "Other"),
    "157": ("Resident Return (5 years)", "Other"),
    "444": ("Special Category (New Zealand citizen)", "Other"),
    "116": ("Carer", "Other"),
    "117": ("Orphan Relative", "Other"),
    "114": ("Aged Dependent Relative", "Other"),
    "115": ("Remaining Relative", "Other"),
    "836": ("Carer", "Other"),
    "856": ("Employer Nomination Scheme (ENS)", "Other"),
    "858": ("Distinguished Talent", "Other"),
}

# ── Functions ──────────────────────────────────────────────────────────────


def clean_subclass(raw: Any) -> str:
    """Clean and normalize a visa subclass number.

    Handles None, NaN, float strings (e.g., "866.0"), whitespace, and invalid values.
    Returns a 1-4 digit string if valid, empty string otherwise.

    Args:
        raw: Raw value from database/CSV (may be None, float, str, etc.)

    Returns:
        Cleaned 1-4 digit subclass number, or empty string if invalid.

    Examples:
        >>> clean_subclass("866")
        '866'
        >>> clean_subclass("866.0")
        '866'
        >>> clean_subclass(866.0)
        '866'
        >>> clean_subclass(None)
        ''
        >>> clean_subclass("nan")
        ''
    """
    if raw is None:
        return ""

    # Convert to string and handle pandas NaN
    val = str(raw).strip()
    if not val or val.lower() in ("", "nan", "none", "null"):
        return ""

    # Strip .0 suffix from float strings
    if val.endswith(".0"):
        val = val[:-2]

    # Validate format: 1-4 digits only
    if val.isdigit() and 1 <= len(val) <= 4:
        return val

    return ""


def get_family(subclass: str) -> str:
    """Get the visa family/category for a given subclass number.

    Args:
        subclass: Visa subclass number (e.g., "866", "500")

    Returns:
        Visa family name (e.g., "Protection", "Student") or "Other" if unknown.

    Examples:
        >>> get_family("866")
        'Protection'
        >>> get_family("500")
        'Student'
        >>> get_family("999")
        'Other'
    """
    cleaned = clean_subclass(subclass)
    if not cleaned:
        return "Other"

    entry = VISA_REGISTRY.get(cleaned)
    if entry:
        return entry[1]  # Return family (second element of tuple)

    return "Other"


def group_by_family(by_visa_raw: dict[str, int]) -> dict[str, int]:
    """Aggregate visa subclass counts into family counts.

    Takes a dictionary of {subclass: count} and returns {family: total_count}.

    Args:
        by_visa_raw: Dictionary mapping visa subclass to case count.
                     Keys may be unclean (e.g., "866.0", None, "nan").

    Returns:
        Dictionary mapping visa family to total case count.

    Examples:
        >>> group_by_family({"866": 100, "785": 50, "500": 200})
        {'Protection': 150, 'Student': 200}
    """
    family_counts: dict[str, int] = {}

    for subclass, count in by_visa_raw.items():
        cleaned = clean_subclass(subclass)
        if not cleaned:
            continue

        family = get_family(cleaned)
        family_counts[family] = family_counts.get(family, 0) + count

    return family_counts


def get_registry_for_api() -> dict[str, Any]:
    """Return the full visa registry in API-friendly format.

    Returns a dictionary with:
    - entries: List of all visa subclasses with metadata
    - families: Dictionary of family names to descriptions

    Used by /api/v1/visa-registry endpoint for frontend caching.

    Returns:
        Dictionary with 'entries' (list of visa dicts) and 'families' (family metadata).

    Example output:
        {
            "entries": [
                {"subclass": "866", "name": "Protection", "family": "Protection"},
                {"subclass": "500", "name": "Student", "family": "Student"},
                ...
            ],
            "families": {
                "Protection": "Refugee and humanitarian protection visas",
                "Student": "Student and education visas",
                ...
            }
        }
    """
    entries = []

    # Convert registry to list of entries, sorted by subclass number
    for subclass in sorted(VISA_REGISTRY.keys(), key=lambda x: x.zfill(4)):
        name, family = VISA_REGISTRY[subclass]
        entries.append({
            "subclass": subclass,
            "name": name,
            "family": family,
        })

    return {
        "entries": entries,
        "families": VISA_FAMILIES,
    }
