-- Durable control-plane commands for native manual pipeline operations.
-- Queue delivery is at-least-once; command_id makes replay safe.
CREATE TABLE IF NOT EXISTS pipeline_control_commands (
  command_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN ('start', 'stop', 'download', 'legislation_update')),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed')),
  run_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS pipeline_control_status_idx
  ON pipeline_control_commands(status, created_at);
