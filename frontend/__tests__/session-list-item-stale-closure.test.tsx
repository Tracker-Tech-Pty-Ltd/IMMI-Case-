/**
 * frontend/__tests__/session-list-item-stale-closure.test.tsx
 *
 * Vitest pin for US-014: SessionListItem must delete the session_id captured
 * at click-time, not whatever session prop the component currently holds when
 * the user confirms the modal.
 *
 * Background: e2e step 7 (test_council_thread_visual.py:306-314) captured
 * DELETE requests targeting a session_id NOT in the rendered sidebar
 * (N83Vk... vs L291...). Root cause was handleConfirm reading
 * session.session_id from props at confirm-time, so a TanStack Query refetch
 * or React 18 concurrent render between the hover-click and the modal-confirm
 * could swap the captured id out from under the user.
 *
 * The fix snapshots session_id into local state when the delete button is
 * clicked. This test would have caught the regression: it renders with
 * session A, clicks delete (opens modal), rerenders with session B (simulates
 * the concurrent-render race), then clicks confirm and asserts onDelete was
 * called with A.session_id, NOT B.session_id.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { SessionListItem } from "@/components/llm-council/SessionListItem";
import type { LlmCouncilSessionListItem } from "@/lib/api-llm-council";

function makeSession(
  id: string,
  title: string
): LlmCouncilSessionListItem {
  return {
    session_id: id,
    title,
    total_turns: 1,
    updated_at: new Date().toISOString(),
  };
}

function renderItem(
  session: LlmCouncilSessionListItem,
  onDelete: (id: string) => void
) {
  return render(
    <MemoryRouter>
      <SessionListItem session={session} onDelete={onDelete} />
    </MemoryRouter>
  );
}

describe("SessionListItem — US-014 stale-closure pin", () => {
  it("deletes the session that was visible at click-time, not the one visible at confirm-time", async () => {
    const sessionA = makeSession("SESSION-A", "Alpha session");
    const sessionB = makeSession("SESSION-B", "Bravo session");
    const onDelete = vi.fn();
    const user = userEvent.setup();

    const { rerender } = renderItem(sessionA, onDelete);

    await user.click(screen.getByTestId("session-delete-btn"));

    rerender(
      <MemoryRouter>
        <SessionListItem session={sessionB} onDelete={onDelete} />
      </MemoryRouter>
    );

    const confirmBtn = await screen.findByRole("button", { name: "Delete" });
    await user.click(confirmBtn);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("SESSION-A");
    expect(onDelete).not.toHaveBeenCalledWith("SESSION-B");
  });

  it("calls onDelete with the current session_id when no concurrent rerender happens", async () => {
    const session = makeSession("SESSION-ONLY", "Only session");
    const onDelete = vi.fn();
    const user = userEvent.setup();

    renderItem(session, onDelete);

    await user.click(screen.getByTestId("session-delete-btn"));
    const confirmBtn = await screen.findByRole("button", { name: "Delete" });
    await user.click(confirmBtn);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("SESSION-ONLY");
  });

  it("does not call onDelete when the user cancels the modal", async () => {
    const session = makeSession("SESSION-CANCEL", "Cancel me");
    const onDelete = vi.fn();
    const user = userEvent.setup();

    renderItem(session, onDelete);

    await user.click(screen.getByTestId("session-delete-btn"));
    const cancelBtn = await screen.findByRole("button", { name: /cancel/i });
    await user.click(cancelBtn);

    expect(onDelete).not.toHaveBeenCalled();
  });
});
