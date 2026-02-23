import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const NATURE_COLORS = [
  "#1a5276",
  "#117864",
  "#6c3483",
  "#b9770e",
  "#a93226",
  "#1e8449",
  "#922b5f",
  "#b84c00",
  "#1b2631",
  "#2e86c1",
  "#28b463",
  "#d4ac0d",
  "#cb4335",
  "#7d3c98",
  "#148f77",
  "#d68910",
  "#a569bd",
  "#45b39d",
  "#ec7063",
  "#5dade2",
];

interface NatureChartProps {
  data: Record<string, number>;
}

function NatureChartInner({ data }: NatureChartProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const chartData = Object.entries(data)
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([name, value]) => ({ name, value }));

  if (chartData.length === 0) return null;

  return (
    <ResponsiveContainer
      width="100%"
      height={Math.max(250, chartData.length * 28)}
    >
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 5, right: 30, bottom: 5, left: 0 }}
        onClick={(state: Record<string, unknown>) => {
          const payload = state?.activePayload as
            | Array<{ payload: { name: string } }>
            | undefined;
          if (payload?.[0]) {
            const nature = payload[0].payload.name;
            navigate(`/cases?nature=${encodeURIComponent(nature)}`);
          }
        }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-border)"
          horizontal={false}
        />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }}
          tickFormatter={(v: string) =>
            v.length > 18 ? v.slice(0, 16) + "…" : v
          }
        />
        <Tooltip
          cursor={{ fill: "var(--color-background-surface)", opacity: 0.5 }}
          contentStyle={{
            backgroundColor: "var(--color-background-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            color: "var(--color-text)",
            fontSize: 13,
          }}
          formatter={(value: number | undefined) => [
            Number(value ?? 0).toLocaleString(),
            t("components.charts.chart_cases"),
          ]}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} cursor="pointer">
          {chartData.map((_, i) => (
            <Cell key={i} fill={NATURE_COLORS[i % NATURE_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export const NatureChart = memo(NatureChartInner);
