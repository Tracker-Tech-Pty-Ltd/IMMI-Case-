package au.gov.immi.cases.feature.cases

import androidx.paging.PagingSource
import au.gov.immi.cases.core.model.CasesFilter
import au.gov.immi.cases.core.model.CasesResponse
import au.gov.immi.cases.core.model.ImmigrationCase
import au.gov.immi.cases.feature.cases.paging.CasesPagingSource
import au.gov.immi.cases.network.api.CasesApiService
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import retrofit2.Response
import java.io.IOException

class CasesPagingSourceTest {

    private val mockApi = mockk<CasesApiService>()

    @Test
    fun `load returns page with next key when more pages exist`() = runTest {
        val cases = List(20) { ImmigrationCase(caseId = "case$it") }
        val casesResponse = CasesResponse(cases = cases, page = 1, pageSize = 20, total = 100, totalPages = 5)
        coEvery { mockApi.getCases(any()) } returns Response.success(casesResponse)

        val pagingSource = CasesPagingSource(mockApi, CasesFilter())
        val result = pagingSource.load(
            PagingSource.LoadParams.Refresh(key = null, loadSize = 20, placeholdersEnabled = false)
        )

        assertTrue(result is PagingSource.LoadResult.Page)
        val page = result as PagingSource.LoadResult.Page
        assertEquals(20, page.data.size)
        assertNull(page.prevKey)
        assertEquals(2, page.nextKey)
    }

    @Test
    fun `load returns null nextKey on last page`() = runTest {
        val cases = List(5) { ImmigrationCase(caseId = "case$it") }
        val casesResponse = CasesResponse(cases = cases, page = 1, pageSize = 20, total = 5, totalPages = 1)
        coEvery { mockApi.getCases(any()) } returns Response.success(casesResponse)

        val pagingSource = CasesPagingSource(mockApi, CasesFilter())
        val result = pagingSource.load(
            PagingSource.LoadParams.Refresh(key = null, loadSize = 20, placeholdersEnabled = false)
        )

        assertTrue(result is PagingSource.LoadResult.Page)
        val page = result as PagingSource.LoadResult.Page
        assertNull(page.nextKey)
    }

    @Test
    fun `load returns Error on network failure`() = runTest {
        coEvery { mockApi.getCases(any()) } throws IOException("No network")

        val pagingSource = CasesPagingSource(mockApi, CasesFilter())
        val result = pagingSource.load(
            PagingSource.LoadParams.Refresh(key = null, loadSize = 20, placeholdersEnabled = false)
        )

        assertTrue(result is PagingSource.LoadResult.Error)
    }

    @Test
    fun `load passes filter params to API`() = runTest {
        val cases = emptyList<ImmigrationCase>()
        val casesResponse = CasesResponse(cases = cases, page = 1, pageSize = 20, total = 0, totalPages = 1)
        var capturedParams: Map<String, String>? = null
        coEvery { mockApi.getCases(any()) } answers {
            capturedParams = firstArg()
            Response.success(casesResponse)
        }

        val filter = CasesFilter(court = "AATA", year = 2024)
        val pagingSource = CasesPagingSource(mockApi, filter)
        pagingSource.load(
            PagingSource.LoadParams.Refresh(key = null, loadSize = 20, placeholdersEnabled = false)
        )

        assertEquals("AATA", capturedParams?.get("court"))
        assertEquals("2024", capturedParams?.get("year"))
        assertEquals("1", capturedParams?.get("page"))
        assertEquals("20", capturedParams?.get("page_size"))
        assertNull(capturedParams?.get("per_page"))
    }

    @Test
    fun `load includes prevKey for page 2`() = runTest {
        val cases = List(20) { ImmigrationCase(caseId = "case$it") }
        val casesResponse = CasesResponse(cases = cases, page = 2, pageSize = 20, total = 100, totalPages = 5)
        coEvery { mockApi.getCases(any()) } returns Response.success(casesResponse)

        val pagingSource = CasesPagingSource(mockApi, CasesFilter())
        val result = pagingSource.load(
            PagingSource.LoadParams.Refresh(key = 2, loadSize = 20, placeholdersEnabled = false)
        )

        assertTrue(result is PagingSource.LoadResult.Page)
        val page = result as PagingSource.LoadResult.Page
        assertEquals(1, page.prevKey)
        assertEquals(3, page.nextKey)
    }

    @Test
    fun `load returns Error on HTTP failure`() = runTest {
        coEvery { mockApi.getCases(any()) } returns Response.error(
            500,
            "Internal Server Error".toResponseBody(null)
        )

        val pagingSource = CasesPagingSource(mockApi, CasesFilter())
        val result = pagingSource.load(
            PagingSource.LoadParams.Refresh(key = null, loadSize = 20, placeholdersEnabled = false)
        )

        assertTrue(result is PagingSource.LoadResult.Error)
    }
}
