import { describe, expect, it } from "vitest";
import {
  COURT_MATRIX,
  getDiscoveryYears,
  isBiweeklyTick,
  normalizeForCaseId,
} from "../pipeline-config";

describe("pipeline-config", () => {
  it("maps cron hours to court groups", () => {
    expect(COURT_MATRIX.groupForHour(2)).toEqual(["AATA", "ARTA", "HCA"]);
    expect(COURT_MATRIX.groupForHour(3)).toEqual(["FCA"]);
    expect(COURT_MATRIX.groupForHour(4)).toEqual(["FCCA", "FedCFamC2G", "FMCA"]);
    expect(COURT_MATRIX.groupForHour(5)).toEqual(["RRTA", "MRTA"]);
    expect(COURT_MATRIX.groupForHour(6)).toBeNull();
  });

  it("uses an epoch-anchored biweekly gate across calendar edge cases", () => {
    expect(isBiweeklyTick(Date.parse("1970-01-01T00:00:00Z"))).toBe(true);
    expect(isBiweeklyTick(Date.parse("1970-01-08T00:00:00Z"))).toBe(true);
    expect(isBiweeklyTick(Date.parse("1970-01-15T00:00:00Z"))).toBe(false);
    expect(isBiweeklyTick(Date.parse("2024-12-30T02:00:00Z"))).toBe(true);
    expect(isBiweeklyTick(Date.parse("2025-03-09T02:00:00Z"))).toBe(false);
    expect(isBiweeklyTick(Date.parse("2028-02-29T02:00:00Z"))).toBe(false);
  });

  it("uses UTC years for discovery lookback", () => {
    expect(getDiscoveryYears(Date.parse("2026-06-08T02:00:00Z"), 2)).toEqual([2026, 2025]);
  });

  it("normalizes citation and url inputs without including volatile title text", () => {
    expect(normalizeForCaseId("  [2025]   AATA  1. ")).toBe("[2025] aata 1");
    expect(normalizeForCaseId("HTTPS://WWW.AUSTLII.EDU.AU/au/cases/cth/AATA/2025/1.html."))
      .toBe("https://www.austlii.edu.au/au/cases/cth/aata/2025/1.html");
  });
});
