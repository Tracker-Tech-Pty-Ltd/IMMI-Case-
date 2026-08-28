"""Parity guards for the shared visa subclass registry.

The registry has one source of truth,
``immi_case_downloader/data/visa_registry.json``. The Cloudflare Worker's copy
at ``workers/case-api/visa_registry.generated.js`` is generated from it by
``scripts/generate_visa_registry.py``. These tests fail when the two drift.
"""

import json
import os
import re
import subprocess
import sys

from immi_case_downloader.visa_registry import (
    VISA_FAMILIES,
    VISA_REGISTRY,
    get_family,
    get_registry_for_api,
)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GENERATED_JS = os.path.join(
    REPO_ROOT, "workers", "case-api", "visa_registry.generated.js"
)
GENERATOR = os.path.join(REPO_ROOT, "scripts", "generate_visa_registry.py")

_ENTRY_RE = re.compile(r"^  (\[.*\]),$", re.MULTILINE)


def _worker_registry() -> dict[str, tuple[str, str]]:
    """Parse the generated Worker module back into a subclass -> (name, family) map."""
    with open(GENERATED_JS, encoding="utf-8") as handle:
        source = handle.read()
    entries = [json.loads(match.group(1)) for match in _ENTRY_RE.finditer(source)]
    return {subclass: (name, family) for subclass, name, family in entries}


def test_generated_worker_registry_is_not_stale():
    result = subprocess.run(
        [sys.executable, GENERATOR, "--check"],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    assert result.returncode == 0, (
        "workers/case-api/visa_registry.generated.js is stale. Run: "
        "python3 scripts/generate_visa_registry.py\n" + result.stderr
    )


def test_worker_and_python_registries_agree():
    assert _worker_registry() == VISA_REGISTRY


def test_subclass_408_is_a_visitor_visa():
    # Regression: the Worker's hand-maintained copy bucketed 408 as "Skilled"
    # while the Flask analytics bucketed it as "Visitor". The Visitor family
    # description is literally "Tourist, visitor, and temporary activity visas".
    assert VISA_REGISTRY["408"] == ("Temporary Activity", "Visitor")
    assert get_family("408") == "Visitor"
    assert _worker_registry()["408"] == ("Temporary Activity", "Visitor")


def test_registry_api_entries_are_canonically_sorted():
    # Both runtimes serve /api/v1/visa-registry; sorting by zfill(4) on both
    # sides makes the two payloads byte-identical, not merely equivalent.
    payload = get_registry_for_api()
    subclasses = [entry["subclass"] for entry in payload["entries"]]
    assert subclasses == sorted(subclasses, key=lambda value: value.zfill(4))
    assert payload["families"] == VISA_FAMILIES
    assert set(get_registry_for_api()) == {"entries", "families"}


def test_every_family_used_by_an_entry_is_described():
    used = {family for _, family in VISA_REGISTRY.values()}
    assert used <= set(VISA_FAMILIES)
