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

  const scheduleRefresh = useCallback((token: string) => {
    const payload = parseJwtPayload(token);
    if (!payload || typeof payload.exp !== "number") return;
    const msUntilExpiry = payload.exp * 1000 - Date.now();
    const refreshIn = Math.max(msUntilExpiry - 60_000, 0); // refresh 1min before expiry
    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => refresh(), refreshIn);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "include", // sends httpOnly refresh cookie
      });
      if (!res.ok) {
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
        return false;
      }
      const data = await res.json();
      setState((s) => ({
        ...s,
        accessToken: data.access_token,
        isAuthenticated: true,
      }));
      setApiAccessToken(data.access_token ?? null);
      scheduleRefresh(data.access_token);
      return true;
    } catch {
      return false;
    }
  }, [scheduleRefresh]);

  // On mount: restore auth via httpOnly cookie (browser sends it automatically).
  // Access token comes from the response body — JS cannot read HttpOnly cookies.
  useEffect(() => {
    fetch("/api/v1/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
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
        } else {
          setState((s) => ({ ...s, isLoading: false }));
        }
      })
      .catch(() => setState((s) => ({ ...s, isLoading: false })));
    return () => clearTimeout(refreshTimerRef.current);
  }, [scheduleRefresh]);

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

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
