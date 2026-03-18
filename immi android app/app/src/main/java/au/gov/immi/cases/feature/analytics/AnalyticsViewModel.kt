package au.gov.immi.cases.feature.analytics

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.gov.immi.cases.core.model.AnalyticsFilter
import au.gov.immi.cases.core.model.ConceptEntry
import au.gov.immi.cases.core.model.JudgeEntry
import au.gov.immi.cases.core.model.NatureOutcomeEntry
import au.gov.immi.cases.core.model.OutcomeEntry
import au.gov.immi.cases.data.repository.AnalyticsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Aggregated UI state for the Analytics screen. */
data class AnalyticsUiState(
    val isLoading: Boolean = false,
    val outcomes: List<OutcomeEntry> = emptyList(),
    val judges: List<JudgeEntry> = emptyList(),
    val concepts: List<ConceptEntry> = emptyList(),
    val natureOutcome: List<NatureOutcomeEntry> = emptyList(),
    val filter: AnalyticsFilter = AnalyticsFilter(),
    val error: String? = null
)

/**
 * ViewModel for the Analytics screen.
 *
 * Loads all four analytics data sets in parallel, respecting the currently
 * active [AnalyticsFilter].  Callers use [applyFilter] / [clearFilter] to
 * request a new load with updated filter params.
 */
@HiltViewModel
class AnalyticsViewModel @Inject constructor(
    private val analyticsRepository: AnalyticsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AnalyticsUiState())
    val uiState: StateFlow<AnalyticsUiState> = _uiState.asStateFlow()

    init {
        loadAll()
    }

    /** Re-fetch all analytics data with the current filter. */
    fun loadAll() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val filter = _uiState.value.filter

            // Fire all four requests; each is a suspend call — sequential but
            // readable.  Parallel launch would complicate state handling here.
            val outcomesResult = analyticsRepository.getOutcomes(filter)
            val judgesResult = analyticsRepository.getJudges(filter)
            val conceptsResult = analyticsRepository.getLegalConcepts(filter)
            val natureResult = analyticsRepository.getNatureOutcome(filter)

            _uiState.update { state ->
                state.copy(
                    isLoading = false,
                    outcomes = outcomesResult.getOrElse { emptyList() },
                    judges = judgesResult.getOrElse { emptyList() },
                    concepts = conceptsResult.getOrElse { emptyList() },
                    natureOutcome = natureResult.getOrElse { emptyList() },
                    error = listOf(outcomesResult, judgesResult, conceptsResult, natureResult)
                        .firstNotNullOfOrNull { it.exceptionOrNull()?.message }
                )
            }
        }
    }

    /** Apply a new [AnalyticsFilter] and reload all data. */
    fun applyFilter(filter: AnalyticsFilter) {
        _uiState.update { it.copy(filter = filter) }
        loadAll()
    }

    /** Reset filter to defaults and reload. */
    fun clearFilter() {
        _uiState.update { it.copy(filter = AnalyticsFilter()) }
        loadAll()
    }
}
