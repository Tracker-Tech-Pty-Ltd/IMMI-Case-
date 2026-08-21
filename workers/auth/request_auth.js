/**
 * JWT request parsing with no database dependency.
 *
 * Cloudflare-native entrypoints import this module instead of the legacy
 * transaction/RLS helper, so their bundle cannot pull in postgres.js merely to
 * validate a signed access token.
 */

export function extractToken(request) {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/immi_access=([^;]+)/);
  return match ? match[1] : null;
}

export async function requireAuth(request, env, verifyJwt) {
  const token = extractToken(request);
  if (!token) {
    return new Response(JSON.stringify({ error: "Authentication required", code: "auth_required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const result = await verifyJwt(token, env);
  if (!result.valid) {
    return new Response(JSON.stringify({ error: "Invalid or expired token", code: result.reason }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (result.payload?.type === "refresh") {
    return new Response(JSON.stringify({ error: "Refresh token is not valid for this endpoint", code: "refresh_token_used_as_access" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return { claims: result.payload };
}
