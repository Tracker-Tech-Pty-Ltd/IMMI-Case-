/**
 * AuthContext — behavioural tests for silent token refresh.
 *
 * Uses fake timers WITHOUT `shouldAdvanceTime`. That option was tried first
 * (it is the one adjustment this plan's Step 7 explicitly permits, for
 * @testing-library's waitFor(), which polls via a real setInterval that
 * plain fake timers never advance) but it introduces non-deterministic real
 * wall-clock drift into the fake clock — confirmed by instrumentation to be
 * the sole cause of intermittent 1ms-boundary assertion failures below, not
 * an AuthContext.tsx defect. flushUntil() below replaces waitFor with a
 * manual, explicit microtask-flush loop (`advanceTimersByTimeAsync(0)`
 * processes pending promise resolutions without moving the clock), so
 * Date.now() only ever changes when a test explicitly advances it — the
 * boundary test asserted exactly 0ms of drift across dozens of repeated
 * runs. This keeps every advance under deterministic test control, which is
 * the actual point of using fake timers here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import "../helpers/auth-lock";

/** Build a real, parseable JWT whose `exp` is `secondsFromNow` in the future. */
function makeToken(secondsFromNow: number): string {
  const payload = { exp: Math.floor(Date.now() / 1000) + secondsFromNow };
  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `hdr.${b64}.sig`;
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/**
 * Deterministic replacement for @testing-library's waitFor() under fake
 * timers: repeatedly flushes the microtask queue (without advancing the
 * clock) until `predicate` is true. Never consumes real wall-clock time, so
 * it introduces zero drift into subsequent boundary-precision advances.
 */
async function flushUntil(predicate: () => boolean, maxTicks = 50) {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  if (!predicate()) {
    throw new Error("flushUntil: predicate never became true within maxTicks");
  }
}

const ACCESS_TTL_SECONDS = 300; // matches the 5-min access token in production
// AuthContext.tsx:40 — setTimeout(..., Math.max(msUntilExpiry - 60_000, 0))
const REFRESH_FIRES_AFTER_MS = (ACCESS_TTL_SECONDS - 60) * 1000;
const FROZEN_NOW = new Date("2026-08-27T00:00:00.000Z");

let fetchMock: ReturnType<typeof vi.fn>;

function refreshCallCount() {
  return fetchMock.mock.calls.filter((c) =>
    String(c[0]).includes("/api/v1/auth/refresh"),
  ).length;
}

describe("AuthProvider silent refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Freeze the clock: scheduleRefresh computes payload.exp * 1000 - Date.now(),
    // so a live clock makes the armed delay drift and the boundary assertions
    // below meaningless.
    vi.setSystemTime(FROZEN_NOW);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("arms the refresh at exactly exp - 60s: nothing fires 1ms early, exactly one fires 1ms late", async () => {
    // Reading /me does not extend a token's lifetime; only refresh does.
    const initialToken = makeToken(ACCESS_TTL_SECONDS);
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/auth/me")) {
        return Promise.resolve(
          jsonResponse({
            user: { id: "u1" },
            tenant: { id: "t1" },
            tenants: [{ id: "t1" }],
            access_token: initialToken,
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({ access_token: makeToken(ACCESS_TTL_SECONDS) }),
      );
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flushUntil(() => result.current.isLoading === false);

    expect(refreshCallCount()).toBe(0);

    // 1 ms BEFORE the boundary: still zero. This is the half that a plain
    // "advance past it and assert >= 1" test cannot detect — a timer armed too
    // early (or at 0ms) would already have fired by here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_FIRES_AFTER_MS - 1);
    });
    expect(refreshCallCount()).toBe(0);

    // Cross the boundary by 2 ms: exactly one refresh, never a storm.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(refreshCallCount()).toBe(1);
  });

  it("falls back to a silent refresh when /auth/me returns 401, and ends authenticated-but-identityless", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/auth/me")) {
        return Promise.resolve(jsonResponse(null, 401));
      }
      return Promise.resolve(
        jsonResponse({ access_token: makeToken(ACCESS_TTL_SECONDS) }),
      );
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flushUntil(() => result.current.isLoading === false);
    expect(refreshCallCount()).toBe(1);

    // CHARACTERIZATION OF A DEFECT (AUTH-REFRESH-IDENTITY), not a specification.
    // AuthContext.tsx:65-68 sets isAuthenticated: true and the new accessToken,
    // but never refetches identity — so after this path the app is
    // "authenticated" with user === null and tenant === null. The whole snapshot
    // is pinned deliberately: when refresh() is fixed to re-fetch /auth/me (or
    // the endpoint is changed to return a full identity snapshot), THIS TEST
    // MUST FAIL and be updated in the same commit. Do not weaken it to
    // `expect(isAuthenticated).toBe(true)` — that would silently bless the bug.
    expect({
      isAuthenticated: result.current.isAuthenticated,
      user: result.current.user,
      tenant: result.current.tenant,
      tenants: result.current.tenants,
    }).toEqual({ isAuthenticated: true, user: null, tenant: null, tenants: [] });
  });

  it("logout clears the pending refresh timer", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/auth/me")) {
        return Promise.resolve(
          jsonResponse({
            user: { id: "u1" },
            tenant: { id: "t1" },
            tenants: [{ id: "t1" }],
            access_token: makeToken(ACCESS_TTL_SECONDS),
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flushUntil(() => result.current.isLoading === false);

    await act(async () => {
      await result.current.logout();
    });
    const afterLogout = refreshCallCount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_FIRES_AFTER_MS + 10);
    });

    expect(refreshCallCount()).toBe(afterLogout);
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("switchTenant updates the active tenant in context", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/auth/me")) {
        return Promise.resolve(
          jsonResponse({
            user: { id: "u1" },
            tenant: { id: "t1" },
            tenants: [{ id: "t1" }, { id: "t2" }],
            access_token: makeToken(ACCESS_TTL_SECONDS),
          }),
        );
      }
      if (String(url).includes("/auth/switch-tenant")) {
        return Promise.resolve(
          jsonResponse({
            tenant: { id: "t2" },
            access_token: makeToken(ACCESS_TTL_SECONDS),
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await flushUntil(() => result.current.isLoading === false);

    await act(async () => {
      await result.current.switchTenant("t2");
    });

    expect(result.current.tenant).toEqual({ id: "t2" });
  });
});
