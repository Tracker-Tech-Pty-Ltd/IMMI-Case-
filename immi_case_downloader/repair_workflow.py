"""Offline, resumable review of missing local case metadata.

The review ledger separates missing facts from work still to do. Identical
evidence is not reviewed again. No model, network client, or paid API is used.
An explicit evidence approval file is required before catalogue writes.
"""
from __future__ import annotations

import csv
import contextlib
import hashlib
import json
import os
import re
import shutil
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .extraction.grounded import (
    CORE_FIELDS,
    RULE_VERSION,
    Evidence,
    assess_case,
    canonical_citation,
    citation_from_url,
)
from .extraction.regex import _case_nature

VISA_METADATA_FIELDS = ("visa_subclass", "visa_class_code", "visa_subclass_number")
REPAIR_FIELDS = CORE_FIELDS + VISA_METADATA_FIELDS + ("case_nature", "full_text_path", "text_snippet")

# Historical subclass-to-class mappings used only to validate an individually
# reviewed metadata correction. The current visa must still be independently
# identified from that case's own source before these mappings are applied.
_VISA_CLASS_BY_SUBCLASS = {
    "100": "BC",
    "485": "VC",
    "500": "TU",
    "570": "TU",
    "571": "TU",
    "572": "TU",
    "573": "TU",
    "574": "TU",
    "575": "TU",
    "576": "TU",
    "785": "XD",
    "790": "XE",
    "801": "BS",
    "866": "XA",
    "885": "VB",
}

REASONS = {
    "author_not_stated": "可核對原文沒有明列裁決者，不從案件名稱或其他案件推斷",
    "operative_orders_not_available": "沒有可核對的正式裁決／命令；不把擬議命令、法律原則或事實認定當成結果",
    "current_visa_not_stated": "未明列本案審查的簽證；歷史簽證、法條舉例及其他人的簽證不足以填入",
    "conflicting_current_visa_candidates": "有多個簽證候選，無法確認本案審查的是哪一個",
    "identity_conflict": "原文印載案號與目錄不符，須先確認來源身分",
    "identity_unverified": "原文沒有可核對案號，須先確認來源身分",
    "restricted_publication": "裁決理由未公開或受公開限制",
    "incomplete_publication": "目前來源只有標題／短片段，沒有完整裁決理由",
    "source_missing": "本機尚無可讀取原文，等待新的可靠公開來源",
    "evidence_review": "找到候選，須核對原文與簽證關係後才能核准寫入",
    "export_conflict": "不同本機資料檔已有非空值，保留原值並等待核對",
    "payment_card_litigation_not_immigration": "本案是 Visa 信用卡公司的商業訴訟，簽證類別不適用",
    "non_immigration_commercial_dispute": "原文摘要顯示本案審理一般商業糾紛，並非移民或簽證審查；簽證類別不適用",
    "no_current_visa_decision": "原文明確確認沒有任何簽證撤銷決定可供審查；簽證類別不適用並保留空白",
    "employment_case_not_a_personal_visa": "原文摘要顯示本案審理勞資、工業法或職災賠償事項，不是個人簽證審查；簽證類別不適用",
    "security_card_case_not_a_personal_visa": "原文摘要顯示本案審理航空或海事保安識別卡，不是個人簽證審查；簽證類別不適用",
    "freedom_of_information_not_a_visa_decision": "原文摘要顯示本案審理資訊公開或文件披露，不是簽證決定；簽證類別不適用",
    "corporate_deregistration_not_a_personal_visa": "原文摘要顯示本案審理公司註銷或登記，不是個人簽證審查；簽證類別不適用",
    "citizenship_review_not_a_visa_application": "本案審理公民身分申請，簽證類別不適用",
    "citizenship_matter_not_a_visa_decision": "原判決標題或官方 catchwords 明確標示公民權事項；本案沒有審查特定簽證決定，簽證類別不適用",
    "detention_proceeding_not_a_visa_decision": "官方 catchwords 顯示本案審理拘留、遣返或驅逐事項，且未提及簽證、簽證 subclass 或 s 501；簽證類別不適用",
    "migration_agent_registration_not_a_personal_visa": "本案審理移民代理人的註冊或紀律事項，並非個人簽證審查；簽證類別不適用",
    "sponsorship_or_nomination_not_a_personal_visa": "本案審理雇主提名、職位或擔保人核准，並非個人簽證申請；簽證類別不適用",
    "ministerial_intervention_not_a_visa_review": "原文摘要顯示本案審查部長介入請求，沒有審查特定簽證決定；簽證類別不適用",
    "publication_explicitly_marks_visa_applicant_not_applicable": "裁決原文明列簽證申請人不適用；保留為不適用",
    "ancillary_costs_dispute_no_current_visa_review": "本案僅處理費用爭議，沒有審查本案特定簽證決定；簽證類別不適用",
    "non_immigration_discrimination_case": "本案審理歧視申訴及期限問題，簽證僅是背景資料；簽證類別不適用",
    "non_immigration_election_dispute": "本案審理地方選舉資格及票數重算，並非簽證決定；簽證類別不適用",
    "social_security_case_not_a_personal_visa": "本案審理社會保障事項，並非個人簽證決定；簽證類別不適用",
    "non_visa_decision_visa_as_background": "本案未審查簽證決定；原文提及簽證僅作背景資料",
    "detention_case_visa_background": "本案審理羈留或釋放；提及簽證僅為歷史背景",
}

_LEGACY_REASON_CODE_ALIASES = {
    "本案主題為資訊公開；沒有可確認的本案特定簽證，不臆造類別。": "freedom_of_information_not_a_visa_decision",
    "原文的正式 DECISION 直接顯示本案處理企業擔保／雇主提名核准或其覆核資格，不是個人簽證申請，因此簽證類別不適用。": "sponsorship_or_nomination_not_a_personal_visa",
    "案件原文的正式決定或案件摘要明確顯示本案處理企業擔保、雇主提名或職位提名；這不是個人簽證申請，因此簽證類別不適用。簽證欄位保持空白。": "sponsorship_or_nomination_not_a_personal_visa",
    "本案主題為公民資格；沒有可確認的本案特定簽證，不臆造類別。": "citizenship_matter_not_a_visa_decision",
    "本案主題為支付卡監管；沒有可確認的本案特定簽證，不臆造類別。": "payment_card_litigation_not_immigration",
    "案件原文明確顯示本案處理企業擔保、雇主或職位提名，或擔保義務；裁決標的不是個人簽證類別，因此此欄不適用並維持空白。": "sponsorship_or_nomination_not_a_personal_visa",
    "原文的訴訟標的是逾期提出的殘障歧視申訴及是否延長期限；學生簽證只是較早的背景經歷，不是本案裁決的簽證類別，因此清除先前誤填並保留空白。": "non_immigration_discrimination_case",
    "本案審理公民身分申請、撤銷或恢復；簽證是歷史背景，非本案爭議簽證": "citizenship_matter_not_a_visa_decision",
    "原文首頁及裁決內容確認本案只處理企業擔保、提名或核准職位；沒有審理個人簽證類別，visa_type 不適用並保留空白。": "sponsorship_or_nomination_not_a_personal_visa",
    "原文標題摘要及法院命令均顯示案件審理移民代理人除名／登記決定；不是個人簽證申請。": "migration_agent_registration_not_a_personal_visa",
    "原文處理區域議會選舉資格、票數重算及補選；移民部長為聲請人並不代表本案涉及簽證。": "non_immigration_election_dispute",
    "本案主題為僱傭；沒有可確認的本案特定簽證，不臆造類別。": "employment_case_not_a_personal_visa",
    "本案審查的是公民權核准取消決定；原文說明 Class BF 簽證已先前被強制取消，且該簽證取消決定不能在本 Tribunal 程序中提出覆核。visa_type 不適用。": "citizenship_matter_not_a_visa_decision",
    "官方判決標題或 catchwords 明確標示公民權案件；原文審查公民權決定而非特定簽證決定，因此簽證類別不適用，欄位保留空白。": "citizenship_matter_not_a_visa_decision",
    "本案為公民身分或移民代理註冊／行為或資訊公開審查，原文所提簽證屬背景資料": "non_visa_decision_visa_as_background",
    "本案主題為移民代理註冊／紀律；沒有可確認的本案特定簽證，不臆造類別。": "migration_agent_registration_not_a_personal_visa",
    "公開裁決表格明列 VISA APPLICANT (S): N/A；本案處理 Standard Business Sponsorship 的複審申請逾期，不是特定簽證申請的審理。": "publication_explicitly_marks_visa_applicant_not_applicable",
    "本案處理羈留及釋放；保護簽證只屬1998年背景，並非本案審理的簽證類別。": "detention_case_visa_background",
    "本案主題為社會保障；沒有可確認的本案特定簽證，不臆造類別。": "social_security_case_not_a_personal_visa",
}


def _normalize_reason_code(value: Any) -> str:
    """Convert legacy free-text reason labels into stable, readable codes."""
    text = str(value or "")
    if text in REASONS:
        return text
    if text in _LEGACY_REASON_CODE_ALIASES:
        return _LEGACY_REASON_CODE_ALIASES[text]
    return next((code for code, label in REASONS.items() if label == text), text)


def _source_limitation_reason(row: dict[str, Any], source_text: str) -> str:
    """Classify explicit publication restrictions and verified AustLII page shells."""
    normalized = " ".join(source_text.casefold().split())
    if (
        re.search(
            r"direction to restrict publication of information.*?whole of (?:the )?decision",
            normalized,
        )
        or re.search(
            r"this judgment is not available at the present time.{0,120}s\.?\s*180",
            normalized,
        )
    ):
        return "restricted_publication"

    parsed = urlparse(str(row.get("url", "")))
    host = (parsed.hostname or "").casefold()
    if parsed.scheme != "https" or not (host == "austlii.edu.au" or host.endswith(".austlii.edu.au")):
        return ""

    separator = re.search(r"(?m)^={10,}\s*$", source_text)
    if not separator:
        return ""
    header = {}
    for line in source_text[:separator.start()].splitlines():
        match = re.match(r"^(Title|Citation|URL):\s*(.*?)\s*$", line)
        if match and match[2].strip():
            header.setdefault(match[1].casefold(), match[2].strip())
    citation = str(row.get("citation", "")).strip()
    case_url = str(row.get("url", "")).strip()
    if (
        not citation
        or header.get("citation") != citation
        or header.get("url") != case_url
        or citation not in header.get("title", "")
    ):
        return ""

    body = source_text[separator.end():]
    if (
        "specific year" not in body.casefold()
        or not re.search(r"(?i)print\s*\(pretty\)|print\s*\(eco-friendly\)", body)
        or not re.search(
            r"(?i)(?:RTF format\s*\([^)]*\)|Download RTF format\s*\([^)]*\)|No downloadable files available)",
            body,
        )
    ):
        return ""

    title = header["title"].strip()
    chrome = {
        "specific year", "any", "apply", "-->", "print", "print (pretty)",
        "print (eco-friendly)", "print print (pretty)", "lawcite records",
        "noteup references", "tweet this page", "follow @austlii on twitter",
        "signed pdf/a format", "no downloadable files available",
    }
    for raw_line in body.splitlines():
        line = " ".join(raw_line.split()).strip()
        folded = line.casefold()
        if not line or line == citation or line == title or folded in chrome:
            continue
        if re.fullmatch(r"\d{4}", line):
            continue
        if re.fullmatch(r"(?:download )?RTF format\s*\([^)]*\)", line, re.I):
            continue
        if re.fullmatch(r"\d{3,}\s+" + re.escape(citation) + r"(?:\s+\([^)]*\))?", line):
            continue
        return ""
    return "incomplete_publication"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def digest(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def encode(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(value, ensure_ascii=False, indent=2))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def blank(value: Any) -> bool:
    return value is None or str(value).strip() == ""


def source_path(root: Path, value: str) -> Path | None:
    if not value:
        return None
    path = Path(value)
    path = path if path.is_absolute() else root / path
    path = path.resolve()
    # The local catalogue must not read arbitrary paths supplied by a source.
    if not path.is_relative_to(root.resolve()):
        return None
    return path if path.is_file() else None


def _austlii_catchwords_visa_evidence(case: dict[str, Any]) -> Evidence | None:
    """Use only explicit AustLII catchwords that name the visa in this case.

    Catchwords are stored separately from the local decision text. This narrow
    fallback covers direct case labels when the downloaded text omits that
    header; generic mentions, bare visa refusals, and conflicted body evidence
    remain unresolved.
    """
    from urllib.parse import urlparse

    if str(case.get("source", "")).strip().casefold() != "austlii":
        return None
    if urlparse(str(case.get("url", ""))).hostname not in {"austlii.edu.au", "www.austlii.edu.au"}:
        return None
    catchwords = str(case.get("catchwords", "") or "")
    if not catchwords:
        return None

    # Some RN decisions mention a visa application only to explain that the
    # employer's nomination was the issue. That wording does not identify a
    # visa decision made about the applicant.
    if re.search(
        r"\bwhether nomination for the position to which the visa application related was approved\b",
        catchwords,
        re.I,
    ):
        return None
    procedural_cost_review = (
        re.search(r"\b(?:judicial\s+)?registrar['\u2019]s\s+decision\b", catchwords, re.I)
        and re.search(r"\bcosts?\b", catchwords, re.I)
    )
    explicit_visa_merits = re.search(
        r"\b(?:visa\s+(?:refusal|cancellation)|refusal\s+to\s+grant|"
        r"refusal\s+of\s+(?:the\s+)?[\w()/-]+\s+visa|"
        r"review\s+of\s+(?:the\s+)?visa|decision\s+to\s+cancel)\b",
        catchwords,
        re.I,
    )
    if procedural_cost_review and not explicit_visa_merits:
        return None

    # Several migration decisions list more than one visa class in the
    # catchwords. A single-field result cannot safely choose among them.
    class_codes = set(re.findall(r"\bclass\s+([A-Z]{2})\b", catchwords, re.I))
    subclass_codes = set(re.findall(r"\bsubclass\s+(\d{3})\b", catchwords, re.I))
    if len(class_codes) > 1 or len(subclass_codes) > 1:
        return None
    # These decisions expressly concern two different visa types even though
    # only one class code appears in the catchwords.
    if (re.search(r"\babsorbed person visa\b", catchwords, re.I)
            and re.search(r"\bclass\s+BF\b", catchwords, re.I)):
        return None

    rules: list[tuple[str, str]] = [
        (
            r"\b(Skilled\s*\(Provisional\)\s*\(Class\s+VC\)\s+visa)\b",
            "skilled_provisional_class_vc",
        ),
        (
            r"\b(Skilled\s*\(Residence\)\s*\(Class\s+VB\)\s+visa)\b",
            "skilled_residence_class_vb",
        ),
        (
            r"\b(Student\s*\(Temporary\)\s*\(Class\s+TU\)\s+visa)\b",
            "student_temporary_class_tu",
        ),
        (
            r"\b(Partner\s*\(Temporary\)\s*\(Class\s+UK\)\s+visa)\b",
            "partner_temporary_class_uk",
        ),
        (
            r"\b(Medical Treatment\s*\(Visitor\)\s*\(Class\s+UB\)\s+visa)\b",
            "medical_treatment_visitor_class_ub",
        ),
        (
            r"\b(Business Skills\s*\(Residence\)\s*\(Class\s+DF\)\s+visas?)\b",
            "business_skills_residence_class_df",
        ),
        (
            r"\b(Business Skills\s*\(Residence\)\s*\(Class\s+VF\)\s+visas?)\b",
            "business_skills_residence_class_vf",
        ),
        (
            r"\b(Temporary Business Entry\s*\(Class\s+UC\)\s+visas?)\b",
            "temporary_business_entry_class_uc",
        ),
        (
            r"\b(Partner\s*\(Residence\)\s*\(Class\s+BS\)\s+visa)\b",
            "partner_residence_class_bs",
        ),
        (
            r"\b(Return\s*\(Residence\)\s*\(Class\s+BB\)\s+visa)\b",
            "return_residence_class_bb",
        ),
        (
            r"\b(Employer Nomination\s*\(Residence\)\s*\(Class\s+BW\)\s+visa)\b",
            "employer_nomination_residence_class_bw",
        ),
        (
            r"\b(Regional Employer Nomination\s*,?\s*\(Permanent\)\s*,?\s*\(Class\s+RN\)\s+visas?)\b",
            "regional_employer_nomination_permanent_class_rn",
        ),
        (
            r"\b(Employer Nomination\s*\(Permanent\)\s*\(Class\s+EN\)\s+visas?)\b",
            "employer_nomination_permanent_class_en",
        ),
        (
            r"\b(Skilled Work Regional\s*\(Provisional\)\s*\(Class\s+PS\)\s+visa)\b",
            "skilled_work_regional_provisional_class_ps",
        ),
        (
            r"\b(Other Family\s*\(Residence\)\s*\(Class\s+BU\)\s+visa)\b",
            "other_family_residence_class_bu",
        ),
        (
            r"\b(Class\s+BF\s+Transitional\s*\(Permanent\)\s+visa)\b",
            "class_bf_transitional_permanent",
        ),
        (
            r"\b(Prospective Marriage\s*\(Temporary\)\s*\(Class\s+TO\)\s+visa)\b",
            "prospective_marriage_class_to",
        ),
        (
            r"\b(Partner\s*\(Migrant\)\s*\(Class\s+BC\)\s+visa)\b",
            "partner_migrant_class_bc",
        ),
        (
            r"\b(Partner\s*\(Provisional\)\s*\(Class\s+UF\)\s+visa)\b",
            "partner_provisional_class_uf_heading",
        ),
        (r"\b(Business Skills\s*\(Residence\)\s+visa)\b", "business_skills_residence"),
        (r"\b(Business Skills\s*\(Provisional\)\s+visas?)\b", "business_skills_provisional"),
        (r"\b(Temporary Business Entry\s+visa)\b", "temporary_business_entry"),
        (r"\b(Temporary Work\s*\(Skilled\)\s+visa)\b", "temporary_work_skilled"),
        (r"\b(Safe Haven Enterprise\s+visas?)\b", "safe_haven_enterprise"),
        (r"\b(Medical Treatment\s*\(Support Person\)\s+visa)\b", "medical_treatment_support_person"),
        (r"\b(Medical Treatment\s+visas?)\b", "medical_treatment"),
        (r"\b(Skilled Graduate\s+visa)\b", "skilled_graduate"),
        (r"\b(Skilled Migrant\s+visa)\b", "skilled_migrant"),
        (r"\b(Skilled Independent\s+visa)\b", "skilled_independent"),
        (r"\b(Skilled residence visa)\b", "skilled_residence"),
        (r"\b(skilled-nominated visa)\b", "skilled_nominated"),
        (r"\b(carer['’]s visa)\b", "carer_visa"),
        (r"\b(?:regarding|concerning|in relation to)\s+(?:a\s+)?(protection visa)\b", "protection_visa_context"),
        (
            r"\breview of visa refusal\s*[-–]\s*subclass\s+(\d{3})\s*[-–]\s*partner visa\b",
            "partner_subclass",
        ),
        (
            r"\baged dependent relative visa\b.{0,180}?\bvisa applicant meets the criteria for a subclass\s+(\d{3})\s+visa\b",
            "aged_dependent_relative",
        ),
        (
            r"\bcriteria for a (Partner \(Provisional\) \(Class UF\) visa)\b",
            "partner_provisional_class_uf",
        ),
        (r"\bMIGRATION\s*[–-]\s*(Bridging visa)\b", "bridging_visa_heading"),
        (
            r"\bcancellation of (class 104\s*\(preferential family\)\s*visa)\b",
            "class_104_preferential_family",
        ),
        (r"\breview of a (Visitor visa) refusal\b", "visitor_visa_refusal"),
        (r"\breview of visa refusal\s*[-–]\s*(Partner visa)\b", "partner_visa_refusal"),
        # AustLII catchwords are official case metadata. Accept a visa family
        # only when the catchwords explicitly tie it to this proceeding.
        (r"\bMIGRATION\s*[–-]\s*Protection visa\b", "protection_visa_heading"),
        (
            r"\b(?:protection visa\b.{0,100}\b(?:application|refusal|decision|appeal|review|claim|cancellation)\b|"
            r"(?:application|refusal|decision|appeal|review|claim|cancellation)\b.{0,100}\bprotection visa\b)",
            "protection_visa_proceeding",
        ),
        (r"\b(cancellation of a tourist visa)\b", "tourist_visa_cancellation"),
        (
            r"\bElectronic Travel Authority\s*\(\s*(visitor)\s*\)\s*visa\b",
            "visitor_eta_visa",
        ),
        (r"\bMIGRATION\s*[–-]\s*(Humanitarian visa)\b", "humanitarian_visa"),
        (r"\b(skilled migration visa)\b", "skilled_migration_visa"),
        (r"\bMIGRATION\s*[–-]\s*(Skilled visa)\b", "skilled_visa"),
        (
            r"\bMIGRATION\s*[–-]\s*(Skilled-Designated Area sponsored visa)\b",
            "skilled_designated_area_visa",
        ),
        (r"\bMIGRATION\s*[–-]\s*(Business visa)\b", "business_visa"),
        (
            r"\b(transitional\s+\(permanent\)\s+BF visa)\b",
            "transitional_permanent_bf_visa",
        ),
        (
            r"\b(Employer Nomination visa)\b\s*[-–]\s*refusal\b",
            "employer_nomination_visa_refusal",
        ),
        (r"\bvisa refusals?\s*[-–]\s*subclass\s+(\d{3})\b", "visa_refusal_subclass"),
    ]
    for pattern, rule in rules:
        # AustLII catchwords often wrap a single phrase across lines. DOTALL
        # does not make literal spaces match line breaks, so make pattern
        # spaces flexible while retaining offsets into the original text.
        match = re.search(pattern.replace(" ", r"\s+"), catchwords, re.I | re.S)
        if not match:
            continue
        if rule == "visa_refusal_subclass":
            value = f"Subclass {match[1]} visa"
        elif rule == "partner_subclass":
            value = f"Partner visa (subclass {match[1]})"
        elif rule == "aged_dependent_relative":
            value = f"Aged Dependent Relative visa (subclass {match[1]})"
        elif rule == "class_104_preferential_family":
            value = "Class 104 (Preferential Family) visa"
        elif rule.startswith("protection_visa"):
            value = "Protection visa"
        elif rule == "tourist_visa_cancellation":
            value = "Tourist visa"
        elif rule == "visitor_eta_visa":
            value = "Visitor visa"
        elif rule == "humanitarian_visa":
            value = "Humanitarian visa"
        elif rule == "skilled_migration_visa":
            value = "Skilled migration visa"
        elif rule == "skilled_visa":
            value = "Skilled visa"
        elif rule == "skilled_designated_area_visa":
            value = "Skilled-Designated Area sponsored visa"
        elif rule == "business_visa":
            value = "Business visa"
        elif rule == "skilled_provisional_class_vc":
            value = "Skilled (Provisional) (Class VC) visa"
        elif rule == "skilled_residence_class_vb":
            value = "Skilled (Residence) (Class VB) visa"
        elif rule == "student_temporary_class_tu":
            value = "Student (Temporary) (Class TU) visa"
        elif rule == "partner_temporary_class_uk":
            value = "Partner (Temporary) (Class UK) visa"
        elif rule == "medical_treatment_visitor_class_ub":
            value = "Medical Treatment (Visitor) (Class UB) visa"
        elif rule == "business_skills_residence_class_df":
            value = "Business Skills (Residence) (Class DF) visa"
        elif rule == "business_skills_residence_class_vf":
            value = "Business Skills (Residence) (Class VF) visa"
        elif rule == "temporary_business_entry_class_uc":
            value = "Temporary Business Entry (Class UC) visa"
        elif rule == "partner_residence_class_bs":
            value = "Partner (Residence) (Class BS) visa"
        elif rule == "return_residence_class_bb":
            value = "Return (Residence) (Class BB) visa"
        elif rule == "employer_nomination_residence_class_bw":
            value = "Employer Nomination (Residence) (Class BW) visa"
        elif rule == "regional_employer_nomination_permanent_class_rn":
            value = "Regional Employer Nomination (Permanent) (Class RN) visa"
        elif rule == "employer_nomination_permanent_class_en":
            value = "Employer Nomination (Permanent) (Class EN) visa"
        elif rule == "skilled_work_regional_provisional_class_ps":
            value = "Skilled Work Regional (Provisional) (Class PS) visa"
        elif rule == "other_family_residence_class_bu":
            value = "Other Family (Residence) (Class BU) visa"
        elif rule == "class_bf_transitional_permanent":
            value = "Class BF Transitional (permanent) visa"
        elif rule == "prospective_marriage_class_to":
            value = "Prospective Marriage (Temporary) (Class TO) visa"
        elif rule == "partner_migrant_class_bc":
            value = "Partner (Migrant) (Class BC) visa"
        elif rule == "partner_provisional_class_uf_heading":
            value = "Partner (Provisional) (Class UF) visa"
        elif rule == "business_skills_residence":
            value = "Business Skills (Residence) visa"
        elif rule == "business_skills_provisional":
            value = "Business Skills (Provisional) visa"
        elif rule == "temporary_business_entry":
            value = "Temporary Business Entry visa"
        elif rule == "temporary_work_skilled":
            value = "Temporary Work (Skilled) visa"
        elif rule == "safe_haven_enterprise":
            value = "Safe Haven Enterprise visa"
        elif rule == "medical_treatment_support_person":
            value = "Medical Treatment (Support Person) visa"
        elif rule == "medical_treatment":
            value = "Medical Treatment visa"
        elif rule == "skilled_graduate":
            value = "Skilled Graduate visa"
        elif rule == "skilled_migrant":
            value = "Skilled Migrant visa"
        elif rule == "skilled_independent":
            value = "Skilled Independent visa"
        elif rule == "skilled_residence":
            value = "Skilled (Residence) visa"
        elif rule == "skilled_nominated":
            value = "Skilled Nominated visa"
        elif rule == "carer_visa":
            value = "Carer visa"
        elif rule == "transitional_permanent_bf_visa":
            value = "Transitional (permanent) BF visa"
        else:
            value = match[1].strip()
        return Evidence(
            value=value,
            quote=catchwords[max(0, match.start() - 140):min(len(catchwords), match.end() + 180)],
            start=match.start(),
            end=match.end(),
            rule=f"austlii_catchwords_{rule}",
        )

    if str(case.get("case_nature", "")).strip().casefold() == "visa refusal":
        match = re.search(r"\bapplication for permanent residence\b".replace(" ", r"\s+"), catchwords, re.I)
        if match:
            return Evidence(
                value="Permanent residence visa",
                quote=catchwords[max(0, match.start() - 140):min(len(catchwords), match.end() + 180)],
                start=match.start(),
                end=match.end(),
                rule="austlii_catchwords_permanent_residence_refusal",
            )
    return None


def _austlii_catchwords_visa_not_applicable(case: dict[str, Any]) -> str | None:
    """Use explicit AustLII headings to classify matters without a visa dispute.

    Citizenship proceedings and nomination or sponsorship reviews are not
    personal visa decisions when the official title or catchwords do not
    identify any visa application, refusal, cancellation, or review. Do not
    infer this from a secondary source.
    """
    from urllib.parse import urlparse

    if str(case.get("source", "")).strip().casefold() != "austlii":
        return None
    if urlparse(str(case.get("url", ""))).hostname not in {"austlii.edu.au", "www.austlii.edu.au"}:
        return None
    catchwords = str(case.get("catchwords", "") or "")
    flattened_catchwords = " ".join(catchwords.split())
    title = str(case.get("title", "") or "")
    visa_decision = re.search(
        r"\b(?:visa\s+(?:refusal|cancellation|decision)|"
        r"refusal\s+of\s+(?:the\s+)?visa|"
        r"cancellation\s+of\s+(?:(?:the|applicant['’]s)\s+)?visa|"
        r"decision\s+to\s+cancel\s+(?:(?:the|applicant['’]s)\s+)?visa|"
        r"review\s+of\s+(?:the\s+)?visa)\b",
        flattened_catchwords,
        re.I,
    )
    visa_application = re.search(
        r"\b(?:visa\s+application|application\s+for\s+(?:the\s+)?(?:[A-Za-z][A-Za-z0-9()/-]*\s+){0,4}visa)\b",
        flattened_catchwords,
        re.I,
    )
    visa_case_reference = visa_decision or visa_application
    citizenship_title = re.search(r"\(\s*citizenship\s*\)", title, re.I)
    citizenship_catchwords = re.match(
        r"\s*(?:AUSTRALIAN\s+)?CITIZENSHIP\s*[-–—:]\s*\S",
        flattened_catchwords,
        re.I,
    )
    combined_citizenship_migration = re.search(
        r"\b(?:Australian\s+)?citizenship\s+and\s+(?:migration|immigration)\b",
        flattened_catchwords,
        re.I,
    )
    citizenship_heading = (citizenship_title or citizenship_catchwords) and not combined_citizenship_migration
    if citizenship_heading and not visa_decision:
        return "citizenship_matter_not_a_visa_decision"
    detention_proceeding = re.search(
        r"\b(?:detention|detained|habeas corpus|deportation|removal|immigration custody)\b",
        flattened_catchwords,
        re.I,
    )
    visa_or_subclass_reference = re.search(
        r"\bvisa\b|\bsubclass\s+\d{3}\b|\bclass\s+\d{2,3}\b|\bs\s*501\b",
        flattened_catchwords,
        re.I,
    )
    if detention_proceeding and not visa_case_reference and not visa_or_subclass_reference:
        return "detention_proceeding_not_a_visa_decision"
    if _austlii_catchwords_visa_evidence(case):
        return None
    if not re.search(r"\b(?:nomination|sponsor(?:ship)?)\b", flattened_catchwords, re.I):
        return None
    if visa_case_reference:
        return None
    return "sponsorship_or_nomination_not_a_personal_visa"


def _austlii_source_confirms_current_visa_decision(case: dict[str, Any], source_text: str) -> bool:
    """Require the judgment body to confirm sponsor-related visa catchwords.

    Some nomination proceedings concern only the employer's nomination, while
    others review an actual visa refusal that turned on the nomination. Keep
    the former not-applicable unless the source body states a current visa
    refusal/cancellation. The two case-nature labels below are already derived
    from the judgment's operative discussion.
    """
    if str(case.get("case_nature", "")).strip().casefold() in {"visa refusal", "visa cancellation"}:
        return True
    separator = re.search(r"(?m)^={10,}\s*$", source_text)
    if not separator:
        return False
    body = source_text[separator.end():]
    section = re.search(
        r"\b(?:APPLICATION\s+FOR\s+(?:JUDICIAL\s+)?REVIEW|"
        r"STATEMENT\s+OF\s+DECISION\s+AND\s+REASONS|"
        r"REASONS\s+FOR\s+(?:DECISION|JUDGMENT)|BACKGROUND)\b",
        body,
        re.I,
    )
    if not section:
        return False
    text = " ".join(body[section.start():section.start() + 16000].split())
    # A mention of a "visa applicant" in a nomination case is not a visa
    # disposition. Remove that phrase before looking for a refusal/cancellation.
    text = re.sub(r"\bvisa\s+applicants?\b", "visaperson", text, flags=re.I)
    return bool(re.search(
        r"\b(?:refus\w*|cancel\w*|revok\w*|non[- ]revocation)\b.{0,180}\bvisas?\b|"
        r"\bvisas?(?:\s+application)?\b.{0,180}\b(?:refus\w*|cancel\w*|revok\w*)\b|"
        r"\bnot\s+to\s+grant\b.{0,180}\bvisas?\b|"
        r"\bvisas?\b.{0,180}\bnot\s+to\s+grant\b",
        text,
        re.I,
    ))


def _source_anchored_visa_evidence(evidence: Evidence, source_text: str) -> Evidence | None:
    """Re-anchor AustLII catchword evidence to its matching local source text."""
    def flexible_literal(value: str) -> str:
        tokens = re.findall(r"\w+|[^\w\s]", value, flags=re.UNICODE)
        if not tokens:
            return r"(?!)"
        parts = [re.escape(tokens[0])]
        for previous, current in zip(tokens, tokens[1:]):
            separator = r"\s+" if previous[-1].isalnum() and current[0].isalnum() else r"\s*"
            parts.extend((separator, re.escape(current)))
        return r"(?<!\w)" + "".join(parts) + r"(?!\w)"

    source_start = 0
    separator = re.search(r"(?m)^={10,}\s*$", source_text)
    if separator:
        source_start = separator.end()

    def find(value: str) -> re.Match[str] | None:
        return re.search(flexible_literal(value), source_text[source_start:], re.I)

    match = find(evidence.quote)
    if match:
        start = source_start + match.start()
        end = source_start + match.end()
        return Evidence(evidence.value, source_text[start:end], start, end, evidence.rule)

    # Stored AustLII catchwords can be shortened or reflowed. If the complete
    # quote is absent, require the named visa itself to occur in this exact
    # source file and anchor the evidence to its original surrounding text.
    match = find(evidence.value)
    if not match:
        return None
    start = source_start + max(0, match.start() - 120)
    end = source_start + min(len(source_text[source_start:]), match.end() + 180)
    return Evidence(evidence.value, source_text[start:end], start, end, evidence.rule)


def _austlii_catchword_visa_proof(
    case: dict[str, Any], source_text: str, assessment: Any,
    old: dict[str, Any], source_hashes: set[str],
) -> Evidence | None:
    """Accept exact catchwords only when they are not incidental to another case."""
    if assessment.source_status != "checked":
        return None
    evidence = _austlii_catchwords_visa_evidence(case)
    if not evidence:
        return None
    not_applicable = assessment.not_applicable.get("visa_type")
    sponsorship_context = bool(re.search(
        r"\b(?:nomination|sponsor(?:ship)?)\b",
        " ".join(str(case.get("catchwords", "") or "").split()),
        re.I,
    ))
    source_confirms_visa = _austlii_source_confirms_current_visa_decision(case, source_text)
    if not_applicable == "sponsorship_or_nomination_not_a_personal_visa":
        allowed = source_confirms_visa
    elif not_applicable:
        allowed = False
    elif sponsorship_context:
        allowed = source_confirms_visa
    else:
        allowed = assessment.reasons.get("visa_type") == "current_visa_not_stated"
    prior_is_na = (
        old.get("fact_status") == "not_applicable"
        or str(old.get("status", "")).startswith("不適用")
    )
    if not_applicable is None and not sponsorship_context:
        allowed = allowed and not (
            prior_is_na and old.get("source_sha256") in source_hashes
        )
    if not allowed:
        return None
    return _source_anchored_visa_evidence(evidence, source_text)


@contextlib.contextmanager
def open_ledger(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS reviews (
            case_id TEXT NOT NULL, field TEXT NOT NULL, fingerprint TEXT NOT NULL,
            record TEXT NOT NULL, reviewed_utc TEXT NOT NULL,
            PRIMARY KEY(case_id, field));
        CREATE TABLE IF NOT EXISTS source_attempts (
            case_id TEXT NOT NULL, url TEXT NOT NULL, evidence_version TEXT NOT NULL,
            receipt TEXT NOT NULL, checked_utc TEXT NOT NULL,
            PRIMARY KEY(case_id, url, evidence_version));
        CREATE TABLE IF NOT EXISTS prior_status (
            case_id TEXT NOT NULL, field TEXT NOT NULL, record TEXT NOT NULL,
            PRIMARY KEY(case_id, field));
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    """)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def import_source_attempts(ledger: Path, queue: list[dict[str, Any]]) -> None:
    """Remember exhausted paths; no request is made just because a run repeats."""
    with open_ledger(ledger) as conn:
        for row in queue:
            conn.execute("INSERT OR IGNORE INTO source_attempts VALUES (?,?,?,?,?)",
                         (row["case_id"], row["url"], row.get("evidence_version", "prior-verified-attempts"),
                          encode(row), utc_now()))


def load_jev_cache(path: Path | None) -> dict[tuple[str, str, str], list[dict]]:
    """Read existing judgments only; confidence cannot authorize a data write."""
    result: dict[tuple[str, str, str], list[dict]] = {}
    if path is None:
        return result
    with contextlib.closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as conn:
        for request_hash, payload, response, model in conn.execute("SELECT request_hash,payload,response,model FROM judgments"):
            try:
                state = json.loads(payload)["state"]
                url = state.get("public_url", state.get("url", ""))
                identity = canonical_citation(state.get("citation", "")) or citation_from_url(url)
                key = (identity, state.get("public_source_sha256", state.get("source_sha256", "")), url)
                if not all(key):
                    continue
                result.setdefault(key, []).append({"request_hash": request_hash, "model": model,
                    "field_definition": state.get("field_definition", ""),
                    "answers": json.loads(response).get("answers", {})})
            except (KeyError, TypeError, ValueError):
                continue
    return result


def review_catalogue(root: Path, output: Path, *, ledger: Path,
                     prior_status: Path | None = None,
                     case_ids: set[str] | None = None,
                     jev_cache: Path | None = None) -> dict[str, Any]:
    """Review missing cells; cache only exact case metadata and source bytes."""
    root, output = root.resolve(), output.resolve()
    prior: dict[tuple[str, str], dict[str, str]] = {}
    if prior_status:
        with prior_status.open(encoding="utf-8-sig", newline="") as handle:
            prior = {(r["case_id"], r["field"]): r for r in csv.DictReader(handle)}
    records, proposals = [], []
    stats: Counter = Counter()
    jev_field_markers = {
        "visa_type": ("select the visa type currently in dispute",
                      "select the explicit visa name whose refusal/cancellation/non-revocation",
                      "identify the explicit visa or entry permit associated with this proceeding"),
        "judges": ("select the judge(s) or tribunal member(s) who issued this current judgment",
                   "who issued this judgment?"),
        "outcome": ("select the complete operative result of this current judgment",
                    "select the complete operative orders/result of this current judgment"),
        "case_nature": ("select the primary immigration subject of this dispute",
                        "classify this current proceeding using the supplied category definitions"),
    }
    with open_ledger(ledger) as settings:
        if jev_cache:
            settings.execute("INSERT OR REPLACE INTO settings VALUES ('jev_cache',?)", (str(jev_cache.resolve()),))
        else:
            saved = settings.execute("SELECT value FROM settings WHERE key='jev_cache'").fetchone()
            jev_cache = Path(saved[0]) if saved else None
    rules_sha = digest(Path(__file__).with_name("extraction") / "grounded.py")
    workflow_sha = digest(Path(__file__))
    model_cache = load_jev_cache(jev_cache)
    jev_cache_reader = (sqlite3.connect(jev_cache.resolve().as_uri() + "?mode=ro", uri=True)
                        if jev_cache else None)
    question_field_definitions: dict[str, str] = {}
    cache_sha = digest(jev_cache) if jev_cache else ""
    db = sqlite3.connect((root / "downloaded_cases/cases.db").as_uri() + "?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    with open_ledger(ledger) as cache:
        if prior_status:
            cache.executemany("INSERT OR REPLACE INTO prior_status VALUES (?,?,?)",
                              [(key[0], key[1], encode(row)) for key, row in prior.items()])
        else:
            prior = {(r["case_id"], r["field"]): json.loads(r["record"])
                     for r in cache.execute("SELECT * FROM prior_status")}
        for item in db.execute("SELECT * FROM cases WHERE judges IS NULL OR TRIM(judges)='' "
                               "OR outcome IS NULL OR TRIM(outcome)='' OR visa_type IS NULL OR TRIM(visa_type)='' ORDER BY case_id"):
            row = dict(item)
            if case_ids is not None and row["case_id"] not in case_ids:
                continue
            missing = [name for name in CORE_FIELDS if blank(row.get(name))]
            if not missing:
                continue
            path = source_path(root, row.get("full_text_path", ""))
            raw = path.read_bytes() if path else b""
            sha = hashlib.sha256(raw).hexdigest()
            # Earlier Windows/WSL audits hashed decoded text with universal
            # newlines. Preserve their N/A decisions only on matching content.
            legacy_sha = hashlib.sha256(raw.decode("utf-8", errors="replace").replace("\r\n", "\n").encode()).hexdigest()
            previous = {field: prior.get((row["case_id"], field), {}) for field in missing}
            identity = canonical_citation(row["citation"]) or citation_from_url(row["url"])
            cached_judgments = model_cache.get((identity, sha, row["url"]), []).copy()
            if legacy_sha != sha:
                cached_judgments += model_cache.get((identity, legacy_sha, row["url"]), [])
            fingerprint = hashlib.sha256(encode({
                "rule": RULE_VERSION, "rules_sha": rules_sha, "workflow_sha": workflow_sha,
                "source": sha, "cache_sha": cache_sha,
                "identity": {k: row.get(k) for k in ("citation", "title", "url", "full_text_path", "catchwords")},
                "prior": previous,
            }).encode()).hexdigest()
            decision = None
            for field in missing:
                expected_markers = jev_field_markers.get(field, ())
                field_cached_judgments = []
                for advice in cached_judgments:
                    if not advice.get("field_definition") and jev_cache_reader and advice.get("request_hash"):
                        request_hash = advice["request_hash"]
                        if request_hash not in question_field_definitions:
                            payload_row = jev_cache_reader.execute(
                                "SELECT payload FROM judgments WHERE request_hash=?", (request_hash,)
                            ).fetchone()
                            instruction = ""
                            if payload_row:
                                try:
                                    questions = json.loads(payload_row[0]).get("questions", {})
                                    selection_questions = (
                                        question
                                        for key, question in questions.items()
                                        if isinstance(question, dict)
                                        and (key == "select" or re.fullmatch(r"select_c\d+", key))
                                    )
                                    recovered = []
                                    unmatched_instruction = False
                                    for question in selection_questions:
                                        candidate_instruction = question.get("instructions", "")
                                        normalized_instruction = " ".join(
                                            str(candidate_instruction).casefold().split()
                                        )
                                        if not normalized_instruction:
                                            continue
                                        matched_fields = [
                                            field_name
                                            for field_name, markers in jev_field_markers.items()
                                            if any(normalized_instruction.startswith(marker)
                                                   for marker in markers)
                                        ]
                                        if len(matched_fields) != 1:
                                            unmatched_instruction = True
                                            break
                                        recovered.append((matched_fields[0], candidate_instruction))
                                    recovered_fields = {field_name for field_name, _ in recovered}
                                    if (
                                        not unmatched_instruction
                                        and len(recovered_fields) == 1
                                        and recovered
                                    ):
                                        instruction = recovered[0][1]
                                    else:
                                        instruction = ""
                                except (AttributeError, TypeError, ValueError):
                                    instruction = ""
                            question_field_definitions[request_hash] = instruction
                        if question_field_definitions[request_hash]:
                            advice["field_definition"] = question_field_definitions[request_hash]
                    definition = " ".join(str(advice.get("field_definition", "")).casefold().split())
                    if not definition:
                        stats["jev_untyped_advice_field_associations_skipped"] += 1
                    elif expected_markers and any(definition.startswith(marker) for marker in expected_markers):
                        field_cached_judgments.append(advice)
                    else:
                        stats["jev_other_field_advice_associations_skipped"] += 1
                cached = cache.execute("SELECT record FROM reviews WHERE case_id=? AND field=? AND fingerprint=?",
                                       (row["case_id"], field, fingerprint)).fetchone()
                if cached:
                    record = json.loads(cached[0])
                    stats["unchanged_evidence_skipped"] += 1
                else:
                    if decision is None:
                        decision = assess_case(raw.decode("utf-8-sig", errors="replace"),
                                               citation=row["citation"], title=row["title"], url=row["url"])
                    old = previous[field]
                    source_text = raw.decode("utf-8-sig", errors="replace")
                    same_evidence = old.get("source_sha256") in {sha, legacy_sha}
                    inherited_na = ((old.get("status", "").startswith("不適用") or
                                     old.get("fact_status") == "not_applicable") and same_evidence)
                    prior_reason_code = _normalize_reason_code(
                        old.get("reason_code", "") or old.get("reason", "")
                    )
                    proof = decision.values.get(field) if path else None
                    catchword_na = None
                    if field == "visa_type" and path and not proof:
                        proof = _austlii_catchword_visa_proof(
                            row, source_text, decision, old, {sha, legacy_sha}
                        )
                        if not proof:
                            catchword_na = _austlii_catchwords_visa_not_applicable(row)
                    sponsorship_na_overridden = (
                        field == "visa_type"
                        and bool(proof)
                        and (
                            (
                                proof.rule.startswith("austlii_catchwords_")
                                and decision.not_applicable.get(field)
                                    == "sponsorship_or_nomination_not_a_personal_visa"
                                and _austlii_source_confirms_current_visa_decision(row, source_text)
                            )
                            or (
                                proof.rule == "direct_current_personal_visa_refusal"
                                and same_evidence
                                and old.get("fact_status") == "not_applicable"
                                and prior_reason_code
                                    == "sponsorship_or_nomination_not_a_personal_visa"
                            )
                        )
                    )
                    if sponsorship_na_overridden:
                        inherited_na = False
                    # Previous identity/relationship holds cannot be undone by
                    # a more permissive expression on the very same evidence.
                    held = (same_evidence and not inherited_na and
                            any(word in old.get("reason", "") for word in
                                ("錯配", "不能直接核實", "無法明確對應", "無法可靠選定", "Detention challenge")))
                    if held:
                        proof = None
                        catchword_na = None
                    current_na = decision.not_applicable.get(field)
                    if sponsorship_na_overridden:
                        current_na = None
                    na = (current_na
                          or (prior_reason_code if inherited_na else "")
                          or catchword_na or "")
                    reason = "source_missing" if not path else decision.reasons.get(field, "evidence_review")
                    if na:
                        status, reason = "not_applicable", na
                    elif proof:
                        status, reason = "candidate_review", "evidence_review"
                    else:
                        status = "waiting_new_evidence"
                    if status == "waiting_new_evidence":
                        source_limit = _source_limitation_reason(row, source_text)
                        if source_limit:
                            reason = source_limit
                    record = {"case_id": row["case_id"], "citation": row["citation"], "field": field,
                              "fact_status": status, "reason_code": reason,
                              "reason": REASONS.get(reason, reason),
                              "source_path": row.get("full_text_path", ""), "url": row["url"],
                              "source_sha256": sha, "rule_version": RULE_VERSION,
                              "fingerprint": fingerprint,
                              "evidence": proof.to_dict() if proof and not na else None,
                              "candidates": decision.candidates if field == "visa_type" else [],
                              "jev_cached_advice": field_cached_judgments,
                              "prior_reason": old.get("reason", "")}
                    cache.execute("INSERT OR REPLACE INTO reviews VALUES (?,?,?,?,?)",
                                  (row["case_id"], field, fingerprint, encode(record), utc_now()))
                    stats["reviewed"] += 1
                normalized_reason_code = _normalize_reason_code(record.get("reason_code"))
                if normalized_reason_code != record.get("reason_code"):
                    record["reason_code"] = normalized_reason_code
                    cache.execute("INSERT OR REPLACE INTO reviews VALUES (?,?,?,?,?)",
                                  (row["case_id"], field, fingerprint, encode(record), utc_now()))
                records.append(record)
                if record.get("jev_cached_advice"):
                    stats["field_bound_cache_fields"] += 1
                stats[record["fact_status"]] += 1
                if record["fact_status"] == "candidate_review":
                    proposals.append(record)
    db.close()
    if jev_cache_reader:
        jev_cache_reader.close()
    reviewed_blank_cells = len(records)
    not_applicable_blank_cells = int(stats.get("not_applicable", 0))
    actionable_missing_cells = int(stats.get("waiting_new_evidence", 0)) + int(
        stats.get("candidate_review", 0)
    )
    summary = {"rule_version": RULE_VERSION, "review_workflow_version": "jev-field-binding-v3",
               "created_utc": utc_now(),
               "counts": dict(stats),
               "reviewed_blank_cells": reviewed_blank_cells,
               "not_applicable_blank_cells": not_applicable_blank_cells,
               "actionable_missing_cells": actionable_missing_cells,
               "missing_cells": actionable_missing_cells,
               "network_requests": 0, "paid_model_calls": 0, "new_provider_usd": 0,
               "ledger": str(ledger.resolve())}
    write_json(output / "review.json", records)
    write_json(output / "proposals.json", proposals)
    write_json(output / "summary.json", summary)
    output.mkdir(parents=True, exist_ok=True)
    with (output / "remaining-fields.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        columns = ["case_id", "citation", "field", "fact_status", "reason_code", "reason",
                   "prior_reason", "source_path", "source_sha256", "url", "rule_version"]
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(records)
    return summary


def _case_source_header(source_text: str) -> tuple[dict[str, str], str, bool]:
    separator = re.search(r"(?m)^={10,}\s*$", source_text)
    header = source_text[:separator.start()] if separator else "\n".join(source_text.splitlines()[:20])
    metadata: dict[str, str] = {}
    for line in header.splitlines():
        match = re.match(r"^(Title|Citation|URL):\s*(.*?)\s*$", line)
        if match and match[2].strip():
            metadata.setdefault(match[1].casefold(), match[2].strip())
    body = source_text[separator.end():] if separator else ""
    return metadata, body, separator is not None


def _case_title_key(title: str) -> str:
    caption = re.sub(r"\s+\[\d{4}\].*$", "", title or "")
    return re.sub(r"[^a-z0-9]+", "", caption.casefold())


def _case_primary_party_key(title: str) -> str:
    """Identify the named applicant while allowing the respondent agency to change."""
    caption = re.sub(r"\s+\[\d{4}\].*$", "", title or "").strip()
    caption = re.sub(r"^(?:re|in the matter of)\s+", "", caption, flags=re.I)
    respondent = re.search(
        r"\s+(?:v\.?|and|&)\s+(?:(?:the\s+)?minister\b|secretary\b|"
        r"department\b|migration review tribunal\b|administrative appeals tribunal\b|"
        r"refugee review tribunal\b)",
        caption,
        re.I,
    )
    if not respondent:
        return ""
    applicant = caption[:respondent.start()].strip()
    return re.sub(r"[^a-z0-9]+", "", applicant.casefold())


def _visa_type_family(value: str) -> str:
    normalized = re.sub(r"\bsubclass\s+\d{3}\b", " ", value.casefold())
    if re.search(r"\bsubclass\s+457\b", value, re.I):
        # "business" is a descriptor in the full legal name "subclass 457
        # business visa", not a separate visa subclass.
        normalized = re.sub(r"\bbusiness\b", " ", normalized)
    normalized = re.sub(r"\bclass\s+[a-z]{1,3}\b", " ", normalized)
    normalized = re.sub(r"\b\d{3}\b", " ", normalized)
    normalized = re.sub(r"\b(?:temporary|permanent|visa)\b", " ", normalized)
    return " ".join(re.findall(r"[a-z]+", normalized))


def _expected_visa_metadata(field: str, visa_value: str) -> str | None:
    subclass = re.search(r"(?i)\bsub[- ]?class\s+(\d{3})\b", visa_value)
    number = subclass.group(1) if subclass else ""
    if field in {"visa_subclass", "visa_subclass_number"}:
        return number
    if field == "visa_class_code":
        visa_class = re.search(r"(?i)\bclass\s+([a-z]{1,3})\b", visa_value)
        if visa_class:
            return visa_class.group(1).upper()
        return _VISA_CLASS_BY_SUBCLASS.get(number) if number else None
    return None


def _visa_type_specifics_match(value: str, source_value: str, source_quote: str) -> bool:
    """Do not treat different numbered subclasses as the same visa family."""
    subclass_pattern = re.compile(r"\bsub[ -]?class\s+(\d{3})\b", re.I)
    class_pattern = re.compile(r"\bclass\s+([a-z]{1,3})\b", re.I)
    expected_subclasses = set(subclass_pattern.findall(value))
    expected_classes = {item.upper() for item in class_pattern.findall(value)}

    normalized_quote = " ".join(source_quote.split())
    normalized_source_value = " ".join(source_value.split())
    source_subclasses = set(subclass_pattern.findall(normalized_source_value))
    source_classes = {item.upper() for item in class_pattern.findall(normalized_source_value)}
    source_start = normalized_quote.casefold().find(normalized_source_value.casefold())
    if source_start >= 0:
        nearby = normalized_quote[max(0, source_start - 80):
                                  min(len(normalized_quote), source_start + len(normalized_source_value) + 80)]
        source_subclasses.update(subclass_pattern.findall(nearby))
        source_classes.update(item.upper() for item in class_pattern.findall(nearby))

    if expected_subclasses and source_subclasses and expected_subclasses != source_subclasses:
        return False
    if expected_classes and source_classes and expected_classes != source_classes:
        return False
    return True


def _validate_linked_case_visa_approval(
    root: Path,
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    source_text: str,
    evidence: dict[str, Any],
    assessment: Any,
) -> None:
    """Validate a visa value supported by a linked judgment in the same matter."""
    metadata, body, has_separator = _case_source_header(source_text)
    if (
        not has_separator
        or metadata.get("citation") != row["citation"]
        or metadata.get("url") != row["url"]
        or row["citation"] not in metadata.get("title", "")
        or assessment.source_status != "checked"
        or "visa_type" in assessment.values
        or "visa_type" in assessment.not_applicable
    ):
        raise ValueError("Linked visa approval requires a checked target source with no direct value")

    linked = evidence.get("linked_case")
    target_quote = " ".join(str(evidence.get("quote", "")).split())
    normalized_body = " ".join(body.split())
    if not linked or not target_quote or target_quote not in normalized_body:
        raise ValueError("Linked visa approval requires an exact target-source quote")
    linked_citation = str(linked.get("citation", "")).strip()
    if not linked_citation:
        raise ValueError("Linked visa approval is missing the appealed citation")
    same_proceeding = evidence.get("method") == "manual_same_proceeding_visa_review"
    lower_court_link = evidence.get("method") == "manual_lower_court_linked_visa_review"
    linked_source_quote_review = (
        evidence.get("method") == "manual_linked_case_source_quote_review"
    )
    if not same_proceeding and not lower_court_link:
        appeal_heading = (
            r"(?is)\b(?:Appeal\s+from|Application\s+for\s+"
            r"(?:leave\s+to\s+appeal(?:\s+from)?|extension\s+of\s+time"
            r"(?:\s+and\s+leave\s+to\s+appeal)?))\s*:\s*(.{0,700})"
            if linked_source_quote_review
            else r"(?is)\bAppeal\s+from\s*:\s*(.{0,700})"
        )
        appeal = re.search(appeal_heading, body)
        if not appeal:
            raise ValueError("Target source does not identify an appealed case")
        appeal_block = appeal[1]
        next_heading = re.search(
            r"(?im)^\s*(?:File number(?:\(s\))?|Judgment of|Date of judgment|"
            r"Catchwords|Legislation|Division|Registry|National Practice Area)\s*:",
            appeal_block,
        )
        if next_heading:
            appeal_block = appeal_block[:next_heading.start()]
        normalized_appeal = " ".join(appeal_block.split())
        normalized_citation = " ".join(linked_citation.split())
        citation_pattern = (
            r"(?<![A-Za-z0-9])" + re.escape(normalized_citation) + r"(?![A-Za-z0-9])"
        )
        if not re.search(citation_pattern, normalized_appeal):
            raise ValueError("Linked citation is not the case identified under Appeal from")

    parent_rows = conn.execute(
        "SELECT * FROM cases WHERE citation=?", (linked_citation,)
    ).fetchall()
    if len(parent_rows) != 1:
        raise ValueError("Appealed case is missing or its citation is ambiguous")
    parent = parent_rows[0]
    if (not lower_court_link
            and _case_title_key(row["title"]) != _case_title_key(parent["title"])):
        target_party = _case_primary_party_key(row["title"])
        parent_party = _case_primary_party_key(parent["title"])
        ignored_party_words = {
            "a", "an", "and", "anor", "affairs", "administrative", "appeals",
            "border", "citizenship", "department", "for", "home", "immigration",
            "minister", "multicultural", "of", "or", "ors", "protection", "services",
            "the", "tribunal", "v", "vs",
        }
        def party_tokens(title: str) -> set[str]:
            title_without_citation = re.sub(r"\s+\[\d{4}\]\s+.*$", "", str(title or ""))
            return {
                token for token in re.findall(r"[a-z0-9]+", title_without_citation.casefold())
                if token not in ignored_party_words
            }

        shared_named_party = (
            linked_source_quote_review
            and bool(party_tokens(row["title"]) & party_tokens(parent["title"]))
        )
        body_caption_party = ""
        if linked_source_quote_review:
            target_citation = re.escape(str(row["citation"]))
            citation_matches = re.finditer(
                r"(?<![A-Za-z0-9])" + target_citation + r"(?![A-Za-z0-9])",
                body,
                re.I,
            )
            court_pattern = re.compile(
                r"\b(?:FEDERAL COURT OF AUSTRALIA|FEDERAL CIRCUIT COURT OF AUSTRALIA|"
                r"FEDERAL MAGISTRATES COURT OF AUSTRALIA)\b",
                re.I,
            )
            for citation_match in citation_matches:
                prefix = body[max(0, citation_match.start() - 1800):citation_match.start()]
                court_captions = list(court_pattern.finditer(prefix))
                if not court_captions:
                    continue
                caption_region = prefix[court_captions[-1].end():]
                caption_lines = [
                    line.strip() for line in caption_region.splitlines() if line.strip()
                ]
                for caption_line in reversed(caption_lines[-12:]):
                    body_party = _case_primary_party_key(caption_line)
                    if body_party:
                        body_caption_party = body_party
                        break
                if body_caption_party:
                    break
        body_caption_matches_parent = bool(
            body_caption_party and body_caption_party == parent_party
        )
        if (
            (not target_party or target_party != parent_party)
            and not shared_named_party
            and not body_caption_matches_parent
        ):
            raise ValueError(
                "Linked visa approval requires the same case title or named applicant"
            )
    if lower_court_link:
        lower_appeal = re.search(
            r"(?i)\bappeal\s+from\s+a\s+decision\s+of\s+the\s+"
            r"(Federal Magistrates Court|Federal Circuit Court)\b"
            r".{0,180}?\bgiven\s+by\s+"
            r"([A-Z][A-Za-z'.-]*(?:\s+[A-Z][A-Za-z'.-]*)*\s+(?:FM|J))\b",
            target_quote,
        )
        expected_parent_court = {
            "federal magistrates court": "FMCA",
            "federal circuit court": "FCCA",
        }

        def masked_applicant(case_row: sqlite3.Row) -> str:
            for candidate in (case_row["applicant_name"], case_row["title"]):
                match = re.match(r"\s*([A-Z]{2,6})\b", str(candidate or ""))
                if match:
                    return match[1].upper()
            return ""

        def normalized_judge(value: str) -> str:
            return " ".join(re.sub(r"[^a-z0-9]+", " ", value.casefold()).split())

        def parsed_case_date(value: str) -> datetime:
            return datetime.strptime(str(value).strip().title(), "%d %B %Y")

        target_mask = masked_applicant(row)
        parent_mask = masked_applicant(parent)
        if (
            not lower_appeal
            or row["court_code"] != "FCA"
            or expected_parent_court.get(lower_appeal[1].casefold()) != parent["court_code"]
            or not target_mask
            or target_mask != parent_mask
            or not parent["judges"]
            or normalized_judge(lower_appeal[2]) != normalized_judge(parent["judges"])
            or not re.search(r"\bREFUGEE REVIEW TRIBUNAL\b", body, re.I)
        ):
            raise ValueError(
                "Unnumbered lower-court link requires the same masked applicant, "
                "named lower-court judge, court, and Tribunal context"
            )
        try:
            target_date = parsed_case_date(row["date"])
            parent_date = parsed_case_date(parent["date"])
        except (TypeError, ValueError) as exc:
            raise ValueError("Unnumbered lower-court link requires parseable judgment dates") from exc
        if (
            parent_date >= target_date
            or not re.search(r"(?<![A-Z0-9])" + re.escape(target_mask) + r"(?![A-Z0-9])", body, re.I)
        ):
            raise ValueError(
                "Unnumbered lower-court link requires earlier matching Tribunal proceedings"
            )
        matching_lower_cases = conn.execute(
            "SELECT citation, title, applicant_name, judges FROM cases WHERE court_code=?",
            (parent["court_code"],),
        ).fetchall()
        matching_citations = {
            candidate["citation"]
            for candidate in matching_lower_cases
            if masked_applicant(candidate) == target_mask
            and normalized_judge(str(candidate["judges"] or ""))
            == normalized_judge(lower_appeal[2])
        }
        if matching_citations != {parent["citation"]}:
            raise ValueError(
                "Unnumbered lower-court link is ambiguous for the same applicant and judge"
            )
    value = str(evidence.get("value", "")).strip()
    if not value or (
        not linked_source_quote_review
        and value != str(parent["visa_type"] or "").strip()
    ):
        raise ValueError("Linked visa value must match the existing appealed-case value")

    linked_path = source_path(root, linked.get("source_path", ""))
    parent_path = source_path(root, parent["full_text_path"])
    if not linked_path or not parent_path or linked_path.resolve() != parent_path.resolve():
        raise ValueError("Linked visa approval must use the appealed case's saved source")
    linked_raw = linked_path.read_bytes()
    if hashlib.sha256(linked_raw).hexdigest() != linked.get("source_sha256"):
        raise ValueError("Appealed-case source changed since approval")
    if linked.get("url") != parent["url"]:
        raise ValueError("Linked visa approval URL does not match the appealed case")

    linked_text = linked_raw.decode("utf-8-sig")
    linked_metadata, linked_body, linked_has_separator = _case_source_header(linked_text)
    if (
        not linked_has_separator
        or linked_metadata.get("citation") != parent["citation"]
        or linked_metadata.get("url") != parent["url"]
        or parent["citation"] not in linked_metadata.get("title", "")
    ):
        raise ValueError("Appealed-case source identity does not match the saved case")
    if lower_court_link and (
        not re.search(r"\bREFUGEE REVIEW TRIBUNAL\b", linked_body, re.I)
        or not re.search(
            r"(?<![A-Z0-9])" + re.escape(parent_mask) + r"(?![A-Z0-9])",
            linked_body,
            re.I,
        )
    ):
        raise ValueError(
            "Unnumbered lower-court link requires earlier matching Tribunal proceedings"
        )
    if same_proceeding:
        def docket_key(source_body: str) -> str:
            match = re.search(
                r"(?i)\b([A-Z]{1,6})\s+(\d+)\s+of\s+(\d{4})\b",
                source_body[:8000],
            )
            return " ".join(match.groups()).upper() if match else ""

        def applicant_key(source_body: str) -> str:
            match = re.search(
                r"(?is)\bBETWEEN\s*:\s*(.{1,200}?)\bApplicant\b",
                source_body[:10000],
            )
            return (
                re.sub(r"[^a-z0-9]+", "", match[1].casefold())
                if match else ""
            )

        def judge_key(source_body: str) -> str:
            match = re.search(
                r"(?im)^\s*JUDGES?:\s*([^\r\n]{1,80})\s*$",
                source_body[:10000],
            )
            return " ".join(match[1].casefold().split()) if match else ""

        prior_reasons_date = re.search(
            r"(?i)\breasons\s+for\s+judgment\s+published\s+on\s+"
            r"(\d{1,2}\s+[A-Za-z]+\s+\d{4})\b",
            body,
        )
        parent_judgment_date = re.search(
            r"\((\d{1,2}\s+[A-Za-z]+\s+\d{4})\)\s*$",
            linked_metadata.get("title", ""),
            re.I,
        )
        if (
            row["citation"] == parent["citation"]
            or not re.search(r"(?i)\bSUPPLEMENTARY\s+REASONS\s+FOR\s+JUDGMENT\b", body)
            or not re.search(r"(?i)\bSUPPLEMENTARY\s+REASONS\s+FOR\s+JUDGMENT\b", target_quote)
            or not prior_reasons_date
            or not parent_judgment_date
            or " ".join(prior_reasons_date[1].casefold().split())
            != " ".join(parent_judgment_date[1].casefold().split())
            or not re.search(r"(?i)\bIN\s+THE\s+FEDERAL\s+COURT\s+OF\s+AUSTRALIA\b", body)
            or not re.search(r"(?i)\bIN\s+THE\s+FEDERAL\s+COURT\s+OF\s+AUSTRALIA\b", linked_body)
            or not docket_key(body)
            or docket_key(body) != docket_key(linked_body)
            or not applicant_key(body)
            or applicant_key(body) != applicant_key(linked_body)
            or not judge_key(body)
            or judge_key(body) != judge_key(linked_body)
        ):
            raise ValueError(
                "Same-proceeding approval requires matching court, docket, applicant, judge, "
                "and a quoted supplementary-judgment date"
            )
    linked_quote = " ".join(str(linked.get("quote", "")).split())
    source_value = " ".join(str(linked.get("source_value", "")).split())
    normalized_linked_body = " ".join(linked_body.split())
    if (
        not linked_quote
        or linked_quote not in normalized_linked_body
        or not source_value
        or source_value.casefold() not in linked_quote.casefold()
        or not re.search(r"\bvisas?\b", source_value, re.I)
        or (
            not linked_source_quote_review
            and _visa_type_family(source_value) != _visa_type_family(value)
        )
    ):
        raise ValueError("Linked visa source wording does not support the stored visa class")
    if linked_source_quote_review and (
        not re.search(r"\b(?:refus\w*|not\s+to\s+grant|cancel\w*|revok\w*)\b", linked_quote, re.I)
        or not re.search(r"\b(?:applicants?|appellants?|he|she|they|you|your|my)\b", linked_quote, re.I)
    ):
        raise ValueError(
            "Manual linked-source review requires applicant-specific refusal or cancellation evidence"
        )
    if not _visa_type_specifics_match(value, source_value, linked_quote):
        raise ValueError("Linked visa source wording conflicts with a specific class or subclass")
    linked_assessment = assess_case(
        linked_text,
        citation=parent["citation"],
        title=parent["title"],
        url=parent["url"],
    )
    if linked_assessment.source_status != "checked" or "visa_type" in linked_assessment.not_applicable:
        raise ValueError("Appealed source does not verify an applicable visa category")
    linked_proof = linked_assessment.values.get("visa_type")
    if linked_source_quote_review and source_value.casefold() != value.casefold():
        proof_quote = " ".join(linked_proof.quote.split()) if linked_proof else ""
        proof_subclasses = (
            set(re.findall(r"(?i)\bsub[ -]?class\s+(\d{3})\b", linked_proof.value))
            if linked_proof else set()
        )
        value_subclasses = set(
            re.findall(r"(?i)\bsub[ -]?class\s+(\d{3})\b", value)
        )
        same_source_subclass = (
            bool(proof_subclasses)
            and proof_subclasses == value_subclasses
            and all(
                re.search(r"(?i)\bsub[ -]?class\s+" + re.escape(number) + r"\b", proof_quote)
                for number in proof_subclasses
            )
            and _visa_type_specifics_match(value, linked_proof.value, proof_quote)
        )
        if (
            not linked_proof
            or (
                linked_proof.value.casefold() != value.casefold()
                and not same_source_subclass
            )
            or not proof_quote
            or proof_quote not in normalized_linked_body
        ):
            raise ValueError(
                "A normalized linked visa value must match the source-grounded extraction"
            )
    if (
        not linked_source_quote_review
        and linked_proof
        and _visa_type_family(linked_proof.value) != _visa_type_family(value)
    ):
        raise ValueError("Appealed source has a conflicting direct visa classification")
    if (
        not linked_source_quote_review
        and linked_proof
        and not _visa_type_specifics_match(value, linked_proof.value, linked_proof.quote)
    ):
        raise ValueError("Appealed source has a conflicting specific class or subclass")


def _canonical_operative_outcome(value: str, quote: str) -> str | None:
    """Return one directly stated, unambiguous outcome label from an order."""
    patterns = {
        "Affirmed": (
            r"\b(?:the\s+)?(?:tribunal|court)\s+affirms?\s+the\s+decisions?\b|"
            r"\bdecisions?\b.{0,100}\b(?:be|is|are|was|were)\s+affirmed\b"
        ),
        "Remitted": (
            r"\b(?:the\s+)?(?:tribunal|court)\s+remit(?:s|ted)\s+the\s+"
            r"(?:application|matter|decision|proceedings)\b|"
            r"\b(?:application|matter|decision|proceedings)\s+"
            r"(?:be|is|are|was|were)\s+remitted\b"
        ),
        "Set aside": (
            r"\b(?:the\s+)?(?:tribunal|court)\s+sets?\s+aside\s+the\s+decision\b|"
            r"\bdecision(?:\s+under\s+review)?\s+(?:be|is|are|was|were)\s+set\s+aside\b|"
            r"\bset\s+aside\s+the\s+decision\b"
        ),
        "Dismissed": (
            r"\b(?:appeal|application|proceedings?)\b.{0,120}\b"
            r"(?:be|is|are|was|were)?\s*dismissed\b|"
            r"\b(?:appeal|application|proceedings?)\s+dismissed\b"
        ),
        "No jurisdiction": (
            r"\b(?:no jurisdiction|does not have jurisdiction|lacks jurisdiction|"
            r"has no jurisdiction|without jurisdiction)\b"
        ),
    }
    normalized = " ".join(quote.split())
    found = set()
    for label, pattern in patterns.items():
        for match in re.finditer(pattern, normalized, re.I):
            clause_start = max(
                normalized.rfind(separator, 0, match.start())
                for separator in (".", ";", "\n")
            ) + 1
            clause = normalized[clause_start:match.end()]
            negated_word = {
                "Affirmed": r"affirm(?:s|ed)",
                "Remitted": r"remit(?:s|ted)",
                "Set aside": r"set\s+aside",
                "Dismissed": r"dismissed",
            }.get(label)
            if negated_word and re.search(
                rf"\b(?:not|never|cannot|can't)\b.{{0,100}}\b{negated_word}\b",
                clause,
                re.I,
            ):
                continue
            found.add(label)
            break
    if value in found and len(found) == 1:
        return value
    return None


def validate_approvals(root: Path, approvals: list[dict[str, Any]]) -> None:
    """Approval is source-pinned and literal; replacements require exact compare-and-swap."""
    seen = set()
    with contextlib.closing(sqlite3.connect(root / "downloaded_cases/cases.db")) as conn:
        conn.row_factory = sqlite3.Row
        for change in approvals:
            key = (change["case_id"], change["field"])
            field = change["field"]
            if key in seen or field not in REPAIR_FIELDS:
                raise ValueError("Duplicate or unsupported cell")
            seen.add(key)
            row = conn.execute("SELECT * FROM cases WHERE case_id=?", (change["case_id"],)).fetchone()
            if not row:
                raise ValueError("Approved case is missing")
            current = row[field]
            expected_by_store = change.get("expected_current_by_store")
            if expected_by_store is not None:
                if not isinstance(expected_by_store, dict) or "database" not in expected_by_store:
                    raise ValueError("Per-store current values must include the database")
                if current != expected_by_store["database"]:
                    raise ValueError("Current database value changed since approval")
            elif "expected_current" in change:
                if current != change["expected_current"]:
                    raise ValueError("Current value changed since approval")
            elif not blank(current):
                raise ValueError("Existing non-empty value is protected")
            source_ref = change.get("source_path") or row["full_text_path"]
            path = source_path(root, source_ref)
            raw = path.read_bytes() if path else b""
            if not path or hashlib.sha256(raw).hexdigest() != change["source_sha256"]:
                raise ValueError("Source changed since approval")
            source_text = raw.decode("utf-8-sig")
            evidence = change["evidence"]
            if field in CORE_FIELDS:
                assessment = assess_case(source_text, citation=row["citation"],
                                         title=row["title"], url=row["url"])
                proof = assessment.values.get(field)
                manual_visa_review = (
                    field == "visa_type"
                    and evidence.get("method") == "manual_source_bound_visa_review"
                )
                manual_linked_visa_review = (
                    field == "visa_type"
                    and evidence.get("method") == "manual_linked_case_visa_review"
                )
                manual_same_proceeding_visa_review = (
                    field == "visa_type"
                    and evidence.get("method") == "manual_same_proceeding_visa_review"
                )
                manual_lower_court_linked_visa_review = (
                    field == "visa_type"
                    and evidence.get("method") == "manual_lower_court_linked_visa_review"
                )
                manual_linked_case_source_quote_review = (
                    field == "visa_type"
                    and evidence.get("method") == "manual_linked_case_source_quote_review"
                )
                manual_judge_review = (
                    field == "judges"
                    and evidence.get("method") == "manual_official_source_judge_review"
                )
                manual_docket_outcome_review = (
                    field == "outcome"
                    and evidence.get("method") == "manual_official_docket_outcome_review"
                )
                manual_source_outcome_review = (
                    field == "outcome"
                    and evidence.get("method") == "manual_source_bound_outcome_review"
                )
                if (field == "visa_type" and not proof
                        and assessment.source_status == "checked"):
                    proof = _austlii_catchword_visa_proof(
                        dict(row), source_text, assessment, {}, {change["source_sha256"]}
                    )
                if (manual_linked_visa_review or manual_same_proceeding_visa_review
                        or manual_lower_court_linked_visa_review
                        or manual_linked_case_source_quote_review):
                    _validate_linked_case_visa_approval(
                        root, conn, row, source_text, evidence, assessment
                    )
                elif manual_visa_review:
                    metadata = {}
                    separator = re.search(r"(?m)^={10,}\s*$", source_text)
                    # AustLII pages repeat empty UI labels such as "Citation:" near
                    # the top of the page body. Parse only the source header so an
                    # empty body label cannot erase the verified citation above.
                    header_text = (
                        source_text[:separator.start()]
                        if separator else "\n".join(source_text.splitlines()[:20])
                    )
                    for line in header_text.splitlines():
                        match = re.match(r"^(Title|Citation|URL):\s*(.*?)\s*$", line)
                        if match and match[2].strip():
                            metadata.setdefault(match[1].casefold(), match[2].strip())
                    quote = evidence.get("quote", "")
                    value = evidence.get("value", "")
                    if (metadata.get("citation") != row["citation"]
                            or metadata.get("url") != row["url"]
                            or row["citation"] not in metadata.get("title", "")):
                        raise ValueError("Manual visa approval requires matching source identity")
                    body = source_text[separator.end():] if separator else ""
                    normalized_quote = " ".join(quote.split())
                    normalized_body = " ".join(body.split())
                    normalized_value = " ".join(value.split())
                    exact_grounded_quote = bool(
                        proof
                        and proof.value == value
                        and " ".join(proof.quote.split()) == normalized_quote
                    )
                    if (not separator or not quote
                            or normalized_quote not in normalized_body
                            or not value
                            or (normalized_value not in normalized_quote
                                and not exact_grounded_quote)):
                        raise ValueError("Manual visa approval requires exact source wording")
                    not_applicable = assessment.not_applicable.get(field)
                    sponsor_decision_confirmed = (
                        not_applicable == "sponsorship_or_nomination_not_a_personal_visa"
                        and bool(proof)
                        and _austlii_source_confirms_current_visa_decision(
                            dict(row), source_text
                        )
                    )
                    if not_applicable and not sponsor_decision_confirmed:
                        raise ValueError("Manual visa approval conflicts with not-applicable evidence")
                    if proof and proof.value != value:
                        raise ValueError("Manual visa approval conflicts with grounded evidence")
                elif manual_judge_review:
                    metadata = {}
                    separator = re.search(r"(?m)^={10,}\s*$", source_text)
                    header_text = (
                        source_text[:separator.start()]
                        if separator else "\n".join(source_text.splitlines()[:20])
                    )
                    for line in header_text.splitlines():
                        match = re.match(
                            r"^(Title|Citation|URL|Supporting URL):\s*(.*?)\s*$",
                            line,
                        )
                        if match and match[2].strip():
                            metadata.setdefault(match[1].casefold(), match[2].strip())
                    quote = evidence.get("quote", "")
                    value = evidence.get("value", "")
                    source_url = evidence.get("source_url", "")
                    supporting_url = evidence.get("supporting_url", "")
                    official_hosts = (
                        "fedcourt.gov.au",
                    )
                    def is_official_court_url(url: str) -> bool:
                        parsed = urlparse(url)
                        host = parsed.hostname or ""
                        return (
                            parsed.scheme == "https"
                            and any(host == domain or host.endswith("." + domain)
                                    for domain in official_hosts)
                        )

                    if (
                        metadata.get("citation") != row["citation"]
                        or row["citation"] not in metadata.get("title", "")
                        or metadata.get("url") != source_url
                        or metadata.get("supporting url") != supporting_url
                        or not is_official_court_url(source_url)
                        or not is_official_court_url(supporting_url)
                    ):
                        raise ValueError("Manual judge approval requires matching official source identity")
                    body = source_text[separator.end():] if separator else ""
                    normalized_quote = " ".join(quote.split())
                    normalized_body = " ".join(body.split())
                    normalized_value = " ".join(value.split()).casefold()
                    if (
                        not separator
                        or not quote
                        or normalized_quote not in normalized_body
                        or not value
                        or normalized_value not in normalized_quote.casefold()
                    ):
                        raise ValueError("Manual judge approval requires exact source wording")
                    if proof and proof.value.casefold() != value.casefold():
                        raise ValueError("Manual judge approval conflicts with grounded evidence")
                elif manual_source_outcome_review:
                    metadata = {}
                    separator = re.search(r"(?m)^={10,}\s*$", source_text)
                    header_text = (
                        source_text[:separator.start()]
                        if separator else "\n".join(source_text.splitlines()[:20])
                    )
                    for line in header_text.splitlines():
                        match = re.match(r"^(Title|Citation|URL):\s*(.*?)\s*$", line)
                        if match and match[2].strip():
                            metadata.setdefault(match[1].casefold(), match[2].strip())
                    quote = evidence.get("quote", "")
                    value = evidence.get("value", "")
                    source_value = evidence.get("source_value", "")
                    normalized_quote = " ".join(quote.split())
                    normalized_source = " ".join(source_text.split())
                    normalized_proof = " ".join(proof.quote.split()) if proof else ""
                    if (
                        metadata.get("citation") != row["citation"]
                        or metadata.get("url") != row["url"]
                        or row["citation"] not in metadata.get("title", "")
                        or not separator
                        or assessment.source_status != "checked"
                        or not proof
                        or proof.rule not in {
                            "published_operative_table",
                            "published_multiple_operative_tables",
                        }
                        or source_value != proof.value
                        or not normalized_quote
                        or normalized_quote not in normalized_source
                        or normalized_quote not in normalized_proof
                        or _canonical_operative_outcome(value, quote) != value
                    ):
                        raise ValueError(
                            "Manual source-bound outcome review requires an exact, matching operative decision"
                        )
                elif manual_docket_outcome_review:
                    metadata = {}
                    separator = re.search(r"(?m)^={10,}\s*$", source_text)
                    header_text = (
                        source_text[:separator.start()]
                        if separator else "\n".join(source_text.splitlines()[:20])
                    )
                    for line in header_text.splitlines():
                        match = re.match(
                            r"^(Title|Citation|URL|Supporting URL|File number):\s*(.*?)\s*$",
                            line,
                            re.IGNORECASE,
                        )
                        if match and match[2].strip():
                            metadata.setdefault(match[1].casefold(), match[2].strip())
                    quote = evidence.get("quote", "")
                    value = evidence.get("value", "")
                    source_url = evidence.get("source_url", "")
                    supporting_url = evidence.get("supporting_url", "")
                    file_number = evidence.get("file_number", "")
                    official_hosts = ("comcourts.gov.au", "fedcourt.gov.au")

                    def is_official_court_url(url: str) -> bool:
                        parsed = urlparse(url)
                        host = parsed.hostname or ""
                        return (
                            parsed.scheme == "https"
                            and any(host == domain or host.endswith("." + domain)
                                    for domain in official_hosts)
                        )

                    case_match = re.fullmatch(
                        r"\[(\d{4})\]\s+([A-Z]+)\s+(\d+)", row["citation"], re.I
                    )
                    expected_support_path = ""
                    if case_match:
                        year, court, number = case_match.groups()
                        expected_support_path = f"/{year}{court.casefold()}{number.zfill(4)}"
                    parsed_source = urlparse(source_url)
                    parsed_support = urlparse(supporting_url)
                    expected_file_path = f"/{file_number}/order_list".casefold()
                    if (
                        metadata.get("citation") != row["citation"]
                        or row["citation"] not in metadata.get("title", "")
                        or metadata.get("url") != source_url
                        or metadata.get("supporting url") != supporting_url
                        or metadata.get("file number", "").casefold() != file_number.casefold()
                        or not re.fullmatch(r"[A-Z]{2,4}\d+/\d{4}", file_number, re.I)
                        or not is_official_court_url(source_url)
                        or not is_official_court_url(supporting_url)
                        or parsed_source.path.casefold().rstrip("/").endswith(expected_file_path) is False
                        or not expected_support_path
                        or not parsed_support.path.casefold().endswith(expected_support_path)
                    ):
                        raise ValueError("Manual docket outcome requires matching official source identity")
                    body = source_text[separator.end():] if separator else ""
                    normalized_quote = " ".join(quote.split())
                    normalized_body = " ".join(body.split())
                    normalized_value = " ".join(value.split())
                    if (
                        not separator
                        or not quote
                        or normalized_quote not in normalized_body
                        or not value
                        or not normalized_quote.endswith(normalized_value)
                    ):
                        raise ValueError("Manual docket outcome requires exact source wording")
                    if proof and proof.value != value:
                        raise ValueError("Manual docket outcome conflicts with grounded evidence")
                else:
                    if not proof:
                        raise ValueError("Approval no longer matches grounded evidence")
                    if proof.to_dict() != evidence:
                        quote = evidence.get("quote", "")
                        normalized_operative_order = (
                            field == "outcome"
                            and evidence.get("method") == "manual_operative_order_summary"
                            and evidence.get("source_value") == proof.value
                            and evidence.get("value") == current
                            and " ".join(quote.split()) in " ".join(source_text.split())
                            and proof.rule in {
                                "published_operative_table",
                                "published_multiple_operative_tables",
                            }
                            and " ".join(quote.split()) in " ".join(proof.quote.split())
                            and (
                                evidence.get("value") == proof.value
                                or _canonical_operative_outcome(
                                    evidence.get("value", ""), quote
                                ) == evidence.get("value")
                            )
                        )
                        if not normalized_operative_order:
                            raise ValueError("Approval no longer matches grounded evidence")
            elif field in VISA_METADATA_FIELDS:
                if evidence.get("method") != "manual_source_bound_visa_metadata_review":
                    raise ValueError("Visa metadata requires a source-bound manual review")
                metadata = {}
                separator = re.search(r"(?m)^={10,}\s*$", source_text)
                header_text = (
                    source_text[:separator.start()]
                    if separator else "\n".join(source_text.splitlines()[:20])
                )
                for line in header_text.splitlines():
                    match = re.match(r"^(Title|Citation|URL):\s*(.*?)\s*$", line)
                    if match and match[2].strip():
                        metadata.setdefault(match[1].casefold(), match[2].strip())
                if (
                    metadata.get("citation") != row["citation"]
                    or metadata.get("url") != row["url"]
                    or row["citation"] not in metadata.get("title", "")
                ):
                    raise ValueError("Visa metadata review requires matching source identity")
                body = source_text[separator.end():] if separator else ""
                quote = evidence.get("quote", "")
                if not quote or " ".join(quote.split()) not in " ".join(body.split()):
                    raise ValueError("Visa metadata review requires an exact source quote")
                assessment = assess_case(
                    source_text,
                    citation=row["citation"],
                    title=row["title"],
                    url=row["url"],
                )
                proof = assessment.values.get("visa_type")
                current_visa_value = evidence.get("current_visa_value", "")
                if (
                    assessment.source_status != "checked"
                    or not proof
                    or proof.value != current_visa_value
                ):
                    raise ValueError("Visa metadata review must match the case's current source evidence")
                expected_metadata = _expected_visa_metadata(field, proof.value)
                if expected_metadata is None or evidence.get("value") != expected_metadata:
                    raise ValueError("Visa metadata value does not match the verified visa classification")
            elif field == "case_nature":
                quote = evidence.get("quote", "")
                value = evidence.get("value", "")
                if (
                    evidence.get("method") != "manual_source_bound_case_nature_review"
                    or not quote
                    or quote not in source_text
                    or row["citation"] not in source_text[:12000]
                ):
                    raise ValueError("Manual case-nature approval requires a literal source quote and matching citation")
                proof = _case_nature(
                    source_text,
                    row["catchwords"] if "catchwords" in row.keys() else "",
                    row["title"],
                )
                if not proof or proof != value:
                    raise ValueError("Manual case-nature approval no longer matches the source-bound classification")
            elif field == "full_text_path":
                if evidence.get("value") != source_ref:
                    raise ValueError("Replacement text path must match the verified source path")
            else:  # text_snippet
                snippet = evidence.get("value", "")
                if not snippet or len(snippet) > 1200 or not source_text.startswith(snippet):
                    raise ValueError("Replacement snippet must be a short exact source prefix")
            if not change.get("reviewer") or not change.get("review_note"):
                raise ValueError("Independent evidence review is required")


def read_exports(csv_path: Path, json_path: Path) -> tuple[list, Any, list, list]:
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        csv_rows = list(reader)
        headers = reader.fieldnames
    payload = json.loads(json_path.read_text(encoding="utf-8-sig"))
    json_rows = payload if isinstance(payload, list) else payload["cases"]
    return csv_rows, payload, json_rows, headers


def prepare_exports(csv_path: Path, json_path: Path, changes: list[dict]) -> tuple[Path, Path]:
    csv_rows, payload, json_rows, headers = read_exports(csv_path, json_path)
    wanted = {x["case_id"] for x in changes}
    maps = []
    for rows in (csv_rows, json_rows):
        mapping = {}
        for row in rows:
            if row["case_id"] in wanted:
                if row["case_id"] in mapping:
                    raise ValueError("Duplicate approved case in export")
                mapping[row["case_id"]] = row
        if mapping.keys() != wanted:
            raise ValueError("Approved case missing from export")
        maps.append(mapping)
    for change in changes:
        for label, mapping in zip(("csv", "json"), maps):
            row = mapping[change["case_id"]]
            existing = row.get(change["field"])
            value = change["evidence"]["value"]
            expected_by_store = change.get("expected_current_by_store")
            if expected_by_store is not None:
                if label not in expected_by_store or existing != expected_by_store[label]:
                    raise ValueError(f"Export changed since approval: {change['case_id']} {change['field']}")
            elif "expected_current" in change and existing != change["expected_current"]:
                raise ValueError(f"Export changed since approval: {change['case_id']} {change['field']}")
            if expected_by_store is None and "expected_current" not in change and not blank(existing) and existing != value:
                raise ValueError(f"Export conflict: {change['case_id']} {change['field']}")
            row[change["field"]] = value
    csv_next, json_next = csv_path.with_suffix(".csv.repair-next"), json_path.with_suffix(".json.repair-next")
    with csv_next.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        writer.writerows(csv_rows)
        handle.flush()
        os.fsync(handle.fileno())
    write_json(json_next, payload)
    return csv_next, json_next


def verify_stores(root: Path, backup: Path, changes: list[dict]) -> dict:
    """Compare every row and column, allowing only explicitly approved cells."""
    expected = {(c["case_id"], c["field"]): c["evidence"]["value"] for c in changes}
    observed = Counter()
    with contextlib.closing(sqlite3.connect(backup / "cases.db")) as before, \
         contextlib.closing(sqlite3.connect(root / "downloaded_cases/cases.db")) as after:
        columns = [x[1] for x in before.execute("PRAGMA table_info(cases)")]
        idpos = columns.index("case_id")
        old_rows = before.execute("SELECT * FROM cases ORDER BY case_id")
        new_rows = after.execute("SELECT * FROM cases ORDER BY case_id")
        import itertools
        count = 0
        for old, new in itertools.zip_longest(old_rows, new_rows):
            if old is None or new is None or old[idpos] != new[idpos]:
                raise ValueError("Database row identity/count changed")
            for index, field in enumerate(columns):
                value = expected.get((old[idpos], field), old[index])
                if new[index] != value:
                    raise ValueError(f"Unexpected database mutation: {old[idpos]} {field}")
                if (old[idpos], field) in expected:
                    observed["database"] += 1
            count += 1
        if after.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("SQLite integrity check failed")
        # Other tables must retain their rows (FTS trigger effects are allowed).
        tables = [r[0] for r in before.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        for name in tables:
            if name == "cases" or "fts" in name.lower():
                continue
            quoted = '"' + name.replace('"', '""') + '"'
            if sorted(before.execute(f"SELECT * FROM {quoted}"), key=repr) != sorted(after.execute(f"SELECT * FROM {quoted}"), key=repr):
                raise ValueError(f"Unexpected table change: {name}")
    old_csv, old_payload, old_json, old_headers = read_exports(backup / "immigration_cases.csv", backup / "immigration_cases.json")
    new_csv, new_payload, new_json, new_headers = read_exports(root / "downloaded_cases/immigration_cases.csv", root / "downloaded_cases/immigration_cases.json")
    if old_headers != new_headers:
        raise ValueError("CSV columns changed")
    for label, old_list, new_list in (("csv", old_csv, new_csv), ("json", old_json, new_json)):
        if len(old_list) != len(new_list):
            raise ValueError("Export row count changed")
        for old, new in zip(old_list, new_list):
            want = dict(old)
            for (case_id, field), value in expected.items():
                if case_id == old["case_id"]:
                    want[field] = value
                    observed[label] += 1
            if want != new:
                raise ValueError(f"Unexpected {label} mutation: {old['case_id']}")
    if isinstance(old_payload, dict):
        if {k: v for k, v in old_payload.items() if k != "cases"} != {k: v for k, v in new_payload.items() if k != "cases"}:
            raise ValueError("JSON envelope changed")
    if any(observed[label] != len(changes) for label in ("database", "csv", "json")):
        raise ValueError("Approved cells were not applied to all stores exactly once")
    return {"database_rows": count, "csv_rows": len(new_csv), "json_rows": len(new_json),
            "verified_cells_each_store": len(changes), "all_unapproved_data_preserved": True}


def apply_approved(root: Path, output: Path, approvals: list[dict], *, fault: str = "") -> dict:
    """Journalled three-store write under the catalogue's shared process lock.

    An interrupted run blocks further writes until explicit recovery. Backups
    include all stores; non-empty values change only after an exact compare.
    """
    from .csv_write_lock import catalog_lock
    root, output = root.resolve(), output.resolve()
    data = root / "downloaded_cases"
    journal = data / ".case-repair-journal.json"
    with catalog_lock(data / "immigration_cases.csv", "grounded-case-repair"):
        if journal.exists():
            raise RuntimeError("Unfinished repair journal; run recover first")
        if not approvals:
            return {"applied": 0, "backup": None}
        with contextlib.closing(sqlite3.connect(data / "cases.db", timeout=30)) as conn:
            # Reserve the SQLite writer before taking the snapshot. A direct
            # SQL writer cannot change the DB between backup and commit.
            conn.execute("BEGIN IMMEDIATE")
            validate_approvals(root, approvals)
            backup = output / "apply-backup"
            backup.mkdir(parents=True, exist_ok=False)
            csv_path, json_path = data / "immigration_cases.csv", data / "immigration_cases.json"
            hashes = {p.name: digest(p) for p in (csv_path, json_path)}
            with contextlib.closing(sqlite3.connect(data / "cases.db")) as reader, \
                 contextlib.closing(sqlite3.connect(backup / "cases.db")) as clone:
                reader.backup(clone)
            for path in (csv_path, json_path):
                shutil.copy2(path, backup / path.name)
                if digest(backup / path.name) != hashes[path.name]:
                    raise ValueError("Backup verification failed")
            next_csv, next_json = prepare_exports(csv_path, json_path, approvals)
            if any(digest(data / name) != sha for name, sha in hashes.items()):
                raise RuntimeError("Catalogue changed while preparing repair")
            validate_approvals(root, approvals)
            receipt = {"created_utc": utc_now(), "backup": str(backup), "phase": "prepared",
                       "before": hashes, "after": {csv_path.name: digest(next_csv), json_path.name: digest(next_json)},
                       "approvals": approvals}
            write_json(journal, receipt)
            for change in approvals:
                field = change["field"]  # validated against REPAIR_FIELDS above
                expected_by_store = change.get("expected_current_by_store")
                if expected_by_store is not None:
                    cursor = conn.execute(f'UPDATE cases SET "{field}"=? WHERE case_id=? AND "{field}"=?',
                                          (change["evidence"]["value"], change["case_id"], expected_by_store["database"]))
                elif "expected_current" in change:
                    cursor = conn.execute(f'UPDATE cases SET "{field}"=? WHERE case_id=? AND "{field}"=?',
                                          (change["evidence"]["value"], change["case_id"], change["expected_current"]))
                else:
                    cursor = conn.execute(f'UPDATE cases SET "{field}"=? WHERE case_id=? AND ("{field}" IS NULL OR TRIM("{field}")=\'\')',
                                          (change["evidence"]["value"], change["case_id"]))
                if cursor.rowcount != 1:
                    raise RuntimeError("Concurrent database change; refusing overwrite")
            os.replace(next_csv, csv_path)
            if fault == "after_csv":
                raise RuntimeError("Simulated interruption after CSV")
            os.replace(next_json, json_path)
            conn.commit()
            receipt["phase"] = "database_committed"
            write_json(journal, receipt)
        verification = verify_stores(root, backup, approvals)
        write_json(output / "apply-receipt.json", dict(receipt, verification=verification))
        journal.unlink()
        return {"applied": len(approvals), "backup": str(backup), "verification": verification}


def recover(root: Path) -> dict:
    """Recover exports only when current DB still equals the complete before/after state.

    Refuse automatic restoration if another writer changed any unrelated data.
    The DB is never replaced by a possibly stale backup.
    """
    from .csv_write_lock import catalog_lock
    data = root.resolve() / "downloaded_cases"
    journal = data / ".case-repair-journal.json"
    with catalog_lock(data / "immigration_cases.csv", "grounded-case-repair-recovery"):
        if not journal.exists():
            return {"recovered": False}
        receipt = json.loads(journal.read_text(encoding="utf-8"))
        backup = Path(receipt["backup"])
        before = sqlite3.connect(backup / "cases.db")
        live = sqlite3.connect(data / "cases.db")
        # Compare complete logical DB including non-case tables, not file bytes.
        import itertools
        same_before = all(a == b for a, b in itertools.zip_longest(before.iterdump(), live.iterdump()))
        before.close()
        live.close()
        for name in receipt["before"]:
            if digest(data / name) not in {receipt["before"][name], receipt["after"][name]}:
                raise RuntimeError("Export changed outside this repair; manual recovery required")
        if same_before:
            for name, sha in receipt["before"].items():
                if digest(backup / name) != sha:
                    raise RuntimeError("Recovery backup changed")
                temporary = data / (name + ".recover-next")
                shutil.copy2(backup / name, temporary)
                os.replace(temporary, data / name)
            state = "restored_exports_to_unchanged_database"
        else:
            verify_stores(root, backup, receipt["approvals"])
            state = "verified_completed_write"
        write_json(backup.parent / "recovery-receipt.json", {"state": state, "created_utc": utc_now()})
        journal.unlink()
        return {"recovered": True, "state": state}
