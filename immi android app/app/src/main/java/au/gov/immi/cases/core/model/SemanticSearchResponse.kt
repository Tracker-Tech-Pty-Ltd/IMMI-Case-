package au.gov.immi.cases.core.model

import com.squareup.moshi.JsonClass

/**
 * Raw response shape from GET /api/v1/search/semantic.
 *
 * Returns {available, model, provider, query, results: [...]}.
 * When available=false (no pgvector), results is always empty.
 */
@JsonClass(generateAdapter = true)
data class SemanticSearchResponse(
    val available: Boolean = false,
    val model: String = "",
    val provider: String = "",
    val query: String = "",
    val results: List<ImmigrationCase> = emptyList()
)
