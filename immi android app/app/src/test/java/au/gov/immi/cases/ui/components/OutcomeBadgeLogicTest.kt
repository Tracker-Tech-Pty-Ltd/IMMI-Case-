package au.gov.immi.cases.ui.components

import androidx.compose.ui.graphics.Color
import au.gov.immi.cases.core.model.ImmigrationCase
import au.gov.immi.cases.core.model.OutcomeColors
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class OutcomeBadgeLogicTest {

    @Test
    fun `Granted outcome uses green color`() {
        val color = OutcomeColors["Granted"]
        assertEquals(Color(0xFF22c55e), color)
    }

    @Test
    fun `unknown outcome uses default gray`() {
        val color = OutcomeColors["Unknown Outcome"]
        assertEquals(OutcomeColors.defaultColor, color)
    }

    @Test
    fun `all winning outcomes have non-gray colors`() {
        val winningOutcomes = ImmigrationCase.WINNING_OUTCOMES
        winningOutcomes.forEach { outcome ->
            assertNotEquals(
                OutcomeColors.defaultColor, OutcomeColors[outcome],
                "Winning outcome '$outcome' should have a distinct color"
            )
        }
    }

    @Test
    fun `Dismissed and Refused are red-family colors`() {
        val dismissed = OutcomeColors["Dismissed"]
        val refused = OutcomeColors["Refused"]
        // Both should have high red channel
        assertTrue(dismissed.red > 0.8f, "Dismissed should have high red channel")
        assertTrue(refused.red > 0.8f, "Refused should have high red channel")
    }

    @Test
    fun `color copy alpha produces semi-transparent version`() {
        val baseColor = OutcomeColors["Granted"]
        val semiTransparent = baseColor.copy(alpha = 0.15f)
        assertEquals(0.15f, semiTransparent.alpha, 0.001f)
    }

    @Test
    fun `OutcomeColors supports bracket operator syntax`() {
        val color: Color = OutcomeColors["Granted"]
        assertNotNull(color)
    }
}
