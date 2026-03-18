package au.gov.immi.cases.feature.judge

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Compare
import androidx.compose.material.icons.filled.Person
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
import au.gov.immi.cases.core.model.JudgeEntry
import au.gov.immi.cases.navigation.JudgeCompare
import au.gov.immi.cases.navigation.JudgeDetail
import au.gov.immi.cases.ui.components.EmptyState
import au.gov.immi.cases.ui.components.ErrorState
import au.gov.immi.cases.ui.components.LoadingState
import au.gov.immi.cases.ui.components.PageHeader

/**
 * Judge Profiles / Leaderboard screen.
 *
 * Displays judges sorted by total case volume.  Tapping a row navigates
 * to [JudgeDetailScreen]; the compare button in the top-bar launches
 * [JudgeCompareScreen] with the top-2 judges pre-selected.
 */
@Composable
fun JudgeProfilesScreen(
    navController: NavController,
    viewModel: JudgeViewModel = hiltViewModel()
) {
    val state by viewModel.leaderboard.collectAsState()

    LaunchedEffect(Unit) {
        viewModel.loadLeaderboard()
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // ── Top bar ───────────────────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            PageHeader(title = "Judge Profiles")
            if (state.entries.size >= 2) {
                IconButton(
                    onClick = {
                        val top2 = state.entries.take(2).joinToString(",") { it.name }
                        navController.navigate(JudgeCompare(judgeNames = top2))
                    }
                ) {
                    Icon(
                        imageVector = Icons.Default.Compare,
                        contentDescription = "Compare top judges"
                    )
                }
            }
        }

        // ── Content ───────────────────────────────────────────────────────
        when {
            state.isLoading -> LoadingState()
            state.error != null -> ErrorState(
                message = state.error!!,
                onRetry = { viewModel.loadLeaderboard() }
            )
            state.entries.isEmpty() -> EmptyState(message = "No judge data available")
            else -> JudgeLeaderboard(
                entries = state.entries,
                onJudgeClick = { name ->
                    navController.navigate(JudgeDetail(judgeName = name))
                }
            )
        }
    }
}

@Composable
private fun JudgeLeaderboard(
    entries: List<JudgeEntry>,
    onJudgeClick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        itemsIndexed(entries) { index, entry ->
            JudgeLeaderboardCard(
                rank = index + 1,
                entry = entry,
                onClick = { onJudgeClick(entry.name) }
            )
        }
    }
}

@Composable
private fun JudgeLeaderboardCard(
    rank: Int,
    entry: JudgeEntry,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Rank badge
            Text(
                text = "#$rank",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.width(40.dp)
            )

            Icon(
                imageVector = Icons.Default.Person,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = entry.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold
                )
                Text(
                    text = "${entry.totalCases} cases · %.1f%% success".format(
                        entry.successRate * 100
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
