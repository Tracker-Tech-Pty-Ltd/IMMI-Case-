"""AustLII scraper for downloading immigration cases from Australian courts/tribunals.

AustLII (Australasian Legal Information Institute) at austlii.edu.au is the
primary free source for Australian legal cases including:
- Administrative Appeals Tribunal (AAT) migration/refugee decisions
- Federal Court of Australia immigration judicial review
- Federal Circuit Court immigration cases
- High Court immigration appeals
- Migration Review Tribunal (MRT) / Refugee Review Tribunal (RRT) decisions
"""

import re
import logging
from urllib.parse import urljoin, urlencode, quote_plus
from bs4 import BeautifulSoup

from .metadata_extractor import MetadataExtractor

from .base import BaseScraper
from ..config import (
    AUSTLII_BASE,
    AUSTLII_DATABASES,
    AUSTLII_SEARCH,
    START_YEAR,
    END_YEAR,
    IMMIGRATION_KEYWORDS,
)
from ..models import ImmigrationCase

logger = logging.getLogger(__name__)


class AustLIIScraper(BaseScraper):
    """Scraper for AustLII immigration case databases."""

    def search_cases(
        self,
        databases: list[str] | None = None,
        keywords: list[str] | None = None,
        start_year: int = START_YEAR,
        end_year: int = END_YEAR,
        max_results_per_db: int = 500,
    ) -> list[ImmigrationCase]:
        """Search AustLII for immigration cases across specified databases.

        Args:
            databases: List of database codes (e.g., ["AATA", "FCA"]). None = all.
            keywords: Search keywords. None = default immigration keywords.
            start_year: Start year for search range.
            end_year: End year for search range.
            max_results_per_db: Maximum results to fetch per database.

        Returns:
            List of ImmigrationCase objects.
        """
        if databases is None:
            databases = list(AUSTLII_DATABASES.keys())
        if keywords is None:
            keywords = IMMIGRATION_KEYWORDS

        all_cases = []
        for db_code in databases:
            if db_code not in AUSTLII_DATABASES:
                logger.warning(f"Unknown database code: {db_code}, skipping")
                continue

            db_info = AUSTLII_DATABASES[db_code]
            logger.info(f"Searching {db_info['name']} ({db_code})...")

            cases = self._search_database(
                db_code, db_info, keywords, start_year, end_year, max_results_per_db
            )
            all_cases.extend(cases)
            logger.info(f"  Found {len(cases)} immigration cases in {db_code}")

        return all_cases

    def _search_database(
        self,
        db_code: str,
        db_info: dict,
        keywords: list[str],
        start_year: int,
        end_year: int,
        max_results: int,
    ) -> list[ImmigrationCase]:
        """Search a specific AustLII database for immigration cases.

        Browses every year without per-year caps. The max_results limit
        is only applied at the very end as a total cap.
        """
        cases = []

        # Browse every year — no early exit so all years get coverage
        for year in range(start_year, end_year + 1):
            year_cases = self._browse_year(db_code, db_info, year, keywords)
            cases.extend(year_cases)
            logger.debug(f"  {db_code}/{year}: {len(year_cases)} cases found")

        # Strategy 2: If browsing found few results, try keyword search
        if len(cases) < 10:
            search_cases = self._keyword_search(
                db_code, db_info, keywords, start_year, end_year
            )
            # Deduplicate by URL
            existing_urls = {c.url for c in cases}
            for case in search_cases:
                if case.url not in existing_urls:
                    cases.append(case)
                    existing_urls.add(case.url)

        return cases[:max_results]

    # Databases where ALL cases are immigration-related (no keyword filter needed)
    IMMIGRATION_ONLY_DBS = {"RRTA", "MRTA", "ARTA"}

    def _browse_year(
        self,
        db_code: str,
        db_info: dict,
        year: int,
        keywords: list[str],
    ) -> list[ImmigrationCase]:
        """Browse a specific year's case listing and filter for immigration cases.

        AustLII year listings are at /au/cases/cth/{DB}/{year}/ and case links
        use /cgi-bin/viewdoc/au/cases/cth/{DB}/{year}/{num}.html format.
        AATA cases conveniently include '(Migration)' or '(Refugee)' in titles.
        RRTA/MRTA/ARTA are dedicated immigration tribunals — all cases included.
        """
        # Try the year listing page directly
        url = f"{AUSTLII_BASE}/au/cases/cth/{db_code}/{year}/"
        response = self.fetch(url)
        if not response:
            # Fallback to viewdb
            url = f"{AUSTLII_BASE}/cgi-bin/viewdb/au/cases/cth/{db_code}/"
            response = self.fetch(url, params={"year": str(year)})
            if not response:
                return []

        soup = BeautifulSoup(response.text, "lxml")
        cases = []
        skip_filter = db_code in self.IMMIGRATION_ONLY_DBS

        # Find case links in the listing page
        # AustLII uses /cgi-bin/viewdoc/au/cases/cth/{DB}/{year}/{num}.html
        for link in soup.find_all("a", href=True):
            href = link.get("href", "")
            text = link.get_text(strip=True)

            # Match case links - both viewdoc and direct paths
            if f"/au/cases/cth/{db_code}/" not in href:
                continue
            if not re.search(r"/\d+\.html", href):
                continue

            # For dedicated immigration tribunals, skip keyword filtering
            if not skip_filter:
                full_text = text.lower()
                parent = link.parent
                if parent:
                    full_text += " " + parent.get_text(strip=True).lower()
                if not self._is_immigration_case(full_text, keywords):
                    continue

            case_url = urljoin(AUSTLII_BASE, href)
            case = ImmigrationCase(
                title=text,
                court=db_info["name"],
                court_code=db_code,
                year=year,
                url=case_url,
                source="AustLII",
            )
            # Try to extract citation from text
            citation_match = re.search(
                rf"\[{year}\]\s+{db_code}\s+\d+", text
            )
            if citation_match:
                case.citation = citation_match.group(0)

            cases.append(case)

        return cases

    def _keyword_search(
        self,
        db_code: str,
        db_info: dict,
        keywords: list[str],
        start_year: int,
        end_year: int,
    ) -> list[ImmigrationCase]:
        """Search AustLII using keyword search for immigration cases."""
        cases = []

        # Use key immigration terms for search
        search_terms = [
            "Minister for Immigration",
            "Migration Act",
            "protection visa",
            "Department of Home Affairs",
        ]

        for term in search_terms:
            search_query = quote_plus(term)
            db_path = f"au/cases/cth/{db_code}"

            params = {
                "method": "auto",
                "query": term,
                "meta": f"/au/cases/cth/{db_code}",
                "mask_path": "",
                "mask_world": "",
                "submit": "Search",
                "rank": "on",
                "callback": "",
                "offset": "0",
                "num": "100",
            }

            response = self.fetch(AUSTLII_SEARCH, params=params)
            if not response:
                continue

            soup = BeautifulSoup(response.text, "lxml")
            search_cases = self._parse_search_results(soup, db_code, db_info)
            cases.extend(search_cases)

        return cases

    def _parse_search_results(
        self, soup: BeautifulSoup, db_code: str, db_info: dict
    ) -> list[ImmigrationCase]:
        """Parse AustLII search result page into cases."""
        cases = []

        # AustLII search results are typically in list items or table rows
        for item in soup.find_all(["li", "tr", "div"], class_=re.compile(r"result|hit")):
            link = item.find("a", href=True)
            if not link:
                continue

            href = link.get("href", "")
            if f"/au/cases/cth/{db_code}/" not in href:
                continue

            title = link.get_text(strip=True)
            case_url = urljoin(AUSTLII_BASE, href)

            # Extract year from URL
            year_match = re.search(r"/(\d{4})/", href)
            year = int(year_match.group(1)) if year_match else 0

            # Extract snippet
            snippet_elem = item.find(class_=re.compile(r"snippet|abstract|context"))
            snippet = snippet_elem.get_text(strip=True) if snippet_elem else ""

            case = ImmigrationCase(
                title=title,
                court=db_info["name"],
                court_code=db_code,
                year=year,
                url=case_url,
                text_snippet=snippet,
                source="AustLII",
            )

            # Try to extract citation
            citation_match = re.search(
                rf"\[\d{{4}}\]\s+{db_code}\s+\d+", title
            )
            if citation_match:
                case.citation = citation_match.group(0)

            cases.append(case)

        # Also try parsing plain link lists (common AustLII format)
        if not cases:
            for link in soup.find_all("a", href=True):
                href = link.get("href", "")
                if f"/au/cases/cth/{db_code}/" not in href:
                    continue
                if not re.search(r"\d+\.html", href):
                    continue

                title = link.get_text(strip=True)
                case_url = urljoin(AUSTLII_BASE, href)

                year_match = re.search(r"/(\d{4})/", href)
                year = int(year_match.group(1)) if year_match else 0

                case = ImmigrationCase(
                    title=title,
                    court=db_info["name"],
                    court_code=db_code,
                    year=year,
                    url=case_url,
                    source="AustLII",
                )
                cases.append(case)

        return cases

    def download_case_detail(self, case: ImmigrationCase) -> str | None:
        """Download full text of a case from AustLII.

        Args:
            case: The case to download.

        Returns:
            Full text content of the case, or None on failure.
        """
        if not case.url:
            return None

        response = self.fetch(case.url)
        if not response:
            return None

        soup = BeautifulSoup(response.text, "lxml")

        # Extract case metadata from the page
        self._extract_metadata(soup, case)

        # Extract the main case text
        # AustLII typically puts case content in specific divs
        content_div = soup.find("div", id="cases_doc") or soup.find(
            "div", class_="document"
        )
        if content_div:
            return content_div.get_text(separator="\n", strip=True)

        # Fallback: get main body content
        body = soup.find("body")
        if body:
            # Remove navigation, headers, footers
            for tag in body.find_all(["nav", "header", "footer", "script", "style"]):
                tag.decompose()
            return body.get_text(separator="\n", strip=True)

        return soup.get_text(separator="\n", strip=True)

    def download_case_text(self, case: ImmigrationCase) -> str | None:
        """Protocol-compatible alias for download_case_detail."""
        return self.download_case_detail(case)

    _metadata_extractor = MetadataExtractor()

    def _extract_metadata(self, soup: BeautifulSoup, case: ImmigrationCase):
        """Extract metadata fields from a case page.

        Delegates to the shared MetadataExtractor, which consolidates all
        regex patterns previously duplicated across scrapers.
        """
        text = soup.get_text()
        extracted = self._metadata_extractor.extract(
            text, citation=case.citation or ""
        )
        for key, value in extracted.items():
            setattr(case, key, value)

    @staticmethod
    def _is_immigration_case(text: str, keywords: list[str]) -> bool:
        """Check if text suggests an immigration-related case."""
        text_lower = text.lower()
        immigration_indicators = [
            "minister for immigration",
            "minister for home affairs",
            "department of home affairs",
            "department of immigration",
            "migration act",
            "migration regulations",
            "protection visa",
            "(migration)",
            "(refugee)",
            "visa",
            "refugee",
            "deportation",
            "removal",
            "character test",
            "s 501",
            "section 501",
            "bridging visa",
            "migration agent",
            "migration review",
            "refugee review",
            "citizenship",
            "border force",
        ]
        for indicator in immigration_indicators:
            if indicator in text_lower:
                return True

        # Also check user-provided keywords
        for kw in keywords:
            if kw.lower() in text_lower:
                return True

        return False
