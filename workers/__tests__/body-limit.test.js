import { describe, expect, it } from "vitest";

import { readBoundedBodyText } from "../storage/body_limit.js";

function post(body) {
  return new Request("https://immi.example/x", { method: "POST", body });
}

describe("readBoundedBodyText", () => {
  it("returns the body text when under the limit", async () => {
    expect(await readBoundedBodyText(post('{"a":1}'), 1024)).toBe('{"a":1}');
  });

  it("rejects an oversize body even with no content-length header", async () => {
    const body = JSON.stringify({ blob: "x".repeat(2048) });
    const request = post(body);
    // Node's undici does not set content-length for a string body, which is
    // exactly the case the old header-based ceiling missed.
    expect(request.headers.get("content-length")).toBeNull();
    expect(await readBoundedBodyText(request, 1024)).toBeNull();
  });

  it("rejects an oversize chunked body", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("x".repeat(700)));
        controller.enqueue(encoder.encode("x".repeat(700)));
        controller.close();
      },
    });
    const request = new Request("https://immi.example/x", {
      method: "POST",
      body: stream,
      duplex: "half",
    });
    expect(await readBoundedBodyText(request, 1024)).toBeNull();
  });

  it("rejects when the declared content-length alone exceeds the limit", async () => {
    const request = new Request("https://immi.example/x", {
      method: "POST",
      headers: { "content-length": "999999" },
      body: '{"a":1}',
    });
    expect(await readBoundedBodyText(request, 1024)).toBeNull();
  });

  it("returns an empty string for a body-less request", async () => {
    const request = new Request("https://immi.example/x", { method: "POST" });
    expect(await readBoundedBodyText(request, 1024)).toBe("");
  });
});
