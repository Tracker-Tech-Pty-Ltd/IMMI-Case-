"""Isolated, in-memory Council demo backed by the local OpenAI mock.

Bind only to loopback. Never forward user-entered text or credentials; every
model request uses a fixed example. This is not a production service.
"""

from __future__ import annotations

import argparse
import base64
import http.client
import json
import secrets
import socket
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

MAX_BODY = 100_000
MAX_UPSTREAM = 1_048_576
EXAMPLE_QUESTION = "【示範資料】這是一個虛構的問題；沒有送出或分析任何真實案件。"
DEMO_MARKER = "【示範資料・非真實模型回應】"
DEMO_TOKEN = "local-demo-token"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _identity() -> dict:
    payload = {"exp": int(time.time()) + 86400, "sub": "demo", "tenant_id": "demo"}
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    tenant = {"id": "demo", "name": "示範工作區", "kind": "individual"}
    return {"access_token": f"demo.{encoded}.demo", "user": {"id": "demo", "first_name": "示範", "role": "member"}, "tenant": tenant, "tenants": [tenant]}


def _mock_answer(port: int) -> str:
    # No user input, tokens or environment-derived proxy configuration reaches
    # this request. HTTPConnection connects directly to the IPv4 loopback IP.
    request = json.dumps({"model": "demo-local", "messages": [{"role": "user", "content": "Demonstrate a fictitious response."}], "stream": False}).encode()
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        conn.request("POST", "/v1/chat/completions", body=request, headers={"Content-Type": "application/json"})
        response = conn.getresponse()
        body = response.read(MAX_UPSTREAM + 1)
        if response.status != 200 or len(body) > MAX_UPSTREAM:
            raise ValueError("Local mock unavailable")
        data = json.loads(body)
        content = data["choices"][0]["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            raise ValueError("Local mock returned no content")
        return f"{DEMO_MARKER}\n\n{content.strip()}"
    except (OSError, http.client.HTTPException, ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Local OpenAI mock unavailable or invalid") from exc
    finally:
        conn.close()


def _turn(answer: str, index: int) -> dict:
    opinion = {"provider_key": "openai", "provider_label": "OpenAI 示範", "model": "demo-local", "success": True, "answer": answer, "error": "", "sources": [], "latency_ms": 0}
    moderator = {"success": True, "composed_answer": answer, "consensus": "", "disagreements": "", "outcome_likelihood_percent": None, "outcome_likelihood_label": "", "outcome_likelihood_reason": "", "law_sections": [], "mock_judgment": "", "follow_up_questions": ["【示範】如何查找原始資料？"], "ranking": [], "model_critiques": [], "vote_summary": None, "agreement_points": ["【示範】此處顯示共同意見；本例未比較真實意見。"], "conflict_points": ["【示範】此處顯示不同意見；本例不代表實際爭議。"], "provider_law_sections": {}, "shared_law_sections": [], "shared_law_sections_confidence_percent": 0, "shared_law_sections_confidence_reason": "", "raw_text": "", "error": "", "latency_ms": 0}
    return {"turn_id": secrets.token_hex(6), "turn_index": index, "user_message": EXAMPLE_QUESTION, "opinions": [opinion], "moderator": moderator, "created_at": _now()}


class DemoServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def server_bind(self) -> None:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()

    def __init__(self, port: int, openai_port: int):
        super().__init__(("127.0.0.1", port), DemoHandler)
        self.openai_port = openai_port
        self.sessions: dict[str, dict] = {}
        self.lock = threading.Lock()
        self.authenticated = True


class DemoHandler(BaseHTTPRequestHandler):
    server: DemoServer

    def log_message(self, _format: str, *args: object) -> None:
        # Never log private prompts, tokens, headers or paths.
        return

    def _allowed_host(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0].lower()
        return host in {"127.0.0.1", "localhost"}

    def _send(self, status: int, data: bytes, content_type: str = "application/json; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        self.close_connection = True

    def _json(self, status: int, data: object) -> None:
        self._send(status, json.dumps(data, ensure_ascii=False).encode())

    def _read_and_discard(self) -> bool:
        if self.headers.get("Transfer-Encoding"):
            self._json(400, {"error": "Demo does not support transfer encoding"})
            return False
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json(400, {"error": "Invalid content length"})
            return False
        if length < 0 or length > MAX_BODY:
            self._json(413, {"error": "Demo request too large"})
            return False
        self.rfile.read(length)
        return True

    def do_GET(self) -> None:
        if not self._allowed_host():
            return self._json(403, {"error": "Local demo only"})
        path = urlsplit(self.path).path
        if path == "/health":
            return self._json(200, {"demo": True, "storage": "memory-only"})
        if path == "/api/v1/auth/me":
            with self.server.lock:
                authenticated = self.server.authenticated
            return self._json(200, _identity()) if authenticated else self._json(401, {"error": "Demo signed out"})
        if path == "/api/v1/llm-council/sessions":
            with self.server.lock:
                items = [item["session"].copy() for item in self.server.sessions.values()]
            return self._json(200, {"sessions": items})
        prefix = "/api/v1/llm-council/sessions/"
        if path.startswith(prefix):
            session_id = path[len(prefix):]
            with self.server.lock:
                found = self.server.sessions.get(session_id)
                body = json.dumps(found, ensure_ascii=False).encode() if found else None
            if body is not None:
                return self._send(200, body)
        return self._json(404, {"error": "Unsupported in local demo"})

    def do_POST(self) -> None:
        if not self._allowed_host():
            return self._json(403, {"error": "Local demo only"})
        if not self._read_and_discard():
            return
        path = urlsplit(self.path).path
        if path == "/api/v1/auth/refresh":
            with self.server.lock:
                authenticated = self.server.authenticated
            return self._json(200, _identity()) if authenticated else self._json(401, {"error": "Demo signed out"})
        if path == "/api/v1/auth/logout":
            with self.server.lock:
                self.server.authenticated = False
            return self._json(200, {"ok": True})
        if path == "/api/v1/llm-council/stream":
            try:
                answer = _mock_answer(self.server.openai_port)
            except ValueError:
                return self._json(503, {"error": "Local demo mock unavailable"})
            session_id = secrets.token_hex(6)
            turn = _turn(answer, 0)
            now = _now()
            session = {"session_id": session_id, "case_id": None, "title": "【示範資料】虛構對話", "status": "active", "total_turns": 1, "retrieve_code": None, "created_at": now, "updated_at": now}
            with self.server.lock:
                self.server.sessions[session_id] = {"session": session, "turns": [turn]}
            events = [
                ("council.start", {"question": EXAMPLE_QUESTION, "demo": True}),
                ("council.session", {"session_id": session_id, "session_token": DEMO_TOKEN}),
                ("openai.done", {"answer": answer, "success": True, "model": "demo-local", "sources": []}),
                ("gemini_pro.error", {"error": "示範模式沒有呼叫此模型"}),
                ("anthropic.error", {"error": "示範模式沒有呼叫此模型"}),
                ("moderator.complete", turn["moderator"]),
                ("council.done", {"demo": True}),
            ]
            payload = "".join(f"event: {name}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n" for name, data in events).encode()
            return self._send(200, payload, "text/event-stream; charset=utf-8")
        prefix = "/api/v1/llm-council/sessions/"
        if path.startswith(prefix) and path.endswith("/turns"):
            session_id = path[len(prefix):-len("/turns")]
            with self.server.lock:
                entry = self.server.sessions.get(session_id)
                if not entry:
                    return self._json(404, {"error": "Demo session not found"})
                if len(entry["turns"]) >= 15:
                    return self._json(409, {"error": "Demo turn limit reached"})
            try:
                answer = _mock_answer(self.server.openai_port)
            except ValueError:
                return self._json(503, {"error": "Local demo mock unavailable"})
            with self.server.lock:
                entry = self.server.sessions.get(session_id)
                if not entry or len(entry["turns"]) >= 15:
                    return self._json(409, {"error": "Demo session unavailable"})
                turn = _turn(answer, len(entry["turns"]))
                entry["turns"].append(turn)
                entry["session"]["total_turns"] = len(entry["turns"])
                entry["session"]["updated_at"] = _now()
                count = len(entry["turns"])
            return self._json(200, {"turn": turn, "total_turns": count})
        return self._json(404, {"error": "Unsupported in local demo"})


def main() -> None:
    parser = argparse.ArgumentParser(description="Local-only in-memory Council example")
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--openai-port", type=int, default=8766)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535 or not 1 <= args.openai_port <= 65535:
        parser.error("Ports must be between 1 and 65535 (or 0 for the demo listener)")
    server = DemoServer(args.port, args.openai_port)
    print(f"Council demo on http://127.0.0.1:{server.server_port} (memory only; simulated responses)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
