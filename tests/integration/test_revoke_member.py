"""AC8: Revoked tenant member returns 403 on next write.

Usage:
    pytest tests/integration/test_revoke_member.py -v

Required env vars:
    SUPABASE_DB_URL      psql-compatible connection string (service-role)
    JWT_SECRET_CURRENT   HS256 signing key (same as Worker wrangler secret)
    JWT_KID_CURRENT      key ID for the JWT header
    FLASK_BASE_URL       e.g. https://immi.trackit.today or http://localhost:8080

Dependencies:
    pip install psycopg2-binary PyJWT requests pytest
"""

import os
import time
import uuid

import jwt
import psycopg2
import pytest
import requests

# ── Config from environment ───────────────────────────────────────────────────

DB_URL = os.environ["SUPABASE_DB_URL"]
JWT_SECRET = os.environ["JWT_SECRET_CURRENT"]
JWT_KID = os.environ.get("JWT_KID_CURRENT", "k1")
BASE_URL = os.environ.get("FLASK_BASE_URL", "https://immi.trackit.today").rstrip("/")

# Unique per process to avoid collision on concurrent CI runs
TELEGRAM_ID = 9_900_000_000 + (os.getpid() % 100_000)
FIRST_NAME = "_autotest_revoke"
TENANT_NAME = "_autotest_revoke_tenant"

# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="function")
def db_conn():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    # Pre-clean: remove any orphan rows from crashed prior runs with same TELEGRAM_ID
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM collections WHERE tenant_id IN "
        "(SELECT id FROM tenants WHERE name = %s)",
        (TENANT_NAME,),
    )
    cur.execute("DELETE FROM tenant_members WHERE tenant_id IN "
        "(SELECT id FROM tenants WHERE name = %s)", (TENANT_NAME,))
    cur.execute("DELETE FROM tenants WHERE name = %s", (TENANT_NAME,))
    cur.execute("DELETE FROM users WHERE telegram_id = %s", (TELEGRAM_ID,))
    yield conn
    conn.close()


# ── Helpers ───────────────────────────────────────────────────────────────────


def _sign_jwt(user_id: str, tenant_id: str) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "tenant_id": tenant_id,
        "tenants": [tenant_id],
        "role": "owner",
        "iat": now,
        "exp": now + 300,
    }
    return jwt.encode(
        payload,
        JWT_SECRET,
        algorithm="HS256",
        headers={"kid": JWT_KID},
    )


def _post_collection(token: str, name: str) -> requests.Response:
    return requests.post(
        f"{BASE_URL}/api/v1/collections",
        json={"name": name},
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )


# ── Test ──────────────────────────────────────────────────────────────────────


def test_revoked_member_returns_403(db_conn):
    user_id = None
    tenant_id = None
    collection_id = None

    try:
        cur = db_conn.cursor()

        # ── 1. Insert test user ───────────────────────────────────────────────
        cur.execute(
            """
            INSERT INTO users (telegram_id, first_name, last_login_at)
            VALUES (%s, %s, NOW())
            RETURNING id
            """,
            (TELEGRAM_ID, FIRST_NAME),
        )
        user_id = str(cur.fetchone()[0])

        # ── 2. Insert test tenant ─────────────────────────────────────────────
        cur.execute(
            """
            INSERT INTO tenants (kind, name)
            VALUES ('individual', %s)
            RETURNING id
            """,
            (TENANT_NAME,),
        )
        tenant_id = str(cur.fetchone()[0])

        # ── 3. Add user as owner ──────────────────────────────────────────────
        cur.execute(
            """
            INSERT INTO tenant_members (user_id, tenant_id, role)
            VALUES (%s, %s, 'owner')
            """,
            (user_id, tenant_id),
        )

        # ── 4. Sign JWT and POST collection → expect 201 ──────────────────────
        token = _sign_jwt(user_id, tenant_id)
        col_name = f"_autotest_revoke_col_{uuid.uuid4().hex[:8]}"
        resp = _post_collection(token, col_name)

        assert resp.status_code == 201, (
            f"AC8 PRE-REVOKE FAIL: expected 201, got {resp.status_code}. "
            f"Body: {resp.text[:300]}"
        )
        collection_id = resp.json().get("id")

        # ── 5. Revoke membership ──────────────────────────────────────────────
        cur.execute(
            "DELETE FROM tenant_members WHERE user_id = %s AND tenant_id = %s",
            (user_id, tenant_id),
        )

        # ── 6. POST again with the SAME JWT → expect 403 ─────────────────────
        # Flask re-validates tenant membership on every write (instant revocation).
        resp2 = _post_collection(token, col_name + "_2")

        assert resp2.status_code == 403, (
            f"AC8 POST-REVOKE FAIL: expected 403, got {resp2.status_code}. "
            f"Body: {resp2.text[:300]}"
        )

    finally:
        cur = db_conn.cursor()

        if collection_id:
            cur.execute("DELETE FROM collections WHERE id = %s", (collection_id,))

        # Clean up any stray test collections by name prefix
        if tenant_id:
            cur.execute(
                "DELETE FROM collections WHERE tenant_id = %s",
                (tenant_id,),
            )
            cur.execute(
                "DELETE FROM tenant_members WHERE tenant_id = %s",
                (tenant_id,),
            )
            cur.execute("DELETE FROM tenants WHERE id = %s", (tenant_id,))

        if user_id:
            cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
