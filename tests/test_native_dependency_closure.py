"""Keep the deployed AustLII Worker package free of legacy DB runtime deps."""

from __future__ import annotations

import fnmatch
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRAPER = ROOT / "workers" / "austlii-scraper"
GATE_TEST_PATH = "tests/test_native_dependency_closure.py"


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


def _extract_python_unit_test_command(workflow: str) -> str:
    """Pull the shell command body of the "Run Python unit tests" CI step.

    Scoped to just that step's `run:` block (rather than the whole workflow
    text) so assertions about pytest's invocation can't accidentally match
    unrelated steps (e.g. the native pipeline's own "Run ... tests" step).
    """
    match = re.search(
        r"- name: Run Python unit tests\n\s*run:\s*>-\n(?P<cmd>.*?)"
        r"(?=\n[ ]{0,6}- name:|\n[ ]{0,2}\S|\Z)",
        workflow,
        re.DOTALL,
    )
    assert match, "Could not locate the 'Run Python unit tests' step in ci.yml"
    return match.group("cmd")


def test_ci_runs_the_native_dependency_boundary_gate() -> None:
    workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    assert "working-directory: workers/austlii-scraper" in workflow
    assert "npm run typecheck" in workflow
    assert "npm test" in workflow

    command = _extract_python_unit_test_command(workflow)

    # CI must run pytest against the whole tests/ tree (a bare `tests/`
    # argument), not a curated list of individual test files -- that is
    # what makes this boundary-gate file run implicitly instead of needing
    # to be named explicitly in the CI command.
    assert re.search(r"pytest\s+tests/(?:\s|$)", command), (
        "CI must invoke pytest on the whole tests/ directory, "
        f"got command:\n{command}"
    )

    # No --ignore/--ignore-glob/--deselect flag may exclude this gate file
    # itself -- directly, by excluding the tests/ directory it lives in, or
    # by glob -- otherwise a future re-narrowing of the CI command could
    # silently drop the gate again. Matches both the `--flag=value` and
    # space-separated `--flag value` forms.
    for flag, ignored in re.findall(
        r"--(ignore|ignore-glob|deselect)[=\s]+(\S+)", command
    ):
        normalized = ignored.rstrip("/")
        assert normalized != GATE_TEST_PATH, (
            f"--{flag}={ignored} would exclude the boundary-gate test itself"
        )
        assert not GATE_TEST_PATH.startswith(normalized + "/"), (
            f"--{flag}={ignored} would exclude the boundary-gate test itself"
        )
        assert not fnmatch.fnmatch(GATE_TEST_PATH, normalized), (
            f"--{flag}={ignored} would exclude the boundary-gate test itself "
            "via glob match"
        )
