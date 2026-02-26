import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdvancedFilterPanel } from "@/components/analytics/AdvancedFilterPanel";

// AdvancedFilterPanel now expects AnalyticsFilterOption[] (objects with value/count)
// instead of plain string[]. Panel is also collapsible — starts closed.

const defaultProps = {
  caseNatures: [
    { value: "Visa Refusal", count: 100 },
    { value: "Protection Visa", count: 80 },
    { value: "Judicial Review", count: 60 },
  ],
  visaSubclasses: [
    { value: "866", count: 50 },
    { value: "457", count: 40 },
    { value: "500", count: 30 },
    { value: "309", count: 20 },
  ],
  outcomeTypes: [
    { value: "Affirmed", count: 70 },
    { value: "Dismissed", count: 50 },
    { value: "Remitted", count: 30 },
    { value: "Set Aside", count: 20 },
  ],
  selectedNatures: [] as string[],
  selectedSubclasses: [] as string[],
  selectedOutcomes: [] as string[],
  onNaturesChange: vi.fn(),
  onSubclassesChange: vi.fn(),
  onOutcomesChange: vi.fn(),
};

/** Panel starts collapsed. Click the header button to expand. */
function expandPanel() {
  fireEvent.click(screen.getByRole("button", { name: /Advanced Filters/i }));
}

describe("AdvancedFilterPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders three filter sections when expanded", () => {
    render(<AdvancedFilterPanel {...defaultProps} />);
    expandPanel();
    expect(screen.getByText(/Case Nature/i)).toBeInTheDocument();
    expect(screen.getByText(/Visa Subclass/i)).toBeInTheDocument();
    expect(screen.getByText(/Outcome/i)).toBeInTheDocument();
  });

  it("renders case nature pills when expanded", () => {
    render(<AdvancedFilterPanel {...defaultProps} />);
    expandPanel();
    // Buttons include a count badge so use regex to match by label substring
    expect(screen.getByRole("button", { name: /Visa Refusal/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Protection Visa/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Judicial Review/i })).toBeInTheDocument();
  });

  it("calls onNaturesChange when nature pill clicked", () => {
    const onNaturesChange = vi.fn();
    render(
      <AdvancedFilterPanel
        {...defaultProps}
        onNaturesChange={onNaturesChange}
      />,
    );
    expandPanel();
    fireEvent.click(screen.getByRole("button", { name: /Protection Visa/i }));
    expect(onNaturesChange).toHaveBeenCalledWith(["Protection Visa"]);
  });

  it("deselects nature when already selected", () => {
    const onNaturesChange = vi.fn();
    render(
      <AdvancedFilterPanel
        {...defaultProps}
        selectedNatures={["Protection Visa"]}
        onNaturesChange={onNaturesChange}
      />,
    );
    expandPanel();
    // When selected, there's also a chip "Case Nature: Protection Visa x".
    // Use /^Protection Visa/ to match only the filter pill (starts with value).
    fireEvent.click(screen.getByRole("button", { name: /^Protection Visa/ }));
    expect(onNaturesChange).toHaveBeenCalledWith([]);
  });

  it("renders visa subclass pills when expanded", () => {
    render(<AdvancedFilterPanel {...defaultProps} />);
    expandPanel();
    expect(screen.getByRole("button", { name: /^866/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^457/ })).toBeInTheDocument();
  });

  it("calls onSubclassesChange when subclass pill clicked", () => {
    const onSubclassesChange = vi.fn();
    render(
      <AdvancedFilterPanel
        {...defaultProps}
        onSubclassesChange={onSubclassesChange}
      />,
    );
    expandPanel();
    fireEvent.click(screen.getByRole("button", { name: /^866/ }));
    expect(onSubclassesChange).toHaveBeenCalledWith(["866"]);
  });

  it("renders outcome pills when expanded", () => {
    render(<AdvancedFilterPanel {...defaultProps} />);
    expandPanel();
    expect(screen.getByRole("button", { name: /^Affirmed/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Dismissed/ })).toBeInTheDocument();
  });

  it("shows active count badge when filters are selected", () => {
    // Badge lives in the header toggle button — always visible, no expand needed
    render(
      <AdvancedFilterPanel
        {...defaultProps}
        selectedNatures={["Visa Refusal", "Protection Visa"]}
        selectedOutcomes={["Affirmed"]}
      />,
    );
    expect(screen.getByTestId("active-filter-count")).toHaveTextContent("3");
  });

  it("has a clear all button that resets all filters", () => {
    const onNaturesChange = vi.fn();
    const onSubclassesChange = vi.fn();
    const onOutcomesChange = vi.fn();
    render(
      <AdvancedFilterPanel
        {...defaultProps}
        selectedNatures={["Visa Refusal"]}
        selectedOutcomes={["Affirmed"]}
        onNaturesChange={onNaturesChange}
        onSubclassesChange={onSubclassesChange}
        onOutcomesChange={onOutcomesChange}
      />,
    );
    expandPanel();
    // Clear filters button only appears when panel is expanded AND activeCount > 0
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onNaturesChange).toHaveBeenCalledWith([]);
    expect(onSubclassesChange).toHaveBeenCalledWith([]);
    expect(onOutcomesChange).toHaveBeenCalledWith([]);
  });
});
