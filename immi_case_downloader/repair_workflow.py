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

from .extraction.grounded import (
    CORE_FIELDS,
    RULE_VERSION,
    Evidence,
    assess_case,
    canonical_citation,
    citation_from_url,
)

REPAIR_FIELDS = CORE_FIELDS + ("full_text_path", "text_snippet")

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
    "migration_agent_registration_not_a_personal_visa": "本案審理移民代理人的註冊或紀律事項，並非個人簽證審查；簽證類別不適用",
    "sponsorship_or_nomination_not_a_personal_visa": "本案審理雇主提名、職位或擔保人核准，並非個人簽證申請；簽證類別不適用",
    "ministerial_intervention_not_a_visa_review": "原文摘要顯示本案審查部長介入請求，沒有審查特定簽證決定；簽證類別不適用",
    "publication_explicitly_marks_visa_applicant_not_applicable": "裁決原文明列簽證申請人不適用；保留為不適用",
}


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

    rules: list[tuple[str, str]] = [
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
    ]
    for pattern, rule in rules:
        match = re.search(pattern, catchwords, re.I | re.S)
        if not match:
            continue
        if rule == "partner_subclass":
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
        match = re.search(r"\bapplication for permanent residence\b", catchwords, re.I)
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
    """Mirror the source-text rule for official metadata-only catchwords.

    A nomination or sponsorship review is not a personal visa decision when
    the official catchwords do not identify any visa application, refusal,
    cancellation, or review. Do not infer this from a secondary source.
    """
    from urllib.parse import urlparse

    if str(case.get("source", "")).strip().casefold() != "austlii":
        return None
    if urlparse(str(case.get("url", ""))).hostname not in {"austlii.edu.au", "www.austlii.edu.au"}:
        return None
    catchwords = str(case.get("catchwords", "") or "")
    if not re.search(r"\b(?:nomination|sponsor(?:ship)?)\b", catchwords, re.I):
        return None
    if re.search(
        r"\b(?:visa\s+(?:refusal|cancellation|application|decision)|"
        r"refusal\s+of\s+(?:the\s+)?visa|cancellation\s+of\s+(?:the\s+)?visa|"
        r"review\s+of\s+(?:the\s+)?visa)\b",
        catchwords,
        re.I,
    ):
        return None
    return "sponsorship_or_nomination_not_a_personal_visa"


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
                      "select the explicit visa name whose refusal/cancellation/non-revocation"),
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
                                    instruction = questions.get("select", {}).get("instructions", "")
                                except (AttributeError, TypeError, ValueError):
                                    instruction = ""
                            normalized_instruction = " ".join(str(instruction).casefold().split())
                            if not any(normalized_instruction.startswith(marker)
                                       for markers in jev_field_markers.values() for marker in markers):
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
                    proof = decision.values.get(field) if path else None
                    catchword_na = None
                    if (field == "visa_type" and path and not proof
                            and decision.source_status == "checked"
                            and not decision.not_applicable.get(field)
                            and decision.reasons.get(field) == "current_visa_not_stated"):
                        proof = _austlii_catchwords_visa_evidence(row)
                        if not proof:
                            catchword_na = _austlii_catchwords_visa_not_applicable(row)
                    old = previous[field]
                    same_evidence = old.get("source_sha256") in {sha, legacy_sha}
                    inherited_na = ((old.get("status", "").startswith("不適用") or
                                     old.get("fact_status") == "not_applicable") and same_evidence)
                    # Previous identity/relationship holds cannot be undone by
                    # a more permissive expression on the very same evidence.
                    held = (same_evidence and not inherited_na and
                            any(word in old.get("reason", "") for word in
                                ("錯配", "不能直接核實", "無法明確對應", "無法可靠選定", "Detention challenge")))
                    if held:
                        proof = None
                        catchword_na = None
                    na = (decision.not_applicable.get(field)
                          or (old.get("reason", "") if inherited_na else "")
                          or catchword_na or "")
                    reason = "source_missing" if not path else decision.reasons.get(field, "evidence_review")
                    if na:
                        status, reason = "not_applicable", na
                    elif proof:
                        status, reason = "candidate_review", "evidence_review"
                    else:
                        status = "waiting_new_evidence"
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
                records.append(record)
                if record.get("jev_cached_advice"):
                    stats["field_bound_cache_fields"] += 1
                stats[record["fact_status"]] += 1
                if record["fact_status"] == "candidate_review":
                    proposals.append(record)
    db.close()
    if jev_cache_reader:
        jev_cache_reader.close()
    summary = {"rule_version": RULE_VERSION, "review_workflow_version": "jev-field-binding-v2",
               "created_utc": utc_now(),
               "counts": dict(stats), "missing_cells": len(records),
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
                if (field == "visa_type" and not proof
                        and assessment.source_status == "checked"
                        and not assessment.not_applicable.get(field)
                        and assessment.reasons.get(field) == "current_visa_not_stated"):
                    proof = _austlii_catchwords_visa_evidence(dict(row))
                if manual_visa_review:
                    metadata = {}
                    for line in source_text.splitlines()[:20]:
                        match = re.match(r"^(Title|Citation|URL):\s*(.*?)\s*$", line)
                        if match:
                            metadata[match[1].casefold()] = match[2]
                    separator = re.search(r"(?m)^={10,}\s*$", source_text)
                    quote = evidence.get("quote", "")
                    value = evidence.get("value", "")
                    if (metadata.get("citation") != row["citation"]
                            or metadata.get("url") != row["url"]
                            or row["citation"] not in metadata.get("title", "")):
                        raise ValueError("Manual visa approval requires matching source identity")
                    if (not separator or not quote or quote not in source_text[separator.end():]
                            or not value or value not in quote):
                        raise ValueError("Manual visa approval requires exact source wording")
                    if assessment.not_applicable.get(field):
                        raise ValueError("Manual visa approval conflicts with not-applicable evidence")
                    if proof and proof.value != value:
                        raise ValueError("Manual visa approval conflicts with grounded evidence")
                else:
                    if not proof:
                        raise ValueError("Approval no longer matches grounded evidence")
                    if proof.to_dict() != evidence:
                        quote = evidence.get("quote", "")
                        normalized_dismissal = (
                            field == "outcome"
                            and evidence.get("method") == "manual_operative_order_summary"
                            and evidence.get("source_value") == proof.value
                            and evidence.get("value") == "Dismissed"
                            and quote in source_text
                            and bool(re.search(r"\b(?:appeal|application)\s+(?:be|is|was)\s+dismissed\b", quote, re.I))
                        )
                        normalized_remittance = (
                            field == "outcome"
                            and evidence.get("method") == "manual_operative_order_summary"
                            and evidence.get("source_value") == proof.value
                            and evidence.get("value") == "Remitted"
                            and quote in source_text
                            and bool(re.search(r"\b(?:the\s+)?(?:tribunal|court)\s+remit(?:s|ted)\b", quote, re.I))
                        )
                        if not (normalized_dismissal or normalized_remittance):
                            raise ValueError("Approval no longer matches grounded evidence")
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
