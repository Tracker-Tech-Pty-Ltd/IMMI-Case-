package au.gov.immi.cases.network.api

import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Query
import retrofit2.http.QueryMap

interface AnalyticsApiService {

    @GET("analytics/outcomes")
    suspend fun getOutcomes(
        @QueryMap params: Map<String, String> = emptyMap()
    ): Response<Map<String, Any>>

    @GET("analytics/judges")
    suspend fun getJudges(
        @QueryMap params: Map<String, String> = emptyMap()
    ): Response<Map<String, Any>>

    @GET("analytics/legal-concepts")
    suspend fun getLegalConcepts(
        @QueryMap params: Map<String, String> = emptyMap()
    ): Response<Map<String, Any>>

    @GET("analytics/nature-outcome")
    suspend fun getNatureOutcome(
        @QueryMap params: Map<String, String> = emptyMap()
    ): Response<Map<String, Any>>

    @GET("analytics/filter-options")
    suspend fun getFilterOptions(): Response<Map<String, Any>>

    @GET("analytics/judge-profile")
    suspend fun getJudgeProfile(
        @Query("name") name: String
    ): Response<Map<String, Any>>

    @GET("analytics/judge-compare")
    suspend fun compareJudges(
        @Query("names") names: String
    ): Response<Map<String, Any>>

    @GET("analytics/success-rate")
    suspend fun getSuccessRate(
        @QueryMap params: Map<String, String> = emptyMap()
    ): Response<Map<String, Any>>

    @GET("analytics/monthly-trends")
    suspend fun getMonthlyTrends(
        @QueryMap params: Map<String, String> = emptyMap()
    ): Response<Map<String, Any>>

    @GET("analytics/judge-leaderboard")
    suspend fun getJudgeLeaderboard(
        @QueryMap params: Map<String, String> = emptyMap()
    ): Response<Map<String, Any>>
}
