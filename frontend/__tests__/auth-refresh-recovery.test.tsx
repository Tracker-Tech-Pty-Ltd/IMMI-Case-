import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import "./helpers/auth-lock";

// ---------------------------------------------------------------------------
// Synthetic JWT construction — same shape as __tests__/auth/auth-utils.test.ts.
// No real HMAC signing needed; parseJwtPayload never verifies signatures.
// ---------------------------------------------------------------------------

function encodeB64url(obj: object): string {
  const json = JSON.stringify(obj);
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeToken(payload: object): string {
  const header = encodeB64url({ alg: "HS256", typ: "JWT" });
  const pay = encodeB64url(payload);
  return `${header}.${pay}.fakesignature`;
}

function tokenFarFuture(): string {
  return makeToken({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 86_400 });
}

function meOk(token: string) {
  return Promise.resolve({
    ok: true,
    json: async () => ({
      user: { id: "u1", name: "Test User" },
      tenant: { id: "t1", name: "Tenant" },
      tenants: [{ id: "t1", name: "Tenant" }],
      access_token: token,
    }),
  });
}

// ---------------------------------------------------------------------------
// Probe — reads useAuth() and mirrors it into a mutable outer variable so
// tests can assert on the context object directly, not just rendered text.
// ---------------------------------------------------------------------------

let ctx: ReturnType<typeof useAuth> | null = null;

function Probe() {
  const value = useAuth();
  // Mirror into the outer variable inside an effect, not during render —
  // render must stay pure; a commit-time effect is the correct place for
  // this test-only side channel.
  useEffect(() => {
    ctx = value;
  });
  return <div data-testid="is-auth">{String(value.isAuthenticated)}</div>;
}

let fetchMock: ReturnType<typeof vi.fn>;

function refreshCalls(): number {
  return fetchMock.mock.calls.filter((call: unknown[]) =>
    String(call[0]).includes("/auth/refresh"),
  ).length;
}

function meCalls(): number {
  return fetchMock.mock.calls.filter((call: unknown[]) =>
    String(call[0]).includes("/auth/me"),
  ).length;
}

/** Flush pending microtask chains (fetch → json → setState → scheduleRefresh
 *  → …) without relying on real timers, which vi.useFakeTimers() disables. */
async function flush(rounds = 8) {
  await act(async () => {
    for (let i = 0; i < rounds; i++) {
      await Promise.resolve();
    }
  });
}

describe("AuthContext refresh recovery", () => {
  beforeEach(() => {
    ctx = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a network rejection on the exact 5s/15s/45s schedule, then signs out", async () => {
    const token = tokenFarFuture();
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) return meOk(token);
      if (u.includes("/auth/refresh")) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();
    expect(screen.getByTestId("is-auth").textContent).toBe("true");

    let firstResult: boolean | undefined;
    await act(async () => {
      firstResult = await ctx!.refresh();
    });
    expect(firstResult).toBe(false);
    expect(screen.getByTestId("is-auth").textContent).toBe("true");
    expect(refreshCalls()).toBe(1);

    // Each retry timer's callback observes Date.now() as its own due time
    // (verified empirically against this repo's vitest/@sinonjs fake-timer
    // setup, and boundaries are inclusive), so the three retries land at
    // exactly 5_000 / 20_000 / 65_000 elapsed ms from here. Approach each
    // boundary from one ms short (still-pending) then cross it (fires).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_999);
    });
    expect(refreshCalls()).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refreshCalls()).toBe(2); // fired at 5_000

    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(refreshCalls()).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refreshCalls()).toBe(3); // fired at 20_000 (5_000 + 15_000)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(44_999);
    });
    expect(refreshCalls()).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refreshCalls()).toBe(4); // fired at 65_000 (20_000 + 45_000)

    expect(screen.getByTestId("is-auth").textContent).toBe("false");
  });

  it("retries an HTTP 503 refresh and does NOT sign the user out", async () => {
    const token = tokenFarFuture();
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) return meOk(token);
      if (u.includes("/auth/refresh")) {
        return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();

    let result: boolean | undefined;
    await act(async () => {
      result = await ctx!.refresh();
    });
    expect(result).toBe(false);
    expect(screen.getByTestId("is-auth").textContent).toBe("true");
    expect(refreshCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_001);
    });
    expect(refreshCalls()).toBe(2);
    expect(screen.getByTestId("is-auth").textContent).toBe("true");
  });

  it("signs out immediately on an HTTP 401 refresh, with no retry", async () => {
    const token = tokenFarFuture();
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) return meOk(token);
      if (u.includes("/auth/refresh")) {
        return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();

    await act(async () => {
      await ctx!.refresh();
    });
    expect(screen.getByTestId("is-auth").textContent).toBe("false");

    const callsBeforeWait = refreshCalls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(refreshCalls()).toBe(callsBeforeWait);
  });

  it("resets the retry counter after a success", async () => {
    const token = tokenFarFuture();
    let refreshShouldFail = true;
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) return meOk(token);
      if (u.includes("/auth/refresh")) {
        if (refreshShouldFail) {
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return Promise.resolve({ ok: true, json: async () => ({ access_token: token }) });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();

    await act(async () => {
      await ctx!.refresh();
    });
    expect(screen.getByTestId("is-auth").textContent).toBe("true");

    refreshShouldFail = false;
    let successResult: boolean | undefined;
    await act(async () => {
      successResult = await ctx!.refresh();
    });
    expect(successResult).toBe(true);

    refreshShouldFail = true;
    await act(async () => {
      await ctx!.refresh();
    });
    await act(async () => {
      await ctx!.refresh();
    });
    await act(async () => {
      await ctx!.refresh();
    });
    // Three more failures after the reset — the pre-fix counter would have
    // signed out already; the reset means we are still short of exhaustion.
    expect(screen.getByTestId("is-auth").textContent).toBe("true");
  });

  it("populates the user after the bootstrap 401-then-refresh path", async () => {
    const token = tokenFarFuture();
    let meCallCount = 0;
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) {
        meCallCount += 1;
        if (meCallCount === 1) {
          return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
        }
        return meOk(token);
      }
      if (u.includes("/auth/refresh")) {
        return Promise.resolve({ ok: true, json: async () => ({ access_token: token }) });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();

    expect(ctx?.isAuthenticated).toBe(true);
    // Against the pre-fix code `user` stays null here — this is the defect.
    expect(ctx?.user).not.toBeNull();
  });

  it("keeps refresh referentially stable across renders, and the mount effect does not re-fire", async () => {
    const token = tokenFarFuture();
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) return meOk(token);
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();

    const first = ctx!.refresh;
    const meCallsBefore = meCalls();

    rerender(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();

    expect(ctx!.refresh).toBe(first);
    expect(meCalls()).toBe(meCallsBefore);
  });
});

// ---------------------------------------------------------------------------
// Rotation idempotency, tenant continuity, and sign-out.
//
// The suite above modelled a failed refresh as a side-effect-free rejection,
// so it stayed green even though the real Worker had already consumed the
// presented token by the time the response was lost. These exercise the
// server-visible consequence: what the retry actually puts on the wire.
// ---------------------------------------------------------------------------

function refreshHeaders(): Record<string, string>[] {
  return fetchMock.mock.calls
    .filter((call: unknown[]) => String(call[0]).includes("/auth/refresh"))
    .map((call: unknown[]) => {
      const init = call[1] as RequestInit | undefined;
      return (init?.headers ?? {}) as Record<string, string>;
    });
}

describe("AuthContext rotation idempotency", () => {
  beforeEach(() => {
    ctx = null;
    vi.useFakeTimers();
    try {
      window.localStorage.clear();
    } catch {
      /* storage disabled */
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a lost response under the SAME rotation id, not a fresh one", async () => {
    // The defect this pins: the Worker commits the rotation, the response is
    // lost, and a retry carrying a *new* rotation id is indistinguishable from
    // a stolen cookie — the server revokes the entire family and one network
    // blip signs the user out everywhere.
    const token = tokenFarFuture();
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) return meOk(token);
      if (u.includes("/auth/refresh")) {
        return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();

    await act(async () => {
      await ctx!.refresh();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_001);
    });

    const headers = refreshHeaders();
    expect(headers.length).toBeGreaterThanOrEqual(2);
    const ids = headers.map((h) => h["X-Refresh-Rotation-Id"]);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
  });

  it("starts a new rotation id once a refresh has actually succeeded", async () => {
    // The stamp must not outlive its rotation, or a later refresh would ask
    // the server to replay a successor that has since been consumed.
    const token = tokenFarFuture();
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) return meOk(token);
      if (u.includes("/auth/refresh")) {
        return Promise.resolve({ ok: true, json: async () => ({ access_token: token }) });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();

    await act(async () => {
      await ctx!.refresh();
    });
    await act(async () => {
      await ctx!.refresh();
    });

    const ids = refreshHeaders().map((h) => h["X-Refresh-Rotation-Id"]);
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it("collapses two concurrent refreshes into one POST", async () => {
    // Two POSTs presenting the same cookie means one loses the server's
    // compare-and-swap — and losing it now revokes the family.
    const token = tokenFarFuture();
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) return meOk(token);
      if (u.includes("/auth/refresh")) {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true, json: async () => ({ access_token: token }) }), 10);
        });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();

    const before = refreshCalls();
    await act(async () => {
      const both = Promise.all([ctx!.refresh(), ctx!.refresh()]);
      await vi.advanceTimersByTimeAsync(20);
      await both;
    });
    expect(refreshCalls() - before).toBe(1);
  });

  it("hydrates user and tenant from a refresh that recovers a failed bootstrap", async () => {
    // `/me` 401 → refresh 503 → scheduled retry succeeds. The old code set
    // isAuthenticated without ever re-reading /me, so the app ran with a null
    // user behind a signed-in shell.
    const token = tokenFarFuture();
    let refreshAttempts = 0;
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) {
        return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
      }
      if (u.includes("/auth/refresh")) {
        refreshAttempts += 1;
        if (refreshAttempts === 1) {
          return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            access_token: token,
            user: { id: "u1", name: "Test User" },
            tenant: { id: "t9", name: "Recovered" },
            tenants: [{ id: "t9", name: "Recovered" }],
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();
    expect(ctx?.isLoading).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_001);
    });
    await flush();

    expect(ctx?.isAuthenticated).toBe(true);
    expect(ctx?.user).not.toBeNull();
    expect(ctx?.tenant?.id).toBe("t9");
  });

  it("tells the server which workspace is active so a switch survives refresh", async () => {
    const token = tokenFarFuture();
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) return meOk(token);
      if (u.includes("/auth/refresh")) {
        return Promise.resolve({ ok: true, json: async () => ({ access_token: token }) });
      }
      if (u.includes("/auth/switch-tenant")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            access_token: token,
            tenant: { id: "t2", kind: "organization", name: "Team" },
            tenants: [
              { id: "t1", kind: "individual", name: "Tenant" },
              { id: "t2", kind: "organization", name: "Team" },
            ],
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();

    await act(async () => {
      await ctx!.switchTenant("t2");
    });
    await act(async () => {
      await ctx!.refresh();
    });

    const headers = refreshHeaders();
    expect(headers.at(-1)?.["X-Active-Tenant-Id"]).toBe("t2");
    expect(ctx?.tenant?.id).toBe("t2");
  });

  it("keeps the session when sign-out fails so the user can retry", async () => {
    // The server keeps the refresh cookie on a failed revoke. Clearing local
    // state anyway would leave the session live with nothing left to press.
    const token = tokenFarFuture();
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) return meOk(token);
      if (u.includes("/auth/logout")) {
        return Promise.resolve({ ok: false, status: 503, json: async () => ({ ok: false }) });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();
    expect(ctx?.isAuthenticated).toBe(true);

    await act(async () => {
      await expect(ctx!.logout()).rejects.toThrow(/try again/i);
    });
    expect(ctx?.isAuthenticated).toBe(true);
  });

  it("signs out locally when the server confirms the revocation", async () => {
    const token = tokenFarFuture();
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) return meOk(token);
      if (u.includes("/auth/logout")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await flush();

    await act(async () => {
      await ctx!.logout();
    });
    expect(ctx?.isAuthenticated).toBe(false);
    expect(ctx?.user).toBeNull();
  });
});
