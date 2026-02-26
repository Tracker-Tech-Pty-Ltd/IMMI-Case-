import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";

// Semantic colors for common outcomes
const OUTCOME_SEGMENT_COLORS: Record<string, string> = {
  Affirmed: "#a93226",      // red - tribunal upholds rejection
  Dismissed: "#922b5f",
  Refused: "#b64040",
  Withdrawn: "#7d8a9a",
  Remitted: "#1e8449",      // green - applicant wins
  "Set Aside": "#1a5276",   // blue - set aside
  Allowed: "#117864",
  Granted: "#28b463",
  Other: "#6b7280",
};

const FALLBACK_COLORS = [
  "#1a5276",
  "#117864",
  "#6c3483",
  "#b9770e",
  "#a93226",
  "#1e8449",
  "#2e86c1",
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
              className="flex items-center justify-center text-white transition-all"
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
