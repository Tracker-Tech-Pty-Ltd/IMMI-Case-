package au.gov.immi.cases

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

/**
 * 應用程式入口點，由 Hilt 自動初始化 DI 元件。
 *
 * AndroidManifest.xml 中已設定 android:name=".ImmiApplication"。
 */
@HiltAndroidApp
class ImmiApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        // Hilt 會自動初始化 DI 元件樹
        // Phase 2+ 可在此加入 Timber.plant(Timber.DebugTree()) 等初始化
    }
}
