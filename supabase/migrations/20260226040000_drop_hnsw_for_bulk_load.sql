-- Drop and rebuild HNSW vector indexes.
-- Dropped during bulk embedding upload (149,016 rows) for 15x speed improvement.
-- Rebuilt afterwards via psql with m=16, ef_construction=64.

DROP INDEX IF EXISTS idx_cases_embedding_openai_1536_hnsw;
DROP INDEX IF EXISTS idx_cases_embedding_gemini_3072_hnsw;

CREATE INDEX IF NOT EXISTS idx_cases_embedding_openai_1536_hnsw
    ON immigration_cases
    USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding IS NOT NULL
      AND embedding_provider = 'openai'
      AND embedding_model = 'text-embedding-3-small'
      AND embedding_dimensions = 1536;

CREATE INDEX IF NOT EXISTS idx_cases_embedding_gemini_3072_hnsw
    ON immigration_cases
    USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
    WITH (m = 16, ef_construction = 64)
    WHERE embedding IS NOT NULL
      AND embedding_provider = 'gemini'
      AND embedding_model = 'models/gemini-embedding-001'
      AND embedding_dimensions = 3072;
