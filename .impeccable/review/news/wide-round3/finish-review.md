# Wide news finish review — 2026-10-16

Disposition: ship. Reviewer: /root/impeccable_wide_finish_reviewer, fresh-context review.

Scope: the single reviewer-requested CSS correction batch, not a claim that the entire repository is regression-free.

- Single responsive scale: resolved. Restored canonical rem rules and applied news-desktop-only clamp(100%, calc(100vw * 16 / 1127), 150%).
- Original positional relationships: resolved. No transform, zoom or isolated title/document offsets.
- Keep: resolved. Legal Codex palette, fonts, all 60 active stickers, four preserved core files, bilingual complete text, source dates/links, summaries, direct pagination, mobile disclosure and theme animation retained.

Fidelity: actual CSS viewport 1440 x 1400, uniformly normalized capture 1440 x 1399, 80.31% match. All 19 regions match/drift; none missing/contradicted. Reference, spec and thresholds unchanged; responsive phase actually advanced with forced:null.

Reviewed actual images: hero (1127), width-1280, desktop (1440), width-1600, english-dark, mobile-full (390). 1280/1600 are visual and interaction regressions, not claims of separate mechanical gates. Extra proportional-1440 viewport is diagnostic only and does not replace the complete tall capture.

Evidence: diff-tall/report.json; asset-preservation.json (60/60 unchanged); preserved.json (4/4 unchanged); functional-checks.json. Parent independently opened normalized final desktop, 1127, 1280, 1600, English dark and mobile, plus side-by-side and three worst region pairs.

Tests: 763 frontend tests passed; 16 focused tests passed; build successful. Additional existing browser suite: 113 passed / 1 failed, reproduced. The legacy drawer-close assertion checks immediately after clicking, before exit animation is complete. Actual UI waitFor hidden check passes. Test files and animation were not modified; do not describe that suite as all green.

No further UI builder round needed. Finish documentation and preserve unsuccessful round evidence.
