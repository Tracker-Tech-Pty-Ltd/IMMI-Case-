/**
 * frontend/__tests__/tenant-cache-isolation.test.tsx
 *
 * TanStack Query caches server-derived data that is tenant-scoped on the
 * Worker side (`workers/llm-council/cloudflare_handlers.js` queries by
 * tenant_id). The cache itself has no tenant identity, so switching workspaces
 * used to leave the previous tenant's private Council sessions rendered under
 * the new one — a cross-tenant disclosure in the UI, not just a stale view.
 *
 * Also covers the identity-bleed shape on judge compare: `keepPreviousData`
 * on a query whose key *is* the identity of the thing displayed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import "./helpers/auth-lock";
import { queryClient } from "@/lib/query-client";
import { useJudgeCompare } from "@/hooks/use-judges";

const COUNCIL_KEY = ["council-sessions", undefined] as const;

function encodeB64url(obj: object): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function tokenFarFuture(): string {
  return `${encodeB64url({ alg: "HS256", typ: "JWT" })}.${encodeB64url({
    sub: "u1",
    exp: Math.floor(Date.now() / 1000) + 86_400,
  })}.sig`;
}

let ctx: ReturnType<typeof useAuth> | null = null;

function Probe() {
  const value = useAuth();
  useEffect(() => {
    ctx = value;
  });
  return null;
}

async function flush(rounds = 8) {
  await act(async () => {
    for (let i = 0; i < rounds; i++) await Promise.resolve();
  });
}

describe("tenant switching and the query cache", () => {
  beforeEach(() => {
    ctx = null;
    queryClient.clear();
    try {
      window.localStorage.clear();
    } catch {
      /* storage disabled */
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    queryClient.clear();
  });

  it("drops the previous workspace's cached Council sessions on switch", async () => {
    const token = tokenFarFuture();
    const fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            user: { id: "u1" },
            tenant: { id: "t1", kind: "individual", name: "Ada" },
            tenants: [
              { id: "t1", kind: "individual", name: "Ada" },
              { id: "t2", kind: "organization", name: "Team" },
            ],
            access_token: token,
          }),
        });
      }
      if (u.includes("/auth/switch-tenant")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            access_token: token,
            tenant: { id: "t2", kind: "organization", name: "Team" },
            tenants: [
              { id: "t1", kind: "individual", name: "Ada" },
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
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      </AuthProvider>,
    );
    await flush();

    // Tenant t1's private sessions, as a completed fetch would have left them.
    queryClient.setQueryData(COUNCIL_KEY, {
      sessions: [{ session_id: "s-private-to-t1", title: "Ada's matter" }],
    });
    expect(queryClient.getQueryData(COUNCIL_KEY)).toBeDefined();

    await act(async () => {
      await ctx!.switchTenant("t2");
    });

    // The binding assertion: t1's rows are gone, not merely marked stale.
    // A stale entry still renders while the refetch is in flight.
    expect(queryClient.getQueryData(COUNCIL_KEY)).toBeUndefined();
    expect(ctx?.tenant?.id).toBe("t2");
  });

  it("drops cached tenant data on sign-out", async () => {
    const token = tokenFarFuture();
    const fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/me")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            user: { id: "u1" },
            tenant: { id: "t1", kind: "individual", name: "Ada" },
            tenants: [{ id: "t1", kind: "individual", name: "Ada" }],
            access_token: token,
          }),
        });
      }
      if (u.includes("/auth/logout")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      </AuthProvider>,
    );
    await flush();

    queryClient.setQueryData(COUNCIL_KEY, { sessions: [{ session_id: "s1" }] });
    await act(async () => {
      await ctx!.logout();
    });
    expect(queryClient.getQueryData(COUNCIL_KEY)).toBeUndefined();
  });
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, fetchJudgeCompare: (...args: unknown[]) => compareMock(...args) };
});

const compareMock = vi.fn();

describe("useJudgeCompare identity", () => {
  beforeEach(() => {
    compareMock.mockReset();
    queryClient.clear();
  });

  it("does not show the previous pair's data while the new pair loads", async () => {
    // JudgeComparePage reads the names straight from the URL for its heading
    // but the cards from this query. Holding previous data attributes one
    // judge's record to another — not a cosmetic flash.
    compareMock.mockImplementation((names: string[]) =>
      Promise.resolve({ judges: names.map((name) => ({ name })) }),
    );
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, rerender } = renderHook(
      ({ names }: { names: string[] }) => useJudgeCompare(names),
      { wrapper, initialProps: { names: ["Smith", "Jones"] } },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(compareMock).toHaveBeenCalledWith(["Smith", "Jones"], expect.anything());

    // Never resolve the second pair, so the only thing that could appear is
    // the retained previous pair.
    compareMock.mockImplementation(() => new Promise(() => {}));
    rerender({ names: ["Lee", "Khan"] });

    expect(result.current.data).toBeUndefined();
  });
});
