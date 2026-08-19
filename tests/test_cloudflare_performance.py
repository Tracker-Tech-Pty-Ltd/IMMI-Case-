from __future__ import annotations

from scripts.check_cloudflare_performance import PerformanceError, inspect


def report(candidate_p95: float = 550.0) -> dict:
    required = ["GET /api/v1/cases", "GET /api/v1/auth/me"]
    return {
        "required_endpoints": required,
        "measurements": [
            {
                "endpoint": required[0],
                "baseline_p50_ms": 20,
                "baseline_p95_ms": 500,
                "cloudflare_p50_ms": 25,
                "cloudflare_p95_ms": candidate_p95,
                "sample_count": 3000,
                "ai": False,
            },
            {
                "endpoint": required[1],
                "baseline_p50_ms": 10,
                "baseline_p95_ms": 100,
                "cloudflare_p50_ms": 20,
                "cloudflare_p95_ms": 110,
                "sample_count": 3000,
                "ai": False,
            },
        ],
    }


def test_performance_gate_accepts_within_baseline_and_absolute_limits() -> None:
    result = inspect(report())
    assert result["ok"]
    assert result["endpoints"]["GET /api/v1/cases"]["regression_ratio"] == 1.1


def test_performance_gate_rejects_regression_or_absolute_limit() -> None:
    result = inspect(report(601))
    assert not result["ok"]
    assert not result["endpoints"]["GET /api/v1/cases"]["passes"]
    result = inspect(report(1001))
    assert not result["ok"]
    assert not result["endpoints"]["GET /api/v1/cases"]["checks"]["absolute_p95"]


def test_performance_gate_rejects_missing_measurements_and_bad_samples() -> None:
    bad = report()
    bad["measurements"].pop()
    try:
        inspect(bad)
    except PerformanceError as exc:
        assert "missing" in str(exc)
    else:
        raise AssertionError("expected missing endpoint to block")

    bad = report()
    bad["measurements"][0]["sample_count"] = 0
    try:
        inspect(bad)
    except PerformanceError as exc:
        assert "sample_count" in str(exc)
    else:
        raise AssertionError("expected invalid sample count to block")
