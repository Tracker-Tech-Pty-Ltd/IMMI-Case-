"""Reusable selectors, routes, and navigation utilities for React SPA E2E tests."""

from playwright.sync_api import Page

# ---------------------------------------------------------------------------
# React SPA routes (served at root /)
# ---------------------------------------------------------------------------

REACT_BASE = "/"

REACT_ROUTES = {
    "dashboard": "/",
    "analytics": "/analytics",
    "judge_profiles": "/judge-profiles",
    "judge_detail": "/judge-profiles/Senior%20Member%20Jones",
    "judge_compare": "/judge-profiles/compare?names=Senior%20Member%20Jones,Deputy%20President%20Smith",
    "court_lineage": "/court-lineage",
    "cases": "/cases",
    "collections": "/collections",
    "saved_searches": "/saved-searches",
    "case_add": "/cases/add",
    "case_compare": "/cases/compare",
    "download": "/download",
    "jobs": "/jobs",
    "pipeline": "/pipeline",
    "legislations": "/legislations",
    "data_dictionary": "/data-dictionary",
    "design_tokens": "/design-tokens",
}

# Pages that are parametrised smoke targets (all should return 200 + render #root)
SMOKE_PAGES = [
    ("dashboard", "/"),
    ("analytics", "/analytics"),
    ("judge_profiles", "/judge-profiles"),
    ("court_lineage", "/court-lineage"),
    ("cases", "/cases"),
    ("collections", "/collections"),
    ("saved_searches", "/saved-searches"),
    ("cases_add", "/cases/add"),
    ("download", "/download"),
    ("jobs", "/jobs"),
    ("pipeline", "/pipeline"),
    ("legislations", "/legislations"),
    ("data_dictionary", "/data-dictionary"),
    ("design_tokens", "/design-tokens"),
]

# API endpoints to smoke-test (GET only)
API_ENDPOINTS = [
    "/api/v1/csrf-token",
    "/api/v1/stats",
    "/api/v1/stats/trends",
    "/api/v1/cases",
    "/api/v1/filter-options",
    "/api/v1/job-status",
    "/api/v1/data-dictionary",
    "/api/v1/analytics/outcomes",
    "/api/v1/analytics/judges",
    "/api/v1/analytics/legal-concepts",
    "/api/v1/analytics/nature-outcome",
    "/api/v1/analytics/success-rate",
    "/api/v1/analytics/judge-leaderboard",
    "/api/v1/analytics/judge-profile?name=Senior%20Member%20Jones",
    "/api/v1/analytics/judge-compare?names=Senior%20Member%20Jones,Deputy%20President%20Smith",
    "/api/v1/analytics/concept-effectiveness",
    "/api/v1/analytics/concept-cooccurrence?min_count=1",
    "/api/v1/analytics/concept-trends",
]

# ---------------------------------------------------------------------------
# Sidebar navigation items (label → route)
# ---------------------------------------------------------------------------

SIDEBAR_NAV_ITEMS = [
    ("Dashboard", "/"),
    ("Analytics", "/analytics"),
    ("Judge Profiles", "/judge-profiles"),
    ("Court Lineage", "/court-lineage"),
    ("Cases", "/cases"),
    ("Collections", "/collections"),
    ("Saved Searches", "/saved-searches"),
    ("Download", "/download"),  # Matches en.json nav.download
    ("Pipeline", "/pipeline"),  # Matches en.json nav.pipeline
    ("Legislations", "/legislations"),  # Added in 2026-02-20
    ("Data Dictionary", "/data-dictionary"),
    ("Design Tokens", "/design-tokens"),
]

# ---------------------------------------------------------------------------
# Keyboard shortcut mappings
# ---------------------------------------------------------------------------

KEYBOARD_SHORTCUTS = {
    "d": "/",
    "c": "/cases",
    "p": "/pipeline",
}

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def react_navigate(page: Page, path: str, base_url: str = ""):
    """Navigate to a React SPA route and wait for hydration."""
    url = f"{base_url}{path}" if base_url else path
    page.goto(url, wait_until="networkidle")
    wait_for_react(page)


def wait_for_react(page: Page, timeout: int = 15000):
    """Wait for React to hydrate: #root must exist and contain rendered children."""
    # Use state="attached" because an empty #root div has zero height (hidden to Playwright)
    page.wait_for_selector("#root", state="attached", timeout=timeout)
    # Wait until React has rendered at least one child inside #root
    page.wait_for_function(
        "document.querySelector('#root')?.children.length > 0",
        timeout=timeout,
    )


def wait_for_loading_gone(page: Page, timeout: int = 10000):
    """Wait for common loading indicators to disappear."""
    # TanStack Query pages show 'Loading...' text initially
    loading = page.get_by_text("Loading", exact=True)
    try:
        loading.first.wait_for(state="hidden", timeout=timeout)
    except Exception:
        pass  # If no loading text found, that's fine


def get_js_errors(page: Page) -> list[str]:
    """Return collected JS errors from the page."""
    return getattr(page, "_js_errors", [])


def assert_no_js_errors(page: Page):
    """Assert no JS errors were captured on the page."""
    errors = get_js_errors(page)
    assert errors == [], f"JS errors detected: {errors}"


def get_heading(page: Page, level: int = 1) -> str:
    """Get the text of the first heading at the given level."""
    heading = page.locator(f"h{level}").first
    return heading.inner_text() if heading.is_visible() else ""


def count_elements(page: Page, selector: str) -> int:
    """Count elements matching a CSS selector."""
    return page.locator(selector).count()


def click_sidebar_link(page: Page, label: str):
    """Click a navigation link in the desktop sidebar by its label."""
    sidebar = page.locator("aside")
    # Use role="link" to avoid matching headings or other text
    link = sidebar.get_by_role("link", name=label, exact=True)
    link.click()
    page.wait_for_load_state("networkidle")
    wait_for_react(page)


def click_mobile_menu(page: Page):
    """Open the mobile hamburger menu."""
    page.get_by_label("Toggle menu").click()
    # Wait for the mobile drawer to appear
    page.wait_for_selector(".fixed.inset-y-0", timeout=5000)


def close_mobile_menu(page: Page):
    """Close the mobile navigation drawer."""
    page.get_by_role("dialog", name="IMMI-Case").get_by_label("Close menu").click()


def get_toast_text(page: Page, timeout: int = 5000) -> str:
    """Wait for a Sonner toast and return its text."""
    toast = page.locator("[data-sonner-toast]").first
    toast.wait_for(state="visible", timeout=timeout)
    return toast.inner_text()


def setup_dialog_handler(page: Page, accept: bool = True, prompt_text: str = ""):
    """Register a dialog handler for confirm/prompt dialogs.

    Must be called BEFORE the action that triggers the dialog.
    """
    def handler(dialog):
        if dialog.type == "prompt" and prompt_text:
            dialog.accept(prompt_text)
        elif accept:
            dialog.accept()
        else:
            dialog.dismiss()

    page.on("dialog", handler)
