"""JSON API endpoints for the React SPA frontend.

All endpoints are prefixed with /api/v1/.
"""

import os
import re
import json
import base64
import logging
import time
import threading
from pathlib import Path
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from itertools import combinations
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any

import numpy as np
from flask import Blueprint, request, jsonify, send_file, current_app, Response
from flask_wtf.csrf import generate_csrf

from ...config import START_YEAR, END_YEAR
from ...cases_pagination import (
    CaseListQuery,
    backend_kind_for_repo,
    choose_pagination_plan,
    remember_page_anchor,
)
from ...models import ImmigrationCase
from ...semantic_search_eval import (
    GeminiEmbeddingClient,
    OpenAIEmbeddingClient,
    reciprocal_rank_fusion,
)
from ...visa_registry import (
    clean_subclass,
    get_family,
    group_by_family,
    VISA_REGISTRY,
)
from ..cache import AnalyticsCache
from ..helpers import get_repo, get_output_dir, safe_int, EDITABLE_FIELDS, error_response as _error
from ..security import rate_limit
logger = logging.getLogger(__name__)

api_bp = Blueprint("api", __name__, url_prefix="/api/v1")


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
ALLOWED_SORT_FIELDS = frozenset({
    "date", "year", "title", "court", "citation", "outcome",
    "visa_subclass_number", "applicant_name", "hearing_date", "case_id",
})
ALLOWED_SORT_DIRS = frozenset({"asc", "desc"})
ALLOWED_COUNT_MODES = frozenset({"exact", "planned", "estimated"})
# RPC timeout — generous enough for cold-start (Supabase free-tier wakes from sleep in ~4-6s).
SUPABASE_RPC_TIMEOUT_SECONDS = 8.0
# Stats cache TTL — keep warm for 5 min so Supabase cold-start only hits once per session.
_STATS_CACHE_TTL_SECONDS = 300.0
CASE_LIST_COLUMNS = [
    "case_id",
    "citation",
    "title",
    "court_code",
    "date",
    "year",
    "judges",
    "outcome",
    "visa_type",
    "source",
    "tags",
    "case_nature",
    "visa_subclass",
    "visa_class_code",
    "applicant_name",
    "respondent",
    "country_of_origin",
    "visa_subclass_number",
    "hearing_date",
    "is_represented",
    "representative",
]

_rpc_executor = ThreadPoolExecutor(max_workers=2)
_stats_cache_lock = threading.Lock()
_stats_cache_payload: dict | None = None
_stats_cache_ts: float = 0.0
_ANALYTICS_CACHE_TTL_SECONDS = 600.0  # 10 min — pre-computed aggregates
_analytics_cache_obj = AnalyticsCache(ttl=_ANALYTICS_CACHE_TTL_SECONDS)
# Legacy aliases kept for _invalidate_cases_cache compatibility:
_analytics_cache: dict[str, tuple[dict, float]] = _analytics_cache_obj._store
_analytics_cache_lock = _analytics_cache_obj._lock



# ── HTTP Cache-Control helpers ────────────────────────────────────────

def _stats_response(payload: dict) -> "Response":
    """Return a JSON response with stats-appropriate Cache-Control headers."""
    resp = jsonify(payload)
    resp.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=60"
    return resp


def _analytics_response(payload: dict) -> "Response":
    """Return a JSON response with analytics-appropriate Cache-Control headers."""
    resp = jsonify(payload)
    resp.headers["Cache-Control"] = "public, max-age=600, stale-while-revalidate=120"
    return resp


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
    r"Judge\s+|"
    r"President\s+|Registrar\s+|"
    r"Mr\.?\s+|Mrs\.?\s+|Ms\.?\s+|Miss\s+|Dr\.?\s+|Prof\.?\s+)",
    re.IGNORECASE,
)

# Trailing legal abbreviations (e.g. "Smith J", "Brown CJ", "White FM")
_JUDGE_SUFFIX_RE = re.compile(
    r"\s+(?:J|CJ|ACJ|FM|AM|DCJ|JA|RFM|SM|DP|P|SC|KC|QC|AO|AC|OAM|PSM)\b\.?$",
    re.IGNORECASE,
)

# Words that disqualify an entry as a real person's name
_NAME_DISQUALIFIERS = frozenset({
    "the", "of", "in", "for", "at", "on", "by", "to", "with", "and", "or",
    "a", "an", "this", "that", "was", "were", "which", "where", "when",
    "tribunal", "court", "department", "minister", "registry", "review",
    "applicant", "respondent", "appellant", "migration", "australia",
    "held", "error", "errors", "finding", "findings", "reason", "reasons",
    "dismissed", "dismiss", "allowed", "allow", "granted", "grant",
    "refused", "refuse", "rejected", "reject", "affirmed", "affirm",
    "remitted", "remit", "quashed", "quash", "set", "aside", "decision",
    "order", "orders", "hearing", "judgment", "judgement", "appeal",
    "application", "visa",
})


def _parse_case_date(date_str: "str | None") -> "datetime | None":
    """Parse 'DD Month YYYY' date string to datetime. Returns None for invalid input."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str.strip(), "%d %B %Y")
    except (ValueError, TypeError):
        return None


def _extract_month_key(date_str: "str | None") -> "str | None":
    """Extract 'YYYY-MM' from 'DD Month YYYY' date string. Returns None if unparseable."""
    parsed = _parse_case_date(date_str)
    return parsed.strftime("%Y-%m") if parsed else None


def _is_real_judge_name(name: str) -> bool:
    """Return True only if name looks like an actual person's name."""
    words = name.split()
    # Allow longer forms for full names with titles/nicknames/post-nominals.
    if not words or len(words) > 8:
        return False
    if any(not re.fullmatch(r"[A-Za-z][A-Za-z'.-]*\.?", w) for w in words):
        return False

    lowered_words = [w.lower().strip(".") for w in words]
    if any(w in _NAME_DISQUALIFIERS for w in lowered_words):
        return False
    if all(w in _NAME_DISQUALIFIERS for w in lowered_words):
        return False

    # Single-token entries are usually surnames; reject overly short fragments.
    if len(words) == 1 and len(words[0].strip(".")) < 3:
        return False

    # Must contain at least one non-initial token.
    if not any(len(w.strip(".")) > 1 for w in words):
        return False

    # All words must not be disqualifiers
    # Must contain at least one word that starts with a capital letter.
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
    # Remove bracket artifacts and non-name punctuation from noisy OCR/text extractions.
    name = re.sub(r"[\(\)\[\]\{\}]", " ", name)
    # Remove quoted nicknames: "'Sandy'" -> "Sandy"
    name = re.sub(r"(?<![A-Za-z])[‘’']([A-Za-z]+)[‘’'](?![A-Za-z])", r"\1", name)
    name = re.sub(r"[^A-Za-z'.\-\s]", " ", name)
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


@lru_cache(maxsize=1)
def _load_judge_bios() -> dict[str, dict]:
    """Load judge biography map from disk once per process."""
    bio_path = os.path.join(get_output_dir(), "judge_bios.json")
    if not os.path.exists(bio_path):
        return {}
    try:
        with open(bio_path, encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        logger.warning("Failed to load judge_bios.json", exc_info=True)
        return {}

    if not isinstance(payload, dict):
        return {}

    bios: dict[str, dict] = {}
    for key, value in payload.items():
        if isinstance(key, str) and isinstance(value, dict):
            cleaned = key.strip().lower()
            if cleaned:
                bios[cleaned] = value
    return bios


@lru_cache(maxsize=1)
def _load_judge_name_overrides() -> dict[str, str]:
    """Load alias -> full-name overrides from output dir, fallback to packaged defaults."""
    package_default = (
        Path(__file__).resolve().parents[2] / "data" / "judge_name_overrides.json"
    )
    candidate_paths = [
        Path(get_output_dir()) / "judge_name_overrides.json",
        package_default,
    ]
    overrides: dict[str, str] = {}

    for path in candidate_paths:
        if not path.exists():
            continue
        try:
            with open(path, encoding="utf-8") as f:
                payload = json.load(f)
        except Exception:
            logger.warning("Failed to load %s", path, exc_info=True)
            continue

        if isinstance(payload, dict) and isinstance(payload.get("overrides"), dict):
            raw_map = payload["overrides"]
        elif isinstance(payload, dict):
            raw_map = payload
        else:
            continue

        for alias, value in raw_map.items():
            if not isinstance(alias, str) or not isinstance(value, str):
                continue
            alias_key = alias.strip().lower()
            full_name = re.sub(r"\s+", " ", value).strip()
            if not alias_key or not full_name:
                continue
            # First source wins (output-dir file takes precedence over packaged fallback).
            overrides.setdefault(alias_key, full_name)

    return overrides


def _judge_query_aliases(raw: str) -> set[str]:
    """Build robust match aliases (full name, normalized name, surname, initials)."""
    aliases: set[str] = set()
    raw_name = (raw or "").strip()
    if not raw_name:
        return aliases

    normalized = _normalise_judge_name(raw_name)
    for candidate in (raw_name, normalized):
        c = candidate.strip().lower()
        if c:
            aliases.add(c)

    tokens = [t.strip(".") for t in normalized.split() if t.strip(".")]
    if tokens:
        surname = tokens[-1].lower()
        aliases.add(surname)
        if len(tokens) >= 2:
            first_initial = tokens[0][0].lower()
            aliases.add(f"{first_initial} {surname}")
            aliases.add(f"{first_initial}. {surname}")

    return aliases


def _normalise_court_code(court_code: str | None) -> str:
    return (court_code or "").strip().upper()


def _normalise_year_value(year: int | str | None) -> int:
    try:
        value = int(str(year).strip())
    except (TypeError, ValueError):
        return 0
    return value if 1800 <= value <= 2200 else 0


def _resolve_contextual_judge_name(
    raw_clean: str,
    normalized: str,
    court_code: str,
    year: int,
) -> str:
    """Resolve ambiguous surname-only aliases using court/year context."""
    court = _normalise_court_code(court_code)
    norm_tokens = [t.lower() for t in re.findall(r"[A-Za-z]+", normalized)]
    raw_tokens = [t.lower() for t in re.findall(r"[A-Za-z]+", raw_clean)]
    if not norm_tokens:
        return ""

    surname = norm_tokens[-1]
    first_token = norm_tokens[0] if len(norm_tokens) > 1 else ""
    raw_first = raw_tokens[0] if raw_tokens else ""

    if "graham" in norm_tokens and "friedman" in norm_tokens:
        return "Graham Friedman"

    if surname == "graham":
        if court in COURT_CODES:
            return "Peter Ross Graham KC"
        if "ann" in norm_tokens:
            return "Ann Graham"
        if court == "MRTA" and len(norm_tokens) == 1:
            if year and year <= 2001:
                return "Graham Friedman"
            if year >= 2002:
                return "Ann Graham"

    if surname == "murphy":
        if court in COURT_CODES:
            return "Bernard Michael Murphy"
        if "alison" in norm_tokens or first_token == "a" or raw_first == "a":
            return "Member Alison Murphy"
        if "jade" in norm_tokens or first_token == "j" or raw_first == "j":
            return "Member Jade Murphy"
        if "peter" in norm_tokens or first_token == "p" or raw_first == "p":
            return "Member Peter Murphy"

    if surname == "downes":
        if "tegen" in norm_tokens or first_token == "t" or raw_first == "t":
            return "Tegen Downes"
        if court in COURT_CODES:
            if year and year >= 2021:
                return "Kylie Elizabeth Downes"
            if year and year <= 2012:
                return "Garry Keith Downes AM KC"
        if court in TRIBUNAL_CODES:
            if year and year >= 2022:
                return "Tegen Downes"
            if year and year <= 2012:
                return "Garry Keith Downes AM KC"

    return ""


def _resolve_judge_display_name(
    raw: str,
    court_code: str = "",
    year: int | str | None = None,
) -> str:
    """Prefer full name from bios when available, fallback to normalized short name."""
    raw_clean = re.sub(r"\s+", " ", (raw or "").strip())
    normalized = _normalise_judge_name(raw_clean)
    year_value = _normalise_year_value(year)
    if raw_clean:
        # Preserve user-visible labels (e.g. "Member Alpha"), but beautify all-lowercase input.
        fallback = raw_clean.title() if raw_clean.islower() else raw_clean
    else:
        fallback = normalized or ""
    aliases = _judge_query_aliases(raw)
    # Check most-specific aliases first (longer = more specific) to avoid
    # singleton surname matches overriding correct initial+surname matches.
    aliases_by_specificity = sorted(aliases, key=len, reverse=True)
    bios = _load_judge_bios()
    for alias in aliases_by_specificity:
        bio = bios.get(alias)
        if not bio:
            continue
        full_name = str(bio.get("full_name", "")).strip()
        if full_name:
            return full_name

    overrides = _load_judge_name_overrides()
    for alias in aliases_by_specificity:
        full_name = overrides.get(alias, "").strip()
        if full_name:
            return full_name

    contextual = _resolve_contextual_judge_name(
        raw_clean=raw_clean,
        normalized=normalized,
        court_code=court_code,
        year=year_value,
    )
    if contextual:
        return contextual

    return fallback


def _known_singleton_judge_names() -> set[str]:
    """Known one-word judge aliases from bios (e.g. street, driver)."""
    bios = _load_judge_bios()
    overrides = _load_judge_name_overrides()
    known = {k for k in bios.keys() if k.isalpha() and " " not in k}
    known.update(k for k in overrides.keys() if k.isalpha() and " " not in k)
    return known


@lru_cache(maxsize=32768)
def _judge_identity(
    raw: str,
    court_code: str = "",
    year: int | str | None = None,
) -> tuple[str, str]:
    """Return (canonical_name, display_name) for a judge alias."""
    raw_clean = re.sub(r"\s+", " ", (raw or "").strip())
    if not raw_clean:
        return "", ""
    display_name = _resolve_judge_display_name(raw_clean, court_code, year)
    canonical_name = display_name or raw_clean
    return canonical_name, display_name or raw_clean


def _collect_cases_for_judge(
    cases: list[ImmigrationCase],
    query_name: str,
) -> tuple[list[ImmigrationCase], str, str]:
    """Collect cases for a judge using strict canonical matching first, then loose alias fallback."""
    canonical_name, display_name = _judge_identity(query_name)
    canonical_name = canonical_name or (_normalise_judge_name(query_name) or query_name)
    display_name = display_name or canonical_name
    canonical_key = canonical_name.lower()

    strict_matches: list[ImmigrationCase] = []
    for case in cases:
        judge_names = _split_judges(case.judges)
        if any(
            _judge_identity(raw_name, case.court_code, case.year)[0].lower() == canonical_key
            for raw_name in judge_names
        ):
            strict_matches.append(case)

    if strict_matches:
        return strict_matches, canonical_name, display_name

    # Backward-compatible fallback for unknown aliases.
    match_names = _judge_query_aliases(query_name)
    loose_matches = [
        c
        for c in cases
        if any(match_names & _judge_query_aliases(j) for j in _split_judges(c.judges))
    ]
    return loose_matches, canonical_name, display_name


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
    known_singletons = _known_singleton_judge_names()
    for piece in re.split(r"[;,]", raw):
        raw_piece = piece.strip()
        if not raw_piece:
            continue

        had_title_or_suffix = bool(
            _JUDGE_TITLE_RE.search(raw_piece)
            or _JUDGE_SUFFIX_RE.search(raw_piece)
            or re.search(r"\b(?:J|CJ|ACJ|FM|AM|DCJ|JA|RFM|SM|DP|P)\b", raw_piece, re.IGNORECASE)
        )

        name = _normalise_judge_name(raw_piece)
        lowered = name.lower()
        is_singleton = len(name.split()) == 1
        if (
            not name
            or len(name) < 2
            or lowered in _JUDGE_BLOCKLIST
            or name.replace(" ", "").isdigit()
            or lowered in seen
            or not _is_real_judge_name(name)
            or (
                is_singleton
                and lowered not in known_singletons
                and not had_title_or_suffix
                and len(lowered) < 4
            )
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
_CACHE_TTL = 300.0  # 5 min — same as stats; analytics warmup keeps this fresh

# Separate lightweight cache for analytics endpoints (minimal 7 columns).
# ~4x faster to load than the full all-cases cache (13s vs 57s on free tier).
_analytics_cases_cache: list[ImmigrationCase] = []
_analytics_cases_ts: float = 0.0
_analytics_cases_lock = threading.Lock()
_ANALYTICS_CASES_TTL = 300.0


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
    """Reset all in-memory caches so the next read fetches fresh data.

    Clears the full-cases cache, the lightweight analytics-cases cache, and
    the pre-computed analytics results cache so CRUD mutations are immediately
    reflected across all endpoints (instead of serving stale data for up to
    10 minutes).
    """
    global _all_cases_ts, _analytics_cases_ts
    _all_cases_ts = 0.0
    _analytics_cases_ts = 0.0
    with _analytics_cache_lock:
        _analytics_cache.clear()


def _analytics_cache_key() -> str:
    """Build a stable cache key from the current request's sorted query args."""
    return str(sorted(request.args.items()))


def _analytics_get(key: str) -> dict | None:
    """Return cached analytics payload if still fresh, else None."""
    return _analytics_cache_obj.get(key)


def _analytics_set(key: str, payload: dict) -> None:
    """Store analytics payload in the cache."""
    _analytics_cache_obj.set(key, payload)


def _fill_all_cases_cache() -> None:
    """Pre-warm the all-cases in-memory cache.

    Call from a background thread after startup so the first analytics
    request is served from cache instead of triggering a 30-second
    Supabase paginated load.
    """
    global _all_cases_cache, _all_cases_ts
    try:
        repo = get_repo()
        cases = repo.load_all()
        with _all_cases_lock:
            _all_cases_cache = cases
            _all_cases_ts = time.time()
    except Exception as exc:
        logger.warning("Warmup failed in _fill_all_cases_cache: %s", exc)


def _get_analytics_cases() -> list[ImmigrationCase]:
    """Return analytics-optimised cases (7 cols, ~13s load) with 5-min cache.

    Uses load_analytics_cases() when available (Supabase backend) to fetch
    only the 7 columns needed for analytics aggregation, making the load
    ~4x faster than the full load_all() (13s vs 57s on free tier).
    """
    global _analytics_cases_cache, _analytics_cases_ts
    now = time.time()
    if _analytics_cases_cache and (now - _analytics_cases_ts) < _ANALYTICS_CASES_TTL:
        return _analytics_cases_cache
    with _analytics_cases_lock:
        if _analytics_cases_cache and (time.time() - _analytics_cases_ts) < _ANALYTICS_CASES_TTL:
            return _analytics_cases_cache
        repo = get_repo()
        if hasattr(repo, "load_analytics_cases"):
            _analytics_cases_cache = repo.load_analytics_cases()
        else:
            _analytics_cases_cache = repo.load_all()
        _analytics_cases_ts = time.time()
        return _analytics_cases_cache


def _fill_analytics_cases_cache() -> None:
    """Pre-warm the analytics cases cache at startup (background thread)."""
    global _analytics_cases_cache, _analytics_cases_ts
    try:
        repo = get_repo()
        if hasattr(repo, "load_analytics_cases"):
            cases = repo.load_analytics_cases()
        else:
            cases = repo.load_all()
        with _analytics_cases_lock:
            _analytics_cases_cache = cases
            _analytics_cases_ts = time.time()
    except Exception as exc:
        logger.warning("Warmup failed in _fill_analytics_cases_cache: %s", exc)


def _fill_analytics_cache(app) -> None:  # type: ignore[type-arg]
    """Pre-warm the computed analytics cache (4 main endpoints, no-filter case).

    Uses Flask's test client so all RPC-path / Python-fallback logic is reused
    without duplication. After this runs, the first real browser request for
    /analytics will be served instantly from _analytics_cache instead of waiting
    for a fresh Supabase RPC call (~2-5 s on free tier).
    """
    endpoints = [
        "/api/v1/analytics/outcomes",
        "/api/v1/analytics/judges",
        "/api/v1/analytics/legal-concepts",
        "/api/v1/analytics/nature-outcome",
        "/api/v1/analytics/judge-leaderboard",
    ]
    try:
        with app.test_client() as tc:
            for path in endpoints:
                try:
                    tc.get(path)
                except Exception as exc:
                    logger.warning("Analytics cache warmup failed for %s: %s", path, exc)
    except Exception as exc:
        logger.warning("Analytics cache warmup skipped: %s", exc)


def _clean_visa(raw: object) -> str:
    """Wrapper around clean_subclass for None/NaN-safe API usage."""
    return clean_subclass(raw)


def _has_analytics_filters() -> bool:
    """Return True if any analytics filter query param is present.

    Used to decide whether to take the fast Supabase RPC path (no filters)
    or the Python aggregation path (filters require loading cases locally).
    """
    return any(request.args.get(p) for p in (
        "court", "year_from", "year_to",
        "case_natures", "visa_subclasses", "visa_families", "outcome_types",
    ))


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



def _parse_court_year_trends_rows(trends_rows) -> tuple[dict[str, dict[int, int]], set[int], int]:
    """Normalise Supabase get_court_year_trends() rows to court/year aggregates."""
    court_year_counts: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    all_years: set[int] = set()
    total_cases = 0

    if not isinstance(trends_rows, list):
        return court_year_counts, all_years, total_cases

    for row in trends_rows:
        if not isinstance(row, dict):
            continue
        year = safe_int(row.get("year"), default=0, min_val=1900, max_val=END_YEAR + 5)
        if not year:
            continue
        all_years.add(year)
        for court_code, raw_count in row.items():
            if court_code == "year" or raw_count in (None, ""):
                continue
            try:
                count = int(raw_count)
            except (TypeError, ValueError):
                continue
            if count <= 0:
                continue
            code = str(court_code)
            court_year_counts[code][year] += count
            total_cases += count

    return court_year_counts, all_years, total_cases


def _call_with_timeout(
    func,
    timeout_seconds: float = SUPABASE_RPC_TIMEOUT_SECONDS,
    executor: ThreadPoolExecutor | None = None,
):
    """Execute a callable with timeout protection."""
    worker = executor or _rpc_executor
    future = worker.submit(func)
    return future.result(timeout=timeout_seconds)




def _empty_stats_payload(total_cases: int = 0, recent_cases: list | None = None) -> dict:
    """Create a safe minimal stats payload."""
    return {
        "total_cases": int(total_cases),
        "with_full_text": 0,
        "courts": {},
        "years": {},
        "natures": {},
        "visa_subclasses": {},
        "visa_families": {},
        "sources": {},
        "recent_cases": recent_cases or [],
    }


def _lightweight_stats_fallback(repo):
    """Return a lightweight stats payload that avoids expensive RPCs."""
    global _stats_cache_payload, _stats_cache_ts
    total_cases = 0
    if hasattr(repo, "count_cases"):
        try:
            total_cases = int(repo.count_cases(count_mode="planned"))
        except Exception:
            logger.warning("Fallback count_cases also failed", exc_info=True)

    recent = []
    try:
        if hasattr(repo, "list_cases_fast"):
            recent_cases = repo.list_cases_fast(
                sort_by="year",
                sort_dir="desc",
                page=1,
                page_size=5,
                columns=["case_id", "title", "citation", "court_code", "date", "outcome"],
            )
        else:
            recent_cases, _ = repo.filter_cases(
                sort_by="year",
                sort_dir="desc",
                page=1,
                page_size=5,
            )
        recent = [
            {
                "case_id": c.case_id,
                "title": c.title,
                "citation": c.citation,
                "court_code": c.court_code,
                "date": c.date,
                "outcome": c.outcome,
            }
            for c in recent_cases
        ]
    except Exception:
        logger.warning("Fallback recent cases query failed", exc_info=True)

    payload = _empty_stats_payload(total_cases=total_cases, recent_cases=recent)
    with _stats_cache_lock:
        _stats_cache_payload = payload
        _stats_cache_ts = time.time()
    return _stats_response(payload)


# ── CSRF ────────────────────────────────────────────────────────────────

@api_bp.route("/csrf-token")
@rate_limit(30, 60, scope="csrf-token")
def get_csrf_token():
    return jsonify({"csrf_token": generate_csrf()})



# ── Dashboard Stats ─────────────────────────────────────────────────────

@api_bp.route("/stats")
def stats():
    global _stats_cache_payload, _stats_cache_ts
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
            key=lambda c: _parse_case_date(c.date) or datetime.min,
            reverse=True,
        )[:5]
        recent = [
            {
                "case_id": c.case_id, "title": c.title, "citation": c.citation,
                "court_code": c.court_code, "date": c.date, "outcome": c.outcome,
            }
            for c in recent_sorted
        ]

        return _stats_response({
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
    with _stats_cache_lock:
        if _stats_cache_payload is not None and (time.time() - _stats_cache_ts) < _STATS_CACHE_TTL_SECONDS:
            return _stats_response(_stats_cache_payload)

    try:
        if hasattr(repo, "count_cases"):
            # Supabase RPCs can hang on overloaded projects; fail fast.
            s = _call_with_timeout(repo.get_statistics)
        else:
            s = repo.get_statistics()
    except FuturesTimeoutError:
        logger.warning("get_statistics timed out; returning lightweight fallback")
        with _stats_cache_lock:
            cached = _stats_cache_payload
        if cached is not None:
            return _stats_response(cached)
        payload = _empty_stats_payload()
        with _stats_cache_lock:
            _stats_cache_payload = payload
            _stats_cache_ts = time.time()
        return _stats_response(payload)
    except Exception:
        logger.warning("get_statistics failed; returning lightweight fallback", exc_info=True)
        return _lightweight_stats_fallback(repo)

    sources_dict = s.get("by_source", {})
    if not sources_dict:
        sources_dict = {src: 0 for src in s.get("sources", [])}

    recent = []
    try:
        if hasattr(repo, "list_cases_fast"):
            recent_cases = repo.list_cases_fast(
                sort_by="date",
                sort_dir="desc",
                page=1,
                page_size=5,
                columns=["case_id", "title", "citation", "court_code", "date", "outcome"],
            )
        else:
            recent_cases, _ = repo.filter_cases(
                sort_by="date",
                sort_dir="desc",
                page=1,
                page_size=5,
            )
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

    payload = {
        "total_cases": s.get("total", 0),
        "with_full_text": s.get("with_full_text", 0),
        "courts": s.get("by_court", {}),
        "years": s.get("by_year", {}),
        "natures": s.get("by_nature", {}),
        "visa_subclasses": cleaned_visa,
        "visa_families": group_by_family(raw_visa),
        "sources": sources_dict,
        "recent_cases": recent,
    }
    with _stats_cache_lock:
        _stats_cache_payload = payload
        _stats_cache_ts = time.time()
    return _stats_response(payload)


def _fill_stats_cache() -> None:
    """Pre-warm the stats cache. Call from a background thread after startup."""
    repo = get_repo()
    try:
        if hasattr(repo, "count_cases"):
            s = _call_with_timeout(repo.get_statistics, timeout_seconds=12.0)
        else:
            s = repo.get_statistics()
    except Exception:
        return  # silent — browser will fill the cache on first request

    sources_dict = s.get("by_source", {})
    if not sources_dict:
        sources_dict = {src: 0 for src in s.get("sources", [])}
    raw_visa = s.get("by_visa_subclass", {})
    cleaned_visa = {_clean_visa(k): v for k, v in raw_visa.items() if _clean_visa(k)}

    payload = {
        "total_cases": s.get("total", 0),
        "with_full_text": s.get("with_full_text", 0),
        "courts": s.get("by_court", {}),
        "years": s.get("by_year", {}),
        "natures": s.get("by_nature", {}),
        "visa_subclasses": cleaned_visa,
        "visa_families": group_by_family(raw_visa),
        "sources": sources_dict,
        "recent_cases": [],
    }
    with _stats_cache_lock:
        _stats_cache_payload = payload
        _stats_cache_ts = time.time()


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
                resp = _call_with_timeout(
                    lambda: repo._client.rpc("get_court_year_trends").execute()
                )
                return _stats_response({"trends": resp.data or []})
            except FuturesTimeoutError:
                logger.warning("Supabase RPC get_court_year_trends timed out; returning empty trends")
                return _stats_response({"trends": []})
            except Exception:
                logger.warning("Supabase RPC get_court_year_trends failed, falling back to local", exc_info=True)
                return _stats_response({"trends": []})

    all_cases = _apply_filters(_get_all_cases())

    year_court_counts: dict[int, dict[str, int]] = {}
    for c in all_cases:
        if c.year and c.court_code:
            if c.year not in year_court_counts:
                year_court_counts[c.year] = {}
            ycc = year_court_counts[c.year]
            ycc[c.court_code] = ycc.get(c.court_code, 0) + 1

    trends = [{"year": year, **year_court_counts[year]} for year in sorted(year_court_counts.keys())]

    return _stats_response({"trends": trends})


# ── Analytics ──────────────────────────────────────────────────────────

@api_bp.route("/analytics/filter-options")
def analytics_filter_options():
    """Context-aware advanced filter options for the analytics page.

    This endpoint intentionally scopes options by court/year only, so users can
    discover useful advanced filters without selecting values that immediately
    collapse to empty results.
    """
    court = request.args.get("court", "").strip()
    year_from = safe_int(request.args.get("year_from"), default=0, min_val=0, max_val=2100)
    year_to = safe_int(request.args.get("year_to"), default=0, min_val=0, max_val=2100)

    scoped_cases = _get_analytics_cases()
    if court:
        scoped_cases = [c for c in scoped_cases if c.court_code == court]
    if year_from:
        scoped_cases = [c for c in scoped_cases if c.year and c.year >= year_from]
    if year_to:
        scoped_cases = [c for c in scoped_cases if c.year and c.year <= year_to]

    nature_counts: Counter = Counter()
    nature_labels: dict[str, str] = {}
    subclass_counts: Counter = Counter()
    outcome_counts: Counter = Counter()

    for case in scoped_cases:
        case_nature = re.sub(r"\s+", " ", (case.case_nature or "").strip())
        if case_nature:
            key = case_nature.casefold()
            nature_counts[key] += 1
            nature_labels.setdefault(key, case_nature)

        cleaned_subclass = _clean_visa(case.visa_subclass)
        if cleaned_subclass:
            subclass_counts[cleaned_subclass] += 1

        outcome_counts[_normalise_outcome(case.outcome)] += 1

    case_natures = [
        {
            "value": nature_labels[key],
            "count": count,
        }
        for key, count in sorted(
            nature_counts.items(),
            key=lambda item: (-item[1], nature_labels[item[0]].lower()),
        )
    ][:60]

    visa_subclasses = []
    for subclass, count in sorted(
        subclass_counts.items(),
        key=lambda item: (-item[1], item[0].zfill(4)),
    )[:80]:
        registry_entry = VISA_REGISTRY.get(subclass)
        if registry_entry:
            visa_name, family = registry_entry
            label = f"{subclass} - {visa_name}"
        else:
            family = "Other"
            label = f"Subclass {subclass}"

        visa_subclasses.append(
            {
                "value": subclass,
                "label": label,
                "family": family,
                "count": count,
            }
        )

    outcome_types = [
        {
            "value": outcome,
            "count": count,
        }
        for outcome, count in sorted(
            outcome_counts.items(),
            key=lambda item: (-item[1], item[0].lower()),
        )
        if outcome
    ]

    return _analytics_response(
        {
            "query": {
                "court": court or None,
                "year_from": year_from or None,
                "year_to": year_to or None,
                "total_matching": len(scoped_cases),
            },
            "case_natures": case_natures,
            "visa_subclasses": visa_subclasses,
            "outcome_types": outcome_types,
        }
    )

@api_bp.route("/analytics/outcomes")
def analytics_outcomes():
    """Outcome rates by court, year, and visa subclass."""
    ck = "outcomes:" + _analytics_cache_key()
    cached = _analytics_get(ck)
    if cached is not None:
        return _analytics_response(cached)

    repo = get_repo()
    by_court: dict[str, dict[str, int]] = defaultdict(Counter)
    by_year: dict[str, dict[str, int]] = defaultdict(Counter)
    by_subclass: dict[str, dict[str, int]] = defaultdict(Counter)
    by_family: dict[str, dict[str, int]] = defaultdict(Counter)

    _rpc_ok = False
    if hasattr(repo, "get_analytics_outcomes") and not _has_analytics_filters():
        try:
            # Fast path: server-side SQL aggregation — Python only normalises
            # the small result set (~1500 rows) instead of 149k case objects.
            for r in _call_with_timeout(repo.get_analytics_outcomes):
                norm = _normalise_outcome(r["outcome"])
                cnt = int(r["cnt"])
                gt = r["group_type"]
                key = r["group_key"]
                if gt == "court":
                    by_court[key][norm] += cnt
                elif gt == "year":
                    by_year[key][norm] += cnt
                elif gt == "visa_subclass":
                    cleaned = _clean_visa(key)
                    if cleaned:
                        by_subclass[cleaned][norm] += cnt
                        by_family[get_family(cleaned)][norm] += cnt
            _rpc_ok = True
        except (FuturesTimeoutError, Exception):
            logger.warning("analytics_outcomes RPC failed/timed out, falling back to Python")
    if not _rpc_ok:
        # Fallback: load cases into Python, apply filters, aggregate locally.
        try:
            cases = _call_with_timeout(_get_analytics_cases, timeout_seconds=20.0)
            for c in _apply_filters(cases):
                norm = _normalise_outcome(c.outcome)
                if c.court_code:
                    by_court[c.court_code][norm] += 1
                if c.year:
                    by_year[str(c.year)][norm] += 1
                if c.visa_subclass:
                    cleaned = _clean_visa(c.visa_subclass)
                    if cleaned:
                        by_subclass[cleaned][norm] += 1
                        by_family[get_family(cleaned)][norm] += 1
        except (FuturesTimeoutError, Exception):
            logger.warning("analytics_outcomes fallback also timed out, returning empty result")

    result = {
        "by_court": {k: dict(v) for k, v in sorted(by_court.items())},
        "by_year": {k: dict(v) for k, v in sorted(by_year.items())},
        "by_subclass": {k: dict(v) for k, v in sorted(by_subclass.items(), key=lambda x: sum(x[1].values()), reverse=True)},
        "by_family": {k: dict(v) for k, v in sorted(by_family.items(), key=lambda x: sum(x[1].values()), reverse=True)},
    }
    _analytics_set(ck, result)
    return _analytics_response(result)


@api_bp.route("/analytics/judges")
def analytics_judges():
    """Top judges/members by case count."""
    ck = "judges:" + _analytics_cache_key()
    cached = _analytics_get(ck)
    if cached is not None:
        return _analytics_response(cached)

    limit = safe_int(request.args.get("limit"), default=20, min_val=1, max_val=100)
    judge_counter: Counter = Counter()
    judge_courts: dict[str, set[str]] = defaultdict(set)
    judge_display_name: dict[str, str] = {}
    judge_canonical_name: dict[str, str] = {}

    repo = get_repo()
    _rpc_ok = False
    if hasattr(repo, "get_analytics_judges_raw") and not _has_analytics_filters():
        try:
            # Fast path: RPC already split judge tokens server-side.
            # Each row is one pre-split name token (equiv. to _split_judges output).
            for r in _call_with_timeout(repo.get_analytics_judges_raw):
                raw_name = r["judge_raw"]
                court = r["court_code"] or ""
                cnt = int(r["cnt"])
                canonical_name, display_name = _judge_identity(raw_name, court)
                if not canonical_name:
                    continue
                key = canonical_name.lower()
                judge_counter[key] += cnt  # accumulate pre-aggregated counts
                judge_canonical_name.setdefault(key, canonical_name)
                judge_display_name.setdefault(key, display_name)
                if court:
                    judge_courts[key].add(court)
            _rpc_ok = True
        except (FuturesTimeoutError, Exception):
            logger.warning("analytics_judges RPC failed/timed out, falling back to Python")
    if not _rpc_ok:
        try:
            cases = _call_with_timeout(_get_analytics_cases, timeout_seconds=20.0)
            for c in _apply_filters(cases):
                for raw_name in _split_judges(c.judges):
                    canonical_name, display_name = _judge_identity(raw_name, c.court_code, c.year)
                    if not canonical_name:
                        continue
                    key = canonical_name.lower()
                    judge_counter[key] += 1
                    judge_canonical_name.setdefault(key, canonical_name)
                    judge_display_name.setdefault(key, display_name)
                    if c.court_code:
                        judge_courts[key].add(c.court_code)
        except (FuturesTimeoutError, Exception):
            logger.warning("analytics_judges fallback also timed out, returning empty result")

    judges = [
        {
            "name": judge_canonical_name[name_key],
            "display_name": judge_display_name.get(name_key, judge_canonical_name[name_key]),
            "count": count,
            "courts": sorted(judge_courts.get(name_key, set())),
        }
        for name_key, count in judge_counter.most_common(limit)
    ]

    result = {"judges": judges}
    _analytics_set(ck, result)
    return _analytics_response(result)


@api_bp.route("/analytics/legal-concepts")
def analytics_legal_concepts():
    """Top legal concepts by frequency."""
    ck = "legal-concepts:" + _analytics_cache_key()
    cached = _analytics_get(ck)
    if cached is not None:
        return _analytics_response(cached)

    limit = safe_int(request.args.get("limit"), default=20, min_val=1, max_val=100)
    concept_counter: Counter = Counter()

    repo = get_repo()
    _rpc_ok = False
    if hasattr(repo, "get_analytics_concepts_raw") and not _has_analytics_filters():
        try:
            # Fast path: RPC already split and counted concept tokens.
            # Each row is one canonical-mapped concept token.
            for r in _call_with_timeout(repo.get_analytics_concepts_raw):
                raw = (r["concept_raw"] or "").strip().lower()
                canonical = _CONCEPT_CANONICAL.get(raw)
                if canonical:
                    concept_counter[canonical] += int(r["cnt"])
            _rpc_ok = True
        except (FuturesTimeoutError, Exception):
            logger.warning("analytics_legal_concepts RPC failed/timed out, falling back to Python")
    if not _rpc_ok:
        try:
            cases = _call_with_timeout(_get_analytics_cases, timeout_seconds=20.0)
            for c in _apply_filters(cases):
                for concept in _split_concepts(c.legal_concepts):
                    concept_counter[concept] += 1
        except (FuturesTimeoutError, Exception):
            logger.warning("analytics_legal_concepts fallback also timed out, returning empty result")

    concepts = [
        {"name": name, "count": count}
        for name, count in concept_counter.most_common(limit)
    ]

    result = {"concepts": concepts}
    _analytics_set(ck, result)
    return _analytics_response(result)


@api_bp.route("/analytics/nature-outcome")
def analytics_nature_outcome():
    """Nature x Outcome cross-tabulation matrix."""
    ck = "nature-outcome:" + _analytics_cache_key()
    cached = _analytics_get(ck)
    if cached is not None:
        return _analytics_response(cached)

    nature_outcome: dict[str, dict[str, int]] = defaultdict(Counter)
    repo = get_repo()

    _rpc_ok = False
    if hasattr(repo, "get_analytics_nature_outcome") and not _has_analytics_filters():
        try:
            # Fast path: RPC returns (case_nature, outcome, cnt) — Python normalises.
            for r in _call_with_timeout(repo.get_analytics_nature_outcome):
                if not r["case_nature"]:
                    continue
                norm = _normalise_outcome(r["outcome"])
                nature_outcome[r["case_nature"]][norm] += int(r["cnt"])
            _rpc_ok = True
        except (FuturesTimeoutError, Exception):
            logger.warning("analytics_nature_outcome RPC failed/timed out, falling back to Python")
    if not _rpc_ok:
        try:
            cases = _call_with_timeout(_get_analytics_cases, timeout_seconds=20.0)
            for c in _apply_filters(cases):
                if not c.case_nature:
                    continue
                norm = _normalise_outcome(c.outcome)
                nature_outcome[c.case_nature][norm] += 1
        except (FuturesTimeoutError, Exception):
            logger.warning("analytics_nature_outcome fallback also timed out, returning empty result")

    # Get top natures by total count
    nature_totals = {n: sum(outcomes.values()) for n, outcomes in nature_outcome.items()}
    top_natures = sorted(nature_totals, key=lambda n: nature_totals[n], reverse=True)[:20]

    # Collect all outcome labels
    all_outcomes: set[str] = set()
    for outcomes in nature_outcome.values():
        all_outcomes.update(outcomes.keys())
    outcome_labels = sorted(all_outcomes)

    matrix: dict[str, dict[str, int]] = {}
    for nature in top_natures:
        matrix[nature] = {o: nature_outcome[nature].get(o, 0) for o in outcome_labels}

    result = {
        "natures": top_natures,
        "outcomes": outcome_labels,
        "matrix": matrix,
    }
    _analytics_set(ck, result)
    return _analytics_response(result)


@api_bp.route("/analytics/success-rate")
def analytics_success_rate():
    """Multi-factor success-rate analytics."""
    cases = _apply_filters(_get_analytics_cases())

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

    return _analytics_response(
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


ALLOWED_LEADERBOARD_SORT = frozenset({"cases", "approval_rate", "name"})


@api_bp.route("/analytics/judge-leaderboard")
def analytics_judge_leaderboard():
    """Judge/member leaderboard with approval rates and metadata."""
    sort_by = request.args.get("sort_by", "cases").strip().lower() or "cases"
    if sort_by not in ALLOWED_LEADERBOARD_SORT:
        return jsonify({"error": f"Invalid sort_by. Allowed: {sorted(ALLOWED_LEADERBOARD_SORT)}"}), 400
    name_q = request.args.get("name_q", "").strip().lower()
    limit = safe_int(request.args.get("limit"), default=50, min_val=1, max_val=200)
    min_cases = safe_int(request.args.get("min_cases"), default=1, min_val=1, max_val=100000)
    cases = _apply_filters(_get_analytics_cases())

    judge_cases: dict[str, list[ImmigrationCase]] = defaultdict(list)
    judge_court_counts: dict[str, Counter] = defaultdict(Counter)
    judge_canonical_name: dict[str, str] = {}
    judge_display_name: dict[str, str] = {}
    for case in cases:
        for raw_name in _split_judges(case.judges):
            canonical_name, display_name = _judge_identity(
                raw_name, case.court_code, case.year
            )
            if not canonical_name:
                continue
            key = canonical_name.lower()
            judge_canonical_name.setdefault(key, canonical_name)
            judge_display_name.setdefault(key, display_name)
            judge_cases[key].append(case)
            if case.court_code:
                judge_court_counts[key][case.court_code] += 1

    rows = []
    for key, jc in judge_cases.items():
        canonical_name = judge_canonical_name[key]
        display_name = judge_display_name.get(key, canonical_name)

        if name_q and (name_q not in canonical_name.lower() and name_q not in display_name.lower()):
            continue

        if len(jc) < min_cases:
            continue

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
                "name": canonical_name,
                "display_name": display_name,
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
    return _analytics_response({"judges": rows[:limit], "total_judges": total_judges})


@api_bp.route("/analytics/judge-profile")
def analytics_judge_profile():
    """Deep profile for a single judge/member."""
    name = request.args.get("name", "").strip()
    if not name:
        return _error("name query parameter is required")

    cases = _apply_filters(_get_analytics_cases())
    judge_cases, canonical_name, display_name = _collect_cases_for_judge(cases, name)

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
        display_name, judge_cases, include_recent_cases=True, court_baselines=court_baselines
    )
    payload["judge"]["canonical_name"] = canonical_name
    return _analytics_response(payload)


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
    cases = _apply_filters(_get_analytics_cases())

    # Resolve canonical keys for all requested judges upfront
    judge_meta: dict[str, tuple[str, str]] = {}  # canonical_key → (canonical_name, display_name)
    for name in names:
        canonical_name, display_name = _judge_identity(name)
        canonical_name = canonical_name or (_normalise_judge_name(name) or name)
        display_name = display_name or canonical_name
        judge_meta[canonical_name.lower()] = (canonical_name, display_name)

    target_keys: set[str] = set(judge_meta.keys())

    # Single scan: partition cases into per-judge buckets (1× instead of 4×)
    judge_case_lists: dict[str, list[ImmigrationCase]] = defaultdict(list)
    for case in cases:
        seen_for_case: set[str] = set()
        for raw_name in _split_judges(case.judges):
            can_key = _judge_identity(raw_name, case.court_code, case.year)[0].lower()
            if can_key in target_keys and can_key not in seen_for_case:
                judge_case_lists[can_key].append(case)
                seen_for_case.add(can_key)

    # Build profiles in original name order; fall back to _collect_cases_for_judge for unknown aliases
    profiles = []
    for name in names:
        canonical_name, display_name = _judge_identity(name)
        canonical_name = canonical_name or (_normalise_judge_name(name) or name)
        display_name = display_name or canonical_name
        canonical_key = canonical_name.lower()
        judge_cases = judge_case_lists.get(canonical_key)
        if not judge_cases:
            # Fallback for aliases that _judge_identity cannot resolve via lru_cache
            judge_cases, canonical_name, display_name = _collect_cases_for_judge(cases, name)
        profile = _judge_profile_payload(display_name, judge_cases, include_recent_cases=False)
        profile["judge"]["canonical_name"] = canonical_name
        profiles.append(profile)

    return _analytics_response({"judges": profiles})


@api_bp.route("/analytics/concept-effectiveness")
def analytics_concept_effectiveness():
    """Per-concept win-rate and lift vs baseline."""
    limit = safe_int(request.args.get("limit"), default=30, min_val=1, max_val=100)
    cases = _apply_filters(_get_analytics_cases())

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

    return _analytics_response({"baseline_rate": baseline_rate, "concepts": concepts})


@api_bp.route("/analytics/concept-cooccurrence")
def analytics_concept_cooccurrence():
    """Concept co-occurrence matrix and top pairs."""
    limit = safe_int(request.args.get("limit"), default=15, min_val=2, max_val=30)
    min_count = safe_int(request.args.get("min_count"), default=50, min_val=1, max_val=1000000)
    cases = _apply_filters(_get_analytics_cases())

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
        # Cap to 8 top concepts per case to bound combinations: C(8,2)=28, never C(15,2)=105
        concepts = sorted(set(_split_concepts(case.legal_concepts)).intersection(top_set))[:8]
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
    return _analytics_response(
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
    cases = _apply_filters(_get_analytics_cases())

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

    return _analytics_response(
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
    cases = _apply_filters(_get_analytics_cases())
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

    return _analytics_response({"nodes": nodes, "links": links})


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
    cases = _apply_filters(_get_analytics_cases())

    monthly: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "wins": 0})

    for c in cases:
        if not c.date:
            continue
        # Extract YYYY-MM from date string
        month_key = _extract_month_key(c.date)
        if not month_key:
            continue
        bucket = monthly[month_key]
        bucket["total"] += 1
        norm = _normalise_outcome(c.outcome)
        if _is_win(norm, c.court_code or ""):
            bucket["wins"] += 1

    series = []
    for month_key in sorted(monthly.keys()):
        bucket = monthly[month_key]
        total = bucket["total"]
        wins = bucket["wins"]
        rate = round(wins / total * 100, 1) if total > 0 else 0
        series.append({"month": month_key, "total": total, "wins": wins, "win_rate": rate})

    return _analytics_response({"series": series, "events": _POLICY_EVENTS})


# ── Judge Bio ──────────────────────────────────────────────────────────

_ALLOWED_JUDGE_PHOTO_EXTS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".avif",
}


@api_bp.route("/judge-photo/<path:filename>")
def judge_photo(filename: str):
    """Serve downloaded judge profile photos from output_dir/judge_photos."""
    photos_dir = (Path(get_output_dir()) / "judge_photos").resolve()
    requested = (photos_dir / filename).resolve()

    try:
        requested.relative_to(photos_dir)
    except ValueError:
        return jsonify({"error": "Not found"}), 404

    if requested.suffix.lower() not in _ALLOWED_JUDGE_PHOTO_EXTS:
        return jsonify({"error": "Not found"}), 404

    if not requested.is_file():
        return jsonify({"error": "Not found"}), 404

    if current_app.testing:
        import mimetypes

        mime_type, encoding = mimetypes.guess_type(requested)
        with open(requested, "rb") as photo_file:
            response = current_app.response_class(
                photo_file.read(),
                mimetype=mime_type or "application/octet-stream",
            )
        if encoding:
            response.headers["Content-Encoding"] = encoding
        return response

    return send_file(requested, conditional=True, max_age=60 * 60 * 24)


@api_bp.route("/analytics/judge-bio")
def analytics_judge_bio():
    """Lookup pre-fetched biographical data for a judge/member."""
    name = request.args.get("name", "").strip()
    if not name:
        return _error("name is required")
    bios = _load_judge_bios()
    if not bios:
        return _analytics_response({"found": False})

    bio = None
    for alias in _judge_query_aliases(name):
        bio = bios.get(alias)
        if bio:
            break
    if not bio:
        return _analytics_response({"found": False})
    return _analytics_response({"found": True, **bio})



@api_bp.route("/analytics/visa-families")
def analytics_visa_families():
    """Case counts and win rates aggregated by visa family."""
    cases = _apply_filters(_get_analytics_cases())

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

    return _analytics_response({"families": families, "total_cases": len(cases)})


# ── Cache Invalidation ───────────────────────────────────────────────────

@api_bp.route("/cache/invalidate", methods=["POST"])
@rate_limit(3, 60, scope="cache-invalidate")
def invalidate_cache():
    """Invalidate all in-memory caches. Useful after bulk data import."""
    global _stats_cache_payload, _stats_cache_ts
    global _filter_options_cache_payload, _filter_options_cache_ts

    with _stats_cache_lock:
        _stats_cache_payload = None
        _stats_cache_ts = 0.0
    with _filter_options_cache_lock:
        _filter_options_cache_payload = None
        _filter_options_cache_ts = 0.0

    # Lineage cache lives in api_taxonomy.py; use lazy import to avoid circular dependency.
    from .api_taxonomy import _reset_lineage_cache
    _reset_lineage_cache()

    _analytics_cache_obj.invalidate()
    _invalidate_cases_cache()

    return jsonify({"invalidated": True, "timestamp": time.time()})


# ── Data Dictionary ─────────────────────────────────────────────────────

@api_bp.route("/data-dictionary")
def data_dictionary():
    return jsonify({"fields": DATA_DICTIONARY_FIELDS})
