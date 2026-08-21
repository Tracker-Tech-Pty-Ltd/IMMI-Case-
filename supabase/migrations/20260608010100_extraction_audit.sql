CREATE TABLE IF NOT EXISTS public.extraction_audit (
  id         bigserial PRIMARY KEY,
  run_id     uuid NOT NULL REFERENCES public.pipeline_runs(run_id),
  case_id    text NOT NULL,
  field      text NOT NULL,
  old_value  text,
  new_value  text,
  source     text NOT NULL CHECK (source IN ('regex', 'llm', 'merge', 'timeout', 'rollback')),
  confidence numeric(3,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS extraction_audit_run_idx
  ON public.extraction_audit (run_id);

CREATE INDEX IF NOT EXISTS extraction_audit_case_idx
  ON public.extraction_audit (case_id);
