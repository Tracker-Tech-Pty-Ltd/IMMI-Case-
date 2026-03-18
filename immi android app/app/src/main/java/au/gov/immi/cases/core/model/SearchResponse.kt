package au.gov.immi.cases.core.model

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Raw response shape from GET /api/v1/search.
 *
 * Returns {cases: [...], mode: "lexical"|"semantic"} — no standard envelope.
 */
@JsonClass(generateAdapter = true)
data class SearchResponse(
    val cases: List<ImmigrationCase> = emptyList(),
    val mode: String = "lexical"
)
