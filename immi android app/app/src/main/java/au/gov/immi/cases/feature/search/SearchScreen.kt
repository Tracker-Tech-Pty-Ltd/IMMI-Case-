package au.gov.immi.cases.feature.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import au.gov.immi.cases.feature.cases.CaseCard
import au.gov.immi.cases.navigation.CaseDetail
import au.gov.immi.cases.ui.components.EmptyState
import au.gov.immi.cases.ui.components.ErrorState
import au.gov.immi.cases.ui.components.ImmiSearchBar
import au.gov.immi.cases.ui.components.LoadingState

/**
 * Global keyword search screen.
 *
 * Shows an [ImmiSearchBar] at the top.  Results appear below as [CaseCard] items.
 * Empty / loading / error states are shown in place of the list.
 */
@Composable
fun SearchScreen(
    navController: NavController,
    viewModel: SearchViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item {
            ImmiSearchBar(
                query = uiState.query,
                onQueryChange = { viewModel.updateQuery(it) },
                onSearch = { viewModel.search() },
                modifier = Modifier.padding(bottom = 8.dp)
            )
        }

        when {
            uiState.isLoading -> item { LoadingState() }

            uiState.errorMessage != null -> item {
                ErrorState(
                    message = uiState.errorMessage!!,
                    onRetry = { viewModel.search() }
                )
            }

            uiState.hasSearched && uiState.results.isEmpty() -> item {
                EmptyState(message = "No results for \"${uiState.query}\"")
            }

            !uiState.hasSearched -> item {
                EmptyState(
                    message = "Enter a search term",
                    icon = Icons.Default.Search
                )
            }

            else -> items(uiState.results, key = { it.caseId }) { case ->
                CaseCard(
                    case = case,
                    onClick = { navController.navigate(CaseDetail(caseId = case.caseId)) }
                )
            }
        }
    }
}
