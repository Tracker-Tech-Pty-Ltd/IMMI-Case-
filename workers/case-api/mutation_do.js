import { DurableObject } from "cloudflare:workers";
import { createCloudflareStores } from "../storage/cloudflare.js";
import { assertCaseId, assertObjectPointer, sha256Hex, StorageBoundaryError } from "../storage/contracts.js";
import { splitFtsChunks } from "../storage/pipeline_coordinator.js";

const MAX_RECONCILIATION_ATTEMPTS = 4;
const RETIRED_SOURCES_KEY = "retired-sources";

function sourcePointer(row) {
  if (!row?.content_key) return null;
  try {
    return assertObjectPointer({
      key: row.content_key, sha256: row.content_sha256, size: row.content_size,
      contentType: "text/plain; charset=utf-8",
    }, "cases");
  } catch { return null; }
}

/**
 * Serializes catalog writes and Vectorize submissions for one case.
 *
 * Reads remain available while an embedding runs. Every write gives the row a
 * fresh pending version; a conditional ready update also detects writes from
 * older runtimes or maintenance paths and reconciles the latest live row.
 * The promise chain is instance-owned, never an isolate-global mutex. Ongoing
 * RPC work keeps the DO active without blockConcurrencyWhile's 30-second cap.
 */
export class CaseMutationDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.runtimeEnv = env;
    this.state = ctx;
    this.pending = Promise.resolve();
  }

  async reindexCase(caseId) {
    const id = assertCaseId(caseId);
    return this.#serialize(() => this.#reconcile(id));
  }

  #serialize(callback) {
    const operation = this.pending.then(callback);
    // One failed delivery must not poison every later delivery for this case.
    this.pending = operation.catch(() => {});
    return operation;
  }

  async putCase({ record, canonicalText, preserveExisting = false }) {
    const caseId = assertCaseId(record?.case_id);
    return this.#serialize(async () => {
      const stores = createCloudflareStores(this.runtimeEnv);
      const previous = await stores.caseStore.getCase(caseId);
      if (preserveExisting && !previous) {
        throw new StorageBoundaryError("Case not found", { code: "case_not_found", status: 404 });
      }
      const oldPointer = sourcePointer(previous);
      const { hex } = await sha256Hex(canonicalText);
      // Reuse only a LIVE reference whose R2 head still verifies. Never
      // resurrect a retired checksum key after a delete/recreate lifecycle.
      const reuse = oldPointer?.sha256 === hex && await stores.objectStore.hasVerifiedCaseSource(oldPointer);
      const pointer = reuse ? oldPointer : await stores.objectStore.putCaseSource({ caseId, body: canonicalText });
      try {
        if (oldPointer && oldPointer.key !== pointer.key) await this.#rememberRetirement(caseId, oldPointer);
        const patch = Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
        const next = preserveExisting ? {
          ...previous, ...patch, decision_date: patch.decision_date ?? previous.date,
        } : record;
        await stores.caseStore.putImportedCase({
          case: next, sourcePointer: pointer,
          textChunks: canonicalText ? splitFtsChunks(canonicalText) : [],
        });
      } catch (error) {
        // A normal pre-publication failure can release its unpublished upload.
        // A hard runtime interruption between R2 and D1 remains recoverable
        // by the existing object reconciliation procedure.
        if (!reuse) {
          try {
            const current = await stores.caseStore.getCase(caseId);
            if (current?.content_key !== pointer.key) await stores.objectStore.deleteVerified(pointer);
          } catch (_) { /* keep the original publication error */ }
        }
        throw error;
      }
      await this.#flushRetirements();
      return pointer;
    });
  }

  async updateCaseFields(caseId, updates) {
    const id = assertCaseId(caseId);
    return this.#serialize(() => createCloudflareStores(this.runtimeEnv).caseStore.updateCaseFields(id, updates));
  }

  async tagCase(caseId, tag) {
    const id = assertCaseId(caseId);
    return this.#serialize(async () => {
      const stores = createCloudflareStores(this.runtimeEnv);
      const affected = await stores.caseStore.batchAddTag([id], tag);
      return { affected, case: await stores.caseStore.getCase(id) };
    });
  }

  async deleteCase(caseId) {
    const id = assertCaseId(caseId);
    return this.#serialize(async () => {
      const stores = createCloudflareStores(this.runtimeEnv);
      const current = await stores.caseStore.getCase(id);
      const pointer = sourcePointer(current);
      if (pointer) await this.#rememberRetirement(id, pointer);
      if (current) await stores.caseStore.deleteCase(id);
      await this.#reconcile(id);
      await this.#flushRetirements();
      return { affected: current ? 1 : 0, updatedAt: current?.updated_at || "" };
    });
  }

  async #rememberRetirement(caseId, pointer) {
    const pending = await this.state.storage.get(RETIRED_SOURCES_KEY) || [];
    if (!pending.some((item) => item.pointer.key === pointer.key)) pending.push({ caseId, pointer });
    await this.state.storage.put(RETIRED_SOURCES_KEY, pending);
    await this.state.storage.setAlarm(Date.now() + 30_000);
  }

  async #flushRetirements() {
    const stores = createCloudflareStores(this.runtimeEnv);
    const pending = await this.state.storage.get(RETIRED_SOURCES_KEY) || [];
    while (pending.length) {
      const { caseId, pointer } = pending[0];
      const current = await stores.caseStore.getCase(caseId);
      if (current?.content_key !== pointer.key) {
        if (typeof this.runtimeEnv.CASE_MUTATION_QUEUE?.send !== "function") {
          throw new StorageBoundaryError("Case cleanup queue is unavailable", { code: "case_mutation_queue_unavailable", status: 503 });
        }
        const { hex } = await sha256Hex(pointer.key);
        await this.runtimeEnv.CASE_MUTATION_QUEUE.send({
          event_id: `case.source.delete:${caseId}:${hex}`, kind: "case.source.delete", case_id: caseId,
          content_key: pointer.key, content_sha256: pointer.sha256,
          content_size: pointer.size, content_type: pointer.contentType,
        });
      }
      pending.shift();
      if (pending.length) await this.state.storage.put(RETIRED_SOURCES_KEY, pending);
      else await this.state.storage.delete(RETIRED_SOURCES_KEY);
    }
    await this.state.storage.deleteAlarm();
  }

  async alarm() {
    return this.#serialize(async () => {
      try { await this.#flushRetirements(); }
      catch (error) {
        await this.state.storage.setAlarm(Date.now() + 30_000);
        throw error;
      }
    });
  }

  async #reconcile(caseId) {
    const stores = createCloudflareStores(this.runtimeEnv);
    for (let attempt = 0; attempt < MAX_RECONCILIATION_ATTEMPTS; attempt += 1) {
      const current = await stores.caseStore.getCase(caseId);
      if (!current) {
        await stores.semanticIndex.deleteCase(caseId);
        // A recreation may have committed while the vector delete was in flight.
        if (await stores.caseStore.getCase(caseId)) continue;
        return { status: "deleted", mutationId: null };
      }
      if (current.semantic_ready) {
        return { status: "already_current", mutationId: current.vector_mutation_id || null };
      }
      // Queue pointers are historical hints. Always index the authoritative
      // current pointer, including when an older event is delivered last.
      const text = current.content_key
        ? await stores.objectStore.getVerifiedText({
          key: current.content_key,
          sha256: current.content_sha256,
          size: current.content_size,
          contentType: "text/plain; charset=utf-8",
        }, { maxBytes: 16 * 1024 * 1024 })
        : "";
      const embedding = await stores.semanticIndex.embed(text || `${current.title || ""} ${current.citation || ""}`.trim());
      const mutation = await stores.semanticIndex.upsertCase(caseId, embedding, {
        court_code: String(current.court_code || ""),
        ...(Number.isInteger(current.year) ? { year: current.year } : {}),
        source: String(current.source || ""),
        visa_subclass: String(current.visa_subclass || ""),
      });
      const ready = await stores.caseStore.markSemanticReady(caseId, mutation?.mutationId || null, current);
      if (ready) return { status: "indexed", mutationId: mutation?.mutationId || null };
      // A concurrent edit/deletion won the D1 CAS. Reconcile it here while no
      // other vector writer can overtake this one. Persistent churn is retried
      // by the Queue instead of acknowledging an incorrectly ready row.
    }
    throw new StorageBoundaryError("Case changed repeatedly during indexing", {
      code: "case_changed_during_reindex", status: 503,
    });
  }
}
