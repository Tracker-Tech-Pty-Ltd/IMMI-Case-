"""Regression tests for ImmigrationCase id generation and dict coercion."""

from immi_case_downloader.models import ImmigrationCase


def test_blank_key_cases_do_not_share_one_id():
    """Two records with no citation/url/title must not collapse onto one id."""
    a = ImmigrationCase(court_code="AATA", year=2024)
    b = ImmigrationCase(court_code="FCA", year=2024)
    a.ensure_id()
    b.ensure_id()

    assert len(a.case_id) == 12
    assert a.case_id != b.case_id


def test_blank_key_id_is_stable_across_calls():
    """The fallback must be deterministic so a CSV reload keeps the same id."""
    first = ImmigrationCase(court_code="AATA", year=2024)
    second = ImmigrationCase(court_code="AATA", year=2024)
    first.ensure_id()
    second.ensure_id()

    assert first.case_id == second.case_id


def test_from_dict_preserves_zero_like_values():
    """A real 0 is data, not a missing value."""
    case = ImmigrationCase.from_dict({"visa_subclass": 0, "year": 0})

    assert case.visa_subclass == "0"
    assert case.year == 0


def test_from_dict_still_cleans_nan_and_none():
    """pandas NaN, the string 'nan', and SQL NULL all mean absent."""
    case = ImmigrationCase.from_dict(
        {"citation": float("nan"), "title": "nan", "court": None, "year": float("nan")}
    )

    assert case.citation == ""
    assert case.title == ""
    assert case.court == ""
    assert case.year == 0
