package au.gov.immi.cases.network.api

import au.gov.immi.cases.core.model.ApiResponse
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

interface LegislationsApiService {

    @GET("legislations")
    suspend fun getLegislations(
        @Query("search") query: String? = null,
        @Query("page") page: Int = 1
    ): Response<ApiResponse<List<Map<String, Any>>>>

    @GET("legislations/{id}")
    suspend fun getLegislation(
        @Path("id") id: String
    ): Response<ApiResponse<Map<String, Any>>>

    @GET("legislations/search")
    suspend fun searchLegislations(
        @Query("q") query: String
    ): Response<ApiResponse<List<Map<String, Any>>>>
}
