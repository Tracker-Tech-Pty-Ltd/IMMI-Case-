/**
 * Shared blob-download helper.
 *
 * Three call sites previously inlined the same idiom, all of which built a
 * detached anchor and revoked the object URL in the same task as the click.
 * Neither is a reproduced failure on current Chromium / Firefox / WebKit —
 * this helper exists to remove the triplication and to stop relying on that
 * timing at all:
 *
 *   - the anchor is attached to the document before it is clicked, because a
 *     detached anchor is not clickable in every engine;
 *   - the object URL is revoked on a later macrotask, so the download is
 *     always started against a live URL.
 */
export const BLOB_URL_REVOKE_DELAY_MS = 1_000;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Bare setTimeout (not window.setTimeout) so Vitest fake timers can
    // deterministically advance it in the unit test.
    setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_DELAY_MS);
  }
}
