import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStores = vi.fn();
const mockRequireAuth = vi.fn();
const mockVerifyCsrf = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockStores(...args) }));
vi.mock("../auth/request_auth.js", () => ({ requireAuth: (...args) => mockRequireAuth(...args) }));
vi.mock("../auth/csrf.js", () => ({ verifyCsrf: (...args) => mockVerifyCsrf(...args) }));
vi.mock("../auth/jwt.js", () => ({ verifyJwt: vi.fn() }));

import { dispatchCloudflareCaseAction } from "../case-api/cloudflare_actions.js";

const CLAIMS = {
  sub: "11111111-2222-4333-8444-555555555555",
  tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
};

function request(path, body) {
  return new Request(`https://immi.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": "token", Cookie: "__Host-csrf=token" },
    body: JSON.stringify(body),
  });
}

function stores() {
  return {
    identityStore: { assertMembership: vi.fn(async (claims) => ({ ...claims, role: "owner" })) },
    caseStore: {
      guidedPrecedents: vi.fn(async () => ({ total: 1, results: [{ case_id: "0123456789ab", title: "Example" }] })),
      guidedJudge: vi.fn(async () => ({ name: "Justice Example", case_count: 7 })),
      findByIds: vi.fn(async () => [{ case_id: "0123456789ab", citation: "<unsafe>", title: "Example", court_code: "FCA" }]),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCsrf.mockResolvedValue(null);
  mockRequireAuth.mockResolvedValue({ claims: CLAIMS });
  mockStores.mockReturnValue(stores());
});

describe("Cloudflare-native safe POST actions", () => {
  it("requires native mode and serves guided precedents through CaseStore", async () => {
    const current = stores();
    mockStores.mockReturnValue(current);
    const response = await dispatchCloudflareCaseAction(
      request("/api/v1/taxonomy/guided-search", { flow: "find-precedents", visa_subclass: "866" }),
      "/api/v1/taxonomy/guided-search",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).meta).toMatchObject({ total_results: 1, returned_results: 1 });
    expect(current.caseStore.guidedPrecedents).toHaveBeenCalledWith(expect.objectContaining({ visaSubclass: "866" }));
  });

  it("keeps assess-judge response compatible", async () => {
    const response = await dispatchCloudflareCaseAction(
      request("/api/v1/taxonomy/guided-search", { flow: "assess-judge", judge_name: "Justice" }),
      "/api/v1/taxonomy/guided-search",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(await response.json()).toMatchObject({
      success: true, flow: "assess-judge", canonical_name: "Justice Example", meta: { total_cases: 7 },
    });
  });

  it("renders collection export as escaped HTML", async () => {
    const response = await dispatchCloudflareCaseAction(
      request("/api/v1/collections/export", { case_ids: ["0123456789ab"], collection_name: "<Collection>" }),
      "/api/v1/collections/export",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("&lt;Collection&gt;");
    expect(html).toContain("&lt;unsafe&gt;");
  });

  it("keeps cache invalidation a no-store native action", async () => {
    const response = await dispatchCloudflareCaseAction(
      request("/api/v1/cache/invalidate", {}),
      "/api/v1/cache/invalidate",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ invalidated: true });
  });
});
