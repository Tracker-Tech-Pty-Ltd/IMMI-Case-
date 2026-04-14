# RC#4 — Analytics Query Performance Root Cause

## Observed timings
- `/api/v1/analytics/judge-leaderboard` cold: 5.68s (per Phase 1 baseline)
- `load_analytics_cases()` cold: ~13s (per code comment at api.py:1148)
- Script measured actual REST path before timeout: 97 pages completed (~19.5s) then `statement_timeout` at page ~97-100

## Measured breakdown (live Supabase free tier, 2026-04-14)

| Component | Time | Notes |
|---|---|---|
| Network RTT (TCP avg) | 30.7 ms | First connect 73ms, warm 8-10ms |
| Supabase single-row SELECT | 976.7 ms | First HTTP request includes TLS + cold start |
| COUNT(*) exact | 72.4 ms | Fast — uses index scan |
| Page 1 (rows 0–999) | 180 ms | Baseline page cost |
| Page 10 (rows 9000–9999) | 254 ms | Growing due to OFFSET scan |
| Page 30 (rows 29000–29999) | 1054 ms | Linear growth confirmed |
| Page 50 (rows 49000–49999) | 1516 ms | |
| Page 70 (rows 69000–69999) | 1883 ms | |
| Page 90 (rows 89000–89999) | 2892 ms | ~16x slower than page 1 |
| Page 97 | TIMEOUT | `canceling statement due to statement timeout` (code 57014) |
| Python aggregation | ~50ms (estimated) | Groupby on dicts is cheap |

**Script output snippet (pages 90–97):**
```
Page 90: offset=89000, rows=1000, time=2892ms
Page 91: offset=90000, rows=1000, time=2856ms
Page 93: offset=92000, rows=1000, time=2859ms
Page 95: offset=94000, rows=1000, time=2777ms
Page 97: offset=96000, rows=1000, time=2409ms
→ APIError: canceling statement due to statement timeout (PostgreSQL code 57014)
```

## Root cause (95% confidence)

**PostgreSQL `OFFSET` sequential scan causes super-linear page cost growth: each page at offset N must skip N rows before returning 1,000 rows, making the full 149-page paginated load impossible to complete within Supabase free-tier `statement_timeout`.**

Specifically:
1. `load_analytics_cases()` uses `.range(offset, offset+999)` which translates to `LIMIT 1000 OFFSET N` in SQL
2. PostgreSQL has no "fast skip" for heap scans — it must physically traverse all N prior rows
3. Pages 1–16 complete in <300ms each, pages 17–50 in 400–1500ms, pages 70–97 in 1800–2900ms
4. By page ~97 (96,000 offset), the query hits Supabase's `statement_timeout` and aborts
5. Python aggregation (groupby + sort) is fast (~50ms) — NOT the bottleneck
6. Network RTT adds ~8-10ms per page (warm) = ~1.2s total for 149 pages = minor factor

The code comment saying "~13s" appears to be an optimistic measurement (possibly from a warm database or fewer total rows). The actual cold-path exceeds Supabase's timeout before all 149,016 rows are fetched.

**Why cache hides this**: The 5-min TTL cache means the first request after expiry always pays this full cost. Without auto-refresh, a user hitting the page exactly when cache expires triggers the full timeout path. The existing `_fill_analytics_cases_cache()` warmup runs at startup only — not periodically.

## Proposed fix

**Minimum-viable (low risk, ~30 min effort):**
Switch `load_analytics_cases()` to use the existing server-side RPC functions (`get_analytics_judges_raw()`, `get_analytics_outcomes()`, etc.) for the judge-leaderboard endpoint specifically. These functions run as `SECURITY DEFINER` with `SET LOCAL statement_timeout = '30s'` and return pre-aggregated results (~15k rows for judges, ~500 rows for outcomes) instead of all 149k raw rows.

The `/api/v1/analytics/outcomes`, `/api/v1/analytics/judges`, `/api/v1/analytics/legal-concepts`, and `/api/v1/analytics/nature-outcome` endpoints already use this RPC path and return in ~2-5s.

**The `judge-leaderboard` endpoint is the outlier**: it calls `_get_analytics_cases()` (full 149k row load) instead of the RPC functions used by its siblings. The fix is to switch it to use `get_analytics_judges_raw()` RPC + Python post-processing, matching the pattern already established for `/analytics/judges`.

**Risk**: Low — RPC functions already exist, already work for similar endpoints, and the Python normalisation logic (`_judge_identity()`, `_judge_profile_payload()`) is decoupled from the data source.

**Effort**: ~30 min to wire `analytics_judge_leaderboard()` to RPC path + update cache strategy.

**Secondary fix (medium risk, 1-2h):**
For any endpoint that still needs all 149k rows, replace paginated `OFFSET` with keyset pagination (`WHERE case_id > last_id ORDER BY case_id`) to achieve constant ~180ms per page regardless of offset. This eliminates the quadratic scan entirely.

**RC#1 (auto-refresh) still needed?** YES — even after the fix above. The RPC-based endpoints still take 2-5s cold. Auto-refreshing the cache every 4 minutes means no user ever waits for a cold fetch. RC#1 is complementary, not redundant.

## Open questions

1. **Does the Hyperdrive path work?** `_get_hyperdrive_conn()` returns None outside Cloudflare Workers. In local/Flask mode, all traffic goes through REST pagination. If Hyperdrive were available (single SQL `SELECT ... FROM immigration_cases`), it would bypass the OFFSET problem entirely and complete in ~1-2s.
2. **What is Supabase free-tier `statement_timeout`?** Not confirmed from dashboard — estimated ~8-10s per page based on when timeout fired (~97,000 row offset). The SECURITY DEFINER functions raise it to 30s explicitly.
3. **Does `judge-leaderboard` actually call `load_analytics_cases()` or an RPC?** Confirmed via code reading: `analytics_judge_leaderboard()` calls `_get_analytics_cases()` at line 3351, which calls `repo.load_analytics_cases()` — the paginated REST path, NOT an RPC function.
