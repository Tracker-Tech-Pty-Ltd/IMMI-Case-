import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageLoader } from "@/components/shared/PageLoader";

const DashboardPage = lazy(() =>
  import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage }))
);
const CasesPage = lazy(() =>
  import("@/pages/CasesPage").then((m) => ({ default: m.CasesPage }))
);
const CaseDetailPage = lazy(() =>
  import("@/pages/CaseDetailPage").then((m) => ({
    default: m.CaseDetailPage,
  }))
);
const CaseEditPage = lazy(() =>
  import("@/pages/CaseEditPage").then((m) => ({ default: m.CaseEditPage }))
);
const CaseAddPage = lazy(() =>
  import("@/pages/CaseAddPage").then((m) => ({ default: m.CaseAddPage }))
);
const CaseComparePage = lazy(() =>
  import("@/pages/CaseComparePage").then((m) => ({
    default: m.CaseComparePage,
  }))
);
const DownloadPage = lazy(() =>
  import("@/pages/DownloadPage").then((m) => ({ default: m.DownloadPage }))
);
const JobStatusPage = lazy(() =>
  import("@/pages/JobStatusPage").then((m) => ({ default: m.JobStatusPage }))
);
const PipelinePage = lazy(() =>
  import("@/pages/PipelinePage").then((m) => ({ default: m.PipelinePage }))
);
const DataDictionaryPage = lazy(() =>
  import("@/pages/DataDictionaryPage").then((m) => ({
    default: m.DataDictionaryPage,
  }))
);
const DesignTokensPage = lazy(() =>
  import("@/pages/DesignTokensPage").then((m) => ({
    default: m.DesignTokensPage,
  }))
);
const AnalyticsPage = lazy(() =>
  import("@/pages/AnalyticsPage").then((m) => ({ default: m.AnalyticsPage }))
);
const JudgeProfilesPage = lazy(() =>
  import("@/pages/JudgeProfilesPage").then((m) => ({
    default: m.JudgeProfilesPage,
  }))
);
const JudgeDetailPage = lazy(() =>
  import("@/pages/JudgeDetailPage").then((m) => ({
    default: m.JudgeDetailPage,
  }))
);
const JudgeComparePage = lazy(() =>
  import("@/pages/JudgeComparePage").then((m) => ({
    default: m.JudgeComparePage,
  }))
);
const LegislationsPage = lazy(() =>
  import("@/pages/LegislationsPage").then((m) => ({
    default: m.LegislationsPage,
  }))
);
const LegislationDetailPage = lazy(() =>
  import("@/pages/LegislationDetailPage").then((m) => ({
    default: m.LegislationDetailPage,
  }))
);
const TaxonomyPage = lazy(() =>
  import("@/pages/TaxonomyPage").then((m) => ({ default: m.TaxonomyPage }))
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/app">
        <Routes>
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
                  <TaxonomyPage />
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
  );
}
