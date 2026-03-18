package au.gov.immi.cases.core.model

import androidx.compose.ui.graphics.Color
import au.gov.immi.cases.ui.theme.DesignTokens

/**
 * Maps outcome strings to semantic colors.
 * Matches the web version's OutcomeBadge color logic.
 * Use [OutcomeColors[outcome]] — never returns null (falls back to defaultColor).
 */
object OutcomeColors {
    val defaultColor: Color = Color(0xFF9ca3af)

    private val map: Map<String, Color> = mapOf(
        "Granted"         to Color(0xFF22c55e),
        "Allowed"         to Color(0xFF3b82f6),
        "Affirmed"        to Color(0xFF64748b),
        "Dismissed"       to Color(0xFFef4444),
        "Remitted"        to Color(0xFF8b5cf6),
        "Set Aside"       to Color(0xFFf59e0b),
        "Refused"         to Color(0xFFdc2626),
        "Withdrawn"       to Color(0xFF94a3b8),
        "Quashed"         to Color(0xFF06b6d4),
        "Varied"          to Color(0xFFa855f7),
        "No Jurisdiction" to Color(0xFF6b7280),
        "Other"           to Color(0xFF9ca3af)
    )

    operator fun get(outcome: String): Color = map[outcome] ?: defaultColor

    fun getOrDefault(outcome: String, default: Color = defaultColor): Color =
        map.getOrDefault(outcome, default)
}

/**
 * Maps court codes to brand colors sourced from DesignTokens.CourtColors.
 * Colors match the webapp's tokens.json courtColors exactly.
 * Use [CourtColors[courtCode]] — never returns null (falls back to defaultColor).
 */
object CourtColors {
    val defaultColor: Color = DesignTokens.CourtColors.default

    operator fun get(courtCode: String): Color = DesignTokens.CourtColors[courtCode]

    fun getOrDefault(courtCode: String, default: Color = defaultColor): Color =
        DesignTokens.CourtColors[courtCode].let {
            if (it == DesignTokens.CourtColors.default && courtCode.isNotBlank()) default else it
        }
}
