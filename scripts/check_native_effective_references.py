#!/usr/bin/env python3
"""Fail-closed scan of the effective native runtime/config/CI boundary.

This is deliberately narrower than a repository-wide grep. Legacy adapters,
rollback tooling and historical documentation may remain in the checkout, but
the deployed native bundle, native pipeline source, effective Wrangler TOML
and deployment workflows must not contain an active Supabase/PostgreSQL/
pgvector/Hyperdrive reference.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - runner must be Python 3.11+
    tomllib = None  # type: ignore[assignment]


ROOT = Path(__file__).resolve().parents[1]
MARKERS = ("supabase", "postgres", "pgvector", "hyperdrive")
TEXT_PATTERNS = {
    "supabase": re.compile(r"\bSUPABASE(?:_[A-Z0-9]+)*\b|from\s+[\"']supabase[\"']", re.I),
    "postgres": re.compile(r"from\s+[\"']postgres[\"']|require\(\s*[\"']postgres[\"']\s*\)|\bpostgres\s*\(|\bpostgres(?:ql)?://", re.I),
    "pgvector": re.compile(r"\bpgvector\b|\bvector\s*\(\s*\d+\s*\)", re.I),
    "hyperdrive": re.compile(r"\bHYPERDRIVE(?:_[A-Z0-9]+)*\b|\bhyperdrive\b", re.I),
}


def _strip_comments(source: str, suffix: str) -> str:
    if suffix in {".js", ".mjs", ".ts", ".tsx"}:
        source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
        source = re.sub(r"//[^\n]*", "", source)
    elif suffix in {".yml", ".yaml", ".toml"}:
        source = "\n".join(line.split("#", 1)[0] for line in source.splitlines())
    return source


def _text_hits(source: str, suffix: str, location: str) -> list[dict[str, str]]:
    clean = _strip_comments(source, suffix)
    hits: list[dict[str, str]] = []
    for marker, pattern in TEXT_PATTERNS.items():
        for match in pattern.finditer(clean):
            line = clean.count("\n", 0, match.start()) + 1
            hits.append({"marker": marker, "location": f"{location}:{line}"})
    return hits


def _config_hits(value: Any, location: str) -> list[dict[str, str]]:
    hits: list[dict[str, str]] = []
    if isinstance(value, dict):
        for key, child in value.items():
            hits.extend(_config_hits(child, f"{location}.{key}"))
            hits.extend(_text_hits(str(key), "", f"{location}.{key}"))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            hits.extend(_config_hits(child, f"{location}[{index}]"))
    elif isinstance(value, str):
        hits.extend(_text_hits(value, "", location))
    return hits


def _read_toml(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    if tomllib is None:
        return None, "Python 3.11+ with tomllib is required"
    try:
        return tomllib.loads(path.read_text(encoding="utf-8")), None
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        return None, str(exc)


def _scan_config(path: Path) -> list[dict[str, str]]:
    config, error = _read_toml(path)
    if error or config is None:
        return [{"marker": "config", "location": f"{path}: {error or 'invalid TOML'}"}]
    return _config_hits(config, str(path))


def _scan_files(paths: list[Path]) -> list[dict[str, str]]:
    hits: list[dict[str, str]] = []
    for path in paths:
        try:
            hits.extend(_text_hits(path.read_text(encoding="utf-8"), path.suffix, str(path)))
        except OSError as exc:
            hits.append({"marker": "file", "location": f"{path}: {exc}"})
    return hits


def inspect(
    *,
    main_config: Path | None = None,
    pipeline_config: Path | None = None,
    root: Path = ROOT,
) -> dict[str, Any]:
    main_config = main_config or root / "wrangler.toml"
    pipeline_config = pipeline_config or root / "workers/austlii-scraper/wrangler.toml"
    runtime_files = [root / "workers/cloudflare-native.js"] + sorted(
        (root / "workers/austlii-scraper/src").glob("*.ts")
    )
    workflow_files = [root / ".github/workflows/ci.yml", root / ".github/workflows/deploy-worker.yml"]
    hits = _scan_files(runtime_files + workflow_files)
    hits.extend(_scan_config(main_config))
    hits.extend(_scan_config(pipeline_config))

    bundle = subprocess.run(
        ["node", str(root / "scripts/check_cloudflare_native_bundle.mjs")],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    if bundle.returncode != 0:
        hits.append({"marker": "bundle", "location": bundle.stderr.strip() or bundle.stdout.strip()})

    counts = {marker: sum(1 for hit in hits if hit["marker"] == marker) for marker in MARKERS}
    return {
        "ok": not hits,
        "scope": "deployed-runtime-config-ci",
        "markers": counts,
        "hits": hits,
        "bundle_ok": bundle.returncode == 0,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--main-config", type=Path)
    parser.add_argument("--pipeline-config", type=Path)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    report = inspect(main_config=args.main_config, pipeline_config=args.pipeline_config)
    if args.as_json:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    else:
        print("native effective-reference scan " + ("PASS" if report["ok"] else "BLOCKED"))
        print(json.dumps(report["markers"], sort_keys=True))
        for hit in report["hits"]:
            print(f"- {hit['marker']}: {hit['location']}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
