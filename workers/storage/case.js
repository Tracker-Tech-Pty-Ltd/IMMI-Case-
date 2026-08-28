import {
  assertCaseId,
  assertObjectPointer,
  clampLimit,
  D1_MAX_BOUND_PARAMETERS,
  FTS_CHUNK_MAX_BYTES,
  sha256Hex,
  StorageBoundaryError,
  toFtsMatch,
  utcNow,
} from "./contracts.js";
import { bindAll, changeCount, requireD1, rows } from "./cloudflare_shared.js";

/** D1 wraps one batch() call in one transaction; keep batches modest. */
const D1_BATCH_STATEMENT_LIMIT = 20;

/**
 * Statement ceiling for the one-shot chunk write. A chunk holds up to
 * FTS_CHUNK_MAX_BYTES (128 KiB, workers/storage/contracts.js), so 40
 * statements is ~5 MB of canonical text — far past any AustLII judgment. Past
 * this the import fails loudly instead of silently splitting the transaction
 * and leaving a prefix of the new text behind.
 */
const D1_CHUNK_TRANSACTION_STATEMENT_LIMIT = 40;

/** Row cap on the concept-scope read. Callers must surface `truncated`. */
const CONCEPT_SCOPE_ROW_LIMIT = 10000;

function safeCaseFilters(filters = {}) {
  const clauses = [];
  const params = [];
  const supported = ["court_code", "year", "outcome", "visa_subclass", "visa_type", "source", "case_nature"];
  for (const key of supported) {
    const value = filters[key];
    if (value === undefined || value === null || value === "") continue;
    if (key === "year") {
      const year = Number.parseInt(String(value), 10);
      if (!Number.isInteger(year) || year < 1800 || year > 3000) {
        throw new StorageBoundaryError("year filter is invalid", { code: "invalid_filter", status: 400 });
      }
      clauses.push("c.year = ?");
      params.push(year);
    } else {
      if (typeof value !== "string" || value.length > 128) {
        throw new StorageBoundaryError(`${key} filter is invalid`, { code: "invalid_filter", status: 400 });
      }
      clauses.push(`c.${key} = ?`);
      params.push(value);
    }
  }
  return { clauses, params };
}

const LEGACY_CASE_PROJECTION = `
  c.case_id, c.citation, c.title, c.court, c.court_code,
  c.decision_date AS date, c.year, c.outcome, c.visa_type, c.source,
  c.tags, c.case_nature, c.visa_subclass, c.visa_class_code,
  c.applicant_name, c.respondent, c.country_of_origin,
  c.visa_subclass_number, c.hearing_date, c.is_represented,
  c.representative, c.url, c.catchwords, c.legislation, c.text_snippet,
  c.user_notes, c.visa_outcome_reason, c.legal_test_applied,
  c.content_key AS full_text_path,
  COALESCE((
    SELECT group_concat(canonical_name, '; ')
    FROM (
      SELECT j.canonical_name
      FROM case_judges cj JOIN judges j ON j.judge_id = cj.judge_id
      WHERE cj.case_id = c.case_id
      ORDER BY j.canonical_name
    )
  ), '') AS judges,
  COALESCE((
    SELECT group_concat(label, '; ')
    FROM (
      SELECT lc.label
      FROM case_concepts cc JOIN concepts lc ON lc.concept_id = cc.concept_id
      WHERE cc.case_id = c.case_id
      ORDER BY lc.label
    )
  ), '') AS legal_concepts
`;

// Hard server-side cap on a single export, independent of the caller's limit.
const MAX_EXPORT_ROWS = 5000;

const COMPAT_SORT_COLUMNS = Object.freeze({
  date: "c.year",
  year: "c.year",
  title: "c.title",
  court: "c.court_code",
  outcome: "c.outcome",
  visa_subclass_number: "c.visa_subclass_number",
  applicant_name: "c.applicant_name",
  hearing_date: "c.hearing_date",
  case_id: "c.case_id",
  citation: "c.citation",
});

/**
 * Candidates read per related-case dimension. Three indexed range scans of 200
 * narrow rows replace one full scan of ~149K fully-projected rows; the endpoint
 * returns at most 20 links, so the recall window is generous.
 */
const RELATED_CANDIDATES_PER_DIMENSION = 200;

/** Chunk candidates read per lexical search before reducing to best-rank-per-case. */
const FTS_CANDIDATE_CHUNKS = 500;

function compatPageNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function compatCaseFilters(filters = {}) {
  const clauses = [];
  const params = [];
  const equalities = [
    ["court", "court_code"],
    ["visa_type", "visa_type"],
    ["source", "source"],
  ];
  for (const [input, column] of equalities) {
    const value = typeof filters[input] === "string" ? filters[input].trim() : "";
    if (value) {
      if (value.length > 128) throw new StorageBoundaryError(`${input} filter is invalid`, { code: "invalid_filter", status: 400 });
      clauses.push(`c.${column} = ?`);
      params.push(value);
    }
  }
  const year = compatPageNumber(filters.year, 0, 0, 3000);
  if (year) {
    clauses.push("c.year = ?");
    params.push(year);
  }
  const nature = typeof filters.nature === "string" ? filters.nature.trim() : "";
  if (nature) {
    if (nature.length > 256) throw new StorageBoundaryError("nature filter is invalid", { code: "invalid_filter", status: 400 });
    clauses.push("lower(c.case_nature) = lower(?)");
    params.push(nature);
  }
  const tag = typeof filters.tag === "string" ? filters.tag.trim() : "";
  if (tag) {
    if (tag.length > 128) throw new StorageBoundaryError("tag filter is invalid", { code: "invalid_filter", status: 400 });
    clauses.push("instr(lower(c.tags), lower(?)) > 0");
    params.push(tag);
  }
  const keyword = typeof filters.keyword === "string" ? filters.keyword.trim() : "";
  if (keyword) {
    if (keyword.length > 256) throw new StorageBoundaryError("keyword filter is invalid", { code: "invalid_filter", status: 400 });
    clauses.push("(c.title LIKE ? COLLATE NOCASE OR c.citation LIKE ? COLLATE NOCASE)");
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  return { clauses, params };
}

/**
 * Resolve the row count for a compat listing/count request.
 *
 * `allowAggregate` opts into the queue-maintained `catalog_summary.total_cases`
 * row for the unfiltered case, which avoids counting the ~149K-row `cases`
 * table. It is OFF by default and must stay off for any caller whose response
 * declares `count_mode: "exact"` (/api/v1/cases and /api/v1/cases/count both
 * do): the aggregate lags case ingests until the next rebuildAggregates().
 * Only guidedPrecedents opts in, because it has read that row since before this
 * change.
 *
 * Even when opted in, falls back to COUNT(*) whenever a filter is present, and
 * when the aggregate has never been built, so a freshly seeded database reports
 * an accurate total instead of zero.
 */
async function compatTotal(database, clauses, params, where, { allowAggregate = false } = {}) {
  if (allowAggregate && clauses.length === 0) {
    const summary = await database
      .prepare("SELECT value_int FROM catalog_summary WHERE summary_key = 'total_cases'")
      .first();
    const cached = Number(summary?.value_int);
    if (Number.isFinite(cached) && cached > 0) return cached;
  }
  const counted = await bindAll(database, `SELECT COUNT(*) AS total FROM cases c ${where}`, params).first();
  return Number(counted?.total || 0);
}

function normaliseRelationLabels(value, field) {
  const raw = Array.isArray(value) ? value : [value];
  const labels = raw
    .flatMap((item) => String(item ?? "").split(/[;,]/))
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (labels.some((label) => label.length > 256)) {
    throw new StorageBoundaryError(`${field} label exceeds 256 characters`, {
      code: "invalid_relation_label",
      status: 400,
    });
  }
  return [...new Set(labels)].slice(0, 100);
}

function normaliseJsonObject(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : (value ?? {});
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? JSON.stringify(parsed)
      : "{}";
  } catch {
    return "{}";
  }
}

export class CloudflareCaseStore {
  constructor(env) {
    this.db = requireD1(env.IMMI_CATALOG_DB, "IMMI_CATALOG_DB");
  }

  async getCase(caseId) {
    const id = assertCaseId(caseId);
    return this.db.prepare(`
      SELECT ${LEGACY_CASE_PROJECTION},
             c.content_key, c.content_sha256, c.content_size, c.semantic_ready,
             c.created_at, c.updated_at
      FROM cases c WHERE c.case_id = ?
    `).bind(id).first();
  }

  /** D1 finds a compact metadata pointer; the caller loads the bio from R2. */
  async findJudgeBio(name) {
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 256) {
      throw new StorageBoundaryError("Judge name is invalid", { code: "invalid_judge_name", status: 400 });
    }
    const tokens = name.trim().split(/\s+/).filter(Boolean).slice(0, 12);
    if (tokens.length === 0) {
      throw new StorageBoundaryError("Judge name is invalid", { code: "invalid_judge_name", status: 400 });
    }
    const clauses = tokens.map(() => "instr(lower(canonical_name), lower(?)) > 0");
    return bindAll(this.db, `
      SELECT source_bio_id, canonical_name, bio_key, bio_sha256, bio_size, bio_content_type
      FROM judges
      WHERE source_bio_id IS NOT NULL AND bio_key IS NOT NULL
        AND ${clauses.join(" AND ")}
      ORDER BY length(canonical_name) ASC, canonical_name ASC
      LIMIT 1
    `, tokens).first();
  }

  async list({ filters = {}, limit } = {}) {
    const { clauses, params } = safeCaseFilters(filters);
    const size = clampLimit(limit, { fallback: 50, max: 100 });
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const statement = bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}, c.semantic_ready
      FROM cases c ${where}
      ORDER BY c.year DESC, c.case_id ASC
      LIMIT ?
    `, [...params, size]);
    return rows(await statement.all());
  }

  async listPage({ filters = {}, sortBy = "date", sortDir = "desc", page = 1, pageSize = 100 } = {}) {
    const column = COMPAT_SORT_COLUMNS[sortBy];
    if (!column) {
      throw new StorageBoundaryError(`Invalid sort_by '${sortBy}'.`, { code: "invalid_sort", status: 400 });
    }
    const direction = String(sortDir).toLowerCase();
    if (direction !== "asc" && direction !== "desc") {
      throw new StorageBoundaryError("sort_dir must be asc or desc.", { code: "invalid_sort", status: 400 });
    }
    const checkedPage = compatPageNumber(page, 1, 1, 10000);
    const checkedPageSize = compatPageNumber(pageSize, 100, 1, 200);
    const { clauses, params } = compatCaseFilters(filters);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const statement = bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}
      FROM cases c ${where}
      ORDER BY ${column} ${direction.toUpperCase()}, c.case_id ASC
      LIMIT ? OFFSET ?
    `, [...params, checkedPageSize, (checkedPage - 1) * checkedPageSize]);
    const [pageResult, total] = await Promise.all([
      statement.all(),
      compatTotal(this.db, clauses, params, where),
    ]);
    return {
      cases: rows(pageResult),
      total,
      page: checkedPage,
      page_size: checkedPageSize,
      total_pages: Math.max(1, Math.ceil(total / checkedPageSize)),
      next_cursor: null,
    };
  }

  async exportCases({ filters = {}, limit = MAX_EXPORT_ROWS } = {}) {
    const size = compatPageNumber(limit, MAX_EXPORT_ROWS, 1, MAX_EXPORT_ROWS);
    const { clauses, params } = compatCaseFilters(filters);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return rows(await bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}
      FROM cases c ${where}
      ORDER BY c.year DESC, c.case_id ASC
      LIMIT ?
    `, [...params, size]).all());
  }

  async countCompat(filters = {}) {
    const { clauses, params } = compatCaseFilters(filters);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return compatTotal(this.db, clauses, params, where);
  }

  /** Read queue-maintained/transform-maintained catalog aggregates only. */
  async getFilterOptions() {
    return rows(await this.db.prepare(`
      SELECT filter_name, option_value, sort_order
      FROM filter_options
      ORDER BY filter_name ASC, sort_order ASC, option_value ASC
    `).all());
  }

  async getCourtYearTrends({ court = "", yearFrom = 0, yearTo = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (court) {
      if (typeof court !== "string" || court.length > 128) {
        throw new StorageBoundaryError("court filter is invalid", { code: "invalid_filter", status: 400 });
      }
      clauses.push("court_code = ?");
      params.push(court);
    }
    for (const [name, value, operator] of [["year_from", yearFrom, ">="], ["year_to", yearTo, "<="]]) {
      if (!value) continue;
      if (!Number.isInteger(value) || value < 1800 || value > 3000) {
        throw new StorageBoundaryError(`${name} filter is invalid`, { code: "invalid_filter", status: 400 });
      }
      clauses.push(`year ${operator} ?`);
      params.push(value);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return rows(await bindAll(this.db, `
      SELECT year, court_code, SUM(case_count) AS cnt
      FROM aggregate_court_year_outcome
      ${where}
      GROUP BY year, court_code
      ORDER BY year ASC, court_code ASC
    `, params).all());
  }

  async countVisaSubclasses(subclasses = []) {
    const values = [...new Set(subclasses.map((value) => String(value)).filter(Boolean))];
    if (values.length === 0) return new Map();
    if (values.length > D1_MAX_BOUND_PARAMETERS - 1) {
      throw new StorageBoundaryError("visa lookup contains too many candidates", { code: "invalid_filter", status: 400 });
    }
    const placeholders = values.map(() => "?").join(",");
    const result = rows(await bindAll(this.db, `
      SELECT visa_subclass, SUM(case_count) AS case_count
      FROM aggregate_visa
      WHERE visa_subclass IN (${placeholders})
      GROUP BY visa_subclass
    `, values).all());
    return new Map(result.map((row) => [String(row.visa_subclass), Number(row.case_count || 0)]));
  }

  async listCountries(limit = 30) {
    const size = clampLimit(limit, { fallback: 30, max: 200 });
    return rows(await this.db.prepare(`
      SELECT country, case_count FROM aggregate_country
      ORDER BY case_count DESC, country ASC LIMIT ?
    `).bind(size).all());
  }

  async autocompleteJudges(query, limit = 20) {
    if (typeof query !== "string") throw new StorageBoundaryError("judge query is invalid", { code: "invalid_filter", status: 400 });
    const value = query.trim();
    const size = clampLimit(limit, { fallback: 20, max: 100 });
    if (value.length < 2) return [];
    return rows(await this.db.prepare(`
      SELECT canonical_name AS name, case_count
      FROM aggregate_judge
      WHERE instr(lower(canonical_name), lower(?)) > 0
      ORDER BY case_count DESC, canonical_name ASC
      LIMIT 200
    `).bind(value).all()).slice(0, size);
  }

  /**
   * One scan of aggregate_court_year_outcome. `court_code` is required by the
   * caller so isWin() can pick the tribunal or court win set; `year AS year_key`
   * keeps the by-year grouping key stable for /api/v1/analytics/outcomes.
   */
  async analyticsCourtYearOutcomes() {
    return rows(await this.db.prepare(
      "SELECT court_code, year AS year_key, outcome, case_count AS cnt FROM aggregate_court_year_outcome",
    ).all());
  }

  async analyticsVisaOutcomes() {
    return rows(await this.db.prepare(
      "SELECT visa_subclass, court_code, outcome, case_count AS cnt FROM aggregate_visa",
    ).all());
  }

  async analyticsNatureOutcome() {
    return rows(await this.db.prepare("SELECT case_nature, outcome, case_count AS cnt FROM aggregate_nature_outcome").all());
  }

  async analyticsRateRows({ court = "", yearFrom = 0, yearTo = 0, visaSubclass = "", caseNature = "" } = {}) {
    const clauses = [];
    const params = [];
    if (court) { clauses.push("court_code = ?"); params.push(String(court)); }
    if (visaSubclass) { clauses.push("visa_subclass = ?"); params.push(String(visaSubclass)); }
    if (caseNature) { clauses.push("lower(case_nature) = lower(?)"); params.push(String(caseNature)); }
    if (yearFrom) { clauses.push("year >= ?"); params.push(Number(yearFrom)); }
    if (yearTo) { clauses.push("year <= ?"); params.push(Number(yearTo)); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return rows(await bindAll(this.db, `
      SELECT court_code, year, outcome, has_full_text, SUM(case_count) AS cnt
      FROM aggregate_scope ${where}
      GROUP BY court_code, year, outcome, has_full_text
      ORDER BY year ASC, court_code ASC, outcome ASC
    `, params).all());
  }

  async analyticsFilterOptions({ court = "", yearFrom = 0, yearTo = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (court) { clauses.push("court_code = ?"); params.push(String(court)); }
    if (yearFrom) { clauses.push("year >= ?"); params.push(Number(yearFrom)); }
    if (yearTo) { clauses.push("year <= ?"); params.push(Number(yearTo)); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const query = (column, limit = null) => bindAll(this.db, `
      SELECT ${column} AS value, SUM(case_count) AS cnt
      FROM aggregate_scope ${where ? `${where} AND` : "WHERE"} ${column} <> ''
      GROUP BY ${column}
      ORDER BY cnt DESC, value ASC${limit ? ` LIMIT ${limit}` : ""}
    `, params).all();
    const [natures, subclasses, outcomes, totals] = await Promise.all([
      query("case_nature", 60), query("visa_subclass", 80), query("outcome"),
      this.db.prepare(`SELECT SUM(case_count) AS total FROM aggregate_scope ${where}`).bind(...params).first(),
    ]);
    return { natures: rows(natures), subclasses: rows(subclasses), outcomes: rows(outcomes), total: Number(totals?.total || 0) };
  }

  async analyticsFlowRows() {
    return rows(await this.db.prepare(`
      SELECT court_code, case_nature, outcome, case_count AS cnt
      FROM aggregate_court_nature_outcome
    `).all());
  }

  async analyticsConceptScope({ court = "", yearFrom = 0, yearTo = 0 } = {}) {
    const clauses = [];
    const params = [];
    if (court) { clauses.push("s.court_code = ?"); params.push(String(court)); }
    if (yearFrom) { clauses.push("s.year >= ?"); params.push(Number(yearFrom)); }
    if (yearTo) { clauses.push("s.year <= ?"); params.push(Number(yearTo)); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    // Read one row past the cap so truncation can be DETECTED rather than
    // guessed: `length >= LIMIT` cannot tell "exactly 10,000 rows exist" from
    // "more than 10,000 exist and we truncated", and would report the honest
    // full-corpus case as truncated forever. Fetching LIMIT+1 makes
    // `length > LIMIT` an exact test; the extra row is then discarded.
    const results = rows(await bindAll(this.db, `
      SELECT s.concept_id, c.label AS concept, s.court_code, s.year, s.outcome, s.case_count AS cnt
      FROM aggregate_concept_scope s JOIN concepts c ON c.concept_id = s.concept_id
      ${where}
      ORDER BY s.case_count DESC LIMIT ${CONCEPT_SCOPE_ROW_LIMIT + 1}
    `, params).all());
    const truncated = results.length > CONCEPT_SCOPE_ROW_LIMIT;
    return { rows: truncated ? results.slice(0, CONCEPT_SCOPE_ROW_LIMIT) : results, truncated };
  }

  async analyticsConceptPairs({ limit = 20000 } = {}) {
    const size = clampLimit(limit, { fallback: 20000, max: 20000 });
    return rows(await this.db.prepare(`
      SELECT p.concept_id_a, a.label AS concept_a, p.concept_id_b, b.label AS concept_b,
             p.court_code, p.outcome, p.case_count AS cnt
      FROM aggregate_concept_pair p
      JOIN concepts a ON a.concept_id = p.concept_id_a
      JOIN concepts b ON b.concept_id = p.concept_id_b
      ORDER BY p.case_count DESC LIMIT ?
    `).bind(size).all());
  }

  /**
   * Judge-leaderboard aggregate read.
   *
   * `court` and `minCases` are pushed into SQL so D1 returns only rows the
   * caller can use. The caller keeps its own equivalent JS filters as a
   * backstop, so the response is byte-identical to the unfiltered path.
   * `aggregate_judge_year` / `aggregate_judge_visa` are not read at all when a
   * court filter is set, because the caller discards them in that case.
   *
   * `limit` and the name query are deliberately NOT pushed down: the caller
   * reports `total_judges` as the pre-limit count, and JS `toLowerCase()` is
   * Unicode-aware where SQLite `lower()` is ASCII-only.
   */
  async analyticsJudgeAggregate({ court = "", minCases = 1 } = {}) {
    const courtCode = typeof court === "string" ? court.trim() : "";
    const parsedFloor = Number.parseInt(String(minCases ?? ""), 10);
    const floor = Number.isFinite(parsedFloor) ? Math.max(1, parsedFloor) : 1;
    // A floor of 1 excludes nothing (case_count >= 0 and every judge in this
    // table has at least one outcome row), so anything built to enforce it is
    // pure cost on the most common request. Same for an empty court code.
    const filtersRows = floor > 1;

    const courtClause = courtCode ? "WHERE o.court_code = ?" : "";
    const base = `
      SELECT o.judge_id, j.canonical_name AS name, o.court_code, o.outcome, o.case_count AS cnt
      FROM aggregate_judge_outcome o JOIN judges j ON j.judge_id = o.judge_id
      ${courtClause}
    `;
    const outcomes = filtersRows
      // Only when a real floor is set do we pay for the window sum. It is
      // evaluated AFTER the WHERE, so the partition total is the post-court
      // sum — exactly what the handler accumulates into judge.total.
      ? rows(await bindAll(this.db, `
          SELECT judge_id, name, court_code, outcome, cnt FROM (
            SELECT o.judge_id, j.canonical_name AS name, o.court_code, o.outcome, o.case_count AS cnt,
                   SUM(o.case_count) OVER (PARTITION BY o.judge_id) AS judge_total
            FROM aggregate_judge_outcome o JOIN judges j ON j.judge_id = o.judge_id
            ${courtClause}
          ) WHERE judge_total >= ?
        `, courtCode ? [courtCode, floor] : [floor]).all())
      : rows(await bindAll(this.db, base, courtCode ? [courtCode] : []).all());

    if (courtCode) return { outcomes, years: [], visas: [] };

    // Same rule for the year/visa reads: the HAVING subquery is a second full
    // aggregation of aggregate_judge_outcome, so only issue it when the floor
    // can actually exclude a judge.
    const floorFilter = filtersRows
      ? `WHERE judge_id IN (
           SELECT judge_id FROM aggregate_judge_outcome GROUP BY judge_id HAVING SUM(case_count) >= ?
         )`
      : "";
    const floorParams = filtersRows ? [floor] : [];
    const [years, visas] = await Promise.all([
      bindAll(this.db, `
        SELECT judge_id, year, case_count AS cnt FROM aggregate_judge_year
        ${floorFilter}
      `, floorParams).all(),
      bindAll(this.db, `
        SELECT judge_id, visa_subclass, case_count AS cnt FROM aggregate_judge_visa
        ${floorFilter}
      `, floorParams).all(),
    ]);
    return { outcomes, years: rows(years), visas: rows(visas) };
  }

  async getJudgeCases(name, { limit = 5000 } = {}) {
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 256) {
      throw new StorageBoundaryError("judge name is invalid", { code: "invalid_judge_name", status: 400 });
    }
    const tokens = name.trim().split(/\s+/).filter(Boolean).slice(0, 12);
    const clauses = tokens.map(() => "instr(lower(j.canonical_name), lower(?)) > 0");
    const size = clampLimit(limit, { fallback: 5000, max: 5000 });
    return rows(await bindAll(this.db, `
      SELECT c.case_id, c.citation, c.title, c.court_code, c.decision_date AS date,
             c.year, c.outcome, c.visa_subclass, c.case_nature, c.country_of_origin,
             c.is_represented,
             COALESCE((SELECT group_concat(con.label, '; ')
                       FROM case_concepts cc JOIN concepts con ON con.concept_id = cc.concept_id
                       WHERE cc.case_id = c.case_id), '') AS legal_concepts
      FROM judges j JOIN case_judges cj ON cj.judge_id = j.judge_id
      JOIN cases c ON c.case_id = cj.case_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY c.year DESC, c.case_id DESC
      LIMIT ?
    `, [...tokens, size]).all());
  }

  async getJudgeCourtBaselines(courtCodes = []) {
    const values = [...new Set(courtCodes.map(String).filter(Boolean))];
    if (!values.length) return [];
    if (values.length > D1_MAX_BOUND_PARAMETERS - 1) {
      throw new StorageBoundaryError("too many judge courts", { code: "invalid_filter", status: 400 });
    }
    const placeholders = values.map(() => "?").join(",");
    return rows(await bindAll(this.db, `
      SELECT court_code, outcome, SUM(case_count) AS cnt
      FROM aggregate_court_year_outcome
      WHERE court_code IN (${placeholders})
      GROUP BY court_code, outcome
    `, values).all());
  }

  async getStats({ court = "", yearFrom = 0, yearTo = 0 } = {}) {
    if (court || yearFrom || yearTo) {
      const scope = await this.analyticsRateRows({ court, yearFrom, yearTo });
      const recent = await bindAll(this.db, `
        SELECT case_id, title, citation, court_code,
               decision_date AS date, outcome
        FROM cases
        WHERE (? = '' OR court_code = ?)
          AND (? = 0 OR year >= ?)
          AND (? = 0 OR year <= ?)
        ORDER BY year DESC, case_id DESC
        LIMIT 5
      `, [court, court, yearFrom, yearFrom, yearTo, yearTo]).all();
      return { scope_rows: scope, recent_cases: rows(recent) };
    }
    const [summary, courts, years, natures, visas, sources, recent] = await Promise.all([
      this.db.prepare("SELECT summary_key, value_int FROM catalog_summary").all(),
      this.db.prepare("SELECT court_code, SUM(case_count) AS cnt FROM aggregate_court_year_outcome GROUP BY court_code ORDER BY cnt DESC").all(),
      this.db.prepare("SELECT year, SUM(case_count) AS cnt FROM aggregate_court_year_outcome GROUP BY year ORDER BY year ASC").all(),
      this.db.prepare("SELECT case_nature, SUM(case_count) AS cnt FROM aggregate_nature_outcome GROUP BY case_nature ORDER BY cnt DESC LIMIT 60").all(),
      this.db.prepare("SELECT visa_subclass, SUM(case_count) AS cnt FROM aggregate_visa GROUP BY visa_subclass ORDER BY cnt DESC LIMIT 80").all(),
      this.db.prepare("SELECT source, case_count AS cnt FROM aggregate_source ORDER BY cnt DESC").all(),
      this.db.prepare(`
        SELECT case_id, title, citation, court_code,
               decision_date AS date, outcome
        FROM cases
        ORDER BY year DESC, case_id DESC
        LIMIT 5
      `).all(),
    ]);
    const summaryValues = Object.fromEntries(rows(summary).map((row) => [row.summary_key, Number(row.value_int || 0)]));
    const toObject = (items, key) => Object.fromEntries(rows(items).map((row) => [String(row[key]), Number(row.cnt || 0)]));
    return {
      total_cases: summaryValues.total_cases || 0,
      with_full_text: summaryValues.with_full_text || 0,
      courts: toObject(courts, "court_code"), years: toObject(years, "year"),
      natures: toObject(natures, "case_nature"), visa_subclasses: toObject(visas, "visa_subclass"),
      visa_families: {}, sources: toObject(sources, "source"), recent_cases: rows(recent),
    };
  }

  async analyticsConcepts(limit = 20) {
    const size = clampLimit(limit, { fallback: 20, max: 100 });
    return rows(await this.db.prepare(`
      SELECT label AS concept, case_count AS cnt FROM aggregate_concept
      ORDER BY case_count DESC, label ASC LIMIT ?
    `).bind(size).all());
  }

  async analyticsJudges(limit = 20) {
    const size = clampLimit(limit, { fallback: 20, max: 100 });
    return rows(await this.db.prepare(`
      SELECT j.canonical_name AS name, j.case_count AS count,
             COALESCE((SELECT json_group_array(court_code) FROM aggregate_judge_court jc WHERE jc.judge_id = j.judge_id), '[]') AS courts_json
      FROM aggregate_judge j
      ORDER BY j.case_count DESC, j.canonical_name ASC LIMIT ?
    `).bind(size).all());
  }

  async findByIds(caseIds) {
    const ids = [...new Set((caseIds || []).map(assertCaseId))];
    if (ids.length === 0) return [];
    const statement = bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}
      FROM cases c JOIN json_each(?) wanted ON wanted.value = c.case_id
    `, [JSON.stringify(ids)]);
    const found = rows(await statement.all());
    const rank = new Map(ids.map((id, index) => [id, index]));
    return found.sort((left, right) => rank.get(left.case_id) - rank.get(right.case_id));
  }

  async guidedPrecedents({ visaSubclass = "", country = "", legalConcepts = [], limit = 50 } = {}) {
    const clauses = [];
    const params = [];
    const visa = String(visaSubclass || "").trim();
    const origin = String(country || "").trim();
    if (visa) {
      if (visa.length > 128) throw new StorageBoundaryError("visa_subclass filter is invalid", { code: "invalid_filter", status: 400 });
      clauses.push("instr(lower(c.visa_subclass), lower(?)) > 0");
      params.push(visa);
    }
    if (origin) {
      if (origin.length > 256) throw new StorageBoundaryError("country filter is invalid", { code: "invalid_filter", status: 400 });
      clauses.push("instr(lower(c.country_of_origin), lower(?)) > 0");
      params.push(origin);
    }
    const concepts = [...new Set((Array.isArray(legalConcepts) ? legalConcepts : [legalConcepts])
      .map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 20);
    if (concepts.length) {
      clauses.push(`(${concepts.map(() => `EXISTS (
        SELECT 1 FROM case_concepts cc JOIN concepts gc ON gc.concept_id = cc.concept_id
        WHERE cc.case_id = c.case_id AND lower(gc.label) = lower(?)
      )`).join(" OR ")})`);
      params.push(...concepts);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const size = clampLimit(limit, { fallback: 50, max: 200 });
    const [total, found] = await Promise.all([
      // The only opt-in to the queue-maintained aggregate: this method has read
      // catalog_summary since before this plan, and /api/v1/guided-search makes
      // no `count_mode: "exact"` claim. Do NOT copy this flag to listPage or
      // countCompat — see Step 3.
      compatTotal(this.db, clauses, params, where, { allowAggregate: true }),
      bindAll(this.db, `
        SELECT ${LEGACY_CASE_PROJECTION}
        FROM cases c ${where}
        ORDER BY c.year DESC, c.case_id ASC
        LIMIT ?
      `, [...params, size]).all(),
    ]);
    return { total, results: rows(found) };
  }

  async guidedJudge(name) {
    if (typeof name !== "string" || name.trim().length < 2 || name.length > 256) return null;
    return this.db.prepare(`
      SELECT canonical_name AS name, case_count
      FROM aggregate_judge
      WHERE instr(lower(canonical_name), lower(?)) > 0
      ORDER BY case_count DESC, canonical_name ASC
      LIMIT 1
    `).bind(name.trim()).first();
  }

  async updateCaseFields(caseId, updates = {}) {
    const id = assertCaseId(caseId);
    const columnMap = Object.freeze({
      citation: "citation", title: "title", court: "court", court_code: "court_code",
      date: "decision_date", decision_date: "decision_date", year: "year", outcome: "outcome",
      visa_type: "visa_type", visa_subclass: "visa_subclass", visa_class_code: "visa_class_code",
      visa_subclass_number: "visa_subclass_number", applicant_name: "applicant_name",
      respondent: "respondent", country_of_origin: "country_of_origin", hearing_date: "hearing_date",
      is_represented: "is_represented", representative: "representative", source: "source",
      case_nature: "case_nature", url: "url", catchwords: "catchwords", legislation: "legislation",
      text_snippet: "text_snippet", tags: "tags", user_notes: "user_notes",
      visa_outcome_reason: "visa_outcome_reason", legal_test_applied: "legal_test_applied",
    });
    const assignments = [];
    const params = [];
    for (const [key, value] of Object.entries(updates || {})) {
      const column = columnMap[key];
      if (!column || value === undefined) continue;
      assignments.push(`${column} = ?`);
      params.push(column === "year" ? (value === null || value === "" ? null : Number(value))
        : column === "is_represented" ? (value === null ? null : Number(Boolean(value))) : String(value));
    }
    const now = utcNow();
    assignments.push("semantic_ready = 0", "vector_mutation_id = NULL", "updated_at = ?");
    params.push(now, id);
    const caseUpdate = this.db.prepare(`
      UPDATE cases SET ${assignments.join(", ")} WHERE case_id = ?
    `).bind(...params);

    // Relations are expanded inside SQLite from one JSON parameter each, so the
    // whole edit is always 1–7 statements and always fits in one D1
    // transaction — no matter how many labels the caller sent. The previous
    // per-label statement loop reached 403 statements at the 100-label cap in
    // normaliseRelationLabels().
    const relationStatements = [];
    if (Object.prototype.hasOwnProperty.call(updates, "judges")) {
      // judge_id is a hash of the RAW label, so every spelling variant and
      // every prose fragment becomes a separate judge. See docs/adr/0051-judge-identity.md.
      const labels = normaliseRelationLabels(updates.judges, "judge");
      const entries = await Promise.all(labels.map(async (label) => ({
        id: (await sha256Hex(`judge:${label.toLocaleLowerCase("en-AU")}`)).hex.slice(0, 32),
        label,
      })));
      relationStatements.push(this.db.prepare("DELETE FROM case_judges WHERE case_id = ?").bind(id));
      if (entries.length > 0) {
        const payload = JSON.stringify(entries);
        relationStatements.push(
          this.db.prepare(`
            INSERT OR IGNORE INTO judges (judge_id, canonical_name, created_at, updated_at)
            SELECT json_extract(value, '$.id'), json_extract(value, '$.label'), ?, ?
            FROM json_each(?)
          `).bind(now, now, payload),
          this.db.prepare(`
            INSERT OR IGNORE INTO case_judges (case_id, judge_id)
            SELECT ?, json_extract(value, '$.id') FROM json_each(?)
          `).bind(id, payload),
        );
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, "legal_concepts")) {
      const labels = normaliseRelationLabels(updates.legal_concepts, "legal concept");
      const entries = await Promise.all(labels.map(async (label) => ({
        id: (await sha256Hex(`concept:${label.toLocaleLowerCase("en-AU")}`)).hex.slice(0, 32),
        label,
      })));
      relationStatements.push(this.db.prepare("DELETE FROM case_concepts WHERE case_id = ?").bind(id));
      if (entries.length > 0) {
        const payload = JSON.stringify(entries);
        relationStatements.push(
          this.db.prepare(`
            INSERT OR IGNORE INTO concepts (concept_id, label)
            SELECT json_extract(value, '$.id'), json_extract(value, '$.label') FROM json_each(?)
          `).bind(payload),
          this.db.prepare(`
            INSERT OR IGNORE INTO case_concepts (case_id, concept_id)
            SELECT ?, json_extract(value, '$.id') FROM json_each(?)
          `).bind(id, payload),
        );
      }
    }

    const statements = [caseUpdate, ...relationStatements];
    // At most 7 statements — assert it rather than branching on it, so a future
    // edit that reintroduces a per-label loop fails loudly here instead of
    // silently splitting the write across two transactions again.
    if (statements.length > D1_BATCH_STATEMENT_LIMIT) {
      throw new StorageBoundaryError("Case update exceeds one D1 transaction", {
        code: "case_update_too_large",
        status: 500,
      });
    }
    const result = (await this.db.batch(statements))[0];
    if (changeCount(result) === 0) {
      throw new StorageBoundaryError("Case not found", { code: "case_not_found", status: 404 });
    }
    return this.getCase(id);
  }

  async deleteCase(caseId) {
    const id = assertCaseId(caseId);
    const result = await this.db.batch([
      this.db.prepare("DELETE FROM case_concepts WHERE case_id = ?").bind(id),
      this.db.prepare("DELETE FROM case_judges WHERE case_id = ?").bind(id),
      this.db.prepare("DELETE FROM case_text_chunks WHERE case_id = ?").bind(id),
      this.db.prepare("DELETE FROM cases WHERE case_id = ?").bind(id),
    ]);
    if (changeCount(result[3]) === 0) {
      throw new StorageBoundaryError("Case not found", { code: "case_not_found", status: 404 });
    }
    return true;
  }

  async batchDeleteCases(caseIds) {
    const ids = [...new Set((caseIds || []).map(assertCaseId))];
    if (!ids.length) return 0;
    if (ids.length > 200) throw new StorageBoundaryError("Batch limited to 200 cases", { code: "batch_limit", status: 400 });
    const encoded = JSON.stringify(ids);
    const result = await this.db.batch([
      this.db.prepare("DELETE FROM case_concepts WHERE case_id IN (SELECT value FROM json_each(?))").bind(encoded),
      this.db.prepare("DELETE FROM case_judges WHERE case_id IN (SELECT value FROM json_each(?))").bind(encoded),
      this.db.prepare("DELETE FROM case_text_chunks WHERE case_id IN (SELECT value FROM json_each(?))").bind(encoded),
      this.db.prepare("DELETE FROM cases WHERE case_id IN (SELECT value FROM json_each(?))").bind(encoded),
    ]);
    return changeCount(result[3]);
  }

  async batchAddTag(caseIds, tag) {
    const ids = [...new Set((caseIds || []).map(assertCaseId))];
    if (!ids.length) return 0;
    if (ids.length > 200) throw new StorageBoundaryError("Batch limited to 200 cases", { code: "batch_limit", status: 400 });
    if (typeof tag !== "string" || !tag.trim() || tag.length > 64 || /[,<>]/.test(tag)) {
      throw new StorageBoundaryError("Tag is invalid", { code: "invalid_tag", status: 400 });
    }
    const current = rows(await this.db.prepare(`
      SELECT c.case_id, c.tags
      FROM cases c JOIN json_each(?) wanted ON wanted.value = c.case_id
    `).bind(JSON.stringify(ids)).all());
    const updates = current.map((row) => {
      const values = new Set(String(row.tags || "").split(",").map((value) => value.trim()).filter(Boolean));
      values.add(tag.trim());
      return this.db.prepare("UPDATE cases SET tags = ?, semantic_ready = 0, vector_mutation_id = NULL, updated_at = ? WHERE case_id = ?")
        .bind([...values].sort().join(", "), utcNow(), row.case_id);
    });
    if (updates.length) await this.db.batch(updates);
    return updates.length;
  }

  /**
   * Rebuild queue-maintained analytics outside the request path. A mutation
   * queue batch calls this once after its D1/R2/Vectorize work, so dashboard
   * reads remain aggregate-only and never scan the corpus.
   */
  async rebuildAggregates() {
    const now = utcNow();
    const filterOptions = [["court", "court_code"], ["year", "year"], ["outcome", "outcome"], ["visa_type", "visa_type"], ["visa_subclass", "visa_subclass"], ["source", "source"], ["case_nature", "case_nature"]]
      .map(([filterName, column]) => this.db.prepare(`INSERT INTO filter_options (filter_name, option_value, sort_order)
        SELECT ?, CAST(${column} AS TEXT), ROW_NUMBER() OVER (ORDER BY ${column}) - 1
        FROM (SELECT DISTINCT ${column} FROM cases WHERE ${column} IS NOT NULL AND ${column} <> '')`).bind(filterName));
    // One entry per table: its DELETE and the INSERT(s) that repopulate it ride
    // the same D1 transaction, so a mid-rebuild failure leaves that table's
    // previous rows in place instead of publishing an empty analytics table.
    const groups = [
      ["aggregate_court_year_outcome", [
        this.db.prepare(`INSERT INTO aggregate_court_year_outcome (court_code,year,outcome,case_count,updated_at)
          SELECT court_code, year, outcome, COUNT(*), ? FROM cases GROUP BY court_code, year, outcome`).bind(now),
      ]],
      ["aggregate_source", [
        this.db.prepare(`INSERT INTO aggregate_source (source,case_count,updated_at)
          SELECT source, COUNT(*), ? FROM cases WHERE source <> '' GROUP BY source`).bind(now),
      ]],
      ["catalog_summary", [
        this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
          SELECT 'total_cases', COUNT(*), ? FROM cases`).bind(now),
        this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
          SELECT 'with_full_text', COUNT(*), ? FROM cases WHERE content_key <> ''`).bind(now),
      ]],
      ["aggregate_judge_court", [
        this.db.prepare(`INSERT INTO aggregate_judge_court (judge_id,court_code,case_count)
          SELECT cj.judge_id, c.court_code, COUNT(DISTINCT cj.case_id)
          FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
          WHERE c.court_code <> '' GROUP BY cj.judge_id, c.court_code`),
      ]],
      ["aggregate_nature_outcome", [
        this.db.prepare(`INSERT INTO aggregate_nature_outcome (case_nature,outcome,case_count)
          SELECT case_nature, outcome, COUNT(*) FROM cases WHERE case_nature <> '' GROUP BY case_nature, outcome`),
      ]],
      ["aggregate_concept", [
        this.db.prepare(`INSERT INTO aggregate_concept (concept_id,label,case_count)
          SELECT cc.concept_id, c.label, COUNT(DISTINCT cc.case_id)
          FROM case_concepts cc JOIN concepts c ON c.concept_id = cc.concept_id GROUP BY cc.concept_id, c.label`),
      ]],
      ["aggregate_country", [
        this.db.prepare(`INSERT INTO aggregate_country (country,case_count,updated_at)
          SELECT country_of_origin, COUNT(*), ? FROM cases WHERE country_of_origin <> '' GROUP BY country_of_origin`).bind(now),
      ]],
      ["aggregate_judge", [
        this.db.prepare(`INSERT INTO aggregate_judge (judge_id,canonical_name,case_count,updated_at)
          SELECT j.judge_id, j.canonical_name, COUNT(DISTINCT cj.case_id), ?
          FROM judges j JOIN case_judges cj ON cj.judge_id = j.judge_id GROUP BY j.judge_id, j.canonical_name`).bind(now),
      ]],
      ["aggregate_visa", [
        this.db.prepare(`INSERT INTO aggregate_visa (visa_subclass,court_code,outcome,case_count,updated_at)
          SELECT visa_subclass, court_code, outcome, COUNT(*), ? FROM cases
          WHERE visa_subclass <> '' GROUP BY visa_subclass, court_code, outcome`).bind(now),
      ]],
      ["aggregate_scope", [
        this.db.prepare(`INSERT INTO aggregate_scope
          (court_code,year,outcome,visa_subclass,visa_type,source,case_nature,country_of_origin,has_full_text,case_count)
          SELECT COALESCE(court_code,''), COALESCE(year,0), COALESCE(outcome,''), COALESCE(visa_subclass,''),
                 COALESCE(visa_type,''), COALESCE(source,''), COALESCE(case_nature,''), COALESCE(country_of_origin,''),
                 CASE WHEN content_key <> '' THEN 1 ELSE 0 END, COUNT(*)
          FROM cases GROUP BY COALESCE(court_code,''), COALESCE(year,0), COALESCE(outcome,''), COALESCE(visa_subclass,''),
            COALESCE(visa_type,''), COALESCE(source,''), COALESCE(case_nature,''), COALESCE(country_of_origin,''),
            CASE WHEN content_key <> '' THEN 1 ELSE 0 END`),
      ]],
      ["aggregate_court_nature_outcome", [
        this.db.prepare(`INSERT INTO aggregate_court_nature_outcome (court_code,case_nature,outcome,case_count)
          SELECT court_code, case_nature, outcome, COUNT(*) FROM cases WHERE case_nature <> ''
          GROUP BY court_code, case_nature, outcome`),
      ]],
      ["aggregate_concept_scope", [
        this.db.prepare(`INSERT INTO aggregate_concept_scope (concept_id,court_code,year,outcome,case_count)
          SELECT cc.concept_id, c.court_code, COALESCE(c.year,0), c.outcome, COUNT(DISTINCT cc.case_id)
          FROM case_concepts cc JOIN cases c ON c.case_id = cc.case_id
          GROUP BY cc.concept_id, c.court_code, COALESCE(c.year,0), c.outcome`),
      ]],
      ["aggregate_concept_pair", [
        this.db.prepare(`INSERT INTO aggregate_concept_pair
          (concept_id_a,concept_id_b,court_code,outcome,case_count)
          SELECT a.concept_id, b.concept_id, c.court_code, c.outcome, COUNT(DISTINCT a.case_id)
          FROM case_concepts a JOIN case_concepts b ON b.case_id = a.case_id AND a.concept_id < b.concept_id
          JOIN cases c ON c.case_id = a.case_id
          GROUP BY a.concept_id, b.concept_id, c.court_code, c.outcome`),
      ]],
      ["aggregate_judge_outcome", [
        this.db.prepare(`INSERT INTO aggregate_judge_outcome (judge_id,court_code,outcome,case_count)
          SELECT cj.judge_id, c.court_code, c.outcome, COUNT(DISTINCT cj.case_id)
          FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
          GROUP BY cj.judge_id, c.court_code, c.outcome`),
      ]],
      ["aggregate_judge_year", [
        this.db.prepare(`INSERT INTO aggregate_judge_year (judge_id,year,case_count)
          SELECT cj.judge_id, c.year, COUNT(DISTINCT cj.case_id)
          FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id WHERE c.year IS NOT NULL
          GROUP BY cj.judge_id, c.year`),
      ]],
      ["aggregate_judge_visa", [
        this.db.prepare(`INSERT INTO aggregate_judge_visa (judge_id,visa_subclass,case_count)
          SELECT cj.judge_id, c.visa_subclass, COUNT(DISTINCT cj.case_id)
          FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id WHERE c.visa_subclass <> ''
          GROUP BY cj.judge_id, c.visa_subclass`),
      ]],
      ["filter_options", filterOptions],
    ];
    const batches = [];
    let current = { tables: [], statements: [] };
    for (const [table, inserts] of groups) {
      const group = [this.db.prepare(`DELETE FROM ${table}`), ...inserts];
      if (current.statements.length > 0
        && current.statements.length + group.length > D1_BATCH_STATEMENT_LIMIT) {
        batches.push(current);
        current = { tables: [], statements: [] };
      }
      current = {
        tables: [...current.tables, table],
        statements: [...current.statements, ...group],
      };
    }
    if (current.statements.length > 0) batches.push(current);
    // A rebuild spans more than one transaction, so a failure part-way through
    // leaves a mixed generation: `committed_tables` names the tables that
    // already hold the new rows. Log it so the skew is observable in Logpush
    // instead of being inferred from a dashboard that looks slightly wrong.
    const committed = [];
    for (const [index, batch] of batches.entries()) {
      try {
        await this.db.batch(batch.statements);
      } catch (error) {
        console.error(JSON.stringify({
          event: "cloudflare.aggregate_rebuild_partial",
          batch_index: index,
          batches: batches.length,
          committed_tables: committed,
          error: error?.message,
        }));
        throw error;
      }
      committed.push(...batch.tables);
    }
    return { rebuilt_at: now, rebuilt_tables: committed };
  }

  async relatedCompat(caseId, { limit = 5 } = {}) {
    const id = assertCaseId(caseId);
    const size = compatPageNumber(limit, 5, 1, 20);
    const anchor = await this.db.prepare(`
      SELECT case_nature, visa_type, court_code FROM cases WHERE case_id = ?
    `).bind(id).first();
    if (!anchor) return null;
    // One OR across three different columns cannot use an index, so the previous
    // single query scanned the whole corpus and evaluated the full projection --
    // including its two correlated subqueries -- for every candidate before the
    // sorter applied LIMIT. Score each dimension with its own indexed range scan
    // instead (cases_nature_year_idx / cases_visa_type_idx / cases_court_year_idx),
    // merge in JS, and hydrate only the winners.
    const dimensions = [
      ["case_nature", anchor.case_nature, 4],
      ["visa_type", anchor.visa_type, 2],
      ["court_code", anchor.court_code, 1],
    ].filter(([, value]) => typeof value === "string" && value !== "");
    if (dimensions.length === 0) return [];
    const candidatePages = await Promise.all(dimensions.map(([column, value]) => bindAll(this.db, `
      SELECT case_id FROM cases
      WHERE ${column} = ? AND case_id <> ?
      ORDER BY year DESC, case_id ASC
      LIMIT ?
    `, [value, id, RELATED_CANDIDATES_PER_DIMENSION]).all()));
    // Union the candidate ids FIRST, then read each candidate's actual
    // dimension values and score from those.
    //
    // Do NOT derive the score from which pages a candidate appeared in. A case
    // that shares all three dimensions with the anchor but ranks 201st in, say,
    // the court page would be missing from that page and would silently score 2
    // instead of 3 -- so it would sort below a genuinely weaker match. The page
    // is a recall device; it is not evidence about the row's columns.
    const candidateIds = [...new Set(candidatePages.flatMap((page) => rows(page).map((row) => row.case_id)))];
    if (candidateIds.length === 0) return [];
    const facts = rows(await bindAll(this.db, `
      SELECT c.case_id, c.case_nature, c.visa_type, c.court_code, c.year
      FROM cases c JOIN json_each(?) wanted ON wanted.value = c.case_id
    `, [JSON.stringify(candidateIds)]).all());
    const ordered = facts
      .map((row) => ({
        case_id: row.case_id,
        year: Number.isFinite(Number(row.year)) ? Number(row.year) : -1,
        score: dimensions.reduce(
          (total, [column, value, weight]) => total + (row[column] === value ? weight : 0),
          0,
        ),
      }))
      .sort((left, right) =>
        right.score - left.score || right.year - left.year || left.case_id.localeCompare(right.case_id))
      .slice(0, size);
    const scoreById = new Map(ordered.map((entry) => [entry.case_id, entry.score]));
    const hydrated = await this.findByIds(ordered.map((entry) => entry.case_id));
    return hydrated.map((row) => ({ ...row, related_score: scoreById.get(row.case_id) || 0 }));
  }

  async searchLexical({ query, match, filters = {}, limit } = {}) {
    const matchString = match ?? toFtsMatch(query);
    const { clauses, params } = safeCaseFilters(filters);
    const size = clampLimit(limit, { fallback: 50, max: 100 });
    // bm25() is valid only in the direct FTS query context, and a single long
    // case can monopolise the top chunk ranks, so read one wide page of chunk
    // candidates and reduce to the best chunk rank per case in JS. This is the
    // same 500-row candidate ceiling the previous five sequential LIMIT/OFFSET
    // pages had, in one round trip instead of up to five.
    const hits = rows(await this.db.prepare(`
      SELECT case_id, bm25(case_text_fts) AS rank
      FROM case_text_fts
      WHERE case_text_fts MATCH ?
      ORDER BY rank ASC
      LIMIT ?
    `).bind(matchString, FTS_CANDIDATE_CHUNKS).all());
    const ranks = new Map();
    for (const hit of hits) {
      const rank = Number(hit.rank);
      if (!ranks.has(hit.case_id) || rank < ranks.get(hit.case_id)) ranks.set(hit.case_id, rank);
    }
    const caseIds = [...ranks.keys()];
    if (caseIds.length === 0) return [];
    const where = clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "";
    const statement = bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}
      FROM cases c
      JOIN json_each(?) candidate_ids ON candidate_ids.value = c.case_id
      WHERE 1 = 1 ${where}
      ORDER BY candidate_ids.key
      LIMIT ?
    `, [JSON.stringify(caseIds), ...params, size]);
    return rows(await statement.all())
      .map((row) => ({ ...row, rank: ranks.get(row.case_id) }))
      .sort((left, right) => left.rank - right.rank || left.case_id.localeCompare(right.case_id));
  }

  /**
   * Import metadata only after its R2 object has been uploaded and checksum
   * checked. Text chunks are deliberately bounded below the D1 row guard.
   */
  async putImportedCase({ case: record, sourcePointer, textChunks = [] }) {
    const pointer = assertObjectPointer(sourcePointer, "cases");
    const caseId = assertCaseId(record?.case_id);
    const chunks = await Promise.all(textChunks.map(async (chunk, index) => {
      const { bytes, hex } = await sha256Hex(chunk);
      if (bytes.byteLength === 0 || bytes.byteLength > FTS_CHUNK_MAX_BYTES) {
        throw new StorageBoundaryError(`FTS chunk ${index} exceeds the 128 KiB guard`, {
          code: "fts_chunk_too_large",
          status: 400,
        });
      }
      return { content: new TextDecoder().decode(bytes), sha256: hex };
    }));
    const now = utcNow();
    const metadata = {
      case_id: caseId,
      citation: String(record.citation || ""),
      title: String(record.title || ""),
      court: String(record.court || ""),
      court_code: String(record.court_code || ""),
      decision_date: String(record.decision_date || ""),
      year: Number.isInteger(record.year) ? record.year : null,
      outcome: String(record.outcome || ""),
      visa_type: String(record.visa_type || ""),
      visa_subclass: String(record.visa_subclass || ""),
      visa_class_code: String(record.visa_class_code || ""),
      visa_subclass_number: String(record.visa_subclass_number || ""),
      applicant_name: String(record.applicant_name || ""),
      respondent: String(record.respondent || ""),
      country_of_origin: String(record.country_of_origin || ""),
      hearing_date: String(record.hearing_date || ""),
      is_represented: record.is_represented === null || record.is_represented === undefined
        ? null : Number(Boolean(record.is_represented)),
      representative: String(record.representative || ""),
      source: String(record.source || ""),
      case_nature: String(record.case_nature || ""),
      url: String(record.url || ""),
      catchwords: String(record.catchwords || ""),
      legislation: String(record.legislation || ""),
      text_snippet: String(record.text_snippet || ""),
      tags: String(record.tags || ""),
      user_notes: String(record.user_notes || ""),
      visa_outcome_reason: String(record.visa_outcome_reason || ""),
      legal_test_applied: String(record.legal_test_applied || ""),
      last_extraction_run_id: record.last_extraction_run_id == null
        ? null : String(record.last_extraction_run_id),
      extraction_confidence_json: normaliseJsonObject(
        record.extraction_confidence_json ?? record.extraction_confidence,
      ),
    };
    const insertCase = bindAll(this.db, `
      INSERT INTO cases (
        case_id, citation, title, court, court_code, decision_date, year, outcome,
        visa_type, visa_subclass, visa_class_code, visa_subclass_number,
        applicant_name, respondent, country_of_origin, hearing_date, is_represented,
        representative, source, case_nature, url, catchwords, legislation,
        text_snippet, tags, user_notes, visa_outcome_reason, legal_test_applied,
        last_extraction_run_id, extraction_confidence_json, content_key,
        content_sha256, content_size, semantic_ready, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        0, ?, ?
      )
      ON CONFLICT(case_id) DO UPDATE SET
        citation=excluded.citation, title=excluded.title, court=excluded.court,
        court_code=excluded.court_code, decision_date=excluded.decision_date,
        year=excluded.year, outcome=excluded.outcome, visa_type=excluded.visa_type,
        visa_subclass=excluded.visa_subclass, visa_class_code=excluded.visa_class_code,
        visa_subclass_number=excluded.visa_subclass_number,
        applicant_name=excluded.applicant_name, respondent=excluded.respondent,
        country_of_origin=excluded.country_of_origin, hearing_date=excluded.hearing_date,
        is_represented=excluded.is_represented, representative=excluded.representative,
        source=excluded.source, case_nature=excluded.case_nature, url=excluded.url,
        catchwords=excluded.catchwords, legislation=excluded.legislation,
        text_snippet=excluded.text_snippet, tags=excluded.tags, user_notes=excluded.user_notes,
        visa_outcome_reason=excluded.visa_outcome_reason,
        legal_test_applied=excluded.legal_test_applied,
        last_extraction_run_id=excluded.last_extraction_run_id,
        extraction_confidence_json=excluded.extraction_confidence_json,
        content_key=excluded.content_key, content_sha256=excluded.content_sha256,
        content_size=excluded.content_size, semantic_ready=0, vector_mutation_id=NULL,
        updated_at=excluded.updated_at
    `, [
      metadata.case_id, metadata.citation, metadata.title, metadata.court,
      metadata.court_code, metadata.decision_date, metadata.year, metadata.outcome,
      metadata.visa_type, metadata.visa_subclass, metadata.visa_class_code,
      metadata.visa_subclass_number, metadata.applicant_name, metadata.respondent,
      metadata.country_of_origin, metadata.hearing_date, metadata.is_represented,
      metadata.representative, metadata.source, metadata.case_nature, metadata.url,
      metadata.catchwords, metadata.legislation, metadata.text_snippet,
      metadata.tags, metadata.user_notes, metadata.visa_outcome_reason,
      metadata.legal_test_applied, metadata.last_extraction_run_id,
      metadata.extraction_confidence_json, pointer.key, pointer.sha256, pointer.size,
      now, now,
    ]);
    await insertCase.run();

    // judge_id is a hash of the RAW label, so every spelling variant and
    // every prose fragment becomes a separate judge. See docs/adr/0051-judge-identity.md.
    const judgeLabels = normaliseRelationLabels(record.judges, "judge");
    const conceptLabels = normaliseRelationLabels(record.legal_concepts, "legal concept");
    const judgeStatements = [this.db.prepare(`DELETE FROM case_judges WHERE case_id = ?`).bind(caseId)];
    for (const label of judgeLabels) {
      const judgeId = (await sha256Hex(`judge:${label.toLocaleLowerCase("en-AU")}`)).hex.slice(0, 32);
      judgeStatements.push(
        this.db.prepare(`
          INSERT OR IGNORE INTO judges (judge_id, canonical_name, created_at, updated_at)
          VALUES (?, ?, ?, ?)
        `).bind(judgeId, label, now, now),
        this.db.prepare(`
          INSERT OR IGNORE INTO case_judges (case_id, judge_id) VALUES (?, ?)
        `).bind(caseId, judgeId),
      );
    }
    const conceptStatements = [this.db.prepare(`DELETE FROM case_concepts WHERE case_id = ?`).bind(caseId)];
    for (const label of conceptLabels) {
      const conceptId = (await sha256Hex(`concept:${label.toLocaleLowerCase("en-AU")}`)).hex.slice(0, 32);
      conceptStatements.push(
        this.db.prepare(`INSERT OR IGNORE INTO concepts (concept_id, label) VALUES (?, ?)`)
          .bind(conceptId, label),
        this.db.prepare(`
          INSERT OR IGNORE INTO case_concepts (case_id, concept_id) VALUES (?, ?)
        `).bind(caseId, conceptId),
      );
    }
    await this.db.batch(judgeStatements);
    await this.db.batch(conceptStatements);
    // A repeatable import must remove stale tail chunks before adding the new
    // canonical text. The delete and ALL replacement inserts ride one D1
    // transaction, so a case that has full text is never observable with zero
    // chunks and never with only a prefix of the new text. The FTS delete
    // trigger keeps case_text_fts in lockstep.
    const chunkStatements = [this.db.prepare(`DELETE FROM case_text_chunks WHERE case_id = ?`).bind(caseId)];
    chunks.forEach((chunk, index) => {
      chunkStatements.push(bindAll(this.db, `
        INSERT INTO case_text_chunks (case_id, chunk_index, content, content_sha256, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(case_id, chunk_index) DO UPDATE SET
          content=excluded.content, content_sha256=excluded.content_sha256, created_at=excluded.created_at
      `, [caseId, index, chunk.content, chunk.sha256, now]));
    });
    if (chunkStatements.length > D1_CHUNK_TRANSACTION_STATEMENT_LIMIT) {
      throw new StorageBoundaryError("Canonical text produces too many chunks for one transaction", {
        code: "fts_chunk_count_too_large",
        status: 400,
      });
    }
    await this.db.batch(chunkStatements);
  }

  async markSemanticReady(caseId, mutationId) {
    const id = assertCaseId(caseId);
    await this.db.prepare(`
      UPDATE cases
      SET semantic_ready = 1, vector_mutation_id = ?, updated_at = ?
      WHERE case_id = ?
    `).bind(mutationId, utcNow(), id).run();
  }
}

