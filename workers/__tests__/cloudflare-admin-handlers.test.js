import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireAuth = vi.fn();
const mockListRuns = vi.fn();
const mockAssertMembership = vi.fn();
const mockAssertPlatformOperator = vi.fn();

vi.mock("../auth/request_auth.js", () => ({ requireAuth: (...args) => mockRequireAuth(...args) }));
vi.mock("../auth/jwt.js", () => ({ verifyJwt: vi.fn() }));
vi.mock("../storage/cloudflare.js", () => ({
  createCloudflareStores: () => ({
    identityStore: {
      assertMembership: (...args) => mockAssertMembership(...args),
      assertPlatformOperator: (...args) => mockAssertPlatformOperator(...args),
    },
    pipelineStore: { listRuns: (...args) => mockListRuns(...args) },
  }),
}));

import { StorageBoundaryError } from "../storage/contracts.js";
import { handleAdminPipelineRuns } from "../admin/cloudflare_handlers.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ claims: {
    role: "admin",
    sub: "11111111-2222-4333-8444-555555555555",
    tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
  } });
  mockAssertMembership.mockResolvedValue({ role: "admin" });
  mockAssertPlatformOperator.mockResolvedValue({ platformOperator: true, grant: "platform_admin" });
  mockListRuns.mockResolvedValue({ runs: [], summary: { total_runs: 0 } });
});

describe("native pipeline admin read", () => {
  it("fails closed when auth is disabled", async () => {
    const response = await handleAdminPipelineRuns(new Request("https://immi.example/api/v1/admin/pipeline-runs"), { AUTH_ENABLED: "false" }, new URL("https://immi.example/api/v1/admin/pipeline-runs"));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "admin_auth_disabled" });
  });

  it("requires a platform operator grant and reads only through PipelineStore", async () => {
    mockAssertPlatformOperator.mockRejectedValueOnce(new StorageBoundaryError("Platform operator access is required", {
      code: "platform_operator_required",
      status: 403,
    }));
    const denied = await handleAdminPipelineRuns(new Request("https://immi.example/api/v1/admin/pipeline-runs"), { AUTH_ENABLED: "true" }, new URL("https://immi.example/api/v1/admin/pipeline-runs"));
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "platform_operator_required" });
    expect(mockListRuns).not.toHaveBeenCalled();

    const response = await handleAdminPipelineRuns(new Request("https://immi.example/api/v1/admin/pipeline-runs?limit=10"), { AUTH_ENABLED: "true" }, new URL("https://immi.example/api/v1/admin/pipeline-runs?limit=10"));
    expect(response.status).toBe(200);
    expect(mockListRuns).toHaveBeenCalledWith(10);
    expect(await response.json()).toMatchObject({ summary: { total_runs: 0 } });
  });

  it("rejects a tenant owner with no platform grant", async () => {
    mockRequireAuth.mockResolvedValueOnce({ claims: {
      role: "owner",
      sub: "11111111-2222-4333-8444-555555555555",
      tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
    } });
    mockAssertPlatformOperator.mockRejectedValueOnce(new StorageBoundaryError("Platform operator access is required", {
      code: "platform_operator_required",
      status: 403,
    }));
    const response = await handleAdminPipelineRuns(new Request("https://immi.example/api/v1/admin/pipeline-runs"), { AUTH_ENABLED: "true" }, new URL("https://immi.example/api/v1/admin/pipeline-runs"));
    expect(response.status).toBe(403);
  });
});
