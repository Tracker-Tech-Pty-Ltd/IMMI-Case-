-- Ops read-path indexes.
--
-- pipeline_runs is listed with ORDER BY started_at DESC LIMIT ? by the operator
-- dashboard, which polls every 2s while a run is active. The table has only a
-- PRIMARY KEY on run_id and no retention policy, so that listing degrades
-- linearly as runs accumulate.
CREATE INDEX IF NOT EXISTS pipeline_runs_started_idx ON pipeline_runs(started_at DESC);

-- pipeline_control_commands is only ever read as
--   WHERE action = ? ORDER BY created_at DESC LIMIT 1
-- but 0002_pipeline_control.sql indexed it as (status, created_at). `status` is
-- never a leading predicate in any query (every write targets command_id, the
-- primary key), so that index can serve nothing and is replaced rather than
-- supplemented. Recreate it with
--   CREATE INDEX pipeline_control_status_idx ON pipeline_control_commands(status, created_at);
-- if a status-first query is ever introduced.
CREATE INDEX IF NOT EXISTS pipeline_control_action_idx
  ON pipeline_control_commands(action, created_at DESC);
DROP INDEX IF EXISTS pipeline_control_status_idx;
