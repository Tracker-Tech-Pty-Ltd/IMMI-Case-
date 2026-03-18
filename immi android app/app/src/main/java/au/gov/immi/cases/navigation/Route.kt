package au.gov.immi.cases.navigation

import kotlinx.serialization.Serializable

// ── Top-level destinations (Bottom Nav + Drawer) ──────────────────────────

@Serializable object Dashboard
@Serializable object Cases
@Serializable object Search
@Serializable object Analytics
@Serializable object Legislations
@Serializable object Settings

// ── Cases sub-routes ──────────────────────────────────────────────────────

@Serializable data class CaseDetail(val caseId: String)
@Serializable data class CaseEdit(val caseId: String)
@Serializable object CaseAdd
@Serializable data class CaseCompare(val caseId1: String, val caseId2: String)

// ── Collections ────────────────────────────────────────────────────────────

@Serializable object Collections
@Serializable data class CollectionDetail(val collectionId: Long)

// ── Search sub-routes ──────────────────────────────────────────────────────

@Serializable object SemanticSearch
@Serializable object GuidedSearch
@Serializable object SavedSearches
@Serializable object SearchTaxonomy

// ── Analytics sub-routes ──────────────────────────────────────────────────

@Serializable object JudgeProfiles
@Serializable data class JudgeDetail(val judgeName: String)
@Serializable data class JudgeCompare(val judgeNames: String)  // comma-separated

@Serializable object CourtLineage

// ── Legislations sub-routes ───────────────────────────────────────────────

@Serializable data class LegislationDetail(val legislationId: String)

// ── System pages ───────────────────────────────────────────────────────────

@Serializable object Download
@Serializable object JobStatus
@Serializable object Pipeline
@Serializable object LlmCouncil
@Serializable object DataDictionary
