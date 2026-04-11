"""Tests for web/helpers.py — uncovered filter branches.

Targets lines missed in _filter_cases():
- visa_type filter
- source filter
- tag filter
- nature (case_nature) filter
- keyword filter
- year filter with invalid (non-int) value → passes through unchanged
Also covers safe_int() and safe_float() edge cases.
"""

from __future__ import annotations

from immi_case_downloader.models import ImmigrationCase


# ── Helpers ───────────────────────────────────────────────────────────────────


def _case(**kwargs) -> ImmigrationCase:
    def _s(key: str, default: str) -> str:
        return str(kwargs.get(key, default))

    def _i(key: str, default: int) -> int:
        return int(kwargs.get(key, default))

    return ImmigrationCase(
        case_id=_s("case_id", "x1"),
        title=_s("title", "Smith v Minister [2024] AATA 1"),
        citation=_s("citation", "[2024] AATA 1"),
        court=_s("court", "Administrative Appeals Tribunal"),
        court_code=_s("court_code", "AATA"),
        date=_s("date", "2024-01-01"),
        year=_i("year", 2024),
        url=_s("url", "https://austlii.edu.au/"),
        judges=_s("judges", "Member Jones"),
        catchwords=_s("catchwords", "visa refusal; character"),
        outcome=_s("outcome", "Affirmed"),
        visa_type=_s("visa_type", "Subclass 866 Protection"),
        source=_s("source", "AustLII"),
        tags=_s("tags", "priority;character"),
        case_nature=_s("case_nature", "Visa Refusal"),
        legal_concepts=_s("legal_concepts", "Character Test; Natural justice"),
        user_notes=_s("user_notes", "see follow-up"),
        text_snippet=_s("text_snippet", ""),
        legislation=_s("legislation", "Migration Act 1958"),
    )


class _Args:
    """Minimal stand-in for Flask request.args."""

    def __init__(self, **kwargs):
        self._data = kwargs

    def get(self, key, default=""):
        return self._data.get(key, default)


def _filter(cases, **kwargs):
    from immi_case_downloader.web.helpers import _filter_cases
    return _filter_cases(cases, _Args(**kwargs))


# ── _filter_cases() ───────────────────────────────────────────────────────────


class TestFilterCases:
    """Tests for _filter_cases() covering previously-uncovered branches."""

    def test_no_filters_returns_all(self):
        cases = [_case(case_id="a"), _case(case_id="b")]
        result = _filter(cases)
        assert len(result) == 2

    def test_court_filter(self):
        cases = [_case(court_code="AATA"), _case(court_code="FCA")]
        assert len(_filter(cases, court="FCA")) == 1

    def test_year_filter_valid(self):
        cases = [_case(year=2020), _case(year=2024)]
        assert len(_filter(cases, year="2024")) == 1

    def test_year_filter_invalid_string_passes_through(self):
        """Non-integer year value → ValueError caught, no filtering applied."""
        cases = [_case(year=2022), _case(year=2023)]
        result = _filter(cases, year="not-a-year")
        assert len(result) == 2  # both kept because filter is skipped

    def test_visa_type_filter_case_insensitive(self):
        cases = [
            _case(visa_type="Subclass 866 Protection"),
            _case(visa_type="Subclass 457 Work"),
        ]
        result = _filter(cases, visa_type="866")
        assert len(result) == 1
        assert result[0].visa_type == "Subclass 866 Protection"

    def test_source_filter(self):
        cases = [
            _case(source="AustLII"),
            _case(source="FedCourt"),
        ]
        result = _filter(cases, source="FedCourt")
        assert len(result) == 1
        assert result[0].source == "FedCourt"

    def test_tag_filter_case_insensitive(self):
        cases = [
            _case(tags="character;priority"),
            _case(tags="visa-only"),
        ]
        result = _filter(cases, tag="CHARACTER")
        assert len(result) == 1

    def test_nature_filter(self):
        cases = [
            _case(case_nature="Visa Refusal"),
            _case(case_nature="Cancellation"),
        ]
        result = _filter(cases, nature="Cancellation")
        assert len(result) == 1
        assert result[0].case_nature == "Cancellation"

    def test_keyword_matches_title(self):
        cases = [_case(title="Unique XYZ title"), _case(title="Other case")]
        result = _filter(cases, q="xyz")
        assert len(result) == 1

    def test_keyword_matches_citation(self):
        cases = [_case(citation="[2024] HCA 99"), _case(citation="[2024] AATA 1")]
        result = _filter(cases, q="hca")
        assert len(result) == 1

    def test_keyword_matches_catchwords(self):
        # Override legal_concepts to prevent cross-field match (default has "Natural justice")
        cases = [
            _case(catchwords="natural justice test", legal_concepts=""),
            _case(catchwords="other", legal_concepts=""),
        ]
        result = _filter(cases, q="natural justice")
        assert len(result) == 1

    def test_keyword_matches_judges(self):
        cases = [_case(judges="Gageler CJ"), _case(judges="Smith J")]
        result = _filter(cases, q="gageler")
        assert len(result) == 1

    def test_keyword_matches_outcome(self):
        cases = [_case(outcome="Set aside"), _case(outcome="Affirmed")]
        result = _filter(cases, q="set aside")
        assert len(result) == 1

    def test_keyword_matches_user_notes(self):
        cases = [_case(user_notes="important precedent"), _case(user_notes="")]
        result = _filter(cases, q="precedent")
        assert len(result) == 1

    def test_keyword_matches_legal_concepts(self):
        # Override catchwords/tags to prevent cross-field match (default has "character")
        cases = [
            _case(legal_concepts="Section 501; Character", catchwords="", tags=""),
            _case(legal_concepts="", catchwords="", tags=""),
        ]
        result = _filter(cases, q="character")
        assert len(result) == 1

    def test_multiple_filters_combined(self):
        """All active filters must match — AND semantics."""
        cases = [
            _case(court_code="AATA", year=2024, case_nature="Visa Refusal"),
            _case(court_code="AATA", year=2023, case_nature="Visa Refusal"),
            _case(court_code="FCA", year=2024, case_nature="Visa Refusal"),
        ]
        result = _filter(cases, court="AATA", year="2024", nature="Visa Refusal")
        assert len(result) == 1

    def test_empty_case_list(self):
        assert _filter([], court="AATA") == []


# ── safe_int() ────────────────────────────────────────────────────────────────


class TestSafeInt:
    def _call(self, value, **kwargs):
        from immi_case_downloader.web.helpers import safe_int
        return safe_int(value, **kwargs)

    def test_valid_string(self):
        assert self._call("42") == 42

    def test_valid_int(self):
        assert self._call(7) == 7

    def test_invalid_returns_default(self):
        assert self._call("abc", default=5) == 5

    def test_none_returns_default(self):
        assert self._call(None, default=0) == 0

    def test_min_clamp(self):
        assert self._call(1, min_val=10) == 10

    def test_max_clamp(self):
        assert self._call(200, max_val=100) == 100

    def test_no_clamp_when_in_range(self):
        assert self._call(50, min_val=1, max_val=100) == 50


# ── safe_float() ──────────────────────────────────────────────────────────────


class TestSafeFloat:
    def _call(self, value, **kwargs):
        from immi_case_downloader.web.helpers import safe_float
        return safe_float(value, **kwargs)

    def test_valid_string(self):
        assert self._call("3.14") == 3.14

    def test_invalid_returns_default(self):
        assert self._call("NaN-text", default=1.5) == 1.5

    def test_none_returns_default(self):
        assert self._call(None) == 0.0

    def test_min_clamp(self):
        assert self._call(0.1, min_val=0.5) == 0.5

    def test_max_clamp(self):
        assert self._call(10.0, max_val=5.0) == 5.0
