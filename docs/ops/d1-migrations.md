# Runbook — applying D1 schema migrations

Production's data layer is Cloudflare D1. Schema changes live in
`migrations/d1/` and reach the three databases only when an **operator** runs
`wrangler d1 migrations apply`. Nothing applies them automatically: `make`,
CI and `.github/workflows/deploy-worker.yml` all deploy code without touching
schema.

## Do not use `make migrate`

`Makefile:107-108` defines:

```make
migrate:
	supabase db push
```

That targets the **retired** Supabase project, which is one-time ETL/import
tooling and is not in the production request path (`docs/ARCHITECTURE.md`,
`README.md` §7). It has no effect on D1. It is not the command below.

**This warning is the weakest part of this runbook, and it should not stay
that way.** `migrate` is the generic name anyone reaches for, and a paragraph in
a docs file does not stop a command from running. The target should be renamed
`migrate-supabase-legacy`, with `migrate` either deleted or made to fail closed:

```make
migrate:
	@echo "make migrate is retired. Production schema lives in migrations/d1/;"
	@echo "see docs/ops/d1-migrations.md. For the legacy Supabase ETL project:"
	@echo "  make migrate-supabase-legacy"
	@exit 1
```

`Makefile` is outside this plan's file territory, so this is recorded as a
required follow-up for whichever plan owns it (001/002) rather than done here.

## The three databases

| Binding | `database_name` | `migrations_dir` | Contents |
|---|---|---|---|
| `IMMI_CATALOG_DB` | `immi-catalog` | `migrations/d1/catalog` | Cases, chunks, FTS5 index, aggregates |
| `IMMI_ACCOUNT_DB` | `immi-account` | `migrations/d1/account` | Users, tenants, memberships, refresh sessions |
| `IMMI_OPS_DB` | `immi-ops` | `migrations/d1/ops` | Pipeline runs, extraction audit, reconciliation |

Declared at `wrangler.toml` lines 20-35. D1 has no cross-database foreign keys,
so there is no *referential* ordering constraint between the three. There is a
**code/schema compatibility** ordering constraint, and it is the one that
actually bites:

- **Expand before code.** Apply purely additive migrations (new tables, new
  nullable columns, new indexes) to all three databases **before** deploying the
  Worker that uses them. The old Worker ignores what it does not know about.
- **Deploy code.**
- **Contract after code.** Only once the new Worker is live and healthy do you
  apply anything destructive (dropping a column, tightening a constraint,
  renaming). A contract migration applied before the deploy takes production
  down.

If a single change needs both, split it into two migrations either side of the
deploy. Within one phase the three databases can go in any order.

## Before you touch a remote database

1. **Parse-check the SQL offline.** This needs no credentials and catches a
   syntax error before it reaches production:

   ```bash
   cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python -c "
   import pathlib, sqlite3
   root = pathlib.Path('migrations/d1')
   for db_dir in sorted(p for p in root.iterdir() if p.is_dir()):
       conn = sqlite3.connect(':memory:')
       for sql in sorted(db_dir.glob('*.sql')):
           conn.executescript(sql.read_text())
       print(db_dir.name, 'ok')
   "
   ```

   Expected: `account ok`, `catalog ok`, `ops ok`. SQLite is not D1, so this
   proves the statements parse and compose — not that D1 accepts every feature.

2. **Take a verified export, and know how to restore it.** An export you have
   never restored is not a backup.

   ```bash
   npx wrangler d1 export IMMI_CATALOG_DB --remote \
     --output "$HOME/immi-backups/catalog-$(date -u +%Y%m%dT%H%M%SZ).sql" \
     --config /path/to/immi-native-main.toml
   # Prove it restores, into a scratch LOCAL database — never back into production:
   npx wrangler d1 execute immi-catalog-scratch --local \
     --file "$HOME/immi-backups/catalog-<stamp>.sql"
   ```

   Then compare row counts for the tables you are about to touch, between the
   scratch restore and production. Repeat for each database you will change.
   Confirm the exact flags against your Wrangler version first
   (`npx wrangler d1 --help`, `npx wrangler d1 export --help`) — this repo pins
   nothing, and the CLI surface moves.

3. **Write down the rollback plan and its cost, before you start.** Answer these
   three in your run notes:
   - Which mechanism? (forward fix, or whole-database point-in-time restore —
     see "Rollback" below.)
   - What is the RTO? Time the scratch restore in step 2 and use that number.
   - What data loss is acceptable? A point-in-time restore of
     `IMMI_CATALOG_DB` discards every case the weekly VPS crawler
     (`0 14 * * 1` UTC) has ingested since the restore point. If that is not
     acceptable, a point-in-time restore is not your rollback and you need a
     forward fix.

4. **Rehearse on a clone.** Restore the step-2 export into a scratch database,
   run the migration there, and run the post-apply checks below against it.
   `--local` is the cheapest form of this and needs no real resource IDs.

5. **Get a config with real resource IDs.** The checked-in `wrangler.toml`
   carries placeholder `database_id`s (`00000000-0000-0000-0000-00000000000N`)
   **by design** — `scripts/check_cloudflare_native_target.py` enforces that
   shape, and `docs/ARCHITECTURE.md` explains why. Real IDs live only in the
   operator-held config that `.github/workflows/deploy-worker.yml` base64-decodes
   from the `IMMI_NATIVE_MAIN_WRANGLER_TOML_B64` secret into
   `$RUNNER_TEMP/immi-native-main.toml`. Locally, materialise the same file
   outside the repo (never commit it) and pass it with `--config`.

## Apply

Dry run first — `list` shows only *unapplied* migrations and writes nothing:

```bash
npx wrangler d1 migrations list IMMI_CATALOG_DB --remote --config /path/to/immi-native-main.toml
npx wrangler d1 migrations list IMMI_ACCOUNT_DB --remote --config /path/to/immi-native-main.toml
npx wrangler d1 migrations list IMMI_OPS_DB     --remote --config /path/to/immi-native-main.toml
```

Then apply, one database at a time, checking the output of each before moving on:

```bash
npx wrangler d1 migrations apply IMMI_CATALOG_DB --remote --config /path/to/immi-native-main.toml
npx wrangler d1 migrations apply IMMI_ACCOUNT_DB --remote --config /path/to/immi-native-main.toml
npx wrangler d1 migrations apply IMMI_OPS_DB     --remote --config /path/to/immi-native-main.toml
```

Local D1 (for `wrangler dev`) is the same command with `--local` instead of
`--remote`; it needs no real IDs and is the right place to rehearse.

Verified against `wrangler 4.120.0`. `wrangler d1 migrations` exposes exactly
`create`, `list` and `apply`; `apply` accepts `--local`, `--remote`,
`--preview`, `--persist-to` and the global `--config`. In a non-interactive
shell the confirmation prompt is skipped. Re-check with
`npx wrangler d1 migrations apply --help` for your version rather than trusting
this paragraph.

## After you apply

Three checks, in this order. Do not skip to the deploy on a green `apply` alone
— `apply` reports that it ran the file, not that the result is what the file
describes.

1. **Schema contract.** Re-run the `sqlite_master` +
   `PRAGMA table_info/index_list/foreign_key_list` comparison from "Before you
   touch a remote database" against production and against a scratch database
   built from the migrations. They must now agree. This is the check that
   catches a `CREATE TABLE IF NOT EXISTS` no-op.
2. **Health.** `curl -fsS https://<target>/health` and one real read
   (`curl -fsS https://<target>/api/v1/stats`). A migration that broke a query
   surfaces here, not in the migration output.
3. **Data reconciliation.** Row counts for the tables you touched, compared
   against the numbers you recorded before the apply, with the expected delta
   stated in advance. `SELECT COUNT(*)` per table via
   `wrangler d1 execute --remote --command`. An unexplained change is a rollback
   trigger, not something to investigate afterwards.

Record all three in `.claude/STATE.md` with the run's timestamp.

## Re-applying `0001_*`: idempotent, but NOT the same as "safe"

Wrangler tracks applied migrations in a `d1_migrations` table it creates inside
each database. The production databases were populated by a one-time import, not
by `wrangler d1 migrations apply`, so that bookkeeping table may be empty and
the first `apply` may offer to run `0001_*.sql` again.

Those files are **idempotent**: every `CREATE` in all four uses
`IF NOT EXISTS`, and none executes an `INSERT` at the top level. But idempotent
is a weaker guarantee than safe, and the difference is the trap:

> `CREATE TABLE IF NOT EXISTS` against a table that already exists **with a
> different shape** is a silent no-op. It does not add a missing column, does
> not add a missing constraint, and does not error. Wrangler then records the
> migration as applied. You end up with a database that reports "migrated" while
> its schema does not match the file — and the next migration, written against
> the file, breaks in production.

That is exactly the situation here, because production was populated by import
rather than by `apply`. **So: compare the live schema against the file before
the first `apply`, per database.**

```bash
CFG=/path/to/immi-native-main.toml
# What is actually there:
npx wrangler d1 execute IMMI_CATALOG_DB --remote --config "$CFG" \
  --command "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name;"
# Per table, the columns / indexes / FKs that CREATE ... IF NOT EXISTS will NOT fix:
npx wrangler d1 execute IMMI_CATALOG_DB --remote --config "$CFG" \
  --command "PRAGMA table_info('immigration_cases');"
npx wrangler d1 execute IMMI_CATALOG_DB --remote --config "$CFG" \
  --command "PRAGMA index_list('immigration_cases');"
npx wrangler d1 execute IMMI_CATALOG_DB --remote --config "$CFG" \
  --command "PRAGMA foreign_key_list('immigration_cases');"
```

Build the same three views from the checked-in migration by applying it to a
scratch local database and running the identical PRAGMAs, then diff. If they
differ, **stop**: either write an explicit migration that reconciles the
difference, or baseline the tracking table deliberately (mark `0001_*` applied
without running it) — and record which you chose and why. Do not let a silent
no-op decide it for you.

## Deciding whether a NEW migration is re-runnable

Do not use `grep -c '^INSERT'`. It is anchored to the line start, so it misses
an indented `INSERT` — and `migrations/d1/catalog/0001_catalog.sql` contains
**five** `INSERT` statements (lines 71, 75, 77, 81 and inside the FTS5 sync
triggers) that this check reports as zero. Those particular ones are harmless,
because they are trigger *bodies* rather than statements executed at migration
time — but a check that cannot tell the difference is not a check.

Split into statements and look at the first keyword of each:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-" && .venv/bin/python - <<'PY'
import pathlib, re, sqlite3

def statements(sql: str):
    """Yield top-level statements, respecting BEGIN...END trigger bodies."""
    buf = ""
    for line in sql.splitlines(keepends=True):
        buf += line
        if sqlite3.complete_statement(buf):
            yield buf.strip()
            buf = ""
    if buf.strip():
        yield buf.strip()

DESTRUCTIVE = ("INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "REPLACE")
for path in sorted(pathlib.Path("migrations/d1").glob("*/*.sql")):
    text = path.read_text()
    flagged, creates, guarded = [], 0, 0
    for stmt in statements(text):
        s = re.sub(r"^\s*(--[^\n]*\n\s*)*", "", stmt)
        if not s.strip():
            continue
        head = s.split(None, 1)[0].upper()
        if head == "CREATE":
            creates += 1
            if "IF NOT EXISTS" in stmt.upper().split("BEGIN")[0]:
                guarded += 1
        elif head in DESTRUCTIVE:
            flagged.append(head + " " + " ".join(stmt.split()[:6]))
    status = "re-runnable" if (creates == guarded and not flagged) else "NOT re-runnable"
    print(f"{path}: CREATE={creates} guarded={guarded} top-level-destructive={len(flagged)} -> {status}")
    for f in flagged:
        print(f"    {f}")
PY
```

Expected today: all four files print `re-runnable` with
`top-level-destructive=0` — the trigger-body `INSERT`s are correctly not
flagged, because `sqlite3.complete_statement` keeps `BEGIN … END;` together. A
file that prints `NOT re-runnable` must be applied exactly once, and must say so
in a comment at the top of the file.

## Writing a new migration

- Name it `NNNN_slug.sql` in the right `migrations/d1/<db>/` directory, using the
  next free number for that database. Wrangler orders by that prefix.
- Prefer additive, idempotent statements (`CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`). D1 inherits SQLite's limited `ALTER TABLE`.
- Keep row payloads well under D1's limits — `migrations/d1/catalog/0001_catalog.sql:1-3`
  notes that text chunks are capped at 128 KiB so each row stays below the
  256 KiB migration guard.
- Re-run the parse check above before committing.

## Rollback

**D1 has no down-migrations.** There are exactly two options:

1. **Forward fix** — write `NNNN+1` that undoes the change. Preferred for
   `IMMI_CATALOG_DB`, which receives continuous case writes from the VPS
   crawler.
2. **Point-in-time restore** — restores the **whole database**, discarding every
   write after the chosen point. Get the exact invocation for your Wrangler
   version rather than copying it from here:

   ```bash
   npx wrangler d1 time-travel --help
   npx wrangler d1 time-travel info <DB> --config /path/to/immi-native-main.toml
   npx wrangler d1 time-travel restore <DB> --bookmark <BOOKMARK> --config /path/to/immi-native-main.toml
   ```

   Before you ever need it: run `time-travel info` and **write the bookmark
   down** as part of the pre-apply checklist — a restore you cannot address is
   not a rollback. Rehearse the restore against a scratch database at least once
   so the RTO number in your run notes is measured rather than assumed.

   **Cost, stated plainly.** On `IMMI_CATALOG_DB` a restore discards every case
   the weekly VPS crawler has ingested since the bookmark (`0 14 * * 1` UTC, so
   up to a week's ingestion). On `IMMI_ACCOUNT_DB` it discards user sign-ups,
   tenant changes and refresh sessions — users get logged out and recent
   accounts vanish. If that loss is unacceptable for the change you are making,
   option 2 is **not** available to you and option 1 (forward fix) is your only
   rollback; decide that before applying, not after.

3. **Restoring from the export you took in step 2 of the pre-apply checklist**
   is a third option, and the only one that lets you rebuild selectively. It is
   also the slowest. Its RTO is whatever you measured when you verified the
   export.

## What is deliberately not automated

There is no `make` target and no CI step that applies D1 migrations, and no
gate that parse-checks `migrations/d1/**`. That is a known gap, not an
oversight in this runbook: adding either changes deploy behaviour and needs
operator sign-off. Until then, the operator runs the commands above by hand and
records the run in `.claude/STATE.md`.
