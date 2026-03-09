import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  GitBranch,
  Play,
  Square,
  Loader2,
  Zap,
  Database,
  Download,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle,
  Clock,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchPipelineStatus, pipelineAction } from "@/lib/api";
import { useStats } from "@/hooks/use-stats";
import { StatCard } from "@/components/dashboard/StatCard";
import { DatabaseCard } from "@/components/shared/DatabaseCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "sonner";

const DATABASES = [
  {
    code: "ARTA",
    name: "Administrative Review Tribunal",
    badge: "New" as const,
    badgeColor: "success" as const,
  },
  { code: "FCA", name: "Federal Court of Australia" },
  { code: "FedCFamC2G", name: "Federal Circuit & Family Court (Div 2)" },
  { code: "HCA", name: "High Court of Australia" },
  { code: "FCCA", name: "Federal Circuit Court of Australia" },
  {
    code: "AATA",
    name: "Administrative Appeals Tribunal",
    badge: "Ended Oct 2024" as const,
    badgeColor: "warning" as const,
  },
];

const currentYear = new Date().getFullYear();

interface PipelineStatus {
  running?: boolean;
  phase?: string;
  phase_progress?: string;
  overall_progress?: number;
  config?: Record<string, unknown>;
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
  current_strategy?: string;
  stop_requested?: boolean;
}

export function PipelinePage() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { data: stats } = useStats();

  const [selectedDbs, setSelectedDbs] = useState<Set<string>>(
    new Set(["ARTA", "FCA", "FedCFamC2G", "HCA", "FCCA"]),
  );
  const [startYear, setStartYear] = useState(currentYear - 1);
  const [endYear, setEndYear] = useState(currentYear);
  const [delay, setDelay] = useState("0.5");
  const [showCustom, setShowCustom] = useState(false);
  const [logExpanded, setLogExpanded] = useState(true);

  const { data: status } = useQuery<PipelineStatus>({
    queryKey: ["pipeline-status"],
    queryFn: fetchPipelineStatus,
    refetchInterval: (query) => {
      const data = query.state.data as PipelineStatus | undefined;
      return data?.running ? 2000 : 10000;
    },
  });

  const actionMutation = useMutation({
    mutationFn: (payload: {
      action: string;
      params?: Record<string, unknown>;
    }) => pipelineAction(payload.action, payload.params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline-status"] });
      toast.success(t("states.completed"));
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleDb = useCallback((code: string) => {
    setSelectedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const startPreset = (preset: "quick" | "full" | "download") => {
    const params: Record<string, unknown> = {};
    if (preset === "quick") {
      params.databases = ["ARTA", "FCA", "FedCFamC2G", "HCA", "FCCA"];
      params.start_year = currentYear - 1;
      params.end_year = currentYear;
      params.delay = 0.5;
    } else if (preset === "full") {
      params.databases = ["ARTA", "FCA", "FedCFamC2G", "HCA", "FCCA", "AATA"];
      params.start_year = 2010;
      params.end_year = currentYear;
      params.delay = 1.0;
    } else {
      params.databases = ["ARTA", "FCA", "FedCFamC2G", "HCA", "FCCA"];
      params.download_only = true;
    }
    actionMutation.mutate({ action: "start", params });
  };

  const startCustom = () => {
    actionMutation.mutate({
      action: "start",
      params: {
        databases: Array.from(selectedDbs),
        start_year: startYear,
        end_year: endYear,
        delay: Number(delay),
      },
    });
  };

  const running = status?.running ?? false;
  const phase = status?.phase;
  const pipelineStats = status?.stats;
  const logs = status?.log ?? [];
  const errors = status?.errors ?? [];
  const phasesCompleted = status?.phases_completed ?? [];
  const overallProgress = status?.overall_progress ?? 0;

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
        title={t("pipeline.title")}
        description={t("pipeline.subtitle")}
        icon={<GitBranch className="h-5 w-5" />}
      />

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard
          title={t("dashboard.total_cases")}
          value={stats?.total_cases ?? 0}
          icon={<Database className="h-5 w-5" />}
        />
        <StatCard
          title={t("dashboard.with_full_text")}
          value={stats?.with_full_text ?? 0}
          icon={<Download className="h-5 w-5" />}
        />
        <StatCard
          title={t("filters.court")}
          value={Object.keys(stats?.courts ?? {}).length}
          icon={<GitBranch className="h-5 w-5" />}
        />
        <StatCard
          title={t("pipeline.title")}
          value={running ? t("states.in_progress") : t("states.idle")}
          icon={
            running ? (
              <div className="animate-spin">
                <Loader2 className="h-5 w-5" />
              </div>
            ) : (
              <CheckCircle className="h-5 w-5" />
            )
          }
        />
      </div>

      {/* Quick Presets */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-3 font-heading text-base font-semibold">
          {t("pipeline.quick_preset")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <button
            onClick={() => startPreset("quick")}
            disabled={running || actionMutation.isPending}
            className="flex flex-col items-center gap-2 rounded-lg border border-border p-5 transition-all hover:border-accent hover:shadow-md disabled:opacity-50"
          >
            <div className="rounded-full bg-accent-muted p-3 text-accent">
              <Zap className="h-6 w-6" />
            </div>
            <span className="font-medium text-foreground">
              {t("pipeline.quick_preset")}
            </span>
            <span className="text-xs text-muted-text text-center">
              {t("pipeline.quick_preset_subtitle", {
                yearFrom: currentYear - 1,
                yearTo: currentYear,
              })}
            </span>
          </button>
          <button
            onClick={() => startPreset("full")}
            disabled={running || actionMutation.isPending}
            className="flex flex-col items-center gap-2 rounded-lg border border-border p-5 transition-all hover:border-accent hover:shadow-md disabled:opacity-50"
          >
            <div className="rounded-full bg-info/10 p-3 text-info">
              <Database className="h-6 w-6" />
            </div>
            <span className="font-medium text-foreground">
              {t("pipeline.full_preset")}
            </span>
            <span className="text-xs text-muted-text text-center">
              {t("pipeline.full_preset_subtitle", { currentYear })}
            </span>
          </button>
          <button
            onClick={() => startPreset("download")}
            disabled={running || actionMutation.isPending}
            className="flex flex-col items-center gap-2 rounded-lg border border-border p-5 transition-all hover:border-accent hover:shadow-md disabled:opacity-50"
          >
            <div className="rounded-full bg-success/10 p-3 text-success">
              <Download className="h-6 w-6" />
            </div>
            <span className="font-medium text-foreground">
              {t("pipeline.custom")}
            </span>
            <span className="text-xs text-muted-text text-center">
              {t("pipeline.download_only_subtitle")}
            </span>
          </button>
        </div>
      </div>

      {/* Custom Pipeline */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <button
          onClick={() => setShowCustom(!showCustom)}
          className="flex w-full items-center justify-between p-5"
        >
          <h2 className="font-heading text-base font-semibold">
            {t("pipeline.custom_label")}
          </h2>
          {showCustom ? (
            <ChevronUp className="h-5 w-5 text-muted-text" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-text" />
          )}
        </button>
        {showCustom && (
          <div className="border-t border-border p-5 pt-4">
            {/* Database selection */}
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-text">
                  {t("pipeline.databases_label")} (
                  {t("pipeline.databases_selected", {
                    count: selectedDbs.size,
                  })}
                  )
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setSelectedDbs(new Set(DATABASES.map((d) => d.code)))
                    }
                    className="text-xs text-accent hover:underline"
                  >
                    {t("pipeline.select_all")}
                  </button>
                  <button
                    onClick={() => setSelectedDbs(new Set())}
                    className="text-xs text-muted-text hover:text-foreground"
                  >
                    {t("pipeline.clear")}
                  </button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {DATABASES.map((db) => (
                  <DatabaseCard
                    key={db.code}
                    code={db.code}
                    name={db.name}
                    badge={db.badge}
                    badgeColor={db.badgeColor}
                    selected={selectedDbs.has(db.code)}
                    onToggle={toggleDb}
                  />
                ))}
              </div>
            </div>

            {/* Parameters */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-text">
                  {t("pipeline.start_year_label")}
                </label>
                <input
                  type="number"
                  min={2000}
                  max={2030}
                  value={startYear}
                  onChange={(e) => setStartYear(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-text">
                  {t("pipeline.end_year_label")}
                </label>
                <input
                  type="number"
                  min={2000}
                  max={2030}
                  value={endYear}
                  onChange={(e) => setEndYear(Number(e.target.value))}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-text">
                  {t("pipeline.request_delay_label")}
                </label>
                <select
                  value={delay}
                  onChange={(e) => setDelay(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
                >
                  <option value="0.5">{t("pipeline.delay_fast")}</option>
                  <option value="1.0">{t("pipeline.delay_default")}</option>
                  <option value="2.0">{t("pipeline.delay_safe")}</option>
                  <option value="5.0">{t("pipeline.delay_very_safe")}</option>
                </select>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={startCustom}
                disabled={
                  running || actionMutation.isPending || selectedDbs.size === 0
                }
                className="flex items-center gap-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light disabled:opacity-50"
              >
                <Play className="h-4 w-4" />
                {running ? t("download.running_status") : t("pipeline.start")}
              </button>
              {running && (
                <button
                  onClick={() => actionMutation.mutate({ action: "stop" })}
                  disabled={actionMutation.isPending}
                  className="flex items-center gap-1 rounded-md border border-danger/30 px-3 py-1.5 text-sm text-danger hover:bg-danger/5"
                >
                  <Square className="h-4 w-4" /> {t("pipeline.stop_pipeline")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Live Monitor */}
      {running && (
        <div className="rounded-lg border border-accent/30 bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="animate-spin">
                <Loader2 className="h-5 w-5 text-accent" />
              </div>
              <h2 className="font-heading text-base font-semibold">
                {t("pipeline.live_monitor")}
              </h2>
            </div>
            <span className="rounded-full bg-accent-muted px-3 py-0.5 text-xs font-medium text-accent">
              {phase ?? "Initializing"}
            </span>
          </div>

          {/* Overall Progress */}
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm text-muted-text">
              <span>{t("pipeline.overall_progress")}</span>
              <span>{overallProgress}%</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-surface">
              <div
                className="h-2 rounded-full bg-accent transition-all duration-500"
                style={{ width: `${Math.min(overallProgress, 100)}%` }}
              />
            </div>
          </div>

          {/* Phase progress */}
          {status?.phase_progress && (
            <p className="mb-4 text-sm text-muted-text">
              {status.phase_progress}
            </p>
          )}

          {/* Phase indicators */}
          <div className="grid gap-2 sm:grid-cols-3">
            {PHASES.map((p) => {
              const isActive = phase === p.id;
              const isDone = phasesCompleted.includes(p.id);
              const Icon = p.icon;
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 rounded-md border p-3 ${
                    isActive
                      ? "border-accent bg-accent-muted"
                      : isDone
                        ? "border-success/30 bg-success/5"
                        : "border-border"
                  }`}
                >
                  {isDone ? (
                    <CheckCircle className="h-5 w-5 shrink-0 text-success" />
                  ) : isActive ? (
                    <div className="animate-spin shrink-0">
                      <Loader2 className="h-5 w-5 text-accent" />
                    </div>
                  ) : (
                    <Icon className="h-5 w-5 shrink-0 text-muted-text" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {p.label}
                    </p>
                    <p className="text-xs text-muted-text">{p.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Stats */}
          {pipelineStats && (
            <div className="mt-4 grid gap-2 text-xs text-muted-text sm:grid-cols-3">
              <div className="rounded-md bg-surface p-2">
                <span className="font-medium text-foreground">
                  {t("pipeline.crawl_title")}:
                </span>{" "}
                {pipelineStats.crawl.total_found}{" "}
                {t("pipeline.found", { defaultValue: "found" })},{" "}
                {pipelineStats.crawl.new_added}{" "}
                {t("pipeline.new", { defaultValue: "new" })}
              </div>
              <div className="rounded-md bg-surface p-2">
                <span className="font-medium text-foreground">
                  {t("pipeline.clean_title")}:
                </span>{" "}
                {pipelineStats.clean.dupes_removed}{" "}
                {t("pipeline.dupes", { defaultValue: "dupes" })},{" "}
                {pipelineStats.clean.validated}{" "}
                {t("pipeline.valid", { defaultValue: "valid" })}
              </div>
              <div className="rounded-md bg-surface p-2">
                <span className="font-medium text-foreground">
                  {t("pipeline.download_title")}:
                </span>{" "}
                {pipelineStats.download.downloaded} ok,{" "}
                {pipelineStats.download.failed}{" "}
                {t("states.failed", { defaultValue: "fail" })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Log Viewer */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <button
          onClick={() => setLogExpanded(!logExpanded)}
          className="flex w-full items-center justify-between p-4"
        >
          <h2 className="font-heading text-lg font-semibold">
            {t("pipeline.pipeline_logs", { count: logs.length })}
          </h2>
          <span className="text-sm text-muted-text">
            {logExpanded ? t("common.collapse") : t("common.expand")}
          </span>
        </button>
        {logExpanded && (
          <div className="max-h-80 overflow-auto border-t border-border bg-surface p-4">
            {logs.length === 0 ? (
              <p className="text-sm text-muted-text">
                {t("pipeline.no_logs_yet")}
              </p>
            ) : (
              <div className="space-y-1">
                {[...logs]
                  .reverse()
                  .slice(0, 50)
                  .map((entry, i) => (
                    <div key={i} className="flex gap-2 text-xs">
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
                      <span className="text-foreground">{entry.message}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="rounded-lg border border-danger/30 bg-card p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-danger">
            <AlertCircle className="h-4 w-4" /> {t("pipeline.pipeline_errors")}{" "}
            ({errors.length})
          </h3>
          <div className="max-h-40 space-y-1 overflow-auto">
            {errors.map((err, i) => (
              <p key={i} className="text-xs text-danger">
                {err}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Pipeline Phases Info */}
      {!running && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="mb-3 font-heading text-base font-semibold">
            {t("pipeline.how_pipeline_works")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {PHASES.map((p, i) => {
              const Icon = p.icon;
              return (
                <div
                  key={p.id}
                  className="rounded-md border border-border-light p-4"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                      {i + 1}
                    </div>
                    <Icon className="h-4 w-4 text-accent" />
                  </div>
                  <h3 className="font-medium text-foreground">{p.label}</h3>
                  <p className="mt-1 text-xs text-muted-text">{p.desc}</p>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-md bg-info/5 p-3 text-xs text-info">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <p>
                {t("pipeline.auto_phases_info", {
                  defaultValue:
                    "The pipeline runs all three phases automatically with smart fallback strategies.",
                })}
              </p>
              <p className="mt-1">
                {t("pipeline.fallback_info", {
                  defaultValue:
                    "If a crawl strategy fails, it rotates to the next one (direct → viewdb → keyword search).",
                })}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
