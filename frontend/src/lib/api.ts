import type {
  ImmigrationCase,
  CaseFilters,
  PaginatedCases,
  DashboardStats,
  TrendEntry,
  FilterOptions,
  JobStatus,
  AnalyticsFilterParams,
  AnalyticsAdvancedFilterOptions,
  OutcomeData,
  JudgeEntry,
  ConceptEntry,
  NatureOutcomeData,
  SuccessRateData,
  JudgeLeaderboardEntry,
  JudgeProfile,
  JudgeBio,
  ConceptEffectivenessData,
  ConceptCooccurrenceData,
  ConceptTrendData,
  FlowMatrixData,
  MonthlyTrendsData,
  VisaFamiliesData,
} from "@/types/case";
import type { LineageData } from "@/lib/lineage-data";

let csrfToken: string | null = null;
const API_TIMEOUT_MS = 20_000;
const ANALYTICS_TIMEOUT_MS = 10_000;
const FILTER_OPTIONS_TIMEOUT_MS = 8_000;
const DASHBOARD_STATS_TIMEOUT_MS = 12_000;
const DASHBOARD_TRENDS_TIMEOUT_MS = 8_000;
const DASHBOARD_FALLBACK_COUNT_TIMEOUT_MS = 6_000;
const DASHBOARD_CACHE_TTL_MS = 5 * 60_000;
const DASHBOARD_STATS_CACHE_KEY = "immi:dashboard:stats:v2";
const DASHBOARD_TRENDS_CACHE_KEY = "immi:dashboard:trends:v2";

async function fetchCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await fetch("/api/v1/csrf-token");
  const data = await res.json();
  csrfToken = data.csrf_token;
  return csrfToken!;
}

interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function apiFetch<T>(
  url: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { timeoutMs = API_TIMEOUT_MS, ...requestOptions } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(requestOptions.headers as Record<string, string>),
  };

  if (requestOptions.method && requestOptions.method !== "GET") {
    headers["X-CSRFToken"] = await fetchCsrfToken();
  }

  const controller = new AbortController();
  const upstreamSignal = requestOptions.signal;
  let timedOut = false;

  const onUpstreamAbort = () => {
    controller.abort();
  };

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", onUpstreamAbort, { once: true });
    }
  }

  const timeoutHandle = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      ...requestOptions,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error) && timedOut) {
      throw new Error(`Request timeout after ${timeoutMs / 1000} seconds`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutHandle);
    if (upstreamSignal) {
      upstreamSignal.removeEventListener("abort", onUpstreamAbort);
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `API error: ${res.status}`);
  }

  return res.json();
}

// ─── Shared filter query string builder ───────────────────────
const CURRENT_YEAR = new Date().getFullYear();

function createEmptyDashboardStats(totalCases = 0): DashboardStats {
  return {
    total_cases: totalCases,
    with_full_text: 0,
    courts: {},
    years: {},
    natures: {},
    visa_subclasses: {},
    sources: {},
    recent_cases: [],
  };
}

function buildDashboardCacheKey(
  baseKey: string,
  filters?: AnalyticsFilterParams,
): string {
  const keyObject = {
    court: filters?.court ?? "",
    yearFrom: filters?.yearFrom ?? 0,
    yearTo: filters?.yearTo ?? 0,
    caseNatures: (filters?.caseNatures ?? []).slice().sort(),
    visaSubclasses: (filters?.visaSubclasses ?? []).slice().sort(),
    outcomeTypes: (filters?.outcomeTypes ?? []).slice().sort(),
  };
  return `${baseKey}:${JSON.stringify(keyObject)}`;
}

function readCache<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; data?: T };
    if (!parsed.ts || !parsed.data) return null;
    if (Date.now() - parsed.ts > DASHBOARD_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        ts: Date.now(),
        data,
      }),
    );
  } catch {
    // no-op
  }
}

function buildCaseCountFallbackFilters(
  filters?: AnalyticsFilterParams,
): CaseFilters {
  const caseFilters: CaseFilters = {};
  if (filters?.court) {
    caseFilters.court = filters.court;
  }
  if (
    typeof filters?.yearFrom === "number" &&
    typeof filters?.yearTo === "number" &&
    filters.yearFrom === filters.yearTo
  ) {
    caseFilters.year = filters.yearFrom;
  }
  return caseFilters;
}

function appendAdvancedFilters(
  params: URLSearchParams,
  filters?: AnalyticsFilterParams,
): void {
  if (!filters) return;
  if (filters.caseNatures?.length)
    params.set("case_natures", filters.caseNatures.join(","));
  if (filters.visaSubclasses?.length)
    params.set("visa_subclasses", filters.visaSubclasses.join(","));
  if (filters.outcomeTypes?.length)
    params.set("outcome_types", filters.outcomeTypes.join(","));
}

function buildFilterParams(filters?: AnalyticsFilterParams): string {
  if (!filters) return "";
  const params = new URLSearchParams();
  if (filters.court) params.set("court", filters.court);
  if (filters.yearFrom && filters.yearFrom > 2000)
    params.set("year_from", String(filters.yearFrom));
  if (filters.yearTo && filters.yearTo < CURRENT_YEAR)
    params.set("year_to", String(filters.yearTo));
  appendAdvancedFilters(params, filters);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function appendAnalyticsFilters(
  params: URLSearchParams,
  filters?: AnalyticsFilterParams,
): void {
  if (!filters) return;
  if (filters.court) params.set("court", filters.court);
  if (filters.yearFrom && filters.yearFrom > 2000) {
    params.set("year_from", String(filters.yearFrom));
  }
  if (filters.yearTo && filters.yearTo < CURRENT_YEAR) {
    params.set("year_to", String(filters.yearTo));
  }
  appendAdvancedFilters(params, filters);
}

// ─── Dashboard ─────────────────────────────────────────────────
export function fetchStats(
  filters?: AnalyticsFilterParams,
): Promise<DashboardStats> {
  const cacheKey = buildDashboardCacheKey(DASHBOARD_STATS_CACHE_KEY, filters);

  return apiFetch<DashboardStats>(`/api/v1/stats${buildFilterParams(filters)}`, {
    timeoutMs: DASHBOARD_STATS_TIMEOUT_MS,
  })
    .then((stats) => {
      writeCache(cacheKey, stats);
      return stats;
    })
    .catch(async () => {
      const cached = readCache<DashboardStats>(cacheKey);
      if (cached) return cached;

      const fallbackFilters = buildCaseCountFallbackFilters(filters);
      try {
        const count = await fetchCaseCount(fallbackFilters, "planned", {
          timeoutMs: DASHBOARD_FALLBACK_COUNT_TIMEOUT_MS,
        });
        return createEmptyDashboardStats(count.total);
      } catch {
        return createEmptyDashboardStats();
      }
    });
}

export function fetchTrends(
  filters?: AnalyticsFilterParams,
): Promise<{ trends: TrendEntry[] }> {
  const cacheKey = buildDashboardCacheKey(DASHBOARD_TRENDS_CACHE_KEY, filters);

  return apiFetch<{ trends: TrendEntry[] }>(
    `/api/v1/stats/trends${buildFilterParams(filters)}`,
    { timeoutMs: DASHBOARD_TRENDS_TIMEOUT_MS },
  )
    .then((data) => {
      writeCache(cacheKey, data);
      return data;
    })
    .catch(() => readCache<{ trends: TrendEntry[] }>(cacheKey) ?? { trends: [] });
}

// ─── Court Lineage ─────────────────────────────────────────────
export function fetchLineageData(): Promise<LineageData> {
  return apiFetch("/api/v1/court-lineage", {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

// ─── Analytics ─────────────────────────────────────────────────
export function fetchOutcomes(
  filters?: AnalyticsFilterParams,
): Promise<OutcomeData> {
  return apiFetch(`/api/v1/analytics/outcomes${buildFilterParams(filters)}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

export function fetchAnalyticsFilterOptions(
  filters: Pick<AnalyticsFilterParams, "court" | "yearFrom" | "yearTo"> = {},
): Promise<AnalyticsAdvancedFilterOptions> {
  const qs = new URLSearchParams();
  if (filters.court) {
    qs.set("court", filters.court);
  }
  if (filters.yearFrom && filters.yearFrom > 2000) {
    qs.set("year_from", String(filters.yearFrom));
  }
  if (filters.yearTo && filters.yearTo < CURRENT_YEAR) {
    qs.set("year_to", String(filters.yearTo));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch(`/api/v1/analytics/filter-options${suffix}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

export function fetchJudges(
  filters?: AnalyticsFilterParams,
  limit = 20,
): Promise<{ judges: JudgeEntry[] }> {
  const qs = buildFilterParams(filters);
  const sep = qs ? "&" : "?";
  return apiFetch(`/api/v1/analytics/judges${qs}${sep}limit=${limit}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

export function fetchLegalConcepts(
  filters?: AnalyticsFilterParams,
  limit = 20,
): Promise<{ concepts: ConceptEntry[] }> {
  const qs = buildFilterParams(filters);
  const sep = qs ? "&" : "?";
  return apiFetch(`/api/v1/analytics/legal-concepts${qs}${sep}limit=${limit}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

export function fetchNatureOutcome(
  filters?: AnalyticsFilterParams,
): Promise<NatureOutcomeData> {
  return apiFetch(
    `/api/v1/analytics/nature-outcome${buildFilterParams(filters)}`,
    { timeoutMs: ANALYTICS_TIMEOUT_MS },
  );
}

export function fetchSuccessRate(
  params: AnalyticsFilterParams & {
    visa_subclass?: string;
    case_nature?: string;
    legal_concepts?: string[];
  } = {},
): Promise<SuccessRateData> {
  const qs = new URLSearchParams();
  appendAnalyticsFilters(qs, params);
  if (params.visa_subclass) qs.set("visa_subclass", params.visa_subclass);
  if (params.case_nature) qs.set("case_nature", params.case_nature);
  if (params.legal_concepts && params.legal_concepts.length > 0) {
    qs.set("legal_concepts", params.legal_concepts.join(","));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch(`/api/v1/analytics/success-rate${suffix}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

export function fetchJudgeLeaderboard(
  params: AnalyticsFilterParams & {
    sort_by?: "cases" | "approval_rate" | "name";
    limit?: number;
    name_q?: string;
    min_cases?: number;
  } = {},
): Promise<{ judges: JudgeLeaderboardEntry[]; total_judges: number }> {
  const qs = new URLSearchParams();
  appendAnalyticsFilters(qs, params);
  if (params.sort_by) qs.set("sort_by", params.sort_by);
  if (typeof params.limit === "number") qs.set("limit", String(params.limit));
  if (params.name_q && params.name_q.trim()) {
    qs.set("name_q", params.name_q.trim());
  }
  if (typeof params.min_cases === "number") {
    qs.set("min_cases", String(params.min_cases));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch(`/api/v1/analytics/judge-leaderboard${suffix}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

export function fetchJudgeProfile(
  name: string,
  params: { yearFrom?: number; yearTo?: number } = {},
): Promise<JudgeProfile> {
  const qs = new URLSearchParams();
  qs.set("name", name);
  if (params.yearFrom && params.yearFrom > 2000) {
    qs.set("year_from", String(params.yearFrom));
  }
  if (params.yearTo && params.yearTo < CURRENT_YEAR) {
    qs.set("year_to", String(params.yearTo));
  }
  return apiFetch(`/api/v1/analytics/judge-profile?${qs.toString()}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

export function fetchJudgeCompare(
  names: string[],
  params: { yearFrom?: number; yearTo?: number } = {},
): Promise<{ judges: JudgeProfile[] }> {
  const qs = new URLSearchParams();
  qs.set("names", names.join(","));
  if (params.yearFrom && params.yearFrom > 2000) {
    qs.set("year_from", String(params.yearFrom));
  }
  if (params.yearTo && params.yearTo < CURRENT_YEAR) {
    qs.set("year_to", String(params.yearTo));
  }
  return apiFetch(`/api/v1/analytics/judge-compare?${qs.toString()}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

export function fetchJudgeBio(name: string): Promise<JudgeBio> {
  return apiFetch(
    `/api/v1/analytics/judge-bio?name=${encodeURIComponent(name)}`,
    { timeoutMs: ANALYTICS_TIMEOUT_MS },
  );
}

export function fetchConceptEffectiveness(
  params: AnalyticsFilterParams & { limit?: number } = {},
): Promise<ConceptEffectivenessData> {
  const qs = new URLSearchParams();
  appendAnalyticsFilters(qs, params);
  if (typeof params.limit === "number") qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch(`/api/v1/analytics/concept-effectiveness${suffix}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

export function fetchConceptCooccurrence(
  params: AnalyticsFilterParams & { limit?: number; min_count?: number } = {},
): Promise<ConceptCooccurrenceData> {
  const qs = new URLSearchParams();
  appendAnalyticsFilters(qs, params);
  if (typeof params.limit === "number") qs.set("limit", String(params.limit));
  if (typeof params.min_count === "number") {
    qs.set("min_count", String(params.min_count));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch(`/api/v1/analytics/concept-cooccurrence${suffix}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

export function fetchConceptTrends(
  params: AnalyticsFilterParams & { limit?: number } = {},
): Promise<ConceptTrendData> {
  const qs = new URLSearchParams();
  appendAnalyticsFilters(qs, params);
  if (typeof params.limit === "number") qs.set("limit", String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch(`/api/v1/analytics/concept-trends${suffix}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

export function fetchMonthlyTrends(
  params: AnalyticsFilterParams = {},
): Promise<MonthlyTrendsData> {
  const qs = new URLSearchParams();
  appendAnalyticsFilters(qs, params);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch(`/api/v1/analytics/monthly-trends${suffix}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

export function fetchFlowMatrix(
  params: AnalyticsFilterParams & { top_n?: number } = {},
): Promise<FlowMatrixData> {
  const qs = new URLSearchParams();
  appendAnalyticsFilters(qs, params);
  if (typeof params.top_n === "number") qs.set("top_n", String(params.top_n));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch(`/api/v1/analytics/flow-matrix${suffix}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

export function fetchVisaFamilies(
  params: AnalyticsFilterParams = {},
): Promise<VisaFamiliesData> {
  const qs = new URLSearchParams();
  appendAnalyticsFilters(qs, params);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch(`/api/v1/analytics/visa-families${suffix}`, {
    timeoutMs: ANALYTICS_TIMEOUT_MS,
  });
}

// ─── Cases ─────────────────────────────────────────────────────
export function fetchCases(filters: CaseFilters): Promise<PaginatedCases> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  return apiFetch(`/api/v1/cases?${params}`);
}

export type CaseCountMode = "exact" | "planned" | "estimated";

export function fetchCaseCount(
  filters: CaseFilters,
  countMode: CaseCountMode = "planned",
  options?: ApiRequestOptions,
): Promise<{ total: number; count_mode: CaseCountMode }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  params.set("count_mode", countMode);
  return apiFetch(`/api/v1/cases/count?${params}`, options);
}

export function fetchCase(
  id: string,
): Promise<{ case: ImmigrationCase; full_text: string | null }> {
  return apiFetch(`/api/v1/cases/${id}`);
}

export async function createCase(
  data: Partial<ImmigrationCase>,
): Promise<ImmigrationCase> {
  const res = await apiFetch<{ case: ImmigrationCase }>("/api/v1/cases", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.case;
}

export async function updateCase(
  id: string,
  data: Partial<ImmigrationCase>,
): Promise<ImmigrationCase> {
  const res = await apiFetch<{ case: ImmigrationCase }>(`/api/v1/cases/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return res.case;
}

export function deleteCase(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/v1/cases/${id}`, { method: "DELETE" });
}

export function batchCases(
  action: string,
  ids: string[],
  tag?: string,
): Promise<{ affected: number }> {
  return apiFetch("/api/v1/cases/batch", {
    method: "POST",
    body: JSON.stringify({ action, case_ids: ids, tag }),
  });
}

export function compareCases(
  ids: string[],
): Promise<{ cases: ImmigrationCase[] }> {
  const params = new URLSearchParams();
  ids.forEach((id) => params.append("ids", id));
  return apiFetch(`/api/v1/cases/compare?${params}`);
}

export function fetchRelated(
  id: string,
): Promise<{ cases: ImmigrationCase[] }> {
  return apiFetch(`/api/v1/cases/${id}/related`);
}

// ─── Search ────────────────────────────────────────────────────
export function searchCases(
  query: string,
  limit = 50,
): Promise<{ cases: ImmigrationCase[] }> {
  return apiFetch(
    `/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
}

// ─── Filters ───────────────────────────────────────────────────
export function fetchFilterOptions(): Promise<FilterOptions> {
  return apiFetch("/api/v1/filter-options", {
    timeoutMs: FILTER_OPTIONS_TIMEOUT_MS,
  });
}

// ─── Jobs ──────────────────────────────────────────────────────
export function fetchJobStatus(): Promise<JobStatus> {
  return apiFetch("/api/v1/job-status");
}

export function startDownload(
  params: Record<string, unknown>,
): Promise<{ started: boolean }> {
  return apiFetch("/api/v1/download/start", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

// ─── Pipeline ──────────────────────────────────────────────────
export function fetchPipelineStatus(): Promise<Record<string, unknown>> {
  return apiFetch("/api/v1/pipeline-status");
}

export function pipelineAction(
  action: string,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return apiFetch("/api/v1/pipeline-action", {
    method: "POST",
    body: JSON.stringify({ action, ...params }),
  });
}

// ─── Data Dictionary ───────────────────────────────────────────
export function fetchDataDictionary(): Promise<{
  fields: Array<{
    name: string;
    type: string;
    description: string;
    example: string;
  }>;
}> {
  return apiFetch("/api/v1/data-dictionary");
}

// ─── Legislations ──────────────────────────────────────────────

export interface LegislationSection {
  id: string; // e.g. "s501"
  number: string; // e.g. "501", "501A"
  title: string; // e.g. "Character test"
  part: string; // e.g. "Part 9—Deportation"
  division: string; // e.g. "Division 2—Cancellation of visas"
  text: string; // full section text
}

export interface Legislation {
  id: string;
  title: string;
  austlii_id: string; // e.g. "consol_act/ma1958116"
  shortcode: string;
  jurisdiction: string;
  type: string;
  description: string;
  sections_count: number;
  last_amended: string;
  last_scraped: string;
  sections?: LegislationSection[]; // only present in detail endpoint
}

export interface LegislationUpdateStatus {
  running: boolean;
  law_id: string | null;
  current: number;
  total: number;
  section_id: string;
  completed_laws: string[];
  failed_laws: string[];
  error: string | null;
}

export interface PaginatedLegislations {
  success: boolean;
  data: Legislation[];
  meta: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

export interface LegislationDetail {
  success: boolean;
  data: Legislation;
}

export interface SearchLegislations {
  success: boolean;
  data: Legislation[];
  meta: {
    query: string;
    total_results: number;
    limit: number;
  };
}

export function fetchLegislations(
  page: number = 1,
  limit: number = 10,
): Promise<PaginatedLegislations> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("limit", String(limit));
  return apiFetch(`/api/v1/legislations?${params}`);
}

export function fetchLegislation(
  legislationId: string,
): Promise<LegislationDetail> {
  return apiFetch(`/api/v1/legislations/${encodeURIComponent(legislationId)}`);
}

export function searchLegislations(
  query: string,
  limit: number = 20,
): Promise<SearchLegislations> {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("limit", String(limit));
  return apiFetch(`/api/v1/legislations/search?${params}`);
}

export function startLegislationUpdate(
  law_id?: string,
): Promise<{ success: boolean; message: string; laws: string[] }> {
  return apiFetch("/api/v1/legislations/update", {
    method: "POST",
    body: JSON.stringify(law_id ? { law_id } : {}),
  });
}

export function fetchLegislationUpdateStatus(): Promise<{
  success: boolean;
  status: LegislationUpdateStatus;
}> {
  return apiFetch("/api/v1/legislations/update/status");
}

// ─── Taxonomy ──────────────────────────────────────────────────

export interface VisaEntry {
  subclass: string;
  name: string;
  family: string;
  case_count: number;
}

export interface LegalConceptEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  case_count: number;
}

export interface JudgeAutocompleteEntry {
  name: string;
  canonical_name?: string;
  case_count: number;
}

export interface CountryEntry {
  country: string;
  case_count: number;
}

export interface GuidedSearchParams {
  flow: "find-precedents" | "assess-judge";
  visa_subclass?: string;
  country?: string;
  legal_concepts?: string[];
  judge_name?: string;
}

export interface GuidedSearchResult {
  success: boolean;
  flow: string;
  results?: ImmigrationCase[];
  total?: number;
  meta?: {
    total_results?: number;
    returned_results?: number;
    total_cases?: number;
    limit?: number;
    filters_applied?: Record<string, unknown>;
  };
  judge_profile?: {
    name: string;
    url: string;
    canonical_name?: string;
    case_count: number;
  };
}

interface JudgeAutocompleteRawResponse {
  success: boolean;
  judges?: Array<{
    name?: unknown;
    canonical_name?: unknown;
    case_count?: unknown;
  }>;
  data?: Array<{
    name?: unknown;
    canonical_name?: unknown;
    case_count?: unknown;
  }>;
  meta?: { query?: string; total_results?: number; limit?: number };
}

interface CountryRawResponse {
  success: boolean;
  countries?: Array<{
    country?: unknown;
    name?: unknown;
    case_count?: unknown;
  }>;
  meta?: { total_countries?: number; limit?: number };
}

interface GuidedSearchRawResponse {
  success: boolean;
  flow: string;
  results?: ImmigrationCase[];
  total?: number;
  meta?: {
    total_results?: number;
    returned_results?: number;
    total_cases?: number;
    limit?: number;
    filters_applied?: Record<string, unknown>;
  };
  judge_profile?: {
    name: string;
    url: string;
    canonical_name?: string;
    case_count: number;
  };
  judge_name?: string;
  canonical_name?: string;
  profile_url?: string;
}

function normalizeCount(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.floor(num);
}

function normalizeJudgeAutocompleteEntries(
  entries: Array<{
    name?: unknown;
    canonical_name?: unknown;
    case_count?: unknown;
  }>,
): JudgeAutocompleteEntry[] {
  const byCanonical = new Map<string, JudgeAutocompleteEntry>();

  for (const entry of entries) {
    const rawName = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!rawName) continue;
    const canonical =
      typeof entry.canonical_name === "string"
        ? entry.canonical_name.trim()
        : "";
    const key = (canonical || rawName).toLowerCase();
    const count = normalizeCount(entry.case_count);
    const prev = byCanonical.get(key);

    if (!prev) {
      byCanonical.set(key, {
        name: rawName,
        canonical_name: canonical || undefined,
        case_count: count,
      });
      continue;
    }

    byCanonical.set(key, {
      // Prefer fuller display names when duplicates are merged.
      name: rawName.length > prev.name.length ? rawName : prev.name,
      canonical_name: prev.canonical_name ?? (canonical || undefined),
      case_count: Math.max(prev.case_count, count),
    });
  }

  return Array.from(byCanonical.values())
    .sort((a, b) => b.case_count - a.case_count || a.name.localeCompare(b.name));
}

function normalizeCountryEntries(
  entries: Array<{ country?: unknown; name?: unknown; case_count?: unknown }>,
): CountryEntry[] {
  const byCountry = new Map<string, number>();

  for (const entry of entries) {
    const rawCountry =
      typeof entry.country === "string"
        ? entry.country.trim()
        : typeof entry.name === "string"
          ? entry.name.trim()
          : "";
    if (!rawCountry) continue;

    const count = normalizeCount(entry.case_count);
    byCountry.set(rawCountry, (byCountry.get(rawCountry) ?? 0) + count);
  }

  return Array.from(byCountry.entries())
    .map(([country, case_count]) => ({ country, case_count }))
    .sort(
      (a, b) =>
        b.case_count - a.case_count || a.country.localeCompare(b.country),
    );
}

export function fetchVisaLookup(
  query: string,
  limit: number = 20,
): Promise<{
  success: boolean;
  data: VisaEntry[];
  meta: { query: string; total_results: number; limit: number };
}> {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("limit", String(limit));
  return apiFetch(`/api/v1/taxonomy/visa-lookup?${params}`);
}

export function fetchTaxonomyLegalConcepts(): Promise<{
  success: boolean;
  concepts: LegalConceptEntry[];
  meta: { total_concepts: number };
}> {
  return apiFetch("/api/v1/taxonomy/legal-concepts");
}

export function fetchJudgeAutocomplete(
  query: string,
  limit: number = 20,
): Promise<{
  success: boolean;
  judges: JudgeAutocompleteEntry[];
  meta: { query: string; total_results: number; limit: number };
}> {
  const params = new URLSearchParams();
  params.set("q", query);
  params.set("limit", String(limit));
  return apiFetch<JudgeAutocompleteRawResponse>(
    `/api/v1/taxonomy/judges/autocomplete?${params}`,
  ).then((payload) => {
    const judges = normalizeJudgeAutocompleteEntries(
      payload.judges ?? payload.data ?? [],
    );
    return {
      success: payload.success,
      judges,
      meta: {
        query: payload.meta?.query ?? query,
        total_results: payload.meta?.total_results ?? judges.length,
        limit: payload.meta?.limit ?? limit,
      },
    };
  });
}

export function fetchCountries(limit: number = 30): Promise<{
  success: boolean;
  countries: CountryEntry[];
  meta: { total_countries: number; limit: number };
}> {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  return apiFetch<CountryRawResponse>(`/api/v1/taxonomy/countries?${params}`).then(
    (payload) => {
      const countries = normalizeCountryEntries(payload.countries ?? []);
      return {
        success: payload.success,
        countries,
        meta: {
          total_countries: payload.meta?.total_countries ?? countries.length,
          limit: payload.meta?.limit ?? limit,
        },
      };
    },
  );
}

export function submitGuidedSearch(
  params: GuidedSearchParams,
): Promise<GuidedSearchResult> {
  return apiFetch<GuidedSearchRawResponse>("/api/v1/taxonomy/guided-search", {
    method: "POST",
    body: JSON.stringify(params),
  }).then((payload) => {
    const results = payload.results ?? [];
    const total =
      payload.total ??
      payload.meta?.total_results ??
      (payload.flow === "find-precedents" ? results.length : undefined);

    const judge_profile =
      payload.judge_profile ??
      (payload.judge_name
        ? {
            name: payload.judge_name,
            url: (
              payload.profile_url?.startsWith("/judges/")
                ? payload.profile_url.replace(
                    "/judges/",
                    "/judge-profiles/",
                  )
                : payload.profile_url
            ) ??
            `/judge-profiles/${encodeURIComponent(payload.canonical_name ?? payload.judge_name)}`,
            canonical_name: payload.canonical_name,
            case_count: payload.meta?.total_cases ?? 0,
          }
        : undefined);

    return {
      success: payload.success,
      flow: payload.flow,
      results,
      total,
      meta: payload.meta,
      judge_profile,
    };
  });
}

// ─── LLM Council ─────────────────────────────────────────────────

export interface LlmCouncilRequest {
  question: string;
  case_id?: string;
  context?: string;
}

export interface LlmCouncilModelConfig {
  provider: string;
  model: string;
  reasoning?: string;
  reasoning_budget?: number;
  web_search?: boolean;
  grounding_google_search?: boolean;
  role?: string;
  system_prompt?: string;
}

export interface LlmCouncilOpinion {
  provider_key: "openai" | "gemini_pro" | "anthropic" | string;
  provider_label: string;
  model: string;
  success: boolean;
  answer: string;
  error: string;
  sources: string[];
  latency_ms: number;
}

export interface LlmCouncilRankingEntry {
  rank: number;
  provider_key: string;
  provider_label: string;
  score: number;
  reason: string;
}

export interface LlmCouncilModelCritique {
  provider_key: string;
  provider_label: string;
  score: number;
  vote: "support" | "neutral" | "oppose" | string;
  strengths: string;
  weaknesses: string;
  critique: string;
}

export interface LlmCouncilVoteSummary {
  winner_provider_key: string;
  winner_provider_label: string;
  winner_reason: string;
  support_count: number;
  neutral_count: number;
  oppose_count: number;
}

export interface LlmCouncilModeratorResult {
  success: boolean;
  ranking: LlmCouncilRankingEntry[];
  model_critiques: LlmCouncilModelCritique[];
  vote_summary: LlmCouncilVoteSummary;
  agreement_points: string[];
  conflict_points: string[];
  provider_law_sections: Record<string, string[]>;
  shared_law_sections: string[];
  shared_law_sections_confidence_percent: number;
  shared_law_sections_confidence_reason: string;
  consensus: string;
  disagreements: string;
  outcome_likelihood_percent: number;
  outcome_likelihood_label: "high" | "medium" | "low" | "unknown" | string;
  outcome_likelihood_reason: string;
  law_sections: string[];
  mock_judgment: string;
  composed_answer: string;
  follow_up_questions: string[];
  raw_text: string;
  error: string;
  latency_ms: number;
}

export interface LlmCouncilResponse {
  question: string;
  case_context: string;
  models: {
    openai: LlmCouncilModelConfig;
    gemini_pro: LlmCouncilModelConfig;
    anthropic: LlmCouncilModelConfig;
    gemini_flash: LlmCouncilModelConfig;
  };
  opinions: LlmCouncilOpinion[];
  moderator: LlmCouncilModeratorResult;
  retrieved_cases?: Array<{
    case_id: string;
    citation: string;
    title: string;
    court: string;
    date: string;
    outcome: string;
    legal_concepts: string;
    url: string;
  }>;
}

export interface LlmCouncilHealthProviderStatus {
  model: string;
  api_key_present: boolean;
  system_prompt_preview: string;
}

export interface LlmCouncilHealthResponse {
  ok: boolean;
  live_probe: boolean;
  errors: string[];
  providers: {
    openai: LlmCouncilHealthProviderStatus;
    gemini_pro: LlmCouncilHealthProviderStatus;
    anthropic: LlmCouncilHealthProviderStatus;
    gemini_flash: LlmCouncilHealthProviderStatus;
  };
  probe_results?: {
    openai?: LlmCouncilOpinion;
    gemini_pro?: LlmCouncilOpinion;
    anthropic?: LlmCouncilOpinion;
  };
}

export function runLlmCouncil(
  payload: LlmCouncilRequest,
): Promise<LlmCouncilResponse> {
  return apiFetch("/api/v1/llm-council/run", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: 180_000,
  });
}

export function checkLlmCouncilHealth(
  live: boolean = false,
): Promise<LlmCouncilHealthResponse> {
  const params = new URLSearchParams();
  if (live) params.set("live", "1");
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/api/v1/llm-council/health${suffix}`, {
    timeoutMs: live ? 120_000 : 15_000,
  });
}

// ─── Collections export (server-side HTML report) ──────────────
export interface CollectionExportPayload {
  collection_id: string;
  collection_name: string;
  case_ids: string[];
  case_notes: Record<string, string>;
}

export async function exportCollection(
  payload: CollectionExportPayload,
): Promise<string> {
  const token = await fetchCsrfToken();
  const res = await fetch("/api/v1/collections/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": token,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `Export failed: ${res.status}`);
  }
  return res.text();
}

// ─── Export (file downloads) ───────────────────────────────────
export function downloadExportFile(format: "csv" | "json"): void {
  window.location.href = `/api/v1/export/${format}`;
}

// ─── Invalidate CSRF (call on auth errors) ─────────────────────
export function clearCsrfToken(): void {
  csrfToken = null;
}
