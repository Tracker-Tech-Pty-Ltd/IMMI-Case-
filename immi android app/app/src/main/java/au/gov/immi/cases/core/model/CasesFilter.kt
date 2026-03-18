package au.gov.immi.cases.core.model

/**
 * Immutable filter state for the cases list.
 * Use .copy() to create modified versions — never mutate.
 */
data class CasesFilter(
    val court: String? = null,
    val year: Int? = null,
    val keyword: String? = null,
    val source: String? = null,
    val tag: String? = null,
    val nature: String? = null,
    val outcome: String? = null,
    val search: String? = null,
    val sortBy: String = "date",
    val sortDir: String = "desc",
    val page: Int = 1,
    val pageSize: Int = 20
) {
    /** Converts to a map of query parameters, excluding null values */
    fun toQueryMap(): Map<String, String> = buildMap {
        court?.let { put("court", it) }
        year?.let { put("year", it.toString()) }
        keyword?.let { put("keyword", it) }
        source?.let { put("source", it) }
        tag?.let { put("tag", it) }
        nature?.let { put("nature", it) }
        outcome?.let { put("outcome", it) }
        search?.let { put("search", it) }
        put("sort_by", sortBy)
        put("sort_dir", sortDir)
        put("page", page.toString())
        put("page_size", pageSize.toString())
    }

    /** Returns true if any filter constraint is active */
    fun isFiltered(): Boolean =
        court != null || year != null || keyword != null ||
        source != null || tag != null || nature != null || outcome != null ||
        search != null
}
