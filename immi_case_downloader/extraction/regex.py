"""Regex extraction helpers for text already loaded in memory.

The legacy ``extract_structured_fields.py`` script is CLI-shaped and reads text
from case_text files. This module reuses its helper functions without changing
that script's behaviour, so the Cloudflare container endpoint can extract from
R2-provided text directly.
"""

from __future__ import annotations

import re
from typing import Any

from extract_structured_fields import (
    RE_AATA_APPLICANT,
    RE_AATA_REPRESENTATIVE,
    extract_country,
    extract_from_title,
    extract_hearing_date,
    extract_legal_test,
    extract_representation,
    extract_visa_outcome_reason,
    extract_visa_subclass_number,
)

FieldEnvelope = dict[str, Any]


def extract_regex(text: str, base: dict[str, Any] | None = None) -> dict[str, FieldEnvelope]:
    """Extract structured fields from a single case's full text.

    Returns field envelopes in the same shape consumed by the Worker:
    ``{"value": ..., "confidence": 0.0-1.0, "source": "regex"}``.
    Empty values are represented as ``None`` so the LLM fallback can decide
    which fields are still unfilled.
    """

    base = base or {}
    text = text or ""
    title = _text(base.get("title"))
    visa_subclass = _text(base.get("visa_subclass"))
    visa_type = _text(base.get("visa_type"))

    applicant_name, respondent = extract_from_title(title)
    applicant_name, respondent = _fill_party_names_from_text(
        text,
        applicant_name=applicant_name,
        respondent=respondent,
    )

    is_represented, representative = extract_representation(text) if text else ("", "")
    if not representative and text:
        is_represented, representative = _fill_representative_from_text(
            text,
            is_represented=is_represented,
            representative=representative,
        )

    values = {
        "applicant_name": applicant_name,
        "respondent": respondent,
        "country_of_origin": extract_country(text) if text else "",
        "visa_subclass_number": extract_visa_subclass_number(text, visa_subclass, visa_type),
        "hearing_date": extract_hearing_date(text) if text else "",
        "is_represented": is_represented,
        "representative": representative,
        "visa_outcome_reason": extract_visa_outcome_reason(text) if text else "",
        "legal_test_applied": extract_legal_test(text) if text else "",
        "case_nature": _case_nature(text, _text(base.get("catchwords"))),
        "legal_concepts": "",
    }

    return {
        field: {
            "value": value if value else None,
            "confidence": _confidence(field, value),
            "source": "regex",
        }
        for field, value in values.items()
    }


def _fill_party_names_from_text(
    text: str,
    *,
    applicant_name: str,
    respondent: str,
) -> tuple[str, str]:
    if not text:
        return applicant_name, respondent

    preamble = text[:3000]
    if not applicant_name:
        match = re.search(
            r"REVIEW\s+APPLICANT\s*:\s*\n?\s*([^\n]{2,80}?)(?:\n|$)",
            preamble,
            re.IGNORECASE,
        )
        if match:
            applicant_name = _clean_label_tail(match.group(1))

    if not applicant_name:
        match = RE_AATA_APPLICANT.search(preamble)
        if match:
            applicant_name = _clean_label_tail(match.group(1))

    if not applicant_name:
        match = re.search(r"Applicant/?s?\s*:\s*(.+?)(?:\n|$)", preamble, re.IGNORECASE)
        if match:
            applicant_name = _clean_label_tail(match.group(1))

    if not respondent:
        match = re.search(r"Respondent\s*:\s*(.+?)(?:\n|$)", preamble, re.IGNORECASE)
        if match:
            respondent = _clean_label_tail(match.group(1))

    return applicant_name, respondent


def _fill_representative_from_text(
    text: str,
    *,
    is_represented: str,
    representative: str,
) -> tuple[str, str]:
    match = RE_AATA_REPRESENTATIVE.search(text[:5000])
    if not match:
        return is_represented, representative

    rep_name = match.group(1).strip()
    if rep_name and not re.search(r"self[- ]represented|nil|none|n/a", rep_name, re.IGNORECASE):
        return "Yes", rep_name
    if re.search(r"self[- ]represented|nil|none|n/a", rep_name, re.IGNORECASE):
        return "No", ""
    return is_represented, representative


def _case_nature(text: str, catchwords: str) -> str:
    search = f"{catchwords}\n{text[:2500]}".lower()
    if "protection visa" in search or "refugee" in search:
        return "Protection visa"
    if "student visa" in search or "genuine temporary entrant" in search:
        return "Student visa"
    if "partner visa" in search:
        return "Partner visa"
    if "character" in search or "s 501" in search or "s.501" in search:
        return "Character"
    if "citizenship" in search:
        return "Citizenship"
    return ""


def _clean_label_tail(value: str) -> str:
    value = value.strip()
    value = re.sub(
        r"\s*(?:CASE\s*NUMBER|FILE\s*NUMBER|DIBP\s*REF|PRESIDING|TRIBUNAL|MRT).*$",
        "",
        value,
        flags=re.IGNORECASE,
    ).strip()
    if not value or value.replace(" ", "").isdigit() or len(value) <= 1:
        return ""
    return value


def _confidence(field: str, value: str) -> float:
    if not value:
        return 0.0
    if field in {"applicant_name", "respondent", "visa_subclass_number", "hearing_date"}:
        return 0.9
    if field in {"country_of_origin", "is_represented", "representative"}:
        return 0.75
    return 0.65


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()
