package au.gov.immi.cases.feature.cases

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.gov.immi.cases.core.model.ImmigrationCase
import au.gov.immi.cases.data.repository.CasesRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for the Case Edit screen.
 *
 * Reads [caseId] from [SavedStateHandle] (injected automatically by Navigation 2.8
 * type-safe routes). All field mutations are applied via [updateField] which returns
 * a new [ImmigrationCase] copy — never mutates in place.
 */
@HiltViewModel
class CaseEditViewModel @Inject constructor(
    private val repository: CasesRepository,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val caseId: String = checkNotNull(savedStateHandle["caseId"])

    private val _uiState = MutableStateFlow(CaseEditUiState())
    val uiState: StateFlow<CaseEditUiState> = _uiState.asStateFlow()

    init {
        loadCase()
    }

    private fun loadCase() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            repository.getCaseById(caseId).fold(
                onSuccess = { case ->
                    _uiState.update { it.copy(case = case, isLoading = false) }
                },
                onFailure = { error ->
                    _uiState.update { it.copy(isLoading = false, errorMessage = error.message) }
                }
            )
        }
    }

    /**
     * Apply an immutable field update to the current case.
     * [updater] must return a new [ImmigrationCase] copy — never the same instance.
     */
    fun updateField(updater: (ImmigrationCase) -> ImmigrationCase) {
        _uiState.update { state ->
            state.copy(case = state.case?.let { updater(it) })
        }
    }

    /** Persist the current edited case to the repository. */
    fun saveCase() {
        val case = _uiState.value.case ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isSaving = true, errorMessage = null) }
            repository.updateCase(caseId, case).fold(
                onSuccess = {
                    _uiState.update { it.copy(isSaving = false, saveSuccess = true) }
                },
                onFailure = { error ->
                    _uiState.update { it.copy(isSaving = false, errorMessage = error.message) }
                }
            )
        }
    }
}
