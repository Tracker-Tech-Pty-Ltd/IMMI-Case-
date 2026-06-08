CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  run_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  trigger      text NOT NULL CHECK (trigger IN ('cron', 'manual', 'webhook')),
  court        text,
  phase        text NOT NULL,
  discovered   int NOT NULL DEFAULT 0,
  scraped      int NOT NULL DEFAULT 0,
  extracted    int NOT NULL DEFAULT 0,
  upserted     int NOT NULL DEFAULT 0,
  llm_calls    int NOT NULL DEFAULT 0,
  cost_usd     numeric(10,4) NOT NULL DEFAULT 0,
  errors       int NOT NULL DEFAULT 0,
  errors_json  jsonb,
  status       text NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'ok', 'aborted', 'failed')),
  abort_reason text
);

CREATE INDEX IF NOT EXISTS pipeline_runs_started_idx
  ON public.pipeline_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS pipeline_runs_status_idx
  ON public.pipeline_runs (status, started_at DESC);
