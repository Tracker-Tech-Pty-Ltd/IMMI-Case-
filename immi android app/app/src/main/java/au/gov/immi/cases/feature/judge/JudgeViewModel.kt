package au.gov.immi.cases.feature.judge

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.gov.immi.cases.core.model.AnalyticsFilter
import au.gov.immi.cases.core.model.JudgeEntry
import au.gov.immi.cases.data.repository.AnalyticsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

// ─── UI State types ──────────────────────────────────────────────────────────

data class JudgeLeaderboardUiState(
    val isLoading: Boolean = false,
    val entries: List<JudgeEntry> = emptyList(),
    val error: String? = null
)

data class JudgeProfileUiState(
    val isLoading: Boolean = false,
    val judgeName: String = "",
    val data: Map<String, Any> = emptyMap(),
    val error: String? = null
)

data class JudgeCompareUiState(
    val isLoading: Boolean = false,
    val data: Map<String, Any> = emptyMap(),
    val error: String? = null
)

/**
 * ViewModel shared by JudgeProfilesScreen, JudgeDetailScreen and
 * JudgeCompareScreen.
 *
 * [SavedStateHandle] supplies the `judgeName` argument injected by the
 * type-safe Navigation 2.8 route [JudgeDetail].
 */
@HiltViewModel
class JudgeViewModel @Inject constructor(
    private val analyticsRepository: AnalyticsRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    /** Judge name resolved from navigation back-stack (may be blank for list screens). */
    private val judgeName: String = savedStateHandle["judgeName"] ?: ""

    private val _leaderboard = MutableStateFlow(JudgeLeaderboardUiState())
    val leaderboard: StateFlow<JudgeLeaderboardUiState> = _leaderboard.asStateFlow()

    private val _profile = MutableStateFlow(JudgeProfileUiState(judgeName = judgeName))
    val profile: StateFlow<JudgeProfileUiState> = _profile.asStateFlow()

    private val _compare = MutableStateFlow(JudgeCompareUiState())
    val compare: StateFlow<JudgeCompareUiState> = _compare.asStateFlow()

    // ─── Leaderboard ─────────────────────────────────────────────────────────

    /** Load the judge leaderboard (top judges by case volume). */
    fun loadLeaderboard(filter: AnalyticsFilter = AnalyticsFilter()) {
        viewModelScope.launch {
            _leaderboard.update { it.copy(isLoading = true, error = null) }
            analyticsRepository.getJudgeLeaderboard(filter).fold(
                onSuccess = { entries ->
                    _leaderboard.update { it.copy(isLoading = false, entries = entries) }
                },
                onFailure = { err ->
                    _leaderboard.update { it.copy(isLoading = false, error = err.message) }
                }
            )
        }
    }

    // ─── Profile ─────────────────────────────────────────────────────────────

    /**
     * Load the profile for [name].  Defaults to the name resolved from
     * [SavedStateHandle] (i.e. the route argument).
     */
    fun loadProfile(name: String = judgeName) {
        if (name.isBlank()) {
            _profile.update { it.copy(isLoading = false, error = "Judge name required") }
            return
        }
        viewModelScope.launch {
            _profile.update { it.copy(isLoading = true, error = null, judgeName = name) }
            analyticsRepository.getJudgeProfile(name).fold(
                onSuccess = { data ->
                    _profile.update { it.copy(isLoading = false, data = data) }
                },
                onFailure = { err ->
                    _profile.update { it.copy(isLoading = false, error = err.message) }
                }
            )
        }
    }

    // ─── Compare ─────────────────────────────────────────────────────────────

    /** Compare the given judges.  [names] must contain at least two entries. */
    fun compareJudges(names: List<String>) {
        viewModelScope.launch {
            _compare.update { it.copy(isLoading = true, error = null) }
            analyticsRepository.compareJudges(names).fold(
                onSuccess = { data ->
                    _compare.update { it.copy(isLoading = false, data = data) }
                },
                onFailure = { err ->
                    _compare.update { it.copy(isLoading = false, error = err.message) }
                }
            )
        }
    }
}
