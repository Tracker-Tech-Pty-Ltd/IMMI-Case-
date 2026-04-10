"""Smart Pipeline engine — orchestrates crawl, clean, and download phases.

This module is independent of Flask and can be used from CLI or web UI.
It wraps existing scraper methods with auto-fallback strategy rotation,
structured debug logging, and checkpoint-based progress tracking.
"""

import copy
import os
import re
import threading
import logging
from dataclasses import dataclass, field
from datetime import datetime

from .config import (
    AUSTLII_DATABASES,
    IMMIGRATION_KEYWORDS,
    OUTPUT_DIR,
    END_YEAR,
)
from .models import ImmigrationCase
from .storage import (
    ensure_output_dirs,
    load_all_cases,
    save_cases_csv,
    save_cases_json,
    save_case_text,
)

logger = logging.getLogger(__name__)

# Error categories worth retrying (transient server/network issues)
RETRYABLE_ERRORS = frozenset({
    "http_500", "http_502", "http_503", "http_504",
    "http_429", "http_timeout", "connection_error",
})


# ── Configuration ────────────────────────────────────────────────────────

@dataclass
class PipelineConfig:
    """User-configurable pipeline settings."""

    # Crawl phase
    databases: list = field(default_factory=lambda: ["AATA", "ARTA", "FCA", "FedCFamC2G"])
    start_year: int = END_YEAR - 1
    end_year: int = END_YEAR
    delay: float = 0.5

    # Strategy settings
    crawl_strategies: tuple = ("direct", "viewdb", "keyword_search")
    auto_rotate: bool = True
    max_consecutive_failures: int = 3

    # Clean phase
    fix_year_zero: bool = True
    deduplicate: bool = True

    # Download phase
    download_enabled: bool = True
    download_batch_size: int = 1000
    download_court_filter: str = ""

    def to_dict(self) -> dict:
        return {
            "databases": self.databases,
            "start_year": self.start_year,
            "end_year": self.end_year,
            "delay": self.delay,
            "auto_rotate": self.auto_rotate,
            "max_consecutive_failures": self.max_consecutive_failures,
            "fix_year_zero": self.fix_year_zero,
            "deduplicate": self.deduplicate,
            "download_enabled": self.download_enabled,
            "download_batch_size": self.download_batch_size,
            "download_court_filter": self.download_court_filter,
        }

    @classmethod
    def from_form(cls, form) -> "PipelineConfig":
        """Build config from a Flask form dict with input validation."""

        def safe_int(val, default: int) -> int:
            try:
                return int(val)
            except (ValueError, TypeError):
                return default

        def safe_float(val, default: float, minimum: float = 0.1) -> float:
            try:
                return max(minimum, float(val))
            except (ValueError, TypeError):
                return default

        preset = form.get("preset", "")
        if preset == "quick":
            return cls(
                databases=["AATA", "ARTA", "FCA", "FedCFamC2G", "HCA"],
                start_year=END_YEAR - 1,
                end_year=END_YEAR,
                delay=safe_float(form.get("delay"), 0.5),
                download_enabled=form.get("download_enabled") == "on",
            )
        if preset == "full":
            return cls(
                databases=["AATA", "ARTA", "FCA", "FCCA", "FedCFamC2G", "HCA"],
                start_year=2010,
                end_year=END_YEAR,
                delay=safe_float(form.get("delay"), 1.0),
                download_enabled=form.get("download_enabled") == "on",
            )
        if preset == "download_only":
            return cls(
                databases=[],
                download_enabled=True,
                download_batch_size=max(1, safe_int(form.get("download_batch_size"), 1000)),
                download_court_filter=form.get("download_court_filter", ""),
            )

        # Custom config with validated inputs
        start_year = safe_int(form.get("start_year"), END_YEAR - 1)
        end_year = safe_int(form.get("end_year"), END_YEAR)
        if start_year > end_year:
            start_year, end_year = end_year, start_year

        return cls(
            databases=form.getlist("databases") if hasattr(form, "getlist") else form.get("databases", []),
            start_year=start_year,
            end_year=end_year,
            delay=safe_float(form.get("delay"), 0.5),
            auto_rotate=form.get("auto_rotate") != "off",
            fix_year_zero=form.get("fix_year_zero") != "off",
            deduplicate=form.get("deduplicate") != "off",
            download_enabled=form.get("download_enabled") == "on",
            download_batch_size=max(1, safe_int(form.get("download_batch_size"), 1000)),
            download_court_filter=form.get("download_court_filter", ""),
        )


# ── Structured Logging ──────────────────────────────────────────────────

@dataclass
class PipelineEvent:
    """A single structured log event."""

    timestamp: str
    phase: str       # "crawl" | "clean" | "download"
    level: str       # "info" | "warn" | "error" | "success" | "debug"
    category: str    # "strategy_switch" | "http_error" | "parse_error" | etc.
    message: str
    details: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp,
            "phase": self.phase,
            "level": self.level,
            "category": self.category,
            "message": self.message,
            "details": self.details,
        }


class PipelineLog:
    """Thread-safe structured log collector."""

    def __init__(self):
        self._events: list[PipelineEvent] = []
        self._lock = threading.Lock()

    def add(self, phase: str, level: str, category: str, message: str, **details):
        event = PipelineEvent(
            timestamp=datetime.now().isoformat(timespec="seconds"),
            phase=phase,
            level=level,
            category=category,
            message=message,
            details=details,
        )
        with self._lock:
            self._events.append(event)
        if level == "error":
            logger.error(f"[pipeline:{phase}] {message}")
        elif level == "warn":
            logger.warning(f"[pipeline:{phase}] {message}")
        else:
            logger.info(f"[pipeline:{phase}] {message}")

    def get_events(self, phase: str = "", level: str = "", limit: int = 200) -> list[dict]:
        with self._lock:
            events = list(self._events)
        if phase:
            events = [e for e in events if e.phase == phase]
        if level:
            events = [e for e in events if e.level == level]
        return [e.to_dict() for e in events[-limit:]]

    def get_error_summary(self) -> dict:
        """Group error events by category with counts."""
        with self._lock:
            errors = [e for e in self._events if e.level == "error"]
        summary = {}
        for e in errors:
            cat = e.category
            summary.setdefault(cat, {"count": 0, "recent": ""})
            summary[cat]["count"] += 1
            summary[cat]["recent"] = e.message
        return summary

    def to_json(self) -> list[dict]:
        with self._lock:
            return [e.to_dict() for e in self._events]


# ── Pipeline Runner ─────────────────────────────────────────────────────

_INITIAL_STATUS = {
    "running": False,
    "phase": "",
    "phase_progress": "",
    "overall_progress": 0,
    "config": {},
    "phases_completed": [],
    "stats": {
        "crawl": {"total_found": 0, "new_added": 0, "strategies_used": {}},
        "clean": {"year_fixed": 0, "dupes_removed": 0, "validated": 0},
        "download": {"downloaded": 0, "failed": 0, "skipped": 0, "retried": 0},
    },
    "errors": [],
    "log": [],
    "retry_queue": [],
    "current_strategy": "direct",
    "stop_requested": False,
}


class SmartPipeline:
    """Three-phase pipeline: crawl -> clean -> download."""

    def __init__(self, config: PipelineConfig, output_dir: str = OUTPUT_DIR):
        self.config = config
        self.output_dir = output_dir
        self.log = PipelineLog()
        self._strategy_state: dict[str, int] = {}  # db_code -> strategy index
        self._consecutive_failures: dict[str, int] = {}  # db_code -> fail count
        self._status = copy.deepcopy(_INITIAL_STATUS)
        self._lock = threading.Lock()

    def get_status(self) -> dict:
        """Return a deep copy of pipeline status, safe for cross-thread reads."""
        with self._lock:
            return copy.deepcopy(self._status)

    def request_stop(self):
        """Signal the pipeline to stop after the current unit of work."""
        with self._lock:
            self._status["stop_requested"] = True

    def run(self):
        """Execute all pipeline phases. Called in a background thread."""
        with self._lock:
            self._status.update({
                "running": True,
                "phase": "",
                "phase_progress": "",
                "overall_progress": 0,
                "config": self.config.to_dict(),
                "phases_completed": [],
                "stats": {
                    "crawl": {"total_found": 0, "new_added": 0, "strategies_used": {}},
                    "clean": {"year_fixed": 0, "dupes_removed": 0, "validated": 0},
                    "download": {"downloaded": 0, "failed": 0, "skipped": 0, "retried": 0},
                },
                "errors": [],
                "log": [],
                "retry_queue": [],
                "current_strategy": "direct",
                "stop_requested": False,
            })

        ensure_output_dirs(self.output_dir)

        try:
            # Phase 1: Crawl (only if databases specified)
            if self.config.databases:
                self._run_crawl_phase()
                if self._is_stopped():
                    return

            # Phase 2: Clean
            self._run_clean_phase()
            if self._is_stopped():
                return

            # Phase 3: Download (if enabled)
            if self.config.download_enabled:
                self._run_download_phase()

            self.log.add("pipeline", "success", "complete", "Pipeline finished successfully.")
            self._update_status(phase_progress="Pipeline complete!", overall_progress=100)

        except Exception as e:
            self.log.add("pipeline", "error", "fatal", f"Pipeline crashed: {e}")
            self._update_status(phase_progress=f"Pipeline failed: {e}")

        finally:
            with self._lock:
                self._status["running"] = False
                self._status["log"] = self.log.to_json()
                self._status["errors"] = self.log.get_events(level="error")

    # ── Phase 1: Crawl ───────────────────────────────────────────────

    def _run_crawl_phase(self):
        self._update_status(phase="crawl", phase_progress="Starting crawl...", overall_progress=5)
        self.log.add("crawl", "info", "phase_start", "Crawl phase started.")

        from .sources.austlii import AustLIIScraper

        scraper = AustLIIScraper(delay=self.config.delay)
        existing = load_all_cases(self.output_dir)
        existing_urls = {c.url for c in existing}
        total_added = 0
        total_found = 0

        databases = self.config.databases
        years = list(range(self.config.start_year, self.config.end_year + 1))
        total_steps = len(databases) * len(years)
        step = 0

        for db_code in databases:
            if db_code not in AUSTLII_DATABASES:
                self.log.add("crawl", "warn", "unknown_db", f"Unknown database: {db_code}", db_code=db_code)
                continue

            db_info = AUSTLII_DATABASES[db_code]
            self._strategy_state[db_code] = 0
            self._consecutive_failures[db_code] = 0

            for year in years:
                if self._is_stopped():
                    return

                step += 1
                pct = 5 + int((step / max(total_steps, 1)) * 30)
                self._update_status(
                    phase_progress=f"Crawling {db_code} {year}...",
                    overall_progress=pct,
                )

                cases = self._crawl_with_fallback(scraper, db_code, db_info, year)
                total_found += len(cases)

                added = 0
                for case in cases:
                    if case.url not in existing_urls:
                        case.ensure_id()
                        existing.append(case)
                        existing_urls.add(case.url)
                        added += 1
                total_added += added

                self.log.add(
                    "crawl", "info", "year_done",
                    f"{db_code} {year}: {len(cases)} found, {added} new",
                    db_code=db_code, year=year, found=len(cases), new=added,
                )

        # Save crawl results
        if total_added > 0:
            save_cases_csv(existing, self.output_dir)
            save_cases_json(existing, self.output_dir)

        with self._lock:
            self._status["stats"]["crawl"] = {
                "total_found": total_found,
                "new_added": total_added,
                "strategies_used": dict(self._strategy_state),
            }
            self._status["phases_completed"].append("crawl")

        self.log.add(
            "crawl", "success", "phase_done",
            f"Crawl complete: {total_found} found, {total_added} new. Total: {len(existing)}.",
        )

    def _crawl_with_fallback(self, scraper, db_code, db_info, year) -> list:
        """Try crawl strategies in order, rotating on repeated failures."""
        strategies = list(self.config.crawl_strategies)
        start_idx = self._strategy_state.get(db_code, 0)

        for attempt in range(len(strategies)):
            idx = (start_idx + attempt) % len(strategies)
            strategy = strategies[idx]

            try:
                cases = self._execute_strategy(scraper, strategy, db_code, db_info, year)
                if cases is not None:
                    # Success — reset failure counter
                    self._consecutive_failures[db_code] = 0
                    with self._lock:
                        self._status["current_strategy"] = strategy
                    return cases if cases else []
            except Exception as e:
                self.log.add(
                    "crawl", "warn", "strategy_error",
                    f"{strategy} failed for {db_code}/{year}: {e}",
                    strategy=strategy, db_code=db_code, year=year, error=str(e),
                )

            # Strategy failed — increment and maybe rotate
            self._consecutive_failures[db_code] = self._consecutive_failures.get(db_code, 0) + 1

            if (self.config.auto_rotate
                    and self._consecutive_failures[db_code] >= self.config.max_consecutive_failures):
                new_idx = (idx + 1) % len(strategies)
                self._strategy_state[db_code] = new_idx
                self._consecutive_failures[db_code] = 0
                self.log.add(
                    "crawl", "warn", "strategy_switch",
                    f"Switching {db_code} from '{strategy}' to '{strategies[new_idx]}' after {self.config.max_consecutive_failures} failures",
                    db_code=db_code, old_strategy=strategy, new_strategy=strategies[new_idx],
                )

        return []

    def _execute_strategy(self, scraper, strategy, db_code, db_info, year):
        """Execute a specific crawl strategy. Returns list of cases or None on failure."""
        if strategy == "direct":
            return scraper._browse_year(db_code, db_info, year, IMMIGRATION_KEYWORDS)

        elif strategy == "viewdb":
            from .config import AUSTLII_BASE
            url = f"{AUSTLII_BASE}/cgi-bin/viewdb/au/cases/cth/{db_code}/"
            response = scraper.fetch(url, params={"year": str(year)})
            if not response:
                return None
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(response.text, "lxml")
            return self._parse_viewdb_cases(soup, scraper, db_code, db_info, year)

        elif strategy == "keyword_search":
            return scraper._keyword_search(db_code, db_info, IMMIGRATION_KEYWORDS, year, year)

        return None

    def _parse_viewdb_cases(self, soup, scraper, db_code, db_info, year) -> list:
        """Parse viewdb response into case list."""
        from urllib.parse import urljoin
        from .config import AUSTLII_BASE

        cases = []
        for link in soup.find_all("a", href=True):
            href = link.get("href", "")
            text = link.get_text(strip=True)

            if f"/au/cases/cth/{db_code}/" not in href:
                continue
            if not re.search(r"/\d+\.html", href):
                continue

            full_text = text.lower()
            parent = link.parent
            if parent:
                full_text += " " + parent.get_text(strip=True).lower()

            if scraper._is_immigration_case(full_text, IMMIGRATION_KEYWORDS):
                case_url = urljoin(AUSTLII_BASE, href)
                case = ImmigrationCase(
                    title=text,
                    court=db_info["name"],
                    court_code=db_code,
                    year=year,
                    url=case_url,
                    source="AustLII",
                )
                citation_match = re.search(rf"\[{year}\]\s+{db_code}\s+\d+", text)
                if citation_match:
                    case.citation = citation_match.group(0)
                cases.append(case)
        return cases

    # ── Phase 2: Clean ───────────────────────────────────────────────

    def _run_clean_phase(self):
        self._update_status(phase="clean", phase_progress="Cleaning data...", overall_progress=40)
        self.log.add("clean", "info", "phase_start", "Clean phase started.")

        cases = load_all_cases(self.output_dir)
        year_fixed = 0
        dupes_removed = 0

        # Fix year=0: extract from citation [YYYY]
        if self.config.fix_year_zero:
            for case in cases:
                if case.year == 0 and case.citation:
                    match = re.search(r"\[(\d{4})\]", case.citation)
                    if match:
                        case.year = int(match.group(1))
                        year_fixed += 1
                elif case.year == 0 and case.url:
                    match = re.search(r"/(\d{4})/", case.url)
                    if match:
                        case.year = int(match.group(1))
                        year_fixed += 1

            if year_fixed > 0:
                self.log.add("clean", "info", "year_fix", f"Fixed {year_fixed} cases with year=0")

        # Deduplicate by URL
        if self.config.deduplicate:
            before_count = len(cases)
            seen_urls = set()
            unique = []
            for case in cases:
                if case.url not in seen_urls:
                    seen_urls.add(case.url)
                    unique.append(case)
            dupes_removed = before_count - len(unique)
            cases = unique

            if dupes_removed > 0:
                self.log.add("clean", "info", "dedup", f"Removed {dupes_removed} duplicate cases")

        # Validate required fields
        validated = sum(1 for c in cases if c.url and c.title and c.court_code)
        invalid = len(cases) - validated
        if invalid > 0:
            self.log.add("clean", "warn", "validation", f"{invalid} cases missing required fields")

        # Save cleaned data
        save_cases_csv(cases, self.output_dir)
        save_cases_json(cases, self.output_dir)

        with self._lock:
            self._status["stats"]["clean"] = {
                "year_fixed": year_fixed,
                "dupes_removed": dupes_removed,
                "validated": validated,
            }
            self._status["phases_completed"].append("clean")

        self.log.add(
            "clean", "success", "phase_done",
            f"Clean complete: {year_fixed} year-fixed, {dupes_removed} dupes removed, {validated} valid.",
        )

    # ── Phase 3: Download ────────────────────────────────────────────

    def _run_download_phase(self):
        self._update_status(phase="download", phase_progress="Preparing downloads...", overall_progress=50)
        self.log.add("download", "info", "phase_start", "Download phase started.")

        from .sources.austlii import AustLIIScraper

        scraper = AustLIIScraper(delay=self.config.delay)
        cases = load_all_cases(self.output_dir)

        # Filter to cases without full text
        targets = [
            c for c in cases
            if not c.full_text_path or not os.path.exists(c.full_text_path)
        ]
        if self.config.download_court_filter:
            targets = [c for c in targets if c.court_code == self.config.download_court_filter]
        targets = targets[:self.config.download_batch_size]

        if not targets:
            self.log.add("download", "info", "no_targets", "No cases to download.")
            with self._lock:
                self._status["phases_completed"].append("download")
            return

        self.log.add("download", "info", "targets", f"{len(targets)} cases queued for download.")
        downloaded = 0
        failed = 0
        skipped = 0
        retry_queue = []

        for i, case in enumerate(targets):
            if self._is_stopped():
                return

            pct = 50 + int(((i + 1) / len(targets)) * 45)
            self._update_status(
                phase_progress=f"[{i+1}/{len(targets)}] {case.citation or case.title[:50]}",
                overall_progress=pct,
            )

            try:
                text = scraper.download_case_detail(case)
                if text:
                    save_case_text(case, text, self.output_dir)
                    downloaded += 1
                else:
                    # Check if the error is retryable (transient network/server issue)
                    error_info = getattr(scraper, "last_error", None)
                    category = error_info.get("category", "") if error_info else ""
                    if category in RETRYABLE_ERRORS:
                        retry_queue.append(case.case_id)
                        self.log.add(
                            "download", "warn", category,
                            f"Will retry: {case.citation or case.case_id}",
                            case_id=case.case_id,
                        )
                    else:
                        failed += 1
                        self.log.add(
                            "download", "warn", "empty_content",
                            f"No content: {case.citation or case.case_id}",
                            case_id=case.case_id,
                        )
            except Exception as e:
                failed += 1
                retry_queue.append(case.case_id)
                self.log.add(
                    "download", "error", "download_error",
                    f"Failed: {case.citation or case.case_id}: {e}",
                    case_id=case.case_id, error=str(e),
                )

            # Checkpoint save every 200
            if downloaded > 0 and downloaded % 200 == 0:
                self._save_download_progress(targets[:i + 1])
                self.log.add("download", "info", "checkpoint", f"Checkpoint: {downloaded} downloaded")

        # Retry queue (one pass with longer delay)
        retried = 0
        if retry_queue:
            self.log.add("download", "info", "retry_start", f"Retrying {len(retry_queue)} failed downloads...")
            scraper.delay = min(self.config.delay * 3, 3.0)
            case_map = {c.case_id: c for c in targets}

            for cid in retry_queue:
                if self._is_stopped():
                    break
                case = case_map.get(cid)
                if not case:
                    continue
                try:
                    text = scraper.download_case_detail(case)
                    if text:
                        save_case_text(case, text, self.output_dir)
                        retried += 1
                        failed -= 1
                except Exception:
                    pass

        # Final save
        self._save_download_progress(targets)

        with self._lock:
            self._status["stats"]["download"] = {
                "downloaded": downloaded + retried,
                "failed": failed,
                "skipped": skipped,
                "retried": retried,
            }
            self._status["retry_queue"] = retry_queue
            self._status["phases_completed"].append("download")

        self.log.add(
            "download", "success", "phase_done",
            f"Download complete: {downloaded + retried} downloaded, {failed} failed, {retried} retried.",
        )

    def _save_download_progress(self, processed_targets):
        """Persist full_text_path from processed targets back to main CSV."""
        all_cases = load_all_cases(self.output_dir)
        target_map = {c.case_id: c for c in processed_targets}
        for c in all_cases:
            if c.case_id in target_map and target_map[c.case_id].full_text_path:
                c.full_text_path = target_map[c.case_id].full_text_path
        save_cases_csv(all_cases, self.output_dir)

    # ── Helpers ──────────────────────────────────────────────────────

    def _is_stopped(self) -> bool:
        with self._lock:
            stopped = self._status.get("stop_requested", False)
        if stopped:
            self.log.add("pipeline", "warn", "stopped", "Pipeline stopped by user.")
            with self._lock:
                self._status["running"] = False
                self._status["phase_progress"] = "Stopped by user."
                self._status["log"] = self.log.to_json()
                self._status["errors"] = self.log.get_events(level="error")
        return stopped

    def _update_status(self, **kwargs):
        with self._lock:
            self._status.update(kwargs)
            self._status["log"] = self.log.to_json()
            self._status["errors"] = self.log.get_events(level="error")


# ── Public helpers for webapp integration ────────────────────────────────

# Module-level reference to the most recently started pipeline instance.
# Used by get_pipeline_status() and request_pipeline_stop() for backward compat.
_active_pipeline: "SmartPipeline | None" = None
_active_pipeline_lock = threading.Lock()


def get_pipeline_status() -> dict:
    """Return a deep copy of the current pipeline status, safe for cross-thread reads."""
    with _active_pipeline_lock:
        p = _active_pipeline
    if p is not None:
        return p.get_status()
    return copy.deepcopy(_INITIAL_STATUS)


def request_pipeline_stop():
    """Signal the active pipeline to stop after the current unit of work."""
    with _active_pipeline_lock:
        p = _active_pipeline
    if p is not None:
        p.request_stop()


def start_pipeline(config: PipelineConfig, output_dir: str = OUTPUT_DIR) -> bool:
    """Start the pipeline in a background thread. Returns False if already running."""
    global _active_pipeline

    with _active_pipeline_lock:
        if _active_pipeline is not None and _active_pipeline.get_status()["running"]:
            return False
        pipeline = SmartPipeline(config, output_dir)
        _active_pipeline = pipeline

    thread = threading.Thread(target=pipeline.run, daemon=True)
    try:
        thread.start()
    except Exception:
        with pipeline._lock:
            pipeline._status.update({
                "running": False,
                "phase_progress": "Failed to start pipeline thread.",
            })
        return False
    return True
