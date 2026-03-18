package au.gov.immi.cases.feature.misc

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController

/**
 * Placeholder screens for routes that are planned but not yet implemented.
 *
 * These allow [NavGraph] to compile and route correctly without
 * exposing incomplete or empty composable bodies.
 */

@Composable
fun SearchTaxonomyScreen(navController: NavController) {
    PlaceholderContent(
        title = "Search Taxonomy",
        description = "Browse legal concept taxonomy and hierarchical categories"
    )
}

@Composable
fun CourtLineageScreen(navController: NavController) {
    PlaceholderContent(
        title = "Court Lineage",
        description = "Australian court hierarchy and court succession history"
    )
}

@Composable
fun LlmCouncilScreen(navController: NavController) {
    PlaceholderContent(
        title = "LLM Council",
        description = "AI-assisted legal analysis and multi-model consensus"
    )
}

@Composable
fun DataDictionaryScreen(navController: NavController) {
    PlaceholderContent(
        title = "Data Dictionary",
        description = "Field definitions, data structure, and extraction metadata"
    )
}

@Composable
private fun PlaceholderContent(title: String, description: String) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(text = title, style = MaterialTheme.typography.headlineSmall)
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = description,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            text = "Coming in future update",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline
        )
    }
}
