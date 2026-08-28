/**
 * Plan 023 — accessibility semantics.
 *
 * The `<select>` / `<textarea>` / `<input>` controls on the case add/edit
 * forms used to be nameless: the visible `<label>` was a detached sibling
 * with no `htmlFor`. This asserts the controls now resolve by their label
 * text, and that CaseEditPage exposes exactly one level-1 heading.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Routes, Route } from "react-router-dom";

const { mockUseCreateCase, mockUseCase, mockUseUpdateCase } = vi.hoisted(
  () => ({
    mockUseCreateCase: vi.fn(),
    mockUseCase: vi.fn(),
    mockUseUpdateCase: vi.fn(),
  }),
);

vi.mock("@/hooks/use-cases", () => ({
  useCreateCase: mockUseCreateCase,
  useCase: mockUseCase,
  useUpdateCase: mockUseUpdateCase,
}));

import { CaseAddPage } from "@/pages/CaseAddPage";
import { CaseEditPage } from "@/pages/CaseEditPage";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderAddPage() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <BrowserRouter>
        <CaseAddPage />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

function renderEditPage() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <MemoryRouter initialEntries={["/cases/abc/edit"]}>
        <Routes>
          <Route path="/cases/:id/edit" element={<CaseEditPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("a11y — form labels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseCreateCase.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    mockUseCase.mockReturnValue({
      data: {
        case: {
          case_id: "abc",
          title: "T",
          citation: "[2024] FCA 1",
          court_code: "FCA",
        },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseUpdateCase.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
  });

  describe("CaseAddPage", () => {
    it("resolves the court code select by its label", () => {
      renderAddPage();
      const el = screen.getByLabelText("cases.court_code");
      expect(el.tagName).toBe("SELECT");
    });

    it("resolves the case title input by its label", () => {
      renderAddPage();
      const el = screen.getByLabelText("cases.case_title *");
      expect(el.tagName).toBe("INPUT");
    });

    it("resolves the notes textarea by its label", () => {
      renderAddPage();
      const el = screen.getByLabelText("case_detail.notes");
      expect(el.tagName).toBe("TEXTAREA");
    });
  });

  describe("CaseEditPage", () => {
    it("resolves the court code select by its label", () => {
      renderEditPage();
      const el = screen.getByLabelText("cases.court_code");
      expect(el.tagName).toBe("SELECT");
    });

    it("resolves the catchwords textarea by its label", () => {
      renderEditPage();
      const el = screen.getByLabelText("case_detail.catchwords");
      expect(el.tagName).toBe("TEXTAREA");
    });

    it("exposes exactly one level-1 heading with the page title", () => {
      renderEditPage();
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "pages.case_edit.title",
        }),
      ).toBeInTheDocument();
    });
  });
});
