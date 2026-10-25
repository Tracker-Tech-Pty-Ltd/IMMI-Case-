"""Regression tests for taxonomy countries and judge autocomplete payload shape."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.web.routes import api as api_routes


@pytest.fixture
def api_client(tmp_path):
    from immi_case_downloader.web import close_app, create_app

    app = create_app(output_dir=str(tmp_path), backend="csv")
    app.config["TESTING"] = True
    yield app.test_client()
    close_app(app, wait=True)


@pytest.fixture
def mock_cases() -> list[ImmigrationCase]:
    return [
        ImmigrationCase(
            citation="Case1 [2020] AATA 1",
            url="http://example.com/1",
            title="Case 1",
            court_code="AATA",
            year=2020,
            country_of_origin="China",
            judges="Smith",
        ),
        ImmigrationCase(
            citation="Case2 [2020] AATA 2",
            url="http://example.com/2",
            title="Case 2",
            court_code="AATA",
            year=2020,
            country_of_origin="India",
            judges="Smith",
        ),
        ImmigrationCase(
            citation="Case3 [2020] AATA 3",
            url="http://example.com/3",
            title="Case 3",
            court_code="AATA",
            year=2020,
            country_of_origin="China",
            judges="Jones",
        ),
    ]


def test_taxonomy_countries_shape_and_limit(api_client, mock_cases):
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=mock_cases):
        resp = api_client.get("/api/v1/taxonomy/countries?limit=1")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    assert payload["meta"]["total_countries"] == 2
    assert payload["meta"]["returned_results"] == 1
    assert payload["meta"]["limit"] == 1
    assert len(payload["countries"]) == 1

    first = payload["countries"][0]
    assert first["country"] == "China"
    assert first["name"] == "China"
    assert first["case_count"] == 2


def test_taxonomy_countries_invalid_limit(api_client):
    resp = api_client.get("/api/v1/taxonomy/countries?limit=0")
    assert resp.status_code == 400
    payload = resp.get_json()
    assert payload["success"] is False
    assert "limit must be >= 1" in payload["error"]


def test_taxonomy_judges_autocomplete_includes_legacy_and_new_keys(api_client, mock_cases):
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=mock_cases), patch(
        "immi_case_downloader.web.judge_names._load_judge_bios", return_value={}
    ), patch(
        "immi_case_downloader.web.judge_names._load_judge_name_overrides",
        return_value={},
    ):
        resp = api_client.get("/api/v1/taxonomy/judges/autocomplete?q=sm&limit=5")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    assert "judges" in payload
    assert "data" in payload
    assert payload["judges"] == payload["data"]
    assert payload["meta"]["query"] == "sm"
    assert payload["meta"]["limit"] == 5
    assert payload["meta"]["total_results"] == 1
    assert payload["judges"][0]["name"] == "Smith"
    assert payload["judges"][0]["canonical_name"] == "Smith"
    assert payload["judges"][0]["case_count"] == 2


def test_taxonomy_judges_autocomplete_merges_aliases_with_overrides(api_client):
    api_routes._judge_identity.cache_clear()

    cases = [
        ImmigrationCase(
            citation="CaseA [2020] AATA 1",
            url="http://example.com/a",
            title="Case A",
            court_code="AATA",
            year=2020,
            judges="Street",
        ),
        ImmigrationCase(
            citation="CaseB [2021] AATA 2",
            url="http://example.com/b",
            title="Case B",
            court_code="AATA",
            year=2021,
            judges="Judge Alexander 'Sandy' Whistler Street SC",
        ),
    ]

    overrides = {"street": "Judge Alexander 'Sandy' Whistler Street SC"}
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=cases), patch(
        "immi_case_downloader.web.judge_names._load_judge_bios", return_value={}
    ), patch(
        "immi_case_downloader.web.judge_names._load_judge_name_overrides",
        return_value=overrides,
    ):
        resp = api_client.get("/api/v1/taxonomy/judges/autocomplete?q=street&limit=10")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    assert payload["judges"]
    top = payload["judges"][0]
    assert top["name"] == "Judge Alexander 'Sandy' Whistler Street SC"
    assert top["canonical_name"] == "Judge Alexander 'Sandy' Whistler Street SC"
    assert top["case_count"] == 2

    api_routes._judge_identity.cache_clear()


def test_taxonomy_judges_autocomplete_maps_official_singleton_surname(api_client):
    api_routes._judge_identity.cache_clear()

    cases = [
        ImmigrationCase(
            citation="CaseA [2020] FCCA 1",
            url="http://example.com/a",
            title="Case A",
            court_code="FCCA",
            year=2020,
            judges="Vasta",
        ),
        ImmigrationCase(
            citation="CaseB [2021] FedCFamC2G 2",
            url="http://example.com/b",
            title="Case B",
            court_code="FedCFamC2G",
            year=2021,
            judges="Judge Salvatore Vasta",
        ),
    ]

    overrides = {"vasta": "Judge Salvatore Vasta"}
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=cases), patch(
        "immi_case_downloader.web.judge_names._load_judge_bios", return_value={}
    ), patch(
        "immi_case_downloader.web.judge_names._load_judge_name_overrides",
        return_value=overrides,
    ):
        resp = api_client.get("/api/v1/taxonomy/judges/autocomplete?q=vasta&limit=10")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    assert payload["judges"]
    top = payload["judges"][0]
    assert top["name"] == "Judge Salvatore Vasta"
    assert top["canonical_name"] == "Judge Salvatore Vasta"
    assert top["case_count"] == 2

    api_routes._judge_identity.cache_clear()


def test_taxonomy_judges_autocomplete_ranks_exact_match_above_substring(api_client):
    api_routes._judge_identity.cache_clear()

    cases = [
        ImmigrationCase(
            citation=f"CaseA [{2000+i}] AATA {i}",
            url=f"http://example.com/a{i}",
            title=f"Case A{i}",
            court_code="AATA",
            year=2000 + i,
            judges="Dodds-Streeton",
        )
        for i in range(5)
    ] + [
        ImmigrationCase(
            citation="CaseB [2021] AATA 99",
            url="http://example.com/b",
            title="Case B",
            court_code="AATA",
            year=2021,
            judges="Street",
        )
    ]

    overrides = {
        "street": "Judge Alexander 'Sandy' Whistler Street SC",
        "dodds-streeton": "Julie Anne Dodds-Streeton KC",
    }
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=cases), patch(
        "immi_case_downloader.web.judge_names._load_judge_bios", return_value={}
    ), patch(
        "immi_case_downloader.web.judge_names._load_judge_name_overrides",
        return_value=overrides,
    ):
        resp = api_client.get("/api/v1/taxonomy/judges/autocomplete?q=street&limit=10")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["success"] is True
    assert payload["judges"]
    assert payload["judges"][0]["canonical_name"] == "Judge Alexander 'Sandy' Whistler Street SC"
    assert payload["judges"][1]["canonical_name"] == "Julie Anne Dodds-Streeton KC"

    api_routes._judge_identity.cache_clear()


def test_judge_leaderboard_merges_aliases_with_overrides(api_client):
    api_routes._judge_identity.cache_clear()

    cases = [
        ImmigrationCase(
            citation="CaseA [2020] AATA 1",
            url="http://example.com/a",
            title="Case A",
            court_code="AATA",
            year=2020,
            outcome="Remitted",
            judges="Street",
            visa_subclass="866",
        ),
        ImmigrationCase(
            citation="CaseB [2021] AATA 2",
            url="http://example.com/b",
            title="Case B",
            court_code="AATA",
            year=2021,
            outcome="Set Aside",
            judges="Judge Alexander 'Sandy' Whistler Street SC",
            visa_subclass="866",
        ),
    ]

    overrides = {"street": "Judge Alexander 'Sandy' Whistler Street SC"}
    # judge-leaderboard uses _get_analytics_cases (7-col optimised path)
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=cases), patch(
        "immi_case_downloader.web.routes.api._get_analytics_cases", return_value=cases
    ), patch(
        "immi_case_downloader.web.judge_names._load_judge_bios", return_value={}
    ), patch(
        "immi_case_downloader.web.judge_names._load_judge_name_overrides",
        return_value=overrides,
    ):
        resp = api_client.get("/api/v1/analytics/judge-leaderboard?min_cases=1")

    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["judges"]
    row = payload["judges"][0]
    assert row["name"] == "Judge Alexander 'Sandy' Whistler Street SC"
    assert row["display_name"] == "Judge Alexander 'Sandy' Whistler Street SC"
    assert row["total_cases"] == 2

    api_routes._judge_identity.cache_clear()


def test_taxonomy_judges_autocomplete_disambiguates_downes_by_court_year(api_client):
    api_routes._judge_identity.cache_clear()

    cases = [
        ImmigrationCase(
            citation="CaseA [2023] FCA 10",
            url="http://example.com/a",
            title="Case A",
            court_code="FCA",
            year=2023,
            judges="Downes",
        ),
        ImmigrationCase(
            citation="CaseB [2007] FCA 11",
            url="http://example.com/b",
            title="Case B",
            court_code="FCA",
            year=2007,
            judges="DOWNES J",
        ),
        ImmigrationCase(
            citation="CaseC [2025] ARTA 12",
            url="http://example.com/c",
            title="Case C",
            court_code="ARTA",
            year=2025,
            judges="Downes",
        ),
    ]

    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=cases), patch(
        "immi_case_downloader.web.judge_names._load_judge_bios", return_value={}
    ), patch(
        "immi_case_downloader.web.judge_names._load_judge_name_overrides",
        return_value={},
    ):
        resp = api_client.get("/api/v1/taxonomy/judges/autocomplete?q=downes&limit=10")

    assert resp.status_code == 200
    payload = resp.get_json()
    names = {row["canonical_name"] for row in payload["judges"]}
    assert "Kylie Elizabeth Downes" in names
    assert "Garry Keith Downes AM KC" in names
    assert "Tegen Downes" in names

    api_routes._judge_identity.cache_clear()


def test_taxonomy_judges_autocomplete_disambiguates_graham_by_court_year(api_client):
    api_routes._judge_identity.cache_clear()

    cases = [
        ImmigrationCase(
            citation="CaseA [2006] FCA 20",
            url="http://example.com/a",
            title="Case A",
            court_code="FCA",
            year=2006,
            judges="GRAHAM J",
        ),
        ImmigrationCase(
            citation="CaseB [2000] MRTA 21",
            url="http://example.com/b",
            title="Case B",
            court_code="MRTA",
            year=2000,
            judges="Graham",
        ),
        ImmigrationCase(
            citation="CaseC [2003] MRTA 22",
            url="http://example.com/c",
            title="Case C",
            court_code="MRTA",
            year=2003,
            judges="Ann Graham",
        ),
    ]

    overrides = {"ann graham": "Ann Graham"}
    with patch("immi_case_downloader.web.routes.api._get_all_cases", return_value=cases), patch(
        "immi_case_downloader.web.judge_names._load_judge_bios", return_value={}
    ), patch(
        "immi_case_downloader.web.judge_names._load_judge_name_overrides",
        return_value=overrides,
    ):
        resp = api_client.get("/api/v1/taxonomy/judges/autocomplete?q=graham&limit=10")

    assert resp.status_code == 200
    payload = resp.get_json()
    names = {row["canonical_name"] for row in payload["judges"]}
    assert "Peter Ross Graham KC" in names
    assert "Graham Friedman" in names
    assert "Ann Graham" in names

    api_routes._judge_identity.cache_clear()
