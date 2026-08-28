import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStores = vi.fn();
const mockRequireAuth = vi.fn();
const mockVerifyCsrf = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockStores(...args) }));
vi.mock("../auth/request_auth.js", () => ({ requireAuth: (...args) => mockRequireAuth(...args) }));
vi.mock("../auth/csrf.js", () => ({ verifyCsrf: (...args) => mockVerifyCsrf(...args) }));
vi.mock("../auth/jwt.js", () => ({ verifyJwt: vi.fn() }));

import { StorageBoundaryError } from "../storage/contracts.js";
import { dispatchCloudflarePipelineControl } from "../pipeline/control_handlers.js";

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
    identityStore: {
      assertMembership: vi.fn(async () => ({ ...CLAIMS, role: "admin" })),
      assertPlatformOperator: vi.fn(async () => ({ ...CLAIMS, platformOperator: true, grant: "platform_admin" })),
    },
    pipelineStore: {
      recordControlCommand: vi.fn(async () => true),
      updateControlCommand: vi.fn(async () => undefined),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCsrf.mockResolvedValue(null);
  mockRequireAuth.mockResolvedValue({ claims: CLAIMS });
  mockStores.mockReturnValue(stores());
});

describe("Cloudflare-native pipeline controls", () => {
  it("records and queues an authenticated manual start", async () => {
    const current = stores();
    mockStores.mockReturnValue(current);
    const send = vi.fn(async () => undefined);
    const response = await dispatchCloudflarePipelineControl(
      request("/api/v1/pipeline-action", { action: "start", databases: ["FCA", "AATA"], start_year: 2024 }),
      "/api/v1/pipeline-action",
      { IMMI_STORAGE_MODE: "cloudflare", PIPELINE_CONTROL_QUEUE: { send } },
    );
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, started: true, native: true });
    expect(current.pipelineStore.recordControlCommand).toHaveBeenCalledWith(expect.objectContaining({
      action: "start",
      payload: { courts: ["FCA", "AATA"], start_year: 2024, end_year: expect.any(Number) },
    }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: "pipeline.control", action: "start" }));
  });

  it("returns a typed unavailable response when the control queue is not bound", async () => {
    const response = await dispatchCloudflarePipelineControl(
      request("/api/v1/pipeline-action", { action: "stop" }),
      "/api/v1/pipeline-action",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Native pipeline control queue is unavailable", code: "pipeline_control_unavailable" });
  });

  it("queues a bounded native download command", async () => {
    const current = stores();
    mockStores.mockReturnValue(current);
    const send = vi.fn(async () => undefined);
    const response = await dispatchCloudflarePipelineControl(
      request("/api/v1/download/start", { court: "FCA", limit: 12 }),
      "/api/v1/download/start",
      { IMMI_STORAGE_MODE: "cloudflare", PIPELINE_CONTROL_QUEUE: { send } },
    );
    expect(response.status).toBe(202);
    expect(current.pipelineStore.recordControlCommand).toHaveBeenCalledWith(expect.objectContaining({
      action: "download", payload: { courts: ["FCA"], limit: 12 },
    }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: "download", limit: 12 }));
  });

  it("requires a platform operator grant, not a tenant role", async () => {
    const current = stores();
    // A tenant `viewer` and a tenant `owner` are equally irrelevant now: the
    // signup flow self-grants `owner`, so only the platform grant decides.
    current.identityStore.assertMembership = vi.fn(async () => ({ ...CLAIMS, role: "viewer" }));
    current.identityStore.assertPlatformOperator = vi.fn(async () => {
      throw new StorageBoundaryError("Platform operator access is required", {
        code: "platform_operator_required",
        status: 403,
      });
    });
    mockStores.mockReturnValue(current);
    const response = await dispatchCloudflarePipelineControl(
      request("/api/v1/pipeline-action", { action: "stop" }),
      "/api/v1/pipeline-action",
      { IMMI_STORAGE_MODE: "cloudflare", PIPELINE_CONTROL_QUEUE: { send: vi.fn() } },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "platform_operator_required" });
  });

  it("returns a typed response when the control queue rejects", async () => {
    const current = stores();
    mockStores.mockReturnValue(current);
    const send = vi.fn(async () => { throw new Error("queue unavailable"); });
    const response = await dispatchCloudflarePipelineControl(
      request("/api/v1/pipeline-action", { action: "start" }),
      "/api/v1/pipeline-action",
      { IMMI_STORAGE_MODE: "cloudflare", PIPELINE_CONTROL_QUEUE: { send } },
    );
    // Before the `await` fix this rejects out of the dispatcher entirely and
    // the runtime turns it into a bodyless 500 with no `code` field.
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await response.json()).toHaveProperty("code");
  });

  it("denies a self-granted tenant owner who is not a platform operator", async () => {
    const current = stores();
    current.identityStore.assertPlatformOperator = vi.fn(async () => {
      throw new StorageBoundaryError("Platform operator access is required", {
        code: "platform_operator_required",
        status: 403,
      });
    });
    mockStores.mockReturnValue(current);
    const send = vi.fn(async () => undefined);
    const response = await dispatchCloudflarePipelineControl(
      request("/api/v1/pipeline-action", { action: "start" }),
      "/api/v1/pipeline-action",
      { IMMI_STORAGE_MODE: "cloudflare", PIPELINE_CONTROL_QUEUE: { send } },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "platform_operator_required" });
    expect(send).not.toHaveBeenCalled();
    expect(current.pipelineStore.recordControlCommand).not.toHaveBeenCalled();
  });

  it("validates and queues a native legislation update command", async () => {
    const current = stores();
    mockStores.mockReturnValue(current);
    const send = vi.fn(async () => undefined);
    const response = await dispatchCloudflarePipelineControl(
      request("/api/v1/legislations/update", { law_id: "migration-act-1958" }),
      "/api/v1/legislations/update",
      { IMMI_STORAGE_MODE: "cloudflare", PIPELINE_CONTROL_QUEUE: { send } },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ success: true, laws: ["migration-act-1958"], native: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: "legislation_update", law_ids: ["migration-act-1958"] }));
  });

  it("rejects unknown legislation ids before touching the queue", async () => {
    const send = vi.fn();
    const response = await dispatchCloudflarePipelineControl(
      request("/api/v1/legislations/update", { law_id: "unknown-law" }),
      "/api/v1/legislations/update",
      { IMMI_STORAGE_MODE: "cloudflare", PIPELINE_CONTROL_QUEUE: { send } },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_law_id" });
    expect(send).not.toHaveBeenCalled();
  });
});
