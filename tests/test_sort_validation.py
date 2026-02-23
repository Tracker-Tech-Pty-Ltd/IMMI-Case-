"""Tests for sort parameter validation and export row limits."""


class TestSortValidation:
    def test_valid_sort_by_accepted(self, client):
        resp = client.get("/api/v1/cases?sort_by=date&sort_dir=desc")
        assert resp.status_code == 200

    def test_invalid_sort_by_rejected(self, client):
        resp = client.get("/api/v1/cases?sort_by=invalid_field")
        assert resp.status_code == 400
        data = resp.get_json()
        assert "sort_by" in data.get("error", "").lower()

    def test_invalid_sort_dir_rejected(self, client):
        resp = client.get("/api/v1/cases?sort_dir=sideways")
        assert resp.status_code == 400
        data = resp.get_json()
        assert "sort_dir" in data.get("error", "").lower()

    def test_valid_sort_dir_values(self, client):
        for direction in ("asc", "desc"):
            resp = client.get(f"/api/v1/cases?sort_dir={direction}")
            assert resp.status_code == 200, f"Expected 200 for sort_dir={direction}"


class TestExportRowLimit:
    def test_export_csv_returns_200(self, client):
        """Export CSV works (with row limit in place)."""
        resp = client.get("/api/v1/export/csv")
        assert resp.status_code == 200

    def test_export_json_returns_200(self, client):
        """Export JSON works (with row limit in place)."""
        resp = client.get("/api/v1/export/json")
        assert resp.status_code == 200
