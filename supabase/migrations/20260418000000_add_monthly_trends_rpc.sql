-- Migration: monthly-trends performance fix
-- Problem: GROUP BY (date_sort/100) can't use idx_immigration_cases_date_sort;
--          Supabase statement_timeout (8s) kills the full-table aggregate.
-- Solution: functional index on (date_sort/100) + RPC with extended timeout.

-- Functional index so GROUP BY (date_sort/100) becomes a fast GroupAggregate.
CREATE INDEX IF NOT EXISTS idx_date_sort_month
  ON immigration_cases ((date_sort / 100))
  WHERE date_sort IS NOT NULL AND date_sort > 19000000;

-- RPC function returns pre-aggregated (month, court, outcome, count) rows.
-- SECURITY DEFINER + SET LOCAL lets us extend the statement timeout beyond
-- the default 8-second Supabase PostgREST limit.
CREATE OR REPLACE FUNCTION get_analytics_monthly_trends()
RETURNS TABLE(month_key text, court_code text, outcome text, cnt integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
AS $$
BEGIN
  SET LOCAL statement_timeout = '60s';
  RETURN QUERY
    SELECT
      lpad((ic.date_sort / 100)::text, 6, '0') AS month_key,
      ic.court_code,
      ic.outcome,
      COUNT(*)::int AS cnt
    FROM immigration_cases ic
    WHERE ic.date_sort IS NOT NULL AND ic.date_sort > 19000000
    GROUP BY 1, 2, 3
    ORDER BY 1;
END;
$$;
