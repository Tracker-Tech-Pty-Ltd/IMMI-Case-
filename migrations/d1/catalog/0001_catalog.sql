-- IMMI_CATALOG_DB: public case metadata, relationships, FTS5, and aggregates.
-- Full source text is held in R2; text chunks are capped at 128 KiB so every
-- D1 row remains well below the 256 KiB migration guard.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cases (
  case_id TEXT PRIMARY KEY CHECK(length(case_id) = 12 AND case_id NOT GLOB '*[^0-9a-f]*'),
  citation TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  court TEXT NOT NULL DEFAULT '',
  court_code TEXT NOT NULL DEFAULT '',
  decision_date TEXT NOT NULL DEFAULT '',
  year INTEGER,
  outcome TEXT NOT NULL DEFAULT '',
  visa_type TEXT NOT NULL DEFAULT '',
  visa_subclass TEXT NOT NULL DEFAULT '',
  visa_class_code TEXT NOT NULL DEFAULT '',
  visa_subclass_number TEXT NOT NULL DEFAULT '',
  applicant_name TEXT NOT NULL DEFAULT '',
  respondent TEXT NOT NULL DEFAULT '',
  country_of_origin TEXT NOT NULL DEFAULT '',
  hearing_date TEXT NOT NULL DEFAULT '',
  is_represented INTEGER,
  representative TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  case_nature TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  catchwords TEXT NOT NULL DEFAULT '',
  legislation TEXT NOT NULL DEFAULT '',
  text_snippet TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  user_notes TEXT NOT NULL DEFAULT '',
  visa_outcome_reason TEXT NOT NULL DEFAULT '',
  legal_test_applied TEXT NOT NULL DEFAULT '',
  last_extraction_run_id TEXT,
  extraction_confidence_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extraction_confidence_json)),
  content_key TEXT NOT NULL UNIQUE,
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
  content_size INTEGER NOT NULL CHECK(content_size >= 0),
  semantic_ready INTEGER NOT NULL DEFAULT 0 CHECK(semantic_ready IN (0, 1)),
  vector_mutation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS cases_court_year_idx ON cases(court_code, year DESC, case_id);
CREATE INDEX IF NOT EXISTS cases_filter_idx ON cases(outcome, visa_subclass, source, year DESC);
CREATE INDEX IF NOT EXISTS cases_visa_type_idx ON cases(visa_type, year DESC, case_id);
CREATE INDEX IF NOT EXISTS cases_semantic_ready_idx ON cases(semantic_ready, updated_at);

CREATE TABLE IF NOT EXISTS case_text_chunks (
  case_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK(chunk_index >= 0),
  content TEXT NOT NULL CHECK(length(CAST(content AS BLOB)) > 0 AND length(CAST(content AS BLOB)) <= 131072),
  content_sha256 TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (case_id, chunk_index),
  FOREIGN KEY (case_id) REFERENCES cases(case_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS case_text_fts USING fts5(
  case_id UNINDEXED,
  chunk_index UNINDEXED,
  content,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS case_text_chunks_ai AFTER INSERT ON case_text_chunks BEGIN
  INSERT INTO case_text_fts(rowid, case_id, chunk_index, content)
  VALUES (new.rowid, new.case_id, new.chunk_index, new.content);
END;
CREATE TRIGGER IF NOT EXISTS case_text_chunks_au AFTER UPDATE ON case_text_chunks BEGIN
  DELETE FROM case_text_fts WHERE rowid = old.rowid;
  INSERT INTO case_text_fts(rowid, case_id, chunk_index, content)
  VALUES (new.rowid, new.case_id, new.chunk_index, new.content);
END;
CREATE TRIGGER IF NOT EXISTS case_text_chunks_ad AFTER DELETE ON case_text_chunks BEGIN
  DELETE FROM case_text_fts WHERE rowid = old.rowid;
END;

CREATE TABLE IF NOT EXISTS judges (
  judge_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  -- Stable source identity makes every legacy judge_bios row reconcilable
  -- without relying on a display-name match.
  source_bio_id TEXT UNIQUE,
  bio_key TEXT,
  bio_sha256 TEXT,
  bio_size INTEGER CHECK(bio_size IS NULL OR bio_size >= 0),
  bio_content_type TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS case_judges (
  case_id TEXT NOT NULL,
  judge_id TEXT NOT NULL,
  PRIMARY KEY (case_id, judge_id),
  FOREIGN KEY (case_id) REFERENCES cases(case_id),
  FOREIGN KEY (judge_id) REFERENCES judges(judge_id)
);
CREATE INDEX IF NOT EXISTS case_judges_judge_idx ON case_judges(judge_id, case_id);

CREATE TABLE IF NOT EXISTS concepts (
  concept_id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS case_concepts (
  case_id TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  PRIMARY KEY (case_id, concept_id),
  FOREIGN KEY (case_id) REFERENCES cases(case_id),
  FOREIGN KEY (concept_id) REFERENCES concepts(concept_id)
);
CREATE TABLE IF NOT EXISTS visas (
  visa_id TEXT PRIMARY KEY,
  subclass TEXT NOT NULL UNIQUE,
  family TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS case_visas (
  case_id TEXT NOT NULL,
  visa_id TEXT NOT NULL,
  PRIMARY KEY (case_id, visa_id),
  FOREIGN KEY (case_id) REFERENCES cases(case_id),
  FOREIGN KEY (visa_id) REFERENCES visas(visa_id)
);

CREATE TABLE IF NOT EXISTS filter_options (
  filter_name TEXT NOT NULL,
  option_value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (filter_name, option_value)
);
CREATE TABLE IF NOT EXISTS aggregate_court_year_outcome (
  court_code TEXT NOT NULL,
  year INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (court_code, year, outcome)
);
CREATE TABLE IF NOT EXISTS aggregate_visa (
  visa_subclass TEXT NOT NULL,
  court_code TEXT NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (visa_subclass, court_code, outcome)
);
CREATE TABLE IF NOT EXISTS aggregate_country (
  country TEXT PRIMARY KEY,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS aggregate_judge (
  judge_id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL UNIQUE,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (judge_id) REFERENCES judges(judge_id)
);
CREATE INDEX IF NOT EXISTS aggregate_judge_name_idx ON aggregate_judge(canonical_name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS aggregate_judge_court (
  judge_id TEXT NOT NULL,
  court_code TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (judge_id, court_code),
  FOREIGN KEY (judge_id) REFERENCES judges(judge_id)
);
CREATE TABLE IF NOT EXISTS aggregate_nature_outcome (
  case_nature TEXT NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (case_nature, outcome)
);
CREATE TABLE IF NOT EXISTS aggregate_source (
  source TEXT PRIMARY KEY,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_summary (
  summary_key TEXT PRIMARY KEY,
  value_int INTEGER NOT NULL CHECK(value_int >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS aggregate_concept (
  concept_id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  FOREIGN KEY (concept_id) REFERENCES concepts(concept_id)
);

-- Dimension-complete, queue-maintained aggregates used by analytics reads.
-- Requests must never scan the full `cases` corpus; empty strings/zero are
-- the canonical representation for nullable source dimensions.
CREATE TABLE IF NOT EXISTS aggregate_scope (
  court_code TEXT NOT NULL DEFAULT '',
  year INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT '',
  visa_subclass TEXT NOT NULL DEFAULT '',
  visa_type TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  case_nature TEXT NOT NULL DEFAULT '',
  country_of_origin TEXT NOT NULL DEFAULT '',
  has_full_text INTEGER NOT NULL DEFAULT 0 CHECK(has_full_text IN (0, 1)),
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (court_code, year, outcome, visa_subclass, visa_type, source, case_nature, country_of_origin, has_full_text)
);
CREATE INDEX IF NOT EXISTS aggregate_scope_year_idx
  ON aggregate_scope(year, court_code, outcome);
CREATE INDEX IF NOT EXISTS aggregate_scope_nature_idx
  ON aggregate_scope(case_nature, court_code, year);
CREATE INDEX IF NOT EXISTS aggregate_scope_visa_idx
  ON aggregate_scope(visa_subclass, court_code, year);
CREATE INDEX IF NOT EXISTS aggregate_scope_source_idx
  ON aggregate_scope(source, court_code, year);

CREATE TABLE IF NOT EXISTS aggregate_court_nature_outcome (
  court_code TEXT NOT NULL,
  case_nature TEXT NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (court_code, case_nature, outcome)
);

CREATE TABLE IF NOT EXISTS aggregate_concept_scope (
  concept_id TEXT NOT NULL,
  court_code TEXT NOT NULL,
  year INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (concept_id, court_code, year, outcome),
  FOREIGN KEY (concept_id) REFERENCES concepts(concept_id)
);
CREATE INDEX IF NOT EXISTS aggregate_concept_scope_year_idx
  ON aggregate_concept_scope(year, concept_id, court_code);

CREATE TABLE IF NOT EXISTS aggregate_concept_pair (
  concept_id_a TEXT NOT NULL,
  concept_id_b TEXT NOT NULL,
  court_code TEXT NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (concept_id_a, concept_id_b, court_code, outcome),
  FOREIGN KEY (concept_id_a) REFERENCES concepts(concept_id),
  FOREIGN KEY (concept_id_b) REFERENCES concepts(concept_id)
);

CREATE TABLE IF NOT EXISTS aggregate_judge_outcome (
  judge_id TEXT NOT NULL,
  court_code TEXT NOT NULL,
  outcome TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (judge_id, court_code, outcome),
  FOREIGN KEY (judge_id) REFERENCES judges(judge_id)
);
CREATE TABLE IF NOT EXISTS aggregate_judge_year (
  judge_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (judge_id, year),
  FOREIGN KEY (judge_id) REFERENCES judges(judge_id)
);
CREATE TABLE IF NOT EXISTS aggregate_judge_visa (
  judge_id TEXT NOT NULL,
  visa_subclass TEXT NOT NULL,
  case_count INTEGER NOT NULL CHECK(case_count >= 0),
  PRIMARY KEY (judge_id, visa_subclass),
  FOREIGN KEY (judge_id) REFERENCES judges(judge_id)
);
