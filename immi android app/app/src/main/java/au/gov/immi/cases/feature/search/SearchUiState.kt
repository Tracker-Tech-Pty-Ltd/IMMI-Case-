package au.gov.immi.cases.feature.search

import au.gov.immi.cases.core.model.ImmigrationCase
import au.gov.immi.cases.data.local.entity.SavedSearchEntity

/** UI state for the global keyword search screen */
data class SearchUiState(
    val query: String = "",
    val results: List<ImmigrationCase> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    /** 區分「尚未搜尋」和「搜尋結果為空」*/
    val hasSearched: Boolean = false
)

/** UI state for the semantic vector search screen */
data class SemanticSearchUiState(
    val query: String = "",
    val results: List<ImmigrationCase> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    /** 區分「尚未搜尋」和「搜尋結果為空」*/
    val hasSearched: Boolean = false
)

/** UI state for the saved searches screen */
data class SavedSearchUiState(
    val savedSearches: List<SavedSearchEntity> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null
)
