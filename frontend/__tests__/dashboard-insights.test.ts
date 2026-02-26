import { describe, expect, it } from "vitest";
import { buildDashboardInsights } from "@/lib/dashboard-insights";
import type { DashboardStats } from "@/types/case";

const baseStats: DashboardStats = {
  total_cases: 1000,
  with_full_text: 350,
  courts: {
    ARTA: 620,
    FCA: 240,
    FCCA: 140,
  },
  years: {
    "2022": 200,
    "2023": 250,
    "2024": 400,
    "2025": 150,
  },
  sources: {},
  natures: {
    Protection: 500,
    Character: 200,
  },
  visa_subclasses: {
    "866": 410,
    "500": 90,
  },
  recent_cases: [],
};

describe("buildDashboardInsights", () => {
  it("computes coverage, top entities, and trend window", () => {
    const insights = buildDashboardInsights(baseStats, {
      court: "ARTA",
      yearFrom: 2022,
      yearTo: 2025,
    });

    expect(insights.fullTextCoveragePct).toBe(35);
    expect(insights.fullTextGap).toBe(650);
    expect(insights.dominantCourt).toEqual({
      name: "ARTA",
      count: 620,
      sharePct: 62,
    });
    expect(insights.topNature?.name).toBe("Protection");
    expect(insights.topVisaSubclass?.name).toBe("866");
    expect(insights.latestYear).toEqual({ year: 2025, count: 150 });
    expect(insights.activeYearCount).toBe(4);
    expect(insights.trendWindow).toEqual({
      firstYear: 2022,
      firstCount: 200,
      lastYear: 2025,
      lastCount: 150,
      delta: -50,
      deltaPct: -25,
    });
    expect(insights.scope).toEqual({
      court: "ARTA",
      yearFrom: 2022,
      yearTo: 2025,
    });
  });

  it("returns safe defaults when totals are zero", () => {
    const insights = buildDashboardInsights({
      ...baseStats,
      total_cases: 0,
      with_full_text: 0,
      courts: {},
      natures: {},
      visa_subclasses: {},
      years: {},
    });

    expect(insights.fullTextCoveragePct).toBe(0);
    expect(insights.fullTextGap).toBe(0);
    expect(insights.dominantCourt).toBeNull();
    expect(insights.topNature).toBeNull();
    expect(insights.topVisaSubclass).toBeNull();
    expect(insights.trendWindow).toBeNull();
    expect(insights.latestYear).toBeNull();
    expect(insights.activeYearCount).toBe(0);
  });

  it("handles trend windows with a zero baseline", () => {
    const insights = buildDashboardInsights({
      ...baseStats,
      years: {
        "2024": 0,
        "2025": 120,
      },
    });

    expect(insights.trendWindow).toBeNull();
    expect(insights.latestYear).toEqual({ year: 2025, count: 120 });
    expect(insights.activeYearCount).toBe(1);
  });
});

