import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useLlmCouncil, useLlmCouncilHealthCheck } from "@/hooks/use-llm-council";
import type { LlmCouncilHealthResponse, LlmCouncilResponse } from "@/lib/api";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import { humanizeIdentifier } from "@/lib/display";

const DEFAULT_MODELS: LlmCouncilResponse["models"] = {
  openai: {
    provider: "OpenAI",
    model: "chatgpt-5.2",
    reasoning: "medium",
    web_search: true,
  },
  gemini_pro: {
    provider: "Google",
    model: "gemini-3.0-pro",
    reasoning_budget: 1024,
    grounding_google_search: true,
  },
  anthropic: {
    provider: "Anthropic",
    model: "claude-sonnet-4-6",
    reasoning_budget: 4096,
    web_search: true,
  },
  gemini_flash: {
    provider: "Google",
    model: "gemini-3.0-flash",
    role: "judge_rank_vote_and_composer",
  },
};

const OPINION_ORDER = ["openai", "gemini_pro", "anthropic"];
const MODEL_KEY_DEFAULT_LABELS: Record<string, string> = {
  openai: "OpenAI",
  gemini_pro: "Gemini Pro",
  anthropic: "Anthropic",
  gemini_flash: "Gemini Flash",
};

function modelKeyLabel(
  key: string,
  t: (lookupKey: string, options?: Record<string, unknown>) => string,
) {
  return t(`llm_council.model_key_${key}`, {
    defaultValue: MODEL_KEY_DEFAULT_LABELS[key] ?? humanizeIdentifier(key),
  });
}

function modelMetaLine(config: {
  reasoning?: string;
  reasoning_budget?: number;
  web_search?: boolean;
  grounding_google_search?: boolean;
  role?: string;
}, t: (lookupKey: string, options?: Record<string, unknown>) => string) {
  const parts: string[] = [];
  if (config.reasoning) {
    parts.push(
      t("llm_council.meta_reasoning", {
        defaultValue: "Reasoning: {{value}}",
        value: humanizeIdentifier(config.reasoning),
      }),
    );
  }
  if (typeof config.reasoning_budget === "number") {
    parts.push(
      t("llm_council.meta_thinking_budget", {
        defaultValue: "Thinking Budget: {{value}}",
        value: config.reasoning_budget.toLocaleString(),
      }),
    );
  }
  if (config.web_search) {
    parts.push(
      t("llm_council.meta_web_search_on", {
        defaultValue: "Web Search Enabled",
      }),
    );
  }
  if (config.grounding_google_search) {
    parts.push(
      t("llm_council.meta_google_grounding_on", {
        defaultValue: "Google Grounding Enabled",
      }),
    );
  }
  if (config.role) {
    parts.push(
      t("llm_council.meta_role", {
        defaultValue: "Role: {{value}}",
        value: humanizeIdentifier(config.role),
      }),
    );
  }
  return parts.join(" • ");
}

function likelihoodTone(label: string) {
  const normalized = (label || "").toLowerCase();
  if (normalized === "high") return "text-emerald-700 dark:text-emerald-300";
  if (normalized === "medium") return "text-amber-700 dark:text-amber-300";
  if (normalized === "low") return "text-rose-700 dark:text-rose-300";
  return "text-muted-text";
}

function confidenceTone(score: number) {
  if (score >= 80) return "text-emerald-700 dark:text-emerald-300";
  if (score >= 50) return "text-amber-700 dark:text-amber-300";
  return "text-rose-700 dark:text-rose-300";
}

function voteTone(vote: string) {
  const normalized = (vote || "").toLowerCase();
  if (normalized === "support") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
  }
  if (normalized === "oppose") {
    return "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300";
  }
  return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
}

function lawSectionKey(section: string) {
  return (section || "")
    .toLowerCase()
    .replace(/sections?/g, "s")
    .replace(/\bss\b/g, "s")
    .replace(/regs?/g, "reg")
    .replace(/regulation/g, "reg")
    .replace(/[^a-z0-9]+/g, "");
}

function lawSectionSearchHref(section: string) {
  const normalized = (section || "").trim();
  if (!normalized) return "/legislations";
  const actMatch = normalized.match(/^(.+?)\s+s\.?\s*\d+/i);
  const query = (actMatch?.[1] || normalized).trim();
  return `/legislations?q=${encodeURIComponent(query)}`;
}

export function LlmCouncilPage() {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");
  const [caseId, setCaseId] = useState("");
  const [context, setContext] = useState("");
  const [result, setResult] = useState<LlmCouncilResponse | null>(null);
  const [healthResult, setHealthResult] = useState<LlmCouncilHealthResponse | null>(null);
  const [healthError, setHealthError] = useState("");
  const [healthLiveProbe, setHealthLiveProbe] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const councilMutation = useLlmCouncil();
  const healthMutation = useLlmCouncilHealthCheck();

  const models = result?.models ?? DEFAULT_MODELS;
  const sortedOpinions = useMemo(() => {
    if (!result) return [];
    const byKey = new Map(result.opinions.map((entry) => [entry.provider_key, entry]));
    return OPINION_ORDER.map((key) => byKey.get(key)).filter(
      (
        entry,
      ): entry is LlmCouncilResponse["opinions"][number] => entry !== undefined,
    );
  }, [result]);
  const critiquesByProvider = useMemo(() => {
    if (!result?.moderator?.model_critiques) return new Map();
    return new Map(
      result.moderator.model_critiques.map((entry) => [entry.provider_key, entry]),
    );
  }, [result]);
  const sharedLawSections = useMemo(() => {
    if (!result) return [];
    const fromModerator = result.moderator.shared_law_sections || [];
    if (fromModerator.length > 0) return fromModerator;

    const providerMap = result.moderator.provider_law_sections || {};
    const successfulProviderKeys = sortedOpinions
      .filter((entry) => entry.success)
      .map((entry) => entry.provider_key);

    if (successfulProviderKeys.length === 0) return [];

    const normalizedSets = successfulProviderKeys.map((providerKey) => {
      const entries = providerMap[providerKey] || [];
      return new Set(entries.map((entry) => lawSectionKey(entry)).filter(Boolean));
    });

    if (normalizedSets.some((entry) => entry.size === 0)) return [];

    const sharedKeys = normalizedSets.reduce((acc, current) => {
      if (!acc) return new Set(current);
      return new Set(Array.from(acc).filter((item) => current.has(item)));
    }, null as Set<string> | null);
    if (!sharedKeys || sharedKeys.size === 0) return [];

    const representative = new Map<string, string>();
    successfulProviderKeys.forEach((providerKey) => {
      (providerMap[providerKey] || []).forEach((entry) => {
        const key = lawSectionKey(entry);
        if (key && !representative.has(key)) representative.set(key, entry);
      });
    });

    return Array.from(sharedKeys)
      .map((key) => representative.get(key) || "")
      .filter(Boolean);
  }, [result, sortedOpinions]);
  const successfulExpertsCount = sortedOpinions.filter((entry) => entry.success).length;
  const providerLawSectionEntries = useMemo(() => {
    if (!result) return [];
    const providerMap = result.moderator.provider_law_sections || {};
    return sortedOpinions.map((opinion) => ({
      provider_key: opinion.provider_key,
      provider_label: opinion.provider_label,
      success: opinion.success,
      sections: providerMap[opinion.provider_key] || [],
    }));
  }, [result, sortedOpinions]);
  const workflowSteps = [
    {
      icon: Scale,
      title: t("llm_council.workflow_step_1_title", {
        defaultValue: "Input Legal Issue",
      }),
      description: t("llm_council.workflow_step_1_desc", {
        defaultValue:
          "Enter your legal question and the full case-study facts, even when the case is not already recorded.",
      }),
    },
    {
      icon: Search,
      title: t("llm_council.workflow_step_2_title", {
        defaultValue: "Find Closest Precedents",
      }),
      description: t("llm_council.workflow_step_2_desc", {
        defaultValue:
          "System searches the local IMMI-Case database first and retrieves the most relevant judgments.",
      }),
    },
    {
      icon: Bot,
      title: t("llm_council.workflow_step_3_title", {
        defaultValue: "3-Model Council Debate",
      }),
      description: t("llm_council.workflow_step_3_desc", {
        defaultValue:
          "OpenAI, Gemini Pro, and Anthropic answer independently, then Gemini Flash critiques and votes.",
      }),
    },
    {
      icon: Sparkles,
      title: t("llm_council.workflow_step_4_title", {
        defaultValue: "Compose Mock Judgment",
      }),
      description: t("llm_council.workflow_step_4_desc", {
        defaultValue:
          "Receive a database-grounded mock judgment draft, consensus/conflict map, and cited sections.",
      }),
    },
  ];

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = question.trim();
    if (!q) {
      toast.error(
        t("llm_council.validation_question_required", {
          defaultValue: "Please enter your legal research question.",
        }),
      );
      return;
    }
    setSubmitError("");
    try {
      const payload = await councilMutation.mutateAsync({
        question: q,
        case_id: caseId.trim() || undefined,
        context: context.trim() || undefined,
      });
      setResult(payload);
      toast.success(
        t("llm_council.run_success", {
          defaultValue: "LLM council completed.",
        }),
      );
    } catch (error) {
      const msg =
        (error as Error).message ||
        t("llm_council.request_failed", {
          defaultValue: "LLM council request failed",
        });
      setSubmitError(msg);
      toast.error(msg);
    }
  }

  async function onHealthCheck() {
    setHealthError("");
    try {
      const payload = await healthMutation.mutateAsync({ live: healthLiveProbe });
      setHealthResult(payload);
      toast.success(
        payload.ok
          ? t("llm_council.health_ok", { defaultValue: "Health check passed." })
          : t("llm_council.health_warn", {
              defaultValue: "Health check completed with warnings.",
            }),
      );
    } catch (error) {
      const msg =
        (error as Error).message ||
        t("llm_council.health_failed", {
          defaultValue: "Health check failed",
        });
      setHealthError(msg);
      toast.error(msg);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
        <PageHeader
          title={t("llm_council.title", { defaultValue: "LLM IMMI Council" })}
          description={t("llm_council.subtitle", {
            defaultValue:
              "Direct multi-provider council with OpenAI, Gemini Pro, Anthropic Sonnet, then Gemini Flash for ranking, critique, voting, and synthesis.",
          })}
          icon={<Scale className="h-5 w-5" />}
        />
      </section>

      <section className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2 border-b border-border pb-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-text">
            {t("llm_council.workflow_heading", {
              defaultValue: "Council Workflow",
            })}
          </h2>
          <p className="text-xs text-muted-text">
            {t("llm_council.workflow_note", {
              defaultValue: "Designed for user-provided cases not already in record.",
            })}
          </p>
        </div>
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {workflowSteps.map((step, idx) => (
            <li
              key={step.title}
              className="rounded-xl border border-border bg-surface/60 p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                  {idx + 1}
                </span>
                <step.icon className="h-4 w-4 text-accent" />
                <p className="text-sm font-semibold text-foreground">{step.title}</p>
              </div>
              <p className="text-xs leading-relaxed text-muted-text">
                {step.description}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t("llm_council.question_label", {
                    defaultValue: "Legal Research Question",
                  })}
                </label>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={4}
                  maxLength={8000}
                  placeholder={t("llm_council.question_placeholder", {
                    defaultValue:
                      "Example: Compare strongest review grounds for visa cancellation where procedural fairness may be breached.",
                  })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t("llm_council.context_label", {
                    defaultValue: "Case Study Facts (not in record)",
                  })}
                </label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={9}
                  maxLength={12000}
                  placeholder={t("llm_council.case_study_placeholder", {
                    defaultValue:
                      "Describe user-provided facts, timeline, visa status, procedural events, and contested findings. This will be used to search local precedents and draft a mock judgment.",
                  })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent"
                />
                <p className="mt-1 text-xs text-muted-text">
                  {t("llm_council.case_study_note", {
                    defaultValue:
                      "Use concrete facts. The council will map these facts against similar cases in the current database.",
                  })}
                </p>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-md border border-border bg-surface/40 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-text">
                  {t("llm_council.input_checklist_title", {
                    defaultValue: "Case-Fact Checklist",
                  })}
                </p>
                <ul className="mt-2 space-y-1 text-xs text-muted-text">
                  <li>
                    •{" "}
                    {t("llm_council.input_checklist_item_1", {
                      defaultValue: "Timeline: key dates, notices, interviews, refusals/cancellations.",
                    })}
                  </li>
                  <li>
                    •{" "}
                    {t("llm_council.input_checklist_item_2", {
                      defaultValue: "Decision points: who decided what, and under which legal powers.",
                    })}
                  </li>
                  <li>
                    •{" "}
                    {t("llm_council.input_checklist_item_3", {
                      defaultValue: "Procedural issues: hearing fairness, evidence disputes, reasons adequacy.",
                    })}
                  </li>
                </ul>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">
                  {t("llm_council.case_id_label", {
                    defaultValue: "Case ID (optional, if existing record)",
                  })}
                </label>
                <input
                  type="text"
                  value={caseId}
                  onChange={(e) => setCaseId(e.target.value)}
                  placeholder={t("llm_council.case_id_placeholder", {
                    defaultValue: "12-char case id",
                  })}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent"
                />
              </div>

              <button
                type="submit"
                disabled={councilMutation.isPending}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              >
                {councilMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("llm_council.running_btn", { defaultValue: "Running Council..." })}
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    {t("llm_council.run_btn", { defaultValue: "Run LLM Council" })}
                  </>
                )}
              </button>

              <p className="text-xs text-muted-text">
                {t("llm_council.runtime_note", {
                  defaultValue:
                    "This runs 3 expert models, then Gemini Flash for ranking/critique/voting/synthesis, so response time may be longer.",
                })}
              </p>
            </aside>
          </div>
        </form>
        {submitError ? <ApiErrorState message={submitError} /> : null}
      </section>

      <section className="rounded-xl border border-border/80 bg-card shadow-sm">
        <button
          type="button"
          onClick={() => setAdvancedOpen((prev) => !prev)}
          className="flex w-full items-center justify-between gap-3 px-6 py-5 text-left"
          aria-expanded={advancedOpen}
        >
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-accent-muted p-2 text-accent">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-wide text-muted-text">
                {t("llm_council.advanced_heading", {
                  defaultValue: "Advanced Controls",
                })}
              </h2>
              <p className="mt-1 text-xs text-muted-text">
                {t("llm_council.advanced_subtitle", {
                  defaultValue:
                    "Expand to review model configuration and run provider health diagnostics.",
                })}
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-text">
            {advancedOpen
              ? t("llm_council.advanced_hide", { defaultValue: "Hide" })
              : t("llm_council.advanced_show", { defaultValue: "Show" })}
            <ChevronDown
              className={`h-4 w-4 transition-transform ${
                advancedOpen ? "rotate-180" : "rotate-0"
              }`}
            />
          </div>
        </button>

        {advancedOpen ? (
          <div className="space-y-4 border-t border-border px-6 pb-6 pt-5">
            <div className="rounded-lg border border-border/80 bg-surface/40 p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-text">
                {t("llm_council.models_heading", {
                  defaultValue: "Model Council Setup",
                })}
              </h3>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {Object.entries(models).map(([key, config]) => (
                  <article
                    key={key}
                    className="rounded-md border border-border bg-card p-3"
                  >
                    <p className="text-xs font-medium tracking-wide text-muted-text">
                      {modelKeyLabel(key, t)}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {config.provider}
                    </p>
                    <p className="mt-1 break-all text-xs text-muted-text">{config.model}</p>
                    <p className="mt-2 text-[11px] text-muted-text">
                      {modelMetaLine(config, t) ||
                        t("llm_council.default_meta", {
                          defaultValue: "default",
                        })}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border/80 bg-surface/40 p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-accent" />
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-text">
                    {t("llm_council.health_heading", {
                      defaultValue: "Provider Health Check",
                    })}
                  </h3>
                </div>
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-muted-text">
                    <input
                      type="checkbox"
                      checked={healthLiveProbe}
                      onChange={(e) => setHealthLiveProbe(e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                    {t("llm_council.health_live_probe_label", {
                      defaultValue: "Enable live probe",
                    })}
                  </label>
                  <button
                    type="button"
                    onClick={onHealthCheck}
                    disabled={healthMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {healthMutation.isPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t("llm_council.health_running_btn", {
                          defaultValue: "Checking...",
                        })}
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {t("llm_council.health_btn", {
                          defaultValue: "Health Check",
                        })}
                      </>
                    )}
                  </button>
                </div>
              </div>

              <p className="mt-2 text-xs text-muted-text">
                {healthLiveProbe
                  ? t("llm_council.health_live_note", {
                      defaultValue:
                        "Live probe will call provider APIs and verify response availability.",
                    })
                  : t("llm_council.health_config_note", {
                      defaultValue:
                        "Config-only check validates API keys and model/prompt configuration without external calls.",
                    })}
              </p>

              {healthError ? <div className="mt-3"><ApiErrorState message={healthError} /></div> : null}

              {healthResult ? (
                <div className="mt-3 space-y-3">
                  {!healthResult.ok && healthResult.errors.length > 0 ? (
                    <div className="rounded-md border border-amber-300/40 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-900/20 dark:text-amber-200">
                      <p className="font-semibold">
                        {t("llm_council.health_issues_title", {
                          defaultValue: "Issues detected",
                        })}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {healthResult.errors.map((entry) => (
                          <li key={entry}>• {entry}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {Object.entries(healthResult.providers).map(([key, provider]) => {
                      const probe = healthResult.probe_results?.[
                        key as keyof NonNullable<LlmCouncilHealthResponse["probe_results"]>
                      ];
                      return (
                        <article key={key} className="rounded-md border border-border bg-card p-3">
                          <p className="text-xs uppercase tracking-wide text-muted-text">{key}</p>
                          <p className="mt-1 break-all text-xs text-foreground">{provider.model}</p>
                          <p className="mt-2 text-xs text-muted-text">
                            {provider.api_key_present
                              ? t("llm_council.health_api_key_yes", { defaultValue: "API key: present" })
                              : t("llm_council.health_api_key_no", { defaultValue: "API key: missing" })}
                          </p>
                          <p className="mt-1 text-[11px] text-muted-text break-words">
                            {provider.system_prompt_preview ||
                              t("llm_council.default_meta", { defaultValue: "default" })}
                          </p>
                          {probe ? (
                            <p className="mt-2 text-xs text-muted-text">
                              {probe.success
                                ? t("llm_council.health_probe_ok", {
                                    defaultValue: "Probe OK ({{latency}} ms)",
                                    latency: probe.latency_ms,
                                  })
                                : t("llm_council.health_probe_failed", {
                                    defaultValue: "Probe failed ({{latency}} ms)",
                                    latency: probe.latency_ms,
                                  })}
                            </p>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      {result ? (
        <>
          {result.retrieved_cases && result.retrieved_cases.length > 0 ? (
            <section className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-foreground">
                {t("llm_council.retrieved_cases_title", {
                  defaultValue: "Retrieved Supporting Cases",
                })}
              </h2>
              <p className="mt-1 text-xs text-muted-text">
                {t("llm_council.retrieved_cases_note", {
                  defaultValue:
                    "These local IMMI-Case precedents were provided to the council as evidence context.",
                })}
              </p>
              <div className="mt-3 space-y-2">
                {result.retrieved_cases.map((entry) => (
                  <article
                    key={entry.case_id}
                    className="rounded-md border border-border bg-surface p-3"
                  >
                    <p className="text-sm font-semibold text-foreground">
                      {entry.citation || entry.case_id}
                    </p>
                    <p className="text-sm text-foreground">{entry.title || "—"}</p>
                    <p className="mt-1 text-xs text-muted-text">
                      {entry.court || "—"} • {entry.date || "—"} • {entry.outcome || "—"}
                    </p>
                    {entry.legal_concepts ? (
                      <p className="mt-1 text-xs text-muted-text">
                        {entry.legal_concepts}
                      </p>
                    ) : null}
                    {entry.url ? (
                      <a
                        href={entry.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t("llm_council.open_case_source", {
                          defaultValue: "Open source case",
                        })}
                      </a>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border border-border/80 bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Sparkles className="h-4 w-4 text-accent" />
              <h2 className="text-lg font-semibold text-foreground">
                {t("llm_council.moderator_title", {
                  defaultValue: "Gemini Flash Ranking, Critique, Voting & Composition",
                })}
              </h2>
            </div>

            {result.moderator.success ? (
              <div className="mt-4 space-y-4">
                <div className="rounded-md border border-border bg-surface p-3">
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-text">
                    {t("llm_council.mock_judgment_label", {
                      defaultValue: "Mock Judgment Draft (Database-grounded Simulation)",
                    })}
                  </p>
                  <p className="mb-2 text-xs text-muted-text">
                    {t("llm_council.mock_judgment_note", {
                      defaultValue:
                        "Research simulation only. This is not legal advice or an actual judicial outcome.",
                    })}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {result.moderator.mock_judgment || result.moderator.composed_answer}
                  </p>
                </div>

                <div className="rounded-md border border-border bg-surface p-3">
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-text">
                    {t("llm_council.composed_answer_label", {
                      defaultValue: "Integrated Council Analysis",
                    })}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {result.moderator.composed_answer}
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-md border border-border bg-surface p-3">
                    <div className="mb-1 flex items-center gap-1 text-xs uppercase tracking-wide text-muted-text">
                      {t("llm_council.outcome_likelihood_label", {
                        defaultValue: "Outcome Likelihood",
                      })}
                      <span
                        title={t("llm_council.outcome_likelihood_tooltip", {
                          defaultValue:
                            "This percentage is a model-generated estimate based on available facts and cited precedents, not a judicial prediction or legal advice.",
                        })}
                        className="inline-flex items-center"
                      >
                        <Info className="h-3.5 w-3.5 text-muted-text" />
                      </span>
                    </div>
                    <p
                      className={`text-base font-semibold ${likelihoodTone(
                        result.moderator.outcome_likelihood_label,
                      )}`}
                    >
                      {result.moderator.outcome_likelihood_percent ?? 0}%
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-muted-text">
                      {(
                        result.moderator.outcome_likelihood_label || "unknown"
                      ).toUpperCase()}
                    </p>
                    <p className="mt-2 text-xs text-muted-text">
                      {result.moderator.outcome_likelihood_reason || "—"}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-surface p-3">
                    <p className="mb-1 text-xs uppercase tracking-wide text-muted-text">
                      {t("llm_council.consensus_label", { defaultValue: "Consensus" })}
                    </p>
                    <p className="text-sm text-foreground">
                      {result.moderator.consensus || "—"}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-surface p-3">
                    <p className="mb-1 text-xs uppercase tracking-wide text-muted-text">
                      {t("llm_council.disagreements_label", {
                        defaultValue: "Disagreements",
                      })}
                    </p>
                    <p className="text-sm text-foreground">
                      {result.moderator.disagreements || "—"}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-surface p-3">
                    <p className="mb-1 text-xs uppercase tracking-wide text-muted-text">
                      {t("llm_council.panel_vote_label", {
                        defaultValue: "Panel Vote",
                      })}
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      {result.moderator.vote_summary?.winner_provider_label || "—"}
                    </p>
                    <p className="mt-1 text-xs text-muted-text">
                      {result.moderator.vote_summary?.winner_reason || "—"}
                    </p>
                    <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-text">
                      {t("llm_council.vote_count_line", {
                        defaultValue: "Support {{support}} • Neutral {{neutral}} • Oppose {{oppose}}",
                        support: result.moderator.vote_summary?.support_count ?? 0,
                        neutral: result.moderator.vote_summary?.neutral_count ?? 0,
                        oppose: result.moderator.vote_summary?.oppose_count ?? 0,
                      })}
                    </p>
                  </div>
                </div>

                <div className="rounded-md border border-border bg-surface p-3">
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-text">
                    {t("llm_council.law_sections_label", {
                      defaultValue: "Relevant Law Sections",
                    })}
                  </p>
                  {result.moderator.law_sections &&
                  result.moderator.law_sections.length > 0 ? (
                    <div className="space-y-1">
                      {result.moderator.law_sections.map((section) => (
                        <a
                          key={section}
                          href={lawSectionSearchHref(section)}
                          className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                          title={t("llm_council.law_section_open_search", {
                            defaultValue: "Open legislation search for this section",
                          })}
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {section}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-text">—</p>
                  )}
                </div>

                <div className="rounded-md border border-border bg-surface p-3">
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-text">
                    {t("llm_council.shared_law_sections_label", {
                      defaultValue: "Shared Law Sections (All 3 Models)",
                    })}
                  </p>
                  <div className="mb-2 rounded border border-border bg-card p-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-text">
                      {t("llm_council.shared_law_confidence_label", {
                        defaultValue: "Shared Citation Confidence",
                      })}
                    </p>
                    <p
                      className={`mt-1 text-base font-semibold ${confidenceTone(
                        result.moderator.shared_law_sections_confidence_percent ?? 0,
                      )}`}
                    >
                      {(result.moderator.shared_law_sections_confidence_percent ?? 0).toLocaleString()}
                      /100
                    </p>
                    <p className="mt-1 text-xs text-muted-text">
                      {result.moderator.shared_law_sections_confidence_reason ||
                        t("llm_council.shared_law_confidence_note", {
                          defaultValue:
                            "Score is estimated from overlap consistency across the three expert model citations.",
                        })}
                    </p>
                  </div>
                  <p className="mb-2 text-xs text-muted-text">
                    {t("llm_council.shared_law_sections_note", {
                      defaultValue:
                        "This card only shows statutory sections that appear across all successful expert model answers.",
                    })}
                  </p>
                  {successfulExpertsCount < 3 ? (
                    <p className="text-sm text-muted-text">
                      {t("llm_council.shared_law_sections_requires_three", {
                        defaultValue:
                          "Need all three expert model responses to compute shared sections.",
                      })}
                    </p>
                  ) : sharedLawSections.length > 0 ? (
                    <div className="space-y-1">
                      {sharedLawSections.map((section) => (
                        <a
                          key={`shared-${section}`}
                          href={lawSectionSearchHref(section)}
                          className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                          title={t("llm_council.law_section_open_search", {
                            defaultValue: "Open legislation search for this section",
                          })}
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          {section}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-text">
                      {t("llm_council.shared_law_sections_empty", {
                        defaultValue:
                          "No section is jointly cited by all three model answers.",
                      })}
                    </p>
                  )}
                </div>

                <div className="rounded-md border border-border bg-surface p-3">
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-text">
                    {t("llm_council.provider_law_sections_label", {
                      defaultValue: "Provider Law Sections",
                    })}
                  </p>
                  <p className="mb-2 text-xs text-muted-text">
                    {t("llm_council.provider_law_sections_note", {
                      defaultValue:
                        "Expand each model to review the statutory sections extracted from that model's answer.",
                    })}
                  </p>
                  {providerLawSectionEntries.length === 0 ? (
                    <p className="text-sm text-muted-text">
                      {t("llm_council.provider_law_sections_empty", {
                        defaultValue: "No provider section data available.",
                      })}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {providerLawSectionEntries.map((entry) => (
                        <details
                          key={`provider-law-${entry.provider_key}`}
                          className="rounded border border-border bg-card p-2"
                        >
                          <summary className="cursor-pointer list-none text-sm font-medium text-foreground">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span>{entry.provider_label}</span>
                              <span className="text-xs text-muted-text">
                                {entry.success
                                  ? t("llm_council.provider_law_sections_count", {
                                      defaultValue: "{{count}} sections",
                                      count: entry.sections.length,
                                    })
                                  : t("llm_council.provider_law_sections_failed", {
                                      defaultValue: "Model failed",
                                    })}
                              </span>
                            </div>
                          </summary>
                          <div className="mt-2 border-t border-border pt-2">
                            {!entry.success ? (
                              <p className="text-xs text-muted-text">
                                {t("llm_council.provider_law_sections_failed_note", {
                                  defaultValue:
                                    "This model did not return a successful answer, so no section list is available.",
                                })}
                              </p>
                            ) : entry.sections.length > 0 ? (
                              <div className="space-y-1">
                                {entry.sections.map((section) => (
                                  <a
                                    key={`${entry.provider_key}-${section}`}
                                    href={lawSectionSearchHref(section)}
                                    className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                                    title={t("llm_council.law_section_open_search", {
                                      defaultValue: "Open legislation search for this section",
                                    })}
                                  >
                                    <ExternalLink className="h-3 w-3 shrink-0" />
                                    {section}
                                  </a>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-text">
                                {t("llm_council.provider_law_sections_none_for_model", {
                                  defaultValue:
                                    "No identifiable statutory/regulatory section citation was extracted for this model.",
                                })}
                              </p>
                            )}
                          </div>
                        </details>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-border bg-surface p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted-text">
                    {t("llm_council.ranking_label", {
                      defaultValue: "Council Ranking",
                    })}
                  </p>
                  <div className="space-y-2">
                    {result.moderator.ranking.map((entry) => (
                      <div
                        key={`${entry.provider_key}-${entry.rank}`}
                        className="rounded border border-border bg-card p-2 text-sm"
                      >
                        <p className="font-medium text-foreground">
                          #{entry.rank} {entry.provider_label} ({entry.score})
                        </p>
                        {critiquesByProvider.get(entry.provider_key)?.vote ? (
                          <p className="mt-1">
                            <span
                              className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${voteTone(
                                critiquesByProvider.get(entry.provider_key)?.vote || "",
                              )}`}
                            >
                              {t(
                                `llm_council.vote_${(critiquesByProvider.get(entry.provider_key)?.vote || "neutral").toLowerCase()}`,
                                {
                                  defaultValue:
                                    (critiquesByProvider.get(entry.provider_key)?.vote || "neutral").toUpperCase(),
                                },
                              )}
                            </span>
                          </p>
                        ) : null}
                        <p className="text-xs text-muted-text">
                          {entry.reason ||
                            t("llm_council.no_rationale", {
                              defaultValue: "No rationale provided.",
                            })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-border bg-surface p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-muted-text">
                      {t("llm_council.agreement_points_label", {
                        defaultValue: "Agreed Parts",
                      })}
                    </p>
                    {result.moderator.agreement_points &&
                    result.moderator.agreement_points.length > 0 ? (
                      <ul className="space-y-1 text-sm text-foreground">
                        {result.moderator.agreement_points.map((point) => (
                          <li key={point}>• {point}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-text">—</p>
                    )}
                  </div>
                  <div className="rounded-md border border-border bg-surface p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-muted-text">
                      {t("llm_council.conflict_points_label", {
                        defaultValue: "Conflict Parts",
                      })}
                    </p>
                    {result.moderator.conflict_points &&
                    result.moderator.conflict_points.length > 0 ? (
                      <ul className="space-y-1 text-sm text-foreground">
                        {result.moderator.conflict_points.map((point) => (
                          <li key={point}>• {point}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-text">—</p>
                    )}
                  </div>
                </div>

                <div className="rounded-md border border-border bg-surface p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted-text">
                    {t("llm_council.moderator_critiques_label", {
                      defaultValue: "Moderator Critiques & Votes",
                    })}
                  </p>
                  <div className="space-y-2">
                    {(result.moderator.model_critiques || []).map((entry) => (
                      <div
                        key={`critique-${entry.provider_key}`}
                        className="rounded border border-border bg-card p-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">
                            {entry.provider_label} ({entry.score})
                          </p>
                          <span
                            className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${voteTone(
                              entry.vote,
                            )}`}
                          >
                            {t(`llm_council.vote_${(entry.vote || "neutral").toLowerCase()}`, {
                              defaultValue: (entry.vote || "neutral").toUpperCase(),
                            })}
                          </span>
                        </div>
                        {entry.strengths ? (
                          <p className="mt-2 text-xs text-foreground">
                            <span className="font-semibold text-muted-text">
                              {t("llm_council.critique_strengths", {
                                defaultValue: "Strengths:",
                              })}{" "}
                            </span>
                            {entry.strengths}
                          </p>
                        ) : null}
                        {entry.weaknesses ? (
                          <p className="mt-1 text-xs text-foreground">
                            <span className="font-semibold text-muted-text">
                              {t("llm_council.critique_weaknesses", {
                                defaultValue: "Weaknesses:",
                              })}{" "}
                            </span>
                            {entry.weaknesses}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-muted-text">
                          {entry.critique ||
                            t("llm_council.no_rationale", {
                              defaultValue: "No rationale provided.",
                            })}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <ApiErrorState
                title={t("llm_council.moderator_failed_title", {
                  defaultValue: "Moderator synthesis unavailable",
                })}
                message={
                  result.moderator.error ||
                  t("llm_council.unknown_moderator_error", {
                    defaultValue: "Unknown moderator error",
                  })
                }
              />
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">
              {t("llm_council.expert_title", {
                defaultValue: "Expert Model Opinions",
              })}
            </h2>

            {sortedOpinions.map((opinion) => (
              <article
                key={opinion.provider_key}
                className="rounded-xl border border-border/80 bg-card p-5 shadow-sm"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-accent" />
                    <p className="font-semibold text-foreground">
                      {opinion.provider_label}
                    </p>
                    <span className="text-xs text-muted-text">{opinion.model}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    {opinion.success ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-emerald-700 dark:text-emerald-400">
                          {t("llm_council.status_ok", {
                            defaultValue: "OK ({{latency}} ms)",
                            latency: opinion.latency_ms,
                          })}
                        </span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                        <span className="text-amber-700 dark:text-amber-400">
                          {t("llm_council.status_failed", {
                            defaultValue: "Failed ({{latency}} ms)",
                            latency: opinion.latency_ms,
                          })}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {opinion.success ? (
                  <>
                    <p className="whitespace-pre-wrap text-sm text-foreground">
                      {opinion.answer}
                    </p>
                    {opinion.sources.length > 0 ? (
                      <div className="mt-3">
                        <p className="mb-1 text-xs uppercase tracking-wide text-muted-text">
                          {t("llm_council.sources_label", {
                            defaultValue: "Sources",
                          })}
                        </p>
                        <div className="space-y-1">
                          {opinion.sources.map((source) => (
                            <a
                              key={source}
                              href={source}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 break-all text-xs text-accent hover:underline"
                            >
                              <ExternalLink className="h-3 w-3 shrink-0" />
                              {source}
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <ApiErrorState
                    title={t("llm_council.expert_failed_title", {
                      defaultValue: "Model request failed",
                    })}
                    message={
                      opinion.error ||
                      t("llm_council.unknown_model_error", {
                        defaultValue: "Unknown model error",
                      })
                    }
                  />
                )}
              </article>
            ))}
          </section>
        </>
      ) : (
        <section className="rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-text shadow-sm">
          <div className="flex items-center gap-2">
            {councilMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
            ) : (
              <Sparkles className="h-4 w-4 text-accent" />
            )}
            <p>
              {councilMutation.isPending
                ? t("llm_council.running_hint", {
                    defaultValue:
                      "Council is running. Waiting for all expert opinions and composition.",
                  })
                : t("llm_council.idle_hint", {
                    defaultValue:
                      "Submit a question to generate a 3-model council analysis and Gemini Flash synthesis.",
                  })}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
