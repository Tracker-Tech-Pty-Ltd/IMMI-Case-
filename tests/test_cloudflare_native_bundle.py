"""Contract test for the transitive native Worker bundle closure."""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_native_bundle_has_no_legacy_runtime_dependency() -> None:
    result = subprocess.run(
        ["node", "scripts/check_cloudflare_native_bundle.mjs"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "closure passed" in result.stdout
