import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, Zap, AlertCircle, ExternalLink } from "lucide-react";
import { useSemanticSearch } from "@/hooks/use-semantic-search";
import { OutcomeBadge } from "@/components/shared/OutcomeBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { PageHeader } from "@/components/shared/PageHeader";
import type { SemanticSearchResult } from "@/lib/api";

// ─── Similarity badge ────────────────────────────────────────────
function SimilarityBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 85
      ? "bg-success/10 text-success"
      : pct >= 70
        ? "bg-info/10 text-info"
        : "bg-surface text-muted-text";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {pct}% match
    </span>
  );
}

// ─── Result card ─────────────────────────────────────────────────
function ResultCard({ result }: { result: SemanticSearchResult }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-xs hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to={`/cases/${result.case_id}`}
            className="text-sm font-medium text-primary hover:underline line-clamp-2"
          >
            {result.title || result.citation}
          </Link>
          {result.title && (
            <p className="mt-0.5 truncate text-xs text-muted-text">
              {result.citation}
            </p>
          )}
        </div>
        <SimilarityBadge score={result.similarity_score} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        {result.outcome && <OutcomeBadge outcome={result.outcome} />}
        <Link
          to={`/cases/${result.case_id}`}
          className="ml-auto flex items-center gap-1 text-xs text-muted-text hover:text-accent"
        >
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────
export function SemanticSearchPage() {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [provider, setProvider] = useState<"openai" | "gemini">("openai");

  const { data, isFetching, isError, error } = useSemanticSearch(
    submittedQuery,
    10,
    provider,
    !!submittedQuery,
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const q = inputValue.trim();
      if (q.length >= 3) {
        setSubmittedQuery(q);
      }
    },
    [inputValue],
  );

  const unavailable = data && !data.available;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      {/* Header */}
      <PageHeader
        title={t("semantic_search.title", { defaultValue: "Semantic Search" })}
        description={t("semantic_search.description", {
          defaultValue:
            "Search by meaning, not just keywords. Uses AI embeddings to find semantically similar cases.",
        })}
        icon={<Zap className="h-5 w-5" />}
      />

      {/* Search form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-text" />
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={t("semantic_search.placeholder", {
                defaultValue: "Describe the case situation… (min 3 chars)",
              })}
              className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm shadow-xs focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <button
            type="submit"
            disabled={inputValue.trim().length < 3 || isFetching}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-accent-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isFetching
              ? t("semantic_search.searching", { defaultValue: "Searching…" })
              : t("semantic_search.search_btn", { defaultValue: "Search" })}
          </button>
        </div>

        {/* Provider toggle */}
        <div className="flex items-center gap-3 text-xs text-muted-text">
          <span>
            {t("semantic_search.model_label", { defaultValue: "Model:" })}
          </span>
          {(["openai", "gemini"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProvider(p)}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                provider === p
                  ? "bg-accent-muted text-accent"
                  : "hover:text-foreground"
              }`}
            >
              {p === "openai" ? "OpenAI" : "Gemini"}
            </button>
          ))}
        </div>
      </form>

      {/* Results area */}
      {unavailable && (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {t("semantic_search.unavailable", {
              defaultValue:
                "Semantic search is not available. Ensure the Supabase backend is configured and an API key is set.",
            })}
          </span>
        </div>
      )}

      {isError && (
        <ApiErrorState
          message={
            error instanceof Error
              ? error.message
              : t("errors.unable_to_load_message")
          }
        />
      )}

      {isFetching && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {!isFetching &&
        data?.available &&
        data.results.length === 0 &&
        submittedQuery && (
          <EmptyState
            title={t("semantic_search.no_results_title", {
              defaultValue: "No results found",
            })}
            description={t("semantic_search.no_results_desc", {
              defaultValue: "Try rephrasing or using different terminology.",
            })}
          />
        )}

      {!isFetching && data?.available && data.results.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-text">
            {t("semantic_search.results_count", {
              count: data.results.length,
              defaultValue: `${data.results.length} results`,
            })}
          </p>
          {data.results.map((result) => (
            <ResultCard key={result.case_id} result={result} />
          ))}
        </div>
      )}
    </div>
  );
}
