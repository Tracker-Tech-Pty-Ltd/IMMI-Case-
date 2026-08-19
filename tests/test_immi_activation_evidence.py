from __future__ import annotations

import json

from scripts.check_immi_activation_evidence import (
    ActivationEvidenceError,
    _config_digest,
    inspect,
    main as activation_main,
)


def _benchmark() -> dict:
    queries = []
    rankings = {}
    for index in range(50):
        query_id = f"q-{index:02d}"
        case_id = f"{index:012x}"[-12:]
        queries.append({
            "id": query_id,
            "query": f"query {index}",
            "relevant_case_ids": [case_id],
            "facets": {
                "court": ["FCA", "AAT"][index % 2],
                "year": 2023 + index % 2,
                "outcome": ["allowed", "refused"][index % 2],
                "visa_type": ["Protection", "Family"][index % 2],
                "keyword": ["fairness", "natural justice"][index % 2],
                "scenario": ["lexical", "related-case"][index % 2],
            },
        })
        rankings[query_id] = [case_id]
    return {
        "queries": queries,
        "systems": {
            "lexical": {"legacy_rankings": rankings, "cloudflare_rankings": rankings},
            "semantic": {"legacy_rankings": rankings, "cloudflare_rankings": rankings},
        },
    }


def _performance() -> dict:
    return {
        "required_endpoints": ["GET /api/v1/cases"],
        "measurements": [{
            "endpoint": "GET /api/v1/cases",
            "baseline_p50_ms": 20,
            "baseline_p95_ms": 500,
            "cloudflare_p50_ms": 25,
            "cloudflare_p95_ms": 550,
            "sample_count": 3000,
            "ai": False,
        }],
    }


def _evidence() -> dict:
    return {
        "workers_paid_approved": True,
        "privacy_app8_approved": True,
        "release": {
            "git_sha": "0123456789abcdef0123456789abcdef01234567",
            "main_worker_version_id": "main-version-20260810-01",
            "pipeline_worker_version_id": "pipeline-version-20260810-01",
            "config_digest": "sha256:" + "a" * 64,
            "legacy_runtime_disabled": True,
        },
        "legacy_reference_scan": {
            "ok": True,
            "scope": "deployed-runtime-config-ci",
            "supabase": 0,
            "postgres": 0,
            "pgvector": 0,
            "hyperdrive": 0,
        },
        "d1_resources": {
            "source": "cloudflare-api+creation-record",
            "account_id": "a" * 32,
            "observed_at": "2026-08-10T00:00:00Z",
            "databases": {
                binding: {
                    "database_id": uuid,
                    "location_hint": "oc",
                    "read_replication": {"mode": "disabled"},
                }
                for binding, uuid in {
                    "IMMI_CATALOG_DB": "11111111-1111-4111-8111-111111111111",
                    "IMMI_ACCOUNT_DB": "22222222-2222-4222-8222-222222222222",
                    "IMMI_OPS_DB": "33333333-3333-4333-8333-333333333333",
                }.items()
            },
        },
        "object_resources": {
            "source": "cloudflare-api",
            "account_id": "a" * 32,
            "observed_at": "2026-08-10T00:00:00Z",
            "r2": {
                "IMMI_CONTENT": {
                    "bucket_name": "immi-content-production",
                    "versioning_enabled": True,
                    "lifecycle_retention_days": 90,
                },
            },
            "vectorize": {
                "CASE_VECTORS": {
                    "index_name": "case-vectors-production",
                    "model": "@cf/qwen/qwen3-embedding-0.6b",
                    "dimensions": 1024,
                    "metric": "cosine",
                    "ready": True,
                    "metadata_indexes": [
                        {"property_name": "court_code", "type": "string"},
                        {"property_name": "year", "type": "number"},
                        {"property_name": "source", "type": "string"},
                        {"property_name": "visa_subclass", "type": "string"},
                    ],
                },
            },
        },
        "catalog_capacity": {
            "ok": True,
            "logical_bytes": 4 * 1024 * 1024 * 1024,
            "physical_bytes": 4 * 1024 * 1024 * 1024,
            "max_materialized_row_bytes": 128 * 1024,
            "headroom_percent": 50,
        },
        "snapshot": {"repeatable_read": True, "source_checksum_manifest": True},
        "reconciliation": {
            "ok": True,
            "missing": 0,
            "extra": 0,
            "orphan": 0,
            "checksum_mismatch": 0,
            "source_manifest_mismatch": [],
            "relation_missing": [],
            "relation_extra": [],
            "vector_missing": [],
            "vector_extra": [],
        },
        "vectorize": {"ok": True, "model": "@cf/qwen/qwen3-embedding-0.6b", "dimensions": 1024, "metric": "cosine"},
        "routes": {"all_public_contracts_passed": True, "unported_routes_remaining": []},
        "contract_fixtures": {
            "ok": True,
            "source": "staging-capture",
            "route_count": 72,
            "manifest_sha256": "b" * 64,
            "status_codes": [200, 400, 401, 403, 404, 429, 503],
        },
        "tenant_isolation": {
            "ok": True,
            "attack_matrix": [
                {"name": name, "attempts": 3, "denied": 3, "bypasses": 0}
                for name in (
                    "cross_tenant_read",
                    "cross_tenant_write",
                    "cross_tenant_list",
                    "cross_tenant_retrieve_code",
                    "cross_tenant_council",
                    "cross_tenant_collection",
                    "cross_tenant_refresh_session",
                )
            ],
        },
        "pipeline": {
            "outbox_replay_safe": True,
            "event_id_idempotent": True,
            "write_order_r2_catalog_vectorize_ops": True,
            "dlq_consumers_verified": True,
            "container_has_no_database_credentials": True,
        },
        "object_reconciliation": {
            "ok": True,
            "object_count": 149016,
            "manifest_sha256": "c" * 64,
            "missing": 0,
            "extra": 0,
            "orphan": 0,
            "checksum_mismatch": 0,
        },
        "search_benchmark": _benchmark(),
        "performance": _performance(),
        "shadow": {"ok": True, "duration_hours": 24, "complete_reconciliations": 2, "p0": 0, "p1": 0},
        "rollback": {
            "ok": True,
            "cloudflare_code_seconds": 60,
            "d1_to_legacy_replay_seconds": 600,
            "cloudflare_code_rehearsal": True,
            "d1_to_legacy_rehearsal": True,
            "legacy_restore_verified": True,
            "journal_replay_verified": True,
        },
        "cutover": {
            "ok": True,
            "freeze_duration_minutes": 42,
            "writes_rejected_during_freeze": True,
            "queues_drained": True,
            "final_journal_applied": True,
            "reconciliation_completed": True,
            "blue_green_switch_completed": True,
            "authenticated_writes_single_backend": True,
        },
        "soak": {"ok": True, "duration_hours": 24, "p0": 0, "p1": 0, "five_xx_rate": 0.0005, "dlq_messages": 0, "queue_lag_seconds": 30},
    }


def test_activation_evidence_requires_every_gate() -> None:
    report = inspect(_evidence())
    assert report["ok"]
    assert report["search_benchmark"]["ok"]
    assert report["performance"]["ok"]


def test_activation_evidence_blocks_unported_routes_and_slow_rollback() -> None:
    bad = _evidence()
    bad["routes"]["unported_routes_remaining"] = ["POST /api/v1/cases"]
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "unported" in str(exc)
    else:
        raise AssertionError("expected unported route to block activation")

    bad = _evidence()
    bad["rollback"]["d1_to_legacy_replay_seconds"] = 901
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "rollback" in str(exc)
    else:
        raise AssertionError("expected slow rollback to block activation")


def test_activation_evidence_requires_immutable_release_identity() -> None:
    bad = _evidence()
    del bad["release"]["main_worker_version_id"]
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "main_worker_version_id" in str(exc)
    else:
        raise AssertionError("expected missing Worker version identity to block activation")

    bad = _evidence()
    bad["release"]["git_sha"] = "working-tree"
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "40-character commit SHA" in str(exc)
    else:
        raise AssertionError("expected non-immutable git identity to block activation")


def test_activation_evidence_binds_packet_to_supplied_native_configs(tmp_path) -> None:
    main_config = tmp_path / "main.toml"
    pipeline_config = tmp_path / "pipeline.toml"
    evidence = _evidence()
    main_config.write_text(
        '\n'.join([
            'name = "main"',
            '[[d1_databases]]', 'binding = "IMMI_CATALOG_DB"', 'database_id = "11111111-1111-4111-8111-111111111111"',
            '[[d1_databases]]', 'binding = "IMMI_ACCOUNT_DB"', 'database_id = "22222222-2222-4222-8222-222222222222"',
            '[[d1_databases]]', 'binding = "IMMI_OPS_DB"', 'database_id = "33333333-3333-4333-8333-333333333333"',
            '[[r2_buckets]]', 'binding = "IMMI_CONTENT"', 'bucket_name = "immi-content-production"',
            '[[vectorize]]', 'binding = "CASE_VECTORS"', 'index_name = "case-vectors-production"',
            '',
        ]), encoding="utf-8")
    pipeline_config.write_text(
        '\n'.join([
            'name = "pipeline"',
            '[[d1_databases]]', 'binding = "IMMI_CATALOG_DB"', 'database_id = "11111111-1111-4111-8111-111111111111"',
            '[[d1_databases]]', 'binding = "IMMI_OPS_DB"', 'database_id = "33333333-3333-4333-8333-333333333333"',
            '[[r2_buckets]]', 'binding = "CASE_RESULTS"', 'bucket_name = "immi-content-production"',
            '',
        ]), encoding="utf-8")
    evidence["release"]["config_digest"] = _config_digest(main_config, pipeline_config)
    evidence_path = tmp_path / "evidence.json"
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
    pipeline_source = pipeline_config.read_text(encoding="utf-8")

    assert activation_main([
        str(evidence_path),
        "--main-config",
        str(main_config),
        "--pipeline-config",
        str(pipeline_config),
    ]) == 0

    pipeline_config.write_text('name = "tampered"\n', encoding="utf-8")
    assert activation_main([
        str(evidence_path),
        "--main-config",
        str(main_config),
        "--pipeline-config",
        str(pipeline_config),
    ]) == 2

    pipeline_config.write_text(pipeline_source, encoding="utf-8")
    main_config.write_text(main_config.read_text(encoding="utf-8").replace("case-vectors-production", "wrong-index"), encoding="utf-8")
    evidence["release"]["config_digest"] = _config_digest(main_config, pipeline_config)
    evidence_path.write_text(json.dumps(evidence), encoding="utf-8")
    assert activation_main([
        str(evidence_path),
        "--main-config",
        str(main_config),
        "--pipeline-config",
        str(pipeline_config),
    ]) == 2


def test_activation_evidence_requires_zero_effective_legacy_references() -> None:
    bad = _evidence()
    bad["legacy_reference_scan"]["hyperdrive"] = 1
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "hyperdrive" in str(exc)
    else:
        raise AssertionError("expected effective Hyperdrive reference to block activation")


def test_activation_evidence_requires_contract_isolation_pipeline_and_cutover_proof() -> None:
    bad = _evidence()
    del bad["contract_fixtures"]
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "contract_fixtures" in str(exc)
    else:
        raise AssertionError("expected missing contract fixtures to block activation")

    bad = _evidence()
    bad["tenant_isolation"]["attack_matrix"][0]["bypasses"] = 1
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "tenant_isolation" in str(exc)
    else:
        raise AssertionError("expected a cross-tenant bypass to block activation")

    bad = _evidence()
    bad["cutover"]["freeze_duration_minutes"] = 60.1
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "freeze_duration" in str(exc)
    else:
        raise AssertionError("expected an overlong freeze to block activation")


def test_activation_evidence_requires_relation_and_vector_reconciliation() -> None:
    bad = _evidence()
    bad["reconciliation"]["relation_missing"] = ["case_judges:case-1:judge-1"]
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "relation_missing" in str(exc)
    else:
        raise AssertionError("expected a missing relation to block activation")

    bad = _evidence()
    bad["reconciliation"]["vector_extra"] = ["case-999"]
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "vector_extra" in str(exc)
    else:
        raise AssertionError("expected an extra Vectorize id to block activation")


def test_activation_evidence_requires_d1_location_and_replication_proof() -> None:
    bad = _evidence()
    bad["d1_resources"]["databases"]["IMMI_CATALOG_DB"]["location_hint"] = "apac"
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "location_hint" in str(exc)
    else:
        raise AssertionError("expected non-Oceania D1 location to block activation")

    bad = _evidence()
    bad["d1_resources"]["databases"]["IMMI_OPS_DB"]["read_replication"] = {"mode": "auto"}
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "read_replication" in str(exc)
    else:
        raise AssertionError("expected read replication to block activation")


def test_activation_evidence_requires_r2_retention_and_ready_vectorize() -> None:
    bad = _evidence()
    bad["object_resources"]["r2"]["IMMI_CONTENT"]["lifecycle_retention_days"] = 30
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "lifecycle_retention_days" in str(exc)
    else:
        raise AssertionError("expected short R2 retention to block activation")

    bad = _evidence()
    bad["object_resources"]["vectorize"]["CASE_VECTORS"]["ready"] = False
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "ready" in str(exc)
    else:
        raise AssertionError("expected an unready Vectorize index to block activation")

    bad = _evidence()
    bad["object_resources"]["vectorize"]["CASE_VECTORS"]["metadata_indexes"].append(
        {"property_name": "outcome", "type": "string"}
    )
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "metadata_indexes" in str(exc)
    else:
        raise AssertionError("expected an undeclared Vectorize metadata index to block activation")


def test_activation_evidence_requires_catalog_capacity_headroom() -> None:
    bad = _evidence()
    bad["catalog_capacity"]["headroom_percent"] = 19.9
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "headroom" in str(exc)
    else:
        raise AssertionError("expected insufficient catalog headroom to block activation")

    bad = _evidence()
    bad["catalog_capacity"]["max_materialized_row_bytes"] = 256 * 1024 + 1
    try:
        inspect(bad)
    except ActivationEvidenceError as exc:
        assert "largest row" in str(exc)
    else:
        raise AssertionError("expected oversized catalog row to block activation")
