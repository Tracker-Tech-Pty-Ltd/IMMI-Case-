/**
 * token-contrast.test.ts
 *
 * WCAG AA contrast regression suite for the token layer (frontend/src/tokens/tokens.json).
 * Companion to css-tokens.test.ts (structural/format checks) — this file asserts
 * contrast ratios against the WCAG 2.x relative-luminance formula, in both themes.
 *
 * Structural pattern: css-tokens.test.ts (getLuminance/getContrastRatio helpers,
 * fs.readFileSync + JSON.parse of tokens.json) and analytics-charts-tokens.test.tsx
 * (read component source with fs, strip comments, assert no hex literals).
 *
 * Deliberately does NOT import from @/hooks/use-theme-preset — that module calls
 * applyTheme() at import time, which reaches window.matchMedia, and jsdom does not
 * define matchMedia in this repo's global test setup. Preset values are instead
 * extracted from the source text with regexes.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── File paths ─────────────────────────────────────────────────────────
const TOKENS_JSON_PATH = path.resolve(__dirname, "../src/tokens/tokens.json");
const THEME_PRESET_PATH = path.resolve(
  __dirname,
  "../src/hooks/use-theme-preset.ts",
);
const RISK_GAUGE_PATH = path.resolve(
  __dirname,
  "../src/components/analytics/RiskGauge.tsx",
);
const JUDGE_CONSTANTS_PATH = path.resolve(
  __dirname,
  "../src/components/judges/constants.ts",
);
const OUTCOME_STACKED_BAR_PATH = path.resolve(
  __dirname,
  "../src/components/shared/OutcomeStackedBar.tsx",
);
const INDEX_CSS_PATH = path.resolve(__dirname, "../src/index.css");

// ── Helpers (same WCAG formula as css-tokens.test.ts) ────────────────────

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

function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// ── Pre-read files once ────────────────────────────────────────────────
const tokensJSON = JSON.parse(fs.readFileSync(TOKENS_JSON_PATH, "utf-8"));
const themePresetSrc = fs.readFileSync(THEME_PRESET_PATH, "utf-8");
const indexCSS = fs.readFileSync(INDEX_CSS_PATH, "utf-8");

const lightBg: Record<string, string> = {
  background: tokensJSON.color.background.DEFAULT,
  card: tokensJSON.color.background.card,
  surface: tokensJSON.color.background.surface,
};
const darkBg: Record<string, string> = {
  background: tokensJSON.color.dark.background.DEFAULT,
  card: tokensJSON.color.dark.background.card,
  surface: tokensJSON.color.dark.background.surface,
};

function assertClearsOnAllThree(
  bgSet: Record<string, string>,
  fg: string,
  min: number,
  label: string,
) {
  for (const [bgName, bg] of Object.entries(bgSet)) {
    const ratio = getContrastRatio(fg, bg);
    expect(
      ratio,
      `${label} on ${bgName} (${fg} vs ${bg}) = ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(min);
  }
}

// ══════════════════════════════════════════════════════════════════════
// 1-2: text.muted
// ══════════════════════════════════════════════════════════════════════
describe("token-contrast", () => {
  it("light text.muted clears 4.5:1 on background, card and surface", () => {
    assertClearsOnAllThree(
      lightBg,
      tokensJSON.color.text.muted,
      4.5,
      "light text.muted",
    );
  });

  it("dark text.muted clears 4.5:1 on background, card and surface", () => {
    assertClearsOnAllThree(
      darkBg,
      tokensJSON.color.dark.text.muted,
      4.5,
      "dark text.muted",
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // 3-4: text.secondary
  // ════════════════════════════════════════════════════════════════════
  it("light text.secondary clears 4.5:1 on background, card and surface", () => {
    assertClearsOnAllThree(
      lightBg,
      tokensJSON.color.text.secondary,
      4.5,
      "light text.secondary",
    );
  });

  it("dark text.secondary clears 4.5:1 on background, card and surface", () => {
    assertClearsOnAllThree(
      darkBg,
      tokensJSON.color.dark.text.secondary,
      4.5,
      "dark text.secondary",
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // 5-6: border.DEFAULT
  // ════════════════════════════════════════════════════════════════════
  it("light border.DEFAULT clears 3:1 on background, card and surface", () => {
    assertClearsOnAllThree(
      lightBg,
      tokensJSON.color.border.DEFAULT,
      3.0,
      "light border.DEFAULT",
    );
  });

  it("dark border.DEFAULT clears 3:1 on background, card and surface", () => {
    assertClearsOnAllThree(
      darkBg,
      tokensJSON.color.dark.border.DEFAULT,
      3.0,
      "dark border.DEFAULT",
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // 7-8: on-solid against the baseline accent and every preset accent
  // ════════════════════════════════════════════════════════════════════
  it("light on-solid clears 4.5:1 on the baseline accent and on every preset's light accent", () => {
    const onSolid = tokensJSON.color["on-solid"].DEFAULT;
    const baselineAccent = tokensJSON.color.accent.DEFAULT;
    const baselineRatio = getContrastRatio(onSolid, baselineAccent);
    expect(
      baselineRatio,
      `on-solid on baseline accent (${onSolid} vs ${baselineAccent}) = ${baselineRatio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);

    const accentMatches = [
      ...themePresetSrc.matchAll(/"--color-accent":\s*"(#[0-9a-fA-F]{6})"/g),
    ];
    expect(
      accentMatches.length,
      "expected at least 10 --color-accent matches in use-theme-preset.ts",
    ).toBeGreaterThanOrEqual(10);

    // vars (light) is declared before darkVars (dark) inside every preset, so
    // matches alternate light, dark, light, dark... across the whole file.
    accentMatches.forEach((m, idx) => {
      if (idx % 2 !== 0) return; // odd indices are dark accents
      const accent = m[1];
      const ratio = getContrastRatio(onSolid, accent);
      expect(
        ratio,
        `light on-solid on preset accent #${idx} (${onSolid} vs ${accent}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("dark on-solid clears 4.5:1 on the baseline accent and on every preset's dark accent", () => {
    const onSolid = tokensJSON.color.dark["on-solid"].DEFAULT;
    const baselineAccent = tokensJSON.color.dark.accent.DEFAULT;
    const baselineRatio = getContrastRatio(onSolid, baselineAccent);
    expect(
      baselineRatio,
      `on-solid on baseline dark accent (${onSolid} vs ${baselineAccent}) = ${baselineRatio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);

    const accentMatches = [
      ...themePresetSrc.matchAll(/"--color-accent":\s*"(#[0-9a-fA-F]{6})"/g),
    ];
    expect(
      accentMatches.length,
      "expected at least 10 --color-accent matches in use-theme-preset.ts",
    ).toBeGreaterThanOrEqual(10);

    accentMatches.forEach((m, idx) => {
      if (idx % 2 !== 1) return; // even indices are light accents
      const accent = m[1];
      const ratio = getContrastRatio(onSolid, accent);
      expect(
        ratio,
        `dark on-solid on preset accent #${idx} (${onSolid} vs ${accent}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 9-10: semantic colours
  // ════════════════════════════════════════════════════════════════════
  it("light semantic colours all clear 4.5:1 on background, card and surface", () => {
    const semantic = tokensJSON.color.semantic as Record<string, string>;
    for (const [name, value] of Object.entries(semantic)) {
      assertClearsOnAllThree(lightBg, value, 4.5, `light semantic.${name}`);
    }
  });

  it("dark semantic colours all clear 4.5:1 on background, card and surface", () => {
    const semantic = tokensJSON.color.dark.semantic as Record<string, string>;
    for (const [name, value] of Object.entries(semantic)) {
      assertClearsOnAllThree(darkBg, value, 4.5, `dark semantic.${name}`);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 11-12: court palette
  // ════════════════════════════════════════════════════════════════════
  it("dark court palette is distinct from the light palette and internally unique", () => {
    const light = tokensJSON.color.court as Record<string, string>;
    const dark = tokensJSON.color.dark.court as Record<string, string>;
    const same = Object.keys(light)
      .filter((k) => light[k] === dark[k])
      .toSorted();
    expect(same).toEqual(["FCCA", "RRTA"]);
    expect(new Set(Object.values(dark)).size).toBe(9);
  });

  it("dark court colours all clear 3:1 on background, card and surface", () => {
    const dark = tokensJSON.color.dark.court as Record<string, string>;
    for (const [name, value] of Object.entries(dark)) {
      assertClearsOnAllThree(darkBg, value, 3.0, `dark court.${name}`);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 13: chart ramp
  // ════════════════════════════════════════════════════════════════════
  it("chart ramp 1-7 clears 3:1 on all three backgrounds in both modes", () => {
    const lightChart = tokensJSON.color.chart as Record<string, string>;
    const darkChart = tokensJSON.color.dark.chart as Record<string, string>;
    for (let i = 1; i <= 7; i++) {
      assertClearsOnAllThree(lightBg, lightChart[String(i)], 3.0, `light chart.${i}`);
      assertClearsOnAllThree(darkBg, darkChart[String(i)], 3.0, `dark chart.${i}`);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 14: outcome colours against on-solid
  // ════════════════════════════════════════════════════════════════════
  it("outcome colours clear 4.5:1 against on-solid in both modes", () => {
    const lightOutcome = tokensJSON.color.outcome as Record<string, string>;
    const darkOutcome = tokensJSON.color.dark.outcome as Record<string, string>;
    const lightOnSolid = tokensJSON.color["on-solid"].DEFAULT;
    const darkOnSolid = tokensJSON.color.dark["on-solid"].DEFAULT;

    for (const [name, value] of Object.entries(lightOutcome)) {
      const ratio = getContrastRatio(lightOnSolid, value);
      expect(
        ratio,
        `light outcome.${name} vs on-solid (${value} vs ${lightOnSolid}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
    for (const [name, value] of Object.entries(darkOutcome)) {
      const ratio = getContrastRatio(darkOnSolid, value);
      expect(
        ratio,
        `dark outcome.${name} vs on-solid (${value} vs ${darkOnSolid}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 15: no hex literals in the three tokenised components
  // ════════════════════════════════════════════════════════════════════
  it("the three tokenised components hold no hex colour literals", () => {
    const paths = [
      RISK_GAUGE_PATH,
      JUDGE_CONSTANTS_PATH,
      OUTCOME_STACKED_BAR_PATH,
    ];
    for (const p of paths) {
      const src = stripComments(fs.readFileSync(p, "utf-8"));
      const hits = src.match(/#[0-9a-fA-F]{6}/g) ?? [];
      expect(
        hits,
        `${path.basename(p)} has hex literals: ${JSON.stringify(hits)}`,
      ).toHaveLength(0);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 16: select chevron against every preset card background
  // ════════════════════════════════════════════════════════════════════
  it("the select chevron clears 3:1 against every preset card background in its own mode", () => {
    const cardMatches = [
      ...themePresetSrc.matchAll(
        /"--color-background-card":\s*"(#[0-9a-fA-F]{6})"/g,
      ),
    ];
    expect(
      cardMatches.length,
      "expected at least 20 --color-background-card matches in use-theme-preset.ts",
    ).toBeGreaterThanOrEqual(20);

    const chevronMatches = [
      ...indexCSS.matchAll(
        /--select-chevron:\s*url\("data:image\/svg\+xml[^"]*stroke='%23([0-9a-fA-F]{6})'/g,
      ),
    ];
    expect(chevronMatches).toHaveLength(2);
    const [lightChevron, darkChevron] = chevronMatches.map((m) => `#${m[1]}`);
    expect(lightChevron).not.toBe(darkChevron);

    cardMatches.forEach((m, idx) => {
      const card = m[1];
      const chevron = idx % 2 === 0 ? lightChevron : darkChevron;
      const ratio = getContrastRatio(chevron, card);
      expect(
        ratio,
        `chevron ${chevron} on preset card #${idx} (${card}) = ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3.0);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 17: every dark court colour clears 4.5:1 against white (CourtBadge label),
  //     with FCCA the one documented exception
  // ════════════════════════════════════════════════════════════════════
  it("every dark court colour clears 4.5:1 against white, the CourtBadge label", () => {
    // CourtBadge (src/components/shared/CourtBadge.tsx:39) hardcodes text-white
    // on bg-court-*, which resolves the same --color-court-* variable tokens.css
    // redefines under .dark. FCCA is a pre-existing, documented exception: its
    // light value (#b9770e, unchanged in dark) already fails 4.5:1 against white
    // today. Fixing it needs either a shipped brand-colour change or a per-court
    // foreground token, both out of this plan's territory (see Maintenance notes).
    const dark = tokensJSON.color.dark.court as Record<string, string>;
    for (const [name, value] of Object.entries(dark)) {
      const ratio = getContrastRatio(value, "#ffffff");
      if (name === "FCCA") {
        expect(
          ratio,
          `FCCA on white = ${ratio.toFixed(2)}:1 should still be the documented exception`,
        ).toBeLessThan(4.5);
      } else {
        expect(
          ratio,
          `court.${name} on white = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 18: no var() fallback literal survives in RiskGauge
  // ════════════════════════════════════════════════════════════════════
  it("RiskGauge holds no var() fallback literals", () => {
    const src = fs.readFileSync(RISK_GAUGE_PATH, "utf-8");
    expect(src.match(/var\(--[a-z-]+,/g)).toBeNull();
  });
});
