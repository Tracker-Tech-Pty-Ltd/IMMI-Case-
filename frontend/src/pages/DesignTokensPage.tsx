import { useState, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Scale,
  FileText,
  Loader2,
  Search,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Save,
  Type,
  Download,
  Upload,
} from "lucide-react";
import { tokens, courtColors, semanticColors } from "@/tokens/tokens";
import { CourtBadge } from "@/components/shared/CourtBadge";
import { OutcomeBadge } from "@/components/shared/OutcomeBadge";
import { StatCard } from "@/components/dashboard/StatCard";
import { CaseCard } from "@/components/cases/CaseCard";
import {
  useThemePreset,
  PRESETS,
  type PresetName,
} from "@/hooks/use-theme-preset";
import { cn } from "@/lib/utils";
import type { ImmigrationCase } from "@/types/case";

/* ═══════════════════════════════════════════════════════════════
   Color Utilities — OKLCH-based perceptually uniform tones
   ═══════════════════════════════════════════════════════════════ */

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  ];
}

function rgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToRgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// sRGB → Linear RGB → XYZ-D65 → Oklab
function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
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

function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
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

function rgbToHex(r: number, g: number, b: number): string {
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
function generateTones(hex: string, count = 8): string[] {
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

/** Tone labels matching the 8-step scale (50→900) */
const TONE_LABELS = [
  "50",
  "100",
  "200",
  "300",
  "500",
  "600",
  "700",
  "900",
] as const;

/** Convert raw hex[] from generateTones() to labelled objects for ToneGrid */
function toLabelled(hexes: string[]): { label: string; hex: string }[] {
  return hexes.map((h, i) => ({ label: TONE_LABELS[i] ?? String(i), hex: h }));
}

// ── WCAG helpers ────────────────────────────────────────────
function getLuminance(h: string): number {
  const rgb = hexToRgb(h);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map(rgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1);
  const l2 = getLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

type WcagLevel = "AAA" | "AA" | "AA Large" | "Fail";
function getWcagLevel(ratio: number): WcagLevel {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA Large";
  return "Fail";
}

function getCssVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

// ── Color Blindness Simulation ────────────────────────────
// Based on Brettel et al. (1997) and Viénot et al. (1999) algorithms
type ColorBlindType =
  | "protanopia"
  | "deuteranopia"
  | "tritanopia"
  | "achromatopsia";

function simulateColorBlindness(hex: string, type: ColorBlindType): string {
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

/* ═══════════════════════════════════════════════════════════════
   Base Color Lookup (preset defaults before custom overrides)
   ═══════════════════════════════════════════════════════════════ */

const DEFAULT_LIGHT: Record<string, string> = {
  "--color-primary": tokens.color.primary.DEFAULT,
  "--color-accent": tokens.color.accent.DEFAULT,
  "--color-background": tokens.color.background.DEFAULT,
  "--color-background-card": tokens.color.background.card,
  "--color-background-surface": tokens.color.background.surface,
  "--color-border": tokens.color.border.DEFAULT,
  "--color-text": tokens.color.text.DEFAULT,
  "--color-text-secondary": tokens.color.text.secondary,
  "--color-text-muted": tokens.color.text.muted,
};
const DEFAULT_DARK: Record<string, string> = {
  "--color-primary": tokens.color.dark.primary.DEFAULT,
  "--color-accent": tokens.color.dark.accent.DEFAULT,
  "--color-background": tokens.color.dark.background.DEFAULT,
  "--color-background-card": tokens.color.dark.background.card,
  "--color-background-surface": tokens.color.dark.background.surface,
  "--color-border": tokens.color.dark.border.DEFAULT,
  "--color-text": tokens.color.dark.text.DEFAULT,
  "--color-text-secondary": tokens.color.dark.text.secondary,
  "--color-text-muted": tokens.color.dark.text.muted,
};

function getBaseColor(
  preset: PresetName,
  isDark: boolean,
  cssVar: string,
): string {
  const p = PRESETS[preset];
  const presetVars = isDark ? p.darkVars : p.vars;
  if (presetVars[cssVar]) return presetVars[cssVar];
  const defaults = isDark ? DEFAULT_DARK : DEFAULT_LIGHT;
  return defaults[cssVar] || "";
}

/* ═══════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════ */

const COLOR_GROUPS = [
  { title: "主色", cssVar: "--color-primary" },
  { title: "強調色", cssVar: "--color-accent" },
  { title: "背景", cssVar: "--color-background" },
  { title: "卡片背景", cssVar: "--color-background-card" },
  { title: "表面背景", cssVar: "--color-background-surface" },
  { title: "邊框", cssVar: "--color-border" },
  { title: "主要文字", cssVar: "--color-text" },
  { title: "弱化文字", cssVar: "--color-text-muted" },
];

// Court colors — use hex values directly (CSS vars are lowercase)
const COURT_GROUPS = Object.entries(courtColors).map(([name, hex]) => ({
  title: name,
  cssVar: `--color-court-${name.toLowerCase()}`,
  hex,
}));

// Semantic colors — these have matching CSS vars consumed by the UI
const SEMANTIC_GROUPS: { title: string; hex: string; cssVar: string }[] = [
  {
    title: "成功",
    hex: semanticColors.success,
    cssVar: "--color-semantic-success",
  },
  {
    title: "警告",
    hex: semanticColors.warning,
    cssVar: "--color-semantic-warning",
  },
  {
    title: "危險",
    hex: semanticColors.danger,
    cssVar: "--color-semantic-danger",
  },
  { title: "資訊", hex: semanticColors.info, cssVar: "--color-semantic-info" },
];

// Creative palette — for charts and illustrations (copy-only, no live override)
const CREATIVE_COLORS: { title: string; hex: string }[] = [
  { title: "珊瑚", hex: "#e76f51" },
  { title: "青綠", hex: "#2a9d8f" },
  { title: "靛藍", hex: "#5c6bc0" },
  { title: "金色", hex: "#c9942e" },
];

const FONT_OPTIONS = [
  {
    label: "Inter",
    value: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
    style: "現代無襯線",
  },
  {
    label: "DM Sans",
    value: "'DM Sans', sans-serif",
    style: "幾何風、親和",
  },
  {
    label: "IBM Plex Sans",
    value: "'IBM Plex Sans', sans-serif",
    style: "專業、中性",
  },
  {
    label: "Source Serif 4",
    value: "'Source Serif 4', Georgia, serif",
    style: "優雅襯線",
  },
  {
    label: "Merriweather",
    value: "Merriweather, Georgia, serif",
    style: "穩重、易讀",
  },
];

const SPACING_SCALE = [
  { key: "1", value: "0.25rem", px: "4px" },
  { key: "2", value: "0.5rem", px: "8px" },
  { key: "3", value: "0.75rem", px: "12px" },
  { key: "4", value: "1rem", px: "16px" },
  { key: "5", value: "1.25rem", px: "20px" },
  { key: "6", value: "1.5rem", px: "24px" },
  { key: "8", value: "2rem", px: "32px" },
];

const RADIUS_SCALE = [
  { key: "none", value: "0", label: "無" },
  { key: "xs", value: "0.25rem", label: "特小" },
  { key: "sm", value: "0.5rem", label: "小" },
  { key: "token-sm", value: tokens.radius.sm, label: "代碼小" },
  { key: "default", value: tokens.radius.DEFAULT, label: "預設" },
  { key: "token-lg", value: tokens.radius.lg, label: "代碼大" },
  { key: "pill", value: tokens.radius.pill, label: "膠囊" },
  { key: "full", value: "9999px", label: "全圓" },
];

const SHADOW_DEMOS = [
  { key: "xs", label: "特小", value: tokens.shadow.xs },
  { key: "sm", label: "小", value: tokens.shadow.sm },
  { key: "md", label: "中", value: tokens.shadow.DEFAULT },
  { key: "lg", label: "大", value: tokens.shadow.lg },
];

/* ═══════════════════════════════════════════════════════════════
   Generic Helpers
   ═══════════════════════════════════════════════════════════════ */

function copyToClipboard(text: string, label?: string) {
  navigator.clipboard.writeText(text);
  toast.success(`已複製：${label ?? text}`);
}

function SectionHeading({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="mb-4 scroll-mt-20 font-heading text-xl font-semibold"
    >
      {children}
    </h2>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-sm font-medium text-muted-text">{children}</h3>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 1: Theme Preset Switcher
   ═══════════════════════════════════════════════════════════════ */

function ThemePresetSwitcher() {
  const { preset, isDark, setPreset, toggleDark } = useThemePreset();

  return (
    <section>
      <SectionHeading id="theme">主題預設</SectionHeading>
      <p className="mb-4 text-sm text-muted-text">
        點選預設可切換全站主題顏色。切換預設時，下方的自訂顏色覆寫會一併清除。
      </p>

      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={toggleDark}
          className={cn(
            "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors",
            isDark ? "bg-accent" : "bg-border",
          )}
          role="switch"
          aria-checked={isDark}
          aria-pressed={isDark}
          aria-label={isDark ? "切換至淺色模式" : "切換至深色模式"}
        >
          <span
            className={cn(
              "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
              isDark ? "translate-x-6" : "translate-x-1",
            )}
          />
        </button>
        <span className="text-sm font-medium text-foreground">
          {isDark ? "深色模式" : "淺色模式"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {(
          Object.entries(PRESETS) as [
            PresetName,
            (typeof PRESETS)[PresetName],
          ][]
        ).map(([name, p]) => {
          const active = preset === name;
          const dots = isDark ? p.darkColors : p.colors;
          return (
            <button
              key={name}
              onClick={() => setPreset(name)}
              aria-label={`套用 ${p.label} 主題`}
              aria-pressed={active}
              className={cn(
                "relative flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-all",
                active
                  ? "border-accent bg-card shadow-md"
                  : "border-border bg-card hover:border-accent/40 hover:shadow-sm",
              )}
            >
              {active && (
                <div className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
                  <Check className="h-3 w-3" />
                </div>
              )}
              <div className="flex gap-1">
                {dots.map((c, i) => (
                  <div
                    key={i}
                    className="h-6 w-6 rounded-full border border-black/10"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <span className="text-sm font-medium text-foreground">
                {p.label}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 2: Color Palette (8 tones per group, clickable)
   ═══════════════════════════════════════════════════════════════ */

function handleToneKeyDown(
  e: React.KeyboardEvent<HTMLButtonElement>,
  index: number,
  groupId: string,
) {
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault();
    const next = document.querySelector(
      `[data-tone-group="${groupId}"][data-tone-index="${index + 1}"]`,
    ) as HTMLElement | null;
    next?.focus();
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    const prev = document.querySelector(
      `[data-tone-group="${groupId}"][data-tone-index="${index - 1}"]`,
    ) as HTMLElement | null;
    prev?.focus();
  }
}

function ToneGrid({
  title,
  tones,
  cssVar,
  activeHex,
  onSelect,
}: {
  title: string;
  tones: { label: string; hex: string }[];
  cssVar: string;
  activeHex: string | undefined;
  onSelect: (cssVar: string, hex: string, title: string) => void;
}) {
  const groupId = cssVar.replace(/[^a-zA-Z0-9-]/g, "_");
  return (
    <div className="mb-5">
      <SubHeading>{title}</SubHeading>
      <div
        role="group"
        aria-label={`${title} 色階`}
        className="grid grid-cols-4 gap-2 sm:grid-cols-8"
      >
        {tones.map((tone, index) => {
          const isActive = activeHex?.toLowerCase() === tone.hex.toLowerCase();
          return (
            <button
              key={tone.label}
              type="button"
              onClick={() => onSelect(cssVar, tone.hex, title)}
              onKeyDown={(e) => handleToneKeyDown(e, index, groupId)}
              data-tone-group={groupId}
              data-tone-index={index}
              aria-label={`${tone.label} 色階：${tone.hex}`}
              title={`${tone.label}：${tone.hex}`}
              className={cn(
                "group relative rounded-lg border-2 p-2 text-left transition-all",
                isActive
                  ? "border-accent shadow-md ring-2 ring-accent/30"
                  : "border-border hover:border-accent/40 hover:shadow-sm",
              )}
            >
              {isActive && (
                <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white">
                  <Check className="h-2.5 w-2.5" />
                </div>
              )}
              <div
                className="mb-1.5 h-10 w-full rounded-md border border-black/10"
                style={{ backgroundColor: tone.hex }}
              />
              <p className="text-[10px] font-medium text-foreground">
                {tone.label}
              </p>
              <p className="font-mono text-[9px] text-muted-text">{tone.hex}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ColorPalette() {
  const { preset, isDark, customVars, setCustomVar } = useThemePreset();

  const baseColors = useMemo(() => {
    const result: Record<string, string> = {};
    for (const g of COLOR_GROUPS) {
      result[g.cssVar] = getBaseColor(preset, isDark, g.cssVar);
    }
    return result;
  }, [preset, isDark]);

  function handleSelect(cssVar: string, hex: string, title: string) {
    setCustomVar(cssVar, hex);
    toast.success(`${title} 已設定為 ${hex}`);
  }

  return (
    <section>
      <SectionHeading id="colors">色彩面板</SectionHeading>
      <p className="mb-4 text-sm text-muted-text">
        點選任何色階會即時套用至整個介面。每組顏色提供 8
        個色階，已啟用色彩會高亮顯示。
      </p>

      {COLOR_GROUPS.map((group) => {
        const base = baseColors[group.cssVar];
        if (!base || base.startsWith("rgba")) return null;
        const tones = toLabelled(generateTones(base));
        const activeHex = customVars[group.cssVar];

        return (
          <ToneGrid
            key={group.cssVar}
            title={group.title}
            tones={tones}
            cssVar={group.cssVar}
            activeHex={activeHex}
            onSelect={handleSelect}
          />
        );
      })}

      {/* Court Colors */}
      <div className="mt-8 mb-5">
        <h3 className="mb-3 text-base font-semibold text-foreground">
          法院顏色
        </h3>
        <p className="mb-4 text-sm text-muted-text">
          每個法院都有專屬顏色。點選任一色階即可複製十六進位顏色值。
        </p>
        {COURT_GROUPS.map((court) => {
          const tones = toLabelled(generateTones(court.hex));
          return (
            <div key={court.title} className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <CourtBadge court={court.title} />
                <span className="font-mono text-xs text-muted-text">
                  {court.hex}
                </span>
              </div>
              <div
                role="group"
                aria-label={`${court.title} 法院色階`}
                className="grid grid-cols-4 gap-2 sm:grid-cols-8"
              >
                {tones.map((tone, index) => (
                  <button
                    key={tone.label}
                    type="button"
                    onClick={() =>
                      copyToClipboard(tone.hex, `${court.title} ${tone.label}`)
                    }
                    onKeyDown={(e) =>
                      handleToneKeyDown(
                        e,
                        index,
                        `court-${court.title.toLowerCase()}`,
                      )
                    }
                    data-tone-group={`court-${court.title.toLowerCase()}`}
                    data-tone-index={index}
                    aria-label={`複製 ${court.title} ${tone.label} 色階顏色值 ${tone.hex}`}
                    title={`${court.title} ${tone.label}：${tone.hex}`}
                    className="group rounded-lg border border-border p-2 text-left transition-all hover:border-accent/40 hover:shadow-sm"
                  >
                    <div
                      className="mb-1.5 h-10 w-full rounded-md border border-black/10"
                      style={{ backgroundColor: tone.hex }}
                    />
                    <p className="text-[10px] font-medium text-foreground">
                      {tone.label}
                    </p>
                    <p className="font-mono text-[9px] text-muted-text">
                      {tone.hex}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Semantic Colors (functional — these override live UI) */}
      <div className="mt-8 mb-5">
        <h3 className="mb-3 text-base font-semibold text-foreground">
          語意顏色
        </h3>
        <p className="mb-4 text-sm text-muted-text">
          核心狀態顏色。點選任一色階可即時套用到介面。
        </p>
        {SEMANTIC_GROUPS.map((sg) => {
          const tones = toLabelled(generateTones(sg.hex));
          const activeHex = customVars[sg.cssVar];

          return (
            <ToneGrid
              key={sg.cssVar}
              title={sg.title}
              tones={tones}
              cssVar={sg.cssVar}
              activeHex={activeHex}
              onSelect={handleSelect}
            />
          );
        })}
      </div>

      {/* Creative Colors (reference only — click to copy hex) */}
      <div className="mt-8 mb-5">
        <h3 className="mb-3 text-base font-semibold text-foreground">
          創意配色
        </h3>
        <p className="mb-4 text-sm text-muted-text">
          適用於圖表與插圖的輔助色盤。點選任一色階即可複製十六進位顏色值。
        </p>
        {CREATIVE_COLORS.map((cc) => {
          const tones = toLabelled(generateTones(cc.hex));
          return (
            <div key={cc.title} className="mb-5">
              <SubHeading>{cc.title}</SubHeading>
              <div
                role="group"
                aria-label={`${cc.title} 創意配色色階`}
                className="grid grid-cols-4 gap-2 sm:grid-cols-8"
              >
                {tones.map((tone, index) => (
                  <button
                    key={tone.label}
                    type="button"
                    onClick={() =>
                      copyToClipboard(tone.hex, `${cc.title} ${tone.label}`)
                    }
                    onKeyDown={(e) =>
                      handleToneKeyDown(e, index, `creative-${cc.title}`)
                    }
                    data-tone-group={`creative-${cc.title}`}
                    data-tone-index={index}
                    aria-label={`複製 ${cc.title} ${tone.label} 色階顏色值 ${tone.hex}`}
                    title={`${cc.title} ${tone.label}：${tone.hex}`}
                    className="group rounded-lg border border-border p-2 text-left transition-all hover:border-accent/40 hover:shadow-sm"
                  >
                    <div
                      className="mb-1.5 h-10 w-full rounded-md border border-black/10"
                      style={{ backgroundColor: tone.hex }}
                    />
                    <p className="text-[10px] font-medium text-foreground">
                      {tone.label}
                    </p>
                    <p className="font-mono text-[9px] text-muted-text">
                      {tone.hex}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 3: Typography + Font Picker
   ═══════════════════════════════════════════════════════════════ */

const FONT_SIZES = [
  { label: "xs", cls: "text-xs", px: "12px" },
  { label: "sm", cls: "text-sm", px: "14px" },
  { label: "base", cls: "text-base", px: "16px" },
  { label: "lg", cls: "text-lg", px: "18px" },
  { label: "xl", cls: "text-xl", px: "20px" },
  { label: "2xl", cls: "text-2xl", px: "24px" },
  { label: "3xl", cls: "text-3xl", px: "30px" },
];
const FONT_WEIGHTS = [
  { label: "纖細", weight: 300, cls: "font-light" },
  { label: "常規", weight: 400, cls: "font-normal" },
  { label: "中等", weight: 500, cls: "font-medium" },
  { label: "半粗", weight: 600, cls: "font-semibold" },
  { label: "粗體", weight: 700, cls: "font-bold" },
];

function TypographySection() {
  const { customVars, setCustomVar } = useThemePreset();
  const activeFont = customVars["--font-body"] || "";

  return (
    <section>
      <SectionHeading id="typography">字體排版</SectionHeading>

      {/* Font Picker */}
      <SubHeading>內文字型</SubHeading>
      <p className="mb-3 text-sm text-muted-text">
        點選字型會即時套用到全站。你的選擇會自動儲存。
      </p>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {FONT_OPTIONS.map((f) => {
          const isActive =
            activeFont === f.value ||
            (!activeFont && f.label === "Merriweather");
          return (
            <button
              key={f.label}
              onClick={() => {
                setCustomVar("--font-body", f.value);
                toast.success(`字型已切換為 ${f.label}`);
              }}
              className={cn(
                "relative rounded-lg border-2 p-4 text-left transition-all",
                isActive
                  ? "border-accent bg-card shadow-md ring-2 ring-accent/30"
                  : "border-border bg-card hover:border-accent/40 hover:shadow-sm",
              )}
            >
              {isActive && (
                <div className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white">
                  <Check className="h-3 w-3" />
                </div>
              )}
              <div className="mb-1 flex items-center gap-2">
                <Type className="h-4 w-4 text-accent" />
                <span className="text-sm font-semibold text-foreground">
                  {f.label}
                </span>
              </div>
              <p
                className="mb-1 text-lg leading-snug text-foreground"
                style={{ fontFamily: f.value }}
              >
                香港移民案例分析示例
              </p>
              <p className="text-[10px] text-muted-text">{f.style}</p>
            </button>
          );
        })}
      </div>

      {/* Size Scale */}
      <SubHeading>字級比例</SubHeading>
      <div className="mb-6 space-y-2">
        {FONT_SIZES.map((s) => (
          <div key={s.label} className="flex items-baseline gap-4">
            <span className="w-12 shrink-0 text-right font-mono text-xs text-muted-text">
              {s.label}
            </span>
            <span className="w-10 shrink-0 font-mono text-[10px] text-muted-text/70">
              {s.px}
            </span>
            <span className={s.cls}>移民法重點概念</span>
          </div>
        ))}
      </div>

      {/* Weight Scale */}
      <SubHeading>字重比例</SubHeading>
      <div className="space-y-2">
        {FONT_WEIGHTS.map((w) => (
          <div key={w.label} className="flex items-baseline gap-4">
            <span className="w-20 shrink-0 text-right font-mono text-xs text-muted-text">
              {w.weight}
            </span>
            <span className={`text-base ${w.cls}`}>
              {w.label} — 移民決定覆核
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 4: Spacing Scale (10 values, clickable + live preview)
   ═══════════════════════════════════════════════════════════════ */

function SpacingSection() {
  const [selectedSpacing, setSelectedSpacing] = useState("1rem");

  return (
    <section>
      <SectionHeading id="spacing">間距</SectionHeading>
      <p className="mb-4 text-sm text-muted-text">
        點選任一間距值，可在下方即時預覽版面效果。
      </p>
      <div className="mb-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
        {SPACING_SCALE.map((s) => {
          const active = selectedSpacing === s.value;
          return (
            <button
              key={s.key}
              onClick={() => setSelectedSpacing(s.value)}
              className={cn(
                "flex flex-col items-center rounded-lg border-2 p-2 transition-all",
                active
                  ? "border-accent bg-accent-muted shadow-md"
                  : "border-border bg-card hover:border-accent/40",
              )}
            >
              <div
                className="mb-1 rounded border border-accent/40 bg-accent/20"
                style={{
                  width: s.value,
                  height: s.value,
                  maxWidth: "2.5rem",
                  maxHeight: "2.5rem",
                }}
              />
              <span className="text-[10px] font-medium text-foreground">
                {s.key}
              </span>
              <span className="font-mono text-[9px] text-muted-text">
                {s.px}
              </span>
            </button>
          );
        })}
      </div>

      <SubHeading>即時預覽（間隔：{selectedSpacing}）</SubHeading>
      <div
        className="rounded-lg border border-border bg-card transition-all"
        style={{ padding: selectedSpacing }}
      >
        <div
          className="flex flex-wrap transition-all"
          style={{ gap: selectedSpacing }}
        >
          {["卡片 A", "卡片 B", "卡片 C"].map((label) => (
            <div
              key={label}
              className="rounded-md border border-accent/30 bg-accent-muted transition-all"
              style={{ padding: selectedSpacing }}
            >
              <span className="text-xs font-medium text-foreground">
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 5: Border Radius (8 values, clickable + live apply)
   ═══════════════════════════════════════════════════════════════ */

function RadiusSection() {
  const { setCustomVar, customVars } = useThemePreset();
  const activeRadius = customVars["--radius"] || "";

  function handleRadiusSelect(value: string) {
    const rem = parseFloat(value) || 0;
    if (value === "9999px") {
      setCustomVar("--radius-sm", "9999px");
      setCustomVar("--radius", "9999px");
      setCustomVar("--radius-lg", "9999px");
    } else if (rem === 0) {
      setCustomVar("--radius-sm", "0");
      setCustomVar("--radius", "0");
      setCustomVar("--radius-lg", "0");
    } else {
      setCustomVar(
        "--radius-sm",
        `${Math.max(0.0625, rem * 0.67).toFixed(3)}rem`,
      );
      setCustomVar("--radius", value);
      setCustomVar("--radius-lg", `${(rem * 1.33).toFixed(3)}rem`);
    }
    toast.success(`圓角已設定為 ${value}`);
  }

  return (
    <section>
      <SectionHeading id="radius">邊角圓角</SectionHeading>
      <p className="mb-4 text-sm text-muted-text">
        點選圓角值即可即時套用。系統會按比例調整全站 `sm`、`預設`、`lg` 圓角。
      </p>
      <div className="mb-4 grid grid-cols-4 gap-3 sm:grid-cols-8">
        {RADIUS_SCALE.map((r) => {
          const active = activeRadius
            ? activeRadius === r.value
            : r.value === tokens.radius.DEFAULT;
          return (
            <button
              key={r.key}
              onClick={() => handleRadiusSelect(r.value)}
              className={cn(
                "flex flex-col items-center rounded-lg border-2 p-3 transition-all",
                active
                  ? "border-accent bg-accent-muted shadow-md"
                  : "border-border bg-card hover:border-accent/40",
              )}
            >
              <div
                className="mb-2 h-12 w-12 border-2 border-accent bg-accent-muted"
                style={{ borderRadius: r.value }}
              />
              <span className="text-[10px] font-bold text-foreground">
                {r.label}
              </span>
              <span className="font-mono text-[9px] text-muted-text">
                {r.value}
              </span>
            </button>
          );
        })}
      </div>

      <SubHeading>即時預覽</SubHeading>
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="bg-accent px-4 py-2 text-sm font-medium text-white"
          style={{ borderRadius: activeRadius || tokens.radius.DEFAULT }}
        >
          按鈕
        </button>
        <input
          className="border border-border bg-card px-3 py-2 text-sm text-foreground"
          style={{ borderRadius: activeRadius || tokens.radius.DEFAULT }}
          placeholder="輸入欄位"
          aria-label="輸入欄位預覽"
          readOnly
        />
        <div
          className="border border-border bg-card p-4"
          style={{ borderRadius: activeRadius || tokens.radius.DEFAULT }}
        >
          <span className="text-xs text-foreground">卡片元素</span>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 6: Shadows (fixed with visible contrast)
   ═══════════════════════════════════════════════════════════════ */

function ShadowSection() {
  const { isDark } = useThemePreset();
  // Use a contrasting bg so shadows are clearly visible
  const stageBg = isDark ? "#0d1117" : "#e8e6e1";

  return (
    <section>
      <SectionHeading id="shadows">陰影</SectionHeading>
      <p className="mb-4 text-sm text-muted-text">
        陰影層級由細緻到明顯。滑過卡片可觀察陰影動態，並以高對比底板加強可視性。
      </p>
      <div className="rounded-xl p-6" style={{ backgroundColor: stageBg }}>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {SHADOW_DEMOS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => copyToClipboard(s.value, `shadow-${s.key}`)}
              aria-label={`複製陰影值 shadow-${s.key} 到剪貼簿`}
              title={`複製 shadow-${s.key}`}
              className="group rounded-lg bg-white p-6 text-center transition-all duration-300 dark:bg-[#1b2332]"
              style={{ boxShadow: s.value }}
            >
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {s.label}
              </p>
              <p className="mt-1 font-mono text-[10px] text-gray-500 dark:text-gray-400">
                --shadow{s.key === "md" ? "" : `-${s.key}`}
              </p>
              <div className="mt-3 flex justify-center">
                <Copy className="h-3.5 w-3.5 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Interactive shadow comparison */}
      <div className="mt-4 flex flex-wrap items-end gap-4">
        {SHADOW_DEMOS.map((s) => (
          <div
            key={`bar-${s.key}`}
            className="flex flex-col items-center gap-1"
          >
            <div
              className="rounded bg-white transition-shadow dark:bg-[#1b2332]"
              style={{
                boxShadow: s.value,
                width: "3rem",
                height: `${(["xs", "sm", "md", "lg"].indexOf(s.key) + 1) * 1.5}rem`,
              }}
            />
            <span className="font-mono text-[9px] text-muted-text">
              {s.key}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 7: Animation Tokens
   ═══════════════════════════════════════════════════════════════ */

const DURATION_DEMOS = [
  {
    key: "fast",
    label: "快速 (150ms)",
    cssVar: "var(--duration-fast)",
    ms: "150ms",
  },
  {
    key: "normal",
    label: "正常 (300ms)",
    cssVar: "var(--duration-normal)",
    ms: "300ms",
  },
  {
    key: "slow",
    label: "緩慢 (500ms)",
    cssVar: "var(--duration-slow)",
    ms: "500ms",
  },
];

const EASING_DEMOS = [
  {
    key: "ease-in",
    label: "ease-in",
    cssVar: "var(--ease-in)",
    value: "cubic-bezier(0.4, 0, 1, 1)",
    desc: "加速進入",
  },
  {
    key: "ease-out",
    label: "ease-out",
    cssVar: "var(--ease-out)",
    value: "cubic-bezier(0, 0, 0.2, 1)",
    desc: "減速離開",
  },
  {
    key: "ease-in-out",
    label: "ease-in-out",
    cssVar: "var(--ease-in-out)",
    value: "cubic-bezier(0.4, 0, 0.2, 1)",
    desc: "先加速後減速",
  },
];

function AnimationSection() {
  return (
    <section>
      <SectionHeading id="animation">動畫令牌</SectionHeading>
      <p className="mb-4 text-sm text-muted-text">
        動畫時長與緩動曲線。滑過卡片可觀察實際動畫效果。
      </p>

      {/* Duration */}
      <SubHeading>時長</SubHeading>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {DURATION_DEMOS.map((d) => (
          <div
            key={d.key}
            className="overflow-hidden rounded-lg border border-border bg-card p-4"
          >
            <p className="mb-1 text-sm font-semibold text-foreground">
              {d.label}
            </p>
            <p className="mb-3 font-mono text-[11px] text-muted-text">
              --duration-{d.key}
            </p>
            {/* Sliding bar demo */}
            <div className="relative h-8 overflow-hidden rounded-md bg-surface">
              <div
                className="absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full bg-accent"
                style={
                  {
                    transition: `transform ${d.ms} var(--ease-out, cubic-bezier(0, 0, 0.2, 1))`,
                    "--hover-translate": "calc(100% + 4px)",
                  } as React.CSSProperties
                }
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.transform =
                    "translateX(calc(100% + 4px)) translateY(-50%)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.transform =
                    "translateX(0) translateY(-50%)";
                }}
              />
            </div>
            <p className="mt-2 text-[10px] text-muted-text">滑入/出上方圓點</p>
          </div>
        ))}
      </div>

      {/* Easing */}
      <SubHeading>緩動曲線</SubHeading>
      <div className="grid gap-4 sm:grid-cols-3">
        {EASING_DEMOS.map((e) => (
          <div
            key={e.key}
            className="overflow-hidden rounded-lg border border-border bg-card p-4"
          >
            <p className="mb-1 text-sm font-semibold text-foreground">
              {e.label}
            </p>
            <p className="mb-1 text-xs text-muted-text">{e.desc}</p>
            {/* Animated dot on line */}
            <div className="relative mb-2 h-8">
              <div className="absolute top-1/2 h-0.5 w-full -translate-y-1/2 rounded-full bg-border" />
              <div
                className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-accent shadow-sm"
                style={{
                  transition: `left 300ms ${e.value}`,
                  left: "0%",
                }}
                onMouseEnter={(el) => {
                  (el.currentTarget as HTMLElement).style.left =
                    "calc(100% - 1rem)";
                }}
                onMouseLeave={(el) => {
                  (el.currentTarget as HTMLElement).style.left = "0%";
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(e.value, e.label)}
              aria-label={`複製 ${e.label} 緩動值到剪貼簿`}
              className="mt-1 w-full rounded bg-surface px-2 py-1 text-left font-mono text-[10px] text-muted-text hover:bg-accent/10 hover:text-accent"
            >
              {e.value}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 8: Z-Index Tokens
   ═══════════════════════════════════════════════════════════════ */

const Z_LAYERS = [
  { token: "--z-base", value: "0", label: "基礎層", desc: "Base content" },
  {
    token: "--z-dropdown",
    value: "50",
    label: "下拉選單",
    desc: "Dropdowns",
  },
  {
    token: "--z-popover",
    value: "100",
    label: "彈出層",
    desc: "Popovers",
  },
  {
    token: "--z-tooltip",
    value: "150",
    label: "提示層",
    desc: "Tooltips",
  },
  { token: "--z-modal", value: "999", label: "模態視窗", desc: "Modals" },
  {
    token: "--z-toast",
    value: "1000",
    label: "通知層",
    desc: "Toasts/Alerts",
  },
];

// Color intensities for layer levels (lightest → darkest left border)
const Z_BORDER_COLORS = [
  "#c8d6e5",
  "#7ea4c1",
  "#4a7fa5",
  "#2b5f8a",
  "#1a4470",
  "#0d2b52",
];

function ZIndexSection() {
  return (
    <section>
      <SectionHeading id="zindex">層級順序</SectionHeading>
      <p className="mb-4 text-sm text-muted-text">
        Z-index 堆疊層級。數值越大，元素越靠近使用者，覆蓋在其他元素之上。
      </p>
      <div className="space-y-2">
        {Z_LAYERS.map((layer, i) => (
          <div
            key={layer.token}
            className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3"
            style={{
              borderLeftWidth: "4px",
              borderLeftColor: Z_BORDER_COLORS[i],
            }}
          >
            <div className="w-24 shrink-0">
              <p className="font-mono text-xs font-semibold text-foreground">
                {layer.token}
              </p>
            </div>
            <div
              className="flex h-7 w-16 shrink-0 items-center justify-center rounded border border-border bg-surface font-mono text-sm font-bold text-foreground"
              style={{ color: Z_BORDER_COLORS[i] }}
            >
              {layer.value}
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-foreground">
                {layer.label}
              </span>
              <span className="ml-2 text-xs text-muted-text">{layer.desc}</span>
            </div>
            <button
              type="button"
              onClick={() =>
                copyToClipboard(`var(${layer.token})`, layer.token)
              }
              aria-label={`複製 ${layer.token} CSS 變數到剪貼簿`}
              className="shrink-0 rounded border border-border bg-surface px-2 py-1 font-mono text-[10px] text-muted-text hover:border-accent/40 hover:text-accent"
            >
              複製
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 9: Opacity Tokens
   ═══════════════════════════════════════════════════════════════ */

const OPACITY_LEVELS = [
  { key: "0", label: "0%", value: 0, token: "--opacity-0" },
  { key: "10", label: "10%", value: 0.1, token: "--opacity-10" },
  { key: "20", label: "20%", value: 0.2, token: "--opacity-20" },
  { key: "30", label: "30%", value: 0.3, token: "--opacity-30" },
  { key: "50", label: "50%", value: 0.5, token: "--opacity-50" },
  { key: "75", label: "75%", value: 0.75, token: "--opacity-75" },
  { key: "100", label: "100%", value: 1, token: "--opacity-100" },
];

const CHECKERBOARD_STYLE: React.CSSProperties = {
  backgroundImage: `
    linear-gradient(45deg, #ccc 25%, transparent 25%),
    linear-gradient(-45deg, #ccc 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ccc 75%),
    linear-gradient(-45deg, transparent 75%, #ccc 75%)
  `,
  backgroundSize: "10px 10px",
  backgroundPosition: "0 0, 0 5px, 5px -5px, -5px 0px",
};

function OpacitySection() {
  return (
    <section>
      <SectionHeading id="opacity">透明度</SectionHeading>
      <p className="mb-4 text-sm text-muted-text">
        透明度層級。棋盤格背景用於展示透明效果。點擊任一方塊可複製 CSS 變數。
      </p>
      <div className="flex flex-wrap gap-3">
        {OPACITY_LEVELS.map((op) => (
          <button
            key={op.key}
            type="button"
            onClick={() => copyToClipboard(`var(${op.token})`, op.token)}
            aria-label={`複製 ${op.token}（${op.label}）CSS 變數到剪貼簿`}
            title={`${op.token}: ${op.label}`}
            className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-3 transition-all hover:border-accent/40 hover:shadow-sm"
          >
            {/* Checkerboard + colored box */}
            <div
              className="h-14 w-14 overflow-hidden rounded-md border border-black/10"
              style={CHECKERBOARD_STYLE}
            >
              <div
                className="h-full w-full"
                style={{
                  backgroundColor: "var(--color-accent, #5c4306)",
                  opacity: op.value,
                }}
              />
            </div>
            <span className="text-[11px] font-semibold text-foreground">
              {op.label}
            </span>
            <span className="font-mono text-[9px] text-muted-text">
              {op.token}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 10: Component Gallery
   ═══════════════════════════════════════════════════════════════ */

const MOCK_CASE: ImmigrationCase = {
  case_id: "a1b2c3d4e5f6",
  citation: "[2025] ARTA 1234",
  title: "Singh 訴 移民部長",
  court: "行政覆核審裁處",
  court_code: "ARTA",
  date: "2025-03-15",
  year: 2025,
  url: "https://austlii.edu.au/au/cases/cth/ARTA/2025/1234.html",
  judges: "高級委員 Johnson",
  catchwords: "移民－簽證取消－品格測試",
  outcome: "撤銷原決定並發還重審",
  visa_type: "500 類（學生）",
  legislation: "《1958 年移民法》（聯邦）第 501 條",
  text_snippet: "審裁處認為原決定應予撤銷並發還重審……",
  full_text_path: "case_texts/[2025] ARTA 1234.txt",
  source: "AustLII",
  user_notes: "",
  tags: "",
  case_nature: "移民",
  legal_concepts: "品格測試、簽證取消",
  visa_subclass: "500",
  visa_class_code: "TU",
  applicant_name: "Singh",
  respondent: "移民部長",
  country_of_origin: "印度",
  visa_subclass_number: "500",
  hearing_date: "2025 年 3 月 12 日",
  is_represented: "是",
  representative: "Smith & Associates 律師行",
};

function ButtonGallery() {
  const [loading, setLoading] = useState(false);
  return (
    <div>
      <SubHeading>按鈕</SubHeading>
      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-light">
          主要
        </button>
        <button className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface">
          次要
        </button>
        <button className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90">
          危險
        </button>
        <button
          className="rounded-md bg-accent/50 px-4 py-2 text-sm font-medium text-white cursor-not-allowed"
          disabled
        >
          已停用
        </button>
        <button
          className="rounded-md border border-border bg-card p-2 text-foreground transition-colors hover:bg-surface"
          aria-label="圖示按鈕示例"
          title="圖示按鈕示例"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
          onClick={() => {
            setLoading(true);
            setTimeout(() => setLoading(false), 1500);
          }}
        >
          {loading && (
            <div className="animate-spin">
              <Loader2 className="h-4 w-4" />
            </div>
          )}
          {loading ? "載入中..." : "點擊載入"}
        </button>
      </div>
    </div>
  );
}

function FormControlGallery() {
  return (
    <div>
      <SubHeading>表單控制</SubHeading>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-foreground">文字輸入</span>
          <input
            type="text"
            placeholder="搜尋案例..."
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-foreground">下拉選擇</span>
          <select className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent">
            <option>所有法院</option>
            <option>AATA</option>
            <option>ARTA</option>
            <option>FCA</option>
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-foreground">多行輸入</span>
          <textarea
            rows={2}
            placeholder="加入案例備註..."
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-text focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            defaultChecked
            className="h-4 w-4 rounded border-border accent-accent"
          />
          <span className="text-sm text-foreground">匯出時包含全文</span>
        </label>
      </div>
    </div>
  );
}

function BadgeGallery() {
  return (
    <div>
      <SubHeading>法院標籤</SubHeading>
      <div className="mb-4 flex flex-wrap gap-2">
        {Object.keys(courtColors).map((court) => (
          <CourtBadge key={court} court={court} />
        ))}
      </div>
      <SubHeading>結果標籤</SubHeading>
      <div className="flex flex-wrap gap-2">
        {[
          "Allowed",
          "Dismissed",
          "Remitted",
          "Affirmed",
          "Granted",
          "Refused",
          "Withdrawn",
        ].map((o) => (
          <OutcomeBadge key={o} outcome={o} />
        ))}
      </div>
    </div>
  );
}

function CardGallery() {
  return (
    <div>
      <SubHeading>卡片</SubHeading>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="案例總數"
          value={62539}
          icon={<Scale className="h-5 w-5" />}
          description="整合所有資料庫"
        />
        <StatCard
          title="包含全文"
          value={62517}
          icon={<FileText className="h-5 w-5" />}
          description="覆蓋率 99.96%"
        />
        <CaseCard
          case_={MOCK_CASE}
          onClick={() => toast.info("已點擊案例卡片")}
        />
      </div>
    </div>
  );
}

function TableGallery() {
  const rows = [
    {
      citation: "[2025] ARTA 1234",
      court: "ARTA",
      date: "2025-03-15",
      outcome: "Remitted",
    },
    {
      citation: "[2024] FCA 567",
      court: "FCA",
      date: "2024-11-02",
      outcome: "Dismissed",
    },
    {
      citation: "[2024] AATA 890",
      court: "AATA",
      date: "2024-09-18",
      outcome: "Affirmed",
    },
  ];
  return (
    <div>
      <SubHeading>表格</SubHeading>
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="px-4 py-2.5 font-medium text-foreground">引用</th>
              <th className="px-4 py-2.5 font-medium text-foreground">法院</th>
              <th className="px-4 py-2.5 font-medium text-foreground">日期</th>
              <th className="px-4 py-2.5 font-medium text-foreground">結果</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.citation}
                className="border-b border-border-light bg-card transition-colors hover:bg-surface"
              >
                <td className="px-4 py-2.5 font-medium text-accent">
                  {r.citation}
                </td>
                <td className="px-4 py-2.5">
                  <CourtBadge court={r.court} />
                </td>
                <td className="px-4 py-2.5 text-muted-text">{r.date}</td>
                <td className="px-4 py-2.5">
                  <OutcomeBadge outcome={r.outcome} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MiscGallery() {
  return (
    <div>
      <SubHeading>其他元件</SubHeading>
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="animate-spin">
            <Loader2 className="h-5 w-5 text-accent" />
          </div>
          <span className="text-sm text-muted-text">載入中...</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => toast.success("操作已完成")}
            className="rounded border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium text-success"
          >
            成功
          </button>
          <button
            onClick={() => toast.error("發生錯誤")}
            className="rounded border border-danger/30 bg-danger/10 px-3 py-1 text-xs font-medium text-danger"
          >
            錯誤
          </button>
          <button
            onClick={() => toast.warning("請檢查輸入內容")}
            className="rounded border border-warning/30 bg-warning/10 px-3 py-1 text-xs font-medium text-warning"
          >
            警告
          </button>
          <button
            onClick={() => toast.info("提示：可使用鍵盤快捷鍵")}
            className="rounded border border-info/30 bg-info/10 px-3 py-1 text-xs font-medium text-info"
          >
            資訊
          </button>
        </div>
        <div className="flex items-center gap-1 text-sm text-muted-text">
          <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs shadow-xs">
            /
          </kbd>
          <span>搜尋</span>
          <kbd className="ml-2 rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-xs shadow-xs">
            ?
          </kbd>
          <span>說明</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="rounded border border-border bg-card p-1.5 text-muted-text hover:bg-surface"
            aria-label="上一頁"
            title="上一頁"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="rounded border border-accent bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent">
            1
          </button>
          <button className="rounded border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-surface">
            2
          </button>
          <button className="rounded border border-border bg-card px-2.5 py-1 text-xs text-foreground hover:bg-surface">
            3
          </button>
          <button
            className="rounded border border-border bg-card p-1.5 text-muted-text hover:bg-surface"
            aria-label="下一頁"
            title="下一頁"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ComponentGallery() {
  return (
    <section>
      <SectionHeading id="components">元件展示</SectionHeading>
      <div className="space-y-8">
        <ButtonGallery />
        <FormControlGallery />
        <BadgeGallery />
        <CardGallery />
        <TableGallery />
        <MiscGallery />
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 8: Dark Mode Comparison
   ═══════════════════════════════════════════════════════════════ */

interface DarkModeMiniCardProps {
  vars: Record<string, string>;
  label: string;
}

function DarkModeMiniCard({ vars, label }: DarkModeMiniCardProps) {
  return (
    <div
      className="flex-1 overflow-hidden rounded-lg border"
      style={{ backgroundColor: vars.bg, borderColor: vars.border }}
    >
      <div
        className="border-b px-4 py-2"
        style={{ backgroundColor: vars.card, borderColor: vars.border }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: vars.muted }}
        >
          {label}
        </span>
      </div>
      <div className="space-y-3 p-4" style={{ backgroundColor: vars.card }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: vars.text }}>
            案例標題示例
          </p>
          <p className="text-xs" style={{ color: vars.secondary }}>
            [2025] ARTA 1234
          </p>
        </div>
        <div className="flex gap-2">
          <span
            className="rounded-sm px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: courtColors.ARTA }}
          >
            ARTA
          </span>
          <span
            className="rounded-sm border px-2 py-0.5 text-xs font-medium"
            style={{
              color: semanticColors.success,
              borderColor: `${semanticColors.success}33`,
              backgroundColor: `${semanticColors.success}1a`,
            }}
          >
            勝訴
          </span>
        </div>
        <button
          className="rounded px-3 py-1.5 text-xs font-medium text-white"
          style={{ backgroundColor: vars.accent }}
        >
          操作按鈕
        </button>
      </div>
    </div>
  );
}

function DarkModeComparison() {
  const { preset } = useThemePreset();

  function buildVars(dark: boolean) {
    return {
      bg: getBaseColor(preset, dark, "--color-background"),
      card: getBaseColor(preset, dark, "--color-background-card"),
      text: getBaseColor(preset, dark, "--color-text"),
      secondary: getBaseColor(preset, dark, "--color-text-secondary"),
      muted: getBaseColor(preset, dark, "--color-text-muted"),
      border: getBaseColor(preset, dark, "--color-border"),
      accent: getBaseColor(preset, dark, "--color-accent"),
    };
  }

  const lightVars = buildVars(false);
  const darkVars = buildVars(true);

  return (
    <section>
      <SectionHeading id="dark-mode">深淺色模式對照</SectionHeading>
      <div className="flex gap-4">
        <DarkModeMiniCard vars={lightVars} label="淺色" />
        <DarkModeMiniCard vars={darkVars} label="深色" />
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 9: CSS Variable Reference
   ═══════════════════════════════════════════════════════════════ */

interface VarRow {
  name: string;
  category: string;
  preview: "color" | "font" | "spacing" | "radius" | "shadow";
}

const ALL_VARS: VarRow[] = [
  { name: "--color-primary", category: "顏色", preview: "color" },
  { name: "--color-primary-light", category: "顏色", preview: "color" },
  { name: "--color-primary-lighter", category: "顏色", preview: "color" },
  { name: "--color-accent", category: "顏色", preview: "color" },
  { name: "--color-accent-light", category: "顏色", preview: "color" },
  { name: "--color-accent-muted", category: "顏色", preview: "color" },
  { name: "--color-background", category: "顏色", preview: "color" },
  { name: "--color-background-card", category: "顏色", preview: "color" },
  { name: "--color-background-sidebar", category: "顏色", preview: "color" },
  { name: "--color-background-surface", category: "顏色", preview: "color" },
  { name: "--color-border", category: "顏色", preview: "color" },
  { name: "--color-border-light", category: "顏色", preview: "color" },
  { name: "--color-text", category: "顏色", preview: "color" },
  { name: "--color-text-secondary", category: "顏色", preview: "color" },
  { name: "--color-text-muted", category: "顏色", preview: "color" },
  { name: "--color-semantic-success", category: "語意", preview: "color" },
  { name: "--color-semantic-warning", category: "語意", preview: "color" },
  { name: "--color-semantic-danger", category: "語意", preview: "color" },
  { name: "--color-semantic-info", category: "語意", preview: "color" },
  { name: "--color-court-aata", category: "法院", preview: "color" },
  { name: "--color-court-arta", category: "法院", preview: "color" },
  { name: "--color-court-fca", category: "法院", preview: "color" },
  { name: "--color-court-fcca", category: "法院", preview: "color" },
  { name: "--color-court-fedcfamc2g", category: "法院", preview: "color" },
  { name: "--color-court-hca", category: "法院", preview: "color" },
  { name: "--color-court-rrta", category: "法院", preview: "color" },
  { name: "--color-court-mrta", category: "法院", preview: "color" },
  { name: "--color-court-fmca", category: "法院", preview: "color" },
  { name: "--font-heading", category: "字型", preview: "font" },
  { name: "--font-body", category: "字型", preview: "font" },
  { name: "--font-mono", category: "字型", preview: "font" },
  { name: "--spacing-1", category: "間距", preview: "spacing" },
  { name: "--spacing-2", category: "間距", preview: "spacing" },
  { name: "--spacing-3", category: "間距", preview: "spacing" },
  { name: "--spacing-4", category: "間距", preview: "spacing" },
  { name: "--spacing-5", category: "間距", preview: "spacing" },
  { name: "--spacing-6", category: "間距", preview: "spacing" },
  { name: "--spacing-8", category: "間距", preview: "spacing" },
  { name: "--radius-sm", category: "圓角", preview: "radius" },
  { name: "--radius", category: "圓角", preview: "radius" },
  { name: "--radius-lg", category: "圓角", preview: "radius" },
  { name: "--radius-pill", category: "圓角", preview: "radius" },
  { name: "--shadow-xs", category: "陰影", preview: "shadow" },
  { name: "--shadow-sm", category: "陰影", preview: "shadow" },
  { name: "--shadow", category: "陰影", preview: "shadow" },
  { name: "--shadow-lg", category: "陰影", preview: "shadow" },
];

function CssVariableReference() {
  useThemePreset();
  const computedVals = (() => {
    const vals: Record<string, string> = {};
    if (typeof window === "undefined") return vals;
    const style = getComputedStyle(document.documentElement);
    for (const v of ALL_VARS) {
      vals[v.name] = style.getPropertyValue(v.name).trim();
    }
    return vals;
  })();

  function renderPreview(row: VarRow, value: string) {
    if (row.preview === "color")
      return (
        <div
          className="h-5 w-8 rounded border border-black/10"
          style={{ backgroundColor: value }}
        />
      );
    if (row.preview === "font")
      return (
        <span className="text-xs" style={{ fontFamily: value }}>
          Abc
        </span>
      );
    if (row.preview === "spacing")
      return (
        <div
          className="rounded bg-accent/20"
          style={{ width: value, height: "12px" }}
        />
      );
    if (row.preview === "radius")
      return (
        <div
          className="h-5 w-5 border-2 border-accent bg-accent-muted"
          style={{ borderRadius: value }}
        />
      );
    if (row.preview === "shadow")
      return (
        <div
          className="h-5 w-8 rounded bg-white dark:bg-gray-700"
          style={{ boxShadow: value }}
        />
      );
    return null;
  }

  const categoryColors: Record<string, string> = {
    顏色: "bg-accent/10 text-accent",
    語意: "bg-success/10 text-success",
    法院: "bg-info/10 text-info",
    字型: "bg-warning/10 text-warning",
    間距: "bg-danger/10 text-danger",
    圓角: "bg-muted-text/10 text-muted-text",
    陰影: "bg-primary/10 text-primary",
  };

  return (
    <section>
      <SectionHeading id="css-vars">CSS 變數參考</SectionHeading>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium text-foreground">變數</th>
                <th className="px-3 py-2 font-medium text-foreground">類別</th>
                <th className="px-3 py-2 font-medium text-foreground">值</th>
                <th className="px-3 py-2 font-medium text-foreground">預覽</th>
              </tr>
            </thead>
            <tbody>
              {ALL_VARS.map((row) => {
                const value = computedVals[row.name] ?? "";
                return (
                  <tr
                    key={row.name}
                    className="border-b border-border-light bg-card transition-colors hover:bg-surface"
                  >
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() =>
                          copyToClipboard(`var(${row.name})`, row.name)
                        }
                        className="font-mono text-xs text-accent hover:underline"
                      >
                        {row.name}
                      </button>
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${categoryColors[row.category] ?? ""}`}
                      >
                        {row.category}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-muted-text">
                      {value.length > 40 ? `${value.slice(0, 40)}...` : value}
                    </td>
                    <td className="px-3 py-1.5">{renderPreview(row, value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 10: WCAG Contrast Checker
   ═══════════════════════════════════════════════════════════════ */

const CONTRAST_PAIRS: { label: string; fg: string; bg: string }[] = [
  { label: "Text / Background", fg: "--color-text", bg: "--color-background" },
  { label: "Text / Card", fg: "--color-text", bg: "--color-background-card" },
  {
    label: "Accent / Background",
    fg: "--color-accent",
    bg: "--color-background",
  },
  {
    label: "Muted Text / Background",
    fg: "--color-text-muted",
    bg: "--color-background",
  },
  {
    label: "Secondary Text / Card",
    fg: "--color-text-secondary",
    bg: "--color-background-card",
  },
  {
    label: "Success (semantic)",
    fg: "--color-semantic-success",
    bg: "--color-background",
  },
  {
    label: "Danger (semantic)",
    fg: "--color-semantic-danger",
    bg: "--color-background",
  },
];

const WCAG_BADGE_COLORS: Record<WcagLevel, string> = {
  AAA: "bg-success/15 text-success border border-success/30",
  AA: "bg-info/15 text-info border border-info/30",
  "AA Large": "bg-warning/15 text-warning border border-warning/30",
  Fail: "bg-danger/15 text-danger border border-danger/30",
};

function ContrastCard({
  label,
  fgVar,
  bgVar,
}: {
  label: string;
  fgVar: string;
  bgVar: string;
}) {
  const fg = getCssVar(fgVar);
  const bg = getCssVar(bgVar);
  // Fallback in case CSS var is not resolved (e.g., SSR)
  const fgColor = fg || "#111111";
  const bgColor = bg || "#ffffff";
  const ratio = getContrastRatio(fgColor, bgColor);
  const level = getWcagLevel(ratio);
  const badgeCls = WCAG_BADGE_COLORS[level];

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      {/* Color swatches */}
      <div className="flex shrink-0 flex-col gap-1">
        <div
          className="h-5 w-8 rounded border border-black/10"
          style={{ backgroundColor: fgColor }}
          title={`fg: ${fgColor}`}
        />
        <div
          className="h-5 w-8 rounded border border-black/10"
          style={{ backgroundColor: bgColor }}
          title={`bg: ${bgColor}`}
        />
      </div>
      {/* "Aa" text preview */}
      <div
        className="flex h-12 w-16 shrink-0 items-center justify-center rounded-md border border-black/10 text-xl font-bold"
        style={{ backgroundColor: bgColor, color: fgColor }}
      >
        Aa
      </div>
      {/* Label + ratio + badge */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">{label}</p>
        <p className="font-mono text-xs text-muted-text">
          {ratio.toFixed(1)}:1
        </p>
      </div>
      <span
        className={cn(
          "shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold",
          badgeCls,
        )}
      >
        {level}
      </span>
    </div>
  );
}

function WcagContrastChecker() {
  const { preset, isDark } = useThemePreset();
  return (
    <section key={`${preset}-${isDark}`}>
      <SectionHeading id="contrast">WCAG 對比度檢查</SectionHeading>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-text">
        Contrast Checker
      </p>
      <p className="mb-4 text-sm text-muted-text">
        以下對比度數值從目前主題的 CSS
        變數即時讀取。切換主題或深色模式後數值會自動更新。 AAA ≥ 7:1 | AA ≥
        4.5:1 | AA Large ≥ 3:1
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {CONTRAST_PAIRS.map((pair) => (
          <ContrastCard
            key={pair.label}
            label={pair.label}
            fgVar={pair.fg}
            bgVar={pair.bg}
          />
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 11: Color Blindness Simulator
   ═══════════════════════════════════════════════════════════════ */

const CB_TYPES: {
  type: ColorBlindType;
  label: string;
  desc: string;
}[] = [
  { type: "protanopia", label: "Protanopia", desc: "紅色盲 · 約 1% 男性" },
  {
    type: "deuteranopia",
    label: "Deuteranopia",
    desc: "綠色盲 · 約 6% 男性",
  },
  {
    type: "tritanopia",
    label: "Tritanopia",
    desc: "藍色盲 · 約 0.01% 人口",
  },
  {
    type: "achromatopsia",
    label: "Achromatopsia",
    desc: "全色盲 · 極為罕見",
  },
];

const PALETTE_VARS: { label: string; cssVar: string; fallback: string }[] = [
  { label: "Primary", cssVar: "--color-primary", fallback: "#3d3929" },
  { label: "Accent", cssVar: "--color-accent", fallback: "#da7756" },
  {
    label: "Success",
    cssVar: "--color-semantic-success",
    fallback: "#22c55e",
  },
  { label: "Danger", cssVar: "--color-semantic-danger", fallback: "#ef4444" },
  { label: "Text", cssVar: "--color-text", fallback: "#1a1a1a" },
  {
    label: "Background",
    cssVar: "--color-background",
    fallback: "#f5f5f5",
  },
];

function ColorBlindnessSimulator() {
  const [selectedColor, setSelectedColor] = useState<string>(() => {
    if (typeof window === "undefined") return "#da7756";
    const v = getCssVar("--color-accent");
    // getCssVar may return empty if page not yet mounted; use fallback
    return v && v.startsWith("#") ? v : "#da7756";
  });

  // Quick-pick buttons: resolve CSS vars at render time
  function resolveVar(cssVar: string, fallback: string): string {
    const v = getCssVar(cssVar);
    return v && v.match(/^#[0-9a-fA-F]{6}$/) ? v : fallback;
  }

  const quickPicks = PALETTE_VARS.map((pv) => ({
    label: pv.label,
    hex: resolveVar(pv.cssVar, pv.fallback),
  }));

  // Palette simulation table data
  const paletteRows = PALETTE_VARS.map((pv) => {
    const base = resolveVar(pv.cssVar, pv.fallback);
    return {
      label: pv.label,
      normal: base,
      protanopia: simulateColorBlindness(base, "protanopia"),
      deuteranopia: simulateColorBlindness(base, "deuteranopia"),
      tritanopia: simulateColorBlindness(base, "tritanopia"),
      achromatopsia: simulateColorBlindness(base, "achromatopsia"),
    };
  });

  return (
    <section>
      <SectionHeading id="colorblind">色盲模擬器</SectionHeading>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-text">
        Color Blindness Simulator
      </p>
      <p className="mb-6 text-sm text-muted-text">
        模擬不同色覺缺陷者所見的顏色效果。基於 Brettel et al. (1997) 與 Viénot
        et al. (1999) 算法。
      </p>

      {/* Single color picker */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            選擇顏色：
          </span>
          <input
            type="color"
            value={selectedColor}
            onChange={(e) => setSelectedColor(e.target.value)}
            className="h-9 w-14 cursor-pointer rounded border border-border bg-card"
            aria-label="選擇要模擬的顏色"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {quickPicks.map((qp) => (
            <button
              key={qp.label}
              onClick={() => setSelectedColor(qp.hex)}
              title={`${qp.label}: ${qp.hex}`}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all",
                selectedColor.toLowerCase() === qp.hex.toLowerCase()
                  ? "border-accent ring-1 ring-accent/40"
                  : "border-border hover:border-accent/40",
              )}
            >
              <span
                className="h-3.5 w-3.5 rounded-full border border-black/10"
                style={{ backgroundColor: qp.hex }}
              />
              {qp.label}
            </button>
          ))}
        </div>
      </div>

      {/* Normal vision + 4 simulations */}
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {/* Normal Vision */}
        <div className="flex min-w-[160px] flex-1 flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-semibold text-foreground">正常視覺</p>
          <p className="text-xs text-muted-text">Normal Vision</p>
          <div
            className="h-20 w-full rounded-md border border-black/10 transition-colors"
            style={{ backgroundColor: selectedColor }}
          />
          <p className="font-mono text-xs text-muted-text">{selectedColor}</p>
        </div>
        {CB_TYPES.map((cb) => {
          const simulated = simulateColorBlindness(selectedColor, cb.type);
          return (
            <div
              key={cb.type}
              className="flex min-w-[160px] flex-1 flex-col gap-2 rounded-lg border border-border bg-card p-4"
            >
              <p className="text-sm font-semibold text-foreground">
                {cb.label}
              </p>
              <p className="text-xs text-muted-text">{cb.desc}</p>
              <div
                className="h-20 w-full rounded-md border border-black/10 transition-colors"
                style={{ backgroundColor: simulated }}
              />
              <p className="font-mono text-xs text-muted-text">{simulated}</p>
            </div>
          );
        })}
      </div>

      {/* Theme Palette Preview table */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          主題調色板預覽
        </h3>
        <p className="mb-3 text-xs text-muted-text">
          6 種主題色彩在各色盲類型下的呈現效果對照表。
        </p>
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className="px-3 py-2 font-medium text-foreground">
                    色彩
                  </th>
                  <th className="px-3 py-2 font-medium text-foreground">
                    正常
                  </th>
                  <th className="px-3 py-2 font-medium text-foreground">
                    Protanopia
                  </th>
                  <th className="px-3 py-2 font-medium text-foreground">
                    Deuteranopia
                  </th>
                  <th className="px-3 py-2 font-medium text-foreground">
                    Tritanopia
                  </th>
                  <th className="px-3 py-2 font-medium text-foreground">
                    Achromatopsia
                  </th>
                </tr>
              </thead>
              <tbody>
                {paletteRows.map((row) => (
                  <tr
                    key={row.label}
                    className="border-b border-border-light bg-card"
                  >
                    <td className="px-3 py-2 font-medium text-foreground">
                      {row.label}
                    </td>
                    {(
                      [
                        row.normal,
                        row.protanopia,
                        row.deuteranopia,
                        row.tritanopia,
                        row.achromatopsia,
                      ] as string[]
                    ).map((hex, i) => (
                      <td key={i} className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-6 w-10 shrink-0 rounded border border-black/10"
                            style={{ backgroundColor: hex }}
                          />
                          <span className="font-mono text-[10px] text-muted-text">
                            {hex}
                          </span>
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 12: Usage Guide
   ═══════════════════════════════════════════════════════════════ */

function UsageGuide() {
  return (
    <section>
      <SectionHeading id="usage">使用指南</SectionHeading>
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Tailwind 類別（透過 `@theme`）
          </h3>
          <pre className="overflow-auto rounded bg-surface p-3 font-mono text-xs text-foreground">
            {`<div className="bg-background text-foreground border-border" />
<span className="text-accent font-heading" />
<div className="shadow-sm rounded-lg" />
<button className="bg-court-arta text-white rounded-sm" />`}
          </pre>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            TypeScript Token 匯入
          </h3>
          <pre className="overflow-auto rounded bg-surface p-3 font-mono text-xs text-foreground">
            {`import { tokens, courtColors, semanticColors } from "@/tokens/tokens"

<Bar fill={courtColors.AATA} />
<Area stroke={semanticColors.success} />
<div style={{ color: tokens.color.accent.DEFAULT }} />`}
          </pre>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            主題自訂 Hook
          </h3>
          <pre className="overflow-auto rounded bg-surface p-3 font-mono text-xs text-foreground">
            {`import { useThemePreset } from "@/hooks/use-theme-preset"

const { preset, setPreset, setCustomVar, clearCustomVars } = useThemePreset()
// setPreset("ocean")          -> 切換主題（會清除自訂覆寫）
// setCustomVar("--color-accent", "#e67e22")  -> 即時覆寫顏色
// setCustomVar("--font-body", "'DM Sans', sans-serif")  -> 更改字型
// clearCustomVars()           -> 重設為預設主題
// 所有變更會自動儲存到 localStorage`}
          </pre>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Preferences Bar (floating, shows when custom overrides active)
   ═══════════════════════════════════════════════════════════════ */

function PreferencesBar() {
  const {
    preset,
    isDark,
    customVars,
    clearCustomVars,
    setCustomVar,
    setPreset,
    setDark,
  } = useThemePreset();
  const count = Object.keys(customVars).length;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState(false);

  if (count === 0) return null;

  function exportTheme() {
    const data = {
      preset,
      isDark,
      customVars,
      exportedAt: new Date().toISOString(),
      version: "1.0",
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `immi-theme-${preset}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importTheme(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (data.customVars && typeof data.customVars === "object") {
          Object.entries(data.customVars).forEach(([key, value]) => {
            if (
              typeof key === "string" &&
              typeof value === "string" &&
              key.startsWith("--")
            ) {
              setCustomVar(key, value);
            }
          });
        }
        if (data.preset) setPreset(data.preset);
        if (typeof data.isDark === "boolean") setDark(data.isDark);
        setImported(true);
        setTimeout(() => setImported(false), 2000);
      } catch {
        // Silently ignore parse errors
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-full border border-border bg-card px-5 py-2.5 shadow-lg">
        <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />
        <span className="whitespace-nowrap text-sm font-medium text-foreground">
          已啟用 {count} 項自訂覆寫
        </span>
        {imported ? (
          <span className="flex items-center gap-1 whitespace-nowrap text-xs text-success">
            <Check className="h-3 w-3" /> 已匯入
          </span>
        ) : (
          <span className="flex items-center gap-1 whitespace-nowrap text-xs text-success">
            <Save className="h-3 w-3" /> 已自動儲存
          </span>
        )}
        {/* Export */}
        <button
          onClick={exportTheme}
          title="匯出主題 JSON"
          className="flex items-center gap-1 whitespace-nowrap rounded-md bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
        >
          <Download className="h-3 w-3" /> 匯出
        </button>
        {/* Import */}
        <button
          onClick={() => fileInputRef.current?.click()}
          title="匯入主題 JSON"
          className="flex items-center gap-1 whitespace-nowrap rounded-md bg-info/10 px-3 py-1 text-xs font-medium text-info transition-colors hover:bg-info/20"
        >
          <Upload className="h-3 w-3" /> 匯入
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importTheme(file);
            // Reset so same file can be re-imported
            e.target.value = "";
          }}
        />
        {/* Reset */}
        <button
          onClick={() => {
            clearCustomVars();
            toast.success("已清除所有自訂覆寫");
          }}
          className="flex items-center gap-1 whitespace-nowrap rounded-md bg-danger/10 px-3 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/20"
        >
          <RotateCcw className="h-3 w-3" /> 重設
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Navigation
   ═══════════════════════════════════════════════════════════════ */

const NAV_ITEMS = [
  { id: "theme", label: "主題" },
  { id: "colors", label: "顏色" },
  { id: "typography", label: "字體" },
  { id: "spacing", label: "間距" },
  { id: "radius", label: "圓角" },
  { id: "shadows", label: "陰影" },
  { id: "animation", label: "動畫" },
  { id: "zindex", label: "層級" },
  { id: "opacity", label: "透明度" },
  { id: "components", label: "元件" },
  { id: "dark-mode", label: "深色模式" },
  { id: "css-vars", label: "CSS 變數" },
  { id: "contrast", label: "對比度" },
  { id: "colorblind", label: "色盲模擬" },
  { id: "usage", label: "用法" },
];

function SectionNav() {
  return (
    <nav className="mb-8 flex flex-wrap gap-1.5">
      {NAV_ITEMS.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-text transition-colors hover:border-accent hover:text-accent"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════════════ */

export function DesignTokensPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-12">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          {t("pages.design_tokens.title")}
        </h1>
        <p className="text-sm text-muted-text">
          {t("pages.design_tokens.subtitle")}
        </p>
      </div>

      <SectionNav />
      <ThemePresetSwitcher />
      <ColorPalette />
      <TypographySection />
      <SpacingSection />
      <RadiusSection />
      <ShadowSection />
      <AnimationSection />
      <ZIndexSection />
      <OpacitySection />
      <ComponentGallery />
      <DarkModeComparison />
      <CssVariableReference />
      <WcagContrastChecker />
      <ColorBlindnessSimulator />
      <UsageGuide />
      <PreferencesBar />
    </div>
  );
}
