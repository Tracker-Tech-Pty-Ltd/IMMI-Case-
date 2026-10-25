/**
 * Plan 023 — accessibility semantics.
 *
 * MobileNav used to be a hand-rolled drawer that claimed
 * `aria-modal="true"` with no focus trap, no focus move on open and no
 * focus restore on close. It is now built on @radix-ui/react-dialog.
 * This asserts the drawer exposes real dialog semantics, that focus
 * lands inside it on open, that the Playwright class-chain selector
 * survives, that Escape closes it, and that the media-query guard
 * closes it if the viewport reaches desktop width while it is open
 * (the regression test for the "invisible modal after resize" bug).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MobileNav } from "@/components/layout/MobileNav";

vi.mock("@/hooks/use-saved-searches", () => ({
  useSavedSearches: () => ({ savedSearches: [] }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false }),
}));

function renderNav(open: boolean, onClose: () => void) {
  return render(
    <MemoryRouter>
      <MobileNav open={open} onClose={onClose} />
    </MemoryRouter>,
  );
}

function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches: initialMatches,
    media: "(min-width: 1024px)",
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (
      _: string,
      l: (e: MediaQueryListEvent) => void,
    ) => {
      listeners.add(l);
    },
    removeEventListener: (
      _: string,
      l: (e: MediaQueryListEvent) => void,
    ) => {
      listeners.delete(l);
    },
    dispatchEvent: () => false,
  };
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: () => mql,
  });
  return {
    goDesktop() {
      mql.matches = true;
      listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent));
    },
  };
}

describe("a11y — MobileNav", () => {
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it("exposes role=dialog named IMMI-Case when open", () => {
    renderNav(true, vi.fn());
    expect(
      screen.getByRole("dialog", { name: "IMMI-Case" }),
    ).toBeInTheDocument();
  });

  it("moves focus into the drawer on open", () => {
    renderNav(true, vi.fn());
    const dialog = screen.getByRole("dialog");
    expect(
      dialog === document.activeElement || dialog.contains(document.activeElement),
    ).toBe(true);
  });

  it("keeps the Playwright class-chain selector intact", () => {
    renderNav(true, vi.fn());
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveClass("fixed", "inset-y-0", "left-0", "lg:hidden");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderNav(true, onClose);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("renders no dialog when closed", () => {
    renderNav(false, vi.fn());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("resize-to-desktop guard", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("stays open on mobile and does not call onClose", () => {
      const controls = stubMatchMedia(false);
      const onClose = vi.fn();
      renderNav(true, onClose);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
      void controls;
    });

    it("closes when the viewport resizes to desktop", () => {
      const controls = stubMatchMedia(false);
      const onClose = vi.fn();
      renderNav(true, onClose);
      act(() => controls.goDesktop());
      expect(onClose).toHaveBeenCalled();
    });

    it("closes immediately if already desktop when opened", () => {
      stubMatchMedia(true);
      const onClose = vi.fn();
      renderNav(true, onClose);
      expect(onClose).toHaveBeenCalled();
    });
  });
});
