/**
 * Cloudflare-native repository implementations.
 *
 * This module owns all D1/R2/Vectorize/Workers AI binding access. Council
 * storage activates only under the explicit `cloudflare` mode; all other
 * public API paths remain legacy until their contract, reconciliation and
 * rollback gates pass.
 */

import {
  assertAuthContext,
  assertCaseId,
  assertCloudflareBindings,
  assertCloudflareRuntimeMode,
  assertObjectKey,
  assertObjectPointer,
  assertSha256,
  assertUuid,
  clampLimit,
  D1_MAX_BOUND_PARAMETERS,
  FTS_CHUNK_MAX_BYTES,
  sha256Hex,
  StorageBoundaryError,
  textBytes,
  toFtsMatch,
  utcNow,
  VECTOR_DIMENSIONS,
  VECTOR_MODEL,
} from "./contracts.js";

const VECTOR_FILTER_KEYS = new Set(["court_code", "year", "source", "visa_subclass"]);
const MAX_COUNCIL_PAYLOAD_BYTES = 8 * 1024 * 1024;
const JUDGE_PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const JUDGE_PHOTO_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function requireD1(binding, name) {
  if (!binding || typeof binding.prepare !== "function") {
    throw new StorageBoundaryError(`${name} D1 binding is unavailable`, {
      code: "missing_cloudflare_binding",
      status: 503,
    });
  }
  return binding;
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function changeCount(result) {
  return Number(result?.meta?.changes || 0);
}

function bindAll(database, sql, params) {
  if (params.length > D1_MAX_BOUND_PARAMETERS) {
    throw new StorageBoundaryError("D1 statement exceeds the 100-parameter limit", {
      code: "d1_parameter_limit",
      status: 500,
    });
  }
  return database.prepare(sql).bind(...params);
}

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

const COMPAT_SORT_COLUMNS = Object.freeze({
  date: "c.year",
  title: "c.title",
  court: "c.court_code",
  outcome: "c.outcome",
  visa_subclass_number: "c.visa_subclass_number",
  applicant_name: "c.applicant_name",
  hearing_date: "c.hearing_date",
  case_id: "c.case_id",
  citation: "c.citation",
});

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

function contentKeyFor({ kind, caseId, tenantId, sessionId, turnId, checksum, extension }) {
  assertSha256(checksum);
  if (kind === "case") return `cases/${assertCaseId(caseId)}/source/${checksum}.${extension || "txt"}`;
  if (kind === "council") return `council/${tenantId}/${sessionId}/${turnId}.${extension || "json"}`;
  if (kind === "import") return `imports/${sessionId}/${caseId}/${turnId}.${extension || "ndjson"}`;
  throw new StorageBoundaryError(`Unsupported object kind: ${kind}`, { code: "invalid_object_kind", status: 400 });
}

function assertTelegramId(value) {
  const id = String(value ?? "");
  if (!/^[1-9][0-9]{0,19}$/.test(id)) {
    throw new StorageBoundaryError("Telegram user id is invalid", {
      code: "invalid_telegram_id",
      status: 400,
    });
  }
  return id;
}

function asJwtTelegramId(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : String(value);
}

function refreshSessionError(message, code) {
  return new StorageBoundaryError(message, { code, status: 401 });
}

function refreshDraftValues(draft) {
  const jti = assertUuid(draft?.jti, "refresh.jti");
  const userId = assertUuid(draft?.userId, "refresh.userId");
  const familyId = assertUuid(draft?.familyId, "refresh.familyId");
  const expiresAt = new Date(draft?.expiresAt);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new StorageBoundaryError("Refresh session expiry is invalid", {
      code: "invalid_refresh_session",
      status: 400,
    });
  }
  return { jti, userId, familyId, expiresAt: expiresAt.toISOString() };
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

export class CloudflareObjectStore {
  constructor(env) {
    this.bucket = env.IMMI_CONTENT;
  }

  /** Upload first, verify the immutable pointer, then let a D1 store commit it. */
  async putVerified({ key, body, contentType }) {
    const checkedKey = assertObjectKey(key);
    if (typeof contentType !== "string" || contentType.length === 0 || contentType.length > 255) {
      throw new StorageBoundaryError("contentType is invalid", { code: "invalid_object_pointer", status: 400 });
    }
    const { bytes, digest, hex } = await sha256Hex(body);
    const object = await this.bucket.put(checkedKey, bytes, {
      sha256: digest,
      httpMetadata: { contentType },
      customMetadata: { sha256: hex, bytes: String(bytes.byteLength) },
    });
    if (!object || object.size !== bytes.byteLength) {
      throw new StorageBoundaryError("R2 upload size verification failed", {
        code: "r2_verification_failed",
        status: 503,
      });
    }
    const head = await this.bucket.head(checkedKey);
    if (!head || head.size !== bytes.byteLength || head.customMetadata?.sha256 !== hex) {
      throw new StorageBoundaryError("R2 object checksum pointer verification failed", {
        code: "r2_verification_failed",
        status: 503,
      });
    }
    return Object.freeze({ key: checkedKey, sha256: hex, size: bytes.byteLength, contentType });
  }

  async putCaseSource({ caseId, body, contentType = "text/plain; charset=utf-8" }) {
    const { hex } = await sha256Hex(body);
    return this.putVerified({
      key: contentKeyFor({ kind: "case", caseId, checksum: hex, extension: "txt" }),
      body,
      contentType,
    });
  }

  async putCouncilPayload({ auth, sessionId, turnId, payload }) {
    const context = assertAuthContext(auth);
    const encoded = JSON.stringify(payload);
    const key = contentKeyFor({
      kind: "council",
      tenantId: context.tenantId,
      sessionId,
      turnId,
      checksum: "0".repeat(64),
      extension: "json",
    });
    return this.putVerified({ key, body: encoded, contentType: "application/json" });
  }

  async getVerifiedJson(pointer, {
    prefix = "council",
    maxBytes = MAX_COUNCIL_PAYLOAD_BYTES,
    label = "JSON payload",
  } = {}) {
    const checked = assertObjectPointer(pointer, prefix);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new StorageBoundaryError("R2 retrieval limit is invalid", {
        code: "invalid_object_pointer",
        status: 500,
      });
    }
    if (checked.size > maxBytes) {
      throw new StorageBoundaryError(`${label} exceeds the Worker retrieval safety limit`, {
        code: "r2_payload_too_large",
        status: 503,
      });
    }
    const object = await this.bucket.get(checked.key);
    if (!object || typeof object.json !== "function") {
      throw new StorageBoundaryError(`${label} object is missing`, {
        code: "r2_payload_missing",
        status: 503,
      });
    }
    if (object.size !== checked.size || object.customMetadata?.sha256 !== checked.sha256) {
      throw new StorageBoundaryError(`${label} checksum pointer verification failed`, {
        code: "r2_verification_failed",
        status: 503,
      });
    }
    return object.json();
  }

  async getVerifiedText(pointer, {
    prefix = "cases",
    maxBytes = 512 * 1024,
    label = "Case source",
  } = {}) {
    const checked = assertObjectPointer(pointer, prefix);
    if (checked.size > maxBytes) {
      throw new StorageBoundaryError(`${label} exceeds the Worker retrieval safety limit`, {
        code: "r2_payload_too_large",
        status: 503,
      });
    }
    const object = await this.bucket.get(checked.key);
    if (!object || typeof object.arrayBuffer !== "function") {
      throw new StorageBoundaryError(`${label} object is missing`, { code: "r2_payload_missing", status: 503 });
    }
    if (object.size !== checked.size || object.customMetadata?.sha256 !== checked.sha256) {
      throw new StorageBoundaryError(`${label} checksum pointer verification failed`, { code: "r2_verification_failed", status: 503 });
    }
    return new TextDecoder().decode(await object.arrayBuffer());
  }

  /** Delete an immutable object only through its validated pointer. */
  async deleteVerified(pointer, { prefix = "cases" } = {}) {
    const checked = assertObjectPointer(pointer, prefix);
    if (!this.bucket || typeof this.bucket.delete !== "function") {
      throw new StorageBoundaryError("R2 delete binding is unavailable", {
        code: "r2_delete_unavailable",
        status: 503,
      });
    }
    await this.bucket.delete(checked.key);
    return checked.key;
  }

  /**
   * Return an imported judge portrait from the native content bucket.
   *
   * Photos are immutable migration artifacts rather than catalog rows. The
   * importer stores them under `judge-photos/` with R2 checksum metadata; the
   * public handler only receives the validated body and response metadata.
   */
  async getJudgePhoto(filename) {
    if (typeof filename !== "string" || !JUDGE_PHOTO_NAME_RE.test(filename)) return null;
    const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    if (!JUDGE_PHOTO_EXTS.has(extension)) return null;
    const object = await this.bucket.get(assertObjectKey(`judge-photos/${filename}`, "judge-photos"));
    if (!object || !object.body) return null;
    const checksum = object.customMetadata?.sha256;
    if (typeof checksum !== "string" || !/^[0-9a-f]{64}$/.test(checksum)) {
      throw new StorageBoundaryError("Judge photo checksum metadata is missing", {
        code: "r2_verification_failed",
        status: 503,
      });
    }
    const headers = new Headers();
    if (typeof object.writeHttpMetadata === "function") object.writeHttpMetadata(headers);
    if (!headers.get("Content-Type")) {
      const contentType = extension === ".png" ? "image/png"
        : extension === ".webp" ? "image/webp"
          : extension === ".gif" ? "image/gif"
            : extension === ".avif" ? "image/avif" : "image/jpeg";
      headers.set("Content-Type", contentType);
    }
    return Object.freeze({ body: object.body, headers, etag: object.httpEtag || null });
  }

  async getLegislation(lawId) {
    if (typeof lawId !== "string" || !/^[a-z0-9][a-z0-9-]{1,127}$/.test(lawId)) return null;
    const key = assertObjectKey(`legislations/${lawId}.json`, "legislations");
    const object = await this.bucket.get(key);
    if (!object || typeof object.arrayBuffer !== "function") return null;
    const checksum = object.customMetadata?.sha256;
    if (typeof checksum !== "string" || !/^[0-9a-f]{64}$/.test(checksum)) {
      throw new StorageBoundaryError("Legislation checksum metadata is missing", {
        code: "r2_verification_failed",
        status: 503,
      });
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    const computed = (await sha256Hex(bytes)).hex;
    if (computed !== checksum) {
      throw new StorageBoundaryError("Legislation checksum verification failed", {
        code: "r2_verification_failed",
        status: 503,
      });
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new StorageBoundaryError("Legislation payload is invalid JSON", {
        code: "r2_payload_invalid",
        status: 503,
      });
    }
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
    const count = await bindAll(this.db, `SELECT COUNT(*) AS total FROM cases c ${where}`, params).first();
    const total = Number(count?.total || 0);
    const statement = bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}
      FROM cases c ${where}
      ORDER BY ${column} ${direction.toUpperCase()}, c.case_id ASC
      LIMIT ? OFFSET ?
    `, [...params, checkedPageSize, (checkedPage - 1) * checkedPageSize]);
    return {
      cases: rows(await statement.all()),
      total,
      page: checkedPage,
      page_size: checkedPageSize,
      total_pages: Math.max(1, Math.ceil(total / checkedPageSize)),
      next_cursor: null,
    };
  }

  async exportCases({ filters = {}, limit = 50000 } = {}) {
    const size = compatPageNumber(limit, 50000, 1, 50000);
    const { clauses, params } = compatCaseFilters(filters);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return rows(await bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}, c.url, c.visa_outcome_reason,
             c.content_key, c.content_sha256, c.content_size
      FROM cases c ${where}
      ORDER BY c.year DESC, c.case_id ASC
      LIMIT ?
    `, [...params, size]).all());
  }

  async countCompat(filters = {}) {
    const { clauses, params } = compatCaseFilters(filters);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await bindAll(this.db, `SELECT COUNT(*) AS total FROM cases c ${where}`, params).first();
    return Number(result?.total || 0);
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

  async analyticsOutcomes() {
    const [court, year, subclass] = await Promise.all([
      this.db.prepare("SELECT court_code, outcome, case_count AS cnt FROM aggregate_court_year_outcome").all(),
      this.db.prepare("SELECT year AS year_key, outcome, case_count AS cnt FROM aggregate_court_year_outcome").all(),
      this.db.prepare("SELECT visa_subclass, court_code, outcome, case_count AS cnt FROM aggregate_visa").all(),
    ]);
    return { court: rows(court), year: rows(year), subclass: rows(subclass) };
  }

  async analyticsNatureOutcome() {
    return rows(await this.db.prepare("SELECT case_nature, outcome, case_count AS cnt FROM aggregate_nature_outcome").all());
  }

  async analyticsScope({ court = "", yearFrom = 0, yearTo = 0, visaSubclass = "", caseNature = "" } = {}) {
    const clauses = [];
    const params = [];
    if (court) { clauses.push("court_code = ?"); params.push(String(court)); }
    if (visaSubclass) { clauses.push("visa_subclass = ?"); params.push(String(visaSubclass)); }
    if (caseNature) { clauses.push("lower(case_nature) = lower(?)"); params.push(String(caseNature)); }
    if (yearFrom) { clauses.push("year >= ?"); params.push(Number(yearFrom)); }
    if (yearTo) { clauses.push("year <= ?"); params.push(Number(yearTo)); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return rows(await bindAll(this.db, `
      SELECT court_code, year, outcome, visa_subclass, visa_type, source, case_nature,
             has_full_text, case_count AS cnt
      FROM aggregate_scope ${where}
      ORDER BY year ASC, court_code ASC, outcome ASC
    `, params).all());
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
    return rows(await bindAll(this.db, `
      SELECT s.concept_id, c.label AS concept, s.court_code, s.year, s.outcome, s.case_count AS cnt
      FROM aggregate_concept_scope s JOIN concepts c ON c.concept_id = s.concept_id
      ${where}
      ORDER BY s.case_count DESC LIMIT 10000
    `, params).all());
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

  async analyticsJudgeAggregate() {
    const [outcomes, years, visas] = await Promise.all([
      this.db.prepare(`
        SELECT o.judge_id, j.canonical_name AS name, o.court_code, o.outcome, o.case_count AS cnt
        FROM aggregate_judge_outcome o JOIN judges j ON j.judge_id = o.judge_id
      `).all(),
      this.db.prepare("SELECT judge_id, year, case_count AS cnt FROM aggregate_judge_year").all(),
      this.db.prepare("SELECT judge_id, visa_subclass, case_count AS cnt FROM aggregate_judge_visa").all(),
    ]);
    return { outcomes: rows(outcomes), years: rows(years), visas: rows(visas) };
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
    const total = clauses.length
      ? Number((await bindAll(this.db, `SELECT COUNT(*) AS total FROM cases c ${where}`, params).first())?.total || 0)
      : Number((await this.db.prepare("SELECT value_int FROM catalog_summary WHERE summary_key = 'total_cases'").first())?.value_int || 0);
    const size = clampLimit(limit, { fallback: 50, max: 200 });
    const results = rows(await bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION}
      FROM cases c ${where}
      ORDER BY c.year DESC, c.case_id ASC
      LIMIT ?
    `, [...params, size]).all());
    return { total, results };
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
    const result = await this.db.prepare(`
      UPDATE cases SET ${assignments.join(", ")} WHERE case_id = ?
    `).bind(...params).run();
    if (changeCount(result) === 0) {
      throw new StorageBoundaryError("Case not found", { code: "case_not_found", status: 404 });
    }
    const relationStatements = [];
    if (Object.prototype.hasOwnProperty.call(updates, "judges")) {
      const labels = normaliseRelationLabels(updates.judges, "judge");
      relationStatements.push(this.db.prepare("DELETE FROM case_judges WHERE case_id = ?").bind(id));
      for (const label of labels) {
        const judgeId = (await sha256Hex(`judge:${label.toLocaleLowerCase("en-AU")}`)).hex.slice(0, 32);
        relationStatements.push(
          this.db.prepare("INSERT OR IGNORE INTO judges (judge_id, canonical_name, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(judgeId, label, now, now),
          this.db.prepare("INSERT OR IGNORE INTO case_judges (case_id, judge_id) VALUES (?, ?)").bind(id, judgeId),
        );
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, "legal_concepts")) {
      const labels = normaliseRelationLabels(updates.legal_concepts, "legal concept");
      relationStatements.push(this.db.prepare("DELETE FROM case_concepts WHERE case_id = ?").bind(id));
      for (const label of labels) {
        const conceptId = (await sha256Hex(`concept:${label.toLocaleLowerCase("en-AU")}`)).hex.slice(0, 32);
        relationStatements.push(
          this.db.prepare("INSERT OR IGNORE INTO concepts (concept_id, label) VALUES (?, ?)").bind(conceptId, label),
          this.db.prepare("INSERT OR IGNORE INTO case_concepts (case_id, concept_id) VALUES (?, ?)").bind(id, conceptId),
        );
      }
    }
    if (relationStatements.length) await this.db.batch(relationStatements);
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
    const statements = [];
    for (const table of [
      "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
      "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
      "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
      "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
      "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
    ]) statements.push(this.db.prepare(`DELETE FROM ${table}`));
    statements.push(
      this.db.prepare(`INSERT INTO aggregate_court_year_outcome (court_code,year,outcome,case_count,updated_at)
        SELECT court_code, year, outcome, COUNT(*), ? FROM cases GROUP BY court_code, year, outcome`).bind(now),
      this.db.prepare(`INSERT INTO aggregate_source (source,case_count,updated_at)
        SELECT source, COUNT(*), ? FROM cases WHERE source <> '' GROUP BY source`).bind(now),
      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
        SELECT 'total_cases', COUNT(*), ? FROM cases`).bind(now),
      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
        SELECT 'with_full_text', COUNT(*), ? FROM cases WHERE content_key <> ''`).bind(now),
      this.db.prepare(`INSERT INTO aggregate_judge_court (judge_id,court_code,case_count)
        SELECT cj.judge_id, c.court_code, COUNT(DISTINCT cj.case_id)
        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
        WHERE c.court_code <> '' GROUP BY cj.judge_id, c.court_code`),
      this.db.prepare(`INSERT INTO aggregate_nature_outcome (case_nature,outcome,case_count)
        SELECT case_nature, outcome, COUNT(*) FROM cases WHERE case_nature <> '' GROUP BY case_nature, outcome`),
      this.db.prepare(`INSERT INTO aggregate_concept (concept_id,label,case_count)
        SELECT cc.concept_id, c.label, COUNT(DISTINCT cc.case_id)
        FROM case_concepts cc JOIN concepts c ON c.concept_id = cc.concept_id GROUP BY cc.concept_id, c.label`),
      this.db.prepare(`INSERT INTO aggregate_country (country,case_count,updated_at)
        SELECT country_of_origin, COUNT(*), ? FROM cases WHERE country_of_origin <> '' GROUP BY country_of_origin`).bind(now),
      this.db.prepare(`INSERT INTO aggregate_judge (judge_id,canonical_name,case_count,updated_at)
        SELECT j.judge_id, j.canonical_name, COUNT(DISTINCT cj.case_id), ?
        FROM judges j JOIN case_judges cj ON cj.judge_id = j.judge_id GROUP BY j.judge_id, j.canonical_name`).bind(now),
      this.db.prepare(`INSERT INTO aggregate_visa (visa_subclass,court_code,outcome,case_count,updated_at)
        SELECT visa_subclass, court_code, outcome, COUNT(*), ? FROM cases
        WHERE visa_subclass <> '' GROUP BY visa_subclass, court_code, outcome`).bind(now),
      this.db.prepare(`INSERT INTO aggregate_scope
        (court_code,year,outcome,visa_subclass,visa_type,source,case_nature,country_of_origin,has_full_text,case_count)
        SELECT COALESCE(court_code,''), COALESCE(year,0), COALESCE(outcome,''), COALESCE(visa_subclass,''),
               COALESCE(visa_type,''), COALESCE(source,''), COALESCE(case_nature,''), COALESCE(country_of_origin,''),
               CASE WHEN content_key <> '' THEN 1 ELSE 0 END, COUNT(*)
        FROM cases GROUP BY COALESCE(court_code,''), COALESCE(year,0), COALESCE(outcome,''), COALESCE(visa_subclass,''),
          COALESCE(visa_type,''), COALESCE(source,''), COALESCE(case_nature,''), COALESCE(country_of_origin,''),
          CASE WHEN content_key <> '' THEN 1 ELSE 0 END`),
      this.db.prepare(`INSERT INTO aggregate_court_nature_outcome (court_code,case_nature,outcome,case_count)
        SELECT court_code, case_nature, outcome, COUNT(*) FROM cases WHERE case_nature <> ''
        GROUP BY court_code, case_nature, outcome`),
      this.db.prepare(`INSERT INTO aggregate_concept_scope (concept_id,court_code,year,outcome,case_count)
        SELECT cc.concept_id, c.court_code, COALESCE(c.year,0), c.outcome, COUNT(DISTINCT cc.case_id)
        FROM case_concepts cc JOIN cases c ON c.case_id = cc.case_id
        GROUP BY cc.concept_id, c.court_code, COALESCE(c.year,0), c.outcome`),
      this.db.prepare(`INSERT INTO aggregate_concept_pair
        (concept_id_a,concept_id_b,court_code,outcome,case_count)
        SELECT a.concept_id, b.concept_id, c.court_code, c.outcome, COUNT(DISTINCT a.case_id)
        FROM case_concepts a JOIN case_concepts b ON b.case_id = a.case_id AND a.concept_id < b.concept_id
        JOIN cases c ON c.case_id = a.case_id
        GROUP BY a.concept_id, b.concept_id, c.court_code, c.outcome`),
      this.db.prepare(`INSERT INTO aggregate_judge_outcome (judge_id,court_code,outcome,case_count)
        SELECT cj.judge_id, c.court_code, c.outcome, COUNT(DISTINCT cj.case_id)
        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id
        GROUP BY cj.judge_id, c.court_code, c.outcome`),
      this.db.prepare(`INSERT INTO aggregate_judge_year (judge_id,year,case_count)
        SELECT cj.judge_id, c.year, COUNT(DISTINCT cj.case_id)
        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id WHERE c.year IS NOT NULL
        GROUP BY cj.judge_id, c.year`),
      this.db.prepare(`INSERT INTO aggregate_judge_visa (judge_id,visa_subclass,case_count)
        SELECT cj.judge_id, c.visa_subclass, COUNT(DISTINCT cj.case_id)
        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id WHERE c.visa_subclass <> ''
        GROUP BY cj.judge_id, c.visa_subclass`),
    );
    for (const [filterName, column] of [["court", "court_code"], ["year", "year"], ["outcome", "outcome"], ["visa_type", "visa_type"], ["visa_subclass", "visa_subclass"], ["source", "source"], ["case_nature", "case_nature"]]) {
      statements.push(this.db.prepare(`INSERT INTO filter_options (filter_name, option_value, sort_order)
        SELECT ?, CAST(${column} AS TEXT), ROW_NUMBER() OVER (ORDER BY ${column}) - 1
        FROM (SELECT DISTINCT ${column} FROM cases WHERE ${column} IS NOT NULL AND ${column} <> '')`).bind(filterName));
    }
    for (let offset = 0; offset < statements.length; offset += 20) await this.db.batch(statements.slice(offset, offset + 20));
    return { rebuilt_at: now };
  }

  async relatedCompat(caseId, { limit = 5 } = {}) {
    const id = assertCaseId(caseId);
    const size = compatPageNumber(limit, 5, 1, 20);
    const anchor = await this.db.prepare(`
      SELECT case_nature, visa_type, court_code FROM cases WHERE case_id = ?
    `).bind(id).first();
    if (!anchor) return null;
    const statements = bindAll(this.db, `
      SELECT ${LEGACY_CASE_PROJECTION},
        (CASE WHEN ? <> '' AND c.case_nature = ? THEN 4 ELSE 0 END) +
        (CASE WHEN ? <> '' AND c.visa_type = ? THEN 2 ELSE 0 END) +
        (CASE WHEN ? <> '' AND c.court_code = ? THEN 1 ELSE 0 END) AS related_score
      FROM cases c
      WHERE c.case_id <> ?
        AND ((? <> '' AND c.case_nature = ?) OR (? <> '' AND c.visa_type = ?) OR (? <> '' AND c.court_code = ?))
      ORDER BY related_score DESC, c.year DESC, c.case_id ASC
      LIMIT ?
    `, [
      anchor.case_nature, anchor.case_nature,
      anchor.visa_type, anchor.visa_type,
      anchor.court_code, anchor.court_code,
      id,
      anchor.case_nature, anchor.case_nature,
      anchor.visa_type, anchor.visa_type,
      anchor.court_code, anchor.court_code,
      size,
    ]);
    return rows(await statements.all());
  }

  async searchLexical({ query, match, filters = {}, limit } = {}) {
    const matchString = match ?? toFtsMatch(query);
    const { clauses, params } = safeCaseFilters(filters);
    const size = clampLimit(limit, { fallback: 50, max: 100 });
    // bm25() is valid only in the direct FTS query context. Paginate over chunk
    // candidates (a single long case can monopolise the first page) until enough
    // distinct cases are found, then aggregate their best-chunk rank per case.
    const ranks = new Map();
    const CHUNK_PAGE = 100;
    const MAX_PAGES = 5;
    for (let offset = 0; offset < CHUNK_PAGE * MAX_PAGES; offset += CHUNK_PAGE) {
      const hits = rows(await this.db.prepare(`
        SELECT case_id, bm25(case_text_fts) AS rank
        FROM case_text_fts
        WHERE case_text_fts MATCH ?
        ORDER BY rank ASC
        LIMIT ? OFFSET ?
      `).bind(matchString, CHUNK_PAGE, offset).all());
      if (hits.length === 0) break;
      for (const hit of hits) {
        const rank = Number(hit.rank);
        if (!ranks.has(hit.case_id) || rank < ranks.get(hit.case_id)) ranks.set(hit.case_id, rank);
      }
      if (ranks.size >= size) break;
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
    // canonical text. The FTS delete trigger keeps case_text_fts in lockstep.
    await this.db.prepare(`DELETE FROM case_text_chunks WHERE case_id = ?`).bind(caseId).run();
    for (let offset = 0; offset < chunks.length; offset += 20) {
      const batch = chunks.slice(offset, offset + 20).map((chunk, index) => bindAll(this.db, `
        INSERT INTO case_text_chunks (case_id, chunk_index, content, content_sha256, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(case_id, chunk_index) DO UPDATE SET
          content=excluded.content, content_sha256=excluded.content_sha256, created_at=excluded.created_at
      `, [caseId, offset + index, chunk.content, chunk.sha256, now]));
      await this.db.batch(batch);
    }
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

export class CloudflareIdentityStore {
  constructor(env) {
    this.db = requireD1(env.IMMI_ACCOUNT_DB, "IMMI_ACCOUNT_DB");
  }

  async assertMembership(auth) {
    const context = assertAuthContext(auth);
    const membership = await this.db.prepare(`
      SELECT role FROM memberships
      WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL
      LIMIT 1
    `).bind(context.tenantId, context.userId).first();
    if (!membership) {
      throw new StorageBoundaryError("Tenant membership not found", {
        code: "tenant_membership_denied",
        status: 403,
      });
    }
    return { ...context, role: membership.role };
  }

  /**
   * Atomically upsert the Telegram profile and create exactly one personal
   * tenant if this user has no active membership. D1 batch is transactional,
   * preventing two concurrent first logins from attaching two workspaces.
   */
  async upsertTelegramUser(tgData) {
    const telegramId = assertTelegramId(tgData?.id);
    const userId = crypto.randomUUID();
    const prospectiveTenantId = crypto.randomUUID();
    const now = utcNow();
    const firstName = typeof tgData?.first_name === "string" ? tgData.first_name : null;
    const lastName = typeof tgData?.last_name === "string" ? tgData.last_name : null;
    const username = typeof tgData?.username === "string" ? tgData.username : null;
    const photoUrl = typeof tgData?.photo_url === "string" ? tgData.photo_url : null;
    const tenantName = firstName || "My Workspace";

    await this.db.batch([
      this.db.prepare(`
        INSERT INTO users (
          user_id, telegram_id, first_name, last_name, username, photo_url,
          last_login_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
          first_name=excluded.first_name, last_name=excluded.last_name,
          username=excluded.username, photo_url=excluded.photo_url,
          last_login_at=excluded.last_login_at, updated_at=excluded.updated_at
      `).bind(userId, telegramId, firstName, lastName, username, photoUrl, now, now, now),
      this.db.prepare(`
        INSERT INTO tenants (tenant_id, kind, name, created_at, updated_at)
        SELECT ?, 'individual', ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1
          FROM memberships m
          JOIN users u ON u.user_id = m.user_id
          WHERE u.telegram_id = ? AND m.revoked_at IS NULL
        )
      `).bind(prospectiveTenantId, tenantName, now, now, telegramId),
      this.db.prepare(`
        INSERT OR IGNORE INTO memberships (tenant_id, user_id, role, created_at)
        SELECT ?, u.user_id, 'owner', ?
        FROM users u
        WHERE u.telegram_id = ?
          AND EXISTS (SELECT 1 FROM tenants WHERE tenant_id = ?)
      `).bind(prospectiveTenantId, now, telegramId, prospectiveTenantId),
    ]);

    const user = await this.db.prepare(`
      SELECT user_id, telegram_id FROM users WHERE telegram_id = ? LIMIT 1
    `).bind(telegramId).first();
    if (!user) {
      throw new StorageBoundaryError("Telegram user upsert did not return a user", {
        code: "identity_write_failed",
        status: 503,
      });
    }
    return this.getAuthSnapshot(user.user_id);
  }

  /** Return a current, tenant-scoped token profile; never rely on stale JWT membership. */
  async getAuthSnapshot(userId, activeTenantId = null) {
    const checkedUserId = assertUuid(userId, "user_id");
    const checkedTenantId = activeTenantId === null ? null : assertUuid(activeTenantId, "tenant_id");
    const user = await this.db.prepare(`
      SELECT user_id, telegram_id FROM users WHERE user_id = ? LIMIT 1
    `).bind(checkedUserId).first();
    if (!user) throw refreshSessionError("User not found", "user_not_found");
    const memberships = rows(await this.db.prepare(`
      SELECT t.tenant_id, t.kind, t.name, m.role
      FROM memberships m
      JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ? AND m.revoked_at IS NULL
      ORDER BY m.created_at ASC, t.tenant_id ASC
    `).bind(checkedUserId).all());
    if (memberships.length === 0) {
      throw refreshSessionError("Tenant membership not found", "tenant_membership_denied");
    }
    const selected = checkedTenantId
      ? memberships.find((membership) => membership.tenant_id === checkedTenantId)
      : memberships[0];
    if (!selected) {
      throw new StorageBoundaryError("Not a member of that tenant", {
        code: "forbidden",
        status: 403,
      });
    }
    return {
      user: {
        id: user.user_id,
        telegram_id: asJwtTelegramId(user.telegram_id),
        role: selected.role || "member",
      },
      tenant: { id: selected.tenant_id, kind: selected.kind, name: selected.name },
      tenants: memberships.map((membership) => membership.tenant_id),
    };
  }

  async createRefreshSession(draft, previousRefreshClaims = null, previousRefreshReason = "login_replaced") {
    const next = refreshDraftValues(draft);
    const now = utcNow();
    const statements = [this.db.prepare(`
      INSERT INTO immi_refresh_sessions (
        jti, user_id, family_id, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(next.jti, next.userId, next.familyId, next.expiresAt, now)];
    if (previousRefreshClaims?.jti && previousRefreshClaims?.userId === next.userId) {
      statements.push(this.db.prepare(`
        UPDATE immi_refresh_sessions
        SET revoked_at = COALESCE(revoked_at, ?),
            revoked_reason = COALESCE(revoked_reason, ?),
            replaced_by_jti = COALESCE(replaced_by_jti, ?),
            last_used_at = COALESCE(last_used_at, ?)
        WHERE jti = ? AND user_id = ?
      `).bind(
        now, previousRefreshReason, next.jti, now,
        assertUuid(previousRefreshClaims.jti, "refresh.jti"), next.userId,
      ));
    }
    const result = await this.db.batch(statements);
    if (changeCount(result[0]) !== 1) {
      throw new StorageBoundaryError("Unable to create refresh session", {
        code: "identity_write_failed",
        status: 503,
      });
    }
  }

  async revokeRefreshSession({ jti, userId, reason, replacedByJti = null }) {
    const checkedJti = assertUuid(jti, "refresh.jti");
    const checkedUserId = assertUuid(userId, "refresh.userId");
    const checkedReplacement = replacedByJti === null ? null : assertUuid(replacedByJti, "refresh.replacedByJti");
    const now = utcNow();
    await this.db.prepare(`
      UPDATE immi_refresh_sessions
      SET revoked_at = COALESCE(revoked_at, ?),
          revoked_reason = COALESCE(revoked_reason, ?),
          replaced_by_jti = COALESCE(replaced_by_jti, ?),
          last_used_at = COALESCE(last_used_at, ?)
      WHERE jti = ? AND user_id = ?
    `).bind(now, reason, checkedReplacement, now, checkedJti, checkedUserId).run();
  }

  async loadRefreshAuthSnapshot({ jti, userId }) {
    const checkedJti = assertUuid(jti, "refresh.jti");
    const checkedUserId = assertUuid(userId, "refresh.userId");
    const session = await this.db.prepare(`
      SELECT jti, user_id, family_id, expires_at, revoked_at
      FROM immi_refresh_sessions WHERE jti = ? AND user_id = ? LIMIT 1
    `).bind(checkedJti, checkedUserId).first();
    if (!session) throw refreshSessionError("Refresh session not found", "refresh_session_not_found");
    if (session.revoked_at) throw refreshSessionError("Refresh token has been revoked", "revoked_refresh_token");
    const expiresAt = new Date(session.expires_at).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await this.revokeRefreshSession({ jti: checkedJti, userId: checkedUserId, reason: "expired" });
      throw refreshSessionError("Refresh token expired", "expired_refresh_token");
    }
    const snapshot = await this.getAuthSnapshot(checkedUserId);
    return { session, ...snapshot };
  }

  /**
   * Conditional insert is the compare-and-swap: only the one request that
   * still sees the old active jti creates a successor. A replay never gets a
   * usable replacement session.
   */
  async rotateRefreshSession(previousClaims, draft) {
    const previousJti = assertUuid(previousClaims?.jti, "refresh.jti");
    const previousUserId = assertUuid(previousClaims?.userId, "refresh.userId");
    const next = refreshDraftValues(draft);
    if (next.userId !== previousUserId) {
      throw refreshSessionError("Refresh token user mismatch", "invalid_refresh_token");
    }
    const now = utcNow();
    const result = await this.db.batch([
      this.db.prepare(`
        INSERT INTO immi_refresh_sessions (jti, user_id, family_id, expires_at, created_at)
        SELECT ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM immi_refresh_sessions
          WHERE jti = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
        )
      `).bind(next.jti, next.userId, next.familyId, next.expiresAt, now, previousJti, previousUserId, now),
      this.db.prepare(`
        UPDATE immi_refresh_sessions
        SET revoked_at = ?, revoked_reason = 'rotated', replaced_by_jti = ?, last_used_at = ?
        WHERE jti = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ?
      `).bind(now, next.jti, now, previousJti, previousUserId, now),
    ]);
    if (changeCount(result[0]) !== 1 || changeCount(result[1]) !== 1) {
      throw refreshSessionError("Refresh token has been revoked", "revoked_refresh_token");
    }
  }

  async listCouncilSessions(auth, { limit, before = null } = {}) {
    const context = await this.assertMembership(auth);
    const size = clampLimit(limit, { fallback: 50, max: 100 });
    const beforeClause = before ? "AND updated_at < ?" : "";
    const params = before ? [context.tenantId, before, size] : [context.tenantId, size];
    return rows(await this.db.prepare(`
      SELECT session_id, case_id, title, status, total_turns, created_at, updated_at
      FROM council_sessions
      WHERE tenant_id = ? AND deleted_at IS NULL ${beforeClause}
      ORDER BY updated_at DESC, session_id DESC
      LIMIT ?
    `).bind(...params).all());
  }
}

export class CloudflareCouncilStore {
  constructor(env) {
    this.db = requireD1(env.IMMI_ACCOUNT_DB, "IMMI_ACCOUNT_DB");
  }

  async createSession(auth, { sessionId, caseId = null, title = "", retrieveCode = null }) {
    const context = assertAuthContext(auth);
    const now = utcNow();
    await this.db.prepare(`
      INSERT INTO council_sessions (
        session_id, tenant_id, created_by, case_id, title, status, retrieve_code,
        total_turns, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, 0, ?, ?)
    `).bind(sessionId, context.tenantId, context.userId, caseId, title, retrieveCode, now, now).run();
    return this.db.prepare(`
      SELECT session_id, case_id, title, status, retrieve_code, total_turns, created_at, updated_at
      FROM council_sessions WHERE session_id = ? AND tenant_id = ?
    `).bind(sessionId, context.tenantId).first();
  }

  async getSessionByCode(auth, code) {
    const context = assertAuthContext(auth);
    return this.db.prepare(`
      SELECT session_id, retrieve_code, tenant_id, created_by
      FROM council_sessions
      WHERE retrieve_code = ? AND tenant_id = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(code, context.tenantId).first();
  }

  async getSessionMetadata(auth, sessionId) {
    const context = assertAuthContext(auth);
    const session = await this.db.prepare(`
      SELECT session_id, case_id, title, status, total_turns, created_at, updated_at
      FROM council_sessions
      WHERE session_id = ? AND tenant_id = ? AND deleted_at IS NULL
      LIMIT 1
    `).bind(sessionId, context.tenantId).first();
    if (!session) return null;
    const turns = rows(await this.db.prepare(`
      SELECT turn_id, session_id, turn_index, role, payload_key, payload_sha256,
             payload_size, payload_content_type, created_at
      FROM council_turns
      WHERE session_id = ? AND tenant_id = ?
      ORDER BY turn_index ASC
    `).bind(sessionId, context.tenantId).all());
    return { session, turns };
  }

  async appendTurnMetadata(auth, { sessionId, turnId, turnIndex, role, payloadPointer }) {
    const context = assertAuthContext(auth);
    const pointer = assertObjectPointer(payloadPointer, "council");
    if (!Number.isInteger(turnIndex) || turnIndex < 0) {
      throw new StorageBoundaryError("turnIndex must be a non-negative integer", { code: "invalid_turn_index", status: 400 });
    }
    const now = utcNow();
    const results = await this.db.batch([
      this.db.prepare(`
        INSERT OR IGNORE INTO council_turns (
          turn_id, session_id, tenant_id, turn_index, role, payload_key,
          payload_sha256, payload_size, payload_content_type, created_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM council_sessions
          WHERE session_id = ? AND tenant_id = ? AND deleted_at IS NULL
        )
      `).bind(
        turnId, sessionId, context.tenantId, turnIndex, role, pointer.key,
        pointer.sha256, pointer.size, pointer.contentType, now,
        sessionId, context.tenantId,
      ),
      this.db.prepare(`
        UPDATE council_sessions
        SET total_turns = (
              SELECT COUNT(*) FROM council_turns WHERE session_id = ? AND tenant_id = ?
            ), updated_at = ?
        WHERE session_id = ? AND tenant_id = ? AND deleted_at IS NULL
      `).bind(sessionId, context.tenantId, now, sessionId, context.tenantId),
    ]);
    if (changeCount(results[0]) === 0 && changeCount(results[1]) === 0) {
      throw new StorageBoundaryError("Council session not found", { code: "council_session_not_found", status: 404 });
    }
  }

  async deleteSession(auth, sessionId) {
    const context = assertAuthContext(auth);
    const result = await this.db.prepare(`
      UPDATE council_sessions
      SET deleted_at = ?, updated_at = ?
      WHERE session_id = ? AND tenant_id = ? AND deleted_at IS NULL
    `).bind(utcNow(), utcNow(), sessionId, context.tenantId).run();
    if (changeCount(result) === 0) {
      throw new StorageBoundaryError("Council session not found", { code: "council_session_not_found", status: 404 });
    }
  }
}

export class CloudflarePipelineStore {
  constructor(env) {
    this.db = requireD1(env.IMMI_OPS_DB, "IMMI_OPS_DB");
  }

  async claimEvent(eventId, { runId = null, kind, payloadSha256 }) {
    assertSha256(payloadSha256);
    if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 128 || typeof kind !== "string" || kind.length === 0) {
      throw new StorageBoundaryError("Pipeline event is invalid", { code: "invalid_pipeline_event", status: 400 });
    }
    const result = await this.db.prepare(`
      INSERT OR IGNORE INTO idempotency_keys (event_id, run_id, event_kind, payload_sha256, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(eventId, runId, kind, payloadSha256, utcNow()).run();
    if (changeCount(result) === 1) return true;
    const existing = await this.db.prepare(`
      SELECT payload_sha256 FROM idempotency_keys WHERE event_id = ? LIMIT 1
    `).bind(eventId).first();
    if (!existing || existing.payload_sha256 !== payloadSha256) {
      throw new StorageBoundaryError("Pipeline event id was reused with a different payload", {
        code: "idempotency_payload_mismatch",
        status: 409,
      });
    }
    return false;
  }

  async ensurePipelineRun({ runId, trigger = "queue", phase = "extract" }) {
    if (typeof runId !== "string" || runId.length === 0 || runId.length > 128) {
      throw new StorageBoundaryError("Pipeline run id is invalid", { code: "invalid_pipeline_run", status: 400 });
    }
    await this.db.prepare(`
      INSERT OR IGNORE INTO pipeline_runs (run_id, trigger, phase, status, started_at)
      VALUES (?, ?, ?, 'running', ?)
    `).bind(runId, trigger, phase, utcNow()).run();
  }

  async listRuns(limit = 30) {
    const size = clampLimit(limit, { fallback: 30, max: 100 });
    const [runRows, summary] = await Promise.all([
      this.db.prepare(`
        SELECT run_id, started_at, finished_at, trigger, court, phase, status,
               discovered, scraped, extracted, upserted, llm_calls, cost_usd,
               errors, abort_reason, detail_json
        FROM pipeline_runs
        ORDER BY started_at DESC LIMIT ?
      `).bind(size).all(),
      this.db.prepare(`
        SELECT COUNT(*) AS total_runs,
               SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_runs,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_runs,
               SUM(CASE WHEN status = 'aborted' THEN 1 ELSE 0 END) AS aborted_runs,
               COALESCE(SUM(discovered), 0) AS discovered,
               COALESCE(SUM(scraped), 0) AS scraped,
               COALESCE(SUM(extracted), 0) AS extracted,
               COALESCE(SUM(upserted), 0) AS upserted,
               COALESCE(SUM(llm_calls), 0) AS llm_calls,
               COALESCE(SUM(cost_usd), 0) AS cost_usd
        FROM pipeline_runs
      `).first(),
    ]);
    return { runs: rows(runRows), summary: summary || {} };
  }

  async latestControlCommand(action) {
    if (!["start", "stop", "download", "legislation_update"].includes(action)) {
      throw new StorageBoundaryError("Pipeline command action is invalid", { code: "invalid_pipeline_command", status: 400 });
    }
    return this.db.prepare(`
      SELECT command_id, action, payload_json, status, run_id, error, created_at, updated_at, completed_at
      FROM pipeline_control_commands
      WHERE action = ? ORDER BY created_at DESC LIMIT 1
    `).bind(action).first();
  }

  async recordControlCommand({ commandId, action, payload, runId = null }) {
    if (typeof commandId !== "string" || commandId.length < 8 || commandId.length > 128) {
      throw new StorageBoundaryError("Pipeline command id is invalid", { code: "invalid_pipeline_command", status: 400 });
    }
    if (!["start", "stop", "download", "legislation_update"].includes(action)) {
      throw new StorageBoundaryError("Pipeline command action is invalid", { code: "invalid_pipeline_command", status: 400 });
    }
    const encoded = JSON.stringify(payload && typeof payload === "object" ? payload : {});
    const now = utcNow();
    const result = await this.db.prepare(`
      INSERT OR IGNORE INTO pipeline_control_commands
        (command_id, action, payload_json, status, run_id, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?, ?)
    `).bind(commandId, action, encoded, runId, now, now).run();
    return changeCount(result) === 1;
  }

  async updateControlCommand(commandId, patch = {}) {
    if (typeof commandId !== "string" || commandId.length < 8 || commandId.length > 128) {
      throw new StorageBoundaryError("Pipeline command id is invalid", { code: "invalid_pipeline_command", status: 400 });
    }
    const allowed = new Set(["queued", "running", "completed", "failed"]);
    const status = patch.status === undefined ? null : String(patch.status);
    if (status !== null && !allowed.has(status)) {
      throw new StorageBoundaryError("Pipeline command status is invalid", { code: "invalid_pipeline_command", status: 400 });
    }
    const completedAt = status === "completed" || status === "failed" ? utcNow() : null;
    await this.db.prepare(`
      UPDATE pipeline_control_commands SET
        status = COALESCE(?, status),
        run_id = COALESCE(?, run_id),
        error = COALESCE(?, error),
        updated_at = ?,
        completed_at = COALESCE(?, completed_at)
      WHERE command_id = ?
    `).bind(status, patch.runId ?? null, patch.error ?? null, utcNow(), completedAt, commandId).run();
  }

  async checkpoint({ runId, eventId, step, status, detail = null }) {
    await this.db.prepare(`
      INSERT INTO import_checkpoints (run_id, event_id, step, status, detail_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, event_id, step) DO UPDATE SET
        status=excluded.status, detail_json=excluded.detail_json, updated_at=excluded.updated_at
    `).bind(runId, eventId, step, status, detail === null ? null : JSON.stringify(detail), utcNow()).run();
  }

  async pipelineCheckpoint({ runId, eventId, step, status, detail = null }) {
    await this.db.prepare(`
      INSERT INTO pipeline_checkpoints (run_id, event_id, step, status, detail_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, event_id, step) DO UPDATE SET
        status=excluded.status, detail_json=excluded.detail_json, updated_at=excluded.updated_at
    `).bind(runId, eventId, step, status, detail === null ? null : JSON.stringify(detail), utcNow()).run();
  }

  async isEventComplete(eventId) {
    const record = await this.db.prepare(`
      SELECT completed_at FROM idempotency_keys WHERE event_id = ? LIMIT 1
    `).bind(eventId).first();
    return Boolean(record?.completed_at);
  }

  async completeEvent(eventId) {
    await this.db.prepare(`
      UPDATE idempotency_keys SET completed_at = ? WHERE event_id = ?
    `).bind(utcNow(), eventId).run();
  }

  async recordDeadLetter({ eventId, outboxEventId = null, reason, payloadPointer }) {
    const linked = outboxEventId
      ? await this.db.prepare("SELECT event_id FROM outbox_events WHERE event_id = ? LIMIT 1")
        .bind(outboxEventId).first()
      : null;
    await this.db.prepare(`
      INSERT OR IGNORE INTO dead_letter_events (
        event_id, outbox_event_id, reason, payload_key, payload_sha256, failed_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      eventId, linked?.event_id || null, reason, payloadPointer.key,
      payloadPointer.sha256, utcNow(),
    ).run();
  }

  async recordExtractionAudit({ auditId = null, runId, caseId, fieldName, oldValue = null, newValue, source, confidence = null }) {
    await this.db.prepare(`
      INSERT OR IGNORE INTO extraction_audit (
        audit_id, run_id, case_id, field_name, old_value, new_value, source, confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      auditId || crypto.randomUUID(), runId, assertCaseId(caseId), fieldName, oldValue,
      newValue, source, confidence, utcNow(),
    ).run();
  }
}

export class CloudflareSemanticIndex {
  constructor(env) {
    this.index = env.CASE_VECTORS;
    this.ai = env.AI;
  }

  async embed(text) {
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new StorageBoundaryError("Embedding text is required", { code: "invalid_embedding_text", status: 400 });
    }
    const result = await this.ai.run(VECTOR_MODEL, { text: [text] });
    const vectors = Array.isArray(result) ? result : result?.data;
    const vector = Array.isArray(vectors) ? vectors[0] : null;
    if (!Array.isArray(vector) || vector.length !== VECTOR_DIMENSIONS) {
      throw new StorageBoundaryError("Workers AI returned an unexpected embedding shape", {
        code: "embedding_shape_invalid",
        status: 503,
      });
    }
    return vector;
  }

  async relatedById(caseId, { filters = {}, limit } = {}) {
    const id = assertCaseId(caseId);
    const filter = {};
    for (const [key, value] of Object.entries(filters)) {
      if (!VECTOR_FILTER_KEYS.has(key) || value === undefined || value === null || value === "") continue;
      if ((key === "year" && !Number.isInteger(value)) || (key !== "year" && typeof value !== "string")) {
        throw new StorageBoundaryError(`Invalid Vectorize filter: ${key}`, { code: "invalid_filter", status: 400 });
      }
      filter[key] = value;
    }
    return this.index.queryById(id, {
      topK: clampLimit(limit, { fallback: 100, max: 100 }),
      returnMetadata: "indexed",
      ...(Object.keys(filter).length > 0 ? { filter } : {}),
    });
  }

  async searchText(text, { filters = {}, limit } = {}) {
    const vector = await this.embed(text);
    const filter = {};
    for (const [key, value] of Object.entries(filters)) {
      if (!VECTOR_FILTER_KEYS.has(key) || value === undefined || value === null || value === "") continue;
      if ((key === "year" && !Number.isInteger(value)) || (key !== "year" && typeof value !== "string")) {
        throw new StorageBoundaryError(`Invalid Vectorize filter: ${key}`, { code: "invalid_filter", status: 400 });
      }
      filter[key] = value;
    }
    return this.index.query(vector, {
      topK: clampLimit(limit, { fallback: 100, max: 100 }),
      returnMetadata: "indexed",
      ...(Object.keys(filter).length > 0 ? { filter } : {}),
    });
  }

  async upsertCase(caseId, values, metadata) {
    const id = assertCaseId(caseId);
    if (!Array.isArray(values) || values.length !== VECTOR_DIMENSIONS) {
      throw new StorageBoundaryError("Vector dimensions must be exactly 1024", { code: "invalid_vector_dimensions", status: 400 });
    }
    const safeMetadata = {};
    for (const key of VECTOR_FILTER_KEYS) {
      if (metadata?.[key] !== undefined) safeMetadata[key] = metadata[key];
    }
    return this.index.upsert([{ id, values, metadata: safeMetadata }]);
  }

  async deleteCase(caseId) {
    const id = assertCaseId(caseId);
    if (typeof this.index.deleteByIds !== "function") {
      throw new StorageBoundaryError("Vectorize deleteByIds binding is unavailable", {
        code: "vectorize_delete_unavailable",
        status: 503,
      });
    }
    return this.index.deleteByIds([id]);
  }
}

/**
 * The sole factory exposed to handlers/DOs. It makes direct platform-binding
 * access mechanically unnecessary outside this directory.
 */
export function createCloudflareStores(env) {
  assertCloudflareRuntimeMode(env);
  assertCloudflareBindings(env);
  return Object.freeze({
    caseStore: new CloudflareCaseStore(env),
    identityStore: new CloudflareIdentityStore(env),
    councilStore: new CloudflareCouncilStore(env),
    pipelineStore: new CloudflarePipelineStore(env),
    semanticIndex: new CloudflareSemanticIndex(env),
    objectStore: new CloudflareObjectStore(env),
  });
}

/**
 * D1-only store factory for the council retrieval path. Unlike
 * createCloudflareStores it does not require Vectorize/AI/R2 bindings, so the
 * lexical retrieval can run even when the semantic index is unavailable.
 */
export function createCloudflareCaseStore(env) {
  assertCloudflareRuntimeMode(env);
  requireD1(env?.IMMI_CATALOG_DB, "IMMI_CATALOG_DB");
  return new CloudflareCaseStore(env);
}

/** The auth boundary needs only Account D1; no handler receives its binding. */
export function createCloudflareIdentityStore(env) {
  assertCloudflareRuntimeMode(env);
  requireD1(env?.IMMI_ACCOUNT_DB, "IMMI_ACCOUNT_DB");
  return new CloudflareIdentityStore(env);
}
