import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

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
  ctx = useAuth();
  return <div data-testid="is-auth">{String(ctx.isAuthenticated)}</div>;
}

let fetchMock: ReturnType<typeof vi.fn>;

function refreshCalls(): number {
  return fetchMock.mock.calls.filter(([u]: [unknown]) =>
    String(u).includes("/auth/refresh"),
  ).length;
}

function meCalls(): number {
  return fetchMock.mock.calls.filter(([u]: [unknown]) =>
    String(u).includes("/auth/me"),
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
