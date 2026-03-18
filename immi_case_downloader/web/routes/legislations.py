"""API endpoints for legislations (list, detail, search, update).

All endpoints are prefixed with /api/v1/legislations/.
Returns consistent JSON response format with error handling.

Endpoints:
  GET  /                  — Paginated list (sections excluded for size)
  GET  /search?q=...      — Full-text search across title/description
  GET  /<id>              — Full detail including sections[]
  POST /update            — Start background scrape job
  GET  /update/status     — Poll scrape job progress
"""

import json
import logging
import os
import threading
from typing import Any

from flask import Blueprint, jsonify, request

from ...sources.legislation_scraper import KNOWN_LAWS, LegislationScraper
from ..job_manager import JobManager
from ..security import rate_limit

logger = logging.getLogger(__name__)

legislations_bp = Blueprint("legislations", __name__, url_prefix="/api/v1/legislations")

# ── In-memory state ───────────────────────────────────────────────────────────

# Cache for legislations data (invalidated after a successful scrape)
_legislations_cache: list[dict[str, Any]] | None = None

def _default_legislation_job_status() -> dict[str, Any]:
    return {
        "running": False,
        "law_id": None,       # which law is currently being scraped
        "current": 0,
        "total": 0,
        "section_id": "",
        "completed_laws": [],
        "failed_laws": [],
        "error": None,
    }


legislation_job_manager = JobManager(_default_legislation_job_status)
_job_status = legislation_job_manager.state
_job_lock = legislation_job_manager.lock

# ── Helpers ───────────────────────────────────────────────────────────────────


def _data_path() -> str:
    pkg_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    return os.path.join(pkg_dir, "data", "legislations.json")


def _load_legislations() -> list[dict[str, Any]]:
    """Load legislations from JSON file, using cache if available."""
    global _legislations_cache
    if _legislations_cache is not None:
        return _legislations_cache

    path = _data_path()
    if not os.path.exists(path):
        logger.error(f"Legislations data file not found: {path}")
        return []

    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        legislations: list[dict[str, Any]] = data.get("legislations", [])
        _legislations_cache = legislations
        logger.info(f"Loaded {len(legislations)} legislations from {path}")
        return legislations
    except (json.JSONDecodeError, IOError) as e:
        logger.error(f"Failed to load legislations: {e}")
        return []


def _invalidate_cache() -> None:
    global _legislations_cache
    _legislations_cache = None


def _strip_sections(leg: dict) -> dict:
    """Return a copy of a legislation dict without the sections[] array.

    Used for list and search endpoints to keep response sizes small.
    """
    return {k: v for k, v in leg.items() if k != "sections"}


def _error(msg: str, status: int = 400):
    return jsonify({"error": msg}), status


# ── List ──────────────────────────────────────────────────────────────────────


@legislations_bp.route("", methods=["GET"])
def list_legislations():
    """List all legislations with pagination. sections[] is excluded.

    Query parameters:
      page  (int, default 1)
      limit (int, default 10, max 100)
    """
    try:
        page = request.args.get("page", 1, type=int)
        limit = request.args.get("limit", 10, type=int)

        if page < 1:
            return _error("page must be >= 1")
        if limit < 1:
            return _error("limit must be >= 1")
        limit = min(limit, 100)

        legislations = _load_legislations()
        total = len(legislations)

        if not total:
            return jsonify({"success": True, "data": [],
                            "meta": {"total": 0, "page": page, "limit": limit, "pages": 0}})

        total_pages = (total + limit - 1) // limit
        if page > total_pages:
            return _error(f"page must be <= {total_pages}")

        start = (page - 1) * limit
        data = [_strip_sections(leg) for leg in legislations[start:start + limit]]

        return jsonify({
            "success": True,
            "data": data,
            "meta": {"total": total, "page": page, "limit": limit, "pages": total_pages},
        })

    except Exception as e:
        logger.error(f"Error listing legislations: {e}")
        return _error("Failed to list legislations", 500)


# ── Search ────────────────────────────────────────────────────────────────────


@legislations_bp.route("/search", methods=["GET"])
def search_legislations():
    """Search legislations by query string. sections[] is excluded.

    Query parameters:
      q     (str, required, min 2 chars) — searches title, description, shortcode, id
      limit (int, default 20, max 100)
    """
    try:
        query = request.args.get("q", "").strip()
        limit = min(request.args.get("limit", 20, type=int), 100)

        if not query:
            return _error("q parameter is required")
        if len(query) < 2:
            return _error("Query must be at least 2 characters")
        if limit < 1:
            return _error("limit must be >= 1")

        legislations = _load_legislations()
        q = query.lower()

        results = []
        total_matched = 0
        for leg in legislations:
            fields = [leg.get("title", ""), leg.get("description", ""),
                      leg.get("shortcode", ""), leg.get("id", "")]
            if any(q in f.lower() for f in fields):
                total_matched += 1
                if len(results) < limit:
                    results.append(_strip_sections(leg))

        return jsonify({
            "success": True,
            "data": results,
            "meta": {"query": query, "total_results": total_matched, "limit": limit},
        })

    except Exception as e:
        logger.error(f"Error searching legislations: {e}")
        return _error("Failed to search legislations", 500)


# ── Detail ────────────────────────────────────────────────────────────────────


@legislations_bp.route("/<legislation_id>", methods=["GET"])
def get_legislation(legislation_id: str):
    """Get a specific legislation by ID, including full sections[] array."""
    try:
        legislation_id = legislation_id.strip().lower()
        if not legislation_id:
            return _error("legislation_id is required")

        for leg in _load_legislations():
            if leg.get("id", "").lower() == legislation_id:
                return jsonify({"success": True, "data": leg})

        return _error(f"Legislation '{legislation_id}' not found", 404)

    except Exception as e:
        logger.error(f"Error fetching legislation {legislation_id}: {e}")
        return _error("Failed to fetch legislation", 500)


# ── Update (background scrape job) ────────────────────────────────────────────


@legislations_bp.route("/update", methods=["POST"])
@rate_limit(5, 60, scope="legislations-update")
def start_update():
    """Start a background scrape job for one or all laws.

    Body (JSON, optional):
      { "law_id": "migration-act-1958" }  — scrape one law
      {}                                   — scrape all laws

    Returns 409 if a job is already running.
    """
    body = request.get_json(silent=True) or {}
    law_id = body.get("law_id")

    if law_id and law_id not in KNOWN_LAWS:
        return _error(f"Unknown law_id: {law_id}. Available: {list(KNOWN_LAWS)}")

    law_ids = [law_id] if law_id else list(KNOWN_LAWS.keys())

    if not legislation_job_manager.reserve(
        {
            "running": True,
            "law_id": law_id,
            "current": 0,
            "total": 0,
            "section_id": "",
            "completed_laws": [],
            "failed_laws": [],
            "error": None,
        },
    ):
        return jsonify({
            "success": False,
            "error": "A scrape job is already running",
            "status": legislation_job_manager.snapshot(),
        }), 409

    thread = threading.Thread(target=_run_scrape_job, args=(law_ids,), daemon=True)
    try:
        thread.start()
    except Exception:
        legislation_job_manager.reset()
        raise
    return jsonify({"success": True, "message": "Scrape job started", "laws": law_ids})


@legislations_bp.route("/update/status", methods=["GET"])
def update_status():
    """Poll the current scrape job status."""
    return jsonify({"success": True, "status": legislation_job_manager.snapshot()})


def _run_scrape_job(law_ids: list[str]) -> None:
    """Background thread: scrape laws and write results to legislations.json."""
    scraper = LegislationScraper()

    def progress(law_id: str, current: int, total: int, section_id: str) -> None:
        legislation_job_manager.update(
            law_id=law_id,
            current=current,
            total=total,
            section_id=section_id,
        )

    try:
        # Load existing data to merge into
        path = _data_path()
        try:
            with open(path, encoding="utf-8") as f:
                existing = json.load(f)
        except (json.JSONDecodeError, IOError):
            existing = {"legislations": []}

        existing_by_id = {leg["id"]: leg for leg in existing.get("legislations", [])}

        for law_id in law_ids:
            result = scraper.scrape_one(law_id, progress_callback=progress)
            if result:
                existing_by_id[law_id] = result
                legislation_job_manager.append("completed_laws", law_id)
                logger.info(f"Scrape complete: {law_id} ({result['sections_count']} sections)")
            else:
                legislation_job_manager.append("failed_laws", law_id)
                logger.error(f"Scrape failed: {law_id}")

        # Preserve canonical law order when writing
        all_laws = []
        for lid in KNOWN_LAWS:
            if lid in existing_by_id:
                all_laws.append(existing_by_id[lid])

        output = {
            "_comment": "Populated by scripts/download_legislations.py — do not edit sections manually",
            "legislations": all_laws,
        }
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)

        _invalidate_cache()
        logger.info(f"Legislations saved: {len(all_laws)} laws")

    except Exception as e:
        legislation_job_manager.update(error=str(e))
        logger.error(f"Scrape job failed: {e}", exc_info=True)
    finally:
        legislation_job_manager.update(running=False)


# ── App registration ──────────────────────────────────────────────────────────


def init_routes(app):
    """Register legislations blueprint with Flask app."""
    app.register_blueprint(legislations_bp)
    logger.info("Legislations API blueprint registered")
