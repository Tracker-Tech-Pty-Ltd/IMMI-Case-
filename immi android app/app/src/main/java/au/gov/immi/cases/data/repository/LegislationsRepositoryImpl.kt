package au.gov.immi.cases.data.repository

import au.gov.immi.cases.core.model.LegislationItem
import au.gov.immi.cases.network.api.LegislationsApiService
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Concrete [LegislationsRepository] backed by [LegislationsApiService].
 *
 * Each method wraps the Retrofit call in [runCatching] so all exceptions
 * (network, parsing, HTTP errors) are captured as [Result.failure].
 */
@Singleton
class LegislationsRepositoryImpl @Inject constructor(
    private val api: LegislationsApiService
) : LegislationsRepository {

    override suspend fun getLegislations(query: String?): Result<List<LegislationItem>> = runCatching {
        val resp = api.getLegislations(query = query)
        if (resp.isSuccessful && resp.body()?.success == true) {
            resp.body()?.data?.map { LegislationItem.fromApiMap(it) } ?: emptyList()
        } else {
            throw Exception(resp.body()?.error ?: "Failed to load legislations")
        }
    }

    override suspend fun getLegislation(id: String): Result<LegislationItem> = runCatching {
        val resp = api.getLegislation(id)
        if (resp.isSuccessful && resp.body()?.success == true) {
            LegislationItem.fromApiMap(resp.body()?.data ?: emptyMap())
        } else {
            throw Exception(resp.body()?.error ?: "Legislation not found")
        }
    }

    override suspend fun searchLegislations(query: String): Result<List<LegislationItem>> = runCatching {
        val resp = api.searchLegislations(query)
        if (resp.isSuccessful && resp.body()?.success == true) {
            resp.body()?.data?.map { LegislationItem.fromApiMap(it) } ?: emptyList()
        } else {
            throw Exception(resp.body()?.error ?: "Search failed")
        }
    }
}
