import { useTranslation } from "react-i18next";
import {
  Search,
  ChevronDown,
  ChevronUp,
  Bookmark,
} from "lucide-react";
import type { CaseFilters } from "@/types/case";
import type { FilterOptions } from "@/types/case";

export interface CasesFiltersProps {
  filters: CaseFilters;
  filterOpts: FilterOptions | undefined;
  showAdvanced: boolean;
  onUpdateFilter: (key: string, value: string) => void;
  onToggleAdvanced: () => void;
  onSaveSearch: () => void;
  keywordInputRef: React.RefObject<HTMLInputElement | null>;
}

export function CasesFilters({
  filters,
  filterOpts,
  showAdvanced,
  onUpdateFilter,
  onToggleAdvanced,
  onSaveSearch,
  keywordInputRef,
}: CasesFiltersProps) {
  const { t } = useTranslation();

  const sortLabel =
    filters.sort_by === "date"
      ? t("filters.date") || "Date"
      : filters.sort_by === "year"
        ? t("units.year")
        : filters.sort_by === "title"
          ? t("cases.title")
          : t("filters.court");

  return (
    <>
      {/* Primary Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filters.court ?? ""}
          onChange={(e) => onUpdateFilter("court", e.target.value)}
          className="min-w-[120px] flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground sm:flex-none"
          aria-label={t("filters.court")}
        >
          <option value="">{t("filters.all_courts")}</option>
          {filterOpts?.courts?.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={filters.year?.toString() ?? ""}
          onChange={(e) => onUpdateFilter("year", e.target.value)}
          className="min-w-[120px] flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground sm:flex-none"
          aria-label={t("units.year")}
        >
          <option value="">{t("filters.year_from")}</option>
          {filterOpts?.years?.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select
          value={filters.nature ?? ""}
          onChange={(e) => onUpdateFilter("nature", e.target.value)}
          className="min-w-[120px] flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground sm:flex-none"
          aria-label={t("cases.nature")}
        >
          <option value="">{t("filters.all_natures")}</option>
          {filterOpts?.natures?.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <div className="relative min-w-[160px] flex-1 sm:flex-none">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-text" />
          <input
            key={filters.keyword ?? ""}
            ref={keywordInputRef}
            type="text"
            placeholder={t("common.search_placeholder")}
            defaultValue={filters.keyword ?? ""}
            onBlur={(e) => onUpdateFilter("keyword", e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onUpdateFilter("keyword", e.currentTarget.value.trim());
              }
              if (e.key === "Escape") {
                e.currentTarget.value = filters.keyword ?? "";
                (e.target as HTMLInputElement).blur();
              }
            }}
            className="w-full rounded-md border border-border bg-card py-2 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-text"
            aria-label={t("common.search_cases")}
            aria-keyshortcuts="/"
            title={t("cases.search_shortcut_hint")}
          />
        </div>
        <button
          type="button"
          onClick={onToggleAdvanced}
          className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm text-muted-text hover:text-foreground"
          aria-expanded={showAdvanced}
          aria-controls="cases-advanced-filters"
        >
          {t("filters.filter")}
          {showAdvanced ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={onSaveSearch}
          className="flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm text-muted-text hover:text-foreground"
          title={t("saved_searches.save_description")}
        >
          <Bookmark className="h-3.5 w-3.5" />
          {t("saved_searches.save_button")}
        </button>

        {/* Sort */}
        <div className="mt-1 flex w-full items-center gap-1.5 sm:ml-auto sm:mt-0 sm:w-auto">
          <span className="text-xs text-muted-text">
            {t("judges.sort_label")}:
          </span>
          <select
            value={filters.sort_by ?? "date"}
            onChange={(e) => onUpdateFilter("sort_by", e.target.value)}
            className="rounded-md border border-border bg-card px-2 py-2 text-xs text-foreground"
            aria-label={t("judges.sort_label")}
          >
            <option value="date">{t("cases.date")}</option>
            <option value="year">{t("units.year")}</option>
            <option value="title">{t("cases.title")}</option>
            <option value="court">{t("filters.court")}</option>
          </select>
          <button
            type="button"
            onClick={() =>
              onUpdateFilter(
                "sort_dir",
                filters.sort_dir === "asc" ? "desc" : "asc",
              )
            }
            className="rounded-md border border-border p-2 text-muted-text hover:text-foreground"
            title={`${t("cases.sorted")} ${sortLabel} ${filters.sort_dir === "asc" ? t("cases.ascending") : t("cases.descending")}`}
            aria-label={`${t("cases.sorted")} ${sortLabel} ${filters.sort_dir === "asc" ? t("cases.ascending") : t("cases.descending")}`}
          >
            {filters.sort_dir === "asc" ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div
          id="cases-advanced-filters"
          className="flex flex-wrap gap-2 rounded-md border border-border-light bg-surface p-3"
        >
          <select
            value={filters.visa_type ?? ""}
            onChange={(e) => onUpdateFilter("visa_type", e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            aria-label={t("cases.visa_subclass")}
          >
            <option value="">{t("filters.all_visa_types")}</option>
            {filterOpts?.visa_types?.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={filters.source ?? ""}
            onChange={(e) => onUpdateFilter("source", e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            aria-label={t("cases.source", { defaultValue: "Source" })}
          >
            <option value="">{t("filters.all_sources")}</option>
            {filterOpts?.sources?.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={filters.tag ?? ""}
            onChange={(e) => onUpdateFilter("tag", e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            aria-label={t("common.tags", { defaultValue: "Tags" })}
          >
            <option value="">{t("filters.all_tags")}</option>
            {filterOpts?.tags?.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
