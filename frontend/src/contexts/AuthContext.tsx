import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import type { AuthState, AuthTenant, AuthUser } from "@/lib/auth";
import { clearAuthCookies, parseJwtPayload } from "@/lib/auth";
import { setApiAccessToken } from "@/lib/api";
import { queryClient } from "@/lib/query-client";

/** Backoff for transient refresh failures (network down, sleep/wake, Worker
 *  cold start). After the last one is exhausted we sign the user out for real
 *  rather than leaving a UI that renders as signed-in against 401ing APIs. */
const REFRESH_RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

/** Survives a reload so a switched workspace is not lost with the access cookie. */
const ACTIVE_TENANT_STORAGE_KEY = "immi:auth:active-tenant";

function readStoredTenantId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_TENANT_STORAGE_KEY);
  } catch {
    return null; // private mode / disabled storage
  }
}

function storeTenantId(tenantId: string | null): void {
  try {
    if (tenantId) window.localStorage.setItem(ACTIVE_TENANT_STORAGE_KEY, tenantId);
    else window.localStorage.removeItem(ACTIVE_TENANT_STORAGE_KEY);
  } catch {
    // Non-fatal: the tenant simply falls back to the default next reload.
  }
}

function newRotationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // randomUUID needs a secure context; a non-crypto id is still fine here
    // because this value only has to be unique per client, not unguessable
    // to us — the server never treats it as a credential on its own.
    return `${Date.now().toString(16)}-0000-4000-8000-${Math.floor(Math.random() * 1e12).toString(16).padStart(12, "0")}`.slice(0, 36);
  }
}

interface RefreshResponseBody {
  access_token?: string;
  user?: AuthUser | null;
  tenant?: AuthTenant | null;
  tenants?: AuthTenant[] | null;
}

interface AuthContextValue extends AuthState {
  login: (telegramData: Record<string, string>) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  switchTenant: (tenantId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    tenant: null,
    tenants: [],
    accessToken: null,
    isAuthenticated: false,
    isLoading: true,
  });

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refreshRef = useRef<(() => Promise<boolean>) | null>(null);

  const refreshRetryCountRef = useRef(0);

  /** Idempotency stamp for one logical rotation; survives its retries. */
  const rotationIdRef = useRef<string | null>(null);

  /** Single-flight guard so two triggers cannot race one refresh cookie. */
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);

  const activeTenantIdRef = useRef<string | null>(null);

  const scheduleRefresh = useCallback((token: string) => {
    const payload = parseJwtPayload(token);
    if (!payload || typeof payload.exp !== "number") return;
    const msUntilExpiry = payload.exp * 1000 - Date.now();
    const refreshIn = Math.max(msUntilExpiry - 60_000, 0); // refresh 1min before expiry
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => { refreshRef.current?.(); }, refreshIn);
  }, []);

  const clearSession = useCallback(() => {
    refreshRetryCountRef.current = 0;
    rotationIdRef.current = null;
    activeTenantIdRef.current = null;
    storeTenantId(null);
    // Server-derived data is tenant-scoped; leaving it cached would serve the
    // signed-out user's rows to whoever signs in next in this tab.
    queryClient.clear();
    setState((s) => ({
      ...s,
      user: null,
      tenant: null,
      tenants: [],
      accessToken: null,
      isAuthenticated: false,
    }));
    clearAuthCookies();
    setApiAccessToken(null);
  }, []);

  /** Transient = worth retrying. A 401/403 means the refresh cookie is gone. */
  const isTransientRefreshStatus = (status: number) =>
    status === 429 || status >= 500;

  const scheduleRefreshRetry = useCallback((): boolean => {
    const attempt = refreshRetryCountRef.current;
    if (attempt >= REFRESH_RETRY_DELAYS_MS.length) return false;
    refreshRetryCountRef.current = attempt + 1;
    // Reuse refreshTimerRef so the existing unmount cleanup still clears it.
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshRef.current?.();
    }, REFRESH_RETRY_DELAYS_MS[attempt]);
    return true;
  }, []);

  const runRefresh = useCallback(async (): Promise<boolean> => {
    // A refresh POST consumes the presented token, so a retry after a lost
    // response replays an already-rotated one and the server reads that as
    // theft — a transient blip would revoke the whole family. Stamping the
    // logical rotation and reusing that stamp across retries lets the server
    // recognise the retry as the same rotation and re-serve its successor.
    if (!rotationIdRef.current) rotationIdRef.current = newRotationId();
    const headers: Record<string, string> = {
      "X-Refresh-Rotation-Id": rotationIdRef.current,
    };
    // Without this the server picks the first membership and silently reverts
    // a workspace switch on the next silent refresh.
    const activeTenantId = activeTenantIdRef.current ?? readStoredTenantId();
    if (activeTenantId) headers["X-Active-Tenant-Id"] = activeTenantId;
    try {
      const res = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include", // sends httpOnly refresh cookie
        headers,
      });
      if (!res.ok) {
        // A cold-starting or rate-limited Worker must not end the session.
        if (isTransientRefreshStatus(res.status) && scheduleRefreshRetry()) {
          return false;
        }
        rotationIdRef.current = null;
        clearSession();
        return false;
      }
      const data: RefreshResponseBody = await res.json();
      refreshRetryCountRef.current = 0;
      rotationIdRef.current = null;
      if (data.tenant?.id) {
        activeTenantIdRef.current = data.tenant.id;
        storeTenantId(data.tenant.id);
      }
      setState((s) => ({
        ...s,
        accessToken: data.access_token ?? null,
        // The refresh response now carries the identity, so a client that
        // recovered from a failed bootstrap is not left signed-in with a
        // null user. Keep whatever we already had when it does not.
        user: data.user ?? s.user,
        tenant: data.tenant ?? s.tenant,
        tenants: data.tenants ?? s.tenants,
        isAuthenticated: true,
      }));
      setApiAccessToken(data.access_token ?? null);
      if (data.access_token) scheduleRefresh(data.access_token);
      return true;
    } catch {
      // No HTTP status at all (offline, DNS, TLS). The rotation may or may not
      // have committed, which is exactly why rotationIdRef is kept: the retry
      // must be the *same* rotation, never a fresh one.
      if (scheduleRefreshRetry()) return false;
      rotationIdRef.current = null;
      clearSession();
      return false;
    }
  }, [clearSession, scheduleRefreshRetry, scheduleRefresh]);

  /**
   * Single-flight. The proactive expiry timer and a 401-driven recovery can
   * fire together; two concurrent POSTs both present the same cookie, one
   * loses the server's compare-and-swap, and the loser's family is revoked.
   */
  const refresh = useCallback((): Promise<boolean> => {
    if (!refreshInFlightRef.current) {
      refreshInFlightRef.current = runRefresh().finally(() => {
        refreshInFlightRef.current = null;
      });
    }
    return refreshInFlightRef.current;
  }, [runRefresh]);
  // Keep refreshRef current so scheduleRefresh always calls the latest refresh.
  React.useLayoutEffect(() => { refreshRef.current = refresh; });

  // On mount: restore auth via httpOnly cookie (browser sends it automatically).
  // Access token comes from the response body — JS cannot read HttpOnly cookies.
  // If the access cookie is expired (401) but the refresh cookie is still valid,
  // fall back to /auth/refresh so users stay signed in across the 5-min access TTL.
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/v1/auth/me", { credentials: "include" });
        if (r.ok) {
          const data = await r.json();
          if (data?.access_token) {
            if (data.tenant?.id) {
              activeTenantIdRef.current = data.tenant.id;
              storeTenantId(data.tenant.id);
            }
            setState({
              user: data.user,
              tenant: data.tenant,
              tenants: data.tenants || [],
              accessToken: data.access_token,
              isAuthenticated: true,
              isLoading: false,
            });
            setApiAccessToken(data.access_token);
            scheduleRefresh(data.access_token);
            return;
          }
        } else if (r.status === 401) {
          // Access cookie expired — try silent refresh before giving up.
          const refreshed = await refresh();
          if (refreshed) {
            // The refresh response carries only access_token; re-read /auth/me
            // so user/tenant/tenants are populated. Without this the app runs
            // as `isAuthenticated: true` with a null user.
            const me = await fetch("/api/v1/auth/me", {
              credentials: "include",
            }).catch(() => null);
            if (me?.ok) {
              const meData = await me.json().catch(() => null);
              if (meData?.user) {
                setState((s) => ({
                  ...s,
                  user: meData.user,
                  tenant: meData.tenant,
                  tenants: meData.tenants || [],
                  isLoading: false,
                }));
                return;
              }
            }
            setState((s) => ({ ...s, isLoading: false }));
            return;
          }
        }
      } catch {
        // network error — fall through to unauthenticated state
      }
      setState((s) => ({ ...s, isLoading: false }));
    })();
    return () => clearTimeout(refreshTimerRef.current);
  }, [scheduleRefresh, refresh]);

  const login = useCallback(
    async (telegramData: Record<string, string>) => {
      const res = await fetch("/api/v1/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(telegramData),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || "Login failed");
      }
      const data = await res.json();
      if (data.tenant?.id) {
        activeTenantIdRef.current = data.tenant.id;
        storeTenantId(data.tenant.id);
      }
      setState({
        user: data.user,
        tenant: data.tenant,
        tenants: data.tenants || [data.tenant],
        accessToken: data.access_token,
        isAuthenticated: true,
        isLoading: false,
      });
      if (data.access_token) {
        setApiAccessToken(data.access_token);
        scheduleRefresh(data.access_token);
      }
    },
    [scheduleRefresh],
  );

  const logout = useCallback(async () => {
    // The server keeps the refresh cookie when revocation fails, so a failed
    // sign-out is retryable — but only if we surface it. Dropping local state
    // regardless would leave the session live server-side while the UI claims
    // the user is signed out, with nothing left to press.
    const res = await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => null);
    if (res && !res.ok) {
      throw new Error("Sign out failed. Please try again.");
    }
    clearAuthCookies();
    clearTimeout(refreshTimerRef.current);
    setApiAccessToken(null);
    rotationIdRef.current = null;
    activeTenantIdRef.current = null;
    storeTenantId(null);
    queryClient.clear();
    setState({
      user: null,
      tenant: null,
      tenants: [],
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, []);

  const switchTenant = useCallback(
    async (tenantId: string) => {
      const res = await fetch("/api/v1/auth/switch-tenant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.accessToken}`,
        },
        credentials: "include",
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      if (!res.ok) throw new Error("Failed to switch tenant");
      const data = await res.json();
      // Every server-derived cache entry belongs to the tenant that was active
      // when it was fetched. Cancel first so a slow in-flight response for the
      // old workspace cannot land after the swap, then drop the entries — the
      // Council list is private per tenant and was rendering across the switch.
      await queryClient.cancelQueries();
      queryClient.clear();
      if (data.tenant?.id) {
        activeTenantIdRef.current = data.tenant.id;
        storeTenantId(data.tenant.id);
      }
      setState((s) => ({
        ...s,
        tenant: data.tenant,
        tenants: data.tenants ?? s.tenants,
        accessToken: data.access_token,
      }));
      if (data.access_token) {
        setApiAccessToken(data.access_token);
        scheduleRefresh(data.access_token);
      }
    },
    [state.accessToken, scheduleRefresh],
  );

  return (
    <AuthContext.Provider
      value={{ ...state, login, logout, refresh, switchTenant }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
