/**
 * Cloudflare Worker: IMMI Case API + Flask Container Proxy
 *
 * Read path (fast, no cold start):
 *   GET /api/v1/cases            → Hyperdrive → Supabase PostgreSQL
 *   GET /api/v1/cases/count      → Hyperdrive → Supabase PostgreSQL
 *   GET /api/v1/cases/:id        → Hyperdrive → Supabase PostgreSQL
 *   GET /api/v1/stats            → Hyperdrive → Supabase PostgreSQL (parallel aggregates)
 *   GET /api/v1/filter-options   → Hyperdrive → Supabase PostgreSQL (DISTINCT values)
 *   GET /api/v1/analytics/*      → Hyperdrive → Supabase PostgreSQL (RPC functions + JS normalisation)
 *
 * Write / complex path (Flask Container):
 *   POST/PUT/DELETE /api/v1/*    → Flask Container (write operations)
 *   GET /api/v1/search           → Flask Container (semantic/LLM search)
 *   GET /api/v1/csrf-token       → Flask Container (CSRF token generation)
 *   GET /api/v1/legislations/*   → Flask Container
 *   /app/*                       → Flask Container (React SPA)
 *
 * Fallback: if a native handler throws, the request is automatically
 * retried via Flask Container so the user never sees an error.
 */

import { DurableObject } from "cloudflare:workers";
import postgres from "postgres";

// ── Table / column constants ──────────────────────────────────────────────────

const TABLE = "immigration_cases";

// Columns returned by the cases list endpoint (matches Flask CASE_LIST_COLUMNS)
const CASE_LIST_COLS = [
  "case_id", "citation", "title", "court_code", "date", "year",
  "judges", "outcome", "visa_type", "source", "tags", "case_nature",
  "visa_subclass", "visa_class_code", "applicant_name", "respondent",
  "country_of_origin", "visa_subclass_number", "hearing_date",
  "is_represented", "representative",
];

// Validated sort columns — prevents SQL injection via untrusted sort_by param
const SORT_COL_MAP = {
  date: "year",                          // date is varchar; sort by year int for reliability
  title: "title",
  court: "court_code",
  outcome: "outcome",
  visa_subclass_number: "visa_subclass_number",
  applicant_name: "applicant_name",
  hearing_date: "hearing_date",
  case_id: "case_id",
  citation: "citation",
};

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const HEX_ID_RE = /^[0-9a-f]{12}$/;

// ── Database client (module-level, reused across requests per isolate) ────────

/** @type {import("postgres").Sql | null} */
let _sqlClient = null;

/**
 * Return (or lazily create) the postgres client backed by Hyperdrive.
 * Hyperdrive manages the actual PostgreSQL connection pool; the Worker
 * only needs one client per isolate.
 */
function getSql(env) {
  if (!_sqlClient) {
    _sqlClient = postgres(env.HYPERDRIVE.connectionString, {
      max: 5,          // max connections per Worker isolate (Hyperdrive pools beyond this)
      idle_timeout: 20, // seconds before idle connections are released back to Hyperdrive
    });
  }
  return _sqlClient;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeInt(val, def, min = 0, max = 99999) {
  const n = parseInt(val ?? "", 10);
  return Number.isNaN(n) ? def : Math.max(min, Math.min(max, n));
}

function jsonOk(data, cacheControl = "no-cache") {
  return Response.json(data, { headers: { "Cache-Control": cacheControl } });
}

function jsonErr(msg, status = 400) {
  return Response.json({ error: msg }, { status });
}

// ── WHERE clause builder ──────────────────────────────────────────────────────

/**
 * Build a composable SQL fragment for the cases WHERE clause.
 * All values are parameterized — no SQL injection risk.
 *
 * Returns null if the `tag` filter is active (tag filtering requires
 * array-contains logic; fall back to Flask for that case).
 */
function buildCasesWhere(sql, { court, year, visa_type, source, nature, keyword, tag }) {
  // Tags are stored as pipe-delimited strings in Postgres; complex to filter.
  // Signal Flask fallback by returning null.
  if (tag) return null;

  const parts = [sql`TRUE`];
  if (court)     parts.push(sql`court_code = ${court}`);
  if (year)      parts.push(sql`year = ${year}`);
  if (visa_type) parts.push(sql`visa_type = ${visa_type}`);
  if (source)    parts.push(sql`source = ${source}`);
  if (nature)    parts.push(sql`case_nature ILIKE ${nature}`);
  if (keyword) {
    const like = `%${keyword}%`;
    parts.push(sql`(title ILIKE ${like} OR citation ILIKE ${like})`);
  }
  // Reduce into a single AND-joined fragment
  return parts.reduce((acc, part) => sql`${acc} AND ${part}`);
}

function parseCaseFilters(searchParams) {
  const p = searchParams;
  return {
    court:     (p.get("court")     ?? "").trim(),
    year:      safeInt(p.get("year"), 0, 0, 2200),
    visa_type: (p.get("visa_type") ?? "").trim(),
    keyword:   (p.get("keyword")   ?? "").trim(),
    source:    (p.get("source")    ?? "").trim(),
    tag:       (p.get("tag")       ?? "").trim(),
    nature:    (p.get("nature")    ?? "").trim(),
  };
}

// ── Native GET handlers ───────────────────────────────────────────────────────

/** GET /api/v1/cases — paginated, filtered case list */
async function handleGetCases(url, env) {
  const filters = parseCaseFilters(url.searchParams);
  const sortBy  = url.searchParams.get("sort_by")  ?? "date";
  const sortDir = (url.searchParams.get("sort_dir") ?? "desc").toLowerCase();
  const page     = safeInt(url.searchParams.get("page"),      1,               1,  10000);
  const pageSize = safeInt(url.searchParams.get("page_size"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

  const sortCol = SORT_COL_MAP[sortBy];
  if (!sortCol) return jsonErr(`Invalid sort_by '${sortBy}'.`);
  if (sortDir !== "asc" && sortDir !== "desc") return jsonErr("sort_dir must be asc or desc.");

  const sql   = getSql(env);
  const where = buildCasesWhere(sql, filters);
  if (!where) return null; // tag filter → Flask

  const offset  = (page - 1) * pageSize;
  const safeDir = sql.unsafe(sortDir === "asc" ? "ASC" : "DESC");

  const [rows, countResult] = await Promise.all([
    sql`
      SELECT ${sql(CASE_LIST_COLS)}
      FROM   ${sql(TABLE)}
      WHERE  ${where}
      ORDER BY ${sql(sortCol)} ${safeDir} NULLS LAST
      LIMIT  ${pageSize}
      OFFSET ${offset}
    `,
    sql`
      SELECT COUNT(*)::int AS total
      FROM   ${sql(TABLE)}
      WHERE  ${where}
    `,
  ]);

  const total      = countResult[0].total;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return jsonOk(
    { cases: rows, total, count_mode: "exact", page, page_size: pageSize, total_pages: totalPages },
    "public, max-age=30, stale-while-revalidate=10",
  );
}

/** GET /api/v1/cases/count — lightweight count-only endpoint */
async function handleGetCasesCount(url, env) {
  const filters = parseCaseFilters(url.searchParams);
  const sql     = getSql(env);
  const where   = buildCasesWhere(sql, filters);
  if (!where) return null; // tag filter → Flask

  const [result] = await sql`
    SELECT COUNT(*)::int AS total FROM ${sql(TABLE)} WHERE ${where}
  `;
  return jsonOk({ total: result.total, count_mode: "exact" });
}

/** GET /api/v1/cases/:id — single case detail */
async function handleGetCase(caseId, env) {
  if (!HEX_ID_RE.test(caseId)) return jsonErr("Invalid case ID");

  const sql    = getSql(env);
  const [row]  = await sql`
    SELECT * FROM ${sql(TABLE)} WHERE case_id = ${caseId}
  `;
  if (!row) return jsonErr("Case not found", 404);

  // full_text (file content) is not stored in Supabase — it lives on the
  // container filesystem (gitignored). Return null so the frontend degrades
  // gracefully; the Flask path also returns null in production containers.
  return jsonOk({ case: row, full_text: null });
}

/** GET /api/v1/stats — dashboard aggregate statistics */
async function handleGetStats(url, env) {
  const p       = url.searchParams;
  const court   = (p.get("court")     ?? "").trim();
  const yearFrom = safeInt(p.get("year_from"), 0, 0, 2200);
  const yearTo   = safeInt(p.get("year_to"),   0, 0, 2200);

  // If any filter is active, the filtered path requires loading all cases
  // in memory (complex Python logic). Defer to Flask.
  const isFiltered =
    court ||
    (yearFrom > 0 && yearFrom > 2000) ||
    (yearTo > 0 && yearTo < new Date().getFullYear());
  if (isFiltered) return null;

  const sql = getSql(env);

  // Run all aggregate queries in parallel for maximum throughput
  const [totals, byCourt, byYear, byNature, byVisa, bySrc, recent] = await Promise.all([
    sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN full_text_path IS NOT NULL AND full_text_path <> '' THEN 1 END)::int AS with_full_text
      FROM ${sql(TABLE)}
    `,
    sql`
      SELECT court_code, COUNT(*)::int AS cnt
      FROM   ${sql(TABLE)}
      WHERE  court_code IS NOT NULL
      GROUP BY court_code
      ORDER BY cnt DESC
    `,
    sql`
      SELECT year::text AS yr, COUNT(*)::int AS cnt
      FROM   ${sql(TABLE)}
      WHERE  year IS NOT NULL
      GROUP BY year
      ORDER BY year
    `,
    sql`
      SELECT case_nature, COUNT(*)::int AS cnt
      FROM   ${sql(TABLE)}
      WHERE  case_nature IS NOT NULL AND case_nature <> ''
      GROUP BY case_nature
      ORDER BY cnt DESC
      LIMIT 60
    `,
    sql`
      SELECT visa_subclass, COUNT(*)::int AS cnt
      FROM   ${sql(TABLE)}
      WHERE  visa_subclass IS NOT NULL AND visa_subclass <> ''
      GROUP BY visa_subclass
      ORDER BY cnt DESC
      LIMIT 80
    `,
    sql`
      SELECT source, COUNT(*)::int AS cnt
      FROM   ${sql(TABLE)}
      WHERE  source IS NOT NULL
      GROUP BY source
      ORDER BY cnt DESC
    `,
    sql`
      SELECT case_id, title, citation, court_code, date, outcome
      FROM   ${sql(TABLE)}
      WHERE  year IS NOT NULL
      ORDER BY year DESC, case_id DESC
      LIMIT 5
    `,
  ]);

  return jsonOk(
    {
      total_cases:    totals[0].total,
      with_full_text: totals[0].with_full_text,
      courts:         Object.fromEntries(byCourt.map(r => [r.court_code, r.cnt])),
      years:          Object.fromEntries(byYear.map(r  => [r.yr, r.cnt])),
      natures:        Object.fromEntries(byNature.map(r => [r.case_nature, r.cnt])),
      visa_subclasses: Object.fromEntries(byVisa.map(r => [r.visa_subclass, r.cnt])),
      visa_families:  {},  // complex Python grouping logic; frontend tolerates empty {}
      sources:        Object.fromEntries(bySrc.map(r => [r.source, r.cnt])),
      recent_cases:   recent,
    },
    "public, max-age=300, stale-while-revalidate=60",
  );
}

/** GET /api/v1/filter-options — distinct filter values for UI dropdowns */
async function handleGetFilterOptions(env) {
  const sql = getSql(env);

  const [courts, years, natures, visaTypes, sources, outcomes] = await Promise.all([
    sql`SELECT DISTINCT court_code AS v FROM ${sql(TABLE)} WHERE court_code IS NOT NULL ORDER BY v`,
    sql`SELECT DISTINCT year AS v       FROM ${sql(TABLE)} WHERE year IS NOT NULL ORDER BY v DESC`,
    sql`SELECT DISTINCT case_nature AS v FROM ${sql(TABLE)} WHERE case_nature IS NOT NULL AND case_nature <> '' ORDER BY v`,
    sql`SELECT DISTINCT visa_type AS v   FROM ${sql(TABLE)} WHERE visa_type IS NOT NULL AND visa_type <> '' ORDER BY v`,
    sql`SELECT DISTINCT source AS v      FROM ${sql(TABLE)} WHERE source IS NOT NULL ORDER BY v`,
    sql`SELECT DISTINCT outcome AS v     FROM ${sql(TABLE)} WHERE outcome IS NOT NULL AND outcome <> '' ORDER BY v`,
  ]);

  return jsonOk(
    {
      courts:     courts.map(r => r.v),
      years:      years.map(r  => r.v),
      natures:    natures.map(r => r.v),
      visa_types: visaTypes.map(r => r.v),
      sources:    sources.map(r => r.v),
      outcomes:   outcomes.map(r => r.v),
      tags:       [],  // tags require array-unnest; not yet implemented in native path
    },
    "public, max-age=300, stale-while-revalidate=60",
  );
}

// ── Analytics helpers ─────────────────────────────────────────────────────────

// Ordered: multi-word patterns must precede single-stem patterns.
const _OUTCOME_MAP = [
  ["no jurisdiction", "No Jurisdiction"],
  ["set aside",       "Set Aside"],
  ["affirm",          "Affirmed"],
  ["dismiss",         "Dismissed"],
  ["remit",           "Remitted"],
  ["allow",           "Allowed"],
  ["grant",           "Granted"],
  ["quash",           "Quashed"],
  ["refus",           "Refused"],
  ["cancel",          "Cancelled"],
  ["withdrawn",       "Withdrawn"],
  ["discontinu",      "Withdrawn"],
  ["varied",          "Varied"],
];

function normaliseOutcome(raw) {
  if (!raw) return "Other";
  const low = raw.toLowerCase().trim();
  for (const [kw, label] of _OUTCOME_MAP) {
    if (low.includes(kw)) return label;
  }
  return "Other";
}

const _CONCEPT_CANONICAL = new Map([
  ["refugee status",                   "Refugee Status"],
  ["refugee",                          "Refugee Status"],
  ["refugees",                         "Refugee Status"],
  ["asylum",                           "Refugee Status"],
  ["asylee",                           "Refugee Status"],
  ["protection obligations",           "Protection Obligations"],
  ["s.36",                             "Protection Obligations"],
  ["s.36 protection criteria",         "Protection Obligations"],
  ["complementary protection",         "Complementary Protection"],
  ["well-founded fear",                "Well-Founded Fear"],
  ["well-founded fear of persecution", "Well-Founded Fear"],
  ["well founded fear of persecution", "Well-Founded Fear"],
  ["well founded fear",                "Well-Founded Fear"],
  ["refugee convention",               "Refugee Convention"],
  ["refugees convention",              "Refugee Convention"],
  ["convention obligations",           "Refugee Convention"],
  ["un convention",                    "Refugee Convention"],
  ["1951 convention",                  "Refugee Convention"],
  ["persecution",                      "Persecution"],
  ["serious harm",                     "Persecution"],
  ["significant harm",                 "Persecution"],
  ["particular social group",          "Particular Social Group"],
  ["psg",                              "Particular Social Group"],
  ["social group",                     "Particular Social Group"],
  ["political opinion",                "Political Opinion"],
  ["imputed political opinion",        "Political Opinion"],
  ["political beliefs",                "Political Opinion"],
  ["country information",              "Country Information"],
  ["country evidence",                 "Country Information"],
  ["country conditions",               "Country Information"],
  ["independent country information",  "Country Information"],
  ["genuine relationship",             "Genuine Relationship"],
  ["de facto relationship",            "Genuine Relationship"],
  ["family relationship",              "Genuine Relationship"],
  ["genuine temporary entrant",        "Genuine Temporary Entrant"],
  ["genuine student",                  "Genuine Temporary Entrant"],
  ["genuine visit",                    "Genuine Temporary Entrant"],
  ["genuine intention",                "Genuine Temporary Entrant"],
  ["jurisdictional error",             "Jurisdictional Error"],
  ["error of law",                     "Jurisdictional Error"],
  ["legal error",                      "Jurisdictional Error"],
  ["jurisdictional limits",            "Jurisdictional Error"],
  ["judicial review",                  "Judicial Review"],
  ["judicial review principles",       "Judicial Review"],
  ["judicial review application",      "Judicial Review"],
  ["review",                           "Judicial Review"],
  ["merits review",                    "Judicial Review"],
  ["visa review",                      "Judicial Review"],
  ["procedural fairness",              "Procedural Fairness"],
  ["natural justice",                  "Procedural Fairness"],
  ["bias",                             "Procedural Fairness"],
  ["apprehended bias",                 "Procedural Fairness"],
  ["hearing rule",                     "Procedural Fairness"],
  ["unreasonableness",                 "Unreasonableness"],
  ["wednesbury unreasonableness",      "Unreasonableness"],
  ["irrationality",                    "Unreasonableness"],
  ["manifest unreasonableness",        "Unreasonableness"],
  ["jurisdiction",                     "Jurisdiction"],
  ["privative clause",                 "Jurisdiction"],
  ["standing",                         "Jurisdiction"],
  ["tribunal jurisdiction",            "Jurisdiction"],
  ["time limitation",                  "Time Limitation"],
  ["time limits",                      "Time Limitation"],
  ["limitation period",                "Time Limitation"],
  ["time bar",                         "Time Limitation"],
  ["timeliness",                       "Time Limitation"],
  ["tribunal procedure",               "Tribunal Procedure"],
  ["hearing",                          "Tribunal Procedure"],
  ["s.359a",                           "Tribunal Procedure"],
  ["s.424a",                           "Tribunal Procedure"],
  ["inquisitorial process",            "Tribunal Procedure"],
  ["character test",                   "Character Test"],
  ["s.501 character test",             "Character Test"],
  ["character test (s.501)",           "Character Test"],
  ["character test s.501",             "Character Test"],
  ["criminal history",                 "Character Test"],
  ["substantial criminal record",      "Character Test"],
  ["visa cancellation",                "Visa Cancellation"],
  ["cancellation",                     "Visa Cancellation"],
  ["s.116",                            "Visa Cancellation"],
  ["s.109",                            "Visa Cancellation"],
  ["cancellation of visa",             "Visa Cancellation"],
  ["mandatory cancellation",           "Visa Cancellation"],
  ["visa refusal",                     "Visa Refusal"],
  ["refusal of visa",                  "Visa Refusal"],
  ["refusal",                          "Visa Refusal"],
  ["visa rejection",                   "Visa Refusal"],
  ["ministerial intervention",         "Ministerial Intervention"],
  ["ministerial discretion",           "Ministerial Intervention"],
  ["s.351",                            "Ministerial Intervention"],
  ["s.417",                            "Ministerial Intervention"],
  ["credibility",                      "Credibility Assessment"],
  ["credibility assessment",           "Credibility Assessment"],
  ["adverse credibility",              "Credibility Assessment"],
  ["witness credibility",              "Credibility Assessment"],
  ["truthfulness",                     "Credibility Assessment"],
  ["evidence",                         "Evidence"],
  ["corroboration",                    "Evidence"],
  ["medical evidence",                 "Evidence"],
  ["expert evidence",                  "Evidence"],
  ["evidentiary matters",              "Evidence"],
  ["costs",                            "Costs"],
  ["legal costs",                      "Costs"],
  ["cost order",                       "Costs"],
  ["legal representation",             "Legal Representation"],
  ["right to be heard",                "Legal Representation"],
  ["unrepresented applicant",          "Legal Representation"],
  ["appeal",                           "Appeal"],
  ["appellate jurisdiction",           "Appeal"],
  ["remittal",                         "Appeal"],
  ["fraud",                            "Fraud"],
  ["misrepresentation",                "Fraud"],
  ["bogus document",                   "Fraud"],
  ["migration act",                    "Migration Act"],
  ["migration law",                    "Migration Act"],
  ["migration regulations",            "Migration Act"],
  ["health criteria",                  "Health Criteria"],
  ["health requirement",               "Health Criteria"],
  ["medical criteria",                 "Health Criteria"],
]);

// Ported from Python _JUDGE_TITLE_RE / _JUDGE_SUFFIX_RE / _JUDGE_BLOCKLIST
const _JUDGE_TITLE_RE = /^(?:The\s+Hon(?:ourable)?\.?\s+|Hon(?:ourable)?\.?\s+|Chief\s+Justice\s+|Justice\s+|Senior\s+Member\s+|Deputy\s+President\s+|Deputy\s+Member\s+|Deputy\s+|Principal\s+Member\s+|Member\s+|Magistrate\s+|Judge\s+|President\s+|Registrar\s+|Mr\.?\s+|Mrs\.?\s+|Ms\.?\s+|Miss\s+|Dr\.?\s+|Prof\.?\s+)/i;
const _JUDGE_SUFFIX_RE = /\s+(?:J|CJ|ACJ|FM|AM|DCJ|JA|RFM|SM|DP|P|SC|KC|QC|AO|AC|OAM|PSM)\.?$/i;

const _JUDGE_BLOCKLIST = new Set([
  "date","the","and","or","of","in","for","at","by",
  "court","tribunal","member","judge","justice","honour",
  "federal","migration","review","applicant","respondent",
  "minister","decision","department","government","australia",
  "registry","registrar","president","deputy","senior",
  "appellant","appeal","application","matter",
]);

const _NAME_DISQUALIFIERS = new Set([
  "the","of","in","for","at","on","by","to","with","and","or",
  "a","an","this","that","was","were","which","where","when",
  "tribunal","court","department","minister","registry","review",
  "applicant","respondent","appellant","migration","australia",
  "held","error","errors","finding","findings","reason","reasons",
  "dismissed","dismiss","allowed","allow","granted","grant",
  "refused","refuse","rejected","reject","affirmed","affirm",
  "remitted","remit","quashed","quash","set","aside","decision",
  "order","orders","hearing","judgment","judgement","appeal",
  "application","visa",
]);

function normaliseJudgeName(raw) {
  if (!raw) return "";
  let name = raw.trim().replace(/\s+/g, " ");
  for (let i = 0; i < 4; i++) {
    const m = name.match(_JUDGE_TITLE_RE);
    if (m) name = name.slice(m[0].length).trim();
    else break;
  }
  name = name.replace(_JUDGE_SUFFIX_RE, "").trim();
  name = name.replace(/[\(\)\[\]\{\}]/g, " ").replace(/[^A-Za-z'.\-\s]/g, " ").replace(/\s+/g, " ").trim();
  return name;
}

function isRealJudgeName(name) {
  if (!name || name.length < 2) return false;
  const words = name.split(/\s+/);
  if (words.length === 0 || words.length > 8) return false;
  if (words.some(w => !/^[A-Za-z][A-Za-z'.-]*\.?$/.test(w))) return false;
  const lower = words.map(w => w.toLowerCase().replace(/\.$/, ""));
  if (lower.some(w => _NAME_DISQUALIFIERS.has(w))) return false;
  if (words.length === 1 && lower[0].length < 3) return false;
  if (!words.some(w => w.replace(/\.$/, "").length > 1)) return false;
  if (!words.some(w => /^[A-Z]/.test(w))) return false;
  return true;
}

/** GET /api/v1/analytics/outcomes — outcome rates by court, year, visa subclass */
async function handleAnalyticsOutcomes(env) {
  const sql = getSql(env);

  const [byCourt, byYear, byVisa] = await Promise.all([
    sql`SELECT court_code, outcome, cnt::int FROM get_analytics_outcomes_court()`,
    sql`SELECT year_key, outcome, cnt::int FROM get_analytics_outcomes_year()`,
    sql`SELECT visa_subclass, outcome, cnt::int FROM get_analytics_outcomes_visa()`,
  ]);

  const courtMap = {};
  for (const r of byCourt) {
    const norm = normaliseOutcome(r.outcome);
    (courtMap[r.court_code] ??= {})[norm] = ((courtMap[r.court_code][norm]) ?? 0) + r.cnt;
  }

  const yearMap = {};
  for (const r of byYear) {
    const norm = normaliseOutcome(r.outcome);
    (yearMap[r.year_key] ??= {})[norm] = ((yearMap[r.year_key][norm]) ?? 0) + r.cnt;
  }

  const subclassMap = {};
  for (const r of byVisa) {
    if (!r.visa_subclass) continue;
    const norm = normaliseOutcome(r.outcome);
    (subclassMap[r.visa_subclass] ??= {})[norm] = ((subclassMap[r.visa_subclass][norm]) ?? 0) + r.cnt;
  }

  return jsonOk({
    by_court:    Object.fromEntries(Object.entries(courtMap).sort()),
    by_year:     Object.fromEntries(Object.entries(yearMap).sort()),
    by_subclass: Object.fromEntries(
      Object.entries(subclassMap).sort((a, b) =>
        Object.values(b[1]).reduce((s, v) => s + v, 0) -
        Object.values(a[1]).reduce((s, v) => s + v, 0)
      )
    ),
    by_family: {},  // visa family grouping requires Python visa_registry; frontend tolerates {}
  }, "public, max-age=600, stale-while-revalidate=120");
}

/** GET /api/v1/analytics/judges — top judges/members by case count */
async function handleAnalyticsJudges(url, env) {
  const limit = safeInt(url.searchParams.get("limit"), 20, 1, 100);
  const sql   = getSql(env);

  const rows = await sql`SELECT judge_raw, court_code, cnt::int FROM get_analytics_judges_raw()`;

  const counter    = new Map();
  const canonicals = new Map();
  const courtsMap  = new Map();

  for (const r of rows) {
    const raw  = (r.judge_raw ?? "").trim();
    const court = r.court_code ?? "";
    const cnt  = r.cnt;

    const name = normaliseJudgeName(raw);
    if (!name || !isRealJudgeName(name)) continue;
    if (_JUDGE_BLOCKLIST.has(name.toLowerCase())) continue;

    const key = name.toLowerCase();
    counter.set(key, (counter.get(key) ?? 0) + cnt);
    if (!canonicals.has(key)) canonicals.set(key, name);
    if (court) {
      if (!courtsMap.has(key)) courtsMap.set(key, new Set());
      courtsMap.get(key).add(court);
    }
  }

  const judges = [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({
      name:         canonicals.get(key),
      display_name: canonicals.get(key),
      count,
      courts:       [...(courtsMap.get(key) ?? [])].sort(),
    }));

  return jsonOk({ judges }, "public, max-age=600, stale-while-revalidate=120");
}

/** GET /api/v1/analytics/legal-concepts — top legal concepts by frequency */
async function handleAnalyticsLegalConcepts(url, env) {
  const limit = safeInt(url.searchParams.get("limit"), 20, 1, 100);
  const sql   = getSql(env);

  const rows = await sql`SELECT concept_raw, cnt::int FROM get_analytics_concepts_raw()`;

  const counter = new Map();
  for (const r of rows) {
    const raw      = (r.concept_raw ?? "").trim().replace(/[.,;:]+$/, "").toLowerCase();
    const canonical = _CONCEPT_CANONICAL.get(raw);
    if (!canonical) continue;
    counter.set(canonical, (counter.get(canonical) ?? 0) + r.cnt);
  }

  const concepts = [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));

  return jsonOk({ concepts }, "public, max-age=600, stale-while-revalidate=120");
}

/** GET /api/v1/analytics/nature-outcome — case nature × outcome cross-tabulation */
async function handleAnalyticsNatureOutcome(env) {
  const sql = getSql(env);

  const rows = await sql`SELECT case_nature, outcome, cnt::int FROM get_analytics_nature_outcome()`;

  const natureMap = {};
  for (const r of rows) {
    if (!r.case_nature) continue;
    const norm = normaliseOutcome(r.outcome);
    (natureMap[r.case_nature] ??= {})[norm] = ((natureMap[r.case_nature][norm]) ?? 0) + r.cnt;
  }

  const topNatures = Object.entries(natureMap)
    .map(([n, outs]) => [n, Object.values(outs).reduce((s, v) => s + v, 0)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([n]) => n);

  const allOutcomes = new Set();
  for (const outs of Object.values(natureMap)) {
    for (const o of Object.keys(outs)) allOutcomes.add(o);
  }
  const outcomeLabels = [...allOutcomes].sort();

  const matrix = {};
  for (const nature of topNatures) {
    matrix[nature] = Object.fromEntries(
      outcomeLabels.map(o => [o, natureMap[nature][o] ?? 0])
    );
  }

  return jsonOk({
    natures:  topNatures,
    outcomes: outcomeLabels,
    matrix,
  }, "public, max-age=600, stale-while-revalidate=120");
}

// ── Flask Container Durable Object ────────────────────────────────────────────

export class FlaskBackend extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Boot the container only if not already running.
    // blockConcurrencyWhile ensures no requests are handled until ready.
    this.ctx.blockConcurrencyWhile(async () => {
      if (!this.ctx.container.running) {
        await this.ctx.container.start({
          env: {
            SECRET_KEY:                env.SECRET_KEY,
            SUPABASE_URL:              env.SUPABASE_URL,
            SUPABASE_ANON_KEY:         env.SUPABASE_ANON_KEY,
            SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
            APP_ENV: "production",
            // NOTE: HYPERDRIVE_DATABASE_URL not injected here —
            // Cloudflare Containers cannot resolve *.hyperdrive.local DNS.
            // Flask uses SupabaseRepository (REST API) instead, which works
            // once the container's socket patch resolves DNS via anycast IPs.
          },
        });
      }
    });
  }

  async fetch(request) {
    const url          = new URL(request.url);
    const containerUrl = `http://container${url.pathname}${url.search}`;

    // Retry until Flask is ready. Cold start: image pull + Python startup ≈ 30-60s.
    const MAX_ATTEMPTS  = 120; // 60 seconds total (120 × 500ms)
    const RETRY_DELAY   = 500;
    let lastError;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const port = this.ctx.container.getTcpPort(8080);
        return await port.fetch(new Request(containerUrl, request));
      } catch (err) {
        const msg = err?.message ?? "";
        if (msg.includes("not listening") || msg.includes("not running")) {
          lastError = err;
          await new Promise(r => setTimeout(r, RETRY_DELAY));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }
}

// ── Flask proxy helper ────────────────────────────────────────────────────────

async function proxyToFlask(request, env) {
  const id        = env.FlaskBackend.idFromName("flask-v13");
  const container = env.FlaskBackend.get(id);

  // Inject Hyperdrive connection string so Flask can optionally use direct psycopg2.
  // The socket.getaddrinfo patch in the container resolves *.hyperdrive.local DNS.
  if (env.HYPERDRIVE) {
    const headers = new Headers(request.headers);
    headers.set("X-Hyperdrive-Url", env.HYPERDRIVE.connectionString);
    return container.fetch(new Request(request, { headers }));
  }

  return container.fetch(request);
}

// ── Main router ───────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // Edge health check — no container needed
    if (path === "/health") {
      return Response.json({ status: "ok", worker: "immi-case", layer: "edge+hyperdrive" });
    }

    // ── Native Hyperdrive read path ───────────────────────────────────────────
    // Only for GET requests to /api/v1/* when Hyperdrive is available.
    // Handlers return null to signal "fall through to Flask".
    if (method === "GET" && path.startsWith("/api/v1/") && env.HYPERDRIVE) {
      try {
        let res = null;

        if (path === "/api/v1/cases") {
          res = await handleGetCases(url, env);
        } else if (path === "/api/v1/cases/count") {
          res = await handleGetCasesCount(url, env);
        } else if (path === "/api/v1/stats") {
          res = await handleGetStats(url, env);
        } else if (path === "/api/v1/filter-options") {
          res = await handleGetFilterOptions(env);
        } else if (path === "/api/v1/analytics/outcomes") {
          res = await handleAnalyticsOutcomes(env);
        } else if (path === "/api/v1/analytics/judges") {
          res = await handleAnalyticsJudges(url, env);
        } else if (path === "/api/v1/analytics/legal-concepts") {
          res = await handleAnalyticsLegalConcepts(url, env);
        } else if (path === "/api/v1/analytics/nature-outcome") {
          res = await handleAnalyticsNatureOutcome(env);
        } else {
          // Match /api/v1/cases/:id (exactly 12 lowercase hex chars)
          const m = path.match(/^\/api\/v1\/cases\/([0-9a-f]{12})$/);
          if (m) res = await handleGetCase(m[1], env);
        }

        if (res !== null) return res;
        // null → handler signalled "use Flask" (e.g. tag filter active)
      } catch (nativeErr) {
        // If the native handler throws (DB error, Hyperdrive hiccup), fall
        // through to Flask so the user never sees a raw 500.
        console.error("[native] handler error — falling back to Flask:", nativeErr?.message);
      }
    }

    // ── Flask Container proxy path ────────────────────────────────────────────
    // Everything that wasn't handled natively above goes to the Flask
    // container. Flask's SPA catch-all serves index.html for unknown
    // paths, so React Router can handle client-side routes like / and
    // /cases/:id. The legacy /app/* mount still works because Flask
    // serves the SPA from that prefix too (resolveRouterBasename()
    // auto-detects which mount it is running under).
    return proxyToFlask(request, env);
  },
};
