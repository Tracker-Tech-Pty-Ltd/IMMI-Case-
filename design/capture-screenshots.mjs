// Captures all public IMMI-Case- routes as PNGs into design/screenshots/.
// Run with: node design/capture-screenshots.mjs
//
// Pre-req: playwright is in frontend/ deps (used for E2E tests).
// Routes that require an :id or auth are skipped — those need
// per-route fixtures and are tackled in a follow-up turn.

// ESM resolves relative to file location; playwright lives in frontend/node_modules.
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import fs from "node:fs/promises";
import path from "node:path";

const BASE = process.env.BASE_URL || "https://immi.trackit.today";
const OUT = path.resolve("design/screenshots");
await fs.mkdir(OUT, { recursive: true });

// Each entry maps a Pencil frame name (matches a placeholder we created) to
// a route path. Detail pages with :id or :slug are skipped here — capture
// them in a follow-up after we wire up auth + a known-good fixture id.
const ROUTES = [
  ["DashboardPage", "/"],
  ["CasesPage", "/cases"],
  ["CaseAddPage", "/cases/add"],
  ["CaseComparePage", "/cases/compare"],
  ["AnalyticsPage", "/analytics"],
  ["JudgeProfilesPage", "/judge-profiles"],
  ["JudgeComparePage", "/judge-profiles/compare"],
  ["LegislationsPage", "/legislations"],
  ["CourtLineagePage", "/court-lineage"],
  ["DownloadPage", "/download"],
  ["PipelinePage", "/pipeline"],
  ["CollectionsPage", "/collections"],
  ["GuidedSearchPage", "/guided-search"],
  ["SemanticSearchPage", "/search/semantic"],
  ["SavedSearchesPage", "/saved-searches"],
  ["LlmCouncilPage", "/llm-council"],
  ["LlmCouncilSessionsPage", "/llm-council/sessions"],
  ["DataDictionaryPage", "/data-dictionary"],
  ["TaxonomyPage", "/taxonomy"],
  ["SearchTaxonomyPage", "/search-taxonomy"],
  ["DesignTokensPage", "/design-tokens"],
  ["JobStatusPage", "/jobs"],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

let ok = 0, fail = 0;
for (const [name, route] of ROUTES) {
  const url = `${BASE}${route}`;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    // Settle Recharts entrance + framer-motion mount animations
    await page.waitForTimeout(1500);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`✓ ${name.padEnd(28)} ${url}`);
    ok++;
  } catch (e) {
    console.error(`✗ ${name.padEnd(28)} ${e.message}`);
    fail++;
  }
}

await browser.close();
console.log(`\n${ok}/${ROUTES.length} captured · ${fail} failed`);
console.log(`Output: ${OUT}`);
