import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchStats, fetchTrends } from "@/lib/api";
import type { DashboardStats } from "@/types/case";

function jsonResponse<T>(data: T): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => data,
  } as Response;
}

const baseStats: DashboardStats = {
  total_cases: 149_016,
  with_full_text: 21_000,
  courts: { ARTA: 40_000 },
  years: { "2025": 1_000 },
  sources: { AustLII: 149_016 },
  natures: { Protection: 12_000 },
  visa_subclasses: { "866": 4_000 },
  recent_cases: [],
};

describe("dashboard api fallback", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("times out stats endpoint and auto-falls back to count endpoint", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/stats")) {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }
      if (url.includes("/api/v1/cases/count")) {
        return Promise.resolve(
          jsonResponse({ total: 321, count_mode: "planned" }),
        );
      }
      return Promise.reject(new Error(`Unexpected URL in test: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = fetchStats();
    await vi.advanceTimersByTimeAsync(12_500);
    const result = await resultPromise;

    expect(result.total_cases).toBe(321);
    expect(result.courts).toEqual({});
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/cases/count"),
      expect.any(Object),
    );

    vi.useRealTimers();
  });

  it("returns cached stats when later stats request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(baseStats))
      .mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchStats();
    const second = await fetchStats();

    expect(first.total_cases).toBe(149_016);
    expect(second).toMatchObject(first);
    expect(second.degraded).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns cached trends when trends endpoint fails", async () => {
    const initialTrends = { trends: [{ year: 2025, ARTA: 120 }] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(initialTrends))
      .mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchTrends();
    const second = await fetchTrends();

    expect(first).toEqual(initialTrends);
    expect(second).toEqual(initialTrends);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
