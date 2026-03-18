package au.gov.immi.cases.feature.dashboard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Gavel
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import au.gov.immi.cases.ui.theme.DesignTokens
import androidx.navigation.NavController
import au.gov.immi.cases.core.model.DashboardStats
import au.gov.immi.cases.ui.components.ErrorState
import au.gov.immi.cases.ui.components.LoadingState
import au.gov.immi.cases.ui.components.PageHeader
import au.gov.immi.cases.ui.components.StatCard
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
import java.text.NumberFormat
import java.util.Locale

/**
 * Dashboard screen — top-level entry point showing aggregated statistics.
 *
 * Layout:
 *  • [PageHeader] title
 *  • 2-column StatCard grid (total cases, success rate, courts count, recent)
 *  • Horizontal bar chart of courts (via Vico 2.0)
 */
@Composable
fun DashboardScreen(
    navController: NavController,
    viewModel: DashboardViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    when (val state = uiState) {
        is DashboardUiState.Loading -> LoadingState()
        is DashboardUiState.Error -> ErrorState(
            message = state.message,
            onRetry = { viewModel.loadStats() }
        )
        is DashboardUiState.Success -> DashboardContent(stats = state.stats)
    }
}

@Composable
private fun DashboardContent(
    stats: DashboardStats,
    modifier: Modifier = Modifier
) {
    val numFmt = remember { NumberFormat.getNumberInstance(Locale.getDefault()) }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(DesignTokens.Spacing.base),
        verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.base)
    ) {
        item {
            PageHeader(title = "Dashboard")
        }

        item {
            // ── Stat cards (2-column grid using Rows — LazyVerticalGrid cannot
            // be nested inside LazyColumn items due to unbounded height constraints)
            Column(verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    StatCard(
                        label = "Total Cases",
                        value = numFmt.format(stats.totalCases),
                        icon = Icons.Default.Gavel,
                        modifier = Modifier.weight(1f)
                    )
                    StatCard(
                        label = "Full Text",
                        value = numFmt.format(stats.withFullText),
                        icon = Icons.Default.TrendingUp,
                        modifier = Modifier.weight(1f)
                    )
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.sm),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    StatCard(
                        label = "Courts",
                        value = stats.courts.size.toString(),
                        icon = Icons.Default.BarChart,
                        modifier = Modifier.weight(1f)
                    )
                    StatCard(
                        label = "Recent Cases",
                        value = numFmt.format(stats.recentCasesCount),
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }

        if (stats.courts.isNotEmpty()) {
            item {
                CourtsBarChart(courts = stats.courts)
            }
        }
    }
}

@Composable
private fun CourtsBarChart(
    courts: Map<String, Int>,
    modifier: Modifier = Modifier
) {
    // Sort by count descending for best visual clarity; cap at 10 courts
    val sortedCourts = courts.entries
        .sortedByDescending { it.value }
        .take(10)

    val modelProducer = remember { CartesianChartModelProducer() }

    LaunchedEffect(sortedCourts) {
        if (sortedCourts.isNotEmpty()) {
            modelProducer.runTransaction {
                columnSeries { series(sortedCourts.map { it.value.toFloat() }) }
            }
        }
    }

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = "Cases by Court",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(bottom = DesignTokens.Spacing.sm)
        )
        CartesianChartHost(
            chart = rememberCartesianChart(
                rememberColumnCartesianLayer(
                    ColumnCartesianLayer.ColumnProvider.series(
                        rememberLineComponent(
                            fill = Fill(MaterialTheme.colorScheme.primary.toArgb()),
                            thickness = 20.dp
                        )
                    )
                ),
                startAxis = VerticalAxis.rememberStart(),
                bottomAxis = HorizontalAxis.rememberBottom(
                    valueFormatter = { _, x, _ ->
                        sortedCourts.getOrNull(x.toInt())?.key ?: x.toString()
                    }
                )
            ),
            modelProducer = modelProducer,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = DesignTokens.Spacing.sm)
        )
    }
}
