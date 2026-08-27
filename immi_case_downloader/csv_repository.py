"""CSV-backed CaseRepository — wraps existing storage.py functions."""

import logging
import os

from .csv_write_lock import csv_write_lock
from .models import ImmigrationCase
from .storage import (
    CASE_FIELDS,
    CASES_CSV,
    load_all_cases,
    get_case_by_id,
    update_case,
    delete_case,
    add_case_manual,
    get_case_full_text,
    get_statistics,
    save_cases_csv,
    save_cases_json,
    ensure_output_dirs,
)

logger = logging.getLogger(__name__)


class CsvRepository:
    """CSV-backed case repository (wraps storage.py functions).

    Provides the CaseRepository interface using the existing
    flat-file CSV/JSON persistence layer.
    """

    def __init__(self, base_dir: str):
        self.base_dir = base_dir
        ensure_output_dirs(base_dir)

    def load_all(self) -> list[ImmigrationCase]:
        return load_all_cases(self.base_dir)

    def get_by_id(self, case_id: str) -> ImmigrationCase | None:
        return get_case_by_id(case_id, self.base_dir)

    def save_many(self, cases: list[ImmigrationCase]) -> int:
        """Upsert cases into the CSV store, keyed on ``case_id`` then ``url``.

        An incoming case that matches a stored record — by ``case_id`` first,
        by non-empty ``url`` second — updates it in place: every non-empty
        incoming field wins, empty incoming fields leave the stored value
        alone. An unseen case is appended. Returns the number of *newly added*
        cases.

        Keyed on ``case_id`` rather than ``url`` alone on purpose: blank URLs
        are an expected state (manual adds set none), and URL-keying both
        discarded every update to an existing case and duplicated blank-URL
        cases on every call. This matches ``SqliteRepository.save_many``, which
        upserts on ``ON CONFLICT(case_id)``. The ``url`` pass is kept as a
        second key because a non-empty URL is still unique in this store (the
        SQLite backend enforces it with a partial unique index) — dropping it
        would let a re-crawl whose citation changed insert a second row for a
        page that is already stored.
        """
        with csv_write_lock(os.path.join(self.base_dir, CASES_CSV)):
            existing = load_all_cases(self.base_dir)
            by_id: dict[str, ImmigrationCase] = {}
            by_url: dict[str, ImmigrationCase] = {}
            for stored in existing:
                stored.ensure_id()
                by_id.setdefault(stored.case_id, stored)
                if stored.url:
                    by_url.setdefault(stored.url, stored)

            added = 0
            for case in cases:
                case.ensure_id()
                stored = by_id.get(case.case_id)
                if stored is None and case.url:
                    stored = by_url.get(case.url)
                    if stored is not None and stored.case_id != case.case_id:
                        # The incoming case_id is new but its URL is already
                        # stored under a different id. Merging onto the URL row
                        # is the right call (one URL is one case), but the id
                        # change is worth a line in the log: it means
                        # citation/title drifted.
                        logger.warning(
                            "save_many: url %s already stored as case_id %s; "
                            "merging incoming case_id %s into it",
                            case.url, stored.case_id, case.case_id,
                        )
                if stored is None:
                    existing.append(case)
                    by_id[case.case_id] = case
                    if case.url:
                        by_url.setdefault(case.url, case)
                    added += 1
                    continue
                if stored is case:
                    continue
                if stored.url and case.url and stored.url != case.url:
                    # Two different pages claiming one case_id is a data
                    # problem we must not paper over by silently overwriting
                    # one with the other. ensure_id() hashes
                    # citation-or-url-or-title, so this means two different
                    # URLs produced the same citation.
                    raise ValueError(
                        f"case_id {case.case_id} maps to two different urls: "
                        f"stored={stored.url!r} incoming={case.url!r}"
                    )
                for field in CASE_FIELDS:
                    if field == "case_id":
                        continue
                    value = getattr(case, field, None)
                    # "" and 0 are this dataclass's "unset" markers — never let
                    # an unset incoming field erase a stored one.
                    if value is None or value == "" or value == 0:
                        continue
                    setattr(stored, field, value)

            save_cases_csv(existing, self.base_dir)
            save_cases_json(existing, self.base_dir)
            return added

    def update(self, case_id: str, updates: dict) -> bool:
        return update_case(case_id, updates, self.base_dir)

    def delete(self, case_id: str) -> bool:
        return delete_case(case_id, self.base_dir)

    def add(self, case: ImmigrationCase) -> ImmigrationCase:
        return add_case_manual(case.to_dict(), self.base_dir)

    def get_statistics(self) -> dict:
        return get_statistics(self.base_dir)

    def get_existing_urls(self) -> set[str]:
        return {c.url for c in load_all_cases(self.base_dir) if c.url}

    def filter_cases(
        self,
        court: str = "",
        year: int | None = None,
        visa_type: str = "",
        source: str = "",
        tag: str = "",
        nature: str = "",
        keyword: str = "",
        sort_by: str = "year",
        sort_dir: str = "desc",
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[ImmigrationCase], int]:
        """In-memory filtering (delegates to existing _filter_cases logic)."""
        cases = load_all_cases(self.base_dir)

        if court:
            cases = [c for c in cases if c.court_code == court]
        if year is not None:
            cases = [c for c in cases if c.year == year]
        if visa_type:
            cases = [c for c in cases if visa_type.lower() in c.visa_type.lower()]
        if source:
            cases = [c for c in cases if c.source == source]
        if tag:
            cases = [c for c in cases if tag.lower() in c.tags.lower()]
        if nature:
            cases = [c for c in cases if c.case_nature == nature]
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

        # Sort
        reverse = sort_dir == "desc"
        if sort_by in ("year", "date", "title", "court", "citation"):
            cases.sort(key=lambda c: getattr(c, sort_by, ""), reverse=reverse)

        total = len(cases)
        start = (max(1, page) - 1) * page_size
        return cases[start : start + page_size], total

    def search_text(self, query: str, limit: int = 50) -> list[ImmigrationCase]:
        """Simple in-memory text search (no FTS)."""
        kw = query.lower()
        results = []
        for c in load_all_cases(self.base_dir):
            if (kw in c.title.lower() or kw in c.citation.lower()
                    or kw in c.catchwords.lower() or kw in c.judges.lower()
                    or kw in c.case_nature.lower() or kw in c.legal_concepts.lower()):
                results.append(c)
                if len(results) >= limit:
                    break
        return results

    def find_related(self, case_id: str, limit: int = 5) -> list[ImmigrationCase]:
        """Simple in-memory related case finder."""
        case = self.get_by_id(case_id)
        if not case:
            return []

        scored = []
        for c in load_all_cases(self.base_dir):
            if c.case_id == case_id:
                continue
            score = 0
            if case.case_nature and c.case_nature == case.case_nature:
                score += 3
            if case.visa_type and c.visa_type == case.visa_type:
                score += 2
            if case.court_code and c.court_code == case.court_code:
                score += 1
            if score > 0:
                scored.append((score, c))
        scored.sort(key=lambda x: (-x[0], -x[1].year))
        return [c for _, c in scored[:limit]]

    def export_csv_rows(self) -> list[dict]:
        return [c.to_dict() for c in load_all_cases(self.base_dir)]

    def export_json(self) -> dict:
        cases = load_all_cases(self.base_dir)
        return {
            "total_cases": len(cases),
            "courts": sorted({c.court for c in cases if c.court}),
            "year_range": {
                "min": min((c.year for c in cases if c.year), default=0),
                "max": max((c.year for c in cases if c.year), default=0),
            },
            "cases": [c.to_dict() for c in cases],
        }

    def get_filter_options(self) -> dict:
        cases = load_all_cases(self.base_dir)
        courts = sorted({c.court_code for c in cases if c.court_code})
        years = sorted({c.year for c in cases if c.year}, reverse=True)
        sources = sorted({c.source for c in cases if c.source})
        natures = sorted({c.case_nature for c in cases if c.case_nature})
        visa_types = sorted({c.visa_type for c in cases if c.visa_type})
        all_tags = set()
        for c in cases:
            if c.tags:
                for t in c.tags.split(","):
                    t = t.strip()
                    if t:
                        all_tags.add(t)
        return {
            "courts": courts,
            "years": years,
            "sources": sources,
            "natures": natures,
            "visa_types": visa_types,
            "tags": sorted(all_tags),
        }

    def get_case_full_text(self, case: ImmigrationCase) -> str | None:
        """Read the full text file for a case."""
        return get_case_full_text(case, base_dir=self.base_dir)
