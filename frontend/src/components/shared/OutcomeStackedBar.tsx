import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

// Outcome colours come from the token layer (src/tokens/tokens.json →
// color.outcome / color.dark.outcome) so they follow the active theme.
const OUTCOME_SEGMENT_COLORS: Record<string, string> = {
  Affirmed: "var(--color-outcome-affirmed)",
  Dismissed: "var(--color-outcome-dismissed)",
  Refused: "var(--color-outcome-refused)",
  Withdrawn: "var(--color-outcome-withdrawn)",
  Remitted: "var(--color-outcome-remitted)",
  "Set Aside": "var(--color-outcome-set-aside)",
  Allowed: "var(--color-outcome-allowed)",
  Granted: "var(--color-outcome-granted)",
  Other: "var(--color-outcome-other)",
};

const FALLBACK_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-7)",
  "var(--color-chart-2)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
];

function getSegmentColor(outcome: string, index: number): string {
  const mapped = OUTCOME_SEGMENT_COLORS[outcome];
  if (mapped) return mapped;
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

interface OutcomeStackedBarProps {
  data: Record<string, number>;
  height?: number;
}

interface Segment {
  outcome: string;
  count: number;
  pct: number;
  color: string;
}

function OutcomeStackedBarInner({ data, height = 28 }: OutcomeStackedBarProps) {
  const { t } = useTranslation();

  const total = useMemo(
    () => Object.values(data).reduce((s, v) => s + v, 0),
    [data],
  );

  const segments = useMemo<Segment[]>(() => {
    if (total === 0) return [];
    return Object.entries(data)
      .filter(([, count]) => count > 0)
      .toSorted(([, a], [, b]) => b - a)
      .map(([outcome, count], idx) => ({
        outcome,
        count,
        pct: (count / total) * 100,
        color: getSegmentColor(outcome, idx),
      }));
  }, [data, total]);

  const ariaLabel = t("analytics.outcome_distribution_aria", {
    summary: segments.map((s) => `${s.outcome}: ${s.pct.toFixed(0)}%`).join(", "),
    defaultValue: `Outcome distribution: ${segments.map((s) => `${s.outcome} ${s.pct.toFixed(0)}%`).join(", ")}`,
  });

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      data-testid="outcome-stacked-bar"
      className="space-y-2"
    >
      {/* Stacked bar */}
      {total > 0 ? (
        <div
          className="flex overflow-hidden rounded-md"
          style={{ height: `${height}px` }}
        >
          {segments.map((seg) => (
            <div
              key={seg.outcome}
              title={`${seg.outcome}: ${seg.count.toLocaleString()} (${seg.pct.toFixed(1)}%)`}
              style={{ width: `${seg.pct}%`, backgroundColor: seg.color }}
              className="flex items-center justify-center text-on-solid transition-all"
            >
              {seg.pct >= 10 && (
                <span className="text-[10px] font-semibold">
                  {seg.pct.toFixed(0)}%
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div
          className="flex rounded-md bg-surface"
          style={{ height: `${height}px` }}
        >
          <span className="m-auto text-xs text-muted-text">
            {t("judges.no_outcome_data", { defaultValue: "No outcome data" })}
          </span>
        </div>
      )}

      {/* Legend */}
      {segments.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {segments.map((seg) => (
            <div key={seg.outcome} className="flex items-center gap-1">
              <div
                className="h-2 w-2 flex-shrink-0 rounded-sm"
                style={{ backgroundColor: seg.color }}
              />
              <span className="text-[10px] text-muted-text">
                {seg.outcome}
                <span className="ml-0.5 text-foreground">
                  {seg.pct.toFixed(0)}%
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const OutcomeStackedBar = memo(OutcomeStackedBarInner);
