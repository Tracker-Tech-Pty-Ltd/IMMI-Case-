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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavController
import au.gov.immi.cases.ui.components.ErrorState
import au.gov.immi.cases.ui.components.LoadingState

/**
 * Judge Compare screen — side-by-side comparison of two or more judges.
 *
 * [namesParam] is a comma-separated string of judge names supplied via the
 * [JudgeCompare] route (e.g. "Smith J,Jones M").
 */
@Composable
fun JudgeCompareScreen(
    navController: NavController,
    namesParam: String,
    viewModel: JudgeViewModel = hiltViewModel()
) {
    val names = androidx.compose.runtime.remember(namesParam) {
        namesParam.split(",").map { it.trim() }.filter { it.isNotBlank() }
    }
    val state by viewModel.compare.collectAsState()

    LaunchedEffect(names) {
        if (names.isNotEmpty()) {
            viewModel.compareJudges(names)
        }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // ── Top bar ───────────────────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = { navController.popBackStack() }) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Back"
                )
            }
            Text(
                text = "Compare Judges",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f)
            )
        }

        // ── Content ───────────────────────────────────────────────────────
        when {
            names.isEmpty() -> Text(
                text = "No judges selected",
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(32.dp),
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            state.isLoading -> LoadingState()
            state.error != null -> ErrorState(
                message = state.error!!,
                onRetry = { viewModel.compareJudges(names) }
            )
            else -> CompareContent(
                names = names,
                data = state.data
            )
        }
    }
}

@Suppress("UNCHECKED_CAST")
@Composable
private fun CompareContent(
    names: List<String>,
    data: Map<String, Any>,
    modifier: Modifier = Modifier
) {
    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Header row with judge names
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                names.forEach { name ->
                    Text(
                        text = name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }

        item { HorizontalDivider() }

        // Compare individual stats from the response
        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "Comparison Summary",
                        style = MaterialTheme.typography.titleSmall,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )

                    // The API returns a map; render key/value pairs generically.
                    // Future improvement: parse into typed cells per judge.
                    if (data.isEmpty()) {
                        Text(
                            text = "No comparison data returned",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    } else {
                        data.entries
                            .filterNot { (_, v) -> v is Map<*, *> || v is List<*> }
                            .forEach { (key, value) ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(vertical = 4.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = key.replace("_", " ")
                                            .replaceFirstChar { it.uppercase() },
                                        style = MaterialTheme.typography.bodyMedium
                                    )
                                    Text(
                                        text = value.toString(),
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

