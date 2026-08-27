"""Shared configuration constants for the /api/v1 route modules.

Lives here rather than in api.py so that no route module has to import
another one — the api.py <-> api_taxonomy.py cycle that cq-001 left behind
was created by exactly that. Import from this module, never from a sibling
route module.
"""

# ── API configuration constants ───────────────────────────────────────
MAX_BATCH_SIZE = 200
MAX_TAG_LENGTH = 50
MAX_COMPARE_CASES = 5
DEFAULT_PAGE_SIZE = 100
MAX_PAGE_SIZE = 200
DEFAULT_SEARCH_LIMIT = 50
MAX_SEARCH_LIMIT = 200
DEFAULT_SEARCH_MODE = "lexical"
ALLOWED_SEARCH_MODES = frozenset({"lexical", "semantic", "hybrid"})
ALLOWED_SEARCH_PROVIDERS = frozenset({"openai", "gemini"})
DEFAULT_SEMANTIC_CANDIDATE_LIMIT = 150
MAX_SEMANTIC_CANDIDATE_LIMIT = 500
DEFAULT_RELATED_LIMIT = 5
MAX_RELATED_LIMIT = 20
ALLOWED_SORT_FIELDS = frozenset({
    "date", "year", "title", "court", "citation", "outcome",
    "visa_subclass_number", "applicant_name", "hearing_date", "case_id",
})
ALLOWED_SORT_DIRS = frozenset({"asc", "desc"})
ALLOWED_COUNT_MODES = frozenset({"exact", "planned", "estimated"})
# RPC timeout — generous enough for cold-start (Supabase free-tier wakes from sleep in ~4-6s).
SUPABASE_RPC_TIMEOUT_SECONDS = 8.0
# Analytics RPC timeout — analytics/outcomes calls 3 sequential RPCs (each ≤8s server timeout),
# so client-side must allow 3×8s = 24s.  Other analytics RPCs return ≤3000 rows; also bounded here.
ANALYTICS_RPC_TIMEOUT_SECONDS = 25.0

CASE_LIST_COLUMNS = [
    "case_id",
    "citation",
    "title",
    "court_code",
    "date",
    "year",
    "judges",
    "outcome",
    "visa_type",
    "source",
    "tags",
    "case_nature",
    "visa_subclass",
    "visa_class_code",
    "applicant_name",
    "respondent",
    "country_of_origin",
    "visa_subclass_number",
    "hearing_date",
    "is_represented",
    "representative",
]

TRIBUNAL_CODES = {"AATA", "ARTA", "MRTA", "RRTA"}
COURT_CODES = {"FCA", "FCCA", "FMCA", "FedCFamC2G", "HCA"}
