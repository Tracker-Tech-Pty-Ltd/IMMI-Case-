import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { OutcomeBadge } from "@/components/shared/OutcomeBadge";
import type { SimilarCase } from "@/types/case";

interface SimilarCasesPanelProps {
  cases: SimilarCase[] | undefined;
  isLoading: boolean;
  /** When false, the panel is hidden entirely (no embeddings backend). */
  available?: boolean;
}

function SimilarCaseSkeleton() {
  return (
    <div className="animate-pulse flex items-center gap-3 rounded-md border border-border-light px-3 py-2">
      <div className="h-4 w-16 rounded bg-surface" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 w-3/4 rounded bg-surface" />
        <div className="h-3 w-1/3 rounded bg-surface" />
      </div>
      <div className="h-5 w-10 rounded bg-surface" />
    </div>
  );
}

export function SimilarCasesPanel({
  cases,
  isLoading,
  available = true,
}: SimilarCasesPanelProps) {
  const { t } = useTranslation();

  // Do not render the panel at all when semantic search is unavailable.
  if (!available && !isLoading) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-3 flex items-center gap-1.5 font-heading text-base font-semibold text-foreground">
        <Sparkles className="h-4 w-4 text-accent" />
        {t("cases.similar_cases", { defaultValue: "Similar Cases" })}
      </h2>

      {isLoading ? (
        <div className="space-y-2" data-testid="similar-cases-skeleton">
          {Array.from({ length: 3 }).map((_, i) => (
            <SimilarCaseSkeleton key={i} />
          ))}
        </div>
      ) : !cases || cases.length === 0 ? (
        <p
          className="text-sm text-muted-text"
          data-testid="similar-cases-empty"
        >
          {t("cases.no_similar_cases", {
            defaultValue: "No similar cases found.",
          })}
        </p>
      ) : (
        <div className="space-y-2" data-testid="similar-cases-list">
          {cases.map((sc) => (
            <Link
              key={sc.case_id}
              to={`/cases/${sc.case_id}`}
              className="flex items-center gap-3 rounded-md border border-border-light px-3 py-2 text-sm transition-colors hover:border-accent hover:bg-surface"
              data-testid="similar-case-item"
            >
              <div className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">
                  {sc.citation || sc.title}
                </span>
                {sc.citation && sc.title && sc.title !== sc.citation && (
                  <span className="block truncate text-xs text-muted-text">
                    {sc.title}
                  </span>
                )}
              </div>
              {sc.outcome && (
                <OutcomeBadge outcome={sc.outcome} className="shrink-0" />
              )}
              <span
                className="shrink-0 text-xs font-medium tabular-nums text-accent"
                title={t("cases.similarity_score", {
                  defaultValue: "Similarity score",
                })}
                data-testid="similarity-score"
              >
                {Math.round(sc.similarity_score * 100)}%
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
