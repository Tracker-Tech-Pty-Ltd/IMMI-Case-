"""Credentialed auth smoke for the production Worker auth surface.

This test is intentionally opt-in because it talks to a real Worker URL,
creates tenant-scoped rows, writes a case, and runs one LLM Council session.
It is skipped unless IMMI_AUTH_SMOKE=1 and the required env vars are present.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any

import pytest
import requests


HTTP_TIMEOUT_SECONDS = float(os.environ.get("IMMI_AUTH_SMOKE_HTTP_TIMEOUT", "240"))
SHORT_TIMEOUT_SECONDS = float(os.environ.get("IMMI_AUTH_SMOKE_SHORT_TIMEOUT", "30"))


@dataclass(frozen=True)
class SmokeConfig:
    base_url: str
    db_url: str
    telegram_bot_token: str
    telegram_id: int
    owns_telegram_user: bool
    run_id: str


def _smoke_config() -> SmokeConfig:
    if os.environ.get("IMMI_AUTH_SMOKE") != "1":
        pytest.skip("Set IMMI_AUTH_SMOKE=1 to run credentialed auth smoke.")

    base_url = (
        os.environ.get("IMMI_AUTH_SMOKE_BASE_URL")
        or os.environ.get("E2E_BASE_URL")
        or ""
    ).rstrip("/")
    db_url = os.environ.get("SUPABASE_DB_URL", "")
    telegram_bot_token = (
        os.environ.get("IMMI_AUTH_SMOKE_TELEGRAM_BOT_TOKEN")
        or os.environ.get("TELEGRAM_BOT_TOKEN")
        or ""
    )

    missing = [
        name
        for name, value in {
            "IMMI_AUTH_SMOKE_BASE_URL or E2E_BASE_URL": base_url,
            "SUPABASE_DB_URL": db_url,
            "IMMI_AUTH_SMOKE_TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN": telegram_bot_token,
        }.items()
        if not value
    ]
    if missing:
        pytest.skip("Missing required env vars: " + ", ".join(missing))

    generated_telegram_id = 9_900_000_000 + (os.getpid() * 1000) + (int(time.time()) % 1000)
    telegram_id_raw = os.environ.get("IMMI_AUTH_SMOKE_TELEGRAM_ID")
    telegram_id = int(telegram_id_raw or generated_telegram_id)
    owns_telegram_user = telegram_id_raw is None
    run_id = f"authsmoke-{int(time.time())}-{uuid.uuid4().hex[:8]}"

    return SmokeConfig(
        base_url=base_url,
        db_url=db_url,
        telegram_bot_token=telegram_bot_token,
        telegram_id=telegram_id,
        owns_telegram_user=owns_telegram_user,
        run_id=run_id,
    )


@pytest.fixture(scope="function")
def smoke_config() -> SmokeConfig:
    return _smoke_config()


@pytest.fixture(scope="function")
def db_conn(smoke_config: SmokeConfig):
    psycopg2 = pytest.importorskip("psycopg2")
    conn = psycopg2.connect(smoke_config.db_url)
    conn.autocommit = True
    try:
        yield conn
    finally:
        conn.close()


def _telegram_payload(config: SmokeConfig) -> dict[str, str]:
    payload = {
        "id": str(config.telegram_id),
        "first_name": "_autotest",
        "last_name": "CredentialedSmoke",
        "username": f"autotest_{config.run_id.replace('-', '_')}",
        "auth_date": str(int(time.time())),
    }
    check_string = "\n".join(f"{key}={payload[key]}" for key in sorted(payload))
    secret = hashlib.sha256(config.telegram_bot_token.encode("utf-8")).digest()
    payload["hash"] = hmac.new(
        secret,
        check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return payload


def _json(resp: requests.Response) -> dict[str, Any]:
    try:
        data = resp.json()
    except ValueError as exc:
        raise AssertionError(
            f"{resp.request.method} {resp.url} did not return JSON; "
            f"status={resp.status_code}; body={resp.text[:500]}"
        ) from exc
    assert isinstance(data, dict), f"Expected JSON object, got {type(data).__name__}: {data!r}"
    return data


def _assert_status(
    resp: requests.Response,
    expected: int | tuple[int, ...],
    label: str,
) -> dict[str, Any]:
    expected_tuple = (expected,) if isinstance(expected, int) else expected
    data = _json(resp)
    assert resp.status_code in expected_tuple, (
        f"{label}: expected {expected_tuple}, got {resp.status_code}. "
        f"Body: {data}"
    )
    return data


def _cookie_header(session: requests.Session, *names: str) -> str:
    wanted = set(names)
    return "; ".join(
        f"{cookie.name}={cookie.value}"
        for cookie in session.cookies
        if cookie.name in wanted
    )


def _auth_headers(token: str, extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {token}"}
    if extra:
        headers.update(extra)
    return headers


def _create_test_tenant(conn, user_id: str, tenant_name: str) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO immi_tenants (kind, name)
            VALUES ('organization', %s)
            RETURNING id
            """,
            (tenant_name,),
        )
        tenant_id = str(cur.fetchone()[0])
        cur.execute(
            """
            INSERT INTO immi_tenant_members (tenant_id, user_id, role)
            VALUES (%s, %s, 'owner')
            ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role
            """,
            (tenant_id, user_id),
        )
    return tenant_id


def _cleanup_smoke_rows(
    conn,
    *,
    config: SmokeConfig,
    user_id: str | None,
    personal_tenant_id: str | None,
    test_tenant_id: str | None,
    test_tenant_name: str,
    case_id: str | None,
    case_title: str,
    session_id: str | None,
    session_title: str,
) -> None:
    with conn.cursor() as cur:
        if session_id:
            cur.execute("DELETE FROM council_sessions WHERE session_id = %s", (session_id,))
        cur.execute("DELETE FROM council_sessions WHERE title = %s", (session_title,))

        if case_id:
            cur.execute("DELETE FROM immigration_cases WHERE case_id = %s", (case_id,))
        cur.execute("DELETE FROM immigration_cases WHERE title = %s", (case_title,))

        if test_tenant_id:
            cur.execute("DELETE FROM immi_tenants WHERE id = %s", (test_tenant_id,))
        cur.execute("DELETE FROM immi_tenants WHERE name = %s", (test_tenant_name,))

        if config.owns_telegram_user and user_id:
            cur.execute("DELETE FROM immi_users WHERE id = %s", (user_id,))
            if personal_tenant_id:
                cur.execute(
                    """
                    DELETE FROM immi_tenants
                    WHERE id = %s
                      AND NOT EXISTS (
                        SELECT 1 FROM immi_tenant_members
                        WHERE immi_tenant_members.tenant_id = immi_tenants.id
                      )
                    """,
                    (personal_tenant_id,),
                )


def test_credentialed_auth_refresh_tenant_case_and_llm_council_smoke(
    smoke_config: SmokeConfig,
    db_conn,
):
    session = requests.Session()
    user_id = None
    personal_tenant_id = None
    test_tenant_id = None
    created_case_id = None
    council_session_id = None
    deleted_council_session = False

    tenant_name = f"_autotest_{smoke_config.run_id}_tenant"
    case_title = f"_autotest {smoke_config.run_id} case write"
    session_title = f"_autotest {smoke_config.run_id} council session"

    try:
        login_resp = session.post(
            f"{smoke_config.base_url}/api/v1/auth/telegram",
            json=_telegram_payload(smoke_config),
            timeout=SHORT_TIMEOUT_SECONDS,
        )
        login = _assert_status(login_resp, 200, "Telegram login")
        access_token = login.get("access_token")
        assert access_token, f"Telegram login response missing access_token: {login}"

        user_id = login.get("user", {}).get("id")
        personal_tenant_id = login.get("tenant", {}).get("id")
        assert user_id, f"Telegram login response missing user.id: {login}"
        assert personal_tenant_id, f"Telegram login response missing tenant.id: {login}"

        test_tenant_id = _create_test_tenant(db_conn, user_id, tenant_name)

        refresh_resp = session.post(
            f"{smoke_config.base_url}/api/v1/auth/refresh",
            headers={"Cookie": _cookie_header(session, "immi_refresh")},
            timeout=SHORT_TIMEOUT_SECONDS,
        )
        refreshed = _assert_status(refresh_resp, 200, "Auth refresh")
        refreshed_token = refreshed.get("access_token")
        assert refreshed_token, f"Refresh response missing access_token: {refreshed}"

        switch_resp = session.post(
            f"{smoke_config.base_url}/api/v1/auth/switch-tenant",
            json={"tenant_id": test_tenant_id},
            headers=_auth_headers(refreshed_token),
            timeout=SHORT_TIMEOUT_SECONDS,
        )
        switched = _assert_status(switch_resp, 200, "Switch tenant")
        switched_token = switched.get("access_token")
        assert switched_token, f"Switch response missing access_token: {switched}"
        assert switched.get("tenant", {}).get("id") == test_tenant_id

        me_resp = session.get(
            f"{smoke_config.base_url}/api/v1/auth/me",
            headers=_auth_headers(switched_token),
            timeout=SHORT_TIMEOUT_SECONDS,
        )
        me = _assert_status(me_resp, 200, "Auth me after switch")
        assert me.get("tenant", {}).get("id") == test_tenant_id

        csrf_resp = session.get(
            f"{smoke_config.base_url}/api/v1/csrf-token",
            timeout=SHORT_TIMEOUT_SECONDS,
        )
        csrf = _assert_status(csrf_resp, 200, "CSRF token").get("csrf_token")
        assert csrf, "CSRF token response missing csrf_token"

        case_resp = session.post(
            f"{smoke_config.base_url}/api/v1/cases",
            json={
                "title": case_title,
                "citation": f"[2026] AUTHSMOKE {smoke_config.run_id[-8:]}",
                "court_code": "AATA",
                "court": "Administrative Appeals Tribunal",
                "year": 2026,
                "source": "Credentialed Auth Smoke",
                "case_nature": "Automated Smoke Test",
                "legal_concepts": "Auth Smoke; Tenant Write",
            },
            headers=_auth_headers(
                switched_token,
                {
                    "X-CSRFToken": csrf,
                    "Cookie": f"__Host-csrf={csrf}",
                },
            ),
            timeout=SHORT_TIMEOUT_SECONDS,
        )
        created_case = _assert_status(case_resp, 201, "Credentialed case write")
        created_case_id = created_case.get("case", {}).get("case_id")
        assert created_case_id, f"Case write response missing case.case_id: {created_case}"

        create_session_resp = session.post(
            f"{smoke_config.base_url}/api/v1/llm-council/sessions",
            json={
                "message": session_title,
                "case_id": created_case_id,
                "case_context": "Automated credentialed auth smoke. Keep the answer brief.",
            },
            headers=_auth_headers(switched_token),
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        created_session = _assert_status(
            create_session_resp,
            200,
            "LLM Council session create",
        )
        council_session_id = created_session.get("session_id")
        retrieve_code = created_session.get("retrieve_code")
        assert council_session_id, f"Session create missing session_id: {created_session}"
        assert retrieve_code, f"Session create missing retrieve_code: {created_session}"

        list_resp = session.get(
            f"{smoke_config.base_url}/api/v1/llm-council/sessions?limit=10",
            headers=_auth_headers(switched_token),
            timeout=SHORT_TIMEOUT_SECONDS,
        )
        listed = _assert_status(list_resp, 200, "LLM Council session list")
        assert any(
            item.get("session_id") == council_session_id
            for item in listed.get("sessions", [])
        ), f"Created session not found in list: {listed}"

        restore_resp = session.post(
            f"{smoke_config.base_url}/api/v1/llm-council/sessions/restore",
            json={"code": retrieve_code},
            headers=_auth_headers(switched_token),
            timeout=SHORT_TIMEOUT_SECONDS,
        )
        restored = _assert_status(restore_resp, 200, "LLM Council session restore")
        assert restored.get("session_id") == council_session_id
        assert restored.get("session_token"), f"Restore missing session_token: {restored}"

        delete_resp = session.delete(
            f"{smoke_config.base_url}/api/v1/llm-council/sessions/{council_session_id}",
            headers=_auth_headers(switched_token),
            timeout=SHORT_TIMEOUT_SECONDS,
        )
        deleted = _assert_status(delete_resp, 200, "LLM Council session delete")
        assert deleted.get("deleted") is True
        deleted_council_session = True

        after_delete_resp = session.get(
            f"{smoke_config.base_url}/api/v1/llm-council/sessions?limit=10",
            headers=_auth_headers(switched_token),
            timeout=SHORT_TIMEOUT_SECONDS,
        )
        after_delete = _assert_status(after_delete_resp, 200, "LLM Council list after delete")
        assert all(
            item.get("session_id") != council_session_id
            for item in after_delete.get("sessions", [])
        ), f"Deleted session still appears in list: {after_delete}"

    finally:
        _cleanup_smoke_rows(
            db_conn,
            config=smoke_config,
            user_id=user_id,
            personal_tenant_id=personal_tenant_id,
            test_tenant_id=test_tenant_id,
            test_tenant_name=tenant_name,
            case_id=created_case_id,
            case_title=case_title,
            session_id=None if deleted_council_session else council_session_id,
            session_title=session_title,
        )
