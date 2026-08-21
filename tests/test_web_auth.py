import base64
import hashlib
import hmac
import json
import time

from flask import Flask

from immi_case_downloader.web.auth import verify_jwt


SECRET = "test-secret-current-32-bytes-long-xx"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _sign(payload: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT", "kid": "v1"}
    header_b64 = _b64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    msg = f"{header_b64}.{payload_b64}".encode("ascii")
    sig = hmac.new(SECRET.encode("utf-8"), msg, hashlib.sha256).digest()
    return f"{header_b64}.{payload_b64}.{_b64url(sig)}"


def test_verify_jwt_accepts_worker_access_token(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_CURRENT", SECRET)
    app = Flask(__name__)
    token = _sign(
        {
            "sub": "550e8400-e29b-41d4-a716-446655440000",
            "tenant_id": "660e8400-e29b-41d4-a716-446655440001",
            "role": "owner",
            "kid": "v1",
            "exp": int(time.time()) + 300,
        }
    )

    with app.app_context():
        payload = verify_jwt(token)

    assert payload is not None
    assert payload["tenant_id"] == "660e8400-e29b-41d4-a716-446655440001"


def test_verify_jwt_rejects_refresh_token_as_flask_access_token(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_CURRENT", SECRET)
    app = Flask(__name__)
    token = _sign(
        {
            "sub": "550e8400-e29b-41d4-a716-446655440000",
            "type": "refresh",
            "jti": "770e8400-e29b-41d4-a716-446655440003",
            "kid": "v1",
            "exp": int(time.time()) + 604800,
        }
    )

    with app.app_context():
        payload = verify_jwt(token)

    assert payload is None
