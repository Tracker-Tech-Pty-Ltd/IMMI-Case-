import { describe, it, expect, afterEach } from "vitest";
import { generateShareableUrl } from "@/lib/saved-searches";
import type { CaseFilters } from "@/types/case";

const filters: CaseFilters = { court: "FCA", keyword: "visa" };

describe("generateShareableUrl", () => {
  afterEach(() => {
    window.history.pushState({}, "", "/");
  });

  it("builds a root-basename URL when the SPA is served at /", () => {
    expect(generateShareableUrl(filters, "/")).toBe(
      `${window.location.origin}/cases?court=FCA&keyword=visa&page=1`,
    );
  });

  it("keeps the /app basename so the link lands inside the router", () => {
    expect(generateShareableUrl(filters, "/app")).toBe(
      `${window.location.origin}/app/cases?court=FCA&keyword=visa&page=1`,
    );
  });

  it("derives the basename from the current location by default", () => {
    window.history.pushState({}, "", "/app/cases");
    expect(generateShareableUrl(filters)).toBe(
      `${window.location.origin}/app/cases?court=FCA&keyword=visa&page=1`,
    );
  });

  it("always pins shared searches to page 1", () => {
    expect(generateShareableUrl({}, "/")).toBe(
      `${window.location.origin}/cases?page=1`,
    );
  });
});
