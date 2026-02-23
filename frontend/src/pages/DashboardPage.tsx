import { useState, useMemo } from "react";
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
  GitBranch,
  Bookmark,
  Info,
} from "lucide-react";
import { useStats, useTrends } from "@/hooks/use-stats";
import { useSavedSearches } from "@/hooks/use-saved-searches";
import { StatCard } from "@/components/dashboard/StatCard";
import { CourtChart } from "@/components/dashboard/CourtChart";
import { NatureChart } from "@/components/dashboard/NatureChart";
import { TrendChart } from "@/components/dashboard/TrendChart";
import { SubclassChart } from "@/components/dashboard/SubclassChart";
import { SavedSearchCard } from "@/components/saved-searches/SavedSearchCard";
import { CourtBadge } from "@/components/shared/CourtBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { AnalyticsFilters } from "@/components/shared/AnalyticsFilters";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { downloadExportFile } from "@/lib/api";
import type { AnalyticsFilterParams } from "@/types/case";

const CURRENT_YEAR = new Date().getFullYear();

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
  const [courtView, setCourtView] = useState<"chart" | "table">("chart");

  if (isLoading && !stats) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-text">
        {t("common.loading_ellipsis")}
      </div>
    );
  }

  if (isError && !stats) {
    const message =
      error instanceof Error
        ? error.message
        : t("errors.api_request_failed", { name: "Dashboard" });
    return (
      <ApiErrorState
        title={t("errors.failed_to_load", { name: "Dashboard" })}
        message={message}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  if (!stats) {
    return (
      <ApiErrorState
        title={t("errors.data_unavailable", { name: "Dashboard" })}
        message={t("errors.payload_error", { name: "Dashboard" })}
        onRetry={() => {
          void refetch();
        }}
      />
    );
  }

  if (stats.total_cases === 0 && !isFetching) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t("dashboard.title")}
          </h1>
          <p className="text-sm text-muted-text">
            {t("dashboard.subtitle_empty")}
          </p>
        </div>
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
              <button
                onClick={() => navigate("/pipeline")}
                className="mt-2 rounded-md bg-accent px-6 py-2 text-sm font-medium text-white hover:bg-accent-light"
              >
                {t("buttons.start_pipeline")}
              </button>
            </div>
          }
        />
      </div>
    );
  }

  const sortedCourts = Object.entries(stats.courts).toSorted(
    ([, a], [, b]) => b - a,
  );
  const natureCount = Object.keys(stats.natures || {}).length;
  const trends = trendsData?.trends ?? [];

  return (
    <div className="space-y-6">
      {/* Header + Filters */}
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t("dashboard.title")}
          </h1>
          <p className="text-sm text-muted-text">{t("dashboard.subtitle")}</p>
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
      </div>

      {/* Row 1: 4 Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("dashboard.total_cases")}
          value={stats.total_cases}
          icon={<FileText className="h-5 w-5" />}
        />
        <StatCard
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
          title={t("dashboard.courts_tribunals")}
          value={Object.keys(stats.courts).length}
          icon={<Database className="h-5 w-5" />}
        />
        <StatCard
          title={t("dashboard.case_categories")}
          value={natureCount}
          icon={<Layers className="h-5 w-5" />}
          description={
            natureCount > 0
              ? t("dashboard.classified", {
                  count: Object.values(stats.natures).reduce(
                    (a, b) => a + b,
                    0,
                  ),
                })
              : undefined
          }
        />
      </div>

      {/* Row 2: Court Bar Chart + Year Trend Area Chart */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Court distribution */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-heading text-base font-semibold">
              {t("dashboard.cases_by_court")}
            </h2>
            <div className="flex gap-1">
              <button
                onClick={() => setCourtView("chart")}
                className={
                  courtView === "chart"
                    ? "rounded p-1 bg-accent-muted text-accent"
                    : "rounded p-1 text-muted-text hover:text-foreground"
                }
              >
                <BarChart3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setCourtView("table")}
                className={
                  courtView === "table"
                    ? "rounded p-1 bg-accent-muted text-accent"
                    : "rounded p-1 text-muted-text hover:text-foreground"
                }
              >
                <Table className="h-4 w-4" />
              </button>
            </div>
          </div>
          {courtView === "chart" ? (
            <CourtChart data={stats.courts} type="bar" />
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

        {/* Year trend area chart */}
        <div className="flex flex-col rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 font-heading text-base font-semibold">
            {t("dashboard.year_trend")}
          </h2>
          {trends.length > 0 ? (
            <TrendChart data={trends} />
          ) : (
            <CourtChart data={stats.years} type="bar" />
          )}
        </div>
      </div>

      {/* Row 3: Nature Chart + Visa Subclass Chart */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Case nature distribution */}
        {Object.keys(stats.natures || {}).length > 0 && (
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 font-heading text-base font-semibold">
              {t("dashboard.case_categories_dist")}
            </h2>
            <NatureChart data={stats.natures} />
          </div>
        )}

        {/* Visa subclass distribution */}
        {Object.keys(stats.visa_subclasses || {}).length > 0 && (
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 font-heading text-base font-semibold">
              {t("dashboard.top_visa_subclasses")}
            </h2>
            <SubclassChart data={stats.visa_subclasses} />
          </div>
        )}
      </div>

      {/* Quick actions + Export */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <button
          onClick={() => navigate("/download")}
          className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-accent hover:shadow-md"
        >
          <div className="rounded-md bg-accent-muted p-2 text-accent">
            <Download className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium text-foreground">
            {t("nav.download")}
          </span>
        </button>
        <button
          onClick={() => navigate("/pipeline")}
          className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-accent hover:shadow-md"
        >
          <div className="rounded-md bg-accent-muted p-2 text-accent">
            <GitBranch className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium text-foreground">
            {t("nav.pipeline")}
          </span>
        </button>
        <button
          onClick={() => downloadExportFile("csv")}
          className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-accent hover:shadow-md"
        >
          <div className="rounded-md bg-accent-muted p-2 text-accent">
            <Download className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium text-foreground">
            {t("buttons.export_csv")}
          </span>
        </button>
        <button
          onClick={() => downloadExportFile("json")}
          className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-accent hover:shadow-md"
        >
          <div className="rounded-md bg-accent-muted p-2 text-accent">
            <Download className="h-4 w-4" />
          </div>
          <span className="text-sm font-medium text-foreground">
            {t("buttons.export_json")}
          </span>
        </button>
      </div>

      {/* Saved Searches */}
      {savedSearches.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {savedSearches.slice(0, 5).map((search) => (
              <SavedSearchCard
                key={search.id}
                search={search}
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
        <div className="rounded-lg border border-border bg-card p-4">
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
