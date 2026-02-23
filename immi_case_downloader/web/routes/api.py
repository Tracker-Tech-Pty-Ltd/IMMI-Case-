"""JSON API endpoints for the React SPA frontend.

All endpoints are prefixed with /api/v1/.
Reuses existing CaseRepository methods — no new backend logic.
"""

import io
import os
import csv
import re
import json
import logging
import time
import threading
from itertools import combinations
from collections import Counter, defaultdict
from datetime import datetime

import numpy as np
from flask import Blueprint, request, jsonify, send_file
from flask_wtf.csrf import generate_csrf

from ...config import START_YEAR, END_YEAR
from ...models import ImmigrationCase
from ...semantic_search_eval import (
    GeminiEmbeddingClient,
    OpenAIEmbeddingClient,
    reciprocal_rank_fusion,
)
from ...storage import CASE_FIELDS
from ...visa_registry import (
    clean_subclass,
    get_family,
    get_registry_for_api,
    group_by_family,
    VISA_REGISTRY,
)
from ..helpers import get_repo, get_output_dir, safe_int, _filter_cases, EDITABLE_FIELDS
from ..jobs import _job_lock, _job_status, _run_download_job
logger = logging.getLogger(__name__)

api_bp = Blueprint("api", __name__, url_prefix="/api/v1")

_HEX_ID = re.compile(r"^[0-9a-f]{12}$")

# ── API configuration constants ───────────────────────────────────────
MAX_BATCH_SIZE = 200
MAX_TAG_LENGTH = 50
MAX_COMPARE_CASES = 5
DEFAULT_PAGE_SIZE = 100
MAX_PAGE_SIZE = 200
DEFAULT_SEARCH_LIMIT = 50
MAX_SEARCH_LIMIT = 200
DEFAULT_SEARCH_MODE = "lexical"
ALLOWED_SEARCH_MODES = frozenset({"lexical", "semantic", "hybrid"})
ALLOWED_SEARCH_PROVIDERS = frozenset({"openai", "gemini"})
DEFAULT_SEMANTIC_CANDIDATE_LIMIT = 150
MAX_SEMANTIC_CANDIDATE_LIMIT = 500
DEFAULT_RELATED_LIMIT = 5
MAX_RELATED_LIMIT = 20

# ── Outcome normalisation ──────────────────────────────────────────────

_OUTCOME_MAP = {
    # Multi-word patterns FIRST — must precede single stems to avoid false matches
    # e.g. "no jurisdiction" contains "grant" (no), but ordering still matters for
    # any future compound values that might share a stem with a shorter key.
    "no jurisdiction": "No Jurisdiction",
    "set aside":       "Set Aside",
    # Single-word stems
    "affirm":          "Affirmed",
    "dismiss":         "Dismissed",
    "remit":           "Remitted",
    "allow":           "Allowed",
    "grant":           "Granted",
    "quash":           "Quashed",
    "refus":           "Refused",
    "cancel":          "Cancelled",
    "withdrawn":       "Withdrawn",
    "discontinu":      "Withdrawn",
    "varied":          "Varied",
}

TRIBUNAL_CODES = {"AATA", "ARTA", "MRTA", "RRTA"}
COURT_CODES = {"FCA", "FCCA", "FMCA", "FedCFamC2G", "HCA"}
_TRIBUNAL_WIN_OUTCOMES = ("Remitted", "Set Aside", "Granted", "Quashed")
_COURT_WIN_OUTCOMES = ("Allowed", "Set Aside", "Granted", "Quashed")
_MIXED_WIN_OUTCOMES = ("Allowed", "Remitted", "Set Aside", "Granted", "Quashed")
_JUDGE_BLOCKLIST = frozenset(
    {
        # Common noise words from HTML/text parsing artefacts
        "date", "the", "and", "or", "of", "in", "for", "at", "by",
        # Legal roles/titles (single-word entries that aren't names)
        "court", "tribunal", "member", "judge", "justice", "honour",
        "federal", "migration", "review", "applicant", "respondent",
        "minister", "decision", "department", "government", "australia",
        "registry", "registrar", "president", "deputy", "senior",
        "appellant", "appeal", "application", "matter",
    }
)

# Leading title prefixes to strip (applied repeatedly until no match)
_JUDGE_TITLE_RE = re.compile(
    r"^(?:The\s+Hon(?:ourable)?\.?\s+|Hon(?:ourable)?\.?\s+|"
    r"Chief\s+Justice\s+|Justice\s+|Senior\s+Member\s+|"
    r"Deputy\s+President\s+|Deputy\s+Member\s+|Deputy\s+|"
    r"Principal\s+Member\s+|Member\s+|Magistrate\s+|"
    r"President\s+|Registrar\s+|"
    r"Mr\.?\s+|Mrs\.?\s+|Ms\.?\s+|Miss\s+|Dr\.?\s+|Prof\.?\s+)",
    re.IGNORECASE,
)

# Trailing legal abbreviations (e.g. "Smith J", "Brown CJ", "White FM")
_JUDGE_SUFFIX_RE = re.compile(
    r"\s+(?:J|CJ|ACJ|FM|AM|DCJ|JA|RFM|SM|DP|P)\b\.?$",
    re.IGNORECASE,
)

# Words that disqualify an entry as a real person's name
_NAME_DISQUALIFIERS = frozenset({
    "the", "of", "in", "for", "at", "on", "by", "to", "with", "and", "or",
    "tribunal", "court", "department", "minister", "registry", "review",
    "applicant", "respondent", "appellant", "migration", "australia",
})


def _is_real_judge_name(name: str) -> bool:
    """Return True only if name looks like an actual person's name."""
    words = name.split()
    if not words or len(words) > 4:
        return False
    # All words must not be disqualifiers
    if all(w.lower() in _NAME_DISQUALIFIERS for w in words):
        return False
    # Must contain at least one word that starts with a capital letter
    if not any(w[0].isupper() for w in words if w):
        return False
    return True


def _normalise_judge_name(raw: str) -> str:
    """Strip titles/suffixes and title-case; return clean display name."""
    name = raw.strip()
    # Strip leading titles (loop: "The Honourable Justice" needs 3 passes)
    for _ in range(4):
        m = _JUDGE_TITLE_RE.match(name)
        if m:
            name = name[m.end():].strip()
        else:
            break
    # Strip trailing legal abbreviations (J, CJ, FM, etc.)
    m = _JUDGE_SUFFIX_RE.search(name)
    if m:
        name = name[:m.start()].strip()
    # Normalise whitespace
    name = re.sub(r"\s+", " ", name).strip()
    if not name:
        return ""
    # Title-case with Mac/Mc/O' special handling
    name = name.title()
    name = re.sub(r"\bMac([a-z])", lambda x: "Mac" + x.group(1).upper(), name)
    name = re.sub(r"\bMc([a-z])", lambda x: "Mc" + x.group(1).upper(), name)
    name = re.sub(r"\bO'([a-z])", lambda x: "O'" + x.group(1).upper(), name)
    return name


def _normalise_outcome(raw: str) -> str:
    """Map raw outcome text to one of 8 standard categories."""
    if not raw:
        return "Other"
    low = raw.lower().strip()
    for keyword, label in _OUTCOME_MAP.items():
        if keyword in low:
            return label
    return "Other"


# ── Legal concept normalisation ────────────────────────────────────────────
# Maps raw LLM-extracted strings to 30 canonical LEGAL concepts.
# Deliberately excludes visa type names (Protection Visa, Student Visa, etc.)
# because users already filter by visa subclass. Only legal principles,
# tests, doctrines, and procedural rules are included here.
# Strings not in this dict are silently dropped as noise.
_CONCEPT_CANONICAL: dict[str, str] = {
    # ── Refugee law — substantive ─────────────────────────────────────────
    "refugee status": "Refugee Status",
    "refugee": "Refugee Status",
    "refugees": "Refugee Status",
    "asylum": "Refugee Status",
    "asylee": "Refugee Status",
    # Protection Obligations = the legal duty under s.36; distinct from the
    # visa subclass (866) which belongs to the visa subclass filter instead.
    "protection obligations": "Protection Obligations",
    "s.36": "Protection Obligations",
    "s.36 protection criteria": "Protection Obligations",
    "complementary protection": "Complementary Protection",
    "well-founded fear": "Well-Founded Fear",
    "well-founded fear of persecution": "Well-Founded Fear",
    "well founded fear of persecution": "Well-Founded Fear",
    "well founded fear": "Well-Founded Fear",
    "refugee convention": "Refugee Convention",
    "refugees convention": "Refugee Convention",
    "convention obligations": "Refugee Convention",
    "un convention": "Refugee Convention",
    "1951 convention": "Refugee Convention",
    "persecution": "Persecution",
    "serious harm": "Persecution",
    "significant harm": "Persecution",
    "particular social group": "Particular Social Group",
    "psg": "Particular Social Group",
    "social group": "Particular Social Group",
    "political opinion": "Political Opinion",
    "imputed political opinion": "Political Opinion",
    "political beliefs": "Political Opinion",
    "country information": "Country Information",
    "country evidence": "Country Information",
    "country conditions": "Country Information",
    "independent country information": "Country Information",
    # ── Visa eligibility legal tests ──────────────────────────────────────
    # These are substantive legal tests adjudicated by tribunals — distinct
    # from the visa type itself which belongs in the visa subclass filter.
    "genuine relationship": "Genuine Relationship",
    "de facto relationship": "Genuine Relationship",
    "family relationship": "Genuine Relationship",
    "genuine temporary entrant": "Genuine Temporary Entrant",
    "genuine student": "Genuine Temporary Entrant",
    "genuine visit": "Genuine Temporary Entrant",
    "genuine intention": "Genuine Temporary Entrant",
    # ── Judicial review / procedural ─────────────────────────────────────
    "jurisdictional error": "Jurisdictional Error",
    "error of law": "Jurisdictional Error",
    "legal error": "Jurisdictional Error",
    "jurisdictional limits": "Jurisdictional Error",
    "judicial review": "Judicial Review",
    "judicial review principles": "Judicial Review",
    "judicial review application": "Judicial Review",
    "review": "Judicial Review",
    "merits review": "Judicial Review",
    "visa review": "Judicial Review",
    "procedural fairness": "Procedural Fairness",
    "natural justice": "Procedural Fairness",
    "bias": "Procedural Fairness",
    "apprehended bias": "Procedural Fairness",
    "hearing rule": "Procedural Fairness",
    "unreasonableness": "Unreasonableness",
    "wednesbury unreasonableness": "Unreasonableness",
    "irrationality": "Unreasonableness",
    "manifest unreasonableness": "Unreasonableness",
    "jurisdiction": "Jurisdiction",
    "privative clause": "Jurisdiction",
    "standing": "Jurisdiction",
    "tribunal jurisdiction": "Jurisdiction",
    "time limitation": "Time Limitation",
    "time limits": "Time Limitation",
    "limitation period": "Time Limitation",
    "time bar": "Time Limitation",
    "timeliness": "Time Limitation",
    "tribunal procedure": "Tribunal Procedure",
    "hearing": "Tribunal Procedure",
    "s.359a": "Tribunal Procedure",
    "s.424a": "Tribunal Procedure",
    "inquisitorial process": "Tribunal Procedure",
    # ── Character / Criminal ──────────────────────────────────────────────
    "character test": "Character Test",
    "s.501 character test": "Character Test",
    "character test (s.501)": "Character Test",
    "character test s.501": "Character Test",
    "criminal history": "Character Test",
    "substantial criminal record": "Character Test",
    # ── Visa decision types ───────────────────────────────────────────────
    "visa cancellation": "Visa Cancellation",
    "cancellation": "Visa Cancellation",
    "s.116": "Visa Cancellation",
    "s.109": "Visa Cancellation",
    "cancellation of visa": "Visa Cancellation",
    "mandatory cancellation": "Visa Cancellation",
    "visa refusal": "Visa Refusal",
    "refusal of visa": "Visa Refusal",
    "refusal": "Visa Refusal",
    "visa rejection": "Visa Refusal",
    "ministerial intervention": "Ministerial Intervention",
    "ministerial discretion": "Ministerial Intervention",
    "s.351": "Ministerial Intervention",
    "s.417": "Ministerial Intervention",
    # ── Evidence & fact-finding ───────────────────────────────────────────
    "credibility": "Credibility Assessment",
    "credibility assessment": "Credibility Assessment",
    "adverse credibility": "Credibility Assessment",
    "witness credibility": "Credibility Assessment",
    "truthfulness": "Credibility Assessment",
    "evidence": "Evidence",
    "corroboration": "Evidence",
    "medical evidence": "Evidence",
    "expert evidence": "Evidence",
    "evidentiary matters": "Evidence",
    # ── Procedural / administrative ───────────────────────────────────────
    "costs": "Costs",
    "legal costs": "Costs",
    "cost order": "Costs",
    "legal representation": "Legal Representation",
    "right to be heard": "Legal Representation",
    "unrepresented applicant": "Legal Representation",
    "appeal": "Appeal",
    "appellate jurisdiction": "Appeal",
    "remittal": "Appeal",
    "fraud": "Fraud",
    "misrepresentation": "Fraud",
    "bogus document": "Fraud",
    # ── Legislation / statutory framework ────────────────────────────────
    "migration act": "Migration Act",
    "migration law": "Migration Act",
    "migration regulations": "Migration Act",
    "health criteria": "Health Criteria",
    "health requirement": "Health Criteria",
    "medical criteria": "Health Criteria",
}


def _normalise_concept(raw: str) -> str:
    """Map a raw concept string to its canonical display name.

    Returns '' if the concept is unknown (noise filtering).
    """
    term = raw.strip().rstrip(".,;:").lower()
    return _CONCEPT_CANONICAL.get(term, "")


def _split_concepts(raw: str) -> list[str]:
    """Split raw legal_concepts string into canonical concept names.

    Applies _CONCEPT_CANONICAL to normalise synonyms and merge variants.
    Unmapped strings are silently dropped (LLM noise filtering).
    Deduplicates within a single case (e.g. "protection visa; s.36" → ["Protection Visa"]).
    """
    if not raw:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for part in re.split(r"[;,]", raw):
        canonical = _normalise_concept(part)
        if canonical and canonical not in seen:
            seen.add(canonical)
            out.append(canonical)
    return out


def _split_judges(raw: str) -> list[str]:
    """Split raw judges string into clean, normalised display names.

    Strips titles (Justice/Member/Mr/Ms), trailing abbreviations (J/CJ/FM),
    applies is_real_name filtering to remove parsing noise, and deduplicates.
    """
    if not raw:
        return []
    names: list[str] = []
    seen: set[str] = set()
    for piece in re.split(r"[;,]", raw):
        name = _normalise_judge_name(piece)
        lowered = name.lower()
        if (
            not name
            or len(name) < 2
            or lowered in _JUDGE_BLOCKLIST
            or name.replace(" ", "").isdigit()
            or lowered in seen
            or not _is_real_judge_name(name)
        ):
            continue
        seen.add(lowered)
        names.append(name)
    return names


def _determine_court_type(court_codes: set[str]) -> str:
    if not court_codes:
        return "unknown"
    has_tribunal = any(code in TRIBUNAL_CODES for code in court_codes)
    has_court = any(code in COURT_CODES for code in court_codes)
    if has_tribunal and not has_court:
        return "tribunal"
    if has_court and not has_tribunal:
        return "court"
    return "mixed"


def _win_outcomes_for_court_type(court_type: str) -> list[str]:
    if court_type == "tribunal":
        return list(_TRIBUNAL_WIN_OUTCOMES)
    if court_type == "court":
        return list(_COURT_WIN_OUTCOMES)
    return list(_MIXED_WIN_OUTCOMES)


def _is_win(normalised_outcome: str, court_code: str) -> bool:
    if court_code in TRIBUNAL_CODES:
        return normalised_outcome in _TRIBUNAL_WIN_OUTCOMES
    if court_code in COURT_CODES:
        return normalised_outcome in _COURT_WIN_OUTCOMES
    return normalised_outcome in _MIXED_WIN_OUTCOMES


def _round_rate(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return round((numerator / denominator) * 100.0, 1)


def _judge_profile_payload(
    name: str,
    judge_cases: list[ImmigrationCase],
    include_recent_cases: bool = True,
    court_baselines: dict[str, float] | None = None,
) -> dict:
    total = len(judge_cases)
    if total == 0:
        payload = {
            "judge": {
                "name": name,
                "total_cases": 0,
                "courts": [],
                "active_years": {"first": None, "last": None},
            },
            "approval_rate": 0.0,
            "court_type": "unknown",
            "outcome_distribution": {},
            "visa_breakdown": [],
            "concept_effectiveness": [],
            "yearly_trend": [],
            "nature_breakdown": [],
            "representation_analysis": {"unknown_count": 0},
            "country_breakdown": [],
            "court_comparison": [],
            "recent_3yr_trend": [],
        }
        if include_recent_cases:
            payload["recent_cases"] = []
        return payload

    wins = 0
    outcome_distribution: Counter = Counter()
    court_counter: Counter = Counter()
    year_totals: Counter = Counter()
    year_wins: Counter = Counter()
    visa_totals: Counter = Counter()
    visa_wins: Counter = Counter()
    nature_totals: Counter = Counter()
    nature_wins: Counter = Counter()
    concept_totals: Counter = Counter()
    concept_wins: Counter = Counter()
    rep_totals: Counter = Counter()
    rep_wins: Counter = Counter()
    country_totals: Counter = Counter()
    country_wins: Counter = Counter()
    court_wins: Counter = Counter()

    years = [c.year for c in judge_cases if c.year]

    for case in judge_cases:
        if case.court_code:
            court_counter[case.court_code] += 1
        norm = _normalise_outcome(case.outcome)
        outcome_distribution[norm] += 1
        won = _is_win(norm, case.court_code)
        if won:
            wins += 1
        if case.year:
            year_totals[case.year] += 1
            if won:
                year_wins[case.year] += 1
        if case.visa_subclass:
            visa_totals[case.visa_subclass] += 1
            if won:
                visa_wins[case.visa_subclass] += 1
        if case.case_nature:
            nature_totals[case.case_nature] += 1
            if won:
                nature_wins[case.case_nature] += 1
        for concept in _split_concepts(case.legal_concepts):
            concept_totals[concept] += 1
            if won:
                concept_wins[concept] += 1

        # Representation analysis
        rep_raw = (case.is_represented or "").strip().lower()
        if rep_raw in ("yes", "true", "1", "represented"):
            rep_key = "represented"
        elif rep_raw in ("no", "false", "0", "unrepresented", "self"):
            rep_key = "self_represented"
        else:
            rep_key = None
        if rep_key:
            rep_totals[rep_key] += 1
            if won:
                rep_wins[rep_key] += 1

        # Country of origin
        country = (case.country_of_origin or "").strip()
        if country:
            country_totals[country] += 1
            if won:
                country_wins[country] += 1

        # Per-court win tracking (for court comparison)
        if case.court_code and won:
            court_wins[case.court_code] += 1

    approval_rate = _round_rate(wins, total)
    courts = sorted(court_counter.keys())
    court_type = _determine_court_type(set(courts))

    visa_breakdown = [
        {
            "subclass": subclass,
            "total": count,
            "win_rate": _round_rate(visa_wins[subclass], count),
        }
        for subclass, count in sorted(
            visa_totals.items(), key=lambda item: item[1], reverse=True
        )
    ]

    nature_breakdown = [
        {
            "nature": nature,
            "total": count,
            "win_rate": _round_rate(nature_wins[nature], count),
        }
        for nature, count in sorted(
            nature_totals.items(), key=lambda item: item[1], reverse=True
        )
    ]

    concept_effectiveness = []
    for concept, count in concept_totals.most_common(30):
        win_rate = _round_rate(concept_wins[concept], count)
        concept_effectiveness.append(
            {
                "concept": concept,
                "total": count,
                "win_rate": win_rate,
                "baseline_rate": approval_rate,
                "lift": round((win_rate / approval_rate), 2) if approval_rate > 0 else 0.0,
            }
        )

    yearly_trend = [
        {
            "year": year,
            "total": year_totals[year],
            "approval_rate": _round_rate(year_wins[year], year_totals[year]),
        }
        for year in sorted(year_totals.keys())
    ]

    # Representation analysis
    representation_analysis: dict = {}
    for rk in ("represented", "self_represented"):
        if rep_totals[rk]:
            representation_analysis[rk] = {
                "total": rep_totals[rk],
                "win_rate": _round_rate(rep_wins[rk], rep_totals[rk]),
            }
    representation_analysis["unknown_count"] = total - sum(rep_totals.values())

    # Country breakdown (top 20)
    country_breakdown = [
        {
            "country": country,
            "total": count,
            "win_rate": _round_rate(country_wins[country], count),
        }
        for country, count in sorted(
            country_totals.items(), key=lambda x: x[1], reverse=True
        )
    ][:20]

    # Court comparison (requires court_baselines arg)
    court_comparison = []
    if court_baselines:
        for code in courts:
            judge_court_total = court_counter[code]
            if judge_court_total == 0:
                continue
            judge_rate = _round_rate(court_wins[code], judge_court_total)
            avg = court_baselines.get(code)
            if avg is not None:
                court_comparison.append({
                    "court_code": code,
                    "judge_rate": judge_rate,
                    "court_avg_rate": avg,
                    "delta": round(judge_rate - avg, 1),
                    "judge_total": judge_court_total,
                })

    # Recent 3-year summary
    current_year = max(years) if years else 0
    recent_3yr = [
        {"year": y["year"], "total": y["total"], "approval_rate": y["approval_rate"]}
        for y in yearly_trend
        if y["year"] >= current_year - 2
    ]

    payload = {
        "judge": {
            "name": name,
            "total_cases": total,
            "courts": courts,
            "active_years": {
                "first": min(years) if years else None,
                "last": max(years) if years else None,
            },
        },
        "approval_rate": approval_rate,
        "court_type": court_type,
        "outcome_distribution": dict(outcome_distribution),
        "visa_breakdown": visa_breakdown,
        "concept_effectiveness": concept_effectiveness,
        "yearly_trend": yearly_trend,
        "nature_breakdown": nature_breakdown,
        "representation_analysis": representation_analysis,
        "country_breakdown": country_breakdown,
        "court_comparison": court_comparison,
        "recent_3yr_trend": recent_3yr,
    }

    if include_recent_cases:
        recent_sorted = sorted(
            judge_cases,
            key=lambda c: (c.year or 0, c.date or ""),
            reverse=True,
        )[:10]
        payload["recent_cases"] = [
            {
                "case_id": c.case_id,
                "citation": c.citation,
                "date": c.date,
                "outcome": c.outcome,
                "visa_subclass": c.visa_subclass,
            }
            for c in recent_sorted
        ]

    return payload


# ── Cached load_all with year/court filtering ──────────────────────────

_all_cases_cache: list[ImmigrationCase] = []
_all_cases_ts: float = 0.0
_all_cases_lock = threading.Lock()
_CACHE_TTL = 60.0


def _get_all_cases() -> list[ImmigrationCase]:
    """Return repo.load_all() with 60-second in-memory cache."""
    global _all_cases_cache, _all_cases_ts
    now = time.time()
    if _all_cases_cache and (now - _all_cases_ts) < _CACHE_TTL:
        return _all_cases_cache
    with _all_cases_lock:
        # Double-check after acquiring lock (another thread may have refreshed)
        if _all_cases_cache and (time.time() - _all_cases_ts) < _CACHE_TTL:
            return _all_cases_cache
        repo = get_repo()
        _all_cases_cache = repo.load_all()
        _all_cases_ts = time.time()
        return _all_cases_cache


def _invalidate_cases_cache() -> None:
    """Reset the in-memory cases cache so the next read fetches fresh data."""
    global _all_cases_ts
    _all_cases_ts = 0.0


def _clean_visa(raw: object) -> str:
    """Wrapper around clean_subclass for None/NaN-safe API usage."""
    return clean_subclass(raw)


def _apply_filters(cases: list[ImmigrationCase]) -> list[ImmigrationCase]:
    """Apply query params to a case list.

    Supported params: court, year_from, year_to, case_natures (comma-sep),
    visa_subclasses (comma-sep), visa_families (comma-sep), outcome_types (comma-sep).
    """
    court = request.args.get("court", "").strip()
    year_from = safe_int(request.args.get("year_from"), default=0, min_val=0, max_val=2100)
    year_to = safe_int(request.args.get("year_to"), default=0, min_val=0, max_val=2100)
    case_natures_raw = request.args.get("case_natures", "").strip()
    visa_subclasses_raw = request.args.get("visa_subclasses", "").strip()
    visa_families_raw = request.args.get("visa_families", "").strip()
    outcome_types_raw = request.args.get("outcome_types", "").strip()

    if court:
        cases = [c for c in cases if c.court_code == court]
    if year_from:
        cases = [c for c in cases if c.year and c.year >= year_from]
    if year_to:
        cases = [c for c in cases if c.year and c.year <= year_to]
    if case_natures_raw:
        natures = {n.strip().lower() for n in case_natures_raw.split(",") if n.strip()}
        cases = [c for c in cases if (c.case_nature or "").strip().lower() in natures]
    if visa_subclasses_raw:
        subclasses = {s.strip() for s in visa_subclasses_raw.split(",") if s.strip()}
        cases = [c for c in cases if _clean_visa(c.visa_subclass) in subclasses]
    if visa_families_raw:
        families = {f.strip() for f in visa_families_raw.split(",") if f.strip()}
        cases = [c for c in cases if get_family(c.visa_subclass or "") in families]
    if outcome_types_raw:
        outcomes = {o.strip().lower() for o in outcome_types_raw.split(",") if o.strip()}
        cases = [c for c in cases if _normalise_outcome(c.outcome).lower() in outcomes]
    return cases

DATA_DICTIONARY_FIELDS = [
    {"name": "case_id", "type": "string", "description": "SHA-256 hash (first 12 chars) of citation/URL/title", "example": "a1b2c3d4e5f6"},
    {"name": "citation", "type": "string", "description": "Official case citation", "example": "[2024] AATA 1234"},
    {"name": "title", "type": "string", "description": "Case title / party names", "example": "Smith v Minister for Immigration"},
    {"name": "court", "type": "string", "description": "Full court/tribunal name", "example": "Administrative Appeals Tribunal"},
    {"name": "court_code", "type": "string", "description": "Short court identifier", "example": "AATA"},
    {"name": "date", "type": "string", "description": "Decision date (DD Month YYYY)", "example": "15 March 2024"},
    {"name": "year", "type": "integer", "description": "Decision year", "example": "2024"},
    {"name": "url", "type": "string", "description": "AustLII or Federal Court URL", "example": "https://www.austlii.edu.au/..."},
    {"name": "judges", "type": "string", "description": "Judge(s) or tribunal member(s)", "example": "Deputy President S Smith"},
    {"name": "catchwords", "type": "string", "description": "Key legal topics from the case", "example": "MIGRATION - visa cancellation..."},
    {"name": "outcome", "type": "string", "description": "Decision outcome", "example": "Dismissed"},
    {"name": "visa_type", "type": "string", "description": "Visa subclass or category", "example": "Subclass 866 Protection"},
    {"name": "legislation", "type": "string", "description": "Referenced legislation", "example": "Migration Act 1958 (Cth) s 501"},
    {"name": "text_snippet", "type": "string", "description": "Short excerpt from case text", "example": "The Tribunal finds that..."},
    {"name": "full_text_path", "type": "string", "description": "Path to downloaded full text file", "example": "downloaded_cases/case_texts/a1b2c3d4e5f6.txt"},
    {"name": "source", "type": "string", "description": "Data source identifier", "example": "austlii"},
    {"name": "user_notes", "type": "string", "description": "User-added notes", "example": "Important precedent for..."},
    {"name": "tags", "type": "string", "description": "Comma-separated user tags", "example": "review, important"},
    {"name": "visa_subclass", "type": "string", "description": "Visa subclass number", "example": "866"},
    {"name": "visa_class_code", "type": "string", "description": "Visa class code letter", "example": "XA"},
    {"name": "case_nature", "type": "string", "description": "Nature/category of the case (LLM-extracted)", "example": "Protection visa refusal"},
    {"name": "legal_concepts", "type": "string", "description": "Key legal concepts (LLM-extracted)", "example": "well-founded fear, complementary protection"},
]


def _valid_case_id(case_id: str) -> bool:
    return bool(_HEX_ID.match(case_id))


def _error(msg: str, status: int = 400):
    return jsonify({"error": msg}), status


# ── CSRF ────────────────────────────────────────────────────────────────

@api_bp.route("/csrf-token")
def get_csrf_token():
    return jsonify({"csrf_token": generate_csrf()})


# ── Dashboard Stats ─────────────────────────────────────────────────────

@api_bp.route("/stats")
def stats():
    court = request.args.get("court", "").strip()
    year_from = safe_int(request.args.get("year_from"), default=0, min_val=0, max_val=2100)
    year_to = safe_int(request.args.get("year_to"), default=0, min_val=0, max_val=2100)

    # Treat full 2000–current_year range as "no filter" to use optimised path
    is_full_range = (not court
                     and (not year_from or year_from <= 2000)
                     and (not year_to or year_to >= END_YEAR))

    # If filters are active, compute stats from filtered load_all
    if not is_full_range:
        cases = _apply_filters(_get_all_cases())
        by_court: dict[str, int] = Counter(c.court_code for c in cases if c.court_code)
        by_year: dict[int, int] = Counter(c.year for c in cases if c.year)
        by_nature: dict[str, int] = Counter(c.case_nature for c in cases if c.case_nature)
        by_visa_raw: dict[str, int] = Counter(c.visa_subclass for c in cases if c.visa_subclass)
        by_visa = {_clean_visa(k): v for k, v in by_visa_raw.items() if _clean_visa(k)}
        with_text = sum(1 for c in cases if c.full_text_path)
        sources: dict[str, int] = Counter(c.source for c in cases if c.source)

        recent_sorted = sorted(
            [c for c in cases if c.date],
            key=lambda c: c.date,
            reverse=True,
        )[:5]
        recent = [
            {
                "case_id": c.case_id, "title": c.title, "citation": c.citation,
                "court_code": c.court_code, "date": c.date, "outcome": c.outcome,
            }
            for c in recent_sorted
        ]

        return jsonify({
            "total_cases": len(cases),
            "with_full_text": with_text,
            "courts": dict(by_court),
            "years": {str(k): v for k, v in sorted(by_year.items())},
            "natures": dict(by_nature),
            "visa_subclasses": by_visa,
            "visa_families": group_by_family(by_visa_raw),
            "sources": dict(sources),
            "recent_cases": recent,
        })

    # Unfiltered: use repository's optimised get_statistics
    repo = get_repo()
    s = repo.get_statistics()

    sources_dict = s.get("by_source", {})
    if not sources_dict:
        sources_dict = {src: 0 for src in s.get("sources", [])}

    recent = []
    try:
        recent_cases, _ = repo.filter_cases(sort_by="date", sort_dir="desc", page=1, page_size=5)
        recent = [
            {
                "case_id": c.case_id, "title": c.title, "citation": c.citation,
                "court_code": c.court_code, "date": c.date, "outcome": c.outcome,
            }
            for c in recent_cases
        ]
    except Exception:
        logger.warning("Failed to fetch recent cases for stats", exc_info=True)

    raw_visa = s.get("by_visa_subclass", {})
    cleaned_visa = {_clean_visa(k): v for k, v in raw_visa.items() if _clean_visa(k)}

    return jsonify({
        "total_cases": s.get("total", 0),
        "with_full_text": s.get("with_full_text", 0),
        "courts": s.get("by_court", {}),
        "years": s.get("by_year", {}),
        "natures": s.get("by_nature", {}),
        "visa_subclasses": cleaned_visa,
        "visa_families": group_by_family(raw_visa),
        "sources": sources_dict,
        "recent_cases": recent,
    })


@api_bp.route("/stats/trends")
def stats_trends():
    """Court x year cross-tabulation for trend chart."""
    court = request.args.get("court", "").strip()
    year_from = safe_int(request.args.get("year_from"), default=0, min_val=0, max_val=2100)
    year_to = safe_int(request.args.get("year_to"), default=0, min_val=0, max_val=2100)

    # Treat full 2000–current_year range as "no filter"
    is_full_range = (not court
                     and (not year_from or year_from <= 2000)
                     and (not year_to or year_to >= END_YEAR))

    # Supabase RPC for unfiltered requests
    if is_full_range:
        repo = get_repo()
        if hasattr(repo, "_client"):
            try:
                resp = repo._client.rpc("get_court_year_trends").execute()
                return jsonify({"trends": resp.data or []})
            except Exception:
                logger.warning("Supabase RPC get_court_year_trends failed, falling back to local", exc_info=True)

    all_cases = _apply_filters(_get_all_cases())

    year_court_counts: dict[int, dict[str, int]] = {}
    for c in all_cases:
        if c.year and c.court_code:
            if c.year not in year_court_counts:
                year_court_counts[c.year] = {}
            ycc = year_court_counts[c.year]
            ycc[c.court_code] = ycc.get(c.court_code, 0) + 1

    trends = [{"year": year, **year_court_counts[year]} for year in sorted(year_court_counts.keys())]

    return jsonify({"trends": trends})


@api_bp.route("/court-lineage")
def court_lineage():
    """Return court lineage metadata showing tribunal and court succession over time.

    Returns lineages for:
    - Lower court: FMCA (2000-2013) → FCCA (2013-2021) → FedCFamC2G (2021+)
    - Tribunal: MRTA+RRTA (2000-2015) → AATA (2015-2024) → ARTA (2024+)

    Includes case counts per court per year and transition information.
    """
    from ...config import AUSTLII_DATABASES

    # Get all cases and aggregate by court and year
    all_cases = _get_all_cases()

    # Build court_year_counts: {court_code: {year: count}}
    court_year_counts = defaultdict(lambda: defaultdict(int))
    all_years = set()

    for case in all_cases:
        if case.court_code and case.year:
            court_year_counts[case.court_code][case.year] += 1
            all_years.add(case.year)

    # Define lineages with metadata
    lineages = [
        {
            "id": "lower-court",
            "name": "Lower Court Lineage",
            "courts": [
                {
                    "code": "FMCA",
                    "name": AUSTLII_DATABASES.get("FMCA", {}).get("name", "Federal Magistrates Court of Australia"),
                    "years": [2000, 2013],
                    "case_count_by_year": dict(court_year_counts.get("FMCA", {})),
                },
                {
                    "code": "FCCA",
                    "name": AUSTLII_DATABASES.get("FCCA", {}).get("name", "Federal Circuit Court of Australia"),
                    "years": [2013, 2021],
                    "case_count_by_year": dict(court_year_counts.get("FCCA", {})),
                },
                {
                    "code": "FedCFamC2G",
                    "name": AUSTLII_DATABASES.get("FedCFamC2G", {}).get("name", "Federal Circuit and Family Court of Australia (Division 2)"),
                    "years": [2021, END_YEAR],
                    "case_count_by_year": dict(court_year_counts.get("FedCFamC2G", {})),
                },
            ],
            "transitions": [
                {
                    "from": "FMCA",
                    "to": "FCCA",
                    "year": 2013,
                    "description": "Federal Magistrates Court renamed to Federal Circuit Court of Australia",
                },
                {
                    "from": "FCCA",
                    "to": "FedCFamC2G",
                    "year": 2021,
                    "description": "Federal Circuit Court merged into Federal Circuit and Family Court (Division 2)",
                },
            ],
        },
        {
            "id": "tribunal",
            "name": "Tribunal Lineage",
            "courts": [
                {
                    "code": "MRTA",
                    "name": AUSTLII_DATABASES.get("MRTA", {}).get("name", "Migration Review Tribunal"),
                    "years": [2000, 2015],
                    "case_count_by_year": dict(court_year_counts.get("MRTA", {})),
                },
                {
                    "code": "RRTA",
                    "name": AUSTLII_DATABASES.get("RRTA", {}).get("name", "Refugee Review Tribunal"),
                    "years": [2000, 2015],
                    "case_count_by_year": dict(court_year_counts.get("RRTA", {})),
                },
                {
                    "code": "AATA",
                    "name": AUSTLII_DATABASES.get("AATA", {}).get("name", "Administrative Appeals Tribunal"),
                    "years": [2015, 2024],
                    "case_count_by_year": dict(court_year_counts.get("AATA", {})),
                },
                {
                    "code": "ARTA",
                    "name": AUSTLII_DATABASES.get("ARTA", {}).get("name", "Administrative Review Tribunal"),
                    "years": [2024, END_YEAR],
                    "case_count_by_year": dict(court_year_counts.get("ARTA", {})),
                },
            ],
            "transitions": [
                {
                    "from": "MRTA",
                    "to": "AATA",
                    "year": 2015,
                    "description": "Migration Review Tribunal merged into Administrative Appeals Tribunal",
                },
                {
                    "from": "RRTA",
                    "to": "AATA",
                    "year": 2015,
                    "description": "Refugee Review Tribunal merged into Administrative Appeals Tribunal",
                },
                {
                    "from": "AATA",
                    "to": "ARTA",
                    "year": 2024,
                    "description": "Administrative Appeals Tribunal replaced by Administrative Review Tribunal",
                },
            ],
        },
    ]

    # Calculate total cases and year range
    total_cases = len(all_cases)
    year_range = [min(all_years), max(all_years)] if all_years else [2000, END_YEAR]

    return jsonify({
        "lineages": lineages,
        "total_cases": total_cases,
        "year_range": year_range,
    })


# ── Cases CRUD ──────────────────────────────────────────────────────────

@api_bp.route("/cases")
def list_cases():
    repo = get_repo()
    court = request.args.get("court", "")
    year_str = request.args.get("year", "")
    year = None
    if year_str:
        try:
            year = int(year_str)
        except ValueError:
            pass
    visa_type = request.args.get("visa_type", "")
    keyword = request.args.get("keyword", "")
    source = request.args.get("source", "")
    tag = request.args.get("tag", "")
    nature = request.args.get("nature", "")
    sort_by = request.args.get("sort_by", "date")
    sort_dir = request.args.get("sort_dir", "desc")
    page = safe_int(request.args.get("page"), default=1, min_val=1)
    page_size = safe_int(request.args.get("page_size"), default=DEFAULT_PAGE_SIZE, min_val=1, max_val=MAX_PAGE_SIZE)

    page_cases, total = repo.filter_cases(
        court=court, year=year, visa_type=visa_type,
        source=source, tag=tag, nature=nature, keyword=keyword,
        sort_by=sort_by, sort_dir=sort_dir,
        page=page, page_size=page_size,
    )

    total_pages = max(1, (total + page_size - 1) // page_size)

    return jsonify({
        "cases": [c.to_dict() for c in page_cases],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    })


@api_bp.route("/cases/<case_id>")
def get_case(case_id):
    if not _valid_case_id(case_id):
        return _error("Invalid case ID")
    repo = get_repo()
    case = repo.get_by_id(case_id)
    if not case:
        return _error("Case not found", 404)
    full_text = repo.get_case_full_text(case)
    return jsonify({"case": case.to_dict(), "full_text": full_text})


@api_bp.route("/cases", methods=["POST"])
def create_case():
    data = request.get_json(silent=True) or {}
    if not data.get("title") and not data.get("citation"):
        return _error("Title or citation is required")
    case = ImmigrationCase.from_dict(data)
    repo = get_repo()
    case = repo.add(case)
    _invalidate_cases_cache()
    return jsonify({"case": case.to_dict()}), 201


@api_bp.route("/cases/<case_id>", methods=["PUT"])
def update_case(case_id):
    if not _valid_case_id(case_id):
        return _error("Invalid case ID")
    repo = get_repo()
    case = repo.get_by_id(case_id)
    if not case:
        return _error("Case not found", 404)

    data = request.get_json(silent=True) or {}
    updates = {}
    for field in EDITABLE_FIELDS:
        if field in data:
            val = data[field]
            if field == "year":
                try:
                    val = int(val) if val else 0
                except (ValueError, TypeError):
                    val = case.year
            updates[field] = val

    if repo.update(case_id, updates):
        _invalidate_cases_cache()
        updated = repo.get_by_id(case_id)
        return jsonify({"case": updated.to_dict() if updated else {}})
    return _error("Failed to update case", 500)


@api_bp.route("/cases/<case_id>", methods=["DELETE"])
def delete_case(case_id):
    if not _valid_case_id(case_id):
        return _error("Invalid case ID")
    repo = get_repo()
    if repo.delete(case_id):
        _invalidate_cases_cache()
        return jsonify({"success": True})
    return _error("Failed to delete case", 500)


# ── Batch Operations ────────────────────────────────────────────────────

@api_bp.route("/cases/batch", methods=["POST"])
def batch_cases():
    data = request.get_json(silent=True) or {}
    action = data.get("action", "")
    ids = data.get("case_ids", [])

    if not isinstance(ids, list):
        return _error("case_ids must be a list")

    ids = [i for i in ids if isinstance(i, str) and _valid_case_id(i)]
    if not ids:
        return _error("No valid case IDs provided")
    if len(ids) > MAX_BATCH_SIZE:
        return _error(f"Batch limited to {MAX_BATCH_SIZE} cases")

    repo = get_repo()
    count = 0

    if action == "tag":
        tag = (data.get("tag") or "").strip().replace(",", "").replace("<", "").replace(">", "")
        if not tag:
            return _error("No tag provided")
        if len(tag) > MAX_TAG_LENGTH:
            return _error(f"Tag must be {MAX_TAG_LENGTH} characters or less")
        for cid in ids:
            case = repo.get_by_id(cid)
            if case:
                existing = {t.strip() for t in case.tags.split(",") if t.strip()} if case.tags else set()
                if tag not in existing:
                    existing.add(tag)
                    repo.update(cid, {"tags": ", ".join(sorted(existing))})
                    count += 1

    elif action == "delete":
        for cid in ids:
            if repo.delete(cid):
                count += 1

    else:
        return _error(f"Unknown action: {action}")

    if count > 0:
        _invalidate_cases_cache()
    return jsonify({"affected": count})


# ── Compare ─────────────────────────────────────────────────────────────

@api_bp.route("/cases/compare")
def compare_cases():
    ids = request.args.getlist("ids")
    ids = [i for i in ids if _valid_case_id(i)]
    if len(ids) < 2:
        return _error("At least 2 case IDs required")
    if len(ids) > MAX_COMPARE_CASES:
        return _error(f"Maximum {MAX_COMPARE_CASES} cases can be compared at once")

    repo = get_repo()
    cases = []
    for cid in ids:
        case = repo.get_by_id(cid)
        if case:
            cases.append(case.to_dict())

    if len(cases) < 2:
        return _error("Could not find enough cases", 404)

    return jsonify({"cases": cases})


# ── Related Cases ───────────────────────────────────────────────────────

@api_bp.route("/cases/<case_id>/related")
def related_cases(case_id):
    if not _valid_case_id(case_id):
        return _error("Invalid case ID")
    repo = get_repo()
    limit = safe_int(request.args.get("limit"), default=DEFAULT_RELATED_LIMIT, min_val=1, max_val=MAX_RELATED_LIMIT)
    related = repo.find_related(case_id, limit=limit)
    return jsonify({"cases": [c.to_dict() for c in related]})


# ── Full-Text Search ────────────────────────────────────────────────────

def _case_semantic_text(case: ImmigrationCase) -> str:
    """Build semantic text payload for a case."""
    return " | ".join(
        part.strip()
        for part in [
            case.title,
            case.citation,
            case.catchwords,
            case.case_nature,
            case.legal_concepts,
            case.outcome,
            case.text_snippet,
        ]
        if part and part.strip()
    )


def _normalize_vectors(vectors: np.ndarray) -> np.ndarray:
    """L2-normalize vectors for cosine similarity."""
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms = np.where(norms == 0.0, 1.0, norms)
    return vectors / norms


def _get_embedding_client(provider: str, model: str = ""):
    """Create embedding client for a provider and validate API key."""
    provider = (provider or "").strip().lower()
    if provider not in ALLOWED_SEARCH_PROVIDERS:
        raise ValueError(f"provider must be one of: {sorted(ALLOWED_SEARCH_PROVIDERS)}")

    model_name = model.strip()
    if provider == "openai":
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise ValueError("OPENAI_API_KEY is required for provider=openai")
        if not model_name:
            model_name = "text-embedding-3-small"
        return OpenAIEmbeddingClient(api_key=api_key, model=model_name), provider, model_name

    api_key = (
        os.environ.get("GEMINI_API_KEY", "").strip()
        or os.environ.get("GOOGLE_API_KEY", "").strip()
    )
    if not api_key:
        raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY is required for provider=gemini")
    if not model_name:
        model_name = "models/gemini-embedding-001"
    return GeminiEmbeddingClient(api_key=api_key, model=model_name), provider, model_name


def _semantic_rerank_cases(
    query: str,
    candidates: list[ImmigrationCase],
    mode: str,
    limit: int,
    provider: str,
    model: str = "",
) -> tuple[list[ImmigrationCase], str, str]:
    """Rerank lexical candidates using embeddings (semantic or hybrid)."""
    if not candidates:
        return [], provider, model

    client, provider_used, model_used = _get_embedding_client(provider, model)
    case_texts = [_case_semantic_text(case) for case in candidates]
    doc_vectors = _normalize_vectors(
        client.embed_texts(case_texts, task_type="RETRIEVAL_DOCUMENT")
    )
    query_vector = _normalize_vectors(
        client.embed_texts([query], task_type="RETRIEVAL_QUERY")
    )[0]

    scores = doc_vectors @ query_vector
    semantic_order = np.argsort(-scores).tolist()
    semantic_ranked = [candidates[idx] for idx in semantic_order]

    if mode == "semantic":
        return semantic_ranked[:limit], provider_used, model_used

    # Hybrid mode: semantic ranking fused with lexical ranking order.
    lexical_ids = [case.case_id for case in candidates]
    semantic_ids = [case.case_id for case in semantic_ranked]
    fused_ids = reciprocal_rank_fusion(
        ranked_lists=[semantic_ids, lexical_ids],
        weights=[0.65, 0.35],
        limit=limit,
    )
    by_id = {case.case_id: case for case in candidates}
    hybrid_ranked = [by_id[case_id] for case_id in fused_ids if case_id in by_id]
    return hybrid_ranked[:limit], provider_used, model_used

@api_bp.route("/search")
def search():
    query = request.args.get("q", "").strip()
    limit = safe_int(request.args.get("limit"), default=DEFAULT_SEARCH_LIMIT, min_val=1, max_val=MAX_SEARCH_LIMIT)
    mode = request.args.get("mode", DEFAULT_SEARCH_MODE).strip().lower()
    provider = request.args.get(
        "provider",
        os.environ.get("SEMANTIC_SEARCH_PROVIDER", "openai"),
    ).strip().lower()
    model = request.args.get("model", "").strip()
    candidate_limit = safe_int(
        request.args.get("candidate_limit"),
        default=max(DEFAULT_SEMANTIC_CANDIDATE_LIMIT, limit * 3),
        min_val=limit,
        max_val=MAX_SEMANTIC_CANDIDATE_LIMIT,
    )

    if not query:
        return jsonify({"cases": [], "mode": mode if mode in ALLOWED_SEARCH_MODES else DEFAULT_SEARCH_MODE})
    if mode not in ALLOWED_SEARCH_MODES:
        return _error(f"mode must be one of: {sorted(ALLOWED_SEARCH_MODES)}")

    repo = get_repo()
    lexical_results = repo.search_text(
        query,
        limit=limit if mode == "lexical" else candidate_limit,
    )

    if mode == "lexical":
        return jsonify({"cases": [c.to_dict() for c in lexical_results], "mode": "lexical"})

    try:
        reranked, provider_used, model_used = _semantic_rerank_cases(
            query=query,
            candidates=lexical_results,
            mode=mode,
            limit=limit,
            provider=provider,
            model=model,
        )
        return jsonify({
            "cases": [c.to_dict() for c in reranked],
            "mode": mode,
            "provider": provider_used,
            "model": model_used,
            "candidate_limit": candidate_limit,
        })
    except ValueError as exc:
        msg = str(exc)
        if mode == "hybrid" and "required for provider" in msg:
            logger.info("Hybrid semantic search fallback (missing provider key): %s", msg)
            return jsonify({
                "cases": [c.to_dict() for c in lexical_results[:limit]],
                "mode": "lexical_fallback",
                "warning": "Semantic provider key missing; returned lexical results.",
            })
        return _error(msg)
    except Exception as exc:  # pragma: no cover - network/provider failures
        logger.warning("Semantic search failed (mode=%s, provider=%s): %s", mode, provider, exc)
        if mode == "hybrid":
            # Degrade gracefully for hybrid requests.
            return jsonify({
                "cases": [c.to_dict() for c in lexical_results[:limit]],
                "mode": "lexical_fallback",
                "warning": "Semantic rerank unavailable; returned lexical results.",
            })
        return _error("Semantic search backend unavailable", 503)


# ── Filter Options ──────────────────────────────────────────────────────

@api_bp.route("/filter-options")
def filter_options():
    repo = get_repo()
    opts = repo.get_filter_options()
    return jsonify(opts)


# ── Export ──────────────────────────────────────────────────────────────

@api_bp.route("/export/csv")
def export_csv():
    repo = get_repo()
    cases = _filter_cases(repo.load_all(), request.args)
    si = io.StringIO()
    writer = csv.DictWriter(si, fieldnames=CASE_FIELDS)
    writer.writeheader()
    for c in cases:
        writer.writerow(c.to_dict())
    output = io.BytesIO(si.getvalue().encode("utf-8-sig"))
    return send_file(
        output,
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"immigration_cases_{datetime.now():%Y%m%d}.csv",
    )


@api_bp.route("/export/json")
def export_json():
    repo = get_repo()
    cases = _filter_cases(repo.load_all(), request.args)
    data = {
        "exported_at": datetime.now().isoformat(),
        "total_cases": len(cases),
        "cases": [c.to_dict() for c in cases],
    }
    output = io.BytesIO(json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8"))
    return send_file(
        output,
        mimetype="application/json",
        as_attachment=True,
        download_name=f"immigration_cases_{datetime.now():%Y%m%d}.json",
    )


# ── Job Status ──────────────────────────────────────────────────────────

@api_bp.route("/job-status")
def job_status():
    with _job_lock:
        snapshot = dict(_job_status)
    return jsonify(snapshot)


# ── Download Job ────────────────────────────────────────────────────────

@api_bp.route("/download/start", methods=["POST"])
def start_download():
    with _job_lock:
        if _job_status["running"]:
            return _error("A job is already running")

    data = request.get_json(silent=True) or {}
    court_filter = data.get("court", "")
    limit = safe_int(data.get("limit"), default=50, min_val=1, max_val=10000)

    thread = threading.Thread(
        target=_run_download_job,
        args=(court_filter, limit),
        kwargs={"output_dir": get_output_dir(), "repo": get_repo()},
        daemon=True,
    )
    thread.start()
    return jsonify({"started": True})


# ── Pipeline ────────────────────────────────────────────────────────────

@api_bp.route("/pipeline-status")
def pipeline_status():
    from ...pipeline import get_pipeline_status
    return jsonify(get_pipeline_status())


@api_bp.route("/pipeline-action", methods=["POST"])
def pipeline_action():
    from ...pipeline import request_pipeline_stop, get_pipeline_status
    from ...pipeline import PipelineConfig, start_pipeline

    data = request.get_json(silent=True) or {}
    action = data.get("action", "")

    if action == "stop":
        request_pipeline_stop()
        return jsonify({"ok": True, "message": "Stop requested."})

    if action == "start":
        ps = get_pipeline_status()
        if ps.get("running"):
            return _error("Pipeline is already running")
        with _job_lock:
            if _job_status["running"]:
                return _error("Another job is running")

        config = PipelineConfig(
            databases=data.get("databases", ["AATA", "ARTA", "FCA"]),
            start_year=safe_int(data.get("start_year"), default=START_YEAR, min_val=2000, max_val=2030),
            end_year=safe_int(data.get("end_year"), default=END_YEAR, min_val=2000, max_val=2030),
        )
        out = get_output_dir()
        if start_pipeline(config, out):
            return jsonify({"ok": True, "message": "Pipeline started."})
        return _error("Failed to start pipeline", 500)

    return _error(f"Unknown action: {action}")


# ── Analytics ──────────────────────────────────────────────────────────

@api_bp.route("/analytics/outcomes")
def analytics_outcomes():
    """Outcome rates by court, year, and visa subclass."""
    cases = _apply_filters(_get_all_cases())

    by_court: dict[str, dict[str, int]] = defaultdict(Counter)
    by_year: dict[int, dict[str, int]] = defaultdict(Counter)
    by_subclass: dict[str, dict[str, int]] = defaultdict(Counter)
    by_family: dict[str, dict[str, int]] = defaultdict(Counter)

    for c in cases:
        norm = _normalise_outcome(c.outcome)
        if c.court_code:
            by_court[c.court_code][norm] += 1
        if c.year:
            by_year[c.year][norm] += 1
        if c.visa_subclass:
            cleaned = _clean_visa(c.visa_subclass)
            if cleaned:
                by_subclass[cleaned][norm] += 1
                by_family[get_family(cleaned)][norm] += 1

    return jsonify({
        "by_court": {k: dict(v) for k, v in sorted(by_court.items())},
        "by_year": {str(k): dict(v) for k, v in sorted(by_year.items())},
        "by_subclass": {k: dict(v) for k, v in sorted(by_subclass.items(), key=lambda x: sum(x[1].values()), reverse=True)},
        "by_family": {k: dict(v) for k, v in sorted(by_family.items(), key=lambda x: sum(x[1].values()), reverse=True)},
    })


@api_bp.route("/analytics/judges")
def analytics_judges():
    """Top judges/members by case count."""
    limit = safe_int(request.args.get("limit"), default=20, min_val=1, max_val=100)
    cases = _apply_filters(_get_all_cases())

    judge_counter: Counter = Counter()
    judge_courts: dict[str, set[str]] = defaultdict(set)

    for c in cases:
        for name in _split_judges(c.judges):
            judge_counter[name] += 1
            if c.court_code:
                judge_courts[name].add(c.court_code)

    judges = [
        {"name": name, "count": count, "courts": sorted(judge_courts.get(name, set()))}
        for name, count in judge_counter.most_common(limit)
    ]

    return jsonify({"judges": judges})


@api_bp.route("/analytics/legal-concepts")
def analytics_legal_concepts():
    """Top legal concepts by frequency."""
    limit = safe_int(request.args.get("limit"), default=20, min_val=1, max_val=100)
    cases = _apply_filters(_get_all_cases())

    concept_counter: Counter = Counter()
    for c in cases:
        for concept in _split_concepts(c.legal_concepts):
            concept_counter[concept] += 1

    concepts = [
        {"name": name, "count": count}
        for name, count in concept_counter.most_common(limit)
    ]

    return jsonify({"concepts": concepts})


@api_bp.route("/analytics/nature-outcome")
def analytics_nature_outcome():
    """Nature x Outcome cross-tabulation matrix."""
    cases = _apply_filters(_get_all_cases())

    nature_outcome: dict[str, dict[str, int]] = defaultdict(Counter)
    for c in cases:
        if not c.case_nature:
            continue
        norm = _normalise_outcome(c.outcome)
        nature_outcome[c.case_nature][norm] += 1

    # Get top natures by total count
    nature_totals = {n: sum(outcomes.values()) for n, outcomes in nature_outcome.items()}
    top_natures = sorted(nature_totals, key=nature_totals.get, reverse=True)[:20]

    # Collect all outcome labels
    all_outcomes = set()
    for outcomes in nature_outcome.values():
        all_outcomes.update(outcomes.keys())
    outcome_labels = sorted(all_outcomes)

    matrix: dict[str, dict[str, int]] = {}
    for nature in top_natures:
        matrix[nature] = {o: nature_outcome[nature].get(o, 0) for o in outcome_labels}

    return jsonify({
        "natures": top_natures,
        "outcomes": outcome_labels,
        "matrix": matrix,
    })


@api_bp.route("/analytics/success-rate")
def analytics_success_rate():
    """Multi-factor success-rate analytics."""
    cases = _apply_filters(_get_all_cases())

    visa_subclass = request.args.get("visa_subclass", "").strip()
    case_nature = request.args.get("case_nature", "").strip()
    legal_concepts_param = request.args.get("legal_concepts", "").strip()
    requested_concepts = _split_concepts(legal_concepts_param)

    if visa_subclass:
        cases = [c for c in cases if (c.visa_subclass or "").strip() == visa_subclass]
    if case_nature:
        target_nature = case_nature.lower()
        cases = [c for c in cases if (c.case_nature or "").strip().lower() == target_nature]
    if requested_concepts:
        required = set(requested_concepts)
        cases = [
            c
            for c in cases
            if required.issubset(set(_split_concepts(c.legal_concepts)))
        ]

    total = len(cases)
    wins = 0
    year_totals: Counter = Counter()
    year_wins: Counter = Counter()
    concept_totals: Counter = Counter()
    concept_wins: Counter = Counter()

    for case in cases:
        norm = _normalise_outcome(case.outcome)
        won = _is_win(norm, case.court_code)
        if won:
            wins += 1

        if case.year:
            year_totals[case.year] += 1
            if won:
                year_wins[case.year] += 1

        for concept in _split_concepts(case.legal_concepts):
            concept_totals[concept] += 1
            if won:
                concept_wins[concept] += 1

    losses = max(0, total - wins)
    overall_rate = _round_rate(wins, total)
    confidence = "low"
    if total > 100:
        confidence = "high"
    elif total >= 20:
        confidence = "medium"

    court_type = _determine_court_type({c.court_code for c in cases if c.court_code})
    win_outcomes = _win_outcomes_for_court_type(court_type)

    by_concept = []
    for concept, count in concept_totals.most_common(30):
        win_rate = _round_rate(concept_wins[concept], count)
        by_concept.append(
            {
                "concept": concept,
                "total": count,
                "win_rate": win_rate,
                "lift": round((win_rate / overall_rate), 2) if overall_rate > 0 else 0.0,
            }
        )

    top_combo_candidates = set(name for name, _ in concept_totals.most_common(15))
    combo_totals: Counter = Counter()
    combo_wins: Counter = Counter()
    for case in cases:
        case_concepts = sorted(
            set(_split_concepts(case.legal_concepts)).intersection(top_combo_candidates)
        )
        if len(case_concepts) < 2:
            continue
        won = _is_win(_normalise_outcome(case.outcome), case.court_code)
        for size in (2, 3):
            if len(case_concepts) < size:
                continue
            for combo in combinations(case_concepts, size):
                combo_totals[combo] += 1
                if won:
                    combo_wins[combo] += 1

    top_combos = []
    for combo, count in combo_totals.items():
        if count < 2:
            continue
        win_rate = _round_rate(combo_wins[combo], count)
        top_combos.append(
            {
                "concepts": list(combo),
                "win_rate": win_rate,
                "count": count,
                "lift": round((win_rate / overall_rate), 2) if overall_rate > 0 else 0.0,
            }
        )

    top_combos.sort(key=lambda item: (item["lift"], item["count"]), reverse=True)
    top_combos = top_combos[:20]

    trend = [
        {
            "year": year,
            "rate": _round_rate(year_wins[year], year_totals[year]),
            "count": year_totals[year],
        }
        for year in sorted(year_totals.keys())
    ]

    return jsonify(
        {
            "query": {
                "court": request.args.get("court", "").strip() or None,
                "year_from": safe_int(request.args.get("year_from"), default=0, min_val=0, max_val=2100) or None,
                "year_to": safe_int(request.args.get("year_to"), default=0, min_val=0, max_val=2100) or None,
                "visa_subclass": visa_subclass or None,
                "case_nature": case_nature or None,
                "legal_concepts": requested_concepts,
                "total_matching": total,
            },
            "success_rate": {
                "overall": overall_rate,
                "court_type": court_type,
                "win_outcomes": win_outcomes,
                "win_count": wins,
                "loss_count": losses,
                "confidence": confidence,
            },
            "by_concept": by_concept,
            "top_combos": top_combos,
            "trend": trend,
        }
    )


@api_bp.route("/analytics/judge-leaderboard")
def analytics_judge_leaderboard():
    """Judge/member leaderboard with approval rates and metadata."""
    sort_by = request.args.get("sort_by", "cases").strip().lower() or "cases"
    limit = safe_int(request.args.get("limit"), default=50, min_val=1, max_val=200)
    cases = _apply_filters(_get_all_cases())

    judge_cases: dict[str, list[ImmigrationCase]] = defaultdict(list)
    judge_court_counts: dict[str, Counter] = defaultdict(Counter)
    judge_display_name: dict[str, str] = {}  # lowered → first-seen original name
    for case in cases:
        for name in _split_judges(case.judges):
            key = name.lower()
            if key not in judge_display_name:
                judge_display_name[key] = name
            judge_cases[key].append(case)
            if case.court_code:
                judge_court_counts[key][case.court_code] += 1

    rows = []
    for key, jc in judge_cases.items():
        display_name = judge_display_name[key]
        profile = _judge_profile_payload(display_name, jc, include_recent_cases=False)
        top_visa_subclasses = [
            {"subclass": item["subclass"], "count": item["total"]}
            for item in profile["visa_breakdown"][:3]
        ]
        primary_court = None
        if judge_court_counts[key]:
            primary_court = judge_court_counts[key].most_common(1)[0][0]

        rows.append(
            {
                "name": display_name,
                "total_cases": profile["judge"]["total_cases"],
                "approval_rate": profile["approval_rate"],
                "courts": profile["judge"]["courts"],
                "primary_court": primary_court,
                "top_visa_subclasses": top_visa_subclasses,
                "active_years": profile["judge"]["active_years"],
                "outcome_summary": profile["outcome_distribution"],
            }
        )

    if sort_by == "approval_rate":
        rows.sort(key=lambda row: (row["approval_rate"], row["total_cases"]), reverse=True)
    elif sort_by == "name":
        rows.sort(key=lambda row: row["name"].lower())
    else:
        rows.sort(key=lambda row: (row["total_cases"], row["approval_rate"]), reverse=True)

    total_judges = len(rows)
    return jsonify({"judges": rows[:limit], "total_judges": total_judges})


@api_bp.route("/analytics/judge-profile")
def analytics_judge_profile():
    """Deep profile for a single judge/member."""
    name = request.args.get("name", "").strip()
    if not name:
        return _error("name query parameter is required")

    cases = _apply_filters(_get_all_cases())
    # Normalize the query name (strips titles like "Justice", "Member") for matching,
    # but keep the original name for display in the response.
    normalized_query = _normalise_judge_name(name).lower()
    match_names = {name.lower(), normalized_query} - {""}
    judge_cases = [
        c
        for c in cases
        if match_names & {j.lower() for j in _split_judges(c.judges)}
    ]

    # Compute court-wide approval rates for comparison
    judge_court_codes = {c.court_code for c in judge_cases if c.court_code}
    court_baselines: dict[str, float] = {}
    for court_code in judge_court_codes:
        court_cases = [c for c in cases if c.court_code == court_code]
        if court_cases:
            cw = sum(
                1
                for c in court_cases
                if _is_win(_normalise_outcome(c.outcome), court_code)
            )
            court_baselines[court_code] = _round_rate(cw, len(court_cases))

    payload = _judge_profile_payload(
        name, judge_cases, include_recent_cases=True, court_baselines=court_baselines
    )
    return jsonify(payload)


@api_bp.route("/analytics/judge-compare")
def analytics_judge_compare():
    """Compare 2-4 judges side-by-side."""
    raw_names = request.args.get("names", "")
    names = []
    for part in raw_names.split(","):
        name = part.strip()
        if name and name not in names:
            names.append(name)

    if len(names) < 2:
        return _error("At least two judge names are required")

    names = names[:4]
    cases = _apply_filters(_get_all_cases())

    profiles = []
    for name in names:
        normalized_query = _normalise_judge_name(name).lower()
        match_names = {name.lower(), normalized_query} - {""}
        judge_cases = [
            c
            for c in cases
            if match_names & {j.lower() for j in _split_judges(c.judges)}
        ]
        profiles.append(
            _judge_profile_payload(name, judge_cases, include_recent_cases=False)
        )

    return jsonify({"judges": profiles})


@api_bp.route("/analytics/concept-effectiveness")
def analytics_concept_effectiveness():
    """Per-concept win-rate and lift vs baseline."""
    limit = safe_int(request.args.get("limit"), default=30, min_val=1, max_val=100)
    cases = _apply_filters(_get_all_cases())

    baseline_wins = 0
    concept_totals: Counter = Counter()
    concept_wins: Counter = Counter()
    by_court_totals: dict[str, Counter] = defaultdict(Counter)
    by_court_wins: dict[str, Counter] = defaultdict(Counter)

    for case in cases:
        norm = _normalise_outcome(case.outcome)
        won = _is_win(norm, case.court_code)
        if won:
            baseline_wins += 1
        concepts = set(_split_concepts(case.legal_concepts))
        for concept in concepts:
            concept_totals[concept] += 1
            if won:
                concept_wins[concept] += 1
            if case.court_code:
                by_court_totals[concept][case.court_code] += 1
                if won:
                    by_court_wins[concept][case.court_code] += 1

    baseline_rate = _round_rate(baseline_wins, len(cases))
    concepts = []
    for concept, total in concept_totals.most_common(limit):
        win_rate = _round_rate(concept_wins[concept], total)
        court_breakdown = {}
        for court_code, court_total in by_court_totals[concept].items():
            court_breakdown[court_code] = {
                "total": court_total,
                "win_rate": _round_rate(by_court_wins[concept][court_code], court_total),
            }
        concepts.append(
            {
                "name": concept,
                "total": total,
                "win_rate": win_rate,
                "lift": round((win_rate / baseline_rate), 2) if baseline_rate > 0 else 0.0,
                "by_court": court_breakdown,
            }
        )

    return jsonify({"baseline_rate": baseline_rate, "concepts": concepts})


@api_bp.route("/analytics/concept-cooccurrence")
def analytics_concept_cooccurrence():
    """Concept co-occurrence matrix and top pairs."""
    limit = safe_int(request.args.get("limit"), default=15, min_val=2, max_val=30)
    min_count = safe_int(request.args.get("min_count"), default=50, min_val=1, max_val=1000000)
    cases = _apply_filters(_get_all_cases())

    concept_frequency: Counter = Counter()
    baseline_wins = 0
    for case in cases:
        concepts = set(_split_concepts(case.legal_concepts))
        for concept in concepts:
            concept_frequency[concept] += 1
        if _is_win(_normalise_outcome(case.outcome), case.court_code):
            baseline_wins += 1

    top_concepts = [name for name, _ in concept_frequency.most_common(limit)]
    top_set = set(top_concepts)

    pair_totals: Counter = Counter()
    pair_wins: Counter = Counter()
    for case in cases:
        concepts = sorted(set(_split_concepts(case.legal_concepts)).intersection(top_set))
        if len(concepts) < 2:
            continue
        won = _is_win(_normalise_outcome(case.outcome), case.court_code)
        for a, b in combinations(concepts, 2):
            pair = (a, b)
            pair_totals[pair] += 1
            if won:
                pair_wins[pair] += 1

    baseline_rate = _round_rate(baseline_wins, len(cases))
    matrix: dict[str, dict[str, dict[str, float | int]]] = defaultdict(dict)
    top_pairs = []
    for pair, count in pair_totals.items():
        if count < min_count:
            continue
        a, b = pair
        win_rate = _round_rate(pair_wins[pair], count)
        cell = {"count": count, "win_rate": win_rate}
        matrix[a][b] = cell
        matrix[b][a] = cell
        top_pairs.append(
            {
                "a": a,
                "b": b,
                "count": count,
                "win_rate": win_rate,
                "lift": round((win_rate / baseline_rate), 2) if baseline_rate > 0 else 0.0,
            }
        )

    top_pairs.sort(key=lambda item: item["count"], reverse=True)
    return jsonify(
        {
            "concepts": top_concepts,
            "matrix": dict(matrix),
            "top_pairs": top_pairs,
        }
    )


@api_bp.route("/analytics/concept-trends")
def analytics_concept_trends():
    """Time-series concept usage + emerging/declining concepts."""
    limit = safe_int(request.args.get("limit"), default=10, min_val=1, max_val=30)
    cases = _apply_filters(_get_all_cases())

    # Single-pass: collect frequency + per-concept year totals/wins
    concept_frequency: Counter = Counter()
    concept_year_totals: dict[str, Counter] = defaultdict(Counter)
    concept_year_wins: dict[str, Counter] = defaultdict(Counter)
    all_years_set: set[int] = set()

    for case in cases:
        concepts = set(_split_concepts(case.legal_concepts))
        won = _is_win(_normalise_outcome(case.outcome), case.court_code) if concepts else False
        for concept in concepts:
            concept_frequency[concept] += 1
            if case.year:
                all_years_set.add(case.year)
                concept_year_totals[concept][case.year] += 1
                if won:
                    concept_year_wins[concept][case.year] += 1

    tracked = [name for name, _ in concept_frequency.most_common(limit)]
    all_years = sorted(all_years_set)

    series = {}
    emerging = []
    declining = []
    latest_year = max(all_years) if all_years else 0
    recent_years = {latest_year, latest_year - 1}
    previous_years = {latest_year - 2, latest_year - 3}

    for concept in tracked:
        year_totals = concept_year_totals[concept]
        year_wins = concept_year_wins[concept]

        concept_points = [
            {
                "year": year,
                "count": year_totals[year],
                "win_rate": _round_rate(year_wins[year], year_totals[year]),
            }
            for year in sorted(year_totals.keys())
        ]
        if concept_points:
            series[concept] = concept_points

        recent_count = sum(year_totals[y] for y in recent_years)
        previous_count = sum(year_totals[y] for y in previous_years)
        if recent_count == 0 and previous_count == 0:
            continue

        if previous_count == 0 and recent_count > 0:
            growth_pct = 100.0
        elif previous_count == 0:
            growth_pct = 0.0
        else:
            growth_pct = round(((recent_count - previous_count) / previous_count) * 100.0, 1)

        if growth_pct > 25:
            emerging.append(
                {
                    "name": concept,
                    "growth_pct": growth_pct,
                    "recent_count": recent_count,
                }
            )
        elif growth_pct < -25:
            declining.append(
                {
                    "name": concept,
                    "decline_pct": growth_pct,
                    "recent_count": recent_count,
                }
            )

    emerging.sort(key=lambda item: item["growth_pct"], reverse=True)
    declining.sort(key=lambda item: item["decline_pct"])

    return jsonify(
        {
            "series": series,
            "emerging": emerging,
            "declining": declining,
        }
    )


# ── Flow Matrix (Sankey) ──────────────────────────────────────────────


@api_bp.route("/analytics/flow-matrix")
def analytics_flow_matrix():
    """Three-layer flow: Court → Case Nature → Outcome (for Sankey diagrams)."""
    cases = _apply_filters(_get_all_cases())
    top_n = safe_int(request.args.get("top_n"), default=8, min_val=1, max_val=20)

    # Count case natures and outcomes to pick top-N
    nature_counter: Counter = Counter()
    outcome_counter: Counter = Counter()
    for c in cases:
        nature = (c.case_nature or "").strip() or "Unknown"
        outcome = _normalise_outcome(c.outcome)
        nature_counter[nature] += 1
        outcome_counter[outcome] += 1

    top_natures = {n for n, _ in nature_counter.most_common(top_n)}
    top_outcomes = {o for o, _ in outcome_counter.most_common(top_n)}

    # Build link counts: court→nature and nature→outcome
    court_nature: dict[tuple[str, str], int] = defaultdict(int)
    nature_outcome: dict[tuple[str, str], int] = defaultdict(int)

    for c in cases:
        court = c.court_code or "Unknown"
        nature = (c.case_nature or "").strip() or "Unknown"
        outcome = _normalise_outcome(c.outcome)

        # Collapse minor categories into "Other"
        if nature not in top_natures:
            nature = "Other Nature"
        if outcome not in top_outcomes:
            outcome = "Other"

        court_nature[(court, nature)] += 1
        nature_outcome[(nature, outcome)] += 1

    # Collect unique node names by layer
    court_names = sorted({k[0] for k in court_nature})
    nature_names = sorted({k[1] for k in court_nature} | {k[0] for k in nature_outcome})
    outcome_names = sorted({k[1] for k in nature_outcome})

    # Build nodes list with layer info
    nodes: list[dict] = []
    node_index: dict[str, int] = {}

    for name in court_names:
        node_index[f"court:{name}"] = len(nodes)
        nodes.append({"name": name, "layer": "court"})
    for name in nature_names:
        node_index[f"nature:{name}"] = len(nodes)
        nodes.append({"name": name, "layer": "nature"})
    for name in outcome_names:
        node_index[f"outcome:{name}"] = len(nodes)
        nodes.append({"name": name, "layer": "outcome"})

    # Build links with source/target as node indices
    links: list[dict] = []
    for (court, nature), value in sorted(court_nature.items()):
        src = node_index.get(f"court:{court}")
        tgt = node_index.get(f"nature:{nature}")
        if src is not None and tgt is not None:
            links.append({"source": src, "target": tgt, "value": value})

    for (nature, outcome), value in sorted(nature_outcome.items()):
        src = node_index.get(f"nature:{nature}")
        tgt = node_index.get(f"outcome:{outcome}")
        if src is not None and tgt is not None:
            links.append({"source": src, "target": tgt, "value": value})

    return jsonify({"nodes": nodes, "links": links})


# ── Monthly Trends ─────────────────────────────────────────────────────

# Key Australian immigration system events for timeline markers
_POLICY_EVENTS = [
    {"month": "2015-07", "label": "RRTA/MRTA merged into AATA"},
    {"month": "2021-09", "label": "FCCA → FedCFamC2G restructure"},
    {"month": "2024-10", "label": "AATA → ARTA transition"},
]


@api_bp.route("/analytics/monthly-trends")
def analytics_monthly_trends():
    """Monthly case volume and win-rate time series with policy event markers."""
    cases = _apply_filters(_get_all_cases())

    monthly: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "wins": 0})

    for c in cases:
        if not c.date:
            continue
        # Extract YYYY-MM from date string
        month_key = c.date[:7] if len(c.date) >= 7 else None
        if not month_key or len(month_key) != 7:
            continue
        bucket = monthly[month_key]
        bucket["total"] += 1
        norm = _normalise_outcome(c.outcome)
        court_type = "tribunal" if (c.court_code or "") in TRIBUNAL_CODES else "court"
        if court_type == "tribunal":
            if norm in ("Remitted", "Set Aside"):
                bucket["wins"] += 1
        else:
            if norm in ("Allowed", "Set Aside"):
                bucket["wins"] += 1

    series = []
    for month_key in sorted(monthly.keys()):
        bucket = monthly[month_key]
        total = bucket["total"]
        wins = bucket["wins"]
        rate = round(wins / total * 100, 1) if total > 0 else 0
        series.append({"month": month_key, "total": total, "wins": wins, "win_rate": rate})

    return jsonify({"series": series, "events": _POLICY_EVENTS})


# ── Judge Bio ──────────────────────────────────────────────────────────

@api_bp.route("/analytics/judge-bio")
def analytics_judge_bio():
    """Lookup pre-fetched biographical data for a judge/member."""
    name = request.args.get("name", "").strip()
    if not name:
        return _error("name is required")
    bio_path = os.path.join(get_output_dir(), "judge_bios.json")
    if not os.path.exists(bio_path):
        return jsonify({"found": False})
    with open(bio_path, encoding="utf-8") as f:
        bios = json.load(f)
    bio = bios.get(name.lower())
    if not bio:
        return jsonify({"found": False})
    return jsonify({"found": True, **bio})


# ── Visa Registry ──────────────────────────────────────────────────────

@api_bp.route("/visa-registry")
def visa_registry():
    """Return the full visa registry (entries + families) for frontend caching."""
    return jsonify(get_registry_for_api())


# ── Taxonomy Endpoints ─────────────────────────────────────────────────────

@api_bp.route("/taxonomy/visa-lookup")
def taxonomy_visa_lookup():
    """Quick-lookup visa subclasses by code or name with case counts.

    Query parameters:
      q     (str, required, min 1 char) — searches subclass code or visa name
      limit (int, default 20, max 50)   — max results to return

    Returns:
      {
        "success": true,
        "data": [
          {
            "subclass": "866",
            "name": "Protection",
            "family": "Protection",
            "case_count": 12543
          },
          ...
        ],
        "meta": {
          "query": "866",
          "total_results": 1,
          "limit": 20
        }
      }
    """
    try:
        query = request.args.get("q", "").strip()
        limit = min(request.args.get("limit", 20, type=int), 50)

        if not query:
            return jsonify({"success": False, "error": "q parameter is required"}), 400
        if limit < 1:
            return jsonify({"success": False, "error": "limit must be >= 1"}), 400

        # Get all cases and count by visa subclass
        cases = _get_all_cases()
        visa_counts: dict[str, int] = Counter()
        for c in cases:
            cleaned = _clean_visa(c.visa_subclass)
            if cleaned:
                visa_counts[cleaned] += 1

        # Search registry
        q_lower = query.lower()
        q_is_numeric = query.isdigit()

        results = []
        total_matched = 0

        for subclass in sorted(VISA_REGISTRY.keys(), key=lambda x: x.zfill(4)):
            name, family = VISA_REGISTRY[subclass]

            # Match logic:
            # 1. If query is numeric: match subclass prefix (e.g., "86" matches "866")
            # 2. If query is text: match visa name (case-insensitive partial)
            matched = False
            is_exact = False

            if q_is_numeric:
                if subclass == query:
                    matched = True
                    is_exact = True
                elif subclass.startswith(query):
                    matched = True
            else:
                if q_lower in name.lower():
                    matched = True
                    if q_lower == name.lower():
                        is_exact = True

            if matched:
                total_matched += 1
                if len(results) < limit:
                    results.append({
                        "subclass": subclass,
                        "name": name,
                        "family": family,
                        "case_count": visa_counts.get(subclass, 0),
                        "_exact": is_exact,  # For sorting, will be removed
                    })

        # Sort: exact matches first, then by case count descending
        results.sort(key=lambda x: (not x["_exact"], -x["case_count"]))

        # Remove internal sorting flag
        for r in results:
            r.pop("_exact", None)

        return jsonify({
            "success": True,
            "data": results,
            "meta": {
                "query": query,
                "total_results": total_matched,
                "limit": limit,
            },
        })

    except Exception as e:
        logger.error(f"Error in visa-lookup: {e}")
        return jsonify({"success": False, "error": "Failed to lookup visa subclasses"}), 500


@api_bp.route("/taxonomy/legal-concepts")
def taxonomy_legal_concepts():
    """Get all 34 canonical legal concepts with case counts.

    Returns all legal concepts defined in the registry, annotated with
    case counts for each. Used by frontend taxonomy browser for filtering.

    Returns:
      {
        "success": true,
        "concepts": [
          {
            "id": "procedural-fairness",
            "name": "Procedural Fairness",
            "description": "Natural justice, right to be heard, bias",
            "keywords": ["natural justice", "procedural fairness", ...],
            "case_count": 12543
          },
          ...
        ],
        "meta": {
          "total_concepts": 34
        }
      }
    """
    try:
        # Import legal concepts registry
        from ...legal_concepts_registry import get_concepts_for_api

        # Get all cases and count by concept
        cases = _get_all_cases()
        concept_counts: dict[str, int] = Counter()

        for c in cases:
            for concept in _split_concepts(c.legal_concepts):
                concept_counts[concept] += 1

        # Get all canonical concepts and annotate with counts
        concepts = get_concepts_for_api()
        results = []

        for concept in concepts:
            results.append({
                "id": concept["id"],
                "name": concept["name"],
                "description": concept["description"],
                "keywords": concept["keywords"],
                "case_count": concept_counts.get(concept["name"], 0),
            })

        # Sort by case count descending (most popular first)
        results.sort(key=lambda x: -x["case_count"])

        return jsonify({
            "success": True,
            "concepts": results,
            "meta": {
                "total_concepts": len(results),
            },
        })

    except Exception as e:
        logger.error(f"Error in legal-concepts: {e}")
        return jsonify({"success": False, "error": "Failed to retrieve legal concepts"}), 500


@api_bp.route("/taxonomy/judges/autocomplete")
def taxonomy_judges_autocomplete():
    """Autocomplete judge names with case counts.

    Query parameters:
      q     (str, required, min 2 chars) — searches judge name (case-insensitive)
      limit (int, default 20, max 50)    — max results to return

    Returns:
      {
        "success": true,
        "data": [
          {
            "name": "Smith",
            "case_count": 543
          },
          ...
        ],
        "meta": {
          "query": "sm",
          "total_results": 12,
          "limit": 20
        }
      }
    """
    try:
        query = request.args.get("q", "").strip()
        limit = min(request.args.get("limit", 20, type=int), 50)

        if not query:
            return jsonify({"success": False, "error": "q parameter is required"}), 400
        if len(query) < 2:
            return jsonify({"success": False, "error": "query must be at least 2 characters"}), 400
        if limit < 1:
            return jsonify({"success": False, "error": "limit must be >= 1"}), 400

        # Get all cases and count by judge name
        cases = _get_all_cases()
        judge_counts: dict[str, int] = Counter()

        for c in cases:
            for judge in _split_judges(c.judges or ""):
                judge_counts[judge] += 1

        # Filter judges matching query (case-insensitive partial match)
        q_lower = query.lower()
        results = []
        total_matched = 0

        for judge_name in sorted(judge_counts.keys()):
            if q_lower in judge_name.lower():
                total_matched += 1
                if len(results) < limit:
                    results.append({
                        "name": judge_name,
                        "case_count": judge_counts[judge_name],
                    })

        # Sort by case count descending (most active judges first)
        results.sort(key=lambda x: -x["case_count"])

        return jsonify({
            "success": True,
            "data": results,
            "meta": {
                "query": query,
                "total_results": total_matched,
                "limit": limit,
            },
        })

    except Exception as e:
        logger.error(f"Error in judges-autocomplete: {e}")
        return jsonify({"success": False, "error": "Failed to autocomplete judge names"}), 500


@api_bp.route("/taxonomy/countries")
def taxonomy_countries():
    """Get all countries of origin with case counts.

    Returns all countries found in case records, sorted by case count descending.
    Used by frontend for country filter dropdown.

    Returns:
      {
        "success": true,
        "countries": [
          {
            "name": "China",
            "case_count": 12543
          },
          ...
        ],
        "meta": {
          "total_countries": 89
        }
      }
    """
    try:
        # Get all cases and count by country
        cases = _get_all_cases()
        country_counts: dict[str, int] = Counter()

        for c in cases:
            country = (c.country_of_origin or "").strip()
            if country:
                country_counts[country] += 1

        # Build results sorted by case count descending
        results = [
            {
                "name": country,
                "case_count": count,
            }
            for country, count in sorted(
                country_counts.items(),
                key=lambda x: x[1],
                reverse=True
            )
        ]

        return jsonify({
            "success": True,
            "countries": results,
            "meta": {
                "total_countries": len(results),
            },
        })

    except Exception as e:
        logger.error(f"Error in taxonomy/countries: {e}")
        return jsonify({"success": False, "error": "Failed to retrieve countries"}), 500


@api_bp.route("/taxonomy/guided-search", methods=["POST"])
def taxonomy_guided_search():
    """Multi-step guided search flow for common research tasks.

    Accepts POST body with flow type and filter parameters.

    Supported flows:
      - "find-precedents": Filter cases by visa_subclass, country, legal_concepts
      - "assess-judge": Return judge profile link and basic stats

    Request body (find-precedents):
      {
        "flow": "find-precedents",
        "visa_subclass": "866",
        "country": "Afghanistan",
        "legal_concepts": ["Refugee Status", "Well-Founded Fear"],
        "limit": 50
      }

    Request body (assess-judge):
      {
        "flow": "assess-judge",
        "judge_name": "Smith"
      }

    Returns (find-precedents):
      {
        "success": true,
        "flow": "find-precedents",
        "results": [...],
        "meta": {
          "total_results": 123,
          "returned_results": 50,
          "filters_applied": {...},
          "limit": 50
        }
      }

    Returns (assess-judge):
      {
        "success": true,
        "flow": "assess-judge",
        "judge_name": "Smith",
        "profile_url": "/judges/Smith",
        "meta": {
          "total_cases": 543
        }
      }
    """
    try:
        data = request.get_json(silent=True) or {}
        flow = data.get("flow", "")

        if not flow:
            return jsonify({"success": False, "error": "Flow type is required"}), 400

        if flow not in ["find-precedents", "assess-judge"]:
            return jsonify({"success": False, "error": "Invalid flow type"}), 400

        if flow == "find-precedents":
            # Get all cases and apply taxonomy-specific filters
            cases = _get_all_cases()
            filters_applied = {}

            # Filter by visa subclass
            visa_subclass = data.get("visa_subclass", "").strip()
            if visa_subclass:
                cases = [c for c in cases if c.visa_subclass and visa_subclass in c.visa_subclass]
                filters_applied["visa_subclass"] = visa_subclass

            # Filter by country of origin
            country = data.get("country", "").strip()
            if country:
                cases = [c for c in cases if c.country_of_origin and country.lower() in c.country_of_origin.lower()]
                filters_applied["country"] = country

            # Filter by legal concepts (can be string or list)
            legal_concepts = data.get("legal_concepts")
            if legal_concepts:
                if isinstance(legal_concepts, str):
                    legal_concepts = [legal_concepts]
                if isinstance(legal_concepts, list) and legal_concepts:
                    # Filter cases that contain ANY of the specified concepts
                    filtered = []
                    for c in cases:
                        case_concepts = _split_concepts(c.legal_concepts)
                        if any(concept in case_concepts for concept in legal_concepts):
                            filtered.append(c)
                    cases = filtered
                    filters_applied["legal_concepts"] = legal_concepts

            # Limit results to avoid overwhelming response
            limit = safe_int(data.get("limit"), default=DEFAULT_SEARCH_LIMIT, min_val=1, max_val=MAX_SEARCH_LIMIT)
            total_results = len(cases)
            cases = cases[:limit]

            return jsonify({
                "success": True,
                "flow": "find-precedents",
                "results": [c.to_dict() for c in cases],
                "meta": {
                    "total_results": total_results,
                    "returned_results": len(cases),
                    "filters_applied": filters_applied,
                    "limit": limit,
                },
            })

        elif flow == "assess-judge":
            judge_name = data.get("judge_name", "").strip()
            if not judge_name:
                return jsonify({"success": False, "error": "Judge name is required for assess-judge flow"}), 400

            # Normalise judge name
            normalised_name = _normalise_judge_name(judge_name)
            if not normalised_name:
                return jsonify({"success": False, "error": "Invalid judge name"}), 400

            # Get basic judge stats
            cases = _get_all_cases()
            judge_cases = []

            for c in cases:
                judge_names = _split_judges(c.judges)
                # Case-insensitive partial match
                if any(normalised_name.lower() in jname.lower() for jname in judge_names):
                    judge_cases.append(c)

            return jsonify({
                "success": True,
                "flow": "assess-judge",
                "judge_name": normalised_name,
                "profile_url": f"/judges/{normalised_name}",
                "meta": {
                    "total_cases": len(judge_cases),
                },
            })

    except Exception as e:
        logger.error(f"Error in taxonomy/guided-search: {e}")
        return jsonify({"success": False, "error": "Failed to process guided search"}), 500


@api_bp.route("/analytics/visa-families")
def analytics_visa_families():
    """Case counts and win rates aggregated by visa family."""
    cases = _apply_filters(_get_all_cases())

    family_totals: dict[str, int] = Counter()
    family_wins: dict[str, int] = Counter()

    for c in cases:
        cleaned = _clean_visa(c.visa_subclass)
        if not cleaned:
            continue
        family = get_family(cleaned)
        family_totals[family] += 1
        norm = _normalise_outcome(c.outcome)
        if _is_win(norm, c.court_code or ""):
            family_wins[family] += 1

    families = []
    for name in sorted(family_totals, key=lambda k: family_totals[k], reverse=True):
        total = family_totals[name]
        wins = family_wins.get(name, 0)
        families.append({
            "family": name,
            "total": total,
            "win_count": wins,
            "win_rate": round(wins / total * 100, 1) if total else 0,
        })

    return jsonify({"families": families, "total_cases": len(cases)})


# ── Data Dictionary ─────────────────────────────────────────────────────

@api_bp.route("/data-dictionary")
def data_dictionary():
    return jsonify({"fields": DATA_DICTIONARY_FIELDS})
