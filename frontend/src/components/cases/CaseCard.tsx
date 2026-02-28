import { memo } from "react";
import { Calendar, User, Briefcase } from "lucide-react";
import { useTranslation } from "react-i18next";
import { CourtBadge } from "@/components/shared/CourtBadge";
import { OutcomeBadge } from "@/components/shared/OutcomeBadge";
import { BookmarkButton } from "@/components/shared/BookmarkButton";
import { getCourtColor } from "@/tokens/tokens";
import { cn } from "@/lib/utils";
import type { ImmigrationCase } from "@/types/case";

interface CaseCardProps {
  case_: ImmigrationCase;
  onClick: () => void;
  className?: string;
}

function CaseCardInner({ case_: c, onClick, className }: CaseCardProps) {
  // i18n support ready; currently all metadata comes from case data props
  useTranslation();
  const accentColor = getCourtColor(c.court_code) ?? "#6b7585";

  return (
    <div className={cn("relative h-full", className)}>
      <button
        type="button"
        onClick={onClick}
        className="group flex h-full min-h-[190px] w-full flex-col rounded-lg border border-border bg-card text-left shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"
        style={{ borderLeftWidth: "3px", borderLeftColor: accentColor }}
      >
        <div className="flex flex-1 flex-col p-4">
          {/* Top row: court badge + outcome */}
          <div className="mb-2 flex items-center justify-between gap-2 pr-6">
            <CourtBadge court={c.court_code} />
            {c.outcome && <OutcomeBadge outcome={c.outcome} />}
          </div>

          {/* Title */}
          <h3
            className="line-clamp-2 text-sm font-semibold text-foreground transition-colors group-hover:text-accent"
            title={c.title || c.citation}
          >
            {c.title || c.citation}
          </h3>

          {/* Citation */}
          {c.citation && (
            <p
              className="mt-1 truncate text-xs text-muted-text"
              title={c.citation}
            >
              {c.citation}
            </p>
          )}

          {/* Spacer pushes metadata to bottom */}
          <div className="mt-auto" />

          {/* Metadata section */}
          {(c.date || c.judges || c.visa_type) && (
            <div className="mt-3 border-t border-border-light pt-2.5">
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-text">
                {c.date && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3 shrink-0" />
                    {c.date}
                  </span>
                )}
                {c.judges && (
                  <span
                    className="inline-flex max-w-[180px] items-center gap-1 truncate"
                    title={c.judges}
                  >
                    <User className="h-3 w-3 shrink-0" />
                    {c.judges}
                  </span>
                )}
              </div>
              {c.visa_type && (
                <span
                  className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-text"
                  title={c.visa_type}
                >
                  <Briefcase className="h-3 w-3 shrink-0" />
                  {c.visa_type}
                </span>
              )}
            </div>
          )}
        </div>
      </button>
      <BookmarkButton
        caseId={c.case_id}
        caseTitle={c.title || c.citation || ""}
        caseCitation={c.citation || ""}
        courtCode={c.court_code}
        date={c.date || ""}
        size="sm"
        className="absolute right-2 top-2 z-10"
      />
    </div>
  );
}

export const CaseCard = memo(CaseCardInner);
