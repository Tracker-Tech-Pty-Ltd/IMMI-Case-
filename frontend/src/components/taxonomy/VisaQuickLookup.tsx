import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { useVisaLookup } from "@/hooks/use-taxonomy";
import { cn } from "@/lib/utils";
import type { VisaEntry } from "@/lib/api";

export function VisaQuickLookup() {
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

  // Fetch visa lookup data
  const { data, isLoading } = useVisaLookup(debouncedQuery, 20);

  const visaResults = data?.data ?? [];

  // Handle search input change with debounce
  const handleSearchChange = useCallback((value: string) => {
    setInputValue(value);

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Set new timer
    const timer = setTimeout(() => {
      setDebouncedQuery(value);
    }, 300);

    // Store timer in ref for cleanup
    debounceTimerRef.current = timer;
  }, []);

  const handleVisaClick = useCallback(
    (visa: VisaEntry) => {
      // Navigate to cases page with visa_subclass filter
      navigate(`/cases?visa_subclass=${encodeURIComponent(visa.subclass)}`);
    },
    [navigate],
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div>
        <h2 className="font-heading text-lg font-semibold text-foreground">
          {t("taxonomy.visa_lookup", { defaultValue: "Visa Quick Lookup" })}
        </h2>
        <p className="mt-0.5 text-sm text-secondary-text">
          {t("taxonomy.visa_lookup_desc", {
            defaultValue: "Search by visa subclass code or name",
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
          placeholder={t("taxonomy.visa_search_placeholder", {
            defaultValue: "e.g. 866 or Protection",
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
          ) : visaResults.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-text">
              {t("taxonomy.no_results", {
                defaultValue: "No matching visa subclasses found",
              })}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visaResults.map((visa) => (
                <button
                  key={visa.subclass}
                  onClick={() => handleVisaClick(visa)}
                  className={cn(
                    "w-full px-4 py-3 text-left transition-colors",
                    "hover:bg-surface focus:bg-surface focus:outline-none",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-sm font-semibold text-accent">
                          {visa.subclass}
                        </span>
                        <span className="truncate text-sm font-medium text-foreground">
                          {visa.name}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-secondary-text">
                        {visa.family}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="rounded-full bg-accent-muted px-2 py-0.5 text-xs font-medium text-accent">
                        {visa.case_count.toLocaleString()}
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
