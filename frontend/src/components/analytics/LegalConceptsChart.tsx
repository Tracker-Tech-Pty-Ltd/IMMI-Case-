import { memo } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTranslation } from "react-i18next";
import type { ConceptEntry } from "@/types/case";

// Extended type to handle optional win_rate from analytics endpoints
interface ExtendedConceptEntry extends ConceptEntry {
  win_rate?: number;
}

interface LegalConceptsChartProps {
  data: ExtendedConceptEntry[];
}

/**
 * Returns a semantic color based on win_rate:
 *  >= 60% → green (favourable)
 *  >= 40% → amber (neutral)
 *   < 40% → red (unfavourable)
 *  undefined → use accent color
 */
function getConceptColor(winRate: number | undefined): string {
  if (winRate === undefined) return "var(--color-accent)";
  if (winRate >= 60) return "#1f8a4d";
  if (winRate >= 40) return "#b9770e";
  return "#a93226";
}

function LegalConceptsChartInner({ data }: LegalConceptsChartProps) {
  const { t } = useTranslation();
  const chartData = (data as ExtendedConceptEntry[]).slice(0, 12).map((c) => ({
    ...c,
    displayName: c.name.length > 18 ? c.name.slice(0, 16) + "\u2026" : c.name,
  }));

  return (
    <div
      role="img"
      aria-label={t("analytics.legal_concepts_aria", {
        defaultValue: "Bar chart of top legal concepts by case count",
      })}
    >
      <ResponsiveContainer width="100%" height={chartData.length * 38 + 35}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 0, right: 45, bottom: 0, left: 5 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="displayName"
            tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
            width={120}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(value: number | undefined) => [
              Number(value ?? 0).toLocaleString(),
              t("chart.cases"),
            ]}
            labelFormatter={(
              _: unknown,
              payload: ReadonlyArray<{ payload?: ExtendedConceptEntry }>,
            ) => {
              const entry = payload?.[0]?.payload;
              if (!entry) return "";
              const winRateText =
                entry.win_rate !== undefined
                  ? ` · ${entry.win_rate.toFixed(1)}% win`
                  : "";
              return `${entry.name}${winRateText}`;
            }}
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
            dataKey="count"
            radius={[0, 3, 3, 0]}
            maxBarSize={22}
            label={{
              position: "right",
              fontSize: 11,
              fill: "var(--color-text-secondary)",
              formatter: (v: unknown) => {
                const n = Number(v);
                return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
              },
            }}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={getConceptColor(entry.win_rate)}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export const LegalConceptsChart = memo(LegalConceptsChartInner);
