package au.gov.immi.cases.data.preferences

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 使用 DataStore Preferences 儲存使用者應用程式設定。
 *
 * 包含：
 * - 伺服器 URL（預設為 Android Emulator 主機 10.0.2.2）
 * - 深色模式開關
 * - 快取大小上限
 */
@Singleton
class AppPreferences @Inject constructor(
    private val dataStore: DataStore<Preferences>
) {

    companion object {
        val KEY_SERVER_URL = stringPreferencesKey("server_url")
        val KEY_DARK_MODE = booleanPreferencesKey("dark_mode")
        val KEY_CACHE_SIZE_MB = intPreferencesKey("cache_size_mb")

        const val DEFAULT_SERVER_URL = "http://10.0.2.2:8080"
        const val DEFAULT_CACHE_SIZE_MB = 100
    }

    /** 伺服器 URL，預設為模擬器本機 */
    val serverUrl: Flow<String> = dataStore.data
        .catch { exception ->
            if (exception is IOException) emit(emptyPreferences()) else throw exception
        }
        .map { prefs -> prefs[KEY_SERVER_URL] ?: DEFAULT_SERVER_URL }

    /** 深色模式開關，預設為系統設定（false = 淺色） */
    val darkMode: Flow<Boolean> = dataStore.data
        .catch { exception ->
            if (exception is IOException) emit(emptyPreferences()) else throw exception
        }
        .map { prefs -> prefs[KEY_DARK_MODE] ?: false }

    /** 本地快取大小上限（MB），預設 100 MB */
    val cacheSizeMb: Flow<Int> = dataStore.data
        .catch { exception ->
            if (exception is IOException) emit(emptyPreferences()) else throw exception
        }
        .map { prefs -> prefs[KEY_CACHE_SIZE_MB] ?: DEFAULT_CACHE_SIZE_MB }

    /** 更新伺服器 URL */
    suspend fun setServerUrl(url: String) {
        dataStore.edit { prefs -> prefs[KEY_SERVER_URL] = url }
    }

    /** 切換深色模式 */
    suspend fun setDarkMode(enabled: Boolean) {
        dataStore.edit { prefs -> prefs[KEY_DARK_MODE] = enabled }
    }

    /** 更新快取大小上限 */
    suspend fun setCacheSizeMb(sizeMb: Int) {
        dataStore.edit { prefs -> prefs[KEY_CACHE_SIZE_MB] = sizeMb }
    }

    /** 清除所有偏好設定，恢復預設值 */
    suspend fun reset() {
        dataStore.edit { prefs -> prefs.clear() }
    }
}
