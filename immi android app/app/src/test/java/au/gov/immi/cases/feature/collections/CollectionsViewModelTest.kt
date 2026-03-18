package au.gov.immi.cases.feature.collections

import androidx.lifecycle.SavedStateHandle
import app.cash.turbine.test
import au.gov.immi.cases.data.local.dao.CollectionDao
import au.gov.immi.cases.data.local.entity.CollectionCaseEntity
import au.gov.immi.cases.data.local.entity.CollectionEntity
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CollectionsViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private val mockCollectionDao = mockk<CollectionDao>(relaxed = true)
    private lateinit var viewModel: CollectionsViewModel

    private val sampleCollections = listOf(
        CollectionEntity(
            id = 1L,
            name = "Favourite Cases",
            description = "My favourite immigration cases",
            color = "#3b82f6",
            createdAt = 1000L,
            updatedAt = 1000L
        ),
        CollectionEntity(
            id = 2L,
            name = "2024 Grants",
            description = "Granted cases from 2024",
            color = "#10b981",
            createdAt = 2000L,
            updatedAt = 2000L
        )
    )

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        every { mockCollectionDao.getAllCollections() } returns flowOf(sampleCollections)
        viewModel = CollectionsViewModel(mockCollectionDao)
    }

    @AfterEach
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // ─── 1. initial state loads collections from Room ─────────────────────────────
    // StateFlow backed by stateIn(WhileSubscribed) emits initial empty list first,
    // then the flowOf(sampleCollections) value. We observe both and check the last.

    @Test
    fun `initial state loads collections from Room`() = runTest {
        viewModel.collections.test {
            // stateIn initial value is emptyList() before upstream emits
            val first = awaitItem()
            // Skip empty initial if it appears, else check immediately
            val actual = if (first.isEmpty()) awaitItem() else first
            assertEquals(2, actual.size)
            assertEquals("Favourite Cases", actual.first().name)
            cancelAndIgnoreRemainingEvents()
        }
    }

    // ─── 2. create collection inserts new entity ──────────────────────────────────

    @Test
    fun `create collection inserts new entity`() = runTest {
        val slot = slot<CollectionEntity>()
        coEvery { mockCollectionDao.insertCollection(capture(slot)) } returns 3L

        viewModel.createCollection("New Collection", "A new test collection")
        advanceUntilIdle()

        coVerify { mockCollectionDao.insertCollection(any()) }
        assertEquals("New Collection", slot.captured.name)
        assertEquals("A new test collection", slot.captured.description)
    }

    // ─── 3. delete collection removes from Room ───────────────────────────────────

    @Test
    fun `delete collection removes from Room`() = runTest {
        val toDelete = sampleCollections.first()
        viewModel.deleteCollection(toDelete)
        advanceUntilIdle()

        coVerify { mockCollectionDao.deleteCollection(toDelete) }
    }

    // ─── 4. collections flow emits updates ───────────────────────────────────────

    @Test
    fun `collections flow emits updates`() = runTest {
        val updatedList = sampleCollections + CollectionEntity(
            id = 3L, name = "New", description = "", color = "#000000",
            createdAt = 3000L, updatedAt = 3000L
        )
        // Return a flow with two emissions
        every { mockCollectionDao.getAllCollections() } returns flowOf(sampleCollections, updatedList)
        val freshViewModel = CollectionsViewModel(mockCollectionDao)

        freshViewModel.collections.test {
            // Drain initial empty value if present
            var item = awaitItem()
            if (item.isEmpty()) item = awaitItem()
            // First real emission
            assertEquals(2, item.size)
            // Second emission (updated)
            val second = awaitItem()
            assertEquals(3, second.size)
            cancelAndIgnoreRemainingEvents()
        }
    }

    // ─── 5. create collection with empty name fails ───────────────────────────────

    @Test
    fun `create collection with empty name fails`() = runTest {
        viewModel.createCollection("")
        advanceUntilIdle()

        // 不應該呼叫 DAO
        coVerify(exactly = 0) { mockCollectionDao.insertCollection(any()) }
        // 應該有錯誤訊息
        assertNotNull(viewModel.createError.value)
        assertTrue(viewModel.createError.value!!.isNotBlank())
    }

    // ─── 6. collection detail loads case ids ─────────────────────────────────────

    @Test
    fun `collection detail loads case ids`() = runTest {
        val caseIds = listOf("case001", "case002", "case003")
        every { mockCollectionDao.getCaseIdsInCollection(1L) } returns flowOf(caseIds)
        coEvery { mockCollectionDao.getCollectionById(1L) } returns sampleCollections.first()

        val savedStateHandle = SavedStateHandle(mapOf("collectionId" to 1L))
        val detailViewModel = CollectionDetailViewModel(mockCollectionDao, savedStateHandle)

        detailViewModel.caseIds.test {
            // Drain initial empty value
            var ids = awaitItem()
            if (ids.isEmpty()) ids = awaitItem()
            assertEquals(3, ids.size)
            assertTrue(ids.contains("case001"))
            cancelAndIgnoreRemainingEvents()
        }
    }
}
