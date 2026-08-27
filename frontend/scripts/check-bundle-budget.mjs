#!/usr/bin/env node
/**
 * Post-build guard for the eager critical path.
 *
 * Run AFTER `npm run build:cloudflare`:
 *     node scripts/check-bundle-budget.mjs            # checks frontend/dist
 *     node scripts/check-bundle-budget.mjs <dir>      # checks another outDir
 *
 * Exits non-zero (and prints why) when any of these regress:
 *   1. index.html modulepreloads or references a charts-* chunk.
 *   2. The entry chunk statically imports a charts-* chunk.
 *   3. The entry chunk contains CJK (a locale catalogue got inlined again).
 *   4. index.html has no Google Fonts <link> (the CSS @import came back).
 *   5. The eager JS set exceeds the byte budget below.
 *
 * The budget is deliberately generous — it catches a 100 KB class of mistake,
 * not a 2 KB one — and MUST be re-derived, with a comment saying why, if the
 * app legitimately grows. Do not raise it to make a red build green.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const outDir = resolve(process.argv[2] ?? "dist");
const assetsDir = join(outDir, "assets");
const html = readFileSync(join(outDir, "index.html"), "utf8");
const assets = readdirSync(assetsDir);

const failures = [];
const fail = (msg) => failures.push(msg);

// 1 + 4 — HTML-level checks
if (/charts-[A-Za-z0-9_-]+\.js/.test(html)) {
  fail("index.html references a charts-* chunk: the entry is eager-loading Recharts + d3 again. See plan 019 Step 2 (manualChunks).");
}
if (!/fonts\.googleapis\.com\/css2/.test(html)) {
  fail("index.html has no Google Fonts <link>: the render-blocking @import in src/index.css is probably back. See plan 019 Step 3.");
}

// 2 + 3 — entry-chunk checks
const entry = assets.find((f) => /^index-[A-Za-z0-9_-]+\.js$/.test(f));
if (!entry) {
  fail(`no index-*.js entry chunk found in ${assetsDir}`);
} else {
  const src = readFileSync(join(assetsDir, entry), "utf8");
  if (/from"\.\/charts-[A-Za-z0-9_-]+\.js"/.test(src)) {
    fail(`${entry} statically imports a charts-* chunk.`);
  }
  if (/[一-鿿]/.test(src)) {
    fail(`${entry} contains CJK: a locale catalogue was bundled into the entry. Add it to LAZY_CATALOGUES in src/i18n/index.ts.`);
  }
}

// 5 — eager byte budget: every JS chunk index.html modulepreloads, plus entry.
const EAGER_JS_BUDGET_BYTES = 620_000; // ~1.5x the post-plan-019 eager set
const eager = new Set(
  [...html.matchAll(/assets\/([A-Za-z0-9_-]+\.js)/g)].map((m) => m[1]),
);
let eagerBytes = 0;
for (const name of eager) {
  try {
    eagerBytes += statSync(join(assetsDir, name)).size;
  } catch {
    fail(`index.html references assets/${name}, which does not exist`);
  }
}
if (eagerBytes > EAGER_JS_BUDGET_BYTES) {
  fail(`eager JS is ${eagerBytes} B, over the ${EAGER_JS_BUDGET_BYTES} B budget (chunks: ${[...eager].join(", ")}).`);
}

if (failures.length > 0) {
  console.error("bundle-budget: FAIL");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(`bundle-budget: OK (eager JS ${eagerBytes} B across ${eager.size} chunks)`);
