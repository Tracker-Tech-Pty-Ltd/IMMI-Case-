Reading additional input from stdin...
OpenAI Codex v0.153.4
--------
workdir: /Volumes/Storm Breaker/Developer/IMMI-Case-
model: gpt-5.6-terra
provider: openai
approval: never
sandbox: read-only
reasoning effort: high
reasoning summaries: auto
session id: 01a08b28-c977-7161-9add-5fd4368885e4
--------
user
Third pass review of a Cloudflare Worker fix. Review only — do not modify anything.

HARD RULES: do not load skills/plugins/MCP/graph tools, do not run builds or tests, do not write files. Read-only commands only (cat, sed -n, git diff, git show, grep). Read only the changed regions and answer directly.

Repo: /Volumes/Storm Breaker/Developer/IMMI-Case-
Branch: fix/aggregate-rebuild-debounce (vs origin/main @ 42826a3)

The previous pass raised two HIGH findings, which are now fixed. Verify these two fixes explicitly and look only for regressions they introduce.

FINDING A (lease had no fencing)
Previously `releaseRebuildLease()` unconditionally wrote `lease_until = 0`, so an invocation that outlived its lease could free the lease of the new owner, letting a third invocation in.
Fix now in `workers/storage/cloudflare.js`:
- `claimRebuildLease()` writes `rebuild_lease_until` via the conditional upsert, then (winner only) `rebuild_lease_token` (random int) and `rebuild_last_attempt_at`; it returns `{ token, leaseSeconds }` or `null`.
- `renewRebuildLease({ token })` is an `UPDATE ... WHERE summary_key = 'rebuild_lease_until' AND (SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_token') = ?`.
- `releaseRebuildLease({ token })` is the same shape, zeroing the lease only for the current owner.
- `rebuildAggregates({ lease })` renews before every 20-statement chunk and throws `StorageBoundaryError` (`rebuild_lease_lost`) when renewal fails, so a run that lost its lease stops instead of interleaving DELETEs.
- `workers/cloudflare-native.js` `rebuildUnderLease()` passes the lease into `rebuildAggregates` and releases with `{ token }` in `finally`.

FINDING B (failed rebuilds were not throttled)
Previously a failed rebuild released the lease without stamping `rebuild_last_at`, so the 30-second queue retry always saw the fallback window as elapsed and could rebuild repeatedly.
Fix now: `claimRebuildLease()` stamps `rebuild_last_attempt_at`, and `aggregatesNeedRebuild()` throttles on `max(rebuild_last_at, rebuild_last_attempt_at)`.

VERIFY (cite file:line; be adversarial)
1. Is the release/renew genuinely token-conditional on the real D1/SQLite statement shapes (no path where the wrong owner zeroes the lease, including the `finally` path when the run aborted on `rebuild_lease_lost`)?
2. Can the token/attempt bookkeeping be skipped, fail, or be overwritten by the losing claimer such that exclusion or throttling is lost?
3. Does the attempt-based throttle actually bound the queue fallback and the cron (including the retry path where the batch is retried 30 seconds later)?
4. Do bookkeeping keys survive `rebuildAggregates()`'s DELETE (six keys now), and does anything else write `catalog_summary` in a way that drops them?
5. Any new correctness regression: `rebuildAggregates` now performs an extra renewal + read per chunk — does the extra statement ordering break the bookkeeping writes or the batch sizes?

ALREADY VERIFIED BY THE AUTHOR (do not re-derive, do not report as gaps)
- `npm run test:workers`: 27 files / 378 tests pass.
- Real-SQLite harness replays claim/renew/release with real rowcounts: stale release cannot free another owner's lease; owner release works; renew wins only for the owner token; plus the generation race replay. 20/20 checks.
- Bundle closure passes; the native-config gate output is unchanged.
- Python suite is not runnable locally (split requirements files); it does not touch this JS change.

NOT IN SCOPE: style, naming, comments, surrounding legacy code.

Output: findings HIGH → LOW with file:line, severity, issue, concrete fix; say "no finding" per area above that is clean. Final line exactly: VERDICT: APPROVE or VERDICT: CHANGES-REQUIRED
warning: Under-development features enabled: chronicle. Under-development features are incomplete and may behave unpredictably. To suppress this warning, set `suppress_unstable_features_warning = true` in /Users/david/.codex/config.toml.
2026-09-10T11:51:42.242906Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
2026-09-10T11:51:42.359931Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
2026-09-10T11:51:43.472277Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource" })
2026-09-10T11:51:43.555462Z ERROR codex_rmcp_client::oauth::refresh_transaction: error=failed to refresh OAuth tokens for server tracker-tools: OAuth refresh token was rejected: Server returned error response: invalid_grant: Grant not found
warning: Exceeded skills context budget. All skill descriptions were removed and 900 additional skills were not included in the model-visible skills list.
hook: SessionStart
hook: SessionStart Completed
codex
我會只讀取指定 Worker 的變更區段與必要呼叫點，核對兩個修正及其引入的競態風險；不會執行測試、建置、寫入或載入任何技能／圖譜工具。
exec
/bin/zsh -lc 'git diff --unified=80 origin/main...42826a3 -- workers/storage/cloudflare.js workers/cloudflare-native.js && git status --short --branch' in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 4083ms:
2026-09-10 21:51:53.504 xcodebuild[26915:134364129]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:51:53.753 xcodebuild[26915:134364120] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-W6fCG1wK' (errno=Operation not permitted)
2026-09-10 21:51:54.249 xcodebuild[26937:134364272]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:51:54.378 xcodebuild[26937:134364271] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-tWthr5O9' (errno=Operation not permitted)
2026-09-10 21:51:55.334 xcodebuild[26949:134364407]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:51:55.477 xcodebuild[26949:134364406] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-paPjD7WB' (errno=Operation not permitted)
2026-09-10 21:51:55.876 xcodebuild[26954:134364456]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:51:56.003 xcodebuild[26954:134364455] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
## fix/aggregate-rebuild-debounce...origin/main
 M .claude/STATE.md
 M config/wrangler-cloudflare-native.toml.example
 M workers/__tests__/cloudflare-native-queue.test.js
 M workers/cloudflare-native.js
 M workers/storage/cloudflare.js
 M wrangler.toml
?? docs/ops/aggregate-rebuild-cost-guard.md
?? work/
?? workers/__tests__/cloudflare-aggregate-rebuild-guard.test.js
?? workers/__tests__/cloudflare-native-scheduled-rebuild.test.js

hook: PostToolUse
hook: PostToolUse Completed
**Inspecting changes against origin/main commit**
exec
/bin/zsh -lc "grep -n -E \"claimRebuildLease|renewRebuildLease|releaseRebuildLease|aggregatesNeedRebuild|rebuildAggregates|rebuild_lease_|rebuild_last_\" workers/storage/cloudflare.js workers/cloudflare-native.js && sed -n '220,620p' workers/storage/cloudflare.js && sed -n '540,830p' workers/cloudflare-native.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
workers/storage/cloudflare.js:54:  "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
workers/storage/cloudflare.js:55:  "rebuild_last_attempt_at", "rebuild_lease_until", "rebuild_lease_token",
workers/storage/cloudflare.js:1000:   * interval (aggregatesNeedRebuild). A per-batch rebuild here wrote ~584k rows
workers/storage/cloudflare.js:1004:  async rebuildAggregates({ lease } = {}) {
workers/storage/cloudflare.js:1096:        SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
workers/storage/cloudflare.js:1102:      if (lease && !(await this.renewRebuildLease({ token: lease.token, leaseSeconds: lease.leaseSeconds }))) {
workers/storage/cloudflare.js:1104:          code: "rebuild_lease_lost", status: 503,
workers/storage/cloudflare.js:1131:        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
workers/storage/cloudflare.js:1132:                              'rebuild_last_attempt_at', 'rebuild_lease_until', 'rebuild_lease_token')`,
workers/storage/cloudflare.js:1143:  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
workers/storage/cloudflare.js:1151:    // throws releases its lease without stamping `rebuild_last_at`, and the
workers/storage/cloudflare.js:1153:    const lastSuccessAt = state.get("rebuild_last_at") || 0;
workers/storage/cloudflare.js:1154:    const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
workers/storage/cloudflare.js:1175:  async claimRebuildLease({ leaseSeconds = 900 } = {}) {
workers/storage/cloudflare.js:1179:        VALUES ('rebuild_lease_until', ?, ?)
workers/storage/cloudflare.js:1189:        VALUES ('rebuild_lease_token', ?, ?)`).bind(token, utcNow()).run();
workers/storage/cloudflare.js:1191:        VALUES ('rebuild_last_attempt_at', ?, ?)`).bind(now, utcNow()).run();
workers/storage/cloudflare.js:1196:  async renewRebuildLease({ token, leaseSeconds = 900 } = {}) {
workers/storage/cloudflare.js:1200:        WHERE summary_key = 'rebuild_lease_until'
workers/storage/cloudflare.js:1201:          AND (SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_token') = ?`)
workers/storage/cloudflare.js:1207:  async releaseRebuildLease({ token } = {}) {
workers/storage/cloudflare.js:1211:            WHERE summary_key = 'rebuild_lease_until'
workers/storage/cloudflare.js:1212:              AND (SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_token') = ?`)
workers/storage/cloudflare.js:1215:            WHERE summary_key = 'rebuild_lease_until'`).bind(now).run();
workers/cloudflare-native.js:151:  const lease = await stores.caseStore.claimRebuildLease({ leaseSeconds });
workers/cloudflare-native.js:153:    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_lease_held" }));
workers/cloudflare-native.js:157:    return await stores.caseStore.rebuildAggregates({ lease });
workers/cloudflare-native.js:162:      await stores.caseStore.releaseRebuildLease({ token: lease.token });
workers/cloudflare-native.js:165:        event: "cloudflare.aggregate_rebuild_lease_release_error", error: error?.message,
workers/cloudflare-native.js:184:  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
workers/cloudflare-native.js:217:  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
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

hook: PostToolUse
hook: PostToolUse Completed
**Refining log extraction ranges**
exec
/bin/zsh -lc "sed -n '980,1230p' workers/storage/cloudflare.js && sed -n '120,235p' workers/cloudflare-native.js && grep -n -E \"catalog_summary|rebuildAggregates\\(|claimRebuildLease\\(|renewRebuildLease\\(|releaseRebuildLease\\(\" workers/storage/cloudflare.js workers/cloudflare-native.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
 succeeded in 0ms:
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
   * Rebuild queue-maintained analytics outside the request path.
   *
   * Cost contract: this clears and rewrites 17 summary/filter tables and scans
   * the whole `cases` table, so it must never run once per queue batch. Queue
   * work only marks the aggregates dirty (markAggregatesDirty) and the
   * scheduled handler coalesces those marks into at most one rebuild per
   * interval (aggregatesNeedRebuild). A per-batch rebuild here wrote ~584k rows
   * each; one catalog import in Aug 2026 produced 12.1B written rows and about
   * $12,060 in D1 write charges.
   */
  async rebuildAggregates({ lease } = {}) {
    const now = utcNow();
    // Snapshot the pending generation before scanning: anything that arrives
    // while this rebuild runs must stay pending, not be marked applied.
    const state = await this.readAggregateState();
    const appliedGeneration = state.get("rebuild_generation") || 0;
    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
    const statements = [];
    for (const table of [
      "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
      "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
      "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
      "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
      "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
    ]) {
      statements.push(table === "catalog_summary"
        ? this.db.prepare(`DELETE FROM catalog_summary WHERE summary_key NOT IN (${keepKeys})`)
        : this.db.prepare(`DELETE FROM ${table}`));
    }
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
    // Bookkeeping lives in catalog_summary itself (getStats reads only
    // total_cases/with_full_text, so these keys stay internal). Recording the
    // generation observed at the start — not a bare dirty=0 — is what keeps a
    // mid-rebuild mutation pending.
    statements.push(
      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
        SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
        SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
    );
    for (let offset = 0; offset < statements.length; offset += 20) {
      // While we still own the lease, extend it before each chunk; if another
      // invocation took over (this run outlived its lease), abort instead of
      // interleaving DELETEs with it. At most one chunk can overlap.
      if (lease && !(await this.renewRebuildLease({ token: lease.token, leaseSeconds: lease.leaseSeconds }))) {
        throw new StorageBoundaryError("Aggregate rebuild lease lost mid-run", {
          code: "rebuild_lease_lost", status: 503,
        });
      }
      await this.db.batch(statements.slice(offset, offset + 20));
    }
    return { rebuilt_at: now, applied_generation: appliedGeneration };
  }

  /**
   * Mark analytics as stale without paying for a rebuild: one row written per
   * queue batch instead of clearing and rewriting 17 tables.
   *
   * A monotonic generation, not a boolean: a rebuild applies the generation it
   * observed when it started, so a mutation landing mid-rebuild stays pending
   * instead of being wiped by the rebuild's own bookkeeping write.
   */
  async markAggregatesDirty() {
    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
        VALUES ('rebuild_generation', 1, ?)
      ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
      .bind(utcNow()).run();
    return true;
  }

  async readAggregateState() {
    const current = rows(await this.db.prepare(
      `SELECT summary_key, value_int FROM catalog_summary
        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
                              'rebuild_last_attempt_at', 'rebuild_lease_until', 'rebuild_lease_token')`,
    ).all());
    return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
  }

  /**
   * Rate-limit decision for the scheduled handler: rebuild only when a
   * generation is pending and the last rebuild is older than the interval.
   * This is the only guard preventing a bulk import from rewriting the whole
   * summary set thousands of times.
   */
  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
    const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
      ? Math.floor(minIntervalSeconds) : 300;
    const state = await this.readAggregateState();
    const pending = state.get("rebuild_generation") || 0;
    const applied = state.get("rebuild_applied_generation") || 0;
    if (pending <= applied) return { due: false, reason: "clean" };
    // Throttle on the last *attempt*, not only the last success: a rebuild that
    // throws releases its lease without stamping `rebuild_last_at`, and the
    // 30-second queue retry must not therefore rebuild on every retry.
    const lastSuccessAt = state.get("rebuild_last_at") || 0;
    const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
    const lastAt = Math.max(lastSuccessAt, lastAttemptAt);
    const elapsedSeconds = lastAt > 0 ? Math.floor(Date.now() / 1000) - lastAt : interval;
    if (elapsedSeconds < interval) {
      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
    }
    return {
      due: true,
      reason: "dirty",
      pending_generation: pending,
      applied_generation: applied,
      seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
    };
  }

  /**
   * Atomically claim the rebuild lease. Two overlapping cron invocations (or a
   * cron racing the queue fallback) would otherwise both rewrite 17 tables and
   * interleave their DELETEs. The conditional upsert only writes when the held
   * lease has expired, so `changes === 1` means this caller won.
   */
  async claimRebuildLease({ leaseSeconds = 900 } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const until = now + Math.max(60, Math.floor(leaseSeconds));
    const result = await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
        VALUES ('rebuild_lease_until', ?, ?)
      ON CONFLICT(summary_key) DO UPDATE SET value_int = excluded.value_int, updated_at = excluded.updated_at
      WHERE catalog_summary.value_int < ?`)
      .bind(until, utcNow(), now).run();
    if (changeCount(result) === 0) return null;
    // Fencing token + attempt stamp. The token is what stops an expired holder
    // from releasing (or renewing) a lease that now belongs to someone else;
    // the attempt stamp throttles retries of a rebuild that failed.
    const token = Math.floor(Math.random() * 2_000_000_000) + 1;
    await this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at)
        VALUES ('rebuild_lease_token', ?, ?)`).bind(token, utcNow()).run();
    await this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at)
        VALUES ('rebuild_last_attempt_at', ?, ?)`).bind(now, utcNow()).run();
    return { token, leaseSeconds: Math.max(60, Math.floor(leaseSeconds)) };
  }

  /** Extend the lease, but only while this caller still owns it. */
  async renewRebuildLease({ token, leaseSeconds = 900 } = {}) {
    if (!Number.isInteger(token)) return false;
    const now = Math.floor(Date.now() / 1000);
    const result = await this.db.prepare(`UPDATE catalog_summary SET value_int = ?, updated_at = ?
        WHERE summary_key = 'rebuild_lease_until'
          AND (SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_token') = ?`)
      .bind(now + Math.max(60, Math.floor(leaseSeconds)), utcNow(), token).run();
    return changeCount(result) > 0;
  }

  /** Release the lease. With a token, only the current owner can release it. */
  async releaseRebuildLease({ token } = {}) {
    const now = utcNow();
    const result = Number.isInteger(token)
      ? await this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
            WHERE summary_key = 'rebuild_lease_until'
              AND (SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_token') = ?`)
        .bind(now, token).run()
      : await this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
            WHERE summary_key = 'rebuild_lease_until'`).bind(now).run();
    return changeCount(result) > 0;
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
    // Never rebuild on the happy path: one rebuild clears and rewrites 17
    // tables (~584k written rows), and per-batch rebuilds cost ~$12,060 in
    // Aug 2026. Record staleness instead; the cron trigger coalesces it.
    if (changed) await markStaleAndMaybeRebuild(stores, env);
    for (const message of messages) if (typeof message?.ack === "function") message.ack();
  } catch (error) {
    console.error(JSON.stringify({ event: "cloudflare.case_reindex_error", error: error?.message }));
    for (const message of messages) {
      if (typeof message?.retry === "function") message.retry({ delaySeconds: 30 });
      else throw error;
    }
  }
}

const DEFAULT_REBUILD_INTERVAL_SECONDS = 300;
const DEFAULT_FALLBACK_INTERVAL_SECONDS = 3600;
const DEFAULT_REBUILD_LEASE_SECONDS = 900;

function positiveIntOr(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Run a rebuild under the D1 lease so overlapping scheduled invocations — or a
 * cron racing the queue fallback — cannot rewrite the same 17 tables at once.
 * The lease length is derived from the interval so it always outlives a rebuild
 * while still expiring on its own if this invocation dies mid-flight.
 */
async function rebuildUnderLease(stores, env) {
  const leaseSeconds = positiveIntOr(env?.AGGREGATE_REBUILD_LEASE_SECONDS, DEFAULT_REBUILD_LEASE_SECONDS);
  const lease = await stores.caseStore.claimRebuildLease({ leaseSeconds });
  if (!lease) {
    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_lease_held" }));
    return { skipped: "lease_held" };
  }
  try {
    return await stores.caseStore.rebuildAggregates({ lease });
  } finally {
    try {
      // Token-conditional: if this run outlived its lease, the new owner's
      // lease is left untouched.
      await stores.caseStore.releaseRebuildLease({ token: lease.token });
    } catch (error) {
      console.error(JSON.stringify({
        event: "cloudflare.aggregate_rebuild_lease_release_error", error: error?.message,
      }));
    }
  }
}

/**
 * Coalesced analytics rebuild.
 *
 * Queue batches only mark the aggregates dirty; this scheduled handler decides
 * when to pay for the rebuild, so N queue batches cost at most one rebuild per
 * interval instead of N full rewrites of 17 tables.
 */
async function handleScheduledRebuild(env) {
  const stores = createCloudflareStores(env);
  const minIntervalSeconds = positiveIntOr(
    env?.AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS,
    DEFAULT_REBUILD_INTERVAL_SECONDS,
  );
  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
  if (!decision.due) {
    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
    return decision;
  }
  const startedAt = Date.now();
  const result = await rebuildUnderLease(stores, env);
  if (result?.skipped) return { ...decision, ...result };
  console.log(JSON.stringify({
    event: "cloudflare.aggregate_rebuild_completed",
    reason: decision.reason,
    min_interval_seconds: minIntervalSeconds,
    duration_ms: Date.now() - startedAt,
    rebuilt_at: result?.rebuilt_at ?? null,
  }));
  return { ...decision, ...result };
}

/**
 * Safety valve for the coalesced rebuild.
 *
 * The cron trigger normally performs every rebuild, so the queue path only
 * records staleness. If that trigger is missing or failing, the flag would
 * never be drained and every dashboard would freeze silently — so the queue
 * path still refreshes, at most once per fallback window. With a working cron
 * the last rebuild is never older than the cron period, and this never fires.
 */
async function markStaleAndMaybeRebuild(stores, env) {
  await stores.caseStore.markAggregatesDirty();
  const minIntervalSeconds = positiveIntOr(
    env?.AGGREGATE_REBUILD_FALLBACK_SECONDS,
    DEFAULT_FALLBACK_INTERVAL_SECONDS,
  );
  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
  if (!fallback?.due) return false;
  const result = await rebuildUnderLease(stores, env);
  if (result?.skipped) return false;
  console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_fallback", reason: fallback.reason }));
  return true;
}

async function handleDeadLetterQueue(batch, env) {
  const stores = createCloudflareStores(env);
  for (const message of batch?.messages || []) {
    try {
      const body = message?.body ?? null;
      const encoded = JSON.stringify(body);
      const { hex } = await sha256Hex(`${batch.queue}:${encoded}`);
      const pointer = await stores.objectStore.putVerified({
        key: `imports/dlq/${batch.queue}/${hex}.json`,
        body: encoded,
        contentType: "application/json",
workers/storage/cloudflare.js:50:// catalog_summary doubles as the aggregate-rebuild control table. Its
workers/storage/cloudflare.js:782:      this.db.prepare("SELECT summary_key, value_int FROM catalog_summary").all(),
workers/storage/cloudflare.js:864:      : Number((await this.db.prepare("SELECT value_int FROM catalog_summary WHERE summary_key = 'total_cases'").first())?.value_int || 0);
workers/storage/cloudflare.js:1004:  async rebuildAggregates({ lease } = {}) {
workers/storage/cloudflare.js:1015:      "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
workers/storage/cloudflare.js:1019:      statements.push(table === "catalog_summary"
workers/storage/cloudflare.js:1020:        ? this.db.prepare(`DELETE FROM catalog_summary WHERE summary_key NOT IN (${keepKeys})`)
workers/storage/cloudflare.js:1028:      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js:1030:      this.db.prepare(`INSERT INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js:1088:    // Bookkeeping lives in catalog_summary itself (getStats reads only
workers/storage/cloudflare.js:1093:      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js:1095:      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
workers/storage/cloudflare.js:1102:      if (lease && !(await this.renewRebuildLease({ token: lease.token, leaseSeconds: lease.leaseSeconds }))) {
workers/storage/cloudflare.js:1121:    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
workers/storage/cloudflare.js:1123:      ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
workers/storage/cloudflare.js:1130:      `SELECT summary_key, value_int FROM catalog_summary
workers/storage/cloudflare.js:1175:  async claimRebuildLease({ leaseSeconds = 900 } = {}) {
workers/storage/cloudflare.js:1178:    const result = await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
workers/storage/cloudflare.js:1181:      WHERE catalog_summary.value_int < ?`)
workers/storage/cloudflare.js:1188:    await this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at)
workers/storage/cloudflare.js:1190:    await this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at)
workers/storage/cloudflare.js:1196:  async renewRebuildLease({ token, leaseSeconds = 900 } = {}) {
workers/storage/cloudflare.js:1199:    const result = await this.db.prepare(`UPDATE catalog_summary SET value_int = ?, updated_at = ?
workers/storage/cloudflare.js:1201:          AND (SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_token') = ?`)
workers/storage/cloudflare.js:1207:  async releaseRebuildLease({ token } = {}) {
workers/storage/cloudflare.js:1210:      ? await this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
workers/storage/cloudflare.js:1212:              AND (SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_token') = ?`)
workers/storage/cloudflare.js:1214:      : await this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
workers/cloudflare-native.js:151:  const lease = await stores.caseStore.claimRebuildLease({ leaseSeconds });
workers/cloudflare-native.js:157:    return await stores.caseStore.rebuildAggregates({ lease });
workers/cloudflare-native.js:162:      await stores.caseStore.releaseRebuildLease({ token: lease.token });

hook: PostToolUse
hook: PostToolUse Completed
**Assessing lease claim and token write race conditions**
**Analyzing token update race and lease split atomicity flaw**
**Identifying lease hold issue blocking rebuild retry**
**Reviewing uncommitted changes against origin/main**
**Analyzing snapshot and renewal timing impact**
**Inspecting stats retrieval in changed lines**
codex
已確認一個關鍵競態：取得 lease、寫入 fencing token 與記錄 attempt 是三個獨立 D1 寫入，而非同一原子操作。我正在把它與 `finally` 的釋放路徑及節流時序逐一對照，避免把作者已驗證的 SQL rowcount 行為重複當成缺口。
**Retrieving detailed git diff**
exec
/bin/zsh -lc "git diff --unified=45 -- workers/storage/cloudflare.js workers/cloudflare-native.js && sed -n '40,65p' workers/storage/cloudflare.js && sed -n '1080,1120p' workers/storage/cloudflare.js" in /Volumes/Storm Breaker/Developer/IMMI-Case-
2026-09-10T11:52:34.140154Z ERROR codex_core::tools::router: error=collab spawn failed: no thread with id: 01a08b29-6c5f-7d31-a49f-7e8e24c05d4c
 succeeded in 1638ms:
2026-09-10 21:52:32.844 xcodebuild[29850:134375476]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:52:33.025 xcodebuild[29850:134375475] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-gyBIgOUO' (errno=Operation not permitted)
2026-09-10 21:52:33.481 xcodebuild[29858:134375567]  DVTFilePathFSEvents: Failed to start fs event stream.
2026-09-10 21:52:33.624 xcodebuild[29858:134375566] [MT] DVTDeveloperPaths: Failed to get length of DARWIN_USER_CACHE_DIR from confstr(3), error = Error Domain=NSPOSIXErrorDomain Code=5 "Input/output error". Using NSCachesDirectory instead.
diff --git a/workers/cloudflare-native.js b/workers/cloudflare-native.js
index f37b3b0..0464749 100644
--- a/workers/cloudflare-native.js
+++ b/workers/cloudflare-native.js
@@ -75,169 +75,266 @@ async function processCaseSourceDelete(message, stores) {
     sha256: event.content_sha256,
     size: event.content_size,
     contentType: event.content_type || "text/plain; charset=utf-8",
   }, { prefix: "cases" });
   return true;
 }
 
 async function processCaseExtracted(message, env) {
   const event = message?.body;
   if (!event || event.kind !== "case.extracted") return false;
   const stores = createCloudflareStores(env);
   const payload = await stores.objectStore.getVerifiedJson({
     key: event.payload_key,
     sha256: event.payload_sha256,
     size: event.payload_size,
     contentType: event.payload_content_type || "application/json",
   }, { prefix: "pipeline", maxBytes: 16 * 1024 * 1024, label: "Pipeline extraction payload" });
   if (!payload || typeof payload !== "object") throw new StorageBoundaryError("Pipeline extraction payload is invalid", { code: "pipeline_payload_invalid", status: 503 });
   await coordinateExtractedCase({
     env,
     eventId: event.event_id,
     runId: event.run_id,
     record: payload.record,
     canonicalText: payload.canonicalText,
     audit: payload.audit,
   });
   return true;
 }
 
 async function handleCaseMutationQueue(batch, env) {
   const messages = batch?.messages || [];
   const stores = createCloudflareStores(env);
   try {
     let changed = false;
     for (const message of messages) {
       if (await processCaseExtracted(message, env)) {
         changed = true;
       } else if (await processCaseReindex(message, stores)) {
         changed = true;
       } else if (await processCaseSourceDelete(message, stores)) {
         changed = true;
       } else if (await processAggregateRebuild(message)) {
         changed = true;
       }
     }
-    if (changed) await stores.caseStore.rebuildAggregates();
+    // Never rebuild on the happy path: one rebuild clears and rewrites 17
+    // tables (~584k written rows), and per-batch rebuilds cost ~$12,060 in
+    // Aug 2026. Record staleness instead; the cron trigger coalesces it.
+    if (changed) await markStaleAndMaybeRebuild(stores, env);
     for (const message of messages) if (typeof message?.ack === "function") message.ack();
   } catch (error) {
     console.error(JSON.stringify({ event: "cloudflare.case_reindex_error", error: error?.message }));
     for (const message of messages) {
       if (typeof message?.retry === "function") message.retry({ delaySeconds: 30 });
       else throw error;
     }
   }
 }
 
+const DEFAULT_REBUILD_INTERVAL_SECONDS = 300;
+const DEFAULT_FALLBACK_INTERVAL_SECONDS = 3600;
+const DEFAULT_REBUILD_LEASE_SECONDS = 900;
+
+function positiveIntOr(value, fallback) {
+  const parsed = Number.parseInt(value ?? "", 10);
+  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
+}
+
+/**
+ * Run a rebuild under the D1 lease so overlapping scheduled invocations — or a
+ * cron racing the queue fallback — cannot rewrite the same 17 tables at once.
+ * The lease length is derived from the interval so it always outlives a rebuild
+ * while still expiring on its own if this invocation dies mid-flight.
+ */
+async function rebuildUnderLease(stores, env) {
+  const leaseSeconds = positiveIntOr(env?.AGGREGATE_REBUILD_LEASE_SECONDS, DEFAULT_REBUILD_LEASE_SECONDS);
+  const lease = await stores.caseStore.claimRebuildLease({ leaseSeconds });
+  if (!lease) {
+    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_lease_held" }));
+    return { skipped: "lease_held" };
+  }
+  try {
+    return await stores.caseStore.rebuildAggregates({ lease });
+  } finally {
+    try {
+      // Token-conditional: if this run outlived its lease, the new owner's
+      // lease is left untouched.
+      await stores.caseStore.releaseRebuildLease({ token: lease.token });
+    } catch (error) {
+      console.error(JSON.stringify({
+        event: "cloudflare.aggregate_rebuild_lease_release_error", error: error?.message,
+      }));
+    }
+  }
+}
+
+/**
+ * Coalesced analytics rebuild.
+ *
+ * Queue batches only mark the aggregates dirty; this scheduled handler decides
+ * when to pay for the rebuild, so N queue batches cost at most one rebuild per
+ * interval instead of N full rewrites of 17 tables.
+ */
+async function handleScheduledRebuild(env) {
+  const stores = createCloudflareStores(env);
+  const minIntervalSeconds = positiveIntOr(
+    env?.AGGREGATE_REBUILD_MIN_INTERVAL_SECONDS,
+    DEFAULT_REBUILD_INTERVAL_SECONDS,
+  );
+  const decision = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
+  if (!decision.due) {
+    console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_skipped", ...decision }));
+    return decision;
+  }
+  const startedAt = Date.now();
+  const result = await rebuildUnderLease(stores, env);
+  if (result?.skipped) return { ...decision, ...result };
+  console.log(JSON.stringify({
+    event: "cloudflare.aggregate_rebuild_completed",
+    reason: decision.reason,
+    min_interval_seconds: minIntervalSeconds,
+    duration_ms: Date.now() - startedAt,
+    rebuilt_at: result?.rebuilt_at ?? null,
+  }));
+  return { ...decision, ...result };
+}
+
+/**
+ * Safety valve for the coalesced rebuild.
+ *
+ * The cron trigger normally performs every rebuild, so the queue path only
+ * records staleness. If that trigger is missing or failing, the flag would
+ * never be drained and every dashboard would freeze silently — so the queue
+ * path still refreshes, at most once per fallback window. With a working cron
+ * the last rebuild is never older than the cron period, and this never fires.
+ */
+async function markStaleAndMaybeRebuild(stores, env) {
+  await stores.caseStore.markAggregatesDirty();
+  const minIntervalSeconds = positiveIntOr(
+    env?.AGGREGATE_REBUILD_FALLBACK_SECONDS,
+    DEFAULT_FALLBACK_INTERVAL_SECONDS,
+  );
+  const fallback = await stores.caseStore.aggregatesNeedRebuild({ minIntervalSeconds });
+  if (!fallback?.due) return false;
+  const result = await rebuildUnderLease(stores, env);
+  if (result?.skipped) return false;
+  console.log(JSON.stringify({ event: "cloudflare.aggregate_rebuild_fallback", reason: fallback.reason }));
+  return true;
+}
+
 async function handleDeadLetterQueue(batch, env) {
   const stores = createCloudflareStores(env);
   for (const message of batch?.messages || []) {
     try {
       const body = message?.body ?? null;
       const encoded = JSON.stringify(body);
       const { hex } = await sha256Hex(`${batch.queue}:${encoded}`);
       const pointer = await stores.objectStore.putVerified({
         key: `imports/dlq/${batch.queue}/${hex}.json`,
         body: encoded,
         contentType: "application/json",
       });
       const eventId = typeof body?.event_id === "string" && body.event_id
         ? body.event_id : `dlq:${batch.queue}:${hex}`;
       await stores.pipelineStore.recordDeadLetter({
         eventId,
         outboxEventId: typeof body?.event_id === "string" ? body.event_id : null,
         reason: `queue:${batch.queue}`,
         payloadPointer: pointer,
       });
       if (typeof message?.ack === "function") message.ack();
     } catch (error) {
       console.error(JSON.stringify({ event: "cloudflare.dlq_record_error", error: error?.message }));
       if (typeof message?.retry === "function") message.retry({ delaySeconds: 30 });
       else throw error;
     }
   }
 }
 
 function unavailable(error, code = "cloudflare_route_unavailable") {
   return Response.json({ error, code }, {
     status: 503,
     headers: { "Cache-Control": "no-store", "Retry-After": "0" },
   });
 }
 
 async function dispatchAuth(request, env, path, method) {
   if (env.AUTH_ENABLED === "false") return null;
   if (path === "/api/v1/auth/telegram" && method === "POST") {
     return handleTelegramLogin(request, env);
   }
   if (path === "/api/v1/auth/bootstrap" && method === "POST") {
     return handleBootstrapLogin(request, env);
   }
   if (path === "/api/v1/auth/telegram/callback" && method === "GET") {
     return handleTelegramCallback(request, env);
   }
   if (path === "/api/v1/auth/me" && method === "GET") return handleAuthMe(request, env);
   if (path === "/api/v1/auth/logout" && method === "POST") {
     return handleAuthLogout(request, env);
   }
   if (path === "/api/v1/auth/refresh" && method === "POST") {
     return handleAuthRefresh(request, env);
   }
   if (path === "/api/v1/auth/switch-tenant" && method === "POST") {
     return handleAuthSwitchTenant(request, env);
   }
   return null;
 }
 
 export default {
   async queue(batch, env) {
     if (batch?.queue === "immi-case-mutation-dlq") {
       await handleDeadLetterQueue(batch, env);
       return;
     }
     await handleCaseMutationQueue(batch, env);
   },
+  async scheduled(event, env) {
+    return handleScheduledRebuild(env);
+  },
   async fetch(request, env, ctx) {
     let mode;
     try {
       mode = getStorageMode(env);
     } catch (err) {
       return unavailable("Cloudflare-native runtime is misconfigured", "invalid_storage_mode");
     }
     if (mode !== "cloudflare") {
       return unavailable("Cloudflare-native runtime requires IMMI_STORAGE_MODE=cloudflare", "cloudflare_mode_required");
     }
     const url = new URL(request.url);
     const path = url.pathname;
     if (path === "/health") {
       return Response.json({ status: "ok", worker: "immi-case", layer: "edge+cloudflare-native" });
     }
     if (path === "/api/v1/csrf-token" && request.method === "GET") return getCsrfToken(env);
     const auth = await dispatchAuth(request, env, path, request.method);
     if (auth !== null) return auth;
     const action = await dispatchCloudflareCaseAction(request, path, env);
     if (action !== null) return action;
     const pipelineControl = await dispatchCloudflarePipelineControl(request, path, env);
     if (pipelineControl !== null) return pipelineControl;
     const mutation = await dispatchCloudflareCaseMutation(request, path, env);
     if (mutation !== null) return mutation;
     if (path === "/api/v1/admin/pipeline-runs" && request.method === "GET") {
       return handleAdminPipelineRuns(request, env, url);
     }
     if (path === "/api/v1/job-status" && request.method === "GET") return handleJobStatus(env);
     if (path === "/api/v1/pipeline-status" && request.method === "GET") return handlePipelineStatus(env);
     const council = await dispatchCloudflareCouncil(request, env, path, request.method, ctx);
     if (council !== null) return council;
     if (request.method === "GET") {
       const response = await dispatchCloudflareCaseRead(url, path, env);
       if (response !== null) return response;
     }
     if (path.startsWith("/api/")) {
       return unavailable("This API route is not yet available in the Cloudflare-native runtime");
     }
     if (env.ASSETS) {
       try {
         return await env.ASSETS.fetch(request);
       } catch (err) {
         // fall through to unavailable when the ASSETS binding is misconfigured
       }
     }
diff --git a/workers/storage/cloudflare.js b/workers/storage/cloudflare.js
index 441eb69..8fffcdd 100644
--- a/workers/storage/cloudflare.js
+++ b/workers/storage/cloudflare.js
@@ -5,90 +5,98 @@
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
 
+// catalog_summary doubles as the aggregate-rebuild control table. Its
+// bookkeeping keys must survive a rebuild's DELETE so a mutation landing
+// mid-rebuild still leaves a pending generation behind.
+const AGGREGATE_BOOKKEEPING_KEYS = [
+  "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
+  "rebuild_last_attempt_at", "rebuild_lease_until", "rebuild_lease_token",
+];
+
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
@@ -941,171 +949,313 @@ export class CloudflareCaseStore {
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
-   * Rebuild queue-maintained analytics outside the request path. A mutation
-   * queue batch calls this once after its D1/R2/Vectorize work, so dashboard
-   * reads remain aggregate-only and never scan the corpus.
+   * Rebuild queue-maintained analytics outside the request path.
+   *
+   * Cost contract: this clears and rewrites 17 summary/filter tables and scans
+   * the whole `cases` table, so it must never run once per queue batch. Queue
+   * work only marks the aggregates dirty (markAggregatesDirty) and the
+   * scheduled handler coalesces those marks into at most one rebuild per
+   * interval (aggregatesNeedRebuild). A per-batch rebuild here wrote ~584k rows
+   * each; one catalog import in Aug 2026 produced 12.1B written rows and about
+   * $12,060 in D1 write charges.
    */
-  async rebuildAggregates() {
+  async rebuildAggregates({ lease } = {}) {
     const now = utcNow();
+    // Snapshot the pending generation before scanning: anything that arrives
+    // while this rebuild runs must stay pending, not be marked applied.
+    const state = await this.readAggregateState();
+    const appliedGeneration = state.get("rebuild_generation") || 0;
+    const keepKeys = AGGREGATE_BOOKKEEPING_KEYS.map((key) => `'${key}'`).join(", ");
     const statements = [];
     for (const table of [
       "aggregate_court_year_outcome", "aggregate_visa", "aggregate_country",
       "aggregate_judge", "aggregate_judge_court", "aggregate_nature_outcome",
       "aggregate_source", "catalog_summary", "aggregate_concept", "aggregate_scope",
       "aggregate_court_nature_outcome", "aggregate_concept_scope", "aggregate_concept_pair",
       "aggregate_judge_outcome", "aggregate_judge_year", "aggregate_judge_visa", "filter_options",
-    ]) statements.push(this.db.prepare(`DELETE FROM ${table}`));
+    ]) {
+      statements.push(table === "catalog_summary"
+        ? this.db.prepare(`DELETE FROM catalog_summary WHERE summary_key NOT IN (${keepKeys})`)
+        : this.db.prepare(`DELETE FROM ${table}`));
+    }
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
-    for (let offset = 0; offset < statements.length; offset += 20) await this.db.batch(statements.slice(offset, offset + 20));
-    return { rebuilt_at: now };
+    // Bookkeeping lives in catalog_summary itself (getStats reads only
+    // total_cases/with_full_text, so these keys stay internal). Recording the
+    // generation observed at the start — not a bare dirty=0 — is what keeps a
+    // mid-rebuild mutation pending.
+    statements.push(
+      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
+        SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
+      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
+        SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
+    );
+    for (let offset = 0; offset < statements.length; offset += 20) {
+      // While we still own the lease, extend it before each chunk; if another
+      // invocation took over (this run outlived its lease), abort instead of
+      // interleaving DELETEs with it. At most one chunk can overlap.
+      if (lease && !(await this.renewRebuildLease({ token: lease.token, leaseSeconds: lease.leaseSeconds }))) {
+        throw new StorageBoundaryError("Aggregate rebuild lease lost mid-run", {
+          code: "rebuild_lease_lost", status: 503,
+        });
+      }
+      await this.db.batch(statements.slice(offset, offset + 20));
+    }
+    return { rebuilt_at: now, applied_generation: appliedGeneration };
+  }
+
+  /**
+   * Mark analytics as stale without paying for a rebuild: one row written per
+   * queue batch instead of clearing and rewriting 17 tables.
+   *
+   * A monotonic generation, not a boolean: a rebuild applies the generation it
+   * observed when it started, so a mutation landing mid-rebuild stays pending
+   * instead of being wiped by the rebuild's own bookkeeping write.
+   */
+  async markAggregatesDirty() {
+    await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+        VALUES ('rebuild_generation', 1, ?)
+      ON CONFLICT(summary_key) DO UPDATE SET value_int = catalog_summary.value_int + 1, updated_at = excluded.updated_at`)
+      .bind(utcNow()).run();
+    return true;
+  }
+
+  async readAggregateState() {
+    const current = rows(await this.db.prepare(
+      `SELECT summary_key, value_int FROM catalog_summary
+        WHERE summary_key IN ('rebuild_generation', 'rebuild_applied_generation', 'rebuild_last_at',
+                              'rebuild_last_attempt_at', 'rebuild_lease_until', 'rebuild_lease_token')`,
+    ).all());
+    return new Map(current.map((row) => [row.summary_key, Number(row.value_int || 0)]));
+  }
+
+  /**
+   * Rate-limit decision for the scheduled handler: rebuild only when a
+   * generation is pending and the last rebuild is older than the interval.
+   * This is the only guard preventing a bulk import from rewriting the whole
+   * summary set thousands of times.
+   */
+  async aggregatesNeedRebuild({ minIntervalSeconds = 300 } = {}) {
+    const interval = Number.isFinite(minIntervalSeconds) && minIntervalSeconds > 0
+      ? Math.floor(minIntervalSeconds) : 300;
+    const state = await this.readAggregateState();
+    const pending = state.get("rebuild_generation") || 0;
+    const applied = state.get("rebuild_applied_generation") || 0;
+    if (pending <= applied) return { due: false, reason: "clean" };
+    // Throttle on the last *attempt*, not only the last success: a rebuild that
+    // throws releases its lease without stamping `rebuild_last_at`, and the
+    // 30-second queue retry must not therefore rebuild on every retry.
+    const lastSuccessAt = state.get("rebuild_last_at") || 0;
+    const lastAttemptAt = state.get("rebuild_last_attempt_at") || 0;
+    const lastAt = Math.max(lastSuccessAt, lastAttemptAt);
+    const elapsedSeconds = lastAt > 0 ? Math.floor(Date.now() / 1000) - lastAt : interval;
+    if (elapsedSeconds < interval) {
+      return { due: false, reason: "debounced", seconds_until_due: interval - elapsedSeconds };
+    }
+    return {
+      due: true,
+      reason: "dirty",
+      pending_generation: pending,
+      applied_generation: applied,
+      seconds_since_last_rebuild: lastSuccessAt > 0 ? elapsedSeconds : null,
+    };
+  }
+
+  /**
+   * Atomically claim the rebuild lease. Two overlapping cron invocations (or a
+   * cron racing the queue fallback) would otherwise both rewrite 17 tables and
+   * interleave their DELETEs. The conditional upsert only writes when the held
+   * lease has expired, so `changes === 1` means this caller won.
+   */
+  async claimRebuildLease({ leaseSeconds = 900 } = {}) {
+    const now = Math.floor(Date.now() / 1000);
+    const until = now + Math.max(60, Math.floor(leaseSeconds));
+    const result = await this.db.prepare(`INSERT INTO catalog_summary (summary_key, value_int, updated_at)
+        VALUES ('rebuild_lease_until', ?, ?)
+      ON CONFLICT(summary_key) DO UPDATE SET value_int = excluded.value_int, updated_at = excluded.updated_at
+      WHERE catalog_summary.value_int < ?`)
+      .bind(until, utcNow(), now).run();
+    if (changeCount(result) === 0) return null;
+    // Fencing token + attempt stamp. The token is what stops an expired holder
+    // from releasing (or renewing) a lease that now belongs to someone else;
+    // the attempt stamp throttles retries of a rebuild that failed.
+    const token = Math.floor(Math.random() * 2_000_000_000) + 1;
+    await this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at)
+        VALUES ('rebuild_lease_token', ?, ?)`).bind(token, utcNow()).run();
+    await this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at)
+        VALUES ('rebuild_last_attempt_at', ?, ?)`).bind(now, utcNow()).run();
+    return { token, leaseSeconds: Math.max(60, Math.floor(leaseSeconds)) };
+  }
+
+  /** Extend the lease, but only while this caller still owns it. */
+  async renewRebuildLease({ token, leaseSeconds = 900 } = {}) {
+    if (!Number.isInteger(token)) return false;
+    const now = Math.floor(Date.now() / 1000);
+    const result = await this.db.prepare(`UPDATE catalog_summary SET value_int = ?, updated_at = ?
+        WHERE summary_key = 'rebuild_lease_until'
+          AND (SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_token') = ?`)
+      .bind(now + Math.max(60, Math.floor(leaseSeconds)), utcNow(), token).run();
+    return changeCount(result) > 0;
+  }
+
+  /** Release the lease. With a token, only the current owner can release it. */
+  async releaseRebuildLease({ token } = {}) {
+    const now = utcNow();
+    const result = Number.isInteger(token)
+      ? await this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
+            WHERE summary_key = 'rebuild_lease_until'
+              AND (SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_token') = ?`)
+        .bind(now, token).run()
+      : await this.db.prepare(`UPDATE catalog_summary SET value_int = 0, updated_at = ?
+            WHERE summary_key = 'rebuild_lease_until'`).bind(now).run();
+    return changeCount(result) > 0;
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
      status: 503,
    });
  }
  return binding;
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

// catalog_summary doubles as the aggregate-rebuild control table. Its
// bookkeeping keys must survive a rebuild's DELETE so a mutation landing
// mid-rebuild still leaves a pending generation behind.
const AGGREGATE_BOOKKEEPING_KEYS = [
  "rebuild_generation", "rebuild_applied_generation", "rebuild_last_at",
  "rebuild_last_attempt_at", "rebuild_lease_until", "rebuild_lease_token",
];

function changeCount(result) {
  return Number(result?.meta?.changes || 0);
}

function bindAll(database, sql, params) {
  if (params.length > D1_MAX_BOUND_PARAMETERS) {
    throw new StorageBoundaryError("D1 statement exceeds the 100-parameter limit", {
      code: "d1_parameter_limit",
        FROM case_judges cj JOIN cases c ON c.case_id = cj.case_id WHERE c.visa_subclass <> ''
        GROUP BY cj.judge_id, c.visa_subclass`),
    );
    for (const [filterName, column] of [["court", "court_code"], ["year", "year"], ["outcome", "outcome"], ["visa_type", "visa_type"], ["visa_subclass", "visa_subclass"], ["source", "source"], ["case_nature", "case_nature"]]) {
      statements.push(this.db.prepare(`INSERT INTO filter_options (filter_name, option_value, sort_order)
        SELECT ?, CAST(${column} AS TEXT), ROW_NUMBER() OVER (ORDER BY ${column}) - 1
        FROM (SELECT DISTINCT ${column} FROM cases WHERE ${column} IS NOT NULL AND ${column} <> '')`).bind(filterName));
    }
    // Bookkeeping lives in catalog_summary itself (getStats reads only
    // total_cases/with_full_text, so these keys stay internal). Recording the
    // generation observed at the start — not a bare dirty=0 — is what keeps a
    // mid-rebuild mutation pending.
    statements.push(
      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
        SELECT 'rebuild_applied_generation', ?, ?`).bind(appliedGeneration, now),
      this.db.prepare(`INSERT OR REPLACE INTO catalog_summary (summary_key,value_int,updated_at)
        SELECT 'rebuild_last_at', ?, ?`).bind(Math.floor(Date.now() / 1000), now),
    );
    for (let offset = 0; offset < statements.length; offset += 20) {
      // While we still own the lease, extend it before each chunk; if another
      // invocation took over (this run outlived its lease), abort instead of
      // interleaving DELETEs with it. At most one chunk can overlap.
      if (lease && !(await this.renewRebuildLease({ token: lease.token, leaseSeconds: lease.leaseSeconds }))) {
        throw new StorageBoundaryError("Aggregate rebuild lease lost mid-run", {
          code: "rebuild_lease_lost", status: 503,
        });
      }
      await this.db.batch(statements.slice(offset, offset + 20));
    }
    return { rebuilt_at: now, applied_generation: appliedGeneration };
  }

  /**
   * Mark analytics as stale without paying for a rebuild: one row written per
   * queue batch instead of clearing and rewriting 17 tables.
   *
   * A monotonic generation, not a boolean: a rebuild applies the generation it
   * observed when it started, so a mutation landing mid-rebuild stays pending
   * instead of being wiped by the rebuild's own bookkeeping write.
   */
  async markAggregatesDirty() {

hook: PostToolUse
hook: PostToolUse Completed
**Analyzing lease token renewal race condition**
**Evaluating token renewal and batch execution order**
**Identifying race condition in token release and claiming**
**Planning transactional lease claim using SQLite CTE**
**Evaluating atomic lease state restructuring**
**Considering schema migration for atomic lease tokens**
**Evaluating throttling and retry logic**
**Analyzing retry and throttle interactions**
**Confirming no findings for areas 3 and queue**
**Verifying table counts and operations**
**Identifying unsafe release fallback risk**
**Assessing lease token validation risk**
**Evaluating severity of tokenless fallback**
**Investigating token collision risk**
**Designing atomic lease token generation**
**Planning final lease update verification**
**Drafting precise finding statements**
codex
- `workers/storage/cloudflare.js:1178-1191` — **HIGH**：取得 lease 與寫入 token 是分開的 D1 操作。新 owner 已更新 `rebuild_lease_until`、但尚未覆寫舊 token 的短暫窗口內，過期 owner 可用舊 token 通過 `renew` 或 `release` 的子查詢；尤其 `finally` 會在 `workers/cloudflare-native.js:160-163` 呼叫 release，可將新 owner 的 lease 歸零。隨後第三個 invocation 可取得 lease，造成重建交錯。`Math.random()` token 亦非保證唯一。  
  修正：將 lease expiry、唯一且單調的 fencing token、attempt timestamp 放入同一列，以單一原子 conditional `UPDATE ... RETURNING` 取得；renew/release 必須在同一列以 token 條件更新。不得在 claim 成功後另行寫 token。

- `workers/storage/cloudflare.js:1207-1215` — **HIGH**：`releaseRebuildLease()` 保留 token 缺失時的無條件 release 分支（`else`）。這仍提供錯誤 owner 歸零 lease 的路徑，與 Finding A 的 fencing 要求不符。  
  修正：缺少或無效 token 時直接回傳 `false`；移除無條件 `UPDATE` 分支。

- Area 3 — **No finding**：在成功 claim 並完成 attempt stamp 的正常路徑中，`aggregatesNeedRebuild()` 正確以 `max(rebuild_last_at, rebuild_last_attempt_at)` 節流（`workers/storage/cloudflare.js:1143-1169`）；queue 的 30 秒 retry 與 cron 都會經過此判斷（`workers/cloudflare-native.js:184-221`）。

- Area 4 — **No finding**：六個 bookkeeping keys 均在保留集合中（`workers/storage/cloudflare.js:50-56`），重建 DELETE 明確保留它們（`workers/storage/cloudflare.js:1019-1021`）。所檢視的其他 `catalog_summary` 寫入不會刪除這些 keys。

- Area 5 — **No finding**：額外 state read 與每 20 個 statements 的 renewal 不改變既有 batch 分片；bookkeeping 寫入仍位於最後批次（`workers/storage/cloudflare.js:1088-1110`）。

VERDICT: CHANGES-REQUIRED
tokens used
48,987
- `workers/storage/cloudflare.js:1178-1191` — **HIGH**：取得 lease 與寫入 token 是分開的 D1 操作。新 owner 已更新 `rebuild_lease_until`、但尚未覆寫舊 token 的短暫窗口內，過期 owner 可用舊 token 通過 `renew` 或 `release` 的子查詢；尤其 `finally` 會在 `workers/cloudflare-native.js:160-163` 呼叫 release，可將新 owner 的 lease 歸零。隨後第三個 invocation 可取得 lease，造成重建交錯。`Math.random()` token 亦非保證唯一。  
  修正：將 lease expiry、唯一且單調的 fencing token、attempt timestamp 放入同一列，以單一原子 conditional `UPDATE ... RETURNING` 取得；renew/release 必須在同一列以 token 條件更新。不得在 claim 成功後另行寫 token。

- `workers/storage/cloudflare.js:1207-1215` — **HIGH**：`releaseRebuildLease()` 保留 token 缺失時的無條件 release 分支（`else`）。這仍提供錯誤 owner 歸零 lease 的路徑，與 Finding A 的 fencing 要求不符。  
  修正：缺少或無效 token 時直接回傳 `false`；移除無條件 `UPDATE` 分支。

- Area 3 — **No finding**：在成功 claim 並完成 attempt stamp 的正常路徑中，`aggregatesNeedRebuild()` 正確以 `max(rebuild_last_at, rebuild_last_attempt_at)` 節流（`workers/storage/cloudflare.js:1143-1169`）；queue 的 30 秒 retry 與 cron 都會經過此判斷（`workers/cloudflare-native.js:184-221`）。

- Area 4 — **No finding**：六個 bookkeeping keys 均在保留集合中（`workers/storage/cloudflare.js:50-56`），重建 DELETE 明確保留它們（`workers/storage/cloudflare.js:1019-1021`）。所檢視的其他 `catalog_summary` 寫入不會刪除這些 keys。

- Area 5 — **No finding**：額外 state read 與每 20 個 statements 的 renewal 不改變既有 batch 分片；bookkeeping 寫入仍位於最後批次（`workers/storage/cloudflare.js:1088-1110`）。

VERDICT: CHANGES-REQUIRED
