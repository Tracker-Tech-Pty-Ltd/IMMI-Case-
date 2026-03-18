package au.gov.immi.cases.feature.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.gov.immi.cases.data.local.dao.SavedSearchDao
import au.gov.immi.cases.data.local.entity.SavedSearchEntity
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * ViewModel for saved searches.
 *
 * [savedSearches] is a reactive [StateFlow] backed directly by Room's
 * [SavedSearchDao.getAllSavedSearches] Flow — no polling required.
 */
@HiltViewModel
class SavedSearchViewModel @Inject constructor(
    private val savedSearchDao: SavedSearchDao
) : ViewModel() {

    /** Live list of saved searches ordered by creation time (newest first) */
    val savedSearches: StateFlow<List<SavedSearchEntity>> = savedSearchDao
        .getAllSavedSearches()
        .stateIn(
            scope = viewModelScope,
            started = SharingStarted.WhileSubscribed(5_000),
            initialValue = emptyList()
        )

    /** Persist a new saved search to Room */
    fun saveSearch(name: String, query: String, resultCount: Int = 0) {
        viewModelScope.launch {
            val entity = SavedSearchEntity(
                name = name,
                query = query,
                resultCount = resultCount
            )
            savedSearchDao.insertSavedSearch(entity)
        }
    }

    /** Delete a saved search from Room */
    fun deleteSearch(search: SavedSearchEntity) {
        viewModelScope.launch {
            savedSearchDao.deleteSavedSearch(search)
        }
    }
}
