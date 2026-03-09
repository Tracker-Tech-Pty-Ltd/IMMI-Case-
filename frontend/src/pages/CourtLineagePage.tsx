import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  GitBranch,
  Info,
  BarChart3,
  AreaChart as AreaChartIcon,
  Percent,
} from "lucide-react";
import { useLineageData } from "@/hooks/use-lineage-data";
import { TimelineChart } from "@/components/lineage/TimelineChart";
import { LineageExplainer } from "@/components/lineage/LineageExplainer";
import { LineageFilters } from "@/components/lineage/LineageFilters";
import { CourtVolumeTable } from "@/components/lineage/CourtVolumeTable";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoader } from "@/components/shared/PageLoader";
import { getCourtColor } from "@/tokens/tokens";
import { cn } from "@/lib/utils";
import type { CourtGroup } from "@/lib/lineage-transforms";
import {
  filterCourtsByGroup,
  countFilteredCases,
  countVisibleCourts,
  findPeakYear,
  calculateCourtStats,
  calculateTransitionImpacts,
} from "@/lib/lineage-transforms";

const CURRENT_YEAR = new Date().getFullYear();

// All 9 courts for the legend
const ALL_COURTS = [
  { code: "MRTA", name: "MRTA" },
  { code: "RRTA", name: "RRTA" },
  { code: "AATA", name: "AATA" },
  { code: "ARTA", name: "ARTA" },
  { code: "FMCA", name: "FMCA" },
  { code: "FCCA", name: "FCCA" },
  { code: "FedCFamC2G", name: "FedCFamC2G" },
  { code: "FCA", name: "FCA" },
  { code: "HCA", name: "HCA" },
];

export function CourtLineagePage() {
  const { t } = useTranslation();
  const {
    data: lineageData,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useLineageData();

  // ── Filter state ──────────────────────────────────────────────
  const [groupFilter, setGroupFilter] = useState<CourtGroup>("all");
  const [yearFrom, setYearFrom] = useState(2000);
  const [yearTo, setYearTo] = useState(CURRENT_YEAR);
  const [hiddenCourts, setHiddenCourts] = useState<Set<string>>(new Set());
  const [chartMode, setChartMode] = useState<"bar" | "area">("bar");
  const [normalized, setNormalized] = useState(false);

  // Apply group filter to hidden courts
  const effectiveHiddenCourts = useMemo(() => {
    if (groupFilter === "all") return hiddenCourts;
    const groupCourts = new Set(filterCourtsByGroup(groupFilter));
    const allCodes = ALL_COURTS.map((c) => c.code);
    const hidden = new Set(hiddenCourts);
    for (const code of allCodes) {
      if (!groupCourts.has(code)) hidden.add(code);
    }
    return hidden;
  }, [groupFilter, hiddenCourts]);

  // ── Callbacks ─────────────────────────────────────────────────
  const handleGroupChange = useCallback((group: CourtGroup) => {
    setGroupFilter(group);
  }, []);

  const handleYearRangeChange = useCallback((from: number, to: number) => {
    setYearFrom(from);
    setYearTo(to);
  }, []);

  const handleToggleCourt = useCallback((court: string) => {
    setHiddenCourts((prev) => {
      const next = new Set(prev);
      if (next.has(court)) {
        next.delete(court);
      } else {
        next.add(court);
      }
      return next;
    });
  }, []);

  const handleResetCourts = useCallback(() => {
    setHiddenCourts(new Set());
  }, []);

  // ── Derived data ──────────────────────────────────────────────
  const filteredTotal = useMemo(
    () =>
      lineageData ? countFilteredCases(lineageData, effectiveHiddenCourts) : 0,
    [lineageData, effectiveHiddenCourts],
  );

  const visibleCourtCount = useMemo(
    () =>
      lineageData ? countVisibleCourts(lineageData, effectiveHiddenCourts) : 0,
    [lineageData, effectiveHiddenCourts],
  );

  const peakYear = useMemo(
    () =>
      lineageData
        ? findPeakYear(lineageData, effectiveHiddenCourts)
        : { year: 0, count: 0 },
    [lineageData, effectiveHiddenCourts],
  );

  const courtStats = useMemo(
    () =>
      lineageData
        ? calculateCourtStats(lineageData).filter(
            (s) => !effectiveHiddenCourts.has(s.code),
          )
        : [],
    [lineageData, effectiveHiddenCourts],
  );

  const transitionImpacts = useMemo(
    () => (lineageData ? calculateTransitionImpacts(lineageData) : []),
    [lineageData],
  );

  // ── Loading / Error states ────────────────────────────────────
  if (isLoading && !lineageData) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={t("lineage.title")}
          description={t("lineage.subtitle")}
        />
        <PageLoader />
        <p className="text-xs text-muted-text">
          {t("lineage.loading_hint", {
            defaultValue:
              "Court lineage aggregates can take a few seconds on large datasets.",
          })}
        </p>
      </div>
    );
  }

  if (isError && !lineageData) {
    const message =
      error instanceof Error
        ? error.message
        : t("errors.api_request_failed", { name: t("nav.court_lineage") });
    return (
      <div className="space-y-4">
        <PageHeader
          title={t("lineage.title")}
          description={t("lineage.subtitle")}
        />
        <ApiErrorState
          title={t("errors.failed_to_load", { name: t("nav.court_lineage") })}
          message={message}
          onRetry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  if (!lineageData) {
    return (
      <div className="space-y-4">
        <PageHeader
          title={t("lineage.title")}
          description={t("lineage.subtitle")}
        />
        <ApiErrorState
          title={t("errors.data_unavailable", { name: t("nav.court_lineage") })}
          message={t("errors.payload_error", { name: t("nav.court_lineage") })}
          onRetry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }

  if (lineageData.total_cases === 0 && !isFetching) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t("lineage.title")}
          description={t("lineage.subtitle_empty")}
        />
        <EmptyState
          icon={<GitBranch className="h-10 w-10" />}
          title={t("lineage.no_data_title")}
          description={t("lineage.no_data_description")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={t("lineage.title")}
        description={t("lineage.subtitle")}
      />

      {/* Filters */}
      <LineageFilters
        groupFilter={groupFilter}
        yearFrom={yearFrom}
        yearTo={yearTo}
        hiddenCourts={hiddenCourts}
        onGroupChange={handleGroupChange}
        onYearRangeChange={handleYearRangeChange}
        onToggleCourt={handleToggleCourt}
        onResetCourts={handleResetCourts}
      />

      {/* 4 Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-text">
            {t("lineage.total_cases")}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {filteredTotal.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-text">
            {t("lineage.year_range")}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {yearFrom}–{yearTo}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-text">
            {t("lineage.peak_year")}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {peakYear.year}
          </p>
          <p className="text-[10px] text-muted-text">
            {peakYear.count.toLocaleString()} {t("chart.cases")}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-text">
            {t("lineage.courts_count")}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
            {visibleCourtCount}
          </p>
        </div>
      </div>

      {/* Volume Chart card */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-base font-semibold text-foreground">
            {t("lineage.timeline_chart_title")}
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setChartMode("bar")}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                chartMode === "bar"
                  ? "bg-accent text-white"
                  : "bg-surface text-muted-text hover:bg-surface-hover",
              )}
            >
              <BarChart3 className="h-3 w-3" />
              {t("lineage.chart_mode_bar")}
            </button>
            <button
              type="button"
              onClick={() => setChartMode("area")}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                chartMode === "area"
                  ? "bg-accent text-white"
                  : "bg-surface text-muted-text hover:bg-surface-hover",
              )}
            >
              <AreaChartIcon className="h-3 w-3" />
              {t("lineage.chart_mode_area")}
            </button>
            <button
              type="button"
              onClick={() => setNormalized((p) => !p)}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                normalized
                  ? "bg-accent text-white"
                  : "bg-surface text-muted-text hover:bg-surface-hover",
              )}
            >
              <Percent className="h-3 w-3" />
              {t("lineage.chart_normalize")}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <TimelineChart
              data={lineageData}
              yearFrom={yearFrom}
              yearTo={yearTo}
              hiddenCourts={effectiveHiddenCourts}
              chartMode={chartMode}
              normalized={normalized}
            />
          </div>
        </div>

        {/* Colour legend */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border-light pt-3">
          {ALL_COURTS.filter((c) => !effectiveHiddenCourts.has(c.code)).map(
            (court) => (
              <div key={court.code} className="flex items-center gap-1.5">
                <div
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{
                    backgroundColor: getCourtColor(court.code) ?? "#8b8680",
                  }}
                />
                <span className="font-mono text-[11px] text-muted-text">
                  {court.code}
                </span>
              </div>
            ),
          )}
        </div>
      </div>

      {/* Gantt Timeline */}
      <LineageExplainer
        data={lineageData}
        hiddenCourts={effectiveHiddenCourts}
        groupFilter={groupFilter}
      />

      {/* Transition Impact */}
      {transitionImpacts.length > 0 && (
        <div>
          <h2 className="mb-3 font-heading text-base font-semibold text-foreground">
            {t("lineage.transition_impact_title")}
          </h2>
          <p className="mb-3 text-xs text-muted-text">
            {t("lineage.transition_impact_subtitle")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {transitionImpacts.map((impact) => (
              <div
                key={`${impact.from}-${impact.to}`}
                className="rounded-lg border border-border bg-card p-3"
              >
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="font-mono text-xs font-bold text-accent">
                    {impact.from}
                  </span>
                  <span className="text-muted-text">→</span>
                  <span className="font-mono text-xs font-bold text-accent">
                    {impact.to}
                  </span>
                  <span className="ml-auto rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted-text">
                    {impact.year}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[11px] leading-tight text-muted-text">
                      {t("lineage.transition_before")}
                    </p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {impact.beforeAvg.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] leading-tight text-muted-text">
                      {t("lineage.transition_after")}
                    </p>
                    <p className="text-sm font-semibold tabular-nums text-foreground">
                      {impact.afterAvg.toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] leading-tight text-muted-text">
                      {t("lineage.transition_change")}
                    </p>
                    <p
                      className={cn(
                        "text-sm font-bold tabular-nums",
                        impact.changePercent > 0
                          ? "text-success"
                          : impact.changePercent < 0
                            ? "text-danger"
                            : "text-muted-text",
                      )}
                    >
                      {impact.changePercent > 0 ? "+" : ""}
                      {impact.changePercent}%
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Court Statistics Table */}
      {courtStats.length > 0 && (
        <div>
          <h2 className="mb-3 font-heading text-base font-semibold text-foreground">
            {t("lineage.court_table_title")}
          </h2>
          <CourtVolumeTable stats={courtStats} />
        </div>
      )}

      {/* Help text */}
      <div className="flex items-start gap-3 rounded-md border border-border-light bg-surface p-4 text-sm text-muted-text">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>{t("lineage.help_text")}</p>
      </div>
    </div>
  );
}
