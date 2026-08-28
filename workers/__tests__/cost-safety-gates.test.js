import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// These are repo-configuration gates, not Worker unit tests. They live in the
// Worker suite because that suite runs in a `node` environment with filesystem
// access and is a blocking CI job — the same two properties that let
// route-manifest-coverage.test.js and visa-registry-parity.test.js assert on
// checked-in files from here.
//
// What they defend: every one of these invariants is a rule that costs real
// money or silently drops test coverage when it regresses, and each regressed
// once already (external review, 2026-08-28).

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readRepoFile(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

/**
 * Return the recipe lines of one Make target: everything from `<name>:` up to
 * the next line that starts in column 0 and is not a comment or blank.
 * Make recipes are TAB-indented, so "starts in column 0" is the terminator.
 */
function makeRecipe(makefile, target) {
  const lines = makefile.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^${target}:`).test(line));
  if (start === -1) return null;
  const recipe = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    if (!/^[\t ]/.test(line)) break;
    recipe.push(line);
  }
  return recipe.join("\n");
}

describe("make test-e2e cannot bill a live LLM by default", () => {
  const makefile = readRepoFile("Makefile");

  // tests/e2e/playwright/test_council_thread_visual.py:38 defaults
  // E2E_BASE_URL to https://immi.trackit.today and drives real council turns,
  // i.e. paid Cloudflare AI Gateway calls against the production database.
  // CI already excludes it (.github/workflows/ci.yml, e2e-nightly). The
  // documented local command must exclude it too, or a newcomer following
  // README/CLAUDE.md spends money on their first run.
  it("excludes the production-targeting playwright directory", () => {
    const recipe = makeRecipe(makefile, "test-e2e");
    expect(recipe).not.toBeNull();
    expect(recipe).toMatch(/--ignore=tests\/e2e\/playwright/);
  });

  it("keeps the pytest invocation and the ignore flag on the same command", () => {
    const recipe = makeRecipe(makefile, "test-e2e");
    const pytestLines = recipe
      .split("\n")
      .filter((line) => /-m pytest/.test(line) && /tests\/e2e/.test(line));
    expect(pytestLines).not.toHaveLength(0);
    for (const line of pytestLines) {
      expect(line).toMatch(/--ignore=tests\/e2e\/playwright/);
    }
  });

  it("offers a separate production target gated by a named opt-in variable", () => {
    const recipe = makeRecipe(makefile, "test-e2e-production");
    expect(recipe).not.toBeNull();
    // The gate must name the money it spends, and must be a value the runner
    // has to type — not a bare `if [ -n "$FLAG" ]` that any exported truthy
    // value satisfies.
    expect(recipe).toMatch(/E2E_ALLOW_PRODUCTION/);
    expect(recipe).toMatch(/i-understand-this-spends-money/);
    // and must refuse rather than fall through to a default URL
    expect(recipe).toMatch(/exit 1/);
  });

  it("requires an explicit E2E_BASE_URL rather than defaulting to production", () => {
    const recipe = makeRecipe(makefile, "test-e2e-production");
    expect(recipe).toMatch(/E2E_BASE_URL/);
  });

  it("declares both e2e targets as phony", () => {
    expect(makefile).toMatch(/^\.PHONY:.*\btest-e2e-production\b/m);
  });
});

describe("the vitest collection guard runs in CI, not only locally", () => {
  const ci = readRepoFile(".github/workflows/ci.yml");
  const makefile = readRepoFile("Makefile");

  // A narrowed include glob makes `vitest run` report success over a smaller
  // file set: the suite is green, the count drops, and nothing errors. Verified
  // on 2026-08-28 by narrowing workers/vitest.config.js to
  // `__tests__/cloudflare-*.test.js` — the Worker suite reported "16 files, 143
  // tests passed" while 32 files and 416 tests went uncollected, and CI as it
  // then stood would have merged it. Only check-vitest-collection notices.
  it("invokes make check-vitest-collection somewhere in the workflow", () => {
    expect(ci).toMatch(/make check-vitest-collection/);
  });

  it("installs all three node_modules trees the guard needs", () => {
    // The guard shells out to `vitest list` in frontend/, workers/ (root deps)
    // and workers/austlii-scraper/. A job missing any one of them makes that
    // config contribute nothing, and the guard then reports its files as
    // MISSING — a false failure — or, worse, is quietly skipped.
    const jobs = ci.split(/\n  (?=[a-z0-9-]+:\n)/);
    const guardJob = jobs.find((job) => /make check-vitest-collection/.test(job));
    expect(guardJob).toBeDefined();
    expect(guardJob).toMatch(/working-directory: frontend/);
    expect(guardJob).toMatch(/working-directory: workers\/austlii-scraper/);
    // the root install has no working-directory
    expect(guardJob).toMatch(/run: npm ci\n/);
  });

  it("keeps the guard a blocking gate rather than a scheduled-only job", () => {
    const jobs = ci.split(/\n  (?=[a-z0-9-]+:\n)/);
    const guardJob = jobs.find((job) => /make check-vitest-collection/.test(job));
    // `if: github.event_name == 'schedule' ...` is how e2e-nightly opts out of
    // PRs. The collection guard must not acquire one.
    expect(guardJob).not.toMatch(/if:\s*github\.event_name/);
    expect(guardJob).not.toMatch(/continue-on-error:\s*true/);
  });

  it("still defines the target it calls", () => {
    expect(makeRecipe(makefile, "check-vitest-collection")).not.toBeNull();
  });
});

describe("the coverage ratchet cannot be walked backwards", () => {
  const ci = readRepoFile(".github/workflows/ci.yml");
  const vitestConfig = readRepoFile("frontend/vitest.config.ts");

  function thresholds() {
    const block = vitestConfig.match(/thresholds\s*:\s*\{[\s\S]*?\n {6}\}/);
    expect(block).not.toBeNull();
    const read = (metric) => {
      const match = block[0].match(new RegExp(`\\b${metric}\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
      expect(match, `threshold ${metric} must be a plain number`).not.toBeNull();
      return Number(match[1]);
    };
    return {
      lines: read("lines"),
      functions: read("functions"),
      branches: read("branches"),
      statements: read("statements"),
    };
  }

  // The floors were 29/24/30/28 while the suite actually measured
  // 40.23/38.82/32.50/41.17 — twelve points of free headroom, enough to delete a
  // third of the frontend tests and stay green. These assertions pin the floors
  // above the stale values so a revert to them is a test failure, not a silent
  // regression.
  it("keeps the floors at the measured level, not a point below it", () => {
    const current = thresholds();
    expect(current.lines).toBeGreaterThanOrEqual(41);
    expect(current.statements).toBeGreaterThanOrEqual(40);
    expect(current.branches).toBeGreaterThanOrEqual(38.8);
    expect(current.functions).toBeGreaterThanOrEqual(32.5);
  });

  // Hand-maintained floors are what went stale. autoUpdate makes the raise
  // automatic, so the gap cannot silently reopen.
  it("raises the floors automatically when coverage improves", () => {
    expect(vitestConfig).toMatch(/autoUpdate\s*:/);
  });

  it("runs the no-lowering check in CI, before the coverage suite", () => {
    expect(ci).toMatch(/check_coverage_ratchet\.mjs/);
    const ratchetAt = ci.indexOf("check_coverage_ratchet.mjs");
    const coverageAt = ci.indexOf("npx vitest run --coverage");
    expect(ratchetAt).toBeGreaterThan(-1);
    expect(coverageAt).toBeGreaterThan(-1);
    expect(ratchetAt).toBeLessThan(coverageAt);
  });

  it("fetches enough history for the comparison to be possible", () => {
    // With the default shallow checkout there is no HEAD~1 to compare against,
    // and the step would skip rather than gate.
    expect(ci).toMatch(/fetch-depth:\s*0/);
  });

  it("does not interpolate a branch name straight into the shell", () => {
    // github.base_ref is attacker-influencable text.
    expect(ci).not.toMatch(/git fetch[^\n]*\$\{\{\s*github\.base_ref/);
  });
});
