import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { JudgeLeaderboardEntry } from "@/types/case";

interface JudgeLeaderboardProps {
  data: JudgeLeaderboardEntry[];
  selectedNames: string[];
  onToggleCompare: (name: string) => void;
  onOpen: (name: string) => void;
}

const PAGE_SIZE = 50;

export function JudgeLeaderboard({
  data,
  selectedNames,
  onToggleCompare,
  onOpen,
}: JudgeLeaderboardProps) {
  const { t } = useTranslation();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset visible count whenever the underlying data changes (new filter applied)
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [data]);

  if (!data.length) {
    return (
      <p className="text-sm text-muted-text">{t("judges.no_judge_records")}</p>
    );
  }

  const visibleData = data.slice(0, visibleCount);
  const hasMore = visibleCount < data.length;
  const remaining = data.length - visibleCount;
  const nextBatch = Math.min(PAGE_SIZE, remaining);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[1000px] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface text-left text-xs uppercase tracking-wide text-muted-text">
            <th className="px-3 py-2">{t("judges.compare")}</th>
            <th className="px-3 py-2">{t("judges.judge_member")}</th>
            <th className="px-3 py-2">{t("judges.total_cases")}</th>
            <th className="px-3 py-2">{t("judges.approval_rate")}</th>
            <th className="px-3 py-2">{t("judges.active_years_column")}</th>
            <th className="px-3 py-2">{t("judges.courts")}</th>
            <th className="px-3 py-2">{t("judges.top_visa_subclasses")}</th>
          </tr>
        </thead>
        <tbody>
          {visibleData.map((row) => {
            const displayName = row.display_name ?? row.name;
            return (
              <tr
                key={row.name}
                className="cursor-pointer border-b border-border-light/60 hover:bg-surface/50"
                onClick={() => onOpen(row.name)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpen(row.name);
                  }
                  if (event.key.toLowerCase() === "x") {
                    event.preventDefault();
                    onToggleCompare(row.name);
                  }
                }}
                tabIndex={0}
                aria-selected={selectedNames.includes(row.name)}
                aria-label={`${displayName} ${t("judges.judge_member")}`}
              >
                <td
                  className="px-3 py-2"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  <input
                    aria-label={`Compare ${displayName}`}
                    type="checkbox"
                    checked={selectedNames.includes(row.name)}
                    onChange={() => onToggleCompare(row.name)}
                  />
                </td>
                <td className="px-3 py-2 font-medium text-foreground">
                  {displayName}
                </td>
                <td className="px-3 py-2 text-muted-text">
                  {row.total_cases.toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  <div className="w-40">
                    <div className="mb-1 text-xs text-muted-text">
                      {row.approval_rate.toFixed(1)}%
                    </div>
                    <div className="h-2 rounded bg-surface">
                      <div
                        className="h-2 rounded bg-accent"
                        style={{
                          width: `${Math.min(row.approval_rate, 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-text">
                  {row.active_years.first ?? "-"} –{" "}
                  {row.active_years.last ?? "-"}
                </td>
                <td className="px-3 py-2 text-muted-text">
                  {row.courts.join(", ") || "-"}
                </td>
                <td className="px-3 py-2 text-muted-text">
                  {row.top_visa_subclasses[0]
                    ? `${row.top_visa_subclasses[0].subclass} (${row.top_visa_subclasses[0].count})`
                    : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <div className="p-3 text-center">
          <button
            type="button"
            onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
            className="rounded border border-border px-3 py-1.5 text-xs text-muted-text hover:text-foreground"
          >
            {t("judges.load_more", {
              defaultValue: `Load ${nextBatch} more (${remaining} remaining)`,
            })}
          </button>
        </div>
      )}
    </div>
  );
}
