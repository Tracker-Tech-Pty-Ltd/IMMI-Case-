import { describe, expect, it } from "vitest";
import { buildAnalyticsHref, parseAnalyticsScope } from "@/lib/analytics-scope";

describe("shared analytics research scope", () => {
  it("carries the dashboard's court and years into analytics", () => {
    const href = buildAnalyticsHref({ court: "FCA", yearFrom: 2020, yearTo: 2024 });
    const scope = parseAnalyticsScope(new URL(href, "https://example.test").searchParams);
    expect(scope).toEqual({ court: "FCA", yearFrom: 2020, yearTo: 2024 });
  });

  it("defaults malformed URLs instead of sending invalid filters", () => {
    expect(parseAnalyticsScope(new URLSearchParams("court=invalid&year_from=oops&year_to=9999")))
      .toEqual({ court: "", yearFrom: 2000, yearTo: new Date().getFullYear() });
  });

  it("normalizes reversed year ranges", () => {
    expect(parseAnalyticsScope(new URLSearchParams("court=FedCFamC2G&year_from=2024&year_to=2020")))
      .toEqual({ court: "FedCFamC2G", yearFrom: 2020, yearTo: 2024 });
  });
});
