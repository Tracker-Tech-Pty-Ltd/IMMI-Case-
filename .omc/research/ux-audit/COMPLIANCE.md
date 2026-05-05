# Accessibility Compliance Target — IMMI-Case-

**Decision date**: 2026-05-05
**Decided by**: founder (per Q1 of UX audit open questions)
**Reviewer**: Claude (recommendation), human (ratified)

---

## Primary target

**WCAG 2.2 Level AA** for all user-facing routes in the React SPA at `frontend/src/`.

This is the ship-line. A finding flagged as failing AA blocks merge.

## Why this and not other options

| Option | Why rejected |
|---|---|
| WCAG 2.0 AA | Older than the standard cited by AU's *Disability Discrimination Act 1992* legal interpretations (Maguire v SOCOG); 2.2 is a strict superset adding 9 modern Success Criteria including target-size, drag-movements, focus-not-obscured |
| WCAG 2.2 Level AAA (full) | Brand-incompatible: 1.4.6 Enhanced Contrast 7:1 cannot be achieved while keeping the amber gold `#d4a017` accent against warm off-white `#f5f4f1`; AAA also requires sign-language interpretation for video, beyond a 2-founder runway |
| AS EN 301 549 (full) | Designed for AU government ICT procurement; covers hardware, real-time text, biometric authentication — not applicable to a private React SPA. Its web subset is essentially WCAG 2.1 AA, which 2.2 AA already supersedes |

## Selective AAA criteria adopted

The user population (self-represented immigration applicants under stress, low literacy, second-language English) justifies cherry-picking three AAA criteria where stakes are highest:

| AAA criterion | Scope | Why |
|---|---|---|
| **1.4.6 Contrast (Enhanced)** — 7:1 normal / 4.5:1 large | Apply to primary CTAs only ("Submit application", "Download case", "Save search") | Stressed + low-vision users reading at edge of legibility. NOT applied to icons or decorative elements |
| **2.2.6 Timeouts** — warn ≥20 hr in advance, no silent expiry | Refresh-token expiry (currently 7d) | Slow form-fillers shouldn't lose work. Already mostly compliant; needs explicit warning UI |
| **3.3.5 Help (context-sensitive)** | Form fields in `CaseAddPage`, `CaseEditPage`, search inputs | Non-native English speakers benefit from contextual help. Defer to Sprint 3 — adds significant copy work |

## Out of scope (explicitly NOT pursued)

- AAA 1.2.6 Sign Language (Prerecorded) — no video content
- AAA 1.4.9 Images of Text (No Exception) — design tokens use real text
- AAA 2.1.3 Keyboard (No Exception) — covered by AA 2.1.1 already
- AAA 2.4.10 Section Headings — best-effort, not gate criterion

## Legal / regulatory context

- **AU**: *Disability Discrimination Act 1992* (Cth) — case law (Maguire v SOCOG 1999) established WCAG conformance as a reasonable accommodation benchmark. Failure to provide accessible alternatives can result in AHRC complaints and Federal Court remedies.
- **Privacy Act 1988** + Australian Privacy Principles — separate concern, not covered here.
- **AS EN 301 549** — referenced by some AU government procurement contracts; not applicable to a private SaaS but cited as informative.

## Implementation gates

1. **PR review**: every PR touching UI must include a checklist item: "Verified against WCAG 2.2 AA — see `.omc/research/ux-audit/SUMMARY.md` rubric"
2. **Audit refresh**: re-run `/ultrareview ux-audit` (or equivalent multi-agent audit) before each release; finding count BLOCKING + HIGH must trend down or stay zero
3. **Testing**: any new interactive component must have at minimum:
   - Keyboard-only navigation test (vitest + @testing-library/react user-event)
   - Screen-reader-friendly accessible name (aria-label or visible label association)
   - Focus indication visible against all theme variants (light, dark, custom)

## Open follow-ups

- AAA 2.2.6 timeout warning UI — defer to refresh-token rotation feature (currently 7d silent)
- AAA 3.3.5 contextual help — out-of-scope for current sprint, revisit when adding multilingual UX
- AS EN 301 549 — only re-evaluate if AU government partnership opportunity emerges

---

## Cross-references

- Audit findings rubric: `.omc/research/ux-audit/SUMMARY.md` (severity definitions)
- Per-page audit reports: `.omc/research/ux-audit/D{1-5}-*.md` (designer track) and `A{1-5}-*.md` (a11y track)
- Project gotchas (CLAUDE.md "React Frontend Gotchas") supersede generic best practices when they conflict — those are battle-tested in this codebase
