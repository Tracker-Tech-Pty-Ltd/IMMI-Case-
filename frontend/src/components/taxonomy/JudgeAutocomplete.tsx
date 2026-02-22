import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search, User } from "lucide-react";
import { useJudgeAutocomplete } from "@/hooks/use-taxonomy";
import { cn } from "@/lib/utils";
import type { JudgeAutocompleteEntry } from "@/lib/api";

export function JudgeAutocomplete() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // State for search input with debounce
  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce timer ref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Fetch judge autocomplete data
  const { data, isLoading } = useJudgeAutocomplete(debouncedQuery, 20);

  const judgeResults = data?.judges ?? [];

  // Handle search input change with debounce
  const handleSearchChange = useCallback((value: string) => {
    setInputValue(value);

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer (300ms debounce)
    const timer = setTimeout(() => {
      setDebouncedQuery(value);
    }, 300);

    // Store timer in ref for cleanup
    debounceTimerRef.current = timer;
  }, []);

  const handleJudgeClick = useCallback(
    (judge: JudgeAutocompleteEntry) => {
      // Navigate to judge profile page
      navigate(`/judges/${encodeURIComponent(judge.name)}`);
    },
    [navigate],
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <h2 className="font-heading text-lg font-semibold text-foreground">
          {t("taxonomy.judge_autocomplete", {
            defaultValue: "Judge Search",
          })}
        </h2>
        <p className="mt-0.5 text-sm text-secondary-text">
          {t("taxonomy.judge_autocomplete_desc", {
            defaultValue: "Search for judge profiles and case history",
          })}
        </p>
      </div>

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-text" />
        <input
          type="text"
          value={inputValue}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t("taxonomy.judge_search_placeholder", {
            defaultValue: "e.g. Smith, Brown (min 2 chars)",
          })}
          className={cn(
            "w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-sm",
            "text-foreground placeholder:text-muted-text",
            "focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent",
            "transition-shadow",
          )}
        />
      </div>

      {/* Results */}
      {debouncedQuery && (
        <div className="rounded-md border border-border bg-card">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-muted-text">
              {t("common.loading", { defaultValue: "Loading..." })}
            </div>
          ) : debouncedQuery.length < 2 ? (
            <div className="p-4 text-center text-sm text-muted-text">
              {t("taxonomy.judge_min_chars", {
                defaultValue: "Type at least 2 characters to search",
              })}
            </div>
          ) : judgeResults.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-text">
              {t("taxonomy.no_judge_results", {
                defaultValue: "No matching judges found",
              })}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {judgeResults.map((judge) => (
                <button
                  key={judge.name}
                  onClick={() => handleJudgeClick(judge)}
                  className={cn(
                    "w-full px-4 py-3 text-left transition-colors",
                    "hover:bg-surface focus:bg-surface focus:outline-none",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <User className="h-4 w-4 shrink-0 text-muted-text" />
                      <span className="truncate text-sm font-medium text-foreground">
                        {judge.name}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="rounded-full bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent">
                        {judge.case_count.toLocaleString()}
                      </span>
                      <span className="text-xs text-muted-text">
                        {t("common.cases", { defaultValue: "cases" })}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
