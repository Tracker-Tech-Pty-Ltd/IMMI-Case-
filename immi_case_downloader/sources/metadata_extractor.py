"""Centralised metadata extraction from case page text.

Consolidates the shared regex patterns that were previously duplicated across
AustLIIScraper._extract_metadata and FederalCourtScraper._extract_metadata.
"""

import re
import logging

logger = logging.getLogger(__name__)

# Shared regex patterns (compiled once at module load for efficiency)
# Pattern 1: header keyword at the start of a line (e.g. "BEFORE: Justice Smith")
# Pattern 2: "Before:" / "Coram:" label anywhere in text
_JUDGE_PATTERNS = [
    re.compile(
        r"^(?:BEFORE|JUDGE|JUSTICE|TRIBUNAL MEMBER)[:\s]+([^\n]+)",
        re.IGNORECASE | re.MULTILINE,
    ),
    re.compile(r"(?:Before|Coram)[:\s]+([^\n]+)", re.IGNORECASE),
]

_DATE_PATTERNS = [
    re.compile(
        r"(?:DATE OF (?:ORDER|DECISION|HEARING|JUDGMENT))[:\s]+"
        r"(\d{1,2}\s+\w+\s+\d{4})",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:Decision date|Judgment date|Date)[:\s]+(\d{1,2}\s+\w+\s+\d{4})",
        re.IGNORECASE,
    ),
    re.compile(
        r"(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|"
        r"September|October|November|December)\s+\d{4})",
        re.IGNORECASE,
    ),
]

_CATCHWORDS_PATTERN = re.compile(
    r"CATCHWORDS[:\s]*\n?(.*?)(?=\n\s*\n|\nLEGISLATION|\nCASES(?:\s+CITED)?|\nORDER)",
    re.IGNORECASE | re.DOTALL,
)

_CITATION_PATTERN = re.compile(
    r"\[\d{4}\]\s+(?:AATA|ARTA|FCA|FCCA|FMCA|HCA|FedCFamC2G|RRTA|MRTA)\s+\d+",
)

_OUTCOME_PATTERNS = [
    re.compile(
        r"(?:DECISION|ORDER|ORDERS|THE COURT ORDERS)[:\s]*\n?(.*?)(?:\n\s*\n)",
        re.IGNORECASE | re.DOTALL,
    ),
    re.compile(
        r"(?:The Tribunal|The Court)\s+"
        r"(affirms|remits|sets aside|dismisses|allows|refuses|grants)[^\n]*",
        re.IGNORECASE,
    ),
]

_VISA_PATTERN = re.compile(
    r"((?:protection|skilled|partner|student|visitor|bridging|"
    r"temporary|permanent|subclass\s+\d+)\s*visa)",
    re.IGNORECASE,
)

_LEGISLATION_PATTERNS = [
    re.compile(r"(Migration Act 1958[^.]*)", re.IGNORECASE),
    re.compile(r"(Migration Regulations 1994[^.]*)", re.IGNORECASE),
]


class MetadataExtractor:
    """Extracts structured metadata from immigration case text.

    Returns a plain dict so callers decide what fields to update on their
    case objects — this keeps the extractor side-effect-free.
    """

    def extract(
        self,
        html_text: str,
        citation: str = "",
        base_url: str = "",
    ) -> dict:
        """Extract metadata fields from raw case text.

        Args:
            html_text: Plain text content of the case page (already stripped
                       of HTML tags by the caller, or raw HTML — regex works
                       on both but quality is better on plain text).
            citation:  Known citation string; if non-empty, citation extraction
                       is skipped.
            base_url:  Source URL (unused directly, reserved for future use).

        Returns:
            Dict with any of: judges, date, catchwords, citation, outcome,
            visa_type, legislation.  Only keys with extracted values are present.
        """
        # Guard: tolerate completely garbage / binary input
        try:
            text = html_text if isinstance(html_text, str) else ""
            # Strip null bytes and other binary residue
            text = text.replace("\x00", " ")
        except Exception:
            logger.debug("MetadataExtractor: could not decode input text")
            return {}

        result: dict = {}

        # Judges / members
        for pattern in _JUDGE_PATTERNS:
            match = pattern.search(text)
            if match:
                result["judges"] = match.group(1).strip()
                break

        # Date
        for pattern in _DATE_PATTERNS:
            match = pattern.search(text)
            if match:
                result["date"] = match.group(1).strip()
                break

        # Catchwords
        cw_match = _CATCHWORDS_PATTERN.search(text)
        if cw_match:
            result["catchwords"] = cw_match.group(1).strip()[:500]

        # Citation (only if caller did not provide one)
        if not citation:
            cit_match = _CITATION_PATTERN.search(text)
            if cit_match:
                result["citation"] = cit_match.group(0)

        # Outcome / decision
        for pattern in _OUTCOME_PATTERNS:
            match = pattern.search(text)
            if match:
                result["outcome"] = match.group(0).strip()[:300]
                break

        # Visa type
        visa_match = _VISA_PATTERN.search(text)
        if visa_match:
            result["visa_type"] = visa_match.group(1).strip()

        # Legislation references
        leg_refs: list[str] = []
        for pattern in _LEGISLATION_PATTERNS:
            leg_refs.extend(pattern.findall(text)[:2])
        if leg_refs:
            result["legislation"] = "; ".join(leg_refs)[:300]

        return result
