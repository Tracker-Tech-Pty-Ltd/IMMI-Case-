# Ralplan Consensus — Pending LLM Council & Pipeline Work
**Date**: 2026-05-10
**Status**: **PARTIALLY-SHIPPED** — see per-slice note below
**Scope**: E (RAG) · F (Streaming Chairman) · H (Mobile/iOS) · I (AustLII pipeline)

> **PARTIALLY-SHIPPED** (verified against git log 2026-08-23):
> - **Slice F** (Streaming Chairman) — SHIPPED: commit `b55886e` "streaming Chairman
>   synthesis (Slice F Phase 1)".
> - **Slice E** (RAG) — SHIPPED IN A DIFFERENT FORM: Council grounding shipped, but as
>   D1 FTS5 lexical retrieval (commit `93cace7`), not the Supabase-pgvector-via-Hyperdrive
>   + BGE-embedding design in this doc's §Slice E. An intermediate Vectorize-based
>   attempt (`763ec5f`) was tried first, then deliberately replaced.
> - **Slice I** (AustLII pipeline) — see `.omc/plans/biweekly-cloud-extraction-pipeline.md`
>   status header: SUPERSEDED — shipped as an external VPS crawler + `CRAWLER_WRITE_TOKEN`
>   (commit `abe5b02`), not the Opt-D Flask-container-DO design that doc recommended.
> - **Slice H** (Mobile/iOS) — SHIPPED in this uncommitted working-tree change (no commit
>   yet): haptic feedback on send/recall-code-copy/restore success, a swipe-to-send
>   handle, and an iOS keyboard hint are all wired in. Note: `MessageInput` lives inline
>   inside `frontend/src/pages/LlmCouncilPage.tsx`, not as the standalone
>   `frontend/src/components/llm-council/MessageInput.tsx` file this doc's §Slice H
>   names — it has always lived in the page file; follow current code over the plan.

---

## Why this plan exists

After Task A (grounding chips) and Task C (6-digit retrieve code) shipped end-to-end,
four independent feature streams remain from the user's original 7-task ask. Combined
estimate ≈ 20-30h of work. Single autopilot run cannot ship them all without context
truncation. This plan decomposes each into a self-contained ship-able slice with
explicit dependencies, decisions, and ship order.

Per `~/.claude/rules/ccg-prompt-budget.md` rule 1 ("≤ 3 sub-questions per call"),
this plan is the upstream artifact the operator can /autopilot one slice at a time.

---

## Caller surface (for fact-forcing gates)

This plan file is consumed by:
- The operator (review + pick-first decisions)
- Future `/oh-my-claudecode:autopilot` invocations (skill auto-detects `.omc/plans/ralplan-*.md` and skips Phase 0+1)

No code imports this file. No DB writes.

---

## Slice F — Streaming Chairman synthesis (RECOMMENDED FIRST SHIP)

**ROI**: ⭐⭐⭐⭐⭐ — biggest UX win per hour (~3-4h work, eliminates the "synthesis lag" black-box feeling that currently sits between expert.done and council.done).

### Current state (verified 2026-05-10)
- `workers/llm-council/runner.js:1832-1837` — moderator runs **non-streamed**:
  ```js
  await send("moderator.start", { model: geminiFlashModel });
  const moderator = await runModerator({ env, opinions, question, ... });
  await send("moderator.complete", moderator);
  ```
- 14-field JSON synthesis takes ~10-25s wall-clock; UI shows "synthesising 14-field judgment…" idle spinner the whole time.
- Frontend `StreamingCouncilView.tsx:303-309` only handles `moderator.start` / `moderator.complete` — no delta path.

### Target state
- Add `streamModerator()` to `runner.js` mirroring `streamGatewayChatCompletion` shape (Gemini 2.5 Flash via compat with `stream=true`).
- runner emits `moderator.delta` SSE events as the JSON streams in.
- Frontend buffers deltas + **best-effort partial JSON parse** to reveal `composed_answer` field as it lands (typically the first ~30% of the stream); other fields fill in progressively.
- Final `moderator.complete` event still fires with the full validated JSON for the existing renderer.

### Files touched (estimate)
| File | Change | Risk |
|---|---|---|
| `workers/llm-council/runner.js` | `+streamModerator()` (~80 LOC), modify the existing `await runModerator()` call site | Medium — JSON streaming shape needs care; reuse existing `runModerator` parsing as fallback |
| `workers/llm-council/handlers.js` | None — `streamCouncil` work-promise unchanged | — |
| `frontend/src/components/llm-council/StreamingCouncilView.tsx` | Add `moderator.delta` handler + partial-JSON renderer (~50 LOC) | Low |
| `workers/__tests__/llm-council-runner.test.js` | New test: streamModerator yields deltas + completes | Low |

### Decisions needed
- **D1 — Partial JSON parser**: use `partial-json` npm package (well-maintained, 5KB) OR roll our own forgiving parser? **Recommend npm pkg** to avoid edge cases (escaped quotes, nested objects).
- **D2 — Delta event shape**: emit raw token chunks `{text}` OR pre-parsed field updates `{field, value}`? **Recommend raw `{text}`** — frontend handles parsing once with full context vs. backend doing it 100× per stream.

### Ship plan
1. Add `streamModerator` + tests
2. Wire into `streamCouncil` (replace non-streamed call)
3. Frontend partial-parse + render
4. Smoke prod, commit, push, verify
5. ~3-4h end-to-end · single commit · DO bump may be needed if SPA bundle changes

---

## Slice E — RAG with case_embeddings (SECOND SHIP)

**ROI**: ⭐⭐⭐⭐ — high quality lift but requires upstream decisions.

### Current state
- `case_embeddings` table exists per `supabase/migrations/20260223103000_add_pgvector_embeddings.sql`
- `backfill_case_embeddings.py` exists but uses OpenAI embeddings (`text-embedding-3-small`, 1536 dims). User's stated preference: Workers AI BGE.
- `runCouncil` currently passes `prevTurns` history but no case context.
- Frontend `case_id` field is captured but only passed as text hint, not as RAG anchor.

### Target state
- Worker uses `@cf/baai/bge-base-en-v1.5` (768 dims) via Cloudflare Workers AI binding for query embedding (sub-100ms, $0.011/M tokens vs. OpenAI $0.02/M).
- New worker storage `findPrecedents(env, queryText, opts={topK, threshold})` queries Supabase pgvector via Hyperdrive: `SELECT case_id, citation, similarity FROM case_embeddings ORDER BY embedding <=> $1 LIMIT $topK`.
- `runCouncil` and `streamCouncil` accept new param `precedents` (top-K hits) and inject them into the system prompt as "Relevant precedents from our case database:".
- Frontend captures `top_k` + `threshold` decision once at config level; no per-request UI.

### Files touched
| File | Change | Risk |
|---|---|---|
| `wrangler.toml` | Add `[[ai]] binding = "AI"` | Low — additive |
| `workers/llm-council/storage.js` | `+findPrecedents()` (~40 LOC) | Low — read-only SELECT |
| `workers/llm-council/runner.js` | Inject precedents into system prompt; new helper `embedQuery(env, text)` | Medium — prompt engineering needs iteration |
| `workers/llm-council/handlers.js` | `handleCreateSession` + `handleStreamCouncil` call findPrecedents before runCouncil | Low |
| Migration | NONE — table already exists with pgvector + HNSW dropped per `20260226040000` (need to re-add for prod query speed) | **High — re-adding HNSW on 149K rows takes ~30 min, locks table** |

### Decisions needed
- **D3 — top_K**: 3, 5, or 10? **Recommend 5** (fits cleanly in system prompt, ~2K extra tokens at 400 chars/precedent).
- **D4 — similarity threshold**: 0.6, 0.7, 0.75? **Recommend 0.7** — tight enough to avoid noise, loose enough to surface adjacent fact patterns.
- **D5 — Embedding dim mismatch**: existing `case_embeddings.embedding` is `vector(1536)` (OpenAI). Must either (a) re-embed all 149K rows with BGE (768 dim, ~2h Workers AI cost ~$2-4) → schema change `vector(768)` OR (b) keep OpenAI embeddings and pay for query-time OpenAI calls. **Recommend (a) — owner cost long-term lower**.
- **D6 — HNSW re-creation maintenance window**: pick a 1h window when site traffic is low (AU evening / US night).

### Ship plan
1. Operator confirms D3-D6
2. Re-embed (background script, ~2h)
3. Re-add HNSW index (maintenance window)
4. Worker code (1 commit)
5. Prompt iteration + smoke (1 commit if needed)
6. ~5-7h spread over 1-2 days · multi-commit · DO bump may be needed

---

## Slice H — Mobile/iOS optimisations (THIRD SHIP)

**ROI**: ⭐⭐⭐ — meaningful UX polish for mobile users; no architectural risk.

### Current state
- LlmCouncilPage uses `Cmd+Enter` (macOS) and `Ctrl+Enter` (Windows) to send. iOS Safari does NOT recognize these — physical keyboards on iPad work, on-screen keyboard does not. No fallback.
- `MessageInput` component is a vanilla `<textarea>` — no swipe gestures.
- No haptic feedback on action buttons (`navigator.vibrate` available but unused).

### Target state
- iOS-aware keyboard hint: detect iOS via `navigator.userAgent`, show inline "Tap Send button (no Cmd+Enter on iOS)" hint inside the input on iOS.
- Optional swipe-to-send: when message length > 5 chars, show a right-anchored arrow button that animates on swipe-right gesture (`framer-motion` or react-use-gesture).
- Haptic taps via `navigator.vibrate(20)` on (a) Send button click, (b) recall code copy success, (c) restore success. Wrap in feature-detect.

### Files touched
| File | Change | Risk |
|---|---|---|
| `frontend/src/components/llm-council/MessageInput.tsx` | iOS hint + optional swipe handler | Low |
| `frontend/src/lib/council-celebrations.ts` | Add `playHaptic(pattern)` helper | Low |
| `frontend/src/components/llm-council/StreamingCouncilView.tsx` | Wire haptic into copy success | Low |
| `frontend/src/pages/LlmCouncilPage.tsx` | Wire haptic into restore success | Low |

### Decisions needed
- **D7 — Swipe gesture lib**: `react-use-gesture` (10KB, mature) vs. roll-our-own touch event handler. **Recommend roll-our-own** for swipe-to-send — single gesture, ~30 LOC, avoid dep.

### Ship plan
1. Real-device testing required (operator iPhone or simulator)
2. Single commit, ~2-3h, DO bump needed (frontend-only commit pattern)

---

## Slice I — AustLII full-text scraping upgrade (LAST SHIP, BIGGEST)

**ROI**: ⭐⭐⭐⭐ — strategic data quality lift; biggest scope, most decisions.

### Current state
- Plan exists at `.omc/plans/biweekly-cloud-extraction-pipeline.md` (iteration #3, comprehensive)
- 7 of 8 open questions resolved per file inspection:
  - ✅ Q1 — Gemma 4 26B via AI Gateway compat
  - ✅ Q2a — $5/run + $10/month hard cap
  - ✅ Q2b — Discord webhook (operator action: generate webhook + `wrangler secret put ALERT_DISCORD_WEBHOOK_URL`)
  - ✅ Q3 — 10 weeks biweekly soak
  - ✅ Q4 — operator self-labels 100-fixture set
  - ✅ Q5 — 14 fields MANDATORY (Opt-A removed)
  - ✅ Q6 — scaffold removed
  - ⏳ Discovery sanity-gate baseline — needs operator review of bootstrapped p90 values

### Target state — see `biweekly-cloud-extraction-pipeline.md` (already detailed)

### Decisions needed (only the unresolved ones)
- **D8** — Operator generates Discord webhook URL + sets `ALERT_DISCORD_WEBHOOK_URL` Wrangler secret
- **D9** — Operator runs `scripts/bootstrap_baselines.py` and reviews p90 thresholds before P1 enable
- **D10** — Federal Court direct-fetch ADR: continue AustLII mirror only? Or open follow-up ADR for direct fetch? **Recommend defer** — AustLII mirror works; direct fetch is contingency.

### Ship plan
- Already in `biweekly-cloud-extraction-pipeline.md` — multi-phase, 10-15h total
- Should NOT be tackled until F + E shipped (they consume the same Worker stack and we want stable streaming first)

---

## Recommended ship order

```
F (Streaming Chairman, ~3-4h, single context)
  ↓
H (Mobile/iOS polish, ~2-3h, single context, real-device test)
  ↓
E (RAG, ~5-7h, multi-day — re-embed batch is overnight)
  ↓
I (AustLII pipeline, ~10-15h, see existing plan)
```

**Rationale**:
- F first: highest ROI per hour, contained to runner.js + StreamingCouncilView, no decisions needed beyond D1+D2.
- H second: simplest tech, requires real-device testing window (operator schedules).
- E third: biggest decision surface (D3-D6) + overnight re-embed → batch with another sprint.
- I last: depends on Discord webhook setup AND bootstrap_baselines review; biggest scope; existing plan already detailed.

---

## Operator decision matrix (collect once, ship multiple)

| ID | Question | Recommend | Operator answer |
|----|----------|-----------|-----------------|
| D1 | Partial-JSON parser | `partial-json` npm pkg | __ |
| D2 | Moderator delta event shape | raw `{text}` | __ |
| D3 | RAG top_K | 5 | __ |
| D4 | Similarity threshold | 0.7 | __ |
| D5 | Embedding dim | re-embed at 768 (BGE) | __ |
| D6 | HNSW maintenance window | __ (operator picks) | __ |
| D7 | Swipe gesture | roll-our-own | __ |
| D8 | Discord webhook URL | __ (operator generates) | __ |
| D9 | bootstrap_baselines.py p90 review | __ (operator runs + reviews) | __ |
| D10 | Federal Court direct-fetch ADR | defer | __ |

Once D1+D2 are answered, F can ship immediately via `/oh-my-claudecode:autopilot ship Slice F`.
