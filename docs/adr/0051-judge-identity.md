# ADR-0051: How judge identity is repaired

## Status

Proposed — 2026-08-28. Branched from `main` at commit `12f8e70` (this plan was
authored at `42826a3`; between authoring and execution, `plans/034` split
`workers/storage/cloudflare.js` into per-domain modules and `plans/003` landed
the lint cleanup this plan depends on — see Context for what that changed).

## Context

Measured live against `https://immi.trackit.today` on 2026-08-28:

- `GET /api/v1/analytics/judge-leaderboard?limit=10&sort_by=cases` returns
  `total_judges: 15254`. Row 1 is not a person: `'DATE'`, 2409 cases, 11%
  approval rate — rendered with courts, active years and a visa breakdown
  exactly like a real judge.
- The `judges` relation also contains whole sentence fragments from case
  catchwords, not just one bad row: `name_q=tribunal` matches 906 judges,
  `name_q=whether` matches 242, `name_q=minister` matches 132 (`name_q` is
  `.trim()`ed server-side at `workers/case-api/cloudflare.js:1003`, so probes
  must be single words with no surrounding spaces — a padded probe like
  `" the "` degrades to `"the"` and matches `"Catherine"`). A sample of the
  `tribunal` matches: `'THE TRIBUNAL'` (119 cases), `'the Tribunal.'` (36),
  `'REFUGEE REVIEW TRIBUNAL'` (36), `'OF THE REFUGEE REVIEW TRIBUNAL'` (28),
  `'of the Tribunal'` (18), `'REFUGEE REVIEW TRIBUNAL &'` (16).
- `immi_case_downloader/normalize_judge_names.py` (190 lines, now 23 tests)
  has never been imported by production code. A repo-wide grep for
  `normalize_judge_name`, `find_duplicate_judges` and `merge_judge_records`
  (excluding `node_modules/`, `.venv/`, `.git/`, `downloaded_cases/`) returns
  hits in exactly three places: the module itself, its test file, and prose
  inside `plans/*.md`.
- Production mints judge identity as
  `sha256("judge:" + label.toLocaleLowerCase("en-AU")).slice(0,32)` from the
  **raw** label. At the time this plan was authored (`42826a3`) this lived at
  `workers/storage/cloudflare.js:914` and `:1247`. **That file has since been
  split by `plans/034-split-the-god-modules.md`**: `workers/storage/cloudflare.js`
  is now a 66-line re-export barrel with zero judge references, and the
  derivation lives in `workers/storage/case.js` (`updateCaseFields`, currently
  line 650; `putImportedCase`, currently line 1080). The logic and the bug are
  unchanged — this ADR's Decision 4 and the code pointers added in
  `workers/storage/case.js` refer to the current location.
  `judges.canonical_name` is `NOT NULL UNIQUE` (`migrations/d1/catalog/0001_catalog.sql:87`)
  and is what the SPA shows. There is no `judge_canonical_id` column anywhere
  in that schema.
- The read path applies no filter beyond a case-count floor and a substring
  match on the raw name (`workers/case-api/cloudflare.js:1038`, formerly
  `:915-916`): nothing rejects garbage, nothing normalises.
- `docs/JUDGE_DATA_QUALITY.md:322-329` already flagged wiring the normaliser
  into "the Cloudflare Worker" as deferred work, but that paragraph is stale
  in two ways: it names `workers/proxy.js`, deleted in commit `f91f45f`, and
  it says "Persist `judge_canonical_id` via Supabase migration" — there is no
  Supabase in the production path; the judge tables live in D1
  (`migrations/d1/catalog/0001_catalog.sql`).
- **A repo-lore figure could not be reproduced.** "15,465 judges → ~3,000 real
  people" is not a measurement on record anywhere in this repo. The live count
  is 15,254 (close enough to be the same corpus at a different point in time).
  Grouping the top 200 live judges by `normalize_judge_name` yields 16 surname
  collision groups covering 32 rows, not thousands — see Decision 2. Whatever
  inflates the judge count, it is not principally spelling fragmentation, so
  this ADR does not chase a multi-times consolidation target.

## Decision

1. **Garbage removal comes first, and it is an extraction fix, not a merge.**
   The dominant defect is that non-names — `'DATE'`, `'THE TRIBUNAL'`, whole
   catchword sentences — are in the `judges` relation at all. Fixing name
   fragmentation while `'DATE'` still ranks #1 by case count changes no number
   a user actually complains about. Follow-up item 1 targets the upstream
   extraction that puts this text into the `judges` field in the first place.

2. **No fuzzy tier. No similarity threshold.**
   `find_duplicate_judges`'s `fuzz.ratio` threshold is not tuned in this ADR,
   it is rejected outright. Evidence, reproduced independently against the
   live top-200 leaderboard on 2026-08-28: grouping by `normalize_judge_name`
   produces exactly **16 surname collision groups**, and **6 of them are
   demonstrably different people**, not spelling variants:
   `Gabrielle Cullen` / `Bridget Cullen`, `Lindsay Ford` / `Norma Ford`,
   `Robin Hunt` / `Sally Hunt`, `Kate Millar` / `Paul Millar`,
   `Alison Murphy` / `Jade Murphy`, `Carolyn Wilson` / `Robert Wilson`. That
   is a ~38% false-merge rate (6/16) among the groups the normaliser itself
   creates. Surname equality is not identity; no confidence threshold on top
   of surname-only matching fixes that, because the signal being thresholded
   is the wrong signal.

3. **`immi_case_downloader/data/judge_name_overrides.json` is the best
   available seed, but it is NOT a merge authority as it stands.** It holds
   **490** human-reviewed `alias → full name` entries (verified: `overrides`
   key, 490 entries) built from judge bios (103, `judge_bios.json`) plus
   official FCFCOA and Federal Court listings, and **115 of the top 200** live
   leaderboard names hit it on an exact lowercase key (verified independently
   against the live top-200 leaderboard on 2026-08-28). `judge_bios` is one of
   its inputs, not a competing source.

   **The defect that blocks using it directly, measured:** **180 of its 490
   keys are bare surnames**, and each maps to exactly one person —
   `"brown" → "Judge Stewart Brown"`, `"wilson" → "Justice Joshua Wilson"`
   (verified). But Decision 2's own evidence lists `Carolyn Wilson` /
   `Robert Wilson` as *different people* in the live top 200. Feeding the bare
   label `"Wilson"` through this map therefore asserts it is Joshua Wilson —
   a false merge produced by the very file that was supposed to prevent them.
   Rejecting the fuzzy tier in Decision 2 and then trusting a lookup table
   with the same surname-collision defect built in would be inconsistent.

   **What the seed must become before it can drive a merge**, and each item
   below is a follow-up, not something this ADR or this plan does:
   - **A stable person identifier.** Merges must target a person id, not a
     display string. `judges.canonical_name` is `NOT NULL UNIQUE`, so a
     display name cannot serve as the key for two different people who share
     one.
   - **Alias provenance per entry.** Where did this alias→person mapping come
     from — a bio, an official court listing, a human decision — and when. An
     entry sourced from an official listing of a currently-sitting judge does
     not license merging a two-decade-old tribunal record with the same
     surname into it.
   - **An explicit `ambiguous` / `no-merge` state.** A bare-surname key with
     more than one plausible person must be *recorded as ambiguous*, not
     silently resolved to whichever full name happened to be added to the
     file first. All 180 bare-surname keys are ambiguous until reviewed one
     at a time.
   - **The rule**: never auto-merge on a single surname without unique
     evidence — a matching first name or initial, a court and date range that
     only one candidate could plausibly have sat in, or an explicit human
     decision recorded with provenance. Where the evidence is not unique, the
     correct outcome is two separate people, not a guess.

   Growing and qualifying that file is a human review task; the Python
   normaliser's job is reduced to generating *candidates* for that review, not
   deciding merges.

4. **Persist, never overwrite.** A future migration adds a nullable
   `judges.judge_canonical_id` (and a `judge_canonical` table holding the
   display name). `judges.canonical_name` keeps the source string forever.
   Rollback is then "stop reading the new column", which costs nothing — as
   opposed to a destructive `UPDATE`, which `CLAUDE.md`'s production-cleanup
   rule requires a `<col>_backup` column and a hand-eyeballed `LIMIT 100` dry
   run for, because pattern-shape garbage rules have a measured ~10–15%
   false-positive rate on legitimate names in this exact corpus
   (`Michael Cooke (NSW)`, `general member cosgrave` —
   `docs/JUDGE_DATA_QUALITY.md`).

## Where normalisation runs

The alias mapping is **precomputed offline in Python and shipped to the
Worker as a static, human-reviewed lookup table.** `fuzzywuzzy` (or any fuzzy
matcher) is never ported into the Worker: the merge decision is reviewed by a
human once per candidate and then frozen, so the request path only ever needs
a dictionary lookup keyed on a stable person id. This also keeps
`normalize_judge_names.py`'s surname-folding limitation (Decision 2) out of
the request path entirely, where it would be a live, silently-firing bug
instead of an offline candidate generator whose output a human checks before
it ships.

## Consequences

- The **displayed** judge count will drop when the follow-ups land (prose
  rows are filtered out of the read projection, per follow-up item 3) and a
  handful of judges' case counts will rise (verified variants merge, per
  follow-up item 5). Both are user-visible changes to numbers people may have
  screenshotted. Rows are *filtered*, not deleted — the underlying `judges`
  and `case_judges` rows stay in place, per follow-up items 2–4.
- Someone has to review alias candidates by hand, one bare-surname key at a
  time. That is the direct cost of Decision 2 (rejecting the fuzzy tier) and
  Decision 3 (rejecting the override file as-is), and it is deliberate — the
  alternative is the ~38% false-merge rate measured above.
- Until the follow-up plans land, the leaderboard stays wrong. This ADR buys
  correctness of *approach*, not of data. `'DATE'` still ranks #1 the day this
  ADR merges.
- `normalize_judge_name` is now correct on bracketed qualifiers
  (`'Michael Cooke (NSW)'` → `'cooke'`, was `'nsw'`) but is still not a
  garbage filter (`'DATE'` → `'date'`) and still folds distinct people who
  share a surname. Both remaining limitations are pinned by tests
  (`test_garbage_labels_are_not_rejected`,
  `test_distinct_people_sharing_a_surname_collide`) so a future change cannot
  silently "fix" them by merging without going through this decision.

## Options rejected

- **Wire `normalize_judge_name` into the Worker read path as-is** — creates
  false merges on live data (Decision 2's evidence: a ~38% false-merge rate
  among the collision groups it creates). The read path is also the worst
  place to discover that, since there is no rollback for a wrong aggregate
  once a user has seen and possibly acted on it.
- **Bulk `UPDATE` on the `judges` table to rewrite `canonical_name` directly**
  — destroys the source string (the only evidence of what the extractor
  produced), and `canonical_name` is `NOT NULL UNIQUE`, so a collision
  produced mid-batch by two labels normalising to the same value fails the
  update with no clean resume point.
- **Reuse the Flask `_is_real_judge_name` filter**
  (`immi_case_downloader/web/routes/api.py:207-213`) — it is local-dev only
  and not in the production request path at all. Measured at `42826a3`, it
  also returns `True` for `'DATE'`, the single worst row in production
  (`_NAME_DISQUALIFIERS` has no `"date"` entry). It correctly rejects `'of'`,
  `'the'` and `'of the'`, so it is a useful *input signal* to a future garbage
  classifier, not a filter that is itself production-ready.

## Follow-up work, in order

Every item below is explicitly **not** done by this ADR or by plan 051.
**None of them deletes a row.**

1. **Fix the upstream extraction** that puts catchword prose into the
   `judges` field — the root cause. Look at where `judges` is populated
   during download/extraction, not at the Worker; the Worker only stores what
   it is given.
2. **Classify, do not delete.** Add a nullable classification to `judges`
   (e.g. `judges.row_class` ∈ `person | prose_fragment | unclassified`, or a
   side table keyed on `judge_id`) and populate it. **Do not `DELETE` from
   `judges`, `case_judges` or `aggregate_judge`.** In order of weight: the raw
   label is the only evidence of what the extractor produced, so deleting it
   destroys the input needed to fix item 1; a `case_judges` row is the link
   between a case and its label, and a case that loses all its judge links
   looks identical to a case that never had any; and `CLAUDE.md`'s
   production-cleanup rule exists precisely because a pattern-shape garbage
   rule already false-positived on legitimate names in this repo
   (`Michael Cooke (NSW)`, `general member cosgrave` —
   `docs/JUDGE_DATA_QUALITY.md`) at a measured ~10–15% rate. A classification
   column is reversible in one `UPDATE`; a delete is not reversible at all.
3. **A filtered read projection, not a filtered table.** The leaderboard and
   judge profile endpoints read a view (or apply a `WHERE row_class =
   'person'` predicate) so users stop seeing `'DATE'` and `'THE TRIBUNAL'` —
   while the underlying rows stay exactly where they are. Rollback is "stop
   applying the predicate", which costs nothing.
4. **A ground-truth benchmark and a soak period before anything is removed.**
   Hand-label a stratified sample of at least 200 rows (high case-count rows,
   bare surnames, obvious prose) and measure the classifier's precision and
   recall against it; record both in a superseding ADR. Then run the filtered
   projection in production for a soak period — at least one full reporting
   cycle, so anyone who screenshotted a number has a chance to notice it
   moved. Only after the benchmark and the soak may anyone *propose* physical
   deletion, and that proposal needs its own ADR, a `<col>_backup` column, and
   a hand-eyeballed `LIMIT 100` dry run per `CLAUDE.md`'s production-cleanup
   rule.
5. **Migration** adding nullable `judges.judge_canonical_id` plus a
   `judge_canonical` table (no backfill in the same deploy), then offline
   candidate generation from `normalize_judge_name`, human review into
   `judge_name_overrides.json` **with the stable person id, per-alias
   provenance and ambiguity fields Decision 3 requires**, then ship the frozen
   map to the Worker as the static lookup table described in "Where
   normalisation runs".
