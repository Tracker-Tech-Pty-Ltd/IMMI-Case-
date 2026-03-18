package au.gov.immi.cases.ui.shell

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Search
import androidx.compose.ui.graphics.vector.ImageVector
import au.gov.immi.cases.navigation.Analytics
import au.gov.immi.cases.navigation.Cases
import au.gov.immi.cases.navigation.Dashboard
import au.gov.immi.cases.navigation.Legislations
import au.gov.immi.cases.navigation.Search

// Gavel icon (uses AutoMirrored namespace in newer versions, fallback to filled)
import androidx.compose.material.icons.filled.Gavel
import androidx.compose.material.icons.outlined.Gavel

/**
 * Bottom Navigation 的 5 個主要 Tab。
 *
 * 每個條目包含：
 * - [route]：type-safe navigation 目的地物件
 * - [label]：顯示在 tab 下方的標籤文字
 * - [selectedIcon]：選中狀態的圖示（Filled 風格）
 * - [unselectedIcon]：未選中狀態的圖示（Outlined 風格）
 */
enum class BottomNavItem(
    val route: Any,
    val label: String,
    val selectedIcon: ImageVector,
    val unselectedIcon: ImageVector
) {
    DASHBOARD(
        route = Dashboard,
        label = "Dashboard",
        selectedIcon = Icons.Filled.Home,
        unselectedIcon = Icons.Outlined.Home
    ),
    CASES(
        route = Cases,
        label = "Cases",
        selectedIcon = Icons.Filled.Gavel,
        unselectedIcon = Icons.Outlined.Gavel
    ),
    SEARCH(
        route = Search,
        label = "Search",
        selectedIcon = Icons.Filled.Search,
        unselectedIcon = Icons.Outlined.Search
    ),
    ANALYTICS(
        route = Analytics,
        label = "Analytics",
        selectedIcon = Icons.Filled.BarChart,
        unselectedIcon = Icons.Outlined.BarChart
    ),
    MORE(
        route = Legislations, // 「更多」Tab 預設跳至 Legislations
        label = "More",
        selectedIcon = Icons.Filled.Menu,
        unselectedIcon = Icons.Outlined.Menu
    );

    companion object {
        /**
         * 根據當前 route 物件的 KClass 決定哪個 Tab 是 selected。
         * 若傳入 null 或找不到匹配的 Tab，回傳 null。
         */
        fun fromRoute(route: Any?): BottomNavItem? =
            route?.let { r -> entries.firstOrNull { it.route::class == r::class } }
    }
}
