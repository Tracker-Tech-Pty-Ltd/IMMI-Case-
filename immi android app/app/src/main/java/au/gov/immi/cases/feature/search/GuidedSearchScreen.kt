package au.gov.immi.cases.feature.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import au.gov.immi.cases.navigation.Cases

/**
 * Guided (structured) search screen.
 *
 * Presents individual form fields for the most common filter dimensions.
 * On submit, navigates to [CasesScreen] — Phase 5 will add filter param forwarding.
 */
@Composable
fun GuidedSearchScreen(navController: NavController) {
    var courtCode by remember { mutableStateOf("") }
    var year by remember { mutableStateOf("") }
    var outcome by remember { mutableStateOf("") }
    var visaSubclass by remember { mutableStateOf("") }
    var country by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(
            text = "Guided Search",
            style = MaterialTheme.typography.headlineMedium
        )

        Text(
            text = "Fill in one or more fields to narrow your search.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(Modifier.height(4.dp))

        OutlinedTextField(
            value = courtCode,
            onValueChange = { courtCode = it },
            label = { Text("Court Code") },
            placeholder = { Text("e.g. AATA, FCA") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        OutlinedTextField(
            value = year,
            onValueChange = { year = it },
            label = { Text("Year") },
            placeholder = { Text("e.g. 2024") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        OutlinedTextField(
            value = outcome,
            onValueChange = { outcome = it },
            label = { Text("Outcome") },
            placeholder = { Text("e.g. Granted, Dismissed") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        OutlinedTextField(
            value = visaSubclass,
            onValueChange = { visaSubclass = it },
            label = { Text("Visa Subclass") },
            placeholder = { Text("e.g. 866, 189") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        OutlinedTextField(
            value = country,
            onValueChange = { country = it },
            label = { Text("Country of Origin") },
            placeholder = { Text("e.g. Afghanistan, Iran") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true
        )

        Spacer(Modifier.height(8.dp))

        Button(
            onClick = {
                // Phase 5: pass filter params via route
                navController.navigate(Cases)
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Search")
        }
    }
}
