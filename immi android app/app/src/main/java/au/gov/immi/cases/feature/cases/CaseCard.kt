package au.gov.immi.cases.feature.cases

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import au.gov.immi.cases.core.model.ImmigrationCase
import au.gov.immi.cases.ui.components.CourtBadge
import au.gov.immi.cases.ui.components.OutcomeBadge

/**
 * A single-case list card used inside [CasesScreen] LazyColumn.
 * Renders title, court/outcome/year badges, and an optional text snippet.
 * All display data is derived from the immutable [ImmigrationCase] — never mutated.
 */
@Composable
fun CaseCard(
    case: ImmigrationCase,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        onClick = onClick,
        modifier = modifier.fillMaxWidth()
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            // Title row — falls back to citation via displayTitle()
            Text(
                text = case.displayTitle(),
                style = MaterialTheme.typography.titleSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(Modifier.height(4.dp))

            // Badges row: court code, outcome, year
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (case.courtCode.isNotBlank()) {
                    CourtBadge(courtCode = case.courtCode)
                }
                if (case.outcome.isNotBlank()) {
                    OutcomeBadge(outcome = case.outcome)
                }
                if (case.year > 0) {
                    Text(
                        text = "${case.year}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // Card snippet — catchwords preferred, textSnippet boilerplate stripped
            val snippet = case.cardSnippet()
            if (snippet.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = snippet,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}
