package au.gov.immi.cases.core.model

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class FilterOptions(
    val courts: List<String> = emptyList(),
    val years: List<Int> = emptyList(),
    val outcomes: List<String> = emptyList(),
    val sources: List<String> = emptyList(),
    val natures: List<String> = emptyList(),
    @Json(name = "visa_types") val visaTypes: List<String> = emptyList(),
    val tags: List<String> = emptyList()
)

@JsonClass(generateAdapter = true)
data class AnalyticsFilterOptions(
    val courts: List<String> = emptyList(),
    val years: List<Int> = emptyList(),
    val natures: List<String> = emptyList(),
    @Json(name = "visa_families") val visaFamilies: List<String> = emptyList(),
    @Json(name = "outcome_types") val outcomeTypes: List<String> = emptyList()
)
