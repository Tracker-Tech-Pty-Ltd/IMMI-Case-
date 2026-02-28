import { memo, useMemo } from "react";
import { LineChart, Line, XAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useTranslation } from "react-i18next";
import { getCourtColor } from "@/tokens/tokens";
import type { TrendEntry } from "@/types/case";

interface CourtSparklineGridProps {
  data: TrendEntry[];
}

function CourtSparklineGridInner({ data }: CourtSparklineGridProps) {
  const { t } = useTranslation();

  // Discover all courts in the data
  const courts = useMemo(() => {
    const courtSet = new Set<string>();
    for (const entry of data) {
      for (const key of Object.keys(entry)) {
        if (key !== "year") courtSet.add(key);
      }
    }
    // Sort by total volume descending
    return Array.from(courtSet).toSorted((a, b) => {
      const aTotal = data.reduce((s, e) => s + ((e[a] as number) || 0), 0);
      const bTotal = data.reduce((s, e) => s + ((e[b] as number) || 0), 0);
      return bTotal - aTotal;
    });
  }, [data]);

  if (!data.length || !courts.length) return null;

  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
      data-testid="court-sparkline-grid"
    >
      {courts.map((court) => {
        const chartData = data.map((entry) => ({
          year: entry.year,
          count: (entry[court] as number) || 0,
        }));

        const peakEntry = chartData.reduce(
          (max, e) => (e.count > max.count ? e : max),
          chartData[0],
        );

        const total = chartData.reduce((s, e) => s + e.count, 0);

        const color = getCourtColor(court) ?? "#6b7280";

        return (
          <div
            key={court}
            role="img"
            aria-label={t("dashboard.court_sparkline_aria", {
              court,
              total: total.toLocaleString(),
              defaultValue: `${court}: ${total.toLocaleString()} total cases`,
            })}
            className="rounded-lg border border-border bg-card p-3"
            data-testid={`court-sparkline-${court}`}
          >
            <p className="mb-1 text-xs font-semibold text-foreground">
              {court}
            </p>
            <p className="mb-2 text-xs text-muted-text">
              {total.toLocaleString()}{" "}
              {t("chart.cases", { defaultValue: "cases" })}
            </p>
            <div className="h-[60px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
                >
                  <XAxis dataKey="year" hide />
                  <Tooltip
                    formatter={(v: number | string | undefined) => [
                      Number(v ?? 0).toLocaleString(),
                      t("chart.cases", { defaultValue: "cases" }),
                    ]}
                    labelFormatter={(label: unknown) => String(label)}
                    contentStyle={{
                      backgroundColor: "var(--color-background-card)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "var(--radius)",
                      color: "var(--color-text)",
                      fontSize: 11,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke={color}
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {peakEntry && peakEntry.count > 0 && (
              <p className="mt-1 text-[10px] text-muted-text">
                {t("dashboard.peak_year", {
                  year: peakEntry.year,
                  defaultValue: `Peak: ${peakEntry.year}`,
                })}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const CourtSparklineGrid = memo(CourtSparklineGridInner);
