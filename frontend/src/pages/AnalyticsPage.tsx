import {
  useState,
  useMemo,
  useTransition,
  useEffect,
  useCallback,
} from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { AnalyticsFilters } from "@/components/shared/AnalyticsFilters";
import { AdvancedFilterPanel } from "@/components/analytics/AdvancedFilterPanel";
import { SuccessRateCalculator } from "@/components/analytics/SuccessRateCalculator";
import { OutcomeAnalysisSection } from "@/components/analytics/OutcomeAnalysisSection";
import { FlowTrendsSection } from "@/components/analytics/FlowTrendsSection";
import { ConceptIntelligenceSection } from "@/components/analytics/ConceptIntelligenceSection";
import { VisaFamiliesSection } from "@/components/analytics/VisaFamiliesSection";
import { AnalyticsInsightsPanel } from "@/components/analytics/AnalyticsInsightsPanel";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import { useAnalyticsFilterOptions } from "@/hooks/use-analytics";
import type {
  AnalyticsFilterOption,
  AnalyticsFilterParams,
} from "@/types/case";

const CURRENT_YEAR = new Date().getFullYear();
const DEFAULT_YEAR_FROM = 2000;

const OUTCOME_TYPES = [
  "Affirmed",
  "Dismissed",
  "Remitted",
  "Set Aside",
  "Allowed",
  "Refused",
  "Withdrawn",
  "Other",
];

const DEFAULT_OUTCOME_OPTIONS: AnalyticsFilterOption[] = OUTCOME_TYPES.map(
  (value) => ({ value, count: 0 }),
);

export function AnalyticsPage() {
  const { t } = useTranslation();
  const [isPending, startTransition] = useTransition();
  const [court, setCourt] = useState("");
  const [yearFrom, setYearFrom] = useState(DEFAULT_YEAR_FROM);
  const [yearTo, setYearTo] = useState(CURRENT_YEAR);
  const [selectedNatures, setSelectedNatures] = useState<string[]>([]);
  const [selectedSubclasses, setSelectedSubclasses] = useState<string[]>([]);
  const [selectedOutcomes, setSelectedOutcomes] = useState<string[]>([]);

  const handleCourtChange = (value: string) => {
    startTransition(() => setCourt(value));
  };
  const handleYearRangeChange = (from: number, to: number) => {
    startTransition(() => {
      setYearFrom(from);
      setYearTo(to);
    });
  };
  const handleNaturesChange = (value: string[]) => {
    startTransition(() => setSelectedNatures(value));
  };
  const handleSubclassesChange = (value: string[]) => {
    startTransition(() => setSelectedSubclasses(value));
  };
  const handleOutcomesChange = (value: string[]) => {
    startTransition(() => setSelectedOutcomes(value));
  };
  const resetAllFilters = useCallback(() => {
    startTransition(() => {
      setCourt("");
      setYearFrom(DEFAULT_YEAR_FROM);
      setYearTo(CURRENT_YEAR);
      setSelectedNatures([]);
      setSelectedSubclasses([]);
      setSelectedOutcomes([]);
    });
  }, [startTransition]);

  const {
    data: analyticsFilterOptions,
    isLoading: isFilterOptionsLoading,
    isError: isFilterOptionsError,
    error: filterOptionsError,
    refetch: refetchFilterOptions,
  } = useAnalyticsFilterOptions({
    court: court || undefined,
    yearFrom,
    yearTo,
  });

  const filters: AnalyticsFilterParams = useMemo(
    () => ({
      court: court || undefined,
      yearFrom,
      yearTo,
      caseNatures: selectedNatures.length ? selectedNatures : undefined,
      visaSubclasses: selectedSubclasses.length
        ? selectedSubclasses
        : undefined,
      outcomeTypes: selectedOutcomes.length ? selectedOutcomes : undefined,
    }),
    [
      court,
      yearFrom,
      yearTo,
      selectedNatures,
      selectedSubclasses,
      selectedOutcomes,
    ],
  );
  const hasAnyFilter =
    Boolean(court) ||
    yearFrom !== DEFAULT_YEAR_FROM ||
    yearTo !== CURRENT_YEAR ||
    selectedNatures.length > 0 ||
    selectedSubclasses.length > 0 ||
    selectedOutcomes.length > 0;

  const scopeSummary = useMemo(() => {
    const parts: string[] = [
      court || t("filters.all_courts"),
      `${yearFrom}–${yearTo}`,
    ];
    if (selectedNatures.length > 0) {
      parts.push(`${t("analytics.case_nature")}: ${selectedNatures.length}`);
    }
    if (selectedSubclasses.length > 0) {
      parts.push(
        `${t("analytics.visa_subclass")}: ${selectedSubclasses.length}`,
      );
    }
    if (selectedOutcomes.length > 0) {
      parts.push(`${t("filters.outcome")}: ${selectedOutcomes.length}`);
    }
    return parts.join(" • ");
  }, [
    court,
    selectedNatures.length,
    selectedOutcomes.length,
    selectedSubclasses.length,
    t,
    yearFrom,
    yearTo,
  ]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA"
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key.toLowerCase() === "r" && hasAnyFilter) {
        e.preventDefault();
        resetAllFilters();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [hasAnyFilter, resetAllFilters]);

  return (
    <div
      className={`space-y-6 ${isPending ? "opacity-70 transition-opacity" : ""}`}
    >
      <section
        className="space-y-3 rounded-lg border border-border bg-card p-4"
        data-testid="analytics-filter-scope"
      >
        <PageHeader
          title={t("analytics.title")}
          description={t("analytics.subtitle")}
          meta={<span>{scopeSummary}</span>}
          actions={
            hasAnyFilter ? (
              <button
                type="button"
                aria-keyshortcuts="R"
                onClick={resetAllFilters}
                className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-text hover:bg-surface hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("analytics.reset_all_filters")}
              </button>
            ) : null
          }
        />
        <div>
          <h2 className="text-sm font-medium text-foreground">
            {t("analytics.filters_scope_title")}
          </h2>
          <p className="text-xs text-muted-text">
            {t("analytics.filters_scope_desc")}
          </p>
        </div>
        {hasAnyFilter && (
          <div className="rounded-md border border-border-light bg-surface px-3 py-2 text-xs text-muted-text">
            {t("analytics.keyboard_shortcuts")}
          </div>
        )}
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-text">
            {t("analytics.year_label")} / {t("filters.court")}
          </h3>
          <AnalyticsFilters
            court={court}
            yearFrom={yearFrom}
            yearTo={yearTo}
            onCourtChange={handleCourtChange}
            onYearRangeChange={handleYearRangeChange}
          />
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-text">
            {t("analytics.advanced_filters", {
              defaultValue: "Advanced Filters",
            })}
          </h3>
          <AdvancedFilterPanel
            caseNatures={analyticsFilterOptions?.case_natures ?? []}
            visaSubclasses={analyticsFilterOptions?.visa_subclasses ?? []}
            outcomeTypes={
              analyticsFilterOptions?.outcome_types ?? DEFAULT_OUTCOME_OPTIONS
            }
            selectedNatures={selectedNatures}
            selectedSubclasses={selectedSubclasses}
            selectedOutcomes={selectedOutcomes}
            onNaturesChange={handleNaturesChange}
            onSubclassesChange={handleSubclassesChange}
            onOutcomesChange={handleOutcomesChange}
          />
        </div>
        {isFilterOptionsError && (
          <ApiErrorState
            title={t("errors.failed_to_load", {
              name: t("filters.filter"),
            })}
            message={
              filterOptionsError instanceof Error
                ? filterOptionsError.message
                : t("errors.unable_to_load_message")
            }
            onRetry={() => {
              void refetchFilterOptions();
            }}
          />
        )}
      </section>

      <AnalyticsInsightsPanel
        data={analyticsFilterOptions}
        isLoading={isFilterOptionsLoading}
      />

      <section className="space-y-4" data-testid="analytics-success-estimate">
        <div>
          <h2 className="font-semibold text-foreground">
            {t("analytics.quick_estimate_title")}
          </h2>
          <p className="text-sm text-muted-text">
            {t("analytics.quick_estimate_desc")}
          </p>
        </div>
        <SuccessRateCalculator filters={filters} />
      </section>

      <OutcomeAnalysisSection filters={filters} />

      <FlowTrendsSection filters={filters} />

      <ConceptIntelligenceSection filters={filters} />

      <VisaFamiliesSection filters={filters} />
    </div>
  );
}
