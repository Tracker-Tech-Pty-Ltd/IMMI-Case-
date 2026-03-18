package au.gov.immi.cases.data.repository

import androidx.paging.PagingData
import au.gov.immi.cases.core.model.CasesFilter
import au.gov.immi.cases.core.model.ImmigrationCase
import kotlinx.coroutines.flow.Flow

/**
 * Repository interface for Immigration Cases.
 * Abstracts data access — implementations may use remote API, local cache, or both.
 * All operations return immutable results; never mutate the underlying data.
 */
interface CasesRepository {

    /**
     * Returns a [Flow] of [PagingData] for the given filter.
     * Filter changes trigger a new [PagingData] stream via flatMapLatest.
     */
    fun getCasesPager(filter: CasesFilter): Flow<PagingData<ImmigrationCase>>

    /** Fetch a single case by ID. Returns [Result.failure] on error. */
    suspend fun getCaseById(caseId: String): Result<ImmigrationCase>

    /** Create a new case on the server. Returns the created case. */
    suspend fun createCase(case: ImmigrationCase): Result<ImmigrationCase>

    /** Update an existing case. Returns the updated case. */
    suspend fun updateCase(caseId: String, case: ImmigrationCase): Result<ImmigrationCase>

    /** Delete a case by ID. */
    suspend fun deleteCase(caseId: String): Result<Unit>

    /** Fetch semantically similar cases for the given case ID. */
    suspend fun getSimilarCases(caseId: String): Result<List<ImmigrationCase>>
}
