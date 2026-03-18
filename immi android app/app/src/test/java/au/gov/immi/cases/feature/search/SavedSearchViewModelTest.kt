package au.gov.immi.cases.feature.search

import app.cash.turbine.test
import au.gov.immi.cases.data.local.dao.SavedSearchDao
import au.gov.immi.cases.data.local.entity.SavedSearchEntity
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SavedSearchViewModelTest {

    private val mockDao = mockk<SavedSearchDao>(relaxed = true)

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @AfterEach
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel(): SavedSearchViewModel {
        every { mockDao.getAllSavedSearches() } returns flowOf(emptyList())
        return SavedSearchViewModel(mockDao)
    }

    // ─── 初始狀態測試 ──────────────────────────────────────────────────────────

    @Test
    fun `initial savedSearches is empty`() = runTest {
        val vm = createViewModel()
        vm.savedSearches.test {
            assertEquals(emptyList<SavedSearchEntity>(), awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    // ─── saveSearch 測試 ──────────────────────────────────────────────────────

    @Test
    fun `saveSearch calls dao insertSavedSearch`() = runTest {
        coEvery { mockDao.insertSavedSearch(any()) } returns 1L
        val vm = createViewModel()

        vm.saveSearch(
            name = "AATA 2024",
            query = """{"court_code":"AATA"}""",
            resultCount = 100
        )
        advanceUntilIdle()

        coVerify {
            mockDao.insertSavedSearch(match { it.name == "AATA 2024" && it.resultCount == 100 })
        }
    }

    @Test
    fun `saveSearch stores query as JSON string`() = runTest {
        coEvery { mockDao.insertSavedSearch(any()) } returns 1L
        val vm = createViewModel()

        val jsonQuery = """{"court_code":"FCA","year":"2023"}"""
        vm.saveSearch(name = "FCA 2023", query = jsonQuery)
        advanceUntilIdle()

        coVerify { mockDao.insertSavedSearch(match { it.query == jsonQuery }) }
    }

    @Test
    fun `saveSearch with resultCount 0 is valid`() = runTest {
        coEvery { mockDao.insertSavedSearch(any()) } returns 1L
        val vm = createViewModel()

        vm.saveSearch("Empty results search", "{}")
        advanceUntilIdle()

        coVerify { mockDao.insertSavedSearch(match { it.resultCount == 0 }) }
    }

    // ─── deleteSearch 測試 ───────────────────────────────────────────────────

    @Test
    fun `deleteSearch calls dao deleteSavedSearch`() = runTest {
        val search = SavedSearchEntity(id = 1L, name = "Test", query = "{}")
        val vm = createViewModel()

        vm.deleteSearch(search)
        advanceUntilIdle()

        coVerify { mockDao.deleteSavedSearch(search) }
    }

    // ─── savedSearches Flow 測試 ─────────────────────────────────────────────

    @Test
    fun `savedSearches flow emits from dao`() = runTest {
        val searches = listOf(
            SavedSearchEntity(id = 1L, name = "Search 1", query = "{}"),
            SavedSearchEntity(id = 2L, name = "Search 2", query = "{}")
        )
        every { mockDao.getAllSavedSearches() } returns flowOf(searches)

        val vm = SavedSearchViewModel(mockDao)
        vm.savedSearches.test {
            assertEquals(2, awaitItem().size)
            cancelAndIgnoreRemainingEvents()
        }
    }

    // ─── SavedSearchEntity 預設值測試 ────────────────────────────────────────

    @Test
    fun `SavedSearchEntity has correct default values`() {
        val entity = SavedSearchEntity(name = "Test", query = "{}")
        assertEquals(0L, entity.id)
        assertEquals(0, entity.resultCount)
        assertEquals(0L, entity.lastRunAt)
    }

    @Test
    fun `SavedSearchEntity name is set correctly`() {
        val entity = SavedSearchEntity(name = "My Search", query = """{"court":"AATA"}""")
        assertEquals("My Search", entity.name)
        assertEquals("""{"court":"AATA"}""", entity.query)
    }

    // ─── 批次操作測試 ────────────────────────────────────────────────────────

    @Test
    fun `multiple saves accumulate in dao`() = runTest {
        coEvery { mockDao.insertSavedSearch(any()) } returnsMany listOf(1L, 2L, 3L)
        val vm = createViewModel()

        vm.saveSearch("Search 1", "{}")
        vm.saveSearch("Search 2", "{}")
        vm.saveSearch("Search 3", "{}")
        advanceUntilIdle()

        coVerify(exactly = 3) { mockDao.insertSavedSearch(any()) }
    }
}
