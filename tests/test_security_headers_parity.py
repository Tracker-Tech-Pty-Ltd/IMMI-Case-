"""The browser security policy must be identical in Flask and in the Worker.

Flask (`immi_case_downloader/web/security.py`) is local-dev only; the production
SPA is served by `workers/cloudflare-native.js`. If the two policies drift, a
developer verifying headers locally is testing something production never sends.
"""

import re
from pathlib import Path
from unittest.mock import patch

from flask import Response

from immi_case_downloader.web.security import (
    PERMISSIONS_POLICY,
    SPA_CSP_DIRECTIVES,
    STRICT_TRANSPORT_SECURITY,
    add_security_headers,
)

WORKER_ENTRY = Path(__file__).resolve().parents[1] / "workers" / "cloudflare-native.js"


def test_flask_sets_the_full_security_header_set():
    response = add_security_headers(Response("x"))

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert response.headers["Permissions-Policy"] == PERMISSIONS_POLICY
    assert "default-src 'self'" in response.headers["Content-Security-Policy"]


def test_hsts_is_sent_only_on_a_tls_terminated_runtime():
    # Local dev is plain HTTP; pinning localhost to HTTPS would break it.
    with patch(
        "immi_case_downloader.web.security.secure_cookie_required", return_value=False
    ):
        dev = add_security_headers(Response("x"))
    assert "Strict-Transport-Security" not in dev.headers

    with patch(
        "immi_case_downloader.web.security.secure_cookie_required", return_value=True
    ):
        prod = add_security_headers(Response("x"))
    assert prod.headers["Strict-Transport-Security"] == STRICT_TRANSPORT_SECURITY


def test_csp_forbids_inline_and_evaled_script():
    script_src = next(d for d in SPA_CSP_DIRECTIVES if d.startswith("script-src "))
    assert "'unsafe-inline'" not in script_src
    assert "'unsafe-eval'" not in script_src


def _worker_csp_directives() -> list[str]:
    """Parse the ordered directive list out of the Worker's source.

    A one-way `directive in source` check is not a parity test: it passes when
    the Worker has EXTRA directives Flask does not, when a directive is defined
    but never used, and when the two lists are in different orders. CSP is
    order-insensitive for semantics but not for review — and an extra origin on
    the production side is exactly the drift this file exists to catch. So
    extract the array and compare it as a whole.
    """
    source = WORKER_ENTRY.read_text(encoding="utf-8")
    match = re.search(
        r"const SPA_CONTENT_SECURITY_POLICY = \[(.*?)\]\.join\(", source, re.S
    )
    assert match, "could not locate SPA_CONTENT_SECURITY_POLICY array in the Worker"
    return re.findall(r'"([^"]+)"', match.group(1))


def test_worker_and_flask_ship_exactly_the_same_csp_directives():
    worker = _worker_csp_directives()
    flask = list(SPA_CSP_DIRECTIVES)

    # Ordered equality, both directions at once. Reports the asymmetric
    # difference on failure so the message says which side has the extra.
    assert worker == flask, (
        f"CSP drift.\n"
        f"  only in Worker: {[d for d in worker if d not in flask]}\n"
        f"  only in Flask:  {[d for d in flask if d not in worker]}\n"
        f"  worker order:   {worker}\n"
        f"  flask order:    {flask}"
    )


def test_worker_and_flask_ship_the_same_transport_headers():
    source = WORKER_ENTRY.read_text(encoding="utf-8")
    worker_hsts = re.search(
        r'const STRICT_TRANSPORT_SECURITY = "([^"]+)"', source
    )
    worker_pp = re.search(r'"Permissions-Policy": "([^"]+)"', source)
    assert worker_hsts, "Worker does not define STRICT_TRANSPORT_SECURITY"
    assert worker_pp, "Worker does not set Permissions-Policy"
    assert worker_hsts.group(1) == STRICT_TRANSPORT_SECURITY
    assert worker_pp.group(1) == PERMISSIONS_POLICY


def test_hsts_max_age_is_not_raised_without_updating_this_test():
    """Stage gate for the HSTS ramp (Step 5).

    A cached HSTS entry cannot be recalled, so raising max-age is a one-way
    door per client. This test forces the raise to be a deliberate, reviewed
    edit rather than a one-character change nobody notices. Update the expected
    value in the SAME commit that raises it, and record the stage in the PR.
    """
    assert STRICT_TRANSPORT_SECURITY == "max-age=300", (
        "HSTS max-age changed. If this is a planned stage of the Step 5 ramp, "
        "update this assertion in the same commit and say which stage in the "
        "PR. If `includeSubDomains` is being added, it needs explicit operator "
        "sign-off first — see Maintenance notes."
    )
