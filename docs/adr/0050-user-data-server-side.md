# ADR 0050: Where bookmarks, collections and saved searches live

- **Status**: Proposed
- **Date**: 2026-08-27
- **Context commit**: `42826a3`
- **Supersedes**: steps 1–3 of T13 in `docs/plans/2026-03-15-system-integration-roadmap.md:480`

> **Citation note**: this plan was written against `42826a3`. Two sibling plans
> (034, and a security-hardening pass tracked as `harden-auth-and-authorization-006`)
> landed on `main` between then and when this ADR was written, moving line
> numbers and, in one case, changing the write-gate on the shared case corpus.
> Every citation below was re-read against the current `main` tip and reflects
> what the file says today, not what plan 050's draft quoted. Line numbers as
> planned vs. as verified are called out inline wherever they differ.

## Context

1. `/collections`, `/collections/:collectionId` and `/saved-searches` are shipped
   routes (`frontend/src/App.tsx:205`, `:221`, `:213`) whose data lives only in
   `localStorage`, under keys `immi-bookmarks`
   (`frontend/src/hooks/use-bookmarks.ts:9`) and `saved-searches`
   (`frontend/src/lib/saved-searches.ts:4`).
2. The write paths swallow quota / private-mode failures silently
   (`frontend/src/hooks/use-bookmarks.ts:176-183`,
   `frontend/src/lib/saved-searches.ts:96-102`), and the saved-search loader
   *deletes* the key outright on a non-array payload
   (`frontend/src/lib/saved-searches.ts:63-70`). A user can lose everything with
   no error surfaced.

   **Correction to the plan's framing of the bookmarks read path**: the plan's
   draft quoted `readFromStorage` returning an empty default on any parse
   error. That function was rewritten after the plan was drafted (plan 016,
   "quarantine malformed immi-bookmarks blobs instead of crashing") into
   `readBookmarksFromStorage`, which now moves an unreadable blob to
   `localStorage["immi-bookmarks:unreadable"]` instead of discarding it, and
   tolerates partially-malformed entries by normalizing rather than dropping
   the whole collection. The **write** side is unaffected — `setState`
   (`frontend/src/hooks/use-bookmarks.ts:176-183`) still silently swallows
   `localStorage.setItem` failures, which is the behaviour this ADR's error
   surfacing is meant to fix. Reproducing the plan's original claim about the
   read path as still-true would itself be exactly the kind of stale claim this
   ADR is trying to stop from circulating, so it is corrected here instead.
3. `collections`, `collection_items` and `saved_searches` were migrated into
   `IMMI_ACCOUNT_DB` (`migrations/d1/account/0001_account.sql:56-87`) and have
   **never** been referenced by Worker code — `grep -rn "collection_items\|saved_searches" workers/`
   returns nothing today.
4. The only shipped collections route, `/api/v1/collections/export`
   (`workers/case-api/cloudflare_actions.js:150-161`), renders HTML from a
   client-supplied body and reads no stored collection — it calls
   `stores.caseStore.findByIds(ids)` (`:99`) on the shared case corpus, not a
   stored collection. Every other `/api/v1/collections*` and `/api/v1/bookmarks*`
   path 503s via `workers/cloudflare-native.js:234-235` (the plan's draft cited
   `:229-231`; the `unavailable()` helper itself is unmoved at `:160-165`).
5. **Explicitly correcting a claim that circulates about this area**: it is
   *not* true that logging in buys the user nothing. LLM Council sessions are
   already auth-gated and tenant-scoped server-side
   (`workers/llm-council/cloudflare_handlers.js:102` calls
   `stores.identityStore.assertMembership(claims)`, and `:310-318`
   (`handleListSessions`) calls `requireSessionAuth` then
   `stores.identityStore.listCouncilSessions(auth, …)`), with
   `council_sessions` / `council_turns` at
   `migrations/d1/account/0001_account.sql:103-134`. Durable Council history is
   a real logged-in benefit today. What login does not yet buy is durable
   *bookmarks, collections and saved searches*.
6. **A second correction, found while re-verifying this ADR's evidence**: since
   the plan was drafted, writes to the shared case corpus were re-gated from
   plain tenant membership to a platform-operator grant
   (`workers/case-api/cloudflare_mutations.js:53-71` now calls
   `stores.identityStore.assertPlatformOperator(authResult.claims)` at `:73`,
   not `assertMembership`; the grant itself is defined at
   `workers/storage/identity.js:98-119`, backed by
   `migrations/d1/account/0002_platform_admin.sql`). This narrows, but does not
   remove, the problem in Decision 4 below — see that section for what changed
   and what did not.

## Decision 1 — The tables as migrated cannot hold the shipped data; fix the schema in the same change as the code that uses it

The schema was written from an older spec and cannot store what the SPA holds.

`frontend/src/types/bookmarks.ts:9-34`:

```ts
export interface BookmarkEntry {
  case_id: string;
  case_title: string;
  case_citation: string;
  court_code: string;
  date: string;
  note: string;
  bookmarked_at: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  tags: string[];
  case_order: string[];
  case_notes: Record<string, string>;
  created_at: string;
  updated_at: string;
  color?: CollectionColor;
}

export interface BookmarksState {
  bookmarks: BookmarkEntry[];
  collections: Collection[];
}
```

`frontend/src/types/case.ts:375-382`:

```ts
export interface SavedSearch {
  id: string;
  name: string;
  filters: CaseFilters;
  createdAt: string;
  lastExecutedAt?: string;
  resultCount?: number;
}
```

The gaps, each verified against `migrations/d1/account/0001_account.sql:56-87`:

| Client field | D1 destination | Gap |
|---|---|---|
| `BookmarkEntry` (all of it) | — | **No `bookmarks` table exists in any migration.** `grep -rn "bookmark" migrations/` returns nothing. Bookmarks are a separate top-level list from collections in the client model. |
| `Collection.name` | `collections.title` | Rename only. |
| `Collection.tags: string[]` | — | No column. |
| `Collection.color?` | — | No column. |
| `Collection.case_order: string[]` | `collection_items` | No `position` column; `PRIMARY KEY (collection_id, case_id)` is a set, not a sequence. Ordering is lost. |
| `Collection.case_notes: Record<…>` | `collection_items` | No `note` column. Per-case notes inside a collection are lost. |
| `SavedSearch.name` | `saved_searches.title` | Rename only. |
| `SavedSearch.filters` | `saved_searches.query_json` | Fits — the `CHECK(json_valid(query_json))` at `migrations/d1/account/0001_account.sql:82` accepts it. |
| `SavedSearch.lastExecutedAt?` | — | No column. |
| `SavedSearch.resultCount?` | — | No column. |

**Decision**: the schema delta below is **proposed, not applied**. No
`migrations/d1/account/000N_*.sql` is added until an implementer lands it in
one change together with the Worker store methods and routes that read it —
the repo already carries one unused schema (this one) and must not carry two.

> **Numbering note, found during evidence re-verification**: `migrations/d1/account/`
> now also contains `0002_platform_admin.sql`, an unrelated platform-operator
> grant column landed by the security-hardening work referenced in Context
> item 6. It has nothing to do with bookmarks, collections or saved searches —
> it does not touch `cases`, `collections`, `collection_items` or
> `saved_searches` — so it does not compete with or invalidate the proposal
> below. It does mean the eventual implementation file is `0003_*.sql`, not
> `0002_*.sql`; whoever picks this up should confirm the next free number at
> that time rather than assume it is still `0002`.

```sql
-- PROPOSED, NOT APPLIED. Land with the code that reads it.
CREATE TABLE IF NOT EXISTS bookmarks (
  tenant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, owner_id, case_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  FOREIGN KEY (owner_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS bookmarks_owner_recent_idx
  ON bookmarks(tenant_id, owner_id, created_at DESC);

ALTER TABLE collections ADD COLUMN color TEXT;
ALTER TABLE collections ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'
  CHECK(json_valid(tags_json));

ALTER TABLE collection_items ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
ALTER TABLE collection_items ADD COLUMN note TEXT NOT NULL DEFAULT '';

ALTER TABLE saved_searches ADD COLUMN last_executed_at TEXT;
ALTER TABLE saved_searches ADD COLUMN result_count INTEGER;
```

`Collection.name` maps to `collections.title` and `SavedSearch.name` to
`saved_searches.title` — rename at the serialisation boundary, do not add a
`name` column. `SavedSearch.filters` already fits `query_json` because of the
`CHECK(json_valid(query_json))` at `migrations/d1/account/0001_account.sql:82`.

## Decision 2 — The CRUD surface

New routes are implemented **in the Worker**, as D1 queries in a new
`workers/case-api/` module dispatched from `workers/cloudflare-native.js`. There
is no Flask in production to fall back to — an unhandled route is a real 503,
not a soft degrade.

| Method + path | Gate |
|---|---|
| `GET /api/v1/bookmarks` | `requireAuth` + `assertMembership` |
| `PUT /api/v1/bookmarks/:caseId` | `requireWriter` |
| `DELETE /api/v1/bookmarks/:caseId` | `requireWriter` |
| `GET /api/v1/collections` | `requireAuth` + `assertMembership` |
| `POST /api/v1/collections` | `requireWriter` |
| `GET /api/v1/collections/:id` | `requireAuth` + `assertMembership` |
| `PATCH /api/v1/collections/:id` | `requireWriter` |
| `DELETE /api/v1/collections/:id` | `requireWriter` (soft delete — set `deleted_at`) |
| `PUT /api/v1/collections/:id/items` | `requireWriter` (replaces the ordered item list in one call) |
| `GET /api/v1/saved-searches` | `requireAuth` + `assertMembership` |
| `POST /api/v1/saved-searches` | `requireWriter` |
| `PATCH /api/v1/saved-searches/:id` | `requireWriter` |
| `DELETE /api/v1/saved-searches/:id` | `requireWriter` |

Four binding constraints:

- Every write goes through **the tenant-membership `requireWriter`** —
  CSRF → JWT → `assertMembership` — copied from
  `workers/case-api/cloudflare_actions.js:41-53`. Do not write a new gate, and
  do not reach instead for `workers/case-api/cloudflare_mutations.js`'s
  `requireWriter` (`:53-71`): that one now asserts
  `assertPlatformOperator` (`workers/storage/identity.js:98-119`), because it
  guards writes to the *shared, tenant-less* case corpus. Bookmarks,
  collections and saved searches are per-tenant resources — the ordinary
  membership gate is the correct one, not the operator gate. Using the wrong
  one either locks every tenant member out of their own data (operator gate)
  or, if the two are ever confused in the other direction, would put shared
  catalog writes behind a check meant for personal data.
- Every read store method calls `await this.assertMembership(auth)` on its
  first line, exactly like `listCouncilSessions`
  (`workers/storage/identity.js:361-373`, which itself calls `assertMembership`
  at `:362`). Tenant isolation here is app-layer; a method that forgets the
  call is a real cross-tenant leak, with no RLS backstop
  (`assertMembership` itself is `workers/storage/identity.js:64-78`).
- **Every predicate is `WHERE tenant_id = ? AND owner_id = ?`, not `tenant_id`
  alone.** This is a decision, made here, and it is the correction to an
  earlier draft that copied `listCouncilSessions`' `tenant_id`-only predicate
  while simultaneously deferring the private-versus-shared question to
  "follow-on decisions". Those two together are not a deferral — they are a
  silent choice of *shared*, and the wrong one: every member of a tenant would
  see every other member's bookmarks, collections and saved searches, on a
  product whose primary user is a self-representing applicant whose personal
  tenant is created for them at first login
  (`CloudflareIdentityStore.upsertTelegramUser()`,
  `workers/storage/identity.js`). A private-by-default store can be opened up
  later; data that has already leaked between members cannot be un-seen.

  Both `collections` and `saved_searches` already carry `owner_id`
  (`migrations/d1/account/0001_account.sql:56-87`) and the proposed `bookmarks`
  table is keyed on `(tenant_id, owner_id, case_id)`, so the column exists — the
  earlier draft simply did not use it. `collection_items` has no owner of its
  own and must be reached **through its parent**: every read and write joins
  `collections` and re-checks `(tenant_id, owner_id)` there. A route that
  accepts a `collection_id` and trusts it is a direct object reference
  vulnerability.

  If sharing within a tenant is wanted later, it needs its own ADR and at
  minimum: an explicit visibility column or ACL table, a definition of which
  membership `role`s may read another member's rows
  (`memberships.role` is already selected by `assertMembership`), and
  parent-resource checks on every nested route. Do **not** approximate it by
  widening a predicate.
- `PUT …/items` replaces the whole ordered list rather than exposing
  per-item reorder endpoints, so `Collection.case_order` round-trips in one
  atomic D1 batch and drag-reorder in the SPA cannot half-apply.
- These routes are **not** gated by `IMMI_CASE_MUTATIONS_ENABLED`
  (`wrangler.toml:98-102`). That flag, together with the platform-operator gate
  described in Context item 6, guards writes to the shared case corpus;
  per-tenant user data is a different blast radius, gated by ordinary tenant
  membership, and needs its own flag if one is wanted.

## Decision 3 — The offline and migration story: server-authoritative, with a one-way import on first login

- Logged out, the SPA keeps working exactly as today, against `localStorage`.
  The primary user is a self-representing applicant who may never log in;
  breaking the anonymous path is not acceptable.
- Logged in, the server is authoritative. The client caches through TanStack
  Query, and filter-dependent hooks use `placeholderData`/`keepPreviousData` per
  the repo convention.
- On the **first** login on a given browser, offer a one-way import of whatever
  is in `immi-bookmarks` and `saved-searches` into the tenant. Never merge in
  the other direction, and never auto-import silently.

  Mechanics — every item exists because its absence is a way to lose the
  user's research:

  - **Dry-run preview first.** The client posts the payload to a preview
    endpoint (or a `?dry_run=1` variant) that returns what *would* be created,
    what already exists, and what conflicts — and writes nothing. The applicant
    approves that summary before anything is uploaded.
  - **Idempotency (idempotency key).** The client generates one key per import attempt and
    sends it on both the preview and the commit. The server stores it and
    returns the original result for a repeat. Without it, a flaky connection
    plus a retry is a duplicated collection set.
  - **Conflict policy, decided not deferred.** Server rows win on any
    collision; a colliding local item is imported under a suffixed title
    (`"<name> (imported)"`) rather than being merged or dropped.
  - **Server-side completion marker, namespaced by `(tenant_id, owner_id)`.**
    A `localStorage` flag is not a marker: the same user on a second browser
    would be offered the import again and would re-upload.
  - **Rollback.** The commit writes under one batch id; a single
    "undo this import" removes exactly the rows that batch created.
  - **The local copy is not deleted.** Keep `immi-bookmarks` and
    `saved-searches` in place until the client has re-read the imported data
    back from the server and confirmed the counts match. Prefer renaming the
    keys (e.g. `immi-bookmarks.imported-<date>`) over `removeItem`.
- **Rejected: two-way sync.** It needs per-field conflict resolution and
  vector clocks for a single-user-per-tenant workload. Cost is not repaid.
- **Rejected: leave it in `localStorage` and just surface the errors.** It does
  not survive a device change or a cleared cache, which is the actual failure
  the user reports.
- **Rejected: silent auto-import on first login.** The applicant must see what
  is being uploaded and to which account.

## Decision 4 — Per-case notes and tags move to tenant-scoped tables; the shared catalog columns become extraction output only

`cases.user_notes` and `cases.tags` are columns on the single global catalog
row (`migrations/d1/catalog/0001_catalog.sql:31-32`) and the mutation handler
writes them (`workers/case-api/cloudflare_mutations.js:114-115`). With more
than one tenant, one writer's note overwrites another's. There is no
per-tenant dimension on that row and cannot be one — it is the shared corpus.

**Decision**: a user's private note about a case lives in `bookmarks.note`
(per `tenant_id`+`owner_id`+`case_id`) or in `collection_items.note` when it is
scoped to one collection. `cases.user_notes` and `cases.tags` are reclassified
as extraction/curation output owned by the pipeline, not user input, and the
SPA must stop offering them as a user-editable field once the bookmark note
ships.

**Why now, and what has changed since the plan was drafted**:
`wrangler.toml:98-102` still reads `IMMI_CASE_MUTATIONS_ENABLED = "false"`,
so these columns have never received a write through the mutation route in
production. But `scripts/transform_immi_snapshot.py:267` imports both columns
from the source snapshot with no flag involved (column list at
`scripts/transform_immi_snapshot.py:280-281`), so the live catalog may already
hold content from that path regardless of the flag.

**A real narrowing, found while re-verifying this ADR's evidence, that the
plan's draft did not know about**: `workers/case-api/cloudflare_mutations.js`'s
`requireWriter` (`:53-71`) now calls `assertPlatformOperator`
(`workers/storage/identity.js:98-119`), not plain `assertMembership` — a
security-hardening change (tracked as `harden-auth-and-authorization-006`,
`SEC-02`) landed after the plan was drafted, specifically because "the `cases`
table has no tenant column... tenant membership is not sufficient
authorization" (comment at `workers/case-api/cloudflare_mutations.js:68-70`).
This means that **once mutations are enabled, an ordinary tenant member still
cannot reach this route** — only a platform operator (`users.platform_admin = 1`
via `migrations/d1/account/0002_platform_admin.sql`, or the
`IMMI_PLATFORM_OPERATOR_IDS` break-glass allowlist) can. That closes the
plan's originally-stated immediate scenario ("the moment an operator flips
that flag, tenant A's private note silently overwrites tenant B's") in its
literal form — an ordinary applicant cannot trigger it.

It does **not** close the architectural problem this decision exists to fix.
The column is still a single global slot with no tenant dimension: if the
platform-operator route is ever used by more than one operator on behalf of
different tenants, or if the gate is ever loosened (staging environments,
future support tooling, a bug), the same collision reappears — and there would
be no way to tell, after the fact, which tenant's note is currently sitting in
the shared row, because the row carries no tenant attribution regardless of
who wrote it. A column with no tenant column is not made tenant-safe by
tightening who is allowed to write to it; it is made tenant-safe by moving the
data to a table that has a tenant column. The design decision in this section
is unaffected by the narrowing — only the immediate blast radius is smaller
than the plan first described, and the ADR should say so rather than repeat
the wider claim now that it no longer holds.

**Existing-data inventory (Step 1a) — recorded as UNKNOWN, not assumed zero**:
this plan's author does not have production D1 credentials and cannot run

```sql
SELECT COUNT(*) AS total_cases,
       SUM(CASE WHEN COALESCE(tags,'')       <> '' THEN 1 ELSE 0 END) AS with_tags,
       SUM(CASE WHEN COALESCE(user_notes,'') <> '' THEN 1 ELSE 0 END) AS with_notes
FROM cases;
```

against the live `IMMI_CATALOG_DB`. **`total_cases`, `with_tags` and
`with_notes` are UNKNOWN as of this writing (2026-08-27/28) — not zero.** The
operator should run the query above (and, if either count is non-zero, the
20-row provenance sample and the source-snapshot `grep -c` check described in
the plan) and record the results here before this ADR's Decision 4 is treated
as fully actionable. Until then:

- The design decision stands regardless of the count: a shared, global row
  cannot hold per-tenant user input, so notes and tags belong in the
  tenant-scoped tables.
- The **cost and sequencing** claim is downgraded from "free, no migration" to
  **"reclassification agreed in principle, blocked on a data inventory."** If
  the counts come back zero, the migration is free and can proceed
  immediately per the schema in Decision 1. If either count is non-zero, the
  content is already un-attributable to any tenant — the `cases` row has no
  tenant column — so it cannot be migrated *to* a tenant; the choice becomes
  keeping it as pipeline-owned curation output under a clearer column name, or
  discarding it, with a `<col>_backup` column and a `LIMIT 100` eyeballed
  dry run first, per `CLAUDE.md`'s production-cleanup rule, before either path
  is taken.

## Consequences

- What gets better: durable research across devices, real error surfaces on
  write failure, a genuine reason to log in beyond Council history.
- What it costs: ~13 new routes, a new store class, a schema migration, a
  first-login import flow, and an anonymous path that must keep working —
  meaning the SPA carries two data sources for a while.
- What stays broken until an implementer picks this up: everything in Context.
  This ADR ships no behaviour.
- Follow-on decisions deliberately **not** made here: whether saved searches
  support scheduled re-execution; rate limits on the new write routes; running
  the Step 1a inventory (blocked on production D1 access this plan does not
  have).
- **Private-versus-shared is decided here, not deferred** (Decision 2): all
  three resources are private to `(tenant_id, owner_id)`. Opening them up
  within a tenant needs its own ADR with an explicit visibility model, a role
  matrix, and parent-resource checks — it is not a predicate widening. Listing
  this as an open question while prescribing `tenant_id`-only queries, as an
  earlier draft did, would have shipped tenant-wide sharing by accident.
- **The shared-catalog write gate narrowed since this plan was drafted**
  (Context item 6, Decision 4): writes to `cases.tags`/`cases.user_notes` now
  require a platform-operator grant, not tenant membership. This reduces the
  immediate blast radius but does not change the recommendation — the fix is
  still to move per-tenant notes off the shared row, not to rely on the
  operator gate as a permanent substitute for tenant-scoped storage.

## Verification notes

- Every file:line citation in this ADR was re-read from `main` at the time of
  writing (after the plan-050 drift-check fix and the `harden-auth-and-authorization-006`
  security pass both landed), not copied from the plan's draft. Where the
  underlying code moved but its content did not, the citation was corrected
  silently; where the content itself changed in a way relevant to the
  decision, that is called out inline (Context items 2 and 6, and Decision 4).
- The Step 1a production data inventory (`total_cases`, `with_tags`,
  `with_notes`) could not be run by the author of this ADR — it requires
  production D1 credentials this environment does not have — and is recorded
  as UNKNOWN in Decision 4, not assumed to be zero. Whoever implements this
  ADR should run that inventory first and update Decision 4 with the actual
  counts before treating its cost claim as final.
- `migrations/d1/account/0002_platform_admin.sql` exists on `main` as of this
  writing. It is unrelated to this ADR's subject (see the numbering note under
  Decision 1) and was confirmed, not assumed, to leave no trace in
  `collections`, `collection_items`, `saved_searches` or `cases`.
