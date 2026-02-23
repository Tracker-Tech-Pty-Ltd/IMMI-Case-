import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("CSS tokens completeness", () => {
  const tokensCSS = fs.readFileSync(
    path.resolve(__dirname, "../src/tokens/tokens.css"),
    "utf-8",
  );
  const indexCSS = fs.readFileSync(
    path.resolve(__dirname, "../src/index.css"),
    "utf-8",
  );

  it("tokens.css defines --color-chart-2 through --color-chart-5", () => {
    for (let i = 2; i <= 5; i++) {
      expect(tokensCSS).toContain(`--color-chart-${i}:`);
    }
  });

  it("index.css @theme exposes --color-chart-2 through --color-chart-5", () => {
    for (let i = 2; i <= 5; i++) {
      expect(indexCSS).toContain(`--color-chart-${i}:`);
    }
  });

  it("tokens.css defines --color-background-surface-hover", () => {
    expect(tokensCSS).toContain("--color-background-surface-hover:");
  });

  it("index.css @theme exposes --color-surface-hover", () => {
    expect(indexCSS).toContain("--color-surface-hover:");
  });
});
