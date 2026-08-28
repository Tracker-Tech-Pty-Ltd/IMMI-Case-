import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: PaginationProps) {
  const { t } = useTranslation();

  if (totalPages <= 1) return null;

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  const pages = getVisiblePages(currentPage, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p
        role="status"
        aria-live="polite"
        className="w-full text-sm text-muted-text sm:w-auto"
      >
        {t("pagination.showing", { start, end, total: totalItems })}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="rounded-md border border-border p-1.5 text-muted-text hover:bg-surface disabled:opacity-40"
          aria-label={t("pagination.previous_page", {
            defaultValue: "Go to previous page",
          })}
          title={t("pagination.previous_page", {
            defaultValue: "Go to previous page",
          })}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {pages.map((p, i) =>
          p === "..." ? (
            <span
              key={`ellipsis-${i}`}
              className="px-1 text-sm text-muted-text"
            >
              {t("pagination.ellipsis")}
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p as number)}
              className={cn(
                "min-w-[32px] rounded-md px-2 py-1.5 text-sm",
                p === currentPage
                  ? "bg-accent text-white font-medium"
                  : "text-muted-text hover:bg-surface",
              )}
              aria-label={t("pagination.page_number", {
                defaultValue: "Go to page {{page}}",
                page: p,
              })}
              aria-current={p === currentPage ? "page" : undefined}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="rounded-md border border-border p-1.5 text-muted-text hover:bg-surface disabled:opacity-40"
          aria-label={t("pagination.next_page", {
            defaultValue: "Go to next page",
          })}
          title={t("pagination.next_page", {
            defaultValue: "Go to next page",
          })}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function getVisiblePages(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | "...")[] = [1];
  if (current > 3) pages.push("...");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}
