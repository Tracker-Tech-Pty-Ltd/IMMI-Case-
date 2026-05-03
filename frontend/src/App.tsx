import { lazy, Suspense, Component, type ReactNode } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AlertTriangle } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageLoader } from "@/components/shared/PageLoader";
import { StatePanel } from "@/components/shared/StatePanel";
import { resolveRouterBasename } from "@/lib/router";
import { AuthProvider } from "@/contexts/AuthContext";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
          <StatePanel
            tone="error"
            align="start"
            icon={<AlertTriangle className="h-5 w-5" />}
            title="Application error"
            description="A rendering error interrupted the current view. The diagnostic details are shown below for debugging."
            className="max-w-3xl"
          >
            <pre className="overflow-x-auto rounded-xl border border-danger/15 bg-background px-4 py-3 font-mono text-xs leading-6 text-danger">
              {err.message}
              {"\n\n"}
              {err.stack}
            </pre>
          </StatePanel>
        </div>
      );
    }
    return this.props.children;
  }
}

const DashboardPage = lazy(() =>
  import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const CasesPage = lazy(() =>
  import("@/pages/CasesPage").then((m) => ({ default: m.CasesPage })),
);
const CaseDetailPage = lazy(() =>
  import("@/pages/CaseDetailPage").then((m) => ({
    default: m.CaseDetailPage,
  })),
);
const CaseEditPage = lazy(() =>
  import("@/pages/CaseEditPage").then((m) => ({ default: m.CaseEditPage })),
);
const CaseAddPage = lazy(() =>
  import("@/pages/CaseAddPage").then((m) => ({ default: m.CaseAddPage })),
);
const CaseComparePage = lazy(() =>
  import("@/pages/CaseComparePage").then((m) => ({
    default: m.CaseComparePage,
  })),
);
const DownloadPage = lazy(() =>
  import("@/pages/DownloadPage").then((m) => ({ default: m.DownloadPage })),
);
const JobStatusPage = lazy(() =>
  import("@/pages/JobStatusPage").then((m) => ({ default: m.JobStatusPage })),
);
const PipelinePage = lazy(() =>
  import("@/pages/PipelinePage").then((m) => ({ default: m.PipelinePage })),
);
const DataDictionaryPage = lazy(() =>
  import("@/pages/DataDictionaryPage").then((m) => ({
    default: m.DataDictionaryPage,
  })),
);
const DesignTokensPage = lazy(() =>
  import("@/pages/DesignTokensPage").then((m) => ({
    default: m.DesignTokensPage,
  })),
);
const AnalyticsPage = lazy(() =>
  import("@/pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage })),
);
const JudgeProfilesPage = lazy(() =>
  import("@/pages/JudgeProfilesPage").then((m) => ({
    default: m.JudgeProfilesPage,
  })),
);
const JudgeDetailPage = lazy(() =>
  import("@/pages/JudgeDetailPage").then((m) => ({
    default: m.JudgeDetailPage,
  })),
);
const JudgeComparePage = lazy(() =>
  import("@/pages/JudgeComparePage").then((m) => ({
    default: m.JudgeComparePage,
  })),
);
const LegislationsPage = lazy(() =>
  import("@/pages/LegislationsPage").then((m) => ({
    default: m.LegislationsPage,
  })),
);
const LegislationDetailPage = lazy(() =>
  import("@/pages/LegislationDetailPage").then((m) => ({
    default: m.LegislationDetailPage,
  })),
);
const CourtLineagePage = lazy(() =>
  import("@/pages/CourtLineagePage").then((m) => ({
    default: m.CourtLineagePage,
  })),
);
const CollectionsPage = lazy(() =>
  import("@/pages/CollectionsPage").then((m) => ({
    default: m.CollectionsPage,
  })),
);
const SavedSearchesPage = lazy(() =>
  import("@/pages/SavedSearchesPage").then((m) => ({
    default: m.SavedSearchesPage,
  })),
);
const CollectionDetailPage = lazy(() =>
  import("@/pages/CollectionDetailPage").then((m) => ({
    default: m.CollectionDetailPage,
  })),
);
const SearchTaxonomyPage = lazy(() =>
  import("@/pages/SearchTaxonomyPage").then((m) => ({
    default: m.SearchTaxonomyPage,
  })),
);
const GuidedSearchPage = lazy(() =>
  import("@/pages/GuidedSearchPage").then((m) => ({
    default: m.GuidedSearchPage,
  })),
);
const SemanticSearchPage = lazy(() =>
  import("@/pages/SemanticSearchPage").then((m) => ({
    default: m.SemanticSearchPage,
  })),
);
const LlmCouncilPage = lazy(() =>
  import("@/pages/LlmCouncilPage").then((m) => ({
    default: m.LlmCouncilPage,
  })),
);
const LlmCouncilSessionsPage = lazy(() =>
  import("@/pages/LlmCouncilSessionsPage").then((m) => ({
    default: m.LlmCouncilSessionsPage,
  })),
);
const LoginPage = lazy(() =>
  import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 min — legal DB data doesn't change mid-session
      gcTime: 30 * 60 * 1000, // 30 min — keep cache alive for a full work session
    },
  },
});

export default function App() {
  const basename = resolveRouterBasename(window.location.pathname);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter basename={basename}>
            <Routes>
              <Route
                path="login"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <LoginPage />
                  </Suspense>
                }
              />
              <Route element={<AppLayout />}>
              <Route
                index
                element={
                  <Suspense fallback={<PageLoader />}>
                    <DashboardPage />
                  </Suspense>
                }
              />
              <Route
                path="cases"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CasesPage />
                  </Suspense>
                }
              />
              <Route
                path="cases/add"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CaseAddPage />
                  </Suspense>
                }
              />
              <Route
                path="cases/compare"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CaseComparePage />
                  </Suspense>
                }
              />
              <Route
                path="cases/:id"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CaseDetailPage />
                  </Suspense>
                }
              />
              <Route
                path="cases/:id/edit"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CaseEditPage />
                  </Suspense>
                }
              />
              <Route
                path="collections"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CollectionsPage />
                  </Suspense>
                }
              />
              <Route
                path="saved-searches"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <SavedSearchesPage />
                  </Suspense>
                }
              />
              <Route
                path="collections/:collectionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CollectionDetailPage />
                  </Suspense>
                }
              />
              <Route
                path="legislations"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <LegislationsPage />
                  </Suspense>
                }
              />
              <Route
                path="legislations/:legislationId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <LegislationDetailPage />
                  </Suspense>
                }
              />
              <Route
                path="taxonomy"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <SearchTaxonomyPage />
                  </Suspense>
                }
              />
              <Route
                path="search-taxonomy"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <SearchTaxonomyPage />
                  </Suspense>
                }
              />
              <Route
                path="guided-search"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <GuidedSearchPage />
                  </Suspense>
                }
              />
              <Route
                path="search/semantic"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <SemanticSearchPage />
                  </Suspense>
                }
              />
              <Route
                path="llm-council"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <LlmCouncilPage />
                  </Suspense>
                }
              />
              <Route
                path="llm-council/sessions"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <LlmCouncilSessionsPage />
                  </Suspense>
                }
              />
              <Route
                path="llm-council/sessions/:sessionId"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <LlmCouncilPage />
                  </Suspense>
                }
              />
              <Route
                path="download"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <DownloadPage />
                  </Suspense>
                }
              />
              <Route
                path="jobs"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <JobStatusPage />
                  </Suspense>
                }
              />
              <Route
                path="pipeline"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <PipelinePage />
                  </Suspense>
                }
              />
              <Route
                path="analytics"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <AnalyticsPage />
                  </Suspense>
                }
              />
              <Route
                path="court-lineage"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <CourtLineagePage />
                  </Suspense>
                }
              />
              <Route
                path="judge-profiles"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <JudgeProfilesPage />
                  </Suspense>
                }
              />
              <Route
                path="judge-profiles/compare"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <JudgeComparePage />
                  </Suspense>
                }
              />
              <Route
                path="judge-profiles/:name"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <JudgeDetailPage />
                  </Suspense>
                }
              />
              <Route
                path="data-dictionary"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <DataDictionaryPage />
                  </Suspense>
                }
              />
              <Route
                path="design-tokens"
                element={
                  <Suspense fallback={<PageLoader />}>
                    <DesignTokensPage />
                  </Suspense>
                }
              />
              </Route>
            </Routes>
          </BrowserRouter>
          <Toaster position="bottom-right" richColors />
        </QueryClientProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
