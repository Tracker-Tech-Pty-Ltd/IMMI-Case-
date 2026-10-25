import {
  useState,
  useMemo,
  useTransition,
  useEffect,
  useCallback,
} from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { parseAnalyticsScope } from "@/lib/analytics-scope";
import { ArrowDownRight, RotateCcw } from "lucide-react";
import { CodexSticker } from "@/components/shared/CodexSticker";
import type { CodexStickerId } from "@/lib/codex-stickers";
import "@/styles/research-codex.css";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { court, yearFrom, yearTo } = parseAnalyticsScope(searchParams);
  const [selectedNatures, setSelectedNatures] = useState<string[]>([]);
  const [selectedSubclasses, setSelectedSubclasses] = useState<string[]>([]);
  const [selectedOutcomes, setSelectedOutcomes] = useState<string[]>([]);

  const handleCourtChange = (value: string) => {
    startTransition(() => setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set("court", value);
      else next.delete("court");
      return next;
    }));
  };
  const handleYearRangeChange = (from: number, to: number) => {
    startTransition(() => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set("year_from", String(from));
        next.set("year_to", String(to));
        return next;
      });
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
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        next.delete("court");
        next.delete("year_from");
        next.delete("year_to");
        return next;
      });
      setSelectedNatures([]);
      setSelectedSubclasses([]);
      setSelectedOutcomes([]);
    });
  }, [startTransition, setSearchParams]);

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
      className={`codex-research-page codex-analytics space-y-6 ${isPending ? "opacity-70 transition-opacity" : ""}`}
    >
      <section
        className="codex-report-header space-y-3 rounded-lg border border-border bg-card p-4"
        data-testid="analytics-filter-scope"
      >
        <PageHeader
          icon={<CodexSticker id="analytics" className="codex-page-emblem" />}
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

      <nav className="codex-chapter-nav" aria-label={t("analytics.sections_label", { defaultValue: "Analysis chapters" })}>
        {([
          ["history", t("analytics.quick_estimate_title", { defaultValue: "Historical outcomes" }), "summary"],
          ["outcomes", t("analytics.outcome_snapshot", { defaultValue: "Outcome analysis" }), "courts"],
          ["flows", t("analytics.flow_timing_analysis", { defaultValue: "Flow and timing" }), "calendar"],
          ["concepts", t("analytics.concept_intelligence", { defaultValue: "Legal concepts" }), "research"],
          ["visas", t("analytics.visa_families", { defaultValue: "Visa families" }), "taxonomy"],
        ] satisfies [string, string, CodexStickerId][]).map(([id, label, sticker], index) => (
          <a key={id} href={`#analytics-${id}`} onClick={() => {
            // Let native hash navigation focus the chapter, then align after
            // offscreen charts have exchanged estimated heights for real ones.
            requestAnimationFrame(() => requestAnimationFrame(() => {
              document.getElementById(`analytics-${id}`)?.scrollIntoView({ block: "start", behavior: "instant" });
            }));
          }}>
            <span className="codex-chapter-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <CodexSticker id={sticker} />
            <span className="codex-chapter-label">{label}</span>
            <ArrowDownRight className="codex-chapter-arrow" aria-hidden="true" />
          </a>
        ))}
      </nav>

      <AnalyticsInsightsPanel
        data={analyticsFilterOptions}
        isLoading={isFilterOptionsLoading}
      />

      <section id="analytics-history" tabIndex={-1} className="codex-analysis-chapter space-y-4" data-testid="analytics-success-estimate">
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

      <div id="analytics-outcomes" tabIndex={-1} className="codex-analysis-chapter"><OutcomeAnalysisSection filters={filters} /></div>

      <div id="analytics-flows" tabIndex={-1} className="codex-analysis-chapter"><FlowTrendsSection filters={filters} /></div>

      <div id="analytics-concepts" tabIndex={-1} className="codex-analysis-chapter"><ConceptIntelligenceSection filters={filters} /></div>

      <div id="analytics-visas" tabIndex={-1} className="codex-analysis-chapter"><VisaFamiliesSection filters={filters} /></div>
    </div>
  );
}
