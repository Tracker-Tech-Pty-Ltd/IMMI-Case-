package au.gov.immi.cases.feature.cases

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import au.gov.immi.cases.ui.theme.DesignTokens
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import androidx.paging.LoadState
import androidx.paging.compose.collectAsLazyPagingItems
import au.gov.immi.cases.navigation.CaseDetail
import au.gov.immi.cases.ui.components.EmptyState
import au.gov.immi.cases.ui.components.ErrorState
import au.gov.immi.cases.ui.components.ImmiFilterChip
import au.gov.immi.cases.ui.components.ImmiSearchBar
import au.gov.immi.cases.ui.components.LoadingState

/**
 * Cases list screen.
 * Renders a search bar, active filter chips, and a paged LazyColumn of [CaseCard]s.
 * All state mutation goes through [CasesViewModel] — this composable is stateless.
 */
@Composable
fun CasesScreen(
    navController: NavController,
    viewModel: CasesViewModel = hiltViewModel()
) {
    val cases = viewModel.cases.collectAsLazyPagingItems()
    val filter by viewModel.filter.collectAsStateWithLifecycle()

    Column {
        // ── Search bar ──────────────────────────────────────────────────────────
        ImmiSearchBar(
            query = filter.search ?: "",
            onQueryChange = { viewModel.setSearchQuery(it) },
            modifier = Modifier.padding(DesignTokens.Spacing.base)
        )

        // ── Active filter chips (only shown when at least one filter is set) ───
        if (filter.isFiltered()) {
            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm),
                contentPadding = PaddingValues(horizontal = DesignTokens.Spacing.base)
            ) {
                filter.court?.let { court ->
                    item {
                        ImmiFilterChip(
                            label = "Court: $court",
                            selected = true,
                            onToggle = { viewModel.filterByCourt("") }
                        )
                    }
                }
                filter.outcome?.let { outcome ->
                    item {
                        ImmiFilterChip(
                            label = outcome,
                            selected = true,
                            onToggle = { viewModel.filterByOutcome("") }
                        )
                    }
                }
                filter.year?.let { year ->
                    item {
                        ImmiFilterChip(
                            label = "$year",
                            selected = true,
                            onToggle = { viewModel.filterByYear(0) }
                        )
                    }
                }
            }
            Spacer(Modifier.height(DesignTokens.Spacing.sm))
        }

        // ── Cases list ─────────────────────────────────────────────────────────
        when {
            cases.loadState.refresh is LoadState.Loading -> {
                LoadingState()
            }

            cases.loadState.refresh is LoadState.Error -> {
                val error = cases.loadState.refresh as LoadState.Error
                ErrorState(
                    message = error.error.message ?: "Unknown error",
                    onRetry = { cases.retry() }
                )
            }

            cases.itemCount == 0 && cases.loadState.refresh is LoadState.NotLoading -> {
                EmptyState(
                    message = "No cases found",
                    actionLabel = if (filter.isFiltered()) "Clear filters" else null,
                    onAction = if (filter.isFiltered()) ({ viewModel.resetFilter() }) else null
                )
            }

            else -> {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm),
                    contentPadding = PaddingValues(DesignTokens.Spacing.base)
                ) {
                    items(
                        count = cases.itemCount,
                        key = { index -> cases[index]?.caseId ?: index }
                    ) { index ->
                        cases[index]?.let { case ->
                            CaseCard(
                                case = case,
                                onClick = {
                                    navController.navigate(CaseDetail(caseId = case.caseId))
                                }
                            )
                        }
                    }

                    // Append loading indicator at the bottom of the list
                    if (cases.loadState.append is LoadState.Loading) {
                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(DesignTokens.Spacing.base),
                                contentAlignment = Alignment.Center
                            ) {
                                CircularProgressIndicator()
                            }
                        }
                    }
                }
            }
        }
    }
}
