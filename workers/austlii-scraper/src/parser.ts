/**
 * HTML parser for AustLII case pages.
 *
 * Uses indexOf/substring instead of HTMLRewriter because we need the complete
 * text content of a subtree, which HTMLRewriter's streaming model can't provide.
 *
 * Metadata extraction regex patterns are ported from:
 *   immi_case_downloader/sources/austlii.py:_extract_metadata()
 */

export interface ParsedCase {
  full_text: string;
  judges: string;
  date: string;
  catchwords: string;
  outcome: string;
  visa_type: string;
  legislation: string;
  citation_extracted: string;
}

/**
 * Extract the main case text from AustLII HTML.
 *
 * 3-layer fallback:
 *   1. <div id="cases_doc"> (most AustLII pages)
 *   2. <div class="document"> (some older pages)
 *   3. <body> with nav/header/footer/script/style stripped
 */
export function extractFullText(html: string): string {
  // Strategy 1: Find <div id="page-main"> (current AustLII layout)
  let text = extractDivById(html, "page-main");
  if (text && text.length > 100) return text;

  // Strategy 2: Find <div id="cases_doc"> (older AustLII layout)
  text = extractDivById(html, "cases_doc");
  if (text && text.length > 100) return text;

  // Strategy 3: Find <div class="document">
  text = extractDivByClass(html, "document");
  if (text && text.length > 100) return text;

  // Strategy 4: Fallback to <body>
  text = extractBody(html);
  return text || "";
}

/**
 * Extract text from a div with a specific id attribute.
 */
function extractDivById(html: string, id: string): string | null {
  // Match patterns: id="cases_doc", id='cases_doc', id=cases_doc
  const patterns = [
    `id="${id}"`,
    `id='${id}'`,
    `id=${id}`,
  ];

  for (const pattern of patterns) {
    const idx = html.indexOf(pattern);
    if (idx === -1) continue;

    // Find the opening < before this attribute
    const tagStart = html.lastIndexOf("<", idx);
    if (tagStart === -1) continue;

    // Find the end of the opening tag
    const tagEnd = html.indexOf(">", idx);
    if (tagEnd === -1) continue;

    // Extract content from after opening tag to matching closing div
    const contentStart = tagEnd + 1;
    const closingIdx = findClosingDiv(html, contentStart);
    if (closingIdx === -1) continue;

    const innerHtml = html.substring(contentStart, closingIdx);
    return stripHtmlTags(innerHtml);
  }

  return null;
}

/**
 * Extract text from a div with a specific class.
 */
function extractDivByClass(html: string, className: string): string | null {
  const patterns = [
    `class="${className}"`,
    `class='${className}'`,
    `class="${className} `,
    `class='${className} `,
  ];

  for (const pattern of patterns) {
    const idx = html.indexOf(pattern);
    if (idx === -1) continue;

    const tagStart = html.lastIndexOf("<", idx);
    if (tagStart === -1) continue;

    // Verify it's a div
    const tagName = html.substring(tagStart + 1, tagStart + 5).toLowerCase();
    if (!tagName.startsWith("div")) continue;

    const tagEnd = html.indexOf(">", idx);
    if (tagEnd === -1) continue;

    const contentStart = tagEnd + 1;
    const closingIdx = findClosingDiv(html, contentStart);
    if (closingIdx === -1) continue;

    const innerHtml = html.substring(contentStart, closingIdx);
    return stripHtmlTags(innerHtml);
  }

  return null;
}

/**
 * Extract text from <body>, stripping nav/header/footer/script/style elements.
 */
function extractBody(html: string): string | null {
  const bodyStart = html.indexOf("<body");
  if (bodyStart === -1) return null;

  const bodyTagEnd = html.indexOf(">", bodyStart);
  if (bodyTagEnd === -1) return null;

  const bodyClose = html.lastIndexOf("</body");
  const bodyContent = bodyClose > bodyTagEnd
    ? html.substring(bodyTagEnd + 1, bodyClose)
    : html.substring(bodyTagEnd + 1);

  // Remove unwanted elements
  let cleaned = bodyContent;
  const tagsToRemove = ["nav", "header", "footer", "script", "style", "noscript"];
  for (const tag of tagsToRemove) {
    cleaned = removeElements(cleaned, tag);
  }

  return stripHtmlTags(cleaned);
}

/**
 * Find the closing </div> that matches the nesting level starting at startIdx.
 */
function findClosingDiv(html: string, startIdx: number): number {
  let depth = 1;
  let pos = startIdx;
  const len = html.length;

  while (pos < len && depth > 0) {
    const nextOpen = html.indexOf("<div", pos);
    const nextClose = html.indexOf("</div", pos);

    if (nextClose === -1) return -1; // No closing tag found

    if (nextOpen !== -1 && nextOpen < nextClose) {
      // Check if it's a self-closing div or a real opening tag
      const closeAngle = html.indexOf(">", nextOpen);
      if (closeAngle !== -1 && html[closeAngle - 1] !== "/") {
        depth++;
      }
      pos = closeAngle !== -1 ? closeAngle + 1 : nextOpen + 4;
    } else {
      depth--;
      if (depth === 0) return nextClose;
      pos = nextClose + 6;
    }
  }

  return -1;
}

/**
 * Remove all instances of a specific HTML element (including content).
 */
function removeElements(html: string, tagName: string): string {
  const openPattern = new RegExp(`<${tagName}[\\s>]`, "gi");
  let result = html;
  let match: RegExpExecArray | null;

  // Process from end to start to preserve indices
  const removals: [number, number][] = [];
  while ((match = openPattern.exec(result)) !== null) {
    const start = match.index;
    const closeTag = `</${tagName}>`;
    const closeIdx = result.indexOf(closeTag, start);
    if (closeIdx !== -1) {
      removals.push([start, closeIdx + closeTag.length]);
    }
  }

  // Remove in reverse order
  for (let i = removals.length - 1; i >= 0; i--) {
    const [s, e] = removals[i];
    result = result.substring(0, s) + result.substring(e);
  }

  return result;
}

/**
 * Strip HTML tags and decode common entities. Produces newline-separated text.
 */
function stripHtmlTags(html: string): string {
  // Replace block-level tags with newlines
  let text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|pre|section|article)>/gi, "\n")
    .replace(/<(?:p|div|h[1-6]|li|tr|blockquote|pre|section|article)[\s>][^>]*>/gi, "\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

  // Clean up whitespace
  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line, i, arr) => {
      // Remove consecutive empty lines (keep at most 1)
      if (line === "" && i > 0 && arr[i - 1] === "") return false;
      return true;
    })
    .join("\n")
    .trim();

  return text;
}

/**
 * Extract metadata from the full page text using regex patterns.
 *
 * This is a port of the Python `MetadataExtractor` in
 * immi_case_downloader/sources/metadata_extractor.py, and must produce
 * identical output for identical input. The shared golden corpus in
 * tests/fixtures/extractor_parity/ pins both implementations; see
 * ./__tests__/extractor-parity.test.ts and tests/test_extractor_parity.py.
 */
export function extractMetadata(text: string): Omit<ParsedCase, "full_text"> {
  const result = {
    judges: "",
    date: "",
    catchwords: "",
    outcome: "",
    visa_type: "",
    legislation: "",
    citation_extracted: "",
  };

  // --- Judges/Members ---
  const judgePatterns = [
    // Mirrors metadata_extractor.py `_JUDGE_PATTERNS`: anchored to a line
    // start (Python re.MULTILINE), includes BEFORE, and deliberately has no
    // bare MEMBER alternative — an unanchored /MEMBER/ matched prose such as
    // "The presiding MEMBER: Jane Doe made the decision." and an unanchored
    // /JUSTICE/ turned "BEFORE: Justice A Nguyen" into "A Nguyen".
    /^(?:BEFORE|JUDGE|JUSTICE|TRIBUNAL MEMBER)[:\s]+([^\n]+)/im,
    /(?:Before|Coram)[:\s]+([^\n]+)/i,
  ];
  for (const pattern of judgePatterns) {
    const match = text.match(pattern);
    if (match) {
      result.judges = match[1].trim();
      break;
    }
  }

  // --- Date ---
  const datePatterns = [
    /(?:Date of (?:decision|hearing|judgment|order))[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i,
    /(?:Decision date|Judgment date|Date)[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i,
    /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i,
  ];
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      result.date = match[1].trim();
      break;
    }
  }

  // --- Catchwords ---
  const catchwordsMatch = text.match(
    /CATCHWORDS[:\s]*\n?(.*?)(?=\n\s*\n|\nLEGISLATION|\nCASES|\nORDER)/is
  );
  if (catchwordsMatch) {
    result.catchwords = catchwordsMatch[1].trim().substring(0, 500);
  }

  // --- Citation ---
  const citationMatch = text.match(
    /\[\d{4}\]\s+(?:AATA|ARTA|FCA|FCCA|FMCA|HCA|FedCFamC2G|RRTA|MRTA)\s+\d+/
  );
  if (citationMatch) {
    result.citation_extracted = citationMatch[0];
  }

  // --- Outcome ---
  const outcomePatterns = [
    /(?:DECISION|ORDER|ORDERS|THE COURT ORDERS)[:\s]*\n?(.*?)(?:\n\s*\n)/is,
    /(?:The Tribunal|The Court)\s+(affirms|remits|sets aside|dismisses|allows|refuses|grants)[^\n]*/i,
  ];
  for (const pattern of outcomePatterns) {
    const match = text.match(pattern);
    if (match) {
      result.outcome = match[0].trim().substring(0, 300);
      break;
    }
  }

  // --- Visa type ---
  const visaMatch = text.match(
    /((?:protection|skilled|partner|student|visitor|bridging|temporary|permanent|subclass\s+\d+)\s*visa)/i
  );
  if (visaMatch) {
    result.visa_type = visaMatch[1].trim();
  }

  // --- Legislation ---
  const legRefs: string[] = [];
  const legPatterns = [
    /Migration Act 1958[^.]*/gi,
    /Migration Regulations 1994[^.]*/gi,
  ];
  for (const pattern of legPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      legRefs.push(...matches.slice(0, 2));
    }
  }
  if (legRefs.length > 0) {
    result.legislation = legRefs.join("; ").substring(0, 300);
  }

  return result;
}
