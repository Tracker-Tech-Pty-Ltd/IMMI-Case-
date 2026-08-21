ALTER TABLE public.immigration_cases
  ADD COLUMN IF NOT EXISTS last_extraction_run_id uuid REFERENCES public.pipeline_runs(run_id),
  ADD COLUMN IF NOT EXISTS extraction_confidence jsonb;

CREATE INDEX IF NOT EXISTS immigration_cases_last_extraction_run_idx
  ON public.immigration_cases (last_extraction_run_id)
  WHERE last_extraction_run_id IS NOT NULL;
