package au.gov.immi.cases.network.api

import au.gov.immi.cases.core.model.ApiResponse
import au.gov.immi.cases.core.model.CaseDetailResponse
import au.gov.immi.cases.core.model.CasesResponse
import au.gov.immi.cases.core.model.ImmigrationCase
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.QueryMap

interface CasesApiService {

    // ─── Cases CRUD ──────────────────────────────────────────────────────────────

    // /api/v1/cases returns {cases:[], page, page_size, total, total_pages} — no standard envelope
    @GET("cases")
    suspend fun getCases(
        @QueryMap params: Map<String, String>
    ): Response<CasesResponse>

    // /api/v1/cases/{id} returns {case: {...}, full_text: "..."} — no standard envelope
    @GET("cases/{id}")
    suspend fun getCaseById(
        @Path("id") id: String
    ): Response<CaseDetailResponse>

    @POST("cases")
    suspend fun createCase(
        @Body case: ImmigrationCase
    ): Response<ApiResponse<ImmigrationCase>>

    @PUT("cases/{id}")
    suspend fun updateCase(
        @Path("id") id: String,
        @Body case: ImmigrationCase
    ): Response<ApiResponse<ImmigrationCase>>

    @DELETE("cases/{id}")
    suspend fun deleteCase(
        @Path("id") id: String
    ): Response<ApiResponse<Any?>>

    @GET("cases/{id}/similar")
    suspend fun getSimilarCases(
        @Path("id") id: String
    ): Response<ApiResponse<List<ImmigrationCase>>>

    // ─── Collections ────────────────────────────────────────────────────────────

    @GET("collections")
    suspend fun getCollections(): Response<ApiResponse<List<Map<String, Any>>>>

    @POST("collections")
    suspend fun createCollection(
        @Body body: Map<String, String>
    ): Response<ApiResponse<Map<String, Any>>>

    @GET("collections/{id}")
    suspend fun getCollection(
        @Path("id") id: String
    ): Response<ApiResponse<Map<String, Any>>>

    @PUT("collections/{id}")
    suspend fun updateCollection(
        @Path("id") id: String,
        @Body body: Map<String, String>
    ): Response<ApiResponse<Map<String, Any>>>

    @DELETE("collections/{id}")
    suspend fun deleteCollection(
        @Path("id") id: String
    ): Response<ApiResponse<Any?>>

    @POST("collections/{id}/cases/{caseId}")
    suspend fun addCaseToCollection(
        @Path("id") id: String,
        @Path("caseId") caseId: String
    ): Response<ApiResponse<Any?>>

    @DELETE("collections/{id}/cases/{caseId}")
    suspend fun removeCaseFromCollection(
        @Path("id") id: String,
        @Path("caseId") caseId: String
    ): Response<ApiResponse<Any?>>

    // ─── Bookmarks ──────────────────────────────────────────────────────────────

    @GET("bookmarks")
    suspend fun getBookmarks(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20
    ): Response<ApiResponse<List<ImmigrationCase>>>

    @POST("bookmarks/{caseId}")
    suspend fun addBookmark(
        @Path("caseId") caseId: String
    ): Response<ApiResponse<Any?>>

    @DELETE("bookmarks/{caseId}")
    suspend fun removeBookmark(
        @Path("caseId") caseId: String
    ): Response<ApiResponse<Any?>>
}
