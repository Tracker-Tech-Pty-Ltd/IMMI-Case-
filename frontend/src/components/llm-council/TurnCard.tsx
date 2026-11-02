/**
 * frontend/src/components/llm-council/TurnCard.tsx
 *
 * Renders a single council session turn (Sprint 3 UI rebuild):
 *   - User message header
 *   - Moderator synthesis (top — primary answer, like a legal memo's holding)
 *     + Likelihood badge
 *     + Composed answer
 *     + Law sections cross-reference table (provider × statute matrix)
 *     + Consensus / Disagreements
 *     + Follow-up questions
 *   - Expert opinions (collapsible accordion, default closed)
 *     + Tab navigation between providers
 *     + Per-tab answer + sources + status
 *
 * Mobile + desktop: experts collapsed by default (moderator is the holding).
 */

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Scale,
  Sparkles,
  User,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import type {
  LlmCouncilTurn,
  LlmCouncilOpinion,
  LlmCouncilModerator,
} from "@/lib/api-llm-council";

// ---------------------------------------------------------------------------
// Markdown — styled wrapper for legal-memo output. GFM enables tables,
// strikethrough, autolinks, task-lists. Block-incomplete markdown (e.g. an
// unfinished table row) renders gracefully as raw text until the syntax
// closes; this naturally supports streaming "wait until block is complete"
// rendering once SSE deltas re-render the buffer each chunk.
// ---------------------------------------------------------------------------

type MdProps = React.HTMLAttributes<HTMLElement>;
type MdCodeProps = React.HTMLAttributes<HTMLElement> & { inline?: boolean; className?: string; children?: React.ReactNode };

const MARKDOWN_COMPONENTS: Record<string, (props: MdProps | MdCodeProps) => React.ReactNode> = {
  h1: (p: MdProps) => <h1 className="mb-2 mt-3 text-base font-bold text-foreground" {...p} />,
  h2: (p: MdProps) => <h2 className="mb-2 mt-3 text-sm font-bold text-foreground" {...p} />,
  h3: (p: MdProps) => <h3 className="mb-1 mt-2 text-sm font-semibold text-foreground" {...p} />,
  h4: (p: MdProps) => <h4 className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-muted-text" {...p} />,
  p: (p: MdProps) => <p className="mb-2 leading-relaxed text-foreground" {...p} />,
  ul: (p: MdProps) => <ul className="mb-2 ml-4 list-disc space-y-1 text-foreground marker:text-accent" {...p} />,
  ol: (p: MdProps) => <ol className="mb-2 ml-4 list-decimal space-y-1 text-foreground marker:text-accent" {...p} />,
  li: (p: MdProps) => <li className="leading-relaxed" {...p} />,
  strong: (p: MdProps) => <strong className="font-semibold text-foreground" {...p} />,
  em: (p: MdProps) => <em className="italic" {...p} />,
  a: (p: MdProps) => (
    <a className="text-accent underline-offset-2 hover:underline" target="_blank" rel="noreferrer" {...p} />
  ),
  blockquote: (p: MdProps) => (
    <blockquote className="my-2 border-l-2 border-accent/50 bg-surface/40 pl-3 italic text-muted-text" {...p} />
  ),
  code: ({ inline, className, children, ...rest }: MdCodeProps) =>
    inline ? (
      <code className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em] text-accent" {...rest}>
        {children}
      </code>
    ) : (
      <code className={`block overflow-x-auto rounded-md bg-surface p-2 font-mono text-xs ${className || ""}`} {...rest}>
        {children}
      </code>
    ),
  pre: (p: MdProps) => <pre className="my-2 overflow-x-auto rounded-md bg-surface p-3 text-xs" {...p} />,
  hr: () => <hr className="my-3 border-border" />,
  table: (p: MdProps) => (
    <div className="my-2 overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs" {...p} />
    </div>
  ),
  thead: (p: MdProps) => <thead className="bg-surface/50 text-muted-text" {...p} />,
  tbody: (p: MdProps) => <tbody {...p} />,
  tr: (p: MdProps) => <tr className="border-b border-border last:border-0" {...p} />,
  th: (p: MdProps) => <th className="px-2 py-1.5 text-left font-semibold" {...p} />,
  td: (p: MdProps) => <td className="px-2 py-1.5 align-top" {...p} />,
};

function Markdown({ children }: { children: string }) {
  return (
    <div className="max-w-prose text-base text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
function sectionKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// ---------------------------------------------------------------------------
// LawSectionsTable — provider × statute cross-reference (Sprint 3 P3-2)
// ---------------------------------------------------------------------------

interface LawSectionsTableProps {
  providerLawSections: Record<string, string[]>;
  sharedLawSections: string[];
  providerLabels: Record<string, string>;
  confidence: number;
  confidenceReason: string;
}

function LawSectionsTable({
  providerLawSections,
  sharedLawSections,
  providerLabels,
  confidence,
  confidenceReason,
}: LawSectionsTableProps) {
  const { t } = useTranslation();

  const providers = Object.keys(providerLawSections).sort();
  if (providers.length === 0) return null;

  const sectionMap = new Map<string, string>();
  for (const provider of providers) {
    for (const section of providerLawSections[provider] || []) {
      const key = sectionKey(section);
      if (key && !sectionMap.has(key)) {
        sectionMap.set(key, section);
      }
    }
  }
  const allSections = Array.from(sectionMap.values());
  if (allSections.length === 0) return null;

  const sharedKeys = new Set(sharedLawSections.map(sectionKey));
  const cited = (provider: string, key: string): boolean => {
    const list = providerLawSections[provider] || [];
    return list.some((s) => sectionKey(s) === key);
  };

  return (
    <div
      className="mt-4 rounded-md border border-border bg-surface/40"
      data-testid="law-sections-table"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Scale className="h-3.5 w-3.5 text-accent" />
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-text">
            {t("llm_council.law_sections_table_title", {
              defaultValue: "Statute Citations Cross-Reference",
            })}
          </p>
        </div>
        {confidence > 0 ? (
          <span
            title={confidenceReason}
            className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent"
          >
            {t("llm_council.citation_confidence", {
              defaultValue: "Citation overlap",
            })}
            : {confidence}%
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-background/50 text-muted-text">
              <th className="px-3 py-1.5 text-left font-semibold">
                {t("llm_council.law_section_col", {
                  defaultValue: "Statute / Regulation",
                })}
              </th>
              {providers.map((p) => (
                <th
                  key={p}
                  className="px-2 py-1.5 text-center font-semibold whitespace-nowrap"
                >
                  {providerLabels[p] || p}
                </th>
              ))}
              <th className="px-2 py-1.5 text-center font-semibold whitespace-nowrap">
                {t("llm_council.shared_col", { defaultValue: "All Agree" })}
              </th>
            </tr>
          </thead>
          <tbody>
            {allSections.map((section) => {
              const key = sectionKey(section);
              const isShared = sharedKeys.has(key);
              return (
                <tr
                  key={key}
                  className={`border-b border-border/50 last:border-b-0 ${
                    isShared ? "bg-emerald-50 dark:bg-emerald-900/10" : ""
                  }`}
                >
                  <td className="px-3 py-1.5 font-medium text-foreground">
                    {section}
                  </td>
                  {providers.map((p) => (
                    <td key={p} className="px-2 py-1.5 text-center">
                      {cited(p, key) ? (
                        <CheckCircle2
                          className="mx-auto h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                          aria-label={`${providerLabels[p] || p} cited`}
                        />
                      ) : (
                        <span aria-label="Not cited" className="text-muted-text">
                          —
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-center">
                    {isShared ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                        ✓
                      </span>
                    ) : (
                      <span className="text-muted-text">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModeratorSection — moved to top, primary answer block
// ---------------------------------------------------------------------------

interface ModeratorSectionProps {
  moderator: LlmCouncilModerator;
  providerLabels: Record<string, string>;
  onSelectFollowUp?: (question: string) => void;
  followUpDisabled?: boolean;
}

export function ModeratorSection({ moderator, providerLabels, onSelectFollowUp, followUpDisabled }: ModeratorSectionProps) {
  const { t } = useTranslation();

  if (!moderator.success) {
    return (
      <div
        className="rounded-xl border border-border/80 bg-card p-4 shadow-sm"
        data-testid="moderator-section"
      >
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <h2 className="text-base font-semibold text-foreground">
            {t("llm_council.moderator_section_title", {
              defaultValue: "Moderator Synthesis",
            })}
          </h2>
        </div>
        <ApiErrorState
          title={t("llm_council.moderator_failed_title", {
            defaultValue: "Moderator synthesis unavailable",
          })}
          message={
            moderator.error ||
            t("llm_council.unknown_moderator_error", {
              defaultValue: "Unknown moderator error",
            })
          }
        />
      </div>
    );
  }

  const estimateLabels: Record<string, string> = {
    high: t("llm_council.estimate_high", { defaultValue: "High" }),
    medium: t("llm_council.estimate_medium", { defaultValue: "Medium" }),
    low: t("llm_council.estimate_low", { defaultValue: "Low" }),
  };
  const estimateLabel = estimateLabels[(moderator.outcome_likelihood_label || "").toLowerCase()] || moderator.outcome_likelihood_label;

  return (
    <div
      className="overflow-hidden rounded-xl border border-accent/30 bg-gradient-to-br from-card via-card to-accent/5 p-4 shadow-sm sm:p-6"
      data-testid="moderator-section"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-accent/20 pb-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/10 text-accent motion-safe:transition-transform motion-safe:duration-300 motion-safe:hover:scale-110">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="text-base font-semibold text-foreground">
          {t("llm_council.moderator_section_title", {
            defaultValue: "Moderator Synthesis",
          })}
        </h2>
        {moderator.outcome_likelihood_label ? (
          <span
            className="ml-auto rounded border border-border bg-surface px-2 py-1 text-xs font-semibold uppercase tracking-wide text-foreground"
          >
            {estimateLabel}
          </span>
        ) : null}
        {typeof moderator.outcome_likelihood_percent === "number" && Number.isFinite(moderator.outcome_likelihood_percent) ? (
          <span className="text-right">
            <span className="block text-xs text-muted-text">{t("llm_council.model_estimate", { defaultValue: "Model estimate" })}</span>
            <span className="text-sm font-bold tabular-nums text-foreground">
              {moderator.outcome_likelihood_percent}%
            </span>
          </span>
        ) : null}
      </div>

      {moderator.outcome_likelihood_reason ? (
        <p className="mb-3 max-w-prose text-sm leading-relaxed text-muted-text">{moderator.outcome_likelihood_reason}</p>
      ) : null}

      {moderator.composed_answer ? (
        <div className="rounded-xl border border-accent/20 bg-card/80 p-4 shadow-sm sm:p-5">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-text">
            {t("llm_council.composed_answer_label", {
              defaultValue: "Integrated Council Analysis",
            })}
          </p>
          {moderator.mock_judgment === moderator.composed_answer ? (
            <p className="mb-2 text-xs text-muted-text">
              {t("llm_council.mock_judgment_note", { defaultValue: "Research simulation only. This is not an actual judicial outcome." })}
            </p>
          ) : null}
          <Markdown>{moderator.composed_answer}</Markdown>
        </div>
      ) : null}

      {moderator.mock_judgment && moderator.mock_judgment !== moderator.composed_answer ? (
        <details className="mt-3 rounded-md border border-border bg-surface/40 p-3" open={!moderator.composed_answer}>
          <summary className="cursor-pointer text-sm font-semibold text-foreground">
            {t("llm_council.mock_judgment_label", { defaultValue: "Mock judgment draft" })}
          </summary>
          <p className="mt-2 text-xs text-muted-text">
            {t("llm_council.mock_judgment_note", { defaultValue: "Research simulation only. This is not an actual judicial outcome." })}
          </p>
          <div className="mt-2"><Markdown>{moderator.mock_judgment}</Markdown></div>
        </details>
      ) : null}

      {moderator.consensus ? (
        <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-text">
          <span className="font-semibold">
            {t("llm_council.consensus_label", { defaultValue: "Consensus" })}:{" "}
          </span>
          {moderator.consensus}
        </p>
      ) : null}

      {moderator.disagreements ? (
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-text">
          <span className="font-semibold">
            {t("llm_council.disagreements_label", {
              defaultValue: "Disagreements",
            })}
            :{" "}
          </span>
          {moderator.disagreements}
        </p>
      ) : null}

      {[moderator.agreement_points, moderator.conflict_points, moderator.law_sections].some(
        (items) => Array.isArray(items) && items.some((item) => typeof item === "string" && item.trim()),
      ) ? (
        <section className="mt-4 border-t border-border pt-3" data-testid="council-insights">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-text">
            {t("llm_council.insights_title", { defaultValue: "Explore the analysis" })}
          </p>
          {[
            { key: "agreement", label: t("llm_council.insights_agreement", { defaultValue: "Points of agreement" }), items: moderator.agreement_points },
            { key: "difference", label: t("llm_council.insights_difference", { defaultValue: "Points of difference" }), items: moderator.conflict_points },
            { key: "law", label: t("llm_council.insights_law", { defaultValue: "Laws mentioned" }), items: moderator.law_sections },
          ].map(({ key, label, items }) => {
            const entries = Array.isArray(items) ? items.filter((item): item is string => typeof item === "string" && !!item.trim()) : [];
            if (!entries.length) return null;
            return (
              <details key={key} className="group border-b border-border last:border-b-0">
                <summary className="cursor-pointer rounded-md py-3 text-sm font-semibold text-foreground transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  {label} <span className="text-muted-text">({entries.length})</span>
                </summary>
                <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-foreground">
                  {entries.map((entry, index) => <li key={`${index}-${entry}`}><Markdown>{entry}</Markdown></li>)}
                </ul>
              </details>
            );
          })}
        </section>
      ) : null}

      {moderator.provider_law_sections &&
      Object.keys(moderator.provider_law_sections).length > 0 ? (
        <LawSectionsTable
          providerLawSections={moderator.provider_law_sections}
          sharedLawSections={moderator.shared_law_sections || []}
          providerLabels={providerLabels}
          confidence={moderator.shared_law_sections_confidence_percent || 0}
          confidenceReason={moderator.shared_law_sections_confidence_reason || ""}
        />
      ) : null}

      {Array.isArray(moderator.follow_up_questions) && moderator.follow_up_questions.some((q) => typeof q === "string" && q.trim()) ? (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-text">
            {t("llm_council.follow_up_label", {
              defaultValue: "Follow-up Questions",
            })}
          </p>
          <ul className="space-y-1 text-sm text-muted-text">
            {moderator.follow_up_questions.filter((q): q is string => typeof q === "string" && !!q.trim()).map((q, i) => (
              <li key={i}>
                {onSelectFollowUp ? (
                  <button type="button" disabled={followUpDisabled} onClick={() => onSelectFollowUp(q)}
                    className="min-h-11 rounded-lg border border-accent/25 bg-card px-3 py-2 text-left text-foreground shadow-sm transition-colors hover:border-accent hover:bg-accent/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 motion-safe:transition-transform motion-safe:hover:-translate-y-0.5">
                    {q}
                  </button>
                ) : <>• {q}</>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExpertTabs — tabbed expert opinions inside collapsible accordion
// ---------------------------------------------------------------------------

interface ExpertTabsProps {
  opinions: LlmCouncilOpinion[];
}

function ExpertTabs({ opinions }: ExpertTabsProps) {
  const { t } = useTranslation();
  const id = useId();
  const [activeKey, setActiveKey] = useState<string>(
    opinions[0]?.provider_key || "",
  );

  if (opinions.length === 0) return null;

  const active = opinions.find((o) => o.provider_key === activeKey) || opinions[0];

  return (
    <div className="space-y-3" data-testid="expert-tabs">
      <div
        role="tablist"
        aria-label={t("llm_council.expert_title", { defaultValue: "Expert Model Opinions" })}
        className="-mb-px flex flex-wrap gap-1 border-b border-border"
      >
        {opinions.map((op, index) => {
          const isActive = op.provider_key === active.provider_key;
          return (
            <button
              key={op.provider_key}
              type="button"
              role="tab"
              id={`${id}-tab-${index}`}
              aria-selected={isActive}
              aria-controls={`${id}-panel`}
              tabIndex={isActive ? 0 : -1}
              data-testid={`expert-tab-${op.provider_key}`}
              onClick={() => setActiveKey(op.provider_key)}
              onKeyDown={(event) => {
                let nextIndex: number;
                if (event.key === "ArrowRight") nextIndex = (index + 1) % opinions.length;
                else if (event.key === "ArrowLeft") nextIndex = (index - 1 + opinions.length) % opinions.length;
                else if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End") nextIndex = opinions.length - 1;
                else return;
                event.preventDefault();
                setActiveKey(opinions[nextIndex].provider_key);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
              }}
              className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition-colors ${
                isActive
                  ? "border-accent text-accent"
                  : "border-transparent text-muted-text hover:text-foreground"
              }`}
            >
              {op.success ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
              )}
              <span>{op.provider_label}</span>
              <span className="sr-only">{" "}{op.success
                ? t("llm_council.status_ok", { defaultValue: "OK ({{latency}} ms)", latency: op.latency_ms })
                : t("llm_council.status_failed", { defaultValue: "Failed ({{latency}} ms)", latency: op.latency_ms })}</span>
            </button>
          );
        })}
      </div>

      <article
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-tab-${opinions.indexOf(active)}`}
        tabIndex={0}
        className="rounded-md border border-border/80 bg-card p-3"
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-muted-text">
            <Bot className="h-3.5 w-3.5" />
            <span className="font-mono">{active.model}</span>
          </div>
          <div>
            {active.success ? (
              <span className="text-emerald-700 dark:text-emerald-400">
                {t("llm_council.status_ok", {
                  defaultValue: "OK ({{latency}} ms)",
                  latency: active.latency_ms,
                })}
              </span>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">
                {t("llm_council.status_failed", {
                  defaultValue: "Failed ({{latency}} ms)",
                  latency: active.latency_ms,
                })}
              </span>
            )}
          </div>
        </div>

        {active.success ? (
          <>
            <Markdown>{active.answer}</Markdown>
            {active.sources.length > 0 ? (
              <div className="mt-3">
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-text">
                  {t("llm_council.sources_label", { defaultValue: "Sources" })}
                </p>
                <div className="space-y-1">
                  {active.sources.map((source) => (
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
              active.error ||
              t("llm_council.unknown_model_error", {
                defaultValue: "Unknown model error",
              })
            }
          />
        )}
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TurnCard (exported)
// ---------------------------------------------------------------------------

export interface TurnCardProps {
  turn: LlmCouncilTurn;
  turnNumber: number;
  onSelectFollowUp?: (question: string) => void;
  followUpDisabled?: boolean;
}

export function TurnCard({ turn, turnNumber, onSelectFollowUp, followUpDisabled }: TurnCardProps) {
  const { t } = useTranslation();
  const [expertsExpanded, setExpertsExpanded] = useState(false);

  const providerLabels: Record<string, string> = {};
  for (const op of turn.opinions || []) {
    providerLabels[op.provider_key] = op.provider_label;
  }

  const successCount = (turn.opinions || []).filter((o) => o.success).length;

  return (
    <div
      className="space-y-3"
      data-testid="turn-card"
      aria-label={`Turn ${turnNumber}`}
    >
      {/* User message */}
      <div className="flex items-start gap-3 rounded-xl border border-accent/20 bg-gradient-to-r from-accent/10 via-surface to-surface p-4 shadow-sm sm:p-5">
        <div className="mt-0.5 rounded-full bg-accent/15 p-1.5 text-accent">
          <User className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-text">
            {t("llm_council.turn_label", { defaultValue: "Turn" })}{" "}
            {turnNumber} —{" "}
            {t("llm_council.turn_your_question", {
              defaultValue: "Your question",
            })}
          </p>
          <p className="text-sm text-foreground">{turn.user_message}</p>
        </div>
      </div>

      {/* Moderator synthesis — TOP placement (primary holding) */}
      <ModeratorSection
        moderator={turn.moderator}
        providerLabels={providerLabels}
        onSelectFollowUp={onSelectFollowUp}
        followUpDisabled={followUpDisabled}
      />

      {/* Expert opinions — collapsible accordion with tabs */}
      {turn.opinions && turn.opinions.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm transition-colors hover:border-accent/40">
          <button
            type="button"
            onClick={() => setExpertsExpanded((v) => !v)}
            aria-expanded={expertsExpanded}
            data-testid="experts-toggle"
            className="flex min-h-11 w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-accent/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-accent" />
              <span className="text-sm font-semibold text-foreground">
                {t("llm_council.expert_title", {
                  defaultValue: "Expert Model Opinions",
                })}
              </span>
              <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-text">
                {successCount}/{turn.opinions.length}{" "}
                {t("llm_council.experts_ok_label", { defaultValue: "OK" })}
              </span>
            </div>
            {expertsExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-text" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-text" />
            )}
          </button>
          {expertsExpanded ? (
            <div className="border-t border-border px-4 pb-4 pt-3">
              <ExpertTabs opinions={turn.opinions} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
