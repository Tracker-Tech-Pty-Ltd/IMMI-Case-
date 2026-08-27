# Architecture Decision Records

One file per decision that changed how production works and that someone might
otherwise try to undo. Numbered, append-only: never rewrite a decision, add a
new ADR that supersedes it and edit the old one's Status line to point forward.

`docs/ARCHITECTURE.md` describes what production *is* today. These ADRs record
*why*, and what was rejected.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-cloudflare-native-d1-stack.md) | Production runs a single Cloudflare Worker over D1/R2/Vectorize; Flask, Hyperdrive and Supabase Postgres are out of the request path | Accepted |
| [0002](0002-app-layer-tenant-isolation.md) | Tenant isolation is app-layer `assertMembership()`, not database RLS | Accepted |
| [0003](0003-council-lexical-retrieval.md) | LLM Council grounding uses D1 FTS5 lexical retrieval, not Vectorize | Accepted |

## Writing a new one

Copy `TEMPLATE.md` to `NNNN-kebab-slug.md` using the next free number, fill in
the three sections, and add a row above. Keep it under one page — link to the
commit for detail rather than restating the diff.

Numbers 0047–0052 are reserved for decisions currently in flight
(0047 AustLII ingestion architecture, 0048 Council case anchoring,
0049 legislation corpus publication, 0050 server-side user data,
0051 judge identity, 0052 Android client disposition). Each of those files is
written by its own change; whoever lands one adds its row to the table above.
Do not renumber around them.
