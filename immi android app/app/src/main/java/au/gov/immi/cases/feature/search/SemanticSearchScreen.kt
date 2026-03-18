package au.gov.immi.cases.feature.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
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
 * Semantic (vector) search screen.
 *
 * Uses natural-language queries mapped to pgvector embeddings on the server.
 * Search is triggered explicitly (no debounce) to avoid unnecessary embedding calls.
 */
@Composable
fun SemanticSearchScreen(
    navController: NavController,
    viewModel: SemanticSearchViewModel = hiltViewModel()
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
                placeholder = "Describe what you're looking for...",
                onSearch = { viewModel.semanticSearch() },
                modifier = Modifier.padding(bottom = 8.dp)
            )
        }

        when {
            uiState.isLoading -> item { LoadingState() }

            uiState.errorMessage != null -> item {
                ErrorState(
                    message = uiState.errorMessage!!,
                    onRetry = { viewModel.semanticSearch() }
                )
            }

            uiState.hasSearched && uiState.results.isEmpty() -> item {
                EmptyState(message = "No semantic matches found")
            }

            !uiState.hasSearched -> item {
                EmptyState(
                    message = "Use natural language to find cases",
                    icon = Icons.Default.AutoAwesome
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
