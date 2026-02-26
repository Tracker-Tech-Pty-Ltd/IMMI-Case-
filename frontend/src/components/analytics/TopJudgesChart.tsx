import { memo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { JudgeEntry } from "@/types/case";

interface TopJudgesChartProps {
  data: JudgeEntry[];
}

function titleCase(name: string): string {
  return name
    .split(/\s+/)
    .map((w) =>
      w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(" ");
}

function TopJudgesChartInner({ data }: TopJudgesChartProps) {
  const { t } = useTranslation();
  const chartData = data.slice(0, 12).map((j) => {
    const normalized = titleCase(j.name);
    return {
      ...j,
      displayName:
        normalized.length > 18
          ? normalized.slice(0, 16) + "\u2026"
          : normalized,
      fullName: normalized,
    };
  });

  return (
    <div
      role="img"
      aria-label={t("analytics.top_judges_aria", {
        defaultValue: "Bar chart of most active judges by case count",
      })}
      className="space-y-2"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-text">
          {t("analytics.most_active_judges", {
            defaultValue: "Most Active Judges",
          })}
        </span>
        <Link
          to="/judge-profiles"
          className="text-xs font-medium text-accent hover:underline"
        >
          {t("buttons.view_all")} <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
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
            width={110}
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
              payload: ReadonlyArray<{
                payload?: JudgeEntry & { fullName?: string };
              }>,
            ) => {
              const judge = payload?.[0]?.payload;
              if (!judge) return "";
              const courtsText = judge.courts.join(", ");
              const profileHint = t("analytics.judge_profile_hint", {
                defaultValue: "Win rate data on Judge Profile page",
              });
              return `${judge.fullName ?? judge.name} (${courtsText}) — ${profileHint}`;
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
            fill="var(--color-primary)"
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
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export const TopJudgesChart = memo(TopJudgesChartInner);
