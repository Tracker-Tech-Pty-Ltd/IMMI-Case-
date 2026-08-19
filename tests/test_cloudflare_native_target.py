"""Contract tests for the operator-only Cloudflare-native config gate."""

from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "check_cloudflare_native_target",
    ROOT / "scripts/check_cloudflare_native_target.py",
)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def _valid_main() -> str:
    return '''
name = "immi-case-standalone"
main = "workers/cloudflare-native.js"
[vars]
IMMI_STORAGE_MODE = "cloudflare"
IMMI_CASE_MUTATIONS_ENABLED = "false"
[[d1_databases]]
binding = "IMMI_CATALOG_DB"
database_id = "catalog-id"
[[d1_databases]]
binding = "IMMI_ACCOUNT_DB"
database_id = "account-id"
[[d1_databases]]
binding = "IMMI_OPS_DB"
database_id = "ops-id"
[[r2_buckets]]
binding = "IMMI_CONTENT"
bucket_name = "content-bucket"
[[vectorize]]
binding = "CASE_VECTORS"
index_name = "case-vectors"
[[ai]]
binding = "AI"
[[durable_objects.bindings]]
name = "AUTH_NONCE"
class_name = "AuthNonce"
[[durable_objects.bindings]]
name = "COUNCIL_SESSION"
class_name = "CouncilSessionDO"
[[queues.producers]]
binding = "CASE_MUTATION_QUEUE"
queue = "immi-case-mutation-queue"
[[queues.producers]]
binding = "PIPELINE_CONTROL_QUEUE"
queue = "pipeline-control"
[[queues.consumers]]
queue = "immi-case-mutation-queue"
dead_letter_queue = "immi-case-mutation-dlq"
[[queues.consumers]]
queue = "immi-case-mutation-dlq"
'''


def _valid_pipeline() -> str:
    return '''
name = "austlii-scraper-native"
main = "workers/austlii-scraper/src/index.ts"
[vars]
PIPELINE_ENABLED = "false"
NATIVE_PIPELINE_ENABLED = "false"
[[d1_databases]]
binding = "IMMI_CATALOG_DB"
database_id = "catalog-id"
[[d1_databases]]
binding = "IMMI_OPS_DB"
database_id = "ops-id"
[[kv_namespaces]]
binding = "PIPELINE_KV"
id = "kv-id"
[[r2_buckets]]
binding = "CASE_RESULTS"
bucket_name = "content-bucket"
[browser]
binding = "MYBROWSER"
[[ai]]
binding = "AI"
[[queues.producers]]
binding = "SCRAPE_QUEUE"
queue = "scrape-queue"
[[queues.producers]]
binding = "EXTRACT_QUEUE"
queue = "extract-queue"
[[queues.producers]]
binding = "NATIVE_CASE_QUEUE"
queue = "native-case-queue"
[[queues.consumers]]
queue = "immi-pipeline-control-queue"
dead_letter_queue = "immi-pipeline-control-dlq"
[[queues.consumers]]
queue = "immi-pipeline-control-dlq"
[[queues.consumers]]
queue = "immi-scrape-queue"
dead_letter_queue = "immi-scrape-dlq"
[[queues.consumers]]
queue = "immi-scrape-dlq"
[[queues.consumers]]
queue = "immi-extract-queue"
dead_letter_queue = "immi-extract-dlq"
[[queues.consumers]]
queue = "immi-extract-dlq"
[[services]]
binding = "EXTRACTION_BACKEND"
entrypoint = "ExtractionBackend"
'''


def test_checked_in_examples_fail_closed_on_placeholders() -> None:
    assert MODULE.main([]) == 1


def test_operator_configs_pass_when_complete(tmp_path: Path, monkeypatch) -> None:
    main = tmp_path / "main.toml"
    pipeline = tmp_path / "pipeline.toml"
    main.write_text(_valid_main(), encoding="utf-8")
    pipeline.write_text(_valid_pipeline(), encoding="utf-8")
    monkeypatch.setattr(MODULE, "DEFAULT_MAIN", main)
    monkeypatch.setattr(MODULE, "DEFAULT_PIPELINE", pipeline)
    assert MODULE.main([]) == 0


def test_legacy_key_or_enabled_mutations_block(tmp_path: Path) -> None:
    main = tmp_path / "main.toml"
    pipeline = tmp_path / "pipeline.toml"
    main.write_text(
        _valid_main().replace(
            'IMMI_CASE_MUTATIONS_ENABLED = "false"',
            'IMMI_CASE_MUTATIONS_ENABLED = "true"',
        )
        + '\n[hyperdrive]\nid = "legacy"\n',
        encoding="utf-8",
    )
    pipeline.write_text(_valid_pipeline(), encoding="utf-8")
    errors: list[str] = []
    MODULE._validate_main(main, errors)
    assert any("IMMI_CASE_MUTATIONS_ENABLED" in error for error in errors)
    assert any("legacy key" in error for error in errors)


def test_operator_gate_requires_runtime_bindings_and_queue_dlq(tmp_path: Path) -> None:
    main = tmp_path / "main.toml"
    pipeline = tmp_path / "pipeline.toml"
    main.write_text(_valid_main().replace('name = "AUTH_NONCE"', 'name = "MISSING_NONCE"'), encoding="utf-8")
    pipeline.write_text(_valid_pipeline().replace('queue = "immi-extract-queue"\ndead_letter_queue = "immi-extract-dlq"', 'queue = "immi-extract-queue"'), encoding="utf-8")
    errors: list[str] = []
    MODULE._validate_main(main, errors)
    MODULE._validate_pipeline(pipeline, errors)
    assert any("AUTH_NONCE" in error for error in errors)
    assert any("dead_letter_queue" in error for error in errors)


def test_pipeline_gate_rejects_zero_uuid_resource_placeholders(tmp_path: Path) -> None:
    main = tmp_path / "main.toml"
    pipeline = tmp_path / "pipeline.toml"
    main.write_text(_valid_main(), encoding="utf-8")
    pipeline.write_text(
        _valid_pipeline().replace('id = "kv-id"', 'id = "00000000-0000-0000-0000-000000000004"'),
        encoding="utf-8",
    )
    errors: list[str] = []
    MODULE._validate_pipeline(pipeline, errors)
    assert any("PIPELINE_KV" in error for error in errors)


def test_operator_gate_requires_explicit_dlq_consumers(tmp_path: Path) -> None:
    main = tmp_path / "main.toml"
    pipeline = tmp_path / "pipeline.toml"
    main.write_text(_valid_main().replace('[[queues.consumers]]\nqueue = "immi-case-mutation-dlq"\n', '[[queues.consumers]]\n', 1), encoding="utf-8")
    pipeline.write_text(
        _valid_pipeline().replace('[[queues.consumers]]\nqueue = "immi-extract-dlq"\n', '[[queues.consumers]]\n', 1),
        encoding="utf-8",
    )
    errors: list[str] = []
    MODULE._validate_main(main, errors)
    MODULE._validate_pipeline(pipeline, errors)
    assert any("dead-letter queue immi-case-mutation-dlq" in error for error in errors)
    assert any("dead-letter queue immi-extract-dlq" in error for error in errors)
