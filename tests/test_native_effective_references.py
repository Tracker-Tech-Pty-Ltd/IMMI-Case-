from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "check_native_effective_references",
    ROOT / "scripts/check_native_effective_references.py",
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_checked_in_effective_native_scope_is_clean() -> None:
    report = MODULE.inspect()
    assert report["ok"], report
    assert report["markers"] == {marker: 0 for marker in MODULE.MARKERS}
    assert report["bundle_ok"]


def test_operator_config_and_runtime_hits_block(tmp_path: Path) -> None:
    main = tmp_path / "main.toml"
    pipeline = tmp_path / "pipeline.toml"
    main.write_text('name = "immi"\n[hyperdrive]\nid = "legacy"\n', encoding="utf-8")
    pipeline.write_text('name = "native"\n', encoding="utf-8")
    root = tmp_path / "root"
    (root / "workers/austlii-scraper/src").mkdir(parents=True)
    (root / "workers/austlii-scraper/src/native.ts").write_text(
        'import postgres from "postgres";\n', encoding="utf-8"
    )
    (root / "workers/cloudflare-native.js").parent.mkdir(parents=True, exist_ok=True)
    (root / "workers/cloudflare-native.js").write_text("export default {};\n", encoding="utf-8")
    (root / ".github/workflows").mkdir(parents=True)
    (root / ".github/workflows/ci.yml").write_text("env:\n  SUPABASE_URL: bad\n", encoding="utf-8")
    (root / ".github/workflows/deploy-worker.yml").write_text("name: deploy\n", encoding="utf-8")
    (root / "scripts").mkdir()
    (root / "scripts/check_cloudflare_native_bundle.mjs").write_text("process.exit(0);\n", encoding="utf-8")
    report = MODULE.inspect(main_config=main, pipeline_config=pipeline, root=root)
    assert not report["ok"]
    assert report["markers"]["supabase"] == 1
    assert report["markers"]["postgres"] == 1
    assert report["markers"]["hyperdrive"] == 1


def test_ci_and_deploy_invoke_effective_reference_scan() -> None:
    ci = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    deploy = (ROOT / ".github/workflows/deploy-worker.yml").read_text(encoding="utf-8")
    assert "check_native_effective_references.py" in ci
    assert "check_native_effective_references.py" in deploy
