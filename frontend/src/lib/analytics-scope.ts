import type { AnalyticsFilterParams } from "@/types/case";

const COURTS = new Set(["AATA", "ARTA", "FCA", "FCCA", "FedCFamC2G", "HCA", "RRTA", "MRTA", "FMCA"]);

/** Validate the shared research scope before it reaches query hooks. */
export function parseAnalyticsScope(params: URLSearchParams): Required<Pick<AnalyticsFilterParams, "court" | "yearFrom" | "yearTo">> {
  const currentYear = new Date().getFullYear();
  const fromValue = params.get("year_from") ?? "";
  const toValue = params.get("year_to") ?? "";
  const from = /^\d{4}$/.test(fromValue) && Number(fromValue) >= 2000 && Number(fromValue) <= currentYear ? Number(fromValue) : 2000;
  const to = /^\d{4}$/.test(toValue) && Number(toValue) >= 2000 && Number(toValue) <= currentYear ? Number(toValue) : currentYear;
  const court = params.get("court") ?? "";
  return { court: COURTS.has(court) ? court : "", yearFrom: Math.min(from, to), yearTo: Math.max(from, to) };
}

export function buildAnalyticsHref(scope: AnalyticsFilterParams): string {
  const params = new URLSearchParams();
  if (scope.court) params.set("court", scope.court);
  if (scope.yearFrom !== undefined) params.set("year_from", String(scope.yearFrom));
  if (scope.yearTo !== undefined) params.set("year_to", String(scope.yearTo));
  return `/analytics?${params.toString()}`;
}
