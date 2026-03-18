package au.gov.immi.cases.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import au.gov.immi.cases.feature.analytics.AnalyticsScreen
import au.gov.immi.cases.feature.cases.CaseAddScreen
import au.gov.immi.cases.feature.cases.CaseCompareScreen
import au.gov.immi.cases.feature.cases.CaseDetailScreen
import au.gov.immi.cases.feature.cases.CaseEditScreen
import au.gov.immi.cases.feature.cases.CasesScreen
import au.gov.immi.cases.feature.collections.CollectionDetailScreen
import au.gov.immi.cases.feature.collections.CollectionsScreen
import au.gov.immi.cases.feature.dashboard.DashboardScreen
import au.gov.immi.cases.feature.judge.JudgeCompareScreen
import au.gov.immi.cases.feature.judge.JudgeDetailScreen
import au.gov.immi.cases.feature.judge.JudgeProfilesScreen
import au.gov.immi.cases.feature.legislation.LegislationDetailScreen
import au.gov.immi.cases.feature.legislation.LegislationsScreen
import au.gov.immi.cases.feature.misc.CourtLineageScreen
import au.gov.immi.cases.feature.misc.DataDictionaryScreen
import au.gov.immi.cases.feature.misc.LlmCouncilScreen
import au.gov.immi.cases.feature.misc.SearchTaxonomyScreen
import au.gov.immi.cases.feature.search.GuidedSearchScreen
import au.gov.immi.cases.feature.search.SavedSearchesScreen
import au.gov.immi.cases.feature.search.SearchScreen
import au.gov.immi.cases.feature.search.SemanticSearchScreen
import au.gov.immi.cases.feature.settings.SettingsScreen
import au.gov.immi.cases.feature.system.DownloadScreen
import au.gov.immi.cases.feature.system.JobStatusScreen
import au.gov.immi.cases.feature.system.PipelineScreen

@Composable
fun ImmiNavGraph(
    navController: NavHostController = rememberNavController(),
    modifier: Modifier = Modifier
) {
    NavHost(
        navController = navController,
        startDestination = Dashboard,
        modifier = modifier
    ) {
        // ── Top-level ─────────────────────────────────────────────────
        composable<Dashboard> { DashboardScreen(navController) }
        composable<Cases> { CasesScreen(navController) }
        composable<Search> { SearchScreen(navController) }
        composable<Analytics> { AnalyticsScreen(navController) }
        composable<Legislations> { LegislationsScreen(navController) }
        composable<Settings> { SettingsScreen(navController) }

        // ── Cases ─────────────────────────────────────────────────────
        // Navigation 2.8 type-safe routes automatically populate SavedStateHandle
        // so CaseDetailViewModel and CaseEditViewModel can read caseId directly.
        composable<CaseDetail> {
            CaseDetailScreen(navController)
        }
        composable<CaseEdit> {
            CaseEditScreen(navController)
        }
        composable<CaseAdd> {
            CaseAddScreen(navController)
        }
        composable<CaseCompare> { backStackEntry ->
            val route = backStackEntry.toRoute<CaseCompare>()
            CaseCompareScreen(
                navController = navController,
                caseId1 = route.caseId1,
                caseId2 = route.caseId2
            )
        }

        // ── Collections ───────────────────────────────────────────────
        composable<Collections> { CollectionsScreen(navController) }
        composable<CollectionDetail> { backStackEntry ->
            val route = backStackEntry.toRoute<CollectionDetail>()
            CollectionDetailScreen(
                navController = navController,
                collectionId = route.collectionId
            )
        }

        // ── Search ────────────────────────────────────────────────────
        composable<SemanticSearch> { SemanticSearchScreen(navController) }
        composable<GuidedSearch> { GuidedSearchScreen(navController) }
        composable<SavedSearches> { SavedSearchesScreen(navController) }
        composable<SearchTaxonomy> { SearchTaxonomyScreen(navController) }

        // ── Analytics ─────────────────────────────────────────────────
        composable<JudgeProfiles> { JudgeProfilesScreen(navController) }
        composable<JudgeDetail> { backStackEntry ->
            val route = backStackEntry.toRoute<JudgeDetail>()
            JudgeDetailScreen(
                navController = navController,
                judgeName = route.judgeName
            )
        }
        composable<JudgeCompare> { backStackEntry ->
            val route = backStackEntry.toRoute<JudgeCompare>()
            JudgeCompareScreen(
                navController = navController,
                namesParam = route.judgeNames
            )
        }
        composable<CourtLineage> { CourtLineageScreen(navController) }

        // ── Legislations ──────────────────────────────────────────────
        composable<LegislationDetail> { backStackEntry ->
            val route = backStackEntry.toRoute<LegislationDetail>()
            LegislationDetailScreen(
                navController = navController,
                legislationId = route.legislationId
            )
        }

        // ── System ────────────────────────────────────────────────────
        composable<Download> { DownloadScreen(navController) }
        composable<JobStatus> { JobStatusScreen(navController) }
        composable<Pipeline> { PipelineScreen(navController) }
        composable<LlmCouncil> { LlmCouncilScreen(navController) }
        composable<DataDictionary> { DataDictionaryScreen(navController) }
    }
}
