# Plan 050: Decide how bookmarks, collections and saved searches become server-side data

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` if that file exists; if it does not exist, do **not** create
> it (a reviewer owns the index).
>
> This plan produces **documents and comments only**. It writes no runtime code,
> no SQL that gets applied, and changes no behaviour. If you find yourself
> writing a D1 query, a Worker route, or a React data-fetching hook, you have
> left the plan — stop and report.
>
> **Drift check (run first)**:
> ```bash
> git diff --stat 42826a3..HEAD -- docs/adr/ migrations/d1/account/ \
>   frontend/src/hooks/use-bookmarks.ts frontend/src/lib/saved-searches.ts
> ```
> Expected: empty output. If any in-scope file changed since this plan was
> written, compare the "Current state" excerpts against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.
>
> **Evidence drift check (also run first)** — this plan quotes files it does not
> own, and its whole argument rests on them:
> ```bash
> git diff --stat 42826a3..HEAD -- migrations/d1/catalog/0001_catalog.sql \
>   workers/case-api/cloudflare_mutations.js workers/case-api/cloudflare_actions.js \
>   workers/storage/cloudflare.js frontend/src/types/bookmarks.ts \
>   frontend/src/types/case.ts wrangler.toml
> ```
> Expected: empty output. If not empty, re-read the changed file and confirm the
> quoted excerpt still says what this plan claims before you write it into the ADR.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

Three shipped SPA routes — `/collections`, `/collections/:collectionId` and
`/saved-searches` — persist a user's case-building work only in that one
browser's `localStorage`, and both write paths swallow failures silently, so a
user in private mode or over quota loses weeks of research with no error shown.
Meanwhile `migrations/d1/account/0001_account.sql` already ships tenant-scoped
`collections`, `collection_items` and `saved_searches` tables that **no line of
Worker code has ever referenced**. So the repo carries the cost of the schema
without any of its benefit, and nobody can start the implementation because
three questions have never been answered: what the CRUD surface looks like, what
happens to data already sitting in browsers, and where per-case notes belong.

This plan answers those three questions in a durable Architecture Decision
Record so an implementer can start without re-deriving any of it. It ships no
runtime code on purpose — see "Scope" for why adding an unused migration now
would repeat the exact mistake this plan is documenting.

There is a second, time-sensitive reason. `cases.user_notes` and `cases.tags`
are columns on the **shared, global** catalog row, and the Worker's mutation
handler writes them. That handler is currently fail-closed
(`IMMI_CASE_MUTATIONS_ENABLED = "false"`), so no data exists yet. The moment an
operator flips that flag, tenant A's private note on a case silently overwrites
tenant B's. Deciding now — while the fix costs one schema decision and zero data
migration — is far cheaper than deciding after the flag is on.

## Current state

### The files this plan touches

- `docs/adr/` — **does not exist yet.** `ls -d docs/adr` returns
  `No such file or directory`. `docs/` currently holds `ARCHITECTURE.md`,
  `HYPERDRIVE_CACHE_RFC.md`, `JUDGE_DATA_QUALITY.md`, `UPLOAD_JUDGE_PHOTOS.md`,
  and the `ops/`, `plans/`, `screenshots/` directories. There is no existing ADR
  convention in this repo — this plan establishes one.
- `frontend/src/hooks/use-bookmarks.ts` — the entire bookmarks + collections
  store, `localStorage`-backed via `useSyncExternalStore`. 227 lines.
- `frontend/src/lib/saved-searches.ts` — the entire saved-search store,
  `localStorage`-backed, plus URL encode/decode helpers. 306 lines.
- `migrations/d1/account/` — holds exactly one file, `0001_account.sql`
  (135 lines). Granted to this plan but deliberately left untouched; see Scope.

### The tables that exist and are never used

Verbatim `migrations/d1/account/0001_account.sql:56-87`:

```sql
CREATE TABLE IF NOT EXISTS collections (
  collection_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  FOREIGN KEY (owner_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS collections_tenant_owner_idx ON collections(tenant_id, owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, case_id),
  FOREIGN KEY (collection_id) REFERENCES collections(collection_id)
);

CREATE TABLE IF NOT EXISTS saved_searches (
  saved_search_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  query_json TEXT NOT NULL CHECK(json_valid(query_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id),
  FOREIGN KEY (owner_id) REFERENCES users(user_id)
);
```

Proof that nothing reads or writes them — this returns **no output at all**:

```
$ grep -rn "collection_items\|saved_searches" workers/
$
```

Repo-wide, the only non-`plans/` hits are: this migration file, a nav label key
(`frontend/src/components/layout/nav-config.ts:52`), E2E page-name maps
(`tests/e2e/react/react_helpers.py`, `tests/smoke_webapp.py`), an unrelated
Android README, and two Supabase-era scripts (`scripts/reconcile_immi_transform.py`,
`scripts/migrate_anon_data.py`) that talk to Postgres/RLS, not D1.

### The only collections route that exists is stateless

Verbatim `workers/case-api/cloudflare_actions.js:150-161`:

```js
/** Return a native response for the three safe POST actions, or null. */
export async function dispatchCloudflareCaseAction(request, path, env) {
  if (getStorageMode(env) !== "cloudflare" || request.method !== "POST") return null;
  if (!["/api/v1/cache/invalidate", "/api/v1/taxonomy/guided-search", "/api/v1/collections/export"].includes(path)) return null;
  try {
    const stores = createCloudflareStores(env);
    const writer = await requireWriter(request, env, stores);
    if (writer instanceof Response) return writer;
    if (path === "/api/v1/cache/invalidate") return handleCacheInvalidate();
    if (path === "/api/v1/taxonomy/guided-search") return handleGuidedSearch(request, stores);
    return handleCollectionExport(request, stores);
  } catch (error) {
```

`/api/v1/collections/export` renders HTML from `case_ids` and `case_notes` sent
in the **request body** by the client — it never reads a stored collection.
`workers/case-api/cloudflare_actions.js:99` is `const cases = await stores.caseStore.findByIds(ids);`.

Every other `/api/v1/collections*` or `/api/v1/bookmarks*` path falls through
the whole dispatch chain in `workers/cloudflare-native.js` to the terminal
fallback. Verbatim `workers/cloudflare-native.js:229-231`:

```js
    if (path.startsWith("/api/")) {
      return unavailable("This API route is not yet available in the Cloudflare-native runtime");
```

which is a 503. Verbatim `workers/cloudflare-native.js:160-165`:

```js
function unavailable(error, code = "cloudflare_route_unavailable") {
  return Response.json({ error, code }, {
    status: 503,
    headers: { "Cache-Control": "no-store", "Retry-After": "0" },
  });
}
```

### The client shapes do NOT fit the tables

This is the single most important fact in this plan and it is easy to miss.
The schema was written from an older spec and cannot store what the SPA holds.

Verbatim `frontend/src/types/bookmarks.ts:9-34`:

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

Verbatim `frontend/src/types/case.ts:375-382`:

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

The gaps, each one verified against the SQL quoted above:

| Client field | D1 destination | Gap |
|---|---|---|
| `BookmarkEntry` (all of it) | — | **No `bookmarks` table exists in any migration.** `grep -rn "bookmark" migrations/` returns nothing. Bookmarks are a separate top-level list from collections in the client model. |
| `Collection.name` | `collections.title` | Rename only. |
| `Collection.tags: string[]` | — | No column. |
| `Collection.color?` | — | No column. |
| `Collection.case_order: string[]` | `collection_items` | No `position` column; `PRIMARY KEY (collection_id, case_id)` is a set, not a sequence. Ordering is lost. |
| `Collection.case_notes: Record<…>` | `collection_items` | No `note` column. Per-case notes inside a collection are lost. |
| `SavedSearch.name` | `saved_searches.title` | Rename only. |
| `SavedSearch.filters` | `saved_searches.query_json` | Fits — the `CHECK(json_valid(query_json))` at line 82 accepts it. |
| `SavedSearch.lastExecutedAt?` | — | No column. |
| `SavedSearch.resultCount?` | — | No column. |

### The cross-tenant note problem

Verbatim `migrations/d1/catalog/0001_catalog.sql:31-32` — these are columns on
the shared, global case row, one row per case for the entire corpus:

```sql
  tags TEXT NOT NULL DEFAULT '',
  user_notes TEXT NOT NULL DEFAULT '',
```

Verbatim `workers/case-api/cloudflare_mutations.js:111-112`, inside the record
the mutation handler writes:

```js
    tags: data.tags,
    user_notes: data.user_notes,
```

Verbatim `wrangler.toml:89-93`:

```toml
[vars]
AUTH_ENABLED = "true"
IMMI_STORAGE_MODE = "cloudflare"
IMMI_CASE_MUTATIONS_ENABLED = "false"
CUTOVER_WRITE_FREEZE = "false"
```

So: writes are fail-closed today, no user has ever written a note through this
path, and the columns are empty. That is exactly why this is free to decide now.

### The exemplar to model the CRUD surface on

Tenant isolation in this stack is **app-layer**, not Postgres RLS — there is no
Postgres. Every authenticated read runs a D1 membership SELECT.

Verbatim `workers/storage/cloudflare.js:1300-1314`:

```js
  async assertMembership(auth) {
    const context = assertAuthContext(auth);
    const membership = await this.db.prepare(`
      SELECT role FROM memberships
      WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL
      LIMIT 1
    `).bind(context.tenantId, context.userId).first();
    if (!membership) {
      throw new StorageBoundaryError("Tenant membership not found", {
        code: "tenant_membership_denied",
        status: 403,
      });
    }
    return { ...context, role: membership.role };
  }
```

Verbatim `workers/storage/cloudflare.js:1508-1520` — the shape a
`listCollections` / `listSavedSearches` method must copy, note the
`assertMembership` call on line 1 of the body and the `tenant_id = ?` predicate:

```js
  async listCouncilSessions(auth, { limit, before = null } = {}) {
    const context = await this.assertMembership(auth);
    const size = clampLimit(limit, { fallback: 50, max: 100 });
    const beforeClause = before ? "AND updated_at < ?" : "";
    const params = before ? [context.tenantId, before, size] : [context.tenantId, size];
    return rows(await this.db.prepare(`
      SELECT session_id, case_id, title, status, total_turns, created_at, updated_at
      FROM council_sessions
      WHERE tenant_id = ? AND deleted_at IS NULL ${beforeClause}
      ORDER BY updated_at DESC, session_id DESC
      LIMIT ?
    `).bind(...params).all());
  }
```

Verbatim `workers/case-api/cloudflare_actions.js:41-53` — the write gate:

```js
async function requireWriter(request, env, stores) {
  const csrfFailure = await verifyCsrf(request, env);
  if (csrfFailure) return csrfFailure;
  const authResult = await requireAuth(request, env, verifyJwt);
  if (authResult instanceof Response) return authResult;
  try {
    const auth = await stores.identityStore.assertMembership(authResult.claims);
    return { auth };
  } catch (error) {
    if (clientError(error)) return errorResponse(error.message, error.status, error.code);
    throw error;
  }
}
```

### What logged-in users already get (do not repeat the false claim)

LLM Council sessions are **already** auth-gated and server-persisted per tenant.
`workers/llm-council/cloudflare_handlers.js:265-275` calls `requireSessionAuth`
then `stores.identityStore.listCouncilSessions(auth, …)`, and
`workers/llm-council/cloudflare_handlers.js:79` is
`const auth = await stores.identityStore.assertMembership(claims);`. The
`council_sessions` / `council_turns` tables are in the same account migration at
lines 103-134. Any statement that "Telegram login buys the user nothing" is
false and must not appear in the ADR.

### The prior plan-of-record for this work

Verbatim `docs/plans/2026-03-15-system-integration-roadmap.md:472-490` (the
roadmap is written in Traditional Chinese):

```
### T13. Saved searches + Collections + Bookmarks

來源：

- spec 003 Saved Searches with Quick Re-Execution
- spec 004 Case Bookmarks & Collections

目標：

- 支援研究工作流的持久化

實作步驟：

1. 定義 saved search schema
2. 定義 collections/bookmarks schema
3. 加入 create/update/delete/re-run API
4. 在 Cases、Collections、Saved Searches 頁面串接
5. 補 compare/export 與 selection flow 整合
```

The ADR supersedes step 1 and 2 of T13 (the schemas exist but are wrong) and
specifies step 3.

### The client code that would be replaced

Verbatim `frontend/src/hooks/use-bookmarks.ts:1-20` — note the storage key on
line 9:

```ts
import { useCallback, useSyncExternalStore } from "react";
import type {
  BookmarksState,
  BookmarkEntry,
  Collection,
  CollectionColor,
} from "@/types/bookmarks";

const STORAGE_KEY = "immi-bookmarks";

// ── Read ──────────────────────────────────────────────────────────
function readFromStorage(): BookmarksState {
  if (typeof window === "undefined") return { bookmarks: [], collections: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { bookmarks: [], collections: [] };
  } catch {
    return { bookmarks: [], collections: [] };
  }
}
```

Verbatim `frontend/src/hooks/use-bookmarks.ts:35-43` — every single write in the
file funnels through this, and a failure is invisible to the user:

```ts
function setState(next: BookmarksState): void {
  _state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Silently ignore storage errors (private mode, quota exceeded)
  }
  _listeners.forEach((fn) => fn());
}
```

Verbatim `frontend/src/lib/saved-searches.ts:1-4`:

```ts
import type { SavedSearch, CaseFilters } from "@/types/case";

const STORAGE_KEY = "saved-searches";
const MAX_SAVED_SEARCHES = 50;
```

Verbatim `frontend/src/lib/saved-searches.ts:62-69` — on any non-array payload
the user's saved searches are **deleted**, not quarantined:

```ts
    const parsed = JSON.parse(raw);

    // Validate that it's an array
    if (!Array.isArray(parsed)) {
      console.warn(VALIDATION_ERRORS.CORRUPTED_DATA);
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
```

Verbatim `frontend/src/lib/saved-searches.ts:95-101` — same silent-swallow as
`use-bookmarks.ts`:

```ts
export function saveSavedSearches(searches: SavedSearch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  } catch {
    // Silently ignore storage errors (private mode, quota exceeded)
  }
}
```

Consumers of these two modules (do not edit any of them in this plan):
`App.tsx`, `components/layout/MobileNav.tsx`, `components/layout/nav-config.ts`,
`components/layout/Sidebar.tsx`, `components/saved-searches/SavedSearchCard.tsx`,
`components/saved-searches/SavedSearchPanel.tsx`,
`components/shared/BookmarkButton.tsx`, `hooks/use-saved-searches.ts`,
`pages/CaseDetailPage.tsx`, `pages/CasesPage.tsx`, `pages/CollectionDetailPage.tsx`,
`pages/CollectionsPage.tsx`, `pages/DashboardPage.tsx`, `pages/SavedSearchesPage.tsx`.

The three affected routes are registered at `frontend/src/App.tsx:241`
(`path="collections"`), `:249` (`path="saved-searches"`), and `:257`
(`path="collections/:collectionId"`).

### Repo conventions the ADR must honour and must not contradict

Quoted from `CLAUDE.md` and the repo's own code, because you have not read them:

- **React**: use `.toSorted()` not `.sort()` (never mutate arrays in React);
  wrap every `localStorage` call in try/catch; write UI strings as
  `t("key", { defaultValue: "English text" })`; TanStack Query hooks that depend
  on filters must use `placeholderData` / `keepPreviousData` to avoid empty-state
  flash on rapid page switches; every Recharts `Tooltip` `contentStyle` must set
  `color: "var(--color-text)"`; put `animate-spin` on a wrapper `<div>`, not on
  the SVG icon; all spacing / shadow / radius / colour values come from
  `frontend/src/tokens/tokens.json` — no magic numbers.
- **Design direction is already decided and is named "Legal Codex"**: warm
  off-white `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text
  serif headings, 9 court-specific colour codes. The primary user is a
  self-representing immigration applicant, **not a lawyer**; the brand is
  authoritative, precise, academic. Any UX the ADR proposes must fit that user.
- **Worker**: tenant isolation is app-layer via
  `CloudflareIdentityStore.assertMembership()` in `workers/storage/cloudflare.js`
  — there is **no Postgres and no RLS**. `env.IMMI_CATALOG_DB` /
  `IMMI_ACCOUNT_DB` / `IMMI_OPS_DB` are D1 bindings, not Postgres connections.
- **By design, never "fix" these**: placeholder resource IDs in the checked-in
  `wrangler.toml`; `IMMI_CASE_MUTATIONS_ENABLED` and the pipeline flags
  defaulting to `"false"`; `workers/austlii-scraper/scripts/rollback_run.ts`
  targeting legacy Supabase; the `CLAUDE.md` "Performance Baseline (2026-05-05)"
  section being historical.
- **Commits**: `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines. Real
  example from `git log`: `fix: install root node_modules in make install`.

## Commands you will need

Run from the repo root unless the command says otherwise.

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend typecheck | `cd frontend && npx tsc -b --noEmit` | exit 0, no output (~6s) |
| Frontend lint (scoped) | `cd frontend && npx eslint src/hooks/use-bookmarks.ts src/lib/saved-searches.ts` | exit 0 and `✖ 1 problem (0 errors, 1 warning)` — see note below |
| Frontend tests | `cd frontend && npx vitest run` | `490 passed`, 55 files |
| Worker tests | `cd workers && npx vitest run` | `345 passed`, 25 files |
| Python tests | `make test-py` | `1141 passed, 3 failed, 7 skipped` — see note below |
| Python lint | `make lint` | `All checks passed!` |
| Scope check | `git status --short` | only the in-scope files, plus pre-existing ` M .claude/STATE.md` |

**Note on the 1 eslint warning**: it is pre-existing and expected.
`frontend/src/hooks/use-bookmarks.ts:154` carries
`// eslint-disable-next-line @typescript-eslint/no-unused-vars` which eslint now
reports as an unused directive. Do **not** remove it and do **not** run
`eslint --fix` — that is outside this plan's remit. After you add a comment
block at the top of the file the reported line number will shift down by exactly
the number of lines you added; the count must stay `0 errors, 1 warning`.

**Note on the 3 Python failures**: they are environmental, not repo bugs.
Homebrew Python 3.14.7 has a `pyexpat`/`libexpat` ABI mismatch that breaks the
`pypdf` import in `tests/test_backfill_judge_overrides_from_pdf.py`. They fail
identically at `42826a3` before you change anything. Do not try to fix them.

**Note on `make typecheck`**: do not use it as your gate. It runs
`npx tsc --noEmit`, which in this repo exits 0 while loading **zero** files
(`frontend/tsconfig.json` is `files: []` plus project references). Only
`npx tsc -b --noEmit` actually type-checks the 169 source files. Fixing the
Makefile target is another plan's job — do not touch the Makefile here.

Python must run through the repo venv: `.venv/bin/python`, `.venv/bin/pytest`,
`.venv/bin/ruff`. Never global `pip`. `make` targets already point at the venv.

## Scope

**In scope** (the only files you may create or modify):

- `docs/adr/README.md` (create)
- `docs/adr/0001-user-data-persistence.md` (create)
- `frontend/src/hooks/use-bookmarks.ts` (add a comment block only — no code change)
- `frontend/src/lib/saved-searches.ts` (add a comment block only — no code change)

**Out of scope** (do NOT touch, even though they look directly related):

- `migrations/d1/account/0001_account.sql` **and any new file under
  `migrations/d1/account/`.** This plan has permission to write there and
  deliberately does not. Adding a `0002_*.sql` that no code reads would create a
  *second* unused schema — the precise failure this ADR exists to document. The
  schema delta belongs inside the ADR as a proposal until an implementer lands it
  together with the code that uses it. If you think the migration should be
  written now, that is a STOP condition, not a judgement call.
- Any file under `workers/`. No routes, no store methods, no dispatch entries.
- `frontend/src/types/bookmarks.ts` and `frontend/src/types/case.ts` — the ADR
  quotes them; changing them changes runtime types.
- All 14 consumer components/pages listed in "Current state".
- `frontend/vitest.config.ts` — see "Maintenance notes" for a real defect there
  that belongs to the frontend-test-harness plan, not this one.
- `Makefile` — the broken `typecheck` target is another plan's.
- `scripts/reconcile_immi_transform.py`, `scripts/migrate_anon_data.py` —
  Supabase/RLS-era scripts. `migrate_anon_data.py:8` still describes
  "RLS policy: tenant_id IS NULL → public read", which does not exist in this
  stack. Deleting dead Supabase-era code is a separate plan.
- `wrangler.toml` — in particular do not flip `IMMI_CASE_MUTATIONS_ENABLED`.
- `CLAUDE.md`, `README.md`, `docs/plans/2026-03-15-system-integration-roadmap.md`.

## Git workflow

- Branch: `advisor/050-move-user-data-server-side`
- One commit for the ADR, one for the code comments. Message style is
  conventional commits, matching `git log` (e.g. `fix: install root node_modules
  in make install`). Suggested messages:
  - `docs: record the ADR for server-side user data`
  - `docs: point the localStorage stores at ADR 0001`
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and ships.

## Steps

### Step 1: Create the ADR directory and its README

`docs/adr/` does not exist. Create it along with `docs/adr/README.md` containing
exactly this content — it establishes the convention for every later ADR:

```markdown
# Architecture Decision Records

Each file records one decision that is expensive to reverse: the context that
forced it, the options weighed, the choice, and what it costs.

Naming: `NNNN-kebab-slug.md`, numbered in the order decisions were made.

Status values: `Proposed` | `Accepted` | `Superseded by NNNN` | `Rejected`.
Never edit a decision after it is Accepted — write a new ADR that supersedes it,
so the reasoning behind the old choice stays readable.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-user-data-persistence.md) | Where bookmarks, collections and saved searches live | Proposed |
```

**Verify**: `ls docs/adr/README.md && head -1 docs/adr/README.md`
→ prints the path, then `# Architecture Decision Records`

### Step 2: Write the ADR

Create `docs/adr/0001-user-data-persistence.md`. Write it in English. It must
contain these sections, with the substance given below. You are transcribing and
formatting a decision that has already been made — do not invent new options,
and do not soften any of the numbered decisions.

Every file:line reference you write must be one that appears in this plan. Do
not add references you have not personally opened and confirmed.

**Front matter** — a `# ADR 0001: Where bookmarks, collections and saved searches
live` heading, then a status block:

```
- **Status**: Proposed
- **Date**: 2026-08-27
- **Context commit**: `42826a3`
- **Supersedes**: steps 1–3 of T13 in `docs/plans/2026-03-15-system-integration-roadmap.md:472`
```

**## Context** — state, with the file:line evidence from this plan:

1. `/collections`, `/collections/:collectionId` and `/saved-searches` are shipped
   routes (`frontend/src/App.tsx:241`, `:249`, `:257`) whose data lives only in
   `localStorage`, under keys `immi-bookmarks`
   (`frontend/src/hooks/use-bookmarks.ts:9`) and `saved-searches`
   (`frontend/src/lib/saved-searches.ts:3`).
2. Both write paths swallow quota / private-mode failures silently
   (`frontend/src/hooks/use-bookmarks.ts:35-43`,
   `frontend/src/lib/saved-searches.ts:95-101`), and the saved-search loader
   *deletes* the key outright on a non-array payload
   (`frontend/src/lib/saved-searches.ts:62-69`). A user can lose everything with
   no error surfaced.
3. `collections`, `collection_items` and `saved_searches` were migrated into
   `IMMI_ACCOUNT_DB` (`migrations/d1/account/0001_account.sql:56-87`) and have
   **never** been referenced by Worker code — `grep -rn "collection_items\|saved_searches" workers/`
   returns nothing.
4. The only shipped collections route, `/api/v1/collections/export`
   (`workers/case-api/cloudflare_actions.js:150-161`), renders HTML from a
   client-supplied body and reads no stored collection. Every other
   `/api/v1/collections*` and `/api/v1/bookmarks*` path 503s via
   `workers/cloudflare-native.js:229-231`.
5. **Explicitly correcting a claim that circulates about this area**: it is
   *not* true that logging in buys the user nothing. LLM Council sessions are
   already auth-gated and tenant-scoped server-side
   (`workers/llm-council/cloudflare_handlers.js:79` and `:265-275`,
   `council_sessions` at `migrations/d1/account/0001_account.sql:103-134`).
   Durable Council history is a real logged-in benefit today. What login does not
   yet buy is durable *bookmarks, collections and saved searches*.

**## Decision 1 — The tables as migrated cannot hold the shipped data; fix the
schema in the same change as the code that uses it**

Reproduce the full gap table from "Current state" above (all ten rows). Then
state the decision: the schema delta below is **proposed, not applied**. No
`migrations/d1/account/0002_*.sql` is added until an implementer lands it in one
change together with the Worker store methods and routes that read it — the repo
already carries one unused schema and must not carry two.

Include the proposed delta as a fenced `sql` block, marked clearly as a proposal:

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

Note in prose that `Collection.name` maps to `collections.title` and
`SavedSearch.name` to `saved_searches.title` (rename at the serialisation
boundary, do not add a `name` column), and that `SavedSearch.filters` already
fits `query_json` because of the `CHECK(json_valid(query_json))` at
`migrations/d1/account/0001_account.sql:82`.

**## Decision 2 — The CRUD surface**

Decide: new routes are implemented **in the Worker**, as D1 queries in a new
`workers/case-api/` module dispatched from `workers/cloudflare-native.js`. There
is no Flask in production to fall back to — an unhandled route is a real 503, not
a soft degrade.

Specify the surface as a table of method + path + gate:

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

State the four binding constraints, each with its evidence:

- Every write goes through the existing `requireWriter` helper —
  CSRF → JWT → `assertMembership` — copied from
  `workers/case-api/cloudflare_actions.js:41-53`. Do not write a new gate.
- Every read store method calls `await this.assertMembership(auth)` on its first
  line and carries `WHERE tenant_id = ?`, exactly like
  `workers/storage/cloudflare.js:1508-1520`. Tenant isolation here is app-layer;
  a method that forgets the call is a real cross-tenant leak, with no RLS
  backstop (`workers/storage/cloudflare.js:1300-1314`).
- `PUT …/items` replaces the whole ordered list rather than exposing
  per-item reorder endpoints, so `Collection.case_order` round-trips in one
  atomic D1 batch and drag-reorder in the SPA cannot half-apply.
- These routes are **not** gated by `IMMI_CASE_MUTATIONS_ENABLED`. That flag
  guards writes to the shared case corpus (`wrangler.toml:92`); per-tenant user
  data is a different blast radius and needs its own flag if one is wanted.

**## Decision 3 — The offline and migration story: server-authoritative, with a
one-way import on first login**

Decide, and record the reasoning:

- Logged out, the SPA keeps working exactly as today, against `localStorage`.
  The primary user is a self-representing applicant who may never log in;
  breaking the anonymous path is not acceptable.
- Logged in, the server is authoritative. The client caches through TanStack
  Query, and filter-dependent hooks use `placeholderData`/`keepPreviousData` per
  the repo convention.
- On the **first** login on a given browser, offer a one-way import of whatever
  is in `immi-bookmarks` and `saved-searches` into the tenant, then mark the
  local keys imported. Never merge in the other direction, and never
  auto-import silently — the applicant must see what is being uploaded.
- **Rejected: two-way sync.** It needs per-field conflict resolution and
  vector clocks for a single-user-per-tenant workload. Cost is not repaid.
- **Rejected: leave it in `localStorage` and just surface the errors.** It does
  not survive a device change or a cleared cache, which is the actual failure
  the user reports.

**## Decision 4 — Per-case notes and tags move to tenant-scoped tables; the
shared catalog columns become extraction output only**

State the problem with its evidence: `cases.user_notes` and `cases.tags` are
columns on the single global catalog row
(`migrations/d1/catalog/0001_catalog.sql:31-32`) and the mutation handler writes
them (`workers/case-api/cloudflare_mutations.js:111-112`). With more than one
tenant, tenant A's note overwrites tenant B's. There is no per-tenant dimension
on that row and cannot be one — it is the shared corpus.

State the decision: a user's private note about a case lives in
`bookmarks.note` (per `tenant_id`+`owner_id`+`case_id`) or in
`collection_items.note` when it is scoped to one collection. `cases.user_notes`
and `cases.tags` are reclassified as extraction/curation output owned by the
pipeline, not user input, and the SPA must stop offering them as a
user-editable field once the bookmark note ships.

State why now: `IMMI_CASE_MUTATIONS_ENABLED = "false"` (`wrangler.toml:92`)
means the columns have never received a user write. The migration cost is
literally zero today and grows with every write after the flag flips.

**## Consequences**

- What gets better: durable research across devices, real error surfaces on
  write failure, a genuine reason to log in beyond Council history.
- What it costs: ~13 new routes, a new store class, a schema migration, a
  first-login import flow, and an anonymous path that must keep working —
  meaning the SPA carries two data sources for a while.
- What stays broken until an implementer picks this up: everything in Context.
  This ADR ships no behaviour.
- Follow-on decisions deliberately **not** made here: whether collections are
  shareable across a tenant's members or private to `owner_id`; whether saved
  searches support scheduled re-execution; rate limits on the new write routes.

**Verify**:
```bash
test -f docs/adr/0001-user-data-persistence.md && \
grep -c "^## " docs/adr/0001-user-data-persistence.md
```
→ prints a number `>= 7` (Context, Decision 1–4, Consequences, plus any others)

And confirm every decision is present:
```bash
grep -c "^## Decision" docs/adr/0001-user-data-persistence.md
```
→ `4`

And confirm the false claim was not reproduced:
```bash
grep -in "buys the user nothing\|buys nothing" docs/adr/0001-user-data-persistence.md
```
→ no output other than the correction sentence in Context item 5, if you phrased
it using those words; if it appears anywhere as an assertion rather than a
correction, rewrite that sentence.

### Step 3: Anchor the ADR from `use-bookmarks.ts`

Add this comment block to `frontend/src/hooks/use-bookmarks.ts` as the very
first thing in the file, **above** the existing `import { useCallback,
useSyncExternalStore } from "react";` on line 1, followed by one blank line.
Change nothing else in the file:

```ts
/**
 * Bookmarks and collections, persisted per-browser in localStorage.
 *
 * Client-only by design today, not by oversight. The server-side replacement —
 * the D1 tables, the Worker CRUD surface, and the one-way import performed on
 * first login — is decided in `docs/adr/0001-user-data-persistence.md`.
 *
 * Read that ADR before adding a field here: the shapes in this file are the
 * migration source, so every new field becomes another column to carry across,
 * and `BookmarkEntry` has no destination table at all yet.
 */
```

**Verify**:
```bash
cd frontend && npx eslint src/hooks/use-bookmarks.ts src/lib/saved-searches.ts
```
→ exit 0, `✖ 1 problem (0 errors, 1 warning)` (the pre-existing unused-disable
directive, now reported ~10 lines lower than 154)

```bash
cd frontend && npx tsc -b --noEmit
```
→ exit 0, no output

### Step 4: Anchor the ADR from `saved-searches.ts`

Add this comment block to `frontend/src/lib/saved-searches.ts` as the very first
thing in the file, **above** the existing `import type { SavedSearch, CaseFilters
} from "@/types/case";` on line 1, followed by one blank line. Change nothing
else in the file:

```ts
/**
 * Saved searches, persisted per-browser in localStorage.
 *
 * Client-only by design today, not by oversight. The server-side replacement —
 * `saved_searches` in IMMI_ACCOUNT_DB, the Worker CRUD surface, and the one-way
 * import performed on first login — is decided in
 * `docs/adr/0001-user-data-persistence.md`.
 *
 * Note the failure mode that ADR exists to remove: `loadSavedSearches` deletes
 * the storage key when the payload is not an array, and `saveSavedSearches`
 * swallows quota and private-mode errors. Both are silent to the user.
 */
```

**Verify**:
```bash
cd frontend && npx eslint src/hooks/use-bookmarks.ts src/lib/saved-searches.ts
```
→ exit 0, still `✖ 1 problem (0 errors, 1 warning)` — if the count changed, you
edited more than the comment

```bash
cd frontend && npx tsc -b --noEmit
```
→ exit 0, no output

Confirm you changed only comments — the diff must contain no removed lines other
than context, and no added line that is not part of a `/** … */` block:

```bash
git diff --stat -- frontend/src/hooks/use-bookmarks.ts frontend/src/lib/saved-searches.ts
```
→ two files, roughly `+11` and `+13` insertions, `0` deletions

### Step 5: Run the full gate

Run every command in "Commands you will need" and confirm each expected result.
Nothing in this plan changes runtime behaviour, so every number must match the
baseline exactly.

**Verify**:
```bash
cd frontend && npx vitest run 2>&1 | tail -5
```
→ `490 passed`, 55 test files

```bash
cd workers && npx vitest run 2>&1 | tail -5
```
→ `345 passed`, 25 test files

```bash
make test-py 2>&1 | tail -3
```
→ `1141 passed, 3 failed, 7 skipped` (the 3 are the pre-existing pyexpat/pypdf
environmental failures — see "Commands you will need")

```bash
make lint
```
→ `All checks passed!`

```bash
git status --short
```
→ exactly: `M frontend/src/hooks/use-bookmarks.ts`,
`M frontend/src/lib/saved-searches.ts`, `?? docs/adr/`, `?? plans/` (this plan
file), and the pre-existing ` M .claude/STATE.md`. Nothing else.

## Test plan

This plan adds no executable behaviour, so it adds **no new tests**. That is the
correct outcome, not a gap — a test asserting the content of a Markdown file
would lock prose in place and break on every legitimate edit to the ADR.

What must be proven instead is that nothing regressed:

- `cd frontend && npx vitest run` → `490 passed` across 55 files, unchanged from
  the `42826a3` baseline.
- `cd workers && npx vitest run` → `345 passed` across 25 files, unchanged.
- `make test-py` → `1141 passed, 3 failed, 7 skipped`, unchanged (the 3 failures
  are environmental and pre-existing).
- `cd frontend && npx tsc -b --noEmit` → exit 0 over 169 source files.
- `cd frontend && npx eslint src/hooks/use-bookmarks.ts src/lib/saved-searches.ts`
  → `0 errors, 1 warning`, the warning count unchanged.

The tests that *would* be written when someone implements the ADR — and which
this plan explicitly defers — are: Worker store-method tests proving every read
path 403s for a non-member (model them on the existing Worker suite under
`workers/`), and a first-login import test. Note them in the ADR's Consequences
section; do not write them here.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `test -f docs/adr/README.md` exits 0
- [ ] `test -f docs/adr/0001-user-data-persistence.md` exits 0
- [ ] `grep -c "^## Decision" docs/adr/0001-user-data-persistence.md` prints `4`
- [ ] `grep -q "0001_account.sql:56-87" docs/adr/0001-user-data-persistence.md` exits 0
- [ ] `grep -q "0001_catalog.sql:31-32" docs/adr/0001-user-data-persistence.md` exits 0
- [ ] `grep -q "PROPOSED, NOT APPLIED" docs/adr/0001-user-data-persistence.md` exits 0
- [ ] `grep -q "docs/adr/0001-user-data-persistence.md" frontend/src/hooks/use-bookmarks.ts` exits 0
- [ ] `grep -q "docs/adr/0001-user-data-persistence.md" frontend/src/lib/saved-searches.ts` exits 0
- [ ] `ls migrations/d1/account/` lists exactly `0001_account.sql` and nothing else
- [ ] `git diff --numstat -- frontend/src/hooks/use-bookmarks.ts frontend/src/lib/saved-searches.ts`
      shows `0` in the deletions column for both files
- [ ] `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `cd frontend && npx eslint src/hooks/use-bookmarks.ts src/lib/saved-searches.ts` exits 0 with `0 errors, 1 warning`
- [ ] `cd frontend && npx vitest run` reports `490 passed`
- [ ] `cd workers && npx vitest run` reports `345 passed`
- [ ] `make test-py` reports `1141 passed, 3 failed, 7 skipped`
- [ ] `make lint` prints `All checks passed!`
- [ ] `git status --short` shows no modified file outside the in-scope list
- [ ] `git diff --quiet -- workers/ migrations/ wrangler.toml Makefile` exits 0

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check or the evidence drift check prints anything. In particular, if
  `migrations/d1/account/0001_account.sql` changed, the entire gap table in
  Decision 1 may be stale and must be re-derived before the ADR is written.
- `grep -rn "collection_items\|saved_searches" workers/` now returns hits.
  Someone has started implementing this; the ADR must document what they built
  rather than propose something that contradicts it.
- `migrations/d1/account/` already contains a `0002_*.sql`. The "no second
  unused schema" argument in Decision 1 no longer holds and the decision needs
  rethinking, not patching.
- `wrangler.toml` no longer reads `IMMI_CASE_MUTATIONS_ENABLED = "false"`. The
  "free to fix now" argument in Decision 4 depends on it — if writes were
  enabled, `cases.user_notes` may already hold real cross-tenant data and the
  decision needs a data-migration section this plan does not contain.
- A `bookmarks` table has appeared in any migration under `migrations/`.
- You conclude the schema delta must be written as a real `.sql` file now. That
  contradicts the explicit Out-of-scope entry — report the reasoning, do not
  write the file.
- The eslint warning count on the two frontend files becomes anything other than
  `0 errors, 1 warning`, or the deletions column of
  `git diff --numstat` on either file is non-zero. Either means you changed code,
  not just comments.
- Any test count moves off `490` / `345` / `1141 passed, 3 failed, 7 skipped`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

For the human or agent who owns this next:

- **What a reviewer should scrutinise**: that the ADR's gap table matches the SQL
  and the TypeScript types as they actually are — that table is the whole value
  of this plan, and it is the part that silently rots. Re-run
  `grep -rn "collection_items\|saved_searches" workers/` before approving; if it
  now returns hits, the ADR is describing a world that no longer exists.
- **The next change that interacts with this**: any edit to
  `frontend/src/types/bookmarks.ts` or the `SavedSearch` interface at
  `frontend/src/types/case.ts:375-382` adds a row to the migration gap. The
  comment blocks added in Steps 3 and 4 exist to make that visible at the point
  of edit.
- **Deferred out of this plan on purpose**: the `0002_*.sql` migration, all
  Worker routes and store methods, the first-login import UI, and the removal of
  `cases.user_notes` / `cases.tags` from the SPA's editable fields. All are
  specified in the ADR and none are implemented. The next plan in this line
  should land the schema and the code that reads it in **one** change.
- **A real defect found next door, deliberately not fixed here**:
  `frontend/vitest.config.ts:11` sets `include: ["__tests__/**/*.{test,spec}.{ts,tsx}"]`,
  rooted at `frontend/`. The 28-assertion suite at
  `frontend/src/lib/__tests__/saved-searches.test.ts` — which tests
  `frontend/src/lib/saved-searches.ts`, a file this plan owns — does not match
  that glob and **never runs**. `npx vitest run src/lib/__tests__/saved-searches.test.ts`
  prints `No test files found, exiting with code 1`. The 55 collected files are
  all under `frontend/__tests__/`. Fixing the include pattern belongs to the
  frontend-test-harness plan (`plans/039-fix-the-frontend-test-harness.md`), not
  here, because changing it will surface unknown failures across the whole suite
  and that is not a change this documentation plan should make. Flag it to
  whoever owns 039 if it is still true when this lands.
- **Do not "fix" on sight**: the placeholder resource IDs in `wrangler.toml`, the
  `"false"` mutation and pipeline flags, `workers/austlii-scraper/scripts/rollback_run.ts`
  targeting legacy Supabase, and the historical "Performance Baseline
  (2026-05-05)" section of `CLAUDE.md`. All four are intentional.

## Findings reconsidered

- **"Telegram login currently buys the user nothing a logged-out visitor doesn't
  have"** — this framing accompanied the finding and is **false**. LLM Council
  sessions are already auth-gated and tenant-scoped server-side:
  `workers/llm-council/cloudflare_handlers.js:265-275` runs `requireSessionAuth`
  then `stores.identityStore.listCouncilSessions(auth, …)`, `:79` is
  `const auth = await stores.identityStore.assertMembership(claims);`, and
  `council_sessions` / `council_turns` — with retrieve codes — are at
  `migrations/d1/account/0001_account.sql:103-134`. Login already buys durable
  Council history. The plan states the accurate, narrower claim instead (login
  does not yet buy durable bookmarks, collections or saved searches) and Step 2
  requires the ADR to record the correction so it stops circulating.
- **"The tenant-scoped tables … were migrated"**, implying the schema is ready
  and only code is missing — **partially wrong, and the correction is the most
  valuable content in this plan**. The tables exist but cannot hold the shipped
  client shapes: there is no `bookmarks` table anywhere in `migrations/`
  (`grep -rn "bookmark" migrations/` returns nothing), `collection_items` has no
  `position` or `note` so `Collection.case_order` and `Collection.case_notes` are
  both unrepresentable, `collections` has no `tags` or `color`, and
  `saved_searches` has no `last_executed_at` or `result_count`. The implied
  "wire up the existing tables" task does not exist; a schema change is required
  first. Decision 1 of the ADR carries the full audit.
- **The claimed evidence `frontend/src/hooks/use-bookmarks.ts:9`** — confirmed
  exact (`const STORAGE_KEY = "immi-bookmarks";`), as were
  `migrations/d1/account/0001_account.sql:56` and `:77`,
  `frontend/src/lib/saved-searches.ts:3`,
  `workers/case-api/cloudflare_actions.js:88` (`handleCollectionExport`) and
  `:41-53` (`requireWriter`), `migrations/d1/catalog/0001_catalog.sql:31-32`, and
  the roadmap's T13 heading at
  `docs/plans/2026-03-15-system-integration-roadmap.md:472`. No corrections were
  needed to any file:line in the finding itself.
