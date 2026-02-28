import { Briefcase, Scale } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CourtBadge } from "@/components/shared/CourtBadge";
import { getCourtColor } from "@/tokens/tokens";
import { cn } from "@/lib/utils";
import { approvalBadgeClass } from "./constants";
import type { JudgeLeaderboardEntry } from "@/types/case";

interface JudgeCardProps {
  judge: JudgeLeaderboardEntry;
  isSelected: boolean;
  onToggleCompare: (name: string) => void;
  onOpen: (name: string) => void;
}

export function JudgeCard({
  judge,
  isSelected,
  onToggleCompare,
  onOpen,
}: JudgeCardProps) {
  const { t } = useTranslation();
  const displayName = judge.display_name ?? judge.name;
  const accentColor = getCourtColor(judge.primary_court ?? "") ?? "#6b7585";
  const yearsLabel =
    judge.active_years.first && judge.active_years.last
      ? judge.active_years.first === judge.active_years.last
        ? `${judge.active_years.first}`
        : `${judge.active_years.first} – ${judge.active_years.last}`
      : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(judge.name)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(judge.name);
        }
        if (event.key.toLowerCase() === "x") {
          event.preventDefault();
          onToggleCompare(judge.name);
        }
      }}
      aria-label={`${displayName} ${t("judges.judge_member")}`}
      className="group flex min-h-[180px] flex-col rounded-lg border border-border bg-card text-left shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      style={{ borderLeftWidth: "3px", borderLeftColor: accentColor }}
    >
      <div className="flex flex-1 flex-col p-4">
        {/* Top row: court badges + approval rate */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {judge.courts.map((c) => (
            <CourtBadge key={c} court={c} />
          ))}
          <span
            className={cn(
              "ml-auto shrink-0 rounded-sm px-2 py-0.5 text-xs font-semibold",
              approvalBadgeClass(judge.approval_rate),
            )}
          >
            {judge.approval_rate.toFixed(1)}%
          </span>
        </div>

        {/* Judge name */}
        <h3 className="line-clamp-1 text-sm font-semibold text-foreground transition-colors group-hover:text-accent">
          {displayName}
        </h3>

        {/* Active years */}
        {yearsLabel && (
          <p className="mt-0.5 text-xs text-muted-text">{yearsLabel}</p>
        )}

        {/* Spacer */}
        <div className="mt-auto" />

        {/* Bottom metadata */}
        <div className="mt-3 border-t border-border-light pt-2.5">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-text">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <Scale className="h-3 w-3 shrink-0" />
                {judge.total_cases.toLocaleString()} {t("judges.cases")}
              </span>
              {judge.top_visa_subclasses[0] && (
                <span
                  className="inline-flex items-center gap-1 truncate"
                  title={judge.top_visa_subclasses[0].subclass}
                >
                  <Briefcase className="h-3 w-3 shrink-0" />
                  {judge.top_visa_subclasses[0].subclass}
                </span>
              )}
            </div>

            {/* Compare checkbox */}
            <label
              className="inline-flex shrink-0 cursor-pointer items-center gap-1"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                aria-label={`Compare ${displayName}`}
                checked={isSelected}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={() => onToggleCompare(judge.name)}
              />
              <span className="select-none text-[11px]">
                {t("judges.compare")}
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
