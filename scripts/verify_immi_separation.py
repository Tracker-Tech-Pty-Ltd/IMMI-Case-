#!/usr/bin/env python3
"""Fail-closed, read-only preflight for IMMI's Cloudflare-native separation.

The command never changes Supabase, Cloudflare, git, or any file unless the
caller explicitly asks it to write its JSON report with ``--output``.  A
Supabase target project is deliberately not required: the destination runtime
is three D1 databases, R2 and Vectorize, and the native config gate owns the
operator provisioning check.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


SOURCE_REF = "urntbuqczarkuoaosjxd"
CANDIDATE_TABLES = (
    "council_sessions",
    "council_turns",
    "immi_tenant_members",
    "immi_tenant_invites",
    "immi_collections",
    "immi_saved_searches",
    "immi_users",
    "immi_tenants",
)
REQUIRED_SECRETS = (
    "CSRF_SECRET",
    "CF_AIG_TOKEN",
    "SECRET_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "JWT_SECRET_CURRENT",
    "JWT_KID_CURRENT",
    "TELEGRAM_BOT_TOKEN",
)


def _default_immi_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _default_bsmart_root() -> Path:
    return _default_immi_root().parent / "Bsmart System"


def _check(
    checks: list[dict[str, Any]],
    code: str,
    status: str,
    evidence: Any,
    next_command: str | None = None,
) -> None:
    item: dict[str, Any] = {
        "code": code,
        "status": status,
        "evidence": evidence,
    }
    if next_command:
        item["next_command"] = next_command
    checks.append(item)


def strip_sql_comments(source: str) -> str:
    """Remove SQL line/block comments without touching quoted literals."""

    output: list[str] = []
    i = 0
    state = "normal"
    while i < len(source):
        char = source[i]
        nxt = source[i + 1] if i + 1 < len(source) else ""
        if state == "normal":
            if char == "'":
                state = "single"
                output.append(char)
            elif char == '"':
                state = "double"
                output.append(char)
            elif char == "-" and nxt == "-":
                state = "line_comment"
                output.extend((" ", " "))
                i += 1
            elif char == "/" and nxt == "*":
                state = "block_comment"
                output.extend((" ", " "))
                i += 1
            else:
                output.append(char)
        elif state == "line_comment":
            if char == "\n":
                state = "normal"
                output.append(char)
            else:
                output.append(" ")
        elif state == "block_comment":
            if char == "*" and nxt == "/":
                state = "normal"
                output.extend((" ", " "))
                i += 1
            else:
                output.append("\n" if char == "\n" else " ")
        elif state == "single":
            output.append(char)
            if char == "'":
                if nxt == "'":
                    output.append(nxt)
                    i += 1
                else:
                    state = "normal"
        else:  # double-quoted identifier
            output.append(char)
            if char == '"':
                if nxt == '"':
                    output.append(nxt)
                    i += 1
                else:
                    state = "normal"
        i += 1
    return "".join(output)


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def _git(repo: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip()


def _baseline_check(checks: list[dict[str, Any]], path: Path, label: str) -> None:
    source = _read(path)
    if source is None:
        _check(checks, f"{label.upper()}_BASELINE_MISSING", "ERROR", str(path))
        return
    executable = strip_sql_comments(source)
    hits = sorted(
        {
            table
            for table in CANDIDATE_TABLES[:2]
            if re.search(rf"\b{table}\b", executable, re.IGNORECASE)
        }
    )
    if hits:
        _check(
            checks,
            f"{label.upper()}_COUNCIL_DDL_PRESENT",
            "FAIL",
            {"path": str(path), "identifiers": hits},
            "Remove only the executable council table blocks from this baseline; keep the canonical forward migrations.",
        )
    else:
        _check(checks, f"{label.upper()}_COUNCIL_DDL_ABSENT", "PASS", str(path))


def _migration_check(checks: list[dict[str, Any]], immi_root: Path) -> None:
    migration = immi_root / "supabase/migrations/20260428_council_sessions.sql"
    source = _read(migration)
    if source is None:
        _check(checks, "CANONICAL_COUNCIL_MIGRATION_MISSING", "ERROR", str(migration))
        return
    executable = strip_sql_comments(source)
    missing = [
        table
        for table in CANDIDATE_TABLES[:2]
        if not re.search(rf"\bCREATE\s+TABLE\b.*\b{table}\b", executable, re.IGNORECASE | re.DOTALL)
    ]
    if missing:
        _check(checks, "CANONICAL_COUNCIL_MIGRATION_INCOMPLETE", "FAIL", missing)
    else:
        _check(checks, "CANONICAL_COUNCIL_MIGRATION_PRESENT", "PASS", str(migration))


def _destructive_migration_check(checks: list[dict[str, Any]], immi_root: Path) -> None:
    matches: list[str] = []
    for path in sorted((immi_root / "supabase/migrations").glob("*.sql")):
        source = _read(path)
        if source is None:
            continue
        executable = strip_sql_comments(source)
        for table in CANDIDATE_TABLES:
            if re.search(
                rf"\bDROP\s+(?:TABLE|FUNCTION)\b[^;]*\b{table}\b",
                executable,
                re.IGNORECASE | re.DOTALL,
            ):
                matches.append(str(path))
                break
    if matches:
        _check(
            checks,
            "DESTRUCTIVE_IMMI_MIGRATION_PRESENT",
            "FAIL",
            sorted(matches),
            "Remove the destructive migration from this change; shared-project cleanup is a separately gated operation.",
        )
    else:
        _check(checks, "DESTRUCTIVE_IMMI_MIGRATION_ABSENT", "PASS", "supabase/migrations/*.sql")


def _runtime_ref_check(checks: list[dict[str, Any]], immi_root: Path, source_ref: str) -> None:
    active_paths = (
        immi_root / "Dockerfile",
        immi_root / "wrangler.toml",
        immi_root / "workers/austlii-scraper/wrangler.toml",
    )
    tooling_paths = (
        immi_root / ".mcp.json",
        immi_root / ".codex/config.toml",
    )
    active_hits: list[str] = []
    tooling_hits: list[str] = []
    for path in active_paths:
        source = _read(path)
        if source and source_ref in source:
            active_hits.append(str(path))
    for path in tooling_paths:
        source = _read(path)
        if source and source_ref in source:
            tooling_hits.append(str(path))
    if active_hits:
        _check(
            checks,
            "SOURCE_PROJECT_IN_ACTIVE_RUNTIME_CONFIG",
            "BLOCKED",
            sorted(active_hits),
            "Remove the shared project reference from active Worker/container configs before target activation.",
        )
    else:
        _check(checks, "SOURCE_PROJECT_ABSENT_FROM_ACTIVE_RUNTIME_CONFIG", "PASS", [str(p) for p in active_paths])
    if tooling_hits:
        _check(
            checks,
            "SOURCE_PROJECT_LOCAL_TOOLING_REFERENCE",
            "PASS",
            sorted(tooling_hits),
            "Local MCP/editor references are not deployed runtime; remove them only when the operator target is available if local tooling must be repointed.",
        )


def _native_pipeline_source_check(checks: list[dict[str, Any]], immi_root: Path) -> None:
    """Ensure the native scraper source cannot load the legacy DB client."""

    root = immi_root / "workers/austlii-scraper/src"
    forbidden = re.compile(r"from\s+[\"']postgres[\"']|HYPERDRIVE_SERVICE|HYPERDRIVE_SERVICE_URL|\bpostgres\s*\(")
    hits: list[str] = []
    for path in sorted(root.glob("*.ts")):
        source = _read(path) or ""
        if forbidden.search(source):
            hits.append(str(path))
    if hits:
        _check(
            checks,
            "NATIVE_PIPELINE_LEGACY_DB_REFERENCE",
            "FAIL",
            hits,
            "Remove PostgreSQL/Hyperdrive imports from the scraper native source before activation.",
        )
    else:
        _check(checks, "NATIVE_PIPELINE_SOURCE_DB_CLEAN", "PASS", str(root))


def _worker_gate_check(checks: list[dict[str, Any]], immi_root: Path) -> None:
    """Verify local configuration is fail-closed before target activation."""

    main_config = _read(immi_root / "wrangler.toml") or ""
    pipeline_config = _read(immi_root / "workers/austlii-scraper/wrangler.toml") or ""
    main_match = re.search(r"^CUTOVER_WRITE_FREEZE\s*=\s*\"(true|false)\"\s*$", main_config, re.MULTILINE)
    pipeline_match = re.search(r"^PIPELINE_ENABLED\s*=\s*\"(true|false)\"\s*$", pipeline_config, re.MULTILINE)

    if not main_match:
        _check(
            checks,
            "CUTOVER_WRITE_FREEZE_UNDECLARED",
            "ERROR",
            str(immi_root / "wrangler.toml"),
            "Declare CUTOVER_WRITE_FREEZE=\"false\" before target activation.",
        )
    elif main_match.group(1) != "false":
        _check(
            checks,
            "CUTOVER_WRITE_FREEZE_DEFAULT_UNSAFE",
            "FAIL",
            main_match.group(1),
            "Keep the local default false; enable only in the explicitly approved write-freeze window.",
        )
    else:
        _check(checks, "CUTOVER_WRITE_FREEZE_DEFAULT_SAFE", "PASS", False)

    if not pipeline_match:
        _check(
            checks,
            "PIPELINE_ENABLED_UNDECLARED",
            "ERROR",
            str(immi_root / "workers/austlii-scraper/wrangler.toml"),
            "Declare PIPELINE_ENABLED=\"false\" until the standalone pipeline target is verified.",
        )
    elif pipeline_match.group(1) != "false":
        _check(
            checks,
            "PIPELINE_DEFAULT_UNSAFE",
            "FAIL",
            pipeline_match.group(1),
            "Keep the pipeline disabled until the main Worker target has passed cutover verification.",
        )
    else:
        _check(checks, "PIPELINE_DEFAULT_DISABLED", "PASS", False)


def _deployment_gate_check(checks: list[dict[str, Any]], immi_root: Path) -> None:
    workflow = immi_root / ".github/workflows/deploy-worker.yml"
    workflow_source = _read(workflow)
    native_script = immi_root / "scripts/check_cloudflare_native_target.py"
    native_source = _read(native_script)
    if workflow_source is None or native_source is None:
        _check(
            checks,
            "IMMI_DEPLOY_TARGET_GATE_MISSING",
            "ERROR",
            {"script": str(native_script), "workflow": str(workflow)},
        )
    elif "check_cloudflare_native_target.py" not in workflow_source:
        _check(
            checks,
            "CLOUDFLARE_NATIVE_TARGET_GATE_UNWIRED",
            "FAIL",
            str(workflow),
            "Wire scripts/check_cloudflare_native_target.py into the operator-only native deploy workflow before enabling deployment.",
        )
    else:
        _check(checks, "IMMI_DEPLOY_TARGET_GATE_PRESENT", "PASS", {"script": str(native_script), "workflow": str(workflow), "mode": "cloudflare-native"})

    if native_source and "fail closed" not in native_source.lower():
        _check(
            checks,
            "CLOUDFLARE_NATIVE_TARGET_GATE_INCOMPLETE",
            "FAIL",
            str(native_script),
            "The native config gate must fail closed before an operator-only deployment.",
        )
    elif native_source:
        _check(checks, "CLOUDFLARE_NATIVE_TARGET_GATE_PRESENT", "PASS", str(native_script))


def _manifest_check(checks: list[dict[str, Any]], manifest: Path, source_ref: str) -> None:
    source = _read(manifest)
    if source is None:
        _check(checks, "SEPARATION_MANIFEST_MISSING", "ERROR", str(manifest))
        return
    required = ("DO NOT DROP ANYTHING YET", "council_sessions", "council_turns", source_ref)
    missing = [item for item in required if item not in source]
    if missing:
        _check(checks, "SEPARATION_MANIFEST_INCOMPLETE", "FAIL", missing)
    else:
        _check(checks, "SEPARATION_MANIFEST_PRESENT", "PASS", str(manifest))


def _config_manifest_check(checks: list[dict[str, Any]], immi_root: Path, source_ref: str) -> None:
    path = immi_root / "config/immi-separation.json"
    source = _read(path)
    if source is None:
        _check(checks, "IMMI_CONFIG_MANIFEST_MISSING", "ERROR", str(path))
        return
    try:
        config = json.loads(source)
    except json.JSONDecodeError as exc:
        _check(checks, "IMMI_CONFIG_MANIFEST_INVALID", "ERROR", str(exc))
        return
    if config.get("source_project_ref") != source_ref:
        _check(checks, "IMMI_CONFIG_SOURCE_REF_MISMATCH", "FAIL", config.get("source_project_ref"))
        return
    if config.get("destination_mode") != "cloudflare-native":
        _check(
            checks,
            "IMMI_CONFIG_DESTINATION_MODE_INVALID",
            "FAIL",
            config.get("destination_mode"),
            "Set destination_mode=cloudflare-native; a second Supabase/Hyperdrive target is not the final architecture.",
        )
        return
    if config.get("target_project_ref") == source_ref:
        _check(checks, "IMMI_CONFIG_TARGET_REF_FORBIDDEN", "FAIL", source_ref)
        return
    _check(
        checks,
        "IMMI_CONFIG_MANIFEST_VALID",
        "PASS",
        {
            "path": str(path),
            "destination_mode": config.get("destination_mode"),
            "target_project_ref": config.get("target_project_ref"),
            "main_worker": config.get("workers", {}).get("main", {}).get("standalone_name"),
        },
    )


def _native_target_check(checks: list[dict[str, Any]], immi_root: Path) -> None:
    """Delegate resource-ID and binding validation to the native gate."""

    gate = immi_root / "scripts/check_cloudflare_native_target.py"
    if not gate.is_file():
        _check(checks, "CLOUDFLARE_NATIVE_TARGET_GATE_MISSING", "ERROR", str(gate))
        return
    try:
        result = subprocess.run(
            [sys.executable, str(gate)],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        _check(checks, "CLOUDFLARE_NATIVE_TARGET_GATE_ERROR", "ERROR", str(exc))
        return
    if result.returncode == 0:
        _check(checks, "CLOUDFLARE_NATIVE_TARGET_READY", "PASS", str(gate))
    elif result.returncode == 1:
        detail = (result.stderr or result.stdout).strip().splitlines()
        _check(
            checks,
            "CLOUDFLARE_NATIVE_TARGET_UNPROVISIONED",
            "BLOCKED",
            detail,
            "Materialise operator-supplied native Wrangler configs with real D1/R2/Vectorize identifiers, then rerun the target gate.",
        )
    else:
        _check(
            checks,
            "CLOUDFLARE_NATIVE_TARGET_GATE_ERROR",
            "ERROR",
            (result.stderr or result.stdout).strip(),
        )


def _live_cloudflare(checks: list[dict[str, Any]], expected_ref: str, worker: str, hyperdrive_id: str) -> None:
    try:
        result = subprocess.run(
            ["npx", "--no-install", "wrangler", "hyperdrive", "get", hyperdrive_id],
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        _check(checks, "CLOUDFLARE_HYPERDRIVE_UNREADABLE", "ERROR", {"worker": worker, "error": str(exc)})
        return
    match = re.search(r'"host"\s*:\s*"([^"]+)"', result.stdout)
    expected = f"db.{expected_ref}.supabase.co"
    if not match:
        _check(checks, "CLOUDFLARE_HYPERDRIVE_SHAPE_UNKNOWN", "ERROR", worker)
    elif match.group(1) != expected:
        _check(checks, "CLOUDFLARE_HYPERDRIVE_WRONG_TARGET", "FAIL", {"worker": worker, "host": match.group(1), "expected": expected})
    else:
        _check(checks, "CLOUDFLARE_HYPERDRIVE_TARGET_OK", "PASS", {"worker": worker, "host": expected})


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    immi_root = Path(args.immi_root).resolve()
    bsmart_root = Path(args.bsmart_root).resolve()
    source_ref = args.source_ref
    config_main_hyperdrive: str | None = None
    config_pipeline_hyperdrive: str | None = None
    config_source = _read(immi_root / "config/immi-separation.json")
    if config_source:
        try:
            config = json.loads(config_source)
            config_main_hyperdrive = config.get("workers", {}).get("main", {}).get("current_hyperdrive_id")
            config_pipeline_hyperdrive = config.get("workers", {}).get("pipeline", {}).get("current_hyperdrive_id")
        except json.JSONDecodeError:
            config_main_hyperdrive = None
    manifest = Path(args.manifest).resolve()
    checks: list[dict[str, Any]] = []

    _manifest_check(checks, manifest, source_ref)
    _config_manifest_check(checks, immi_root, source_ref)
    _native_target_check(checks, immi_root)
    _baseline_check(checks, bsmart_root / "supabase/migrations/00000000000000_baseline_snapshot_2026_05_12.sql", "bsmart")
    _baseline_check(checks, immi_root / "supabase/migrations/00000000000000_baseline_snapshot_2026_05_12.sql", "immi")
    _migration_check(checks, immi_root)
    _destructive_migration_check(checks, immi_root)
    _runtime_ref_check(checks, immi_root, source_ref)
    _native_pipeline_source_check(checks, immi_root)
    _worker_gate_check(checks, immi_root)
    _deployment_gate_check(checks, immi_root)

    if args.live:
        # The config manifest records the currently deployed source bindings;
        # CLI IDs are reserved for the newly provisioned target bindings.
        current_main_id = config_main_hyperdrive
        current_pipeline_id = config_pipeline_hyperdrive
        if current_main_id:
            _live_cloudflare(checks, source_ref, "immi-case-current", current_main_id)
        else:
            _check(checks, "CURRENT_MAIN_HYPERDRIVE_ID_UNDECLARED", "ERROR", None)
        if current_pipeline_id:
            _live_cloudflare(checks, source_ref, "austlii-scraper-current", current_pipeline_id)
        else:
            _check(checks, "CURRENT_PIPELINE_HYPERDRIVE_ID_UNDECLARED", "ERROR", None)


    failures = [item for item in checks if item["status"] in {"FAIL", "BLOCKED"}]
    errors = [item for item in checks if item["status"] == "ERROR"]
    status = "error" if errors else "blocked" if failures else "ready"
    return {
        "status": status,
        "source_project_ref": source_ref,
        "target_project_ref": None,
        "repo": {
            "immi_root": str(immi_root),
            "immi_head": _git(immi_root, "rev-parse", "HEAD"),
            "bsmart_root": str(bsmart_root),
            "bsmart_head": _git(bsmart_root, "rev-parse", "HEAD"),
        },
        "checks": sorted(checks, key=lambda item: (item["code"], item["status"])),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--immi-root", default=str(_default_immi_root()))
    parser.add_argument("--bsmart-root", default=str(_default_bsmart_root()))
    parser.add_argument("--manifest", default=str(_default_bsmart_root() / "immi/SEPARATION-MANIFEST.md"))
    parser.add_argument("--source-ref", default=SOURCE_REF)
    parser.add_argument("--target-ref")
    parser.add_argument("--live", action="store_true", help="Read Cloudflare Hyperdrive metadata; never mutates it.")
    parser.add_argument("--json", action="store_true", help="Emit the deterministic JSON report (default).")
    parser.add_argument("--main-hyperdrive-id")
    parser.add_argument("--pipeline-hyperdrive-id")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = build_report(args)
    encoded = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0 if report["status"] == "ready" else 1 if report["status"] == "blocked" else 2


if __name__ == "__main__":
    raise SystemExit(main())
