package au.gov.immi.cases.di

import au.gov.immi.cases.data.repository.AnalyticsRepository
import au.gov.immi.cases.data.repository.AnalyticsRepositoryImpl
import au.gov.immi.cases.data.repository.CasesRepository
import au.gov.immi.cases.data.repository.CasesRepositoryImpl
import au.gov.immi.cases.data.repository.LegislationsRepository
import au.gov.immi.cases.data.repository.LegislationsRepositoryImpl
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Hilt DI Module — Repository interface → implementation bindings.
 *
 * [CasesRepository] is bound to [CasesRepositoryImpl] as a singleton.
 * [AnalyticsRepository] is bound to [AnalyticsRepositoryImpl] as a singleton.
 * [LegislationsRepository] is bound to [LegislationsRepositoryImpl] as a singleton.
 */
@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindCasesRepository(impl: CasesRepositoryImpl): CasesRepository

    @Binds
    @Singleton
    abstract fun bindAnalyticsRepository(impl: AnalyticsRepositoryImpl): AnalyticsRepository

    @Binds
    @Singleton
    abstract fun bindLegislationsRepository(impl: LegislationsRepositoryImpl): LegislationsRepository
}
