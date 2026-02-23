import { memo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const OUTCOME_COLORS: Record<string, string> = {
  Affirmed: "#2d7d46",
  Dismissed: "#a83232",
  Remitted: "#2a6496",
  "Set aside": "#6c3483",
  "Set Aside": "#6c3483",
  Allowed: "#117864",
  Granted: "#1a8a5a",
  Quashed: "#0e6655",
  Refused: "#b9770e",
  Cancelled: "#922b21",
  "No jurisdiction": "#7d6608",
  Varied: "#1a5276",
  Withdrawn: "#8b8680",
  Other: "#c0b8a8",
};

interface OutcomeByCourtChartProps {
  data: Record<string, Record<string, number>>;
}

function OutcomeByCourtChartInner({ data }: OutcomeByCourtChartProps) {
  const outcomeSet = new Set<string>();
  for (const outcomes of Object.values(data)) {
    for (const key of Object.keys(outcomes)) outcomeSet.add(key);
  }
  const outcomeLabels = [...outcomeSet].toSorted();

  const chartData = Object.entries(data)
    .map(([court, outcomes]) => {
      const total = Object.values(outcomes).reduce((a, b) => a + b, 0);
      const row: Record<string, string | number> = { court, _total: total };
      for (const label of outcomeLabels) {
        row[label] =
          total > 0
            ? Math.round(((outcomes[label] ?? 0) / total) * 1000) / 10
            : 0;
      }
      return row;
    })
    .toSorted((a, b) => (b._total as number) - (a._total as number));

  return (
    <ResponsiveContainer width="100%" height={chartData.length * 36 + 50}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 0, right: 20, bottom: 30, left: 5 }}
      >
        <XAxis
          type="number"
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="court"
          tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
          width={85}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          formatter={(value: number | undefined, name: string | undefined) => [
            `${Number(value ?? 0).toFixed(1)}%`,
            name ?? "",
          ]}
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
          wrapperStyle={{
            fontSize: 11,
            paddingTop: 8,
            color: "var(--color-text-secondary)",
          }}
          iconSize={10}
        />
        {outcomeLabels.map((label) => (
          <Bar
            key={label}
            dataKey={label}
            stackId="stack"
            fill={OUTCOME_COLORS[label] ?? "#8b8680"}
            maxBarSize={24}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export const OutcomeByCourtChart = memo(OutcomeByCourtChartInner);
