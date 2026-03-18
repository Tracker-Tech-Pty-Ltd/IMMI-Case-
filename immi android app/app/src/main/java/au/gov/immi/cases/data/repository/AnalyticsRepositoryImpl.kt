package au.gov.immi.cases.data.repository

import au.gov.immi.cases.core.model.AnalyticsFilter
import au.gov.immi.cases.core.model.ConceptEntry
import au.gov.immi.cases.core.model.DashboardStats
import au.gov.immi.cases.core.model.JudgeEntry
import au.gov.immi.cases.core.model.NatureOutcomeEntry
import au.gov.immi.cases.core.model.OutcomeEntry
import au.gov.immi.cases.network.api.AnalyticsApiService
import au.gov.immi.cases.network.api.SystemApiService
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Production implementation of [AnalyticsRepository].
 *
 * Every public method wraps the network call in [runCatching] so callers
 * always receive a [Result] — never a raw exception.
 */
@Singleton
class AnalyticsRepositoryImpl @Inject constructor(
    private val analyticsApi: AnalyticsApiService,
    private val systemApi: SystemApiService
) : AnalyticsRepository {

    // ─── Stats ───────────────────────────────────────────────────────────────────

    override suspend fun getStats(): Result<DashboardStats> = runCatching {
        val resp = systemApi.getStats()
        if (resp.isSuccessful) {
            // /api/v1/stats returns the stats map directly — no {success,data} envelope
            DashboardStats.fromApiMap(resp.body() ?: emptyMap())
        } else {
            throw Exception("Stats request failed (${resp.code()})")
        }
    }

    // ─── Outcomes ────────────────────────────────────────────────────────────────

    override suspend fun getOutcomes(filter: AnalyticsFilter): Result<List<OutcomeEntry>> = runCatching {
        val resp = analyticsApi.getOutcomes(filter.toQueryMap())
        if (resp.isSuccessful) {
            // /api/v1/analytics/outcomes returns the data map directly — no {success,data} envelope
            parseOutcomeEntries(resp.body() ?: emptyMap())
        } else {
            throw Exception("Outcomes request failed (${resp.code()})")
        }
    }

    // ─── Judges ──────────────────────────────────────────────────────────────────

    override suspend fun getJudges(filter: AnalyticsFilter): Result<List<JudgeEntry>> = runCatching {
        val resp = analyticsApi.getJudges(filter.toQueryMap())
        if (resp.isSuccessful) {
            parseJudgeEntries(resp.body() ?: emptyMap())
        } else {
            throw Exception("Judges request failed (${resp.code()})")
        }
    }

    // ─── Legal Concepts ──────────────────────────────────────────────────────────

    override suspend fun getLegalConcepts(filter: AnalyticsFilter): Result<List<ConceptEntry>> = runCatching {
        val resp = analyticsApi.getLegalConcepts(filter.toQueryMap())
        if (resp.isSuccessful) {
            parseConceptEntries(resp.body() ?: emptyMap())
        } else {
            throw Exception("Concepts request failed (${resp.code()})")
        }
    }

    // ─── Nature-Outcome ──────────────────────────────────────────────────────────

    override suspend fun getNatureOutcome(filter: AnalyticsFilter): Result<List<NatureOutcomeEntry>> = runCatching {
        val resp = analyticsApi.getNatureOutcome(filter.toQueryMap())
        if (resp.isSuccessful) {
            parseNatureOutcomeEntries(resp.body() ?: emptyMap())
        } else {
            throw Exception("NatureOutcome request failed (${resp.code()})")
        }
    }

    // ─── Judge Leaderboard ───────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    override suspend fun getJudgeLeaderboard(filter: AnalyticsFilter): Result<List<JudgeEntry>> = runCatching {
        val resp = analyticsApi.getJudgeLeaderboard(filter.toQueryMap())
        if (resp.isSuccessful) {
            val body = resp.body() ?: emptyMap()
            // API may return {data: {...}} envelope or a flat map — handle both
            val data = (body["data"] as? Map<String, Any>) ?: body
            parseJudgeEntries(data)
        } else {
            throw Exception("Leaderboard request failed (${resp.code()})")
        }
    }

    // ─── Judge Profile ───────────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    override suspend fun getJudgeProfile(name: String): Result<Map<String, Any>> = runCatching {
        val resp = analyticsApi.getJudgeProfile(name)
        if (resp.isSuccessful) {
            val body = resp.body() ?: emptyMap()
            (body["data"] as? Map<String, Any>) ?: body
        } else {
            throw Exception("Judge profile request failed (${resp.code()})")
        }
    }

    // ─── Judge Compare ───────────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    override suspend fun compareJudges(names: List<String>): Result<Map<String, Any>> = runCatching {
        val resp = analyticsApi.compareJudges(names.joinToString(","))
        if (resp.isSuccessful) {
            val body = resp.body() ?: emptyMap()
            (body["data"] as? Map<String, Any>) ?: body
        } else {
            throw Exception("Judge compare request failed (${resp.code()})")
        }
    }

    // ─── Private Parsers ─────────────────────────────────────────────────────────

    /**
     * Parses outcomes response.  The backend can return either a flat map of
     * `{outcome: count}` or a nested `{totals: {outcome: count}, by_court: {...}}`.
     * Both are handled gracefully.
     */
    @Suppress("UNCHECKED_CAST")
    private fun parseOutcomeEntries(data: Map<String, Any>): List<OutcomeEntry> {
        val totals = (data["totals"] as? Map<String, Any>)
            ?: (data["by_court"] as? Map<String, Any>)
                ?.values
                ?.filterIsInstance<Map<String, Any>>()
                ?.firstOrNull()
            ?: data  // fallback: treat top-level map as {outcome: count}
        return totals.entries
            .mapNotNull { (k, v) ->
                val count = (v as? Number)?.toInt() ?: return@mapNotNull null
                OutcomeEntry(label = k, count = count)
            }
            .sortedByDescending { it.count }
    }

    /**
     * Parses judge entries from either:
     *  - a list of judge objects under "judges" key, or
     *  - a top-level list (when the API returns an array).
     */
    @Suppress("UNCHECKED_CAST")
    private fun parseJudgeEntries(data: Map<String, Any>): List<JudgeEntry> {
        val rawList = (data["judges"] as? List<*>)
            ?: (data["data"] as? List<*>)
            ?: emptyList<Any>()
        return rawList
            .filterIsInstance<Map<String, Any>>()
            .map { m ->
                JudgeEntry(
                    // API returns display_name or name; total_cases may be 'count' in list endpoints
                    name = (m["display_name"] as? String)
                        ?: (m["name"] as? String)
                        ?: (m["judge_name"] as? String)
                        ?: "",
                    totalCases = (m["total_cases"] as? Number)?.toInt()
                        ?: (m["count"] as? Number)?.toInt()
                        ?: 0,
                    successRate = (m["success_rate"] as? Number)?.toDouble() ?: 0.0
                )
            }
            .filter { it.name.isNotBlank() }
            .sortedByDescending { it.totalCases }
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseConceptEntries(data: Map<String, Any>): List<ConceptEntry> {
        val rawList = (data["concepts"] as? List<*>)
            ?: (data["data"] as? List<*>)
            ?: emptyList<Any>()
        return rawList
            .filterIsInstance<Map<String, Any>>()
            .map { m ->
                ConceptEntry(
                    concept = (m["concept"] as? String) ?: (m["legal_concept"] as? String) ?: "",
                    count = (m["count"] as? Number)?.toInt() ?: 0,
                    effectiveness = (m["effectiveness"] as? Number)?.toDouble() ?: 0.0
                )
            }
            .filter { it.concept.isNotBlank() }
            .sortedByDescending { it.count }
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseNatureOutcomeEntries(data: Map<String, Any>): List<NatureOutcomeEntry> {
        val rawList = (data["matrix"] as? List<*>)
            ?: (data["data"] as? List<*>)
            ?: emptyList<Any>()
        return rawList
            .filterIsInstance<Map<String, Any>>()
            .map { m ->
                NatureOutcomeEntry(
                    nature = (m["nature"] as? String) ?: (m["case_nature"] as? String) ?: "",
                    outcome = (m["outcome"] as? String) ?: "",
                    count = (m["count"] as? Number)?.toInt() ?: 0
                )
            }
            .filter { it.nature.isNotBlank() && it.outcome.isNotBlank() }
    }
}
