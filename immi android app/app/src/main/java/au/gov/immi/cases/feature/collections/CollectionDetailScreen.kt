package au.gov.immi.cases.feature.collections

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import au.gov.immi.cases.navigation.CaseDetail
import au.gov.immi.cases.ui.components.EmptyState
import au.gov.immi.cases.ui.components.ErrorState
import au.gov.immi.cases.ui.components.LoadingState

/**
 * Collection detail screen.
 *
 * Shows the collection's name, description, and a list of [caseIds].
 * Tapping a case ID navigates to [CaseDetailScreen].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionDetailScreen(
    navController: NavController,
    collectionId: Long,
    viewModel: CollectionDetailViewModel = hiltViewModel()
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val caseIds by viewModel.caseIds.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = state.collection?.name ?: "Collection",
                        maxLines = 1
                    )
                },
                navigationIcon = {
                    IconButton(onClick = { navController.navigateUp() }) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                }
            )
        }
    ) { paddingValues ->
        when {
            state.isLoading -> LoadingState(modifier = Modifier.padding(paddingValues))
            state.error != null -> ErrorState(
                message = state.error!!,
                onRetry = {},
                modifier = Modifier.padding(paddingValues)
            )
            else -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
            ) {
                // Header info
                state.collection?.let { collection ->
                    if (collection.description.isNotBlank()) {
                        Text(
                            text = collection.description,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                        )
                    }
                    Text(
                        text = "${caseIds.size} case(s)",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                    )
                    HorizontalDivider()
                }

                if (caseIds.isEmpty()) {
                    EmptyState(message = "No cases in this collection yet.")
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        items(caseIds, key = { it }) { caseId ->
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        navController.navigate(CaseDetail(caseId))
                                    }
                                    .padding(16.dp)
                            ) {
                                Text(
                                    text = caseId,
                                    style = MaterialTheme.typography.bodyMedium
                                )
                            }
                            HorizontalDivider()
                        }
                    }
                }
            }
        }
    }
}
