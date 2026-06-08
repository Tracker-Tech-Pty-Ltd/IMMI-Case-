DROP INDEX IF EXISTS public.immigration_cases_last_extraction_run_idx;

ALTER TABLE public.immigration_cases
  DROP COLUMN IF EXISTS extraction_confidence,
  DROP COLUMN IF EXISTS last_extraction_run_id;
