import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { VISA_FAMILIES, VISA_REGISTRY_API, VISA_REGISTRY_RAW } from "../case-api/static.js";

const sourcePath = fileURLToPath(
  new URL("../../immi_case_downloader/data/visa_registry.json", import.meta.url),
);
const source = JSON.parse(readFileSync(sourcePath, "utf8"));

const generatedPath = fileURLToPath(new URL("../case-api/visa_registry.generated.js", import.meta.url));
const generatedSource = readFileSync(generatedPath, "utf8");

describe("visa registry parity with the shared JSON source", () => {
  it("serves every entry from the JSON source in the same order", () => {
    expect(VISA_REGISTRY_API.entries).toEqual(source.entries);
    // The JSON source's _provenance key must never leak into the generated
    // Worker module or an API response.
    expect(/_provenance/.test(generatedSource)).toBe(false);
  });

  it("serves the same family descriptions as the JSON source", () => {
    expect(VISA_FAMILIES).toEqual(source.families);
    expect(VISA_REGISTRY_API.families).toEqual(source.families);
  });

  it("keys the raw lookup by exactly the subclasses in the source", () => {
    expect(Object.keys(VISA_REGISTRY_RAW).sort()).toEqual(
      source.entries.map((entry) => entry.subclass).sort(),
    );
  });

  it("buckets subclass 408 (Temporary Activity) as a Visitor visa", () => {
    // Regression: this table said "Skilled" while the Flask analytics said
    // "Visitor", so the two APIs disagreed on a visa-family grouping.
    expect(VISA_REGISTRY_RAW["408"]).toEqual(["Temporary Activity", "Visitor"]);
  });
});
