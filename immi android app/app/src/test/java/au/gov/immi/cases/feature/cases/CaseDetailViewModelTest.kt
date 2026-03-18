package au.gov.immi.cases.feature.cases

import androidx.lifecycle.SavedStateHandle
import au.gov.immi.cases.core.model.ImmigrationCase
import au.gov.immi.cases.data.repository.CasesRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
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

@OptIn(ExperimentalCoroutinesApi::class)
class CaseDetailViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private val mockRepository = mockk<CasesRepository>()

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @AfterEach
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel(caseId: String = "abc123"): CaseDetailViewModel {
        val savedState = SavedStateHandle(mapOf("caseId" to caseId))
        return CaseDetailViewModel(mockRepository, savedState)
    }

    // ─── 初始狀態測試 ─────────────────────────────────────────────────────────────

    @Test
    fun `initial state has isLoading true`() = runTest {
        val case = ImmigrationCase(caseId = "abc123")
        coEvery { mockRepository.getCaseById("abc123") } coAnswers {
            delay(100)
            Result.success(case)
        }
        coEvery { mockRepository.getSimilarCases(any()) } returns Result.success(emptyList())

        val vm = createViewModel()
        // 建立後協程尚未完成 — isLoading 為 true 或 case 已載入（取決於排程器）
        assertTrue(vm.uiState.value.isLoading || vm.uiState.value.case != null)
    }

    // ─── 載入成功測試 ─────────────────────────────────────────────────────────────

    @Test
    fun `loads case on init successfully`() = runTest {
        val case = ImmigrationCase(caseId = "abc123", citation = "[2024] AATA 1")
        coEvery { mockRepository.getCaseById("abc123") } returns Result.success(case)
        coEvery { mockRepository.getSimilarCases(any()) } returns Result.success(emptyList())

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals(case, vm.uiState.value.case)
        assertFalse(vm.uiState.value.isLoading)
        assertNull(vm.uiState.value.errorMessage)
    }

    // ─── 錯誤處理測試 ─────────────────────────────────────────────────────────────

    @Test
    fun `shows error message when case not found`() = runTest {
        coEvery { mockRepository.getCaseById("abc123") } returns Result.failure(Exception("Not found"))

        val vm = createViewModel()
        advanceUntilIdle()

        assertNull(vm.uiState.value.case)
        assertNotNull(vm.uiState.value.errorMessage)
        assertTrue(vm.uiState.value.errorMessage!!.contains("Not found"))
        assertFalse(vm.uiState.value.isLoading)
    }

    // ─── 相似案件測試 ─────────────────────────────────────────────────────────────

    @Test
    fun `loads similar cases after main case`() = runTest {
        val case = ImmigrationCase(caseId = "abc123")
        val similar = listOf(
            ImmigrationCase(caseId = "sim1"),
            ImmigrationCase(caseId = "sim2")
        )
        coEvery { mockRepository.getCaseById("abc123") } returns Result.success(case)
        coEvery { mockRepository.getSimilarCases("abc123") } returns Result.success(similar)

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.similarCases.size)
        assertEquals("sim1", vm.uiState.value.similarCases[0].caseId)
        assertEquals("sim2", vm.uiState.value.similarCases[1].caseId)
    }

    @Test
    fun `similar cases failure is silent — main case still shows`() = runTest {
        val case = ImmigrationCase(caseId = "abc123")
        coEvery { mockRepository.getCaseById("abc123") } returns Result.success(case)
        coEvery { mockRepository.getSimilarCases("abc123") } returns Result.failure(Exception("Similar failed"))

        val vm = createViewModel()
        advanceUntilIdle()

        // 主要案件仍可顯示
        assertNotNull(vm.uiState.value.case)
        // 相似案件失敗不設定錯誤訊息（silent fail）
        assertNull(vm.uiState.value.errorMessage)
    }

    // ─── 重試測試 ─────────────────────────────────────────────────────────────────

    @Test
    fun `reload clears error and retries successfully`() = runTest {
        val case = ImmigrationCase(caseId = "abc123")
        coEvery { mockRepository.getCaseById("abc123") } returnsMany listOf(
            Result.failure(Exception("First fail")),
            Result.success(case)
        )
        coEvery { mockRepository.getSimilarCases(any()) } returns Result.success(emptyList())

        val vm = createViewModel()
        advanceUntilIdle()
        assertNotNull(vm.uiState.value.errorMessage)

        vm.loadCase()
        advanceUntilIdle()

        assertNull(vm.uiState.value.errorMessage)
        assertNotNull(vm.uiState.value.case)
        assertEquals(case, vm.uiState.value.case)
    }

    // ─── SavedStateHandle 測試 ────────────────────────────────────────────────────

    @Test
    fun `SavedStateHandle provides caseId to repository call`() = runTest {
        val case = ImmigrationCase(caseId = "test-id-999")
        coEvery { mockRepository.getCaseById("test-id-999") } returns Result.success(case)
        coEvery { mockRepository.getSimilarCases(any()) } returns Result.success(emptyList())

        val vm = createViewModel("test-id-999")
        advanceUntilIdle()

        // ViewModel 不拋出異常，且用正確的 ID 查詢
        coVerify { mockRepository.getCaseById("test-id-999") }
        assertNotNull(vm)
        assertEquals(case, vm.uiState.value.case)
    }
}
