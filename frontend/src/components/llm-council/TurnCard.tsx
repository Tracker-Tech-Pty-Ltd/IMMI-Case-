/**
 * frontend/src/components/llm-council/TurnCard.tsx
 *
 * Renders a single council session turn:
 *   - User message header
 *   - 3 provider opinion cards
 *   - Moderator synthesis section
 */

import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Sparkles,
  User,
} from "lucide-react";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import type {
  LlmCouncilTurn,
  LlmCouncilOpinion,
  LlmCouncilModerator,
} from "@/lib/api-llm-council";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function likelihoodTone(label: string) {
  const normalized = (label || "").toLowerCase();
  if (normalized === "high") return "text-emerald-700 dark:text-emerald-300";
  if (normalized === "medium") return "text-amber-700 dark:text-amber-300";
  if (normalized === "low") return "text-rose-700 dark:text-rose-300";
  return "text-muted-text";
}

function likelihoodBadge(label: string) {
  const normalized = (label || "").toLowerCase();
  if (normalized === "high")
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (normalized === "medium")
    return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  if (normalized === "low")
    return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300";
  return "bg-surface text-muted-text";
}

// ---------------------------------------------------------------------------
// OpinionCard
// ---------------------------------------------------------------------------

interface OpinionCardProps {
  opinion: LlmCouncilOpinion;
}

function OpinionCard({ opinion }: OpinionCardProps) {
  const { t } = useTranslation();
  return (
    <article
      className="rounded-xl border border-border/80 bg-card p-4 shadow-sm"
      aria-label={opinion.provider_label}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-accent" />
          <p className="font-semibold text-foreground">{opinion.provider_label}</p>
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
                {t("llm_council.sources_label", { defaultValue: "Sources" })}
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
  );
}

// ---------------------------------------------------------------------------
// ModeratorSection
// ---------------------------------------------------------------------------

interface ModeratorSectionProps {
  moderator: LlmCouncilModerator;
}

function ModeratorSection({ moderator }: ModeratorSectionProps) {
  const { t } = useTranslation();

  if (!moderator.success) {
    return (
      <div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-foreground">
            {t("llm_council.moderator_section_title", {
              defaultValue: "Moderator Synthesis",
            })}
          </h3>
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

  return (
    <div
      className="rounded-xl border border-border/80 bg-card p-4 shadow-sm"
      data-testid="moderator-section"
    >
      <div className="mb-3 flex items-center gap-2 border-b border-border pb-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-foreground">
          {t("llm_council.moderator_section_title", {
            defaultValue: "Moderator Synthesis",
          })}
        </h3>
        {moderator.outcome_likelihood_label ? (
          <span
            className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${likelihoodBadge(
              moderator.outcome_likelihood_label,
            )}`}
          >
            {(moderator.outcome_likelihood_label || "unknown").toUpperCase()}
          </span>
        ) : null}
        {typeof moderator.outcome_likelihood_percent === "number" ? (
          <span
            className={`text-sm font-bold tabular-nums ${likelihoodTone(
              moderator.outcome_likelihood_label,
            )}`}
          >
            {moderator.outcome_likelihood_percent}%
          </span>
        ) : null}
      </div>

      {moderator.mock_judgment || moderator.composed_answer ? (
        <div className="rounded-md border border-border bg-surface p-3">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-text">
            {t("llm_council.composed_answer_label", {
              defaultValue: "Integrated Council Analysis",
            })}
          </p>
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {moderator.mock_judgment || moderator.composed_answer}
          </p>
        </div>
      ) : null}

      {moderator.consensus ? (
        <p className="mt-3 text-xs text-muted-text">
          <span className="font-semibold">
            {t("llm_council.consensus_label", { defaultValue: "Consensus" })}:{" "}
          </span>
          {moderator.consensus}
        </p>
      ) : null}

      {moderator.follow_up_questions && moderator.follow_up_questions.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-text">
            {t("llm_council.follow_up_label", {
              defaultValue: "Follow-up Questions",
            })}
          </p>
          <ul className="space-y-1 text-xs text-muted-text">
            {moderator.follow_up_questions.map((q, i) => (
              <li key={i}>• {q}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TurnCard (exported)
// ---------------------------------------------------------------------------

export interface TurnCardProps {
  turn: LlmCouncilTurn;
  turnNumber: number;
}

export function TurnCard({ turn, turnNumber }: TurnCardProps) {
  const { t } = useTranslation();

  return (
    <div
      className="space-y-3"
      data-testid="turn-card"
      aria-label={`Turn ${turnNumber}`}
    >
      {/* User message */}
      <div className="flex items-start gap-3 rounded-xl border border-border/80 bg-surface/60 p-4">
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

      {/* Opinions */}
      {turn.opinions.length > 0 ? (
        <div className="space-y-2">
          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-text">
            {t("llm_council.expert_title", {
              defaultValue: "Expert Model Opinions",
            })}
          </p>
          {turn.opinions.map((opinion) => (
            <OpinionCard key={opinion.provider_key} opinion={opinion} />
          ))}
        </div>
      ) : null}

      {/* Moderator synthesis */}
      <ModeratorSection moderator={turn.moderator} />
    </div>
  );
}
