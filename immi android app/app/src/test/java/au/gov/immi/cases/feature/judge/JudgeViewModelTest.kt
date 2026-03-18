package au.gov.immi.cases.feature.judge

import app.cash.turbine.test
import au.gov.immi.cases.core.model.JudgeEntry
import au.gov.immi.cases.data.repository.AnalyticsRepository
import androidx.lifecycle.SavedStateHandle
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
class JudgeViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private val mockRepository = mockk<AnalyticsRepository>()
    private lateinit var viewModel: JudgeViewModel

    private val leaderboardEntries = listOf(
        JudgeEntry("Smith J", 450, 0.65),
        JudgeEntry("Jones M", 320, 0.58),
        JudgeEntry("Brown A", 290, 0.72)
    )

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterEach
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel(judgeName: String = ""): JudgeViewModel {
        val savedStateHandle = SavedStateHandle(
            if (judgeName.isNotBlank()) mapOf("judgeName" to judgeName) else emptyMap()
        )
        return JudgeViewModel(mockRepository, savedStateHandle)
    }

    // ─── 1. Initial leaderboard state is Loading ─────────────────────────────────

    @Test
    fun `initial leaderboard state is Loading`() = runTest {
        viewModel = createViewModel()
        assertFalse(viewModel.leaderboard.value.isLoading)
        assertTrue(viewModel.leaderboard.value.entries.isEmpty())
        assertNull(viewModel.leaderboard.value.error)
    }

    // ─── 2. loadLeaderboard success populates judge entries sorted by case count ─

    @Test
    fun `loadLeaderboard success populates judge entries sorted by case count`() = runTest {
        coEvery { mockRepository.getJudgeLeaderboard(any()) } returns Result.success(leaderboardEntries)
        viewModel = createViewModel()
        viewModel.loadLeaderboard()
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.leaderboard.value
        assertFalse(state.isLoading)
        assertEquals(3, state.entries.size)
        assertEquals("Smith J", state.entries.first().name)
        assertEquals(450, state.entries.first().totalCases)
        assertNull(state.error)
    }

    // ─── 3. loadJudgeProfile sets profile data ───────────────────────────────────

    @Test
    fun `loadJudgeProfile sets profile data`() = runTest {
        val profileData = mapOf<String, Any>(
            "name" to "Smith J",
            "total_cases" to 450,
            "success_rate" to 0.65
        )
        coEvery { mockRepository.getJudgeProfile("Smith J") } returns Result.success(profileData)
        viewModel = createViewModel("Smith J")
        viewModel.loadProfile("Smith J")
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.profile.value
        assertFalse(state.isLoading)
        assertEquals("Smith J", state.judgeName)
        assertEquals(450, state.data["total_cases"] as Int)
        assertNull(state.error)
    }

    // ─── 4. Judge profile with empty name shows error ─────────────────────────────

    @Test
    fun `judge profile with empty name shows error`() = runTest {
        viewModel = createViewModel()
        viewModel.loadProfile("")
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.profile.value
        assertFalse(state.isLoading)
        assertNotNull(state.error)
        assertEquals("Judge name required", state.error)
    }

    // ─── 5. compareJudges builds comma-separated names query ──────────────────────

    @Test
    fun `compareJudges builds comma-separated names query`() = runTest {
        val compareData = mapOf<String, Any>("comparison" to "data")
        coEvery { mockRepository.compareJudges(listOf("Smith J", "Jones M")) } returns Result.success(compareData)
        viewModel = createViewModel()
        viewModel.compareJudges(listOf("Smith J", "Jones M"))
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.compare.value
        assertFalse(state.isLoading)
        assertNotNull(state.data["comparison"])
        assertNull(state.error)
        coVerify { mockRepository.compareJudges(listOf("Smith J", "Jones M")) }
    }

    // ─── 6. Judge detail outcomes are parsed ─────────────────────────────────────

    @Test
    fun `judge detail outcomes are parsed`() = runTest {
        val profileData = mapOf<String, Any>(
            "name" to "Brown A",
            "total_cases" to 290,
            "outcomes" to mapOf("Granted" to 210, "Dismissed" to 80)
        )
        coEvery { mockRepository.getJudgeProfile("Brown A") } returns Result.success(profileData)
        viewModel = createViewModel("Brown A")
        viewModel.loadProfile("Brown A")
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.profile.value
        @Suppress("UNCHECKED_CAST")
        val outcomes = state.data["outcomes"] as? Map<String, Int>
        assertNotNull(outcomes)
        assertEquals(210, outcomes?.get("Granted"))
    }

    // ─── 7. Leaderboard error sets error state ────────────────────────────────────

    @Test
    fun `leaderboard error sets error state`() = runTest {
        coEvery { mockRepository.getJudgeLeaderboard(any()) } returns Result.failure(Exception("Server error"))
        viewModel = createViewModel()
        viewModel.loadLeaderboard()
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.leaderboard.value
        assertFalse(state.isLoading)
        assertTrue(state.entries.isEmpty())
        assertEquals("Server error", state.error)
    }
}
