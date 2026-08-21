from __future__ import annotations

from scripts.check_cloudflare_search_benchmark import BenchmarkError, inspect


def benchmark(score_drop: bool = False) -> dict:
    query_ids = [f"q-{index:02d}" for index in range(50)]
    queries = [
        {
            "id": query_id,
            "query": f"manual immigration relevance query {index}",
            "relevant_case_ids": [f"{index:012x}"[-12:]],
            "facets": {
                "court": ["FCA", "AAT"][index % 2],
                "year": 2023 + index % 3,
                "outcome": ["allowed", "refused"][index % 2],
                "visa_type": ["Protection", "Family"][index % 2],
                "keyword": ["fairness", "natural justice"][index % 2],
                "scenario": "related-case" if index % 2 else "lexical",
            },
        }
        for index, query_id in enumerate(query_ids)
    ]
    rankings = {query_id: [f"{index:012x}"[-12:]] for index, query_id in enumerate(query_ids)}
    candidate = {key: list(value) for key, value in rankings.items()}
    if score_drop:
        candidate = {key: ["ffffffffffff"] for key in rankings}
    return {
        "queries": queries,
        "systems": {
            "lexical": {"legacy_rankings": rankings, "cloudflare_rankings": candidate},
            "semantic": {"legacy_rankings": rankings, "cloudflare_rankings": candidate},
        },
    }


def test_manual_benchmark_requires_50_labels_and_quality_thresholds() -> None:
    report = inspect(benchmark())
    assert report["ok"]
    assert report["query_count"] == 50
    assert report["systems"]["lexical"]["cloudflare_ndcg_at_10"] == 1.0


def test_manual_benchmark_reports_quality_regression_without_hiding_it() -> None:
    report = inspect(benchmark(score_drop=True))
    assert not report["ok"]
    assert report["systems"]["semantic"]["cloudflare_ndcg_at_10"] == 0.0


def test_manual_benchmark_rejects_a_smaller_or_unlabelled_sample() -> None:
    bad = benchmark()
    bad["queries"] = bad["queries"][:49]
    try:
        inspect(bad)
    except BenchmarkError as exc:
        assert "50" in str(exc)
    else:
        raise AssertionError("expected the benchmark gate to reject fewer than 50 labels")


def test_manual_benchmark_requires_facet_diversity_and_unique_rankings() -> None:
    bad = benchmark()
    for query in bad["queries"]:
        query["facets"]["court"] = "FCA"
    try:
        inspect(bad)
    except BenchmarkError as exc:
        assert "court" in str(exc)
    else:
        raise AssertionError("expected insufficient court diversity to block")

    bad = benchmark()
    bad["systems"]["lexical"]["cloudflare_rankings"]["q-00"] = ["000000000000"] * 2
    try:
        inspect(bad)
    except BenchmarkError as exc:
        assert "duplicate" in str(exc)
    else:
        raise AssertionError("expected duplicate ranking IDs to block")
