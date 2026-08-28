/**
 * a11y-lint-baseline.test.ts
 *
 * The jsx-a11y overrides in eslint.config.js pin known violations to `warn`.
 * ESLint cannot tell you when one of those overrides is (a) hiding a NEW
 * violation of the same rule in the same file, or (b) no longer needed because
 * someone fixed the violation. This test does both, by asserting the exact set
 * of "<relative path>\t<rule id>" pairs.
 *
 * When you FIX a violation: run this test, read the "no longer failing" list,
 * delete those entries from BOTH this array and eslint.config.js.
 * When you ADD one: don't. Fix it.
 *
 * Runtime: this lints the whole frontend tree (~15-30s). That is why it is a
 * single test in its own file.
 */
import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import * as path from "path";

// Measured with the command in Step 2 of plans/024. One entry per
// (file, rule) violation. Sorted. Duplicates are meaningful: two entries for
// the same pair mean the rule fires twice in that file.
const BASELINE: readonly string[] = [
  "src/components/collections/SortableCaseItem.tsx\tjsx-a11y/no-autofocus",
  "src/components/judges/JudgeCard.tsx\tjsx-a11y/no-noninteractive-element-interactions",
  "src/components/judges/JudgeLeaderboard.tsx\tjsx-a11y/no-noninteractive-tabindex",
  "src/components/judges/JudgeLeaderboard.tsx\tjsx-a11y/no-static-element-interactions",
  "src/components/llm-council/StreamingCouncilView.tsx\tjsx-a11y/heading-has-content",
  "src/components/llm-council/StreamingCouncilView.tsx\tjsx-a11y/heading-has-content",
  "src/components/llm-council/StreamingCouncilView.tsx\tjsx-a11y/heading-has-content",
  "src/components/llm-council/StreamingCouncilView.tsx\tjsx-a11y/heading-has-content",
  "src/components/llm-council/TurnCard.tsx\tjsx-a11y/anchor-has-content",
  "src/components/llm-council/TurnCard.tsx\tjsx-a11y/heading-has-content",
  "src/components/llm-council/TurnCard.tsx\tjsx-a11y/heading-has-content",
  "src/components/llm-council/TurnCard.tsx\tjsx-a11y/heading-has-content",
  "src/components/llm-council/TurnCard.tsx\tjsx-a11y/heading-has-content",
  "src/pages/DataToolsPage.tsx\tjsx-a11y/no-redundant-roles",
  "src/pages/DataToolsPage.tsx\tjsx-a11y/no-redundant-roles",
  "src/pages/DataToolsPage.tsx\tjsx-a11y/no-redundant-roles",
  "src/pages/DataToolsPage.tsx\tjsx-a11y/no-redundant-roles",
  "src/pages/DataToolsPage.tsx\tjsx-a11y/no-redundant-roles",
  "src/pages/DesignTokensPage.tsx\tjsx-a11y/role-supports-aria-props",
];

describe("jsx-a11y lint baseline", () => {
  it(
    "the set of jsx-a11y violations is exactly the recorded baseline",
    async () => {
      const cwd = path.resolve(__dirname, "..");
      const eslint = new ESLint({ cwd });
      const results = await eslint.lintFiles(["."]);
      const actual = results
        .flatMap((r) =>
          r.messages
            .filter((m) => m.ruleId?.startsWith("jsx-a11y/"))
            .map((m) => `${path.relative(cwd, r.filePath)}\t${m.ruleId}`),
        )
        .toSorted();

      const expected = [...BASELINE].toSorted();

      const added = actual.filter(
        (x, i) => expected.indexOf(x) === -1 || actual.indexOf(x) !== i && expected.filter((e) => e === x).length < actual.filter((a) => a === x).length,
      );
      const removed = expected.filter((x) => !actual.includes(x));

      expect(
        actual,
        [
          added.length ? `NEW jsx-a11y violations (fix them):\n  ${added.join("\n  ")}` : "",
          removed.length ? `STALE baseline entries (delete them from BASELINE and from eslint.config.js):\n  ${removed.join("\n  ")}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      ).toEqual(expected);
    },
    60_000, // linting the whole tree is slow; default 5s timeout is not enough
  );
});
