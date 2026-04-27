"""Unit tests for court-lineage and visa-registry taxonomy endpoints.

Covers the LOCAL (CSV/SQLite) path of api_taxonomy.py:
- GET /api/v1/court-lineage
- GET /api/v1/visa-registry
- GET /api/v1/taxonomy/visa-lookup
"""

from __future__ import annotations


# ── Court Lineage ─────────────────────────────────────────────────────────────


class TestCourtLineage:
    def test_returns_200(self, client):
        resp = client.get("/api/v1/court-lineage")
        assert resp.status_code == 200

    def test_response_is_json(self, client):
        resp = client.get("/api/v1/court-lineage")
        data = resp.get_json()
        assert data is not None

    def test_has_lineages_key(self, client):
        resp = client.get("/api/v1/court-lineage")
        data = resp.get_json()
        assert "lineages" in data

    def test_lineages_is_list(self, client):
        resp = client.get("/api/v1/court-lineage")
        data = resp.get_json()
        assert isinstance(data["lineages"], list)
        assert len(data["lineages"]) > 0

    def test_lineage_has_required_keys(self, client):
        resp = client.get("/api/v1/court-lineage")
        data = resp.get_json()
        for lineage in data["lineages"]:
            assert "id" in lineage
            assert "name" in lineage
            assert "courts" in lineage

    def test_each_court_has_code_and_years(self, client):
        resp = client.get("/api/v1/court-lineage")
        data = resp.get_json()
        for lineage in data["lineages"]:
            for court in lineage["courts"]:
                assert "code" in court
                assert "years" in court
                assert len(court["years"]) == 2

    def test_known_court_codes_present(self, client):
        resp = client.get("/api/v1/court-lineage")
        data = resp.get_json()
        all_codes = {
            court["code"]
            for lineage in data["lineages"]
            for court in lineage["courts"]
        }
        # Lower court lineage
        assert "FMCA" in all_codes
        assert "FCCA" in all_codes
        assert "FedCFamC2G" in all_codes

    def test_tribunal_lineage_present(self, client):
        resp = client.get("/api/v1/court-lineage")
        data = resp.get_json()
        all_codes = {
            court["code"]
            for lineage in data["lineages"]
            for court in lineage["courts"]
        }
        assert "AATA" in all_codes or "ARTA" in all_codes

    def test_has_total_cases(self, client):
        resp = client.get("/api/v1/court-lineage")
        data = resp.get_json()
        assert "total_cases" in data
        assert isinstance(data["total_cases"], int)

    def test_case_count_by_year_is_dict(self, client):
        resp = client.get("/api/v1/court-lineage")
        data = resp.get_json()
        for lineage in data["lineages"]:
            for court in lineage["courts"]:
                assert isinstance(court.get("case_count_by_year", {}), dict)

    def test_caches_second_request(self, client):
        # Two requests should both succeed (cache TTL doesn't matter for CSV path)
        resp1 = client.get("/api/v1/court-lineage")
        resp2 = client.get("/api/v1/court-lineage")
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp1.get_json() == resp2.get_json()


# ── Visa Registry ─────────────────────────────────────────────────────────────


class TestVisaRegistry:
    def test_returns_200(self, client):
        resp = client.get("/api/v1/visa-registry")
        assert resp.status_code == 200

    def test_response_is_json(self, client):
        resp = client.get("/api/v1/visa-registry")
        data = resp.get_json()
        assert data is not None

    def test_has_visa_families(self, client):
        resp = client.get("/api/v1/visa-registry")
        data = resp.get_json()
        assert "visa_families" in data or "families" in data or "registry" in data

    def test_families_is_non_empty(self, client):
        resp = client.get("/api/v1/visa-registry")
        data = resp.get_json()
        # At least one top-level list/dict key should have data
        assert any(isinstance(v, (list, dict)) and len(v) > 0 for v in data.values())

    def test_known_visa_family_present(self, client):
        resp = client.get("/api/v1/visa-registry")
        data = resp.get_json()
        content = str(data).lower()
        # The registry includes Protection and Skilled categories
        assert "protection" in content or "skilled" in content


# ── Visa Lookup ───────────────────────────────────────────────────────────────


class TestVisaLookup:
    def test_valid_subclass_returns_200(self, client):
        resp = client.get("/api/v1/taxonomy/visa-lookup?q=866")
        assert resp.status_code == 200

    def test_valid_subclass_has_data(self, client):
        resp = client.get("/api/v1/taxonomy/visa-lookup?q=866")
        data = resp.get_json()
        assert "data" in data
        assert "meta" in data
        assert data["meta"]["total_results"] >= 1
        assert data["data"][0]["subclass"] == "866"

    def test_missing_q_returns_error(self, client):
        resp = client.get("/api/v1/taxonomy/visa-lookup")
        assert resp.status_code in (400, 422)

    def test_unknown_subclass_returns_response(self, client):
        resp = client.get("/api/v1/taxonomy/visa-lookup?q=9999")
        assert resp.status_code in (200, 404)
