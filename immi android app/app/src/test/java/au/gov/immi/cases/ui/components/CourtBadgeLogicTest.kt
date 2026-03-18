package au.gov.immi.cases.ui.components

import androidx.compose.ui.graphics.Color
import au.gov.immi.cases.core.model.CourtColors
import au.gov.immi.cases.ui.theme.DesignTokens
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class CourtBadgeLogicTest {

    @Test
    fun `AATA court uses webapp deep blue`() {
        val color = CourtColors["AATA"]
        // Matches webapp tokens.json courtColors.AATA = #1a5276
        assertEquals(Color(0xFF1a5276), color)
    }

    @Test
    fun `HCA court uses near-black`() {
        val color = CourtColors["HCA"]
        // Matches webapp tokens.json courtColors.HCA = #1b2631
        assertEquals(Color(0xFF1b2631), color)
    }

    @Test
    fun `ARTA court uses deep purple`() {
        val color = CourtColors["ARTA"]
        assertEquals(Color(0xFF6c3483), color)
    }

    @Test
    fun `FCA court uses deep teal`() {
        val color = CourtColors["FCA"]
        assertEquals(Color(0xFF117864), color)
    }

    @Test
    fun `unknown court uses default gray`() {
        val color = CourtColors["XYZ_UNKNOWN"]
        assertEquals(CourtColors.defaultColor, color)
    }

    @Test
    fun `all 9 known courts have distinct colors`() {
        val courts = listOf("AATA", "ARTA", "FCA", "FCCA", "FMCA", "FedCFamC2G", "HCA", "MRTA", "RRTA")
        val colors = courts.map { CourtColors[it] }
        assertEquals(courts.size, colors.distinct().size, "All courts should have unique colors")
    }

    @Test
    fun `court colors match DesignTokens exactly`() {
        assertEquals(DesignTokens.CourtColors.AATA, CourtColors["AATA"])
        assertEquals(DesignTokens.CourtColors.HCA,  CourtColors["HCA"])
        assertEquals(DesignTokens.CourtColors.MRTA, CourtColors["MRTA"])
        assertEquals(DesignTokens.CourtColors.RRTA, CourtColors["RRTA"])
    }
}
