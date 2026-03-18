package au.gov.immi.cases.core.model

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*

class OutcomeColorTest {

    private val allStandardOutcomes = listOf(
        "Granted", "Allowed", "Affirmed", "Dismissed",
        "Remitted", "Set Aside", "Refused", "Withdrawn",
        "Quashed", "Varied", "No Jurisdiction", "Other"
    )

    @Test
    fun `all standard outcomes have a color defined`() {
        allStandardOutcomes.forEach { outcome ->
            assertNotNull(
                OutcomeColors[outcome],
                "Missing color for outcome: $outcome"
            )
        }
    }

    @Test
    fun `unknown outcome returns default color`() {
        val color = OutcomeColors.getOrDefault("Unknown Outcome", OutcomeColors.defaultColor)
        assertNotNull(color)
    }

    @Test
    fun `all 9 court codes have colors`() {
        val allCourts = listOf("AATA", "ARTA", "FCA", "FCCA", "FMCA", "FedCFamC2G", "HCA", "MRTA", "RRTA")
        allCourts.forEach { court ->
            assertNotNull(
                CourtColors[court],
                "Missing color for court: $court"
            )
        }
    }
}
