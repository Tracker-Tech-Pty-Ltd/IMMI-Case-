import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SimilarCasesPanel } from "@/components/cases/SimilarCasesPanel";
import type { SimilarCase } from "@/types/case";

const mockCases: SimilarCase[] = [
  {
    case_id: "abc123456789",
    citation: "[2023] AATA 1001",
    title: "Smith and Minister for Immigration",
    outcome: "Affirmed",
    similarity_score: 0.94,
  },
  {
    case_id: "def456789012",
    citation: "[2022] AATA 500",
    title: "Jones v MIBP",
    outcome: "Set Aside",
    similarity_score: 0.87,
  },
  {
    case_id: "ghi012345678",
    citation: "[2021] FCA 200",
    title: "Nguyen and Secretary",
    outcome: "Dismissed",
    similarity_score: 0.75,
  },
];

// Case with no citation — title should be shown instead
const mockCasesNoCitation: SimilarCase[] = [
  {
    case_id: "zzz999888777",
    citation: "",
    title: "Re Anonymous Visa Applicant",
    outcome: "",
    similarity_score: 0.61,
  },
];

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("SimilarCasesPanel", () => {
  it("shows skeleton rows while loading", () => {
    wrap(<SimilarCasesPanel cases={undefined} isLoading={true} />);
    expect(screen.getByTestId("similar-cases-skeleton")).toBeInTheDocument();
  });

  it("skeleton container contains 3 animated placeholder items", () => {
    const { container } = wrap(
      <SimilarCasesPanel cases={undefined} isLoading={true} />,
    );
    const skeleton = screen.getByTestId("similar-cases-skeleton");
    const items = skeleton.querySelectorAll(".animate-pulse");
    expect(items.length).toBe(3);
  });

  it("shows empty message when no cases found", () => {
    wrap(<SimilarCasesPanel cases={[]} isLoading={false} />);
    expect(screen.getByTestId("similar-cases-empty")).toBeInTheDocument();
    expect(screen.getByText(/no similar cases/i)).toBeInTheDocument();
  });

  it("shows empty message when cases is undefined and not loading", () => {
    wrap(
      <SimilarCasesPanel
        cases={undefined}
        isLoading={false}
        available={true}
      />,
    );
    expect(screen.getByTestId("similar-cases-empty")).toBeInTheDocument();
  });

  it("renders a list of similar cases", () => {
    wrap(<SimilarCasesPanel cases={mockCases} isLoading={false} />);
    expect(screen.getByTestId("similar-cases-list")).toBeInTheDocument();
    const items = screen.getAllByTestId("similar-case-item");
    expect(items).toHaveLength(3);
  });

  it("renders citations as link text", () => {
    wrap(<SimilarCasesPanel cases={mockCases} isLoading={false} />);
    expect(screen.getByText("[2023] AATA 1001")).toBeInTheDocument();
    expect(screen.getByText("[2022] AATA 500")).toBeInTheDocument();
  });

  it("falls back to title when citation is empty", () => {
    wrap(<SimilarCasesPanel cases={mockCasesNoCitation} isLoading={false} />);
    expect(screen.getByText("Re Anonymous Visa Applicant")).toBeInTheDocument();
  });

  it("renders similarity scores as percentages", () => {
    wrap(<SimilarCasesPanel cases={mockCases} isLoading={false} />);
    const scores = screen.getAllByTestId("similarity-score");
    expect(scores[0]).toHaveTextContent("94%");
    expect(scores[1]).toHaveTextContent("87%");
    expect(scores[2]).toHaveTextContent("75%");
  });

  it("links each case to the correct detail URL", () => {
    wrap(<SimilarCasesPanel cases={mockCases} isLoading={false} />);
    const items = screen.getAllByTestId("similar-case-item");
    expect(items[0]).toHaveAttribute("href", "/cases/abc123456789");
    expect(items[1]).toHaveAttribute("href", "/cases/def456789012");
    expect(items[2]).toHaveAttribute("href", "/cases/ghi012345678");
  });

  it("does not render when available is false and not loading", () => {
    const { container } = wrap(
      <SimilarCasesPanel cases={[]} isLoading={false} available={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the section heading 'Similar Cases'", () => {
    wrap(<SimilarCasesPanel cases={mockCases} isLoading={false} />);
    expect(
      screen.getByRole("heading", { name: /similar cases/i }),
    ).toBeInTheDocument();
  });

  it("shows outcome badge when outcome is present", () => {
    wrap(<SimilarCasesPanel cases={mockCases} isLoading={false} />);
    // OutcomeBadge summarizes "Affirmed" → "Affirmed"
    expect(screen.getByText("Affirmed")).toBeInTheDocument();
  });

  it("does not crash when outcome is empty string", () => {
    wrap(<SimilarCasesPanel cases={mockCasesNoCitation} isLoading={false} />);
    // No outcome badge for empty outcome — component should render without error
    const items = screen.getAllByTestId("similar-case-item");
    expect(items).toHaveLength(1);
  });
});
