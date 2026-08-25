"""Regression tests for the read-only IMMI separation preflight."""

from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT = Path(__file__).resolve().parents[1]
BSMART_ROOT = ROOT.parent / "Bsmart System"
MANIFEST = BSMART_ROOT / "immi/SEPARATION-MANIFEST.md"

# Without the manifest the verifier reports SEPARATION_MANIFEST_MISSING and its
# status becomes "error" rather than "blocked", so any assertion about the
# blocked contract is meaningless. That is the normal state on CI and on any
# checkout without the sibling repo — skip rather than fail, so a red result
# always means a real regression.
requires_manifest = pytest.mark.skipif(
    not MANIFEST.is_file(),
    reason=f"separation manifest absent at {MANIFEST}",
)
SPEC = importlib.util.spec_from_file_location(
    "verify_immi_separation",
    ROOT / "scripts/verify_immi_separation.py",
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

DEPLOY_SPEC = importlib.util.spec_from_file_location(
    "check_immi_deploy_target",
    ROOT / "scripts/check_immi_deploy_target.py",
)
assert DEPLOY_SPEC and DEPLOY_SPEC.loader
DEPLOY_MODULE = importlib.util.module_from_spec(DEPLOY_SPEC)
DEPLOY_SPEC.loader.exec_module(DEPLOY_MODULE)


def _args() -> SimpleNamespace:
    return SimpleNamespace(
        immi_root=str(ROOT),
        bsmart_root=str(BSMART_ROOT),
        manifest=str(MANIFEST),
        source_ref=MODULE.SOURCE_REF,
        target_ref=None,
        live=False,
        main_hyperdrive_id=None,
        pipeline_hyperdrive_id=None,
    )


def test_strip_sql_comments_does_not_count_identifiers_in_comments() -> None:
    source = "-- council_sessions\nSELECT 'council_turns'; /* council_sessions */"
    stripped = MODULE.strip_sql_comments(source)
    assert "council_sessions" not in stripped
    assert "council_turns" in stripped


@requires_manifest
def test_current_repositories_are_blocked_only_by_activation_inputs() -> None:
    report = MODULE.build_report(_args())
    assert report["status"] == "blocked"
    codes = {item["code"] for item in report["checks"]}
    assert "CLOUDFLARE_NATIVE_TARGET_UNPROVISIONED" in codes
    assert "BSMART_COUNCIL_DDL_ABSENT" in codes
    assert "IMMI_COUNCIL_DDL_ABSENT" in codes
    assert "CANONICAL_COUNCIL_MIGRATION_PRESENT" in codes
    assert "DESTRUCTIVE_IMMI_MIGRATION_ABSENT" in codes
    assert "CUTOVER_WRITE_FREEZE_DEFAULT_SAFE" in codes
    assert "PIPELINE_DEFAULT_DISABLED" in codes
    assert "IMMI_DEPLOY_TARGET_GATE_PRESENT" in codes


def test_blocked_report_is_deterministic() -> None:
    first = MODULE.build_report(_args())
    second = MODULE.build_report(_args())
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)


def test_deploy_gate_fails_closed_without_target() -> None:
    assert DEPLOY_MODULE.main() == 1


@requires_manifest
def test_shell_wrapper_repeats_and_compares_reports(tmp_path: Path) -> None:
    script = ROOT / "scripts/run_immi_separation_preflight.sh"
    result = subprocess.run(
        ["bash", str(script), str(tmp_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    first = tmp_path / "standard-1.json"
    second = tmp_path / "standard-2.json"
    assert first.exists() and second.exists()
    assert first.read_bytes() == second.read_bytes()
    assert "standard_reports_identical=true" in result.stdout
