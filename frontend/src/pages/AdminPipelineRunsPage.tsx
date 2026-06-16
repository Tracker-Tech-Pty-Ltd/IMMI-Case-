import { useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Clock,
  Database,
  ShieldCheck,
  TimerReset,
} from "lucide-react";
import { fetchPipelineRuns } from "@/lib/api";
import type { PipelineRunRecord, PipelineRunsSummary } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatePanel } from "@/components/shared/StatePanel";
import { cn } from "@/lib/utils";

function isAdminRole(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

function formatMoney(value: number | null | undefined): string {
  return `$${Number(value ?? 0).toFixed(4)}`;
}

function statusClass(status: string): string {
  if (status === "ok") return "border-success/25 bg-success/10 text-success";
  if (status === "running") return "border-accent/25 bg-accent-muted text-accent";
  if (status === "aborted") return "border-warning/25 bg-warning/10 text-warning";
  if (status === "failed") return "border-danger/25 bg-danger/10 text-danger";
  return "border-border bg-surface text-muted-text";
}

function SummaryTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface text-accent">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-text">{label}</p>
          <p className="mt-0.5 truncate text-lg font-semibold text-foreground">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function PipelineRunRow({ run }: { run: PipelineRunRecord }) {
  return (
    <tr className="border-t border-border">
      <td className="whitespace-nowrap px-4 py-3 text-sm text-foreground">
        {formatDateTime(run.started_at)}
      </td>
      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium",
            statusClass(run.status),
          )}
        >
          {run.status}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-foreground">
        {run.court ?? "-"}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-muted-text">
        {run.phase}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm text-foreground">
        {run.discovered.toLocaleString()}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm text-foreground">
        {run.scraped.toLocaleString()}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm text-foreground">
        {run.extracted.toLocaleString()}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm text-foreground">
        {run.upserted.toLocaleString()}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm text-foreground">
        {formatMoney(run.cost_usd)}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm text-foreground">
        {run.errors.toLocaleString()}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-muted-text">
        {formatDuration(run.duration_seconds)}
      </td>
    </tr>
  );
}

function buildSummary(summary: PipelineRunsSummary | undefined) {
  return {
    total_runs: summary?.total_runs ?? 0,
    running_runs: summary?.running_runs ?? 0,
    failed_runs: summary?.failed_runs ?? 0,
    aborted_runs: summary?.aborted_runs ?? 0,
    discovered: summary?.discovered ?? 0,
    upserted: summary?.upserted ?? 0,
    llm_calls: summary?.llm_calls ?? 0,
    cost_usd: summary?.cost_usd ?? 0,
  };
}

export function AdminPipelineRunsPage() {
  const { t } = useTranslation();
  const { user, isAuthenticated, isLoading } = useAuth();
  const isAdmin = isAdminRole(user?.role);

  const { data, isFetching, error } = useQuery({
    queryKey: ["admin-pipeline-runs"],
    queryFn: () => fetchPipelineRuns(30),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: 30_000,
  });

  const summary = useMemo(() => buildSummary(data?.summary), [data?.summary]);
  const runs = data?.runs ?? [];

  if (!isLoading && !isAuthenticated) {
    return (
      <StatePanel
        tone="warning"
        align="start"
        icon={<ShieldCheck className="h-5 w-5" />}
        title={t("admin_pipeline.sign_in_title", {
          defaultValue: "Sign in required",
        })}
        description={t("admin_pipeline.sign_in_description", {
          defaultValue: "Pipeline operations are visible only to authenticated operators.",
        })}
        action={
          <Link
            to="/login"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
          >
            {t("auth.sign_in", { defaultValue: "Sign in" })}
          </Link>
        }
      />
    );
  }

  if (!isLoading && !isAdmin) {
    return (
      <StatePanel
        tone="error"
        align="start"
        icon={<AlertTriangle className="h-5 w-5" />}
        title={t("admin_pipeline.forbidden_title", {
          defaultValue: "Admin access required",
        })}
        description={t("admin_pipeline.forbidden_description", {
          defaultValue: "Your current tenant role cannot view pipeline run telemetry.",
        })}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin_pipeline.title", {
          defaultValue: "Pipeline Runs",
        })}
        description={t("admin_pipeline.subtitle", {
          defaultValue: "Cloudflare discovery, scrape, extraction, and staging upsert telemetry.",
        })}
        icon={<Activity className="h-5 w-5" />}
        meta={
          <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-medium text-muted-text">
            <TimerReset className="h-3 w-3" aria-hidden="true" />
            {isFetching
              ? t("states.loading", { defaultValue: "Loading" })
              : t("admin_pipeline.refresh_interval", {
                  defaultValue: "Refreshes every 30 seconds",
                })}
          </span>
        }
      />

      {error ? (
        <StatePanel
          tone="error"
          align="start"
          icon={<AlertTriangle className="h-5 w-5" />}
          title={t("admin_pipeline.load_failed_title", {
            defaultValue: "Unable to load pipeline runs",
          })}
          description={error instanceof Error ? error.message : String(error)}
        />
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label={t("admin_pipeline.total_runs_30d", {
            defaultValue: "Runs in 30 days",
          })}
          value={summary.total_runs.toLocaleString()}
          icon={<Database className="h-4 w-4" />}
        />
        <SummaryTile
          label={t("admin_pipeline.active_runs", {
            defaultValue: "Active runs",
          })}
          value={summary.running_runs.toLocaleString()}
          icon={<Activity className="h-4 w-4" />}
        />
        <SummaryTile
          label={t("admin_pipeline.upserted_30d", {
            defaultValue: "Staging upserts",
          })}
          value={summary.upserted.toLocaleString()}
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <SummaryTile
          label={t("admin_pipeline.cost_30d", {
            defaultValue: "LLM cost",
          })}
          value={formatMoney(summary.cost_usd)}
          icon={<Clock className="h-4 w-4" />}
        />
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-1 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-heading text-base font-semibold text-foreground">
            {t("admin_pipeline.recent_runs", {
              defaultValue: "Recent runs",
            })}
          </h2>
          <p className="text-xs text-muted-text">
            {t("admin_pipeline.safe_state_note", {
              defaultValue: "Current rollout writes only to the staging table while insert-only mode remains enabled.",
            })}
          </p>
        </div>
        {runs.length === 0 ? (
          <div className="px-4 py-8">
            <StatePanel
              contained={false}
              tone="neutral"
              icon={<Database className="h-5 w-5" />}
              title={t("admin_pipeline.empty_title", {
                defaultValue: "No pipeline runs yet",
              })}
              description={t("admin_pipeline.empty_description", {
                defaultValue: "Discovery telemetry will appear here after the first enabled Cloudflare cron tick or manual acceptance run.",
              })}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left">
              <thead className="bg-surface text-xs uppercase text-muted-text">
                <tr>
                  <th className="px-4 py-2 font-semibold">
                    {t("admin_pipeline.started", { defaultValue: "Started" })}
                  </th>
                  <th className="px-4 py-2 font-semibold">
                    {t("admin_pipeline.status", { defaultValue: "Status" })}
                  </th>
                  <th className="px-4 py-2 font-semibold">
                    {t("admin_pipeline.court", { defaultValue: "Court" })}
                  </th>
                  <th className="px-4 py-2 font-semibold">
                    {t("admin_pipeline.phase", { defaultValue: "Phase" })}
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">
                    {t("admin_pipeline.discovered", { defaultValue: "Discovered" })}
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">
                    {t("admin_pipeline.scraped", { defaultValue: "Scraped" })}
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">
                    {t("admin_pipeline.extracted", { defaultValue: "Extracted" })}
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">
                    {t("admin_pipeline.upserted", { defaultValue: "Upserted" })}
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">
                    {t("admin_pipeline.cost", { defaultValue: "Cost" })}
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">
                    {t("admin_pipeline.errors", { defaultValue: "Errors" })}
                  </th>
                  <th className="px-4 py-2 text-right font-semibold">
                    {t("admin_pipeline.duration", { defaultValue: "Duration" })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <PipelineRunRow key={run.run_id} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
