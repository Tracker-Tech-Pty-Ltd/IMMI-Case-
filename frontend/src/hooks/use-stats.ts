import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { analyticsFilterKey, fetchStats, fetchTrends } from "@/lib/api";
import type { AnalyticsFilterParams } from "@/types/case";

export function useStats(filters?: AnalyticsFilterParams) {
  return useQuery({
    queryKey: ["stats", analyticsFilterKey(filters)],
    queryFn: () => fetchStats(filters),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useTrends(filters?: AnalyticsFilterParams) {
  return useQuery({
    queryKey: ["trends", analyticsFilterKey(filters)],
    queryFn: () => fetchTrends(filters),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
