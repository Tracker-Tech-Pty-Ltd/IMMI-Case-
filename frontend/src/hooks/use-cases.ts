import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { UseQueryOptions } from "@tanstack/react-query"
import type { CaseFilters } from "@/types/case"
import {
  fetchCases,
  fetchCase,
  createCase,
  updateCase,
  deleteCase,
  batchCases,
  fetchRelated,
  fetchFilterOptions,
  searchCases,
} from "@/lib/api"
import type { ImmigrationCase } from "@/types/case"

export function useCases(
  filters: CaseFilters,
  options?: Omit<UseQueryOptions<Awaited<ReturnType<typeof fetchCases>>>, "queryKey" | "queryFn">
) {
  return useQuery({
    queryKey: ["cases", filters],
    queryFn: () => fetchCases(filters),
    staleTime: 10_000,
    ...options,
  })
}

export function useCase(id: string) {
  return useQuery({
    queryKey: ["case", id],
    queryFn: () => fetchCase(id),
    enabled: !!id,
  })
}

export function useRelatedCases(id: string) {
  return useQuery({
    queryKey: ["related", id],
    queryFn: () => fetchRelated(id),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useFilterOptions() {
  return useQuery({
    queryKey: ["filter-options"],
    queryFn: fetchFilterOptions,
    staleTime: 60_000,
  })
}

export function useSearchCases(query: string, limit = 50) {
  return useQuery({
    queryKey: ["search", query, limit],
    queryFn: () => searchCases(query, limit),
    enabled: query.length > 0,
    staleTime: 15_000,
  })
}

export function useCreateCase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<ImmigrationCase>) => createCase(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
    },
  })
}

export function useUpdateCase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ImmigrationCase> }) =>
      updateCase(id, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["cases"] })
      qc.invalidateQueries({ queryKey: ["case", variables.id] })
    },
  })
}

export function useDeleteCase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteCase(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
    },
  })
}

export function useBatchCases() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ action, ids, tag }: { action: string; ids: string[]; tag?: string }) =>
      batchCases(action, ids, tag),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cases"] })
      qc.invalidateQueries({ queryKey: ["stats"] })
    },
  })
}
