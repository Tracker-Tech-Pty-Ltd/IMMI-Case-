"""Internal container endpoint for the Cloudflare extraction pipeline."""

from __future__ import annotations

import os

from flask import Blueprint, jsonify, request

from immi_case_downloader.extraction import service

from .security import csrf

internal_extract_bp = Blueprint("internal_extract", __name__)


@internal_extract_bp.post("/internal/extract")
def internal_extract():
    denied = service.authorize(request.headers.get, os.environ)
    if denied is not None:
        body, status = denied
        return jsonify(body), status

    parsed = service.parse_payload(request.get_json(silent=True))
    if parsed is None:
        return jsonify({"error": "Invalid payload", "code": "bad_payload"}), 400

    run_id, batch = parsed
    return jsonify(service.run_batch(run_id, batch, os.environ))


csrf.exempt(internal_extract_bp)
