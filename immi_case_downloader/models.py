"""Data models for immigration cases."""

import hashlib
from dataclasses import dataclass, asdict


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
        if not self.case_id:
            key = self.citation or self.url or self.title
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
                        filtered[k] = int(v) if v and str(v) != "nan" else 0
                    except (ValueError, TypeError):
                        filtered[k] = 0
                else:
                    filtered[k] = str(v) if v and str(v) != "nan" else ""
        return cls(**filtered)
