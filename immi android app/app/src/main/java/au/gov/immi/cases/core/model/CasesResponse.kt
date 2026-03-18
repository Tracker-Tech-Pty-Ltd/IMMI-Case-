package au.gov.immi.cases.core.model

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Raw response shape from GET /api/v1/cases.
 *
 * The cases endpoint does NOT use the standard {success, data, meta} envelope —
 * it returns pagination fields alongside the cases list directly.
 */
@JsonClass(generateAdapter = true)
data class CasesResponse(
    val cases: List<ImmigrationCase> = emptyList(),
    val page: Int = 1,
    @Json(name = "page_size") val pageSize: Int = 20,
    val total: Int = 0,
    @Json(name = "total_pages") val totalPages: Int = 1
) {
    fun hasNextPage(): Boolean = page < totalPages
}
