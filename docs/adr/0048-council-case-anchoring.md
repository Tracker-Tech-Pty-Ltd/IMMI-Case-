# ADR-0048: Council case anchoring

## Status

Accepted, 2026-08-28. Supersedes nothing.

## Context

Someone reading a judgment on the case reader (`/cases/:id`) cannot ask the
Council about the case they are looking at without retyping its 12-character
hex id by hand into a free-text box on `/llm-council` — and even after doing
that, the models never see the case. The plumbing to fix this already existed
and was unused:

- `council_sessions.case_id` — the D1 column, `migrations/d1/account/0001_account.sql:107`.
- The validator — `CASE_ID_RE = /^[0-9a-f]{12}$/` and its check in
  `validateBodyMessage()`, `workers/llm-council/cloudflare_handlers.js:21` and
  `:84-87`.
- The session write — `handleCreateSession` passes `caseId: body.case_id || null`
  into `createSessionWithRetrieveCode` (`cloudflare_handlers.js:240`), and
  `handleStream`'s deferred persist does the same (`:420`).
- The typed frontend client — `LlmCouncilSession.case_id` and
  `LlmCouncilSessionListItem.case_id` (`frontend/src/lib/api-llm-council.ts:65`,
  `:77`), plus a `case_id?: string` field already declared on the session-create
  payload type at `:212`.

What was missing: nothing *populated* `case_id` from the UI — the new-session
form sent it as a prose string instead
(`case_context: "Case ID hint: <id>"`, `LlmCouncilPage.tsx`), which the Worker
stores as free-text `caseContext` and never parses — and no Council behaviour
*depended on* the stored value once a session had it. `getSessionMetadata`
already selected `case_id` back out of D1 and surfaced it to the client, so
the field was not literally write-only, but nothing downstream acted on it.

## Decision

Two options were weighed.

**Option A — metadata pin only.** Store `case_id`, show it in the session
list, change nothing about the prompt. Rejected: an action labelled "Ask the
Council about this case" whose experts never see the case is misleading, and
this product's primary user is a self-represented immigration applicant who
has no way to tell a grounded answer from a generic one.

**Option B — seed the prompt with the anchor case (CHOSEN).** When a request
carries `case_id`, or a follow-up turn's session already has one stored, the
Worker loads that case from D1 (`CloudflareCaseStore.getCase`, no R2 read) and
renders it through the existing `renderRetrievedContext()` as a
`<retrieved_cases>` block — placed ahead of the FTS-retrieved cases **in the
same render call**, so the anchor and the corpus hits share one character
budget and the same case cannot appear twice. Two fencing rules apply: the
block is built from `sanitizeText()`-cleaned fields only, and on the streaming
path — where the block travels inside `caseContext`, which `buildUserPrompt`
(`workers/llm-council/runner.js:167-192`) does **not** fence — the block
carries its own untrusted-evidence header (`ANCHOR_CONTEXT_HEADER`) so the
model is told explicitly that it is corpus text, not a user-asserted fact.

## Scope of this decision

Shipped now: server-side anchoring on `POST /api/v1/llm-council/sessions`,
`POST …/sessions/:id/turns`, and `POST …/stream`; a case-reader action linking
to `/llm-council?case_id=<12-hex>`; and the three-file browser wiring that
makes that query parameter reach the request body (see "Follow-up" below —
it shipped in the same change as this ADR, once the two owning plans released
the files).

Not shipped: full-text anchoring from R2, and anchoring
`POST /api/v1/llm-council/run` (`handleLegacyRun`) — it has no session and
therefore no stored anchor to read back, and is not worth the added
verification surface for a route this product treats as legacy.

## The URL contract

`/llm-council?case_id=<12 lowercase hex chars>` — one parameter, no others.
Same alphabet as the Worker's `CASE_ID_RE = /^[0-9a-f]{12}$/`
(`cloudflare_handlers.js:21`); a value that does not match is simply not sent
as `case_id` by the browser (see "Follow-up" below), and if it somehow reached
the Worker anyway `validateBodyMessage` would reject the request with 400
before any anchoring logic runs.

## Follow-up required to close the loop

The query parameter alone is inert: the Council page has to read it, and the
stream request has to carry it, or `/llm-council?case_id=…` merely navigates
correctly while silently dropping the id — a worse failure than no button at
all, because it is invisible and the user reads the resulting generic answer
as if it were about their case. **This was a blocker, not a nicety**: the
case-reader link in this same change was gated on the following landing
first, and did not ship ahead of it.

At the time this decision was first written, the fix was blocked on two files
owned by other in-flight plans. Both plans have since landed and released
those files, and the fix below shipped in this same change:

- `frontend/src/components/llm-council/StreamingCouncilView.tsx:162` and
  `:193` — widened the `start` params type from
  `{ message: string; case_context?: string }` to
  `{ message: string; case_context?: string; case_id?: string }`. The body was
  already `JSON.stringify(params)`, so nothing else changed there.
- `frontend/src/pages/LlmCouncilPage.tsx:783` — seeded
  `useState("")` from `useSearchParams().get("case_id")`.
- `frontend/src/pages/LlmCouncilPage.tsx:839-842` — now sends
  `case_id: caseId.trim() || undefined` alongside `message`, replacing the old
  `case_context: "Case ID hint: <id>"` prose hack the models never parsed.

No `runner.js` change was needed for this: the handler injects the anchor
through `caseContext`, which `streamCouncil` already accepts unchanged.

Two items remain genuinely open, not closed by this change:

- **A round-trip contract test** — render `LlmCouncilPage` at
  `/llm-council?case_id=abc123456789`, submit a question, and assert the
  outgoing request body carries `case_id: "abc123456789"`. The existing
  component suites for the two files above were re-run and still pass
  unmodified, which proves no regression; it does not by itself prove the
  query parameter survives the full trip end to end the way a dedicated
  assertion would. Static type widening is not evidence the value is sent.
- **A visible metadata-only disclosure** on the Council page beside the
  anchored-case indicator. The case-reader link carries a `title` attribute,
  which is unreachable by touch and keyboard — that is a floor, not the
  answer, and belongs on the Council page itself.

## Failure policy

The rule is an asymmetry, stated so a future reader can check code against
it: an **explicitly requested** anchor (`body.case_id` on `POST …/sessions`
and `POST …/stream`) is part of the request's meaning, so an unknown id
returns `404 case_not_found` and a store failure returns
`503 anchor_unavailable`, both **before any model call**. An **inherited**
anchor (the session's stored `case_id` on `POST …/turns`) degrades instead:
the turn still runs, and the response reports `anchor: { status, source }` so
the caller can tell the user what happened.

Why: failing an explicit request costs the user nothing — no expert has been
called, no token spent. Silently continuing a request that named a specific
case, when that case cannot be loaded, would cost three paid model calls and
produce an answer that reads as if it were about a case the models never
saw — worse than an error for a self-represented applicant who has no way to
tell the difference. A mid-conversation follow-up turn is the opposite case:
the user is not asking about a *new* case, they are continuing an existing
conversation, and failing that turn outright would be a worse outcome than
running it without the (now-missing) anchor and saying so.

## What the models actually receive

Metadata only. The anchor block carries citation, court, year, title,
case_nature, visa_subclass, and url from the catalogue row, plus catchwords
(or `text_snippet` when catchwords are empty) truncated to 600 characters.
**Not** the judgment text — that sits in R2 behind `content_key` and is
deliberately not fetched (see "Scope of this decision"). This is disclosed in
three places that must stay in agreement: the prompt's
`ANCHOR_CONTEXT_HEADER`, the case-reader link's `title` attribute, and
`anchor.source: "catalog_metadata"` in the `POST …/turns` response body.

## Consequences

- One extra D1 primary-key lookup per anchored Council turn, on a request
  that is already making several paid LLM calls. If Council volume ever makes
  that cost matter, the fix is to cache the rendered anchor block on the
  session rather than re-fetching it per turn.
- `cases` is a shared corpus with no tenant column, so anchoring exposes
  nothing that `GET /api/v1/cases/:id` does not already expose to the same
  caller.
- The anchor and the FTS results share **one** 12,000-character budget on the
  `runCouncil` paths, because `mergeAnchorAndRetrieval` re-renders the
  combined, de-duplicated case list in a single `renderRetrievedContext` call.
  `ANCHOR_CONTEXT_BUDGET_CHARS` in the handler must be kept equal to
  `CONTEXT_MAX_CHARS` in `workers/llm-council/retrieval.js:22`, which is not
  exported and therefore cannot drift loudly — a reviewer should check the two
  values by eye whenever either file changes.
- Two accepted gaps on the **stream** path only, both bounded and both
  recorded here rather than papered over: the anchor rides inside
  `caseContext` while `streamCouncil` runs its own retrieval internally
  against the full retrieval budget, so the stream prompt can carry the
  anchor block *plus* a full FTS budget — roughly one extra
  `<retrieved_case>` block, about 1&nbsp;KB, since the anchor is a single row
  with a 600-character snippet; and the anchor is not de-duplicated against
  the stream's own internal FTS hits, so the same case can in principle appear
  twice in that one prompt. The clean fix for both is a `retrievedCases`
  parameter on `streamCouncil`, which is a `workers/llm-council/runner.js`
  change and belongs to whoever owns that file.
- A reviewer of the server change should check: (1) the untrusted-evidence
  header stays glued to the anchor block on the streaming path — dropping it
  silently turns corpus text into apparently-trusted user-asserted fact; (2)
  `mergeAnchorAndRetrieval` is called once per handler and its result used for
  both `retrievedContext` and `retrievedCases`, so the rendered string and the
  case array cannot disagree; (3) `buildCaseAnchor` still swallows every
  storage error into an `"unavailable"` status rather than throwing past the
  caller.
