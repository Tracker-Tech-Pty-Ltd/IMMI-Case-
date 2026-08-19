/**
 * retrieval.js — Corpus RAG for the LLM Council.
 *
 * The Council previously ran on web_search/LLM memory alone: `retrieved_cases`
 * was always `[]` and `caseContext` was only whatever the user pasted in the
 * request body. This module closes that gap: embed the user question, wide-recall
 * similar cases from Vectorize, fetch their D1 metadata in one query, dedupe by
 * citation, keep the top-K, and render a sanitized, delimited prompt string that
 * both the legacy and streaming council paths inject as grounded evidence.
 *
 * Prompt-injection discipline: retrieved case text is untrusted input. It is
 * sanitized (HTML + control chars stripped), wrapped in `<retrieved_case>`
 * delimiters, and the prompt header tells the model to cite only — never to
 * treat case text as instructions.
 */

import { createCloudflareStores } from "../storage/cloudflare.js";

const RETRIEVAL_RECALL = 20;
const RETRIEVAL_TOP_K = 5;
const SNIPPET_MAX_CHARS = 600;
const CONTEXT_MAX_CHARS = 12000;
const RETRIEVAL_TIMEOUT_MS = 2000;

/**
 * Strip HTML tags and control characters from untrusted case text. Case text is
 * an injection surface, so this runs on every field that reaches a prompt.
 */
export function sanitizeText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Render a sorted array of RetrievedCase into one delimited prompt string.
 * Truncates by score order once the total character budget is exceeded, so the
 * council prompt never silently balloons past the input-token cap.
 *
 * @param {Array<object>} cases — sorted descending by relevance_score
 * @param {{maxChars?: number}} opts
 * @returns {string} empty when no cases
 */
export function renderRetrievedContext(cases, { maxChars = CONTEXT_MAX_CHARS } = {}) {
  if (!Array.isArray(cases) || cases.length === 0) return "";
  const blocks = [];
  let total = 0;
  for (const c of cases) {
    const block = [
      "<retrieved_case>",
      `case_id: ${c.case_id}`,
      `citation: ${c.citation}`,
      `court: ${c.court_code}${c.year ? ` (${c.year})` : ""}`,
      `title: ${c.title}`,
      `case_nature: ${c.case_nature} | visa_subclass: ${c.visa_subclass}`,
      `relevance_score: ${c.relevance_score}`,
      `snippet: ${c.snippet}`,
      `source_url: ${c.source_url}`,
      "</retrieved_case>",
    ].join("\n");
    total += block.length;
    if (total > maxChars) break;
    blocks.push(block);
  }
  return `<retrieved_cases>\n${blocks.join("\n\n")}\n</retrieved_cases>`;
}

/** Hard-deadline wrapper so a hung Vectorize/D1 call degrades, never blocks. */
function withTimeout(promise, ms, label = "retrieval") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const err = new Error(`${label} timed out after ${ms}ms`);
        err.name = "TimeoutError";
        reject(err);
      }, ms);
    }),
  ]);
}

/**
 * Retrieve similar cases for a question and build the council context.
 *
 * Pipeline: embed → Vectorize wide-recall (top `recall`) → D1 metadata fetch in
 * one query → dedupe by citation → sort by score → top-`topK` → render context.
 *
 * @param {object} env — worker env (CASE_VECTORS, AI, IMMI_CATALOG_DB)
 * @param {string} question
 * @param {{recall?: number, topK?: number}} opts
 * @returns {Promise<{retrievedCases: Array, contextString: string, status: object}>}
 */
export async function buildCaseContextFromQuestion(env, question, { recall = RETRIEVAL_RECALL, topK = RETRIEVAL_TOP_K } = {}) {
  const start = Date.now();
  try {
    const stores = createCloudflareStores(env);
    const queryResult = await withTimeout(
      stores.semanticIndex.searchText(question, { limit: recall }),
      RETRIEVAL_TIMEOUT_MS,
    );
    const matches = (Array.isArray(queryResult?.matches) ? queryResult.matches : [])
      .filter((m) => m && typeof m.id === "string" && m.id.length > 0);
    const candidates = matches.length;

    const caseIds = matches.map((m) => m.id);
    const rows = caseIds.length > 0 ? await withTimeout(stores.caseStore.findByIds(caseIds), RETRIEVAL_TIMEOUT_MS) : [];

    const scoreByCaseId = new Map(matches.map((m) => [m.id, Number(m.score) || 0]));
    const seenCitation = new Set();
    const retrievedCases = [];
    for (const row of rows) {
      const citationKey = sanitizeText(row.citation).toLowerCase();
      if (citationKey && seenCitation.has(citationKey)) continue;
      if (citationKey) seenCitation.add(citationKey);
      retrievedCases.push({
        case_id: row.case_id,
        citation: sanitizeText(row.citation),
        court_code: sanitizeText(row.court_code),
        year: Number.isInteger(row.year) ? row.year : null,
        title: sanitizeText(row.title),
        case_nature: sanitizeText(row.case_nature),
        visa_subclass: sanitizeText(row.visa_subclass),
        relevance_score: scoreByCaseId.get(row.case_id) ?? 0,
        snippet: sanitizeText(row.text_snippet).slice(0, SNIPPET_MAX_CHARS),
        source_url: sanitizeText(row.url),
      });
    }
    retrievedCases.sort((a, b) => b.relevance_score - a.relevance_score);
    const top = retrievedCases.slice(0, topK);

    return {
      retrievedCases: top,
      contextString: renderRetrievedContext(top),
      status: {
        state: top.length === 0 ? "empty" : "ok",
        candidates,
        injected: top.length,
        latency_ms: Date.now() - start,
      },
    };
  } catch (err) {
    return {
      retrievedCases: [],
      contextString: "",
      status: {
        state: err?.name === "TimeoutError" ? "timeout" : "degraded",
        candidates: 0,
        injected: 0,
        latency_ms: Date.now() - start,
        error: String(err?.message || err).slice(0, 200),
      },
    };
  }
}
