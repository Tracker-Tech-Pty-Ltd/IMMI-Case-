/**
 * Cloudflare-native storage contracts for IMMI.
 *
 * Only modules in workers/storage may access D1, R2, Vectorize or Workers AI
 * bindings. Handlers receive store instances, never a raw binding. This is the
 * replacement for transaction-local PostgreSQL RLS claims once cutover reaches
 * IMMI_STORAGE_MODE=cloudflare.
 */

export const STORAGE_MODES = Object.freeze(["legacy", "shadow", "freeze", "cloudflare"]);
export const VECTOR_MODEL = "@cf/qwen/qwen3-embedding-0.6b";
export const VECTOR_DIMENSIONS = 1024;
export const D1_MAX_BOUND_PARAMETERS = 100;
export const CATALOG_MAX_ROW_BYTES = 256 * 1024;
export const FTS_CHUNK_MAX_BYTES = 128 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CASE_ID_RE = /^[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export class StorageBoundaryError extends Error {
  constructor(message, { code = "storage_boundary_error", status = 500 } = {}) {
    super(message);
    this.name = "StorageBoundaryError";
    this.code = code;
    this.status = status;
  }
}

function invalid(message, code = "invalid_storage_input") {
  throw new StorageBoundaryError(message, { code, status: 400 });
}

export function getStorageMode(env) {
  const mode = env?.IMMI_STORAGE_MODE || "legacy";
  if (!STORAGE_MODES.includes(mode)) {
    throw new StorageBoundaryError(`Unsupported IMMI_STORAGE_MODE: ${mode}`, {
      code: "invalid_storage_mode",
      status: 500,
    });
  }
  return mode;
}

export function assertCloudflareRuntimeMode(env) {
  const mode = getStorageMode(env);
  if (mode !== "cloudflare") {
    throw new StorageBoundaryError(
      `Cloudflare store cannot be used while IMMI_STORAGE_MODE=${mode}`,
      { code: "cloudflare_store_inactive", status: 503 },
    );
  }
  return mode;
}

export function assertUuid(value, field) {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    invalid(`${field} must be a UUID`, "invalid_identifier");
  }
  return value.toLowerCase();
}

export function assertCaseId(value) {
  if (typeof value !== "string" || !CASE_ID_RE.test(value)) {
    invalid("case_id must be a 12-character lowercase hex string", "invalid_case_id");
  }
  return value;
}

export function assertAuthContext(auth) {
  if (!auth || typeof auth !== "object") {
    throw new StorageBoundaryError("Authenticated context is required", {
      code: "auth_context_required",
      status: 401,
    });
  }
  const userId = assertUuid(auth.sub || auth.userId, "auth.sub");
  const tenantId = assertUuid(auth.tenant_id || auth.tenantId, "auth.tenant_id");
  const tenants = Array.isArray(auth.tenants) ? auth.tenants.map((value) => String(value).toLowerCase()) : [];
  if (tenants.length > 0 && !tenants.includes(tenantId)) {
    throw new StorageBoundaryError("Active tenant is absent from authenticated membership claims", {
      code: "tenant_membership_denied",
      status: 403,
    });
  }
  return Object.freeze({ userId, tenantId, role: auth.role || "member" });
}

export function assertObjectKey(key, prefix = null) {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) {
    invalid("R2 object key is invalid", "invalid_object_key");
  }
  if (key.startsWith("/") || key.includes("..") || /[\\\\\u0000-\u001f]/.test(key)) {
    invalid("R2 object key contains a forbidden path segment", "invalid_object_key");
  }
  if (prefix && !key.startsWith(`${prefix}/`)) {
    invalid(`R2 object key must use ${prefix}/ prefix`, "invalid_object_key");
  }
  return key;
}

export function assertSha256(checksum) {
  if (typeof checksum !== "string" || !SHA256_RE.test(checksum)) {
    invalid("sha256 must be a lowercase 64-character hex digest", "invalid_checksum");
  }
  return checksum;
}

export function assertObjectPointer(pointer, prefix = null) {
  if (!pointer || typeof pointer !== "object") {
    invalid("Object pointer is required", "invalid_object_pointer");
  }
  const key = assertObjectKey(pointer.key, prefix);
  const sha256 = assertSha256(pointer.sha256);
  const size = Number(pointer.size);
  // This is the R2 object's byte length, not a D1 row. The D1 row stores only
  // the compact pointer, so Council/import payloads may legitimately be much
  // larger than the catalog row guard.
  if (!Number.isSafeInteger(size) || size < 0) {
    invalid("Object pointer size is invalid", "invalid_object_pointer");
  }
  if (typeof pointer.contentType !== "string" || pointer.contentType.length === 0 || pointer.contentType.length > 255) {
    invalid("Object pointer contentType is invalid", "invalid_object_pointer");
  }
  return Object.freeze({ key, sha256, size, contentType: pointer.contentType });
}

export function utcNow() {
  return new Date().toISOString();
}

export function clampLimit(value, { fallback = 50, max = 100 } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, parsed));
}

/**
 * Build an FTS5 MATCH value, not an SQL fragment. Quoting every token keeps
 * query syntax and SQL structure outside user control.
 */
export function toFtsMatch(query) {
  if (typeof query !== "string") invalid("Search query must be a string", "invalid_search_query");
  const tokens = query.trim().match(/[\p{L}\p{N}_-]+/gu) || [];
  if (tokens.length === 0) invalid("Search query must contain searchable terms", "invalid_search_query");
  return tokens.slice(0, 12).map((token) => `"${token.replaceAll('"', '""')}"`).join(" AND ");
}

export function textBytes(value) {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  invalid("Object body must be string, Uint8Array, or ArrayBuffer", "invalid_object_body");
}

export async function sha256Hex(value) {
  const bytes = textBytes(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
  return { bytes, digest, hex };
}

export function assertCloudflareBindings(env) {
  const required = [
    ["IMMI_CATALOG_DB", "prepare"],
    ["IMMI_ACCOUNT_DB", "prepare"],
    ["IMMI_OPS_DB", "prepare"],
    ["IMMI_CONTENT", "put"],
    ["IMMI_CONTENT", "get"],
    ["CASE_VECTORS", "queryById"],
    ["CASE_VECTORS", "query"],
    ["AI", "run"],
  ];
  const missing = required
    .filter(([binding, method]) => !env?.[binding] || typeof env[binding][method] !== "function")
    .map(([binding]) => binding);
  if (missing.length > 0) {
    throw new StorageBoundaryError(`Missing Cloudflare bindings: ${missing.join(", ")}`, {
      code: "missing_cloudflare_binding",
      status: 503,
    });
  }
}
