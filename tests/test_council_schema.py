"""US-001 — Phase 0 schema migration verification tests.

Tests two layers:

1. **SQL file shape** — parses supabase/migrations/20260428_council_sessions.sql
   and asserts every required clause is present (PRIMARY KEY, FK ON DELETE
   CASCADE, CHECK constraints, UNIQUE, indexes). Runs offline; no DB needed.

2. **Live CRUD** — uses supabase-py with SUPABASE_SERVICE_ROLE_KEY to
   INSERT a test session + turn, SELECT them back, DELETE the session, and
   verify CASCADE drops the turn. Skipped automatically when the tables do
   not yet exist (e.g. before migration is applied to the live database).

Test integrity (per .omc/plans/llm-council-worker-migration.md §4):
  Every assertion below has been verified red-green by the implementer.
  Any change that flips the assertion's expected value must trigger a fresh
  red-green cycle before commit.
"""
from __future__ import annotations

import os
import re
import secrets
from pathlib import Path

import pytest
from dotenv import load_dotenv

load_dotenv()

MIGRATION_PATH = (
    Path(__file__).resolve().parent.parent
    / "supabase"
    / "migrations"
    / "20260428_council_sessions.sql"
)


# ── Layer 1: SQL file shape (offline) ────────────────────────────────────


@pytest.fixture(scope="module")
def migration_sql() -> str:
    assert MIGRATION_PATH.exists(), (
        f"Migration file missing at {MIGRATION_PATH} — US-001 not started"
    )
    return MIGRATION_PATH.read_text()


def test_migration_creates_council_sessions_table(migration_sql: str) -> None:
    assert re.search(
        r"CREATE\s+TABLE\s+council_sessions",
        migration_sql,
        re.IGNORECASE,
    ), "council_sessions CREATE TABLE statement missing"


def test_migration_creates_council_turns_table(migration_sql: str) -> None:
    assert re.search(
        r"CREATE\s+TABLE\s+council_turns",
        migration_sql,
        re.IGNORECASE,
    ), "council_turns CREATE TABLE statement missing"


def test_council_sessions_has_status_check_constraint(migration_sql: str) -> None:
    # Must enumerate exactly the 3 valid statuses; reviewer can flip any
    # to verify the test catches drift.
    assert re.search(
        r"CHECK\s*\(\s*status\s+IN\s*\(\s*'active'\s*,\s*'complete'\s*,\s*'abandoned'",
        migration_sql,
        re.IGNORECASE,
    ), "status enum CHECK constraint missing or wrong values"


def test_council_sessions_caps_total_turns_at_15(migration_sql: str) -> None:
    assert re.search(
        r"CHECK\s*\(\s*total_turns\s*>=\s*0\s+AND\s+total_turns\s*<=\s*15",
        migration_sql,
        re.IGNORECASE,
    ), "total_turns 0-15 CHECK constraint missing"


def test_council_turns_caps_turn_index_below_15(migration_sql: str) -> None:
    assert re.search(
        r"CHECK\s*\(\s*turn_index\s*>=\s*0\s+AND\s+turn_index\s*<\s*15",
        migration_sql,
        re.IGNORECASE,
    ), "turn_index 0..<15 CHECK constraint missing"


def test_council_turns_cascades_on_session_delete(migration_sql: str) -> None:
    assert re.search(
        r"REFERENCES\s+council_sessions\s*\(\s*session_id\s*\)\s+ON\s+DELETE\s+CASCADE",
        migration_sql,
        re.IGNORECASE,
    ), "council_turns FK ON DELETE CASCADE missing"


def test_council_turns_unique_session_turn_index(migration_sql: str) -> None:
    assert re.search(
        r"UNIQUE\s*\(\s*session_id\s*,\s*turn_index\s*\)",
        migration_sql,
        re.IGNORECASE,
    ), "UNIQUE (session_id, turn_index) missing — race-safety relies on it"


def test_migration_creates_required_indexes(migration_sql: str) -> None:
    assert re.search(
        r"CREATE\s+INDEX\s+idx_council_turns_session\s+ON\s+council_turns",
        migration_sql,
        re.IGNORECASE,
    ), "idx_council_turns_session missing"
    assert re.search(
        r"CREATE\s+INDEX\s+idx_council_sessions_updated\s+ON\s+council_sessions",
        migration_sql,
        re.IGNORECASE,
    ), "idx_council_sessions_updated missing"


# ── Layer 2: live CRUD (skipped until migration applied) ────────────────


def _supabase_client():
    """Return a supabase-py client; skip if creds missing."""
    if os.environ.get("IMMI_LIVE_SUPABASE_TESTS") != "1":
        pytest.skip("Remote schema writes require explicit IMMI_LIVE_SUPABASE_TESTS=1")
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        pytest.skip("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set")
    try:
        from supabase import create_client
    except ImportError:
        pytest.skip("supabase-py not installed")
    return create_client(url, key)


def _tables_exist(client) -> bool:
    """Probe whether council_sessions exists by attempting a tiny SELECT."""
    try:
        client.table("council_sessions").select("session_id").limit(1).execute()
        return True
    except Exception:
        return False


@pytest.fixture
def live_client():
    client = _supabase_client()
    if not _tables_exist(client):
        pytest.skip(
            "council_sessions table not found — apply migration first "
            "(see supabase/migrations/20260428_council_sessions.sql)"
        )
    return client


@pytest.fixture
def cleanup_session_id():
    """Yield a unique test session_id; tear it down even if test fails."""
    sid = f"pytest-{secrets.token_hex(6)}"
    yield sid
    # Best-effort cleanup — don't fail the test if cleanup errors
    try:
        client = _supabase_client()
        client.table("council_sessions").delete().eq("session_id", sid).execute()
    except Exception:
        pass


def test_live_insert_session_round_trip(live_client, cleanup_session_id) -> None:
    """INSERT a session, SELECT it back, assert every field round-trips."""
    sid = cleanup_session_id
    payload = {
        "session_id": sid,
        "case_id": "abcdef012345",
        "title": "Test session — schema integration",
        "status": "active",
        "total_turns": 0,
        "hmac_sig": "test-hmac-signature-base64url",
    }
    insert_resp = live_client.table("council_sessions").insert(payload).execute()
    assert len(insert_resp.data) == 1, "insert should return exactly 1 row"

    sel = (
        live_client.table("council_sessions")
        .select("*")
        .eq("session_id", sid)
        .execute()
    )
    assert len(sel.data) == 1, f"expected 1 session with id {sid}, found {len(sel.data)}"
    row = sel.data[0]
    assert row["session_id"] == sid
    assert row["case_id"] == "abcdef012345"
    assert row["title"] == "Test session — schema integration"
    assert row["status"] == "active"
    assert row["total_turns"] == 0  # red-green checkpoint: flip to 1 to confirm test fails
    assert row["hmac_sig"] == "test-hmac-signature-base64url"


def test_live_turn_cascade_on_session_delete(live_client, cleanup_session_id) -> None:
    """INSERT session + turn, DELETE session, verify turn is gone via CASCADE."""
    sid = cleanup_session_id
    live_client.table("council_sessions").insert({
        "session_id": sid,
        "title": "Cascade test",
        "status": "active",
        "total_turns": 1,
        "hmac_sig": "x",
    }).execute()

    turn_id = f"pytest-turn-{secrets.token_hex(6)}"
    turn_payload = {
        "turn_id": turn_id,
        "session_id": sid,
        "turn_index": 0,
        "user_message": "What are jurisdictional review grounds?",
        "user_case_context": None,
        "payload": {"opinions": [], "moderator": {"composed_answer": "stub"}},
        "retrieved_cases": None,
        "total_tokens": 100,
        "total_latency_ms": 5000,
    }
    live_client.table("council_turns").insert(turn_payload).execute()

    # Confirm turn is there
    pre = (
        live_client.table("council_turns")
        .select("turn_id")
        .eq("turn_id", turn_id)
        .execute()
    )
    assert len(pre.data) == 1, "turn should exist after insert"

    # Delete session — CASCADE should kill the turn
    live_client.table("council_sessions").delete().eq("session_id", sid).execute()

    post = (
        live_client.table("council_turns")
        .select("turn_id")
        .eq("turn_id", turn_id)
        .execute()
    )
    assert len(post.data) == 0, (
        "CASCADE should have deleted the turn when its parent session was deleted; "
        f"found {len(post.data)} rows"
    )


def test_live_unique_session_turn_index_rejects_duplicate(
    live_client, cleanup_session_id
) -> None:
    """UNIQUE (session_id, turn_index) must reject a 2nd insert at same index."""
    sid = cleanup_session_id
    live_client.table("council_sessions").insert({
        "session_id": sid,
        "title": "Unique constraint test",
        "status": "active",
        "total_turns": 1,
        "hmac_sig": "x",
    }).execute()

    turn_a = {
        "turn_id": f"pytest-turn-{secrets.token_hex(6)}",
        "session_id": sid,
        "turn_index": 0,
        "user_message": "first",
        "payload": {},
    }
    turn_b = {
        "turn_id": f"pytest-turn-{secrets.token_hex(6)}",
        "session_id": sid,
        "turn_index": 0,  # SAME index — must be rejected
        "user_message": "duplicate index",
        "payload": {},
    }
    live_client.table("council_turns").insert(turn_a).execute()

    with pytest.raises(Exception) as exc_info:
        live_client.table("council_turns").insert(turn_b).execute()
    msg = str(exc_info.value).lower()
    # Postgres returns 23505 unique_violation; supabase-py wraps it; assert
    # the message mentions the constraint or duplicate key.
    assert (
        "duplicate" in msg or "unique" in msg or "23505" in msg
    ), f"expected unique-constraint violation; got: {exc_info.value!r}"
