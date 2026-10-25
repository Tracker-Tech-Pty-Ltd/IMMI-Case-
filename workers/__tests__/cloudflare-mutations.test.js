import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStores = vi.fn();
const mockRequireAuth = vi.fn();
const mockVerifyCsrf = vi.fn();
const mockCoordinator = vi.fn();

vi.mock("../storage/cloudflare.js", () => ({ createCloudflareStores: (...args) => mockStores(...args) }));
vi.mock("../auth/request_auth.js", () => ({ requireAuth: (...args) => mockRequireAuth(...args) }));
vi.mock("../auth/csrf.js", () => ({ verifyCsrf: (...args) => mockVerifyCsrf(...args) }));
vi.mock("../auth/jwt.js", () => ({ verifyJwt: vi.fn() }));
vi.mock("../case-api/mutation_namespace.js", () => ({ getCaseMutationStub: (...args) => mockCoordinator(...args) }));

import { StorageBoundaryError } from "../storage/contracts.js";
import { dispatchCloudflareCaseMutation } from "../case-api/cloudflare_mutations.js";

const CLAIMS = {
  sub: "11111111-2222-4333-8444-555555555555",
  tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  tenants: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
};

function request(path, body, method = "POST") {
  return new Request(`https://immi.example${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": "token", Cookie: "__Host-csrf=token" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function stores() {
  return {
    identityStore: {
      assertMembership: vi.fn(async (claims) => ({ ...claims, role: "owner" })),
      assertPlatformOperator: vi.fn(async (claims) => ({ ...claims, platformOperator: true, grant: "platform_admin" })),
    },
    objectStore: { putCaseSource: vi.fn(async ({ caseId }) => ({ key: `cases/${caseId}/source/${"a".repeat(64)}.txt`, sha256: "a".repeat(64), size: 4, contentType: "text/plain; charset=utf-8" })) },
    caseStore: {
      putImportedCase: vi.fn(async () => undefined),
      getCase: vi.fn(async (caseId) => ({ case_id: caseId, title: "Example", semantic_ready: 0, content_key: "hidden" })),
      updateCaseFields: vi.fn(async (caseId) => ({ case_id: caseId, title: "Updated", semantic_ready: 0 })),
      deleteCase: vi.fn(async () => true),
      batchDeleteCases: vi.fn(async () => 2),
      batchAddTag: vi.fn(async () => 2),
    },
    semanticIndex: { deleteCase: vi.fn(async () => ({ mutationId: "delete-1" })) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifyCsrf.mockResolvedValue(null);
  mockRequireAuth.mockResolvedValue({ claims: CLAIMS });
  mockStores.mockReturnValue(stores());
  mockCoordinator.mockReturnValue({
    putCase: vi.fn(async ({ record, canonicalText, preserveExisting }) => {
      const current = mockStores();
      const previous = preserveExisting ? await current.caseStore.getCase(record.case_id) : {};
      const patch = Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
      const pointer = await current.objectStore.putCaseSource({ caseId: record.case_id, body: canonicalText });
      await current.caseStore.putImportedCase({
        case: { ...previous, ...patch }, sourcePointer: pointer, textChunks: canonicalText ? [canonicalText] : [],
      });
      return pointer;
    }),
    updateCaseFields: vi.fn(async (id, updates) => mockStores().caseStore.updateCaseFields(id, updates)),
    deleteCase: vi.fn(async (id) => {
      await mockStores().caseStore.deleteCase(id);
      return { affected: 1, updatedAt: "" };
    }),
    tagCase: vi.fn(async (id, tag) => ({ affected: await mockStores().caseStore.batchAddTag([id], tag), case: await mockStores().caseStore.getCase(id) })),
  });
});

describe("Cloudflare-native case mutations", () => {
  it("returns an explicit migration-freeze contract until the queue gate is enabled", async () => {
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases", { title: "Example" }), 
      "/api/v1/cases",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Case mutations are disabled during migration freeze",
      code: "case_mutations_disabled",
    });
    expect(mockStores).not.toHaveBeenCalled();
  });

  it("keeps invalid case identifiers on the native contract while frozen", async () => {
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases/not-a-case-id", {}, "PUT"),
      "/api/v1/cases/not-a-case-id",
      { IMMI_STORAGE_MODE: "cloudflare" },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "case_mutations_disabled" });
  });

  it("writes R2 before catalog import and returns semantic pending state", async () => {
    const current = stores();
    mockStores.mockReturnValue(current);
    const queue = { send: vi.fn(async () => undefined) };
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases", { title: "Example", citation: "[2026] FCA 1", text: "case text" }),
      "/api/v1/cases",
      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
    );
    expect(response.status).toBe(201);
    expect(current.objectStore.putCaseSource).toHaveBeenCalledOnce();
    expect(current.caseStore.putImportedCase).toHaveBeenCalledOnce();
    expect((await response.json())).toMatchObject({ semantic_ready: false, semantic_queued: true });
  });

  it("requires a platform operator grant and CSRF for metadata update", async () => {
    const current = stores();
    mockStores.mockReturnValue(current);
    const queue = { send: vi.fn(async () => undefined) };
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases/0123456789ab", { title: "Updated" }, "PUT"),
      "/api/v1/cases/0123456789ab",
      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
    );
    expect(response.status).toBe(200);
    expect(current.identityStore.assertPlatformOperator).toHaveBeenCalledWith(CLAIMS);
    expect(current.caseStore.updateCaseFields).toHaveBeenCalledWith("0123456789ab", { title: "Updated" });
  });

  it("requeues semantic indexing after a metadata-only update", async () => {
    const current = stores();
    current.caseStore.getCase.mockResolvedValue({
      case_id: "0123456789ab",
      title: "Example",
      semantic_ready: 1,
      content_key: "cases/0123456789ab/source/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.txt",
      content_sha256: "a".repeat(64),
      content_size: 4,
    });
    const queue = { send: vi.fn(async () => undefined) };
    mockStores.mockReturnValue(current);
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases/0123456789ab", { title: "Updated" }, "PUT"),
      "/api/v1/cases/0123456789ab",
      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
    );
    expect(response.status).toBe(200);
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({
      kind: "case.reindex",
      case_id: "0123456789ab",
      content_sha256: "a".repeat(64),
      content_size: 4,
    }));
    expect((await response.json()).semantic_queued).toBe(true);
  });

  it("reports semantic queueing after replacing case text", async () => {
    const current = stores();
    const queue = { send: vi.fn(async () => undefined) };
    mockStores.mockReturnValue(current);
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases/0123456789ab", { title: "Updated", text: "replacement text" }, "PUT"),
      "/api/v1/cases/0123456789ab",
      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
    );
    expect(response.status).toBe(200);
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "case.reindex", case_id: "0123456789ab" }));
    expect((await response.json()).semantic_queued).toBe(true);
  });

  it("preserves extracted outcome fields when replacing case text", async () => {
    const current = stores();
    current.caseStore.getCase.mockResolvedValue({
      case_id: "0123456789ab",
      title: "Existing",
      visa_outcome_reason: "Existing reason",
      legal_test_applied: "Existing test",
      last_extraction_run_id: "run-20260810",
      extraction_confidence_json: { outcome: 0.9 },
      semantic_ready: 1,
      content_key: "hidden",
    });
    const queue = { send: vi.fn(async () => undefined) };
    mockStores.mockReturnValue(current);
    await dispatchCloudflareCaseMutation(
      request("/api/v1/cases/0123456789ab", { text: "replacement text" }, "PUT"),
      "/api/v1/cases/0123456789ab",
      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
    );
    expect(current.caseStore.putImportedCase).toHaveBeenCalledWith(expect.objectContaining({
      case: expect.objectContaining({
        visa_outcome_reason: "Existing reason",
        legal_test_applied: "Existing test",
        last_extraction_run_id: "run-20260810",
        extraction_confidence_json: { outcome: 0.9 },
      }),
    }));
  });

  it("fails closed instead of acknowledging an enabled mutation without its queue", async () => {
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases", { title: "Example" }),
      "/api/v1/cases",
      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true" },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Native case mutation queue is unavailable",
      code: "case_mutation_queue_unavailable",
    });
    expect(mockStores).not.toHaveBeenCalled();
  });

  it("deletes catalog rows and their Vectorize id", async () => {
    const current = stores();
    mockStores.mockReturnValue(current);
    const queue = { send: vi.fn(async () => undefined) };
    const reindexCase = vi.fn(async () => ({ status: "deleted" }));
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases/0123456789ab", {}, "DELETE"),
      "/api/v1/cases/0123456789ab",
      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue,
        CASE_MUTATION_COORDINATOR: { getByName: () => ({ reindexCase }) } },
    );
    expect(response.status).toBe(200);
    expect(current.caseStore.deleteCase).toHaveBeenCalledWith("0123456789ab");
    expect(mockCoordinator().deleteCase).toHaveBeenCalledWith("0123456789ab");
    expect(current.semanticIndex.deleteCase).not.toHaveBeenCalled();
  });

  it("queues R2 cleanup and aggregate refresh after a batch delete", async () => {
    const current = stores();
    current.caseStore.findByIds = vi.fn(async () => [{
      case_id: "0123456789ab",
      content_key: "cases/0123456789ab/source/" + "a".repeat(64) + ".txt",
      content_sha256: "a".repeat(64),
      content_size: 4,
    }]);
    current.caseStore.batchDeleteCases.mockResolvedValue(1);
    const queue = { send: vi.fn(async () => undefined) };
    const reindexCase = vi.fn(async () => ({ status: "deleted" }));
    mockStores.mockReturnValue(current);
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases/batch", { action: "delete", case_ids: ["0123456789ab"] }),
      "/api/v1/cases/batch",
      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue,
        CASE_MUTATION_COORDINATOR: { getByName: () => ({ reindexCase }) } },
    );
    expect(response.status).toBe(200);
    // Source retirement is owned by the coordinator, whose real storage path
    // is covered by case-mutation-races.test.js.
    expect(mockCoordinator().deleteCase).toHaveBeenCalledWith("0123456789ab");
    expect(queue.send).toHaveBeenCalledWith(expect.objectContaining({ kind: "catalog.rebuild" }));
  });

  it("accepts a crawler service token without login or CSRF", async () => {
    const current = stores();
    mockStores.mockReturnValue(current);
    const queue = { send: vi.fn(async () => undefined) };
    const req = new Request("https://immi.example/api/v1/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer crawler-secret" },
      body: JSON.stringify({ title: "Example", citation: "[2024] AATA 2", text: "case text" }),
    });
    const response = await dispatchCloudflareCaseMutation(
      req,
      "/api/v1/cases",
      {
        IMMI_STORAGE_MODE: "cloudflare",
        IMMI_CASE_MUTATIONS_ENABLED: "true",
        CASE_MUTATION_QUEUE: queue,
        CRAWLER_WRITE_TOKEN: "crawler-secret",
      },
    );
    expect(response.status).toBe(201);
    expect(mockVerifyCsrf).not.toHaveBeenCalled();
    expect(mockRequireAuth).not.toHaveBeenCalled();
    expect(current.identityStore.assertMembership).not.toHaveBeenCalled();
    expect(current.identityStore.assertPlatformOperator).not.toHaveBeenCalled();
    expect(current.caseStore.putImportedCase).toHaveBeenCalledOnce();
  });

  it("falls through to JWT auth when the crawler token is absent", async () => {
    const current = stores();
    mockStores.mockReturnValue(current);
    const queue = { send: vi.fn(async () => undefined) };
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases", { title: "Example", text: "case text" }),
      "/api/v1/cases",
      {
        IMMI_STORAGE_MODE: "cloudflare",
        IMMI_CASE_MUTATIONS_ENABLED: "true",
        CASE_MUTATION_QUEUE: queue,
        CRAWLER_WRITE_TOKEN: "crawler-secret",
      },
    );
    expect(response.status).toBe(201);
    expect(mockVerifyCsrf).toHaveBeenCalled();
    expect(mockRequireAuth).toHaveBeenCalled();
    expect(current.identityStore.assertPlatformOperator).toHaveBeenCalledWith(CLAIMS);
  });
});

describe("Cloudflare-native case mutations — platform operator gate (SEC-02)", () => {
  function denyOperator(current) {
    current.identityStore.assertPlatformOperator = vi.fn(async () => {
      throw new StorageBoundaryError("Platform operator access is required", {
        code: "platform_operator_required",
        status: 403,
      });
    });
    return current;
  }

  it("denies POST /api/v1/cases without a platform operator grant", async () => {
    const current = denyOperator(stores());
    mockStores.mockReturnValue(current);
    const queue = { send: vi.fn(async () => undefined) };
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases", { title: "Example", citation: "[2026] FCA 1", text: "case text" }),
      "/api/v1/cases",
      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "platform_operator_required" });
    expect(current.caseStore.putImportedCase).not.toHaveBeenCalled();
  });

  it("denies PUT /api/v1/cases/:id without a platform operator grant", async () => {
    const current = denyOperator(stores());
    mockStores.mockReturnValue(current);
    const queue = { send: vi.fn(async () => undefined) };
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases/0123456789ab", { title: "Updated" }, "PUT"),
      "/api/v1/cases/0123456789ab",
      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "platform_operator_required" });
    expect(current.caseStore.updateCaseFields).not.toHaveBeenCalled();
  });

  it("denies DELETE /api/v1/cases/:id without a platform operator grant", async () => {
    const current = denyOperator(stores());
    mockStores.mockReturnValue(current);
    const queue = { send: vi.fn(async () => undefined) };
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases/0123456789ab", {}, "DELETE"),
      "/api/v1/cases/0123456789ab",
      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "platform_operator_required" });
    expect(current.caseStore.deleteCase).not.toHaveBeenCalled();
  });

  it("denies a batch delete without a platform operator grant", async () => {
    const current = denyOperator(stores());
    mockStores.mockReturnValue(current);
    const queue = { send: vi.fn(async () => undefined) };
    const response = await dispatchCloudflareCaseMutation(
      request("/api/v1/cases/batch", { action: "delete", case_ids: ["0123456789ab", "0123456789ac"] }),
      "/api/v1/cases/batch",
      { IMMI_STORAGE_MODE: "cloudflare", IMMI_CASE_MUTATIONS_ENABLED: "true", CASE_MUTATION_QUEUE: queue },
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "platform_operator_required" });
    expect(current.caseStore.batchDeleteCases).not.toHaveBeenCalled();
  });

  it("still accepts the crawler service token, bypassing the platform operator check", async () => {
    const current = denyOperator(stores());
    mockStores.mockReturnValue(current);
    const queue = { send: vi.fn(async () => undefined) };
    const req = new Request("https://immi.example/api/v1/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer s3cret" },
      body: JSON.stringify({ title: "Example", citation: "[2024] AATA 2", text: "case text" }),
    });
    const response = await dispatchCloudflareCaseMutation(
      req,
      "/api/v1/cases",
      {
        IMMI_STORAGE_MODE: "cloudflare",
        IMMI_CASE_MUTATIONS_ENABLED: "true",
        CASE_MUTATION_QUEUE: queue,
        CRAWLER_WRITE_TOKEN: "s3cret",
      },
    );
    expect(response.status).toBe(201);
    expect(current.identityStore.assertPlatformOperator).not.toHaveBeenCalled();
    expect(current.caseStore.putImportedCase).toHaveBeenCalledOnce();
  });
});
