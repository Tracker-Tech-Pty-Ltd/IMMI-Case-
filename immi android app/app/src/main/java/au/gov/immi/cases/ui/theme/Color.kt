package au.gov.immi.cases.ui.theme

import androidx.compose.ui.graphics.Color

// All color constants are defined in DesignTokens.kt.
// This file re-exports the primary palette for backward-compat with any
// existing imports that reference these top-level names.

// ── Outcome Semantic Colors (unchanged — matches webapp OutcomeBadge logic) ──
val OutcomeGranted   = Color(0xFF22c55e)
val OutcomeAllowed   = Color(0xFF3b82f6)
val OutcomeAffirmed  = Color(0xFF64748b)
val OutcomeDismissed = Color(0xFFef4444)
val OutcomeRemitted  = Color(0xFF8b5cf6)
val OutcomeSetAside  = Color(0xFFf59e0b)
val OutcomeRefused   = Color(0xFFdc2626)
val OutcomeWithdrawn = Color(0xFF94a3b8)
val OutcomeQuashed   = Color(0xFF06b6d4)
val OutcomeVaried    = Color(0xFFa855f7)
