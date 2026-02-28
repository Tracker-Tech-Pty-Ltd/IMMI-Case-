/**
 * Token build pipeline: tokens.json → tokens.css + tokens.ts
 * Run: npx tsx scripts/build-tokens.ts
 *
 * Generated at build time — do not edit the output files manually.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname_resolved = dirname(fileURLToPath(import.meta.url));
const tokensPath = resolve(__dirname_resolved, "../src/tokens/tokens.json");

// ─── Load & parse tokens ──────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tokens: Record<string, any> = JSON.parse(
  readFileSync(tokensPath, "utf-8"),
);

// ─── Validation helpers ───────────────────────────────────────
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGBA_RE = /^rgba?\([\d.,\s%/]+\)$/;
const COLOR_FN_RE = /^(hsl|hsla|oklch|lab|lch)\([\d.,\s%/]+\)$/;

function isValidColor(value: string): boolean {
  return HEX_RE.test(value) || RGBA_RE.test(value) || COLOR_FN_RE.test(value);
}

function validateColors(
  obj: Record<string, unknown>,
  path: string,
  warnings: string[],
): void {
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = `${path}.${key}`;
    if (typeof value === "string") {
      if (!isValidColor(value)) {
        warnings.push(
          `  WARN color value at "${currentPath}" is not a recognised color: "${value}"`,
        );
      }
    } else if (typeof value === "object" && value !== null) {
      validateColors(value as Record<string, unknown>, currentPath, warnings);
    }
  }
}

function validateRequiredKeys(
  obj: Record<string, unknown>,
  required: string[],
  section: string,
  warnings: string[],
): void {
  for (const key of required) {
    if (!(key in obj)) {
      warnings.push(
        `  WARN tokens.${section} is missing required key "${key}"`,
      );
    }
  }
}

// Run validation
const validationWarnings: string[] = [];
validateColors(tokens.color ?? {}, "color", validationWarnings);
validateRequiredKeys(
  tokens,
  [
    "color",
    "typography",
    "spacing",
    "radius",
    "shadow",
    "opacity",
    "zIndex",
    "animation",
  ],
  "root",
  validationWarnings,
);
validateRequiredKeys(
  tokens.color ?? {},
  [
    "primary",
    "accent",
    "background",
    "border",
    "text",
    "semantic",
    "court",
    "dark",
  ],
  "color",
  validationWarnings,
);

if (validationWarnings.length > 0) {
  console.warn("Token validation warnings:");
  for (const w of validationWarnings) {
    console.warn(w);
  }
}

// ─── Dark/light symmetry validation ──────────────────────────
function validateDarkLightSymmetry(
  light: Record<string, unknown>,
  dark: Record<string, unknown>,
  prefix = "color",
): void {
  for (const key of Object.keys(light)) {
    if (key === "dark") continue;
    if (!(key in dark)) {
      console.warn(
        `⚠ WARN: ${prefix}.dark.${key.replace(prefix + ".", "")} is missing (exists in light mode)`,
      );
    } else if (
      typeof light[key] === "object" &&
      typeof dark[key] === "object"
    ) {
      validateDarkLightSymmetry(
        light[key] as Record<string, unknown>,
        dark[key] as Record<string, unknown>,
        `${prefix}.${key}`,
      );
    }
  }
}
validateDarkLightSymmetry(tokens.color, tokens.color.dark);

// ─── CSS generation helpers ───────────────────────────────────

/**
 * Recursively flatten a nested color object into CSS variable pairs.
 * e.g. { primary: { DEFAULT: "#fff", light: "#eee" } }
 *   → [["--color-primary", "#fff"], ["--color-primary-light", "#eee"]]
 */
function flattenColors(
  obj: Record<string, unknown>,
  prefix: string,
): Array<[string, string]> {
  const result: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(obj)) {
    const varName =
      key === "DEFAULT" ? prefix : `${prefix}-${key.toLowerCase()}`;
    if (typeof value === "string") {
      result.push([varName, value]);
    } else if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result.push(...flattenColors(value as Record<string, unknown>, varName));
    }
  }
  return result;
}

// Light-mode color vars (everything except "dark" sub-key)
const lightColors = flattenColors(
  Object.fromEntries(
    Object.entries(tokens.color).filter(([k]) => k !== "dark"),
  ),
  "--color",
);

// Dark-mode overrides — keep the SAME variable names (no "dark" in the var name)
// The dark object mirrors the light structure under tokens.color.dark.*
const darkColors = flattenColors(tokens.color.dark, "--color");

// ─── Build :root { } ─────────────────────────────────────────
const timestamp = new Date().toISOString();
let css = `/* Auto-generated from tokens.json — do not edit manually */\n`;
css += `/* Generated: ${timestamp} */\n\n`;

css += `:root {\n`;

// Colors (light)
css += `  /* ── Colors ── */\n`;
for (const [name, value] of lightColors) {
  css += `  ${name}: ${value};\n`;
}

// Typography — font families
css += `\n  /* ── Typography: Font Families ── */\n`;
for (const [key, fonts] of Object.entries(
  tokens.typography.fontFamily as Record<string, string[]>,
)) {
  const fontList = fonts
    .map((f) => (f.includes(" ") ? `"${f}"` : f))
    .join(", ");
  css += `  --font-${key}: ${fontList};\n`;
}

// Typography — line height
if (tokens.typography.lineHeight) {
  css += `\n  /* ── Typography: Line Heights ── */\n`;
  for (const [key, value] of Object.entries(
    tokens.typography.lineHeight as Record<string, string>,
  )) {
    css += `  --line-height-${key}: ${value};\n`;
  }
}

// Typography — letter spacing
if (tokens.typography.letterSpacing) {
  css += `\n  /* ── Typography: Letter Spacing ── */\n`;
  for (const [key, value] of Object.entries(
    tokens.typography.letterSpacing as Record<string, string>,
  )) {
    css += `  --letter-spacing-${key}: ${value};\n`;
  }
}

// Typography — font weight
if (tokens.typography.fontWeight) {
  css += `\n  /* ── Typography: Font Weights ── */\n`;
  for (const [key, value] of Object.entries(
    tokens.typography.fontWeight as Record<string, string>,
  )) {
    css += `  --font-weight-${key}: ${value};\n`;
  }
}

// Spacing
css += `\n  /* ── Spacing ── */\n`;
for (const [key, value] of Object.entries(
  tokens.spacing as Record<string, string>,
)) {
  css += `  --spacing-${key}: ${value};\n`;
}

// Radius
css += `\n  /* ── Border Radius ── */\n`;
for (const [key, value] of Object.entries(
  tokens.radius as Record<string, string>,
)) {
  const suffix = key === "DEFAULT" ? "" : `-${key}`;
  css += `  --radius${suffix}: ${value};\n`;
}

// Shadow
css += `\n  /* ── Shadows ── */\n`;
for (const [key, value] of Object.entries(
  tokens.shadow as Record<string, string>,
)) {
  const suffix = key === "DEFAULT" ? "" : `-${key}`;
  css += `  --shadow${suffix}: ${value};\n`;
}

// Opacity
if (tokens.opacity) {
  css += `\n  /* ── Opacity ── */\n`;
  for (const [key, value] of Object.entries(
    tokens.opacity as Record<string, string>,
  )) {
    css += `  --opacity-${key}: ${value};\n`;
  }
}

// Z-Index
if (tokens.zIndex) {
  css += `\n  /* ── Z-Index ── */\n`;
  for (const [key, value] of Object.entries(
    tokens.zIndex as Record<string, string>,
  )) {
    css += `  --z-${key}: ${value};\n`;
  }
}

// Animation — duration
if (tokens.animation?.duration) {
  css += `\n  /* ── Animation: Duration ── */\n`;
  for (const [key, value] of Object.entries(
    tokens.animation.duration as Record<string, string>,
  )) {
    css += `  --duration-${key}: ${value};\n`;
  }
}

// Animation — easing
if (tokens.animation?.easing) {
  css += `\n  /* ── Animation: Easing ── */\n`;
  for (const [key, value] of Object.entries(
    tokens.animation.easing as Record<string, string>,
  )) {
    // Keys in JSON are "ease-in", "ease-out", "ease-in-out".
    // Strip the leading "ease-" prefix so we get --ease-in, --ease-out, --ease-in-out
    // instead of the doubled --ease-ease-in, --ease-ease-out, --ease-ease-in-out.
    const cssKey = key.startsWith("ease-") ? key.slice(5) : key;
    css += `  --ease-${cssKey}: ${value};\n`;
  }
}

css += `}\n\n`;

// ─── Build .dark { } ─────────────────────────────────────────
css += `.dark {\n`;
css += `  /* ── Dark mode color overrides ── */\n`;
for (const [name, value] of darkColors) {
  // darkColors were already flattened with "--color-" prefix (not "--color-dark-")
  // because flattenColors was called on tokens.color.dark directly with "--color" prefix
  css += `  ${name}: ${value};\n`;
}
css += `}\n`;

writeFileSync(resolve(__dirname_resolved, "../src/tokens/tokens.css"), css);

// ─── Generate TypeScript constants ───────────────────────────
let ts = `/* Auto-generated from tokens.json — do not edit manually */\n`;
ts += `/* Generated: ${timestamp} */\n\n`;

// Full token tree (as const)
ts += `export const tokens = ${JSON.stringify(tokens, null, 2)} as const\n\n`;

// Court colors
ts += `export const courtColors = {\n`;
for (const [court, color] of Object.entries(
  tokens.color.court as Record<string, string>,
)) {
  ts += `  ${court}: "${color}",\n`;
}
ts += `} as const\n\n`;
ts += `export type CourtColor = keyof typeof courtColors\n\n`;
ts += `/** Lookup helper: accepts any string and returns the court color or undefined */\n`;
ts += `export function getCourtColor(court: string): string | undefined {\n`;
ts += `  return (courtColors as Record<string, string>)[court]\n`;
ts += `}\n\n`;

// Semantic colors
ts += `export const semanticColors = {\n`;
for (const [key, color] of Object.entries(
  tokens.color.semantic as Record<string, string>,
)) {
  ts += `  ${key}: "${color}",\n`;
}
ts += `} as const\n\n`;
ts += `export type SemanticColor = keyof typeof semanticColors\n\n`;

// Spacing
ts += `export const spacing = {\n`;
for (const [key, value] of Object.entries(
  tokens.spacing as Record<string, string>,
)) {
  ts += `  "${key}": "${value}",\n`;
}
ts += `} as const\n\n`;

// Radius
ts += `export const radius = {\n`;
for (const [key, value] of Object.entries(
  tokens.radius as Record<string, string>,
)) {
  ts += `  ${key}: "${value}",\n`;
}
ts += `} as const\n\n`;

// Shadow
ts += `export const shadow = {\n`;
for (const [key, value] of Object.entries(
  tokens.shadow as Record<string, string>,
)) {
  ts += `  ${key}: "${value}",\n`;
}
ts += `} as const\n\n`;

// zIndex
if (tokens.zIndex) {
  ts += `export const zIndex = {\n`;
  for (const [key, value] of Object.entries(
    tokens.zIndex as Record<string, string>,
  )) {
    ts += `  ${key}: "${value}",\n`;
  }
  ts += `} as const\n\n`;
}

// opacity
if (tokens.opacity) {
  ts += `export const opacity = {\n`;
  for (const [key, value] of Object.entries(
    tokens.opacity as Record<string, string>,
  )) {
    ts += `  "${key}": "${value}",\n`;
  }
  ts += `} as const\n\n`;
}

// animationDuration
if (tokens.animation?.duration) {
  ts += `export const animationDuration = {\n`;
  for (const [key, value] of Object.entries(
    tokens.animation.duration as Record<string, string>,
  )) {
    ts += `  ${key}: "${value}",\n`;
  }
  ts += `} as const\n\n`;
}

// animationEasing
if (tokens.animation?.easing) {
  ts += `export const animationEasing = {\n`;
  for (const [key, value] of Object.entries(
    tokens.animation.easing as Record<string, string>,
  )) {
    ts += `  "${key}": "${value}",\n`;
  }
  ts += `} as const\n\n`;
}

writeFileSync(resolve(__dirname_resolved, "../src/tokens/tokens.ts"), ts);

console.log("✓ tokens.css generated");
console.log("✓ tokens.ts generated");
if (validationWarnings.length > 0) {
  console.log(
    `  (${validationWarnings.length} validation warning(s) — see above)`,
  );
}
