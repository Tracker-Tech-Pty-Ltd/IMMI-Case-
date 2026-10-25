/** Refresh cookies are shared by every same-origin tab. Only the holder of
 * this browser-wide lock may consume one; a per-React-tree promise is not a
 * cross-tab lock. Unsupported or denied locks fail closed. */
const AUTH_COOKIE_LOCK = "immi:auth:cookie-mutation";
const ROTATION_STORAGE_KEY = "immi:auth:pending-rotation";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTH_REQUEST_TIMEOUT_MS = 20_000;

/** Keep the timeout alive through body consumption: releasing it when only
 * headers arrive would let a stalled JSON body hold every tab's auth lock. */
export async function fetchAuthJson<T>(
  url: string,
  options: RequestInit,
): Promise<{ response: Response; data: T | null }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Authentication request timed out. Please try again."));
    }, AUTH_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...options, signal: controller.signal });
        const data: T | null = await response.json().catch((error: unknown) => {
          if (controller.signal.aborted) throw error;
          return null;
        });
        return { response, data };
      })(),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withAuthCookieLock<T>(operation: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) {
    throw new Error("Secure session coordination is unavailable. Please try again in a supported browser.");
  }
  return navigator.locks.request(AUTH_COOKIE_LOCK, { mode: "exclusive" }, operation);
}

/** Store only an idempotency UUID, never a credential. If a response is lost
 * after the server committed, the next tab must retry that SAME rotation. */
export function getSharedRefreshRotationId(proposedId: string): string {
  try {
    if (!UUID_RE.test(proposedId)) throw new Error("Invalid rotation id");
    const pending = window.localStorage.getItem(ROTATION_STORAGE_KEY);
    if (pending && UUID_RE.test(pending)) return pending;
    window.localStorage.setItem(ROTATION_STORAGE_KEY, proposedId);
    if (window.localStorage.getItem(ROTATION_STORAGE_KEY) !== proposedId) {
      throw new Error("Rotation id was not persisted");
    }
    return proposedId;
  } catch {
    // Continuing with a tab-local id could revoke another tab's session.
    throw new Error("Session coordination storage is unavailable. Please try again.");
  }
}

export function clearSharedRefreshRotationId(): void {
  try {
    window.localStorage.removeItem(ROTATION_STORAGE_KEY);
  } catch {
    // A retained UUID is safe: the server derives its successor from both
    // this UUID and the presented refresh jti, which changes after success.
  }
}
