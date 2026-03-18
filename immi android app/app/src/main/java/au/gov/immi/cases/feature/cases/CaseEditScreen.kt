package au.gov.immi.cases.feature.cases

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import au.gov.immi.cases.ui.components.LoadingState

/**
 * Case Edit screen.
 * Renders editable fields (notes, tags) for the selected case.
 * On [CaseEditUiState.saveSuccess] automatically pops back to the detail screen.
 * All state changes are applied immutably via [CaseEditViewModel.updateField].
 */
@Composable
fun CaseEditScreen(
    navController: NavController,
    viewModel: CaseEditViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    // Navigate back automatically when save succeeds
    LaunchedEffect(uiState.saveSuccess) {
        if (uiState.saveSuccess) navController.popBackStack()
    }

    when {
        uiState.isLoading -> LoadingState()

        else -> {
            Column(
                modifier = Modifier
                    .padding(16.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                val case = uiState.case

                // ── Notes field ───────────────────────────────────────────────
                OutlinedTextField(
                    value = case?.userNotes ?: "",
                    onValueChange = { notes ->
                        viewModel.updateField { it.copy(userNotes = notes) }
                    },
                    label = { Text("Notes") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3
                )

                // ── Tags field ────────────────────────────────────────────────
                OutlinedTextField(
                    value = case?.tags ?: "",
                    onValueChange = { tags ->
                        viewModel.updateField { it.copy(tags = tags) }
                    },
                    label = { Text("Tags (comma-separated)") },
                    modifier = Modifier.fillMaxWidth()
                )

                // ── Error message ─────────────────────────────────────────────
                uiState.errorMessage?.let { error ->
                    Text(
                        text = error,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall
                    )
                }

                // ── Save button ───────────────────────────────────────────────
                Button(
                    onClick = { viewModel.saveCase() },
                    enabled = !uiState.isSaving,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (uiState.isSaving) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp))
                    } else {
                        Text("Save")
                    }
                }
            }
        }
    }
}
