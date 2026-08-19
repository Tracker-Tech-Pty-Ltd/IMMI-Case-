#!/usr/bin/env python3
"""Fail-closed p50/p95 performance gate for native IMMI endpoints.

The input is an operator-generated measurement report.  It must identify the
complete non-AI endpoint set being compared with the legacy baseline; this
script never invents missing measurements and never contacts a live service.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any


MAX_NON_AI_P95_MS = 1000.0
MAX_REGRESSION = 1.20


class PerformanceError(ValueError):
    pass


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PerformanceError(f"{label} must be a finite number")
    result = float(value)
    if not math.isfinite(result) or result < 0:
        raise PerformanceError(f"{label} must be a finite non-negative number")
    return result


def inspect(payload: dict[str, Any]) -> dict[str, Any]:
    required = payload.get("required_endpoints")
    if (
        not isinstance(required, list)
        or not required
        or any(not isinstance(item, str) or not item.strip() for item in required)
        or len(set(required)) != len(required)
    ):
        raise PerformanceError("required_endpoints must be a unique non-empty list")
    required_set = set(required)

    measurements = payload.get("measurements")
    if not isinstance(measurements, list) or not measurements:
        raise PerformanceError("measurements must be a non-empty list")
    by_endpoint: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(measurements, 1):
        if not isinstance(row, dict):
            raise PerformanceError(f"measurements[{index}] must be an object")
        endpoint = row.get("endpoint")
        if not isinstance(endpoint, str) or not endpoint.strip() or endpoint in by_endpoint:
            raise PerformanceError(f"measurements[{index}].endpoint must be unique")
        baseline_p50 = _number(row.get("baseline_p50_ms"), f"{endpoint}.baseline_p50_ms")
        baseline_p95 = _number(row.get("baseline_p95_ms"), f"{endpoint}.baseline_p95_ms")
        candidate_p50 = _number(row.get("cloudflare_p50_ms"), f"{endpoint}.cloudflare_p50_ms")
        candidate_p95 = _number(row.get("cloudflare_p95_ms"), f"{endpoint}.cloudflare_p95_ms")
        if baseline_p50 > baseline_p95 or candidate_p50 > candidate_p95:
            raise PerformanceError(f"{endpoint} p50 cannot exceed p95")
        sample_count = row.get("sample_count")
        if isinstance(sample_count, bool) or not isinstance(sample_count, int) or sample_count < 1:
            raise PerformanceError(f"{endpoint}.sample_count must be a positive integer")
        is_ai = row.get("ai", False)
        if not isinstance(is_ai, bool):
            raise PerformanceError(f"{endpoint}.ai must be boolean")
        by_endpoint[endpoint] = {
            "baseline_p50_ms": baseline_p50,
            "baseline_p95_ms": baseline_p95,
            "cloudflare_p50_ms": candidate_p50,
            "cloudflare_p95_ms": candidate_p95,
            "sample_count": sample_count,
            "ai": is_ai,
        }

    missing = sorted(required_set - set(by_endpoint))
    extra = sorted(set(by_endpoint) - required_set)
    if missing or extra:
        raise PerformanceError(f"measurement set mismatch: missing={missing}, extra={extra}")

    report: dict[str, Any] = {"required_endpoint_count": len(required), "endpoints": {}, "ok": True}
    for endpoint in required:
        row = by_endpoint[endpoint]
        p95 = row["cloudflare_p95_ms"]
        baseline = row["baseline_p95_ms"]
        checks = {"absolute_p95": True, "regression": True}
        if not row["ai"]:
            checks["absolute_p95"] = p95 <= MAX_NON_AI_P95_MS
            checks["regression"] = p95 <= baseline * MAX_REGRESSION
        row_report = row | {
            "checks": checks,
            "passes": all(checks.values()),
            "regression_ratio": (p95 / baseline) if baseline else (0.0 if p95 == 0 else math.inf),
        }
        report["endpoints"][endpoint] = row_report
        report["ok"] = report["ok"] and row_report["passes"]
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    try:
        payload = json.loads(args.report.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise PerformanceError("report root must be an object")
        report = inspect(payload)
    except (OSError, json.JSONDecodeError, PerformanceError) as exc:
        print(f"performance gate blocked: {exc}", file=sys.stderr)
        return 2
    if args.as_json:
        print(json.dumps(report, sort_keys=True))
    else:
        print("performance gate " + ("PASS" if report["ok"] else "BLOCKED"))
        for endpoint, values in report["endpoints"].items():
            print(
                f"{endpoint}: baseline_p95={values['baseline_p95_ms']:.2f}ms "
                f"cloudflare_p95={values['cloudflare_p95_ms']:.2f}ms "
                f"passes={values['passes']}"
            )
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
