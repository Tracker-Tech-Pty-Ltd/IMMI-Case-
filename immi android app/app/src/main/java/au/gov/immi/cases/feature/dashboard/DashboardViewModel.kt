package au.gov.immi.cases.feature.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.gov.immi.cases.core.model.DashboardStats
import au.gov.immi.cases.data.repository.AnalyticsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** UI state for the Dashboard screen. */
sealed interface DashboardUiState {
    data object Loading : DashboardUiState
    data class Success(val stats: DashboardStats) : DashboardUiState
    data class Error(val message: String) : DashboardUiState
}

/**
 * ViewModel for the Dashboard screen.
 *
 * Fetches aggregated statistics from [AnalyticsRepository.getStats] and
 * exposes them as a [DashboardUiState] state flow.
 */
@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val analyticsRepository: AnalyticsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow<DashboardUiState>(DashboardUiState.Loading)
    val uiState: StateFlow<DashboardUiState> = _uiState.asStateFlow()

    init {
        loadStats()
    }

    /** Trigger (or re-trigger) a stats fetch.  Resets to Loading first. */
    fun loadStats() {
        viewModelScope.launch {
            _uiState.value = DashboardUiState.Loading
            analyticsRepository.getStats().fold(
                onSuccess = { stats -> _uiState.value = DashboardUiState.Success(stats) },
                onFailure = { err -> _uiState.value = DashboardUiState.Error(err.message ?: "Unknown error") }
            )
        }
    }
}
