package au.gov.immi.cases.feature.analytics

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavController
import au.gov.immi.cases.core.model.AnalyticsFilter
import au.gov.immi.cases.core.model.JudgeEntry
import au.gov.immi.cases.core.model.OutcomeEntry
import au.gov.immi.cases.ui.components.ErrorState
import au.gov.immi.cases.ui.components.LoadingState
import au.gov.immi.cases.ui.components.PageHeader
import com.patrykandpatrick.vico.compose.cartesian.CartesianChartHost
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberBottom
import com.patrykandpatrick.vico.compose.cartesian.axis.rememberStart
import com.patrykandpatrick.vico.compose.cartesian.layer.rememberColumnCartesianLayer
import com.patrykandpatrick.vico.compose.cartesian.rememberCartesianChart
import androidx.compose.ui.graphics.toArgb
import com.patrykandpatrick.vico.compose.common.component.rememberLineComponent
import com.patrykandpatrick.vico.core.cartesian.axis.HorizontalAxis
import com.patrykandpatrick.vico.core.cartesian.axis.VerticalAxis
import com.patrykandpatrick.vico.core.cartesian.data.CartesianChartModelProducer
import com.patrykandpatrick.vico.core.cartesian.data.columnSeries
import com.patrykandpatrick.vico.core.cartesian.layer.ColumnCartesianLayer
import com.patrykandpatrick.vico.core.common.Fill

/**
 * Analytics screen — filter bar + outcomes chart + judges chart.
 *
 * The screen is backed by [AnalyticsViewModel] and renders four data sets:
 * outcomes, judges (top 10), legal concepts, nature-outcome matrix.
 * Only the first two are charted; others are available via ViewModel for
 * future expansion.
 */
@Composable
fun AnalyticsScreen(
    navController: NavController,
    viewModel: AnalyticsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            PageHeader(title = "Analytics")
        }

        // ── Filter bar ────────────────────────────────────────────────────
        item {
            AnalyticsFilterBar(
                filter = uiState.filter,
                onFilterChanged = { viewModel.applyFilter(it) },
                onClearFilter = { viewModel.clearFilter() }
            )
        }

        // ── Outcomes chart ────────────────────────────────────────────────
        item {
            AnalyticsSection(title = "Outcomes by Type") {
                when {
                    uiState.isLoading -> LoadingState(
                        modifier = Modifier.height(200.dp)
                    )
                    uiState.error != null && uiState.outcomes.isEmpty() -> ErrorState(
                        message = uiState.error!!,
                        onRetry = { viewModel.loadAll() },
                        modifier = Modifier.height(200.dp)
                    )
                    uiState.outcomes.isEmpty() -> Text(
                        text = "No outcome data available",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp)
                    )
                    else -> OutcomesBarChart(
                        entries = uiState.outcomes,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(220.dp)
                    )
                }
            }
        }

        // ── Judges chart (top 10) ─────────────────────────────────────────
        item {
            AnalyticsSection(title = "Top Judges by Case Volume") {
                when {
                    uiState.isLoading -> LoadingState(
                        modifier = Modifier.height(200.dp)
                    )
                    uiState.judges.isEmpty() -> Text(
                        text = "No judge data available",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp)
                    )
                    else -> JudgesBarChart(
                        entries = uiState.judges.take(10),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(220.dp)
                    )
                }
            }
        }
    }
}

// ─── Filter Bar ──────────────────────────────────────────────────────────────

@Composable
private fun AnalyticsFilterBar(
    filter: AnalyticsFilter,
    onFilterChanged: (AnalyticsFilter) -> Unit,
    onClearFilter: () -> Unit,
    modifier: Modifier = Modifier
) {
    var courtText by remember(filter.court) { mutableStateOf(filter.court ?: "") }
    var yearFromText by remember(filter.yearFrom) { mutableStateOf(filter.yearFrom?.toString() ?: "") }
    var yearToText by remember(filter.yearTo) { mutableStateOf(filter.yearTo?.toString() ?: "") }

    Card(modifier = modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.FilterList, contentDescription = null)
                    Text("Filters", style = MaterialTheme.typography.titleSmall)
                }
                if (filter.isFiltered()) {
                    IconButton(onClick = onClearFilter) {
                        Icon(Icons.Default.Close, contentDescription = "Clear filters")
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = courtText,
                    onValueChange = {
                        courtText = it
                        onFilterChanged(
                            filter.copy(court = it.takeIf { c -> c.isNotBlank() })
                        )
                    },
                    label = { Text("Court") },
                    singleLine = true,
                    modifier = Modifier.weight(1f)
                )
                OutlinedTextField(
                    value = yearFromText,
                    onValueChange = {
                        yearFromText = it
                        onFilterChanged(
                            filter.copy(yearFrom = it.toIntOrNull())
                        )
                    },
                    label = { Text("From") },
                    singleLine = true,
                    modifier = Modifier.weight(0.5f)
                )
                OutlinedTextField(
                    value = yearToText,
                    onValueChange = {
                        yearToText = it
                        onFilterChanged(
                            filter.copy(yearTo = it.toIntOrNull())
                        )
                    },
                    label = { Text("To") },
                    singleLine = true,
                    modifier = Modifier.weight(0.5f)
                )
            }
        }
    }
}

// ─── Section Wrapper ─────────────────────────────────────────────────────────

@Composable
private fun AnalyticsSection(
    title: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit
) {
    Card(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(bottom = 12.dp)
            )
            content()
        }
    }
}

// ─── Outcomes Chart ───────────────────────────────────────────────────────────

@Composable
private fun OutcomesBarChart(
    entries: List<OutcomeEntry>,
    modifier: Modifier = Modifier
) {
    val modelProducer = remember { CartesianChartModelProducer() }

    LaunchedEffect(entries) {
        if (entries.isNotEmpty()) {
            modelProducer.runTransaction {
                columnSeries { series(entries.map { it.count.toFloat() }) }
            }
        }
    }

    CartesianChartHost(
        chart = rememberCartesianChart(
            rememberColumnCartesianLayer(
                ColumnCartesianLayer.ColumnProvider.series(
                    rememberLineComponent(
                        fill = Fill(MaterialTheme.colorScheme.primary.toArgb()),
                        thickness = 16.dp
                    )
                )
            ),
            startAxis = VerticalAxis.rememberStart(),
            bottomAxis = HorizontalAxis.rememberBottom(
                valueFormatter = { _, x, _ ->
                    entries.getOrNull(x.toInt())?.label ?: x.toString()
                }
            )
        ),
        modelProducer = modelProducer,
        modifier = modifier
    )
}

// ─── Judges Chart ─────────────────────────────────────────────────────────────

@Composable
private fun JudgesBarChart(
    entries: List<JudgeEntry>,
    modifier: Modifier = Modifier
) {
    val modelProducer = remember { CartesianChartModelProducer() }

    LaunchedEffect(entries) {
        if (entries.isNotEmpty()) {
            modelProducer.runTransaction {
                columnSeries { series(entries.map { it.totalCases.toFloat() }) }
            }
        }
    }

    CartesianChartHost(
        chart = rememberCartesianChart(
            rememberColumnCartesianLayer(
                ColumnCartesianLayer.ColumnProvider.series(
                    rememberLineComponent(
                        fill = Fill(MaterialTheme.colorScheme.secondary.toArgb()),
                        thickness = 16.dp
                    )
                )
            ),
            startAxis = VerticalAxis.rememberStart(),
            bottomAxis = HorizontalAxis.rememberBottom(
                valueFormatter = { _, x, _ ->
                    entries.getOrNull(x.toInt())?.name?.substringBefore(" ") ?: x.toString()
                }
            )
        ),
        modelProducer = modelProducer,
        modifier = modifier
    )
}
