import { useTranslation } from "react-i18next";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

interface MetricData {
  name: string;
  value1: number;
  value2: number;
  label1: string;
  label2: string;
}

interface DualMetricChartProps {
  data: MetricData[];
  label1?: string;
  label2?: string;
  title?: string;
  height?: number;
  horizontal?: boolean;
  layout?: "horizontal" | "vertical";
}

/**
 * Side-by-side comparison chart for two metrics
 * Useful for comparing judge performance across different dimensions
 */
export function DualMetricChart({
  data,
  label1,
  label2,
  title,
  height = 300,
  horizontal = false,
  layout,
}: DualMetricChartProps) {
  const { t } = useTranslation();

  // Resolve effective layout: explicit `layout` prop takes precedence over legacy `horizontal` bool
  const isHorizontal =
    layout === "horizontal" || (layout === undefined && horizontal);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-8">
        <p className="text-sm text-muted-text">{t("common.no_data")}</p>
      </div>
    );
  }

  const chart = (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={isHorizontal ? "horizontal" : "vertical"}
        margin={
          isHorizontal
            ? { top: 5, right: 30, left: 100, bottom: 5 }
            : { top: 5, right: 10, left: -20, bottom: 5 }
        }
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-border)"
          opacity={0.35}
        />
        {!isHorizontal ? (
          <>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
            />
          </>
        ) : (
          <>
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
            />
            <YAxis
              dataKey="name"
              type="category"
              tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
              width={100}
            />
          </>
        )}
        <Tooltip
          formatter={(value: number | undefined) => {
            if (typeof value === "number") {
              return `${(value * 100).toFixed(1)}%`;
            }
            return "";
          }}
          contentStyle={{
            backgroundColor: "var(--color-background-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            color: "var(--color-text)",
          }}
        />
        <Legend
          wrapperStyle={{
            paddingTop: "1rem",
            fontSize: "12px",
            color: "var(--color-text-secondary)",
          }}
          formatter={(value: string) => {
            // Prefer explicit label1/label2 props; fall back to per-item labels
            const item = data[0];
            if (value === "value1") return label1 ?? item.label1;
            return label2 ?? item.label2;
          }}
        />
        <Bar
          dataKey="value1"
          fill="var(--color-primary)"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="value2"
          fill="var(--color-accent)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );

  return (
    <div
      role="img"
      aria-label={
        title ??
        t("judges.dual_metric_chart", {
          defaultValue: "Dual metric comparison chart",
        })
      }
      className="w-full"
    >
      {title && (
        <h3 className="mb-3 text-sm font-semibold text-foreground">{title}</h3>
      )}
      {chart}
    </div>
  );
}
