/**
 * Route parameter guards — behavioural.
 *
 * Renders the real pages inside a real MemoryRouter and asserts that a missing
 * :id route param actually redirects to /cases. react-router-dom is
 * deliberately NOT mocked: mocking useParams/Navigate would make these tests
 * pass against a guard sitting in an unreachable branch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockUseCase } = vi.hoisted(() => ({ mockUseCase: vi.fn() }));

vi.mock("@/hooks/use-cases", () => ({
  useCase: mockUseCase,
  useRelatedCases: vi.fn(() => ({ data: { cases: [] }, isLoading: false })),
  useDeleteCase: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useUpdateCase: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock("@/hooks/use-similar-cases", () => ({
  useSimilarCases: vi.fn(() => ({
    data: { similar: [], available: false },
    isLoading: false,
    isError: false,
    error: null,
  })),
}));

import { CaseDetailPage } from "@/pages/CaseDetailPage";
import { CaseEditPage } from "@/pages/CaseEditPage";

const CASES_SENTINEL = "cases-list-sentinel";

/**
 * Render `page` at `entry`. `routePath` is a route pattern with no :id
 * segment, so useParams() yields {} and the component's `id` is undefined.
 * `React.ReactElement` resolves via @types/react's ambient global namespace
 * (see __tests__/success-rate-deep-modal.test.tsx for the same convention);
 * no explicit React import is needed under the "react-jsx" transform, and
 * one that is never used as a value would fail noUnusedLocals /
 * verbatimModuleSyntax.
 */
function renderAt(
  page: React.ReactElement,
  routePath: string,
  entry: string,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path={routePath} element={page} />
          <Route
            path="/cases"
            element={<div data-testid={CASES_SENTINEL}>Cases list</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Route parameter guards", () => {
  beforeEach(() => {
    mockUseCase.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("CaseDetailPage redirects to /cases when the :id route param is absent", () => {
    renderAt(<CaseDetailPage />, "/cases/detail", "/cases/detail");
    expect(screen.getByTestId(CASES_SENTINEL)).toBeInTheDocument();
  });

  it("CaseDetailPage does not redirect when :id is present", () => {
    renderAt(<CaseDetailPage />, "/cases/:id", "/cases/abc123456789");
    expect(screen.queryByTestId(CASES_SENTINEL)).not.toBeInTheDocument();
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });

  it("CaseEditPage redirects to /cases when the :id route param is absent", () => {
    renderAt(<CaseEditPage />, "/cases/edit", "/cases/edit");
    expect(screen.getByTestId(CASES_SENTINEL)).toBeInTheDocument();
  });

  it("CaseEditPage does not redirect when :id is present", () => {
    renderAt(<CaseEditPage />, "/cases/:id/edit", "/cases/abc123456789/edit");
    expect(screen.queryByTestId(CASES_SENTINEL)).not.toBeInTheDocument();
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });
});
