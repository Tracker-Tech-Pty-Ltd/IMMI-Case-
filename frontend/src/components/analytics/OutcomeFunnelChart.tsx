import { memo } from "react";
import { useTranslation } from "react-i18next";

interface OutcomeFunnelChartProps {
  winCount: number;
  lossCount: number;
}

function OutcomeFunnelChartInner({ winCount, lossCount }: OutcomeFunnelChartProps) {
  const { t } = useTranslation();
  const total = winCount + lossCount;
  const winPct = total > 0 ? (winCount / total) * 100 : 0;
  const lossPct = total > 0 ? (lossCount / total) * 100 : 0;

  return (
    <div
      role="img"
      aria-label={t("analytics.outcome_funnel_aria", {
        win: winCount.toLocaleString(),
        loss: lossCount.toLocaleString(),
        winPct: winPct.toFixed(1),
        defaultValue: `Wins: ${winCount.toLocaleString()} (${winPct.toFixed(1)}%), Losses: ${lossCount.toLocaleString()} (${lossPct.toFixed(1)}%)`,
      })}
      data-testid="outcome-funnel-chart"
      className="space-y-2"
    >
      {/* Two stat numbers */}
      <div className="flex justify-between text-xs">
        <span className="font-semibold text-green-600 dark:text-green-400">
          {t("analytics.wins", { defaultValue: "Wins" })}: {winCount.toLocaleString()}
        </span>
        <span className="font-semibold text-red-600 dark:text-red-400">
          {t("analytics.losses", { defaultValue: "Losses" })}: {lossCount.toLocaleString()}
        </span>
      </div>
      {/* 100% stacked bar */}
      <div className="flex h-7 overflow-hidden rounded-md">
        {total > 0 ? (
          <>
            <div
              className="flex items-center justify-center text-xs font-medium text-white"
              style={{ width: `${winPct}%`, backgroundColor: "#1f8a4d" }}
              data-testid="win-bar"
            >
              {winPct >= 12 ? `${winPct.toFixed(0)}%` : ""}
            </div>
            <div
              className="flex items-center justify-center text-xs font-medium text-white"
              style={{ width: `${lossPct}%`, backgroundColor: "#b64040" }}
              data-testid="loss-bar"
            >
              {lossPct >= 12 ? `${lossPct.toFixed(0)}%` : ""}
            </div>
          </>
        ) : (
          <div className="w-full rounded-md bg-surface text-center text-xs text-muted-text">
            {t("common.no_data", { defaultValue: "No data" })}
          </div>
        )}
      </div>
    </div>
  );
}

export const OutcomeFunnelChart = memo(OutcomeFunnelChartInner);
