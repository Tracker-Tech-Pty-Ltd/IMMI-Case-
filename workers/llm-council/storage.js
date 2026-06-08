/**
 * workers/llm-council/storage.js
 *
 * Postgres CRUD layer for council_sessions + council_turns via Hyperdrive.
 *
 * Two SQL lifecycle helpers MUST be used by everything in this module:
 *
 *   withSql(env, fn)           — for unauthenticated reads (legacy/admin paths
 *                                only; should be a last resort).
 *   withSqlAsUser(env, c, fn)       — for tenant-scoped queries. Wraps the
 *                                     work in a `sql.begin` + `SET LOCAL
 *                                     request.jwt.claims` transaction so RLS
 *                                     sees the JWT tenant_id.
 *   withSqlFreshAsUser(env, c, fn)  — same authenticated transaction, but
 *                                     routed through HYPERDRIVE_NO_CACHE when
 *                                     bound. Use for write-affected reads.
 *
 * Both helpers guarantee `await sql.end()` in a `finally`, preventing
 * Hyperdrive pool-slot leaks under load. Direct `getSql(env)` calls are
 * preserved only for backwards-compatible test surfaces; new code must
 * call one of the helpers above.
 *
 * IMPORTANT: getSql(env) creates a NEW postgres client per call.
 * Module-level singletons cause "Cannot perform I/O on behalf of a different
 * request" errors in Cloudflare Workers.
 */

import postgres from "postgres";

import { getSqlAsUser } from "../db/getSqlAsUser.js";

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

// ── Client factory + lifecycle helpers ──────────────────────────────────────

export function getSql(env) {
  return postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    idle_timeout: 5,
  });
}

export function getSqlFresh(env) {
  return postgres((env.HYPERDRIVE_NO_CACHE ?? env.HYPERDRIVE).connectionString, {
    max: 1,
    idle_timeout: 5,
  });
}

export async function withSql(env, fn) {
  const sql = getSql(env);
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

export async function withSqlAsUser(env, claims, fn) {
  const client = getSqlAsUser(env, claims);
  return client.tx(fn);
}

export async function withSqlFreshAsUser(env, claims, fn) {
  const client = getSqlAsUser(env, claims, {
    hyperdrive: env.HYPERDRIVE_NO_CACHE ?? env.HYPERDRIVE,
  });
  return client.tx(fn);
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
  if (!claims || !claims.tenant_id || !claims.sub) {
    throw new Error("createSession requires authenticated claims with tenant_id + sub");
  }
  const tenantId = claims.tenant_id;
  const createdBy = claims.sub;

  return withSqlAsUser(env, claims, async (tx) => {
    const rows = await tx`
      INSERT INTO council_sessions
        (session_id, case_id, title, hmac_sig, retrieve_code, tenant_id, created_by)
      VALUES
        (${sessionId}, ${caseId ?? null}, ${title ?? null}, ${hmacSig},
         ${retrieveCode}, ${tenantId}::uuid, ${createdBy}::uuid)
      RETURNING *
    `;
    return rows[0];
  });
}

// ── getSessionByCode ──────────────────────────────────────────────────────────

export async function getSessionByCode({ env, claims, code }) {
  if (typeof code !== "string" || code.length !== 6) return null;
  if (!claims) throw new Error("getSessionByCode requires authenticated claims");
  const normalised = code.toUpperCase();

  return withSqlAsUser(env, claims, async (tx) => {
    const rows = await tx`
      SELECT session_id, retrieve_code, tenant_id, created_by
      FROM council_sessions
      WHERE retrieve_code = ${normalised}
      LIMIT 1
    `;
    return rows && rows.length > 0 ? rows[0] : null;
  });
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
  if (!claims) throw new Error("addTurn requires authenticated claims");

  return withSqlAsUser(env, claims, async (tx) => {
    const rows = await tx`
      INSERT INTO council_turns
        (turn_id, session_id, turn_index, user_message, user_case_context,
         payload, retrieved_cases, total_tokens, total_latency_ms)
      VALUES
        (${turnId}, ${sessionId}, ${turnIndex}, ${userMessage},
         ${userCaseContext ?? null},
         ${tx.json(payload)}, ${retrievedCases ? tx.json(retrievedCases) : null},
         ${totalTokens ?? null}, ${totalLatencyMs ?? null})
      ON CONFLICT (session_id, turn_index) DO NOTHING
      RETURNING *
    `;

    if (!rows || rows.length === 0) {
      return null;
    }

    await tx`
      UPDATE council_sessions
      SET total_turns = total_turns + 1,
          updated_at  = now()
      WHERE session_id = ${sessionId}
    `;

    return rows[0];
  });
}

// ── getSession ────────────────────────────────────────────────────────────────

export async function getSession({ env, claims, sessionId }) {
  if (!claims) throw new Error("getSession requires authenticated claims");

  return withSqlAsUser(env, claims, async (tx) => {
    const sessions = await tx`
      SELECT * FROM council_sessions WHERE session_id = ${sessionId}
    `;
    if (!sessions || sessions.length === 0) return null;

    const turns = await tx`
      SELECT * FROM council_turns
      WHERE session_id = ${sessionId}
      ORDER BY turn_index ASC
    `;

    return { session: sessions[0], turns: turns ?? [] };
  });
}

// ── listSessions (plan §1.3) ──────────────────────────────────────────────────

export async function listSessions({ env, claims, limit = 20, before = null }) {
  if (!claims) throw new Error("listSessions requires authenticated claims");
  const clampedLimit = Math.min(Math.max(1, limit), 100);

  return withSqlFreshAsUser(env, claims, async (tx) => {
    if (before) {
      return await tx`
        SELECT session_id, case_id, title, status, total_turns, created_at, updated_at
        FROM council_sessions
        WHERE updated_at < ${before}
        ORDER BY updated_at DESC
        LIMIT ${clampedLimit}
      `;
    }
    return await tx`
      SELECT session_id, case_id, title, status, total_turns, created_at, updated_at
      FROM council_sessions
      ORDER BY updated_at DESC
      LIMIT ${clampedLimit}
    `;
  });
}

// ── deleteSession ─────────────────────────────────────────────────────────────

export async function deleteSession({ env, claims, sessionId }) {
  if (!claims) throw new Error("deleteSession requires authenticated claims");

  return withSqlAsUser(env, claims, async (tx) => {
    const rows = await tx`
      DELETE FROM council_sessions
      WHERE session_id = ${sessionId}
      RETURNING session_id
    `;
    return rows.length > 0;
  });
}

// ── loadHistory ───────────────────────────────────────────────────────────────

export async function loadHistory({ env, claims, sessionId, limit = 15 }) {
  if (!claims) throw new Error("loadHistory requires authenticated claims");

  return withSqlAsUser(env, claims, async (tx) => {
    const turns = await tx`
      SELECT user_message, payload
      FROM council_turns
      WHERE session_id = ${sessionId}
      ORDER BY turn_index ASC
      LIMIT ${limit}
    `;

    return (turns ?? []).map((t) => ({
      user_message: t.user_message,
      assistant_message: t.payload?.moderator?.composed_answer ?? "",
    }));
  });
}
