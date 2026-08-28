# ADR-0048: LLM Council sessions anchor on the case the user asked about

## Status

Accepted, 2026-08-28. Supersedes nothing.

## Context

A self-represented applicant reading a judgment on `/cases/:id` has no button
that says "ask about this one." Their only route is to navigate to
`/llm-council` and hand-type a 12-character hex `case_id` into a free-text
field — and even then that id never reaches the models. The page sends it as
the prose string `Case ID hint: <id>`
(`frontend/src/pages/LlmCouncilPage.tsx:841`, seeded from
`const [caseId, setCaseId] = useState("")` at `:783`), and the experts see
only that sentence.

The plumbing for the real thing already exists and is unused:

- `council_sessions.case_id` — the D1 column
  (`migrations/d1/account/0001_account.sql:107`).
- The validator — `body.case_id` must match a 12-character lowercase hex
  string or be absent (`workers/llm-council/cloudflare_handlers.js:84-87`,
  `CASE_ID_RE` at `:21`).
- The session write — `handleCreateSession` stores `body.case_id` on create
  (`cloudflare_handlers.js:240`) and the streaming path stores it at
  persist-time (`:420`).
- The typed frontend client — `LlmCouncilSession.case_id`
  (`frontend/src/lib/api-llm-council.ts:65`),
  `LlmCouncilSessionListItem.case_id` (`:77`), and a `case_id?: string` field
  already declared on the session-create request shape (`:212`).

What was missing: nothing *populates* the column from a real case (the SPA
sends the prose hint above instead), and no Council behaviour *depends* on it
once stored. `CloudflareCouncilStore.getSessionMetadata` does select
`case_id` back out for a session, but nothing reads it — a stored anchor sat
inert.

## Decision

Two options were considered.

- **Option A — metadata pin only.** Store `case_id`, show it in the session
  list, change nothing about the prompt. Rejected: an action labelled "Ask the
  Council about this case" whose experts never see the case is misleading, and
  this product's user is a self-represented applicant who cannot tell the
  difference between an answer grounded in their case and a generic one.
- **Option B — seed the prompt with the anchor case (CHOSEN).** When a request
  carries `case_id`, or when a follow-up turn's session has one stored, the
  Worker loads that case from D1 and renders it through the existing
  `renderRetrievedContext()` (`workers/llm-council/retrieval.js:46-69`) as a
  `<retrieved_case>` block, placed **ahead of** the FTS-retrieved cases in the
  **same render call**, so the anchor and the FTS results share one character
  budget and the same case cannot appear in the prompt twice.

  Two fencing rules apply:
  1. The block is built from `sanitizeText()`-cleaned fields only — the same
     sanitizer the FTS-retrieval path already uses, so corpus text cannot
     smuggle HTML or control characters into the prompt.
  2. On the streaming path the block travels inside `caseContext`, and
     `buildUserPrompt` (`workers/llm-council/runner.js:167-191`) does **not**
     fence the `Case context:` slot the way it fences `retrievedContext`. So on
     that path the anchor block carries its own untrusted-evidence header
     (`ANCHOR_CONTEXT_HEADER`) rather than relying on a fence that is not
     there.

## Scope of this decision

Shipped now: server-side anchoring on `POST /api/v1/llm-council/sessions`,
`POST /api/v1/llm-council/sessions/:id/turns`, and
`POST /api/v1/llm-council/stream`. A case-reader action linking to
`/llm-council?case_id=<12-hex>` — **gated** on the browser half described
below; see "Follow-up required to close the loop" for why it did not ship in
this change.

Not shipped: full-text anchoring from R2 (see "Consequences"), and
`POST /api/v1/llm-council/run` (`handleLegacyRun`) — it has no session and
therefore no stored anchor to read back, and anchoring it is not worth the
extra verification surface for a route with this little traffic.

## The URL contract

`/llm-council?case_id=<12 lowercase hex chars>`. Same alphabet as the Worker's
`CASE_ID_RE = /^[0-9a-f]{12}$/` (`cloudflare_handlers.js:21`). One parameter,
no others.

## Follow-up required to close the loop

The query parameter is **inert until the Council page reads it.** As of this
ADR, `frontend/src/pages/LlmCouncilPage.tsx` does not call `useSearchParams()`
at all, and the streaming view's `start` parameter type (cited below) has no
`case_id` field
(`{ message: string; case_context?: string }` at lines `162` and `193`), so
the SPA is *structurally incapable* of sending one on the path it actually
uses for a new question. This was checked directly against the live files
while writing this ADR, not assumed.

The exact change, file by file, so whoever owns these files can do it in
minutes:

- `frontend/src/components/llm-council/StreamingCouncilView.tsx:162` and
  `:193` — widen the `start` params type from
  `{ message: string; case_context?: string }` to
  `{ message: string; case_context?: string; case_id?: string }`. The body is
  already `JSON.stringify(params)`, so nothing else changes there.
- `frontend/src/pages/LlmCouncilPage.tsx:783` — seed `useState("")` from
  `useSearchParams().get("case_id")`.
- `frontend/src/pages/LlmCouncilPage.tsx:839-842` — send
  `case_id: caseId.trim() || undefined` alongside `message`.

**No `runner.js` change is needed for this** — the handler injects the anchor
through `caseContext` on the streaming path, so `streamCouncil`'s signature
does not need to grow a parameter.

Three more requirements on this follow-up:

- **The follow-up is a blocker, not a nicety.** Until the browser half lands,
  `/llm-council?case_id=…` is inert in the browser, and the case-reader link
  must not ship ahead of it — a visible "Ask the Council about this case"
  button whose id the browser silently drops would return a generic answer
  that reads as if it were about the user's case. Steps 4–5 of the plan that
  produced this ADR (`plans/048-wire-council-to-the-case-reader.md`) are gated
  on this landing first, and did not run in this change because it has not
  landed yet.
- **A round-trip contract test**, owned by whoever lands the browser half:
  render `LlmCouncilPage` at `/llm-council?case_id=abc123456789`, submit a
  question, and assert the outgoing request body carries
  `case_id: "abc123456789"`. Static type widening is not evidence the value is
  actually sent — only a test that inspects the request body is.
- **A visible metadata-only disclosure** on the Council page, next to whatever
  UI indicates an anchored case. The case-reader link (once it ships) will
  carry the same disclosure in a `title` attribute, which is unreachable by
  touch and by keyboard — that is a floor, not the answer.

## Failure policy

The asymmetry is a rule, not an accident:

- An **explicitly requested** anchor — `body.case_id` on
  `POST …/sessions` and `POST …/stream` — is part of the request's meaning.
  If it cannot be honoured, the request has not been understood and must fail
  **before any model call**: an unknown id is `404 case_not_found`; a store
  failure (D1 error, missing binding) is `503 anchor_unavailable`, retryable.
- An **inherited** anchor — the session's stored `case_id` on
  `POST …/sessions/:id/turns` — is best-effort. The user is mid-conversation;
  the turn is worth running without it, but the response must say the anchor
  degraded: it reports `anchor: { status, source }`.

Why: failing the explicit request costs the user nothing — no expert has been
called, no token spent. Silently continuing on a bad explicit anchor costs
three paid model calls and produces an answer that reads as though it is
about a case the models never saw, which for a self-represented applicant is
worse than an error. Failing a mid-conversation turn instead of degrading it
would waste a paid opportunity for no benefit, since the conversation itself
is still coherent without the case.

## What the models actually receive

**Metadata only.** Catalogue fields — citation, court, year, title,
case_nature, visa_subclass, url — plus catchwords, or `text_snippet` when
catchwords is empty, truncated to 600 characters. **Not** the judgment text,
which sits in R2 behind `content_key` and is deliberately not fetched (see
"Consequences").

This is disclosed in three places that must stay in agreement:

1. The prompt header (`ANCHOR_CONTEXT_HEADER` in
   `workers/llm-council/cloudflare_handlers.js`), which tells the models
   explicitly that only metadata and catchwords are included and that they
   must not claim to have read the full judgment.
2. The case-reader link's `title` attribute (once the browser half lands).
3. `anchor.source: "catalog_metadata"` in the `POST …/turns` response.

## Consequences

- One extra D1 primary-key lookup (`CloudflareCaseStore.getCase`) per
  anchored Council turn, on a request that already makes several paid LLM
  calls.
- `cases` is a shared corpus table with no tenant column — `getCase` has no
  tenant filter, and the same row is already readable through the public
  `GET /api/v1/cases/:id` read path. Anchoring therefore exposes nothing that
  was not already public. If `getCase` ever gains a tenant filter, or `cases`
  ever gains a `tenant_id`, this reasoning breaks and anchoring needs a
  membership check first.
- The anchor and the FTS results share **one** 12,000-character budget on the
  `runCouncil` paths (`handleCreateSession`, `handleAddTurn`), because the
  handler re-renders the combined, de-duplicated case list in a single
  `renderRetrievedContext` call rather than concatenating strings.
  `ANCHOR_CONTEXT_BUDGET_CHARS` in the handler must be kept equal to
  `CONTEXT_MAX_CHARS` in `workers/llm-council/retrieval.js:22`, which is
  **not exported** and therefore cannot be imported — the two constants can
  drift silently if `retrieval.js`'s value ever changes without this file
  being updated too.
- Two accepted gaps on the **streaming** path specifically, because the
  handler has no lever on `streamCouncil`'s internal retrieval budget without
  editing `runner.js` (out of scope for this change):
  - The anchor rides in `caseContext` while `streamCouncil` runs its own FTS
    retrieval internally against the *full* `CONTEXT_MAX_CHARS` budget, so the
    stream prompt can carry the anchor block *plus* a full retrieval budget —
    roughly one extra `<retrieved_case>` block (~1 KB, since the anchor is a
    single row with a 600-character snippet). Bounded and small; not the
    unbounded overshoot the `runCouncil` paths had before this change.
  - The anchor is **not** de-duplicated against the stream's own FTS hits, so
    the same case may appear twice in a streamed prompt (once as the anchor,
    once as an FTS hit) where it cannot on the two `runCouncil` paths.
  - The clean fix for both is a `retrievedCases` parameter on `streamCouncil`,
    which is a `runner.js` change and belongs to whoever owns that file.
- **Deferred: full-text anchoring.** The anchor is metadata plus catchwords
  only. The case's full judgment text sits in R2 behind `content_key` /
  `content_sha256` on the same row `getCase` already returns; adding it means
  an R2 fetch plus a hard budget decision against the 12,000-character
  context limit, which is a bigger change than this spike is scoped for.
- **Deferred: `POST /api/v1/llm-council/run`.** `handleLegacyRun` still
  validates `case_id` and ignores it — it has no session and no stored
  anchor. If that route survives the next cleanup, anchor it the same way
  `handleCreateSession` is anchored.
- **Cost control.** If Council volume ever makes the extra D1 lookup matter,
  cache the rendered anchor block on the session rather than re-fetching it
  per turn.
