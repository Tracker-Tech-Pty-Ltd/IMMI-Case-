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
import {
  withAuthCookieLock,
  getSharedRefreshRotationId,
  clearSharedRefreshRotationId,
  fetchAuthJson,
} from "@/lib/auth-cookie-coordination";

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
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
  const accessTokenRef = useRef<string | null>(null);

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
    accessTokenRef.current = null;
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
    try {
      return await withAuthCookieLock(async () => {
        const activeTenantId = activeTenantIdRef.current ?? readStoredTenantId();
        // Another tab may have renewed the cookie while this one waited for
        // the lock. Adopt that result instead of consuming the cookie again.
        const { response: me, data: current } = await fetchAuthJson<RefreshResponseBody>(
          "/api/v1/auth/me", { credentials: "include" },
        );
        let data: RefreshResponseBody | null = null;
        let rotated = false;
        if (me.ok && current) {
          const payload = current.access_token ? parseJwtPayload(current.access_token) : null;
          if (
            current.access_token && current.access_token !== accessTokenRef.current &&
            typeof payload?.exp === "number" && payload.exp * 1000 > Date.now() + 60_000 &&
            (!activeTenantId || current.tenant?.id === activeTenantId)
          ) data = current;
        } else if (me.status !== 401 && me.status !== 403) {
          throw new Error("Session status is temporarily unavailable");
        }

        if (!data) {
          rotationIdRef.current = getSharedRefreshRotationId(rotationIdRef.current ?? newRotationId());
          const headers: Record<string, string> = { "X-Refresh-Rotation-Id": rotationIdRef.current };
          if (activeTenantId) headers["X-Active-Tenant-Id"] = activeTenantId;
          const { response: res, data: renewed } = await fetchAuthJson<RefreshResponseBody>("/api/v1/auth/refresh", {
            method: "POST",
            credentials: "include",
            headers,
          });
          if (!res.ok) {
            if (isTransientRefreshStatus(res.status) && scheduleRefreshRetry()) return false;
            clearSharedRefreshRotationId();
            rotationIdRef.current = null;
            clearSession();
            return false;
          }
          data = renewed;
          rotated = true;
        }

        if (!data?.access_token) throw new Error("Refresh response is missing an access token");
        // /me proves only that the ACCESS cookie changed. A tenant switch
        // can do that without replacing the refresh cookie whose earlier
        // rotation response was lost, so only a successful rotation clears
        // the shared retry id.
        if (rotated) clearSharedRefreshRotationId();
        refreshRetryCountRef.current = 0;
        rotationIdRef.current = null;
        if (data.tenant?.id) {
          activeTenantIdRef.current = data.tenant.id;
          storeTenantId(data.tenant.id);
        }
        const snapshot = data;
        setState((s) => ({
          ...s,
          accessToken: snapshot.access_token ?? null,
          user: snapshot.user ?? s.user,
          tenant: snapshot.tenant ?? s.tenant,
          tenants: snapshot.tenants ?? s.tenants,
          isAuthenticated: true,
        }));
        accessTokenRef.current = data.access_token;
        setApiAccessToken(accessTokenRef.current);
        scheduleRefresh(data.access_token);
        return true;
      });
    } catch {
      // Coordination and network failures never fall back to an unlocked
      // POST. A rotation may already have committed, so retries keep its id.
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
            accessTokenRef.current = data.access_token;
            scheduleRefresh(data.access_token);
            return;
          }
        } else if (r.status === 401) {
          // Access cookie expired — try silent refresh before giving up.
          const refreshed = await refresh();
          if (refreshed) {
            // runRefresh committed one complete identity/token snapshot while
            // holding the lock. A cookie-only /me here could read another
            // tab's later workspace switch and split that snapshot again.
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
      await withAuthCookieLock(async () => {
        const { response: res, data } = await fetchAuthJson<RefreshResponseBody & { error?: string }>("/api/v1/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(telegramData),
        });
        if (!res.ok || !data?.access_token) throw new Error(data?.error || "Login failed");
        clearSharedRefreshRotationId();
        refreshRetryCountRef.current = 0;
        rotationIdRef.current = null;
        if (data.tenant?.id) {
          activeTenantIdRef.current = data.tenant.id;
          storeTenantId(data.tenant.id);
        }
        setState({
          user: data.user ?? null,
          tenant: data.tenant ?? null,
          tenants: data.tenants ?? (data.tenant ? [data.tenant] : []),
          accessToken: data.access_token,
          isAuthenticated: true,
          isLoading: false,
        });
        setApiAccessToken(data.access_token);
        accessTokenRef.current = data.access_token;
        scheduleRefresh(data.access_token);
      });
    },
    [scheduleRefresh],
  );

  const logout = useCallback(async () => {
    // The server keeps the refresh cookie when revocation fails, so a failed
    // sign-out is retryable — but only if we surface it. Dropping local state
    // regardless would leave the session live server-side while the UI claims
    // the user is signed out, with nothing left to press.
    await withAuthCookieLock(async () => {
      const result = await fetchAuthJson("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
      }).catch(() => null);
      if (!result?.response.ok) throw new Error("Sign out failed. Please try again.");
      clearSharedRefreshRotationId();
      clearAuthCookies();
      clearTimeout(refreshTimerRef.current);
      setApiAccessToken(null);
      accessTokenRef.current = null;
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
    });
  }, []);

  const switchTenant = useCallback(
    async (tenantId: string) => {
      await withAuthCookieLock(async () => {
        const { response: res, data } = await fetchAuthJson<RefreshResponseBody>("/api/v1/auth/switch-tenant", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessTokenRef.current}`,
          },
          credentials: "include",
          body: JSON.stringify({ tenant_id: tenantId }),
        });
        if (!res.ok || !data?.access_token) throw new Error("Failed to switch tenant");
        // Cancel old-tenant reads before dropping their cached data.
        await queryClient.cancelQueries();
        queryClient.clear();
        if (data.tenant?.id) {
          activeTenantIdRef.current = data.tenant.id;
          storeTenantId(data.tenant.id);
        }
        setState((s) => ({
          ...s,
          tenant: data.tenant ?? s.tenant,
          tenants: data.tenants ?? s.tenants,
          accessToken: data.access_token ?? null,
        }));
        if (data.access_token) {
          setApiAccessToken(data.access_token);
          accessTokenRef.current = data.access_token;
          scheduleRefresh(data.access_token);
        }
      });
    },
    [scheduleRefresh],
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
