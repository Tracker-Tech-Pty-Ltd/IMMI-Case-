import { memo, useMemo } from "react";
import { Play, Edit2, Trash2, Calendar, Filter } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SavedSearch } from "@/types/case";

interface SavedSearchCardProps {
  search: SavedSearch;
  onExecute: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function SavedSearchCardInner({
  search,
  onExecute,
  onEdit,
  onDelete,
}: SavedSearchCardProps) {
  const { t } = useTranslation();

  // Generate filter summary from CaseFilters
  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    const { filters } = search;

    if (filters.court) parts.push(filters.court);
    if (filters.year) parts.push(filters.year.toString());
    if (filters.visa_type) parts.push(filters.visa_type);
    if (filters.nature) parts.push(filters.nature);
    if (filters.keyword) parts.push(`"${filters.keyword}"`);
    if (filters.source) parts.push(filters.source);
    if (filters.tag) parts.push(filters.tag);

    return parts.length > 0 ? parts.join(" • ") : "No filters";
  }, [search.filters]);

  // Format last executed date
  const lastExecutedText = useMemo(() => {
    if (!search.lastExecutedAt) return null;
    const date = new Date(search.lastExecutedAt);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, [search.lastExecutedAt]);

  return (
    <div className="group flex min-h-[140px] flex-col rounded-lg border border-border bg-card shadow-xs transition-all duration-150 hover:shadow-md">
      <div className="flex flex-1 flex-col p-4">
        {/* Top row: name + result count badge */}
        <div className="mb-2 flex items-start justify-between gap-2">
          <h3
            className="line-clamp-2 text-sm font-semibold text-foreground"
            title={search.name}
          >
            {search.name}
          </h3>
          {search.resultCount !== undefined && (
            <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
              {search.resultCount}
            </span>
          )}
        </div>

        {/* Filter summary */}
        <div className="mb-3 flex items-start gap-1.5 text-xs text-muted-text">
          <Filter className="mt-0.5 h-3 w-3 shrink-0" />
          <p className="line-clamp-2 flex-1" title={filterSummary}>
            {filterSummary}
          </p>
        </div>

        {/* Spacer pushes metadata/actions to bottom */}
        <div className="mt-auto" />

        {/* Metadata section */}
        {lastExecutedText && (
          <div className="mb-3 border-t border-border-light pt-2.5">
            <span className="inline-flex items-center gap-1 text-xs text-muted-text">
              <Calendar className="h-3 w-3 shrink-0" />
              Last run: {lastExecutedText}
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onExecute}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-dark"
            title={t("saved_searches.execute_button", "Execute Search")}
          >
            <Play className="h-3 w-3" />
            Execute
          </button>
          <button
            onClick={onEdit}
            className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/5"
            title={t("saved_searches.edit_button", "Edit Search")}
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20"
            title={t("saved_searches.delete_button", "Delete Search")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export const SavedSearchCard = memo(SavedSearchCardInner);
