/**
 * workers/llm-council/storage.js
 *
 * Cloudflare-native CRUD layer for council_sessions + council_turns.
 *
 * All storage goes through createCloudflareStores() which owns D1, R2,
 * Vectorize, and Workers AI bindings. Legacy PostgreSQL/Hyperdrive paths
 * have been removed. The IMMI_STORAGE_MODE must be "cloudflare".
 */

import { createCloudflareStores } from "../storage/cloudflare.js";
import { getStorageMode, StorageBoundaryError } from "../storage/contracts.js";
import { getCouncilSessionStub } from "./session_namespace.js";

// ── Retrieve-code generator ──────────────────────────────────────────────────

const RETRIEVE_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const RETRIEVE_CODE_LENGTH = 6;

export function generateRetrieveCode() {
  const buf = new Uint8Array(RETRIEVE_CODE_LENGTH);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < RETRIEVE_CODE_LENGTH; i++) {
    out += RETRIEVE_CODE_ALPHABET[buf[i] % RETRIEVE_CODE_ALPHABET.length];
  }
  return out;
}

// ── Public columns whitelist (plan §1.3) ────────────────────────────────────

export const LIST_SESSION_COLUMNS = Object.freeze([
  "session_id",
  "case_id",
  "title",
  "status",
  "total_turns",
  "created_at",
  "updated_at",
]);

function storageMode(env) {
  return getStorageMode(env);
}

function cloudflareStores(env) {
  return createCloudflareStores(env);
}

function rejectFrozenMutation(env) {
  if (storageMode(env) === "freeze") {
    throw new StorageBoundaryError("Council mutations are frozen for cutover", {
      code: "cutover_write_freeze",
      status: 503,
    });
  }
}

function asCloudflareTurn(turn, payload) {
  return {
    turn_id: turn.turn_id,
    session_id: turn.session_id,
    turn_index: turn.turn_index,
    user_message: payload?.user_message ?? "",
    user_case_context: payload?.user_case_context ?? null,
    payload: payload?.payload ?? {},
    retrieved_cases: payload?.retrieved_cases ?? null,
    total_tokens: payload?.total_tokens ?? null,
    total_latency_ms: payload?.total_latency_ms ?? null,
    created_at: turn.created_at,
  };
}

// ── Cloudflare-native storage only (legacy PostgreSQL removed) ──────────────

function requireCloudflareMode(env) {
  if (storageMode(env) !== "cloudflare") {
    throw new StorageBoundaryError(
      `Council storage requires cloudflare mode (current: ${storageMode(env)})`,
      { code: "legacy_storage_removed", status: 503 }
    );
  }
}

// ── createSession ─────────────────────────────────────────────────────────────

export async function createSession({
  env,
  claims,
  sessionId,
  caseId,
  title,
  hmacSig,
  retrieveCode = null,
}) {
  rejectFrozenMutation(env);
  if (storageMode(env) === "cloudflare") {
    const stores = cloudflareStores(env);
    const context = await stores.identityStore.assertMembership(claims);
    return stores.councilStore.createSession(context, {
      sessionId,
      caseId,
      title: title ?? "",
      retrieveCode,
    });
  }
  requireCloudflareMode(env);
}

// ── getSessionByCode ──────────────────────────────────────────────────────────

export async function getSessionByCode({ env, claims, code }) {
  if (typeof code !== "string" || code.length !== 6) return null;
  if (!claims) throw new Error("getSessionByCode requires authenticated claims");
  const normalised = code.toUpperCase();

  if (storageMode(env) === "cloudflare") {
    const stores = cloudflareStores(env);
    const context = await stores.identityStore.assertMembership(claims);
    return stores.councilStore.getSessionByCode(context, normalised);
  }

  requireCloudflareMode(env);
}

// ── addTurn ───────────────────────────────────────────────────────────────────

export async function addTurn({
  env,
  claims,
  sessionId,
  turnId,
  turnIndex,
  userMessage,
  userCaseContext,
  payload,
  retrievedCases,
  totalTokens,
  totalLatencyMs,
}) {
  rejectFrozenMutation(env);
  if (storageMode(env) === "cloudflare") {
    if (!claims) throw new Error("addTurn requires authenticated claims");
    const stores = cloudflareStores(env);
    const context = await stores.identityStore.assertMembership(claims);
    const result = await getCouncilSessionStub(env, sessionId).appendTurn(context, {
      sessionId,
      turnId,
      role: "user",
      payload: {
        user_message: userMessage,
        user_case_context: userCaseContext ?? null,
        payload,
        retrieved_cases: retrievedCases ?? null,
        total_tokens: totalTokens ?? null,
        total_latency_ms: totalLatencyMs ?? null,
      },
    });
    return {
      turn_id: turnId,
      session_id: sessionId,
      turn_index: result.turnIndex,
      user_message: userMessage,
      user_case_context: userCaseContext ?? null,
      payload,
      retrieved_cases: retrievedCases ?? null,
      total_tokens: totalTokens ?? null,
      total_latency_ms: totalLatencyMs ?? null,
      created_at: new Date().toISOString(),
      replayed: result.replayed,
    };
  }
  if (!claims) throw new Error("addTurn requires authenticated claims");

  requireCloudflareMode(env);
}

// ── getSession ────────────────────────────────────────────────────────────────

export async function getSession({ env, claims, sessionId }) {
  if (!claims) throw new Error("getSession requires authenticated claims");

  if (storageMode(env) === "cloudflare") {
    const stores = cloudflareStores(env);
    const context = await stores.identityStore.assertMembership(claims);
    const metadata = await stores.councilStore.getSessionMetadata(context, sessionId);
    if (!metadata) return null;
    const turns = await Promise.all(metadata.turns.map(async (turn) => {
      const payload = await stores.objectStore.getVerifiedJson({
        key: turn.payload_key,
        sha256: turn.payload_sha256,
        size: turn.payload_size,
        contentType: turn.payload_content_type,
      });
      return asCloudflareTurn(turn, payload);
    }));
    return { session: metadata.session, turns };
  }

  requireCloudflareMode(env);
}

// ── listSessions (plan §1.3) ──────────────────────────────────────────────────

export async function listSessions({ env, claims, limit = 20, before = null }) {
  if (!claims) throw new Error("listSessions requires authenticated claims");
  const clampedLimit = Math.min(Math.max(1, limit), 100);

  if (storageMode(env) === "cloudflare") {
    const stores = cloudflareStores(env);
    return stores.identityStore.listCouncilSessions(claims, {
      limit: clampedLimit,
      before,
    });
  }

  requireCloudflareMode(env);
}

// ── deleteSession ─────────────────────────────────────────────────────────────

export async function deleteSession({ env, claims, sessionId }) {
  if (!claims) throw new Error("deleteSession requires authenticated claims");
  rejectFrozenMutation(env);

  if (storageMode(env) === "cloudflare") {
    const stores = cloudflareStores(env);
    const context = await stores.identityStore.assertMembership(claims);
    try {
      await getCouncilSessionStub(env, sessionId).deleteSession(context, { sessionId });
      return true;
    } catch (err) {
      if (err?.code === "council_session_not_found") return false;
      throw err;
    }
  }

  requireCloudflareMode(env);
}

// ── loadHistory ───────────────────────────────────────────────────────────────

export async function loadHistory({ env, claims, sessionId, limit = 15 }) {
  if (!claims) throw new Error("loadHistory requires authenticated claims");

  if (storageMode(env) === "cloudflare") {
    const session = await getSession({ env, claims, sessionId });
    if (!session) return [];
    return session.turns.slice(0, Math.min(Math.max(1, limit), 15)).map((turn) => ({
      user_message: turn.user_message,
      assistant_message: turn.payload?.moderator?.composed_answer ?? "",
    }));
  }

  requireCloudflareMode(env);
}
