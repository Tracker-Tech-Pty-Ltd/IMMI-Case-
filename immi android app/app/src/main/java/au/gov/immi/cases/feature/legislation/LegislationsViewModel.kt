package au.gov.immi.cases.feature.legislation

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.gov.immi.cases.core.model.LegislationItem
import au.gov.immi.cases.data.repository.LegislationsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LegislationsUiState(
    val isLoading: Boolean = false,
    val items: List<LegislationItem> = emptyList(),
    val searchQuery: String = "",
    val error: String? = null
)

data class LegislationDetailUiState(
    val isLoading: Boolean = false,
    val item: LegislationItem? = null,
    val error: String? = null
)

/**
 * ViewModel for the Legislations list screen.
 *
 * Loads all legislations on init; delegates to [search] for query-based filtering.
 * Empty query reverts to the full unfiltered list.
 */
@HiltViewModel
class LegislationsViewModel @Inject constructor(
    private val repository: LegislationsRepository
) : ViewModel() {

    private val _listState = MutableStateFlow(LegislationsUiState(isLoading = true))
    val listState: StateFlow<LegislationsUiState> = _listState.asStateFlow()

    init {
        loadLegislations()
    }

    fun loadLegislations(query: String? = null) {
        viewModelScope.launch {
            _listState.update { it.copy(isLoading = true, error = null, searchQuery = query ?: "") }
            repository.getLegislations(query).fold(
                onSuccess = { items ->
                    _listState.update { it.copy(isLoading = false, items = items) }
                },
                onFailure = { e ->
                    _listState.update { it.copy(isLoading = false, error = e.message) }
                }
            )
        }
    }

    /**
     * Trigger a search.
     * - Empty/blank query → reload full list via [loadLegislations].
     * - Non-empty query → call [LegislationsRepository.searchLegislations].
     */
    fun search(query: String) {
        if (query.isBlank()) {
            loadLegislations(null)
        } else {
            viewModelScope.launch {
                _listState.update { it.copy(isLoading = true, error = null, searchQuery = query) }
                repository.searchLegislations(query).fold(
                    onSuccess = { items ->
                        _listState.update { it.copy(isLoading = false, items = items) }
                    },
                    onFailure = { e ->
                        _listState.update { it.copy(isLoading = false, error = e.message) }
                    }
                )
            }
        }
    }
}

/**
 * ViewModel for the Legislation detail screen.
 *
 * [legislationId] is injected from [SavedStateHandle] by Navigation 2.8 type-safe routes.
 */
@HiltViewModel
class LegislationDetailViewModel @Inject constructor(
    private val repository: LegislationsRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val legislationId: String = savedStateHandle["legislationId"] ?: ""

    private val _detailState = MutableStateFlow(LegislationDetailUiState(isLoading = true))
    val detailState: StateFlow<LegislationDetailUiState> = _detailState.asStateFlow()

    init {
        if (legislationId.isNotBlank()) loadDetail(legislationId)
    }

    fun loadDetail(id: String = legislationId) {
        viewModelScope.launch {
            _detailState.update { it.copy(isLoading = true, error = null) }
            repository.getLegislation(id).fold(
                onSuccess = { item ->
                    _detailState.update { it.copy(isLoading = false, item = item) }
                },
                onFailure = { e ->
                    _detailState.update { it.copy(isLoading = false, error = e.message) }
                }
            )
        }
    }
}
