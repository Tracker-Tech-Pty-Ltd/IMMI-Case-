package au.gov.immi.cases.feature.cases.paging

import androidx.paging.PagingSource
import androidx.paging.PagingState
import au.gov.immi.cases.core.model.CasesFilter
import au.gov.immi.cases.core.model.ImmigrationCase
import au.gov.immi.cases.network.api.CasesApiService

/**
 * [PagingSource] that loads [ImmigrationCase] pages from the remote API.
 *
 * A new instance is created whenever the [CasesFilter] changes (via flatMapLatest).
 * Page keys are 1-based integers matching the server's `page` query parameter.
 */
class CasesPagingSource(
    private val api: CasesApiService,
    private val filter: CasesFilter
) : PagingSource<Int, ImmigrationCase>() {

    override fun getRefreshKey(state: PagingState<Int, ImmigrationCase>): Int? {
        return state.anchorPosition?.let { anchor ->
            state.closestPageToPosition(anchor)?.prevKey?.plus(1)
                ?: state.closestPageToPosition(anchor)?.nextKey?.minus(1)
        }
    }

    override suspend fun load(params: LoadParams<Int>): LoadResult<Int, ImmigrationCase> {
        val page = params.key ?: 1
        return try {
            val queryParams = filter.toQueryMap().toMutableMap()
            queryParams["page"] = "$page"
            queryParams["page_size"] = "${params.loadSize}"

            val response = api.getCases(queryParams)
            val body = response.body()

            if (!response.isSuccessful || body == null) {
                return LoadResult.Error(
                    Exception("HTTP ${response.code()}: ${response.message()}")
                )
            }

            LoadResult.Page(
                data = body.cases,
                prevKey = if (page == 1) null else page - 1,
                nextKey = if (body.hasNextPage()) page + 1 else null
            )
        } catch (e: Exception) {
            LoadResult.Error(e)
        }
    }
}
