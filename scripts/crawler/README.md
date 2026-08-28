# AustLII VPS crawler

This directory is the version-controlled home of the AustLII crawler that
ingests production cases. As of 2026-08-27 the source files (`crawler.py`,
`pipeline.sh`) still live only on the VPS — they have not yet been imported.
See "Importing the source" below.

## Operational contract

- **Host**: the SSH alias `hstgr` (a Hostinger VPS).
- **Path**: `/opt/austlii-crawler/` — holds `crawler.py`, `pipeline.sh` and a
  Python venv.
- **Service user**: runs as the unprivileged user `austlii-crawler` (UID 995).
- **Egress**: routed through a WireGuard tunnel (`wg1-home`) to the
  operator's residential IP. This exists because AustLII challenges or
  blocks datacentre egress at volume — a residential IP is the only egress
  path either ingestion pipeline in this repository has that AustLII does
  not challenge.
- **Schedule**: cron `0 14 * * 1` UTC (Tuesday 00:00 AEST); crawls the
  current year only, four courts: ARTA, FCA, FedCFamC2G, HCA.
- **Target endpoint**: `POST /api/v1/cases` on the production Worker.
- **Auth**: a shared secret named `CRAWLER_WRITE_TOKEN` (never write its
  value here or anywhere in this repository). The Worker upserts
  idempotently by `case_id`, so a redelivered or retried POST is safe.
- **Log**: `/var/log/austlii-crawl.log`, unbuffered, with a heartbeat every
  25 records.

## Patches applied 2026-08-24

Backups of the pre-patch files are `*.bak-20260824` in the same VPS
directory.

1. **120s cap on the challenge-page wait.** An unbounded `while` loop once
   hung for roughly 3 hours silently waiting on a challenge page.
2. **`python -u` in `pipeline.sh`.** Without it, stdout was fully buffered,
   so the log appeared dead even while the crawler was working.
3. **POST timeout 30s → 90s.** Large-payload (full judgement text) requests
   were failing at ~24%; the longer timeout brought that down to ~2%.
4. **`flock` in `pipeline.sh` against re-entry.** Prevents an overlapping
   cron invocation from running a second crawl concurrently with the first.

## Diagnostics

`pgrep -f` and `pkill -f` match the diagnosing SSH command line itself (the
command string used to connect and run the diagnostic contains the same
search text you are grepping for), so both routinely misidentify or kill the
wrong process. Use `ps -u austlii-crawler` to list the service user's
processes and kill by exact PID instead.

## Importing the source

Run `scripts/crawler/import_from_vps.sh`. It fetches the two files into a
quarantine directory outside this repository, scans them for anything that
looks like a literal embedded credential, and — only if that scan passes —
prints them for review and requires `IMMI_CRAWLER_IMPORT_YES=1` before
writing them into this directory.

After a successful import:

1. Review the diff (`git diff -- scripts/crawler/crawler.py scripts/crawler/pipeline.sh`).
2. Confirm no secrets are embedded in the fetched files.
3. Complete the "Recovery bundle" checklist below.
4. Commit with `chore: import the AustLII VPS crawler into version control`.

## Recovery bundle — what is still missing

Landing `crawler.py` and `pipeline.sh` does not make this a rebuildable
service. Two files are not an operational runbook. The checklist below is
what an operator still needs to gather, with the command that produces each
artefact; every unchecked item is an open risk that keeps the "single disk"
failure mode alive even after the import lands.

- [ ] **Dependency lock** — `ssh <host> '/opt/austlii-crawler/venv/bin/pip freeze'`
  → save as `scripts/crawler/requirements-crawler.txt`. Without this, a
  rebuild has to guess at library versions against a site that already
  blocks unusual clients — guessing wrong risks losing egress entirely.
- [ ] **Schedule definition** — the exact crontab line
  (`ssh <host> 'crontab -l -u austlii-crawler'`), recorded in this README,
  plus any systemd unit or timer if one exists.
- [ ] **Environment variable names** (names only, never values) — which
  variable carries `CRAWLER_WRITE_TOKEN`, which carries the target base URL,
  and where the process reads them from (a `0600` env file path, or the
  crontab itself).
- [ ] **Network/egress contract** — the WireGuard interface name (`wg1-home`)
  and which peer it dials, recorded as facts, not as reproducible
  configuration. **No keys, no endpoints, no addresses.** The WireGuard
  config itself is a credential and is deliberately NOT imported into this
  repository.
- [ ] **Health check** — today, "did last night's run work?" is answered by
  tailing `/var/log/austlii-crawl.log` for the 25-record heartbeat over SSH.
  What would be needed to answer that question without SSH access is not yet
  designed.
- [ ] **Alerting** — there is none. A silent failure is currently detected
  only by a human noticing missing cases. This is a named gap, not an
  oversight to quietly fix here.
- [ ] **Rollback** — the Worker upserts idempotently by `case_id`, so a
  re-run with corrected data is the forward fix for bad data from a prior
  run. `workers/austlii-scraper/scripts/rollback_run.ts` targets the
  **legacy Supabase stack** and is not a rollback mechanism for this path.

Mark each item checked only once the corresponding artefact actually exists
in this repository or is otherwise durably recorded — not once someone
believes it could be gathered.

## Security

`crawler.py` and `pipeline.sh` must read `CRAWLER_WRITE_TOKEN` from the
environment or from a `0600` file outside this repository — never from a
literal in the source. If the imported files are found to contain a
hard-coded token, do **not** commit them: rotate the token first, change the
source to read it from the environment, and only then commit.

`import_from_vps.sh` scans for this automatically and refuses to write a
file containing a likely credential into this directory (see "Importing the
source" above) — but a human review of the diff before committing is still
required, since the scan is a heuristic, not a guarantee.
