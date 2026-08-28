/**
 * Shared colour utilities — OKLCH-based perceptually uniform tones and
 * WCAG contrast maths.
 *
 * Single source of truth: imported by `@/pages/DesignTokensPage` (the design
 * showcase) and by `__tests__/css-tokens.test.ts` (the token contrast gate).
 * Both must use the same implementation, otherwise the test can pass against
 * maths the app never runs.
 */

export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  ];
}

export function rgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToRgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// sRGB → Linear RGB → XYZ-D65 → Oklab
export function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = rgbToLinear(r);
  const lg = rgbToLinear(g);
  const lb = rgbToLinear(b);
  // Linear RGB → LMS
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  // Cube root
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

export function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  const rr = linearToRgb(
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
  );
  const gg = linearToRgb(
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
  );
  const bb = linearToRgb(
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  );
  return [
    Math.max(0, Math.min(1, rr)),
    Math.max(0, Math.min(1, gg)),
    Math.max(0, Math.min(1, bb)),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (c: number) =>
    Math.round(Math.max(0, Math.min(255, c * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Generate perceptually uniform color tones using Oklab color space.
 * Returns `count` (default 8) hex strings from lightest to darkest.
 */
export function generateTones(hex: string, count = 8): string[] {
  const rgb = hexToRgb(hex);
  if (!rgb) return Array(count).fill(hex);
  const [oL, oA, oB] = rgbToOklab(...rgb);
  const tones: string[] = [];
  const lightL = 0.96;
  const darkL = 0.15;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1); // 0 = lightest, 1 = darkest
    const L = lightL + t * (darkL - lightL);
    const chromaScale =
      L < oL ? L / Math.max(oL, 0.01) : (1 - L) / Math.max(1 - oL, 0.01);
    const scaledA = oA * Math.min(chromaScale * 1.2, 1.5);
    const scaledB = oB * Math.min(chromaScale * 1.2, 1.5);
    const [r, g, b] = oklabToRgb(L, scaledA, scaledB);
    tones.push(rgbToHex(r, g, b));
  }
  return tones;
}

export function getLuminance(h: string): number {
  const rgb = hexToRgb(h);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map(rgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export type WcagLevel = "AAA" | "AA" | "AA Large" | "Fail";
export function getWcagLevel(ratio: number): WcagLevel {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA Large";
  return "Fail";
}

// ── Color Blindness Simulation ────────────────────────────
// Based on Brettel et al. (1997) and Viénot et al. (1999) algorithms
export type ColorBlindType =
  | "protanopia"
  | "deuteranopia"
  | "tritanopia"
  | "achromatopsia";

export function simulateColorBlindness(hex: string, type: ColorBlindType): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb.map((c) => rgbToLinear(c));

  let sr: number, sg: number, sb: number;

  switch (type) {
    case "protanopia": // Red-blind
      sr = 0.0 * r + 2.02344 * g + -2.52581 * b;
      sg = 0.0 * r + 1.0 * g + 0.0 * b;
      sb = 0.0 * r + 0.0 * g + 1.0 * b;
      sr = Math.max(0, sr);
      sg = Math.max(0, sg);
      sb = Math.max(0, sb);
      break;
    case "deuteranopia": // Green-blind
      sr = 1.0 * r + 0.0 * g + 0.0 * b;
      sg = 0.494207 * r + 0.0 * g + 1.24827 * b;
      sb = 0.0 * r + 0.0 * g + 1.0 * b;
      sr = Math.max(0, sr);
      sg = Math.max(0, sg);
      sb = Math.max(0, sb);
      break;
    case "tritanopia": // Blue-blind
      sr = 1.0 * r + 0.0 * g + 0.0 * b;
      sg = 0.0 * r + 1.0 * g + 0.0 * b;
      sb = -0.395913 * r + 0.801109 * g + 0.0 * b;
      sr = Math.max(0, sr);
      sg = Math.max(0, sg);
      sb = Math.max(0, sb);
      break;
    case "achromatopsia": {
      // Total color blindness - luminance only
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sr = sg = sb = lum;
      break;
    }
    default:
      sr = r;
      sg = g;
      sb = b;
  }

  return rgbToHex(
    linearToRgb(Math.min(1, sr)),
    linearToRgb(Math.min(1, sg)),
    linearToRgb(Math.min(1, sb)),
  );
}
