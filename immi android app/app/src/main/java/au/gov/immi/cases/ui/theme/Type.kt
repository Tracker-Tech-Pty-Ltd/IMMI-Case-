package au.gov.immi.cases.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import au.gov.immi.cases.R

// ── Custom Font Families ──────────────────────────────────────────────────────
// Mirrors webapp: font.heading = "Crimson Text" (serif, legal/government feel)
val CrimsonText = FontFamily(
    Font(R.font.crimson_text_regular,  FontWeight.Normal),
    Font(R.font.crimson_text_semibold, FontWeight.SemiBold),
    Font(R.font.crimson_text_bold,     FontWeight.Bold),
)

// Mirrors webapp: font.body = "Merriweather" (serif, high readability for long text)
val Merriweather = FontFamily(
    Font(R.font.merriweather_light,   FontWeight.Light),
    Font(R.font.merriweather_regular, FontWeight.Normal),
    Font(R.font.merriweather_bold,    FontWeight.Bold),
)

// ── Typography Scale ──────────────────────────────────────────────────────────
// Heading styles use CrimsonText (formal, authoritative).
// Body/Label styles use Merriweather (readable for case text).
// Font sizes and weights mirror the webapp token scale.
val ImmiTypography = Typography(

    // Display — large statistics & hero numbers
    displayLarge = TextStyle(
        fontFamily  = CrimsonText,
        fontWeight  = FontWeight.Bold,
        fontSize    = 57.sp,
        lineHeight  = 64.sp,
    ),
    displayMedium = TextStyle(
        fontFamily  = CrimsonText,
        fontWeight  = FontWeight.Bold,
        fontSize    = 45.sp,
        lineHeight  = 52.sp,
    ),

    // Headline — page titles and major section headers
    headlineLarge = TextStyle(
        fontFamily    = CrimsonText,
        fontWeight    = FontWeight.SemiBold,
        fontSize      = 32.sp,
        lineHeight    = 40.sp,
        letterSpacing = (-0.5).sp,   // webapp: letterSpacing.tight = -0.015em
    ),
    headlineMedium = TextStyle(
        fontFamily  = CrimsonText,
        fontWeight  = FontWeight.SemiBold,
        fontSize    = 28.sp,
        lineHeight  = 36.sp,
    ),
    headlineSmall = TextStyle(
        fontFamily  = CrimsonText,
        fontWeight  = FontWeight.SemiBold,
        fontSize    = 24.sp,
        lineHeight  = 32.sp,
    ),

    // Title — card titles, section headers, drawer items
    titleLarge = TextStyle(
        fontFamily  = CrimsonText,
        fontWeight  = FontWeight.SemiBold,
        fontSize    = 22.sp,
        lineHeight  = 28.sp,
    ),
    titleMedium = TextStyle(
        fontFamily  = Merriweather,
        fontWeight  = FontWeight.Medium,
        fontSize    = 16.sp,
        lineHeight  = 24.sp,
    ),
    titleSmall = TextStyle(
        fontFamily  = Merriweather,
        fontWeight  = FontWeight.Medium,
        fontSize    = 14.sp,
        lineHeight  = 20.sp,
    ),

    // Body — main content, case descriptions, list items
    bodyLarge = TextStyle(
        fontFamily  = Merriweather,
        fontWeight  = FontWeight.Normal,
        fontSize    = 16.sp,
        lineHeight  = 24.sp,   // webapp: lineHeight.normal = 1.5
    ),
    bodyMedium = TextStyle(
        fontFamily  = Merriweather,
        fontWeight  = FontWeight.Normal,
        fontSize    = 14.sp,
        lineHeight  = 21.sp,
    ),
    bodySmall = TextStyle(
        fontFamily  = Merriweather,
        fontWeight  = FontWeight.Normal,
        fontSize    = 12.sp,
        lineHeight  = 18.sp,
    ),

    // Label — badges, chips, captions, navigation items
    labelLarge = TextStyle(
        fontFamily  = Merriweather,
        fontWeight  = FontWeight.Medium,
        fontSize    = 14.sp,
        lineHeight  = 20.sp,
    ),
    labelMedium = TextStyle(
        fontFamily  = Merriweather,
        fontWeight  = FontWeight.Medium,
        fontSize    = 12.sp,
        lineHeight  = 16.sp,
    ),
    labelSmall = TextStyle(
        fontFamily  = Merriweather,
        fontWeight  = FontWeight.Medium,
        fontSize    = 11.sp,
        lineHeight  = 16.sp,
    ),
)
