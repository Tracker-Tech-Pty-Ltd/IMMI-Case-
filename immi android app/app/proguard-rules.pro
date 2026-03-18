# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.kts.

# ─── Moshi ───────────────────────────────────────────────────────────────────
-keepclassmembers class ** {
    @com.squareup.moshi.Json <fields>;
}
-keep @com.squareup.moshi.JsonClass class * { *; }
# Keep generated adapter classes
-keep class **JsonAdapter { *; }

# ─── Retrofit ────────────────────────────────────────────────────────────────
-keepattributes Signature, Exceptions
-keepclassmembernames interface * {
    @retrofit2.http.* <methods>;
}
# Keep generic type information for Retrofit
-keepattributes *Annotation*
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}

# ─── OkHttp ──────────────────────────────────────────────────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }

# ─── Room ────────────────────────────────────────────────────────────────────
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
-keep @androidx.room.Dao interface *
-dontwarn androidx.room.**

# ─── Kotlin ──────────────────────────────────────────────────────────────────
-keepclassmembernames class kotlinx.** {
    volatile <fields>;
}
-dontwarn kotlin.**
-keep class kotlin.Metadata { *; }

# ─── Coroutines ──────────────────────────────────────────────────────────────
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keepclassmembernames class kotlinx.** {
    volatile <fields>;
}

# ─── Hilt / Dagger ───────────────────────────────────────────────────────────
-dontwarn com.google.dagger.**
-keep class dagger.** { *; }
-keep class javax.inject.** { *; }
-keep class * extends dagger.hilt.android.HiltAndroidApp

# ─── Compose ─────────────────────────────────────────────────────────────────
-keep class androidx.compose.** { *; }
-dontwarn androidx.compose.**

# ─── General Android ─────────────────────────────────────────────────────────
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile

# ─── Kotlinx Serialization (for type-safe Navigation routes) ─────────────────
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepclassmembers @kotlinx.serialization.Serializable class ** {
    *** Companion;
    *** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class ** {
    @kotlinx.serialization.Serializable <fields>;
}
-dontnote kotlinx.serialization.**
-dontwarn kotlinx.serialization.**

# ─── Navigation Compose (type-safe routes) ───────────────────────────────────
-keep class au.gov.immi.cases.navigation.** { *; }
-keepnames class au.gov.immi.cases.navigation.** { *; }

# ─── Vico Charts ─────────────────────────────────────────────────────────────
-keep class com.patrykandpatrick.vico.** { *; }
-dontwarn com.patrykandpatrick.vico.**

# ─── Coil ────────────────────────────────────────────────────────────────────
-keep class io.coil3.** { *; }
-dontwarn io.coil3.**

# ─── Paging 3 ────────────────────────────────────────────────────────────────
-keep class androidx.paging.** { *; }
-dontwarn androidx.paging.**

# ─── DataStore ───────────────────────────────────────────────────────────────
-keep class androidx.datastore.** { *; }
-dontwarn androidx.datastore.**

# ─── IMMI App Models (keep for Moshi reflection) ─────────────────────────────
-keep class au.gov.immi.cases.core.model.** { *; }
-keep class au.gov.immi.cases.data.local.entity.** { *; }
