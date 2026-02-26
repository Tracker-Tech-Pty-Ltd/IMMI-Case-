import { memo } from "react";
import { useTranslation } from "react-i18next";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { COURT_EVENTS } from "@/lib/court-events";

interface OutcomeTrendChartProps {
  data: Record<string, Record<string, number>>;
}

function OutcomeTrendChartInner({ data }: OutcomeTrendChartProps) {
  const { t } = useTranslation();
  const chartData = Object.entries(data)
    .map(([yearStr, outcomes]) => {
      const total = Object.values(outcomes).reduce((a, b) => a + b, 0);
      const affirmed = outcomes["Affirmed"] ?? 0;
      const setAside = outcomes["Set Aside"] ?? 0;
      const remitted = outcomes["Remitted"] ?? 0;
      const allowed = outcomes["Allowed"] ?? 0;
      const granted = outcomes["Granted"] ?? 0;
      const quashed = outcomes["Quashed"] ?? 0;
      const applicantWin = setAside + remitted + allowed + granted + quashed;
      return {
        year: Number(yearStr),
        affirmedRate:
          total > 0 ? Math.round((affirmed / total) * 1000) / 10 : 0,
        applicantWinRate:
          total > 0 ? Math.round((applicantWin / total) * 1000) / 10 : 0,
        total,
      };
    })
    .filter((d) => d.total >= 10)
    .toSorted((a, b) => a.year - b.year);

  return (
    <div className="flex flex-col">
      <ResponsiveContainer width="100%" height="100%" minHeight={300}>
        <AreaChart
          data={chartData}
          margin={{ top: 20, right: 15, bottom: 5, left: -10 }}
        >
          <defs>
            <linearGradient id="affirmedGrad-trend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2d7d46" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#2d7d46" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="applicantGrad-trend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2a6496" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#2a6496" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            opacity={0.2}
          />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
            tickFormatter={(v: number) => `'${String(v).slice(2)}`}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number | undefined, name: string | undefined) => [
              `${Number(value ?? 0).toFixed(1)}%`,
              name ?? "",
            ]}
            labelFormatter={(label: unknown) =>
              `${t("analytics.year_label")} ${label}`
            }
            contentStyle={{
              backgroundColor: "var(--color-background-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              color: "var(--color-text)",
              fontSize: 12,
              padding: "8px 12px",
            }}
            itemStyle={{ fontSize: 12, padding: "1px 0" }}
            labelStyle={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "var(--color-text-secondary)" }}
            iconSize={8}
          />
          {/* Court merger/transition event annotations */}
          {COURT_EVENTS.map((event) => (
            <ReferenceLine
              key={event.year}
              x={event.year}
              stroke={event.color}
              strokeDasharray="4 2"
              strokeWidth={1.5}
              label={{
                value: t(event.labelKey, { defaultValue: event.labelDefault }),
                position: "top",
                fontSize: 9,
                fill: event.color,
              }}
            />
          ))}
          <Area
            type="monotone"
            dataKey="affirmedRate"
            name={t("analytics.affirmed_rate")}
            stroke="#2d7d46"
            strokeWidth={2}
            fill="url(#affirmedGrad-trend)"
            dot={{ r: 2, fill: "#2d7d46", strokeWidth: 0 }}
            activeDot={{ r: 4, fill: "#2d7d46", strokeWidth: 2, stroke: "#fff" }}
          />
          <Area
            type="monotone"
            dataKey="applicantWinRate"
            name={t("analytics.applicant_win_rate")}
            stroke="#2a6496"
            strokeWidth={2}
            fill="url(#applicantGrad-trend)"
            dot={{ r: 2, fill: "#2a6496", strokeWidth: 0 }}
            activeDot={{ r: 4, fill: "#2a6496", strokeWidth: 2, stroke: "#fff" }}
          />
        </AreaChart>
      </ResponsiveContainer>
      {/* L4: Legend explanation note */}
      <p className="mt-1 text-xs text-muted-text">
        {t("analytics.trend_legend_note", {
          defaultValue:
            "Affirmed Rate = tribunal upholds decision | Applicant Win Rate = Set Aside + Remitted",
        })}
      </p>
    </div>
  );
}

export const OutcomeTrendChart = memo(OutcomeTrendChartInner);
