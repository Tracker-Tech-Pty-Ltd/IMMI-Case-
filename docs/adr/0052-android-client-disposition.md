# ADR-0052: Android client disposition

- **Date**: 2026-08-28
- **Commits**: `6a2854d` (plan 052 spike; no source-code commit)

## Status

Proposed — the framing below is settled by evidence; the archive-vs-adopt choice awaits operator sign-off.

## Context

`immi android app/` is a self-contained Gradle project (`rootProject.name = "ImmiAndroid"`,
`include(":app")` in `settings.gradle.kts`) that has sat in the default checkout of this
repository with no marking of any kind. Nothing in the root `README.md`, `CLAUDE.md`,
`Makefile`, or `.github/workflows/` mentions it. A contributor who opens the repo has no
way to tell whether it is a maintained second client or abandoned scaffolding.

It was written on 2026-03-17 against a Flask backend. `immi android app/README.md:1-6`,
verbatim:

```
# IMMI Android App — 完整實作計劃

**目標**：建立 IMMI-Case 的 Android Native Kotlin 版本，完整復刻所有功能
**後端**：連接現有 Flask REST API (`/api/v1/*`)
**架構**：MVVM + Clean Architecture + Jetpack Compose
**計劃日期**：2026-03-17
```

Production today is `https://immi.trackit.today`, served entirely by the Cloudflare Worker
`workers/cloudflare-native.js`. The Flask app under `immi_case_downloader/` is local-dev
only and is not wired to production traffic. Any `/api/*` path the Worker does not match
returns 503 `cloudflare_route_unavailable` — there is no Flask fallback to catch it.

File counts (re-verified 2026-08-28, `git ls-files "immi android app"`): **167 tracked
files, 135 of them `.kt`.**

## Evidence

All numbers below were re-run in this session on 2026-08-28, from a fresh git worktree
checked out from repository commit `6a2854d` (current `main` at plan time).

### Build and tests — not reproducible in this worktree

```
$ cd "immi android app" && ./gradlew assembleDebug --console=plain
(eval):1: no such file or directory: ./gradlew
```

This is the expected failure mode, not a surprise: `immi android app/.gitignore` excludes
`gradlew` and `gradle/wrapper/gradle-wrapper.jar` under the comment `# Gradle wrapper (keep
.properties, exclude binaries)`. Only `gradle/wrapper/gradle-wrapper.properties` is tracked.
This worktree is effectively a fresh clone, and a fresh clone of this repository **cannot
build the Android app at all** until someone regenerates the wrapper — this session is
itself a live demonstration of that gap, not just a claim about it.

Build not reproducible in this environment (`(eval):1: no such file or directory: ./gradlew`);
last verified BUILD SUCCESSFUL with 293/293 unit tests passing on 2026-08-28 (macOS 26.0
arm64, Android Studio JBR 21.0.8, Android SDK 35), per the audit this plan was written from.
That prior success depended on three things outside this repository: (1) the untracked
`gradlew` + `gradle-wrapper.jar` existing only on that one machine; (2) a **user-global**
`~/.gradle/gradle.properties` line `org.gradle.java.home=/Applications/Android
Studio.app/Contents/jbr/Contents/Home` pointing Gradle 8.9 at JDK 21 (Gradle 8.9 does not
support JDK 25, which is what's on `PATH` by default); (3) `ANDROID_HOME` pointing at a
local Android SDK with `platforms/android-35` and `build-tools/35.0.0` present, and no
`local.properties` in the repo to supply it another way. None of the three exist on a CI
runner or a fresh clone. "It builds" was true of one laptop, not of the repository.

### Endpoint declarations — 31 total, re-confirmed

```
$ grep -rn "@GET\|@POST\|@PUT\|@DELETE" \
    "immi android app/app/src/main/java/au/gov/immi/cases/network/api/" | wc -l
31
```

### Source inventory (2026-08-28) — the four phantom paths appear nowhere

Method-aware grep against the actual routing source, not a probe, because three of the
four declarations are non-`GET` and a `GET` probe cannot prove a `POST`/`DELETE` route is
absent (this Worker's terminal fallback 503s *any* unmatched `/api/` path regardless of
method). Run with `git grep`, not `grep --include` — this shell's `grep` is a wrapper
around `ugrep`, which silently ignores an unrecognized `--include` and exits 0, which would
make a negated check pass vacuously.

| Path | worker matches | flask matches |
|---|---|---|
| `saved-searches` | 0 | 0 |
| `search/guided` | 0 | 0 |
| `search/taxonomy` | 0 | 0 |
| `pipeline/start` | 0 | 0 |

All eight checks (4 paths × 2 codebases) printed `0`. None of `saved-searches`,
`search/guided`, `search/taxonomy`, `pipeline/start` appears in any Worker path literal
under `workers/` or in any Flask route decorator under
`immi_case_downloader/web/routes/`. Saved searches in the React SPA live in browser
`localStorage`, which is why no server endpoint was ever written for them. These four
declarations were invented from the README's Phase plan, not from a real API — and three
of the six client declarations that hit these four paths are `POST`/`DELETE`
(`POST saved-searches`, `DELETE saved-searches/{id}`, `POST pipeline/start`), so this
source inventory — not the GET probes below — is what actually settles those three.

The near misses, confirmed the same way, show the client was written against a plan rather
than a live API:

```
$ git grep -n -- "guided-search" -- 'workers/**/*.js' | grep -v __tests__
workers/case-api/cloudflare_actions.js:153: ... "/api/v1/taxonomy/guided-search" ...
workers/case-api/cloudflare_actions.js:159:  if (path === "/api/v1/taxonomy/guided-search") ...

$ git grep -n -- "pipeline-action" -- 'workers/**/*.js' | grep -v __tests__
workers/pipeline/control_handlers.js:18:  "/api/v1/pipeline-action",
```

The Worker serves `/api/v1/taxonomy/guided-search` (not `search/guided`) and a
`pipeline-action` route (not `pipeline/start`) — the capability partly exists under a
different path; the declared path never did.

### Production probes (2026-08-28) — GET only, corroboration for the GET declarations

```
/api/v1/stats                          200
/api/v1/analytics/success-rate         200
/api/v1/saved-searches                 503
/api/v1/search/guided                  503
/api/v1/search/taxonomy                503
/api/v1/pipeline/start                 503
```

The two controls (`/api/v1/stats`, `/api/v1/analytics/success-rate`) returning 200 prove
the host and path prefix are correct, which is all a GET probe can establish. The
`POST`/`DELETE` declarations (`saved-searches` create/delete, `pipeline/start`) were
**verified from source in the section above, not probed** — sending a real `POST` or
`DELETE` to production to test routing would have side effects (enqueuing a pipeline run,
deleting data that might exist), so this ADR does not do that.

### Endpoint tally

**21 served, 4 gated, 6 phantom** (of 31 declared):

- Served (21): `GET cases`, `GET cases/{id}`, `GET cases/{id}/similar`, all 10
  `GET analytics/*`, `GET legislations` (+ `/{id}`, `/search`), `GET search`,
  `GET search/semantic`, `GET csrf-token`, `GET stats`, `GET job-status`.
- Gated, not phantom (4): `POST cases`, `PUT cases/{id}`, `DELETE cases/{id}` — behind
  `wrangler.toml:92` `IMMI_CASE_MUTATIONS_ENABLED = "false"`, fail-closed by design; and
  `POST download/start` — served but additionally requires `requireAuth` + `verifyCsrf` in
  `workers/pipeline/control_handlers.js`, which this client cannot satisfy (see below).
- Phantom (6): `GET search/guided`, `GET search/taxonomy`, `GET saved-searches`,
  `POST saved-searches`, `DELETE saved-searches/{id}`, `POST pipeline/start`.

### No authentication code anywhere in the client

```
$ git grep -ril "authorization\|bearer\|telegram\|jwt" -- "immi android app/**/*.kt"
(no output, exit 1)
```

`immi android app/app/src/main/java/au/gov/immi/cases/network/RetrofitFactory.kt:73-93`
builds the OkHttp client with exactly one interceptor, and it is CSRF, not `Authorization`:

```kotlin
    private fun buildOkHttpClient(
        serverUrl: String,
        enableLogging: Boolean
    ): OkHttpClient {
        val csrfInterceptor = CsrfInterceptor(serverUrl)

        return OkHttpClient.Builder()
            .connectTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .addInterceptor(csrfInterceptor)
            .apply {
                if (enableLogging) {
                    val loggingInterceptor = HttpLoggingInterceptor().apply {
                        level = HttpLoggingInterceptor.Level.BODY
                    }
                    addInterceptor(loggingInterceptor)
                }
            }
            .build()
    }
```

Production authenticates reads with `Authorization: Bearer <access_token>` and authorizes
them with `CloudflareIdentityStore.assertMembership()` in `workers/storage/cloudflare.js`
(app-layer tenant isolation — no Postgres, no RLS in this stack). A client with no
`Authorization` header cannot reach any authenticated surface.

### No CI job, ever

`Makefile:62`, verbatim:

```makefile
test: test-py test-fe test-workers
```

`grep -in "gradle\|android" Makefile` returns nothing. `.github/workflows/` contains
exactly `ci.yml` and `deploy-worker.yml`; `ci.yml` has exactly three jobs
(`test-python`, `test-frontend`, `test-worker`), and
`grep -rin "gradle\|android\|kotlin" .github/workflows/` returns nothing.

### The application ID claims the Australian Government namespace

`immi android app/app/build.gradle.kts:11,15`, verbatim:

```kotlin
android {
    namespace = "au.gov.immi.cases"
    compileSdk = 35

    defaultConfig {
        applicationId = "au.gov.immi.cases"
```

`au.gov.*` is the namespace convention for Australian Government entities. This is a
private case browser, not a government product. Distributing under this ID would present
the app as official.

### The release build points at a placeholder host

`immi android app/app/build.gradle.kts:39`, verbatim:

```kotlin
            buildConfigField("String", "DEFAULT_SERVER_URL", "\"https://your-server.com\"")
```

## Decision

Evidence settles this much: the Kotlin client is **not** a maintained client of this
system today; it is not shippable as-is; no feature work happens on it until the open
question below is answered by the operator.

Three unconditional blockers hold regardless of which way the open question resolves:

1. **`applicationId` is `au.gov.immi.cases`** and must be renamed before any distribution
   — this presents a private project as an official Australian Government app.
2. **There is no `Authorization` header anywhere in the client** — it cannot reach any
   authenticated surface on the production Worker.
3. **There is no CI job** — a dependency bump can break the client silently and nobody
   would know.

## Open question

Archive or adopt. Both options costed below; this ADR does not choose between them.

- **Option A — Archive (recommended).** Move `immi android app/` out of the default
  checkout — either a separate repository, or delete after tagging the current commit so
  the history is still recoverable. Cost: near zero. Rationale: the responsive React SPA
  already serves mobile; 6 of 31 declared endpoints are fiction; a fresh clone cannot even
  build this client today (see Evidence — this session's own attempt failed with the
  gitignored-wrapper error).

- **Option B — Adopt.** Entry price, all of it required before any feature work:
  - Rename `applicationId` off `au.gov.*`.
  - Add an `Authorization: Bearer` interceptor plus the Telegram-login flow.
  - Delete or reimplement the six phantom endpoints. Three of them
    (`saved-searches` GET/POST/DELETE) become real only if a plan ships a real
    server-side saved-search store — not true as of this ADR's date (see Consequences).
    The other three (`search/guided`, `search/taxonomy`, `pipeline/start`) would need to be
    deleted or re-pointed at the Worker's actual paths
    (`/api/v1/taxonomy/guided-search`, `/api/v1/pipeline-action`).
  - Replace the `https://your-server.com` placeholder in `build.gradle.kts:39`.
  - Track `gradlew` + `gradle-wrapper.jar` in git, or document a wrapper-regeneration step
    a fresh clone can run.
  - Add a Gradle CI job to `.github/workflows/ci.yml` and an `android` target to the
    `Makefile`.

## Consequences

What is true the moment this ADR lands:

- The directory stays in the tree, but is now banner-marked at
  `immi android app/README.md` line 1 — nobody opening that file mistakes it for current
  documentation.
- Nobody should treat this directory as a maintained client until the sign-off below picks
  an option.
- Dependency bumps (Kotlin, Compose, Retrofit, Gradle plugins) are known not to be
  validated against this client — there is no CI to catch a break.
- The directory cannot be built from a fresh clone as-is; only a checkout carrying the
  three external prerequisites in Evidence can build it.
- This ADR does not itself move, delete, or rename anything under `immi android app/`; it
  is a decision record, not the decision's execution.

## Operator sign-off

- [ ] Chosen option: ______ (A / B). Signed: ______________  Date: __________

- **Owner**: to be named by whoever accepts this ADR. This field must not be left as "the
  team" — write a person's name here.

- **Deadline**: 60 days from this ADR's date, i.e. **2026-10-27**. If this line is still
  unchecked after that date, the default outcome is **Option A (archive)** — an
  unmaintained client sitting unmarked in the default checkout is the exact status quo
  this ADR exists to end, and "no decision" must not silently resolve to "keep it
  forever." Whoever next reads this file after the deadline and finds no signature should
  report that as a finding, not quietly extend the clock.

- **Conditions under which Option B becomes worth its entry price** (all three, not any
  one):
  1. A decision, backed by evidence, that the responsive React SPA is insufficient for
     the primary self-represented-applicant user on mobile — not a guess.
  2. A named owner willing to carry an ongoing Gradle CI job (not a one-time fix).
  3. A real server-side saved-search store shipping — three of the six phantom endpoints
     depend on this and are not fixable without it.

  Without all three, Option B stays permanently available as a vague "someday" and this
  file never actually closes.

- The physical archive-or-revive action (moving the directory, tagging the commit,
  starting the entry-price work) is a **follow-up** triggered by this sign-off. It is not
  performed by the plan that produced this ADR.
