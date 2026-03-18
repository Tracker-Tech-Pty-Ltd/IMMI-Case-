package au.gov.immi.cases.data.repository

import au.gov.immi.cases.core.model.AnalyticsFilter
import au.gov.immi.cases.core.model.ConceptEntry
import au.gov.immi.cases.core.model.DashboardStats
import au.gov.immi.cases.core.model.JudgeEntry
import au.gov.immi.cases.core.model.NatureOutcomeEntry
import au.gov.immi.cases.core.model.OutcomeEntry

/**
 * Contract for all analytics data access.
 *
 * All methods return [Result] so callers can use `fold(onSuccess, onFailure)`
 * without catching exceptions themselves.
 */
interface AnalyticsRepository {

    /** Dashboard-level aggregated stats (/api/v1/stats). */
    suspend fun getStats(): Result<DashboardStats>

    /** Outcome distribution, optionally filtered. */
    suspend fun getOutcomes(filter: AnalyticsFilter = AnalyticsFilter()): Result<List<OutcomeEntry>>

    /** Judge performance summary, optionally filtered. */
    suspend fun getJudges(filter: AnalyticsFilter = AnalyticsFilter()): Result<List<JudgeEntry>>

    /** Legal concept frequency + effectiveness. */
    suspend fun getLegalConcepts(filter: AnalyticsFilter = AnalyticsFilter()): Result<List<ConceptEntry>>

    /** Nature-outcome cross-tabulation matrix. */
    suspend fun getNatureOutcome(filter: AnalyticsFilter = AnalyticsFilter()): Result<List<NatureOutcomeEntry>>

    /** Top judges by case volume (leaderboard). */
    suspend fun getJudgeLeaderboard(filter: AnalyticsFilter = AnalyticsFilter()): Result<List<JudgeEntry>>

    /** Full profile for a single judge. */
    suspend fun getJudgeProfile(name: String): Result<Map<String, Any>>

    /** Side-by-side comparison of two or more judges. */
    suspend fun compareJudges(names: List<String>): Result<Map<String, Any>>
}
