import { describe, expect, it } from "vitest";

import { extractMetadata } from "../parser";
import { EXTRACTOR_PARITY_CASES } from "./extractor-parity-corpus";

describe("extractMetadata parity with the Python MetadataExtractor", () => {
  for (const testCase of EXTRACTOR_PARITY_CASES) {
    it(`matches the golden output for ${testCase.name}`, () => {
      expect(extractMetadata(testCase.text)).toEqual(testCase.expected);
    });
  }

  it("keeps the judicial title when the header uses a BEFORE label", () => {
    // Regression: an unanchored /JUSTICE/ alternative captured "A Nguyen"
    // instead of "Justice A Nguyen", splitting one judge into two rows in the
    // judge leaderboard depending on which scraper ingested the case.
    expect(extractMetadata("IN THE FEDERAL COURT\nBEFORE: Justice A Nguyen\n").judges).toBe(
      "Justice A Nguyen",
    );
  });

  it("does not treat the word MEMBER inside prose as a judge label", () => {
    expect(extractMetadata("The presiding MEMBER: Jane Doe made the decision.\n").judges).toBe("");
  });
});
