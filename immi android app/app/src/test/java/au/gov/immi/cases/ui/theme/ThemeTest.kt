package au.gov.immi.cases.ui.theme

import androidx.compose.ui.graphics.Color
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ThemeTest {

    // ── Design Token Verification ─────────────────────────────────────────────

    @Test
    fun `primaryDefault matches webapp primary (#1b2838 deep blue-gray)`() {
        assertEquals(Color(0xFF1b2838), DesignTokens.Colors.primaryDefault)
    }

    @Test
    fun `bgDefault is warm beige (not cold slate)`() {
        // Webapp background.DEFAULT = #f5f4f1 (warm beige)
        assertEquals(Color(0xFFf5f4f1), DesignTokens.Colors.bgDefault)
    }

    @Test
    fun `accentLight is golden-brown (not blue or violet)`() {
        // Webapp accent.light = #d4a017
        assertEquals(Color(0xFFd4a017), DesignTokens.Colors.accentLight)
    }

    @Test
    fun `dark background is darker than light background`() {
        // Light: #f5f4f1 | Dark: #111820
        assertTrue(DesignTokens.Colors.bgDefault.red > DesignTokens.DarkColors.bgDefault.red)
        assertTrue(DesignTokens.Colors.bgDefault.green > DesignTokens.DarkColors.bgDefault.green)
        assertTrue(DesignTokens.Colors.bgDefault.blue > DesignTokens.DarkColors.bgDefault.blue)
    }

    @Test
    fun `dark card is darker than light card`() {
        // Light card: #ffffff | Dark card: #192230
        assertTrue(DesignTokens.Colors.bgCard.red > DesignTokens.DarkColors.bgCard.red)
    }

    @Test
    fun `semantic danger color defined`() {
        assertEquals(Color(0xFFa83232), DesignTokens.Colors.danger)
    }

    @Test
    fun `semantic success color defined`() {
        assertEquals(Color(0xFF236238), DesignTokens.Colors.success)
    }

    // ── Outcome Colors ────────────────────────────────────────────────────────

    @Test
    fun `OutcomeGranted is green`() {
        assertEquals(Color(0xFF22c55e), OutcomeGranted)
    }

    @Test
    fun `OutcomeDismissed is red`() {
        assertEquals(Color(0xFFef4444), OutcomeDismissed)
    }

    @Test
    fun `OutcomeColors map accessible via index operator`() {
        val outcomeColors = au.gov.immi.cases.core.model.OutcomeColors
        assertEquals(OutcomeGranted,   outcomeColors["Granted"])
        assertEquals(OutcomeDismissed, outcomeColors["Dismissed"])
        assertEquals(OutcomeAffirmed,  outcomeColors["Affirmed"])
    }

    @Test
    fun `All outcome semantic colors are distinct`() {
        val colors = listOf(
            OutcomeGranted, OutcomeAllowed, OutcomeAffirmed, OutcomeDismissed,
            OutcomeRemitted, OutcomeSetAside, OutcomeRefused, OutcomeWithdrawn,
            OutcomeQuashed, OutcomeVaried
        )
        assertEquals(colors.size, colors.distinct().size)
    }

    // ── Typography ────────────────────────────────────────────────────────────

    @Test
    fun `ImmiTypography titleLarge has SemiBold weight`() {
        assertEquals(
            androidx.compose.ui.text.font.FontWeight.SemiBold,
            ImmiTypography.titleLarge.fontWeight
        )
    }

    @Test
    fun `ImmiTypography bodyMedium has 14sp size`() {
        assertEquals(14, ImmiTypography.bodyMedium.fontSize.value.toInt())
    }

    @Test
    fun `ImmiTypography displayLarge has Bold weight`() {
        assertEquals(
            androidx.compose.ui.text.font.FontWeight.Bold,
            ImmiTypography.displayLarge.fontWeight
        )
    }

    @Test
    fun `ImmiTypography labelSmall has 11sp size`() {
        assertEquals(11, ImmiTypography.labelSmall.fontSize.value.toInt())
    }

    @Test
    fun `ImmiTypography headlineLarge uses CrimsonText`() {
        assertEquals(CrimsonText, ImmiTypography.headlineLarge.fontFamily)
    }

    @Test
    fun `ImmiTypography bodyLarge uses Merriweather`() {
        assertEquals(Merriweather, ImmiTypography.bodyLarge.fontFamily)
    }

    // ── Spacing & Radius Tokens ───────────────────────────────────────────────

    @Test
    fun `base spacing is 16dp`() {
        assertEquals(16f, DesignTokens.Spacing.base.value)
    }

    @Test
    fun `card radius is 16dp`() {
        assertEquals(16f, DesignTokens.Radius.default.value)
    }

    @Test
    fun `badge radius is 4dp`() {
        assertEquals(4f, DesignTokens.Radius.badge.value)
    }

    // ── Court Colors ──────────────────────────────────────────────────────────

    @Test
    fun `court colors are all distinct`() {
        val courts = listOf(
            DesignTokens.CourtColors.AATA,
            DesignTokens.CourtColors.ARTA,
            DesignTokens.CourtColors.FCA,
            DesignTokens.CourtColors.FCCA,
            DesignTokens.CourtColors.FedCFamC2G,
            DesignTokens.CourtColors.HCA,
            DesignTokens.CourtColors.RRTA,
            DesignTokens.CourtColors.MRTA,
            DesignTokens.CourtColors.FMCA,
        )
        assertEquals(courts.size, courts.distinct().size, "All 9 courts need unique colors")
    }
}
