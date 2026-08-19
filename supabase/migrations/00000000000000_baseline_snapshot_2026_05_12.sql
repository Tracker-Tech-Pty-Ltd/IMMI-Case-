


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "core";


ALTER SCHEMA "core" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "crm";


ALTER SCHEMA "crm" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "law";


ALTER SCHEMA "law" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."immigration_cases" (
    "case_id" "text" NOT NULL,
    "citation" "text" DEFAULT ''::"text" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "court" "text" DEFAULT ''::"text" NOT NULL,
    "court_code" "text" DEFAULT ''::"text" NOT NULL,
    "date" "text" DEFAULT ''::"text" NOT NULL,
    "year" integer DEFAULT 0 NOT NULL,
    "url" "text" DEFAULT ''::"text" NOT NULL,
    "judges" "text" DEFAULT ''::"text" NOT NULL,
    "catchwords" "text" DEFAULT ''::"text" NOT NULL,
    "outcome" "text" DEFAULT ''::"text" NOT NULL,
    "visa_type" "text" DEFAULT ''::"text" NOT NULL,
    "legislation" "text" DEFAULT ''::"text" NOT NULL,
    "text_snippet" "text" DEFAULT ''::"text" NOT NULL,
    "full_text_path" "text" DEFAULT ''::"text" NOT NULL,
    "source" "text" DEFAULT ''::"text" NOT NULL,
    "user_notes" "text" DEFAULT ''::"text" NOT NULL,
    "tags" "text" DEFAULT ''::"text" NOT NULL,
    "case_nature" "text" DEFAULT ''::"text" NOT NULL,
    "legal_concepts" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fts" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"english"'::"regconfig", ((((((((((((((COALESCE("citation", ''::"text") || ' '::"text") || COALESCE("title", ''::"text")) || ' '::"text") || COALESCE("catchwords", ''::"text")) || ' '::"text") || COALESCE("judges", ''::"text")) || ' '::"text") || COALESCE("outcome", ''::"text")) || ' '::"text") || COALESCE("user_notes", ''::"text")) || ' '::"text") || COALESCE("case_nature", ''::"text")) || ' '::"text") || COALESCE("legal_concepts", ''::"text")))) STORED,
    "visa_subclass" "text",
    "visa_class_code" "text",
    "applicant_name" "text" DEFAULT ''::"text" NOT NULL,
    "respondent" "text" DEFAULT ''::"text" NOT NULL,
    "country_of_origin" "text" DEFAULT ''::"text" NOT NULL,
    "visa_subclass_number" "text" DEFAULT ''::"text" NOT NULL,
    "hearing_date" "text" DEFAULT ''::"text" NOT NULL,
    "is_represented" "text" DEFAULT ''::"text" NOT NULL,
    "representative" "text" DEFAULT ''::"text" NOT NULL,
    "visa_outcome_reason" "text" DEFAULT ''::"text",
    "legal_test_applied" "text" DEFAULT ''::"text",
    "date_sort" integer,
    "embedding" "public"."vector",
    "embedding_provider" "text" DEFAULT ''::"text" NOT NULL,
    "embedding_model" "text" DEFAULT ''::"text" NOT NULL,
    "embedding_dimensions" integer DEFAULT 0 NOT NULL,
    "embedding_content_hash" "text" DEFAULT ''::"text" NOT NULL,
    "embedding_updated_at" timestamp with time zone,
    CONSTRAINT "chk_embedding_metadata_consistency" CHECK ((("embedding" IS NULL) OR (("embedding_provider" <> ''::"text") AND ("embedding_model" <> ''::"text") AND ("embedding_dimensions" = "public"."vector_dims"("embedding")) AND ("embedding_content_hash" <> ''::"text"))))
);


ALTER TABLE "public"."immigration_cases" OWNER TO "postgres";


COMMENT ON COLUMN "public"."immigration_cases"."visa_outcome_reason" IS 'Primary reason for visa refusal/grant/remittal, extracted from CATCHWORDS section (≤300 chars)';



COMMENT ON COLUMN "public"."immigration_cases"."legal_test_applied" IS 'Primary legal test or section applied, e.g. "s.36 refugee test", "s.501 character test" (≤80 chars)';



CREATE OR REPLACE FUNCTION "public"."find_related_cases"("p_case_id" "text", "p_case_nature" "text" DEFAULT ''::"text", "p_visa_type" "text" DEFAULT ''::"text", "p_court_code" "text" DEFAULT ''::"text", "p_limit" integer DEFAULT 5) RETURNS SETOF "public"."immigration_cases"
    LANGUAGE "plpgsql" STABLE
    AS $$
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
$$;


ALTER FUNCTION "public"."find_related_cases"("p_case_id" "text", "p_case_nature" "text", "p_visa_type" "text", "p_court_code" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_analytics_concepts_raw"() RETURNS TABLE("concept_raw" "text", "cnt" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  SET LOCAL statement_timeout = '30s';
  RETURN QUERY
    SELECT
      trim(c) AS concept_raw,
      COUNT(*) AS cnt
    FROM immigration_cases ic,
      LATERAL unnest(
        string_to_array(
          regexp_replace(ic.legal_concepts, ';', ',', 'g'),
          ','
        )
      ) AS c
    WHERE ic.legal_concepts IS NOT NULL AND ic.legal_concepts <> '' AND trim(c) <> ''
    GROUP BY trim(c)
    ORDER BY cnt DESC;
END;
$$;


ALTER FUNCTION "public"."get_analytics_concepts_raw"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_analytics_judges_raw"() RETURNS TABLE("judge_raw" "text", "court_code" "text", "cnt" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  SET LOCAL statement_timeout = '30s';
  RETURN QUERY
    SELECT
      trim(j) AS judge_raw,
      ic.court_code,
      COUNT(*) AS cnt
    FROM immigration_cases ic,
      LATERAL unnest(
        string_to_array(
          regexp_replace(ic.judges, ';', ',', 'g'),
          ','
        )
      ) AS j
    WHERE ic.judges IS NOT NULL AND ic.judges <> '' AND trim(j) <> ''
    GROUP BY trim(j), ic.court_code
    ORDER BY cnt DESC;
END;
$$;


ALTER FUNCTION "public"."get_analytics_judges_raw"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_analytics_monthly_trends"() RETURNS TABLE("month_key" "text", "court_code" "text", "outcome" "text", "cnt" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."get_analytics_monthly_trends"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_analytics_nature_outcome"() RETURNS TABLE("case_nature" "text", "outcome" "text", "cnt" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  SET LOCAL statement_timeout = '30s';
  RETURN QUERY
    SELECT
      ic.case_nature,
      COALESCE(ic.outcome, '') AS outcome,
      COUNT(*) AS cnt
    FROM immigration_cases ic
    WHERE ic.case_nature IS NOT NULL AND ic.case_nature <> ''
    GROUP BY ic.case_nature, ic.outcome
    ORDER BY ic.case_nature, cnt DESC;
END;
$$;


ALTER FUNCTION "public"."get_analytics_nature_outcome"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_analytics_outcomes"() RETURNS TABLE("group_type" "text", "group_key" "text", "outcome" "text", "cnt" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  SET LOCAL statement_timeout = '30s';
  RETURN QUERY
    SELECT 'court'::text, ic.court_code, COALESCE(ic.outcome, ''), COUNT(*)
    FROM immigration_cases ic
    WHERE ic.court_code IS NOT NULL AND ic.court_code <> ''
    GROUP BY ic.court_code, ic.outcome

    UNION ALL

    SELECT 'year'::text, ic.year::text, COALESCE(ic.outcome, ''), COUNT(*)
    FROM immigration_cases ic
    WHERE ic.year IS NOT NULL
    GROUP BY ic.year, ic.outcome

    UNION ALL

    SELECT 'visa_subclass'::text, COALESCE(ic.visa_subclass, ''), COALESCE(ic.outcome, ''), COUNT(*)
    FROM immigration_cases ic
    WHERE ic.visa_subclass IS NOT NULL AND ic.visa_subclass <> ''
    GROUP BY ic.visa_subclass, ic.outcome;
END;
$$;


ALTER FUNCTION "public"."get_analytics_outcomes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_analytics_outcomes_court"() RETURNS TABLE("court_code" "text", "outcome" "text", "cnt" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  SET LOCAL statement_timeout = '30s';
  RETURN QUERY
    SELECT ic.court_code, COALESCE(ic.outcome, ''), COUNT(*)::bigint
    FROM immigration_cases ic
    WHERE ic.court_code IS NOT NULL AND ic.court_code <> ''
    GROUP BY ic.court_code, ic.outcome;
END;
$$;


ALTER FUNCTION "public"."get_analytics_outcomes_court"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_analytics_outcomes_visa"() RETURNS TABLE("visa_subclass" "text", "outcome" "text", "cnt" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  SET LOCAL statement_timeout = '30s';
  RETURN QUERY
    SELECT COALESCE(ic.visa_subclass, ''), COALESCE(ic.outcome, ''), COUNT(*)::bigint
    FROM immigration_cases ic
    WHERE ic.visa_subclass IS NOT NULL AND ic.visa_subclass <> ''
    GROUP BY ic.visa_subclass, ic.outcome;
END;
$$;


ALTER FUNCTION "public"."get_analytics_outcomes_visa"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_analytics_outcomes_year"() RETURNS TABLE("year_key" "text", "outcome" "text", "cnt" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  SET LOCAL statement_timeout = '30s';
  RETURN QUERY
    SELECT ic.year::text, COALESCE(ic.outcome, ''), COUNT(*)::bigint
    FROM immigration_cases ic
    WHERE ic.year IS NOT NULL
    GROUP BY ic.year, ic.outcome;
END;
$$;


ALTER FUNCTION "public"."get_analytics_outcomes_year"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_case_filter_options"() RETURNS json
    LANGUAGE "plpgsql" STABLE
    SET "statement_timeout" TO '2500ms'
    AS $$
DECLARE
    v_courts JSON := '[]'::json;
    v_years JSON := '[]'::json;
    v_sources JSON := '[]'::json;
    v_natures JSON := '[]'::json;
    v_visa_types JSON := '[]'::json;
    v_tags JSON := '[]'::json;
BEGIN
    SELECT COALESCE(json_agg(court_code ORDER BY court_code), '[]'::json)
    INTO v_courts
    FROM (
        SELECT DISTINCT court_code
        FROM immigration_cases
        WHERE court_code IS NOT NULL AND court_code <> ''
        ORDER BY court_code
        LIMIT 32
    ) q;

    SELECT COALESCE(json_agg(year ORDER BY year DESC), '[]'::json)
    INTO v_years
    FROM (
        SELECT DISTINCT year
        FROM immigration_cases
        WHERE year > 0
        ORDER BY year DESC
        LIMIT 40
    ) q;

    SELECT COALESCE(json_agg(source ORDER BY source), '[]'::json)
    INTO v_sources
    FROM (
        SELECT DISTINCT source
        FROM immigration_cases
        WHERE source IS NOT NULL AND source <> ''
        ORDER BY source
        LIMIT 64
    ) q;

    -- Sample high-cardinality text dimensions from most recent records.
    WITH sampled AS MATERIALIZED (
        SELECT case_nature, visa_type
        FROM immigration_cases
        ORDER BY COALESCE(date_sort, year * 10000) DESC NULLS LAST
        LIMIT 50000
    )
    SELECT
        COALESCE(
            (
                SELECT json_agg(case_nature ORDER BY case_nature)
                FROM (
                    SELECT DISTINCT case_nature
                    FROM sampled
                    WHERE case_nature IS NOT NULL AND case_nature <> ''
                    ORDER BY case_nature
                    LIMIT 300
                ) n
            ),
            '[]'::json
        ),
        COALESCE(
            (
                SELECT json_agg(visa_type ORDER BY visa_type)
                FROM (
                    SELECT DISTINCT visa_type
                    FROM sampled
                    WHERE visa_type IS NOT NULL AND visa_type <> ''
                    ORDER BY visa_type
                    LIMIT 300
                ) v
            ),
            '[]'::json
        )
    INTO v_natures, v_visa_types;

    -- Tags can still be expensive; isolate and degrade gracefully on timeout.
    BEGIN
        SELECT COALESCE(json_agg(tag ORDER BY tag), '[]'::json)
        INTO v_tags
        FROM (
            SELECT tag
            FROM (
                SELECT DISTINCT btrim(split.tag) AS tag
                FROM (
                    SELECT tags
                    FROM immigration_cases
                    WHERE tags IS NOT NULL AND tags <> ''
                    ORDER BY COALESCE(date_sort, year * 10000) DESC NULLS LAST
                    LIMIT 5000
                ) sampled_tags
                CROSS JOIN LATERAL regexp_split_to_table(sampled_tags.tags, ',') AS split(tag)
                WHERE btrim(split.tag) <> ''
            ) deduped
            ORDER BY tag
            LIMIT 500
        ) limited_tags;
    EXCEPTION WHEN query_canceled THEN
        v_tags := '[]'::json;
    END;

    RETURN json_build_object(
        'courts', v_courts,
        'years', v_years,
        'sources', v_sources,
        'natures', v_natures,
        'visa_types', v_visa_types,
        'tags_raw', v_tags
    );
EXCEPTION WHEN query_canceled THEN
    -- Fast, deterministic fallback for UI stability.
    RETURN json_build_object(
        'courts', to_json(ARRAY['AATA','ARTA','FCA','FCCA','FMCA','FedCFamC2G','HCA','MRTA','RRTA']),
        'years', (
            SELECT COALESCE(json_agg(y ORDER BY y DESC), '[]'::json)
            FROM generate_series(2000, EXTRACT(YEAR FROM now())::int) AS g(y)
        ),
        'sources', '["AustLII"]'::json,
        'natures', '[]'::json,
        'visa_types', '[]'::json,
        'tags_raw', '[]'::json
    );
END;
$$;


ALTER FUNCTION "public"."get_case_filter_options"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_case_statistics"() RETURNS json
    LANGUAGE "plpgsql" STABLE
    SET "statement_timeout" TO '5000ms'
    AS $$
DECLARE
    result JSON;
BEGIN
    WITH recent AS MATERIALIZED (
        SELECT
            case_nature,
            visa_subclass,
            visa_type
        FROM immigration_cases
        ORDER BY COALESCE(date_sort, year * 10000) DESC NULLS LAST
        LIMIT 50000
    )
    SELECT json_build_object(
        'total', (SELECT count(*) FROM immigration_cases),
        'by_court', (
            SELECT COALESCE(json_object_agg(court_name, cnt), '{}'::json)
            FROM (
                SELECT COALESCE(NULLIF(court_code, ''), 'Unknown') AS court_name,
                       count(*) AS cnt
                FROM immigration_cases
                GROUP BY court_name
                ORDER BY court_name
            ) sub
        ),
        'by_year', (
            SELECT COALESCE(json_object_agg(year::text, cnt), '{}'::json)
            FROM (
                SELECT year, count(*) AS cnt
                FROM immigration_cases
                WHERE year > 0
                GROUP BY year
                ORDER BY year
            ) sub
        ),
        'by_nature', (
            SELECT COALESCE(json_object_agg(case_nature, cnt), '{}'::json)
            FROM (
                SELECT case_nature, count(*) AS cnt
                FROM recent
                WHERE case_nature IS NOT NULL AND case_nature <> ''
                GROUP BY case_nature
                ORDER BY cnt DESC
                LIMIT 40
            ) sub
        ),
        'by_visa_subclass', (
            SELECT COALESCE(json_object_agg(visa_subclass, cnt), '{}'::json)
            FROM (
                SELECT visa_subclass, count(*) AS cnt
                FROM immigration_cases
                WHERE visa_subclass IS NOT NULL AND visa_subclass <> ''
                GROUP BY visa_subclass
                ORDER BY cnt DESC
                LIMIT 30
            ) sub
        ),
        'by_source', (
            SELECT COALESCE(json_object_agg(src, cnt), '{}'::json)
            FROM (
                SELECT COALESCE(NULLIF(source, ''), 'Unknown') AS src,
                       count(*) AS cnt
                FROM immigration_cases
                GROUP BY src
                ORDER BY cnt DESC
            ) sub
        ),
        'visa_types', (
            SELECT COALESCE(json_agg(visa_type ORDER BY visa_type), '[]'::json)
            FROM (
                SELECT DISTINCT visa_type
                FROM recent
                WHERE visa_type IS NOT NULL AND visa_type <> ''
                ORDER BY visa_type
                LIMIT 300
            ) sub
        ),
        'with_full_text', (
            SELECT count(*)
            FROM immigration_cases
            WHERE full_text_path IS NOT NULL AND full_text_path <> ''
        ),
        'sources', (
            SELECT COALESCE(json_agg(source ORDER BY source), '[]'::json)
            FROM (
                SELECT DISTINCT source
                FROM immigration_cases
                WHERE source IS NOT NULL AND source <> ''
                ORDER BY source
                LIMIT 64
            ) sub
        )
    ) INTO result;

    RETURN result;
EXCEPTION WHEN query_canceled THEN
    RETURN json_build_object(
        'total', 0,
        'by_court', '{}'::json,
        'by_year', '{}'::json,
        'by_nature', '{}'::json,
        'by_visa_subclass', '{}'::json,
        'by_source', '{}'::json,
        'visa_types', '[]'::json,
        'with_full_text', 0,
        'sources', '[]'::json
    );
END;
$$;


ALTER FUNCTION "public"."get_case_statistics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_court_year_trends"() RETURNS json
    LANGUAGE "plpgsql" STABLE
    SET "statement_timeout" TO '2500ms'
    AS $$
DECLARE
    result JSON;
BEGIN
    SELECT COALESCE(
        json_agg(
            (
                jsonb_build_object('year', yearly.year)
                || COALESCE(yearly.courts_json, '{}'::jsonb)
            )::json
            ORDER BY yearly.year
        ),
        '[]'::json
    )
    INTO result
    FROM (
        SELECT
            year,
            jsonb_object_agg(court_code, cnt ORDER BY court_code) AS courts_json
        FROM court_year_counts_mv
        GROUP BY year
    ) yearly;

    RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_court_year_trends"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_existing_urls"() RETURNS json
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    RETURN (
        SELECT coalesce(json_agg(url), '[]'::json)
        FROM immigration_cases
        WHERE url != ''
    );
END;
$$;


ALTER FUNCTION "public"."get_existing_urls"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_court_year_counts_mv"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    -- Prefer non-blocking concurrent refresh when possible.
    REFRESH MATERIALIZED VIEW CONCURRENTLY court_year_counts_mv;
EXCEPTION
    WHEN feature_not_supported THEN
        -- Fallback path for environments where concurrent refresh is unavailable.
        REFRESH MATERIALIZED VIEW court_year_counts_mv;
END;
$$;


ALTER FUNCTION "public"."refresh_court_year_counts_mv"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."safe_date_to_sortint"("d" "text") RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  cleaned  TEXT;
  parsed   DATE;
  fmt      TEXT;
BEGIN
  IF d IS NULL OR TRIM(d) = '' THEN
    RETURN NULL;
  END IF;

  -- Normalise: collapse internal whitespace/newlines, trim edges
  cleaned := TRIM(REGEXP_REPLACE(d, '\s+', ' ', 'g'));

  -- Try full month name first ("14 May 2003")
  BEGIN
    parsed := TO_DATE(cleaned, 'DD Month YYYY');
    RETURN (EXTRACT(YEAR  FROM parsed)::INTEGER * 10000)
         + (EXTRACT(MONTH FROM parsed)::INTEGER * 100)
         + (EXTRACT(DAY   FROM parsed)::INTEGER);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Try 3-letter abbreviated month ("6 Sep 2018", "8 OCT 2003")
  BEGIN
    parsed := TO_DATE(cleaned, 'DD Mon YYYY');
    RETURN (EXTRACT(YEAR  FROM parsed)::INTEGER * 10000)
         + (EXTRACT(MONTH FROM parsed)::INTEGER * 100)
         + (EXTRACT(DAY   FROM parsed)::INTEGER);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Unparseable — return NULL
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."safe_date_to_sortint"("d" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_cases_hybrid"("p_query_text" "text", "p_query_embedding" "public"."vector", "p_provider" "text" DEFAULT 'openai'::"text", "p_model" "text" DEFAULT 'text-embedding-3-small'::"text", "p_limit" integer DEFAULT 50, "p_candidate_limit" integer DEFAULT 200) RETURNS TABLE("case_id" "text", "hybrid_score" double precision, "semantic_score" double precision, "lexical_score" double precision)
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    p_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);
    p_candidate_limit := LEAST(GREATEST(COALESCE(p_candidate_limit, 200), p_limit), 1000);

    RETURN QUERY
    WITH semantic AS (
        SELECT
            s.case_id,
            s.similarity AS semantic_score,
            ROW_NUMBER() OVER (ORDER BY s.similarity DESC) AS semantic_rank
        FROM search_cases_semantic(
            p_query_embedding => p_query_embedding,
            p_provider => p_provider,
            p_model => p_model,
            p_limit => p_candidate_limit
        ) s
    ),
    lexical AS (
        SELECT
            ic.case_id,
            ts_rank(ic.fts, websearch_to_tsquery('english', p_query_text)) AS lexical_score,
            ROW_NUMBER() OVER (
                ORDER BY ts_rank(ic.fts, websearch_to_tsquery('english', p_query_text)) DESC
            ) AS lexical_rank
        FROM immigration_cases ic
        WHERE p_query_text IS NOT NULL
          AND btrim(p_query_text) <> ''
          AND ic.fts @@ websearch_to_tsquery('english', p_query_text)
        ORDER BY ts_rank(ic.fts, websearch_to_tsquery('english', p_query_text)) DESC
        LIMIT p_candidate_limit
    )
    SELECT
        COALESCE(s.case_id, l.case_id) AS case_id,
        (
            COALESCE(0.65::DOUBLE PRECISION / (60 + s.semantic_rank), 0.0::DOUBLE PRECISION) +
            COALESCE(0.35::DOUBLE PRECISION / (60 + l.lexical_rank), 0.0::DOUBLE PRECISION)
        )::DOUBLE PRECISION AS hybrid_score,
        COALESCE(s.semantic_score, 0.0)::DOUBLE PRECISION AS semantic_score,
        COALESCE(l.lexical_score, 0.0)::DOUBLE PRECISION AS lexical_score
    FROM semantic s
    FULL OUTER JOIN lexical l ON s.case_id = l.case_id
    ORDER BY hybrid_score DESC
    LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."search_cases_hybrid"("p_query_text" "text", "p_query_embedding" "public"."vector", "p_provider" "text", "p_model" "text", "p_limit" integer, "p_candidate_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_cases_semantic"("p_query_embedding" "public"."vector", "p_provider" "text" DEFAULT 'openai'::"text", "p_model" "text" DEFAULT 'text-embedding-3-small'::"text", "p_limit" integer DEFAULT 50) RETURNS TABLE("case_id" "text", "similarity" double precision)
    LANGUAGE "plpgsql" STABLE
    AS $$
BEGIN
    p_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 500);

    -- Fast path for indexed OpenAI 1536 model
    IF p_provider = 'openai' AND p_model = 'text-embedding-3-small' THEN
        RETURN QUERY
        SELECT
            ic.case_id,
            1 - ((ic.embedding::vector(1536)) <=> (p_query_embedding::vector(1536))) AS similarity
        FROM immigration_cases ic
        WHERE ic.embedding IS NOT NULL
          AND ic.embedding_provider = p_provider
          AND ic.embedding_model = p_model
          AND ic.embedding_dimensions = 1536
        ORDER BY (ic.embedding::vector(1536)) <=> (p_query_embedding::vector(1536))
        LIMIT p_limit;
        RETURN;
    END IF;

    -- Fast path for indexed Gemini 3072 model
    IF p_provider = 'gemini' AND p_model = 'models/gemini-embedding-001' THEN
        RETURN QUERY
        SELECT
            ic.case_id,
            1 - ((ic.embedding::halfvec(3072)) <=> (p_query_embedding::halfvec(3072))) AS similarity
        FROM immigration_cases ic
        WHERE ic.embedding IS NOT NULL
          AND ic.embedding_provider = p_provider
          AND ic.embedding_model = p_model
          AND ic.embedding_dimensions = 3072
        ORDER BY (ic.embedding::halfvec(3072)) <=> (p_query_embedding::halfvec(3072))
        LIMIT p_limit;
        RETURN;
    END IF;

    -- Generic fallback for other models (same-dimension rows only)
    RETURN QUERY
    SELECT
        ic.case_id,
        1 - (ic.embedding <=> p_query_embedding) AS similarity
    FROM immigration_cases ic
    WHERE ic.embedding IS NOT NULL
      AND ic.embedding_provider = p_provider
      AND ic.embedding_model = p_model
      AND ic.embedding_dimensions = vector_dims(p_query_embedding)
    ORDER BY ic.embedding <=> p_query_embedding
    LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."search_cases_semantic"("p_query_embedding" "public"."vector", "p_provider" "text", "p_model" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_judge_bios_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_judge_bios_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_modified_column"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_modified_column"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "crm"."clients" (
    "id" bigint NOT NULL,
    "public_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" bigint NOT NULL,
    "office_id" bigint,
    "assigned_consultant_user_id" "uuid",
    "client_number" "text",
    "full_name" "text" NOT NULL,
    "preferred_name" "text",
    "email" "public"."citext",
    "phone" "text",
    "date_of_birth" "date",
    "nationality" "text",
    "country_of_origin" "text",
    "lifecycle_status" "text" NOT NULL,
    "lead_stage" "text",
    "source" "text",
    "source_detail" "text",
    "interest_type" "text",
    "interest_detail" "text",
    "visa_type" "text",
    "current_visa" "text",
    "current_visa_expiry" "date",
    "passport_number" "text",
    "passport_expiry" "date",
    "occupation" "text",
    "occupation_code" "text",
    "eoi_points" bigint,
    "converted_from_lead_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "clients_lifecycle_status_check" CHECK (("lifecycle_status" = ANY (ARRAY['lead'::"text", 'prospect'::"text", 'active'::"text", 'completed'::"text", 'alumni'::"text", 'lost'::"text"])))
);


ALTER TABLE "crm"."clients" OWNER TO "postgres";


CREATE OR REPLACE VIEW "law"."immigration_cases" AS
 SELECT "case_id",
    "citation",
    "title",
    "court",
    "court_code",
    "date",
    "year",
    "url",
    "judges",
    "catchwords",
    "outcome",
    "visa_type",
    "legislation",
    "text_snippet",
    "full_text_path",
    "source",
    "user_notes",
    "tags",
    "case_nature",
    "legal_concepts",
    "created_at",
    "updated_at",
    "fts",
    "visa_subclass",
    "visa_class_code",
    "applicant_name",
    "respondent",
    "country_of_origin",
    "visa_subclass_number",
    "hearing_date",
    "is_represented",
    "representative",
    "visa_outcome_reason",
    "legal_test_applied",
    "date_sort",
    "embedding",
    "embedding_provider",
    "embedding_model",
    "embedding_dimensions",
    "embedding_content_hash",
    "embedding_updated_at"
   FROM "public"."immigration_cases";


ALTER VIEW "law"."immigration_cases" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."audit_logs" (
    "id" bigint NOT NULL,
    "tenant_id" bigint,
    "actor_user_id" "uuid",
    "module_key" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "text" NOT NULL,
    "action" "text" NOT NULL,
    "summary" "text",
    "metadata_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_logs_metadata_json_check" CHECK (("jsonb_typeof"("metadata_json") = 'object'::"text"))
);


ALTER TABLE "core"."audit_logs" OWNER TO "postgres";


ALTER TABLE "core"."audit_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "core"."audit_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "core"."module_entitlements" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "module_key" "text" NOT NULL,
    "role_scope" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "config_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "module_entitlements_config_json_check" CHECK (("jsonb_typeof"("config_json") = 'object'::"text"))
);


ALTER TABLE "core"."module_entitlements" OWNER TO "postgres";


ALTER TABLE "core"."module_entitlements" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "core"."module_entitlements_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "core"."offices" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "code" "text",
    "name" "text" NOT NULL,
    "timezone" "text" DEFAULT 'Australia/Melbourne'::"text" NOT NULL,
    "phone" "text",
    "email" "public"."citext",
    "address_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "offices_address_json_check" CHECK (("jsonb_typeof"("address_json") = 'object'::"text"))
);


ALTER TABLE "core"."offices" OWNER TO "postgres";


ALTER TABLE "core"."offices" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "core"."offices_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "core"."profiles" (
    "user_id" "uuid" NOT NULL,
    "default_tenant_id" bigint,
    "default_office_id" bigint,
    "email" "public"."citext" NOT NULL,
    "display_name" "text" NOT NULL,
    "avatar_url" "text",
    "is_platform_admin" boolean DEFAULT false NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "profiles_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'active'::"text", 'suspended'::"text"])))
);


ALTER TABLE "core"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "core"."roles" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "role_key" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_system" boolean DEFAULT false NOT NULL,
    "permissions_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "roles_permissions_json_check" CHECK (("jsonb_typeof"("permissions_json") = 'object'::"text"))
);


ALTER TABLE "core"."roles" OWNER TO "postgres";


ALTER TABLE "core"."roles" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "core"."roles_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "core"."tenant_memberships" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "office_id" bigint,
    "role_key" "text" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "core"."tenant_memberships" OWNER TO "postgres";


ALTER TABLE "core"."tenant_memberships" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "core"."tenant_memberships_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "core"."tenants" (
    "id" bigint NOT NULL,
    "public_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "subdomain" "text",
    "custom_domain" "text",
    "plan_tier" "text" DEFAULT 'starter'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "primary_color" "text",
    "secondary_color" "text",
    "logo_url" "text",
    "contact_email" "public"."citext",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tenants_status_check" CHECK (("status" = ANY (ARRAY['trial'::"text", 'active'::"text", 'suspended'::"text", 'archived'::"text"])))
);


ALTER TABLE "core"."tenants" OWNER TO "postgres";


ALTER TABLE "core"."tenants" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "core"."tenants_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "crm"."applications" (
    "id" bigint NOT NULL,
    "public_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "owner_user_id" "uuid",
    "application_number" "text",
    "application_type" "text" NOT NULL,
    "visa_type" "text",
    "stage" "text" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "institution_name" "text",
    "course_name" "text",
    "external_reference" "text",
    "submitted_at" timestamp with time zone,
    "decision_at" timestamp with time zone,
    "metadata_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "applications_metadata_json_check" CHECK (("jsonb_typeof"("metadata_json") = 'object'::"text")),
    CONSTRAINT "applications_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"])))
);


ALTER TABLE "crm"."applications" OWNER TO "postgres";


ALTER TABLE "crm"."applications" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "crm"."applications_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "crm"."client_notes" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "author_user_id" "uuid" NOT NULL,
    "visibility" "text" DEFAULT 'internal'::"text" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_notes_visibility_check" CHECK (("visibility" = ANY (ARRAY['internal'::"text", 'manager_only'::"text"])))
);


ALTER TABLE "crm"."client_notes" OWNER TO "postgres";


ALTER TABLE "crm"."client_notes" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "crm"."client_notes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "crm"."clients" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "crm"."clients_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "crm"."survey_instances" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "template_id" bigint NOT NULL,
    "client_id" bigint,
    "agent_id" "uuid",
    "channel" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "public_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sent_at" timestamp with time zone,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "survey_instances_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'sent'::"text", 'opened'::"text", 'completed'::"text", 'expired'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "crm"."survey_instances" OWNER TO "postgres";


ALTER TABLE "crm"."survey_instances" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "crm"."survey_instances_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "crm"."survey_responses" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "survey_instance_id" bigint NOT NULL,
    "client_id" bigint,
    "agent_id" "uuid",
    "nps_score" smallint,
    "satisfaction_score" smallint,
    "feedback_text" "text",
    "responses_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_anonymous" boolean DEFAULT false NOT NULL,
    "response_language" "text",
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "survey_responses_nps_score_check" CHECK ((("nps_score" >= 0) AND ("nps_score" <= 10))),
    CONSTRAINT "survey_responses_responses_json_check" CHECK (("jsonb_typeof"("responses_json") = 'object'::"text"))
);


ALTER TABLE "crm"."survey_responses" OWNER TO "postgres";


ALTER TABLE "crm"."survey_responses" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "crm"."survey_responses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "crm"."survey_templates" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "language" "text" DEFAULT 'en'::"text" NOT NULL,
    "trigger_type" "text",
    "questions_json" "jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "survey_templates_questions_json_check" CHECK (("jsonb_typeof"("questions_json") = 'array'::"text"))
);


ALTER TABLE "crm"."survey_templates" OWNER TO "postgres";


ALTER TABLE "crm"."survey_templates" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "crm"."survey_templates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "crm"."tasks" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "client_id" bigint,
    "application_id" bigint,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'todo'::"text" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "assigned_to" "uuid",
    "assigned_by" "uuid",
    "due_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "is_recurring" boolean DEFAULT false NOT NULL,
    "recurrence_rule" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'urgent'::"text"]))),
    CONSTRAINT "tasks_status_check" CHECK (("status" = ANY (ARRAY['todo'::"text", 'in_progress'::"text", 'blocked'::"text", 'done'::"text", 'archived'::"text"])))
);


ALTER TABLE "crm"."tasks" OWNER TO "postgres";


ALTER TABLE "crm"."tasks" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "crm"."tasks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "law"."case_annotations" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "case_id" "text" NOT NULL,
    "author_user_id" "uuid" NOT NULL,
    "visibility" "text" DEFAULT 'tenant'::"text" NOT NULL,
    "annotation_type" "text" DEFAULT 'note'::"text" NOT NULL,
    "body" "text" NOT NULL,
    "metadata_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "case_annotations_annotation_type_check" CHECK (("annotation_type" = ANY (ARRAY['note'::"text", 'highlight'::"text", 'warning'::"text", 'strategy'::"text"]))),
    CONSTRAINT "case_annotations_metadata_json_check" CHECK (("jsonb_typeof"("metadata_json") = 'object'::"text")),
    CONSTRAINT "case_annotations_visibility_check" CHECK (("visibility" = ANY (ARRAY['tenant'::"text", 'private'::"text"])))
);


ALTER TABLE "law"."case_annotations" OWNER TO "postgres";


ALTER TABLE "law"."case_annotations" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "law"."case_annotations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "law"."client_case_links" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "case_id" "text" NOT NULL,
    "link_type" "text" NOT NULL,
    "created_by" "uuid",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_case_links_link_type_check" CHECK (("link_type" = ANY (ARRAY['strategy_reference'::"text", 'refusal_ground'::"text", 'appeal_analogy'::"text", 'background_research'::"text"])))
);


ALTER TABLE "law"."client_case_links" OWNER TO "postgres";


ALTER TABLE "law"."client_case_links" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "law"."client_case_links_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE MATERIALIZED VIEW "public"."court_year_counts_mv" AS
 SELECT "year",
    COALESCE(NULLIF("court_code", ''::"text"), 'Unknown'::"text") AS "court_code",
    "count"(*) AS "cnt"
   FROM "public"."immigration_cases"
  WHERE ("year" > 0)
  GROUP BY "year", COALESCE(NULLIF("court_code", ''::"text"), 'Unknown'::"text")
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."court_year_counts_mv" OWNER TO "postgres";


CREATE OR REPLACE VIEW "law"."court_year_counts_mv" AS
 SELECT "year",
    "court_code",
    "cnt"
   FROM "public"."court_year_counts_mv";


ALTER VIEW "law"."court_year_counts_mv" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."judge_bios" (
    "id" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "role" "text",
    "court" "text",
    "appointed_year" "text",
    "registry" "text",
    "specialization" "text",
    "formerly_known_as" "text",
    "birth_year" integer,
    "previously" "text",
    "current_role_desc" "text",
    "source_url" "text",
    "photo_url" "text",
    "has_legal_qualification" boolean,
    "no_legal_qualification" boolean,
    "qualification_confidence" "text",
    "qualification_notes" "text",
    "found" boolean,
    "source" "text",
    "education" "jsonb",
    "notable_cases" "jsonb",
    "appointment_history" "jsonb",
    "sources" "jsonb",
    "social_media" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "legal_status" "text",
    "notes" "text"
);


ALTER TABLE "public"."judge_bios" OWNER TO "postgres";


COMMENT ON COLUMN "public"."judge_bios"."legal_status" IS 'confirmed_lawyer | confirmed_non_lawyer | null (unknown)';



COMMENT ON COLUMN "public"."judge_bios"."notes" IS 'Research notes with source citations for legal_status determination';



CREATE OR REPLACE VIEW "law"."judge_bios" AS
 SELECT "id",
    "full_name",
    "role",
    "court",
    "appointed_year",
    "registry",
    "specialization",
    "formerly_known_as",
    "birth_year",
    "previously",
    "current_role_desc",
    "source_url",
    "photo_url",
    "has_legal_qualification",
    "no_legal_qualification",
    "qualification_confidence",
    "qualification_notes",
    "found",
    "source",
    "education",
    "notable_cases",
    "appointment_history",
    "sources",
    "social_media",
    "created_at",
    "updated_at",
    "legal_status",
    "notes"
   FROM "public"."judge_bios";


ALTER VIEW "law"."judge_bios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "law"."research_sessions" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "client_id" bigint,
    "session_title" "text",
    "query_text" "text",
    "filters_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result_snapshot_json" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "research_sessions_filters_json_check" CHECK (("jsonb_typeof"("filters_json") = 'object'::"text"))
);


ALTER TABLE "law"."research_sessions" OWNER TO "postgres";


ALTER TABLE "law"."research_sessions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "law"."research_sessions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "law"."saved_searches" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "query_json" "jsonb" NOT NULL,
    "is_shared" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "saved_searches_query_json_check" CHECK (("jsonb_typeof"("query_json") = 'object'::"text"))
);


ALTER TABLE "law"."saved_searches" OWNER TO "postgres";


ALTER TABLE "law"."saved_searches" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "law"."saved_searches_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."account_mappings" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "provider" "text" NOT NULL,
    "account_type" "text" NOT NULL,
    "bsmart_category" "text" NOT NULL,
    "external_account_code" "text" NOT NULL,
    "external_account_name" "text",
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    CONSTRAINT "account_mappings_account_type_check" CHECK (("account_type" = ANY (ARRAY['income'::"text", 'expense'::"text", 'asset'::"text", 'liability'::"text"]))),
    CONSTRAINT "account_mappings_provider_check" CHECK (("provider" = ANY (ARRAY['xero'::"text", 'myob'::"text"])))
);


ALTER TABLE "public"."account_mappings" OWNER TO "postgres";


ALTER TABLE "public"."account_mappings" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."account_mappings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."accounting_integrations" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "user_id" bigint,
    "provider" "text" NOT NULL,
    "access_token" "text",
    "refresh_token" "text",
    "expires_at" "text",
    "organization_id" "text",
    "organization_name" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    CONSTRAINT "accounting_integrations_provider_check" CHECK (("provider" = ANY (ARRAY['xero'::"text", 'myob'::"text"])))
);


ALTER TABLE "public"."accounting_integrations" OWNER TO "postgres";


ALTER TABLE "public"."accounting_integrations" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."accounting_integrations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."accounting_sync_logs" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "provider" "text" NOT NULL,
    "sync_type" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" bigint,
    "direction" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "records_processed" bigint DEFAULT 0 NOT NULL,
    "records_succeeded" bigint DEFAULT 0 NOT NULL,
    "records_failed" bigint DEFAULT 0 NOT NULL,
    "external_id" "text",
    "error_message" "text",
    "error_details" "text",
    "started_at" "text" NOT NULL,
    "completed_at" "text",
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    CONSTRAINT "accounting_sync_logs_direction_check" CHECK (("direction" = ANY (ARRAY['push'::"text", 'pull'::"text"]))),
    CONSTRAINT "accounting_sync_logs_provider_check" CHECK (("provider" = ANY (ARRAY['xero'::"text", 'myob'::"text"]))),
    CONSTRAINT "accounting_sync_logs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'success'::"text", 'failed'::"text", 'partial'::"text"])))
);


ALTER TABLE "public"."accounting_sync_logs" OWNER TO "postgres";


ALTER TABLE "public"."accounting_sync_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."accounting_sync_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."agent_calls" (
    "id" integer NOT NULL,
    "client_id" integer,
    "direction" "text" DEFAULT 'inbound'::"text" NOT NULL,
    "phone_number" "text",
    "purpose" "text",
    "status" "text" DEFAULT 'initiated'::"text" NOT NULL,
    "duration_seconds" integer,
    "transcript" "text",
    "summary" "text",
    "actions_taken" "text",
    "sentiment" "text",
    "sentiment_score" real,
    "auto_tasks_created" "text",
    "elevenlabs_conversation_id" "text",
    "twilio_call_sid" "text",
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."agent_calls" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."agent_calls_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."agent_calls_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."agent_calls_id_seq" OWNED BY "public"."agent_calls"."id";



CREATE TABLE IF NOT EXISTS "public"."agent_config" (
    "id" integer NOT NULL,
    "agent_id" "text",
    "voice_id" "text",
    "system_prompt" "text",
    "first_message" "text",
    "languages" "text" DEFAULT 'en'::"text",
    "expressive_mode" integer DEFAULT 1,
    "is_enabled" integer DEFAULT 0,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."agent_config" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."agent_config_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."agent_config_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."agent_config_id_seq" OWNED BY "public"."agent_config"."id";



CREATE TABLE IF NOT EXISTS "public"."agent_schedule_logs" (
    "id" integer NOT NULL,
    "schedule_id" integer NOT NULL,
    "run_at" "text" NOT NULL,
    "calls_initiated" integer DEFAULT 0 NOT NULL,
    "calls_skipped" integer DEFAULT 0 NOT NULL,
    "retry_attempts" integer DEFAULT 0 NOT NULL,
    "skip_reasons" "text",
    "errors" "text",
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "run_key" "text",
    "created_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."agent_schedule_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."agent_schedule_logs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."agent_schedule_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."agent_schedule_logs_id_seq" OWNED BY "public"."agent_schedule_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."agent_schedules" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "schedule_type" "text" NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "hours_before" integer DEFAULT 24,
    "days_before" integer DEFAULT 7,
    "call_purpose" "text" DEFAULT 'general'::"text",
    "max_calls_per_run" integer DEFAULT 20,
    "last_run_at" "text",
    "next_run_at" "text",
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."agent_schedules" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."agent_schedules_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."agent_schedules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."agent_schedules_id_seq" OWNED BY "public"."agent_schedules"."id";



CREATE TABLE IF NOT EXISTS "public"."ai_interactions" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "user_id" integer,
    "client_id" integer,
    "interaction_type" character varying(50) NOT NULL,
    "input_summary" "text",
    "output_summary" "text",
    "model_used" character varying(100),
    "tokens_used" integer,
    "cost_usd" numeric(8,4),
    "confidence_score" numeric(3,2),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ai_interactions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ai_interactions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ai_interactions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ai_interactions_id_seq" OWNED BY "public"."ai_interactions"."id";



CREATE TABLE IF NOT EXISTS "public"."application_checklist_items" (
    "id" integer NOT NULL,
    "application_id" integer NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "is_completed" integer DEFAULT 0,
    "completed_at" "text",
    "completed_by" integer,
    "due_date" "text",
    "sort_order" integer DEFAULT 0,
    "category" "text" DEFAULT 'general'::"text",
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"(),
    "tenant_id" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."application_checklist_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."application_checklist_items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."application_checklist_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."application_checklist_items_id_seq" OWNED BY "public"."application_checklist_items"."id";



CREATE TABLE IF NOT EXISTS "public"."application_compliance" (
    "id" bigint NOT NULL,
    "application_id" bigint NOT NULL,
    "requirement_id" bigint NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "document_id" bigint,
    "verified_by" bigint,
    "verified_at" "text",
    "notes" "text",
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."application_compliance" OWNER TO "postgres";


ALTER TABLE "public"."application_compliance" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."application_compliance_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."application_document_requirements" (
    "id" bigint NOT NULL,
    "application_id" bigint NOT NULL,
    "template_item_id" bigint,
    "document_name" "text" NOT NULL,
    "is_required" bigint DEFAULT 1 NOT NULL,
    "description" "text",
    "acceptable_formats" "text",
    "example_url" "text",
    "sort_order" bigint DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "uploaded_document_id" bigint,
    "requested_at" "text",
    "uploaded_at" "text",
    "verified_at" "text",
    "rejected_at" "text",
    "rejection_reason" "text",
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."application_document_requirements" OWNER TO "postgres";


ALTER TABLE "public"."application_document_requirements" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."application_document_requirements_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."application_stage_history" (
    "id" bigint NOT NULL,
    "application_id" bigint NOT NULL,
    "from_stage" "text",
    "to_stage" "text" NOT NULL,
    "changed_by" bigint,
    "notes" "text",
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."application_stage_history" OWNER TO "postgres";


ALTER TABLE "public"."application_stage_history" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."application_stage_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."applications" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "application_type" "text" NOT NULL,
    "visa_type" "text",
    "stage" "text" DEFAULT 'inquiry'::"text" NOT NULL,
    "priority" "text" DEFAULT 'standard'::"text",
    "application_reference" "text",
    "external_reference" "text",
    "institution_name" "text",
    "course_name" "text",
    "course_code" "text",
    "course_start_date" "text",
    "course_end_date" "text",
    "coe_number" "text",
    "oshc_provider" "text",
    "english_test_type" "text",
    "english_test_score" "text",
    "english_test_date" "text",
    "english_test_expiry" "text",
    "visa_application_number" "text",
    "visa_lodgement_date" "text",
    "visa_decision_date" "text",
    "visa_grant_number" "text",
    "visa_expiry_date" "text",
    "health_exam_date" "text",
    "health_exam_status" "text",
    "police_check_status" "text",
    "police_check_date" "text",
    "complexity_rating" bigint,
    "assigned_consultant_id" bigint,
    "deadline" "text",
    "notes" "text",
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "created_by" bigint,
    "sales_person_id" bigint,
    "handler_id" bigint,
    "assessment_started_at" "text",
    "assessment_expected_by" "text",
    "tenant_id" bigint DEFAULT 1,
    "partner_id" integer,
    "department" "text" DEFAULT 'education'::"text" NOT NULL,
    "institution_id" integer,
    "course_id" integer,
    "course_intake" "text",
    "offer_date" "date",
    "institution_student_id" "text",
    "tuition_amount_total" numeric(12,2),
    "tuition_deposit_required" numeric(12,2),
    "payment_plan_json" "jsonb",
    "deposit_paid" boolean DEFAULT false NOT NULL,
    "deposit_paid_at" "date",
    "coe_issued_at" "date",
    "tuition_amount_paid" numeric(12,2),
    "service_fee_amount" numeric(12,2),
    "applicant_location" "text",
    "enrollment_included" boolean,
    "parent_application_id" integer,
    "terminal_reason" "text",
    "terminal_at" "date",
    "refusal_date" "date",
    "refusal_reason" "text",
    CONSTRAINT "applications_applicant_location_check" CHECK (("applicant_location" = ANY (ARRAY['onshore'::"text", 'offshore'::"text"]))),
    CONSTRAINT "applications_department_check" CHECK (("department" = ANY (ARRAY['education'::"text", 'migration'::"text"])))
);


ALTER TABLE "public"."applications" OWNER TO "postgres";


ALTER TABLE "public"."applications" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."applications_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "id" integer NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "start_time" "text" NOT NULL,
    "end_time" "text" NOT NULL,
    "client_id" integer,
    "application_id" integer,
    "location" "text",
    "attendees" "text",
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "created_by" integer,
    "calendar_event_id" "text",
    "provider" "text",
    "sync_status" "text" DEFAULT 'pending'::"text",
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."appointments" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."appointments_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."appointments_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."appointments_id_seq" OWNED BY "public"."appointments"."id";



CREATE TABLE IF NOT EXISTS "public"."auth_otp_attempts" (
    "id" integer NOT NULL,
    "email" "text" NOT NULL,
    "ip_address" "text" DEFAULT ''::"text" NOT NULL,
    "attempts" integer DEFAULT 0,
    "locked_until" timestamp without time zone,
    "last_attempt_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE "public"."auth_otp_attempts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."auth_otp_attempts_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."auth_otp_attempts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."auth_otp_attempts_id_seq" OWNED BY "public"."auth_otp_attempts"."id";



CREATE TABLE IF NOT EXISTS "public"."automation_logs" (
    "id" bigint NOT NULL,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "rule_id" bigint,
    "trigger_type" "text",
    "trigger_entity_type" "text",
    "trigger_entity_id" bigint,
    "action_type" "text",
    "status" "text",
    "log_level" "text",
    "message" "text",
    "details" "text",
    "error_message" "text",
    "executed_at" timestamp with time zone,
    "execution_time_ms" integer
);


ALTER TABLE "public"."automation_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."automation_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."automation_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."automation_logs_id_seq" OWNED BY "public"."automation_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."automation_rules" (
    "id" bigint NOT NULL,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "trigger_type" "text" NOT NULL,
    "trigger_entity" "text",
    "trigger_condition" "text",
    "action_type" "text" NOT NULL,
    "action_config" "text",
    "is_enabled" boolean DEFAULT true NOT NULL,
    "created_by" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."automation_rules" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."automation_rules_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."automation_rules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."automation_rules_id_seq" OWNED BY "public"."automation_rules"."id";



CREATE TABLE IF NOT EXISTS "public"."calendar_sync_tokens" (
    "id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "provider" "text" NOT NULL,
    "access_token" "text" NOT NULL,
    "refresh_token" "text",
    "token_type" "text" DEFAULT 'Bearer'::"text",
    "expires_at" "text",
    "scope" "text",
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."calendar_sync_tokens" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."calendar_sync_tokens_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."calendar_sync_tokens_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."calendar_sync_tokens_id_seq" OWNED BY "public"."calendar_sync_tokens"."id";



CREATE TABLE IF NOT EXISTS "public"."client_activity_log" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "action" "text" NOT NULL,
    "detail" "text",
    "performed_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."client_activity_log" OWNER TO "postgres";


ALTER TABLE "public"."client_activity_log" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."client_activity_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."client_assessment_progress" (
    "id" integer NOT NULL,
    "client_id" integer NOT NULL,
    "authority_code" "text" NOT NULL,
    "step_number" integer NOT NULL,
    "is_completed" integer DEFAULT 0,
    "completed_at" "text",
    "completed_by" integer,
    "notes" "text",
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"(),
    "tenant_id" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."client_assessment_progress" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."client_assessment_progress_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."client_assessment_progress_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."client_assessment_progress_id_seq" OWNED BY "public"."client_assessment_progress"."id";



CREATE TABLE IF NOT EXISTS "public"."client_documents" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "filename" "text" NOT NULL,
    "stored_path" "text" NOT NULL,
    "file_type" "text",
    "file_size" bigint,
    "category" "text" DEFAULT 'other'::"text",
    "uploaded_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "version" bigint DEFAULT 1,
    "parent_document_id" bigint,
    "original_document_id" bigint,
    "translation_language" "text",
    "tenant_id" bigint DEFAULT 1,
    "requirement_id" bigint
);


ALTER TABLE "public"."client_documents" OWNER TO "postgres";


ALTER TABLE "public"."client_documents" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."client_documents_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."client_feedback" (
    "id" integer NOT NULL,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "client_id" integer NOT NULL,
    "application_id" integer,
    "assigned_agent_id" integer NOT NULL,
    "satisfaction_score" integer NOT NULL,
    "feedback_text" "text",
    "submitted_at" "text" DEFAULT "now"(),
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"(),
    CONSTRAINT "client_feedback_satisfaction_score_check" CHECK ((("satisfaction_score" >= 1) AND ("satisfaction_score" <= 5)))
);


ALTER TABLE "public"."client_feedback" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."client_feedback_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."client_feedback_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."client_feedback_id_seq" OWNED BY "public"."client_feedback"."id";



CREATE TABLE IF NOT EXISTS "public"."client_milestones" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "milestone_date" "text" NOT NULL,
    "milestone_type" "text" DEFAULT 'custom'::"text",
    "icon" "text",
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."client_milestones" OWNER TO "postgres";


ALTER TABLE "public"."client_milestones" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."client_milestones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."client_notes" (
    "id" bigint NOT NULL,
    "client_id" bigint,
    "note" "text" NOT NULL,
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."client_notes" OWNER TO "postgres";


ALTER TABLE "public"."client_notes" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."client_notes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."client_portal_activity" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "action" "text" NOT NULL,
    "detail" "text",
    "ip_address" "text",
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."client_portal_activity" OWNER TO "postgres";


ALTER TABLE "public"."client_portal_activity" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."client_portal_activity_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."client_portal_intake_forms" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "form_data" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "submitted_at" "text",
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."client_portal_intake_forms" OWNER TO "postgres";


ALTER TABLE "public"."client_portal_intake_forms" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."client_portal_intake_forms_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."client_portal_users" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "email" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "reset_token" "text",
    "reset_token_expires" "text",
    "last_login" "text",
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "failed_login_attempts" integer DEFAULT 0,
    "locked_until" "text"
);


ALTER TABLE "public"."client_portal_users" OWNER TO "postgres";


ALTER TABLE "public"."client_portal_users" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."client_portal_users_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "date_of_birth" "text",
    "nationality" "text",
    "address" "text",
    "passport_number" "text",
    "passport_expiry" "text",
    "occupation" "text",
    "occupation_code" "text",
    "visa_type" "text" DEFAULT '189'::"text",
    "current_visa" "text",
    "current_visa_expiry" "text",
    "visa_history" "text",
    "age" bigint,
    "english_level" "text",
    "education_level" "text",
    "eoi_points" bigint,
    "emergency_name" "text",
    "emergency_phone" "text",
    "emergency_relation" "text",
    "referred_by" bigint,
    "status" "text" DEFAULT 'consulting'::"text",
    "notes" "text",
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "first_name" "text",
    "last_name" "text",
    "preferred_name" "text",
    "secondary_phone" "text",
    "gender" "text",
    "country_of_birth" "text",
    "city" "text",
    "state" "text",
    "postal_code" "text",
    "country" "text" DEFAULT 'Australia'::"text",
    "category" "text" DEFAULT 'onshore'::"text",
    "client_type" "text" DEFAULT 'migration'::"text",
    "source" "text" DEFAULT 'walk_in'::"text",
    "lifecycle_status" "text" DEFAULT 'active'::"text",
    "language_preference" "text" DEFAULT 'english'::"text",
    "assigned_consultant_id" bigint,
    "emergency_contact_name" "text",
    "emergency_contact_phone" "text",
    "satisfaction_rating" bigint,
    "internal_notes" "text",
    "title" "text",
    "other_name" "text",
    "fax" "text",
    "im_account" "text",
    "im_type" "text",
    "client_credit" double precision DEFAULT 0,
    "partner_id" bigint,
    "office_id" bigint DEFAULT 1,
    "client_number" "text",
    "source_detail" "text",
    "interest_type" "text",
    "interest_detail" "text",
    "lead_stage" "text",
    "converted_from_lead_id" bigint,
    "tenant_id" bigint DEFAULT 1,
    "xero_contact_id" "text",
    "myob_contact_id" "text",
    "merged_into_id" integer,
    "passport_issue_date" "text",
    "ielts_listening" real,
    "ielts_reading" real,
    "ielts_writing" real,
    "ielts_speaking" real,
    "ielts_overall" real,
    "ielts_test_date" "text",
    "ielts_expiry_date" "text",
    "pte_listening" integer,
    "pte_reading" integer,
    "pte_writing" integer,
    "pte_speaking" integer,
    "pte_overall" integer,
    "pte_test_date" "text",
    "pte_expiry_date" "text",
    "education_institution" "text",
    "education_degree" "text",
    "education_field" "text",
    "education_graduation_date" "text",
    "is_company" boolean DEFAULT false,
    "company_name" "text",
    "abn" "text",
    "contact_person" "text",
    "sales_consultant_id" integer,
    "handler_consultant_id" integer
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


ALTER TABLE "public"."clients" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."clients_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."commission_claim_items" (
    "id" bigint NOT NULL,
    "claim_id" bigint NOT NULL,
    "semester_entry_id" bigint NOT NULL,
    "amount" double precision DEFAULT 0,
    "tenant_id" bigint DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."commission_claim_items" OWNER TO "postgres";


ALTER TABLE "public"."commission_claim_items" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."commission_claim_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."commission_claim_reports" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "institution_id" integer NOT NULL,
    "intake_period" "text" NOT NULL,
    "total_students" integer DEFAULT 0 NOT NULL,
    "total_expected_commission" real DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'draft'::"text",
    "sent_date" "text",
    "pdf_path" "text",
    "notes" "text",
    "created_by" integer,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."commission_claim_reports" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."commission_claim_reports_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."commission_claim_reports_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."commission_claim_reports_id_seq" OWNED BY "public"."commission_claim_reports"."id";



CREATE TABLE IF NOT EXISTS "public"."commission_claims" (
    "id" bigint NOT NULL,
    "claim_number" "text" NOT NULL,
    "school_id" bigint,
    "submitted_date" "text",
    "expected_payment_date" "text",
    "total_amount" double precision DEFAULT 0,
    "amount_received" double precision DEFAULT 0,
    "status" "text" DEFAULT 'draft'::"text",
    "payment_reference" "text",
    "notes" "text",
    "created_by" bigint,
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "intake_period" "text",
    "invoice_id" integer
);


ALTER TABLE "public"."commission_claims" OWNER TO "postgres";


ALTER TABLE "public"."commission_claims" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."commission_claims_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."commission_entitlements" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "payee_kind" "text" NOT NULL,
    "payee_id" integer NOT NULL,
    "role" "text" NOT NULL,
    "entitlement_rate" numeric(5,4) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "commission_entitlements_payee_kind_check" CHECK (("payee_kind" = ANY (ARRAY['user'::"text", 'partner'::"text"]))),
    CONSTRAINT "commission_entitlements_role_check" CHECK (("role" = ANY (ARRAY['sales'::"text", 'handler'::"text", 'partner'::"text"])))
);


ALTER TABLE "public"."commission_entitlements" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."commission_entitlements_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."commission_entitlements_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."commission_entitlements_id_seq" OWNED BY "public"."commission_entitlements"."id";



CREATE TABLE IF NOT EXISTS "public"."commission_invoice_items" (
    "id" bigint NOT NULL,
    "commission_invoice_id" bigint NOT NULL,
    "commission_id" bigint NOT NULL,
    "tenant_id" bigint DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."commission_invoice_items" OWNER TO "postgres";


ALTER TABLE "public"."commission_invoice_items" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."commission_invoice_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."commission_invoices" (
    "id" bigint NOT NULL,
    "invoice_number" "text" NOT NULL,
    "commission_type" "text" DEFAULT 'receivable'::"text",
    "counterparty_type" "text" DEFAULT 'institution'::"text",
    "counterparty_id" bigint NOT NULL,
    "status" "text" DEFAULT 'draft'::"text",
    "issue_date" "text" NOT NULL,
    "due_date" "text",
    "subtotal" double precision DEFAULT 0,
    "gst_amount" double precision DEFAULT 0,
    "total" double precision DEFAULT 0,
    "amount_paid" double precision DEFAULT 0,
    "notes" "text",
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."commission_invoices" OWNER TO "postgres";


ALTER TABLE "public"."commission_invoices" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."commission_invoices_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."commission_payments" (
    "id" bigint NOT NULL,
    "commission_invoice_id" bigint NOT NULL,
    "amount" double precision NOT NULL,
    "payment_method" "text" DEFAULT 'bank_transfer'::"text",
    "payment_date" "text" NOT NULL,
    "reference" "text",
    "notes" "text",
    "recorded_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "expected_amount" double precision,
    "variance" double precision,
    "reconciliation_status" "text",
    "bank_reference" "text",
    "semester_entry_id" bigint
);


ALTER TABLE "public"."commission_payments" OWNER TO "postgres";


ALTER TABLE "public"."commission_payments" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."commission_payments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."commission_rate_config" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "commission_type" "text" NOT NULL,
    "role" "text" NOT NULL,
    "rate_percentage" real NOT NULL,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."commission_rate_config" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."commission_rate_config_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."commission_rate_config_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."commission_rate_config_id_seq" OWNED BY "public"."commission_rate_config"."id";



CREATE TABLE IF NOT EXISTS "public"."commission_school_receipts" (
    "id" integer NOT NULL,
    "commission_id" integer NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "received_at" "text" NOT NULL,
    "reference" "text",
    "notes" "text",
    "recorded_by" integer,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."commission_school_receipts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."commission_school_receipts_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."commission_school_receipts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."commission_school_receipts_id_seq" OWNED BY "public"."commission_school_receipts"."id";



CREATE TABLE IF NOT EXISTS "public"."commission_semester_entries" (
    "id" bigint NOT NULL,
    "commission_id" bigint NOT NULL,
    "semester_number" bigint NOT NULL,
    "semester_label" "text",
    "semester_start" "text",
    "semester_end" "text",
    "base_amount" double precision DEFAULT 0,
    "gst_amount" double precision DEFAULT 0,
    "total_amount" double precision DEFAULT 0,
    "status" "text" DEFAULT 'pending'::"text",
    "claim_date" "text",
    "claim_reference" "text",
    "approved_date" "text",
    "approved_by" bigint,
    "paid_date" "text",
    "paid_amount" double precision,
    "written_off_date" "text",
    "written_off_reason" "text",
    "notes" "text",
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tuition_amount" numeric(12,2)
);


ALTER TABLE "public"."commission_semester_entries" OWNER TO "postgres";


ALTER TABLE "public"."commission_semester_entries" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."commission_semester_entries_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."commission_tracking" (
    "id" bigint NOT NULL,
    "commission_number" "text" NOT NULL,
    "enrolment_id" bigint,
    "application_id" bigint,
    "commission_type" "text" DEFAULT 'receivable'::"text",
    "institution_id" bigint,
    "partner_id" bigint,
    "client_id" bigint,
    "base_amount" double precision DEFAULT 0,
    "gst_amount" double precision DEFAULT 0,
    "total_amount" double precision DEFAULT 0,
    "calculation_basis" "text" DEFAULT 'percentage'::"text",
    "rate" double precision,
    "status" "text" DEFAULT 'pending'::"text",
    "description" "text",
    "notes" "text",
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "overall_status" "text",
    "total_semesters" bigint,
    "semesters_paid" bigint DEFAULT 0,
    "semesters_written_off" bigint DEFAULT 0,
    "written_off_amount" double precision DEFAULT 0,
    "written_off_date" "text",
    "written_off_reason" "text",
    "rate_agreement_id" bigint,
    "sales_consultant_id" bigint,
    "consultant_share_rate" double precision,
    "consultant_share_amount" double precision,
    "consultant_role" "text",
    "created_via" "text",
    "accrual_basis_amount" numeric(12,2),
    "entitlement_rate" numeric(5,4),
    "role" "text",
    "payee_user_id" integer,
    "payee_partner_id" integer,
    "amount_received_to_date" numeric(12,2) DEFAULT 0 NOT NULL,
    "last_received_at" "date"
);


ALTER TABLE "public"."commission_tracking" OWNER TO "postgres";


ALTER TABLE "public"."commission_tracking" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."commission_tracking_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."communication_logs" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "application_id" bigint,
    "communication_type" "text" DEFAULT 'note'::"text" NOT NULL,
    "subject" "text",
    "content" "text",
    "direction" "text" DEFAULT 'outbound'::"text",
    "staff_id" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1,
    "is_read_by_client" bigint DEFAULT 0 NOT NULL,
    "client_read_at" "text"
);


ALTER TABLE "public"."communication_logs" OWNER TO "postgres";


ALTER TABLE "public"."communication_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."communication_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."compliance_alerts" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "client_id" integer,
    "application_id" integer,
    "alert_type" character varying(100) NOT NULL,
    "severity" character varying(20) DEFAULT 'medium'::character varying,
    "title" character varying(255) NOT NULL,
    "description" "text",
    "recommended_action" "text",
    "is_resolved" boolean DEFAULT false,
    "resolved_at" timestamp with time zone,
    "resolved_by" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "compliance_alerts_severity_check" CHECK ((("severity")::"text" = ANY ((ARRAY['low'::character varying, 'medium'::character varying, 'high'::character varying, 'critical'::character varying])::"text"[])))
);


ALTER TABLE "public"."compliance_alerts" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."compliance_alerts_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."compliance_alerts_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."compliance_alerts_id_seq" OWNED BY "public"."compliance_alerts"."id";



CREATE TABLE IF NOT EXISTS "public"."courses" (
    "id" bigint NOT NULL,
    "institution_id" bigint NOT NULL,
    "course_name" "text" NOT NULL,
    "course_code" "text",
    "cricos_code" "text",
    "qualification_level" "text",
    "study_area" "text",
    "duration" "text",
    "tuition_fee" double precision,
    "intake_months" "text",
    "campus_locations" "text",
    "delivery_mode" "text" DEFAULT 'on_campus'::"text",
    "english_requirement" "text",
    "academic_requirement" "text",
    "is_active" boolean DEFAULT true,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1,
    "semester_count" bigint,
    "tuition_per_year" numeric(12,2),
    "duration_years" numeric(4,2)
);


ALTER TABLE "public"."courses" OWNER TO "postgres";


ALTER TABLE "public"."courses" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."courses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."custom_pages" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "icon" "text" DEFAULT 'LayoutGrid'::"text" NOT NULL,
    "description" "text",
    "template_type" "text" NOT NULL,
    "sidebar_workspace" "text" DEFAULT 'tools'::"text" NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "table_name" "text" NOT NULL,
    "columns_config" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_by" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."custom_pages" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."custom_pages_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."custom_pages_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."custom_pages_id_seq" OWNED BY "public"."custom_pages"."id";



CREATE TABLE IF NOT EXISTS "public"."data_change_log" (
    "id" bigint NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" bigint NOT NULL,
    "action" "text" NOT NULL,
    "changed_by" bigint,
    "changed_fields" "text",
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    CONSTRAINT "data_change_log_action_check" CHECK (("action" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text", 'MERGE_KEEP'::"text", 'MERGE_DISCARD'::"text"])))
);


ALTER TABLE "public"."data_change_log" OWNER TO "postgres";


ALTER TABLE "public"."data_change_log" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."data_change_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."data_quality_audit_log" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" integer NOT NULL,
    "action" "text" NOT NULL,
    "old_score" real,
    "new_score" real,
    "fields_changed" "text" DEFAULT '[]'::"text",
    "performed_by" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "data_quality_audit_log_action_check" CHECK (("action" = ANY (ARRAY['scored'::"text", 'corrected'::"text", 'bulk_update'::"text"])))
);


ALTER TABLE "public"."data_quality_audit_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."data_quality_audit_log_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."data_quality_audit_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."data_quality_audit_log_id_seq" OWNED BY "public"."data_quality_audit_log"."id";



CREATE TABLE IF NOT EXISTS "public"."data_quality_rules" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "entity_type" "text" NOT NULL,
    "field_name" "text" NOT NULL,
    "is_required" integer DEFAULT 0,
    "weight" real DEFAULT 1.0,
    "validation_rule" "text" DEFAULT '{}'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."data_quality_rules" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."data_quality_rules_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."data_quality_rules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."data_quality_rules_id_seq" OWNED BY "public"."data_quality_rules"."id";



CREATE TABLE IF NOT EXISTS "public"."data_quality_scores" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" integer NOT NULL,
    "overall_score" real DEFAULT 0 NOT NULL,
    "completeness_score" real DEFAULT 0,
    "consistency_score" real DEFAULT 0,
    "critical_fields_missing" "text" DEFAULT '[]'::"text",
    "warnings" "text" DEFAULT '[]'::"text",
    "last_calculated_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."data_quality_scores" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."data_quality_scores_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."data_quality_scores_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."data_quality_scores_id_seq" OWNED BY "public"."data_quality_scores"."id";



CREATE TABLE IF NOT EXISTS "public"."document_checklist_template_items" (
    "id" bigint NOT NULL,
    "template_id" bigint NOT NULL,
    "document_name" "text" NOT NULL,
    "is_required" bigint DEFAULT 1 NOT NULL,
    "description" "text",
    "acceptable_formats" "text",
    "example_url" "text",
    "sort_order" bigint DEFAULT 0 NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."document_checklist_template_items" OWNER TO "postgres";


ALTER TABLE "public"."document_checklist_template_items" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."document_checklist_template_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."document_checklist_templates" (
    "id" bigint NOT NULL,
    "visa_subclass" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."document_checklist_templates" OWNER TO "postgres";


ALTER TABLE "public"."document_checklist_templates" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."document_checklist_templates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."document_expiry_tracking" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "client_id" integer,
    "document_type" character varying(100) NOT NULL,
    "document_name" character varying(255),
    "expiry_date" "date" NOT NULL,
    "alert_sent_90d" boolean DEFAULT false,
    "alert_sent_60d" boolean DEFAULT false,
    "alert_sent_30d" boolean DEFAULT false,
    "alert_sent_7d" boolean DEFAULT false,
    "is_renewed" boolean DEFAULT false,
    "renewed_at" timestamp with time zone,
    "extracted_by_ai" boolean DEFAULT false,
    "ai_confidence" numeric(3,2),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."document_expiry_tracking" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."document_expiry_tracking_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."document_expiry_tracking_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."document_expiry_tracking_id_seq" OWNED BY "public"."document_expiry_tracking"."id";



CREATE TABLE IF NOT EXISTS "public"."document_extractions" (
    "id" integer NOT NULL,
    "document_id" integer NOT NULL,
    "client_id" integer NOT NULL,
    "extraction_type" "text" NOT NULL,
    "status" "text" DEFAULT 'processing'::"text" NOT NULL,
    "extracted_data" "text",
    "confidence_scores" "text",
    "raw_text" "text",
    "error_message" "text",
    "reviewed_by" integer,
    "reviewed_at" "text",
    "applied_to_client_id" integer,
    "applied_to_application_id" integer,
    "created_by" integer,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"(),
    "tenant_id" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."document_extractions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."document_extractions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."document_extractions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."document_extractions_id_seq" OWNED BY "public"."document_extractions"."id";



CREATE TABLE IF NOT EXISTS "public"."document_requirement_reminders" (
    "id" integer NOT NULL,
    "requirement_id" integer NOT NULL,
    "sent_at" "text" DEFAULT "now"(),
    "reminder_count" integer DEFAULT 1,
    "created_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."document_requirement_reminders" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."document_requirement_reminders_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."document_requirement_reminders_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."document_requirement_reminders_id_seq" OWNED BY "public"."document_requirement_reminders"."id";



CREATE TABLE IF NOT EXISTS "public"."document_requirements" (
    "id" bigint NOT NULL,
    "visa_type" "text" NOT NULL,
    "document_name" "text" NOT NULL,
    "description" "text",
    "is_mandatory" bigint DEFAULT 1,
    "category" "text" DEFAULT 'identity'::"text",
    "sort_order" bigint DEFAULT 0,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."document_requirements" OWNER TO "postgres";


ALTER TABLE "public"."document_requirements" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."document_requirements_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."education_history" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "institution_name" "text" NOT NULL,
    "institution_id" bigint,
    "country" "text" DEFAULT 'Australia'::"text",
    "qualification_level" "text",
    "qualification_name" "text",
    "field_of_study" "text",
    "start_date" "text",
    "end_date" "text",
    "gpa" "text",
    "is_australian" bigint DEFAULT 0,
    "is_assessed" bigint DEFAULT 0,
    "assessment_authority" "text",
    "assessment_result" "text",
    "assessment_date" "text",
    "notes" "text",
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."education_history" OWNER TO "postgres";


ALTER TABLE "public"."education_history" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."education_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."employment_history" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "employer_name" "text" NOT NULL,
    "job_title" "text" NOT NULL,
    "country" "text" DEFAULT 'Australia'::"text",
    "city" "text",
    "occupation_code" "text",
    "is_skilled" bigint DEFAULT 0,
    "is_australian" bigint DEFAULT 0,
    "employment_type" "text" DEFAULT 'full_time'::"text",
    "start_date" "text",
    "end_date" "text",
    "hours_per_week" double precision,
    "duties" "text",
    "reference_name" "text",
    "reference_phone" "text",
    "reference_email" "text",
    "notes" "text",
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."employment_history" OWNER TO "postgres";


ALTER TABLE "public"."employment_history" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."employment_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."english_scores" (
    "id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "test_type" "text" NOT NULL,
    "test_date" "text",
    "expiry_date" "text",
    "overall" double precision,
    "listening" double precision,
    "reading" double precision,
    "writing" double precision,
    "speaking" double precision,
    "is_used_for_application" bigint DEFAULT 0,
    "application_id" bigint,
    "notes" "text",
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."english_scores" OWNER TO "postgres";


ALTER TABLE "public"."english_scores" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."english_scores_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."enquiries" (
    "id" bigint NOT NULL,
    "enquiry_number" "text",
    "client_id" bigint,
    "lead_id" bigint,
    "contact_name" "text",
    "contact_phone" "text",
    "contact_email" "text",
    "enquiry_type" "text" DEFAULT 'general'::"text",
    "subject" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'open'::"text",
    "priority" "text" DEFAULT 'normal'::"text",
    "response" "text",
    "assigned_to" bigint,
    "office_id" bigint DEFAULT 1,
    "follow_up_date" "text",
    "notes" "text",
    "converted_application_id" bigint,
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."enquiries" OWNER TO "postgres";


ALTER TABLE "public"."enquiries" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."enquiries_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."enrolments" (
    "id" bigint NOT NULL,
    "enrolment_number" "text",
    "client_id" bigint NOT NULL,
    "course_id" bigint NOT NULL,
    "application_id" bigint,
    "status" "text" DEFAULT 'pending'::"text",
    "start_date" "text",
    "end_date" "text",
    "coe_number" "text",
    "coe_issue_date" "text",
    "coe_expiry_date" "text",
    "tuition_paid" double precision DEFAULT 0,
    "tuition_total" double precision,
    "oshc_provider" "text",
    "oshc_expiry" "text",
    "office_id" bigint DEFAULT 1,
    "assigned_consultant_id" bigint,
    "sales_person_id" bigint,
    "handler_id" bigint,
    "notes" "text",
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1,
    "total_semesters" bigint,
    "current_semester" bigint,
    "dropout_date" "text",
    "dropout_reason" "text",
    "dropout_semester" bigint,
    "course_intake" "text",
    "tuition_deposit_required" numeric(12,2),
    "deposit_paid" boolean DEFAULT false NOT NULL,
    "deposit_paid_at" "date",
    "payment_plan_json" "jsonb",
    "institution_student_id" "text",
    "coe_file_url" "text",
    "partner_id" integer,
    "date_of_entry" "date",
    "enrolment_stage" "text"
);


ALTER TABLE "public"."enrolments" OWNER TO "postgres";


ALTER TABLE "public"."enrolments" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."enrolments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."error_logs" (
    "id" integer NOT NULL,
    "user_id" integer,
    "command" "text",
    "error_type" "text",
    "error_message" "text",
    "traceback" "text",
    "timestamp" "text" DEFAULT "now"()
);


ALTER TABLE "public"."error_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."error_logs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."error_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."error_logs_id_seq" OWNED BY "public"."error_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."immiaccount_config" (
    "id" bigint NOT NULL,
    "client_id" "text",
    "client_secret" "text",
    "redirect_uri" "text",
    "access_token" "text",
    "refresh_token" "text",
    "token_expires_at" "text",
    "sync_frequency" "text" DEFAULT 'daily'::"text",
    "is_enabled" bigint DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."immiaccount_config" OWNER TO "postgres";


ALTER TABLE "public"."immiaccount_config" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."immiaccount_config_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."immiaccount_status_mappings" (
    "id" bigint NOT NULL,
    "immiaccount_status" "text" NOT NULL,
    "bsmart_stage" "text" NOT NULL,
    "description" "text",
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."immiaccount_status_mappings" OWNER TO "postgres";


ALTER TABLE "public"."immiaccount_status_mappings" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."immiaccount_status_mappings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."immiaccount_sync_logs" (
    "id" bigint NOT NULL,
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "sync_started_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text" NOT NULL,
    "sync_completed_at" "text",
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "applications_synced" bigint DEFAULT 0,
    "applications_updated" bigint DEFAULT 0,
    "applications_failed" bigint DEFAULT 0,
    "error_message" "text",
    "error_details" "text",
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."immiaccount_sync_logs" OWNER TO "postgres";


ALTER TABLE "public"."immiaccount_sync_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."immiaccount_sync_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."institution_rate_agreements" (
    "id" integer NOT NULL,
    "institution_id" integer NOT NULL,
    "course_level" "text",
    "course_id" integer,
    "rate_type" "text" DEFAULT 'percentage'::"text",
    "rate_value" real NOT NULL,
    "gst_inclusive" integer DEFAULT 0,
    "effective_from" "text" NOT NULL,
    "effective_to" "text",
    "currency" "text" DEFAULT 'AUD'::"text",
    "notes" "text",
    "is_active" boolean DEFAULT true,
    "created_by" integer,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."institution_rate_agreements" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."institution_rate_agreements_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."institution_rate_agreements_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."institution_rate_agreements_id_seq" OWNED BY "public"."institution_rate_agreements"."id";



CREATE TABLE IF NOT EXISTS "public"."institutions" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "short_name" "text",
    "institution_type" "text",
    "state" "text",
    "city" "text",
    "website" "text",
    "primary_contact_name" "text",
    "primary_contact_email" "text",
    "primary_contact_phone" "text",
    "partnership_tier" "text" DEFAULT 'standard'::"text",
    "commission_rate" double precision,
    "notes" "text",
    "is_active" boolean DEFAULT true,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1,
    "country" "text",
    "agent_agreement_signed" boolean DEFAULT false NOT NULL,
    "agent_agreement_signed_at" timestamp with time zone,
    "claim_schedule" "text",
    "gst_applicable" boolean DEFAULT false NOT NULL,
    "claim_rule" "text",
    "agreement_expiry_date" "date",
    "agreement_file_url" "text",
    "cricos_provider_code" "text",
    CONSTRAINT "institutions_claim_schedule_check" CHECK (("claim_schedule" = ANY (ARRAY['monthly'::"text", 'quarterly'::"text", 'semi_annual'::"text", 'on_demand'::"text", 'lump_sum'::"text"])))
);


ALTER TABLE "public"."institutions" OWNER TO "postgres";


ALTER TABLE "public"."institutions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."institutions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."invoice_items" (
    "id" bigint NOT NULL,
    "invoice_id" bigint NOT NULL,
    "description" "text" NOT NULL,
    "quantity" double precision DEFAULT 1,
    "unit_price" double precision NOT NULL,
    "amount" double precision NOT NULL,
    "item_type" "text" DEFAULT 'service'::"text",
    "sort_order" bigint DEFAULT 0,
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."invoice_items" OWNER TO "postgres";


ALTER TABLE "public"."invoice_items" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."invoice_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" bigint NOT NULL,
    "invoice_number" "text" NOT NULL,
    "client_id" bigint NOT NULL,
    "application_id" bigint,
    "status" "text" DEFAULT 'draft'::"text",
    "issue_date" "text" NOT NULL,
    "due_date" "text" NOT NULL,
    "subtotal" double precision DEFAULT 0,
    "tax_rate" double precision DEFAULT 0.10,
    "tax_amount" double precision DEFAULT 0,
    "total" double precision DEFAULT 0,
    "amount_paid" double precision DEFAULT 0,
    "notes" "text",
    "payment_terms" "text" DEFAULT 'Net 14'::"text",
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "discount_amount" double precision DEFAULT 0,
    "tenant_id" bigint DEFAULT 1,
    "xero_invoice_id" "text",
    "myob_invoice_id" "text"
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


ALTER TABLE "public"."invoices" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."invoices_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."kb_admin_logs" (
    "id" integer NOT NULL,
    "admin_id" integer NOT NULL,
    "action" "text" NOT NULL,
    "table_name" "text" NOT NULL,
    "record_id" "text" NOT NULL,
    "old_value" "text",
    "new_value" "text",
    "timestamp" "text" DEFAULT "now"()
);


ALTER TABLE "public"."kb_admin_logs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_admin_logs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_admin_logs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_admin_logs_id_seq" OWNED BY "public"."kb_admin_logs"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_alternative_authorities" (
    "id" integer NOT NULL,
    "anzsco_code" "text" NOT NULL,
    "authority_code" "text" NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."kb_alternative_authorities" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_alternative_authorities_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_alternative_authorities_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_alternative_authorities_id_seq" OWNED BY "public"."kb_alternative_authorities"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_assessing_authorities" (
    "code" "text" NOT NULL,
    "name_en" "text",
    "website" "text",
    "typical_fee_aud" "text",
    "typical_time_weeks" "text",
    "fee_updated_at" "text",
    "validity_months" integer DEFAULT 12,
    "last_updated" "text",
    "assessment_types" "text",
    "priority_fee_aud" "text",
    "appeal_fee_aud" "text",
    "notes" "text"
);


ALTER TABLE "public"."kb_assessing_authorities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kb_assessment_pathways" (
    "id" integer NOT NULL,
    "authority_code" "text" NOT NULL,
    "pathway_name" "text",
    "description" "text",
    "fee_aud" "text",
    "processing_weeks" "text",
    "eligibility" "text"
);


ALTER TABLE "public"."kb_assessment_pathways" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_assessment_pathways_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_assessment_pathways_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_assessment_pathways_id_seq" OWNED BY "public"."kb_assessment_pathways"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_authority_process_steps" (
    "id" integer NOT NULL,
    "authority_code" "text",
    "step_number" integer,
    "step_title" "text",
    "step_content" "text"
);


ALTER TABLE "public"."kb_authority_process_steps" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_authority_process_steps_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_authority_process_steps_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_authority_process_steps_id_seq" OWNED BY "public"."kb_authority_process_steps"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_authority_rules" (
    "id" integer NOT NULL,
    "authority_code" "text" NOT NULL,
    "rule_category" "text",
    "rule_text" "text",
    "notes" "text"
);


ALTER TABLE "public"."kb_authority_rules" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_authority_rules_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_authority_rules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_authority_rules_id_seq" OWNED BY "public"."kb_authority_rules"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_change_history" (
    "id" bigint NOT NULL,
    "table_name" "text" NOT NULL,
    "field_name" "text" NOT NULL,
    "record_id" bigint,
    "old_value" "text",
    "new_value" "text",
    "change_type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "detected_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "reviewed_by" bigint,
    "approved_at" "text",
    "notes" "text",
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    CONSTRAINT "kb_change_history_change_type_check" CHECK (("change_type" = ANY (ARRAY['insert'::"text", 'update'::"text", 'delete'::"text"]))),
    CONSTRAINT "kb_change_history_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."kb_change_history" OWNER TO "postgres";


ALTER TABLE "public"."kb_change_history" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."kb_change_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."kb_change_snapshots" (
    "id" integer NOT NULL,
    "table_name" "text" NOT NULL,
    "snapshot_data" "jsonb" NOT NULL,
    "tenant_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."kb_change_snapshots" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_change_snapshots_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_change_snapshots_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_change_snapshots_id_seq" OWNED BY "public"."kb_change_snapshots"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_common_mistakes" (
    "id" integer NOT NULL,
    "category" "text",
    "mistake_zh" "text",
    "consequence_zh" "text",
    "prevention_zh" "text"
);


ALTER TABLE "public"."kb_common_mistakes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_common_mistakes_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_common_mistakes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_common_mistakes_id_seq" OWNED BY "public"."kb_common_mistakes"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_cricos_courses" (
    "cricos_course_code" "text" NOT NULL,
    "cricos_provider_code" "text" NOT NULL,
    "course_name" "text" NOT NULL,
    "vet_national_code" "text",
    "dual_qualification" boolean,
    "field_of_education" "text",
    "course_level" "text",
    "foundation_studies" boolean,
    "work_component" "text",
    "course_language" "text",
    "duration_weeks" integer,
    "tuition_fee" numeric(12,2),
    "non_tuition_fee" numeric(12,2),
    "estimated_total_cost" numeric(12,2),
    "last_imported_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."kb_cricos_courses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kb_cricos_providers" (
    "cricos_provider_code" "text" NOT NULL,
    "trading_name" "text",
    "institution_name" "text" NOT NULL,
    "institution_type" "text",
    "institution_capacity" integer,
    "website" "text",
    "address_line1" "text",
    "address_line2" "text",
    "address_line3" "text",
    "address_line4" "text",
    "city" "text",
    "state" "text",
    "postcode" "text",
    "promoted_to_institution_id" integer,
    "last_imported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."kb_cricos_providers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kb_document_checklist" (
    "id" integer NOT NULL,
    "nuance_id" "text",
    "document_name_zh" "text",
    "description_zh" "text"
);


ALTER TABLE "public"."kb_document_checklist" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_document_checklist_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_document_checklist_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_document_checklist_id_seq" OWNED BY "public"."kb_document_checklist"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_eligibility_nuances" (
    "nuance_id" "text" NOT NULL,
    "topic" "text",
    "trigger_keyword" "text",
    "rule_summary_zh" "text",
    "severity" "text"
);


ALTER TABLE "public"."kb_eligibility_nuances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kb_english_reqs_specific" (
    "authority_code" "text",
    "profession_group" "text",
    "requirement_text" "text"
);


ALTER TABLE "public"."kb_english_reqs_specific" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kb_eoi_rules" (
    "rule_id" "text" NOT NULL,
    "rule_category" "text",
    "rule_description" "text",
    "impact" "text"
);


ALTER TABLE "public"."kb_eoi_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kb_exemptions" (
    "id" integer NOT NULL,
    "authority_code" "text",
    "exemption_type" "text",
    "condition_text" "text",
    "notes" "text"
);


ALTER TABLE "public"."kb_exemptions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_exemptions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_exemptions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_exemptions_id_seq" OWNED BY "public"."kb_exemptions"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_faq" (
    "id" integer NOT NULL,
    "category" "text",
    "question_zh" "text",
    "answer_zh" "text"
);


ALTER TABLE "public"."kb_faq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_faq_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_faq_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_faq_id_seq" OWNED BY "public"."kb_faq"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_health_character_requirements" (
    "id" integer NOT NULL,
    "requirement_type" "text",
    "requirement_name" "text",
    "description" "text",
    "validity_period" "text",
    "cost_aud" "text",
    "notes" "text"
);


ALTER TABLE "public"."kb_health_character_requirements" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_health_character_requirements_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_health_character_requirements_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_health_character_requirements_id_seq" OWNED BY "public"."kb_health_character_requirements"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_invitation_rounds" (
    "id" integer NOT NULL,
    "round_date" "text",
    "visa_subclass" "text",
    "invitations_issued" integer,
    "min_score" integer,
    "cutoff_date" "text"
);


ALTER TABLE "public"."kb_invitation_rounds" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_invitation_rounds_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_invitation_rounds_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_invitation_rounds_id_seq" OWNED BY "public"."kb_invitation_rounds"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_invitation_trends" (
    "id" integer NOT NULL,
    "state_code" "text",
    "sector" "text",
    "typical_score" "text",
    "notes" "text",
    "visa_type" "text",
    "round_date" "text",
    "invitations_issued" integer,
    "min_points" integer,
    "occupation_groups" "text",
    "processing_time" "text"
);


ALTER TABLE "public"."kb_invitation_trends" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_invitation_trends_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_invitation_trends_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_invitation_trends_id_seq" OWNED BY "public"."kb_invitation_trends"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_occupation_tiers" (
    "tier" integer NOT NULL,
    "tier_name" "text",
    "description" "text",
    "invitation_priority" "text",
    "typical_score_range" "text"
);


ALTER TABLE "public"."kb_occupation_tiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kb_occupations" (
    "anzsco_code" "text" NOT NULL,
    "title_en" "text" NOT NULL,
    "authority_code" "text",
    "list_type" "text",
    "visa_189" boolean,
    "visa_190" boolean,
    "visa_491" boolean,
    "tier" integer DEFAULT 3,
    "visa_482" boolean DEFAULT false,
    "visa_494" boolean DEFAULT false,
    "visa_186" boolean DEFAULT false,
    "visa_485" boolean DEFAULT false,
    "on_csol" boolean DEFAULT false,
    "updated_at" "text"
);


ALTER TABLE "public"."kb_occupations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kb_partner_points_rules" (
    "id" integer NOT NULL,
    "scenario" "text",
    "requirements" "text",
    "points" integer
);


ALTER TABLE "public"."kb_partner_points_rules" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_partner_points_rules_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_partner_points_rules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_partner_points_rules_id_seq" OWNED BY "public"."kb_partner_points_rules"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_points_rules" (
    "id" integer NOT NULL,
    "category" "text",
    "category_zh" "text",
    "condition" "text",
    "condition_zh" "text",
    "points" integer,
    "max_points" integer,
    "notes" "text",
    "step_order" integer
);


ALTER TABLE "public"."kb_points_rules" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_points_rules_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_points_rules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_points_rules_id_seq" OWNED BY "public"."kb_points_rules"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_state_invitation_scores" (
    "id" integer NOT NULL,
    "state_code" "text",
    "anzsco_code" "text",
    "occupation_title" "text",
    "visa_subclass" "text",
    "min_score" integer,
    "max_score" integer,
    "last_updated" "text"
);


ALTER TABLE "public"."kb_state_invitation_scores" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_state_invitation_scores_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_state_invitation_scores_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_state_invitation_scores_id_seq" OWNED BY "public"."kb_state_invitation_scores"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_state_quotas" (
    "state_code" "text" NOT NULL,
    "quota_190" integer,
    "quota_491" integer,
    "last_updated" "date"
);


ALTER TABLE "public"."kb_state_quotas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kb_state_rules" (
    "id" integer NOT NULL,
    "state_code" "text",
    "rule_category" "text",
    "content" "text"
);


ALTER TABLE "public"."kb_state_rules" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_state_rules_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_state_rules_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_state_rules_id_seq" OWNED BY "public"."kb_state_rules"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_step_documents" (
    "id" integer NOT NULL,
    "authority_code" "text" NOT NULL,
    "step_number" integer NOT NULL,
    "document_name" "text" NOT NULL,
    "document_type" "text",
    "description" "text",
    "is_mandatory" integer DEFAULT 1
);


ALTER TABLE "public"."kb_step_documents" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_step_documents_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_step_documents_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_step_documents_id_seq" OWNED BY "public"."kb_step_documents"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_versions" (
    "id" integer NOT NULL,
    "table_name" "text" NOT NULL,
    "version_hash" "text" NOT NULL,
    "record_count" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp without time zone DEFAULT "now"(),
    "updated_by" "text",
    "notes" "text",
    "tenant_id" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."kb_versions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_versions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_versions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_versions_id_seq" OWNED BY "public"."kb_versions"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_visa_comparison" (
    "visa_subclass" "text" NOT NULL,
    "visa_name" "text",
    "visa_type" "text",
    "state_nomination_required" boolean,
    "residence_requirement" "text",
    "extra_points" integer,
    "occupation_list" "text",
    "pathway_to_pr" "text",
    "processing_time" "text",
    "validity" "text"
);


ALTER TABLE "public"."kb_visa_comparison" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kb_visa_constraints" (
    "rule_id" "text" NOT NULL,
    "description" "text",
    "variable" "text",
    "operator" "text",
    "threshold_value" "text",
    "fail_message_zh" "text",
    "severity" "text" DEFAULT 'Critical'::"text"
);


ALTER TABLE "public"."kb_visa_constraints" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."kb_visa_fees" (
    "id" integer NOT NULL,
    "visa_subclass" "text",
    "applicant_type" "text",
    "cost_aud" "text"
);


ALTER TABLE "public"."kb_visa_fees" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_visa_fees_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_visa_fees_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_visa_fees_id_seq" OWNED BY "public"."kb_visa_fees"."id";



CREATE TABLE IF NOT EXISTS "public"."kb_wizard_options" (
    "option_id" integer NOT NULL,
    "step_id" "text",
    "label_zh" "text",
    "value" "text",
    "points_val" integer
);


ALTER TABLE "public"."kb_wizard_options" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."kb_wizard_options_option_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."kb_wizard_options_option_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."kb_wizard_options_option_id_seq" OWNED BY "public"."kb_wizard_options"."option_id";



CREATE TABLE IF NOT EXISTS "public"."kb_wizard_steps" (
    "step_id" "text" NOT NULL,
    "question_zh" "text",
    "question_en" "text",
    "input_type" "text",
    "next_step_id" "text"
);


ALTER TABLE "public"."kb_wizard_steps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_ai_scores" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "lead_id" integer,
    "score" numeric(5,2) NOT NULL,
    "score_breakdown" "jsonb" DEFAULT '{}'::"jsonb",
    "recommended_action" character varying(100),
    "next_followup_at" timestamp with time zone,
    "scored_at" timestamp with time zone DEFAULT "now"(),
    "model_used" character varying(100)
);


ALTER TABLE "public"."lead_ai_scores" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."lead_ai_scores_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."lead_ai_scores_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."lead_ai_scores_id_seq" OWNED BY "public"."lead_ai_scores"."id";



CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" bigint NOT NULL,
    "lead_number" "text",
    "first_name" "text" NOT NULL,
    "last_name" "text" NOT NULL,
    "other_name" "text",
    "title" "text",
    "phone" "text",
    "email" "text",
    "im_account" "text",
    "im_type" "text",
    "source" "text" DEFAULT 'walk_in'::"text",
    "funnel_stage" "text" DEFAULT 'new'::"text",
    "interest_type" "text",
    "interest_detail" "text",
    "office_id" bigint DEFAULT 1,
    "assigned_to" bigint,
    "next_follow_up" "text",
    "notes" "text",
    "converted_client_id" bigint,
    "is_active" boolean DEFAULT true,
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1,
    "occupation" "text",
    "age_years" integer,
    "english_level" "text",
    "education_level" "text",
    "financial_capacity" "text",
    "ai_score" numeric(5,2),
    "ai_score_breakdown" "jsonb" DEFAULT '{}'::"jsonb",
    "ai_recommended_visa" character varying(20),
    "ai_score_summary" "text",
    "ai_scored_at" timestamp with time zone
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


ALTER TABLE "public"."leads" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."leads_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."notes" (
    "id" bigint NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" bigint NOT NULL,
    "content" "text" NOT NULL,
    "note_type" "text" DEFAULT 'general'::"text",
    "is_pinned" bigint DEFAULT 0,
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."notes" OWNER TO "postgres";


ALTER TABLE "public"."notes" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."notes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."notification_delivery_log" (
    "id" integer NOT NULL,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "user_id" integer NOT NULL,
    "notification_type" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "outcome" "text" NOT NULL,
    "skip_reason" "text",
    "created_at" "text" DEFAULT "now"(),
    CONSTRAINT "notification_delivery_log_outcome_check" CHECK (("outcome" = ANY (ARRAY['sent'::"text", 'skipped'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."notification_delivery_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."notification_delivery_log_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."notification_delivery_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."notification_delivery_log_id_seq" OWNED BY "public"."notification_delivery_log"."id";



CREATE TABLE IF NOT EXISTS "public"."notification_preferences" (
    "id" integer NOT NULL,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "user_id" integer NOT NULL,
    "notification_type" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"(),
    CONSTRAINT "notification_preferences_channel_check" CHECK (("channel" = ANY (ARRAY['in_app'::"text", 'email'::"text", 'push'::"text"])))
);


ALTER TABLE "public"."notification_preferences" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."notification_preferences_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."notification_preferences_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."notification_preferences_id_seq" OWNED BY "public"."notification_preferences"."id";



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" bigint NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" DEFAULT ''::"text",
    "link" "text",
    "target_user_id" bigint,
    "is_read" bigint DEFAULT 0,
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1,
    "category" "text",
    "priority" "text" DEFAULT 'normal'::"text",
    "expires_at" "text"
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


ALTER TABLE "public"."notifications" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."notifications_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."obs_activity_records" (
    "id" integer NOT NULL,
    "activity_id" "text" NOT NULL,
    "event_time" "text" NOT NULL,
    "event_name" "text" DEFAULT ''::"text" NOT NULL,
    "event_type" "text" DEFAULT 'api_request'::"text" NOT NULL,
    "source" "text" DEFAULT 'backend'::"text" NOT NULL,
    "trace_id" "text",
    "correlation_id" "text",
    "session_id" "text",
    "actor_id" integer,
    "actor_name" "text",
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "target_type" "text",
    "target_id" "text",
    "result" "text" DEFAULT 'success'::"text",
    "result_detail" "text",
    "duration_ms" real,
    "metadata" "text"
);


ALTER TABLE "public"."obs_activity_records" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."obs_activity_records_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."obs_activity_records_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."obs_activity_records_id_seq" OWNED BY "public"."obs_activity_records"."id";



CREATE TABLE IF NOT EXISTS "public"."obs_error_records" (
    "id" integer NOT NULL,
    "error_id" "text" NOT NULL,
    "timestamp" "text" NOT NULL,
    "severity" "text" DEFAULT 'error'::"text" NOT NULL,
    "category" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "source" "text" DEFAULT 'backend'::"text" NOT NULL,
    "trace_id" "text",
    "correlation_id" "text",
    "span_id" "text",
    "session_id" "text",
    "request_id" "text",
    "user_message" "text",
    "developer_message" "text",
    "error_type" "text",
    "stack_trace" "text",
    "method" "text",
    "path" "text",
    "status_code" integer,
    "duration_ms" real,
    "user_id" integer,
    "username" "text",
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "context" "text",
    "resolved" integer DEFAULT 0,
    "resolved_at" "text",
    "resolved_by" "text"
);


ALTER TABLE "public"."obs_error_records" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."obs_error_records_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."obs_error_records_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."obs_error_records_id_seq" OWNED BY "public"."obs_error_records"."id";



CREATE TABLE IF NOT EXISTS "public"."ocr_jobs" (
    "id" integer NOT NULL,
    "tenant_id" integer,
    "client_id" integer,
    "document_type" "text",
    "file_path" "text",
    "file_name" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "raw_text" "text",
    "extracted_data" "jsonb",
    "confidence_score" double precision,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "error_message" "text"
);


ALTER TABLE "public"."ocr_jobs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."ocr_jobs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."ocr_jobs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."ocr_jobs_id_seq" OWNED BY "public"."ocr_jobs"."id";



CREATE TABLE IF NOT EXISTS "public"."offices" (
    "id" bigint NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "address_line1" "text" NOT NULL,
    "address_line2" "text",
    "city" "text" NOT NULL,
    "state" "text" NOT NULL,
    "postal_code" "text" NOT NULL,
    "country" "text" DEFAULT 'Australia'::"text",
    "phone" "text",
    "fax" "text",
    "email" "text",
    "abn" "text",
    "business_hours" "text",
    "is_head_office" bigint DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."offices" OWNER TO "postgres";


ALTER TABLE "public"."offices" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."offices_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."partner_invites" (
    "id" integer NOT NULL,
    "partner_id" integer NOT NULL,
    "email" "text" NOT NULL,
    "token" "text" NOT NULL,
    "tenant_id" integer NOT NULL,
    "created_by" integer,
    "expires_at" "text" NOT NULL,
    "used_at" "text",
    "created_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."partner_invites" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."partner_invites_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."partner_invites_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."partner_invites_id_seq" OWNED BY "public"."partner_invites"."id";



CREATE TABLE IF NOT EXISTS "public"."partner_portal_users" (
    "id" integer NOT NULL,
    "partner_id" integer NOT NULL,
    "email" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "tenant_id" integer NOT NULL,
    "created_at" "text" DEFAULT "now"(),
    "failed_login_attempts" integer DEFAULT 0,
    "locked_until" "text",
    "last_login" "text"
);


ALTER TABLE "public"."partner_portal_users" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."partner_portal_users_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."partner_portal_users_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."partner_portal_users_id_seq" OWNED BY "public"."partner_portal_users"."id";



CREATE TABLE IF NOT EXISTS "public"."partners" (
    "id" bigint NOT NULL,
    "partner_number" "text",
    "company_name" "text" NOT NULL,
    "contact_name" "text",
    "contact_phone" "text",
    "contact_email" "text",
    "address" "text",
    "partner_type" "text" DEFAULT 'agent'::"text",
    "region" "text",
    "commission_rate" double precision,
    "agreement_start" "text",
    "agreement_end" "text",
    "bank_details" "text",
    "office_id" bigint DEFAULT 1,
    "is_active" boolean DEFAULT true,
    "notes" "text",
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."partners" OWNER TO "postgres";


ALTER TABLE "public"."partners" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."partners_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" bigint NOT NULL,
    "invoice_id" bigint NOT NULL,
    "amount" double precision NOT NULL,
    "payment_method" "text" DEFAULT 'bank_transfer'::"text",
    "payment_date" "text" NOT NULL,
    "reference" "text",
    "notes" "text",
    "recorded_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


ALTER TABLE "public"."payments" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."payments_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "text" NOT NULL,
    "legacy_id" integer NOT NULL,
    "username" "text",
    "display_name" "text",
    "email" "text",
    "role" "text" DEFAULT 'consultant'::"text",
    "is_admin" boolean DEFAULT false,
    "last_login" timestamp with time zone
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."profiles_legacy_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."profiles_legacy_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."profiles_legacy_id_seq" OWNED BY "public"."profiles"."legacy_id";



CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "created_at" "text" DEFAULT "now"(),
    "tenant_id" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."push_subscriptions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."push_subscriptions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."push_subscriptions_id_seq" OWNED BY "public"."push_subscriptions"."id";



CREATE TABLE IF NOT EXISTS "public"."quotation_items" (
    "id" bigint NOT NULL,
    "quotation_id" bigint NOT NULL,
    "description" "text" NOT NULL,
    "quantity" double precision DEFAULT 1,
    "unit_price" double precision DEFAULT 0,
    "tax_rate" double precision DEFAULT 0.10,
    "amount" double precision DEFAULT 0,
    "tax_amount" double precision DEFAULT 0,
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."quotation_items" OWNER TO "postgres";


ALTER TABLE "public"."quotation_items" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."quotation_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."quotations" (
    "id" bigint NOT NULL,
    "quotation_number" "text",
    "client_id" bigint,
    "lead_id" bigint,
    "enquiry_id" bigint,
    "application_id" bigint,
    "status" "text" DEFAULT 'draft'::"text",
    "valid_until" "text",
    "subtotal" double precision DEFAULT 0,
    "tax_amount" double precision DEFAULT 0,
    "total" double precision DEFAULT 0,
    "discount_amount" double precision DEFAULT 0,
    "discount_reason" "text",
    "terms_conditions" "text",
    "notes" "text",
    "converted_invoice_id" bigint,
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."quotations" OWNER TO "postgres";


ALTER TABLE "public"."quotations" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."quotations_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."report_runs" (
    "id" integer NOT NULL,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "schedule_id" integer,
    "started_at" "text",
    "finished_at" "text",
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "artifact_path" "text",
    "artifact_size_bytes" integer,
    "recipients_sent" integer DEFAULT 0,
    "recipients_failed" integer DEFAULT 0,
    "recipients_results" "text",
    "error_class" "text",
    "error_msg" "text",
    "created_at" "text" DEFAULT "now"(),
    CONSTRAINT "report_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'success'::"text", 'failed'::"text", 'partial'::"text", 'skipped_no_smtp'::"text"])))
);


ALTER TABLE "public"."report_runs" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."report_runs_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."report_runs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."report_runs_id_seq" OWNED BY "public"."report_runs"."id";



CREATE TABLE IF NOT EXISTS "public"."risk_assessments" (
    "id" integer NOT NULL,
    "application_id" integer NOT NULL,
    "client_id" integer,
    "tenant_id" integer NOT NULL,
    "risk_level" "text" NOT NULL,
    "risk_score" integer DEFAULT 0,
    "factors" "text" DEFAULT '[]'::"text",
    "summary" "text",
    "recommendations" "text" DEFAULT '[]'::"text",
    "model_used" "text",
    "tokens_used" integer DEFAULT 0,
    "created_by" integer,
    "created_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."risk_assessments" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."risk_assessments_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."risk_assessments_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."risk_assessments_id_seq" OWNED BY "public"."risk_assessments"."id";



CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" bigint NOT NULL,
    "name" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "description" "text",
    "permissions" "text" DEFAULT '[]'::"text" NOT NULL,
    "is_system" bigint DEFAULT 0,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."roles" OWNER TO "postgres";


ALTER TABLE "public"."roles" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."roles_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."scheduled_reports" (
    "id" integer NOT NULL,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "report_type" "text" NOT NULL,
    "frequency" "text" NOT NULL,
    "format" "text" DEFAULT 'pdf'::"text",
    "recipients" "text" NOT NULL,
    "filters" "text",
    "enabled" integer DEFAULT 1 NOT NULL,
    "created_by" integer,
    "user_id" integer,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"(),
    "last_run_at" "text",
    "next_run_at" "text",
    "last_run" "text",
    "next_run" "text"
);


ALTER TABLE "public"."scheduled_reports" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."scheduled_reports_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."scheduled_reports_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."scheduled_reports_id_seq" OWNED BY "public"."scheduled_reports"."id";



CREATE TABLE IF NOT EXISTS "public"."schema_versions" (
    "id" integer NOT NULL,
    "version" "text" NOT NULL,
    "description" "text",
    "applied_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."schema_versions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."schema_versions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."schema_versions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."schema_versions_id_seq" OWNED BY "public"."schema_versions"."id";



CREATE TABLE IF NOT EXISTS "public"."service_fee_plans" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "client_id" integer NOT NULL,
    "application_id" integer,
    "total_service_fee" real NOT NULL,
    "deposit_percentage" real DEFAULT 50.0,
    "deposit_amount" real NOT NULL,
    "deposit_invoice_id" integer,
    "deposit_status" "text" DEFAULT 'unpaid'::"text",
    "final_amount" real NOT NULL,
    "final_invoice_id" integer,
    "final_status" "text" DEFAULT 'unpaid'::"text",
    "additional_charges" "text" DEFAULT '[]'::"text",
    "notes" "text",
    "created_by" integer,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."service_fee_plans" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."service_fee_plans_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."service_fee_plans_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."service_fee_plans_id_seq" OWNED BY "public"."service_fee_plans"."id";



CREATE TABLE IF NOT EXISTS "public"."staff_achievements" (
    "id" integer NOT NULL,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "user_id" integer NOT NULL,
    "badge_type" "text" NOT NULL,
    "earned_at" "text" DEFAULT "now"(),
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."staff_achievements" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."staff_achievements_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."staff_achievements_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."staff_achievements_id_seq" OWNED BY "public"."staff_achievements"."id";



CREATE TABLE IF NOT EXISTS "public"."staff_audit_log" (
    "id" bigint NOT NULL,
    "user_id" bigint,
    "username" "text",
    "action" "text" NOT NULL,
    "method" "text",
    "path" "text",
    "resource_type" "text",
    "resource_id" "text",
    "ip_address" "text",
    "user_agent" "text",
    "status_code" bigint,
    "risk_level" "text" DEFAULT 'low'::"text" NOT NULL,
    "details" "text",
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text" NOT NULL
);


ALTER TABLE "public"."staff_audit_log" OWNER TO "postgres";


ALTER TABLE "public"."staff_audit_log" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."staff_audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."staff_goals" (
    "id" integer NOT NULL,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "user_id" integer NOT NULL,
    "month" "text" NOT NULL,
    "target_applications" integer DEFAULT 0,
    "target_revenue" real DEFAULT 0,
    "target_client_satisfaction" real DEFAULT 0,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."staff_goals" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."staff_goals_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."staff_goals_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."staff_goals_id_seq" OWNED BY "public"."staff_goals"."id";



CREATE TABLE IF NOT EXISTS "public"."staff_performance_metrics" (
    "id" integer NOT NULL,
    "tenant_id" integer DEFAULT 1 NOT NULL,
    "user_id" integer NOT NULL,
    "month" "text" NOT NULL,
    "applications_processed" integer DEFAULT 0,
    "revenue_generated" real DEFAULT 0,
    "win_rate" real DEFAULT 0,
    "avg_processing_time_days" real DEFAULT 0,
    "avg_client_satisfaction" real DEFAULT 0,
    "tasks_completed" integer DEFAULT 0,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."staff_performance_metrics" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."staff_performance_metrics_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."staff_performance_metrics_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."staff_performance_metrics_id_seq" OWNED BY "public"."staff_performance_metrics"."id";



CREATE TABLE IF NOT EXISTS "public"."study_tour_participants" (
    "id" bigint NOT NULL,
    "tour_id" bigint NOT NULL,
    "client_id" bigint NOT NULL,
    "status" "text" DEFAULT 'registered'::"text",
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1,
    "registered_at" "text"
);


ALTER TABLE "public"."study_tour_participants" OWNER TO "postgres";


ALTER TABLE "public"."study_tour_participants" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."study_tour_participants_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."study_tours" (
    "id" bigint NOT NULL,
    "tour_number" "text",
    "tour_name" "text" NOT NULL,
    "destination" "text",
    "start_date" "text",
    "end_date" "text",
    "status" "text" DEFAULT 'planning'::"text",
    "max_participants" bigint,
    "price" double precision,
    "itinerary" "text",
    "partner_id" bigint,
    "coordinator_id" bigint,
    "office_id" bigint DEFAULT 1,
    "notes" "text",
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."study_tours" OWNER TO "postgres";


ALTER TABLE "public"."study_tours" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."study_tours_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."subscription_plans" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "max_users" integer DEFAULT 5,
    "max_clients" integer DEFAULT 100,
    "features" "text" DEFAULT '{}'::"text",
    "monthly_price" real DEFAULT 0,
    "annual_price" real DEFAULT 0,
    "stripe_price_id" "text",
    "is_active" boolean DEFAULT true,
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."subscription_plans" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."subscription_plans_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."subscription_plans_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."subscription_plans_id_seq" OWNED BY "public"."subscription_plans"."id";



CREATE TABLE IF NOT EXISTS "public"."suppliers" (
    "id" bigint NOT NULL,
    "supplier_number" "text",
    "company_name" "text" NOT NULL,
    "contact_name" "text",
    "contact_phone" "text",
    "contact_email" "text",
    "supplier_type" "text" DEFAULT 'translation'::"text",
    "abn" "text",
    "payment_terms" "text",
    "bank_details" "text",
    "office_id" bigint DEFAULT 1,
    "is_active" boolean DEFAULT true,
    "notes" "text",
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1,
    "country" "text",
    "website" "text"
);


ALTER TABLE "public"."suppliers" OWNER TO "postgres";


ALTER TABLE "public"."suppliers" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."suppliers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."survey_instances" (
    "id" bigint NOT NULL,
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "template_id" bigint NOT NULL,
    "client_id" bigint,
    "application_id" bigint,
    "trigger_type" "text",
    "access_token" "text" NOT NULL,
    "sent_at" "text",
    "responded_at" "text",
    "reminder_sent_at" "text",
    "reminder_count" bigint DEFAULT 0,
    "is_anonymous" bigint DEFAULT 0,
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."survey_instances" OWNER TO "postgres";


ALTER TABLE "public"."survey_instances" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."survey_instances_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."survey_responses" (
    "id" bigint NOT NULL,
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "survey_instance_id" bigint NOT NULL,
    "client_id" bigint,
    "agent_id" bigint,
    "nps_score" bigint,
    "satisfaction_score" bigint,
    "feedback_text" "text",
    "responses_json" "text" DEFAULT '{}'::"text",
    "is_anonymous" bigint DEFAULT 0,
    "response_language" "text" DEFAULT 'en'::"text",
    "ip_address" "text",
    "user_agent" "text",
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."survey_responses" OWNER TO "postgres";


ALTER TABLE "public"."survey_responses" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."survey_responses_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."survey_templates" (
    "id" bigint NOT NULL,
    "tenant_id" bigint DEFAULT 1 NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "language" "text" DEFAULT 'en'::"text",
    "questions_json" "text" DEFAULT '[]'::"text" NOT NULL,
    "trigger_type" "text",
    "is_active" boolean DEFAULT true,
    "created_by" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."survey_templates" OWNER TO "postgres";


ALTER TABLE "public"."survey_templates" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."survey_templates_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."system_settings" (
    "id" bigint NOT NULL,
    "key" "text" NOT NULL,
    "value" "text" DEFAULT ''::"text" NOT NULL,
    "category" "text" DEFAULT 'general'::"text",
    "description" "text",
    "is_system" bigint DEFAULT 0,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."system_settings" OWNER TO "postgres";


ALTER TABLE "public"."system_settings" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."system_settings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" bigint NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "priority" "text" DEFAULT 'medium'::"text",
    "client_id" bigint,
    "application_id" bigint,
    "assigned_to" bigint,
    "assigned_by" bigint,
    "due_date" "text",
    "completed_at" "text",
    "is_recurring" bigint DEFAULT 0,
    "recurrence_pattern" "text",
    "parent_task_id" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "created_by" bigint,
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


ALTER TABLE "public"."tasks" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."tasks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tenant_dashboard_defaults" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "role_name" "text" NOT NULL,
    "layout_json" "text" DEFAULT '[]'::"text" NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."tenant_dashboard_defaults" OWNER TO "postgres";


ALTER TABLE "public"."tenant_dashboard_defaults" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."tenant_dashboard_defaults_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tenant_onboarding_progress" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "current_step" "text" DEFAULT 'welcome'::"text",
    "completed_steps" "text" DEFAULT '[]'::"text",
    "branding_completed" bigint DEFAULT 0,
    "staff_invited" bigint DEFAULT 0,
    "data_imported" bigint DEFAULT 0,
    "is_completed" bigint DEFAULT 0,
    "completion_percentage" bigint DEFAULT 0,
    "skipped_steps" "text" DEFAULT '[]'::"text",
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."tenant_onboarding_progress" OWNER TO "postgres";


ALTER TABLE "public"."tenant_onboarding_progress" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."tenant_onboarding_progress_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tenant_settings" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "config_json" "text" DEFAULT '{}'::"text" NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."tenant_settings" OWNER TO "postgres";


ALTER TABLE "public"."tenant_settings" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."tenant_settings_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tenant_subscriptions" (
    "id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "plan_id" integer,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "status" "text" DEFAULT 'trialing'::"text",
    "current_period_start" "text",
    "current_period_end" "text",
    "trial_end" "text",
    "created_at" "text" DEFAULT "now"(),
    "updated_at" "text" DEFAULT "now"()
);


ALTER TABLE "public"."tenant_subscriptions" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."tenant_subscriptions_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."tenant_subscriptions_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."tenant_subscriptions_id_seq" OWNED BY "public"."tenant_subscriptions"."id";



CREATE TABLE IF NOT EXISTS "public"."tenant_usage_logs" (
    "id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "month" "text" NOT NULL,
    "api_calls_count" bigint DEFAULT 0 NOT NULL,
    "storage_bytes" bigint DEFAULT 0 NOT NULL,
    "active_users_count" bigint DEFAULT 0 NOT NULL,
    "clients_count" bigint DEFAULT 0 NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."tenant_usage_logs" OWNER TO "postgres";


ALTER TABLE "public"."tenant_usage_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."tenant_usage_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" bigint NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "subdomain" "text",
    "custom_domain" "text",
    "logo_url" "text",
    "primary_color" "text",
    "secondary_color" "text",
    "contact_email" "text",
    "plan_tier" "text" DEFAULT 'starter'::"text",
    "is_active" boolean DEFAULT true,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


ALTER TABLE "public"."tenants" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."tenants_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."time_logs" (
    "id" bigint NOT NULL,
    "user_id" bigint NOT NULL,
    "client_id" bigint,
    "application_id" bigint,
    "description" "text",
    "start_at" "text" NOT NULL,
    "end_at" "text",
    "duration_minutes" bigint DEFAULT 0 NOT NULL,
    "billable_minutes" bigint DEFAULT 0 NOT NULL,
    "hourly_rate" numeric DEFAULT 150 NOT NULL,
    "amount" numeric DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "invoice_id" bigint,
    "invoice_item_id" bigint,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."time_logs" OWNER TO "postgres";


ALTER TABLE "public"."time_logs" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."time_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."timer_status" (
    "id" bigint NOT NULL,
    "user_id" bigint NOT NULL,
    "running_time_log_id" bigint,
    "started_at" "text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."timer_status" OWNER TO "postgres";


ALTER TABLE "public"."timer_status" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."timer_status_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."usage_stats" (
    "id" integer NOT NULL,
    "user_id" integer,
    "command" "text" NOT NULL,
    "timestamp" "text" DEFAULT "now"()
);


ALTER TABLE "public"."usage_stats" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."usage_stats_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."usage_stats_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."usage_stats_id_seq" OWNED BY "public"."usage_stats"."id";



CREATE TABLE IF NOT EXISTS "public"."user_dashboard_layouts" (
    "id" bigint NOT NULL,
    "user_id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "layout_json" "text" DEFAULT '[]'::"text" NOT NULL,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "updated_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text"
);


ALTER TABLE "public"."user_dashboard_layouts" OWNER TO "postgres";


ALTER TABLE "public"."user_dashboard_layouts" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."user_dashboard_layouts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" bigint NOT NULL,
    "user_id" bigint NOT NULL,
    "role_id" bigint NOT NULL,
    "assigned_by" bigint,
    "assigned_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "tenant_id" bigint DEFAULT 1
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


ALTER TABLE "public"."user_roles" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."user_roles_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."user_starred_items" (
    "id" integer NOT NULL,
    "user_id" integer NOT NULL,
    "tenant_id" integer NOT NULL,
    "item_type" "text" NOT NULL,
    "item_id" "text",
    "item_label" "text" NOT NULL,
    "item_url" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_starred_items_item_type_check" CHECK (("item_type" = ANY (ARRAY['page'::"text", 'client'::"text", 'task'::"text", 'study_tour'::"text", 'course'::"text", 'custom_page'::"text"])))
);


ALTER TABLE "public"."user_starred_items" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."user_starred_items_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."user_starred_items_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."user_starred_items_id_seq" OWNED BY "public"."user_starred_items"."id";



CREATE TABLE IF NOT EXISTS "public"."users" (
    "user_id" integer NOT NULL,
    "username" "text",
    "first_name" "text",
    "last_name" "text",
    "language_code" "text",
    "first_seen" "text" DEFAULT "now"(),
    "last_active" "text" DEFAULT "now"(),
    "is_blocked" integer DEFAULT 0
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."web_users" (
    "id" bigint NOT NULL,
    "username" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "display_name" "text",
    "is_admin" boolean DEFAULT true,
    "created_at" "text" DEFAULT (("now"() AT TIME ZONE 'utc'::"text"))::"text",
    "last_login" "text",
    "email" "text",
    "phone" "text",
    "role" "text" DEFAULT 'consultant'::"text",
    "languages" "text" DEFAULT '["english"]'::"text",
    "marn_number" "text",
    "qeac_number" "text",
    "specializations" "text" DEFAULT '[]'::"text",
    "avatar_url" "text",
    "is_super_admin" boolean DEFAULT true,
    "tenant_id" bigint DEFAULT 1,
    "tour_completed" integer DEFAULT 0,
    "failed_login_attempts" integer DEFAULT 0,
    "locked_until" "text",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."web_users" OWNER TO "postgres";


ALTER TABLE "public"."web_users" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."web_users_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."agent_calls" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."agent_calls_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."agent_config" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."agent_config_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."agent_schedule_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."agent_schedule_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."agent_schedules" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."agent_schedules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ai_interactions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ai_interactions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."application_checklist_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."application_checklist_items_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."appointments" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."appointments_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."auth_otp_attempts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."auth_otp_attempts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."automation_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."automation_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."automation_rules" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."automation_rules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."calendar_sync_tokens" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."calendar_sync_tokens_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."client_assessment_progress" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."client_assessment_progress_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."client_feedback" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."client_feedback_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."commission_claim_reports" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."commission_claim_reports_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."commission_entitlements" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."commission_entitlements_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."commission_rate_config" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."commission_rate_config_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."commission_school_receipts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."commission_school_receipts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."compliance_alerts" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."compliance_alerts_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."custom_pages" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."custom_pages_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."data_quality_audit_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."data_quality_audit_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."data_quality_rules" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."data_quality_rules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."data_quality_scores" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."data_quality_scores_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."document_expiry_tracking" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."document_expiry_tracking_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."document_extractions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."document_extractions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."document_requirement_reminders" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."document_requirement_reminders_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."error_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."error_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."institution_rate_agreements" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."institution_rate_agreements_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_admin_logs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_admin_logs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_alternative_authorities" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_alternative_authorities_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_assessment_pathways" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_assessment_pathways_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_authority_process_steps" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_authority_process_steps_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_authority_rules" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_authority_rules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_change_snapshots" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_change_snapshots_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_common_mistakes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_common_mistakes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_document_checklist" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_document_checklist_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_exemptions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_exemptions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_faq" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_faq_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_health_character_requirements" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_health_character_requirements_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_invitation_rounds" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_invitation_rounds_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_invitation_trends" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_invitation_trends_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_partner_points_rules" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_partner_points_rules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_points_rules" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_points_rules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_state_invitation_scores" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_state_invitation_scores_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_state_rules" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_state_rules_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_step_documents" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_step_documents_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_versions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_versions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_visa_fees" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."kb_visa_fees_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."kb_wizard_options" ALTER COLUMN "option_id" SET DEFAULT "nextval"('"public"."kb_wizard_options_option_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."lead_ai_scores" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."lead_ai_scores_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."notification_delivery_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."notification_delivery_log_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."notification_preferences" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."notification_preferences_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."obs_activity_records" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."obs_activity_records_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."obs_error_records" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."obs_error_records_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."ocr_jobs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."ocr_jobs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."partner_invites" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."partner_invites_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."partner_portal_users" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."partner_portal_users_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."profiles" ALTER COLUMN "legacy_id" SET DEFAULT "nextval"('"public"."profiles_legacy_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."push_subscriptions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."push_subscriptions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."report_runs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."report_runs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."risk_assessments" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."risk_assessments_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."scheduled_reports" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."scheduled_reports_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."schema_versions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."schema_versions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."service_fee_plans" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."service_fee_plans_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."staff_achievements" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."staff_achievements_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."staff_goals" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."staff_goals_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."staff_performance_metrics" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."staff_performance_metrics_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."subscription_plans" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."subscription_plans_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."tenant_subscriptions" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."tenant_subscriptions_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."usage_stats" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."usage_stats_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."user_starred_items" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."user_starred_items_id_seq"'::"regclass");



ALTER TABLE ONLY "core"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."module_entitlements"
    ADD CONSTRAINT "module_entitlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."module_entitlements"
    ADD CONSTRAINT "module_entitlements_tenant_id_module_key_role_scope_key" UNIQUE ("tenant_id", "module_key", "role_scope");



ALTER TABLE ONLY "core"."offices"
    ADD CONSTRAINT "offices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."offices"
    ADD CONSTRAINT "offices_tenant_id_code_key" UNIQUE ("tenant_id", "code");



ALTER TABLE ONLY "core"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "core"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "core"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."roles"
    ADD CONSTRAINT "roles_tenant_id_role_key_key" UNIQUE ("tenant_id", "role_key");



ALTER TABLE ONLY "core"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_tenant_id_user_id_role_key_key" UNIQUE ("tenant_id", "user_id", "role_key");



ALTER TABLE ONLY "core"."tenants"
    ADD CONSTRAINT "tenants_custom_domain_key" UNIQUE ("custom_domain");



ALTER TABLE ONLY "core"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "core"."tenants"
    ADD CONSTRAINT "tenants_public_id_key" UNIQUE ("public_id");



ALTER TABLE ONLY "core"."tenants"
    ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "core"."tenants"
    ADD CONSTRAINT "tenants_subdomain_key" UNIQUE ("subdomain");



ALTER TABLE ONLY "crm"."applications"
    ADD CONSTRAINT "applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "crm"."applications"
    ADD CONSTRAINT "applications_public_id_key" UNIQUE ("public_id");



ALTER TABLE ONLY "crm"."applications"
    ADD CONSTRAINT "applications_tenant_id_application_number_key" UNIQUE ("tenant_id", "application_number");



ALTER TABLE ONLY "crm"."client_notes"
    ADD CONSTRAINT "client_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "crm"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "crm"."clients"
    ADD CONSTRAINT "clients_public_id_key" UNIQUE ("public_id");



ALTER TABLE ONLY "crm"."clients"
    ADD CONSTRAINT "clients_tenant_id_client_number_key" UNIQUE ("tenant_id", "client_number");



ALTER TABLE ONLY "crm"."survey_instances"
    ADD CONSTRAINT "survey_instances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "crm"."survey_instances"
    ADD CONSTRAINT "survey_instances_public_token_key" UNIQUE ("public_token");



ALTER TABLE ONLY "crm"."survey_responses"
    ADD CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "crm"."survey_templates"
    ADD CONSTRAINT "survey_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "crm"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "law"."case_annotations"
    ADD CONSTRAINT "case_annotations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "law"."client_case_links"
    ADD CONSTRAINT "client_case_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "law"."client_case_links"
    ADD CONSTRAINT "client_case_links_tenant_id_client_id_case_id_link_type_key" UNIQUE ("tenant_id", "client_id", "case_id", "link_type");



ALTER TABLE ONLY "law"."research_sessions"
    ADD CONSTRAINT "research_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "law"."saved_searches"
    ADD CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "law"."saved_searches"
    ADD CONSTRAINT "saved_searches_tenant_id_owner_user_id_name_key" UNIQUE ("tenant_id", "owner_user_id", "name");



ALTER TABLE ONLY "public"."account_mappings"
    ADD CONSTRAINT "account_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accounting_integrations"
    ADD CONSTRAINT "accounting_integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."accounting_sync_logs"
    ADD CONSTRAINT "accounting_sync_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_calls"
    ADD CONSTRAINT "agent_calls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_config"
    ADD CONSTRAINT "agent_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_config"
    ADD CONSTRAINT "agent_config_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "public"."agent_schedule_logs"
    ADD CONSTRAINT "agent_schedule_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_schedules"
    ADD CONSTRAINT "agent_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_interactions"
    ADD CONSTRAINT "ai_interactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."application_checklist_items"
    ADD CONSTRAINT "application_checklist_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."application_compliance"
    ADD CONSTRAINT "application_compliance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."application_document_requirements"
    ADD CONSTRAINT "application_document_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."application_stage_history"
    ADD CONSTRAINT "application_stage_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."auth_otp_attempts"
    ADD CONSTRAINT "auth_otp_attempts_email_ip_address_key" UNIQUE ("email", "ip_address");



ALTER TABLE ONLY "public"."auth_otp_attempts"
    ADD CONSTRAINT "auth_otp_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_logs"
    ADD CONSTRAINT "automation_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."automation_rules"
    ADD CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_sync_tokens"
    ADD CONSTRAINT "calendar_sync_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_sync_tokens"
    ADD CONSTRAINT "calendar_sync_tokens_user_id_provider_tenant_id_key" UNIQUE ("user_id", "provider", "tenant_id");



ALTER TABLE ONLY "public"."client_activity_log"
    ADD CONSTRAINT "client_activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_assessment_progress"
    ADD CONSTRAINT "client_assessment_progress_client_id_authority_code_step_nu_key" UNIQUE ("client_id", "authority_code", "step_number");



ALTER TABLE ONLY "public"."client_assessment_progress"
    ADD CONSTRAINT "client_assessment_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_documents"
    ADD CONSTRAINT "client_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_feedback"
    ADD CONSTRAINT "client_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_milestones"
    ADD CONSTRAINT "client_milestones_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_notes"
    ADD CONSTRAINT "client_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_portal_activity"
    ADD CONSTRAINT "client_portal_activity_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_portal_intake_forms"
    ADD CONSTRAINT "client_portal_intake_forms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_portal_users"
    ADD CONSTRAINT "client_portal_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_claim_items"
    ADD CONSTRAINT "commission_claim_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_claim_reports"
    ADD CONSTRAINT "commission_claim_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_claims"
    ADD CONSTRAINT "commission_claims_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_entitlements"
    ADD CONSTRAINT "commission_entitlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_entitlements"
    ADD CONSTRAINT "commission_entitlements_tenant_id_payee_kind_payee_id_role_key" UNIQUE ("tenant_id", "payee_kind", "payee_id", "role");



ALTER TABLE ONLY "public"."commission_invoice_items"
    ADD CONSTRAINT "commission_invoice_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_invoices"
    ADD CONSTRAINT "commission_invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_payments"
    ADD CONSTRAINT "commission_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_rate_config"
    ADD CONSTRAINT "commission_rate_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_rate_config"
    ADD CONSTRAINT "commission_rate_config_tenant_id_commission_type_role_key" UNIQUE ("tenant_id", "commission_type", "role");



ALTER TABLE ONLY "public"."commission_school_receipts"
    ADD CONSTRAINT "commission_school_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_semester_entries"
    ADD CONSTRAINT "commission_semester_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_tracking"
    ADD CONSTRAINT "commission_tracking_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."communication_logs"
    ADD CONSTRAINT "communication_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compliance_alerts"
    ADD CONSTRAINT "compliance_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_pages"
    ADD CONSTRAINT "custom_pages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."custom_pages"
    ADD CONSTRAINT "custom_pages_tenant_id_slug_key" UNIQUE ("tenant_id", "slug");



ALTER TABLE ONLY "public"."data_change_log"
    ADD CONSTRAINT "data_change_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."data_quality_audit_log"
    ADD CONSTRAINT "data_quality_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."data_quality_rules"
    ADD CONSTRAINT "data_quality_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."data_quality_rules"
    ADD CONSTRAINT "data_quality_rules_tenant_id_entity_type_field_name_key" UNIQUE ("tenant_id", "entity_type", "field_name");



ALTER TABLE ONLY "public"."data_quality_scores"
    ADD CONSTRAINT "data_quality_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."data_quality_scores"
    ADD CONSTRAINT "data_quality_scores_tenant_id_entity_type_entity_id_key" UNIQUE ("tenant_id", "entity_type", "entity_id");



ALTER TABLE ONLY "public"."document_checklist_template_items"
    ADD CONSTRAINT "document_checklist_template_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_checklist_templates"
    ADD CONSTRAINT "document_checklist_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_expiry_tracking"
    ADD CONSTRAINT "document_expiry_tracking_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_extractions"
    ADD CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_requirement_reminders"
    ADD CONSTRAINT "document_requirement_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_requirements"
    ADD CONSTRAINT "document_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."education_history"
    ADD CONSTRAINT "education_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employment_history"
    ADD CONSTRAINT "employment_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."english_scores"
    ADD CONSTRAINT "english_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enquiries"
    ADD CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enrolments"
    ADD CONSTRAINT "enrolments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."error_logs"
    ADD CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."immiaccount_config"
    ADD CONSTRAINT "immiaccount_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."immiaccount_status_mappings"
    ADD CONSTRAINT "immiaccount_status_mappings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."immiaccount_sync_logs"
    ADD CONSTRAINT "immiaccount_sync_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."immigration_cases"
    ADD CONSTRAINT "immigration_cases_pkey" PRIMARY KEY ("case_id");



ALTER TABLE ONLY "public"."immigration_cases"
    ADD CONSTRAINT "immigration_cases_url_key" UNIQUE ("url");



ALTER TABLE ONLY "public"."institution_rate_agreements"
    ADD CONSTRAINT "institution_rate_agreements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."institutions"
    ADD CONSTRAINT "institutions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."judge_bios"
    ADD CONSTRAINT "judge_bios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_admin_logs"
    ADD CONSTRAINT "kb_admin_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_alternative_authorities"
    ADD CONSTRAINT "kb_alternative_authorities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_assessing_authorities"
    ADD CONSTRAINT "kb_assessing_authorities_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."kb_assessment_pathways"
    ADD CONSTRAINT "kb_assessment_pathways_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_authority_process_steps"
    ADD CONSTRAINT "kb_authority_process_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_authority_rules"
    ADD CONSTRAINT "kb_authority_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_change_history"
    ADD CONSTRAINT "kb_change_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_change_snapshots"
    ADD CONSTRAINT "kb_change_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_common_mistakes"
    ADD CONSTRAINT "kb_common_mistakes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_cricos_courses"
    ADD CONSTRAINT "kb_cricos_courses_pkey" PRIMARY KEY ("cricos_course_code");



ALTER TABLE ONLY "public"."kb_cricos_providers"
    ADD CONSTRAINT "kb_cricos_providers_pkey" PRIMARY KEY ("cricos_provider_code");



ALTER TABLE ONLY "public"."kb_document_checklist"
    ADD CONSTRAINT "kb_document_checklist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_eligibility_nuances"
    ADD CONSTRAINT "kb_eligibility_nuances_pkey" PRIMARY KEY ("nuance_id");



ALTER TABLE ONLY "public"."kb_eoi_rules"
    ADD CONSTRAINT "kb_eoi_rules_pkey" PRIMARY KEY ("rule_id");



ALTER TABLE ONLY "public"."kb_exemptions"
    ADD CONSTRAINT "kb_exemptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_faq"
    ADD CONSTRAINT "kb_faq_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_health_character_requirements"
    ADD CONSTRAINT "kb_health_character_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_invitation_rounds"
    ADD CONSTRAINT "kb_invitation_rounds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_invitation_trends"
    ADD CONSTRAINT "kb_invitation_trends_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_occupation_tiers"
    ADD CONSTRAINT "kb_occupation_tiers_pkey" PRIMARY KEY ("tier");



ALTER TABLE ONLY "public"."kb_occupations"
    ADD CONSTRAINT "kb_occupations_pkey" PRIMARY KEY ("anzsco_code");



ALTER TABLE ONLY "public"."kb_partner_points_rules"
    ADD CONSTRAINT "kb_partner_points_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_points_rules"
    ADD CONSTRAINT "kb_points_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_state_invitation_scores"
    ADD CONSTRAINT "kb_state_invitation_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_state_quotas"
    ADD CONSTRAINT "kb_state_quotas_pkey" PRIMARY KEY ("state_code");



ALTER TABLE ONLY "public"."kb_state_rules"
    ADD CONSTRAINT "kb_state_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_step_documents"
    ADD CONSTRAINT "kb_step_documents_authority_code_step_number_document_name_key" UNIQUE ("authority_code", "step_number", "document_name");



ALTER TABLE ONLY "public"."kb_step_documents"
    ADD CONSTRAINT "kb_step_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_versions"
    ADD CONSTRAINT "kb_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_visa_comparison"
    ADD CONSTRAINT "kb_visa_comparison_pkey" PRIMARY KEY ("visa_subclass");



ALTER TABLE ONLY "public"."kb_visa_constraints"
    ADD CONSTRAINT "kb_visa_constraints_pkey" PRIMARY KEY ("rule_id");



ALTER TABLE ONLY "public"."kb_visa_fees"
    ADD CONSTRAINT "kb_visa_fees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."kb_wizard_options"
    ADD CONSTRAINT "kb_wizard_options_pkey" PRIMARY KEY ("option_id");



ALTER TABLE ONLY "public"."kb_wizard_steps"
    ADD CONSTRAINT "kb_wizard_steps_pkey" PRIMARY KEY ("step_id");



ALTER TABLE ONLY "public"."lead_ai_scores"
    ADD CONSTRAINT "lead_ai_scores_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notes"
    ADD CONSTRAINT "notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_delivery_log"
    ADD CONSTRAINT "notification_delivery_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_notification_type_channel_key" UNIQUE ("user_id", "notification_type", "channel");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."obs_activity_records"
    ADD CONSTRAINT "obs_activity_records_activity_id_key" UNIQUE ("activity_id");



ALTER TABLE ONLY "public"."obs_activity_records"
    ADD CONSTRAINT "obs_activity_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."obs_error_records"
    ADD CONSTRAINT "obs_error_records_error_id_key" UNIQUE ("error_id");



ALTER TABLE ONLY "public"."obs_error_records"
    ADD CONSTRAINT "obs_error_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ocr_jobs"
    ADD CONSTRAINT "ocr_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offices"
    ADD CONSTRAINT "offices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partner_invites"
    ADD CONSTRAINT "partner_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partner_invites"
    ADD CONSTRAINT "partner_invites_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."partner_portal_users"
    ADD CONSTRAINT "partner_portal_users_email_tenant_id_key" UNIQUE ("email", "tenant_id");



ALTER TABLE ONLY "public"."partner_portal_users"
    ADD CONSTRAINT "partner_portal_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."partners"
    ADD CONSTRAINT "partners_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_legacy_id_key" UNIQUE ("legacy_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_endpoint_key" UNIQUE ("user_id", "endpoint");



ALTER TABLE ONLY "public"."quotation_items"
    ADD CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotations"
    ADD CONSTRAINT "quotations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."report_runs"
    ADD CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."risk_assessments"
    ADD CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scheduled_reports"
    ADD CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schema_versions"
    ADD CONSTRAINT "schema_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_fee_plans"
    ADD CONSTRAINT "service_fee_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_achievements"
    ADD CONSTRAINT "staff_achievements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_achievements"
    ADD CONSTRAINT "staff_achievements_tenant_id_user_id_badge_type_key" UNIQUE ("tenant_id", "user_id", "badge_type");



ALTER TABLE ONLY "public"."staff_audit_log"
    ADD CONSTRAINT "staff_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_goals"
    ADD CONSTRAINT "staff_goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_goals"
    ADD CONSTRAINT "staff_goals_tenant_id_user_id_month_key" UNIQUE ("tenant_id", "user_id", "month");



ALTER TABLE ONLY "public"."staff_performance_metrics"
    ADD CONSTRAINT "staff_performance_metrics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_performance_metrics"
    ADD CONSTRAINT "staff_performance_metrics_tenant_id_user_id_month_key" UNIQUE ("tenant_id", "user_id", "month");



ALTER TABLE ONLY "public"."study_tour_participants"
    ADD CONSTRAINT "study_tour_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."study_tours"
    ADD CONSTRAINT "study_tours_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."subscription_plans"
    ADD CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."suppliers"
    ADD CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_instances"
    ADD CONSTRAINT "survey_instances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_responses"
    ADD CONSTRAINT "survey_responses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."survey_templates"
    ADD CONSTRAINT "survey_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_settings"
    ADD CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_dashboard_defaults"
    ADD CONSTRAINT "tenant_dashboard_defaults_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_onboarding_progress"
    ADD CONSTRAINT "tenant_onboarding_progress_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_onboarding_progress"
    ADD CONSTRAINT "tenant_onboarding_progress_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "public"."tenant_settings"
    ADD CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_subscriptions"
    ADD CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_usage_logs"
    ADD CONSTRAINT "tenant_usage_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."time_logs"
    ADD CONSTRAINT "time_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timer_status"
    ADD CONSTRAINT "timer_status_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."application_compliance"
    ADD CONSTRAINT "uq_application_compliance_application_requirement" UNIQUE ("application_id", "requirement_id");



ALTER TABLE ONLY "public"."client_portal_users"
    ADD CONSTRAINT "uq_client_portal_users_tenant_email" UNIQUE ("tenant_id", "email");



ALTER TABLE ONLY "public"."document_checklist_templates"
    ADD CONSTRAINT "uq_document_checklist_templates_visa_tenant" UNIQUE ("visa_subclass", "tenant_id");



ALTER TABLE ONLY "public"."usage_stats"
    ADD CONSTRAINT "usage_stats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_dashboard_layouts"
    ADD CONSTRAINT "user_dashboard_layouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_starred_items"
    ADD CONSTRAINT "user_starred_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."web_users"
    ADD CONSTRAINT "web_users_pkey" PRIMARY KEY ("id");



CREATE INDEX "audit_logs_actor_created_idx" ON "core"."audit_logs" USING "btree" ("actor_user_id", "created_at" DESC);



CREATE INDEX "audit_logs_entity_idx" ON "core"."audit_logs" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "audit_logs_module_entity_created_idx" ON "core"."audit_logs" USING "btree" ("module_key", "entity_type", "created_at" DESC);



CREATE INDEX "audit_logs_tenant_created_idx" ON "core"."audit_logs" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "module_entitlements_tenant_enabled_idx" ON "core"."module_entitlements" USING "btree" ("tenant_id", "enabled");



CREATE INDEX "offices_tenant_active_idx" ON "core"."offices" USING "btree" ("tenant_id", "is_active");



CREATE INDEX "offices_tenant_idx" ON "core"."offices" USING "btree" ("tenant_id");



CREATE INDEX "profiles_default_office_idx" ON "core"."profiles" USING "btree" ("default_office_id");



CREATE INDEX "profiles_default_tenant_idx" ON "core"."profiles" USING "btree" ("default_tenant_id");



CREATE INDEX "profiles_status_idx" ON "core"."profiles" USING "btree" ("status");



CREATE INDEX "roles_tenant_idx" ON "core"."roles" USING "btree" ("tenant_id");



CREATE INDEX "roles_tenant_system_idx" ON "core"."roles" USING "btree" ("tenant_id", "is_system");



CREATE UNIQUE INDEX "tenant_memberships_default_unique_idx" ON "core"."tenant_memberships" USING "btree" ("user_id") WHERE ("is_default" = true);



CREATE INDEX "tenant_memberships_tenant_office_idx" ON "core"."tenant_memberships" USING "btree" ("tenant_id", "office_id");



CREATE INDEX "tenant_memberships_user_active_idx" ON "core"."tenant_memberships" USING "btree" ("user_id", "is_active");



CREATE INDEX "tenants_plan_tier_idx" ON "core"."tenants" USING "btree" ("plan_tier");



CREATE INDEX "tenants_status_idx" ON "core"."tenants" USING "btree" ("status");



CREATE INDEX "applications_tenant_client_idx" ON "crm"."applications" USING "btree" ("tenant_id", "client_id");



CREATE INDEX "applications_tenant_owner_idx" ON "crm"."applications" USING "btree" ("tenant_id", "owner_user_id");



CREATE INDEX "applications_tenant_stage_priority_idx" ON "crm"."applications" USING "btree" ("tenant_id", "stage", "priority");



CREATE INDEX "applications_tenant_visa_idx" ON "crm"."applications" USING "btree" ("tenant_id", "visa_type");



CREATE INDEX "client_notes_author_created_idx" ON "crm"."client_notes" USING "btree" ("author_user_id", "created_at" DESC);



CREATE INDEX "client_notes_tenant_client_created_idx" ON "crm"."client_notes" USING "btree" ("tenant_id", "client_id", "created_at" DESC);



CREATE INDEX "clients_name_fts_idx" ON "crm"."clients" USING "gin" ("to_tsvector"('"simple"'::"regconfig", ((COALESCE("full_name", ''::"text") || ' '::"text") || COALESCE(("email")::"text", ''::"text"))));



CREATE INDEX "clients_tenant_consultant_idx" ON "crm"."clients" USING "btree" ("tenant_id", "assigned_consultant_user_id");



CREATE INDEX "clients_tenant_lifecycle_idx" ON "crm"."clients" USING "btree" ("tenant_id", "lifecycle_status");



CREATE INDEX "clients_tenant_office_idx" ON "crm"."clients" USING "btree" ("tenant_id", "office_id");



CREATE INDEX "clients_tenant_updated_idx" ON "crm"."clients" USING "btree" ("tenant_id", "updated_at" DESC);



CREATE INDEX "clients_tenant_visa_idx" ON "crm"."clients" USING "btree" ("tenant_id", "visa_type");



CREATE INDEX "survey_instances_tenant_client_idx" ON "crm"."survey_instances" USING "btree" ("tenant_id", "client_id");



CREATE INDEX "survey_instances_tenant_status_sent_idx" ON "crm"."survey_instances" USING "btree" ("tenant_id", "status", "sent_at" DESC);



CREATE INDEX "survey_instances_tenant_template_idx" ON "crm"."survey_instances" USING "btree" ("tenant_id", "template_id");



CREATE INDEX "survey_responses_tenant_agent_created_idx" ON "crm"."survey_responses" USING "btree" ("tenant_id", "agent_id", "created_at" DESC);



CREATE INDEX "survey_responses_tenant_agent_nps_idx" ON "crm"."survey_responses" USING "btree" ("tenant_id", "agent_id", "nps_score");



CREATE INDEX "survey_responses_tenant_client_idx" ON "crm"."survey_responses" USING "btree" ("tenant_id", "client_id");



CREATE INDEX "survey_responses_tenant_created_idx" ON "crm"."survey_responses" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "survey_responses_tenant_nps_idx" ON "crm"."survey_responses" USING "btree" ("tenant_id", "nps_score");



CREATE INDEX "survey_templates_tenant_active_idx" ON "crm"."survey_templates" USING "btree" ("tenant_id", "is_active");



CREATE INDEX "survey_templates_tenant_trigger_idx" ON "crm"."survey_templates" USING "btree" ("tenant_id", "trigger_type");



CREATE INDEX "tasks_tenant_application_idx" ON "crm"."tasks" USING "btree" ("tenant_id", "application_id");



CREATE INDEX "tasks_tenant_assignee_status_due_idx" ON "crm"."tasks" USING "btree" ("tenant_id", "assigned_to", "status", "due_at");



CREATE INDEX "tasks_tenant_client_idx" ON "crm"."tasks" USING "btree" ("tenant_id", "client_id");



CREATE INDEX "tasks_tenant_priority_due_idx" ON "crm"."tasks" USING "btree" ("tenant_id", "priority", "due_at");



CREATE INDEX "case_annotations_author_created_idx" ON "law"."case_annotations" USING "btree" ("author_user_id", "created_at" DESC);



CREATE INDEX "case_annotations_tenant_case_created_idx" ON "law"."case_annotations" USING "btree" ("tenant_id", "case_id", "created_at" DESC);



CREATE INDEX "client_case_links_tenant_case_idx" ON "law"."client_case_links" USING "btree" ("tenant_id", "case_id");



CREATE INDEX "client_case_links_tenant_client_created_idx" ON "law"."client_case_links" USING "btree" ("tenant_id", "client_id", "created_at" DESC);



CREATE INDEX "research_sessions_tenant_client_updated_idx" ON "law"."research_sessions" USING "btree" ("tenant_id", "client_id", "updated_at" DESC);



CREATE INDEX "research_sessions_tenant_owner_updated_idx" ON "law"."research_sessions" USING "btree" ("tenant_id", "owner_user_id", "updated_at" DESC);



CREATE INDEX "saved_searches_tenant_owner_idx" ON "law"."saved_searches" USING "btree" ("tenant_id", "owner_user_id");



CREATE INDEX "saved_searches_tenant_shared_idx" ON "law"."saved_searches" USING "btree" ("tenant_id", "is_shared");



CREATE INDEX "idx_account_mappings_provider" ON "public"."account_mappings" USING "btree" ("provider");



CREATE INDEX "idx_account_mappings_tenant" ON "public"."account_mappings" USING "btree" ("tenant_id");



CREATE INDEX "idx_account_mappings_type" ON "public"."account_mappings" USING "btree" ("account_type");



CREATE INDEX "idx_accounting_integrations_active" ON "public"."accounting_integrations" USING "btree" ("is_active");



CREATE INDEX "idx_accounting_integrations_provider" ON "public"."accounting_integrations" USING "btree" ("provider");



CREATE INDEX "idx_accounting_integrations_tenant" ON "public"."accounting_integrations" USING "btree" ("tenant_id");



CREATE INDEX "idx_accounting_sync_logs_entity" ON "public"."accounting_sync_logs" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_accounting_sync_logs_provider" ON "public"."accounting_sync_logs" USING "btree" ("provider");



CREATE INDEX "idx_accounting_sync_logs_started" ON "public"."accounting_sync_logs" USING "btree" ("started_at" DESC);



CREATE INDEX "idx_accounting_sync_logs_status" ON "public"."accounting_sync_logs" USING "btree" ("status");



CREATE INDEX "idx_accounting_sync_logs_tenant" ON "public"."accounting_sync_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_activity_client" ON "public"."client_activity_log" USING "btree" ("client_id");



CREATE INDEX "idx_activity_time" ON "public"."client_activity_log" USING "btree" ("created_at");



CREATE INDEX "idx_agent_calls_client" ON "public"."agent_calls" USING "btree" ("client_id");



CREATE INDEX "idx_agent_calls_conv" ON "public"."agent_calls" USING "btree" ("elevenlabs_conversation_id");



CREATE INDEX "idx_agent_calls_created" ON "public"."agent_calls" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_agent_calls_direction" ON "public"."agent_calls" USING "btree" ("direction");



CREATE INDEX "idx_agent_calls_sentiment" ON "public"."agent_calls" USING "btree" ("sentiment");



CREATE INDEX "idx_agent_calls_status" ON "public"."agent_calls" USING "btree" ("status");



CREATE INDEX "idx_agent_calls_tenant" ON "public"."agent_calls" USING "btree" ("tenant_id");



CREATE INDEX "idx_agent_config_tenant" ON "public"."agent_config" USING "btree" ("tenant_id");



CREATE INDEX "idx_agent_schedule_logs_run_at" ON "public"."agent_schedule_logs" USING "btree" ("run_at" DESC);



CREATE UNIQUE INDEX "idx_agent_schedule_logs_run_key" ON "public"."agent_schedule_logs" USING "btree" ("schedule_id", "run_key", "tenant_id") WHERE ("run_key" IS NOT NULL);



CREATE INDEX "idx_agent_schedule_logs_schedule" ON "public"."agent_schedule_logs" USING "btree" ("schedule_id");



CREATE INDEX "idx_agent_schedule_logs_tenant" ON "public"."agent_schedule_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_agent_schedules_enabled" ON "public"."agent_schedules" USING "btree" ("is_enabled");



CREATE INDEX "idx_agent_schedules_next_run" ON "public"."agent_schedules" USING "btree" ("next_run_at");



CREATE INDEX "idx_agent_schedules_tenant" ON "public"."agent_schedules" USING "btree" ("tenant_id");



CREATE INDEX "idx_agent_schedules_type" ON "public"."agent_schedules" USING "btree" ("schedule_type");



CREATE INDEX "idx_ai_interactions_client" ON "public"."ai_interactions" USING "btree" ("client_id");



CREATE INDEX "idx_ai_interactions_created" ON "public"."ai_interactions" USING "btree" ("created_at");



CREATE INDEX "idx_ai_interactions_tenant" ON "public"."ai_interactions" USING "btree" ("tenant_id");



CREATE INDEX "idx_ai_interactions_type" ON "public"."ai_interactions" USING "btree" ("interaction_type");



CREATE INDEX "idx_app_client" ON "public"."applications" USING "btree" ("client_id");



CREATE INDEX "idx_app_comp_tenant" ON "public"."application_compliance" USING "btree" ("tenant_id");



CREATE INDEX "idx_app_consultant" ON "public"."applications" USING "btree" ("assigned_consultant_id");



CREATE INDEX "idx_app_priority" ON "public"."applications" USING "btree" ("priority");



CREATE INDEX "idx_app_stage" ON "public"."applications" USING "btree" ("stage");



CREATE INDEX "idx_app_type" ON "public"."applications" USING "btree" ("application_type");



CREATE INDEX "idx_application_checklist_items_tenant" ON "public"."application_checklist_items" USING "btree" ("tenant_id");



CREATE INDEX "idx_application_compliance_tenant" ON "public"."application_compliance" USING "btree" ("tenant_id");



CREATE INDEX "idx_application_document_requirements_app" ON "public"."application_document_requirements" USING "btree" ("application_id");



CREATE INDEX "idx_application_document_requirements_status" ON "public"."application_document_requirements" USING "btree" ("status");



CREATE INDEX "idx_application_document_requirements_template_item" ON "public"."application_document_requirements" USING "btree" ("template_item_id");



CREATE INDEX "idx_application_document_requirements_tenant" ON "public"."application_document_requirements" USING "btree" ("tenant_id");



CREATE INDEX "idx_application_stage_history_tenant" ON "public"."application_stage_history" USING "btree" ("tenant_id");



CREATE INDEX "idx_applications_tenant" ON "public"."applications" USING "btree" ("tenant_id", "stage");



CREATE INDEX "idx_applications_tenant_client" ON "public"."applications" USING "btree" ("tenant_id", "client_id");



CREATE INDEX "idx_applications_tenant_stage_updated" ON "public"."applications" USING "btree" ("tenant_id", "stage", "updated_at" DESC);



CREATE INDEX "idx_applications_tenant_type" ON "public"."applications" USING "btree" ("tenant_id", "application_type");



CREATE INDEX "idx_appointments_client" ON "public"."appointments" USING "btree" ("client_id");



CREATE INDEX "idx_appointments_start" ON "public"."appointments" USING "btree" ("start_time");



CREATE INDEX "idx_appointments_tenant" ON "public"."appointments" USING "btree" ("tenant_id");



CREATE INDEX "idx_assess_prog_authority" ON "public"."client_assessment_progress" USING "btree" ("client_id", "authority_code");



CREATE INDEX "idx_assess_prog_client" ON "public"."client_assessment_progress" USING "btree" ("client_id");



CREATE INDEX "idx_audit_action" ON "public"."staff_audit_log" USING "btree" ("action");



CREATE INDEX "idx_audit_risk" ON "public"."staff_audit_log" USING "btree" ("risk_level");



CREATE INDEX "idx_audit_tenant_created" ON "public"."staff_audit_log" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_audit_time" ON "public"."staff_audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_user" ON "public"."staff_audit_log" USING "btree" ("user_id");



CREATE INDEX "idx_auth_otp_email" ON "public"."auth_otp_attempts" USING "btree" ("email");



CREATE INDEX "idx_auth_otp_locked_until" ON "public"."auth_otp_attempts" USING "btree" ("locked_until");



CREATE INDEX "idx_automation_logs_tenant" ON "public"."automation_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_automation_rules_tenant" ON "public"."automation_rules" USING "btree" ("tenant_id");



CREATE INDEX "idx_calendar_tokens_provider" ON "public"."calendar_sync_tokens" USING "btree" ("provider");



CREATE INDEX "idx_calendar_tokens_tenant" ON "public"."calendar_sync_tokens" USING "btree" ("tenant_id");



CREATE INDEX "idx_calendar_tokens_user" ON "public"."calendar_sync_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_cases_case_nature" ON "public"."immigration_cases" USING "btree" ("case_nature");



CREATE INDEX "idx_cases_case_nature_nonempty" ON "public"."immigration_cases" USING "btree" ("case_nature") WHERE (("case_nature" IS NOT NULL) AND ("case_nature" <> ''::"text"));



CREATE INDEX "idx_cases_court_code" ON "public"."immigration_cases" USING "btree" ("court_code");



CREATE INDEX "idx_cases_court_code_nonempty" ON "public"."immigration_cases" USING "btree" ("court_code") WHERE (("court_code" IS NOT NULL) AND ("court_code" <> ''::"text"));



CREATE INDEX "idx_cases_embedding_openai_1536_hnsw" ON "public"."immigration_cases" USING "hnsw" ((("embedding")::"public"."vector"(1536)) "public"."vector_cosine_ops") WITH ("m"='8', "ef_construction"='32') WHERE (("embedding" IS NOT NULL) AND ("embedding_provider" = 'openai'::"text") AND ("embedding_model" = 'text-embedding-3-small'::"text") AND ("embedding_dimensions" = 1536));



CREATE INDEX "idx_cases_embedding_provider_model" ON "public"."immigration_cases" USING "btree" ("embedding_provider", "embedding_model") WHERE ("embedding" IS NOT NULL);



CREATE INDEX "idx_cases_full_text_path" ON "public"."immigration_cases" USING "btree" ("full_text_path") WHERE ("full_text_path" <> ''::"text");



CREATE INDEX "idx_cases_source" ON "public"."immigration_cases" USING "btree" ("source");



CREATE INDEX "idx_cases_source_nonempty" ON "public"."immigration_cases" USING "btree" ("source") WHERE (("source" IS NOT NULL) AND ("source" <> ''::"text"));



CREATE INDEX "idx_cases_visa_subclass" ON "public"."immigration_cases" USING "btree" ("visa_subclass") WHERE (("visa_subclass" IS NOT NULL) AND ("visa_subclass" <> ''::"text"));



CREATE INDEX "idx_cases_visa_type" ON "public"."immigration_cases" USING "btree" ("visa_type") WHERE ("visa_type" <> ''::"text");



CREATE INDEX "idx_cases_year" ON "public"."immigration_cases" USING "btree" ("year");



CREATE INDEX "idx_cases_year_positive" ON "public"."immigration_cases" USING "btree" ("year" DESC) WHERE ("year" > 0);



CREATE INDEX "idx_cc_intake" ON "public"."commission_claims" USING "btree" ("intake_period");



CREATE INDEX "idx_cc_invoice" ON "public"."commission_claims" USING "btree" ("invoice_id");



CREATE INDEX "idx_cc_school" ON "public"."commission_claims" USING "btree" ("school_id");



CREATE INDEX "idx_cc_status" ON "public"."commission_claims" USING "btree" ("status");



CREATE INDEX "idx_cc_tenant" ON "public"."commission_claims" USING "btree" ("tenant_id");



CREATE INDEX "idx_cci_claim" ON "public"."commission_claim_items" USING "btree" ("claim_id");



CREATE INDEX "idx_cci_entry" ON "public"."commission_claim_items" USING "btree" ("semester_entry_id");



CREATE INDEX "idx_ccr_tenant_inst" ON "public"."commission_claim_reports" USING "btree" ("tenant_id", "institution_id");



CREATE INDEX "idx_checklist_app" ON "public"."application_checklist_items" USING "btree" ("application_id");



CREATE INDEX "idx_cinv_status" ON "public"."commission_invoices" USING "btree" ("status");



CREATE INDEX "idx_cinv_type" ON "public"."commission_invoices" USING "btree" ("commission_type");



CREATE INDEX "idx_client_activity_log_tenant" ON "public"."client_activity_log" USING "btree" ("tenant_id");



CREATE INDEX "idx_client_activity_tenant" ON "public"."client_activity_log" USING "btree" ("tenant_id");



CREATE INDEX "idx_client_assessment_progress_tenant" ON "public"."client_assessment_progress" USING "btree" ("tenant_id");



CREATE INDEX "idx_client_docs_tenant" ON "public"."client_documents" USING "btree" ("tenant_id");



CREATE INDEX "idx_client_documents_client_tenant" ON "public"."client_documents" USING "btree" ("client_id", "tenant_id");



CREATE INDEX "idx_client_documents_requirement" ON "public"."client_documents" USING "btree" ("requirement_id");



CREATE INDEX "idx_client_documents_tenant" ON "public"."client_documents" USING "btree" ("tenant_id");



CREATE INDEX "idx_client_feedback_agent" ON "public"."client_feedback" USING "btree" ("assigned_agent_id");



CREATE INDEX "idx_client_feedback_client" ON "public"."client_feedback" USING "btree" ("client_id");



CREATE INDEX "idx_client_feedback_score" ON "public"."client_feedback" USING "btree" ("satisfaction_score");



CREATE INDEX "idx_client_feedback_submitted_at" ON "public"."client_feedback" USING "btree" ("submitted_at" DESC);



CREATE INDEX "idx_client_feedback_tenant" ON "public"."client_feedback" USING "btree" ("tenant_id");



CREATE INDEX "idx_client_milestones_tenant" ON "public"."client_milestones" USING "btree" ("tenant_id");



CREATE INDEX "idx_client_notes_tenant" ON "public"."client_notes" USING "btree" ("tenant_id");



CREATE INDEX "idx_client_portal_activity_client" ON "public"."client_portal_activity" USING "btree" ("client_id");



CREATE INDEX "idx_client_portal_activity_tenant" ON "public"."client_portal_activity" USING "btree" ("tenant_id");



CREATE INDEX "idx_client_portal_activity_time" ON "public"."client_portal_activity" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_client_portal_intake_forms_client" ON "public"."client_portal_intake_forms" USING "btree" ("client_id");



CREATE INDEX "idx_client_portal_intake_forms_tenant" ON "public"."client_portal_intake_forms" USING "btree" ("tenant_id");



CREATE INDEX "idx_client_portal_users_client" ON "public"."client_portal_users" USING "btree" ("client_id");



CREATE INDEX "idx_client_portal_users_reset_token" ON "public"."client_portal_users" USING "btree" ("reset_token");



CREATE INDEX "idx_client_portal_users_tenant" ON "public"."client_portal_users" USING "btree" ("tenant_id");



CREATE INDEX "idx_clients_consultant" ON "public"."clients" USING "btree" ("assigned_consultant_id");



CREATE INDEX "idx_clients_created_at" ON "public"."clients" USING "btree" ("created_at");



CREATE INDEX "idx_clients_email" ON "public"."clients" USING "btree" ("email");



CREATE INDEX "idx_clients_handler_consultant" ON "public"."clients" USING "btree" ("handler_consultant_id");



CREATE INDEX "idx_clients_name" ON "public"."clients" USING "btree" ("name");



CREATE INDEX "idx_clients_phone" ON "public"."clients" USING "btree" ("phone");



CREATE INDEX "idx_clients_sales_consultant" ON "public"."clients" USING "btree" ("sales_consultant_id");



CREATE INDEX "idx_clients_status" ON "public"."clients" USING "btree" ("status");



CREATE INDEX "idx_clients_tenant" ON "public"."clients" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_clients_tenant_source_updated" ON "public"."clients" USING "btree" ("tenant_id", "source", "updated_at");



CREATE INDEX "idx_clients_tenant_status_updated" ON "public"."clients" USING "btree" ("tenant_id", "status", "updated_at");



CREATE INDEX "idx_clients_tenant_updated" ON "public"."clients" USING "btree" ("tenant_id", "updated_at");



CREATE INDEX "idx_comm_client" ON "public"."commission_tracking" USING "btree" ("client_id");



CREATE INDEX "idx_comm_status" ON "public"."commission_tracking" USING "btree" ("status");



CREATE INDEX "idx_comm_type" ON "public"."commission_tracking" USING "btree" ("commission_type");



CREATE INDEX "idx_commission_claim_items_claim" ON "public"."commission_claim_items" USING "btree" ("claim_id");



CREATE INDEX "idx_commission_claim_items_semester" ON "public"."commission_claim_items" USING "btree" ("semester_entry_id");



CREATE INDEX "idx_commission_claim_items_tenant" ON "public"."commission_claim_items" USING "btree" ("tenant_id");



CREATE INDEX "idx_commission_claims_tenant" ON "public"."commission_claims" USING "btree" ("tenant_id");



CREATE INDEX "idx_commission_claims_tenant_status" ON "public"."commission_claims" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_commission_entitlements_tenant" ON "public"."commission_entitlements" USING "btree" ("tenant_id");



CREATE INDEX "idx_commission_invoice_items_invoice" ON "public"."commission_invoice_items" USING "btree" ("commission_invoice_id");



CREATE INDEX "idx_commission_invoice_items_tenant" ON "public"."commission_invoice_items" USING "btree" ("tenant_id");



CREATE INDEX "idx_commission_invoices_tenant" ON "public"."commission_invoices" USING "btree" ("tenant_id");



CREATE INDEX "idx_commission_invoices_tenant_status" ON "public"."commission_invoices" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_commission_payments_invoice" ON "public"."commission_payments" USING "btree" ("commission_invoice_id");



CREATE INDEX "idx_commission_payments_tenant" ON "public"."commission_payments" USING "btree" ("tenant_id");



CREATE INDEX "idx_commission_payments_tenant_status" ON "public"."commission_payments" USING "btree" ("tenant_id", "reconciliation_status");



CREATE INDEX "idx_commission_semester_entries_tenant" ON "public"."commission_semester_entries" USING "btree" ("tenant_id");



CREATE INDEX "idx_commission_semester_entries_tenant_status" ON "public"."commission_semester_entries" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_commission_tracking_enrolment" ON "public"."commission_tracking" USING "btree" ("enrolment_id");



CREATE INDEX "idx_commission_tracking_tenant" ON "public"."commission_tracking" USING "btree" ("tenant_id");



CREATE INDEX "idx_commission_tracking_tenant_client" ON "public"."commission_tracking" USING "btree" ("tenant_id", "client_id");



CREATE INDEX "idx_commission_tracking_tenant_status" ON "public"."commission_tracking" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_commission_tracking_tenant_type" ON "public"."commission_tracking" USING "btree" ("tenant_id", "commission_type");



CREATE INDEX "idx_comms_client" ON "public"."communication_logs" USING "btree" ("client_id");



CREATE INDEX "idx_comms_tenant" ON "public"."communication_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_comms_tenant_client_created" ON "public"."communication_logs" USING "btree" ("tenant_id", "client_id", "created_at");



CREATE INDEX "idx_communication_logs_tenant" ON "public"."communication_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_compliance_alerts_client" ON "public"."compliance_alerts" USING "btree" ("client_id");



CREATE INDEX "idx_compliance_alerts_tenant" ON "public"."compliance_alerts" USING "btree" ("tenant_id");



CREATE INDEX "idx_compliance_alerts_unresolved" ON "public"."compliance_alerts" USING "btree" ("tenant_id", "is_resolved") WHERE ("is_resolved" = false);



CREATE INDEX "idx_compliance_app" ON "public"."application_compliance" USING "btree" ("application_id");



CREATE INDEX "idx_compliance_status" ON "public"."application_compliance" USING "btree" ("status");



CREATE INDEX "idx_courses_cricos" ON "public"."courses" USING "btree" ("cricos_code");



CREATE INDEX "idx_courses_institution" ON "public"."courses" USING "btree" ("institution_id");



CREATE INDEX "idx_courses_tenant" ON "public"."courses" USING "btree" ("tenant_id");



CREATE INDEX "idx_court_code" ON "public"."immigration_cases" USING "btree" ("court_code");



CREATE INDEX "idx_court_year" ON "public"."immigration_cases" USING "btree" ("court_code", "year");



CREATE INDEX "idx_court_year_counts_mv_year" ON "public"."court_year_counts_mv" USING "btree" ("year");



CREATE UNIQUE INDEX "idx_court_year_counts_mv_year_court" ON "public"."court_year_counts_mv" USING "btree" ("year", "court_code");



CREATE INDEX "idx_cpay_invoice" ON "public"."commission_payments" USING "btree" ("commission_invoice_id");



CREATE INDEX "idx_cse_commission" ON "public"."commission_semester_entries" USING "btree" ("commission_id");



CREATE INDEX "idx_cse_status" ON "public"."commission_semester_entries" USING "btree" ("status");



CREATE INDEX "idx_cse_tenant" ON "public"."commission_semester_entries" USING "btree" ("tenant_id");



CREATE INDEX "idx_csr_commission" ON "public"."commission_school_receipts" USING "btree" ("commission_id");



CREATE INDEX "idx_csr_tenant" ON "public"."commission_school_receipts" USING "btree" ("tenant_id");



CREATE INDEX "idx_ct_consultant_role" ON "public"."commission_tracking" USING "btree" ("consultant_role");



CREATE INDEX "idx_custom_pages_tenant" ON "public"."custom_pages" USING "btree" ("tenant_id", "is_enabled");



CREATE INDEX "idx_data_change_log_created_at" ON "public"."data_change_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_data_change_log_table_record" ON "public"."data_change_log" USING "btree" ("tenant_id", "table_name", "record_id");



CREATE INDEX "idx_data_change_log_tenant" ON "public"."data_change_log" USING "btree" ("tenant_id");



CREATE INDEX "idx_data_change_log_user" ON "public"."data_change_log" USING "btree" ("changed_by");



CREATE INDEX "idx_data_quality_calculated" ON "public"."data_quality_scores" USING "btree" ("last_calculated_at");



CREATE INDEX "idx_data_quality_entity" ON "public"."data_quality_scores" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_data_quality_rules_entity" ON "public"."data_quality_rules" USING "btree" ("entity_type");



CREATE INDEX "idx_data_quality_rules_required" ON "public"."data_quality_rules" USING "btree" ("is_required");



CREATE INDEX "idx_data_quality_rules_tenant" ON "public"."data_quality_rules" USING "btree" ("tenant_id");



CREATE INDEX "idx_data_quality_score" ON "public"."data_quality_scores" USING "btree" ("overall_score");



CREATE INDEX "idx_data_quality_tenant" ON "public"."data_quality_scores" USING "btree" ("tenant_id");



CREATE INDEX "idx_date_sort_month" ON "public"."immigration_cases" USING "btree" ((("date_sort" / 100))) WHERE (("date_sort" IS NOT NULL) AND ("date_sort" > 19000000));



CREATE INDEX "idx_dcl_table_record" ON "public"."data_change_log" USING "btree" ("table_name", "record_id");



CREATE INDEX "idx_dcl_user" ON "public"."data_change_log" USING "btree" ("changed_by");



CREATE INDEX "idx_doc_expiry_client" ON "public"."document_expiry_tracking" USING "btree" ("client_id");



CREATE INDEX "idx_doc_expiry_date" ON "public"."document_expiry_tracking" USING "btree" ("expiry_date") WHERE ("is_renewed" = false);



CREATE INDEX "idx_doc_expiry_tenant" ON "public"."document_expiry_tracking" USING "btree" ("tenant_id");



CREATE INDEX "idx_doc_reminders_requirement" ON "public"."document_requirement_reminders" USING "btree" ("requirement_id");



CREATE INDEX "idx_doc_reminders_sent" ON "public"."document_requirement_reminders" USING "btree" ("sent_at");



CREATE INDEX "idx_doc_req_tenant" ON "public"."document_requirements" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_doc_req_unique" ON "public"."document_requirements" USING "btree" ("visa_type", "document_name");



CREATE INDEX "idx_doc_req_visa" ON "public"."document_requirements" USING "btree" ("visa_type");



CREATE INDEX "idx_doc_requirements_app" ON "public"."application_document_requirements" USING "btree" ("application_id");



CREATE INDEX "idx_doc_requirements_status" ON "public"."application_document_requirements" USING "btree" ("status");



CREATE INDEX "idx_doc_requirements_template_item" ON "public"."application_document_requirements" USING "btree" ("template_item_id");



CREATE INDEX "idx_doc_requirements_tenant" ON "public"."application_document_requirements" USING "btree" ("tenant_id");



CREATE INDEX "idx_doc_template_items_sort" ON "public"."document_checklist_template_items" USING "btree" ("template_id", "sort_order");



CREATE INDEX "idx_doc_template_items_template" ON "public"."document_checklist_template_items" USING "btree" ("template_id");



CREATE INDEX "idx_doc_templates_tenant" ON "public"."document_checklist_templates" USING "btree" ("tenant_id");



CREATE INDEX "idx_doc_templates_visa" ON "public"."document_checklist_templates" USING "btree" ("visa_subclass");



CREATE INDEX "idx_document_checklist_template_items_sort" ON "public"."document_checklist_template_items" USING "btree" ("template_id", "sort_order");



CREATE INDEX "idx_document_checklist_template_items_template" ON "public"."document_checklist_template_items" USING "btree" ("template_id");



CREATE INDEX "idx_document_checklist_templates_tenant" ON "public"."document_checklist_templates" USING "btree" ("tenant_id");



CREATE INDEX "idx_document_checklist_templates_visa" ON "public"."document_checklist_templates" USING "btree" ("visa_subclass");



CREATE INDEX "idx_document_extractions_status" ON "public"."document_extractions" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_document_extractions_tenant_doc" ON "public"."document_extractions" USING "btree" ("tenant_id", "document_id");



CREATE INDEX "idx_document_requirements_tenant" ON "public"."document_requirements" USING "btree" ("tenant_id");



CREATE INDEX "idx_documents_tenant_client" ON "public"."client_documents" USING "btree" ("tenant_id", "client_id");



CREATE INDEX "idx_dq_audit_action" ON "public"."data_quality_audit_log" USING "btree" ("action");



CREATE INDEX "idx_dq_audit_created" ON "public"."data_quality_audit_log" USING "btree" ("created_at");



CREATE INDEX "idx_dq_audit_entity" ON "public"."data_quality_audit_log" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_dq_audit_tenant" ON "public"."data_quality_audit_log" USING "btree" ("tenant_id");



CREATE INDEX "idx_edu_client" ON "public"."education_history" USING "btree" ("client_id");



CREATE INDEX "idx_edu_tenant" ON "public"."education_history" USING "btree" ("tenant_id");



CREATE INDEX "idx_education_history_tenant" ON "public"."education_history" USING "btree" ("tenant_id");



CREATE INDEX "idx_emp_client" ON "public"."employment_history" USING "btree" ("client_id");



CREATE INDEX "idx_emp_tenant" ON "public"."employment_history" USING "btree" ("tenant_id");



CREATE INDEX "idx_employment_history_tenant" ON "public"."employment_history" USING "btree" ("tenant_id");



CREATE INDEX "idx_eng_client" ON "public"."english_scores" USING "btree" ("client_id");



CREATE INDEX "idx_eng_tenant" ON "public"."english_scores" USING "btree" ("tenant_id");



CREATE INDEX "idx_english_scores_tenant" ON "public"."english_scores" USING "btree" ("tenant_id");



CREATE INDEX "idx_enquiries_client" ON "public"."enquiries" USING "btree" ("client_id");



CREATE INDEX "idx_enquiries_status" ON "public"."enquiries" USING "btree" ("status");



CREATE INDEX "idx_enquiries_tenant" ON "public"."enquiries" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_enquiries_tenant_status_updated" ON "public"."enquiries" USING "btree" ("tenant_id", "status", "updated_at" DESC);



CREATE INDEX "idx_enquiries_type" ON "public"."enquiries" USING "btree" ("enquiry_type");



CREATE INDEX "idx_enrolments_client" ON "public"."enrolments" USING "btree" ("client_id");



CREATE INDEX "idx_enrolments_course" ON "public"."enrolments" USING "btree" ("course_id");



CREATE INDEX "idx_enrolments_stage" ON "public"."enrolments" USING "btree" ("enrolment_stage");



CREATE INDEX "idx_enrolments_status" ON "public"."enrolments" USING "btree" ("status");



CREATE INDEX "idx_enrolments_tenant" ON "public"."enrolments" USING "btree" ("tenant_id");



CREATE INDEX "idx_enrolments_tenant_client" ON "public"."enrolments" USING "btree" ("tenant_id", "client_id");



CREATE INDEX "idx_enrolments_tenant_status" ON "public"."enrolments" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_fts" ON "public"."immigration_cases" USING "gin" ("fts");



CREATE INDEX "idx_ic_concepts" ON "public"."immigration_cases" USING "btree" ("case_id") INCLUDE ("legal_concepts") WHERE (("legal_concepts" IS NOT NULL) AND ("legal_concepts" <> ''::"text"));



CREATE INDEX "idx_ic_court_outcome" ON "public"."immigration_cases" USING "btree" ("court_code", "outcome") WHERE (("court_code" IS NOT NULL) AND ("court_code" <> ''::"text"));



CREATE INDEX "idx_ic_judges_court" ON "public"."immigration_cases" USING "btree" ("court_code") INCLUDE ("judges") WHERE (("judges" IS NOT NULL) AND ("judges" <> ''::"text"));



CREATE INDEX "idx_ic_nature_outcome" ON "public"."immigration_cases" USING "btree" ("case_nature", "outcome") WHERE (("case_nature" IS NOT NULL) AND ("case_nature" <> ''::"text"));



CREATE INDEX "idx_ic_visa_outcome" ON "public"."immigration_cases" USING "btree" ("visa_subclass", "outcome") WHERE (("visa_subclass" IS NOT NULL) AND ("visa_subclass" <> ''::"text"));



CREATE INDEX "idx_ic_year_outcome" ON "public"."immigration_cases" USING "btree" ("year", "outcome") WHERE ("year" IS NOT NULL);



CREATE INDEX "idx_immi_cfg_active" ON "public"."immiaccount_config" USING "btree" ("is_active");



CREATE INDEX "idx_immi_cfg_enabled" ON "public"."immiaccount_config" USING "btree" ("is_enabled");



CREATE INDEX "idx_immi_cfg_tenant" ON "public"."immiaccount_config" USING "btree" ("tenant_id");



CREATE INDEX "idx_immi_logs_started" ON "public"."immiaccount_sync_logs" USING "btree" ("sync_started_at" DESC);



CREATE INDEX "idx_immi_logs_status" ON "public"."immiaccount_sync_logs" USING "btree" ("status");



CREATE INDEX "idx_immi_logs_tenant" ON "public"."immiaccount_sync_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_immi_mapping_stage" ON "public"."immiaccount_status_mappings" USING "btree" ("bsmart_stage");



CREATE INDEX "idx_immiaccount_config_enabled" ON "public"."immiaccount_config" USING "btree" ("is_enabled");



CREATE INDEX "idx_immiaccount_config_tenant" ON "public"."immiaccount_config" USING "btree" ("tenant_id");



CREATE INDEX "idx_immiaccount_status_mappings_stage" ON "public"."immiaccount_status_mappings" USING "btree" ("bsmart_stage");



CREATE INDEX "idx_immiaccount_status_mappings_tenant" ON "public"."immiaccount_status_mappings" USING "btree" ("tenant_id");



CREATE INDEX "idx_immiaccount_sync_logs_tenant" ON "public"."immiaccount_sync_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_immigration_cases_date_sort" ON "public"."immigration_cases" USING "btree" ("date_sort");



CREATE INDEX "idx_institution_rate_agreements_tenant" ON "public"."institution_rate_agreements" USING "btree" ("tenant_id");



CREATE INDEX "idx_institutions_cricos" ON "public"."institutions" USING "btree" ("cricos_provider_code");



CREATE INDEX "idx_institutions_tenant" ON "public"."institutions" USING "btree" ("tenant_id");



CREATE INDEX "idx_inv_items_invoice" ON "public"."invoice_items" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_items_tenant" ON "public"."invoice_items" USING "btree" ("tenant_id");



CREATE INDEX "idx_invoices_client" ON "public"."invoices" USING "btree" ("client_id");



CREATE INDEX "idx_invoices_due" ON "public"."invoices" USING "btree" ("due_date");



CREATE INDEX "idx_invoices_status" ON "public"."invoices" USING "btree" ("status");



CREATE INDEX "idx_invoices_tenant" ON "public"."invoices" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_invoices_tenant_client" ON "public"."invoices" USING "btree" ("tenant_id", "client_id");



CREATE INDEX "idx_invoices_tenant_due_date" ON "public"."invoices" USING "btree" ("tenant_id", "due_date");



CREATE INDEX "idx_invoices_tenant_status" ON "public"."invoices" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_ira_active" ON "public"."institution_rate_agreements" USING "btree" ("is_active");



CREATE INDEX "idx_ira_institution" ON "public"."institution_rate_agreements" USING "btree" ("institution_id");



CREATE INDEX "idx_ira_tenant" ON "public"."institution_rate_agreements" USING "btree" ("tenant_id");



CREATE INDEX "idx_kb_admin_logs_admin" ON "public"."kb_admin_logs" USING "btree" ("admin_id");



CREATE INDEX "idx_kb_alt_auth_anzsco" ON "public"."kb_alternative_authorities" USING "btree" ("anzsco_code");



CREATE INDEX "idx_kb_auth_rules_code" ON "public"."kb_authority_rules" USING "btree" ("authority_code");



CREATE INDEX "idx_kb_auth_steps_code" ON "public"."kb_authority_process_steps" USING "btree" ("authority_code");



CREATE INDEX "idx_kb_change_detected" ON "public"."kb_change_history" USING "btree" ("detected_at" DESC);



CREATE INDEX "idx_kb_change_history_detected" ON "public"."kb_change_history" USING "btree" ("detected_at" DESC);



CREATE INDEX "idx_kb_change_history_status" ON "public"."kb_change_history" USING "btree" ("status");



CREATE INDEX "idx_kb_change_history_table" ON "public"."kb_change_history" USING "btree" ("table_name");



CREATE INDEX "idx_kb_change_history_tenant" ON "public"."kb_change_history" USING "btree" ("tenant_id");



CREATE INDEX "idx_kb_change_snapshots_created" ON "public"."kb_change_snapshots" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_kb_change_snapshots_table" ON "public"."kb_change_snapshots" USING "btree" ("table_name");



CREATE INDEX "idx_kb_change_snapshots_tenant" ON "public"."kb_change_snapshots" USING "btree" ("tenant_id");



CREATE INDEX "idx_kb_change_status" ON "public"."kb_change_history" USING "btree" ("status");



CREATE INDEX "idx_kb_change_table" ON "public"."kb_change_history" USING "btree" ("table_name");



CREATE INDEX "idx_kb_cricos_courses_level" ON "public"."kb_cricos_courses" USING "btree" ("course_level");



CREATE INDEX "idx_kb_cricos_courses_provider" ON "public"."kb_cricos_courses" USING "btree" ("cricos_provider_code");



CREATE INDEX "idx_kb_cricos_providers_name" ON "public"."kb_cricos_providers" USING "btree" ("institution_name");



CREATE INDEX "idx_kb_cricos_providers_state" ON "public"."kb_cricos_providers" USING "btree" ("state");



CREATE INDEX "idx_kb_exemptions_code" ON "public"."kb_exemptions" USING "btree" ("authority_code");



CREATE INDEX "idx_kb_occ_anzsco" ON "public"."kb_occupations" USING "btree" ("anzsco_code");



CREATE INDEX "idx_kb_occ_authority" ON "public"."kb_occupations" USING "btree" ("authority_code");



CREATE INDEX "idx_kb_occ_list_type" ON "public"."kb_occupations" USING "btree" ("list_type");



CREATE INDEX "idx_kb_pathways_code" ON "public"."kb_assessment_pathways" USING "btree" ("authority_code");



CREATE INDEX "idx_kb_state_scores_anzsco" ON "public"."kb_state_invitation_scores" USING "btree" ("anzsco_code");



CREATE INDEX "idx_kb_state_scores_state" ON "public"."kb_state_invitation_scores" USING "btree" ("state_code");



CREATE INDEX "idx_kb_trends_state" ON "public"."kb_invitation_trends" USING "btree" ("state_code");



CREATE INDEX "idx_kb_versions_table" ON "public"."kb_versions" USING "btree" ("table_name");



CREATE INDEX "idx_kb_versions_tenant" ON "public"."kb_versions" USING "btree" ("tenant_id");



CREATE INDEX "idx_kb_versions_updated" ON "public"."kb_versions" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_lead_ai_scores_lead" ON "public"."lead_ai_scores" USING "btree" ("lead_id");



CREATE INDEX "idx_lead_ai_scores_scored_at" ON "public"."lead_ai_scores" USING "btree" ("scored_at");



CREATE INDEX "idx_lead_ai_scores_tenant" ON "public"."lead_ai_scores" USING "btree" ("tenant_id");



CREATE INDEX "idx_leads_assigned" ON "public"."leads" USING "btree" ("assigned_to");



CREATE INDEX "idx_leads_followup" ON "public"."leads" USING "btree" ("next_follow_up");



CREATE INDEX "idx_leads_stage" ON "public"."leads" USING "btree" ("funnel_stage");



CREATE INDEX "idx_leads_tenant" ON "public"."leads" USING "btree" ("tenant_id", "funnel_stage");



CREATE INDEX "idx_leads_tenant_stage_updated" ON "public"."leads" USING "btree" ("tenant_id", "funnel_stage", "updated_at" DESC);



CREATE INDEX "idx_milestones_client" ON "public"."client_milestones" USING "btree" ("client_id");



CREATE INDEX "idx_milestones_date" ON "public"."client_milestones" USING "btree" ("milestone_date");



CREATE INDEX "idx_notes_entity" ON "public"."notes" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_notes_pinned" ON "public"."notes" USING "btree" ("is_pinned");



CREATE INDEX "idx_notes_tenant" ON "public"."notes" USING "btree" ("tenant_id", "entity_type", "entity_id");



CREATE INDEX "idx_notif_deliv_user" ON "public"."notification_delivery_log" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_notif_pref_tenant" ON "public"."notification_preferences" USING "btree" ("tenant_id", "user_id");



CREATE INDEX "idx_notif_pref_user" ON "public"."notification_preferences" USING "btree" ("user_id");



CREATE INDEX "idx_notif_read" ON "public"."notifications" USING "btree" ("is_read");



CREATE INDEX "idx_notif_time" ON "public"."notifications" USING "btree" ("created_at");



CREATE INDEX "idx_notif_user" ON "public"."notifications" USING "btree" ("target_user_id");



CREATE INDEX "idx_notifications_tenant" ON "public"."notifications" USING "btree" ("tenant_id");



CREATE INDEX "idx_notifications_tenant_user_read_created" ON "public"."notifications" USING "btree" ("tenant_id", "target_user_id", "is_read", "created_at");



CREATE INDEX "idx_obs_act_actor" ON "public"."obs_activity_records" USING "btree" ("actor_id");



CREATE INDEX "idx_obs_act_session" ON "public"."obs_activity_records" USING "btree" ("session_id");



CREATE INDEX "idx_obs_act_tenant" ON "public"."obs_activity_records" USING "btree" ("tenant_id");



CREATE INDEX "idx_obs_act_time" ON "public"."obs_activity_records" USING "btree" ("event_time" DESC);



CREATE INDEX "idx_obs_act_trace" ON "public"."obs_activity_records" USING "btree" ("trace_id");



CREATE INDEX "idx_obs_act_type" ON "public"."obs_activity_records" USING "btree" ("event_type");



CREATE INDEX "idx_obs_err_category" ON "public"."obs_error_records" USING "btree" ("category");



CREATE INDEX "idx_obs_err_corr" ON "public"."obs_error_records" USING "btree" ("correlation_id");



CREATE INDEX "idx_obs_err_resolved" ON "public"."obs_error_records" USING "btree" ("resolved");



CREATE INDEX "idx_obs_err_session" ON "public"."obs_error_records" USING "btree" ("session_id");



CREATE INDEX "idx_obs_err_severity" ON "public"."obs_error_records" USING "btree" ("severity");



CREATE INDEX "idx_obs_err_tenant" ON "public"."obs_error_records" USING "btree" ("tenant_id");



CREATE INDEX "idx_obs_err_timestamp" ON "public"."obs_error_records" USING "btree" ("timestamp" DESC);



CREATE INDEX "idx_obs_err_trace" ON "public"."obs_error_records" USING "btree" ("trace_id");



CREATE INDEX "idx_ocr_jobs_tenant_status" ON "public"."ocr_jobs" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_offices_code" ON "public"."offices" USING "btree" ("code");



CREATE INDEX "idx_offices_tenant" ON "public"."offices" USING "btree" ("tenant_id");



CREATE INDEX "idx_onboarding_tenant" ON "public"."tenant_onboarding_progress" USING "btree" ("tenant_id");



CREATE INDEX "idx_partner_invites_partner" ON "public"."partner_invites" USING "btree" ("partner_id", "tenant_id");



CREATE INDEX "idx_partner_invites_token" ON "public"."partner_invites" USING "btree" ("token");



CREATE INDEX "idx_partners_tenant" ON "public"."partners" USING "btree" ("tenant_id");



CREATE INDEX "idx_partners_tenant_type" ON "public"."partners" USING "btree" ("tenant_id", "partner_type");



CREATE INDEX "idx_partners_type" ON "public"."partners" USING "btree" ("partner_type");



CREATE INDEX "idx_payments_invoice" ON "public"."payments" USING "btree" ("invoice_id");



CREATE INDEX "idx_payments_tenant" ON "public"."payments" USING "btree" ("tenant_id");



CREATE INDEX "idx_portal_activity_client" ON "public"."client_portal_activity" USING "btree" ("client_id");



CREATE INDEX "idx_portal_activity_tenant" ON "public"."client_portal_activity" USING "btree" ("tenant_id");



CREATE INDEX "idx_portal_activity_time" ON "public"."client_portal_activity" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_portal_intake_client" ON "public"."client_portal_intake_forms" USING "btree" ("client_id");



CREATE INDEX "idx_portal_intake_tenant" ON "public"."client_portal_intake_forms" USING "btree" ("tenant_id");



CREATE INDEX "idx_ppu_partner" ON "public"."partner_portal_users" USING "btree" ("partner_id");



CREATE INDEX "idx_ppu_tenant_email" ON "public"."partner_portal_users" USING "btree" ("tenant_id", "email");



CREATE INDEX "idx_profiles_legacy_id" ON "public"."profiles" USING "btree" ("legacy_id");



CREATE INDEX "idx_profiles_username" ON "public"."profiles" USING "btree" ("username");



CREATE INDEX "idx_push_endpoint" ON "public"."push_subscriptions" USING "btree" ("endpoint");



CREATE INDEX "idx_push_subscriptions_tenant" ON "public"."push_subscriptions" USING "btree" ("tenant_id");



CREATE INDEX "idx_push_user" ON "public"."push_subscriptions" USING "btree" ("user_id");



CREATE INDEX "idx_qitems_quotation" ON "public"."quotation_items" USING "btree" ("quotation_id");



CREATE INDEX "idx_quotation_items_tenant" ON "public"."quotation_items" USING "btree" ("tenant_id");



CREATE INDEX "idx_quotations_client" ON "public"."quotations" USING "btree" ("client_id");



CREATE INDEX "idx_quotations_status" ON "public"."quotations" USING "btree" ("status");



CREATE INDEX "idx_quotations_tenant" ON "public"."quotations" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_quotations_tenant_client" ON "public"."quotations" USING "btree" ("tenant_id", "client_id");



CREATE INDEX "idx_quotations_tenant_status_updated" ON "public"."quotations" USING "btree" ("tenant_id", "status", "updated_at" DESC);



CREATE INDEX "idx_ra_tenant_app" ON "public"."risk_assessments" USING "btree" ("tenant_id", "application_id");



CREATE INDEX "idx_report_runs_schedule" ON "public"."report_runs" USING "btree" ("schedule_id", "started_at" DESC);



CREATE INDEX "idx_report_runs_tenant" ON "public"."report_runs" USING "btree" ("tenant_id", "started_at" DESC);



CREATE UNIQUE INDEX "idx_roles_name_tenant" ON "public"."roles" USING "btree" ("name", "tenant_id");



CREATE INDEX "idx_roles_tenant" ON "public"."roles" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_roles_tenant_name_unique" ON "public"."roles" USING "btree" ("tenant_id", "name");



CREATE INDEX "idx_scheduled_reports_tenant" ON "public"."scheduled_reports" USING "btree" ("tenant_id");



CREATE INDEX "idx_schema_versions_version" ON "public"."schema_versions" USING "btree" ("version");



CREATE INDEX "idx_settings_cat" ON "public"."system_settings" USING "btree" ("category");



CREATE INDEX "idx_settings_key" ON "public"."system_settings" USING "btree" ("key");



CREATE INDEX "idx_sfp_tenant_app" ON "public"."service_fee_plans" USING "btree" ("tenant_id", "application_id");



CREATE INDEX "idx_sfp_tenant_client" ON "public"."service_fee_plans" USING "btree" ("tenant_id", "client_id");



CREATE INDEX "idx_source" ON "public"."immigration_cases" USING "btree" ("source");



CREATE INDEX "idx_staff_achievements_badge_type" ON "public"."staff_achievements" USING "btree" ("badge_type");



CREATE INDEX "idx_staff_achievements_tenant" ON "public"."staff_achievements" USING "btree" ("tenant_id");



CREATE INDEX "idx_staff_achievements_user" ON "public"."staff_achievements" USING "btree" ("user_id");



CREATE INDEX "idx_staff_audit_log_action" ON "public"."staff_audit_log" USING "btree" ("action");



CREATE INDEX "idx_staff_audit_log_risk" ON "public"."staff_audit_log" USING "btree" ("risk_level");



CREATE INDEX "idx_staff_audit_log_tenant" ON "public"."staff_audit_log" USING "btree" ("tenant_id");



CREATE INDEX "idx_staff_audit_log_tenant_time" ON "public"."staff_audit_log" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "idx_staff_audit_log_time" ON "public"."staff_audit_log" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_staff_audit_log_user" ON "public"."staff_audit_log" USING "btree" ("user_id");



CREATE INDEX "idx_staff_goals_month" ON "public"."staff_goals" USING "btree" ("month");



CREATE INDEX "idx_staff_goals_tenant" ON "public"."staff_goals" USING "btree" ("tenant_id");



CREATE INDEX "idx_staff_goals_user" ON "public"."staff_goals" USING "btree" ("user_id");



CREATE INDEX "idx_staff_performance_metrics_month" ON "public"."staff_performance_metrics" USING "btree" ("month");



CREATE INDEX "idx_staff_performance_metrics_tenant" ON "public"."staff_performance_metrics" USING "btree" ("tenant_id");



CREATE INDEX "idx_staff_performance_metrics_user" ON "public"."staff_performance_metrics" USING "btree" ("user_id");



CREATE INDEX "idx_starred_user_tenant" ON "public"."user_starred_items" USING "btree" ("user_id", "tenant_id");



CREATE INDEX "idx_step_docs_authority" ON "public"."kb_step_documents" USING "btree" ("authority_code", "step_number");



CREATE INDEX "idx_study_tour_participants_tenant" ON "public"."study_tour_participants" USING "btree" ("tenant_id");



CREATE INDEX "idx_study_tours_tenant" ON "public"."study_tours" USING "btree" ("tenant_id");



CREATE INDEX "idx_study_tours_tenant_status_start" ON "public"."study_tours" USING "btree" ("tenant_id", "status", "start_date" DESC);



CREATE INDEX "idx_suppliers_tenant" ON "public"."suppliers" USING "btree" ("tenant_id");



CREATE INDEX "idx_suppliers_type" ON "public"."suppliers" USING "btree" ("supplier_type");



CREATE INDEX "idx_survey_instances_application" ON "public"."survey_instances" USING "btree" ("application_id");



CREATE INDEX "idx_survey_instances_client" ON "public"."survey_instances" USING "btree" ("client_id");



CREATE INDEX "idx_survey_instances_responded" ON "public"."survey_instances" USING "btree" ("responded_at");



CREATE INDEX "idx_survey_instances_sent" ON "public"."survey_instances" USING "btree" ("sent_at");



CREATE INDEX "idx_survey_instances_template" ON "public"."survey_instances" USING "btree" ("template_id");



CREATE INDEX "idx_survey_instances_tenant" ON "public"."survey_instances" USING "btree" ("tenant_id");



CREATE INDEX "idx_survey_instances_token" ON "public"."survey_instances" USING "btree" ("access_token");



CREATE INDEX "idx_survey_responses_agent" ON "public"."survey_responses" USING "btree" ("agent_id");



CREATE INDEX "idx_survey_responses_client" ON "public"."survey_responses" USING "btree" ("client_id");



CREATE INDEX "idx_survey_responses_created" ON "public"."survey_responses" USING "btree" ("created_at");



CREATE INDEX "idx_survey_responses_instance" ON "public"."survey_responses" USING "btree" ("survey_instance_id");



CREATE INDEX "idx_survey_responses_nps" ON "public"."survey_responses" USING "btree" ("nps_score");



CREATE INDEX "idx_survey_responses_satisfaction" ON "public"."survey_responses" USING "btree" ("satisfaction_score");



CREATE INDEX "idx_survey_responses_tenant" ON "public"."survey_responses" USING "btree" ("tenant_id");



CREATE INDEX "idx_survey_responses_tenant_agent_nps" ON "public"."survey_responses" USING "btree" ("tenant_id", "agent_id", "nps_score");



CREATE INDEX "idx_survey_responses_tenant_created" ON "public"."survey_responses" USING "btree" ("tenant_id", "created_at");



CREATE INDEX "idx_survey_responses_tenant_nps" ON "public"."survey_responses" USING "btree" ("tenant_id", "nps_score");



CREATE INDEX "idx_survey_templates_active" ON "public"."survey_templates" USING "btree" ("is_active");



CREATE INDEX "idx_survey_templates_language" ON "public"."survey_templates" USING "btree" ("language");



CREATE INDEX "idx_survey_templates_tenant" ON "public"."survey_templates" USING "btree" ("tenant_id");



CREATE INDEX "idx_survey_templates_trigger" ON "public"."survey_templates" USING "btree" ("trigger_type");



CREATE INDEX "idx_system_settings_tenant" ON "public"."system_settings" USING "btree" ("tenant_id");



CREATE INDEX "idx_system_settings_tenant_category" ON "public"."system_settings" USING "btree" ("tenant_id", "category");



CREATE INDEX "idx_tasks_assignee" ON "public"."tasks" USING "btree" ("assigned_to");



CREATE INDEX "idx_tasks_client" ON "public"."tasks" USING "btree" ("client_id");



CREATE INDEX "idx_tasks_due" ON "public"."tasks" USING "btree" ("due_date");



CREATE INDEX "idx_tasks_status" ON "public"."tasks" USING "btree" ("status");



CREATE INDEX "idx_tasks_tenant" ON "public"."tasks" USING "btree" ("tenant_id", "status");



CREATE INDEX "idx_tasks_tenant_assignee_status" ON "public"."tasks" USING "btree" ("tenant_id", "assigned_to", "status");



CREATE INDEX "idx_tasks_tenant_client_status" ON "public"."tasks" USING "btree" ("tenant_id", "client_id", "status");



CREATE INDEX "idx_tasks_tenant_status_due" ON "public"."tasks" USING "btree" ("tenant_id", "status", "due_date");



CREATE INDEX "idx_tenant_dashboard_defaults_role" ON "public"."tenant_dashboard_defaults" USING "btree" ("role_name");



CREATE INDEX "idx_tenant_dashboard_defaults_tenant" ON "public"."tenant_dashboard_defaults" USING "btree" ("tenant_id");



CREATE INDEX "idx_tenant_subscriptions_tenant" ON "public"."tenant_subscriptions" USING "btree" ("tenant_id");



CREATE INDEX "idx_tenant_usage_logs_month" ON "public"."tenant_usage_logs" USING "btree" ("month");



CREATE INDEX "idx_tenant_usage_month" ON "public"."tenant_usage_logs" USING "btree" ("month");



CREATE INDEX "idx_tenants_custom_domain" ON "public"."tenants" USING "btree" ("custom_domain");



CREATE INDEX "idx_tenants_slug" ON "public"."tenants" USING "btree" ("slug");



CREATE INDEX "idx_tenants_subdomain" ON "public"."tenants" USING "btree" ("subdomain");



CREATE INDEX "idx_time_logs_app" ON "public"."time_logs" USING "btree" ("application_id");



CREATE INDEX "idx_time_logs_client" ON "public"."time_logs" USING "btree" ("client_id");



CREATE INDEX "idx_time_logs_invoice" ON "public"."time_logs" USING "btree" ("invoice_id");



CREATE INDEX "idx_time_logs_start" ON "public"."time_logs" USING "btree" ("start_at" DESC);



CREATE INDEX "idx_time_logs_status" ON "public"."time_logs" USING "btree" ("status");



CREATE INDEX "idx_time_logs_tenant" ON "public"."time_logs" USING "btree" ("tenant_id");



CREATE INDEX "idx_time_logs_tenant_client" ON "public"."time_logs" USING "btree" ("tenant_id", "client_id");



CREATE INDEX "idx_time_logs_tenant_user_created" ON "public"."time_logs" USING "btree" ("tenant_id", "user_id", "created_at" DESC);



CREATE INDEX "idx_time_logs_user" ON "public"."time_logs" USING "btree" ("user_id");



CREATE INDEX "idx_timer_status_running" ON "public"."timer_status" USING "btree" ("running_time_log_id");



CREATE INDEX "idx_timer_status_tenant" ON "public"."timer_status" USING "btree" ("tenant_id");



CREATE INDEX "idx_tour_parts_tour" ON "public"."study_tour_participants" USING "btree" ("tour_id");



CREATE INDEX "idx_tours_status" ON "public"."study_tours" USING "btree" ("status");



CREATE INDEX "idx_user_dashboard_layouts_tenant" ON "public"."user_dashboard_layouts" USING "btree" ("tenant_id");



CREATE INDEX "idx_user_dashboard_layouts_user" ON "public"."user_dashboard_layouts" USING "btree" ("user_id");



CREATE INDEX "idx_user_roles_role" ON "public"."user_roles" USING "btree" ("role_id");



CREATE INDEX "idx_user_roles_tenant" ON "public"."user_roles" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "idx_user_roles_tenant_unique" ON "public"."user_roles" USING "btree" ("tenant_id", "user_id", "role_id");



CREATE INDEX "idx_user_roles_user" ON "public"."user_roles" USING "btree" ("user_id");



CREATE INDEX "idx_web_users_tenant" ON "public"."web_users" USING "btree" ("tenant_id");



CREATE INDEX "idx_year" ON "public"."immigration_cases" USING "btree" ("year");



CREATE INDEX "judge_bios_fts_idx" ON "public"."judge_bios" USING "gin" ("to_tsvector"('"english"'::"regconfig", ((((((COALESCE("full_name", ''::"text") || ' '::"text") || COALESCE("role", ''::"text")) || ' '::"text") || COALESCE("previously", ''::"text")) || ' '::"text") || COALESCE("current_role_desc", ''::"text"))));



CREATE INDEX "judge_bios_legal_status_idx" ON "public"."judge_bios" USING "btree" ("legal_status") WHERE ("legal_status" IS NOT NULL);



CREATE INDEX "judge_bios_qualification_idx" ON "public"."judge_bios" USING "btree" ("has_legal_qualification", "no_legal_qualification");



CREATE UNIQUE INDEX "uq_account_mappings_tenant_provider_category" ON "public"."account_mappings" USING "btree" ("tenant_id", "provider", "bsmart_category");



CREATE UNIQUE INDEX "uq_accounting_integrations_tenant_provider" ON "public"."accounting_integrations" USING "btree" ("tenant_id", "provider");



CREATE UNIQUE INDEX "uq_applications_id_tenant" ON "public"."applications" USING "btree" ("id", "tenant_id");



CREATE UNIQUE INDEX "uq_clients_id_tenant" ON "public"."clients" USING "btree" ("id", "tenant_id");



CREATE UNIQUE INDEX "uq_commission_claims_tenant_number" ON "public"."commission_claims" USING "btree" ("tenant_id", "claim_number");



CREATE UNIQUE INDEX "uq_commission_invoice_items_tenant_pair" ON "public"."commission_invoice_items" USING "btree" ("tenant_id", "commission_invoice_id", "commission_id");



CREATE UNIQUE INDEX "uq_commission_invoices_tenant_number" ON "public"."commission_invoices" USING "btree" ("tenant_id", "invoice_number");



CREATE UNIQUE INDEX "uq_commission_semester_entries_tenant_slot" ON "public"."commission_semester_entries" USING "btree" ("tenant_id", "commission_id", "semester_number");



CREATE UNIQUE INDEX "uq_commission_tracking_tenant_number" ON "public"."commission_tracking" USING "btree" ("tenant_id", "commission_number");



CREATE UNIQUE INDEX "uq_document_requirements_visa_type_document_name" ON "public"."document_requirements" USING "btree" ("visa_type", "document_name");



CREATE UNIQUE INDEX "uq_enquiries_enquiry_number" ON "public"."enquiries" USING "btree" ("enquiry_number");



CREATE UNIQUE INDEX "uq_enrolments_enrolment_number" ON "public"."enrolments" USING "btree" ("enrolment_number");



CREATE UNIQUE INDEX "uq_immi_mapping_tenant_status" ON "public"."immiaccount_status_mappings" USING "btree" ("tenant_id", "immiaccount_status");



CREATE UNIQUE INDEX "uq_immiaccount_config_tenant" ON "public"."immiaccount_config" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "uq_immiaccount_status_mappings_tenant_status" ON "public"."immiaccount_status_mappings" USING "btree" ("tenant_id", "immiaccount_status");



CREATE UNIQUE INDEX "uq_invoices_invoice_number" ON "public"."invoices" USING "btree" ("invoice_number");



CREATE UNIQUE INDEX "uq_leads_lead_number" ON "public"."leads" USING "btree" ("lead_number");



CREATE UNIQUE INDEX "uq_offices_code" ON "public"."offices" USING "btree" ("code");



CREATE UNIQUE INDEX "uq_partners_partner_number" ON "public"."partners" USING "btree" ("partner_number");



CREATE UNIQUE INDEX "uq_quotations_quotation_number" ON "public"."quotations" USING "btree" ("quotation_number");



CREATE UNIQUE INDEX "uq_roles_name" ON "public"."roles" USING "btree" ("name");



CREATE UNIQUE INDEX "uq_study_tour_participants_tour_id_client_id" ON "public"."study_tour_participants" USING "btree" ("tour_id", "client_id");



CREATE UNIQUE INDEX "uq_study_tours_tour_number" ON "public"."study_tours" USING "btree" ("tour_number");



CREATE UNIQUE INDEX "uq_suppliers_supplier_number" ON "public"."suppliers" USING "btree" ("supplier_number");



CREATE UNIQUE INDEX "uq_survey_instances_access_token" ON "public"."survey_instances" USING "btree" ("access_token");



CREATE UNIQUE INDEX "uq_system_settings_tenant_key" ON "public"."system_settings" USING "btree" ("tenant_id", "key");



CREATE UNIQUE INDEX "uq_tenant_dashboard_defaults_tenant_role" ON "public"."tenant_dashboard_defaults" USING "btree" ("tenant_id", "role_name");



CREATE UNIQUE INDEX "uq_tenant_settings_tenant" ON "public"."tenant_settings" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "uq_tenant_usage_logs_tenant_month" ON "public"."tenant_usage_logs" USING "btree" ("tenant_id", "month");



CREATE UNIQUE INDEX "uq_tenants_custom_domain" ON "public"."tenants" USING "btree" ("custom_domain");



CREATE UNIQUE INDEX "uq_tenants_slug" ON "public"."tenants" USING "btree" ("slug");



CREATE UNIQUE INDEX "uq_tenants_subdomain" ON "public"."tenants" USING "btree" ("subdomain");



CREATE UNIQUE INDEX "uq_timer_status_tenant_user" ON "public"."timer_status" USING "btree" ("tenant_id", "user_id");



CREATE UNIQUE INDEX "uq_user_dashboard_layouts_tenant_user" ON "public"."user_dashboard_layouts" USING "btree" ("tenant_id", "user_id");



CREATE UNIQUE INDEX "uq_user_roles_user_id_role_id" ON "public"."user_roles" USING "btree" ("user_id", "role_id");



CREATE UNIQUE INDEX "uq_user_starred" ON "public"."user_starred_items" USING "btree" ("user_id", "tenant_id", "item_type", COALESCE("item_id", ''::"text"));



CREATE UNIQUE INDEX "uq_web_users_username" ON "public"."web_users" USING "btree" ("username");



CREATE OR REPLACE TRIGGER "tenants_seed_default_module_entitlements" AFTER INSERT ON "core"."tenants" FOR EACH ROW EXECUTE FUNCTION "private"."seed_default_module_entitlements_trigger"();



CREATE OR REPLACE TRIGGER "judge_bios_updated_at" BEFORE UPDATE ON "public"."judge_bios" FOR EACH ROW EXECUTE FUNCTION "public"."update_judge_bios_updated_at"();



CREATE OR REPLACE TRIGGER "update_immigration_cases_modtime" BEFORE UPDATE ON "public"."immigration_cases" FOR EACH ROW EXECUTE FUNCTION "public"."update_modified_column"();



ALTER TABLE ONLY "core"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "core"."audit_logs"
    ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "core"."module_entitlements"
    ADD CONSTRAINT "module_entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."offices"
    ADD CONSTRAINT "offices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."profiles"
    ADD CONSTRAINT "profiles_default_office_id_fkey" FOREIGN KEY ("default_office_id") REFERENCES "core"."offices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "core"."profiles"
    ADD CONSTRAINT "profiles_default_tenant_id_fkey" FOREIGN KEY ("default_tenant_id") REFERENCES "core"."tenants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "core"."profiles"
    ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."roles"
    ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "core"."offices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "core"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_role_fk" FOREIGN KEY ("tenant_id", "role_key") REFERENCES "core"."roles"("tenant_id", "role_key") ON DELETE RESTRICT;



ALTER TABLE ONLY "core"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "core"."tenant_memberships"
    ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "crm"."applications"
    ADD CONSTRAINT "applications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "crm"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "crm"."applications"
    ADD CONSTRAINT "applications_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "crm"."applications"
    ADD CONSTRAINT "applications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "crm"."client_notes"
    ADD CONSTRAINT "client_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "crm"."client_notes"
    ADD CONSTRAINT "client_notes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "crm"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "crm"."client_notes"
    ADD CONSTRAINT "client_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "crm"."clients"
    ADD CONSTRAINT "clients_assigned_consultant_user_id_fkey" FOREIGN KEY ("assigned_consultant_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "crm"."clients"
    ADD CONSTRAINT "clients_office_id_fkey" FOREIGN KEY ("office_id") REFERENCES "core"."offices"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "crm"."clients"
    ADD CONSTRAINT "clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "crm"."survey_instances"
    ADD CONSTRAINT "survey_instances_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "crm"."survey_instances"
    ADD CONSTRAINT "survey_instances_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "crm"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "crm"."survey_instances"
    ADD CONSTRAINT "survey_instances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "crm"."survey_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "crm"."survey_instances"
    ADD CONSTRAINT "survey_instances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "crm"."survey_responses"
    ADD CONSTRAINT "survey_responses_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "crm"."survey_responses"
    ADD CONSTRAINT "survey_responses_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "crm"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "crm"."survey_responses"
    ADD CONSTRAINT "survey_responses_survey_instance_id_fkey" FOREIGN KEY ("survey_instance_id") REFERENCES "crm"."survey_instances"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "crm"."survey_responses"
    ADD CONSTRAINT "survey_responses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "crm"."survey_templates"
    ADD CONSTRAINT "survey_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "crm"."survey_templates"
    ADD CONSTRAINT "survey_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "crm"."tasks"
    ADD CONSTRAINT "tasks_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "crm"."applications"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "crm"."tasks"
    ADD CONSTRAINT "tasks_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "crm"."tasks"
    ADD CONSTRAINT "tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "crm"."tasks"
    ADD CONSTRAINT "tasks_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "crm"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "crm"."tasks"
    ADD CONSTRAINT "tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "law"."case_annotations"
    ADD CONSTRAINT "case_annotations_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "law"."case_annotations"
    ADD CONSTRAINT "case_annotations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "law"."client_case_links"
    ADD CONSTRAINT "client_case_links_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "crm"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "law"."client_case_links"
    ADD CONSTRAINT "client_case_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "law"."client_case_links"
    ADD CONSTRAINT "client_case_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "law"."research_sessions"
    ADD CONSTRAINT "research_sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "crm"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "law"."research_sessions"
    ADD CONSTRAINT "research_sessions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "law"."research_sessions"
    ADD CONSTRAINT "research_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "law"."saved_searches"
    ADD CONSTRAINT "saved_searches_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "law"."saved_searches"
    ADD CONSTRAINT "saved_searches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "core"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."account_mappings"
    ADD CONSTRAINT "account_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."accounting_integrations"
    ADD CONSTRAINT "accounting_integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."accounting_integrations"
    ADD CONSTRAINT "accounting_integrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."accounting_sync_logs"
    ADD CONSTRAINT "accounting_sync_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_calls"
    ADD CONSTRAINT "agent_calls_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."agent_schedule_logs"
    ADD CONSTRAINT "agent_schedule_logs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."agent_schedules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_interactions"
    ADD CONSTRAINT "ai_interactions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_interactions"
    ADD CONSTRAINT "ai_interactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_interactions"
    ADD CONSTRAINT "ai_interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."application_checklist_items"
    ADD CONSTRAINT "application_checklist_items_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."application_checklist_items"
    ADD CONSTRAINT "application_checklist_items_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."application_compliance"
    ADD CONSTRAINT "application_compliance_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."application_compliance"
    ADD CONSTRAINT "application_compliance_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."client_documents"("id");



ALTER TABLE ONLY "public"."application_compliance"
    ADD CONSTRAINT "application_compliance_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "public"."document_requirements"("id");



ALTER TABLE ONLY "public"."application_compliance"
    ADD CONSTRAINT "application_compliance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."application_compliance"
    ADD CONSTRAINT "application_compliance_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."application_document_requirements"
    ADD CONSTRAINT "application_document_requirements_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."application_document_requirements"
    ADD CONSTRAINT "application_document_requirements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."application_document_requirements"
    ADD CONSTRAINT "application_document_requirements_uploaded_document_id_fkey" FOREIGN KEY ("uploaded_document_id") REFERENCES "public"."client_documents"("id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_parent_application_id_fkey" FOREIGN KEY ("parent_application_id") REFERENCES "public"."applications"("id");



ALTER TABLE ONLY "public"."applications"
    ADD CONSTRAINT "applications_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."calendar_sync_tokens"
    ADD CONSTRAINT "calendar_sync_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_assessment_progress"
    ADD CONSTRAINT "client_assessment_progress_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."client_assessment_progress"
    ADD CONSTRAINT "client_assessment_progress_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."client_documents"
    ADD CONSTRAINT "client_documents_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "public"."application_document_requirements"("id");



ALTER TABLE ONLY "public"."client_feedback"
    ADD CONSTRAINT "client_feedback_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id");



ALTER TABLE ONLY "public"."client_feedback"
    ADD CONSTRAINT "client_feedback_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."client_feedback"
    ADD CONSTRAINT "client_feedback_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."client_feedback"
    ADD CONSTRAINT "client_feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."client_portal_activity"
    ADD CONSTRAINT "client_portal_activity_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_portal_activity"
    ADD CONSTRAINT "client_portal_activity_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_portal_intake_forms"
    ADD CONSTRAINT "client_portal_intake_forms_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_portal_intake_forms"
    ADD CONSTRAINT "client_portal_intake_forms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_portal_users"
    ADD CONSTRAINT "client_portal_users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_portal_users"
    ADD CONSTRAINT "client_portal_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_handler_consultant_id_fkey" FOREIGN KEY ("handler_consultant_id") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_sales_consultant_id_fkey" FOREIGN KEY ("sales_consultant_id") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."commission_claim_reports"
    ADD CONSTRAINT "commission_claim_reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."commission_claim_reports"
    ADD CONSTRAINT "commission_claim_reports_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id");



ALTER TABLE ONLY "public"."commission_claim_reports"
    ADD CONSTRAINT "commission_claim_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."commission_claims"
    ADD CONSTRAINT "commission_claims_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."commission_invoices"("id");



ALTER TABLE ONLY "public"."commission_entitlements"
    ADD CONSTRAINT "commission_entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commission_rate_config"
    ADD CONSTRAINT "commission_rate_config_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."commission_school_receipts"
    ADD CONSTRAINT "commission_school_receipts_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "public"."commission_tracking"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commission_school_receipts"
    ADD CONSTRAINT "commission_school_receipts_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."commission_tracking"
    ADD CONSTRAINT "commission_tracking_payee_partner_id_fkey" FOREIGN KEY ("payee_partner_id") REFERENCES "public"."partners"("id");



ALTER TABLE ONLY "public"."commission_tracking"
    ADD CONSTRAINT "commission_tracking_payee_user_id_fkey" FOREIGN KEY ("payee_user_id") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."compliance_alerts"
    ADD CONSTRAINT "compliance_alerts_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compliance_alerts"
    ADD CONSTRAINT "compliance_alerts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compliance_alerts"
    ADD CONSTRAINT "compliance_alerts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "public"."web_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."compliance_alerts"
    ADD CONSTRAINT "compliance_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."custom_pages"
    ADD CONSTRAINT "custom_pages_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."custom_pages"
    ADD CONSTRAINT "custom_pages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."data_change_log"
    ADD CONSTRAINT "data_change_log_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "public"."web_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."data_change_log"
    ADD CONSTRAINT "data_change_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."data_quality_audit_log"
    ADD CONSTRAINT "data_quality_audit_log_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."data_quality_audit_log"
    ADD CONSTRAINT "data_quality_audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."data_quality_rules"
    ADD CONSTRAINT "data_quality_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."data_quality_scores"
    ADD CONSTRAINT "data_quality_scores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_checklist_template_items"
    ADD CONSTRAINT "document_checklist_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."document_checklist_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_checklist_templates"
    ADD CONSTRAINT "document_checklist_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_expiry_tracking"
    ADD CONSTRAINT "document_expiry_tracking_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_expiry_tracking"
    ADD CONSTRAINT "document_expiry_tracking_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_extractions"
    ADD CONSTRAINT "document_extractions_applied_to_application_id_fkey" FOREIGN KEY ("applied_to_application_id") REFERENCES "public"."applications"("id");



ALTER TABLE ONLY "public"."document_extractions"
    ADD CONSTRAINT "document_extractions_applied_to_client_id_fkey" FOREIGN KEY ("applied_to_client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."document_extractions"
    ADD CONSTRAINT "document_extractions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."document_extractions"
    ADD CONSTRAINT "document_extractions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."client_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_extractions"
    ADD CONSTRAINT "document_extractions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."document_extractions"
    ADD CONSTRAINT "document_extractions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."document_requirement_reminders"
    ADD CONSTRAINT "document_requirement_reminders_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "public"."application_document_requirements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."education_history"
    ADD CONSTRAINT "education_history_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employment_history"
    ADD CONSTRAINT "employment_history_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."english_scores"
    ADD CONSTRAINT "english_scores_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enrolments"
    ADD CONSTRAINT "enrolments_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."immiaccount_sync_logs"
    ADD CONSTRAINT "immiaccount_sync_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."institution_rate_agreements"
    ADD CONSTRAINT "institution_rate_agreements_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id");



ALTER TABLE ONLY "public"."institution_rate_agreements"
    ADD CONSTRAINT "institution_rate_agreements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."institution_rate_agreements"
    ADD CONSTRAINT "institution_rate_agreements_institution_id_fkey" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id");



ALTER TABLE ONLY "public"."kb_alternative_authorities"
    ADD CONSTRAINT "kb_alternative_authorities_anzsco_code_fkey" FOREIGN KEY ("anzsco_code") REFERENCES "public"."kb_occupations"("anzsco_code");



ALTER TABLE ONLY "public"."kb_alternative_authorities"
    ADD CONSTRAINT "kb_alternative_authorities_authority_code_fkey" FOREIGN KEY ("authority_code") REFERENCES "public"."kb_assessing_authorities"("code");



ALTER TABLE ONLY "public"."kb_assessment_pathways"
    ADD CONSTRAINT "kb_assessment_pathways_authority_code_fkey" FOREIGN KEY ("authority_code") REFERENCES "public"."kb_assessing_authorities"("code");



ALTER TABLE ONLY "public"."kb_authority_process_steps"
    ADD CONSTRAINT "kb_authority_process_steps_authority_code_fkey" FOREIGN KEY ("authority_code") REFERENCES "public"."kb_assessing_authorities"("code");



ALTER TABLE ONLY "public"."kb_authority_rules"
    ADD CONSTRAINT "kb_authority_rules_authority_code_fkey" FOREIGN KEY ("authority_code") REFERENCES "public"."kb_assessing_authorities"("code");



ALTER TABLE ONLY "public"."kb_change_history"
    ADD CONSTRAINT "kb_change_history_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."web_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."kb_change_history"
    ADD CONSTRAINT "kb_change_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kb_cricos_courses"
    ADD CONSTRAINT "kb_cricos_courses_cricos_provider_code_fkey" FOREIGN KEY ("cricos_provider_code") REFERENCES "public"."kb_cricos_providers"("cricos_provider_code") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kb_cricos_providers"
    ADD CONSTRAINT "kb_cricos_providers_promoted_to_institution_id_fkey" FOREIGN KEY ("promoted_to_institution_id") REFERENCES "public"."institutions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."kb_document_checklist"
    ADD CONSTRAINT "kb_document_checklist_nuance_id_fkey" FOREIGN KEY ("nuance_id") REFERENCES "public"."kb_eligibility_nuances"("nuance_id");



ALTER TABLE ONLY "public"."kb_exemptions"
    ADD CONSTRAINT "kb_exemptions_authority_code_fkey" FOREIGN KEY ("authority_code") REFERENCES "public"."kb_assessing_authorities"("code");



ALTER TABLE ONLY "public"."kb_state_invitation_scores"
    ADD CONSTRAINT "kb_state_invitation_scores_state_code_fkey" FOREIGN KEY ("state_code") REFERENCES "public"."kb_state_quotas"("state_code");



ALTER TABLE ONLY "public"."kb_state_rules"
    ADD CONSTRAINT "kb_state_rules_state_code_fkey" FOREIGN KEY ("state_code") REFERENCES "public"."kb_state_quotas"("state_code");



ALTER TABLE ONLY "public"."kb_versions"
    ADD CONSTRAINT "kb_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."kb_wizard_options"
    ADD CONSTRAINT "kb_wizard_options_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "public"."kb_wizard_steps"("step_id");



ALTER TABLE ONLY "public"."lead_ai_scores"
    ADD CONSTRAINT "lead_ai_scores_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_ai_scores"
    ADD CONSTRAINT "lead_ai_scores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ocr_jobs"
    ADD CONSTRAINT "ocr_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."partner_invites"
    ADD CONSTRAINT "partner_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."partner_invites"
    ADD CONSTRAINT "partner_invites_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id");



ALTER TABLE ONLY "public"."partner_invites"
    ADD CONSTRAINT "partner_invites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."partner_portal_users"
    ADD CONSTRAINT "partner_portal_users_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id");



ALTER TABLE ONLY "public"."partner_portal_users"
    ADD CONSTRAINT "partner_portal_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."report_runs"
    ADD CONSTRAINT "report_runs_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."scheduled_reports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."risk_assessments"
    ADD CONSTRAINT "risk_assessments_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id");



ALTER TABLE ONLY "public"."risk_assessments"
    ADD CONSTRAINT "risk_assessments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."risk_assessments"
    ADD CONSTRAINT "risk_assessments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."risk_assessments"
    ADD CONSTRAINT "risk_assessments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."service_fee_plans"
    ADD CONSTRAINT "service_fee_plans_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id");



ALTER TABLE ONLY "public"."service_fee_plans"
    ADD CONSTRAINT "service_fee_plans_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."service_fee_plans"
    ADD CONSTRAINT "service_fee_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."service_fee_plans"
    ADD CONSTRAINT "service_fee_plans_deposit_invoice_id_fkey" FOREIGN KEY ("deposit_invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."service_fee_plans"
    ADD CONSTRAINT "service_fee_plans_final_invoice_id_fkey" FOREIGN KEY ("final_invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."service_fee_plans"
    ADD CONSTRAINT "service_fee_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."staff_achievements"
    ADD CONSTRAINT "staff_achievements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."staff_achievements"
    ADD CONSTRAINT "staff_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."staff_audit_log"
    ADD CONSTRAINT "staff_audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE SET DEFAULT;



ALTER TABLE ONLY "public"."staff_audit_log"
    ADD CONSTRAINT "staff_audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."staff_goals"
    ADD CONSTRAINT "staff_goals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."staff_goals"
    ADD CONSTRAINT "staff_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."staff_performance_metrics"
    ADD CONSTRAINT "staff_performance_metrics_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id");



ALTER TABLE ONLY "public"."staff_performance_metrics"
    ADD CONSTRAINT "staff_performance_metrics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."tenant_onboarding_progress"
    ADD CONSTRAINT "tenant_onboarding_progress_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_subscriptions"
    ADD CONSTRAINT "tenant_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id");



ALTER TABLE ONLY "public"."tenant_subscriptions"
    ADD CONSTRAINT "tenant_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."time_logs"
    ADD CONSTRAINT "time_logs_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id");



ALTER TABLE ONLY "public"."time_logs"
    ADD CONSTRAINT "time_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."time_logs"
    ADD CONSTRAINT "time_logs_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."time_logs"
    ADD CONSTRAINT "time_logs_invoice_item_id_fkey" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id");



ALTER TABLE ONLY "public"."time_logs"
    ADD CONSTRAINT "time_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."time_logs"
    ADD CONSTRAINT "time_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."timer_status"
    ADD CONSTRAINT "timer_status_running_time_log_id_fkey" FOREIGN KEY ("running_time_log_id") REFERENCES "public"."time_logs"("id");



ALTER TABLE ONLY "public"."timer_status"
    ADD CONSTRAINT "timer_status_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."timer_status"
    ADD CONSTRAINT "timer_status_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id");



ALTER TABLE ONLY "public"."usage_stats"
    ADD CONSTRAINT "usage_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id");



ALTER TABLE ONLY "public"."user_starred_items"
    ADD CONSTRAINT "user_starred_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_starred_items"
    ADD CONSTRAINT "user_starred_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."web_users"("id") ON DELETE CASCADE;



ALTER TABLE "core"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_select" ON "core"."audit_logs" FOR SELECT TO "authenticated" USING (("private"."is_platform_admin"() OR "private"."can_manage_tenant"("tenant_id")));



CREATE POLICY "memberships_manage" ON "core"."tenant_memberships" TO "authenticated" USING ("private"."can_manage_tenant"("tenant_id")) WITH CHECK ("private"."can_manage_tenant"("tenant_id"));



CREATE POLICY "memberships_select" ON "core"."tenant_memberships" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "private"."is_platform_admin"() OR "private"."can_manage_tenant"("tenant_id")));



ALTER TABLE "core"."module_entitlements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "module_entitlements_manage" ON "core"."module_entitlements" TO "authenticated" USING ("private"."can_manage_tenant"("tenant_id")) WITH CHECK ("private"."can_manage_tenant"("tenant_id"));



CREATE POLICY "module_entitlements_select" ON "core"."module_entitlements" FOR SELECT TO "authenticated" USING (("private"."is_platform_admin"() OR "private"."has_active_membership"("tenant_id")));



ALTER TABLE "core"."offices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "offices_manage" ON "core"."offices" TO "authenticated" USING ("private"."can_manage_tenant"("tenant_id")) WITH CHECK ("private"."can_manage_tenant"("tenant_id"));



CREATE POLICY "offices_select" ON "core"."offices" FOR SELECT TO "authenticated" USING (("private"."is_platform_admin"() OR "private"."has_active_membership"("tenant_id")));



ALTER TABLE "core"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select" ON "core"."profiles" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "private"."is_platform_admin"() OR (("default_tenant_id" IS NOT NULL) AND "private"."can_manage_tenant"("default_tenant_id"))));



CREATE POLICY "profiles_update" ON "core"."profiles" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "private"."is_platform_admin"())) WITH CHECK ((("user_id" = "auth"."uid"()) OR "private"."is_platform_admin"()));



ALTER TABLE "core"."roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roles_manage" ON "core"."roles" TO "authenticated" USING ("private"."can_manage_tenant"("tenant_id")) WITH CHECK ("private"."can_manage_tenant"("tenant_id"));



CREATE POLICY "roles_select" ON "core"."roles" FOR SELECT TO "authenticated" USING (("private"."is_platform_admin"() OR "private"."has_active_membership"("tenant_id")));



ALTER TABLE "core"."tenant_memberships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "core"."tenants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenants_manage" ON "core"."tenants" FOR UPDATE TO "authenticated" USING ("private"."can_manage_tenant"("id")) WITH CHECK ("private"."can_manage_tenant"("id"));



CREATE POLICY "tenants_select" ON "core"."tenants" FOR SELECT TO "authenticated" USING (("private"."is_platform_admin"() OR "private"."has_active_membership"("id")));



ALTER TABLE "crm"."applications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "applications_select" ON "crm"."applications" FOR SELECT TO "authenticated" USING ("private"."can_access_assigned_row"("tenant_id", 'crm'::"text", "owner_user_id"));



CREATE POLICY "applications_write" ON "crm"."applications" TO "authenticated" USING ("private"."can_access_assigned_row"("tenant_id", 'crm'::"text", "owner_user_id")) WITH CHECK (("private"."has_module_access"("tenant_id", 'crm'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("owner_user_id" = "auth"."uid"()))));



ALTER TABLE "crm"."client_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_notes_select" ON "crm"."client_notes" FOR SELECT TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'crm'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("author_user_id" = "auth"."uid"()))));



CREATE POLICY "client_notes_write" ON "crm"."client_notes" TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'crm'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("author_user_id" = "auth"."uid"())))) WITH CHECK (("private"."has_module_access"("tenant_id", 'crm'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("author_user_id" = "auth"."uid"()))));



ALTER TABLE "crm"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_insert" ON "crm"."clients" FOR INSERT TO "authenticated" WITH CHECK (("private"."has_module_access"("tenant_id", 'crm'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("assigned_consultant_user_id" = "auth"."uid"()))));



CREATE POLICY "clients_select" ON "crm"."clients" FOR SELECT TO "authenticated" USING ("private"."can_access_assigned_row"("tenant_id", 'crm'::"text", "assigned_consultant_user_id"));



CREATE POLICY "clients_update" ON "crm"."clients" FOR UPDATE TO "authenticated" USING ("private"."can_access_assigned_row"("tenant_id", 'crm'::"text", "assigned_consultant_user_id")) WITH CHECK (("private"."has_module_access"("tenant_id", 'crm'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("assigned_consultant_user_id" = "auth"."uid"()))));



ALTER TABLE "crm"."survey_instances" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "survey_instances_select" ON "crm"."survey_instances" FOR SELECT TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'surveys'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("agent_id" = "auth"."uid"()))));



CREATE POLICY "survey_instances_write" ON "crm"."survey_instances" TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'surveys'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("agent_id" = "auth"."uid"())))) WITH CHECK (("private"."has_module_access"("tenant_id", 'surveys'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("agent_id" = "auth"."uid"()))));



ALTER TABLE "crm"."survey_responses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "survey_responses_select" ON "crm"."survey_responses" FOR SELECT TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'surveys'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("agent_id" = "auth"."uid"()))));



ALTER TABLE "crm"."survey_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "survey_templates_select" ON "crm"."survey_templates" FOR SELECT TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'surveys'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("created_by" = "auth"."uid"()))));



CREATE POLICY "survey_templates_write" ON "crm"."survey_templates" TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'surveys'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("created_by" = "auth"."uid"())))) WITH CHECK (("private"."has_module_access"("tenant_id", 'surveys'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("created_by" = "auth"."uid"()))));



ALTER TABLE "crm"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_select" ON "crm"."tasks" FOR SELECT TO "authenticated" USING ("private"."can_access_assigned_row"("tenant_id", 'crm'::"text", "assigned_to"));



CREATE POLICY "tasks_write" ON "crm"."tasks" TO "authenticated" USING ("private"."can_access_assigned_row"("tenant_id", 'crm'::"text", "assigned_to")) WITH CHECK (("private"."has_module_access"("tenant_id", 'crm'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("assigned_to" = "auth"."uid"()) OR ("assigned_by" = "auth"."uid"()))));



ALTER TABLE "law"."case_annotations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "case_annotations_select" ON "law"."case_annotations" FOR SELECT TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'law'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("author_user_id" = "auth"."uid"()) OR ("visibility" = 'tenant'::"text"))));



CREATE POLICY "case_annotations_write" ON "law"."case_annotations" TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'law'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("author_user_id" = "auth"."uid"())))) WITH CHECK (("private"."has_module_access"("tenant_id", 'law'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("author_user_id" = "auth"."uid"()))));



ALTER TABLE "law"."client_case_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_case_links_select" ON "law"."client_case_links" FOR SELECT TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'law'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("created_by" = "auth"."uid"()))));



CREATE POLICY "client_case_links_write" ON "law"."client_case_links" TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'law'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("created_by" = "auth"."uid"())))) WITH CHECK (("private"."has_module_access"("tenant_id", 'law'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("created_by" = "auth"."uid"()))));



ALTER TABLE "law"."research_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "research_sessions_select" ON "law"."research_sessions" FOR SELECT TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'law'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("owner_user_id" = "auth"."uid"()))));



CREATE POLICY "research_sessions_write" ON "law"."research_sessions" TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'law'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("owner_user_id" = "auth"."uid"())))) WITH CHECK (("private"."has_module_access"("tenant_id", 'law'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("owner_user_id" = "auth"."uid"()))));



ALTER TABLE "law"."saved_searches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "saved_searches_select" ON "law"."saved_searches" FOR SELECT TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'law'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("owner_user_id" = "auth"."uid"()) OR ("is_shared" = true))));



CREATE POLICY "saved_searches_write" ON "law"."saved_searches" TO "authenticated" USING (("private"."has_module_access"("tenant_id", 'law'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("owner_user_id" = "auth"."uid"())))) WITH CHECK (("private"."has_module_access"("tenant_id", 'law'::"text") AND ("private"."can_manage_tenant"("tenant_id") OR ("owner_user_id" = "auth"."uid"()))));



CREATE POLICY "Allow public read on judge_bios" ON "public"."judge_bios" FOR SELECT USING (true);



CREATE POLICY "Allow service role all on judge_bios" ON "public"."judge_bios" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."account_mappings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounting_integrations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."accounting_sync_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_calls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_schedule_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_schedules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_interactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allow_public_read" ON "public"."immigration_cases" FOR SELECT USING (true);



ALTER TABLE "public"."application_checklist_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."application_compliance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."application_document_requirements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."application_stage_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."applications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."auth_otp_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."automation_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."automation_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."calendar_sync_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_activity_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_assessment_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_feedback" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_milestones" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_portal_activity" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_portal_intake_forms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."client_portal_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_claim_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_claim_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_claims" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_entitlements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_invoice_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_rate_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_school_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_semester_entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commission_tracking" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."communication_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."compliance_alerts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."courses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."custom_pages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."data_change_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."data_quality_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."data_quality_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."data_quality_scores" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deny_anon_delete" ON "public"."immigration_cases" FOR DELETE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "deny_anon_insert" ON "public"."immigration_cases" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "deny_anon_update" ON "public"."immigration_cases" FOR UPDATE USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."document_checklist_template_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_checklist_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_expiry_tracking" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_extractions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_requirement_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_requirements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."education_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employment_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."english_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."enquiries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."enrolments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."error_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."immiaccount_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."immiaccount_status_mappings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."immiaccount_sync_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."immigration_cases" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."institution_rate_agreements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."institutions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoice_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."judge_bios" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_admin_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_alternative_authorities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_assessing_authorities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_assessment_pathways" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_authority_process_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_authority_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_change_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_change_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_common_mistakes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_cricos_courses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_cricos_providers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_document_checklist" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_eligibility_nuances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_english_reqs_specific" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_eoi_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_exemptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_faq" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_health_character_requirements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_invitation_rounds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_invitation_trends" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_occupation_tiers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_occupations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_partner_points_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_points_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_state_invitation_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_state_quotas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_state_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_step_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_visa_comparison" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_visa_constraints" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_visa_fees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_wizard_options" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."kb_wizard_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_ai_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_delivery_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."obs_activity_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."obs_error_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ocr_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."offices" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."partner_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."partner_portal_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."partners" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quotation_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quotations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."report_runs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."risk_assessments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scheduled_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."schema_versions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_fee_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_achievements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_goals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."staff_performance_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."study_tour_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."study_tours" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscription_plans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."suppliers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survey_instances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survey_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."survey_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_dashboard_defaults" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_onboarding_progress" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenant_usage_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."time_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."timer_status" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."usage_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_dashboard_layouts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_starred_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."web_users" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TABLE "public"."immigration_cases" TO "anon";
GRANT ALL ON TABLE "public"."immigration_cases" TO "authenticated";
GRANT ALL ON TABLE "public"."immigration_cases" TO "service_role";



GRANT ALL ON FUNCTION "public"."find_related_cases"("p_case_id" "text", "p_case_nature" "text", "p_visa_type" "text", "p_court_code" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."find_related_cases"("p_case_id" "text", "p_case_nature" "text", "p_visa_type" "text", "p_court_code" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_related_cases"("p_case_id" "text", "p_case_nature" "text", "p_visa_type" "text", "p_court_code" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_analytics_concepts_raw"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_analytics_concepts_raw"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_analytics_concepts_raw"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_analytics_judges_raw"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_analytics_judges_raw"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_analytics_judges_raw"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_analytics_monthly_trends"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_analytics_monthly_trends"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_analytics_monthly_trends"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_analytics_nature_outcome"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_analytics_nature_outcome"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_analytics_nature_outcome"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_analytics_outcomes"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_analytics_outcomes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_analytics_outcomes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_analytics_outcomes_court"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_analytics_outcomes_court"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_analytics_outcomes_court"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_analytics_outcomes_visa"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_analytics_outcomes_visa"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_analytics_outcomes_visa"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_analytics_outcomes_year"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_analytics_outcomes_year"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_analytics_outcomes_year"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_case_filter_options"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_case_filter_options"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_case_filter_options"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_case_statistics"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_case_statistics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_case_statistics"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_court_year_trends"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_court_year_trends"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_court_year_trends"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_existing_urls"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_existing_urls"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_existing_urls"() TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_court_year_counts_mv"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_court_year_counts_mv"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_court_year_counts_mv"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."safe_date_to_sortint"("d" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."safe_date_to_sortint"("d" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."safe_date_to_sortint"("d" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."search_cases_hybrid"("p_query_text" "text", "p_query_embedding" "public"."vector", "p_provider" "text", "p_model" "text", "p_limit" integer, "p_candidate_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_cases_hybrid"("p_query_text" "text", "p_query_embedding" "public"."vector", "p_provider" "text", "p_model" "text", "p_limit" integer, "p_candidate_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_cases_hybrid"("p_query_text" "text", "p_query_embedding" "public"."vector", "p_provider" "text", "p_model" "text", "p_limit" integer, "p_candidate_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_cases_semantic"("p_query_embedding" "public"."vector", "p_provider" "text", "p_model" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_cases_semantic"("p_query_embedding" "public"."vector", "p_provider" "text", "p_model" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_cases_semantic"("p_query_embedding" "public"."vector", "p_provider" "text", "p_model" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_judge_bios_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_judge_bios_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_judge_bios_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_modified_column"() TO "service_role";



GRANT ALL ON TABLE "public"."court_year_counts_mv" TO "anon";
GRANT ALL ON TABLE "public"."court_year_counts_mv" TO "authenticated";
GRANT ALL ON TABLE "public"."court_year_counts_mv" TO "service_role";



GRANT ALL ON TABLE "public"."judge_bios" TO "anon";
GRANT ALL ON TABLE "public"."judge_bios" TO "authenticated";
GRANT ALL ON TABLE "public"."judge_bios" TO "service_role";



GRANT ALL ON TABLE "public"."account_mappings" TO "anon";
GRANT ALL ON TABLE "public"."account_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."account_mappings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."account_mappings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."account_mappings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."account_mappings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."accounting_integrations" TO "anon";
GRANT ALL ON TABLE "public"."accounting_integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."accounting_integrations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."accounting_integrations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."accounting_integrations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."accounting_integrations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."accounting_sync_logs" TO "anon";
GRANT ALL ON TABLE "public"."accounting_sync_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."accounting_sync_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."accounting_sync_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."accounting_sync_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."accounting_sync_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."agent_calls" TO "anon";
GRANT ALL ON TABLE "public"."agent_calls" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_calls" TO "service_role";



GRANT ALL ON SEQUENCE "public"."agent_calls_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."agent_calls_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."agent_calls_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."agent_config" TO "anon";
GRANT ALL ON TABLE "public"."agent_config" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_config" TO "service_role";



GRANT ALL ON SEQUENCE "public"."agent_config_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."agent_config_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."agent_config_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."agent_schedule_logs" TO "anon";
GRANT ALL ON TABLE "public"."agent_schedule_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_schedule_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."agent_schedule_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."agent_schedule_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."agent_schedule_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."agent_schedules" TO "anon";
GRANT ALL ON TABLE "public"."agent_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_schedules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."agent_schedules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."agent_schedules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."agent_schedules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ai_interactions" TO "anon";
GRANT ALL ON TABLE "public"."ai_interactions" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_interactions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_interactions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_interactions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_interactions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."application_checklist_items" TO "anon";
GRANT ALL ON TABLE "public"."application_checklist_items" TO "authenticated";
GRANT ALL ON TABLE "public"."application_checklist_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."application_checklist_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."application_checklist_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."application_checklist_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."application_compliance" TO "anon";
GRANT ALL ON TABLE "public"."application_compliance" TO "authenticated";
GRANT ALL ON TABLE "public"."application_compliance" TO "service_role";



GRANT ALL ON SEQUENCE "public"."application_compliance_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."application_compliance_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."application_compliance_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."application_document_requirements" TO "anon";
GRANT ALL ON TABLE "public"."application_document_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."application_document_requirements" TO "service_role";



GRANT ALL ON SEQUENCE "public"."application_document_requirements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."application_document_requirements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."application_document_requirements_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."application_stage_history" TO "anon";
GRANT ALL ON TABLE "public"."application_stage_history" TO "authenticated";
GRANT ALL ON TABLE "public"."application_stage_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."application_stage_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."application_stage_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."application_stage_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."applications" TO "anon";
GRANT ALL ON TABLE "public"."applications" TO "authenticated";
GRANT ALL ON TABLE "public"."applications" TO "service_role";



GRANT ALL ON SEQUENCE "public"."applications_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."applications_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."applications_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."appointments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."appointments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."appointments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."auth_otp_attempts" TO "anon";
GRANT ALL ON TABLE "public"."auth_otp_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."auth_otp_attempts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."auth_otp_attempts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."auth_otp_attempts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."auth_otp_attempts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."automation_logs" TO "anon";
GRANT ALL ON TABLE "public"."automation_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."automation_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."automation_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."automation_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."automation_rules" TO "anon";
GRANT ALL ON TABLE "public"."automation_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."automation_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."automation_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."automation_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."automation_rules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_sync_tokens" TO "anon";
GRANT ALL ON TABLE "public"."calendar_sync_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_sync_tokens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."calendar_sync_tokens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."calendar_sync_tokens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."calendar_sync_tokens_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."client_activity_log" TO "anon";
GRANT ALL ON TABLE "public"."client_activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."client_activity_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_activity_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_activity_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_activity_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."client_assessment_progress" TO "anon";
GRANT ALL ON TABLE "public"."client_assessment_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."client_assessment_progress" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_assessment_progress_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_assessment_progress_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_assessment_progress_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."client_documents" TO "anon";
GRANT ALL ON TABLE "public"."client_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."client_documents" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_documents_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_documents_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_documents_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."client_feedback" TO "anon";
GRANT ALL ON TABLE "public"."client_feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."client_feedback" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_feedback_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_feedback_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_feedback_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."client_milestones" TO "anon";
GRANT ALL ON TABLE "public"."client_milestones" TO "authenticated";
GRANT ALL ON TABLE "public"."client_milestones" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_milestones_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_milestones_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_milestones_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."client_notes" TO "anon";
GRANT ALL ON TABLE "public"."client_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."client_notes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_notes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_notes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_notes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."client_portal_activity" TO "anon";
GRANT ALL ON TABLE "public"."client_portal_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."client_portal_activity" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_portal_activity_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_portal_activity_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_portal_activity_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."client_portal_intake_forms" TO "anon";
GRANT ALL ON TABLE "public"."client_portal_intake_forms" TO "authenticated";
GRANT ALL ON TABLE "public"."client_portal_intake_forms" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_portal_intake_forms_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_portal_intake_forms_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_portal_intake_forms_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."client_portal_users" TO "anon";
GRANT ALL ON TABLE "public"."client_portal_users" TO "authenticated";
GRANT ALL ON TABLE "public"."client_portal_users" TO "service_role";



GRANT ALL ON SEQUENCE "public"."client_portal_users_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."client_portal_users_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."client_portal_users_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON SEQUENCE "public"."clients_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."clients_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."clients_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."commission_claim_items" TO "anon";
GRANT ALL ON TABLE "public"."commission_claim_items" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_claim_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."commission_claim_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."commission_claim_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."commission_claim_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."commission_claim_reports" TO "anon";
GRANT ALL ON TABLE "public"."commission_claim_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_claim_reports" TO "service_role";



GRANT ALL ON SEQUENCE "public"."commission_claim_reports_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."commission_claim_reports_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."commission_claim_reports_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."commission_claims" TO "anon";
GRANT ALL ON TABLE "public"."commission_claims" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_claims" TO "service_role";



GRANT ALL ON SEQUENCE "public"."commission_claims_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."commission_claims_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."commission_claims_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."commission_entitlements" TO "anon";
GRANT ALL ON TABLE "public"."commission_entitlements" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_entitlements" TO "service_role";



GRANT ALL ON SEQUENCE "public"."commission_entitlements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."commission_entitlements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."commission_entitlements_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."commission_invoice_items" TO "anon";
GRANT ALL ON TABLE "public"."commission_invoice_items" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_invoice_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."commission_invoice_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."commission_invoice_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."commission_invoice_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."commission_invoices" TO "anon";
GRANT ALL ON TABLE "public"."commission_invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_invoices" TO "service_role";



GRANT ALL ON SEQUENCE "public"."commission_invoices_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."commission_invoices_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."commission_invoices_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."commission_payments" TO "anon";
GRANT ALL ON TABLE "public"."commission_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_payments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."commission_payments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."commission_payments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."commission_payments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."commission_rate_config" TO "anon";
GRANT ALL ON TABLE "public"."commission_rate_config" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_rate_config" TO "service_role";



GRANT ALL ON SEQUENCE "public"."commission_rate_config_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."commission_rate_config_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."commission_rate_config_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."commission_school_receipts" TO "anon";
GRANT ALL ON TABLE "public"."commission_school_receipts" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_school_receipts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."commission_school_receipts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."commission_school_receipts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."commission_school_receipts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."commission_semester_entries" TO "anon";
GRANT ALL ON TABLE "public"."commission_semester_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_semester_entries" TO "service_role";



GRANT ALL ON SEQUENCE "public"."commission_semester_entries_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."commission_semester_entries_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."commission_semester_entries_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."commission_tracking" TO "anon";
GRANT ALL ON TABLE "public"."commission_tracking" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_tracking" TO "service_role";



GRANT ALL ON SEQUENCE "public"."commission_tracking_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."commission_tracking_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."commission_tracking_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."communication_logs" TO "anon";
GRANT ALL ON TABLE "public"."communication_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."communication_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."communication_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."communication_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."communication_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."compliance_alerts" TO "anon";
GRANT ALL ON TABLE "public"."compliance_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."compliance_alerts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."compliance_alerts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."compliance_alerts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."compliance_alerts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."courses" TO "anon";
GRANT ALL ON TABLE "public"."courses" TO "authenticated";
GRANT ALL ON TABLE "public"."courses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."courses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."courses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."courses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."custom_pages" TO "anon";
GRANT ALL ON TABLE "public"."custom_pages" TO "authenticated";
GRANT ALL ON TABLE "public"."custom_pages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."custom_pages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."custom_pages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."custom_pages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."data_change_log" TO "anon";
GRANT ALL ON TABLE "public"."data_change_log" TO "authenticated";
GRANT ALL ON TABLE "public"."data_change_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."data_change_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."data_change_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."data_change_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."data_quality_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."data_quality_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."data_quality_audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."data_quality_audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."data_quality_audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."data_quality_audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."data_quality_rules" TO "anon";
GRANT ALL ON TABLE "public"."data_quality_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."data_quality_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."data_quality_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."data_quality_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."data_quality_rules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."data_quality_scores" TO "anon";
GRANT ALL ON TABLE "public"."data_quality_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."data_quality_scores" TO "service_role";



GRANT ALL ON SEQUENCE "public"."data_quality_scores_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."data_quality_scores_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."data_quality_scores_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."document_checklist_template_items" TO "anon";
GRANT ALL ON TABLE "public"."document_checklist_template_items" TO "authenticated";
GRANT ALL ON TABLE "public"."document_checklist_template_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."document_checklist_template_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."document_checklist_template_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."document_checklist_template_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."document_checklist_templates" TO "anon";
GRANT ALL ON TABLE "public"."document_checklist_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."document_checklist_templates" TO "service_role";



GRANT ALL ON SEQUENCE "public"."document_checklist_templates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."document_checklist_templates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."document_checklist_templates_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."document_expiry_tracking" TO "anon";
GRANT ALL ON TABLE "public"."document_expiry_tracking" TO "authenticated";
GRANT ALL ON TABLE "public"."document_expiry_tracking" TO "service_role";



GRANT ALL ON SEQUENCE "public"."document_expiry_tracking_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."document_expiry_tracking_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."document_expiry_tracking_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."document_extractions" TO "anon";
GRANT ALL ON TABLE "public"."document_extractions" TO "authenticated";
GRANT ALL ON TABLE "public"."document_extractions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."document_extractions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."document_extractions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."document_extractions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."document_requirement_reminders" TO "anon";
GRANT ALL ON TABLE "public"."document_requirement_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."document_requirement_reminders" TO "service_role";



GRANT ALL ON SEQUENCE "public"."document_requirement_reminders_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."document_requirement_reminders_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."document_requirement_reminders_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."document_requirements" TO "anon";
GRANT ALL ON TABLE "public"."document_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."document_requirements" TO "service_role";



GRANT ALL ON SEQUENCE "public"."document_requirements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."document_requirements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."document_requirements_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."education_history" TO "anon";
GRANT ALL ON TABLE "public"."education_history" TO "authenticated";
GRANT ALL ON TABLE "public"."education_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."education_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."education_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."education_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."employment_history" TO "anon";
GRANT ALL ON TABLE "public"."employment_history" TO "authenticated";
GRANT ALL ON TABLE "public"."employment_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."employment_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."employment_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."employment_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."english_scores" TO "anon";
GRANT ALL ON TABLE "public"."english_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."english_scores" TO "service_role";



GRANT ALL ON SEQUENCE "public"."english_scores_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."english_scores_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."english_scores_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."enquiries" TO "anon";
GRANT ALL ON TABLE "public"."enquiries" TO "authenticated";
GRANT ALL ON TABLE "public"."enquiries" TO "service_role";



GRANT ALL ON SEQUENCE "public"."enquiries_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."enquiries_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."enquiries_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."enrolments" TO "anon";
GRANT ALL ON TABLE "public"."enrolments" TO "authenticated";
GRANT ALL ON TABLE "public"."enrolments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."enrolments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."enrolments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."enrolments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."error_logs" TO "anon";
GRANT ALL ON TABLE "public"."error_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."error_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."error_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."error_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."error_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."immiaccount_config" TO "anon";
GRANT ALL ON TABLE "public"."immiaccount_config" TO "authenticated";
GRANT ALL ON TABLE "public"."immiaccount_config" TO "service_role";



GRANT ALL ON SEQUENCE "public"."immiaccount_config_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."immiaccount_config_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."immiaccount_config_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."immiaccount_status_mappings" TO "anon";
GRANT ALL ON TABLE "public"."immiaccount_status_mappings" TO "authenticated";
GRANT ALL ON TABLE "public"."immiaccount_status_mappings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."immiaccount_status_mappings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."immiaccount_status_mappings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."immiaccount_status_mappings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."immiaccount_sync_logs" TO "anon";
GRANT ALL ON TABLE "public"."immiaccount_sync_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."immiaccount_sync_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."immiaccount_sync_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."immiaccount_sync_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."immiaccount_sync_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."institution_rate_agreements" TO "anon";
GRANT ALL ON TABLE "public"."institution_rate_agreements" TO "authenticated";
GRANT ALL ON TABLE "public"."institution_rate_agreements" TO "service_role";



GRANT ALL ON SEQUENCE "public"."institution_rate_agreements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."institution_rate_agreements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."institution_rate_agreements_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."institutions" TO "anon";
GRANT ALL ON TABLE "public"."institutions" TO "authenticated";
GRANT ALL ON TABLE "public"."institutions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."institutions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."institutions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."institutions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_items" TO "anon";
GRANT ALL ON TABLE "public"."invoice_items" TO "authenticated";
GRANT ALL ON TABLE "public"."invoice_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."invoice_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."invoice_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."invoice_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."invoices" TO "anon";
GRANT ALL ON TABLE "public"."invoices" TO "authenticated";
GRANT ALL ON TABLE "public"."invoices" TO "service_role";



GRANT ALL ON SEQUENCE "public"."invoices_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."invoices_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."invoices_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_admin_logs" TO "anon";
GRANT ALL ON TABLE "public"."kb_admin_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_admin_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_admin_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_admin_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_admin_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_alternative_authorities" TO "anon";
GRANT ALL ON TABLE "public"."kb_alternative_authorities" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_alternative_authorities" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_alternative_authorities_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_alternative_authorities_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_alternative_authorities_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_assessing_authorities" TO "anon";
GRANT ALL ON TABLE "public"."kb_assessing_authorities" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_assessing_authorities" TO "service_role";



GRANT ALL ON TABLE "public"."kb_assessment_pathways" TO "anon";
GRANT ALL ON TABLE "public"."kb_assessment_pathways" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_assessment_pathways" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_assessment_pathways_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_assessment_pathways_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_assessment_pathways_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_authority_process_steps" TO "anon";
GRANT ALL ON TABLE "public"."kb_authority_process_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_authority_process_steps" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_authority_process_steps_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_authority_process_steps_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_authority_process_steps_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_authority_rules" TO "anon";
GRANT ALL ON TABLE "public"."kb_authority_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_authority_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_authority_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_authority_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_authority_rules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_change_history" TO "anon";
GRANT ALL ON TABLE "public"."kb_change_history" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_change_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_change_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_change_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_change_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_change_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."kb_change_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_change_snapshots" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_change_snapshots_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_change_snapshots_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_change_snapshots_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_common_mistakes" TO "anon";
GRANT ALL ON TABLE "public"."kb_common_mistakes" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_common_mistakes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_common_mistakes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_common_mistakes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_common_mistakes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_cricos_courses" TO "anon";
GRANT ALL ON TABLE "public"."kb_cricos_courses" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_cricos_courses" TO "service_role";



GRANT ALL ON TABLE "public"."kb_cricos_providers" TO "anon";
GRANT ALL ON TABLE "public"."kb_cricos_providers" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_cricos_providers" TO "service_role";



GRANT ALL ON TABLE "public"."kb_document_checklist" TO "anon";
GRANT ALL ON TABLE "public"."kb_document_checklist" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_document_checklist" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_document_checklist_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_document_checklist_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_document_checklist_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_eligibility_nuances" TO "anon";
GRANT ALL ON TABLE "public"."kb_eligibility_nuances" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_eligibility_nuances" TO "service_role";



GRANT ALL ON TABLE "public"."kb_english_reqs_specific" TO "anon";
GRANT ALL ON TABLE "public"."kb_english_reqs_specific" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_english_reqs_specific" TO "service_role";



GRANT ALL ON TABLE "public"."kb_eoi_rules" TO "anon";
GRANT ALL ON TABLE "public"."kb_eoi_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_eoi_rules" TO "service_role";



GRANT ALL ON TABLE "public"."kb_exemptions" TO "anon";
GRANT ALL ON TABLE "public"."kb_exemptions" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_exemptions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_exemptions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_exemptions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_exemptions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_faq" TO "anon";
GRANT ALL ON TABLE "public"."kb_faq" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_faq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_faq_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_faq_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_faq_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_health_character_requirements" TO "anon";
GRANT ALL ON TABLE "public"."kb_health_character_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_health_character_requirements" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_health_character_requirements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_health_character_requirements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_health_character_requirements_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_invitation_rounds" TO "anon";
GRANT ALL ON TABLE "public"."kb_invitation_rounds" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_invitation_rounds" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_invitation_rounds_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_invitation_rounds_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_invitation_rounds_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_invitation_trends" TO "anon";
GRANT ALL ON TABLE "public"."kb_invitation_trends" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_invitation_trends" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_invitation_trends_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_invitation_trends_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_invitation_trends_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_occupation_tiers" TO "anon";
GRANT ALL ON TABLE "public"."kb_occupation_tiers" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_occupation_tiers" TO "service_role";



GRANT ALL ON TABLE "public"."kb_occupations" TO "anon";
GRANT ALL ON TABLE "public"."kb_occupations" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_occupations" TO "service_role";



GRANT ALL ON TABLE "public"."kb_partner_points_rules" TO "anon";
GRANT ALL ON TABLE "public"."kb_partner_points_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_partner_points_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_partner_points_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_partner_points_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_partner_points_rules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_points_rules" TO "anon";
GRANT ALL ON TABLE "public"."kb_points_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_points_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_points_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_points_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_points_rules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_state_invitation_scores" TO "anon";
GRANT ALL ON TABLE "public"."kb_state_invitation_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_state_invitation_scores" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_state_invitation_scores_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_state_invitation_scores_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_state_invitation_scores_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_state_quotas" TO "anon";
GRANT ALL ON TABLE "public"."kb_state_quotas" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_state_quotas" TO "service_role";



GRANT ALL ON TABLE "public"."kb_state_rules" TO "anon";
GRANT ALL ON TABLE "public"."kb_state_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_state_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_state_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_state_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_state_rules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_step_documents" TO "anon";
GRANT ALL ON TABLE "public"."kb_step_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_step_documents" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_step_documents_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_step_documents_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_step_documents_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_versions" TO "anon";
GRANT ALL ON TABLE "public"."kb_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_versions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_visa_comparison" TO "anon";
GRANT ALL ON TABLE "public"."kb_visa_comparison" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_visa_comparison" TO "service_role";



GRANT ALL ON TABLE "public"."kb_visa_constraints" TO "anon";
GRANT ALL ON TABLE "public"."kb_visa_constraints" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_visa_constraints" TO "service_role";



GRANT ALL ON TABLE "public"."kb_visa_fees" TO "anon";
GRANT ALL ON TABLE "public"."kb_visa_fees" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_visa_fees" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_visa_fees_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_visa_fees_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_visa_fees_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_wizard_options" TO "anon";
GRANT ALL ON TABLE "public"."kb_wizard_options" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_wizard_options" TO "service_role";



GRANT ALL ON SEQUENCE "public"."kb_wizard_options_option_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."kb_wizard_options_option_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."kb_wizard_options_option_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."kb_wizard_steps" TO "anon";
GRANT ALL ON TABLE "public"."kb_wizard_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."kb_wizard_steps" TO "service_role";



GRANT ALL ON TABLE "public"."lead_ai_scores" TO "anon";
GRANT ALL ON TABLE "public"."lead_ai_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_ai_scores" TO "service_role";



GRANT ALL ON SEQUENCE "public"."lead_ai_scores_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lead_ai_scores_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lead_ai_scores_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON SEQUENCE "public"."leads_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."leads_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."leads_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notes" TO "anon";
GRANT ALL ON TABLE "public"."notes" TO "authenticated";
GRANT ALL ON TABLE "public"."notes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."notes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."notes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notification_delivery_log" TO "anon";
GRANT ALL ON TABLE "public"."notification_delivery_log" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_delivery_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."notification_delivery_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."notification_delivery_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notification_delivery_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notification_preferences" TO "anon";
GRANT ALL ON TABLE "public"."notification_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_preferences" TO "service_role";



GRANT ALL ON SEQUENCE "public"."notification_preferences_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."notification_preferences_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notification_preferences_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."notifications_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."obs_activity_records" TO "anon";
GRANT ALL ON TABLE "public"."obs_activity_records" TO "authenticated";
GRANT ALL ON TABLE "public"."obs_activity_records" TO "service_role";



GRANT ALL ON SEQUENCE "public"."obs_activity_records_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."obs_activity_records_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."obs_activity_records_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."obs_error_records" TO "anon";
GRANT ALL ON TABLE "public"."obs_error_records" TO "authenticated";
GRANT ALL ON TABLE "public"."obs_error_records" TO "service_role";



GRANT ALL ON SEQUENCE "public"."obs_error_records_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."obs_error_records_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."obs_error_records_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ocr_jobs" TO "anon";
GRANT ALL ON TABLE "public"."ocr_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."ocr_jobs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ocr_jobs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ocr_jobs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ocr_jobs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."offices" TO "anon";
GRANT ALL ON TABLE "public"."offices" TO "authenticated";
GRANT ALL ON TABLE "public"."offices" TO "service_role";



GRANT ALL ON SEQUENCE "public"."offices_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."offices_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."offices_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."partner_invites" TO "anon";
GRANT ALL ON TABLE "public"."partner_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."partner_invites" TO "service_role";



GRANT ALL ON SEQUENCE "public"."partner_invites_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."partner_invites_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."partner_invites_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."partner_portal_users" TO "anon";
GRANT ALL ON TABLE "public"."partner_portal_users" TO "authenticated";
GRANT ALL ON TABLE "public"."partner_portal_users" TO "service_role";



GRANT ALL ON SEQUENCE "public"."partner_portal_users_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."partner_portal_users_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."partner_portal_users_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."partners" TO "anon";
GRANT ALL ON TABLE "public"."partners" TO "authenticated";
GRANT ALL ON TABLE "public"."partners" TO "service_role";



GRANT ALL ON SEQUENCE "public"."partners_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."partners_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."partners_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."payments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."payments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."payments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."profiles_legacy_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."profiles_legacy_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."profiles_legacy_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."push_subscriptions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."push_subscriptions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."push_subscriptions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."quotation_items" TO "anon";
GRANT ALL ON TABLE "public"."quotation_items" TO "authenticated";
GRANT ALL ON TABLE "public"."quotation_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."quotation_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."quotation_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."quotation_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."quotations" TO "anon";
GRANT ALL ON TABLE "public"."quotations" TO "authenticated";
GRANT ALL ON TABLE "public"."quotations" TO "service_role";



GRANT ALL ON SEQUENCE "public"."quotations_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."quotations_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."quotations_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."report_runs" TO "anon";
GRANT ALL ON TABLE "public"."report_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."report_runs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."report_runs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."report_runs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."report_runs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."risk_assessments" TO "anon";
GRANT ALL ON TABLE "public"."risk_assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."risk_assessments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."risk_assessments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."risk_assessments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."risk_assessments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."roles" TO "anon";
GRANT ALL ON TABLE "public"."roles" TO "authenticated";
GRANT ALL ON TABLE "public"."roles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."roles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."scheduled_reports" TO "anon";
GRANT ALL ON TABLE "public"."scheduled_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."scheduled_reports" TO "service_role";



GRANT ALL ON SEQUENCE "public"."scheduled_reports_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."scheduled_reports_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."scheduled_reports_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."schema_versions" TO "anon";
GRANT ALL ON TABLE "public"."schema_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."schema_versions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."schema_versions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."schema_versions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."schema_versions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."service_fee_plans" TO "anon";
GRANT ALL ON TABLE "public"."service_fee_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."service_fee_plans" TO "service_role";



GRANT ALL ON SEQUENCE "public"."service_fee_plans_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."service_fee_plans_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."service_fee_plans_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."staff_achievements" TO "anon";
GRANT ALL ON TABLE "public"."staff_achievements" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_achievements" TO "service_role";



GRANT ALL ON SEQUENCE "public"."staff_achievements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."staff_achievements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."staff_achievements_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."staff_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."staff_audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."staff_audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."staff_audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."staff_audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."staff_goals" TO "anon";
GRANT ALL ON TABLE "public"."staff_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_goals" TO "service_role";



GRANT ALL ON SEQUENCE "public"."staff_goals_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."staff_goals_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."staff_goals_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."staff_performance_metrics" TO "anon";
GRANT ALL ON TABLE "public"."staff_performance_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."staff_performance_metrics" TO "service_role";



GRANT ALL ON SEQUENCE "public"."staff_performance_metrics_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."staff_performance_metrics_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."staff_performance_metrics_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."study_tour_participants" TO "anon";
GRANT ALL ON TABLE "public"."study_tour_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."study_tour_participants" TO "service_role";



GRANT ALL ON SEQUENCE "public"."study_tour_participants_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."study_tour_participants_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."study_tour_participants_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."study_tours" TO "anon";
GRANT ALL ON TABLE "public"."study_tours" TO "authenticated";
GRANT ALL ON TABLE "public"."study_tours" TO "service_role";



GRANT ALL ON SEQUENCE "public"."study_tours_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."study_tours_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."study_tours_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_plans" TO "anon";
GRANT ALL ON TABLE "public"."subscription_plans" TO "authenticated";
GRANT ALL ON TABLE "public"."subscription_plans" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subscription_plans_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subscription_plans_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subscription_plans_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."suppliers" TO "anon";
GRANT ALL ON TABLE "public"."suppliers" TO "authenticated";
GRANT ALL ON TABLE "public"."suppliers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."suppliers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."suppliers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."suppliers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."survey_instances" TO "anon";
GRANT ALL ON TABLE "public"."survey_instances" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_instances" TO "service_role";



GRANT ALL ON SEQUENCE "public"."survey_instances_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."survey_instances_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."survey_instances_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."survey_responses" TO "anon";
GRANT ALL ON TABLE "public"."survey_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_responses" TO "service_role";



GRANT ALL ON SEQUENCE "public"."survey_responses_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."survey_responses_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."survey_responses_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."survey_templates" TO "anon";
GRANT ALL ON TABLE "public"."survey_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."survey_templates" TO "service_role";



GRANT ALL ON SEQUENCE "public"."survey_templates_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."survey_templates_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."survey_templates_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."system_settings" TO "anon";
GRANT ALL ON TABLE "public"."system_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."system_settings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."system_settings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."system_settings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."system_settings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tasks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_dashboard_defaults" TO "anon";
GRANT ALL ON TABLE "public"."tenant_dashboard_defaults" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_dashboard_defaults" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tenant_dashboard_defaults_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tenant_dashboard_defaults_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tenant_dashboard_defaults_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_onboarding_progress" TO "anon";
GRANT ALL ON TABLE "public"."tenant_onboarding_progress" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_onboarding_progress" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tenant_onboarding_progress_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tenant_onboarding_progress_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tenant_onboarding_progress_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_settings" TO "anon";
GRANT ALL ON TABLE "public"."tenant_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_settings" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tenant_settings_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tenant_settings_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tenant_settings_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."tenant_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_subscriptions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tenant_subscriptions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tenant_subscriptions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tenant_subscriptions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tenant_usage_logs" TO "anon";
GRANT ALL ON TABLE "public"."tenant_usage_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."tenant_usage_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tenant_usage_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tenant_usage_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tenant_usage_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT ALL ON TABLE "public"."tenants" TO "service_role";



GRANT ALL ON SEQUENCE "public"."tenants_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."tenants_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."tenants_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."time_logs" TO "anon";
GRANT ALL ON TABLE "public"."time_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."time_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."time_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."time_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."time_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."timer_status" TO "anon";
GRANT ALL ON TABLE "public"."timer_status" TO "authenticated";
GRANT ALL ON TABLE "public"."timer_status" TO "service_role";



GRANT ALL ON SEQUENCE "public"."timer_status_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."timer_status_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."timer_status_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."usage_stats" TO "anon";
GRANT ALL ON TABLE "public"."usage_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."usage_stats" TO "service_role";



GRANT ALL ON SEQUENCE "public"."usage_stats_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."usage_stats_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."usage_stats_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_dashboard_layouts" TO "anon";
GRANT ALL ON TABLE "public"."user_dashboard_layouts" TO "authenticated";
GRANT ALL ON TABLE "public"."user_dashboard_layouts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_dashboard_layouts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_dashboard_layouts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_dashboard_layouts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_roles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_roles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_roles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_starred_items" TO "anon";
GRANT ALL ON TABLE "public"."user_starred_items" TO "authenticated";
GRANT ALL ON TABLE "public"."user_starred_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."user_starred_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."user_starred_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."user_starred_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."web_users" TO "anon";
GRANT ALL ON TABLE "public"."web_users" TO "authenticated";
GRANT ALL ON TABLE "public"."web_users" TO "service_role";



GRANT ALL ON SEQUENCE "public"."web_users_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."web_users_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."web_users_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";





