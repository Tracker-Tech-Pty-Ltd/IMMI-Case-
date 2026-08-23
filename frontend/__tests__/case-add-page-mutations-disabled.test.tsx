/**
 * CaseAddPage — case mutation write-freeze handling.
 *
 * When the backend rejects a create with the typed 503
 * `case_mutations_disabled` error, the page must show the inline
 * migration notice instead of a raw/generic toast, and must NOT clear
 * the form (the user's input must still be visible in the fields).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import React from "react";
import { ApiError, CASE_MUTATIONS_DISABLED_CODE } from "@/lib/api";

const { mockUseCreateCase } = vi.hoisted(() => ({
  mockUseCreateCase: vi.fn(),
}));

vi.mock("@/hooks/use-cases", () => ({
  useCreateCase: mockUseCreateCase,
}));

import { CaseAddPage } from "@/pages/CaseAddPage";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage() {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <BrowserRouter>
        <CaseAddPage />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

describe("CaseAddPage — case_mutations_disabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the read-only migration notice and keeps the entered title on a 503 case_mutations_disabled response", async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(
        new ApiError(
          "Case mutations are disabled during migration freeze",
          503,
          CASE_MUTATIONS_DISABLED_CODE,
        ),
      );
    mockUseCreateCase.mockReturnValue({ mutateAsync, isPending: false });

    const { container } = renderPage();

    const titleInput = screen.getAllByRole("textbox")[0] as HTMLInputElement;
    fireEvent.change(titleInput, {
      target: { value: "Nguyen v Minister for Immigration" },
    });

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    // Notice renders — asserted primarily by testid so this stays robust
    // regardless of how the i18n mock resolves `t(key, { defaultValue })`.
    const notice = await waitFor(() =>
      screen.getByTestId("case-mutations-disabled-notice"),
    );
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toContain(
      "Case editing is temporarily read-only",
    );

    // Form input was NOT cleared — the user's typed title is still there.
    expect(titleInput.value).toBe("Nguyen v Minister for Immigration");

    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("does not show the migration notice for an unrelated create failure", async () => {
    const mutateAsync = vi
      .fn()
      .mockRejectedValue(new Error("Network request failed"));
    mockUseCreateCase.mockReturnValue({ mutateAsync, isPending: false });

    const { container } = renderPage();

    const titleInput = screen.getAllByRole("textbox")[0] as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Some Case" } });

    const form = container.querySelector("form");
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });

    expect(
      screen.queryByTestId("case-mutations-disabled-notice"),
    ).not.toBeInTheDocument();
  });
});
