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
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup

from .metadata_extractor import MetadataExtractor
from ..extraction.grounded import verified_metadata

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


class YearListingUnavailable(RuntimeError):
    """AustLII would not serve a year listing at all.

    Distinct from a listing that loaded fine and contained no immigration
    cases, which is an empty list. SmartPipeline._crawl_with_fallback relies
    on that distinction to rotate crawl strategies when AustLII rate-limits
    us; returning [] for both made the rotation unreachable.
    """


_DECISION_NUMBER_RE = re.compile(r"/(\d+)\.html?$", re.IGNORECASE)
_AUSTLII_MISSING_CONTENT_RE = re.compile(
    r"\b(?:no (?:database )?title|can't extract contents)\b", re.IGNORECASE
)
_AUSTLII_DOCUMENT_MARKER_RE = re.compile(
    r"(?im)^\s*(?:"
    r"REASONS FOR (?:JUDGMENT|DECISION)|"
    r"STATEMENT OF DECISION(?: AND REASONS)?|"
    r"DECISION RECORD|ORDERS?|CATCHWORDS|CORRIGENDUM|"
    r"DIRECTION TO RESTRICT PUBLICATION|"
    r"REVIEW APPLICANTS?|VISA APPLICANTS?|PRESIDING MEMBER|TRIBUNAL MEMBER|"
    r"DATE OF (?:DECISION|HEARING)|MIGRATION\s*[–—-]\s+\S"
    r")\b"
)


def _recency_key(case: ImmigrationCase) -> tuple[int, int, str]:
    """Newest-first sort key: (year, decision number, url).

    AustLII numbers judgments sequentially within a year per court, so a
    higher number is a later decision. The number is taken from the case URL
    (every browse hit matches /<n>.html) and falls back to the trailing
    integer of the citation, e.g. "[2024] AATA 123". A case with neither
    sorts as the oldest of its year rather than being dropped or crashing.

    Do NOT sort on the citation string: reversed string order puts
    "[2024] AATA 99" ahead of "[2024] AATA 100", which is backwards.
    Do NOT sort on `date` either: `_browse_year` does not populate it —
    date is extracted later, during the download phase.
    """
    number = 0
    match = _DECISION_NUMBER_RE.search(case.url or "")
    if match is None:
        match = re.search(r"(\d+)\s*$", case.citation or "")
    if match is not None:
        number = int(match.group(1))
    return (case.year or 0, number, case.url or "")


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
        failed_years = []

        # Browse every year — no early exit so all years get coverage
        for year in range(start_year, end_year + 1):
            try:
                year_cases = self._browse_year(db_code, db_info, year, keywords)
            except YearListingUnavailable as exc:
                failed_years.append(year)
                logger.warning(f"  {exc}")
                continue
            cases.extend(year_cases)
            logger.debug(f"  {db_code}/{year}: {len(year_cases)} cases found")

        if failed_years:
            logger.warning(
                f"  {db_code}: {len(failed_years)} of "
                f"{end_year - start_year + 1} years could not be fetched "
                f"({failed_years}); results are incomplete"
            )

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

        if len(cases) > max_results:
            # The browse loop runs oldest year first, so a plain slice kept
            # the OLDEST max_results cases and silently dropped the newest —
            # the opposite of what a case-law user wants. Sort newest-first
            # before capping, and say out loud that rows were dropped.
            cases.sort(key=_recency_key, reverse=True)
            logger.warning(
                f"  {db_code}: {len(cases)} cases found but max_results="
                f"{max_results}; dropping the {len(cases) - max_results} "
                f"oldest. Raise --max-results to keep them."
            )
            return cases[:max_results]

        return cases

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

        Returns an empty list when the listing loaded but held no immigration
        cases. Raises YearListingUnavailable when neither the direct listing
        nor the viewdb fallback could be fetched.
        """
        # Try the year listing page directly
        url = f"{AUSTLII_BASE}/au/cases/cth/{db_code}/{year}/"
        response = self.fetch(url)
        if not response:
            # Fallback to viewdb
            url = f"{AUSTLII_BASE}/cgi-bin/viewdb/au/cases/cth/{db_code}/"
            response = self.fetch(url, params={"year": str(year)})
            if not response:
                raise YearListingUnavailable(
                    f"{db_code}/{year}: listing unavailable "
                    f"({self.last_error or 'no response'})"
                )

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
        from ..config import OUTPUT_DIR
        from ..ingestion import record_case_evidence, reuse_case_source
        output = getattr(self, "source_cache_dir", OUTPUT_DIR)
        cached = reuse_case_source(case, output)
        if cached is not None:
            self.last_error = None
            self._extract_metadata(BeautifulSoup(cached, "lxml"), case)
            return cached
        if not case.url:
            if hasattr(self, "source_cache_dir"):
                record_case_evidence(case, output)
            return None

        response = self.fetch(case.url)
        if not response:
            if hasattr(self, "source_cache_dir"):
                record_case_evidence(case, output)
            return None

        soup = BeautifulSoup(response.text, "lxml")

        # Extract the main case text
        # AustLII typically puts case content in specific divs
        content_div = (
            soup.find("div", id="cases_doc")
            or soup.find("div", class_="cases_doc")
            or soup.find("div", class_="document")
        )
        if content_div:
            text = content_div.get_text(separator="\n", strip=True)
            if text and not _AUSTLII_MISSING_CONTENT_RE.search(text):
                self._extract_metadata(soup, case)
                return text

        # Older AustLII pages sometimes expose the decision as a linked plain-
        # text file instead of embedding it in the HTML page. Follow only the
        # matching case-number attachment on the same host; never treat the
        # surrounding site navigation as the decision itself.
        attachment = self._download_plain_text_attachment(soup, case)
        if attachment:
            self._extract_metadata(BeautifulSoup(attachment, "lxml"), case)
            return attachment

        # Fallback: get main body content
        body = soup.find("body")
        if body:
            # Remove navigation, headers, footers
            for tag in body.find_all(["nav", "header", "footer", "script", "style"]):
                tag.decompose()
            text = body.get_text(separator="\n", strip=True)
            # AustLII can return a valid page shell even when it cannot render
            # the judgment. Do not save that shell as a full-text source.
            if (
                text
                and not _AUSTLII_MISSING_CONTENT_RE.search(text)
                and _AUSTLII_DOCUMENT_MARKER_RE.search(text)
            ):
                self._extract_metadata(soup, case)
                return text
            self.last_error = {"category": "incomplete_document", "url": case.url}
            logger.warning("AustLII page has no decision body for %s", case.url)
            return None

        text = soup.get_text(separator="\n", strip=True)
        if (
            text
            and not _AUSTLII_MISSING_CONTENT_RE.search(text)
            and _AUSTLII_DOCUMENT_MARKER_RE.search(text)
        ):
            self._extract_metadata(soup, case)
            return text
        self.last_error = {"category": "incomplete_document", "url": case.url}
        logger.warning("AustLII response has no decision body for %s", case.url)
        return None

    def _download_plain_text_attachment(
        self, soup: BeautifulSoup, case: ImmigrationCase
    ) -> str | None:
        """Fetch an exact-case .txt attachment when the HTML has no body."""
        case_url = urlparse(case.url)
        case_number = _DECISION_NUMBER_RE.search(case_url.path)
        if not case_url.hostname or not case_number:
            return None
        expected_name = f"{case_number.group(1)}.txt".lower()
        expected_path = case_url.path.lower()
        viewdoc_prefix = "/cgi-bin/viewdoc"
        if viewdoc_prefix in expected_path:
            expected_path = expected_path.split(viewdoc_prefix, 1)[1]
        expected_path = expected_path.rsplit(".", 1)[0] + ".txt"

        for link in soup.find_all("a", href=True):
            attachment_url = urljoin(case.url, link["href"])
            parsed = urlparse(attachment_url)
            name = parsed.path.rsplit("/", 1)[-1].lower()
            if (
                parsed.hostname != case_url.hostname
                or not parsed.path.lower().endswith(expected_path)
                or name != expected_name
                or "download" not in link.get_text(" ", strip=True).lower()
            ):
                continue

            response = self.fetch(attachment_url)
            if not response:
                return None
            text = response.text.strip()
            if (
                not text
                or "html" in response.headers.get("Content-Type", "").lower()
                or text[:200].lstrip().lower().startswith(("<!doctype html", "<html"))
                or not _AUSTLII_DOCUMENT_MARKER_RE.search(text)
            ):
                return None
            return text
        return None

    def download_case_text(self, case: ImmigrationCase) -> str | None:
        """Protocol-compatible alias for download_case_detail."""
        return self.download_case_detail(case)

    _metadata_extractor = MetadataExtractor()

    def _extract_metadata(self, soup: BeautifulSoup, case: ImmigrationCase):
        """Extract metadata fields from a case page.

        Delegates to the shared MetadataExtractor, which consolidates all
        regex patterns previously duplicated across scrapers.
        """
        content = (soup.find("div", id="cases_doc") or soup.find("div", class_="cases_doc")
                   or soup.find("div", class_="document") or soup)
        text = content.get_text(separator="\n", strip=True)
        extracted = self._metadata_extractor.extract(
            text, citation=case.citation or ""
        )
        extracted = verified_metadata(text, extracted, citation=case.citation or extracted.get("citation", ""),
                                      title=case.title or "", url=case.url or "")
        valid_fields = ImmigrationCase.__dataclass_fields__
        for key, value in extracted.items():
            if key not in valid_fields:
                # asdict() only serialises declared fields, so an undeclared
                # key would be set on the instance and then vanish silently at
                # persistence time. Same guard from_dict() already applies.
                logger.warning(
                    f"MetadataExtractor emitted unknown field '{key}' for "
                    f"{case.url or case.citation or case.title}; dropping it"
                )
                continue
            if not str(getattr(case, key, "") or "").strip():
                setattr(case, key, value)

    @staticmethod
    def _is_immigration_case(text: str, keywords: list[str]) -> bool:
        """Check if text suggests an immigration-related case."""
        text_lower = text.lower()
        # Visa International is a payment-card brand. Its contract litigation
        # must not enter the catalogue just because "visa" matches below.
        if re.search(r"\bvisa\s+international\b", text_lower) and not re.search(
            r"\b(?:immigration|migration|refugee|asylum|citizenship|home affairs|"
            r"subclass|visa refusal|visa cancellation|protection visa)\b", text_lower
        ):
            return False
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
