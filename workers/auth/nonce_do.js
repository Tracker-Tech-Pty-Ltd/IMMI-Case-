/**
 * nonce_do.js — AuthNonce Durable Object for Telegram login replay protection.
 *
 * Each Telegram auth payload carries a unique `hash` (HMAC-SHA256 of the
 * data-check-string). We record the first use of each hash and reject any
 * subsequent request that presents the same hash — preventing replay attacks
 * where an intercepted Telegram login link is reused within the 1-hour window.
 *
 * Storage strategy:
 *   - In-memory Map for O(1) lookup within the same DO instance lifetime.
 *   - DO storage for cross-restart survival.
 *   - Expired nonces (>1 hr) are swept from memory on each request, and from
 *     DO storage by the alarm() handler below. DurableObjectStorage.put() has
 *     no built-in TTL option — the KV-only expiry argument this file used to
 *     pass was silently ignored here, so entries accumulated forever.
 *
 * Binding requirement (wrangler.toml):
 *   [[durable_objects.bindings]]
 *   name = "AUTH_NONCE"
 *   class_name = "AuthNonce"
 *
 *   [[migrations]]
 *   tag = "v1"
 *   new_classes = ["AuthNonce"]
 *
 * Usage:
 *   import { AuthNonce, checkNonce } from './auth/nonce_do.js';
 *   // In fetch handler:
 *   const fresh = await checkNonce(env, hash);  // false = replay, reject
 */

/**
 * AuthNonce Durable Object.
 *
 * Handles a single JSON-body POST:
 *   { hash: string, timestamp?: number }
 * Returns:
 *   { fresh: boolean }
 *
 * `fresh: true`  → first time this hash has been seen; recorded.
 * `fresh: false` → replay detected; reject the login.
 */
const NONCE_TTL_MS = 3_600_000;

export class AuthNonce {
  /**
   * @param {DurableObjectState} state
   * @param {object} env
   */
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // In-memory map: hash → timestamp (ms). Survives within one DO instance
    // lifetime but not across restarts — DO storage is the durable layer.
    this.nonces = new Map();
  }

  /**
   * Handle a nonce-check request.
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ fresh: false, error: "invalid_body" }, { status: 400 });
    }

    const { hash, timestamp } = body;
    if (!hash || typeof hash !== "string") {
      return Response.json({ fresh: false, error: "missing_hash" }, { status: 400 });
    }

    const now = Date.now();

    // Sweep expired in-memory nonces (>1 hour) to bound memory usage
    for (const [k, ts] of this.nonces) {
      if (now - ts > NONCE_TTL_MS) this.nonces.delete(k);
    }

    // Check in-memory map first (fast path — avoids DO storage round-trip)
    if (this.nonces.has(hash)) {
      return Response.json({ fresh: false });
    }

    // Check DO storage (cross-restart durability)
    const stored = await this.state.storage.get(hash);
    if (stored !== undefined) {
      // Populate in-memory cache to speed up future checks within this instance
      this.nonces.set(hash, stored);
      return Response.json({ fresh: false });
    }

    // First time seeing this hash — record it
    const ts = typeof timestamp === "number" ? timestamp : now;
    this.nonces.set(hash, ts);

    // DO storage has no TTL; alarm() below prunes expired entries instead.
    await this.state.storage.put(hash, ts);
    const existingAlarm = await this.state.storage.getAlarm();
    if (existingAlarm === null || existingAlarm === undefined) {
      await this.state.storage.setAlarm(Date.now() + NONCE_TTL_MS);
    }

    return Response.json({ fresh: true });
  }

  /**
   * Prune nonces older than the TTL from DO storage, then re-arm while any
   * entries remain. Without this the store grows by ~100 bytes per successful
   * Telegram login, forever, in a single globally-shared Durable Object.
   */
  async alarm() {
    const now = Date.now();
    const stored = await this.state.storage.list();
    const expired = [];
    let remaining = 0;
    for (const [key, ts] of stored) {
      if (typeof ts === "number" && now - ts > NONCE_TTL_MS) expired.push(key);
      else remaining += 1;
    }
    if (expired.length) {
      await this.state.storage.delete(expired);
      for (const key of expired) this.nonces.delete(key);
    }
    if (remaining > 0) await this.state.storage.setAlarm(now + NONCE_TTL_MS);
  }
}

// ---------------------------------------------------------------------------
// checkNonce helper — for use in auth route handlers
// ---------------------------------------------------------------------------

/**
 * Check whether a Telegram auth hash is fresh (not a replay).
 *
 * Forwards to the AuthNonce Durable Object via its stub. The DO is addressed
 * by a fixed name so all Workers share a single nonce store globally.
 *
 * Denial is discriminated. Every deny still fails closed, but a missing
 * binding or an unreachable DO is an outage on our side, not a replay by the
 * caller — reporting both as `401 replay` sent users to re-authenticate
 * against a login that could not succeed, and hid the outage from anyone
 * reading status codes.
 *
 * @param {{AUTH_NONCE: DurableObjectNamespace}} env
 * @param {string} hash  hex hash from Telegram auth payload
 * @returns {Promise<{fresh: boolean, reason: "" | "replay" | "unavailable"}>}
 */
export async function checkNonce(env, hash) {
  if (!env?.AUTH_NONCE) {
    console.error(JSON.stringify({ event: "auth.fail.config", reason: "AUTH_NONCE binding missing" }));
    // Fail closed — deny to prevent auth bypass on misconfiguration.
    return { fresh: false, reason: "unavailable" };
  }

  try {
    const id = env.AUTH_NONCE.idFromName("global");
    const stub = env.AUTH_NONCE.get(id, { locationHint: "oc" });
    const resp = await stub.fetch("https://internal/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash, timestamp: Date.now() }),
    });
    const data = await resp.json();
    if (data.fresh === true) return { fresh: true, reason: "" };
    return { fresh: false, reason: "replay" };
  } catch (err) {
    console.error(JSON.stringify({ event: "auth.fail.nonce_error", error: String(err) }));
    // Fail closed on unexpected errors, but as a dependency failure.
    return { fresh: false, reason: "unavailable" };
  }
}
