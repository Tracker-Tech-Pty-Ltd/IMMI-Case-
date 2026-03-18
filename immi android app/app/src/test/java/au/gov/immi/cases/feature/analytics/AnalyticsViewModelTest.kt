package au.gov.immi.cases.feature.analytics

import app.cash.turbine.test
import au.gov.immi.cases.core.model.AnalyticsFilter
import au.gov.immi.cases.core.model.ConceptEntry
import au.gov.immi.cases.core.model.JudgeEntry
import au.gov.immi.cases.core.model.NatureOutcomeEntry
import au.gov.immi.cases.core.model.OutcomeEntry
import au.gov.immi.cases.data.repository.AnalyticsRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
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

@OptIn(ExperimentalCoroutinesApi::class)
class AnalyticsViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private val mockRepository = mockk<AnalyticsRepository>()
    private lateinit var viewModel: AnalyticsViewModel

    private val defaultOutcomes = listOf(
        OutcomeEntry("Granted", 5000, 33.3),
        OutcomeEntry("Dismissed", 8000, 53.3),
        OutcomeEntry("Withdrawn", 2016, 13.4)
    )
    private val defaultJudges = listOf(
        JudgeEntry("Smith J", 450, 0.65),
        JudgeEntry("Jones M", 320, 0.58)
    )
    private val defaultConcepts = listOf(
        ConceptEntry("Protection visa", 3200, 0.71)
    )
    private val defaultNatureOutcome = listOf(
        NatureOutcomeEntry("Visa Application", "Granted", 2500)
    )

    private fun setupDefaultMocks(filter: AnalyticsFilter = AnalyticsFilter()) {
        coEvery { mockRepository.getOutcomes(any()) } returns Result.success(defaultOutcomes)
        coEvery { mockRepository.getJudges(any()) } returns Result.success(defaultJudges)
        coEvery { mockRepository.getLegalConcepts(any()) } returns Result.success(defaultConcepts)
        coEvery { mockRepository.getNatureOutcome(any()) } returns Result.success(defaultNatureOutcome)
    }

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterEach
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // ─── 1. Initial state is not yet loaded (before scheduling) ─────────────────

    @Test
    fun `initial state has empty outcomes before load completes`() = runTest {
        setupDefaultMocks()
        viewModel = AnalyticsViewModel(mockRepository)

        // 在排程執行前，outcomes 是空的（尚未完成 API 呼叫）
        assertTrue(viewModel.uiState.value.outcomes.isEmpty())

        // 執行完後應有資料
        testDispatcher.scheduler.advanceUntilIdle()
        assertEquals(3, viewModel.uiState.value.outcomes.size)
    }

    // ─── 2. loadOutcomes success sets outcome entries ─────────────────────────────

    @Test
    fun `loadOutcomes success sets outcome entries`() = runTest {
        setupDefaultMocks()
        viewModel = AnalyticsViewModel(mockRepository)

        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isLoading)
        assertEquals(3, state.outcomes.size)
        assertNull(state.error)
    }

    // ─── 3. Outcome entries have correct label and count ──────────────────────────

    @Test
    fun `outcome entries have correct label and count`() = runTest {
        setupDefaultMocks()
        viewModel = AnalyticsViewModel(mockRepository)
        testDispatcher.scheduler.advanceUntilIdle()

        val granted = viewModel.uiState.value.outcomes.first { it.label == "Granted" }
        assertEquals(5000, granted.count)
        assertEquals(33.3, granted.percentage, 0.01)
    }

    // ─── 4. loadJudges success populates judge entries ────────────────────────────

    @Test
    fun `loadJudges success populates judge entries`() = runTest {
        setupDefaultMocks()
        viewModel = AnalyticsViewModel(mockRepository)
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(2, state.judges.size)
        assertEquals("Smith J", state.judges.first().name)
        assertEquals(450, state.judges.first().totalCases)
    }

    // ─── 5. Apply filter reloads with new params ──────────────────────────────────

    @Test
    fun `apply filter reloads with new params`() = runTest {
        setupDefaultMocks()
        viewModel = AnalyticsViewModel(mockRepository)
        testDispatcher.scheduler.advanceUntilIdle()

        val newFilter = AnalyticsFilter(court = "AATA")
        viewModel.applyFilter(newFilter)
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals("AATA", viewModel.uiState.value.filter.court)
        // 應該呼叫兩次（init + applyFilter）
        coVerify(atLeast = 2) { mockRepository.getOutcomes(any()) }
    }

    // ─── 6. Filter court sets court param ────────────────────────────────────────

    @Test
    fun `filter court sets court param`() = runTest {
        setupDefaultMocks()
        viewModel = AnalyticsViewModel(mockRepository)
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.applyFilter(AnalyticsFilter(court = "FCA", yearFrom = 2020))
        testDispatcher.scheduler.advanceUntilIdle()

        val filter = viewModel.uiState.value.filter
        assertEquals("FCA", filter.court)
        assertEquals(2020, filter.yearFrom)
        assertTrue(filter.isFiltered())
    }

    // ─── 7. Clear filter resets to default ───────────────────────────────────────

    @Test
    fun `clear filter resets to default`() = runTest {
        setupDefaultMocks()
        viewModel = AnalyticsViewModel(mockRepository)
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.applyFilter(AnalyticsFilter(court = "AATA"))
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.clearFilter()
        testDispatcher.scheduler.advanceUntilIdle()

        val filter = viewModel.uiState.value.filter
        assertNull(filter.court)
        assertFalse(filter.isFiltered())
    }

    // ─── 8. loadNatureOutcome parses matrix data ──────────────────────────────────

    @Test
    fun `loadNatureOutcome parses matrix data`() = runTest {
        setupDefaultMocks()
        viewModel = AnalyticsViewModel(mockRepository)
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.uiState.value
        assertEquals(1, state.natureOutcome.size)
        assertEquals("Visa Application", state.natureOutcome.first().nature)
        assertEquals("Granted", state.natureOutcome.first().outcome)
        assertEquals(2500, state.natureOutcome.first().count)
    }
}
