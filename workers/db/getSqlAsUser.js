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
 * @param {object} env - Worker env with HYPERDRIVE binding
 * @param {object} claims - JWT claims object {sub, tenant_id, tenants, role, kid}
 * @param {{hyperdrive?: {connectionString: string}}} [options] - Optional Hyperdrive binding override.
 * @returns {{ tx: (fn: (tx: postgres.TransactionSql) => Promise<T>) => Promise<T> }}
 */
export function getSqlAsUser(env, claims, options = {}) {
  const hyperdrive = options.hyperdrive ?? env.HYPERDRIVE;
  const sql = postgres(hyperdrive.connectionString, {
    max: 1, // Single connection per request — Hyperdrive handles pooling
  });

  const claimsJson = JSON.stringify(claims);
  // Request-scoped correlation ID — Hyperdrive doesn't expose pool connection IDs
  const connectionId = crypto.randomUUID();

  return {
    /**
     * Run fn inside a transaction with JWT claims set via SET LOCAL.
     * RLS policies will see these claims via immi_auth_jwt_claims() function.
     *
     * @template T
     * @param {(tx: postgres.TransactionSql) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async tx(fn) {
      const t0 = Date.now();
      let ok = false;
      try {
        const result = await sql.begin(async (tx) => {
          // CRITICAL: true = transaction-local (SET LOCAL). MUST NOT be false.
          await tx`SELECT set_config('request.jwt.claims', ${claimsJson}, true)`;
          return await fn(tx);
        });
        ok = true;
        return result;
      } finally {
        await sql.end();
        console.log(JSON.stringify({
          event: "db.authed_query",
          kid: claims.kid ?? null,
          tenant_id: claims.tenant_id ?? null,
          user_id: claims.sub ?? null,
          connection_id: connectionId,
          query_ms: Date.now() - t0,
          ok,
        }));
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
