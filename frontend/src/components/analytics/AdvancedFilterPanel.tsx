import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "analytics-filter-presets";

interface FilterPreset {
  name: string;
  natures: string[];
  subclasses: string[];
  outcomes: string[];
}

interface AdvancedFilterPanelProps {
  caseNatures: string[];
  visaSubclasses: string[];
  outcomeTypes: string[];
  selectedNatures: string[];
  selectedSubclasses: string[];
  selectedOutcomes: string[];
  onNaturesChange: (natures: string[]) => void;
  onSubclassesChange: (subclasses: string[]) => void;
  onOutcomesChange: (outcomes: string[]) => void;
}

function loadPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePresets(presets: FilterPreset[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Silently ignore storage errors (private mode, quota exceeded)
  }
}

function toggleItem(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
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
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<FilterPreset[]>(loadPresets);

  const activeCount =
    selectedNatures.length +
    selectedSubclasses.length +
    selectedOutcomes.length;

  const handleClearAll = () => {
    onNaturesChange([]);
    onSubclassesChange([]);
    onOutcomesChange([]);
  };

  const handleSavePreset = () => {
    if (!presetName.trim()) return;
    const newPreset: FilterPreset = {
      name: presetName.trim(),
      natures: selectedNatures,
      subclasses: selectedSubclasses,
      outcomes: selectedOutcomes,
    };
    const updated = [
      ...presets.filter((p) => p.name !== newPreset.name),
      newPreset,
    ];
    savePresets(updated);
    setPresets(updated);
    setPresetName("");
  };

  const handleLoadPreset = (preset: FilterPreset) => {
    onNaturesChange(preset.natures);
    onSubclassesChange(preset.subclasses);
    onOutcomesChange(preset.outcomes);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-3">
      {/* Header with count + clear */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {t("analytics.advanced_filters", {
              defaultValue: "Advanced Filters",
            })}
          </h3>
          {activeCount > 0 && (
            <span
              data-testid="active-filter-count"
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-white"
            >
              {activeCount}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={handleClearAll}
            aria-label={t("filters.clear_filters", {
              defaultValue: "Clear filters",
            })}
            className="inline-flex items-center gap-1 text-xs text-muted-text hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            {t("filters.clear_filters", { defaultValue: "Clear filters" })}
          </button>
        )}
      </div>

      {/* Case Nature */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-text">
          {t("analytics.case_nature", { defaultValue: "Case Nature" })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {caseNatures.map((nature) => {
            const active = selectedNatures.includes(nature);
            return (
              <button
                key={nature}
                type="button"
                onClick={() =>
                  onNaturesChange(toggleItem(selectedNatures, nature))
                }
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-accent text-white"
                    : "bg-surface text-secondary-text hover:bg-accent-muted hover:text-accent",
                )}
              >
                {nature}
              </button>
            );
          })}
        </div>
      </div>

      {/* Visa Subclass */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-text">
          {t("analytics.visa_subclass", { defaultValue: "Visa Subclass" })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {visaSubclasses.map((subclass) => {
            const active = selectedSubclasses.includes(subclass);
            return (
              <button
                key={subclass}
                type="button"
                onClick={() =>
                  onSubclassesChange(toggleItem(selectedSubclasses, subclass))
                }
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-accent text-white"
                    : "bg-surface text-secondary-text hover:bg-accent-muted hover:text-accent",
                )}
              >
                {subclass}
              </button>
            );
          })}
        </div>
      </div>

      {/* Outcome Type */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-text">
          {t("filters.outcome", { defaultValue: "Outcome" })}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {outcomeTypes.map((outcome) => {
            const active = selectedOutcomes.includes(outcome);
            return (
              <button
                key={outcome}
                type="button"
                onClick={() =>
                  onOutcomesChange(toggleItem(selectedOutcomes, outcome))
                }
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-accent text-white"
                    : "bg-surface text-secondary-text hover:bg-accent-muted hover:text-accent",
                )}
              >
                {outcome}
              </button>
            );
          })}
        </div>
      </div>

      {/* Preset Save/Load */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        {presets.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => handleLoadPreset(preset)}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-secondary-text hover:bg-surface hover:text-foreground"
          >
            <Bookmark className="h-3 w-3" />
            {preset.name}
          </button>
        ))}
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder={t("analytics.preset_name_placeholder", {
              defaultValue: "Preset name...",
            })}
            className="w-28 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-text"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSavePreset();
            }}
          />
          <button
            type="button"
            onClick={handleSavePreset}
            aria-label={t("common.save", { defaultValue: "Save" })}
            disabled={!presetName.trim()}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-secondary-text hover:bg-surface hover:text-foreground disabled:opacity-40"
          >
            <Save className="h-3 w-3" />
            {t("common.save", { defaultValue: "Save" })}
          </button>
        </div>
      </div>
    </div>
  );
}
