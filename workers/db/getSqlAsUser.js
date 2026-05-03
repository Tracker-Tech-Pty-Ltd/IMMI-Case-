/**
 * getSqlAsUser — transaction-wrapped Postgres client for authenticated requests.
 *
 * Every authenticated query MUST use sql.begin() + SET LOCAL to inject JWT claims.
 * This ensures RLS policies see the correct tenant_id even in Hyperdrive connection pools.
 *
 * CRITICAL: set_config third arg MUST be `true` (transaction-local / SET LOCAL semantics).
 * `false` = session-local → leaks across pooled connections → cross-tenant data leak.
 *
 * Anonymous reads (cases, stats, analytics) do NOT use this wrapper — they use getSql(env)
 * directly. Only tenant-scoped data (collections, saved_searches, council_sessions) needs
 * this wrapper.
 */

import postgres from "postgres";

/**
 * Create a transaction-scoped authenticated SQL client.
 *
 * @param {object} env - Worker env with DATABASE_URL (Hyperdrive)
 * @param {object} claims - JWT claims object {sub, tenant_id, tenants, role, kid}
 * @returns {{ tx: (fn: (tx: postgres.TransactionSql) => Promise<T>) => Promise<T> }}
 */
export function getSqlAsUser(env, claims) {
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1, // Single connection per request — Hyperdrive handles pooling
  });

  const claimsJson = JSON.stringify(claims);

  return {
    /**
     * Run fn inside a transaction with JWT claims set via SET LOCAL.
     * RLS policies will see these claims via auth_jwt_claims() function.
     *
     * @template T
     * @param {(tx: postgres.TransactionSql) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async tx(fn) {
      try {
        return await sql.begin(async (tx) => {
          // CRITICAL: true = transaction-local (SET LOCAL). MUST NOT be false.
          await tx`SELECT set_config('request.jwt.claims', ${claimsJson}, true)`;
          return await fn(tx);
        });
      } finally {
        await sql.end();
      }
    },

  };
}

/**
 * Extract and verify JWT from Authorization header or immi_access cookie.
 * Returns null if no token found.
 *
 * @param {Request} request
 * @returns {string|null}
 */
export function extractToken(request) {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/immi_access=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * requireAuth middleware — extracts JWT, verifies, returns claims or 401.
 *
 * @param {Request} request
 * @param {object} env
 * @param {Function} verifyJwt - from workers/auth/jwt.js
 * @returns {Promise<{claims: object}|Response>} claims or 401 Response
 */
export async function requireAuth(request, env, verifyJwt) {
  const token = extractToken(request);
  if (!token) {
    return new Response(JSON.stringify({error: "Authentication required", code: "auth_required"}), {
      status: 401,
      headers: {"Content-Type": "application/json"},
    });
  }

  const result = await verifyJwt(token, env);
  if (!result.valid) {
    return new Response(JSON.stringify({error: "Invalid or expired token", code: result.reason}), {
      status: 401,
      headers: {"Content-Type": "application/json"},
    });
  }

  return {claims: result.payload};
}
