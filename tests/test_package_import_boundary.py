"""The installable package must never import upward into a repo-root script."""

from __future__ import annotations

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "immi_case_downloader"

# Modules that live at the repo root, not inside any package. Importing one of
# these from inside immi_case_downloader/ makes the package un-installable and
# only works by accident when the repo root happens to be on sys.path.
ROOT_MODULES = {path.stem for path in ROOT.glob("*.py")}


def _absolute_imports(source: str) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            names.add(node.module.split(".")[0])
    return names


def test_package_never_imports_a_repo_root_module() -> None:
    offenders = []
    for path in sorted(PACKAGE.rglob("*.py")):
        imported = _absolute_imports(path.read_text(encoding="utf-8"))
        for name in sorted(imported & ROOT_MODULES):
            offenders.append(f"{path.relative_to(ROOT)} imports root module {name!r}")
    assert not offenders, offenders
