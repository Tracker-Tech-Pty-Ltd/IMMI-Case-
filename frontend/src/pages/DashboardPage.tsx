import { useState, useMemo, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  FileText,
  BookOpen,
  Database,
  Layers,
  BarChart3,
  Table,
  Download,
  Search,
  Bookmark,
  Info,
  Loader2,
  Clock3,
  TriangleAlert,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  ArrowRight,
  GitBranch,
} from "lucide-react";
import { useStats, useTrends } from "@/hooks/use-stats";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { StatCard } from "@/components/dashboard/StatCard";
import { CourtChart } from "@/components/dashboard/CourtChart";
import { NatureChart } from "@/components/dashboard/NatureChart";
import { CourtSparklineGrid } from "@/components/dashboard/CourtSparklineGrid";
import { SubclassChart } from "@/components/dashboard/SubclassChart";
import { SavedSearchCard } from "@/components/saved-searches/SavedSearchCard";
import { CourtBadge } from "@/components/shared/CourtBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { AnalyticsFilters } from "@/components/shared/AnalyticsFilters";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import { buildDashboardInsights, normalizeVisaSubclassKeys } from "@/lib/dashboard-insights";
import { normalizeTrendEntries, hasRenderableTrendSeries } from "@/lib/trends";
import type { AnalyticsFilterParams, DashboardStats } from "@/types/case";

const CURRENT_YEAR = new Date().getFullYear();
const SLOW_LOADING_MS = 4_000;
const TIMEOUT_LOADING_MS = 15_000;
type DashboardLoadingPhase = "loading" | "slow" | "timeout";
type ChartSourceStatus = "raw" | "fallback" | "empty";
type ChartSourceDataset =
  | "courts"
  | "sources"
  | "trends"
  | "years"
  | "natures"
  | "visa_subclasses"
  | "none";
type ChartSourceState = {
  status: ChartSourceStatus;
  dataset: ChartSourceDataset;
  pointCount: number;
};
const EMPTY_DASHBOARD_STATS: DashboardStats = {
  total_cases: 0,
  with_full_text: 0,
  courts: {},
  years: {},
  sources: {},
  natures: {},
  visa_subclasses: {},
  recent_cases: [],
  degraded: false,
};

function formatSignedNumber(value: number): string {
  if (value > 0) return `+${value.toLocaleString()}`;
  if (value < 0) return `-${Math.abs(value).toLocaleString()}`;
  return "0";
}

function formatSignedPercent(value: number): string {
  if (value > 0) return `+${value.toFixed(1)}%`;
  if (value < 0) return `-${Math.abs(value).toFixed(1)}%`;
  return "0.0%";
}

function toRenderableDistribution(
  distribution: Record<string, unknown> | undefined,
): Record<string, number> {
  return Object.entries(distribution ?? {}).reduce<Record<string, number>>(
    (acc, [key, value]) => {
      const name = key.trim();
      const numeric = typeof value === "number" ? value : Number(value);
      if (!name || !Number.isFinite(numeric) || numeric <= 0) return acc;
      acc[name] = Math.trunc(numeric);
      return acc;
    },
    {},
  );
}

function getSourceBadgeClass(status: ChartSourceStatus): string {
  if (status === "raw") {
    return "rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success";
  }
  if (status === "fallback") {
    return "rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning";
  }
  return "rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-text";
}

export function DashboardPage() {
  const { t } = useTranslation();
  const [court, setCourt] = useState("");
  const [yearFrom, setYearFrom] = useState(2000);
  const [yearTo, setYearTo] = useState(CURRENT_YEAR);

  const filters: AnalyticsFilterParams = useMemo(
    () => ({ court: court || undefined, yearFrom, yearTo }),
    [court, yearFrom, yearTo],
  );

  const {
    data: stats,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useStats(filters);
  const { data: trendsData } = useTrends(filters);
  const { savedSearches, executeSearch, deleteSearch } = useSavedSearches();
  const navigate = useNavigate();
  const [loadingPhase, setLoadingPhase] =
    useState<DashboardLoadingPhase>("loading");
  const [courtView, setCourtView] = useState<"chart" | "table">("chart");
  const panelClass = "rounded-lg border border-border bg-card p-4 shadow-xs";
  const isInitialLoading = isLoading && !stats;

  useEffect(() => {
    if (!isInitialLoading) return;

    const slowTimer = window.setTimeout(() => {
      setLoadingPhase("slow");
    }, SLOW_LOADING_MS);
    const timeoutTimer = window.setTimeout(() => {
      setLoadingPhase("timeout");
    }, TIMEOUT_LOADING_MS);

    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(timeoutTimer);
    };
  }, [isInitialLoading, filters.court, filters.yearFrom, filters.yearTo]);

  useEffect(() => {
    if (!import.meta.env.DEV || !stats) return;

    const devCourtDistribution = toRenderableDistribution(
      stats.courts as Record<string, unknown>,
    );
    const devYearDistribution = toRenderableDistribution(
      stats.years as Record<string, unknown>,
    );
    const devSourceDistribution = toRenderableDistribution(
      stats.sources as Record<string, unknown>,
    );
    const devNatureDistribution = toRenderableDistribution(
      stats.natures as Record<string, unknown>,
    );
    const devVisaSubclassDistribution = toRenderableDistribution(
      normalizeVisaSubclassKeys(stats.visa_subclasses || {}) as Record<string, unknown>,
    );
    const devTrends = normalizeTrendEntries(
      (trendsData?.trends ?? []) as Record<string, unknown>[],
    );

    const hasCourtData = Object.keys(devCourtDistribution).length > 0;
    const hasYearBars = Object.keys(devYearDistribution).length > 0;
    const hasSourceData = Object.keys(devSourceDistribution).length > 0;
    const hasNatureData = Object.keys(devNatureDistribution).length > 0;
    const hasVisaSubclassData =
      Object.keys(devVisaSubclassDistribution).length > 0;
    const hasTrendSeries = hasRenderableTrendSeries(devTrends);
    const fallbackDistribution = hasSourceData
      ? devSourceDistribution
      : devCourtDistribution;
    const hasFallbackDistribution =
      Object.keys(fallbackDistribution).length > 0;
    const fallbackDataset: ChartSourceDataset = hasSourceData
      ? "sources"
      : "courts";

    const snapshot: Record<string, ChartSourceState> = {
      court: hasCourtData
        ? {
            status: "raw",
            dataset: "courts",
            pointCount: Object.keys(devCourtDistribution).length,
          }
        : hasFallbackDistribution
          ? {
              status: "fallback",
              dataset: fallbackDataset,
              pointCount: Object.keys(fallbackDistribution).length,
            }
          : { status: "empty", dataset: "none", pointCount: 0 },
      year: hasTrendSeries
        ? { status: "raw", dataset: "trends", pointCount: devTrends.length }
        : hasYearBars
          ? {
              status: "fallback",
              dataset: "years",
              pointCount: Object.keys(devYearDistribution).length,
            }
          : { status: "empty", dataset: "none", pointCount: 0 },
      nature: hasNatureData
        ? {
            status: "raw",
            dataset: "natures",
            pointCount: Object.keys(devNatureDistribution).length,
          }
        : hasFallbackDistribution
          ? {
              status: "fallback",
              dataset: fallbackDataset,
              pointCount: Object.keys(fallbackDistribution).length,
            }
          : { status: "empty", dataset: "none", pointCount: 0 },
      subclass: hasVisaSubclassData
        ? {
            status: "raw",
            dataset: "visa_subclasses",
            pointCount: Object.keys(devVisaSubclassDistribution).length,
          }
        : hasFallbackDistribution
          ? {
              status: "fallback",
              dataset: fallbackDataset,
              pointCount: Object.keys(fallbackDistribution).length,
            }
          : { status: "empty", dataset: "none", pointCount: 0 },
    };

    const degradedCharts = Object.entries(snapshot).filter(
      ([, source]) => source.status !== "raw",
    );
    if (degradedCharts.length > 0) {
      console.warn(
        "[Dashboard] non-raw chart sources detected",
        degradedCharts,
      );
    }
  }, [stats, trendsData, filters.court, filters.yearFrom, filters.yearTo]);

  if (isInitialLoading) {
    const isSlow = loadingPhase === "slow";
    const isTimeout = loadingPhase === "timeout";
    const iconClass = isTimeout
      ? "h-5 w-5 text-danger"
      : isSlow
        ? "h-5 w-5 text-warning"
        : "h-5 w-5 animate-spin text-accent";

    const titleKey = isTimeout
      ? "dashboard.loading_timeout_title"
      : isSlow
        ? "dashboard.loading_slow_title"
        : "dashboard.loading_title";
    const messageKey = isTimeout
      ? "dashboard.loading_timeout_message"
      : isSlow
        ? "dashboard.loading_slow_message"
        : "dashboard.loading_message";

    return (
      <div className="space-y-4">
        <PageHeader
          title={t("dashboard.title")}
          description={t("dashboard.subtitle")}
        />

        <div
          className={`rounded-lg border p-4 shadow-xs ${
            isTimeout
              ? "border-danger/40 bg-danger/5"
              : isSlow
                ? "border-warning/40 bg-warning/5"
                : "border-border bg-card"
          }`}
        >
          <div className="flex items-start gap-3">
            {isTimeout ? (
              <TriangleAlert className={iconClass} />
            ) : isSlow ? (
              <Clock3 className={iconClass} />
            ) : (
              <Loader2 className={iconClass} />
            )}
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">
                {t(titleKey)}
              </h2>
              <p className="text-sm text-muted-text">{t(messageKey)}</p>
            </div>
          </div>

          {(isSlow || isTimeout) && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setLoadingPhase("loading");
                  void refetch();
                }}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-light"
              >
                {t("common.retry")}
              </button>
              <button
                type="button"
                onClick={() => navigate("/cases")}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface"
              >
                {t("nav.cases")}
              </button>
              <button
                type="button"
                onClick={() => navigate("/guided-search")}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface"
              >
                {t("nav.guided_search")}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isError && !stats) {
    const message =
      error instanceof Error
        ? error.message
        : t("errors.api_request_failed", { name: "Dashboard" });
    return (
      <div className="space-y-4">
        <PageHeader
          title={t("dashboard.title")}
          description={t("dashboard.subtitle")}
        />
        <ApiErrorState
          title={t("errors.failed_to_load", { name: "Dashboard" })}
          message={message}
          onRetry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={t("dashboard.title")}
          description={t("dashboard.subtitle")}
        />
        <ApiErrorState
          title={t("errors.data_unavailable", { name: "Dashboard" })}
          message={t("errors.payload_error", { name: "Dashboard" })}
          onRetry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  if (stats.total_cases === 0 && !isFetching && !stats.degraded) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t("dashboard.title")}
          description={t("dashboard.subtitle_empty")}
        />
        <EmptyState
          icon={<FileText className="h-10 w-10" />}
          title={t("dashboard.welcome_title")}
          description={t("dashboard.welcome_description")}
          action={
            <div className="flex flex-col items-center gap-3">
              <div className="grid gap-2 text-left text-sm text-muted-text">
                <p>
                  <strong className="text-foreground">
                    {t("dashboard.step_1")}
                  </strong>
                </p>
                <p>
                  <strong className="text-foreground">
                    {t("dashboard.step_2")}
                  </strong>
                </p>
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate("/cases")}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light"
                >
                  {t("nav.cases")}
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/guided-search")}
                  className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-surface"
                >
                  {t("nav.guided_search")}
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/data-tools")}
                  className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-muted-text hover:bg-surface hover:text-foreground"
                >
                  {t("nav.data_tools")}
                </button>
              </div>
            </div>
          }
        />
      </div>
    );
  }

  const courtDistribution = toRenderableDistribution(
    stats.courts as Record<string, unknown>,
  );
  const isDegradedStats = Boolean(stats.degraded);
  const yearDistribution = toRenderableDistribution(
    stats.years as Record<string, unknown>,
  );
  const sourceDistribution = toRenderableDistribution(
    stats.sources as Record<string, unknown>,
  );
  const natureDistribution = toRenderableDistribution(
    stats.natures as Record<string, unknown>,
  );
  const visaSubclassDistribution = toRenderableDistribution(
    normalizeVisaSubclassKeys(stats.visa_subclasses || {}) as Record<string, unknown>,
  );
  const trends = normalizeTrendEntries(
    (trendsData?.trends ?? []) as Record<string, unknown>[],
  );
  const hasTrendSeries = hasRenderableTrendSeries(trends);
  const hasYearBars = Object.keys(yearDistribution).length > 0;
  const hasCourtData = Object.keys(courtDistribution).length > 0;
  const hasNatureData = Object.keys(natureDistribution).length > 0;
  const hasVisaSubclassData = Object.keys(visaSubclassDistribution).length > 0;
  const fallbackDistribution =
    Object.keys(sourceDistribution).length > 0
      ? sourceDistribution
      : courtDistribution;
  const hasFallbackDistribution = Object.keys(fallbackDistribution).length > 0;
  const sortedCourts = Object.entries(courtDistribution).toSorted(
    ([, a], [, b]) => b - a,
  );
  const natureCount = Object.keys(natureDistribution).length;
  const fallbackDataset: ChartSourceDataset =
    Object.keys(sourceDistribution).length > 0 ? "sources" : "courts";
  const courtSourceState: ChartSourceState = hasCourtData
    ? {
        status: "raw",
        dataset: "courts",
        pointCount: Object.keys(courtDistribution).length,
      }
    : hasFallbackDistribution
      ? {
          status: "fallback",
          dataset: fallbackDataset,
          pointCount: Object.keys(fallbackDistribution).length,
        }
      : { status: "empty", dataset: "none", pointCount: 0 };
  const yearSourceState: ChartSourceState = hasTrendSeries
    ? {
        status: "raw",
        dataset: "trends",
        pointCount: trends.length,
      }
    : hasYearBars
      ? {
          status: "fallback",
          dataset: "years",
          pointCount: Object.keys(yearDistribution).length,
        }
      : { status: "empty", dataset: "none", pointCount: 0 };
  const natureSourceState: ChartSourceState = hasNatureData
    ? {
        status: "raw",
        dataset: "natures",
        pointCount: Object.keys(natureDistribution).length,
      }
    : hasFallbackDistribution
      ? {
          status: "fallback",
          dataset: fallbackDataset,
          pointCount: Object.keys(fallbackDistribution).length,
        }
      : { status: "empty", dataset: "none", pointCount: 0 };
  const subclassSourceState: ChartSourceState = hasVisaSubclassData
    ? {
        status: "raw",
        dataset: "visa_subclasses",
        pointCount: Object.keys(visaSubclassDistribution).length,
      }
    : hasFallbackDistribution
      ? {
          status: "fallback",
          dataset: fallbackDataset,
          pointCount: Object.keys(fallbackDistribution).length,
        }
      : { status: "empty", dataset: "none", pointCount: 0 };
  const sourceStatusLabels = {
    raw: t("dashboard.chart_data_status_raw"),
    fallback: t("dashboard.chart_data_status_fallback"),
    empty: t("dashboard.chart_data_status_empty"),
  };
  const sourceDatasetLabels: Record<ChartSourceDataset, string> = {
    courts: t("dashboard.chart_data_dataset_courts"),
    sources: t("dashboard.chart_data_dataset_sources"),
    trends: t("dashboard.chart_data_dataset_trends"),
    years: t("dashboard.chart_data_dataset_years"),
    natures: t("dashboard.chart_data_dataset_natures"),
    visa_subclasses: t("dashboard.chart_data_dataset_visa_subclasses"),
    none: t("dashboard.chart_data_dataset_none"),
  };
  const formatSourceBadgeText = (state: ChartSourceState): string =>
    t("dashboard.chart_data_badge", {
      status: sourceStatusLabels[state.status],
      dataset: sourceDatasetLabels[state.dataset],
    });

  const insights = buildDashboardInsights(
    stats ?? EMPTY_DASHBOARD_STATS,
    filters,
  );
  const dominantCourt = insights.dominantCourt;
  const topNature = insights.topNature;
  const topVisaSubclass = insights.topVisaSubclass;
  const momentum = insights.trendWindow;
  const latestYear = insights.latestYear;
  const hasMomentum = Boolean(
    momentum && momentum.firstYear !== momentum.lastYear,
  );
  const coverageToneClass =
    insights.fullTextCoveragePct >= 65
      ? "text-success"
      : insights.fullTextCoveragePct >= 35
        ? "text-warning"
        : "text-danger";
  const momentumToneClass =
    momentum && momentum.delta > 0
      ? "text-success"
      : momentum && momentum.delta < 0
        ? "text-danger"
        : "text-muted-text";
  const MomentumIcon =
    momentum && momentum.delta > 0
      ? TrendingUp
      : momentum && momentum.delta < 0
        ? TrendingDown
        : Minus;
  const reportGeneratedOn = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date());
  const scopeCourtLabel =
    insights.scope.court || t("dashboard.insight_scope_all_courts");
  const momentumDisplay =
    hasMomentum && momentum
      ? momentum.deltaPct !== null
        ? formatSignedPercent(momentum.deltaPct)
        : formatSignedNumber(momentum.delta)
      : t("dashboard.insight_momentum_no_data");
  const momentumDetail =
    hasMomentum && momentum
      ? t("dashboard.insight_momentum_detail", {
          from: momentum.firstYear,
          to: momentum.lastYear,
          delta: formatSignedNumber(momentum.delta),
        })
      : t("common.no_data");

  return (
    <div className="space-y-6">
      {/* Report Header + Filters */}
      <div className="space-y-4">
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border/60 bg-surface/60 px-4 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-text">
              {t("dashboard.report_eyebrow")}
            </p>
          </div>
          <div className="grid gap-4 px-4 py-4 md:px-5 md:py-5 lg:grid-cols-[1.6fr_1fr]">
            <PageHeader
              title={t("dashboard.title")}
              description={t("dashboard.subtitle")}
              className="space-y-2"
            />

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-border/70 bg-card px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-text">
                  {t("dashboard.report_generated_label")}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {reportGeneratedOn}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-card px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-text">
                  {t("dashboard.report_scope_label")}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {scopeCourtLabel}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-card px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-text">
                  {t("dashboard.report_active_years_label")}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {t("dashboard.report_active_years_value", {
                    years: insights.activeYearCount,
                  })}
                </p>
              </div>
              <div className="rounded-md border border-border/70 bg-card px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-text">
                  {t("dashboard.report_total_cases_label")}
                </p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {stats.total_cases.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </div>

        <AnalyticsFilters
          court={court}
          yearFrom={yearFrom}
          yearTo={yearTo}
          onCourtChange={setCourt}
          onYearRangeChange={(from, to) => {
            setYearFrom(from);
            setYearTo(to);
          }}
        />

        {isDegradedStats && (
          <div
            role="alert"
            className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3"
          >
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 text-warning" />
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t("errors.failed_to_load", { name: "Dashboard" })}
                </p>
                <p className="mt-1 text-sm text-muted-text">
                  {t("dashboard.degraded_message")}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Executive Briefing */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3">
          <div className="space-y-1">
            <p className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
              <Sparkles className="h-3.5 w-3.5" />
              {t("dashboard.briefing_eyebrow")}
            </p>
            <h2 className="font-heading text-xl font-semibold text-foreground">
              {t("dashboard.briefing_title")}
            </h2>
            <p className="text-sm text-muted-text">
              {t("dashboard.briefing_subtitle", { yearFrom, yearTo })}
            </p>
          </div>

          <Link
            to="/analytics"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface/70 px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-surface"
          >
            {t("dashboard.open_analytics")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <ol className="space-y-3">
            <li className="rounded-lg border border-border/70 bg-surface/35 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-text">
                {t("dashboard.finding_1_label")}
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {dominantCourt
                  ? t("dashboard.finding_1_value", {
                      court: dominantCourt.name,
                      share: dominantCourt.sharePct.toFixed(1),
                    })
                  : t("dashboard.insight_dominant_court_empty")}
              </p>
              <p className="mt-1 text-xs text-muted-text">
                {dominantCourt
                  ? t("dashboard.insight_dominant_court_detail", {
                      cases: dominantCourt.count.toLocaleString(),
                      share: dominantCourt.sharePct.toFixed(1),
                    })
                  : t("common.no_data")}
              </p>
            </li>
            <li className="rounded-lg border border-border/70 bg-surface/35 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-text">
                {t("dashboard.finding_2_label")}
              </p>
              <p className={`mt-1 text-sm font-semibold ${coverageToneClass}`}>
                {t("dashboard.finding_2_value", {
                  percentage: insights.fullTextCoveragePct.toFixed(1),
                })}
              </p>
              <p className="mt-1 text-xs text-muted-text">
                {t("dashboard.insight_full_text_gap_detail", {
                  missing: insights.fullTextGap.toLocaleString(),
                })}
              </p>
            </li>
            <li className="rounded-lg border border-border/70 bg-surface/35 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-text">
                {t("dashboard.finding_3_label")}
              </p>
              <p
                className={`mt-1 flex items-center gap-1 text-sm font-semibold ${momentumToneClass}`}
              >
                <MomentumIcon className="h-4 w-4" />
                {momentumDisplay}
              </p>
              <p className="mt-1 text-xs text-muted-text">{momentumDetail}</p>
            </li>
          </ol>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/70 bg-card p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-text">
                {t("dashboard.insight_latest_year")}
              </p>
              <p className="mt-1 flex items-center gap-1 text-base font-semibold text-foreground">
                <Activity className="h-4 w-4 text-accent" />
                {latestYear?.year ?? t("dashboard.insight_latest_year_empty")}
              </p>
              <p className="mt-1 text-xs text-muted-text">
                {latestYear
                  ? t("dashboard.insight_latest_year_detail", {
                      cases: latestYear.count.toLocaleString(),
                    })
                  : t("common.no_data")}
              </p>
            </div>

            <div className="rounded-lg border border-border/70 bg-card p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-text">
                {t("dashboard.insight_scope_label")}
              </p>
              <p className="mt-1 text-base font-semibold text-foreground">
                {scopeCourtLabel}
              </p>
              <p className="mt-1 text-xs text-muted-text">
                {t("dashboard.insight_scope_chip", {
                  court: scopeCourtLabel,
                  yearFrom,
                  yearTo,
                })}
              </p>
            </div>

            <div className="rounded-lg border border-border/70 bg-card p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-text">
                {t("dashboard.insight_top_nature_label")}
              </p>
              <p className="mt-1 text-base font-semibold text-foreground">
                {topNature?.name ?? t("common.no_data")}
              </p>
              <p className="mt-1 text-xs text-muted-text">
                {topNature
                  ? t("dashboard.insight_top_nature_chip", {
                      nature: topNature.name,
                    })
                  : t("common.no_data")}
              </p>
            </div>

            <div className="rounded-lg border border-border/70 bg-card p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-text">
                {t("dashboard.insight_top_subclass_label")}
              </p>
              <p className="mt-1 text-base font-semibold text-foreground">
                {topVisaSubclass?.name ?? t("common.no_data")}
              </p>
              <p className="mt-1 text-xs text-muted-text">
                {topVisaSubclass
                  ? t("dashboard.insight_top_subclass_chip", {
                      subclass: topVisaSubclass.name,
                    })
                  : t("common.no_data")}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {isFetching && (
            <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-muted-text">
              {t("dashboard.insight_refreshing")}
            </span>
          )}
          <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-muted-text">
            {t("dashboard.report_filter_note")}
          </span>
        </div>
      </section>

      {/* Section 01 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border/60 pb-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-text">
              {t("dashboard.section_01_label")}
            </p>
            <h2 className="font-heading text-lg font-semibold text-foreground">
              {t("dashboard.section_01_title")}
            </h2>
          </div>
        </div>
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            className="h-full"
            title={t("dashboard.total_cases")}
            value={stats.total_cases}
            icon={<FileText className="h-5 w-5" />}
          />
          <StatCard
            className="h-full"
            title={t("dashboard.with_full_text")}
            value={stats.with_full_text}
            icon={<BookOpen className="h-5 w-5" />}
            description={t("dashboard.coverage", {
              percentage: (
                (stats.with_full_text / stats.total_cases) *
                100
              ).toFixed(1),
            })}
          />
          <StatCard
            className="h-full"
            title={t("dashboard.courts_tribunals")}
            value={Object.keys(courtDistribution).length}
            icon={<Database className="h-5 w-5" />}
          />
          <StatCard
            className="h-full"
            title={t("dashboard.case_categories")}
            value={natureCount}
            icon={<Layers className="h-5 w-5" />}
            description={
              natureCount > 0
                ? t("dashboard.classified", {
                    count: Object.values(natureDistribution).reduce(
                      (a, b) => a + b,
                      0,
                    ),
                  })
                : undefined
            }
          />
        </div>
      </section>

      {/* Section 02 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border/60 pb-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-text">
              {t("dashboard.section_02_label")}
            </p>
            <h2 className="font-heading text-lg font-semibold text-foreground">
              {t("dashboard.section_02_title")}
            </h2>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Court distribution */}
          <div className={`${panelClass} flex h-full min-h-[360px] flex-col`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="font-heading text-base font-semibold">
                  {t("dashboard.cases_by_court")}
                </h2>
                <span className={getSourceBadgeClass(courtSourceState.status)}>
                  {formatSourceBadgeText(courtSourceState)}
                </span>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setCourtView("chart")}
                  className={
                    courtView === "chart"
                      ? "rounded p-1 bg-accent-muted text-accent"
                      : "rounded p-1 text-muted-text hover:text-foreground"
                  }
                  aria-label={t("dashboard.chart_view", {
                    defaultValue: "Show chart view",
                  })}
                  title={t("dashboard.chart_view", {
                    defaultValue: "Show chart view",
                  })}
                  aria-pressed={courtView === "chart"}
                >
                  <BarChart3 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setCourtView("table")}
                  className={
                    courtView === "table"
                      ? "rounded p-1 bg-accent-muted text-accent"
                      : "rounded p-1 text-muted-text hover:text-foreground"
                  }
                  aria-label={t("dashboard.table_view", {
                    defaultValue: "Show table view",
                  })}
                  title={t("dashboard.table_view", {
                    defaultValue: "Show table view",
                  })}
                  aria-pressed={courtView === "table"}
                >
                  <Table className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1">
              {courtView === "chart" ? (
                <CourtChart data={courtDistribution} />
              ) : (
                <div className="space-y-1.5">
                  {sortedCourts.map(([court, count]) => (
                    <Link
                      key={court}
                      to={`/cases?court=${court}`}
                      className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-surface"
                    >
                      <CourtBadge court={court} />
                      <span className="font-mono text-sm text-foreground">
                        {count.toLocaleString()}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Year trend area chart */}
          <div className={`${panelClass} flex h-full min-h-[360px] flex-col`}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-base font-semibold">
                {t("dashboard.year_trend")}
              </h2>
              <span className={getSourceBadgeClass(yearSourceState.status)}>
                {formatSourceBadgeText(yearSourceState)}
              </span>
            </div>
            <div className="flex-1">
              {hasTrendSeries ? (
                <CourtSparklineGrid data={trends} />
              ) : hasYearBars ? (
                <CourtChart data={yearDistribution} />
              ) : (
                <EmptyState
                  icon={<BarChart3 className="h-8 w-8" />}
                  title={t("dashboard.no_trend_data_title")}
                  description={t("dashboard.no_trend_data_desc")}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Section 03 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border/60 pb-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-text">
              {t("dashboard.section_03_label")}
            </p>
            <h2 className="font-heading text-lg font-semibold text-foreground">
              {t("dashboard.section_03_title")}
            </h2>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Case nature distribution */}
          <div className={`${panelClass} flex h-full min-h-[360px] flex-col`}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-base font-semibold">
                {hasNatureData
                  ? t("dashboard.case_categories_dist")
                  : t("dashboard.data_sources_distribution")}
              </h2>
              <span className={getSourceBadgeClass(natureSourceState.status)}>
                {formatSourceBadgeText(natureSourceState)}
              </span>
            </div>
            <div className="flex-1">
              {hasNatureData ? (
                <NatureChart data={natureDistribution} />
              ) : hasFallbackDistribution ? (
                <CourtChart data={fallbackDistribution} />
              ) : (
                <EmptyState
                  icon={<Layers className="h-8 w-8" />}
                  title={t("dashboard.no_composition_data_title")}
                  description={t("dashboard.no_composition_data_desc")}
                />
              )}
            </div>
          </div>

          {/* Visa subclass distribution */}
          <div className={`${panelClass} flex h-full min-h-[360px] flex-col`}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-base font-semibold">
                {hasVisaSubclassData
                  ? t("dashboard.top_visa_subclasses")
                  : t("dashboard.data_sources_distribution")}
              </h2>
              <span className={getSourceBadgeClass(subclassSourceState.status)}>
                {formatSourceBadgeText(subclassSourceState)}
              </span>
            </div>
            <div className="flex-1">
              {hasVisaSubclassData ? (
                <SubclassChart data={visaSubclassDistribution} />
              ) : hasFallbackDistribution ? (
                <CourtChart data={fallbackDistribution} />
              ) : (
                <EmptyState
                  icon={<Database className="h-8 w-8" />}
                  title={t("dashboard.no_subclass_data_title")}
                  description={t("dashboard.no_subclass_data_desc")}
                />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <div className="grid auto-rows-fr gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => navigate("/guided-search")}
          className="flex h-full min-h-[76px] items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-accent hover:shadow-md"
        >
          <div className="rounded-md bg-accent-muted p-2 text-accent">
            <Search className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium text-foreground">
            {t("nav.guided_search")}
          </span>
        </button>

        <button
          type="button"
          onClick={() => navigate("/analytics")}
          className="flex h-full min-h-[76px] items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-accent hover:shadow-md"
        >
          <div className="rounded-md bg-accent-muted p-2 text-accent">
            <BarChart3 className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium text-foreground">
            {t("nav.analytics")}
          </span>
        </button>

        <button
          type="button"
          onClick={() => navigate("/data-tools")}
          className="flex h-full min-h-[76px] items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-accent hover:shadow-md"
        >
          <div className="rounded-md bg-accent-muted p-2 text-accent">
            <GitBranch className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium text-foreground">
            {t("nav.data_tools")}
          </span>
        </button>
      </div>

      {/* Saved Searches */}
      {savedSearches.length > 0 && (
        <div className={panelClass}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-heading text-base font-semibold flex items-center gap-2">
              <Bookmark className="h-4 w-4" />
              {t("saved_searches.title")}
            </h2>
            <Link
              to="/cases"
              className="text-sm text-accent hover:text-accent-dark transition-colors"
            >
              {t("buttons.view_all")} ({savedSearches.length})
            </Link>
          </div>
          <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {savedSearches.slice(0, 5).map((search) => (
              <SavedSearchCard
                key={search.id}
                search={search}
                className="h-full"
                onExecute={(currentCount) => {
                  executeSearch(
                    search.id,
                    () => {
                      navigate(
                        `/cases?${new URLSearchParams(
                          Object.entries(search.filters)
                            .filter(([, v]) => v !== undefined && v !== "")
                            .map(([k, v]) => [k, String(v)]),
                        ).toString()}`,
                      );
                    },
                    currentCount,
                  );
                }}
                onEdit={() => {
                  navigate(
                    `/cases?edit_search=${encodeURIComponent(search.id)}`,
                  );
                }}
                onDelete={() => {
                  if (
                    window.confirm(
                      t("saved_searches.confirm_delete", { name: search.name }),
                    )
                  ) {
                    deleteSearch(search.id);
                  }
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Recent cases */}
      {stats.recent_cases && stats.recent_cases.length > 0 && (
        <div className={panelClass}>
          <h2 className="mb-3 font-heading text-base font-semibold">
            {t("dashboard.recent_cases")}
          </h2>
          <div className="space-y-1">
            {stats.recent_cases.slice(0, 5).map((c) => (
              <button
                key={c.case_id}
                onClick={() => navigate(`/cases/${c.case_id}`)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-surface"
              >
                <CourtBadge court={c.court_code} />
                <span
                  className="flex-1 truncate text-foreground"
                  title={c.title || c.citation}
                >
                  {c.title || c.citation}
                </span>
                <span className="shrink-0 text-xs text-muted-text whitespace-nowrap">
                  {c.date}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div className="rounded-lg border border-border/50 bg-surface/50 p-4">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-text" />
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-text">
              {t("disclaimer.title")}
            </p>
            <p className="text-xs leading-relaxed text-muted-text/80">
              {t("disclaimer.body")}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
              <span className="text-[10px] text-muted-text/60">
                {t("disclaimer.data_source")}
              </span>
              <span className="text-[10px] italic text-muted-text/60">
                {t("disclaimer.not_legal_advice")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
