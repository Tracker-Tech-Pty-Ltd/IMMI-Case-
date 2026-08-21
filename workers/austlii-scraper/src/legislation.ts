/** Native AustLII legislation importer.
 *
 * The result is an immutable JSON object in the shared native R2 bucket. It
 * deliberately has no PostgreSQL, filesystem or Supabase dependency.
 */

import type { Env } from "./types";

const BASE = "https://www.austlii.edu.au/au/legis/cth";
const USER_AGENT = "IMMI-Case-native-legislation/1.0 (+https://immi.trackit.today)";
const KNOWN_LAWS: Record<string, Record<string, string>> = {
  "migration-act-1958": { austlii_id: "consol_act/ma1958118", title: "Migration Act 1958", shortcode: "MA1958", type: "Act" },
  "migration-regulations-1994": { austlii_id: "consol_reg/mr1994227", title: "Migration Regulations 1994", shortcode: "MR1994", type: "Regulation" },
  "australian-citizenship-act-2007": { austlii_id: "consol_act/aca2007254", title: "Australian Citizenship Act 2007", shortcode: "ACA2007", type: "Act" },
  "australian-border-force-act-2015": { austlii_id: "consol_act/abfa2015225", title: "Australian Border Force Act 2015", shortcode: "ABFA2015", type: "Act" },
  "administrative-review-tribunal-act-2024": { austlii_id: "consol_act/arta2024336", title: "Administrative Review Tribunal Act 2024", shortcode: "ARTA2024", type: "Act" },
};

function decodeHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
  if (!response.ok) throw new Error(`AustLII returned HTTP ${response.status}`);
  return response.text();
}

function parseSectionLinks(html: string, baseUrl: string): Array<{ id: string; number: string; title: string; url: string }> {
  const links: Array<{ id: string; number: string; title: string; url: string }> = [];
  const seen = new Set<string>();
  const pattern = /<a\b[^>]*href=["']([^"']*s\d[\d.a-zA-Z]*\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const href = match[1];
    const id = href.replace(/\.html$/i, "").split("/").pop()?.toLowerCase() || "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const linkText = decodeHtml(match[2]);
    const numberMatch = linkText.match(/^(\d+[A-Za-z]?(?:\.\d+[A-Za-z]?)?)\s*(.*)$/);
    links.push({
      id,
      number: numberMatch?.[1] || id.slice(1),
      title: numberMatch?.[2]?.trim() || "",
      url: new URL(href, baseUrl).toString(),
    });
  }
  return links;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function scrapeLegislation(env: Env, lawId: string): Promise<void> {
  const meta = KNOWN_LAWS[lawId];
  if (!meta) throw new Error(`Unknown law_id: ${lawId}`);
  const tocUrl = `${BASE}/${meta.austlii_id}/`;
  const links = parseSectionLinks(await fetchHtml(tocUrl), tocUrl);
  if (!links.length) throw new Error("legislation TOC contained no sections");
  const sections: Array<{ id: string; number: string; title: string; text: string }> = [];
  const failures: string[] = [];
  for (const link of links) {
    try {
      sections.push({ ...link, text: decodeHtml(await fetchHtml(link.url)) });
    } catch (error) {
      failures.push(`${link.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length) throw new Error(`legislation sections failed: ${failures.slice(0, 10).join("; ")}`);
  const payload = JSON.stringify({
    id: lawId,
    ...meta,
    sections_count: sections.length,
    last_amended: "",
    last_scraped: new Date().toISOString(),
    sections: sections.map(({ id, number, title, text }) => ({ id, number, title, text })),
  });
  const digest = await sha256(payload);
  const key = `legislations/${lawId}.json`;
  const bytes = new TextEncoder().encode(payload);
  await env.CASE_RESULTS.put(key, bytes, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { sha256: digest, bytes: String(bytes.byteLength) },
  });
  const head = await env.CASE_RESULTS.head(key);
  if (!head || head.size !== bytes.byteLength || head.customMetadata?.sha256 !== digest) {
    throw new Error("legislation R2 checksum verification failed");
  }
}

export function knownLegislationIds(): string[] {
  return Object.keys(KNOWN_LAWS);
}
