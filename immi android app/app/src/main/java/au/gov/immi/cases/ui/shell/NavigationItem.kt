package au.gov.immi.cases.ui.shell

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Bookmarks
import androidx.compose.material.icons.filled.CollectionsBookmark
import androidx.compose.material.icons.filled.Dataset
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Gavel
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.WorkHistory
import androidx.compose.ui.graphics.vector.ImageVector
import au.gov.immi.cases.navigation.Analytics
import au.gov.immi.cases.navigation.CaseAdd
import au.gov.immi.cases.navigation.Cases
import au.gov.immi.cases.navigation.Collections
import au.gov.immi.cases.navigation.CourtLineage
import au.gov.immi.cases.navigation.DataDictionary
import au.gov.immi.cases.navigation.Download
import au.gov.immi.cases.navigation.GuidedSearch
import au.gov.immi.cases.navigation.JobStatus
import au.gov.immi.cases.navigation.JudgeProfiles
import au.gov.immi.cases.navigation.Legislations
import au.gov.immi.cases.navigation.LlmCouncil
import au.gov.immi.cases.navigation.Pipeline
import au.gov.immi.cases.navigation.SavedSearches
import au.gov.immi.cases.navigation.Search
import au.gov.immi.cases.navigation.SemanticSearch
import au.gov.immi.cases.navigation.Settings

/**
 * Drawer 中的每個導航項目資料模型。
 *
 * @param route type-safe navigation 目的地物件
 * @param label 顯示的標籤文字
 * @param icon 項目圖示
 * @param group 所屬分組名稱（用於 Drawer 中的分組顯示）
 */
data class NavigationItem(
    val route: Any,
    val label: String,
    val icon: ImageVector,
    val group: String = ""
)

/**
 * 所有 Drawer 導航項目的靜態定義。
 * 對應 Web 版 Sidebar 的完整 26 個目的地（依分組組織）。
 */
object NavigationItems {

    val allItems: List<NavigationItem> = buildList {
        // ── Cases 分組 ─────────────────────────────────────────────────────────
        add(NavigationItem(route = Cases, label = "Cases", icon = Icons.Filled.Gavel, group = "Cases"))
        add(NavigationItem(route = Collections, label = "Collections", icon = Icons.Filled.CollectionsBookmark, group = "Cases"))
        add(NavigationItem(route = CaseAdd, label = "Add Case", icon = Icons.Filled.Add, group = "Cases"))

        // ── Search 分組 ────────────────────────────────────────────────────────
        add(NavigationItem(route = Search, label = "Search", icon = Icons.Filled.Search, group = "Search"))
        add(NavigationItem(route = SemanticSearch, label = "Semantic Search", icon = Icons.Filled.AutoAwesome, group = "Search"))
        add(NavigationItem(route = GuidedSearch, label = "Guided Search", icon = Icons.Filled.Tune, group = "Search"))
        add(NavigationItem(route = SavedSearches, label = "Saved Searches", icon = Icons.Filled.Bookmarks, group = "Search"))

        // ── Analytics 分組 ─────────────────────────────────────────────────────
        add(NavigationItem(route = Analytics, label = "Analytics", icon = Icons.Filled.BarChart, group = "Analytics"))
        add(NavigationItem(route = JudgeProfiles, label = "Judge Profiles", icon = Icons.Filled.Person, group = "Analytics"))
        add(NavigationItem(route = CourtLineage, label = "Court Lineage", icon = Icons.Filled.AccountTree, group = "Analytics"))

        // ── Legislation 分組 ───────────────────────────────────────────────────
        add(NavigationItem(route = Legislations, label = "Legislations", icon = Icons.AutoMirrored.Filled.MenuBook, group = "Legislation"))

        // ── System 分組 ────────────────────────────────────────────────────────
        add(NavigationItem(route = Download, label = "Download", icon = Icons.Filled.Download, group = "System"))
        add(NavigationItem(route = Pipeline, label = "Pipeline", icon = Icons.Filled.PlayArrow, group = "System"))
        add(NavigationItem(route = JobStatus, label = "Job Status", icon = Icons.Filled.WorkHistory, group = "System"))
        add(NavigationItem(route = LlmCouncil, label = "LLM Council", icon = Icons.Filled.Psychology, group = "System"))
        add(NavigationItem(route = DataDictionary, label = "Data Dictionary", icon = Icons.Filled.Dataset, group = "System"))
        add(NavigationItem(route = Settings, label = "Settings", icon = Icons.Filled.Settings, group = "System"))
    }

    /** 所有分組名稱（依插入順序排列，不重複） */
    val groups: List<String> get() = allItems.map { it.group }.distinct()

    /** 回傳指定分組的所有導航項目；若分組不存在則回傳空清單 */
    fun byGroup(group: String): List<NavigationItem> = allItems.filter { it.group == group }
}
