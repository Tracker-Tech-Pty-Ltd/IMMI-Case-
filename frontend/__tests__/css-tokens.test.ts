import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── File paths ─────────────────────────────────────────────────────────
const TOKENS_JSON_PATH = path.resolve(__dirname, "../src/tokens/tokens.json");
const TOKENS_CSS_PATH = path.resolve(__dirname, "../src/tokens/tokens.css");
const TOKENS_TS_PATH = path.resolve(__dirname, "../src/tokens/tokens.ts");
const INDEX_CSS_PATH = path.resolve(__dirname, "../src/index.css");

// ── Helpers ────────────────────────────────────────────────────────────

function getLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return 0.5; // fallback for non-hex (rgba etc)
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Walk all leaf values of a nested object, skipping a named top-level key. */
function collectLeafValues(
  obj: Record<string, unknown>,
  skipKey?: string,
): string[] {
  const results: string[] = [];
  function walk(node: unknown) {
    if (typeof node === "string") {
      results.push(node);
    } else if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (k === skipKey) continue;
        walk(v);
      }
    }
  }
  walk(obj);
  return results;
}

const HEX_OR_RGBA_RE = /^#[0-9a-fA-F]{6}$|^rgba?\(/;

// ── Pre-read files once ────────────────────────────────────────────────
const tokensJSON = JSON.parse(fs.readFileSync(TOKENS_JSON_PATH, "utf-8"));
const tokensCSS = fs.readFileSync(TOKENS_CSS_PATH, "utf-8");
const tokensTS = fs.readFileSync(TOKENS_TS_PATH, "utf-8");
const indexCSS = fs.readFileSync(INDEX_CSS_PATH, "utf-8");

// ══════════════════════════════════════════════════════════════════════
// Group 1: tokens.json structure validation
// ══════════════════════════════════════════════════════════════════════
describe("Group 1 – tokens.json structure validation", () => {
  it("tokens.json exists and is valid JSON", () => {
    expect(fs.existsSync(TOKENS_JSON_PATH)).toBe(true);
    // If JSON.parse threw above, we would not reach this line
    expect(tokensJSON).toBeDefined();
    expect(typeof tokensJSON).toBe("object");
  });

  it("tokens.json has all required top-level categories", () => {
    const required = [
      "color",
      "typography",
      "spacing",
      "radius",
      "shadow",
      "opacity",
      "zIndex",
      "animation",
    ];
    for (const key of required) {
      expect(tokensJSON, `Missing top-level key: "${key}"`).toHaveProperty(key);
    }
  });

  it("color.dark has the same structural keys as light-mode color (excluding 'dark' and 'court')", () => {
    // Light mode has: primary, accent, background, chart, border, text, semantic, court, dark
    // Dark mode mirror (color.dark) is expected to have: primary, accent, background, chart, border, text, semantic
    const expectedDarkKeys = ["primary", "accent", "background", "chart", "border", "text", "semantic"];
    const darkKeys = Object.keys(tokensJSON.color.dark);
    for (const key of expectedDarkKeys) {
      expect(darkKeys, `color.dark is missing key: "${key}"`).toContain(key);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Group 2: Color format validation
// ══════════════════════════════════════════════════════════════════════
describe("Group 2 – Color format validation", () => {
  it("all light-mode colors are valid hex or rgba format", () => {
    // Walk color.* but skip the "dark" sub-object
    const lightColorObj = { ...tokensJSON.color };
    const lightValues = collectLeafValues(lightColorObj, "dark");

    for (const value of lightValues) {
      expect(
        HEX_OR_RGBA_RE.test(value),
        `Light-mode color value "${value}" is not a valid hex or rgba`,
      ).toBe(true);
    }
  });

  it("all dark-mode colors are valid hex or rgba format", () => {
    const darkValues = collectLeafValues(tokensJSON.color.dark);
    for (const value of darkValues) {
      expect(
        HEX_OR_RGBA_RE.test(value),
        `Dark-mode color value "${value}" is not a valid hex or rgba`,
      ).toBe(true);
    }
  });

  it("all semantic colors are valid hex values", () => {
    const semantic = tokensJSON.color.semantic as Record<string, string>;
    for (const [name, value] of Object.entries(semantic)) {
      expect(
        /^#[0-9a-fA-F]{6}$/.test(value),
        `semantic.${name} = "${value}" is not a 6-digit hex`,
      ).toBe(true);
    }
  });

  it("all court colors are valid 6-digit hex values", () => {
    const court = tokensJSON.color.court as Record<string, string>;
    for (const [name, value] of Object.entries(court)) {
      expect(
        /^#[0-9a-fA-F]{6}$/.test(value),
        `court.${name} = "${value}" is not a 6-digit hex`,
      ).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Group 3: WCAG contrast compliance
// ══════════════════════════════════════════════════════════════════════
describe("Group 3 – WCAG contrast compliance", () => {
  it("light mode: text.DEFAULT on background.DEFAULT meets WCAG AA (≥4.5:1)", () => {
    const textColor = tokensJSON.color.text.DEFAULT as string;
    const bgColor = tokensJSON.color.background.DEFAULT as string;
    const ratio = getContrastRatio(textColor, bgColor);
    // Actual ratio: ~13.57:1 — well above WCAG AA (4.5) and AAA (7.0)
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("dark mode: text.DEFAULT on background.DEFAULT meets WCAG AA (≥4.5:1)", () => {
    const textColor = tokensJSON.color.dark.text.DEFAULT as string;
    const bgColor = tokensJSON.color.dark.background.DEFAULT as string;
    const ratio = getContrastRatio(textColor, bgColor);
    // Actual ratio: ~13.44:1 — well above WCAG AA
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("light mode: accent.DEFAULT on background.DEFAULT has sufficient contrast for UI (≥4.5:1)", () => {
    // accent.DEFAULT (#5c4306 dark brown) is used for interactive elements like checkboxes/focus rings.
    // accent.light (#d4a017 gold) is used for decorative/highlight purposes only (ratio ~2.16 on light bg),
    // so we test the DEFAULT accent which is the accessibility-relevant value.
    const accentColor = tokensJSON.color.accent.DEFAULT as string;
    const bgColor = tokensJSON.color.background.DEFAULT as string;
    const ratio = getContrastRatio(accentColor, bgColor);
    // Actual ratio: ~8.45:1
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("light mode: accent.light is a known low-contrast decorative color (ratio < 4.5 on light bg)", () => {
    // accent.light (#d4a017) is used for decorative highlights and chart accents,
    // NOT for body text. Its contrast ratio against the light background is ~2.16:1,
    // which is intentionally below WCAG AA for text. This test documents the known limitation.
    const accentLight = tokensJSON.color.accent.light as string;
    const bgColor = tokensJSON.color.background.DEFAULT as string;
    const ratio = getContrastRatio(accentLight, bgColor);
    // Known: ~2.16:1 — acceptable for decorative/non-text use (WCAG 1.4.11 allows 3:1 for UI components,
    // but decorative elements are exempt under WCAG 1.4.1)
    expect(ratio).toBeLessThan(4.5);
  });

  it("dark mode: accent.DEFAULT on background.DEFAULT has sufficient contrast (≥3.0:1 for UI components)", () => {
    const accentColor = tokensJSON.color.dark.accent.DEFAULT as string;
    const bgColor = tokensJSON.color.dark.background.DEFAULT as string;
    const ratio = getContrastRatio(accentColor, bgColor);
    // Dark accent (#c9942e) on dark bg (#111820) — WCAG 1.4.11 requires 3:1 for UI components
    expect(ratio).toBeGreaterThanOrEqual(3.0);
  });

  it("semantic success/warning/danger/info are valid hex (format check)", () => {
    const semantic = tokensJSON.color.semantic as Record<string, string>;
    for (const [name, value] of Object.entries(semantic)) {
      expect(
        /^#[0-9a-fA-F]{6}$/.test(value),
        `semantic.${name} = "${value}" is not valid hex`,
      ).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Group 4: tokens.css completeness
// ══════════════════════════════════════════════════════════════════════
describe("Group 4 – tokens.css completeness", () => {
  it("tokens.css exists", () => {
    expect(fs.existsSync(TOKENS_CSS_PATH)).toBe(true);
  });

  it("tokens.css has :root selector", () => {
    expect(tokensCSS).toMatch(/:root\s*\{/);
  });

  it("tokens.css has .dark selector", () => {
    expect(tokensCSS).toMatch(/\.dark\s*\{/);
  });

  it("tokens.css contains all 9 court color variables (lowercase)", () => {
    const courts = ["aata", "arta", "fca", "fcca", "fedcfamc2g", "hca", "rrta", "mrta", "fmca"];
    for (const court of courts) {
      expect(
        tokensCSS,
        `tokens.css is missing --color-court-${court}`,
      ).toContain(`--color-court-${court}:`);
    }
  });

  it("tokens.css contains new token category variables: --opacity-, --z-, --duration-, --line-height-", () => {
    expect(tokensCSS).toContain("--opacity-");
    expect(tokensCSS).toContain("--z-");
    expect(tokensCSS).toContain("--duration-");
    expect(tokensCSS).toContain("--line-height-");
  });

  it("tokens.css :root contains --color-chart-2 through --color-chart-5", () => {
    for (let i = 2; i <= 5; i++) {
      expect(tokensCSS).toContain(`--color-chart-${i}:`);
    }
  });

  it("tokens.css .dark section overrides --color-text and --color-background", () => {
    // The .dark block should contain overrides for these critical variables
    const darkBlockMatch = tokensCSS.match(/\.dark\s*\{([^}]+)\}/s);
    expect(darkBlockMatch).not.toBeNull();
    const darkBlock = darkBlockMatch![1];
    expect(darkBlock).toContain("--color-text:");
    expect(darkBlock).toContain("--color-background:");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Group 5: tokens.ts exports
// ══════════════════════════════════════════════════════════════════════
describe("Group 5 – tokens.ts exports", () => {
  it("tokens.ts exists", () => {
    expect(fs.existsSync(TOKENS_TS_PATH)).toBe(true);
  });

  it("tokens.ts exports courtColors with all 9 courts", () => {
    const courts = ["AATA", "ARTA", "FCA", "FCCA", "FedCFamC2G", "HCA", "RRTA", "MRTA", "FMCA"];
    expect(tokensTS).toContain("export const courtColors");
    for (const court of courts) {
      expect(
        tokensTS,
        `tokens.ts courtColors is missing "${court}"`,
      ).toContain(court);
    }
  });

  it("tokens.ts exports semanticColors with success, warning, danger, info", () => {
    expect(tokensTS).toContain("export const semanticColors");
    expect(tokensTS).toContain("success:");
    expect(tokensTS).toContain("warning:");
    expect(tokensTS).toContain("danger:");
    expect(tokensTS).toContain("info:");
  });

  it("tokens.ts exports spacing, radius, shadow, zIndex as named exports", () => {
    expect(tokensTS).toMatch(/export const spacing\s*=/);
    expect(tokensTS).toMatch(/export const radius\s*=/);
    expect(tokensTS).toMatch(/export const shadow\s*=/);
    expect(tokensTS).toMatch(/export const zIndex\s*=/);
  });

  it("tokens.ts exports animationDuration and animationEasing", () => {
    expect(tokensTS).toMatch(/export const animationDuration\s*=/);
    expect(tokensTS).toMatch(/export const animationEasing\s*=/);
  });
});

// ══════════════════════════════════════════════════════════════════════
// Group 6: index.css @theme mapping
// ══════════════════════════════════════════════════════════════════════
describe("Group 6 – index.css @theme mapping", () => {
  it("index.css exists", () => {
    expect(fs.existsSync(INDEX_CSS_PATH)).toBe(true);
  });

  it("index.css contains @theme block", () => {
    expect(indexCSS).toMatch(/@theme\s*\{/);
  });

  it("@theme maps core color tokens: --color-primary, --color-foreground, --color-border", () => {
    // Note: index.css maps --color-text as --color-foreground (Tailwind v4 convention)
    expect(indexCSS).toContain("--color-primary:");
    expect(indexCSS).toContain("--color-foreground:");
    expect(indexCSS).toContain("--color-border:");
  });

  it("@theme maps surface and card background aliases", () => {
    expect(indexCSS).toContain("--color-surface:");
    expect(indexCSS).toContain("--color-surface-hover:");
    expect(indexCSS).toContain("--color-card:");
  });

  it("@theme maps all 9 court colors", () => {
    // index.css uses shorter alias --color-court-fedc for FedCFamC2G
    const courtAliases = ["aata", "arta", "fca", "fcca", "hca", "rrta", "mrta", "fmca"];
    for (const court of courtAliases) {
      expect(
        indexCSS,
        `@theme in index.css is missing --color-court-${court}`,
      ).toContain(`--color-court-${court}:`);
    }
    // FedCFamC2G is mapped as --color-court-fedc in index.css
    expect(indexCSS).toContain("--color-court-fedc:");
  });

  it("@theme maps animation duration variables", () => {
    expect(indexCSS).toContain("--duration-fast:");
    expect(indexCSS).toContain("--duration-normal:");
    expect(indexCSS).toContain("--duration-slow:");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Group 7: Typography tokens
// ══════════════════════════════════════════════════════════════════════
describe("Group 7 – Typography tokens", () => {
  it("typography has fontFamily, lineHeight, letterSpacing, fontWeight", () => {
    const typo = tokensJSON.typography;
    expect(typo).toHaveProperty("fontFamily");
    expect(typo).toHaveProperty("lineHeight");
    expect(typo).toHaveProperty("letterSpacing");
    expect(typo).toHaveProperty("fontWeight");
  });

  it("fontFamily has heading, body, mono entries as arrays", () => {
    const { fontFamily } = tokensJSON.typography;
    expect(Array.isArray(fontFamily.heading)).toBe(true);
    expect(Array.isArray(fontFamily.body)).toBe(true);
    expect(Array.isArray(fontFamily.mono)).toBe(true);
    expect(fontFamily.heading.length).toBeGreaterThan(0);
    expect(fontFamily.body.length).toBeGreaterThan(0);
    expect(fontFamily.mono.length).toBeGreaterThan(0);
  });

  it("all lineHeight values are valid numeric strings", () => {
    const { lineHeight } = tokensJSON.typography;
    for (const [key, value] of Object.entries(lineHeight as Record<string, string>)) {
      expect(
        !isNaN(Number(value)),
        `lineHeight.${key} = "${value}" is not a valid number`,
      ).toBe(true);
    }
  });

  it("all fontWeight values are valid numeric strings (100–900 range)", () => {
    const { fontWeight } = tokensJSON.typography;
    for (const [key, value] of Object.entries(fontWeight as Record<string, string>)) {
      const num = Number(value);
      expect(
        !isNaN(num) && num >= 100 && num <= 900,
        `fontWeight.${key} = "${value}" is out of valid range 100–900`,
      ).toBe(true);
    }
  });

  it("tokens.css exposes --font-weight-* variables for all fontWeight keys", () => {
    const { fontWeight } = tokensJSON.typography;
    for (const key of Object.keys(fontWeight)) {
      expect(
        tokensCSS,
        `tokens.css is missing --font-weight-${key}`,
      ).toContain(`--font-weight-${key}:`);
    }
  });

  it("tokens.css exposes --line-height-* variables for all lineHeight keys", () => {
    const { lineHeight } = tokensJSON.typography;
    for (const key of Object.keys(lineHeight)) {
      expect(
        tokensCSS,
        `tokens.css is missing --line-height-${key}`,
      ).toContain(`--line-height-${key}:`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Group 8: Spacing, radius, shadow, zIndex, animation token completeness
// ══════════════════════════════════════════════════════════════════════
describe("Group 8 – Spacing, radius, shadow, zIndex, animation completeness", () => {
  it("all spacing values in tokens.json are valid rem values", () => {
    const { spacing } = tokensJSON;
    for (const [key, value] of Object.entries(spacing as Record<string, string>)) {
      expect(
        /^\d+(\.\d+)?rem$/.test(value),
        `spacing.${key} = "${value}" is not a valid rem value`,
      ).toBe(true);
    }
  });

  it("tokens.css contains --spacing-1 through --spacing-8 (skipping 7 per design)", () => {
    const defined = ["1", "2", "3", "4", "5", "6", "8"];
    for (const n of defined) {
      expect(tokensCSS).toContain(`--spacing-${n}:`);
    }
  });

  it("tokens.css contains all 4 radius variables", () => {
    expect(tokensCSS).toContain("--radius-sm:");
    expect(tokensCSS).toContain("--radius:");
    expect(tokensCSS).toContain("--radius-lg:");
    expect(tokensCSS).toContain("--radius-pill:");
  });

  it("tokens.css contains all 4 shadow variables", () => {
    expect(tokensCSS).toContain("--shadow-xs:");
    expect(tokensCSS).toContain("--shadow-sm:");
    expect(tokensCSS).toContain("--shadow:");
    expect(tokensCSS).toContain("--shadow-lg:");
  });

  it("tokens.css zIndex: all 6 levels present", () => {
    const levels = ["base", "dropdown", "popover", "tooltip", "modal", "toast"];
    for (const level of levels) {
      expect(tokensCSS).toContain(`--z-${level}:`);
    }
  });

  it("tokens.css animation: all 3 duration values and 3 easing values present", () => {
    expect(tokensCSS).toContain("--duration-fast:");
    expect(tokensCSS).toContain("--duration-normal:");
    expect(tokensCSS).toContain("--duration-slow:");
    expect(tokensCSS).toContain("--ease-ease-in:");
    expect(tokensCSS).toContain("--ease-ease-out:");
    expect(tokensCSS).toContain("--ease-ease-in-out:");
  });

  it("opacity token values are correct numeric strings (0 to 1)", () => {
    const { opacity } = tokensJSON;
    for (const [key, value] of Object.entries(opacity as Record<string, string>)) {
      const num = Number(value);
      expect(
        !isNaN(num) && num >= 0 && num <= 1,
        `opacity.${key} = "${value}" is not in range 0–1`,
      ).toBe(true);
    }
  });
});
