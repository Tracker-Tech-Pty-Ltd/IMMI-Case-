"""Analytics API tests for success-rate, judge intelligence, and concept intelligence."""

from __future__ import annotations

from dataclasses import replace

import pytest

from immi_case_downloader.models import ImmigrationCase


# ---------------------------------------------------------------------------
# Test data helpers
# ---------------------------------------------------------------------------


def _make_case(
    *,
    citation: str,
    court_code: str,
    year: int,
    outcome: str,
    judge: str,
    visa_subclass: str = "",
    case_nature: str = "Protection Visa",
    legal_concepts: str = "",
) -> ImmigrationCase:
    court_map = {
        "AATA": "Administrative Appeals Tribunal",
        "ARTA": "Administrative Review Tribunal",
        "MRTA": "Migration Review Tribunal",
        "RRTA": "Refugee Review Tribunal",
        "FCA": "Federal Court of Australia",
        "FCCA": "Federal Circuit Court of Australia",
        "FMCA": "Federal Magistrates Court of Australia",
        "FedCFamC2G": "Federal Circuit and Family Court (Div 2)",
        "HCA": "High Court of Australia",
    }

    case = ImmigrationCase(
        citation=citation,
        title=f"{citation} title",
        court=court_map.get(court_code, court_code),
        court_code=court_code,
        date=f"{year}-01-01",
        year=year,
        url=f"https://example.org/{citation.replace(' ', '_')}",
        judges=judge,
        outcome=outcome,
        source="AustLII",
        case_nature=case_nature,
        legal_concepts=legal_concepts,
        visa_subclass=visa_subclass,
    )
    case.ensure_id()
    return case


@pytest.fixture
def analytics_cases() -> list[ImmigrationCase]:
    return [
        _make_case(
            citation="[2020] AATA 100",
            court_code="AATA",
            year=2020,
            outcome="Remitted",
            judge="Member Alpha",
            visa_subclass="866",
            case_nature="Protection",
            legal_concepts="Complementary Protection; Non-refoulement",
        ),
        _make_case(
            citation="[2021] AATA 101",
            court_code="AATA",
            year=2021,
            outcome="Set Aside",
            judge="Member Alpha",
            visa_subclass="866",
            case_nature="Protection",
            legal_concepts="Well-founded Fear; Complementary Protection",
        ),
        _make_case(
            citation="[2021] AATA 102",
            court_code="AATA",
            year=2021,
            outcome="Affirmed",
            judge="Member Alpha",
            visa_subclass="500",
            case_nature="Protection",
            legal_concepts="Well-founded Fear",
        ),
        _make_case(
            citation="[2022] AATA 103",
            court_code="AATA",
            year=2022,
            outcome="Dismissed",
            judge="Member Beta",
            visa_subclass="790",
            case_nature="Cancellation",
            legal_concepts="Procedural Fairness",
        ),
        _make_case(
            citation="[2023] ARTA 110",
            court_code="ARTA",
            year=2023,
            outcome="Remitted",
            judge="Member Alpha",
            visa_subclass="866",
            case_nature="Protection",
            legal_concepts="Complementary Protection; Non-refoulement",
        ),
        _make_case(
            citation="[2020] FCA 200",
            court_code="FCA",
            year=2020,
            outcome="Allowed",
            judge="Justice Gamma",
            visa_subclass="500",
            case_nature="Judicial Review",
            legal_concepts="Jurisdictional Error; Procedural Fairness",
        ),
        _make_case(
            citation="[2021] FCA 201",
            court_code="FCA",
            year=2021,
            outcome="Set Aside",
            judge="Justice Gamma",
            visa_subclass="500",
            case_nature="Judicial Review",
            legal_concepts="Procedural Fairness",
        ),
        _make_case(
            citation="[2022] FCA 202",
            court_code="FCA",
            year=2022,
            outcome="Dismissed",
            judge="Justice Delta",
            visa_subclass="189",
            case_nature="Appeal",
            legal_concepts="Merits Review",
        ),
        _make_case(
            citation="[2024] FCA 203",
            court_code="FCA",
            year=2024,
            outcome="Allowed",
            judge="Justice Delta",
            visa_subclass="866",
            case_nature="Judicial Review",
            legal_concepts="Complementary Protection",
        ),
        _make_case(
            citation="[2023] FedCFamC2G 300",
            court_code="FedCFamC2G",
            year=2023,
            outcome="Allowed",
            judge="Judge Epsilon",
            visa_subclass="500",
            case_nature="Judicial Review",
            legal_concepts="Jurisdictional Error",
        ),
        _make_case(
            citation="[2024] HCA 10",
            court_code="HCA",
            year=2024,
            outcome="Dismissed",
            judge="Chief Justice Zeta",
            visa_subclass="",
            case_nature="Constitutional",
            legal_concepts="Constitutional Law",
        ),
        _make_case(
            citation="[2024] RRTA 40",
            court_code="RRTA",
            year=2024,
            outcome="Remitted",
            judge="Member Beta",
            visa_subclass="866",
            case_nature="Protection",
            legal_concepts="Non-refoulement; Well-founded Fear",
        ),
    ]


@pytest.fixture
def patch_analytics_cases(monkeypatch, analytics_cases):
    # Patch both accessors so tests work regardless of which path each endpoint uses.
    # _get_all_cases: used by analytics_monthly_trends (needs `date` field not in ANALYTICS_COLS)
    # _get_analytics_cases: used by all other analytics endpoints (7-column optimised fetch)
    monkeypatch.setattr(
        "immi_case_downloader.web.routes.api._get_all_cases",
        lambda: analytics_cases,
    )
    monkeypatch.setattr(
        "immi_case_downloader.web.routes.api._get_analytics_cases",
        lambda: analytics_cases,
    )


# ---------------------------------------------------------------------------
# Phase 1: Success Rate Calculator
# ---------------------------------------------------------------------------


def test_analytics_filter_options_returns_contextual_options(
    client, patch_analytics_cases
):
    data = client.get(
        "/api/v1/analytics/filter-options?court=AATA&year_from=2021&year_to=2022"
    ).get_json()

    assert data["query"]["court"] == "AATA"
    assert data["query"]["total_matching"] == 3

    visa_values = {item["value"] for item in data["visa_subclasses"]}
    assert visa_values == {"866", "500", "790"}

    nature_values = {item["value"] for item in data["case_natures"]}
    assert nature_values == {"Protection", "Cancellation"}

    outcome_values = {item["value"] for item in data["outcome_types"]}
    assert outcome_values == {"Set Aside", "Affirmed", "Dismissed"}


def test_analytics_filter_options_enriches_known_visa_labels(
    client, patch_analytics_cases
):
    data = client.get("/api/v1/analytics/filter-options?court=AATA").get_json()

    by_value = {item["value"]: item for item in data["visa_subclasses"]}
    assert by_value["866"]["label"].startswith("866 - ")
    assert by_value["866"]["family"] == "Protection"


def test_success_rate_returns_200(client, patch_analytics_cases):
    resp = client.get("/api/v1/analytics/success-rate")
    assert resp.status_code == 200


def test_success_rate_has_required_fields(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/success-rate").get_json()
    assert "success_rate" in data
    assert "by_concept" in data
    assert "trend" in data


def test_success_rate_tribunal_win_definition(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/success-rate?court=AATA").get_json()
    assert data["success_rate"]["court_type"] == "tribunal"
    assert data["success_rate"]["win_outcomes"] == ["Remitted", "Set Aside", "Granted", "Quashed"]
    assert data["success_rate"]["win_count"] == 2


def test_success_rate_court_win_definition(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/success-rate?court=FCA").get_json()
    assert data["success_rate"]["court_type"] == "court"
    assert data["success_rate"]["win_outcomes"] == ["Allowed", "Set Aside", "Granted", "Quashed"]
    assert data["success_rate"]["win_count"] == 3


def test_success_rate_visa_filter(client, patch_analytics_cases):
    all_data = client.get("/api/v1/analytics/success-rate").get_json()
    filtered = client.get("/api/v1/analytics/success-rate?visa_subclass=866").get_json()

    assert filtered["query"]["total_matching"] < all_data["query"]["total_matching"]
    assert filtered["query"]["visa_subclass"] == "866"


def test_success_rate_concept_filter(client, patch_analytics_cases):
    all_data = client.get("/api/v1/analytics/success-rate").get_json()
    filtered = client.get(
        "/api/v1/analytics/success-rate?legal_concepts=complementary%20protection"
    ).get_json()

    assert filtered["query"]["total_matching"] < all_data["query"]["total_matching"]


def test_success_rate_confidence_levels(client, monkeypatch, analytics_cases):
    # >100 => high
    big = []
    for idx in range(120):
        template = analytics_cases[idx % len(analytics_cases)]
        big_case = replace(
            template,
            citation=f"[2024] BULK {idx}",
            url=f"https://example.org/bulk-{idx}",
        )
        big_case.ensure_id()
        big.append(big_case)

    # analytics_success_rate uses _get_analytics_cases (7-col optimised path)
    monkeypatch.setattr("immi_case_downloader.web.routes.api._get_analytics_cases", lambda: big)
    high = client.get("/api/v1/analytics/success-rate").get_json()
    assert high["success_rate"]["confidence"] == "high"

    # <20 => low
    small = analytics_cases[:10]
    monkeypatch.setattr("immi_case_downloader.web.routes.api._get_analytics_cases", lambda: small)
    low = client.get("/api/v1/analytics/success-rate").get_json()
    assert low["success_rate"]["confidence"] == "low"


def test_success_rate_trend_is_sorted_by_year(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/success-rate").get_json()
    years = [item["year"] for item in data["trend"]]
    assert years == sorted(years)


def test_success_rate_empty_result(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/success-rate?visa_subclass=999").get_json()
    assert data["query"]["total_matching"] == 0
    assert data["success_rate"]["overall"] == 0


# ---------------------------------------------------------------------------
# Phase 2: Judge Intelligence
# ---------------------------------------------------------------------------


def test_judge_leaderboard_returns_list(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/judge-leaderboard").get_json()
    assert isinstance(data["judges"], list)


def test_judge_leaderboard_name_query_matches_name_or_display_name(
    client, patch_analytics_cases
):
    data = client.get("/api/v1/analytics/judge-leaderboard?name_q=alpha").get_json()
    assert data["judges"]
    assert all(
        "alpha" in f"{row['name']} {row.get('display_name', '')}".lower()
        for row in data["judges"]
    )


def test_judge_leaderboard_min_cases_filter(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/judge-leaderboard?min_cases=3").get_json()
    assert data["judges"]
    assert all(row["total_cases"] >= 3 for row in data["judges"])


def test_judge_leaderboard_sorted_by_cases(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/judge-leaderboard?sort_by=cases").get_json()
    totals = [j["total_cases"] for j in data["judges"]]
    assert totals == sorted(totals, reverse=True)


def test_judge_leaderboard_sort_by_approval_rate(client, patch_analytics_cases):
    data = client.get(
        "/api/v1/analytics/judge-leaderboard?sort_by=approval_rate"
    ).get_json()
    rates = [j["approval_rate"] for j in data["judges"]]
    assert rates == sorted(rates, reverse=True)


def test_judge_leaderboard_court_filter(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/judge-leaderboard?court=AATA").get_json()
    assert data["judges"]
    assert all("AATA" in j["courts"] for j in data["judges"])


def test_judge_leaderboard_limit(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/judge-leaderboard?limit=2").get_json()
    assert len(data["judges"]) == 2


def test_judge_profile_known_judge(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/judge-profile?name=Member%20Alpha").get_json()
    assert data["judge"]["name"] == "Member Alpha"
    assert data["judge"]["total_cases"] > 0


def test_judge_profile_unknown_returns_empty(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/judge-profile?name=Unknown").get_json()
    assert data["judge"]["total_cases"] == 0
    assert data["outcome_distribution"] == {}


def test_judge_profile_has_outcome_distribution(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/judge-profile?name=Justice%20Gamma").get_json()
    assert data["outcome_distribution"]


def test_judge_profile_has_concept_effectiveness(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/judge-profile?name=Justice%20Gamma").get_json()
    assert "concept_effectiveness" in data
    assert isinstance(data["concept_effectiveness"], list)


def test_judge_profile_visa_breakdown_sorted(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/judge-profile?name=Member%20Alpha").get_json()
    totals = [item["total"] for item in data["visa_breakdown"]]
    assert totals == sorted(totals, reverse=True)


def test_judge_compare_two_judges(client, patch_analytics_cases):
    data = client.get(
        "/api/v1/analytics/judge-compare?names=Member%20Alpha,Justice%20Gamma"
    ).get_json()
    assert len(data["judges"]) == 2


def test_judge_compare_requires_two_names(client, patch_analytics_cases):
    resp = client.get("/api/v1/analytics/judge-compare?names=Member%20Alpha")
    assert resp.status_code == 400


def test_judge_profile_strict_identity_avoids_cross_court_murphy_mix(client, monkeypatch):
    from immi_case_downloader.web.routes import api as api_routes

    api_routes._judge_identity.cache_clear()
    cases = [
        _make_case(
            citation="[2019] FCA 300",
            court_code="FCA",
            year=2019,
            outcome="Allowed",
            judge="MURPHY J",
            visa_subclass="500",
        ),
        _make_case(
            citation="[2023] AATA 301",
            court_code="AATA",
            year=2023,
            outcome="Remitted",
            judge="Alison Murphy",
            visa_subclass="866",
        ),
        _make_case(
            citation="[2023] AATA 302",
            court_code="AATA",
            year=2023,
            outcome="Set Aside",
            judge="Jade Murphy",
            visa_subclass="866",
        ),
    ]
    # judge-profile uses _get_analytics_cases (7-col optimised path)
    monkeypatch.setattr("immi_case_downloader.web.routes.api._get_analytics_cases", lambda: cases)

    data = client.get(
        "/api/v1/analytics/judge-profile?name=Bernard%20Michael%20Murphy"
    ).get_json()

    assert data["judge"]["canonical_name"] == "Bernard Michael Murphy"
    assert data["judge"]["total_cases"] == 1
    assert data["judge"]["courts"] == ["FCA"]

    api_routes._judge_identity.cache_clear()


# ---------------------------------------------------------------------------
# Judge name normalisation — variant merging
# ---------------------------------------------------------------------------


def test_split_judges_allows_four_char_singleton(client, monkeypatch):
    """4-char surnames (e.g. 'Egan', 'Fary') must NOT be filtered by the singleton threshold."""
    from immi_case_downloader.web.routes import api as api_routes
    from unittest.mock import patch

    api_routes._judge_identity.cache_clear()
    cases = [
        _make_case(citation="[2020] FCCA 1", court_code="FCCA", year=2020, outcome="Dismissed", judge="Egan"),
        _make_case(citation="[2020] FCCA 2", court_code="FCCA", year=2020, outcome="Dismissed", judge="EGAN"),
        _make_case(citation="[2021] FedCFamC2G 1", court_code="FedCFamC2G", year=2021, outcome="Dismissed", judge="Fary"),
    ]
    monkeypatch.setattr("immi_case_downloader.web.routes.api._analytics_cache", {})
    monkeypatch.setattr("immi_case_downloader.web.routes.api._get_analytics_cases", lambda: cases)
    with patch("immi_case_downloader.web.routes.api._load_judge_bios", return_value={}), patch(
        "immi_case_downloader.web.routes.api._load_judge_name_overrides", return_value={}
    ):
        resp = client.get("/api/v1/analytics/judges?limit=10")

    assert resp.status_code == 200
    judges = resp.get_json()["judges"]
    names = [j["name"] for j in judges]
    assert "Egan" in names, f"Expected 'Egan' in judges but got {names}"
    assert "Fary" in names, f"Expected 'Fary' in judges but got {names}"
    egan_entry = next(j for j in judges if j["name"] == "Egan")
    assert egan_entry["count"] == 2
    api_routes._judge_identity.cache_clear()


def test_judge_analytics_merges_suffix_variants_of_same_name(client, monkeypatch):
    """KENDALL, Kendall J, and Justice KENDALL must collapse to one group."""
    from immi_case_downloader.web.routes import api as api_routes
    from unittest.mock import patch

    api_routes._judge_identity.cache_clear()
    cases = [
        _make_case(citation="[2018] AATA 1", court_code="AATA", year=2018, outcome="Affirmed", judge="KENDALL"),
        _make_case(citation="[2018] AATA 2", court_code="AATA", year=2018, outcome="Affirmed", judge="Kendall J"),
        _make_case(citation="[2018] AATA 3", court_code="AATA", year=2018, outcome="Set Aside", judge="Justice KENDALL"),
        _make_case(citation="[2018] AATA 4", court_code="AATA", year=2018, outcome="Set Aside", judge="Kendall"),
    ]
    monkeypatch.setattr("immi_case_downloader.web.routes.api._analytics_cache", {})
    monkeypatch.setattr("immi_case_downloader.web.routes.api._get_analytics_cases", lambda: cases)
    with patch("immi_case_downloader.web.routes.api._load_judge_bios", return_value={}), patch(
        "immi_case_downloader.web.routes.api._load_judge_name_overrides", return_value={}
    ):
        resp = client.get("/api/v1/analytics/judges?limit=10")

    assert resp.status_code == 200
    judges = resp.get_json()["judges"]
    assert len(judges) == 1, f"Expected 1 group, got {len(judges)}: {[j['name'] for j in judges]}"
    assert judges[0]["count"] == 4
    api_routes._judge_identity.cache_clear()


def test_judge_analytics_merges_title_prefix_variants(client, monkeypatch):
    """'Ms Ricky Johnston' and 'Ricky Johnston' must merge to one group."""
    from immi_case_downloader.web.routes import api as api_routes
    from unittest.mock import patch

    api_routes._judge_identity.cache_clear()
    cases = [
        _make_case(citation="[2019] AATA 1", court_code="AATA", year=2019, outcome="Affirmed", judge="Ricky Johnston"),
        _make_case(citation="[2019] AATA 2", court_code="AATA", year=2019, outcome="Affirmed", judge="Ms Ricky Johnston"),
        _make_case(citation="[2019] AATA 3", court_code="AATA", year=2019, outcome="Set Aside", judge="Ricky Johnston"),
    ]
    monkeypatch.setattr("immi_case_downloader.web.routes.api._analytics_cache", {})
    monkeypatch.setattr("immi_case_downloader.web.routes.api._get_analytics_cases", lambda: cases)
    with patch("immi_case_downloader.web.routes.api._load_judge_bios", return_value={}), patch(
        "immi_case_downloader.web.routes.api._load_judge_name_overrides", return_value={}
    ):
        resp = client.get("/api/v1/analytics/judges?limit=10")

    assert resp.status_code == 200
    judges = resp.get_json()["judges"]
    assert len(judges) == 1, f"Expected 1 group, got {len(judges)}: {[j['name'] for j in judges]}"
    assert judges[0]["count"] == 3
    assert judges[0]["name"] == "Ricky Johnston"
    api_routes._judge_identity.cache_clear()


def test_judge_analytics_merges_mixed_case_variants(client, monkeypatch):
    """'Richard Derewlany' and 'Richard DEREWLANY' must merge to one group."""
    from immi_case_downloader.web.routes import api as api_routes
    from unittest.mock import patch

    api_routes._judge_identity.cache_clear()
    cases = [
        _make_case(citation="[2020] AATA 1", court_code="AATA", year=2020, outcome="Affirmed", judge="Richard Derewlany"),
        _make_case(citation="[2020] AATA 2", court_code="AATA", year=2020, outcome="Affirmed", judge="Richard DEREWLANY"),
        _make_case(citation="[2020] AATA 3", court_code="AATA", year=2020, outcome="Set Aside", judge="Mr Richard Derewlany"),
    ]
    monkeypatch.setattr("immi_case_downloader.web.routes.api._analytics_cache", {})
    monkeypatch.setattr("immi_case_downloader.web.routes.api._get_analytics_cases", lambda: cases)
    with patch("immi_case_downloader.web.routes.api._load_judge_bios", return_value={}), patch(
        "immi_case_downloader.web.routes.api._load_judge_name_overrides", return_value={}
    ):
        resp = client.get("/api/v1/analytics/judges?limit=10")

    assert resp.status_code == 200
    judges = resp.get_json()["judges"]
    assert len(judges) == 1, f"Expected 1 group, got {len(judges)}: {[j['name'] for j in judges]}"
    assert judges[0]["count"] == 3
    assert judges[0]["name"] == "Richard Derewlany"
    api_routes._judge_identity.cache_clear()


# ---------------------------------------------------------------------------
# Phase 3: Concept Intelligence
# ---------------------------------------------------------------------------


def test_concept_effectiveness_returns_concepts(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/concept-effectiveness").get_json()
    assert "concepts" in data
    assert data["concepts"]


def test_concept_effectiveness_has_lift(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/concept-effectiveness").get_json()
    assert "lift" in data["concepts"][0]


def test_concept_effectiveness_court_breakdown(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/concept-effectiveness").get_json()
    assert "by_court" in data["concepts"][0]


def test_concept_effectiveness_limit(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/concept-effectiveness?limit=3").get_json()
    assert len(data["concepts"]) <= 3


def test_concept_cooccurrence_returns_matrix(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/concept-cooccurrence?min_count=1").get_json()
    assert "concepts" in data
    assert "matrix" in data


def test_concept_cooccurrence_top_pairs_sorted(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/concept-cooccurrence?min_count=1").get_json()
    counts = [pair["count"] for pair in data["top_pairs"]]
    assert counts == sorted(counts, reverse=True)


def test_concept_cooccurrence_min_count_filter(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/concept-cooccurrence?min_count=999").get_json()
    assert data["top_pairs"] == []


def test_concept_trends_returns_series(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/concept-trends").get_json()
    assert "series" in data


def test_concept_trends_emerging_declining(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/concept-trends").get_json()
    assert "emerging" in data
    assert "declining" in data


# ---------------------------------------------------------------------------
# Phase 5: Flow Matrix (Sankey)
# ---------------------------------------------------------------------------


def test_flow_matrix_returns_200(client, patch_analytics_cases):
    resp = client.get("/api/v1/analytics/flow-matrix")
    assert resp.status_code == 200


def test_flow_matrix_has_nodes_and_links(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/flow-matrix").get_json()
    assert "nodes" in data
    assert "links" in data
    assert len(data["nodes"]) > 0
    assert len(data["links"]) > 0


def test_flow_matrix_nodes_have_required_fields(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/flow-matrix").get_json()
    for node in data["nodes"]:
        assert "name" in node


def test_flow_matrix_links_have_required_fields(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/flow-matrix").get_json()
    for link in data["links"]:
        assert "source" in link
        assert "target" in link
        assert "value" in link
        assert link["value"] > 0


def test_flow_matrix_court_filter(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/flow-matrix?court=AATA").get_json()
    # All court-layer nodes should be AATA only
    court_nodes = [n for n in data["nodes"] if n.get("layer") == "court"]
    for node in court_nodes:
        assert node["name"] == "AATA"


# ---------------------------------------------------------------------------
# Phase 6: Monthly Trends
# ---------------------------------------------------------------------------


def test_monthly_trends_returns_200(client, patch_analytics_cases):
    resp = client.get("/api/v1/analytics/monthly-trends")
    assert resp.status_code == 200


def test_monthly_trends_has_series(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/monthly-trends").get_json()
    assert "series" in data
    assert isinstance(data["series"], list)


def test_monthly_trends_entry_fields(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/monthly-trends").get_json()
    if data["series"]:
        entry = data["series"][0]
        assert "month" in entry
        assert "total" in entry
        assert "win_rate" in entry


def test_monthly_trends_sorted_by_month(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/monthly-trends").get_json()
    months = [e["month"] for e in data["series"]]
    assert months == sorted(months)


def test_monthly_trends_has_events(client, patch_analytics_cases):
    data = client.get("/api/v1/analytics/monthly-trends").get_json()
    assert "events" in data
    assert isinstance(data["events"], list)


# ---------------------------------------------------------------------------
# Phase 7: Alias specificity ordering
# ---------------------------------------------------------------------------


def test_alias_specificity_initial_surname_beats_singleton(client, monkeypatch):
    """'L. Symons' must resolve to Linda Symons (initial+surname alias)
    not Catherine Symons (singleton 'symons'), when both exist in overrides."""
    from immi_case_downloader.web.routes import api as api_routes
    from unittest.mock import patch

    api_routes._judge_identity.cache_clear()
    # Two distinct judges: L Symons (AATA, Linda) and SYMONS (FedCFamC2G, Catherine).
    cases = [
        _make_case(citation="[2020] AATA 1", court_code="AATA", year=2020, outcome="Affirmed", judge="L. Symons"),
        _make_case(citation="[2021] FedCFamC2G 1", court_code="FedCFamC2G", year=2021, outcome="Affirmed", judge="SYMONS"),
    ]
    monkeypatch.setattr("immi_case_downloader.web.routes.api._analytics_cache", {})
    monkeypatch.setattr("immi_case_downloader.web.routes.api._get_analytics_cases", lambda: cases)
    overrides = {
        "l symons": "Linda Symons",
        "symons": "Judge Catherine Symons",
    }
    with patch("immi_case_downloader.web.routes.api._load_judge_bios", return_value={}), patch(
        "immi_case_downloader.web.routes.api._load_judge_name_overrides", return_value=overrides
    ):
        resp = client.get("/api/v1/analytics/judges?limit=10")

    assert resp.status_code == 200
    judges = resp.get_json()["judges"]
    names = {j["name"] for j in judges}
    assert "Linda Symons" in names, f"Expected 'Linda Symons' in {names}"
    assert "Judge Catherine Symons" in names, f"Expected 'Judge Catherine Symons' in {names}"
    # They must NOT be merged into one group
    assert len(judges) == 2, f"Expected 2 groups (different judges), got {len(judges)}: {names}"
    api_routes._judge_identity.cache_clear()
