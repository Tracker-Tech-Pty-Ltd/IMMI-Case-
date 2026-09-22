Review one focused change. Review only — do not modify anything.

HARD RULES: do not load skills/plugins/MCP/graph tools, do not run builds or tests, do not write files, do not query any database or API. Read-only commands only (cat, sed -n, git show, git diff, grep). Answer directly, no narration.

Repo: /Volumes/Storm Breaker/Price-investigator/ai-crawl-jbhifi-centercom
Commit under review: ad1bd88 "perf(d1-sync): delta-only sync with stable group ids" (parent 56cf926) — `git show ad1bd88` is the whole delta.

WHY IT EXISTS
The nightly PG→D1 sync re-pushed all 602k `compare_products` rows every run, and the matcher regenerates group UUIDs each run, so every row's `group_id` changed daily. D1 billed ~1.14M INSERT OR REPLACE/day; with four secondary indexes on the table each row write cost ~6 billed rows (~$2-4/day). The commit adds a local signature-map delta, derives deterministic group ids, and (separately, outside the commit) the four unused indexes were dropped on the live database.

WHAT TO VERIFY (cite file:line, severity HIGH/MED/LOW, concrete fix per finding)
1. Delta correctness: can a row that changed in PG fail to be pushed? Check the signature fields against what the Worker actually serves (`cf-poc/src/entry.py` search query selects sku, retailer, title, brand, model, price, compare_at_price, url, group_id, match_key — note `model`, `product_type`, `compare_at_price` handling), rows whose retailer disappears, and the state file being saved only when everything succeeded.
2. Deterministic group ids (`stable_group_id`): collisions or silent merges (uuid5 over sorted member SKUs, groups with identical membership, groups with no items falling back to match_key), and whether `fetch_group_id_map` and `fetch_match_groups` can disagree for the same group.
3. `groups_drifted` logic: with a primed state and unchanged groups, no clear+rewrite happens — can that let stale group rows accumulate in D1 after a group is deleted or re-keyed in PG (the previous behaviour cleared every run)?
4. Failure modes: a partial ingest, a crash between pushing products and saving state, a lost/corrupt state file, and `--full` / `--retailer` / `--groups-only` interactions (e.g. does `--retailer 1` poison the state for other retailers?).
5. Cost claim: is "~$3/day -> ~$0.01/day" defensible from the code (rows pushed per run) given the 4 index drops, or is it overstated/understated?

ALREADY VERIFIED BY THE AUTHOR (do not re-derive): a primed state produces "0/601,346 products changed" on a dry run and again on a real run; D1 row counts unchanged (602,660 products / 4,089 groups); the Worker's `/api/compare?q=logitech` still returns results after the index drops; repo-wide grep shows the only `compare_products` queries are the two `title LIKE '%q%' OR sku LIKE '%q%'` searches, so the dropped indexes (retailer/group/title/brand) cannot serve them. The state file lives in gitignored `data/`.

NOT IN SCOPE: the surrounding crawler, the matcher's own UUID generation, style/naming/comments, or the live database's index state.

Output: findings HIGH → LOW with file:line, severity, issue, concrete fix; "no finding" per numbered area that is clean. Final line exactly: VERDICT: APPROVE or VERDICT: CHANGES-REQUIRED
