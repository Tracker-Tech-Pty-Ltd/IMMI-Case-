import { useState, useMemo } from "react";
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
   Color Utilities
   ═══════════════════════════════════════════════════════════════ */

function parseColor(color: string): [number, number, number] | null {
  const hex = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (hex)
    return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
  const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return [parseInt(rgb[1]), parseInt(rgb[2]), parseInt(rgb[3])];
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function mixHex(c1: string, c2: string, w: number): string {
  const a = parseColor(c1);
  const b = parseColor(c2);
  if (!a || !b) return c1;
  return rgbToHex(
    a[0] * (1 - w) + b[0] * w,
    a[1] * (1 - w) + b[1] * w,
    a[2] * (1 - w) + b[2] * w,
  );
}

function generateTones(base: string): { label: string; hex: string }[] {
  const rgb = parseColor(base);
  if (!rgb) return [{ label: "500", hex: base }];
  const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;

  if (brightness > 200) {
    // Very light (e.g. #ffffff, #f5f4f1) → tones go progressively darker
    return [
      { label: "50", hex: base },
      { label: "100", hex: mixHex(base, "#9ca3af", 0.08) },
      { label: "200", hex: mixHex(base, "#6b7280", 0.15) },
      { label: "300", hex: mixHex(base, "#4b5563", 0.22) },
      { label: "400", hex: mixHex(base, "#374151", 0.32) },
      { label: "500", hex: mixHex(base, "#1f2937", 0.42) },
      { label: "600", hex: mixHex(base, "#111827", 0.55) },
      { label: "700", hex: mixHex(base, "#030712", 0.7) },
    ];
  }
  if (brightness < 60) {
    // Very dark (e.g. #1b2838) → tones go progressively lighter
    return [
      { label: "100", hex: mixHex(base, "#ffffff", 0.85) },
      { label: "200", hex: mixHex(base, "#ffffff", 0.7) },
      { label: "300", hex: mixHex(base, "#ffffff", 0.55) },
      { label: "400", hex: mixHex(base, "#ffffff", 0.4) },
      { label: "500", hex: mixHex(base, "#ffffff", 0.25) },
      { label: "600", hex: mixHex(base, "#ffffff", 0.12) },
      { label: "700", hex: base },
      { label: "800", hex: mixHex(base, "#000000", 0.3) },
    ];
  }
  // Mid-range → spread both directions from base
  return [
    { label: "50", hex: mixHex(base, "#ffffff", 0.9) },
    { label: "100", hex: mixHex(base, "#ffffff", 0.75) },
    { label: "200", hex: mixHex(base, "#ffffff", 0.55) },
    { label: "300", hex: mixHex(base, "#ffffff", 0.35) },
    { label: "500", hex: base },
    { label: "600", hex: mixHex(base, "#000000", 0.15) },
    { label: "700", hex: mixHex(base, "#000000", 0.3) },
    { label: "900", hex: mixHex(base, "#000000", 0.5) },
  ];
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
          aria-label="切換深色模式"
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
  return (
    <div className="mb-5">
      <SubHeading>{title}</SubHeading>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {tones.map((tone) => {
          const isActive = activeHex?.toLowerCase() === tone.hex.toLowerCase();
          return (
            <button
              key={tone.label}
              onClick={() => onSelect(cssVar, tone.hex, title)}
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
        點選任何色階會即時套用至整個介面。每組顏色提供 8 個色階，已啟用色彩會高亮顯示。
      </p>

      {COLOR_GROUPS.map((group) => {
        const base = baseColors[group.cssVar];
        if (!base || base.startsWith("rgba")) return null;
        const tones = generateTones(base);
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
          const tones = generateTones(court.hex);
          return (
            <div key={court.title} className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <CourtBadge court={court.title} />
                <span className="font-mono text-xs text-muted-text">
                  {court.hex}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {tones.map((tone) => (
                  <button
                    key={tone.label}
                    onClick={() =>
                      copyToClipboard(tone.hex, `${court.title} ${tone.label}`)
                    }
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
          const tones = generateTones(sg.hex);
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
          const tones = generateTones(cc.hex);
          return (
            <div key={cc.title} className="mb-5">
              <SubHeading>{cc.title}</SubHeading>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                {tones.map((tone) => (
                  <button
                    key={tone.label}
                    onClick={() =>
                      copyToClipboard(tone.hex, `${cc.title} ${tone.label}`)
                    }
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
              onClick={() => copyToClipboard(s.value, `shadow-${s.key}`)}
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
   Section 7: Component Gallery
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
          <span className="text-sm text-foreground">
            匯出時包含全文
          </span>
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
              <th className="px-4 py-2.5 font-medium text-foreground">
                引用
              </th>
              <th className="px-4 py-2.5 font-medium text-foreground">法院</th>
              <th className="px-4 py-2.5 font-medium text-foreground">日期</th>
              <th className="px-4 py-2.5 font-medium text-foreground">
                結果
              </th>
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
                <th className="px-3 py-2 font-medium text-foreground">
                  變數
                </th>
                <th className="px-3 py-2 font-medium text-foreground">
                  類別
                </th>
                <th className="px-3 py-2 font-medium text-foreground">值</th>
                <th className="px-3 py-2 font-medium text-foreground">
                  預覽
                </th>
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
   Section 10: Usage Guide
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
  const { customVars, clearCustomVars } = useThemePreset();
  const count = Object.keys(customVars).length;

  if (count === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-full border border-border bg-card px-5 py-2.5 shadow-lg">
        <div className="h-2 w-2 shrink-0 rounded-full bg-accent animate-pulse" />
        <span className="whitespace-nowrap text-sm font-medium text-foreground">
          已啟用 {count} 項自訂覆寫
        </span>
        <span className="flex items-center gap-1 whitespace-nowrap text-xs text-success">
          <Save className="h-3 w-3" /> 已自動儲存
        </span>
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
  { id: "components", label: "元件" },
  { id: "dark-mode", label: "深色模式" },
  { id: "css-vars", label: "CSS 變數" },
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
      <ComponentGallery />
      <DarkModeComparison />
      <CssVariableReference />
      <UsageGuide />
      <PreferencesBar />
    </div>
  );
}
