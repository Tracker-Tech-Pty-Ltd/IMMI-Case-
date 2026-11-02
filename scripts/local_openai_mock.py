"""Local-only fixed responses for the OpenAI Chat Completions subset.

This development helper never contacts a model or writes request contents.
It is deliberately not a production API, authentication service, or legal tool.
"""

from __future__ import annotations

import argparse
import json
import socket
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BODY_BYTES = 1_048_576
SAMPLE_TEXT = (
    "[SIMULATED EXAMPLE — NOT A REAL MODEL RESPONSE]\n\n"
    "This fixed response is for local interface testing only. "
    "It does not analyse a real case. Check any important information "
    "against original sources and obtain appropriate advice.\n\n"
    "【模擬示範】先整理通知與相關文件，再核對官方原始來源。"
)
SAMPLE_MODERATOR = {
    "ranking": [],
    "model_critiques": [],
    "vote_summary": {"winner_provider_key": "", "winner_reason": "", "support_count": 0, "neutral_count": 0, "oppose_count": 0},
    "agreement_points": ["Simulated example only; no real opinions were reviewed."],
    "conflict_points": [],
    "provider_law_sections": {},
    "shared_law_sections": [],
    "consensus": "Simulated example; no real consensus was assessed.",
    "disagreements": "No actual opinions were compared.",
    "outcome_likelihood_percent": None,
    "outcome_likelihood_label": "unknown",
    "outcome_likelihood_reason": "No outcome estimate is available in this simulated example.",
    "law_sections": [],
    "mock_judgment": "",
    "composed_answer": SAMPLE_TEXT,
    "follow_up_questions": ["What original documents should I check?"],
}


class MockHandler(BaseHTTPRequestHandler):
    # Do not log URLs, headers, bodies, or credentials supplied by a client.
    def log_message(self, _format: str, *args: object) -> None:
        return

    def send_json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        self.close_connection = True

    def error_response(self, status: int, message: str) -> None:
        self.send_json(status, {"error": {"message": message, "type": "invalid_request_error", "param": None, "code": None}})

    def do_POST(self) -> None:
        if self.path != "/v1/chat/completions":
            self.error_response(404, "Only /v1/chat/completions is supported by this local mock.")
            return
        if self.headers.get("Transfer-Encoding"):
            self.error_response(400, "Transfer-Encoding is not supported.")
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.error_response(411, "A valid Content-Length is required.")
            return
        if length < 1 or length > MAX_BODY_BYTES:
            self.error_response(413, "Request body must be between 1 byte and 1 MiB.")
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeError):
            self.error_response(400, "Request body must be UTF-8 JSON.")
            return
        if not isinstance(payload, dict):
            self.error_response(400, "Request body must be a JSON object.")
            return
        model, messages, stream = payload.get("model"), payload.get("messages"), payload.get("stream", False)
        if not isinstance(model, str) or not model.strip() or len(model) > 200:
            self.error_response(400, "model must be a non-empty string of at most 200 characters.")
            return
        if not isinstance(messages, list) or not messages or not all(
            isinstance(m, dict) and isinstance(m.get("role"), str) and isinstance(m.get("content"), str)
            for m in messages
        ):
            self.error_response(400, "messages must be a non-empty array of role/content strings.")
            return
        if not isinstance(stream, bool):
            self.error_response(400, "stream must be a boolean.")
            return
        response_format = payload.get("response_format", {"type": "text"})
        if not isinstance(response_format, dict) or response_format.get("type") not in ("text", "json_object"):
            self.error_response(400, "response_format supports text or json_object only.")
            return
        if payload.get("stream_options") is not None:
            self.error_response(400, "stream_options is not supported by this mock.")
            return
        is_json = response_format["type"] == "json_object" or (
            model.startswith("google-ai-studio/") and "flash" in model.lower()
        )
        content = json.dumps(SAMPLE_MODERATOR, ensure_ascii=False) if is_json else SAMPLE_TEXT
        response_id = "chatcmpl-local-" + uuid.uuid4().hex
        created = int(time.time())
        if not stream:
            self.send_json(200, {
                "id": response_id, "object": "chat.completion", "created": created, "model": model,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": content, "refusal": None}, "finish_reason": "stop", "logprobs": None}],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            })
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        base = {"id": response_id, "object": "chat.completion.chunk", "created": created, "model": model}
        parts = [{"role": "assistant", "content": ""}]
        parts.extend({"content": content[i : i + 48]} for i in range(0, len(content), 48))
        parts.append({})
        try:
            for index, delta in enumerate(parts):
                chunk = {**base, "choices": [{"index": 0, "delta": delta, "finish_reason": "stop" if index == len(parts) - 1 else None, "logprobs": None}]}
                self.wfile.write(("data: " + json.dumps(chunk, ensure_ascii=False) + "\n\n").encode("utf-8"))
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True


class LocalMockServer(ThreadingHTTPServer):
    """Prevent another local process from sharing this service's port."""

    allow_reuse_address = False

    def server_bind(self) -> None:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local-only OpenAI-format demo server.")
    parser.add_argument("--port", type=int, default=8766, help="Local port (default: 8766; 0 chooses an available port)")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    with LocalMockServer(("127.0.0.1", args.port), MockHandler) as server:
        print(f"SIMULATED local API: http://127.0.0.1:{server.server_port}/v1/chat/completions", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
