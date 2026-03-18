package au.gov.immi.cases.feature.cases

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import au.gov.immi.cases.ui.theme.DesignTokens
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import au.gov.immi.cases.core.model.ImmigrationCase
import au.gov.immi.cases.navigation.CaseDetail
import au.gov.immi.cases.ui.components.CourtBadge
import au.gov.immi.cases.ui.components.ErrorState
import au.gov.immi.cases.ui.components.LoadingState
import au.gov.immi.cases.ui.components.NatureBadge
import au.gov.immi.cases.ui.components.OutcomeBadge

/**
 * Case Detail screen.
 * Displays case header, metadata card, and optional similar cases section.
 * The [CaseDetailViewModel] handles data loading; the caseId is resolved via
 * SavedStateHandle from the Navigation 2.8 type-safe route.
 */
@Composable
fun CaseDetailScreen(
    navController: NavController,
    viewModel: CaseDetailViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    when {
        uiState.isLoading -> LoadingState()

        uiState.errorMessage != null -> ErrorState(
            message = uiState.errorMessage!!,
            onRetry = { viewModel.loadCase() }
        )

        uiState.case != null -> {
            val case = uiState.case!!
            LazyColumn(
                contentPadding = PaddingValues(DesignTokens.Spacing.base),
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md)
            ) {
                // ── Header ────────────────────────────────────────────────────
                item {
                    Text(
                        text = case.displayTitle(),
                        style = MaterialTheme.typography.headlineSmall
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm)) {
                        if (case.courtCode.isNotBlank()) CourtBadge(case.courtCode)
                        if (case.outcome.isNotBlank()) OutcomeBadge(case.outcome)
                        if (case.caseNature.isNotBlank()) NatureBadge(case.caseNature)
                    }
                }

                // ── Metadata card ─────────────────────────────────────────────
                item {
                    CaseMetadataSection(case = case)
                }

                // ── Similar cases (only shown when available) ─────────────────
                if (uiState.similarCases.isNotEmpty()) {
                    item {
                        Text(
                            text = "Similar Cases",
                            style = MaterialTheme.typography.titleMedium
                        )
                    }
                    items(
                        items = uiState.similarCases,
                        key = { it.caseId }
                    ) { similar ->
                        CaseCard(
                            case = similar,
                            onClick = {
                                navController.navigate(CaseDetail(caseId = similar.caseId))
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CaseMetadataSection(case: ImmigrationCase) {
    Card {
        Column(
            modifier = Modifier.padding(DesignTokens.Spacing.md),
            verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm)
        ) {
            if (case.citation.isNotBlank()) MetadataRow("Citation", case.citation)
            if (case.date.isNotBlank()) MetadataRow("Date", case.date)
            if (case.judges.isNotBlank()) MetadataRow("Judges", case.judges)
            if (case.visaType.isNotBlank()) MetadataRow("Visa Type", case.visaType)
        }
    }
}

@Composable
private fun MetadataRow(label: String, value: String) {
    Row {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.width(100.dp)
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium
        )
    }
}
