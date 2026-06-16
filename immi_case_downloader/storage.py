"""Storage and export utilities for immigration cases."""

import json
import os
import logging
import time
import threading
from pathlib import Path

import pandas as pd

from .config import OUTPUT_DIR, CASES_CSV, CASES_JSON, TEXT_CASES_DIR
from .models import ImmigrationCase

logger = logging.getLogger(__name__)

CASE_FIELDS = [
    "case_id",
    "citation",
    "title",
    "court",
    "court_code",
    "date",
    "year",
    "url",
    "judges",
    "catchwords",
    "outcome",
    "visa_type",
    "legislation",
    "text_snippet",
    "full_text_path",
    "source",
    "user_notes",
    "tags",
    "visa_subclass",
    "visa_class_code",
    "case_nature",
    "legal_concepts",
    "applicant_name",
    "respondent",
    "country_of_origin",
    "visa_subclass_number",
    "hearing_date",
    "is_represented",
    "representative",
    "visa_outcome_reason",
    "legal_test_applied",
]


def ensure_output_dirs(base_dir: str = OUTPUT_DIR):
    """Create output directory structure."""
    Path(base_dir).mkdir(parents=True, exist_ok=True)
    Path(base_dir, TEXT_CASES_DIR).mkdir(parents=True, exist_ok=True)
    return base_dir


def save_cases_csv(cases: list[ImmigrationCase], base_dir: str = OUTPUT_DIR):
    """Save cases to a CSV file using atomic write (write-tmp-then-rename)."""
    filepath = os.path.join(base_dir, CASES_CSV)
    tmp_path = filepath + ".tmp"
    rows = [case.to_dict() for case in cases]

    df = pd.DataFrame(rows, columns=CASE_FIELDS)
    df.to_csv(tmp_path, index=False, encoding="utf-8-sig")
    os.replace(tmp_path, filepath)

    invalidate_cases_cache()
    logger.info(f"Saved {len(cases)} cases to {filepath}")
    return filepath


def save_cases_json(cases: list[ImmigrationCase], base_dir: str = OUTPUT_DIR):
    """Save cases to a JSON file using atomic write (write-tmp-then-rename)."""
    filepath = os.path.join(base_dir, CASES_JSON)
    tmp_path = filepath + ".tmp"
    data = {
        "total_cases": len(cases),
        "courts": list({c.court for c in cases if c.court}),
        "year_range": {
            "min": min((c.year for c in cases if c.year), default=0),
            "max": max((c.year for c in cases if c.year), default=0),
        },
        "cases": [case.to_dict() for case in cases],
    }

    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp_path, filepath)

    logger.info(f"Saved {len(cases)} cases to {filepath}")
    return filepath


def save_case_text(
    case: ImmigrationCase, text: str, base_dir: str = OUTPUT_DIR
) -> str:
    """Save full case text to a file.

    Returns:
        Path to the saved text file.
    """
    text_dir = os.path.join(base_dir, TEXT_CASES_DIR)
    Path(text_dir).mkdir(parents=True, exist_ok=True)

    # Create filename from citation or case ID
    filename = case.citation or case.case_id or case.title
    # Sanitize filename
    filename = "".join(c if c.isalnum() or c in " -_[]" else "_" for c in filename)
    filename = filename.strip()[:100]
    if not filename:
        filename = f"case_{hash(case.url) % 100000}"
    filename = f"{filename}.txt"

    filepath = os.path.join(text_dir, filename)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(f"Title: {case.title}\n")
        f.write(f"Citation: {case.citation}\n")
        f.write(f"Court: {case.court}\n")
        f.write(f"Date: {case.date}\n")
        f.write(f"URL: {case.url}\n")
        f.write(f"{'='*80}\n\n")
        f.write(text)

    case.full_text_path = filepath
    return filepath


def load_cases_csv(base_dir: str = OUTPUT_DIR) -> list[dict]:
    """Load previously downloaded cases from CSV."""
    filepath = os.path.join(base_dir, CASES_CSV)
    if not os.path.exists(filepath):
        return []

    df = pd.read_csv(filepath, encoding="utf-8-sig", dtype={"visa_subclass": str})
    return df.to_dict("records")


def generate_summary_report(cases: list[ImmigrationCase], base_dir: str = OUTPUT_DIR):
    """Generate a summary report of downloaded cases."""
    filepath = os.path.join(base_dir, "summary_report.txt")

    # Group by court
    by_court = {}
    for case in cases:
        court = case.court or "Unknown"
        by_court.setdefault(court, []).append(case)

    # Group by year
    by_year = {}
    for case in cases:
        year = case.year or 0
        by_year.setdefault(year, []).append(case)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write("IMMIGRATION CASE DOWNLOAD SUMMARY REPORT\n")
        f.write("=" * 60 + "\n\n")
        f.write(f"Total Cases: {len(cases)}\n\n")

        f.write("Cases by Court/Tribunal:\n")
        f.write("-" * 40 + "\n")
        for court, court_cases in sorted(by_court.items()):
            f.write(f"  {court}: {len(court_cases)}\n")

        f.write("\nCases by Year:\n")
        f.write("-" * 40 + "\n")
        for year, year_cases in sorted(by_year.items()):
            if year:
                f.write(f"  {year}: {len(year_cases)}\n")

        # Visa types mentioned
        visa_types = {c.visa_type for c in cases if c.visa_type}
        if visa_types:
            f.write("\nVisa Types Found:\n")
            f.write("-" * 40 + "\n")
            for vt in sorted(visa_types):
                f.write(f"  - {vt}\n")

    logger.info(f"Summary report saved to {filepath}")
    return filepath


# ---------------------------------------------------------------------------
# CRUD helpers for the web interface
# ---------------------------------------------------------------------------

# ── Simple TTL cache for load_all_cases ─────────────────────────────────────

_cases_cache: dict = {"cases": None, "base_dir": None, "ts": 0.0}
_cases_cache_lock = threading.Lock()
_CACHE_TTL = 60.0  # seconds — matched to API-level cache


def invalidate_cases_cache():
    """Explicitly clear the cases cache (call after writes)."""
    with _cases_cache_lock:
        _cases_cache["cases"] = None
        _cases_cache["ts"] = 0.0


def load_all_cases(base_dir: str = OUTPUT_DIR) -> list[ImmigrationCase]:
    """Load all cases from CSV as ImmigrationCase objects.

    Results are cached for up to _CACHE_TTL seconds. The cache is also
    automatically invalidated when save_cases_csv() is called.
    """
    now = time.monotonic()
    with _cases_cache_lock:
        if (
            _cases_cache["cases"] is not None
            and _cases_cache["base_dir"] == base_dir
            and (now - _cases_cache["ts"]) < _CACHE_TTL
        ):
            return list(_cases_cache["cases"])  # return a copy

    records = load_cases_csv(base_dir)
    cases = []
    for r in records:
        case = ImmigrationCase.from_dict(r)
        case.ensure_id()
        cases.append(case)

    with _cases_cache_lock:
        _cases_cache["cases"] = cases
        _cases_cache["base_dir"] = base_dir
        _cases_cache["ts"] = now

    return list(cases)  # return a copy


def get_case_by_id(case_id: str, base_dir: str = OUTPUT_DIR) -> ImmigrationCase | None:
    """Find a single case by its case_id."""
    for case in load_all_cases(base_dir):
        if case.case_id == case_id:
            return case
    return None


# Fields that can be updated via the web interface.
# Sensitive fields (case_id, full_text_path, source) are excluded to prevent mass assignment.
ALLOWED_UPDATE_FIELDS = frozenset({
    "citation", "title", "court", "court_code", "date", "year", "url",
    "judges", "catchwords", "outcome", "visa_type", "legislation",
    "text_snippet", "user_notes", "tags", "case_nature", "legal_concepts",
})


def update_case(case_id: str, updates: dict, base_dir: str = OUTPUT_DIR) -> bool:
    """Update fields of an existing case and persist.

    Only fields in ALLOWED_UPDATE_FIELDS can be modified (CWE-915 prevention).
    """
    cases = load_all_cases(base_dir)
    for case in cases:
        if case.case_id == case_id:
            for key, value in updates.items():
                if key in ALLOWED_UPDATE_FIELDS and hasattr(case, key):
                    setattr(case, key, value)
            save_cases_csv(cases, base_dir)
            save_cases_json(cases, base_dir)
            return True
    return False


def delete_case(case_id: str, base_dir: str = OUTPUT_DIR) -> bool:
    """Delete a case by its case_id."""
    cases = load_all_cases(base_dir)
    original_len = len(cases)
    cases = [c for c in cases if c.case_id != case_id]
    if len(cases) < original_len:
        save_cases_csv(cases, base_dir)
        save_cases_json(cases, base_dir)
        return True
    return False


def add_case_manual(case_data: dict, base_dir: str = OUTPUT_DIR) -> ImmigrationCase:
    """Add a manually entered case."""
    case = ImmigrationCase.from_dict(case_data)
    case.source = case.source or "Manual Entry"
    case.ensure_id()

    cases = load_all_cases(base_dir)
    cases.append(case)
    ensure_output_dirs(base_dir)
    save_cases_csv(cases, base_dir)
    save_cases_json(cases, base_dir)
    return case


def get_case_full_text(case: ImmigrationCase, base_dir: str = OUTPUT_DIR) -> str | None:
    """Read the full text file for a case.

    Validates that the resolved path is within the output directory
    to prevent path traversal attacks (CWE-22).
    """
    if not case.full_text_path:
        return None

    # Anchor relative paths to the project root (not CWD) so the function
    # works regardless of where the server process was started from.
    _project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    path = case.full_text_path
    if not os.path.isabs(path):
        path = os.path.join(_project_root, path)

    abs_base = base_dir
    if not os.path.isabs(abs_base):
        abs_base = os.path.join(_project_root, abs_base)

    resolved = os.path.realpath(path)
    allowed_dir = os.path.realpath(abs_base)
    if not resolved.startswith(allowed_dir + os.sep) and resolved != allowed_dir:
        logger.warning("Path traversal attempt blocked: %s", case.full_text_path)
        return None

    if not os.path.exists(resolved):
        return None
    with open(resolved, "r", encoding="utf-8") as f:
        return f.read()


def get_statistics(base_dir: str = OUTPUT_DIR) -> dict:
    """Compute dashboard statistics."""
    cases = load_all_cases(base_dir)
    by_court: dict[str, int] = {}
    by_year: dict[int, int] = {}
    by_nature: dict[str, int] = {}
    by_visa_subclass: dict[str, int] = {}
    by_source: dict[str, int] = {}
    visa_types: set[str] = set()
    with_text = 0

    for c in cases:
        by_court[c.court_code or "Unknown"] = by_court.get(c.court_code or "Unknown", 0) + 1
        if c.year:
            by_year[c.year] = by_year.get(c.year, 0) + 1
        if c.visa_type:
            visa_types.add(c.visa_type)
        if c.case_nature:
            by_nature[c.case_nature] = by_nature.get(c.case_nature, 0) + 1
        if c.visa_subclass:
            by_visa_subclass[c.visa_subclass] = by_visa_subclass.get(c.visa_subclass, 0) + 1
        src = c.source or "Unknown"
        by_source[src] = by_source.get(src, 0) + 1
        if c.full_text_path:
            with_text += 1

    # Sort visa subclasses by count descending, top 20
    sorted_subclasses = dict(sorted(by_visa_subclass.items(), key=lambda x: x[1], reverse=True)[:20])

    return {
        "total": len(cases),
        "by_court": dict(sorted(by_court.items())),
        "by_year": dict(sorted(by_year.items())),
        "by_nature": dict(sorted(by_nature.items(), key=lambda x: x[1], reverse=True)),
        "by_visa_subclass": sorted_subclasses,
        "by_source": dict(sorted(by_source.items(), key=lambda x: x[1], reverse=True)),
        "visa_types": sorted(visa_types),
        "with_full_text": with_text,
        "sources": sorted({c.source for c in cases if c.source}),
    }
