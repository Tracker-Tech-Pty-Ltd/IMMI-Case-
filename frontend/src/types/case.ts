export interface ImmigrationCase {
  case_id: string;
  citation: string;
  title: string;
  court: string;
  court_code: string;
  date: string;
  year: number;
  url: string;
  judges: string;
  catchwords: string;
  outcome: string;
  visa_type: string;
  legislation: string;
  text_snippet: string;
  full_text_path: string;
  source: string;
  user_notes: string;
  tags: string;
  case_nature: string;
  legal_concepts: string;
  visa_subclass: string;
  visa_class_code: string;
  applicant_name: string;
  respondent: string;
  country_of_origin: string;
  visa_subclass_number: string;
  hearing_date: string;
  is_represented: string;
  representative: string;
}

export interface CaseFilters {
  court?: string;
  year?: number;
  visa_type?: string;
  source?: string;
  tag?: string;
  nature?: string;
  keyword?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export interface PaginatedCases {
  cases: ImmigrationCase[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface DashboardStats {
  total_cases: number;
  courts: Record<string, number>;
  years: Record<string, number>;
  with_full_text: number;
  sources: Record<string, number>;
  natures: Record<string, number>;
  visa_subclasses: Record<string, number>;
  recent_cases: ImmigrationCase[];
}

export interface TrendEntry {
  year: number;
  [courtCode: string]: number;
}

export interface FilterOptions {
  courts: string[];
  years: number[];
  visa_types: string[];
  sources: string[];
  tags: string[];
  natures: string[];
}

export interface AnalyticsFilterOption {
  value: string;
  count: number;
  label?: string;
  family?: string;
}

export interface AnalyticsAdvancedFilterOptions {
  query: {
    court?: string | null;
    year_from?: number | null;
    year_to?: number | null;
    total_matching: number;
  };
  case_natures: AnalyticsFilterOption[];
  visa_subclasses: AnalyticsFilterOption[];
  outcome_types: AnalyticsFilterOption[];
}

export interface JobStatus {
  running: boolean;
  type?: string;
  progress?: string;
  total?: number;
  completed?: number;
  message?: string;
  errors?: string[];
  results?: string[];
}

// ─── Analytics ──────────────────────────────────────────────────

export interface AnalyticsFilterParams {
  court?: string;
  yearFrom?: number;
  yearTo?: number;
  caseNatures?: string[];
  visaSubclasses?: string[];
  outcomeTypes?: string[];
}

export interface OutcomeData {
  by_court: Record<string, Record<string, number>>;
  by_year: Record<string, Record<string, number>>;
  by_subclass: Record<string, Record<string, number>>;
}

export interface JudgeEntry {
  name: string;
  canonical_name?: string;
  display_name?: string;
  count: number;
  courts: string[];
}

export interface ConceptEntry {
  name: string;
  count: number;
}

export interface NatureOutcomeData {
  natures: string[];
  outcomes: string[];
  matrix: Record<string, Record<string, number>>;
}

export interface SuccessRateQuery {
  court?: string | null;
  year_from?: number | null;
  year_to?: number | null;
  visa_subclass?: string | null;
  case_nature?: string | null;
  legal_concepts: string[];
  total_matching: number;
}

export interface SuccessRateConcept {
  concept: string;
  total: number;
  win_rate: number;
  lift: number;
}

export interface SuccessRateCombo {
  concepts: string[];
  win_rate: number;
  count: number;
  lift: number;
}

export interface SuccessRateTrendPoint {
  year: number;
  rate: number;
  count: number;
}

export interface SuccessRateData {
  query: SuccessRateQuery;
  success_rate: {
    overall: number;
    court_type: "tribunal" | "court" | "mixed" | "unknown";
    win_outcomes: string[];
    win_count: number;
    loss_count: number;
    confidence: "high" | "medium" | "low";
  };
  by_concept: SuccessRateConcept[];
  top_combos: SuccessRateCombo[];
  trend: SuccessRateTrendPoint[];
}

export interface JudgeLeaderboardEntry {
  name: string;
  display_name?: string;
  total_cases: number;
  approval_rate: number;
  courts: string[];
  primary_court: string | null;
  top_visa_subclasses: Array<{ subclass: string; count: number }>;
  active_years: { first: number | null; last: number | null };
  outcome_summary: Record<string, number>;
}

export interface NotableCase {
  citation: string;
  year: number;
  description: string;
}

export interface JudgeBio {
  found: boolean;
  full_name?: string;
  role?: string;
  court?: string;
  registry?: string;
  appointed_year?: string | number;
  birth_year?: number;
  education?: string[];
  previously?: string;
  specialization?: string;
  current_role_desc?: string;
  notable_cases?: NotableCase[];
  photo_url?: string;
  social_media?: Record<string, string>;
  source_url?: string;
}

export interface RepresentationStats {
  represented?: { total: number; win_rate: number };
  self_represented?: { total: number; win_rate: number };
  unknown_count: number;
}

export interface CountryBreakdownEntry {
  country: string;
  total: number;
  win_rate: number;
}

export interface CourtComparisonEntry {
  court_code: string;
  judge_rate: number;
  court_avg_rate: number;
  delta: number;
  judge_total: number;
}

export interface JudgeProfile {
  judge: {
    name: string;
    canonical_name?: string;
    total_cases: number;
    courts: string[];
    active_years: { first: number | null; last: number | null };
  };
  approval_rate: number;
  court_type: "tribunal" | "court" | "mixed" | "unknown";
  outcome_distribution: Record<string, number>;
  visa_breakdown: Array<{ subclass: string; total: number; win_rate: number }>;
  concept_effectiveness: Array<{
    concept: string;
    total: number;
    win_rate: number;
    baseline_rate: number;
    lift: number;
  }>;
  yearly_trend: Array<{ year: number; total: number; approval_rate: number }>;
  nature_breakdown: Array<{ nature: string; total: number; win_rate: number }>;
  representation_analysis: RepresentationStats;
  country_breakdown: CountryBreakdownEntry[];
  court_comparison: CourtComparisonEntry[];
  recent_3yr_trend: Array<{
    year: number;
    total: number;
    approval_rate: number;
  }>;
  recent_cases?: Array<{
    case_id: string;
    citation: string;
    date: string;
    outcome: string;
    visa_subclass: string;
  }>;
}

export interface ConceptEffectivenessEntry {
  name: string;
  total: number;
  win_rate: number;
  lift: number;
  by_court: Record<string, { total: number; win_rate: number }>;
}

export interface ConceptEffectivenessData {
  baseline_rate: number;
  concepts: ConceptEffectivenessEntry[];
}

export interface ConceptCooccurrencePair {
  a: string;
  b: string;
  count: number;
  win_rate: number;
  lift: number;
}

export interface ConceptCooccurrenceData {
  concepts: string[];
  matrix: Record<string, Record<string, { count: number; win_rate: number }>>;
  top_pairs: ConceptCooccurrencePair[];
}

export interface ConceptTrendData {
  series: Record<
    string,
    Array<{ year: number; count: number; win_rate: number }>
  >;
  emerging: Array<{ name: string; growth_pct: number; recent_count: number }>;
  declining: Array<{ name: string; decline_pct: number; recent_count: number }>;
}

export interface MonthlyEntry {
  month: string;
  total: number;
  wins: number;
  win_rate: number;
}

export interface PolicyEvent {
  month: string;
  label: string;
}

export interface MonthlyTrendsData {
  series: MonthlyEntry[];
  events: PolicyEvent[];
}

export interface FlowNode {
  name: string;
  layer?: string;
}

export interface FlowLink {
  source: number;
  target: number;
  value: number;
}

export interface FlowMatrixData {
  nodes: FlowNode[];
  links: FlowLink[];
}

// ─── Visa Families ──────────────────────────────────────────────

export interface VisaFamilyEntry {
  family: string;
  total: number;
  win_count: number;
  win_rate: number;
}

export interface VisaFamiliesData {
  families: VisaFamilyEntry[];
  total_cases: number;
}

// ─── Saved Searches ─────────────────────────────────────────────

export interface SavedSearch {
  id: string;
  name: string;
  filters: CaseFilters;
  createdAt: string;
  lastExecutedAt?: string;
  resultCount?: number;
}

// ─── Semantic Similar Cases ──────────────────────────────────────

export interface SimilarCase {
  case_id: string;
  citation: string;
  title: string;
  outcome: string;
  similarity_score: number;
}
