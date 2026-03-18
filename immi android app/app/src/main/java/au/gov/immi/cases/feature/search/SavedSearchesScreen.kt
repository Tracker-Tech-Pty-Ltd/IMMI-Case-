package au.gov.immi.cases.feature.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmarks
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import au.gov.immi.cases.data.local.entity.SavedSearchEntity
import au.gov.immi.cases.ui.components.ConfirmDialog
import au.gov.immi.cases.ui.components.EmptyState

/**
 * Saved searches screen.
 *
 * Shows a reactive list of [SavedSearchEntity] items from Room.
 * Each row has a delete button that triggers a confirmation dialog.
 */
@Composable
fun SavedSearchesScreen(
    navController: NavController,
    viewModel: SavedSearchViewModel = hiltViewModel()
) {
    val searches by viewModel.savedSearches.collectAsStateWithLifecycle()
    var showDeleteDialog by remember { mutableStateOf<SavedSearchEntity?>(null) }

    if (searches.isEmpty()) {
        EmptyState(
            message = "No saved searches yet",
            icon = Icons.Default.Bookmarks
        )
    } else {
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(searches, key = { it.id }) { search ->
                SavedSearchRow(
                    search = search,
                    onDelete = { showDeleteDialog = search }
                )
            }
        }
    }

    showDeleteDialog?.let { search ->
        ConfirmDialog(
            title = "Delete Search",
            message = "Delete \"${search.name}\"?",
            confirmLabel = "Delete",
            onConfirm = {
                viewModel.deleteSearch(search)
                showDeleteDialog = null
            },
            onDismiss = { showDeleteDialog = null },
            isDestructive = true
        )
    }
}

@Composable
private fun SavedSearchRow(
    search: SavedSearchEntity,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .padding(12.dp)
                .fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = search.name,
                    style = MaterialTheme.typography.titleSmall
                )
                if (search.resultCount > 0) {
                    Text(
                        text = "${search.resultCount} results",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            IconButton(onClick = onDelete) {
                Icon(
                    imageVector = Icons.Default.Delete,
                    contentDescription = "Delete saved search"
                )
            }
        }
    }
}
