package au.gov.immi.cases.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.gov.immi.cases.data.preferences.AppPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val serverUrl: String = AppPreferences.DEFAULT_SERVER_URL,
    val darkMode: Boolean = false,
    val cacheSizeMb: Int = AppPreferences.DEFAULT_CACHE_SIZE_MB,
    val serverUrlInput: String = AppPreferences.DEFAULT_SERVER_URL,
    val urlError: String? = null,
    val isSaved: Boolean = false
)

/**
 * ViewModel for the Settings screen.
 *
 * Observes all [AppPreferences] flows via [combine] so the UI always
 * reflects the persisted values. Validation is enforced before persisting.
 */
@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val appPreferences: AppPreferences
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        combine(
            appPreferences.serverUrl,
            appPreferences.darkMode,
            appPreferences.cacheSizeMb
        ) { url, dark, cache ->
            _uiState.update {
                // Do NOT reset isSaved here — the DataStore emits the new value
                // immediately after saveServerUrl() writes it, which would race and
                // clear the "Saved" confirmation before the UI renders it.
                // isSaved is only cleared when the user edits the input field.
                it.copy(
                    serverUrl = url,
                    serverUrlInput = url,
                    darkMode = dark,
                    cacheSizeMb = cache
                )
            }
        }.launchIn(viewModelScope)
    }

    /** Called when the user edits the server URL input field. */
    fun onServerUrlChange(url: String) {
        _uiState.update { it.copy(serverUrlInput = url, urlError = null, isSaved = false) }
    }

    /**
     * Validates and persists the current [SettingsUiState.serverUrlInput].
     * Sets [SettingsUiState.urlError] if the input is blank or not a valid HTTP/HTTPS URL.
     */
    fun saveServerUrl() {
        val url = _uiState.value.serverUrlInput.trim()
        when {
            url.isBlank() -> {
                _uiState.update { it.copy(urlError = "Server URL cannot be empty") }
                return
            }
            !url.startsWith("http://") && !url.startsWith("https://") -> {
                _uiState.update { it.copy(urlError = "URL must start with http:// or https://") }
                return
            }
        }
        viewModelScope.launch {
            appPreferences.setServerUrl(url)
            _uiState.update { it.copy(isSaved = true, urlError = null) }
        }
    }

    /** Toggles dark mode preference. */
    fun setDarkMode(enabled: Boolean) {
        viewModelScope.launch { appPreferences.setDarkMode(enabled) }
    }

    /** Resets all preferences to their defaults via [AppPreferences.reset]. */
    fun resetSettings() {
        viewModelScope.launch { appPreferences.reset() }
    }
}
