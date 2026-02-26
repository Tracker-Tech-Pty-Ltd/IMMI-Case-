import type { TrendEntry } from "@/types/case";

type RawTrendRow = Record<string, unknown>;

const RESERVED_KEYS = new Set(["year", "court_code", "case_count", "count"]);

function toSafeYear(value: unknown): number | null {
  const year = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(year)) return null;
  const rounded = Math.trunc(year);
  if (rounded < 1900 || rounded > 2100) return null;
  return rounded;
}

function toSafeCount(value: unknown): number | null {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(count)) return null;
  return Math.max(0, Math.trunc(count));
}

function upsertCount(
  byYear: Map<number, Record<string, number>>,
  year: number,
  key: string,
  count: number,
): void {
  if (!key || count <= 0) return;
  const row = byYear.get(year) ?? {};
  row[key] = (row[key] ?? 0) + count;
  byYear.set(year, row);
}

export function normalizeTrendEntries(rows: RawTrendRow[] = []): TrendEntry[] {
  const byYear = new Map<number, Record<string, number>>();

  for (const row of rows) {
    const year = toSafeYear(row.year);
    if (!year) continue;

    const courtCode =
      typeof row.court_code === "string" ? row.court_code.trim() : "";
    const rowCount = toSafeCount(row.case_count ?? row.count);

    // Row format: { year, court_code, case_count }
    if (courtCode && rowCount !== null) {
      upsertCount(byYear, year, courtCode, rowCount);
      continue;
    }

    // Pivot format: { year, ARTA: 10, FCA: 5, ... }
    for (const [key, value] of Object.entries(row)) {
      if (RESERVED_KEYS.has(key)) continue;
      const count = toSafeCount(value);
      if (count === null) continue;
      upsertCount(byYear, year, key, count);
    }
  }

  return [...byYear.entries()]
    .toSorted(([yearA], [yearB]) => yearA - yearB)
    .map(([year, values]) => ({ year, ...values }));
}

export function hasRenderableTrendSeries(rows: TrendEntry[]): boolean {
  return rows.some((row) =>
    Object.entries(row).some(
      ([key, value]) => key !== "year" && typeof value === "number" && value > 0,
    ),
  );
}

