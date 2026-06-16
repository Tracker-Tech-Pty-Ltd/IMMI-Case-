"""Internal container endpoint for the Cloudflare extraction pipeline."""

from __future__ import annotations

import os
from typing import Any

from flask import Blueprint, jsonify, request

from .security import csrf

internal_extract_bp = Blueprint("internal_extract", __name__)


@internal_extract_bp.post("/internal/extract")
def internal_extract():
    if request.headers.get("X-Internal-Route") != "worker":
        return jsonify({"error": "Forbidden", "code": "not_internal"}), 403
    if request.headers.get("X-Internal-Route-Subtype") != "cron-extract":
        return jsonify({"error": "Forbidden", "code": "not_cron_extract"}), 403

    payload = request.get_json(silent=True) or {}
    run_id = _text(payload.get("run_id"))
    batch = payload.get("batch")
    if not run_id or not isinstance(batch, list):
        return jsonify({"error": "Invalid payload", "code": "bad_payload"}), 400

    from immi_case_downloader.extraction import ExtractionTimeoutError, extract_llm, extract_regex

    extracted = []
    llm_calls = 0
    cost_usd = 0.0
    cap = _float_env("PIPELINE_RUN_COST_CAP_USD", 5.0) * 0.8
    gateway_url = os.environ.get("LLM_EXTRACT_CF_GATEWAY_URL", "")
    token = os.environ.get("CF_AIG_TOKEN", "")
    model = os.environ.get("LLM_GEMMA_MODEL", "workers-ai/@cf/google/gemma-4-26b-a4b-it")
    max_tokens = int(_float_env("LLM_MAX_OUTPUT_TOKENS", 512))
    timeout_seconds = _float_env("PIPELINE_LLM_CALL_TIMEOUT_MS", 28_000) / 1000

    for item in batch:
        if not isinstance(item, dict):
            continue
        case_id = _text(item.get("case_id"))
        base = dict(item.get("base") or {})
        full_text = _text(base.get("full_text") or item.get("full_text"))
        if not case_id or not full_text:
            continue

        fields = extract_regex(full_text, base)
        unfilled = [
            field
            for field, envelope in fields.items()
            if envelope.get("value") in (None, "")
        ]
        timeouts: list[str] = []

        if unfilled and gateway_url and token and cost_usd < cap:
            try:
                values, call_cost = extract_llm(
                    full_text,
                    unfilled,
                    gateway_url=gateway_url,
                    token=token,
                    model=model,
                    max_output_tokens=max_tokens,
                    timeout_seconds=timeout_seconds,
                )
                if values:
                    llm_calls += 1
                    cost_usd += call_cost
                    for field, value in values.items():
                        fields[field] = {
                            "value": value,
                            "confidence": 0.7,
                            "source": "llm",
                        }
            except ExtractionTimeoutError as exc:
                timeouts.extend(exc.fields)

        for field in timeouts:
            fields[field] = {
                "value": None,
                "confidence": 0.0,
                "source": "timeout",
            }

        # Do not echo large full_text back to the Worker. It already has the R2 key.
        base.pop("full_text", None)
        extracted.append(
            {
                "case_id": case_id,
                "r2_key": item.get("r2_key"),
                "base": base,
                "fields": fields,
                "timeouts": timeouts,
            }
        )

    return jsonify(
        {
            "run_id": run_id,
            "extracted": extracted,
            "llm_calls": llm_calls,
            "cost_usd": round(cost_usd, 6),
        }
    )


csrf.exempt(internal_extract_bp)


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
