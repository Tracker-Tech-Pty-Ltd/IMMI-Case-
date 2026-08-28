/**
 * Auth handlers for the standalone Cloudflare-native Worker.
 *
 * This is deliberately separate from auth/handlers.js so the native bundle
 * cannot carry legacy Hyperdrive branch code. All durable identity state is
 * accessed through the Account D1 IdentityStore.
 */

import { verifyTelegramAuth } from "./telegram.js";
import { makeAccessToken, makeRefreshToken, verifyJwt } from "./jwt.js";
import { requireAuth, extractToken } from "./request_auth.js";
import { checkNonce } from "./nonce_do.js";
import {
  deriveSuccessorJti,
  extractActiveTenantId,
  extractRefreshToken,
  extractRotationId,
  generateRefreshSessionDraft,
  validateRefreshPayload,
} from "./refresh_sessions.js";
import { readBoundedBodyText } from "../storage/body_limit.js";
import { createCloudflareIdentityStore } from "../storage/cloudflare.js";
import { StorageBoundaryError } from "../storage/contracts.js";

const ACCESS_MAX_AGE = 300;
const REFRESH_MAX_AGE = 604800;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(errorText, status = 400, code = "error") {
  return json({ error: errorText, code }, status);
}

function authResponse(body, accessToken, refreshToken) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", `immi_access=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ACCESS_MAX_AGE}`);
  headers.append("Set-Cookie", `immi_refresh=${refreshToken}; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${REFRESH_MAX_AGE}`);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

function clearCookies(body, status = 200) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", "immi_access=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  headers.append("Set-Cookie", "immi_refresh=; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  return new Response(JSON.stringify(body), { status, headers });
}

function redirect(next, accessToken, refreshToken) {
  const headers = new Headers({ Location: next });
  headers.append("Set-Cookie", `immi_access=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ACCESS_MAX_AGE}`);
  headers.append("Set-Cookie", `immi_refresh=${refreshToken}; Path=/api/v1/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${REFRESH_MAX_AGE}`);
  return new Response(null, { status: 302, headers });
}

const DEFAULT_REDIRECT = "/app/";

/**
 * Resolve the post-login `next` target to a same-origin path, or the default.
 *
 * Prefix checks alone are not sufficient: `/\evil.example` passes a
 * `startsWith("//")` test but browsers resolve it as a protocol-relative URL
 * (WHATWG URL "special authority ignore slashes" state), producing an open
 * redirect from a genuine immi.trackit.today login link. Parse against the
 * request origin and accept only when the resolved origin still matches.
 */
export function safeRedirectTarget(value, origin) {
  if (typeof value !== "string" || !value.startsWith("/")) return DEFAULT_REDIRECT;
  // Reject C0 controls, DEL and backslashes outright — none belong in a path
  // and all of them are URL-parser ambiguity vectors.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return DEFAULT_REDIRECT;
  let resolved;
  try {
    resolved = new URL(value, origin);
  } catch {
    return DEFAULT_REDIRECT;
  }
  if (resolved.origin !== new URL(origin).origin) return DEFAULT_REDIRECT;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}

/**
 * Ceiling for auth request bodies.
 *
 * Telegram login payloads and a bootstrap secret are well under a kilobyte;
 * 8 KiB is generous. The point is that these three routes run BEFORE any
 * authentication, so `request.json()` let an unauthenticated caller buffer an
 * arbitrary body into isolate memory on every request, under Cloudflare's own
 * outer request limit and therefore invisible to it.
 */
const AUTH_BODY_MAX_BYTES = 8 * 1024;

/**
 * Read and parse a bounded JSON body, or return the Response to send.
 * Oversize is reported as 413, not as malformed JSON — a client that sent
 * perfectly valid JSON should not be told its syntax was wrong.
 */
async function readBoundedJson(request) {
  const text = await readBoundedBodyText(request, AUTH_BODY_MAX_BYTES);
  if (text === null) {
    return { response: error("Request body is too large", 413, "payload_too_large") };
  }
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { response: error("Invalid JSON body", 400, "bad_request") };
  }
}

function clientError(err) {
  return err instanceof StorageBoundaryError && err.status >= 400 && err.status < 500;
}

async function optionalRefreshClaims(request, env) {
  const token = extractRefreshToken(request);
  if (!token) return null;
  const verified = await verifyJwt(token, env);
  if (!verified.valid) return null;
  try {
    return validateRefreshPayload(verified.payload);
  } catch {
    return null;
  }
}

async function issueLoginPair(request, env, identity, user, tenant, tenantIds) {
  const previous = await optionalRefreshClaims(request, env);
  const draft = generateRefreshSessionDraft(user.id);
  const [accessToken, refreshToken] = await Promise.all([
    makeAccessToken(user, tenant, tenantIds, env),
    makeRefreshToken(user.id, draft.jti, env),
  ]);
  await identity.createRefreshSession(draft, previous);
  return { accessToken, refreshToken };
}

async function completeTelegramLogin(request, env, data) {
  const verified = await verifyTelegramAuth(data, env);
  if (!verified.valid) return { response: error("Telegram auth verification failed", 401, verified.reason || "invalid_hash") };
  const nonce = await checkNonce(env, data.hash);
  if (!nonce.fresh) {
    if (nonce.reason === "unavailable") {
      // Our replay store is down. Denying is right; blaming the user is not.
      return { response: error("Auth replay check unavailable", 503, "nonce_unavailable") };
    }
    return { response: error("Auth replay detected", 401, "replay") };
  }
  try {
    const identity = createCloudflareIdentityStore(env);
    const { user, tenant, tenants, tenantIds } = await identity.upsertTelegramUser(data);
    const { accessToken, refreshToken } = await issueLoginPair(request, env, identity, user, tenant, tenantIds);
    return { user, tenant, tenants, accessToken, refreshToken };
  } catch (err) {
    console.error(JSON.stringify({ event: "auth.cloudflare.telegram_error", error: err?.message }));
    return { response: error("Authentication service error", 503, "db_error") };
  }
}

export async function handleTelegramLogin(request, env) {
  const body = await readBoundedJson(request);
  if (body.response) return body.response;
  const data = body.data;
  if (!data || typeof data !== "object") return error("Missing body", 400, "bad_request");
  const result = await completeTelegramLogin(request, env, data);
  if (result.response) return result.response;
  return authResponse({
    access_token: result.accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_MAX_AGE,
    user: {
      id: result.user.id,
      telegram_id: result.user.telegram_id,
      first_name: data.first_name || null,
      username: data.username || null,
      photo_url: data.photo_url || null,
      role: result.user.role || "member",
    },
    tenant: result.tenant,
    tenants: result.tenants,
  }, result.accessToken, result.refreshToken);
}

export async function handleTelegramCallback(request, env) {
  const url = new URL(request.url);
  const next = safeRedirectTarget(url.searchParams.get("next"), url.origin);
  const data = Object.fromEntries(url.searchParams.entries());
  delete data.next;
  if (!data.hash) return Response.redirect(`${url.origin}/app/login?auth_error=missing_telegram_payload`, 302);
  const result = await completeTelegramLogin(request, env, data);
  if (result.response) {
    const body = await result.response.json();
    return Response.redirect(`${url.origin}/app/login?auth_error=${encodeURIComponent(body.code || "auth_error")}`, 302);
  }
  return redirect(next, result.accessToken, result.refreshToken);
}

export async function handleAuthMe(request, env) {
  const authResult = await requireAuth(request, env, verifyJwt);
  if (authResult instanceof Response) return authResult;
  const { claims } = authResult;
  // `claims.tenants` is the JWT claim shape: bare tenant ids, which is what
  // assertAuthContext() compares against. The SPA needs AuthTenant objects to
  // render the workspace switcher, so read the memberships rather than
  // forwarding ids into a field typed as objects.
  let tenants = [];
  try {
    const snapshot = await createCloudflareIdentityStore(env)
      .getAuthSnapshot(claims.sub, claims.tenant_id || null, { fallbackToDefault: true });
    tenants = snapshot.tenants;
  } catch (err) {
    console.error(JSON.stringify({ event: "auth.cloudflare.me_tenants_error", error: err?.message }));
  }
  return json({
    user: { id: claims.sub, role: claims.role || "member", tg_id: claims.tg_id || null },
    tenant: { id: claims.tenant_id, kind: claims.tenant_kind || "individual", name: claims.tenant_name || "" },
    tenants,
    access_token: extractToken(request),
  });
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const av = enc.encode(a);
  const bv = enc.encode(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

export async function handleBootstrapLogin(request, env) {
  if (!env.BOOTSTRAP_ADMIN_SECRET || !env.BOOTSTRAP_ADMIN_USER_ID) {
    return error("Bootstrap login is not configured", 503, "bootstrap_unconfigured");
  }
  const body = await readBoundedJson(request);
  if (body.response) return body.response;
  const data = body.data;
  if (!data || typeof data.secret !== "string" || !data.secret) {
    return error("Missing bootstrap secret", 401, "bootstrap_secret_required");
  }
  if (!constantTimeEqual(data.secret, env.BOOTSTRAP_ADMIN_SECRET)) {
    return error("Invalid bootstrap secret", 401, "bootstrap_invalid_secret");
  }
  try {
    const identity = createCloudflareIdentityStore(env);
    const snapshot = await identity.getAuthSnapshot(env.BOOTSTRAP_ADMIN_USER_ID);
    const { user, tenant, tenants, tenantIds } = snapshot;
    const { accessToken, refreshToken } = await issueLoginPair(request, env, identity, user, tenant, tenantIds);
    return authResponse({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_MAX_AGE,
      user: { id: user.id, role: user.role },
      tenant,
      tenants,
    }, accessToken, refreshToken);
  } catch (err) {
    console.error(JSON.stringify({ event: "auth.bootstrap_error", error: err?.message }));
    return error("Authentication service error", 503, "db_error");
  }
}

export async function handleAuthLogout(request, env) {
  const token = extractRefreshToken(request);
  if (!token) return clearCookies({ ok: true });
  const verified = await verifyJwt(token, env);
  if (!verified.valid) return clearCookies({ ok: true });
  let claims;
  try { claims = validateRefreshPayload(verified.payload); } catch { return clearCookies({ ok: true }); }
  try {
    await createCloudflareIdentityStore(env).revokeRefreshSession({
      jti: claims.jti, userId: claims.userId, reason: "logout",
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "auth.cloudflare.logout_error", error: err?.message }));
    // The server session is still live. Expiring the refresh cookie here would
    // destroy the only credential that can retry the revocation — JS cannot
    // read an HttpOnly cookie back — leaving a stolen copy refreshable for the
    // remaining 7 days with no way for the user to kill it. Drop the access
    // cookie (so the tab stops acting signed-in) and keep the refresh cookie
    // so a retry can still revoke.
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", "immi_access=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    return new Response(
      JSON.stringify({ ok: false, error: "Logout revoke failed", code: "db_error" }),
      { status: 503, headers },
    );
  }
  return clearCookies({ ok: true });
}

export async function handleAuthRefresh(request, env) {
  const token = extractRefreshToken(request);
  if (!token) return error("No refresh token", 401, "missing_refresh_token");
  const verified = await verifyJwt(token, env);
  if (!verified.valid || verified.payload?.type !== "refresh") {
    return error("Invalid or expired refresh token", 401, verified.reason || "invalid_refresh_token");
  }
  let claims;
  try { claims = validateRefreshPayload(verified.payload); } catch (err) { return error(err.message, err.status, err.code); }
  const rotationId = extractRotationId(request);
  const expectedSuccessorJti = rotationId ? await deriveSuccessorJti(claims.jti, rotationId) : null;
  try {
    const identity = createCloudflareIdentityStore(env);
    const snapshot = await identity.loadRefreshAuthSnapshot({
      ...claims,
      // The UI's selected workspace, so a silent refresh does not silently
      // revert to the first membership and desync the tenant the SPA shows
      // from the tenant the access token actually scopes.
      activeTenantId: extractActiveTenantId(request),
      expectedSuccessorJti,
    });
    // Replay of a rotation this same client already committed: re-serve that
    // successor instead of rotating again. Rotating would consume the live
    // token and orphan the session.
    const draft = snapshot.replayed
      ? null
      : generateRefreshSessionDraft(snapshot.user.id, snapshot.session.family_id);
    if (draft && expectedSuccessorJti) draft.jti = expectedSuccessorJti;
    const nextJti = draft ? draft.jti : snapshot.session.jti;
    const [accessToken, refreshToken] = await Promise.all([
      makeAccessToken(snapshot.user, snapshot.tenant, snapshot.tenantIds, env),
      makeRefreshToken(snapshot.user.id, nextJti, env),
    ]);
    if (draft) await identity.rotateRefreshSession(claims, draft);
    return authResponse({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_MAX_AGE,
      // Carry the identity too. A client recovering from a bootstrap failure
      // otherwise lands authenticated with user=null because the refresh
      // response used to be access_token only.
      user: snapshot.user,
      tenant: snapshot.tenant,
      tenants: snapshot.tenants,
    }, accessToken, refreshToken);
  } catch (err) {
    if (clientError(err)) return error(err.message, err.status, err.code);
    console.error(JSON.stringify({ event: "auth.cloudflare.refresh_error", error: err?.message }));
    return error("Authentication service error", 503, "db_error");
  }
}

export async function handleAuthSwitchTenant(request, env) {
  const authResult = await requireAuth(request, env, verifyJwt);
  if (authResult instanceof Response) return authResult;
  const parsed = await readBoundedJson(request);
  if (parsed.response) return parsed.response;
  const body = parsed.data;
  if (!body?.tenant_id || typeof body.tenant_id !== "string") return error("tenant_id required", 400, "missing_tenant_id");
  try {
    const snapshot = await createCloudflareIdentityStore(env).getAuthSnapshot(authResult.claims.sub, body.tenant_id);
    const accessToken = await makeAccessToken(snapshot.user, snapshot.tenant, snapshot.tenantIds, env);
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.append("Set-Cookie", `immi_access=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ACCESS_MAX_AGE}`);
    return new Response(JSON.stringify({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_MAX_AGE,
      tenant: snapshot.tenant,
      tenants: snapshot.tenants,
    }), { status: 200, headers });
  } catch (err) {
    if (clientError(err)) return error(err.message, err.status, err.code);
    console.error(JSON.stringify({ event: "auth.cloudflare.switch_tenant_error", error: err?.message }));
    return error("Authentication service error", 503, "db_error");
  }
}
