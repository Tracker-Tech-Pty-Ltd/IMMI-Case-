#!/usr/bin/env python3
"""Run semantic vs lexical retrieval evaluation on sampled immigration cases.

Usage:
    python3 scripts/run_semantic_eval.py
    python3 scripts/run_semantic_eval.py --sample-size 1000 --seed 42
    python3 scripts/run_semantic_eval.py --k-values 5,10,20 --model text-embedding-3-small
"""

from __future__ import annotations

import argparse
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from immi_case_downloader.semantic_search_eval import (  # noqa: E402
    run_semantic_evaluation,
    write_report_files,
)


def parse_k_values(raw: str) -> list[int]:
    values: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            n = int(part)
        except ValueError as exc:
            raise argparse.ArgumentTypeError(f"Invalid k value: {part}") from exc
        if n <= 0:
            raise argparse.ArgumentTypeError(f"k must be > 0, got: {n}")
        values.append(n)
    if not values:
        raise argparse.ArgumentTypeError("At least one k value is required")
    return sorted(set(values))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate lexical vs semantic vs hybrid retrieval on sampled cases."
    )
    parser.add_argument(
        "--sample-size",
        type=int,
        default=1000,
        help="Number of sampled cases (default: 1000)",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for sampling reproducibility (default: 42)",
    )
    parser.add_argument(
        "--provider",
        choices=["openai", "gemini"],
        default="openai",
        help="Embedding provider (default: openai)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="",
        help=(
            "Embedding model name. "
            "Default: text-embedding-3-small (openai), "
            "models/gemini-embedding-001 (gemini)"
        ),
    )
    parser.add_argument(
        "--price-per-1m",
        type=float,
        default=0.02,
        help="Embedding price per 1M tokens in USD (default: 0.02)",
    )
    parser.add_argument(
        "--k-values",
        type=parse_k_values,
        default=parse_k_values("5,10,20"),
        help="Comma-separated K values for recall/nDCG (default: 5,10,20)",
    )
    parser.add_argument(
        "--ranking-limit",
        type=int,
        default=50,
        help="Top-N ranking cutoff per method (default: 50)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="data_quality_reports",
        help="Output directory for JSON/Markdown report files",
    )
    args = parser.parse_args()

    if args.sample_size <= 0:
        print("ERROR: --sample-size must be > 0")
        return 1
    if args.ranking_limit <= 0:
        print("ERROR: --ranking-limit must be > 0")
        return 1
    if args.price_per_1m < 0:
        print("ERROR: --price-per-1m must be >= 0")
        return 1

    print("Starting semantic search evaluation...")
    print(f"  sample_size: {args.sample_size}")
    print(f"  seed: {args.seed}")
    model = args.model.strip() if args.model else ""
    if not model:
        if args.provider == "gemini":
            model = "models/gemini-embedding-001"
        else:
            model = "text-embedding-3-small"
    print(f"  provider: {args.provider}")
    print(f"  model: {model}")
    print(f"  k_values: {args.k_values}")
    print(f"  ranking_limit: {args.ranking_limit}")

    result = run_semantic_evaluation(
        sample_size=args.sample_size,
        seed=args.seed,
        provider=args.provider,
        model=model,
        price_per_1m_tokens=args.price_per_1m,
        k_values=args.k_values,
        ranking_limit=args.ranking_limit,
    )
    json_path, md_path = write_report_files(result, args.output_dir)

    metrics = result["results"]
    costs = result["costs"]
    max_k = max(result["config"]["k_values"])

    print("\nEvaluation complete.\n")
    print("Accuracy summary:")
    for method_key, label in [
        ("lexical_fts5", "Lexical"),
        ("semantic_embeddings", "Semantic"),
        ("hybrid_rrf", "Hybrid"),
    ]:
        m = metrics[method_key]
        recall_10 = m.get("recall@10")
        recall_str = f"{recall_10:.4f}" if isinstance(recall_10, float) else "n/a"
        print(
            f"  {label:<9} "
            f"MRR@{max_k}={m[f'mrr@{max_k}']:.4f} "
            f"Recall@10={recall_str}"
        )

    print("\nCost summary:")
    print(f"  Sample total embedding cost: ${costs['sample_total_cost_usd']:.4f}")
    print(
        "  Projected full-corpus summary embedding cost: "
        f"${costs['projected_summary_ingest_cost_usd']:.2f}"
    )
    print(
        "  Projected full-corpus full-text embedding cost: "
        f"${costs['projected_full_text_ingest_cost_usd']:.2f}"
    )

    print(f"\nReports saved:\n  JSON: {json_path}\n  Markdown: {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
