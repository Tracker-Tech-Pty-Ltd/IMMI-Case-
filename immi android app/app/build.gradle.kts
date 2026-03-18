plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

android {
    namespace = "au.gov.immi.cases"
    compileSdk = 35

    defaultConfig {
        applicationId = "au.gov.immi.cases"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            isDebuggable = true
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            buildConfigField("String", "DEFAULT_SERVER_URL", "\"http://10.0.2.2:8080\"")
            buildConfigField("Boolean", "ENABLE_LOGGING", "true")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            buildConfigField("String", "DEFAULT_SERVER_URL", "\"https://your-server.com\"")
            buildConfigField("Boolean", "ENABLE_LOGGING", "false")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.all {
            it.useJUnitPlatform()
        }
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // ─── Compose BOM ─────────────────────────────────────────────────────────────
    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)
    androidTestImplementation(composeBom)

    // ─── Compose Core ────────────────────────────────────────────────────────────
    implementation(libs.bundles.compose.core)
    debugImplementation(libs.compose.ui.tooling)

    // ─── Navigation ──────────────────────────────────────────────────────────────
    implementation(libs.compose.navigation)

    // ─── Lifecycle ───────────────────────────────────────────────────────────────
    implementation(libs.bundles.lifecycle)

    // ─── Hilt ────────────────────────────────────────────────────────────────────
    implementation(libs.hilt.android)
    implementation(libs.hilt.navigation.compose)
    ksp(libs.hilt.compiler)

    // ─── Retrofit + OkHttp ───────────────────────────────────────────────────────
    implementation(libs.bundles.retrofit)

    // ─── Moshi ───────────────────────────────────────────────────────────────────
    implementation(libs.bundles.moshi)
    ksp(libs.moshi.codegen)

    // ─── Room ────────────────────────────────────────────────────────────────────
    implementation(libs.bundles.room)
    ksp(libs.room.compiler)

    // ─── Paging ──────────────────────────────────────────────────────────────────
    implementation(libs.bundles.paging)

    // ─── Vico Charts ─────────────────────────────────────────────────────────────
    implementation(libs.vico.compose.m3)

    // ─── Coil ────────────────────────────────────────────────────────────────────
    implementation(libs.bundles.coil)

    // ─── DataStore ───────────────────────────────────────────────────────────────
    implementation(libs.datastore.preferences)

    // ─── Coroutines ──────────────────────────────────────────────────────────────
    implementation(libs.coroutines.android)

    // ─── Kotlinx Serialization ────────────────────────────────────────────────────
    implementation(libs.kotlinx.serialization.json)

    // ─── Unit Tests ──────────────────────────────────────────────────────────────
    testImplementation(libs.bundles.testing.unit)
    testRuntimeOnly(libs.junit5.engine)
    testImplementation(libs.room.testing)

    // ─── Instrumented Tests ──────────────────────────────────────────────────────
    androidTestImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
