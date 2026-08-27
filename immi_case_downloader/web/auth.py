"""Flask JWT verification helper — local development only.

The Worker issues HS256 JWTs signed with JWT_SECRET_CURRENT and is the only
component that enforces authentication and tenancy in production; see
workers/auth/cloudflare_handlers.js and CloudflareIdentityStore.assertMembership()
in workers/storage/cloudflare.js. This module exists so a locally run Flask
process can decode the same token.

It deliberately exposes no route decorators. The three that used to live here
(require_auth / optional_auth / require_tenant_membership) were applied to zero
routes, read the app extension 'immi_repo' that nothing registers, and called
a check_tenant_membership() method that no repository implements — so anyone
adopting them would have believed they enforced tenancy while they enforced
nothing. Do not re-add them: the Worker owns this boundary.
"""

import hmac
import hashlib
import base64
import json
import time
import os
from flask import current_app

# ---------------------------------------------------------------------------
# JWT verification (HS256, Web-Crypto compatible)
# ---------------------------------------------------------------------------


def _b64url_decode(s: str) -> bytes:
    """Decode base64url (no padding) to bytes."""
    s = s.replace('-', '+').replace('_', '/')
    # Add padding
    pad = 4 - len(s) % 4
    if pad != 4:
        s += '=' * pad
    return base64.b64decode(s)


def _verify_hs256(header_b64: str, payload_b64: str, signature_b64: str, secret: str) -> bool:
    """Constant-time HS256 signature verification."""
    msg = f"{header_b64}.{payload_b64}".encode()
    secret_bytes = secret.encode()
    expected = hmac.new(secret_bytes, msg, hashlib.sha256).digest()
    try:
        actual = _b64url_decode(signature_b64)
    except Exception:
        return False
    return hmac.compare_digest(expected, actual)


def verify_jwt(token: str, *, allow_refresh: bool = False) -> dict | None:
    """
    Verify a Worker-issued HS256 JWT.
    Returns decoded payload dict on success, None on failure.
    Tries JWT_SECRET_CURRENT first, then JWT_SECRET_PREVIOUS for rotation.
    """
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        header_b64, payload_b64, sig_b64 = parts

        # Verify the signature BEFORE reading any claim. An unverified payload
        # is attacker-supplied text; no decision should depend on it first.
        # Try current secret first, then previous (rotation window).
        verified = False
        for secret_env in ('JWT_SECRET_CURRENT', 'JWT_SECRET_PREVIOUS'):
            secret = os.environ.get(secret_env, '')
            if not secret:
                continue
            if _verify_hs256(header_b64, payload_b64, sig_b64, secret):
                verified = True
                break

        if not verified:
            current_app.logger.warning('jwt.invalid_signature')
            return None

        payload = json.loads(_b64url_decode(payload_b64))

        # Check expiry
        if payload.get('exp', 0) < time.time():
            current_app.logger.warning('jwt.expired', extra={'kid': payload.get('kid')})
            return None

        # Flask routes expect access tokens. Refresh tokens are validated and
        # rotated only by the Worker auth handlers against immi_refresh_sessions.
        if payload.get('type') == 'refresh' and not allow_refresh:
            current_app.logger.warning('jwt.refresh_token_rejected', extra={'kid': payload.get('kid')})
            return None

        return payload

    except Exception as e:
        current_app.logger.warning(f'jwt.parse_error: {e}')
        return None
