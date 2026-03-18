package au.gov.immi.cases.feature.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.gov.immi.cases.network.api.SearchApiService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the global keyword search screen.
 *
 * Debounce (300 ms) + distinctUntilChanged prevents a network request per
 * keystroke.  Only queries with 2+ characters trigger auto-search.
 * Explicit [search] call bypasses the length guard for immediate results.
 */
@OptIn(FlowPreview::class, ExperimentalCoroutinesApi::class)
@HiltViewModel
class SearchViewModel @Inject constructor(
    private val searchApi: SearchApiService
) : ViewModel() {

    private val _uiState = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = _uiState.asStateFlow()

    /** Internal query flow used to debounce auto-search */
    private val _queryFlow = MutableStateFlow("")

    init {
        viewModelScope.launch {
            _queryFlow
                .debounce(300L)
                .filter { it.length >= 2 }
                .distinctUntilChanged()
                .collectLatest { query ->
                    performSearch(query)
                }
        }
    }

    /** Called on every keystroke — updates state and feeds debounce pipeline */
    fun updateQuery(query: String) {
        _uiState.update { it.copy(query = query) }
        _queryFlow.value = query
        if (query.isBlank()) {
            // Clear results immediately when the user erases the query
            _uiState.update { it.copy(results = emptyList(), hasSearched = false, errorMessage = null) }
        }
    }

    /** Explicit search — called when user presses the Search key / button */
    fun search() {
        val query = _uiState.value.query
        if (query.isBlank()) return
        viewModelScope.launch { performSearch(query) }
    }

    /** Reset everything back to initial state */
    fun clearResults() {
        _uiState.value = SearchUiState()
        _queryFlow.value = ""
    }

    private suspend fun performSearch(query: String) {
        _uiState.update { it.copy(isLoading = true, errorMessage = null) }
        runCatching {
            val response = searchApi.search(query)
            response.body()?.cases ?: emptyList()
        }.fold(
            onSuccess = { results ->
                _uiState.update {
                    it.copy(results = results, isLoading = false, hasSearched = true)
                }
            },
            onFailure = { error ->
                _uiState.update {
                    it.copy(isLoading = false, errorMessage = error.message, hasSearched = true)
                }
            }
        )
    }
}
