# LLM Council Worker Migration + Multi-Turn Sessions

**Status**: **PARTIALLY-SHIPPED** — see note below
**Owner**: Developer
**Started**: 2026-04-28
**Driver**: Ralph loop (max 20 iterations) + per-story fresh subagent
**Spec source**: This doc + `.omc/prd.json` (machine-readable acceptance criteria)
**Progress log**: `.omc/progress.txt`

> **PARTIALLY-SHIPPED**: The core goal — Worker-native LLM Council, no Flask/Container
> hop — shipped as `CouncilSessionDO` + `workers/llm-council/` (commits `f25c0fb`,
> `410582a`, `b55886e` for streaming Chairman synthesis, `20e7c6f`/`cdeca95` for
> 6-digit retrieve-code). It differs from this doc's design in two ways: (1) session
> persistence is the `CouncilSessionDO` Durable Object, not "Postgres via Hyperdrive"
> as §2 describes; (2) grounding/RAG retrieval is **D1 FTS5 lexical** (commit
> `93cace7`), not Vectorize semantic — an earlier Vectorize-based attempt (`763ec5f`)
> was deliberately replaced. Flask + `flask-v15`/Hyperdrive referenced in §2's
> "Before" diagram no longer exist in production at all (deleted in `f91f45f`).

---

## 1. Goal

Migrate the LLM Council from the Flask Container (Cloudflare Container DurableObject) into a **pure Cloudflare Worker** path, AND add **multi-turn conversation support** (max 15 turns per session) with **server-side persistence** for reference.

### Why

| Problem today | Effect |
|---|---|
| 4-hop chain: Browser → Worker → DO → Container → CF Gateway | Cold-start 30-60s; DO instance bumping ceremony to refresh image |
| Flask Container is Python + threading + Docker image rebuild on every change | Heavy maintenance vs the actual logic (string-shape JSON munging) |
| Single-shot `/llm-council/run` endpoint, stateless | User can't continue a conversation; can't reference earlier panels |

### After

| Property | New design |
|---|---|
| Path | Browser → Worker → CF Gateway (2 hops) |
| Cold start | 0ms |
| Image quota | N/A (pure JS) |
| Multi-turn | Sessions API, max 15 turns, server stores in Postgres via Hyperdrive |
| Reference | List + open prior sessions, full turn history |

---

## 2. Architecture

### Before (current production)

```
Browser
  └─ POST /api/v1/llm-council/run
     └─ Worker (proxy.js)
        └─ proxyToFlask → DurableObject "flask-v15"
           └─ Container start({env: {...}}) → Flask
              └─ immi_case_downloader/llm_council.py
                 └─ ThreadPoolExecutor: 3 experts parallel
                 └─ Sequential moderator
                 └─ POST CF Gateway compat endpoint
```

### After (target)

```
Browser
  └─ POST /api/v1/llm-council/sessions          (create + first turn)
  └─ POST /api/v1/llm-council/sessions/:id/turns (continue)
  └─ GET  /api/v1/llm-council/sessions          (list)
  └─ GET  /api/v1/llm-council/sessions/:id      (full transcript)
  └─ DELETE /api/v1/llm-council/sessions/:id
     └─ Worker (proxy.js → workers/llm-council/handlers.js)
        └─ Hyperdrive (postgres.js) → Supabase
           └─ council_sessions, council_turns
        └─ Promise.all([openai, gemini_pro, anthropic]) → CF Gateway
        └─ runModerator(opinions, history) → CF Gateway
```

---

## 3. Decisions (locked-in)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Storage | **Supabase Postgres via Hyperdrive** (existing) | Already wired; JSONB for turn payload; FTS available |
| D2 | Conversation context per expert | **B: prior moderator composed_answer history only** | Simulates panel reading meeting summary; saves tokens; avoids expert echo |
| D3 | Auth | **HMAC-signed session token** in `X-Session-Token` header | Reuses `CSRF_SECRET` infra; stateless verification; no user DB |
| D4 | Streaming | **JSON in v1, SSE in v2** | Ship faster; observe real wall-time before adding streaming complexity |
| D5 | Turn cap | **DB CHECK constraint + Worker validation** | `turn_index < 15`; 409 on race; rate-limit binding |
| D6 | Stateless `/run` legacy | **Wrapper around session API, ephemeral, not stored** | Keeps existing UI working until rework lands |
| D7 | Frontend | **Thread UI + sessions sidebar** | ChatGPT-style; new file `LlmCouncilSessionsPage.tsx` |
| D8 | Container LLM cleanup | **Delete after 1-week soak** | Conservative; production parity proven first |
| D9 | Token-budget growth | **v1 unbounded** (max ~82K @ 15 turns; all providers handle) | v2 add `summarize_below_index` after turn 8 if cost spikes |
| D10 | Test framework split | **vitest for Worker JS**; **pytest stays for any leftover Flask code** | Each runtime keeps its native runner |

---

## 4. Test Integrity Rules (NON-NEGOTIABLE)

These rules apply to **every subagent task**. Any subagent that violates them must be rejected.

### 4.1 Evidence standard
- `console.log`, manual inspection, verbal reasoning **DO NOT** count as proof.
- **Only automated test assertions** count.

### 4.2 Mandatory coverage
- Every logic change MUST ship with at least one automated test covering the actual modified behavior.

### 4.3 Anti-false-positive protocol (MUST execute)
1. After writing the test, **force it to fail** (modify expected value or input).
2. Run it; **confirm it goes red**.
3. Restore the correct expected value.
4. Run again; **confirm it goes green**.
5. Commit only after step 4 passes.
6. **If a test passes on first run without the red-green cycle: completion is NOT allowed.**

### 4.4 Forbidden assertion patterns
- `expect(x).toBe(x)` (always-true)
- Tests with no assertions
- Tests that only `console.log`
- Trivial / non-informative checks

### 4.5 Test data integrity
- No hardcoded fake data unrelated to real logic, except clearly labelled fixtures/mocks.
- Mocks must state purpose, scope, and why mocking is required.

### 4.6 Reviewer enforcement
A change is **rejected** if any of:
- Tests cannot fail
- Assertions are weak/meaningless
- No test accompanies a logic change
- Red-green cycle not demonstrated

### 4.7 Guiding principle
> A test that cannot fail is not a test — it is an illusion.

---

## 5. Subagent Dispatch Pattern

For every user story:

1. Lead reads `.omc/prd.json`, picks the highest-priority `passes: false` story.
2. Lead spawns a **fresh subagent** with the story's `subagent_prompt` + Test Integrity Rules verbatim.
3. Subagent does TDD:
   - Write failing test → confirm red → write impl → confirm green
   - Demonstrate red-green cycle in output log
4. Subagent reports: list of files changed, test command, evidence of red-green cycle.
5. Lead spawns a **review subagent** (different from implementer) to verify against acceptance criteria + Test Integrity Rules.
6. On approval: lead marks `passes: true` in `prd.json`, appends to `progress.txt`, commits.
7. On rejection: lead spawns a fresh subagent (NOT the same one) with rejection feedback.
8. Repeat until story passes OR 3 attempts on this story (then escalate to user).

### Subagent tier selection (per story)

- **Schema / SQL migration**: medium (sonnet)
- **Pure JS port (string manipulation, regex)**: medium (sonnet)
- **JS + Postgres integration**: medium (sonnet)
- **Architecture-sensitive (Worker routing, auth)**: opus
- **Frontend hooks + UI**: medium (sonnet)
- **Cleanup / deletion**: haiku

---

## 6. Schema

`supabase/migrations/20260428_council_sessions.sql`:

```sql
-- Multi-turn LLM Council sessions.
-- Persists conversation state for council interactions; enables review/recall.

CREATE TABLE council_sessions (
  session_id   TEXT PRIMARY KEY,                    -- 21-char nanoid
  case_id      TEXT,                                -- optional anchor to immigration_cases
  title        TEXT,                                -- auto-derived from turn 1 user_message
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'complete', 'abandoned')),
  total_turns  INT NOT NULL DEFAULT 0
                 CHECK (total_turns >= 0 AND total_turns <= 15),
  hmac_sig     TEXT NOT NULL,                       -- HMAC-SHA256(session_id, CSRF_SECRET) in base64url
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE council_turns (
  turn_id           TEXT PRIMARY KEY,               -- 21-char nanoid
  session_id        TEXT NOT NULL REFERENCES council_sessions(session_id) ON DELETE CASCADE,
  turn_index        INT NOT NULL
                       CHECK (turn_index >= 0 AND turn_index < 15),
  user_message      TEXT NOT NULL,
  user_case_context TEXT,
  payload           JSONB NOT NULL,                  -- full council response (opinions + moderator)
  retrieved_cases   JSONB,                           -- RAG matches snapshot
  total_tokens      INT,                             -- sum of expert + moderator usage
  total_latency_ms  INT,                             -- end-to-end Worker time
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, turn_index)
);

CREATE INDEX idx_council_turns_session ON council_turns(session_id, turn_index);
CREATE INDEX idx_council_sessions_updated ON council_sessions(updated_at DESC);
```

---

## 7. API Surface

| Endpoint | Method | Body / Header | Returns |
|---|---|---|---|
| `/api/v1/llm-council/sessions` | POST | `{case_id?, message, case_context?}` | `{session_id, session_token, turn, total_turns: 1}` |
| `/api/v1/llm-council/sessions/:id/turns` | POST | `{message}` + `X-Session-Token` | `{turn, total_turns}` |
| `/api/v1/llm-council/sessions/:id` | GET | `X-Session-Token` | `{session, turns: [...]}` |
| `/api/v1/llm-council/sessions` | GET | `?limit=20&before=ts` | `{sessions: [...]}` |
| `/api/v1/llm-council/sessions/:id` | DELETE | `X-Session-Token` | `{deleted: true}` |
| `/api/v1/llm-council/run` (legacy) | POST | `{question, case_id?, context?}` | unchanged shape |
| `/api/v1/llm-council/health` | GET | `?live=1` | unchanged |

### Session token mechanism
```js
// Worker emits at session creation
const sig = await hmac(env.CSRF_SECRET, session_id);  // HMAC-SHA256
const session_token = base64url(sig);

// Worker validates on every subsequent request
const expected = await hmac(env.CSRF_SECRET, session_id);
if (!timingSafeEqual(decoded_token, expected)) return 403;
```

Stateless: no DB lookup needed for auth; token survives across Worker invocations.

---

## 8. Phase Plan (13 user stories — see `.omc/prd.json` for machine-readable)

### Phase 0 — Schema (S1)

- **US-001**: Create migration `supabase/migrations/20260428_council_sessions.sql`. Apply via `make migrate` or `supabase db push`. Verify tables exist via `psql` (or supabase MCP). Add a Python pytest that connects via `SupabaseRepository` and inserts a fake session/turn, then deletes — proving CRUD works against the actual deployed schema.

### Phase 1 — Worker LLM Council Runner (S2-S4)

- **US-002**: `workers/llm-council/runner-helpers.js` — port pure utility helpers (`_normalizeGatewayModel`, `_extractChatCompletionText`, `_stripReasoningArtifacts`, `_repairTruncatedJson`, `_extractFirstJsonObject`). vitest unit tests for each. Red-green cycle MUST be demonstrated.

- **US-003**: `workers/llm-council/runner.js` — port `_gateway_chat_completion` (with gpt-5 param remap), `_run_gateway_expert`, `runCouncil({question, caseContext, history})`. Adds `buildHistoryMessages(prevTurns)` to inject prior `[{user, assistant}]` pairs into expert + moderator prompts (decision D2). vitest with mocked `fetch`.

- **US-004**: `workers/llm-council/storage.js` — `postgres` package CRUD against Hyperdrive: `createSession`, `addTurn` (enforces turn_index UNIQUE, race-safe via `INSERT ... ON CONFLICT DO NOTHING RETURNING`), `getSession`, `listSessions`, `deleteSession`, `loadHistory(session_id, limit=15)`. vitest with mocked SQL.

### Phase 2 — API endpoints (S5-S7)

- **US-005**: `workers/llm-council/auth.js` — HMAC-SHA256 session token mint + verify (`mintToken`, `verifyToken`). vitest including red-green test for tampered token rejection.

- **US-006**: `workers/llm-council/handlers.js` — 5 endpoint handlers (`handleCreateSession`, `handleAddTurn`, `handleGetSession`, `handleListSessions`, `handleDeleteSession`) + legacy `/run` wrapper. Each handler: parse → validate → auth → DB read → call `runCouncil` → DB write → JSON response. vitest integration tests with mocked Hyperdrive.

- **US-007**: Wire handlers into `workers/proxy.js` router. Path matching for `/api/v1/llm-council/*` BEFORE `proxyToFlask`. Run `wrangler deploy --dry-run` and `tsc --noEmit` (if applicable). Manual `curl` against `wrangler dev` proves all 5 endpoints + legacy /run respond.

### Phase 3 — Frontend (S8-S11)

- **US-008**: `frontend/src/lib/api-llm-council.ts` — TypeScript types for `Session`, `SessionList`, `Turn`. Functions `createSession`, `addTurn`, `getSession`, `listSessions`, `deleteSession`. vitest tests with mocked fetch.

- **US-009**: `frontend/src/hooks/use-llm-council-sessions.ts` — TanStack Query hooks: `useLlmCouncilSession(sessionId)`, `useLlmCouncilSessions()`, `useCreateSession`, `useAddTurn`, `useDeleteSession`. vitest.

- **US-010**: Rework `frontend/src/pages/LlmCouncilPage.tsx` — render thread of turns (vertical scroll), input box at bottom, "Turn N/15" indicator. Disable input when total_turns >= 15. Existing tests updated; **red-green cycle on every modified assertion**.

- **US-011**: New `frontend/src/pages/LlmCouncilSessionsPage.tsx` — sidebar list of sessions with title, total_turns, updated_at. Click → opens `/llm-council/sessions/:id`. Wire route in `App.tsx` + `prefetch.ts`. vitest.

### Phase 4 — Production verification (S12)

- **US-012**: Deploy to production (commit + push, GHA triggers). Run automated **browser visual test** via `mcp__plugin_everything-claude-code_playwright__*` tools against `https://immi.trackit.today`. Test flow:
   1. Navigate to LLM Council page.
   2. Create new session, send first message ("What are the strongest grounds for jurisdictional review?").
   3. Wait for council response (max 90s). Take screenshot of turn 1.
   4. Reload page; navigate via sessions sidebar; verify session restored with turn 1 visible.
   5. Send second message ("How does s.424A interact with these grounds?"). Take screenshot of turn 2.
   6. Click delete on session; verify it disappears from sidebar.
   7. Compare screenshots for visual regressions (no broken layout, no console errors).
   - Must pass before declaring complete.

### Phase 5 — Cleanup (S13)

- **US-013**: Remove `immi_case_downloader/llm_council.py`, the Flask `/llm-council/*` handlers in `api_pipeline.py`, the matching tests. Drop Container env-var forwarding for `LLM_COUNCIL_*` (keep `CF_AIG_TOKEN` for Worker only). 1-week soak preceded this — only run AFTER prod has been green for 7 days.

---

## 9. Ralph Iteration Rules

- Max **20 iterations** total across all stories.
- Per-story budget: **3 attempts** (subagent + review). 4th attempt = escalate to user.
- After every story passes: commit with conventional commit message + push (no force-push).
- Reviewer subagent must be **different agent type** from implementer.
- If 3 stories in a row fail review on same root cause: STOP and report the systemic issue.
- **Browser visual test (US-012) is the FINAL gate** before declaring "ralph done".
- Test integrity violations (Section 4) cause IMMEDIATE story re-attempt with fresh subagent.

---

## 10. Risk Register

| Risk | Trigger | Mitigation |
|---|---|---|
| Browser timeout @ turn 10+ | claude-sonnet-4-6 + 70K context = 90s+ | v1 accept (UI shows "1-2 min wait"); v2 SSE streaming |
| Token blowup turn 12+ | 70K input × $/MTok | v1 monitor; v2 add summarize_below_index after turn 8 |
| Concurrent turn race | User double-click "send" | DB UNIQUE (session_id, turn_index) → 409 + retry-after |
| Half-completed turn | LLM fails mid-call | INSERT happens AFTER moderator success; expert errors return without DB write |
| Session token leak | Log accidentally captures `X-Session-Token` | Logging redacts header; rotate `CSRF_SECRET` if leaked |
| Cost spike | LLM goes wild | Wrangler `[[unsafe.bindings]] RL_COUNCIL_TURN` rate limit (30/min/IP) |

---

## 11. Definition of Done

- [ ] All 13 stories `passes: true` in `.omc/prd.json`
- [ ] All vitest + pytest test suites pass on CI
- [ ] `/oh-my-claudecode:cancel` clean exit (no residual state)
- [ ] Production probe `curl -X POST https://immi.trackit.today/api/v1/llm-council/sessions -d '...'` returns 200 with valid turn
- [ ] Browser visual test (US-012) screenshots show 3-turn conversation + sessions sidebar
- [ ] Container LLM code removed (US-013)
- [ ] `progress.txt` records every story completion + key learnings

---

## 12. Multi-Session Handoff

**This document + `.omc/prd.json` + `.omc/progress.txt` are the only state needed to resume.**

Any future session opens by:
1. Reading `.omc/prd.json` to find next `passes: false` story
2. Reading `.omc/progress.txt` for prior learnings
3. Running `/oh-my-claudecode:ralph` (or this skill) to continue

No conversation context required. The plan is self-contained.
