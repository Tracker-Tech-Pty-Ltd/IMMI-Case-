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

/**
 * Generate a single-hue blue gradient color for a bar at position `index`
 * out of `total` bars. The highest-count bar (index 0) gets the darkest
 * blue; subsequent bars fade to lighter blues.
 * Color: rgba(26, 82, 118, alpha) where alpha goes from 1.0 → ~0.4
 */
function blueGradientColor(index: number, total: number): string {
  const intensity = total > 1 ? index / (total - 1) : 0;
  const alpha = 1 - intensity * 0.6;
  return `rgba(26, 82, 118, ${alpha.toFixed(3)})`;
}

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
    <div
      role="img"
      aria-label={t("components.charts.nature_bar_aria", {
        defaultValue:
          "Horizontal bar chart: case categories by volume",
      })}
    >
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
              <Cell
                key={i}
                fill={blueGradientColor(i, chartData.length)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export const NatureChart = memo(NatureChartInner);
