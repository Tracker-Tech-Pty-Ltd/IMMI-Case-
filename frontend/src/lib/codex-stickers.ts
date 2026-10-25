export const CODEX_STICKER_IDS = [
  "codex", "dashboard", "cases", "analytics", "judges", "news", "collections",
  "saved-searches", "taxonomy", "guided-search", "semantic-search", "council",
  "data-tools", "courts", "legislation", "dictionary", "document", "government",
  "tribunal", "court-update", "source-check", "calendar", "scope", "research",
  "search", "filter", "clear", "original", "summary", "empty",
] as const;

export type CodexStickerId = typeof CODEX_STICKER_IDS[number];

export const NAV_STICKERS: Readonly<Record<string, CodexStickerId>> = {
  "/": "dashboard", "/cases": "cases", "/analytics": "analytics",
  "/judge-profiles": "judges", "/news": "news", "/collections": "collections",
  "/saved-searches": "saved-searches", "/taxonomy": "taxonomy",
  "/guided-search": "guided-search", "/search/semantic": "semantic-search",
  "/llm-council": "council", "/data-tools": "data-tools", "/court-lineage": "courts",
  "/legislations": "legislation", "/data-dictionary": "dictionary",
};
