package au.gov.immi.cases.feature.cases

import au.gov.immi.cases.core.model.CasesFilter
import au.gov.immi.cases.core.model.ImmigrationCase

/**
 * Immutable UI state for the Cases list screen.
 * Use [copy] to produce updated instances — never mutate.
 */
data class CasesUiState(
    val filter: CasesFilter = CasesFilter(),
    val selectedCaseId: String? = null,
    val isLoading: Boolean = false,
    val errorMessage: String? = null
)

/**
 * Immutable UI state for the Case Detail screen.
 */
data class CaseDetailUiState(
    val case: ImmigrationCase? = null,
    val similarCases: List<ImmigrationCase> = emptyList(),
    val isLoading: Boolean = true,
    val errorMessage: String? = null
)

/**
 * Immutable UI state for the Case Edit / Add screen.
 */
data class CaseEditUiState(
    val case: ImmigrationCase? = null,
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val saveSuccess: Boolean = false,
    val errorMessage: String? = null
)
