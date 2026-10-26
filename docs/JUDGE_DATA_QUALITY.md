# Judge Field Data Quality Report

> 本頁保留 2026-05-02 舊 Supabase 環境的事故與復原紀錄，不代表目前資料完整性。最新本機盤點見 [2026-10-27 法官與裁決者辨識狀態](data-repairs/2026-10-27-judge-identification-status.md)；仍有 39 案未能確認，不能宣稱已辨識全部裁決者。

**Date**: 2026-05-02
**Source**: Supabase `public.immigration_cases` (149,016 rows)
**Scope**: `judges` (text) field
**Triggered by**: Roadmap §1 reality-check during autopilot run

---

## ⚠️ POST-MORTEM (added after rollback) — read this first

**What happened (2026-05-02)**:

1. We identified ~10% of `judges` rows as garbage (lowercase prose, `DATE`
   placeholders, sentence fragments captured by a buggy greedy regex).
2. We ran a "client-side batch loop" SQL cleanup that set 14,047 rows'
   `judges` to empty string, on the assumption every match was garbage.
3. **Reality-check via random sampling caught real-name false positives**:
   approximately 10–15% of the cleared rows were legitimate names whose
   formats happened to match a garbage pattern (e.g.
   `Michael Cooke (NSW)` matched the bracket rule;
   `general member cosgrave` matched the lowercase rule).
4. Recovery: full-database PITR rollback to the 2026-05-01 20:03 UTC
   daily snapshot (Supabase Free tier — Dashboard-only restore).
5. Post-restore verification confirmed `distinct(judges) = 14,715`,
   `'DATE' rows = 2,180`, `lowercase rows = 13,855` — all garbage AND
   all real names back to pre-cleanup state.

**Lessons**:

- **A SQL-level cleanup driven by surface-shape patterns is not safe**
  for fields where some legitimate values share the surface shape with
  garbage. The judges field has both: many garbage rows are
  lowercase-prefixed prose, BUT some legitimate names are also
  lowercase-prefixed (`van …`, `el-…`) or contain brackets (`X (NSW)`).
- **Build a backup column first**. We did not — `ALTER TABLE …
  ADD COLUMN judges_backup text; UPDATE … SET judges_backup = judges;`
  would have made a sub-second rollback possible without touching
  unrelated tables.
- **Daily Supabase backups are Dashboard-only on Free tier**. The
  `supabase backups restore` CLI returns 400 "PITR is not enabled" even
  though daily snapshots are listed. Plan for that.
- The greedy-regex extractor fix in `postprocess.py` (commit `cf55863`)
  remains valid — it prevents NEW garbage from being written. It just
  wasn't safe to use the regex's *rejection rules* as a wholesale data
  cleanup signal on data that was already mixed.

**Status of artefacts**:

| Artefact                              | Status               |
|---------------------------------------|----------------------|
| `scripts/clean_judges_garbage.sh`     | **DELETED** — do not re-run, see commit removing it |
| `scripts/reextract_judges.py`         | retained, but `--apply` discouraged until regex covers PRESIDING/General/Senior MEMBER formats AND a backup column exists |
| `postprocess.py` regex + sanity fix   | retained — prevents future garbage capture |
| `tests/test_postprocess_judges.py`    | retained — 36 tests, all passing |
| `docs/JUDGE_DATA_QUALITY.md`          | this file — kept as audit trail |
| Production `judges` field             | restored to pre-cleanup state via PITR |

The remediation steps in §"Recommended fix sequence" below remain
informational — but **only attempt Steps D/E with a backup column
in place and on a sample of <100 rows first**.

---

## TL;DR

The `judges` field has a **regex extraction bug in `postprocess.py:156`**
that causes ~10% of rows to contain sentence-fragment garbage instead
of real judge names. Roadmap §1 ("normalise 14,715 → ~3,000 people")
**cannot succeed** without fixing this first — the dedup target itself
is polluted.

| Headline number               | Value     |
|-------------------------------|----------:|
| Total cases in DB             | 149,016   |
| Distinct `judges` strings     | 14,715    |
| Null / empty `judges`         | 1,931 (1.3%) |
| Multi-judge (comma-separated) | 1,938 (1.3%) |
| Confirmed garbage (lower bound)| **~13,855 (9.3%)** |
| `judge_bios` ground-truth     | 104       |

---

## Garbage signal breakdown

All counts run via `supabase db query --linked` on 2026-05-02.
Patterns overlap (a single bad row may match multiple).

| Pattern                                | Rows    | % of total |
|----------------------------------------|--------:|-----------:|
| `judges = 'DATE'` placeholder          | 2,180   | 1.5%       |
| `LENGTH(judges) > 50` (long fragment)  | 3,004   | 2.0%       |
| Contains "the" / "that" / "which"      | 6,284   | 4.2%       |
| Contains punctuation `– ( [`           | 1,829   | 1.2%       |
| **Starts with lowercase letter**       | 13,855  | **9.3%**   |

### Sample garbage (top 10 by recurrence)

| `judges` value                                      | n   |
|-----------------------------------------------------|----:|
| `OF THE FEDERAL COURT OF AUSTRALIA`                 | 149 |
| `1 October 2001 was substantially to the same effect.)` | 87 |
| `of the same family unit as such a`                 | 46  |
| `to make the order; and`                            | 36  |
| `of a group. The persecution`                       | 35  |
| `of the family`                                     | 35  |
| `it the Department's file, which includes the`      | 34  |
| `OF THE REFUGEE`                                    | 23  |
| `of the family unit`                                | 22  |
| `OF THE REFUGEE REVIEW TRIBUNAL`                    | 20  |

These are clearly **judgment prose fragments**, not judge names.

### Real-name samples (Top 10 by case count)

| `judges` value         | n     |
|------------------------|------:|
| Kira Raif              | 2,403 |
| **DATE** *(garbage)*   | 2,180 |
| Street *(suspected single-surname extraction)* | 1,592 |
| Richard Derewlany      | 1,176 |
| Driver *(suspected single-surname)* | 1,103 |
| Michael Cooke          | 1,084 |
| John Cipolla           | 1,066 |
| Lucinda Wright         | 1,063 |
| Alan Gregory           | 1,043 |
| Lindsay Ford           | 984   |

Note `Street` and `Driver` co-exist with `Justice Street`, `Judge Driver`
elsewhere — the same person under different extraction outcomes.

---

## Root cause

`postprocess.py:156`:

```python
r"(?:Judge\(s\)|JUDGE|MEMBER|JUSTICE|TRIBUNAL MEMBER)[:\s]+([^\n]+)"
```

Three concrete defects:

1. **Greedy `[^\n]+`** — captures everything until newline. If the
   judgment text reads:
   ```
   JUDGES: Smith J. The applicant arrived in Australia on 3 March...
   ```
   the entire trailing prose is captured (then truncated at 200 chars
   by `row["judges"] = match.group(1).strip()[:200]` on line 233).

2. **No word boundary** — `MEMBER` matches inside `MEMBERS`,
   `DISMEMBERED`, `REMEMBER`. Many false positives originate here.

3. **PDF column mis-alignment** — judgment PDFs typically have:
   ```
   JUDGE:        Smith J
   DATE:         15 March 2024
   ```
   When the PDF parser collapses columns, `JUDGE:` butts directly
   against the next label `DATE:`, so the regex captures the literal
   string `DATE` as the judge name. **This is the source of the 2,180-row
   `"DATE"` cluster.**

Only the `[:200]` truncation prevents full paragraphs from being stored.
That's a band-aid, not a fix.

---

## Recommended fix sequence (NOT auto-executed)

These steps **write production data** and are deliberately gated on
explicit user authorisation. Listed in dependency order.

### Step D — patch the regex

Replace `postprocess.py:156` with a constrained, sanity-checked version.
Suggested shape:

```python
JUDGE_LABEL_RE = re.compile(
    r"(?<![A-Za-z])(?:Judge\(s\)|JUDGE|MEMBER|JUSTICE|TRIBUNAL\s+MEMBER)"
    r"\s*[:\-]\s*"
    r"([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,4})"
    r"(?=\s|$|[,.])"
)

def _looks_like_judge_name(s: str) -> bool:
    if not s or len(s) > 60:
        return False
    if s == "DATE" or s.lower() in ("date", "judge", "member"):
        return False
    if not s[0].isupper():
        return False
    if any(stop in s.lower() for stop in (" the ", " that ", " which ", " of the ")):
        return False
    return True
```

Add a unit test fixture covering at least:
- `JUDGES: Smith J` -> `Smith J` (accept)
- `JUDGE: DATE:` -> reject (returns None)
- `JUDGE: of the family unit` -> reject
- `MEMBERS are required to attend` -> reject (boundary)

### Step E — re-extract + backfill

1. Re-run `postprocess.py` against the cached `case_texts/*.txt` corpus
   (no re-scrape needed — original judgment text is local at
   `downloaded_cases/case_texts/`).
2. Diff the output against the current `judges` column. Expect:
   - ~13,855 rows transition from garbage to NULL or corrected name
   - `"DATE"` cluster collapses to NULL (~2,180 rows)
   - Lowercase-start rows drop to near 0
3. Backfill via `migrate_csv_to_supabase.py` (or a dedicated patch
   script that touches only `judges`).
4. Re-run the SQL probes from this report to verify garbage counts
   approach 0.

### Step F — normalisation (Roadmap §1, originally requested)

Only meaningful **after** D + E. Once the field is clean:
1. Top-30 frequency analysis (real judges only)
2. RapidFuzz partial_ratio + Jaro-Winkler clustering
3. Anchor against `judge_bios.full_name` (104 known canonicals)
4. Persist `judge_canonical_id` as new column or mapping table

Estimated **post-cleanup** distinct count: probably 4,000–6,000 actual
judge variants (not 14,715), with ~1,500–2,500 canonical people after
normalisation. Numbers to be re-validated post Step E.

---

## Verification commands (re-runnable)

```bash
# Garbage pattern counts
supabase db query --linked "
SELECT 'DATE' AS pattern, COUNT(*) FROM public.immigration_cases WHERE judges='DATE'
UNION ALL SELECT 'long_50plus', COUNT(*) FROM public.immigration_cases WHERE LENGTH(judges)>50
UNION ALL SELECT 'has_stopwords', COUNT(*) FROM public.immigration_cases
  WHERE judges ILIKE '% the %' OR judges ILIKE '% that %' OR judges ILIKE '% which %'
UNION ALL SELECT 'starts_lowercase', COUNT(*) FROM public.immigration_cases
  WHERE judges ~ '^[a-z]'"

# Top-30 frequency
supabase db query --linked "
SELECT judges, COUNT(*) AS n FROM public.immigration_cases
WHERE judges IS NOT NULL AND TRIM(judges)<>'' AND judges NOT LIKE '%,%'
GROUP BY judges ORDER BY n DESC LIMIT 30"

# Sample garbage
supabase db query --linked "
SELECT judges, COUNT(*) AS n FROM public.immigration_cases
WHERE LENGTH(judges)>50 OR judges ILIKE '% the %'
GROUP BY judges ORDER BY n DESC LIMIT 20"
```

---

## Decision required

This report is the autopilot deliverable for scope **A + B + C**.
Scopes **D, E, F** modify production data and are deferred until the
project owner authorises the cleanup. To proceed, reply with one of:

- **D only** — patch the regex + add unit tests (no DB write yet)
- **D + E** — patch + re-extract + backfill Supabase (visible product impact)
- **D + E + F** — full cleanup + normalisation (original Roadmap §1 intent)
- **Defer** — leave as-is, raise as GitHub issue, focus elsewhere

---

## Update — D + E + F partial completion (2026-05-02)

User authorised **D + E + F**. Executed via autopilot:

### D — applied
- `postprocess.py:156` regex tightened (label-after-colon shape, ≤5 capitalised tokens, optional ` J` suffix)
- `_looks_like_judge_name()` sanity-check helper added to reject lowercase, length>60, prose stopwords, bracket/dash chars, bad tokens (`DATE`, `JUDGE`, `MEMBER`)
- 33 unit + integration tests in `tests/test_postprocess_judges.py` — all pass in 0.81s
- Commit: `fix(extractor): add sanity check to judges field regex + 33 unit tests`

### E phase 1 — applied (partial)
SQL `UPDATE … SET judges = ''` (NOT NULL forces empty string, not NULL):

| Pattern                  | Cleared | Remaining | Status |
|--------------------------|--------:|----------:|--------|
| `judges = 'DATE'`        | 2,180   | 0         | ✅ done |
| `LENGTH(judges) > 60`    | 1,499   | 0         | ✅ done |
| `[(\[–—]` brackets/dash  | ~194    | 1,635     | ⚠️ partial — Supabase statement_timeout |
| stopwords `the/that/which/of the` | partial | (subset of lowercase) | ⚠️ partial |
| `^[a-z]` lowercase start | ~1,287  | 12,568    | ⚠️ partial |

Distinct `judges` strings: **14,715 → 13,296** (−1,419 dups collapsed).
Empty rows: **1,931 → 5,610** (+3,679 cleared).

**Why partial**: large regex UPDATE on 149K rows hits Supabase
`statement_timeout`. Future passes need a client-side loop:

```sql
WITH ids AS (
  SELECT case_id FROM public.immigration_cases
  WHERE judges ~ '^[a-z]' LIMIT 1000
)
UPDATE public.immigration_cases SET judges = ''
WHERE case_id IN (SELECT case_id FROM ids);
```

…wrapped in a `repeat-until-zero` Python/bash loop. Estimated 14K rows
in batches of 1,000 = 14 round-trips, ~5 minutes. Deferred to follow-up.

### F — module pre-existed, validated
`immi_case_downloader/normalize_judge_names.py` (190 lines) and
`tests/test_judge_normalization.py` (16 tests) already existed in the
repo but were never wired into any production pipeline. Tests pass
under Python 3.14 with `--noconftest` (16 passed). Wiring into
extraction / analytics requires a dedicated session — not done here.

### What is NOT done

- Re-extract over 142,966 local `case_texts/*.txt` files (E phase 2)
- Loop-clear remaining ~14,047 garbage rows (E phase 1 continuation)
- Wire `normalize_judge_names` into the **Cloudflare Worker** judge
  analytics handlers (`workers/proxy.js`: `handleAnalyticsJudges`,
  `handleAnalyticsJudgeProfile`, `handleAnalyticsJudgeLeaderboard`,
  `handleAnalyticsJudgeCompare`, `handleAnalyticsJudgeBio`) — these
  are the production read path, not Flask. Persist `judge_canonical_id`
  via Supabase migration. (F production integration)

These are the high-blast-radius pieces and should be a separate
focused session with its own gate review.
