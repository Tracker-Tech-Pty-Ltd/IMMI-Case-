import { Link, useLocation } from "react-router-dom";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { JudgeCompareCard } from "@/components/judges/JudgeCompareCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoader } from "@/components/shared/PageLoader";
import { useJudgeCompare } from "@/hooks/use-judges";

function useQueryNames() {
  const { search } = useLocation();
  return useMemo(() => {
    const params = new URLSearchParams(search);
    const raw = params.get("names") ?? "";
    return raw
      .split(",")
      .map((name) => decodeURIComponent(name.trim()))
      .filter(Boolean)
      .slice(0, 4);
  }, [search]);
}

export function JudgeComparePage() {
  const { t } = useTranslation();
  const names = useQueryNames();
  const { data, isLoading, isError, error, refetch } = useJudgeCompare(names);

  const gridCols =
    (data?.judges.length ?? 0) >= 4
      ? "lg:grid-cols-2 xl:grid-cols-4"
      : "lg:grid-cols-2";

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("pages.judge_comparison.title")}
        description={t("pages.judge_comparison.interpretation_hint", {
          defaultValue:
            "Compare each judge by outcome mix, top visa subclasses, and yearly approval trend. Use tooltip values to read exact case counts and percentages.",
        })}
        actions={
          <Link
            to="/judge-profiles"
            className="text-sm font-medium text-accent hover:underline"
          >
            ← {t("pages.judge_comparison.back_to_profiles")}
          </Link>
        }
      />
      {names.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-text">
            {t("pages.judge_comparison.selected_judges_label", {
              defaultValue: "Selected judges",
            })}
          </span>
          {names.map((name) => (
            <span
              key={name}
              className="rounded-full border border-border-light/60 bg-surface px-2 py-0.5 text-xs text-foreground"
            >
              {name}
            </span>
          ))}
        </div>
      )}

      {names.length < 2 ? (
        <EmptyState
          title={t("pages.judge_comparison.min_judges")}
          description={t("pages.judge_comparison.description")}
        />
      ) : isLoading ? (
        <PageLoader />
      ) : isError ? (
        <ApiErrorState
          title={t("judges.profile_load_failed")}
          message={
            error instanceof Error
              ? error.message
              : t("errors.api_request_failed", { name: "Judge Compare" })
          }
          onRetry={() => {
            void refetch();
          }}
        />
      ) : !data ? (
        <ApiErrorState
          title={t("judges.profile_not_found")}
          message={t("errors.payload_error", { name: "Judge Compare" })}
          onRetry={() => {
            void refetch();
          }}
        />
      ) : (
        <div className={`grid gap-4 ${gridCols}`}>
          {data.judges.map((judge) => (
            <JudgeCompareCard
              key={judge.judge.canonical_name ?? judge.judge.name}
              judge={judge}
            />
          ))}
        </div>
      )}
    </div>
  );
}
