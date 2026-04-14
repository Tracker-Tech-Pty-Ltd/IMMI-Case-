"""Unit tests for Legislations API endpoints.

Covers:
- GET /api/v1/legislations (list with pagination)
- GET /api/v1/legislations/<id> (detail by ID)
- GET /api/v1/legislations/search (search with query)

Tests include success paths, error cases, edge cases, and parameter validation.
"""

from __future__ import annotations

from unittest.mock import patch
import pytest


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def clear_legislations_cache():
    """Clear legislation cache before each test to prevent test pollution."""
    import immi_case_downloader.web.routes.legislations as leg_module
    leg_module._legislations_cache = None
    yield
    leg_module._legislations_cache = None


@pytest.fixture
def mock_legislations_data() -> list[dict]:
    """Mock legislations data for testing."""
    return [
        {
            "id": "migration-act-1958",
            "title": "Migration Act 1958",
            "shortcode": "MA1958",
            "jurisdiction": "Commonwealth",
            "type": "Act",
            "description": "The primary legislation governing migration to, from and within Australia.",
            "full_text": "AN ACT to provide for and in relation to...",
            "sections": 231,
            "last_amended": "2025-12-01",
        },
        {
            "id": "migration-regulations-1994",
            "title": "Migration Regulations 1994",
            "shortcode": "MR1994",
            "jurisdiction": "Commonwealth",
            "type": "Regulation",
            "description": "Subordinate legislation made under the Migration Act 1958.",
            "full_text": "MIGRATION REGULATIONS 1994...",
            "sections": 456,
            "last_amended": "2025-11-15",
        },
        {
            "id": "australian-citizenship-act-2007",
            "title": "Australian Citizenship Act 2007",
            "shortcode": "ACA2007",
            "jurisdiction": "Commonwealth",
            "type": "Act",
            "description": "Legislation that governs the acquisition, loss, and cessation of Australian citizenship.",
            "full_text": "AN ACT relating to Australian citizenship...",
            "sections": 134,
            "last_amended": "2025-10-20",
        },
        {
            "id": "migration-agents-registration-act-1994",
            "title": "Migration Agents Registration Act 1994",
            "shortcode": "MARA1994",
            "jurisdiction": "Commonwealth",
            "type": "Act",
            "description": "Legislation establishing a registration system for migration agents.",
            "full_text": "AN ACT relating to the registration of migration agents...",
            "sections": 89,
            "last_amended": "2025-09-30",
        },
        {
            "id": "protection-of-borders-act-2015",
            "title": "Protection of Borders Act 2015",
            "shortcode": "PBA2015",
            "jurisdiction": "Commonwealth",
            "type": "Act",
            "description": "Legislation that amends the Migration Act 1958 to provide enhanced border control measures.",
            "full_text": "AN ACT to amend the Migration Act 1958...",
            "sections": 67,
            "last_amended": "2025-08-15",
        },
    ]


@pytest.fixture
def api_client():
    """Create a Flask test client with legislations API enabled."""
    from immi_case_downloader.web import create_app

    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


# ── Test GET /api/v1/legislations (List endpoint) ──────────────────────────


class TestLegislationsListEndpoint:
    """Tests for the list legislations endpoint."""

    def test_list_all_legislations_default_pagination(self, api_client, mock_legislations_data):
        """Test 1: List all legislations with default pagination.

        Expected:
        - 200 status
        - success=true
        - data array with items
        - meta contains total/page/limit/pages
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            assert isinstance(data["data"], list)
            # Mock data has 5 items; default limit is 10, so all 5 are returned
            assert len(data["data"]) == 5
            assert data["meta"]["total"] == 5
            assert data["meta"]["page"] == 1
            assert data["meta"]["limit"] == 10
            assert data["meta"]["pages"] == 1

    def test_list_custom_pagination_parameters(self, api_client, mock_legislations_data):
        """Test 2: Custom pagination parameters.

        Expected:
        - 200 status
        - Correct slice of data (page 2, limit 2)
        - meta.page=2, meta.limit=2
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations?page=2&limit=2")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            assert len(data["data"]) == 2
            # Verify these are the 3rd and 4th items (page 2, items per page = 2)
            # Page 1: items 0-1, Page 2: items 2-3, Page 3: item 4
            assert data["meta"]["page"] == 2
            assert data["meta"]["limit"] == 2
            assert data["meta"]["pages"] == 3
            # Verify the items are from indices 2-3
            assert data["data"][0]["id"] == mock_legislations_data[2]["id"]
            assert data["data"][1]["id"] == mock_legislations_data[3]["id"]

    def test_list_invalid_page_too_high(self, api_client, mock_legislations_data):
        """Test 3: Invalid page number (too high).

        Expected:
        - 400 status
        - Error message contains "page must be <="
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations?page=999&limit=10")

            assert response.status_code == 400
            data = response.get_json()
            assert data["success"] is False
            assert "page must be <=" in data["error"]

    def test_list_invalid_limit_too_high_auto_capped(self, api_client, mock_legislations_data):
        """Test 4: Invalid limit (too high) — auto-capped to 100.

        Expected:
        - 200 status
        - meta.limit auto-capped to 100
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations?limit=101")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            assert data["meta"]["limit"] == 100

    def test_list_invalid_page_negative(self, api_client, mock_legislations_data):
        """Test 5: Invalid page (negative).

        Expected:
        - 400 status
        - Error message contains "page must be >= 1"
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations?page=-1")

            assert response.status_code == 400
            data = response.get_json()
            assert data["success"] is False
            assert "page must be >= 1" in data["error"]

    def test_list_empty_results(self, api_client):
        """Test 6: Empty results.

        Expected:
        - 200 status
        - data=[], meta.total=0, meta.pages=0
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=[],
        ):
            response = api_client.get("/api/v1/legislations")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            assert data["data"] == []
            assert data["meta"]["total"] == 0
            assert data["meta"]["pages"] == 0

    def test_list_returns_json_content_type(self, api_client, mock_legislations_data):
        """Test that list endpoint returns JSON content type.

        Expected:
        - 200 status
        - Content-Type: application/json
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations")
            assert response.content_type == "application/json"
            assert response.status_code == 200


# ── Test GET /api/v1/legislations/<id> (Detail endpoint) ────────────────────


class TestLegislationsDetailEndpoint:
    """Tests for the detail legislations endpoint."""

    def test_get_existing_legislation_by_id(self, api_client, mock_legislations_data):
        """Test 7: Get existing legislation by ID.

        Expected:
        - 200 status
        - success=true
        - data object with full legislation details
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/migration-act-1958")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            assert data["data"]["id"] == "migration-act-1958"
            assert data["data"]["title"] == "Migration Act 1958"
            assert data["data"]["shortcode"] == "MA1958"

    def test_get_legislation_case_insensitive_id(self, api_client, mock_legislations_data):
        """Test 8: Get legislation with case-insensitive ID.

        Expected:
        - 200 status
        - Same legislation returned (case-insensitive match)
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/MIGRATION-ACT-1958")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            assert data["data"]["id"] == "migration-act-1958"

    def test_get_nonexistent_legislation_id(self, api_client, mock_legislations_data):
        """Test 9: Non-existent legislation ID.

        Expected:
        - 404 status
        - Error message contains "not found"
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/nonexistent-law")

            assert response.status_code == 404
            data = response.get_json()
            assert data["success"] is False
            assert "not found" in data["error"].lower()

    def test_get_empty_legislation_id(self, api_client, mock_legislations_data):
        """Test 10: Trailing slash on the list endpoint returns the legislation list.

        strict_slashes=False on the list route means /api/v1/legislations/ is
        equivalent to /api/v1/legislations and returns 200 with the full list.
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/")

            assert response.status_code == 200
            data = response.get_json()
            assert data is not None and "data" in data

    def test_detail_returns_json_content_type(self, api_client, mock_legislations_data):
        """Test that detail endpoint returns JSON content type.

        Expected:
        - 200 status
        - Content-Type: application/json
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/migration-act-1958")
            assert response.content_type == "application/json"
            assert response.status_code == 200


# ── Test GET /api/v1/legislations/search (Search endpoint) ──────────────────


class TestLegislationsSearchEndpoint:
    """Tests for the search legislations endpoint."""

    def test_search_valid_query(self, api_client, mock_legislations_data):
        """Test 11: Search with valid query.

        Expected:
        - 200 status
        - data array with matching legislations
        - Results include legislations with "migration" in title/description
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/search?q=migration")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            assert isinstance(data["data"], list)
            # Should match: migration-act-1958, migration-regulations-1994,
            # migration-agents-registration-act-1994
            assert len(data["data"]) >= 3
            assert data["meta"]["query"] == "migration"

    def test_search_insufficient_query_length(self, api_client, mock_legislations_data):
        """Test 12: Search with insufficient query length.

        Expected:
        - 400 status
        - Error message contains "at least 2 characters"
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/search?q=a")

            assert response.status_code == 400
            data = response.get_json()
            assert data["success"] is False
            assert "at least 2 characters" in data["error"]

    def test_search_no_query_parameter(self, api_client, mock_legislations_data):
        """Test 13: Search with no query parameter.

        Expected:
        - 400 status
        - Error message contains "query is required"
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/search")

            assert response.status_code == 400
            data = response.get_json()
            assert data["success"] is False
            assert "required" in data["error"].lower()

    def test_search_across_multiple_fields(self, api_client, mock_legislations_data):
        """Test 14: Search across multiple fields.

        Expected:
        - 200 status
        - Returns legislations matching in title OR shortcode OR id OR description
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            # Search by shortcode
            response = api_client.get("/api/v1/legislations/search?q=ma1958")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            # Should match by shortcode (case-insensitive)
            assert len(data["data"]) >= 1
            assert any(leg["id"] == "migration-act-1958" for leg in data["data"])

    def test_search_with_limit_parameter(self, api_client, mock_legislations_data):
        """Test 15: Search with limit parameter.

        Expected:
        - 200 status
        - Results limited to specified limit (2 items)
        - meta.total_results shows actual count, data limited to 2
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/search?q=act&limit=2")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            # Limit applies to returned results
            assert len(data["data"]) <= 2
            # meta shows total results found (before limit)
            assert data["meta"]["limit"] == 2

    def test_search_no_results(self, api_client, mock_legislations_data):
        """Test 16: Search with no results.

        Expected:
        - 200 status
        - data=[], meta.total_results=0
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/search?q=nonexistentterm123")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            assert data["data"] == []
            assert data["meta"]["total_results"] == 0


# ── Additional Edge Cases ────────────────────────────────────────────────────


class TestLegislationsEdgeCases:
    """Additional edge case tests for robustness."""

    def test_list_with_whitespace_limit(self, api_client, mock_legislations_data):
        """Test pagination with string limit (should convert to int)."""
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations?limit=3")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            assert len(data["data"]) == 3

    def test_search_query_with_special_characters(self, api_client, mock_legislations_data):
        """Test search with special characters in query."""
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/search?q=Act%201958")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True

    def test_get_legislation_with_whitespace_in_id(self, api_client, mock_legislations_data):
        """Test get with whitespace in ID (should be stripped)."""
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/%20migration-act-1958%20")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True

    def test_list_page_one_explicit(self, api_client, mock_legislations_data):
        """Test explicit page=1 returns same as default."""
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response_default = api_client.get("/api/v1/legislations")
            response_explicit = api_client.get("/api/v1/legislations?page=1")

            data_default = response_default.get_json()
            data_explicit = response_explicit.get_json()

            assert data_default["data"] == data_explicit["data"]
            assert data_default["meta"]["page"] == data_explicit["meta"]["page"]

    def test_search_limit_exceeds_total_results(self, api_client, mock_legislations_data):
        """Test search limit larger than available results."""
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/search?q=act&limit=100")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            # Should return all matching results (fewer than 100)
            assert len(data["data"]) > 0
            assert len(data["data"]) <= 100

    def test_search_returns_json_content_type(self, api_client, mock_legislations_data):
        """Test that search endpoint returns JSON content type.

        Expected:
        - 200 status
        - Content-Type: application/json
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/search?q=migration")
            assert response.content_type == "application/json"
            assert response.status_code == 200

    def test_search_total_results_not_limited_by_limit(self, api_client, mock_legislations_data):
        """Test that total_results shows all matches, not limited by limit parameter.

        Expected:
        - 200 status
        - data limited to 2 items
        - total_results shows all matches (not limited)
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            return_value=mock_legislations_data,
        ):
            response = api_client.get("/api/v1/legislations/search?q=act&limit=2")

            assert response.status_code == 200
            data = response.get_json()
            assert data["success"] is True
            # data is limited to 2 items
            assert len(data["data"]) == 2
            # total_results shows all matches (should be > 2)
            assert data["meta"]["total_results"] > 2
            assert data["meta"]["limit"] == 2


# ── Exception Handling Tests ──────────────────────────────────────────────────


class TestLegislationsExceptionHandling:
    """Test exception handling in legislations endpoints."""

    def test_list_legislations_handles_exception(self, api_client):
        """Test that list endpoint returns 500 on exception.

        Expected:
        - 500 status
        - success=false
        - Error message contains "Failed to list legislations"
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            side_effect=Exception("Unexpected error"),
        ):
            response = api_client.get("/api/v1/legislations")
            data = response.get_json()
            assert response.status_code == 500
            assert data["success"] is False
            assert "Failed to list legislations" in data["error"]

    def test_get_legislation_handles_exception(self, api_client):
        """Test that detail endpoint returns 500 on exception.

        Expected:
        - 500 status
        - success=false
        - Error message contains "Failed to fetch legislation"
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            side_effect=Exception("Unexpected error"),
        ):
            response = api_client.get("/api/v1/legislations/test-id")
            data = response.get_json()
            assert response.status_code == 500
            assert data["success"] is False
            assert "Failed to fetch legislation" in data["error"]

    def test_search_legislations_handles_exception(self, api_client):
        """Test that search endpoint returns 500 on exception.

        Expected:
        - 500 status
        - success=false
        - Error message contains "Failed to search legislations"
        """
        with patch(
            "immi_case_downloader.web.routes.legislations._load_legislations",
            side_effect=Exception("Unexpected error"),
        ):
            response = api_client.get("/api/v1/legislations/search?q=test")
            data = response.get_json()
            assert response.status_code == 500
            assert data["success"] is False
            assert "Failed to search legislations" in data["error"]
