"""Tests for Cases CRUD API endpoints — /api/v1/cases/* routes."""

import json

import pytest



# ── Helpers ──────────────────────────────────────────────────────────────


def _get_case_ids(client):
    """Fetch all case IDs from the listing endpoint."""
    resp = client.get("/api/v1/cases")
    data = resp.get_json()
    return [c["case_id"] for c in data["cases"]]


def _first_case_id(client):
    """Return the first case_id from the listing."""
    ids = _get_case_ids(client)
    assert ids, "No cases found in test data"
    return ids[0]


# ── GET /api/v1/cases ────────────────────────────────────────────────────


class TestListCases:
    def test_list_cases_returns_200(self, client):
        """GET /api/v1/cases returns 200 with cases array."""
        resp = client.get("/api/v1/cases")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "cases" in data
        assert isinstance(data["cases"], list)

    def test_list_cases_has_pagination_metadata(self, client):
        """Response includes total, page, page_size, total_pages."""
        resp = client.get("/api/v1/cases")
        data = resp.get_json()
        for key in ("total", "page", "page_size", "total_pages"):
            assert key in data, f"Missing pagination key: {key}"

    def test_list_cases_pagination(self, client):
        """Pagination parameters limit results correctly."""
        resp = client.get("/api/v1/cases?page=1&page_size=2")
        data = resp.get_json()
        assert data["page"] == 1
        assert data["page_size"] == 2
        assert len(data["cases"]) <= 2

    def test_list_cases_filter_by_court(self, client):
        """Filtering by court returns only matching cases."""
        resp = client.get("/api/v1/cases?court=FCA")
        data = resp.get_json()
        assert resp.status_code == 200
        for case in data["cases"]:
            assert case["court_code"] == "FCA"

    def test_list_cases_filter_by_year(self, client):
        """Filtering by year returns only matching cases."""
        resp = client.get("/api/v1/cases?year=2024")
        data = resp.get_json()
        assert resp.status_code == 200
        for case in data["cases"]:
            assert case["year"] == 2024

    def test_list_cases_sort_by_title_asc(self, client):
        """Sorting by title ascending orders alphabetically."""
        resp = client.get("/api/v1/cases?sort_by=title&sort_dir=asc")
        data = resp.get_json()
        assert resp.status_code == 200
        titles = [c["title"] for c in data["cases"]]
        assert titles == sorted(titles)

    def test_list_cases_invalid_sort_field(self, client):
        """Invalid sort_by returns 400 error."""
        resp = client.get("/api/v1/cases?sort_by=hacked")
        assert resp.status_code == 400
        data = resp.get_json()
        assert "error" in data

    def test_list_cases_invalid_sort_dir(self, client):
        """Invalid sort_dir returns 400 error."""
        resp = client.get("/api/v1/cases?sort_dir=sideways")
        assert resp.status_code == 400
        data = resp.get_json()
        assert "error" in data

    def test_list_cases_keyword_search(self, client):
        """Keyword filter searches across text fields."""
        resp = client.get("/api/v1/cases?q=Minister")
        data = resp.get_json()
        assert resp.status_code == 200
        # All sample cases have "Minister" in their title
        assert len(data["cases"]) > 0


# ── GET /api/v1/cases/<id> ───────────────────────────────────────────────


class TestGetCase:
    def test_get_case_success(self, client):
        """GET /api/v1/cases/<id> returns the case data."""
        case_id = _first_case_id(client)
        resp = client.get(f"/api/v1/cases/{case_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "case" in data
        assert data["case"]["case_id"] == case_id

    def test_get_case_includes_full_text_key(self, client):
        """Response includes full_text key (may be None)."""
        case_id = _first_case_id(client)
        resp = client.get(f"/api/v1/cases/{case_id}")
        data = resp.get_json()
        assert "full_text" in data

    def test_get_case_not_found(self, client):
        """GET with non-existent hex ID returns 404."""
        resp = client.get("/api/v1/cases/000000000000")
        assert resp.status_code == 404
        data = resp.get_json()
        assert "error" in data

    def test_get_case_invalid_id_format(self, client):
        """GET with non-hex ID returns 400."""
        resp = client.get("/api/v1/cases/not-a-hex-id!")
        assert resp.status_code == 400
        data = resp.get_json()
        assert "error" in data

    def test_get_case_traversal_rejected(self, client):
        """Path traversal in case_id is rejected."""
        resp = client.get("/api/v1/cases/../../../etc")
        # This gets caught by either Flask routing or _valid_case_id
        assert resp.status_code in (400, 404)

    def test_get_case_too_short_id_rejected(self, client):
        """IDs shorter than 12 hex chars are rejected."""
        resp = client.get("/api/v1/cases/abc")
        assert resp.status_code == 400


# ── POST /api/v1/cases ───────────────────────────────────────────────────


class TestCreateCase:
    def test_create_case_with_title(self, client):
        """Creating a case with title returns 201."""
        resp = client.post(
            "/api/v1/cases",
            data=json.dumps({"title": "New Test Case", "court_code": "AATA", "year": 2024}),
            content_type="application/json",
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert "case" in data
        assert data["case"]["title"] == "New Test Case"
        assert data["case"]["case_id"]  # Should have an auto-generated ID

    def test_create_case_with_citation(self, client):
        """Creating a case with citation (no title) returns 201."""
        resp = client.post(
            "/api/v1/cases",
            data=json.dumps({"citation": "[2024] FCA 999"}),
            content_type="application/json",
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["case"]["citation"] == "[2024] FCA 999"

    def test_create_case_missing_required_fields(self, client):
        """Creating a case without title or citation returns 400."""
        resp = client.post(
            "/api/v1/cases",
            data=json.dumps({"court_code": "AATA"}),
            content_type="application/json",
        )
        assert resp.status_code == 400
        data = resp.get_json()
        assert "error" in data

    def test_create_case_empty_body(self, client):
        """Creating a case with empty JSON body returns 400."""
        resp = client.post(
            "/api/v1/cases",
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_create_case_sets_source_manual_entry(self, client):
        """Newly created case gets source='Manual Entry' if not provided."""
        resp = client.post(
            "/api/v1/cases",
            data=json.dumps({"title": "Source Test Case"}),
            content_type="application/json",
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["case"]["source"] == "Manual Entry"


# ── PUT /api/v1/cases/<id> ───────────────────────────────────────────────


class TestUpdateCase:
    def test_update_case_success(self, client):
        """PUT /api/v1/cases/<id> updates fields and returns updated case."""
        case_id = _first_case_id(client)
        resp = client.put(
            f"/api/v1/cases/{case_id}",
            data=json.dumps({"outcome": "Set Aside", "user_notes": "Test update"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["case"]["outcome"] == "Set Aside"
        assert data["case"]["user_notes"] == "Test update"

    def test_update_case_not_found(self, client):
        """PUT with non-existent hex ID returns 404."""
        resp = client.put(
            "/api/v1/cases/000000000000",
            data=json.dumps({"outcome": "Set Aside"}),
            content_type="application/json",
        )
        assert resp.status_code == 404

    def test_update_case_invalid_id(self, client):
        """PUT with invalid ID format returns 400."""
        resp = client.put(
            "/api/v1/cases/INVALID!",
            data=json.dumps({"outcome": "Set Aside"}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_update_case_year_coercion(self, client):
        """PUT coerces year to integer."""
        case_id = _first_case_id(client)
        resp = client.put(
            f"/api/v1/cases/{case_id}",
            data=json.dumps({"year": "2025"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["case"]["year"] == 2025

    def test_update_case_year_invalid_keeps_original(self, client):
        """PUT with non-numeric year keeps the original value."""
        case_id = _first_case_id(client)
        # Get original year
        original = client.get(f"/api/v1/cases/{case_id}").get_json()["case"]["year"]
        resp = client.put(
            f"/api/v1/cases/{case_id}",
            data=json.dumps({"year": "not-a-number"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["case"]["year"] == original


# ── DELETE /api/v1/cases/<id> ────────────────────────────────────────────


class TestDeleteCase:
    def test_delete_case_success(self, client):
        """DELETE /api/v1/cases/<id> removes the case."""
        # Create a case to delete (avoid deleting fixture data)
        create_resp = client.post(
            "/api/v1/cases",
            data=json.dumps({"title": "Case to delete"}),
            content_type="application/json",
        )
        case_id = create_resp.get_json()["case"]["case_id"]

        resp = client.delete(f"/api/v1/cases/{case_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True

        # Verify it's gone
        get_resp = client.get(f"/api/v1/cases/{case_id}")
        assert get_resp.status_code == 404

    def test_delete_case_not_found(self, client):
        """DELETE with non-existent hex ID returns 500 (no row to delete)."""
        resp = client.delete("/api/v1/cases/000000000000")
        # The API returns 500 when repo.delete returns False
        assert resp.status_code == 500

    def test_delete_case_invalid_id(self, client):
        """DELETE with invalid ID format returns 400."""
        resp = client.delete("/api/v1/cases/BAD-ID-HERE!")
        assert resp.status_code == 400


# ── POST /api/v1/cases/batch ─────────────────────────────────────────────


class TestBatchCases:
    def test_batch_delete(self, client):
        """Batch delete removes multiple cases."""
        # Create two cases to delete
        ids = []
        for i in range(2):
            resp = client.post(
                "/api/v1/cases",
                data=json.dumps({"title": f"Batch delete test {i}"}),
                content_type="application/json",
            )
            ids.append(resp.get_json()["case"]["case_id"])

        resp = client.post(
            "/api/v1/cases/batch",
            data=json.dumps({"action": "delete", "case_ids": ids}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["affected"] == 2

    def test_batch_tag(self, client):
        """Batch tag adds a tag to multiple cases."""
        case_id = _first_case_id(client)
        resp = client.post(
            "/api/v1/cases/batch",
            data=json.dumps({"action": "tag", "tag": "reviewed", "case_ids": [case_id]}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["affected"] >= 1

    def test_batch_unknown_action(self, client):
        """Unknown batch action returns 400."""
        case_id = _first_case_id(client)
        resp = client.post(
            "/api/v1/cases/batch",
            data=json.dumps({"action": "explode", "case_ids": [case_id]}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_batch_no_valid_ids(self, client):
        """Batch with no valid IDs returns 400."""
        resp = client.post(
            "/api/v1/cases/batch",
            data=json.dumps({"action": "delete", "case_ids": ["BAD!", "ALSO_BAD!"]}),
            content_type="application/json",
        )
        assert resp.status_code == 400
        data = resp.get_json()
        assert "error" in data

    def test_batch_case_ids_not_list(self, client):
        """Batch with non-list case_ids returns 400."""
        resp = client.post(
            "/api/v1/cases/batch",
            data=json.dumps({"action": "delete", "case_ids": "not-a-list"}),
            content_type="application/json",
        )
        assert resp.status_code == 400

    def test_batch_tag_missing_tag(self, client):
        """Batch tag without tag value returns 400."""
        case_id = _first_case_id(client)
        resp = client.post(
            "/api/v1/cases/batch",
            data=json.dumps({"action": "tag", "case_ids": [case_id]}),
            content_type="application/json",
        )
        assert resp.status_code == 400


# ── Case ID validation ──────────────────────────────────────────────────


class TestCaseIdValidation:
    def test_rejects_path_traversal_dots(self, client):
        """Case ID with '..' is rejected."""
        resp = client.get("/api/v1/cases/..%2F..%2Fetc")
        assert resp.status_code in (400, 404)

    def test_rejects_special_characters(self, client):
        """Case ID with special characters is rejected."""
        resp = client.get("/api/v1/cases/abc<script>x")
        assert resp.status_code == 400

    def test_rejects_uppercase_hex(self, client):
        """Case ID must be lowercase hex (12 chars)."""
        resp = client.get("/api/v1/cases/AABBCCDDEEFF")
        assert resp.status_code == 400

    def test_accepts_valid_hex_id(self, client):
        """Valid 12-char lowercase hex ID passes validation (but may 404 if not found)."""
        resp = client.get("/api/v1/cases/aabbccddeeff")
        # Valid format but doesn't exist — should be 404, not 400
        assert resp.status_code == 404


# ── Compare endpoint ────────────────────────────────────────────────────


class TestCompareCases:
    def test_compare_two_cases(self, client):
        """Compare endpoint returns data for two valid cases."""
        ids = _get_case_ids(client)
        if len(ids) < 2:
            pytest.skip("Need at least 2 cases for compare test")
        resp = client.get(f"/api/v1/cases/compare?ids={ids[0]}&ids={ids[1]}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "cases" in data
        assert len(data["cases"]) == 2

    def test_compare_fewer_than_two_ids(self, client):
        """Compare with fewer than 2 IDs returns 400."""
        case_id = _first_case_id(client)
        resp = client.get(f"/api/v1/cases/compare?ids={case_id}")
        assert resp.status_code == 400

    def test_compare_no_ids(self, client):
        """Compare with no IDs returns 400."""
        resp = client.get("/api/v1/cases/compare")
        assert resp.status_code == 400


# ── Related cases endpoint ──────────────────────────────────────────────


class TestRelatedCases:
    def test_related_cases_returns_list(self, client):
        """Related cases endpoint returns a list."""
        case_id = _first_case_id(client)
        resp = client.get(f"/api/v1/cases/{case_id}/related")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "cases" in data
        assert isinstance(data["cases"], list)

    def test_related_cases_invalid_id(self, client):
        """Related cases with invalid ID returns 400."""
        resp = client.get("/api/v1/cases/INVALID!/related")
        assert resp.status_code == 400
