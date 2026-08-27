# Plan 052: Spike — decide whether the 135-file Kotlin client is archived or adopted, and mark it either way

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists — unless a reviewer dispatched you
> and told you they maintain the index. (`plans/README.md` did not exist when
> this plan was written; do not create it.)
>
> **Drift check (run first)**. A committed-history diff cannot see uncommitted,
> staged or untracked work, so all four commands must run:
> ```bash
> cd "/Users/d/Developer/Active Projects/IMMI-Case-"
> git status --short --branch
> git diff --stat 42826a3..HEAD -- docs/adr "immi android app"   # committed
> git diff --stat -- docs/adr "immi android app"                 # unstaged
> git diff --cached --stat -- docs/adr "immi android app"        # staged
> ```
> Expected: the last three print nothing and no in-scope path appears in
> `git status` — `docs/adr/` merely existing (because
> `plans/044-retire-the-stale-planning-docs.md` owns and created it) is fine.
> If any in-scope file appears in **any** of them, treat it as a STOP
> condition: compare the "Current state" excerpts against the live code and
> report. **Never** run `git checkout --` or `git clean -f` to force a clean
> tree — the uncommitted work is the operator's.
>
> **This is a decision/spike plan.** The output is evidence plus one written
> decision record plus a banner on one README. **There is no source-code
> change anywhere in this plan.** Do not delete, move, or edit any `.kt`,
> `.kts`, `.xml`, or `.toml` file. Do not add a CI job. Do not "fix" the
> Android app. If you find yourself editing Kotlin, you have left the plan.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `42826a3`, 2026-08-27

## Why this matters

`immi android app/` is 167 tracked files — 135 of them Kotlin — sitting in the
default checkout of this repository with no marking of any kind. Nothing in the
root `README.md`, `CLAUDE.md`, `Makefile`, or `.github/workflows/` mentions it.
A contributor who opens the repo has no way to tell whether it is a maintained
second client or abandoned scaffolding.

It is neither, exactly, and that is the problem. It **does** still compile and
its 293 unit tests **do** pass (verified 2026-08-28 — see Current state), so
"dead code" is the wrong label. But it was written on 2026-03-17 against "現有
Flask REST API", and the Flask app is local-dev-only today; production is a
Cloudflare Worker. Six of the 31 endpoints it calls have never existed on any
backend, Flask or Worker, and return 503 in production right now. It ships zero
authentication code against a Worker whose writes require a JWT. It has no CI
job, so the next dependency bump breaks it silently. And its `applicationId` is
`au.gov.immi.cases`, a namespace that reads as an official Australian
Government app — it cannot be published as-is regardless of any other decision.

The cost of leaving it unmarked is that somebody eventually spends a week
"finishing" a client whose backend contract is 20% fiction, or bumps a shared
dependency and never learns they broke it. This plan does not decide the
product question (does the responsive React SPA already cover mobile?) — that
is the operator's call. It gathers the numbers that call needs, writes them
down where they will be found, and stops anyone mistaking the directory for a
maintained client in the meantime.

## Current state

### The files

- `immi android app/` — a self-contained Gradle project (`rootProject.name = "ImmiAndroid"`,
  `include(":app")` in `settings.gradle.kts`). 167 tracked files: 135 `.kt`,
  17 `.xml`, 6 `.ttf`, 3 `.kts`, 2 `.properties`, 1 `.toml`, 1 `.pro`, 1 `.md`,
  1 `.gitignore`.
- `immi android app/README.md` — a 24 KB implementation *plan* dated 2026-03-17,
  not user documentation. Its headings are `## Phase 0` … `## Phase 11`, then
  `## 關鍵技術挑戰`, `## 實作優先順序`, `## 參考文件`.
- `immi android app/app/src/main/java/au/gov/immi/cases/network/api/` — five
  Retrofit interfaces declaring 31 endpoints total.
- `immi android app/app/src/main/java/au/gov/immi/cases/network/RetrofitFactory.kt`
  — builds the OkHttp client; installs a CSRF interceptor and nothing else.
- `docs/adr/` — **does not exist.** `ls -d docs/adr` prints nothing and exits 1.
  `ls docs/` prints exactly: `ARCHITECTURE.md`, `HYPERDRIVE_CACHE_RFC.md`,
  `JUDGE_DATA_QUALITY.md`, `ops`, `plans`, `screenshots`, `UPLOAD_JUDGE_PHOTOS.md`.
  It is not gitignored: `git check-ignore -v docs/adr/0001-test.md` exits 1.

### It targets Flask, and Flask is not production

`immi android app/README.md:1-6`, verbatim:

```
# IMMI Android App — 完整實作計劃

**目標**：建立 IMMI-Case 的 Android Native Kotlin 版本，完整復刻所有功能
**後端**：連接現有 Flask REST API (`/api/v1/*`)
**架構**：MVVM + Clean Architecture + Jetpack Compose
**計劃日期**：2026-03-17
```

Production is `https://immi.trackit.today`, served entirely by the Cloudflare
Worker `workers/cloudflare-native.js`. The Flask app under
`immi_case_downloader/` is local-dev only and is not wired to production
traffic. Any `/api/*` path the Worker does not match returns 503
`cloudflare_route_unavailable` — there is no Flask fallback to catch it.

### The release build points at a placeholder host

`immi android app/app/build.gradle.kts:32-41`, verbatim:

```kotlin
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            buildConfigField("String", "DEFAULT_SERVER_URL", "\"https://your-server.com\"")
            buildConfigField("Boolean", "ENABLE_LOGGING", "false")
        }
```

### The application ID claims the Australian Government namespace

`immi android app/app/build.gradle.kts:10-17`, verbatim:

```kotlin
android {
    namespace = "au.gov.immi.cases"
    compileSdk = 35

    defaultConfig {
        applicationId = "au.gov.immi.cases"
        minSdk = 26
        targetSdk = 35
```

`au.gov.*` is the namespace used by Australian Government entities. This
project is a private case browser, not a government product. Shipping under
this ID would present the app as official. Any "revive" decision must rename
it first; this is not negotiable and is not a matter of taste.

### There is no authentication code at all

Searching the 135 Kotlin sources for auth vocabulary returns **nothing**:

```
grep -riln "authorization\|bearer\|telegram\|jwt" --include="*.kt" "immi android app"
→ (no output, exit 1)
```

(Note: a broader grep for the bare word `token` *does* match ~20 files, but
every hit is either the `DesignTokens` colour system or the CSRF token. Use the
four-word pattern above; the bare `token` grep is misleading.)

`immi android app/app/src/main/java/au/gov/immi/cases/network/RetrofitFactory.kt:73-93`,
verbatim — one interceptor, and it is CSRF, not `Authorization`:

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

The Worker authenticates reads with `Authorization: Bearer <access_token>` and
authorizes them with `CloudflareIdentityStore.assertMembership()` in
`workers/storage/cloudflare.js` (app-layer tenant isolation — there is no
Postgres and no RLS in this stack). A client with no `Authorization` header
cannot reach any authenticated surface.

### Six of its 31 endpoints have never existed on any backend

The client declares 31 endpoints. Every one, with its production status,
verified 2026-08-28:

| Android declaration | Path (relative to `/api/v1/`) | Production status |
|---|---|---|
| `CasesApiService.kt:21` | `GET cases` | served — `workers/case-api/cloudflare.js:1093` |
| `CasesApiService.kt:27` | `GET cases/{id}` | served — `cloudflare.js:1142` |
| `CasesApiService.kt:52` | `GET cases/{id}/similar` | served — `cloudflare.js:1123` |
| `CasesApiService.kt:33` | `POST cases` | flag-gated (see below) |
| `CasesApiService.kt:39` | `PUT cases/{id}` | flag-gated |
| `CasesApiService.kt:46` | `DELETE cases/{id}` | flag-gated |
| `AnalyticsApiService.kt:10,15,20,25,30,33,38,43,48,53` | `GET analytics/*` ×10 | all served — `cloudflare.js:1075-1089` |
| `LegislationsApiService.kt:11,17,22` | `GET legislations`, `/{id}`, `/search` | served — `cloudflare.js:1090-1092` |
| `SearchApiService.kt:19` | `GET search` | served — `cloudflare.js:1107` |
| `SearchApiService.kt:26` | `GET search/semantic` | served — `cloudflare.js:1108` |
| `SearchApiService.kt:33` | `GET search/guided` | **503 — never existed** |
| `SearchApiService.kt:38` | `GET search/taxonomy` | **503 — never existed** |
| `SearchApiService.kt:43` | `GET saved-searches` | **503 — never existed** |
| `SearchApiService.kt:46` | `POST saved-searches` | **503 — never existed** |
| `SearchApiService.kt:51` | `DELETE saved-searches/{id}` | **503 — never existed** |
| `SystemApiService.kt:11` | `GET csrf-token` | served — `workers/cloudflare-native.js` |
| `SystemApiService.kt:15` | `GET stats` | served — `cloudflare.js:1062` |
| `SystemApiService.kt:19` | `GET job-status` | served — `workers/pipeline/cloudflare_handlers.js` |
| `SystemApiService.kt:22` | `POST pipeline/start` | **503 — never existed** (Worker uses `pipeline-action`) |
| `SystemApiService.kt:27` | `POST download/start` | served but auth-gated — `workers/pipeline/control_handlers.js:17,107` |

Tally: **21 served, 4 gated, 6 phantom.**

"Never existed" is precise, not rhetorical — **and it is a source claim, not a
probe result**. `/api/v1/saved-searches`, `/api/v1/search/guided`,
`/api/v1/search/taxonomy` and `/api/v1/pipeline/start` appear in **no** Flask
route decorator under `immi_case_downloader/web/routes/` and in **no** Worker
path literal under `workers/` (re-derive with the `git grep` loop in Step 2a;
all four return zero on both sides). Saved searches in the React SPA live in
browser `localStorage`, which is why no server endpoint was ever written. These
six were invented from the README's Phase plan, not from a real API.

Note carefully that three of the six declarations are **not GETs** —
`POST saved-searches`, `DELETE saved-searches/{id}` and `POST pipeline/start`.
A GET probe returning 503 cannot prove a POST route is absent (the Worker's
terminal fallback 503s any unmatched `/api/` path whatever the method), and
probing them for real would have side effects. The source inventory is what
settles those three; the probes in Step 2b corroborate the GET ones and confirm
the host. Any sentence in the ADR that rests on a probe must say so.

The near misses are worth recording too, because they show the client was
written against a plan rather than an API: the Worker does serve
`/api/v1/taxonomy/guided-search` (not `search/guided`) and a `pipeline-action`
route (not `pipeline/start`).

Verbatim, `immi android app/app/src/main/java/au/gov/immi/cases/network/api/SearchApiService.kt:41-55`:

```kotlin
    // ─── Saved Searches ──────────────────────────────────────────────────────────

    @GET("saved-searches")
    suspend fun getSavedSearches(): Response<ApiResponse<List<Map<String, Any>>>>

    @POST("saved-searches")
    suspend fun createSavedSearch(
        @Body body: Map<String, String>
    ): Response<ApiResponse<Map<String, Any>>>

    @DELETE("saved-searches/{id}")
    suspend fun deleteSavedSearch(
        @Path("id") id: Int
    ): Response<ApiResponse<Any?>>
}
```

The four "flag-gated" writes are gated by `wrangler.toml:92`
`IMMI_CASE_MUTATIONS_ENABLED = "false"` — fail-closed **by design**; do not
propose flipping it. `download/start` additionally requires `requireAuth` +
`verifyCsrf` in `workers/pipeline/control_handlers.js`, which the client cannot
satisfy (no `Authorization` header).

### It has never had a CI job

`Makefile:62`, verbatim — three suites, no Android:

```makefile
test: test-py test-fe test-workers
```

`grep -in "gradle\|android" Makefile` returns nothing.
`.github/workflows/` contains exactly `ci.yml` and `deploy-worker.yml`.
`ci.yml` has exactly three jobs — `test-python` (line 17), `test-frontend`
(line 48), `test-worker` (line 71) — and
`grep -rin "gradle\|android\|kotlin" .github/workflows/` returns nothing.

### It nevertheless still builds, and its tests pass

This is the fact that makes the decision non-obvious, so it is stated with its
full environment. Verified 2026-08-28 on macOS 26.0 / arm64:

```
$ cd "immi android app" && ./gradlew assembleDebug --console=plain
...
> Task :app:compileDebugKotlin
w: .../feature/dashboard/DashboardScreen.kt:106:46 'val Icons.Filled.TrendingUp: ImageVector' is deprecated. ...
...
BUILD SUCCESSFUL in 3m 35s
41 actionable tasks: 41 executed

$ ./gradlew testDebugUnitTest --console=plain
BUILD SUCCESSFUL in 21s

$ # tally of app/build/test-results/testDebugUnitTest/*.xml (30 files)
tests=293 failures=0 errors=0 skipped=0
```

A 22 MB `app-debug.apk` was produced at
`immi android app/app/build/outputs/apk/debug/app-debug.apk`. Both `build/`
directories are gitignored, so the build dirties no tracked file.

**The build only works because of three things outside this repository**, and
you must know this before you interpret a failure:

1. `./gradlew` and `gradle/wrapper/gradle-wrapper.jar` are **untracked and
   gitignored** — `immi android app/.gitignore` contains
   `gradle/wrapper/gradle-wrapper.jar` and `gradlew` under the comment
   `# Gradle wrapper (keep .properties, exclude binaries)`. They exist on this
   machine only. **A fresh clone of this repository cannot build the Android
   app at all** until someone regenerates the wrapper.
2. The build runs on JDK 21, not the JDK 25 on `PATH`. That comes from a
   **user-global** file, `~/.gradle/gradle.properties:3`:
   `org.gradle.java.home=/Applications/Android Studio.app/Contents/jbr/Contents/Home`.
   The project's own `gradle.properties` does not set it. Gradle 8.9
   (`gradle/wrapper/gradle-wrapper.properties`) does not support Java 25.
3. `ANDROID_HOME=/Users/d/Library/Android/sdk` with `platforms/android-35` and
   `build-tools/35.0.0` present. There is no `local.properties`.

None of the three exist on a CI runner. "It builds" is true of this laptop, not
of the repository.

### Repo conventions this plan must honour

- Commit messages are `<type>: <description>` where type is one of
  `feat|fix|refactor|docs|test|chore|perf|ci`. No AI attribution lines.
  Example from `git log`: `fix: install root node_modules in make install`.
- ADRs are written **in English**.
- Do not "fix" any of these — they are deliberate: the placeholder resource IDs
  in `wrangler.toml`; `IMMI_CASE_MUTATIONS_ENABLED = "false"`;
  `workers/austlii-scraper/scripts/rollback_run.ts` targeting legacy Supabase;
  the historical "Performance Baseline (2026-05-05)" section in `CLAUDE.md`.

### ADR numbering is centrally assigned — read this before Step 3

`docs/adr/` was contested: four separate plans each created it and several
claimed `0001`. That is resolved, and the assignment is fixed:
**`plans/044-retire-the-stale-planning-docs.md` owns the directory**, including
`docs/adr/README.md`, `docs/adr/TEMPLATE.md` and ADRs 0001–0003. Every other
plan creates exactly one file named after its own plan number.

**This plan's file is `docs/adr/0052-android-client-disposition.md`** — nothing
else. Do **not** create `docs/adr/README.md`, do not append a row to it, and do
not renumber or "tidy" any ADR another plan wrote. `mkdir -p docs/adr` is fine;
the directory already existing is the normal case and is **not** a STOP
condition. The index row for 0052 is added by 044 when it lands (see
"Maintenance notes").

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Drift check | `git diff --stat 42826a3..HEAD -- docs/adr "immi android app"` | no output |
| Count tracked Android files | `git ls-files "immi android app" \| wc -l \| tr -d ' '` | `167` |
| Count Kotlin sources | `git ls-files "immi android app" \| grep -c '\.kt$'` | `135` |
| Android build | `cd "immi android app" && ./gradlew assembleDebug --console=plain` | `BUILD SUCCESSFUL` |
| Android unit tests | `cd "immi android app" && ./gradlew testDebugUnitTest --console=plain` | `BUILD SUCCESSFUL` |
| Count declared endpoints | `grep -rhc "@GET\|@POST\|@PUT\|@DELETE" "immi android app/app/src/main/java/au/gov/immi/cases/network/api/" \| paste -sd+ - \| bc` | `31` |
| Probe production | `curl -s -o /dev/null -w "%{http_code}\n" --max-time 30 "https://immi.trackit.today<path>"` | see Step 2 |
| Repo cleanliness | `git status --porcelain` | only in-scope paths |

Nothing in this plan runs `make test`, `pytest`, `vitest`, `tsc`, or `ruff` —
it changes no Python, TypeScript, or Worker code, so those suites cannot be
affected. Do not run them; do not report on them.

## Scope

**In scope** (the only files you may create or modify):

- `docs/adr/0052-android-client-disposition.md` (create — the **only** file you
  may add under `docs/adr/`)
- `immi android app/README.md` (modify: insert a banner at the top; change
  nothing below it)

**Out of scope** (do NOT touch, even though they look related):

- Every `.kt`, `.kts`, `.xml`, `.ttf`, `.toml`, `.pro` file under
  `immi android app/` — this plan makes zero source changes. The client is not
  to be fixed, renamed, re-pointed, or deleted here. Physically moving the
  directory out of the checkout is the follow-up action **after** the operator
  signs the ADR, not part of this plan.
- `immi android app/.gitignore` — the untracked-`gradlew` situation is recorded
  in the ADR as a fact, not repaired here.
- The root `README.md` and `CLAUDE.md` — plans 042 and 043 own those files;
  editing them here would collide. The ADR is the durable record; a pointer
  from the root README is a follow-up noted in Maintenance notes.
- `Makefile` and `.github/workflows/ci.yml` — adding an Android CI job is only
  justified on the "adopt" branch, which is not decided yet. Adding one now
  would spend CI minutes on a client that may be archived next week.
- `docs/adr/README.md` and `docs/adr/TEMPLATE.md` — owned by `plans/044`. Do
  not create them, append to them, or reformat them.
- Any ADR other than `0052-android-client-disposition.md` — written by plans
  044/047/048/049/050/051. Never rewrite or renumber another plan's ADR, and
  never `git add docs/adr` as a directory.
- **`POST`/`PUT`/`DELETE` requests to production.** Every probe in this plan is
  a `GET` against a public read endpoint. Method-specific claims are derived
  from the Worker source, not from side-effecting requests (Step 2a).
- `frontend/`, `workers/`, `immi_case_downloader/`, `wrangler.toml` — untouched.
- `plans/README.md` — did not exist at planning time; do not create it.

## Git workflow

- Branch: `advisor/052-decide-the-android-client`, **created in Step 0, before
  any other step**. Creating it at the end (as an earlier draft did) means
  every intermediate state — the Gradle run, the ADR draft, the README banner —
  lands on whatever branch you happened to start on, and on a shared dirty tree
  there is then no way to tell your changes from anyone else's.
- One commit at the end is fine; this plan produces documentation only.
  Message: `docs: record the Android client's status as an ADR`
- **Stage the three files by name. Never `git add docs/adr`** — that directory
  is shared, and a sibling agent's in-flight ADR sitting untracked beside yours
  would be swept into your commit.
- Type must be one of `feat|fix|refactor|docs|test|chore|perf|ci`. No AI
  attribution lines, no `Co-Authored-By`.
- **Do NOT push, do NOT open a PR, do NOT merge.** The operator commits and
  ships. Stop after the local commit.

## Steps

### Step 0: Create the branch first

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
git status --short --branch          # record what was ALREADY dirty; none of it is yours
git checkout -b advisor/052-decide-the-android-client
```

Write down the pre-existing dirty paths. Every later `git status` check in this
plan means "only my files, plus those". Do not clean them, do not stash them,
and do not include them in your commit.

**Verify**: `git rev-parse --abbrev-ref HEAD` prints
`advisor/052-decide-the-android-client`.

### Step 1: Re-establish whether the client still builds and its tests still pass

The ADR you write in Step 3 must contain numbers you observed yourself, dated.
Do not copy the 2026-08-28 numbers from this plan without re-running.

Run, from the repository root:

```bash
cd "immi android app" && ./gradlew assembleDebug --console=plain 2>&1 | tail -5
cd "immi android app" && ./gradlew testDebugUnitTest --console=plain 2>&1 | tail -5
```

Then tally the JUnit XML:

```bash
cd "immi android app" && python3 - <<'EOF'
import glob, xml.etree.ElementTree as ET
t=f=s=e=0
for p in glob.glob("app/build/test-results/testDebugUnitTest/*.xml"):
    r = ET.parse(p).getroot()
    t += int(r.get("tests", 0)); f += int(r.get("failures", 0))
    s += int(r.get("skipped", 0)); e += int(r.get("errors", 0))
print(f"tests={t} failures={f} errors={e} skipped={s}")
EOF
```

Record the three outputs verbatim; you will paste them into the ADR.

**Outcome A — it builds** (what happened on 2026-08-28): both Gradle
invocations end in `BUILD SUCCESSFUL`, and the tally prints
`tests=293 failures=0 errors=0 skipped=0`. Proceed to Step 2.

**Outcome B — the toolchain is unavailable.** Symptoms: `./gradlew: No such
file or directory` (the wrapper is gitignored — see Current state); or
`Unsupported class file major version` / `Could not determine java version`
(no JDK ≤ 22 available); or `SDK location not found`. **Do not try to install
a JDK, download a Gradle distribution manually, regenerate the wrapper, or
create `local.properties`.** Record the exact error string, and in the ADR
write the build line as:

> Build not reproducible in this environment (`<exact error>`); last verified
> BUILD SUCCESSFUL with 293/293 unit tests passing on 2026-08-28 (macOS 26.0
> arm64, Android Studio JBR 21.0.8, Android SDK 35).

Then proceed to Step 2. Outcome B is itself evidence for the ADR — it is the
concrete demonstration that a fresh checkout cannot build this client.

**Outcome C — it builds but tests fail.** Record the failing test names and the
tally verbatim, and proceed. Do not fix them; fixing them is out of scope.

**Verify**: `git status --porcelain` → shows **no** modification under
`immi android app/` (only `?? plans/` and any pre-existing unrelated entries).
Gradle writes only to gitignored `build/` and `.gradle/` directories; if a
tracked file under `immi android app/` shows as modified, that is a STOP
condition.

### Step 2: Re-derive the endpoint gap — **from source, method-aware**

Confirm the client declares 31 endpoints:

```bash
grep -rn "@GET\|@POST\|@PUT\|@DELETE" \
  "immi android app/app/src/main/java/au/gov/immi/cases/network/api/" | wc -l
```

**2a. Source inventory is the evidence. Probes are corroboration only.**

Three of the six "phantom" declarations are not `GET`s — `POST saved-searches`,
`DELETE saved-searches/{id}` and `POST pipeline/start`. A `GET` probe returning
503 says nothing about whether a `POST` route exists at that path: a router
that matches on method could serve the POST and 503 the GET, and this Worker's
terminal fallback 503s *any* unmatched `/api/` path regardless of method. So
the probe cannot distinguish "no route" from "no route for this method", and an
earlier draft of this plan used it as if it could.

**Do not resolve that by sending POST or DELETE to production.** Those have
side effects by definition; a probe that might enqueue a pipeline run or delete
a saved search is not a diagnostic. Derive the answer from source instead —
the routing is a fixed dispatch chain in one file
(`workers/cloudflare-native.js`), so the source *is* authoritative:

```bash
cd "/Users/d/Developer/Active Projects/IMMI-Case-"
for p in "saved-searches" "search/guided" "search/taxonomy" "pipeline/start"; do
  printf "%-18s worker=" "$p"
  git grep -c -- "$p" -- 'workers/*.js' 'workers/**/*.js' | grep -v __tests__ | wc -l | tr -d ' '
  printf "%-18s flask =" "$p"
  git grep -c -- "$p" -- 'immi_case_downloader/web/routes/*.py' | wc -l | tr -d ' '
done
```

Every line must print `0`. Note `git grep` rather than `grep --include`: this
repo's shell may alias `grep` to `ugrep`, which rejects `--include` with a
warning **and exits 0** — making a negated check pass vacuously. That is
exactly the kind of verification that cannot fail, and the previous version of
this step used it for the Worker side while also omitting three of the four
paths.

Then confirm the two near-miss paths that *do* exist, so the ADR can say what
the client should have called instead:

```bash
git grep -n -- "guided-search"   -- 'workers/**/*.js' | grep -v __tests__
git grep -n -- "pipeline-action" -- 'workers/**/*.js' | grep -v __tests__
```
→ both return matches (`/api/v1/taxonomy/guided-search` in
`workers/case-api/cloudflare_actions.js`, `pipeline-action` in the pipeline
control handlers). This is what makes "phantom" precise: the *capability*
partly exists under a different path; the *declared* path never did.

**2b. Corroborating probes — GET only, and labelled as such.**

```bash
for p in /api/v1/stats /api/v1/analytics/success-rate \
         /api/v1/saved-searches /api/v1/search/guided \
         /api/v1/search/taxonomy /api/v1/pipeline/start; do
  printf "%-38s " "$p"
  curl -s -o /dev/null -w "%{http_code}\n" --max-time 30 "https://immi.trackit.today$p"
done
```

Observed 2026-08-28:

```
/api/v1/stats                          200
/api/v1/analytics/success-rate         200
/api/v1/saved-searches                 503
/api/v1/search/guided                  503
/api/v1/search/taxonomy                503
/api/v1/pipeline/start                 503
```

A code of `000` means curl timed out, not that the endpoint is down — retry
once with `--max-time 45` before recording anything.

**When you write these into the ADR, label them honestly**: "GET probe;
`POST`/`DELETE` declarations were verified from source, not probed, because
probing them would have side effects." The two controls returning 200 prove the
host and path prefix are right, which is all a GET probe can establish for a
non-GET declaration.

Record the actual numbers. If the results differ from the table above (e.g.
`/api/v1/saved-searches` now returns 200 because plan 050 landed), use **your**
results and say so — do not copy this plan's table.

**Verify**: the endpoint count command prints `31`; every path in the 2a loop
prints `0` for both worker and flask; the two near-miss greps return matches;
and the 2b probes return `200 200 503 503 503 503`.

### Step 3: Write `docs/adr/0052-android-client-disposition.md`

Create `docs/adr/` if it does not exist. Then write the ADR **in English**,
in your own words, from the evidence you gathered in Steps 1–2 plus the
Current state section of this plan. It must contain these `##` headings, in
this order, with real content under each:

1. `## Status` — exactly this line, and nothing weaker:
   `Proposed — the framing below is settled by evidence; the archive-vs-adopt choice awaits operator sign-off.`
2. `## Context` — what the directory is; that it was written 2026-03-17 against
   Flask (quote `immi android app/README.md:4`); that Flask is local-dev-only
   and production is `workers/cloudflare-native.js`; the file counts (167 / 135).
3. `## Evidence` — your Step 1 and Step 2 outputs, verbatim, each with the date
   you ran it. Include the endpoint tally (`21 served / 4 gated / 6 phantom`,
   or your own numbers) and the six phantom paths by name. Include the three
   out-of-repo prerequisites the build depends on (untracked `gradlew`, the
   user-global `org.gradle.java.home`, `ANDROID_HOME`) — these are why "it
   builds" does not mean "it is buildable".
4. `## Decision` — the part evidence settles, stated plainly:
   the Kotlin client is **not** a maintained client of this system; it is not
   shippable; no feature work happens on it until the open question below is
   answered. State the three unconditional blockers: `applicationId` is
   `au.gov.immi.cases` and must be renamed before any distribution; there is no
   `Authorization` header anywhere in the client; there is no CI job.
5. `## Open question` — archive or adopt, with both options costed:
   - **Option A — Archive (recommended).** Move `immi android app/` out of the
     default checkout (separate repository, or delete after tagging the current
     commit so history keeps it). Cost: near zero. Rationale: the responsive
     React SPA already serves mobile; 6 of 31 endpoints are fiction; a fresh
     clone cannot build it anyway.
   - **Option B — Adopt.** Entry price, all of it before any feature work:
     rename `applicationId` off `au.gov.*`; add an `Authorization: Bearer`
     interceptor plus the Telegram-login flow; delete or reimplement the six
     phantom endpoints (`saved-searches` ×3 depends on plan 050 shipping a real
     server-side store); replace the `https://your-server.com` placeholder in
     `build.gradle.kts:39`; track `gradlew` + `gradle-wrapper.jar` or document
     wrapper regeneration; add a Gradle CI job to `.github/workflows/ci.yml`
     and an `android` target to the `Makefile`.
6. `## Consequences` — what is true the moment this ADR lands: the directory
   stays in the tree but is banner-marked; nobody should treat it as a client;
   dependency bumps are known not to be validated against it.
7. `## Operator sign-off` — this section must be actionable, not a wish. It
   needs four things, and an ADR missing any of them leaves the directory in
   exactly the limbo it is documenting:
   - an unchecked line the operator fills in naming the chosen option, their
     name and the date;
   - a **named owner** for the decision — a person, not "the team";
   - a **sign-off deadline** (a concrete date, e.g. 60 days from the ADR's
     date) and what happens if it passes without a decision: the default is
     Option A, because an unmaintained client in the default checkout is the
     status quo this ADR exists to end, and "no decision" must not silently
     resolve to "keep it forever";
   - the **explicit conditions under which maintenance resumes** — that is, what
     would have to become true for Option B to be worth its entry price. State
     them concretely: a decision that mobile web is insufficient for the
     primary user, backed by evidence; an owner willing to carry a Gradle CI
     job; and plan 050 shipping a real server-side saved-search store (three of
     the six phantom endpoints depend on it). Without these, "adopt" is
     permanently available as a vague option and nobody ever closes the file.
   - one line stating that the physical archive/revive action is a follow-up
     and is not performed by this plan.

Cite `file:line` for every code claim. Write no credentials, tokens, hostnames
of private infrastructure, or IP addresses into the file.

**Do not touch the index.** `docs/adr/README.md` and `docs/adr/TEMPLATE.md`
belong to `plans/044`; do not create them, append to them, or reformat them.
The 0052 row is added by 044 when it lands (see "Maintenance notes").

**Verify**:

```bash
ADR=docs/adr/0052-android-client-disposition.md
test -f "$ADR" \
  && grep -c "^## " "$ADR" \
  && grep -c "^## Operator sign-off" "$ADR" \
  && grep -c "au.gov.immi.cases" "$ADR" \
  && grep -qi "deadline" "$ADR" \
  && ! grep -rniE "cfut_|Bearer [A-Za-z0-9_-]{16,}|[0-9]{1,3}(\.[0-9]{1,3}){3}" "$ADR" \
  && git status --short -- docs/adr/README.md docs/adr/TEMPLATE.md \
  && echo ADR-OK
```

→ prints `7` (heading count), then `1`, then a count ≥ 1, then **nothing** from
the `git status` (you did not touch plan 044's files), then `ADR-OK`. The
secrets grep is scoped to your own file — another plan's ADR is not yours to
police, and scanning the whole directory would make your check fail on their
content.

### Step 4: Put a status banner at the top of the client's README

`immi android app/README.md` currently opens at line 1 with
`# IMMI Android App — 完整實作計劃`. Insert a banner **above** that line so it
is the first thing anyone sees. Change nothing else in the file — the Phase 0–11
content stays exactly as it is, including its now-inaccurate Flask references,
because the banner explains them.

Insert exactly this, followed by a blank line, before line 1:

```markdown
> ## ⚠ UNMAINTAINED — not a shipping client
>
> This directory is **not** a maintained client of IMMI-Case and has no CI job.
> The plan below was written on 2026-03-17 against the Flask API; Flask is now
> local-dev-only and production is the Cloudflare Worker
> (`workers/cloudflare-native.js`). Six of the 31 endpoints this client calls
> return 503 in production and never existed on any backend. The client sends
> no `Authorization` header, and its `applicationId` (`au.gov.immi.cases`)
> claims the Australian Government namespace and must be renamed before any
> distribution.
>
> Whether this is archived or adopted is an open decision recorded in
> **`docs/adr/0052-android-client-disposition.md`**. Read that before doing any work
> here. Nothing below this banner has been revised since 2026-03-17.
```

The banner must be a single blockquote so it renders as one visually distinct
block; every line begins with `>` (blank lines inside it are a bare `>`).

**Verify**:

```bash
head -1 "immi android app/README.md" | grep -c "UNMAINTAINED" \
  && head -16 "immi android app/README.md" | grep -c "docs/adr/0052-android-client-disposition.md" \
  && grep -c "^# IMMI Android App" "immi android app/README.md" \
  && git diff --stat -- "immi android app" \
  && echo BANNER-OK
```

→ first `grep -c` prints `1` (the banner is the very first line), second prints
`1`, third prints `1` (the original H1 survives exactly once), the `git diff
--stat` shows **`immi android app/README.md`** and no other file, and
`BANNER-OK` prints.

### Step 5: Stage explicitly, verify the staged set, then commit

The branch already exists (Step 0). Stage the two files **by name** — never
`git add docs/adr`, which would sweep in any sibling agent's untracked ADR
sitting in that shared directory:

```bash
git add "docs/adr/0052-android-client-disposition.md" "immi android app/README.md"
```

**Check what is staged BEFORE committing.** After `git commit` the files leave
the index and a "did I commit the right things?" check becomes far harder to
read — which is why an earlier draft's post-commit audit was the wrong order:

```bash
git diff --cached --name-only
git diff --cached --stat
```

→ `--name-only` lists **exactly** these two paths and nothing else:

```
docs/adr/0052-android-client-disposition.md
immi android app/README.md
```

If a third path appears — especially `docs/adr/README.md` or another plan's
`docs/adr/00NN-*.md` — run `git restore --staged <that path>` and re-check.
`git restore --staged` unstages without touching the file, so it cannot destroy
anyone's work. Do **not** proceed until the staged set is exactly two files.

`--stat` must show only additions to `immi android app/README.md` (the banner)
and a new file for the ADR — no deletions anywhere.

Only then:

```bash
git commit -m "docs: record the Android client's status as an ADR"
```

**Verify**:

```bash
git show --stat --format="%s" HEAD
git log -1 --format=%B | grep -ci "co-authored-by"
```

→ subject line is exactly `docs: record the Android client's status as an ADR`;
the changed-file list contains only `docs/adr/0052-android-client-disposition.md`
and `immi android app/README.md`; the `grep -c` prints `0`.

**Do not push. Do not open a PR.** Stop here and report.

## Test plan

This plan writes no code, so it adds no tests. The Android suite is executed
only as *evidence gathering*, not as a gate on a change:

- `cd "immi android app" && ./gradlew testDebugUnitTest` — 293 tests across 30
  JUnit XML files, expected `failures=0 errors=0 skipped=0` (Step 1).
- A failure here does **not** block this plan. Record it in the ADR's
  `## Evidence` section and continue; a client that no longer passes its own
  tests is a stronger argument for Option A, not a reason to stop.

The Python, frontend, and Worker suites are untouched by this plan and must not
be run or reported on. If you feel the need to run `make test`, re-read Scope —
you have modified something you should not have.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `test -f docs/adr/0052-android-client-disposition.md` exits 0
- [ ] `grep -c "^## " docs/adr/0052-android-client-disposition.md` prints `7`
- [ ] `grep -q "^## Operator sign-off" docs/adr/0052-android-client-disposition.md` exits 0
- [ ] `grep -q "^## Open question" docs/adr/0052-android-client-disposition.md` exits 0
- [ ] `grep -q "au.gov.immi.cases" docs/adr/0052-android-client-disposition.md` exits 0
- [ ] `grep -q "saved-searches" docs/adr/0052-android-client-disposition.md` exits 0
- [ ] `grep -qi "deadline" docs/adr/0052-android-client-disposition.md` exits 0 (the sign-off has an owner, a date and a default outcome — not an open-ended "someone should decide")
- [ ] `git status --short -- docs/adr/README.md docs/adr/TEMPLATE.md` prints nothing (plan 044 owns both; you neither created nor edited them)
- [ ] `! grep -rniE "cfut_|Bearer [A-Za-z0-9_-]{16,}|[0-9]{1,3}(\.[0-9]{1,3}){3}" docs/adr/0052-android-client-disposition.md` exits 0
- [ ] The Step 2a source inventory printed `0` for **all four** phantom paths on **both** the worker and flask sides, using `git grep` (not `grep --include`, which this shell's `ugrep` alias rejects while exiting 0)
- [ ] The ADR labels every production probe as GET-only and states that the `POST`/`DELETE` declarations were verified from source, not probed
- [ ] `head -1 "immi android app/README.md" | grep -q "UNMAINTAINED"` exits 0
- [ ] `grep -c "^# IMMI Android App" "immi android app/README.md"` prints `1`
- [ ] `git ls-files "immi android app" | wc -l | tr -d ' '` prints `167` (no file added or removed)
- [ ] `git ls-files "immi android app" | grep -c '\.kt$'` prints `135`
- [ ] Checked **before** committing: `git diff --cached --name-only` listed exactly `docs/adr/0052-android-client-disposition.md` and `immi android app/README.md`
- [ ] `git show --stat HEAD` lists exactly those two files
- [ ] `git diff --stat 42826a3..HEAD -- "immi android app"` lists **only** `immi android app/README.md`
- [ ] `git log -1 --format=%s` prints `docs: record the Android client's status as an ADR`
- [ ] `git log -1 --format=%B | grep -ci "co-authored-by"` prints `0`
- [ ] Nothing was pushed: `git status -sb | head -1` shows no `[ahead N]` against a remote-tracking branch

## STOP conditions

Stop and report back (do not improvise) if:

- **Any of the four drift-check commands reports an in-scope path** (other than
  `docs/adr/` merely existing). Someone else has touched this territory; the
  endpoint table and file counts in Current state may be stale.
- **`docs/adr/0052-android-client-disposition.md` already exists.** Another
  agent has taken this plan's assigned file. Do not overwrite it and do not
  renumber — report the collision.
- **`docs/adr/README.md` or `docs/adr/TEMPLATE.md` appears in your
  `git status` or `git diff --cached`.** Those belong to `plans/044`. Unstage
  with `git restore --staged <path>` and, if you created them, delete only what
  you created. Never commit them from here.
- **You are about to run `git add docs/adr`** (the directory) rather than the
  single ADR path. That would sweep in a sibling agent's untracked ADR.
- **`git ls-files "immi android app" | wc -l | tr -d ' '` does not print `167`,**
  or the `.kt` count is not `135`. The directory has been added to or pruned since
  planning; the ADR's headline numbers would be wrong.
- **A tracked file under `immi android app/` shows as modified after Step 1.**
  Gradle should write only to gitignored `build/` and `.gradle/`. If it dirtied
  a tracked file, something is generating source into the tree and the ADR's
  "no source changes" premise is broken.
- **You are about to edit a `.kt`, `.kts`, `.xml`, or `.toml` file**, add a CI
  job, touch `Makefile`, touch the root `README.md`/`CLAUDE.md`, or delete/move
  the `immi android app/` directory. All of these are out of scope. If the work
  seems to require one, that is the signal to stop, not to proceed.
- **The Step 2a source inventory contradicts the probes** — e.g. `git grep`
  finds `saved-searches` in `workers/`, or a probe returns 200 for a path the
  source says does not exist. The source is authoritative for routing; a
  disagreement means one of your commands is wrong (check for a `ugrep`
  `--include` warning, or a stale local checkout) or production is running code
  that is not in this tree. Either is worth stopping for.
- **Production probes contradict Step 2b wholesale** — e.g. all six paths
  return 200, or the two controls (`/api/v1/stats`,
  `/api/v1/analytics/success-rate`) return anything other than 200. Either
  production changed materially or you are hitting the wrong host. Report the
  actual codes rather than writing a table you cannot defend.
- **You are tempted to `curl -X POST` or `-X DELETE` against production** to
  settle whether a non-GET route exists. Do not. Those requests have side
  effects — `pipeline/start` would enqueue work, `saved-searches` DELETE would
  destroy data if it existed. The source inventory in Step 2a is the answer.
- **You conclude the client should simply be deleted and start deleting.** The
  archive/adopt decision is the operator's and is explicitly deferred to the
  `## Operator sign-off` line. This plan records the decision; it does not
  execute it.
- **A verification command fails twice** after one reasonable fix attempt.

## Maintenance notes

For the human or agent who owns this after the change lands:

- **The ADR is a decision record, not a decision — and it has a clock.** Its
  `## Status` is `Proposed`. Somebody with authority over product direction
  must fill in `## Operator sign-off`, which names an owner, a deadline, and
  what happens if the deadline passes (default: Option A). Only then does the
  follow-up action happen: Option A means physically moving
  `immi android app/` out of the default checkout (tag the commit first so
  history is recoverable); Option B means working through the entry-price list
  before any feature work, and only if the resume-maintenance conditions in the
  sign-off section have actually become true. If you are the next reader and
  the deadline has passed with no signature, that is itself the finding —
  report it rather than quietly extending it.
- **What a reviewer should scrutinise**: that the ADR's numbers were re-run by
  the executor and dated, not copied from this plan; that the banner is
  literally line 1 of the client README; that the diff contains zero Kotlin.
- **`docs/adr/README.md` is owned by plan 044; add the index row there when 044
  lands.** The row is
  `| [0052](0052-android-client-disposition.md) | Android client disposition | Proposed |`.
  This plan writes no index and no template.
- **Deliberately deferred out of this plan**, with reasons:
  - *A pointer from the root `README.md`.* This is the gap that matters most,
    because the banner only helps someone who already opened
    `immi android app/`. A newcomer reading the root README still sees a
    directory listing with an Android app in it and no signal at all. **Owner:
    whoever lands `plans/043-correct-the-readme.md`** (with
    `plans/042-rewrite-the-agent-facing-docs.md` for `AGENTS.md`/`CLAUDE.md`) —
    they own the root docs, and adding a line here would collide. The ask is
    one line in the repository-layout section:
    `immi android app/ — unmaintained Kotlin client, no CI; see docs/adr/0052-android-client-disposition.md before touching it.`
    Hand it to them explicitly rather than leaving it as a note; a deferred
    item with no named owner is how the directory got unmarked in the first
    place.
  - *An Android CI job.* Only justified if Option B is chosen. Adding it now
    would burn CI minutes validating a client that may be archived — and it
    would fail immediately, because `gradlew` and `gradle-wrapper.jar` are
    gitignored and a CI checkout has neither.
  - *Renaming `applicationId` off `au.gov.*`.* This is genuinely urgent on the
    adopt path but is a code change; the ADR records it as an unconditional
    blocker so it cannot be forgotten. On the archive path it never matters.
  - *Fixing the six phantom endpoints.* Three of them (`saved-searches`) become
    real only if plan 050 ships a server-side store. The other three
    (`search/guided`, `search/taxonomy`, `pipeline/start`) would need to be
    deleted or re-pointed at the Worker's actual paths
    (`taxonomy/guided-search`, `pipeline-action`).
- **What will interact with this**: if plan 050 lands a real
  `/api/v1/saved-searches`, the "6 phantom" count drops to 3 and the ADR should
  be superseded rather than edited (`docs/adr/` is append-only). Note 050 is
  currently a *documents-only* decision plan, so that is not imminent —
  do not write the ADR as though the endpoints are about to exist. When plan
  044 lands, `docs/adr/README.md` and `TEMPLATE.md` will already be there
  holding ADRs 0001–0003; leave them alone and let 044 add the 0052 row.

## Findings reconsidered

Corrections to the audit finding this plan was written from. All four were
verified directly; none changes the conclusion that the directory must be
marked, but each changes what the ADR is allowed to say.

- **"135 never-compiled Kotlin sources" is false.** The client compiles cleanly
  and produces a 22 MB `app-debug.apk`; `./gradlew assembleDebug` printed
  `BUILD SUCCESSFUL in 3m 35s` and `./gradlew testDebugUnitTest` passed
  293/293 (2026-08-28). The real defect is narrower and better stated: `gradlew`
  and `gradle-wrapper.jar` are gitignored, so a *fresh clone* cannot build it,
  and the build that does work depends on a user-global
  `org.gradle.java.home` pointing at Android Studio's JDK 21. "Never-CI'd" is
  correct and unchanged. The plan uses the corrected framing throughout,
  because an ADR that calls working code "never-compiled" would be dismissed by
  the first person who runs the build.
- **"A backend that no longer serves production" overstates it.** 21 of the 31
  declared endpoints are served today (`/api/v1/stats` and
  `/api/v1/analytics/success-rate` both returned 200 on 2026-08-28). The
  precise gap is 6 phantom + 4 gated, which is why Option B is costed as a
  partial rewrite, not a rebuild.
- **The phantom endpoints never existed on Flask either.** The finding implies
  they were lost when production moved off Flask. They were not:
  `saved-searches`, `search/guided`, `search/taxonomy` and `pipeline/start`
  appear in no Flask route decorator under `immi_case_downloader/web/routes/`
  and in no Worker path literal. They were invented from the README's Phase
  plan. This matters — it means those five interface methods were never
  reachable, and no amount of backend archaeology will recover them.
- **"Record it in README §7" points at nothing.** `immi android app/README.md`
  has no §7; its headings are `## Phase 0` … `## Phase 11` followed by three
  Chinese-titled sections, and `## Phase 7` is `工作與管道管理` (jobs and
  pipeline), an implementation phase with no relation to project status. The
  banner therefore goes at line 1, above the H1, where a reader actually looks.

One thing outside the finding, surfaced while verifying it and folded into the
plan because it is a hard blocker on the adopt path:
`immi android app/app/build.gradle.kts:11,15` set both `namespace` and
`applicationId` to `au.gov.immi.cases`. This is a private case browser, not a
government product; distributing under the `au.gov.*` namespace would present
it as official. The ADR records this as an unconditional prerequisite for any
revival. No code change is made here — renaming is out of scope for a spike.
