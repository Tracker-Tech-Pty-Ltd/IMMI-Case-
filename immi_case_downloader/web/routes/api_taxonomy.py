"""Taxonomy, registry, and court-lineage API endpoints.

Extracted from api.py as part of cq-001 Phase C.
Routes: /court-lineage, /visa-registry, /taxonomy/visa-lookup,
        /taxonomy/legal-concepts, /taxonomy/judges/autocomplete,
        /taxonomy/countries, /taxonomy/guided-search
"""
import re
import logging
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import TimeoutError as FuturesTimeoutError

from flask import Blueprint, request, jsonify

from ...config import END_YEAR, AUSTLII_DATABASES
from ...visa_registry import VISA_REGISTRY, get_registry_for_api
from ..cache_registry import register_cache_invalidator
from ..helpers import get_repo, safe_int, error_response as _error
from ..security import rate_limit

from . import api as _api
# Constants are immutable — direct import is safe (no patch needed for these).
from .api_constants import DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, SUPABASE_RPC_TIMEOUT_SECONDS

logger = logging.getLogger(__name__)

api_taxonomy_bp = Blueprint("api_taxonomy", __name__, url_prefix="/api/v1")

# ── Court lineage cache (moved from api.py — only used here) ────────────
_lineage_cache_lock = threading.Lock()
_lineage_cache_payload: dict | None = None
_lineage_cache_ts: float = 0.0
_LINEAGE_CACHE_TTL_SECONDS = 300.0


@register_cache_invalidator
def _reset_lineage_cache() -> None:
    """Reset the lineage cache. Registered with the web cache registry."""
    global _lineage_cache_payload, _lineage_cache_ts
    with _lineage_cache_lock:
        _lineage_cache_payload = None
        _lineage_cache_ts = 0.0


# ── Court Lineage ────────────────────────────────────────────────────────

@api_taxonomy_bp.route("/court-lineage")
def court_lineage():
    """Return court lineage metadata showing tribunal and court succession over time.

    Returns lineages for:
    - Lower court: FMCA (2000-2013) → FCCA (2013-2021) → FedCFamC2G (2021+)
    - Tribunal: MRTA+RRTA (2000-2015) → AATA (2015-2024) → ARTA (2024+)

    Includes case counts per court per year and transition information.
    """
    repo = get_repo()

    global _lineage_cache_payload, _lineage_cache_ts
    now = time.time()

    # Supabase path: use pre-aggregated RPC instead of loading entire table.
    if hasattr(repo, "_client"):
        with _lineage_cache_lock:
            if (
                _lineage_cache_payload is not None
                and (now - _lineage_cache_ts) < _LINEAGE_CACHE_TTL_SECONDS
            ):
                return jsonify(_lineage_cache_payload)

        try:
            timeout_seconds = max(SUPABASE_RPC_TIMEOUT_SECONDS, 2.5)
            resp = _api._call_with_timeout(
                lambda: repo._client.rpc("get_court_year_trends").execute(),
                timeout_seconds=timeout_seconds,
            )
            court_year_counts, all_years, total_cases = _api._parse_court_year_trends_rows(resp.data)
            if not all_years:
                raise ValueError("RPC returned no yearly data")
        except FuturesTimeoutError:
            logger.warning("Supabase RPC get_court_year_trends timed out for /court-lineage")
            with _lineage_cache_lock:
                if _lineage_cache_payload is not None:
                    return jsonify(_lineage_cache_payload)
            return _error("Court lineage data timed out. Please retry.", 504)
        except Exception:
            logger.warning("Supabase RPC get_court_year_trends failed for /court-lineage", exc_info=True)
            with _lineage_cache_lock:
                if _lineage_cache_payload is not None:
                    return jsonify(_lineage_cache_payload)
            return _error("Court lineage data is temporarily unavailable.", 503)
    else:
        # Local (CSV/SQLite) path: aggregate in-process.
        all_cases = _api._get_all_cases()
        court_year_counts = defaultdict(lambda: defaultdict(int))
        all_years = set()

        for case in all_cases:
            if case.court_code and case.year:
                court_year_counts[case.court_code][case.year] += 1
                all_years.add(case.year)

        total_cases = len(all_cases)

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

    # Calculate year range
    year_range = [min(all_years), max(all_years)] if all_years else [2000, END_YEAR]

    payload = {
        "lineages": lineages,
        "total_cases": total_cases,
        "year_range": year_range,
    }

    if hasattr(repo, "_client"):
        with _lineage_cache_lock:
            _lineage_cache_payload = payload
            _lineage_cache_ts = time.time()

    return jsonify(payload)


# ── Visa Registry ────────────────────────────────────────────────────────

@api_taxonomy_bp.route("/visa-registry")
def visa_registry():
    """Return the full visa registry (entries + families) for frontend caching."""
    return jsonify(get_registry_for_api())


# ── Taxonomy Endpoints ────────────────────────────────────────────────────

@api_taxonomy_bp.route("/taxonomy/visa-lookup")
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
        cases = _api._get_all_cases()
        visa_counts: dict[str, int] = Counter()
        for c in cases:
            cleaned = _api._clean_visa(c.visa_subclass)
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


@api_taxonomy_bp.route("/taxonomy/legal-concepts")
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
        from ...legal_concepts_registry import get_concepts_for_api

        # Get all cases and count by concept
        cases = _api._get_all_cases()
        concept_counts: dict[str, int] = Counter()

        for c in cases:
            for concept in _api._split_concepts(c.legal_concepts):
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


@api_taxonomy_bp.route("/taxonomy/judges/autocomplete")
def taxonomy_judges_autocomplete():
    """Autocomplete judge names with case counts.

    Query parameters:
      q     (str, required, min 2 chars) — searches judge name (case-insensitive)
      limit (int, default 20, max 50)    — max results to return

    Returns:
      {
        "success": true,
        "judges": [
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

        # Get all cases and count by canonical judge name
        cases = _api._get_all_cases()
        judge_counts: dict[str, int] = Counter()
        judge_display_name: dict[str, str] = {}
        judge_canonical_name: dict[str, str] = {}

        for c in cases:
            for raw_name in _api._split_judges(c.judges or ""):
                canonical_name, display_name = _api._judge_identity(
                    raw_name, c.court_code, c.year
                )
                if not canonical_name:
                    continue
                key = canonical_name.lower()
                judge_counts[key] += 1
                judge_canonical_name.setdefault(key, canonical_name)
                judge_display_name.setdefault(key, display_name)

        # Filter judges matching query (case-insensitive partial match)
        # and rank exact/prefix matches above generic substring matches.
        q_lower = query.lower()
        results = []

        for judge_key in sorted(judge_counts.keys()):
            canonical_name = judge_canonical_name[judge_key]
            display_name = judge_display_name.get(judge_key, canonical_name)
            canonical_lower = canonical_name.lower()
            display_lower = display_name.lower()
            searchable = f"{canonical_lower} {display_lower}"
            if q_lower not in searchable:
                continue

            tokens = re.findall(r"[a-z0-9']+", searchable)
            exact_match = (
                canonical_lower == q_lower
                or display_lower == q_lower
                or q_lower in tokens
            )
            token_prefix_match = any(t.startswith(q_lower) for t in tokens)
            prefix_match = canonical_lower.startswith(q_lower) or display_lower.startswith(q_lower)
            if exact_match:
                match_rank = 3
            elif token_prefix_match or prefix_match:
                match_rank = 2
            else:
                match_rank = 1

            results.append({
                # Keep `name` user-facing; include canonical alias for routing/debug.
                "name": display_name,
                "canonical_name": canonical_name,
                "case_count": judge_counts[judge_key],
                "_rank": match_rank,
            })

        # Sort by relevance first, then activity.
        results.sort(
            key=lambda x: (
                -x["_rank"],
                -x["case_count"],
                x["name"].lower(),
            )
        )
        total_matched = len(results)
        results = results[:limit]
        for row in results:
            row.pop("_rank", None)

        return jsonify({
            "success": True,
            # Backward compatible with older frontend bundles that still read `data`.
            "data": results,
            "judges": results,
            "meta": {
                "query": query,
                "total_results": total_matched,
                "limit": limit,
            },
        })

    except Exception as e:
        logger.error(f"Error in judges-autocomplete: {e}")
        return jsonify({"success": False, "error": "Failed to autocomplete judge names"}), 500


@api_taxonomy_bp.route("/taxonomy/countries")
def taxonomy_countries():
    """Get all countries of origin with case counts.

    Returns all countries found in case records, sorted by case count descending.
    Used by frontend for country filter dropdown.

    Query parameters:
      limit (int, default 30, max 200) — max results to return

    Returns:
      {
        "success": true,
        "countries": [
          {
            "country": "China",
            "name": "China",
            "case_count": 12543
          },
          ...
        ],
        "meta": {
          "total_countries": 89,
          "returned_results": 30,
          "limit": 30
        }
      }
    """
    try:
        limit = min(request.args.get("limit", 30, type=int), 200)
        if limit < 1:
            return jsonify({"success": False, "error": "limit must be >= 1"}), 400

        # Get all cases and count by country
        cases = _api._get_all_cases()
        country_counts: dict[str, int] = Counter()

        for c in cases:
            country = (c.country_of_origin or "").strip()
            if country:
                country_counts[country] += 1

        # Build results sorted by case count descending
        results = [
            {
                "country": country,
                "name": country,
                "case_count": count,
            }
            for country, count in sorted(
                country_counts.items(),
                key=lambda x: x[1],
                reverse=True
            )
        ][:limit]

        return jsonify({
            "success": True,
            "countries": results,
            "meta": {
                "total_countries": len(country_counts),
                "returned_results": len(results),
                "limit": limit,
            },
        })

    except Exception as e:
        logger.error(f"Error in taxonomy/countries: {e}")
        return jsonify({"success": False, "error": "Failed to retrieve countries"}), 500


@api_taxonomy_bp.route("/taxonomy/guided-search", methods=["POST"])
@rate_limit(20, 60, scope="guided-search")
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
        "profile_url": "/judge-profiles/Smith",
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
            cases = _api._get_all_cases()
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
                        case_concepts = _api._split_concepts(c.legal_concepts)
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

        else:  # flow == "assess-judge" (validated above)
            judge_name = data.get("judge_name", "").strip()
            if not judge_name:
                return jsonify({"success": False, "error": "Judge name is required for assess-judge flow"}), 400

            # Normalise judge name
            normalised_name = _api._normalise_judge_name(judge_name)
            if not normalised_name:
                return jsonify({"success": False, "error": "Invalid judge name"}), 400

            # Get basic judge stats
            cases = _api._get_all_cases()
            judge_cases, canonical_name, display_name = _api._collect_cases_for_judge(
                cases, normalised_name
            )
            canonical_name = canonical_name or normalised_name
            display_name = display_name or canonical_name

            return jsonify({
                "success": True,
                "flow": "assess-judge",
                "judge_name": display_name,
                "canonical_name": canonical_name,
                "profile_url": f"/judge-profiles/{canonical_name}",
                "meta": {
                    "total_cases": len(judge_cases),
                },
            })

    except Exception as e:
        logger.error(f"Error in taxonomy/guided-search: {e}")
        return jsonify({"success": False, "error": "Failed to process guided search"}), 500
