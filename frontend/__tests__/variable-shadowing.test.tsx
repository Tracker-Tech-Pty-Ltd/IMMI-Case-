/// <reference types="node" />
import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";

const ROOT = path.resolve(__dirname, "..");

describe("Variable shadowing prevention", () => {
  it("CasesPage does not shadow t in tags map callback", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "src/pages/CasesPage.tsx"),
      "utf-8"
    );
    const shadowPattern = /\.map\(\(t\)\s*=>/g;
    const matches = source.match(shadowPattern);
    expect(matches).toBeNull();
  });

  it("LineageExplainer does not shadow t in transitions map callback", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "src/components/lineage/LineageExplainer.tsx"),
      "utf-8"
    );
    const shadowPattern = /\.map\(\(t\)\s*=>/g;
    const matches = source.match(shadowPattern);
    expect(matches).toBeNull();
  });
});
