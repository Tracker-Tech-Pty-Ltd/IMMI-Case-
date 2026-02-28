import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Scale, Building2 } from "lucide-react";
import type {
  LineageData,
  CourtLineage,
  CourtMetadata,
} from "@/lib/lineage-data";
import { getCourtColor } from "@/tokens/tokens";
import { cn } from "@/lib/utils";

// ── Timeline constants ─────────────────────────────────────────

const TIMELINE_START = 2000;
const TIMELINE_END = new Date().getFullYear() + 1;
const TIMELINE_SPAN = TIMELINE_END - TIMELINE_START;

const AXIS_YEARS = [2000, 2005, 2010, 2015, 2020, 2025];

function yearToPercent(year: number): number {
  return Math.min(
    100,
    Math.max(0, ((year - TIMELINE_START) / TIMELINE_SPAN) * 100),
  );
}

function sumCases(court: CourtMetadata): number {
  return Object.values(court.case_count_by_year).reduce((a, b) => a + b, 0);
}

function formatCount(n: number): string {
  return n >= 10_000
    ? `${(n / 1000).toFixed(0)}k`
    : n >= 1_000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n);
}

// ── Year axis ──────────────────────────────────────────────────

function YearAxis() {
  return (
    <div className="flex items-center gap-3 mb-0.5">
      <div className="w-[88px] shrink-0" />
      <div className="relative flex-1 h-5">
        <div className="absolute bottom-0 left-0 right-0 border-b border-border" />
        {AXIS_YEARS.map((year) => {
          const pct = yearToPercent(year);
          return (
            <div
              key={year}
              className="absolute bottom-0 flex flex-col items-center"
              style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
            >
              <div className="h-1.5 w-px bg-border" />
              <span className="text-[9px] font-medium text-muted-text leading-none mt-0.5">
                {year}
              </span>
            </div>
          );
        })}
      </div>
      <div className="w-[72px] shrink-0" />
    </div>
  );
}

// ── Gantt row ──────────────────────────────────────────────────

interface GanttRowProps {
  court: CourtMetadata;
}

function GanttRow({ court }: GanttRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const totalCases = useMemo(() => sumCases(court), [court]);
  const color = getCourtColor(court.code) ?? "#8b8680";
  const isOngoing = court.years[1] === 9999;
  const endYear = isOngoing ? TIMELINE_END : court.years[1];
  const leftPct = yearToPercent(court.years[0]);
  const rightPct = yearToPercent(endYear);
  const widthPct = rightPct - leftPct;
  const nowLabel = t("lineage.now", { defaultValue: "now" });

  const handleClick = () => {
    navigate(`/cases?court=${court.code}`);
  };

  return (
    <div className="flex items-center gap-3 py-0.5">
      <div className="w-[88px] shrink-0 text-right">
        <span className="font-mono text-[11px] font-bold" style={{ color }}>
          {court.code}
        </span>
      </div>

      <div className="relative flex-1 h-6">
        <div className="absolute inset-y-1 left-0 right-0 rounded-sm bg-surface" />

        <div
          className={cn(
            "absolute inset-y-0 flex items-center overflow-hidden rounded-sm cursor-pointer transition-opacity hover:opacity-100",
            isOngoing && "rounded-r-none",
          )}
          style={{
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            backgroundColor: color,
            opacity: 0.8,
          }}
          title={`${court.code}: ${court.years[0]}–${isOngoing ? nowLabel : court.years[1]} · ${totalCases.toLocaleString()}`}
          onClick={handleClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleClick();
          }}
        >
          {widthPct > 8 && (
            <span className="pl-2 text-[9px] font-semibold text-white/90 truncate pr-1 select-none">
              {formatCount(totalCases)}
            </span>
          )}
        </div>

        {isOngoing && (
          <div
            className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-success shadow-[0_0_0_3px] shadow-success/20 animate-pulse"
            style={{ left: `${rightPct - 0.5}%` }}
          />
        )}
      </div>

      <div className="w-[72px] shrink-0 text-[10px] text-muted-text tabular-nums">
        {court.years[0]}–{isOngoing ? nowLabel : court.years[1]}
      </div>
    </div>
  );
}

// ── Transition events ──────────────────────────────────────────

interface TransitionEventsProps {
  lineage: CourtLineage;
}

function TransitionEvents({ lineage }: TransitionEventsProps) {
  if (!lineage.transitions?.length) return null;
  return (
    <div className="mt-3 ml-[100px] space-y-2">
      {lineage.transitions.map((tr) => (
        <div
          key={`${tr.from}-${tr.to}`}
          className="flex items-start gap-2.5 rounded-md border border-border-light bg-surface px-3 py-2"
        >
          <span className="mt-0.5 shrink-0 rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent">
            {tr.year}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">
              <span className="font-mono text-accent">{tr.from}</span>
              <span className="mx-1 text-muted-text">→</span>
              <span className="font-mono text-accent">{tr.to}</span>
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-text">
              {tr.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Lineage group ──────────────────────────────────────────────

interface LineageGroupProps {
  lineage: CourtLineage;
  hiddenCourts?: Set<string>;
}

function LineageGroup({ lineage, hiddenCourts }: LineageGroupProps) {
  const { t } = useTranslation();
  const Icon = lineage.id === "lower-court" ? Scale : Building2;

  const visibleCourts = useMemo(
    () =>
      hiddenCourts
        ? lineage.courts.filter((c) => !hiddenCourts.has(c.code))
        : lineage.courts,
    [lineage, hiddenCourts],
  );

  const totalCases = useMemo(
    () =>
      visibleCourts.reduce(
        (sum, c) =>
          sum + Object.values(c.case_count_by_year).reduce((a, b) => a + b, 0),
        0,
      ),
    [visibleCourts],
  );

  if (visibleCourts.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-accent" />
        <span className="text-xs font-semibold text-foreground">
          {lineage.name}
        </span>
        <span className="ml-0.5 rounded-full bg-surface px-2 py-0.5 text-[10px] text-muted-text">
          {totalCases.toLocaleString()} {t("chart.cases")}
        </span>
      </div>

      <div>
        {visibleCourts.map((court) => (
          <GanttRow key={court.code} court={court} />
        ))}
      </div>

      <TransitionEvents lineage={lineage} />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────

interface LineageExplainerProps {
  data: LineageData;
  hiddenCourts?: Set<string>;
  groupFilter?: string;
}

export function LineageExplainer({
  data,
  hiddenCourts,
  groupFilter,
}: LineageExplainerProps) {
  const { t } = useTranslation();

  const visibleLineages = useMemo(() => {
    const lineages = data?.lineages ?? [];
    if (!groupFilter || groupFilter === "all") return lineages;
    if (groupFilter === "independent") return [];
    return lineages.filter((l) => l.id === groupFilter);
  }, [data?.lineages, groupFilter]);

  if (!data?.lineages?.length) return null;

  if (visibleLineages.length === 0 && groupFilter === "independent") {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="mb-4 font-heading text-sm font-semibold text-foreground">
        {t("lineage.explainer_title")}
      </h3>

      <YearAxis />

      <div className="mt-1 space-y-5">
        {visibleLineages.map((lineage) => (
          <LineageGroup
            key={lineage.id}
            lineage={lineage}
            hiddenCourts={hiddenCourts}
          />
        ))}
      </div>
    </div>
  );
}
