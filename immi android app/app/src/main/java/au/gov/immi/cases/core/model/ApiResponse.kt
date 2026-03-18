package au.gov.immi.cases.core.model

import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class ApiResponse<T>(
    val success: Boolean = true,
    val data: T? = null,
    val error: String? = null,
    val meta: Meta? = null
)

@JsonClass(generateAdapter = true)
data class Meta(
    val total: Int = 0,
    val page: Int = 1,
    val limit: Int = 20,
    val pages: Int = 1
) {
    fun hasNextPage(): Boolean = page < pages
    fun hasPrevPage(): Boolean = page > 1
}

/** Convenience type alias for list responses */
typealias PagedResponse<T> = ApiResponse<List<T>>
