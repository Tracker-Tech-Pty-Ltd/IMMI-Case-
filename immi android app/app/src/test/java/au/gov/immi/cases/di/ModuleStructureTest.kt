package au.gov.immi.cases.di

import au.gov.immi.cases.ImmiApplication
import au.gov.immi.cases.data.preferences.AppPreferences
import dagger.hilt.android.HiltAndroidApp
import dagger.Module
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Test

class ModuleStructureTest {

    @Test
    fun `NetworkModule is annotated with @Module`() {
        val annotation = NetworkModule::class.annotations
            .filterIsInstance<Module>()
            .firstOrNull()
        assertNotNull(annotation, "NetworkModule 必須有 @Module 標注")
    }

    @Test
    fun `DatabaseModule is annotated with @Module`() {
        val annotation = DatabaseModule::class.annotations
            .filterIsInstance<Module>()
            .firstOrNull()
        assertNotNull(annotation, "DatabaseModule 必須有 @Module 標注")
    }

    @Test
    fun `RepositoryModule is annotated with @Module`() {
        val annotation = RepositoryModule::class.annotations
            .filterIsInstance<Module>()
            .firstOrNull()
        assertNotNull(annotation, "RepositoryModule 必須有 @Module 標注")
    }

    @Test
    fun `AppPreferences has correct companion object keys`() {
        assertEquals("server_url", AppPreferences.KEY_SERVER_URL.name)
        assertEquals("dark_mode", AppPreferences.KEY_DARK_MODE.name)
        assertEquals("cache_size_mb", AppPreferences.KEY_CACHE_SIZE_MB.name)
    }

    @Test
    fun `AppPreferences default server URL targets emulator`() {
        assertEquals("http://10.0.2.2:8080", AppPreferences.DEFAULT_SERVER_URL)
    }

    @Test
    fun `ImmiApplication is annotated with @HiltAndroidApp`() {
        val annotation = ImmiApplication::class.annotations
            .filterIsInstance<HiltAndroidApp>()
            .firstOrNull()
        assertNotNull(annotation, "ImmiApplication 必須有 @HiltAndroidApp 標注")
    }
}
