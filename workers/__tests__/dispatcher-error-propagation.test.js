import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStores = vi.fn();
const mockRequireAuth = vi.fn();
const mockVerifyCsrf = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockStores(...args) }));
vi.mock("../auth/request_auth.js", () => ({ requireAuth: (...args) => mockRequireAuth(...args) }));
vi.mock("../auth/csrf.js", () => ({ verifyCsrf: (...args) => mockVerifyCsrf(...args) }));
vi.mock("../auth/jwt.js", () => ({ verifyJwt: vi.fn() }));

import { StorageBoundaryError } from "../storage/contracts.js";
import { dispatchCloudflareCaseRead } from "../case-api/cloudflare.js";
import { dispatchCloudflareCaseMutation } from "../case-api/cloudflare_mutations.js";
import { dispatchCloudflareCaseAction } from "../case-api/cloudflare_actions.js";
import { dispatchCloudflareCouncil } from "../llm-council/cloudflare_handlers.js";

const CLAIMS = {
  sub: "11111111-2222-4333-8444-555555555555",
  tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
};
const AUTH = { userId: CLAIMS.sub, tenantId: CLAIMS.tenant_id, role: "member" };
const ENV = { IMMI_STORAGE_MODE: "cloudflare" };

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCsrf.mockResolvedValue(null);
  mockRequireAuth.mockResolvedValue({ claims: CLAIMS });
});

describe("Dispatcher error propagation", () => {
  it("surfaces a typed storage error from a GET read handler", async () => {
    mockStores.mockReturnValue({
      caseStore: {
        getStats: vi.fn(async () => {
          throw new StorageBoundaryError("Case not found", { code: "case_not_found", status: 404 });
        }),
      },
    });
    const response = await dispatchCloudflareCaseRead(
      new Request("https://immi.example/api/v1/stats"),
      new URL("https://immi.example/api/v1/stats"),
      "/api/v1/stats",
      ENV,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "Case not found", code: "case_not_found" });
  });

  it("surfaces a typed storage error from a case mutation handler", async () => {
    mockStores.mockReturnValue({
      identityStore: {
        assertMembership: vi.fn(async () => AUTH),
        assertPlatformOperator: vi.fn(async () => AUTH),
      },
      objectStore: {
        putCaseSource: vi.fn(async () => {
          throw new StorageBoundaryError("Case source checksum mismatch", { code: "r2_checksum_mismatch", status: 503 });
        }),
      },
      caseStore: {},
    });
    const request = new Request("https://immi.example/api/v1/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "token", Cookie: "__Host-csrf=token" },
      body: JSON.stringify({ title: "Example" }),
    });
    const response = await dispatchCloudflareCaseMutation(
      request,
      "/api/v1/cases",
      { ...ENV, IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: { send: vi.fn(async () => undefined) },
        CASE_MUTATION_COORDINATOR: { getByName: () => ({ putCase: () => mockStores().objectStore.putCaseSource() }) } },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "r2_checksum_mismatch" });
  });

  it("surfaces a typed storage error from a safe POST action handler", async () => {
    mockStores.mockReturnValue({
      identityStore: { assertMembership: vi.fn(async () => AUTH) },
      caseStore: {
        guidedPrecedents: vi.fn(async () => {
          throw new StorageBoundaryError("Guided search unavailable", { code: "guided_search_unavailable", status: 404 });
        }),
      },
    });
    const request = new Request("https://immi.example/api/v1/taxonomy/guided-search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "token", Cookie: "__Host-csrf=token" },
      body: JSON.stringify({ flow: "find-precedents", visa_subclass: "866" }),
    });
    const response = await dispatchCloudflareCaseAction(request, "/api/v1/taxonomy/guided-search", ENV);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "guided_search_unavailable" });
  });

  it("surfaces a typed storage error from a Council handler", async () => {
    mockStores.mockReturnValue({
      identityStore: {
        assertMembership: vi.fn(async () => AUTH),
        listCouncilSessions: vi.fn(async () => {
          throw new StorageBoundaryError("Membership is not active", { code: "membership_inactive", status: 403 });
        }),
      },
    });
    const response = await dispatchCloudflareCouncil(
      new Request("https://immi.example/api/v1/llm-council/sessions", { headers: { Authorization: "Bearer valid" } }),
      ENV,
      "/api/v1/llm-council/sessions",
      "GET",
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "membership_inactive" });
  });
});
