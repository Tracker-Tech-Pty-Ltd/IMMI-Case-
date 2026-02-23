import { memo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { useTranslation } from "react-i18next";
import type { ConceptTrendData } from "@/types/case";

interface ConceptTrendChartProps {
  data: ConceptTrendData;
}

const COLORS = [
  "#1a5276",
  "#2d7d46",
  "#6c3483",
  "#b9770e",
  "#a83232",
  "#117864",
];

function ConceptTrendChartInner({ data }: ConceptTrendChartProps) {
  const { t } = useTranslation();
  const concepts = Object.keys(data.series).slice(0, 6);

  // Build year→point Maps once per concept (O(n)) instead of O(n²) find() in loop
  const pointMaps = new Map(
    concepts.map((concept) => [
      concept,
      new Map(data.series[concept].map((p) => [p.year, p])),
    ]),
  );
  const years = new Set<number>();
  concepts.forEach((concept) => {
    data.series[concept].forEach((point) => years.add(point.year));
  });

  const rows = Array.from(years)
    .toSorted((a, b) => a - b)
    .map((year) => {
      const row: Record<string, number> = { year };
      concepts.forEach((concept) => {
        const point = pointMaps.get(concept)?.get(year);
        row[concept] = point?.win_rate ?? 0;
      });
      return row;
    });

  if (!rows.length) {
    return (
      <p className="text-sm text-muted-text">{t("analytics.no_trend_data")}</p>
    );
  }

  return (
    <div className="min-h-[280px] flex-1">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={rows}
          margin={{ top: 5, right: 10, left: -20, bottom: 10 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            opacity={0.35}
          />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            formatter={(value: number | string | undefined) => [
              `${Number(value ?? 0).toFixed(1)}%`,
              t("analytics.win_rate"),
            ]}
            contentStyle={{
              backgroundColor: "var(--color-background-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              color: "var(--color-text)",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {concepts.map((concept, idx) => (
            <Line
              key={concept}
              type="monotone"
              dataKey={concept}
              stroke={COLORS[idx % COLORS.length]}
              dot={{ r: 2 }}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export const ConceptTrendChart = memo(ConceptTrendChartInner);
