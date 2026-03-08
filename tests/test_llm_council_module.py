from __future__ import annotations

import json

import immi_case_downloader.llm_council as llm_council


def _dummy_cfg() -> llm_council.CouncilConfig:
    return llm_council.CouncilConfig(
        openai_model="test-openai",
        gemini_pro_model="test-gemini-pro",
        anthropic_model="test-anthropic",
        gemini_flash_model="test-gemini-flash",
        openai_reasoning_effort="medium",
        gemini_thinking_budget=0,
        anthropic_thinking_budget=0,
        max_output_tokens=512,
        timeout_seconds=5,
        openai_api_key="",
        gemini_api_key="",
        anthropic_api_key="",
        anthropic_version="2023-06-01",
        anthropic_web_search_beta="test-beta",
        openai_system_prompt="",
        gemini_pro_system_prompt="",
        anthropic_system_prompt="",
        moderator_system_prompt="",
    )


def _successful_opinions() -> list[llm_council.CouncilOpinion]:
    return [
        llm_council.CouncilOpinion(
            provider_key="openai",
            provider_label="OpenAI",
            model="test-openai",
            success=True,
            answer="Migration Act 1958 (Cth) s 36 may be engaged.",
        ),
        llm_council.CouncilOpinion(
            provider_key="gemini_pro",
            provider_label="Google Gemini Pro",
            model="test-gemini-pro",
            success=True,
            answer="Procedural fairness issues also point to Migration Act 1958 (Cth) s 424A.",
        ),
    ]


def test_fallback_moderator_builds_compact_synthesis_without_scope_errors():
    payload = llm_council._fallback_moderator(_successful_opinions())

    assert payload["success"] is True
    assert "[OpenAI]" in payload["composed_answer"]
    assert "[Google Gemini Pro]" in payload["composed_answer"]
    assert payload["mock_judgment"] == payload["composed_answer"]


def test_run_moderator_uses_parsed_mock_judgment_and_composed_answer(monkeypatch):
    moderator_payload = {
        "ranking": [
            {"provider_key": "openai", "score": 91, "reason": "Best structured answer."},
            {"provider_key": "gemini_pro", "score": 84, "reason": "Useful secondary analysis."},
        ],
        "model_critiques": [
            {
                "provider_key": "openai",
                "score": 91,
                "vote": "support",
                "strengths": "Strong statutory framing.",
                "weaknesses": "",
                "critique": "Most complete answer.",
            },
            {
                "provider_key": "gemini_pro",
                "score": 84,
                "vote": "neutral",
                "strengths": "Helpful procedural fairness angle.",
                "weaknesses": "",
                "critique": "Less complete than OpenAI.",
            },
        ],
        "vote_summary": {
            "winner_provider_key": "openai",
            "winner_reason": "Best structured answer.",
            "support_count": 1,
            "neutral_count": 1,
            "oppose_count": 0,
        },
        "agreement_points": ["Both answers identify review-ground risk."],
        "conflict_points": [],
        "provider_law_sections": {
            "openai": ["Migration Act 1958 (Cth) s 36"],
            "gemini_pro": ["Migration Act 1958 (Cth) s 424A"],
        },
        "shared_law_sections": [],
        "consensus": "Both answers identify review-ground risk.",
        "disagreements": "",
        "outcome_likelihood_percent": 62,
        "outcome_likelihood_label": "medium",
        "outcome_likelihood_reason": "Mixed but reviewable issues exist.",
        "law_sections": ["Migration Act 1958 (Cth) s 36"],
        "mock_judgment": "The Tribunal decision should be reconsidered.",
        "composed_answer": "The strongest issue is procedural fairness.",
        "follow_up_questions": ["What material was not put to the applicant?"],
    }

    def _fake_run_gemini_expert(**_kwargs):
        return llm_council.CouncilOpinion(
            provider_key="gemini_flash",
            provider_label="Google Gemini Flash (Moderator)",
            model="test-gemini-flash",
            success=True,
            answer=json.dumps(moderator_payload),
        )

    monkeypatch.setattr(llm_council, "_run_gemini_expert", _fake_run_gemini_expert)

    payload = llm_council._run_moderator(
        question="What are the strongest grounds for review?",
        case_context="Focus on procedural fairness.",
        opinions=_successful_opinions(),
        cfg=_dummy_cfg(),
    )

    assert payload["success"] is True
    assert payload["mock_judgment"] == "The Tribunal decision should be reconsidered."
    assert payload["composed_answer"] == "The strongest issue is procedural fairness."
