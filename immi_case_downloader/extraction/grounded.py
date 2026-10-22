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

RULE_VERSION = "grounded-local-20261022-v9"
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
        r"BEFORE|CORAM|JUSTICE|TRIBUNAL)\s*:[ \t]*([^\n]*)"
        r"(?:\n(?![ \t]*(?:PRESIDING MEMBER|CONSTITUTED MEMBER|TRIBUNAL MEMBERS?|"
        r"JUDGMENT OF|JUDGES?|BEFORE|CORAM|JUSTICE|TRIBUNAL)\s*:)([^\n]+))?",
        re.I | re.M,
    )
    preamble = re.split(
        r"^[ \t]*(?:REASONS FOR (?:JUDGMENT|DECISION)|"
        r"STATEMENT OF DECISION(?!\s+AND\s+REASONS))\b",
        text,
        maxsplit=1,
        flags=re.I | re.M,
    )[0][:10000]
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
    preamble = re.split(
        r"^[ \t]*(?:REASONS FOR (?:JUDGMENT|DECISION)|"
        r"STATEMENT OF DECISION(?!\s+AND\s+REASONS))\b",
        text,
        maxsplit=1,
        flags=re.I | re.M,
    )[0][:12000]
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
    if re.search(r"(?:reasons?|judgment).{0,70}(?:not (?:published|available|for publication)|restricted)|not permitted to publish", body[:4000], re.I):
        result.source_status = "restricted_publication"
        result.reasons = dict.fromkeys(CORE_FIELDS, result.source_status)
        return result
    head = body[:2400]
    catchwords = ""
    catchwords_match = re.search(r"\bCATCHWORDS\b", body[:10000], re.I)
    if catchwords_match:
        catchwords = body[catchwords_match.end():catchwords_match.end() + 1600]
        catchwords_end = re.search(
            r"^[ \t]*(?:LEGISLATION|REPRESENTATION|APPEARANCES|REVIEW APPLICANT|"
            r"VISA APPLICANT|PRESIDING MEMBER|TRIBUNAL MEMBER|TRIBUNAL:|DECISION RECORD|"
            r"STATEMENT OF DECISION|APPLICATION FOR REVIEW)\b",
            catchwords,
            re.I | re.M,
        )
        if catchwords_end:
            catchwords = catchwords[:catchwords_end.start()]
    if re.search(r"\b(?:TRADE PRACTICES|TRADE MARKS|CONTRACT|COSTS)\b", head) and re.search(r"Spotwire.{0,180}Visa International", head, re.I | re.S):
        result.not_applicable["visa_type"] = "payment_card_litigation_not_immigration"
    elif re.search(r"(?:Application for (?:resumption|the grant) of Australian citizenship|Application for resumption of citizenship|citizenship by conferral)", head, re.I):
        result.not_applicable["visa_type"] = "citizenship_review_not_a_visa_application"
    elif re.search(r"\bCATCHWORDS\s*(?:[-:–—]\s*)?(?:AUSTRALIAN\s+)?CITIZENSHIP\b", head, re.I):
        result.not_applicable["visa_type"] = "citizenship_review_not_a_visa_application"
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
