package au.gov.immi.cases.feature.cases

import app.cash.turbine.test
import au.gov.immi.cases.core.model.CasesFilter
import au.gov.immi.cases.data.repository.CasesRepository
import androidx.paging.PagingData
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CasesViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private val mockRepository = mockk<CasesRepository>()
    private lateinit var viewModel: CasesViewModel

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        every { mockRepository.getCasesPager(any()) } returns flowOf(PagingData.empty())
        viewModel = CasesViewModel(mockRepository)
    }

    @AfterEach
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // ─── 初始狀態測試 ─────────────────────────────────────────────────────────────

    @Test
    fun `initial filter is empty CasesFilter`() = runTest {
        val filter = viewModel.filter.value
        assertEquals(CasesFilter(), filter)
        assertFalse(filter.isFiltered())
    }

    @Test
    fun `initial filter has no court`() = runTest {
        assertNull(viewModel.filter.value.court)
    }

    // ─── updateFilter 測試 ────────────────────────────────────────────────────────

    @Test
    fun `updateFilter changes filter state`() = runTest {
        viewModel.filter.test {
            val initial = awaitItem()
            assertEquals(CasesFilter(), initial)

            viewModel.updateFilter(CasesFilter(court = "AATA"))
            val updated = awaitItem()
            assertEquals("AATA", updated.court)

            cancelAndIgnoreRemainingEvents()
        }
    }

    // ─── resetFilter 測試 ─────────────────────────────────────────────────────────

    @Test
    fun `resetFilter clears all filters`() = runTest {
        viewModel.updateFilter(CasesFilter(court = "FCA", year = 2024))

        viewModel.resetFilter()

        assertEquals(CasesFilter(), viewModel.filter.value)
    }

    // ─── filterByCourt 測試 ───────────────────────────────────────────────────────

    @Test
    fun `filterByCourt updates court and resets page`() = runTest {
        viewModel.filterByCourt("AATA")

        val filter = viewModel.filter.value
        assertEquals("AATA", filter.court)
        assertEquals(1, filter.page)
    }

    @Test
    fun `filterByCourt replaces existing court`() = runTest {
        viewModel.filterByCourt("FCA")
        viewModel.filterByCourt("AATA")

        assertEquals("AATA", viewModel.filter.value.court)
    }

    // ─── filterByYear 測試 ────────────────────────────────────────────────────────

    @Test
    fun `filterByYear updates year filter`() = runTest {
        viewModel.filterByYear(2024)
        assertEquals(2024, viewModel.filter.value.year)
    }

    @Test
    fun `filterByYear resets page to 1`() = runTest {
        viewModel.updateFilter(CasesFilter(page = 3))
        viewModel.filterByYear(2023)
        assertEquals(1, viewModel.filter.value.page)
    }

    // ─── filterByOutcome 測試 ────────────────────────────────────────────────────

    @Test
    fun `filterByOutcome updates outcome filter`() = runTest {
        viewModel.filterByOutcome("Granted")
        assertEquals("Granted", viewModel.filter.value.outcome)
    }

    // ─── setSearchQuery 測試 ─────────────────────────────────────────────────────

    @Test
    fun `setSearchQuery updates search and resets page`() = runTest {
        viewModel.setSearchQuery("protection visa")

        val filter = viewModel.filter.value
        assertEquals("protection visa", filter.search)
        assertEquals(1, filter.page)
    }

    @Test
    fun `setSearchQuery marks filter as filtered`() = runTest {
        viewModel.setSearchQuery("refugee")
        assertTrue(viewModel.filter.value.isFiltered())
    }

    // ─── repository 互動測試 ──────────────────────────────────────────────────────

    @Test
    fun `getCasesPager is called when filter changes`() = runTest {
        // cases 是冷 flow，必須先 collect 才會觸發 flatMapLatest
        val collectJob = backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            viewModel.cases.collect {}
        }

        viewModel.filterByCourt("HCA")
        testDispatcher.scheduler.advanceUntilIdle()

        verify { mockRepository.getCasesPager(match { it.court == "HCA" }) }
        collectJob.cancel()
    }
}
