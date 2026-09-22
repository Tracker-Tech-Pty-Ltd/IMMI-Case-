"""Execute the captured statements against a real SQLite DB with the real schema.

Mocks cannot catch CHECK-constraint violations, UPSERT syntax errors, duplicate
keys, or the mid-rebuild race this change exists to fix; this harness runs the
exact SQL the Worker issues and simulates the race deterministically.
"""
import json
import os
import subprocess
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

# Portable: the repo root is wherever this file lives, never a hardcoded volume.
REPO = Path(__file__).resolve().parents[2]

# The SQL under test must be CAPTURED FROM THE CURRENT WORKER SOURCE, in the same
# run that verifies it. A committed capture file can be stale, which would let a
# regression pass: remove the two budget keys from the live keep-list, leave the
# old JSON in place, and the verifier would replay the old good SQL. So: capture
# fresh into a temp file unless an explicit path is given.
# Always capture from the live source: an option to replay a pre-existing capture
# file would let a keep-list regression pass (delta-3 review). There is no escape.
handle, name = tempfile.mkstemp(suffix="-rebuild-statements.json")
os.close(handle)
capture_path = Path(name)
env = dict(os.environ, CAPTURE_OUT=str(capture_path))
subprocess.run(["node", "scripts/sql-harness/capture-statements.mjs"], cwd=REPO, env=env, check=True,
               stdout=subprocess.DEVNULL)

captured = json.loads(capture_path.read_text())
if isinstance(captured, dict):
    statements = captured["statements"]
    captured_at = int(captured.get("captured_at") or time.time())
else:  # tolerate the older bare-list format
    statements = captured
    captured_at = int(time.time())
print(f"  statements captured fresh from source: {len(statements)} (captured_at={captured_at})")
schema = (REPO / "migrations/d1/catalog/0001_catalog.sql").read_text()

connection = sqlite3.connect(":memory:")
skipped = []
try:
    connection.executescript(schema)
except sqlite3.OperationalError as error:
    skipped.append(("schema", str(error)))
connection.commit()
tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
missing = [name for name in ("cases", "case_concepts", "case_judges", "judges", "concepts", "catalog_summary",
                             "filter_options", "aggregate_concept_pair", "aggregate_concept_scope")
           if name not in tables]
print(f"  schema tables: {len(tables)} | missing: {missing}")

SHA = "a" * 64
CASE_COLUMNS = ("case_id, title, citation, court_code, year, outcome, visa_subclass, visa_type, "
                "case_nature, country_of_origin, source, content_key, content_sha256, content_size, "
                "created_at, updated_at")
def case_row(case_id, court_code, year, outcome, visa_subclass, nature, country, source, content_key):
    values = (f"'{case_id}','Case {case_id[:4]}','[{year}] {court_code} 1','{court_code}',{year},"
              f"'{outcome}','{visa_subclass}','skilled','{nature}','{country}','{source}',"
              f"'{content_key}','{SHA}',10,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'")
    return f"INSERT INTO cases ({CASE_COLUMNS}) VALUES ({values})"

SEED = [
    case_row("aaaaaaaaaaaa", "FCA", 2026, "Affirmed", "482", "review", "India", "austlii", "cases/aaaa.txt"),
    case_row("bbbbbbbbbbbb", "FCA", 2025, "Dismissed", "500", "review", "China", "austlii", ""),
    case_row("cccccccccccc", "HCA", 2025, "Affirmed", "482", "appeal", "India", "hca", "cases/cccc.txt"),
    "INSERT INTO concepts (concept_id, label) VALUES ('c1','procedural fairness'),('c2','jurisdictional error')",
    "INSERT INTO case_concepts (case_id, concept_id) VALUES ('aaaaaaaaaaaa','c1'),('aaaaaaaaaaaa','c2'),('bbbbbbbbbbbb','c1')",
    "INSERT INTO judges (judge_id, canonical_name, created_at, updated_at) VALUES ('j1','Justice Example','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
    "INSERT INTO case_judges (case_id, judge_id) VALUES ('aaaaaaaaaaaa','j1'),('bbbbbbbbbbbb','j1')",
]
for statement in SEED:
    connection.execute(statement)
connection.commit()

failures = []
def check(label, condition, detail=""):
    if condition:
        print(f"  ok   {label}")
    else:
        text = f"{label} :: {detail}"
        print(f"  FAIL {text}")
        failures.append(text)

def summary() -> dict:
    return dict(connection.execute("SELECT summary_key, value_int FROM catalog_summary").fetchall())

def bookkeeping_params(statement: dict, observed: int) -> list:
    """Bind the runtime-observed generation into the capture-time bookkeeping SQL.

    The Worker reads the generation at the start of every rebuild, so the two
    statements that consume it (the applied-generation row and the conditional
    disarm) must be replayed with the value the harness observed.
    """
    params = list(statement["params"])
    if statement["sql"].startswith("INSERT OR REPLACE") and "'rebuild_applied_generation'" in statement["sql"]:
        params[0] = observed
    elif statement["sql"].startswith("UPDATE catalog_summary"):
        params[-1] = observed
    return params

rebuild = [s for s in statements if s["phase"] == "init"
           and (s["sql"].startswith(("DELETE FROM", "INSERT INTO", "INSERT OR REPLACE"))
                or s["sql"].startswith("UPDATE catalog_summary"))]
bookkeeping = [s for s in rebuild if "catalog_summary" in s["sql"] and not s["sql"].startswith("SELECT")]
aggregate_work = [s for s in rebuild if "catalog_summary" not in s["sql"]]
# 45 = attempt-start disarm + state read + 17 DELETE + 17 INSERT..SELECT
#      + 7 filter_options + 3 end-of-run bookkeeping statements.
assert len(rebuild) == 45, f"expected 45 rebuild statements, captured {len(rebuild)}"

check("the attempt-start disarm is the rebuild's first statement",
      rebuild[0]["sql"].startswith("INSERT OR REPLACE")
      and "'rebuild_dirty_since', 0" in rebuild[0]["sql"], rebuild[0]["sql"][:80])

# 1. Happy path: the whole rebuild runs against the real schema. The staleness
#    clock starts armed so the conditional disarm is actually exercised.
connection.execute(
    "INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at) VALUES ('rebuild_dirty_since', 12345, 'seed')"
)
connection.commit()
for statement in rebuild:
    connection.execute(statement["sql"], statement["params"])
connection.commit()
state = summary()
check("rebuild writes total_cases", state.get("total_cases") == 3, state)
check("rebuild writes with_full_text", state.get("with_full_text") == 2, state)
check("rebuild stamps last rebuild time", abs(state.get("rebuild_last_at", 0) - captured_at) < 120, state)
check("rebuild applies the generation it observed",
      state.get("rebuild_applied_generation") == state.get("rebuild_generation", 0), state)

counts = {
    "aggregate_court_year_outcome": connection.execute("SELECT COUNT(*) FROM aggregate_court_year_outcome").fetchone()[0],
    "aggregate_visa": connection.execute("SELECT COUNT(*) FROM aggregate_visa").fetchone()[0],
    "aggregate_concept_pair": connection.execute("SELECT COUNT(*) FROM aggregate_concept_pair").fetchone()[0],
    "filter_options": connection.execute("SELECT COUNT(*) FROM filter_options").fetchone()[0],
}
check("aggregates are populated", all(v > 0 for v in counts.values()), counts)
check("bookkeeping rows exist after the rebuild",
      {"rebuild_applied_generation", "rebuild_last_at"} <= set(state), list(state))
check("a clean rebuild disarms the staleness clock",
      state.get("rebuild_dirty_since") == 0, state.get("rebuild_dirty_since"))

# 2. The race the boolean flag could not express: a mutation lands after the
#    aggregate scan but before the bookkeeping write.
connection.execute("DELETE FROM catalog_summary WHERE summary_key NOT IN ('rebuild_generation','rebuild_applied_generation','rebuild_last_at','rebuild_lease_until')")
connection.execute("INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at) VALUES ('rebuild_generation', 5, 'seed')")
connection.execute("INSERT OR REPLACE INTO catalog_summary (summary_key, value_int, updated_at) VALUES ('rebuild_applied_generation', 4, 'seed')")
connection.commit()

# The Worker re-reads the generation at the start of every rebuild, so bind the
# runtime-observed value here rather than the capture-time parameter.
observed = connection.execute(
    "SELECT COALESCE((SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'), 0)"
).fetchone()[0]
assert observed == 5, observed
for statement in aggregate_work:
    connection.execute(statement["sql"], statement["params"])
dirty = [s for s in statements if s["phase"] == "mark_dirty"]
for statement in dirty:                                    # ← mutation mid-rebuild
    connection.execute(statement["sql"], statement["params"])
armed = connection.execute(
    "SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'"
).fetchone()
check("a mutation arms the staleness clock", bool(armed) and armed[0] > 0, armed)
for statement in bookkeeping:
    connection.execute(statement["sql"], bookkeeping_params(statement, observed))
connection.commit()

state = summary()
check("mid-rebuild mutation stays pending",
      state.get("rebuild_generation", 0) > state.get("rebuild_applied_generation", 0), state)
check("applied generation equals the pre-scan snapshot", state.get("rebuild_applied_generation") == 5, state)
# The disarm must be unconditional: an armed clock makes the staleness bound fire
# on every queue batch (the 2026-08 cost curve). Pending work is tracked by the
# generation, so disarming cannot lose it.
check("every rebuild disarms the staleness clock, even with a mid-scan mutation",
      state.get("rebuild_dirty_since", -1) == 0, state.get("rebuild_dirty_since"))

decision_sql = [s for s in statements if s["phase"] == "decision"][0]
rows = {row[0]: row[1] for row in connection.execute(decision_sql["sql"], decision_sql["params"]).fetchall()}
check("decision query sees the pending generation",
      rows.get("rebuild_generation", 0) > rows.get("rebuild_applied_generation", 0), rows)

# 3. Lease semantics under real SQLite: the conditional upsert must only win
#    when the held lease has expired.
lease_claim = [s for s in statements if s["phase"] == "lease_claim"]
claim = lease_claim[0]
token_write = next((s for s in lease_claim if "rebuild_lease_token" in s["sql"]), None)
attempt_write = next(s for s in lease_claim if "'rebuild_last_attempt_at'" in s["sql"])
check("claim writes expiry and token in one statement",
      token_write is None and len(claim["params"]) == 3, [s["sql"][:40] for s in lease_claim])
renew = [s for s in statements if s["phase"] == "lease_renew"][0]
release = [s for s in statements if s["phase"] == "lease_release"][0]
release_sql, release_params = release["sql"], release["params"]

connection.execute("UPDATE catalog_summary SET value_int = 0 WHERE summary_key = 'rebuild_lease_until'")
connection.commit()
cursor = connection.execute(claim["sql"], claim["params"])
held_until = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_until'").fetchone()[0]
check("lease claim wins when free", cursor.rowcount > 0 and held_until > int(time.time()), held_until)

cursor = connection.execute(claim["sql"], claim["params"])
check("second claim loses while the lease holds", cursor.rowcount == 0, cursor.rowcount)

# The attempt stamp is the only follow-up write; the token lives on the lease row.
connection.execute(attempt_write["sql"], attempt_write["params"])
connection.commit()
token, held_updated_at = connection.execute(
    "SELECT value_int, updated_at FROM catalog_summary WHERE summary_key = 'rebuild_lease_until' AND updated_at = ?",
    [claim["params"][1]],
).fetchone() or (None, None)
check("lease row carries the fencing token", token is not None and held_updated_at == claim["params"][1], held_updated_at)
attempt = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_last_attempt_at'").fetchone()[0]
check("claim stamps the attempt time", attempt <= int(time.time()), attempt)

# Renewal: wins with the owner token, loses with anyone else's.
owner_token = claim["params"][1]
cursor = connection.execute(renew["sql"], [int(time.time()) + 600, owner_token, owner_token])
check("renew wins for the owner token", cursor.rowcount > 0, cursor.rowcount)
cursor = connection.execute(renew["sql"], [int(time.time()) + 600, "stale-token", "stale-token"])
check("renew loses for a stale token", cursor.rowcount == 0, cursor.rowcount)

# Release: a stale owner must NOT be able to free the current lease.
cursor = connection.execute(release_sql, [release_params[0], "stale-token"])
still_held = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_until'").fetchone()[0]
check("stale release cannot free someone else's lease", cursor.rowcount == 0 and still_held > int(time.time()), (cursor.rowcount, still_held))

cursor = connection.execute(release_sql, [release_params[0], owner_token])
released = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_lease_until'").fetchone()[0]
check("owner release frees the lease", cursor.rowcount > 0 and released == 0, (cursor.rowcount, released))

connection.execute("UPDATE catalog_summary SET value_int = 1 WHERE summary_key = 'rebuild_lease_until'")
connection.commit()
cursor = connection.execute(claim["sql"], claim["params"])
check("claim wins again after expiry", cursor.rowcount > 0, cursor.rowcount)

# 4. Dirty upsert stays a single row and keeps other summaries intact.
mark_dirty = [s for s in statements if s["phase"] == "mark_dirty"]
generation_write = mark_dirty[0]
mutation_write = next(s for s in mark_dirty if "rebuild_last_mutation_at" in s["sql"])
dirty_since_write = next(s for s in mark_dirty if "rebuild_dirty_since" in s["sql"])
for statement in (generation_write, mutation_write, dirty_since_write):
    connection.execute(statement["sql"], statement["params"])
connection.execute(mutation_write["sql"], mutation_write["params"])
first_arm = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
connection.execute(mutation_write["sql"], mutation_write["params"])
second_arm = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
check("staleness clock arms on the first mutation only", first_arm == second_arm and first_arm > 0, (first_arm, second_arm))
last_mutation = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_last_mutation_at'").fetchone()[0]
check("mutation timestamp is refreshed", abs(last_mutation - captured_at) < 120,
      (last_mutation, captured_at))
# The disarm is unconditional (statement captured from rebuildAggregates():
# `UPDATE catalog_summary SET value_int = 0 ... WHERE summary_key =
# 'rebuild_dirty_since'` with no generation guard) — the attempt-start disarm
# runs first, and the end-of-run disarm clears it again. See the checks above.
observed_now = connection.execute(
    "SELECT COALESCE((SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_generation'), 0)"
).fetchone()[0]
for statement in bookkeeping:
    connection.execute(statement["sql"], bookkeeping_params(statement, observed_now))
connection.commit()
reset = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_dirty_since'").fetchone()[0]
check("rebuild with nothing new disarms the staleness clock", reset == 0, reset)

for _ in range(3):
    connection.execute(generation_write["sql"], generation_write["params"])
connection.commit()
check("generation upsert stays a single row",
      connection.execute("SELECT COUNT(*) FROM catalog_summary WHERE summary_key = 'rebuild_generation'").fetchone()[0] == 1)
check("dirty writes do not clobber other summaries",
      connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'total_cases'").fetchone()[0] == 3)


# 5. The daily rebuild budget must survive the rebuild's own DELETE, and the next
#    consumption of the same UTC day must count 2 - not restart at 1. (Regression
#    from the 2026-09-22 delta review: the counter rows were absent from the
#    rebuild's bookkeeping keep-list, so every completed rebuild wiped the count
#    and the "absolute" cap was defeated by the code it guards.)
budget = [s for s in statements if s["phase"] == "consume_budget"]
counter_stmt = next((s for s in budget if "rebuild_count_today" in s["sql"]), None)
day_stmt = next((s for s in budget if s["sql"].count("rebuild_day") and "rebuild_count_today" not in s["sql"]), None)
check("capture includes the budget counter + day statements", counter_stmt is not None and day_stmt is not None,
      [s["sql"][:60] for s in budget])
if counter_stmt and day_stmt:
    connection.execute(counter_stmt["sql"], counter_stmt["params"])
    connection.execute(day_stmt["sql"], day_stmt["params"])
    connection.commit()
    first = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_count_today'").fetchone()
    check("first budget consumption of the day counts 1", bool(first) and first[0] == 1, first)
    # The rebuild now runs, including its DELETE FROM catalog_summary ... NOT IN (keep-list).
    for statement in bookkeeping:
        connection.execute(statement["sql"], bookkeeping_params(statement, observed_now))
    connection.commit()
    survived = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_count_today'").fetchone()
    check("the rebuild's DELETE preserves the daily counter", bool(survived) and survived[0] == 1, survived)
    check("the rebuild's DELETE preserves the budget day",
          connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_day'").fetchone() is not None)
    connection.execute(counter_stmt["sql"], counter_stmt["params"])
    connection.commit()
    after = connection.execute("SELECT value_int FROM catalog_summary WHERE summary_key = 'rebuild_count_today'").fetchone()
    check("consumption after a completed rebuild increments to 2 (not restarting at 1)",
          bool(after) and after[0] == 2, after)

print()
if skipped:
    print("skipped schema statements:", [s[0] for s in skipped])
print(json.dumps({"failures": failures, "state": state, "aggregate_counts": counts, "decision_rows": rows},
                 default=str, indent=1))
sys.exit(1 if failures else 0)
