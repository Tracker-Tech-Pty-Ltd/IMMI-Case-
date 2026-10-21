"""Background job state and runner functions.

All public compatibility points still expose ``_job_lock`` and ``_job_status``,
but lifecycle operations now flow through ``job_manager`` for clearer state
ownership and safer snapshots.

Jobs accept an optional ``repo`` parameter (a CaseRepository instance).
When provided, data is persisted through the repository; otherwise a
CsvRepository is created as a fallback.
"""

import os
import logging

from ..config import AUSTLII_DATABASES, IMMIGRATION_KEYWORDS, END_YEAR
from ..storage import ensure_output_dirs
from .job_manager import JobManager
from .helpers import get_output_dir

logger = logging.getLogger(__name__)


# ── Global job state (protected by _job_lock) ────────────────────────────


def _default_job_status() -> dict:
    return {
        "running": False,
        "type": None,
        "progress": "",
        "total": 0,
        "completed": 0,
        "errors": [],
        "results": [],
    }


job_manager = JobManager(_default_job_status)
_job_lock = job_manager.lock
_job_status = job_manager.state


def _reset_job_status(new_status: dict):
    """Replace the shared job status contents in-place."""
    job_manager.replace(new_status)


def _set_job_fields(**fields):
    job_manager.update(**fields)


def _append_result(message: str):
    job_manager.append("results", message)


def _append_error(message: str):
    job_manager.append("errors", message)


def _increment_completed() -> int:
    return job_manager.increment("completed")


def _completed_plus_one() -> int:
    return int(job_manager.get("completed", 0)) + 1


def _notify_cache_invalidation() -> None:
    """Invalidate in-memory cases/analytics caches after a data-mutating job.

    Uses a lazy import to avoid a circular dependency between jobs.py and
    routes/api.py. The import succeeds once Flask has loaded the api blueprint,
    which always happens before any job can be started from a route handler.
    Silently no-ops if the api module is not yet loaded (e.g. in unit tests).
    """
    try:
        from .routes.api import _invalidate_cases_cache
        _invalidate_cases_cache()
    except Exception:
        pass  # Non-fatal: next TTL expiry will refresh the cache naturally


def _ensure_repo(repo, output_dir):
    """Return ``repo`` if given, else create a CsvRepository for *output_dir*."""
    if repo is not None:
        return repo
    from ..csv_repository import CsvRepository
    return CsvRepository(output_dir)


# ── Background job runners ───────────────────────────────────────────────


def _run_search_job(databases, start_year, end_year, max_results, search_fedcourt,
                    output_dir=None, repo=None):
    out = output_dir or get_output_dir()
    repo = _ensure_repo(repo, out)

    _reset_job_status({
        "running": True,
        "type": "search",
        "progress": "Starting search...",
        "total": len(databases) + (1 if search_fedcourt else 0),
        "completed": 0,
        "errors": [],
        "results": [],
    })

    ensure_output_dirs(out)
    all_cases = []

    try:
        from ..sources.austlii import AustLIIScraper

        scraper = AustLIIScraper(delay=1.0)
        for db_code in databases:
            _set_job_fields(
                progress=(
                    f"Searching {AUSTLII_DATABASES.get(db_code, {}).get('name', db_code)}..."
                ),
            )
            try:
                cases = scraper.search_cases(
                    databases=[db_code],
                    start_year=start_year,
                    end_year=end_year,
                    max_results_per_db=max_results,
                )
                all_cases.extend(cases)
                _append_result(f"{db_code}: {len(cases)} cases")
            except Exception as e:
                _append_error(f"{db_code}: {e}")
            _increment_completed()

        if search_fedcourt:
            _set_job_fields(progress="Searching Federal Court...")
            try:
                from ..sources.federal_court import FederalCourtScraper

                fc = FederalCourtScraper(delay=1.0)
                cases = fc.search_cases(start_year=start_year, end_year=end_year, max_results=max_results)
                existing_urls = {c.url for c in all_cases}
                new = [c for c in cases if c.url not in existing_urls]
                all_cases.extend(new)
                _append_result(f"Federal Court: {len(new)} cases")
            except Exception as e:
                _append_error(f"Federal Court: {e}")
            _increment_completed()

        # Assign IDs and deduplicate against existing
        for case in all_cases:
            case.ensure_id()

        existing_urls = repo.get_existing_urls()
        new_cases = [c for c in all_cases if c.url and c.url not in existing_urls]

        if new_cases:
            repo.save_many(new_cases)
            _notify_cache_invalidation()

        # Generate summary report (filesystem operation)
        try:
            from ..storage import generate_summary_report
            all_existing = repo.load_all()
            generate_summary_report(all_existing, out)
        except Exception:
            pass

        _set_job_fields(
            progress=(
                f"Done! Found {len(all_cases)} total, {len(new_cases)} new cases added."
            ),
        )

    except Exception as e:
        _append_error(f"Fatal: {e}")
        _set_job_fields(progress=f"Failed: {e}")

    _set_job_fields(running=False)


def _run_download_job(court_filter, limit, output_dir=None, repo=None):
    out = output_dir or get_output_dir()
    repo = _ensure_repo(repo, out)
    cases = repo.load_all()

    # Filter to cases without full text
    targets = [c for c in cases if not c.full_text_path or not os.path.exists(c.full_text_path)]
    if court_filter:
        targets = [c for c in targets if c.court_code == court_filter]
    targets = targets[:limit]
    originals = {case.case_id: case.to_dict() for case in targets}

    _reset_job_status({
        "running": True,
        "type": "download",
        "progress": f"Downloading {len(targets)} cases...",
        "total": len(targets),
        "completed": 0,
        "errors": [],
        "results": [],
    })

    try:
        from ..sources.austlii import AustLIIScraper
        from ..sources.federal_court import FederalCourtScraper
        from ..storage import save_case_text

        austlii = AustLIIScraper(delay=1.0)
        fedcourt = FederalCourtScraper(delay=1.0)
        austlii.source_cache_dir = out
        fedcourt.source_cache_dir = out

        ok = 0
        updated = []
        for case in targets:
            _set_job_fields(
                progress=(
                    f"[{_completed_plus_one()}/{len(targets)}] "
                    f"{case.citation or case.title[:50]}"
                ),
            )
            try:
                if case.source == "Federal Court":
                    text = fedcourt.download_case_detail(case)
                else:
                    text = austlii.download_case_detail(case)

                if text:
                    save_case_text(case, text, out)
                    updated.append(case)
                    ok += 1
                else:
                    _append_error(f"{case.citation or case.case_id}: no content")
            except Exception as e:
                _append_error(f"{case.citation or case.case_id}: {e}")
            _increment_completed()

        # Persist updated full_text_path via upsert
        if updated:
            from ..ingestion import persist_downloads
            persist_downloads(repo, updated, originals, out)
            _notify_cache_invalidation()

        _set_job_fields(progress=f"Done! Downloaded {ok}/{len(targets)} cases.")
        _append_result(f"Downloaded: {ok}, Failed: {len(targets)-ok}")

    except Exception as e:
        _append_error(f"Fatal: {e}")
        _set_job_fields(progress=f"Failed: {e}")

    _set_job_fields(running=False)


def _run_update_job(mode, databases=None, start_year=None, end_year=None,
                    delay=0.5, output_dir=None, repo=None):
    """Background job: crawl AustLII for new cases and merge."""
    out = output_dir or get_output_dir()
    repo = _ensure_repo(repo, out)

    from ..sources.austlii import AustLIIScraper

    if mode == "quick":
        databases = ["AATA", "ARTA", "FCA", "FedCFamC2G", "HCA"]
        years = [END_YEAR, END_YEAR - 1]
        total_steps = len(databases) * len(years)
    else:
        databases = databases or ["AATA"]
        start_year = start_year or END_YEAR
        end_year = end_year or END_YEAR
        years = list(range(start_year, end_year + 1))
        total_steps = len(databases) * len(years)

    _reset_job_status({
        "running": True,
        "type": "update",
        "progress": "Initializing...",
        "total": total_steps,
        "completed": 0,
        "errors": [],
        "results": [],
    })

    try:
        scraper = AustLIIScraper(delay=delay)
        ensure_output_dirs(out)

        existing_urls = repo.get_existing_urls()
        all_new = []

        for db_code in databases:
            if db_code not in AUSTLII_DATABASES:
                _append_error(f"Unknown database: {db_code}")
                continue

            db_info = AUSTLII_DATABASES[db_code]

            for year in years:
                _set_job_fields(progress=f"Crawling {db_code} {year}...")
                try:
                    cases = scraper._browse_year(
                        db_code, db_info, year, IMMIGRATION_KEYWORDS
                    )
                    added = 0
                    for case in cases:
                        case.ensure_id()
                        if case.url and case.url not in existing_urls:
                            all_new.append(case)
                            existing_urls.add(case.url)
                            added += 1
                    _append_result(f"{db_code} {year}: {len(cases)} found, {added} new")
                except Exception as e:
                    _append_error(f"{db_code} {year}: {e}")

                _increment_completed()

        # Save all new cases via repository
        if all_new:
            repo.save_many(all_new)
            _notify_cache_invalidation()

        _set_job_fields(progress=f"Done! Added {len(all_new)} new cases.")

    except Exception as e:
        _append_error(f"Fatal: {e}")
        _set_job_fields(progress=f"Failed: {e}")

    _set_job_fields(running=False)


def _run_bulk_download_job(court_filter, limit, delay, output_dir, repo=None):
    """Background job: download full text for many cases at once."""
    out = output_dir or get_output_dir()
    repo = _ensure_repo(repo, out)

    from ..sources.austlii import AustLIIScraper
    from ..storage import save_case_text

    cases = repo.load_all()
    targets = [
        c for c in cases
        if not c.full_text_path or not os.path.exists(c.full_text_path)
    ]
    if court_filter:
        targets = [c for c in targets if c.court_code == court_filter]
    targets = targets[:limit]
    originals = {case.case_id: case.to_dict() for case in targets}

    _reset_job_status({
        "running": True,
        "type": "bulk download",
        "progress": f"Downloading {len(targets)} cases...",
        "total": len(targets),
        "completed": 0,
        "errors": [],
        "results": [],
    })

    try:
        scraper = AustLIIScraper(delay=delay)
        scraper.source_cache_dir = out
        from ..ingestion import persist_downloads
        ok = 0
        fail = 0
        updated_batch = []

        for case in targets:
            _set_job_fields(
                progress=(
                    f"[{_completed_plus_one()}/{len(targets)}] "
                    f"{case.citation or case.title[:50]}"
                ),
            )
            try:
                text = scraper.download_case_detail(case)
                if text:
                    save_case_text(case, text, out)
                    updated_batch.append(case)
                    ok += 1
                else:
                    fail += 1
            except Exception as e:
                fail += 1
                if fail <= 20:
                    _append_error(f"{case.citation or case.case_id}: {e}")
            _increment_completed()

            # Checkpoint save every 200 successful downloads
            if ok > 0 and ok % 200 == 0 and updated_batch:
                _append_result(f"Checkpoint: {ok} downloaded so far")
                persist_downloads(repo, updated_batch, originals, out)
                updated_batch.clear()

        # Final save
        if updated_batch:
            persist_downloads(repo, updated_batch, originals, out)

        if ok > 0:
            _notify_cache_invalidation()

        _set_job_fields(progress=f"Done! Downloaded {ok}/{len(targets)} cases.")
        _append_result(f"Total: {ok} downloaded, {fail} failed")

    except Exception as e:
        _append_error(f"Fatal: {e}")
        _set_job_fields(progress=f"Failed: {e}")

    _set_job_fields(running=False)
