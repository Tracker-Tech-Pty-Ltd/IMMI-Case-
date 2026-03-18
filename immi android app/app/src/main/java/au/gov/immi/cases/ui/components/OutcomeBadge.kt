package au.gov.immi.cases.ui.components

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import au.gov.immi.cases.core.model.OutcomeColors

/**
 * Displays a coloured badge for a case outcome.
 * Granted = green, Dismissed/Refused = red, etc.
 * Matches web version OutcomeBadge component.
 */
@Composable
fun OutcomeBadge(
    outcome: String,
    modifier: Modifier = Modifier
) {
    if (outcome.isBlank()) return
    val color = OutcomeColors[outcome]
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(4.dp),
        color = color.copy(alpha = 0.15f)
    ) {
        Text(
            text = outcome,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall,
            color = color
        )
    }
}
