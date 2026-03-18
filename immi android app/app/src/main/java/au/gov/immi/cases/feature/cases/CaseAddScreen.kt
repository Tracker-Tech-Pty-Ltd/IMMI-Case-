package au.gov.immi.cases.feature.cases

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController

/**
 * Case Add screen (Phase 3B simplified).
 * Accepts an AustLII URL to add a case by direct URL lookup.
 * Full submission logic will be wired in Phase 3C.
 */
@Composable
fun CaseAddScreen(navController: NavController) {
    var url by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = "Add Case",
            style = MaterialTheme.typography.headlineMedium
        )

        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("AustLII URL") },
            placeholder = { Text("https://www.austlii.edu.au/...") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        Button(
            onClick = { /* TODO: Phase 3C — trigger add-case job */ },
            modifier = Modifier.fillMaxWidth(),
            enabled = url.isNotBlank()
        ) {
            Text("Add Case")
        }
    }
}
