import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Search,
  Download,
  Database,
  FileText,
  ArrowRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchJobStatus } from "@/lib/api";

const TYPE_META: Record<
  string,
  { labelKey: string; icon: typeof Search; color: string }
> = {
  search: { labelKey: "common.search", icon: Search, color: "text-info" },
  download: { labelKey: "nav.download", icon: Download, color: "text-success" },
  "bulk download": {
    labelKey: "jobs.job_type",
    icon: Download,
    color: "text-success",
  },
  update: { labelKey: "common.update", icon: Database, color: "text-accent" },
};

export function JobStatusPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [errorsExpanded, setErrorsExpanded] = useState(false);
  const [startTime] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: status } = useQuery({
    queryKey: ["job-status"],
    queryFn: fetchJobStatus,
    refetchInterval: (query) => (query.state.data?.running ? 2000 : 5000),
  });

  // Timer for running job
  useEffect(() => {
    if (status?.running) {
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [status?.running, startTime]);

  if (!status) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-text">
        {t("common.loading_ellipsis")}
      </div>
    );
  }

  const running = status.running;
  const jobType = status.type ?? "";
  const typeMeta = TYPE_META[jobType];
  const TypeIcon = typeMeta?.icon ?? FileText;
  const total = status.total ?? 0;
  const completed = status.completed ?? 0;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const errors = status.errors ?? [];
  const results = status.results ?? [];
  const message = status.message ?? status.progress ?? "";
  const isDone = !running && (completed > 0 || results.length > 0);
  const hasError = !running && errors.length > 0 && !isDone;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const quickLinks = [
    { labelKey: "nav.cases", icon: FileText, to: "/cases" },
    { labelKey: "nav.dashboard", icon: Database, to: "/" },
    { labelKey: "nav.download", icon: Download, to: "/download" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <Clock className="h-6 w-6 text-accent" />
          <h1 className="text-2xl font-semibold text-foreground">
            {t("pages.job_status.title")}
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-text">{t("jobs.subtitle")}</p>
      </div>

      {/* Main Status Card */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start gap-4">
          {/* Status icon */}
          <div
            className={`rounded-full p-3 ${
              running
                ? "bg-accent-muted"
                : hasError
                  ? "bg-danger/10"
                  : isDone
                    ? "bg-success/10"
                    : "bg-surface"
            }`}
          >
            {running ? (
              <div className="animate-spin">
                <Loader2 className="h-8 w-8 text-accent" />
              </div>
            ) : hasError ? (
              <XCircle className="h-8 w-8 text-danger" />
            ) : isDone ? (
              <CheckCircle className="h-8 w-8 text-success" />
            ) : (
              <Clock className="h-8 w-8 text-muted-text" />
            )}
          </div>

          {/* Status text */}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">
                {running
                  ? t("pages.job_status.job_running")
                  : hasError
                    ? t("pages.job_status.job_failed")
                    : isDone
                      ? t("pages.job_status.job_completed")
                      : t("pages.job_status.no_active_job")}
              </h2>
              {jobType && typeMeta && (
                <span
                  className={`flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium ${typeMeta.color}`}
                >
                  <TypeIcon className="h-3 w-3" />
                  {t(typeMeta.labelKey)}
                </span>
              )}
            </div>

            {message && (
              <p className="mt-1 text-sm text-muted-text">{message}</p>
            )}

            {/* Timer */}
            {running && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-text">
                <Clock className="h-3 w-3" /> {t("pages.job_status.elapsed")}:{" "}
                {formatTime(elapsed)}
              </p>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {running && total > 0 && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-text">
                {completed.toLocaleString()} / {total.toLocaleString()}
              </span>
              <span className="font-mono text-foreground">{progressPct}%</span>
            </div>
            <div className="mt-1.5 h-3 rounded-full bg-surface">
              <div
                className="h-3 rounded-full bg-accent transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Idle state actions */}
        {!running && !isDone && !hasError && (
          <div className="mt-4 rounded-md bg-surface p-4 text-center">
            <p className="text-sm text-muted-text">
              {t("pages.job_status.no_job_running")}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {[
                { labelKey: "nav.download", to: "/download" },
                { labelKey: "nav.pipeline", to: "/pipeline" },
              ].map((link) => (
                <button
                  key={link.to}
                  onClick={() => navigate(link.to)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-card"
                >
                  {t(link.labelKey)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Activity Timeline (results) */}
      {results.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="mb-4 font-heading text-lg font-semibold">
            {t("pages.job_status.activity")}
          </h3>
          <div className="space-y-3">
            {results
              .slice(-10)
              .reverse()
              .map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <p className="text-sm text-foreground">{item}</p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Error Section */}
      {errors.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-danger/30 bg-card">
          <button
            onClick={() => setErrorsExpanded(!errorsExpanded)}
            className="flex w-full items-center justify-between p-4"
          >
            <h3 className="flex items-center gap-2 text-sm font-medium text-danger">
              <AlertCircle className="h-4 w-4" />{" "}
              {t("pages.job_status.error_count", { count: errors.length })}
            </h3>
            {errorsExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-text" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-text" />
            )}
          </button>
          {errorsExpanded && (
            <div className="max-h-60 overflow-auto border-t border-danger/20 p-4">
              <div className="space-y-1.5">
                {errors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
                    <span className="text-danger">{err}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Completion Quick Links */}
      {isDone && !running && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="mb-3 font-heading text-lg font-semibold">
            {t("pages.job_status.next_steps")}
          </h3>
          <div className="grid gap-2 sm:grid-cols-4">
            {quickLinks.map(({ labelKey, icon: Icon, to }) => (
              <button
                key={to}
                onClick={() => navigate(to)}
                className="flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-all hover:border-accent hover:shadow-md"
              >
                <div className="rounded-md bg-accent-muted p-2 text-accent">
                  <Icon className="h-4 w-4" />
                </div>
                <span className="flex-1 text-sm font-medium text-foreground">
                  {t(labelKey)}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-text" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
