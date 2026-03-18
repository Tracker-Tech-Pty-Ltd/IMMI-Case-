package au.gov.immi.cases.feature.settings

import au.gov.immi.cases.data.preferences.AppPreferences
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SettingsViewModelTest {

    // SettingsViewModel.init calls launchIn(viewModelScope), so Main dispatcher MUST be set
    // before ViewModel is instantiated.
    private val testDispatcher = StandardTestDispatcher()

    private val mockPreferences = mockk<AppPreferences>(relaxed = true)
    private val serverUrlFlow = MutableStateFlow(AppPreferences.DEFAULT_SERVER_URL)
    private val darkModeFlow = MutableStateFlow(false)
    private val cacheSizeFlow = MutableStateFlow(AppPreferences.DEFAULT_CACHE_SIZE_MB)

    private lateinit var viewModel: SettingsViewModel

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(testDispatcher)

        every { mockPreferences.serverUrl } returns serverUrlFlow
        every { mockPreferences.darkMode } returns darkModeFlow
        every { mockPreferences.cacheSizeMb } returns cacheSizeFlow

        // 模擬 setServerUrl — 更新 flow 以觸發 combine
        coEvery { mockPreferences.setServerUrl(any()) } coAnswers {
            serverUrlFlow.value = firstArg()
        }
        coEvery { mockPreferences.setDarkMode(any()) } coAnswers {
            darkModeFlow.value = firstArg()
        }
        // reset() 清除所有，回到預設值
        coEvery { mockPreferences.reset() } coAnswers {
            serverUrlFlow.value = AppPreferences.DEFAULT_SERVER_URL
            darkModeFlow.value = false
            cacheSizeFlow.value = AppPreferences.DEFAULT_CACHE_SIZE_MB
        }

        viewModel = SettingsViewModel(mockPreferences)
    }

    @AfterEach
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // ─── 1. initial state loads current preferences ───────────────────────────────

    @Test
    fun `initial state loads current preferences`() = runTest {
        advanceUntilIdle()
        val state = viewModel.uiState.value
        assertEquals(AppPreferences.DEFAULT_SERVER_URL, state.serverUrl)
        assertFalse(state.darkMode)
        assertEquals(AppPreferences.DEFAULT_CACHE_SIZE_MB, state.cacheSizeMb)
    }

    // ─── 2. update server URL persists new value ──────────────────────────────────

    @Test
    fun `update server URL persists new value`() = runTest {
        viewModel.onServerUrlChange("http://192.168.1.100:8080")
        viewModel.saveServerUrl()
        advanceUntilIdle()

        coVerify { mockPreferences.setServerUrl("http://192.168.1.100:8080") }
    }

    // ─── 3. toggle dark mode saves preference ─────────────────────────────────────

    @Test
    fun `toggle dark mode saves preference`() = runTest {
        viewModel.setDarkMode(true)
        advanceUntilIdle()

        coVerify { mockPreferences.setDarkMode(true) }
        // ViewModel state should reflect the new value via combine
        assertEquals(true, viewModel.uiState.value.darkMode)
    }

    // ─── 4. server URL validation rejects empty string ───────────────────────────

    @Test
    fun `server URL validation rejects empty string`() = runTest {
        viewModel.onServerUrlChange("")
        viewModel.saveServerUrl()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertNotNull(state.urlError)
        // setServerUrl should NOT have been called with empty string
        coVerify(exactly = 0) { mockPreferences.setServerUrl("") }
        coVerify(exactly = 0) { mockPreferences.setServerUrl(any()) }
    }

    // ─── 5. server URL validation rejects non-http scheme ───────────────────────

    @Test
    fun `server URL validation rejects URL without http scheme`() = runTest {
        viewModel.onServerUrlChange("192.168.1.1:8080")
        viewModel.saveServerUrl()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertNotNull(state.urlError)
        assertTrue(state.urlError!!.contains("http"))
        coVerify(exactly = 0) { mockPreferences.setServerUrl(any()) }
    }

    // ─── 6. reset preferences restores defaults ───────────────────────────────────

    @Test
    fun `reset preferences restores defaults`() = runTest {
        // 先設定自訂值
        viewModel.onServerUrlChange("http://custom:9090")
        viewModel.saveServerUrl()
        viewModel.setDarkMode(true)
        advanceUntilIdle()

        // 重設 — AppPreferences.reset() 更新 mock flows 回到預設值
        viewModel.resetSettings()
        advanceUntilIdle()

        coVerify { mockPreferences.reset() }
        // ViewModel 應透過 combine 收到預設值
        val state = viewModel.uiState.value
        assertEquals(AppPreferences.DEFAULT_SERVER_URL, state.serverUrl)
        assertFalse(state.darkMode)
    }
}
