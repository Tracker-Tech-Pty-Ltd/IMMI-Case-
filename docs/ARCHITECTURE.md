# Architecture (Production)

**Last verified**: 2026-05-02
**Source of truth for**: how a request actually flows through IMMI-Case
in production.

> If a description in `README.md`, `CLAUDE.md`, or any other doc
> conflicts with this file, **this file wins** for production behaviour.
> Older docs may still describe an earlier Flask-centric architecture
> that has since migrated to Cloudflare Worker + Hyperdrive.

---

## TL;DR

```
                                    ┌─────────────────────────────┐
                                    │  Cloudflare Worker          │
   Browser / API client ───HTTP───►│  workers/proxy.js (44 hdlrs)│
                                    │  • Hyperdrive → Supabase    │
                                    │  • R2 cache for hot reads   │
                                    └────┬───────────────┬────────┘
                                         │               │
                                         │ 99% reads     │ writes / LLM /
                                         │ resolved here │ CSRF / SPA
                                         ▼               ▼
                            ┌────────────────────┐  ┌──────────────────┐
                            │ Hyperdrive         │  │ Flask Container  │
                            │ pooler             │  │ DurableObject    │
                            │ → Supabase Postgres│  │ "flask-v15"      │
                            │   (immigration_*,  │  │ FlaskBackend     │
                            │    judge_bios,     │  │ (Python + flask- │
                            │    pgvector)       │  │  wtf + LLM SDKs) │
                            └────────────────────┘  └──────────────────┘
```

- **Read traffic (~99%)**: Worker → Hyperdrive → Supabase.
  Flask is **never invoked**.
- **Writes (POST/PUT/DELETE)**: Worker → `FlaskBackend` Durable Object
  → Flask container — Python validation, model logic.
- **LLM Council search**: Worker → Flask Container — uses Cloudflare AI
  Gateway via Python SDK. Migration to a pure-Worker LLM Council is
  planned (`.omc/plans/llm-council-worker-migration.md`).
- **CSRF token mint**: Flask only — legacy `flask-wtf` mint that the
  React SPA reads via `/api/v1/csrf-token`.
- **SPA serving**: Worker serves the static React build for `/app/*` and
  `/`; Flask is a fallback only when the Worker doesn't have a route.

---

## Layer 1 — Cloudflare Worker (`workers/proxy.js`, 2,706 lines)

### What it does

| Concern              | How                                                       |
|----------------------|-----------------------------------------------------------|
| Route GET endpoints  | 44 native handlers (verify: `grep -c "^async function handle\\|^function handle" workers/proxy.js`) |
| Database access      | `getSql(env)` creates a per-request `postgres.js` client over Hyperdrive |
| Caching              | R2 / Workers KV for hot reads (filter options, taxonomy, court lineage) |
| Fall-through         | Anything not matched → forward to Flask DurableObject     |
| Error recovery       | If a Hyperdrive handler throws or returns null → Flask fallback |

### Endpoint families (all native Worker, NOT Flask)

```
/api/v1/cases                        handleGetCases
/api/v1/cases/count                  handleGetCasesCount
/api/v1/cases/:id                    handleGetCase
/api/v1/cases/compare                handleCompareCases
/api/v1/cases/:id/related            handleRelatedCases
/api/v1/cases/:id/similar            handleSimilarCases
/api/v1/stats                        handleGetStats
/api/v1/stats/trends                 handleStatsTrends
/api/v1/filter-options               handleGetFilterOptions
/api/v1/court-lineage                handleCourtLineage
/api/v1/data-dictionary              handleDataDictionary       (static JS const)
/api/v1/visa-registry                handleVisaRegistry         (static JS const)
/api/v1/taxonomy/countries           handleTaxonomyCountries
/api/v1/taxonomy/judges-autocomplete handleTaxonomyJudgesAutocomplete
/api/v1/taxonomy/visa-lookup         handleTaxonomyVisaLookup
/api/v1/legislations                 handleLegislationsList
/api/v1/legislations/search          handleLegislationsSearch
/api/v1/analytics/outcomes           handleAnalyticsOutcomes
/api/v1/analytics/judges             handleAnalyticsJudges
/api/v1/analytics/legal-concepts     handleAnalyticsLegalConcepts
/api/v1/analytics/nature-outcome     handleAnalyticsNatureOutcome
/api/v1/analytics/filter-options     handleAnalyticsFilterOptions
/api/v1/analytics/monthly-trends     handleAnalyticsMonthlyTrends
/api/v1/analytics/flow-matrix        handleAnalyticsFlowMatrix
/api/v1/analytics/judge-bio          handleAnalyticsJudgeBio
/api/v1/analytics/visa-families      handleAnalyticsVisaFamilies
/api/v1/analytics/success-rate       handleAnalyticsSuccessRate
/api/v1/analytics/concept-effectiveness handleAnalyticsConceptEffectiveness
/api/v1/analytics/concept-cooccurrence  handleAnalyticsConceptCooccurrence
/api/v1/analytics/concept-trends     handleAnalyticsConceptTrends
/api/v1/analytics/judge-leaderboard  handleAnalyticsJudgeLeaderboard
/api/v1/analytics/judge-profile      handleAnalyticsJudgeProfile
/api/v1/analytics/judge-compare      handleAnalyticsJudgeCompare
/api/v1/judge-photos/:filename       handleJudgePhoto
/api/v1/exports/cases.csv            handleExportCsv
/api/v1/exports/cases.json           handleExportJson
/api/v1/cache/invalidate             handleCacheInvalidate
/api/v1/collections/export           handleCollectionExport
/api/v1/guided-search                handleGuidedSearch
/api/v1/cases  (POST)                handlePostCase             ← writes go through FlaskBackend
/api/v1/cases/:id (PUT)              handlePutCase              ← idem
/api/v1/cases/:id (DELETE)           handleDeleteCase           ← idem
/api/v1/cases/batch (POST)           handleBatchCases           ← idem
/api/v1/search                       handleSearch               ← LLM Council via Flask
```

### Critical conventions

- **Per-request `postgres.js` client**: `getSql(env)` MUST be called per
  request. Module-level singletons cause `Cannot perform I/O on behalf
  of a different request` in Workers. Hyperdrive does the actual pool
  management.
- **Adding a new GET endpoint**: implement in `proxy.js` with
  `getSql(env)` + template literal. **Do NOT add to Flask** just because
  Python is more familiar — that path is not on the production read
  hot path.
- **Tag filtering**: `buildCasesWhere()` returns `null` for the `tag`
  param; Worker falls through to Flask for pipe-delimited array logic.
  This is a pending Worker-port — see CLAUDE.md gotchas.

---

## Layer 2 — Flask Durable Object (`flask-v15`)

### What it still owns

| Surface                          | Why Flask, not Worker?                                  |
|----------------------------------|---------------------------------------------------------|
| POST/PUT/DELETE `/api/v1/cases*` | Python validation (`ImmigrationCase.from_dict`), pandas-style normalisation, regex/LLM extraction pipeline |
| `/api/v1/search` (LLM Council)   | Routes to Anthropic / OpenAI / Gemini via CF AI Gateway. Migration to Worker planned. |
| `/api/v1/csrf-token`             | `flask-wtf` token mint; React SPA reads it on bootstrap. Zero-downtime invariant — don't break this without a Worker replacement first. |
| Unmatched `/api/v1/*` GET        | Safety fallback for endpoints not yet ported            |
| `/`, `/app/*` SPA fallback       | Flask serves the React `index.html` if Worker hasn't matched |

### Wrangler binding

```toml
# wrangler.toml
[[durable_objects.bindings]]
  { name = "FlaskBackend", class_name = "FlaskBackend" }

[[containers]]
class_name = "FlaskBackend"
# Bumped suffix v13 → v14 → v15 to force fresh DO instance during rolling
# image rebuilds without quota lockout. Bumping the suffix again (v16+)
# is intentional — keep stable unless you mean to reset state.
```

The instance ID `"flask-v15"` is referenced as a string in
`workers/proxy.js:2475` — `env.FlaskBackend.idFromName("flask-v15")`.

### What Flask is NOT

- ❌ Not on the read hot path — 99% of reads never reach it
- ❌ Not the API layer for analytics — those are Worker handlers
- ❌ Not where you add new GET endpoints
- ❌ Not the source of truth for endpoint count — `proxy.js` is

---

## Layer 3 — Supabase Postgres + Hyperdrive

### Schema overview (relevant subset)

```
public.immigration_cases       — 149,016 rows × ~38 cols
  ├─ case_id (12-char hex SHA-256 prefix) PK
  ├─ citation, court, judges (text), outcome, visa_*, country_of_origin
  ├─ legal_concepts, embedding (1536-dim pgvector)
  └─ fts (tsvector, FTS5-equivalent via Postgres)

public.judge_bios              — 104 rows
  ├─ full_name, education[], legal_status, notable_cases[]
  └─ (joined on judges field for the JudgeBio analytics handler)

api.law_case_detail            — VIEW (10 cols, used by external CRM)
api.law_case_search_results    — VIEW
api.crm_client_summary         — VIEW (multi-tenant Bsmart project)

core.tenants / core.profiles / core.roles
crm.applications / crm.clients
                               — Bsmart CRM tables, NOT IMMI-Case domain.
                                 Same Supabase project, separate schemas.
```

### Hyperdrive pooler

Configured in Cloudflare dashboard. Cache settings (long-term audit
trail in repo):

- `max_age=10s` (was 60s — reduced to keep hot reads near real-time)
- `stale_while_revalidate=0s` (was 15s — reduced to avoid serving
  stale rows after writes)

These are documented in earlier commit messages:
`infra(hyperdrive): cache max_age 60s -> 10s` and the SWR follow-up.

---

## Request flow examples

### Read: case detail page

```
GET /api/v1/cases/abc123
  ↓
Worker proxy.js → handleGetCase("abc123", env)
  ↓
getSql(env)`SELECT … FROM public.immigration_cases WHERE case_id = ${id}`
  ↓
Hyperdrive pooler → Supabase
  ↓
JSON response
```

Flask is never invoked.

### Read: judge profile

```
GET /api/v1/analytics/judge-profile?name=Kira+Raif
  ↓
Worker → handleAnalyticsJudgeProfile(url, env)
  ↓
SQL aggregations (success rate, court breakdown, recent cases) +
JOIN judge_bios on full_name match
  ↓
JSON response
```

Flask is never invoked.

### Write: edit a case

```
PUT /api/v1/cases/abc123  Body: {...edited fields...}
  ↓
Worker → handlePutCase("abc123", request, env)
  ↓
env.FlaskBackend.idFromName("flask-v15") → forward request to DO
  ↓
Flask container: validate via ImmigrationCase, write to Supabase
  ↓
Worker forwards Flask response back to client
```

### LLM Council search

```
GET /api/v1/search?q=…&mode=council
  ↓
Worker → handleSearch — sub-routed to Flask
  ↓
Flask: parallel calls to OpenAI / Anthropic / Gemini through CF AI Gateway
  ↓
Moderator merges → JSON response
```

Pending migration: `.omc/plans/llm-council-worker-migration.md` plans
to move this fully into the Worker so the Flask container can shed
this surface entirely.

---

## Where the Flask references in older docs come from

| Doc                              | Says                          | Reality 2026-05-02                |
|----------------------------------|-------------------------------|-----------------------------------|
| `README.md` §6.1 mermaid (legacy)| Flask API is the central node | Worker is — Flask is fallback only |
| `README.md` §6.2 sequence (legacy)| `participant API as Flask API` | participant is Worker; Flask only on writes |
| `README.md` §7 project-structure  | "web.py = Web server entry point (Flask factory)" | True for **dev**; production entry is wrangler-deployed Worker |
| `README.md` §12 Tech Stack        | "Backend: Python 3, Flask, …" | Backend is **Cloudflare Worker (JS)** + Flask Container (residual) |
| `README.md` §13 Deployment       | "Flask standalone / Cloudflare Pages" | Cloudflare Worker (custom domain immi.trackit.today) + Flask DO |
| `CLAUDE.md` (older revisions)    | references `flask-v13`        | Current instance ID is `flask-v15` |
| `docs/plans/2026-03-15-*.md`     | Flask-routing plans           | Historical — kept as record       |
| `.omc/plans/llm-council-worker-migration.md` | Plans to remove Flask LLM surface | **Active migration plan**         |

---

## Verification commands

Re-run these to confirm the document hasn't drifted:

```bash
# Worker handler count
grep -c "^async function handle\|^function handle" workers/proxy.js

# Flask DO instance string
grep -E 'idFromName\("flask-' workers/proxy.js | head -1

# Wrangler DO bindings
grep -E "FlaskBackend|class_name|durable" wrangler.toml

# Endpoints implemented in Flask blueprint vs in Worker
grep -E '@bp\.route|@api_bp\.route' immi_case_downloader/web/routes/*.py | wc -l
grep -cE "^async function handle|^function handle" workers/proxy.js
```

If the Worker count drops below 44 or the Flask blueprint count grows
faster than the Worker count, **architecture is regressing** — open
an RFC.
