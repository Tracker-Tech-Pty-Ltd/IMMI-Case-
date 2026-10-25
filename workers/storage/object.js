import {
  assertAuthContext,
  assertCaseId,
  assertObjectKey,
  assertObjectPointer,
  assertSha256,
  sha256Hex,
  StorageBoundaryError,
} from "./contracts.js";
import { rows } from "./cloudflare_shared.js";

const MAX_COUNCIL_PAYLOAD_BYTES = 8 * 1024 * 1024;
const JUDGE_PHOTO_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const JUDGE_PHOTO_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

function contentKeyFor({ kind, caseId, tenantId, sessionId, turnId, checksum, extension }) {
  assertSha256(checksum);
  // Never reuse a deleted object's address, even for identical replacement
  // text. A delayed cleanup can then delete only its own upload generation.
  if (kind === "case") return `cases/${assertCaseId(caseId)}/source/${checksum}-${crypto.randomUUID()}.${extension || "txt"}`;
  if (kind === "council") return `council/${tenantId}/${sessionId}/${turnId}.${extension || "json"}`;
  if (kind === "import") return `imports/${sessionId}/${caseId}/${turnId}.${extension || "ndjson"}`;
  throw new StorageBoundaryError(`Unsupported object kind: ${kind}`, { code: "invalid_object_kind", status: 400 });
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

  async hasVerifiedCaseSource(pointer) {
    const checked = assertObjectPointer(pointer, "cases");
    const head = await this.bucket.head(checked.key);
    return Boolean(head && head.size === checked.size && head.customMetadata?.sha256 === checked.sha256);
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
