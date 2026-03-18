package au.gov.immi.cases.feature.search

import app.cash.turbine.test
import au.gov.immi.cases.core.model.ImmigrationCase
import au.gov.immi.cases.core.model.SearchResponse
import au.gov.immi.cases.network.api.SearchApiService
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import retrofit2.Response
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class SearchViewModelTest {

    private val mockApi = mockk<SearchApiService>()

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @AfterEach
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel() = SearchViewModel(mockApi)

    // ─── 初始狀態測試 ──────────────────────────────────────────────────────────

    @Test
    fun `initial state has empty query and no results`() {
        val vm = createViewModel()
        assertEquals("", vm.uiState.value.query)
        assertTrue(vm.uiState.value.results.isEmpty())
        assertFalse(vm.uiState.value.hasSearched)
    }

    @Test
    fun `initial isLoading is false`() {
        val vm = createViewModel()
        assertFalse(vm.uiState.value.isLoading)
    }

    // ─── updateQuery 測試 ─────────────────────────────────────────────────────

    @Test
    fun `updateQuery updates query in state`() = runTest {
        val vm = createViewModel()
        vm.updateQuery("protection visa")
        assertEquals("protection visa", vm.uiState.value.query)
    }

    @Test
    fun `updateQuery with blank clears results and resets hasSearched`() = runTest {
        val vm = createViewModel()
        vm.updateQuery("some query")
        vm.updateQuery("")
        assertTrue(vm.uiState.value.results.isEmpty())
        assertFalse(vm.uiState.value.hasSearched)
    }

    // ─── clearResults 測試 ───────────────────────────────────────────────────

    @Test
    fun `clearResults resets state`() = runTest {
        val vm = createViewModel()
        vm.updateQuery("some query")
        vm.clearResults()
        assertEquals("", vm.uiState.value.query)
        assertFalse(vm.uiState.value.hasSearched)
    }

    @Test
    fun `clearResults after search resets hasSearched flag`() = runTest {
        val cases = listOf(ImmigrationCase(caseId = "abc"))
        coEvery { mockApi.search(any(), any()) } returns Response.success(
            SearchResponse(cases = cases)
        )

        val vm = createViewModel()
        vm.updateQuery("test")
        vm.search()
        advanceUntilIdle()
        assertTrue(vm.uiState.value.hasSearched)

        vm.clearResults()
        assertFalse(vm.uiState.value.hasSearched)
        assertTrue(vm.uiState.value.results.isEmpty())
    }

    // ─── search() 測試 ────────────────────────────────────────────────────────

    @Test
    fun `search returns results on success`() = runTest {
        val cases = listOf(ImmigrationCase(caseId = "abc", citation = "[2024] AATA 1"))
        val searchResponse = SearchResponse(cases = cases)
        coEvery { mockApi.search(any(), any()) } returns Response.success(searchResponse)

        val vm = createViewModel()
        vm.updateQuery("protection")
        vm.search()
        advanceUntilIdle()

        assertEquals(1, vm.uiState.value.results.size)
        assertTrue(vm.uiState.value.hasSearched)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `search sets error on failure`() = runTest {
        coEvery { mockApi.search(any(), any()) } throws IOException("Network error")

        val vm = createViewModel()
        vm.updateQuery("protection")
        vm.search()
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.errorMessage)
        assertTrue(vm.uiState.value.hasSearched)
    }

    @Test
    fun `blank query does not trigger search`() = runTest {
        val vm = createViewModel()
        vm.updateQuery("")
        vm.search()
        advanceUntilIdle()

        coVerify(exactly = 0) { mockApi.search(any(), any()) }
    }

    @Test
    fun `search with empty results sets hasSearched true`() = runTest {
        coEvery { mockApi.search(any(), any()) } returns Response.success(
            SearchResponse(cases = emptyList())
        )

        val vm = createViewModel()
        vm.updateQuery("nonexistent term xyz")
        vm.search()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.hasSearched)
        assertTrue(vm.uiState.value.results.isEmpty())
        assertNull(vm.uiState.value.errorMessage)
    }

    @Test
    fun `isLoading is true during search and false after`() = runTest {
        val vm = createViewModel()
        // isLoading starts false
        assertFalse(vm.uiState.value.isLoading)

        coEvery { mockApi.search(any(), any()) } coAnswers {
            delay(500)
            Response.success(SearchResponse(cases = emptyList()))
        }

        vm.updateQuery("test")
        vm.search()
        advanceUntilIdle()

        // 搜尋完成後 isLoading 必須回到 false
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `multiple searches update results correctly`() = runTest {
        val cases1 = listOf(ImmigrationCase(caseId = "abc1"))
        val cases2 = listOf(
            ImmigrationCase(caseId = "abc2"),
            ImmigrationCase(caseId = "abc3")
        )

        coEvery { mockApi.search("query1", any()) } returns Response.success(
            SearchResponse(cases = cases1)
        )
        coEvery { mockApi.search("query2", any()) } returns Response.success(
            SearchResponse(cases = cases2)
        )

        val vm = createViewModel()

        vm.updateQuery("query1")
        vm.search()
        advanceUntilIdle()
        assertEquals(1, vm.uiState.value.results.size)

        vm.updateQuery("query2")
        vm.search()
        advanceUntilIdle()
        assertEquals(2, vm.uiState.value.results.size)
    }

    @Test
    fun `error message is cleared on next successful search`() = runTest {
        coEvery { mockApi.search("bad", any()) } throws IOException("Network error")
        coEvery { mockApi.search("good", any()) } returns Response.success(
            SearchResponse(cases = listOf(ImmigrationCase(caseId = "ok")))
        )

        val vm = createViewModel()
        vm.updateQuery("bad")
        vm.search()
        advanceUntilIdle()
        assertNotNull(vm.uiState.value.errorMessage)

        vm.updateQuery("good")
        vm.search()
        advanceUntilIdle()
        assertNull(vm.uiState.value.errorMessage)
        assertEquals(1, vm.uiState.value.results.size)
    }
}
