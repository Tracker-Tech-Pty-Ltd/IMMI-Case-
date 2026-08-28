import { lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { resolveRouterBasename } from "@/lib/router";
import { queryClient } from "@/lib/query-client";
import { AuthProvider } from "@/contexts/AuthContext";
import { ErrorBoundary, RouteBoundary } from "@/components/shared/RouteErrorBoundary";

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
const DataToolsPage = lazy(() =>
  import("@/pages/DataToolsPage").then((m) => ({ default: m.DataToolsPage })),
);
const AdminPipelineRunsPage = lazy(() =>
  import("@/pages/AdminPipelineRunsPage").then((m) => ({
    default: m.AdminPipelineRunsPage,
  })),
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
                  <RouteBoundary>
                    <LoginPage />
                  </RouteBoundary>
                }
              />
              <Route element={<AppLayout />}>
              <Route
                index
                element={
                  <RouteBoundary>
                    <DashboardPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="cases"
                element={
                  <RouteBoundary>
                    <CasesPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="cases/add"
                element={
                  <RouteBoundary>
                    <CaseAddPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="cases/compare"
                element={
                  <RouteBoundary>
                    <CaseComparePage />
                  </RouteBoundary>
                }
              />
              <Route
                path="cases/:id"
                element={
                  <RouteBoundary>
                    <CaseDetailPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="cases/:id/edit"
                element={
                  <RouteBoundary>
                    <CaseEditPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="collections"
                element={
                  <RouteBoundary>
                    <CollectionsPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="saved-searches"
                element={
                  <RouteBoundary>
                    <SavedSearchesPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="collections/:collectionId"
                element={
                  <RouteBoundary>
                    <CollectionDetailPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="legislations"
                element={
                  <RouteBoundary>
                    <LegislationsPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="legislations/:legislationId"
                element={
                  <RouteBoundary>
                    <LegislationDetailPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="taxonomy"
                element={
                  <RouteBoundary>
                    <SearchTaxonomyPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="search-taxonomy"
                element={
                  <RouteBoundary>
                    <SearchTaxonomyPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="guided-search"
                element={
                  <RouteBoundary>
                    <GuidedSearchPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="search/semantic"
                element={
                  <RouteBoundary>
                    <SemanticSearchPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="llm-council"
                element={
                  <RouteBoundary>
                    <LlmCouncilPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="llm-council/sessions"
                element={
                  <RouteBoundary>
                    <LlmCouncilSessionsPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="llm-council/sessions/:sessionId"
                element={
                  <RouteBoundary>
                    <LlmCouncilPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="data-tools"
                element={
                  <RouteBoundary>
                    <DataToolsPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="download"
                element={<Navigate to="/data-tools" replace />}
              />
              <Route
                path="jobs"
                element={<Navigate to="/data-tools" replace />}
              />
              <Route
                path="pipeline"
                element={<Navigate to="/data-tools" replace />}
              />
              <Route
                path="admin/pipeline-runs"
                element={
                  <RouteBoundary>
                    <AdminPipelineRunsPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="analytics"
                element={
                  <RouteBoundary>
                    <AnalyticsPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="court-lineage"
                element={
                  <RouteBoundary>
                    <CourtLineagePage />
                  </RouteBoundary>
                }
              />
              <Route
                path="judge-profiles"
                element={
                  <RouteBoundary>
                    <JudgeProfilesPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="judge-profiles/compare"
                element={
                  <RouteBoundary>
                    <JudgeComparePage />
                  </RouteBoundary>
                }
              />
              <Route
                path="judge-profiles/:name"
                element={
                  <RouteBoundary>
                    <JudgeDetailPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="data-dictionary"
                element={
                  <RouteBoundary>
                    <DataDictionaryPage />
                  </RouteBoundary>
                }
              />
              <Route
                path="design-tokens"
                element={
                  <RouteBoundary>
                    <DesignTokensPage />
                  </RouteBoundary>
                }
              />
              </Route>
            </Routes>
          </BrowserRouter>
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            duration={5000}
            visibleToasts={3}
          />
        </QueryClientProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
