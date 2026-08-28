"""The one implementation of the internal extraction endpoint.

Two Flask entry points bind to it: ``extract_container.py`` (the Cloudflare
Container image) and ``immi_case_downloader/web/internal_extract.py`` (the
local-dev Flask app). They previously held two copies of this body that had
drifted apart on authentication and payload limits.
"""

from __future__ import annotations

import secrets
from collections.abc import Callable, Mapping
from typing import Any

from .llm import ExtractionTimeoutError, extract_llm
from .regex import extract_regex

MAX_BATCH_SIZE = 20


def authorize(
    header: Callable[[str], str | None], env: Mapping[str, str]
) -> tuple[dict, int] | None:
    """Return ``None`` when the request is allowed, otherwise a (body, status) pair."""
    if header("X-Internal-Route") != "worker":
        return {"error": "Forbidden", "code": "not_internal"}, 403
    if header("X-Internal-Route-Subtype") != "cron-extract":
        return {"error": "Forbidden", "code": "not_cron_extract"}, 403

    shared_secret = env.get("EXTRACTION_SHARED_SECRET", "")
    presented = header("X-Extraction-Token") or ""
    if not shared_secret or not secrets.compare_digest(presented, shared_secret):
        return {"error": "Forbidden", "code": "invalid_extraction_token"}, 403

    return None


def parse_payload(raw: object) -> tuple[str, list] | None:
    """Validate a decoded JSON request body. Returns ``None`` to signal 400 bad_payload.

    ``request.get_json(silent=True)`` returns whatever the client sent: a list,
    a string, a number, or ``None``. Every step of this validation exists
    because skipping it lets an authenticated-but-malformed request crash the
    handler instead of getting a clean 400.
    """
    if not isinstance(raw, dict):
        return None

    run_id = _text(raw.get("run_id"))
    if not run_id:
        return None

    batch = raw.get("batch")
    if not isinstance(batch, list):
        return None
    if len(batch) > MAX_BATCH_SIZE:
        return None

    for item in batch:
        if not isinstance(item, dict):
            return None
        base = item.get("base")
        if base is not None and not isinstance(base, dict):
            return None

    return run_id, batch


def run_batch(run_id: str, batch: list, env: Mapping[str, str]) -> dict:
    """Run regex extraction (with an LLM fallback) over a validated batch."""
    extracted = []
    llm_calls = 0
    cost_usd = 0.0
    cap = _number(env.get("PIPELINE_RUN_COST_CAP_USD"), 5.0) * 0.8
    gateway_url = env.get("LLM_EXTRACT_CF_GATEWAY_URL", "")
    token = env.get("CF_AIG_TOKEN", "")
    model = env.get("LLM_GEMMA_MODEL", "workers-ai/@cf/google/gemma-4-26b-a4b-it")
    max_tokens = int(_number(env.get("LLM_MAX_OUTPUT_TOKENS"), 512))
    timeout_seconds = _number(env.get("PIPELINE_LLM_CALL_TIMEOUT_MS"), 28_000) / 1000

    for item in batch:
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

    return {
        "run_id": run_id,
        "extracted": extracted,
        "llm_calls": llm_calls,
        "cost_usd": round(cost_usd, 6),
    }


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _number(value: Any, default: float) -> float:
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default
