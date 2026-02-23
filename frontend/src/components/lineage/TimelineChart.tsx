import { memo, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import type { LineageData } from "@/lib/lineage-data";
import { courtColors } from "@/tokens/tokens";
import {
  filterChartData,
  normalizeToPercent,
  TRANSITION_YEARS,
  type ChartDataRow,
} from "@/lib/lineage-transforms";

const ALL_COURTS = [
  "MRTA",
  "RRTA",
  "AATA",
  "ARTA",
  "FMCA",
  "FCCA",
  "FedCFamC2G",
  "FCA",
  "HCA",
];

interface TimelineChartProps {
  data: LineageData;
  yearFrom?: number;
  yearTo?: number;
  hiddenCourts?: Set<string>;
  chartMode?: "bar" | "area";
  normalized?: boolean;
}

function transformToChartData(data: LineageData): ChartDataRow[] {
  const yearMap = new Map<number, ChartDataRow>();

  for (const lineage of data.lineages) {
    for (const court of lineage.courts) {
      for (const [yearStr, count] of Object.entries(court.case_count_by_year)) {
        const year = parseInt(yearStr, 10);
        if (!yearMap.has(year)) {
          yearMap.set(year, { year });
        }
        const entry = yearMap.get(year)!;
        entry[court.code] = count;
      }
    }
  }

  return Array.from(yearMap.values()).toSorted((a, b) => a.year - b.year);
}

function ChartTooltip({
  active,
  payload,
  label,
  normalized,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey: string;
    value: number;
    color: string;
    name: string;
  }>;
  label?: number;
  normalized?: boolean;
}) {
  const { t } = useTranslation();
  if (!active || !payload) return null;
  const nonZero = payload.filter(
    (p) => typeof p.value === "number" && p.value > 0,
  );
  if (nonZero.length === 0) return null;
  const total = nonZero.reduce((s, p) => s + Number(p.value), 0);
  const suffix = normalized ? "%" : "";

  return (
    <div
      style={{
        backgroundColor: "var(--color-background-card)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius)",
        color: "var(--color-text)",
        padding: "10px 14px",
        fontSize: 12,
        minWidth: 160,
      }}
    >
      <p style={{ fontWeight: 700, marginBottom: 6 }}>{label}</p>
      {nonZero.map((entry) => (
        <div
          key={entry.dataKey}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            margin: "2px 0",
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              backgroundColor: entry.color,
              flexShrink: 0,
            }}
          />
          <span style={{ fontFamily: "monospace", color: entry.color }}>
            {entry.name}
          </span>
          <span
            style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}
          >
            {normalized
              ? `${Number(entry.value).toFixed(1)}%`
              : Number(entry.value).toLocaleString()}
          </span>
        </div>
      ))}
      {nonZero.length > 1 && !normalized && (
        <div
          style={{
            marginTop: 6,
            paddingTop: 6,
            borderTop: "1px solid var(--color-border)",
            fontWeight: 600,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>{t("analytics.total")}</span>
          <span>
            {total.toLocaleString()}
            {suffix}
          </span>
        </div>
      )}
    </div>
  );
}

function TimelineChartInner({
  data,
  yearFrom,
  yearTo,
  hiddenCourts,
  chartMode = "bar",
  normalized = false,
}: TimelineChartProps) {
  const navigate = useNavigate();

  const rawChartData = useMemo(() => transformToChartData(data), [data]);

  const chartData = useMemo(() => {
    const hidden = hiddenCourts ?? new Set<string>();
    const from = yearFrom ?? data.year_range[0];
    const to = yearTo ?? data.year_range[1];
    const filtered = filterChartData(rawChartData, from, to, hidden);
    return normalized ? normalizeToPercent(filtered) : filtered;
  }, [
    rawChartData,
    yearFrom,
    yearTo,
    hiddenCourts,
    normalized,
    data.year_range,
  ]);

  if (!chartData || chartData.length === 0) return null;

  const courtSet = new Set<string>();
  for (const entry of chartData) {
    for (const key of Object.keys(entry)) {
      if (key !== "year") courtSet.add(key);
    }
  }
  const courts = ALL_COURTS.filter((c) => courtSet.has(c));

  const handleBarClick = (courtCode: string, year: number) => {
    navigate(`/cases?court=${courtCode}&year=${year}`);
  };

  const sharedAxes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
      <XAxis
        dataKey="year"
        tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
        tickFormatter={(v: number) => String(v)}
      />
      <YAxis
        tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
        tickFormatter={normalized ? (v: number) => `${v}%` : undefined}
      />
      <Tooltip
        content={(props) => (
          <ChartTooltip
            {...(props as unknown as Parameters<typeof ChartTooltip>[0])}
            normalized={normalized}
          />
        )}
      />
      {TRANSITION_YEARS.map((transition) => (
        <ReferenceLine
          key={transition.year}
          x={transition.year}
          stroke="var(--color-accent)"
          strokeDasharray="4 4"
          strokeOpacity={0.6}
          label={{
            value: transition.label,
            position: "top",
            fill: "var(--color-text-secondary)",
            fontSize: 9,
          }}
        />
      ))}
    </>
  );

  if (chartMode === "area") {
    return (
      <ResponsiveContainer width="100%" height={400}>
        <AreaChart
          data={chartData}
          margin={{ top: 20, right: 20, bottom: 5, left: 0 }}
        >
          {sharedAxes}
          {courts.map((court) => (
            <Area
              key={court}
              type="monotone"
              dataKey={court}
              stackId="stack"
              fill={courtColors[court] ?? "#8b8680"}
              stroke={courtColors[court] ?? "#8b8680"}
              fillOpacity={0.7}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart
        data={chartData}
        margin={{ top: 20, right: 20, bottom: 5, left: 0 }}
      >
        {sharedAxes}
        {courts.map((court) => (
          <Bar
            key={court}
            dataKey={court}
            stackId="stack"
            fill={courtColors[court] ?? "#8b8680"}
            cursor="pointer"
            onClick={(d: unknown) => {
              const row = d as Record<string, unknown>;
              if (row && typeof row.year === "number") {
                handleBarClick(court, row.year);
              }
            }}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${court}-${index}`}
                style={{ cursor: entry[court] ? "pointer" : "default" }}
              />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export const TimelineChart = memo(TimelineChartInner);
