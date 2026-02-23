import { useCallback, useSyncExternalStore } from "react";

export type PresetName =
  | "claude"
  | "parchment"
  | "ocean"
  | "forest"
  | "slate"
  | "rose"
  | "midnight"
  | "amber"
  | "nordic"
  | "terracotta"
  | "lavender";

interface ThemePreset {
  readonly label: string;
  readonly colors: readonly [string, string, string, string];
  readonly darkColors: readonly [string, string, string, string];
  readonly vars: Readonly<Record<string, string>>;
  readonly darkVars: Readonly<Record<string, string>>;
}

export const PRESETS: Record<PresetName, ThemePreset> = {
  claude: {
    label: "Claude",
    colors: ["#3d3929", "#da7756", "#eeece2", "#b0aea5"],
    darkColors: ["#141413", "#e08a6d", "#1e1e1c", "#3a3a35"],
    vars: {
      "--color-primary": "#3d3929",
      "--color-primary-light": "#564f3a",
      "--color-primary-lighter": "#6b6651",
      "--color-accent": "#da7756",
      "--color-accent-light": "#e08a6d",
      "--color-accent-muted": "rgba(218,119,86,0.12)",
      "--color-background": "#eeece2",
      "--color-background-card": "#faf9f5",
      "--color-background-sidebar": "#f4f3ee",
      "--color-background-surface": "#e8e6dc",
      "--color-border": "#d5d3c8",
      "--color-border-light": "#e0ded5",
      "--color-text": "#3d3929",
      "--color-text-secondary": "#6b6651",
      "--color-text-muted": "#9c9784",
      "--font-body":
        "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
    },
    darkVars: {
      "--color-primary": "#e8e4d8",
      "--color-primary-light": "#c4c0b0",
      "--color-primary-lighter": "#9c9784",
      "--color-accent": "#e08a6d",
      "--color-accent-light": "#eba28a",
      "--color-accent-muted": "rgba(224,138,109,0.15)",
      "--color-background": "#141413",
      "--color-background-card": "#1e1e1c",
      "--color-background-sidebar": "#191918",
      "--color-background-surface": "#2a2a27",
      "--color-border": "#4a4a44",
      "--color-border-light": "#555550",
      "--color-text": "#e8e5da",
      "--color-text-secondary": "#b0ad9f",
      "--color-text-muted": "#9a9789",
      "--font-body":
        "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
    },
  },
  parchment: {
    label: "Parchment",
    colors: ["#1b2838", "#5c4306", "#f5f4f1", "#6e7177"],
    darkColors: ["#111820", "#c9942e", "#192230", "#4a5060"],
    vars: {},
    darkVars: {},
  },
  ocean: {
    label: "Ocean",
    colors: ["#0f2942", "#e67e22", "#f0f6fa", "#cde0ed"],
    darkColors: ["#0a1929", "#f0923e", "#0f2137", "#1a3450"],
    vars: {
      "--color-primary": "#0f2942",
      "--color-primary-light": "#1a3d5c",
      "--color-primary-lighter": "#2a5a80",
      "--color-accent": "#e67e22",
      "--color-accent-light": "#f0923e",
      "--color-accent-muted": "rgba(230,126,34,0.12)",
      "--color-background": "#f0f6fa",
      "--color-background-card": "#ffffff",
      "--color-background-sidebar": "#f5f9fc",
      "--color-background-surface": "#e8f1f8",
      "--color-border": "#cde0ed",
      "--color-border-light": "#dfeaf3",
      "--color-text": "#0f2942",
      "--color-text-secondary": "#3d5a73",
      "--color-text-muted": "#7a94a8",
    },
    darkVars: {
      "--color-primary": "#b0cfe0",
      "--color-primary-light": "#7aa8c4",
      "--color-primary-lighter": "#4d8ab0",
      "--color-accent": "#f0923e",
      "--color-accent-light": "#f5ac6e",
      "--color-accent-muted": "rgba(240,146,62,0.15)",
      "--color-background": "#0a1929",
      "--color-background-card": "#0f2137",
      "--color-background-sidebar": "#0c1c30",
      "--color-background-surface": "#142840",
      "--color-border": "#1a3450",
      "--color-border-light": "#1e3a58",
      "--color-text": "#d8e8f2",
      "--color-text-secondary": "#8fafc4",
      "--color-text-muted": "#567a94",
    },
  },
  forest: {
    label: "Forest",
    colors: ["#1b3426", "#b45309", "#f2f5f3", "#cdddd3"],
    darkColors: ["#0e1f16", "#d97706", "#162419", "#1e3528"],
    vars: {
      "--color-primary": "#1b3426",
      "--color-primary-light": "#2a4d38",
      "--color-primary-lighter": "#3a6b4e",
      "--color-accent": "#b45309",
      "--color-accent-light": "#d97706",
      "--color-accent-muted": "rgba(180,83,9,0.12)",
      "--color-background": "#f2f5f3",
      "--color-background-card": "#ffffff",
      "--color-background-sidebar": "#f6f9f7",
      "--color-background-surface": "#eaf0ec",
      "--color-border": "#cdddd3",
      "--color-border-light": "#dde9e1",
      "--color-text": "#1b3426",
      "--color-text-secondary": "#3d5a48",
      "--color-text-muted": "#7a9485",
    },
    darkVars: {
      "--color-primary": "#b0d4bc",
      "--color-primary-light": "#80b090",
      "--color-primary-lighter": "#5a9470",
      "--color-accent": "#d97706",
      "--color-accent-light": "#f59e0b",
      "--color-accent-muted": "rgba(217,119,6,0.15)",
      "--color-background": "#0e1f16",
      "--color-background-card": "#162419",
      "--color-background-sidebar": "#111f15",
      "--color-background-surface": "#1e3528",
      "--color-border": "#254232",
      "--color-border-light": "#2d4d3a",
      "--color-text": "#d4e8da",
      "--color-text-secondary": "#8fb8a0",
      "--color-text-muted": "#567a64",
    },
  },
  slate: {
    label: "Slate",
    colors: ["#1e293b", "#6366f1", "#f8fafc", "#e2e8f0"],
    darkColors: ["#0f172a", "#818cf8", "#1e293b", "#334155"],
    vars: {
      "--color-primary": "#1e293b",
      "--color-primary-light": "#334155",
      "--color-primary-lighter": "#475569",
      "--color-accent": "#6366f1",
      "--color-accent-light": "#818cf8",
      "--color-accent-muted": "rgba(99,102,241,0.12)",
      "--color-background": "#f8fafc",
      "--color-background-card": "#ffffff",
      "--color-background-sidebar": "#f1f5f9",
      "--color-background-surface": "#f1f5f9",
      "--color-border": "#e2e8f0",
      "--color-border-light": "#eef2f7",
      "--color-text": "#1e293b",
      "--color-text-secondary": "#475569",
      "--color-text-muted": "#94a3b8",
    },
    darkVars: {
      "--color-primary": "#cbd5e1",
      "--color-primary-light": "#94a3b8",
      "--color-primary-lighter": "#64748b",
      "--color-accent": "#818cf8",
      "--color-accent-light": "#a5b4fc",
      "--color-accent-muted": "rgba(129,140,248,0.15)",
      "--color-background": "#0f172a",
      "--color-background-card": "#1e293b",
      "--color-background-sidebar": "#141d2e",
      "--color-background-surface": "#253348",
      "--color-border": "#334155",
      "--color-border-light": "#3b4c64",
      "--color-text": "#e2e8f0",
      "--color-text-secondary": "#94a3b8",
      "--color-text-muted": "#64748b",
    },
  },
  rose: {
    label: "Rose",
    colors: ["#3d1f2e", "#0891b2", "#fdf5f7", "#f0d4dc"],
    darkColors: ["#1f0f17", "#22d3ee", "#2a1520", "#3d2030"],
    vars: {
      "--color-primary": "#3d1f2e",
      "--color-primary-light": "#5c3347",
      "--color-primary-lighter": "#7a4a62",
      "--color-accent": "#0891b2",
      "--color-accent-light": "#06b6d4",
      "--color-accent-muted": "rgba(8,145,178,0.12)",
      "--color-background": "#fdf5f7",
      "--color-background-card": "#ffffff",
      "--color-background-sidebar": "#fdf8f9",
      "--color-background-surface": "#f9edf1",
      "--color-border": "#f0d4dc",
      "--color-border-light": "#f5e4ea",
      "--color-text": "#3d1f2e",
      "--color-text-secondary": "#6b4555",
      "--color-text-muted": "#a87d8e",
    },
    darkVars: {
      "--color-primary": "#e0c4cc",
      "--color-primary-light": "#c0909f",
      "--color-primary-lighter": "#a06878",
      "--color-accent": "#22d3ee",
      "--color-accent-light": "#67e8f9",
      "--color-accent-muted": "rgba(34,211,238,0.15)",
      "--color-background": "#1f0f17",
      "--color-background-card": "#2a1520",
      "--color-background-sidebar": "#24111b",
      "--color-background-surface": "#3d2030",
      "--color-border": "#4a2838",
      "--color-border-light": "#553040",
      "--color-text": "#f0dce2",
      "--color-text-secondary": "#c0909f",
      "--color-text-muted": "#886070",
    },
  },
  midnight: {
    label: "Midnight",
    colors: ["#1a1a3e", "#4f86f7", "#f0f0f8", "#d0d0e4"],
    darkColors: ["#0d0d1f", "#6e9df8", "#161630", "#2a2a52"],
    vars: {
      "--color-primary": "#1a1a3e",
      "--color-primary-light": "#2d2d5e",
      "--color-primary-lighter": "#42427e",
      "--color-accent": "#4f86f7",
      "--color-accent-light": "#6e9df8",
      "--color-accent-muted": "rgba(79,134,247,0.12)",
      "--color-background": "#f0f0f8",
      "--color-background-card": "#ffffff",
      "--color-background-sidebar": "#ebebf5",
      "--color-background-surface": "#e4e4f0",
      "--color-border": "#d0d0e4",
      "--color-border-light": "#dddded",
      "--color-text": "#1a1a3e",
      "--color-text-secondary": "#4a4a6e",
      "--color-text-muted": "#8585a5",
    },
    darkVars: {
      "--color-primary": "#c8c8e8",
      "--color-primary-light": "#9898c0",
      "--color-primary-lighter": "#6e6ea0",
      "--color-accent": "#6e9df8",
      "--color-accent-light": "#8fb5fa",
      "--color-accent-muted": "rgba(110,157,248,0.15)",
      "--color-background": "#0d0d1f",
      "--color-background-card": "#161630",
      "--color-background-sidebar": "#111128",
      "--color-background-surface": "#1e1e42",
      "--color-border": "#2a2a52",
      "--color-border-light": "#32325e",
      "--color-text": "#ddddf0",
      "--color-text-secondary": "#9898c0",
      "--color-text-muted": "#606088",
    },
  },
  amber: {
    label: "Amber",
    colors: ["#3d2b14", "#d4870f", "#faf6f0", "#e4d5be"],
    darkColors: ["#1a1208", "#e09820", "#251c0e", "#40301a"],
    vars: {
      "--color-primary": "#3d2b14",
      "--color-primary-light": "#5a4020",
      "--color-primary-lighter": "#7a5830",
      "--color-accent": "#d4870f",
      "--color-accent-light": "#e09820",
      "--color-accent-muted": "rgba(212,135,15,0.12)",
      "--color-background": "#faf6f0",
      "--color-background-card": "#ffffff",
      "--color-background-sidebar": "#f7f2ea",
      "--color-background-surface": "#f0e8db",
      "--color-border": "#e4d5be",
      "--color-border-light": "#eee2d0",
      "--color-text": "#3d2b14",
      "--color-text-secondary": "#6b5538",
      "--color-text-muted": "#a08868",
    },
    darkVars: {
      "--color-primary": "#e0cdb5",
      "--color-primary-light": "#c0a480",
      "--color-primary-lighter": "#a08060",
      "--color-accent": "#e09820",
      "--color-accent-light": "#f0b040",
      "--color-accent-muted": "rgba(224,152,32,0.15)",
      "--color-background": "#1a1208",
      "--color-background-card": "#251c0e",
      "--color-background-sidebar": "#1e1508",
      "--color-background-surface": "#322514",
      "--color-border": "#40301a",
      "--color-border-light": "#4a3820",
      "--color-text": "#f0e8d8",
      "--color-text-secondary": "#c0a480",
      "--color-text-muted": "#887050",
    },
  },
  nordic: {
    label: "Nordic",
    colors: ["#2c3e50", "#16a085", "#f0f3f5", "#ced6dd"],
    darkColors: ["#121a22", "#1abc9c", "#1a2530", "#2c3e50"],
    vars: {
      "--color-primary": "#2c3e50",
      "--color-primary-light": "#3d5568",
      "--color-primary-lighter": "#507080",
      "--color-accent": "#16a085",
      "--color-accent-light": "#1abc9c",
      "--color-accent-muted": "rgba(22,160,133,0.12)",
      "--color-background": "#f0f3f5",
      "--color-background-card": "#ffffff",
      "--color-background-sidebar": "#eaeef1",
      "--color-background-surface": "#e2e8ec",
      "--color-border": "#ced6dd",
      "--color-border-light": "#dde3e8",
      "--color-text": "#2c3e50",
      "--color-text-secondary": "#546e7a",
      "--color-text-muted": "#8da0ae",
    },
    darkVars: {
      "--color-primary": "#b0c4d4",
      "--color-primary-light": "#80a0b5",
      "--color-primary-lighter": "#5a8098",
      "--color-accent": "#1abc9c",
      "--color-accent-light": "#48d1b5",
      "--color-accent-muted": "rgba(26,188,156,0.15)",
      "--color-background": "#121a22",
      "--color-background-card": "#1a2530",
      "--color-background-sidebar": "#152028",
      "--color-background-surface": "#22303d",
      "--color-border": "#2c3e50",
      "--color-border-light": "#344858",
      "--color-text": "#dce4ea",
      "--color-text-secondary": "#8da0ae",
      "--color-text-muted": "#5a7080",
    },
  },
  terracotta: {
    label: "Terracotta",
    colors: ["#5d2e1a", "#558b6e", "#f8f3ef", "#e0d0c2"],
    darkColors: ["#1c120c", "#6aa380", "#281a12", "#453020"],
    vars: {
      "--color-primary": "#5d2e1a",
      "--color-primary-light": "#7a4030",
      "--color-primary-lighter": "#985545",
      "--color-accent": "#558b6e",
      "--color-accent-light": "#6aa380",
      "--color-accent-muted": "rgba(85,139,110,0.12)",
      "--color-background": "#f8f3ef",
      "--color-background-card": "#ffffff",
      "--color-background-sidebar": "#f5eee8",
      "--color-background-surface": "#eee4db",
      "--color-border": "#e0d0c2",
      "--color-border-light": "#eaddd0",
      "--color-text": "#5d2e1a",
      "--color-text-secondary": "#7d5040",
      "--color-text-muted": "#a08070",
    },
    darkVars: {
      "--color-primary": "#d4b8a8",
      "--color-primary-light": "#b89080",
      "--color-primary-lighter": "#987060",
      "--color-accent": "#6aa380",
      "--color-accent-light": "#88c0a0",
      "--color-accent-muted": "rgba(106,163,128,0.15)",
      "--color-background": "#1c120c",
      "--color-background-card": "#281a12",
      "--color-background-sidebar": "#20150e",
      "--color-background-surface": "#352418",
      "--color-border": "#453020",
      "--color-border-light": "#503828",
      "--color-text": "#f0e4da",
      "--color-text-secondary": "#b89080",
      "--color-text-muted": "#887060",
    },
  },
  lavender: {
    label: "Lavender",
    colors: ["#3b2655", "#e06070", "#f5f0f8", "#d8cceb"],
    darkColors: ["#150e20", "#e87888", "#1e152c", "#382850"],
    vars: {
      "--color-primary": "#3b2655",
      "--color-primary-light": "#543a72",
      "--color-primary-lighter": "#6d5090",
      "--color-accent": "#e06070",
      "--color-accent-light": "#e87888",
      "--color-accent-muted": "rgba(224,96,112,0.12)",
      "--color-background": "#f5f0f8",
      "--color-background-card": "#ffffff",
      "--color-background-sidebar": "#f0e8f5",
      "--color-background-surface": "#e8e0f0",
      "--color-border": "#d8cceb",
      "--color-border-light": "#e5ddf0",
      "--color-text": "#3b2655",
      "--color-text-secondary": "#5a4575",
      "--color-text-muted": "#9080a5",
    },
    darkVars: {
      "--color-primary": "#c8b8e0",
      "--color-primary-light": "#a090c0",
      "--color-primary-lighter": "#7868a0",
      "--color-accent": "#e87888",
      "--color-accent-light": "#f098a5",
      "--color-accent-muted": "rgba(232,120,136,0.15)",
      "--color-background": "#150e20",
      "--color-background-card": "#1e152c",
      "--color-background-sidebar": "#1a1125",
      "--color-background-surface": "#2a2040",
      "--color-border": "#382850",
      "--color-border-light": "#40305a",
      "--color-text": "#e8e0f0",
      "--color-text-secondary": "#a090c0",
      "--color-text-muted": "#706088",
    },
  },
};

/* ── Storage keys ─────────────────────────────────────────────── */

const PRESET_KEY = "theme-preset";
const DARK_KEY = "theme-dark";
const CUSTOM_KEY = "theme-custom-vars";

/* ── Theme application ────────────────────────────────────────── */

function applyTheme(
  name: PresetName,
  dark: boolean,
  custom: Record<string, string> = {},
) {
  const el = document.documentElement;
  const preset = PRESETS[name];
  const vars = dark ? preset.darkVars : preset.vars;

  el.classList.toggle("dark", dark);

  // Clear ALL inline CSS custom properties for a clean slate
  const toRemove: string[] = [];
  for (let i = 0; i < el.style.length; i++) {
    const prop = el.style[i];
    if (prop.startsWith("--")) toRemove.push(prop);
  }
  toRemove.forEach((p) => el.style.removeProperty(p));

  // Apply preset vars
  for (const [k, v] of Object.entries(vars)) {
    el.style.setProperty(k, v);
  }

  // Apply custom overrides on top (takes priority over preset)
  for (const [k, v] of Object.entries(custom)) {
    el.style.setProperty(k, v);
  }
}

/* ── Stored state readers ─────────────────────────────────────── */

function readStoredPreset(): PresetName {
  if (typeof window === "undefined") return "claude";
  try {
    const stored = localStorage.getItem(PRESET_KEY);
    // Migrate old default "parchment" → "claude"
    if (stored === "parchment") {
      try {
        localStorage.setItem(PRESET_KEY, "claude");
      } catch {
        /* ignore */
      }
      return "claude";
    }
    return stored && stored in PRESETS ? (stored as PresetName) : "claude";
  } catch {
    return "claude";
  }
}

function readStoredDark(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const stored = localStorage.getItem(DARK_KEY);
    if (stored !== null) return stored === "true";
  } catch {
    // Fall through to system preference
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStoredCustom(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(CUSTOM_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/* ── Eagerly apply on module load (before React mounts) ──────── */

const _initialPreset = readStoredPreset();
const _initialDark = readStoredDark();
const _initialCustom = readStoredCustom();
applyTheme(_initialPreset, _initialDark, _initialCustom);

/* ── External store for cross-component sync ─────────────────── */

type Listener = () => void;

interface ThemeState {
  preset: PresetName;
  isDark: boolean;
  customVars: Record<string, string>;
}

let _state: ThemeState = {
  preset: _initialPreset,
  isDark: _initialDark,
  customVars: _initialCustom,
};
const _listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function getSnapshot(): ThemeState {
  return _state;
}

function setState(next: ThemeState) {
  if (
    _state.preset === next.preset &&
    _state.isDark === next.isDark &&
    _state.customVars === next.customVars
  )
    return;
  _state = next;
  applyTheme(next.preset, next.isDark, next.customVars);
  try {
    localStorage.setItem(PRESET_KEY, next.preset);
    localStorage.setItem(DARK_KEY, String(next.isDark));
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(next.customVars));
  } catch {
    // Silently ignore storage errors (private mode, quota exceeded)
  }
  _listeners.forEach((fn) => fn());
}

/* ── Hook ─────────────────────────────────────────────────────── */

export function useThemePreset() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setPreset = useCallback((name: PresetName) => {
    // Changing preset clears custom overrides
    setState({ preset: name, isDark: getSnapshot().isDark, customVars: {} });
  }, []);

  const setDark = useCallback((dark: boolean) => {
    setState({ ...getSnapshot(), isDark: dark });
  }, []);

  const toggleDark = useCallback(() => {
    const cur = getSnapshot();
    setState({ ...cur, isDark: !cur.isDark });
  }, []);

  const resetPreset = useCallback(() => {
    setState({ preset: "claude", isDark: false, customVars: {} });
  }, []);

  const setCustomVar = useCallback((name: string, value: string) => {
    const cur = getSnapshot();
    setState({ ...cur, customVars: { ...cur.customVars, [name]: value } });
  }, []);

  const clearCustomVars = useCallback(() => {
    const cur = getSnapshot();
    setState({ ...cur, customVars: {} });
  }, []);

  return {
    preset: state.preset,
    isDark: state.isDark,
    customVars: state.customVars,
    setPreset,
    setDark,
    toggleDark,
    resetPreset,
    setCustomVar,
    clearCustomVars,
    presets: PRESETS,
  } as const;
}
