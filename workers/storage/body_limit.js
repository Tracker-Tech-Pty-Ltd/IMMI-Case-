/**
 * Bounded request-body reader.
 *
 * The three readJson helpers in the Worker used to enforce their ceilings by
 * reading the content-length header. A chunked or HTTP/2 client simply omits
 * that header, `Number(null || "0")` is 0, every ceiling passes, and
 * `request.json()` then buffers the whole body into isolate memory. This reads
 * the body as a stream and aborts the moment the byte count exceeds the limit,
 * so the ceiling holds regardless of what the client declares.
 */

/**
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Promise<string | null>} the body text, or null when it exceeds
 *   maxBytes or cannot be read.
 */
export async function readBoundedBodyText(request, maxBytes) {
  // Fast reject when the client is honest about an oversize body.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const body = request.body;
  if (!body) {
    try {
      return await request.text();
    } catch {
      return null;
    }
  }

  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      /* already errored */
    }
    return null;
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
