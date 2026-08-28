#!/usr/bin/env node
/**
 * Fail if a coverage floor was lowered.
 *
 * A coverage threshold only means something if it cannot be edited down in the
 * same change that breaks it. Vitest enforces "coverage >= threshold"; nothing
 * enforced "threshold >= the threshold we already had", so the gate was one line
 * of self-service away from being disabled — and the reviewer would have had to
 * notice a two-character diff to catch it.
 *
 * Usage:
 *   node scripts/check_coverage_ratchet.mjs <baseline-config> <current-config>
 *
 * Exit codes:
 *   0  every floor held or rose
 *   1  at least one floor was lowered
 *   2  a config could not be parsed (treated as failure — an unparseable
 *      config must never read as "nothing to compare, carry on")
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const METRICS = ["lines", "functions", "branches", "statements"];

/**
 * Pull the four numbers out of the `thresholds: { ... }` block.
 *
 * Deliberately scoped to that block rather than searching the whole file: the
 * coverage config also contains `include`/`exclude` arrays and, in future, may
 * contain per-file thresholds. Matching `lines:` anywhere in the file would be
 * easy to fool.
 */
export function parseThresholds(source, label) {
  const block = source.match(/thresholds\s*:\s*\{/);
  if (!block) {
    throw new Error(`${label}: no coverage \`thresholds\` block found`);
  }
  // Walk braces from the opening one so nested objects/functions are included.
  const start = block.index + block[0].length - 1;
  let depth = 0;
  let end = -1;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error(`${label}: unterminated \`thresholds\` block`);
  const body = source.slice(start, end + 1);

  const found = {};
  for (const metric of METRICS) {
    const match = body.match(new RegExp(`\\b${metric}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`));
    if (!match) {
      throw new Error(`${label}: coverage threshold \`${metric}\` is missing or not a plain number`);
    }
    found[metric] = Number(match[1]);
  }
  return found;
}

function main(argv) {
  const [baselinePath, currentPath] = argv;
  if (!baselinePath || !currentPath) {
    console.error("usage: check_coverage_ratchet.mjs <baseline-config> <current-config>");
    return 2;
  }

  let baseline;
  let current;
  try {
    baseline = parseThresholds(readFileSync(baselinePath, "utf8"), "baseline");
    current = parseThresholds(readFileSync(currentPath, "utf8"), "current");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    return 2;
  }

  const lowered = METRICS
    .filter((metric) => current[metric] < baseline[metric])
    .map((metric) => `  ${metric}: ${baseline[metric]} -> ${current[metric]}`);

  if (lowered.length > 0) {
    console.error("ERROR: a coverage floor was lowered. Raise coverage instead of the bar:");
    console.error(lowered.join("\n"));
    console.error("");
    console.error("If the drop is genuinely intended (a large module was deleted, say),");
    console.error("say so explicitly in the commit message so it is reviewed as a decision.");
    return 1;
  }

  const raised = METRICS.filter((metric) => current[metric] > baseline[metric]);
  console.log(
    raised.length > 0
      ? `OK: coverage floors held; raised ${raised.join(", ")}`
      : "OK: coverage floors held",
  );
  return 0;
}

// Only run when invoked directly, so the parser can be unit-tested by importing.
//
// pathToFileURL, NOT `file://${process.argv[1]}`: this repository lives under
// "/Users/d/Developer/Active Projects/", and import.meta.url percent-encodes the
// space while process.argv[1] does not. The naive comparison is therefore always
// false here, and the script exits 0 having checked nothing — a gate that passes
// because it never ran is worse than no gate at all.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}

export { main };
