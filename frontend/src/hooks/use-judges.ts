import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  fetchJudgeLeaderboard,
  fetchJudgeProfile,
  fetchJudgeCompare,
  fetchJudgeBio,
} from "@/lib/api";

export function useJudgeLeaderboard(params: {
  court?: string;
  yearFrom?: number;
  yearTo?: number;
  sort_by?: "cases" | "approval_rate" | "name";
  limit?: number;
  name_q?: string;
  min_cases?: number;
}) {
  return useQuery({
    queryKey: [
      "judges",
      "leaderboard",
      params.court,
      params.yearFrom,
      params.yearTo,
      params.sort_by,
      params.limit,
      params.name_q,
      params.min_cases,
    ],
    queryFn: () => fetchJudgeLeaderboard(params),
    retry: 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useJudgeProfile(
  name: string,
  params: { yearFrom?: number; yearTo?: number } = {},
) {
  return useQuery({
    queryKey: ["judges", "profile", name, params.yearFrom, params.yearTo],
    queryFn: () => fetchJudgeProfile(name, params),
    enabled: !!name,
    retry: 0,
    staleTime: 5 * 60_000,
  });
}

export function useJudgeCompare(
  names: string[],
  params: { yearFrom?: number; yearTo?: number } = {},
) {
  return useQuery({
    queryKey: ["judges", "compare", ...names, params.yearFrom, params.yearTo],
    queryFn: () => fetchJudgeCompare(names, params),
    enabled: names.length >= 2,
    retry: 0,
    staleTime: 5 * 60_000,
    // No keepPreviousData here, unlike the leaderboard. The compare result IS
    // the identity of the judges named in the URL: holding the previous pair's
    // data while the heading already reads the new names attributes one
    // judge's record to another. A pagination flash is cosmetic; this is not.
  });
}

export function useJudgeBio(name: string) {
  return useQuery({
    queryKey: ["judges", "bio", name],
    queryFn: () => fetchJudgeBio(name),
    enabled: !!name,
    retry: 0,
    staleTime: 10 * 60_000,
  });
}
