package au.gov.immi.cases.feature.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import au.gov.immi.cases.ui.components.PageHeader

/**
 * Settings screen.
 *
 * Allows the user to configure:
 * - Server URL (with validation)
 * - Dark mode toggle
 * - Reset all to defaults
 */
@Composable
fun SettingsScreen(
    navController: NavController,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
    ) {
        PageHeader(title = "Settings", subtitle = "App configuration")

        Column(modifier = Modifier.padding(horizontal = 16.dp)) {

            // ── Server URL ────────────────────────────────────────────────
            Text(
                text = "Server Connection",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(8.dp))

            OutlinedTextField(
                value = state.serverUrlInput,
                onValueChange = { viewModel.onServerUrlChange(it) },
                label = { Text("Server URL") },
                isError = state.urlError != null,
                supportingText = if (state.urlError != null) {
                    { Text(state.urlError!!, color = MaterialTheme.colorScheme.error) }
                } else if (state.isSaved) {
                    { Text("Saved", color = MaterialTheme.colorScheme.primary) }
                } else null,
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(modifier = Modifier.height(8.dp))

            Button(
                onClick = { viewModel.saveServerUrl() },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Save Server URL")
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Restart the app after changing the server URL for it to take effect.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(24.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            // ── Dark Mode ─────────────────────────────────────────────────
            Text(
                text = "Appearance",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Dark Mode",
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.bodyMedium
                )
                Switch(
                    checked = state.darkMode,
                    onCheckedChange = { viewModel.setDarkMode(it) }
                )
            }

            Spacer(modifier = Modifier.height(24.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            // ── Reset ─────────────────────────────────────────────────────
            Text(
                text = "Cache",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Cache size: ${state.cacheSizeMb} MB",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(24.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            OutlinedButton(
                onClick = { viewModel.resetSettings() },
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Reset All Settings")
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
