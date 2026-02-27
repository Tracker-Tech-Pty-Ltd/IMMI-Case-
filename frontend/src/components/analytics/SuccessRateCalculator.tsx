import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Microscope } from "lucide-react";
import { useFilterOptions } from "@/hooks/use-cases";
import {
  useSuccessRate,
  useOutcomes,
  useLegalConcepts,
} from "@/hooks/use-analytics";
import { OutcomeFunnelChart } from "@/components/analytics/OutcomeFunnelChart";
import { ConceptComboTable } from "@/components/analytics/ConceptComboTable";
import { ConfidenceBadge } from "@/components/analytics/ConfidenceBadge";
import { SuccessRateDeepModal } from "@/components/analytics/SuccessRateDeepModal";
import { RiskGauge } from "@/components/analytics/RiskGauge";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import type { AnalyticsFilterParams } from "@/types/case";
import { cn } from "@/lib/utils";

interface SuccessRateCalculatorProps {
  filters: AnalyticsFilterParams;
}

export function SuccessRateCalculator({ filters }: SuccessRateCalculatorProps) {
  const { t } = useTranslation();
  const [visaSubclass, setVisaSubclass] = useState("");
  const [caseNature, setCaseNature] = useState("");
  const [selectedConcepts, setSelectedConcepts] = useState<string[]>([]);
  const [deepModalOpen, setDeepModalOpen] = useState(false);

  const { data: filterOptions, isError: isFilterOptionsError } =
    useFilterOptions();
  const { data: outcomes, isError: isOutcomesError } = useOutcomes(filters);
  const { data: conceptOptions, isError: isConceptOptionsError } =
    useLegalConcepts(filters, 18);

  const successParams = useMemo(
    () => ({
      ...filters,
      visa_subclass: visaSubclass || undefined,
      case_nature: caseNature || undefined,
      legal_concepts: selectedConcepts,
    }),
    [filters, visaSubclass, caseNature, selectedConcepts],
  );

  const { data, isLoading, isError, error, refetch } =
    useSuccessRate(successParams);

  const subclassOptions = useMemo(() => {
    if (!outcomes) return [];
    return Object.keys(outcomes.by_subclass).toSorted(
      (a, b) => Number(a) - Number(b),
    );
  }, [outcomes?.by_subclass]);

  const conceptList = conceptOptions?.concepts ?? [];

  const toggleConcept = (concept: string) => {
    setSelectedConcepts((prev) =>
      prev.includes(concept)
        ? prev.filter((c) => c !== concept)
        : [...prev, concept],
    );
  };

  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      data-testid="success-rate-calculator"
    >
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-foreground">
          {t("analytics.success_rate_calculator")}
        </h2>
        <p className="text-sm text-muted-text">
          {t("analytics.success_calculator_desc")}
        </p>
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-x-1.5 text-xs font-medium text-muted-text">
        <span>{t("analytics.visa_subclass")}</span>
        <select
          value={visaSubclass}
          onChange={(e) => setVisaSubclass(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">{t("common.all")}</option>
          {subclassOptions.map((subclass) => (
            <option key={subclass} value={subclass}>
              {subclass}
            </option>
          ))}
        </select>

        <span className="ml-2">{t("analytics.case_nature")}</span>
        <select
          value={caseNature}
          onChange={(e) => setCaseNature(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">{t("common.all")}</option>
          {(filterOptions?.natures ?? []).map((nature) => (
            <option key={nature} value={nature}>
              {nature}
            </option>
          ))}
        </select>

        <span className="ml-2">{t("analytics.legal_concepts_label")}</span>
        <div className="flex flex-wrap gap-1.5">
          {conceptList.slice(0, 12).map((concept) => {
            const active = selectedConcepts.includes(concept.name);
            return (
              <button
                key={concept.name}
                type="button"
                onClick={() => toggleConcept(concept.name)}
                className={cn(
                  "rounded-full px-2 py-1 text-xs",
                  active
                    ? "bg-accent text-white"
                    : "bg-surface text-muted-text hover:bg-accent-muted hover:text-accent",
                )}
              >
                {concept.name}
              </button>
            );
          })}
        </div>
      </div>

      {(isFilterOptionsError || isOutcomesError || isConceptOptionsError) && (
        <p className="mt-2 text-xs text-semantic-warning">
          {t("analytics.filter_data_partial_warning", {
            defaultValue:
              "Some filter options are temporarily unavailable. You can still run calculations with available filters.",
          })}
        </p>
      )}

      {isLoading ? (
        <div className="mt-4 text-sm text-muted-text">
          {t("analytics.loading_calculator")}
        </div>
      ) : isError ? (
        <div className="mt-4">
          <ApiErrorState
            title={t("errors.unable_to_load_data")}
            message={
              error instanceof Error
                ? error.message
                : t("errors.unable_to_load_message")
            }
            onRetry={() => {
              void refetch();
            }}
          />
        </div>
      ) : !data ? (
        <div className="mt-4 text-sm text-muted-text">{t("chart.no_data")}</div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-4">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-text">
                {t("analytics.success_rate")}
              </p>
              <p
                className="mt-1 text-3xl font-bold text-foreground"
                data-testid="success-rate-number"
              >
                {data.success_rate.overall.toFixed(1)}%
              </p>
              <p className="mt-1 text-xs text-muted-text">
                {data.query.total_matching.toLocaleString()}{" "}
                {t("analytics.matching_cases")}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <ConfidenceBadge totalMatching={data.query.total_matching} />
                <button
                  type="button"
                  onClick={() => setDeepModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-text hover:bg-surface hover:text-foreground"
                >
                  <Microscope className="h-3 w-3" />
                  {t("analytics.deep_dive", { defaultValue: "Deep Dive" })}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-center rounded-md border border-border p-3">
              <RiskGauge
                score={data.success_rate.overall}
                label={
                  data.success_rate.overall >= 65
                    ? t("analytics.favourable", { defaultValue: "Favourable" })
                    : data.success_rate.overall >= 40
                      ? t("analytics.moderate", { defaultValue: "Moderate" })
                      : t("analytics.unfavourable", {
                          defaultValue: "Unfavourable",
                        })
                }
              />
            </div>

            <div className="rounded-md border border-border p-3 lg:col-span-2">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-text">
                {t("analytics.outcome_funnel")}
              </p>
              <OutcomeFunnelChart
                winCount={data.success_rate.win_count}
                lossCount={data.success_rate.loss_count}
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-text">
                {t("analytics.top_concept_lift")}
              </p>
              <div className="space-y-2">
                {data.by_concept.slice(0, 6).map((item) => (
                  <div key={item.concept}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-foreground">{item.concept}</span>
                      <span className="text-muted-text">
                        {item.win_rate.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 rounded bg-surface">
                      <div
                        className="h-2 rounded bg-accent"
                        style={{ width: `${Math.min(item.win_rate, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col rounded-md border border-border p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-text">
                {t("analytics.win_trend")}
              </p>
              <div className="min-h-[180px] flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data.trend}
                    margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      opacity={0.35}
                    />
                    <XAxis
                      dataKey="year"
                      tick={{
                        fontSize: 11,
                        fill: "var(--color-text-secondary)",
                      }}
                    />
                    <YAxis
                      tick={{
                        fontSize: 11,
                        fill: "var(--color-text-secondary)",
                      }}
                    />
                    <Tooltip
                      formatter={(value: number | string | undefined) => [
                        `${Number(value ?? 0).toFixed(1)}%`,
                        t("analytics.success_rate"),
                      ]}
                      contentStyle={{
                        backgroundColor: "var(--color-background-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "var(--radius)",
                        color: "var(--color-text)",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="rate"
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-text">
              {t("analytics.top_concept_combinations")}
            </p>
            <ConceptComboTable combos={data.top_combos} />
          </div>
        </div>
      )}

      {data && (
        <SuccessRateDeepModal
          open={deepModalOpen}
          onClose={() => setDeepModalOpen(false)}
          filters={filters}
          currentRate={data.success_rate.overall}
          totalMatching={data.query.total_matching}
        />
      )}
    </section>
  );
}
