import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Editorial layout keeps direct page selection and complete result counts. */
export function NewsPagination({ page, totalPages, totalItems, pageSize, onPageChange }: {
  page: number; totalPages: number; totalItems: number; pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  return <nav className="news-pagination codex-pagination relative flex items-center justify-between gap-2 border-t border-border-light pt-2 font-data text-sm" aria-label={t("pagination.navigation", { defaultValue: "Pagination" })}>
    <p role="status" aria-live="polite" className="sr-only">{t("pagination.showing", { start, end, total: totalItems })}</p>
    <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label={t("pagination.previous_page", { defaultValue: "Go to previous page" })} className="codex-control inline-flex shrink-0 items-center gap-1 rounded-sm border border-border-light bg-card px-3 text-muted-text hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">{t("news.previous", { defaultValue: "Previous" })}</span></button>
    <select value={page} aria-label={t("news.choose_page", { defaultValue: "Choose news page" })} onChange={(event) => onPageChange(Number(event.target.value))} className="codex-control min-w-0 appearance-none rounded-sm bg-transparent px-2 text-center text-secondary-text">
      {Array.from({ length: totalPages }, (_, index) => <option key={index + 1} value={index + 1}>{t("news.page_status", { defaultValue: "Page {{page}} of {{total}}", page: index + 1, total: totalPages })}</option>)}
    </select>
    <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label={t("pagination.next_page", { defaultValue: "Go to next page" })} className="codex-control inline-flex shrink-0 items-center gap-1 rounded-sm border border-border-light bg-card px-3 text-muted-text hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"><span className="hidden sm:inline">{t("news.next", { defaultValue: "Next" })}</span><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
  </nav>;
}
