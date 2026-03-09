import { memo } from "react";
import { useTranslation } from "react-i18next";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { TrendEntry } from "@/types/case";
import { getCourtColor } from "@/tokens/tokens";

// Top courts to show in the trend chart (by typical volume)
const TOP_COURTS = [
  "AATA",
  "ARTA",
  "FCA",
  "FCCA",
  "FedCFamC2G",
  "MRTA",
  "RRTA",
  "FMCA",
  "HCA",
];

interface TrendChartProps {
  data: TrendEntry[];
}

function TrendChartInner({ data }: TrendChartProps) {
  const { t } = useTranslation();
  if (!data || data.length === 0) return null;

  // Discover which courts appear in the data
  const courtSet = new Set<string>();
  for (const entry of data) {
    for (const key of Object.keys(entry)) {
      if (key !== "year") courtSet.add(key);
    }
  }

  // Order courts by TOP_COURTS preference, then alphabetically
  const courts = TOP_COURTS.filter((c) => courtSet.has(c));
  for (const c of [...courtSet].toSorted()) {
    if (!courts.includes(c)) courts.push(c);
  }

  // Fill missing court values with 0 for smooth stacking
  const normalizedData = data.map((entry) => {
    const row: Record<string, number> = { year: entry.year };
    for (const court of courts) {
      row[court] = (entry[court] as number) || 0;
    }
    return row;
  });

  return (
    <div className="h-[300px] min-w-0 flex-1">
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart
          data={normalizedData}
          margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }}
            tickFormatter={(v: number) => String(v)}
          />
          <YAxis tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload) return null;
              const nonZero = payload.filter(
                (p) => typeof p.value === "number" && p.value > 0,
              );
              if (nonZero.length === 0) return null;
              return (
                <div
                  style={{
                    backgroundColor: "var(--color-background-card)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius)",
                    color: "var(--color-text)",
                    padding: "8px 12px",
                    fontSize: 12,
                  }}
                >
                  <p style={{ fontWeight: 600, marginBottom: 4 }}>
                    {t("filters.date")}: {label}
                  </p>
                  {nonZero.map((entry) => (
                    <p
                      key={entry.dataKey as string}
                      style={{ color: entry.color, margin: "2px 0" }}
                    >
                      {entry.name}: {Number(entry.value).toLocaleString()}
                    </p>
                  ))}
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            wrapperStyle={{
              fontSize: 11,
              color: "var(--color-text-secondary)",
            }}
          />
          {courts.map((court) => (
            <Area
              key={court}
              type="monotone"
              dataKey={court}
              stackId="1"
              stroke={getCourtColor(court) ?? "#8b8680"}
              fill={getCourtColor(court) ?? "#8b8680"}
              fillOpacity={0.6}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export const TrendChart = memo(TrendChartInner);
