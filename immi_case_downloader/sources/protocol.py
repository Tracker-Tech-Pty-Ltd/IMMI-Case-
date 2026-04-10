"""Formal protocol for immigration case scrapers."""

from typing import Protocol, runtime_checkable

from ..models import ImmigrationCase


@runtime_checkable
class CaseScraper(Protocol):
    """Protocol that all case scrapers must satisfy."""

    def search_cases(
        self,
        databases: list[str] | None,
        keywords: list[str] | None,
        start_year: int,
        end_year: int,
        max_results_per_db: int,
    ) -> list[ImmigrationCase]: ...

    def download_case_text(self, case: ImmigrationCase) -> str | None: ...
