import { Fragment, memo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NatureOutcomeData } from "@/types/case";

interface NatureOutcomeHeatmapProps {
  data: NatureOutcomeData;
}

function NatureOutcomeHeatmapInner({ data }: NatureOutcomeHeatmapProps) {
  const { t } = useTranslation();
  const { natures, outcomes, matrix } = data;
  const [mode, setMode] = useState<"count" | "pct">("count");

  // Find global max for opacity scaling (used in count mode)
  let maxCount = 1;
  for (const nature of natures) {
    for (const outcome of outcomes) {
      const val = matrix[nature]?.[outcome] ?? 0;
      if (val > maxCount) maxCount = val;
    }
  }

  // Compute row totals for % mode
  const rowTotals: Record<string, number> = {};
  for (const nature of natures) {
    rowTotals[nature] = outcomes.reduce(
      (sum, outcome) => sum + (matrix[nature]?.[outcome] ?? 0),
      0,
    );
  }

  // Truncate long nature names
  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max - 1) + "\u2026" : s;

  return (
    <div className="overflow-x-auto">
      {/* Mode toggle */}
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setMode((m) => (m === "count" ? "pct" : "count"))}
          className="rounded border border-border px-2 py-0.5 text-xs text-muted-text hover:text-foreground"
        >
          {mode === "count"
            ? t("analytics.show_pct", { defaultValue: "% of row" })
            : t("analytics.show_count", { defaultValue: "Count" })}
        </button>
      </div>

      <div
        className="grid gap-px text-xs"
        style={{
          gridTemplateColumns: `160px repeat(${outcomes.length}, minmax(70px, 1fr))`,
        }}
      >
        {/* Header row */}
        <div className="p-1.5 font-medium text-muted-text" />
        {outcomes.map((outcome) => (
          <div
            key={outcome}
            className="p-1.5 text-center text-[10px] font-semibold text-muted-text"
            title={outcome}
          >
            {outcome}
          </div>
        ))}

        {/* Data rows */}
        {natures.map((nature) => (
          <Fragment key={nature}>
            <div
              className="truncate p-1.5 text-[11px] font-medium text-foreground"
              title={nature}
            >
              {truncate(nature, 25)}
            </div>
            {outcomes.map((outcome) => {
              const count = matrix[nature]?.[outcome] ?? 0;
              // Sqrt scaling for better mid-range visibility
              const intensity = Math.sqrt(count / maxCount);

              // Determine display value
              let displayValue: string;
              if (mode === "pct") {
                const rowTotal = rowTotals[nature] ?? 0;
                if (count === 0 || rowTotal === 0) {
                  displayValue = "\u2013";
                } else {
                  displayValue = `${((count / rowTotal) * 100).toFixed(1)}%`;
                }
              } else {
                displayValue = count > 0 ? count.toLocaleString() : "\u2013";
              }

              return (
                <div
                  key={`${nature}-${outcome}`}
                  className="flex items-center justify-center rounded-sm p-1.5 text-[10px]"
                  style={{
                    backgroundColor:
                      count === 0
                        ? "var(--color-surface)"
                        : `rgba(26, 82, 118, ${Math.max(intensity * 0.85, 0.1)})`,
                    color:
                      count === 0
                        ? "var(--color-text-muted)"
                        : intensity > 0.3
                          ? "#fff"
                          : "var(--color-text-secondary)",
                  }}
                  title={`${nature} \u2192 ${outcome}: ${count.toLocaleString()}`}
                >
                  {displayValue}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export const NatureOutcomeHeatmap = memo(NatureOutcomeHeatmapInner);
