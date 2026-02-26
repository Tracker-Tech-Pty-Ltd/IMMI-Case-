import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BarChart2, Scale, CreditCard, Hash } from "lucide-react";
import type {
  AnalyticsAdvancedFilterOptions,
  AnalyticsFilterOption,
} from "@/types/case";

interface AnalyticsInsightsPanelProps {
  data: AnalyticsAdvancedFilterOptions | undefined;
  isLoading: boolean;
}

function topOption(options: AnalyticsFilterOption[]): AnalyticsFilterOption | null {
  if (!options.length) return null;
  return options.reduce((best, cur) => (cur.count > best.count ? cur : best));
}

function sharePct(count: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

interface InsightChipProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  testid?: string;
}

function InsightChip({ icon, label, value, sub, testid }: InsightChipProps) {
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-border bg-surface/60 px-3 py-2.5"
      data-testid={testid}
    >
      <span className="shrink-0 text-accent">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-text">
          {label}
        </p>
        <p className="truncate font-semibold text-foreground" title={value}>
          {value}
        </p>
        {sub && (
          <p className="text-[11px] text-muted-text">{sub}</p>
        )}
      </div>
    </div>
  );
}

function SkeletonChip() {
  return (
    <div className="animate-pulse flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-border bg-surface/60 px-3 py-2.5">
      <div className="h-4 w-4 rounded bg-border" />
      <div className="flex-1 space-y-1.5">
        <div className="h-2.5 w-1/2 rounded bg-border" />
        <div className="h-4 w-3/4 rounded bg-border" />
      </div>
    </div>
  );
}

export function AnalyticsInsightsPanel({
  data,
  isLoading,
}: AnalyticsInsightsPanelProps) {
  const { t } = useTranslation();

  const insights = useMemo(() => {
    if (!data) return null;
    const total = data.query.total_matching;
    const topOutcome = topOption(data.outcome_types);
    const topNature = topOption(data.case_natures);
    const topVisa = topOption(data.visa_subclasses);
    return { total, topOutcome, topNature, topVisa };
  }, [data]);

  if (!isLoading && !insights) return null;

  const iconClass = "h-4 w-4";

  return (
    <div
      className="flex flex-wrap gap-2"
      data-testid="analytics-insights-panel"
      aria-label={t("analytics.insights_label", {
        defaultValue: "Analytics auto-insights",
      })}
    >
      {isLoading ? (
        <>
          <SkeletonChip />
          <SkeletonChip />
          <SkeletonChip />
          <SkeletonChip />
        </>
      ) : (
        insights && (
          <>
            <InsightChip
              icon={<Hash className={iconClass} />}
              label={t("analytics.insights_total_label", {
                defaultValue: "Matching Cases",
              })}
              value={insights.total.toLocaleString()}
              testid="insight-chip-total"
            />
            {insights.topOutcome && (
              <InsightChip
                icon={<Scale className={iconClass} />}
                label={t("analytics.insights_top_outcome_label", {
                  defaultValue: "Top Outcome",
                })}
                value={insights.topOutcome.value}
                sub={`${sharePct(insights.topOutcome.count, insights.total)} ${t("analytics.insights_of_cases", { defaultValue: "of cases" })}`}
                testid="insight-chip-outcome"
              />
            )}
            {insights.topNature && (
              <InsightChip
                icon={<BarChart2 className={iconClass} />}
                label={t("analytics.insights_top_nature_label", {
                  defaultValue: "Top Case Nature",
                })}
                value={insights.topNature.value}
                sub={`${sharePct(insights.topNature.count, insights.total)} ${t("analytics.insights_of_cases", { defaultValue: "of cases" })}`}
                testid="insight-chip-nature"
              />
            )}
            {insights.topVisa && (
              <InsightChip
                icon={<CreditCard className={iconClass} />}
                label={t("analytics.insights_top_visa_label", {
                  defaultValue: "Top Visa Class",
                })}
                value={`SV ${insights.topVisa.value}`}
                sub={`${sharePct(insights.topVisa.count, insights.total)} ${t("analytics.insights_of_cases", { defaultValue: "of cases" })}`}
                testid="insight-chip-visa"
              />
            )}
          </>
        )
      )}
    </div>
  );
}
