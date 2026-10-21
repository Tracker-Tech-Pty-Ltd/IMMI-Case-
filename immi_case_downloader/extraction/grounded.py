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

RULE_VERSION = "grounded-local-20261021-v3"
CORE_FIELDS = ("judges", "outcome", "visa_type")
CITATION = re.compile(r"\[(\d{4})\]\s*(AATA|ARTA|FCAFC|FCA|FCCA|FMCA|HCA|FedCFamC2G|RRTA|MRTA)\s+(\d+)(?!\d)")
_LABEL_END = re.compile(
    r"\b(?:MRT|RRT|DIMA|DIBP|DEPT|FILE|CASE|DATE|PLACE|HEARING|DELIVERED|"
    r"REPRESENTATION|REASONS|CATCHWORDS|DECISION|APPLICANT|RESPONDENT)\b\s*:?", re.I
)
_VISA = re.compile(
    r"(?:[Ss]ub[- ]?class|Sublcass)\s+\d{3}(?:\s*\([^\n.;]{1,75}?\))?(?:\s+visa[s]?)?"
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
    labels = re.compile(
        r"^(?:PRESIDING MEMBER|CONSTITUTED MEMBER|TRIBUNAL MEMBERS?|JUDGMENT OF|JUDGES?|"
        r"BEFORE|CORAM|JUSTICE|TRIBUNAL)\s*:[ \t]*([^\n]*)(?:\n([^\n]+))?", re.I | re.M
    )
    preamble = re.split(r"\bREASONS FOR (?:JUDGMENT|DECISION)\b|\bSTATEMENT OF DECISION", text, maxsplit=1, flags=re.I)[0][:10000]
    for match in labels.finditer(preamble):
        value = match[1].strip() or (match[2] or "").strip()
        value = _LABEL_END.split(value, maxsplit=1)[0].strip(" :;\t")
        if not value or len(value) > 100 or not re.search(r"[A-Za-z]{2}", value):
            continue
        if re.search(r"\b(?:tribunal|court|applicant|respondent|decision|hearing|date|not|above|none|unknown)\b", value, re.I):
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
    certified = re.search(
        r"^I certify that[^\n]{0,180}(?:\n[^\n]{0,180}){0,2}?"
        r"(?:reasons for (?:judgment|decision)|Reasons for Judgment)[^\n]{0,75}?\bof\s+"
        r"(?:the Honourable (?:Justice|Judge)\s+)?([A-Z][A-Za-z’' .-]{1,65}?(?:\s+(?:FM|J|JJ)))\.?\s*(?:\n|$)",
        text[-3500:], re.M | re.I,
    )
    if certified:
        value = certified[1].strip()
        pos = text.rfind(value)
        return _evidence(text, pos, pos + len(value), value, "own_judgment_certification")
    return None


def _outcome(text: str) -> Evidence | None:
    # Only the publication's own operative table, before its reasons. Never
    # return a date, catchword, proposed order, or an isolated evidence finding.
    preamble = re.split(r"\bREASONS FOR (?:JUDGMENT|DECISION)\b|\bSTATEMENT OF DECISION", text, maxsplit=1, flags=re.I)[0][:12000]
    for match in re.finditer(r"^(?:THE COURT ORDERS(?: THAT)?|ORDERS?|DECISION)(?:[ \t]*:[ \t]*|[ \t]*\n)", preamble, re.I | re.M):
        remainder = preamble[match.end():]
        stop = re.search(
            r"^(?:CATCHWORDS|LEGISLATION|REPRESENTATION|BETWEEN|REASONS|NOTE:|FEDERAL (?:COURT|MAGISTRATES)|"
            r"DATE|TRIBUNAL|PLACE|SIGNATURE|(?:APPLICANT|RESPONDENT)\s*:|STATEMENT OF|REASONS FOR)\b", remainder, re.I | re.M
        )
        block = remainder[:stop.start() if stop else len(remainder)].strip()
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
    return None


def _visa(text: str, assessment: Assessment) -> Evidence | None:
    # Paragraphs containing current-review language outrank an old application.
    # Boilerplate, other people's visas, and a bare program name never qualify.
    results: list[tuple[int, Evidence]] = []
    for match in _VISA.finditer(text):
        line_start = text.rfind("\n", 0, match.start()) + 1
        sentence_end = text.rfind(". ", line_start, match.start())
        sentence_start = sentence_end + 2 if sentence_end >= 0 else line_start
        line_end = text.find("\n", match.end())
        line_end = len(text) if line_end < 0 else line_end
        before = text[max(sentence_start, match.start() - 240):match.start()]
        context = text[max(0, line_start - 140):min(len(text), line_end + 180)]
        value = match[0].strip()
        if value.lower().startswith("sublcass"):
            value = re.sub(r"^Sublcass\s+", "", value, flags=re.I)
        rank = 0
        if re.search(r"\b(?:decision (?:under review|to refuse|not to grant)|review of (?:the )?(?:refusal|visa refusal)|refus(?:e|ed|ing)\b.{0,140})", before, re.I):
            rank = 3
        if match.start() < 3000 and re.search(r"CATCHWORDS[^\n]*(?:visa refusal|visa cancellation|refusal of|cancellation of)", before, re.I):
            rank = 3
        if re.search(r"\b(?:section|subregulation|regulation|subclause|example|for instance|another case|not relevant|applicant submits|applicant claims)\b", before, re.I):
            rank = 0
        if re.search(r"\b(?:may|might|could|should|entitled to)\s+(?:apply|be granted|refuse)|application for (?:a |an )?visa.{0,80}\bmeans\b|which provides|provides that|have failed|did not appeal", context, re.I):
            rank = 0
        quote = _evidence(text, match.start(), match.end(), value, "direct_current_visa_statement")
        assessment.candidates.append({"value": value, "quote": quote.quote, "qualified": bool(rank), "rank": rank})
        if rank:
            results.append((rank, quote))
    if not results:
        return None
    best = max(rank for rank, _ in results)
    winners = {re.sub(r"\s+", " ", e.value).casefold(): e for rank, e in results if rank == best}
    # A subclass and its spelled-out family can both be true, but without a
    # proven binding that is a review item, not permission to pick the first.
    if len(winners) == 1:
        return next(iter(winners.values()))
    assessment.reasons["visa_type"] = "conflicting_current_visa_candidates"
    return None


def assess_case(text: str, *, citation: str, title: str = "", url: str = "") -> Assessment:
    """Return only source-grounded values; every held field has a reason."""
    body = document_text(text or "")
    expected = canonical_citation(citation) or citation_from_url(url)
    result = Assessment(expected, hashlib.sha256((text or "").encode("utf-8")).hexdigest(), hashlib.sha256(body.encode("utf-8")).hexdigest())
    result.reasons = {"judges": "author_not_stated", "outcome": "operative_orders_not_available", "visa_type": "current_visa_not_stated"}
    first = CITATION.search(body[:1800])
    if not expected or not first or canonical_citation(first[0]) != expected:
        result.source_status = "identity_unverified" if not first or not expected else "identity_conflict"
        result.reasons = dict.fromkeys(CORE_FIELDS, result.source_status)
        return result
    if re.search(r"(?:reasons?|judgment).{0,70}(?:not (?:published|available|for publication)|restricted)|not permitted to publish", body[:4000], re.I):
        result.source_status = "restricted_publication"
        result.reasons = dict.fromkeys(CORE_FIELDS, result.source_status)
        return result
    head = body[:2400]
    if re.search(r"\b(?:TRADE PRACTICES|TRADE MARKS|CONTRACT|COSTS)\b", head) and re.search(r"Spotwire.{0,180}Visa International", head, re.I | re.S):
        result.not_applicable["visa_type"] = "payment_card_litigation_not_immigration"
    elif re.search(r"(?:Application for (?:resumption|the grant) of Australian citizenship|Application for resumption of citizenship|citizenship by conferral)", head, re.I):
        result.not_applicable["visa_type"] = "citizenship_review_not_a_visa_application"
    judge = _judge(body)
    outcome = _outcome(body)
    visa = None if "visa_type" in result.not_applicable else _visa(body, result)
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
