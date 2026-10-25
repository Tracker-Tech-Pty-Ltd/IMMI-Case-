import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CaseEditPage } from "@/pages/CaseEditPage";

const { useCaseMock, update } = vi.hoisted(() => ({ useCaseMock: vi.fn(), update: vi.fn() }));
vi.mock("@/hooks/use-cases", () => ({
  useCase: useCaseMock,
  useUpdateCase: () => ({ mutateAsync: update, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function openEditor(notes?: string) {
  useCaseMock.mockReturnValue({
    data: { case: { case_id: "0123456789ab", title: "Original", ...(notes === undefined ? {} : { user_notes: notes }) } },
    isLoading: false, isError: false, refetch: vi.fn(),
  });
  render(<MemoryRouter initialEntries={["/cases/0123456789ab/edit"]}>
    <Routes><Route path="/cases/:id/edit" element={<CaseEditPage />} /></Routes>
  </MemoryRouter>);
}

describe("case editing with withheld private annotations", () => {
  beforeEach(() => { vi.clearAllMocks(); update.mockResolvedValue({}); });

  it("does not offer or overwrite a private field absent from the response", async () => {
    openEditor();
    expect(screen.queryByLabelText("case_detail.notes")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("cases.case_title *"), { target: { value: "Updated" } });
    fireEvent.click(screen.getByRole("button", { name: "pages.case_edit.save_button" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(JSON.stringify(update.mock.calls[0])).not.toContain("user_notes");
  });

  it("preserves editing when a local backend explicitly provides notes", async () => {
    openEditor("My note");
    fireEvent.change(screen.getByLabelText("case_detail.notes"), { target: { value: "Revised note" } });
    fireEvent.click(screen.getByRole("button", { name: "pages.case_edit.save_button" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(JSON.stringify(update.mock.calls[0])).toContain('"user_notes":"Revised note"');
  });
});
