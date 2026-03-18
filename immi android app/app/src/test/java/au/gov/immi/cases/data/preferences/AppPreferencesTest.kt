package au.gov.immi.cases.data.preferences

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.File

@OptIn(ExperimentalCoroutinesApi::class)
class AppPreferencesTest {

    private lateinit var preferences: AppPreferences
    private lateinit var testDataStoreFile: File

    // UnconfinedTestDispatcher 允許協程立即執行，避免 UncompletedCoroutinesError
    private val testDispatcher = UnconfinedTestDispatcher()
    private val testScope = TestScope(testDispatcher)

    @BeforeEach
    fun setUp() {
        testDataStoreFile = File.createTempFile("test_prefs_${System.nanoTime()}", ".preferences_pb")
        val testDataStore = PreferenceDataStoreFactory.create(
            // 使用 backgroundScope 讓 DataStore 的 IO 協程在測試結束後自動取消
            scope = testScope.backgroundScope,
            produceFile = { testDataStoreFile }
        )
        preferences = AppPreferences(testDataStore)
    }

    @AfterEach
    fun tearDown() {
        testDataStoreFile.deleteOnExit()
    }

    @Test
    fun `default server URL is emulator address`() = testScope.runTest {
        val url = preferences.serverUrl.first()
        assertEquals("http://10.0.2.2:8080", url)
    }

    @Test
    fun `setServerUrl persists value`() = testScope.runTest {
        preferences.setServerUrl("http://192.168.1.100:8080")
        val url = preferences.serverUrl.first()
        assertEquals("http://192.168.1.100:8080", url)
    }

    @Test
    fun `default dark mode is false`() = testScope.runTest {
        val dark = preferences.darkMode.first()
        assertFalse(dark)
    }

    @Test
    fun `setDarkMode persists value`() = testScope.runTest {
        preferences.setDarkMode(true)
        val dark = preferences.darkMode.first()
        assertTrue(dark)
    }

    @Test
    fun `reset clears all preferences`() = testScope.runTest {
        preferences.setServerUrl("http://custom:8080")
        preferences.reset()
        val url = preferences.serverUrl.first()
        assertEquals("http://10.0.2.2:8080", url) // 重設後回到預設值
    }

    @Test
    fun `KEY_SERVER_URL has correct name`() {
        assertEquals("server_url", AppPreferences.KEY_SERVER_URL.name)
    }
}
