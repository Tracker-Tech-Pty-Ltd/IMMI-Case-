package au.gov.immi.cases.data.repository

import au.gov.immi.cases.core.model.LegislationItem

/**
 * Repository interface for Australian immigration legislations.
 *
 * Abstracts the remote API behind a clean domain boundary,
 * returning [Result] wrappers so callers never deal with raw HTTP exceptions.
 */
interface LegislationsRepository {
    suspend fun getLegislations(query: String? = null): Result<List<LegislationItem>>
    suspend fun getLegislation(id: String): Result<LegislationItem>
    suspend fun searchLegislations(query: String): Result<List<LegislationItem>>
}
