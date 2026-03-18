package au.gov.immi.cases.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// ── Light Color Scheme ────────────────────────────────────────────────────────
// Mirrors webapp tokens.json light mode exactly.
// Background: warm beige (#f5f4f1) | Primary: deep blue-gray (#1b2838)
// Accent/Secondary: golden-brown (#d4a017) | Borders: soft warm gray
private val LightColorScheme = lightColorScheme(
    primary              = DesignTokens.Colors.primaryDefault,    // #1b2838
    onPrimary            = Color.White,
    primaryContainer     = DesignTokens.Colors.primaryLighter,    // #3a5572
    onPrimaryContainer   = Color.White,
    secondary            = DesignTokens.Colors.accentLight,       // #d4a017 golden-brown
    onSecondary          = DesignTokens.Colors.primaryDefault,
    secondaryContainer   = DesignTokens.Colors.accentMuted,
    onSecondaryContainer = DesignTokens.Colors.accentDefault,
    background           = DesignTokens.Colors.bgDefault,         // #f5f4f1 warm beige
    onBackground         = DesignTokens.Colors.textDefault,
    surface              = DesignTokens.Colors.bgCard,            // #ffffff white cards
    onSurface            = DesignTokens.Colors.textDefault,
    surfaceVariant       = DesignTokens.Colors.bgSurface,         // #f0efec
    onSurfaceVariant     = DesignTokens.Colors.textSecondary,     // #4a5568
    outline              = DesignTokens.Colors.borderDefault,     // #6e7177
    outlineVariant       = DesignTokens.Colors.borderLight,       // #eae8e3
    error                = DesignTokens.Colors.danger,            // #a83232
    onError              = Color.White,
    scrim                = DesignTokens.Colors.primaryDefault.copy(alpha = 0.32f),
)

// ── Dark Color Scheme ─────────────────────────────────────────────────────────
// Mirrors webapp tokens.json dark mode.
// Background: #111820 (near-black blue) | Cards: #192230 | Text: #e2dfda (warm off-white)
private val DarkColorScheme = darkColorScheme(
    primary              = DesignTokens.DarkColors.primaryDefault,  // #3a5572 lighter
    onPrimary            = Color.White,
    primaryContainer     = DesignTokens.Colors.primaryLight,
    onPrimaryContainer   = Color.White,
    secondary            = DesignTokens.Colors.accentLight,
    onSecondary          = DesignTokens.Colors.primaryDefault,
    background           = DesignTokens.DarkColors.bgDefault,       // #111820
    onBackground         = DesignTokens.DarkColors.textDefault,     // #e2dfda
    surface              = DesignTokens.DarkColors.bgCard,          // #192230
    onSurface            = DesignTokens.DarkColors.textDefault,
    surfaceVariant       = DesignTokens.DarkColors.bgSurface,       // #1e2a3a
    onSurfaceVariant     = DesignTokens.DarkColors.textSecondary,   // #9ca3af
    outline              = DesignTokens.DarkColors.borderDefault,   // #374151
    outlineVariant       = DesignTokens.DarkColors.borderLight,     // #1f2937
    error                = Color(0xFFf87171),                       // lighter red for dark bg
    onError              = Color(0xFF7f1d1d),
    scrim                = Color(0xFF000000).copy(alpha = 0.5f),
)

// ── Shape Scale ───────────────────────────────────────────────────────────────
// Maps webapp radius tokens to Material 3 Shapes.
val ImmiShapes = Shapes(
    extraSmall = RoundedCornerShape(DesignTokens.Radius.badge),    // 4dp  — badges/chips
    small      = RoundedCornerShape(DesignTokens.Radius.sm),       // 10.7dp
    medium     = RoundedCornerShape(DesignTokens.Radius.default),  // 16dp — cards
    large      = RoundedCornerShape(DesignTokens.Radius.lg),       // 21.3dp
    extraLarge = RoundedCornerShape(DesignTokens.Radius.pill),     // 32dp — pill buttons
)

// ── Theme Entry Point ─────────────────────────────────────────────────────────
@Composable
fun ImmiTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
    MaterialTheme(
        colorScheme = colorScheme,
        typography  = ImmiTypography,
        shapes      = ImmiShapes,
        content     = content
    )
}
