# IMMI native activation evidence

The deployment workflow accepts an activation packet only when every metric
can be attributed to the exact release being activated. The packet therefore
must contain this immutable identity before the snapshot, search, performance,
shadow, rollback and soak evidence is considered:

```json
{
  "release": {
    "git_sha": "40 lowercase-or-uppercase hexadecimal characters",
    "main_worker_version_id": "Cloudflare version ID",
    "pipeline_worker_version_id": "Cloudflare version ID",
    "config_digest": "sha256:<64 hexadecimal characters>",
    "legacy_runtime_disabled": true
  }
}
```

The packet must also contain `legacy_reference_scan` with
`scope: "deployed-runtime-config-ci"`, `ok: true`, and numeric zeroes for
`supabase`, `postgres`, `pgvector`, and `hyperdrive`. A source-only grep or a
clean local bundle is not enough; the scan must cover the effective deployed
runtime, operator config and CI path.

It must also contain `d1_resources` captured from the Cloudflare API plus the
creation record for each database. The three bindings must have real UUIDs,
`location_hint: "oc"`, and `read_replication.mode: "disabled"`; the packet
must include the Cloudflare account ID and an observation timestamp. A D1
location hint is only a creation-time preference, so the evidence deliberately
records both the creation input and the live API replication mode. The checker
rejects an activation packet that omits either proof.

The packet must also contain `object_resources` from the Cloudflare API:
`IMMI_CONTENT` must report versioning enabled and a lifecycle retention of at
least 90 days, while `CASE_VECTORS` must report the fixed model, 1024
dimensions, cosine metric, `ready: true`, and exactly four metadata indexes:
`court_code` (string), `year` (number), `source` (string), and
`visa_subclass` (string). These are live resource facts, not merely names
copied from Wrangler configuration.

The packet must also contain `catalog_capacity`: the transformed catalog must
be within the 8 GiB logical/physical budget, have no materialized row over
256 KiB, and report at least 20% remaining headroom. This is separate from
the D1 resource inventory because it measures the actual transformed data.

The `reconciliation` object must report zero for row IDs, source-manifest
mismatches, relation missing/extra sets and Vectorize missing/extra sets. The
checker accepts the empty lists emitted by `scripts/reconcile_immi_transform.py`
as well as numeric zeroes, but never treats an omitted category as zero.

When the deploy workflow supplies the two operator Wrangler configs, the
checker cross-compares every D1 ID, the shared R2 bucket and the Vectorize
index against the resource evidence. A matching digest alone is insufficient.

`git_sha` must be the immutable source commit used to build both Workers;
the two version IDs must be the exact deployed versions used for the evidence;
and `config_digest` must cover the operator-supplied native Wrangler configs.
The checker computes it as SHA-256 over, in order, the bytes of the literal
labels `main`, NUL, the main TOML bytes, NUL, `pipeline`, NUL, the pipeline TOML
bytes, NUL. A packet without this identity fails closed even
when all individual measurements are green. `legacy_runtime_disabled` is an
explicit assertion that the packet did not measure a legacy fallback path.

The schema is enforced by
`scripts/check_immi_activation_evidence.py` and covered by
`tests/test_immi_activation_evidence.py`.

The activation packet must additionally contain evidence for the operational
contracts that resource inventory alone cannot prove:

- `contract_fixtures`: an immutable SHA-256 manifest of every public route's
  success, validation-error, 401, 403, 404, 429 and 503 fixtures;
- `tenant_isolation`: a named attack matrix covering cross-tenant read, write,
  list, retrieve-code, Council, collection and refresh-session attempts, with
  every attempt denied and zero bypasses;
- `pipeline`: proof that the R2 -> Catalog D1 -> Vectorize -> Ops D1 order,
  outbox/event-id idempotency, DLQ consumers and container credential boundary
  were exercised;
- `object_reconciliation`: a checksum-addressed R2 manifest with zero
  missing, extra, orphan or checksum-mismatched objects;
- `cutover`: blue/green switch evidence, drained queues, final journal replay,
  single-backend authenticated writes and a final write freeze no longer than
  60 minutes.

Rollback evidence must explicitly identify both rehearsals (code rollback and
D1-to-legacy journal replay), verified legacy restoration and verified journal
replay. A timing number without those rehearsal assertions is not sufficient.

The native pipeline also requires the Ops D1 `outbox_events` table before a
discovery run can start. Extraction writes the checksum-addressed R2 payload,
stages its pointer in the outbox, publishes the pointer-only Queue event, and
marks the outbox row `published` only after Cloudflare accepts the message.
Retries reuse the immutable `event_id`; the main storage coordinator remains
idempotent. Every configured dead-letter queue has an explicit consumer that
stores the failed message under an `imports/dlq/` R2 key and records its
checksum in Ops D1 `dead_letter_events`, making `dlq_messages: 0` a
reconcilable soak assertion rather than a dashboard-only observation.
