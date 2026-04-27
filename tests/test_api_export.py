"""Unit tests for Export API endpoints.

Covers:
- GET /api/v1/export/csv
- GET /api/v1/export/json
Including filter params, response structure, attachment headers, and row caps.
"""

from __future__ import annotations

import csv
import io
import json

# ── CSV Export ────────────────────────────────────────────────────────────────


class TestExportCSV:
    def test_returns_200(self, client):
        resp = client.get("/api/v1/export/csv")
        assert resp.status_code == 200

    def test_content_type_is_csv(self, client):
        resp = client.get("/api/v1/export/csv")
        assert "text/csv" in resp.content_type

    def test_attachment_disposition(self, client):
        resp = client.get("/api/v1/export/csv")
        disposition = resp.headers.get("Content-Disposition", "")
        assert "attachment" in disposition
        assert ".csv" in disposition

    def test_has_bom_for_excel(self, client):
        resp = client.get("/api/v1/export/csv")
        assert resp.data.startswith(b"\xef\xbb\xbf"), "utf-8-sig BOM missing"

    def test_header_row_present(self, client):
        resp = client.get("/api/v1/export/csv")
        content = resp.data.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(content))
        assert reader.fieldnames is not None
        assert "case_id" in reader.fieldnames
        assert "citation" in reader.fieldnames
        assert "court_code" in reader.fieldnames

    def test_contains_fixture_cases(self, client):
        resp = client.get("/api/v1/export/csv")
        content = resp.data.decode("utf-8-sig")
        # conftest populates 5 cases across AATA, FCA, FCCA, FedCFamC2G, HCA
        assert "AATA" in content or "FCA" in content

    def test_each_row_is_a_dict(self, client):
        resp = client.get("/api/v1/export/csv")
        content = resp.data.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(content))
        rows = list(reader)
        assert len(rows) > 0
        assert all(isinstance(r, dict) for r in rows)

    def test_court_filter_applied(self, client):
        resp = client.get("/api/v1/export/csv?court=AATA")
        assert resp.status_code == 200
        content = resp.data.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(content))
        rows = list(reader)
        for row in rows:
            assert row["court_code"] == "AATA"

    def test_unknown_court_returns_empty_csv(self, client):
        resp = client.get("/api/v1/export/csv?court=ZZZZZ")
        assert resp.status_code == 200
        content = resp.data.decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(content))
        rows = list(reader)
        assert rows == []

    def test_rate_limit_allows_first_request(self, client):
        # First request should succeed; rate limit is 5/hour
        resp = client.get("/api/v1/export/csv")
        assert resp.status_code == 200


# ── JSON Export ───────────────────────────────────────────────────────────────


class TestExportJSON:
    def test_returns_200(self, client):
        resp = client.get("/api/v1/export/json")
        assert resp.status_code == 200

    def test_attachment_disposition(self, client):
        resp = client.get("/api/v1/export/json")
        disposition = resp.headers.get("Content-Disposition", "")
        assert "attachment" in disposition
        assert ".json" in disposition

    def test_top_level_structure(self, client):
        resp = client.get("/api/v1/export/json")
        data = json.loads(resp.data)
        assert "cases" in data
        assert "total_cases" in data
        assert "exported_at" in data

    def test_total_cases_matches_list_length(self, client):
        resp = client.get("/api/v1/export/json")
        data = json.loads(resp.data)
        assert data["total_cases"] == len(data["cases"])

    def test_cases_are_dicts_with_case_id(self, client):
        resp = client.get("/api/v1/export/json")
        data = json.loads(resp.data)
        assert len(data["cases"]) > 0
        for case in data["cases"]:
            assert isinstance(case, dict)
            assert "case_id" in case

    def test_exported_at_is_iso_string(self, client):
        resp = client.get("/api/v1/export/json")
        data = json.loads(resp.data)
        from datetime import datetime
        # Should not raise
        datetime.fromisoformat(data["exported_at"])

    def test_court_filter_applied(self, client):
        resp = client.get("/api/v1/export/json?court=FCA")
        data = json.loads(resp.data)
        for case in data["cases"]:
            assert case["court_code"] == "FCA"

    def test_unknown_court_returns_empty_list(self, client):
        resp = client.get("/api/v1/export/json?court=ZZZZZ")
        data = json.loads(resp.data)
        assert data["cases"] == []
        assert data["total_cases"] == 0

    def test_utf8_encoding(self, client):
        resp = client.get("/api/v1/export/json")
        # Should parse without encoding errors
        data = json.loads(resp.data.decode("utf-8"))
        assert isinstance(data, dict)

    def test_rate_limit_allows_first_request(self, client):
        resp = client.get("/api/v1/export/json")
        assert resp.status_code == 200
