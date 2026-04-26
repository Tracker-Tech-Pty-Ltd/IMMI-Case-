# Hyperdrive Full Migration — Phase 1–4 Implementation Plan

| Meta | Value |
|---|---|
| Title | Migrate all Flask Container endpoints to Cloudflare Workers (Hyperdrive-first) |
| Project | IMMI-Case- (`immi.trackit.today`) |
| Author | autopilot /team (architect × 2, test-engineer × 1, synthesized by main session) |
| Date | 2026-04-26 |
| Status | DRAFT — awaiting owner sign-off before Phase 2 (Execution) |
| Origin | `/autopilot 直接寫 phase 1, 2, 3, 4 ... with /team` after JudgeProfilesPage contract-drift bug fix |

> **Why this exists**: today's JudgeProfilesPage rendering crash was caused by Worker/Flask handler drift (Worker missing `top_visa_subclasses`). The drift is structural — it cannot be eliminated while two stacks serve the same API surface. This plan retires the Flask Container entirely so there is **one truth source** per endpoint.

---

## Quickstart (30-second read)

| Phase | Scope | Wall time | ROI | Status |
|---|---|---|---|---|
| **Phase 1** | Writes (CRUD + batch + cache invalidate + bookmarks + guided-search), CSRF, lexical search, streaming export, judge-photo → R2, SPA → Workers Static Assets | 1–2 days | ⭐⭐⭐⭐⭐ kills 80% of contract-drift surface | Designed |
| **Phase 2** | LLM Council (`/llm-council/health`, `/llm-council/run`) + semantic search (`/search/semantic`) → standalone `workers/llm-council/` Worker via CF AI Gateway | 2–3 days | ⭐⭐⭐ enables streaming UX, isolates secrets | Designed |
| **Phase 3** | Background jobs (download/start, pipeline-action, legislations/update) → `workers/jobs/` Worker with Queue + R2 + Durable Object | 1–2 weeks | ⭐⭐ optional — can stay on Mac Mini self-hosted runner | Designed |
| **Phase 4** | Container retirement (`[[containers]]`, `Dockerfile`, `web.py`, `immi_case_downloader/web/`) + CI updates | 0.5 day | ⭐⭐⭐⭐ removes deployment surface | Designed |

**Recommended path**: ship Phase 1 + Phase 4 immediately (≈2 days). Phase 2 follows as separate ticket. Phase 3 only if jobs need to run on demand from production UI; otherwise leave on offline scripts.

**Hard prerequisites**:
- `wrangler secret put CSRF_SECRET <32-byte-random>` (Phase 1)
- R2 bucket creation: `immi-case-judge-photos`, `immi-case-static` (Phase 1, Phase 4)
- Vite config change: `base: "/"` instead of `/static/react/` (Phase 1; one-line, see §Phase 1 Static Assets)

---

## Table of Contents

1. [Current State Audit](#current-state-audit)
2. [Phase 1 — Production Migration](#phase-1--production-migration)
3. [Phase 2 — LLM Endpoint Migration](#phase-2--llm-endpoint-migration)
4. [Phase 3 — Background Job Migration](#phase-3--background-job-migration)
5. [Phase 4 — Container Retirement](#phase-4--container-retirement)
6. [E2E Test Reinforcement Plan](#e2e-test-reinforcement-plan)
7. [Risk Register](#risk-register)
8. [Cross-Cutting Concerns](#cross-cutting-concerns)
9. [Decision Log & Open Questions](#decision-log--open-questions)

---

## Current State Audit

### Already on Worker (32 endpoints — DO NOT touch)

All `analytics/*` (15 endpoints), all GET `cases/*` (incl. `:id`, `compare`, `:id/related`, `:id/similar`), `stats`, `stats/trends`, `filter-options`, `court-lineage`, `taxonomy/{countries,judges/autocomplete,visa-lookup}`, `data-dictionary`, `visa-registry`, `legislations` (list + search + `:id`).

Routing entrypoint: `workers/proxy.js:1813` (the `if (method === "GET" && path.startsWith("/api/v1/") && env.HYPERDRIVE)` block, ending at line 1896). Fall-through to Flask via `proxyToFlask(request, env)` at `proxy.js:1898`.

### Still on Flask (16 endpoints — Phase 1–3 scope)

| Category | Endpoint | Source | Phase |
|---|---|---|---|
| CSRF | `GET /api/v1/csrf-token` | `api.py:1374` | 1 |
| Cases write | `POST /api/v1/cases` | `api_cases.py:961` | 1 |
| Cases write | `PUT /api/v1/cases/:id` | `api_cases.py:974` | 1 |
| Cases write | `DELETE /api/v1/cases/:id` | `api_cases.py:1003` | 1 |
| Cases write | `POST /api/v1/cases/batch` | `api_cases.py:1017` | 1 |
| Cache | `POST /api/v1/cache/invalidate` | `api.py:2647` | 1 |
| Bookmarks | `POST /api/v1/bookmarks/export` | `bookmarks.py:161` | 1 |
| Taxonomy | `POST /api/v1/taxonomy/guided-search` | `api_taxonomy.py:587` | 1 |
| Search | `GET /api/v1/search` (lexical only) | `api_cases.py:1208` | 1 |
| Search | `GET /api/v1/search/semantic` | `api_cases.py:1285` | 2 |
| Export | `GET /api/v1/export/csv\|json` | `api_export.py:29,54` | 1 |
| Photos | `GET /api/v1/judge-photo/:filename` | `api.py:2559` | 1 |
| LLM | `GET /api/v1/analytics/llm-council/health` | `api_pipeline.py:253` | 2 |
| LLM | `POST /api/v1/analytics/llm-council/run` | `api_pipeline.py:267` | 2 |
| Jobs | `GET /api/v1/job-status` | `api_pipeline.py:169` | 3 |
| Jobs | `POST /api/v1/download/start` | `api_pipeline.py:176` | 3 |
| Jobs | `GET /api/v1/pipeline-status` | `api_pipeline.py:212` | 3 |
| Jobs | `POST /api/v1/pipeline-action` | `api_pipeline.py:218` | 3 |
| Jobs | `POST /api/v1/legislations/update` | `legislations.py:214` | 3 |
| Jobs | `GET /api/v1/legislations/update/status` | `legislations.py:260` | 3 |
| SPA | `GET /` and `/app/*` | Flask catch-all | 1 (Workers Static Assets) |

### Infrastructure as-is (`wrangler.toml`)

```toml
name = "immi-case"
main = "workers/proxy.js"
[[hyperdrive]] binding = "HYPERDRIVE" id = "c961b377ef0c4ec2a01d9d7220db7c93"
[durable_objects] bindings = [{ name = "FlaskBackend", class_name = "FlaskBackend" }]
[[migrations]] tag = "v1" new_sqlite_classes = ["FlaskBackend"]
[[routes]] pattern = "immi.trackit.today" custom_domain = true
[[containers]] class_name = "FlaskBackend" image = "./Dockerfile" max_instances = 2
```

After Phase 4: only `name`, `main`, `[[hyperdrive]]`, `[[routes]]`, `[assets]`, `[[r2_buckets]]`, `[services]`, `[limits]` remain. DO + Container deleted.

---

## Phase 1 — Production Migration

This phase moves every remaining user-facing read+write endpoint and the React SPA shell from the Flask Container to the edge Worker.

### Migration ordering

1. CSRF (unblocks all writes).
2. Cases CRUD + batch (depends on CSRF).
3. Cache invalidate (trivial; ties off CRUD).
4. Bookmarks export, taxonomy guided-search (depend on CSRF).
5. Lexical search (read-only; no CSRF).
6. Streaming export CSV/JSON (read-only; longest-running).
7. Workers Static Assets binding for the SPA + `/static/*`.
8. R2 + judge-photo handler (independent of everything else).

After every step, the Worker still falls back to Flask on `null` / thrown handlers (per existing `proxy.js:1891-1895`), so a partial deploy degrades gracefully.

### CSRF Design (stateless double-submit HMAC)

The Worker is stateless and has no server-side session. Replace flask-wtf with **stateless double-submit HMAC**: cookie carries `payload.signature`, header echoes the same payload, Worker verifies the HMAC and the embedded expiry.

**Token format**:

```
payload  = <random_id_16B_hex>.<expiry_unix_ms>
mac      = base64url(HMAC_SHA256(env.CSRF_SECRET, payload))
token    = base64url(payload) + "." + mac
```

- `CSRF_SECRET`: 32-byte secret stored via `wrangler secret put CSRF_SECRET`. Never committed.
- TTL: 1 hour (`60 * 60 * 1000`). Matches current `WTF_CSRF_TIME_LIMIT`.
- Random id (16 hex chars from `crypto.getRandomValues`) prevents two clients with the same expiry minute from sharing a token.

**Cookie**:

```
Set-Cookie: __Host-csrf=<token>; Path=/; SameSite=Lax; Secure; Max-Age=3600
```

`__Host-` prefix mandates `Secure`, `Path=/`, no `Domain`. **HttpOnly intentionally OFF** — the SPA reads `document.cookie` and copies the token into the `X-CSRF-Token` header (canonical double-submit pattern, OWASP CSRF Cheat Sheet §5.2).

**SameSite=Lax (corrected 2026-04-26 per Critic B3)**: applicants land on `immi.trackit.today/cases/<id>` from email/Slack/Google links — `SameSite=Strict` would block the cookie on those top-level navigations, breaking first-write retry on a fresh session. `SameSite=Lax` still blocks cross-site POST/PUT/DELETE (which is what CSRF cares about) and is the OWASP-recommended setting for double-submit tokens.

**Validation rule** (`requireCsrf`):

1. Read `X-CSRF-Token` header. Reject if missing on any non-GET, non-HEAD, non-OPTIONS write.
2. Read `__Host-csrf` cookie. Reject if missing or unequal to header (string compare).
3. Split token into `payload_b64` + `mac_b64`. Decode payload, parse `random_id.expiry`.
4. Verify `expiry > Date.now()`.
5. Recompute HMAC over decoded payload. Compare via `crypto.subtle.verify` (constant-time).
6. Any failure → `403 {"error": "csrf"}`.

**Worker code skeleton** (insert near helpers block, ~line 92 of `proxy.js`):

```js
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
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function getCsrfToken(env) {
  const rand = crypto.getRandomValues(new Uint8Array(16));
  const payload = `${b64url(rand)}.${Date.now() + CSRF_TTL_MS}`;
  const key = await importHmacKey(env.CSRF_SECRET);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const token = `${b64url(new TextEncoder().encode(payload))}.${b64url(sig)}`;
  const cookie = `${CSRF_COOKIE}=${token}; Path=/; SameSite=Lax; Secure; Max-Age=${CSRF_TTL_MS / 1000}`;
  return new Response(JSON.stringify({ csrf_token: token }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": cookie, "Cache-Control": "no-store" },
  });
}
async function requireCsrf(request, env) {
  const header = request.headers.get("X-CSRF-Token") || request.headers.get("X-CSRFToken");
  const cookie = (request.headers.get("Cookie") || "")
    .split(/;\s*/).find(c => c.startsWith(`${CSRF_COOKIE}=`))?.slice(CSRF_COOKIE.length + 1);
  if (!header || !cookie || header !== cookie) return jsonErr("csrf", 403);
  const [payloadB64, macB64] = header.split(".");
  if (!payloadB64 || !macB64) return jsonErr("csrf", 403);
  const payload = new TextDecoder().decode(b64urlDecode(payloadB64));
  const [, expiryStr] = payload.split(".");
  if (!expiryStr || Number(expiryStr) < Date.now()) return jsonErr("csrf_expired", 403);
  const key = await importHmacKey(env.CSRF_SECRET);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlDecode(macB64), new TextEncoder().encode(payload));
  return ok ? null : jsonErr("csrf", 403);
}
```

**Routing wire-up** (insert before existing native GET block at `proxy.js:1810`):

```js
if (path === "/api/v1/csrf-token" && method === "GET") return getCsrfToken(env);
if (method !== "GET" && method !== "HEAD" && path.startsWith("/api/v1/")) {
  const fail = await requireCsrf(request, env);
  if (fail) return fail;
}
```

**Rotation**: every successful `GET /api/v1/csrf-token` mints a fresh token and `Set-Cookie`s it. SPA already calls `/csrf-token` once on boot (`frontend/src/lib/api.ts` `ensureCsrfToken`), so rotation is automatic on app reload. Tokens are not renewed mid-session — on 403 the SPA re-fetches the token and retries once.

**Rollback**: leave `WTF_CSRF_HEADERS` intact in Flask. If Worker CSRF check fails for any client during rollout, remove the routing block and Flask's existing `csrf` decorator continues to work.

### 1. POST /api/v1/cases

Replaces `api_cases.py:961`. Insert one row, return it.

```js
async function handlePostCase(request, env) {
  const data = await safeJson(request);
  if (!data) return jsonErr("invalid json");
  if (!data.title && !data.citation) return jsonErr("Title or citation is required");

  const caseId = data.case_id?.match(HEX_ID_RE)?.[0]
              ?? await sha12(data.citation || data.url || data.title);
  const row = pickEditableFields(data, { case_id: caseId });

  const sql = getSql(env);
  const cols = Object.keys(row);
  const [inserted] = await sql`
    INSERT INTO ${sql(TABLE)} ${sql(row, cols)}
    ON CONFLICT (case_id) DO UPDATE SET ${sql(row, cols.filter(c => c !== "case_id"))}
    RETURNING *
  `;
  return Response.json({ case: inserted }, { status: 201 });
}

async function sha12(key) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}
```

`pickEditableFields()` is a hardcoded allow-list mirroring `EDITABLE_FIELDS` in `web/helpers.py`. Silently drop unknown keys; coerce `year` to int.

**Validation strategy**:
- Coerce all string fields with `String(v ?? "")`.
- Coerce `year`: `Number.isInteger(+v) ? +v : 0`.
- Reject body > 32 KB (`request.headers.get("content-length")`).
- Reject if any column value > 64 KB.

**Risks**: race where two clients POST same citation → both get same `case_id` from `sha12()` → `ON CONFLICT` picks last writer. Matches Flask behaviour.

### 2. PUT /api/v1/cases/:id

Replaces `api_cases.py:974`. Partial update over editable columns.

```js
async function handlePutCase(caseId, request, env) {
  if (!HEX_ID_RE.test(caseId)) return jsonErr("Invalid case ID");
  const data = await safeJson(request);
  if (!data) return jsonErr("invalid json");
  const updates = pickEditableFields(data);
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
```

`tags` column stays pipe-delimited (caller serialises). `RETURNING *` saves the second SELECT.

### 3. DELETE /api/v1/cases/:id

```js
async function handleDeleteCase(caseId, env) {
  if (!HEX_ID_RE.test(caseId)) return jsonErr("Invalid case ID");
  const sql = getSql(env);
  const result = await sql`DELETE FROM ${sql(TABLE)} WHERE case_id = ${caseId}`;
  if (result.count === 0) return jsonErr("Case not found", 404);
  return Response.json({ success: true });
}
```

### 4. POST /api/v1/cases/batch

Two actions: `tag` (additive merge) or `delete`.

```js
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

    const result = await sql`
      UPDATE ${sql(TABLE)}
      SET tags = (
        SELECT string_agg(t, ', ' ORDER BY t)
        FROM (SELECT DISTINCT trim(t) AS t
              FROM unnest(string_to_array(coalesce(tags, ''), ',') || ARRAY[${tag}]) AS t
              WHERE trim(t) <> '') sub
      )
      WHERE case_id = ANY(${ids})
    `;
    return Response.json({ affected: result.count });
  }
  return jsonErr(`Unknown action: ${action}`);
}
```

**Atomicity gain**: Worker batch is atomic (single statement) vs Flask's row-by-row commit. Both clients tagging concurrently → last-writer-wins on the merged set. Acceptable.

### 5. POST /api/v1/cache/invalidate

Worker has no shared in-memory caches today. Forward header + return success:

```js
async function handleCacheInvalidate(env) {
  return new Response(JSON.stringify({ invalidated: true, timestamp: Date.now() / 1000 }), {
    status: 200,
    headers: { "Content-Type": "application/json", "CDN-Cache-Control": "no-store" },
  });
}
```

If Flask jobs are still running during transition (before Phase 3), proxy this through to Flask too, to flush the analytics cache.

### 6. POST /api/v1/bookmarks/export

Replaces `bookmarks.py:161`. HTML report from up to 200 cases.

```js
async function handleBookmarksExport(request, env) {
  const data = await safeJson(request);
  if (!data) return jsonErr("invalid json");
  const ids = Array.isArray(data.case_ids) ? data.case_ids.filter(i => HEX_ID_RE.test(i)) : [];
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

  const html = renderBookmarksHtml(name, rows, notes); // port of _generate_html_report
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(name)}.html"`,
    },
  });
}
```

`renderBookmarksHtml()` is a line-for-line port of `bookmarks.py:24-158`. CSS block inlined verbatim. Add `htmlEscape()` helper. **Unit test**: `<script>` in any user field must be escaped.

### 7. POST /api/v1/taxonomy/guided-search

Two flows: `find-precedents` and `assess-judge`.

```js
async function handleGuidedSearch(request, env) {
  const data = await safeJson(request);
  if (!data) return jsonErr("invalid json");
  const flow = String(data.flow ?? "");
  if (!["find-precedents", "assess-judge"].includes(flow))
    return jsonErr("Invalid flow type");

  const sql = getSql(env);

  if (flow === "find-precedents") {
    const visa = String(data.visa_subclass ?? "").trim();
    const country = String(data.country ?? "").trim();
    const concepts = Array.isArray(data.legal_concepts) ? data.legal_concepts
                   : data.legal_concepts ? [String(data.legal_concepts)] : [];
    const limit = safeInt(data.limit, 50, 1, 200);

    const where = [sql`TRUE`];
    if (visa) where.push(sql`visa_subclass ILIKE ${`%${visa}%`}`);
    if (country) where.push(sql`country_of_origin ILIKE ${`%${country}%`}`);
    if (concepts.length) {
      const ors = concepts.map(c => sql`legal_concepts ILIKE ${`%${c}%`}`)
        .reduce((a, b) => sql`${a} OR ${b}`);
      where.push(sql`(${ors})`);
    }
    const whereSql = where.reduce((a, b) => sql`${a} AND ${b}`);

    const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM ${sql(TABLE)} WHERE ${whereSql}`;
    const rows = await sql`
      SELECT ${sql(CASE_LIST_COLS)} FROM ${sql(TABLE)} WHERE ${whereSql}
      ORDER BY year DESC NULLS LAST LIMIT ${limit}
    `;
    return Response.json({
      success: true, flow, results: rows,
      meta: { total_results: total, returned_results: rows.length, limit,
              filters_applied: { visa_subclass: visa, country, legal_concepts: concepts } },
    });
  }

  // assess-judge
  const judgeName = String(data.judge_name ?? "").trim();
  if (!judgeName) return jsonErr("Judge name is required for assess-judge flow");
  const norm = normaliseJudgeName(judgeName);
  if (!norm) return jsonErr("Invalid judge name");
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM ${sql(TABLE)} WHERE judges ILIKE ${`%${norm}%`}`;
  return Response.json({
    success: true, flow: "assess-judge",
    judge_name: norm, canonical_name: norm,
    profile_url: `/judge-profiles/${encodeURIComponent(norm)}`,
    meta: { total_cases: count },
  });
}
```

**Regression accepted**: Flask uses `_collect_cases_for_judge()` with `fuzzywuzzy` alias matching. Worker port uses pure ILIKE. Track in follow-up; port alias normaliser fully into `normaliseJudgeName`.

### 8. GET /api/v1/search (lexical)

Three modes in Flask: `lexical`, `semantic`, `hybrid`. **Phase 1: migrate `lexical` only.** Semantic/hybrid → Phase 2 (need OpenAI/Gemini embedding).

```js
async function handleSearch(url, env) {
  const q = (url.searchParams.get("q") ?? "").trim();
  const mode = (url.searchParams.get("mode") ?? "lexical").toLowerCase();
  const limit = safeInt(url.searchParams.get("limit"), 20, 1, 100);

  if (!q) return jsonOk({ cases: [], mode });
  if (q.length < 2) return jsonErr("query too short");
  if (mode !== "lexical") return null; // → Flask (semantic/hybrid) until Phase 2

  const sql = getSql(env);
  // CORRECTED 2026-04-26 per Critic B1:
  //   - column name is `fts` (schema line 50: ALTER TABLE immigration_cases ADD COLUMN IF NOT EXISTS fts tsvector ...)
  //   - existing repository uses plainto_tsquery (hyperdrive_repository.py:158, :391)
  //   - websearch_to_tsquery handles user input safely; no need to pre-tokenize.
  const rows = await sql`
    SELECT ${sql(CASE_LIST_COLS)},
           ts_rank_cd(fts, websearch_to_tsquery('english', ${q})) AS rank
    FROM ${sql(TABLE)}
    WHERE fts @@ websearch_to_tsquery('english', ${q})
    ORDER BY rank DESC LIMIT ${limit}
  `;
  return jsonOk({ cases: rows, mode: "lexical" });
}
```

The `fts` column is the GIN-indexed generated tsvector column from migration `20260218000000_initial_schema.sql:50` (NOT `title_search` — earlier draft was wrong). Index `idx_fts` at line 63. Match existing repository's `plainto_tsquery`/`websearch_to_tsquery` style — `websearch_to_tsquery` handles operators (`OR`, `-`, quoted phrases) without manual `:*` tokenization.

### 9. GET /api/v1/export/csv|json (streaming)

Replaces `api_export.py`. Currently materialises ≤5 000 rows in `io.StringIO`. Switch to **Postgres cursor + Workers ReadableStream**.

```js
async function handleExportCsv(url, env) {
  const filters = parseCaseFilters(url.searchParams);
  const where = buildCasesWhere(getSql(env), filters);
  if (!where) return null; // tag filter → Flask (until Phase 1 ports tag logic)

  const sql = getSql(env);
  const cursor = sql`
    SELECT ${sql(CASE_FIELDS)} FROM ${sql(TABLE)} WHERE ${where}
    ORDER BY year DESC NULLS LAST LIMIT 50000
  `.cursor(500);

  const enc = new TextEncoder();
  const headerLine = CASE_FIELDS.map(csvCell).join(",") + "\n";
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(enc.encode("﻿"));   // UTF-8 BOM
      controller.enqueue(enc.encode(headerLine));
    },
    async pull(controller) {
      try {
        for await (const batch of cursor) {
          if (cancelled) break;
          let chunk = "";
          for (const row of batch) chunk += CASE_FIELDS.map(f => csvCell(row[f] ?? "")).join(",") + "\n";
          controller.enqueue(enc.encode(chunk));
        }
        controller.close();
        await sql.end({ timeout: 1 });
      } catch (e) {
        controller.error(e);
        await sql.end({ timeout: 1 });
      }
    },
    cancel() { cancelled = true; sql.end({ timeout: 1 }).catch(() => {}); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="immigration_cases_${ymd()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
```

**JSON variant**: emit `{"cases":[`, then `JSON.stringify(row)` separated by `,`, then `]}` using a `let first = true` flag.

**Backpressure**: `pull()` fires on consumer high-water-mark drop; `cursor.read(500)` blocks await until rows arrive. Memory bounded to ~1.5 MB per batch.

**Abort**: client disconnect → `stream.cancel()` → set flag + `sql.end()`.

**Critical wrangler.toml change**:
```toml
[limits]
cpu_ms = 60000   # streaming export needs > 30 s wall clock
```
Network/wall time is unbounded for streamed responses (documented Cloudflare exception). CPU is what 30s caps; setting 60000 is safety margin for cursor batching.

### 10. GET /api/v1/judge-photo/:filename → R2

Migrate from Flask filesystem to R2.

**Bucket**: `immi-case-judge-photos`. ~104 photos × ~80 KB ≈ 8 MB.

**`wrangler.toml`**:
```toml
[[r2_buckets]]
binding = "JUDGE_PHOTOS"
bucket_name = "immi-case-judge-photos"
preview_bucket_name = "immi-case-judge-photos-preview"
```

**One-time upload** (run locally before Phase 1 deploy):
```bash
cd downloaded_cases/judge_photos
for f in *; do
  npx wrangler r2 object put "immi-case-judge-photos/$f" \
    --file="$f" --content-type="$(file -b --mime-type "$f")"
done
```

**Worker handler**:
```js
const PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const MIME = { ".jpg":"image/jpeg",".jpeg":"image/jpeg",".png":"image/png",
               ".webp":"image/webp",".gif":"image/gif",".avif":"image/avif" };

async function handleJudgePhoto(filename, env) {
  if (filename.includes("/") || filename.includes("..")) return jsonErr("Not found", 404);
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!PHOTO_EXTS.has(ext)) return jsonErr("Not found", 404);
  const obj = await env.JUDGE_PHOTOS.get(filename);
  if (!obj) return jsonErr("Not found", 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "public, max-age=86400, immutable",
      "ETag": obj.httpEtag,
    },
  });
}
```

### 11. SPA serving — Workers Static Assets

Replaces Flask catch-all for `/` and `/app/*`. Workers Static Assets is Cloudflare-native; removes a Container round-trip per page load.

**`wrangler.toml`**:
```toml
[assets]
binding = "ASSETS"
directory = "./immi_case_downloader/static/react"
not_found_handling = "single-page-application"
# CORRECTED 2026-04-26 per Critic B5:
#   `run_worker_first` may accept either `true` (always run Worker code first)
#   or an array of route globs depending on Wrangler version. Verify against
#   `wrangler --version` and https://developers.cloudflare.com/workers/static-assets/binding/
#   before deploy. Safest path: set `true` so Worker code matches /api/v1/* first,
#   then explicitly call env.ASSETS.fetch(request) for SPA routes.
run_worker_first = true
```

`not_found_handling = "single-page-application"` serves `index.html` for any path that doesn't match a built file — exactly what React Router needs for `/cases/<id>` deep links. `run_worker_first` ensures `/api/v1/*` hits the Worker code, not the asset binding.

**Required Vite config change** (`frontend/vite.config.ts`):
```ts
export default {
  base: "/",                      // was "/static/react/"
  build: { outDir: "../immi_case_downloader/static/react", emptyOutDir: true },
};
```

With `base: "/"`, `index.html` references become `<script src="/assets/index-XXXX.js">`, and Workers Static Assets resolves them from binding directory's `assets/` subfolder.

**Routing in proxy.js** (after CSRF block, before native GET block):
```js
if (path === "/" || path.startsWith("/app/")) return env.ASSETS.fetch(request);
if (path.startsWith("/assets/") || path === "/favicon.ico") return env.ASSETS.fetch(request);
```

**Migration risk**: `frontend/src/lib/router.ts` `resolveRouterBasename()` auto-detects `/` vs `/app/`. After Vite `base: "/"`, basename = `/`. **E2E tests using `/app/` deep-links must update** — see test reinforcement plan.

### Wrangler.toml deltas after Phase 1

```toml
# Add to existing file
[assets]
binding = "ASSETS"
directory = "./immi_case_downloader/static/react"
not_found_handling = "single-page-application"
# CORRECTED 2026-04-26 per Critic B5:
#   `run_worker_first` may accept either `true` (always run Worker code first)
#   or an array of route globs depending on Wrangler version. Verify against
#   `wrangler --version` and https://developers.cloudflare.com/workers/static-assets/binding/
#   before deploy. Safest path: set `true` so Worker code matches /api/v1/* first,
#   then explicitly call env.ASSETS.fetch(request) for SPA routes.
run_worker_first = true

[[r2_buckets]]
binding = "JUDGE_PHOTOS"
bucket_name = "immi-case-judge-photos"

[limits]
cpu_ms = 60000

# CSRF_SECRET set via:
#   wrangler secret put CSRF_SECRET
```

### Phase 1 routing summary (`workers/proxy.js`)

Insert before the existing native GET block (around line 1810):

```js
// CSRF (any method)
if (path === "/api/v1/csrf-token" && method === "GET") return getCsrfToken(env);
if (method !== "GET" && method !== "HEAD" && path.startsWith("/api/v1/")) {
  const fail = await requireCsrf(request, env);
  if (fail) return fail;
}

// SPA assets
if (path === "/" || path.startsWith("/app/")) return env.ASSETS.fetch(request);
if (path.startsWith("/assets/") || path === "/favicon.ico") return env.ASSETS.fetch(request);

// Write handlers
if (path === "/api/v1/cases" && method === "POST") return handlePostCase(request, env);
if (path === "/api/v1/cases/batch" && method === "POST") return handleBatchCases(request, env);
if (path === "/api/v1/cache/invalidate" && method === "POST") return handleCacheInvalidate(env);
if (path === "/api/v1/bookmarks/export" && method === "POST") return handleBookmarksExport(request, env);
if (path === "/api/v1/taxonomy/guided-search" && method === "POST") return handleGuidedSearch(request, env);
const idMatch = path.match(/^\/api\/v1\/cases\/([0-9a-f]{12})$/);
if (idMatch && method === "PUT")    return handlePutCase(idMatch[1], request, env);
if (idMatch && method === "DELETE") return handleDeleteCase(idMatch[1], env);

// Photo via R2
const photoMatch = path.match(/^\/api\/v1\/judge-photo\/(.+)$/);
if (photoMatch && method === "GET") return handleJudgePhoto(decodeURIComponent(photoMatch[1]), env);

// Streaming export
if (path === "/api/v1/export/csv"  && method === "GET")
  return (await handleExportCsv(url, env))  ?? proxyToFlask(request, env);
if (path === "/api/v1/export/json" && method === "GET")
  return (await handleExportJson(url, env)) ?? proxyToFlask(request, env);

// Lexical search; semantic falls through to Flask until Phase 2
if (path === "/api/v1/search" && method === "GET") {
  const r = await handleSearch(url, env);
  if (r) return r;
}
```

Each handler follows the existing convention: throws → Flask fallback via outer `try/catch`; returns `null` → explicit Flask fallthrough.

---

## Phase 2 — LLM Endpoint Migration

### Architecture decision: separate `workers/llm-council/` Worker

**Recommendation**: deploy as standalone Worker bound from `proxy.js` via Service Binding (`env.LLM_COUNCIL`).

**Why separate (not in `proxy.js`)**:
1. **CPU isolation**. A council run fans out 4 expert calls + 1 moderator, each holding a streamed `fetch()` for 30–70s. Even though I/O wait doesn't consume CPU on Workers Paid, the moderator's JSON parse + score normalization (`llm_council.py:1064-1131` ranking, vote tally, `_compute_shared_law_sections_confidence` pairwise combinatorics) is real CPU. Co-locating risks tripping 30s wall-time on a single bad council run while a casual `/api/v1/stats` request is in flight.
2. **Secret blast radius**. Moving `CF_AIG_TOKEN` into a dedicated Worker keeps the read-path Worker free of the AI Gateway credential.
3. **Independent deploy cadence**. Prompt tweaks (the five `DEFAULT_*_SYSTEM_PROMPT` constants in `llm_council.py:54-127`) ship without redeploying the read-path Worker.
4. **Mirrors proven pattern**. `workers/austlii-scraper/` is already a separate Worker for the same reason.

**Trade-off**: one extra deploy target + one Service Binding. Mitigated by `proxy.js` already having fall-through pattern — council routes simply forward to `env.LLM_COUNCIL.fetch(request)`.

### Provider routing — single CF AI Gateway endpoint

All providers route through CF AI Gateway Unified Billing (`llm_council.py:41-44`):

```
POST https://gateway.ai.cloudflare.com/v1/30ffcfbf8c4103048bc38a5398b7ec99/immi-council/compat/chat/completions
Header: cf-aig-authorization: Bearer ${CF_AIG_TOKEN}
Body:   { model: "<provider>/<model>", messages: [...], max_tokens, temperature }
```

JS port is **single-codepath, not three providers** — Python `_gateway_chat_completion` already collapsed three SDKs into one HTTP shape.

| Provider | Model prefix | Default model |
|---|---|---|
| OpenAI | `openai/` | `openai/gpt-4.1` |
| Google AI Studio (Pro) | `google-ai-studio/` | `google-ai-studio/gemini-2.5-pro` |
| Anthropic | `anthropic/` | `anthropic/claude-sonnet-4-5` |
| Alibaba Qwen (workers-ai) | `workers-ai/` | `workers-ai/@cf/qwen/qwq-32b` |
| Google AI Studio (Flash, moderator) | `google-ai-studio/` | `google-ai-studio/gemini-2.5-flash` |

### Streaming: SSE pass-through with TransformStream

Current Python is **non-streaming** (`response.json()` blocking, `llm_council.py:230-238`). Migrating to SSE during the port unlocks: (a) first-byte latency drops from ~25s to ~2s; (b) Worker CPU stays low because we never `await response.text()` — bytes pass through.

**Per-expert call**:
```js
async function callExpert({ env, model, systemPrompt, userPrompt, signal }) {
  const upstream = await fetch(env.CF_GATEWAY_URL, {
    method: "POST",
    headers: {
      "cf-aig-authorization": `Bearer ${env.CF_AIG_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model, stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1600, temperature: 0.2,
    }),
    signal,
  });
  if (!upstream.ok) throw new Error(`Gateway ${upstream.status}`);
  return upstream.body;
}
```

**`/run` handler** (multiplexed SSE):
```js
export async function handleRun(request, env) {
  const { question, context, case_id } = await request.json();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (event, data) => writer.write(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 70_000);

  const experts = ["openai", "gemini_pro", "anthropic", "qwen"].map(async (key) => {
    try {
      const stream = await callExpert({ env, model: MODELS[key], /* ... */ signal: ctrl.signal });
      const reader = stream.getReader();
      const buf = [];
      const dec = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        buf.push(chunk);
        await send("token", { provider: key, delta: chunk });
      }
      return { key, answer: parseSseChunks(buf.join("")) };
    } catch (err) {
      await send("error", { provider: key, message: String(err) });
      return { key, answer: "", error: String(err) };
    }
  });

  request.signal.addEventListener("abort", () => ctrl.abort());
  const finalize = (async () => {
    const opinions = await Promise.all(experts);
    clearTimeout(timeout);
    const moderator = await runModerator(env, question, context, opinions);
    await send("done", { opinions, moderator });
    await writer.close();
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
```

Frontend `LlmCouncilPage.tsx` already has per-provider card layout — adapt `frontend/src/lib/api.ts` to consume `EventSource` and switch on `event.type`.

### Secret management

| Secret name | Provider/role | Set via |
|---|---|---|
| `CF_AIG_TOKEN` | CF AI Gateway Unified Billing — single token covers all 5 models | `wrangler secret put CF_AIG_TOKEN --config workers/llm-council/wrangler.toml` |
| `LLM_COUNCIL_AUTH` | Inbound auth from `proxy.js` Service Binding | `wrangler secret put LLM_COUNCIL_AUTH ...` |

Per-provider `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` are **not needed** — Unified Billing routes through gateway token.

Non-secret `[vars]`:
```toml
[vars]
CF_GATEWAY_URL = "https://gateway.ai.cloudflare.com/v1/30ffcfbf8c4103048bc38a5398b7ec99/immi-council/compat/chat/completions"
LLM_COUNCIL_OPENAI_MODEL = "openai/gpt-4.1"
LLM_COUNCIL_GEMINI_PRO_MODEL = "google-ai-studio/gemini-2.5-pro"
LLM_COUNCIL_ANTHROPIC_MODEL = "anthropic/claude-sonnet-4-5"
LLM_COUNCIL_GEMINI_FLASH_MODEL = "google-ai-studio/gemini-2.5-flash"
LLM_COUNCIL_QWEN_MODEL = "workers-ai/@cf/qwen/qwq-32b"
LLM_COUNCIL_MAX_OUTPUT_TOKENS = "1600"
LLM_COUNCIL_TIMEOUT_SECONDS = "70"
```

### Rate limiting and retry

Replace Python `BoundedSemaphore(3)` (`llm_council.py:37`) with CF Rate Limiting API:
```toml
[[unsafe.bindings]]
name = "COUNCIL_LIMITER"
type = "ratelimit"
namespace_id = "1001"
simple = { limit = 5, period = 60 }
```

```js
const { success } = await env.COUNCIL_LIMITER.limit({ key: ipFromCfRay(request) });
if (!success) return Response.json({ error: "rate limited" }, { status: 429 });
```

**Retry**: exponential backoff with jitter, max 3 attempts, only on 429/5xx/network.
```js
async function withRetry(fn, { max = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < max; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const status = err.status || 0;
      if (status && status < 500 && status !== 429) throw err;
      const delay = Math.min(8000, 250 * 2 ** i) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
```

**Critical**: do NOT retry mid-stream. Retries apply only to initial `fetch()` setup. Mid-stream failure → partial answer with `success: false` for that provider.

### Multi-model debate logic port

Pure-JS port (no SDK, copy line-by-line):

| Python (file:line) | JS module | Notes |
|---|---|---|
| `_extract_chat_completion_text` `llm_council.py:490-513` | `parsers.js#extractText` | Handles list-of-parts content shape |
| `_normalize_law_section` / `_law_section_key` `:278-294` | `lawSections.js` | Regex-only |
| `_dedupe_law_sections` `:296-310` | `lawSections.js` | |
| `_extract_law_sections_from_text` `:313-317` | `lawSections.js` | `FULL_LAW_CITE_RE` portable as JS RegExp |
| `_compute_shared_law_sections` `:342-379` | `consensus.js` | Set intersection |
| `_compute_shared_law_sections_confidence` `:382-441` | `consensus.js` | Pairwise overlap, integers |
| `_fallback_moderator` `:739-858` | `moderator.js#fallback` | When Flash JSON parse fails |
| `_run_moderator` `:861-1168` | `moderator.js#run` | Big one: ranking, critiques, vote tally, law section reconciliation, outcome likelihood |

The moderator JSON contract (`llm_council.py:888-935`) ships unchanged in the prompt — response shape returned to React is byte-identical.

### `/health` endpoint

Mirror `validate_council_connectivity` (`llm_council.py:1241-1360`):
- `GET /health` → returns config + token-presence flags. No upstream calls.
- `GET /health?live=1` → fires 5 parallel probe fetches, `system_prompt = "You are a connectivity probe. Reply OK"`, `max_tokens=256`. `Promise.all` with 25s overall timeout. Returns `{ ok, probe_results }`.

### Semantic search migration (`/api/v1/search/semantic`)

Owned by Phase 2 (originally listed in Phase 1, deferred per architectural review — needs OpenAI embeddings). Lives in `workers/llm-council/` since it's an LLM-adjacent path.

**Flow**:
1. Worker receives `q` query string.
2. Calls OpenAI `text-embedding-3-small` via CF AI Gateway → 1536-dim vector.
3. Issues pgvector ANN query against `immigration_cases.embedding`:
   ```sql
   SELECT *, embedding <=> $1 AS distance
   FROM immigration_cases WHERE embedding IS NOT NULL
   ORDER BY distance LIMIT $2
   ```
4. Optionally calls `search_cases_hybrid` RPC for blended FTS + vector ranking.
5. Returns `{ cases: [...], mode: "semantic" }`.

Shares `withRetry` and rate-limiting with LLM Council handler.

---

## Phase 3 — Background Job Migration

### Job state machine

```
        ┌─ enqueue ─┐
PENDING ────────────► RUNNING ─┬─► COMPLETED
                                ├─► FAILED       (DLQ after max_retries)
                                └─► CANCELLED    (user via DELETE /jobs/:id)
```

State owned by `JobStateDO` Durable Object (one per `job_id`). Mirrored to R2 every checkpoint for durability — DO is hot path; R2 is cold rebuild source.

DO state shape (≤2 KB):
```json
{
  "job_id": "dl-2026-04-26-abc123",
  "type": "download | pipeline | legislations-update",
  "state": "PENDING|RUNNING|COMPLETED|FAILED|CANCELLED",
  "created_at": "2026-04-26T07:33:00Z",
  "started_at": "...",
  "finished_at": "...",
  "progress": { "total": 9, "completed": 3, "current": "AATA 2024" },
  "params": { "courts": ["AATA","FCA"], "limit": 500 },
  "error": null,
  "results_uri": "r2://immi-case-job-results/dl-.../result.json",
  "checkpoints": ["r2://immi-case-job-state/dl-.../checkpoint-001.json"]
}
```

### Cloudflare Queue setup

`workers/jobs/wrangler.toml`:
```toml
name = "immi-case-jobs"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[[queues.producers]]
binding = "JOB_QUEUE"
queue = "immi-case-job-queue"

[[queues.consumers]]
queue = "immi-case-job-queue"
max_batch_size = 5
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "immi-case-job-dlq"
max_concurrency = 10

[[r2_buckets]]
binding = "JOB_STATE"
bucket_name = "immi-case-job-state"

[[r2_buckets]]
binding = "JOB_RESULTS"
bucket_name = "immi-case-job-results"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "c961b377ef0c4ec2a01d9d7220db7c93"

[durable_objects]
bindings = [{ name = "JOB_STATE_DO", class_name = "JobStateDO" }]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["JobStateDO"]
```

Topology mirrors `workers/austlii-scraper/wrangler.toml:14-25` — proven in production.

### R2 buckets

| Bucket | Purpose | Object lifecycle |
|---|---|---|
| `immi-case-job-state` | Per-job checkpoint snapshots, DLQ payloads | Delete after 14 days |
| `immi-case-job-results` | Final job output (`result.json`, log dumps) | Delete after 30 days |

### Per-job design

#### `download/start` — bulk full-text downloader

Source: `download_fulltext.py` + `api_pipeline.py:176-207`.

1. **Producer** `POST /api/v1/download/start`. Body: `{ court: "FCA", limit: 5000 }`.
2. Generate `job_id`, write PENDING to `JobStateDO`, fan out N batches of 25 cases each onto `JOB_QUEUE` with `{ type: "download", job_id, batch_id, case_ids: [...] }`.
3. **Consumer** `queue()` handler: for each batch:
   - For each `case_id`, call `austlii-scraper` Worker via Service Binding (don't reimplement scraping — `extractFullText` / `extractMetadata` already exist in `workers/austlii-scraper/src/parser.ts`).
   - Write each result row directly via `getSql(env)` (Hyperdrive). `INSERT ... ON CONFLICT (case_id) DO UPDATE` — idempotent for resumption.
   - After each batch: `await JobStateDO.fetch("/checkpoint", ...)`.
4. **Completion**: DO sees `completed >= total` → COMPLETED, writes `result.json` to `JOB_RESULTS`.

**Concurrency**: `max_concurrency=10` × per-court soft cap of 3 enforced by DO state (DO check before batch: if 3 batches for same court already in-flight, `message.retry({ delaySeconds: 30 })`).

**Resumability**: each batch checks `case_id` existence in Postgres before fetching → skip. Combined with idempotent ON CONFLICT, `job_id` re-run is safe.

**Sizing**: 9 courts × ~150K cases worst case. 25 cases/batch × 10 concurrent × 5s/case = ~2.5h wall. Already feasible — `austlii-scraper` does this today.

#### `pipeline-action` — three-phase smart pipeline

Source: `api_pipeline.py:218-248`, business logic in `immi_case_downloader.pipeline.start_pipeline`. Three sequential phases: crawl → clean → download.

1. `POST /api/v1/pipeline-action {action: "start", databases, start_year, end_year}` → `pipeline-stage-1` message.
2. Phase 1 consumer: walks AustLII year listings, enqueues per-year scrape messages.
3. Phase 2 consumer: pulls scraped HTML from R2, runs cleaning regex (port `pipeline._clean` to JS — pure regex, no deps).
4. Phase 3 consumer: same as `download/start` consumer (reuses per-batch fetcher).
5. **Stop** (`action: "stop"`): `DELETE /api/v1/jobs/:job_id`. DO sets state=CANCELLED. Consumers check DO state at top of each batch — CANCELLED → `message.ack()` without work.

#### `legislations/update`

Source: `legislations.py:214-321`.

1. `POST /api/v1/legislations/update {law_id?}` enqueues 1–6 messages of `{ type: "legislations", law_id }`.
2. Consumer: ports `LegislationScraper` to JS. HTML parsing via `HTMLRewriter` (Cloudflare-native, no DOM). Writes per-law section records into new Postgres table `legislations_sections` (replaces JSON file approach).
3. Frontend reads via existing `/api/v1/legislations/*` endpoints (already on Worker).
4. Status: `GET /api/v1/legislations/update/status` proxies `JobStateDO.fetch("/status")`.

**Migration win**: kills global `_legislations_cache` (`legislations.py:33-86`) which can't survive Container restarts.

### Auth

```js
const token = request.headers.get("X-Job-Token");
if (token !== env.JOB_AUTH_TOKEN) return new Response("Unauthorized", { status: 401 });
```

`X-Job-Token` set by SPA after CSRF validation in `proxy.js`. Set via `wrangler secret put JOB_AUTH_TOKEN`.

### Cost analysis

Container hours today: 2 instances × 730 h = 1460 instance-hours/mo. ~30% utilization on jobs work ≈ $25–35/mo of Container bill.

After migration:
- **Queue**: 1M ops free, then $0.40/M. Estimated 200K msgs/mo → free.
- **R2**: Class A ops 1M free/mo, storage $0.015/GB. ~50K writes + 5GB → ~$0.08/mo.
- **DO**: $0.15/M req, $0.20/GB-mo storage. ~500K req → ~$0.08/mo.
- **Worker invocations**: ≤1M/mo extra → ~$0.30/mo.

**Net savings ≈ $25/mo + Container retirement removes a deployment surface entirely.**

### Migration plan per Python job

| Python module | Reusable in JS? | New JS location |
|---|---|---|
| `download_fulltext.py` orchestrator | No — replace with Queue producer | `workers/jobs/src/handlers/download.ts` |
| `download_fulltext.py` per-case fetch | Already exists | Reuse `workers/austlii-scraper` via Service Binding |
| `pipeline._clean` (regex post-process) | Port verbatim — pure regex | `workers/jobs/src/pipeline/clean.ts` |
| `LegislationScraper.scrape_one` | Port using `HTMLRewriter` | `workers/jobs/src/handlers/legislations.ts` |
| `JobManager` (`web/job_manager.py`) | Replaced by `JobStateDO` | `workers/jobs/src/state.ts` |

Each per-job handler is ~120 lines JS, mirroring `workers/austlii-scraper/src/index.ts:259-369` (`processJob`).

---

## Phase 4 — Container Retirement

### Pre-flight checklist (block retirement PR on every item)

- [ ] All Phase 1 read endpoints handled in `proxy.js` (today: 32; after Phase 1: ≥40).
- [ ] All Phase 1 write endpoints handled in `proxy.js`.
- [ ] CSRF endpoint `/api/v1/csrf-token` shipped on Worker (Phase 1).
- [ ] Phase 2 LLM endpoints served by `workers/llm-council/`.
- [ ] Phase 3 job endpoints served by `workers/jobs/`.
- [ ] React SPA served via Workers Static Assets binding.
- [ ] Judge photos uploaded to R2.
- [ ] All E2E tests passing (`make test-e2e`) against Workers-only stack on preview deployment.
- [ ] Contract tests (Worker vs Flask) passing **24 consecutive hours** in CI.
- [ ] Production logs (`wrangler tail`) show **zero** Container forwards for past 7 days (instrument by adding `console.log("FALLTHROUGH_TO_FLASK", url.pathname)` in catch-all branch and grep logs).
- [ ] `frontend/src/lib/api.ts` audited — every endpoint constant in Worker handler list.

### `wrangler.toml` diff

```diff
 name = "immi-case"
 compatibility_date = "2025-01-01"
 compatibility_flags = ["nodejs_compat"]

 main = "workers/proxy.js"

 [[hyperdrive]]
 binding = "HYPERDRIVE"
 id = "c961b377ef0c4ec2a01d9d7220db7c93"
 localConnectionString = "..."

-[durable_objects]
-bindings = [{ name = "FlaskBackend", class_name = "FlaskBackend" }]
-
-[[migrations]]
-tag = "v1"
-new_sqlite_classes = ["FlaskBackend"]
-
 [[routes]]
 pattern = "immi.trackit.today"
 custom_domain = true

-[[containers]]
-class_name = "FlaskBackend"
-image = "./Dockerfile"
-max_instances = 2

 [assets]
 binding = "ASSETS"
 directory = "./immi_case_downloader/static/react"
 not_found_handling = "single-page-application"
 run_worker_first = ["/api/v1/*", "/health"]

 [[r2_buckets]]
 binding = "JUDGE_PHOTOS"
 bucket_name = "immi-case-judge-photos"

+[services]
+LLM_COUNCIL = { service = "immi-case-llm-council" }
+JOBS_WORKER = { service = "immi-case-jobs" }

 [limits]
 cpu_ms = 60000
```

**Follow-up DO destroy migration** (must ship in its own deploy after `v1` is no longer referenced):
```toml
[[migrations]]
tag = "v2"
deleted_classes = ["FlaskBackend"]
```
Without this, Cloudflare retains DO storage indefinitely.

### File deletions

| Path | Action | Rationale |
|---|---|---|
| `Dockerfile` | Delete | Container image no longer built |
| `web.py` | Delete | Flask entry point |
| `immi_case_downloader/web/` (entire dir) | Delete | Flask app factory + routes + jobs |
| `requirements.txt` (Flask, gunicorn, flask-wtf, flask-limiter) | Edit | Remove Flask-specific deps; keep CLI deps (pandas, requests, beautifulsoup4) |
| `download_fulltext.py` | **Keep** | Offline backfill / disaster-recovery |
| `extract_structured_fields.py` | **Keep** | Offline LLM extraction batch |
| `extract_llm_fields.py`, `merge_llm_results.py` | **Keep** | Offline batch tools |
| `migrate_csv_to_supabase.py` | **Keep** | Operator script |
| `sync_judge_bios_supabase.py` | **Keep** | Operator script |
| `run.py` | **Keep** | CLI for local dev |
| `tests/e2e/react/` | Edit | Repoint to Worker URL |
| `Makefile` | Edit | Remove `make api` (Flask gone); keep `make ui`, `make build`, `make test-*` |

### CI changes

`.github/workflows/deploy-worker.yml` diff:

```diff
-name: Deploy Worker (Cloudflare Containers + Hyperdrive)
+name: Deploy Workers (Hyperdrive)

 on:
   push:
     branches: [main]
     paths:
       - "workers/**"
-      - "Dockerfile"
       - "wrangler.toml"
-      - "immi_case_downloader/**"
-      - "requirements.txt"
-      - "web.py"
+      - "frontend/**"
       - ".github/workflows/deploy-worker.yml"

 jobs:
   deploy:
-    runs-on: ubuntu-latest
+    runs-on: [self-hosted, macOS]
     steps:
       - uses: actions/checkout@v4
-      - uses: actions/setup-node@v4
-        with: { node-version: "20" }
       - name: Install root Worker deps
         run: npm ci
+      - name: Build frontend
+        run: cd frontend && npm ci && npm run build
       - name: Deploy proxy Worker
         env:
           CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
         run: npx wrangler deploy
+      - name: Deploy llm-council Worker
+        working-directory: workers/llm-council
+        run: npm ci && npx wrangler deploy
+      - name: Deploy jobs Worker
+        working-directory: workers/jobs
+        run: npm ci && npx wrangler deploy
+      - name: Smoke check
+        run: |
+          curl -fsS https://immi.trackit.today/api/v1/stats | jq -e '.total_cases > 0'
+          curl -fsS https://immi.trackit.today/api/v1/analytics/llm-council/health | jq -e '.gateway.cf_aig_token_present == true'
```

`runs-on: [self-hosted, macOS]` per project convention (CLAUDE.md). `docker build` step removed — saves ~3 min per deploy.

### DNS / routing post-deploy verification (smoke checklist)

```bash
# Read path
curl -fsS https://immi.trackit.today/api/v1/stats | jq .
curl -fsS https://immi.trackit.today/api/v1/cases/count | jq .
curl -fsS "https://immi.trackit.today/api/v1/cases?limit=1" | jq '.data[0].case_id'
curl -fsS https://immi.trackit.today/api/v1/analytics/judges | jq '.data | length'
curl -fsS https://immi.trackit.today/api/v1/court-lineage | jq .
curl -fsS https://immi.trackit.today/api/v1/data-dictionary | jq '.fields | length'

# Write path (CSRF)
TOKEN=$(curl -fsS -c cookies.txt https://immi.trackit.today/api/v1/csrf-token | jq -r .csrf_token)
curl -fsS -b cookies.txt -H "X-CSRF-Token: $TOKEN" \
     -X POST https://immi.trackit.today/api/v1/cache/invalidate -d '{}' | jq .

# Phase 2 endpoints
curl -fsS "https://immi.trackit.today/api/v1/analytics/llm-council/health?live=1" | jq '.ok'

# Phase 3 endpoints
curl -fsS https://immi.trackit.today/api/v1/job-status | jq .

# SPA shell
curl -fsSI https://immi.trackit.today/app/ | grep -i "content-type: text/html"
curl -fsSI https://immi.trackit.today/app/cases | grep -i "content-type: text/html"
```

If any 5xx surfaces or redirect points to (now-gone) DO → **rollback immediately**.

### Rollback plan

**Soft rollback (within 24h)**:
```bash
npx wrangler rollback                      # main proxy
cd workers/llm-council && npx wrangler rollback
cd workers/jobs && npx wrangler rollback
```
The `[[containers]]` section is still present in *previous* deploy because Cloudflare keeps last image cached ~24h. Effectively single-command restore.

**Hard rollback (24h–7d post-deploy)**:
DO Container instance lingers as warm rollback target for 7 days post-retirement (do NOT run `wrangler delete` on `FlaskBackend` until day 7).
1. `git revert <retirement-commit>`
2. `wrangler deploy` from reverted main → restores `[durable_objects]`, `[[containers]]`, image build.
3. Cloudflare rebuilds Container from `Dockerfile`. ~3 min.
4. Verify with curl checklist; remove `migrations v2 deleted_classes` if shipped.

**After 7 days**: DO gone. Hard rollback now requires re-creating Hyperdrive→Container plumbing from scratch. Fix forward in Workers stack is the only sane path.

### Decommission timeline

| Day | Action |
|---|---|
| **D-7** | Land Phase 3 jobs Worker. Run jobs through both stacks; compare. |
| **D-3** | Land Phase 2 council Worker. Frontend feature-flagged to call new endpoint; old Flask path still live. |
| **D-1** | Pre-flight checklist green ≥24h. Logs show zero Flask fall-through. |
| **D-0** | Land retirement PR: `wrangler.toml` diff applied, files deleted, CI updated. Deploy. |
| **D-0 +1h** | Run full curl checklist + manual SPA smoke + LLM Council smoke. |
| **D-0 +24h** | Soft-rollback window closes. |
| **D-0 +7d** | Land follow-up PR: `[[migrations]] tag = "v2", deleted_classes = ["FlaskBackend"]`. Deploy. DO storage destroyed. |
| **D-0 +14d** | R2 lifecycle deletes `JOB_STATE` checkpoints. |
| **D-0 +30d** | R2 lifecycle deletes `JOB_RESULTS`. |

Container hours stop billing at D-0 +7d. Final saving ~$60/mo realized.

---

## E2E Test Reinforcement Plan

### Coverage audit (existing 22 e2e files)

| Existing test | Endpoints covered | Phase | Status |
|---|---|---|---|
| `test_react_case_crud.py` | POST/PUT/DELETE cases (UI) | 1 | Needs update — no API-level assert, no CSRF flow, no 409/422 sad paths |
| `test_react_export.py` | GET export/csv\|json | 1 | Needs update — no streaming/large-dataset, no abort, no content-type |
| `test_react_jobs.py` | GET job-status, POST download/start, POST pipeline-action (UI only) | 3 | Gap — UI-only, no API shape, no polling |
| `test_react_smoke.py` | GET stats, cases, filter-options, SMOKE_PAGES | 1 | Sufficient for read-path |
| `test_react_dashboard.py` | GET stats | 1 | Sufficient |
| `test_react_analytics.py` | GET analytics/* (8 ep) | 1 | Sufficient |
| `test_react_navigation.py` | GET /, /app/* | 1 | Needs update — no deep-link refresh post-migration |
| `test_react_batch.py` | POST cases/batch | 1 | Gap — no partial-failure |
| `test_react_saved_searches.py` | POST taxonomy/guided-search | 1 | Gap — no API shape assert |
| `test_react_judge_profiles.py` | GET analytics/judges, judge-photo | 1 | Needs update — no R2 404 path |
| `test_react_data_pages.py` | GET legislations/*, data-dictionary | 1 | Sufficient |
| `test_react_dark_mode.py`, `test_react_theme.py`, `test_react_responsive.py`, `test_react_keyboard.py`, `test_react_rapid_nav.py`, `test_react_concept_intelligence.py`, `test_react_success_rate.py`, `test_react_case_detail.py`, `test_react_cases_list.py` | UI-only / read-path | 1 | Not applicable / sufficient |
| **LLM Council** | None | 2 | Full gap — no test file |
| **Cache invalidate** | None | 1 | Full gap |
| **Bookmarks export** | None | 1 | Full gap |
| **Semantic search** | None | 2 | Full gap |
| **FTS search** | Partial in smoke | 1 | Gap — no pagination/empty edge |

**Health**: read path (32 endpoints) adequately covered. Write/CSRF/LLM/jobs concentrate the migration risk — 7 endpoint groups have zero coverage.

### New tests required

#### Phase 1

**`tests/e2e/react/test_react_csrf.py` (new)**
- `test_csrf_token_endpoint_returns_token` — happy: 200 + `csrf_token` non-empty; sad: cross-origin gets 200 (CSRF is session-bound); idempotency in-session
- `test_post_without_csrf_returns_403`

```python
def _csrf(base_url):
    s = requests.Session()
    token = s.get(f"{base_url}/api/v1/csrf-token", timeout=5).json()["csrf_token"]
    return s, token

def test_csrf_token_endpoint_returns_token(base_url):
    session = requests.Session()
    resp = session.get(f"{base_url}/api/v1/csrf-token", timeout=5)
    assert resp.status_code == 200
    assert len(resp.json()["csrf_token"]) > 10

def test_post_without_csrf_returns_403(base_url):
    resp = requests.post(f"{base_url}/api/v1/cases", json={"title": "x"}, timeout=5)
    assert resp.status_code == 403
```

**`test_react_case_crud.py` (extend `TestCreateCase`)**
- `test_create_case_api_response_shape` — happy/sad/edge (duplicate citation → 409)

```python
def test_create_case_api_response_shape(base_url):
    session, token = _csrf(base_url)
    resp = session.post(f"{base_url}/api/v1/cases",
                        json={"title": "E2E API Case", "citation": "[2099] TEST 1"},
                        headers={"X-CSRF-Token": token}, timeout=10)
    assert resp.status_code == 201
    assert len(resp.json()["case"]["case_id"]) == 12
```

**`test_react_batch.py` (extend)**
- `test_batch_insert_partial_failure` — mix valid + duplicate → `{"affected": N, "errors": [...]}`

**`test_react_cache.py` (new)**
- `test_cache_invalidate_requires_csrf` — happy (200), sad (403 no CSRF), idempotent

**`test_react_search.py` (new)**
- `test_fts_search_returns_paginated_results`
- `test_fts_search_empty_query_returns_error`

**`test_react_export.py` (extend)**
- `test_csv_export_content_type`
- `test_json_export_content_type`
- `test_csv_export_with_filter_reduces_count`
- `test_csv_export_streams_large_dataset` (50K row sanity, no OOM)

**`test_react_judge_photo.py` (new)**
- `test_judge_photo_404_returns_404`
- `test_judge_photo_valid_filename_returns_image`

**`test_react_navigation.py` (extend)**
- `test_spa_deep_link_refresh_renders_page` — `/cases/<id>` direct nav doesn't 404
- `test_spa_root_serves_index_html`

#### Phase 2 — LLM Council

**`test_react_llm_council.py` (new)** — gated on `MOCK_LLM=1`
- `test_llm_council_health` — 200 or 503, never null `status`
- `test_llm_council_run_mocked` — fixture-based response shape: `analyses[]`, `consensus`

**LLM mocking**: add to `llm_council.py` top:
```python
if os.getenv("MOCK_LLM") == "1":
    return json.loads(Path("tests/fixtures/llm_council_response.json").read_text())
```
Create `tests/fixtures/llm_council_response.json` matching real contract.

**Semantic search**:
- `test_semantic_search_returns_ranked_results` — mock embedding via `MOCK_LLM=1`

#### Phase 3 — Background jobs

**`test_react_jobs.py` (extend)**
- `test_job_status_shape_when_idle` — keys: `status`, `progress`, `message`
- `test_pipeline_status_shape`
- `test_legislations_update_status_shape`
- `test_download_start_and_poll_job_status` — POST → poll up to 5×0.5s for `running`

```python
def _poll_job_status(base_url, expected="running", max_attempts=5):
    for _ in range(max_attempts):
        body = requests.get(f"{base_url}/api/v1/job-status", timeout=5).json()
        if body.get("status") == expected: return body
        time.sleep(0.5)
    return body
```

### Contract tests (Worker vs Flask side-by-side, until D-0)

**Pattern** — `tests/contract/conftest.py`:
```python
WORKER_BASE = os.getenv("WORKER_URL", "https://immi.trackit.today")
FLASK_BASE  = os.getenv("FLASK_URL",  "http://localhost:8080")

@pytest.fixture
def contract_compare():
    def _compare(path, params=None, method="GET", json=None, headers=None):
        w = requests.request(method, f"{WORKER_BASE}{path}", params=params, json=json, headers=headers, timeout=15)
        f = requests.request(method, f"{FLASK_BASE}{path}",  params=params, json=json, headers=headers, timeout=15)
        assert w.status_code == f.status_code
        diff = deepdiff.DeepDiff(f.json(), w.json(), ignore_order=True,
                                 exclude_paths=["root['generated_at']"])
        assert not diff, f"Schema drift on {path}:\n{diff}"
    return _compare
```

**Five riskiest endpoints to contract-test**:
1. `GET /api/v1/cases?page=1&per_page=10` — seek pagination
2. `GET /api/v1/analytics/outcomes?court=AATA` — RPC aggregation
3. `GET /api/v1/analytics/judge-profile?name=Smith` — bio merge logic
4. `GET /api/v1/stats` — dashboard entrypoint
5. `GET /api/v1/cases/:id` — null handling, field ordering

### Test infrastructure changes

- **Local Worker**: `wrangler dev workers/proxy.js --local --port 8787 --var MOCK_LLM:1`
- **Postgres seed**: dedicated `e2e_test` schema, `supabase db reset --local`. NEVER point contract tests at production Supabase
- **LLM mocking**: `MOCK_LLM=1` env in CI; canned responses
- **R2 mocking**: `wrangler dev --r2 JUDGE_PHOTOS=./tests/fixtures/r2/`. Seed fixture dir with 1×1 JPEG.

### CI integration

`.github/workflows/ci.yml` additions:

```yaml
worker-contract-test:
  runs-on: [self-hosted, macOS]
  needs: [test-python, test-frontend]
  env:
    MOCK_LLM: "1"
    WORKER_URL: "http://localhost:8787"
    FLASK_URL:  "http://localhost:8080"
  steps:
    - uses: actions/checkout@v4
    - run: npm ci --legacy-peer-deps
    - name: Install Python venv
      run: |
        python3 -m venv .venv
        .venv/bin/pip install -r requirements.txt -q
        .venv/bin/pip install deepdiff -q
    - name: Start Flask (background)
      run: |
        PORT=8080 BACKEND=sqlite .venv/bin/python web.py &
        echo $! > .flask.pid
        sleep 3
    - name: Start Wrangler dev (background)
      run: |
        npx wrangler dev workers/proxy.js --local --port 8787 &
        echo $! > .wrangler.pid
        sleep 5
    - name: Run contract tests
      run: .venv/bin/pytest tests/contract/ -x --timeout=30 -q
    - name: Teardown
      if: always()
      run: |
        kill $(cat .flask.pid) 2>/dev/null || true
        kill $(cat .wrangler.pid) 2>/dev/null || true
```

Add `MOCK_LLM: "1"` to `env:` block of `test-python` to prevent any LLM calls during unit tests.

### Post-deploy smoke checklist

- `curl -s https://immi.trackit.today/api/v1/csrf-token | jq 'has("csrf_token")'` → `true`
- `curl -s "https://immi.trackit.today/api/v1/cases?per_page=1" | jq '[has("cases"), has("total")] | all'` → `true`
- `curl -s -X POST https://immi.trackit.today/api/v1/cases -H "Content-Type: application/json" -d '{}' | jq '.error // .status'` → 403 or 422, never 500
- `curl -s "https://immi.trackit.today/api/v1/search?q=visa&per_page=3" | jq '.cases | length'` → integer 0–3
- `curl -s -I https://immi.trackit.today/api/v1/export/csv | grep -i content-disposition` → `attachment; filename=...csv`
- `curl -s https://immi.trackit.today/api/v1/judge-photo/nonexistent.jpg | jq '.status // empty'` → 404
- `curl -s https://immi.trackit.today/api/v1/job-status | jq '.status'` → `"idle"` or `"running"`
- `curl -s https://immi.trackit.today/api/v1/analytics/llm-council/health | jq '.status'` → `"ok"` or `"degraded"`
- `curl -s https://immi.trackit.today/ | grep -c 'id="root"'` → `1`
- `curl -s https://immi.trackit.today/cases/does-not-exist | grep -c 'id="root"'` → `1`

---

## Risk Register

| # | Risk | Phase | Severity | Mitigation |
|---|---|---|---|---|
| R1 | CSRF cookie mismatch between Flask (server-session) and Worker (HMAC) — first deploy may invalidate every active session | 1 | Medium | SPA already retries on 403 via `ensureCsrfToken`. Document; deploy during low-traffic window |
| R2 | Streaming export hits 30s CPU cap on slow connections | 1 | Medium | `[limits] cpu_ms = 60000` plus client-side timeout watchdog; cursor-based so wall time uncapped |
| R3 | Vite `base: "/"` change breaks any hardcoded `/static/react/` URL in Flask templates or e2e tests | 1 | Low | Audit grep for `/static/react/`; update test selectors |
| R4 | Tag-array column logic on cases falls back to Flask (already documented) — Phase 1 doesn't migrate this | 1 | Low | Keep fallback; track follow-up to port pipe-delimited array WHERE clause |
| R5 | guided-search loses fuzzywuzzy alias matching | 1 | Low | Document regression; port alias normaliser into `normaliseJudgeName` as follow-up |
| R6 | LLM streaming SSE backpressure — slow client → Worker holds connection >10min | 2 | Medium | 70s `AbortController` timeout per expert; client-side `EventSource` reconnect with backoff |
| R7 | CF AI Gateway rate limit cascading (5 parallel experts × council requests) | 2 | Medium | Per-IP rate limit binding (5/min); document gateway upstream limits |
| R8 | Background job DO state corruption mid-checkpoint | 3 | Medium | R2 mirrored checkpoints; idempotent ON CONFLICT writes; resumable from any checkpoint |
| R9 | Queue dead-letter pile-up if AustLII rate-limits the scraper | 3 | Low | DLQ alarms; manual replay tool; per-court soft cap (max 3 in-flight batches) |
| R10 | Container retirement breaks legacy Jinja2 paths (`/dashboard`, `/cases`, `/search` HTML) — these still proxy to Flask today | 4 | High | Audit before D-0: confirm React SPA covers all UI; legacy Jinja2 already deprecated per CLAUDE.md |
| R11 | DO storage destroyed by `migrations v2` before rollback completes | 4 | Critical | Ship `v2` only at D-0+7d after soft-rollback window expired; never bundle with retirement deploy |
| R12 | Wrangler dev test infrastructure flakiness in CI (`sleep 5` race) | Test | Low | Replace with port-readiness probe loop |
| R13 | E2E tests pollute production Supabase if `SUPABASE_URL` accidentally points there | Test | Critical | Hard-fail in conftest if SUPABASE_URL contains production project ref `urntbuqczarkuoaosjxd` |

---

## Cross-Cutting Concerns

### Schema-drift guard during Phase 1–3

While both Flask and Worker serve overlapping endpoints, drift is the highest live-incident risk (this plan exists because of one such drift today).

**Required during transition** (kill switch when Phase 4 lands):
- CI job `worker-contract-test` runs every PR + every hour on `main`
- Slack/email alert on schema diff > 0
- Dashboard: `https://immi.trackit.today/__contract` returns Worker-vs-Flask diff JSON for the 5 riskiest endpoints

### Secret rotation timeline

| Secret | Created | Rotated when |
|---|---|---|
| `CSRF_SECRET` | Phase 1 deploy | Quarterly; on any suspected leak |
| `CF_AIG_TOKEN` | Phase 2 deploy | Per CF AI Gateway rotation policy (annual) |
| `JOB_AUTH_TOKEN` | Phase 3 deploy | Quarterly |
| Hyperdrive Postgres password | Already exists | On Supabase rotation event |

Rotate via `wrangler secret put <name>` — zero-downtime.

### Frontend type contract (one truth source)

After Phase 1, every Worker handler must have a JSDoc schema annotation:
```js
/**
 * @returns {{cases: Array<{case_id: string, title: string}>, total: number}}
 */
async function handleGetCases(url, env) { /* ... */ }
```

Frontend `frontend/src/types/case.ts` types **must import** from a generated `worker.types.d.ts` produced by a future tool (`tsc --emitDeclarationOnly` over annotated proxy.js) — eliminates today's bug class permanently. Out-of-scope for this plan; track as follow-up.

### Observability

Every Worker handler emits structured `console.log`:
```
{"level":"info","handler":"handleGetCases","duration_ms":42,"rows":50,"cf_ray":"..."}
```

Logpush already configured per CLAUDE.md mention of `wrangler tail` workflow. No additional plumbing.

---

## Decision Log & Open Questions

### Decisions made (synthesized from /team)

| # | Decision | Rationale |
|---|---|---|
| D1 | `/search/semantic` migrates in Phase 2, not Phase 1 | Needs OpenAI embedding API; LLM-adjacent — belongs in `workers/llm-council/` |
| D2 | LLM Council deploys as separate Worker `workers/llm-council/` | CPU isolation, secret blast radius, independent prompt deploy |
| D3 | Background jobs deploy as separate Worker `workers/jobs/` | Mirrors `workers/austlii-scraper/` pattern; Queue-based |
| D4 | CSRF: stateless double-submit HMAC, NOT session-based | Worker is stateless; OWASP-blessed pattern; no DO needed |
| D5 | SPA via Workers Static Assets binding (NOT R2) | Native Cloudflare; SPA routing built-in via `not_found_handling` |
| D6 | Vite `base: "/"` (not `/static/react/`) | Required for Workers Static Assets; cleaner URLs |
| D7 | Streaming export uses Postgres cursor + Workers ReadableStream | Bounded memory; backpressure native; supports 50K row export |
| D8 | DO Container retained 7 days post-D-0 as warm rollback | Cloudflare doesn't auto-delete — buys time for hard rollback |
| D9 | Phase 3 OPTIONAL — bulk jobs can stay on Mac Mini self-hosted runner | Not on critical path; CLAUDE.md already mentions self-hosted convention |

### Open questions (owner sign-off needed)

- **Q1**: Phase 3 yes/no? Or keep `download/start` etc. on offline Mac Mini scripts forever? *(Recommendation: NO Phase 3 unless production UI users actually click "Start Download" — they don't today)*
- **Q2**: Contract test threshold — block PR on >0 diffs, or allow `< N` non-critical fields? *(Recommendation: block on >0 in 5 riskiest; warn-only on others)*
- **Q3**: Legacy Jinja2 dashboard (`/dashboard`, `/cases.html`) — retire with Phase 4, or keep proxying to Flask via separate fallback Worker? *(Recommendation: confirm zero usage via `wrangler tail | grep -E "GET (/dashboard|/cases.html)"` for 7 days, then retire)*
- **Q4**: `/api/v1/judge-photo/:filename` — fallback to 1×1 transparent PNG on 404 (frontend-friendly), or strict 404 JSON? *(Recommendation: 404 JSON; frontend already shows initials avatar on missing photo)*
- **Q5**: tags column WHERE-clause logic in `/api/v1/cases` (currently falls back to Flask via `buildCasesWhere() === null`) — port in Phase 1, or defer? *(Recommendation: defer — Phase 1 already 1-2 days; tag filtering is rare per CLAUDE.md)*
- **Q6**: LLM Council mock fixture — auto-generate from real LLM output, or hand-curated? *(Recommendation: hand-curated minimal — easier to maintain)*

### File path references for implementer

- `/Users/d/Developer/IMMI-Case-/workers/proxy.js:85` — `getSql(env)` per-request client (load-bearing)
- `/Users/d/Developer/IMMI-Case-/workers/proxy.js:256` — `buildCasesWhere()` reused
- `/Users/d/Developer/IMMI-Case-/workers/proxy.js:1782` — `proxyToFlask()` fallback (kept until Phase 4)
- `/Users/d/Developer/IMMI-Case-/workers/proxy.js:1813` — native GET routing block (insertion point)
- `/Users/d/Developer/IMMI-Case-/workers/austlii-scraper/wrangler.toml:14-25` — Phase 3 reference template
- `/Users/d/Developer/IMMI-Case-/workers/austlii-scraper/src/index.ts:73-118` — Queue handler reference
- `/Users/d/Developer/IMMI-Case-/immi_case_downloader/web/routes/api_cases.py:961-1062` — CRUD + batch source
- `/Users/d/Developer/IMMI-Case-/immi_case_downloader/web/routes/api_cases.py:1208-1280` — search modes
- `/Users/d/Developer/IMMI-Case-/immi_case_downloader/web/routes/api_export.py:29-76` — current non-streaming export
- `/Users/d/Developer/IMMI-Case-/immi_case_downloader/web/routes/bookmarks.py:24-190` — HTML report template
- `/Users/d/Developer/IMMI-Case-/immi_case_downloader/web/routes/api_taxonomy.py:587-727` — guided-search flows
- `/Users/d/Developer/IMMI-Case-/immi_case_downloader/web/routes/api.py:1374-1378` — `generate_csrf` (replaced)
- `/Users/d/Developer/IMMI-Case-/immi_case_downloader/web/routes/api.py:2559-2589` — judge-photo (replaced by R2)
- `/Users/d/Developer/IMMI-Case-/immi_case_downloader/web/security.py:44-56` — flask-wtf CSRF defaults
- `/Users/d/Developer/IMMI-Case-/immi_case_downloader/models.py:47-51` — `case_id` SHA-256-12 derivation
- `/Users/d/Developer/IMMI-Case-/immi_case_downloader/llm_council.py:278-441,739-1168` — port verbatim (law sections + moderator)
- `/Users/d/Developer/IMMI-Case-/wrangler.toml` — root config
- `/Users/d/Developer/IMMI-Case-/.github/workflows/deploy-worker.yml` — CI to update
- `/Users/d/Developer/IMMI-Case-/Dockerfile` — delete at Phase 4
- `/Users/d/Developer/IMMI-Case-/download_fulltext.py` — keep as offline tool

---

---

## REVISION 1 — Critic Findings & Resolution (2026-04-26)

The autopilot Phase 1 Critic agent (`oh-my-claudecode:critic`) reviewed the plan after initial /team synthesis. 5 BLOCKING + 8 MAJOR + 7 MINOR findings surfaced. All BLOCKING items resolved inline above; remaining items addressed in this revision section.

### BLOCKING — resolved inline

| # | Finding | Resolution location |
|---|---|---|
| **B1** | Lexical search SQL referenced non-existent column `title_search` and used `to_tsquery` (which requires manual `:*` tokenization). Real column is `fts` (`supabase/migrations/20260218000000_initial_schema.sql:50`); existing repo uses `plainto_tsquery`/`websearch_to_tsquery` style (`hyperdrive_repository.py:158, 391`). | §Phase 1 #8 — SQL replaced with `fts @@ websearch_to_tsquery(...)` |
| **B2** | SPA `frontend/src/lib/api.ts:43` calls `fetch("/api/v1/csrf-token")` without `credentials: "include"`. `__Host-` cookies will be silently dropped on cross-origin / preview-deploy hosts. | See §B2 Resolution below |
| **B3** | CSRF cookie used `SameSite=Strict` — would break cookie on top-level navigation from email/Slack/Google links. | §CSRF Design — changed to `SameSite=Lax` (still CSRF-safe with double-submit) |
| **B4** | Streaming export reused shared `getSql(env)` (which has `max:1, idle_timeout:5`). Concurrent `pull()` and `cancel()` could race on `sql.end()`. | See §B4 Resolution below |
| **B5** | `[assets].run_worker_first = ["/api/v1/*", "/health"]` syntax may not match current Wrangler schema. | §Wrangler.toml deltas — changed to `run_worker_first = true` with verification note |

### B2 Resolution — frontend `credentials: "include"` audit (Phase 1 prerequisite)

Before any Phase 2 execution, patch `frontend/src/lib/api.ts`:

```diff
 async function fetchCsrfToken(): Promise<string> {
   if (csrfToken) return csrfToken;
-  const res = await fetch("/api/v1/csrf-token");
+  const res = await fetch("/api/v1/csrf-token", { credentials: "include" });
   const data = await res.json();
   csrfToken = data.csrf_token;
   return csrfToken!;
 }
```

And every `apiFetch()` call site that does writes — audit the central `fetch()` wrapper (around `lib/api.ts:94`) and add `credentials: "include"` if absent. Same-origin works without the flag in modern browsers; preview deploys (`*.workers.dev`) are cross-origin and need it.

**E2E test addition** (Phase 1 test plan, `test_react_csrf.py`):
```python
def test_csrf_cookie_sent_on_followup_write(base_url):
    s = requests.Session()
    token = s.get(f"{base_url}/api/v1/csrf-token", timeout=5).json()["csrf_token"]
    # cookie should now be in s.cookies
    assert "__Host-csrf" in [c.name for c in s.cookies]
    # subsequent write must succeed
    r = s.post(f"{base_url}/api/v1/cache/invalidate", json={},
               headers={"X-CSRF-Token": token}, timeout=5)
    assert r.status_code == 200
```

### B4 Resolution — Streaming export uses dedicated client

Update §Phase 1 #9 streaming export skeleton to instantiate a per-request export client (NOT the shared `getSql(env)` singleton):

```js
async function handleExportCsv(url, env) {
  // CORRECTED per Critic B4: dedicated client, idle_timeout disabled, guarded close.
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    idle_timeout: 0,         // never close mid-export
    connect_timeout: 5,
    fetch_types: false,
  });
  let closed = false;
  const safeEnd = async () => { if (!closed) { closed = true; await sql.end({ timeout: 1 }).catch(() => {}); } };

  const filters = parseCaseFilters(url.searchParams);
  const where = buildExportWhere(sql, filters);
  if (!where) { await safeEnd(); return null; }

  const cursor = sql`
    SELECT ${sql(CASE_FIELDS)} FROM ${sql(TABLE)} WHERE ${where}
    ORDER BY year DESC NULLS LAST LIMIT 50000
  `.cursor(500);

  // ... ReadableStream with start/pull/cancel as before, but call safeEnd() instead of sql.end()
}
```

### MAJOR — resolutions

**M1 — Drop Vite prerequisite (already shipped).** Verified `frontend/vite.config.ts:26` already has `base: "/"`. Remove from Hard Prerequisites; remove R3 from Risk Register; remove "Required Vite config change" subsection in §Phase 1 #11. **Implementer must NOT modify vite.config.ts.**

**M2 — `EDITABLE_FIELDS` inlined.** Authoritative source: `immi_case_downloader/web/helpers.py:13-20`. The Worker `pickEditableFields()` allow-list is exactly:

```js
const EDITABLE_FIELDS = [
  "citation", "title", "court", "court_code", "date", "year", "url", "source",
  "judges", "catchwords", "outcome", "visa_type", "legislation",
  "user_notes", "tags", "case_nature", "legal_concepts",
  "visa_subclass", "visa_class_code",
  "applicant_name", "respondent", "country_of_origin",
  "visa_subclass_number", "hearing_date", "is_represented", "representative",
];
const COERCION = {
  year: (v) => Number.isInteger(+v) ? +v : null,
  is_represented: (v) => v === true || v === "true" || v === 1 || v === "1",
};
function pickEditableFields(data, overrides = {}) {
  const out = { ...overrides };
  for (const f of EDITABLE_FIELDS) {
    if (data[f] === undefined) continue;
    if (f === "case_id") continue;          // case_id is server-computed, never client-supplied
    out[f] = COERCION[f] ? COERCION[f](data[f]) : String(data[f] ?? "");
  }
  return out;
}
```

`case_id` is **always** server-computed via `sha12()` — never read from PUT body. PUT path: ignore body `case_id`; INSERT path: compute from `citation || url || title`.

**M4 — Judge photos count corrected.** Verified: `downloaded_cases/judge_photos/` contains exactly **1 file** (`arthur-glass.jpg`). The 89 files counted by recursive `find` were elsewhere (likely `frontend/node_modules/` or build artifacts). The Flask handler today already 404s for the other 103+ judges — this is current behavior, NOT a regression. R2 migration is functionally a no-op for missing photos (still 404). Phase 1 §10 claim "~104 photos × ~80 KB ≈ 8 MB" → **corrected to "1 photo × 4.4 KB; remaining 103+ judges already 404 in Flask. R2 migration preserves current behavior."**

**M5 — SSE parser definition.** `parseSseChunks()` referenced in Phase 2 must parse OpenAI-compat SSE format (each chunk is `data: {json}\n\n`, terminator `data: [DONE]`). Add to `workers/llm-council/src/sse.js`:

```js
export function* parseSseLines(buffer) {
  const lines = buffer.split("\n\n");
  for (const block of lines) {
    if (!block.startsWith("data:")) continue;
    const payload = block.slice(5).trim();
    if (payload === "[DONE]") return;
    try { yield JSON.parse(payload); } catch { /* incomplete chunk */ }
  }
}
export function extractDelta(parsed) {
  return parsed?.choices?.[0]?.delta?.content ?? "";
}
```

In `/run` handler: keep a string buffer per provider, on each `read()` append decoded chunk, then iterate `parseSseLines(buffer)` and emit only the `extractDelta(parsed)` string. Trim buffer to start at last unterminated `data:` block.

**M6 — Rate limiting bindings.** Add to `wrangler.toml` for write endpoints (matches Flask `@rate_limit` decorators in `web/security.py`):

```toml
[[unsafe.bindings]]
name = "RL_CASES_CREATE"
type = "ratelimit"
namespace_id = "1100"
simple = { limit = 30, period = 60 }

[[unsafe.bindings]]
name = "RL_CASES_BATCH"
type = "ratelimit"
namespace_id = "1101"
simple = { limit = 10, period = 60 }

[[unsafe.bindings]]
name = "RL_BOOKMARKS_EXPORT"
type = "ratelimit"
namespace_id = "1102"
simple = { limit = 10, period = 60 }

[[unsafe.bindings]]
name = "RL_GUIDED_SEARCH"
type = "ratelimit"
namespace_id = "1103"
simple = { limit = 30, period = 60 }
```

Each handler does:
```js
const ip = request.headers.get("CF-Connecting-IP") || "unknown";
const { success } = await env.RL_CASES_CREATE.limit({ key: ip });
if (!success) return jsonErr("rate limited", 429);
```

**M7 — Phase 4 R10 (Jinja2 retirement) gating.** Move Open Question Q3 into the Pre-flight checklist as a hard gate: "30-day `wrangler tail | grep -E 'GET (/dashboard|/cases|/search\\.html)'` shows zero hits". Failing that gate → ship 301 redirects from Jinja2 paths to React equivalents BEFORE deletion.

**M8 — Contract test infrastructure.** Wrangler dev cannot bind to the real `FlaskBackend` DO — local Flask must run on `localhost:8080` and Worker `proxyToFlask()` must use a `BACKEND_URL` env var (`http://localhost:8080`) instead of DO when `env.LOCAL_DEV === "1"`. Add 5-line dev-mode branch in `proxyToFlask()`.

### MINOR — accepted as-is or noted

| # | Finding | Disposition |
|---|---|---|
| N1 | Cache HMAC key import in module scope | Accepted — add as Phase 2 perf pass; not blocking |
| N2 | `string_to_array` empty-tag edge case | Add unit test in Phase 1 e2e |
| N3 | `ipFromCfRay` is undefined — use `CF-Connecting-IP` | Adopted in M6 above |
| N4 | `pickEditableFields` undefined | Resolved in M2 above |
| N5 | `CASE_FIELDS`, `CASE_LIST_COLS`, `TABLE`, `HEX_ID_RE` etc. existence | Mark each in Phase 2 implementation: existing helpers are at `proxy.js:85`+, new helpers go at top of file |
| N6 | File:line spot-check | Accepted; main session verified `api_cases.py:961`, `api.py:1374`, `api.py:2647`, `bookmarks.py:161`, `api_taxonomy.py:587`, `llm_council.py:278/382/1241/37/54/113` are correct. Range overshoots in some citations are documentation-only — implementer reads function bodies, not line ranges |
| N7 | DNS / cache propagation | Add to D-0 smoke checklist: `curl -fsS -H "Cache-Control: no-cache" https://immi.trackit.today/` to bypass CDN |

### CRITIC FALSE-POSITIVE — rejected

**M1 (tag delimiter)**: Critic claimed plan's `string_to_array(coalesce(tags, ''), ',')` was wrong because tags are pipe-delimited. Verified: `api_cases.py:1045` does `case.tags.split(",")` — Flask stores tags **comma-delimited**. CLAUDE.md mention of "pipe-delimited" refers to a separate WHERE-clause filter logic on `tag` query param (which Phase 1 keeps as Flask fallback per existing plan). Plan SQL is correct. **No change.**

### Risk Register — additions

| # | Risk | Phase | Severity | Mitigation |
|---|---|---|---|---|
| **R14** | Hyperdrive backend connection pool exhaustion under burst (export + LLM Council × 5 + 50 GETs concurrent) | 1+2 | Medium | Per-request `getSql({max:1})` already enforces 1 connection per request. Hyperdrive pool default ~25; observable via Cloudflare dashboard. Add p99 connection-wait latency alert. |
| **R15** | Mobile Safari ITP partitions cookies on cross-site iframe embeds (e.g. judge profile preview) | 1 | Low | `__Host-csrf` is first-party only in current architecture (no iframes). Document constraint; revisit if iframe embeds added. |
| **R16** | Hyperdrive bindings missing in `workers/llm-council/wrangler.toml` for semantic search | 2 | Medium | Phase 2 wrangler.toml MUST include `[[hyperdrive]]` block matching the proxy Worker's id (`c961b377ef0c4ec2a01d9d7220db7c93`). Added explicitly. |
| **R17** | DO Container cold-start latency on rollback (60–90s spin-up) | 4 | Medium | Document: rollback window has measurable downtime. Pre-warm Container via canary request before flipping traffic. |

### Wrangler.toml — final consolidated diff (after Phase 1 + critic fixes)

```toml
# Add to existing file
[assets]
binding = "ASSETS"
directory = "./immi_case_downloader/static/react"
not_found_handling = "single-page-application"
run_worker_first = true

[[r2_buckets]]
binding = "JUDGE_PHOTOS"
bucket_name = "immi-case-judge-photos"

[limits]
cpu_ms = 60000

[[unsafe.bindings]]
name = "RL_CASES_CREATE"
type = "ratelimit"
namespace_id = "1100"
simple = { limit = 30, period = 60 }

[[unsafe.bindings]]
name = "RL_CASES_BATCH"
type = "ratelimit"
namespace_id = "1101"
simple = { limit = 10, period = 60 }

[[unsafe.bindings]]
name = "RL_BOOKMARKS_EXPORT"
type = "ratelimit"
namespace_id = "1102"
simple = { limit = 10, period = 60 }

[[unsafe.bindings]]
name = "RL_GUIDED_SEARCH"
type = "ratelimit"
namespace_id = "1103"
simple = { limit = 30, period = 60 }

# Secrets:
#   wrangler secret put CSRF_SECRET           (Phase 1, mandatory)
```

### Final readiness verdict

After REVISION 1, plan is **READY FOR PHASE 2 EXECUTION** with the following hard prerequisites:
1. ✅ B1 fixed (column name `fts`)
2. ✅ B3 fixed (`SameSite=Lax`)
3. ✅ B5 fixed (`run_worker_first = true`)
4. ⏳ B2 patch must ship: `frontend/src/lib/api.ts` add `credentials: "include"` to all fetches
5. ⏳ B4 patch must ship: streaming export uses dedicated postgres client
6. ⏳ M2 patch must ship: `pickEditableFields()` exact list per `helpers.py:13-20`
7. ⏳ M5 patch must ship: `parseSseChunks()` defined per Phase 2 spec
8. ⏳ M6 patch must ship: 4 rate-limit bindings + per-handler check
9. ⏳ M7 gate: 30-day Jinja2 traffic audit before Phase 4

---

**END OF PLAN**

Approval gate: this plan is autopilot Phase 0+1 output (REVISION 1 applied 2026-04-26 after Critic review). **No code is written until owner signs off** by responding with one of:
- `/autopilot continue` — proceed to Phase 2 (Execution); write code per this plan
- `/autopilot continue phase=1` — execute Phase 1 only, hold others for separate review
- comments / change requests on specific Open Questions or revision items
