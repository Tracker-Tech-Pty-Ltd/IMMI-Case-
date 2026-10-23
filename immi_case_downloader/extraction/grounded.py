"""Conservative, evidence-bearing extraction for local catalogue repairs.

Unlike the legacy first-match extractor, every value must be attached to the
current judgment. Scores from a model are deliberately not accepted here.
Only stdlib: usable by an offline repair command and local downloaders alike.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, field
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse

from .regex import _has_explicit_citizenship_subject

RULE_VERSION = "grounded-local-20261024-v65"
CORE_FIELDS = ("judges", "outcome", "visa_type")
CITATION = re.compile(r"\[(\d{4})\]\s*(AATA|ARTA|FCAFC|FCA|FCCA|FMCA|HCA|FedCFamC2G|RRTA|MRTA)\s+(\d+)(?!\d)")
_LABEL_END = re.compile(
    r"\b(?:MRT|RRT|DIMA|DIBP|DEPT|FILE|CASE|DATE|PLACE|HEARING|DELIVERED|"
    r"REPRESENTATION|REASONS|CATCHWORDS|DECISION|APPLICANT|RESPONDENT)\b\s*:?", re.I
)
_VISA = re.compile(
    r"(?:[Ss]ub[- ]?class|Sublcass)\s+\d{3}(?:\s*\([^\n.;]{1,75}?\))?(?:\s+visa[s]?)?"
    r"|\b[Cc]lass\s+\d{3}(?:\s*\([^\n.;]{1,55}\))?(?:\s+[A-Za-z][A-Za-z0-9-]*){0,4}\s+(?i:visa[s]?)\b"
    r"|\b(?:Five\s+Year\s+)?Resident\s+Return(?:\s*\(Class\s+BB\))?(?:\s*\(Subclass\s+155\))?\s+visa\b"
    r"|\b(?:Protection\s*\(Temporary\)\s*Entry Permit\s*\(After Entry\)"
    r"|(?:class\s+\d{3}|December\s+1989)\s*(?:\([^\n)]{1,45}\)\s*)?(?:special permanent\s+)?(?:entry\s+)?permit)\b"
    r"|\b(?:protection|student|visitor|tourist|bridging(?:\s+[A-E])?|"
    r"spouse(?:\s+provisional)?|partner|carer|remaining relative|"
    r"special category|permanent residen(?:t|ce)|family|humanitarian|business long stay|"
    r"temporary protection|temporary safe haven)"
    r"(?:\s*\([^\n)]{1,55}\)){0,3}\s+visa[s]?\b",
    re.I,
)


class _DocumentText(HTMLParser):
    """Retain table cells and paragraph boundaries instead of just <p> text."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "nav", "footer"}:
            self.hidden += 1
        if not self.hidden and tag in {"p", "div", "tr", "td", "th", "br", "li", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "nav", "footer"}:
            self.hidden = max(0, self.hidden - 1)
        if not self.hidden and tag in {"p", "div", "tr", "td", "th", "li", "h1", "h2", "h3", "h4"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def document_text(raw: str) -> str:
    """Normalised publication text; evidence offsets refer to this text."""
    if re.search(r"<(?:html|body|table|p|div)\b", raw, re.I):
        parser = _DocumentText()
        parser.feed(raw)
        raw = "".join(parser.parts)
    # Local downloader provenance is not the judgment's own printed citation.
    if re.search(r"^={30,}\s*$", raw[:2000], re.M) and re.search(r"^(?:Citation|Title|Source|URL):", raw[:2000], re.M):
        raw = re.split(r"^={30,}\s*$", raw, maxsplit=1, flags=re.M)[1]
    return "\n".join(" ".join(line.split()) for line in raw.replace("\x00", " ").splitlines() if line.strip())


def canonical_citation(value: str) -> str:
    match = CITATION.search(value or "")
    return f"[{match[1]}] {match[2]} {int(match[3])}" if match else ""


def citation_from_url(url: str) -> str:
    match = re.search(r"/au/cases/cth/(\w+)/(\d{4})/(\d+)\.(?:html?|rtf|pdf)$", urlparse(url).path, re.I)
    return canonical_citation(f"[{match[2]}] {match[1]} {match[3]}") if match else ""


@dataclass(frozen=True)
class Evidence:
    value: str
    quote: str
    start: int
    end: int
    rule: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Assessment:
    citation: str
    source_sha256: str
    normalized_sha256: str
    values: dict[str, Evidence] = field(default_factory=dict)
    reasons: dict[str, str] = field(default_factory=dict)
    not_applicable: dict[str, str] = field(default_factory=dict)
    candidates: list[dict[str, Any]] = field(default_factory=list)
    source_status: str = "checked"


def _evidence(text: str, start: int, end: int, value: str, rule: str) -> Evidence:
    return Evidence(value, text[max(0, start - 140):min(len(text), end + 180)], start, end, rule)


def _judge(text: str) -> Evidence | None:
    # Recent scans found several older tribunal publication layouts that the
    # general label parser below does not recognize: a split "Tribunal / Member"
    # label, a named tribunal member without a role, and a MEMBERS panel block.
    # These rules are deliberately restricted to short, labelled header areas.
    source_header = text[:12000]
    name_exclusions = {
        "the", "hon", "honourable", "mr", "mrs", "ms", "dr", "prof", "professor",
        "member", "senior", "presidential", "deputy", "president", "cbe", "am",
        "qc", "rfd", "sc", "kc", "ao", "psm", "ac", "oam", "and", "tribunal",
        "review", "registrar", "clerk", "secretary", "presiding",
    }

    def has_person_name(value: str) -> bool:
        cleaned = re.sub(r"\([^)]*\)", " ", value)
        cleaned = re.sub(
            r"\b(?:Deputy President|Presidential Member|Senior Member|Member)\b",
            " ", cleaned, flags=re.I,
        )
        tokens = [
            token for token in re.findall(r"[A-Za-zÀ-ž]+", cleaned)
            if token.casefold() not in name_exclusions
        ]
        return (
            2 <= len(tokens) <= 5
            and any(len(token) > 1 for token in tokens)
            and all(
                token.isupper() or token.istitle() or token.startswith("Mc")
                for token in tokens
            )
            and len(value) <= 110
            and bool(re.fullmatch(r"[A-Za-zÀ-ž .,'’()\-/&]+", value.strip()))
        )

    member_role = re.compile(
        r"\b(?:Deputy President|Presidential Member|Senior Member|Member)\b",
        re.I,
    )

    def named_member_line(line: str) -> str | None:
        value = " ".join(line.split()).strip(" \t,;:–—-")
        roles = list(member_role.finditer(value))
        if len(roles) != 1:
            return None
        role = roles[0]
        person = (
            value[role.end():].strip(" ,;:–—-")
            if role.start() == 0
            else value[:role.start()].strip(" ,;:–—-")
        )
        if has_person_name(person):
            return value
        return None

    labels = re.compile(
        r"^(?:PRESIDING MEMBER|CONSTITUTED MEMBER|TRIBUNAL MEMBERS?|JUDGMENT OF|JUDGES?|"
        r"BEFORE|CORAM|JUSTICE|TRIBUNAL)\s*:[ \t]*([^\n]*)"
        r"(?:\n(?![ \t]*(?:PRESIDING MEMBER|CONSTITUTED MEMBER|TRIBUNAL MEMBERS?|"
        r"JUDGMENT OF|JUDGES?|BEFORE|CORAM|JUSTICE|TRIBUNAL)\s*:)([^\n]+))?",
        re.I | re.M,
    )
    reasons_heading = re.compile(
        r"^[ \t]*(?:REASONS FOR (?:JUDGMENT|DECISION)|"
        r"STATEMENT OF DECISION(?!\s+AND\s+REASONS))\b",
        re.M,
    )
    preamble_end = len(text)
    for heading in reasons_heading.finditer(text):
        before = text[:heading.start()]
        if re.search(
            r"^[ \t]*(?:PRESIDING MEMBER|CONSTITUTED MEMBER|TRIBUNAL MEMBER|"
            r"JUDGE|JUDGES|BEFORE|CORAM|JUSTICE)\s*:",
            before,
            re.M | re.I,
        ):
            preamble_end = heading.start()
            break
        next_heading = reasons_heading.search(text, heading.end())
        cover_window = text[heading.end():min(
            next_heading.start() if next_heading else len(text),
            heading.end() + 1800,
        )]
        # Some publishers put a title such as "REASONS FOR DECISION" before
        # the Tribunal Member/JUDGE/date fields. Treat that first occurrence
        # as cover text only when structured case fields follow it.
        if re.search(
            r"^[ \t]*(?:TRIBUNAL(?:\s+MEMBER)?|PRESIDING MEMBER|"
            r"CONSTITUTED MEMBER|RRT REFERENCE|MRT REFERENCE|COUNTRY OF REFERENCE|"
            r"DATE(?: DECISION| OF DECISION)?|PLACE|DECISION)\s*:",
            cover_window,
            re.M | re.I,
        ) or re.search(
            r"^[ \t]*TRIBUNAL[ \t]*$",
            cover_window,
            re.M | re.I,
        ):
            continue
        preamble_end = heading.start()
        break
    preamble = text[:preamble_end][:10000]
    tribunal_headers: list[tuple[str, list[re.Match[str]]]] = []
    tribunal_heading = re.compile(
        r"^[ \t]*TRIBUNAL\b[ \t]*:?[ \t]*(?P<inline>[^\n]*)",
        re.I | re.M,
    )
    for match in tribunal_heading.finditer(preamble):
        tail_start = match.end()
        tail = preamble[tail_start:tail_start + 500]
        boundary = re.search(
            r"\b(?:Date|Place|Decision|Catchwords|Reasons|MRT File|RRT File)\b",
            tail,
            re.I,
        )
        header_tail = tail[:boundary.start()] if boundary else tail
        header_raw = (match["inline"] + " " + header_tail).strip(" :;\t")
        header_value = " ".join(header_raw.split())
        roles = list(re.finditer(
            r"\b(?:Deputy President|Presidential Member|Senior Member|Member)\b",
            header_value,
            re.I,
        ))
        tribunal_headers.append((header_value, roles))
        if len(roles) < 2:
            continue
        between_roles = header_value[roles[0].end():roles[1].start()]
        separate_member_rows = sum(
            bool(re.search(r"\b(?:Deputy President|Presidential Member|Senior Member|Member)\b", line, re.I))
            for line in header_raw.splitlines()
        ) > 1
        first_role_follows_name = bool(re.search(
            r"[A-Za-zÀ-ž][A-Za-zÀ-ž’'.-]{1,}[, \t]+$",
            header_value[:roles[0].start()],
        ))
        title = r"(?:Mr|Mrs|Ms|Dr|Professor|Prof|Honourable|Hon)\.?"
        second_member_title = bool(re.search(
            rf"(?:^|[,;\s]){title}\b[ \t]+"
            r"(?:[A-Z]\.?[ \t]+){0,3}[A-Z][A-Za-zÀ-ž’'.-]+"
            r"(?=[,; \t]|$)",
            between_roles,
            re.I,
        ))
        second_member_title = second_member_title or (
            first_role_follows_name and bool(
                re.match(rf"\s*{title}\b", between_roles, re.I)
                or re.search(rf"\b[A-Z][A-Za-zÀ-ž’'.-]{{2,}}[, \t]+{title}\b", between_roles, re.I)
            )
        )
        explicit_panel = bool(re.search(r"\b(?:and)\b|&", header_value, re.I)) or separate_member_rows or second_member_title
        non_name_words = {
            "the", "hon", "honourable", "mr", "mrs", "ms", "dr", "prof", "professor",
            "member", "senior", "presidential", "deputy", "president", "cbe", "am",
            "qc", "rfd", "sc", "and", "tribunal", "review", "registrar", "clerk", "secretary",
        }
        names = [
            token for token in re.findall(r"[A-Za-zÀ-ž]+", header_value)
            if token.casefold() not in non_name_words
        ]
        if (
            explicit_panel
            and len(names) >= 3
            and len(header_value) <= 300
            and re.fullmatch(r"[A-Za-zÀ-ž .,'’()\-/&;]+", header_value)
            and not re.search(r"\b(?:registrar|clerk|secretary|applicant|respondent)\b", header_value, re.I)
        ):
            value_start = match.start("inline")
            value_end = tail_start + (boundary.start() if boundary else len(tail))
            value = " ".join(header_value.split())
            return _evidence(
                text, value_start, value_end, value, "compact_tribunal_member_header"
            )
    for match in labels.finditer(preamble):
        value = match[1].strip() or (match[2] or "").strip()
        value = _LABEL_END.split(value, maxsplit=1)[0].strip(" :;\t")
        if not value or len(value) > 100 or not re.search(r"[A-Za-z]{2}", value):
            continue
        if re.search(
            r"\b(?:tribunal|court|applicant|respondent|decision|hearing|date|not|above|none|unknown|"
            r"registrar|clerk|secretary)\b",
            value,
            re.I,
        ):
            continue
        if not re.fullmatch(r"[A-Za-zÀ-ž .,'’()\-/&]+", value):
            continue
        # A lone city/venue in a damaged two-column table is not an author.
        # Prefer a complete personal name or surname plus judicial suffix.
        if len(value.split()) < 2:
            continue
        if not re.sub(r"\b(?:the|honourable|senior|deputy|president|member|judge|justice|dr|mr|ms|mrs|j|jj|fm|am|sc|qc)\b", "", value, flags=re.I).strip(" .,"):
            continue
        pos = text.find(value, match.start())
        return _evidence(text, pos, pos + len(value), value, "published_author_label")

    # Some Federal Court cover sheets split the explicit JUDGE field over
    # several table cells (including initials on separate lines). Preserve the
    # whole printed name or panel only when the block ends in the judicial
    # suffix J/JJ/CJ; this avoids interpreting a date or venue as a person.
    judge_heading = re.compile(r"^[ \t]*JUDGE:[ \t]*\n", re.I | re.M)
    for heading in judge_heading.finditer(preamble):
        parts: list[str] = []
        value_start = None
        value_end = None
        offset = heading.end()
        for raw_line in preamble[offset:].splitlines(keepends=True)[:4]:
            line = raw_line.rstrip("\r\n")
            stripped = line.strip()
            if not stripped or not re.fullmatch(r"[A-Z][A-Z .,'’&-]{0,100}", stripped):
                break
            if re.match(r"^(?:DATE|PLACE|TIME|WHERE|ORDER|REASONS)\b", stripped):
                break
            left = len(line) - len(line.lstrip())
            right = len(line.rstrip())
            if value_start is None:
                value_start = offset + left
            value_end = offset + right
            parts.append(stripped)
            value = " ".join(parts)
            if not re.search(r"\b(?:JJ|CJ|J)\.?$", value):
                offset += len(raw_line)
                continue
            name = re.sub(r"\b(?:JJ|CJ|J)\.?$", "", value).strip(" ,.")
            if (
                re.search(r"[A-Z]{3,}", name)
                and not re.search(r"\b(?:DATE|PLACE|MELBOURNE|SYDNEY|PERTH|BRISBANE)\b", name)
            ):
                return _evidence(
                    text, value_start, value_end, value,
                    "published_judge_surname_heading",
                )
            break
            offset += len(raw_line)

    # Some Federal Court tables split a full court panel after the explicit
    # JUDGE label; accept the complete surname list even when "and" is
    # lowercase or the names cross table-cell line breaks.
    judge_panel_heading = re.search(
        r"(?ms)^[ \t]*JUDGE:[ \t]*\n"
        r"[ \t]*(?P<panel>[A-Z][A-Z’'-]{2,39}"
        r"(?:[ \t]*,[ \t\r\n]*[A-Z][A-Z’'-]{2,39})*"
        r"[ \t\r\n]+and[ \t\r\n]+[A-Z][A-Z’'-]{2,39})"
        r"[ \t\r\n]+(?P<suffix>JJ)[ \t]*$",
        preamble,
    )
    if judge_panel_heading:
        value = " ".join(
            f"{judge_panel_heading['panel']} {judge_panel_heading['suffix']}".split()
        )
        return _evidence(
            text,
            judge_panel_heading.start("panel"),
            judge_panel_heading.end("suffix"),
            value,
            "published_judicial_panel_heading",
        )

    # Federal Court cover sheets often print only a judge's surname (and
    # sometimes split initials, surname, and the judicial suffix across HTML
    # table cells). The explicit JUDGE label makes a one-word surname useful;
    # reject placeholders and locations rather than treating them as people.
    judge_heading_initials = re.search(
        r"^[ \t]*JUDGE:[ \t]*\n[ \t]*(?P<initials>[A-Z]{1,3})[ \t]*\n"
        r"[ \t]*(?P<surname>[A-Z][A-Z’'-]{2,40})[ \t]+(?P<suffix>J|JJ|CJ)[ \t]*$",
        preamble, re.M,
    )
    if judge_heading_initials:
        value = " ".join(
            judge_heading_initials[name]
            for name in ("initials", "surname", "suffix")
        )
        start = judge_heading_initials.start("initials")
        return _evidence(
            text, start, judge_heading_initials.end("suffix"), value,
            "published_judge_surname_heading",
        )

    judge_heading_particle = re.search(
        r"^[ \t]*JUDGE:[ \t]*(?:\n[ \t]*)?(?P<particle>von|van|de|du)"
        r"[ \t\r\n]+(?P<surname>[A-Z][A-Z’'-]{2,40})[ \t]+"
        r"(?P<suffix>J|JJ|CJ)[ \t]*$",
        preamble, re.M | re.I,
    )
    if judge_heading_particle:
        value = " ".join(
            judge_heading_particle[name]
            for name in ("particle", "surname", "suffix")
        )
        start = judge_heading_particle.start("particle")
        return _evidence(
            text, start, judge_heading_particle.end("suffix"), value,
            "published_judge_surname_heading",
        )

    judge_heading_surname = re.search(
        r"^[ \t]*JUDGE:[ \t]*(?:\n[ \t]*)?"
        r"(?P<surname>[A-Z][A-Za-zÀ-ž’'-]{1,40})"
        r"(?:[ \t]*(?:\n[ \t]*)?(?P<suffix>J|JJ|CJ))?[ \t]*$",
        preamble, re.M | re.I,
    )
    if judge_heading_surname:
        surname = judge_heading_surname["surname"]
        suffix = judge_heading_surname["suffix"] or ""
        non_person_headings = {
            "DATE", "PLACE", "TIME", "MELBOURNE", "SYDNEY", "PERTH",
            "BRISBANE", "ADELAIDE", "CANBERRA", "DARWIN", "HOBART", "AUSTRALIA",
        }
        is_initials_only = bool(re.fullmatch(r"[A-Z]{1,3}", surname)) and not suffix
        is_unlabelled_particle = not suffix and not (surname.isupper() or surname.istitle())
        if surname.upper() not in non_person_headings and not is_initials_only and not is_unlabelled_particle:
            value = " ".join(part for part in (surname, suffix) if part)
            end = judge_heading_surname.end("suffix") if suffix else judge_heading_surname.end("surname")
            return _evidence(
                text, judge_heading_surname.start("surname"), end, value,
                "published_judge_surname_heading",
            )

    # Older AAT decision headers put the member and date on one line/cell,
    # without a colon after "Tribunal" (for example, "Tribunal Ms A Poljak,
    # Senior Member Date 9 November 2016"). Preserve only a clearly labelled
    # member role and a complete person name; never mistake a registrar for a
    # tribunal member.
    person = (
        r"(?:(?:(?:The[ \t\r\n]+)?Hon(?:ourable)?|"
        r"Mr|Mrs|Ms|Dr|Professor|Prof)\.?[ \t\r\n]+)?"
        r"(?:[A-Z](?:[A-Za-zÀ-ž’'.-]*[A-Za-zÀ-ž])?\.?[ \t\r\n]+){1,3}"
        r"[A-Z][A-Za-zÀ-ž’'.-]+"
        r"(?:[ \t,]*(?:C\.?B\.?E\.?|A\.?M\.?|Q\.?C\.?|R\.?F\.?D\.?|S\.?C\.?))*"
    )
    tribunal_roles = (
        r"Deputy[ \t\r\n]+President|President|Presidential[ \t\r\n]+Member|"
        r"Senior[ \t\r\n]+Member|Member"
    )
    role_before_name = re.compile(
        rf"^[ \t]*TRIBUNAL[ \t]*:?[ \t\r\n]+(?P<value>"
        rf"(?:{tribunal_roles})[ \t\r\n]+{person}"
        rf"(?:[., \t\r\n\-–—]+\(?(?:{tribunal_roles})\)?)?"
        rf")(?=[ \t\r\n]+Date\b|[ \t]*$)",
        re.I | re.M,
    )
    role_after_name = re.compile(
        rf"^[ \t]*TRIBUNAL[ \t]*:?[ \t\r\n]+(?P<value>{person}"
        rf"[., \t\r\n\-–—]+\(?(?:{tribunal_roles})\)?)(?=[ \t\r\n]+Date\b|[ \t]*$)",
        re.I | re.M,
    )
    for pattern in (role_before_name, role_after_name):
        match = pattern.search(preamble)
        if not match:
            continue
        value = " ".join(match["value"].split()).strip(" ,:\t")
        if (
            not value
            or len(value) > 100
            or len(value.split()) < 2
            or not re.fullmatch(r"[A-Za-zÀ-ž .,'’()\-/&]+", value)
            or re.search(
                r"\b(?:registrar|clerk|secretary|tribunal|court|applicant|respondent|"
                r"decision|hearing|date|not|above|none|unknown)\b",
                value,
                re.I,
            )
        ):
            continue
        pos = text.find(match["value"], match.start())
        return _evidence(
            text, pos, pos + len(match["value"]), value, "compact_tribunal_member_header"
        )

    # Some older AATA covers omit the member role and split the initials and
    # surname into separate lines immediately before CATCHWORDS. Accept this
    # only inside the structured Tribunal/Date/Place/Decision cover block.
    legacy_aata_member = re.search(
        r"(?is)\bADMINISTRATIVE APPEALS TRIBUNAL\b"
        r"(?P<cover>.*?\bTRIBUNAL\b.{0,240}\bDate\b.{0,120}\bPlace\b"
        r".{0,120}\bDecision\b.{0,500}?)"
        r"(?P<initials>^[ \t]*[A-Z]{1,3})[ \t]*\n"
        r"[ \t]*(?P<surname>[A-Z][A-Za-zÀ-ž’'-]{2,40})[ \t]*\n"
        r"[ \t]*CATCHWORDS\b",
        preamble,
        re.I | re.M | re.S,
    )
    if legacy_aata_member:
        initials = legacy_aata_member["initials"].strip()
        surname = legacy_aata_member["surname"].strip()
        value = f"{initials} {surname}"
        return _evidence(
            text,
            legacy_aata_member.start("initials"),
            legacy_aata_member.end("surname"),
            value,
            "aata_decision_cover_member_before_catchwords",
        )

    # Older RRT/MRT records put a single member's name below an explicit
    # member label, sometimes split across two cells ("Ms" / "Wendy Bodisson").
    short_eligibility_notice = re.search(
        r"\bADVICE OF ELIGIBILITY DECISION\b",
        preamble,
        re.I,
    )
    short_notice_member = re.search(
        r"(?im)^[ \t]*MEMBER[ \t]*:[ \t]*(?P<name>[^\n]+?)\s*$",
        preamble,
    )
    if short_eligibility_notice and short_notice_member:
        value = " ".join(short_notice_member["name"].split())
        if 2 <= len(value.split()) <= 5 and has_person_name(value):
            return _evidence(
                text,
                short_notice_member.start("name"),
                short_notice_member.end("name"),
                value,
                "short_eligibility_notice_member_label",
            )

    member_label = re.compile(
        r"^[ \t]*(?:PRESIDING MEMBER|CONSTITUTED MEMBER|TRIBUNAL MEMBER)"
        r"[ \t]*:?[ \t]*(?P<inline>[^\n]*)",
        re.I | re.M,
    )
    member_stops = re.compile(
        r"^[ \t]*(?:DATE\b|PLACE\b|DECISION\b|CATCHWORDS\b|REASONS\b|"
        r"MRT FILE\b|RRT FILE\b|DIMA FILE\b|FILE NUMBER\b|COUNTRY OF REFERENCE\b|"
        r"PRESIDING MEMBER\b|CONSTITUTED MEMBER\b|TRIBUNAL MEMBER\b)",
        re.I,
    )
    excluded_name_words = {
        "the", "hon", "honourable", "mr", "mrs", "ms", "dr", "prof", "professor",
        "member", "senior", "presidential", "deputy", "president", "cbe", "am",
        "qc", "rfd", "sc", "tribunal", "review", "registrar", "clerk", "secretary",
    }
    for match in member_label.finditer(preamble):
        parts = [match["inline"].strip()] if match["inline"].strip() else []
        cursor = match.end()
        end = match.end()
        nonempty_lines = 0
        for raw_line in preamble[cursor:].splitlines(keepends=True):
            line = raw_line.rstrip("\r\n").strip()
            if not line:
                cursor += len(raw_line)
                continue
            if nonempty_lines >= 5:
                break
            nonempty_lines += 1
            if member_stops.match(line):
                break
            if re.search(r"\b(?:Date|Place|Decision|Catchwords|Reasons|MRT File|RRT File)\b", line, re.I):
                line = re.split(
                    r"\b(?:Date|Place|Decision|Catchwords|Reasons|MRT File|RRT File)\b",
                    line, maxsplit=1, flags=re.I,
                )[0].strip(" :\t")
                if line:
                    parts.append(line)
                break
            parts.append(line)
            end = cursor + len(raw_line.rstrip("\r\n"))
            cursor += len(raw_line)
        value = " ".join(" ".join(parts).split()).strip(" ,:;")
        name_tokens = [
            token for token in re.findall(r"[A-Za-zÀ-ž]+", value)
            if token.casefold() not in excluded_name_words
        ]
        if (
            len(name_tokens) >= 2
            and len(name_tokens) <= 5
            and len(value) <= 100
            and not re.search(r"\b(?:and|&)\b", value, re.I)
            and re.fullmatch(r"[A-Za-zÀ-ž .,'’()\-/]+", value)
        ):
            return _evidence(text, match.start(), end, value, "published_author_label")

    # A single Tribunal name without a role is still explicit when it sits
    # between the printed TRIBUNAL label and the date field. Do not use this
    # form for panels or institution names.
    for match in re.finditer(r"^[ \t]*TRIBUNAL[ \t]*:?[ \t]*$", preamble, re.I | re.M):
        parts = []
        cursor = match.end()
        end = cursor
        has_date = False
        for raw_line in preamble[cursor:].splitlines(keepends=True)[:4]:
            line = raw_line.rstrip("\r\n").strip()
            if not line:
                cursor += len(raw_line)
                continue
            date_boundary = re.search(r"\bDate\b", line, re.I)
            if date_boundary:
                before_date = line[:date_boundary.start()].strip(" :\t")
                if before_date:
                    parts.append(before_date)
                has_date = True
                break
            if re.match(r"^(?:Place|Decision|Catchwords|Reasons|MRT File|RRT File)\b", line, re.I):
                break
            parts.append(line)
            end = cursor + len(raw_line.rstrip("\r\n"))
            cursor += len(raw_line)
        value = " ".join(" ".join(parts).split()).strip(" ,:;")
        tokens = re.findall(r"[A-Za-zÀ-ž]+", value)
        name_tokens = [token for token in tokens if token.casefold() not in excluded_name_words]
        looks_like_name = bool(re.search(r"(?:[A-Z][a-zÀ-ž’'-]{1,}|[A-Z]{3,})$", value))
        if (
            has_date
            and 2 <= len(name_tokens) <= 5
            and looks_like_name
            and len(value) <= 100
            and not re.search(r"\b(?:and|&)\b", value, re.I)
            and not re.search(r"\b(?:tribunal|court|registrar|secretary)\b", value, re.I)
            and re.fullmatch(r"[A-Za-zÀ-ž .,'’()\-/]+", value)
        ):
            return _evidence(text, match.start(), end, value, "compact_tribunal_member_header")

    # Federal Court and Magistrates Court transcripts vary the certificate
    # layout: "I certify", "I\ncertify", "I certify\nthat", or a named
    # associate who certifies. Search the full source because some publications
    # append a long schedule after the certificate. Keep the decision-maker
    # only when the certificate itself says the preceding reasons are a true
    # copy and names the author or authors.
    federal_certificate_start = re.compile(
        r"^[ \t]*I\b.{0,180}?\bcertify\b[ \t\r\n]*that\b",
        re.M | re.I | re.S,
    )
    for certificate in federal_certificate_start.finditer(text):
        certificate_text = text[certificate.end():certificate.end() + 1800]
        if not re.search(r"\btrue copy\b", certificate_text, re.I):
            continue

        certified_panel = re.search(
            r"true copy of\s+(?:the\s+)?Reasons\s+for\s+Judgment\s+herein\s+"
            r"of\s+the\s+Honourable\s+Justices\s+"
            r"(?P<names>[A-Z][A-Za-zÀ-ž’'-]{1,40}"
            r"(?:[\s,]+(?:and\s+)?[A-Z][A-Za-zÀ-ž’'-]{1,40}){1,4})"
            r"(?=\s*\.?\s*(?:Associate\b|Dated?\b|Date\b))",
            certificate_text, re.I | re.S,
        )
        if certified_panel:
            names = " ".join(certified_panel["names"].split()).strip(" ,.")
            name_tokens = re.findall(r"[A-Za-zÀ-ž’'-]+", names)
            if (
                2 <= len(name_tokens) <= 5
                and re.search(r",|\band\b", names, re.I)
                and re.fullmatch(r"[A-Za-zÀ-ž .,'’\-]+", names)
            ):
                start = certificate.end() + certified_panel.start("names")
                end = certificate.end() + certified_panel.end("names")
                return _evidence(
                    text, start, end, f"Justices {names}",
                    "own_judgment_certification",
                )

        certified_justice = re.search(
            r"true copy of\s+(?:the\s+)?Reasons\s+for\s+Judgment(?:\s+herein)?\s+"
            r"of\s+the\s+Honourable\s+Justice\s+"
            r"(?P<name>[A-Z][A-Za-z’'-]{1,40})\b",
            certificate_text, re.I | re.S,
        )
        if certified_justice and "\ufffd" not in certified_justice["name"]:
            start = certificate.end() + certified_justice.start("name")
            end = certificate.end() + certified_justice.end("name")
            return _evidence(
                text, start, end, f"Justice {certified_justice['name']}",
                "own_judgment_certification",
            )

        certified = re.search(
            r"reasons\s+for\s+(?:judgment|decision)[\s\S]{0,100}?\bof\s+"
            r"(?:the\s+Honourable\s+(?:Justice|Judge)\s+)?"
            r"(?P<name>[A-Z][A-Za-zÀ-ž’' .-]{1,65}?\s+(?:CFM|FM|JJ|J))\b",
            certificate_text, re.I,
        )
        if certified:
            value = " ".join(certified["name"].split())
            if "\ufffd" not in value and re.fullmatch(
                r"[A-Za-zÀ-ž’' .-]+\s+(?:CFM|FM|JJ|J)", value
            ):
                start = certificate.end() + certified.start("name")
                end = certificate.end() + certified.end("name")
                return _evidence(
                    text, start, end, value, "own_judgment_certification",
                )

    # Some AAT publications identify the issuing member only in the official
    # certification that the preceding reasons are a true copy. The wording
    # varies: the name can follow "herein of", follow the reason title directly,
    # or be split over several lines. Keep the full stated panel when the
    # Tribunal header independently names one.
    certificate_window_start = max(0, len(text) - 12000)
    certificate_window = text[certificate_window_start:]
    member_role = re.compile(
        r"\b(?:Deputy[ \t\r\n]+President|Presidential[ \t\r\n]+Member|"
        r"Senior[ \t\r\n]+Member|Member)\b",
        re.I,
    )
    certified_copy = re.search(
        r"^I certify that(?P<block>.{0,800}?true copy.{0,400})",
        certificate_window,
        re.M | re.I | re.S,
    )
    author_tail = ""
    author_start = 0
    if certified_copy:
        block = certified_copy["block"]
        cues = list(re.finditer(
            r"\b(?:herein[ \t\r\n]+of|(?:written[ \t\r\n]+)?reasons?"
            r"[ \t\r\n]+for[ \t\r\n]+(?:the[ \t\r\n]+)?"
            r"(?:decision|judgment)(?:[ \t\r\n]+herein)?[ \t\r\n]+of|"
            r"(?:decision|judgment)[ \t\r\n]+of)\b",
            block,
            re.I,
        ))
        if cues:
            cue = cues[-1]
            author_start = certified_copy.start("block") + cue.end()
            author_tail = block[cue.end():]
    else:
        # A few older AATA certificates omit the phrase "true copy" but state
        # directly that the preceding paragraphs are the decision of a named
        # member. Require that exact certification form.
        direct_certificate = re.search(
            r"^I certify that.{0,300}?preceding(?:[ \t\r\n]+\d+)?"
            r"[ \t\r\n]+(?:numbered[ \t\r\n]+)?paragraphs[ \t\r\n]+are"
            r"[ \t\r\n]+of[ \t\r\n]+(?P<author>.{1,180})",
            certificate_window,
            re.M | re.I | re.S,
        )
        if direct_certificate:
            author_start = direct_certificate.start("author")
            author_tail = direct_certificate["author"]

    if author_tail:
        boundary = re.search(
            r"^[ \t]*(?:Signed|Date(?:/s)?|Place|CATCHWORDS|REASONS|"
            r"Associate|\[\s*Sgd|\(\s*Sgd|\.{3,}|_{3,})[^\n]*",
            author_tail,
            re.M | re.I,
        )
        if boundary:
            author_tail = author_tail[:boundary.start()]
        author_parts = []
        for line in author_tail.splitlines()[:8]:
            cleaned = line.strip()
            if not cleaned or re.fullmatch(r"[. _-]+", cleaned):
                continue
            if re.search(r"\b(?:Associate|Applicant|Respondent|Minister|Secretary|Solicitor|Counsel|Registrar)\b", cleaned, re.I):
                break
            cleaned = re.sub(r"\.{2,}|_{2,}", " ", cleaned)
            author_parts.append(cleaned)
        raw_value = " ".join(author_parts)
        value = " ".join(raw_value.split()).strip(" ,.;:()")
        value = re.sub(r",?\s*\(\s*(?=(?:Deputy President|Senior Member|Member)\b)", ", ", value, flags=re.I)
        person_tokens = re.findall(r"[A-Za-zÀ-ž]+", member_role.sub(" ", value))
        excluded_tokens = {
            "the", "hon", "honourable", "mr", "mrs", "ms", "dr", "prof", "professor",
            "associate", "emeritus", "qc", "am", "sc", "rfd", "cbe", "of", "and",
        }
        person_tokens = [token for token in person_tokens if token.casefold() not in excluded_tokens]
        rejected_author = re.search(
            r"\b(?:applicant|respondent|minister|secretary|solicitor|counsel|registrar)\b",
            value, re.I,
        )
        header_names = []
        for header_value, header_roles in tribunal_headers:
            if not header_roles:
                continue
            header_tokens = re.findall(r"[A-Za-zÀ-ž]+", member_role.sub(" ", header_value))
            header_tokens = [token for token in header_tokens if token.casefold() not in excluded_tokens]
            if len(header_tokens) >= 2:
                header_names.append(header_tokens)
        consistent_header = not any(
            person_tokens and header_tokens[-1].casefold() != person_tokens[-1].casefold()
            for header_tokens in header_names
        )
        multiple_persons = bool(re.search(r"\band\b|&", value, re.I)) or len(person_tokens) >= 4
        roles = list(member_role.finditer(value))
        if (
            2 <= len(person_tokens) <= 5
            and len(value) <= 180
            and not rejected_author
            and not (multiple_persons and not header_names)
            and consistent_header
            and re.fullmatch(r"[A-Za-zÀ-ž .,'’()\-/&;]+", value)
        ):
            start = certificate_window_start + author_start
            return _evidence(
                text, start, start + len(raw_value), value,
                "own_judgment_certification",
            )

    # AAT decisions often place an explicit [Sgd] marker directly beside the
    # signing member's name and role. Accept a single signer only when the
    # printed Tribunal header does not show a multi-member panel.
    has_multi_role_header = any(len(roles) >= 2 for _value, roles in tribunal_headers)
    if not has_multi_role_header:
        signatures = re.finditer(
            r"\[\s*Sgd\.?(?P<bracket>[^\]]*)\]|\(\s*Sgd\.?(?P<paren>[^)]*)\)",
            text,
            re.I,
        )
        for signature in signatures:
            tail = text[signature.end():signature.end() + 360]
            parts = []
            inline_name = signature["bracket"] or signature["paren"] or ""
            if inline_name.strip():
                parts.append(inline_name.strip(" .\t"))
            nonempty_lines = 0
            for line in tail.splitlines():
                cleaned = line.strip()
                if not cleaned:
                    continue
                if re.fullmatch(r"[. _-]+", cleaned):
                    continue
                if re.match(r"^(?:Date|Place|Catchwords|Reasons|Associate)\b", cleaned, re.I):
                    break
                if nonempty_lines >= 5:
                    break
                nonempty_lines += 1
                cleaned = re.sub(r"\.{2,}|_{2,}", " ", cleaned)
                parts.append(cleaned.strip(" .\t"))
            value = " ".join(" ".join(parts).split()).strip(" ,:;")
            words = [token for token in re.findall(r"[A-Za-zÀ-ž]+", value)
                     if token.casefold() not in excluded_name_words]
            roles = list(re.finditer(
                r"\b(?:Deputy President|Presidential Member|Senior Member|Member)\b",
                value, re.I,
            ))
            if (
                len(roles) == 1
                and 2 <= len(words) <= 5
                and not re.search(r"\b(?:and|&)\b", value, re.I)
                and re.fullmatch(r"[A-Za-zÀ-ž .,'’()\-/]+", value)
            ):
                end = signature.end() + len(tail.splitlines()[0]) if tail.splitlines() else signature.end()
                return _evidence(text, signature.start(), end, value, "signed_tribunal_member")
    # Fallback for older publication layouts. Existing extraction rules above
    # retain priority; these run only after they fail to identify a judge.
    split_member = re.search(
        r"(?im)^[ \t]*TRIBUNAL[ \t]*\r?\n[ \t]*MEMBER[ \t]*:[ \t]*(?P<name>[^\r\n]+)",
        source_header,
    )
    if split_member and has_person_name(split_member["name"]):
        name = " ".join(split_member["name"].split()).strip(" ,;:")
        return _evidence(
            text, split_member.start(), split_member.end(), name,
            "split_tribunal_member_header",
        )

    # Some AAT/ART decision records explicitly list all panel members beneath
    # a MEMBERS heading. Keep the complete panel, not only its presiding member.
    for panel in re.finditer(r"(?i)\bMEMBERS[ \t]*:[ \t]*", source_header):
        tail = source_header[panel.end():panel.end() + 700]
        members: list[str] = []
        end = panel.end()
        for raw_line in tail.splitlines(keepends=True)[:8]:
            line = raw_line.strip()
            if not line:
                end += len(raw_line)
                continue
            date_boundary = re.search(
                r"\b(?:DATE(?:[ \t]+OF)?(?:[ \t]+(?:DECISION|CORRIGENDUM))?|"
                r"PLACE[ \t]+OF[ \t]+DECISION)\b",
                line, re.I,
            )
            if date_boundary:
                line = line[:date_boundary.start()].strip()
            member = named_member_line(line)
            if member:
                members.append(member)
                end += len(raw_line)
            elif date_boundary:
                break
            elif members:
                break
            else:
                end += len(raw_line)
            if date_boundary:
                break
        if len(members) >= 2:
            return _evidence(
                text, panel.start(), end, "; ".join(members),
                "published_tribunal_panel",
            )

    # AAT cover sheets can name the Tribunal member without stating a role.
    # Accept only a single person between the standalone TRIBUNAL and Date fields.
    tribunal_name = re.search(
        r"(?im)^[ \t]*TRIBUNAL[ \t]*\r?\n[ \t]*(?P<name>"
        r"(?:(?:Mr|Mrs|Ms|Dr|Professor|Prof)\.?[ \t]+)?"
        r"[A-Z][A-Za-zÀ-ž.'’ -]{1,75}(?:[ \t]+(?:AM|AO|QC|SC|RFD|CBE|PSM))?)"
        r"[ \t]*\r?\n[ \t]*DATE\b",
        source_header,
    )
    if (
        tribunal_name
        and has_person_name(tribunal_name["name"])
        and not member_role.search(tribunal_name["name"])
        and not re.search(r"\b(?:and|&)\b", tribunal_name["name"], re.I)
    ):
        name = " ".join(tribunal_name["name"].split()).strip(" ,;:")
        return _evidence(
            text, tribunal_name.start(), tribunal_name.end(), name,
            "named_tribunal_header",
        )

    # AAT cover sheets sometimes put the member's name and role in the first
    # few lines under DECISION or REASONS FOR DECISION. Only inspect the short
    # front-matter block before catchwords or substantive reasons begin.
    for heading in re.finditer(
        r"(?im)^[ \t]*(?:DECISION(?:[ \t]+RECORD)?|REASONS FOR DECISION)"
        r"(?P<inline>[^\r\n]*)",
        source_header,
    ):
        block_start = heading.start("inline")
        block = source_header[block_start:block_start + 1800]
        boundary = re.search(
            r"(?im)^[ \t]*(?:CATCHWORDS|BACKGROUND|INTRODUCTION|"
            r"ISSUES? FOR DETERMINATION|LEGISLATION)\b",
            block,
        )
        if boundary:
            block = block[:boundary.start()]
        lines = [heading["inline"], *block.splitlines()]
        cursor = block_start
        for line in lines[:16]:
            member = named_member_line(line)
            if member:
                position = source_header.find(
                    line.strip(), max(0, cursor - 120), cursor + len(block) + 2
                )
                if position >= 0:
                    return _evidence(
                        text, position, position + len(line.strip()), member,
                        "aat_member_role_header",
                    )
            cursor += len(line) + 1

    return None


def _outcome(text: str) -> Evidence | None:
    # Only the publication's own operative table, before its reasons. Never
    # return a date, catchword, proposed order, or an isolated evidence finding.
    preamble = re.split(
        r"^[ \t]*(?:REASONS FOR (?:JUDGMENT|DECISION)|"
        r"STATEMENT OF DECISION(?!\s+AND\s+REASONS))\b",
        text,
        maxsplit=1,
        flags=re.I | re.M,
    )[0][:12000]
    short_eligibility_notice = re.search(
        r"\bADVICE OF ELIGIBILITY DECISION\b",
        preamble,
        re.I,
    )
    ineligible_catchwords = re.search(
        r"(?im)^[ \t]*CATCHWORDS?\s*:\s*Eligibility\s*[-–—]\s*"
        r"ineligible\s+for\s+review\b",
        preamble,
    )
    no_standing = re.search(
        r"\bThe\s+review\s+applicant\s+is\s+not\s+a\s+person\s+with\s+"
        r"standing\s+to\s+apply\s+for\s+review(?:\s+of\s+the\s+Department['’]s\s+decision)?\b",
        preamble,
        re.I,
    )
    if short_eligibility_notice and ineligible_catchwords and no_standing:
        return _evidence(
            text,
            ineligible_catchwords.start(),
            ineligible_catchwords.end(),
            "Ineligible for review",
            "published_eligibility_standing_decision",
        )
    # Some Federal Court publications place separate operative orders for
    # multiple docket numbers before one shared reasons heading. Keep each
    # party attached to its own formal order instead of returning only the
    # first table or accidentally absorbing the next docket's heading.
    operative_tables = list(re.finditer(
        r"(?im)^[ \t]*THE COURT ORDERS(?: THAT)?[ \t]*:[ \t]*$",
        preamble,
    ))
    if len(operative_tables) > 1:
        court_headers = list(re.finditer(
            r"(?im)^[ \t]*IN THE FEDERAL COURT OF AUSTRALIA\b",
            preamble,
        ))
        multi_order_results = []
        docket_numbers = set()
        last_order_end = 0
        for index, table in enumerate(operative_tables):
            previous_headers = [header for header in court_headers if header.start() < table.start()]
            following_headers = [header for header in court_headers if header.start() > table.start()]
            if not previous_headers:
                multi_order_results = []
                break
            header_start = previous_headers[-1].start()
            header_text = preamble[header_start:table.start()]
            docket = re.search(
                r"(?i)\b([A-Z]{1,4}\s*\d{1,5}\s+of\s+\d{4})\b",
                header_text,
            )
            party = re.search(
                r"(?is)\bBETWEEN:\s*(?P<name>.{1,100}?)\s+APPLICANT\b",
                header_text,
            )
            if not docket or not party:
                multi_order_results = []
                break
            docket_numbers.add(" ".join(docket.group(1).split()).casefold())
            table_end = following_headers[0].start() if following_headers else len(preamble)
            order_block = preamble[table.end():table_end]
            note = re.search(r"(?im)^[ \t]*Note\s*:", order_block)
            if note:
                order_block = order_block[:note.start()]
                table_end = table.end() + note.start()
            numbered = list(re.finditer(r"(?im)^[ \t]*\d+[.)]?[ \t]+", order_block))
            if not numbered:
                multi_order_results = []
                break
            clauses = []
            for clause_index, clause in enumerate(numbered):
                clause_end = numbered[clause_index + 1].start() if clause_index + 1 < len(numbered) else len(order_block)
                clause_text = " ".join(order_block[clause.end():clause_end].split())
                if clause_text:
                    number = re.search(r"\d+", clause.group(0))
                    clauses.append(f"{number.group(0)} {clause_text}")
            if not clauses:
                multi_order_results = []
                break
            name = " ".join(party.group("name").split())
            multi_order_results.append(f"{name}: " + " ".join(clauses))
            last_order_end = max(last_order_end, table_end)
        if len(multi_order_results) == len(operative_tables) and len(docket_numbers) == len(operative_tables):
            start = operative_tables[0].start()
            value = "; ".join(multi_order_results)
            return Evidence(
                value,
                text[start:last_order_end],
                start,
                last_order_end,
                "published_multiple_operative_tables",
            )
    for match in re.finditer(r"^(?:THE COURT ORDERS(?: THAT)?|ORDERS?|DECISION)(?:[ \t]*:[ \t]*|[ \t]*\n)", preamble, re.I | re.M):
        remainder = preamble[match.end():]
        stop = re.search(
            r"^(?:CATCHWORDS|LEGISLATION|REPRESENTATION|BETWEEN|REASONS|NOTE:|FEDERAL (?:COURT|MAGISTRATES)|"
            r"DATE|PLACE|SIGNATURE|(?:APPLICANT|RESPONDENT)\s*:|STATEMENT OF|REASONS FOR)\b|"
            r"^TRIBUNAL(?:[ \t]+MEMBER)?[ \t]*:?[ \t]*$",
            remainder,
            re.I | re.M,
        )
        signature = re.search(r"^[ \t]*[.·…_—-]{8,}[ \t]*$", remainder, re.M)
        boundaries = [match.start() for match in (stop, signature) if match]
        block = remainder[:min(boundaries) if boundaries else len(remainder)].strip()
        if not block or len(block) > 4000 or re.search(r"(?:\.\.\.|…)\s*$", block):
            continue
        if not re.search(r"\b(?:affirm|remit|set aside|dismiss|allow|refus|grant|pay|adjourn|declar|revok|quash|substitut|withdraw|extend)\w*\b", block, re.I):
            continue
        if re.search(r"\b(?:I (?:will|would|propose)|will be|would be|proposed|subject to further submissions|adjourned for further hearing)\b", block, re.I):
            continue
        if re.search(r"\b(?:the|in accordance with|of|and|to)\s*$", block, re.I):
            continue
        value = " ".join(block.split())
        return _evidence(text, match.end(), match.end() + len(block), value, "published_operative_table")
    # A few older AATA text copies omit the operative table but retain both
    # the s 200 catchword and the Tribunal's final no-deportation conclusion.
    # Use this narrower summary only after searching for an explicit order.
    aata_catchwords = re.search(
        r"(?is)\bCATCHWORDS\b(?P<block>.*?)(?=\n[ \t]*(?:Migration Act\b|"
        r"REASONS FOR DECISION\b))",
        preamble,
    )
    no_deportation_catchword = (
        re.search(
            r"\bs\s*200\b.{0,240}\bshould not be exercised to deport the Applicant\b",
            aata_catchwords["block"],
            re.I | re.S,
        )
        if aata_catchwords
        else None
    )
    no_deportation_conclusion = re.search(
        r"(?is)other relevant considerations.{0,400}"
        r"favour\s+(?:his|the Applicant['’]s)\s+not being deported\b",
        text,
    )
    if no_deportation_catchword and no_deportation_conclusion:
        return _evidence(
            text,
            aata_catchwords.start("block") + no_deportation_catchword.start(),
            aata_catchwords.start("block") + no_deportation_catchword.end(),
            "The Applicant should not be deported",
            "aata_s200_non_deportation_conclusion",
        )
    return None


def _structured_visa_refusal_subclass(text: str, assessment: Assessment) -> Evidence | None:
    """Resolve a visa subclass only from a linked, structured tribunal refusal.

    Some MRTA publications identify the refusal and visa applicant in a
    decision-record block, then identify the applicable visa through a
    numbered Schedule 2 clause in the reasons. Require all three links so a
    legislative example or an old visa mentioned elsewhere cannot qualify.
    """
    if assessment.source_status != "checked" or not assessment.citation:
        return None

    section = re.search(
        r"(?is)\bAPPLICATION FOR REVIEW\s*:(.{0,1800}?)\bJURISDICTION AND STANDING\b",
        text,
    )
    if not section:
        return None
    review_record = section.group(1)
    applicant = re.search(r"(?im)^\s*Visa Applicant Details:\s*(?P<name>[^\n]+)", review_record)
    decision_type = re.search(r"(?im)^\s*Decision Type:\s*Visa refusal\s*$", review_record)
    primary_decision_date = re.search(r"(?im)^\s*Date of Primary Decision:\s*\S.+$", review_record)
    if not (applicant and applicant["name"].strip() and decision_type and primary_decision_date):
        return None

    application_date = re.search(
        r"(?i)\bvisa applicant\b.{0,120}?\blodged\s+(?:her|his|their)\s+"
        r"application\s+on\s+\d{1,2}\s+[A-Z][a-z]+\s+(?:19|20)\d{2}\b",
        text,
    )
    decision = re.search(
        r"(?ims)^[ \t]*DECISION:[ \t]*(.{0,800}?)(?=^[ \t]*CATCHWORDS\b)",
        text,
    )
    if not application_date or not decision:
        return None
    decision_text = decision.group(1)
    if not re.search(
        r"(?i)\bvisa applicant\b.{0,180}\b(?:qualifying score|points test)\b",
        decision_text,
    ):
        return None

    criteria = re.search(r"(?is)\bLEGISLATION, VISA CRITERIA AND POLICY\b(.*)", text)
    if not criteria:
        return None
    criteria_text = criteria.group(1)
    clause_pattern = re.compile(
        r"(?is)\bClause\s+(?P<number>\d{3})\.\d{1,3}\s+of\s+Part\s+"
        r"(?P=number)\s+of\s+Schedule\s+2\s+to\s+the\s+Migration\s+Regulations\b"
        r".{0,300}?\brequires?\s+that\s+the\s+applicant\b"
    )
    clauses = []
    for match in clause_pattern.finditer(criteria_text):
        context = criteria_text[match.start():min(len(criteria_text), match.end() + 500)]
        if not re.search(r"(?i)\b(?:qualifying score|points test)\b", context):
            continue
        number = match["number"]
        if not re.search(rf"(?i)\bSubclass\s+{number}\b", criteria_text):
            continue
        clauses.append((number, match))

    numbers = {number for number, _ in clauses}
    if len(numbers) != 1:
        return None

    number, clause = clauses[0]
    start = criteria.start(1) + clause.start()
    end = criteria.start(1) + clause.end()
    value = f"Subclass {number} visa"
    proof = _evidence(text, start, end, value, "structured_visa_refusal_subclass_clause")
    assessment.candidates.append({
        "value": value,
        "quote": proof.quote,
        "qualified": True,
        "rank": 4,
        "supporting_quotes": [
            applicant.group(0).strip(),
            decision_type.group(0).strip(),
            primary_decision_date.group(0).strip(),
            application_date.group(0).strip(),
            decision.group(0).strip(),
        ],
    })
    return proof


def _visa(text: str, assessment: Assessment) -> Evidence | None:
    # Paragraphs containing current-review language outrank an old application.
    # Boilerplate, other people's visas, and a bare program name never qualify.
    catchwords_match = re.search(r"(?i)\bCATCHWORDS?\b", text[:8000])
    catchwords = ""
    catchwords_start = 0
    if catchwords_match:
        catchwords_start = catchwords_match.end()
        catchwords = text[catchwords_start:catchwords_start + 2500]
        catchwords_end = re.search(
            r"(?im)^[ \t]*(?:LEGISLATION|CASES CITED|CASES|REPRESENTATION|SOLICITORS|"
            r"ORDERS?|REASONS FOR (?:JUDGMENT|DECISION)|STATEMENT OF DECISION AND REASONS|"
            r"DECISION RECORD|BETWEEN|APPLICANT)\b\s*:?",
            catchwords,
        )
        if catchwords_end:
            catchwords = catchwords[:catchwords_end.start()]

    # A tribunal review expressly framed as a business sponsorship rejection
    # concerns the employer's sponsorship approval, even when its reasons quote
    # a worker's visa or mention a separate visa-refusal proceeding.
    if re.search(
        r"(?i)\breview of (?:the )?business sponsorship rejection\b",
        catchwords,
    ):
        return None

    # The applicants in Cujba expressly asked the Minister for 21-day tourist
    # visas and linked that request to withdrawing the current Federal Court
    # proceedings. This narrow letter pattern identifies the live visa request,
    # rather than an historical tourist visa or a generic example in the law.
    current_tourist_visa_request = re.search(
        r"(?is)\brequest for (?P<days>\d{1,2})\s+day tourist visas\b"
        r".{0,140}?\bwhether\s+or\s+not\s+that\s+response\s+is\s+positive\b"
        r".{0,100}?\bwe\s+promise\s+to\s+withdraw\s+the\s+current\s+proceedings\s+"
        r"in\s+the\s+Federal\s+Court\b",
        text[:12000],
    )
    if current_tourist_visa_request:
        proof = _evidence(
            text,
            current_tourist_visa_request.start(),
            current_tourist_visa_request.end(),
            "Tourist visa",
            "current_applicant_tourist_visa_request_in_proceedings",
        )
        assessment.candidates.append({
            "value": proof.value,
            "quote": proof.quote,
            "qualified": True,
            "rank": 6,
        })
        return proof

    # Prefer the visa application actually described in the current matter
    # over a different, older visa mentioned in its history. These patterns
    # require the application and its adverse decision to be linked in the
    # judgment itself.
    employer_nomination = re.search(
        r"(?is)\bapplication\s+from\s+(?:the\s+)?applicant\s+for\s+(?:an?\s+)?"
        r"(?P<name>Employer\s+Nomination\s*\(Residence\)\s*\(Class\s+BW\))\s+visa\b",
        text[:12000],
    )
    if (
        employer_nomination
        and re.search(
            r"(?i)\bapplication\s+for\s+review\s+of\s+(?:the\s+)?decision\s+of\s+"
            r"[^\n]{0,100}\bMRT\b",
            catchwords,
        )
        and re.search(r"(?is)\b(?:Tribunal|MRT)\b.{0,350}?\b(?:refus\w*|not\s+to\s+grant)\b.{0,220}?\bvisa\b", text[:12000])
    ):
        proof = _evidence(
            text,
            employer_nomination.start("name"),
            employer_nomination.end(),
            "Employer Nomination (Residence) (Class BW) visa",
            "current_class_bw_application_under_review",
        )
        assessment.candidates.append({
            "value": proof.value,
            "quote": proof.quote,
            "qualification_quote": catchwords,
            "qualified": True,
            "rank": 5,
        })
        return proof

    current_student_clause = re.search(
        r"(?is)\bvisa\s+application\s+was\s+refused\s+by\s+(?:a\s+)?delegate\b"
        r".{0,360}?\bcl(?:ause)?\.?\s*(?P<number>57[0-6])\.\d{1,3}\b",
        text[:12000],
    )
    if current_student_clause and re.search(
        r"(?i)\bgenuine\s+student\b",
        text[current_student_clause.start():current_student_clause.end() + 700],
    ):
        number = current_student_clause["number"]
        proof = _evidence(
            text,
            current_student_clause.start("number"),
            current_student_clause.end("number"),
            f"Subclass {number} visa",
            "current_student_application_refusal_clause",
        )
        assessment.candidates.append({
            "value": proof.value,
            "quote": proof.quote,
            "qualification_quote": current_student_clause.group(0),
            "qualified": True,
            "rank": 5,
        })
        return proof

    current_student_application = re.search(
        r"(?is)\b(?:the\s+)?applicant\s+lodged\s+an?\s+application\s+for\s+a\s+"
        r"Student\s*\(\s*Subclass\s+(?P<number>57[0-6])\s*\)\s+visa\s*"
        r"\(\s*the\s+visa\s*\)"
        r".{0,700}?\bthe\s+delegate\s+refused\s+to\s+grant\s+"
        r"(?:the\s+)?applicant\s+the\s+visa\b",
        text[:12000],
    )
    if current_student_application:
        number = current_student_application["number"]
        proof = _evidence(
            text,
            current_student_application.start("number"),
            current_student_application.end("number"),
            f"Subclass {number} visa",
            "current_student_application_refusal",
        )
        assessment.candidates.append({
            "value": proof.value,
            "quote": proof.quote,
            "qualification_quote": current_student_application.group(0),
            "qualified": True,
            "rank": 6,
        })
        return proof

    current_tpv_application = re.search(
        r"(?is)\bapplicant\s+applied\s+for\s+(?:a\s+)?temporary\s+protection\s+visa\b",
        text[:12000],
    )
    if current_tpv_application:
        refusal = re.search(
            r"(?is)\bdecision\s+refusing\s+to\s+grant\s+"
            r"(?:(?:the\s+)?applicant\s+)?(?:the\s+)?protection\s+visa\s+"
            r"that\s+(?:he|she|they|the\s+applicant)\s+sought\b",
            text[current_tpv_application.end():current_tpv_application.end() + 2500],
        )
        if refusal:
            proof = _evidence(
                text,
                current_tpv_application.start(),
                current_tpv_application.end(),
                "Subclass 785 visa",
                "current_temporary_protection_application_refusal",
            )
            assessment.candidates.append({
                "value": proof.value,
                "quote": proof.quote,
                "qualification_quote": refusal.group(0),
                "qualified": True,
                "rank": 5,
            })
            return proof

    current_shev_application = re.search(
        r"(?is)\b(?:first\s+)?applicant\s+\(applicant\)\s+applied\s+for\s+a\s+(?P<name>SHEV)\b",
        text[:12000],
    )
    if current_shev_application:
        refusal = re.search(
            r"(?is)\bdelegate\s+refused\s+to\s+grant\s+the\s+applicants?\s+a\s+SHEV\b",
            text[current_shev_application.end():current_shev_application.end() + 5000],
        )
        if refusal:
            proof = _evidence(
                text,
                current_shev_application.start("name"),
                current_shev_application.end("name"),
                "Subclass 790 visa",
                "current_shev_application_refusal",
            )
            assessment.candidates.append({
                "value": proof.value,
                "quote": proof.quote,
                "qualification_quote": refusal.group(0),
                "qualified": True,
                "rank": 5,
            })
            return proof

    decision_record = re.search(
        r"(?is)\bDECISION RECORD\b(?P<block>.{0,1800})",
        text[:8000],
    )
    if decision_record:
        decision_markers = re.finditer(
            r"(?im)(?<!OF )\bDECISION[ \t]*:[ \t]*\r?\n?",
            decision_record["block"],
        )
        for decision_marker in decision_markers:
            decision_text_start = decision_marker.end()
            decision_text = decision_record["block"][decision_text_start:decision_text_start + 700]
            boundary = re.search(
                r"(?im)^[ \t]*(?:STATEMENT MADE|STATEMENT OF DECISION|CATCHWORDS|"
                r"LEGISLATION|REASONS FOR|REPRESENTATION)\b",
                decision_text,
            )
            if boundary:
                decision_text = decision_text[:boundary.start()]
            if not re.search(
                r"(?i)\b(?:affirm|remit|set aside|refus\w*|not to grant|grant|cancel\w*|revok\w*)\b",
                decision_text,
            ):
                continue
            decision_matches = list(_VISA.finditer(decision_text))
            distinct_values = {" ".join(match[0].split()).casefold() for match in decision_matches}
            if len(distinct_values) != 1 or not decision_matches:
                continue
            match = decision_matches[0]
            value = " ".join(match[0].split())
            start = decision_record.start("block") + decision_text_start + match.start()
            end = decision_record.start("block") + decision_text_start + match.end()
            proof = _evidence(text, start, end, value, "operative_decision_record_visa")
            assessment.candidates.append({
                "value": proof.value,
                "quote": proof.quote,
                "qualified": True,
                "rank": 4,
            })
            return proof

    # Migration Act s 36(2C)(a)(ii) is a protection-visa criterion. Some AAT
    # decisions identify the reviewable decision by this exact paragraph but
    # never repeat the words "protection visa". Require the linked s 36(2)(aa)
    # complementary-protection finding as a second, nearby indicator so a
    # bare statutory citation elsewhere in the reasons cannot qualify.
    s36_reviewable_decision = re.search(
        r"(?is)\b(?:the\s+)?(?:reviewable\s+decision|decision\s+under\s+review)\b"
        r".{0,320}?\bs\.?\s*36\s*\(\s*2c\s*\)\s*\(\s*a\s*\)\s*\(\s*ii\s*\)",
        text[:12000],
    )
    s36_complementary_protection = re.search(
        r"(?is)\bcomplementary\s+protection\s+obligations\s+under\s+"
        r"s\.?\s*36\s*\(\s*2\s*\)\s*\(\s*aa\s*\)",
        text[:12000],
    )
    if (
        s36_reviewable_decision
        and s36_complementary_protection
        and abs(s36_complementary_protection.start() - s36_reviewable_decision.end()) <= 600
    ):
        proof = _evidence(
            text,
            s36_reviewable_decision.start(),
            s36_reviewable_decision.end(),
            "Protection visa",
            "protection_visa_s36_reviewable_decision",
        )
        assessment.candidates.append({
            "value": proof.value,
            "quote": proof.quote,
            "qualification_quote": s36_complementary_protection.group(0),
            "qualified": True,
            "rank": 4,
        })
        return proof

    resident_return_heading = re.search(
        r"(?is)\b(?:refus\w*|cancel\w*|revok\w*|"
        r"non[ -]revocation)\b.{0,180}?\b(?P<name>"
        r"(?:Five\s+Year\s+)?Resident\s+Return(?:\s*\(Class\s+BB\))?"
        r"(?:\s*\(Subclass\s+155\))?)\s+visa\b",
        catchwords,
    )
    if resident_return_heading:
        value = " ".join(resident_return_heading["name"].split()) + " visa"
        proof = _evidence(
            text, catchwords_start + resident_return_heading.start("name"),
            catchwords_start + resident_return_heading.end(),
            value, "current_resident_return_visa_catchwords",
        )
        assessment.candidates.append({
            "value": proof.value,
            "quote": proof.quote,
            "qualified": True,
            "rank": 4,
        })
        return proof

    if catchwords:
        safe_haven_name = re.search(
            r"(?i)\bSafe\s+Haven\s+Enterprise\s+visas?\b",
            catchwords,
        )
        if safe_haven_name and re.search(
            r"(?i)\b(?:application|review|decision|appeal)\b", catchwords,
        ):
            start = catchwords_start + safe_haven_name.start()
            end = catchwords_start + safe_haven_name.end()
            proof = _evidence(
                text, start, end, "Safe Haven Enterprise visa",
                "current_safe_haven_enterprise_visa_catchwords",
            )
            assessment.candidates.append({
                "value": proof.value,
                "quote": proof.quote,
                "qualified": True,
                "rank": 4,
            })
            return proof

    results: list[tuple[int, Evidence]] = []

    # Some s 501 cancellation decisions identify only the legal effect of the
    # current visa, not its subclass. Accept that broad type only when the
    # source ties the holder's permanent-residence visa to the cancellation
    # decision that is expressly the subject of the review.
    permanent_residence_cancellation = re.search(
        r"(?is)\bFrom\s+[^,.;\n]{1,80},\s*until\s+(?:the\s+)?"
        r"(?:Delegate|Minister)(?:['’\s\uFFFD]{0,6}s)?\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}\s+"
        r"cancellation\s+decision\b"
        r"(?:(?![.?!]).){0,160}?\bthat\s+is\s+the\s+subject\s+of\s+"
        r"these\s+review\s+proceedings\b"
        r"(?:(?![.?!]).){0,160}?\bheld\s+(?:a|the)\s+visa\s+entitling\s+"
        r"(?:him|her|them|the\s+applicant)\s+to\s+reside\s+permanently\s+"
        r"in\s+Australia\b",
        text[:12000],
    )
    if permanent_residence_cancellation:
        proof = _evidence(
            text,
            permanent_residence_cancellation.start(),
            permanent_residence_cancellation.end(),
            "Permanent visa",
            "current_permanent_residence_cancellation",
        )
        assessment.candidates.append({
            "value": proof.value,
            "quote": proof.quote,
            "qualified": True,
            "rank": 3,
        })
        results.append((3, proof))

    # Some decisions state the current visa class directly in an application
    # narrative, then link the same application to a refusal and review. Keep
    # the class name only when that chain is explicit and local to the case.
    class_bt_application = re.search(
        r"(?is)\bthe\s+appellants?\s+applied\s+to\s+(?:the\s+)?department\s+for\s+"
        r"(?P<name>Child\s*\(Residence\)\s*\(Class\s+BT\))\s+visas?\b",
        text[:12000],
    )
    class_bt_refusal = None
    if class_bt_application:
        after_application = text[class_bt_application.end():class_bt_application.end() + 1800]
        class_bt_refusal = re.search(
            r"(?is)\bdelegate\s+refused\s+to\s+grant\s+(?:the\s+)?visa\b"
            r".{0,350}?\bappellants?\s+applied\b.{0,180}?\btribunal\b"
            r".{0,120}?\breview\s+of\s+that\s+decision\b",
            after_application,
        )
    if class_bt_application and class_bt_refusal:
        value = "Child (Residence) (Class BT) visa"
        proof = _evidence(
            text,
            class_bt_application.start("name"),
            class_bt_application.end("name"),
            value,
            "current_class_bt_application_refusal_review",
        )
        assessment.candidates.append({
            "value": proof.value,
            "quote": proof.quote,
            "qualification_quote": class_bt_refusal.group(0),
            "qualified": True,
            "rank": 4,
        })
        results.append((4, proof))

    # A class mentioned as background is not enough. For Class BF, require the
    # same person's visa to be expressly cancelled and that cancellation to be
    # the decision under review which the tribunal then revokes.
    class_bf_cancellation = re.search(
        r"(?is)\b(?:minister|department)\s+(?:cancelled|canceled)\s+"
        r"(?P<subject>[^,.;\n]{1,90}?)\s+visa\s*\(\s*"
        r"(?P<class>Class\s+BF\s+transitional\s*\(\s*permanent\s*\))\s*\)",
        text,
    )
    class_bf_review_outcome = re.search(
        r"(?is)\bdecision\s+under\s+review\s+is\s+set\s+aside\b.{0,220}?"
        r"\bcancellation\s+of\s+(?P<subject>[^,.;\n]{1,90}?)\s+visa\s+is\s+revoked\b",
        text,
    )
    if class_bf_cancellation and class_bf_review_outcome:
        normalize_subject = lambda value: re.sub(r"[^\w]+", " ", value.casefold()).strip()
        if normalize_subject(class_bf_cancellation["subject"]) == normalize_subject(class_bf_review_outcome["subject"]):
            value = "Class BF Transitional (Permanent) visa"
            proof = _evidence(
                text,
                class_bf_cancellation.start("class"),
                class_bf_cancellation.end("class"),
                value,
                "current_class_bf_cancellation_review",
            )
            assessment.candidates.append({
                "value": proof.value,
                "quote": proof.quote,
                "qualification_quote": class_bf_review_outcome.group(0),
                "qualified": True,
                "rank": 4,
            })
            results.append((4, proof))

    class_visa_matches = [
        match for match in _VISA.finditer(text)
        if re.match(r"(?i)^class\s+\d{3}\b", match[0].strip())
    ]
    class_visa_values = {re.sub(r"\s+", " ", match[0]).casefold() for match in class_visa_matches}
    class_holder_matches = [
        match for match in class_visa_matches
        if re.search(r"(?i)\bholder of\s+(?:a|an|the)\s*$", text[max(0, match.start() - 100):match.start()])
    ]
    cancellation_review_headnote = re.search(
        r"(?is)\bjudicial review\b.{0,260}\b(?:cancellation of (?:the )?visa|visa cancellation)\b",
        text[:6000],
    )
    cancellation_decision = re.search(
        r"(?is)\b(?:minister(?:['’]s)?|department|respondent)\b.{0,240}?"
        r"\b(?:decision\s+to\s+cancel|decided\s+to\s+cancel|"
        r"considering\s+the\s+cancellation|intention\s+to\s+cancel|"
        r"cancel(?:led|ed)?)\b.{0,160}?\bvisa\b",
        text,
    )
    class_cancellation_review = bool(
        len(class_visa_values) == 1
        and class_holder_matches
        and cancellation_review_headnote
        and cancellation_decision
    )
    for match in _VISA.finditer(text):
        line_start = text.rfind("\n", 0, match.start()) + 1
        sentence_end = text.rfind(". ", line_start, match.start())
        sentence_start = sentence_end + 2 if sentence_end >= 0 else line_start
        line_end = text.find("\n", match.end())
        line_end = len(text) if line_end < 0 else line_end
        before = text[max(sentence_start, match.start() - 240):match.start()]
        context = text[max(0, line_start - 140):min(len(text), line_end + 180)]
        value = re.sub(r"(?i)\bvisas?$", "visa", " ".join(match[0].split()))
        if re.match(r"(?i)^class\s+\d{3}\b", value) and class_cancellation_review:
            value = re.sub(r"(?i)^class\s+(\d{3})", r"Class \1", value, count=1)
            value = re.sub(r"(?i)\bresident\b", "Resident", value)
            value = re.sub(r"(?i)\bvisa\b", "visa", value)
            quote = _evidence(text, match.start(), match.end(), value, "current_class_visa_cancellation_review")
            assessment.candidates.append({
                "value": value,
                "quote": quote.quote,
                "qualification_quote": cancellation_decision.group(0),
                "qualified": True,
                "rank": 4,
            })
            results.append((4, quote))
            continue
        if value.lower().startswith("sublcass"):
            value = re.sub(r"^Sublcass\s+", "", value, flags=re.I)
        rank = 0
        if re.search(r"\b(?:decision (?:under review|to refuse|not to grant)|review of (?:the )?(?:refusal|visa refusal)|refus(?:e|ed|ing)\b.{0,140})", before, re.I):
            rank = 3
        # Some ART/AAT catchwords state the live review as a non-revocation of
        # cancellation of a Resident Return visa without repeating "visa
        # cancellation" in the exact line immediately before the visa name.
        # Require the action, visa family, and visa word in the publication's
        # own short catchwords block so historical mentions do not qualify.
        if match.start() < 3000 and re.search(r"CATCHWORDS[^\n]*(?:visa refusal|visa cancellation|refusal of|cancellation of)", before, re.I):
            rank = 3
        if re.search(r"\b(?:section|subregulation|regulation|subclause|example|for instance|another case|not relevant|applicant submits|applicant claims)\b", before, re.I):
            rank = 0
        if re.search(r"\b(?:may|might|could|should|entitled to)\s+(?:apply|be granted|refuse)|application for (?:a |an )?visa.{0,80}\bmeans\b|which provides|provides that|have failed|did not appeal", context, re.I):
            rank = 0
        # Some judgments identify the visa in one sentence and then state that
        # the delegate made an adverse decision on "that application" in the
        # same paragraph. Require both links so an unrelated historical visa
        # or a separate decision cannot qualify the candidate.
        current_application = re.search(
            r"\b(?:applicant|appellant|he|she)\s+(?:lodged|made|filed)\s+"
            r"an?\s+application\s+for\s+(?:a|an)\s*$",
            before,
            re.I,
        )
        linked_decision = re.search(
            r"\b(?:delegate|tribunal|minister)\b[^.\n]{0,100}"
            r"\b(?:adverse\s+)?decision\s+on\s+(?:that|the|this)\s+application\b",
            text[match.end():line_end],
            re.I,
        )
        if current_application and linked_decision:
            rank = max(rank, 3)

        # Some judicial-review reasons identify the visa indirectly: the
        # court says it was not open to the Minister to grant the applicant's
        # visa application, identifies the missing condition precedent, then
        # names the applicable subclass provision. Treat that as current-case
        # evidence only when all three links name the same subclass.
        subclass = re.match(r"(?:sub[- ]?class|sublcass)\s+(\d{3})", value, re.I)
        application_provision = None
        if subclass:
            number = subclass[1]
            application_provision = re.search(
                r"(?is)\bnot\s+open\s+to\s+(?:the\s+)?(?:minister|delegate)\s+"
                r"to\s+grant\s+the\s+(?:visa\s+)?applicant[’']s\s+visa\s+application\b"
                r".{0,700}?\bcondition\s+precedent\b.{0,450}?"
                rf"\b(?:relevant|applicable)\s+provision\s+is\s+sub[- ]?class\s+{number}\.\d+\b",
                text,
            )
        if application_provision:
            value = f"Subclass {subclass[1]} visa"
            quote = Evidence(
                value=value,
                quote=text[application_provision.start():application_provision.end()],
                start=match.start(),
                end=match.end(),
                rule="current_visa_application_subclass_provision",
            )
            rank = max(rank, 4)
        else:
            quote = _evidence(text, match.start(), match.end(), value, "direct_current_visa_statement")
        assessment.candidates.append({"value": value, "quote": quote.quote, "qualified": bool(rank), "rank": rank})
        if rank:
            results.append((rank, quote))

    # Some published decisions put the applicant's exact class/subclass in an
    # endnote. Use it only when the same numbered marker is attached to a
    # sentence about the current applicant's visa and a decision, refusal,
    # cancellation, or revocation. A free-standing historical footnote is not
    # enough to identify the visa under review.
    footnotes = list(re.finditer(r"^[ \t]*\[(\d{1,3})\][ \t]*\n", text, re.M))
    current_visa_reference = re.compile(
        r"(?is)(?:applicant[’']s\s+(?:refugee\s+|protection\s+)?visa|"
        r"visa\s+(?:under\s+review|that\s+was\s+cancelled|was\s+cancelled|was\s+refused)|"
        r"cancellation\s+of\s+(?:the\s+)?(?:applicant[’']s\s+)?visa|"
        r"refusal\s+of\s+(?:the\s+)?visa)"
    )
    current_decision_context = re.compile(
        r"(?i)\b(?:decision|refus\w*|cancel\w*|revok\w*|grant\w*)\b"
    )
    for index, footnote in enumerate(footnotes):
        note_end = footnotes[index + 1].start() if index + 1 < len(footnotes) else min(len(text), footnote.end() + 900)
        note = text[footnote.end():note_end]
        # Only a directly stated class/subclass has a stable value. Generic
        # footnote references to a visa family remain review candidates.
        for visa_match in _VISA.finditer(note):
            value = visa_match[0].strip()
            if not re.search(r"\b(?:sub[- ]?class|class\s+[A-Z]{2})\b", value, re.I):
                continue
            marker = re.compile(r"\[" + re.escape(footnote[1]) + r"\]")
            for reference in marker.finditer(text[:footnote.start()]):
                context = text[max(0, reference.start() - 420):reference.start()]
                if not current_visa_reference.search(context) or not current_decision_context.search(context):
                    continue
                start = footnote.end() + visa_match.start()
                end = footnote.end() + visa_match.end()
                proof = _evidence(text, start, end, value, "cross_referenced_current_visa_footnote")
                linked_quote = _evidence(text, reference.start(), reference.end(), footnote[1],
                                         "current_visa_footnote_reference")
                assessment.candidates.append({
                    "value": value,
                    "quote": proof.quote,
                    "reference_quote": linked_quote.quote,
                    "qualified": True,
                    "rank": 4,
                })
                results.append((4, proof))
                break

    # Some older reasons use a bare numeric visa name ("457 visa"), or the
    # class-prefixed form "TY 444 visa", without the word "subclass". Accept
    # these only in the current catchwords or reasons, and only when the same
    # passage ties the code to an applicant and a live application, review, or
    # visa decision. This keeps section 501 and case citations from being
    # mistaken for subclass numbers.
    direct_numbered_visa = re.compile(
        r"(?i)\b(?:(?:sub[- ]?class|subclause)\s+|(?:TY|TU)[- ]?)?"
        r"(?P<number>\d{3})\s*\)?\s+visa\b"
    )
    existing_visa_spans = list(_VISA.finditer(text))
    decision_heading = re.search(
        r"(?im)^[^\n]{0,240}?\b(?:REASONS FOR (?:JUDGMENT|DECISION)|"
        r"STATEMENT OF DECISION AND REASONS|DECISION RECORD|APPLICATION FOR REVIEW)\b",
        text,
    )
    decision_end = len(text)
    if decision_heading:
        following_reference = re.search(
            r"(?im)^[ \t]*(?:SECONDARY MATERIALS|CASES CITED|OTHER AUTHORITIES|REFERENCES)\b",
            text[decision_heading.start():],
        )
        if following_reference:
            decision_end = decision_heading.start() + following_reference.start()
    primary_issue = ""
    if decision_heading:
        issue_start = decision_heading.end()
        primary_issue = text[issue_start:decision_end]
        background_start = re.search(
            r"(?im)^[ \t]*(?:PROCEDURAL HISTORY|FACTUAL BACKGROUND|BACKGROUND)\b",
            primary_issue,
        )
        if background_start:
            primary_issue = primary_issue[:background_start.start()]
        primary_issue = primary_issue[:2600]
    primary_decision_summary = catchwords + "\n" + primary_issue
    sponsorship_or_nomination_review_in_primary = bool(re.search(
        r"(?i)\b(?:business\s+sponsorship|business\s+sponsor|"
        r"review of (?:the )?nomination|application for approval of (?:the )?nomination|"
        r"nomination application|approved as a standard business sponsor)\b",
        primary_decision_summary,
    ))
    visa_disposition_in_primary_issue = bool(re.search(
        r"(?is)(?:\b(?:refus\w*|not\s+to\s+grant|not\s+granted|cancel\w*|revok\w*)\b"
        r".{0,180}\b(?:sub[- ]?class\s+\d{2,3}\s*)?visa\b|"
        r"\b(?:sub[- ]?class\s+\d{2,3}\s*)?visa\b"
        r".{0,180}\b(?:refus\w*|not\s+granted|cancel\w*|revok\w*)\b)",
        primary_decision_summary,
    ))
    catchwords_end = catchwords_start + len(catchwords)
    source_citations = list(CITATION.finditer(text))
    corporate_nomination = bool(
        re.search(
            r"(?is)\b(?:corporate applicant|applicant company|APPLICANT\s*:\s*"
            r"[\w &.,'’/-]{1,120}\b(?:Pty\.?\s+Ltd|Proprietary Limited|P\s*/\s*L|Limited))\b",
            text[:12000],
        )
        and re.search(r"(?is)\b(?:nomination|nominee)\b", text[:12000])
    )
    other_applicant_not_named = bool(re.search(
        r"(?is)\b(?:present|current)\s+applicant\b.{0,180}?\bnot\s+(?:named|identified)\b",
        text[:16000],
    ))
    for match in direct_numbered_visa.finditer(text):
        if sponsorship_or_nomination_review_in_primary and not visa_disposition_in_primary_issue:
            continue
        if any(
            span.start() <= match.start() < span.end()
            and re.search(r"(?i)\bvisa\b", span[0])
            for span in existing_visa_spans
        ):
            continue
        if any(span.start() <= match.start() < span.end() for span in source_citations):
            continue
        number = match["number"]
        if number == "501" or (number in {"457", "186", "482"} and re.search(
            r"(?i)\bnominee\b.{0,160}\b" + re.escape(number) + r"\s+visa\b",
            text[max(0, match.start() - 500):match.end() + 500],
        )):
            continue
        if corporate_nomination or other_applicant_not_named:
            continue
        prefix = text[max(0, match.start() - 40):match.start()]
        if re.search(r"(?i)(?:\bsection\s*$|(?:^|[\s,])s\.?\s*$)", prefix):
            continue
        in_catchwords = bool(catchwords and catchwords_start <= match.start() < catchwords_end)
        in_reasons = bool(
            decision_heading
            and decision_heading.start() <= match.start() <= decision_end
        )
        if not in_catchwords and not in_reasons:
            continue
        context = text[max(0, match.start() - 500):min(len(text), match.end() + 500)]
        if re.search(
            r"(?i)\b(?:previous|earlier|historical|former)\b.{0,100}\b"
            + re.escape(number) + r"\s+visa\b|\b(?:different|another)\s+applicant\b",
            context,
        ):
            continue
        subject = re.search(
            r"(?i)\b(?:applicant|appellant|visa applicant|primary applicant|first respondent)\b",
            context,
        )
        action = re.search(
            r"(?i)\b(?:appl(?:y|ied|ication)|review|appeal|decision|refus\w*|"
            r"grant\w*|cancel\w*|revok\w*)\b",
            context,
        )
        numbered_visa_pattern = (
            r"(?:(?:sub[- ]?class|subclause)\s+|(?:TY|TU)[- ]?)?"
            + re.escape(number)
            + r"\s*\)?\s+visa"
        )
        direct_action = re.search(
            r"(?is)(?:\b(?:appl(?:y|ied|ication)|review|appeal|decision|refus\w*|"
            r"grant\w*|cancel\w*|revok\w*)\b.{0,180}\b"
            + numbered_visa_pattern
            + r"\b|\b"
            + numbered_visa_pattern
            + r"\b.{0,180}\b(?:appl(?:y|ied|ication)|review|appeal|decision|"
            r"refus\w*|grant\w*|cancel\w*|revok\w*)\b)",
            context,
        )
        another_person_visa = re.search(
            r"(?is)\b(?:my|his|her|their|the\s+applicant[’']s)\s+"
            r"(?:former\s+)?(?:wife|husband|spouse|partner|son|daughter|child|"
            r"mother|father)\b"
            r"[^.!?]{0,240}?\b(?:she|he|they)\b[^.!?]{0,180}?"
            r"\b(?:appl\w*|lodg\w*|fil\w*|receiv\w*|grant\w*|hold\w*)\b"
            r"[^.!?]{0,140}?\b(?:sub[- ]?class\s+)?"
            + re.escape(number)
            + r"\s+visa\b",
            context,
        )
        visa_status_only = re.search(
            r"(?is)\bvisa\b.{0,140}\b(?:ceased|expired)\b.{0,140}\b"
            r"(?:does not currently hold|does not hold|no longer holds)\b.{0,80}\bvisa\b",
            context,
        )
        explicit_visa_disposition = re.search(
            r"(?is)(?:\b(?:refus\w*|grant\w*|cancel\w*|revok\w*)\b.{0,120}\b"
            + numbered_visa_pattern
            + r"\b|\b"
            + numbered_visa_pattern
            + r"\b.{0,120}\b(?:refus\w*|grant\w*|cancel\w*|revok\w*)\b)",
            context,
        )
        if visa_status_only and not explicit_visa_disposition:
            continue
        if another_person_visa or not subject or not action or not direct_action:
            continue
        proof = _evidence(
            text, match.start(), match.end(), f"Subclass {number} visa",
            "direct_current_numbered_visa_decision",
        )
        assessment.candidates.append({
            "value": proof.value,
            "quote": proof.quote,
            "qualified": True,
            "rank": 3,
        })
        results.append((3, proof))
    if not results:
        structured_refusal = _structured_visa_refusal_subclass(text, assessment)
        if structured_refusal:
            return structured_refusal

        def unique_distant_rrt_decision_date(source: str) -> re.Match[str] | None:
            """Allow a distant RRT date only when the source leaves one clear decision."""
            month = (
                r"Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
                r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?"
            )
            date = (
                r"(?P<date>(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:" + month + r")\s+|"
                r"(?:" + month + r")\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+|"
                r"(?:" + month + r")\s+|\d{1,2}[/-]\d{1,2}[/-])"
                r"(?P<year>(?:19|20)\d{2}))\b"
            )
            pattern = re.compile(
                r"(?is)(?:\b(?:RRT|Refugee\s+Review\s+Tribunal|Tribunal)\b[^.]{0,45}\bdecision\b|"
                r"\bdecision\b[^.]{0,55}\b(?:of|by)\s+(?:the\s+)?"
                r"(?:RRT|Refugee\s+Review\s+Tribunal|Tribunal)\b)"
                r"[^.]{0,140}\b(?:made|handed\s+down|dated|delivered|given)\b\s+"
                r"(?:(?:on|in)\s+)?" + date
            )
            prior = re.compile(
                r"(?i)\b(?:earlier|previous|prior|initial|former|first)\s+"
                r"(?:(?:RRT|Refugee Review Tribunal|Tribunal)\s+)?decision\b"
            )
            identity_mismatch = re.search(
                r"(?is)(?:\b(?:RRT|Refugee\s+Review\s+Tribunal)\b[^.]{0,160}\bdecision\b|"
                r"\bdecision\b[^.]{0,160}\b(?:RRT|Refugee\s+Review\s+Tribunal)\b)"
                r"[^.]{0,200}\b(?:appears?|seems?|refers?)\b[^.]{0,120}\b"
                r"(?:different|another)\s+(?:visa\s+)?applicant\b",
                source,
            )
            if identity_mismatch:
                return None
            dated = [
                match for match in pattern.finditer(source)
                if int(match["year"]) >= 1995
                and not prior.search(source[max(0, match.start() - 90):match.start() + 30])
            ]
            distinct_dates = {
                " ".join(match["date"].casefold().split()) for match in dated
            }
            return dated[0] if dated and len(distinct_dates) == 1 else None

        # Part 7 s 411(1)(a)-(b) also covers certain RRT decisions made before
        # 1 September 1994, before the protection-visa regime. Therefore the
        # publication year of this court case cannot stand in for the date of
        # the RRT decision. Infer Protection visa only when this verified
        # case's migration headnote identifies an RRT decision as the subject
        # AND the source states that decision was made/handed down/dated in
        # 1995 or later. (Migration Act 1958 (Cth), historical s 411(1)(c)-(d):
        # https://www.legislation.gov.au/C1958A00062/1999-07-22/1999-07-22/text/original/epub/OEBPS/document_2/document_2.html)
        if assessment.reasons.get("visa_type") != "conflicting_current_visa_candidates":
            source_citation = CITATION.search(text[:1800])
            if (
                source_citation
                and canonical_citation(source_citation[0]) == assessment.citation
            ):
                header = text[source_citation.end():source_citation.end() + 4000]
                header_end = re.search(
                    r"^[ \t]*(?:Migration Act\b|Federal Court Rules\b|Federal Magistrates Court Rules\b|"
                    r"LEGISLATION\b|CASES CITED\b|APPLICANT\b|FIRST APPLICANT\b|FILE NUMBER\b|"
                    r"JUDGE\b|JUDGMENT OF\b|DATE OF\b|REPRESENTATION\b|ORDERS\b|BETWEEN\b|"
                    r"REASONS FOR JUDGMENT\b)",
                    header,
                    re.I | re.M,
                )
                headnote = header[:header_end.start() if header_end else min(len(header), 1200)]
                migration = re.search(r"\bMIGRATION\b", headnote, re.I)
                if migration:
                    headnote = headnote[migration.start():]
                    rrt_decision = re.search(
                        r"\b(?:RRT|Refugee Review Tribunal)\s+decision\b"
                        r"|\bdecision\s+(?:of|by)\s+(?:the\s+)?(?:RRT|Refugee Review Tribunal)\b"
                        r"|\bjurisdictional\s+error\b[\s\S]{0,80}?\bby\s+(?:the\s+)?(?:RRT|Refugee Review Tribunal)\b"
                        r"|\b(?:review|judicial review|application for review|application to review|appeal from)\b"
                        r"[\s\S]{0,160}?\b(?:RRT|Refugee Review Tribunal)\b"
                        r"[\s\S]{0,80}?\bdecision\b",
                        headnote,
                        re.I,
                    )
                    ministerial_subject = re.search(
                        r"(?i)\b(?:Ministerial intervention|"
                        r"(?:review of )?(?:the )?Minister(?:'s)? decision[^.]{0,160}(?:substitut|intervention|s\.?\s*48b)|"
                        r"decision of (?:the )?Minister[^.]{0,160}(?:substitut|intervention|s\.?\s*48b)|"
                        r"Minister[^.]{0,100}not to (?:consider substituting|substitute|intervene)|"
                        r"s\.?\s*48b[^.]{0,160}Minister(?:'s)? decision)\b",
                        headnote,
                    )
                    ambiguous_ministerial_target = re.search(
                        r"(?is)\bapplication\b.{0,160}?\b(?:purports?|appears?)\b.{0,100}?"
                        r"\bchallenge\b.{0,180}?\b(?:decision\s+of\s+the\s+Minister|"
                        r"Ministerial\s+decision)\b.{0,100}?\bs\.?\s*417\b",
                        text[:12000],
                    )
                    decision_date_pattern = re.compile(
                        # AustLII's extracted judgments frequently wrap each
                        # source line. Keep the sentence boundary, but allow
                        # those line breaks while linking the RRT decision date.
                        r"(?is)(?:\b(?:RRT|Refugee Review Tribunal|Tribunal)\b[^.]{0,45}\bdecision\b|"
                        r"\bdecision\b[^.]{0,55}\b(?:of|by)\s+(?:the\s+)?"
                        r"(?:RRT|Refugee Review Tribunal|Tribunal)\b)"
                        r"[^.]{0,75}\b(?:made|handed\s+down|dated|delivered|given)\b"
                        r"[^.]{0,55}\b((?:19|20)\d{2})\b",
                    )
                    dated_rrt_decisions = [
                        match for match in decision_date_pattern.finditer(text)
                        if int(match[1]) >= 1995
                        and not re.search(
                            r"(?i)\b(?:earlier|previous|prior|initial|former|first)\s+"
                            r"(?:(?:RRT|Refugee Review Tribunal|Tribunal)\s+)?decision\b",
                            text[max(0, match.start() - 90):match.start() + 30],
                        )
                    ]
                    rrt_decision_date = dated_rrt_decisions[0] if dated_rrt_decisions else None
                    rrt_decision_start = None
                    distant_link = False
                    if rrt_decision:
                        rrt_decision_start = source_citation.end() + migration.start() + rrt_decision.start()
                    elif not ministerial_subject and not ambiguous_ministerial_target:
                        # Some Federal Court reasons omit the RRT link from the
                        # catchwords but state it plainly in the opening account
                        # of the current proceeding. Require a dated RRT
                        # decision within 300 characters of that link so a
                        # historical citation cannot supply the visa type.
                        body_rrt_target = re.search(
                            r"(?is)(?:\b(?:application|appeal|proceeding|judicial review|motion)\b"
                            r"[^.]{0,220}\b(?:decision\s+(?:of|by)|decision\s+made\s+by)\b"
                            r"[^.]{0,40}\b(?:Refugee\s+Review\s+Tribunal|RRT)\b|"
                            r"\b(?:decision\s+(?:of|by)|decision\s+made\s+by)\b"
                            r"[^.]{0,40}\b(?:RRT|Refugee\s+Review\s+Tribunal)\b"
                            r"[^.]{0,220}\b(?:application|appeal|proceeding|judicial review|motion)\b)",
                            text[:12000],
                        )
                        linked_date = next((
                            match for match in dated_rrt_decisions
                            if body_rrt_target and abs(match.start() - body_rrt_target.start()) <= 300
                        ), None)
                        distant_link = False
                        if body_rrt_target and not linked_date:
                            linked_date = unique_distant_rrt_decision_date(text)
                            distant_link = linked_date is not None
                        if body_rrt_target and linked_date:
                            rrt_decision = body_rrt_target
                            rrt_decision_start = body_rrt_target.start()
                            rrt_decision_date = linked_date
                    if (
                        rrt_decision
                        and not ministerial_subject
                        and not ambiguous_ministerial_target
                        and rrt_decision_date
                    ):
                        start = rrt_decision_start
                        proof = _evidence(
                            text,
                            start,
                            start + len(rrt_decision[0]),
                            "Protection visa",
                            "rrt_protection_visa_review_under_migration_act_s411",
                        )
                        assessment.candidates.append({
                            "value": proof.value,
                            "quote": proof.quote,
                            "qualification_quote": _evidence(
                                text, rrt_decision_date.start(), rrt_decision_date.end(),
                                "RRT decision date", "rrt_decision_date",
                            ).quote if not distant_link else rrt_decision_date[0],
                            "qualified": True,
                            "rank": 4,
                        })
                        return proof
                else:
                    # Some court publications omit catchwords entirely. In
                    # that format, only accept an explicit current-proceeding
                    # link to an RRT decision and its date in the same short
                    # passage; the RRT's statutory review jurisdiction then
                    # identifies the matter as a protection-visa decision.
                    ministerial_context = headnote + "\n" + text[:6000]
                    ministerial_subject = re.search(
                        r"(?i)\b(?:Ministerial intervention|"
                        r"(?:review of )?(?:the )?Minister(?:'s)? decision[^.]{0,160}(?:substitut|intervention|s\.?\s*48b)|"
                        r"decision of (?:the )?Minister[^.]{0,160}(?:substitut|intervention|s\.?\s*48b)|"
                        r"Minister[^.]{0,100}not to (?:consider substituting|substitute|intervene)|"
                        r"s\.?\s*48b[^.]{0,160}Minister(?:'s)? decision)\b",
                        ministerial_context,
                    )
                    ambiguous_ministerial_target = re.search(
                        r"(?is)\bapplication\b.{0,160}?\b(?:purports?|appears?)\b.{0,100}?"
                        r"\bchallenge\b.{0,180}?\b(?:decision\s+of\s+the\s+Minister|"
                        r"Ministerial\s+decision)\b.{0,100}?\bs\.?\s*417\b",
                        text[:12000],
                    )
                    decision_date_pattern = re.compile(
                        r"(?is)(?:\b(?:RRT|Refugee Review Tribunal|Tribunal)\b[^.]{0,45}\bdecision\b|"
                        r"\bdecision\b[^.]{0,55}\b(?:of|by)\s+(?:the\s+)?"
                        r"(?:RRT|Refugee Review Tribunal|Tribunal)\b)"
                        r"[^.]{0,75}\b(?:made|handed\s+down|dated|delivered|given)\b"
                        r"[^.]{0,55}\b((?:19|20)\d{2})\b",
                    )
                    dated_rrt_decisions = [
                        match for match in decision_date_pattern.finditer(text)
                        if int(match[1]) >= 1995
                        and not re.search(
                            r"(?i)\b(?:earlier|previous|prior|initial|former|first)\s+"
                            r"(?:(?:RRT|Refugee Review Tribunal|Tribunal)\s+)?decision\b",
                            text[max(0, match.start() - 90):match.start() + 30],
                        )
                    ]
                    body_rrt_target = re.search(
                        r"(?is)(?:\b(?:application|appeal|proceeding|judicial review|motion)\b"
                        r"[^.]{0,220}\b(?:decision\s+(?:of|by)|decision\s+made\s+by)\b"
                        r"[^.]{0,40}\b(?:Refugee\s+Review\s+Tribunal|RRT)\b|"
                        r"\b(?:decision\s+(?:of|by)|decision\s+made\s+by)\b"
                        r"[^.]{0,40}\b(?:RRT|Refugee\s+Review\s+Tribunal)\b"
                        r"[^.]{0,220}\b(?:application|appeal|proceeding|judicial review|motion)\b)",
                        text[:12000],
                    )
                    linked_date = next((
                        match for match in dated_rrt_decisions
                        if body_rrt_target and abs(match.start() - body_rrt_target.start()) <= 300
                    ), None)
                    distant_link = False
                    if body_rrt_target and not linked_date:
                        linked_date = unique_distant_rrt_decision_date(text)
                        distant_link = linked_date is not None
                    if (
                        body_rrt_target
                        and linked_date
                        and not re.search(
                            r"(?is)(?:\bMinister\b.{0,180}\b(?:s\.?\s*48b|section\s+48b)\b|"
                            r"\b(?:s\.?\s*48b|section\s+48b)\b.{0,180}\bMinister\b)",
                            ministerial_context,
                        )
                        and not ministerial_subject
                        and not ambiguous_ministerial_target
                    ):
                        proof = _evidence(
                            text,
                            body_rrt_target.start(),
                            body_rrt_target.end(),
                            "Protection visa",
                            "rrt_protection_visa_review_under_migration_act_s411",
                        )
                        assessment.candidates.append({
                            "value": proof.value,
                            "quote": proof.quote,
                            "qualification_quote": _evidence(
                                text, linked_date.start(), linked_date.end(),
                                "RRT decision date", "rrt_decision_date",
                            ).quote if not distant_link else linked_date[0],
                            "qualified": True,
                            "rank": 4,
                        })
                        return proof
        return None
    best = max(rank for rank, _ in results)
    winners = {re.sub(r"\s+", " ", e.value).casefold(): e for rank, e in results if rank == best}
    # A subclass and its spelled-out family can both be true, but without a
    # proven binding that is a review item, not permission to pick the first.
    if len(winners) == 1:
        return next(iter(winners.values()))
    assessment.reasons["visa_type"] = "conflicting_current_visa_candidates"
    return None


def _direct_personal_nomination_visa(text: str, title: str) -> Evidence | None:
    """Resolve a personal visa refusal hidden by an employer-nomination label.

    This narrow fallback requires a source paragraph that directly links a
    refusal/non-grant to a visa, a named applicant, and one unambiguous numbered
    visa in the judgment. Company applicants are excluded by the caller and
    checked again here because some source records omit their title field.
    """
    corporate_title = bool(re.search(
        r"(?i)\b(?:Pty\.?\s+Ltd|Proprietary Limited|P\s*/\s*L|Limited)\b",
        title or "",
    ))
    corporate_caption = bool(re.search(
        r"(?is)\b(?:corporate applicant|applicant company|APPLICANT\s*:\s*"
        r"[\w &.,'’/-]{1,120}\b(?:Pty\.?\s+Ltd|Proprietary Limited|P\s*/\s*L|Limited))\b",
        text[:12000],
    ))
    if corporate_title or corporate_caption:
        return None

    source = text[:30000]
    if re.search(
        r"(?is)\b(?:it|this\s+application|the\s+present\s+application|"
        r"this\s+proceeding|the\s+present\s+proceeding)\b"
        r".{0,180}?\bdoes\s+not\s+seek\s+(?:judicial\s+)?review\s+of\s+"
        r"(?:a|the)\s+decision\s+to\s+(?:cancel|refuse|grant)\b"
        r".{0,120}?\bvisa\b",
        source[:12000],
    ):
        return None
    catchwords_match = re.search(r"(?i)\bCATCHWORDS?\b\s*:?", source[:9000])
    catchwords = source[catchwords_match.end():catchwords_match.end() + 2600] if catchwords_match else ""
    catchwords_end = re.search(
        r"(?im)^[ \t]*(?:LEGISLATION|CASES CITED|REPRESENTATION|SOLICITORS|ORDERS?|"
        r"REASONS FOR (?:JUDGMENT|DECISION)|PROCEDURAL HISTORY|FACTUAL BACKGROUND|"
        r"BACKGROUND|INTRODUCTION|DECISION RECORD|STATEMENT OF DECISION AND REASONS)\b",
        catchwords,
    )
    if catchwords_end:
        catchwords = catchwords[:catchwords_end.start()]
    if re.search(
        r"(?i)\breview of (?:the )?business sponsorship rejection\b",
        catchwords,
    ):
        return None
    operative_decision = ""
    decision_label = re.search(
        r"(?im)^[ \t]*(?:DECISION|ORDERS?)\s*:\s*",
        source[:9000],
    )
    if decision_label:
        decision_tail = source[decision_label.end():9000]
        decision_end = re.search(
            r"(?im)^[ \t]*(?:STATEMENT OF DECISION AND REASONS|REASONS FOR "
            r"(?:JUDGMENT|DECISION)|APPLICATION FOR REVIEW|BACKGROUND)\b",
            decision_tail,
        )
        operative_decision = (
            decision_tail[:decision_end.start()] if decision_end else decision_tail[:1200]
        )
        sponsor_only_disposition = bool(re.search(
            r"(?is)\b(?:refus\w*\s+to\s+approv\w*|refus\w*\s+approval\s+of|"
            r"decision\s+to\s+refus\w*\s+approval\s+of)\b"
            r".{0,220}\b(?:business\s+)?sponsor\b|"
            r"\b(?:refus\w*|reject\w*)\b.{0,180}\b(?:business\s+)?sponsor\b",
            operative_decision,
        ))
        visa_disposition_in_order = bool(re.search(
            r"(?is)(?:\bvisa\b.{0,180}\b(?:refus\w*|not\s+granted|"
            r"declin\w*|cancel\w*)\b|"
            r"\b(?:refus\w*|not\s+granted|declin\w*|cancel\w*)\b"
            r".{0,180}\bvisa\b)",
            operative_decision,
        ))
        if sponsor_only_disposition and not visa_disposition_in_order:
            return None
    if catchwords:
        headnote = catchwords
    else:
        reasons_start = re.search(
            r"(?im)^[^\n]{0,240}?\b(?:REASONS FOR (?:JUDGMENT|DECISION)|"
            r"STATEMENT OF DECISION AND REASONS|DECISION RECORD|ORDERS?)\b",
            source[:9000],
        )
        headnote = source[:reasons_start.start()] if reasons_start else source[:2600]
    if re.search(
        r"(?is)\b(?:remnant|residual|remaining)\s+costs?\s+issues?\b|"
        r"\bapplication for (?:review of )?(?:a )?(?:judicial )?registrar['’]s decision\b"
        r".{0,220}\b(?:costs?|costs order)\b",
        catchwords,
    ):
        return None
    costs_only_judgment = bool(
        re.search(r"(?i)\bcosts(?:-only)? judgment\b", catchwords)
        or re.search(
            r"(?is)\bthis judgment is in response to a request\b"
            r".{0,320}\b(?:written )?reasons?\b.{0,240}\bcosts? orders?\b",
            source[:9000],
        )
    )
    if costs_only_judgment:
        return None
    reasons_heading = re.search(
        r"(?im)^[^\n]{0,240}?\b(?:REASONS FOR (?:JUDGMENT|DECISION)|"
        r"STATEMENT OF DECISION AND REASONS|DECISION RECORD)\b",
        source[:9000],
    )
    primary_issue = ""
    if reasons_heading:
        primary_issue = source[reasons_heading.end():]
        background_start = re.search(
            r"(?im)^[ \t]*(?:PROCEDURAL HISTORY|FACTUAL BACKGROUND|BACKGROUND)\b",
            primary_issue,
        )
        if background_start:
            primary_issue = primary_issue[:background_start.start()]
        primary_issue = primary_issue[:2600]
    sponsorship_refusal = bool(re.search(
        r"(?is)\b(?:refus\w*|reject\w*)\b.{0,240}\bstandard\s+business\s+sponsorship\b",
        primary_issue,
    ))
    summary_for_disposition = headnote + "\n" + primary_issue
    nomination_only_headnote = bool(re.search(
        r"(?i)\b(?:application for approval of (?:the )?nomination|"
        r"review of business sponsorship rejection|nomination refusal|"
        r"standard business sponsorship)\b",
        headnote,
    ) or sponsorship_refusal)
    explicit_visa_disposition_headnote = bool(re.search(
        r"(?is)\bvisa\s+refusal\b|"
        r"\b(?:refus\w*\s+to\s+grant|not\s+to\s+grant|"
        r"decision\s+not\s+to\s+grant|decision\s+to\s+refuse\s+to\s+grant|"
        r"refusal\s+of\s+(?:the\s+)?[\w ()-]{0,180})\b.{0,280}?\bvisa\b|"
        r"\bvisa\b.{0,280}?\b(?:was\s+)?(?:refus\w*|not\s+granted|cancel\w*)\b|"
        r"\b(?:cancel\w*|refus\w*)\b.{0,280}?\bvisa\b",
        summary_for_disposition,
    ))
    sponsorship_or_nomination_issue = bool(re.search(
        r"(?i)\b(?:business\s+sponsorship|business\s+sponsor|"
        r"review of (?:the )?nomination|application for approval of (?:the )?nomination|"
        r"nomination application|approved as a standard business sponsor)\b",
        summary_for_disposition,
    ))
    if sponsorship_or_nomination_issue and not explicit_visa_disposition_headnote:
        return None
    current_citizenship_refusal = bool(re.search(
        r"(?is)\brefus\w*\s+to\s+grant\b.{0,220}\b(?:Australian\s+)?citizenship\b|"
        r"\b(?:Australian\s+)?citizenship\b.{0,180}\bapplication\s+was\s+refus\w*\b",
        source[:9000],
    ))
    if current_citizenship_refusal and not explicit_visa_disposition_headnote:
        return None
    if nomination_only_headnote and not explicit_visa_disposition_headnote:
        return None
    if reasons_heading:
        references = re.search(
            r"(?im)^[ \t]*(?:CASES CITED|SECONDARY MATERIALS|OTHER AUTHORITIES|REFERENCES)\b",
            source[reasons_heading.start():],
        )
        if references:
            source = source[:reasons_heading.start() + references.start()]

    # Some judgments state the applicants' visa in one sentence, then state
    # that their application was refused and that they sought Tribunal review
    # in the next. Require all three links, in this order and close together,
    # before treating the named visa as the current case's visa.
    application_pattern = re.compile(
        r"(?is)\b(?P<actor>(?:(?:the\s+)?applicants?|(?:the\s+)?appellants?|they))\b"
        r"\s+(?:each\s+)?(?:applied\s+for|lodged\s+(?:an?\s+)?application\s+for|"
        r"filed\s+(?:an?\s+)?application\s+for|made\s+an?\s+application\s+for)"
        r"(?P<tail>[^.!?]{0,260})"
    )
    refusal_pattern = re.compile(
        r"(?is)\b(?:their|the\s+applicants?[’']?|the\s+appellants?[’']?)\s+"
        r"applications?\s+(?:were|was)\s+refus\w*\b"
    )
    tribunal_review_pattern = re.compile(
        r"(?is)\b(?:the\s+)?(?:applicants?|appellants?|they)\b"
        r"[^.!?]{0,180}\b(?:sought|requested|applied\s+for)\s+(?:a\s+)?review\b"
        r"[^.!?]{0,100}\b(?:Refugee\s+Review\s+Tribunal|RRT|MRT|Tribunal)\b"
    )
    direct_applications: list[Evidence] = []
    for application in application_pattern.finditer(source):
        actor = application["actor"].casefold()
        if actor == "they" and not re.search(
            r"(?i)\b(?:the\s+)?(?:applicants?|appellants?)\b",
            source[max(0, application.start() - 320):application.start()],
        ):
            continue
        visa_matches = list(_VISA.finditer(application["tail"]))
        values = {
            re.sub(r"(?i)\bvisas?$", "visa", " ".join(match[0].split()))
            for match in visa_matches
        }
        if len(values) != 1 or not visa_matches:
            continue
        visa_match = visa_matches[0]
        follow = source[application.end():application.end() + 1400]
        refusal = refusal_pattern.search(follow)
        if not refusal or refusal.start() > 1000:
            continue
        intervening_visas = [
            re.sub(r"(?i)\bvisas?$", "visa", " ".join(match[0].split()))
            for match in _VISA.finditer(follow[:refusal.start()])
        ]
        if any(value not in values for value in intervening_visas):
            continue
        review = tribunal_review_pattern.search(follow, refusal.end())
        if not review or review.start() > refusal.end() + 500:
            continue
        value = next(iter(values))
        visa_start = application.start("tail") + visa_match.start()
        visa_end = application.start("tail") + visa_match.end()
        review_end = application.end() + review.end()
        direct_applications.append(Evidence(
            value=value,
            quote=source[application.start():review_end],
            start=visa_start,
            end=visa_end,
            rule="direct_applicant_application_refusal_and_tribunal_review",
        ))
    direct_values = {proof.value.casefold() for proof in direct_applications}
    if len(direct_values) == 1:
        return direct_applications[0]
    if len(direct_values) > 1:
        return None

    citation_spans = list(CITATION.finditer(source))
    sentence_break = re.compile(
        r"[.!?](?:[\"')\]]*)[ \t\r\n]+|"
        r"[ \t]*\r?\n[ \t]*(?=(?:REASONS\s+FOR\s+(?:JUDGMENT|DECISION)|"
        r"STATEMENT\s+OF\s+DECISION|DECISION\s+RECORD|CATCHWORDS|"
        r"BACKGROUND|INTRODUCTION|ORDERS?)\b)|\n[ \t]*\n+",
        re.I,
    )

    def sentence_bounds(position: int) -> tuple[int, int]:
        start = 0
        for boundary in sentence_break.finditer(source, 0, position):
            start = boundary.end()
        following = sentence_break.search(source, position)
        return start, following.start() if following else len(source)

    numbered_visas: list[tuple[re.Match[str], str]] = []
    named_nomination_visa_pattern = re.compile(
        r"(?i)\b(?:Regional\s+Employer\s+Nomination\s*\(Permanent\)|"
        r"Employer\s+Nomination\s*\(Residence\)|"
        r"Child\s*\(Migrant\)|Temporary\s+Business\s+Entry)"
        r"(?:\s*\([^\n)]{1,80}\)){0,4}\s+visa(?:s|\(s\))?\b"
    )
    named_nomination_visas = [
        match for match in named_nomination_visa_pattern.finditer(source)
        if not any(span.start() <= match.start() < span.end() for span in citation_spans)
    ]
    for match in _VISA.finditer(source):
        subclass = re.search(r"(?i)\b(?:sub[- ]?class|sublcass|class)\s+(\d{3})\b", match[0])
        section_reference = re.search(
            r"(?i)\b(?:s|section)\s*\.?\s*$",
            source[max(0, match.start() - 40):match.start()],
        )
        if (
            not subclass
            or subclass[1] == "501"
            or section_reference
            or any(span.start() <= match.start() < span.end() for span in citation_spans)
        ):
            continue
        suffix = source[match.end():match.end() + 24]
        if not re.search(r"(?i)\bvisa(?:s|\(s\))?(?=\W|$)", match[0] + suffix):
            continue
        numbered_visas.append((match, subclass[1]))
    bare_numbered_visa = re.compile(
        r"(?i)\b(?P<number>\d{3})\s*\)?\s+visa(?:s|\(s\))?(?=\W|$)"
    )
    for match in bare_numbered_visa.finditer(source):
        section_reference = re.search(
            r"(?i)\b(?:s|section)\s*\.?\s*$",
            source[max(0, match.start() - 40):match.start()],
        )
        if match["number"] == "501" or section_reference or any(
            span.start() <= match.start() < span.end() for span in citation_spans
        ):
            continue
        if any(
            code == match["number"]
            and numbered.start() <= match.start() <= numbered.end()
            for numbered, code in numbered_visas
        ):
            continue
        numbered_visas.append((match, match["number"]))
    if not numbered_visas and not named_nomination_visas:
        return None

    refusal = (
        r"(?:refus\w*|not\s+to\s+grant|to\s+not\s+grant|not\s+granted|"
        r"decision\s+not\s+to\s+grant|decision\s+to\s+refus\w*|"
        r"declin\w*\s+to\s+grant)"
    )
    visa_word = r"visa(?:s|\(s\))?(?=\W|$)"
    refusal_and_visa = re.compile(
        r"(?is)(?:\b" + refusal + r"\b.{0,600}?\b" + visa_word + r"|"
        r"\b" + visa_word + r".{0,450}?\b" + refusal + r"\b|"
        r"\bapplication for\b.{0,260}?\b" + visa_word + r".{0,450}?"
        r"\b(?:application|decision)\b.{0,180}?\b" + refusal + r"\b)"
    )
    actor_pattern = re.compile(
        r"(?i)\b(?:applicant(?:s)?|appellant(?:s)?|visa\s+applicant|"
        r"primary\s+applicant|he|she|his|her|Mr\s+[A-Z][A-Za-z'’-]+|"
        r"Ms\s+[A-Z][A-Za-z'’-]+|Mrs\s+[A-Z][A-Za-z'’-]+)\b"
    )
    title_applicant = re.split(r"\s+v(?:s)?\.?\s+", title or "", maxsplit=1, flags=re.I)[0]
    title_tokens = [
        token for token in re.findall(r"[A-Za-z][A-Za-z'’-]{2,}", title_applicant)
        if token.casefold() not in {"the", "applicant", "company", "limited", "pty"}
    ]
    sentence_ranges: list[tuple[int, int]] = []
    cursor = 0
    for boundary in sentence_break.finditer(source):
        sentence_ranges.append((cursor, boundary.start()))
        cursor = boundary.end()
    sentence_ranges.append((cursor, len(source)))
    action_spans: list[tuple[int, int]] = []
    for sentence_start, sentence_end in sentence_ranges:
        sentence = source[sentence_start:sentence_end]
        for action in refusal_and_visa.finditer(sentence):
            action_start = sentence_start + action.start()
            action_end = sentence_start + action.end()
            action_context = source[max(0, action_start - 300):action_end + 300]
            if (
                actor_pattern.search(action_context)
                or any(
                    re.search(r"(?i)\b" + re.escape(token) + r"\b", action_context)
                    for token in title_tokens
                )
            ):
                action_spans.append((action_start, action_end))
    if not action_spans:
        return None

    def is_linked_application_mention(
        visa_match: re.Match[str], code: str, action_start: int
    ) -> bool:
        visa_start, visa_end = sentence_bounds(visa_match.start())
        if visa_match.start() >= action_start or action_start - visa_match.end() > 5000:
            return False
        if re.search(
            r"(?i)\b(?:was\s+)?(?:mandatorily\s+)?cancel(?:led|ed)\b|"
            r"\b(?:expired|ceased)\b",
            source[visa_match.end():min(len(source), visa_match.end() + 120)],
        ):
            return False
        application_sentence = source[visa_start:visa_end]
        application_pattern = re.compile(
            r"(?is)\b(?:applicant(?:s)?|appellant(?:s)?|he|she|they|"
            r"the\s+first\s+applicant|the\s+second\s+applicant)\b"
            r"[^.!?]{0,240}?\b(?:applied|lodged|filed)\b[^.!?]{0,280}?"
            r"\b(?:sub[- ]?class|sublcass|class)\s+" + re.escape(code) +
            r"\b[^.!?]{0,100}?\bvisa(?:s|\(s\))?\b"
        )
        application = application_pattern.search(application_sentence)
        if not application or not (
            application.start() <= visa_match.start() - visa_start
            and visa_match.end() - visa_start <= application.end()
        ):
            return False
        if re.search(r"(?i)\b(?:previous|previously|earlier|former|historical)\b", application.group(0)):
            return False
        action_sentence_start, action_sentence_end = sentence_bounds(action_start)
        action_sentence = source[action_sentence_start:action_sentence_end]
        if not re.search(
            r"(?i)\b(?:visa\s+application|application\s+for\s+(?:the\s+)?visa|"
            r"decision\s+on\s+that\s+application)\b",
            action_sentence,
        ):
            return False
        return not any(
            other_code != code
            and visa_match.end() <= other.start() < action_start
            for other, other_code in numbered_visas
        )

    for action_start, action_end in action_spans:
        action_sentence_start, action_sentence_end = sentence_bounds(action_start)
        local_named_visas = [
            match for match in named_nomination_visas
            if action_sentence_start <= match.start() < action_sentence_end
        ]
        named_values = {
            re.sub(
                r"\)\s*(?=\()", ") ",
                re.sub(r"(?i)\bvisas?$", "visa", " ".join(match[0].split())),
            ).casefold()
            for match in local_named_visas
        }
        if len(named_values) == 1:
            visa_match = min(
                local_named_visas,
                key=lambda match: abs(match.start() - action_start),
            )
            if abs(visa_match.start() - action_start) <= 5000:
                value = re.sub(
                    r"(?i)\bvisas?$", "visa", " ".join(visa_match[0].split())
                )
                value = re.sub(r"\)\s*(?=\()", ") ", value)
                quote_start = max(0, min(visa_match.start(), action_start) - 120)
                quote_end = min(len(text), max(visa_match.end(), action_end) + 180)
                return Evidence(
                    value=value,
                    quote=text[quote_start:quote_end],
                    start=visa_match.start(),
                    end=visa_match.end(),
                    rule="direct_current_personal_visa_refusal",
                )
        local_matches = [
            (match, code) for match, code in numbered_visas
            if (
                (
                    action_sentence_start <= match.start() < action_sentence_end
                    and not re.search(
                        r"(?i)\b(?:was\s+)?(?:mandatorily\s+)?cancel(?:led|ed)\b|"
                        r"\b(?:expired|ceased)\b",
                        source[match.end():min(len(source), match.end() + 120)],
                    )
                )
                or is_linked_application_mention(match, code, action_start)
            )
        ]
        local_codes = {code for _, code in local_matches}
        if len(local_codes) == 1:
            visa_match, code = local_matches[0]
        elif len(local_codes) > 1:
            continue
        else:
            continue
        if abs(visa_match.start() - action_start) > 5000:
            continue
        quote_start = max(0, min(visa_match.start(), action_start) - 120)
        quote_end = min(len(text), max(visa_match.end(), action_end) + 180)
        proof = Evidence(
            value=f"Subclass {code} visa",
            quote=text[quote_start:quote_end],
            start=visa_match.start(),
            end=visa_match.end(),
            rule="direct_current_personal_visa_refusal",
        )
        return proof
    return None


def assess_case(text: str, *, citation: str, title: str = "", url: str = "") -> Assessment:
    """Return only source-grounded values; every held field has a reason."""
    body = document_text(text or "")
    expected = canonical_citation(citation) or citation_from_url(url)
    result = Assessment(expected, hashlib.sha256((text or "").encode("utf-8")).hexdigest(), hashlib.sha256(body.encode("utf-8")).hexdigest())
    result.reasons = {"judges": "author_not_stated", "outcome": "operative_orders_not_available", "visa_type": "current_visa_not_stated"}
    first = CITATION.search(body[:1800])
    formal_heading = re.search(
        r"\b(?:DECISION\s+AND\s+REASONS\s+FOR\s+DECISION|"
        r"STATEMENT\s+OF\s+DECISION\s+AND\s+REASONS)\b",
        body[:6000], re.I,
    )
    if formal_heading:
        # Tribunal decisions often list authorities before their own formal
        # heading. The first formal decision heading wins even when an earlier
        # catchword happens to cite the catalogue's expected number. Its first
        # citation must immediately follow the heading; otherwise we fall back
        # to the initial case caption, never to a citation inside catchwords.
        heading_text = body[formal_heading.end():formal_heading.end() + 180]
        heading_citation = CITATION.search(heading_text)
        if heading_citation and not heading_text[:heading_citation.start()].strip():
            identity_matches = bool(
                expected and canonical_citation(heading_citation[0]) == expected
            )
        else:
            identity_matches = False
    else:
        identity_matches = False

    # Initial publication citation or dual-citation case caption. This fallback
    # is allowed only before catchwords/reasons; it cannot override a conflicting
    # citation printed immediately after the formal decision heading.
    has_formal_heading_citation = bool(
        formal_heading and heading_citation and not heading_text[:heading_citation.start()].strip()
    )
    if expected and not identity_matches and not has_formal_heading_citation:
        section = re.search(
            r"^[ \t]*(?:CATCHWORDS|BETWEEN|REASONS\s+FOR\s+(?:JUDGMENT|DECISION)|STATEMENT\s+OF\s+DECISION)\b",
            body[:6000], re.I | re.M,
        )
        identity_matches = bool(
            first and (not section or first.start() < section.start())
            and canonical_citation(first[0]) == expected
        )
        if not identity_matches:
            caption = re.split(
                r"^[ \t]*(?:CATCHWORDS|BETWEEN|DECISION\s+AND\s+REASONS\s+FOR\s+DECISION|"
                r"STATEMENT\s+OF\s+DECISION|REASONS\s+FOR\s+(?:JUDGMENT|DECISION))\b",
                body,
                maxsplit=1,
                flags=re.I | re.M,
            )[0]
            for line in caption.splitlines()[:12]:
                if not re.search(r"\bv\b", line, re.I):
                    continue
                if any(canonical_citation(match[0]) == expected for match in CITATION.finditer(line)):
                    identity_matches = True
                    break

    if not expected or not identity_matches:
        result.source_status = "identity_unverified" if not first or not expected else "identity_conflict"
        result.reasons = dict.fromkeys(CORE_FIELDS, result.source_status)
        return result
    if re.search(
        r"(?:reasons?|judgment).{0,70}(?:not (?:published|available|for publication)|restricted)|"
        r"not permitted to publish|written direction.{0,180}withhold the publication of the "
        r"Tribunal(?:['’]s|s)?\s+Statement of Reasons and Decision",
        body[:4000],
        re.I | re.S,
    ):
        result.source_status = "restricted_publication"
        result.reasons = dict.fromkeys(CORE_FIELDS, result.source_status)
        return result
    head = body[:2400]
    catchwords = ""
    catchwords_match = re.search(r"\bCATCHWORDS\b", body[:10000], re.I)
    if catchwords_match:
        catchwords = body[catchwords_match.end():catchwords_match.end() + 1600]
        catchwords = re.sub(r"^[ \t\r\n]*[-–—:]+[ \t\r\n]*", "", catchwords)
        catchwords_end = re.search(
            r"^[ \t]*(?:LEGISLATION|REPRESENTATION|APPEARANCES|REVIEW APPLICANT|"
            r"VISA APPLICANT|PRESIDING MEMBER|TRIBUNAL MEMBER|TRIBUNAL:|DECISION RECORD|"
            r"STATEMENT OF DECISION|APPLICATION FOR REVIEW|REASONS FOR (?:JUDGMENT|DECISION))\b",
            catchwords,
            re.I | re.M,
        )
        if catchwords_end:
            catchwords = catchwords[:catchwords_end.start()]
    citizenship_subject_heading = _has_explicit_citizenship_subject(title, catchwords, body)
    current_visa_decision_heading = bool(
        re.search(
            r"\b(?:visa\s+(?:refusal|cancellation|decision)|"
            r"refusal\s+of\s+(?:the\s+)?visa|"
            r"cancellation\s+of\s+(?:the\s+)?visa|"
            r"review\s+of\s+(?:the\s+)?visa)\b",
            catchwords,
            re.I,
        )
    )
    deportation_order_review = bool(
        not current_visa_decision_heading
        and re.search(
            r"\bs\.?\s*200\s+of\s+the\s+Migration\s+Act\b",
            catchwords,
            re.I,
        )
        and re.search(r"\bdeportation\s+order\b", body[:6000], re.I)
        and re.search(
            r"\b(?:applied\s+to\s+(?:the\s+)?(?:Tribunal|Court)|"
            r"lodged\s+an?\s+application)\b.{0,160}?\breview\b.{0,120}?"
            r"\bthis\s+decision\b",
            body[:6000],
            re.I | re.S,
        )
        and not re.search(
            r"\b(?:visa\s+(?:refusal|cancellation|decision)|"
            r"refusal\s+of\s+(?:the\s+)?visa|"
            r"cancellation\s+of\s+(?:the\s+)?visa|"
            r"decision\s+to\s+cancel\s+(?:the\s+)?visa|"
            r"cancel(?:led|ed)\s+(?:the\s+)?visa)\b",
            catchwords + "\n" + body[:3500],
            re.I,
        )
    )
    citizenship_act_review = bool(
        re.search(r"\bAustralian Citizenship Act\s+(?:19|20)\d{2}\b", catchwords, re.I)
        and re.search(
            r"\b(?:application for judicial review|judicial review|review of|appeal from)\b",
            catchwords,
            re.I,
        )
        and re.search(r"\bs(?:ection)?\s+\d+(?:\([^)]*\))*", catchwords, re.I)
    )
    direct_citizenship_refusal = bool(re.search(
        r"(?is)\brefus\w*\s+to\s+grant\b.{0,180}\b(?:Australian\s+)?citizenship\b",
        body[:5000],
    ))
    current_citizenship_review_decision = bool(re.search(
        r"(?is)\breviewable\s+decision\b.{0,220}?\bto\s+refuse\s+to\s+grant\b"
        r".{0,140}?\b(?:Australian\s+)?citizenship\b",
        body[:2600],
    ))
    company_nomination_review = bool(
        re.search(r"\b(?:Pty\.?\s+Ltd|Proprietary Limited|P\s*/\s*L)\b", title, re.I)
        and (
            (
                re.search(r"\bNo\.?\s*3\b", title, re.I)
                and re.search(
                    r"\bseeking review of the decision\b.{0,260}?\bto refuse\b.{0,160}?"
                    r"\bapplication for approval of a nomination\b",
                    body[:5000],
                    re.I | re.S,
                )
            )
            or re.search(
                r"\bapplication for review of a decision\b.{0,300}?\b(?:reject|refuse)\b.{0,180}?"
                r"\bapplication for approval of the nomination\b",
                body[:7000],
                re.I | re.S,
            )
        )
        and not current_visa_decision_heading
    )
    opening_reasons = body[:5000]
    background_heading = re.search(r"(?i)\bBackground\b", opening_reasons)
    if background_heading:
        opening_reasons = opening_reasons[:background_heading.start()]
    current_rrt_review = bool(
        re.search(
            r"(?is)\b(?:application|appeal|proceeding)\b.{0,260}?"
            r"\b(?:judicial\s+)?review\b.{0,120}?\bdecision\b.{0,70}?"
            r"\b(?:RRT|Refugee\s+Review\s+Tribunal)\b|"
            r"\b(?:RRT|Refugee\s+Review\s+Tribunal)\b.{0,35}?\bdecision\b"
            r".{0,220}?\b(?:application|appeal|proceeding)\b",
            opening_reasons,
        )
        or re.search(
            r"(?i)\b(?:review|judicial review|appeal from)\b.{0,180}?"
            r"\b(?:decision\s+(?:of|by)|decision\s+made\s+by)\b.{0,60}?"
            r"\b(?:RRT|Refugee\s+Review\s+Tribunal)\b",
            catchwords,
        )
    )
    costs_only_discontinuance = bool(
        re.search(
            r"(?is)\bPRACTICE\s+AND\s+PROCEDURE\s*[–—-]\s*Costs\b.{0,300}?"
            r"\b(?:seeks?\s+to\s+file\s+)?notice\s+of\s+discontinuance\b",
            catchwords,
        )
        and not current_visa_decision_heading
        and not current_rrt_review
    )
    ancillary_costs_dispute = bool(
        (
            re.search(
                r"(?is)\b(?:respondent\s+)?Minister\b.{0,140}?\bseeks?\b"
                r".{0,100}?\bcosts\s+order\b.{0,140}?\bagainst\b"
                r".{0,100}?\b(?:former\s+solicitors?|former\s+lawyers?)\b",
                opening_reasons,
            )
            or costs_only_discontinuance
        )
        and not current_visa_decision_heading
        and not current_rrt_review
    )
    costs_only_migration_judgment = bool(
        re.search(r"(?i)\bMIGRATION\s*[–—-]\s*Costs judgment\b", catchwords)
        and not current_visa_decision_heading
        and not current_rrt_review
    )
    nomination_decision_only = bool(
        re.search(
            r"(?is)\b(?:decision under review|delegate|Tribunal|AAT|MRT)\b.{0,260}?"
            r"(?:\brefus\w*\s+to\s+(?:approve|grant)\s+(?:the\s+)?nomination\b|"
            r"\bdecision\s+(?:under review\s+)?to\s+(?:refuse|reject)\s+(?:the\s+)?nomination\b|"
            r"\bdecision\s+not\s+to\s+(?:approve|grant)\s+(?:the\s+)?nomination\b)",
            body[:12000],
        )
        and not current_visa_decision_heading
        and not re.search(
            r"\bvisa\s+(?:refusal|application|decision|cancellation)|"
            r"review of (?:the )?visa\b",
            catchwords,
            re.I,
        )
    )
    payment_card_network_dispute = bool(
        re.search(
            r"\bVisa International Service Association\b.{0,220}?"
            r"\bReserve Bank\s*of\s+Australia\b",
            (title or "") + "\n" + head,
            re.I | re.S,
        )
        and re.search(
            r"\b(?:credit card schemes?|credit card systems?|payment systems?|"
            r"interchange fee|no surcharge standard)\b",
            head + "\n" + catchwords,
            re.I,
        )
    )
    explicit_no_visa_applicant = bool(
        re.search(
            r"(?im)^[ \t]*VISA\s+APPLICANT(?:\s*\(\s*S\s*\))?\s*:\s*"
            r"(?:N\s*/?\s*A|NOT\s+APPLICABLE)[ \t]*$",
            body[:10000],
        )
        and re.search(r"\bStandard Business Sponsorship\b", body[:10000], re.I)
        and re.search(
            r"\b(?:ineligible for review|review application was not lodged)\b",
            body[:10000],
            re.I,
        )
    )
    if explicit_no_visa_applicant:
        result.not_applicable["visa_type"] = "sponsorship_review_has_no_personal_visa_applicant"
    elif payment_card_network_dispute or (
        re.search(r"\b(?:TRADE PRACTICES|TRADE MARKS|CONTRACT|COSTS)\b", head)
        and re.search(r"Spotwire.{0,180}Visa International", head, re.I | re.S)
    ):
        result.not_applicable["visa_type"] = "payment_card_litigation_not_immigration"
    elif (
        re.search(r"\bCOMMERCIAL\s+LAW\b", head + catchwords, re.I)
        and re.search(r"\bgeneric\s+internet\s+domain\s+name\b", head + catchwords, re.I)
        and re.search(r"\b(?:acquisition\s+and\s+sale|misappropriation)\b", head + catchwords, re.I)
    ):
        result.not_applicable["visa_type"] = "non_immigration_commercial_dispute"
    elif ancillary_costs_dispute or costs_only_migration_judgment:
        result.not_applicable["visa_type"] = "ancillary_costs_dispute_no_current_visa_review"
    elif (
        re.search(
            r"\bfor review of an unspecified\s+visa\s+cancellation\b",
            body[:7000],
            re.I,
        )
        and re.search(r"\bno relevant decision had been made\b", body[:7000], re.I)
        and re.search(
            r"\bno\s+evidence\s+before\s+the\s+Tribunal\b[\s\S]{0,500}?"
            r"\bdecision\s+to\s+cancel\s+a\s+visa\s+issued\s+to\b",
            body[:7000],
            re.I,
        )
        and re.search(
            r"\bno primary decision\s+(?:(?:had|has|was)\s+been\s+)?made\s+to\s+cancel\s+any\s+visa\b",
            body[:7000],
            re.I,
        )
    ):
        result.not_applicable["visa_type"] = "no_current_visa_decision"
    elif deportation_order_review:
        result.not_applicable["visa_type"] = "deportation_order_review_not_a_visa_decision"
    elif (
        (
            citizenship_subject_heading
            or citizenship_act_review
            or direct_citizenship_refusal
            or re.search(
                r"\bcitizenship\s+by\s+(?:descent|conferral|adoption)\b|"
                r"\bapplication\s+for\s+(?:(?:the\s+)?(?:grant|resumption|conferral)\s+of\s+)?"
                r"(?:Australian\s+)?citizenship\b|"
                r"\b(?:refusal\s+of\s+(?:Australian\s+)?citizenship\s+application|"
                r"refus\w*\b.{0,180}\b(?:the\s+)?(?:applicant['’]s|his|her|their)\s+"
                r"(?:Australian\s+)?citizenship\s+application|"
                r"decision\s+not\s+to\s+grant\s+(?:Australian\s+)?citizenship|"
                r"application\s+to\s+resume\s+(?:Australian\s+)?citizenship)\b|"
                r"\b(?:Australian\s+)?citizenship\s*[-–—:]\s*"
                r"(?:application|appeal\s+from\s+(?:the\s+)?(?:Administrative Appeals Tribunal|AAT)|"
                r"refusal|review|resumption|grant)\b",
                catchwords,
                re.I | re.S,
            )
            or re.search(
                r"^[ \t]*(?:AUSTRALIAN\s+)?CITIZENSHIP\s*[-:–—]\s*"
                r"(?:application|appeal|refusal|review|resumption|grant|by\s+(?:descent|conferral))\b",
                head,
                re.I | re.M,
            )
            or re.search(
                r"\b(?:refus\w*|decision\s+to\s+(?:refuse|cancel)|"
                r"decision\s+not\s+to\s+grant|cancellation\s+of\s+(?:the\s+)?approval)\b"
                r".{0,180}\b(?:(?:the|his|her|their|applicant['’]s)\s+)?application\s+for\s+"
                r"(?:Australian\s+)?citizenship\b",
                body[:5000],
                re.I | re.S,
            )
            or re.search(
                r"\b(?:directed|ordered|orders?)\b.{0,180}\bregister\s+(?:the\s+)?applicant\s+"
                r"as\s+an?\s+Australian\s+citizen\b",
                body[:5000],
                re.I | re.S,
            )
        )
        and (current_citizenship_review_decision or not current_visa_decision_heading)
        and (
            current_citizenship_review_decision
            or not re.search(
                r"\b(?:visa\s+(?:refusal|cancellation|decision)|"
                r"refusal\s+of\s+(?:the\s+)?visa|"
                r"cancellation\s+of\s+(?:(?:the|applicant['’]s)\s+)?visa|"
                r"decision\s+to\s+cancel\s+(?:(?:the|applicant['’]s)\s+)?visa|"
                r"visa\s+(?:was\s+)?cancelled|review\s+of\s+.{0,40}\bvisa\b)\b",
                catchwords,
                re.I,
            )
        )
    ):
        result.not_applicable["visa_type"] = "citizenship_review_not_a_visa_application"
    elif company_nomination_review or nomination_decision_only:
        result.not_applicable["visa_type"] = "sponsorship_or_nomination_not_a_personal_visa"
    elif (
        catchwords
        and re.search(
            r"\b(?:request\s+for\s+ministerial\s+intervention|"
            r"application\s+for\s+ministerial\s+intervention|"
            r"ministerial\s+intervention\s+request)\b",
            catchwords,
            re.I,
        )
        and not re.search(
            r"\b(?:visa\s+(?:refusal|cancellation|application|decision)|"
            r"refusal\s+of\s+(?:the\s+)?visa|cancellation\s+of\s+(?:the\s+)?visa|"
            r"review\s+of\s+(?:the\s+)?visa)\b",
            catchwords,
            re.I,
        )
    ):
        result.not_applicable["visa_type"] = "ministerial_intervention_not_a_visa_review"
    elif re.search(
        r"\bCATCHWORDS\b.{0,500}\b(?:application for approval of (?:the )?nomination|"
        r"approval of (?:the )?nomination|approval of nominated position|nomination refusal|"
        r"application for approval as (?:a )?(?:business )?sponsor|"
        r"decision (?:not to grant|to refuse|to approve) (?:an? )?(?:employment )?nomination)\b",
        head,
        re.I | re.S,
    ):
        result.not_applicable["visa_type"] = "sponsorship_or_nomination_not_a_personal_visa"
    elif (
        re.search(r"\bmigration\s+agents?\b", (title or "") + head + catchwords, re.I)
        and re.search(
            r"\b(?:registration|renewal|misconduct|discipline|suspension|cancellation)\b",
            head + catchwords,
            re.I,
        )
        and (
            re.search(
                r"\bmigrations?\s+agents?['’]?\s+registration\s+authority\b",
                title or "",
                re.I,
            )
            or re.search(
                r"\bmigrations?\s+agents?['’]?\s+registration\s+authority\b"
                r".{0,100}\b(?:applicant|respondent)\b",
                body[:1800],
                re.I | re.S,
            )
        )
        and not re.search(
            r"\b(?:visa\s+(?:refusal|cancellation|application|decision)|"
            r"refusal\s+of\s+(?:the\s+)?visa|"
            r"cancellation\s+of\s+(?:(?:the|applicant['’]s)\s+)?visa|"
            r"decision\s+to\s+cancel\s+(?:(?:the|applicant['’]s)\s+)?visa|"
            r"visa\s+(?:was\s+)?cancelled|review\s+of\s+.{0,40}\bvisa\b)\b",
            head + catchwords,
            re.I,
        )
    ):
        result.not_applicable["visa_type"] = "migration_agent_registration_not_a_personal_visa"
    elif (
        catchwords
        and re.search(r"\b(?:nomination|sponsor(?:ship)?)\b", catchwords, re.I)
        and not re.search(
            r"\b(?:visa\s+(?:refusal|cancellation|application|decision)|"
            r"refusal\s+of\s+(?:the\s+)?visa|cancellation\s+of\s+(?:the\s+)?visa|"
            r"review\s+of\s+(?:the\s+)?visa)\b",
            catchwords,
            re.I,
        )
    ):
        result.not_applicable["visa_type"] = "sponsorship_or_nomination_not_a_personal_visa"
    elif catchwords and not re.search(
        r"\b(?:visa\s+(?:refusal|cancellation|application|decision)|"
        r"refusal\s+of\s+(?:the\s+)?visa|cancellation\s+of\s+(?:the\s+)?visa|"
        r"review\s+of\s+(?:the\s+)?visa)\b",
        catchwords,
        re.I,
    ):
        if re.search(
            r"\b(?:fair\s+work|industrial\s+law|industrial\s+relations|"
            r"workers[’']?\s+compensation|Comcare)\b",
            catchwords,
            re.I,
        ):
            result.not_applicable["visa_type"] = "employment_case_not_a_personal_visa"
        elif re.search(
            r"\b(?:maritime\s+security\s+(?:identity|identification)\s+card|"
            r"aviation\s+security\s+identification\s+card|"
            r"application\s+for\s+an?\s+aviation\s+security\s+identification\s+card)\b",
            catchwords,
            re.I,
        ):
            result.not_applicable["visa_type"] = "security_card_case_not_a_personal_visa"
        elif re.search(r"\b(?:freedom\s+of\s+information|FOI)\b", catchwords, re.I):
            result.not_applicable["visa_type"] = "freedom_of_information_not_a_visa_decision"
        elif re.search(
            r"\bde[ -]?registration\s+of\s+(?:a\s+)?(?:corporation|company)\b",
            catchwords,
            re.I,
        ):
            result.not_applicable["visa_type"] = "corporate_deregistration_not_a_personal_visa"
    judge = _judge(body)
    outcome = _outcome(body)
    visa_not_applicable = result.not_applicable.get("visa_type")
    if visa_not_applicable == "sponsorship_or_nomination_not_a_personal_visa":
        corporate_title = bool(re.search(
            r"\b(?:Pty\.?\s+Ltd|Proprietary Limited|P\s*/\s*L|Limited)\b",
            title or "",
            re.I,
        ))
        candidate_visa = (
            None
            if corporate_title or company_nomination_review
            else _direct_personal_nomination_visa(body, title)
        )
        if candidate_visa and candidate_visa.rule in {
            "direct_current_personal_visa_refusal",
        }:
            subclass = re.search(
                r"(?i)\b(?:sub[- ]?class|class)\s+(\d{3})\b",
                candidate_visa.value,
            )
            if subclass:
                candidate_visa = _evidence(
                    body,
                    candidate_visa.start,
                    candidate_visa.end,
                    f"Subclass {subclass[1]} visa",
                    candidate_visa.rule,
                )
            elif re.fullmatch(r"(?i)sub[- ]?class\s+\d{3}", candidate_visa.value.strip()):
                candidate_visa = _evidence(
                    body,
                    candidate_visa.start,
                    candidate_visa.end,
                    candidate_visa.value.strip() + " visa",
                    candidate_visa.rule,
                )
            result.not_applicable.pop("visa_type", None)
            result.candidates.append({
                "value": candidate_visa.value,
                "quote": candidate_visa.quote,
                "qualified": True,
                "rank": 4,
            })
            visa = candidate_visa
        else:
            visa = None
    else:
        visa = None if visa_not_applicable else _visa(body, result)
        if visa is None and not visa_not_applicable:
            visa = _direct_personal_nomination_visa(body, title)
            if visa:
                result.candidates.append({
                    "value": visa.value,
                    "quote": visa.quote,
                    "qualified": True,
                    "rank": 4,
                })
    for name, proof in [("judges", judge), ("outcome", outcome), ("visa_type", visa)]:
        if proof:
            result.values[name] = proof
            result.reasons.pop(name, None)
    if len(body) < 350 and not result.values:
        result.source_status = "incomplete_publication"
        result.reasons = dict.fromkeys(CORE_FIELDS, "incomplete_publication")
    return result


def verified_metadata(text: str, legacy: dict[str, Any], *, citation: str, title: str, url: str) -> dict[str, Any]:
    """Keep legacy ancillary fields; replace unsafe core first-match results."""
    result = {k: v for k, v in legacy.items() if k not in CORE_FIELDS}
    decision = assess_case(text, citation=citation, title=title, url=url)
    result.update({name: proof.value for name, proof in decision.values.items()})
    return result
