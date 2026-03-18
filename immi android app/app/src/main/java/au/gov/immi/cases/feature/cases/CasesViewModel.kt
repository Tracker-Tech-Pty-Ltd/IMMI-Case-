package au.gov.immi.cases.feature.cases

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.paging.PagingData
import androidx.paging.cachedIn
import au.gov.immi.cases.core.model.CasesFilter
import au.gov.immi.cases.core.model.ImmigrationCase
import au.gov.immi.cases.data.repository.CasesRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import javax.inject.Inject

/**
 * ViewModel for the Cases list screen.
 *
 * Filter state is held in a [MutableStateFlow]. When the filter changes,
 * [flatMapLatest] cancels the previous paging stream and starts a new one.
 * [cachedIn] survives configuration changes.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class CasesViewModel @Inject constructor(
    private val repository: CasesRepository
) : ViewModel() {

    private val _filter = MutableStateFlow(CasesFilter())

    /** Current filter — observe to react to filter changes in the UI */
    val filter: StateFlow<CasesFilter> = _filter.asStateFlow()

    /**
     * Paged cases stream.
     * Automatically restarts when [filter] changes via [flatMapLatest].
     * [cachedIn] keeps the loaded pages across recomposition.
     */
    val cases: Flow<PagingData<ImmigrationCase>> = _filter
        .flatMapLatest { repository.getCasesPager(it) }
        .cachedIn(viewModelScope)

    /** Replace the entire filter (immutable update) */
    fun updateFilter(newFilter: CasesFilter) {
        _filter.value = newFilter
    }

    /** Clear all filter constraints, returning to default empty filter */
    fun resetFilter() {
        _filter.value = CasesFilter()
    }

    /** Filter by court code, resetting page to 1 */
    fun filterByCourt(courtCode: String) {
        _filter.update { it.copy(court = courtCode, page = 1) }
    }

    /** Filter by decision year, resetting page to 1 */
    fun filterByYear(year: Int) {
        _filter.update { it.copy(year = year, page = 1) }
    }

    /** Filter by outcome string, resetting page to 1 */
    fun filterByOutcome(outcome: String) {
        _filter.update { it.copy(outcome = outcome, page = 1) }
    }

    /** Full-text search query, resetting page to 1 */
    fun setSearchQuery(query: String) {
        _filter.update { it.copy(search = query, page = 1) }
    }
}
