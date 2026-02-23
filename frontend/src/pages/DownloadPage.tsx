import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Download,
  Play,
  Loader2,
  CheckCircle,
  FileText,
  BookOpen,
  AlertCircle,
} from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { startDownload, fetchJobStatus, downloadExportFile } from "@/lib/api";
import { useStats } from "@/hooks/use-stats";
import { ProgressRing } from "@/components/shared/ProgressRing";
import { StatCard } from "@/components/dashboard/StatCard";
import { toast } from "sonner";

export function DownloadPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: stats } = useStats();
  const [courtFilter, setCourtFilter] = useState("");
  const [batchSize, setBatchSize] = useState("100");

  const { data: jobStatus } = useQuery({
    queryKey: ["job-status"],
    queryFn: fetchJobStatus,
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
  });

  const startMutation = useMutation({
    mutationFn: () =>
      startDownload({
        databases: courtFilter
          ? [courtFilter]
          : ["ARTA", "FCA", "FedCFamC2G", "HCA", "FCCA"],
        limit: Number(batchSize),
      }),
    onSuccess: () => {
      toast.success(
        t("states.in_progress", { defaultValue: "Download job started" }),
      );
      navigate("/jobs");
    },
    onError: (e) => toast.error(e.message),
  });

  const totalCases = stats?.total_cases ?? 0;
  const downloaded = stats?.with_full_text ?? 0;
  const remaining = totalCases - downloaded;
  const isComplete = remaining === 0 && totalCases > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          {t("download.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-text">{t("download.subtitle")}</p>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title={t("download.stats_title")}
          value={totalCases}
          icon={<FileText className="h-5 w-5" />}
        />
        <StatCard
          title={t("download.stats_downloaded")}
          value={downloaded}
          icon={<BookOpen className="h-5 w-5" />}
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
      </div>

      {/* Progress ring + form */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex items-center justify-center rounded-lg border border-border bg-card p-6">
          <div className="relative">
            <ProgressRing
              value={downloaded}
              max={totalCases}
              size={160}
              strokeWidth={10}
              label={t("download.stats_downloaded")}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5">
          {isComplete ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle className="mb-4 h-12 w-12 text-success" />
              <h2 className="text-lg font-semibold text-foreground">
                {t("download.all_downloaded")}
              </h2>
              <p className="mt-2 text-sm text-muted-text">
                {t("download.all_cases_full_text", {
                  count: totalCases,
                })}
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => navigate("/cases")}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light"
                >
                  {t("buttons.browse_cases")}
                </button>
                <button
                  onClick={() => navigate("/pipeline")}
                  className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface"
                >
                  {t("buttons.start_pipeline")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <h2 className="mb-3 font-heading text-base font-semibold">
                {t("download.download_settings")}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-secondary-text">
                    {t("download.court_filter_label")}
                  </label>
                  <select
                    value={courtFilter}
                    onChange={(e) => setCourtFilter(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
                  >
                    <option value="">{t("download.all_courts_label")}</option>
                    <option value="ARTA">ARTA</option>
                    <option value="FCA">FCA</option>
                    <option value="FCCA">FCCA</option>
                    <option value="FedCFamC2G">FedCFamC2G</option>
                    <option value="HCA">HCA</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-secondary-text">
                    {t("download.batch_size_label")}
                  </label>
                  <select
                    value={batchSize}
                    onChange={(e) => setBatchSize(e.target.value)}
                    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
                  >
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="250">250</option>
                    <option value="500">500</option>
                    <option value="1000">1,000</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={() => startMutation.mutate()}
                  disabled={jobStatus?.running || startMutation.isPending}
                  className="flex items-center gap-1 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light disabled:opacity-50"
                >
                  <Play className="h-4 w-4" />
                  {jobStatus?.running
                    ? t("download.running_status")
                    : t("download.start_download")}
                </button>
                {jobStatus?.running && (
                  <span className="flex items-center gap-2 text-sm text-muted-text">
                    <div className="animate-spin">
                      <Loader2 className="h-4 w-4" />
                    </div>{" "}
                    {jobStatus.message}
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-md bg-info/5 p-3 text-xs text-info">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <p>{t("download.rate_limit_info")}</p>
                  <p className="mt-1">{t("download.extraction_info")}</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Export data */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="mb-2 font-heading text-base font-semibold">
          {t("download.export_data_title")}
        </h2>
        <p className="mb-4 text-sm text-muted-text">
          {t("download.export_data_subtitle")}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => downloadExportFile("csv")}
            className="flex items-center gap-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface"
          >
            <Download className="h-4 w-4" /> {t("buttons.export_csv")}
          </button>
          <button
            onClick={() => downloadExportFile("json")}
            className="flex items-center gap-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-surface"
          >
            <Download className="h-4 w-4" /> {t("buttons.export_json")}
          </button>
        </div>
      </div>
    </div>
  );
}
