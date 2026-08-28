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
> **Drift check (run first)**. A committed-history diff cannot see uncommitted,
> staged or untracked work, so all four commands must run:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> SCOPE=(docs/adr/0050-user-data-server-side.md migrations/d1/account/ frontend/src/hooks/use-bookmarks.ts frontend/src/lib/saved-searches.ts)
> git status --short --branch
> git diff --stat 42826a3..HEAD -- "${SCOPE[@]}"     # committed since the plan was written
> git diff --stat -- "${SCOPE[@]}"                   # unstaged
> git diff --cached --stat -- "${SCOPE[@]}"          # staged
> ```
> Expected: the last three print nothing and no in-scope path appears in
> `git status`. `docs/adr/` merely existing (because
> `plans/044-retire-the-stale-planning-docs.md` owns and created it) is fine
> and expected. If any in-scope file appears in **any** of them, treat it as a
> STOP condition. **Never** run `git checkout --` or `git clean -f` to force a
> clean tree — the uncommitted work is the operator's.
>
> **Evidence drift check (also run first, same four forms)** — this plan quotes
> files it does not own, and its whole argument rests on them:
> ```bash
> EVID="migrations/d1/catalog/0001_catalog.sql
>   workers/case-api/cloudflare_mutations.js workers/case-api/cloudflare_actions.js
>   workers/storage/cloudflare.js frontend/src/types/bookmarks.ts
>   frontend/src/types/case.ts scripts/transform_immi_snapshot.py wrangler.toml"
> git diff --stat 42826a3..HEAD -- $EVID
> git diff --stat -- $EVID
> git diff --cached --stat -- $EVID
> ```
> Expected: all three empty. If not, re-read the changed file and confirm the
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
(`IMMI_CASE_MUTATIONS_ENABLED = "false"`), so no data has arrived through *that*
path. The moment an operator flips that flag, tenant A's private note on a case
silently overwrites tenant B's.

**What that flag does not tell you.** An earlier draft of this plan inferred
from the flag that the two columns are empty. That inference does not hold, and
Step 2 must not repeat it. There is a second write path with no flag on it:
`scripts/transform_immi_snapshot.py:267` carries `tags` and `user_notes`
straight from the source snapshot into the D1 catalog INSERT
(the column list is at `:280-281`), and `scripts/export_immi_ndjson.py` exports
them too. So whatever the legacy Postgres corpus held in those columns may
already be sitting in `IMMI_CATALOG_DB` today, imported before the mutation flag
was ever relevant. Whether that content is user-authored notes, extraction
output, or empty strings is **unknown until someone counts** — and the answer
changes the decision from "free, no migration" to "there is existing data with a
provenance question". Step 2a makes the count a precondition rather than an
assumption.

## Current state

### The files this plan touches

- `docs/adr/` — did not exist at `42826a3`. `docs/` held `ARCHITECTURE.md`,
  `HYPERDRIVE_CACHE_RFC.md`, `JUDGE_DATA_QUALITY.md`, `UPLOAD_JUDGE_PHOTOS.md`,
  and the `ops/`, `plans/`, `screenshots/` directories. **The directory and its
  conventions are owned by `plans/044-retire-the-stale-planning-docs.md`**,
  which creates `docs/adr/README.md`, `docs/adr/TEMPLATE.md` and ADRs 0001–0003.
  This plan does **not** establish the convention and does **not** write an
  index; it contributes exactly one file, `docs/adr/0050-user-data-server-side.md`.
  Finding the directory already present is normal.
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

So no user has written a note through **the mutation route**. That is not the
same as "the columns are empty", and the ADR must not say it is.

### The second write path, which has no flag

`scripts/transform_immi_snapshot.py:267` (verbatim, the values tuple of the
catalog INSERT):

```python
            string(row.get("text_snippet")) or text[:500], string(row.get("tags")), string(row.get("user_notes")),
```

and its column list at `:280-281`:

```python
              is_represented,representative,source,case_nature,url,catchwords,legislation,text_snippet,tags,
              user_notes,visa_outcome_reason,legal_test_applied,last_extraction_run_id,extraction_confidence_json,
```

`scripts/export_immi_ndjson.py` carries the same two fields out of the source
snapshot. Neither script consults `IMMI_CASE_MUTATIONS_ENABLED` — that flag
gates `dispatchCloudflareCaseMutation` in the Worker, not a bulk import run by
an operator. So the live D1 catalog may already hold non-empty `tags` /
`user_notes` inherited from the Supabase-era corpus.

**Nobody has counted.** The executor cannot: it has no production D1
credentials. That is precisely why Step 2a turns the count into an
operator-run precondition and forbids the ADR from asserting emptiness.

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

**Record baselines first; this plan asserts that nothing moved, not that any
particular total was reached.** Sibling plans add tests in parallel, so an
absolute figure written here would be wrong on arrival:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
(cd frontend && npx vitest run 2>&1 | tail -3)         # -> FE_BEFORE
(cd workers  && npx vitest run 2>&1 | tail -3)         # -> WK_BEFORE
make test-py 2>&1 | tail -1                            # -> PY_BEFORE
make test-py 2>&1 | grep -E "^(FAILED|ERROR)" | sort   # -> PY_FAIL_BEFORE (named failures)
```

| Purpose | Command | Expected on success |
|---|---|---|
| Frontend typecheck | `cd frontend && npx tsc -b --noEmit` | exit 0, no output (~6s) |
| Frontend lint (scoped) | `cd frontend && npx eslint src/hooks/use-bookmarks.ts src/lib/saved-searches.ts` | exit 0 and `✖ 1 problem (0 errors, 1 warning)` — see note below |
| Frontend tests | `cd frontend && npx vitest run` | `FE_BEFORE` passed, **unchanged** (this plan runs no runtime code) |
| Worker tests | `cd workers && npx vitest run` | `WK_BEFORE` passed, **unchanged** |
| Python tests | `make test-py` | `PY_BEFORE` passed, **unchanged**, and the failure set identical to `PY_FAIL_BEFORE` — see note below |
| Python lint | `.venv/bin/ruff check immi_case_downloader/ scripts/ *.py` | `All checks passed!` (spelled out rather than `make lint`: `plans/001` Step 3 turns `lint:` into `lint: lint-py lint-fe`) |
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

- `docs/adr/0050-user-data-server-side.md` (create — the **only** file you may
  add under `docs/adr/`)
- `frontend/src/hooks/use-bookmarks.ts` (add a comment block only — no code change)
- `frontend/src/lib/saved-searches.ts` (add a comment block only — no code change)

**Out of scope** (do NOT touch, even though they look directly related):

- `docs/adr/README.md` and `docs/adr/TEMPLATE.md` — owned by `plans/044`. Do
  not create them, append to them, or reformat them. Your index row is added by
  044 when it lands (see "Maintenance notes").
- **Production data.** Step 1a is a **read-only** inventory, run by the
  operator. This plan issues no `UPDATE`, `DELETE`, `ALTER` or migration
  against any database, and must not be read as authorising one.
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
  - `docs: point the localStorage stores at ADR 0050`
- Do **not** push, do **not** open a PR, do **not** merge. The operator commits
  and ships.

## Steps

### Step 1: Make the ADR directory available (no index file)

```bash
mkdir -p docs/adr
```

That is the whole step. **Do not create `docs/adr/README.md` or
`docs/adr/TEMPLATE.md`.** ADR numbering is centrally assigned:
`plans/044-retire-the-stale-planning-docs.md` **owns** `docs/adr/`, creating the
directory, the index, the template and ADRs 0001–0003. This plan's assigned
file is `docs/adr/0050-user-data-server-side.md` and nothing else. An earlier
draft wrote its own `README.md` and claimed `0001`, colliding with two sibling
plans doing the same thing — that collision is what forced central assignment.
The directory already existing is the normal case, not a STOP condition.

**Verify**:
```bash
test -d docs/adr && git status --short -- docs/adr/README.md docs/adr/TEMPLATE.md
```
→ the directory exists and `git status` prints **nothing** for those two paths.

### Step 1a: Inventory the existing `tags` / `user_notes` data (operator-run)

**This is a precondition for Decision 4, not a formality.** Decision 4 says
"the migration cost is literally zero today". That claim rests on the columns
being empty, which nobody has verified — and the import path at
`scripts/transform_immi_snapshot.py:267` can have filled them without ever
touching the mutation flag (see "The second write path").

You almost certainly cannot run this yourself: it needs production D1 access.
Ask the operator to run it and give you the numbers. If they cannot or will
not, **the ADR must record the counts as UNKNOWN and Decision 4 must be
downgraded from "free now" to "requires a data inventory first"** — do not
paper over a missing measurement with an assumption.

```bash
# Read-only. Against the production catalog D1.
npx wrangler d1 execute IMMI_CATALOG_DB --remote --command "
  SELECT
    COUNT(*)                                                   AS total_cases,
    SUM(CASE WHEN COALESCE(tags,'')       <> '' THEN 1 ELSE 0 END) AS with_tags,
    SUM(CASE WHEN COALESCE(user_notes,'') <> '' THEN 1 ELSE 0 END) AS with_notes
  FROM cases;"

# If either count is non-zero, sample 20 rows to judge PROVENANCE — are these
# user-authored notes, or extraction/curation output that merely lives in a
# badly-named column?
npx wrangler d1 execute IMMI_CATALOG_DB --remote --command "
  SELECT case_id, substr(tags,1,80) AS tags, substr(user_notes,1,120) AS user_notes
  FROM cases WHERE COALESCE(user_notes,'') <> '' OR COALESCE(tags,'') <> '' LIMIT 20;"
```

Also count what the **source snapshot** carried, since that is where any
existing content came from — the operator runs this wherever the snapshot lives:
`grep -c '"user_notes": "[^"]' <snapshot>.ndjson` (or the equivalent against the
CSV corpus).

Then record, in the ADR's Context, all four of:

1. `total_cases`, `with_tags`, `with_notes` from the live catalog, **with the
   date measured** — or the word UNKNOWN and why.
2. Whether the sampled content reads as user-authored or as extraction output.
3. Whether any of it can be attributed to a tenant or owner. (It cannot: the
   `cases` row has no tenant column. That is the finding, and it means any
   existing note is already un-attributable — which strengthens Decision 4
   rather than weakening it.)
4. Whether the operator has taken a backup before any later plan migrates or
   drops these columns. `CLAUDE.md`'s production-cleanup rule applies in full:
   add a `<col>_backup` column and copy into it **before** any bulk write, and
   dry-run on `LIMIT 100` with eyeballed output.

**Nothing in this plan changes the data.** Step 1a only makes the later
decision honest about what is there.

**Verify**: the ADR's Context contains the three counts (or an explicit
UNKNOWN with the reason), and Decision 4's cost claim matches them.

### Step 2: Write the ADR

Create `docs/adr/0050-user-data-server-side.md`. Write it in English. It must
contain these sections, with the substance given below. You are transcribing and
formatting a decision that has already been made — do not invent new options,
and do not soften any of the numbered decisions.

Every file:line reference you write must be one that appears in this plan. Do
not add references you have not personally opened and confirmed.

**Front matter** — a `# ADR 0050: Where bookmarks, collections and saved searches
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
  line, exactly like `workers/storage/cloudflare.js:1508-1520`. Tenant isolation
  here is app-layer; a method that forgets the call is a real cross-tenant leak,
  with no RLS backstop (`workers/storage/cloudflare.js:1300-1314`).
- **Every predicate is `WHERE tenant_id = ? AND owner_id = ?`, not `tenant_id`
  alone.** This is a decision, made here, and it is the correction to an
  earlier draft that copied `listCouncilSessions`' `tenant_id`-only predicate
  while simultaneously deferring the private-versus-shared question to
  "follow-on decisions". Those two together are not a deferral — they are a
  silent choice of *shared*, and the wrong one: every member of a tenant would
  see every other member's bookmarks, collections and saved searches, on a
  product whose primary user is a self-representing applicant whose personal
  tenant is created for them at first login
  (`CloudflareIdentityStore.upsertTelegramUser()`). A private-by-default store
  can be opened up later; data that has already leaked between members cannot
  be un-seen.

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
  is in `immi-bookmarks` and `saved-searches` into the tenant. Never merge in
  the other direction, and never auto-import silently.

  Spell out the mechanics; "offer an import" is not a specification, and every
  one of the following exists because its absence is a way to lose the user's
  research:

  - **Dry-run preview first.** The client posts the payload to a preview
    endpoint (or a `?dry_run=1` variant) that returns what *would* be created,
    what already exists, and what conflicts — and writes nothing. The applicant
    approves that summary before anything is uploaded. This is the whole
    difference between "an import" and "an irreversible action a stressed user
    clicked through".
  - **Idempotency key.** The client generates one key per import attempt and
    sends it on both the preview and the commit. The server stores it and
    returns the original result for a repeat. Without it, a flaky connection
    plus a retry is a duplicated collection set, and the user's first
    impression of the server-side feature is that it doubled their data.
  - **Conflict policy, decided not deferred.** Server rows win on any
    collision; a colliding local item is imported under a suffixed title
    (`"<name> (imported)"`) rather than being merged or dropped. Merging needs
    field-level semantics nobody has defined; dropping loses work silently.
  - **Server-side completion marker, namespaced by `(tenant_id, owner_id)`.**
    A `localStorage` flag is not a marker: the same user on a second browser
    would be offered the import again and would re-upload. The server records
    that this owner has completed an import, and the client asks.
  - **Rollback.** The commit writes under one batch id; a single
    "undo this import" removes exactly the rows that batch created. An import
    with no undo is a one-way door on the user's own data.
  - **The local copy is not deleted.** Keep `immi-bookmarks` and
    `saved-searches` in place until the client has re-read the imported data
    back from the server and confirmed the counts match. Only then mark them
    imported — and even then, prefer renaming the keys (e.g.
    `immi-bookmarks.imported-<date>`) over `removeItem`, because the failure
    mode being defended against is exactly a write that appeared to succeed.
- **Rejected: two-way sync.** It needs per-field conflict resolution and
  vector clocks for a single-user-per-tenant workload. Cost is not repaid.
- **Rejected: leave it in `localStorage` and just surface the errors.** It does
  not survive a device change or a cleared cache, which is the actual failure
  the user reports.
- **Rejected: silent auto-import on first login.** The applicant must see what
  is being uploaded and to which account; this is their case research, and the
  product's whole claim is that it is trustworthy with it.

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

State why now, **using the Step 1a numbers and not an assumption**:
`IMMI_CASE_MUTATIONS_ENABLED = "false"` (`wrangler.toml:92`) means the columns
have never received a write **through the mutation route** — but
`scripts/transform_immi_snapshot.py:267` imports both columns from the source
snapshot with no flag involved, so the live catalog may already hold content.
Write the measured counts here. Then state the cost honestly, in whichever form
the measurement supports:

- **`with_notes = 0` and `with_tags = 0`** → the migration cost is zero today
  and grows with every write after the flag flips. Decide now.
- **either count is non-zero** → there is existing content whose provenance must
  be classified before anything moves. It is already un-attributable (the
  `cases` row has no tenant column), so it cannot be migrated *to* a tenant;
  the choice is between keeping it as pipeline-owned curation output under a
  clearer name and discarding it. Either way a backup column comes first, per
  `CLAUDE.md`'s production-cleanup rule.
- **UNKNOWN** → say so, and downgrade the decision to "reclassification agreed
  in principle, blocked on a data inventory". An ADR that asserts zero cost
  without a count is the kind of claim that gets discovered wrong during the
  migration.

Whatever the counts, the *design* decision stands: a shared, global row cannot
hold per-tenant user input, so notes and tags belong in the tenant-scoped
tables. Only the cost and sequencing depend on the measurement.

**## Consequences**

- What gets better: durable research across devices, real error surfaces on
  write failure, a genuine reason to log in beyond Council history.
- What it costs: ~13 new routes, a new store class, a schema migration, a
  first-login import flow, and an anonymous path that must keep working —
  meaning the SPA carries two data sources for a while.
- What stays broken until an implementer picks this up: everything in Context.
  This ADR ships no behaviour.
- Follow-on decisions deliberately **not** made here: whether saved searches
  support scheduled re-execution; rate limits on the new write routes.
- **Private-versus-shared is decided here, not deferred** (Decision 2): all
  three resources are private to `(tenant_id, owner_id)`. Opening them up
  within a tenant needs its own ADR with an explicit visibility model, a role
  matrix, and parent-resource checks — it is not a predicate widening. Listing
  this as an open question while prescribing `tenant_id`-only queries, as an
  earlier draft did, would have shipped tenant-wide sharing by accident.

**Verify**:
```bash
test -f docs/adr/0050-user-data-server-side.md && \
grep -c "^## " docs/adr/0050-user-data-server-side.md
```
→ prints a number `>= 7` (Context, Decision 1–4, Consequences, plus any others)

And confirm every decision is present:
```bash
grep -c "^## Decision" docs/adr/0050-user-data-server-side.md
```
→ `4`

And confirm the false claim was not reproduced:
```bash
grep -in "buys the user nothing\|buys nothing" docs/adr/0050-user-data-server-side.md
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
 * first login — is decided in `docs/adr/0050-user-data-server-side.md`.
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
 * `docs/adr/0050-user-data-server-side.md`.
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
→ `FE_BEFORE` passed, unchanged

```bash
cd workers && npx vitest run 2>&1 | tail -5
```
→ `WK_BEFORE` passed, unchanged

```bash
make test-py 2>&1 | tail -3
```
→ `PY_BEFORE` passed, unchanged, with the failure set identical to
`PY_FAIL_BEFORE` (the pre-existing pyexpat/pypdf
environmental failures — see "Commands you will need")

```bash
.venv/bin/ruff check immi_case_downloader/ scripts/ *.py
```
→ `All checks passed!`

```bash
git status --porcelain --untracked-files=all
```
→ exactly: `M frontend/src/hooks/use-bookmarks.ts`,
`M frontend/src/lib/saved-searches.ts`,
`?? docs/adr/0050-user-data-server-side.md`, `?? plans/…` (this plan file), and
whatever was already dirty when you ran the drift check (at `42826a3` that was
` M .claude/STATE.md`, which is not yours — leave it). Nothing else.

`--untracked-files=all` matters here: the plain form collapses a new directory
to `?? docs/adr/`, which hides whether you also created `README.md` there.
`docs/adr/README.md` and `docs/adr/TEMPLATE.md` must not appear — if 044 landed
first they are tracked and unmodified, so they will not.

## Test plan

This plan adds no executable behaviour, so it adds **no new tests**. That is the
correct outcome, not a gap — a test asserting the content of a Markdown file
would lock prose in place and break on every legitimate edit to the ADR.

What must be proven instead is that nothing regressed:

- `cd frontend && npx vitest run` → `FE_BEFORE` passed, unchanged.
- `cd workers && npx vitest run` → `WK_BEFORE` passed, unchanged.
- `make test-py` → `PY_BEFORE` passed, unchanged, failure set identical to
  `PY_FAIL_BEFORE` (the failures
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

- [ ] `test -f docs/adr/0050-user-data-server-side.md` exits 0
- [ ] `git status --short -- docs/adr/README.md docs/adr/TEMPLATE.md` prints nothing (plan 044 owns both; you neither created nor edited them)
- [ ] `git status --porcelain --untracked-files=all -- docs/adr` lists **only** `docs/adr/0050-user-data-server-side.md`
- [ ] `grep -c "^## Decision" docs/adr/0050-user-data-server-side.md` prints `4`
- [ ] `grep -q "owner_id" docs/adr/0050-user-data-server-side.md` exits 0 and the Decision 2 constraint reads `tenant_id = ? AND owner_id = ?` — a `tenant_id`-only predicate is a silent choice of tenant-wide sharing
- [ ] `grep -q "transform_immi_snapshot.py:267" docs/adr/0050-user-data-server-side.md` exits 0 (the second, unflagged write path is recorded)
- [ ] Decision 4's cost claim matches the Step 1a counts — or says UNKNOWN and why. It must **not** assert the columns are empty on the strength of `IMMI_CASE_MUTATIONS_ENABLED` alone
- [ ] `grep -q "idempotency" docs/adr/0050-user-data-server-side.md` exits 0 (the import flow's mechanics are specified, not gestured at)
- [ ] `grep -q "0001_account.sql:56-87" docs/adr/0050-user-data-server-side.md` exits 0
- [ ] `grep -q "0001_catalog.sql:31-32" docs/adr/0050-user-data-server-side.md` exits 0
- [ ] `grep -q "PROPOSED, NOT APPLIED" docs/adr/0050-user-data-server-side.md` exits 0
- [ ] `grep -q "docs/adr/0050-user-data-server-side.md" frontend/src/hooks/use-bookmarks.ts` exits 0
- [ ] `grep -q "docs/adr/0050-user-data-server-side.md" frontend/src/lib/saved-searches.ts` exits 0
- [ ] `ls migrations/d1/account/` lists exactly `0001_account.sql` and `0002_platform_admin.sql`
      and nothing else. **Corrected 2026-08-28**: this plan's original text asserted
      `0001_account.sql` alone; `0002_platform_admin.sql` (plan 006's `users.platform_admin`
      grant column, SEC-01) landed on `main` before this plan executed. It is unrelated to
      user data — it does not touch `cases`, `collections`, `collection_items` or
      `saved_searches` — so it does not compete with this ADR's proposed schema and the
      Decision 1 "no second *unused* schema" argument stands. The check is updated to the
      real baseline, not dropped, so it still fails if a genuinely competing third migration
      shows up. See "Findings reconsidered" below for the full evidence.
- [ ] `git diff --numstat -- frontend/src/hooks/use-bookmarks.ts frontend/src/lib/saved-searches.ts`
      shows `0` in the deletions column for both files
- [ ] `cd frontend && npx tsc -b --noEmit` exits 0
- [ ] `cd frontend && npx eslint src/hooks/use-bookmarks.ts src/lib/saved-searches.ts` exits 0 with `0 errors, 1 warning`
- [ ] `cd frontend && npx vitest run` reports `FE_BEFORE` passed, unchanged
- [ ] `cd workers && npx vitest run` reports `WK_BEFORE` passed, unchanged
- [ ] `make test-py` reports `PY_BEFORE` passed and `make test-py 2>&1 | grep -E "^(FAILED|ERROR)" | sort` is identical to `PY_FAIL_BEFORE` (still exactly the three `pypdf` ImportErrors in `tests/test_backfill_judge_overrides_from_pdf.py`, by name)
- [ ] `.venv/bin/ruff check immi_case_downloader/ scripts/ *.py` prints `All checks passed!`
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

  **This condition fired and was resolved 2026-08-28** — recording the
  resolution here so a future re-run of this plan does not re-trigger it
  blind. `0002_platform_admin.sql` landed on `main` (plan 006, SEC-01): a
  `users.platform_admin` grant column and index, unrelated to bookmarks,
  collections or saved searches — it does not touch `cases`, `collections`,
  `collection_items` or `saved_searches`. It is **used**
  (`workers/case-api/cloudflare_mutations.js` gates shared-catalog writes on
  it via `assertPlatformOperator`), so it is not a second *unused* schema —
  the specific thing Decision 1 argues against. The argument stands; only the
  premise "there is exactly one migration in `migrations/d1/account/`" was
  false and is corrected in the Done criteria and "Findings reconsidered"
  below. Do not treat this note as blanket permission to wave off a future
  `0003_*.sql` or later — re-verify each time this fires, the way this
  resolution did, rather than assuming the same answer applies.
- `wrangler.toml` no longer reads `IMMI_CASE_MUTATIONS_ENABLED = "false"`. If
  writes were enabled, `cases.user_notes` may hold real cross-tenant data and
  Decision 4 needs a data-migration section this plan does not contain.
- The Step 1a inventory reports a non-zero `with_notes` or `with_tags` **and**
  the sampled content reads as user-authored. That is existing, already
  un-attributable user data on a shared row — a materially different problem
  from the one this plan scoped, and it needs a migration/retention decision
  before Decision 4 can claim any cost at all. Report the counts and stop.
- You are tempted to run the Step 1a queries yourself against production, or to
  turn any of them into an `UPDATE`. They are the operator's to run and they
  are read-only. This plan changes no data.
- A `bookmarks` table has appeared in any migration under `migrations/`.
- You conclude the schema delta must be written as a real `.sql` file now. That
  contradicts the explicit Out-of-scope entry — report the reasoning, do not
  write the file.
- The eslint warning count on the two frontend files becomes anything other than
  `0 errors, 1 warning`, or the deletions column of
  `git diff --numstat` on either file is non-zero. Either means you changed code,
  not just comments.
- Any test count moves off `FE_BEFORE` / `WK_BEFORE` / `PY_BEFORE`, or the
  Python failure set differs from `PY_FAIL_BEFORE`. This plan writes only
  Markdown and comments; any movement means you changed code.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

For the human or agent who owns this next:

- **`docs/adr/README.md` is owned by plan 044; add the index row there when 044
  lands.** The row is
  `| [0050](0050-user-data-server-side.md) | Where bookmarks, collections and saved searches live | Proposed |`.
  This plan writes no index and no template.
- **What a reviewer should scrutinise**: that the ADR's gap table matches the SQL
  and the TypeScript types as they actually are — that table is the whole value
  of this plan, and it is the part that silently rots. Re-run
  `grep -rn "collection_items\|saved_searches" workers/` before approving; if it
  now returns hits, the ADR is describing a world that no longer exists.
  Also check two things a reviewer would otherwise wave through: that every
  read predicate in Decision 2 is `tenant_id AND owner_id` (a `tenant_id`-only
  predicate silently makes one member's research visible to every other member
  of the tenant), and that Decision 4's cost claim cites the Step 1a counts
  rather than inferring emptiness from `IMMI_CASE_MUTATIONS_ENABLED`.
- **The Step 1a inventory is the thing most likely to be skipped.** It needs
  production D1 access the executor does not have, so the path of least
  resistance is to assume zero and write a confident ADR. If the counts are
  UNKNOWN, the ADR must say UNKNOWN — an implementer who later discovers
  existing content in `cases.user_notes` will have built on a false premise,
  and `CLAUDE.md`'s production-cleanup rule (backup column, `LIMIT 100`
  eyeballed dry run) exists precisely because that has already happened once in
  this repo (see `docs/JUDGE_DATA_QUALITY.md`).
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
- **"`migrations/d1/account/` contains exactly one migration, `0001_account.sql`"**
  — true when this plan was drafted at `42826a3`, **false by the time it
  executed**. Plan 006 (`harden-auth-and-authorization-006`, closing SEC-01)
  landed `migrations/d1/account/0002_platform_admin.sql` on `main` in the
  interim: `ALTER TABLE users ADD COLUMN platform_admin INTEGER NOT NULL
  DEFAULT 0;` plus an index, gating global pipeline controls, the platform
  admin read, and (per a further change in the same security pass)
  shared-catalog case writes — `workers/case-api/cloudflare_mutations.js`'s
  `requireWriter` now calls `stores.identityStore.assertPlatformOperator(...)`
  (defined at `workers/storage/identity.js:98-119`) instead of
  `assertMembership`, specifically because "the `cases` table has no tenant
  column... tenant membership is not sufficient authorization."

  This fired the STOP condition literally as written ("`migrations/d1/account/`
  already contains a `0002_*.sql`") when the executor ran the drift check.
  **The correction, not just the fact**: `0002_platform_admin.sql` is used, not
  unused, and touches `users`, not `cases`/`collections`/`collection_items`/
  `saved_searches` — so it is not a second *unused bookmarks-schema*, which is
  the specific thing Decision 1 argues against. Decision 1's conclusion
  (propose the schema delta, do not apply it, do not add a second unused
  schema) stands unchanged. What changed is bookkeeping: the eventual
  implementation migration is `0003_*.sql`, not `0002_*.sql`, and the Done
  criterion checking `migrations/d1/account/`'s contents is updated above to
  the real baseline rather than dropped, so it still catches a genuinely
  competing third migration. The ADR's Decision 1 and its "Verification notes"
  section both carry this correction, sourced independently from the same
  evidence rather than copied from this note.

  The general lesson for whoever runs a sibling plan next: a STOP condition
  firing is not itself proof the plan's premise must be rewritten from
  scratch — read what actually landed before concluding the argument is
  broken. It was right to stop and ask rather than assume either "it's surely
  fine" or "the whole decision is now void"; both would have been guesses.
