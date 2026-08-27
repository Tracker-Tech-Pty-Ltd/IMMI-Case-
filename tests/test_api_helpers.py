"""Tests for pure/near-pure helper functions in api.py.

RED-GREEN VERIFICATION: test_normalise_judge_name_strips_justice was first written
with expected="WRONG" to confirm failure before correcting to the actual output
"Smith" (title-cased, no prefix).
"""

import pytest
from datetime import datetime

from immi_case_downloader.web.routes.api import (
    _parse_case_date,
    _extract_month_key,
    _normalise_outcome,
    _normalise_concept,
    _split_concepts,
    _determine_court_type,
    _win_outcomes_for_court_type,
    _is_win,
    _round_rate,
    _clean_visa,
)
from immi_case_downloader.web.judge_names import (
    _is_real_judge_name,
    _normalise_judge_name,
    _split_judges,
)
# _valid_case_id moved to api_cases.py (cq-001 Phase D1)
from immi_case_downloader.web.routes.api_cases import _valid_case_id


# ── _valid_case_id ────────────────────────────────────────────────────────────

class TestValidCaseId:
    def test_valid_12_char_hex_lowercase(self):
        assert _valid_case_id("a1b2c3d4e5f6") is True

    def test_valid_all_digits(self):
        assert _valid_case_id("123456789012") is True

    def test_rejects_too_short(self):
        assert _valid_case_id("abc") is False

    def test_rejects_too_long(self):
        assert _valid_case_id("a1b2c3d4e5f6aa") is False

    def test_rejects_uppercase_hex(self):
        # Pattern is ^[0-9a-f]{12}$ — uppercase letters fail
        assert _valid_case_id("A1B2C3D4E5F6") is False

    def test_rejects_path_traversal(self):
        assert _valid_case_id("../etc/passwd") is False

    def test_rejects_empty_string(self):
        assert _valid_case_id("") is False

    def test_rejects_non_hex_chars(self):
        assert _valid_case_id("g1b2c3d4e5f6") is False

    def test_rejects_with_spaces(self):
        assert _valid_case_id("a1b2c3d4 e5f") is False


# ── _parse_case_date ──────────────────────────────────────────────────────────

class TestParseCaseDate:
    def test_valid_date_returns_datetime(self):
        result = _parse_case_date("15 January 2024")
        assert isinstance(result, datetime)
        assert result.year == 2024
        assert result.month == 1
        assert result.day == 15

    def test_valid_date_full_month_name(self):
        result = _parse_case_date("3 September 2020")
        assert result is not None
        assert result.month == 9

    def test_strips_whitespace(self):
        result = _parse_case_date("  10 March 2023  ")
        assert result is not None
        assert result.day == 10

    def test_none_input_returns_none(self):
        assert _parse_case_date(None) is None

    def test_empty_string_returns_none(self):
        assert _parse_case_date("") is None

    def test_invalid_format_returns_none(self):
        assert _parse_case_date("2024-01-15") is None

    def test_gibberish_returns_none(self):
        assert _parse_case_date("not a date") is None

    def test_partial_date_returns_none(self):
        assert _parse_case_date("January 2024") is None


# ── _extract_month_key ────────────────────────────────────────────────────────

class TestExtractMonthKey:
    def test_valid_date_returns_yyyy_mm(self):
        result = _extract_month_key("15 January 2024")
        assert result == "2024-01"

    def test_december_returns_correct_key(self):
        result = _extract_month_key("31 December 2019")
        assert result == "2019-12"

    def test_single_digit_month_zero_padded(self):
        result = _extract_month_key("1 March 2022")
        assert result == "2022-03"

    def test_none_input_returns_none(self):
        assert _extract_month_key(None) is None

    def test_invalid_date_returns_none(self):
        assert _extract_month_key("not-a-date") is None


# ── _is_real_judge_name ───────────────────────────────────────────────────────

class TestIsRealJudgeName:
    def test_valid_two_word_name(self):
        assert _is_real_judge_name("John Smith") is True

    def test_valid_single_surname_long_enough(self):
        assert _is_real_judge_name("Smith") is True

    def test_rejects_empty_string(self):
        assert _is_real_judge_name("") is False

    def test_rejects_disqualifier_word(self):
        # "Tribunal" is in _NAME_DISQUALIFIERS
        assert _is_real_judge_name("Tribunal") is False

    def test_rejects_word_with_digit(self):
        # Contains a digit — regex requires [A-Za-z][A-Za-z'.-]*\.?
        assert _is_real_judge_name("Smith4") is False

    def test_rejects_too_short_single_token(self):
        # Single token < 3 chars is rejected
        assert _is_real_judge_name("Jo") is False

    def test_rejects_too_many_words(self):
        # More than 8 words
        assert _is_real_judge_name("A B C D E F G H I") is False

    def test_rejects_all_initials(self):
        # All tokens are single chars (initials only — no non-initial token)
        assert _is_real_judge_name("A. B.") is False

    def test_valid_name_with_hyphen(self):
        assert _is_real_judge_name("O'Brien") is True

    def test_rejects_all_lowercase(self):
        # No word starts with uppercase
        assert _is_real_judge_name("smith jones") is False


# ── _normalise_judge_name ─────────────────────────────────────────────────────

class TestNormaliseJudgeName:
    def test_strips_justice_prefix(self):
        result = _normalise_judge_name("Justice Smith")
        assert result == "Smith"

    def test_strips_senior_member_prefix(self):
        result = _normalise_judge_name("Senior Member Jones")
        assert result == "Jones"

    def test_strips_trailing_j_suffix(self):
        result = _normalise_judge_name("Smith J")
        assert result == "Smith"

    def test_strips_trailing_cj_suffix(self):
        result = _normalise_judge_name("Brown CJ")
        assert result == "Brown"

    def test_title_cases_output(self):
        result = _normalise_judge_name("SMITH")
        assert result == "Smith"

    def test_handles_the_honourable_justice(self):
        result = _normalise_judge_name("The Honourable Justice Williams")
        assert result == "Williams"

    def test_empty_string_returns_empty(self):
        assert _normalise_judge_name("") == ""

    def test_mac_capitalisation(self):
        result = _normalise_judge_name("Justice MacDonald")
        # After stripping "Justice ", title() gives "Macdonald", then Mac regex fires:
        # re.sub(r"\bMac([a-z])", ...) → "MacDonald"
        assert result == "MacDonald"

    def test_strips_mr_prefix(self):
        result = _normalise_judge_name("Mr. O'Brien")
        assert result == "O'Brien"

    def test_removes_bracket_artifacts(self):
        result = _normalise_judge_name("(Smith)")
        # Brackets removed, then whitespace stripped; title-cased
        assert result == "Smith"


# ── _normalise_outcome ────────────────────────────────────────────────────────

class TestNormaliseOutcome:
    def test_affirmed(self):
        assert _normalise_outcome("affirmed") == "Affirmed"

    def test_dismissed_case_insensitive(self):
        assert _normalise_outcome("Decision dismissed") == "Dismissed"

    def test_set_aside(self):
        assert _normalise_outcome("set aside") == "Set Aside"

    def test_remitted(self):
        assert _normalise_outcome("remitted") == "Remitted"

    def test_allowed(self):
        assert _normalise_outcome("allowed") == "Allowed"

    def test_granted(self):
        assert _normalise_outcome("granted") == "Granted"

    def test_quashed(self):
        assert _normalise_outcome("quashed") == "Quashed"

    def test_empty_string_returns_other(self):
        assert _normalise_outcome("") == "Other"

    def test_unrecognised_text_returns_other(self):
        assert _normalise_outcome("pending decision") == "Other"

    def test_discontinued_maps_to_withdrawn(self):
        assert _normalise_outcome("discontinued") == "Withdrawn"


# ── _normalise_concept ────────────────────────────────────────────────────────

class TestNormaliseConcept:
    def test_known_concept_exact(self):
        assert _normalise_concept("refugee") == "Refugee Status"

    def test_known_concept_with_trailing_punctuation(self):
        assert _normalise_concept("well-founded fear,") == "Well-Founded Fear"

    def test_unknown_concept_returns_empty(self):
        assert _normalise_concept("some random phrase") == ""

    def test_strips_whitespace_before_lookup(self):
        assert _normalise_concept("  persecution  ") == "Persecution"

    def test_jurisdictional_error(self):
        assert _normalise_concept("jurisdictional error") == "Jurisdictional Error"

    def test_well_founded_fear_variant(self):
        assert _normalise_concept("well founded fear") == "Well-Founded Fear"


# ── _split_concepts ───────────────────────────────────────────────────────────

class TestSplitConcepts:
    def test_splits_semicolon_separated(self):
        result = _split_concepts("refugee; persecution")
        assert "Refugee Status" in result
        assert "Persecution" in result

    def test_splits_comma_separated(self):
        result = _split_concepts("asylum, well-founded fear")
        assert "Refugee Status" in result
        assert "Well-Founded Fear" in result

    def test_deduplicates_synonyms(self):
        # "refugee" and "asylum" both map to "Refugee Status"
        result = _split_concepts("refugee; asylum")
        assert result.count("Refugee Status") == 1

    def test_empty_string_returns_empty_list(self):
        assert _split_concepts("") == []

    def test_drops_unknown_concepts(self):
        result = _split_concepts("some noise text; persecution")
        assert result == ["Persecution"]

    def test_none_safe(self):
        assert _split_concepts(None) == []  # type: ignore[arg-type]


# ── _split_judges ─────────────────────────────────────────────────────────────

class TestSplitJudges:
    """_split_judges calls _known_singleton_judge_names → _load_judge_bios →
    get_output_dir(), which requires a Flask application context."""

    @pytest.fixture(autouse=True)
    def _app_ctx(self, tmp_path):
        from immi_case_downloader.webapp import create_app
        from immi_case_downloader.storage import ensure_output_dirs

        ensure_output_dirs(str(tmp_path))
        application = create_app(str(tmp_path))
        application.config["TESTING"] = True
        application.config["WTF_CSRF_ENABLED"] = False
        with application.app_context():
            yield

    def test_single_judge_with_title(self):
        result = _split_judges("Justice Smith")
        assert result == ["Smith"]

    def test_comma_separated_judges(self):
        result = _split_judges("Justice Smith, Justice Jones")
        assert "Smith" in result
        assert "Jones" in result

    def test_empty_string_returns_empty_list(self):
        assert _split_judges("") == []

    def test_deduplicates_same_judge(self):
        result = _split_judges("Justice Smith, Justice Smith")
        assert result.count("Smith") == 1

    def test_drops_noise_words(self):
        # "tribunal" is in _JUDGE_BLOCKLIST — should not appear
        result = _split_judges("tribunal, Justice Smith")
        assert "Tribunal" not in result
        assert "Smith" in result

    def test_none_safe(self):
        assert _split_judges(None) == []  # type: ignore[arg-type]


# ── _determine_court_type ─────────────────────────────────────────────────────

class TestDetermineCourtType:
    def test_tribunal_codes_only(self):
        assert _determine_court_type({"AATA"}) == "tribunal"

    def test_court_codes_only(self):
        assert _determine_court_type({"FCA"}) == "court"

    def test_mixed_codes(self):
        assert _determine_court_type({"AATA", "FCA"}) == "mixed"

    def test_empty_set_returns_unknown(self):
        assert _determine_court_type(set()) == "unknown"

    def test_multiple_tribunal_codes(self):
        assert _determine_court_type({"AATA", "RRTA"}) == "tribunal"

    def test_multiple_court_codes(self):
        assert _determine_court_type({"FCA", "HCA"}) == "court"


# ── _win_outcomes_for_court_type ──────────────────────────────────────────────

class TestWinOutcomesForCourtType:
    def test_tribunal_includes_remitted(self):
        outcomes = _win_outcomes_for_court_type("tribunal")
        assert "Remitted" in outcomes

    def test_tribunal_excludes_allowed(self):
        outcomes = _win_outcomes_for_court_type("tribunal")
        assert "Allowed" not in outcomes

    def test_court_includes_allowed(self):
        outcomes = _win_outcomes_for_court_type("court")
        assert "Allowed" in outcomes

    def test_court_excludes_remitted(self):
        outcomes = _win_outcomes_for_court_type("court")
        assert "Remitted" not in outcomes

    def test_mixed_includes_both_allowed_and_remitted(self):
        outcomes = _win_outcomes_for_court_type("mixed")
        assert "Allowed" in outcomes
        assert "Remitted" in outcomes

    def test_unknown_type_falls_back_to_mixed(self):
        outcomes = _win_outcomes_for_court_type("unknown")
        # Falls through to the final `return list(_MIXED_WIN_OUTCOMES)`
        assert "Allowed" in outcomes


# ── _is_win ───────────────────────────────────────────────────────────────────

class TestIsWin:
    def test_tribunal_remitted_is_win(self):
        assert _is_win("Remitted", "AATA") is True

    def test_tribunal_affirmed_is_not_win(self):
        assert _is_win("Affirmed", "AATA") is False

    def test_court_allowed_is_win(self):
        assert _is_win("Allowed", "FCA") is True

    def test_court_dismissed_is_not_win(self):
        assert _is_win("Dismissed", "FCA") is False

    def test_tribunal_set_aside_is_win(self):
        assert _is_win("Set Aside", "RRTA") is True

    def test_unknown_court_falls_back_to_mixed(self):
        # Unknown court code uses _MIXED_WIN_OUTCOMES
        assert _is_win("Allowed", "UNKNOWN") is True

    def test_unknown_court_remitted_is_win(self):
        assert _is_win("Remitted", "UNKNOWN") is True


# ── _round_rate ───────────────────────────────────────────────────────────────

class TestRoundRate:
    def test_basic_percentage(self):
        assert _round_rate(1, 2) == 50.0

    def test_zero_denominator_returns_zero(self):
        assert _round_rate(10, 0) == 0.0

    def test_negative_denominator_returns_zero(self):
        assert _round_rate(10, -5) == 0.0

    def test_full_rate(self):
        assert _round_rate(3, 3) == 100.0

    def test_rounding_to_one_decimal(self):
        # 1/3 * 100 = 33.333... → 33.3
        result = _round_rate(1, 3)
        assert result == 33.3

    def test_zero_numerator(self):
        assert _round_rate(0, 100) == 0.0


# ── _clean_visa ───────────────────────────────────────────────────────────────

class TestCleanVisa:
    def test_numeric_string_passthrough(self):
        # clean_subclass returns the subclass number as a string
        result = _clean_visa("866")
        assert isinstance(result, str)

    def test_none_input_returns_string(self):
        result = _clean_visa(None)
        assert isinstance(result, str)

    def test_nan_input_returns_string(self):
        result = _clean_visa(float("nan"))
        assert isinstance(result, str)

    def test_empty_string_returns_string(self):
        result = _clean_visa("")
        assert isinstance(result, str)


# ── _has_analytics_filters (Flask context required) ───────────────────────────

class TestHasAnalyticsFilters:
    """Tests for _has_analytics_filters() using Flask test client context."""

    @pytest.fixture
    def flask_app(self, tmp_path):
        from immi_case_downloader.webapp import create_app
        from immi_case_downloader.storage import ensure_output_dirs

        ensure_output_dirs(str(tmp_path))
        application = create_app(str(tmp_path))
        application.config["TESTING"] = True
        application.config["WTF_CSRF_ENABLED"] = False
        return application

    def test_no_filters_returns_false(self, flask_app):
        from immi_case_downloader.web.routes.api import _has_analytics_filters

        with flask_app.test_request_context("/api/v1/analytics/outcomes"):
            assert _has_analytics_filters() is False

    def test_court_filter_returns_true(self, flask_app):
        from immi_case_downloader.web.routes.api import _has_analytics_filters

        with flask_app.test_request_context("/api/v1/analytics/outcomes?court=AATA"):
            assert _has_analytics_filters() is True

    def test_year_from_filter_returns_true(self, flask_app):
        from immi_case_downloader.web.routes.api import _has_analytics_filters

        with flask_app.test_request_context("/api/v1/analytics/outcomes?year_from=2020"):
            assert _has_analytics_filters() is True

    def test_visa_subclasses_filter_returns_true(self, flask_app):
        from immi_case_downloader.web.routes.api import _has_analytics_filters

        with flask_app.test_request_context(
            "/api/v1/analytics/outcomes?visa_subclasses=866"
        ):
            assert _has_analytics_filters() is True
