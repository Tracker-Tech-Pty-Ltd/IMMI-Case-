import { describe, it, expect, beforeAll, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

type ThemeModule = typeof import("@/hooks/use-theme-preset");

const TOKENS = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../src/tokens/tokens.json"),
    "utf-8",
  ),
);

/** jsdom has no matchMedia; readStoredDark() calls it at module load. */
function stubMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

let mod: ThemeModule;

beforeAll(async () => {
  stubMatchMedia();
  mod = await import("@/hooks/use-theme-preset");
});

/** Re-run the module's boot-time applyTheme() with a given stored preset. */
async function boot(stored: string | null): Promise<void> {
  localStorage.clear();
  if (stored !== null) localStorage.setItem("theme-preset", stored);
  document.documentElement.removeAttribute("style");
  vi.resetModules();
  stubMatchMedia();
  await import("@/hooks/use-theme-preset");
}

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name).trim();
}

function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const [r, g, b] = [0, 2, 4].map(
    (i) => parseInt(clean.slice(i, i + 2), 16) / 255,
  );
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// ══════════════════════════════════════════════════════════════════════
// Boot behaviour — the default palette and preset persistence
// ══════════════════════════════════════════════════════════════════════
describe("theme preset boot behaviour", () => {
  it("boots on the Legal Codex palette when nothing is stored", async () => {
    await boot(null);
    expect(cssVar("--color-background")).toBe("#f5f4f1");
    expect(cssVar("--color-text")).toBe("#1b2838");
    expect(cssVar("--color-accent-light")).toBe("#d4a017");
  });

  it("does not write to localStorage while reading the stored preset", async () => {
    await boot(null);
    expect(localStorage.getItem("theme-preset")).toBeNull();
  });

  it("keeps an explicitly stored parchment preset across a reload", async () => {
    await boot("parchment");
    expect(localStorage.getItem("theme-preset")).toBe("parchment");
    expect(cssVar("--color-background")).toBe("#f5f4f1");
  });

  it("keeps an explicitly stored claude preset across a reload", async () => {
    await boot("claude");
    expect(localStorage.getItem("theme-preset")).toBe("claude");
    expect(cssVar("--color-background")).toBe("#eeece2");
  });

  it("falls back to the Legal Codex palette for an unknown stored preset", async () => {
    await boot("not-a-real-preset");
    expect(cssVar("--color-background")).toBe("#f5f4f1");
  });
});

// ══════════════════════════════════════════════════════════════════════
// Preset var contract — no preset may silently inherit from tokens.css
// ══════════════════════════════════════════════════════════════════════
describe("theme preset var contract", () => {
  it("every preset defines every themeable var in both light and dark", () => {
    const expected = [...mod.THEME_VAR_NAMES].toSorted();
    expect(expected).toHaveLength(17);
    for (const [name, preset] of Object.entries(mod.PRESETS)) {
      expect(Object.keys(preset.vars).toSorted(), `${name}.vars`).toEqual(
        expected,
      );
      expect(
        Object.keys(preset.darkVars).toSorted(),
        `${name}.darkVars`,
      ).toEqual(expected);
    }
  });

  it("parchment mirrors the tokens.json Legal Codex baseline exactly", () => {
    const c = TOKENS.color;
    expect(mod.PRESETS.parchment.vars).toEqual({
      "--color-primary": c.primary.DEFAULT,
      "--color-primary-light": c.primary.light,
      "--color-primary-lighter": c.primary.lighter,
      "--color-accent": c.accent.DEFAULT,
      "--color-accent-light": c.accent.light,
      "--color-accent-muted": c.accent.muted,
      "--color-background": c.background.DEFAULT,
      "--color-background-card": c.background.card,
      "--color-background-sidebar": c.background.sidebar,
      "--color-background-surface": c.background.surface,
      "--color-background-surface-hover": c.background["surface-hover"],
      "--color-border": c.border.DEFAULT,
      "--color-border-light": c.border.light,
      "--color-text": c.text.DEFAULT,
      "--color-text-secondary": c.text.secondary,
      "--color-text-muted": c.text.muted,
      "--color-overlay": c.overlay.DEFAULT,
    });
    const d = TOKENS.color.dark;
    expect(mod.PRESETS.parchment.darkVars).toEqual({
      "--color-primary": d.primary.DEFAULT,
      "--color-primary-light": d.primary.light,
      "--color-primary-lighter": d.primary.lighter,
      "--color-accent": d.accent.DEFAULT,
      "--color-accent-light": d.accent.light,
      "--color-accent-muted": d.accent.muted,
      "--color-background": d.background.DEFAULT,
      "--color-background-card": d.background.card,
      "--color-background-sidebar": d.background.sidebar,
      "--color-background-surface": d.background.surface,
      "--color-background-surface-hover": d.background["surface-hover"],
      "--color-border": d.border.DEFAULT,
      "--color-border-light": d.border.light,
      "--color-text": d.text.DEFAULT,
      "--color-text-secondary": d.text.secondary,
      "--color-text-muted": d.text.muted,
      "--color-overlay": d.overlay.DEFAULT,
    });
  });

  it("surface-hover is distinct from surface and moves the right way", () => {
    for (const [name, p] of Object.entries(mod.PRESETS)) {
      const ls = p.vars["--color-background-surface"];
      const lh = p.vars["--color-background-surface-hover"];
      expect(lh, `${name} light hover equals surface`).not.toBe(ls);
      expect(
        luminance(lh),
        `${name} light hover must be darker than surface`,
      ).toBeLessThan(luminance(ls));

      const ds = p.darkVars["--color-background-surface"];
      const dh = p.darkVars["--color-background-surface-hover"];
      expect(dh, `${name} dark hover equals surface`).not.toBe(ds);
      expect(
        luminance(dh),
        `${name} dark hover must be lighter than surface`,
      ).toBeGreaterThan(luminance(ds));
    }
  });

  it("overlay is black in dark mode and the preset's own dark background in light mode", () => {
    for (const [name, p] of Object.entries(mod.PRESETS)) {
      expect(p.darkVars["--color-overlay"], `${name} dark overlay`).toBe(
        "#000000",
      );
      expect(p.vars["--color-overlay"], `${name} light overlay`).toBe(
        p.darkVars["--color-background"],
      );
    }
  });
});
