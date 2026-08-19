-- IMMI_OPS_DB: repeatable import, pipeline audit, reconciliation and outbox/DLQ.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  court TEXT,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  discovered INTEGER NOT NULL DEFAULT 0,
  scraped INTEGER NOT NULL DEFAULT 0,
  extracted INTEGER NOT NULL DEFAULT 0,
  upserted INTEGER NOT NULL DEFAULT 0,
  llm_calls INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  indexed INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json)),
  abort_reason TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS extraction_audit (
  audit_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  source TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id)
);
CREATE INDEX IF NOT EXISTS extraction_audit_run_case_idx ON extraction_audit(run_id, case_id);

CREATE TABLE IF NOT EXISTS pipeline_checkpoints (
  run_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  step TEXT NOT NULL CHECK(step IN ('r2', 'catalog', 'vectorize', 'ops')),
  status TEXT NOT NULL,
  detail_json TEXT CHECK(detail_json IS NULL OR json_valid(detail_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, event_id, step),
  FOREIGN KEY (run_id) REFERENCES pipeline_runs(run_id)
);

CREATE TABLE IF NOT EXISTS import_runs (
  run_id TEXT PRIMARY KEY,
  source_snapshot_at TEXT NOT NULL,
  source_schema_version TEXT NOT NULL,
  status TEXT NOT NULL,
  manifest_key TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256) = 64),
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS import_checkpoints (
  run_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  step TEXT NOT NULL CHECK(step IN ('r2', 'catalog', 'vectorize', 'ops')),
  status TEXT NOT NULL,
  detail_json TEXT CHECK(detail_json IS NULL OR json_valid(detail_json)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (run_id, event_id, step),
  FOREIGN KEY (run_id) REFERENCES import_runs(run_id)
);
CREATE TABLE IF NOT EXISTS reconciliation_results (
  reconciliation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  expected_count INTEGER NOT NULL,
  actual_count INTEGER NOT NULL,
  missing_count INTEGER NOT NULL,
  extra_count INTEGER NOT NULL,
  orphan_count INTEGER NOT NULL,
  checksum_mismatch_count INTEGER NOT NULL,
  detail_key TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES import_runs(run_id)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  event_id TEXT PRIMARY KEY,
  run_id TEXT,
  event_kind TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS outbox_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT,
  event_kind TEXT NOT NULL,
  payload_key TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_ready_idx ON outbox_events(status, available_at);
CREATE TABLE IF NOT EXISTS dead_letter_events (
  event_id TEXT PRIMARY KEY,
  outbox_event_id TEXT,
  reason TEXT NOT NULL,
  payload_key TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  failed_at TEXT NOT NULL,
  FOREIGN KEY (outbox_event_id) REFERENCES outbox_events(event_id)
);
