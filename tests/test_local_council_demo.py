"""Loopback HTTP integration checks for the isolated Council demo."""

import http.client
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from scripts.local_council_demo import DEMO_MARKER, DemoServer
from scripts.local_openai_mock import LocalMockServer, MockHandler


class CapturingMock(BaseHTTPRequestHandler):
    requests = []

    def log_message(self, *_args):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.requests.append((self.path, body, dict(self.headers)))
        raw = json.dumps({"choices": [{"message": {"content": "Fixed local example"}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


@pytest.fixture
def servers():
    CapturingMock.requests = []
    upstream = ThreadingHTTPServer(("127.0.0.1", 0), CapturingMock)
    bridge = DemoServer(0, upstream.server_port)
    for server in (upstream, bridge):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    yield bridge, upstream
    for server in (bridge, upstream):
        server.shutdown()
        server.server_close()


def request(port, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        conn.request(method, path, body=body, headers=headers or {})
        response = conn.getresponse()
        return response.status, response.getheader("Content-Type"), response.read().decode()
    finally:
        conn.close()


def test_stream_uses_openai_schema_without_forwarding_or_storing_user_input(servers):
    bridge, _ = servers
    secret = "private example that must never leave the browser demo"
    payload = json.dumps({"message": secret, "case_id": secret})
    status, content_type, body = request(bridge.server_port, "POST", "/api/v1/llm-council/stream", payload, {"Authorization": "Bearer private-token"})
    assert status == 200 and content_type.startswith("text/event-stream")
    assert DEMO_MARKER in body and "Fixed local example" in body
    assert secret not in body and "private-token" not in body
    assert len(CapturingMock.requests) == 1
    path, sent, headers = CapturingMock.requests[0]
    assert path == "/v1/chat/completions"
    assert secret.encode() not in sent and "Authorization" not in headers
    assert json.loads(sent)["messages"][0]["content"] == "Demonstrate a fictitious response."
    event = next(item for item in body.split("\n\n") if item.startswith("event: council.session"))
    session_id = json.loads(event.split("data: ", 1)[1])["session_id"]
    status, _, raw = request(bridge.server_port, "GET", f"/api/v1/llm-council/sessions/{session_id}")
    saved = json.loads(raw)
    assert status == 200 and DEMO_MARKER in saved["turns"][0]["moderator"]["composed_answer"]
    assert secret not in raw and "示範" in saved["session"]["title"]
    status, _, follow = request(bridge.server_port, "POST", f"/api/v1/llm-council/sessions/{session_id}/turns", payload)
    assert status == 200 and json.loads(follow)["total_turns"] == 2
    assert secret not in follow and len(CapturingMock.requests) == 2


def test_unsupported_routes_and_nonlocal_hosts_are_rejected(servers):
    bridge, _ = servers
    assert request(bridge.server_port, "GET", "/api/v1/cases")[0] == 404
    assert request(bridge.server_port, "POST", "/api/v1/cases", "{}")[0] == 404
    assert request(bridge.server_port, "GET", "/health", headers={"Host": "attacker.example"})[0] == 403
    assert request(bridge.server_port, "GET", "/api/v1/auth/me")[0] == 200


def test_demo_logout_succeeds_and_cannot_silently_refresh(servers):
    bridge, _ = servers
    assert request(bridge.server_port, "GET", "/api/v1/auth/me")[0] == 200
    status, _, body = request(bridge.server_port, "POST", "/api/v1/auth/logout")
    assert status == 200 and json.loads(body)["ok"] is True
    assert request(bridge.server_port, "GET", "/api/v1/auth/me")[0] == 401
    assert request(bridge.server_port, "POST", "/api/v1/auth/refresh")[0] == 401


def test_unavailable_mock_fails_closed_and_creates_no_session(servers):
    bridge, upstream = servers
    upstream.shutdown()
    upstream.server_close()
    status, _, body = request(bridge.server_port, "POST", "/api/v1/llm-council/stream", "{}")
    assert status == 503 and "unavailable" in body
    assert bridge.sessions == {}


def test_real_local_openai_mock_is_compatible():
    upstream = ThreadingHTTPServer(("127.0.0.1", 0), MockHandler)
    bridge = DemoServer(0, upstream.server_port)
    for server in (upstream, bridge):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        status, _, body = request(bridge.server_port, "POST", "/api/v1/llm-council/stream", "{}")
        assert status == 200
        assert DEMO_MARKER in body and "SIMULATED EXAMPLE" in body
    finally:
        for server in (bridge, upstream):
            server.shutdown()
            server.server_close()


def test_broken_upstream_http_protocol_fails_closed():
    class BrokenMock(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            self.wfile.write(b"This is not an HTTP response\r\n\r\n")
            self.close_connection = True

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), BrokenMock)
    bridge = DemoServer(0, upstream.server_port)
    for server in (upstream, bridge):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        secret = "private demo content"
        status, _, body = request(bridge.server_port, "POST", "/api/v1/llm-council/stream", json.dumps({"message": secret}))
        assert status == 503 and "unavailable" in body
        assert secret not in body and bridge.sessions == {}
    finally:
        for server in (bridge, upstream):
            server.shutdown()
            server.server_close()


@pytest.mark.parametrize("kind", ["bridge", "mock"])
def test_servers_refuse_to_share_an_existing_port(kind):
    occupied = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    occupied.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    occupied.bind(("127.0.0.1", 0))
    occupied.listen(1)
    port = occupied.getsockname()[1]
    try:
        with pytest.raises(OSError):
            if kind == "bridge":
                DemoServer(port, 8766)
            else:
                LocalMockServer(("127.0.0.1", port), MockHandler)
    finally:
        occupied.close()


@pytest.mark.parametrize("kind", ["bridge", "mock"])
def test_servers_exclude_reuse_enabled_competitors(kind):
    server = DemoServer(0, 8766) if kind == "bridge" else LocalMockServer(("127.0.0.1", 0), MockHandler)
    rival = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    rival.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        with pytest.raises(OSError):
            rival.bind(("127.0.0.1", server.server_port))
            rival.listen(1)
    finally:
        rival.close()
        server.server_close()
