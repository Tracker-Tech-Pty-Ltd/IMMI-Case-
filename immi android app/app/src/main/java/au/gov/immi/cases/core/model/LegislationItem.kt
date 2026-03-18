package au.gov.immi.cases.core.model

/**
 * Domain model for a single Australian immigration legislation.
 *
 * Parsed from API response map returned by [LegislationsApiService].
 */
data class LegislationItem(
    val id: String,
    val title: String,
    val shortTitle: String = "",
    val description: String = "",
    val year: Int = 0,
    val fullText: String = "",
    val sections: List<String> = emptyList()
) {
    companion object {
        /**
         * Construct a [LegislationItem] from a raw API response map.
         * Uses safe casts — never throws; missing keys produce empty/zero defaults.
         */
        @Suppress("UNCHECKED_CAST")
        fun fromApiMap(data: Map<String, Any>): LegislationItem = LegislationItem(
            id = (data["id"] as? String) ?: "",
            title = (data["title"] as? String) ?: "",
            shortTitle = (data["short_title"] as? String)
                ?: (data["title"] as? String)
                ?: "",
            description = (data["description"] as? String) ?: "",
            year = (data["year"] as? Number)?.toInt() ?: 0,
            fullText = (data["full_text"] as? String) ?: "",
            sections = (data["sections"] as? List<String>) ?: emptyList()
        )
    }
}
