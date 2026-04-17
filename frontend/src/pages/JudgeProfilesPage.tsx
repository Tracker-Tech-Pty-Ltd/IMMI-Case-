import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { List, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnalyticsFilters } from "@/components/shared/AnalyticsFilters";
import { JudgeLeaderboard } from "@/components/judges/JudgeLeaderboard";
import { JudgeCard } from "@/components/judges/JudgeCard";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { useJudgeLeaderboard } from "@/hooks/use-judges";

const CURRENT_YEAR = new Date().getFullYear();
const MAX_COMPARE = 4;
const SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_MIN_CASES = 20;

export function JudgeProfilesPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [court, setCourt] = useState("");
  const [yearFrom, setYearFrom] = useState(2000);
  const [yearTo, setYearTo] = useState(CURRENT_YEAR);
  const [sortBy, setSortBy] = useState<"cases" | "approval_rate" | "name">(
    "cases",
  );
  const [nameFilter, setNameFilter] = useState("");
  const [debouncedNameFilter, setDebouncedNameFilter] = useState("");
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<"table" | "cards">(() => {
    try {
      const stored = localStorage.getItem("judges-view-mode");
      return stored === "cards" ? "cards" : "table";
    } catch {
      return "table";
    }
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedNameFilter(nameFilter.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [nameFilter]);

  const params = useMemo(
    () => ({
      court: court || undefined,
      yearFrom,
      yearTo,
      sort_by: sortBy,
      limit: 200,
      name_q: debouncedNameFilter || undefined,
      min_cases: debouncedNameFilter ? 1 : DEFAULT_MIN_CASES,
    }),
    [court, yearFrom, yearTo, sortBy, debouncedNameFilter],
  );

  const { data, isLoading, isError, error, refetch } =
    useJudgeLeaderboard(params);

  const judges = useMemo(() => data?.judges ?? [], [data?.judges]);
  const totalMatchedJudges = data?.total_judges ?? 0;
  const filteredJudges = useMemo(() => {
    const q = nameFilter.trim().toLowerCase();
    if (!q) return judges;
    return judges.filter((j) => {
      const display = (j.display_name ?? j.name).toLowerCase();
      return display.includes(q) || j.name.toLowerCase().includes(q);
    });
  }, [judges, nameFilter]);
  const hasActiveFilters = Boolean(
    court || nameFilter.trim() || yearFrom !== 2000 || yearTo !== CURRENT_YEAR,
  );

  const toggleCompare = (name: string) => {
    setSelectedNames((prev) => {
      const exists = prev.includes(name);
      if (exists) return prev.filter((item) => item !== name);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, name];
    });
  };

  const openCompare = useCallback(() => {
    if (selectedNames.length < 2) return;
    const names = selectedNames
      .map((name) => encodeURIComponent(name))
      .join(",");
    navigate(`/judge-profiles/compare?names=${names}`);
  }, [selectedNames, navigate]);

  const openJudge = (name: string) => {
    navigate(`/judge-profiles/${encodeURIComponent(name)}`);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA"
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      }

      if (e.key.toLowerCase() === "c" && selectedNames.length >= 2) {
        e.preventDefault();
        openCompare();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedNames.length, openCompare]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("judges.title")}
        description={t("judges.subtitle")}
        actions={
          <>
            <button
              type="button"
              aria-label={t("tooltips.table_view")}
              aria-pressed={viewMode === "table"}
              onClick={() => {
                setViewMode("table");
                try {
                  localStorage.setItem("judges-view-mode", "table");
                } catch {
                  /* ignore */
                }
              }}
              className={cn(
                "rounded-md p-1.5",
                viewMode === "table"
                  ? "bg-accent-muted text-accent"
                  : "text-muted-text hover:text-foreground",
              )}
              title={t("judges.table_view_label")}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={t("tooltips.chart_view")}
              aria-pressed={viewMode === "cards"}
              onClick={() => {
                setViewMode("cards");
                try {
                  localStorage.setItem("judges-view-mode", "cards");
                } catch {
                  /* ignore */
                }
              }}
              className={cn(
                "rounded-md p-1.5",
                viewMode === "cards"
                  ? "bg-accent-muted text-accent"
                  : "text-muted-text hover:text-foreground",
              )}
              title={t("judges.card_view_label")}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </>
        }
      />

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <AnalyticsFilters
            court={court}
            yearFrom={yearFrom}
            yearTo={yearTo}
            onCourtChange={setCourt}
            onYearRangeChange={(from, to) => {
              setYearFrom(from);
              setYearTo(to);
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={nameInputRef}
              type="text"
              placeholder={t("judges.search_placeholder")}
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              aria-label={t("judges.search_placeholder")}
              aria-keyshortcuts="/"
              title={t("judges.search_shortcut_hint")}
              className="min-w-[140px] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-text"
            />
            <div className="flex shrink-0 items-center gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-text">
                {t("judges.sort_label")}
              </label>
              <select
                value={sortBy}
                onChange={(event) =>
                  setSortBy(
                    event.target.value as "cases" | "approval_rate" | "name",
                  )
                }
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                aria-label={t("judges.sort_label")}
              >
                <option value="cases">{t("judges.sort_cases")}</option>
                <option value="approval_rate">{t("judges.sort_approval")}</option>
                <option value="name">{t("judges.sort_name")}</option>
              </select>
            </div>
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-muted-text">
            {isLoading
              ? t("common.loading_ellipsis")
              : t("judges.judges_found", {
                  count: totalMatchedJudges || filteredJudges.length,
                })}
          </p>
          <div className="flex items-center gap-2">
            {selectedNames.length >= MAX_COMPARE && (
              <span className="text-xs text-warning">
                {t("judges.max_selected", { max: MAX_COMPARE })}
              </span>
            )}
            <button
              type="button"
              onClick={openCompare}
              disabled={selectedNames.length < 2}
              aria-keyshortcuts="C"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("judges.compare_selected", {
                count: selectedNames.length,
              })}
            </button>
          </div>
        </div>

        {!isLoading && filteredJudges.length > 0 && viewMode === "table" && (
          <div className="mb-3 rounded-md border border-border-light bg-surface px-3 py-2 text-xs text-muted-text">
            {t("judges.keyboard_shortcuts")}
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-text">
            {t("judges.loading_judges")}
          </p>
        ) : isError ? (
          <ApiErrorState
            title={t("errors.failed_to_load", { name: "judges" })}
            message={
              error instanceof Error
                ? error.message
                : t("errors.api_request_failed", { name: "Judge" })
            }
            onRetry={() => {
              void refetch();
            }}
          />
        ) : filteredJudges.length === 0 ? (
          <EmptyState
            title={t("judges.empty_state")}
            description={t("empty_states.no_judges_description", {
              defaultValue: "No judges match your current filters.",
            })}
            action={
              hasActiveFilters ? (
                <button
                  type="button"
                  onClick={() => {
                    setCourt("");
                    setYearFrom(2000);
                    setYearTo(CURRENT_YEAR);
                    setNameFilter("");
                  }}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-light"
                >
                  {t("filters.clear_filters")}
                </button>
              ) : undefined
            }
          />
        ) : viewMode === "table" ? (
          <JudgeLeaderboard
            data={filteredJudges}
            selectedNames={selectedNames}
            onToggleCompare={toggleCompare}
            onOpen={openJudge}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredJudges.map((judge) => (
              <JudgeCard
                key={judge.name}
                judge={judge}
                isSelected={selectedNames.includes(judge.name)}
                onToggleCompare={toggleCompare}
                onOpen={openJudge}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
