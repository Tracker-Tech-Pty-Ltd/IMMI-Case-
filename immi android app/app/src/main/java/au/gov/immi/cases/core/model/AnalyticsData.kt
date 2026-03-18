package au.gov.immi.cases.core.model

/**
 * A single outcome bucket (e.g. "Granted" → 5 000 cases, 33.3 %).
 */
data class OutcomeEntry(
    val label: String,
    val count: Int,
    val percentage: Double = 0.0
)

/**
 * A judge entry as returned by the leaderboard / compare endpoints.
 */
data class JudgeEntry(
    val name: String,
    val totalCases: Int,
    val successRate: Double
)

/**
 * One cell of the nature-outcome matrix.
 */
data class NatureOutcomeEntry(
    val nature: String,
    val outcome: String,
    val count: Int
)

/**
 * A legal concept with usage count and effectiveness score.
 */
data class ConceptEntry(
    val concept: String,
    val count: Int,
    val effectiveness: Double = 0.0
)
