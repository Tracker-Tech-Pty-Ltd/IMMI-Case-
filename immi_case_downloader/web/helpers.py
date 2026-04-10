"""Shared helper functions and constants for the web interface."""

from flask import current_app, jsonify

from ..config import OUTPUT_DIR
from ..repository import CaseRepository


# ── Constants ────────────────────────────────────────────────────────────

ITEMS_PER_PAGE = 100

EDITABLE_FIELDS = [
    "citation", "title", "court", "court_code", "date", "year", "url", "source",
    "judges", "catchwords", "outcome", "visa_type", "legislation",
    "user_notes", "tags", "case_nature", "legal_concepts",
    "visa_subclass", "visa_class_code",
    "applicant_name", "respondent", "country_of_origin",
    "visa_subclass_number", "hearing_date", "is_represented", "representative",
]


# ── API response helpers ─────────────────────────────────────────────────


def error_response(msg: str, status: int = 400):
    """Return a unified error JSON response for all API endpoints.

    All error responses share the same envelope:
      {"success": False, "error": "<message>"}
    """
    return jsonify({"success": False, "error": msg}), status


# ── Input validation helpers ─────────────────────────────────────────────


def safe_int(value, default: int = 0, min_val: int | None = None, max_val: int | None = None) -> int:
    """Safely convert value to int with bounds clamping."""
    try:
        result = int(value)
    except (TypeError, ValueError):
        result = default
    if min_val is not None:
        result = max(result, min_val)
    if max_val is not None:
        result = min(result, max_val)
    return result


def safe_float(value, default: float = 0.0, min_val: float | None = None, max_val: float | None = None) -> float:
    """Safely convert value to float with bounds clamping."""
    try:
        result = float(value)
    except (TypeError, ValueError):
        result = default
    if min_val is not None:
        result = max(result, min_val)
    if max_val is not None:
        result = min(result, max_val)
    return result


# ── Output directory ─────────────────────────────────────────────────────


def get_output_dir() -> str:
    """Return the configured output directory from the current app."""
    return current_app.config.get("OUTPUT_DIR", OUTPUT_DIR)


def get_repo():
    """Return the active CaseRepository from the current app."""
    return current_app.config["REPO"]


# ── Case filtering ───────────────────────────────────────────────────────


def _filter_cases(cases: list, args) -> list:
    """Apply standard query-param filters to a case list. Returns filtered copy."""
    court_filter = args.get("court", "")
    year_filter = args.get("year", "")
    visa_filter = args.get("visa_type", "")
    keyword = args.get("q", "")
    source_filter = args.get("source", "")
    tag_filter = args.get("tag", "")
    nature_filter = args.get("nature", "")

    if court_filter:
        cases = [c for c in cases if c.court_code == court_filter]
    if year_filter:
        try:
            cases = [c for c in cases if c.year == int(year_filter)]
        except ValueError:
            pass
    if visa_filter:
        cases = [c for c in cases if visa_filter.lower() in c.visa_type.lower()]
    if source_filter:
        cases = [c for c in cases if c.source == source_filter]
    if tag_filter:
        cases = [c for c in cases if tag_filter.lower() in c.tags.lower()]
    if nature_filter:
        cases = [c for c in cases if c.case_nature == nature_filter]
    if keyword:
        kw = keyword.lower()
        cases = [
            c for c in cases
            if kw in c.title.lower()
            or kw in c.citation.lower()
            or kw in c.catchwords.lower()
            or kw in c.judges.lower()
            or kw in c.outcome.lower()
            or kw in c.user_notes.lower()
            or kw in c.case_nature.lower()
            or kw in c.legal_concepts.lower()
        ]
    return cases
