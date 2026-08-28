"""Test date parsing and monthly trends logic."""


class TestDateParsing:
    def test_parse_case_date_standard_format(self):
        """Parse 'DD Month YYYY' format correctly."""
        from immi_case_downloader.web.routes.api import _parse_case_date
        from datetime import datetime
        result = _parse_case_date("15 March 2024")
        assert result == datetime(2024, 3, 15)

    def test_parse_case_date_single_digit_day(self):
        """Single-digit day must also parse correctly."""
        from immi_case_downloader.web.routes.api import _parse_case_date
        from datetime import datetime
        result = _parse_case_date("9 January 2025")
        assert result == datetime(2025, 1, 9)

    def test_parse_case_date_invalid_returns_none(self):
        """Invalid/empty dates return None, not raise."""
        from immi_case_downloader.web.routes.api import _parse_case_date
        assert _parse_case_date("") is None
        assert _parse_case_date("not a date") is None
        assert _parse_case_date(None) is None

    def test_extract_month_key_standard_format(self):
        """Extract YYYY-MM from 'DD Month YYYY' correctly."""
        from immi_case_downloader.web.routes.api import _extract_month_key
        assert _extract_month_key("15 March 2024") == "2024-03"
        assert _extract_month_key("9 January 2025") == "2025-01"
        assert _extract_month_key("1 December 2000") == "2000-12"

    def test_extract_month_key_invalid_returns_none(self):
        """Invalid dates return None."""
        from immi_case_downloader.web.routes.api import _extract_month_key
        assert _extract_month_key("") is None
        assert _extract_month_key("15 Marc") is None  # the old broken slice output
        assert _extract_month_key(None) is None

    def test_old_broken_slice_would_fail(self):
        """Demonstrate that the old c.date[:7] was producing garbage."""
        date_str = "15 March 2024"
        # The OLD broken code:
        old_result = date_str[:7]
        assert old_result == "15 Marc"  # Proves the old approach was wrong

        # The NEW correct code:
        from immi_case_downloader.web.routes.api import _extract_month_key
        new_result = _extract_month_key(date_str)
        assert new_result == "2024-03"  # Correct YYYY-MM


class TestMonthlyTrendsWinRate:
    def test_tribunal_granted_is_win(self):
        """'Granted' must be a win for tribunal courts."""
        from immi_case_downloader.web.routes.api import _is_win
        assert _is_win("Granted", "AATA") is True

    def test_tribunal_quashed_is_win(self):
        """'Quashed' must be a win for tribunal courts."""
        from immi_case_downloader.web.routes.api import _is_win
        assert _is_win("Quashed", "AATA") is True

    def test_tribunal_remitted_is_win(self):
        """'Remitted' must be a win for tribunal courts."""
        from immi_case_downloader.web.routes.api import _is_win
        assert _is_win("Remitted", "AATA") is True

    def test_court_allowed_is_win(self):
        """'Allowed' must be a win for regular courts."""
        from immi_case_downloader.web.routes.api import _is_win
        assert _is_win("Allowed", "FCA") is True

    def test_dismissed_is_not_win(self):
        """'Dismissed' is not a win."""
        from immi_case_downloader.web.routes.api import _is_win
        assert _is_win("Dismissed", "AATA") is False
        assert _is_win("Dismissed", "FCA") is False
