package au.gov.immi.cases.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Single source of truth for all design tokens.
 * Values mirror the webapp's frontend/src/tokens/tokens.json exactly,
 * ensuring a unified design language across web and Android.
 */
object DesignTokens {

    // ── Light Mode Colors ─────────────────────────────────────────────────────
    object Colors {
        // Primary (deep blue-gray — webapp: primary.*)
        val primaryDefault = Color(0xFF1b2838)
        val primaryLight   = Color(0xFF2a3f55)
        val primaryLighter = Color(0xFF3a5572)

        // Accent (golden-brown — webapp: accent.*)
        val accentDefault  = Color(0xFF5c4306)
        val accentLight    = Color(0xFFd4a017)
        val accentMuted    = Color(0x1FB8860B)   // rgba(184,134,11, 0.12)

        // Backgrounds (warm beige/cream — webapp: background.*)
        val bgDefault      = Color(0xFFf5f4f1)   // warm beige page background
        val bgCard         = Color(0xFFFFFFFF)   // pure white cards
        val bgSidebar      = Color(0xFFfaf9f7)   // very light warm
        val bgSurface      = Color(0xFFf0efec)   // slightly darker beige
        val bgSurfaceHover = Color(0xFFe6e4e0)   // hover state

        // Text
        val textDefault    = Color(0xFF1b2838)   // matches primaryDefault
        val textSecondary  = Color(0xFF4a5568)
        val textMuted      = Color(0xFF8b8680)

        // Borders
        val borderDefault  = Color(0xFF6e7177)
        val borderLight    = Color(0xFFEAE8E3)

        // Semantic
        val success        = Color(0xFF236238)
        val warning        = Color(0xFF7d5b07)
        val danger         = Color(0xFFa83232)
        val info           = Color(0xFF2a6496)
    }

    // ── Dark Mode Colors ──────────────────────────────────────────────────────
    object DarkColors {
        val bgDefault      = Color(0xFF111820)   // webapp dark: background.DEFAULT
        val bgCard         = Color(0xFF192230)   // webapp dark: background.card
        val bgSidebar      = Color(0xFF141c28)   // webapp dark: background.sidebar
        val bgSurface      = Color(0xFF1e2a3a)
        val textDefault    = Color(0xFFe2dfda)   // warm off-white
        val textSecondary  = Color(0xFF9ca3af)
        val textMuted      = Color(0xFF6b7280)
        val borderDefault  = Color(0xFF374151)
        val borderLight    = Color(0xFF1f2937)
        val primaryDefault = Color(0xFF3a5572)   // lighter for dark bg
    }

    // ── Court Brand Colors (same in light & dark — webapp: courtColors) ───────
    // These match the webapp's tokens.json exactly. Never change per theme.
    object CourtColors {
        val AATA       = Color(0xFF1a5276)   // deep blue
        val ARTA       = Color(0xFF6c3483)   // deep purple
        val FCA        = Color(0xFF117864)   // deep teal
        val FCCA       = Color(0xFFb9770e)   // orange-brown
        val FedCFamC2G = Color(0xFFa93226)   // brick red
        val HCA        = Color(0xFF1b2631)   // near black
        val RRTA       = Color(0xFF1e8449)   // forest green
        val MRTA       = Color(0xFF922b5f)   // wine red
        val FMCA       = Color(0xFFb84c00)   // orange-red
        val default    = Color(0xFF6b7280)   // fallback gray

        operator fun get(courtCode: String): Color = when (courtCode.uppercase()) {
            "AATA"       -> AATA
            "ARTA"       -> ARTA
            "FCA"        -> FCA
            "FCCA"       -> FCCA
            "FEDCFAMC2G" -> FedCFamC2G
            "HCA"        -> HCA
            "RRTA"       -> RRTA
            "MRTA"       -> MRTA
            "FMCA"       -> FMCA
            else         -> default
        }
    }

    // ── Spacing Scale (8dp base system — webapp: spacing.*) ──────────────────
    object Spacing {
        val xs   = 4.dp    // spacing.1
        val sm   = 8.dp    // spacing.2
        val md   = 12.dp   // spacing.3
        val base = 16.dp   // spacing.4
        val lg   = 24.dp   // spacing.6
        val xl   = 32.dp   // spacing.8
    }

    // ── Border Radius Scale (webapp: radius.*) ────────────────────────────────
    object Radius {
        val badge   = 4.dp      // small chips/badges
        val sm      = 10.7.dp   // webapp: 0.670rem
        val default = 16.dp     // webapp: 1rem (cards)
        val lg      = 21.3.dp   // webapp: 1.330rem
        val pill    = 32.dp     // webapp: 2rem
    }

    // ── Elevation (approximates webapp shadow tokens) ─────────────────────────
    object Elevation {
        val xs = 1.dp   // shadow-xs
        val sm = 2.dp   // shadow-sm
        val md = 4.dp   // shadow-DEFAULT
        val lg = 8.dp   // shadow-lg
    }

    // ── Helper: semantic alpha variants (webapp: bg-success/10) ──────────────
    fun Color.withAlpha(alpha: Float): Color = this.copy(alpha = alpha)
}
