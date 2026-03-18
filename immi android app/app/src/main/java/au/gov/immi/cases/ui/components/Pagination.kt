package au.gov.immi.cases.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * Holds the pagination state and computes the visible page range.
 *
 * [visiblePages] returns a list of page numbers (Int) and nulls (ellipsis markers).
 * For 7 or fewer pages: returns all page numbers.
 * For more pages: always includes 1 and [totalPages], with nulls for skipped ranges.
 */
data class PaginationState(
    val currentPage: Int,
    val totalPages: Int,
    val totalItems: Int
) {
    val hasPrevious: Boolean get() = currentPage > 1
    val hasNext: Boolean get() = currentPage < totalPages
    val isFirstPage: Boolean get() = currentPage == 1
    val isLastPage: Boolean get() = currentPage == totalPages

    /**
     * Produces the visible page numbers for rendering pagination controls.
     * Returns at most 7 items. Nulls represent ellipsis ("...") positions.
     *
     * Examples:
     *   totalPages=7, currentPage=3 → [1,2,3,4,5,6,7]
     *   totalPages=20, currentPage=1 → [1,2,null,19,20] (approx)
     *   totalPages=20, currentPage=10 → [1,null,9,10,11,null,20]
     */
    fun visiblePages(): List<Int?> {
        if (totalPages <= 7) return (1..totalPages).map { it }
        return buildList {
            add(1)
            if (currentPage > 3) add(null) // leading ellipsis
            val start = maxOf(2, currentPage - 1)
            val end = minOf(totalPages - 1, currentPage + 1)
            for (i in start..end) add(i)
            if (currentPage < totalPages - 2) add(null) // trailing ellipsis
            add(totalPages)
        }
    }
}

/**
 * Pagination control row with previous/next buttons and page number chips.
 * Matches web version Pagination component behaviour.
 */
@Composable
fun Pagination(
    state: PaginationState,
    onPageChange: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        IconButton(
            onClick = { onPageChange(state.currentPage - 1) },
            enabled = state.hasPrevious
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Previous page"
            )
        }

        state.visiblePages().forEach { page ->
            if (page == null) {
                Text(
                    text = "...",
                    modifier = Modifier.padding(horizontal = 4.dp)
                )
            } else {
                val isSelected = page == state.currentPage
                TextButton(
                    onClick = { onPageChange(page) },
                    colors = if (isSelected) {
                        ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.primary
                        )
                    } else {
                        ButtonDefaults.textButtonColors()
                    }
                ) {
                    Text(
                        text = "$page",
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                    )
                }
            }
        }

        IconButton(
            onClick = { onPageChange(state.currentPage + 1) },
            enabled = state.hasNext
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForward,
                contentDescription = "Next page"
            )
        }
    }
}
