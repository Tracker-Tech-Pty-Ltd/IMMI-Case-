"""LLM Council orchestration for multi-provider legal reasoning.

This module executes a 3-model council:
1) OpenAI (web search enabled, medium reasoning)
2) Google Gemini Pro (Google grounding enabled, medium reasoning)
3) Anthropic Sonnet (web search enabled, high reasoning)

Then asks Gemini Flash to act as the middle-ranking/composition model and
produce a synthesized answer plus ranking.
"""

from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

import requests

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"

URL_RE = re.compile(r"https?://[^\s)>\"]+")

DEFAULT_OPENAI_SYSTEM_PROMPT = (
    "You are OpenAI expert counsel in an Australian immigration research council. "
    "Focus on statutory interpretation, case law analogies, and practical legal research framing. "
    "Always separate verified facts from inference and explicitly state uncertainty. "
    "Do not provide legal advice; provide research-oriented guidance."
)

DEFAULT_GEMINI_PRO_SYSTEM_PROMPT = (
    "You are Gemini Pro expert counsel in an Australian immigration research council. "
    "Use grounded web evidence where possible, cite authoritative sources, and prioritize current legal context. "
    "Distinguish statute text, policy guidance, and judicial reasoning. "
    "Do not provide legal advice; provide research-oriented guidance."
)

DEFAULT_ANTHROPIC_SYSTEM_PROMPT = (
    "You are Anthropic Sonnet expert counsel in an Australian immigration research council. "
    "Apply deep reasoning to identify strongest and weakest arguments, procedural risks, and evidentiary gaps. "
    "Be explicit about assumptions and counterarguments. "
    "Do not provide legal advice; provide research-oriented guidance."
)

DEFAULT_MODERATOR_SYSTEM_PROMPT = (
    "You are Gemini Flash moderator for an Australian immigration LLM council. "
    "Rank model outputs by legal rigor, evidence quality, and practical usefulness, then compose a balanced synthesis. "
    "Flag uncertainty and disagreements clearly."
)


def _env_int(name: str, default: int, *, minimum: int = 0, maximum: int = 10_000_000) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def _trim(text: str, max_len: int = 400) -> str:
    text = (text or "").strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


@dataclass(frozen=True)
class CouncilConfig:
    openai_model: str
    gemini_pro_model: str
    anthropic_model: str
    gemini_flash_model: str
    openai_reasoning_effort: str
    gemini_thinking_budget: int
    anthropic_thinking_budget: int
    max_output_tokens: int
    timeout_seconds: int
    openai_api_key: str
    gemini_api_key: str
    anthropic_api_key: str
    anthropic_version: str
    anthropic_web_search_beta: str
    openai_system_prompt: str
    gemini_pro_system_prompt: str
    anthropic_system_prompt: str
    moderator_system_prompt: str

    @classmethod
    def from_env(cls) -> "CouncilConfig":
        gemini_key = (
            os.environ.get("GEMINI_API_KEY", "").strip()
            or os.environ.get("GOOGLE_API_KEY", "").strip()
        )
        return cls(
            openai_model=os.environ.get("LLM_COUNCIL_OPENAI_MODEL", "chatgpt-5.2").strip() or "chatgpt-5.2",
            gemini_pro_model=os.environ.get("LLM_COUNCIL_GEMINI_PRO_MODEL", "gemini-3.0-pro").strip() or "gemini-3.0-pro",
            anthropic_model=os.environ.get("LLM_COUNCIL_ANTHROPIC_MODEL", "claude-sonnet-4-6").strip() or "claude-sonnet-4-6",
            gemini_flash_model=os.environ.get("LLM_COUNCIL_GEMINI_FLASH_MODEL", "gemini-3.0-flash").strip() or "gemini-3.0-flash",
            openai_reasoning_effort=os.environ.get("LLM_COUNCIL_OPENAI_REASONING", "medium").strip() or "medium",
            gemini_thinking_budget=_env_int("LLM_COUNCIL_GEMINI_THINKING_BUDGET", 1024, minimum=0),
            anthropic_thinking_budget=_env_int("LLM_COUNCIL_ANTHROPIC_THINKING_BUDGET", 4096, minimum=0),
            max_output_tokens=_env_int("LLM_COUNCIL_MAX_OUTPUT_TOKENS", 1600, minimum=256, maximum=8192),
            timeout_seconds=_env_int("LLM_COUNCIL_TIMEOUT_SECONDS", 70, minimum=10, maximum=240),
            openai_api_key=os.environ.get("OPENAI_API_KEY", "").strip(),
            gemini_api_key=gemini_key,
            anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", "").strip(),
            anthropic_version=os.environ.get("ANTHROPIC_VERSION", "2023-06-01").strip() or "2023-06-01",
            anthropic_web_search_beta=os.environ.get("ANTHROPIC_WEB_SEARCH_BETA", "web-search-2025-03-05").strip() or "web-search-2025-03-05",
            openai_system_prompt=(
                os.environ.get("LLM_COUNCIL_SYSTEM_PROMPT_OPENAI", "").strip()
                or DEFAULT_OPENAI_SYSTEM_PROMPT
            ),
            gemini_pro_system_prompt=(
                os.environ.get("LLM_COUNCIL_SYSTEM_PROMPT_GEMINI_PRO", "").strip()
                or DEFAULT_GEMINI_PRO_SYSTEM_PROMPT
            ),
            anthropic_system_prompt=(
                os.environ.get("LLM_COUNCIL_SYSTEM_PROMPT_ANTHROPIC", "").strip()
                or DEFAULT_ANTHROPIC_SYSTEM_PROMPT
            ),
            moderator_system_prompt=(
                os.environ.get("LLM_COUNCIL_SYSTEM_PROMPT_MODERATOR", "").strip()
                or DEFAULT_MODERATOR_SYSTEM_PROMPT
            ),
        )


@dataclass
class CouncilOpinion:
    provider_key: str
    provider_label: str
    model: str
    success: bool
    answer: str = ""
    error: str = ""
    sources: list[str] = field(default_factory=list)
    latency_ms: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider_key": self.provider_key,
            "provider_label": self.provider_label,
            "model": self.model,
            "success": self.success,
            "answer": self.answer,
            "error": self.error,
            "sources": self.sources,
            "latency_ms": self.latency_ms,
        }


def _post_json(url: str, *, headers: dict[str, str], payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    response = requests.post(url, headers=headers, json=payload, timeout=timeout)
    if response.status_code >= 400:
        try:
            detail = response.json()
        except Exception:
            detail = response.text
        raise RuntimeError(f"HTTP {response.status_code}: {_trim(str(detail), 800)}")
    return response.json()


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for value in values:
        v = value.strip()
        if not v or v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


def _extract_urls(*chunks: str) -> list[str]:
    matches: list[str] = []
    for chunk in chunks:
        if not chunk:
            continue
        matches.extend(URL_RE.findall(chunk))
    return _dedupe(matches)


def _build_user_prompt(question: str, case_context: str) -> str:
    if case_context:
        return (
            f"User question:\n{question}\n\n"
            f"Case context:\n{case_context}\n\n"
            "Please provide a structured answer with: "
            "(1) key legal issues, (2) likely arguments, (3) risks/uncertainties, "
            "(4) recommended next research steps."
        )
    return (
        f"User question:\n{question}\n\n"
        "Please provide a structured answer with: "
        "(1) key legal issues, (2) likely arguments, (3) risks/uncertainties, "
        "(4) recommended next research steps."
    )


def _extract_openai_text(payload: dict[str, Any]) -> str:
    text_chunks: list[str] = []
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        text_chunks.append(direct.strip())

    output = payload.get("output")
    if isinstance(output, list):
        for item in output:
            if not isinstance(item, dict):
                continue
            content = item.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") in {"output_text", "text"} and isinstance(part.get("text"), str):
                    text_chunks.append(part["text"].strip())
    return "\n\n".join(chunk for chunk in text_chunks if chunk).strip()


def _extract_gemini_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""
    first = candidates[0]
    if not isinstance(first, dict):
        return ""
    content = first.get("content", {})
    if not isinstance(content, dict):
        return ""
    parts = content.get("parts")
    if not isinstance(parts, list):
        return ""
    texts = [
        part.get("text", "").strip()
        for part in parts
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    ]
    return "\n\n".join(t for t in texts if t).strip()


def _extract_gemini_sources(payload: dict[str, Any]) -> list[str]:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return []
    first = candidates[0]
    if not isinstance(first, dict):
        return []
    grounding = first.get("groundingMetadata", {})
    if not isinstance(grounding, dict):
        return []
    chunks = grounding.get("groundingChunks")
    if not isinstance(chunks, list):
        return []
    out: list[str] = []
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        web = chunk.get("web")
        if not isinstance(web, dict):
            continue
        uri = web.get("uri")
        if isinstance(uri, str) and uri.strip():
            out.append(uri.strip())
    return _dedupe(out)


def _extract_anthropic_text(payload: dict[str, Any]) -> str:
    content = payload.get("content")
    if not isinstance(content, list):
        return ""
    texts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "text" and isinstance(item.get("text"), str):
            texts.append(item["text"].strip())
    return "\n\n".join(t for t in texts if t).strip()


def _extract_anthropic_sources(payload: dict[str, Any]) -> list[str]:
    content = payload.get("content")
    if not isinstance(content, list):
        return []
    urls: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if isinstance(text, str):
            urls.extend(_extract_urls(text))
        citations = item.get("citations")
        if isinstance(citations, list):
            for citation in citations:
                if not isinstance(citation, dict):
                    continue
                url = citation.get("url")
                if isinstance(url, str):
                    urls.append(url)
    return _dedupe(urls)


def _run_openai(
    question: str,
    case_context: str,
    cfg: CouncilConfig,
    *,
    system_prompt: str | None = None,
) -> CouncilOpinion:
    provider_key = "openai"
    label = "OpenAI ChatGPT"
    start = time.perf_counter()
    if not cfg.openai_api_key:
        return CouncilOpinion(
            provider_key=provider_key,
            provider_label=label,
            model=cfg.openai_model,
            success=False,
            error="Missing OPENAI_API_KEY",
        )

    user_prompt = _build_user_prompt(question, case_context)
    payload = {
        "model": cfg.openai_model,
        "reasoning": {"effort": cfg.openai_reasoning_effort},
        "tools": [{"type": "web_search_preview"}],
        "max_output_tokens": cfg.max_output_tokens,
        "input": [
            {
                "role": "system",
                "content": [{"type": "input_text", "text": system_prompt or cfg.openai_system_prompt}],
            },
            {
                "role": "user",
                "content": [{"type": "input_text", "text": user_prompt}],
            },
        ],
    }
    headers = {
        "Authorization": f"Bearer {cfg.openai_api_key}",
        "Content-Type": "application/json",
    }

    try:
        data = _post_json(
            OPENAI_RESPONSES_URL,
            headers=headers,
            payload=payload,
            timeout=cfg.timeout_seconds,
        )
        answer = _extract_openai_text(data)
        sources = _extract_urls(answer)
        elapsed = int((time.perf_counter() - start) * 1000)
        if not answer:
            return CouncilOpinion(
                provider_key=provider_key,
                provider_label=label,
                model=cfg.openai_model,
                success=False,
                error="OpenAI response did not include text output",
                latency_ms=elapsed,
            )
        return CouncilOpinion(
            provider_key=provider_key,
            provider_label=label,
            model=cfg.openai_model,
            success=True,
            answer=answer,
            sources=sources,
            latency_ms=elapsed,
        )
    except Exception as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        return CouncilOpinion(
            provider_key=provider_key,
            provider_label=label,
            model=cfg.openai_model,
            success=False,
            error=f"OpenAI request failed: {_trim(str(exc), 700)}",
            latency_ms=elapsed,
        )


def _run_gemini_expert(
    *,
    provider_key: str,
    provider_label: str,
    model: str,
    question: str,
    case_context: str,
    cfg: CouncilConfig,
    with_grounding: bool,
    system_prompt: str | None = None,
) -> CouncilOpinion:
    start = time.perf_counter()
    if not cfg.gemini_api_key:
        return CouncilOpinion(
            provider_key=provider_key,
            provider_label=provider_label,
            model=model,
            success=False,
            error="Missing GEMINI_API_KEY (or GOOGLE_API_KEY)",
        )

    user_prompt = _build_user_prompt(question, case_context)
    endpoint = f"{GEMINI_API_BASE}/models/{model}:generateContent"
    payload: dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": system_prompt or cfg.gemini_pro_system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": cfg.max_output_tokens,
        },
    }
    if cfg.gemini_thinking_budget > 0:
        payload["thinkingConfig"] = {"thinkingBudget": cfg.gemini_thinking_budget}
    if with_grounding:
        payload["tools"] = [{"google_search": {}}]

    try:
        data = _post_json(
            f"{endpoint}?key={cfg.gemini_api_key}",
            headers={"Content-Type": "application/json"},
            payload=payload,
            timeout=cfg.timeout_seconds,
        )
        answer = _extract_gemini_text(data)
        sources = _extract_gemini_sources(data)
        elapsed = int((time.perf_counter() - start) * 1000)
        if not answer:
            return CouncilOpinion(
                provider_key=provider_key,
                provider_label=provider_label,
                model=model,
                success=False,
                error="Gemini response did not include text output",
                latency_ms=elapsed,
            )
        return CouncilOpinion(
            provider_key=provider_key,
            provider_label=provider_label,
            model=model,
            success=True,
            answer=answer,
            sources=sources,
            latency_ms=elapsed,
        )
    except Exception as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        return CouncilOpinion(
            provider_key=provider_key,
            provider_label=provider_label,
            model=model,
            success=False,
            error=f"Gemini request failed: {_trim(str(exc), 700)}",
            latency_ms=elapsed,
        )


def _run_anthropic(
    question: str,
    case_context: str,
    cfg: CouncilConfig,
    *,
    system_prompt: str | None = None,
) -> CouncilOpinion:
    provider_key = "anthropic"
    label = "Anthropic Sonnet"
    start = time.perf_counter()
    if not cfg.anthropic_api_key:
        return CouncilOpinion(
            provider_key=provider_key,
            provider_label=label,
            model=cfg.anthropic_model,
            success=False,
            error="Missing ANTHROPIC_API_KEY",
        )

    user_prompt = _build_user_prompt(question, case_context)
    payload: dict[str, Any] = {
        "model": cfg.anthropic_model,
        "system": system_prompt or cfg.anthropic_system_prompt,
        "max_tokens": cfg.max_output_tokens,
        "messages": [{"role": "user", "content": user_prompt}],
        "tools": [{"type": "web_search_20250305", "name": "web_search"}],
    }
    if cfg.anthropic_thinking_budget > 0:
        payload["thinking"] = {
            "type": "enabled",
            "budget_tokens": cfg.anthropic_thinking_budget,
        }

    headers = {
        "x-api-key": cfg.anthropic_api_key,
        "anthropic-version": cfg.anthropic_version,
        "anthropic-beta": cfg.anthropic_web_search_beta,
        "content-type": "application/json",
    }

    try:
        data = _post_json(
            ANTHROPIC_MESSAGES_URL,
            headers=headers,
            payload=payload,
            timeout=cfg.timeout_seconds,
        )
        answer = _extract_anthropic_text(data)
        sources = _extract_anthropic_sources(data)
        elapsed = int((time.perf_counter() - start) * 1000)
        if not answer:
            return CouncilOpinion(
                provider_key=provider_key,
                provider_label=label,
                model=cfg.anthropic_model,
                success=False,
                error="Anthropic response did not include text output",
                latency_ms=elapsed,
            )
        return CouncilOpinion(
            provider_key=provider_key,
            provider_label=label,
            model=cfg.anthropic_model,
            success=True,
            answer=answer,
            sources=sources,
            latency_ms=elapsed,
        )
    except Exception as exc:
        elapsed = int((time.perf_counter() - start) * 1000)
        return CouncilOpinion(
            provider_key=provider_key,
            provider_label=label,
            model=cfg.anthropic_model,
            success=False,
            error=f"Anthropic request failed: {_trim(str(exc), 700)}",
            latency_ms=elapsed,
        )


def _extract_first_json_object(text: str) -> dict[str, Any] | None:
    if not text:
        return None
    stripped = text.strip()
    try:
        payload = json.loads(stripped)
        if isinstance(payload, dict):
            return payload
    except Exception:
        pass

    match = re.search(r"\{.*\}", stripped, flags=re.DOTALL)
    if not match:
        return None
    try:
        payload = json.loads(match.group(0))
        if isinstance(payload, dict):
            return payload
    except Exception:
        return None
    return None


def _fallback_moderator(opinions: list[CouncilOpinion]) -> dict[str, Any]:
    successful = [o for o in opinions if o.success and o.answer.strip()]
    if not successful:
        return {
            "success": False,
            "ranking": [],
            "composed_answer": "No model produced a usable answer.",
            "consensus": "Unavailable",
            "disagreements": "Unavailable",
            "follow_up_questions": [],
            "raw_text": "",
            "error": "All council models failed",
            "latency_ms": 0,
        }

    successful.sort(key=lambda o: len(o.answer), reverse=True)
    ranking = [
        {
            "rank": idx + 1,
            "provider_key": op.provider_key,
            "provider_label": op.provider_label,
            "score": max(1, 100 - idx * 8),
            "reason": "Fallback ranking based on response completeness.",
        }
        for idx, op in enumerate(successful)
    ]
    composed_answer = "\n\n".join(
        f"[{op.provider_label}] {op.answer}" for op in successful[:2]
    )
    return {
        "success": True,
        "ranking": ranking,
        "composed_answer": composed_answer,
        "consensus": "Partial consensus generated via fallback path.",
        "disagreements": "Possible conflicts remain; review each model opinion.",
        "follow_up_questions": [],
        "raw_text": composed_answer,
        "error": "",
        "latency_ms": 0,
    }


def _run_moderator(
    question: str,
    case_context: str,
    opinions: list[CouncilOpinion],
    cfg: CouncilConfig,
) -> dict[str, Any]:
    start = time.perf_counter()
    prompt_payload = {
        "question": question,
        "case_context": case_context,
        "opinions": [
            {
                "provider_key": o.provider_key,
                "provider_label": o.provider_label,
                "model": o.model,
                "success": o.success,
                "answer": o.answer,
                "error": o.error,
                "sources": o.sources,
            }
            for o in opinions
        ],
    }
    moderator_prompt = (
        f"{cfg.moderator_system_prompt}\n\n"
        "You are the middle-ranking and composition model for an LLM council.\n"
        "Input JSON:\n"
        f"{json.dumps(prompt_payload, ensure_ascii=False)}\n\n"
        "Return STRICT JSON with this exact shape:\n"
        "{\n"
        '  "ranking": [\n'
        '    {"provider_key":"openai|gemini_pro|anthropic","score":0-100,"reason":"..."}\n'
        "  ],\n"
        '  "consensus":"... ",\n'
        '  "disagreements":"... ",\n'
        '  "composed_answer":"... ",\n'
        '  "follow_up_questions":["...", "..."]\n'
        "}\n"
        "Requirements:\n"
        "- Rank only providers that succeeded.\n"
        "- Focus on Australian immigration case research quality.\n"
        "- Mention uncertainty explicitly when evidence is weak.\n"
    )

    mod_opinion = _run_gemini_expert(
        provider_key="gemini_flash",
        provider_label="Google Gemini Flash (Moderator)",
        model=cfg.gemini_flash_model,
        question=moderator_prompt,
        case_context="",
        cfg=cfg,
        with_grounding=False,
        system_prompt=cfg.moderator_system_prompt,
    )
    elapsed = int((time.perf_counter() - start) * 1000)

    if not mod_opinion.success:
        fallback = _fallback_moderator(opinions)
        fallback["error"] = mod_opinion.error or fallback.get("error", "")
        fallback["latency_ms"] = elapsed
        return fallback

    parsed = _extract_first_json_object(mod_opinion.answer)
    if not parsed:
        fallback = _fallback_moderator(opinions)
        fallback["raw_text"] = mod_opinion.answer
        fallback["latency_ms"] = elapsed
        return fallback

    ranking_raw = parsed.get("ranking")
    ranking: list[dict[str, Any]] = []
    if isinstance(ranking_raw, list):
        for idx, item in enumerate(ranking_raw):
            if not isinstance(item, dict):
                continue
            provider_key = str(item.get("provider_key", "")).strip()
            score_raw = item.get("score", 0)
            try:
                score = int(score_raw)
            except Exception:
                score = 0
            ranking.append(
                {
                    "rank": idx + 1,
                    "provider_key": provider_key,
                    "provider_label": next(
                        (o.provider_label for o in opinions if o.provider_key == provider_key),
                        provider_key or "unknown",
                    ),
                    "score": max(0, min(100, score)),
                    "reason": str(item.get("reason", "")).strip(),
                }
            )

    if not ranking:
        ranking = _fallback_moderator(opinions)["ranking"]

    follow_up = parsed.get("follow_up_questions", [])
    if not isinstance(follow_up, list):
        follow_up = []
    follow_up = [str(q).strip() for q in follow_up if str(q).strip()]

    return {
        "success": True,
        "ranking": ranking,
        "consensus": str(parsed.get("consensus", "")).strip(),
        "disagreements": str(parsed.get("disagreements", "")).strip(),
        "composed_answer": str(parsed.get("composed_answer", "")).strip()
        or mod_opinion.answer,
        "follow_up_questions": follow_up,
        "raw_text": mod_opinion.answer,
        "error": "",
        "latency_ms": elapsed,
    }


def run_immi_council(question: str, case_context: str = "") -> dict[str, Any]:
    """Run the 3-model council and compose final output with Gemini Flash."""
    question = (question or "").strip()
    if not question:
        raise ValueError("question is required")

    cfg = CouncilConfig.from_env()
    opinions: list[CouncilOpinion] = []

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {
            "openai": executor.submit(_run_openai, question, case_context, cfg),
            "gemini_pro": executor.submit(
                _run_gemini_expert,
                provider_key="gemini_pro",
                provider_label="Google Gemini Pro",
                model=cfg.gemini_pro_model,
                question=question,
                case_context=case_context,
                cfg=cfg,
                with_grounding=True,
            ),
            "anthropic": executor.submit(_run_anthropic, question, case_context, cfg),
        }
        for key in ("openai", "gemini_pro", "anthropic"):
            opinions.append(futures[key].result())

    moderator = _run_moderator(question, case_context, opinions, cfg)

    return {
        "question": question,
        "case_context": case_context or "",
        "models": {
            "openai": {
                "provider": "OpenAI",
                "model": cfg.openai_model,
                "reasoning": cfg.openai_reasoning_effort,
                "web_search": True,
                "system_prompt": cfg.openai_system_prompt,
            },
            "gemini_pro": {
                "provider": "Google",
                "model": cfg.gemini_pro_model,
                "reasoning_budget": cfg.gemini_thinking_budget,
                "grounding_google_search": True,
                "system_prompt": cfg.gemini_pro_system_prompt,
            },
            "anthropic": {
                "provider": "Anthropic",
                "model": cfg.anthropic_model,
                "reasoning_budget": cfg.anthropic_thinking_budget,
                "web_search": True,
                "system_prompt": cfg.anthropic_system_prompt,
            },
            "gemini_flash": {
                "provider": "Google",
                "model": cfg.gemini_flash_model,
                "role": "middle_ranking_and_composer",
                "system_prompt": cfg.moderator_system_prompt,
            },
        },
        "opinions": [o.to_dict() for o in opinions],
        "moderator": moderator,
    }


def validate_council_connectivity(*, live: bool = False) -> dict[str, Any]:
    """Validate model/provider configuration and optionally perform live probe calls."""
    cfg = CouncilConfig.from_env()
    base = {
        "live_probe": bool(live),
        "providers": {
            "openai": {
                "model": cfg.openai_model,
                "api_key_present": bool(cfg.openai_api_key),
                "system_prompt_preview": _trim(cfg.openai_system_prompt, 140),
            },
            "gemini_pro": {
                "model": cfg.gemini_pro_model,
                "api_key_present": bool(cfg.gemini_api_key),
                "system_prompt_preview": _trim(cfg.gemini_pro_system_prompt, 140),
            },
            "anthropic": {
                "model": cfg.anthropic_model,
                "api_key_present": bool(cfg.anthropic_api_key),
                "system_prompt_preview": _trim(cfg.anthropic_system_prompt, 140),
            },
            "gemini_flash": {
                "model": cfg.gemini_flash_model,
                "api_key_present": bool(cfg.gemini_api_key),
                "system_prompt_preview": _trim(cfg.moderator_system_prompt, 140),
            },
        },
        "errors": [],
    }

    if not cfg.openai_api_key:
        base["errors"].append("Missing OPENAI_API_KEY")
    if not cfg.gemini_api_key:
        base["errors"].append("Missing GEMINI_API_KEY or GOOGLE_API_KEY")
    if not cfg.anthropic_api_key:
        base["errors"].append("Missing ANTHROPIC_API_KEY")

    if not live:
        base["ok"] = len(base["errors"]) == 0
        return base

    probe_question = "Connectivity probe: reply exactly with OK."
    openai_probe = _run_openai(
        probe_question,
        "",
        cfg,
        system_prompt=cfg.openai_system_prompt,
    )
    gemini_probe = _run_gemini_expert(
        provider_key="gemini_pro",
        provider_label="Google Gemini Pro",
        model=cfg.gemini_pro_model,
        question=probe_question,
        case_context="",
        cfg=cfg,
        with_grounding=True,
        system_prompt=cfg.gemini_pro_system_prompt,
    )
    anthropic_probe = _run_anthropic(
        probe_question,
        "",
        cfg,
        system_prompt=cfg.anthropic_system_prompt,
    )

    probe_results = {
        "openai": openai_probe.to_dict(),
        "gemini_pro": gemini_probe.to_dict(),
        "anthropic": anthropic_probe.to_dict(),
    }
    base["probe_results"] = probe_results
    base["ok"] = (
        openai_probe.success
        and gemini_probe.success
        and anthropic_probe.success
    )
    return base
