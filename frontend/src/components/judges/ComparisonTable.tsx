import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface ComparisonRow {
  metric: string;
  judge1Value: string | number;
  judge2Value: string | number;
  judge1Label?: string;
  judge2Label?: string;
}

interface ComparisonTableProps {
  judge1Name: string;
  judge2Name: string;
  rows: ComparisonRow[];
  isLoading?: boolean;
}

/**
 * Side-by-side comparison table for two judges
 * Displays detailed metrics for direct comparison
 */
export function ComparisonTable({
  judge1Name,
  judge2Name,
  rows,
  isLoading = false,
}: ComparisonTableProps) {
  const { t } = useTranslation();

  const formatValue = (value: string | number): string => {
    if (typeof value === "number") {
      // Format as percentage if value is between 0 and 1
      if (value >= 0 && value <= 1) {
        return `${(value * 100).toFixed(1)}%`;
      }
      return value.toLocaleString();
    }
    return value;
  };

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-card p-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-4 w-full animate-pulse rounded bg-surface"
          />
        ))}
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-8">
        <p className="text-sm text-muted-text">{t("common.no_data")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <caption className="sr-only">
          {t("judges.comparison_table_caption", {
            defaultValue: "Judge comparison metrics",
          })}
        </caption>
        <thead>
          <tr className="border-b border-border bg-surface">
            <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">
              {t("common.metric")}
            </th>
            <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">
              {judge1Name}
            </th>
            <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">
              {judge2Name}
            </th>
            <th scope="col" className="px-4 py-3 text-left font-semibold text-foreground">
              {t("common.difference")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const val1 =
              typeof row.judge1Value === "number" ? row.judge1Value : 0;
            const val2 =
              typeof row.judge2Value === "number" ? row.judge2Value : 0;
            const diff = val1 - val2;
            const diffSign = diff > 0 ? "+" : "";

            return (
              <tr
                key={`${row.metric}-${idx}`}
                className={cn(
                  "border-b border-border-light/60",
                  idx % 2 === 0 ? "bg-background" : "bg-surface/30",
                )}
              >
                <th
                  scope="row"
                  className="px-4 py-3 text-left font-medium text-foreground"
                >
                  {row.metric}
                </th>
                <td className="px-4 py-3 text-muted-text">
                  {formatValue(row.judge1Value)}
                </td>
                <td className="px-4 py-3 text-muted-text">
                  {formatValue(row.judge2Value)}
                </td>
                <td
                  className={cn(
                    "px-4 py-3 font-medium",
                    diff > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : diff < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-muted-text",
                  )}
                >
                  {diff !== 0
                    ? `${diffSign}${(Math.abs(diff) * 100).toFixed(1)}%`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
