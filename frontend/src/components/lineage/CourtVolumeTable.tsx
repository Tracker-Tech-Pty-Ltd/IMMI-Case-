import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ArrowUpDown } from "lucide-react";
import { courtColors } from "@/tokens/tokens";
import type { CourtStats } from "@/lib/lineage-transforms";
import { cn } from "@/lib/utils";

type SortField = "code" | "totalCases" | "peakYear" | "avgPerYear" | "years";
type SortDir = "asc" | "desc";

interface CourtVolumeTableProps {
  stats: CourtStats[];
}

export function CourtVolumeTable({ stats }: CourtVolumeTableProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<SortField>("totalCases");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    return stats.toSorted((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "code":
          cmp = a.code.localeCompare(b.code);
          break;
        case "totalCases":
          cmp = a.totalCases - b.totalCases;
          break;
        case "peakYear":
          cmp = a.peakYear - b.peakYear;
          break;
        case "avgPerYear":
          cmp = a.avgPerYear - b.avgPerYear;
          break;
        case "years":
          cmp = a.years[0] - b.years[0];
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [stats, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const headerBtn = (field: SortField, labelKey: string) => (
    <button
      onClick={() => toggleSort(field)}
      className={cn(
        "flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide transition-colors",
        sortField === field
          ? "text-accent"
          : "text-muted-text hover:text-foreground",
      )}
    >
      {t(labelKey)}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="px-3 py-2 text-left">
                {headerBtn("code", "lineage.court_table_code")}
              </th>
              <th className="hidden sm:table-cell px-3 py-2 text-left">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-text">
                  {t("lineage.court_table_name")}
                </span>
              </th>
              <th className="px-3 py-2 text-left">
                {headerBtn("years", "lineage.court_table_years")}
              </th>
              <th className="px-3 py-2 text-center">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-text">
                  {t("lineage.court_table_status")}
                </span>
              </th>
              <th className="px-3 py-2 text-right">
                {headerBtn("totalCases", "lineage.court_table_total")}
              </th>
              <th className="px-3 py-2 text-right">
                {headerBtn("peakYear", "lineage.court_table_peak")}
              </th>
              <th className="hidden sm:table-cell px-3 py-2 text-right">
                {headerBtn("avgPerYear", "lineage.court_table_avg")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((court) => {
              const color = courtColors[court.code] ?? "#8b8680";
              const nowLabel = t("lineage.now", { defaultValue: "now" });
              return (
                <tr
                  key={court.code}
                  className="border-b border-border-light last:border-0 hover:bg-surface/50 transition-colors"
                >
                  <td className="px-3 py-2">
                    <button
                      onClick={() => navigate(`/cases?court=${court.code}`)}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ backgroundColor: color }}
                      />
                      <span
                        className="font-mono text-xs font-bold"
                        style={{ color }}
                      >
                        {court.code}
                      </span>
                    </button>
                  </td>
                  <td className="hidden sm:table-cell px-3 py-2 text-xs text-muted-text truncate max-w-[200px]">
                    {court.name}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums text-foreground">
                    {court.years[0]}–
                    {court.isActive ? nowLabel : court.years[1]}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={cn(
                        "inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
                        court.isActive
                          ? "bg-success/10 text-success"
                          : "bg-surface text-muted-text",
                      )}
                    >
                      {court.isActive
                        ? t("lineage.court_table_status_active")
                        : t("lineage.court_table_status_dissolved")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-foreground">
                    {court.totalCases.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-text">
                    {court.peakYear}
                    <span className="ml-1 text-[10px] text-muted-text/60">
                      ({court.peakCount.toLocaleString()})
                    </span>
                  </td>
                  <td className="hidden sm:table-cell px-3 py-2 text-right text-xs tabular-nums text-muted-text">
                    {court.avgPerYear.toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
