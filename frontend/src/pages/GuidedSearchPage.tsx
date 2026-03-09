import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Search,
  ArrowRight,
  ArrowLeft,
  Scale,
  User,
  CheckCircle2,
  MapPin,
  FileText,
  Loader2,
} from "lucide-react";
import {
  useVisaLookup,
  useLegalConcepts,
  useJudgeAutocomplete,
  useCountries,
  useGuidedSearch,
} from "@/hooks/use-taxonomy";
import { CaseCard } from "@/components/cases/CaseCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { Pagination } from "@/components/shared/Pagination";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { ImmigrationCase } from "@/types/case";
import type { GuidedSearchParams } from "@/lib/api";

type FlowType = "find-precedents" | "assess-judge" | null;

interface FlowState {
  visa_subclass?: string;
  country?: string;
  legal_concepts: string[];
  judge_name?: string;
  judge_canonical_name?: string;
}

export function GuidedSearchPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const panelClass = "rounded-lg border border-border bg-card p-4 shadow-xs";
  const [selectedFlow, setSelectedFlow] = useState<FlowType>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [flowState, setFlowState] = useState<FlowState>({
    legal_concepts: [],
  });
  const [visaQuery, setVisaQuery] = useState("");
  const [judgeQuery, setJudgeQuery] = useState("");
  const [results, setResults] = useState<ImmigrationCase[] | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const { data: visaData, isLoading: visaLoading } = useVisaLookup(visaQuery);
  const { data: conceptsData } = useLegalConcepts();
  const { data: judgeData, isLoading: judgeLoading } =
    useJudgeAutocomplete(judgeQuery);
  const { data: countriesData } = useCountries();
  const guidedMutation = useGuidedSearch();

  const flowConfig = useMemo(
    () => ({
      "find-precedents": {
        title: t("guided_search.find_precedents_title", {
          defaultValue: "Find Precedents for My Case",
        }),
        description: t("guided_search.find_precedents_desc", {
          defaultValue:
            "Walk through a step-by-step search to find relevant case law for your visa application or appeal",
        }),
        icon: Scale,
        steps: [
          {
            title: t("guided_search.step_visa_subclass_title", {
              defaultValue: "Select Visa Subclass",
            }),
            description: t("guided_search.step_visa_subclass_desc", {
              defaultValue: "Enter the 3-digit visa subclass number",
            }),
          },
          {
            title: t("guided_search.step_country_title", {
              defaultValue: "Choose Country of Origin",
            }),
            description: t("guided_search.step_country_desc", {
              defaultValue: "Select the applicant's country (optional)",
            }),
          },
          {
            title: t("guided_search.step_legal_concepts_title", {
              defaultValue: "Select Legal Concepts",
            }),
            description: t("guided_search.step_legal_concepts_desc", {
              defaultValue:
                "Choose relevant legal principles (optional, up to 5)",
            }),
          },
        ],
      },
      "assess-judge": {
        title: t("guided_search.assess_judge_title", {
          defaultValue: "Assess Judge Patterns",
        }),
        description: t("guided_search.assess_judge_desc", {
          defaultValue:
            "Find a judge by name and view their decision patterns, success rates, and key statistics",
        }),
        icon: User,
        steps: [
          {
            title: t("guided_search.step_judge_name_title", {
              defaultValue: "Search Judge Name",
            }),
            description: t("guided_search.step_judge_name_desc", {
              defaultValue:
                "Enter the judge's last name (minimum 2 characters)",
            }),
          },
        ],
      },
    }),
    [t],
  );

  const handleFlowSelect = useCallback((flow: FlowType) => {
    setSelectedFlow(flow);
    setCurrentStep(1);
    setFlowState({ legal_concepts: [] });
    setResults(null);
    setVisaQuery("");
    setJudgeQuery("");
  }, []);

  const handleNext = useCallback(() => {
    if (!selectedFlow) return;
    const maxSteps = flowConfig[selectedFlow].steps.length;
    if (currentStep < maxSteps) {
      setCurrentStep((prev) => prev + 1);
    }
  }, [selectedFlow, currentStep, flowConfig]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1);
    } else {
      setSelectedFlow(null);
      setResults(null);
    }
  }, [currentStep]);

  const handleSubmit = useCallback(async () => {
    if (!selectedFlow) return;

    if (selectedFlow === "assess-judge") {
      const targetJudgeName = flowState.judge_canonical_name ?? flowState.judge_name;
      if (!targetJudgeName) {
        toast.error(
          t("guided_search.toast_please_select_judge", {
            defaultValue: "Please select a judge",
          }),
        );
        return;
      }
      navigate(`/judge-profiles/${encodeURIComponent(targetJudgeName)}`);
      return;
    }

    if (selectedFlow === "find-precedents") {
      if (!flowState.visa_subclass) {
        toast.error(
          t("guided_search.toast_please_select_visa", {
            defaultValue: "Please select a visa subclass",
          }),
        );
        return;
      }

      const params: GuidedSearchParams = {
        flow: selectedFlow,
        visa_subclass: flowState.visa_subclass,
        country: flowState.country,
        legal_concepts:
          flowState.legal_concepts.length > 0
            ? flowState.legal_concepts
            : undefined,
      };

      try {
        const result = await guidedMutation.mutateAsync(params);
        if (result.success && result.results) {
          setResults(result.results);
          toast.success(
            t("guided_search.toast_found_cases", {
              defaultValue: "Found {{count}} matching cases",
              count: result.total ?? 0,
            }),
          );
        } else {
          toast.error(
            t("guided_search.toast_no_cases_found", {
              defaultValue: "No cases found matching your criteria",
            }),
          );
          setResults([]);
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  }, [selectedFlow, flowState, guidedMutation, navigate, t]);

  const toggleConcept = useCallback(
    (conceptId: string) => {
      setFlowState((prev) => {
        const concepts = prev.legal_concepts;
        if (concepts.includes(conceptId)) {
          return {
            ...prev,
            legal_concepts: concepts.filter((c) => c !== conceptId),
          };
        } else if (concepts.length < 5) {
          return { ...prev, legal_concepts: [...concepts, conceptId] };
        } else {
          toast.error(
            t("guided_search.toast_max_concepts", {
              defaultValue: "Maximum 5 legal concepts allowed",
            }),
          );
          return prev;
        }
      });
    },
    [t],
  );

  const paginatedResults = useMemo(() => {
    if (!results) return [];
    const pageSize = 20;
    const start = (currentPage - 1) * pageSize;
    return results.slice(start, start + pageSize);
  }, [results, currentPage]);

  if (results) {
    return (
      <div className="container-padding space-y-6">
        <PageHeader
          title={t("guided_search.results_heading", {
            defaultValue: "Search Results",
          })}
          description={t("guided_search.results_found_count", {
            defaultValue: "Found {{count}} cases matching your criteria",
            count: results.length,
          })}
          actions={
            <button
              type="button"
              onClick={() => {
                setResults(null);
                setSelectedFlow(null);
                setCurrentPage(1);
              }}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("guided_search.new_search_btn", {
                defaultValue: "New Search",
              })}
            </button>
          }
        />

        {paginatedResults.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title={t("guided_search.no_cases_title", {
              defaultValue: "No cases found",
            })}
            description={t("guided_search.no_cases_desc", {
              defaultValue: "Try adjusting your search criteria",
            })}
          />
        ) : (
          <div className="space-y-4">
            {paginatedResults.map((c) => (
              <CaseCard
                key={c.case_id}
                case_={c}
                onClick={() => navigate(`/cases/${c.case_id}`)}
              />
            ))}
          </div>
        )}

        {results.length > 20 && (
          <div className="mt-6">
            <Pagination
              currentPage={currentPage}
              totalPages={Math.ceil(results.length / 20)}
              totalItems={results.length}
              pageSize={20}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </div>
    );
  }

  if (!selectedFlow) {
    return (
      <div className="container-padding space-y-8">
        <PageHeader
          title={t("guided_search.page_title", {
            defaultValue: "Guided Search",
          })}
          description={t("guided_search.page_subtitle", {
            defaultValue:
              "Choose a search flow to get started with finding relevant cases or judge information",
          })}
        />

        <div className="grid auto-rows-fr gap-4 md:grid-cols-2">
          {(Object.keys(flowConfig) as FlowType[])
            .filter((key): key is Exclude<FlowType, null> => key !== null)
            .map((flowKey) => {
              const flow = flowConfig[flowKey];
              const Icon = flow.icon;
              return (
                <button
                  key={flowKey}
                  type="button"
                  onClick={() => handleFlowSelect(flowKey)}
                  className="group relative flex h-full min-h-[200px] overflow-hidden rounded-lg border border-border bg-card p-5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-md"
                >
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-accent/10 p-3">
                      <Icon className="h-6 w-6 text-accent" />
                    </div>
                    <div className="flex-1">
                      <p className="text-lg font-semibold text-foreground group-hover:text-accent">
                        {flow.title}
                      </p>
                      <p className="mt-2 text-sm text-muted-text">
                        {flow.description}
                      </p>
                      <div className="mt-4 inline-flex rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-accent">
                          {t("guided_search.start_flow_btn", {
                            defaultValue: "Start flow",
                          })}
                          <ArrowRight className="h-4 w-4" />
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
        </div>

        <div className={`${panelClass} p-5`}>
          <h2 className="text-base font-semibold text-foreground">
            {t("guided_search.how_it_works_heading", {
              defaultValue: "How it works",
            })}
          </h2>
          <ul className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              t("guided_search.how_it_works_step1", {
                defaultValue: "Select a search flow based on your research goal",
              }),
              t("guided_search.how_it_works_step2", {
                defaultValue:
                  "Answer guided questions to build your search criteria",
              }),
              t("guided_search.how_it_works_step3", {
                defaultValue: "View results tailored to your specific needs",
              }),
            ].map((stepText, idx) => (
              <li
                key={idx}
                className="rounded-md border border-border bg-surface p-4 text-sm text-muted-text"
              >
                <div className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                  {idx + 1}
                </div>
                <p>{stepText}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const flow = flowConfig[selectedFlow];
  const currentStepConfig = flow.steps[currentStep - 1];
  const isLastStep = currentStep === flow.steps.length;

  return (
    <div className="container-padding space-y-6">
      <div className="mb-5">
        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-1 text-sm text-muted-text hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("guided_search.back_btn", { defaultValue: "Back" })}
          </button>
        </div>
        <h1 className="text-2xl font-semibold text-foreground">{flow.title}</h1>
        <p className="mt-1 text-sm text-muted-text">{flow.description}</p>
        <div className="mt-3 inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-text">
          {t("guided_search.step_progress_badge", {
            defaultValue: "Step {{current}} of {{total}}",
            current: currentStep,
            total: flow.steps.length,
          })}
        </div>
      </div>

      {/* Progress indicator */}
      <div className={`${panelClass}`}>
        <div className="flex items-center gap-2">
          {flow.steps.map((step, idx) => (
            <div key={idx} className="flex flex-1 items-center">
              <div className="flex flex-1 items-center gap-2">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 font-semibold",
                    idx + 1 < currentStep
                      ? "border-accent bg-accent text-white"
                      : idx + 1 === currentStep
                        ? "border-accent text-accent"
                        : "border-border text-muted-text",
                  )}
                >
                  {idx + 1 < currentStep ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    idx + 1
                  )}
                </div>
                <span
                  aria-current={idx + 1 === currentStep ? "step" : undefined}
                  className={cn(
                    "hidden text-sm font-medium md:block",
                    idx + 1 === currentStep
                      ? "text-foreground"
                      : "text-muted-text",
                  )}
                >
                  {step.title}
                </span>
              </div>
              {idx < flow.steps.length - 1 && (
                <div
                  className={cn(
                    "mx-2 h-0.5 flex-1",
                    idx + 1 < currentStep
                      ? "bg-accent"
                      : "bg-border",
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="mx-auto max-w-3xl">
        <div className={`${panelClass} p-6 md:p-8`}>
          <h2 className="text-xl font-semibold text-foreground">
            {currentStepConfig.title}
          </h2>
          <p className="mt-1 text-sm text-muted-text">
            {currentStepConfig.description}
          </p>

          <div className="mt-6 border-t border-border pt-6">
            {selectedFlow === "find-precedents" && currentStep === 1 && (
              <div>
                <label className="block text-sm font-medium text-foreground">
                  {t("guided_search.label_visa_subclass", {
                    defaultValue: "Visa Subclass",
                  })}
                </label>
                <input
                  type="text"
                  value={visaQuery}
                  onChange={(e) => setVisaQuery(e.target.value)}
                  placeholder={t("guided_search.placeholder_visa_subclass", {
                    defaultValue: "e.g., 866, 820, 457",
                  })}
                  className="mt-2 w-full rounded-lg border border-border bg-background px-4 py-2 text-foreground placeholder:text-muted-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
                {visaLoading && (
                  <div
                    className="mt-4 flex items-center gap-2 text-sm text-muted-text"
                    role="status"
                    aria-live="polite"
                  >
                    <div className="animate-spin">
                      <Loader2 className="h-4 w-4" />
                    </div>
                    {t("guided_search.searching_state", {
                      defaultValue: "Searching...",
                    })}
                  </div>
                )}
                {visaData && visaData.data.length > 0 && (
                  <div className="mt-4 space-y-2 rounded-lg border border-border bg-surface p-2">
                    {visaData.data.map((visa) => (
                      <button
                        key={visa.subclass}
                        type="button"
                        aria-pressed={flowState.visa_subclass === visa.subclass}
                        onClick={() => {
                          setFlowState((prev) => ({
                            ...prev,
                            visa_subclass: visa.subclass,
                          }));
                          setVisaQuery(visa.subclass);
                        }}
                        className={cn(
                          "w-full rounded-lg border p-4 text-left transition-all hover:border-accent",
                          flowState.visa_subclass === visa.subclass
                            ? "border-accent bg-accent/5"
                            : "border-border bg-background",
                        )}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="font-semibold text-foreground">
                              {visa.subclass} - {visa.name}
                            </div>
                            <div className="mt-1 text-sm text-muted-text">
                              {visa.family}
                            </div>
                          </div>
                          <div className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-muted-text">
                            {visa.case_count.toLocaleString()}{" "}
                            {t("guided_search.cases_unit", {
                              defaultValue: "cases",
                            })}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedFlow === "find-precedents" && currentStep === 2 && (
              <div>
                <label className="block text-sm font-medium text-foreground">
                  {t("guided_search.label_country_optional", {
                    defaultValue: "Country of Origin (Optional)",
                  })}
                </label>
                <p className="mt-1 text-sm text-muted-text">
                  {t("guided_search.country_skip_hint", {
                    defaultValue: "Select a country or skip to continue",
                  })}
                </p>
                {countriesData && (
                  <div className="mt-4 grid max-h-96 gap-2 overflow-y-auto rounded-lg border border-border bg-surface p-2">
                    {countriesData.countries.map((country) => {
                      const countryName = country.country.trim();
                      if (!countryName) return null;

                      return (
                        <button
                          key={countryName}
                          type="button"
                          aria-pressed={flowState.country === countryName}
                          onClick={() => {
                            setFlowState((prev) => ({
                              ...prev,
                              country:
                                prev.country === countryName
                                  ? undefined
                                  : countryName,
                            }));
                          }}
                          className={cn(
                            "flex items-center justify-between rounded-lg border p-3 text-left transition-all hover:border-accent",
                            flowState.country === countryName
                              ? "border-accent bg-accent/5"
                              : "border-border bg-background",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-muted-text" />
                            <span className="font-medium text-foreground">
                              {countryName}
                            </span>
                          </div>
                          <span className="text-sm text-muted-text">
                            {country.case_count.toLocaleString()}{" "}
                            {t("guided_search.cases_unit", {
                              defaultValue: "cases",
                            })}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {selectedFlow === "find-precedents" && currentStep === 3 && (
              <div>
                <label className="block text-sm font-medium text-foreground">
                  {t("guided_search.label_legal_concepts_optional", {
                    defaultValue: "Legal Concepts (Optional)",
                  })}
                </label>
                <p className="mt-1 text-sm text-muted-text">
                  {t("guided_search.concepts_skip_hint", {
                    defaultValue:
                      "Select up to 5 legal concepts or skip to continue",
                  })}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {flowState.legal_concepts.map((id) => {
                    const concept = conceptsData?.concepts.find(
                      (c) => c.id === id,
                    );
                    return concept ? (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-sm text-white"
                      >
                        {concept.name}
                      </span>
                    ) : null;
                  })}
                </div>
                {conceptsData && (
                  <div className="mt-4 grid max-h-96 gap-2 overflow-y-auto rounded-lg border border-border bg-surface p-2">
                    {conceptsData.concepts.map((concept) => (
                      <button
                        key={concept.id}
                        type="button"
                        aria-pressed={flowState.legal_concepts.includes(concept.id)}
                        onClick={() => toggleConcept(concept.id)}
                        disabled={
                          !flowState.legal_concepts.includes(concept.id) &&
                          flowState.legal_concepts.length >= 5
                        }
                        className={cn(
                          "rounded-lg border p-3 text-left transition-all disabled:opacity-50",
                          flowState.legal_concepts.includes(concept.id)
                            ? "border-accent bg-accent/5"
                            : "border-border bg-background hover:border-accent",
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-text" />
                              <span className="font-medium text-foreground">
                                {concept.name}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-muted-text">
                              {concept.description}
                            </p>
                            <span className="mt-1 inline-block text-xs text-muted-text">
                              {concept.category}
                            </span>
                          </div>
                          <span className="ml-4 text-sm text-muted-text">
                            {concept.case_count.toLocaleString()}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedFlow === "assess-judge" && currentStep === 1 && (
              <div>
                <label className="block text-sm font-medium text-foreground">
                  {t("guided_search.label_judge_name", {
                    defaultValue: "Judge Name",
                  })}
                </label>
                <input
                  type="text"
                  value={judgeQuery}
                  onChange={(e) => setJudgeQuery(e.target.value)}
                  placeholder={t("guided_search.placeholder_judge_name", {
                    defaultValue: "e.g., Smith, Robertson",
                  })}
                  className="mt-2 w-full rounded-lg border border-border bg-background px-4 py-2 text-foreground placeholder:text-muted-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                />
                {judgeLoading && (
                  <div
                    className="mt-4 flex items-center gap-2 text-sm text-muted-text"
                    role="status"
                    aria-live="polite"
                  >
                    <div className="animate-spin">
                      <Loader2 className="h-4 w-4" />
                    </div>
                    {t("guided_search.searching_state", {
                      defaultValue: "Searching...",
                    })}
                  </div>
                )}
                {judgeData && judgeData.judges.length > 0 && (
                  <div className="mt-4 space-y-2 rounded-lg border border-border bg-surface p-2">
                    {judgeData.judges.map((judge) => (
                      <button
                        key={judge.canonical_name ?? judge.name}
                        type="button"
                        aria-pressed={
                          (flowState.judge_canonical_name ??
                            flowState.judge_name) ===
                          (judge.canonical_name ?? judge.name)
                        }
                        onClick={() => {
                          setFlowState((prev) => ({
                            ...prev,
                            judge_name: judge.name,
                            judge_canonical_name:
                              judge.canonical_name ?? judge.name,
                          }));
                          setJudgeQuery(judge.name);
                        }}
                        className={cn(
                          "w-full rounded-lg border p-4 text-left transition-all hover:border-accent",
                          (flowState.judge_canonical_name ??
                            flowState.judge_name) ===
                            (judge.canonical_name ?? judge.name)
                            ? "border-accent bg-accent/5"
                            : "border-border bg-background",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="rounded-full bg-surface p-2">
                              <User className="h-5 w-5 text-muted-text" />
                            </div>
                            <span className="font-semibold text-foreground">
                              {judge.name}
                            </span>
                          </div>
                          <span className="text-sm text-muted-text">
                            {judge.case_count.toLocaleString()}{" "}
                            {t("guided_search.cases_unit", {
                              defaultValue: "cases",
                            })}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Navigation buttons */}
          <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
            <button
              type="button"
              onClick={handleBack}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("guided_search.back_btn", { defaultValue: "Back" })}
            </button>

            {isLastStep ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={
                  guidedMutation.isPending ||
                  (selectedFlow === "find-precedents" &&
                    !flowState.visa_subclass) ||
                  (selectedFlow === "assess-judge" && !flowState.judge_name)
                }
                className="flex items-center gap-2 rounded-lg bg-accent px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                {guidedMutation.isPending ? (
                  <>
                    <div className="animate-spin">
                      <Loader2 className="h-4 w-4" />
                    </div>
                    {t("guided_search.searching_state", {
                      defaultValue: "Searching...",
                    })}
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    {selectedFlow === "assess-judge"
                      ? t("guided_search.view_judge_profile_btn", {
                          defaultValue: "View Judge Profile",
                        })
                      : t("guided_search.find_cases_btn", {
                          defaultValue: "Find Cases",
                        })}
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                disabled={
                  selectedFlow === "find-precedents" &&
                  currentStep === 1 &&
                  !flowState.visa_subclass
                }
                className="flex items-center gap-2 rounded-lg bg-accent px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                {t("guided_search.next_btn", { defaultValue: "Next" })}
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
