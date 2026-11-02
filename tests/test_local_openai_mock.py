"""Exercise the local mock through actual loopback HTTP requests."""

import http.client
import json
import threading

import pytest

from scripts.local_openai_mock import MockHandler, SAMPLE_TEXT, ThreadingHTTPServer


@pytest.fixture
def mock_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        assert not thread.is_alive()


def request(server, payload, path="/v1/chat/completions", headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
    body = json.dumps(payload).encode()
    conn.request("POST", path, body=body, headers={"Content-Type": "application/json", **(headers or {})})
    response = conn.getresponse()
    data = response.read()
    status, content_type = response.status, response.getheader("Content-Type")
    conn.close()
    return status, content_type, data.decode()


def test_normal_response_is_fixed_openai_shape_and_never_echoes_input(mock_server):
    payload = {"model": "openai/demo", "messages": [{"role": "user", "content": "private-test-input"}]}
    status, content_type, data = request(mock_server, payload, headers={"Authorization": "Bearer private-test-token"})
    response = json.loads(data)
    assert status == 200
    assert content_type.startswith("application/json")
    assert response["object"] == "chat.completion"
    assert response["model"] == payload["model"]
    assert response["choices"][0]["message"] == {"role": "assistant", "content": SAMPLE_TEXT, "refusal": None}
    assert response["choices"][0]["finish_reason"] == "stop"
    assert "private-test-input" not in data and "private-test-token" not in data
    assert "SIMULATED" in response["choices"][0]["message"]["content"]


def test_sse_stream_reassembles_the_same_content(mock_server):
    status, content_type, body = request(mock_server, {
        "model": "openai/demo", "messages": [{"role": "user", "content": "test"}], "stream": True,
    })
    assert status == 200 and content_type.startswith("text/event-stream")
    events = [event.removeprefix("data: ") for event in body.strip().split("\n\n")]
    assert events[-1] == "[DONE]"
    chunks = [json.loads(event) for event in events[:-1]]
    assert all(chunk["object"] == "chat.completion.chunk" for chunk in chunks)
    assert chunks[0]["choices"][0]["delta"]["role"] == "assistant"
    assert chunks[-1]["choices"][0]["finish_reason"] == "stop"
    assert "".join(chunk["choices"][0]["delta"].get("content", "") for chunk in chunks) == SAMPLE_TEXT


@pytest.mark.parametrize("model,response_format", [
    ("openai/demo", {"type": "json_object"}),
    ("google-ai-studio/gemini-2.5-flash", {"type": "text"}),
])
def test_moderator_sample_is_json_without_a_prediction(mock_server, model, response_format):
    status, _, data = request(mock_server, {
        "model": model, "messages": [{"role": "user", "content": "test"}], "response_format": response_format,
    })
    sample = json.loads(json.loads(data)["choices"][0]["message"]["content"])
    assert status == 200
    assert "SIMULATED" in sample["composed_answer"]
    assert sample["outcome_likelihood_percent"] is None
    assert sample["law_sections"] == []


def test_streamed_moderator_json_can_be_reassembled(mock_server):
    status, _, body = request(mock_server, {
        "model": "google-ai-studio/gemini-2.5-flash",
        "messages": [{"role": "user", "content": "test"}],
        "stream": True,
    })
    events = [event.removeprefix("data: ") for event in body.strip().split("\n\n")]
    assert status == 200 and events[-1] == "[DONE]"
    chunks = (json.loads(event) for event in events[:-1])
    text = "".join(chunk["choices"][0]["delta"].get("content", "") for chunk in chunks)
    assert json.loads(text)["outcome_likelihood_percent"] is None


@pytest.mark.parametrize("payload", [
    {},
    {"model": "demo", "messages": []},
    {"model": "demo", "messages": [{"role": "user", "content": "x"}], "stream": "yes"},
    {"model": "demo", "messages": [{"role": "user", "content": "x"}], "response_format": {"type": "json_schema"}},
    {"model": "demo", "messages": [{"role": "user", "content": "x"}], "stream_options": {"include_usage": True}},
])
def test_invalid_or_unsupported_inputs_fail_explicitly(mock_server, payload):
    status, _, data = request(mock_server, payload)
    assert status == 400
    assert json.loads(data)["error"]["type"] == "invalid_request_error"


def test_unknown_path_does_not_become_an_open_proxy(mock_server):
    status, _, _ = request(mock_server, {}, path="/v1/responses")
    assert status == 404


def test_oversized_request_is_rejected(mock_server):
    conn = http.client.HTTPConnection("127.0.0.1", mock_server.server_port, timeout=3)
    # Verify rejection from the declared size before sending a large body.
    # Closing with unread body bytes can reset the connection on Windows.
    conn.putrequest("POST", "/v1/chat/completions")
    conn.putheader("Content-Length", "1048577")
    conn.endheaders()
    response = conn.getresponse()
    assert response.status == 413
    response.read()
    conn.close()
