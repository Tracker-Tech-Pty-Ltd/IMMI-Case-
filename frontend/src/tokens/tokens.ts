/* Auto-generated from tokens.json — do not edit manually */
/* Generated: 2026-03-18T20:15:41.361Z */

export const tokens = {
  "color": {
    "primary": {
      "DEFAULT": "#1b2838",
      "light": "#2a3f55",
      "lighter": "#3a5572"
    },
    "accent": {
      "DEFAULT": "#5c4306",
      "light": "#d4a017",
      "muted": "rgba(184,134,11,0.12)"
    },
    "background": {
      "DEFAULT": "#f5f4f1",
      "card": "#ffffff",
      "sidebar": "#faf9f7",
      "surface": "#f0efec",
      "surface-hover": "#e6e4e0"
    },
    "chart": {
      "2": "#8b5cf6",
      "3": "#10b981",
      "4": "#3b82f6",
      "5": "#f59e0b"
    },
    "border": {
      "DEFAULT": "#6e7177",
      "light": "#eae8e3"
    },
    "text": {
      "DEFAULT": "#1b2838",
      "secondary": "#4a5568",
      "muted": "#8b8680"
    },
    "semantic": {
      "success": "#236238",
      "warning": "#7d5b07",
      "danger": "#a83232",
      "info": "#2a6496"
    },
    "court": {
      "AATA": "#1a5276",
      "ARTA": "#6c3483",
      "FCA": "#117864",
      "FCCA": "#b9770e",
      "FedCFamC2G": "#a93226",
      "HCA": "#1b2631",
      "RRTA": "#1e8449",
      "MRTA": "#922b5f",
      "FMCA": "#b84c00"
    },
    "dark": {
      "primary": {
        "DEFAULT": "#d0d4da",
        "light": "#a8b2be",
        "lighter": "#5a7f9f"
      },
      "accent": {
        "DEFAULT": "#c9942e",
        "light": "#e0b04a",
        "muted": "rgba(201, 148, 46, 0.12)"
      },
      "background": {
        "DEFAULT": "#111820",
        "card": "#192230",
        "sidebar": "#141c28",
        "surface": "#1c2535",
        "surface-hover": "#243144"
      },
      "chart": {
        "2": "#a78bfa",
        "3": "#34d399",
        "4": "#60a5fa",
        "5": "#fbbf24"
      },
      "border": {
        "DEFAULT": "#4a5060",
        "light": "#2d3748"
      },
      "text": {
        "DEFAULT": "#e2dfda",
        "secondary": "#a4acb8",
        "muted": "#6d7788"
      },
      "semantic": {
        "success": "#3da55d",
        "warning": "#d4a017",
        "danger": "#d04848",
        "info": "#4a90c4"
      },
      "court": {
        "AATA": "#1a5276",
        "ARTA": "#6c3483",
        "FCA": "#117864",
        "FCCA": "#b9770e",
        "FedCFamC2G": "#a93226",
        "HCA": "#1b2631",
        "RRTA": "#1e8449",
        "MRTA": "#922b5f",
        "FMCA": "#b84c00"
      }
    }
  },
  "typography": {
    "fontFamily": {
      "heading": [
        "Crimson Text",
        "Georgia",
        "Times New Roman",
        "serif"
      ],
      "body": [
        "Merriweather",
        "Georgia",
        "serif"
      ],
      "mono": [
        "SF Mono",
        "Fira Code",
        "Consolas",
        "monospace"
      ]
    },
    "lineHeight": {
      "tight": "1.2",
      "normal": "1.5",
      "relaxed": "1.75",
      "loose": "2"
    },
    "letterSpacing": {
      "tight": "-0.015em",
      "normal": "0",
      "wide": "0.025em"
    },
    "fontWeight": {
      "light": "300",
      "regular": "400",
      "medium": "500",
      "semibold": "600",
      "bold": "700"
    }
  },
  "spacing": {
    "1": "0.25rem",
    "2": "0.5rem",
    "3": "0.75rem",
    "4": "1rem",
    "5": "1.25rem",
    "6": "1.5rem",
    "8": "2rem"
  },
  "radius": {
    "sm": "0.670rem",
    "DEFAULT": "1rem",
    "lg": "1.330rem",
    "pill": "2rem"
  },
  "shadow": {
    "xs": "0 1px 2px rgba(27,40,56,0.04)",
    "sm": "0 1px 3px rgba(27,40,56,0.06), 0 1px 2px rgba(27,40,56,0.04)",
    "DEFAULT": "0 2px 6px rgba(27,40,56,0.08)",
    "lg": "0 4px 12px rgba(27,40,56,0.1)"
  },
  "opacity": {
    "0": "0",
    "10": "0.1",
    "20": "0.2",
    "30": "0.3",
    "50": "0.5",
    "75": "0.75",
    "100": "1"
  },
  "zIndex": {
    "base": "0",
    "dropdown": "50",
    "popover": "100",
    "tooltip": "150",
    "modal": "999",
    "toast": "1000"
  },
  "animation": {
    "duration": {
      "fast": "150ms",
      "normal": "300ms",
      "slow": "500ms"
    },
    "easing": {
      "ease-in": "cubic-bezier(0.4, 0, 1, 1)",
      "ease-out": "cubic-bezier(0, 0, 0.2, 1)",
      "ease-in-out": "cubic-bezier(0.4, 0, 0.2, 1)"
    }
  }
} as const

export const courtColors = {
  AATA: "#1a5276",
  ARTA: "#6c3483",
  FCA: "#117864",
  FCCA: "#b9770e",
  FedCFamC2G: "#a93226",
  HCA: "#1b2631",
  RRTA: "#1e8449",
  MRTA: "#922b5f",
  FMCA: "#b84c00",
} as const

export type CourtColor = keyof typeof courtColors

/** Lookup helper: accepts any string and returns the court color or undefined */
export function getCourtColor(court: string): string | undefined {
  return (courtColors as Record<string, string>)[court]
}

export const semanticColors = {
  success: "#236238",
  warning: "#7d5b07",
  danger: "#a83232",
  info: "#2a6496",
} as const

export type SemanticColor = keyof typeof semanticColors

export const spacing = {
  "1": "0.25rem",
  "2": "0.5rem",
  "3": "0.75rem",
  "4": "1rem",
  "5": "1.25rem",
  "6": "1.5rem",
  "8": "2rem",
} as const

export const radius = {
  sm: "0.670rem",
  DEFAULT: "1rem",
  lg: "1.330rem",
  pill: "2rem",
} as const

export const shadow = {
  xs: "0 1px 2px rgba(27,40,56,0.04)",
  sm: "0 1px 3px rgba(27,40,56,0.06), 0 1px 2px rgba(27,40,56,0.04)",
  DEFAULT: "0 2px 6px rgba(27,40,56,0.08)",
  lg: "0 4px 12px rgba(27,40,56,0.1)",
} as const

export const zIndex = {
  base: "0",
  dropdown: "50",
  popover: "100",
  tooltip: "150",
  modal: "999",
  toast: "1000",
} as const

export const opacity = {
  "0": "0",
  "10": "0.1",
  "20": "0.2",
  "30": "0.3",
  "50": "0.5",
  "75": "0.75",
  "100": "1",
} as const

export const animationDuration = {
  fast: "150ms",
  normal: "300ms",
  slow: "500ms",
} as const

export const animationEasing = {
  "ease-in": "cubic-bezier(0.4, 0, 1, 1)",
  "ease-out": "cubic-bezier(0, 0, 0.2, 1)",
  "ease-in-out": "cubic-bezier(0.4, 0, 0.2, 1)",
} as const

