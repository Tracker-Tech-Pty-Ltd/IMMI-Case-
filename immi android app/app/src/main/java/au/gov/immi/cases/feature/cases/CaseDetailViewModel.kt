package au.gov.immi.cases.feature.cases

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.gov.immi.cases.data.repository.CasesRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the Case Detail screen.
 *
 * Reads [caseId] from [SavedStateHandle] (injected automatically by Navigation 2.8
 * type-safe routes). Loads the main case and similar cases in parallel after success.
 * Similar cases failure is silent — it should not block the main detail view.
 */
@HiltViewModel
class CaseDetailViewModel @Inject constructor(
    private val repository: CasesRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val caseId: String = checkNotNull(savedStateHandle["caseId"])

    private val _uiState = MutableStateFlow(CaseDetailUiState())
    val uiState: StateFlow<CaseDetailUiState> = _uiState.asStateFlow()

    init {
        loadCase()
    }

    /** Load (or reload) the case by ID. Clears any previous error before retrying. */
    fun loadCase() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }

            repository.getCaseById(caseId).fold(
                onSuccess = { case ->
                    _uiState.update { it.copy(case = case, isLoading = false) }
                    loadSimilarCases()
                },
                onFailure = { error ->
                    _uiState.update { it.copy(isLoading = false, errorMessage = error.message) }
                }
            )
        }
    }

    /** Load similar cases silently — failure does not propagate to the UI error state. */
    private fun loadSimilarCases() {
        viewModelScope.launch {
            repository.getSimilarCases(caseId).fold(
                onSuccess = { similar ->
                    _uiState.update { it.copy(similarCases = similar) }
                },
                onFailure = { /* silent fail — similar cases are supplementary */ }
            )
        }
    }
}
