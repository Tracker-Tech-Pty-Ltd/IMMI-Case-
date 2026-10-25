import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

import * as entry from "../cloudflare-native.js";
import { createCloudflareStores } from "../storage/cloudflare.js";
import { dispatchCloudflareCaseRead } from "../case-api/cloudflare.js";
import { dispatchCloudflareCaseMutation } from "../case-api/cloudflare_mutations.js";
import { coordinateExtractedCase, splitFtsChunks } from "../storage/pipeline_coordinator.js";
import { createSqliteD1 } from "./helpers/d1-sqlite.js";

const CASE_ID = "0123456789ab";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const objects = new Map();
  const vectors = new Map();
  const env = {
    IMMI_STORAGE_MODE: "cloudflare",
    IMMI_CASE_MUTATIONS_ENABLED: "true",
    CRAWLER_WRITE_TOKEN: "offline-service",
    CASE_MUTATION_QUEUE: { send: vi.fn(async () => undefined) },
    IMMI_CATALOG_DB: createSqliteD1("catalog"),
    IMMI_ACCOUNT_DB: createSqliteD1("account"),
    IMMI_OPS_DB: createSqliteD1("ops"),
    IMMI_CONTENT: {
      async put(key, bytes, options) {
        const body = new Uint8Array(bytes);
        const object = {
          size: body.byteLength, customMetadata: options.customMetadata,
          async arrayBuffer() { return body.buffer; },
          async json() { return JSON.parse(new TextDecoder().decode(body)); },
        };
        objects.set(key, object);
        return object;
      },
      async head(key) { return objects.get(key) || null; },
      async get(key) { return objects.get(key) || null; },
      delete: vi.fn(async (key) => { objects.delete(key); }),
    },
    CASE_VECTORS: {
      query: vi.fn(async () => ({ matches: [] })),
      queryById: vi.fn(async () => ({ matches: [] })),
      upsert: vi.fn(async ([vector]) => {
        vectors.set(vector.id, vector);
        return { mutationId: `mutation-${vector.values[0]}` };
      }),
      deleteByIds: vi.fn(async (ids) => { ids.forEach((id) => vectors.delete(id)); }),
    },
    AI: { run: vi.fn(async (_model, { text }) => ({ data: [Array(1024).fill(text[0].includes("corrected") ? 2 : 1)] })) },
  };
  // D1 serializes transactions. The in-memory shim yields between statements,
  // so give concurrent queue deliveries the same transaction scheduling here.
  const runBatch = env.IMMI_CATALOG_DB.batch.bind(env.IMMI_CATALOG_DB);
  let pendingBatch = Promise.resolve();
  env.IMMI_CATALOG_DB.batch = (statements) => {
    const result = pendingBatch.then(() => runBatch(statements));
    pendingBatch = result.catch(() => {});
    return result;
  };
  const coordinators = new Map();
  env.CASE_MUTATION_COORDINATOR = {
    getByName(name) {
      if (!coordinators.has(name)) {
        const persisted = new Map();
        const state = { storage: {
          async get(key) { return structuredClone(persisted.get(key)); },
          async put(key, value) { persisted.set(key, structuredClone(value)); },
          async delete(key) { persisted.delete(key); },
          async setAlarm() {}, async deleteAlarm() {},
        } };
        coordinators.set(name, new entry.CaseMutationDO(state, env));
      }
      return coordinators.get(name);
    },
  };
  const stores = createCloudflareStores(env);
  async function save(text, overrides = {}) {
    const pointer = await stores.objectStore.putCaseSource({ caseId: CASE_ID, body: text });
    await stores.caseStore.putImportedCase({
      case: { case_id: CASE_ID, title: "Example", court_code: "FCA", year: 2026, ...overrides },
      sourcePointer: pointer,
      textChunks: splitFtsChunks(text),
    });
    return pointer;
  }
  return { env, stores, objects, vectors, save };
}

function message(pointer, kind = "case.reindex") {
  return {
    body: {
      kind, case_id: CASE_ID,
      content_key: pointer.key, content_sha256: pointer.sha256,
      content_size: pointer.size, content_type: pointer.contentType,
    },
    ack: vi.fn(), retry: vi.fn(),
  };
}

function deliver(env, value) {
  return entry.default.queue({ messages: [value] }, env);
}

describe("case privacy and asynchronous mutation races", () => {
  it("never exposes stored private notes to anonymous case readers", async () => {
    const { env, save } = fixture();
    await save("original text", { user_notes: "Private client instructions" });
    for (const path of ["/api/v1/cases", `/api/v1/cases/${CASE_ID}`, "/api/v1/search?q=original&mode=lexical"]) {
      const request = new Request(`https://immi.example${path}`);
      const response = await dispatchCloudflareCaseRead(request, new URL(request.url), new URL(request.url).pathname, env);
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain("Private client instructions");
    }
  });

  it("does not replace a newer completed vector when an old event is retried", async () => {
    const { env, vectors, save, stores } = fixture();
    const old = await save("original text");
    const current = await save("corrected text");
    await deliver(env, message(current));
    const oldDelivery = message(old);
    await deliver(env, oldDelivery);
    expect(vectors.get(CASE_ID).values[0]).toBe(2);
    expect((await stores.caseStore.getCase(CASE_ID)).semantic_ready).toBe(1);
    expect(oldDelivery.ack).toHaveBeenCalledOnce();
  });

  it.each(["embedding", "vector-write"])("handles an update while the old %s is still running", async (phase) => {
    const { env, vectors, save, stores } = fixture();
    const old = await save("original text");
    const entered = deferred();
    const release = deferred();
    const target = phase === "embedding" ? env.AI.run : env.CASE_VECTORS.upsert;
    const original = target.getMockImplementation();
    target.mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return original(...args);
    });
    const first = deliver(env, message(old));
    await entered.promise;
    const current = await save("corrected text");
    const second = deliver(env, message(current));
    // Give the second delivery a chance to overtake the suspended first one.
    await new Promise((resolve) => setTimeout(resolve, 20));
    release.resolve();
    await Promise.all([first, second]);
    expect(vectors.get(CASE_ID).values[0]).toBe(2);
    const row = await stores.caseStore.getCase(CASE_ID);
    expect(row.content_key).toBe(current.key);
    expect(row.semantic_ready).toBe(1);
  });

  it("refuses to mark a replaced metadata version semantic-ready", async () => {
    const { save, stores } = fixture();
    await save("original text");
    const old = await stores.caseStore.getCase(CASE_ID);
    await stores.caseStore.updateCaseFields(CASE_ID, { court_code: "AATA" });
    expect(await stores.caseStore.markSemanticReady(CASE_ID, "stale-vector", old)).toBe(false);
    const current = await stores.caseStore.getCase(CASE_ID);
    expect(current.semantic_ready).toBe(0);
    expect(current.vector_mutation_id).not.toBe("stale-vector");
  });

  it("indexes metadata edits made during embedding even when the source hash is unchanged", async () => {
    const { env, vectors, save, stores } = fixture();
    const pointer = await save("original text");
    const entered = deferred();
    const release = deferred();
    env.AI.run.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return { data: [Array(1024).fill(1)] };
    });
    const first = deliver(env, message(pointer));
    await entered.promise;
    await stores.caseStore.updateCaseFields(CASE_ID, { court_code: "AATA", visa_subclass: "866", year: 2025 });
    release.resolve();
    await first;
    expect(vectors.get(CASE_ID).metadata).toMatchObject({ court_code: "AATA", visa_subclass: "866", year: 2025 });
    expect((await stores.caseStore.getCase(CASE_ID)).semantic_ready).toBe(1);
  });

  it("serializes pipeline indexing with queue redelivery through the same case coordinator", async () => {
    const { env, vectors, save, stores } = fixture();
    const pointer = await save("original text");
    const entered = deferred();
    const release = deferred();
    env.AI.run.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return { data: [Array(1024).fill(1)] };
    });
    const first = deliver(env, message(pointer));
    await entered.promise;
    const pipeline = coordinateExtractedCase({
      env, eventId: "race-event", runId: "race-run",
      record: { case_id: CASE_ID, title: "Pipeline correction", court_code: "AATA", year: 2025 },
      canonicalText: "corrected text",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The pipeline's catalog publication must wait behind the in-flight
    // queue operation as well as serialize its eventual Vectorize write.
    expect((await stores.caseStore.getCase(CASE_ID)).title).toBe("Example");
    release.resolve();
    await Promise.all([first, pipeline]);
    expect(vectors.get(CASE_ID).values[0]).toBe(2);
    expect(vectors.get(CASE_ID).metadata).toMatchObject({ court_code: "AATA", year: 2025 });
    expect(await stores.pipelineStore.isEventComplete("race-event")).toBe(true);
  });

  it("does not create another source object when an incomplete pipeline event retries", async () => {
    const { env, objects } = fixture();
    const input = {
      env, eventId: "retry-event", runId: "retry-run",
      record: { case_id: CASE_ID, title: "Pipeline retry", court_code: "FCA", year: 2026 },
      canonicalText: "corrected text",
    };
    env.AI.run.mockRejectedValueOnce(new Error("temporary provider outage"));
    await expect(coordinateExtractedCase(input)).rejects.toThrow("temporary provider outage");
    expect(objects.size).toBe(1);
    await coordinateExtractedCase(input);
    expect(objects.size).toBe(1);
  });

  it("retires every replaced generation when two source writers arrive together", async () => {
    const { env, objects, stores } = fixture();
    const coordinator = env.CASE_MUTATION_COORDINATOR.getByName(`case:${CASE_ID}`);
    const write = (text) => coordinator.putCase({ record: { case_id: CASE_ID, title: text, court_code: "FCA", year: 2026 }, canonicalText: text });
    await write("original text");
    await write("original text");
    expect(objects.size).toBe(1);
    await Promise.all([write("second text"), write("corrected final text")]);
    const retired = env.CASE_MUTATION_QUEUE.send.mock.calls.map(([body]) => body);
    expect(retired).toHaveLength(2);
    for (const body of retired) await deliver(env, { body, ack: vi.fn(), retry: vi.fn() });
    const current = await stores.caseStore.getCase(CASE_ID);
    expect(objects.size).toBe(1);
    expect(await stores.objectStore.getVerifiedText({ key: current.content_key, sha256: current.content_sha256, size: current.content_size, contentType: "text/plain" })).toBe("corrected final text");
  });

  it("retains a cleanup intent across a queue outage and replays it from the DO alarm", async () => {
    const { env, objects } = fixture();
    const coordinator = env.CASE_MUTATION_COORDINATOR.getByName(`case:${CASE_ID}`);
    const write = (text) => coordinator.putCase({ record: { case_id: CASE_ID, title: text, court_code: "FCA", year: 2026 }, canonicalText: text });
    await write("original text");
    env.CASE_MUTATION_QUEUE.send.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(write("corrected text")).rejects.toThrow("queue unavailable");
    await coordinator.alarm();
    const body = env.CASE_MUTATION_QUEUE.send.mock.calls.at(-1)[0];
    await deliver(env, { body, ack: vi.fn(), retry: vi.fn() });
    expect(objects.size).toBe(1);
  });

  it.each(["put", "setAlarm"])("releases an unpublished upload when retirement storage %s fails", async (method) => {
    const { env, objects, stores } = fixture();
    const coordinator = env.CASE_MUTATION_COORDINATOR.getByName(`case:${CASE_ID}`);
    const write = (text) => coordinator.putCase({ record: { case_id: CASE_ID, title: text, year: 2026 }, canonicalText: text });
    const original = await write("original text");
    vi.spyOn(coordinator.state.storage, method).mockRejectedValueOnce(new Error("retirement storage unavailable"));
    await expect(write("corrected text")).rejects.toThrow("retirement storage unavailable");
    expect((await stores.caseStore.getCase(CASE_ID)).content_key).toBe(original.key);
    expect(objects.size).toBe(1);
    expect(await stores.objectStore.getVerifiedText(original)).toBe("original text");
  });

  it("reuses and retires a verified legacy source key without parsing its filename", async () => {
    const { env, objects, stores, save } = fixture();
    const pointer = await save("original text");
    const legacy = { ...pointer, key: "cases/legacy-import.txt" };
    objects.set(legacy.key, objects.get(pointer.key));
    objects.delete(pointer.key);
    await stores.caseStore.putImportedCase({ case: { case_id: CASE_ID, title: "Legacy", court_code: "FCA", year: 2026 }, sourcePointer: legacy, textChunks: ["original text"] });
    const coordinator = env.CASE_MUTATION_COORDINATOR.getByName(`case:${CASE_ID}`);
    const reused = await coordinator.putCase({ record: { case_id: CASE_ID, title: "Legacy", court_code: "FCA", year: 2026 }, canonicalText: "original text" });
    expect(reused.key).toBe(legacy.key);
    await coordinator.putCase({ record: { case_id: CASE_ID, title: "Replacement", court_code: "FCA", year: 2026 }, canonicalText: "corrected text" });
    const body = env.CASE_MUTATION_QUEUE.send.mock.calls.at(-1)[0];
    expect(body.case_id).toBe(CASE_ID);
    await deliver(env, { body, ack: vi.fn(), retry: vi.fn() });
    expect(objects.has(legacy.key)).toBe(false);
    expect(objects.size).toBe(1);
  });

  it("reuploads an identical source when its current R2 head no longer verifies", async () => {
    const { env, objects, save } = fixture();
    const pointer = await save("original text");
    objects.delete(pointer.key);
    const coordinator = env.CASE_MUTATION_COORDINATOR.getByName(`case:${CASE_ID}`);
    const replacement = await coordinator.putCase({ record: { case_id: CASE_ID, title: "Restored", year: 2026 }, canonicalText: "original text" });
    expect(replacement.key).not.toBe(pointer.key);
    expect(objects.has(replacement.key)).toBe(true);
  });

  it("preserves existing extracted fields and private annotations on a text-only edit", async () => {
    const { env, stores, save } = fixture();
    await save("original text", { visa_outcome_reason: "Existing reason", user_notes: "Keep private", decision_date: "2025-01-01" });
    const coordinator = env.CASE_MUTATION_COORDINATOR.getByName(`case:${CASE_ID}`);
    await coordinator.putCase({ record: { case_id: CASE_ID, title: "Edited title" }, canonicalText: "corrected text", preserveExisting: true });
    expect(await stores.caseStore.getCase(CASE_ID)).toMatchObject({
      title: "Edited title", visa_outcome_reason: "Existing reason", user_notes: "Keep private", date: "2025-01-01",
    });
  });

  it("preserves the existing year through a full-text-only HTTP edit", async () => {
    const { env, stores, save } = fixture();
    await save("original text", { year: 2025 });
    const path = `/api/v1/cases/${CASE_ID}`;
    const response = await dispatchCloudflareCaseMutation(new Request(`https://immi.example${path}`, {
      method: "PUT", headers: { Authorization: "Bearer offline-service", "Content-Type": "application/json" },
      body: JSON.stringify({ full_text: "corrected text" }),
    }), path, env);
    expect(response.status).toBe(200);
    expect((await stores.caseStore.getCase(CASE_ID)).year).toBe(2025);
  });

  it("keeps maximum relation and chunk counts in one bounded D1 transaction", async () => {
    const { env, stores, save } = fixture();
    const pointer = await save("original text");
    const runBatch = env.IMMI_CATALOG_DB.batch;
    const batches = [];
    env.IMMI_CATALOG_DB.batch = (statements) => { batches.push(statements); return runBatch(statements); };
    await stores.caseStore.putImportedCase({
      case: { case_id: CASE_ID, title: "Many relations", judges: Array.from({ length: 100 }, (_, i) => `Judge ${i}`), legal_concepts: Array.from({ length: 100 }, (_, i) => `Concept ${i}`) },
      sourcePointer: pointer, textChunks: Array.from({ length: 39 }, (_, i) => `Chunk ${i}`),
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(47);
    expect(Math.max(...batches[0].map((statement) => statement.params.length))).toBeLessThanOrEqual(36);
    const chunks = await env.IMMI_CATALOG_DB.prepare("SELECT COUNT(*) AS n FROM case_text_chunks WHERE case_id = ?").bind(CASE_ID).first();
    expect(chunks.n).toBe(39);
  });

  it("rolls back the case row and chunks when a relation write fails", async () => {
    const { env, save, stores } = fixture();
    await save("original text", { title: "Old title", judges: ["Old judge"] });
    const originalBatch = env.IMMI_CATALOG_DB.batch;
    env.IMMI_CATALOG_DB.batch = (statements) => {
      const poisoned = statements.map((statement) => /INSERT OR IGNORE INTO case_judges/.test(statement.sql)
        ? env.IMMI_CATALOG_DB.prepare("INSERT INTO missing_relation VALUES (1)") : statement);
      return originalBatch(poisoned);
    };
    await expect(save("corrected text", { title: "New title", judges: ["New judge"] })).rejects.toThrow();
    const current = await stores.caseStore.getCase(CASE_ID);
    expect(current.title).toBe("Old title");
    expect(current.judges).toBe("Old judge");
    const chunks = await env.IMMI_CATALOG_DB.prepare("SELECT content FROM case_text_chunks WHERE case_id = ?").bind(CASE_ID).all();
    expect(chunks.results.map((row) => row.content)).toEqual(["original text"]);
  });

  it("keeps legitimate large judgments indexable and retries a failed paid call", async () => {
    const { env, save, stores } = fixture();
    const pointer = await save("corrected text ".repeat(45_000));
    env.AI.run.mockRejectedValueOnce(new Error("temporary provider outage"));
    const first = message(pointer);
    await deliver(env, first);
    expect(first.retry).toHaveBeenCalledOnce();
    expect(first.ack).not.toHaveBeenCalled();
    const retry = message(pointer);
    await deliver(env, retry);
    expect(retry.ack).toHaveBeenCalledOnce();
    expect((await stores.caseStore.getCase(CASE_ID)).semantic_ready).toBe(1);
  });

  it.each(["delete", "tag"])("enqueues the real catalog source pointer for a batch %s", async (action) => {
    const { env, save } = fixture();
    const pointer = await save("original text");
    const path = "/api/v1/cases/batch";
    const response = await dispatchCloudflareCaseMutation(new Request(`https://immi.example${path}`, {
      method: "POST", headers: { Authorization: "Bearer offline-service", "Content-Type": "application/json" },
      body: JSON.stringify({ action, case_ids: [CASE_ID], tag: "reviewed" }),
    }), path, env);
    expect(response.status).toBe(200);
    expect(env.CASE_MUTATION_QUEUE.send).toHaveBeenCalledWith(expect.objectContaining({
      kind: action === "delete" ? "case.source.delete" : "case.reindex",
      content_key: pointer.key, content_sha256: pointer.sha256, content_size: pointer.size,
    }));
  });

  it("protects a currently referenced source from an old cleanup message", async () => {
    const { env, save, stores } = fixture();
    const pointer = await save("original text");
    await deliver(env, message(pointer, "case.source.delete"));
    expect(await stores.objectStore.getVerifiedText(pointer)).toBe("original text");
    expect(env.IMMI_CONTENT.delete).not.toHaveBeenCalled();
  });

  it("keeps a recreated case's identical text when old cleanup arrives later", async () => {
    const { env, save, stores } = fixture();
    const old = await save("original text");
    await stores.caseStore.deleteCase(CASE_ID);
    const current = await save("original text");
    await deliver(env, message(old, "case.source.delete"));
    expect(await stores.objectStore.getVerifiedText(current)).toBe("original text");
    expect(current.key).not.toBe(old.key);
  });

  it("protects recreation after the cleanup reference check has already finished", async () => {
    const { env, save, stores, objects } = fixture();
    const old = await save("original text");
    await stores.caseStore.deleteCase(CASE_ID);
    let current;
    env.IMMI_CONTENT.delete.mockImplementationOnce(async (key) => {
      current = await save("original text");
      objects.delete(key);
    });
    await deliver(env, message(old, "case.source.delete"));
    expect(await stores.objectStore.getVerifiedText(current)).toBe("original text");
    expect((await stores.caseStore.getCase(CASE_ID)).content_key).toBe(current.key);
  });

  it("reconciles a recreation that arrives during a delayed vector deletion", async () => {
    const { env, save, stores, vectors } = fixture();
    const old = await save("original text");
    await stores.caseStore.deleteCase(CASE_ID);
    const entered = deferred();
    const release = deferred();
    env.CASE_VECTORS.deleteByIds.mockImplementationOnce(async (ids) => {
      entered.resolve();
      await release.promise;
      ids.forEach((id) => vectors.delete(id));
    });
    const first = deliver(env, message(old));
    await entered.promise;
    const current = await save("corrected text");
    const second = deliver(env, message(current));
    await new Promise((resolve) => setTimeout(resolve, 20));
    release.resolve();
    await Promise.all([first, second]);
    expect(vectors.get(CASE_ID).values[0]).toBe(2);
    expect((await stores.caseStore.getCase(CASE_ID)).semantic_ready).toBe(1);
  });
});
