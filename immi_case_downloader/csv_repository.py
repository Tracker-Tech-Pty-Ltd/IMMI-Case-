"""CSV-backed CaseRepository — wraps existing storage.py functions."""

import logging

from .models import ImmigrationCase
from .storage import (
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
        """Merge new cases with existing by URL dedup, then save."""
        existing = load_all_cases(self.base_dir)
        existing_urls = {c.url for c in existing}
        added = 0
        for case in cases:
            case.ensure_id()
            if case.url and case.url not in existing_urls:
                existing.append(case)
                existing_urls.add(case.url)
                added += 1
            elif not case.url:
                existing.append(case)
                added += 1
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
