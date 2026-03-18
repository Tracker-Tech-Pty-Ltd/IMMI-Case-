package au.gov.immi.cases.feature.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.gov.immi.cases.network.api.SearchApiService
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for semantic vector search.
 *
 * Unlike [SearchViewModel], semantic search does NOT debounce — it only runs when
 * the user explicitly triggers the search (button / IME action).
 * This avoids expensive embedding calls on every keystroke.
 */
@HiltViewModel
class SemanticSearchViewModel @Inject constructor(
    private val searchApi: SearchApiService
) : ViewModel() {

    private val _uiState = MutableStateFlow(SemanticSearchUiState())
    val uiState: StateFlow<SemanticSearchUiState> = _uiState.asStateFlow()

    fun updateQuery(query: String) {
        _uiState.update { it.copy(query = query) }
    }

    /** Explicit semantic search with optional result limit (default 20) */
    fun semanticSearch(limit: Int = 20) {
        val query = _uiState.value.query.trim()
        if (query.isBlank()) return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            runCatching {
                val response = searchApi.semanticSearch(query, limit)
                response.body()?.results ?: emptyList()
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

    fun clearResults() {
        _uiState.value = SemanticSearchUiState()
    }
}
