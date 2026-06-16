"""Small AI Gateway client for cloud extraction fallback."""

from __future__ import annotations

import json
import re
import socket
import urllib.error
import urllib.request
from typing import Any


class ExtractionTimeoutError(TimeoutError):
    """LLM extraction timed out for one or more fields."""

    def __init__(self, fields: list[str]):
        super().__init__("LLM extraction timed out")
        self.fields = fields


SYSTEM_PROMPT = """You extract structured fields from Australian immigration case text.
Return only one compact JSON object. Use empty strings for unknown values."""


def extract_llm(
    text: str,
    unfilled: list[str],
    *,
    gateway_url: str,
    token: str,
    model: str = "workers-ai/@cf/google/gemma-4-26b-a4b-it",
    max_output_tokens: int = 512,
    timeout_seconds: float = 28.0,
) -> tuple[dict[str, Any], float]:
    """Extract unfilled fields via Cloudflare AI Gateway.

    JSON parse failures are treated as no extraction and cost ``0``. This keeps
    the caller from retrying malformed model output and accidentally amplifying
    spend.
    """

    if not text or not unfilled or not gateway_url or not token:
        return {}, 0.0

    request = urllib.request.Request(
        gateway_url,
        data=json.dumps(
            {
                "model": model,
                "temperature": 0,
                "max_tokens": max_output_tokens,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": _build_prompt(text, unfilled)},
                ],
            }
        ).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "cf-aig-authorization": _bearer(token),
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except TimeoutError as exc:
        raise ExtractionTimeoutError(unfilled) from exc
    except socket.timeout as exc:
        raise ExtractionTimeoutError(unfilled) from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, socket.timeout):
            raise ExtractionTimeoutError(unfilled) from exc
        return {}, 0.0
    except (OSError, json.JSONDecodeError):
        return {}, 0.0

    values = _parse_values(payload, unfilled)
    if not values:
        return {}, 0.0
    return values, _estimate_cost(payload)


def _build_prompt(text: str, unfilled: list[str]) -> str:
    return (
        "Fields: "
        + ", ".join(unfilled)
        + "\nRules: use exact text evidence when possible; do not guess from names; "
        + "JSON keys must match requested fields.\n\nCase text:\n"
        + text[:9000]
    )


def _parse_values(payload: dict[str, Any], unfilled: list[str]) -> dict[str, Any]:
    content = ""
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(message, dict):
            content = str(message.get("content") or "")
    if not content:
        content = str(payload.get("response") or payload.get("content") or "")

    parsed = _extract_json_object(content)
    if not isinstance(parsed, dict):
        return {}

    allowed = set(unfilled)
    return {key: value for key, value in parsed.items() if key in allowed and value not in (None, "")}


def _extract_json_object(text: str) -> dict[str, Any] | None:
    text = text.strip()
    if not text:
        return None
    if text.startswith("{"):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def _estimate_cost(payload: dict[str, Any]) -> float:
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        return 0.0
    input_tokens = _number(usage.get("prompt_tokens") or usage.get("input_tokens"))
    output_tokens = _number(usage.get("completion_tokens") or usage.get("output_tokens"))
    # Gemma 4 26B A4B plan math: $0.10/M input, $0.30/M output.
    return round((input_tokens * 0.10 + output_tokens * 0.30) / 1_000_000, 6)


def _number(value: Any) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0
    return parsed if parsed > 0 else 0.0


def _bearer(token: str) -> str:
    token = token.strip()
    if token.lower().startswith("bearer "):
        return token
    return f"Bearer {token}"
