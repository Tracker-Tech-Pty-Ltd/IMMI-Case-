import { useSyncExternalStore } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CaseCard } from "@/components/cases/CaseCard";
import { CourtBadge } from "@/components/shared/CourtBadge";
import { OutcomeBadge } from "@/components/shared/OutcomeBadge";
import { NatureBadge } from "@/components/shared/NatureBadge";
import { cn } from "@/lib/utils";
import type { ImmigrationCase } from "@/types/case";

const DESKTOP_QUERY = "(min-width: 768px)"; // Tailwind `md`

function subscribeToDesktopQuery(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

// jsdom does not implement matchMedia, and neither does SSR. Default to
// desktop so the table branch (and its tests) behave exactly as before.
function isDesktopViewport(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

function formatDateCompact(date: string): string {
  if (!date) return "";
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export interface CasesTableProps {
  cases: ImmigrationCase[];
  viewMode: "table" | "cards";
  selected: Set<string>;
  clampedFocusedIdx: number;
  tableRef: React.RefObject<HTMLTableSectionElement | null>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onSetFocusedIdx: (idx: number) => void;
}

export function CasesTable({
  cases,
  viewMode,
  selected,
  clampedFocusedIdx,
  tableRef,
  onToggleSelect,
  onToggleAll,
  onSetFocusedIdx,
}: CasesTableProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isDesktop = useSyncExternalStore(
    subscribeToDesktopQuery,
    isDesktopViewport,
    () => true,
  );

  if (viewMode === "cards") {
    return (
      <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cases.map((c) => (
          <CaseCard
            key={c.case_id}
            case_={c}
            onClick={() => navigate(`/cases/${c.case_id}`)}
            className="h-full"
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {!isDesktop && (
        <>
          <div className="md:hidden rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-text">
            {t("cases.mobile_table_note", {
              defaultValue:
                "Table view is optimized for larger screens. Showing card view on mobile for easier reading.",
            })}
          </div>
          <div className="grid auto-rows-fr gap-4 md:hidden">
            {cases.map((c) => (
              <CaseCard
                key={c.case_id}
                case_={c}
                onClick={() => navigate(`/cases/${c.case_id}`)}
                className="h-full"
              />
            ))}
          </div>
        </>
      )}
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
        <table data-testid="cases-table" className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="w-10 px-2 py-2.5 text-left">
                <input
                  data-testid="cases-select-all"
                  type="checkbox"
                  checked={selected.size === cases.length && cases.length > 0}
                  onChange={onToggleAll}
                  className="rounded"
                  aria-label={t("cases.select_all", {
                    defaultValue: "Select all visible cases",
                  })}
                />
              </th>
              <th className="px-2 py-2.5 text-left font-medium text-muted-text">
                {t("cases.case_title")}
              </th>
              <th className="whitespace-nowrap px-2 py-2.5 text-left font-medium text-muted-text">
                {t("cases.citation")}
              </th>
              <th className="whitespace-nowrap px-2 py-2.5 text-left font-medium text-muted-text">
                {t("cases.court")}
              </th>
              <th className="whitespace-nowrap px-2 py-2.5 text-left font-medium text-muted-text">
                <span className="block leading-tight">{t("cases.date")}</span>
                <span className="block text-[9px] font-normal text-muted-text leading-tight">
                  {t("cases.date", { defaultValue: "decision" })} /{" "}
                  {t("cases.hearing_date")}
                </span>
              </th>
              <th className="whitespace-nowrap px-2 py-2.5 text-left font-medium text-muted-text">
                {t("cases.country_of_origin")}
              </th>
              <th className="whitespace-nowrap px-2 py-2.5 text-left font-medium text-muted-text">
                {t("cases.outcome")}
              </th>
              <th className="whitespace-nowrap px-2 py-2.5 text-left font-medium text-muted-text">
                {t("cases.nature")}
              </th>
            </tr>
          </thead>
          <tbody ref={tableRef}>
            {cases.map((c, i) => (
              <tr
                key={c.case_id}
                data-testid="cases-row"
                data-case-id={c.case_id}
                className={cn(
                  "border-b border-border-light transition-colors cursor-pointer font-[var(--font-data)]",
                  clampedFocusedIdx === i
                    ? "bg-accent-muted"
                    : "hover:bg-surface/50",
                  selected.has(c.case_id) && "bg-accent-muted/50",
                )}
                onClick={() => navigate(`/cases/${c.case_id}`)}
                onFocus={() => onSetFocusedIdx(i)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/cases/${c.case_id}`);
                  }
                }}
                tabIndex={0}
                aria-selected={selected.has(c.case_id)}
              >
                <td
                  className="relative w-10 px-2 py-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link
                    to={`/cases/${c.case_id}`}
                    aria-label={`Open case ${c.citation || c.case_id}`}
                    className="absolute inset-0 z-0"
                    tabIndex={-1}
                  />
                  <input
                    data-testid="cases-row-checkbox"
                    data-case-id={c.case_id}
                    type="checkbox"
                    checked={selected.has(c.case_id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggleSelect(c.case_id)}
                    className="relative z-10 rounded"
                    aria-label={t("cases.select_case", {
                      defaultValue: "Select case {{citation}}",
                      citation: c.citation || c.case_id,
                    })}
                  />
                </td>
                <td
                  data-testid="cases-row-title"
                  data-case-id={c.case_id}
                  className="max-w-xs px-2 py-2"
                >
                  <span
                    className="block truncate font-medium text-foreground"
                    title={c.title || c.citation}
                  >
                    {c.title || c.citation}
                  </span>
                  {(c.applicant_name || c.judges) && (
                    <span
                      className="block truncate text-xs text-muted-text"
                      title={c.applicant_name || c.judges}
                    >
                      {c.applicant_name
                        ? `${t("cases.applicant")}: ${c.applicant_name}`
                        : c.judges}
                    </span>
                  )}
                </td>
                <td
                  data-testid="cases-row-citation"
                  data-case-id={c.case_id}
                  className="whitespace-nowrap px-2 py-2 text-xs text-muted-text"
                  title={c.citation}
                >
                  {c.citation}
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  <CourtBadge court={c.court_code} />
                </td>
                <td
                  className="whitespace-nowrap px-2 py-2 text-xs text-muted-text"
                  title={
                    c.hearing_date && c.hearing_date !== c.date
                      ? `${t("cases.date")}: ${c.date}\n${t("cases.hearing_date")}: ${c.hearing_date}`
                      : c.date
                  }
                >
                  <span className="block leading-tight">
                    {formatDateCompact(c.date)}
                  </span>
                  {c.hearing_date && c.hearing_date !== c.date && (
                    <span className="block text-[9px] leading-tight text-muted-text/70">
                      ↳ {formatDateCompact(c.hearing_date)}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-xs text-muted-text">
                  {c.country_of_origin || ""}
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  <OutcomeBadge outcome={c.outcome} />
                </td>
                <td className="whitespace-nowrap px-2 py-2">
                  <NatureBadge nature={c.case_nature} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
