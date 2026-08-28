"""Import smoke tests for the repo-root extraction scripts.

Six root-level scripts totalling 2,821 lines drive the case-catalog extraction
pipeline. Only extract_structured_fields.py is meaningfully covered (see
tests/test_extraction_structured_fields.py). This module records the import
status of the rest so the gap is visible in test output rather than absent from
it: a module that is never imported does NOT appear in a --cov report at all,
it only emits a CoverageWarning.

Importing a module is a weak test, but it is strictly better than nothing: it
catches syntax errors, bad top-level constants and import-time side effects,
none of which any other test in this repo would catch for these files.

WHY A SUBPROCESS. The four LLM scripts must NOT be imported into the pytest
process. extract_structured_fields_llm.py runs _find_and_load_env() at import
time (lines 36-51), which walks up to eight directories looking for a .env and
calls load_dotenv(candidate, override=True) — override=True rewrites the whole
process environment, for every test that runs afterwards, with whatever the
developer's .env happens to contain. That is a nasty, order-dependent way to
poison a test run, and it would only start happening on the day someone adds
`anthropic` to the test requirements (i.e. long after anyone remembers this
file). Each import therefore runs in a fresh interpreter with a minimal
environment, and only its exit status and stderr come back.
"""

from __future__ import annotations

import importlib
import os
import subprocess
import sys

import pytest


def test_download_fulltext_imports_cleanly() -> None:
    """download_fulltext has no third-party deps beyond the app requirements.

    Safe to import in-process: it defines only constants and functions at module
    scope and performs no network or environment side effects on import.
    """
    module = importlib.import_module("download_fulltext")
    assert hasattr(module, "main")


# These four import `anthropic`, which is deliberately NOT in the test
# requirements — see plans/041 "Why the other four scripts cannot simply be
# tested". They skip today and start running if that dependency is ever added.
LLM_EXTRACTION_SCRIPTS = [
    "extract_llm_structured",
    "extract_structured_fields_llm",
    "extract_llm_fields",
    "extract_with_llm",
]

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _import_in_subprocess(module_name: str) -> subprocess.CompletedProcess:
    """Import `module_name` in a fresh interpreter with a sanitised env."""
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.environ.get("HOME", ""),
        "PYTHONPATH": REPO_ROOT,
        # Belt and braces: even if a script's dotenv walk finds a file, it has
        # nothing to override that this test process cares about.
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    return subprocess.run(
        [sys.executable, "-c", f"import {module_name}"],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


@pytest.mark.parametrize("module_name", LLM_EXTRACTION_SCRIPTS)
def test_llm_extraction_script_imports_cleanly(module_name: str) -> None:
    result = _import_in_subprocess(module_name)
    if result.returncode != 0 and "No module named 'anthropic'" in result.stderr:
        pytest.skip(
            "anthropic is not a test dependency; this script cannot be imported "
            "here. Add it to the test requirements to turn this into a real check."
        )
    assert result.returncode == 0, (
        f"{module_name} failed to import:\n{result.stderr[-2000:]}"
    )


def test_llm_scripts_are_never_imported_into_the_test_process() -> None:
    """The subprocess isolation above must not be quietly undone.

    If one of these ends up in sys.modules, some test imported it directly and
    extract_structured_fields_llm's import-time load_dotenv(override=True) has
    already rewritten os.environ for every test that runs after it.
    """
    leaked = [name for name in LLM_EXTRACTION_SCRIPTS if name in sys.modules]
    assert leaked == [], f"LLM extraction scripts imported in-process: {leaked}"
