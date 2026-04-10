"""Federal Court of Australia case downloader.

Downloads immigration-related judgments from the Federal Court's
judgment search at search2.fedcourt.gov.au.
"""

import re
import logging
from urllib.parse import urljoin
from bs4 import BeautifulSoup

from .base import BaseScraper
from .metadata_extractor import MetadataExtractor
from ..config import FEDERAL_COURT_SEARCH, START_YEAR, END_YEAR
from ..models import ImmigrationCase

logger = logging.getLogger(__name__)

FEDCOURT_BASE = "https://www.fedcourt.gov.au"


class FederalCourtScraper(BaseScraper):
    """Scraper for Federal Court of Australia immigration judgments."""

    def search_cases(
        self,
        databases: list[str] | None = None,
        keywords: list[str] | None = None,
        start_year: int = START_YEAR,
        end_year: int = END_YEAR,
        max_results_per_db: int = 500,
    ) -> list[ImmigrationCase]:
        """Search Federal Court for immigration-related judgments.

        The ``databases`` and ``keywords`` parameters are accepted for
        Protocol compatibility but are not used — the Federal Court search
        endpoint has a single database and uses hard-coded immigration terms.

        Args:
            databases: Ignored (Federal Court has one search endpoint).
            keywords: Ignored (hard-coded immigration search terms are used).
            start_year: Start year for search.
            end_year: End year for search.
            max_results_per_db: Maximum number of results.

        Returns:
            List of ImmigrationCase objects.
        """
        max_results = max_results_per_db
        cases = []

        search_terms = [
            "Minister for Immigration",
            "Department of Home Affairs",
            "Migration Act",
            "protection visa",
            "visa cancellation section 501",
        ]

        for term in search_terms:
            logger.info(f"Searching Federal Court for: {term}")
            term_cases = self._search_term(term, start_year, end_year)
            # Deduplicate
            existing_urls = {c.url for c in cases}
            for case in term_cases:
                if case.url not in existing_urls:
                    cases.append(case)
                    existing_urls.add(case.url)

            if len(cases) >= max_results:
                break

        return cases[:max_results]

    def _search_term(
        self, term: str, start_year: int, end_year: int
    ) -> list[ImmigrationCase]:
        """Search for a specific term on the Federal Court search."""
        cases = []

        params = {
            "collection": "fedcourt",
            "query": term,
            "start_rank": "1",
            "num_ranks": "100",
            "sort": "date",
        }

        response = self.fetch(FEDERAL_COURT_SEARCH, params=params)
        if not response:
            return cases

        soup = BeautifulSoup(response.text, "lxml")
        cases = self._parse_results(soup, start_year, end_year)

        # Check for pagination
        page = 2
        while len(cases) < 500:
            next_link = soup.find("a", string=re.compile(r"Next|»"))
            if not next_link:
                break

            next_url = next_link.get("href", "")
            if not next_url:
                break

            next_url = urljoin(FEDERAL_COURT_SEARCH, next_url)
            response = self.fetch(next_url)
            if not response:
                break

            soup = BeautifulSoup(response.text, "lxml")
            page_cases = self._parse_results(soup, start_year, end_year)
            if not page_cases:
                break

            cases.extend(page_cases)
            page += 1

        return cases

    def _parse_results(
        self, soup: BeautifulSoup, start_year: int, end_year: int
    ) -> list[ImmigrationCase]:
        """Parse Federal Court search results."""
        cases = []

        # Federal Court results are typically in search result blocks
        results = soup.find_all(
            ["div", "li", "tr"],
            class_=re.compile(r"search-result|result|listing", re.IGNORECASE),
        )

        # If no structured results, try finding judgment links
        if not results:
            results = [soup]

        for result in results:
            links = result.find_all("a", href=True)
            for link in links:
                href = link.get("href", "")
                title = link.get_text(strip=True)

                # Match judgment URLs
                if not re.search(
                    r"judgments|decisions|fca|fcca", href, re.IGNORECASE
                ):
                    continue
                if not title or len(title) < 10:
                    continue

                # Extract year
                year_match = re.search(r"\[(\d{4})\]", title) or re.search(
                    r"/(\d{4})/", href
                )
                year = int(year_match.group(1)) if year_match else 0

                if year and (year < start_year or year > end_year):
                    continue

                case_url = urljoin(FEDCOURT_BASE, href)

                # Extract citation
                citation = ""
                citation_match = re.search(
                    r"\[\d{4}\]\s+(?:FCA|FCCA|FedCFamC2G|HCA)\s+\d+", title
                )
                if citation_match:
                    citation = citation_match.group(0)

                # Determine court from citation
                court_code = "FCA"
                court_name = "Federal Court of Australia"
                if "FCCA" in (citation or href):
                    court_code = "FCCA"
                    court_name = "Federal Circuit Court of Australia"
                elif "FedCFamC2G" in (citation or href):
                    court_code = "FedCFamC2G"
                    court_name = "Federal Circuit and Family Court (Div 2)"

                # Get snippet from surrounding text
                snippet = ""
                parent = link.parent
                if parent:
                    snippet_text = parent.get_text(strip=True)
                    if len(snippet_text) > len(title):
                        snippet = snippet_text[:300]

                case = ImmigrationCase(
                    title=title,
                    citation=citation,
                    court=court_name,
                    court_code=court_code,
                    year=year,
                    url=case_url,
                    text_snippet=snippet,
                    source="Federal Court",
                )
                cases.append(case)

        return cases

    def download_case_detail(self, case: ImmigrationCase) -> str | None:
        """Download full text of a Federal Court judgment."""
        if not case.url:
            return None

        response = self.fetch(case.url)
        if not response:
            return None

        soup = BeautifulSoup(response.text, "lxml")

        # Try to extract judgment content
        content = (
            soup.find("div", id="judgment-content")
            or soup.find("div", class_="judgment")
            or soup.find("div", class_="document")
            or soup.find("article")
        )

        if content:
            text = content.get_text(separator="\n", strip=True)
        else:
            body = soup.find("body")
            if body:
                for tag in body.find_all(
                    ["nav", "header", "footer", "script", "style"]
                ):
                    tag.decompose()
                text = body.get_text(separator="\n", strip=True)
            else:
                text = soup.get_text(separator="\n", strip=True)

        # Try to extract metadata from judgment text
        self._extract_metadata(text, case)

        return text

    def download_case_text(self, case: ImmigrationCase) -> str | None:
        """Protocol-compatible alias for download_case_detail."""
        return self.download_case_detail(case)

    _metadata_extractor = MetadataExtractor()

    def _extract_metadata(self, text: str, case: ImmigrationCase):
        """Extract metadata from judgment text.

        Delegates to the shared MetadataExtractor, which consolidates all
        regex patterns previously duplicated across scrapers.
        """
        extracted = self._metadata_extractor.extract(
            text, citation=case.citation or ""
        )
        for key, value in extracted.items():
            setattr(case, key, value)
