package au.gov.immi.cases.ui.components

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Displays a case nature badge (Protection Visa, Character Ground, etc.)
 * Uses the theme's primaryContainer colour for a consistent look.
 */
@Composable
fun NatureBadge(
    nature: String,
    modifier: Modifier = Modifier
) {
    if (nature.isBlank()) return
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(4.dp),
        color = MaterialTheme.colorScheme.primaryContainer
    ) {
        Text(
            text = nature,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer
        )
    }
}
