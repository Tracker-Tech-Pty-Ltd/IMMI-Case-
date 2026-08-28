import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { getContrastRatio } from "@/lib/color";

// ── File paths ─────────────────────────────────────────────────────────
const TOKENS_JSON_PATH = path.resolve(__dirname, "../src/tokens/tokens.json");
const TOKENS_CSS_PATH = path.resolve(__dirname, "../src/tokens/tokens.css");
const TOKENS_TS_PATH = path.resolve(__dirname, "../src/tokens/tokens.ts");
const INDEX_CSS_PATH = path.resolve(__dirname, "../src/index.css");

// ── Helpers ────────────────────────────────────────────────────────────

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
    const expectedDarkKeys = [
      "primary",
      "accent",
      "background",
      "chart",
      "border",
      "text",
      "semantic",
    ];
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
// Group 3: WCAG contrast compliance — full token matrix
// ══════════════════════════════════════════════════════════════════════
//
// Every foreground token is checked against every background token it can
// realistically sit on, in BOTH themes.
//
// Thresholds (WCAG 2.1):
//   4.5:1  normal-size text          — SC 1.4.3 Contrast (Minimum)
//   3.0:1  UI components & graphics  — SC 1.4.11 Non-text Contrast
//
// TOTAL_PAIRS and KNOWN_BELOW_THRESHOLD are MEASURED from the live
// src/tokens/tokens.json (see plans/024 Step 3a), not copied from a plan.
// Two assertions keep the list honest, in both directions:
//   * a pair NOT on the list must meet its threshold  → no new debt
//   * a pair ON the list must still fail              → no stale exemptions
// When you fix a token in src/tokens/tokens.json, DELETE its entries here —
// the "no stale exemptions" test will tell you exactly which ones.

type ColorScope = {
  text: Record<string, string>;
  border: Record<string, string>;
  background: Record<string, string>;
  semantic: Record<string, string>;
  accent: Record<string, string>;
  primary: Record<string, string>;
  chart: Record<string, string>;
  court: Record<string, string>;
};

type ContrastPair = { key: string; ratio: number; threshold: number };

const BACKGROUND_KEYS = [
  "DEFAULT",
  "card",
  "sidebar",
  "surface",
  "surface-hover",
] as const;

/**
 * The number of pairs buildContrastPairs() produces, measured from the live
 * tokens.json (plans/024 Step 3a). It guards the matrix itself: if a token
 * group is renamed or dropped, the count moves and this fails loudly instead
 * of the other assertions passing vacuously over a shrunken set.
 * It was 119 at commit 42826a3; 140 after plan 022 extended the chart ramp
 * from 4 to 7 keys and added the outcome / on-solid token groups.
 */
const TOTAL_PAIRS = 140;

/**
 * MEASURED, NOT COPIED — generated by plans/024 Step 3a against the tree at
 * the top of this executor's branch (after plans 001/022/023/025 landed).
 * The debt that dominated the 42826a3-era list (dark border.DEFAULT on most
 * surfaces, text.muted below AA almost everywhere, light chart.3/chart.5,
 * dark semantic.danger, five dark court values) is fixed by plan 022. What
 * remains is border.light in both themes (decorative dividers, exempt from
 * 1.4.11 by intent), accent.light in light mode (documented decorative
 * gold), the badge:*:text.white on court.FCCA pair in both themes
 * (CourtBadge.tsx hardcodes text-white and #b9770e is 3.68:1 against it),
 * plus a handful of narrow near-misses on the surface-hover background and
 * dark primary.lighter that the old 5-pair spot-check never covered.
 */
const KNOWN_BELOW_THRESHOLD: readonly string[] = [
  // ── Light theme ────────────────────────────────────────────────────
  "light:text.muted on background.surface-hover", // 4.23 (needs 4.5)
  "light:border.light on background.DEFAULT", // 1.11 (needs 3.0)
  "light:border.light on background.card", // 1.22 (needs 3.0)
  "light:border.light on background.sidebar", // 1.16 (needs 3.0)
  "light:border.light on background.surface", // 1.06 (needs 3.0)
  "light:border.light on background.surface-hover", // 1.04 (needs 3.0)
  "light:accent.light on background.DEFAULT", // 2.16 (needs 4.5) — decorative gold
  // ── Dark theme ─────────────────────────────────────────────────────
  "dark:text.muted on background.surface-hover", // 3.98 (needs 4.5)
  "dark:border.DEFAULT on background.surface-hover", // 2.66 (needs 3.0)
  "dark:border.light on background.DEFAULT", // 1.49 (needs 3.0)
  "dark:border.light on background.card", // 1.33 (needs 3.0)
  "dark:border.light on background.sidebar", // 1.43 (needs 3.0)
  "dark:border.light on background.surface", // 1.28 (needs 3.0)
  "dark:border.light on background.surface-hover", // 1.10 (needs 3.0)
  "dark:primary.lighter on background.DEFAULT", // 4.23 (needs 4.5)
  // ── CourtBadge: white label on the court colour, both themes ───────
  "badge:light:text.white on court.FCCA", // 3.68 (needs 4.5)
  "badge:dark:text.white on court.FCCA", // 3.68 (needs 4.5)
];

function buildContrastPairs(): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  const isHex = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);
  const add = (key: string, fg: string, bg: string, threshold: number) => {
    pairs.push({ key, ratio: getContrastRatio(fg, bg), threshold });
  };

  const scopes = [
    ["light", tokensJSON.color as ColorScope],
    ["dark", tokensJSON.color.dark as ColorScope],
  ] as const;

  for (const [theme, scope] of scopes) {
    // Body text on every surface it can land on — 4.5:1.
    for (const key of ["DEFAULT", "secondary", "muted"]) {
      for (const bg of BACKGROUND_KEYS) {
        add(
          `${theme}:text.${key} on background.${bg}`,
          scope.text[key],
          scope.background[bg],
          4.5,
        );
      }
    }
    // Borders are non-text UI boundaries — 3:1.
    for (const key of ["DEFAULT", "light"]) {
      for (const bg of BACKGROUND_KEYS) {
        add(
          `${theme}:border.${key} on background.${bg}`,
          scope.border[key],
          scope.background[bg],
          3.0,
        );
      }
    }
    // Status colours are rendered as text (badges, inline labels) — 4.5:1.
    for (const key of Object.keys(scope.semantic)) {
      for (const bg of ["DEFAULT", "card"] as const) {
        add(
          `${theme}:semantic.${key} on background.${bg}`,
          scope.semantic[key],
          scope.background[bg],
          4.5,
        );
      }
    }
    // Accent + primary carry links and headings — 4.5:1.
    // accent.muted is an rgba() wash, not a foreground: skipped by isHex.
    for (const group of ["accent", "primary"] as const) {
      for (const [key, value] of Object.entries(scope[group])) {
        if (!isHex(value)) continue;
        add(
          `${theme}:${group}.${key} on background.DEFAULT`,
          value,
          scope.background.DEFAULT,
          4.5,
        );
      }
    }
    // Chart series are non-text graphical objects — 3:1.
    for (const key of Object.keys(scope.chart)) {
      for (const bg of ["DEFAULT", "card"] as const) {
        add(
          `${theme}:chart.${key} on background.${bg}`,
          scope.chart[key],
          scope.background[bg],
          3.0,
        );
      }
    }
    // Court colours are also used as chart fills — 3:1.
    for (const key of Object.keys(scope.court)) {
      add(
        `${theme}:court.${key} on background.DEFAULT`,
        scope.court[key],
        scope.background.DEFAULT,
        3.0,
      );
    }
  }

  // CourtBadge renders `text-white` on the court colour as a background at
  // text-xs (normal size) — see src/components/shared/CourtBadge.tsx:39.
  //
  // BOTH themes, deliberately: the badge uses the Tailwind class `bg-court-*`,
  // which resolves --color-court-*, and tokens.css redefines every one of those
  // inside `.dark`. So a dark court value is a badge background too, not just a
  // chart fill. Checking only the light block (as an earlier draft did) is how a
  // dark court colour that is illegible under the hardcoded white label reaches
  // production unnoticed.
  for (const [theme, scope] of scopes) {
    for (const [key, value] of Object.entries(scope.court)) {
      add(`badge:${theme}:text.white on court.${key}`, "#ffffff", value, 4.5);
    }
  }

  return pairs;
}

describe("Group 3 – WCAG contrast compliance (full token matrix)", () => {
  const pairs = buildContrastPairs();

  it("covers every documented foreground/background combination", () => {
    // Guards the matrix itself: if a token group is renamed or dropped from
    // tokens.json the count moves and this fails before the other two tests
    // can pass vacuously.
    expect(pairs).toHaveLength(TOTAL_PAIRS);
    expect(new Set(pairs.map((p) => p.key)).size).toBe(TOTAL_PAIRS);
  });

  it("no unlisted token pair falls below its WCAG threshold", () => {
    const offenders = pairs
      .filter(
        (p) => !KNOWN_BELOW_THRESHOLD.includes(p.key) && p.ratio < p.threshold,
      )
      .map(
        (p) => `${p.key} = ${p.ratio.toFixed(2)}:1 (needs ${p.threshold}:1)`,
      );
    expect(
      offenders,
      `New low-contrast token pair(s). Fix the value in src/tokens/tokens.json and re-run \`npm run tokens\`. Only add a key to KNOWN_BELOW_THRESHOLD with a written reason.\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("every KNOWN_BELOW_THRESHOLD entry is still failing (no stale exemptions)", () => {
    const byKey = new Map(pairs.map((p) => [p.key, p]));
    const stale: string[] = [];
    for (const key of KNOWN_BELOW_THRESHOLD) {
      const pair = byKey.get(key);
      if (!pair) {
        stale.push(`${key} — no such pair (token renamed or removed?)`);
        continue;
      }
      if (pair.ratio >= pair.threshold) {
        stale.push(
          `${key} — now ${pair.ratio.toFixed(2)}:1, passes ${pair.threshold}:1`,
        );
      }
    }
    expect(
      stale,
      `Delete these entries from KNOWN_BELOW_THRESHOLD — they no longer fail:\n${stale.join("\n")}`,
    ).toEqual([]);
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
    const courts = [
      "aata",
      "arta",
      "fca",
      "fcca",
      "fedcfamc2g",
      "hca",
      "rrta",
      "mrta",
      "fmca",
    ];
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
    const courts = [
      "AATA",
      "ARTA",
      "FCA",
      "FCCA",
      "FedCFamC2G",
      "HCA",
      "RRTA",
      "MRTA",
      "FMCA",
    ];
    expect(tokensTS).toContain("export const courtColors");
    for (const court of courts) {
      expect(tokensTS, `tokens.ts courtColors is missing "${court}"`).toContain(
        court,
      );
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
    const courtAliases = [
      "aata",
      "arta",
      "fca",
      "fcca",
      "hca",
      "rrta",
      "mrta",
      "fmca",
    ];
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
    for (const [key, value] of Object.entries(
      lineHeight as Record<string, string>,
    )) {
      expect(
        !isNaN(Number(value)),
        `lineHeight.${key} = "${value}" is not a valid number`,
      ).toBe(true);
    }
  });

  it("all fontWeight values are valid numeric strings (100–900 range)", () => {
    const { fontWeight } = tokensJSON.typography;
    for (const [key, value] of Object.entries(
      fontWeight as Record<string, string>,
    )) {
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
      expect(tokensCSS, `tokens.css is missing --font-weight-${key}`).toContain(
        `--font-weight-${key}:`,
      );
    }
  });

  it("tokens.css exposes --line-height-* variables for all lineHeight keys", () => {
    const { lineHeight } = tokensJSON.typography;
    for (const key of Object.keys(lineHeight)) {
      expect(tokensCSS, `tokens.css is missing --line-height-${key}`).toContain(
        `--line-height-${key}:`,
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// Group 8: Spacing, radius, shadow, zIndex, animation token completeness
// ══════════════════════════════════════════════════════════════════════
describe("Group 8 – Spacing, radius, shadow, zIndex, animation completeness", () => {
  it("all spacing values in tokens.json are valid rem values", () => {
    const { spacing } = tokensJSON;
    for (const [key, value] of Object.entries(
      spacing as Record<string, string>,
    )) {
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
    expect(tokensCSS).toContain("--ease-in:");
    expect(tokensCSS).toContain("--ease-out:");
    expect(tokensCSS).toContain("--ease-in-out:");
  });

  it("opacity token values are correct numeric strings (0 to 1)", () => {
    const { opacity } = tokensJSON;
    for (const [key, value] of Object.entries(
      opacity as Record<string, string>,
    )) {
      const num = Number(value);
      expect(
        !isNaN(num) && num >= 0 && num <= 1,
        `opacity.${key} = "${value}" is not in range 0–1`,
      ).toBe(true);
    }
  });
});
