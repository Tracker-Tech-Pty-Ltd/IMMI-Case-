package au.gov.immi.cases.feature.cases

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController

/**
 * Case Compare screen (Phase 3B simplified).
 * Accepts two case IDs and renders a side-by-side placeholder.
 * Full comparison layout will be implemented in a later phase.
 */
@Composable
fun CaseCompareScreen(
    navController: NavController,
    caseId1: String,
    caseId2: String
) {
    Text(
        text = "Compare: $caseId1 vs $caseId2",
        modifier = Modifier.padding(16.dp),
        style = MaterialTheme.typography.bodyLarge
    )
}
