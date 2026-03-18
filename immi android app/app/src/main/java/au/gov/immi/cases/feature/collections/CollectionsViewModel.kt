package au.gov.immi.cases.feature.collections

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import au.gov.immi.cases.data.local.dao.CollectionDao
import au.gov.immi.cases.data.local.entity.CollectionCaseEntity
import au.gov.immi.cases.data.local.entity.CollectionEntity
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class CollectionDetailUiState(
    val collection: CollectionEntity? = null,
    val caseIds: List<String> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

/**
 * ViewModel for the Collections list screen.
 *
 * Exposes [collections] as a [StateFlow] backed by the Room [CollectionDao] Flow.
 * Create / delete operations run in [viewModelScope] and invalidate the Room stream
 * automatically (Room notifies all observers on any write).
 */
@HiltViewModel
class CollectionsViewModel @Inject constructor(
    private val collectionDao: CollectionDao
) : ViewModel() {

    val collections: StateFlow<List<CollectionEntity>> = collectionDao.getAllCollections()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _createError = MutableStateFlow<String?>(null)
    val createError: StateFlow<String?> = _createError.asStateFlow()

    /**
     * Creates a new collection. Validates [name] is not blank before inserting.
     */
    fun createCollection(
        name: String,
        description: String = "",
        color: String = "#3b82f6"
    ) {
        if (name.isBlank()) {
            _createError.update { "Collection name cannot be empty" }
            return
        }
        viewModelScope.launch {
            val now = System.currentTimeMillis()
            val entity = CollectionEntity(
                name = name,
                description = description,
                color = color,
                createdAt = now,
                updatedAt = now
            )
            collectionDao.insertCollection(entity)
            _createError.update { null }
        }
    }

    fun deleteCollection(collection: CollectionEntity) {
        viewModelScope.launch { collectionDao.deleteCollection(collection) }
    }
}

/**
 * ViewModel for the CollectionDetail screen.
 *
 * [collectionId] is populated from [SavedStateHandle] via Navigation 2.8 type-safe routes.
 */
@HiltViewModel
class CollectionDetailViewModel @Inject constructor(
    private val collectionDao: CollectionDao,
    savedStateHandle: SavedStateHandle
) : ViewModel() {

    private val collectionId: Long = savedStateHandle["collectionId"] ?: 0L

    private val _uiState = MutableStateFlow(CollectionDetailUiState(isLoading = true))
    val uiState: StateFlow<CollectionDetailUiState> = _uiState.asStateFlow()

    val caseIds: StateFlow<List<String>> = collectionDao.getCaseIdsInCollection(collectionId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    init {
        viewModelScope.launch {
            val collection = collectionDao.getCollectionById(collectionId)
            _uiState.update {
                it.copy(
                    isLoading = false,
                    collection = collection,
                    error = if (collection == null) "Collection not found" else null
                )
            }
        }
    }

    fun removeCaseFromCollection(caseId: String) {
        viewModelScope.launch {
            collectionDao.removeCaseFromCollection(collectionId, caseId)
        }
    }

    fun addCaseToCollection(caseId: String) {
        viewModelScope.launch {
            collectionDao.addCaseToCollection(
                CollectionCaseEntity(
                    collectionId = collectionId,
                    caseId = caseId,
                    addedAt = System.currentTimeMillis()
                )
            )
        }
    }
}
