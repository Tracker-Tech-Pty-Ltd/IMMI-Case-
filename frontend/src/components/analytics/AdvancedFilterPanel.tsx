import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalyticsFilterOption } from "@/types/case";

const MAX_VISIBLE_OPTIONS = 8;

interface AdvancedFilterPanelProps {
  caseNatures: AnalyticsFilterOption[];
  visaSubclasses: AnalyticsFilterOption[];
  outcomeTypes: AnalyticsFilterOption[];
  selectedNatures: string[];
  selectedSubclasses: string[];
  selectedOutcomes: string[];
  onNaturesChange: (natures: string[]) => void;
  onSubclassesChange: (subclasses: string[]) => void;
  onOutcomesChange: (outcomes: string[]) => void;
}

interface FilterListProps {
  title: string;
  options: AnalyticsFilterOption[];
  selectedValues: string[];
  onToggle: (value: string) => void;
  searchPlaceholder: string;
  emptyMessage: string;
  noMatchMessage: string;
}

function toggleItem(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
}

function removeItem(list: string[], item: string): string[] {
  return list.filter((i) => i !== item);
}

function normaliseText(value: string): string {
  return value.trim().toLowerCase();
}

function FilterList({
  title,
  options,
  selectedValues,
  onToggle,
  searchPlaceholder,
  emptyMessage,
  noMatchMessage,
}: FilterListProps) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const visibleOptions = useMemo(() => {
    const q = normaliseText(query);
    const selected = new Set(selectedValues);

    const filtered = options
      .filter((option) => {
        if (!q) return true;
        const haystack = [
          option.value,
          option.label ?? "",
          option.family ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice()
      .sort((a, b) => {
        const aSelected = selected.has(a.value) ? 1 : 0;
        const bSelected = selected.has(b.value) ? 1 : 0;
        if (aSelected !== bSelected) return bSelected - aSelected;
        if (a.count !== b.count) return b.count - a.count;
        return (a.label ?? a.value).localeCompare(b.label ?? b.value);
      });

    return {
      filtered,
      list: showAll ? filtered : filtered.slice(0, MAX_VISIBLE_OPTIONS),
    };
  }, [options, query, selectedValues, showAll]);

  return (
    <section className="rounded-md border border-border bg-background p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-text">
          {title}
        </p>
        <span className="text-[11px] text-muted-text">
          {selectedValues.length}/{options.length}
        </span>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShowAll(false);
        }}
        placeholder={searchPlaceholder}
        className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground placeholder:text-muted-text"
      />

      <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
        {options.length === 0 ? (
          <p className="rounded-md bg-surface px-2 py-1.5 text-xs text-muted-text">
            {emptyMessage}
          </p>
        ) : visibleOptions.filtered.length === 0 ? (
          <p className="rounded-md bg-surface px-2 py-1.5 text-xs text-muted-text">
            {noMatchMessage}
          </p>
        ) : (
          visibleOptions.list.map((option) => {
            const active = selectedValues.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onToggle(option.value)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                  active
                    ? "border-accent bg-accent-muted text-accent"
                    : "border-border bg-card text-muted-text hover:border-border-light hover:text-foreground",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate">{option.label ?? option.value}</p>
                  {option.family ? (
                    <p className="truncate text-[10px] text-muted-text">
                      {option.family}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted-text">
                  {option.count}
                </span>
              </button>
            );
          })
        )}
      </div>

      {visibleOptions.filtered.length > MAX_VISIBLE_OPTIONS && (
        <button
          type="button"
          onClick={() => setShowAll((prev) => !prev)}
          className="mt-2 text-xs font-medium text-accent hover:underline"
        >
          {showAll ? "Show less" : `Show ${visibleOptions.filtered.length - MAX_VISIBLE_OPTIONS} more`}
        </button>
      )}
    </section>
  );
}

export function AdvancedFilterPanel({
  caseNatures,
  visaSubclasses,
  outcomeTypes,
  selectedNatures,
  selectedSubclasses,
  selectedOutcomes,
  onNaturesChange,
  onSubclassesChange,
  onOutcomesChange,
}: AdvancedFilterPanelProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const activeCount =
    selectedNatures.length +
    selectedSubclasses.length +
    selectedOutcomes.length;

  const totalOptionCount =
    caseNatures.length + visaSubclasses.length + outcomeTypes.length;

  const selectedChips = useMemo(
    () => [
      ...selectedNatures.map((value) => ({
        key: `nature:${value}`,
        label: `${t("analytics.case_nature", { defaultValue: "Case Nature" })}: ${value}`,
        onRemove: () => onNaturesChange(removeItem(selectedNatures, value)),
      })),
      ...selectedSubclasses.map((value) => ({
        key: `subclass:${value}`,
        label: `${t("analytics.visa_subclass", { defaultValue: "Visa Subclass" })}: ${value}`,
        onRemove: () => onSubclassesChange(removeItem(selectedSubclasses, value)),
      })),
      ...selectedOutcomes.map((value) => ({
        key: `outcome:${value}`,
        label: `${t("filters.outcome", { defaultValue: "Outcome" })}: ${value}`,
        onRemove: () => onOutcomesChange(removeItem(selectedOutcomes, value)),
      })),
    ],
    [
      onNaturesChange,
      onOutcomesChange,
      onSubclassesChange,
      selectedNatures,
      selectedOutcomes,
      selectedSubclasses,
      t,
    ],
  );

  const handleClearAll = () => {
    onNaturesChange([]);
    onSubclassesChange([]);
    onOutcomesChange([]);
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left"
      >
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-foreground">
            {t("analytics.advanced_filters", { defaultValue: "Advanced Filters" })}
          </p>
          <p className="text-xs text-muted-text">
            {t("analytics.advanced_filters_hint", {
              defaultValue:
                "Only options with data in the current scope are shown.",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <span
              data-testid="active-filter-count"
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-white"
            >
              {activeCount}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-text" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-text" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="space-y-3 border-t border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-text">
              {t("analytics.available_options", {
                defaultValue: "Available options",
              })}
              : {totalOptionCount.toLocaleString()}
            </p>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-text hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                {t("filters.clear_filters", { defaultValue: "Clear filters" })}
              </button>
            )}
          </div>

          {selectedChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.onRemove}
                  className="rounded-full border border-border-light bg-surface px-2 py-1 text-xs text-foreground hover:border-border"
                >
                  {chip.label} x
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-3 xl:grid-cols-3">
            <FilterList
              title={t("analytics.case_nature", { defaultValue: "Case Nature" })}
              options={caseNatures}
              selectedValues={selectedNatures}
              onToggle={(value) =>
                onNaturesChange(toggleItem(selectedNatures, value))
              }
              searchPlaceholder={t("common.search", { defaultValue: "Search" })}
              emptyMessage={t("analytics.no_options_available", {
                defaultValue: "No options available for this scope.",
              })}
              noMatchMessage={t("analytics.no_matching_option", {
                defaultValue: "No matching options.",
              })}
            />

            <FilterList
              title={t("analytics.visa_subclass", { defaultValue: "Visa Subclass" })}
              options={visaSubclasses}
              selectedValues={selectedSubclasses}
              onToggle={(value) =>
                onSubclassesChange(toggleItem(selectedSubclasses, value))
              }
              searchPlaceholder={t("common.search", { defaultValue: "Search" })}
              emptyMessage={t("analytics.no_options_available", {
                defaultValue: "No options available for this scope.",
              })}
              noMatchMessage={t("analytics.no_matching_option", {
                defaultValue: "No matching options.",
              })}
            />

            <FilterList
              title={t("filters.outcome", { defaultValue: "Outcome" })}
              options={outcomeTypes}
              selectedValues={selectedOutcomes}
              onToggle={(value) =>
                onOutcomesChange(toggleItem(selectedOutcomes, value))
              }
              searchPlaceholder={t("common.search", { defaultValue: "Search" })}
              emptyMessage={t("analytics.no_options_available", {
                defaultValue: "No options available for this scope.",
              })}
              noMatchMessage={t("analytics.no_matching_option", {
                defaultValue: "No matching options.",
              })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
