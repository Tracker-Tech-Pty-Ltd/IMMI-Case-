"""Keep the native route manifest an auditable contract inventory."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _manifest() -> dict:
    return json.loads(
        (ROOT / "config/cloudflare-native-route-manifest.json").read_text(encoding="utf-8")
    )


def test_implemented_and_unported_routes_are_disjoint_and_well_formed() -> None:
    manifest = _manifest()
    implemented = set(manifest["implemented"])
    unported = set(manifest["unported_fail_closed"])
    assert implemented.isdisjoint(unported)
    assert implemented
    for route in implemented | unported:
        method, path = route.split(" ", 1)
        assert method in {"GET", "POST", "PUT", "PATCH", "DELETE"}
        assert path.startswith("/api/v1/") or path == "/health"


def test_every_legacy_flask_route_is_explicitly_implemented_or_blocked() -> None:
    manifest = _manifest()
    accounted = set(manifest["implemented"]) | set(manifest["unported_fail_closed"])
    legacy_routes = set(manifest["legacy_flask_routes"])
    assert legacy_routes
    assert legacy_routes <= accounted


def test_no_unported_routes_remain_in_the_native_activation_manifest() -> None:
    unported = set(_manifest()["unported_fail_closed"])
    assert not unported


def test_council_crud_manifest_includes_append_and_read_turns() -> None:
    implemented = set(_manifest()["implemented"])
    assert "GET /api/v1/llm-council/sessions/:session_id/turns" in implemented
    assert "POST /api/v1/llm-council/sessions/:session_id/turns" in implemented
    assert "DELETE /api/v1/llm-council/sessions/:session_id" in implemented
