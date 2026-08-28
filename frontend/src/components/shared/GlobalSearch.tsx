import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, X } from "lucide-react";
import { useSearchCases } from "@/hooks/use-cases";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
}

interface GlobalSearchDialogProps {
  onClose: () => void;
}

/** Below this, a query is a prefix of everything and worth no round trip. */
const MIN_SEARCH_CHARS = 2;

function GlobalSearchDialog({ onClose }: GlobalSearchDialogProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const debouncedQuery = useDebouncedValue(query, 250);
  // The Worker rejects queries shorter than 2 characters with HTTP 400
  // (workers/case-api/cloudflare.js:195). Passing "" trips useSearchCases'
  // existing `enabled: query.length > 0` gate, so no request is made at all.
  const searchQuery =
    debouncedQuery.trim().length >= MIN_SEARCH_CHARS
      ? debouncedQuery.trim()
      : "";
  const { data, isFetching } = useSearchCases(searchQuery, 8);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // True while the user has typed something the debounce has not caught up
  // to yet. Results on screen belong to `searchQuery`, not to `query` — this
  // stops a stale result set (or an Enter/click on it) surviving into a
  // different in-flight query while the debounce is still pending.
  const resultsAreStale = query.trim() !== searchQuery;
  const cases = resultsAreStale ? [] : (data?.cases ?? []);
  const hasResults = cases.length > 0;
  const isExpanded = hasResults && searchQuery.length > 0;

  const clampedActiveIdx = useMemo(() => {
    if (!hasResults) return 0;
    return Math.min(activeIdx, cases.length - 1);
  }, [activeIdx, hasResults, cases.length]);

  return (
    <>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--color-overlay)]/65 backdrop-blur-sm" />
      <Dialog.Content className="fixed inset-x-0 top-[15vh] z-50 mx-auto w-full max-w-lg px-4">
        <Dialog.Title className="sr-only">
          {t("common.search_cases", { defaultValue: "Search cases" })}
        </Dialog.Title>
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Search className="h-4 w-4 text-muted-text" />
            <input
              ref={inputRef}
              data-global-search
              type="text"
              role="combobox"
              aria-expanded={isExpanded}
              aria-haspopup="listbox"
              aria-controls="global-search-listbox"
              aria-autocomplete="list"
              aria-activedescendant={
                hasResults && cases[clampedActiveIdx]
                  ? `global-search-option-${cases[clampedActiveIdx].case_id}`
                  : undefined
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIdx(0); // reset keyboard nav on each keystroke
              }}
              onKeyDown={(e) => {
                if (!hasResults) return;
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveIdx((prev) => Math.min(prev + 1, cases.length - 1));
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveIdx((prev) => Math.max(prev - 1, 0));
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  const selectedCase = cases[clampedActiveIdx];
                  if (!selectedCase) return;
                  navigate(`/cases/${selectedCase.case_id}`);
                  onClose();
                }
              }}
              placeholder={t("common.search_cases_placeholder")}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-text focus:outline-none"
            />
            <button
              onClick={onClose}
              className="text-muted-text hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Results */}
          {cases.length > 0 && (
            <ul
              role="listbox"
              id="global-search-listbox"
              className="max-h-80 overflow-y-auto p-2"
            >
              {cases.map((c, idx) => (
                <li key={c.case_id}>
                  <button
                    role="option"
                    id={`global-search-option-${c.case_id}`}
                    aria-selected={idx === clampedActiveIdx}
                    onClick={() => {
                      navigate(`/cases/${c.case_id}`);
                      onClose();
                    }}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      idx === clampedActiveIdx
                        ? "bg-accent/10 ring-1 ring-accent/30"
                        : "hover:bg-surface",
                    )}
                    aria-current={idx === clampedActiveIdx ? "true" : "false"}
                  >
                    <span
                      className="font-medium text-foreground line-clamp-1"
                      title={c.title || c.citation}
                    >
                      {c.title || c.citation}
                    </span>
                    <span className="text-xs text-muted-text">
                      {c.court_code} &middot; {c.date}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {searchQuery.length > 0 && !isFetching && cases.length === 0 && (
            <div className="flex flex-col items-center gap-1 p-6 text-center">
              <p className="text-sm font-medium text-foreground">
                {t("common.no_results")}
              </p>
              <p className="text-xs text-muted-text">
                {t("tooltips.navigate_up_down")}
              </p>
            </div>
          )}

          {/* Shortcuts hint */}
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted-text">
            <span>
              {hasResults
                ? t("tooltips.navigate_up_down")
                : t("tooltips.type_to_search", { defaultValue: "Type to search" })}
            </span>
            <span>
              <kbd className="rounded bg-surface px-1 py-0.5 font-mono">
                esc
              </kbd>{" "}
              {t("tooltips.escape_to_close")}
            </span>
          </div>
        </div>
      </Dialog.Content>
    </>
  );
}

export function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <Dialog.Portal>
        <GlobalSearchDialog onClose={onClose} />
      </Dialog.Portal>
    </Dialog.Root>
  );
}
