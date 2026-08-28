-- Read-path indexes for the case listing and the related-case lookup.
--
-- 0001_catalog.sql indexes `cases` by (court_code, year), (outcome,
-- visa_subclass, source, year), (visa_type, year) and (semantic_ready,
-- updated_at). None of those has `year` as a leading column, so the default
-- unfiltered listing -- ORDER BY c.year DESC, c.case_id ASC -- sorts the whole
-- corpus in a temp B-tree on every page. `case_nature` is not indexed at all,
-- which is why the related-case query cannot use SQLite's multi-index OR
-- optimisation and falls back to a full scan.
--
-- Column order matches the ORDER BY of the queries these serve so SQLite can
-- walk the index and stop at LIMIT instead of materialising a sorter.
CREATE INDEX IF NOT EXISTS cases_year_case_idx ON cases(year DESC, case_id ASC);
CREATE INDEX IF NOT EXISTS cases_nature_year_idx ON cases(case_nature, year DESC, case_id ASC);

-- aggregate_judge_outcome's primary key is (judge_id, court_code, outcome), so
-- court_code is not an index prefix and the judge-leaderboard's court filter
-- scans the whole table. plans/014-*.md pushes that filter into SQL and needs
-- this index to make it a range scan rather than a scan-with-a-WHERE. It is
-- declared here, in the single catalog read-path migration, so 014 does not have
-- to create a competing migration file touching the same tables. Do NOT drop it
-- because no query in plan 013 itself uses it.
CREATE INDEX IF NOT EXISTS aggregate_judge_outcome_court_idx
  ON aggregate_judge_outcome(court_code, judge_id);
