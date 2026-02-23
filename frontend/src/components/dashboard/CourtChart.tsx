import { memo } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { courtColors } from "@/tokens/tokens";

/** Map full court names to short codes for pie labels */
const courtAbbr: Record<string, string> = {
  "Administrative Appeals Tribunal": "AATA",
  "Administrative Review Tribunal": "ARTA",
  "Federal Court of Australia": "FCA",
  "Federal Circuit Court of Australia": "FCCA",
  "Federal Circuit and Family Court of Australia (Division 2)": "FedCFamC2G",
  "Federal Circuit and Family Court (Div 2)": "FedCFamC2G",
  "High Court of Australia": "HCA",
};

function abbreviate(name: string): string {
  return courtAbbr[name] ?? (name.length > 12 ? name.slice(0, 10) + "…" : name);
}

interface CourtChartProps {
  data: Record<string, number>;
  type?: "bar" | "pie";
}

function CourtChartInner({ data, type = "bar" }: CourtChartProps) {
  const { t } = useTranslation();
  const chartData = Object.entries(data)
    .map(([name, value]) => ({ name, value }))
    .toSorted((a, b) => b.value - a.value);

  if (type === "pie") {
    const total = chartData.reduce((sum, d) => sum + d.value, 0);
    return (
      <ResponsiveContainer width="100%" height={360}>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="45%"
            outerRadius={90}
            label={({ name, percent }) => {
              const pct = ((percent ?? 0) * 100).toFixed(0);
              return Number(pct) >= 3
                ? `${abbreviate(name ?? "")} ${pct}%`
                : "";
            }}
            labelLine={false}
            fontSize={12}
          >
            {chartData.map((entry) => (
              <Cell
                key={entry.name}
                fill={courtColors[entry.name] ?? "#8b8680"}
              />
            ))}
          </Pie>
          <Tooltip
            formatter={(value) => {
              const num = Number(value ?? 0);
              return [
                `${num.toLocaleString()} (${((num / total) * 100).toFixed(1)}%)`,
                t("components.charts.chart_cases"),
              ];
            }}
            contentStyle={{
              backgroundColor: "var(--color-background-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              fontSize: 13,
            }}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            formatter={(value: string) => abbreviate(value)}
            wrapperStyle={{
              fontSize: 11,
              color: "var(--color-text-secondary)",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={chartData}
        margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12, fill: "var(--color-text-secondary)" }}
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
              fill={courtColors[entry.name] ?? "#8b8680"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export const CourtChart = memo(CourtChartInner);
