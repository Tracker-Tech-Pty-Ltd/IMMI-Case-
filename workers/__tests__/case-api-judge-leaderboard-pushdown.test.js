import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateStores = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: (...args) => mockCreateStores(...args),
}));

import { dispatchCloudflareCaseRead } from "../case-api/cloudflare.js";

const ENV = { IMMI_STORAGE_MODE: "cloudflare" };
const PATH = "/api/v1/analytics/judge-leaderboard";
const url = (query = "") => new URL(`https://immi.example${PATH}${query}`);
const request = (query = "") => new Request(`https://immi.example${PATH}${query}`);

function stores() {
  return {
    caseStore: {
      analyticsJudgeAggregate: vi.fn(async () => ({
        outcomes: [
          { judge_id: "judge-a", name: "Justice Example", court_code: "FCA", outcome: "Allowed", cnt: 7 },
          { judge_id: "judge-b", name: "Member Other", court_code: "AATA", outcome: "Dismissed", cnt: 3 },
        ],
        years: [{ judge_id: "judge-a", year: 2025, cnt: 7 }],
        visas: [{ judge_id: "judge-a", visa_subclass: "189", cnt: 7 }],
      })),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("judge-leaderboard filter pushdown at the handler seam", () => {
  it("forwards the parsed court and min_cases filters to the store", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    await dispatchCloudflareCaseRead(request("?court=FCA&min_cases=5"), url("?court=FCA&min_cases=5"), PATH, ENV);
    expect(current.caseStore.analyticsJudgeAggregate).toHaveBeenCalledWith({ court: "FCA", minCases: 5 });
  });

  it("forwards an empty court and a floor of one by default", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    await dispatchCloudflareCaseRead(request(), url(), PATH, ENV);
    expect(current.caseStore.analyticsJudgeAggregate).toHaveBeenCalledWith({ court: "", minCases: 1 });
  });

  it("reports total_judges before the limit is applied", async () => {
    const current = stores();
    mockCreateStores.mockReturnValue(current);
    const response = await dispatchCloudflareCaseRead(request("?limit=1"), url("?limit=1"), PATH, ENV);
    const body = await response.json();
    expect(body.judges).toHaveLength(1);
    expect(body.total_judges).toBe(2);
  });
});
