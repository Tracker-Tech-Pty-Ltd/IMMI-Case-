/**
 * Cloudflare-native read handlers for the IMMI case corpus.
 *
 * This module is deliberately not mounted for legacy/shadow traffic. When a
 * later route cutover selects IMMI_STORAGE_MODE=cloudflare, every response in
 * this file is produced by storage boundaries rather than Hyperdrive or the
 * Flask container. Unsupported routes return null so the route manifest gate
 * can reject activation before a partial production switch.
 */

import { createCloudflareStores } from "../storage/cloudflare.js";
import { getStorageMode, StorageBoundaryError, VECTOR_MODEL } from "../storage/contracts.js";
import { DATA_DICTIONARY_FIELDS, LEGISLATIONS_META, VISA_REGISTRY_API, VISA_REGISTRY_RAW } from "./static.js";
import { LEGAL_CONCEPTS } from "./legal_concepts.js";

const CASE_ID_RE = /^[0-9a-f]{12}$/;
const JUDGE_PHOTO_PATH_RE = /^\/api\/v1\/judge-photo\/([^/]+)$/;
const OUTCOME_MAP = [
  ["no jurisdiction", "No Jurisdiction"], ["set aside", "Set Aside"],
  ["affirm", "Affirmed"], ["dismiss", "Dismissed"], ["remit", "Remitted"],
  ["allow", "Allowed"], ["grant", "Granted"], ["quash", "Quashed"],
  ["refus", "Refused"], ["cancel", "Cancelled"], ["withdrawn", "Withdrawn"],
  ["discontinu", "Withdrawn"], ["varied", "Varied"],
];

function normaliseOutcome(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "Other";
  return OUTCOME_MAP.find(([needle]) => text.includes(needle))?.[1] || "Other";
}

function visaFamily(subclass) {
  return VISA_REGISTRY_RAW[String(subclass || "").replace(/\.0$/, "")]?.[1] || "Other";
}

const CONCEPT_CANONICAL = new Map([
  ["refugee", "Refugee Status"], ["refugee status", "Refugee Status"],
  ["asylum", "Refugee Status"], ["procedural fairness", "Procedural Fairness"],
  ["natural justice", "Procedural Fairness"], ["jurisdictional error", "Jurisdictional Error"],
  ["judicial review", "Judicial Review"], ["merits review", "Judicial Review"],
  ["unreasonableness", "Unreasonableness"], ["character test", "Character Test"],
  ["visa refusal", "Visa Refusal"], ["credibility", "Credibility Assessment"],
  ["evidence", "Evidence"], ["legal representation", "Legal Representation"],
]);

function canonicalConcept(value) {
  const raw = String(value || "").trim().replace(/[.,;:]+$/, "").toLowerCase();
  return CONCEPT_CANONICAL.get(raw) || String(value || "").trim();
}

const TRIBUNAL_CODES = new Set(["AATA", "ARTA", "MRTA", "RRTA"]);
const COURT_CODES = new Set(["FCA", "FCCA", "FMCA", "FedCFamC2G", "HCA"]);
const TRIBUNAL_WIN = new Set(["Remitted", "Set Aside", "Granted", "Quashed"]);
const COURT_WIN = new Set(["Allowed", "Set Aside", "Granted", "Quashed"]);
const ALL_WIN = new Set([...TRIBUNAL_WIN, ...COURT_WIN]);
const EXPORT_FIELDS = Object.freeze([
  "case_id", "citation", "title", "court", "court_code", "date", "year", "url", "judges",
  "catchwords", "outcome", "visa_type", "legislation", "text_snippet", "full_text_path",
  "source", "user_notes", "tags", "case_nature", "legal_concepts", "visa_subclass",
  "visa_class_code", "applicant_name", "respondent", "country_of_origin", "visa_subclass_number",
  "hearing_date", "is_represented", "representative", "visa_outcome_reason",
]);

function isWin(outcome, courtCode) {
  if (TRIBUNAL_CODES.has(courtCode)) return TRIBUNAL_WIN.has(outcome);
  if (COURT_CODES.has(courtCode)) return COURT_WIN.has(outcome);
  return ALL_WIN.has(outcome);
}

function roundRate(wins, total) {
  return total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
}

function jsonOk(body, cacheControl = "no-cache") {
  return Response.json(body, { headers: { "Cache-Control": cacheControl } });
}

function jsonErr(error, status = 400, code = undefined) {
  return Response.json(code ? { error, code } : { error }, { status });
}

async function handleJudgePhoto(path, stores) {
  const match = path.match(JUDGE_PHOTO_PATH_RE);
  if (!match) return null;
  let filename;
  try {
    filename = decodeURIComponent(match[1]);
  } catch {
    return jsonErr("Not found", 404);
  }
  const photo = await stores.objectStore.getJudgePhoto(filename);
  if (!photo) return jsonErr("Not found", 404);
  const headers = new Headers(photo.headers);
  headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
  if (photo.etag) headers.set("ETag", photo.etag);
  return new Response(photo.body, { status: 200, headers });
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function intParam(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function requestFilters(params) {
  return {
    court: (params.get("court") || "").trim(),
    year: intParam(params.get("year"), 0, 0, 3000),
    visa_type: (params.get("visa_type") || "").trim(),
    source: (params.get("source") || "").trim(),
    tag: (params.get("tag") || "").trim(),
    nature: (params.get("nature") || "").trim(),
    // Historical callers use both q and keyword. Keep both normalised at the
    // public boundary before reaching the D1 repository.
    keyword: (params.get("keyword") || params.get("q") || "").trim(),
  };
}

async function handleExport(url, stores, format) {
  const limit = intParam(url.searchParams.get("limit"), 50000, 1, 50000);
  const rows = await stores.caseStore.exportCases({ filters: requestFilters(url.searchParams), limit });
  const values = rows.map((row) => {
    const publicRow = publicCase(row);
    return { ...publicRow, full_text_path: row.content_key || null, visa_outcome_reason: row.visa_outcome_reason || "" };
  });
  const filename = `immigration_cases_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.${format}`;
  if (format === "json") {
    return new Response(JSON.stringify({ cases: values }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
    });
  }
  const lines = ["\uFEFF" + EXPORT_FIELDS.join(",")];
  for (const row of values) lines.push(EXPORT_FIELDS.map((field) => csvCell(row[field])).join(","));
  return new Response(`${lines.join("\n")}\n`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}

function vectorFilters(filters) {
  const result = {};
  if (filters.court) result.court_code = filters.court;
  if (filters.year) result.year = filters.year;
  if (filters.source) result.source = filters.source;
  return result;
}

function publicCase(row) {
  if (!row) return row;
  const { content_key, content_sha256, content_size, semantic_ready, vector_mutation_id, ...response } = row;
  return { ...response, full_text_path: response.full_text_path ?? content_key ?? null };
}

function matchesFromVectorize(result) {
  return Array.isArray(result?.matches) ? result.matches : [];
}

async function vectorCases(caseStore, matches, limit, scoreFor) {
  const seen = new Set();
  const selected = [];
  for (const match of matches) {
    if (!CASE_ID_RE.test(match?.id || "") || seen.has(match.id)) continue;
    seen.add(match.id);
    selected.push(match);
    if (selected.length >= limit) break;
  }
  const rows = await caseStore.findByIds(selected.map((match) => match.id));
  const scores = new Map(selected.map((match, index) => [match.id, scoreFor(match, index)]));
  return rows.map((row) => ({ ...publicCase(row), rank: scores.get(row.case_id) }));
}

function fuseRanks(lexical, semantic) {
  const fused = new Map();
  const add = (items) => items.forEach((item, index) => {
    const id = item.case_id || item.id;
    if (!CASE_ID_RE.test(id || "")) return;
    fused.set(id, (fused.get(id) || 0) + 1 / (60 + index + 1));
  });
  add(lexical);
  add(semantic);
  return [...fused.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id, rank]) => ({ id, rank }));
}

async function handleSearch(url, stores) {
  const q = (url.searchParams.get("q") || "").trim();
  const mode = (url.searchParams.get("mode") || "lexical").toLowerCase();
  const limit = intParam(url.searchParams.get("limit"), 20, 1, 100);
  if (!q) return jsonOk({ cases: [], mode });
  if (q.length < 2) return jsonErr("query too short");
  if (!["lexical", "semantic", "hybrid"].includes(mode)) {
    return jsonErr("Unsupported search mode", 400, "invalid_search_mode");
  }
  const filters = requestFilters(url.searchParams);
  if (mode === "lexical") {
    const cases = (await stores.caseStore.searchLexical({ query: q, filters: {
      court_code: filters.court || undefined,
      year: filters.year || undefined,
      visa_type: filters.visa_type || undefined,
      source: filters.source || undefined,
      case_nature: filters.nature || undefined,
    }, limit })).map(publicCase);
    return jsonOk({ cases, mode });
  }
  const semantic = matchesFromVectorize(await stores.semanticIndex.searchText(q, {
    filters: vectorFilters(filters),
    limit: 100,
  }));
  if (mode === "semantic") {
    const cases = await vectorCases(stores.caseStore, semantic, limit, (match) => Number(match.score || 0));
    return jsonOk({ cases, mode });
  }
  const lexical = await stores.caseStore.searchLexical({ query: q, filters: {
    court_code: filters.court || undefined,
    year: filters.year || undefined,
    visa_type: filters.visa_type || undefined,
    source: filters.source || undefined,
    case_nature: filters.nature || undefined,
  }, limit: 100 });
  const fused = fuseRanks(lexical, semantic);
  const rows = await stores.caseStore.findByIds(fused.slice(0, limit).map((item) => item.id));
  const ranks = new Map(fused.map((item) => [item.id, item.rank]));
  return jsonOk({
    cases: rows.map((row) => ({ ...publicCase(row), rank: ranks.get(row.case_id) })),
    mode,
  });
}

async function handleSemanticSearch(url, stores) {
  const query = (url.searchParams.get("q") || "").trim();
  if (!query) return jsonErr("q parameter is required");
  if (query.length < 3) return jsonErr("q must be at least 3 characters");
  const limit = intParam(url.searchParams.get("limit"), 10, 1, 20);
  const matches = matchesFromVectorize(await stores.semanticIndex.searchText(query, {
    filters: vectorFilters(requestFilters(url.searchParams)),
    limit: Math.min(100, limit * 5),
  }));
  const rows = await vectorCases(stores.caseStore, matches, limit, (match) => Number(match.score || 0));
  return jsonOk({
    results: rows.map((row) => ({
      case_id: row.case_id,
      citation: row.citation || "",
      title: row.title || "",
      outcome: row.outcome || "",
      similarity_score: Number(row.rank || 0),
    })),
    available: true,
    query,
    provider: "cloudflare-workers-ai",
    model: VECTOR_MODEL,
  });
}

async function handleJudgeBio(url, stores) {
  const name = (url.searchParams.get("name") || "").trim();
  if (!name) return jsonErr("name is required");
  const pointer = await stores.caseStore.findJudgeBio(name);
  if (!pointer) return jsonOk({ found: false });
  const bio = await stores.objectStore.getVerifiedJson({
    key: pointer.bio_key,
    sha256: pointer.bio_sha256,
    size: pointer.bio_size,
    contentType: pointer.bio_content_type || "application/json",
  }, {
    prefix: "judges",
    maxBytes: 1024 * 1024,
    label: "Judge biography",
  });
  if (!bio || Array.isArray(bio) || typeof bio !== "object") {
    return jsonErr("Judge biography is invalid", 503, "judge_bio_invalid");
  }
  // Keep the legacy contract's invariant: a returned bio is always found,
  // even if its historical import bookkeeping contains found: false/null.
  return jsonOk({ ...bio, found: true });
}

async function handleFilterOptions(stores) {
  const options = await stores.caseStore.getFilterOptions();
  const values = (name) => options
    .filter((option) => option.filter_name === name)
    .map((option) => name === "year" ? Number(option.option_value) : option.option_value);
  return jsonOk({
    courts: values("court"),
    years: values("year").sort((left, right) => right - left),
    natures: values("case_nature"),
    visa_types: values("visa_type"),
    sources: values("source"),
    outcomes: values("outcome"),
    tags: [],
  }, "public, max-age=300, stale-while-revalidate=60");
}

async function handleStatsTrends(url, stores) {
  const rows = await stores.caseStore.getCourtYearTrends({
    court: (url.searchParams.get("court") || "").trim(),
    yearFrom: intParam(url.searchParams.get("year_from"), 0, 0, 3000),
    yearTo: intParam(url.searchParams.get("year_to"), 0, 0, 3000),
  });
  const byYear = new Map();
  for (const row of rows) {
    const year = Number(row.year);
    if (!byYear.has(year)) byYear.set(year, { year });
    byYear.get(year)[row.court_code] = Number(row.cnt);
  }
  return jsonOk({ trends: [...byYear.values()].sort((left, right) => left.year - right.year) },
    "public, max-age=300, stale-while-revalidate=60");
}

async function handleStats(url, stores) {
  const court = (url.searchParams.get("court") || "").trim();
  const yearFrom = intParam(url.searchParams.get("year_from"), 0, 0, 3000);
  const yearTo = intParam(url.searchParams.get("year_to"), 0, 0, 3000);
  const payload = court || yearFrom || yearTo
    ? await stores.caseStore.getStats({ court, yearFrom, yearTo })
    : await stores.caseStore.getStats();
  if (court || yearFrom || yearTo) {
    const rows = payload.scope_rows || [];
    const totals = (field, { includeEmpty = false } = {}) => {
      const counts = {};
      for (const row of rows) {
        const value = field === "year" ? Number(row.year || 0) : String(row[field] ?? "");
        if (!includeEmpty && (!value || value === "")) continue;
        counts[String(value)] = (counts[String(value)] || 0) + Number(row.cnt || 0);
      }
      return counts;
    };
    const rawVisa = totals("visa_subclass");
    const visaFamilies = {};
    for (const [subclass, count] of Object.entries(rawVisa)) {
      const family = visaFamily(subclass);
      visaFamilies[family] = (visaFamilies[family] || 0) + Number(count || 0);
    }
    return jsonOk({
      total_cases: rows.reduce((sum, row) => sum + Number(row.cnt || 0), 0),
      with_full_text: rows.filter((row) => Number(row.has_full_text) === 1).reduce((sum, row) => sum + Number(row.cnt || 0), 0),
      courts: totals("court_code"), years: totals("year"), natures: totals("case_nature"),
      visa_subclasses: rawVisa, visa_families: visaFamilies, sources: totals("source"),
      recent_cases: payload.recent_cases || [],
    }, "public, max-age=300, stale-while-revalidate=60");
  }

  const visaFamilies = {};
  for (const [subclass, count] of Object.entries(payload.visa_subclasses || {})) {
    const family = visaFamily(subclass);
    visaFamilies[family] = (visaFamilies[family] || 0) + Number(count || 0);
  }
  return jsonOk({ ...payload, visa_families: visaFamilies },
    "public, max-age=300, stale-while-revalidate=60");
}

function handleDataDictionary() {
  return jsonOk({ fields: DATA_DICTIONARY_FIELDS }, "public, max-age=86400");
}

function handleVisaRegistry() {
  return jsonOk(VISA_REGISTRY_API, "public, max-age=86400");
}

function handleLegislationsList(url) {
  const page = Math.max(1, intParam(url.searchParams.get("page"), 1, 1, 9999));
  const limit = Math.min(100, Math.max(1, intParam(url.searchParams.get("limit"), 10, 1, 100)));
  const total = LEGISLATIONS_META.length;
  const pages = Math.ceil(total / limit);
  if (page > pages) return jsonErr(`page must be <= ${pages}`);
  return jsonOk({
    success: true,
    data: LEGISLATIONS_META.slice((page - 1) * limit, page * limit),
    meta: { total, page, limit, pages },
  }, "public, max-age=3600");
}

function handleLegislationsSearch(url) {
  const query = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(100, Math.max(1, intParam(url.searchParams.get("limit"), 20, 1, 100)));
  if (!query || query.length < 2) return jsonErr("q must be at least 2 characters");
  const needle = query.toLowerCase();
  const matches = LEGISLATIONS_META.filter((legislation) =>
    [legislation.title, legislation.description, legislation.shortcode, legislation.id]
      .some((field) => field.toLowerCase().includes(needle)));
  return jsonOk({
    success: true,
    data: matches.slice(0, limit),
    meta: { query, total_results: matches.length, limit },
  }, "public, max-age=3600");
}

async function handleLegislationDetail(path, stores) {
  const match = path.match(/^\/api\/v1\/legislations\/([^/]+)$/);
  if (!match) return null;
  const id = decodeURIComponent(match[1]).trim().toLowerCase();
  if (!id) return jsonErr("legislation_id is required");
  if (id === "search" || id === "update") return null;
  const legislation = LEGISLATIONS_META.find((item) => item.id.toLowerCase() === id);
  if (!legislation) return jsonErr(`Legislation '${id}' not found`, 404);
  const scraped = await stores.objectStore.getLegislation(id);
  // The static catalogue remains a safe metadata fallback until the first
  // native legislation Queue import completes; sections are never fabricated.
  return jsonOk({ success: true, data: scraped || { ...legislation, sections: [] } }, "public, max-age=3600");
}

async function handleTaxonomyLegalConcepts(stores) {
  const rows = await stores.caseStore.analyticsConcepts(100);
  const counts = new Map(rows.map((row) => [String(row.concept || "").toLowerCase(), Number(row.cnt || 0)]));
  const concepts = LEGAL_CONCEPTS.map((concept) => ({
    ...concept,
    case_count: counts.get(concept.name.toLowerCase()) || 0,
  })).sort((left, right) => right.case_count - left.case_count || left.name.localeCompare(right.name));
  return jsonOk({ success: true, concepts, meta: { total_concepts: concepts.length } }, "public, max-age=600");
}

async function handleVisaLookup(url, stores) {
  const query = (url.searchParams.get("q") || "").trim();
  const limit = intParam(url.searchParams.get("limit"), 20, 1, 50);
  if (!query) return jsonErr("q parameter is required");
  const numeric = /^\d+$/.test(query);
  const needle = query.toLowerCase();
  const candidates = Object.entries(VISA_REGISTRY_RAW).flatMap(([subclass, [name, family]]) => {
    const nameLower = name.toLowerCase();
    const exact = numeric ? subclass === query : nameLower === needle;
    const matched = numeric ? exact || subclass.startsWith(query) : nameLower.includes(needle);
    return matched ? [{ subclass, name, family, isExact: exact }] : [];
  });
  const counts = await stores.caseStore.countVisaSubclasses(candidates.map((candidate) => candidate.subclass));
  const data = candidates
    .sort((left, right) => Number(right.isExact) - Number(left.isExact))
    .slice(0, limit)
    .map(({ isExact, ...value }) => ({
      ...value,
      case_count: counts.get(value.subclass) || counts.get(`${value.subclass}.0`) || 0,
    }));
  return jsonOk({
    success: true,
    data,
    meta: { query, total_results: candidates.length, limit },
  });
}

async function handleCountries(url, stores) {
  const limit = intParam(url.searchParams.get("limit"), 30, 1, 200);
  const rows = await stores.caseStore.listCountries(limit);
  const countries = rows.map((row) => ({
    country: row.country,
    name: row.country,
    case_count: Number(row.case_count || 0),
  }));
  return jsonOk({
    success: true,
    countries,
    meta: { total_countries: countries.length, returned_results: countries.length, limit },
  }, "public, max-age=600, stale-while-revalidate=120");
}

async function handleJudgeAutocomplete(url, stores) {
  const query = (url.searchParams.get("q") || "").trim();
  const limit = intParam(url.searchParams.get("limit"), 20, 1, 100);
  if (!query || query.length < 2) {
    return jsonOk({ success: true, judges: [], meta: { query, total_results: 0, limit } });
  }
  const rows = await stores.caseStore.autocompleteJudges(query, limit);
  const judges = rows.map((row) => ({ name: String(row.name).replace(/\s+/g, " ").trim(), case_count: Number(row.case_count || 0) }));
  return jsonOk({ success: true, judges, meta: { query, total_results: judges.length, limit } });
}

async function handleCourtLineage(stores) {
  const rows = await stores.caseStore.getCourtYearTrends();
  const counts = {};
  const years = new Set();
  let totalCases = 0;
  for (const row of rows) {
    const year = Number(row.year);
    if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear() + 5) continue;
    years.add(year);
    const count = Number(row.cnt || 0);
    if (!count || count < 0) continue;
    counts[row.court_code] ||= {};
    counts[row.court_code][year] = (counts[row.court_code][year] || 0) + count;
    totalCases += count;
  }
  const getYears = (code) => ({ ...(counts[code] || {}) });
  const endYear = new Date().getFullYear();
  const lineages = [
    {
      id: "lower-court", name: "Lower Court Lineage",
      courts: [
        { code: "FMCA", name: "Federal Magistrates Court of Australia", years: [2000, 2013], case_count_by_year: getYears("FMCA") },
        { code: "FCCA", name: "Federal Circuit Court of Australia", years: [2013, 2021], case_count_by_year: getYears("FCCA") },
        { code: "FedCFamC2G", name: "Federal Circuit and Family Court of Australia (Division 2)", years: [2021, endYear], case_count_by_year: getYears("FedCFamC2G") },
      ],
      transitions: [
        { from: "FMCA", to: "FCCA", year: 2013, description: "Federal Magistrates Court renamed to Federal Circuit Court of Australia" },
        { from: "FCCA", to: "FedCFamC2G", year: 2021, description: "Federal Circuit Court merged into Federal Circuit and Family Court (Division 2)" },
      ],
    },
    {
      id: "tribunal", name: "Tribunal Lineage",
      courts: [
        { code: "MRTA", name: "Migration Review Tribunal", years: [2000, 2015], case_count_by_year: getYears("MRTA") },
        { code: "RRTA", name: "Refugee Review Tribunal", years: [2000, 2015], case_count_by_year: getYears("RRTA") },
        { code: "AATA", name: "Administrative Appeals Tribunal", years: [2015, 2024], case_count_by_year: getYears("AATA") },
        { code: "ARTA", name: "Administrative Review Tribunal", years: [2024, endYear], case_count_by_year: getYears("ARTA") },
      ],
      transitions: [
        { from: "MRTA", to: "AATA", year: 2015, description: "Migration Review Tribunal merged into Administrative Appeals Tribunal" },
        { from: "RRTA", to: "AATA", year: 2015, description: "Refugee Review Tribunal merged into Administrative Appeals Tribunal" },
        { from: "AATA", to: "ARTA", year: 2024, description: "Administrative Appeals Tribunal replaced by Administrative Review Tribunal" },
      ],
    },
  ];
  const sortedYears = [...years].sort((left, right) => left - right);
  return jsonOk({
    lineages,
    total_cases: totalCases,
    year_range: sortedYears.length ? [sortedYears[0], sortedYears.at(-1)] : [2000, endYear],
  }, "public, max-age=600, stale-while-revalidate=60");
}

async function handleAnalyticsOutcomes(stores) {
  const aggregates = await stores.caseStore.analyticsOutcomes();
  const build = (rows, key) => {
    const result = {};
    for (const row of rows) {
      const group = row[key];
      if (group === null || group === undefined || group === "") continue;
      const outcome = normaliseOutcome(row.outcome);
      result[group] ||= {};
      result[group][outcome] = (result[group][outcome] || 0) + Number(row.cnt || 0);
    }
    return Object.fromEntries(Object.entries(result).sort());
  };
  const bySubclass = build(aggregates.subclass, "visa_subclass");
  return jsonOk({
    by_court: build(aggregates.court, "court_code"),
    by_year: build(aggregates.year, "year_key"),
    by_subclass: Object.fromEntries(Object.entries(bySubclass).sort((left, right) =>
      Object.values(right[1]).reduce((sum, count) => sum + count, 0) - Object.values(left[1]).reduce((sum, count) => sum + count, 0))),
    by_family: {},
  }, "public, max-age=600, stale-while-revalidate=120");
}

async function handleAnalyticsJudges(url, stores) {
  const limit = intParam(url.searchParams.get("limit"), 20, 1, 100);
  const rows = await stores.caseStore.analyticsJudges(limit);
  const judges = rows.map((row) => {
    let courts = [];
    try { courts = JSON.parse(row.courts_json || "[]"); } catch { courts = []; }
    return { name: row.name, display_name: row.name, count: Number(row.count || 0), courts: courts.sort() };
  });
  return jsonOk({ judges }, "public, max-age=600, stale-while-revalidate=120");
}

async function handleAnalyticsLegalConcepts(url, stores) {
  const limit = intParam(url.searchParams.get("limit"), 20, 1, 100);
  const rows = await stores.caseStore.analyticsConcepts(100);
  const counts = new Map();
  for (const row of rows) {
    const concept = canonicalConcept(row.concept);
    if (!concept) continue;
    counts.set(concept, (counts.get(concept) || 0) + Number(row.cnt || 0));
  }
  return jsonOk({ concepts: [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit).map(([name, count]) => ({ name, count })) },
  "public, max-age=600, stale-while-revalidate=120");
}

async function handleAnalyticsNatureOutcome(stores) {
  const rows = await stores.caseStore.analyticsNatureOutcome();
  const natureMap = {};
  for (const row of rows) {
    if (!row.case_nature) continue;
    const outcome = normaliseOutcome(row.outcome);
    natureMap[row.case_nature] ||= {};
    natureMap[row.case_nature][outcome] = (natureMap[row.case_nature][outcome] || 0) + Number(row.cnt || 0);
  }
  const topNatures = Object.entries(natureMap)
    .map(([nature, outcomes]) => [nature, Object.values(outcomes).reduce((sum, count) => sum + count, 0)])
    .sort((left, right) => right[1] - left[1]).slice(0, 20).map(([nature]) => nature);
  const outcomes = [...new Set(topNatures.flatMap((nature) => Object.keys(natureMap[nature])))]
    .sort();
  return jsonOk({
    natures: topNatures,
    outcomes,
    matrix: Object.fromEntries(topNatures.map((nature) => [nature,
      Object.fromEntries(outcomes.map((outcome) => [outcome, natureMap[nature][outcome] || 0]))])),
  });
}

async function handleAnalyticsVisaFamilies(stores) {
  const { subclass } = await stores.caseStore.analyticsOutcomes();
  const totals = {};
  const wins = {};
  for (const row of subclass) {
    const family = visaFamily(row.visa_subclass);
    const count = Number(row.cnt || 0);
    totals[family] = (totals[family] || 0) + count;
    if (isWin(normaliseOutcome(row.outcome), row.court_code || "")) wins[family] = (wins[family] || 0) + count;
  }
  const families = Object.entries(totals).sort((left, right) => right[1] - left[1])
    .map(([family, total]) => ({ family, total, win_count: wins[family] || 0, win_rate: roundRate(wins[family] || 0, total) }));
  return jsonOk({ families, total_cases: Object.values(totals).reduce((sum, value) => sum + value, 0) },
    "public, max-age=600, stale-while-revalidate=120");
}

async function handleAnalyticsMonthlyTrends(stores) {
  const { year: rows } = await stores.caseStore.analyticsOutcomes();
  const byMonth = {};
  for (const row of rows) {
    const month = `${Number(row.year ?? row.year_key)}-01`;
    byMonth[month] ||= { total: 0, wins: 0 };
    const count = Number(row.cnt || 0);
    byMonth[month].total += count;
    if (isWin(normaliseOutcome(row.outcome), row.court_code || "")) byMonth[month].wins += count;
  }
  const series = Object.entries(byMonth).sort(([left], [right]) => left.localeCompare(right))
    .map(([month, values]) => ({ month, total: values.total, wins: values.wins, win_rate: roundRate(values.wins, values.total) }));
  return jsonOk({
    series,
    events: [
      { month: "2015-07", label: "RRTA/MRTA merged into AATA" },
      { month: "2021-09", label: "FCCA → FedCFamC2G restructure" },
      { month: "2024-10", label: "AATA → ARTA transition" },
    ],
  }, "public, max-age=600, stale-while-revalidate=120");
}

async function handleAnalyticsFilterOptions(url, stores) {
  const court = (url.searchParams.get("court") || "").trim();
  const yearFrom = intParam(url.searchParams.get("year_from"), 0, 0, 3000);
  const yearTo = intParam(url.searchParams.get("year_to"), 0, 0, 3000);
  const options = await stores.caseStore.analyticsFilterOptions({ court, yearFrom, yearTo });
  const counts = (items) => items.map((row) => [String(row.value), Number(row.cnt || 0)]);
  const subclasses = counts(options.subclasses);
  return jsonOk({
    query: { court: court || null, year_from: yearFrom || null, year_to: yearTo || null, total_matching: options.total },
    case_natures: counts(options.natures).map(([value, count]) => ({ value, count })),
    visa_subclasses: subclasses.slice(0, 80).map(([value, count]) => {
      const subclass = String(value).replace(/\.0$/, "");
      const entry = VISA_REGISTRY_RAW[subclass];
      return { value, label: entry ? `${subclass} - ${entry[0]}` : `Subclass ${value}`, family: entry?.[1] || "Other", count };
    }),
    outcome_types: counts(options.outcomes).map(([value, count]) => ({ value: normaliseOutcome(value), count })),
  }, "public, max-age=120, stale-while-revalidate=30");
}

async function handleAnalyticsFlowMatrix(url, stores) {
  const topN = intParam(url.searchParams.get("top_n"), 8, 1, 20);
  const rows = await stores.caseStore.analyticsFlowRows();
  const natureCounts = {};
  const outcomeCounts = {};
  for (const row of rows) {
    const nature = String(row.case_nature || "").trim() || "Unknown";
    const outcome = normaliseOutcome(row.outcome);
    const count = Number(row.cnt || 0);
    natureCounts[nature] = (natureCounts[nature] || 0) + count;
    outcomeCounts[outcome] = (outcomeCounts[outcome] || 0) + count;
  }
  const topNatures = new Set(Object.entries(natureCounts).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([name]) => name));
  const topOutcomes = new Set(Object.entries(outcomeCounts).sort((a, b) => b[1] - a[1]).slice(0, topN).map(([name]) => name));
  const courtNature = {};
  const natureOutcome = {};
  for (const row of rows) {
    const court = String(row.court_code || "").trim() || "Unknown";
    const originalNature = String(row.case_nature || "").trim() || "Unknown";
    const nature = topNatures.has(originalNature) ? originalNature : "Other Nature";
    const originalOutcome = normaliseOutcome(row.outcome);
    const outcome = topOutcomes.has(originalOutcome) ? originalOutcome : "Other";
    const count = Number(row.cnt || 0);
    courtNature[`${court}||${nature}`] = (courtNature[`${court}||${nature}`] || 0) + count;
    natureOutcome[`${nature}||${outcome}`] = (natureOutcome[`${nature}||${outcome}`] || 0) + count;
  }
  const nodes = [];
  const nodeIndex = {};
  const addNodes = (prefix, names, layer) => names.forEach((name) => {
    nodeIndex[`${prefix}:${name}`] = nodes.length;
    nodes.push({ name, layer });
  });
  addNodes("court", [...new Set(Object.keys(courtNature).map((key) => key.split("||")[0]))].sort(), "court");
  addNodes("nature", [...new Set([
    ...Object.keys(courtNature).map((key) => key.split("||")[1]),
    ...Object.keys(natureOutcome).map((key) => key.split("||")[0]),
  ])].sort(), "nature");
  addNodes("outcome", [...new Set(Object.keys(natureOutcome).map((key) => key.split("||")[1]))].sort(), "outcome");
  const links = [];
  for (const [key, value] of Object.entries(courtNature)) {
    const [court, nature] = key.split("||");
    links.push({ source: nodeIndex[`court:${court}`], target: nodeIndex[`nature:${nature}`], value });
  }
  for (const [key, value] of Object.entries(natureOutcome)) {
    const [nature, outcome] = key.split("||");
    links.push({ source: nodeIndex[`nature:${nature}`], target: nodeIndex[`outcome:${outcome}`], value });
  }
  return jsonOk({ nodes, links }, "public, max-age=600, stale-while-revalidate=120");
}

async function handleAnalyticsSuccessRate(url, stores) {
  const court = (url.searchParams.get("court") || "").trim();
  const yearFrom = intParam(url.searchParams.get("year_from"), 0, 0, 3000);
  const yearTo = intParam(url.searchParams.get("year_to"), 0, 0, 3000);
  const visaSubclass = (url.searchParams.get("visa_subclass") || "").trim();
  const caseNature = (url.searchParams.get("case_nature") || "").trim();
  const [baseRows, conceptRows] = await Promise.all([
    stores.caseStore.analyticsRateRows({ court, yearFrom, yearTo, visaSubclass, caseNature }),
    (visaSubclass || caseNature) ? Promise.resolve([]) : stores.caseStore.analyticsConceptScope({ court, yearFrom, yearTo }),
  ]);
  let total = 0;
  let wins = 0;
  const yearTotal = {};
  const yearWins = {};
  const courtCodes = new Set();
  for (const row of baseRows) {
    const count = Number(row.cnt || 0);
    const outcome = normaliseOutcome(row.outcome);
    const won = isWin(outcome, row.court_code || "");
    total += count;
    if (won) wins += count;
    if (row.court_code) courtCodes.add(row.court_code);
    if (Number(row.year)) {
      yearTotal[row.year] = (yearTotal[row.year] || 0) + count;
      if (won) yearWins[row.year] = (yearWins[row.year] || 0) + count;
    }
  }
  const overall = roundRate(wins, total);
  const allTribunal = [...courtCodes].length > 0 && [...courtCodes].every((code) => TRIBUNAL_CODES.has(code));
  const allCourt = [...courtCodes].length > 0 && [...courtCodes].every((code) => COURT_CODES.has(code));
  const courtType = allTribunal ? "tribunal" : allCourt ? "court" : "mixed";
  const winOutcomes = allTribunal ? [...TRIBUNAL_WIN] : allCourt ? [...COURT_WIN] : [...ALL_WIN];
  const conceptTotals = {};
  const conceptWins = {};
  for (const row of conceptRows) {
    const concept = canonicalConcept(row.concept);
    if (!concept) continue;
    const count = Number(row.cnt || 0);
    conceptTotals[concept] = (conceptTotals[concept] || 0) + count;
    if (isWin(normaliseOutcome(row.outcome), row.court_code || "")) conceptWins[concept] = (conceptWins[concept] || 0) + count;
  }
  const byConcept = Object.entries(conceptTotals).sort((a, b) => b[1] - a[1]).slice(0, 30)
    .map(([concept, count]) => ({ concept, total: count, win_rate: roundRate(conceptWins[concept] || 0, count), lift: overall > 0 ? Math.round((roundRate(conceptWins[concept] || 0, count) / overall) * 100) / 100 : 0 }));
  const trend = Object.keys(yearTotal).sort((a, b) => Number(a) - Number(b))
    .map((year) => ({ year: Number(year), rate: roundRate(yearWins[year] || 0, yearTotal[year]), count: yearTotal[year] }));
  return jsonOk({
    query: { court: court || null, year_from: yearFrom || null, year_to: yearTo || null, visa_subclass: visaSubclass || null, case_nature: caseNature || null, legal_concepts: [], total_matching: total },
    success_rate: { overall, court_type: courtType, win_outcomes: winOutcomes, win_count: wins, loss_count: Math.max(0, total - wins), confidence: total > 100 ? "high" : total >= 20 ? "medium" : "low" },
    by_concept: byConcept, top_combos: [], trend,
  }, "public, max-age=120, stale-while-revalidate=30");
}

async function handleAnalyticsConceptEffectiveness(url, stores) {
  const limit = intParam(url.searchParams.get("limit"), 30, 1, 100);
  const [baseRows, conceptRows] = await Promise.all([
    stores.caseStore.analyticsRateRows(),
    stores.caseStore.analyticsConceptScope(),
  ]);
  let baseTotal = 0;
  let baseWins = 0;
  for (const row of baseRows) {
    const count = Number(row.cnt || 0);
    baseTotal += count;
    if (isWin(normaliseOutcome(row.outcome), row.court_code || "")) baseWins += count;
  }
  const baselineRate = roundRate(baseWins, baseTotal);
  const totals = {};
  const wins = {};
  const byCourt = {};
  for (const row of conceptRows) {
    const concept = canonicalConcept(row.concept);
    if (!concept) continue;
    const count = Number(row.cnt || 0);
    totals[concept] = (totals[concept] || 0) + count;
    if (isWin(normaliseOutcome(row.outcome), row.court_code || "")) wins[concept] = (wins[concept] || 0) + count;
    if (row.court_code) {
      byCourt[concept] ||= {};
      byCourt[concept][row.court_code] ||= { total: 0, wins: 0 };
      byCourt[concept][row.court_code].total += count;
      if (isWin(normaliseOutcome(row.outcome), row.court_code || "")) byCourt[concept][row.court_code].wins += count;
    }
  }
  const concepts = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, total]) => {
    const winRate = roundRate(wins[name] || 0, total);
    return {
      name, total, win_rate: winRate,
      lift: baselineRate > 0 ? Math.round((winRate / baselineRate) * 100) / 100 : 0,
      by_court: Object.fromEntries(Object.entries(byCourt[name] || {}).map(([court, values]) => [court, { total: values.total, win_rate: roundRate(values.wins, values.total) }])),
    };
  });
  return jsonOk({ baseline_rate: baselineRate, concepts }, "public, max-age=600, stale-while-revalidate=120");
}

async function handleAnalyticsConceptCooccurrence(url, stores) {
  const limit = intParam(url.searchParams.get("limit"), 15, 2, 30);
  const minCount = intParam(url.searchParams.get("min_count"), 50, 1, 1000000);
  const [baseRows, pairRows] = await Promise.all([
    stores.caseStore.analyticsRateRows(),
    stores.caseStore.analyticsConceptPairs(),
  ]);
  let baseTotal = 0;
  let baseWins = 0;
  for (const row of baseRows) {
    const count = Number(row.cnt || 0);
    baseTotal += count;
    if (isWin(normaliseOutcome(row.outcome), row.court_code || "")) baseWins += count;
  }
  const baselineRate = roundRate(baseWins, baseTotal);
  const conceptCounts = {};
  const pairTotals = {};
  const pairWins = {};
  for (const row of pairRows) {
    const a = canonicalConcept(row.concept_a);
    const b = canonicalConcept(row.concept_b);
    if (!a || !b || a === b) continue;
    const [left, right] = a < b ? [a, b] : [b, a];
    const key = `${left}|||${right}`;
    const count = Number(row.cnt || 0);
    pairTotals[key] = (pairTotals[key] || 0) + count;
    if (isWin(normaliseOutcome(row.outcome), row.court_code || "")) pairWins[key] = (pairWins[key] || 0) + count;
    conceptCounts[left] = (conceptCounts[left] || 0) + count;
    conceptCounts[right] = (conceptCounts[right] || 0) + count;
  }
  const concepts = Object.entries(conceptCounts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name]) => name);
  const matrix = {};
  const topPairs = [];
  for (const [key, count] of Object.entries(pairTotals)) {
    if (count < minCount) continue;
    const [a, b] = key.split("|||");
    const winRate = roundRate(pairWins[key] || 0, count);
    const cell = { count, win_rate: winRate };
    (matrix[a] ||= {})[b] = cell;
    (matrix[b] ||= {})[a] = cell;
    topPairs.push({ a, b, count, win_rate: winRate, lift: baselineRate > 0 ? Math.round((winRate / baselineRate) * 100) / 100 : 0 });
  }
  topPairs.sort((a, b) => b.count - a.count);
  return jsonOk({ concepts, matrix, top_pairs: topPairs }, "public, max-age=600, stale-while-revalidate=120");
}

async function handleAnalyticsConceptTrends(url, stores) {
  const limit = intParam(url.searchParams.get("limit"), 10, 1, 30);
  const rows = await stores.caseStore.analyticsConceptScope();
  const frequency = {};
  const yearTotals = {};
  const yearWins = {};
  for (const row of rows) {
    const concept = canonicalConcept(row.concept);
    if (!concept || !Number(row.year)) continue;
    const count = Number(row.cnt || 0);
    frequency[concept] = (frequency[concept] || 0) + count;
    yearTotals[concept] ||= {};
    yearWins[concept] ||= {};
    yearTotals[concept][row.year] = (yearTotals[concept][row.year] || 0) + count;
    if (isWin(normaliseOutcome(row.outcome), row.court_code || "")) yearWins[concept][row.year] = (yearWins[concept][row.year] || 0) + count;
  }
  const tracked = Object.entries(frequency).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name]) => name);
  const allYears = [...new Set(rows.map((row) => Number(row.year)).filter(Boolean))].sort((a, b) => a - b);
  const latest = allYears.at(-1) || 0;
  const recentYears = new Set([latest, latest - 1]);
  const previousYears = new Set([latest - 2, latest - 3]);
  const series = {};
  const emerging = [];
  const declining = [];
  for (const concept of tracked) {
    const totals = yearTotals[concept] || {};
    const wins = yearWins[concept] || {};
    series[concept] = Object.keys(totals).sort((a, b) => Number(a) - Number(b)).map((year) => ({ year: Number(year), count: totals[year], win_rate: roundRate(wins[year] || 0, totals[year]) }));
    const recent = [...recentYears].reduce((sum, year) => sum + (totals[year] || 0), 0);
    const previous = [...previousYears].reduce((sum, year) => sum + (totals[year] || 0), 0);
    if (!recent && !previous) continue;
    const growth = previous === 0 ? (recent > 0 ? 100 : 0) : Math.round(((recent - previous) / previous) * 1000) / 10;
    if (growth > 25) emerging.push({ name: concept, growth_pct: growth, recent_count: recent });
    if (growth < -25) declining.push({ name: concept, decline_pct: growth, recent_count: recent });
  }
  emerging.sort((a, b) => b.growth_pct - a.growth_pct);
  declining.sort((a, b) => a.decline_pct - b.decline_pct);
  return jsonOk({ series, emerging, declining }, "public, max-age=600, stale-while-revalidate=120");
}

async function handleAnalyticsJudgeLeaderboard(url, stores) {
  const sortBy = url.searchParams.get("sort_by") || "cases";
  const nameQ = (url.searchParams.get("name_q") || "").trim().toLowerCase();
  const court = (url.searchParams.get("court") || "").trim();
  const limit = intParam(url.searchParams.get("limit"), 50, 1, 200);
  const minCases = intParam(url.searchParams.get("min_cases"), 1, 1, 100000);
  if (!["cases", "approval_rate", "name"].includes(sortBy)) return jsonErr("Invalid sort_by. Allowed: approval_rate, cases, name");
  const aggregate = await stores.caseStore.analyticsJudgeAggregate();
  const judges = new Map();
  for (const row of aggregate.outcomes) {
    if (court && row.court_code !== court) continue;
    const key = row.judge_id;
    const judge = judges.get(key) || { name: row.name, total: 0, wins: 0, courts: new Set(), outcomes: {}, activeYears: { first: null, last: null }, visas: new Map() };
    const count = Number(row.cnt || 0);
    judge.total += count;
    judge.wins += isWin(normaliseOutcome(row.outcome), row.court_code || "") ? count : 0;
    if (row.court_code) judge.courts.add(row.court_code);
    const outcome = normaliseOutcome(row.outcome);
    judge.outcomes[outcome] = (judge.outcomes[outcome] || 0) + count;
    judges.set(key, judge);
  }
  if (!court) {
    for (const row of aggregate.years) {
      const judge = judges.get(row.judge_id);
      if (!judge) continue;
      const year = Number(row.year);
      if (!year) continue;
      judge.activeYears.first = judge.activeYears.first === null ? year : Math.min(judge.activeYears.first, year);
      judge.activeYears.last = judge.activeYears.last === null ? year : Math.max(judge.activeYears.last, year);
    }
    for (const row of aggregate.visas) {
      const judge = judges.get(row.judge_id);
      if (!judge) continue;
      judge.visas.set(row.visa_subclass, (judge.visas.get(row.visa_subclass) || 0) + Number(row.cnt || 0));
    }
  }
  let result = [...judges.values()]
    .filter((judge) => judge.total >= minCases && (!nameQ || judge.name.toLowerCase().includes(nameQ)))
    .map((judge) => ({
      name: judge.name, display_name: judge.name, total_cases: judge.total,
      approval_rate: roundRate(judge.wins, judge.total), courts: [...judge.courts].sort(),
      primary_court: [...judge.courts].sort()[0] || null,
      top_visa_subclasses: [...judge.visas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([subclass, count]) => ({ subclass, count })),
      active_years: judge.activeYears, outcome_summary: judge.outcomes,
    }));
  if (sortBy === "approval_rate") result.sort((a, b) => b.approval_rate - a.approval_rate || b.total_cases - a.total_cases);
  else if (sortBy === "name") result.sort((a, b) => a.name.localeCompare(b.name));
  else result.sort((a, b) => b.total_cases - a.total_cases || b.approval_rate - a.approval_rate);
  return jsonOk({ judges: result.slice(0, limit), total_judges: result.length }, "public, max-age=600, stale-while-revalidate=120");
}

function buildJudgeProfilePayload(name, caseRows, courtBaselines = {}) {
  if (!caseRows.length) {
    return {
      judge: { name, canonical_name: name, total_cases: 0, courts: [], active_years: { first: null, last: null } },
      approval_rate: 0, court_type: "unknown", outcome_distribution: {}, visa_breakdown: [],
      concept_effectiveness: [], yearly_trend: [], nature_breakdown: [], representation_analysis: { unknown_count: 0 },
      country_breakdown: [], court_comparison: [], recent_3yr_trend: [], recent_cases: [],
    };
  }
  const totals = { outcomes: {}, courts: {}, years: {}, yearWins: {}, visas: {}, visaWins: {}, natures: {}, natureWins: {}, concepts: {}, conceptWins: {}, countries: {}, countryWins: {}, representation: {}, representationWins: {}, courtWins: {} };
  const years = [];
  for (const row of caseRows) {
    const count = 1;
    const outcome = normaliseOutcome(row.outcome);
    const won = isWin(outcome, row.court_code || "");
    totals.outcomes[outcome] = (totals.outcomes[outcome] || 0) + count;
    if (row.court_code) totals.courts[row.court_code] = (totals.courts[row.court_code] || 0) + count;
    if (Number(row.year)) {
      years.push(Number(row.year));
      totals.years[row.year] = (totals.years[row.year] || 0) + count;
      if (won) totals.yearWins[row.year] = (totals.yearWins[row.year] || 0) + count;
    }
    const subclass = String(row.visa_subclass || "").replace(/\.0$/, "");
    if (subclass) { totals.visas[subclass] = (totals.visas[subclass] || 0) + count; if (won) totals.visaWins[subclass] = (totals.visaWins[subclass] || 0) + count; }
    const nature = String(row.case_nature || "").trim();
    if (nature) { totals.natures[nature] = (totals.natures[nature] || 0) + count; if (won) totals.natureWins[nature] = (totals.natureWins[nature] || 0) + count; }
    for (const raw of String(row.legal_concepts || "").split(/[;,]/)) {
      const concept = canonicalConcept(raw);
      if (!concept) continue;
      totals.concepts[concept] = (totals.concepts[concept] || 0) + count;
      if (won) totals.conceptWins[concept] = (totals.conceptWins[concept] || 0) + count;
    }
    const representation = ["yes", "true", "1", "represented"].includes(String(row.is_represented ?? "").toLowerCase()) ? "represented"
      : ["no", "false", "0", "unrepresented", "self"].includes(String(row.is_represented ?? "").toLowerCase()) ? "self_represented" : null;
    if (representation) { totals.representation[representation] = (totals.representation[representation] || 0) + count; if (won) totals.representationWins[representation] = (totals.representationWins[representation] || 0) + count; }
    const country = String(row.country_of_origin || "").trim();
    if (country) { totals.countries[country] = (totals.countries[country] || 0) + count; if (won) totals.countryWins[country] = (totals.countryWins[country] || 0) + count; }
    if (row.court_code && won) totals.courtWins[row.court_code] = (totals.courtWins[row.court_code] || 0) + count;
  }
  const total = caseRows.length;
  const courts = Object.keys(totals.courts).sort();
  const allTribunal = courts.length > 0 && courts.every((code) => TRIBUNAL_CODES.has(code));
  const allCourt = courts.length > 0 && courts.every((code) => COURT_CODES.has(code));
  const courtType = allTribunal ? "tribunal" : allCourt ? "court" : "mixed";
  let wins = 0;
  for (const row of caseRows) if (isWin(normaliseOutcome(row.outcome), row.court_code || "")) wins++;
  const rate = roundRate(wins, total);
  const yearlyTrend = Object.keys(totals.years).sort((a, b) => Number(a) - Number(b)).map((year) => ({ year: Number(year), total: totals.years[year], approval_rate: roundRate(totals.yearWins[year] || 0, totals.years[year]) }));
  const representationAnalysis = Object.fromEntries(Object.entries(totals.representation).map(([key, count]) => [key, { total: count, win_rate: roundRate(totals.representationWins[key] || 0, count) }]));
  representationAnalysis.unknown_count = total - Object.values(totals.representation).reduce((sum, count) => sum + count, 0);
  const courtComparison = courts.flatMap((code) => {
    if (courtBaselines[code] === undefined) return [];
    const judgeRate = roundRate(totals.courtWins[code] || 0, totals.courts[code]);
    return [{ court_code: code, judge_rate: judgeRate, court_avg_rate: courtBaselines[code], delta: Math.round((judgeRate - courtBaselines[code]) * 10) / 10, judge_total: totals.courts[code] }];
  });
  return {
    judge: { name, canonical_name: name, total_cases: total, courts, active_years: { first: years.length ? Math.min(...years) : null, last: years.length ? Math.max(...years) : null } },
    approval_rate: rate, court_type: courtType, outcome_distribution: totals.outcomes,
    visa_breakdown: Object.entries(totals.visas).sort((a, b) => b[1] - a[1]).map(([subclass, count]) => ({ subclass, total: count, win_rate: roundRate(totals.visaWins[subclass] || 0, count) })),
    concept_effectiveness: Object.entries(totals.concepts).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([concept, count]) => ({ concept, total: count, win_rate: roundRate(totals.conceptWins[concept] || 0, count), baseline_rate: rate, lift: rate > 0 ? Math.round((roundRate(totals.conceptWins[concept] || 0, count) / rate) * 100) / 100 : 0 })),
    yearly_trend: yearlyTrend,
    nature_breakdown: Object.entries(totals.natures).sort((a, b) => b[1] - a[1]).map(([nature, count]) => ({ nature, total: count, win_rate: roundRate(totals.natureWins[nature] || 0, count) })),
    representation_analysis: representationAnalysis,
    country_breakdown: Object.entries(totals.countries).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([country, count]) => ({ country, total: count, win_rate: roundRate(totals.countryWins[country] || 0, count) })),
    court_comparison: courtComparison,
    recent_3yr_trend: yearlyTrend.filter((row) => !years.length || row.year >= Math.max(...years) - 2),
    recent_cases: [...caseRows].slice(0, 10).map((row) => ({ case_id: row.case_id, citation: row.citation, title: row.title, outcome: row.outcome, court_code: row.court_code, date: row.date || null })),
  };
}

async function handleAnalyticsJudgeProfile(url, stores) {
  const name = (url.searchParams.get("name") || "").trim();
  if (!name) return jsonErr("name query parameter is required");
  const cases = await stores.caseStore.getJudgeCases(name, { limit: 5000 });
  const courts = [...new Set(cases.map((row) => row.court_code).filter(Boolean))];
  const baselineRows = await stores.caseStore.getJudgeCourtBaselines(courts);
  const baseTotals = {};
  const baseWins = {};
  for (const row of baselineRows) {
    const count = Number(row.cnt || 0);
    baseTotals[row.court_code] = (baseTotals[row.court_code] || 0) + count;
    if (isWin(normaliseOutcome(row.outcome), row.court_code || "")) baseWins[row.court_code] = (baseWins[row.court_code] || 0) + count;
  }
  const baselines = Object.fromEntries(Object.keys(baseTotals).map((code) => [code, roundRate(baseWins[code] || 0, baseTotals[code])]));
  return jsonOk(buildJudgeProfilePayload(name, cases, baselines), "public, max-age=300, stale-while-revalidate=60");
}

async function handleAnalyticsJudgeCompare(url, stores) {
  const names = (url.searchParams.get("names") || "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 4);
  if (names.length < 2) return jsonErr("At least two judge names are required");
  const judges = await Promise.all(names.map(async (name) => buildJudgeProfilePayload(name, await stores.caseStore.getJudgeCases(name, { limit: 3000 }))));
  return jsonOk({ judges }, "public, max-age=300, stale-while-revalidate=60");
}

/**
 * Return a Response only for a Cloudflare-native route; return null for a
 * route not yet reimplemented. The eventual activation gate must assert that
 * every public route resolves here before cloudflare mode is traffic-serving.
 */
export async function dispatchCloudflareCaseRead(url, path, env) {
  if (getStorageMode(env) !== "cloudflare") return null;
  if (path === "/api/v1/legislations/update/status") {
    try {
      const command = await createCloudflareStores(env).pipelineStore.latestControlCommand("legislation_update");
      let payload = {};
      try { payload = command?.payload_json ? JSON.parse(command.payload_json) : {}; } catch { payload = {}; }
      const laws = Array.isArray(payload.law_ids) ? payload.law_ids : [];
      const running = command?.status === "queued" || command?.status === "running";
      return jsonOk({
        success: true,
        status: {
          running,
          law_id: running ? laws[0] || null : null,
          current: command?.status === "completed" ? laws.length : 0,
          total: laws.length,
          section_id: "",
          completed_laws: command?.status === "completed" ? laws : [],
          failed_laws: command?.status === "failed" ? laws : [],
          error: command?.error || null,
        },
        native: true,
      }, "no-store");
    } catch (error) {
      if (error instanceof StorageBoundaryError) return jsonErr(error.message, error.status, error.code);
      return jsonErr("Legislation status unavailable", 503, "legislation_status_unavailable");
    }
  }
  try {
    const stores = createCloudflareStores(env);
    if (path.startsWith("/api/v1/judge-photo/") && url.pathname === path) {
      return handleJudgePhoto(path, stores);
    }
    if (path === "/api/v1/stats") return handleStats(url, stores);
    if (path === "/api/v1/export/csv") return handleExport(url, stores, "csv");
    if (path === "/api/v1/export/json") return handleExport(url, stores, "json");
    if (path === "/api/v1/analytics/judge-bio") return handleJudgeBio(url, stores);
    if (path === "/api/v1/filter-options") return handleFilterOptions(stores);
    if (path === "/api/v1/stats/trends") return handleStatsTrends(url, stores);
    if (path === "/api/v1/data-dictionary") return handleDataDictionary();
    if (path === "/api/v1/visa-registry") return handleVisaRegistry();
    if (path === "/api/v1/taxonomy/visa-lookup") return handleVisaLookup(url, stores);
    if (path === "/api/v1/taxonomy/legal-concepts") return handleTaxonomyLegalConcepts(stores);
    if (path === "/api/v1/taxonomy/countries") return handleCountries(url, stores);
    if (path === "/api/v1/taxonomy/judges/autocomplete") return handleJudgeAutocomplete(url, stores);
    if (path === "/api/v1/court-lineage") return handleCourtLineage(stores);
    if (path === "/api/v1/analytics/outcomes") return handleAnalyticsOutcomes(stores);
    if (path === "/api/v1/analytics/judges") return handleAnalyticsJudges(url, stores);
    if (path === "/api/v1/analytics/legal-concepts") return handleAnalyticsLegalConcepts(url, stores);
    if (path === "/api/v1/analytics/nature-outcome") return handleAnalyticsNatureOutcome(stores);
    if (path === "/api/v1/analytics/visa-families") return handleAnalyticsVisaFamilies(stores);
    if (path === "/api/v1/analytics/monthly-trends") return handleAnalyticsMonthlyTrends(stores);
    if (path === "/api/v1/analytics/filter-options") return handleAnalyticsFilterOptions(url, stores);
    if (path === "/api/v1/analytics/flow-matrix") return handleAnalyticsFlowMatrix(url, stores);
    if (path === "/api/v1/analytics/success-rate") return handleAnalyticsSuccessRate(url, stores);
    if (path === "/api/v1/analytics/concept-effectiveness") return handleAnalyticsConceptEffectiveness(url, stores);
    if (path === "/api/v1/analytics/concept-cooccurrence") return handleAnalyticsConceptCooccurrence(url, stores);
    if (path === "/api/v1/analytics/concept-trends") return handleAnalyticsConceptTrends(url, stores);
    if (path === "/api/v1/analytics/judge-leaderboard") return handleAnalyticsJudgeLeaderboard(url, stores);
    if (path === "/api/v1/analytics/judge-profile") return handleAnalyticsJudgeProfile(url, stores);
    if (path === "/api/v1/analytics/judge-compare") return handleAnalyticsJudgeCompare(url, stores);
    if (path === "/api/v1/legislations" || path === "/api/v1/legislations/") return handleLegislationsList(url);
    if (path === "/api/v1/legislations/search") return handleLegislationsSearch(url);
    if (path.startsWith("/api/v1/legislations/")) return handleLegislationDetail(path, stores);
    if (path === "/api/v1/cases") {
      const response = await stores.caseStore.listPage({
        filters: requestFilters(url.searchParams),
        sortBy: url.searchParams.get("sort_by") || "date",
        sortDir: url.searchParams.get("sort_dir") || "desc",
        page: url.searchParams.get("page") || 1,
        pageSize: url.searchParams.get("page_size") || 100,
      });
      return jsonOk({ ...response, cases: response.cases.map(publicCase), count_mode: "exact" },
        "public, max-age=30, stale-while-revalidate=10");
    }
    if (path === "/api/v1/cases/count") {
      return jsonOk({ total: await stores.caseStore.countCompat(requestFilters(url.searchParams)), count_mode: "exact" });
    }
    if (path === "/api/v1/search") return handleSearch(url, stores);
    if (path === "/api/v1/search/semantic") return handleSemanticSearch(url, stores);
    if (path === "/api/v1/cases/compare") {
      const ids = url.searchParams.getAll("ids").filter((id) => CASE_ID_RE.test(id));
      if (ids.length < 2) return jsonErr("At least 2 valid case IDs required");
      if (ids.length > 4) return jsonErr("Maximum 4 cases can be compared");
      const cases = (await stores.caseStore.findByIds(ids)).map(publicCase);
      if (cases.length < 2) return jsonErr("Could not find enough cases", 404);
      return jsonOk({ cases });
    }
    const related = path.match(/^\/api\/v1\/cases\/([0-9a-f]{12})\/related$/);
    if (related) {
      const cases = await stores.caseStore.relatedCompat(related[1], { limit: intParam(url.searchParams.get("limit"), 5, 1, 20) });
      if (cases === null) return jsonErr("Case not found", 404);
      return jsonOk({ cases: cases.map(({ related_score, ...row }) => publicCase(row)) });
    }
    const similar = path.match(/^\/api\/v1\/cases\/([0-9a-f]{12})\/similar$/);
    if (similar) {
      const limit = intParam(url.searchParams.get("limit"), 10, 1, 50);
      const anchor = await stores.caseStore.getCase(similar[1]);
      if (!anchor || !anchor.semantic_ready) return jsonOk({ similar: [], available: false });
      const matches = matchesFromVectorize(await stores.semanticIndex.relatedById(similar[1], { limit: limit + 1 }));
      const rows = await vectorCases(stores.caseStore, matches.filter((match) => match.id !== similar[1]), limit,
        (match) => Number(match.score || 0));
      return jsonOk({
        similar: rows.map((row) => ({
          case_id: row.case_id,
          citation: row.citation,
          title: row.title,
          outcome: row.outcome,
          similarity_score: row.rank,
        })),
        available: true,
      });
    }
    const detail = path.match(/^\/api\/v1\/cases\/([^/]+)$/);
    if (detail) {
      if (!CASE_ID_RE.test(detail[1])) return jsonErr("Invalid case ID");
      const record = await stores.caseStore.getCase(detail[1]);
      if (!record) return jsonErr("Case not found", 404);
      let fullText = null;
      if (record.content_key) {
        fullText = await stores.objectStore.getVerifiedText({
          key: record.content_key,
          sha256: record.content_sha256,
          size: record.content_size,
          contentType: "text/plain; charset=utf-8",
        }, {
          prefix: "cases",
          maxBytes: 16 * 1024 * 1024,
          label: "Case source",
        });
      }
      return jsonOk({ case: publicCase(record), full_text: fullText });
    }
    return null;
  } catch (err) {
    if (err instanceof StorageBoundaryError) return jsonErr(err.message, err.status, err.code);
    console.error(JSON.stringify({ event: "case.cloudflare.read_error", error: err?.message }));
    return jsonErr("Case service unavailable", 503, "case_store_unavailable");
  }
}
