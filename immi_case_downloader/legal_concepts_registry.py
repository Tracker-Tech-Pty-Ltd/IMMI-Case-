"""Legal Concepts Registry.

Canonical list of 34 legal concept categories commonly found in Australian
immigration case law. Used for search taxonomy, filtering, and browsing.
Concepts are normalized to title case format for consistency.
"""

from typing import Any

# ── Legal Concept Categories ──────────────────────────────────────────────

LEGAL_CONCEPTS = [
    {
        "id": "procedural-fairness",
        "name": "Procedural Fairness",
        "description": "Natural justice, right to be heard, bias",
        "keywords": ["natural justice", "procedural fairness", "bias", "hearing", "opportunity to respond"],
    },
    {
        "id": "jurisdictional-error",
        "name": "Jurisdictional Error",
        "description": "Errors going to jurisdiction, reviewable errors",
        "keywords": ["jurisdictional error", "legal error", "reviewable error", "jurisdiction"],
    },
    {
        "id": "character-test",
        "name": "Character Test",
        "description": "Section 501 character cancellation and refusal",
        "keywords": ["character", "section 501", "s 501", "substantial criminal record", "character test"],
    },
    {
        "id": "well-founded-fear",
        "name": "Well-Founded Fear",
        "description": "Refugee Convention, well-founded fear of persecution",
        "keywords": ["well-founded fear", "persecution", "refugee convention", "serious harm"],
    },
    {
        "id": "complementary-protection",
        "name": "Complementary Protection",
        "description": "Protection obligations under international law",
        "keywords": ["complementary protection", "non-refoulement", "significant harm", "real risk"],
    },
    {
        "id": "credibility",
        "name": "Credibility",
        "description": "Credibility findings, demeanor, consistency",
        "keywords": ["credibility", "demeanor", "inconsistencies", "truthfulness", "believability"],
    },
    {
        "id": "country-information",
        "name": "Country Information",
        "description": "Independent country information, DFAT reports",
        "keywords": ["country information", "dfat", "independent evidence", "country conditions"],
    },
    {
        "id": "sur-place-claims",
        "name": "Sur Place Claims",
        "description": "Claims arising after departure from home country",
        "keywords": ["sur place", "activities in australia", "post-departure conduct"],
    },
    {
        "id": "membership-particular-social-group",
        "name": "Membership of Particular Social Group",
        "description": "PSG under Refugee Convention",
        "keywords": ["particular social group", "psg", "social perception", "family", "gender"],
    },
    {
        "id": "political-opinion",
        "name": "Political Opinion",
        "description": "Persecution for political opinion or imputed political opinion",
        "keywords": ["political opinion", "imputed political opinion", "political activity"],
    },
    {
        "id": "relocation",
        "name": "Relocation",
        "description": "Internal relocation, reasonableness of relocation",
        "keywords": ["relocation", "internal flight", "internal protection", "reasonableness"],
    },
    {
        "id": "state-protection",
        "name": "State Protection",
        "description": "Availability and effectiveness of state protection",
        "keywords": ["state protection", "police protection", "effective protection"],
    },
    {
        "id": "genuine-relationship",
        "name": "Genuine Relationship",
        "description": "Partner visa relationship genuineness",
        "keywords": ["genuine", "relationship", "spouse", "de facto", "commitment"],
    },
    {
        "id": "visa-cancellation",
        "name": "Visa Cancellation",
        "description": "Visa cancellation grounds and procedures",
        "keywords": ["cancellation", "cancel", "revocation", "section 116", "section 501"],
    },
    {
        "id": "ministerial-intervention",
        "name": "Ministerial Intervention",
        "description": "Section 48B, 351, 417 ministerial powers",
        "keywords": ["ministerial intervention", "section 417", "section 351", "public interest"],
    },
    {
        "id": "genuine-temporary-entrant",
        "name": "Genuine Temporary Entrant",
        "description": "GTE requirement for temporary visas",
        "keywords": ["gte", "genuine temporary entrant", "temporary stay", "intention"],
    },
    {
        "id": "health-requirement",
        "name": "Health Requirement",
        "description": "Health criteria, significant cost, public health",
        "keywords": ["health", "medical examination", "significant cost", "health waiver"],
    },
    {
        "id": "english-language",
        "name": "English Language",
        "description": "English language requirements and exemptions",
        "keywords": ["english", "language", "ielts", "competent english", "proficient english"],
    },
    {
        "id": "skills-assessment",
        "name": "Skills Assessment",
        "description": "Skills assessment for skilled visas",
        "keywords": ["skills assessment", "assessing authority", "qualified", "occupation"],
    },
    {
        "id": "sponsorship",
        "name": "Sponsorship",
        "description": "Employer or family sponsorship requirements",
        "keywords": ["sponsor", "sponsorship", "approved sponsor", "nomination"],
    },
    {
        "id": "points-test",
        "name": "Points Test",
        "description": "Points-based assessment for skilled visas",
        "keywords": ["points", "points test", "skilled select", "expression of interest"],
    },
    {
        "id": "condition-breach",
        "name": "Condition Breach",
        "description": "Visa condition breaches and consequences",
        "keywords": ["condition", "breach", "work restriction", "study requirement"],
    },
    {
        "id": "overstay",
        "name": "Overstay",
        "description": "Overstaying visa, unlawful presence",
        "keywords": ["overstay", "unlawful", "schedule 3", "time limit"],
    },
    {
        "id": "schedule-3-criteria",
        "name": "Schedule 3 Criteria",
        "description": "Schedule 3 public interest criteria 3001-3004",
        "keywords": ["schedule 3", "3001", "3003", "3004", "public interest criteria"],
    },
    {
        "id": "family-violence",
        "name": "Family Violence",
        "description": "Family violence provisions for partner visas",
        "keywords": ["family violence", "domestic violence", "relationship breakdown"],
    },
    {
        "id": "best-interests-child",
        "name": "Best Interests of the Child",
        "description": "Section 501 consideration of children's interests",
        "keywords": ["best interests", "children", "child welfare", "section 501"],
    },
    {
        "id": "unreasonableness",
        "name": "Unreasonableness",
        "description": "Wednesbury unreasonableness, irrational decision",
        "keywords": ["unreasonable", "wednesbury", "irrational", "illogical"],
    },
    {
        "id": "failure-consider-material",
        "name": "Failure to Consider Material",
        "description": "Failure to consider relevant material or submissions",
        "keywords": ["failure to consider", "relevant material", "ignored submission"],
    },
    {
        "id": "reasons",
        "name": "Adequacy of Reasons",
        "description": "Duty to give reasons, adequacy of reasons",
        "keywords": ["reasons", "inadequate reasons", "failure to explain"],
    },
    {
        "id": "delay",
        "name": "Delay",
        "description": "Unreasonable delay in decision-making",
        "keywords": ["delay", "unreasonable delay", "prolonged processing"],
    },
    {
        "id": "evidence",
        "name": "Evidence",
        "description": "Weight of evidence, evidentiary issues",
        "keywords": ["evidence", "weight", "corroboration", "documentary evidence"],
    },
    {
        "id": "interpretation",
        "name": "Statutory Interpretation",
        "description": "Interpretation of Migration Act and Regulations",
        "keywords": ["interpretation", "statutory construction", "purposive approach"],
    },
    {
        "id": "judicial-review",
        "name": "Judicial Review",
        "description": "Grounds for judicial review, review procedures",
        "keywords": ["judicial review", "certiorari", "mandamus", "prohibition"],
    },
    {
        "id": "costs",
        "name": "Costs",
        "description": "Costs orders, adverse costs",
        "keywords": ["costs", "costs order", "adverse costs", "indemnity costs"],
    },
]


# ── Functions ──────────────────────────────────────────────────────────────


def get_concepts_for_api() -> list[dict[str, Any]]:
    """Return the full legal concepts registry in API-friendly format.

    Returns a list of all 34 canonical legal concepts with metadata.
    Used by /api/v1/taxonomy/legal-concepts endpoint for frontend filtering.

    Returns:
        List of concept dictionaries with id, name, description, keywords.

    Example output:
        [
            {
                "id": "procedural-fairness",
                "name": "Procedural Fairness",
                "description": "Natural justice, right to be heard, bias",
                "keywords": ["natural justice", "procedural fairness", "bias", ...]
            },
            ...
        ]
    """
    return LEGAL_CONCEPTS


def get_concept_by_id(concept_id: str) -> dict[str, Any] | None:
    """Get a legal concept by its ID.

    Args:
        concept_id: The concept ID (e.g., "procedural-fairness")

    Returns:
        Concept dictionary if found, None otherwise.

    Examples:
        >>> concept = get_concept_by_id("character-test")
        >>> concept["name"]
        'Character Test'
    """
    for concept in LEGAL_CONCEPTS:
        if concept["id"] == concept_id:
            return concept
    return None


def get_concept_names() -> list[str]:
    """Get a list of all canonical legal concept names (for normalization).

    Returns:
        List of concept names in title case.

    Examples:
        >>> names = get_concept_names()
        >>> "Procedural Fairness" in names
        True
    """
    return [concept["name"] for concept in LEGAL_CONCEPTS]


def search_concepts(query: str) -> list[dict[str, Any]]:
    """Search legal concepts by name, description, or keywords.

    Args:
        query: Search query string (case-insensitive)

    Returns:
        List of matching concept dictionaries.

    Examples:
        >>> results = search_concepts("character")
        >>> len(results) >= 1
        True
        >>> results[0]["name"]
        'Character Test'
    """
    query_lower = query.lower().strip()
    if not query_lower:
        return LEGAL_CONCEPTS

    matches = []
    for concept in LEGAL_CONCEPTS:
        # Search in name, description, and keywords
        if (
            query_lower in concept["name"].lower()
            or query_lower in concept["description"].lower()
            or any(query_lower in kw.lower() for kw in concept["keywords"])
        ):
            matches.append(concept)

    return matches
