package au.gov.immi.cases.ui.shell

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import au.gov.immi.cases.navigation.ImmiNavGraph
import kotlinx.coroutines.launch

/**
 * App Shell — 整體框架，包含：
 * - [ModalNavigationDrawer]：側邊抽屜（全部 17+ 個目的地）
 * - [TopAppBar]：頂部應用列（含漢堡選單按鈕）
 * - [NavigationBar]：底部導航列（5 個主要 Tab）
 * - [ImmiNavGraph]：頁面路由圖（填充 Scaffold content 區域）
 *
 * 使用 [rememberNavController] 管理導航狀態，確保 Back Stack 一致性。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppLayout(
    navController: NavHostController = rememberNavController()
) {
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val currentBackStack by navController.currentBackStackEntryAsState()
    val currentRoute = currentBackStack?.destination?.route

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            AppDrawer(
                navController = navController,
                currentRoute = currentRoute,
                onCloseDrawer = { scope.launch { drawerState.close() } }
            )
        }
    ) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        // 根據當前 route 顯示對應頁面標題
                        // Strip path params (/{caseId}) and query params (?foo=bar) before formatting
                        val title = currentBackStack?.destination?.route
                            ?.substringAfterLast(".")
                            ?.replace(Regex("/\\{[^}]+\\}|\\?.*"), "")
                            ?.replace(Regex("([A-Z])"), " $1")
                            ?.trim()
                            ?: "IMMI Cases"
                        Text(text = title)
                    },
                    navigationIcon = {
                        IconButton(
                            onClick = { scope.launch { drawerState.open() } }
                        ) {
                            Icon(
                                imageVector = Icons.Default.Menu,
                                contentDescription = "Open navigation menu"
                            )
                        }
                    }
                )
            },
            bottomBar = {
                NavigationBar {
                    BottomNavItem.entries.forEach { item ->
                        val isSelected = BottomNavItem.fromRoute(currentRoute) == item
                        NavigationBarItem(
                            selected = isSelected,
                            onClick = {
                                navController.navigate(item.route) {
                                    // 回到起始目的地，保留 back stack 狀態
                                    popUpTo(navController.graph.findStartDestination().id) {
                                        saveState = true
                                    }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = {
                                Icon(
                                    imageVector = if (isSelected) item.selectedIcon else item.unselectedIcon,
                                    contentDescription = item.label
                                )
                            },
                            label = { Text(item.label) }
                        )
                    }
                }
            }
        ) { innerPadding ->
            ImmiNavGraph(
                navController = navController,
                modifier = Modifier.padding(innerPadding)
            )
        }
    }
}
