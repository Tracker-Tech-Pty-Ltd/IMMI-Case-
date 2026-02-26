import type { AnalyticsFilterParams, DashboardStats } from "@/types/case";

export interface RankedMetric {
  name: string;
  count: number;
  sharePct: number;
}

export interface TrendWindow {
  firstYear: number;
  firstCount: number;
  lastYear: number;
  lastCount: number;
  delta: number;
  deltaPct: number | null;
}

export interface YearPoint {
  year: number;
  count: number;
}

export interface DashboardInsights {
  fullTextCoveragePct: number;
  fullTextGap: number;
  dominantCourt: RankedMetric | null;
  topNature: RankedMetric | null;
  topVisaSubclass: RankedMetric | null;
  trendWindow: TrendWindow | null;
  latestYear: YearPoint | null;
  activeYearCount: number;
  scope: {
    court: string | null;
    yearFrom?: number;
    yearTo?: number;
  };
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function getTopMetric(
  values: Record<string, number>,
  total: number,
): RankedMetric | null {
  const entries = Object.entries(values)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .toSorted(([nameA, countA], [nameB, countB]) => {
      if (countA === countB) return nameA.localeCompare(nameB);
      return countB - countA;
    });

  const [topName, topCount] = entries[0] ?? [];
  if (!topName || !topCount || total <= 0) {
    return null;
  }

  return {
    name: topName,
    count: topCount,
    sharePct: roundOneDecimal((topCount / total) * 100),
  };
}

function getYearPoints(years: Record<string, number>): YearPoint[] {
  return Object.entries(years)
    .map(([year, count]) => ({
      year: Number(year),
      count,
    }))
    .filter((point) => Number.isFinite(point.year) && point.count > 0)
    .toSorted((a, b) => a.year - b.year);
}

function getTrendWindow(points: YearPoint[]): TrendWindow | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const delta = last.count - first.count;

  return {
    firstYear: first.year,
    firstCount: first.count,
    lastYear: last.year,
    lastCount: last.count,
    delta,
    deltaPct:
      first.count > 0 ? roundOneDecimal((delta / first.count) * 100) : null,
  };
}

export function buildDashboardInsights(
  stats: DashboardStats,
  filters?: AnalyticsFilterParams,
): DashboardInsights {
  const totalCases = Math.max(stats.total_cases || 0, 0);
  const fullTextCount = Math.max(stats.with_full_text || 0, 0);
  const yearPoints = getYearPoints(stats.years || {});

  return {
    fullTextCoveragePct:
      totalCases > 0 ? roundOneDecimal((fullTextCount / totalCases) * 100) : 0,
    fullTextGap: Math.max(totalCases - fullTextCount, 0),
    dominantCourt: getTopMetric(stats.courts || {}, totalCases),
    topNature: getTopMetric(stats.natures || {}, totalCases),
    topVisaSubclass: getTopMetric(stats.visa_subclasses || {}, totalCases),
    trendWindow: getTrendWindow(yearPoints),
    latestYear: yearPoints.at(-1) ?? null,
    activeYearCount: yearPoints.length,
    scope: {
      court: filters?.court || null,
      yearFrom: filters?.yearFrom,
      yearTo: filters?.yearTo,
    },
  };
}

