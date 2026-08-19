#!/usr/bin/env python3
"""Validate operator-supplied Cloudflare-native IMMI configs, fail closed.

This is a read-only gate. It does not create resources, write secrets, or
deploy a Worker. The checked-in ``*.example`` files intentionally fail until
an operator supplies real D1/R2/Vectorize/Queue identifiers outside source
control.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.10 fallback message
    tomllib = None  # type: ignore[assignment]


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MAIN = ROOT / "wrangler.toml"
DEFAULT_PIPELINE = ROOT / "workers/austlii-scraper/wrangler.toml"


def _read_config(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        return None, f"cannot read {path}: {exc}"
    if tomllib is None:
        return None, "Python 3.11+ with tomllib is required"
    try:
        return tomllib.loads(raw.decode("utf-8")), None
    except (UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        return None, f"invalid TOML in {path}: {exc}"


def _get(config: dict[str, Any], dotted: str) -> Any:
    value: Any = config
    for part in dotted.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def _binding(config: dict[str, Any], section: str, binding: str, field: str) -> Any:
    entries = config.get(section, [])
    if isinstance(entries, list):
        for entry in entries:
            if isinstance(entry, dict) and entry.get("binding") == binding:
                return entry.get(field)
    return None


def _entries(config: dict[str, Any], section: str) -> list[dict[str, Any]]:
    value = _get(config, section)
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    return [value] if isinstance(value, dict) else []


def _require_binding(errors: list[str], config: dict[str, Any], section: str, binding: str, label: str | None = None, field: str = "binding") -> None:
    if not any(item.get(field) == binding for item in _entries(config, section)):
        errors.append(f"{label or section} must declare binding {binding}")


def _require_queue(errors: list[str], config: dict[str, Any], queue_name: str, role: str, require_dlq: bool = True) -> None:
    consumers = [item for item in _entries(config, "queues.consumers") if item.get("queue") == queue_name]
    if not consumers:
        errors.append(f"{role} config must consume queue {queue_name}")
        return
    if require_dlq and not any(isinstance(item.get("dead_letter_queue"), str) and item.get("dead_letter_queue") for item in consumers):
        errors.append(f"{role} queue {queue_name} must declare a dead_letter_queue")


def _require_dlq_consumer(errors: list[str], config: dict[str, Any], queue_name: str, role: str) -> None:
    consumers = [item for item in _entries(config, "queues.consumers") if item.get("queue") == queue_name]
    if not consumers:
        errors.append(f"{role} config must consume dead-letter queue {queue_name}")


def _check_required(errors: list[str], config: dict[str, Any], path: str, expected: Any) -> None:
    actual = _get(config, path)
    if actual != expected:
        errors.append(f"{path} must equal {expected!r} (got {actual!r})")


def _check_not_placeholder(errors: list[str], config: dict[str, Any], path: str) -> None:
    value = _get(config, path)
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{path} is missing")
    elif "REPLACE_WITH_" in value or "replace" in value.lower() or value.startswith("<") or value == "00000000-0000-0000-0000-000000000000":
        errors.append(f"{path} still contains an operator placeholder")


def _check_no_legacy_keys(errors: list[str], config: dict[str, Any], role: str) -> None:
    # A parsed TOML tree avoids false positives from explanatory comments in
    # the non-deployable templates.
    forbidden = {"hyperdrive", "postgres", "supabase"}

    def walk(value: Any, prefix: str = "") -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                key_path = f"{prefix}.{key}" if prefix else key
                if key.lower() in forbidden or any(token in key.lower() for token in forbidden):
                    errors.append(f"{role} config contains forbidden legacy key {key_path}")
                walk(child, key_path)
        elif isinstance(value, str):
            lowered = value.lower()
            if any(token in lowered for token in forbidden):
                errors.append(f"{role} config contains forbidden legacy value at {prefix}")

    walk(config)


def _is_placeholder(value: Any) -> bool:
    return (
        not isinstance(value, str)
        or not value.strip()
        or "REPLACE_WITH_" in value
        or "replace" in value.lower()
        or value.startswith("<")
        or value.startswith("00000000-0000-0000-0000-00000000000")
    )


def _validate_main(path: Path, errors: list[str]) -> None:
    config, error = _read_config(path)
    if error:
        errors.append(error)
        return
    assert config is not None
    _check_required(errors, config, "name", "immi-case-standalone")
    _check_required(errors, config, "main", "workers/cloudflare-native.js")
    _check_required(errors, config, "vars.IMMI_STORAGE_MODE", "cloudflare")
    _check_required(errors, config, "vars.IMMI_CASE_MUTATIONS_ENABLED", "false")
    for binding in ("IMMI_CATALOG_DB", "IMMI_ACCOUNT_DB", "IMMI_OPS_DB"):
        value = _binding(config, "d1_databases", binding, "database_id")
        if _is_placeholder(value):
            errors.append(f"d1_databases[{binding}].database_id is missing or still a placeholder")
    value = _binding(config, "r2_buckets", "IMMI_CONTENT", "bucket_name")
    if _is_placeholder(value):
        errors.append("r2_buckets[IMMI_CONTENT].bucket_name is missing or still a placeholder")
    value = _binding(config, "vectorize", "CASE_VECTORS", "index_name")
    if _is_placeholder(value):
        errors.append("vectorize[CASE_VECTORS].index_name is missing or still a placeholder")
    _require_binding(errors, config, "ai", "AI", "main")
    for binding in ("AUTH_NONCE", "COUNCIL_SESSION"):
        _require_binding(errors, config, "durable_objects.bindings", binding, "main", field="name")
    _require_binding(errors, config, "queues.producers", "CASE_MUTATION_QUEUE", "main")
    _require_binding(errors, config, "queues.producers", "PIPELINE_CONTROL_QUEUE", "main")
    _require_queue(errors, config, "immi-case-mutation-queue", "main")
    _require_dlq_consumer(errors, config, "immi-case-mutation-dlq", "main")
    _check_no_legacy_keys(errors, config, "main")


def _validate_pipeline(path: Path, errors: list[str]) -> None:
    config, error = _read_config(path)
    if error:
        errors.append(error)
        return
    assert config is not None
    _check_required(errors, config, "name", "austlii-scraper-native")
    if _get(config, "main") not in {"workers/austlii-scraper/src/index.ts", "src/index.ts"}:
        errors.append(
            "main must point at the native scraper entry (workers/austlii-scraper/src/index.ts or src/index.ts)"
        )
    _check_required(errors, config, "vars.PIPELINE_ENABLED", "false")
    _check_required(errors, config, "vars.NATIVE_PIPELINE_ENABLED", "false")
    for binding in ("IMMI_CATALOG_DB", "IMMI_OPS_DB"):
        value = _binding(config, "d1_databases", binding, "database_id")
        if _is_placeholder(value):
            errors.append(f"d1_databases[{binding}].database_id is missing or still a placeholder")
    value = _binding(config, "r2_buckets", "CASE_RESULTS", "bucket_name")
    if _is_placeholder(value):
        errors.append("r2_buckets[CASE_RESULTS].bucket_name is missing or still a placeholder")
    value = _binding(config, "kv_namespaces", "PIPELINE_KV", "id")
    if _is_placeholder(value):
        errors.append("kv_namespaces[PIPELINE_KV].id is missing or still a placeholder")
    for binding in ("SCRAPE_QUEUE", "EXTRACT_QUEUE", "NATIVE_CASE_QUEUE"):
        _require_binding(errors, config, "queues.producers", binding, "pipeline")
    for queue_name in ("immi-pipeline-control-queue", "immi-scrape-queue", "immi-extract-queue"):
        _require_queue(errors, config, queue_name, "pipeline")
    for queue_name in ("immi-pipeline-control-dlq", "immi-scrape-dlq", "immi-extract-dlq"):
        _require_dlq_consumer(errors, config, queue_name, "pipeline")
    _require_binding(errors, config, "browser", "MYBROWSER", "pipeline")
    _require_binding(errors, config, "ai", "AI", "pipeline")
    services = _entries(config, "services")
    if not any(item.get("binding") == "EXTRACTION_BACKEND" and item.get("entrypoint") == "ExtractionBackend" for item in services):
        errors.append("pipeline config must declare EXTRACTION_BACKEND service with ExtractionBackend entrypoint")
    _check_no_legacy_keys(errors, config, "pipeline")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--main-config", type=Path, default=DEFAULT_MAIN)
    parser.add_argument("--pipeline-config", type=Path, default=DEFAULT_PIPELINE)
    args = parser.parse_args(argv)

    errors: list[str] = []
    _validate_main(args.main_config, errors)
    _validate_pipeline(args.pipeline_config, errors)
    main_config, main_error = _read_config(args.main_config)
    pipeline_config, pipeline_error = _read_config(args.pipeline_config)
    if not main_error and not pipeline_error and main_config is not None and pipeline_config is not None:
        main_bucket = _binding(main_config, "r2_buckets", "IMMI_CONTENT", "bucket_name")
        pipeline_bucket = _binding(pipeline_config, "r2_buckets", "CASE_RESULTS", "bucket_name")
        if main_bucket != pipeline_bucket:
            errors.append("main IMMI_CONTENT bucket and pipeline CASE_RESULTS bucket must match")
        main_catalog = _binding(main_config, "d1_databases", "IMMI_CATALOG_DB", "database_id")
        pipeline_catalog = _binding(pipeline_config, "d1_databases", "IMMI_CATALOG_DB", "database_id")
        if main_catalog != pipeline_catalog:
            errors.append("main and pipeline IMMI_CATALOG_DB IDs must match")
        main_ops = _binding(main_config, "d1_databases", "IMMI_OPS_DB", "database_id")
        pipeline_ops = _binding(pipeline_config, "d1_databases", "IMMI_OPS_DB", "database_id")
        if main_ops != pipeline_ops:
            errors.append("main and pipeline IMMI_OPS_DB IDs must match")
        main_case_queue = _binding(main_config, "queues.producers", "CASE_MUTATION_QUEUE", "queue")
        pipeline_case_queue = _binding(pipeline_config, "queues.producers", "NATIVE_CASE_QUEUE", "queue")
        if main_case_queue != pipeline_case_queue:
            errors.append("main CASE_MUTATION_QUEUE and pipeline NATIVE_CASE_QUEUE must match")
    if errors:
        print("Cloudflare-native IMMI deploy blocked:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(
        "Cloudflare-native IMMI config gate passed "
        f"(main={args.main_config}, pipeline={args.pipeline_config})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
