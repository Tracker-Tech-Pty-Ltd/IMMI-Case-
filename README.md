# IMMI-Case - Immigration Case Downloader & Manager

A Python tool to download, extract, browse, and manage Australian immigration, home affairs, and refugee-related court and tribunal appeal cases from 2000 to present.

Includes a **React SPA** (Vite + TypeScript + Tailwind CSS v4) and a **Flask API** for searching, browsing, editing, and exporting cases. Also synced to **Supabase** (PostgreSQL) for cloud access.

## Data

- **149,016 cases** across 9 courts/tribunals (2000–2026)
- **148,966 with full text** (99.96%) — ~1.9 GB on disk
- **31 data fields** per case (metadata + structured extraction + annotations)
- Synced to Supabase Cloud (Project: Bsmart)

| Court/Tribunal | Code | Cases | Years |
|----------------|------|-------|-------|
| Migration Review Tribunal | MRTA | 52,970 | 2000–2015 |
| Administrative Appeals Tribunal | AATA | 39,203 | 2000–2024 |
| Federal Court of Australia | FCA | 14,987 | 2000– |
| Refugee Review Tribunal | RRTA | 13,765 | 2000–2015 |
| Federal Circuit Court | FCCA | 11,157 | 2013–2021 |
| Federal Magistrates Court | FMCA | 10,395 | 2000–2013 |
| Federal Circuit and Family Court | FedCFamC2G | 4,109 | 2021– |
| Administrative Review Tribunal | **ARTA** | 2,260 | 2024– |
| High Court of Australia | HCA | 176 | 2000– |

Cases are sourced from [AustLII](https://www.austlii.edu.au) (Australasian Legal Information Institute).

> **Court lineage**: FMCA → FCCA → FedCFamC2G (lower court); MRTA+RRTA → AATA → ARTA (tribunal). AATA was abolished Oct 2024; use ARTA for 2025+ cases.

## Setup

```bash
pip install -r requirements.txt

# For React frontend development
cd frontend && npm install
```

## Web Interface

Start the web interface:

```bash
python web.py --port 8080        # http://localhost:8080/app/
python web.py --debug             # Debug mode
```

The React SPA is served at `/app/` and the API at `/api/v1/*`. Legacy Jinja2 templates remain accessible at the original routes (`/`, `/cases`, etc.).

### Search API Gateway Modes

`/api/v1/search` now supports gateway-level mode switching while keeping Supabase as the data backend:

```bash
# Default lexical (PostgreSQL/SQLite full-text path via repository)
GET /api/v1/search?q=judicial+review&mode=lexical

# Pure semantic rerank over lexical candidates
GET /api/v1/search?q=judicial+review&mode=semantic&provider=gemini

# Hybrid (semantic + lexical RRF fusion), with lexical fallback on provider outage
GET /api/v1/search?q=judicial+review&mode=hybrid&provider=openai
```

Query params:
- `mode`: `lexical` | `semantic` | `hybrid`
- `provider`: `openai` | `gemini` (semantic/hybrid only)
- `model`: optional embedding model override
- `candidate_limit`: lexical candidate pool size before semantic rerank

### React Frontend Development

```bash
cd frontend
npm run dev                       # Vite dev server with HMR
npm run build                     # Production build → static/react/
npm run tokens                    # Rebuild design tokens (CSS + TS)
npx vitest run                    # Run 83 frontend unit tests
```

### Web Interface Pages

| Page | What you can do |
|------|-----------------|
| **Dashboard** | Stats: total cases, courts, outcomes, year trends |
| **Cases** | Filter by court, year, visa type, nature, keyword, tags. Table & card views. Batch operations |
| **Analytics** | Success rate calculator, outcome analysis, judge analysis, legal concept intelligence |
| **Judge Profiles** | Leaderboard, individual profiles, win rate analysis, judge comparison |
| **Legislations** | Browse 6 Australian immigration laws (Migration Act 1958, etc.) — bilingual EN/ZH |
| **Case Detail** | Full metadata, catchwords, full text viewer with ToC, related cases |
| **Case Compare** | Side-by-side comparison of 2–5 selected cases |
| **Scrape AustLII** | Batch download full case texts with progress tracking |
| **Smart Pipeline** | 3-phase automated workflow: crawl → clean → download |
| **Data Dictionary** | Reference guide for all 29 data fields |
| **Design Tokens** | Live design token reference with theme presets |

## CLI Usage

### Search for cases

```bash
python run.py search                                    # All sources, last 10 years
python run.py search --databases AATA FCA               # Only AAT and Federal Court
python run.py search --start-year 2020 --end-year 2025  # Custom year range
python run.py search --max-results 1000                 # More results per database
```

### Download full case texts

```bash
python download_fulltext.py       # Bulk download (resumable, saves every 200)
python run.py download --courts FCA --limit 50
```

### Other CLI commands

```bash
python run.py list-databases    # List available databases
python run.py --help            # Full help
```

## Storage Backends

The web interface automatically selects the fastest available backend:

| Backend | Speed | Setup | Use case |
|---------|-------|-------|----------|
| **SQLite** (auto, recommended) | ~0.1s per query | Run migration once | Local development |
| **CSV** (fallback) | ~5s per query | No setup | First run / no migration |
| **Supabase** (cloud) | ~0.3s per query | `--backend supabase` | Multi-user / cloud deploy |

### First-time SQLite setup (one-time, ~15 seconds)

```bash
python migrate_csv_to_sqlite.py    # CSV → SQLite (322 MB, FTS5+WAL)
```

After this, `python web.py` auto-detects `cases.db` and uses SQLite. API response times drop from ~5s to ~0.1–0.5s.

### To use Supabase instead

```bash
python web.py --backend supabase
```

## Output Files

```
downloaded_cases/
  immigration_cases.csv       # All 149,016 cases — 31 columns
  immigration_cases.json      # Same data in JSON format
  cases.db                    # SQLite database (FTS5+WAL) — auto-created by migration
  summary_report.txt          # Summary statistics
  case_texts/                 # Full text files (~142,916 files, ~1.9 GB)
    [2024] AATA 1234.txt
    [2024] FCA 567.txt
    ...
```

## Data Fields (29 total)

### Stage 1: Search metadata (auto-populated from AustLII listing pages)

| Field | Description | Example |
|-------|-------------|---------|
| `case_id` | 12-char SHA-256 hash (citation/URL/title) | `a3f8b2c1d4e5` |
| `citation` | Legal citation | `[2024] AATA 1234` |
| `title` | Case title / parties | `Smith v Minister for Immigration` |
| `court` | Full court name | `Administrative Appeals Tribunal` |
| `court_code` | Court abbreviation | `AATA`, `ARTA`, `FCA`, `FCCA`, `HCA` |
| `year` | Decision year | `2024` |
| `url` | Link to source document | `https://austlii.edu.au/...` |
| `source` | Data source | `AustLII`, `Federal Court` |

### Stage 2: Full text extraction (regex + LLM, from downloaded case files)

| Field | Description | Example |
|-------|-------------|---------|
| `date` | Decision date | `15 March 2024` |
| `judges` | Judge / tribunal member | `Gabrielle Cullen` |
| `catchwords` | Legal topics/keywords | `MIGRATION - Protection visa...` |
| `outcome` | Decision result | `Tribunal affirms the decision` |
| `visa_type` | Visa type involved | `protection visa`, `Subclass 500` |
| `visa_subclass` | Visa subclass number | `500`, `801`, `189` |
| `visa_class_code` | Visa class code | `XB`, `BW`, `VC` |
| `legislation` | Acts/sections cited | `Migration Act 1958 s 36` |
| `text_snippet` | Brief excerpt (first ~300 chars) | |
| `full_text_path` | Local .txt file path | `downloaded_cases/case_texts/...` |
| `case_nature` | Case nature (LLM-extracted) | `Refugee review`, `Visa cancellation` |
| `legal_concepts` | Key legal concepts (LLM-extracted, `;`-separated) | `well-founded fear; complementary protection` |

### Stage 3: Structured party/hearing fields (regex-extracted via `extract_structured_fields.py`)

| Field | Description | Coverage | Example |
|-------|-------------|----------|---------|
| `applicant_name` | Applicant / appellant name | 90.0% | `Khan`, `Sidhu` |
| `respondent` | Respondent name | 32.7% | `Minister for Immigration` |
| `country_of_origin` | Country of origin | 67.8% | `Pakistan`, `China`, `Iran` |
| `visa_subclass_number` | Numeric visa subclass | 91.6% | `866`, `572`, `500` |
| `hearing_date` | Hearing date (may differ from decision date) | 78.7% | `17 February 2025` |
| `is_represented` | Was applicant legally represented? | 42.4% | `Yes`, `No` |
| `representative` | Representative name / firm | 25.1% | `Mr Jones, Counsel` |
| `visa_outcome_reason` | Primary reason for visa outcome (≤300 chars) | 58.7% | `genuine temporary entrant not satisfied` |
| `legal_test_applied` | Primary legal test or section (≤80 chars) | 36.2% | `s.36 refugee test`, `s.501 character test` |

### Stage 4: User annotations (editable via web interface)

| Field | Description | Example |
|-------|-------------|---------|
| `user_notes` | Personal notes/analysis | `Key case for s501 character test` |
| `tags` | Comma-separated labels | `important, character-test, s501` |

## Extraction Pipeline

### LLM field extraction (case_nature, legal_concepts)

```bash
python extract_llm_fields.py    # Process cases in batches via Claude Sonnet
python merge_llm_results.py     # Merge batch JSON results back into main CSV
```

### Structured field extraction (applicant, respondent, country, outcome, etc.)

```bash
python extract_structured_fields.py                    # Process all cases (skips existing)
python extract_structured_fields.py --overwrite        # Re-extract all fields
python extract_structured_fields.py --court AATA       # Only AATA cases
python extract_structured_fields.py --dry-run --sample 500  # Preview 500 cases
python extract_structured_fields.py --workers 8        # 8 parallel workers (~12 min for 149K)
```

### LLM-assisted structured extraction (for cases where regex fails)

Requires `ANTHROPIC_API_KEY` in `.env`:

```bash
python extract_structured_fields_llm.py                # All pending cases
python extract_structured_fields_llm.py --sample 500 --workers 4  # Test run
python extract_structured_fields_llm.py --court AATA   # Only AATA cases
python extract_structured_fields_llm.py --dry-run      # Preview only
```

### Validate extraction quality

```bash
python validate_extraction.py                  # Fill rates + garbage check + samples
python validate_extraction.py --court AATA     # Filter by court
python validate_extraction.py --field country_of_origin  # Sample one field
python validate_extraction.py --compare-to baseline.csv  # Regression check
```

### Cloudflare Workers scraper (bulk full-text)

```bash
python scripts/enqueue_urls.py    # Enqueue URLs → Cloudflare R2
python scripts/sync_results.py    # Download R2 results → local CSV
```

## Analytics & Intelligence Features

The **Analytics page** (`/analytics`) provides lawyer-focused insights:

- **Success Rate Calculator**: Filter by court, year range, visa subclass, case nature, legal concepts → shows win rate + confidence (High: N>100, Medium: N>50, Low: N<50)
- **Outcome Analysis**: Distribution charts, court comparison, nature×outcome heatmap
- **Judge Analysis**: Win rates by judge, court benchmark comparison, judge-to-judge comparison
- **Concept Intelligence**: Legal concept effectiveness, concept trend lines (2000–2026), emerging concepts

**Key data points** (149,016 cases):
- 9 courts/tribunals, 8 outcome types (Affirmed 40%, Remitted 23%, Dismissed 16%...)
- 20+ visa subclasses (Subclass 866 Refugee most common at 30%)
- 15 case natures (Visa Refusal 18%, Judicial Review 17%, Protection Visa 15%...)
- 20+ legal concepts, 15,465 unique judge/member names

## Smart Pipeline

The Smart Pipeline provides a 3-phase automated workflow:

1. **Crawl** — Scrape case metadata from AustLII (year listing → viewdb → keyword search fallback)
2. **Clean** — Deduplicate, fill missing fields, validate data
3. **Download** — Bulk download full case texts (resumable, saves every 200)

## Supabase Cloud

Cases are synced to Supabase (PostgreSQL) for cloud access:

```bash
python migrate_csv_to_supabase.py           # Full sync (upsert all 149,016 cases)
python migrate_csv_to_supabase.py --dry-run # Count only
```

- Project: Bsmart (`urntbuqczarkuoaosjxd`)
- Schema: migrations in `supabase/migrations/`
- All 31 fields available, native full-text search via `to_tsvector`

### pgvector migration + embedding backfill

Apply vector schema migration:

```bash
# In Supabase SQL Editor or via migration workflow:
# supabase/migrations/20260223103000_add_pgvector_embeddings.sql
```

Backfill embeddings for all cases (resumable checkpoint):

```bash
# OpenAI
python3 scripts/backfill_case_embeddings.py --provider openai --resume

# Gemini
python3 scripts/backfill_case_embeddings.py --provider gemini --resume

# Estimate only (no write)
python3 scripts/backfill_case_embeddings.py --provider openai --dry-run --max-cases 5000
```

Notes:
- Checkpoint file: `downloaded_cases/embedding_backfill_checkpoint.json`
- Incremental mode uses `embedding_content_hash` to skip unchanged rows
- Supports provider/model metadata for future re-embedding strategies

### Semantic search evaluation (1000-case benchmark)

Run a reproducible lexical vs semantic vs hybrid experiment and output both JSON + Markdown reports:

```bash
python3 scripts/run_semantic_eval.py --sample-size 1000 --seed 42

# If OpenAI embeddings are unavailable, use Gemini embeddings:
python3 scripts/run_semantic_eval.py \
  --provider gemini \
  --model models/gemini-embedding-001 \
  --sample-size 1000 \
  --seed 42
```

- Outputs: `data_quality_reports/semantic_eval_*.json` and `data_quality_reports/semantic_eval_*.md`
- Metrics: `Recall@K`, `nDCG@K`, `MRR@K` for lexical, semantic, and hybrid (RRF)
- Cost model: token-based estimate using the configured `--price-per-1m`

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Python 3, Flask, pandas, BeautifulSoup/lxml |
| **Frontend** | React 18, TypeScript, Vite 7, Tailwind CSS v4, TanStack Query, Recharts, Sonner |
| **i18n** | react-i18next — English + Traditional Chinese (全繁體中文介面) |
| **Storage** | CSV/JSON (default), SQLite (FTS5+WAL), Supabase (PostgreSQL) |
| **Testing** | pytest (296 unit + 231 E2E), Vitest (83 frontend unit tests) |
| **LLM** | Claude Sonnet (field extraction), 10 parallel sub-agents |
| **Scraper** | Cloudflare Workers + R2 (bulk), AustLII direct scraping |

## Rate Limiting

Built-in rate limiting (default: 1 second between requests). AustLII blocks default `python-requests` User-Agent (HTTP 410) — the scraper uses a browser-like UA string. Bulk scraping may trigger IP blocks; typically resolves within hours.

## License

For legal research and educational purposes.
