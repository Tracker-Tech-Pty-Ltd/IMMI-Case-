"""Minimal CPU/LLM-only extraction service for the Cloudflare Container.

This process has no database client, object-store credential or catalog
writer. It accepts a bounded batch from the pipeline Worker and
returns extraction JSON; the Worker owns every durable write.
"""

from __future__ import annotations

import os

from flask import Flask, jsonify, request

from immi_case_downloader.extraction import service


app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "immi-extraction-container"})


@app.post("/internal/extract")
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


def _port() -> int:
    try:
        return int(os.environ.get("PORT", 8080))
    except (TypeError, ValueError):
        return 8080


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=_port())
