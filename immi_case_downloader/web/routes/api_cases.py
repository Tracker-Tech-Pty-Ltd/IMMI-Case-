"""Cases CRUD, search, and filter-options API endpoints.

Extracted from api.py as part of cq-001 Phase D1.
Routes:
  GET/POST       /cases
  GET            /cases/count
  GET/PUT/DELETE /cases/<case_id>
  POST           /cases/batch
  GET            /cases/compare
  GET            /cases/<case_id>/related
  GET            /cases/<case_id>/similar
  GET            /search
  GET            /search/semantic
  GET            /filter-options
"""
import os
import re
import json
import base64
import logging
import time
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from typing import Any

import numpy as np
from flask import Blueprint, request, jsonify

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
from ..helpers import get_repo, safe_int, EDITABLE_FIELDS, error_response as _error
from ..security import rate_limit
from . import api as _api
from .api import (
    CASE_LIST_COLUMNS,
    ALLOWED_SORT_FIELDS,
    ALLOWED_SORT_DIRS,
    ALLOWED_COUNT_MODES,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    DEFAULT_SEARCH_LIMIT,
    MAX_SEARCH_LIMIT,
    DEFAULT_SEARCH_MODE,
    ALLOWED_SEARCH_MODES,
    ALLOWED_SEARCH_PROVIDERS,
    DEFAULT_SEMANTIC_CANDIDATE_LIMIT,
    MAX_SEMANTIC_CANDIDATE_LIMIT,
    DEFAULT_RELATED_LIMIT,
    MAX_RELATED_LIMIT,
    MAX_BATCH_SIZE,
    MAX_TAG_LENGTH,
    MAX_COMPARE_CASES,
    TRIBUNAL_CODES,
    COURT_CODES,
)

logger = logging.getLogger(__name__)

api_cases_bp = Blueprint("api_cases", __name__, url_prefix="/api/v1")

_HEX_ID = re.compile(r"^[0-9a-f]{12}$")

# ── Filter-options cache ──────────────────────────────────────────────────────
_filter_options_executor = ThreadPoolExecutor(max_workers=2)
_filter_options_cache_lock = threading.Lock()
_filter_options_cache_payload: dict | None = None
_filter_options_cache_ts: float = 0.0
_FILTER_OPTIONS_CACHE_TTL_SECONDS = 300.0

# ── Semantic / similar constants ──────────────────────────────────────────────
MAX_SIMILAR_LIMIT = 10
DEFAULT_SIMILAR_LIMIT = 5
MAX_SEMANTIC_SEARCH_LIMIT = 20
DEFAULT_SEMANTIC_SEARCH_LIMIT = 10
MIN_SEMANTIC_QUERY_LEN = 3


# ── Supabase response helpers ─────────────────────────────────────────────────

def _supabase_rows(resp: Any) -> list[dict[str, Any]]:
    """Extract list[dict] from a Supabase APIResponse, returning [] on failure."""
    data = getattr(resp, "data", None) if resp is not None else None
    return data if isinstance(data, list) else []  # type: ignore[return-value]


def _supabase_row(resp: Any) -> dict[str, Any] | None:
    """Extract a single dict from a Supabase maybe_single() APIResponse."""
    data = getattr(resp, "data", None) if resp is not None else None
    return data if isinstance(data, dict) else None


# ── Case ID / cursor helpers ──────────────────────────────────────────────────

def _valid_case_id(case_id: str) -> bool:
    return bool(_HEX_ID.match(case_id))


def _encode_cursor(year: int, case_id: str) -> str:
    """Encode a seek position as a base64url token."""
    payload = json.dumps({"year": year, "case_id": case_id}, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[int, str] | None:
    """Decode a base64url cursor token back to (year, case_id), or None on error."""
    try:
        padded = cursor + "=" * (4 - len(cursor) % 4)
        payload = base64.urlsafe_b64decode(padded).decode()
        data = json.loads(payload)
        return data["year"], data["case_id"]
    except Exception:
        return None


# ── Case-list helpers ─────────────────────────────────────────────────────────

def _parse_case_list_filters() -> tuple[str, int | None, str, str, str, str, str]:
    """Parse shared case-list query filters from request args."""
    court = request.args.get("court", "").strip()
    year_str = request.args.get("year", "").strip()
    year = None
    if year_str:
        try:
            year = int(year_str)
        except ValueError:
            year = None
    visa_type = request.args.get("visa_type", "").strip()
    keyword = (request.args.get("keyword") or request.args.get("q") or "").strip()
    source = request.args.get("source", "").strip()
    tag = request.args.get("tag", "").strip()
    nature = request.args.get("nature", "").strip()
    return court, year, visa_type, keyword, source, tag, nature


def _parse_cases_page_size() -> int:
    """Parse `page_size` with temporary `per_page` compatibility."""
    raw_page_size = request.args.get("page_size")
    if raw_page_size not in (None, ""):
        return safe_int(
            raw_page_size,
            default=DEFAULT_PAGE_SIZE,
            min_val=1,
            max_val=MAX_PAGE_SIZE,
        )

    raw_per_page = request.args.get("per_page")
    if raw_per_page not in (None, ""):
        return safe_int(
            raw_per_page,
            default=DEFAULT_PAGE_SIZE,
            min_val=1,
            max_val=MAX_PAGE_SIZE,
        )

    return DEFAULT_PAGE_SIZE


def _build_case_list_query(
    *,
    court: str,
    year: int | None,
    visa_type: str,
    source: str,
    tag: str,
    nature: str,
    keyword: str,
    sort_by: str,
    sort_dir: str,
) -> CaseListQuery:
    """Create the normalized query signature for `/api/v1/cases`."""
    return CaseListQuery(
        court=court,
        year=year,
        visa_type=visa_type,
        source=source,
        tag=tag,
        nature=nature,
        keyword=keyword,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


def _list_cases_offset_path(
    repo,
    *,
    court: str,
    year: int | None,
    visa_type: str,
    source: str,
    tag: str,
    nature: str,
    keyword: str,
    sort_by: str,
    sort_dir: str,
    page: int,
    page_size: int,
    count_mode: str,
) -> tuple[list[ImmigrationCase], int, str]:
    """Fetch a page using the legacy offset path."""
    effective_count_mode = count_mode

    if hasattr(repo, "count_cases"):
        total, effective_count_mode = _count_cases_with_fallback(
            repo,
            court=court,
            year=year,
            visa_type=visa_type,
            source=source,
            tag=tag,
            nature=nature,
            keyword=keyword,
            count_mode=count_mode,
        )
    else:
        total = 0
        effective_count_mode = "exact"

    if hasattr(repo, "list_cases_fast"):
        page_cases = repo.list_cases_fast(
            court=court,
            year=year,
            visa_type=visa_type,
            source=source,
            tag=tag,
            nature=nature,
            keyword=keyword,
            sort_by=sort_by,
            sort_dir=sort_dir,
            page=page,
            page_size=page_size,
            columns=CASE_LIST_COLUMNS,
        )
        if not hasattr(repo, "count_cases"):
            total = (page - 1) * page_size + len(page_cases)
            effective_count_mode = "planned"
        return page_cases, total, effective_count_mode

    page_cases, filter_total = repo.filter_cases(
        court=court,
        year=year,
        visa_type=visa_type,
        source=source,
        tag=tag,
        nature=nature,
        keyword=keyword,
        sort_by=sort_by,
        sort_dir=sort_dir,
        page=page,
        page_size=page_size,
    )
    if not hasattr(repo, "count_cases"):
        total = filter_total
        effective_count_mode = "exact"
    return page_cases, total, effective_count_mode


def _load_cases_via_seek(
    repo,
    *,
    query: CaseListQuery,
    plan,
    page: int,
    page_size: int,
    total_pages: int,
) -> tuple[list[ImmigrationCase], str, str | None]:
    """Execute the seek strategy chosen for `/api/v1/cases`."""
    strategy = plan.strategy
    fallback_reason = plan.fallback_reason

    if strategy == "offset_fallback":
        return [], strategy, fallback_reason

    if page > total_pages:
        return [], "offset_fallback", "page_out_of_range"

    if strategy == "seek_reverse":
        reverse_steps = max(0, total_pages - page)
        reverse_anchor = None
        final_page: list[ImmigrationCase] = []

        for current_page in range(total_pages, page - 1, -1):
            raw_rows = repo.list_cases_seek(
                court=query.court,
                year=query.year,
                visa_type=query.visa_type,
                source=query.source,
                tag=query.tag,
                nature=query.nature,
                keyword=query.keyword,
                sort_by=query.sort_by,
                sort_dir=query.sort_dir,
                page_size=page_size,
                anchor=reverse_anchor,
                reverse=True,
                columns=CASE_LIST_COLUMNS,
            )
            if not raw_rows:
                final_page = []
                break

            reverse_anchor = {
                "year": int(getattr(raw_rows[-1], "year", 0) or 0),
                "case_id": str(getattr(raw_rows[-1], "case_id", "") or ""),
            }
            final_page = list(reversed(raw_rows))
            remember_page_anchor(
                repo=repo,
                query=query,
                page=current_page,
                page_cases=final_page,
            )
            if reverse_steps <= 0:
                break
            reverse_steps -= 1

        return final_page, strategy, fallback_reason

    current_anchor = None
    current_page = 1
    if plan.anchor is not None:
        current_anchor = {
            "year": plan.anchor.year,
            "case_id": plan.anchor.case_id,
        }
        current_page = max(1, plan.anchor_page + 1)

    final_page: list[ImmigrationCase] = []
    while current_page <= page:
        final_page = repo.list_cases_seek(
            court=query.court,
            year=query.year,
            visa_type=query.visa_type,
            source=query.source,
            tag=query.tag,
            nature=query.nature,
            keyword=query.keyword,
            sort_by=query.sort_by,
            sort_dir=query.sort_dir,
            page_size=page_size,
            anchor=current_anchor,
            reverse=False,
            columns=CASE_LIST_COLUMNS,
        )
        if not final_page:
            break

        current_anchor = {
            "year": int(getattr(final_page[-1], "year", 0) or 0),
            "case_id": str(getattr(final_page[-1], "case_id", "") or ""),
        }
        remember_page_anchor(
            repo=repo,
            query=query,
            page=current_page,
            page_cases=final_page,
        )
        current_page += 1

    return final_page, strategy, fallback_reason


# ── Filter-options helpers ────────────────────────────────────────────────────

def _empty_filter_options_payload() -> dict:
    """Create a safe minimal payload for filter dropdown data."""
    return {
        "courts": [],
        "years": [],
        "sources": [],
        "natures": [],
        "visa_types": [],
        "tags": [],
    }


def _default_filter_options_payload() -> dict:
    """Fast static fallback when live filter metadata is unavailable."""
    payload = _empty_filter_options_payload()
    payload["courts"] = sorted(TRIBUNAL_CODES | COURT_CODES)
    payload["years"] = list(range(END_YEAR, START_YEAR - 1, -1))
    payload["sources"] = ["AustLII"]
    return payload


def _normalise_filter_options(opts: dict | None) -> dict:
    """Ensure filter options response always has a stable shape."""
    if not isinstance(opts, dict):
        return _empty_filter_options_payload()

    payload = _empty_filter_options_payload()
    for key in ("courts", "years", "sources", "natures", "visa_types"):
        values = opts.get(key) or []
        if isinstance(values, list):
            payload[key] = values

    raw_tags = opts.get("tags", [])
    if isinstance(raw_tags, list):
        payload["tags"] = sorted({
            str(tag).strip()
            for tag in raw_tags
            if isinstance(tag, str) and tag.strip()
        })

    return payload


def _sample_filter_options_fallback(repo) -> dict:
    """Build lightweight filter options from a small recent sample."""
    payload = _empty_filter_options_payload()

    try:
        if hasattr(repo, "list_cases_fast"):
            def sampler():
                return repo.list_cases_fast(
                    sort_by="year",
                    sort_dir="desc",
                    page=1,
                    page_size=400,
                    columns=["court_code", "year", "source", "case_nature", "visa_type", "tags"],
                )

            if hasattr(repo, "count_cases"):
                sample_cases = _api._call_with_timeout(
                    sampler,
                    timeout_seconds=0.8,
                    executor=_filter_options_executor,
                )
            else:
                sample_cases = sampler()
        else:
            sample_cases, _ = repo.filter_cases(
                sort_by="year",
                sort_dir="desc",
                page=1,
                page_size=400,
            )
    except Exception:
        logger.warning("Filter-options sample fallback failed", exc_info=True)
        return _default_filter_options_payload()

    courts: set[str] = set()
    years: set[int] = set()
    sources: set[str] = set()
    natures: set[str] = set()
    visa_types: set[str] = set()
    tags: set[str] = set()

    for case in sample_cases:
        court_code = str(getattr(case, "court_code", "") or "").strip()
        if court_code:
            courts.add(court_code)

        year = getattr(case, "year", None)
        if isinstance(year, int) and year > 0:
            years.add(year)

        source = str(getattr(case, "source", "") or "").strip()
        if source:
            sources.add(source)

        nature = str(getattr(case, "case_nature", "") or "").strip()
        if nature:
            natures.add(nature)

        visa_type = str(getattr(case, "visa_type", "") or "").strip()
        if visa_type:
            visa_types.add(visa_type)

        raw_tags = str(getattr(case, "tags", "") or "")
        if raw_tags:
            for tag in raw_tags.split(","):
                cleaned = tag.strip()
                if cleaned:
                    tags.add(cleaned)

    payload["courts"] = sorted(courts)
    payload["years"] = sorted(years, reverse=True)
    payload["sources"] = sorted(sources)
    payload["natures"] = sorted(natures)
    payload["visa_types"] = sorted(visa_types)
    payload["tags"] = sorted(tags)
    # Guarantee useful baseline choices even when sample is sparse.
    if not payload["courts"]:
        payload["courts"] = sorted(TRIBUNAL_CODES | COURT_CODES)
    if not payload["years"]:
        payload["years"] = list(range(END_YEAR, START_YEAR - 1, -1))
    if not payload["sources"]:
        payload["sources"] = ["AustLII"]
    return payload


def _count_cases_with_fallback(
    repo,
    *,
    court: str,
    year: int | None,
    visa_type: str,
    source: str,
    tag: str,
    nature: str,
    keyword: str,
    count_mode: str,
) -> tuple[int, str]:
    """Try requested count mode, then degrade to faster modes on failure."""
    fast_supabase_path = hasattr(repo, "list_cases_fast")
    if fast_supabase_path and count_mode == "exact":
        preferred_modes = ("planned", "estimated", "exact")
    elif fast_supabase_path and count_mode == "estimated":
        preferred_modes = ("estimated", "planned")
    elif fast_supabase_path:
        preferred_modes = ("planned", "estimated")
    else:
        preferred_modes = (count_mode, "planned", "estimated")

    ordered_modes: list[str] = []
    for mode in preferred_modes:
        if mode in ALLOWED_COUNT_MODES and mode not in ordered_modes:
            ordered_modes.append(mode)

    last_exc: Exception | None = None
    for mode in ordered_modes:
        try:
            def counter(selected_mode=mode):
                return repo.count_cases(
                    court=court,
                    year=year,
                    visa_type=visa_type,
                    source=source,
                    tag=tag,
                    nature=nature,
                    keyword=keyword,
                    count_mode=selected_mode,
                )

            total = int(counter())
            return max(total, 0), mode
        except Exception as exc:
            last_exc = exc
            logger.warning("count_cases failed for mode '%s': %s", mode, exc)

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("Unable to compute case count")


# ── Semantic helpers ──────────────────────────────────────────────────────────

def _case_semantic_text(case: ImmigrationCase) -> str:
    """Build semantic text payload for a case."""
    return " | ".join(
        part.strip()
        for part in [
            case.title,
            case.citation,
            case.catchwords,
            case.visa_type,
            case.legislation,
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


def _run_semantic_search(
    query: str,
    limit: int = DEFAULT_SEMANTIC_SEARCH_LIMIT,
    provider: str = "openai",
    model: str = "",
) -> dict:
    """Embed *query* text and perform ANN search via Supabase pgvector RPC.

    Returns a dict with keys:
        results  – list of matching case dicts (may be empty)
        available – True if Supabase + embedding API are reachable
        query    – the original query string (echoed back)
        provider – embedding provider used
        model    – embedding model used
    """
    repo = get_repo()
    from ...supabase_repository import SupabaseRepository

    if not isinstance(repo, SupabaseRepository):
        return {"results": [], "available": False, "query": query,
                "provider": provider, "model": model}

    try:
        client, provider_used, model_used = _get_embedding_client(provider, model)
        query_vectors = _normalize_vectors(
            client.embed_texts([query], task_type="RETRIEVAL_QUERY")
        )
        embedding = query_vectors[0].tolist()

        rpc_resp = repo._client.rpc("search_cases_semantic", {
            "p_query_embedding": embedding,
            "p_provider": provider_used,
            "p_model": model_used,
            "p_limit": limit,
        }).execute()

        id_score: list[tuple[str, float]] = [
            (r["case_id"], float(r["similarity"]))
            for r in _supabase_rows(rpc_resp)
            if r.get("case_id")
        ][:limit]

        if not id_score:
            return {"results": [], "available": True, "query": query,
                    "provider": provider_used, "model": model_used}

        ids = [cid for cid, _ in id_score]
        meta_resp = (
            repo._client
            .table("immigration_cases")
            .select("case_id, citation, title, outcome")
            .in_("case_id", ids)
            .execute()
        )
        meta_by_id = {r["case_id"]: r for r in _supabase_rows(meta_resp)}

        results = []
        for cid, score in id_score:
            meta = meta_by_id.get(cid, {})
            results.append({
                "case_id": cid,
                "citation": meta.get("citation") or "",
                "title": meta.get("title") or "",
                "outcome": meta.get("outcome") or "",
                "similarity_score": round(score, 4),
            })

        return {"results": results, "available": True, "query": query,
                "provider": provider_used, "model": model_used}

    except Exception as exc:
        logger.warning("_run_semantic_search failed: %s", exc)
        return {"results": [], "available": False, "query": query,
                "provider": provider, "model": model}


# ── Cases CRUD ────────────────────────────────────────────────────────────────

@api_cases_bp.route("/cases")
def list_cases():
    started_at = time.perf_counter()
    repo = get_repo()
    court, year, visa_type, keyword, source, tag, nature = _parse_case_list_filters()
    sort_by = request.args.get("sort_by", "date")
    sort_dir = request.args.get("sort_dir", "desc")
    if sort_by not in ALLOWED_SORT_FIELDS:
        return jsonify({"error": f"Invalid sort_by '{sort_by}'. Allowed: {sorted(ALLOWED_SORT_FIELDS)}"}), 400
    if sort_dir not in ALLOWED_SORT_DIRS:
        return jsonify({"error": f"Invalid sort_dir '{sort_dir}'. Allowed: asc, desc"}), 400
    page = safe_int(request.args.get("page"), default=1, min_val=1)
    page_size = _parse_cases_page_size()
    count_mode = request.args.get("count_mode", "planned").strip().lower()
    if count_mode not in ALLOWED_COUNT_MODES:
        return _error(f"Invalid count_mode '{count_mode}'. Allowed: {sorted(ALLOWED_COUNT_MODES)}")

    query = _build_case_list_query(
        court=court,
        year=year,
        visa_type=visa_type,
        source=source,
        tag=tag,
        nature=nature,
        keyword=keyword,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    strategy = "offset_fallback"
    fallback_reason: str | None = None

    try:
        if not hasattr(repo, "count_cases"):
            page_cases, total, count_mode = _list_cases_offset_path(
                repo,
                court=court,
                year=year,
                visa_type=visa_type,
                source=source,
                tag=tag,
                nature=nature,
                keyword=keyword,
                sort_by=sort_by,
                sort_dir=sort_dir,
                page=page,
                page_size=page_size,
                count_mode=count_mode,
            )
            total_pages = max(1, (total + page_size - 1) // page_size)
            strategy = "offset_fallback"
            fallback_reason = "repo_has_no_count"
        else:
            total, count_mode = _count_cases_with_fallback(
                repo,
                court=court,
                year=year,
                visa_type=visa_type,
                source=source,
                tag=tag,
                nature=nature,
                keyword=keyword,
                count_mode=count_mode,
            )
            total_pages = max(1, (total + page_size - 1) // page_size)

            if total == 0:
                page_cases = []
                strategy = choose_pagination_plan(
                    repo=repo,
                    query=query,
                    page=page,
                    total_pages=total_pages,
                ).strategy
            else:
                plan = choose_pagination_plan(
                    repo=repo,
                    query=query,
                    page=page,
                    total_pages=total_pages,
                )
                strategy = plan.strategy
                fallback_reason = plan.fallback_reason

                if strategy != "offset_fallback":
                    try:
                        page_cases, strategy, fallback_reason = _load_cases_via_seek(
                            repo,
                            query=query,
                            plan=plan,
                            page=page,
                            page_size=page_size,
                            total_pages=total_pages,
                        )
                    except Exception as exc:
                        logger.warning("list_cases_seek failed; falling back to offset path", exc_info=True)
                        strategy = "offset_fallback"
                        fallback_reason = f"seek_error:{type(exc).__name__}"
                        page_cases, total, count_mode = _list_cases_offset_path(
                            repo,
                            court=court,
                            year=year,
                            visa_type=visa_type,
                            source=source,
                            tag=tag,
                            nature=nature,
                            keyword=keyword,
                            sort_by=sort_by,
                            sort_dir=sort_dir,
                            page=page,
                            page_size=page_size,
                            count_mode=count_mode,
                        )
                        total_pages = max(1, (total + page_size - 1) // page_size)
                else:
                    page_cases, total, count_mode = _list_cases_offset_path(
                        repo,
                        court=court,
                        year=year,
                        visa_type=visa_type,
                        source=source,
                        tag=tag,
                        nature=nature,
                        keyword=keyword,
                        sort_by=sort_by,
                        sort_dir=sort_dir,
                        page=page,
                        page_size=page_size,
                        count_mode=count_mode,
                    )
                    total_pages = max(1, (total + page_size - 1) // page_size)
    except Exception:
        logger.warning("Case list request failed; returning empty page", exc_info=True)
        page_cases = []
        total = 0
        count_mode = "planned"
        total_pages = 1
        strategy = "offset_fallback"
        fallback_reason = fallback_reason or "list_error"

    duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
    logger.info(
        "cases_pagination %s",
        json.dumps(
            {
                "backend_kind": backend_kind_for_repo(repo),
                "strategy": strategy,
                "fallback_reason": fallback_reason,
                "page": page,
                "total_pages": total_pages,
                "query_signature_hash": query.signature_hash(),
                "duration_ms": duration_ms,
            },
            sort_keys=True,
        ),
    )

    # Compute next_cursor: encode the last case's position when more pages exist
    next_cursor: str | None = None
    if page_cases and page < total_pages:
        last_case = page_cases[-1]
        year_val = getattr(last_case, "year", None) or 0
        cid = getattr(last_case, "case_id", None) or ""
        if cid:
            next_cursor = _encode_cursor(year_val, cid)

    return jsonify(
        {
            "cases": [c.to_dict() for c in page_cases],
            "total": total,
            "count_mode": count_mode,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "next_cursor": next_cursor,
        }
    )


@api_cases_bp.route("/cases/count")
def count_cases():
    """Return only the total number of matching cases (lightweight endpoint)."""
    repo = get_repo()
    court, year, visa_type, keyword, source, tag, nature = _parse_case_list_filters()
    count_mode = request.args.get("count_mode", "planned").strip().lower()
    if count_mode not in ALLOWED_COUNT_MODES:
        return _error(f"Invalid count_mode '{count_mode}'. Allowed: {sorted(ALLOWED_COUNT_MODES)}")

    if hasattr(repo, "count_cases"):
        try:
            total, count_mode = _count_cases_with_fallback(
                repo,
                court=court,
                year=year,
                visa_type=visa_type,
                source=source,
                tag=tag,
                nature=nature,
                keyword=keyword,
                count_mode=count_mode,
            )
        except Exception:
            logger.warning("count endpoint fallback to 0", exc_info=True)
            total = 0
            count_mode = "planned"
    else:
        _, total = repo.filter_cases(
            court=court,
            year=year,
            visa_type=visa_type,
            source=source,
            tag=tag,
            nature=nature,
            keyword=keyword,
            page=1,
            page_size=1,
        )
        count_mode = "exact"

    return jsonify({"total": total, "count_mode": count_mode})


@api_cases_bp.route("/cases/<case_id>")
def get_case(case_id):
    if not _valid_case_id(case_id):
        return _error("Invalid case ID")
    repo = get_repo()
    case = repo.get_by_id(case_id)
    if not case:
        return _error("Case not found", 404)
    full_text = repo.get_case_full_text(case)
    return jsonify({"case": case.to_dict(), "full_text": full_text})


@api_cases_bp.route("/cases", methods=["POST"])
@rate_limit(30, 60, scope="cases-create")
def create_case():
    data = request.get_json(silent=True) or {}
    if not data.get("title") and not data.get("citation"):
        return _error("Title or citation is required")
    case = ImmigrationCase.from_dict(data)
    repo = get_repo()
    case = repo.add(case)
    _api._invalidate_cases_cache()
    return jsonify({"case": case.to_dict()}), 201


@api_cases_bp.route("/cases/<case_id>", methods=["PUT"])
@rate_limit(30, 60, scope="cases-update")
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
        _api._invalidate_cases_cache()
        updated = repo.get_by_id(case_id)
        return jsonify({"case": updated.to_dict() if updated else {}})
    return _error("Failed to update case", 500)


@api_cases_bp.route("/cases/<case_id>", methods=["DELETE"])
@rate_limit(10, 60, scope="cases-delete")
def delete_case(case_id):
    if not _valid_case_id(case_id):
        return _error("Invalid case ID")
    repo = get_repo()
    if repo.delete(case_id):
        _api._invalidate_cases_cache()
        return jsonify({"success": True})
    return _error("Failed to delete case", 500)


# ── Batch Operations ──────────────────────────────────────────────────────────

@api_cases_bp.route("/cases/batch", methods=["POST"])
@rate_limit(10, 60, scope="cases-batch")
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
        _api._invalidate_cases_cache()
    return jsonify({"affected": count})


# ── Compare ───────────────────────────────────────────────────────────────────

@api_cases_bp.route("/cases/compare")
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


# ── Related Cases ─────────────────────────────────────────────────────────────

@api_cases_bp.route("/cases/<case_id>/related")
def related_cases(case_id):
    if not _valid_case_id(case_id):
        return _error("Invalid case ID")
    repo = get_repo()
    limit = safe_int(
        request.args.get("limit"),
        default=DEFAULT_RELATED_LIMIT,
        min_val=1,
        max_val=MAX_RELATED_LIMIT,
    )
    related = repo.find_related(case_id, limit=limit)
    return jsonify({"cases": [c.to_dict() for c in related]})


# ── Similar Cases (pgvector semantic search) ──────────────────────────────────

@api_cases_bp.route("/cases/<case_id>/similar")
def similar_cases(case_id):
    """Return semantically similar cases using pgvector cosine similarity.

    Uses the existing ``search_cases_semantic`` RPC function (created in
    migration 20260223103000_add_pgvector_embeddings.sql) which leverages the
    HNSW index for fast approximate nearest-neighbour search.

    Falls back gracefully when:
    - The repository is not Supabase (CSV / SQLite backends)
    - The case has no embedding stored
    - Any RPC error occurs
    """
    if not _valid_case_id(case_id):
        return _error("Invalid case ID")

    limit = safe_int(
        request.args.get("limit"),
        default=DEFAULT_SIMILAR_LIMIT,
        min_val=1,
        max_val=MAX_SIMILAR_LIMIT,
    )

    repo = get_repo()

    # Only SupabaseRepository supports pgvector queries.
    from ...supabase_repository import SupabaseRepository
    if not isinstance(repo, SupabaseRepository):
        return jsonify({"similar": [], "available": False})

    try:
        # Step 1: fetch the case's embedding vector via RPC (avoids sending
        # 6 KB of raw vector bytes through the REST layer for every request).
        emb_resp = (
            repo._client
            .table("immigration_cases")
            .select("embedding, embedding_provider, embedding_model")
            .eq("case_id", case_id)
            .maybe_single()
            .execute()
        )
        emb_row = _supabase_row(emb_resp)
        if not emb_row or not emb_row.get("embedding"):
            return jsonify({"similar": [], "available": True})

        provider = emb_row.get("embedding_provider", "openai")
        model = emb_row.get("embedding_model", "text-embedding-3-small")
        embedding = emb_row["embedding"]

        # Step 2: call the existing RPC for ANN search, requesting limit+1
        # so we can exclude the query case itself from results.
        rpc_resp = repo._client.rpc("search_cases_semantic", {
            "p_query_embedding": embedding,
            "p_provider": provider,
            "p_model": model,
            "p_limit": limit + 1,
        }).execute()

        similar_ids_scores: list[tuple[str, float]] = [
            (r["case_id"], float(r["similarity"]))
            for r in _supabase_rows(rpc_resp)
            if r.get("case_id") and r["case_id"] != case_id
        ][:limit]

        if not similar_ids_scores:
            return jsonify({"similar": [], "available": True})

        # Step 3: fetch metadata for the similar case IDs.
        ids = [cid for cid, _ in similar_ids_scores]
        meta_resp = (
            repo._client
            .table("immigration_cases")
            .select("case_id, citation, title, outcome")
            .in_("case_id", ids)
            .execute()
        )
        meta_by_id: dict[str, dict] = {
            r["case_id"]: r for r in _supabase_rows(meta_resp)
        }

        # Step 4: assemble result list preserving similarity order.
        results = []
        for cid, score in similar_ids_scores:
            meta = meta_by_id.get(cid, {})
            results.append({
                "case_id": cid,
                "citation": meta.get("citation") or "",
                "title": meta.get("title") or "",
                "outcome": meta.get("outcome") or "",
                "similarity_score": round(score, 4),
            })

        return jsonify({"similar": results, "available": True})

    except Exception as exc:
        logger.warning("similar_cases RPC failed for %s: %s", case_id, exc)
        return jsonify({"similar": [], "available": False})


# ── Full-Text Search ──────────────────────────────────────────────────────────

@api_cases_bp.route("/search")
@rate_limit(60, 60, scope="search")
def search():
    query = request.args.get("q", "").strip()
    limit = safe_int(
        request.args.get("limit"),
        default=DEFAULT_SEARCH_LIMIT,
        min_val=1,
        max_val=MAX_SEARCH_LIMIT,
    )
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


# ── Free-Text Semantic Search ─────────────────────────────────────────────────

@api_cases_bp.route("/search/semantic")
@rate_limit(20, 60, scope="search-semantic")
def semantic_search():
    """Free-text vector search: embed query → HNSW ANN → return ranked cases.

    Query params:
        q        – search query (required, min 3 chars)
        limit    – max results (1-20, default 10)
        provider – embedding provider: "openai" (default) or "gemini"
        model    – override model name (optional)
    """
    query = (request.args.get("q") or "").strip()
    if not query:
        return _error("q parameter is required", 400)
    if len(query) < MIN_SEMANTIC_QUERY_LEN:
        return _error(f"q must be at least {MIN_SEMANTIC_QUERY_LEN} characters", 400)

    limit = safe_int(
        request.args.get("limit"),
        default=DEFAULT_SEMANTIC_SEARCH_LIMIT,
        min_val=1,
        max_val=MAX_SEMANTIC_SEARCH_LIMIT,
    )

    provider = (request.args.get("provider") or "openai").strip().lower()
    if provider not in ALLOWED_SEARCH_PROVIDERS:
        return _error(
            f"provider must be one of: {sorted(ALLOWED_SEARCH_PROVIDERS)}", 400
        )

    model = (request.args.get("model") or "").strip()

    payload = _run_semantic_search(query, limit=limit, provider=provider, model=model)
    return jsonify(payload)


# ── Filter Options ────────────────────────────────────────────────────────────

@api_cases_bp.route("/filter-options")
def filter_options():
    global _filter_options_cache_payload, _filter_options_cache_ts

    with _filter_options_cache_lock:
        if (
            _filter_options_cache_payload is not None
            and (time.time() - _filter_options_cache_ts) < _FILTER_OPTIONS_CACHE_TTL_SECONDS
        ):
            return jsonify(_filter_options_cache_payload)

    repo = get_repo()
    try:
        if hasattr(repo, "count_cases"):
            opts = _api._call_with_timeout(
                repo.get_filter_options,
                executor=_filter_options_executor,
            )
        else:
            opts = repo.get_filter_options()
        payload = _normalise_filter_options(opts)
    except FuturesTimeoutError:
        logger.warning("filter-options timed out; using fast fallback")
        with _filter_options_cache_lock:
            cached = _filter_options_cache_payload
        if cached is not None:
            return jsonify(cached)
        payload = _default_filter_options_payload()
    except Exception:
        logger.warning("filter-options failed; using sample fallback", exc_info=True)
        with _filter_options_cache_lock:
            cached = _filter_options_cache_payload
        if cached is not None:
            return jsonify(cached)
        payload = _sample_filter_options_fallback(repo)

    with _filter_options_cache_lock:
        _filter_options_cache_payload = payload
        _filter_options_cache_ts = time.time()

    return jsonify(payload)
