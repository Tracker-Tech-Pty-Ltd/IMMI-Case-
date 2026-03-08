"""LLM Council orchestration for multi-provider legal reasoning.

This module executes a 3-model council:
1) OpenAI (web search enabled, medium reasoning)
2) Google Gemini Pro (Google grounding enabled, medium reasoning)
3) Anthropic Sonnet (web search enabled, high reasoning)

Then asks Gemini Flash to act as the judging/composition model and
produce ranking, critiques, votes, and a synthesized answer.
"""

from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from itertools import combinations
from typing import Any

import requests

OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages"

URL_RE = re.compile(r"https?://[^\s)>\"]+")
FULL_LAW_CITE_RE = re.compile(
    r"\b([A-Z][A-Za-z0-9&'().,\- ]{2,}?\s(?:Act|Acts|Regulation|Regulations|Rules)\s\d{4}"
    r"(?:\s*\([^)]+\))?\s+(?:s|ss|section|sections|reg|regs|regulation|rule)\.?\s*"
    r"\d+[A-Za-z]*(?:\([0-9A-Za-z]+\))*)",
    flags=re.IGNORECASE,
)

DEFAULT_OPENAI_SYSTEM_PROMPT = (
    "Role: Senior legal research counsel for Australian immigration matters. "
    "Output objective: produce rigorous legal research analysis, not legal advice. "
    "Required method: issue framing, governing rule identification, application, counterarguments, and confidence assessment. "
    "Evidence discipline: never invent authorities, never fabricate quotations, and distinguish verified facts from assumptions. "
    "Jurisdiction discipline: prioritize Australian legislation, tribunal/court reasoning, procedural fairness, jurisdictional error, and evidentiary burden. "
    "Output format requirements: "
    "(1) Key legal issues, "
    "(2) Strongest arguments, "
    "(3) Weaknesses and litigation risks, "
    "(4) Evidence gaps and what to verify next, "
    "(5) Targeted research actions. "
    "If uncertainty exists, state it explicitly and explain why."
)

DEFAULT_GEMINI_PRO_SYSTEM_PROMPT = (
    "Role: Senior legal research counsel specialized in grounded-source verification for Australian immigration matters. "
    "Primary duty: use grounded search evidence and clearly cite source links when available. "
    "Source hierarchy: legislation and delegated legislation first, then tribunal/court decisions, then official policy guidance. "
    "Reasoning discipline: separate legal rules, factual premises, inferences, and unresolved uncertainties. "
    "Strict constraints: do not invent citations, do not overclaim source content, and mark any point that is not source-verified. "
    "Output format requirements: "
    "(1) Verified legal framework, "
    "(2) Argument map for applicant vs decision-maker, "
    "(3) Procedural and evidentiary vulnerabilities, "
    "(4) Authorities and source links used, "
    "(5) Next research and document-check steps. "
    "Do not provide legal advice; provide research-oriented analysis only."
)

DEFAULT_ANTHROPIC_SYSTEM_PROMPT = (
    "Role: Senior adversarial legal analyst for Australian immigration research. "
    "Primary duty: stress-test the case theory by identifying strongest and weakest arguments on both sides. "
    "Reasoning standard: high-depth chain of legal analysis including assumptions, counterfactuals, and failure modes. "
    "Risk focus: procedural fairness defects, jurisdictional error theories, credibility findings, statutory criteria mismatch, and proof deficiencies. "
    "Strict constraints: no fabricated authorities, no unsupported factual claims, and explicit confidence levels for each major conclusion. "
    "Output format requirements: "
    "(1) Best-case arguments, "
    "(2) Best rebuttals, "
    "(3) Critical risks likely to fail review, "
    "(4) Evidence required to improve position, "
    "(5) Prioritized litigation/research checklist. "
    "Do not provide legal advice; provide research-oriented analysis only."
)

DEFAULT_MODERATOR_SYSTEM_PROMPT = (
    "Role: Presiding legal moderator for an Australian immigration LLM council (research-only, not legal advice). "
    "Decision standard: evaluate each model answer as if preparing counsel's internal legal memorandum. "
    "Mandatory scoring criteria (equal weight): "
    "(1) legal correctness against Australian migration law framework, "
    "(2) authority discipline and verifiability, "
    "(3) quality of statutory interpretation and application to facts, "
    "(4) procedural fairness and review-ground issue spotting, "
    "(5) practical usefulness for litigation/research next steps. "
    "Evidence discipline: do not invent facts, authorities, citations, quotations, holdings, or confidence levels. "
    "Attribution discipline: any conclusion must be traceable to at least one model output; if not, mark as uncertainty. "
    "Comparative duty: identify true convergence vs superficial wording overlap, and preserve material minority reasoning. "
    "Authority mapping duty: extract statutory/regulatory sections for each model separately, then identify only sections genuinely common to all successful models. "
    "Output discipline: concise but auditable findings in strict JSON, with conflict-aware synthesis."
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


def _as_string_list(value: Any, *, max_items: int = 12) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        text = str(item).strip()
        if not text:
            continue
        out.append(text)
        if len(out) >= max_items:
            break
    return _dedupe(out)


def _normalize_vote(raw: Any) -> str:
    vote = str(raw or "").strip().lower()
    if vote in {"support", "approve", "accept"}:
        return "support"
    if vote in {"oppose", "reject"}:
        return "oppose"
    if vote in {"neutral", "mixed", "partial"}:
        return "neutral"
    return "neutral"


def _normalize_law_section(text: str) -> str:
    value = str(text or "").strip()
    if not value:
        return ""
    value = re.sub(r"\bsections?\b", "s", value, flags=re.IGNORECASE)
    value = re.sub(r"\bss\b", "s", value, flags=re.IGNORECASE)
    value = re.sub(r"\bregs?\b", "reg", value, flags=re.IGNORECASE)
    value = re.sub(r"\bregulation\b", "reg", value, flags=re.IGNORECASE)
    value = re.sub(r"\s+", " ", value).strip(" \t\r\n;,.")
    return value


def _law_section_key(text: str) -> str:
    normalized = _normalize_law_section(text).lower()
    normalized = re.sub(r"[^a-z0-9]+", "", normalized)
    return normalized


def _dedupe_law_sections(values: list[str], *, max_items: int = 25) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in values:
        item = _normalize_law_section(raw)
        if not item:
            continue
        key = _law_section_key(item)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= max_items:
            break
    return out


def _extract_law_sections_from_text(text: str, *, max_items: int = 25) -> list[str]:
    if not text:
        return []
    matches = [match.group(1).strip() for match in FULL_LAW_CITE_RE.finditer(text)]
    return _dedupe_law_sections(matches, max_items=max_items)


def _build_provider_law_sections(
    raw: Any,
    *,
    opinions: list[CouncilOpinion],
    allowed_provider_keys: set[str],
) -> dict[str, list[str]]:
    provider_law_sections: dict[str, list[str]] = {}

    raw_map = raw if isinstance(raw, dict) else {}
    for provider_key in sorted(allowed_provider_keys):
        from_raw = _as_string_list(raw_map.get(provider_key), max_items=25)
        inferred = _extract_law_sections_from_text(
            next((o.answer for o in opinions if o.provider_key == provider_key), ""),
            max_items=25,
        )
        merged = _dedupe_law_sections(from_raw + inferred, max_items=25)
        if merged:
            provider_law_sections[provider_key] = merged

    return provider_law_sections


def _compute_shared_law_sections(
    *,
    provider_law_sections: dict[str, list[str]],
    provider_order: list[str],
) -> list[str]:
    if not provider_order:
        return []

    key_sets: list[set[str]] = []
    representative: dict[str, str] = {}
    for provider_key in provider_order:
        items = provider_law_sections.get(provider_key, [])
        if not items:
            return []
        keys = {_law_section_key(item) for item in items if _law_section_key(item)}
        if not keys:
            return []
        key_sets.append(keys)
        for item in items:
            key = _law_section_key(item)
            if key and key not in representative:
                representative[key] = item

    shared_keys = set.intersection(*key_sets) if key_sets else set()
    if not shared_keys:
        return []

    first_provider_items = provider_law_sections.get(provider_order[0], [])
    first_order = {
        _law_section_key(item): idx for idx, item in enumerate(first_provider_items)
    }
    shared = [
        representative[key]
        for key in shared_keys
        if key in representative
    ]
    shared.sort(key=lambda item: first_order.get(_law_section_key(item), 999))
    return _dedupe_law_sections(shared, max_items=25)


def _compute_shared_law_sections_confidence(
    *,
    provider_law_sections: dict[str, list[str]],
    provider_order: list[str],
    shared_law_sections: list[str],
) -> tuple[int, str]:
    if len(provider_order) < 3:
        return (
            0,
            "Three successful expert model outputs are required for three-model citation consistency scoring.",
        )

    provider_sets: list[set[str]] = []
    for provider_key in provider_order:
        entries = provider_law_sections.get(provider_key, [])
        keys = {_law_section_key(entry) for entry in entries if _law_section_key(entry)}
        if not keys:
            return (
                0,
                f"{provider_key} has no identifiable statutory/regulatory section citation for consistency scoring.",
            )
        provider_sets.append(keys)

    union_keys = set().union(*provider_sets)
    if not union_keys:
        return (
            0,
            "No identifiable statutory/regulatory section citation was found across successful expert outputs.",
        )

    shared_keys = {
        _law_section_key(section)
        for section in shared_law_sections
        if _law_section_key(section)
    }
    if not shared_keys:
        shared_keys = set.intersection(*provider_sets)

    intersection_ratio = len(shared_keys) / len(union_keys)

    pairwise_scores: list[float] = []
    for left, right in combinations(provider_sets, 2):
        union_pair = left | right
        if not union_pair:
            continue
        pairwise_scores.append(len(left & right) / len(union_pair))
    pairwise_mean = (
        sum(pairwise_scores) / len(pairwise_scores)
        if pairwise_scores
        else intersection_ratio
    )

    # Weight shared-all overlap highest, with pairwise overlap as secondary signal.
    confidence = round((0.75 * intersection_ratio + 0.25 * pairwise_mean) * 100)
    confidence = max(0, min(100, confidence))
    reason = (
        f"Shared-all overlap: {len(shared_keys)}/{len(union_keys)} unique sections; "
        f"mean pairwise citation overlap: {pairwise_mean * 100:.1f}%."
    )
    return confidence, reason


def _extract_urls(*chunks: str) -> list[str]:
    matches: list[str] = []
    for chunk in chunks:
        if not chunk:
            continue
        matches.extend(URL_RE.findall(chunk))
    return _dedupe(matches)


def _build_user_prompt(question: str, case_context: str) -> str:
    structure = (
        "Please provide a structured research answer with: "
        "(1) Key legal issues and governing tests, "
        "(2) How the user-provided case-study facts (which may not be in public records) map to those legal tests, "
        "(3) Viable defense/argument strategies for the applicant, "
        "(4) Most likely outcome with confidence level and conditions, "
        "(5) Counterarguments and failure risks, "
        "(6) Case-based support: cite which cases support each key conclusion "
        "(prefer case_id/citation from provided context when available), "
        "(7) Draft mock judgment outline (non-binding, research simulation only) including findings, reasoning path, and likely orders, "
        "(8) Evidence gaps and next research steps."
    )
    if case_context:
        return (
            f"User question:\n{question}\n\n"
            f"Case context:\n{case_context}\n\n"
            f"{structure}"
        )
    return (
        f"User question:\n{question}\n\n"
        f"{structure}"
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
    raw_prompt: bool = False,
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

    user_prompt = question.strip() if raw_prompt else _build_user_prompt(question, case_context)
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
    successful_keys = {o.provider_key for o in successful}
    successful_provider_order = [o.provider_key for o in successful]
    provider_law_sections = _build_provider_law_sections(
        raw={},
        opinions=opinions,
        allowed_provider_keys=successful_keys,
    )
    shared_law_sections = _compute_shared_law_sections(
        provider_law_sections=provider_law_sections,
        provider_order=successful_provider_order,
    )
    shared_law_confidence_percent, shared_law_confidence_reason = (
        _compute_shared_law_sections_confidence(
            provider_law_sections=provider_law_sections,
            provider_order=successful_provider_order,
            shared_law_sections=shared_law_sections,
        )
    )
    if not successful:
        return {
            "success": False,
            "ranking": [],
            "model_critiques": [],
            "vote_summary": {
                "winner_provider_key": "",
                "winner_provider_label": "",
                "winner_reason": "",
                "support_count": 0,
                "neutral_count": 0,
                "oppose_count": 0,
            },
            "agreement_points": [],
            "conflict_points": ["No successful model output was available for comparison."],
            "provider_law_sections": {},
            "shared_law_sections": [],
            "shared_law_sections_confidence_percent": 0,
            "shared_law_sections_confidence_reason": "No successful expert outputs are available for consistency scoring.",
            "composed_answer": "No model produced a usable answer.",
            "mock_judgment": "",
            "consensus": "Unavailable",
            "disagreements": "Unavailable",
            "outcome_likelihood_percent": 0,
            "outcome_likelihood_label": "unknown",
            "outcome_likelihood_reason": "Unavailable due to missing successful model outputs.",
            "law_sections": [],
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
    model_critiques = []
    for idx, op in enumerate(successful):
        vote = "support" if idx == 0 else "neutral"
        model_critiques.append(
            {
                "provider_key": op.provider_key,
                "provider_label": op.provider_label,
                "score": max(1, 100 - idx * 8),
                "vote": vote,
                "strengths": "Produced a usable structured answer under fallback mode.",
                "weaknesses": "Detailed cross-model legal critique unavailable in fallback mode.",
                "critique": "Fallback judgement based on response completeness only.",
            }
        )

    winner = model_critiques[0] if model_critiques else None
    composed_answer = "\n\n".join(
        f"[{op.provider_label}] {op.answer}" for op in successful[:2]
    )
    mock_judgment = composed_answer

    return {
        "success": True,
        "ranking": ranking,
        "model_critiques": model_critiques,
        "vote_summary": {
            "winner_provider_key": winner["provider_key"] if winner else "",
            "winner_provider_label": winner["provider_label"] if winner else "",
            "winner_reason": "Fallback winner is selected by response completeness.",
            "support_count": 1 if winner else 0,
            "neutral_count": max(0, len(model_critiques) - 1),
            "oppose_count": 0,
        },
        "agreement_points": [
            "All successful model outputs should be manually verified against legislation and authorities."
        ],
        "conflict_points": [
            "Fallback mode cannot reliably resolve doctrinal conflicts across model answers."
        ],
        "provider_law_sections": provider_law_sections,
        "shared_law_sections": shared_law_sections,
        "shared_law_sections_confidence_percent": shared_law_confidence_percent,
        "shared_law_sections_confidence_reason": shared_law_confidence_reason,
        "composed_answer": composed_answer,
        "mock_judgment": mock_judgment,
        "consensus": "Partial consensus generated via fallback path.",
        "disagreements": "Possible conflicts remain; review each model opinion.",
        "outcome_likelihood_percent": 50,
        "outcome_likelihood_label": "medium",
        "outcome_likelihood_reason": "Fallback estimate based on limited synthesis confidence.",
        "law_sections": [],
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
        "You are the judging and composition stage for an LLM council.\n"
        "Input JSON:\n"
        f"{json.dumps(prompt_payload, ensure_ascii=False)}\n\n"
        "Return STRICT JSON with this exact shape:\n"
        "{\n"
        '  "ranking": [\n'
        '    {"provider_key":"openai|gemini_pro|anthropic","score":0-100,"reason":"..."}\n'
        "  ],\n"
        '  "model_critiques": [\n'
        '    {"provider_key":"openai|gemini_pro|anthropic","score":0-100,"vote":"support|neutral|oppose","strengths":"...","weaknesses":"...","critique":"..."}\n'
        "  ],\n"
        '  "vote_summary": {\n'
        '    "winner_provider_key":"openai|gemini_pro|anthropic",\n'
        '    "winner_reason":"...",\n'
        '    "support_count":0,\n'
        '    "neutral_count":0,\n'
        '    "oppose_count":0\n'
        "  },\n"
        '  "agreement_points":["...", "..."],\n'
        '  "conflict_points":["...", "..."],\n'
        '  "provider_law_sections": {\n'
        '    "openai":["Migration Act 1958 (Cth) s 36"],\n'
        '    "gemini_pro":["Migration Act 1958 (Cth) s 36"],\n'
        '    "anthropic":["Migration Act 1958 (Cth) s 36"]\n'
        "  },\n"
        '  "shared_law_sections":["Migration Act 1958 (Cth) s 36"],\n'
        '  "consensus":"... ",\n'
        '  "disagreements":"... ",\n'
        '  "outcome_likelihood_percent":0-100,\n'
        '  "outcome_likelihood_label":"high|medium|low|unknown",\n'
        '  "outcome_likelihood_reason":"... ",\n'
        '  "law_sections":["Migration Act 1958 (Cth) s 36", "Migration Act 1958 (Cth) s 424A"],\n'
        '  "mock_judgment":"... ",\n'
        '  "composed_answer":"... ",\n'
        '  "follow_up_questions":["...", "..."]\n'
        "}\n"
        "Requirements:\n"
        "- Rank only providers that succeeded.\n"
        "- Use legal-memo style audit reasoning: issue, rule, application, vulnerability.\n"
        "- Critique each successful model answer with concrete legal-quality reasoning.\n"
        "- Cast one vote per successful model using support/neutral/oppose.\n"
        "- Identify agreement_points (true overlap) and conflict_points (material divergence).\n"
        "- Include provider_law_sections for each successful model using only statutes/regulations explicitly cited in that model answer.\n"
        "- shared_law_sections must contain only sections present across all successful models.\n"
        "- Focus on Australian immigration case research quality.\n"
        "- Write mock_judgment as a non-binding research simulation, explicitly based on provided facts and precedent context.\n"
        "- Provide a conservative outcome likelihood percentage with short justification.\n"
        "- List likely relevant statutory or regulatory sections to review.\n"
        "- Mention uncertainty explicitly when evidence is weak.\n"
        "- Do not add unsupported legal claims, and do not output markdown or prose outside JSON.\n"
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
        raw_prompt=True,
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

    successful_keys = {
        o.provider_key for o in opinions if o.success and o.answer.strip()
    }
    provider_labels = {
        o.provider_key: o.provider_label for o in opinions
    }

    ranking_raw = parsed.get("ranking")
    ranking: list[dict[str, Any]] = []
    seen_rank_keys: set[str] = set()
    if isinstance(ranking_raw, list):
        for idx, item in enumerate(ranking_raw):
            if not isinstance(item, dict):
                continue
            provider_key = str(item.get("provider_key", "")).strip()
            if not provider_key or provider_key not in successful_keys or provider_key in seen_rank_keys:
                continue
            score_raw = item.get("score", 0)
            try:
                score = int(score_raw)
            except Exception:
                score = 0
            ranking.append(
                {
                    "rank": idx + 1,
                    "provider_key": provider_key,
                    "provider_label": provider_labels.get(provider_key, provider_key or "unknown"),
                    "score": max(0, min(100, score)),
                    "reason": str(item.get("reason", "")).strip(),
                }
            )
            seen_rank_keys.add(provider_key)

    if not ranking:
        ranking = _fallback_moderator(opinions)["ranking"]
    else:
        ranking.sort(key=lambda item: item["score"], reverse=True)
        for idx, entry in enumerate(ranking):
            entry["rank"] = idx + 1

    ranking_key_order = [entry["provider_key"] for entry in ranking]

    critiques_raw = parsed.get("model_critiques")
    model_critiques: list[dict[str, Any]] = []
    seen_critique_keys: set[str] = set()
    if isinstance(critiques_raw, list):
        for item in critiques_raw:
            if not isinstance(item, dict):
                continue
            provider_key = str(item.get("provider_key", "")).strip()
            if not provider_key or provider_key not in successful_keys or provider_key in seen_critique_keys:
                continue
            score_raw = item.get("score", 0)
            try:
                score = int(score_raw)
            except Exception:
                score = 0
            model_critiques.append(
                {
                    "provider_key": provider_key,
                    "provider_label": provider_labels.get(provider_key, provider_key),
                    "score": max(0, min(100, score)),
                    "vote": _normalize_vote(item.get("vote")),
                    "strengths": str(item.get("strengths", "")).strip(),
                    "weaknesses": str(item.get("weaknesses", "")).strip(),
                    "critique": str(item.get("critique", "")).strip(),
                }
            )
            seen_critique_keys.add(provider_key)

    if not model_critiques:
        for entry in ranking:
            model_critiques.append(
                {
                    "provider_key": entry["provider_key"],
                    "provider_label": entry["provider_label"],
                    "score": entry["score"],
                    "vote": "support" if entry["rank"] == 1 else "neutral",
                    "strengths": "",
                    "weaknesses": "",
                    "critique": entry.get("reason", ""),
                }
            )
            seen_critique_keys.add(entry["provider_key"])

    # Ensure every successful model has a critique row.
    for provider_key in sorted(successful_keys):
        if provider_key in seen_critique_keys:
            continue
        model_critiques.append(
            {
                "provider_key": provider_key,
                "provider_label": provider_labels.get(provider_key, provider_key),
                "score": 0,
                "vote": "neutral",
                "strengths": "",
                "weaknesses": "",
                "critique": "",
            }
        )

    order_index = {key: idx for idx, key in enumerate(ranking_key_order)}
    model_critiques.sort(key=lambda item: order_index.get(item["provider_key"], 999))

    vote_summary_raw = parsed.get("vote_summary")
    if not isinstance(vote_summary_raw, dict):
        vote_summary_raw = {}
    winner_key = str(vote_summary_raw.get("winner_provider_key", "")).strip()
    if winner_key not in successful_keys and ranking:
        winner_key = ranking[0]["provider_key"]
    winner_label = provider_labels.get(winner_key, winner_key)

    winner_reason = str(vote_summary_raw.get("winner_reason", "")).strip()
    if not winner_reason and ranking:
        winner_reason = ranking[0].get("reason", "")

    support_count = sum(1 for item in model_critiques if item.get("vote") == "support")
    neutral_count = sum(1 for item in model_critiques if item.get("vote") == "neutral")
    oppose_count = sum(1 for item in model_critiques if item.get("vote") == "oppose")

    def _safe_count(value: Any, fallback: int) -> int:
        try:
            parsed_count = int(value)
        except Exception:
            return fallback
        return max(0, parsed_count)

    support_count = _safe_count(vote_summary_raw.get("support_count"), support_count)
    neutral_count = _safe_count(vote_summary_raw.get("neutral_count"), neutral_count)
    oppose_count = _safe_count(vote_summary_raw.get("oppose_count"), oppose_count)

    likelihood_raw = parsed.get("outcome_likelihood_percent", 0)
    try:
        likelihood_percent = int(likelihood_raw)
    except Exception:
        likelihood_percent = 0
    likelihood_percent = max(0, min(100, likelihood_percent))

    likelihood_label = str(parsed.get("outcome_likelihood_label", "")).strip().lower()
    if likelihood_label not in {"high", "medium", "low", "unknown"}:
        likelihood_label = "unknown"

    law_sections = _as_string_list(parsed.get("law_sections"), max_items=20)
    follow_up = _as_string_list(parsed.get("follow_up_questions"), max_items=10)
    agreement_points = _as_string_list(parsed.get("agreement_points"), max_items=10)
    conflict_points = _as_string_list(parsed.get("conflict_points"), max_items=10)
    provider_law_sections = _build_provider_law_sections(
        parsed.get("provider_law_sections"),
        opinions=opinions,
        allowed_provider_keys=successful_keys,
    )
    shared_law_sections = _compute_shared_law_sections(
        provider_law_sections=provider_law_sections,
        provider_order=ranking_key_order or sorted(successful_keys),
    )
    shared_law_confidence_percent, shared_law_confidence_reason = (
        _compute_shared_law_sections_confidence(
            provider_law_sections=provider_law_sections,
            provider_order=ranking_key_order or sorted(successful_keys),
            shared_law_sections=shared_law_sections,
        )
    )

    consensus = str(parsed.get("consensus", "")).strip()
    disagreements = str(parsed.get("disagreements", "")).strip()
    if not consensus and agreement_points:
        consensus = " | ".join(agreement_points[:3])
    if not disagreements and conflict_points:
        disagreements = " | ".join(conflict_points[:3])

    composed_answer = str(parsed.get("composed_answer", "")).strip() or mod_opinion.answer
    mock_judgment = str(parsed.get("mock_judgment", "")).strip() or composed_answer

    return {
        "success": True,
        "ranking": ranking,
        "model_critiques": model_critiques,
        "vote_summary": {
            "winner_provider_key": winner_key,
            "winner_provider_label": winner_label,
            "winner_reason": winner_reason,
            "support_count": support_count,
            "neutral_count": neutral_count,
            "oppose_count": oppose_count,
        },
        "agreement_points": agreement_points,
        "conflict_points": conflict_points,
        "provider_law_sections": provider_law_sections,
        "shared_law_sections": shared_law_sections,
        "shared_law_sections_confidence_percent": shared_law_confidence_percent,
        "shared_law_sections_confidence_reason": shared_law_confidence_reason,
        "consensus": consensus,
        "disagreements": disagreements,
        "outcome_likelihood_percent": likelihood_percent,
        "outcome_likelihood_label": likelihood_label,
        "outcome_likelihood_reason": str(
            parsed.get("outcome_likelihood_reason", "")
        ).strip(),
        "law_sections": law_sections,
        "mock_judgment": mock_judgment,
        "composed_answer": composed_answer,
        "follow_up_questions": follow_up,
        "raw_text": mod_opinion.answer,
        "error": "",
        "latency_ms": elapsed,
    }


def run_immi_council(question: str, case_context: str = "") -> dict[str, Any]:
    """Run the 3-model council and produce judge/rank/vote synthesis with Gemini Flash."""
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
                "role": "judge_rank_vote_and_composer",
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
