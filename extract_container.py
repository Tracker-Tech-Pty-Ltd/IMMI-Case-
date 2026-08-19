"""Minimal CPU/LLM-only extraction service for the Cloudflare Container.

This process has no database client, object-store credential or catalog
writer. It accepts a bounded batch from the pipeline Worker and
returns extraction JSON; the Worker owns every durable write.
"""

from __future__ import annotations

import os
from typing import Any

from flask import Flask, jsonify, request

from immi_case_downloader.extraction import ExtractionTimeoutError, extract_llm, extract_regex


app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "immi-extraction-container"})


@app.post("/internal/extract")
def internal_extract():
    if request.headers.get("X-Internal-Route") != "worker" or request.headers.get("X-Internal-Route-Subtype") != "cron-extract":
        return jsonify({"error": "Forbidden", "code": "not_internal"}), 403
    shared_secret = os.environ.get("EXTRACTION_SHARED_SECRET", "")
    if not shared_secret or request.headers.get("X-Extraction-Token") != shared_secret:
        return jsonify({"error": "Forbidden", "code": "invalid_extraction_token"}), 403

    payload = request.get_json(silent=True) or {}
    run_id = text(payload.get("run_id"))
    batch = payload.get("batch")
    if not run_id or not isinstance(batch, list) or len(batch) > 20:
        return jsonify({"error": "Invalid payload", "code": "bad_payload"}), 400

    extracted = []
    llm_calls = 0
    cost_usd = 0.0
    cap = number("PIPELINE_RUN_COST_CAP_USD", 5.0) * 0.8
    gateway_url = os.environ.get("LLM_EXTRACT_CF_GATEWAY_URL", "")
    token = os.environ.get("CF_AIG_TOKEN", "")
    model = os.environ.get("LLM_GEMMA_MODEL", "workers-ai/@cf/google/gemma-4-26b-a4b-it")
    max_tokens = int(number("LLM_MAX_OUTPUT_TOKENS", 512))
    timeout_seconds = number("PIPELINE_LLM_CALL_TIMEOUT_MS", 28_000) / 1000

    for item in batch:
        if not isinstance(item, dict):
            continue
        case_id = text(item.get("case_id"))
        base = dict(item.get("base") or {})
        full_text = text(base.get("full_text") or item.get("full_text"))
        if not case_id or not full_text:
            continue

        fields = extract_regex(full_text, base)
        unfilled = [field for field, envelope in fields.items() if envelope.get("value") in (None, "")]
        timeouts: list[str] = []
        if unfilled and gateway_url and token and cost_usd < cap:
            try:
                values, call_cost = extract_llm(
                    full_text, unfilled, gateway_url=gateway_url, token=token,
                    model=model, max_output_tokens=max_tokens, timeout_seconds=timeout_seconds,
                )
                if values:
                    llm_calls += 1
                    cost_usd += call_cost
                    for field, value in values.items():
                        fields[field] = {"value": value, "confidence": 0.7, "source": "llm"}
            except ExtractionTimeoutError as exc:
                timeouts.extend(exc.fields)
        for field in timeouts:
            fields[field] = {"value": None, "confidence": 0.0, "source": "timeout"}
        base.pop("full_text", None)
        extracted.append({"case_id": case_id, "r2_key": item.get("r2_key"), "base": base, "fields": fields, "timeouts": timeouts})

    return jsonify({"run_id": run_id, "extracted": extracted, "llm_calls": llm_calls, "cost_usd": round(cost_usd, 6)})


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def number(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(number("PORT", 8080)))
