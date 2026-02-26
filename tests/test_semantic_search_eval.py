"""Tests for semantic_search_eval utility functions."""

from __future__ import annotations

import pytest

from immi_case_downloader.semantic_search_eval import (
    EvalCase,
    EvalQuery,
    concept_to_synonym,
    estimate_embedding_costs,
    estimate_tokens,
    evaluate_rankings,
    reciprocal_rank_fusion,
    split_concepts,
)


def _make_case(case_id: str, full_text_path: str = "") -> EvalCase:
    return EvalCase(
        case_id=case_id,
        title=f"Title {case_id}",
        citation=f"[2025] {case_id}",
        catchwords="procedural fairness, migration law",
        outcome="Allowed",
        text_snippet="Short snippet",
        legal_concepts="Procedural Fairness; Judicial Review",
        case_nature="Judicial review",
        visa_type="Protection",
        legislation="Migration Act 1958",
        full_text_path=full_text_path,
    )


def test_split_concepts_handles_multiple_delimiters_and_dedup():
    raw = "Procedural Fairness; Judicial Review, Procedural Fairness | Costs"
    assert split_concepts(raw) == [
        "Procedural Fairness",
        "Judicial Review",
        "Costs",
    ]


def test_concept_to_synonym_prefers_registry_keyword():
    synonym = concept_to_synonym("Procedural Fairness")
    assert synonym
    assert synonym.lower() != "procedural fairness"


def test_reciprocal_rank_fusion_prioritizes_docs_appearing_in_both_lists():
    ranked_a = ["d1", "d2", "d3"]
    ranked_b = ["d3", "d1", "d4"]
    fused = reciprocal_rank_fusion(
        ranked_lists=[ranked_a, ranked_b],
        k=60,
        weights=[0.5, 0.5],
        limit=4,
    )
    assert fused[0] in {"d1", "d3"}
    assert "d1" in fused[:2]
    assert "d3" in fused[:2]


def test_evaluate_rankings_computes_expected_core_metrics():
    queries = [
        EvalQuery(
            case_id="q1",
            text="query1",
            relevant_case_ids=frozenset({"d1", "d2"}),
            primary_concept="Procedural Fairness",
        ),
        EvalQuery(
            case_id="q2",
            text="query2",
            relevant_case_ids=frozenset({"d4"}),
            primary_concept="Judicial Review",
        ),
    ]
    rankings = {
        "q1": ["d3", "d1", "d2"],
        "q2": ["d4", "d5", "d6"],
    }

    metrics = evaluate_rankings(queries=queries, rankings=rankings, k_values=[1, 3])
    assert metrics["query_count"] == 2.0
    assert pytest.approx(metrics["recall@1"], rel=1e-6) == 0.5
    assert pytest.approx(metrics["mrr@3"], rel=1e-6) == 0.75
    assert 0.0 <= metrics["ndcg@3"] <= 1.0


def test_estimate_embedding_costs_uses_summary_query_and_full_text_tokens(tmp_path):
    ft1 = tmp_path / "case1.txt"
    ft2 = tmp_path / "case2.txt"
    ft1.write_text("This is full text one", encoding="utf-8")
    ft2.write_text("This is another full text two", encoding="utf-8")

    cases = [
        _make_case("c1", str(ft1)),
        _make_case("c2", str(ft2)),
    ]
    queries = [
        EvalQuery(
            case_id="c1",
            text="find procedural fairness cases",
            relevant_case_ids=frozenset({"c2"}),
            primary_concept="Procedural Fairness",
        )
    ]

    price = 0.02
    costs = estimate_embedding_costs(
        cases=cases,
        queries=queries,
        total_case_count=100,
        price_per_1m_tokens=price,
    )

    expected_summary_tokens = sum(estimate_tokens(case.summary_text()) for case in cases)
    expected_query_tokens = sum(estimate_tokens(q.text) for q in queries)
    expected_full_tokens = estimate_tokens(ft1.read_text()) + estimate_tokens(ft2.read_text())

    assert costs.sample_summary_tokens == expected_summary_tokens
    assert costs.sample_query_tokens == expected_query_tokens
    assert costs.sample_full_text_tokens == expected_full_tokens
    assert costs.sample_total_cost_usd == pytest.approx(
        ((expected_summary_tokens + expected_query_tokens) / 1_000_000) * price,
        rel=1e-9,
    )

