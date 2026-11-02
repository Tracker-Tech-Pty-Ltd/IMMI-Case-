"""Verify isolated demo startup, collisions and teardown."""

import http.client
import json
import socket

import pytest

from scripts.run_council_demo import check_ports_available, start_services, stop_services


def distinct_ports(count):
    sockets = []
    try:
        for _ in range(count):
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(("127.0.0.1", 0))
            sockets.append(sock)
        return [sock.getsockname()[1] for sock in sockets]
    finally:
        for sock in sockets:
            sock.close()


def test_occupied_and_duplicate_ports_fail_before_start():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as occupied:
        occupied.bind(("127.0.0.1", 0))
        occupied.listen()
        port = occupied.getsockname()[1]
        with pytest.raises(ValueError, match="unavailable"):
            check_ports_available([port])
        with pytest.raises(ValueError, match="different"):
            check_ports_available([port, port])


def test_real_local_stack_uses_demo_proxy_and_stops(monkeypatch):
    mock_port, bridge_port, ui_port = distinct_ports(3)
    # The launcher must override an inherited production-like setting.
    monkeypatch.setenv("VITE_API_PROXY_TARGET", "http://127.0.0.1:1")
    monkeypatch.setenv("VITE_COUNCIL_DEMO", "false")
    services = start_services(mock_port, bridge_port, ui_port)
    try:
        assert all(service.poll() is None for service in services)
        conn = http.client.HTTPConnection("127.0.0.1", ui_port, timeout=10)
        conn.request("GET", "/api/v1/auth/me")
        response = conn.getresponse()
        assert response.status == 200
        assert json.loads(response.read())["tenant"]["id"] == "demo"
        conn.close()

        conn = http.client.HTTPConnection("127.0.0.1", ui_port, timeout=30)
        conn.request("GET", "/src/pages/LlmCouncilPage.tsx")
        response = conn.getresponse()
        content = response.read().decode()
        assert response.status == 200 and '"VITE_COUNCIL_DEMO": "true"' in content
        conn.close()
    finally:
        stop_services(services)
    assert all(service.poll() is not None for service in services)
    check_ports_available([mock_port, bridge_port, ui_port])
