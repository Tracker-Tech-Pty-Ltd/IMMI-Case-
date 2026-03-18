package au.gov.immi.cases.feature.legislation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import au.gov.immi.cases.core.model.LegislationItem
import au.gov.immi.cases.navigation.LegislationDetail
import au.gov.immi.cases.ui.components.EmptyState
import au.gov.immi.cases.ui.components.ErrorState
import au.gov.immi.cases.ui.components.ImmiSearchBar
import au.gov.immi.cases.ui.components.LoadingState
import au.gov.immi.cases.ui.components.PageHeader

/**
 * Legislations list screen.
 *
 * Shows a search bar and a [LazyColumn] of [LegislationItem]s.
 * Tapping an item navigates to [LegislationDetailScreen].
 */
@Composable
fun LegislationsScreen(
    navController: NavController,
    viewModel: LegislationsViewModel = hiltViewModel()
) {
    val state by viewModel.listState.collectAsStateWithLifecycle()

    Column(modifier = Modifier.fillMaxSize()) {
        PageHeader(title = "Legislations", subtitle = "Australian Immigration Law")

        ImmiSearchBar(
            query = state.searchQuery,
            onQueryChange = { viewModel.search(it) },
            placeholder = "Search legislation...",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
        )

        when {
            state.isLoading -> LoadingState()
            state.error != null -> ErrorState(
                message = state.error!!,
                onRetry = { viewModel.loadLegislations() }
            )
            state.items.isEmpty() -> EmptyState(message = "No legislation found")
            else -> LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(state.items, key = { it.id }) { item ->
                    LegislationListCard(
                        item = item,
                        onClick = { navController.navigate(LegislationDetail(item.id)) }
                    )
                    HorizontalDivider()
                }
            }
        }
    }
}

@Composable
private fun LegislationListCard(item: LegislationItem, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(16.dp)
    ) {
        Text(
            text = item.title,
            style = MaterialTheme.typography.titleMedium
        )
        if (item.year > 0) {
            Text(
                text = item.year.toString(),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (item.description.isNotBlank()) {
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = item.description,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 2,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
