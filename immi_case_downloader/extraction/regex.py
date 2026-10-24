"""Regex extraction helpers for text already loaded in memory.

The legacy ``extract_structured_fields.py`` script is CLI-shaped and reads text
from case_text files. This module reuses its helper functions without changing
that script's behaviour, so the Cloudflare container endpoint can extract from
R2-provided text directly.

Pattern definitions live in ``patterns.py`` inside this package. The
repo-root ``extract_structured_fields.py`` CLI imports the same module, so
the two extraction paths cannot drift.
"""

from __future__ import annotations

import re
from typing import Any

from .patterns import (
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
        "case_nature": _case_nature(text, _text(base.get("catchwords")), title),
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


def _case_nature(text: str, catchwords: str, title: str = "") -> str:
    if _has_explicit_citizenship_subject(title, catchwords, text):
        return "Citizenship"

    s200_deportation_review = re.search(
        r"\bs\s*200\b.{0,220}\bshould\s+not\s+be\s+exercised\s+to\s+deport\b",
        catchwords,
        re.I | re.S,
    )
    deportation_order_review = re.search(
        r"\bDeportation\s+Order\b.{0,400}\b(?:applied|lodged\s+an\s+application)\b"
        r".{0,240}\b(?:to\s+the\s+)?Tribunal\b.{0,240}\breview\s+of\s+this\s+decision\b",
        text[:5000],
        re.I | re.S,
    )
    legacy_s200_deportation_review = bool(
        re.search(
            r"\bunder\s+s\.?\s*200\b.{0,260}\bMigration\s+Act\b.{0,120}"
            r"\bto\s+deport\s+the\s+applicant\b",
            text[:5500],
            re.I | re.S,
        )
        and re.search(
            r"\bthe\s+applicant\b.{0,180}\bapplied\s+to\s+(?:the\s+)?Tribunal\b"
            r".{0,120}\bfor\s+review\s+of\s+(?:this|that)\s+decision\b",
            text[:7000],
            re.I | re.S,
        )
        and not re.search(
            r"\b(?:visa\s+(?:refusal|cancellation|decision)|"
            r"refusal\s+of\s+(?:the\s+)?visa|cancellation\s+of\s+(?:the\s+)?visa|"
            r"review\s+of\s+(?:the\s+)?visa)\b",
            catchwords,
            re.I,
        )
    )
    visa_decision_subject = re.search(
        r"\b(?:visa\s+(?:refusal|cancellation|decision)|"
        r"refusal\s+of\s+(?:the\s+)?visa|cancellation\s+of\s+(?:the\s+)?visa|"
        r"review\s+of\s+(?:the\s+)?visa)\b",
        catchwords,
        re.I,
    )
    criminal_deportation_review = bool(
        re.search(r"\bcriminal\s+deportation\b", catchwords, re.I)
        and re.search(
            r"\b(?:Migration\s+Act\s+1958|s(?:ection)?\.?\s*200)\b",
            catchwords + "\n" + text[:8000],
            re.I,
        )
        and re.search(
            r"\bdecision\s+under\s+review\b.{0,300}\bnot\s+be\s+deported\b",
            text[:5000],
            re.I | re.S,
        )
        and not visa_decision_subject
    )
    s200_deportation_judicial_review = bool(
        re.search(
            r"\bdeportation\s+of\s+non-citizens\b.{0,300}"
            r"\bdeportation\s+order\s+under\s+s\.?\s*200\b",
            text[:4000],
            re.I | re.S,
        )
        and re.search(r"\bjudicial\s+review\b", text[:8000], re.I)
        and not visa_decision_subject
    )
    if (
        (s200_deportation_review and deportation_order_review)
        or legacy_s200_deportation_review
        or criminal_deportation_review
        or s200_deportation_judicial_review
    ):
        return "Deportation review"

    # Treat the official catchwords as the case subject. A later reference to
    # another visa in the reasons can be background only (for example, a
    # previous visa held by a sponsor).
    if _has_partner_visa_catchword(catchwords, text):
        return "Partner visa"
    if _has_skilled_migration_catchword(catchwords, text):
        return "Skilled migration"

    student_guardian_decision = re.search(
        r"(?ims)^[ \t]*DECISION\s*:\s*.{0,800}\bstudent\s+guardian\s+visa\b",
        text[:2500],
    )
    if _has_protection_visa_catchword(catchwords, text):
        return "Protection visa"
    if (
        _has_student_visa_catchword(catchwords, text)
        or student_guardian_decision
    ):
        return "Student visa"
    if _has_character_catchword(catchwords, text):
        return "Character"

    official_subject = "\n".join(_official_catchword_subjects(catchwords, text))
    if re.search(r"\bFair\s+Work\b", official_subject, re.I) or re.search(
        r"\bindustrial\s+law\b.{0,180}\bunderpayment\b",
        official_subject,
        re.I | re.S,
    ):
        return "Fair Work"
    if re.search(
        r"\b(?:agency|domain\s+name|taxation|goods\s+and\s+services\s+tax)\b",
        official_subject,
        re.I,
    ) and re.search(r"\bappeal\b", official_subject, re.I):
        return "Appeal"
    if re.search(r"\baviation\s+(?:transport\s+)?security\b|\bregulated\s+air\s+cargo\s+agent\b", official_subject, re.I):
        if re.search(r"\bapplication\s+for\s+judicial\s+review\b", official_subject, re.I):
            return "Judicial review"
        if re.search(r"\bmerits\s+review\b", official_subject, re.I):
            return "Merits review"
        if re.search(
            r"\b(?:practice\s+and\s+procedure|interlocutory|summons|stay|suppression|non-publication)\b",
            official_subject,
            re.I,
        ):
            return "Practice and procedure"
        if re.search(
            r"\breview\s+of\s+(?:the\s+)?decision\b|\bdecision\s+under\s+review\b",
            official_subject,
            re.I,
        ):
            return "Merits review"
        return "Other"
    if re.search(r"\bsecurity\s+for\s+costs\b", official_subject, re.I):
        return "Costs"
    if re.search(r"\bpractice\s+and\s+procedure\b", official_subject, re.I):
        return "Practice and procedure"
    if re.search(
        r"\b(?:consumer\s+law|economic\s+torts?|extradition|criminal\s+law(?:\s+and\s+procedure)?)\b",
        official_subject,
        re.I,
    ):
        return "Other"
    if re.search(
        r"\b(?:corporations?\b.{0,160}\bmeeting\s+of\s+creditors|"
        r"corporate\s+insolvency|administrators?\s+appointed|"
        r"second\s+meeting\s+of\s+creditors)\b",
        official_subject,
        re.I | re.S,
    ):
        return "Other"
    if (
        re.search(r"(?i)\bON\s+APPEAL\s+FROM\s+THE\s+FEDERAL\s+(?:CIRCUIT\s+)?COURT\b", text[:9000])
        and re.search(r"(?i)\bthe\s+appeal\b", text[:12000])
    ):
        return "Appeal"
    return ""


def _official_catchword_subjects(catchwords: str, text: str) -> list[str]:
    subjects = [str(catchwords or "")]
    catchword_block = re.search(
        r"(?is)\bCATCHWORDS\b\s*:?\s*(.{0,1600}?)"
        r"(?=\b(?:LEGISLATION|DECISION RECORD|WRITTEN STATEMENT OF DECISION|"
        r"STATEMENT OF DECISION AND REASONS|REVIEW APPLICANT)\b|\Z)",
        (text or "")[:12000],
    )
    if catchword_block:
        subjects.append(catchword_block.group(1))
    return [subject for subject in subjects if subject.strip()]


def _has_partner_visa_catchword(catchwords: str, text: str) -> bool:
    subjects = _official_catchword_subjects(catchwords, text)

    patterns = (
        r"\bpartner\s*\([^)]{1,100}\)(?:\s*\([^)]{1,100}\))*\s+visa\b",
        r"\bpartner\s+visa\b",
        r"\bsubclass\s*300\b.{0,120}\bprospective\s+marriage\b",
        r"\bprospective\s+marriage\b.{0,120}\bvisa\b",
    )
    return any(
        re.search(pattern, subject, re.I | re.S)
        for subject in subjects
        if subject.strip()
        for pattern in patterns
    )


def _has_skilled_migration_catchword(catchwords: str, text: str) -> bool:
    subjects = _official_catchword_subjects(catchwords, text)
    patterns = (
        r"\bskilled\s+(?:migration|visa)\b",
        r"\b(?:direct\s+entry|temporary\s+residence\s+transition)\s+"
        r"nomination\s+stream\b",
        r"\bemployer\s+nomination\s+scheme\b",
    )
    return any(
        re.search(pattern, subject, re.I | re.S)
        for subject in subjects
        for pattern in patterns
    )


def _has_protection_visa_catchword(catchwords: str, text: str) -> bool:
    patterns = (
        r"\bprotection\s+(?:\([^)]{1,80}\)\s*)?visa\b",
        r"\brefugee\s+visa\b",
        r"\brefugees\b",
    )
    return any(
        re.search(pattern, subject, re.I | re.S)
        for subject in _official_catchword_subjects(catchwords, text)
        for pattern in patterns
    )


def _has_student_visa_catchword(catchwords: str, text: str) -> bool:
    patterns = (
        r"\bstudent\s+(?:guardian\s+)?visa\b",
        r"\bgenuine\s+temporary\s+entrant\b",
    )
    return any(
        re.search(pattern, subject, re.I | re.S)
        for subject in _official_catchword_subjects(catchwords, text)
        for pattern in patterns
    )


def _has_character_catchword(catchwords: str, text: str) -> bool:
    patterns = (
        r"\bcharacter\s+(?:test|grounds?|consideration)\b",
        r"\bs\s*\.?\s*501\b",
    )
    return any(
        re.search(pattern, subject, re.I | re.S)
        for subject in _official_catchword_subjects(catchwords, text)
        for pattern in patterns
    )


def _has_explicit_citizenship_subject(title: str, catchwords: str, text: str) -> bool:
    """Recognize citizenship decisions from a title or the source's subject heading.

    AustLII pages may place the heading on the same line as a member's name,
    split it across lines, or retain a damaged en dash as ``\uFFFD C``. Only
    the official catchwords block or an explicit legacy tribunal heading is
    considered; mentions in the reasons do not change the case subject.
    """
    def normalize_heading(value: str) -> str:
        value = (
            (value or "")
            .replace("\uFFFD", "-")
            .replace("\u2212", "-")
            .replace("\x96", "-")
            .replace("\x97", "-")
        )
        # Some older AustLII text files decode an en dash as "\uFFFD C".
        value = re.sub(r"[-–—][ \t]*C(?=\s)", "-", value)
        return re.sub(r"\s+", " ", value).strip()

    def clauses(value: str) -> list[str]:
        heading = normalize_heading(value)
        heading = re.sub(r"^catchwords\b\s*", "", heading, flags=re.IGNORECASE)
        heading = re.sub(r"^(?:[-–—:][ \t]*(?:C(?=[ \t]|$)[ \t]*)?)+", "", heading)
        return [part.strip() for part in re.split(r"\s*[-–—:]+\s*", heading) if part.strip()]

    def is_citizenship_issue(value: str) -> bool:
        clause = normalize_heading(value)
        if not clause:
            return False
        clause = re.sub(
            r"\bDepartment\s+of\s+Immigration\s+(?:and|&)\s+Citizenship\b|"
            r"\b(?:Assistant\s+)?Minister\s+for\s+Citizenship\s+and\s+Multicultural\s+Affairs\b|"
            r"\bMinister\s+of\s+Immigration\s+(?:and|&)\s+Citizenship\b|"
            r"\b(?:Assistant\s+)?Minister\s+for\s+Immigration(?:\s*,\s*|\s+(?:and|&)\s+)Citizenship"
            r"(?:,\s*Migrant\s+Services\s+and\s+Multicultural\s+Affairs|\s+and\s+Multicultural\s+Affairs)?\b",
            " ",
            clause,
            flags=re.I,
        )
        if re.match(r"^(?:Australian\s+)?citizenship\s+(?:and|&)\s+(?:migration|immigration)\b", clause, re.I):
            return False
        if re.match(r"^(?:Australian\s+)?citizenship\b", clause, re.I):
            remainder = re.sub(r"^(?:Australian\s+)?citizenship\b", "", clause, flags=re.I).strip()
            if re.match(r"^(?:migration|immigration|visa)\b", remainder, re.I):
                return False
            return bool(remainder)
        return bool(re.search(
            r"^(?:application|refusal|refused|revocation|revoking|cancellation|cancelled|"
            r"decision|eligibility|appeal|review|judicial review|certificate|register|registration|"
            r"extension of time)\b.{0,180}\b(?:Australian\s+)?citizenship\b|"
            r"^(?:whether|where)\b.{0,300}\b(?:application|grant|refusal|conferral|registration|"
            r"revocation|revok\w*|acquir\w*)\b.{0,100}\b(?:Australian\s+)?citizenship\b",
            clause,
            re.I,
        ))

    def has_citizenship_issue(value: str) -> bool:
        normalized = normalize_heading(value)
        if re.search(
            r"\b(?:discretion\s+under\s+)?s(?:ection)?\s*22\s*\(\s*9\s*\)(?!\w)"
            r".{0,100}\bAustralian\s+Citizenship\s+Act\b",
            normalized,
            re.I,
        ):
            return True
        if (
            re.search(r"\b(?:stay\s+application|application\s+for\s+stay)\b", normalized, re.I)
            and re.search(r"\bpending\s+determination\s+of\s+appeal\b", normalized, re.I)
            and re.search(r"\bAustralian\s+Citizenship\s+Act\b", normalized, re.I)
        ):
            return True
        parts = clauses(value)
        for index, part in enumerate(parts[:5]):
            if is_citizenship_issue(part):
                return True
            if normalize_heading(part).casefold() in {"citizenship", "australian citizenship"}:
                if index + 1 < len(parts) and is_citizenship_issue(
                    f"citizenship {parts[index + 1]}"
                ):
                    return True
        return False

    def legacy_split_heading(subject: str, continuation: str) -> bool:
        heading = normalize_heading(f"{subject} {continuation}")
        return bool(re.match(
            r"^(?:Australian\s+)?citizenship\s+Australia\s*[-–—:]\s*"
            r"(?:application|cancellation|refusal|revocation|eligibility|decision|grant)\b",
            heading,
            re.I,
        ))

    def has_current_visa_dispute(value: str) -> bool:
        parts = clauses(value)
        early_heading = " ".join(parts[:4])
        # A refugee/protection heading is the primary case type even when the
        # catchwords later discuss the applicant's citizenship or nationality.
        if parts and re.match(r"^(?:refugee|protection)\b", parts[0], re.I):
            if re.search(r"\bprotection\s+visa\b", early_heading, re.I):
                return True
        if (
            len(parts) >= 3
            and re.match(r"^migration\b", parts[0], re.I)
            and re.match(r"^protection\b", parts[1], re.I)
            and re.search(r"\b(?:subclass\s+\d+\s+)?visa\b", " ".join(parts[:3]), re.I)
        ):
            return True
        if (
            parts
            and re.match(r"^(?:migration|immigration)\b", parts[0], re.I)
            and re.search(r"\bapplication\s+for\s+(?:a\s+)?protection\s+visa\b", early_heading, re.I)
        ):
            return True

        action = re.compile(
            r"\b(?:visa\s+(?:refusal|refused|cancellation|cancelled|decision)|"
            r"application\s+for\s+(?:a\s+)?visa\s+(?:refused|rejected)|"
            r"refusing\s+to\s+grant\b.{0,120}\bvisa\b|"
            r"(?:refusal|refused|cancellation|cancelling|cancelled|decision\s+to\s+"
            r"(?:refuse|cancel)|review\s+of)\b.{0,100}\bvisa\b)",
            re.I,
        )
        for match in action.finditer(early_heading):
            prior_context = early_heading[max(0, match.start() - 60):match.start()]
            if re.search(r"\b(?:previous|prior|past|historical|former)\s+(?:\w+\s+){0,3}$", prior_context, re.I):
                continue
            return True
        # In a mixed judgment, an application expressly seeking review or
        # revocation of a visa cancellation can appear after the citizenship
        # issue. Do not treat a merely historical visa cancellation as current.
        all_heading = " ".join(parts)
        return bool(re.search(
            r"\bapplication\b.{0,120}\b(?:revocation\s+of\s+(?:the\s+)?visa\s+cancellation|"
            r"(?:review|judicial\s+review)\s+of\s+(?:the\s+)?visa\s+cancellation)\b",
            all_heading,
            re.I,
        ))

    def has_migration_subject_override(value: str) -> bool:
        parts = clauses(value)
        return bool(
            parts
            and re.match(
                r"^(?:Australian\s+)?citizenship\s+(?:and|&)\s+(?:migration|immigration)\b",
                parts[0],
                re.I,
            )
            and len(parts) > 1
            and re.match(r"^(?:migration|immigration|refugee|protection|visa)\b", parts[1], re.I)
        )

    source = (text or "")[:12000]
    marker = re.search(r"\bcatchwords\b", source, re.IGNORECASE)
    section = ""
    if marker is not None:
        section = source[marker.end() :]
        end = re.search(
            r"(?im)^[ \t]*(?:legislation|cases(?:\s+cited)?|secondary materials|orders?|reasons for decision)\b",
            section,
        )
        if end:
            section = section[: end.start()]

    combined_heading = " ".join((catchwords or "", section or ""))
    if (
        has_current_visa_dispute(combined_heading)
        or has_migration_subject_override(section)
        or has_migration_subject_override(combined_heading)
    ):
        return False

    if re.search(r"\((?:Australian\s+)?citizenship\)", title or "", re.IGNORECASE):
        return True

    if catchwords and has_citizenship_issue(catchwords):
        return True

    if marker is not None and has_citizenship_issue(section):
        return True

    # Some Federal Court decisions identify the matter as CITIZENSHIP in the
    # formal case heading, immediately before the file number, rather than in
    # catchwords. Require the governing Act in the same opening section.
    if (
        re.search(
            r"(?im)^[ \t]*(?:AUSTRALIAN\s+)?CITIZENSHIP[ \t]+FILE\s+(?:NUMBER|NO\.? )\b",
            source[:5000],
        )
        and re.search(r"\bAustralian\s+Citizenship\s+Act\s+(?:19|20)\d{2}\b", source[:8000], re.I)
        and not has_current_visa_dispute(combined_heading)
    ):
        return True

    # Some older AAT files put the subject on a member's signature line, or
    # split "CITIZENSHIP / Australia – application ..." across two lines.
    # Do not search the body for the word: only inspect the initial heading.
    heading_end = re.search(
        r"(?im)^[ \t]*(?:legislation|cases(?:\s+cited)?|secondary materials|orders?|"
        r"reasons for (?:judgment|decision))\b",
        source[:5000],
    )
    source_lines = source[:heading_end.start() if heading_end else 5000].splitlines()
    for index, line in enumerate(source_lines):
        member_heading = re.search(
            r"\b(?:(?:senior|presiding|deputy|principal)\s+)?member\s+"
            r"(?=(?:Australian\s+)?citizenship\b)",
            line,
            re.IGNORECASE,
        )
        member_subject = line[member_heading.end():] if member_heading else ""
        if member_heading and re.fullmatch(r"(?:Australian\s+)?citizenship", normalize_heading(member_subject), re.I):
            continuation = " ".join(
                source_lines[next_index]
                for next_index in range(index + 1, min(index + 5, len(source_lines)))
                if source_lines[next_index].strip()
            )
            if not legacy_split_heading(member_subject, continuation):
                member_subject = ""
            else:
                member_subject = f"{member_subject} {continuation}"
        if member_heading and has_current_visa_dispute(member_subject):
            continue
        if member_heading and has_citizenship_issue(member_subject):
            return True
        cleaned_line = normalize_heading(line)
        if re.fullmatch(r"(?:Australian\s+)?citizenship", cleaned_line, re.I):
            continuation = " ".join(
                source_lines[next_index]
                for next_index in range(index + 1, min(index + 5, len(source_lines)))
                if source_lines[next_index].strip()
            )
            if legacy_split_heading(line, continuation) and has_citizenship_issue(f"{line} {continuation}"):
                return True
    return False


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
