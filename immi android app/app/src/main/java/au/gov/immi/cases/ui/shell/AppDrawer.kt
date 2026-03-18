package au.gov.immi.cases.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import au.gov.immi.cases.ui.theme.DesignTokens

/**
 * App 導航抽屜（Navigation Drawer）。
 *
 * 顯示所有導航目的地，依 [NavigationItems.groups] 分組。
 * 頂部顯示 App 品牌 Header；點擊項目後關閉抽屜並導航。
 *
 * @param navController 用於執行頁面導航
 * @param currentRoute 當前路由的字串表示（用於高亮選中項目）
 * @param onCloseDrawer 關閉抽屜的回呼
 */
@Composable
fun AppDrawer(
    navController: NavHostController,
    currentRoute: String?,
    onCloseDrawer: () -> Unit
) {
    // Webapp: sidebar background = background.sidebar (#faf9f7 very light warm)
    ModalDrawerSheet(drawerContainerColor = DesignTokens.Colors.bgSidebar) {
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState())
        ) {
            // ── App Header ─────────────────────────────────────────────────────
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.primary)
                    .padding(horizontal = 16.dp, vertical = 20.dp)
            ) {
                Column {
                    Text(
                        text = "IMMI Cases",
                        style = MaterialTheme.typography.titleLarge,
                        color = Color.White
                    )
                    Text(
                        text = "Australian Immigration Law",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.White.copy(alpha = 0.7f)
                    )
                }
            }

            Spacer(Modifier.height(8.dp))

            // ── Navigation groups ──────────────────────────────────────────────
            NavigationItems.groups.forEach { group ->
                Text(
                    text = group,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp, top = 8.dp, bottom = 4.dp)
                )
                NavigationItems.byGroup(group).forEach { item ->
                    NavigationDrawerItem(
                        label = { Text(item.label) },
                        selected = false, // 簡化版：route matching 由 BottomNavItem 處理
                        onClick = {
                            onCloseDrawer()
                            navController.navigate(item.route) {
                                launchSingleTop = true
                                restoreState = true
                            }
                        },
                        icon = { Icon(item.icon, contentDescription = null) },
                        modifier = Modifier.padding(horizontal = 12.dp)
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
        }
    }
}
