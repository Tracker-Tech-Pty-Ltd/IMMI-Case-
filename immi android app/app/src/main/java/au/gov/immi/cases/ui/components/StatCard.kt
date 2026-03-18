package au.gov.immi.cases.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import au.gov.immi.cases.ui.theme.DesignTokens

/**
 * Summary statistic card — label + numeric value + optional icon.
 * Matches webapp StatCard: rounded-lg border border-border bg-card p-4 shadow-sm.
 * Example: label="Total Cases", value="149,016".
 */
@Composable
fun StatCard(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null
) {
    Card(
        modifier  = modifier,
        shape     = RoundedCornerShape(DesignTokens.Radius.default),  // 16dp — webapp: rounded-lg
        colors    = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surface,       // #ffffff
        ),
        border    = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), // #eae8e3
        elevation = CardDefaults.cardElevation(
            defaultElevation = DesignTokens.Elevation.sm,             // 2dp — webapp: shadow-sm
            hoveredElevation = DesignTokens.Elevation.md,             // 4dp — webapp: hover:shadow-md
        ),
    ) {
        Column(
            modifier            = Modifier.padding(DesignTokens.Spacing.base),  // 16dp
            verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.xs),
        ) {
            if (icon != null) {
                Icon(
                    imageVector      = icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.secondary,  // accent golden-brown
                )
            }
            Text(
                text       = value,
                style      = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color      = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text  = label,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,  // #4a5568
            )
        }
    }
}
