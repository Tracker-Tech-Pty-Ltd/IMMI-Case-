/**
 * Cloudflare Worker: IMMI Case API + Flask Container Proxy
 *
 * Read path (fast, no cold start):
 *   GET /api/v1/cases            → Hyperdrive → Supabase PostgreSQL
 *   GET /api/v1/cases/count      → Hyperdrive → Supabase PostgreSQL
 *   GET /api/v1/cases/:id        → Hyperdrive → Supabase PostgreSQL
 *   GET /api/v1/stats            → Hyperdrive → Supabase PostgreSQL (parallel aggregates)
 *   GET /api/v1/filter-options   → Hyperdrive → Supabase PostgreSQL (DISTINCT values)
 *   GET /api/v1/analytics/*              → Hyperdrive → Supabase PostgreSQL (RPC functions + JS normalisation)
 *   GET /api/v1/stats/trends             → Hyperdrive → get_court_year_trends() RPC
 *   GET /api/v1/analytics/filter-options → Hyperdrive → DISTINCT SQL aggregation
 *   GET /api/v1/analytics/monthly-trends → Hyperdrive → date_sort GROUP BY + JS win logic
 *   GET /api/v1/analytics/flow-matrix    → Hyperdrive → court/nature/outcome GROUP BY
 *   GET /api/v1/analytics/judge-bio      → Hyperdrive → judge_bios table
 *   GET /api/v1/analytics/visa-families  → Hyperdrive → visa_subclass + JS VISA_REGISTRY
 *   GET /api/v1/analytics/success-rate   → Hyperdrive → parameterized SQL + JS aggregation
 *   GET /api/v1/analytics/concept-*      → Hyperdrive → LATERAL unnest + JS canonicalization
 *   GET /api/v1/analytics/judge-*        → Hyperdrive → LATERAL unnest judges + JS profile
 *   GET /api/v1/court-lineage            → Hyperdrive → get_court_year_trends() RPC + JS lineage structure
 *   GET /api/v1/data-dictionary          → static JS const (no DB)
 *   GET /api/v1/visa-registry            → static JS const (no DB)
 *   GET /api/v1/cases/compare                  → Hyperdrive → batch SELECT WHERE case_id = ANY(...)
 *   GET /api/v1/cases/:id/related             → Hyperdrive → find_related_cases() RPC
 *   GET /api/v1/cases/:id/similar             → Hyperdrive → search_cases_semantic() pgvector RPC
 *   GET /api/v1/taxonomy/countries            → Hyperdrive → GROUP BY country_of_origin
 *   GET /api/v1/taxonomy/judges/autocomplete  → Hyperdrive → LATERAL unnest judges + ILIKE
 *   GET /api/v1/taxonomy/visa-lookup          → Hyperdrive → registry match + SQL count (replaces 149K scan)
 *   GET /api/v1/legislations                  → static JS const (metadata only, max-age=3600)
 *   GET /api/v1/legislations/search           → static JS const (in-memory search, max-age=3600)
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
import {
  handleCreateSession,
  handleAddTurn,
  handleGetSession,
  handleListSessions,
  handleDeleteSession,
  handleLegacyRun,
} from "./llm-council/handlers.js";
import { handleTelegramLogin, handleAuthMe, handleAuthLogout, handleAuthRefresh, handleAuthSwitchTenant } from "./auth/handlers.js";
export { AuthNonce } from "./auth/nonce_do.js";

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

// ── Database client ───────────────────────────────────────────────────────────

/**
 * Create a new postgres client per request. Module-level singletons cause
 * "Cannot perform I/O on behalf of a different request" errors in Cloudflare
 * Workers because I/O objects are bound to the request context they were
 * created in. Hyperdrive manages actual PostgreSQL connection pooling, so
 * creating a new postgres.js instance per request has negligible overhead.
 */
function getSql(env) {
  return postgres(env.HYPERDRIVE.connectionString, {
    max: 1,           // one logical slot per request; Hyperdrive pools beyond this
    idle_timeout: 5,  // seconds — Workers are short-lived, release promptly
  });
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

// ── CSRF (stateless double-submit HMAC) ──────────────────────────────────────
// Per .omc/plans/hyperdrive-full-migration.md §Phase 1 CSRF Design.
// Token = base64url(payload) + "." + base64url(HMAC_SHA256(env.CSRF_SECRET, payload))
// where payload = "<random_id_16hex>.<expiry_unix_ms>". Cookie + header carry the
// same token (double-submit). Worker verifies HMAC + expiry + cookie==header match.
//
// Cookie attrs: __Host-csrf=<token>; Path=/; SameSite=Lax; Secure; Max-Age=3600
// HttpOnly intentionally OFF — SPA reads document.cookie and copies into header.
// Set CSRF_SECRET via: wrangler secret put CSRF_SECRET
//
// NOT WIRED INTO ROUTING YET — additive infrastructure only. Routing wire-up
// will follow in a subsequent commit alongside the first write endpoint.

const CSRF_TTL_MS = 60 * 60 * 1000;
const CSRF_COOKIE = "__Host-csrf";

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"],
  );
}

async function getCsrfToken(env) {
  if (!env.CSRF_SECRET) return jsonErr("csrf_secret_not_configured", 500);
  const rand = crypto.getRandomValues(new Uint8Array(16));
  const randHex = [...rand].map(b => b.toString(16).padStart(2, "0")).join("");
  const payload = `${randHex}.${Date.now() + CSRF_TTL_MS}`;
  const key = await importHmacKey(env.CSRF_SECRET);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const token = `${b64url(new TextEncoder().encode(payload))}.${b64url(sig)}`;
  const cookie = `${CSRF_COOKIE}=${token}; Path=/; SameSite=Lax; Secure; Max-Age=${CSRF_TTL_MS / 1000}`;
  return new Response(JSON.stringify({ csrf_token: token }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
    },
  });
}

async function requireCsrf(request, env) {
  if (!env.CSRF_SECRET) return jsonErr("csrf_secret_not_configured", 500);
  const header = request.headers.get("X-CSRF-Token") || request.headers.get("X-CSRFToken");
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookie = cookieHeader.split(/;\s*/)
    .find(c => c.startsWith(`${CSRF_COOKIE}=`))?.slice(CSRF_COOKIE.length + 1);
  if (!header || !cookie || header !== cookie) return jsonErr("csrf", 403);
  const [payloadB64, macB64] = header.split(".");
  if (!payloadB64 || !macB64) return jsonErr("csrf", 403);
  const payload = new TextDecoder().decode(b64urlDecode(payloadB64));
  const [, expiryStr] = payload.split(".");
  if (!expiryStr || Number(expiryStr) < Date.now()) return jsonErr("csrf_expired", 403);
  const key = await importHmacKey(env.CSRF_SECRET);
  const ok = await crypto.subtle.verify(
    "HMAC", key, b64urlDecode(macB64), new TextEncoder().encode(payload),
  );
  return ok ? null : jsonErr("csrf", 403);
}

// ── Cases write helpers ──────────────────────────────────────────────────────
// EDITABLE_FIELDS mirrors immi_case_downloader/web/helpers.py:13-20 verbatim.
// case_id is server-computed (SHA-256-12 of citation/url/title) — never accepted
// from client body to prevent forgery.

const EDITABLE_FIELDS = [
  "citation", "title", "court", "court_code", "date", "year", "url", "source",
  "judges", "catchwords", "outcome", "visa_type", "legislation",
  "user_notes", "tags", "case_nature", "legal_concepts",
  "visa_subclass", "visa_class_code",
  "applicant_name", "respondent", "country_of_origin",
  "visa_subclass_number", "hearing_date", "is_represented", "representative",
];

const COERCION = {
  year: (v) => { const n = Number(v); return Number.isInteger(n) ? n : null; },
  is_represented: (v) =>
    v === true || v === "true" || v === 1 || v === "1" ? true
    : v === false || v === "false" || v === 0 || v === "0" ? false
    : null,
};

function pickEditableFields(data, overrides = {}) {
  const out = { ...overrides };
  for (const f of EDITABLE_FIELDS) {
    if (data[f] === undefined || data[f] === null) continue;
    out[f] = COERCION[f] ? COERCION[f](data[f]) : String(data[f]);
    if (out[f] === null) delete out[f];
  }
  return out;
}

async function sha12(key) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(key)));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

async function safeJson(request) {
  try {
    const len = Number(request.headers.get("content-length") || "0");
    if (len > 32768) return null;          // 32 KB cap on JSON body
    return await request.json();
  } catch { return null; }
}

// Per plan REVISION 1 §M6: throttle write endpoints by CF-Connecting-IP.
// Returns a 429 Response when over limit, or null when allowed.
// Missing binding (e.g. `wrangler dev --local` without unsafe bindings)
// or binding error → null (fail open) so local dev isn't blocked.
async function throttle(request, binding) {
  if (!binding || typeof binding.limit !== "function") return null;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  try {
    const { success } = await binding.limit({ key: ip });
    if (success) return null;
    return jsonErr("rate limited", 429);
  } catch { return null; }
}

// ── Cases write handlers ─────────────────────────────────────────────────────

async function handlePostCase(request, env) {
  const data = await safeJson(request);
  if (!data) return jsonErr("invalid json");
  if (!data.title && !data.citation) return jsonErr("Title or citation is required");
  const caseId = await sha12(data.citation || data.url || data.title);
  const row = pickEditableFields(data, { case_id: caseId });
  const sql = getSql(env);
  const cols = Object.keys(row);
  const updateCols = cols.filter(c => c !== "case_id");
  const [inserted] = await sql`
    INSERT INTO ${sql(TABLE)} ${sql(row, cols)}
    ON CONFLICT (case_id) DO UPDATE SET ${sql(row, updateCols)}
    RETURNING *
  `;
  return Response.json({ case: inserted }, { status: 201 });
}

async function handlePutCase(caseId, request, env) {
  if (!HEX_ID_RE.test(caseId)) return jsonErr("Invalid case ID");
  const data = await safeJson(request);
  if (!data) return jsonErr("invalid json");
  const updates = pickEditableFields(data);
  delete updates.case_id;                  // never client-supplied for PUT
  if (!Object.keys(updates).length) return jsonErr("no editable fields");
  const sql = getSql(env);
  const [updated] = await sql`
    UPDATE ${sql(TABLE)}
    SET ${sql(updates, Object.keys(updates))}
    WHERE case_id = ${caseId}
    RETURNING *
  `;
  if (!updated) return jsonErr("Case not found", 404);
  return Response.json({ case: updated });
}

async function handleDeleteCase(caseId, env) {
  if (!HEX_ID_RE.test(caseId)) return jsonErr("Invalid case ID");
  const sql = getSql(env);
  const result = await sql`DELETE FROM ${sql(TABLE)} WHERE case_id = ${caseId}`;
  if (result.count === 0) return jsonErr("Case not found", 404);
  return Response.json({ success: true });
}

async function handleBatchCases(request, env) {
  const data = await safeJson(request);
  if (!data) return jsonErr("invalid json");
  const action = String(data.action ?? "");
  let ids = Array.isArray(data.case_ids) ? data.case_ids : null;
  if (!ids) return jsonErr("case_ids must be a list");
  ids = ids.filter(i => typeof i === "string" && HEX_ID_RE.test(i));
  if (!ids.length) return jsonErr("No valid case IDs provided");
  if (ids.length > 200) return jsonErr("Batch limited to 200 cases");
  const sql = getSql(env);
  if (action === "delete") {
    const result = await sql`DELETE FROM ${sql(TABLE)} WHERE case_id = ANY(${ids})`;
    return Response.json({ affected: result.count });
  }
  if (action === "tag") {
    const tag = String(data.tag ?? "").replace(/[,<>]/g, "").trim();
    if (!tag) return jsonErr("No tag provided");
    if (tag.length > 64) return jsonErr("Tag must be 64 characters or less");
    // Atomic merge: split existing comma-delimited tags, add new tag, dedupe, rejoin.
    const result = await sql`
      UPDATE ${sql(TABLE)}
      SET tags = (
        SELECT string_agg(t, ', ' ORDER BY t)
        FROM (
          SELECT DISTINCT trim(t) AS t
          FROM unnest(string_to_array(coalesce(tags, ''), ',') || ARRAY[${tag}]) AS t
          WHERE trim(t) <> ''
        ) sub
      )
      WHERE case_id = ANY(${ids})
    `;
    return Response.json({ affected: result.count });
  }
  return jsonErr(`Unknown action: ${action}`);
}

// ── Streaming export helpers + handlers ──────────────────────────────────────
// Per .omc/plans/hyperdrive-full-migration.md §Phase 1 #9 + Critic B4 fix.
// Uses a DEDICATED postgres client (NOT shared getSql) with idle_timeout: 0
// so long-running streams aren't dropped mid-flight. Worker has 30s CPU cap
// but streamed responses get unbounded wall time (Cloudflare exception).

// Full case columns matching ImmigrationCase dataclass (models.py:11-41).
const EXPORT_FIELDS = [
  "case_id", "citation", "title", "court", "court_code", "date", "year",
  "url", "judges", "catchwords", "outcome", "visa_type", "legislation",
  "text_snippet", "full_text_path", "source", "user_notes", "tags",
  "case_nature", "legal_concepts", "visa_subclass", "visa_class_code",
  "applicant_name", "respondent", "country_of_origin",
  "visa_subclass_number", "hearing_date", "is_represented", "representative",
  "visa_outcome_reason",
];

const EXPORT_MAX_ROWS = 50000;
const EXPORT_CURSOR_BATCH = 500;

function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function safeFilename(s) {
  return String(s).replace(/[^\w.-]/g, "_").slice(0, 100) || "export";
}

function ymd() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

async function streamExport(url, env, format) {
  const filters = parseCaseFilters(url.searchParams);
  if (filters.tag) return null;            // tag filter falls through to Flask
  // Dedicated client (NOT shared getSql) — idle_timeout 0 + max 1 connection.
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1, idle_timeout: 0, connect_timeout: 5, fetch_types: false,
  });
  let closed = false;
  const safeEnd = async () => {
    if (closed) return;
    closed = true;
    try { await sql.end({ timeout: 1 }); } catch { /* swallow */ }
  };

  const where = buildCasesWhere(sql, filters);
  if (!where) { await safeEnd(); return null; }
  // Honor ?limit=N (clamped to [1, EXPORT_MAX_ROWS]). Default = full dump.
  // Used by smoke tests / CI / preview integrations that don't want 112 MB.
  const exportLimit = safeInt(
    url.searchParams.get("limit"), EXPORT_MAX_ROWS, 1, EXPORT_MAX_ROWS,
  );
  const cursor = sql`
    SELECT ${sql(EXPORT_FIELDS)} FROM ${sql(TABLE)} WHERE ${where}
    ORDER BY year DESC NULLS LAST LIMIT ${exportLimit}
  `.cursor(EXPORT_CURSOR_BATCH);

  const enc = new TextEncoder();
  const filename = `immigration_cases_${ymd()}.${format}`;
  let cancelled = false;
  let firstRow = true;

  const stream = new ReadableStream({
    async start(controller) {
      if (format === "csv") {
        controller.enqueue(enc.encode("﻿"));   // UTF-8 BOM (matches Python utf-8-sig)
        controller.enqueue(enc.encode(EXPORT_FIELDS.map(csvCell).join(",") + "\n"));
      } else {
        controller.enqueue(enc.encode(`{"cases":[`));
      }
    },
    async pull(controller) {
      try {
        for await (const batch of cursor) {
          if (cancelled) break;
          let chunk = "";
          for (const row of batch) {
            if (format === "csv") {
              chunk += EXPORT_FIELDS.map(f => csvCell(row[f])).join(",") + "\n";
            } else {
              chunk += (firstRow ? "" : ",") + JSON.stringify(row);
              firstRow = false;
            }
          }
          if (chunk) controller.enqueue(enc.encode(chunk));
        }
        if (format === "json") controller.enqueue(enc.encode(`]}`));
        controller.close();
        await safeEnd();
      } catch (e) {
        controller.error(e);
        await safeEnd();
      }
    },
    cancel() { cancelled = true; safeEnd().catch(() => {}); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(filename)}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function handleExportCsv(url, env)  { return streamExport(url, env, "csv"); }
async function handleExportJson(url, env) { return streamExport(url, env, "json"); }

// ── Lexical full-text search (Phase 1 #8) ────────────────────────────────────
// Uses the GIN-indexed `fts` tsvector column from migration
// 20260218000000_initial_schema.sql:50 + websearch_to_tsquery for safe
// user-input parsing (handles quoted phrases, OR, - exclusion natively).
// Semantic + hybrid modes fall through to Flask until Phase 2 ships them.

async function handleSearch(url, env) {
  const q = (url.searchParams.get("q") ?? "").trim();
  const mode = (url.searchParams.get("mode") ?? "lexical").toLowerCase();
  const limit = safeInt(url.searchParams.get("limit"), 20, 1, 100);
  if (!q) return jsonOk({ cases: [], mode });
  if (q.length < 2) return jsonErr("query too short");
  if (mode !== "lexical") return null;     // → Flask (semantic/hybrid)
  const sql = getSql(env);
  const rows = await sql`
    SELECT ${sql(CASE_LIST_COLS)},
           ts_rank_cd(fts, websearch_to_tsquery('english', ${q})) AS rank
    FROM ${sql(TABLE)}
    WHERE fts @@ websearch_to_tsquery('english', ${q})
    ORDER BY rank DESC LIMIT ${limit}
  `;
  return jsonOk({ cases: rows, mode: "lexical" });
}

// ── Cache invalidate (Phase 1 #5) ────────────────────────────────────────────
// Worker is stateless — has no shared in-memory caches today. Returns
// success so existing SPA call sites stop forwarding to Flask Container.
// CDN edge cache is per-URL Cache-Control max-age (already short TTL).

async function handleCacheInvalidate() {
  return new Response(
    JSON.stringify({ invalidated: true, timestamp: Date.now() / 1000 }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "CDN-Cache-Control": "no-store",
        "Cache-Control": "no-store",
      },
    },
  );
}

// ── Collections export (Phase 1 #6, was bookmarks in plan) ───────────────────
// Path: POST /api/v1/collections/export (Flask url_prefix=/api/v1/collections,
// route=/export — bookmarks.py:12). Renders an HTML report bundle of up to
// 200 cases with optional per-case notes. Direct port of Python template.

function htmlEscape(s) {
  const str = String(s ?? "");
  return str.replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

function bookmarksField(label, value) {
  if (!value) return "";
  return `<tr><td class='label'>${htmlEscape(label)}</td><td>${htmlEscape(String(value))}</td></tr>`;
}

function bookmarksConcepts(conceptsStr) {
  if (!conceptsStr) return "";
  const items = String(conceptsStr).split(";").map(s => s.trim()).filter(Boolean);
  const badges = items.map(c => `<span class='concept'>${htmlEscape(c)}</span>`).join("");
  return `<div class='concepts'>${badges}</div>`;
}

function renderBookmarksHtml(name, cases, notes) {
  const today = new Date().toISOString().slice(0, 10);
  const blocks = cases.map(c => {
    const note = notes[c.case_id] || "";
    return `
    <div class="case-block">
      <div class="case-header">
        <span class="court-badge">${htmlEscape(c.court_code)}</span>
        <span class="citation">${htmlEscape(c.citation || c.title)}</span>
      </div>
      <table class="meta">
        ${bookmarksField('Citation', c.citation)}
        ${bookmarksField('Court', c.court)}
        ${bookmarksField('Date', c.date)}
        ${bookmarksField('Outcome', c.outcome)}
        ${bookmarksField('Judge(s)', c.judges)}
        ${bookmarksField('Case Nature', c.case_nature)}
        ${bookmarksField('Visa Type', c.visa_type)}
        ${bookmarksField('URL', c.url)}
      </table>
      ${bookmarksConcepts(c.legal_concepts)}
      ${note ? `<div class="note"><strong>Note:</strong> ${htmlEscape(note)}</div>` : ""}
    </div>`;
  }).join("");

  // CSS block ported verbatim from bookmarks.py:88-149.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${htmlEscape(name)} — IMMI-Case Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; color: #1a1a2e; background: #fff;
      padding: 32px; max-width: 860px; margin: 0 auto;
    }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .subtitle { color: #666; margin-bottom: 24px; font-size: 12px; }
    .case-block {
      border: 1px solid #e2e8f0; border-radius: 8px;
      padding: 16px; margin-bottom: 16px; break-inside: avoid;
    }
    .case-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .court-badge {
      background: #e8f0fe; color: #1a56db; border-radius: 4px;
      padding: 2px 8px; font-size: 11px; font-weight: 600;
      text-transform: uppercase; white-space: nowrap;
    }
    .citation { font-weight: 600; font-size: 14px; }
    table.meta { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    table.meta td { padding: 2px 4px; vertical-align: top; }
    td.label { color: #666; font-weight: 500; width: 120px; white-space: nowrap; }
    .concepts { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
    .concept {
      background: #f1f5f9; border-radius: 12px; padding: 1px 8px;
      font-size: 11px; color: #475569;
    }
    .note {
      margin-top: 10px; padding: 8px 12px; background: #fffbeb;
      border-left: 3px solid #f59e0b; border-radius: 0 4px 4px 0;
      font-size: 12px; color: #78350f;
    }
    @media print { body { padding: 16px; } .case-block { page-break-inside: avoid; } }
  </style>
</head>
<body>
  <h1>${htmlEscape(name)}</h1>
  <p class="subtitle">
    IMMI-Case Export &nbsp;·&nbsp; ${cases.length} case(s) &nbsp;·&nbsp; Generated ${today}
  </p>
  ${blocks}
</body>
</html>`;
}

async function handleCollectionExport(request, env) {
  const data = await safeJson(request);
  if (!data) return jsonErr("invalid json");
  const ids = Array.isArray(data.case_ids)
    ? data.case_ids.filter(i => typeof i === "string" && HEX_ID_RE.test(i))
    : [];
  if (!ids.length) return jsonErr("case_ids is required");
  if (ids.length > 200) return jsonErr("Maximum 200 cases per export");

  const name = String(data.collection_name ?? "Collection").slice(0, 200);
  const notes = (typeof data.case_notes === "object" && data.case_notes) || {};

  const sql = getSql(env);
  const rows = await sql`
    SELECT case_id, citation, title, court, court_code, date, outcome,
           judges, case_nature, visa_type, url, legal_concepts
    FROM ${sql(TABLE)} WHERE case_id = ANY(${ids})
  `;
  if (!rows.length) return jsonErr("No valid cases found", 404);

  const html = renderBookmarksHtml(name, rows, notes);
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(name)}.html"`,
    },
  });
}

// ── Taxonomy guided-search (Phase 1 #7) ──────────────────────────────────────
// Two flows:
//   find-precedents: filter cases by visa_subclass / country / legal_concepts
//   assess-judge:    canonical-name lookup + total case count
// Flask uses fuzzywuzzy alias matching on judges; Worker port uses pure
// ILIKE — documented regression in plan REVISION 1 (track follow-up).

async function handleGuidedSearch(request, env) {
  const data = await safeJson(request);
  if (!data) return jsonErr("invalid json");
  const flow = String(data.flow ?? "");
  if (!["find-precedents", "assess-judge"].includes(flow)) {
    return jsonErr("Invalid flow type");
  }
  const sql = getSql(env);

  if (flow === "find-precedents") {
    const visa = String(data.visa_subclass ?? "").trim();
    const country = String(data.country ?? "").trim();
    const concepts = Array.isArray(data.legal_concepts)
      ? data.legal_concepts.map(String)
      : data.legal_concepts ? [String(data.legal_concepts)] : [];
    const limit = safeInt(data.limit, 50, 1, 200);

    const where = [sql`TRUE`];
    if (visa) where.push(sql`visa_subclass ILIKE ${`%${visa}%`}`);
    if (country) where.push(sql`country_of_origin ILIKE ${`%${country}%`}`);
    if (concepts.length) {
      const ors = concepts
        .map(c => sql`legal_concepts ILIKE ${`%${c}%`}`)
        .reduce((a, b) => sql`${a} OR ${b}`);
      where.push(sql`(${ors})`);
    }
    const whereSql = where.reduce((a, b) => sql`${a} AND ${b}`);

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total FROM ${sql(TABLE)} WHERE ${whereSql}
    `;
    const rows = await sql`
      SELECT ${sql(CASE_LIST_COLS)} FROM ${sql(TABLE)} WHERE ${whereSql}
      ORDER BY year DESC NULLS LAST LIMIT ${limit}
    `;
    return Response.json({
      success: true, flow, results: rows,
      meta: {
        total_results: total,
        returned_results: rows.length,
        limit,
        filters_applied: { visa_subclass: visa, country, legal_concepts: concepts },
      },
    });
  }

  // assess-judge — pure ILIKE on judges column (no fuzzy matching for now).
  const judgeName = String(data.judge_name ?? "").trim();
  if (!judgeName) return jsonErr("Judge name is required for assess-judge flow");
  const norm = normaliseJudgeName(judgeName);
  if (!norm || !isRealJudgeName(norm)) return jsonErr("Invalid judge name");
  const [{ count }] = await sql`
    SELECT COUNT(*)::int AS count FROM ${sql(TABLE)}
    WHERE judges ILIKE ${`%${norm}%`}
  `;
  return Response.json({
    success: true,
    flow: "assess-judge",
    judge_name: norm,
    canonical_name: norm,
    profile_url: `/judge-profiles/${encodeURIComponent(norm)}`,
    meta: { total_cases: count },
  });
}

// ── Static data (ported from Python) ─────────────────────────────────────────

const VISA_FAMILIES = {
  Protection: "Refugee and humanitarian protection visas",
  Skilled:    "Skilled migration and employer-sponsored visas",
  Student:    "Student and education visas",
  Partner:    "Partner, spouse, and de facto visas",
  Parent:     "Parent and family reunion visas",
  Visitor:    "Tourist, visitor, and temporary activity visas",
  Business:   "Business innovation and investment visas",
  Bridging:   "Bridging visas (temporary stay while substantive visa processed)",
  Other:      "Other visa categories",
};

// Maps subclass → [name, family] — mirrors immi_case_downloader/visa_registry.py
const VISA_REGISTRY_RAW = {
  "866": ["Protection", "Protection"],
  "785": ["Temporary Protection", "Protection"],
  "790": ["Safe Haven Enterprise", "Protection"],
  "200": ["Refugee (Permanent)", "Protection"],
  "201": ["In-Country Special Humanitarian (Permanent)", "Protection"],
  "202": ["Global Special Humanitarian (Permanent)", "Protection"],
  "203": ["Emergency Rescue", "Protection"],
  "204": ["Woman at Risk", "Protection"],
  "786": ["Temporary (Humanitarian Concern)", "Protection"],
  "449": ["Humanitarian Stay (Temporary)", "Protection"],
  "189": ["Skilled Independent", "Skilled"],
  "190": ["Skilled Nominated", "Skilled"],
  "191": ["Permanent Residence (Skilled Regional)", "Skilled"],
  "186": ["Employer Nomination Scheme", "Skilled"],
  "187": ["Regional Sponsored Migration Scheme", "Skilled"],
  "457": ["Temporary Work (Skilled)", "Skilled"],
  "482": ["Temporary Skill Shortage", "Skilled"],
  "494": ["Skilled Employer Sponsored Regional (Provisional)", "Skilled"],
  "491": ["Skilled Work Regional (Provisional)", "Skilled"],
  "476": ["Skilled - Recognised Graduate", "Skilled"],
  "485": ["Temporary Graduate", "Skilled"],
  "489": ["Skilled Regional (Provisional)", "Skilled"],
  "407": ["Training", "Skilled"],
  "408": ["Temporary Activity", "Skilled"],
  "500": ["Student", "Student"],
  "590": ["Student Guardian", "Student"],
  "570": ["Independent ELICOS Sector", "Student"],
  "571": ["Schools Sector", "Student"],
  "572": ["Vocational Education and Training Sector", "Student"],
  "573": ["Higher Education Sector", "Student"],
  "574": ["Postgraduate Research Sector", "Student"],
  "575": ["Non-award Sector", "Student"],
  "576": ["AusAID or Defence Sector", "Student"],
  "309": ["Partner (Provisional)", "Partner"],
  "820": ["Partner (Temporary)", "Partner"],
  "801": ["Partner (Permanent)", "Partner"],
  "100": ["Partner (Migrant)", "Partner"],
  "300": ["Prospective Marriage", "Partner"],
  "461": ["New Zealand Citizen Family Relationship (Temporary)", "Partner"],
  "103": ["Parent", "Parent"],
  "143": ["Contributory Parent", "Parent"],
  "173": ["Contributory Parent (Temporary)", "Parent"],
  "804": ["Aged Parent", "Parent"],
  "884": ["Contributory Aged Parent (Temporary)", "Parent"],
  "864": ["Contributory Aged Parent", "Parent"],
  "600": ["Visitor", "Visitor"],
  "601": ["Electronic Travel Authority", "Visitor"],
  "651": ["eVisitor", "Visitor"],
  "400": ["Temporary Work (Short Stay Activity)", "Visitor"],
  "417": ["Working Holiday", "Visitor"],
  "462": ["Work and Holiday", "Visitor"],
  "188": ["Business Innovation and Investment (Provisional)", "Business"],
  "888": ["Business Innovation and Investment (Permanent)", "Business"],
  "132": ["Business Talent (Permanent)", "Business"],
  "891": ["Investor", "Business"],
  "892": ["State/Territory Sponsored Business Owner", "Business"],
  "893": ["State/Territory Sponsored Senior Executive", "Business"],
  "010": ["Bridging A", "Bridging"],
  "020": ["Bridging B", "Bridging"],
  "030": ["Bridging C", "Bridging"],
  "040": ["Bridging D", "Bridging"],
  "050": ["Bridging (General)", "Bridging"],
  "051": ["Bridging (Protection Visa Applicant)", "Bridging"],
  "060": ["Bridging E", "Bridging"],
  "070": ["Bridging (Removal Pending)", "Bridging"],
  "080": ["Bridging (Crew)", "Bridging"],
  "101": ["Child", "Other"],
  "102": ["Adoption", "Other"],
  "802": ["Child", "Other"],
  "445": ["Dependent Child", "Other"],
  "155": ["Resident Return", "Other"],
  "157": ["Resident Return (5 years)", "Other"],
  "444": ["Special Category (New Zealand citizen)", "Other"],
  "116": ["Carer", "Other"],
  "117": ["Orphan Relative", "Other"],
  "114": ["Aged Dependent Relative", "Other"],
  "115": ["Remaining Relative", "Other"],
  "836": ["Carer", "Other"],
  "856": ["Employer Nomination Scheme (ENS)", "Other"],
  "858": ["Distinguished Talent", "Other"],
};

// Pre-built API response format (mirrors get_registry_for_api())
const VISA_REGISTRY_API = {
  entries: Object.entries(VISA_REGISTRY_RAW).map(([subclass, [name, family]]) => ({ subclass, name, family })),
  families: VISA_FAMILIES,
};

// Mirrors DATA_DICTIONARY_FIELDS in immi_case_downloader/web/routes/api.py
const DATA_DICTIONARY_FIELDS = [
  { name: "case_id",        type: "string",  description: "SHA-256 hash (first 12 chars) of citation/URL/title",  example: "a1b2c3d4e5f6" },
  { name: "citation",       type: "string",  description: "Official case citation",                                 example: "[2024] AATA 1234" },
  { name: "title",          type: "string",  description: "Case title / party names",                               example: "Smith v Minister for Immigration" },
  { name: "court",          type: "string",  description: "Full court/tribunal name",                               example: "Administrative Appeals Tribunal" },
  { name: "court_code",     type: "string",  description: "Short court identifier",                                 example: "AATA" },
  { name: "date",           type: "string",  description: "Decision date (DD Month YYYY)",                          example: "15 March 2024" },
  { name: "year",           type: "integer", description: "Decision year",                                          example: "2024" },
  { name: "url",            type: "string",  description: "AustLII or Federal Court URL",                           example: "https://www.austlii.edu.au/..." },
  { name: "judges",         type: "string",  description: "Judge(s) or tribunal member(s)",                         example: "Deputy President S Smith" },
  { name: "catchwords",     type: "string",  description: "Key legal topics from the case",                          example: "MIGRATION - visa cancellation..." },
  { name: "outcome",        type: "string",  description: "Decision outcome",                                        example: "Dismissed" },
  { name: "visa_type",      type: "string",  description: "Visa subclass or category",                               example: "Subclass 866 Protection" },
  { name: "legislation",    type: "string",  description: "Referenced legislation",                                   example: "Migration Act 1958 (Cth) s 501" },
  { name: "text_snippet",   type: "string",  description: "Short excerpt from case text",                             example: "The Tribunal finds that..." },
  { name: "full_text_path", type: "string",  description: "Path to downloaded full text file",                        example: "downloaded_cases/case_texts/a1b2c3d4e5f6.txt" },
  { name: "source",         type: "string",  description: "Data source identifier",                                   example: "austlii" },
  { name: "user_notes",     type: "string",  description: "User-added notes",                                         example: "Important precedent for..." },
  { name: "tags",           type: "string",  description: "Comma-separated user tags",                                example: "review, important" },
  { name: "visa_subclass",  type: "string",  description: "Visa subclass number",                                     example: "866" },
  { name: "visa_class_code",type: "string",  description: "Visa class code letter",                                   example: "XA" },
  { name: "case_nature",    type: "string",  description: "Nature/category of the case (LLM-extracted)",              example: "Protection visa refusal" },
  { name: "legal_concepts", type: "string",  description: "Key legal concepts (LLM-extracted)",                       example: "well-founded fear, complementary protection" },
];

// Legislation metadata (no sections) — mirrors immi_case_downloader/data/legislations.json
// Sections (3 MB) are served by Flask; list/search use this lightweight inline const.
const LEGISLATIONS_META = [
  { id: "migration-act-1958", title: "Migration Act 1958", austlii_id: "consol_act/ma1958118", shortcode: "MA1958", type: "Act", jurisdiction: "Commonwealth", description: "The primary legislation governing migration to, from and within Australia. Establishes visa framework, deportation procedures, and rights of non-citizens.", sections_count: 940, last_amended: "", last_scraped: "2026-02-23T01:31:14.777025+00:00" },
  { id: "migration-regulations-1994", title: "Migration Regulations 1994", austlii_id: "consol_reg/mr1994227", shortcode: "MR1994", type: "Regulation", jurisdiction: "Commonwealth", description: "Subordinate legislation made under the Migration Act 1958. Sets out detailed criteria for visa applications and processing.", sections_count: 394, last_amended: "", last_scraped: "2026-02-23T01:37:57.011519+00:00" },
  { id: "australian-citizenship-act-2007", title: "Australian Citizenship Act 2007", austlii_id: "consol_act/aca2007254", shortcode: "ACA2007", type: "Act", jurisdiction: "Commonwealth", description: "Governs the acquisition, loss, and cessation of Australian citizenship. Establishes pathways to citizenship and criteria for maintaining citizenship status.", sections_count: 84, last_amended: "", last_scraped: "2026-02-23T01:39:22.320048+00:00" },
  { id: "australian-border-force-act-2015", title: "Australian Border Force Act 2015", austlii_id: "consol_act/abfa2015225", shortcode: "ABFA2015", type: "Act", jurisdiction: "Commonwealth", description: "Establishes the Australian Border Force (ABF) and its functions. Governs border enforcement, customs, and immigration compliance operations.", sections_count: 60, last_amended: "", last_scraped: "2026-02-23T01:40:43.535717+00:00" },
  { id: "administrative-review-tribunal-act-2024", title: "Administrative Review Tribunal Act 2024", austlii_id: "consol_act/arta2024336", shortcode: "ARTA2024", type: "Act", jurisdiction: "Commonwealth", description: "Establishes the Administrative Review Tribunal (ART), replacing the AAT from October 2024 for merits review of migration decisions.", sections_count: 318, last_amended: "", last_scraped: "2026-02-23T02:11:45.133872+00:00" },
];

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

  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request("https://cache.local/api/v1/stats");
  if (_cache) {
    const cached = await _cache.match(_cacheKey);
    if (cached) return cached;
  }

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

  const _statsRes = jsonOk(
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
  if (_cache) await _cache.put(_cacheKey, _statsRes.clone());
  return _statsRes;
}

/** GET /api/v1/filter-options — distinct filter values for UI dropdowns */
async function handleGetFilterOptions(env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request("https://cache.local/api/v1/filter-options");
  if (_cache) {
    const cached = await _cache.match(_cacheKey);
    if (cached) return cached;
  }

  const sql = getSql(env);

  const [courts, years, natures, visaTypes, sources, outcomes] = await Promise.all([
    sql`SELECT DISTINCT court_code AS v FROM ${sql(TABLE)} WHERE court_code IS NOT NULL ORDER BY v`,
    sql`SELECT DISTINCT year AS v       FROM ${sql(TABLE)} WHERE year IS NOT NULL ORDER BY v DESC`,
    sql`SELECT DISTINCT case_nature AS v FROM ${sql(TABLE)} WHERE case_nature IS NOT NULL AND case_nature <> '' ORDER BY v`,
    sql`SELECT DISTINCT visa_type AS v   FROM ${sql(TABLE)} WHERE visa_type IS NOT NULL AND visa_type <> '' ORDER BY v`,
    sql`SELECT DISTINCT source AS v      FROM ${sql(TABLE)} WHERE source IS NOT NULL ORDER BY v`,
    sql`SELECT DISTINCT outcome AS v     FROM ${sql(TABLE)} WHERE outcome IS NOT NULL AND outcome <> '' ORDER BY v`,
  ]);

  const _filterRes = jsonOk(
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
  if (_cache) await _cache.put(_cacheKey, _filterRes.clone());
  return _filterRes;
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
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request("https://cache.local/api/v1/analytics/outcomes");
  if (_cache) {
    const cached = await _cache.match(_cacheKey);
    if (cached) return cached;
  }

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

  const _outcomesRes = jsonOk({
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
  if (_cache) await _cache.put(_cacheKey, _outcomesRes.clone());
  return _outcomesRes;
}

/** GET /api/v1/analytics/judges — top judges/members by case count */
async function handleAnalyticsJudges(url, env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request(url.toString());
  if (_cache) { const cached = await _cache.match(_cacheKey); if (cached) return cached; }
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

  const _res = jsonOk({ judges }, "public, max-age=600, stale-while-revalidate=120");
  if (_cache) await _cache.put(_cacheKey, _res.clone());
  return _res;
}

/** GET /api/v1/analytics/legal-concepts — top legal concepts by frequency */
async function handleAnalyticsLegalConcepts(url, env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request(url.toString());
  if (_cache) { const cached = await _cache.match(_cacheKey); if (cached) return cached; }
  const limit = safeInt(url.searchParams.get("limit"), 20, 1, 100);
  const sql   = getSql(env);

  // Use direct SQL with LIMIT instead of the RPC function — the function has no LIMIT
  // and the LATERAL unnest over legal_concepts can produce thousands of rows, causing timeout.
  const rows = await sql`
    SELECT trim(c) AS concept_raw, COUNT(*)::int AS cnt
    FROM immigration_cases ic,
      LATERAL unnest(
        string_to_array(regexp_replace(ic.legal_concepts, ';', ',', 'g'), ',')
      ) AS c
    WHERE ic.legal_concepts IS NOT NULL AND ic.legal_concepts <> '' AND trim(c) <> ''
    GROUP BY trim(c)
    ORDER BY cnt DESC
    LIMIT 2000
  `;

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

  const _res = jsonOk({ concepts }, "public, max-age=600, stale-while-revalidate=120");
  if (_cache) await _cache.put(_cacheKey, _res.clone());
  return _res;
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

// ── Win / outcome helpers (ported from Python) ───────────────────────────────

const TRIBUNAL_CODES = new Set(["AATA", "ARTA", "MRTA", "RRTA"]);
const COURT_CODES    = new Set(["FCA", "FCCA", "FMCA", "FedCFamC2G", "HCA"]);
const TRIBUNAL_WIN   = new Set(["Remitted", "Set Aside", "Granted", "Quashed"]);
const COURT_WIN      = new Set(["Allowed", "Set Aside", "Granted", "Quashed"]);
const _ALL_WIN       = new Set([...TRIBUNAL_WIN, ...COURT_WIN]);

function isWin(normOutcome, courtCode) {
  if (TRIBUNAL_CODES.has(courtCode)) return TRIBUNAL_WIN.has(normOutcome);
  if (COURT_CODES.has(courtCode))    return COURT_WIN.has(normOutcome);
  return _ALL_WIN.has(normOutcome);
}

function roundRate(wins, total) {
  return total > 0 ? Math.round((wins / total) * 1000) / 10 : 0.0;
}

function splitConcepts(raw) {
  if (!raw) return [];
  return raw.split(/[,;]/).map(s => s.trim().replace(/[.,;:]+$/, "").toLowerCase()).filter(Boolean);
}

function cleanSubclass(raw) {
  if (!raw) return "";
  let val = String(raw).trim();
  if (!val || ["nan", "none", "null"].includes(val.toLowerCase())) return "";
  if (val.endsWith(".0")) val = val.slice(0, -2);
  return /^\d{1,4}$/.test(val) ? val : "";
}

// ── Visa Registry (ported from visa_registry.py) ──────────────────────────────

const _VISA_REGISTRY = new Map([
  ["866",["Protection","Protection"]], ["785",["Temporary Protection","Protection"]],
  ["790",["Safe Haven Enterprise","Protection"]], ["200",["Refugee (Permanent)","Protection"]],
  ["201",["In-Country Special Humanitarian (Permanent)","Protection"]],
  ["202",["Global Special Humanitarian (Permanent)","Protection"]],
  ["203",["Emergency Rescue","Protection"]], ["204",["Woman at Risk","Protection"]],
  ["786",["Temporary (Humanitarian Concern)","Protection"]],
  ["449",["Humanitarian Stay (Temporary)","Protection"]],
  ["189",["Skilled Independent","Skilled"]], ["190",["Skilled Nominated","Skilled"]],
  ["191",["Permanent Residence (Skilled Regional)","Skilled"]],
  ["186",["Employer Nomination Scheme","Skilled"]],
  ["187",["Regional Sponsored Migration Scheme","Skilled"]],
  ["457",["Temporary Work (Skilled)","Skilled"]], ["482",["Temporary Skill Shortage","Skilled"]],
  ["494",["Skilled Employer Sponsored Regional (Provisional)","Skilled"]],
  ["491",["Skilled Work Regional (Provisional)","Skilled"]],
  ["476",["Skilled - Recognised Graduate","Skilled"]], ["485",["Temporary Graduate","Skilled"]],
  ["489",["Skilled Regional (Provisional)","Skilled"]], ["407",["Training","Skilled"]],
  ["408",["Temporary Activity","Skilled"]], ["500",["Student","Student"]],
  ["590",["Student Guardian","Student"]], ["570",["Independent ELICOS Sector","Student"]],
  ["571",["Schools Sector","Student"]], ["572",["Vocational Education and Training Sector","Student"]],
  ["573",["Higher Education Sector","Student"]], ["574",["Postgraduate Research Sector","Student"]],
  ["575",["Non-award Sector","Student"]], ["576",["AusAID or Defence Sector","Student"]],
  ["309",["Partner (Provisional)","Partner"]], ["820",["Partner (Temporary)","Partner"]],
  ["801",["Partner (Permanent)","Partner"]], ["100",["Partner (Migrant)","Partner"]],
  ["300",["Prospective Marriage","Partner"]],
  ["461",["New Zealand Citizen Family Relationship (Temporary)","Partner"]],
  ["103",["Parent","Parent"]], ["143",["Contributory Parent","Parent"]],
  ["173",["Contributory Parent (Temporary)","Parent"]], ["804",["Aged Parent","Parent"]],
  ["884",["Contributory Aged Parent (Temporary)","Parent"]],
  ["864",["Contributory Aged Parent","Parent"]],
  ["600",["Visitor","Visitor"]], ["601",["Electronic Travel Authority","Visitor"]],
  ["651",["eVisitor","Visitor"]], ["400",["Temporary Work (Short Stay Activity)","Visitor"]],
  ["417",["Working Holiday","Visitor"]], ["462",["Work and Holiday","Visitor"]],
  ["188",["Business Innovation and Investment (Provisional)","Business"]],
  ["888",["Business Innovation and Investment (Permanent)","Business"]],
  ["132",["Business Talent (Permanent)","Business"]], ["891",["Investor","Business"]],
  ["892",["State/Territory Sponsored Business Owner","Business"]],
  ["893",["State/Territory Sponsored Senior Executive","Business"]],
  ["010",["Bridging A","Bridging"]], ["020",["Bridging B","Bridging"]],
  ["030",["Bridging C","Bridging"]], ["040",["Bridging D","Bridging"]],
  ["050",["Bridging (General)","Bridging"]], ["051",["Bridging (Protection Visa Applicant)","Bridging"]],
  ["060",["Bridging E","Bridging"]], ["070",["Bridging (Removal Pending)","Bridging"]],
  ["080",["Bridging (Crew)","Bridging"]], ["101",["Child","Other"]],
  ["102",["Adoption","Other"]], ["802",["Child","Other"]],
  ["445",["Dependent Child","Other"]], ["155",["Resident Return","Other"]],
  ["157",["Resident Return (5 years)","Other"]],
  ["444",["Special Category (New Zealand citizen)","Other"]],
  ["116",["Carer","Other"]], ["117",["Orphan Relative","Other"]],
  ["114",["Aged Dependent Relative","Other"]], ["115",["Remaining Relative","Other"]],
  ["836",["Carer","Other"]], ["856",["Employer Nomination Scheme (ENS)","Other"]],
  ["858",["Distinguished Talent","Other"]],
]);

function getFamily(subclass) {
  const entry = _VISA_REGISTRY.get(cleanSubclass(subclass));
  return entry ? entry[1] : "Other";
}

// ── Policy Events ─────────────────────────────────────────────────────────────

const _POLICY_EVENTS = [
  { month: "2015-07", label: "RRTA/MRTA merged into AATA" },
  { month: "2021-09", label: "FCCA → FedCFamC2G restructure" },
  { month: "2024-10", label: "AATA → ARTA transition" },
];

// ── Shared judge profile builder ──────────────────────────────────────────────

function buildJudgeProfile(name, caseRows, { courtBaselines = null, includeRecentCases = false } = {}) {
  if (!caseRows.length) {
    return {
      judge: { name, total_cases: 0, courts: [], active_years: { first: null, last: null } },
      approval_rate: 0.0, court_type: "unknown", outcome_distribution: {},
      visa_breakdown: [], concept_effectiveness: [], yearly_trend: [], nature_breakdown: [],
      representation_analysis: { unknown_count: 0 }, country_breakdown: [],
      court_comparison: [], recent_3yr_trend: [],
      ...(includeRecentCases ? { recent_cases: [] } : {}),
    };
  }
  let wins = 0;
  const outcomeDist = {}, courtCnt = {}, yearT = {}, yearW = {}, visaT = {}, visaW = {};
  const natT = {}, natW = {}, conceptT = {}, conceptW = {}, repT = {}, repW = {};
  const countryT = {}, countryW = {}, courtW2 = {};
  const years = [];

  for (const c of caseRows) {
    if (c.court_code) courtCnt[c.court_code] = (courtCnt[c.court_code] || 0) + 1;
    const norm = normaliseOutcome(c.outcome);
    outcomeDist[norm] = (outcomeDist[norm] || 0) + 1;
    const won = isWin(norm, c.court_code || "");
    if (won) wins++;
    if (c.year) {
      years.push(c.year);
      yearT[c.year] = (yearT[c.year] || 0) + 1;
      if (won) yearW[c.year] = (yearW[c.year] || 0) + 1;
    }
    const sc = cleanSubclass(c.visa_subclass);
    if (sc) { visaT[sc] = (visaT[sc] || 0) + 1; if (won) visaW[sc] = (visaW[sc] || 0) + 1; }
    const nat = (c.case_nature || "").trim();
    if (nat) { natT[nat] = (natT[nat] || 0) + 1; if (won) natW[nat] = (natW[nat] || 0) + 1; }
    for (const raw of splitConcepts(c.legal_concepts || "")) {
      const can = _CONCEPT_CANONICAL.get(raw);
      if (!can) continue;
      conceptT[can] = (conceptT[can] || 0) + 1; if (won) conceptW[can] = (conceptW[can] || 0) + 1;
    }
    const repRaw = (c.is_represented || "").trim().toLowerCase();
    const repKey = ["yes","true","1","represented"].includes(repRaw) ? "represented"
                 : ["no","false","0","unrepresented","self"].includes(repRaw) ? "self_represented" : null;
    if (repKey) { repT[repKey] = (repT[repKey]||0)+1; if (won) repW[repKey]=(repW[repKey]||0)+1; }
    const country = (c.country_of_origin || "").trim();
    if (country) { countryT[country]=(countryT[country]||0)+1; if (won) countryW[country]=(countryW[country]||0)+1; }
    if (c.court_code && won) courtW2[c.court_code] = (courtW2[c.court_code] || 0) + 1;
  }

  const total       = caseRows.length;
  const approvalRate= roundRate(wins, total);
  const courts      = Object.keys(courtCnt).sort();
  const allTrib     = courts.every(c => TRIBUNAL_CODES.has(c));
  const allCrt      = courts.every(c => COURT_CODES.has(c));
  const courtType   = allTrib ? "tribunal" : allCrt ? "court" : "mixed";

  const repAnalysis = {};
  for (const rk of ["represented","self_represented"])
    if (repT[rk]) repAnalysis[rk] = { total:repT[rk], win_rate:roundRate(repW[rk]||0, repT[rk]) };
  repAnalysis.unknown_count = total - Object.values(repT).reduce((s,v)=>s+v, 0);

  const courtComparison = [];
  if (courtBaselines) {
    for (const code of courts) {
      const jTotal = courtCnt[code];
      if (!jTotal) continue;
      const avg = courtBaselines[code];
      if (avg !== undefined) {
        const jRate = roundRate(courtW2[code]||0, jTotal);
        courtComparison.push({ court_code:code, judge_rate:jRate, court_avg_rate:avg, delta:Math.round((jRate-avg)*10)/10, judge_total:jTotal });
      }
    }
  }

  const maxYear   = years.length ? Math.max(...years) : 0;
  const yearlyTrend = Object.keys(yearT).sort().map(y => ({ year:parseInt(y), total:yearT[y], approval_rate:roundRate(yearW[y]||0, yearT[y]) }));

  const payload = {
    judge: { name, total_cases:total, courts, active_years:{ first:years.length?Math.min(...years):null, last:maxYear||null } },
    approval_rate: approvalRate, court_type: courtType,
    outcome_distribution: outcomeDist,
    visa_breakdown: Object.entries(visaT).sort((a,b)=>b[1]-a[1]).map(([sc,cnt])=>({ subclass:sc, total:cnt, win_rate:roundRate(visaW[sc]||0,cnt) })),
    concept_effectiveness: Object.entries(conceptT).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([concept,cnt])=>{ const wr=roundRate(conceptW[concept]||0,cnt); return { concept, total:cnt, win_rate:wr, baseline_rate:approvalRate, lift:approvalRate>0?Math.round((wr/approvalRate)*100)/100:0 }; }),
    yearly_trend: yearlyTrend,
    nature_breakdown: Object.entries(natT).sort((a,b)=>b[1]-a[1]).map(([nat,cnt])=>({ nature:nat, total:cnt, win_rate:roundRate(natW[nat]||0,cnt) })),
    representation_analysis: repAnalysis,
    country_breakdown: Object.entries(countryT).sort((a,b)=>b[1]-a[1]).slice(0,20).map(([country,cnt])=>({ country, total:cnt, win_rate:roundRate(countryW[country]||0,cnt) })),
    court_comparison: courtComparison,
    recent_3yr_trend: yearlyTrend.filter(y => y.year >= maxYear - 2),
  };
  if (includeRecentCases) {
    payload.recent_cases = [...caseRows].sort((a,b)=>(b.date_sort||0)-(a.date_sort||0)).slice(0,10).map(c => ({
      case_id:c.case_id, citation:c.citation, title:c.title, outcome:c.outcome, court_code:c.court_code,
      date: c.date_sort ? String(c.date_sort).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3") : null,
    }));
  }
  return payload;
}

// ── New Hyperdrive native handlers ────────────────────────────────────────────

/** GET /api/v1/stats/trends — court × year cross-tabulation */
async function handleStatsTrends(url, env) {
  const sql = getSql(env);
  const p   = url.searchParams;
  const court    = (p.get("court") || "").trim();
  const yearFrom = safeInt(p.get("year_from"), 0, 0, 2100);
  const yearTo   = safeInt(p.get("year_to"),   0, 0, 2100);
  const isFullRange = !court && (!yearFrom || yearFrom <= 2000) && (!yearTo || yearTo >= new Date().getFullYear());

  if (isFullRange) {
    const rows = await sql`SELECT * FROM get_court_year_trends()`;
    return jsonOk({ trends: rows }, "public, max-age=300, stale-while-revalidate=60");
  }
  const rows = await sql`
    SELECT year, court_code, COUNT(*)::int AS cnt FROM immigration_cases
    WHERE year IS NOT NULL AND court_code IS NOT NULL
    ${court    ? sql`AND court_code = ${court}` : sql``}
    ${yearFrom ? sql`AND year >= ${yearFrom}`   : sql``}
    ${yearTo   ? sql`AND year <= ${yearTo}`     : sql``}
    GROUP BY year, court_code ORDER BY year
  `;
  const byYear = {};
  for (const r of rows) {
    if (!byYear[r.year]) byYear[r.year] = { year: r.year };
    byYear[r.year][r.court_code] = r.cnt;
  }
  return jsonOk({ trends: Object.values(byYear).sort((a,b)=>a.year-b.year) }, "public, max-age=60");
}

/** GET /api/v1/analytics/filter-options — analytics page context-aware filter options */
async function handleAnalyticsFilterOptions(url, env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request(url.toString());
  if (_cache) { const cached = await _cache.match(_cacheKey); if (cached) return cached; }
  const sql = getSql(env);
  const p   = url.searchParams;
  const court    = (p.get("court") || "").trim();
  const yearFrom = safeInt(p.get("year_from"), 0, 0, 2100);
  const yearTo   = safeInt(p.get("year_to"),   0, 0, 2100);

  const [natures, subclasses, outcomes, totals] = await Promise.all([
    sql`SELECT case_nature, COUNT(*)::int AS cnt FROM immigration_cases WHERE case_nature IS NOT NULL AND case_nature <> '' ${court?sql`AND court_code=${court}`:sql``} ${yearFrom?sql`AND year>=${yearFrom}`:sql``} ${yearTo?sql`AND year<=${yearTo}`:sql``} GROUP BY case_nature ORDER BY cnt DESC LIMIT 60`,
    sql`SELECT visa_subclass, COUNT(*)::int AS cnt FROM immigration_cases WHERE visa_subclass IS NOT NULL AND visa_subclass <> '' ${court?sql`AND court_code=${court}`:sql``} ${yearFrom?sql`AND year>=${yearFrom}`:sql``} ${yearTo?sql`AND year<=${yearTo}`:sql``} GROUP BY visa_subclass ORDER BY cnt DESC LIMIT 80`,
    sql`SELECT outcome, COUNT(*)::int AS cnt FROM immigration_cases WHERE outcome IS NOT NULL AND outcome <> '' ${court?sql`AND court_code=${court}`:sql``} ${yearFrom?sql`AND year>=${yearFrom}`:sql``} ${yearTo?sql`AND year<=${yearTo}`:sql``} GROUP BY outcome ORDER BY cnt DESC`,
    sql`SELECT COUNT(*)::int AS total FROM immigration_cases WHERE 1=1 ${court?sql`AND court_code=${court}`:sql``} ${yearFrom?sql`AND year>=${yearFrom}`:sql``} ${yearTo?sql`AND year<=${yearTo}`:sql``}`,
  ]);
  const total = totals[0].total;

  const _res = jsonOk({
    query: { court:court||null, year_from:yearFrom||null, year_to:yearTo||null, total_matching:total },
    case_natures:    natures.map(r => ({ value:r.case_nature, count:r.cnt })),
    visa_subclasses: subclasses.map(r => { const sc=cleanSubclass(r.visa_subclass); const entry=_VISA_REGISTRY.get(sc); return { value:r.visa_subclass, label:entry?`${sc} - ${entry[0]}`:`Subclass ${r.visa_subclass}`, family:entry?entry[1]:"Other", count:r.cnt }; }),
    outcome_types:   outcomes.map(r => ({ value:normaliseOutcome(r.outcome), count:r.cnt })).filter(r=>r.value),
  }, "public, max-age=120, stale-while-revalidate=30");
  if (_cache) await _cache.put(_cacheKey, _res.clone());
  return _res;
}

/** GET /api/v1/analytics/monthly-trends — monthly win-rate time series */
async function handleAnalyticsMonthlyTrends(env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request("https://cache.local/api/v1/analytics/monthly-trends");
  if (_cache) {
    const cached = await _cache.match(_cacheKey);
    if (cached) return cached;
  }

  const sql  = getSql(env);
  // Try monthly RPC first; fall back to year-based query if function not yet deployed
  let rows;
  try {
    rows = await sql`SELECT * FROM get_analytics_monthly_trends()`;
  } catch {
    rows = await sql`
      SELECT (year::text || '01') AS month_key, court_code, outcome, COUNT(*)::int AS cnt
      FROM immigration_cases WHERE year IS NOT NULL AND year >= 2000
      GROUP BY 1,2,3 ORDER BY 1
    `;
  }
  const monthly = {};
  for (const r of rows) {
    if (!r.month_key || r.month_key.length < 6) continue;
    const key = `${r.month_key.slice(0,4)}-${r.month_key.slice(4,6)}`;
    if (!monthly[key]) monthly[key] = { total:0, wins:0 };
    monthly[key].total += r.cnt;
    if (isWin(normaliseOutcome(r.outcome), r.court_code||"")) monthly[key].wins += r.cnt;
  }
  const series = Object.entries(monthly).sort(([a],[b])=>a.localeCompare(b)).map(([month,{total,wins}]) => ({
    month, total, wins, win_rate: total>0?Math.round((wins/total)*1000)/10:0,
  }));
  const _trendsRes = jsonOk({ series, events: _POLICY_EVENTS }, "public, max-age=600, stale-while-revalidate=120");
  if (_cache) await _cache.put(_cacheKey, _trendsRes.clone());
  return _trendsRes;
}

/** GET /api/v1/analytics/flow-matrix — Sankey court → nature → outcome */
async function handleAnalyticsFlowMatrix(url, env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  if (_cache) {
    const cached = await _cache.match(new Request(url.toString()));
    if (cached) return cached;
  }

  const sql  = getSql(env);
  const topN = safeInt(url.searchParams.get("top_n"), 8, 1, 20);
  const rows = await sql`SELECT court_code, case_nature, outcome, COUNT(*)::int AS cnt FROM immigration_cases GROUP BY 1,2,3`;

  const natureCounts={}, outcomeCounts={};
  for (const r of rows) {
    const nat=(r.case_nature||"").trim()||"Unknown"; const out=normaliseOutcome(r.outcome);
    natureCounts[nat]=(natureCounts[nat]||0)+r.cnt; outcomeCounts[out]=(outcomeCounts[out]||0)+r.cnt;
  }
  const topNatures  = new Set(Object.entries(natureCounts).sort((a,b)=>b[1]-a[1]).slice(0,topN).map(([n])=>n));
  const topOutcomes = new Set(Object.entries(outcomeCounts).sort((a,b)=>b[1]-a[1]).slice(0,topN).map(([o])=>o));

  const courtNature={}, natureOutcome={};
  for (const r of rows) {
    const court=r.court_code||"Unknown"; let nat=(r.case_nature||"").trim()||"Unknown"; let out=normaliseOutcome(r.outcome);
    if (!topNatures.has(nat))  nat="Other Nature"; if (!topOutcomes.has(out)) out="Other";
    courtNature[`${court}||${nat}`]   =(courtNature[`${court}||${nat}`]  ||0)+r.cnt;
    natureOutcome[`${nat}||${out}`]   =(natureOutcome[`${nat}||${out}`]  ||0)+r.cnt;
  }
  const courtNames  =[...new Set(Object.keys(courtNature).map(k=>k.split("||")[0]))].sort();
  const natureNames =[...new Set([...Object.keys(courtNature).map(k=>k.split("||")[1]),...Object.keys(natureOutcome).map(k=>k.split("||")[0])])].sort();
  const outcomeNames=[...new Set(Object.keys(natureOutcome).map(k=>k.split("||")[1]))].sort();

  const nodes=[], nodeIndex={};
  for (const n of courtNames)   { nodeIndex[`court:${n}`]  =nodes.length; nodes.push({name:n,layer:"court"}); }
  for (const n of natureNames)  { nodeIndex[`nature:${n}`] =nodes.length; nodes.push({name:n,layer:"nature"}); }
  for (const n of outcomeNames) { nodeIndex[`outcome:${n}`]=nodes.length; nodes.push({name:n,layer:"outcome"}); }
  const links=[];
  for (const [k,v] of Object.entries(courtNature))  { const [c,n]=k.split("||"); const src=nodeIndex[`court:${c}`],tgt=nodeIndex[`nature:${n}`]; if(src!==undefined&&tgt!==undefined) links.push({source:src,target:tgt,value:v}); }
  for (const [k,v] of Object.entries(natureOutcome)) { const [n,o]=k.split("||"); const src=nodeIndex[`nature:${n}`],tgt=nodeIndex[`outcome:${o}`]; if(src!==undefined&&tgt!==undefined) links.push({source:src,target:tgt,value:v}); }
  const _flowRes = jsonOk({ nodes, links }, "public, max-age=600, stale-while-revalidate=120");
  if (_cache) await _cache.put(new Request(url.toString()), _flowRes.clone());
  return _flowRes;
}

// ── Judge photo R2 serving (Phase 1 #11) ─────────────────────────────────────
// GET /api/v1/judge-photo/<filename> → R2 bucket immi-case-judge-photos.
// Replaces Flask api.py:2560 route which 404'd in production because
// downloaded_cases/judge_photos is .dockerignored. Bucket binding declared
// in wrangler.toml [[r2_buckets]] block; populated via:
//   wrangler r2 object put immi-case-judge-photos/<file> --file <local>

const JUDGE_PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
// Defense-in-depth path-traversal guard. Flask uses Path.resolve().relative_to().
// Our regex refuses /, \, .., null bytes, and limits to filename-safe chars.
const JUDGE_PHOTO_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

async function handleJudgePhoto(filename, env) {
  if (!env.JUDGE_PHOTOS) return null;          // binding absent → fall through to Flask
  if (!JUDGE_PHOTO_NAME_RE.test(filename)) return jsonErr("Not found", 404);
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  if (!JUDGE_PHOTO_EXTS.has(ext)) return jsonErr("Not found", 404);

  const obj = await env.JUDGE_PHOTOS.get(filename);
  if (!obj) return jsonErr("Not found", 404);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.get("Content-Type")) {
    const mime = ext === ".png"  ? "image/png"
              : ext === ".webp" ? "image/webp"
              :                    "image/jpeg";
    headers.set("Content-Type", mime);
  }
  // 1 day at the edge — judge photos rarely change
  headers.set("Cache-Control", "public, max-age=86400");
  return new Response(obj.body, { headers });
}

/** GET /api/v1/analytics/judge-bio — biographical data for a judge by name */
async function handleAnalyticsJudgeBio(url, env) {
  const sql  = getSql(env);
  const name = (url.searchParams.get("name") || "").trim();
  if (!name) return jsonErr("name is required");
  // Tokenise on whitespace; require each token to appear (AND of ILIKEs).
  // Handles middle names + title prefixes — query "Karen McNamara" matches
  // DB "The Hon Karen Jane McNamara"; "Arthur Glass" matches "Dr Arthur Stanley Glass".
  const tokens = name.split(/\s+/).filter(Boolean);
  if (!tokens.length) return jsonErr("name is required");
  const conds = tokens.map(t => sql`full_name ILIKE ${"%" + t + "%"}`);
  const where = conds.reduce((acc, c, i) => i === 0 ? c : sql`${acc} AND ${c}`);
  const rows = await sql`SELECT * FROM judge_bios WHERE ${where} ORDER BY length(full_name) ASC LIMIT 1`;
  if (!rows.length) return jsonOk({ found: false });
  // `found: true` MUST come after spread — DB has its own `found` column
  // (sync script bookkeeping, often null/false), and frontend JudgeHero.tsx
  // gates photo display on `bio.found && bio.photo_url`. Spread-first lets
  // the row's null/false override our row-exists signal.
  return jsonOk({ ...rows[0], found: true });
}

/** GET /api/v1/analytics/visa-families — win rates by visa family */
async function handleAnalyticsVisaFamilies(env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request("https://cache.local/api/v1/analytics/visa-families");
  if (_cache) { const cached = await _cache.match(_cacheKey); if (cached) return cached; }
  const sql  = getSql(env);
  const rows = await sql`SELECT visa_subclass, court_code, outcome, COUNT(*)::int AS cnt FROM immigration_cases WHERE visa_subclass IS NOT NULL AND visa_subclass <> '' GROUP BY 1,2,3`;
  const familyT={}, familyW={};
  let totalCases=0;
  for (const r of rows) {
    const sc=cleanSubclass(r.visa_subclass); if (!sc) continue;
    const family=getFamily(sc); const norm=normaliseOutcome(r.outcome);
    familyT[family]=(familyT[family]||0)+r.cnt;
    if (isWin(norm,r.court_code||"")) familyW[family]=(familyW[family]||0)+r.cnt;
    totalCases+=r.cnt;
  }
  const families=Object.entries(familyT).sort((a,b)=>b[1]-a[1]).map(([name,total])=>({ family:name, total, win_count:familyW[name]||0, win_rate:roundRate(familyW[name]||0,total) }));
  const _res = jsonOk({ families, total_cases: totalCases }, "public, max-age=600, stale-while-revalidate=120");
  if (_cache) await _cache.put(_cacheKey, _res.clone());
  return _res;
}

/** GET /api/v1/analytics/success-rate — multi-factor success rate analysis */
async function handleAnalyticsSuccessRate(url, env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request(url.toString());
  if (_cache) { const cached = await _cache.match(_cacheKey); if (cached) return cached; }
  const sql = getSql(env);
  const p   = url.searchParams;
  const court      = (p.get("court")||"").trim();
  const yearFrom   = safeInt(p.get("year_from"),0,0,2100);
  const yearTo     = safeInt(p.get("year_to"),  0,0,2100);
  const visaSub    = (p.get("visa_subclass")||"").trim();
  const caseNature = (p.get("case_nature")||"").trim();

  const [baseRows, conceptRows] = await Promise.all([
    sql`SELECT court_code, outcome, year, COUNT(*)::int AS cnt FROM immigration_cases WHERE 1=1 ${court?sql`AND court_code=${court}`:sql``} ${yearFrom?sql`AND year>=${yearFrom}`:sql``} ${yearTo?sql`AND year<=${yearTo}`:sql``} ${visaSub?sql`AND visa_subclass=${visaSub}`:sql``} ${caseNature?sql`AND lower(case_nature)=${caseNature.toLowerCase()}`:sql``} GROUP BY 1,2,3`,
    sql`SELECT trim(c) AS concept_raw, ic.court_code, ic.outcome, COUNT(*)::int AS cnt FROM immigration_cases ic, LATERAL unnest(string_to_array(regexp_replace(ic.legal_concepts,';',',','g'),',')) AS c WHERE ic.legal_concepts IS NOT NULL AND ic.legal_concepts <> '' AND trim(c) <> '' ${court?sql`AND ic.court_code=${court}`:sql``} ${yearFrom?sql`AND ic.year>=${yearFrom}`:sql``} ${yearTo?sql`AND ic.year<=${yearTo}`:sql``} ${visaSub?sql`AND ic.visa_subclass=${visaSub}`:sql``} ${caseNature?sql`AND lower(ic.case_nature)=${caseNature.toLowerCase()}`:sql``} GROUP BY 1,2,3 ORDER BY cnt DESC LIMIT 3000`,
  ]);

  let total=0, wins=0; const yearT={}, yearW={}, courtCodes=new Set();
  for (const r of baseRows) {
    const norm=normaliseOutcome(r.outcome); const won=isWin(norm,r.court_code||"");
    total+=r.cnt; if(won) wins+=r.cnt;
    if(r.court_code) courtCodes.add(r.court_code);
    if(r.year){ yearT[r.year]=(yearT[r.year]||0)+r.cnt; if(won) yearW[r.year]=(yearW[r.year]||0)+r.cnt; }
  }
  const overallRate=roundRate(wins,total);
  const allTrib=[...courtCodes].every(c=>TRIBUNAL_CODES.has(c)); const allCrt=[...courtCodes].every(c=>COURT_CODES.has(c));
  const courtType=allTrib?"tribunal":allCrt?"court":"mixed";
  const winOutcomes=allTrib?[...TRIBUNAL_WIN]:allCrt?[...COURT_WIN]:[..._ALL_WIN];

  const conceptT={}, conceptW={};
  for (const r of conceptRows) {
    const raw=(r.concept_raw||"").trim().replace(/[.,;:]+$/,"").toLowerCase();
    const can=_CONCEPT_CANONICAL.get(raw); if(!can) continue;
    const won=isWin(normaliseOutcome(r.outcome),r.court_code||"");
    conceptT[can]=(conceptT[can]||0)+r.cnt; if(won) conceptW[can]=(conceptW[can]||0)+r.cnt;
  }
  const byConcept=Object.entries(conceptT).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([concept,cnt])=>{ const wr=roundRate(conceptW[concept]||0,cnt); return {concept,total:cnt,win_rate:wr,lift:overallRate>0?Math.round((wr/overallRate)*100)/100:0}; });
  const trend=Object.keys(yearT).sort().map(y=>({year:parseInt(y),rate:roundRate(yearW[y]||0,yearT[y]),count:yearT[y]}));

  const _res = jsonOk({
    query:{court:court||null,year_from:yearFrom||null,year_to:yearTo||null,visa_subclass:visaSub||null,case_nature:caseNature||null,legal_concepts:[],total_matching:total},
    success_rate:{overall:overallRate,court_type:courtType,win_outcomes:winOutcomes,win_count:wins,loss_count:Math.max(0,total-wins),confidence:total>100?"high":total>=20?"medium":"low"},
    by_concept:byConcept, top_combos:[], trend,
  }, "public, max-age=120, stale-while-revalidate=30");
  if (_cache) await _cache.put(_cacheKey, _res.clone());
  return _res;
}

/** GET /api/v1/analytics/concept-effectiveness — per-concept win-rate and lift */
async function handleAnalyticsConceptEffectiveness(url, env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request(url.toString());
  if (_cache) { const cached = await _cache.match(_cacheKey); if (cached) return cached; }
  const sql   = getSql(env);
  const limit = safeInt(url.searchParams.get("limit"), 30, 1, 100);
  const [baseRows, conceptRows] = await Promise.all([
    sql`SELECT court_code, outcome, COUNT(*)::int AS cnt FROM immigration_cases GROUP BY 1,2`,
    sql`SELECT trim(c) AS concept_raw, ic.court_code, ic.outcome, COUNT(*)::int AS cnt FROM immigration_cases ic, LATERAL unnest(string_to_array(regexp_replace(ic.legal_concepts,';',',','g'),',')) AS c WHERE ic.legal_concepts IS NOT NULL AND ic.legal_concepts <> '' AND trim(c) <> '' GROUP BY 1,2,3 ORDER BY cnt DESC LIMIT 5000`,
  ]);
  let baseTotal=0, baseWins=0;
  for (const r of baseRows) { baseTotal+=r.cnt; if(isWin(normaliseOutcome(r.outcome),r.court_code||"")) baseWins+=r.cnt; }
  const baselineRate=roundRate(baseWins,baseTotal);

  const conceptT={}, conceptW={}, conceptByCourt={};
  for (const r of conceptRows) {
    const raw=(r.concept_raw||"").trim().replace(/[.,;:]+$/,"").toLowerCase();
    const can=_CONCEPT_CANONICAL.get(raw); if(!can) continue;
    const won=isWin(normaliseOutcome(r.outcome),r.court_code||"");
    conceptT[can]=(conceptT[can]||0)+r.cnt; if(won) conceptW[can]=(conceptW[can]||0)+r.cnt;
    if(r.court_code){
      if(!conceptByCourt[can]) conceptByCourt[can]={};
      const d=conceptByCourt[can][r.court_code]??={total:0,wins:0};
      d.total+=r.cnt; if(won) d.wins+=r.cnt;
    }
  }
  const concepts=Object.entries(conceptT).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([name,cnt])=>{
    const wr=roundRate(conceptW[name]||0,cnt);
    const byCourt={}; for(const [code,d] of Object.entries(conceptByCourt[name]||{})) byCourt[code]={total:d.total,win_rate:roundRate(d.wins,d.total)};
    return {name,total:cnt,win_rate:wr,lift:baselineRate>0?Math.round((wr/baselineRate)*100)/100:0,by_court:byCourt};
  });
  const _res = jsonOk({ baseline_rate: baselineRate, concepts }, "public, max-age=600, stale-while-revalidate=120");
  if (_cache) await _cache.put(_cacheKey, _res.clone());
  return _res;
}

/** GET /api/v1/analytics/concept-cooccurrence — concept pair co-occurrence matrix */
async function handleAnalyticsConceptCooccurrence(url, env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request(url.toString());
  if (_cache) { const cached = await _cache.match(_cacheKey); if (cached) return cached; }
  const sql      = getSql(env);
  const limit    = safeInt(url.searchParams.get("limit"),     15, 2, 30);
  const minCount = safeInt(url.searchParams.get("min_count"), 50, 1, 1000000);

  const [topRaw, pairRows, [{ bw, bt }]] = await Promise.all([
    sql`SELECT trim(c) AS concept_raw, COUNT(*)::int AS cnt FROM immigration_cases ic, LATERAL unnest(string_to_array(regexp_replace(ic.legal_concepts,';',',','g'),',')) AS c WHERE ic.legal_concepts IS NOT NULL AND ic.legal_concepts <> '' AND trim(c) <> '' GROUP BY trim(c) ORDER BY cnt DESC LIMIT 2000`,
    sql`WITH cc AS (SELECT ic.case_id, ic.outcome, ic.court_code, trim(c) AS cr FROM immigration_cases ic, LATERAL unnest(string_to_array(regexp_replace(ic.legal_concepts,';',',','g'),',')) AS c WHERE ic.legal_concepts IS NOT NULL AND ic.legal_concepts <> '' AND trim(c) <> '') SELECT a.cr AS ca, b.cr AS cb, a.outcome, a.court_code, COUNT(*)::int AS cnt FROM cc a JOIN cc b ON a.case_id=b.case_id AND a.cr<b.cr GROUP BY 1,2,3,4 HAVING COUNT(*)>=5 ORDER BY cnt DESC LIMIT 2000`,
    sql`SELECT SUM(CASE WHEN outcome ILIKE '%remit%' OR outcome ILIKE '%set aside%' OR outcome ILIKE '%allow%' OR outcome ILIKE '%grant%' OR outcome ILIKE '%quash%' THEN 1 ELSE 0 END)::int AS bw, COUNT(*)::int AS bt FROM immigration_cases`,
  ]);

  const canonCount={};
  for (const r of topRaw) { const raw=(r.concept_raw||"").trim().replace(/[.,;:]+$/,"").toLowerCase(); const can=_CONCEPT_CANONICAL.get(raw); if(!can) continue; canonCount[can]=(canonCount[can]||0)+r.cnt; }
  const topConcepts=Object.entries(canonCount).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([n])=>n);
  const baselineRate=roundRate(bw,bt);

  const pairT={}, pairW={};
  for (const r of pairRows) {
    const rawA=(r.ca||"").trim().replace(/[.,;:]+$/,"").toLowerCase(); const rawB=(r.cb||"").trim().replace(/[.,;:]+$/,"").toLowerCase();
    const canA=_CONCEPT_CANONICAL.get(rawA), canB=_CONCEPT_CANONICAL.get(rawB);
    if(!canA||!canB||canA===canB) continue;
    const [a,b]=canA<canB?[canA,canB]:[canB,canA]; const key=`${a}|||${b}`;
    pairT[key]=(pairT[key]||0)+r.cnt;
    if(isWin(normaliseOutcome(r.outcome),r.court_code||"")) pairW[key]=(pairW[key]||0)+r.cnt;
  }
  const matrix={}, topPairs=[];
  for (const [key,count] of Object.entries(pairT)) {
    if(count<minCount) continue;
    const [a,b]=key.split("|||"); const wr=roundRate(pairW[key]||0,count); const cell={count,win_rate:wr};
    (matrix[a]??={})[b]=cell; (matrix[b]??={})[a]=cell;
    topPairs.push({a,b,count,win_rate:wr,lift:baselineRate>0?Math.round((wr/baselineRate)*100)/100:0});
  }
  topPairs.sort((x,y)=>y.count-x.count);
  const _res = jsonOk({ concepts:topConcepts, matrix, top_pairs:topPairs }, "public, max-age=600, stale-while-revalidate=120");
  if (_cache) await _cache.put(_cacheKey, _res.clone());
  return _res;
}

/** GET /api/v1/analytics/concept-trends — concept usage time series + emerging/declining */
async function handleAnalyticsConceptTrends(url, env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request(url.toString());
  if (_cache) { const cached = await _cache.match(_cacheKey); if (cached) return cached; }
  const sql   = getSql(env);
  const limit = safeInt(url.searchParams.get("limit"), 10, 1, 30);
  const rows  = await sql`SELECT trim(c) AS concept_raw, ic.year, ic.court_code, ic.outcome, COUNT(*)::int AS cnt FROM immigration_cases ic, LATERAL unnest(string_to_array(regexp_replace(ic.legal_concepts,';',',','g'),',')) AS c WHERE ic.legal_concepts IS NOT NULL AND ic.legal_concepts <> '' AND trim(c) <> '' AND ic.year IS NOT NULL GROUP BY 1,2,3,4 ORDER BY cnt DESC LIMIT 10000`;

  const canonFreq={}, canonYearT={}, canonYearW={};
  for (const r of rows) {
    const raw=(r.concept_raw||"").trim().replace(/[.,;:]+$/,"").toLowerCase();
    const can=_CONCEPT_CANONICAL.get(raw); if(!can) continue;
    const won=isWin(normaliseOutcome(r.outcome),r.court_code||"");
    canonFreq[can]=(canonFreq[can]||0)+r.cnt;
    if(!canonYearT[can]) canonYearT[can]={}; if(!canonYearW[can]) canonYearW[can]={};
    canonYearT[can][r.year]=(canonYearT[can][r.year]||0)+r.cnt;
    if(won) canonYearW[can][r.year]=(canonYearW[can][r.year]||0)+r.cnt;
  }
  const tracked=Object.entries(canonFreq).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([n])=>n);
  const allYears=[...new Set(rows.map(r=>r.year).filter(Boolean))].sort((a,b)=>a-b);
  const latestYear=allYears.length?allYears[allYears.length-1]:0;
  const recentYrs=new Set([latestYear,latestYear-1]), previousYrs=new Set([latestYear-2,latestYear-3]);

  const series={}, emerging=[], declining=[];
  for (const concept of tracked) {
    const yt=canonYearT[concept]||{}, yw=canonYearW[concept]||{};
    series[concept]=Object.keys(yt).sort().map(y=>({year:parseInt(y),count:yt[y],win_rate:roundRate(yw[y]||0,yt[y])}));
    const recent=[...recentYrs].reduce((s,y)=>s+(yt[y]||0),0);
    const previous=[...previousYrs].reduce((s,y)=>s+(yt[y]||0),0);
    if(recent===0&&previous===0) continue;
    const growthPct=previous===0&&recent>0?100:previous===0?0:Math.round(((recent-previous)/previous)*1000)/10;
    if(growthPct>25)  emerging.push({name:concept,growth_pct:growthPct,recent_count:recent});
    if(growthPct<-25) declining.push({name:concept,decline_pct:growthPct,recent_count:recent});
  }
  emerging.sort((a,b)=>b.growth_pct-a.growth_pct); declining.sort((a,b)=>a.decline_pct-b.decline_pct);
  const _res = jsonOk({ series, emerging, declining }, "public, max-age=600, stale-while-revalidate=120");
  if (_cache) await _cache.put(_cacheKey, _res.clone());
  return _res;
}

/** GET /api/v1/analytics/judge-leaderboard — judges ranked by cases / approval rate */
async function handleAnalyticsJudgeLeaderboard(url, env) {
  // Worker-level cache: skip 3x full-table-scan SQL on repeated requests (TTL=600s)
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  if (_cache) {
    const cached = await _cache.match(new Request(url.toString()));
    if (cached) return cached;
  }

  const sql      = getSql(env);
  const p        = url.searchParams;
  const sortBy   = p.get("sort_by") || "cases";
  const nameQ    = (p.get("name_q") || "").trim().toLowerCase();
  const limit    = safeInt(p.get("limit"),     50, 1, 200);
  const minCases = safeInt(p.get("min_cases"),  1, 1, 100000);
  if (!["cases","approval_rate","name"].includes(sortBy)) return jsonErr("Invalid sort_by. Allowed: approval_rate, cases, name");

  const [rows, yearRows, visaRows] = await Promise.all([
    sql`SELECT trim(j) AS judge_raw, ic.court_code, ic.outcome, COUNT(*)::int AS cnt FROM immigration_cases ic, LATERAL unnest(string_to_array(regexp_replace(ic.judges,';',',','g'),',')) AS j WHERE ic.judges IS NOT NULL AND ic.judges <> '' AND trim(j) <> '' GROUP BY 1,2,3 ORDER BY cnt DESC LIMIT 10000`,
    sql`SELECT trim(j) AS judge_raw, MIN(ic.year)::int AS first_year, MAX(ic.year)::int AS last_year FROM immigration_cases ic, LATERAL unnest(string_to_array(regexp_replace(ic.judges,';',',','g'),',')) AS j WHERE ic.judges IS NOT NULL AND ic.judges <> '' AND trim(j) <> '' AND ic.year IS NOT NULL GROUP BY 1`,
    sql`SELECT trim(j) AS judge_raw, ic.visa_subclass, COUNT(*)::int AS cnt FROM immigration_cases ic, LATERAL unnest(string_to_array(regexp_replace(ic.judges,';',',','g'),',')) AS j WHERE ic.judges IS NOT NULL AND ic.judges <> '' AND trim(j) <> '' AND ic.visa_subclass IS NOT NULL AND ic.visa_subclass <> '' GROUP BY 1,2`
  ]);

  const judgeTotal={}, judgeWins={}, judgeCourts={}, judgeCanon={}, judgeOutcomes={};
  for (const r of rows) {
    const name=normaliseJudgeName(r.judge_raw); if(!name||!isRealJudgeName(name)||_JUDGE_BLOCKLIST.has(name.toLowerCase())) continue;
    const key=name.toLowerCase(); judgeCanon[key]??=name;
    const won=isWin(normaliseOutcome(r.outcome),r.court_code||"");
    judgeTotal[key]=(judgeTotal[key]||0)+r.cnt; if(won) judgeWins[key]=(judgeWins[key]||0)+r.cnt;
    if(r.court_code){ if(!judgeCourts[key]) judgeCourts[key]=new Set(); judgeCourts[key].add(r.court_code); }
    if(r.outcome){ const o=normaliseOutcome(r.outcome)||r.outcome; if(!judgeOutcomes[key]) judgeOutcomes[key]={}; judgeOutcomes[key][o]=(judgeOutcomes[key][o]||0)+r.cnt; }
  }
  const yearMap={};
  for (const r of yearRows) {
    const name=normaliseJudgeName(r.judge_raw); if(!name||!isRealJudgeName(name)||_JUDGE_BLOCKLIST.has(name.toLowerCase())) continue;
    const key=name.toLowerCase();
    if(!yearMap[key]) yearMap[key]={first:r.first_year,last:r.last_year};
    else { if(r.first_year!==null&&(yearMap[key].first===null||r.first_year<yearMap[key].first)) yearMap[key].first=r.first_year; if(r.last_year!==null&&(yearMap[key].last===null||r.last_year>yearMap[key].last)) yearMap[key].last=r.last_year; }
  }
  const judgeVisas={};
  for (const r of visaRows) {
    const name=normaliseJudgeName(r.judge_raw); if(!name||!isRealJudgeName(name)||_JUDGE_BLOCKLIST.has(name.toLowerCase())) continue;
    const key=name.toLowerCase();
    if(!judgeVisas[key]) judgeVisas[key]=new Map();
    judgeVisas[key].set(r.visa_subclass, (judgeVisas[key].get(r.visa_subclass)||0)+r.cnt);
  }
  const topVisasFor=(key)=>{
    const m=judgeVisas[key]; if(!m) return [];
    return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([subclass,count])=>({subclass,count}));
  };
  let judges=Object.entries(judgeTotal)
    .filter(([key,cnt])=>cnt>=minCases&&(!nameQ||key.includes(nameQ)||judgeCanon[key].toLowerCase().includes(nameQ)))
    .map(([key,total])=>({ name:judgeCanon[key], display_name:judgeCanon[key], total_cases:total, approval_rate:roundRate(judgeWins[key]||0,total), courts:[...(judgeCourts[key]||[])].sort(), primary_court:judgeCourts[key]?[...judgeCourts[key]][0]:null, top_visa_subclasses:topVisasFor(key), active_years:yearMap[key]??{first:null,last:null}, outcome_summary:judgeOutcomes[key]||{} }));

  if(sortBy==="approval_rate") judges.sort((a,b)=>b.approval_rate-a.approval_rate||b.total_cases-a.total_cases);
  else if(sortBy==="name")     judges.sort((a,b)=>a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  else                         judges.sort((a,b)=>b.total_cases-a.total_cases||b.approval_rate-a.approval_rate);
  const res = jsonOk({ judges:judges.slice(0,limit), total_judges:judges.length }, "public, max-age=600, stale-while-revalidate=120");
  if (_cache) await _cache.put(new Request(url.toString()), res.clone());
  return res;
}

/** GET /api/v1/analytics/judge-profile — deep profile for a single judge */
async function handleAnalyticsJudgeProfile(url, env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request(url.toString());
  if (_cache) { const cached = await _cache.match(_cacheKey); if (cached) return cached; }
  const sql  = getSql(env);
  const name = (url.searchParams.get("name") || "").trim();
  if (!name) return jsonErr("name query parameter is required");
  const nameNorm = normaliseJudgeName(name).toLowerCase() || name.toLowerCase();

  const caseRows = await sql`SELECT ic.outcome, ic.court_code, ic.year, ic.visa_subclass, ic.case_nature, ic.country_of_origin, ic.is_represented, ic.legal_concepts, ic.case_id, ic.citation, ic.title, ic.date_sort FROM immigration_cases ic, LATERAL unnest(string_to_array(regexp_replace(ic.judges,';',',','g'),',')) AS j WHERE ic.judges IS NOT NULL AND ic.judges <> '' AND lower(trim(j)) LIKE ${"%" + nameNorm + "%"} ORDER BY ic.date_sort DESC NULLS LAST LIMIT 5000`;

  const judgeCourtCodes=[...new Set(caseRows.map(r=>r.court_code).filter(Boolean))];
  const courtBaselines={};
  if (judgeCourtCodes.length) {
    const bRows=await sql`SELECT court_code, outcome, COUNT(*)::int AS cnt FROM immigration_cases WHERE court_code=ANY(${judgeCourtCodes}) GROUP BY 1,2`;
    const ctT={}, ctW={};
    for (const r of bRows) { ctT[r.court_code]=(ctT[r.court_code]||0)+r.cnt; if(isWin(normaliseOutcome(r.outcome),r.court_code)) ctW[r.court_code]=(ctW[r.court_code]||0)+r.cnt; }
    for (const c of judgeCourtCodes) courtBaselines[c]=roundRate(ctW[c]||0,ctT[c]||0);
  }
  const displayName=normaliseJudgeName(name)||name;
  const payload=buildJudgeProfile(displayName, caseRows, { courtBaselines, includeRecentCases:true });
  payload.judge.canonical_name=displayName;
  const _res = jsonOk(payload, "public, max-age=300, stale-while-revalidate=60");
  if (_cache) await _cache.put(_cacheKey, _res.clone());
  return _res;
}

/** GET /api/v1/analytics/judge-compare — compare 2-4 judges side by side */
async function handleAnalyticsJudgeCompare(url, env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request(url.toString());
  if (_cache) { const cached = await _cache.match(_cacheKey); if (cached) return cached; }
  const sql      = getSql(env);
  const names    = (url.searchParams.get("names")||"").split(",").map(s=>s.trim()).filter(Boolean).slice(0,4);
  if (names.length < 2) return jsonErr("At least two judge names are required");

  const profiles = await Promise.all(names.map(name => {
    const nameNorm=normaliseJudgeName(name).toLowerCase()||name.toLowerCase();
    return sql`SELECT ic.outcome, ic.court_code, ic.year, ic.visa_subclass, ic.case_nature, ic.country_of_origin, ic.is_represented, ic.legal_concepts, ic.case_id, ic.citation, ic.title, ic.date_sort FROM immigration_cases ic, LATERAL unnest(string_to_array(regexp_replace(ic.judges,';',',','g'),',')) AS j WHERE ic.judges IS NOT NULL AND ic.judges <> '' AND lower(trim(j)) LIKE ${"%" + nameNorm + "%"} ORDER BY ic.date_sort DESC NULLS LAST LIMIT 3000`.then(rows => {
      const displayName=normaliseJudgeName(name)||name;
      const p=buildJudgeProfile(displayName, rows, { includeRecentCases:false });
      p.judge.canonical_name=displayName; return p;
    });
  }));
  const _res = jsonOk({ judges: profiles }, "public, max-age=300, stale-while-revalidate=60");
  if (_cache) await _cache.put(_cacheKey, _res.clone());
  return _res;
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
            // LLM Council via Cloudflare AI Gateway (Unified Billing).
            // CF_AIG_TOKEN authenticates ALL council calls; per-model
            // overrides are forwarded so the Container's CouncilConfig
            // sees them at os.environ.get() time.
            CF_AIG_TOKEN:                    env.CF_AIG_TOKEN,
            LLM_COUNCIL_OPENAI_MODEL:        env.LLM_COUNCIL_OPENAI_MODEL,
            LLM_COUNCIL_GEMINI_PRO_MODEL:    env.LLM_COUNCIL_GEMINI_PRO_MODEL,
            LLM_COUNCIL_ANTHROPIC_MODEL:     env.LLM_COUNCIL_ANTHROPIC_MODEL,
            LLM_COUNCIL_GEMINI_FLASH_MODEL:  env.LLM_COUNCIL_GEMINI_FLASH_MODEL,
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

// ── Static-data handlers (no DB needed) ──────────────────────────────────────

/** GET /api/v1/data-dictionary — static field definitions */
function handleDataDictionary() {
  return jsonOk({ fields: DATA_DICTIONARY_FIELDS }, "public, max-age=86400");
}

/** GET /api/v1/visa-registry — static visa subclass registry */
function handleVisaRegistry() {
  return jsonOk(VISA_REGISTRY_API, "public, max-age=86400");
}

/** GET /api/v1/taxonomy/visa-lookup?q=&limit=N — subclass search using static registry + SQL counts */
async function handleTaxonomyVisaLookup(url, env) {
  const query = (url.searchParams.get("q") || "").trim();
  const limit = safeInt(url.searchParams.get("limit"), 20, 1, 50);
  if (!query) return jsonErr("q parameter is required");

  const q_lower = query.toLowerCase();
  const q_is_numeric = /^\d+$/.test(query);

  // Step 1: match against static registry (no DB needed for this pass)
  const candidates = [];
  for (const [subclass, [name, family]] of Object.entries(VISA_REGISTRY_RAW)) {
    let matched = false, is_exact = false;
    if (q_is_numeric) {
      if (subclass === query)              { matched = true; is_exact = true; }
      else if (subclass.startsWith(query)) { matched = true; }
    } else {
      const nl = name.toLowerCase();
      if (nl.includes(q_lower)) { matched = true; is_exact = (nl === q_lower); }
    }
    if (matched) candidates.push({ subclass, name, family, is_exact });
  }

  // Step 2: SQL count for matching subclasses only (replaces full-table Python scan)
  const codes = candidates.map(c => c.subclass);
  const countMap = {};
  if (codes.length > 0) {
    const sql = getSql(env);
    const rows = await sql`
      SELECT regexp_replace(visa_subclass, '\\.0$', '') AS sub, COUNT(*)::int AS cnt
      FROM ${sql(TABLE)}
      WHERE visa_subclass ~ '^\\d{1,4}(\\.0)?$'
        AND regexp_replace(visa_subclass, '\\.0$', '') = ANY(${codes})
      GROUP BY 1
    `;
    await sql.end();
    for (const r of rows) countMap[r.sub] = r.cnt;
  }

  // Step 3: merge counts, sort (exact first then by count), trim
  const data = candidates
    .map(c => ({ subclass: c.subclass, name: c.name, family: c.family, case_count: countMap[c.subclass] || 0, _x: c.is_exact }))
    .sort((a, b) => (Number(b._x) - Number(a._x)) || (b.case_count - a.case_count))
    .slice(0, limit)
    .map(({ _x, ...rest }) => rest);

  return jsonOk({ success: true, data, meta: { query, total_results: candidates.length, limit } });
}

/** GET /api/v1/legislations?page=&limit= — list all legislations (metadata only, sections excluded) */
function handleLegislationsList(url) {
  const page  = Math.max(1, safeInt(url.searchParams.get("page"),  1, 1, 9999));
  const limit = Math.min(100, Math.max(1, safeInt(url.searchParams.get("limit"), 10, 1, 100)));
  const total = LEGISLATIONS_META.length;
  const pages = Math.ceil(total / limit);
  if (page > pages) return jsonErr(`page must be <= ${pages}`);
  const data = LEGISLATIONS_META.slice((page - 1) * limit, page * limit);
  return jsonOk({ success: true, data, meta: { total, page, limit, pages } }, "public, max-age=3600");
}

/** GET /api/v1/legislations/search?q=&limit= — full-text search over title/description/shortcode/id */
function handleLegislationsSearch(url) {
  const query = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(100, Math.max(1, safeInt(url.searchParams.get("limit"), 20, 1, 100)));
  if (!query || query.length < 2) return jsonErr("q must be at least 2 characters");
  const q = query.toLowerCase();
  const data = [];
  let total_results = 0;
  for (const leg of LEGISLATIONS_META) {
    if ([leg.title, leg.description, leg.shortcode, leg.id].some(f => f.toLowerCase().includes(q))) {
      total_results++;
      if (data.length < limit) data.push(leg);
    }
  }
  return jsonOk({ success: true, data, meta: { query, total_results, limit } }, "public, max-age=3600");
}

// ── Cases sub-resource handlers ───────────────────────────────────────────────

/** GET /api/v1/cases/compare?ids=a&ids=b&ids=c — batch case fetch */
async function handleCompareCases(url, env) {
  const MAX_COMPARE = 4;
  const ids = url.searchParams.getAll("ids").filter(id => HEX_ID_RE.test(id));
  if (ids.length < 2) return jsonErr("At least 2 valid case IDs required");
  if (ids.length > MAX_COMPARE) return jsonErr(`Maximum ${MAX_COMPARE} cases can be compared`);

  const sql  = getSql(env);
  const cols = sql(CASE_LIST_COLS);
  const rows = await sql`SELECT ${cols} FROM ${sql(TABLE)} WHERE case_id = ANY(${ids}) LIMIT ${MAX_COMPARE}`;
  await sql.end();

  if (rows.length < 2) return jsonErr("Could not find enough cases", 404);
  return jsonOk({ cases: rows });
}

/** GET /api/v1/cases/:id/related?limit=N — related cases via Supabase RPC */
async function handleRelatedCases(caseId, url, env) {
  const limit = safeInt(url.searchParams.get("limit"), 5, 1, 20);
  const sql   = getSql(env);

  // Fetch the anchor case to get required RPC params
  const [anchor] = await sql`
    SELECT case_id, case_nature, visa_type, court_code
    FROM ${sql(TABLE)}
    WHERE case_id = ${caseId}
    LIMIT 1
  `;
  if (!anchor) {
    await sql.end();
    return jsonErr("Case not found", 404);
  }

  const rows = await sql`
    SELECT * FROM find_related_cases(
      p_case_id    := ${caseId},
      p_case_nature:= ${anchor.case_nature ?? ""},
      p_visa_type  := ${anchor.visa_type   ?? ""},
      p_court_code := ${anchor.court_code  ?? ""},
      p_limit      := ${limit}
    )
  `;
  await sql.end();
  return jsonOk({ cases: rows });
}

/** GET /api/v1/court-lineage — court succession metadata with per-year case counts */
async function handleCourtLineage(env) {
  const END_YEAR = new Date().getFullYear();
  const sql  = getSql(env);
  const rows = await sql`SELECT * FROM get_court_year_trends()`;
  await sql.end();

  // Parse wide-format rows: { year: 2020, AATA: 1234, FCA: 567, ... }
  const courtYearCounts = {};
  const allYears = new Set();
  let totalCases = 0;

  for (const row of rows) {
    const year = parseInt(row.year, 10);
    if (!year || year < 1900 || year > END_YEAR + 5) continue;
    allYears.add(year);
    for (const [key, val] of Object.entries(row)) {
      if (key === "year" || val === null || val === "") continue;
      const count = parseInt(val, 10);
      if (isNaN(count) || count <= 0) continue;
      if (!courtYearCounts[key]) courtYearCounts[key] = {};
      courtYearCounts[key][year] = (courtYearCounts[key][year] ?? 0) + count;
      totalCases += count;
    }
  }

  const getYears = code => Object.assign({}, courtYearCounts[code] ?? {});

  const lineages = [
    {
      id:   "lower-court",
      name: "Lower Court Lineage",
      courts: [
        { code: "FMCA",       name: "Federal Magistrates Court of Australia",                          years: [2000, 2013],     case_count_by_year: getYears("FMCA") },
        { code: "FCCA",       name: "Federal Circuit Court of Australia",                              years: [2013, 2021],     case_count_by_year: getYears("FCCA") },
        { code: "FedCFamC2G", name: "Federal Circuit and Family Court of Australia (Division 2)",      years: [2021, END_YEAR], case_count_by_year: getYears("FedCFamC2G") },
      ],
      transitions: [
        { from: "FMCA", to: "FCCA",       year: 2013, description: "Federal Magistrates Court renamed to Federal Circuit Court of Australia" },
        { from: "FCCA", to: "FedCFamC2G", year: 2021, description: "Federal Circuit Court merged into Federal Circuit and Family Court (Division 2)" },
      ],
    },
    {
      id:   "tribunal",
      name: "Tribunal Lineage",
      courts: [
        { code: "MRTA", name: "Migration Review Tribunal",          years: [2000, 2015],     case_count_by_year: getYears("MRTA") },
        { code: "RRTA", name: "Refugee Review Tribunal",            years: [2000, 2015],     case_count_by_year: getYears("RRTA") },
        { code: "AATA", name: "Administrative Appeals Tribunal",    years: [2015, 2024],     case_count_by_year: getYears("AATA") },
        { code: "ARTA", name: "Administrative Review Tribunal",     years: [2024, END_YEAR], case_count_by_year: getYears("ARTA") },
      ],
      transitions: [
        { from: "MRTA", to: "AATA", year: 2015, description: "Migration Review Tribunal merged into Administrative Appeals Tribunal" },
        { from: "RRTA", to: "AATA", year: 2015, description: "Refugee Review Tribunal merged into Administrative Appeals Tribunal" },
        { from: "AATA", to: "ARTA", year: 2024, description: "Administrative Appeals Tribunal replaced by Administrative Review Tribunal" },
      ],
    },
  ];

  const sortedYears = [...allYears].sort((a, b) => a - b);
  const year_range  = sortedYears.length ? [sortedYears[0], sortedYears[sortedYears.length - 1]] : [2000, END_YEAR];

  return jsonOk({ lineages, total_cases: totalCases, year_range }, "public, max-age=600, stale-while-revalidate=60");
}

/** GET /api/v1/taxonomy/judges/autocomplete?q=&limit=N — judge name search via LATERAL unnest */
async function handleTaxonomyJudgesAutocomplete(url, env) {
  const query = (url.searchParams.get("q") || "").trim();
  const limit = safeInt(url.searchParams.get("limit"), 20, 1, 100);
  if (!query || query.length < 2) {
    return jsonOk({ success: true, judges: [], meta: { query, total_results: 0, limit } });
  }

  const sql = getSql(env);
  const q_lower = query.toLowerCase();
  const rows = await sql`
    SELECT trim(j) AS judge_raw, COUNT(*)::int AS case_count
    FROM ${sql(TABLE)} ic,
    LATERAL unnest(string_to_array(regexp_replace(ic.judges, ';', ',', 'g'), ',')) AS j
    WHERE ic.judges IS NOT NULL AND ic.judges <> ''
      AND lower(trim(j)) LIKE ${'%' + q_lower + '%'}
    GROUP BY 1
    ORDER BY case_count DESC
    LIMIT 200
  `;
  await sql.end();

  const seen = new Set();
  const judges = [];
  for (const r of rows) {
    const name = normaliseJudgeName(r.judge_raw);
    if (!name || !isRealJudgeName(name) || _JUDGE_BLOCKLIST.has(name.toLowerCase())) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    judges.push({ name, case_count: r.case_count });
    if (judges.length >= limit) break;
  }

  return jsonOk({ success: true, judges, meta: { query, total_results: judges.length, limit } });
}

/** GET /api/v1/cases/:id/similar?limit=N — pgvector semantic similarity via Supabase RPC */
async function handleSimilarCases(caseId, url, env) {
  const limit = safeInt(url.searchParams.get("limit"), 10, 1, 50);
  const sql = getSql(env);

  // Step 1: fetch the anchor case's embedding
  const anchor = await sql`
    SELECT embedding::text AS emb, embedding_provider AS provider, embedding_model AS model
    FROM ${sql(TABLE)}
    WHERE case_id = ${caseId}
    LIMIT 1
  `;
  if (!anchor.length || !anchor[0].emb) {
    await sql.end();
    return jsonOk({ similar: [], available: false });
  }
  const { emb, provider, model } = anchor[0];

  // Step 2: call the pgvector RPC — pass embedding back as vector literal
  const rpcRows = await sql`
    SELECT * FROM search_cases_semantic(
      ${emb}::vector,
      ${provider || 'openai'},
      ${model || 'text-embedding-3-small'},
      ${limit + 1}
    )
  `;
  await sql.end();

  // Step 3: filter out anchor, return metadata + score
  const similar = rpcRows
    .filter(r => r.case_id !== caseId)
    .slice(0, limit)
    .map(r => ({
      case_id: r.case_id,
      citation: r.citation,
      title: r.title,
      outcome: r.outcome,
      similarity_score: r.similarity,
    }));

  return jsonOk({ similar, available: true });
}

/** GET /api/v1/taxonomy/countries?limit=N — country counts via SQL GROUP BY */
async function handleTaxonomyCountries(url, env) {
  const _cache = typeof caches !== 'undefined' ? caches.default : null;
  const _cacheKey = new Request(url.toString());
  if (_cache) { const cached = await _cache.match(_cacheKey); if (cached) return cached; }
  const limit = safeInt(url.searchParams.get("limit"), 30, 1, 200);
  const sql   = getSql(env);

  const rows = await sql`
    SELECT country_of_origin AS country, COUNT(*)::int AS case_count
    FROM ${sql(TABLE)}
    WHERE country_of_origin IS NOT NULL AND country_of_origin <> ''
    GROUP BY country_of_origin
    ORDER BY case_count DESC
    LIMIT ${limit}
  `;
  await sql.end();

  const countries = rows.map(r => ({ country: r.country, name: r.country, case_count: r.case_count }));
  const _res = jsonOk({
    success: true,
    countries,
    meta: { total_countries: countries.length, returned_results: countries.length, limit },
  }, "public, max-age=600, stale-while-revalidate=120");
  if (_cache) await _cache.put(_cacheKey, _res.clone());
  return _res;
}

// ── LLM Council router ────────────────────────────────────────────────────────
//
// Pure dispatch helper: maps /api/v1/llm-council/* paths to Worker-native
// handlers (workers/llm-council/handlers.js). Returns a Response on match,
// or null when the request should fall through to the Flask Container
// (e.g. /llm-council/health, unknown sub-paths, or unsupported methods).
//
// Exported so workers/__tests__/proxy-routing.test.js can assert the
// path → handler mapping without booting the full Worker fetch handler.

const LLM_COUNCIL_PREFIX = "/api/v1/llm-council/";
const LLM_COUNCIL_SESSION_TURNS_RE =
  /^\/api\/v1\/llm-council\/sessions\/([A-Za-z0-9_-]{21})\/turns$/;
const LLM_COUNCIL_SESSION_RE =
  /^\/api\/v1\/llm-council\/sessions\/([A-Za-z0-9_-]{21})$/;

export async function dispatchLlmCouncil(request, env, url, path, method) {
  if (!path.startsWith(LLM_COUNCIL_PREFIX)) return null;

  // Health stays on Flask (existing legacy behaviour).
  if (path === "/api/v1/llm-council/health") return null;

  // POST /api/v1/llm-council/sessions
  if (path === "/api/v1/llm-council/sessions" && method === "POST") {
    return handleCreateSession(request, env);
  }

  // GET /api/v1/llm-council/sessions
  if (path === "/api/v1/llm-council/sessions" && method === "GET") {
    return handleListSessions(request, env);
  }

  // POST /api/v1/llm-council/run (legacy single-shot, ephemeral)
  if (path === "/api/v1/llm-council/run" && method === "POST") {
    return handleLegacyRun(request, env);
  }

  // POST /api/v1/llm-council/sessions/:id/turns
  const turnsMatch = LLM_COUNCIL_SESSION_TURNS_RE.exec(path);
  if (turnsMatch && method === "POST") {
    return handleAddTurn(request, env, path);
  }

  // GET    /api/v1/llm-council/sessions/:id
  // DELETE /api/v1/llm-council/sessions/:id
  const sessionMatch = LLM_COUNCIL_SESSION_RE.exec(path);
  if (sessionMatch) {
    if (method === "GET") return handleGetSession(request, env, path);
    if (method === "DELETE") return handleDeleteSession(request, env, path);
  }

  // Unknown llm-council sub-path or unsupported method → Flask fallback.
  return null;
}

// ── Flask proxy helper ────────────────────────────────────────────────────────

async function proxyToFlask(request, env) {
  const id        = env.FlaskBackend.idFromName("flask-v15");
  const container = env.FlaskBackend.get(id);

  // Inject Hyperdrive connection string so Flask can optionally use direct psycopg2.
  // The socket.getaddrinfo patch in the container resolves *.hyperdrive.local DNS.
  const headers = new Headers(request.headers);
  // Mark as internally routed so Flask can reject direct external access.
  headers.set("X-Internal-Route", "worker");
  if (env.HYPERDRIVE) {
    headers.set("X-Hyperdrive-Url", env.HYPERDRIVE.connectionString);
  }
  return container.fetch(new Request(request, { headers }));
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

    // ── CSRF token endpoint ───────────────────────────────────────────────────
    // Stateless double-submit HMAC. Set wrangler secret CSRF_SECRET first.
    // Guarded by env.CSRF_SECRET — without secret, fall through to Flask
    // so legacy flask-wtf token mint stays live (zero-downtime invariant).
    if (env.CSRF_SECRET && path === "/api/v1/csrf-token" && method === "GET") {
      return getCsrfToken(env);
    }

    // ── Judge photo R2 serve ──────────────────────────────────────────────────
    // GET /api/v1/judge-photo/<filename>. Returns null when JUDGE_PHOTOS
    // binding is absent (local dev) so Flask can serve the local copy.
    if (path.startsWith("/api/v1/judge-photo/") && method === "GET") {
      const filename = path.slice("/api/v1/judge-photo/".length);
      const r2Resp = await handleJudgePhoto(filename, env);
      if (r2Resp) return r2Resp;
    }

    // ── Cases write path (POST/PUT/DELETE/batch) ──────────────────────────────
    // CSRF gated. Throws → outer try/catch falls through to Flask. Returns
    // explicit Response on success or expected client errors.
    if (
      env.CSRF_SECRET && env.HYPERDRIVE &&
      (method === "POST" || method === "PUT" || method === "DELETE") &&
      (path === "/api/v1/cases" || path === "/api/v1/cases/batch" ||
       path === "/api/v1/cache/invalidate" ||
       path === "/api/v1/taxonomy/guided-search" ||
       path === "/api/v1/collections/export" ||
       /^\/api\/v1\/cases\/[0-9a-f]{12}$/.test(path))
    ) {
      try {
        // Rate-limit BEFORE CSRF: over-limit shouldn't cost HMAC verify CPU.
        let rl = null;
        if (path === "/api/v1/cases" && method === "POST") {
          rl = env.RL_CASES_CREATE;
        } else if (path === "/api/v1/cases/batch") {
          rl = env.RL_CASES_BATCH;
        } else if (path === "/api/v1/collections/export") {
          rl = env.RL_COLLECTIONS_EXPORT;
        } else if (path === "/api/v1/taxonomy/guided-search") {
          rl = env.RL_GUIDED_SEARCH;
        } else if (/^\/api\/v1\/cases\/[0-9a-f]{12}$/.test(path) &&
                   (method === "PUT" || method === "DELETE")) {
          rl = env.RL_CASES_CREATE;
        }
        const rlFail = await throttle(request, rl);
        if (rlFail) return rlFail;

        const csrfFail = await requireCsrf(request, env);
        if (csrfFail) return csrfFail;
        if (path === "/api/v1/cases" && method === "POST") {
          return await handlePostCase(request, env);
        }
        if (path === "/api/v1/cases/batch" && method === "POST") {
          return await handleBatchCases(request, env);
        }
        if (path === "/api/v1/cache/invalidate" && method === "POST") {
          return await handleCacheInvalidate();
        }
        if (path === "/api/v1/taxonomy/guided-search" && method === "POST") {
          return await handleGuidedSearch(request, env);
        }
        if (path === "/api/v1/collections/export" && method === "POST") {
          return await handleCollectionExport(request, env);
        }
        const idMatch = path.match(/^\/api\/v1\/cases\/([0-9a-f]{12})$/);
        if (idMatch && method === "PUT") {
          return await handlePutCase(idMatch[1], request, env);
        }
        if (idMatch && method === "DELETE") {
          return await handleDeleteCase(idMatch[1], env);
        }
      } catch (writeErr) {
        console.error("[native-write] handler error — falling back to Flask:", writeErr?.message);
        // fall through to Flask container
      }
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
        } else if (path === "/api/v1/export/csv") {
          res = await handleExportCsv(url, env);
        } else if (path === "/api/v1/export/json") {
          res = await handleExportJson(url, env);
        } else if (path === "/api/v1/search") {
          res = await handleSearch(url, env);
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
        } else if (path === "/api/v1/stats/trends") {
          res = await handleStatsTrends(url, env);
        } else if (path === "/api/v1/analytics/filter-options") {
          res = await handleAnalyticsFilterOptions(url, env);
        } else if (path === "/api/v1/analytics/monthly-trends") {
          res = await handleAnalyticsMonthlyTrends(env);
        } else if (path === "/api/v1/analytics/flow-matrix") {
          res = await handleAnalyticsFlowMatrix(url, env);
        } else if (path === "/api/v1/analytics/judge-bio") {
          res = await handleAnalyticsJudgeBio(url, env);
        } else if (path === "/api/v1/analytics/visa-families") {
          res = await handleAnalyticsVisaFamilies(env);
        } else if (path === "/api/v1/analytics/success-rate") {
          res = await handleAnalyticsSuccessRate(url, env);
        } else if (path === "/api/v1/analytics/concept-effectiveness") {
          res = await handleAnalyticsConceptEffectiveness(url, env);
        } else if (path === "/api/v1/analytics/concept-cooccurrence") {
          res = await handleAnalyticsConceptCooccurrence(url, env);
        } else if (path === "/api/v1/analytics/concept-trends") {
          res = await handleAnalyticsConceptTrends(url, env);
        } else if (path === "/api/v1/analytics/judge-leaderboard") {
          res = await handleAnalyticsJudgeLeaderboard(url, env);
        } else if (path === "/api/v1/analytics/judge-profile") {
          res = await handleAnalyticsJudgeProfile(url, env);
        } else if (path === "/api/v1/analytics/judge-compare") {
          res = await handleAnalyticsJudgeCompare(url, env);
        } else if (path === "/api/v1/court-lineage") {
          res = await handleCourtLineage(env);
        } else if (path === "/api/v1/data-dictionary") {
          res = handleDataDictionary();
        } else if (path === "/api/v1/visa-registry") {
          res = handleVisaRegistry();
        } else if (path === "/api/v1/cases/compare") {
          res = await handleCompareCases(url, env);
        } else if (path === "/api/v1/taxonomy/countries") {
          res = await handleTaxonomyCountries(url, env);
        } else if (path === "/api/v1/taxonomy/judges/autocomplete") {
          res = await handleTaxonomyJudgesAutocomplete(url, env);
        } else if (path === "/api/v1/taxonomy/visa-lookup") {
          res = await handleTaxonomyVisaLookup(url, env);
        } else if (path === "/api/v1/legislations" || path === "/api/v1/legislations/") {
          res = handleLegislationsList(url);
        } else if (path === "/api/v1/legislations/search") {
          res = handleLegislationsSearch(url);
        } else {
          // Match /api/v1/cases/:id (exactly 12 lowercase hex chars)
          const m = path.match(/^\/api\/v1\/cases\/([0-9a-f]{12})$/);
          if (m) res = await handleGetCase(m[1], env);
          // Match /api/v1/cases/:id/related
          const rel = path.match(/^\/api\/v1\/cases\/([0-9a-f]{12})\/related$/);
          if (rel) res = await handleRelatedCases(rel[1], url, env);
          // Match /api/v1/cases/:id/similar
          const sim = path.match(/^\/api\/v1\/cases\/([0-9a-f]{12})\/similar$/);
          if (sim) res = await handleSimilarCases(sim[1], url, env);
        }

        if (res !== null) return res;
        // null → handler signalled "use Flask" (e.g. tag filter active)
      } catch (nativeErr) {
        // If the native handler throws (DB error, Hyperdrive hiccup), fall
        // through to Flask so the user never sees a raw 500.
        console.error("[native] handler error — falling back to Flask:", nativeErr?.message);
      }
    }

    // ── Auth routes ───────────────────────────────────────────────────────────
    if (path.startsWith("/api/v1/auth/") && env.AUTH_ENABLED !== "false") {
      try {
        if (path === "/api/v1/auth/telegram" && method === "POST")
          return handleTelegramLogin(request, env, getSql);
        if (path === "/api/v1/auth/me" && method === "GET")
          return handleAuthMe(request, env);
        if (path === "/api/v1/auth/logout" && method === "POST")
          return handleAuthLogout(request, env);
        if (path === "/api/v1/auth/refresh" && method === "POST")
          return handleAuthRefresh(request, env, getSql);
        if (path === "/api/v1/auth/switch-tenant" && method === "POST")
          return handleAuthSwitchTenant(request, env, getSql);
      } catch (authErr) {
        console.error(JSON.stringify({ event: "auth.handler_error", message: authErr?.message }));
        return new Response(
          JSON.stringify({ error: "Auth service unavailable", code: "auth_unavailable" }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    // ── LLM Council router ────────────────────────────────────────────────────
    // Worker-native sessions API (workers/llm-council/handlers.js). Returns
    // null for /api/v1/llm-council/health and unknown sub-paths so they
    // fall through to the Flask container (legacy behaviour preserved).
    //
    // We do NOT fall through to Flask on handler errors: by the time a
    // handler throws (e.g. missing CSRF_SECRET, Hyperdrive bind error), the
    // request body has already been consumed and proxyToFlask would 500
    // with "Cannot reconstruct a Request with a used body". The handlers
    // already convert *expected* failures to errorResponse(...) themselves;
    // anything that escapes is a real misconfiguration.
    if (path.startsWith(LLM_COUNCIL_PREFIX)) {
      try {
        const llmRes = await dispatchLlmCouncil(request, env, url, path, method);
        if (llmRes !== null) return llmRes;
      } catch (llmErr) {
        console.error("[llm-council] handler error:", llmErr?.message);
        return new Response(
          JSON.stringify({ error: "LLM Council unavailable", detail: llmErr?.message || "unknown" }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
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

  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        // Keep Hyperdrive connection pool warm
        const sql = getSql(env);
        await sql`SELECT 1`;
        await sql.end();
      } catch (_) { /* warm ping — ignore errors */ }

      // Pre-warm Cache API for high-cold-start endpoints (TTL=300s matches cron interval).
      // Calling the handlers directly populates caches.default, so the next user request
      // is served from edge cache without any SQL cost.
      try {
        const statsUrl = new URL("https://immi.trackit.today/api/v1/stats");
        await handleGetStats(statsUrl, env);
      } catch (_) { /* non-fatal */ }

      try {
        await handleGetFilterOptions(env);
      } catch (_) { /* non-fatal */ }

      try {
        await handleAnalyticsVisaFamilies(env);
      } catch (_) { /* non-fatal */ }

      try {
        const srUrl = new URL("https://immi.trackit.today/api/v1/analytics/success-rate");
        await handleAnalyticsSuccessRate(srUrl, env);
      } catch (_) { /* non-fatal */ }
    })());
  },
};
