package au.gov.immi.cases.ui.components

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import au.gov.immi.cases.core.model.CourtColors

/**
 * Displays a court code badge with court-specific brand colour.
 * AATA=blue, HCA=purple, MRTA/RRTA=green, etc.
 * Matches web version CourtBadge component.
 */
@Composable
fun CourtBadge(
    courtCode: String,
    modifier: Modifier = Modifier
) {
    if (courtCode.isBlank()) return
    val color = CourtColors[courtCode]
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(4.dp),
        color = color.copy(alpha = 0.1f)
    ) {
        Text(
            text = courtCode,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelSmall,
            color = color
        )
    }
}
