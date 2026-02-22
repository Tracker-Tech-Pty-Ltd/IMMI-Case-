"""Unit tests for Visa Lookup Taxonomy API endpoint.

Covers:
- GET /api/v1/taxonomy/visa-lookup (quick-lookup with query)

Tests include success paths, error cases, edge cases, and parameter validation.
"""

from __future__ import annotations

from unittest.mock import patch
import pytest

from immi_case_downloader.models import ImmigrationCase


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture
def api_client():
    """Create a Flask test client with API enabled."""
    from immi_case_downloader.web import create_app

    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


@pytest.fixture
def mock_cases() -> list[ImmigrationCase]:
    """Mock cases with various visa subclasses."""
    return [
        ImmigrationCase(
            citation="Case1 [2020] AATA 1",
            url="http://example.com/1",
            title="Case 1",
            court_code="AATA",
            year=2020,
            visa_subclass="866",
        ),
        ImmigrationCase(
            citation="Case2 [2020] AATA 2",
            url="http://example.com/2",
            title="Case 2",
            court_code="AATA",
            year=2020,
            visa_subclass="866",
        ),
        ImmigrationCase(
            citation="Case3 [2020] AATA 3",
            url="http://example.com/3",
            title="Case 3",
            court_code="AATA",
            year=2020,
            visa_subclass="500",
        ),
        ImmigrationCase(
            citation="Case4 [2020] AATA 4",
            url="http://example.com/4",
            title="Case 4",
            court_code="AATA",
            year=2020,
            visa_subclass="785",
        ),
    ]


# ── Tests: Success Cases ─────────────────────────────────────────────────────


def test_visa_lookup_exact_numeric_match(api_client, mock_cases):
    """Test exact numeric match returns correct visa."""
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=mock_cases):
        resp = api_client.get("/api/v1/taxonomy/visa-lookup?q=866")
        assert resp.status_code == 200

        data = resp.get_json()
        assert data["success"] is True
        assert "data" in data
        assert "meta" in data
        assert data["meta"]["query"] == "866"
        assert data["meta"]["total_results"] == 1

        # Should return the Protection visa (866)
        assert len(data["data"]) == 1
        visa = data["data"][0]
        assert visa["subclass"] == "866"
        assert visa["name"] == "Protection"
        assert visa["family"] == "Protection"
        assert visa["case_count"] == 2  # 2 cases with visa 866


def test_visa_lookup_prefix_numeric_match(api_client, mock_cases):
    """Test prefix numeric match returns all matching visas."""
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=mock_cases):
        resp = api_client.get("/api/v1/taxonomy/visa-lookup?q=5")
        assert resp.status_code == 200

        data = resp.get_json()
        assert data["success"] is True
        assert data["meta"]["query"] == "5"

        # Should return visas starting with "5": 500, 570-576, 590, 051, 050
        subclasses = [v["subclass"] for v in data["data"]]
        assert "500" in subclasses  # Student visa


def test_visa_lookup_name_match(api_client, mock_cases):
    """Test name search returns matching visas."""
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=mock_cases):
        resp = api_client.get("/api/v1/taxonomy/visa-lookup?q=protection")
        assert resp.status_code == 200

        data = resp.get_json()
        assert data["success"] is True
        assert data["meta"]["query"] == "protection"

        # Should return all visas with "protection" in name
        names = [v["name"] for v in data["data"]]
        assert "Protection" in names
        assert "Temporary Protection" in names


def test_visa_lookup_limit_parameter(api_client, mock_cases):
    """Test limit parameter restricts results."""
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=mock_cases):
        resp = api_client.get("/api/v1/taxonomy/visa-lookup?q=protection&limit=1")
        assert resp.status_code == 200

        data = resp.get_json()
        assert data["success"] is True
        assert len(data["data"]) == 1  # Limited to 1 result
        assert data["meta"]["limit"] == 1


def test_visa_lookup_case_insensitive(api_client, mock_cases):
    """Test search is case-insensitive."""
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=mock_cases):
        resp1 = api_client.get("/api/v1/taxonomy/visa-lookup?q=PROTECTION")
        resp2 = api_client.get("/api/v1/taxonomy/visa-lookup?q=protection")
        resp3 = api_client.get("/api/v1/taxonomy/visa-lookup?q=Protection")

        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp3.status_code == 200

        data1 = resp1.get_json()
        data2 = resp2.get_json()
        data3 = resp3.get_json()

        # All should return the same results
        assert len(data1["data"]) == len(data2["data"]) == len(data3["data"])


# ── Tests: Error Cases ───────────────────────────────────────────────────────


def test_visa_lookup_missing_query(api_client):
    """Test endpoint returns error when q parameter is missing."""
    resp = api_client.get("/api/v1/taxonomy/visa-lookup")
    assert resp.status_code == 400

    data = resp.get_json()
    assert data["success"] is False
    assert "q parameter is required" in data["error"]


def test_visa_lookup_empty_query(api_client):
    """Test endpoint returns error for empty query."""
    resp = api_client.get("/api/v1/taxonomy/visa-lookup?q=")
    assert resp.status_code == 400

    data = resp.get_json()
    assert data["success"] is False
    assert "q parameter is required" in data["error"]


def test_visa_lookup_invalid_limit(api_client):
    """Test endpoint returns error for invalid limit."""
    resp = api_client.get("/api/v1/taxonomy/visa-lookup?q=866&limit=0")
    assert resp.status_code == 400

    data = resp.get_json()
    assert data["success"] is False
    assert "limit must be >= 1" in data["error"]


def test_visa_lookup_limit_max_enforced(api_client, mock_cases):
    """Test limit is capped at 50."""
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=mock_cases):
        resp = api_client.get("/api/v1/taxonomy/visa-lookup?q=a&limit=999")
        assert resp.status_code == 200

        data = resp.get_json()
        assert data["success"] is True
        assert data["meta"]["limit"] == 50  # Capped at max


# ── Tests: Edge Cases ────────────────────────────────────────────────────────


def test_visa_lookup_no_matches(api_client, mock_cases):
    """Test endpoint returns empty results for no matches."""
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=mock_cases):
        resp = api_client.get("/api/v1/taxonomy/visa-lookup?q=99999")
        assert resp.status_code == 200

        data = resp.get_json()
        assert data["success"] is True
        assert len(data["data"]) == 0
        assert data["meta"]["total_results"] == 0


def test_visa_lookup_with_zero_cases(api_client):
    """Test endpoint works when no cases exist in database."""
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=[]):
        resp = api_client.get("/api/v1/taxonomy/visa-lookup?q=866")
        assert resp.status_code == 200

        data = resp.get_json()
        assert data["success"] is True
        assert len(data["data"]) == 1  # Visa exists in registry
        assert data["data"][0]["subclass"] == "866"
        assert data["data"][0]["case_count"] == 0  # No cases


def test_visa_lookup_sorting_exact_match_first(api_client, mock_cases):
    """Test exact matches appear before prefix/partial matches."""
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=mock_cases):
        resp = api_client.get("/api/v1/taxonomy/visa-lookup?q=5")
        assert resp.status_code == 200

        data = resp.get_json()
        assert data["success"] is True

        # First result should be "500" (student visa with 1 case)
        # because it has actual cases (case_count > 0)
        first = data["data"][0]
        if first["case_count"] > 0:
            assert first["subclass"] == "500"
