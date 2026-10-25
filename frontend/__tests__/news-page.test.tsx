import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NewsPage } from "@/pages/NewsPage";
import en from "@/i18n/locales/en.json";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, options?: Record<string, unknown>) => {
      let result: unknown = en;
      for (const part of key.split(".")) result = (result as Record<string, unknown> | undefined)?.[part];
      const value = typeof result === "string" ? result : String(options?.defaultValue ?? key);
      return value.replace(/{{(\w+)}}/g, (_, name: string) => String(options?.[name] ?? ""));
    },
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}
function renderNews(path = "/news") {
  return render(<MemoryRouter initialEntries={[path]}><NewsPage /><LocationProbe /></MemoryRouter>);
}

describe("NewsPage reading and filtering", () => {
  it("shows actual source, publication date and safe original links", () => {
    renderNews();
    expect(screen.getByRole("heading", { name: "News updates", level: 1 })).toBeInTheDocument();
    const featured = screen.getByRole("article", { name: "Student visa reform announcement" });
    expect(within(featured).getByText("Home Affairs ministerial releases")).toBeInTheDocument();
    expect(within(featured).getByText("2 Oct 2026")).toHaveAttribute("datetime", "2026-10-02");
    const link = within(featured).getByRole("link", { name: /Open original/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("href", "https://minister.homeaffairs.gov.au/JulianHill/Pages/student-visa-integrity-reforms-take-effect-today.aspx");
  });

  it("restores shared category, source and date filters from the URL", () => {
    renderNews("/news?category=tribunal&source=art&from=2026-06-01&to=2026-07-01");
    expect(screen.getByRole("button", { name: "Tribunal news" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Source")).toHaveValue("art");
    expect(screen.getByLabelText("Published from")).toHaveValue("2026-06-01");
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByRole("article", { name: "ART announces application fee increases" })).toBeInTheDocument();
  });

  it("searches a Chinese title in the English UI and resets pagination", () => {
    renderNews("/news?page=2");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search news titles or sources" }), { target: { value: "逐字稿" } });
    expect(screen.getByRole("article", { name: "Court updates the transcript request process" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByTestId("location").textContent).not.toContain("page=");
  });

  it("recovers from no results without losing the research links", () => {
    renderNews("/news?q=does-not-exist");
    expect(screen.getByText("No updates match these filters")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Return to case database/ })).toHaveAttribute("href", "/cases");
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    expect(screen.getByRole("article", { name: "Student visa reform announcement" })).toBeInTheDocument();
  });

  it("changes list pages and retains other URL filters", () => {
    renderNews("/news?from=2026-01-01");
    const before = screen.getAllByRole("article").map((item) => item.getAttribute("aria-labelledby"));
    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
    expect(screen.getByTestId("location").textContent).toContain("from=2026-01-01");
    expect(screen.getByTestId("location").textContent).toContain("page=2");
    expect(screen.getAllByRole("article").map((item) => item.getAttribute("aria-labelledby"))).not.toEqual(before);
  });

  it("exposes native summaries with the source-check date", () => {
    renderNews("/news?q=transcript");
    const article = screen.getByRole("article", { name: "Court updates the transcript request process" });
    const disclosure = within(article).getByText(/Read summary/).closest("details")!;
    fireEvent.click(disclosure.querySelector("summary")!);
    expect(within(article).getByText(/No transcript request is submitted/)).toBeInTheDocument();
    expect(within(article).getByText("Source checked")).toBeInTheDocument();
  });

  it("keeps direct page selection and result counts in the editorial pagination", () => {
    renderNews("/news?from=2026-01-01");
    fireEvent.change(screen.getByRole("combobox", { name: "Choose news page" }), { target: { value: "3" } });
    expect(screen.getByTestId("location").textContent).toContain("page=3");
    expect(screen.getByTestId("location").textContent).toContain("from=2026-01-01");
    expect(screen.getByRole("button", { name: "Go to next page" })).toBeDisabled();
    expect(screen.getByText("Showing 7-7 of 7")).toBeInTheDocument();
  });

  it("keeps the from/to range valid when one boundary crosses the other", () => {
    renderNews("/news?from=2026-06-01&to=2026-07-01&page=2");
    fireEvent.change(screen.getByLabelText("Published from"), { target: { value: "2026-10-01" } });
    expect(screen.getByLabelText("Published through")).toHaveValue("2026-10-01");
    expect(screen.getByTestId("location").textContent).not.toContain("page=");
  });
});
