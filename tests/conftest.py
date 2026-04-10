"""Shared test fixtures for IMMI-Case tests."""

import os
import pytest
import responses

from immi_case_downloader.models import ImmigrationCase
from immi_case_downloader.storage import save_cases_csv, save_cases_json, ensure_output_dirs


FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")


def _load_fixture(name: str) -> str:
    """Load an HTML fixture file."""
    with open(os.path.join(FIXTURES_DIR, name), encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="session", autouse=True)
def test_secret_key():
    """Provide a stable SECRET_KEY for tests that do not exercise missing-key behavior."""
    original = os.environ.get("SECRET_KEY")
    os.environ["SECRET_KEY"] = "test-secret-key-for-pytest"
    try:
        yield
    finally:
        if original is None:
            os.environ.pop("SECRET_KEY", None)
        else:
            os.environ["SECRET_KEY"] = original


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Ensure per-test isolation for the in-memory API rate limiter."""
    from immi_case_downloader.web.security import rate_limiter

    rate_limiter.reset()
    try:
        yield
    finally:
        rate_limiter.reset()


def _reset_pipeline_status():
    """Reset the active pipeline reference so no state leaks across tests."""
    from immi_case_downloader import pipeline as pipeline_module

    with pipeline_module._active_pipeline_lock:
        pipeline_module._active_pipeline = None


@pytest.fixture(autouse=True)
def reset_pipeline_state():
    """Prevent pipeline control flags from leaking across tests."""
    _reset_pipeline_status()
    try:
        yield
    finally:
        _reset_pipeline_status()


@pytest.fixture(autouse=True)
def reset_analytics_caches():
    """Prevent in-memory analytics/stats caches from leaking across tests."""
    from immi_case_downloader.web.routes import api as api_mod

    def _clear():
        api_mod._stats_cache_payload = None
        api_mod._stats_cache_ts = 0.0
        api_mod._filter_options_cache_payload = None
        api_mod._filter_options_cache_ts = 0.0
        api_mod._lineage_cache_payload = None
        api_mod._lineage_cache_ts = 0.0
        api_mod._all_cases_cache.clear()
        api_mod._all_cases_ts = 0.0
        api_mod._analytics_cases_cache.clear()
        api_mod._analytics_cases_ts = 0.0
        api_mod._analytics_cache_obj.invalidate()

    _clear()
    try:
        yield
    finally:
        _clear()


@pytest.fixture
def sample_case():
    """A fully populated ImmigrationCase."""
    case = ImmigrationCase(
        case_id="",
        citation="[2024] AATA 100",
        title="Smith v Minister for Immigration",
        court="Administrative Appeals Tribunal",
        court_code="AATA",
        date="2024-03-15",
        year=2024,
        url="https://www.austlii.edu.au/au/cases/cth/AATA/2024/100.html",
        judges="Senior Member Jones",
        catchwords="migration; visa refusal; character test",
        outcome="Affirmed",
        visa_type="Subclass 866 Protection Visa",
        legislation="Migration Act 1958 (Cth) s 501",
        text_snippet="The Tribunal affirms the decision under review.",
        full_text_path="",
        source="AustLII",
        user_notes="",
        tags="",
        case_nature="Visa Refusal",
        legal_concepts="Character Test; Section 501",
    )
    case.ensure_id()
    return case


@pytest.fixture
def sample_cases():
    """Multiple ImmigrationCase objects with unique URLs."""
    cases = []
    courts = [
        ("AATA", "Administrative Appeals Tribunal"),
        ("FCA", "Federal Court of Australia"),
        ("FCCA", "Federal Circuit Court of Australia"),
        ("FedCFamC2G", "Federal Circuit and Family Court (Div 2)"),
        ("HCA", "High Court of Australia"),
    ]
    for i, (code, name) in enumerate(courts):
        case = ImmigrationCase(
            citation=f"[2024] {code} {100 + i}",
            title=f"Applicant {i} v Minister for Immigration",
            court=name,
            court_code=code,
            date=f"2024-0{i+1}-15",
            year=2024,
            url=f"https://www.austlii.edu.au/au/cases/cth/{code}/2024/{100+i}.html",
            source="AustLII",
            case_nature="Visa Refusal",
            legal_concepts="Migration Act",
        )
        case.ensure_id()
        cases.append(case)
    return cases


@pytest.fixture
def populated_dir(tmp_path, sample_cases):
    """A tmp directory pre-populated with CSV and JSON data."""
    ensure_output_dirs(str(tmp_path))
    save_cases_csv(sample_cases, str(tmp_path))
    save_cases_json(sample_cases, str(tmp_path))
    return tmp_path


@pytest.fixture
def app(populated_dir):
    """Flask test app backed by populated_dir data (CSRF disabled for general tests)."""
    from immi_case_downloader.webapp import create_app

    application = create_app(str(populated_dir))
    application.config["TESTING"] = True
    application.config["WTF_CSRF_ENABLED"] = False
    return application


@pytest.fixture
def client(app):
    """Flask test client."""
    return app.test_client()


# ── Phase 2: HTML fixture loaders ─────────────────────────────────────────


@pytest.fixture
def austlii_year_html():
    """AustLII year listing HTML fixture."""
    return _load_fixture("austlii_year_listing.html")


@pytest.fixture
def austlii_case_html():
    """AustLII case detail HTML fixture."""
    return _load_fixture("austlii_case_detail.html")


@pytest.fixture
def austlii_search_html():
    """AustLII search results HTML fixture."""
    return _load_fixture("austlii_search_results.html")


@pytest.fixture
def fedcourt_search_html():
    """Federal Court search results HTML fixture."""
    return _load_fixture("fedcourt_search_results.html")


@pytest.fixture
def mock_responses():
    """Activate the responses library for HTTP mocking."""
    with responses.RequestsMock() as rsps:
        yield rsps
