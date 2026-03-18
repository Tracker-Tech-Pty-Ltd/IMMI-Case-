package au.gov.immi.cases.core.model

import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

/** Splits by ';' first, falls back to ',' — shared by judgeList and legalConceptList */
private fun String.splitDelimited(): List<String> {
    if (isBlank()) return emptyList()
    val delimiter = if (contains(';')) ';' else ','
    return split(delimiter).map { it.trim() }.filter { it.isNotEmpty() }
}

@JsonClass(generateAdapter = true)
data class ImmigrationCase(
    @Json(name = "case_id") val caseId: String = "",
    val citation: String = "",
    val title: String = "",
    val court: String = "",
    @Json(name = "court_code") val courtCode: String = "",
    val date: String = "",
    val year: Int = 0,
    val url: String = "",
    val judges: String = "",
    val catchwords: String = "",
    val outcome: String = "",
    @Json(name = "visa_type") val visaType: String = "",
    val legislation: String = "",
    @Json(name = "text_snippet") val textSnippet: String = "",
    @Json(name = "full_text_path") val fullTextPath: String = "",
    val source: String = "",
    @Json(name = "user_notes") val userNotes: String = "",
    val tags: String = "",
    @Json(name = "case_nature") val caseNature: String = "",
    @Json(name = "legal_concepts") val legalConcepts: String = "",
    @Json(name = "visa_subclass") val visaSubclass: String = "",
    @Json(name = "visa_class_code") val visaClassCode: String = "",
    @Json(name = "applicant_name") val applicantName: String = "",
    val respondent: String = "",
    @Json(name = "country_of_origin") val countryOfOrigin: String = "",
    @Json(name = "visa_subclass_number") val visaSubclassNumber: String = "",
    @Json(name = "hearing_date") val hearingDate: String = "",
    @Json(name = "is_represented") val isRepresented: String = "",
    val representative: String = "",
    @Json(name = "visa_outcome_reason") val visaOutcomeReason: String = "",
    @Json(name = "legal_test_applied") val legalTestApplied: String = ""
) {
    fun judgeList(): List<String> = judges.splitDelimited()

    fun legalConceptList(): List<String> = legalConcepts.splitDelimited()

    fun tagList(): List<String> {
        if (tags.isBlank()) return emptyList()
        return tags.split(',').map { it.trim() }.filter { it.isNotEmpty() }
    }

    /** Returns true if the outcome represents a win for the applicant */
    fun isGranted(): Boolean = outcome in WINNING_OUTCOMES

    /** Returns title if non-empty, otherwise citation */
    fun displayTitle(): String = title.ifBlank { citation }

    /**
     * Short description for list cards.
     * Prefers [catchwords] (concise keywords extracted from the case).
     * Falls back to [textSnippet] with AustLII navigation boilerplate stripped —
     * the boilerplate ends before the first double-newline.
     */
    fun cardSnippet(): String {
        if (catchwords.isNotBlank()) return catchwords.take(160)
        val clean = textSnippet.substringAfter("\n\n").trim()
        return clean.take(160)
    }

    companion object {
        val WINNING_OUTCOMES = setOf("Granted", "Allowed", "Set Aside", "Remitted", "Quashed", "Varied")
    }
}
