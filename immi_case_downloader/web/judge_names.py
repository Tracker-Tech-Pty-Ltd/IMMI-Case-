"""Judge name resolution: normalisation, aliasing, bios and identity.

Extracted from web/routes/api.py — this is the name-resolution domain only.
Analytics aggregation over judges (e.g. _judge_profile_payload) stays in
api.py because it depends on the outcome/concept helpers there.
"""

import json
import logging
import os
import re
from functools import lru_cache
from pathlib import Path

from ..models import ImmigrationCase
from .helpers import get_output_dir
from .routes.api_constants import COURT_CODES, TRIBUNAL_CODES

logger = logging.getLogger(__name__)



_JUDGE_BLOCKLIST = frozenset(
    {
        # Common noise words from HTML/text parsing artefacts
        "date", "the", "and", "or", "of", "in", "for", "at", "by",
        # Legal roles/titles (single-word entries that aren't names)
        "court", "tribunal", "member", "judge", "justice", "honour",
        "federal", "migration", "review", "applicant", "respondent",
        "minister", "decision", "department", "government", "australia",
        "registry", "registrar", "president", "deputy", "senior",
        "appellant", "appeal", "application", "matter",
    }
)


_JUDGE_TITLE_RE = re.compile(
    r"^(?:The\s+Hon(?:ourable)?\.?\s+|Hon(?:ourable)?\.?\s+|"
    r"Chief\s+Justice\s+|Justice\s+|Senior\s+Member\s+|"
    r"Deputy\s+President\s+|Deputy\s+Member\s+|Deputy\s+|"
    r"Principal\s+Member\s+|Member\s+|Magistrate\s+|"
    r"Judge\s+|"
    r"President\s+|Registrar\s+|"
    r"Mr\.?\s+|Mrs\.?\s+|Ms\.?\s+|Miss\s+|Dr\.?\s+|Prof\.?\s+)",
    re.IGNORECASE,
)


_JUDGE_SUFFIX_RE = re.compile(
    r"\s+(?:J|CJ|ACJ|FM|AM|DCJ|JA|RFM|SM|DP|P|SC|KC|QC|AO|AC|OAM|PSM)\b\.?$",
    re.IGNORECASE,
)


_NAME_DISQUALIFIERS = frozenset({
    "the", "of", "in", "for", "at", "on", "by", "to", "with", "and", "or",
    "a", "an", "this", "that", "was", "were", "which", "where", "when",
    "tribunal", "court", "department", "minister", "registry", "review",
    "applicant", "respondent", "appellant", "migration", "australia",
    "held", "error", "errors", "finding", "findings", "reason", "reasons",
    "dismissed", "dismiss", "allowed", "allow", "granted", "grant",
    "refused", "refuse", "rejected", "reject", "affirmed", "affirm",
    "remitted", "remit", "quashed", "quash", "set", "aside", "decision",
    "order", "orders", "hearing", "judgment", "judgement", "appeal",
    "application", "visa",
})


def _is_real_judge_name(name: str) -> bool:
    """Return True only if name looks like an actual person's name."""
    words = name.split()
    # Allow longer forms for full names with titles/nicknames/post-nominals.
    if not words or len(words) > 8:
        return False
    if any(not re.fullmatch(r"[A-Za-z][A-Za-z'.-]*\.?", w) for w in words):
        return False

    lowered_words = [w.lower().strip(".") for w in words]
    if any(w in _NAME_DISQUALIFIERS for w in lowered_words):
        return False
    if all(w in _NAME_DISQUALIFIERS for w in lowered_words):
        return False

    # Single-token entries are usually surnames; reject overly short fragments.
    if len(words) == 1 and len(words[0].strip(".")) < 3:
        return False

    # Must contain at least one non-initial token.
    if not any(len(w.strip(".")) > 1 for w in words):
        return False

    # All words must not be disqualifiers
    # Must contain at least one word that starts with a capital letter.
    if not any(w[0].isupper() for w in words if w):
        return False
    return True


def _normalise_judge_name(raw: str) -> str:
    """Strip titles/suffixes and title-case; return clean display name."""
    name = raw.strip()
    # Strip leading titles (loop: "The Honourable Justice" needs 3 passes)
    for _ in range(4):
        m = _JUDGE_TITLE_RE.match(name)
        if m:
            name = name[m.end():].strip()
        else:
            break
    # Strip trailing legal abbreviations (J, CJ, FM, etc.)
    m = _JUDGE_SUFFIX_RE.search(name)
    if m:
        name = name[:m.start()].strip()
    # Remove bracket artifacts and non-name punctuation from noisy OCR/text extractions.
    name = re.sub(r"[\(\)\[\]\{\}]", " ", name)
    # Remove quoted nicknames: "'Sandy'" -> "Sandy"
    name = re.sub(r"(?<![A-Za-z])[‘’']([A-Za-z]+)[‘’'](?![A-Za-z])", r"\1", name)
    name = re.sub(r"[^A-Za-z'.\-\s]", " ", name)
    # Normalise whitespace
    name = re.sub(r"\s+", " ", name).strip()
    if not name:
        return ""
    # Title-case with Mac/Mc/O' special handling
    name = name.title()
    name = re.sub(r"\bMac([a-z])", lambda x: "Mac" + x.group(1).upper(), name)
    name = re.sub(r"\bMc([a-z])", lambda x: "Mc" + x.group(1).upper(), name)
    name = re.sub(r"\bO'([a-z])", lambda x: "O'" + x.group(1).upper(), name)
    return name


@lru_cache(maxsize=8)
def _load_judge_bios_for(output_dir: str) -> dict[str, dict]:
    """Load the judge biography map for *output_dir*, once per directory.

    Keyed on the directory so two apps in one process (tests, multi-tenant dev)
    never serve each other's bios.
    """
    bio_path = os.path.join(output_dir, "judge_bios.json")
    if not os.path.exists(bio_path):
        return {}
    try:
        with open(bio_path, encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        logger.warning("Failed to load judge_bios.json", exc_info=True)
        return {}

    if not isinstance(payload, dict):
        return {}

    bios: dict[str, dict] = {}
    for key, value in payload.items():
        if isinstance(key, str) and isinstance(value, dict):
            cleaned = key.strip().lower()
            if cleaned:
                bios[cleaned] = value
    return bios


def _load_judge_bios() -> dict[str, dict]:
    """Judge biography map for the current app's output dir."""
    return _load_judge_bios_for(get_output_dir())


@lru_cache(maxsize=8)
def _load_judge_name_overrides_for(output_dir: str) -> dict[str, str]:
    """Load alias -> full-name overrides from output dir, fallback to packaged defaults."""
    package_default = (
        Path(__file__).resolve().parents[1] / "data" / "judge_name_overrides.json"
    )
    candidate_paths = [
        Path(output_dir) / "judge_name_overrides.json",
        package_default,
    ]
    overrides: dict[str, str] = {}

    for path in candidate_paths:
        if not path.exists():
            continue
        try:
            with open(path, encoding="utf-8") as f:
                payload = json.load(f)
        except Exception:
            logger.warning("Failed to load %s", path, exc_info=True)
            continue

        if isinstance(payload, dict) and isinstance(payload.get("overrides"), dict):
            raw_map = payload["overrides"]
        elif isinstance(payload, dict):
            raw_map = payload
        else:
            continue

        for alias, value in raw_map.items():
            if not isinstance(alias, str) or not isinstance(value, str):
                continue
            alias_key = alias.strip().lower()
            full_name = re.sub(r"\s+", " ", value).strip()
            if not alias_key or not full_name:
                continue
            # First source wins (output-dir file takes precedence over packaged fallback).
            overrides.setdefault(alias_key, full_name)

    return overrides


def _load_judge_name_overrides() -> dict[str, str]:
    """Alias -> full-name overrides for the current app's output dir."""
    return _load_judge_name_overrides_for(get_output_dir())


def _judge_query_aliases(raw: str) -> set[str]:
    """Build robust match aliases (full name, normalized name, surname, initials)."""
    aliases: set[str] = set()
    raw_name = (raw or "").strip()
    if not raw_name:
        return aliases

    normalized = _normalise_judge_name(raw_name)
    for candidate in (raw_name, normalized):
        c = candidate.strip().lower()
        if c:
            aliases.add(c)

    tokens = [t.strip(".") for t in normalized.split() if t.strip(".")]
    if tokens:
        surname = tokens[-1].lower()
        aliases.add(surname)
        if len(tokens) >= 2:
            first_initial = tokens[0][0].lower()
            aliases.add(f"{first_initial} {surname}")
            aliases.add(f"{first_initial}. {surname}")

    return aliases


def _normalise_court_code(court_code: str | None) -> str:
    return (court_code or "").strip().upper()


def _normalise_year_value(year: int | str | None) -> int:
    try:
        value = int(str(year).strip())
    except (TypeError, ValueError):
        return 0
    return value if 1800 <= value <= 2200 else 0


def _resolve_contextual_judge_name(
    raw_clean: str,
    normalized: str,
    court_code: str,
    year: int,
) -> str:
    """Resolve ambiguous surname-only aliases using court/year context."""
    court = _normalise_court_code(court_code)
    norm_tokens = [t.lower() for t in re.findall(r"[A-Za-z]+", normalized)]
    raw_tokens = [t.lower() for t in re.findall(r"[A-Za-z]+", raw_clean)]
    if not norm_tokens:
        return ""

    surname = norm_tokens[-1]
    first_token = norm_tokens[0] if len(norm_tokens) > 1 else ""
    raw_first = raw_tokens[0] if raw_tokens else ""

    if "graham" in norm_tokens and "friedman" in norm_tokens:
        return "Graham Friedman"

    if surname == "graham":
        if court in COURT_CODES:
            return "Peter Ross Graham KC"
        if "ann" in norm_tokens:
            return "Ann Graham"
        if court == "MRTA" and len(norm_tokens) == 1:
            if year and year <= 2001:
                return "Graham Friedman"
            if year >= 2002:
                return "Ann Graham"

    if surname == "murphy":
        if court in COURT_CODES:
            return "Bernard Michael Murphy"
        if "alison" in norm_tokens or first_token == "a" or raw_first == "a":
            return "Member Alison Murphy"
        if "jade" in norm_tokens or first_token == "j" or raw_first == "j":
            return "Member Jade Murphy"
        if "peter" in norm_tokens or first_token == "p" or raw_first == "p":
            return "Member Peter Murphy"

    if surname == "downes":
        if "tegen" in norm_tokens or first_token == "t" or raw_first == "t":
            return "Tegen Downes"
        if court in COURT_CODES:
            if year and year >= 2021:
                return "Kylie Elizabeth Downes"
            if year and year <= 2012:
                return "Garry Keith Downes AM KC"
        if court in TRIBUNAL_CODES:
            if year and year >= 2022:
                return "Tegen Downes"
            if year and year <= 2012:
                return "Garry Keith Downes AM KC"

    return ""


def _resolve_judge_display_name(
    raw: str,
    court_code: str = "",
    year: int | str | None = None,
) -> str:
    """Prefer full name from bios when available, fallback to normalized short name."""
    raw_clean = re.sub(r"\s+", " ", (raw or "").strip())
    normalized = _normalise_judge_name(raw_clean)
    year_value = _normalise_year_value(year)
    if raw_clean:
        # Preserve user-visible labels (e.g. "Member Alpha"), but beautify all-lowercase input.
        fallback = raw_clean.title() if raw_clean.islower() else raw_clean
    else:
        fallback = normalized or ""
    aliases = _judge_query_aliases(raw)
    # Check most-specific aliases first (longer = more specific) to avoid
    # singleton surname matches overriding correct initial+surname matches.
    aliases_by_specificity = sorted(aliases, key=len, reverse=True)
    bios = _load_judge_bios()
    for alias in aliases_by_specificity:
        bio = bios.get(alias)
        if not bio:
            continue
        full_name = str(bio.get("full_name", "")).strip()
        if full_name:
            return full_name

    overrides = _load_judge_name_overrides()
    for alias in aliases_by_specificity:
        full_name = overrides.get(alias, "").strip()
        if full_name:
            return full_name

    contextual = _resolve_contextual_judge_name(
        raw_clean=raw_clean,
        normalized=normalized,
        court_code=court_code,
        year=year_value,
    )
    if contextual:
        return contextual

    return fallback


def _known_singleton_judge_names() -> set[str]:
    """Known one-word judge aliases from bios (e.g. street, driver)."""
    bios = _load_judge_bios()
    overrides = _load_judge_name_overrides()
    known = {k for k in bios.keys() if k.isalpha() and " " not in k}
    known.update(k for k in overrides.keys() if k.isalpha() and " " not in k)
    return known


@lru_cache(maxsize=32768)
def _judge_identity(
    raw: str,
    court_code: str = "",
    year: int | str | None = None,
) -> tuple[str, str]:
    """Return (canonical_name, display_name) for a judge alias."""
    raw_clean = re.sub(r"\s+", " ", (raw or "").strip())
    if not raw_clean:
        return "", ""
    display_name = _resolve_judge_display_name(raw_clean, court_code, year)
    canonical_name = display_name or raw_clean
    return canonical_name, display_name or raw_clean


def _collect_cases_for_judge(
    cases: list[ImmigrationCase],
    query_name: str,
) -> tuple[list[ImmigrationCase], str, str]:
    """Collect cases for a judge using strict canonical matching first, then loose alias fallback."""
    canonical_name, display_name = _judge_identity(query_name)
    canonical_name = canonical_name or (_normalise_judge_name(query_name) or query_name)
    display_name = display_name or canonical_name
    canonical_key = canonical_name.lower()

    strict_matches: list[ImmigrationCase] = []
    for case in cases:
        judge_names = _split_judges(case.judges)
        if any(
            _judge_identity(raw_name, case.court_code, case.year)[0].lower() == canonical_key
            for raw_name in judge_names
        ):
            strict_matches.append(case)

    if strict_matches:
        return strict_matches, canonical_name, display_name

    # Backward-compatible fallback for unknown aliases.
    match_names = _judge_query_aliases(query_name)
    loose_matches = [
        c
        for c in cases
        if any(match_names & _judge_query_aliases(j) for j in _split_judges(c.judges))
    ]
    return loose_matches, canonical_name, display_name


def _split_judges(raw: str) -> list[str]:
    """Split raw judges string into clean, normalised display names.

    Strips titles (Justice/Member/Mr/Ms), trailing abbreviations (J/CJ/FM),
    applies is_real_name filtering to remove parsing noise, and deduplicates.
    """
    if not raw:
        return []
    names: list[str] = []
    seen: set[str] = set()
    known_singletons = _known_singleton_judge_names()
    for piece in re.split(r"[;,]", raw):
        raw_piece = piece.strip()
        if not raw_piece:
            continue

        had_title_or_suffix = bool(
            _JUDGE_TITLE_RE.search(raw_piece)
            or _JUDGE_SUFFIX_RE.search(raw_piece)
            or re.search(r"\b(?:J|CJ|ACJ|FM|AM|DCJ|JA|RFM|SM|DP|P)\b", raw_piece, re.IGNORECASE)
        )

        name = _normalise_judge_name(raw_piece)
        lowered = name.lower()
        is_singleton = len(name.split()) == 1
        if (
            not name
            or len(name) < 2
            or lowered in _JUDGE_BLOCKLIST
            or name.replace(" ", "").isdigit()
            or lowered in seen
            or not _is_real_judge_name(name)
            or (
                is_singleton
                and lowered not in known_singletons
                and not had_title_or_suffix
                and len(lowered) < 4
            )
        ):
            continue
        seen.add(lowered)
        names.append(name)
    return names
