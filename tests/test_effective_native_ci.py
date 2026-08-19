"""Keep the checked-in effective runtime and CI path Cloudflare-native."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8").lower()


def test_active_configs_do_not_reintroduce_legacy_database_bindings() -> None:
    source = "\n".join(
        _source(path)
        for path in (
            "wrangler.toml",
            "workers/austlii-scraper/wrangler.toml",
        )
    )
    for marker in ("hyperdrive", "supabase", "postgres", "flask_backend"):
        assert marker not in source, marker


def test_ci_and_deploy_use_native_gates_only() -> None:
    ci = _source(".github/workflows/ci.yml")
    deploy = _source(".github/workflows/deploy-worker.yml")

    assert "check_cloudflare_native_bundle.mjs" in ci
    assert "check_immi_deploy_target.py" not in deploy
    assert "check_cloudflare_native_target.py" in deploy
    assert "check_immi_activation_evidence.py" in deploy
    assert '"$runner_temp/immi-native-main.toml"' in deploy
    assert '"$runner_temp/immi-native-pipeline.toml"' in deploy
    assert "wrangler deploy --config" in deploy
    assert "wrangler deploy\"" not in deploy


def test_runtime_package_keeps_postgres_out_of_production_dependencies() -> None:
    import json

    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    assert "postgres" not in package.get("dependencies", {})
    assert "postgres" not in package.get("devDependencies", {})


def test_latency_smoke_targets_routes_served_by_native_worker() -> None:
    script = _source("tests/k6/auth-latency.js")
    assert "/api/v1/cases" in script
    assert "/api/v1/auth/me" in script
    assert "/api/v1/collections" not in script
    assert "hyperdrive" not in script
