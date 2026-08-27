# ADR-0003: LLM Council grounding uses D1 FTS5 lexical retrieval, not Vectorize

- **Status**: Accepted
- **Date**: 2026-08-21
- **Commits**: `763ec5f` (original Vectorize design), `93cace7` (the switch), `167a84b` (hardening)

## Context

Council retrieval ("find similar cases to cite") originally shipped grounded in
Vectorize semantic retrieval (`763ec5f`, 2026-08-20). That coupled every
Council turn to the semantic index and the Workers AI embedding call.

## Decision

Retrieval (`workers/llm-council/retrieval.js`) builds an FTS5 query from the
question — stopword removal, phrase retention, OR-combined content terms — and
calls `CloudflareCaseStore.searchLexical` against `IMMI_CATALOG_DB`, dropping
the Vectorize/AI dependency. A D1-only `createCloudflareCaseStore` factory lets
retrieval run without the semantic index. `bm25` rank maps to
`relevance_score` with `bm25_rank` preserved; empty, degraded and timeout
statuses are explicit. `167a84b` added lexical-recall pagination and
non-blocking streaming.

## Consequences

- Council grounding no longer depends on Vectorize or Workers AI being healthy.
- **Vectorize is still live** — `CASE_VECTORS` backs case semantic/related-case
  search in `workers/case-api/cloudflare.js`. Do not read this ADR as "Vectorize
  was removed"; it was removed from *Council grounding only*.
- Council recall is now lexical, so it inherits FTS5's vocabulary sensitivity:
  a question phrased with different terms than the judgments will retrieve less.
  Re-introducing hybrid retrieval would need a new ADR.
