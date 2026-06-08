export const COURT_CODES = [
  "AATA",
  "ARTA",
  "FCA",
  "FMCA",
  "FCCA",
  "FedCFamC2G",
  "HCA",
  "RRTA",
  "MRTA",
] as const;

export type CourtCode = (typeof COURT_CODES)[number];

export const COURT_MATRIX = {
  all: COURT_CODES,

  groupForHour(hour: number): CourtCode[] | null {
    if (hour === 2) return ["AATA", "ARTA", "HCA"];
    if (hour === 3) return ["FCA"];
    if (hour === 4) return ["FCCA", "FedCFamC2G", "FMCA"];
    if (hour === 5) return ["RRTA", "MRTA"];
    return null;
  },
};

export interface CourtInfo {
  name: string;
  path: string;
  immigrationOnly: boolean;
}

export const COURT_INFO: Record<CourtCode, CourtInfo> = {
  AATA: {
    name: "Administrative Appeals Tribunal",
    path: "/au/cases/cth/AATA/",
    immigrationOnly: false,
  },
  ARTA: {
    name: "Administrative Review Tribunal",
    path: "/au/cases/cth/ARTA/",
    immigrationOnly: true,
  },
  FCA: {
    name: "Federal Court of Australia",
    path: "/au/cases/cth/FCA/",
    immigrationOnly: false,
  },
  FMCA: {
    name: "Federal Magistrates Court of Australia",
    path: "/au/cases/cth/FMCA/",
    immigrationOnly: false,
  },
  FCCA: {
    name: "Federal Circuit Court of Australia",
    path: "/au/cases/cth/FCCA/",
    immigrationOnly: false,
  },
  FedCFamC2G: {
    name: "Federal Circuit and Family Court of Australia (Division 2)",
    path: "/au/cases/cth/FedCFamC2G/",
    immigrationOnly: false,
  },
  HCA: {
    name: "High Court of Australia",
    path: "/au/cases/cth/HCA/",
    immigrationOnly: false,
  },
  RRTA: {
    name: "Refugee Review Tribunal",
    path: "/au/cases/cth/RRTA/",
    immigrationOnly: true,
  },
  MRTA: {
    name: "Migration Review Tribunal",
    path: "/au/cases/cth/MRTA/",
    immigrationOnly: true,
  },
};

export const IMMIGRATION_KEYWORDS = [
  "minister for immigration",
  "department of home affairs",
  "migration act",
  "protection visa",
  "migration",
  "visa cancellation",
  "visa refusal",
  "deportation order",
  "character test",
  "refugee",
  "non-refoulement",
  "citizenship",
  "bridging visa",
  "student visa",
  "partner visa",
];

const MS_PER_DAY = 86_400_000;

export function isBiweeklyTick(ts: number): boolean {
  return Math.floor(ts / MS_PER_DAY / 14) % 2 === 0;
}

export function getDiscoveryYears(ts: number, lookbackYears: number): number[] {
  const currentYear = new Date(ts).getUTCFullYear();
  return Array.from({ length: Math.max(1, lookbackYears) }, (_, i) => currentYear - i);
}

export function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  min = 1,
  max = 10_000,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function normalizeForCaseId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/g, "");
}

export function isAllowedTargetTable(table: string): table is "immigration_cases" | "immigration_cases_staging" {
  return table === "immigration_cases" || table === "immigration_cases_staging";
}
