// Auth utilities — token management and type definitions

export interface AuthUser {
  id: string;
  telegram_id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
  role?: "owner" | "member" | "admin" | string;
}

export interface AuthTenant {
  id: string;
  kind: "individual" | "organization";
  name: string;
}

export interface AuthState {
  user: AuthUser | null;
  tenant: AuthTenant | null;
  tenants: AuthTenant[];
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * Auth cookies (immi_access, immi_refresh) are HttpOnly — JS cannot read them.
 * The Worker reads them server-side; the client receives tokens only from response bodies.
 * Logout endpoint clears cookies server-side via Max-Age=0 Set-Cookie headers.
 */
export function clearAuthCookies(): void {
  // No-op: HttpOnly cookies cannot be cleared from JS.
  // The /api/v1/auth/logout endpoint clears them via Set-Cookie headers.
}

/** Parse JWT payload (base64url decode, no verification — Worker already verified) */
export function parseJwtPayload(
  token: string,
): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    // Restore base64 padding — atob throws on non-multiple-of-4 lengths
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/** Check if token is expired (with 30s buffer) */
export function isTokenExpired(token: string): boolean {
  const payload = parseJwtPayload(token);
  if (!payload || typeof payload.exp !== "number") return true;
  return payload.exp < Date.now() / 1000 + 30;
}
