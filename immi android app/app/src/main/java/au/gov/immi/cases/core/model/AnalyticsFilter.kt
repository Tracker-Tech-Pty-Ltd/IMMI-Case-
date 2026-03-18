package au.gov.immi.cases.core.model

data class AnalyticsFilter(
    val court: String? = null,
    val yearFrom: Int? = null,
    val yearTo: Int? = null,
    val caseNatures: List<String> = emptyList(),
    val visaSubclasses: List<String> = emptyList(),
    val visaFamilies: List<String> = emptyList(),
    val outcomeTypes: List<String> = emptyList()
) {
    fun toQueryMap(): Map<String, String> = buildMap {
        court?.let { put("court", it) }
        yearFrom?.let { put("year_from", it.toString()) }
        yearTo?.let { put("year_to", it.toString()) }
        if (caseNatures.isNotEmpty()) put("case_natures", caseNatures.joinToString(","))
        if (visaSubclasses.isNotEmpty()) put("visa_subclasses", visaSubclasses.joinToString(","))
        if (visaFamilies.isNotEmpty()) put("visa_families", visaFamilies.joinToString(","))
        if (outcomeTypes.isNotEmpty()) put("outcome_types", outcomeTypes.joinToString(","))
    }

    fun isFiltered(): Boolean =
        court != null || yearFrom != null || yearTo != null ||
        caseNatures.isNotEmpty() || visaSubclasses.isNotEmpty() ||
        visaFamilies.isNotEmpty() || outcomeTypes.isNotEmpty()
}
