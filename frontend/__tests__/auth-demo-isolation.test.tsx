import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { clearSharedRefreshRotationId, getSharedRefreshRotationId } from "@/lib/auth-cookie-coordination";

const TENANT_KEY = "immi:auth:active-tenant";
const ROTATION_KEY = "immi:auth:pending-rotation";
const ORIGINAL_ROTATION = "11111111-1111-4111-8111-111111111111";
const DEMO_ROTATION = "22222222-2222-4222-8222-222222222222";

function identity(tenantId: string) {
  const payload = btoa(JSON.stringify({ sub: "demo", tenant_id: tenantId, exp: Math.floor(Date.now() / 1000) + 3600 }));
  const tenant = { id: tenantId, name: "Example", kind: "individual" };
  return { access_token: `demo.${payload}.demo`, user: { id: "demo" }, tenant, tenants: [tenant] };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

describe("local Council demonstration authentication isolation", () => {
  const locks = vi.fn((_name: string, _opts: unknown, callback: () => Promise<unknown>) => callback());

  beforeEach(() => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_COUNCIL_DEMO", "true");
    vi.stubGlobal("navigator", { locks: { request: locks } });
    localStorage.setItem(TENANT_KEY, "real-workspace");
    localStorage.setItem(ROTATION_KEY, ORIGINAL_ROTATION);
    locks.mockClear();
  });

  afterEach(() => {
    localStorage.removeItem(TENANT_KEY);
    localStorage.removeItem(ROTATION_KEY);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not read, overwrite, or delete real workspace and rotation state during demo refresh and logout", async () => {
    const refreshHeaders: HeadersInit[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return json({}, 401);
      if (url.endsWith("/auth/refresh")) {
        refreshHeaders.push(init?.headers || {});
        return json(identity("demo"));
      }
      if (url.endsWith("/auth/logout")) return json({});
      throw new Error(`Unexpected path ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(hook.result.current.isAuthenticated).toBe(true));
    expect(hook.result.current.tenant?.id).toBe("demo");
    expect(refreshHeaders).toHaveLength(1);
    const headers = new Headers(refreshHeaders[0]);
    expect(headers.has("X-Active-Tenant-Id")).toBe(false);
    expect(headers.get("X-Refresh-Rotation-Id")).not.toBe(ORIGINAL_ROTATION);
    expect(localStorage.getItem(TENANT_KEY)).toBe("real-workspace");
    expect(localStorage.getItem(ROTATION_KEY)).toBe(ORIGINAL_ROTATION);
    expect(locks).toHaveBeenCalledWith("immi:auth:cookie-mutation:demo", { mode: "exclusive" }, expect.any(Function));

    await act(async () => { await hook.result.current.logout(); });
    expect(fetchMock.mock.calls.every(([, init]) => init?.credentials === "omit")).toBe(true);
    expect(localStorage.getItem(TENANT_KEY)).toBe("real-workspace");
    expect(localStorage.getItem(ROTATION_KEY)).toBe(ORIGINAL_ROTATION);
    hook.unmount();
  });

  it("keeps normal production-style tenant and rotation persistence even if the demo flag is set", async () => {
    vi.stubEnv("DEV", false);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(identity("normal-workspace")));
    vi.stubGlobal("fetch", fetchMock);
    const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(hook.result.current.isAuthenticated).toBe(true));
    expect(localStorage.getItem(TENANT_KEY)).toBe("normal-workspace");
    expect(fetchMock.mock.calls[0]?.[1]?.credentials).toBe("include");
    expect(getSharedRefreshRotationId(DEMO_ROTATION)).toBe(ORIGINAL_ROTATION);
    clearSharedRefreshRotationId();
    expect(localStorage.getItem(ROTATION_KEY)).toBeNull();
    hook.unmount();
  });
});
