/**
 * runner-helpers.js — Pure utility helpers for the LLM Council Worker.
 *
 * Ported 1:1 from immi_case_downloader/llm_council.py.
 * All functions are pure (no I/O, no side effects) for easy unit testing.
 */

// ---------------------------------------------------------------------------
// normalizeGatewayModel
// ---------------------------------------------------------------------------

/**
 * Ensure model name carries a CF Gateway provider prefix.
 *
 * The compat endpoint requires `<provider>/<model>` form. Bare model names
 * (e.g. legacy env values like `claude-sonnet-4-6`) get auto-prefixed.
 *
 * @param {string} model
 * @param {string} defaultPrefix
 * @returns {string}
 */
export function normalizeGatewayModel(model, defaultPrefix) {
  const name = (model || "").trim();
  if (name.includes("/")) return name;
  return name ? `${defaultPrefix}/${name}` : name;
}

// ---------------------------------------------------------------------------
// extractChatCompletionText
// ---------------------------------------------------------------------------

/**
 * Parse OpenAI Chat Completions response: choices[0].message.content.
 *
 * Some providers return content as a list of parts (each with `text` or
 * `content` key); those are joined with double-newlines.
 *
 * @param {object} payload
 * @returns {string}
 */
export function extractChatCompletionText(payload) {
  const choices = payload?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0];
  if (!first || typeof first !== "object") return "";
  const message = first.message;
  if (!message || typeof message !== "object") return "";
  let content = message.content ?? "";
  if (Array.isArray(content)) {
    // Some providers return content as parts list
    const parts = [];
    for (const part of content) {
      if (part && typeof part === "object") {
        const text = part.text || part.content || "";
        if (typeof text === "string" && text) parts.push(text);
      } else if (typeof part === "string") {
        parts.push(part);
      }
    }
    content = parts.join("\n\n");
  }
  return (content || "").trim();
}

// ---------------------------------------------------------------------------
// stripReasoningArtifacts
// ---------------------------------------------------------------------------

/**
 * Drop reasoning-model `<think>...</think>` chain-of-thought from output.
 *
 * Handles two shapes:
 * 1. Properly fenced: `<think>...</think>actual answer` → return only the answer.
 * 2. QwQ-style (no opening tag, just trailing close):
 *    `reasoning text </think>actual answer`
 *    — find the LAST `</think>` and discard everything before it.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripReasoningArtifacts(text) {
  if (!text) return text;
  // Step 1: remove any well-fenced think blocks anywhere in the text.
  // Use a fresh regex each call to avoid stateful lastIndex issues.
  let cleaned = text.replace(/<think\s*>[\s\S]*?<\/think\s*>/gi, "");
  // Step 2: if a stray `</think>` remains (QwQ-style, no opening tag),
  // treat everything before the last close-tag as reasoning and drop it.
  const closeRe = /<\/think\s*>/gi;
  let lastMatch = null;
  let m;
  while ((m = closeRe.exec(cleaned)) !== null) {
    lastMatch = m;
  }
  if (lastMatch !== null) {
    cleaned = cleaned.slice(lastMatch.index + lastMatch[0].length);
  }
  return cleaned.trim();
}

// ---------------------------------------------------------------------------
// repairTruncatedJson
// ---------------------------------------------------------------------------

/**
 * Best-effort close of LLM-truncated JSON so it parses.
 *
 * Walks the stream tracking string/escape/brace/bracket state, truncates
 * back to the last complete value, then appends matching close characters
 * in reverse stack order. Lossy: incomplete trailing fields are discarded.
 *
 * Returns the repaired body (no leading prose), or the original text if
 * no opening `{` is found.
 *
 * @param {string} text
 * @returns {string}
 */
export function repairTruncatedJson(text) {
  if (!text) return text;
  const start = text.indexOf("{");
  if (start < 0) return text;
  let body = text.slice(start);

  /** @type {string[]} tracks unclosed '{' or '[' */
  const stack = [];
  let inStr = false;
  let escape = false;
  let lastSafe = 0;         // index right after the last complete top-level value
  let stackAtLastSafe = []; // snapshot of stack at lastSafe

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      if (
        stack.length > 0 &&
        ((ch === "}" && stack[stack.length - 1] === "{") ||
          (ch === "]" && stack[stack.length - 1] === "["))
      ) {
        stack.pop();
        lastSafe = i + 1;
        stackAtLastSafe = [...stack];
        if (stack.length === 0) {
          return body.slice(0, lastSafe);
        }
      }
    } else if (ch === "," && !inStr) {
      lastSafe = i; // before this comma is a complete value
      stackAtLastSafe = [...stack];
    }
  }

  // Truncated input — walk back to the last clean checkpoint
  if (stack.length > 0) {
    body = lastSafe > 0 ? body.slice(0, lastSafe) : body;
  }
  // Drop trailing whitespace, commas, and colons (orphan key separators)
  body = body.replace(/[,:\n\r\t ]+$/, "");
  // Close containers that were open AT lastSafe
  while (stackAtLastSafe.length > 0) {
    const opener = stackAtLastSafe.pop();
    body += opener === "{" ? "}" : "]";
  }
  return body;
}

// ---------------------------------------------------------------------------
// extractFirstJsonObject
// ---------------------------------------------------------------------------

/**
 * Parse the first JSON object out of a possibly noisy LLM response.
 *
 * Tries (in order):
 * 1. Strip markdown ```json fence if present, then direct JSON.parse.
 * 2. Brace-balancing extraction — walks from first `{`, honors string/escape.
 * 3. Truncation repair via repairTruncatedJson, then parse.
 * 4. Legacy greedy regex fallback.
 *
 * Returns null if no valid JSON object can be parsed.
 *
 * @param {string} text
 * @returns {object|null}
 */
export function extractFirstJsonObject(text) {
  if (!text) return null;
  let stripped = text.trim();

  // 1. Strip ```json ... ``` fence if present
  const fenceMatch = stripped.match(/^```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    stripped = fenceMatch[1].trim();
  }

  // 2. Direct parse on the (possibly de-fenced) text
  try {
    const payload = JSON.parse(stripped);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return payload;
    }
  } catch (_) {
    // fall through
  }

  // 3. Brace-balanced walk
  const startIdx = stripped.indexOf("{");
  if (startIdx >= 0) {
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let idx = startIdx; idx < stripped.length; idx++) {
      const ch = stripped[idx];
      if (escape) {
        escape = false;
        continue;
      }
      if (inStr) {
        if (ch === "\\") escape = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = stripped.slice(startIdx, idx + 1);
          try {
            const payload = JSON.parse(candidate);
            if (payload && typeof payload === "object" && !Array.isArray(payload)) {
              return payload;
            }
          } catch (_) {
            // break to next strategy
          }
          break;
        }
      }
    }
  }

  // 4. Truncation repair
  const repaired = repairTruncatedJson(stripped);
  if (repaired && repaired !== stripped) {
    try {
      const payload = JSON.parse(repaired);
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        return payload;
      }
    } catch (_) {
      // fall through
    }
  }

  // 5. Legacy greedy regex fallback
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const payload = JSON.parse(match[0]);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return payload;
    }
  } catch (_) {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// isGpt5ReasoningModel
// ---------------------------------------------------------------------------

/**
 * gpt-5 family models reject `max_tokens` and `temperature != 1`.
 *
 * Covers `openai/gpt-5`, `openai/gpt-5-mini`, future gpt-5 variants.
 *
 * @param {string} model
 * @returns {boolean}
 */
export function isGpt5ReasoningModel(model) {
  return (model || "").toLowerCase().startsWith("openai/gpt-5");
}

// ---------------------------------------------------------------------------
// Law-section citation matching (shared-law-sections confidence feature)
// ---------------------------------------------------------------------------

/**
 * Matches an inline statute/regulation citation, e.g.
 * "Migration Act 1958 (Cth) s 36" or "Migration Regulations 1994 (Cth) reg 2.03".
 *
 * Ported verbatim from Python's FULL_LAW_CITE_RE. `matchAll` clones the
 * regex per call, so lastIndex never leaks across invocations despite the
 * module-level `g` flag.
 */
const FULL_LAW_CITE_RE =
  /\b([A-Z][A-Za-z0-9&'().,\- ]{2,}?\s(?:Act|Acts|Regulation|Regulations|Rules)\s\d{4}(?:\s*\([^)]+\))?\s+(?:s|ss|section|sections|reg|regs|regulation|rule)\.?\s*\d+[A-Za-z]*(?:\([0-9A-Za-z]+\))*)/gi;

/**
 * Collapse common law-section phrasing variants ("section" / "ss" / "reg" /
 * "regulation") to a single abbreviated form and trim stray punctuation, so
 * differently-worded citations to the same section compare equal.
 *
 * Ported 1:1 from `_normalize_law_section` in immi_case_downloader/llm_council.py.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeLawSection(text) {
  let value = String(text || "").trim();
  if (!value) return "";
  value = value.replace(/\bsections?\b/gi, "s");
  value = value.replace(/\bss\b/gi, "s");
  value = value.replace(/\bregs?\b/gi, "reg");
  value = value.replace(/\bregulation\b/gi, "reg");
  value = value.replace(/\s+/g, " ");
  value = value.replace(/^[\s;,.]+|[\s;,.]+$/g, "");
  return value;
}

/**
 * Case/whitespace/punctuation-insensitive identity key for a law-section
 * citation string. Two citations that only differ in wording ("s" vs
 * "section"), case, or punctuation normalize to the same key.
 *
 * Ported 1:1 from `_law_section_key` in immi_case_downloader/llm_council.py.
 *
 * @param {string} text
 * @returns {string}
 */
export function lawSectionKey(text) {
  const normalized = normalizeLawSection(text).toLowerCase();
  return normalized.replace(/[^a-z0-9]+/g, "");
}

/**
 * De-duplicate a list of law-section citation strings by their normalized
 * key, keeping the first (normalized) surface form of each.
 *
 * Ported 1:1 from `_dedupe_law_sections` in immi_case_downloader/llm_council.py.
 *
 * @param {string[]} values
 * @param {number} [maxItems]
 * @returns {string[]}
 */
export function dedupeLawSections(values, maxItems = 25) {
  const seen = new Set();
  const out = [];
  for (const raw of values || []) {
    const item = normalizeLawSection(raw);
    if (!item) continue;
    const key = lawSectionKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * Extract statute/regulation section citations directly from free-form
 * answer text (used when no structured citation list was supplied by the
 * moderator, e.g. the fallback-moderator path).
 *
 * Ported 1:1 from `_extract_law_sections_from_text` in immi_case_downloader/llm_council.py.
 *
 * @param {string} text
 * @param {number} [maxItems]
 * @returns {string[]}
 */
export function extractLawSectionsFromText(text, maxItems = 25) {
  if (!text) return [];
  const matches = [];
  for (const match of String(text).matchAll(FULL_LAW_CITE_RE)) {
    if (match[1]) matches.push(match[1].trim());
  }
  return dedupeLawSections(matches, maxItems);
}

/**
 * Coerce a moderator-declared JSON array to trimmed non-empty strings,
 * truncated to `maxItems` *before* the final exact-string dedupe.
 *
 * Ported 1:1 from `_as_string_list` in immi_case_downloader/llm_council.py
 * as used inside `_build_provider_law_sections` — note the truncate-then-
 * dedupe order matters: a raw list of 30 exact-duplicate strings collapses
 * to 1 entry (not 25) because dedupe runs on the already-truncated slice.
 *
 * Intentional divergence from the Python reference: falsy non-string
 * scalars (`null`, `0`, `false`) are dropped here via `item || ""`, whereas
 * `_as_string_list` stringifies them into `"None"` / `"0"` / `"False"`.
 * Those JS equivalents (`"null"` / `"0"` / `"false"`) would be garbage
 * citations anyway, so this file deliberately does not replicate that
 * stringification.
 *
 * @param {unknown} value
 * @param {number} maxItems
 * @returns {string[]}
 */
function asRawDeclaredStringList(value, maxItems) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const text = String(item || "").trim();
    if (!text) continue;
    out.push(text);
    if (out.length >= maxItems) break;
  }
  const seen = new Set();
  const deduped = [];
  for (const text of out) {
    if (seen.has(text)) continue;
    seen.add(text);
    deduped.push(text);
  }
  return deduped;
}

/**
 * Build the per-provider law-section citation lists used for shared-section
 * cross-checking: merge the moderator's own raw per-provider claims
 * (`raw[providerKey]`, an unverified JSON array from the moderator's parsed
 * response) with citations extracted directly from that provider's raw
 * answer text via `extractLawSectionsFromText`. Merging — rather than
 * trusting the moderator's claims alone — means a moderator that omits a
 * provider's real citations doesn't erase them from the confidence
 * calculation, and a moderator-declared "shared" section that no provider
 * actually cites can't survive into `computeSharedLawSections` downstream.
 *
 * Ported 1:1 from `_build_provider_law_sections` in
 * immi_case_downloader/llm_council.py — including the `raw={}`/`raw=null`
 * case (citations sourced purely from answer text), used by the
 * fallback-moderator path where there is no moderator JSON at all.
 *
 * @param {unknown} raw - `parsed.provider_law_sections` from the
 *   moderator's own JSON, or `{}`/`null` when there is none.
 * @param {Array<{provider_key: string, answer?: string}>} opinions
 * @param {Set<string>|string[]} allowedProviderKeys
 * @returns {Record<string, string[]>}
 */
export function buildProviderLawSections(raw, opinions, allowedProviderKeys) {
  const rawMap = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const result = {};
  for (const providerKey of [...allowedProviderKeys].sort()) {
    const fromRaw = asRawDeclaredStringList(rawMap[providerKey], 25);
    const opinion = opinions.find((o) => o.provider_key === providerKey);
    const inferred = extractLawSectionsFromText(opinion ? opinion.answer : "", 25);
    const merged = dedupeLawSections([...fromRaw, ...inferred], 25);
    if (merged.length) result[providerKey] = merged;
  }
  return result;
}

/** Intersection of an array of Sets (empty array -> empty Set). */
function intersectAllSets(sets) {
  if (!sets.length) return new Set();
  let result = sets[0];
  for (let i = 1; i < sets.length; i++) {
    const next = new Set();
    for (const item of result) {
      if (sets[i].has(item)) next.add(item);
    }
    result = next;
  }
  return result;
}

/**
 * Sections cited by every provider in `providerOrder`, ordered to match
 * their first appearance for the first provider. Returns `[]` if any
 * provider has no citations at all, or if there is no overlap.
 *
 * Ported 1:1 from `_compute_shared_law_sections` in immi_case_downloader/llm_council.py.
 *
 * @param {{providerLawSections: Record<string, string[]>, providerOrder: string[]}} opts
 * @returns {string[]}
 */
export function computeSharedLawSections({ providerLawSections, providerOrder }) {
  const order = Array.isArray(providerOrder) ? providerOrder : [];
  if (!order.length) return [];

  const bySections =
    providerLawSections && typeof providerLawSections === "object" ? providerLawSections : {};

  const keySets = [];
  const representative = new Map();
  for (const providerKey of order) {
    const items = Array.isArray(bySections[providerKey]) ? bySections[providerKey] : [];
    if (!items.length) return [];
    const keys = new Set(items.map((item) => lawSectionKey(item)).filter(Boolean));
    if (keys.size === 0) return [];
    keySets.push(keys);
    for (const item of items) {
      const key = lawSectionKey(item);
      if (key && !representative.has(key)) representative.set(key, item);
    }
  }

  const sharedKeys = intersectAllSets(keySets);
  if (sharedKeys.size === 0) return [];

  const firstProviderItems = Array.isArray(bySections[order[0]]) ? bySections[order[0]] : [];
  const firstOrder = new Map();
  firstProviderItems.forEach((item, idx) => {
    firstOrder.set(lawSectionKey(item), idx);
  });

  const shared = [...sharedKeys]
    .filter((key) => representative.has(key))
    .map((key) => representative.get(key));
  shared.sort((a, b) => {
    const aIdx = firstOrder.has(lawSectionKey(a)) ? firstOrder.get(lawSectionKey(a)) : 999;
    const bIdx = firstOrder.has(lawSectionKey(b)) ? firstOrder.get(lawSectionKey(b)) : 999;
    return aIdx - bIdx;
  });
  return dedupeLawSections(shared, 25);
}

/**
 * Round half-to-even (banker's rounding), matching Python's built-in
 * `round()` semantics for floats — JS's `Math.round` rounds .5 away from
 * zero, which disagrees with Python at exact-tie percentages.
 *
 * @param {number} value
 * @returns {number}
 */
function pythonRound(value) {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (Math.abs(diff - 0.5) < 1e-9) {
    return floor % 2 === 0 ? floor : floor + 1;
  }
  return diff < 0.5 ? floor : floor + 1;
}

/**
 * Cross-check citation consistency across the successful expert providers
 * and score it as a 0-100 confidence percentage, weighting shared-by-all
 * overlap (75%) higher than mean pairwise overlap (25%). Requires at least
 * 3 successful providers (three-model consensus scoring); falls back to an
 * honest 0%-with-reason when fewer providers succeeded or citation data is
 * missing for any of them.
 *
 * Ported 1:1 from `_compute_shared_law_sections_confidence` in
 * immi_case_downloader/llm_council.py.
 *
 * @param {{
 *   providerLawSections: Record<string, string[]>,
 *   providerOrder: string[],
 *   sharedLawSections: string[],
 * }} opts
 * @returns {{percent: number, reason: string}}
 */
export function computeSharedLawSectionsConfidence({
  providerLawSections,
  providerOrder,
  sharedLawSections,
}) {
  const order = Array.isArray(providerOrder) ? providerOrder : [];
  if (order.length < 3) {
    return {
      percent: 0,
      reason:
        "Three successful expert model outputs are required for three-model citation consistency scoring.",
    };
  }

  const bySections =
    providerLawSections && typeof providerLawSections === "object" ? providerLawSections : {};

  const providerSets = [];
  for (const providerKey of order) {
    const entries = Array.isArray(bySections[providerKey]) ? bySections[providerKey] : [];
    const keys = new Set(entries.map((entry) => lawSectionKey(entry)).filter(Boolean));
    if (keys.size === 0) {
      return {
        percent: 0,
        reason: `${providerKey} has no identifiable statutory/regulatory section citation for consistency scoring.`,
      };
    }
    providerSets.push(keys);
  }

  const unionKeys = new Set();
  for (const keys of providerSets) {
    for (const key of keys) unionKeys.add(key);
  }
  if (unionKeys.size === 0) {
    return {
      percent: 0,
      reason:
        "No identifiable statutory/regulatory section citation was found across successful expert outputs.",
    };
  }

  let sharedKeys = new Set(
    (Array.isArray(sharedLawSections) ? sharedLawSections : [])
      .map((section) => lawSectionKey(section))
      .filter(Boolean)
  );
  if (sharedKeys.size === 0) {
    sharedKeys = intersectAllSets(providerSets);
  }

  const intersectionRatio = sharedKeys.size / unionKeys.size;

  const pairwiseScores = [];
  for (let i = 0; i < providerSets.length; i++) {
    for (let j = i + 1; j < providerSets.length; j++) {
      const left = providerSets[i];
      const right = providerSets[j];
      const unionPair = new Set([...left, ...right]);
      if (unionPair.size === 0) continue;
      let overlapCount = 0;
      for (const key of left) if (right.has(key)) overlapCount++;
      pairwiseScores.push(overlapCount / unionPair.size);
    }
  }
  const pairwiseMean = pairwiseScores.length
    ? pairwiseScores.reduce((sum, score) => sum + score, 0) / pairwiseScores.length
    : intersectionRatio;

  // Weight shared-all overlap highest, with pairwise overlap as secondary signal.
  let confidence = pythonRound((0.75 * intersectionRatio + 0.25 * pairwiseMean) * 100);
  confidence = Math.max(0, Math.min(100, confidence));
  const reason =
    `Shared-all overlap: ${sharedKeys.size}/${unionKeys.size} unique sections; ` +
    `mean pairwise citation overlap: ${(pairwiseMean * 100).toFixed(1)}%.`;

  return { percent: confidence, reason };
}
