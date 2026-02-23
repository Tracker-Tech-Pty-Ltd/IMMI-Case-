import { memo } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface OutcomeBySubclassChartProps {
  data: Record<string, Record<string, number>>;
  limit?: number;
}

function OutcomeBySubclassChartInner({
  data,
  limit = 12,
}: OutcomeBySubclassChartProps) {
  const { t } = useTranslation();
  const chartData = Object.entries(data)
    .map(([subclass, outcomes]) => {
      const total = Object.values(outcomes).reduce((a, b) => a + b, 0);
      const affirmed = outcomes["Affirmed"] ?? 0;
      return {
        subclass,
        affirmedRate:
          total > 0 ? Math.round((affirmed / total) * 1000) / 10 : 0,
        total,
      };
    })
    .filter((d) => d.total >= 20)
    .toSorted((a, b) => b.total - a.total)
    .slice(0, limit);

  const getBarColor = (rate: number) => {
    if (rate >= 55) return "#2d7d46";
    if (rate >= 35) return "#b9770e";
    return "#a83232";
  };

  return (
    <ResponsiveContainer width="100%" height={chartData.length * 32 + 30}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 0, right: 30, bottom: 0, left: 0 }}
      >
        <XAxis
          type="number"
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="subclass"
          tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }}
          width={45}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          formatter={(value: number | undefined) => [
            `${Number(value ?? 0).toFixed(1)}%`,
            t("analytics.affirmed_rate"),
          ]}
          labelFormatter={(label: unknown) =>
            `${t("analytics.visa_subclass")} ${label}`
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
        <Bar
          dataKey="affirmedRate"
          name="Affirmed Rate"
          maxBarSize={20}
          radius={[0, 3, 3, 0]}
          label={{
            position: "right",
            fontSize: 10,
            fill: "var(--color-text-secondary)",
            formatter: (v: unknown) => `${Number(v)}%`,
          }}
        >
          {chartData.map((entry) => (
            <Cell key={entry.subclass} fill={getBarColor(entry.affirmedRate)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export const OutcomeBySubclassChart = memo(OutcomeBySubclassChartInner);
