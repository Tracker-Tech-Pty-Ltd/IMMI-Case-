import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchVisaLookup,
  fetchLegalConcepts,
  fetchJudgeAutocomplete,
  fetchCountries,
  submitGuidedSearch,
} from "@/lib/api";
import type { GuidedSearchParams } from "@/lib/api";

export function useVisaLookup(query: string = "", limit: number = 20) {
  return useQuery({
    queryKey: ["taxonomy-visa-lookup", query, limit],
    queryFn: () => fetchVisaLookup(query, limit),
    enabled: query.length >= 1,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData,
  });
}

export function useLegalConcepts() {
  return useQuery({
    queryKey: ["taxonomy-legal-concepts"],
    queryFn: fetchLegalConcepts,
    staleTime: 300_000,
  });
}

export function useJudgeAutocomplete(query: string = "", limit: number = 20) {
  return useQuery({
    queryKey: ["taxonomy-judge-autocomplete", query, limit],
    queryFn: () => fetchJudgeAutocomplete(query, limit),
    enabled: query.length >= 2,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  });
}

export function useCountries(limit: number = 30) {
  return useQuery({
    queryKey: ["taxonomy-countries", limit],
    queryFn: () => fetchCountries(limit),
    staleTime: 300_000,
  });
}

export function useGuidedSearch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: GuidedSearchParams) => submitGuidedSearch(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cases"] });
    },
  });
}
