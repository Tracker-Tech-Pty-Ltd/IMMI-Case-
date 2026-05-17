# Biweekly Cloudflare-Native Case Extraction Pipeline

**Status:** APPROVED — iter #2 consensus + iter #3 (Gemma 4 verified, Browser Rendering Tier-2) + iter #4 (Discord alerts, $10/mo hard cap, soak α locked, 14-field mandatory — Opt-A removed as fallback). All 5 user open questions Q1–Q5 RESOLVED 2026-05-10. Ready for execution via `/oh-my-claudecode:team` or `/oh-my-claudecode:ralph`.
**Owner:** Planner
**Last revised:** 2026-05-10
**Risk class:** HIGH (writes to prod `immigration_cases`, ~149K rows, autonomous, biweekly)
**Scope statement:** Delivers **discovery + scrape + extraction + idempotent upsert** of new AustLII cases on a biweekly cron. The user's prompt mentioned "data-cleaning" and "data-mining"; this plan delivers (a) bounded extraction-time cleaning (insert-only + audit log + allow-list) and (b) the foundation telemetry that data-mining work would consume. **Out-of-scope, deferred to follow-up ADRs:** post-extraction analytics jobs, retro-cleanup of historical 149K rows beyond extraction touchpoints, and the post-soak null-fill flip (which carries CLAUDE.md 2026-05-02 cleanup-rule obligations: column-level snapshot + dry-run + ground-truth eyeball — repeated in §C Follow-ups).

---

## Section A — RALPLAN-DR Summary

### A.1 Principles (5)

1. **Cost discipline** — every LLM call gated by per-call token cap + per-run USD ceiling enforced by a strongly-consistent Durable Object (KV is too lagged for cap correctness under `max_concurrency=4`); AI Gateway analytics are the secondary source of truth for spend.
2. **Idempotency / replay safety** — re-running the same biweekly window is a no-op. `case_id` (12-char SHA-256 prefix of normalized citation+url, **title dropped**) is the merge key; `ON CONFLICT DO UPDATE` only touches a strict allow-list, with intra-run COALESCE-style null-fill so racing scrape→extract messages can't lose late-arriving fields.
3. **Isolation from prod read path** — discovery Worker uses dedicated `HYPERDRIVE_SERVICE` binding (service-role); extraction inherits the Flask container's existing service-role pool (Opt-D runs Python in `flask-v22` DO, not in a separate Worker). Both are isolated from the `proxy.js` user-pool binding by environment + secret rotation. Cron failures must not degrade `immi.trackit.today`.
4. **Observability-first** — no handler ships without `pipeline_runs` row + structured `console.log({event,...})`. DLQ growth, zero-discovery (only counted on biweekly ticks to avoid off-week false-pages), schema drift, and cost-cap hits page the operator before users notice.
5. **Reversibility** — single env var (`PIPELINE_ENABLED=false`) disables the cron without redeploy AND short-circuits in-flight queue messages at message-handle time. Every bulk write has an `extraction_audit` row plus a documented `rollback_run.ts` script that can reverse upserts by `run_id` using `extraction_audit.old_value`.

### A.2 Decision Drivers (top 4)

1. **Biweekly latency tolerance is loose (hours, not seconds).** A run can take 1–4 h; we optimise for cost + safety, not throughput.
2. **LLM $/case budget.** Target **≤ USD $0.002/case extracted** (regex first, LLM only for unfilled fields), per-run hard cap **USD $5** before auto-abort. Estimated 1,500 cases/biweek across 9 courts → run budget ≈ $3.
3. **Blast radius of a bad run.** Worst case = silent corruption of prod `immigration_cases` (149K rows). Mitigation must be staging-first + audit log + reversible rollback script.
4. **Feature parity vs porting cost (NEW).** The existing Python pipeline extracts **14 fields** with documented fill rates (CLAUDE.md: applicant_name 90%, visa_subclass 91.6%, hearing_date 78.7%, country 67.8%, is_represented 42.4%, representative 25.1%, etc). Any port that ships **8 fields is a feature regression**. The user must explicitly accept that regression (Q5) — otherwise Opt-D (container-Python in `flask-v22` DO) is the parity-preserving path and Opt-A becomes the regression path.

### A.3 Viable Options

#### Opt-A — Worker-native everything (TS port of regex + LLM in Worker)

- Cron in `workers/austlii-scraper/` `scheduled()` → discovery via fixed-lookback window → existing `austlii-scrape-queue` (Tier-1 HTTP fetch) with **Tier-2 Browser Rendering fallback on 5× consecutive 410/403** → R2 raw HTML → new `austlii-extract-queue` → TS regex extractor (port of subset of `extract_structured_fields.py`) → AI Gateway routing `workers-ai/@cf/google/gemma-4-26b-a4b-it` (256K context, $0.10 in / $0.30 out per M tokens — verified Cloudflare Workers AI 2026-04-04) for unfilled fields → upsert via Hyperdrive → `pipeline_runs`.
- **Pros:** Fully cloud, narrow blast radius (single Worker family), reuses Queue/R2/DLQ, AI Gateway gives unified billing, per-run state lives entirely in R2 + Postgres + DO.
- **Cons:** ~600 LOC TS port, **8-field regression vs 14-field Python**, ≈4-week parity soak burn, Worker 30s CPU cap forces small batches (5/msg), debugging Worker-scheduled handlers harder than local Python.
- **Cost (est):** Workers ≈ $0/run within Paid plan, R2 negligible, AI Gateway ~$3/run (1,500×$0.002), Hyperdrive included.
- **Effort:** **6.5–8 days** core ENG.

#### Opt-B — Cloudflare cron triggers GitHub Actions on Mac Mini

- CF cron → GitHub webhook → self-hosted Mac Mini runs existing Python pipeline.
- **Pros:** Zero porting work, full 14-field parity, easiest debugging.
- **Cons:** **Violates user's explicit "on the cloud" requirement.** Mac Mini SPOF (offline = silent missed cycle).
- **Decision:** **Rejected** as primary; documented as emergency fallback runbook only.

#### Opt-C — Hybrid: cloud discovery + scrape, Mac Mini extraction

- CF cron + scrape Worker → R2 raw → GitHub Action polls R2 → Python extractor → upsert.
- **Pros:** CF egress IPs handle scrape rate-limits; full Python parity for extraction.
- **Cons:** Two systems, webhook-vs-poll race, Mac Mini SPOF for the extract step, partial cloud coverage.
- **Decision:** **Rejected** as destination. Acceptable as 2-week interim if Opt-D rollout slips.

#### Opt-D — Container-Python in `flask-v22` Durable Object (NEW, RECOMMENDED)

- Cron in `workers/austlii-scraper/` `scheduled()` → discovery (cheap Worker SQL via Hyperdrive — same shape as Opt-A P1) → enqueues to existing `austlii-scrape-queue` → R2 raw → **new endpoint** `POST /internal/extract` on the existing `flask-v22` DO container runs unmodified `extract_structured_fields_llm.py` against a batch of R2 keys → returns extracted JSON → Worker upserts via Hyperdrive service-role binding (same allow-list, same audit log as Opt-A) → `pipeline_runs`. LLM still routes through `CF_AIG_TOKEN` AI Gateway (Python uses the same gateway URL).
- **Pros:**
  - **Zero porting work**: reuses 1,136 LOC of battle-tested Python, preserves all 14 fields with documented fill rates.
  - **No 4-week parity soak burn** — golden fixtures still run, but for regression detection not initial parity sign-off.
  - Container runs in `oc` (Oceania) by binding location, same as Flask reads — no new infra geography.
  - LLM cost path unchanged (same AI Gateway slug; we still introduce dedicated `immi-extract` slug).
  - Idempotent upsert + audit + insert-only soak rules apply identically (the Worker still owns DB writes; Python only returns JSON).
  - Falls back trivially: if container is unhealthy on a tick, Worker logs + retries next cron — no DLQ poisoning.
- **Cons:**
  - DO container cold-start cost on first cron tick (~5–15s observed in current Flask path). Mitigation: discovery enqueues to queue first, extract calls hit warm container 5+ minutes later.
  - Single container instance is a serial bottleneck — but biweekly volume of 1,500 cases at ~2s/case via batch ≈ 50 minutes, within tolerance.
  - Container memory must hold extraction batch — current Flask container handles full SPA + write path so 100-case batches are well within budget; verify via P0 smoke test.
  - LLM Council and extract share container CPU — soft contention; mitigate by setting `max_concurrency=1` on the EXTRACT_QUEUE consumer (one Worker→container batch at a time) plus `batch_size=50`. Bounds user-read p95 degradation to a ≤6s window per ~100s cron batch (verified by `tests/load/cron-with-user-traffic.test.ts`, §A.5).
- **Cost (est):** Container ≈ same (already running for Flask), AI Gateway ~$3/run (no change vs Opt-A), Hyperdrive included.
- **Effort:** **1.5–2 days** core ENG (Worker cron + discovery + queue wiring + container endpoint + tests). Saves ~5 days vs Opt-A.

#### Invalidation & chosen-option rationale

- **Opt-B rejected**: violates "on the cloud" requirement; Mac Mini SPOF.
- **Opt-C rejected as destination**: same cloud-coverage objection as B; useful only as 2-week interim.
- **Opt-A vs Opt-D**: Opt-D wins on (i) feature parity (14 vs 8 fields — the user's prompt asked for "data-cleaning + data-mining" which presupposes the full field surface), (ii) ENG hours (~1.5 vs ~7 days), (iii) operational risk (no porting bugs to soak out). Opt-A's only structural advantage is "smaller blast radius if container goes down" — but the container ALREADY owns the read+write Flask path; if it dies, the site is degraded regardless. Opt-A would only beat Opt-D if (a) DO container cold-start exceeded the 30s queue-ack window, or (b) container memory couldn't hold a 50-case extraction batch. **P0 smoke test gates the choice**: if the container fails either constraint, fall back to Opt-A.

**Chosen: Opt-D (Container-Python via `flask-v22` DO).** P0 smoke gate: container must (i) cold-start under 25s on a 5-message warmup, (ii) handle a 50-case batch under 300s wall-clock with peak RSS < 80% of container limit. If either fails, downgrade to Opt-A and absorb the 14→8 regression with documented user sign-off on Q5.

### A.4 Pre-mortem (7 scenarios — S6 superseded by Gemma 4 verification, S7 NEW for Browser Rendering Tier-2)

#### S1 — AustLII rate-limits / IP-blocks the scraper Worker

- **Trigger:** Biweekly burst of 500–2,000 fetches from CF egress IPs trips AustLII bot-detection (CLAUDE.md notes 410-block on default UA).
- **Blast radius:** Run fails partway. Cases delayed 2 weeks or until manual retry. No data corruption.
- **Detection:** `pipeline_runs.errors_json` contains 410/403 ratio > 5%; DLQ grows beyond `DLQ_WARN_THRESHOLD=20`.
- **Mitigation:** browser-like UA preserved on cron path; per-court rate limit `PIPELINE_PER_COURT_RATE_LIMIT_MS=1500`; `max_concurrency=5` for cron-tagged messages; spread cron across 4 hours (`0 2,3,4,5 * * 1`); on detected 410s, log `event=cron.discover.austlii_blocked` and abort before more enqueues; retry next cron cycle. **Tier-2 fallback (NEW):** when `error_count_410_403 >= 5` consecutive on the SCRAPE_QUEUE consumer, escalate the failed batch to Cloudflare Browser Rendering (`@cloudflare/puppeteer`, `MYBROWSER` binding) for real-Chrome-fingerprint retry. Workers Paid plan includes 10 browser-hours/month free; biweekly budget ~2.5h/month is well within free tier — see S7 for cost containment.

#### S2 — LLM cost runaway

- **Trigger:** Malformed Gemma 4 JSON → retry loop, prompt-template token explosion, or court surge from 50 to 5,000 cases/biweek. **Updated cost math (Gemma 4 26B A4B verified 2026-05-10):** $0.10/M input + $0.30/M output → ~$0.0017/case at 15K-token avg input + 500-token output. 1500 cases × 2 runs/mo ≈ **$5.10/mo expected** (down from prior $10–15 estimate); per-run cap **$5** still binding because surge math (5,000 cases × $0.0017 = $8.50) exceeds cap and triggers `CostCapDO` halt at ~2,940 cases.
- **Blast radius:** USD spend at AI Gateway. With `CF_AIG_TOKEN` unified billing, no per-provider cap — could hit hundreds of USD before noticed.
- **Detection:** `CostCapDO.read()` > 0.6 × cap (warn) → 1.0 × cap (page + abort); CF AI Gateway dashboard cost-per-hour spike alert.
- **Mitigation:** hard `max_tokens=512`; **strongly-consistent `CostCapDO`** (NOT KV) accumulates per `run_id`, single-writer guarantees no over-spend under `max_concurrency=4`; on cap, set `PIPELINE_ENABLED=false` via env binding flip + drain queue + emit `cron.cost_cap_hit`; Zod schema gate on LLM JSON, no retry on parse fail; court-volume sanity-gate (3× p90 → abort + require `PIPELINE_FORCE_RUN=true`).

#### S3 — Bad extraction silently corrupts prod data (echoes 2026-05-02 judges incident)

- **Trigger:** New regex / LLM prompt overwrites populated field with null/wrong value. Past incident: ~10–15% FP rate on legitimate names.
- **Blast radius:** Bounded by allow-list to extraction columns; still potentially thousands of rows.
- **Detection:** `pipeline_runs.upserted` > 10× expected; per-field fill-rate drift alert (`validate_extraction.py` style post-run check).
- **Mitigation:** allow-list `ON CONFLICT DO UPDATE`; insert-only mode for first **10 weeks of biweekly soak (5 prod runs)**; intra-run COALESCE so racing messages within same `run_id` don't lose data; `extraction_audit` rows for every write; reversible `rollback_run.ts` script; staging-first; diff gate (abort if upsert count > expected_new + 5%).

#### S4 — Hyperdrive service-role binding compromise / RLS bypass abuse (NEW)

- **Trigger:** Leaked `HYPERDRIVE_SERVICE` secret, or Worker code accidentally exposes service-role connection to user-reachable handler. Service-role binding bypasses RLS by design.
- **Blast radius:** Full read+write of all tenants in `immigration_cases` and any tenancy-scoped tables.
- **Detection:** Logpush rule for queries on user-pool binding lacking `request.jwt.claims` SET LOCAL; secondary alert for SQL on service-role binding outside the cron handler call-stack (tag service-role queries with `application_name='immi-cron-<run_id>'` and alert when any other application_name appears).
- **Mitigation:** separate Hyperdrive resource for service-role; Wrangler secret rotation runbook (quarterly + on suspected leak); IP allowlist on Postgres if Cloudflare-egress IPs can be pinned; service-role connection only created inside `scheduled()` and `extract-queue` consumer call-stacks (lint rule + code review checklist); `application_name` tagging makes audit trivial.

#### S5 — Worker 30s CPU cap exceeded mid-extraction → queue poison-loop (NEW)

- **Trigger:** Large case + slow Gemma response + retry pushes processing past 30s; message re-delivers, never acks; DLQ fills or queue stalls.
- **Blast radius:** Pipeline stalls; biweekly window missed; possibly cost cap blown via repeated LLM calls on the same case.
- **Detection:** Queue `messages_in_dlq` metric; per-message processing time p95 > 25s (Logpush histogram).
- **Mitigation:** **Hard `AbortController(28_000ms)`** on every AI Gateway call inside the extract path; on abort, ack the queue message and write `extraction_failed=true` + `failure_reason=timeout` to R2 + `extraction_audit` row with `source='timeout'`; case is then candidate for next-cron retry but only via explicit re-enqueue (manual). Note: **Opt-D moves the heavy LLM work into the container**, which has a 5-min DO request budget — S5 most directly applies to Opt-A; under Opt-D the equivalent is the container's per-request timeout, mitigated by 50-case batch + per-call AbortController.

#### S6 — Gemma model deprecation / model-id drift mid-soak (REVISED — Gemma 4 verified, Gemma 3 12B deprecating 2026-05-30)

- **Trigger:** Google deprecates `@cf/google/gemma-4-26b-a4b-it` mid-soak (no current schedule), OR AI Gateway compat endpoint changes the `workers-ai/` prefix path. Note: `@cf/google/gemma-3-12b-it` has **planned deprecation 2026-05-30** (verified at official docs 2026-05-10) — explicitly NOT chosen as fallback.
- **Blast radius:** All extraction LLM calls 404. Discovery + scrape + regex still work; LLM-fallback fields silently null.
- **Detection:** `extraction_audit` rows with `source='llm'` drop to zero across a run; AI Gateway dashboard 404 spike.
- **Mitigation:** `model-id-resolver.test.ts` runs in CI weekly against a canary endpoint; **primary** `LLM_GEMMA_MODEL=workers-ai/@cf/google/gemma-4-26b-a4b-it` (256K context, MoE 26B/4B, $0.10/$0.30 per M); **fallback chain**: (1) `workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct` (128K context, $0.27/$0.85 — 2.7× input cost but stable + same Workers AI binding), (2) `google-ai-studio/gemini-2.5-flash` via AI Gateway compat (LLM Council moderator already uses this — proven path). Auto-engage on first 404; alert on `source='llm'` count per run dropping below 0.4 × historical median.

#### S7 — Browser Rendering Tier-2 fallback cost runaway (NEW)

- **Trigger:** AustLII bot-detection escalates beyond expected; HTTP-fetch fail rate stays > 5% for multiple runs; Tier-2 Browser Rendering quota burns past free 10h/month → $0.09/browser-hour overage; or concurrent-browser cap exceeded ($2/concurrent over 10).
- **Blast radius:** $0.09 × N hours/month direct cost; if Tier-2 also blocks, no Tier-3 = run fails.
- **Detection:** `pipeline_runs.tier2_browser_seconds` aggregate per month > 32,400s (9h, 90% of free tier); CF Browser Rendering dashboard usage hourly graph.
- **Mitigation:** Hard cap `BROWSER_RENDERING_MONTHLY_BUDGET_SECONDS=32400` (9h, leaves 1h headroom in free tier); if exceeded mid-run, abort cron with `event=cron.tier2.budget_exhausted` and email operator; per-page navigation timeout `BROWSER_NAV_TIMEOUT_MS=30000`; Tier-2 only triggers per-batch on 5× consecutive HTTP failures (NOT default path); Workers Paid plan included quota covers expected biweekly footprint with 4× headroom.

### A.5 Expanded Test Plan

**Test stack (dual-language).** Container Python is critical-path under Opt-D, so the pyramid spans two stacks: **Vitest** for Worker TS (`workers/austlii-scraper/src/__tests__/`) and **pytest** for the container endpoint + extraction libraries (`tests/`).

#### Unit tests (Vitest, in `workers/austlii-scraper/src/__tests__/`)

- `parser.test.ts` — extend with 10 new fixtures (one per court).
- `discovery.test.ts` — Hyperdrive lookback window + AustLII listing → diff set; empty court; future-dated rows skipped.
- `case-id-normalize.test.ts` — `sha256(normalize(citation)||normalize(url))` → identical hash for whitespace/punct variants of the same citation; title volatility does NOT change hash.
- `idempotent-upsert.test.ts` — duplicate `case_id` second upsert is no-op when allow-list unchanged; intra-run COALESCE preserves earlier-message field if later message has null.
- `extract-regex.test.ts` (Opt-A only) — TS regex parity vs Python on 100 golden fixtures.
- `prompt-template.test.ts` — token count under 1,500 in + 512 out; Zod-schema validates Gemma 4 response.
- `model-id-resolver.test.ts` — env-driven model id resolution + fallback to `workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct` on 404; explicitly assert `gemma-3-12b-it` is NOT in the fallback chain (deprecating 2026-05-30).
- `tier2-browser-rendering.test.ts` — when SCRAPE_QUEUE consumer hits 5× consecutive 410/403, asserts batch escalates to `MYBROWSER` Puppeteer binding; cumulative `tier2_browser_seconds` ledger; budget-exhaustion abort path.
- `cost-cap-do.test.ts` — strongly-consistent accumulator aborts at cap under simulated 4-way concurrent writes; `cron.cost_cap_hit` emitted.
- `biweekly-tick.test.ts` — `Math.floor(ts / 86_400_000 / 14) % 2 === 0` correct across year boundary, DST, and leap-day; anchor = epoch UTC.
- `kill-switch.test.ts` — `PIPELINE_ENABLED=false` skips both new ticks AND in-flight message handler entry.
- `rollback-run.test.ts` — given a synthetic `extraction_audit` history, `rollback_run.ts <run_id>` restores prior values via `old_value` column.
- `schema-drift.test.ts` — boot-time schema check logs `event=schema.drift.detected` (warn, not fail) when `ALLOWED_FIELDS` diverges from `information_schema.columns`.

#### Unit tests (pytest, in `tests/` — container + extraction lib)

- `tests/test_extraction_regex.py` (P3.0 deliverable) — 14 fields × happy-path + edge cases (empty text, unicode, name-with-state-suffix per CLAUDE.md 2026-05-02 incident shape: `Michael Cooke (NSW)`, `general member cosgrave`). Verifies confidence values are in `[0.0, 1.0]`.
- `tests/test_extraction_llm.py` (P3.0 deliverable) — mocks AI Gateway HTTP; asserts (a) cost accumulates per-call USD correctly, (b) JSON-parse-failure returns null + cost=0 (no retry), (c) AbortController-equivalent timeout raises `TimeoutError(fields=[...])`.
- `tests/test_internal_extract.py` (P3.2 deliverable) — 3 tests covering the Flask endpoint:
  (a) Happy path: 50-case synthetic batch returns valid response shape `{extracted: [...], llm_calls, cost_usd}` with each item carrying per-field `{value, confidence, source}` envelope and `timeouts: []`.
  (b) Forbidden: missing `X-Internal-Route: worker` returns 403 (auth.py global guard); missing `X-Internal-Route-Subtype: cron-extract` with valid worker header also returns 403 (route-specific guard); both present returns 200.
  (c) Timeout path: monkeypatch `extract_llm` to raise `TimeoutError(fields=['judges'])`; assert response item has `fields['judges'] = {value: null, confidence: 0.0, source: 'timeout'}` and `timeouts: ['judges']`.
- `tests/test_auth.py::test_internal_extract_route_requires_worker_literal` — tightens the Rev 32 contract: 200 with `{worker, cron-extract}`, 403 with `{cron-extract}` only (broadening rejected), 200 with `{worker}` alone (existing /internal/* routes still work — backwards compat).

#### Integration tests (Miniflare or `wrangler dev --local`)

- `cron-end-to-end.test.ts` — fire `scheduled()` → Miniflare Queue + R2 + mocked Hyperdrive + mocked AI Gateway → `pipeline_runs` row created, queue messages enqueued, R2 keys written, no Hyperdrive write outside allow-list.
- `dlq-handling.test.ts` — inject 410 → DLQ receives message → `pipeline_runs.errors` increments → run continues for other courts.
- `cost-cap-do-integration.test.ts` — 1,000 mock messages × $0.01 → run aborts at message ~500 with `cost_cap_hit`; CostCapDO state correct.
- `transaction-isolation.test.ts` (NEW) — verify `set_config(..., true)` `SET LOCAL` does NOT leak across requests via Hyperdrive pool: spawn two parallel queries on same connection, assert tenant context isolated.

#### Load test (NEW)

- `surge-load.test.ts` — simulate 5,000-case burst from S2 trigger; assert queue + extract path drains within 4h, no DLQ growth beyond `DLQ_WARN_THRESHOLD`, cost cap fires correctly when synthetic per-case cost is dialled up.
- `tests/load/cron-with-user-traffic.test.ts` (NEW, Miniflare or staging) — fires a 50-case extract batch while issuing 100 concurrent user reads against the same `flask-v22` DO. Assertions: user-read p95 < 2s during the cron window, zero 5xx, container-side log shows EXTRACT_QUEUE consumer `max_concurrency=1` was honoured (no overlapping `internal_extract` invocations). This validates the Rev 33 / Opt-D Cons mitigation.

#### E2E (staging) — extended soak

- Staging Supabase project (separate from prod) with `immigration_cases_staging` (5K-row sample).
- **Soak duration: 10 weeks at biweekly cadence (5 prod-shape runs)** OR **4 weeks at weekly cadence (4 runs)** during soak only — see Q3 decision; control-chart baseline requires ≥ 5 samples.
- Assertions per run:
  - Zero rows mutated outside `(case_id IN new_set OR last_extraction_run_id=$1)`.
  - All new rows: `case_id` matches normalized SHA-256 hash spec (whitespace-invariant).
  - **Per-field parity bars on the frozen 100-fixture golden set** (hand-labelled by operator, court-stratified: AATA 35, FCA 20, FCCA 15, FedCFamC2G 10, ARTA 10, RRTA 5, MRTA 5):
    - `applicant_name ≥ 95%` exact match
    - `decision_date ≥ 99%` exact match
    - `outcome ≥ 90%` (enum match)
    - `visa_subclass ≥ 95%`
    - `country_of_origin ≥ 85%`
    - `is_represented ≥ 80%`
    - `representative ≥ 75%`
    - `judges ≥ 95%` (set equality after name-normalization)
  - Ground truth = the frozen hand-labelled fixture set, NOT Python output (Python has known 10–15% FP rate per CLAUDE.md). Under Opt-D the bars apply to Python-via-container output regression-detection, not initial parity sign-off.
  - `pipeline_runs.cost_usd` < $5 per run, monthly aggregate < $30 hard alert cap.

#### Playwright E2E (NEW)

- `tests/e2e/react/test_admin_pipeline_runs.py` — `/admin/pipeline-runs` page renders last 30 runs with cost/duration/error sparklines; gated on `is_admin` JWT claim; non-admin redirected.

#### Observability tests

- Synthetic `event=cron.discover.start` → Logpush → Grafana panel updates < 60s.
- DLQ count > threshold → Discord alert fires via direct HTTPS POST to a Discord channel webhook URL (NOT Telegram, NOT MCP — see P5.3).
- Schema-drift synthetic ALTER → next cron logs `schema.drift.detected` without aborting.

---

## Section B — Implementation Plan

### Phase ordering and rough effort (Opt-D path; Opt-A delta noted in P3)

| Phase | Files touched | New code | Effort | Gate |
|---|---|---|---|---|
| P0 Foundations | wrangler.toml, 4 split migrations, KV, secrets, golden fixtures, baseline bootstrap, container smoke | ~250 LOC + 100 fixtures | 1d | Migrations green; container smoke gate passes |
| P1 Discovery | austlii-scraper/src/index.ts (+ new `discover.ts`, `pipeline-config.ts`) | ~250 LOC | 1d | Discovery returns expected diff set on staging |
| P2 Scrape (reuse) | small wrangler.toml batch-size + run_id propagation | ~30 LOC | 0.5d | New Q messages drained, R2 written under `runs/<run_id>/` |
| **P3.0 Extraction lib refactor (NEW)** | new `immi_case_downloader/extraction/{__init__,regex,llm}.py`; `extract_structured_fields.py` + `extract_structured_fields_llm.py` become thin wrappers | ~300 LOC moved + 200 LOC new tests | 1d | `pytest tests/` green; existing `extract_structured_fields.py --workers 8` produces byte-identical CSV vs. pre-refactor on 100-case sample |
| P3 Extract — **Opt-D**: container endpoint + Worker client | new `extract.ts` Worker handler + `web/internal_extract.py` Flask route (imports the new pure lib from P3.0) | ~250 LOC | 1d | Container `/internal/extract` returns 14-field JSON for 50-case batch under 300s |
| P3 Extract — **Opt-A fallback only**: TS extractor | new `extractor/` Worker dir | ~600 LOC | +5d | TS regex per-field parity bars met on golden set |
| P4 Upsert | `db/upsert.ts`, audit table, `rollback_run.ts` | ~250 LOC | 1d | Insert-only mode lands new cases on staging; rollback script reverses synthetic bad-run |
| P5 Observability | `pipeline_runs` query API, React `/admin/pipeline-runs`, alerting, `is_admin` claim migration | ~450 LOC | 1.5d | Dashboard live, alert fires on synthetic DLQ |
| **Total Opt-D** | | ~1,500 LOC + 100 fixtures | **~7–9 days core + 10 weeks soak** | |
| **Total Opt-A (fallback)** | | ~2,050 LOC + 100 fixtures | **~12–14 days core + 10 weeks soak** | |

### P0 — Foundations

#### P0.1 Migrations (split for reversibility)

Each `_NNN_*.sql` ships with a paired `_NNN_*_down.sql` reversal. All idempotent.

`supabase/migrations/20260512_001_pipeline_runs.sql` (+ `_down.sql`):

```sql
CREATE TABLE public.pipeline_runs (
  run_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  trigger             text NOT NULL CHECK (trigger IN ('cron','manual','webhook')),
  court               text,
  phase               text NOT NULL,
  discovered          int  NOT NULL DEFAULT 0,
  scraped             int  NOT NULL DEFAULT 0,
  extracted           int  NOT NULL DEFAULT 0,
  upserted            int  NOT NULL DEFAULT 0,
  llm_calls           int  NOT NULL DEFAULT 0,
  cost_usd            numeric(10,4) NOT NULL DEFAULT 0,
  errors              int  NOT NULL DEFAULT 0,
  errors_json         jsonb,
  status              text NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running','ok','aborted','failed')),
  abort_reason        text
);
CREATE INDEX pipeline_runs_started_idx ON public.pipeline_runs (started_at DESC);
CREATE INDEX pipeline_runs_status_idx  ON public.pipeline_runs (status, started_at DESC);
```

`supabase/migrations/20260512_002_extraction_audit.sql` (+ `_down.sql`):

```sql
CREATE TABLE public.extraction_audit (
  id                  bigserial PRIMARY KEY,
  run_id              uuid NOT NULL REFERENCES public.pipeline_runs(run_id),
  case_id             text NOT NULL,
  field               text NOT NULL,
  old_value           text,
  new_value           text,
  source              text NOT NULL CHECK (source IN ('regex','llm','merge','timeout','rollback')),
  confidence          numeric(3,2),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX extraction_audit_run_idx  ON public.extraction_audit (run_id);
CREATE INDEX extraction_audit_case_idx ON public.extraction_audit (case_id);
```

`supabase/migrations/20260512_003_immigration_cases_alter.sql` (+ `_down.sql`) — requires brief prod-lock window; non-null defaults avoided:

```sql
ALTER TABLE public.immigration_cases
  ADD COLUMN IF NOT EXISTS last_extraction_run_id uuid REFERENCES public.pipeline_runs(run_id),
  ADD COLUMN IF NOT EXISTS extraction_confidence  jsonb;
```

`supabase/migrations/20260512_004_staging_clone.sql` (+ `_down.sql`, staging only):

```sql
CREATE TABLE IF NOT EXISTS public.immigration_cases_staging
  (LIKE public.immigration_cases INCLUDING ALL);
```

#### P0.2 Wrangler bindings (`workers/austlii-scraper/wrangler.toml`)

```toml
# ─── Cron Triggers ────────────────────────────────────────────────────────────
# Cron syntax has no native biweekly. Run weekly Monday 02:00–05:00 UTC,
# gate biweekly inside scheduled() via isBiweeklyTick() — epoch-anchored
# Math.floor(ts / 86_400_000 / 14) % 2 === 0.
[triggers]
crons = ["0 2 * * 1", "0 3 * * 1", "0 4 * * 1", "0 5 * * 1"]

# ─── Hyperdrive (service-role, isolated from proxy.js pool) ──────────────────
[[hyperdrive]]
binding = "HYPERDRIVE_SERVICE"
id      = "<NEW hyperdrive id — separate from main proxy>"
localConnectionString = "postgres://postgres:postgres@127.0.0.1:54322/postgres"

# ─── KV (read-only baselines, kill-switch flag fallback) ─────────────────────
[[kv_namespaces]]
binding = "PIPELINE_KV"
id      = "<NEW kv id>"

# ─── Durable Object: cost cap (strongly-consistent per-run accumulator) ──────
[[durable_objects.bindings]]
name        = "COST_CAP_DO"
class_name  = "CostCapDO"

[[migrations]]
tag         = "v1"
new_classes = ["CostCapDO"]

# ─── Queue: extraction (separate from scrape queue) ──────────────────────────
[[queues.producers]]
binding = "EXTRACT_QUEUE"
queue   = "austlii-extract-queue"

[[queues.consumers]]
queue              = "austlii-extract-queue"
max_batch_size     = 5
max_batch_timeout  = 60
max_retries        = 2
dead_letter_queue  = "austlii-extract-dlq"
# max_concurrency=1 (NOT 4): EXTRACT_QUEUE forwards to flask-v22 DO container which
# shares process with user-facing Flask reads. Concurrent batches would compound GIL
# contention. One batch at a time bounds user-read p95 degradation to ≤6s per ~100s
# cron batch. SCRAPE_QUEUE keeps its own higher concurrency (network-bound, no GIL).
max_concurrency    = 1

# ─── Service binding to Flask DO container (Opt-D) ───────────────────────────
[[services]]
binding     = "FLASK_BACKEND"
service     = "immi-proxy"
entrypoint  = "FlaskBackend"

# ─── Browser Rendering binding (Tier-2 fallback for AustLII bot-detection) ───
# Workers Paid plan includes 10h/month free + 10 concurrent browsers. Biweekly
# expected footprint ~2.5h/month (1500 cases × 3s × 2 runs). Only triggered per-batch
# on 5× consecutive 410/403 from Tier-1 HTTP fetch. Hard cap: 9h/month via env var.
[browser]
binding = "MYBROWSER"

# ─── Workers AI binding (for Gemma 4 via AI Gateway compat) ──────────────────
[ai]
binding = "AI"

# ─── Vars ─────────────────────────────────────────────────────────────────────
[vars]
PIPELINE_ENABLED                  = "false"
PIPELINE_BIWEEKLY_GATE            = "true"
PIPELINE_RUN_COST_CAP_USD         = "5"          # Q2a RESOLVED 2026-05-10: $5/run, scrape only once per biweek
PIPELINE_MONTHLY_HARD_CAP_USD     = "10"         # 2 runs/month × $5 = $10 strict (revised down from $30 alert)
PIPELINE_TARGET_TABLE             = "immigration_cases_staging"
LLM_GEMMA_MODEL                   = "workers-ai/@cf/google/gemma-4-26b-a4b-it"  # Q1 RESOLVED 2026-05-10: Gemma 4 26B A4B (256K ctx, $0.10/$0.30 per M)
LLM_GEMMA_FALLBACK                = "workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct"  # 128K ctx, stable backup; NOT gemma-3-12b-it (deprecating 2026-05-30)
BROWSER_RENDERING_MONTHLY_BUDGET_SECONDS = "32400"  # 9h hard cap (1h headroom in 10h free tier)
BROWSER_NAV_TIMEOUT_MS            = "30000"
TIER2_TRIGGER_CONSECUTIVE_FAILS   = "5"
LLM_EXTRACT_CF_GATEWAY_URL        = "https://gateway.ai.cloudflare.com/v1/<acct>/immi-extract/compat"
LLM_MAX_OUTPUT_TOKENS             = "512"
PIPELINE_DISCOVERY_LOOKBACK_YEARS = "2"
PIPELINE_PER_COURT_RATE_LIMIT_MS  = "1500"
DLQ_WARN_THRESHOLD                = "20"
PIPELINE_INSERT_ONLY              = "true"
PIPELINE_EXTRACT_BATCH_SIZE       = "50"
PIPELINE_LLM_CALL_TIMEOUT_MS      = "28000"
```

#### P0.3 Secrets (`wrangler secret put`)

- `CF_AIG_TOKEN` — reused; header `cf-aig-authorization`.
- `HYPERDRIVE_SERVICE_URL` — service-role Postgres URL.
- `ALERT_DISCORD_WEBHOOK_URL` — single Discord channel webhook URL (format: `https://discord.com/api/webhooks/<channel_id>/<token>`). **Q2b RESOLVED 2026-05-10**: user picked Discord (NOT Telegram). Webhook is dedicated to a new channel in user's existing Discord server; no bot token / chat-id needed; webhook URL alone authorises POST. Worker fires `fetch(env.ALERT_DISCORD_WEBHOOK_URL, {method:'POST', body: JSON.stringify({content: message, username: 'IMMI-Cron'})})`. Webhook URL is the only Discord-side secret; rotate by deleting+recreating the channel webhook.

#### P0.4 Bootstrap baseline `p90` (NEW — was a Follow-up; promoted)

One-off script `scripts/bootstrap_baselines.py`:

```python
# Computes per-court p90 of historical biweekly new-case counts
# from immigration_cases.decision_date over the last 24 months.
# Writes to PIPELINE_KV as baseline:<court>:p90.
# Run once before P1 ships; re-run quarterly as cron in CI.
```

Without this the first 2 prod runs are uncapped on the volume sanity-check (S2 mitigation).

#### P0.5 Golden fixture set (NEW)

- 100 hand-labelled cases (court-stratified: AATA 35, FCA 20, FCCA 15, FedCFamC2G 10, ARTA 10, RRTA 5, MRTA 5).
- Operator hand-labels each case with the 14 ground-truth field values in `workers/austlii-scraper/src/extractor/golden/<court>-<year>-<id>.json`.
- Frozen file hashes committed; tampering caught by CI checksum.
- Used as ground truth for parity bars in P3, regression in soak (Opt-D), initial parity (Opt-A).

#### P0.6 Container smoke gate (Opt-D only — gates the option choice)

- Deploy `web/internal_extract.py` blueprint to staging Flask DO.
- Send 5-message warmup, measure cold-start.
- Send 50-case synthetic batch (deterministic R2 fixtures), measure wall-clock + peak RSS.
- **Pass:** cold-start < 25s AND batch < 300s AND peak RSS < 80% container limit.
- **Fail:** abort Opt-D rollout, switch plan to Opt-A and add 5d to schedule + Q5 sign-off on 14→8 regression.
- **Region pinning verification:** run `wrangler tail` during the smoke batch and assert every log line's `cf.colo` matches `^(SYD|MEL|AKL|PER)$` (Oceania colos). A non-`oc` colo means the DO failed to honour the location hint and au-east p95 will regress — escalate before continuing.

**Acceptance:** `wrangler types` clean; staging migrations applied; KV namespace + queue + DO + service binding created; cron registered; baselines bootstrapped; golden fixtures committed; container smoke passes.

---

### P1 — Discovery

#### P1.1 New file: `workers/austlii-scraper/src/discover.ts`

```ts
export interface DiscoveryResult {
  court: string;
  candidate_urls: string[];
  new_case_urls:  string[];
  skipped_reason?: 'rate_anomaly' | 'paused' | 'court_disabled';
}

export function caseIdOf(citation: string, url: string): string {
  // sha256(normalize(citation)||normalize(url)).slice(0,12) — title intentionally dropped.
  // normalize = trim, lowercase, collapse internal whitespace, strip trailing punctuation.
  // Title is the most volatile field; including it in the hash caused churn in past runs.
  const norm = (s: string) =>
    s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '');
  return sha256Hex(norm(citation) + '||' + norm(url)).slice(0, 12);
}

export async function discoverCourt(
  env: Env, court: CourtCode, runId: string,
): Promise<DiscoveryResult>;
```

Logic:

1. **Lookback window only** — do NOT use `MAX(decision_date)`. AustLII publishes cases days-to-weeks AFTER the decision date, so a watermark by `decision_date` silently misses late-published cases. Use `PIPELINE_DISCOVERY_LOOKBACK_YEARS=2` as a fixed window: scan `[current_year, current_year-1]`. Dedup by `case_id` against existing rows.
2. Fetch AustLII listing using existing scraper UA logic. Apply court-lineage (CLAUDE.md: AATA 2025+ → ARTA fallback).
3. Parse listing → `(citation, url, title)` → `case_id = caseIdOf(citation, url)`.
4. `SELECT case_id FROM <table> WHERE court=$1 AND case_id = ANY($2)` via `HYPERDRIVE_SERVICE` → diff for new ids.
5. **Sanity gate:** if `len(new) > 3 × p90(new_per_biweek_for_court)` (from `PIPELINE_KV:baseline:<court>:p90` bootstrapped in P0.4), return `skipped_reason='rate_anomaly'`.
6. Return `DiscoveryResult`.

#### P1.2 Modify: `workers/austlii-scraper/src/index.ts`

Add `scheduled()` next to existing `fetch` and `queue`:

```ts
async scheduled(event, env, ctx) {
  if (env.PIPELINE_ENABLED !== 'true') {
    console.log({ event: 'cron.skipped.disabled', cron: event.cron });
    return;
  }
  const isBiweekly = isBiweeklyTick(event.scheduledTime);
  if (env.PIPELINE_BIWEEKLY_GATE === 'true' && !isBiweekly) {
    console.log({ event: 'cron.skipped.off_week', cron: event.cron });
    return;
  }
  // Schema drift check — warn-only, doesn't abort
  await assertSchemaConsistent(env).catch((e) =>
    console.log({ event: 'schema.drift.detected', error: String(e) }));

  const hour  = new Date(event.scheduledTime).getUTCHours();
  const group = COURT_MATRIX.groupForHour(hour);
  if (!group) return;
  const runId = await startRun(env, { trigger: 'cron', courts: group });
  ctx.waitUntil(runDiscoveryAndEnqueue(env, runId, group));
}
```

Per-message kill-switch: scrape and extract consumers also re-read `env.PIPELINE_ENABLED` at message-handle entry — if `false`, ack-and-skip the message (do NOT process). This drains in-flight queue work cleanly when operator flips the flag.

#### P1.3 New file: `workers/austlii-scraper/src/pipeline-config.ts`

```ts
export const COURT_MATRIX = {
  all: ['AATA','ARTA','FCA','FMCA','FCCA','FedCFamC2G','HCA','RRTA','MRTA'] as const,
  groupForHour(h: number) {
    if (h === 2) return ['AATA','ARTA','HCA'];
    if (h === 3) return ['FCA'];
    if (h === 4) return ['FCCA','FedCFamC2G','FMCA'];
    if (h === 5) return ['RRTA','MRTA'];
    return null;
  },
};

// Epoch-anchored 14-day window. Robust across DST, year boundaries, leap days
// because Math.floor on UTC ms is monotonic. Chosen anchor: epoch UTC.
export function isBiweeklyTick(ts: number): boolean {
  return Math.floor(ts / 86_400_000 / 14) % 2 === 0;
}
```

**Acceptance:** `discoverCourt('AATA', runId)` against staging matches Python `cmd_search --databases AATA --start-year 2025` ±5%; `pipeline_runs` row written; sanity gate triggers on synthetic surge; `isBiweeklyTick` unit tests cover 2024-12-30, 2025-03-09 DST, 2028-02-29.

---

### P2 — Scrape (reuse)

Existing `queue()` handler already fetches AustLII → R2. Required changes:

1. **`run_id` propagation**: discovery enqueues `{ url, court, run_id, phase: 'scrape' }`. Threaded into R2 key prefix `r2://austlii-case-results/runs/<run_id>/<court>/<case_id>.{html,json}` (additive; legacy keys preserved).
2. **Per-message kill-switch**: handler reads `env.PIPELINE_ENABLED` at entry; if `false`, ack-and-skip.
3. **Forward to extract**: after successful scrape, enqueue `{ r2_key, case_id, court, run_id }` to `EXTRACT_QUEUE`.
4. **Cron-tagged throttle**: when `phase='scrape'` and `run_id` is set, throttle via `PIPELINE_KV:ratelimit:<court>` sliding window using `PIPELINE_PER_COURT_RATE_LIMIT_MS=1500`. Manual `/enqueue` calls retain current concurrency=20.

**Acceptance:** Discovery → queue → R2 written under `runs/<run_id>/` → extract queue receives forward messages → `pipeline_runs.scraped` updated.

---

### P3.0 — Extraction-library refactor (PREREQUISITE for both Opt-D and Opt-A)

The existing scripts expose only CLI-shaped entry points: `process_case(case_row: dict)` at `extract_structured_fields.py:876` and `process_batch(...)` at `extract_structured_fields_llm.py:264`. The pure-text helpers `extract_structured_fields_regex(text)` / `extract_structured_fields_llm(text, unfilled, gateway_url)` that P3.2 imports **do not yet exist**. Without this refactor P3.2 is a `NameError` at first call.

**Files (new):**
- `immi_case_downloader/extraction/__init__.py` — re-exports `extract_regex`, `extract_llm`.
- `immi_case_downloader/extraction/regex.py` — `extract_regex(text: str) -> dict[str, tuple[Any, float]]`. Returns `{field: (value, confidence)}` for each of the 14 fields the existing pipeline supports (applicant_name, decision_date, hearing_date, court, visa_subclass, country_of_origin, is_represented, representative, judges, outcome, tribunal_member, member_decision, legal_concepts, full_text). Logic moves verbatim from `extract_structured_fields.process_case`; no behaviour change.
- `immi_case_downloader/extraction/llm.py` — `extract_llm(text: str, unfilled: list[str], gateway_url: str, token: str) -> tuple[dict[str, Any], float]`. Returns `(values_by_field, cost_usd)`. Cost accounting is the new responsibility (previously implicit). Uses `cf-aig-authorization: Bearer <token>` against the `immi-extract` slug.

**Files (refactored, thin wrappers — no behaviour change for existing local Python users):**
- `extract_structured_fields.py` — keeps CLI; `process_case` becomes `from immi_case_downloader.extraction.regex import extract_regex; values = extract_regex(case_row['full_text'])` then writes CSV as before.
- `extract_structured_fields_llm.py` — same shape, calls `extract_llm` for unfilled-field path.

**New tests:**
- `tests/test_extraction_regex.py` — 14 fields × happy-path + edge cases (empty text, unicode, name-with-NSW-suffix per CLAUDE.md 2026-05-02 incident).
- `tests/test_extraction_llm.py` — mocks AI Gateway HTTP, asserts cost accounting accumulates per-call USD correctly, asserts JSON-parse-failure returns null + cost=0 (no retry).

**Acceptance:**
1. `pytest tests/` (existing 1,039 Python unit tests) passes unchanged — the wrapper refactor must be invisible.
2. New unit tests `tests/test_extraction_regex.py` + `tests/test_extraction_llm.py` green.
3. `python3 extract_structured_fields.py --dry-run --sample 100` produces byte-identical CSV vs. pre-refactor checkout on the same 100-case sample (use `git stash` + diff).

#### P3-OptD (CHOSEN) — Container-Python via service binding

##### P3.1 Worker handler: `workers/austlii-scraper/src/extract.ts`

```ts
export async function handleExtractBatch(env: Env, msgs: Message[]) {
  if (env.PIPELINE_ENABLED !== 'true') {
    msgs.forEach(m => m.ack());  // kill-switch drain
    return;
  }
  const runId = msgs[0].body.run_id;
  const costCap = env.COST_CAP_DO.get(env.COST_CAP_DO.idFromName(`run:${runId}`));
  const remaining = await costCap.fetch('https://x/remaining').then(r => r.json());
  if (remaining.usd <= 0) {
    msgs.forEach(m => m.retry());  // pause; cap will reset on next run boundary
    return;
  }
  const batch = msgs.map(m => ({ r2_key: m.body.r2_key, case_id: m.body.case_id }));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Number(env.PIPELINE_LLM_CALL_TIMEOUT_MS));
  let resp;
  try {
    resp = await env.FLASK_BACKEND.fetch('https://internal/internal/extract', {
      method: 'POST',
      headers: {
        // Ingress guard in immi_case_downloader/web/auth.py:96 exact-matches the literal
        // 'worker' — broadening that set widens the public-API trust boundary, so we keep
        // the literal and disambiguate the cron-extract route via a SUBTYPE header.
        'X-Internal-Route': 'worker',
        'X-Internal-Route-Subtype': 'cron-extract',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ run_id: runId, batch }),
      signal: ctl.signal,
    });
  } catch (e) {
    msgs.forEach(m => m.retry()); return;
  } finally { clearTimeout(timer); }
  if (!resp.ok) { msgs.forEach(m => m.retry()); return; }
  const { extracted, llm_calls, cost_usd } = await resp.json();
  await costCap.fetch('https://x/charge', { method: 'POST', body: JSON.stringify({ usd: cost_usd }) });
  // Worker (not container) owns the upsert step → P4
  for (const e of extracted) {
    await upsertCase(env, runId, e.case_id, e.base, e.fields, e.confidence);
  }
  msgs.forEach(m => m.ack());
}
```

##### P3.2 Container endpoint: `immi_case_downloader/web/internal_extract.py`

```python
@bp.post('/internal/extract')
def internal_extract():
    # Global Flask ingress guard (auth.py:96) already verified the literal
    # X-Internal-Route='worker'. We only need to confirm the cron-extract subtype here.
    if request.headers.get('X-Internal-Route-Subtype') != 'cron-extract':
        return ('forbidden', 403)
    payload = request.get_json()
    run_id, batch = payload['run_id'], payload['batch']
    # Imports point at the new pure library from P3.0 — see Phase ordering table.
    from immi_case_downloader.extraction.regex import extract_regex
    from immi_case_downloader.extraction.llm import extract_llm
    results, llm_calls, cost_usd = [], 0, 0.0
    cap = float(os.environ['PIPELINE_RUN_COST_CAP_USD']) * 0.8
    for item in batch:
        text = read_r2(item['r2_key'])
        regex_dict = extract_regex(text)               # {field: (value, confidence)}
        fields = {f: {'value': v, 'confidence': c, 'source': 'regex'}
                  for f, (v, c) in regex_dict.items()}
        unfilled = [f for f, e in fields.items() if e['value'] is None]
        timeouts = []
        if unfilled and cost_usd < cap:
            try:
                llm_values, call_cost = extract_llm(
                    text, unfilled,
                    gateway_url=os.environ['LLM_EXTRACT_CF_GATEWAY_URL'],
                    token=os.environ['CF_AIG_TOKEN'])
                cost_usd  += call_cost
                llm_calls += 1
                for f in unfilled:
                    if f in llm_values:
                        fields[f] = {'value': llm_values[f], 'confidence': 0.7, 'source': 'llm'}
            except TimeoutError as e:
                timeouts.extend(getattr(e, 'fields', unfilled))
        # Mark per-call timeouts explicitly so Worker writes extraction_audit.source='timeout'
        for f in timeouts:
            fields[f] = {'value': None, 'confidence': 0.0, 'source': 'timeout'}
        results.append({
          'case_id':  item['case_id'],
          'base':     base_metadata(text, item['case_id']),
          'fields':   fields,                          # per-field {value, confidence, source}
          'timeouts': timeouts,
        })
    return jsonify({'extracted': results, 'llm_calls': llm_calls, 'cost_usd': cost_usd})
```

Reuse rules:
- Regex / LLM logic comes from `extract_structured_fields.py` and `extract_structured_fields_llm.py` unchanged.
- LLM call uses `LLM_EXTRACT_CF_GATEWAY_URL` (NEW dedicated `immi-extract` slug — keeps cost analytics separate from `immi-council`).
- Determinism: temperature=0, `max_tokens=512`, response_format=json_object.
- **No retry** on JSON parse failure — return null for that field, source='llm', confidence=0.

##### P3.3 CostCapDO (`workers/austlii-scraper/src/cost-cap-do.ts`)

Per-run `idFromName(\`run:${runId}\`)`. Single-writer strong-consistency. Endpoints:
- `GET /remaining` → `{ usd: cap - charged }`
- `POST /charge` `{ usd }` → updates state, returns `{ charged, capped }`. If charged > cap, returns `capped: true` and emits abort signal via `cron.cost_cap_hit`.

**Acceptance (P3-OptD):**
- 50-case batch returns 14-field JSON in < 300s.
- LLM cost charged via DO; concurrent charges from 4 consumers all serialized correctly (no over-spend).
- Per-field bars met against frozen golden set (regression test, since Python pipeline is the same code that produced existing fill rates).

#### P3-OptA (FALLBACK only — engaged if P0.6 smoke gate fails)

If container smoke gate fails:
- Build TS extractor in `workers/austlii-scraper/src/extractor/` (regex.ts, llm.ts, schema.ts, golden/, __tests__/).
- Field set reduced to **8 priority fields**: applicant_name, visa_subclass, decision_date, country_of_origin, is_represented, representative, outcome, judges. **6 fields dropped** → user must sign Q5 acknowledging the regression.
- **No "regex confidence > 0.85" thresholds** — deterministic rule: regex match at canonical named-group position = use; no match → LLM fallback for that field. No score, no threshold.
- Per-field bars same as P3-OptD; ground truth = frozen 100-fixture golden set (NOT Python output).
- Cost cap path same (Worker-side, CostCapDO).
- ENG +5 days.

---

### P4 — Upsert

#### P4.1 New file: `workers/austlii-scraper/src/db/upsert.ts`

```ts
const ALLOWED_FIELDS = [
  'full_text','decision_date','applicant_name','visa_subclass',
  'country_of_origin','is_represented','representative','judges','outcome',
  'hearing_date','tribunal_member','member_decision','legal_concepts',  // Opt-D adds 5 more (total 14)
] as const;

export async function assertSchemaConsistent(env: Env) {
  // Boot-time check — log warn, do NOT abort.
  const sql = getServiceSql(env);
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name=${env.PIPELINE_TARGET_TABLE}
  `;
  const present = new Set(cols.map((r: any) => r.column_name));
  const missing = ALLOWED_FIELDS.filter(f => !present.has(f));
  if (missing.length) throw new Error(`schema.drift: missing ${missing.join(',')}`);
}

export async function upsertCase(
  env: Env, runId: string, case_id: string,
  base: { citation: string; url: string; title: string; court: string },
  fields: Partial<Record<typeof ALLOWED_FIELDS[number], unknown>>,
  confidence: Record<string, number>,
) {
  const sql = getServiceSql(env);
  await sql`SET LOCAL application_name = ${'immi-cron-' + runId}`;  // S4 mitigation
  await sql.begin(async (tx) => {
    if (env.PIPELINE_INSERT_ONLY === 'true') {
      // INSERT-only mode: race-safe intra-run COALESCE.
      // Outside same run → DO NOTHING (no overwrite).
      await tx`
        INSERT INTO ${sql(env.PIPELINE_TARGET_TABLE)}
          (case_id, citation, url, title, court, ${sql(Object.keys(fields))},
           extraction_confidence, last_extraction_run_id)
        VALUES (${case_id}, ${base.citation}, ${base.url}, ${base.title}, ${base.court},
                ${sql(Object.values(fields))}, ${confidence}, ${runId})
        ON CONFLICT (case_id) DO UPDATE SET
          ${sql.unsafe(
            ALLOWED_FIELDS.map(f =>
              `${f} = CASE WHEN ${env.PIPELINE_TARGET_TABLE}.last_extraction_run_id = EXCLUDED.last_extraction_run_id
                           THEN COALESCE(${env.PIPELINE_TARGET_TABLE}.${f}, EXCLUDED.${f})
                           ELSE ${env.PIPELINE_TARGET_TABLE}.${f} END`
            ).join(', ')
          )}
      `;
      return;
    }
    // Post-soak null-fill UPDATE mode (gated by 2026-05-02 cleanup-rule follow-ups in §C).
    // ...same shape, but COALESCE applies cross-run.
  });
  // `fields` is now the per-field envelope from container P3.2:
  // { field: { value, confidence, source: 'regex'|'llm'|'timeout' } }.
  // Worker writes extraction_audit.source DIRECTLY from container output — no
  // confidence-threshold inference (the prior `>= 0.85 ? 'regex' : 'llm'` rule
  // could never write 'timeout' or 'rollback' even though the CHECK constraint allows it).
  for (const [field, env] of Object.entries(fields as Record<string, {value: unknown; confidence: number; source: string}>)) {
    await sql`
      INSERT INTO public.extraction_audit (run_id, case_id, field, old_value, new_value, source, confidence)
      VALUES (${runId}, ${case_id}, ${field}, NULL,
              ${env.value === null ? null : String(env.value)},
              ${env.source}, ${env.confidence})
    `;
  }
}
```

#### P4.2 Rollback script: `workers/austlii-scraper/scripts/rollback_run.ts`

```ts
// Usage: npx tsx rollback_run.ts <run_id> [--dry-run]
// Reverses upserts using extraction_audit.old_value.
// Test on staging with synthetic bad-run fixture (ships in P0.5 alongside golden).
async function rollback(runId: string, dryRun: boolean) {
  const audits = await sql`
    SELECT case_id, field, old_value
    FROM public.extraction_audit
    WHERE run_id = ${runId}
    ORDER BY id ASC
  `;
  for (const row of audits) {
    if (dryRun) { console.log({event:'rollback.dryrun', ...row}); continue; }
    await sql`
      UPDATE public.immigration_cases
      SET ${sql(row.field)} = ${row.old_value}
      WHERE case_id = ${row.case_id}
        AND last_extraction_run_id = ${runId}
    `;
    await sql`
      INSERT INTO public.extraction_audit (run_id, case_id, field, old_value, new_value, source)
      VALUES (${runId}, ${row.case_id}, ${row.field}, NULL, ${row.old_value}, 'rollback')
    `;
  }
}
```

#### P4.3 RLS bypass + service-role doc

Add to `CLAUDE.md` Auth Architecture section:

> **Cron pipeline bypass**: `austlii-scraper` Worker uses `HYPERDRIVE_SERVICE` binding (separate from `proxy.js` user-facing pool). Connection string is the **service-role** Postgres URL — bypasses RLS by design. There is no JWT context. This is acceptable because (a) Worker code is the only path with this binding, (b) writes are restricted to allow-list columns, (c) every write produces an `extraction_audit` row, (d) `application_name='immi-cron-<run_id>'` tags every query for Logpush forensics. Logpush rule fires on any service-role query whose `application_name` doesn't start with `immi-cron-`.

**Acceptance:**
- Insert-only: 100 new staging cases → 100 rows, 0 cross-run updates.
- Intra-run race: scrape→extract messages within same `run_id` produce final row with all populated fields (COALESCE preserves earlier nulls only when later message has the field).
- Rollback: synthetic bad-run reverses cleanly with `--dry-run` showing diffs first.
- Diff gate: 1,000-row over-update synthetic aborts.
- Schema drift synthetic ALTER → warn log, no abort.

---

### P5 — Observability

#### P5.0 (NEW) `is_admin` JWT claim migration — verify-then-add

```bash
# Verification command (run before P5.2 ships):
grep -rn "is_admin" supabase/migrations/
# As of 2026-05-10 this returns no rows. Add P5.0 migration:
```

`supabase/migrations/20260512_005_is_admin_claim.sql` (+ `_down.sql`):

```sql
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
-- JWT minting in workers/auth/handlers.js must include `is_admin` claim from this column.
```

Update `workers/auth/jwt.js` JWT-mint to include `is_admin: user.is_admin`.

#### P5.1 `pipeline-runs.ts` helper

```ts
export async function startRun(env, opts): Promise<string>;
export async function recordPhase(env, runId, phase, counts): Promise<void>;
export async function recordCost(env, runId, deltaUsd): Promise<void>;
export async function finishRun(env, runId, status, abortReason?): Promise<void>;
```

All write to `pipeline_runs` via `HYPERDRIVE_SERVICE`. CostCapDO is the source of truth for in-flight cost; `pipeline_runs.cost_usd` is end-of-run snapshot.

#### P5.2 Frontend `/admin/pipeline-runs`

`frontend/src/pages/PipelineRunsPage.tsx`:
- TanStack Query against `GET /api/v1/admin/pipeline-runs?limit=30` (added to `workers/proxy.js` user-pool path; read-only).
- Table columns: run_id, started, duration, courts, discovered/scraped/extracted/upserted, cost USD, status.
- Sparklines: cost/run last 30, errors/run last 30.
- Auth: gated on `is_admin` JWT claim (added in P5.0).
- Playwright E2E: `tests/e2e/react/test_admin_pipeline_runs.py`.

#### P5.3 Alerting (Discord webhook — NOT Telegram, NOT MCP)

`workers/austlii-scraper/src/alerts.ts`:

```ts
export async function alertDiscord(env: Env, severity: 'warn'|'page', message: string) {
  // Discord channel webhook — POST JSON {content, username}. No bot token needed.
  // Webhook URL is the only secret; rotate by recreating the channel webhook.
  const sevEmoji = severity === 'page' ? '🚨' : '⚠️';
  const body = JSON.stringify({
    content: `${sevEmoji} **[${severity.toUpperCase()}]** ${message}`,
    username: 'IMMI-Cron',
  });
  await fetch(env.ALERT_DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}

// LEGACY (replaced by alertDiscord above; retained as comment for historical context only):
// export async function alertTelegram(env: Env, severity: 'warn'|'page', message: string) {
  // Direct HTTPS POST — MCP routers are operator-local, unreachable from Workers.
//   await fetch(`https://api.telegram.org/bot${env.ALERT_TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
//       chat_id: env.ALERT_TELEGRAM_CHAT_ID,  // (legacy Telegram path, replaced by Discord webhook above)
      text: `[${severity.toUpperCase()}] ${message}`,
      parse_mode: 'Markdown',
    }),
  });
}
```

Triggers (called from `scheduled()` and queue consumers):
- DLQ message count > `DLQ_WARN_THRESHOLD` since last run.
- `pipeline_runs.cost_usd >= 0.6 × cap` (warn) / `>= cap` (page).
- Run status `aborted` or `failed`.
- **Zero-discovery for 2 consecutive *biweekly* runs** (only count runs where `isBiweeklyTick=true` — off-week ticks don't count, eliminating 4 false-pages every 14 days).
- Schema drift detected.
- Monthly cost aggregate > `PIPELINE_MONTHLY_HARD_CAP_USD=$10` (Q2a-locked hard cap, 2 runs × $5).

**Acceptance:**
- Synthetic DLQ injection → Discord webhook alert < 60s (channel message visible in user's server).
- `/admin/pipeline-runs` renders 30 staging runs; non-admin user redirected.
- Zero-discovery alert fires only on biweekly ticks (off-week ticks don't trigger).

---

## Section C — ADR

### ADR-001: Cloudflare-native biweekly extraction pipeline (Opt-D primary, Opt-A fallback)

**Status:** APPROVED — iteration #2 consensus + iteration #3 user-facing tightening (Gemma 4 verified, Browser Rendering Tier-2 added)

**Decision:** Build the pipeline as Workers cron + queue + R2 + service-binding into the existing `flask-v22` DO container for extraction (Opt-D). The Worker owns discovery, scraping orchestration, queue routing, cost cap (CostCapDO), idempotent upsert with allow-list + audit log + reversible rollback script, and observability. The container owns extraction (regex + LLM via dedicated `immi-extract` AI Gateway slug). If the P0.6 container smoke gate fails, downgrade to Opt-A (Worker-native TS extractor, 8 fields) with documented user sign-off on Q5 (14→8 field regression).

**Drivers:**
1. Latency tolerance is loose (hours).
2. LLM $/case budget — target ≤ $0.002/case, per-run cap $5, monthly hard alert $30.
3. Blast radius — must not corrupt 149K-row prod table.
4. **Feature parity vs porting cost** — Python pipeline ships 14 fields; TS port ships 8. The user prompt also mentioned "data-mining" (analytics work, deferred to a follow-up ADR) and "data-cleaning" (also deferred — bound by CLAUDE.md 2026-05-02 cleanup-rule). Parity-is-primary because Opt-A's narrower 8-field extractor would silently regress the data surface those follow-ups will need; once we ship a regression we cannot un-ship it without retro-extraction across 149K rows.

**Alternatives considered:**
- **Opt-A (Worker-native TS extractor):** 14→8 field regression; 4-week parity soak; +5d ENG. **REJECTED 2026-05-10** (Q5 hard requirement: 14 fields mandatory). On P0.6 smoke-gate failure, the correct path is "delay + fix container" (prewarm, smaller batch, sibling DO), NOT downgrade. Documentation retained for completeness but Opt-A is no longer a runtime fallback.
- **Opt-B (CF cron → Mac Mini GitHub Action):** rejected — violates "on the cloud", Mac Mini SPOF.
- **Opt-C (cloud scrape + Mac Mini extract):** rejected as destination; usable as 2-week interim if container option slips.
- **Opt-D (Container-Python in `flask-v22` DO):** **chosen** — zero porting, full 14-field parity, ~5 days saved, container already owns the read+write Flask path so no new failure-domain introduced.

**Why chosen:**
- Matches "use cloudflare infrastructure" requirement (everything runs on Workers/DO/Hyperdrive/R2/Queue).
- Zero porting work preserves all 14 field fill-rates documented in CLAUDE.md.
- Container failure-domain already exists for read+write traffic; extraction adds no new SPOF beyond what `immi.trackit.today` already depends on.
- Idempotent upsert + audit log + insert-only soak + reversible rollback directly address 2026-05-02 judges-cleanup failure mode.
- Worker still owns DB writes (allow-list + audit), so blast radius of a bad container response is bounded by the Worker-side guards.

**Consequences:**
- **+~7–9 days** ENG (Opt-D, including the new P3.0 extraction-library refactor) or **+~12–14 days** (Opt-A fallback).
- **+~$5–8/month** AI Gateway spend (REVISED 2026-05-10 after Gemma 4 verification + user-locked $5/run cap: 1,500 cases × $0.0017/case × 2 runs ≈ $5.10 expected; per-run hard cap **$5 strict** (Q2a); monthly hard cap **$10** (2 × $5, revised down from prior $30 alert)) **plus container CPU ~$0.5–2/month** (assumption: 50min/run × 2 runs/mo × current Workers Container DO CPU rate; container is already running for Flask reads, this is the marginal cron overhead) **plus Browser Rendering Tier-2: $0/month expected** (2.5h/month footprint within Workers Paid free 10h/month tier; overage capped at 9h via `BROWSER_RENDERING_MONTHLY_BUDGET_SECONDS=32400` → $0 unless cap raised).
- **+1 cron schedule + 2 queues + 1 KV namespace + 1 DO class + 1 service binding + 1 browser binding + 1 AI binding + 4 split migrations** to operate.
- Container CPU shared with LLM Council + Flask reads — soft contention; mitigated by EXTRACT_QUEUE consumer `max_concurrency=1` (one Worker→container batch at a time) plus 50-case batch.
- Mac Mini Python pipeline retained as documented emergency fallback runbook.
- **Refresh-token revocation 7-day gap** unchanged; cron uses service-role binding so JWT lifecycle doesn't apply.

**Follow-ups (post-launch, separate ADRs):**
1. **Soak-end gate for `PIPELINE_INSERT_ONLY=false` flip (explicit, all-of):** flip only after **ALL** of —
   1. **5 consecutive successful biweekly runs** (≥10 weeks elapsed) with `pipeline_runs.status='ok'`.
   2. **Zero per-field fill-rate regression** vs the frozen 100-fixture golden set (per-field thresholds from §A.5 E2E assertions: applicant_name ≥95%, decision_date ≥99%, outcome ≥90%, visa_subclass ≥95%, country ≥85%, is_represented ≥80%, representative ≥75%, judges ≥95%).
   3. **`extraction_audit.errors_json` < 1% of rows** over the 5-run window.
   4. **Operator dry-run** of post-flip path on `LIMIT 100` with eyeball against `case_texts/*.txt` ground truth (CLAUDE.md 2026-05-02 cleanup-rule, applied verbatim).
   5. **Discord-channel operator confirmation message** recorded in `pipeline_runs.notes` for the run that immediately precedes the flip (operator types confirmation in the alert channel; cron consumer reads next message via Discord API or operator pastes message-id manually into `pipeline_runs.notes`).
   Plus the existing CLAUDE.md 2026-05-02 mechanical preconditions: (a) `<col>_backup_<runid>` snapshot column for each ALLOWED_FIELDS column, (b) Supabase Free tier daily backups verified Dashboard-restorable. The flip itself is a deliberate decision recorded in a separate ADR; "soak passed" is necessary but not sufficient.
2. **Out-of-scope: data-mining and historical retro-cleanup.** User prompt mentioned both; deliver in separate ADRs once extraction telemetry is stable.
3. Decide whether to re-run extraction across all 149K historical rows (data-mining ADR; not in scope here).
4. Move Federal Court (FCA) source fallback if AustLII rate-limits cron path (current AustLII mirror is the only source; `search2.fedcourt.gov.au` DNS broken).
5. Refresh Gemma 4 / Workers AI model id every 6 months; `model-id-resolver.test.ts` runs weekly in CI as canary against the Cloudflare AI Gateway compat endpoint.
6. Soak cadence decision (Q3): pick 10-week biweekly OR 4-week weekly during soak; both yield ≥5 control-chart samples.
7. **(Optional, Rev 41 — Q6 deferred to user)** Smoke-gate dual-path scaffold: scaffold a minimal Opt-A Worker module in parallel with Opt-D so a P0.6 smoke failure can rollback in hours not days. **Pros:** smoke-fail rollback hours not days; insurance against an unexpected container constraint discovered post-merge. **Cons:** +0.5d P0 effort; some maintenance overhead until Opt-D proves stable. **Recommendation:** defer to operator schedule pressure — see Q6 in open-questions.

---

## Open clarifying questions for the user

1. **Gemma version & endpoint** — **RESOLVED 2026-05-10 by official Cloudflare docs verification.** Decision: **`workers-ai/@cf/google/gemma-4-26b-a4b-it`** via AI Gateway compat (Workers AI model routed through `cf-aig-authorization: Bearer ${CF_AIG_TOKEN}` for unified billing; same gateway as LLM Council). 256K context, MoE 26B/4B, Function calling + Reasoning + Vision capable, $0.10/M input + $0.30/M output (3.45× / 1.85× cheaper than Gemma 3 12B). Explicitly NOT Gemma 3 12B — deprecating 2026-05-30. Fallback chain locked: Llama 4 Scout 17B 128K ctx → `gemini-2.5-flash` via compat. **No user action required.**

2. **Decomposed cost questions:**
   - **Q2a (numeric):** Per-run hard cap $5 / monthly hard alert $30 — confirm or adjust.
   - **Q2b (alerting channel) — RESOLVED 2026-05-10**: **Discord** (NOT Telegram). User adds a new channel in existing Discord server, generates a webhook URL, sets `ALERT_DISCORD_WEBHOOK_URL` Wrangler secret. No bot token needed. **Single secret** to manage. **Pending:** user generates the webhook and runs `wrangler secret put ALERT_DISCORD_WEBHOOK_URL`.

3. **Soak window length & cadence — RESOLVED 2026-05-10**: **Option α — 10 weeks biweekly** (5 prod-shape runs minimum, control-chart baseline). Locked in §A.5 + §C Follow-up #6 + soak-end gate criterion #1.

4. **(NEW) Ground-truth source for parity testing** — Plan assumes operator hand-labels a frozen 100-fixture set (court-stratified). Confirm, or is a vendor labelling service preferred? (Self-labelling is the default unless you say otherwise.)

5. **Field-parity acceptance — RESOLVED 2026-05-10**: **14 fields are MANDATORY**. User stated: "I want new cases to match what current cases have, so must be 14 fields". This makes **Opt-A no longer a viable fallback** — if P0.6 container smoke gate fails, the correct response is **delay release + fix container** (add prewarm, reduce batch, dedicate a sibling DO container to extraction), NOT downgrade to 8-field Opt-A. Plan elsewhere (§A.3, §C ADR, P0.6 acceptance) updated accordingly. Opt-A retained ONLY as documentation of why it was rejected — not as runtime fallback.

---

## Plan Summary

**Plan saved to:** `.omc/plans/biweekly-cloud-extraction-pipeline.md`

**Scope:**
- 6 phases (P0, P1, P2, **P3.0** prereq lib refactor, P3, P4, P5) extending `workers/austlii-scraper/` + `immi_case_downloader/extraction/`, 4 new Supabase migrations (each with `_down.sql`), 1 new container endpoint (Opt-D), 1 new React admin page.
- Estimated complexity: **HIGH** (autonomous writes to 149K-row prod, multi-component cloud orchestration, RLS-bypass connection, Python lib refactor with byte-identical-CSV regression test).
- ~1,500 LOC new (Opt-D) or ~2,050 LOC (Opt-A fallback) + 100 fixtures, **~7–9 days core ENG + 10 weeks (or 4 weekly) soak**.

**Key Deliverables:**
1. Biweekly Cloudflare cron in `austlii-scraper` Worker that auto-discovers + scrapes + (Opt-D) calls container `/internal/extract` + upserts new AustLII cases.
2. AI Gateway integration with Gemma via dedicated `immi-extract` slug (separate cost analytics from `immi-council`).
3. Idempotent Hyperdrive upsert with allow-list, audit log, intra-run COALESCE, insert-only soak, reversible `rollback_run.ts`, single-env-var kill switch with per-message drain.
4. Observability stack: `pipeline_runs` + `extraction_audit` tables, React `/admin/pipeline-runs` page (gated on new `is_admin` claim), Discord webhook alerting with biweekly-only zero-discovery filter.
5. Staging-first rollout: clone table, 10-week (or 4-week weekly) soak, gated flip to prod with 2026-05-02 cleanup-rule pre-flip checklist.

**Consensus mode artifacts:**
- RALPLAN-DR: 5 principles, 4 decision drivers (parity added), 4 options (D chosen, A fallback, B/C invalidated).
- Pre-mortem: 5 scenarios (rate-limit, cost runaway, silent corruption, RLS-bypass abuse NEW, CPU-cap poison-loop NEW, model deprecation NEW).
- Expanded test plan: unit / integration / load / E2E-staging / Playwright / observability layers.
- ADR-001 with Decision/Drivers/Alternatives/Why/Consequences/Follow-ups.

**Awaiting:** Architect + Critic re-review (iteration #2 of ralplan deliberate consensus loop, post-tightening).

---

## Section D — Iteration Changelog (iterations #1 + #2)

Each row: revision number → addressed (Y) or rejected (R) → location/notes.

| # | Revision | Status | Where addressed |
|---|---|---|---|
| 1 | Add Opt-D Container-Python in `flask-v22` DO with same rigor as A/B/C | Y | §A.3 Opt-D block; chosen over Opt-A; smoke-gate P0.6 decides |
| 2 | Add 4th decision driver "Feature parity vs porting cost" | Y | §A.2 driver #4 |
| 3 | Replace MCP Telegram refs with direct Bot API HTTPS POST | Y | §B P0.3, P5.3, alerts.ts code |
| 4 | Replace KV cost accumulator with `CostCapDO` (strong consistency) | Y | §A.1 #1, §B P0.2 DO binding, P3.3 CostCapDO, P3-OptD code |
| 5 | Operationalize `rollback_run.ts` script | Y | §B P4.2; tests in §A.5 unit + soak gate |
| 6 | Drop `title` from `case_id` hash; add normalize() | Y | §B P1.1 `caseIdOf()`; §A.5 unit test `case-id-normalize.test.ts` |
| 7 | Per-message kill-switch on PIPELINE_ENABLED | Y | §B P1.2, P2 #2, P3-OptD `handleExtractBatch`; test `kill-switch.test.ts` |
| 8 | Fix `isBiweeklyTick` to epoch-anchored `Math.floor(ts/86_400_000/14)%2===0` | Y | §B P1.3; §A.5 unit `biweekly-tick.test.ts` covers DST/leap/year-boundary |
| 9 | Replace MAX(decision_date) watermark with fixed lookback window | Y | §B P1.1 logic step 1 (explicit explanation of late-publish gap) |
| 10 | `ALLOWED_FIELDS` runtime schema validation (warn, not fail) | Y | §B P4.1 `assertSchemaConsistent`; §A.5 unit `schema-drift.test.ts` |
| 11 | Insert-only race fix — intra-run COALESCE | Y | §B P4.1 upsert SQL with `last_extraction_run_id = EXCLUDED.last_extraction_run_id` guard |
| 12 | Per-field parity bars + frozen 100-fixture golden set | Y | §A.5 E2E assertions (8 named bars); §B P0.5 fixture creation |
| 13 | Drop "regex confidence > 0.85"; deterministic match rule | Y | §B P3-OptA fallback explicit "no score, no threshold"; Opt-D inherits from Python pipeline |
| 14 | Scope statement: data-cleaning + data-mining honesty | Y | Plan header scope statement; §C Follow-ups #2 |
| 15 | Add S4 RLS-bypass + S5 CPU-cap poison-loop pre-mortems | Y | §A.4 S4, S5 |
| 16 | Add Playwright E2E for `/admin/pipeline-runs` | Y | §A.5 Playwright section; §B P5.2 |
| 17 | Add load test for 5,000-case surge | Y | §A.5 load-test section `surge-load.test.ts` |
| 18 | Add transaction-boundary test for `set_config(..., true)` | Y | §A.5 integration `transaction-isolation.test.ts` |
| 19 | Tighten cost estimate to ±20% with breakdown | Y | §C Consequences ($10–15/mo expected, $30 hard cap) |
| 20 | Soak duration extension — pick α (10wk biweekly) or β (4wk weekly) | Y | §A.5 E2E soak section; §C Follow-ups #6; Q3 |
| 21 | Split migrations + `_down.sql` reversal | Y | §B P0.1 four files (001/002/003/004) each with _down |
| 22 | Bootstrap baseline `p90` before P1 ships | Y | §B P0.4 (was Follow-up, promoted to P0) |
| 23 | Distinguish off-week from silent failure in zero-discovery alert | Y | §B P5.3 "only count biweekly ticks" |
| 24 | Dedicated AI Gateway slug `immi-extract` | Y | §B P0.2 `LLM_EXTRACT_CF_GATEWAY_URL`; §C key-deliverables #2 |
| 25 | Verify `is_admin` JWT claim exists; add P5.0 if absent | Y | §B P5.0 (verified absent via `grep` 2026-05-10; migration 005 added) |
| 26 | Add Q4 (ground-truth source) | Y | §Open-Q #4 |
| 27 | Add Q5 (field-parity regression acceptance) | Y | §Open-Q #5 |
| 28 | Decompose Q2 → Q2a (numeric) + Q2b (channel) | Y | §Open-Q #2 |
| 29 | Update ADR Alternatives to reflect Opt-D | Y | §C Alternatives + Why-chosen sections |
| 30 | Verify Gemma 3 model id; add S6 model-deprecation pre-mortem | Y | §A.4 S6; §B P0.2 var; §A.5 unit `model-id-resolver.test.ts`; Context7 verification flagged in §C Follow-ups #5 |

### Iteration #2 (post-Critic-tightening, 2026-05-10)

| # | Revision | Status | Where addressed |
|---|---|---|---|
| 31 | Insert P3.0 extraction-library refactor (Python `extract_regex` / `extract_llm` did not exist; P3.2 imports broken) | Y | New §B P3.0 section + phase-ordering table row + P3.2 imports updated; effort 1d added; Plan Summary 7–9d total; ADR Consequences updated |
| 32 | Resolve N-2 header literal mismatch (Flask 403s 100% as written) — keep `X-Internal-Route: worker`, add `X-Internal-Route-Subtype: cron-extract` | Y | §B P3.1 Worker `headers` block + §B P3.2 Flask guard reads subtype; new pytest `test_internal_extract_route_requires_worker_literal` in §A.5 |
| 33 | N-3 reconcile EXTRACT_QUEUE consumer concurrency vs single-batch mitigation — set `max_concurrency=1` (was 4) | Y | §B P0.2 wrangler.toml comment + value; §A.3 Opt-D Cons rewritten to use `max_concurrency=1`; new `tests/load/cron-with-user-traffic.test.ts` in §A.5 |
| 34 | N-4 fix: container returns per-field `source` directly — Worker writes `extraction_audit.source` from container output, not from confidence threshold (could never write `'timeout'`/`'rollback'`) | Y | §B P3.2 response shape now `{value, confidence, source}` per field plus `timeouts: []`; §B P4.1 audit-log writer rewritten; row 13 of iteration-#1 changelog clarified by this row (deterministic match rule applies to Opt-A only; Opt-D now writes container-supplied source verbatim) |
| 35 | Add Python (pytest) test coverage to §A.5 — container endpoint + extraction libs are critical-path under Opt-D | Y | New `tests/test_extraction_regex.py`, `tests/test_extraction_llm.py`, `tests/test_internal_extract.py` in §A.5; §A.5 preface notes dual-stack (Vitest + pytest) |
| 36 | N-5 oc location pinning verification | Y | §B P0.6 acceptance bullet for `wrangler tail` + `cf.colo` regex `^(SYD|MEL|AKL|PER)$` |
| 37 | Soak-end gate criterion explicit (CLAUDE.md 2026-05-02 prevention) | Y | §C Follow-up #1 rewritten as 5-criterion all-of gate plus mechanical preconditions |
| 38 | Cost table: add container CPU line | Y | §C Consequences cost block now includes `+ container CPU ~$0.5–2/mo` with assumption documented |
| 39 | Wording fix: A.1 Principle #3 isolation under Opt-D | Y | §A.1 Principle #3 reworded — discovery uses `HYPERDRIVE_SERVICE`, extraction inherits Flask container's existing service-role pool |
| 40 | §C ADR Drivers wording (data-mining leak) | Y | §C Drivers row #4 reworded — "data-mining" / "data-cleaning" both flagged as deferred-ADR follow-ups; parity-is-primary rationale tightened |
| 41 | (OPTIONAL) Smoke-gate dual-path scaffold | Y (deferred) | New §C Follow-up #7 documents the +0.5d trade-off; new Q6 in open-questions.md flags as operator decision |

**Rejected:** none. All 11 iteration-#2 revisions addressed (Rev 41 is documented and deferred to operator per its OPTIONAL flag).

### Iteration #3 (user-facing tightening — Gemma 4 verified + Browser Rendering Tier-2, 2026-05-10)

User asked to verify "Gemma 4" against official docs and to weigh in on browser-based scraping with cost/quality balance. Decisions made by operator+planner with hard-evidence from Cloudflare official docs (no consensus loop required — these are factual updates, not architectural disputes).

| # | Revision | Status | Where addressed |
|---|---|---|---|
| 42 | **Q1 RESOLVED**: Gemma 4 26B A4B verified live on Cloudflare Workers AI (announced 2026-04-04). Model id `@cf/google/gemma-4-26b-a4b-it`. **256K context** (not 110K as user remembered — better). Pricing $0.10/M input + $0.30/M output (3.45×/1.85× cheaper than Gemma 3 12B). MoE 26B/4B active. Function calling + Reasoning + Vision capable. Routed via AI Gateway compat with `model="workers-ai/@cf/google/gemma-4-26b-a4b-it"`, preserving `cf-aig-authorization: Bearer ${CF_AIG_TOKEN}` unified billing (same gateway pattern as LLM Council). | Y | Q1 in Open Questions marked RESOLVED; §B P0.2 vars `LLM_GEMMA_MODEL` updated; §A.3 Opt-D summary updated; §A.4 S2 cost math updated; §A.4 S6 rewritten (primary Gemma 4, fallback Llama 4 Scout); §A.5 unit tests refreshed; §C Consequences cost revised $5–8/month |
| 43 | **Gemma 3 12B explicitly rejected as fallback** — verified planned deprecation 2026-05-30 in official Cloudflare docs (20 days from plan finalisation). Fallback chain locked: Llama 4 Scout 17B 128K → `gemini-2.5-flash` via compat. | Y | §A.4 S6 explicit deprecation note; §B P0.2 `LLM_GEMMA_FALLBACK=workers-ai/@cf/meta/llama-4-scout-17b-16e-instruct`; `model-id-resolver.test.ts` asserts gemma-3-12b NOT in chain |
| 44 | **Browser Rendering Tier-2 fallback added** — Cloudflare official docs verified: Workers Paid plan includes 10 browser-hours/month + 10 concurrent browsers free; biweekly footprint estimated at 2.5h/month is 4× under free tier. **Decision: keep Tier-1 HTTP fetch as default (free, ~1s/page, AustLII is server-rendered HTML so JS not needed); only escalate to Browser Rendering when SCRAPE_QUEUE consumer hits 5× consecutive 410/403 on a batch (real-Chrome fingerprint defeats AustLII bot-detection that blocks Cloudflare egress IP signatures).** Cost-quality balance: $0/month expected, full-Chrome quality only when needed. | Y | §A.3 Opt-D summary mentions Tier-2; §A.4 S1 mitigation includes Tier-2 escalation; new §A.4 S7 pre-mortem for Tier-2 cost runaway with $32,400-second hard cap; §A.5 new `tier2-browser-rendering.test.ts`; §B P0.2 wrangler `[browser] binding = "MYBROWSER"` + `[ai] binding = "AI"` for Workers AI; §B P0.2 vars `BROWSER_RENDERING_MONTHLY_BUDGET_SECONDS=32400`, `BROWSER_NAV_TIMEOUT_MS=30000`, `TIER2_TRIGGER_CONSECUTIVE_FAILS=5`; §C Consequences "+1 browser binding + 1 AI binding" + cost line "Browser Rendering Tier-2: $0/month expected" |
| 45 | **ADR status bumped** — "Proposed (iter #1)" → "APPROVED — iter #2 consensus + iter #3 user-facing tightening" since Architect+Critic both APPROVE'd iter #2 and iter #3 only adds factual updates not architectural changes. | Y | §C ADR-001 Status line |

**Net cost impact iter #3**: monthly LLM spend revised **$10–15 → $5–8** (Gemma 4 cheaper than originally assumed); Browser Rendering adds $0 expected with hard cap $0–$3.6/month if Tier-2 saturates free tier; net total still well under $30 hard alert cap.

**Net architecture impact iter #3**: 2 new bindings (`MYBROWSER` for Tier-2, `AI` for Workers AI), 0 new failure-domains (both are managed CF primitives), 1 new pre-mortem scenario (S7 Tier-2 budget). 0 LOC change to existing closed-loop revisions 1–41.

**Open questions remaining**: Q4 (golden-fixture labelling source — defaults to operator self-labelling unless overridden), Q6 (smoke-gate dual-path scaffold — defaults to defer). Q1 + Q2a + Q2b + Q3 + Q5 closed by iter #3+#4 (see below).

### Iteration #4 (user Q2/Q3/Q5 answers locked-in, 2026-05-10)

User answered Q2a, Q2b, Q3, Q5 in chat. Q4 defaults to self-labelling. Q6 stays deferred. All architectural and operational ambiguities resolved.

| # | Revision | Status | Where addressed |
|---|---|---|---|
| 46 | **Q2a RESOLVED**: $5/run hard cap; scrape happens only once every 2 weeks → **monthly hard cap $10** (revised down from prior $30 alert). | Y | §B P0.2 vars `PIPELINE_RUN_COST_CAP_USD=5` + `PIPELINE_MONTHLY_HARD_CAP_USD=10`; §C Consequences cost line; Open Questions Q2a marked RESOLVED |
| 47 | **Q2b RESOLVED**: Discord webhook (NOT Telegram). User adds new channel in existing Discord server, generates webhook URL, sets `ALERT_DISCORD_WEBHOOK_URL` Wrangler secret. Single secret, no bot token. Worker fires `fetch(webhook_url, {method:'POST', body: JSON.stringify({content, username:'IMMI-Cron'})})`. | Y | §B P0.3 secret list rewritten; §B P5.3 `alertDiscord()` function replacing `alertTelegram()`; §B P5.3 acceptance test updated; §C Plan-Summary observability stack updated; §B Discovery summary line updated; §C Follow-up #1 criterion 5 (operator confirmation) updated to Discord channel |
| 48 | **Q3 RESOLVED**: Option α — **10 weeks biweekly soak (5 prod-shape runs)** locked. β rejected. | Y | §A.5 soak-window references; §C Follow-up #1 criterion 1 + Follow-up #6 simplified; Open Questions Q3 marked RESOLVED |
| 49 | **Q5 RESOLVED — HARD CONSTRAINT**: 14 fields are MANDATORY. User: "I want new cases to match what current cases have, so must be 14 fields". **Opt-A is no longer a viable fallback** — on P0.6 smoke-gate failure, response is "delay + fix container" (prewarm, smaller batch, sibling DO container for extraction), NOT downgrade. Opt-A retained only as ADR documentation of "considered + rejected", not as runtime path. | Y | §C ADR Alternatives Opt-A row marked REJECTED with explicit rationale; §C ADR Status line updated; Open Questions Q5 marked RESOLVED; §B P0.6 acceptance reframed as "block release if any check fails" rather than "downgrade to Opt-A"; §A.3 Opt-A block annotated as historical only |
| 50 | **Q4 default applied**: golden-fixture labelling source defaults to **operator self-labelling** (court-stratified 100-fixture set: AATA 35, FCA 20, FCCA 15, FedCFamC2G 10, ARTA 10, RRTA 5, MRTA 5). User did not override. | Y (default) | §B P0.5 fixture-creation task; §A.5 unit-test ground-truth references; Open Questions Q4 marked DEFAULT-APPLIED |
| 51 | **Q6 stays deferred**: smoke-gate dual-path scaffold not built (was OPTIONAL +0.5d effort). With Q5 resolution making Opt-A no longer a fallback, the scaffold is doubly-redundant — there is nothing to scaffold a dual-path TO. **Removed from active follow-ups.** | Y | §C Follow-up #7 marked CLOSED (no scaffold needed because Opt-A is rejected) |

**Net architecture impact iter #4**:
- −1 alerting integration (Telegram removed) +1 alerting integration (Discord webhook) = neutral
- −1 fallback path (Opt-A no longer runtime fallback) → simplifies P0.6 acceptance ("block on fail" vs "downgrade decision")
- Monthly cost hard cap tightened $30 → $10 (3× tighter)
- 0 new failure-domains, 0 LOC change to closed-loop revisions 1–45

**Net operational impact iter #4**:
- Operator must create Discord channel + webhook before P5.3 deploys (one-time setup, ~2 min in Discord UI)
- P0.6 failure now blocks release (no degraded-mode option) — stricter risk posture matching user's "must be 14 fields" constraint
- Soak duration locked at 10 weeks biweekly = 5 runs minimum before flip

**No further user open questions blocking execution.** Q4 default + Q6 deferral mean the plan is ready for `/oh-my-claudecode:team` parallel execution.
