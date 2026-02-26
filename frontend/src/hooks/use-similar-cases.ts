import { useQuery } from "@tanstack/react-query";
import { fetchSimilarCases } from "@/lib/api";
import type { SimilarCase } from "@/types/case";

export function useSimilarCases(
  caseId: string,
  enabled = true,
): ReturnType<
  typeof useQuery<SimilarCase[], Error>
> {
  return useQuery<SimilarCase[], Error>({
    queryKey: ["similar-cases", caseId],
    queryFn: () => fetchSimilarCases(caseId),
    enabled: enabled && !!caseId,
    staleTime: 10 * 60_000,
    retry: 0,
  });
}
