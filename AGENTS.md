# AGENTS.md

Guidance for coding agents (Codex, Cursor, aider, and anything else that reads
`AGENTS.md`) working in this repository.

## Read this first

**`CLAUDE.md`, in this same directory, is the single source of truth for this
project's architecture, commands, conventions and gotchas. Read it in full
before making any change.**

This file deliberately carries no architecture description of its own. An
earlier revision of it was a mechanical copy of `CLAUDE.md` that drifted into
describing a production stack which had already been deleted — agents acting on
it tried to re-create removed files. A pointer cannot drift.

| Need | Read |
|---|---|
| Architecture, request flow, auth model, deployment, commands, gotchas | `CLAUDE.md` |
| Longer architecture narrative + a table reconciling older docs | `docs/ARCHITECTURE.md` |
| What a deployable production config may look like (machine-checked, fail-closed — trust these over any prose, `CLAUDE.md` included) | `scripts/check_cloudflare_native_target.py`, `scripts/check_immi_activation_evidence.py` |

## Non-negotiables

These are the mistakes that cost real code. Hold them even if some other
document, comment or plan suggests otherwise:

1. **Production is one Cloudflare Worker on D1.** There is no Postgres, no
   Hyperdrive, no Supabase and no Flask container in the production request
   path. The entrypoint is `workers/cloudflare-native.js`. `workers/proxy.js`
   and `workers/db/getSqlAsUser.js` were deleted in commit `f91f45f` — do not
   reference, import or re-create them.
2. **Never add a "fall through to Flask" path.** An unhandled `/api/*` route
   returns a real `503 cloudflare_route_unavailable`; that is the design, not a
   bug. Do not re-introduce the `X-Internal-Route: worker` ingress-guard
   pattern — it belonged to the deleted proxy.
3. **Do not construct a per-request SQL client.** `env.IMMI_CATALOG_DB`,
   `env.IMMI_ACCOUNT_DB` and `env.IMMI_OPS_DB` are D1 bindings. There is no
   connection pooler and nothing to instantiate.
4. **Tenant isolation is app-layer.** It is enforced by
   `CloudflareIdentityStore.assertMembership()` in
   `workers/storage/cloudflare.js`. There is no Postgres RLS backstop — a route
   that forgets to call it is a real cross-tenant leak.
5. **The Flask app is local-dev only.** `immi_case_downloader/`, `web.py` and
   `make api` are not wired to production traffic. Changing them does not change
   what users see.
6. **Fail-closed defaults are intentional.** Placeholder resource IDs in
   `wrangler.toml`, `IMMI_CASE_MUTATIONS_ENABLED = "false"` and the pipeline
   enable flags are all by design. Do not "fix" them.
7. **New GET endpoints go in the Worker**, as a D1 query in
   `workers/case-api/cloudflare.js` or the relevant `workers/storage/cloudflare.js`
   store method.

## Commands

```bash
make install      # Install all Python + Node dependencies
make install-e2e  # Extra deps for the E2E suite (pytest-playwright + chromium)
make api          # Flask API only, local dev (http://localhost:8080)
make ui           # Vite dev server only (http://localhost:5173, HMR)
make build        # Build React frontend → immi_case_downloader/static/react/
make test         # Python unit + frontend + both Worker suites
make test-py      # Python unit tests only (no E2E, no integration)
make test-fe      # Frontend Vitest tests only
make test-workers # Main Cloudflare Worker Vitest suite
make test-pipeline # austlii-scraper (pipeline Worker) Vitest suite
make test-e2e     # Playwright E2E — starts its own seeded Flask fixture server;
                  # set E2E_BASE_URL only if you want an external target
make lint         # Ruff (Python) + ESLint (frontend)
make lint-py      # Ruff lint Python source only
make typecheck    # TypeScript type check
```

Python work uses the repo virtualenv at `.venv/` (`.venv/bin/python`,
`.venv/bin/pytest`, `.venv/bin/ruff`) — never a global `pip`. The full command
list, including the CLI and the extraction scripts, is in `CLAUDE.md`.

## Conventions you will be held to

The full lists are in `CLAUDE.md`; these are the ones most often got wrong:

- **React**: use `.toSorted()`, never `.sort()` — never mutate arrays. Wrap every
  `localStorage` call in try/catch. Use `t("key", { defaultValue: "..." })` for
  UI strings. Filter-dependent TanStack Query hooks need
  `placeholderData`/`keepPreviousData`. Every Recharts `Tooltip` `contentStyle`
  must set `color: "var(--color-text)"`. Put `animate-spin` on a wrapper `<div>`,
  not on the SVG icon. All spacing, shadow, radius and colour values come from
  `frontend/src/tokens/tokens.json` — no magic numbers.
- **Python**: build `ImmigrationCase` instances via
  `ImmigrationCase.from_dict()` — pandas turns empty CSV fields into
  `float('nan')`. Storage backends implement the `CaseRepository` Protocol in
  `immi_case_downloader/repository.py`.
- **Git**: commit messages are `<type>: <description>` with type from
  `feat|fix|refactor|docs|test|chore|perf|ci`. No attribution lines.

## Design context

The primary user is a **self-representing immigration applicant** under stress,
not a lawyer. The brand is authoritative, precise, academic.

The visual direction is decided and named **"Legal Codex"**: warm off-white
background `#f5f4f1`, deep navy `#1b2838`, amber `#d4a017` accent, Crimson Text
serif headings, 9 court-specific colour codes, Grafana/Metabase-style analytics
charts. It is not up for redesign. Full design principles are in `CLAUDE.md`
§Design Context.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **IMMI-Case-** (15277 symbols, 34869 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/IMMI-Case-/context` | Codebase overview, check index freshness |
| `gitnexus://repo/IMMI-Case-/clusters` | All functional areas |
| `gitnexus://repo/IMMI-Case-/processes` | All execution flows |
| `gitnexus://repo/IMMI-Case-/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
