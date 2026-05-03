"""
Flask JWT authentication middleware.

The Worker issues HS256 JWTs signed with JWT_SECRET_CURRENT.
Flask verifies the same JWT directly — no separate HMAC envelope.

Worker forwards the JWT as:
  Authorization: Bearer <access_token>

Flask also adds X-Internal-Route: worker header. We reject requests
without this header to prevent direct external access to the Flask container.
"""

import hmac
import hashlib
import base64
import json
import time
import os
from functools import wraps
from flask import request, g, jsonify, current_app

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


def verify_jwt(token: str) -> dict | None:
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

        payload_bytes = _b64url_decode(payload_b64)
        payload = json.loads(payload_bytes)

        # Check expiry
        if payload.get('exp', 0) < time.time():
            current_app.logger.warning('jwt.expired', extra={'kid': payload.get('kid')})
            return None

        # Try current secret first, then previous (rotation window)
        for secret_env in ('JWT_SECRET_CURRENT', 'JWT_SECRET_PREVIOUS'):
            secret = os.environ.get(secret_env, '')
            if not secret:
                continue
            if _verify_hs256(header_b64, payload_b64, sig_b64, secret):
                return payload

        current_app.logger.warning('jwt.invalid_signature')
        return None

    except Exception as e:
        current_app.logger.warning(f'jwt.parse_error: {e}')
        return None


# ---------------------------------------------------------------------------
# Internal route guard
# ---------------------------------------------------------------------------


def _is_internal_request() -> bool:
    """
    Check that request came from Worker service binding, not public internet.
    Worker always sets X-Internal-Route: worker header.
    """
    return request.headers.get('X-Internal-Route') == 'worker'


# ---------------------------------------------------------------------------
# Decorators
# ---------------------------------------------------------------------------


def require_auth(f):
    """
    Decorator: require valid JWT. Sets g.claims and g.tenant_id.
    Also enforces that request came via Worker service binding.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        # Reject direct external access to Flask container
        if not _is_internal_request():
            return jsonify({'error': 'Forbidden', 'code': 'not_internal'}), 403

        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return jsonify({'error': 'Authentication required', 'code': 'auth_required'}), 401

        token = auth_header[7:]
        payload = verify_jwt(token)
        if payload is None:
            return jsonify({'error': 'Invalid or expired token', 'code': 'auth_invalid'}), 401

        g.claims = payload
        g.user_id = payload.get('sub')
        g.tenant_id = payload.get('tenant_id')
        g.role = payload.get('role', 'member')
        return f(*args, **kwargs)
    return decorated


def optional_auth(f):
    """
    Decorator: parse JWT if present but don't require it.
    g.claims will be None if no valid JWT.
    Also enforces that request came via Worker service binding.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        if not _is_internal_request():
            return jsonify({'error': 'Forbidden', 'code': 'not_internal'}), 403
        g.claims = None
        g.user_id = None
        g.tenant_id = None

        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]
            payload = verify_jwt(token)
            if payload:
                g.claims = payload
                g.user_id = payload.get('sub')
                g.tenant_id = payload.get('tenant_id')
                g.role = payload.get('role', 'member')

        return f(*args, **kwargs)
    return decorated


def require_tenant_membership(f):
    """
    Decorator (must be used after @require_auth): re-check tenant_members in DB
    on every write request. Provides instant revocation for writes.
    Only needed on POST/PUT/DELETE endpoints.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        if not hasattr(g, 'tenant_id') or not g.tenant_id:
            return jsonify({'error': 'Tenant context required', 'code': 'no_tenant'}), 403

        # Re-check membership in DB (instant revocation for writes)
        repo = current_app.extensions.get('immi_repo')
        if repo and hasattr(repo, 'check_tenant_membership'):
            if not repo.check_tenant_membership(g.user_id, g.tenant_id):
                return jsonify({'error': 'Not a member of this tenant', 'code': 'revoked'}), 403

        return f(*args, **kwargs)
    return decorated
