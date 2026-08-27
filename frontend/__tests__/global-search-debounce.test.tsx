import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const { mockUseSearchCases } = vi.hoisted(() => ({
  mockUseSearchCases: vi.fn(),
}));

vi.mock("@/hooks/use-cases", () => ({
  useSearchCases: mockUseSearchCases,
}));

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigateMock() }));

// Radix's Dialog is only the presentation shell here. Replacing it with plain
// elements keeps this test about the debounce and avoids running Radix's
// focus-trap and scroll-lock timers under vi.useFakeTimers().
vi.mock("@radix-ui/react-dialog", () => {
  type P = { children?: React.ReactNode };
  return {
    Root: ({ children }: P) => <div>{children}</div>,
    Portal: ({ children }: P) => <div>{children}</div>,
    Overlay: () => null,
    Content: ({ children }: P) => <div>{children}</div>,
    Title: ({ children }: P) => <h2>{children}</h2>,
  };
});

import { GlobalSearch } from "@/components/shared/GlobalSearch";

function queriesSeen(): string[] {
  return mockUseSearchCases.mock.calls.map((call) => call[0] as string);
}

function typeAll(values: string[]) {
  const input = screen.getByRole("combobox");
  for (const value of values) {
    fireEvent.change(input, { target: { value } });
  }
}

describe("GlobalSearch debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseSearchCases.mockReset();
    mockUseSearchCases.mockReturnValue({ data: { cases: [] } });
    navigateMock.mockReset();
    navigateMock.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not issue a query for every keystroke", () => {
    render(<GlobalSearch open onClose={() => {}} />);
    typeAll(["m", "mi", "mig", "migr"]);

    expect(queriesSeen()).not.toContain("mi");
    expect(queriesSeen()).not.toContain("mig");
    expect(queriesSeen()).not.toContain("migr");
  });

  it("issues one query, for the final value, once the debounce elapses", () => {
    render(<GlobalSearch open onClose={() => {}} />);
    typeAll(["m", "mi", "mig", "migr"]);

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(queriesSeen().filter((q) => q.length > 0)).toEqual(["migr"]);
  });

  it("never searches for a single character", () => {
    render(<GlobalSearch open onClose={() => {}} />);
    typeAll(["m"]);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(queriesSeen().every((q) => q === "")).toBe(true);
  });

  it("does not claim 'no results' while the debounce is still pending", () => {
    render(<GlobalSearch open onClose={() => {}} />);
    typeAll(["zz"]);

    // The i18n mock in __tests__/legislations-setup.ts returns the key string.
    expect(screen.queryByText("common.no_results")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.getByText("common.no_results")).toBeTruthy();
  });

  it("does not navigate to a previous query's result during the debounce", () => {
    // The regression this guards: type "smith", let it resolve, type "jones",
    // press Enter inside the 300ms window. Without the staleness gate the
    // Enter handler reads cases[clampedActiveIdx] — still a Smith case — and
    // navigates there.
    const navigate = vi.fn();
    navigateMock.mockReturnValue(navigate);
    mockUseSearchCases.mockReturnValue({
      data: {
        cases: [
          {
            case_id: "smithcase01",
            title: "Smith v Minister",
            citation: "[2024] FCA 1",
            court_code: "FCA",
            date: "2024-01-01",
          },
        ],
      },
    });

    render(<GlobalSearch open onClose={() => {}} />);
    typeAll(["smith"]);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // The result is on screen and selectable for the settled query.
    expect(screen.getByText("Smith v Minister")).toBeTruthy();

    // Now type a different query and hit Enter before the debounce elapses.
    typeAll(["jones"]);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.queryByText("Smith v Minister")).toBeNull();
  });

  it("does not let a click land on a previous query's result either", () => {
    const navigate = vi.fn();
    navigateMock.mockReturnValue(navigate);
    mockUseSearchCases.mockReturnValue({
      data: {
        cases: [
          {
            case_id: "smithcase01",
            title: "Smith v Minister",
            citation: "[2024] FCA 1",
            court_code: "FCA",
            date: "2024-01-01",
          },
        ],
      },
    });

    render(<GlobalSearch open onClose={() => {}} />);
    typeAll(["smith"]);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    typeAll(["jones"]);

    // The row must be gone, not merely non-navigating.
    expect(screen.queryByRole("option")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
