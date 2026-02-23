import { memo, useState } from "react";
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
import { ChartCard } from "./ChartCard";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { useVisaFamilies } from "@/hooks/use-analytics";
import type { AnalyticsFilterParams, VisaFamilyEntry } from "@/types/case";

const FAMILY_COLORS = [
  "var(--color-accent)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#84cc16",
];

interface Props {
  filters: AnalyticsFilterParams;
}

function VisaFamiliesSectionInner({ filters }: Props) {
  const { t } = useTranslation();
  const { data, isLoading } = useVisaFamilies(filters);
  const [sortBy, setSortBy] = useState<"total" | "win_rate">("total");

  const families = data?.families ?? [];
  const sorted = families.toSorted((a, b) =>
    sortBy === "total" ? b.total - a.total : b.win_rate - a.win_rate,
  );
  const top12 = sorted.slice(0, 12);

  return (
    <section className="space-y-4" data-testid="visa-families-section">
      <div>
        <h2 className="font-semibold text-foreground">
          {t("analytics.visa_families", {
            defaultValue: "Visa Family Analysis",
          })}
        </h2>
        <p className="text-sm text-muted-text">
          {t("analytics.visa_families_desc", {
            defaultValue:
              "Success rates aggregated by visa family grouping. Compare outcomes across visa categories.",
          })}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bar chart: Volume by family */}
        <ChartCard
          title={t("analytics.visa_family_volume", {
            defaultValue: "Cases by Visa Family",
          })}
          isLoading={isLoading}
          isEmpty={families.length === 0}
        >
          <div className="mb-2 flex justify-end">
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as "total" | "win_rate")
              }
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-foreground"
            >
              <option value="total">
                {t("analytics.sort_by_volume", {
                  defaultValue: "Sort by Volume",
                })}
              </option>
              <option value="win_rate">
                {t("analytics.sort_by_win_rate", {
                  defaultValue: "Sort by Win Rate",
                })}
              </option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart
              data={top12}
              layout="vertical"
              margin={{ left: 100, right: 20, top: 5, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border)"
              />
              <XAxis
                type="number"
                tick={{ fill: "var(--color-text)", fontSize: 11 }}
              />
              <YAxis
                type="category"
                dataKey="family"
                tick={{ fill: "var(--color-text)", fontSize: 11 }}
                width={95}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-card)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(
                  value: number | undefined,
                  name: string | undefined,
                ) => [
                  (value ?? 0).toLocaleString(),
                  name === "total"
                    ? t("analytics.total_cases", {
                        defaultValue: "Total Cases",
                      })
                    : (name ?? ""),
                ]}
              />
              <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                {top12.map((_, i) => (
                  <Cell
                    key={i}
                    fill={FAMILY_COLORS[i % FAMILY_COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Win rate table */}
        <ChartCard
          title={t("analytics.visa_family_win_rates", {
            defaultValue: "Win Rates by Family",
          })}
          isLoading={isLoading}
          isEmpty={families.length === 0}
        >
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-xs text-muted-text">
                  <th className="pb-2 font-medium">
                    {t("analytics.family", { defaultValue: "Family" })}
                  </th>
                  <th className="pb-2 text-right font-medium">
                    {t("analytics.cases")}
                  </th>
                  <th className="pb-2 text-right font-medium">
                    {t("analytics.win_rate")}
                  </th>
                  <th className="pb-2 text-right font-medium">
                    {t("analytics.confidence")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((f: VisaFamilyEntry) => (
                  <tr
                    key={f.family}
                    className="border-b border-border/50 hover:bg-surface/50"
                  >
                    <td className="py-2 font-medium text-foreground">
                      {f.family}
                    </td>
                    <td className="py-2 text-right tabular-nums text-secondary-text">
                      {f.total.toLocaleString()}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      <span
                        className={
                          f.win_rate >= 50
                            ? "text-emerald-500"
                            : f.win_rate >= 30
                              ? "text-amber-500"
                              : "text-rose-500"
                        }
                      >
                        {f.win_rate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <ConfidenceBadge totalMatching={f.total} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      </div>
    </section>
  );
}

export const VisaFamiliesSection = memo(VisaFamiliesSectionInner);
