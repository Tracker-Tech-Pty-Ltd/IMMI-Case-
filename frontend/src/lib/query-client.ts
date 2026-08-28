import { QueryClient } from "@tanstack/react-query";

/**
 * The app's single QueryClient, owned here rather than by App.tsx.
 *
 * `AuthProvider` sits *outside* `QueryClientProvider` (it supplies the token
 * the query functions use), so it cannot reach the client through
 * `useQueryClient()`. Cross-tenant cache purging on sign-out and workspace
 * switch still has to happen from there, and the client object is not
 * React-scoped, so exporting the instance is what lets both reach the same
 * cache without reordering the providers or importing App.tsx in a cycle.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 min — legal DB data doesn't change mid-session
      gcTime: 30 * 60 * 1000, // 30 min — keep cache alive for a full work session
    },
  },
});
