#!/usr/bin/env python3
"""Fail-closed quality gate for the manual IMMI Cloudflare search benchmark.

The benchmark file intentionally contains human relevance labels, not labels
derived from lexical or vector rankings.  This verifier requires at least 50
queries spanning the cutover facets and proves both lexical and semantic
NDCG@10 are >= 0.80 and no worse than their recorded legacy baseline by >5%.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any


REQUIRED_FACETS = {"court", "year", "outcome", "visa_type", "keyword", "scenario"}
MINIMUM_FACET_VALUES = 2
REQUIRED_SYSTEMS = ("lexical", "semantic")


class BenchmarkError(ValueError):
    pass


def dcg_at_10(relevant: set[str], ranking: list[str]) -> float:
    return sum(
        1 / math.log2(index + 2)
        for index, case_id in enumerate(ranking[:10])
        if case_id in relevant
    )


def ndcg_at_10(relevant: set[str], ranking: list[str]) -> float:
    ideal = sum(1 / math.log2(index + 2) for index in range(min(10, len(relevant))))
    return dcg_at_10(relevant, ranking) / ideal if ideal else 0.0


def required_list(value: Any, label: str) -> list[str]:
    if not isinstance(value, list) or not value or any(not isinstance(item, str) or not item for item in value):
        raise BenchmarkError(f"{label} must be a non-empty list of case IDs")
    if len(set(value)) != len(value):
        raise BenchmarkError(f"{label} must not contain duplicate case IDs")
    return value


def facet_value(value: Any) -> str:
    """Return a stable comparable representation for a manually-entered facet."""

    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


def inspect(payload: dict[str, Any]) -> dict[str, Any]:
    queries = payload.get("queries")
    if not isinstance(queries, list) or len(queries) < 50:
        raise BenchmarkError("at least 50 manually labelled queries are required")
    ids: set[str] = set()
    labels: dict[str, set[str]] = {}
    seen_facets: set[str] = set()
    facet_values: dict[str, set[str]] = {facet: set() for facet in REQUIRED_FACETS}
    for index, query in enumerate(queries, 1):
        if not isinstance(query, dict):
            raise BenchmarkError(f"queries[{index}] must be an object")
        query_id = query.get("id")
        if not isinstance(query_id, str) or not query_id or query_id in ids:
            raise BenchmarkError(f"queries[{index}].id must be unique and non-empty")
        if not isinstance(query.get("query"), str) or not query["query"].strip():
            raise BenchmarkError(f"queries[{index}].query is required")
        facets = query.get("facets")
        if not isinstance(facets, dict) or not REQUIRED_FACETS.issubset(facets):
            raise BenchmarkError(f"queries[{index}].facets must contain {', '.join(sorted(REQUIRED_FACETS))}")
        labels[query_id] = set(required_list(query.get("relevant_case_ids"), f"queries[{index}].relevant_case_ids"))
        ids.add(query_id)
        for key, value in facets.items():
            if value not in (None, "", [], {}):
                seen_facets.add(key)
                if key in facet_values:
                    facet_values[key].add(facet_value(value))
    if not REQUIRED_FACETS.issubset(seen_facets):
        raise BenchmarkError("manual queries do not cover every required facet")
    insufficient_facets = sorted(
        facet for facet, values in facet_values.items()
        if len(values) < MINIMUM_FACET_VALUES
    )
    if insufficient_facets:
        raise BenchmarkError(
            "manual queries need at least two distinct values for: "
            + ", ".join(insufficient_facets)
        )

    systems = payload.get("systems")
    if not isinstance(systems, dict):
        raise BenchmarkError("systems results are required")
    report: dict[str, Any] = {"query_count": len(queries), "systems": {}}
    for system in REQUIRED_SYSTEMS:
        result = systems.get(system)
        if not isinstance(result, dict):
            raise BenchmarkError(f"systems.{system} is required")
        baseline = result.get("legacy_rankings")
        candidate = result.get("cloudflare_rankings")
        if not isinstance(baseline, dict) or not isinstance(candidate, dict):
            raise BenchmarkError(f"systems.{system} needs legacy_rankings and cloudflare_rankings")
        if set(baseline) != ids or set(candidate) != ids:
            raise BenchmarkError(f"systems.{system} rankings must contain exactly the manual query IDs")
        baseline_scores = [ndcg_at_10(labels[query_id], required_list(baseline[query_id], f"{system}.legacy.{query_id}")) for query_id in sorted(ids)]
        candidate_scores = [ndcg_at_10(labels[query_id], required_list(candidate[query_id], f"{system}.cloudflare.{query_id}")) for query_id in sorted(ids)]
        baseline_ndcg = sum(baseline_scores) / len(baseline_scores)
        candidate_ndcg = sum(candidate_scores) / len(candidate_scores)
        report["systems"][system] = {
            "legacy_ndcg_at_10": baseline_ndcg,
            "cloudflare_ndcg_at_10": candidate_ndcg,
            "delta": candidate_ndcg - baseline_ndcg,
            "passes": candidate_ndcg >= 0.80 and candidate_ndcg >= baseline_ndcg - 0.05,
        }
    report["ok"] = all(report["systems"][system]["passes"] for system in REQUIRED_SYSTEMS)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("benchmark", type=Path)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    try:
        payload = json.loads(args.benchmark.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise BenchmarkError("benchmark root must be an object")
        report = inspect(payload)
    except (OSError, json.JSONDecodeError, BenchmarkError) as exc:
        print(f"search benchmark blocked: {exc}", file=sys.stderr)
        return 2
    if args.as_json:
        print(json.dumps(report, sort_keys=True))
    else:
        print("search benchmark " + ("PASS" if report["ok"] else "BLOCKED"))
        for system, values in report["systems"].items():
            print(f"{system}: legacy={values['legacy_ndcg_at_10']:.4f} cloudflare={values['cloudflare_ndcg_at_10']:.4f} delta={values['delta']:.4f}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
