/**
 * frontend/__tests__/query-cache-correctness.test.ts
 *
 * Regression tests for TanStack Query cache identity in the SPA data layer:
 *   - identity-keyed judge queries must NOT reuse the previous judge's payload
 *   - analytics query keys must cover every filter field that reaches the wire
 *   - filter-keyed list/count queries must keep previous data (anti-flash)
 */
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type {
  AnalyticsFilterParams,
  DashboardStats,
  JudgeBio,
  JudgeProfile,
} from "@/types/case";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    fetchJudgeProfile: vi.fn(),
    fetchJudgeBio: vi.fn(),
    fetchStats: vi.fn(),
    fetchCaseCount: vi.fn(),
  };
});

import * as api from "@/lib/api";
import { analyticsFilterKey } from "@/lib/api";
import { useJudgeProfile, useJudgeBio } from "@/hooks/use-judges";
import { useStats } from "@/hooks/use-stats";
import { useCaseCount } from "@/hooks/use-cases";

const mockFetchJudgeProfile = vi.mocked(api.fetchJudgeProfile);
const mockFetchJudgeBio = vi.mocked(api.fetchJudgeBio);
const mockFetchStats = vi.mocked(api.fetchStats);
const mockFetchCaseCount = vi.mocked(api.fetchCaseCount);

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

/** A promise that never settles — models a request still in flight. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

function makeProfile(name: string): JudgeProfile {
  return {
    judge: {
      name,
      total_cases: 10,
      courts: ["FCA"],
      active_years: { first: 2010, last: 2024 },
    },
    approval_rate: 40,
    court_type: "court",
    outcome_distribution: {},
    visa_breakdown: [],
    concept_effectiveness: [],
    yearly_trend: [],
    nature_breakdown: [],
    representation_analysis: { unknown_count: 0 },
    country_breakdown: [],
    court_comparison: [],
    recent_3yr_trend: [],
  };
}

function makeBio(fullName: string): JudgeBio {
  return { found: true, full_name: fullName, photo_url: "https://example.test/a.jpg" };
}

function makeStats(total: number): DashboardStats {
  return {
    total_cases: total,
    with_full_text: 0,
    courts: {},
    years: {},
    natures: {},
    visa_subclasses: {},
    sources: {},
    recent_cases: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useJudgeProfile / useJudgeBio — identity-keyed queries", () => {
  it("does not serve the previous judge's profile while a new judge loads", async () => {
    mockFetchJudgeProfile
      .mockResolvedValueOnce(makeProfile("Smith"))
      .mockImplementationOnce(() => pending<JudgeProfile>());

    const { result, rerender } = renderHook(
      ({ name }: { name: string }) => useJudgeProfile(name),
      { wrapper: makeWrapper(), initialProps: { name: "Smith" } },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.judge.name).toBe("Smith");

    rerender({ name: "Jones" });

    await waitFor(() =>
      expect(mockFetchJudgeProfile).toHaveBeenCalledTimes(2),
    );
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });

  it("does not serve the previous judge's biography while a new judge loads", async () => {
    mockFetchJudgeBio
      .mockResolvedValueOnce(makeBio("Justice Smith"))
      .mockImplementationOnce(() => pending<JudgeBio>());

    const { result, rerender } = renderHook(
      ({ name }: { name: string }) => useJudgeBio(name),
      { wrapper: makeWrapper(), initialProps: { name: "Smith" } },
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    rerender({ name: "Jones" });

    await waitFor(() => expect(mockFetchJudgeBio).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();
  });
});

describe("analyticsFilterKey", () => {
  it("distinguishes filter sets that produce different query strings", () => {
    const base: AnalyticsFilterParams = {
      court: "FCA",
      yearFrom: 2020,
      yearTo: 2024,
    };
    const withNature: AnalyticsFilterParams = {
      ...base,
      caseNatures: ["Protection"],
    };
    const withVisa: AnalyticsFilterParams = {
      ...base,
      visaSubclasses: ["866"],
    };
    const withOutcome: AnalyticsFilterParams = {
      ...base,
      outcomeTypes: ["affirmed"],
    };

    const keys = [base, withNature, withVisa, withOutcome].map(
      analyticsFilterKey,
    );
    expect(new Set(keys).size).toBe(4);
  });

  it("ignores ordering inside array filters", () => {
    expect(analyticsFilterKey({ visaSubclasses: ["866", "500"] })).toBe(
      analyticsFilterKey({ visaSubclasses: ["500", "866"] }),
    );
  });

  it("treats undefined and empty filters as the same identity", () => {
    expect(analyticsFilterKey(undefined)).toBe(analyticsFilterKey({}));
  });
});

describe("useStats — query key covers every wire filter", () => {
  it("refetches when only an advanced filter changes", async () => {
    mockFetchStats
      .mockResolvedValueOnce(makeStats(149_016))
      .mockResolvedValueOnce(makeStats(12_000));

    const base: AnalyticsFilterParams = {
      court: "FCA",
      yearFrom: 2020,
      yearTo: 2024,
    };

    const { rerender } = renderHook(
      ({ filters }: { filters: AnalyticsFilterParams }) => useStats(filters),
      { wrapper: makeWrapper(), initialProps: { filters: base } },
    );

    await waitFor(() => expect(mockFetchStats).toHaveBeenCalledTimes(1));

    rerender({ filters: { ...base, caseNatures: ["Protection"] } });

    await waitFor(() => expect(mockFetchStats).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
  });
});

describe("useCaseCount — filter-keyed list query", () => {
  it("keeps the previous count visible while a new filter set loads", async () => {
    mockFetchCaseCount
      .mockResolvedValueOnce({ total: 10, count_mode: "planned" })
      .mockImplementationOnce(() =>
        pending<{ total: number; count_mode: "planned" }>(),
      );

    const { result, rerender } = renderHook(
      ({ court }: { court: string }) => useCaseCount({ court }),
      { wrapper: makeWrapper(), initialProps: { court: "FCA" } },
    );

    await waitFor(() => expect(result.current.data?.total).toBe(10));

    rerender({ court: "HCA" });

    await waitFor(() => expect(mockFetchCaseCount).toHaveBeenCalledTimes(2));
    expect(result.current.data?.total).toBe(10);
    expect(result.current.isFetching).toBe(true);
  });
});
