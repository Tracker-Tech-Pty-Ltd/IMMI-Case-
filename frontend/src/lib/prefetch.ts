/**
 * Route-to-chunk prefetch map. Calling prefetchRoute(path) triggers
 * the dynamic import for that route's page component, warming the
 * browser cache so navigation feels instant.
 */
const prefetchMap: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/DashboardPage"),
  "/analytics": () => import("@/pages/AnalyticsPage"),
  "/judge-profiles": () => import("@/pages/JudgeProfilesPage"),
  "/cases": () => import("@/pages/CasesPage"),
  "/llm-council": () => import("@/pages/LlmCouncilPage"),
  "/llm-council/sessions": () => import("@/pages/LlmCouncilSessionsPage"),
  "/download": () => import("@/pages/DownloadPage"),
  "/pipeline": () => import("@/pages/PipelinePage"),
  "/jobs": () => import("@/pages/JobStatusPage"),
  "/legislations": () => import("@/pages/LegislationsPage"),
  "/collections": () => import("@/pages/CollectionsPage"),
  "/data-dictionary": () => import("@/pages/DataDictionaryPage"),
  "/design-tokens": () => import("@/pages/DesignTokensPage"),
};

const prefetched = new Set<string>();

export function prefetchRoute(path: string): void {
  if (prefetched.has(path)) return;
  const loader = prefetchMap[path];
  if (loader) {
    prefetched.add(path);
    loader();
  }
}
