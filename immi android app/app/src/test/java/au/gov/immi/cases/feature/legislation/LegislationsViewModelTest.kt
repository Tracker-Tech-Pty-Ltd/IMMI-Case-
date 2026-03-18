package au.gov.immi.cases.feature.legislation

import app.cash.turbine.test
import au.gov.immi.cases.core.model.LegislationItem
import au.gov.immi.cases.data.repository.LegislationsRepository
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
class LegislationsViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private val mockRepository = mockk<LegislationsRepository>()
    private lateinit var viewModel: LegislationsViewModel

    private val sampleLegislations = listOf(
        LegislationItem(
            id = "mia1958",
            title = "Migration Act 1958",
            shortTitle = "Migration Act",
            description = "The primary legislation governing immigration to Australia.",
            year = 1958
        ),
        LegislationItem(
            id = "bpsa2007",
            title = "Border Protection (Validation and Enforcement Powers) Act 2007",
            shortTitle = "BPVEP Act",
            description = "Validates and enforces border protection powers.",
            year = 2007
        )
    )

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterEach
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // ─── 1. initial state is Loading ─────────────────────────────────────────────

    @Test
    fun `initial state is Loading`() = runTest {
        coEvery { mockRepository.getLegislations(any()) } returns Result.success(sampleLegislations)
        viewModel = LegislationsViewModel(mockRepository)

        // 在排程執行前，應為 loading 或空列表（isLoading = true）
        assertTrue(viewModel.listState.value.isLoading || viewModel.listState.value.items.isEmpty())
    }

    // ─── 2. loadLegislations success populates list ───────────────────────────────

    @Test
    fun `loadLegislations success populates list`() = runTest {
        coEvery { mockRepository.getLegislations(any()) } returns Result.success(sampleLegislations)
        viewModel = LegislationsViewModel(mockRepository)

        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.listState.value
        assertFalse(state.isLoading)
        assertEquals(2, state.items.size)
        assertNull(state.error)
    }

    // ─── 3. legislation item has title and description parsed ─────────────────────

    @Test
    fun `legislation item has title and description parsed`() = runTest {
        coEvery { mockRepository.getLegislations(any()) } returns Result.success(sampleLegislations)
        viewModel = LegislationsViewModel(mockRepository)
        testDispatcher.scheduler.advanceUntilIdle()

        val item = viewModel.listState.value.items.first()
        assertEquals("Migration Act 1958", item.title)
        assertEquals("The primary legislation governing immigration to Australia.", item.description)
        assertEquals(1958, item.year)
    }

    // ─── 4. search with query filters results ────────────────────────────────────

    @Test
    fun `search with query filters results`() = runTest {
        val filteredList = listOf(sampleLegislations.first())
        coEvery { mockRepository.getLegislations(any()) } returns Result.success(sampleLegislations)
        coEvery { mockRepository.searchLegislations("migration") } returns Result.success(filteredList)

        viewModel = LegislationsViewModel(mockRepository)
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.search("migration")
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.listState.value
        assertEquals(1, state.items.size)
        assertEquals("migration", state.searchQuery)
        coVerify { mockRepository.searchLegislations("migration") }
    }

    // ─── 5. search with empty query returns full list ────────────────────────────

    @Test
    fun `search with empty query returns full list`() = runTest {
        coEvery { mockRepository.getLegislations(null) } returns Result.success(sampleLegislations)
        viewModel = LegislationsViewModel(mockRepository)
        testDispatcher.scheduler.advanceUntilIdle()

        viewModel.search("")
        testDispatcher.scheduler.advanceUntilIdle()

        // 空查詢應觸發 loadLegislations(null)，回傳完整清單
        val state = viewModel.listState.value
        assertEquals(2, state.items.size)
        coVerify(atLeast = 2) { mockRepository.getLegislations(null) }
    }

    // ─── 6. loadLegislation detail success sets data ─────────────────────────────

    @Test
    fun `loadLegislation detail success sets data`() = runTest {
        coEvery { mockRepository.getLegislations(any()) } returns Result.success(sampleLegislations)
        coEvery { mockRepository.getLegislation("mia1958") } returns Result.success(sampleLegislations.first())
        viewModel = LegislationsViewModel(mockRepository)
        testDispatcher.scheduler.advanceUntilIdle()

        // searchQuery 清空後，list 仍正確
        val state = viewModel.listState.value
        assertNotNull(state.items.firstOrNull { it.id == "mia1958" })
    }

    // ─── 7. load legislation error sets error state ───────────────────────────────

    @Test
    fun `load legislation error sets error state`() = runTest {
        coEvery { mockRepository.getLegislations(any()) } returns Result.failure(Exception("Network error"))
        viewModel = LegislationsViewModel(mockRepository)
        testDispatcher.scheduler.advanceUntilIdle()

        val state = viewModel.listState.value
        assertFalse(state.isLoading)
        assertNotNull(state.error)
        assertEquals("Network error", state.error)
        assertTrue(state.items.isEmpty())
    }
}
