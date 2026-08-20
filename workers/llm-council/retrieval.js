/**
 * retrieval.js — Corpus RAG for the LLM Council.
 *
 * The Council previously ran on web_search/LLM memory alone: `retrieved_cases`
 * was always `[]` and `caseContext` was only whatever the user pasted in the
 * request body. This module closes that gap: build an FTS5 query from the
 * question, lexically search the D1 corpus, dedupe by citation, keep the top-K,
 * and render a sanitized, delimited prompt string that both the legacy and
 * streaming council paths inject as grounded evidence.
 *
 * Prompt-injection discipline: retrieved case text is untrusted input. It is
 * sanitized (HTML + control chars stripped), wrapped in `<retrieved_case>`
 * delimiters, and the prompt header tells the model to cite only — never to
 * treat case text as instructions.
 */

import { createCloudflareCaseStore } from "../storage/cloudflare.js";

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

/** Hard-deadline wrapper so a hung D1 call degrades, never blocks. */
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

const FTS_STOPWORDS = new Set([
  "a", "the", "and", "of", "to", "in", "for", "is", "are", "my", "do", "i",
  "does", "what", "how", "can", "will", "would", "should", "about", "with",
  "that", "this", "it", "on", "at", "be", "or", "but", "not", "if", "then",
  "so", "as", "by", "from", "was", "were", "has", "have", "had", "an", "you",
  "your", "we", "our", "they", "their", "he", "she", "his", "her", "etc",
]);

const FTS_PHRASES = [
  "complementary protection",
  "well founded fear",
  "jurisdictional error",
  "procedural fairness",
  "natural justice",
  "visa cancellation",
  "character test",
  "protection visa",
];

/**
 * Turn a natural-language question into an FTS5 MATCH query. Drops stopwords,
 * duplicates and 1-2 char tokens, keeps known multi-word legal phrases as
 * single quoted phrases, then OR-combines the top content terms. Returns ""
 * when nothing searchable remains (the caller then skips the FTS call).
 */
export function buildFtsQuery(question) {
  if (typeof question !== "string" || question.trim() === "") return "";
  const tokens = question.match(/[\p{L}\p{N}_-]+/gu) || [];
  const contentTerms = [];
  const seen = new Set();
  for (const token of tokens) {
    const lowerToken = token.toLowerCase();
    if (FTS_STOPWORDS.has(lowerToken) || token.length <= 2 || seen.has(lowerToken)) continue;
    seen.add(lowerToken);
    contentTerms.push(token);
  }
  const lower = question.toLowerCase().replace(/[\u2010-\u2015_-]/g, " ");
  const phraseTerms = [];
  const phraseWords = new Set();
  for (const phrase of FTS_PHRASES) {
    if (lower.includes(phrase)) {
      phraseTerms.push(phrase);
      for (const word of phrase.split(" ")) phraseWords.add(word);
    }
  }
  const filteredContent = contentTerms.filter((term) => !phraseWords.has(term.toLowerCase()));
  const combined = [...phraseTerms, ...filteredContent].slice(0, 12);
  if (combined.length === 0) return "";
  return combined.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

/**
 * Retrieve similar cases for a question and build the council context.
 *
 * Pipeline: build an FTS5 query from the question → lexical search (top
 * `recall`) → dedupe by citation → top-`topK` → render context.
 *
 * @param {object} env — worker env (IMMI_CATALOG_DB)
 * @param {string} question
 * @param {{recall?: number, topK?: number}} opts
 * @returns {Promise<{retrievedCases: Array, contextString: string, status: object}>}
 */
export async function buildCaseContextFromQuestion(env, question, { recall = RETRIEVAL_RECALL, topK = RETRIEVAL_TOP_K } = {}) {
  const start = Date.now();
  try {
    const query = buildFtsQuery(question);
    if (query === "") {
      return {
        retrievedCases: [],
        contextString: "",
        status: { state: "empty", candidates: 0, injected: 0, latency_ms: Date.now() - start },
      };
    }
    const store = createCloudflareCaseStore(env);
    const rows = await withTimeout(store.searchLexical({ match: query, limit: recall }), RETRIEVAL_TIMEOUT_MS);
    const candidates = rows.length;
    const seenCitation = new Set();
    const retrievedCases = [];
    for (const row of rows) {
      const rank = row.rank == null ? Number.NaN : Number(row.rank);
      if (!Number.isFinite(rank)) continue;
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
        relevance_score: -rank,
        bm25_rank: rank,
        snippet: sanitizeText(row.text_snippet).slice(0, SNIPPET_MAX_CHARS),
        source_url: sanitizeText(row.url),
      });
    }
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
