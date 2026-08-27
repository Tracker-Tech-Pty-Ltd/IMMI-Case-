"""Regression tests for verify_jwt's signature-before-claims ordering.

Two happy-path tests already live in tests/test_web_auth.py (out of scope for
this plan — a separate plan lints the existing test files), but they cannot
hold a change to the order in which a JWT's signature and claims are trusted:
they would pass just as well against a verifier that skipped the signature
check entirely. These tests specifically prove that an attacker-controlled
claim (exp, type) is never read before the signature is verified.
"""

import base64
import hashlib
import hmac
import json
import logging
import time

from flask import Flask

from immi_case_downloader.web.auth import verify_jwt


SECRET_CURRENT = "test-secret-current-32-bytes-long-xx"
SECRET_PREVIOUS = "test-secret-previous-32-bytes-long-x"
WRONG_SECRET = "not-the-right-secret-at-all-32-bytes"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _sign(payload: dict, secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT", "kid": "v1"}
    header_b64 = _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    msg = f"{header_b64}.{payload_b64}".encode("ascii")
    sig = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).digest()
    return f"{header_b64}.{payload_b64}.{_b64url(sig)}"


def _sign_raw(header_b64: str, payload_b64: str, secret: str) -> str:
    msg = f"{header_b64}.{payload_b64}".encode("ascii")
    sig = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).digest()
    return f"{header_b64}.{payload_b64}.{_b64url(sig)}"


def test_expired_token_with_a_bad_signature_is_rejected_as_invalid_signature(
    monkeypatch, caplog
):
    """An attacker-supplied exp must not be read before the signature is checked."""
    monkeypatch.setenv("JWT_SECRET_CURRENT", SECRET_CURRENT)
    monkeypatch.setenv("JWT_SECRET_PREVIOUS", "")
    app = Flask(__name__)
    token = _sign(
        {"sub": "u1", "kid": "v1", "exp": int(time.time()) - 3600},
        WRONG_SECRET,
    )

    with app.app_context(), caplog.at_level(logging.WARNING):
        payload = verify_jwt(token)

    assert payload is None
    assert "jwt.invalid_signature" in caplog.text
    assert "jwt.expired" not in caplog.text


def test_refresh_token_with_a_bad_signature_is_rejected_as_invalid_signature(
    monkeypatch, caplog
):
    """An attacker-supplied type=refresh must not be read before signature checks."""
    monkeypatch.setenv("JWT_SECRET_CURRENT", SECRET_CURRENT)
    monkeypatch.setenv("JWT_SECRET_PREVIOUS", "")
    app = Flask(__name__)
    token = _sign(
        {"sub": "u1", "type": "refresh", "kid": "v1", "exp": int(time.time()) + 300},
        WRONG_SECRET,
    )

    with app.app_context(), caplog.at_level(logging.WARNING):
        payload = verify_jwt(token)

    assert payload is None
    assert "jwt.invalid_signature" in caplog.text
    assert "jwt.refresh_token_rejected" not in caplog.text


def test_token_signed_with_the_previous_secret_is_accepted(monkeypatch):
    """The rotation window must still work after the reorder."""
    monkeypatch.setenv("JWT_SECRET_CURRENT", SECRET_CURRENT)
    monkeypatch.setenv("JWT_SECRET_PREVIOUS", SECRET_PREVIOUS)
    app = Flask(__name__)
    token = _sign(
        {"sub": "u1", "kid": "v0", "exp": int(time.time()) + 300},
        SECRET_PREVIOUS,
    )

    with app.app_context():
        payload = verify_jwt(token)

    assert payload is not None
    assert payload["sub"] == "u1"


def test_valid_but_expired_token_is_rejected_as_expired(monkeypatch, caplog):
    """Proves the reorder did not drop the expiry check."""
    monkeypatch.setenv("JWT_SECRET_CURRENT", SECRET_CURRENT)
    monkeypatch.setenv("JWT_SECRET_PREVIOUS", "")
    app = Flask(__name__)
    token = _sign(
        {"sub": "u1", "kid": "v1", "exp": int(time.time()) - 3600},
        SECRET_CURRENT,
    )

    with app.app_context(), caplog.at_level(logging.WARNING):
        payload = verify_jwt(token)

    assert payload is None
    assert "jwt.expired" in caplog.text


def test_refresh_token_is_accepted_when_allow_refresh_is_true(monkeypatch):
    """The allow_refresh=True branch, which no existing test covers."""
    monkeypatch.setenv("JWT_SECRET_CURRENT", SECRET_CURRENT)
    monkeypatch.setenv("JWT_SECRET_PREVIOUS", "")
    app = Flask(__name__)
    token = _sign(
        {"sub": "u1", "type": "refresh", "kid": "v1", "exp": int(time.time()) + 300},
        SECRET_CURRENT,
    )

    with app.app_context():
        payload = verify_jwt(token, allow_refresh=True)

    assert payload is not None
    assert payload["type"] == "refresh"


def test_valid_signature_over_a_non_json_payload_returns_none(monkeypatch):
    """After the reorder, json.loads happens after signature verification —
    a correctly-signed but non-JSON payload segment must return None, not raise.
    """
    monkeypatch.setenv("JWT_SECRET_CURRENT", SECRET_CURRENT)
    monkeypatch.setenv("JWT_SECRET_PREVIOUS", "")
    app = Flask(__name__)
    header_b64 = _b64url(
        json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode("utf-8")
    )
    payload_b64 = _b64url(b"not-json-at-all")
    token = _sign_raw(header_b64, payload_b64, SECRET_CURRENT)

    with app.app_context():
        payload = verify_jwt(token)

    assert payload is None
