-- =============================================================================
-- IMMI-Case Supabase Schema
-- Run this SQL in the Supabase SQL Editor to set up the database.
-- =============================================================================

-- 1. Main table + indexes
-- Using "immigration_cases" to avoid the SQL reserved word "cases".
CREATE TABLE IF NOT EXISTS immigration_cases (
    case_id TEXT PRIMARY KEY,
    citation TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    court TEXT NOT NULL DEFAULT '',
    court_code TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    year INTEGER NOT NULL DEFAULT 0,
    url TEXT NOT NULL DEFAULT '' UNIQUE,
    judges TEXT NOT NULL DEFAULT '',
    catchwords TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT '',
    visa_type TEXT NOT NULL DEFAULT '',
    legislation TEXT NOT NULL DEFAULT '',
    text_snippet TEXT NOT NULL DEFAULT '',
    full_text_path TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    user_notes TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    visa_subclass TEXT NOT NULL DEFAULT '',
    visa_class_code TEXT NOT NULL DEFAULT '',
    case_nature TEXT NOT NULL DEFAULT '',
    legal_concepts TEXT NOT NULL DEFAULT '',
    applicant_name TEXT NOT NULL DEFAULT '',
    respondent TEXT NOT NULL DEFAULT '',
    country_of_origin TEXT NOT NULL DEFAULT '',
    visa_subclass_number TEXT NOT NULL DEFAULT '',
    hearing_date TEXT NOT NULL DEFAULT '',
    is_represented TEXT NOT NULL DEFAULT '',
    representative TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_court_code ON immigration_cases(court_code);
CREATE INDEX IF NOT EXISTS idx_year ON immigration_cases(year);
CREATE INDEX IF NOT EXISTS idx_court_year ON immigration_cases(court_code, year);
CREATE INDEX IF NOT EXISTS idx_source ON immigration_cases(source);
CREATE INDEX IF NOT EXISTS idx_cases_case_nature ON immigration_cases(case_nature);
CREATE INDEX IF NOT EXISTS idx_cases_country ON immigration_cases(country_of_origin);

-- 2. Full-Text Search: generated tsvector column + GIN index
ALTER TABLE immigration_cases ADD COLUMN IF NOT EXISTS fts tsvector
GENERATED ALWAYS AS (
    to_tsvector('english',
        coalesce(citation, '') || ' ' ||
        coalesce(title, '') || ' ' ||
        coalesce(catchwords, '') || ' ' ||
        coalesce(judges, '') || ' ' ||
        coalesce(outcome, '') || ' ' ||
        coalesce(user_notes, '') || ' ' ||
        coalesce(case_nature, '') || ' ' ||
        coalesce(legal_concepts, ''))
) STORED;

CREATE INDEX IF NOT EXISTS idx_fts ON immigration_cases USING GIN(fts);

-- 3. Auto-update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_immigration_cases_modtime ON immigration_cases;
CREATE TRIGGER update_immigration_cases_modtime
    BEFORE UPDATE ON immigration_cases
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_column();

-- =============================================================================
-- 4. RPC Functions (called from Supabase SDK via .rpc())
-- =============================================================================

-- NOTE:
-- Semantic search (pgvector) schema and RPC functions are defined in:
--   supabase/migrations/20260223103000_add_pgvector_embeddings.sql
-- Keep this base schema minimal; apply all migrations after initial setup.

-- 4a. Dashboard statistics
CREATE OR REPLACE FUNCTION get_case_statistics()
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total', (SELECT count(*) FROM immigration_cases),
        'by_court', (
            SELECT coalesce(json_object_agg(court_name, cnt), '{}'::json)
            FROM (
                SELECT coalesce(nullif(court, ''), 'Unknown') AS court_name,
                       count(*) AS cnt
                FROM immigration_cases
                GROUP BY court_name
                ORDER BY court_name
            ) sub
        ),
        'by_year', (
            SELECT coalesce(json_object_agg(year::text, cnt), '{}'::json)
            FROM (
                SELECT year, count(*) AS cnt
                FROM immigration_cases
                WHERE year > 0
                GROUP BY year
                ORDER BY year
            ) sub
        ),
        'by_nature', (
            SELECT coalesce(json_object_agg(case_nature, cnt), '{}'::json)
            FROM (
                SELECT case_nature, count(*) AS cnt
                FROM immigration_cases
                WHERE case_nature != ''
                GROUP BY case_nature
                ORDER BY cnt DESC
            ) sub
        ),
        'visa_types', (
            SELECT coalesce(json_agg(visa_type ORDER BY visa_type), '[]'::json)
            FROM (
                SELECT DISTINCT visa_type
                FROM immigration_cases
                WHERE visa_type != ''
            ) sub
        ),
        'with_full_text', (
            SELECT count(*) FROM immigration_cases WHERE full_text_path != ''
        ),
        'sources', (
            SELECT coalesce(json_agg(source ORDER BY source), '[]'::json)
            FROM (
                SELECT DISTINCT source
                FROM immigration_cases
                WHERE source != ''
            ) sub
        )
    ) INTO result;
    RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4b. Filter dropdown options
CREATE OR REPLACE FUNCTION get_case_filter_options()
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'courts', (
            SELECT coalesce(json_agg(court_code ORDER BY court_code), '[]'::json)
            FROM (SELECT DISTINCT court_code FROM immigration_cases WHERE court_code != '') sub
        ),
        'years', (
            SELECT coalesce(json_agg(year ORDER BY year DESC), '[]'::json)
            FROM (SELECT DISTINCT year FROM immigration_cases WHERE year > 0) sub
        ),
        'sources', (
            SELECT coalesce(json_agg(source ORDER BY source), '[]'::json)
            FROM (SELECT DISTINCT source FROM immigration_cases WHERE source != '') sub
        ),
        'natures', (
            SELECT coalesce(json_agg(case_nature ORDER BY case_nature), '[]'::json)
            FROM (SELECT DISTINCT case_nature FROM immigration_cases WHERE case_nature != '') sub
        ),
        'tags_raw', (
            SELECT coalesce(json_agg(tags), '[]'::json)
            FROM (SELECT DISTINCT tags FROM immigration_cases WHERE tags != '') sub
        )
    ) INTO result;
    RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4c. Find related cases (scored by nature/visa_type/court similarity)
CREATE OR REPLACE FUNCTION find_related_cases(
    p_case_id TEXT,
    p_case_nature TEXT DEFAULT '',
    p_visa_type TEXT DEFAULT '',
    p_court_code TEXT DEFAULT '',
    p_limit INTEGER DEFAULT 5
)
RETURNS SETOF immigration_cases AS $$
BEGIN
    RETURN QUERY
    SELECT ic.*
    FROM immigration_cases ic
    WHERE ic.case_id != p_case_id
      AND (
          (p_case_nature != '' AND ic.case_nature = p_case_nature) OR
          (p_visa_type != '' AND ic.visa_type = p_visa_type) OR
          (p_court_code != '' AND ic.court_code = p_court_code)
      )
    ORDER BY
        (CASE WHEN p_case_nature != '' AND ic.case_nature = p_case_nature THEN 3 ELSE 0 END) +
        (CASE WHEN p_visa_type != '' AND ic.visa_type = p_visa_type THEN 2 ELSE 0 END) +
        (CASE WHEN p_court_code != '' AND ic.court_code = p_court_code THEN 1 ELSE 0 END) DESC,
        ic.year DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- 4d. Get all existing URLs (for deduplication during scraping)
CREATE OR REPLACE FUNCTION get_existing_urls()
RETURNS JSON AS $$
BEGIN
    RETURN (
        SELECT coalesce(json_agg(url), '[]'::json)
        FROM immigration_cases
        WHERE url != ''
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- Row Level Security
-- ============================================================

-- Enable Row Level Security on immigration_cases table
-- Prevents direct client-side data manipulation via anon key
ALTER TABLE immigration_cases ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read cases (public data)
CREATE POLICY "allow_public_read" ON immigration_cases
    FOR SELECT USING (true);

-- Only service_role can insert new cases
CREATE POLICY "deny_anon_insert" ON immigration_cases
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Only service_role can update cases
CREATE POLICY "deny_anon_update" ON immigration_cases
    FOR UPDATE USING (auth.role() = 'service_role');

-- Only service_role can delete cases
CREATE POLICY "deny_anon_delete" ON immigration_cases
    FOR DELETE USING (auth.role() = 'service_role');
