package au.gov.immi.cases.network.api

import au.gov.immi.cases.core.model.ApiResponse
import au.gov.immi.cases.core.model.ImmigrationCase
import au.gov.immi.cases.core.model.SearchResponse
import au.gov.immi.cases.core.model.SemanticSearchResponse
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.QueryMap

interface SearchApiService {

    // /api/v1/search returns {cases: [...], mode: "lexical"} — no standard envelope
    @GET("search")
    suspend fun search(
        @Query("q") query: String,
        @QueryMap params: Map<String, String> = emptyMap()
    ): Response<SearchResponse>

    // /api/v1/search/semantic returns {available, model, provider, query, results: [...]}
    @GET("search/semantic")
    suspend fun semanticSearch(
        @Query("q") query: String,
        @Query("limit") limit: Int = 20
    ): Response<SemanticSearchResponse>

    // /api/v1/search/guided uses same shape as /search
    @GET("search/guided")
    suspend fun guidedSearch(
        @QueryMap params: Map<String, String>
    ): Response<SearchResponse>

    @GET("search/taxonomy")
    suspend fun getTaxonomy(): Response<ApiResponse<Map<String, Any>>>

    // ─── Saved Searches ──────────────────────────────────────────────────────────

    @GET("saved-searches")
    suspend fun getSavedSearches(): Response<ApiResponse<List<Map<String, Any>>>>

    @POST("saved-searches")
    suspend fun createSavedSearch(
        @Body body: Map<String, String>
    ): Response<ApiResponse<Map<String, Any>>>

    @DELETE("saved-searches/{id}")
    suspend fun deleteSavedSearch(
        @Path("id") id: Int
    ): Response<ApiResponse<Any?>>
}
