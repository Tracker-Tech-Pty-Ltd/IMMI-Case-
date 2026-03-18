package au.gov.immi.cases

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import au.gov.immi.cases.data.preferences.AppPreferences
import au.gov.immi.cases.ui.shell.AppLayout
import au.gov.immi.cases.ui.theme.ImmiTheme
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * App 唯一入口 Activity。
 *
 * 使用 [@AndroidEntryPoint] 啟用 Hilt 依賴注入。
 * 注入 [AppPreferences] 以讀取深色模式設定，並透過 [collectAsStateWithLifecycle]
 * 以生命週期感知方式收集 Flow 值。
 *
 * 整個 UI 由 [ImmiTheme] 包裝，確保 Material 3 主題一致性。
 * [AppLayout] 負責 Scaffold + Bottom Nav + Drawer 的整體 App Shell。
 *
 * [enableEdgeToEdge] 讓 App 延伸到系統列（Edge-to-Edge）。
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var appPreferences: AppPreferences

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val darkMode by appPreferences.darkMode.collectAsStateWithLifecycle(
                initialValue = false
            )
            ImmiTheme(darkTheme = darkMode) {
                AppLayout()
            }
        }
    }
}
