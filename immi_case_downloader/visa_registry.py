"""Australian Visa Subclass Registry.

Canonical list of Australian visa subclasses with metadata for quick-lookup,
filtering, and search taxonomy features. Maps visa subclass numbers to their
official names and family categories.

The table itself lives in ``immi_case_downloader/data/visa_registry.json``,
which is the single source of truth shared with the Cloudflare Worker. The
Worker's copy, ``workers/case-api/visa_registry.generated.js``, is generated
from that same JSON by ``scripts/generate_visa_registry.py``. Edit the JSON,
then regenerate — never hand-edit either derived copy.
"""

import json
import os
from typing import Any

# ── Data source ───────────────────────────────────────────────────────────


def _data_path() -> str:
    pkg_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(pkg_dir, "data", "visa_registry.json")


def _load_document() -> dict[str, Any]:
    with open(_data_path(), encoding="utf-8") as handle:
        return json.load(handle)


_DOCUMENT = _load_document()

# ── Visa Families (Categories) ────────────────────────────────────────────

VISA_FAMILIES: dict[str, str] = dict(_DOCUMENT["families"])

# ── Visa Subclass Registry ─────────────────────────────────────────────────
# Format: subclass → (name, family)

VISA_REGISTRY: dict[str, tuple[str, str]] = {
    entry["subclass"]: (entry["name"], entry["family"])
    for entry in _DOCUMENT["entries"]
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
