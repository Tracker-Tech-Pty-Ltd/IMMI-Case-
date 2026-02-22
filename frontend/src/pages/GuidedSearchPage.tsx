import { useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
}

export function GuidedSearchPage() {
  const navigate = useNavigate();
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
        title: "Find Precedents for My Case",
        description:
          "Walk through a step-by-step search to find relevant case law for your visa application or appeal",
        icon: Scale,
        steps: [
          {
            title: "Select Visa Subclass",
            description: "Enter the 3-digit visa subclass number",
          },
          {
            title: "Choose Country of Origin",
            description: "Select the applicant's country (optional)",
          },
          {
            title: "Select Legal Concepts",
            description:
              "Choose relevant legal principles (optional, up to 5)",
          },
        ],
      },
      "assess-judge": {
        title: "Assess Judge Patterns",
        description:
          "Find a judge by name and view their decision patterns, success rates, and key statistics",
        icon: User,
        steps: [
          {
            title: "Search Judge Name",
            description: "Enter the judge's last name (minimum 2 characters)",
          },
        ],
      },
    }),
    [],
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
      if (!flowState.judge_name) {
        toast.error("Please select a judge");
        return;
      }
      // Navigate to judge detail page
      const judgeSlug = flowState.judge_name.toLowerCase().replace(/\s+/g, "-");
      navigate(`/judges/${encodeURIComponent(judgeSlug)}`);
      return;
    }

    if (selectedFlow === "find-precedents") {
      if (!flowState.visa_subclass) {
        toast.error("Please select a visa subclass");
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
          toast.success(`Found ${result.total ?? 0} matching cases`);
        } else {
          toast.error("No cases found matching your criteria");
          setResults([]);
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  }, [selectedFlow, flowState, guidedMutation, navigate]);

  const toggleConcept = useCallback((conceptId: string) => {
    setFlowState((prev) => {
      const concepts = prev.legal_concepts;
      if (concepts.includes(conceptId)) {
        return { ...prev, legal_concepts: concepts.filter((c) => c !== conceptId) };
      } else if (concepts.length < 5) {
        return { ...prev, legal_concepts: [...concepts, conceptId] };
      } else {
        toast.error("Maximum 5 legal concepts allowed");
        return prev;
      }
    });
  }, []);

  const paginatedResults = useMemo(() => {
    if (!results) return [];
    const pageSize = 20;
    const start = (currentPage - 1) * pageSize;
    return results.slice(start, start + pageSize);
  }, [results, currentPage]);

  if (results) {
    return (
      <div className="container-padding">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text-primary">
              Search Results
            </h1>
            <p className="mt-2 text-text-secondary">
              Found {results.length} cases matching your criteria
            </p>
          </div>
          <button
            onClick={() => {
              setResults(null);
              setSelectedFlow(null);
              setCurrentPage(1);
            }}
            className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            New Search
          </button>
        </div>

        {paginatedResults.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="No cases found"
            description="Try adjusting your search criteria"
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
      <div className="container-padding">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-text-primary">
            Guided Search
          </h1>
          <p className="mt-2 text-lg text-text-secondary">
            Choose a search flow to get started with finding relevant cases or
            judge information
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {(Object.keys(flowConfig) as FlowType[])
            .filter((key): key is Exclude<FlowType, null> => key !== null)
            .map((flowKey) => {
              const flow = flowConfig[flowKey];
              const Icon = flow.icon;
              return (
                <button
                  key={flowKey}
                  onClick={() => handleFlowSelect(flowKey)}
                  className="group relative overflow-hidden rounded-xl border border-border-default bg-bg-surface p-6 text-left transition-all hover:border-accent-primary hover:shadow-lg"
                >
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-accent-primary/10 p-3">
                      <Icon className="h-6 w-6 text-accent-primary" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-semibold text-text-primary group-hover:text-accent-primary">
                        {flow.title}
                      </h3>
                      <p className="mt-2 text-sm text-text-secondary">
                        {flow.description}
                      </p>
                      <div className="mt-4">
                        <span className="inline-flex items-center gap-1 text-sm font-medium text-accent-primary">
                          Start flow
                          <ArrowRight className="h-4 w-4" />
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
        </div>

        <div className="mt-12 rounded-lg border border-border-default bg-bg-muted p-6">
          <h2 className="text-lg font-semibold text-text-primary">
            How it works
          </h2>
          <ul className="mt-4 space-y-3">
            <li className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent-primary" />
              <span className="text-sm text-text-secondary">
                Select a search flow based on your research goal
              </span>
            </li>
            <li className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent-primary" />
              <span className="text-sm text-text-secondary">
                Answer guided questions to build your search criteria
              </span>
            </li>
            <li className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent-primary" />
              <span className="text-sm text-text-secondary">
                View results tailored to your specific needs
              </span>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  const flow = flowConfig[selectedFlow];
  const currentStepConfig = flow.steps[currentStep - 1];
  const isLastStep = currentStep === flow.steps.length;

  return (
    <div className="container-padding">
      <div className="mb-6">
        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={handleBack}
            className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        </div>
        <h1 className="text-3xl font-bold text-text-primary">{flow.title}</h1>
        <p className="mt-2 text-text-secondary">{flow.description}</p>
      </div>

      {/* Progress indicator */}
      <div className="mb-8">
        <div className="flex items-center gap-2">
          {flow.steps.map((step, idx) => (
            <div key={idx} className="flex flex-1 items-center">
              <div className="flex flex-1 items-center gap-2">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 font-semibold",
                    idx + 1 < currentStep
                      ? "border-accent-primary bg-accent-primary text-white"
                      : idx + 1 === currentStep
                        ? "border-accent-primary text-accent-primary"
                        : "border-border-default text-text-tertiary",
                  )}
                >
                  {idx + 1 < currentStep ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    idx + 1
                  )}
                </div>
                <span
                  className={cn(
                    "hidden text-sm font-medium md:block",
                    idx + 1 === currentStep
                      ? "text-text-primary"
                      : "text-text-tertiary",
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
                      ? "bg-accent-primary"
                      : "bg-border-default",
                  )}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="mx-auto max-w-3xl">
        <div className="rounded-xl border border-border-default bg-bg-surface p-8">
          <h2 className="text-2xl font-bold text-text-primary">
            {currentStepConfig.title}
          </h2>
          <p className="mt-2 text-text-secondary">
            {currentStepConfig.description}
          </p>

          <div className="mt-6">
            {selectedFlow === "find-precedents" && currentStep === 1 && (
              <div>
                <label className="block text-sm font-medium text-text-primary">
                  Visa Subclass
                </label>
                <input
                  type="text"
                  value={visaQuery}
                  onChange={(e) => setVisaQuery(e.target.value)}
                  placeholder="e.g., 866, 820, 457"
                  className="mt-2 w-full rounded-lg border border-border-default bg-bg-default px-4 py-2 text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                />
                {visaLoading && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </div>
                )}
                {visaData && visaData.data.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {visaData.data.map((visa) => (
                      <button
                        key={visa.subclass}
                        onClick={() => {
                          setFlowState((prev) => ({
                            ...prev,
                            visa_subclass: visa.subclass,
                          }));
                          setVisaQuery(visa.subclass);
                        }}
                        className={cn(
                          "w-full rounded-lg border p-4 text-left transition-all hover:border-accent-primary",
                          flowState.visa_subclass === visa.subclass
                            ? "border-accent-primary bg-accent-primary/5"
                            : "border-border-default bg-bg-default",
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-semibold text-text-primary">
                              {visa.subclass} - {visa.name}
                            </div>
                            <div className="mt-1 text-sm text-text-secondary">
                              {visa.family}
                            </div>
                          </div>
                          <div className="rounded-full bg-bg-muted px-3 py-1 text-xs font-medium text-text-secondary">
                            {visa.case_count.toLocaleString()} cases
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
                <label className="block text-sm font-medium text-text-primary">
                  Country of Origin (Optional)
                </label>
                <p className="mt-1 text-sm text-text-tertiary">
                  Select a country or skip to continue
                </p>
                {countriesData && (
                  <div className="mt-4 grid max-h-96 gap-2 overflow-y-auto">
                    {countriesData.countries.map((country) => (
                      <button
                        key={country.country}
                        onClick={() => {
                          setFlowState((prev) => ({
                            ...prev,
                            country:
                              prev.country === country.country
                                ? undefined
                                : country.country,
                          }));
                        }}
                        className={cn(
                          "flex items-center justify-between rounded-lg border p-3 text-left transition-all hover:border-accent-primary",
                          flowState.country === country.country
                            ? "border-accent-primary bg-accent-primary/5"
                            : "border-border-default bg-bg-default",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-text-tertiary" />
                          <span className="font-medium text-text-primary">
                            {country.country}
                          </span>
                        </div>
                        <span className="text-sm text-text-secondary">
                          {country.case_count.toLocaleString()} cases
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedFlow === "find-precedents" && currentStep === 3 && (
              <div>
                <label className="block text-sm font-medium text-text-primary">
                  Legal Concepts (Optional)
                </label>
                <p className="mt-1 text-sm text-text-tertiary">
                  Select up to 5 legal concepts or skip to continue
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {flowState.legal_concepts.map((id) => {
                    const concept = conceptsData?.concepts.find(
                      (c) => c.id === id,
                    );
                    return concept ? (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full bg-accent-primary px-3 py-1 text-sm text-white"
                      >
                        {concept.name}
                      </span>
                    ) : null;
                  })}
                </div>
                {conceptsData && (
                  <div className="mt-4 grid max-h-96 gap-2 overflow-y-auto">
                    {conceptsData.concepts.map((concept) => (
                      <button
                        key={concept.id}
                        onClick={() => toggleConcept(concept.id)}
                        disabled={
                          !flowState.legal_concepts.includes(concept.id) &&
                          flowState.legal_concepts.length >= 5
                        }
                        className={cn(
                          "rounded-lg border p-3 text-left transition-all disabled:opacity-50",
                          flowState.legal_concepts.includes(concept.id)
                            ? "border-accent-primary bg-accent-primary/5"
                            : "border-border-default bg-bg-default hover:border-accent-primary",
                        )}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-text-tertiary" />
                              <span className="font-medium text-text-primary">
                                {concept.name}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-text-secondary">
                              {concept.description}
                            </p>
                            <span className="mt-1 inline-block text-xs text-text-tertiary">
                              {concept.category}
                            </span>
                          </div>
                          <span className="ml-4 text-sm text-text-secondary">
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
                <label className="block text-sm font-medium text-text-primary">
                  Judge Name
                </label>
                <input
                  type="text"
                  value={judgeQuery}
                  onChange={(e) => setJudgeQuery(e.target.value)}
                  placeholder="e.g., Smith, Robertson"
                  className="mt-2 w-full rounded-lg border border-border-default bg-bg-default px-4 py-2 text-text-primary placeholder:text-text-tertiary focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                />
                {judgeLoading && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-text-secondary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </div>
                )}
                {judgeData && judgeData.judges.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {judgeData.judges.map((judge) => (
                      <button
                        key={judge.name}
                        onClick={() => {
                          setFlowState((prev) => ({
                            ...prev,
                            judge_name: judge.name,
                          }));
                          setJudgeQuery(judge.name);
                        }}
                        className={cn(
                          "w-full rounded-lg border p-4 text-left transition-all hover:border-accent-primary",
                          flowState.judge_name === judge.name
                            ? "border-accent-primary bg-accent-primary/5"
                            : "border-border-default bg-bg-default",
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="rounded-full bg-bg-muted p-2">
                              <User className="h-5 w-5 text-text-tertiary" />
                            </div>
                            <span className="font-semibold text-text-primary">
                              {judge.name}
                            </span>
                          </div>
                          <span className="text-sm text-text-secondary">
                            {judge.case_count.toLocaleString()} cases
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
          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={handleBack}
              className="flex items-center gap-2 rounded-lg border border-border-default bg-bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-bg-muted"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>

            {isLastStep ? (
              <button
                onClick={handleSubmit}
                disabled={
                  guidedMutation.isPending ||
                  (selectedFlow === "find-precedents" &&
                    !flowState.visa_subclass) ||
                  (selectedFlow === "assess-judge" && !flowState.judge_name)
                }
                className="flex items-center gap-2 rounded-lg bg-accent-primary px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90 disabled:opacity-50"
              >
                {guidedMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    {selectedFlow === "assess-judge"
                      ? "View Judge Profile"
                      : "Find Cases"}
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleNext}
                disabled={
                  selectedFlow === "find-precedents" &&
                  currentStep === 1 &&
                  !flowState.visa_subclass
                }
                className="flex items-center gap-2 rounded-lg bg-accent-primary px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/90 disabled:opacity-50"
              >
                Next
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
