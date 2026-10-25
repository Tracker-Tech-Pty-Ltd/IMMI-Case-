"""Real browser cookies/Web Locks with a local, fake authentication service.

No Telegram, Cloudflare or model provider is contacted. Only this test's new
browser context is intercepted; the shared seeded Flask fixture is unchanged.
"""

import base64
from datetime import datetime, timezone
import json
from urllib.parse import urlparse

import pytest
from playwright.sync_api import expect


FROZEN_NOW = datetime(2026, 10, 16, 1, 0, tzinfo=timezone.utc)
TENANTS = [
    {"id": "11111111-1111-4111-8111-111111111111", "kind": "individual", "name": "Workspace A"},
    {"id": "22222222-2222-4222-8222-222222222222", "kind": "organization", "name": "Workspace B"},
]


def _token(tenant_id, generation=0, lifetime=300):
    payload = {
        "sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "tenant_id": tenant_id,
        "exp": int(FROZEN_NOW.timestamp()) + lifetime,
        "generation": generation,
    }
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    return f"header.{encoded}.fake-local-signature"


def _cookie(request, name):
    for item in request.headers.get("cookie", "").split(";"):
        key, _, value = item.strip().partition("=")
        if key == name:
            return value
    return None


class LocalAuthService:
    def __init__(self, context, base_url):
        self.context = context
        self.base_url = base_url
        self.origin = urlparse(base_url).netloc
        self.tokens = {_token(TENANTS[0]["id"]): TENANTS[0]["id"]}
        self.current_refresh = "local-refresh-0"
        self.generation = 0
        self.refresh_requests = []
        self.pending_refreshes = []
        self.refresh_conflicts = 0
        self.council_requests = []
        self.logout_offline = False
        self.set_cookie("immi_access", next(iter(self.tokens)))
        self.set_cookie("immi_refresh", self.current_refresh)
        context.route("**/*", self.route)

    def set_cookie(self, name, value):
        self.context.add_cookies([{
            "name": name, "value": value, "url": self.base_url,
            "httpOnly": True, "sameSite": "Lax", "secure": False,
        }])

    def identity(self, access_token):
        tenant_id = self.tokens[access_token]
        return {
            "access_token": access_token,
            "user": {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "first_name": "Review User", "role": "member"},
            "tenant": next(tenant for tenant in TENANTS if tenant["id"] == tenant_id),
            "tenants": TENANTS,
        }

    def issue_access(self, tenant_id, lifetime=300):
        self.generation += 1
        access = _token(tenant_id, self.generation, lifetime)
        self.tokens[access] = tenant_id
        self.set_cookie("immi_access", access)
        return access

    def route(self, route):
        request = route.request
        parsed = urlparse(request.url)
        if parsed.netloc != self.origin:
            route.abort("blockedbyclient")
            return
        if parsed.path == "/api/v1/auth/me":
            access = _cookie(request, "immi_access")
            if access not in self.tokens:
                route.fulfill(status=401, json={"error": "No local access cookie"})
            else:
                route.fulfill(json=self.identity(access))
        elif parsed.path == "/api/v1/auth/switch-tenant":
            access = self.issue_access(request.post_data_json["tenant_id"])
            route.fulfill(json=self.identity(access))
        elif parsed.path == "/api/v1/auth/refresh":
            self.refresh_requests.append(request)
            # Leave the first response pending while both tabs' real expiry
            # timers fire. The second tab must wait on Chromium's Web Lock.
            self.pending_refreshes.append(route)
        elif parsed.path == "/api/v1/auth/logout":
            if self.logout_offline:
                route.abort("internetdisconnected")
            else:
                route.fulfill(json={"ok": True})
        elif parsed.path.startswith("/api/v1/auth/"):
            route.fulfill(status=400, json={"error": "Unsupported local auth fixture operation"})
        elif parsed.path.startswith("/api/v1/llm-council/"):
            self.council_requests.append((parsed.path, request.headers.get("authorization")))
            if parsed.path.endswith("/stream"):
                route.fulfill(
                    content_type="text/event-stream",
                    body=(
                        'event: council.start\ndata: {}\n\n'
                        'event: openai.done\ndata: {"text":"Local fixture answer"}\n\n'
                        'event: council.done\ndata: {}\n\n'
                    ),
                )
            else:
                route.fulfill(json={"sessions": []})
        else:
            route.continue_()

    def release_refresh(self):
        route = self.pending_refreshes.pop(0)
        if _cookie(route.request, "immi_refresh") != self.current_refresh:
            self.refresh_conflicts += 1
            route.fulfill(status=401, json={"code": "revoked_refresh_token"})
            return
        self.current_refresh = f"local-refresh-{self.generation + 1}"
        self.set_cookie("immi_refresh", self.current_refresh)
        tenant_id = route.request.headers.get("x-active-tenant-id", TENANTS[0]["id"])
        access = self.issue_access(tenant_id, lifetime=900)
        route.fulfill(json=self.identity(access))


@pytest.fixture
def auth_browser(browser, base_url, is_live_mode):
    if is_live_mode:
        pytest.skip("Mock-auth browser regressions require the local seeded fixture")
    context = browser.new_context(base_url=base_url, viewport={"width": 1440, "height": 1000})
    # Page.clock aliases this same context-wide clock. Installing or advancing
    # once per page would also advance the other tab's request timeout.
    context.clock.install(time=FROZEN_NOW)
    context.add_init_script("localStorage.setItem('i18nextLng', 'en');")
    service = LocalAuthService(context, base_url)
    try:
        yield context, service
    finally:
        context.unroute_all(behavior="wait")
        context.close()


def _open_signed_in(context, path="/cases"):
    page = context.new_page()
    page.goto(path)
    expect(page.get_by_role("button", name="Sign out", exact=True)).to_be_visible()
    expect(page.get_by_role("combobox", name="Switch workspace")).to_have_value(TENANTS[0]["id"])
    return page


def test_workspace_switch_in_another_tab_does_not_retarget_council(auth_browser):
    context, service = auth_browser
    a = _open_signed_in(context)
    b = _open_signed_in(context)
    initial_access = next(iter(service.tokens))
    b.get_by_role("combobox", name="Switch workspace").select_option(TENANTS[1]["id"])
    expect(b.get_by_role("combobox", name="Switch workspace")).to_have_value(TENANTS[1]["id"])
    expect(a.get_by_role("combobox", name="Switch workspace")).to_have_value(TENANTS[0]["id"])

    # Navigate the real React Router without reloading A's identity from B's
    # shared cookie. The sessions list currently has no sidebar entry.
    a.evaluate("history.pushState({}, '', '/llm-council/sessions'); dispatchEvent(new PopStateEvent('popstate'));")
    expect(a.get_by_test_id("sessions-empty")).to_be_visible()
    assert service.council_requests[-1] == ("/api/v1/llm-council/sessions", f"Bearer {initial_access}")

    a.locator('aside a[href="/llm-council"]').click()
    a.locator("textarea").fill("Private question intended only for Workspace A")
    a.get_by_role("button", name="Send", exact=True).click()
    expect(a.get_by_test_id("streaming-council-view")).to_be_visible()
    assert service.council_requests[-1] == ("/api/v1/llm-council/stream", f"Bearer {initial_access}")
    expect(a.get_by_role("combobox", name="Switch workspace")).to_have_value(TENANTS[0]["id"])


def test_offline_logout_keeps_signed_in_controls_and_shows_retry(auth_browser):
    context, service = auth_browser
    page = _open_signed_in(context)
    service.logout_offline = True
    page.get_by_role("button", name="Sign out", exact=True).click()
    expect(page.get_by_text("Sign out failed. Please try again.", exact=True)).to_be_visible()
    expect(page.get_by_role("button", name="Sign out", exact=True)).to_be_visible()
    assert any(cookie["name"] == "immi_refresh" for cookie in context.cookies())


def test_two_tab_expiry_uses_one_native_web_lock_rotation(auth_browser):
    context, service = auth_browser
    a = _open_signed_in(context)
    b = _open_signed_in(context)
    assert a.evaluate("typeof navigator.locks?.request") == "function"
    events = []
    for label, page in [("A", a), ("B", b)]:
        page.on("request", lambda request, tab=label: events.append({"tab": tab, "event": "POST"})
                if request.url.endswith("/auth/refresh") else None)
        page.on("requestfailed", lambda request, tab=label: events.append({"tab": tab, "event": "failed", "reason": request.failure})
                if request.url.endswith("/auth/refresh") else None)
    times = [[a.evaluate("Date.now()"), b.evaluate("Date.now()")]]
    # One advance fires both tabs' expiry timers at the same shared time.
    # A second advance would skip another four minutes, aborting the first
    # POST after its legitimate 20s deadline and starting a sequential retry.
    context.clock.fast_forward(240_001)
    times.append([a.evaluate("Date.now()"), b.evaluate("Date.now()")])
    a.wait_for_function("""async () => {
        const state = await navigator.locks.query();
        const name = 'immi:auth:cookie-mutation';
        return state.held.some(lock => lock.name === name)
            && state.pending.some(lock => lock.name === name);
    }""")
    diagnostic = {"virtual_times": times, "refresh_events": events}
    assert len(service.refresh_requests) == 1, diagnostic
    assert not any(event["event"] == "failed" for event in events), diagnostic
    assert len(service.pending_refreshes) == 1
    service.release_refresh()
    # Queue behind both real refresh operations: finishing this barrier proves
    # the waiting tab completed its /me adoption instead of rotating again.
    b.evaluate("async () => navigator.locks.request('immi:auth:cookie-mutation', () => {})")
    assert len(service.refresh_requests) == 1, diagnostic
    assert not any(event["event"] == "failed" for event in events), diagnostic
    assert service.refresh_conflicts == 0
    expect(a.get_by_role("button", name="Sign out", exact=True)).to_be_visible()
    expect(b.get_by_role("button", name="Sign out", exact=True)).to_be_visible()
