import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import type { AuthState } from "@/lib/auth";
import { clearAuthCookies, parseJwtPayload } from "@/lib/auth";
import { setApiAccessToken } from "@/lib/api";

/** Backoff for transient refresh failures (network down, sleep/wake, Worker
 *  cold start). After the last one is exhausted we sign the user out for real
 *  rather than leaving a UI that renders as signed-in against 401ing APIs. */
const REFRESH_RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

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

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include", // sends httpOnly refresh cookie
      });
      if (!res.ok) {
        // A cold-starting or rate-limited Worker must not end the session.
        if (isTransientRefreshStatus(res.status) && scheduleRefreshRetry()) {
          return false;
        }
        clearSession();
        return false;
      }
      const data = await res.json();
      refreshRetryCountRef.current = 0;
      setState((s) => ({
        ...s,
        accessToken: data.access_token,
        isAuthenticated: true,
      }));
      setApiAccessToken(data.access_token ?? null);
      scheduleRefresh(data.access_token);
      return true;
    } catch {
      // No HTTP status at all (offline, DNS, TLS). Same policy as a 5xx.
      if (scheduleRefreshRetry()) return false;
      clearSession();
      return false;
    }
  }, [clearSession, scheduleRefreshRetry, scheduleRefresh]);
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
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
    clearAuthCookies();
    clearTimeout(refreshTimerRef.current);
    setApiAccessToken(null);
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
      setState((s) => ({
        ...s,
        tenant: data.tenant,
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
