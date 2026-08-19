const CSRF_TTL_MS = 60 * 60 * 1000;
const CSRF_COOKIE = "__Host-csrf";

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value) {
  let text = value.replace(/-/g, "+").replace(/_/g, "/");
  while (text.length % 4) text += "=";
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function getCsrfToken(env) {
  if (!env.CSRF_SECRET) return Response.json({ error: "csrf_secret_not_configured", code: "csrf_secret_not_configured" }, { status: 503 });
  const random = crypto.getRandomValues(new Uint8Array(16));
  const randomHex = [...random].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const payload = randomHex + "." + (Date.now() + CSRF_TTL_MS);
  const signature = await crypto.subtle.sign("HMAC", await importHmacKey(env.CSRF_SECRET), new TextEncoder().encode(payload));
  const token = b64url(new TextEncoder().encode(payload)) + "." + b64url(signature);
  return new Response(JSON.stringify({ csrf_token: token }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": CSRF_COOKIE + "=" + token + "; Path=/; SameSite=Lax; Secure; Max-Age=" + (CSRF_TTL_MS / 1000),
      "Cache-Control": "no-store",
    },
  });
}

export async function verifyCsrf(request, env) {
  if (!env.CSRF_SECRET) return Response.json({ error: "csrf_secret_not_configured", code: "csrf_secret_not_configured" }, { status: 503 });
  const header = request.headers.get("X-CSRF-Token") || request.headers.get("X-CSRFToken");
  const cookie = (request.headers.get("Cookie") || "").split(/;\s*/).find((item) => item.startsWith(CSRF_COOKIE + "="))?.slice(CSRF_COOKIE.length + 1);
  if (!header || !cookie || header !== cookie) return Response.json({ error: "csrf", code: "csrf" }, { status: 403 });
  const parts = header.split(".");
  const payloadB64 = parts[0];
  const signatureB64 = parts[1];
  if (!payloadB64 || !signatureB64) return Response.json({ error: "csrf", code: "csrf" }, { status: 403 });
  const payload = new TextDecoder().decode(b64urlDecode(payloadB64));
  const expiry = Number(payload.split(".")[1]);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return Response.json({ error: "csrf_expired", code: "csrf_expired" }, { status: 403 });
  const valid = await crypto.subtle.verify("HMAC", await importHmacKey(env.CSRF_SECRET), b64urlDecode(signatureB64), new TextEncoder().encode(payload));
  return valid ? null : Response.json({ error: "csrf", code: "csrf" }, { status: 403 });
}
