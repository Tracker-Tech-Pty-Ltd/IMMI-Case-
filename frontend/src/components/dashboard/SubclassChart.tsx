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

// Friendly names for common subclasses
const SUBCLASS_NAMES: Record<string, string> = {
  "866": "Protection",
  "500": "Student",
  "457": "Temp Skilled (old)",
  "482": "Temp Skill Shortage",
  "189": "Skilled Independent",
  "190": "Skilled Nominated",
  "820": "Partner (temp)",
  "801": "Partner (perm)",
  "309": "Partner (offshore)",
  "600": "Visitor",
  "143": "Contrib Parent",
  "103": "Parent",
  "785": "Temp Protection",
  "200": "Refugee",
  "417": "Work & Holiday",
  "186": "Employer Nom",
  "491": "Skilled Regional",
  "494": "Employer Regional",
  "300": "Prospective Marriage",
  "444": "NZ Citizen",
  "790": "Safe Haven Enterprise",
};

/**
 * Generate a single-hue blue gradient color for bar at position `index`
 * out of `total` bars. Matches NatureChart gradient for visual consistency.
 */
function blueGradientColor(index: number, total: number): string {
  const intensity = total > 1 ? index / (total - 1) : 0;
  const alpha = 1 - intensity * 0.6;
  return `rgba(26, 82, 118, ${alpha.toFixed(3)})`;
}

interface SubclassChartProps {
  data: Record<string, number>;
}

function SubclassChartInner({ data }: SubclassChartProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const chartData = Object.entries(data)
    .toSorted(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([subclass, value]) => ({
      subclass,
      label: SUBCLASS_NAMES[subclass]
        ? `${subclass} (${SUBCLASS_NAMES[subclass]})`
        : subclass,
      value,
    }));

  if (chartData.length === 0) return null;

  return (
    <div
      role="img"
      aria-label={t("components.charts.subclass_bar_aria", {
        defaultValue: "Horizontal bar chart: top visa subclasses by volume",
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
              | Array<{ payload: { subclass: string } }>
              | undefined;
            if (payload?.[0]) {
              const subclass = payload[0].payload.subclass;
              navigate(
                `/cases?subclass_number=${encodeURIComponent(subclass)}`,
              );
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
            dataKey="label"
            width={180}
            tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }}
            tickFormatter={(v: string) =>
              v.length > 20 ? v.slice(0, 18) + "…" : v
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
            labelFormatter={(label: unknown) => String(label)}
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

export const SubclassChart = memo(SubclassChartInner);
