import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCourtColor } from "@/tokens/tokens";
import type { CourtGroup } from "@/lib/lineage-transforms";

const CURRENT_YEAR = new Date().getFullYear();

const GROUP_OPTIONS: { value: CourtGroup; labelKey: string }[] = [
  { value: "all", labelKey: "lineage.filter_all" },
  { value: "lower-court", labelKey: "lineage.filter_lower_court" },
  { value: "tribunal", labelKey: "lineage.filter_tribunal" },
  { value: "independent", labelKey: "lineage.filter_independent" },
];

const YEAR_PRESETS = [
  { labelKey: "lineage.preset_all_time", from: 2000, to: CURRENT_YEAR },
  {
    labelKey: "lineage.preset_last_5y",
    from: CURRENT_YEAR - 5,
    to: CURRENT_YEAR,
  },
  {
    labelKey: "lineage.preset_last_10y",
    from: CURRENT_YEAR - 10,
    to: CURRENT_YEAR,
  },
  { labelKey: "lineage.preset_2020_on", from: 2020, to: CURRENT_YEAR },
];

const ALL_COURT_CODES = [
  "MRTA",
  "RRTA",
  "AATA",
  "ARTA",
  "FMCA",
  "FCCA",
  "FedCFamC2G",
  "FCA",
  "HCA",
];

interface LineageFiltersProps {
  groupFilter: CourtGroup;
  yearFrom: number;
  yearTo: number;
  hiddenCourts: Set<string>;
  onGroupChange: (group: CourtGroup) => void;
  onYearRangeChange: (from: number, to: number) => void;
  onToggleCourt: (court: string) => void;
  onResetCourts: () => void;
}

export function LineageFilters({
  groupFilter,
  yearFrom,
  yearTo,
  hiddenCourts,
  onGroupChange,
  onYearRangeChange,
  onToggleCourt,
  onResetCourts,
}: LineageFiltersProps) {
  const { t } = useTranslation();

  const isPresetActive = (from: number, to: number) =>
    yearFrom === from && yearTo === to;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      {/* Row 1: Court group toggle */}
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-text">
          {t("lineage.filter_group")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {GROUP_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onGroupChange(opt.value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                groupFilter === opt.value
                  ? "bg-accent text-white"
                  : "bg-surface text-muted-text hover:bg-surface-hover",
              )}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: Year range presets */}
      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-text">
          {t("lineage.year_range")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {YEAR_PRESETS.map((preset) => (
            <button
              key={preset.labelKey}
              onClick={() => onYearRangeChange(preset.from, preset.to)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                isPresetActive(preset.from, preset.to)
                  ? "bg-accent text-white"
                  : "bg-surface text-muted-text hover:bg-surface-hover",
              )}
            >
              {t(preset.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Row 3: Court visibility pills */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-text">
            {t("lineage.filter_court_visibility")}
          </p>
          {hiddenCourts.size > 0 && (
            <button
              onClick={onResetCourts}
              className="flex items-center gap-1 text-[11px] text-accent hover:underline"
            >
              <RotateCcw className="h-3 w-3" />
              {t("lineage.filter_show_all")}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ALL_COURT_CODES.map((code) => {
            const isHidden = hiddenCourts.has(code);
            return (
              <button
                key={code}
                onClick={() => onToggleCourt(code)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-mono font-medium transition-all",
                  isHidden
                    ? "opacity-30 line-through bg-surface text-muted-text"
                    : "bg-surface text-foreground hover:bg-surface-hover",
                )}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: getCourtColor(code) ?? "#8b8680",
                  }}
                />
                {code}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
