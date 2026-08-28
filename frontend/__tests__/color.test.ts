import { describe, it, expect } from "vitest";
import {
  hexToRgb,
  rgbToHex,
  getContrastRatio,
  getWcagLevel,
  getLuminance,
  generateTones,
  simulateColorBlindness,
} from "@/lib/color";

describe("getContrastRatio", () => {
  it("returns 21 for pure black on pure white", () => {
    expect(getContrastRatio("#000000", "#ffffff")).toBe(21);
  });

  it("returns 1 for identical colors", () => {
    expect(getContrastRatio("#ffffff", "#ffffff")).toBe(1);
  });

  it("is symmetric regardless of argument order", () => {
    const a = getContrastRatio("#1b2838", "#f5f4f1");
    const b = getContrastRatio("#f5f4f1", "#1b2838");
    expect(a).toBe(b);
  });

  it("matches the Legal Codex navy-on-off-white ratio", () => {
    expect(getContrastRatio("#1b2838", "#f5f4f1")).toBeCloseTo(13.5678, 3);
  });

  it("falls back to a finite number for non-hex input", () => {
    const ratio = getContrastRatio("rgba(0,0,0,0.5)", "#ffffff");
    expect(Number.isFinite(ratio)).toBe(true);
  });
});

describe("getWcagLevel", () => {
  it("returns AAA at and above the 7 boundary", () => {
    expect(getWcagLevel(21)).toBe("AAA");
    expect(getWcagLevel(7)).toBe("AAA");
  });

  it("returns AA just below 7 and at the 4.5 boundary", () => {
    expect(getWcagLevel(6.99)).toBe("AA");
    expect(getWcagLevel(4.5)).toBe("AA");
  });

  it("returns AA Large just below 4.5 and at the 3 boundary", () => {
    expect(getWcagLevel(4.49)).toBe("AA Large");
    expect(getWcagLevel(3)).toBe("AA Large");
  });

  it("returns Fail just below 3 and down to 1", () => {
    expect(getWcagLevel(2.99)).toBe("Fail");
    expect(getWcagLevel(1)).toBe("Fail");
  });
});

describe("generateTones", () => {
  it("returns 8 tones by default", () => {
    expect(generateTones("#1b2838")).toHaveLength(8);
  });

  it("returns valid hex strings for every tone", () => {
    const tones = generateTones("#1b2838");
    for (const tone of tones) {
      expect(tone).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("has strictly decreasing luminance across the scale", () => {
    const tones = generateTones("#1b2838");
    for (let i = 0; i < tones.length - 1; i++) {
      expect(getLuminance(tones[i])).toBeGreaterThan(
        getLuminance(tones[i + 1]),
      );
    }
  });

  it("respects a custom count", () => {
    expect(generateTones("#1b2838", 3)).toHaveLength(3);
  });

  it("falls back to count copies of the input for invalid input", () => {
    expect(generateTones("nope")).toEqual(Array(8).fill("nope"));
  });
});

describe("simulateColorBlindness", () => {
  it("produces a true grey for achromatopsia", () => {
    const result = simulateColorBlindness("#d4a017", "achromatopsia");
    expect(result).toBe("#a8a8a8");
    const rgb = hexToRgb(result);
    expect(rgb).not.toBeNull();
    const [r, g, b] = rgb!;
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it("produces the known value for deuteranopia", () => {
    expect(simulateColorBlindness("#d4a017", "deuteranopia")).toBe(
      "#d49d17",
    );
  });

  it("returns invalid input unchanged", () => {
    expect(simulateColorBlindness("nope", "achromatopsia")).toBe("nope");
  });
});

describe("hex round-tripping", () => {
  it("round-trips hexToRgb through rgbToHex", () => {
    const rgb = hexToRgb("#d4a017");
    expect(rgb).not.toBeNull();
    expect(rgbToHex(...rgb!)).toBe("#d4a017");
  });

  it("returns null for a hex string of the wrong length", () => {
    expect(hexToRgb("#12345")).toBeNull();
  });
});
