import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { List, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnalyticsFilters } from "@/components/shared/AnalyticsFilters";
import { JudgeLeaderboard } from "@/components/judges/JudgeLeaderboard";
import { JudgeCard } from "@/components/judges/JudgeCard";
import { ApiErrorState } from "@/components/shared/ApiErrorState";
import { useJudgeLeaderboard } from "@/hooks/use-judges";

const CURRENT_YEAR = new Date().getFullYear();
const MAX_COMPARE = 4;

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
  const [selectedNames, setSelectedNames] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"table" | "cards">(() => {
    try {
      const stored = localStorage.getItem("judges-view-mode");
      return stored === "cards" ? "cards" : "table";
    } catch {
      return "table";
    }
  });

  const params = useMemo(
    () => ({
      court: court || undefined,
      yearFrom,
      yearTo,
      sort_by: sortBy,
      limit: 100,
    }),
    [court, yearFrom, yearTo, sortBy],
  );

  const { data, isLoading, isError, error, refetch } =
    useJudgeLeaderboard(params);

  const judges = data?.judges ?? [];
  const filteredJudges = useMemo(() => {
    const q = nameFilter.trim().toLowerCase();
    return q ? judges.filter((j) => j.name.toLowerCase().includes(q)) : judges;
  }, [judges, nameFilter]);

  // Clear stale selections when filters change the visible judge set
  useEffect(() => {
    if (!judges.length) return;
    const visibleNames = new Set(judges.map((j) => j.name));
    setSelectedNames((prev) => {
      const pruned = prev.filter((n) => visibleNames.has(n));
      return pruned.length === prev.length ? prev : pruned;
    });
  }, [judges]);

  const toggleCompare = (name: string) => {
    setSelectedNames((prev) => {
      const exists = prev.includes(name);
      if (exists) return prev.filter((item) => item !== name);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, name];
    });
  };

  const openCompare = () => {
    if (selectedNames.length < 2) return;
    const names = selectedNames
      .map((name) => encodeURIComponent(name))
      .join(",");
    navigate(`/judge-profiles/compare?names=${names}`);
  };

  const openJudge = (name: string) => {
    navigate(`/judge-profiles/${encodeURIComponent(name)}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            {t("judges.title")}
          </h1>
          <p className="text-sm text-muted-text">{t("judges.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

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

          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder={t("judges.search_placeholder")}
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-text"
            />
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
            >
              <option value="cases">{t("judges.sort_cases")}</option>
              <option value="approval_rate">{t("judges.sort_approval")}</option>
              <option value="name">{t("judges.sort_name")}</option>
            </select>
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-secondary-text">
            {t("judges.judges_found", { count: filteredJudges.length })}
          </p>
          <div className="flex items-center gap-2">
            {selectedNames.length >= MAX_COMPARE && (
              <span className="text-xs text-semantic-warning">
                {t("judges.max_selected", { max: MAX_COMPARE })}
              </span>
            )}
            <button
              type="button"
              onClick={openCompare}
              disabled={selectedNames.length < 2}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("judges.compare_selected", { count: selectedNames.length })}
            </button>
          </div>
        </div>

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
        ) : viewMode === "table" ? (
          <JudgeLeaderboard
            data={filteredJudges}
            selectedNames={selectedNames}
            onToggleCompare={toggleCompare}
            onOpen={openJudge}
          />
        ) : filteredJudges.length === 0 ? (
          <p className="text-sm text-muted-text">{t("judges.empty_state")}</p>
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
