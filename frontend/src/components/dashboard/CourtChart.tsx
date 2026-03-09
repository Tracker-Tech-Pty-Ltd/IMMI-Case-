import { memo } from "react";
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
import { getCourtColor } from "@/tokens/tokens";

interface CourtChartProps {
  data: Record<string, number>;
}

const COURT_LABELS: Record<string, string> = {
  "Administrative Appeals Tribunal": "AAT",
  "Administrative Review Tribunal": "ART",
  "Federal Court of Australia": "FCA",
  "Federal Circuit Court of Australia": "FCCA",
  "Federal Circuit and Family Court of Australia (Division 2)": "FCFCOA D2",
  "High Court of Australia": "HCA",
  "Refugee Review Tribunal": "RRT",
  "Migration Review Tribunal": "MRT",
  "Federal Magistrates Court of Australia": "FMCA",
};

function formatCourtLabel(name: string): string {
  return COURT_LABELS[name] ?? name;
}

function CourtChartInner({ data }: CourtChartProps) {
  const { t } = useTranslation();
  const chartData = Object.entries(data)
    .map(([name, value]) => ({ name, value }))
    .toSorted((a, b) => b.value - a.value);

  return (
    <div
      role="img"
      aria-label={t("components.charts.court_bar_aria", {
        defaultValue: "Bar chart: cases by court",
      })}
    >
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={chartData}
          margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
            tickFormatter={formatCourtLabel}
            interval={0}
            height={44}
            tickMargin={6}
          />
          <YAxis tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }} />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-background-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              color: "var(--color-text)",
              fontSize: 13,
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {chartData.map((entry) => (
              <Cell
                key={entry.name}
                fill={getCourtColor(entry.name) ?? "#8b8680"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export const CourtChart = memo(CourtChartInner);
