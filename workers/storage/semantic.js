import {
  assertCaseId,
  clampLimit,
  StorageBoundaryError,
  VECTOR_DIMENSIONS,
  VECTOR_MODEL,
} from "./contracts.js";

const VECTOR_FILTER_KEYS = new Set(["court_code", "year", "source", "visa_subclass"]);

export class CloudflareSemanticIndex {
  constructor(env) {
    this.index = env.CASE_VECTORS;
    this.ai = env.AI;
  }

  async embed(text) {
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new StorageBoundaryError("Embedding text is required", { code: "invalid_embedding_text", status: 400 });
    }
    const result = await this.ai.run(VECTOR_MODEL, { text: [text] });
    const vectors = Array.isArray(result) ? result : result?.data;
    const vector = Array.isArray(vectors) ? vectors[0] : null;
    if (!Array.isArray(vector) || vector.length !== VECTOR_DIMENSIONS) {
      throw new StorageBoundaryError("Workers AI returned an unexpected embedding shape", {
        code: "embedding_shape_invalid",
        status: 503,
      });
    }
    return vector;
  }

  async relatedById(caseId, { filters = {}, limit } = {}) {
    const id = assertCaseId(caseId);
    const filter = {};
    for (const [key, value] of Object.entries(filters)) {
      if (!VECTOR_FILTER_KEYS.has(key) || value === undefined || value === null || value === "") continue;
      if ((key === "year" && !Number.isInteger(value)) || (key !== "year" && typeof value !== "string")) {
        throw new StorageBoundaryError(`Invalid Vectorize filter: ${key}`, { code: "invalid_filter", status: 400 });
      }
      filter[key] = value;
    }
    return this.index.queryById(id, {
      topK: clampLimit(limit, { fallback: 100, max: 100 }),
      returnMetadata: "indexed",
      ...(Object.keys(filter).length > 0 ? { filter } : {}),
    });
  }

  async searchText(text, { filters = {}, limit } = {}) {
    const vector = await this.embed(text);
    const filter = {};
    for (const [key, value] of Object.entries(filters)) {
      if (!VECTOR_FILTER_KEYS.has(key) || value === undefined || value === null || value === "") continue;
      if ((key === "year" && !Number.isInteger(value)) || (key !== "year" && typeof value !== "string")) {
        throw new StorageBoundaryError(`Invalid Vectorize filter: ${key}`, { code: "invalid_filter", status: 400 });
      }
      filter[key] = value;
    }
    return this.index.query(vector, {
      topK: clampLimit(limit, { fallback: 100, max: 100 }),
      returnMetadata: "indexed",
      ...(Object.keys(filter).length > 0 ? { filter } : {}),
    });
  }

  async upsertCase(caseId, values, metadata) {
    const id = assertCaseId(caseId);
    if (!Array.isArray(values) || values.length !== VECTOR_DIMENSIONS) {
      throw new StorageBoundaryError("Vector dimensions must be exactly 1024", { code: "invalid_vector_dimensions", status: 400 });
    }
    const safeMetadata = {};
    for (const key of VECTOR_FILTER_KEYS) {
      if (metadata?.[key] !== undefined) safeMetadata[key] = metadata[key];
    }
    return this.index.upsert([{ id, values, metadata: safeMetadata }]);
  }

  async deleteCase(caseId) {
    const id = assertCaseId(caseId);
    if (typeof this.index.deleteByIds !== "function") {
      throw new StorageBoundaryError("Vectorize deleteByIds binding is unavailable", {
        code: "vectorize_delete_unavailable",
        status: 503,
      });
    }
    return this.index.deleteByIds([id]);
  }
}
