"""Data models for immigration cases."""

import hashlib
import math
from dataclasses import dataclass, asdict


def _is_missing(value) -> bool:
    """True for the three shapes an absent CSV/DB cell arrives in.

    pandas turns an empty CSV field into float('nan'); a CSV round-trip turns
    that into the string "nan"; a SQL NULL arrives as None. Testing those
    explicitly instead of plain falsiness means a legitimate 0 or False is
    preserved rather than blanked.
    """
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    return str(value) == "nan"


@dataclass
class ImmigrationCase:
    """Represents a single immigration court/tribunal case."""

    case_id: str = ""
    citation: str = ""
    title: str = ""
    court: str = ""
    court_code: str = ""
    date: str = ""
    year: int = 0
    url: str = ""
    judges: str = ""
    catchwords: str = ""
    outcome: str = ""
    visa_type: str = ""
    legislation: str = ""
    text_snippet: str = ""
    full_text_path: str = ""
    source: str = ""
    user_notes: str = ""
    tags: str = ""
    case_nature: str = ""
    legal_concepts: str = ""
    visa_subclass: str = ""
    visa_class_code: str = ""
    applicant_name: str = ""
    respondent: str = ""
    country_of_origin: str = ""
    visa_subclass_number: str = ""
    hearing_date: str = ""
    is_represented: str = ""
    representative: str = ""
    visa_outcome_reason: str = ""
    legal_test_applied: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    def ensure_id(self):
        """Generate a stable case_id if not already set."""
        if self.case_id:
            return
        key = self.citation or self.url or self.title
        if not key:
            # Nothing identifying: hashing "" gave every blank-key case the
            # same id (e3b0c442…). Fall back to the whole record so two
            # different blank-key rows stay distinguishable, and stay
            # deterministic so reloading the CSV does not mint a new id.
            key = repr(sorted(
                (name, value)
                for name, value in self.to_dict().items()
                if name != "case_id"
            ))
        self.case_id = hashlib.sha256(key.encode()).hexdigest()[:12]

    @classmethod
    def from_dict(cls, data: dict) -> "ImmigrationCase":
        """Create an ImmigrationCase from a dictionary, ignoring unknown keys."""
        valid_fields = {f.name for f in cls.__dataclass_fields__.values()}
        filtered = {}
        for k, v in data.items():
            if k in valid_fields:
                if k == "year":
                    try:
                        filtered[k] = 0 if _is_missing(v) else int(v)
                    except (ValueError, TypeError):
                        filtered[k] = 0
                else:
                    filtered[k] = "" if _is_missing(v) else str(v)
        return cls(**filtered)
