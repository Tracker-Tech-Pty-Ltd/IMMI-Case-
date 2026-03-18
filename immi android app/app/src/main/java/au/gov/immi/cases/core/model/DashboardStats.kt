package au.gov.immi.cases.core.model

/**
 * Aggregated dashboard statistics from the /api/v1/stats endpoint.
 *
 * All fields default to safe empty values so callers don't need null-checks.
 */
data class DashboardStats(
    val totalCases: Int = 0,
    val courts: Map<String, Int> = emptyMap(),
    val outcomes: Map<String, Int> = emptyMap(),
    val withFullText: Int = 0,
    val recentCasesCount: Int = 0
) {
    companion object {
        /**
         * Parse a raw [Map<String, Any>] returned by the stats API into a
         * typed [DashboardStats] instance.  All casts are safe — missing keys
         * or wrong types fall back to zero / empty.
         *
         * API shape: {total_cases, courts, natures, recent_cases (list),
         *             with_full_text, sources, years, ...}
         * Note: no success_rate field — use with_full_text instead.
         */
        @Suppress("UNCHECKED_CAST")
        fun fromApiMap(data: Map<String, Any>): DashboardStats {
            val totalCases = (data["total_cases"] as? Number)?.toInt() ?: 0
            val courts = (data["courts"] as? Map<String, Any>)
                ?.mapValues { (_, v) -> (v as? Number)?.toInt() ?: 0 }
                ?: emptyMap()
            val outcomes = (data["outcomes"] as? Map<String, Any>)
                ?.mapValues { (_, v) -> (v as? Number)?.toInt() ?: 0 }
                ?: emptyMap()
            val withFullText = (data["with_full_text"] as? Number)?.toInt() ?: 0
            // recent_cases is a list of case objects, not a count
            val recentCasesCount = (data["recent_cases"] as? List<*>)?.size
                ?: (data["recent_cases_count"] as? Number)?.toInt()
                ?: 0
            return DashboardStats(
                totalCases = totalCases,
                courts = courts,
                outcomes = outcomes,
                withFullText = withFullText,
                recentCasesCount = recentCasesCount
            )
        }
    }
}
