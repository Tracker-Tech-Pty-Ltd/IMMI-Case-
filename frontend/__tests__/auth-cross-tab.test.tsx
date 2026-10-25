import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { localStorageFailures } from "./legislations-setup";

function token(tenant = "t1", generation = 1): string {
  return `hdr.${btoa(JSON.stringify({ sub: "u1", tenant_id: tenant, exp: Math.floor(Date.now() / 1000) + 300, generation }))}.sig`;
}

function identity(accessToken: string, tenant = "t1") {
  return { access_token: accessToken, user: { id: "u1" }, tenant: { id: tenant }, tenants: [{ id: "t1" }, { id: "t2" }] };
}

function response(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

function installLocks() {
  let tail = Promise.resolve();
  const request = vi.fn((_name: string, _options: unknown, callback: () => Promise<unknown>) => {
    const result = tail.then(callback);
    tail = result.then(() => undefined, () => undefined);
    return result;
  });
  vi.stubGlobal("navigator", { locks: { request } });
  return request;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

describe("auth shared-cookie coordination", () => {
  beforeEach(() => { installLocks(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("two tabs renew one shared cookie once and both adopt the successor", async () => {
    let current = token();
    const successor = token("t1", 2);
    let refreshes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/me")) return response(identity(current));
      if (url.endsWith("/refresh")) {
        refreshes++;
        if (refreshes > 1) return response({ code: "revoked_refresh_token" }, 401);
        current = successor;
        return response(identity(current));
      }
      throw new Error(`Unexpected ${url}`);
    }));
    const a = renderHook(() => useAuth(), { wrapper: AuthProvider });
    const b = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flush();
    let results: boolean[] = [];
    await act(async () => { results = await Promise.all([a.result.current.refresh(), b.result.current.refresh()]); });
    expect(refreshes).toBe(1);
    expect(results).toEqual([true, true]);
    expect(a.result.current.accessToken).toBe(successor);
    expect(b.result.current.accessToken).toBe(successor);
  });

  it("a second tab retries a lost rotation response with the same rotation id", async () => {
    const original = token();
    const ids: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/me")) return response(identity(original));
      const id = (init?.headers as Record<string, string>)["X-Refresh-Rotation-Id"];
      ids.push(id);
      if (ids.length === 1) throw new TypeError("Response lost after rotation committed");
      return response(identity(token("t1", 2)));
    }));
    const a = renderHook(() => useAuth(), { wrapper: AuthProvider });
    const b = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flush();
    await act(async () => { expect(await a.result.current.refresh()).toBe(false); });
    await act(async () => { expect(await b.result.current.refresh()).toBe(true); });
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
  });

  it.each(["unsupported", "rejected", "storage"])("does not POST an uncoordinated refresh when coordination is %s", async (mode) => {
    const original = token();
    const fetchMock = vi.fn<(url: string) => Promise<Response>>().mockResolvedValue(response(identity(original)));
    vi.stubGlobal("fetch", fetchMock);
    const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flush();
    if (mode === "unsupported") vi.stubGlobal("navigator", {});
    if (mode === "rejected") vi.stubGlobal("navigator", { locks: { request: vi.fn().mockRejectedValue(new Error("Lock denied")) } });
    if (mode === "storage") localStorageFailures.setItem = true;
    await act(async () => { expect(await hook.result.current.refresh()).toBe(false); });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/refresh"))).toBe(false);
    expect(hook.result.current.isAuthenticated).toBe(true);
  });

  it("serializes a workspace change behind a pending refresh", async () => {
    const original = token();
    let finishRefresh: ((value: Response) => void) | undefined;
    const switches: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/me")) return response(identity(original));
      if (url.endsWith("/refresh")) return new Promise<Response>((resolve) => { finishRefresh = resolve; });
      if (url.endsWith("/switch-tenant")) {
        switches.push(JSON.parse(String(init?.body)).tenant_id);
        return response(identity(token("t2", 3), "t2"));
      }
      throw new Error(`Unexpected ${url}`);
    }));
    const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flush();
    let refreshing: Promise<boolean>;
    act(() => { refreshing = hook.result.current.refresh(); });
    await flush();
    let switching: Promise<void>;
    act(() => { switching = hook.result.current.switchTenant("t2"); });
    await flush();
    expect(switches).toEqual([]);
    await act(async () => { finishRefresh!(response(identity(token("t1", 2)))); await refreshing!; await switching!; });
    expect(switches).toEqual(["t2"]);
    expect(hook.result.current.tenant?.id).toBe("t2");
  });

  it("preserves the selected workspace when another tab's cookie belongs to a different one", async () => {
    const original = token();
    let current = identity(original);
    const refreshTenants: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/me")) return response(current);
      const tenant = (init?.headers as Record<string, string>)["X-Active-Tenant-Id"];
      refreshTenants.push(tenant);
      current = identity(token(tenant, 3), tenant);
      return response(current);
    }));
    const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flush();
    current = identity(token("t2", 2), "t2");
    await act(async () => { await hook.result.current.refresh(); });
    expect(refreshTenants).toEqual(["t1"]);
    expect(hook.result.current.tenant?.id).toBe("t1");
  });

  it("keeps logout retryable when the network rejects the request", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/me")) return response(identity(token()));
      throw new TypeError("Offline");
    }));
    const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flush();
    await act(async () => { await expect(hook.result.current.logout()).rejects.toThrow(/try again/i); });
    expect(hook.result.current.isAuthenticated).toBe(true);
  });

  it("keeps bootstrap identity paired with its refreshed token across a different tab's workspace switch", async () => {
    const own = identity(token("t1", 2));
    let meCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/me")) {
        meCalls++;
        return meCalls <= 2 ? response({}, 401) : response(identity(token("t2", 3), "t2"));
      }
      return response(own);
    }));
    const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flush();
    expect(hook.result.current.isLoading).toBe(false);
    expect(hook.result.current.accessToken).toBe(own.access_token);
    expect(hook.result.current.tenant?.id).toBe("t1");
    expect(meCalls).toBe(2);
  });

  it("aborts a stuck auth response body and releases the lock for logout", async () => {
    vi.useFakeTimers();
    const original = token();
    let meCalls = 0;
    let aborted = false;
    let logouts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/logout")) { logouts++; return response({ ok: true }); }
      if (url.endsWith("/me") && ++meCalls === 1) return response(identity(original));
      return {
        ok: true, status: 200,
        json: () => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      } as Response;
    }));
    const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flush();
    let refreshing: Promise<boolean>;
    let signingOut: Promise<void>;
    act(() => { refreshing = hook.result.current.refresh(); });
    await flush();
    act(() => { signingOut = hook.result.current.logout(); });
    await flush();
    expect(logouts).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_001); });
    expect(aborted).toBe(true);
    await act(async () => { await refreshing!; await signingOut!; });
    expect(logouts).toBe(1);
    expect(hook.result.current.isAuthenticated).toBe(false);
  });

  it("serializes login behind an in-flight refresh of the shared cookie", async () => {
    const original = token();
    let finishRefresh: ((value: Response) => void) | undefined;
    let logins = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/me")) return response(identity(original));
      if (url.endsWith("/refresh")) return new Promise<Response>((resolve) => { finishRefresh = resolve; });
      logins++;
      return response(identity(token("t1", 3)));
    }));
    const hook = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flush();
    let refreshing: Promise<boolean>;
    let signingIn: Promise<void>;
    act(() => { refreshing = hook.result.current.refresh(); });
    await flush();
    act(() => { signingIn = hook.result.current.login({ id: "123" }); });
    await flush();
    expect(logins).toBe(0);
    await act(async () => { finishRefresh!(response(identity(token("t1", 2)))); await refreshing!; await signingIn!; });
    expect(logins).toBe(1);
  });

  it("keeps a lost rotation's retry id when another tab changes only the access cookie", async () => {
    let current = identity(token());
    let generation = 1;
    const ids: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/me")) return response(current);
      if (url.endsWith("/switch-tenant")) {
        const tenant = JSON.parse(String(init?.body)).tenant_id;
        current = identity(token(tenant, ++generation), tenant);
        return response(current);
      }
      ids.push((init?.headers as Record<string, string>)["X-Refresh-Rotation-Id"]);
      if (ids.length === 1) throw new TypeError("Committed rotation response lost; old refresh cookie remains");
      current = identity(token("t1", ++generation));
      return response(current);
    }));
    const a = renderHook(() => useAuth(), { wrapper: AuthProvider });
    const b = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flush();
    await act(async () => { await b.result.current.switchTenant("t2"); });
    await act(async () => { expect(await a.result.current.refresh()).toBe(false); });
    await act(async () => { await b.result.current.switchTenant("t1"); });
    await act(async () => { expect(await a.result.current.refresh()).toBe(true); });
    expect(ids).toHaveLength(1); // /me adopted the new access cookie
    await act(async () => { expect(await a.result.current.refresh()).toBe(true); });
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });
});
