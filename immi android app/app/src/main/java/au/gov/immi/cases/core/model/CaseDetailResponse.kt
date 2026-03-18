package au.gov.immi.cases.core.model

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/**
 * Raw response shape from GET /api/v1/cases/{id}.
 *
 * The endpoint returns {case: {...}, full_text: "..."} — no standard envelope.
 */
@JsonClass(generateAdapter = true)
data class CaseDetailResponse(
    @Json(name = "case") val case: ImmigrationCase? = null,
    @Json(name = "full_text") val fullText: String? = null
)
