package au.gov.immi.cases.feature.judge

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavController
import au.gov.immi.cases.ui.components.ErrorState
import au.gov.immi.cases.ui.components.LoadingState
import au.gov.immi.cases.ui.components.StatCard

/**
 * Judge detail screen.
 *
 * Displays a judge's full profile (total cases, success rate, common courts,
 * outcome breakdown) as retrieved from the API.
 *
 * The [judgeName] parameter is injected automatically by Hilt / Navigation
 * from the [JudgeDetail] route's [SavedStateHandle].
 */
@Composable
fun JudgeDetailScreen(
    navController: NavController,
    judgeName: String,
    viewModel: JudgeViewModel = hiltViewModel()
) {
    val state by viewModel.profile.collectAsState()

    LaunchedEffect(judgeName) {
        viewModel.loadProfile(judgeName)
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // ── Top bar ───────────────────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            IconButton(onClick = { navController.popBackStack() }) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back"
                )
            }
            Text(
                text = state.judgeName.ifBlank { judgeName },
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f)
            )
        }

        // ── Content ───────────────────────────────────────────────────────
        when {
            state.isLoading -> LoadingState()
            state.error != null -> ErrorState(
                message = state.error!!,
                onRetry = { viewModel.loadProfile(judgeName) }
            )
            else -> JudgeProfileContent(data = state.data)
        }
    }
}

@Suppress("UNCHECKED_CAST")
@Composable
private fun JudgeProfileContent(
    data: Map<String, Any>,
    modifier: Modifier = Modifier
) {
    val totalCases = (data["total_cases"] as? Number)?.toInt() ?: 0
    val successRate = (data["success_rate"] as? Number)?.toDouble() ?: 0.0
    val court = (data["most_common_court"] as? String) ?: ""
    val outcomes = (data["outcomes"] as? Map<String, Any>)
        ?.mapValues { (_, v) -> (v as? Number)?.toInt() ?: 0 }
        ?: emptyMap()

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            // ── Summary stats ──────────────────────────────────────────
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                StatCard(
                    label = "Total Cases",
                    value = totalCases.toString(),
                    modifier = Modifier.weight(1f)
                )
                StatCard(
                    label = "Success Rate",
                    value = "%.1f%%".format(successRate * 100),
                    modifier = Modifier.weight(1f)
                )
            }
        }

        if (court.isNotBlank()) {
            item {
                StatCard(
                    label = "Primary Court",
                    value = court,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }

        if (outcomes.isNotEmpty()) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "Outcome Breakdown",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                        outcomes.entries
                            .sortedByDescending { it.value }
                            .forEachIndexed { i, (outcome, count) ->
                                if (i > 0) {
                                    HorizontalDivider(
                                        modifier = Modifier.padding(vertical = 4.dp)
                                    )
                                }
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = outcome,
                                        style = MaterialTheme.typography.bodyMedium
                                    )
                                    Text(
                                        text = count.toString(),
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                            }
                    }
                }
            }
        }
    }
}
