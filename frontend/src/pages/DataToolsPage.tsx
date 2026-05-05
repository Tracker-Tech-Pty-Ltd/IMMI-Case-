import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Database,
  GitBranch,
  Download,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  Search,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchPipelineStatus, fetchJobStatus, type JobStatus } from "@/lib/api";
import { useStats } from "@/hooks/use-stats";
import { StatCard } from "@/components/dashboard/StatCard";
import { PageHeader } from "@/components/shared/PageHeader";

interface PipelineStatus {
  running?: boolean;
  phase?: string;
  phase_progress?: string;
  overall_progress?: number;
  phases_completed?: string[];
  stats?: {
    crawl: {
      total_found: number;
      new_added: number;
      strategies_used: Record<string, number>;
    };
    clean: { year_fixed: number; dupes_removed: number; validated: number };
    download: {
      downloaded: number;
      failed: number;
      skipped: number;
      retried: number;
    };
  };
  errors?: string[];
  log?: Array<{
    timestamp: string;
    phase: string;
    level: string;
    category: string;
    message: string;
  }>;
}

function formatRelativeTime(
  iso: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!iso) return t("data_tools.freshness_unknown");
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return t("data_tools.freshness_unknown");
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return t("data_tools.freshness_just_now");
  if (diffSec < 3600)
    return t("data_tools.freshness_minutes_ago", {
      minutes: Math.floor(diffSec / 60),
    });
  if (diffSec < 86400)
    return t("data_tools.freshness_hours_ago", {
      hours: Math.floor(diffSec / 3600),
    });
  return t("data_tools.freshness_days_ago", {
    days: Math.floor(diffSec / 86400),
  });
}

export function DataToolsPage() {
  const { t } = useTranslation();
  const { data: stats } = useStats();
  const [logExpanded, setLogExpanded] = useState(true);
  const [errorsExpanded, setErrorsExpanded] = useState(false);

  const { data: pipelineStatus } = useQuery<PipelineStatus>({
    queryKey: ["pipeline-status"],
    queryFn: fetchPipelineStatus,
    refetchInterval: (query) => {
      const data = query.state.data as PipelineStatus | undefined;
      return data?.running ? 2000 : 15000;
    },
  });

  const { data: jobStatus } = useQuery<JobStatus>({
    queryKey: ["job-status"],
    queryFn: fetchJobStatus,
    refetchInterval: (query) => (query.state.data?.running ? 2000 : 15000),
  });

  const totalCases = stats?.total_cases ?? 0;
  const withFullText = stats?.with_full_text ?? 0;
  const remaining = Math.max(0, totalCases - withFullText);
  const coveragePct =
    totalCases > 0 ? Math.round((withFullText / totalCases) * 100) : 0;

  const running = pipelineStatus?.running ?? false;
  const phase = pipelineStatus?.phase;
  const overallProgress = Math.min(
    100,
    Math.max(0, pipelineStatus?.overall_progress ?? 0),
  );
  const phasesCompleted = pipelineStatus?.phases_completed ?? [];
  const pipelineStats = pipelineStatus?.stats;
  const logs = pipelineStatus?.log ?? [];
  const errors = pipelineStatus?.errors ?? [];

  const lastLogTimestamp =
    logs.length > 0 ? logs[logs.length - 1]?.timestamp : undefined;
  const freshnessLabel = running
    ? t("data_tools.freshness_running")
    : formatRelativeTime(lastLogTimestamp, t);

  const job = jobStatus;
  const jobRunning = job?.running ?? false;
  const jobType = job?.type ?? "";
  const jobMessage = job?.message ?? job?.progress ?? "";
  const jobTotal = job?.total ?? 0;
  const jobCompleted = job?.completed ?? 0;
  const jobErrors: string[] = (job?.errors as string[] | undefined) ?? [];
  const jobResults: string[] = (job?.results as string[] | undefined) ?? [];
  const jobIsDone =
    !jobRunning && (jobCompleted > 0 || jobResults.length > 0);
  const jobHasError =
    !jobRunning && jobErrors.length > 0 && !jobIsDone;
  const jobProgressPct =
    jobTotal > 0 ? Math.round((jobCompleted / jobTotal) * 100) : 0;

  const PHASES = [
    {
      id: "crawl",
      label: t("pipeline.crawl_title"),
      icon: Database,
      desc: t("pipeline.crawl_description"),
    },
    {
      id: "clean",
      label: t("pipeline.clean_title"),
      icon: GitBranch,
      desc: t("pipeline.clean_description"),
    },
    {
      id: "download",
      label: t("pipeline.download_title"),
      icon: Download,
      desc: t("pipeline.download_description"),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("data_tools.title")}
        description={t("data_tools.subtitle")}
        icon={<Activity className="h-5 w-5" />}
        meta={
          <span
            aria-live="polite"
            className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-medium text-muted-text"
          >
            <Clock className="h-3 w-3" aria-hidden="true" />
            {t("data_tools.freshness_label")}: {freshnessLabel}
          </span>
        }
      />

      {/* §1 Database snapshot */}
      <section aria-labelledby="snapshot-heading" className="space-y-4">
        <h2
          id="snapshot-heading"
          className="font-heading text-base font-semibold text-foreground"
        >
          {t("data_tools.snapshot_title")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title={t("dashboard.total_cases")}
            value={totalCases}
            icon={<FileText className="h-5 w-5" />}
          />
          <StatCard
            title={t("dashboard.with_full_text")}
            value={withFullText}
            icon={<Database className="h-5 w-5" />}
            description={t("data_tools.coverage_pct", { pct: coveragePct })}
          />
          <StatCard
            title={t("download.stats_remaining")}
            value={remaining}
            icon={<Download className="h-5 w-5" />}
            description={
              remaining > 0
                ? t("download.need_downloading")
                : t("download.all_complete")
            }
          />
          <StatCard
            title={t("filters.court")}
            value={Object.keys(stats?.courts ?? {}).length}
            icon={<GitBranch className="h-5 w-5" />}
          />
        </div>
      </section>

      {/* §2 Pipeline activity */}
      <section aria-labelledby="pipeline-heading" className="space-y-3">
        <h2
          id="pipeline-heading"
          className="font-heading text-base font-semibold text-foreground"
        >
          {t("data_tools.pipeline_section_title")}
        </h2>

        {running ? (
          <div className="rounded-lg border border-accent/30 bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="animate-spin" aria-hidden="true">
                  <Loader2 className="h-5 w-5 text-accent" />
                </div>
                <span className="font-medium text-foreground">
                  {t("pipeline.live_monitor")}
                </span>
              </div>
              <span className="rounded-full bg-accent-muted px-3 py-0.5 text-xs font-medium text-accent">
                {phase ?? t("states.in_progress")}
              </span>
            </div>

            {/* Overall progress */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm text-muted-text">
                <span>{t("pipeline.overall_progress")}</span>
                <span aria-hidden="true">{overallProgress}%</span>
              </div>
              <div
                className="mt-1 h-2 rounded-full bg-surface"
                role="progressbar"
                aria-valuenow={overallProgress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("pipeline.overall_progress")}
              >
                <div
                  className="h-2 rounded-full bg-accent transition-all duration-500"
                  style={{ width: `${overallProgress}%` }}
                />
              </div>
            </div>

            {pipelineStatus?.phase_progress && (
              <p className="mb-4 text-sm text-muted-text">
                {pipelineStatus.phase_progress}
              </p>
            )}

            {/* Phase indicators */}
            <ul className="grid gap-2 sm:grid-cols-3" role="list">
              {PHASES.map((p) => {
                const isActive = phase === p.id;
                const isDone = phasesCompleted.includes(p.id);
                const Icon = p.icon;
                const stateLabel = isDone
                  ? t("states.completed")
                  : isActive
                    ? t("states.in_progress")
                    : t("states.idle");
                return (
                  <li
                    key={p.id}
                    className={`flex items-center gap-3 rounded-md border p-3 ${
                      isActive
                        ? "border-accent bg-accent-muted"
                        : isDone
                          ? "border-success/30 bg-success/5"
                          : "border-border"
                    }`}
                    aria-label={`${p.label}: ${stateLabel}`}
                  >
                    {isDone ? (
                      <CheckCircle
                        className="h-5 w-5 shrink-0 text-success"
                        aria-hidden="true"
                      />
                    ) : isActive ? (
                      <div className="animate-spin shrink-0" aria-hidden="true">
                        <Loader2 className="h-5 w-5 text-accent" />
                      </div>
                    ) : (
                      <Icon
                        className="h-5 w-5 shrink-0 text-muted-text"
                        aria-hidden="true"
                      />
                    )}
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {p.label}
                      </p>
                      <p className="text-xs text-muted-text">{p.desc}</p>
                    </div>
                  </li>
                );
              })}
            </ul>

            {pipelineStats && (
              <div className="mt-4 grid gap-2 text-xs text-muted-text sm:grid-cols-3">
                <div className="rounded-md bg-surface p-2">
                  <span className="font-medium text-foreground">
                    {t("pipeline.crawl_title")}:
                  </span>{" "}
                  {pipelineStats.crawl.total_found} {t("pipeline.found")},{" "}
                  {pipelineStats.crawl.new_added} {t("pipeline.new")}
                </div>
                <div className="rounded-md bg-surface p-2">
                  <span className="font-medium text-foreground">
                    {t("pipeline.clean_title")}:
                  </span>{" "}
                  {pipelineStats.clean.dupes_removed} {t("pipeline.dupes")},{" "}
                  {pipelineStats.clean.validated} {t("pipeline.valid")}
                </div>
                <div className="rounded-md bg-surface p-2">
                  <span className="font-medium text-foreground">
                    {t("pipeline.download_title")}:
                  </span>{" "}
                  {pipelineStats.download.downloaded} ok,{" "}
                  {pipelineStats.download.failed} {t("states.failed")}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <CheckCircle
                className="h-5 w-5 shrink-0 text-success"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t("data_tools.pipeline_idle_title")}
                </p>
                <p className="mt-1 text-xs text-muted-text">
                  {lastLogTimestamp
                    ? t("data_tools.pipeline_idle_with_last", {
                        when: formatRelativeTime(lastLogTimestamp, t),
                      })
                    : t("data_tools.pipeline_idle_no_history")}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* §3 Recent job */}
      <section aria-labelledby="job-heading" className="space-y-3">
        <h2
          id="job-heading"
          className="font-heading text-base font-semibold text-foreground"
        >
          {t("data_tools.recent_job_title")}
        </h2>

        <div className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-start gap-4">
            <div
              className={`rounded-full p-2.5 ${
                jobRunning
                  ? "bg-accent-muted"
                  : jobHasError
                    ? "bg-danger/10"
                    : jobIsDone
                      ? "bg-success/10"
                      : "bg-surface"
              }`}
            >
              {jobRunning ? (
                <div className="animate-spin" aria-hidden="true">
                  <Loader2 className="h-5 w-5 text-accent" />
                </div>
              ) : jobHasError ? (
                <XCircle className="h-5 w-5 text-danger" aria-hidden="true" />
              ) : jobIsDone ? (
                <CheckCircle
                  className="h-5 w-5 text-success"
                  aria-hidden="true"
                />
              ) : (
                <Clock className="h-5 w-5 text-muted-text" aria-hidden="true" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-semibold text-foreground"
                aria-live="polite"
              >
                {jobRunning
                  ? t("pages.job_status.job_running")
                  : jobHasError
                    ? t("pages.job_status.job_failed")
                    : jobIsDone
                      ? t("pages.job_status.job_completed")
                      : t("data_tools.no_recent_job")}
              </p>
              {jobType && (
                <p className="mt-0.5 text-xs text-muted-text">
                  <Search
                    className="inline h-3 w-3 mr-1"
                    aria-hidden="true"
                  />
                  {jobType}
                </p>
              )}
              {jobMessage && (
                <p className="mt-1 text-sm text-muted-text break-words">
                  {jobMessage}
                </p>
              )}
            </div>
          </div>

          {jobRunning && jobTotal > 0 && (
            <div className="mt-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-text">
                  {jobCompleted.toLocaleString()} /{" "}
                  {jobTotal.toLocaleString()}
                </span>
                <span
                  className="font-mono text-foreground"
                  aria-hidden="true"
                >
                  {jobProgressPct}%
                </span>
              </div>
              <div
                className="mt-1.5 h-3 rounded-full bg-surface"
                role="progressbar"
                aria-valuenow={jobProgressPct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("pipeline.overall_progress")}
              >
                <div
                  className="h-3 rounded-full bg-accent transition-all duration-300"
                  style={{ width: `${jobProgressPct}%` }}
                />
              </div>
            </div>
          )}

          {jobResults.length > 0 && (
            <div className="mt-5 border-t border-border pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-text">
                {t("pages.job_status.activity")}
              </p>
              <ul className="space-y-2" role="list">
                {jobResults
                  .slice(-5)
                  .reverse()
                  .map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                        aria-hidden="true"
                      />
                      <span className="text-foreground">{item}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* §4 Pipeline logs */}
      <section aria-labelledby="logs-heading" className="space-y-3">
        <h2
          id="logs-heading"
          className="font-heading text-base font-semibold text-foreground"
        >
          {t("data_tools.logs_section_title")}
        </h2>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <button
            type="button"
            onClick={() => setLogExpanded(!logExpanded)}
            aria-expanded={logExpanded}
            aria-controls="pipeline-logs-panel"
            className="flex w-full items-center justify-between p-4 text-left"
          >
            <span className="text-sm font-medium text-foreground">
              {t("pipeline.pipeline_logs", { count: logs.length })}
            </span>
            {logExpanded ? (
              <ChevronUp
                className="h-4 w-4 text-muted-text"
                aria-hidden="true"
              />
            ) : (
              <ChevronDown
                className="h-4 w-4 text-muted-text"
                aria-hidden="true"
              />
            )}
          </button>
          {logExpanded && (
            <div
              id="pipeline-logs-panel"
              className="max-h-80 overflow-auto border-t border-border bg-surface p-4"
            >
              {logs.length === 0 ? (
                <p className="text-sm text-muted-text">
                  {t("pipeline.no_logs_yet")}
                </p>
              ) : (
                <ul className="space-y-1" role="list">
                  {[...logs]
                    .reverse()
                    .slice(0, 50)
                    .map((entry, i) => (
                      <li key={i} className="flex gap-2 text-xs">
                        <span className="shrink-0 font-mono text-muted-text">
                          {entry.timestamp?.slice(11) ?? ""}
                        </span>
                        <span
                          className={`shrink-0 font-medium ${
                            entry.level === "error"
                              ? "text-danger"
                              : entry.level === "warning"
                                ? "text-warning"
                                : "text-foreground"
                          }`}
                        >
                          [{entry.phase}]
                        </span>
                        <span className="text-foreground">
                          {entry.message}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>

      {/* §5 Errors (only when present) */}
      {errors.length > 0 && (
        <section aria-labelledby="errors-heading" className="space-y-3">
          <h2 id="errors-heading" className="sr-only">
            {t("pipeline.pipeline_errors")}
          </h2>
          <div className="overflow-hidden rounded-lg border border-danger/30 bg-card">
            <button
              type="button"
              onClick={() => setErrorsExpanded(!errorsExpanded)}
              aria-expanded={errorsExpanded}
              aria-controls="pipeline-errors-panel"
              className="flex w-full items-center justify-between p-4 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-danger">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                {t("pipeline.pipeline_errors")} ({errors.length})
              </span>
              {errorsExpanded ? (
                <ChevronUp
                  className="h-4 w-4 text-danger"
                  aria-hidden="true"
                />
              ) : (
                <ChevronDown
                  className="h-4 w-4 text-danger"
                  aria-hidden="true"
                />
              )}
            </button>
            {errorsExpanded && (
              <div
                id="pipeline-errors-panel"
                className="max-h-60 overflow-auto border-t border-danger/20 p-4"
              >
                <ul className="space-y-1.5" role="list">
                  {errors.map((err, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <XCircle
                        className="mt-0.5 h-3 w-3 shrink-0 text-danger"
                        aria-hidden="true"
                      />
                      <span className="text-danger break-words">{err}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* §6 How the pipeline works (educational, always visible) */}
      <section aria-labelledby="info-heading" className="space-y-3">
        <h2
          id="info-heading"
          className="font-heading text-base font-semibold text-foreground"
        >
          {t("pipeline.how_pipeline_works")}
        </h2>

        <div className="rounded-lg border border-border bg-card p-5">
          <ol className="grid gap-3 sm:grid-cols-3" role="list">
            {PHASES.map((p, i) => {
              const Icon = p.icon;
              return (
                <li
                  key={p.id}
                  className="rounded-md border border-border-light p-4"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-white"
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
                  </div>
                  <h3 className="font-medium text-foreground">{p.label}</h3>
                  <p className="mt-1 text-xs text-muted-text">{p.desc}</p>
                </li>
              );
            })}
          </ol>
          <div className="mt-4 flex items-start gap-2 rounded-md bg-info/5 p-3 text-xs text-info">
            <Clock
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p>{t("pipeline.auto_phases_info")}</p>
              <p className="mt-1">{t("pipeline.fallback_info")}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
