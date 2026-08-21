/**
 * Idempotent Cloudflare storage coordinator for an extracted AustLII case.
 *
 * Containers may return extraction data but never receive data-store
 * credentials. Queue consumers invoke this coordinator only after extraction.
 * Replays are safe because the event id is bound to an immutable SHA-256 and
 * each durable write is deterministic/upserted.
 */

import { createCloudflareStores } from "./cloudflare.js";
import {
  FTS_CHUNK_MAX_BYTES,
  sha256Hex,
  StorageBoundaryError,
} from "./contracts.js";

function assertEventId(eventId) {
  if (typeof eventId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(eventId)) {
    throw new StorageBoundaryError("Pipeline event id is invalid", { code: "invalid_pipeline_event", status: 400 });
  }
  return eventId;
}

function assertRunId(runId) {
  if (typeof runId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(runId)) {
    throw new StorageBoundaryError("Pipeline run id is invalid", { code: "invalid_pipeline_run", status: 400 });
  }
  return runId;
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new StorageBoundaryError(`${field} is required`, { code: "invalid_pipeline_payload", status: 400 });
  }
  return value;
}

/** Split at a character boundary while guaranteeing the D1 byte guard. */
export function splitFtsChunks(text) {
  const source = requiredText(text, "canonicalText");
  const encoder = new TextEncoder();
  const chunks = [];
  let start = 0;
  while (start < source.length) {
    const upper = Math.min(source.length, start + FTS_CHUNK_MAX_BYTES);
    let low = start + 1;
    let high = upper;
    let end = start;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (encoder.encode(source.slice(start, middle)).byteLength <= FTS_CHUNK_MAX_BYTES) {
        end = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (end === start) {
      throw new StorageBoundaryError("Canonical text contains an oversized code point", {
        code: "fts_chunk_too_large",
        status: 400,
      });
    }
    // Do not split a UTF-16 surrogate pair when the byte limit lands between it.
    if (end < source.length && /[\uD800-\uDBFF]/.test(source.charAt(end - 1))) end -= 1;
    chunks.push(source.slice(start, end));
    start = end;
  }
  return chunks;
}

function vectorMetadata(record) {
  const year = Number(record?.year);
  return {
    court_code: String(record?.court_code || ""),
    ...(Number.isInteger(year) ? { year } : {}),
    source: String(record?.source || "austlii-pipeline"),
    visa_subclass: String(record?.visa_subclass || record?.visa_subclass_number || ""),
  };
}

function normaliseAudit(audit) {
  if (!Array.isArray(audit)) return [];
  return audit
    .filter((entry) => entry && typeof entry.fieldName === "string" && typeof entry.newValue === "string")
    .slice(0, 100)
    .map((entry) => ({
      fieldName: entry.fieldName.slice(0, 128),
      oldValue: entry.oldValue === undefined || entry.oldValue === null ? null : String(entry.oldValue).slice(0, 8192),
      newValue: entry.newValue.slice(0, 8192),
      source: String(entry.source || "pipeline").slice(0, 64),
      confidence: entry.confidence === undefined || entry.confidence === null ? null : Number(entry.confidence),
    }));
}

/**
 * Fixed durable write order: R2 source → Catalog D1 → Vectorize → Ops final
 * checkpoint. The initial idempotency claim and pipeline-run record contain
 * only coordination metadata; neither is a corpus write.
 */
export async function coordinateExtractedCase({
  env,
  eventId,
  runId,
  record,
  canonicalText,
  audit = [],
}) {
  const checkedEventId = assertEventId(eventId);
  const checkedRunId = assertRunId(runId);
  const text = requiredText(canonicalText, "canonicalText");
  const stores = createCloudflareStores(env);
  const payloadSha256 = (await sha256Hex(JSON.stringify({
    case_id: record?.case_id,
    record,
    canonical_text_sha256: (await sha256Hex(text)).hex,
  }))).hex;

  await stores.pipelineStore.ensurePipelineRun({ runId: checkedRunId });
  const claimed = await stores.pipelineStore.claimEvent(checkedEventId, {
    runId: checkedRunId,
    kind: "extracted_case",
    payloadSha256,
  });
  if (!claimed && await stores.pipelineStore.isEventComplete(checkedEventId)) {
    return { status: "replayed", eventId: checkedEventId, caseId: record.case_id };
  }

  const sourcePointer = await stores.objectStore.putCaseSource({ caseId: record?.case_id, body: text });
  await stores.pipelineStore.pipelineCheckpoint({
    runId: checkedRunId,
    eventId: checkedEventId,
    step: "r2",
    status: "complete",
    detail: { case_id: record.case_id, content_sha256: sourcePointer.sha256 },
  });
  await stores.caseStore.putImportedCase({
    case: record,
    sourcePointer,
    textChunks: splitFtsChunks(text),
  });
  await stores.pipelineStore.pipelineCheckpoint({
    runId: checkedRunId,
    eventId: checkedEventId,
    step: "catalog",
    status: "complete",
    detail: { case_id: record.case_id },
  });
  const embedding = await stores.semanticIndex.embed(text);
  const mutation = await stores.semanticIndex.upsertCase(record.case_id, embedding, vectorMetadata(record));
  await stores.caseStore.markSemanticReady(record.case_id, mutation?.mutationId || null);
  await stores.pipelineStore.pipelineCheckpoint({
    runId: checkedRunId,
    eventId: checkedEventId,
    step: "vectorize",
    status: "complete",
    detail: { case_id: record.case_id, vector_mutation_id: mutation?.mutationId || null },
  });
  for (const item of normaliseAudit(audit)) {
    await stores.pipelineStore.recordExtractionAudit({
      auditId: `${checkedEventId}:${item.fieldName}`,
      runId: checkedRunId,
      caseId: record.case_id,
      ...item,
    });
  }
  await stores.pipelineStore.pipelineCheckpoint({
    runId: checkedRunId,
    eventId: checkedEventId,
    step: "ops",
    status: "complete",
    detail: {
      case_id: record.case_id,
      content_sha256: sourcePointer.sha256,
      vector_mutation_id: mutation?.mutationId || null,
    },
  });
  await stores.pipelineStore.completeEvent(checkedEventId);
  return {
    status: "completed",
    eventId: checkedEventId,
    caseId: record.case_id,
    contentPointer: sourcePointer,
    vectorMutationId: mutation?.mutationId || null,
  };
}
