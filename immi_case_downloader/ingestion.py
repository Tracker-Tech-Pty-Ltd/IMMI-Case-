"""Local download evidence, immutable source reuse, and guarded persistence.

This module has no network or model client. Cached model answers are advice,
never permission to fill a fact. Download intake is independent of the choice
of CSV/SQLite catalogue, so a new CSV row need not wait for a database import.
"""
from __future__ import annotations

import contextlib
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import uuid

from .extraction.grounded import CORE_FIELDS, RULE_VERSION, assess_case, canonical_citation, citation_from_url, document_text
from .atomic_file import replace_file
from .repair_workflow import REASONS, blank, digest, encode, load_jev_cache, open_ledger, utc_now

DOWNLOAD_FIELDS = ("date", "judges", "catchwords", "outcome", "visa_type", "legislation", "full_text_path")


def ledger_path(base_dir: str | Path) -> Path:
    return Path(base_dir).resolve() / ".case-field-review.sqlite3"


def intake_schema(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS intake_reviews (
            case_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
            record TEXT NOT NULL, reviewed_utc TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS source_cache (
            identity TEXT NOT NULL, url TEXT NOT NULL, source_sha256 TEXT NOT NULL,
            path TEXT NOT NULL, PRIMARY KEY(identity,url,source_sha256));
        CREATE TABLE IF NOT EXISTS jev_advice (
            identity TEXT NOT NULL, source_sha256 TEXT NOT NULL, url TEXT NOT NULL,
            advice TEXT NOT NULL, PRIMARY KEY(identity,source_sha256,url));
    """)


def warm_jev_cache(base_dir: str | Path) -> int:
    """Index a configured, existing cache once; never create a model request."""
    with open_ledger(ledger_path(base_dir)) as conn:
        intake_schema(conn)
        setting = conn.execute("SELECT value FROM settings WHERE key='jev_cache'").fetchone()
        if not setting:
            return 0
        path = Path(setting[0])
        if not path.is_file():
            return 0
        stat = path.stat()
        version = encode([str(path.resolve()), stat.st_size, stat.st_mtime_ns])
        old = conn.execute("SELECT value FROM settings WHERE key='intake_jev_version'").fetchone()
        if old and old[0] == version:
            return 0
        cache = load_jev_cache(path)
        conn.execute("DELETE FROM jev_advice")
        conn.executemany("INSERT INTO jev_advice VALUES (?,?,?,?)",
                         [(identity, sha, url, encode(advice)) for (identity, sha, url), advice in cache.items()])
        conn.execute("INSERT OR REPLACE INTO settings VALUES ('intake_jev_version',?)", (version,))
        return len(cache)


def preserve_source(path: Path, base_dir: str | Path) -> Path:
    """Copy exact bytes before any replacement, using a content-addressed name."""
    raw = path.read_bytes()
    target = Path(base_dir).resolve() / ".case-source-cache" / (hashlib.sha256(raw).hexdigest() + ".txt")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + "." + uuid.uuid4().hex + ".part")
    try:
        with temporary.open("xb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, target)
        except FileExistsError:
            if target.read_bytes() != raw:
                raise ValueError("source archive hash mismatch")
    finally:
        temporary.unlink(missing_ok=True)
    return target


def reusable_source(text: str, decision) -> bool:
    """Require case identity and substantive reasons; excerpts remain evidence only."""
    body = document_text(text)
    return (decision.source_status == "checked" and len(body) >= 500
            and bool(re.search(r"REASONS FOR (?:JUDGMENT|DECISION)|STATEMENT OF DECISION AND REASONS", body, re.I))
            and not re.search(r"(?:read (?:the )?full judgment|full (?:text|judgment) (?:not available|requires)|\[text (?:omitted|truncated)\])", body, re.I))


def record_case_evidence(case, base_dir: str | Path, *, archive_source: bool = True) -> dict:
    """Record missing-field reasons without altering any catalogue value."""
    case.ensure_id()
    base = Path(base_dir).resolve()
    path = Path(case.full_text_path).resolve() if case.full_text_path else None
    # A catalogue row must not cause arbitrary local files to be read.
    path = path if path and path.is_relative_to(base) and path.is_file() else None
    raw = path.read_bytes() if path else b""
    sha = hashlib.sha256(raw).hexdigest()
    legacy_sha = hashlib.sha256(raw.decode("utf-8", errors="replace").replace("\r\n", "\n").encode()).hexdigest()
    identity = canonical_citation(case.citation) or citation_from_url(case.url)
    warm_jev_cache(base)
    with open_ledger(ledger_path(base)) as conn:
        intake_schema(conn)
        prior = {r[0]: json.loads(r[1]) for r in conn.execute(
            "SELECT field,record FROM prior_status WHERE case_id=?", (case.case_id,))}
        advice = []
        for source_sha in dict.fromkeys((sha, legacy_sha)):
            cached = conn.execute("SELECT advice FROM jev_advice WHERE identity=? AND source_sha256=? AND url=?",
                                  (identity, source_sha, case.url)).fetchone()
            if cached:
                advice.extend(json.loads(cached[0]))
        # Existing exact-source review receipts also survive a missing/offline
        # frozen cache. Never bind by title, substring, or confidence alone.
        if not advice:
            for row in conn.execute("SELECT record FROM reviews WHERE case_id=?", (case.case_id,)):
                reviewed = json.loads(row[0])
                if (reviewed.get("source_sha256") in {sha, legacy_sha} and reviewed.get("url") == case.url
                        and (canonical_citation(reviewed.get("citation", "")) or citation_from_url(case.url)) == identity):
                    advice.extend(reviewed.get("jev_cached_advice", []))
        advice = list({encode(a): a for a in advice}.values())
        fingerprint = hashlib.sha256(encode({
            "source": sha, "case": {k: getattr(case, k) for k in
                                      ("case_id", "citation", "title", "url", "full_text_path", *CORE_FIELDS)},
            "prior": prior, "advice": advice,
            "archive_source": archive_source,
            "rules": digest(Path(__file__).with_name("extraction") / "grounded.py"),
            "intake": digest(Path(__file__)),
        }).encode()).hexdigest()
        old = conn.execute("SELECT fingerprint,record FROM intake_reviews WHERE case_id=?", (case.case_id,)).fetchone()
        if old and old[0] == fingerprint:
            return {**json.loads(old[1]), "unchanged_evidence_skipped": True}
        decision = assess_case(raw.decode("utf-8-sig", errors="replace"), citation=case.citation, title=case.title, url=case.url)
        fields = []
        for field in CORE_FIELDS:
            if not blank(getattr(case, field)):
                continue
            previous = prior.get(field, {})
            same = previous.get("source_sha256") in {sha, legacy_sha}
            inherited_na = same and (previous.get("fact_status") == "not_applicable" or previous.get("status", "").startswith("不適用"))
            held = same and any(word in previous.get("reason", "") for word in
                                ("錯配", "不能直接核實", "無法明確對應", "無法可靠選定", "Detention challenge"))
            proof = decision.values.get(field) if path and not held else None
            na = decision.not_applicable.get(field) or (previous.get("reason", "") if inherited_na else "")
            reason = "source_missing" if not path else decision.reasons.get(field, "evidence_review")
            status = "waiting_new_evidence"
            if na:
                status, reason = "not_applicable", na
            elif proof:
                status, reason = "candidate_review", "evidence_review"
            fields.append({"field": field, "fact_status": status, "reason_code": reason,
                           "reason": REASONS.get(reason, reason), "prior_reason": previous.get("reason", ""),
                           "evidence": proof.to_dict() if proof and not na else None})
        record = {"case_id": case.case_id, "citation": case.citation, "url": case.url,
                  "source_path": str(path) if path else "", "source_sha256": sha,
                  "source_status": decision.source_status if path else "source_missing",
                  "source_reusable": bool(path and reusable_source(raw.decode("utf-8-sig", errors="replace"), decision)),
                  "rule_version": RULE_VERSION, "fields": fields,
                  "jev_cached_advice": advice, "network_requests": 0, "paid_model_calls": 0}
        if path and identity and case.url and record["source_reusable"]:
            archive = preserve_source(path, base) if archive_source else path
            conn.execute("INSERT OR IGNORE INTO source_cache VALUES (?,?,?,?)", (identity, case.url, sha, str(archive)))
        conn.execute("INSERT OR REPLACE INTO intake_reviews VALUES (?,?,?,?)",
                     (case.case_id, fingerprint, encode(record), utc_now()))
        return {**record, "unchanged_evidence_skipped": False}


def reuse_case_source(case, base_dir: str | Path) -> str | None:
    """Reuse only one intact, exact-identity source. Conflicting versions refetch."""
    base = Path(base_dir).resolve()
    identity = canonical_citation(case.citation) or citation_from_url(case.url)
    if not identity or not case.url:
        return None
    rows = []
    if ledger_path(base).is_file():
        with open_ledger(ledger_path(base)) as conn:
            intake_schema(conn)
            rows = conn.execute("SELECT source_sha256,path FROM source_cache WHERE identity=? AND url=?",
                                (identity, case.url)).fetchall()
    # Older downloads predate the index. Recover their intact original file
    # without trusting its filename as proof of identity or completeness.
    if not rows and case.citation:
        filename = "".join(c if c.isalnum() or c in " -_[]" else "_" for c in case.citation).strip()[:100]
        candidate = base / "case_texts" / (filename + ".txt")
        # Exact legacy filename only; scanning the entire text directory on
        # every genuinely new case would make intake quadratic in corpus size.
        candidates = [candidate]
        for candidate in candidates:
            if not candidate.is_file():
                continue
            text = candidate.read_bytes().decode("utf-8-sig", errors="replace")
            source_url = re.search(r"^URL: (.+)$", text[:2000], re.M)
            decision = assess_case(text, citation=case.citation, title=case.title, url=case.url)
            if source_url and source_url[1].strip() == case.url and reusable_source(text, decision):
                before = case.full_text_path
                case.full_text_path = str(candidate)
                try:
                    record_case_evidence(case, base)
                finally:
                    case.full_text_path = before
    if not ledger_path(base).is_file():
        return None
    if not rows:
        with open_ledger(ledger_path(base)) as conn:
            intake_schema(conn)
            rows = conn.execute("SELECT source_sha256,path FROM source_cache WHERE identity=? AND url=?",
                                (identity, case.url)).fetchall()
    if len(rows) != 1:
        return None
    sha, stored_path = rows[0]
    path = Path(stored_path).resolve()
    if not path.is_relative_to(base) or not path.is_file() or digest(path) != sha:
        return None
    text = path.read_bytes().decode("utf-8-sig", errors="replace")
    decision = assess_case(text, citation=case.citation, title=case.title, url=case.url)
    if not reusable_source(text, decision):
        return None
    case.full_text_path = str(path)
    case._reused_source = (str(base), str(path), sha, text)
    return text


def reused_source_path(case, text: str, base_dir: str | Path) -> str | None:
    receipt = getattr(case, "_reused_source", None)
    if not receipt:
        return None
    base, path, sha, saved_text = receipt
    if (base == str(Path(base_dir).resolve()) and saved_text == text
            and Path(path).is_file() and digest(Path(path)) == sha):
        return path
    return None


def persist_downloads(repo, downloaded: list, originals: dict[str, dict], base_dir: str | Path) -> int:
    """Update existing rows only, preserving edits made while HTTP was running.

    Built-in local repositories provide atomic compare-and-set below. A custom
    backend must explicitly implement merge_downloads; unsafe upsert is refused.
    """
    from .csv_repository import CsvRepository
    from .sqlite_repository import SqliteRepository
    from .csv_write_lock import csv_write_lock

    if not downloaded:
        return 0
    base = Path(base_dir).resolve()
    if isinstance(repo, SqliteRepository):
        with contextlib.closing(sqlite3.connect(repo.db_path, timeout=10)) as conn:
            conn.execute("BEGIN IMMEDIATE")
            # Backup from a separate reader: backing up a connection holding a
            # write transaction can block indefinitely in sqlite3.backup().
            if getattr(repo, "_download_backup_originals", None) is not originals:
                backup = base / ".download-backups" / uuid.uuid4().hex
                backup.mkdir(parents=True)
                with contextlib.closing(sqlite3.connect(repo.db_path)) as source:
                    with contextlib.closing(sqlite3.connect(backup / "cases.db")) as target:
                        source.backup(target)
                repo._download_backup_originals = originals
            count = 0
            for case in downloaded:
                original = originals[case.case_id]
                for field in DOWNLOAD_FIELDS:
                    value = getattr(case, field)
                    before = original.get(field, "")
                    if blank(value) or value == before or (field != "full_text_path" and not blank(before)):
                        continue
                    cur = conn.execute(f"UPDATE cases SET {field}=? WHERE case_id=? AND {field} IS ? AND citation IS ? AND url IS ?",
                                       (value, case.case_id, before, original.get("citation", ""), original.get("url", "")))
                    count += cur.rowcount
            conn.commit()
        return count
    if not isinstance(repo, CsvRepository):
        merger = getattr(repo, "merge_downloads", None)
        if merger:
            return merger(downloaded, originals)
        raise TypeError("Download persistence requires an atomic merge_downloads implementation")
    csv_path = base / "immigration_cases.csv"
    with csv_write_lock(csv_path, job_name="download_merge"):
        with csv_path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            columns, rows = reader.fieldnames, list(reader)
        patches = {}
        by_id = {c.case_id: c for c in downloaded}
        for row in rows:
            case = by_id.get(row["case_id"])
            if not case:
                continue
            original = originals[case.case_id]
            if any(row.get(k, "") != original.get(k, "") for k in ("citation", "url")):
                continue
            for field in DOWNLOAD_FIELDS:
                value, before = getattr(case, field), original.get(field, "")
                if value and value != before and row.get(field, "") == before and (field == "full_text_path" or blank(before)):
                    row[field] = value
                    patches.setdefault(case.case_id, {})[field] = (before, value)
        if not patches:
            return 0
        backup = base / ".download-backups" / uuid.uuid4().hex
        backup.mkdir(parents=True)
        shutil.copy2(csv_path, backup / csv_path.name)
        json_path = base / "immigration_cases.json"
        if json_path.is_file():
            shutil.copy2(json_path, backup / json_path.name)
            data = json.loads(json_path.read_text(encoding="utf-8-sig"))
            for row in (data if isinstance(data, list) else data["cases"]):
                for field, (before, after) in patches.get(row.get("case_id"), {}).items():
                    if row.get(field, "") == before:
                        row[field] = after
            temporary = json_path.with_name(json_path.name + "." + uuid.uuid4().hex + ".tmp")
            temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            replace_file(temporary, json_path)
        temporary = csv_path.with_name(csv_path.name + "." + uuid.uuid4().hex + ".tmp")
        with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)
        replace_file(temporary, csv_path)
        from .storage import invalidate_cases_cache
        invalidate_cases_cache()
        return len(patches)


def import_local_cases(repo, cases: list, base_dir: str | Path) -> dict:
    """Merge CSV into local SQLite without replacing any populated fact.

    Duplicate identities are reported, not renamed. Existing local-only rows
    survive. Review uses the resulting stored row, never the stale CSV row.
    """
    from .models import ImmigrationCase
    from .storage import CASE_FIELDS

    base = Path(base_dir).resolve()
    changed, conflicts, review_ids = 0, [], set()
    backup = None
    with contextlib.closing(sqlite3.connect(repo.db_path, timeout=10)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("BEGIN IMMEDIATE")
        for case in cases:
            case.ensure_id()
            incoming = case.to_dict()
            existing = conn.execute("SELECT * FROM cases WHERE case_id=?", (case.case_id,)).fetchone()
            duplicate = conn.execute("SELECT case_id FROM cases WHERE url=? AND case_id<>? AND url<>''",
                                     (case.url, case.case_id)).fetchone()
            if duplicate:
                conflicts.append({"case_id": case.case_id, "reason": "url_already_has_another_case_id", "existing_case_id": duplicate[0]})
                continue
            if existing and ((existing["url"] and case.url and existing["url"] != case.url)
                             or (canonical_citation(existing["citation"]) and canonical_citation(case.citation)
                                 and canonical_citation(existing["citation"]) != canonical_citation(case.citation))):
                conflicts.append({"case_id": case.case_id, "reason": "identity_conflict"})
                continue
            updates = {k: v for k, v in incoming.items() if k != "case_id" and not blank(v) and not (k == "year" and v == 0)
                       and (not existing or v != existing[k])
                       and (not existing or blank(existing[k]) or (k == "year" and existing[k] == 0))}
            if existing:
                for field in CORE_FIELDS:
                    if not blank(existing[field]) and not blank(incoming[field]) and existing[field] != incoming[field]:
                        conflicts.append({"case_id": case.case_id, "field": field, "reason": "preserved_existing_value"})
            if not existing or updates:
                if backup is None:
                    backup = base / ".download-backups" / uuid.uuid4().hex
                    backup.mkdir(parents=True)
                    with contextlib.closing(sqlite3.connect(repo.db_path)) as source:
                        with contextlib.closing(sqlite3.connect(backup / "cases.db")) as target:
                            source.backup(target)
                if existing:
                    conn.execute("UPDATE cases SET " + ",".join(f"{k}=?" for k in updates) + " WHERE case_id=?",
                                 [*updates.values(), case.case_id])
                else:
                    conn.execute(f"INSERT INTO cases ({','.join(CASE_FIELDS)}) VALUES ({','.join('?' for _ in CASE_FIELDS)})",
                                 [incoming[k] for k in CASE_FIELDS])
                changed += 1
                review_ids.add(case.case_id)
            elif any(blank(existing[field]) for field in CORE_FIELDS):
                review_ids.add(case.case_id)
        conn.commit()
        stored = [dict(conn.execute("SELECT * FROM cases WHERE case_id=?", (case_id,)).fetchone()) for case_id in sorted(review_ids)]
    for row in stored:
        record_case_evidence(ImmigrationCase.from_dict(row), base, archive_source=False)
    return {"changed_rows": changed, "reviewed_cases": len(stored), "conflicts": conflicts,
            "backup": str(backup) if backup else "", "network_requests": 0, "paid_model_calls": 0}


def append_discovered_cases(cases: list, base_dir: str | Path) -> int:
    """Append fresh discoveries onto the current CSV; never write a crawl snapshot."""
    from .csv_write_lock import csv_write_lock
    from .repair_workflow import write_json
    from .storage import CASE_FIELDS, invalidate_cases_cache

    base = Path(base_dir).resolve()
    path = base / "immigration_cases.csv"
    added = []
    with csv_write_lock(path, job_name="discovery_merge"):
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            columns, rows = reader.fieldnames, list(reader)
        ids = {r["case_id"] for r in rows}
        urls = {r.get("url") for r in rows if r.get("url")}
        for case in cases:
            case.ensure_id()
            if case.case_id in ids or (case.url and case.url in urls):
                continue
            rows.append(case.to_dict())
            ids.add(case.case_id)
            if case.url:
                urls.add(case.url)
            added.append(case)
        if not added:
            return 0
        backup = base / ".download-backups" / uuid.uuid4().hex
        backup.mkdir(parents=True)
        shutil.copy2(path, backup / path.name)
        json_path = base / "immigration_cases.json"
        if json_path.is_file():
            shutil.copy2(json_path, backup / json_path.name)
            data = json.loads(json_path.read_text(encoding="utf-8-sig"))
            json_rows = data if isinstance(data, list) else data["cases"]
            json_ids = {row.get("case_id") for row in json_rows}
            json_rows.extend(case.to_dict() for case in added if case.case_id not in json_ids)
            if isinstance(data, dict) and "total_cases" in data:
                data["total_cases"] = len(json_rows)
            write_json(json_path, data)
        temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
        # A historical CSV can lack newer known columns; retain its unknown
        # columns too, while allowing every new dataclass field to survive.
        columns = list(dict.fromkeys([*columns, *CASE_FIELDS]))
        with temporary.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temporary, path)
        invalidate_cases_cache()
    for case in added:
        record_case_evidence(case, base, archive_source=False)
    return len(added)
