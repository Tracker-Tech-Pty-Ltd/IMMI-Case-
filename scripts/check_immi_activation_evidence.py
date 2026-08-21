#!/usr/bin/env python3
"""Fail-closed gate for evidence required before IMMI native activation."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.11+ is required by the gate
    tomllib = None  # type: ignore[assignment]

try:
    from scripts.check_cloudflare_performance import PerformanceError, inspect as inspect_performance
    from scripts.check_cloudflare_search_benchmark import BenchmarkError, inspect as inspect_benchmark
except ModuleNotFoundError:  # direct ``python scripts/check_...py`` invocation
    from check_cloudflare_performance import PerformanceError, inspect as inspect_performance
    from check_cloudflare_search_benchmark import BenchmarkError, inspect as inspect_benchmark


EXPECTED_EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b"
EXPECTED_EMBEDDING_DIMENSIONS = 1024
EXPECTED_EMBEDDING_METRIC = "cosine"
REQUIRED_D1_BINDINGS = ("IMMI_CATALOG_DB", "IMMI_ACCOUNT_DB", "IMMI_OPS_DB")
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
EXPECTED_VECTOR_METADATA_INDEXES = {
    "court_code": "string",
    "year": "number",
    "source": "string",
    "visa_subclass": "string",
}
CATALOG_MAX_DATABASE_BYTES = 8 * 1024**3
CATALOG_MAX_ROW_BYTES = 256 * 1024
REQUIRED_CONTRACT_STATUSES = {200, 400, 401, 403, 404, 429, 503}
REQUIRED_ISOLATION_CASES = {
    "cross_tenant_read",
    "cross_tenant_write",
    "cross_tenant_list",
    "cross_tenant_retrieve_code",
    "cross_tenant_council",
    "cross_tenant_collection",
    "cross_tenant_refresh_session",
}


class ActivationEvidenceError(ValueError):
    pass


def _object(payload: dict[str, Any], key: str) -> dict[str, Any]:
    value = payload.get(key)
    if not isinstance(value, dict):
        raise ActivationEvidenceError(f"{key} evidence is required")
    return value


def _boolean(value: Any, label: str) -> None:
    if value is not True:
        raise ActivationEvidenceError(f"{label} must be true")


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ActivationEvidenceError(f"{label} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise ActivationEvidenceError(f"{label} must be finite")
    return result


def _non_empty_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ActivationEvidenceError(f"{label} must be a non-empty string")
    return value.strip()


def _integer(value: Any, label: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ActivationEvidenceError(f"{label} must be an integer >= {minimum}")
    return value


def _release_identity(payload: dict[str, Any]) -> dict[str, str]:
    """Require immutable release identity for every activation evidence packet.

    Metrics alone are not sufficient evidence: the production measurements,
    route switch and rollback rehearsal must be attributable to the exact
    source SHA and both deployed Worker version IDs that are being activated.
    """

    release = _object(payload, "release")
    git_sha = _non_empty_string(release.get("git_sha"), "release.git_sha")
    if not re.fullmatch(r"[0-9a-fA-F]{40}", git_sha):
        raise ActivationEvidenceError("release.git_sha must be a 40-character commit SHA")
    main_version = _non_empty_string(
        release.get("main_worker_version_id"),
        "release.main_worker_version_id",
    )
    pipeline_version = _non_empty_string(
        release.get("pipeline_worker_version_id"),
        "release.pipeline_worker_version_id",
    )
    config_digest = _non_empty_string(release.get("config_digest"), "release.config_digest")
    if not re.fullmatch(r"sha256:[0-9a-fA-F]{64}", config_digest):
        raise ActivationEvidenceError("release.config_digest must be sha256:<64 hex characters>")
    if release.get("legacy_runtime_disabled") is not True:
        raise ActivationEvidenceError("release.legacy_runtime_disabled must be true")
    return {
        "git_sha": git_sha,
        "main_worker_version_id": main_version,
        "pipeline_worker_version_id": pipeline_version,
        "config_digest": config_digest,
    }


def _legacy_reference_scan(payload: dict[str, Any]) -> dict[str, Any]:
    """Require an evidence-backed zero effective legacy runtime reference."""

    scan = _object(payload, "legacy_reference_scan")
    _boolean(scan.get("ok"), "legacy_reference_scan.ok")
    scope = _non_empty_string(scan.get("scope"), "legacy_reference_scan.scope")
    if scope != "deployed-runtime-config-ci":
        raise ActivationEvidenceError(
            "legacy_reference_scan.scope must be deployed-runtime-config-ci"
        )
    for marker in ("supabase", "postgres", "pgvector", "hyperdrive"):
        _zero(scan.get(marker), f"legacy_reference_scan.{marker}")
    return {"scope": scope, **{marker: 0 for marker in ("supabase", "postgres", "pgvector", "hyperdrive")}}


def _d1_resources(payload: dict[str, Any]) -> dict[str, Any]:
    """Require creation and live inventory evidence for every production D1.

    Cloudflare exposes read-replication mode through the D1 API, while the
    ``oc`` location hint is supplied at creation time. Keeping both values in
    the immutable activation packet prevents a later cutover from silently
    substituting globally replicated or incorrectly located databases.
    """

    resources = _object(payload, "d1_resources")
    if resources.get("source") != "cloudflare-api+creation-record":
        raise ActivationEvidenceError(
            "d1_resources.source must be cloudflare-api+creation-record"
        )
    _non_empty_string(resources.get("account_id"), "d1_resources.account_id")
    _non_empty_string(resources.get("observed_at"), "d1_resources.observed_at")
    databases = resources.get("databases")
    if not isinstance(databases, dict):
        raise ActivationEvidenceError("d1_resources.databases evidence is required")
    for binding in REQUIRED_D1_BINDINGS:
        database = databases.get(binding)
        if not isinstance(database, dict):
            raise ActivationEvidenceError(f"d1_resources.databases.{binding} evidence is required")
        database_id = _non_empty_string(database.get("database_id"), f"d1_resources.databases.{binding}.database_id")
        if not UUID_RE.fullmatch(database_id):
            raise ActivationEvidenceError(f"d1_resources.databases.{binding}.database_id must be a real UUID")
        if database.get("location_hint") != "oc":
            raise ActivationEvidenceError(f"d1_resources.databases.{binding}.location_hint must be oc")
        replication = database.get("read_replication")
        if not isinstance(replication, dict) or replication.get("mode") != "disabled":
            raise ActivationEvidenceError(
                f"d1_resources.databases.{binding}.read_replication.mode must be disabled"
            )
    return {
        "source": resources["source"],
        "account_id": resources["account_id"],
        "observed_at": resources["observed_at"],
        "databases": {
            binding: {
                "database_id": databases[binding]["database_id"],
                "location_hint": "oc",
                "read_replication": {"mode": "disabled"},
            }
            for binding in REQUIRED_D1_BINDINGS
        },
    }


def _object_resources(payload: dict[str, Any]) -> dict[str, Any]:
    """Require live R2 and Vectorize resource evidence before activation."""

    resources = _object(payload, "object_resources")
    if resources.get("source") != "cloudflare-api":
        raise ActivationEvidenceError("object_resources.source must be cloudflare-api")
    _non_empty_string(resources.get("account_id"), "object_resources.account_id")
    _non_empty_string(resources.get("observed_at"), "object_resources.observed_at")

    r2 = resources.get("r2")
    if not isinstance(r2, dict) or not isinstance(r2.get("IMMI_CONTENT"), dict):
        raise ActivationEvidenceError("object_resources.r2.IMMI_CONTENT evidence is required")
    content = r2["IMMI_CONTENT"]
    _non_empty_string(content.get("bucket_name"), "object_resources.r2.IMMI_CONTENT.bucket_name")
    _boolean(content.get("versioning_enabled"), "object_resources.r2.IMMI_CONTENT.versioning_enabled")
    if _number(content.get("lifecycle_retention_days"), "object_resources.r2.IMMI_CONTENT.lifecycle_retention_days") < 90:
        raise ActivationEvidenceError(
            "object_resources.r2.IMMI_CONTENT.lifecycle_retention_days must be at least 90"
        )

    vectorize = resources.get("vectorize")
    if not isinstance(vectorize, dict) or not isinstance(vectorize.get("CASE_VECTORS"), dict):
        raise ActivationEvidenceError("object_resources.vectorize.CASE_VECTORS evidence is required")
    index = vectorize["CASE_VECTORS"]
    _non_empty_string(index.get("index_name"), "object_resources.vectorize.CASE_VECTORS.index_name")
    if index.get("model") != EXPECTED_EMBEDDING_MODEL:
        raise ActivationEvidenceError("object_resources.vectorize.CASE_VECTORS.model is invalid")
    if index.get("dimensions") != EXPECTED_EMBEDDING_DIMENSIONS:
        raise ActivationEvidenceError("object_resources.vectorize.CASE_VECTORS.dimensions must be 1024")
    if index.get("metric") != EXPECTED_EMBEDDING_METRIC:
        raise ActivationEvidenceError("object_resources.vectorize.CASE_VECTORS.metric must be cosine")
    if index.get("ready") is not True:
        raise ActivationEvidenceError("object_resources.vectorize.CASE_VECTORS.ready must be true")
    metadata_indexes = index.get("metadata_indexes")
    if not isinstance(metadata_indexes, list):
        raise ActivationEvidenceError("object_resources.vectorize.CASE_VECTORS.metadata_indexes is required")
    actual_indexes = {
        item.get("property_name"): item.get("type")
        for item in metadata_indexes
        if isinstance(item, dict)
    }
    if actual_indexes != EXPECTED_VECTOR_METADATA_INDEXES:
        raise ActivationEvidenceError(
            "object_resources.vectorize.CASE_VECTORS.metadata_indexes must contain only court_code/year/source/visa_subclass"
        )
    return {
        "source": resources["source"],
        "account_id": resources["account_id"],
        "observed_at": resources["observed_at"],
        "r2": {
            "IMMI_CONTENT": {
                "bucket_name": content["bucket_name"],
                "versioning_enabled": True,
                "lifecycle_retention_days": content["lifecycle_retention_days"],
            }
        },
        "vectorize": {
            "CASE_VECTORS": {
                "index_name": index["index_name"],
                "model": EXPECTED_EMBEDDING_MODEL,
                "dimensions": EXPECTED_EMBEDDING_DIMENSIONS,
                "metric": EXPECTED_EMBEDDING_METRIC,
                "ready": True,
                "metadata_indexes": [
                    {"property_name": property_name, "type": index_type}
                    for property_name, index_type in EXPECTED_VECTOR_METADATA_INDEXES.items()
                ],
            }
        },
    }


def _catalog_capacity(payload: dict[str, Any]) -> dict[str, Any]:
    """Require the transformed catalog capacity and row-size budget evidence."""

    capacity = _object(payload, "catalog_capacity")
    _boolean(capacity.get("ok"), "catalog_capacity.ok")
    logical = _number(capacity.get("logical_bytes"), "catalog_capacity.logical_bytes")
    physical = _number(capacity.get("physical_bytes"), "catalog_capacity.physical_bytes")
    max_row = _number(capacity.get("max_materialized_row_bytes"), "catalog_capacity.max_materialized_row_bytes")
    headroom = _number(capacity.get("headroom_percent"), "catalog_capacity.headroom_percent")
    if max(logical, physical) > CATALOG_MAX_DATABASE_BYTES:
        raise ActivationEvidenceError("catalog_capacity database size exceeds 8 GiB")
    if max_row > CATALOG_MAX_ROW_BYTES:
        raise ActivationEvidenceError("catalog_capacity largest row exceeds 256 KiB")
    if headroom < 20:
        raise ActivationEvidenceError("catalog_capacity.headroom_percent must be at least 20")
    return {
        "ok": True,
        "logical_bytes": logical,
        "physical_bytes": physical,
        "max_materialized_row_bytes": max_row,
        "headroom_percent": headroom,
    }


def _contract_fixtures(payload: dict[str, Any]) -> dict[str, Any]:
    """Require captured public API response-contract evidence."""

    fixtures = _object(payload, "contract_fixtures")
    _boolean(fixtures.get("ok"), "contract_fixtures.ok")
    _non_empty_string(fixtures.get("source"), "contract_fixtures.source")
    _integer(fixtures.get("route_count"), "contract_fixtures.route_count", minimum=1)
    _non_empty_string(fixtures.get("manifest_sha256"), "contract_fixtures.manifest_sha256")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", fixtures["manifest_sha256"]):
        raise ActivationEvidenceError("contract_fixtures.manifest_sha256 must be 64 hexadecimal characters")
    statuses = fixtures.get("status_codes")
    if not isinstance(statuses, list) or any(isinstance(code, bool) or not isinstance(code, int) for code in statuses):
        raise ActivationEvidenceError("contract_fixtures.status_codes must be a list of HTTP status codes")
    if not REQUIRED_CONTRACT_STATUSES.issubset(set(statuses)):
        raise ActivationEvidenceError(
            "contract_fixtures.status_codes must cover success, validation, 401, 403, 404, 429 and 503"
        )
    return {
        "ok": True,
        "source": fixtures["source"],
        "route_count": fixtures["route_count"],
        "manifest_sha256": fixtures["manifest_sha256"],
        "status_codes": sorted(set(statuses)),
    }


def _tenant_isolation(payload: dict[str, Any]) -> dict[str, Any]:
    """Require a denied cross-tenant attack matrix, not a boolean assertion."""

    evidence = _object(payload, "tenant_isolation")
    _boolean(evidence.get("ok"), "tenant_isolation.ok")
    cases = evidence.get("attack_matrix")
    if not isinstance(cases, list):
        raise ActivationEvidenceError("tenant_isolation.attack_matrix is required")
    by_name: dict[str, dict[str, Any]] = {}
    for index, case in enumerate(cases, 1):
        if not isinstance(case, dict):
            raise ActivationEvidenceError(f"tenant_isolation.attack_matrix[{index}] must be an object")
        name = _non_empty_string(case.get("name"), f"tenant_isolation.attack_matrix[{index}].name")
        if name in by_name:
            raise ActivationEvidenceError(f"tenant_isolation.attack_matrix.{name} must be unique")
        attempts = _integer(case.get("attempts"), f"tenant_isolation.{name}.attempts", minimum=1)
        denied = _integer(case.get("denied"), f"tenant_isolation.{name}.denied")
        bypasses = _integer(case.get("bypasses"), f"tenant_isolation.{name}.bypasses")
        if denied != attempts or bypasses != 0:
            raise ActivationEvidenceError(f"tenant_isolation.{name} did not deny every attempted attack")
        by_name[name] = {"attempts": attempts, "denied": denied, "bypasses": bypasses}
    if set(by_name) != REQUIRED_ISOLATION_CASES:
        raise ActivationEvidenceError(
            "tenant_isolation.attack_matrix must cover read/write/list/retrieve-code/Council/collection/refresh-session"
        )
    return {"ok": True, "attack_matrix": [{"name": name, **by_name[name]} for name in sorted(by_name)]}


def _pipeline_evidence(payload: dict[str, Any]) -> dict[str, Any]:
    """Require idempotent outbox, ordered writes and explicit DLQ proof."""

    pipeline = _object(payload, "pipeline")
    for field in (
        "outbox_replay_safe",
        "event_id_idempotent",
        "write_order_r2_catalog_vectorize_ops",
        "dlq_consumers_verified",
        "container_has_no_database_credentials",
    ):
        _boolean(pipeline.get(field), f"pipeline.{field}")
    return {"ok": True, **{field: True for field in (
        "outbox_replay_safe",
        "event_id_idempotent",
        "write_order_r2_catalog_vectorize_ops",
        "dlq_consumers_verified",
        "container_has_no_database_credentials",
    )}}


def _object_reconciliation(payload: dict[str, Any]) -> dict[str, Any]:
    """Require a separate R2 manifest reconciliation in addition to row IDs."""

    evidence = _object(payload, "object_reconciliation")
    _boolean(evidence.get("ok"), "object_reconciliation.ok")
    _integer(evidence.get("object_count"), "object_reconciliation.object_count")
    _non_empty_string(evidence.get("manifest_sha256"), "object_reconciliation.manifest_sha256")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", evidence["manifest_sha256"]):
        raise ActivationEvidenceError("object_reconciliation.manifest_sha256 must be 64 hexadecimal characters")
    for field in ("missing", "extra", "orphan", "checksum_mismatch"):
        _zero(evidence.get(field), f"object_reconciliation.{field}")
    return {
        "ok": True,
        "object_count": evidence["object_count"],
        "manifest_sha256": evidence["manifest_sha256"],
        **{field: 0 for field in ("missing", "extra", "orphan", "checksum_mismatch")},
    }


def _cutover(payload: dict[str, Any]) -> dict[str, Any]:
    """Require explicit blue/green and bounded final-freeze evidence."""

    cutover = _object(payload, "cutover")
    _boolean(cutover.get("ok"), "cutover.ok")
    freeze_minutes = _number(cutover.get("freeze_duration_minutes"), "cutover.freeze_duration_minutes")
    if freeze_minutes > 60:
        raise ActivationEvidenceError("cutover.freeze_duration_minutes must be at most 60")
    for field in (
        "writes_rejected_during_freeze",
        "queues_drained",
        "final_journal_applied",
        "reconciliation_completed",
        "blue_green_switch_completed",
        "authenticated_writes_single_backend",
    ):
        _boolean(cutover.get(field), f"cutover.{field}")
    return {
        "ok": True,
        "freeze_duration_minutes": freeze_minutes,
        **{field: True for field in (
            "writes_rejected_during_freeze",
            "queues_drained",
            "final_journal_applied",
            "reconciliation_completed",
            "blue_green_switch_completed",
            "authenticated_writes_single_backend",
        )},
    }


def _config_digest(main_config: Path, pipeline_config: Path) -> str:
    """Return the deterministic digest recorded in the activation packet."""

    digest = hashlib.sha256()
    for label, path in ((b"main", main_config), (b"pipeline", pipeline_config)):
        digest.update(label)
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return f"sha256:{digest.hexdigest()}"


def _toml_binding(config: dict[str, Any], section: str, binding: str, field: str) -> Any:
    entries = config.get(section, [])
    if not isinstance(entries, list):
        return None
    for entry in entries:
        if isinstance(entry, dict) and entry.get("binding") == binding:
            return entry.get(field)
    return None


def _validate_config_binding_identity(
    payload: dict[str, Any], main_config: dict[str, Any], pipeline_config: dict[str, Any]
) -> None:
    """Ensure resource evidence describes the exact operator configs tested."""

    d1 = _object(payload, "d1_resources")["databases"]
    objects = _object(payload, "object_resources")
    main_d1 = {
        binding: _toml_binding(main_config, "d1_databases", binding, "database_id")
        for binding in ("IMMI_CATALOG_DB", "IMMI_ACCOUNT_DB", "IMMI_OPS_DB")
    }
    for binding, configured in main_d1.items():
        if configured != d1[binding]["database_id"]:
            raise ActivationEvidenceError(
                f"{binding} evidence does not match the operator main config"
            )
    for binding in ("IMMI_CATALOG_DB", "IMMI_OPS_DB"):
        configured = _toml_binding(pipeline_config, "d1_databases", binding, "database_id")
        if configured != d1[binding]["database_id"]:
            raise ActivationEvidenceError(
                f"pipeline {binding} evidence does not match the operator config"
            )
    main_bucket = _toml_binding(main_config, "r2_buckets", "IMMI_CONTENT", "bucket_name")
    pipeline_bucket = _toml_binding(pipeline_config, "r2_buckets", "CASE_RESULTS", "bucket_name")
    evidence_bucket = objects["r2"]["IMMI_CONTENT"]["bucket_name"]
    if main_bucket != evidence_bucket or pipeline_bucket != evidence_bucket:
        raise ActivationEvidenceError("R2 bucket evidence does not match both operator configs")
    vector_index = _toml_binding(main_config, "vectorize", "CASE_VECTORS", "index_name")
    evidence_index = objects["vectorize"]["CASE_VECTORS"]["index_name"]
    if vector_index != evidence_index:
        raise ActivationEvidenceError("Vectorize index evidence does not match the operator config")


def _zero(value: Any, label: str) -> None:
    if _number(value, label) != 0:
        raise ActivationEvidenceError(f"{label} must equal zero")


def _zero_collection(value: Any, label: str) -> None:
    """Accept either a numeric zero or the empty list emitted by reconciliation."""

    if isinstance(value, list):
        if value:
            raise ActivationEvidenceError(f"{label} must be empty")
        return
    _zero(value, label)


def inspect(payload: dict[str, Any]) -> dict[str, Any]:
    for approval in ("workers_paid_approved", "privacy_app8_approved"):
        _boolean(payload.get(approval), approval)

    release = _release_identity(payload)
    legacy_scan = _legacy_reference_scan(payload)
    d1_resources = _d1_resources(payload)
    object_resources = _object_resources(payload)
    catalog_capacity = _catalog_capacity(payload)
    contract_fixtures = _contract_fixtures(payload)
    tenant_isolation = _tenant_isolation(payload)
    pipeline = _pipeline_evidence(payload)
    object_reconciliation = _object_reconciliation(payload)
    cutover = _cutover(payload)

    snapshot = _object(payload, "snapshot")
    _boolean(snapshot.get("repeatable_read"), "snapshot.repeatable_read")
    _boolean(snapshot.get("source_checksum_manifest"), "snapshot.source_checksum_manifest")

    reconciliation = _object(payload, "reconciliation")
    _boolean(reconciliation.get("ok"), "reconciliation.ok")
    for field in (
        "missing",
        "extra",
        "orphan",
        "checksum_mismatch",
        "source_manifest_mismatch",
        "relation_missing",
        "relation_extra",
        "vector_missing",
        "vector_extra",
    ):
        _zero_collection(reconciliation.get(field), f"reconciliation.{field}")

    vectorize = _object(payload, "vectorize")
    _boolean(vectorize.get("ok"), "vectorize.ok")
    if vectorize.get("model") != EXPECTED_EMBEDDING_MODEL:
        raise ActivationEvidenceError("vectorize.model does not match the fixed Cloudflare model")
    if vectorize.get("dimensions") != EXPECTED_EMBEDDING_DIMENSIONS:
        raise ActivationEvidenceError("vectorize.dimensions must be 1024")
    if vectorize.get("metric") != EXPECTED_EMBEDDING_METRIC:
        raise ActivationEvidenceError("vectorize.metric must be cosine")

    routes = _object(payload, "routes")
    _boolean(routes.get("all_public_contracts_passed"), "routes.all_public_contracts_passed")
    remaining = routes.get("unported_routes_remaining")
    if not isinstance(remaining, list) or remaining:
        raise ActivationEvidenceError("routes.unported_routes_remaining must be an empty list")

    try:
        benchmark = inspect_benchmark(_object(payload, "search_benchmark"))
    except (BenchmarkError, KeyError) as exc:
        raise ActivationEvidenceError(f"search_benchmark blocked: {exc}") from exc
    if not benchmark["ok"]:
        raise ActivationEvidenceError("search_benchmark quality thresholds did not pass")

    try:
        performance = inspect_performance(_object(payload, "performance"))
    except (PerformanceError, KeyError) as exc:
        raise ActivationEvidenceError(f"performance blocked: {exc}") from exc
    if not performance["ok"]:
        raise ActivationEvidenceError("performance p95 thresholds did not pass")

    shadow = _object(payload, "shadow")
    _boolean(shadow.get("ok"), "shadow.ok")
    if _number(shadow.get("duration_hours"), "shadow.duration_hours") < 24:
        raise ActivationEvidenceError("shadow.duration_hours must be at least 24")
    if _number(shadow.get("complete_reconciliations"), "shadow.complete_reconciliations") < 2:
        raise ActivationEvidenceError("shadow.complete_reconciliations must be at least 2")
    _zero(shadow.get("p0"), "shadow.p0")
    _zero(shadow.get("p1"), "shadow.p1")

    rollback = _object(payload, "rollback")
    _boolean(rollback.get("ok"), "rollback.ok")
    for field in ("cloudflare_code_seconds", "d1_to_legacy_replay_seconds"):
        if _number(rollback.get(field), f"rollback.{field}") > 900:
            raise ActivationEvidenceError(f"rollback.{field} must be at most 900 seconds")
    for field in (
        "cloudflare_code_rehearsal",
        "d1_to_legacy_rehearsal",
        "legacy_restore_verified",
        "journal_replay_verified",
    ):
        _boolean(rollback.get(field), f"rollback.{field}")

    soak = _object(payload, "soak")
    _boolean(soak.get("ok"), "soak.ok")
    if _number(soak.get("duration_hours"), "soak.duration_hours") < 24:
        raise ActivationEvidenceError("soak.duration_hours must be at least 24")
    _zero(soak.get("p0"), "soak.p0")
    _zero(soak.get("p1"), "soak.p1")
    if _number(soak.get("five_xx_rate"), "soak.five_xx_rate") >= 0.001:
        raise ActivationEvidenceError("soak.five_xx_rate must be below 0.001")
    _zero(soak.get("dlq_messages"), "soak.dlq_messages")
    if _number(soak.get("queue_lag_seconds"), "soak.queue_lag_seconds") >= 60:
        raise ActivationEvidenceError("soak.queue_lag_seconds must be below 60 seconds")

    return {
        "ok": True,
        "release": release,
        "legacy_reference_scan": legacy_scan,
        "d1_resources": d1_resources,
        "object_resources": object_resources,
        "catalog_capacity": catalog_capacity,
        "contract_fixtures": contract_fixtures,
        "tenant_isolation": tenant_isolation,
        "pipeline": pipeline,
        "object_reconciliation": object_reconciliation,
        "cutover": cutover,
        "search_benchmark": benchmark,
        "performance": performance,
        "rollback": {
            "cloudflare_code_seconds": rollback["cloudflare_code_seconds"],
            "d1_to_legacy_replay_seconds": rollback["d1_to_legacy_replay_seconds"],
            "cloudflare_code_rehearsal": True,
            "d1_to_legacy_rehearsal": True,
            "legacy_restore_verified": True,
            "journal_replay_verified": True,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    parser.add_argument("--main-config", type=Path)
    parser.add_argument("--pipeline-config", type=Path)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args(argv)
    try:
        payload = json.loads(args.evidence.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ActivationEvidenceError("evidence root must be an object")
        report = inspect(payload)
        if (args.main_config is None) != (args.pipeline_config is None):
            raise ActivationEvidenceError(
                "--main-config and --pipeline-config must be supplied together"
            )
        if args.main_config is not None and args.pipeline_config is not None:
            expected = report["release"]["config_digest"]
            actual = _config_digest(args.main_config, args.pipeline_config)
            if expected != actual:
                raise ActivationEvidenceError(
                    "release.config_digest does not match the supplied native configs"
                )
            if tomllib is None:
                raise ActivationEvidenceError("Python 3.11+ with tomllib is required")
            main_config = tomllib.loads(args.main_config.read_text(encoding="utf-8"))
            pipeline_config = tomllib.loads(args.pipeline_config.read_text(encoding="utf-8"))
            _validate_config_binding_identity(report, main_config, pipeline_config)
    except (OSError, json.JSONDecodeError, ActivationEvidenceError, tomllib.TOMLDecodeError if tomllib else ValueError) as exc:
        print(f"IMMI native activation blocked: {exc}", file=sys.stderr)
        return 2
    if args.as_json:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    else:
        print("IMMI native activation evidence PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
