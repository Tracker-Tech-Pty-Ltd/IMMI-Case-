import { describe, expect, it } from "vitest";
import { caseIdOf, parseAustliiListing } from "../discover";

describe("discover", () => {
  it("generates stable case ids from citation and url only", async () => {
    const a = await caseIdOf(
      " [2025]  ARTA  12. ",
      " HTTPS://www.austlii.edu.au/au/cases/cth/ARTA/2025/12.html. ",
    );
    const b = await caseIdOf(
      "[2025] ARTA 12",
      "https://www.austlii.edu.au/au/cases/cth/ARTA/2025/12.html",
    );

    expect(a).toHaveLength(12);
    expect(a).toBe(b);
  });

  it("keeps all dedicated immigration tribunal listings", () => {
    const html = `
      <html><body>
        <a href="/au/cases/cth/ARTA/2025/12.html">Example v Minister [2025] ARTA 12</a>
      </body></html>
    `;

    const cases = parseAustliiListing(html, "ARTA", 2025);
    expect(cases).toEqual([
      {
        url: "https://www.austlii.edu.au/au/cases/cth/ARTA/2025/12.html",
        citation: "[2025] ARTA 12",
        court_code: "ARTA",
        title: "Example v Minister [2025] ARTA 12",
        year: 2025,
      },
    ]);
  });

  it("filters non-dedicated courts to immigration context", () => {
    const html = `
      <html><body>
        <p>Migration Act review
          <a href="/au/cases/cth/FCA/2025/7.html">Applicant v Minister [2025] FCA 7</a>
        </p>
        <p>Tax dispute
          <a href="/au/cases/cth/FCA/2025/8.html">Taxpayer v Commissioner [2025] FCA 8</a>
        </p>
      </body></html>
    `;

    const cases = parseAustliiListing(html, "FCA", 2025);
    expect(cases.map((item) => item.citation)).toEqual(["[2025] FCA 7"]);
  });
});
