package au.gov.immi.cases.data.repository

import androidx.paging.Pager
import androidx.paging.PagingConfig
import androidx.paging.PagingData
import au.gov.immi.cases.core.model.CasesFilter
import au.gov.immi.cases.core.model.ImmigrationCase
import au.gov.immi.cases.data.local.dao.CachedCaseDao
import au.gov.immi.cases.feature.cases.paging.CasesPagingSource
import au.gov.immi.cases.network.api.CasesApiService
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Production implementation of [CasesRepository].
 *
 * Uses [CasesApiService] as the primary data source with [CachedCaseDao] for
 * offline caching of individual case detail views.
 *
 * All methods return immutable [Result] wrappers — callers must handle both
 * [Result.success] and [Result.failure] paths.
 */
@Singleton
class CasesRepositoryImpl @Inject constructor(
    private val api: CasesApiService,
    private val cachedCaseDao: CachedCaseDao
) : CasesRepository {

    override fun getCasesPager(filter: CasesFilter): Flow<PagingData<ImmigrationCase>> {
        return Pager(
            config = PagingConfig(
                pageSize = 20,
                prefetchDistance = 5,
                enablePlaceholders = false
            ),
            pagingSourceFactory = { CasesPagingSource(api, filter) }
        ).flow
    }

    override suspend fun getCaseById(caseId: String): Result<ImmigrationCase> = runCatching {
        val response = api.getCaseById(caseId)
        if (response.isSuccessful) {
            response.body()?.case ?: error("Case not found: $caseId")
        } else {
            error("Case not found: $caseId (HTTP ${response.code()})")
        }
    }

    override suspend fun createCase(case: ImmigrationCase): Result<ImmigrationCase> = runCatching {
        val response = api.createCase(case)
        response.body()?.data ?: error("Failed to create case")
    }

    override suspend fun updateCase(
        caseId: String,
        case: ImmigrationCase
    ): Result<ImmigrationCase> = runCatching {
        val response = api.updateCase(caseId, case)
        response.body()?.data ?: error("Failed to update case: $caseId")
    }

    override suspend fun deleteCase(caseId: String): Result<Unit> = runCatching {
        api.deleteCase(caseId)
    }

    override suspend fun getSimilarCases(caseId: String): Result<List<ImmigrationCase>> =
        runCatching {
            val response = api.getSimilarCases(caseId)
            response.body()?.data ?: emptyList()
        }
}
