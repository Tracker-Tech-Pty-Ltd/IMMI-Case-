"""Keep the deployed AustLII Worker package free of legacy DB runtime deps."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRAPER = ROOT / "workers" / "austlii-scraper"


def test_scraper_production_dependencies_are_cloudflare_native() -> None:
    package = json.loads((SCRAPER / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((SCRAPER / "package-lock.json").read_text(encoding="utf-8"))
    package_root = lock["packages"][""]

    assert "postgres" not in package.get("dependencies", {})
    assert "postgres" in package.get("devDependencies", {})
    assert "postgres" not in package_root.get("dependencies", {})
    assert "postgres" in package_root.get("devDependencies", {})


def test_legacy_rollback_script_is_not_in_native_worker_source() -> None:
    source_files = list((SCRAPER / "src").glob("*.ts"))
    source = "\n".join(path.read_text(encoding="utf-8") for path in source_files)
    assert 'from "postgres"' not in source
    assert "require(\"postgres\")" not in source
    assert "HYPERDRIVE_SERVICE_URL" not in source
    assert "SUPABASE_DB_URL" not in source


def test_ci_runs_the_native_dependency_boundary_gate() -> None:
    workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "tests/test_native_dependency_closure.py" in workflow
    assert "working-directory: workers/austlii-scraper" in workflow
    assert "npm run typecheck" in workflow
    assert "npm test" in workflow
