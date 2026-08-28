/**
 * auth-nonce.test.js
 *
 * Verifies that workers/auth/nonce_do.js `checkNonce` reads the env binding
 * by the SAME name declared in wrangler.toml (`AUTH_NONCE`). Prevents a
 * regression where wrangler.toml drifts to a different binding name
 * (e.g. "AUTH_NONCE_DO") while code keeps reading `env.AUTH_NONCE`, which
 * fail-closes every Telegram login (auth.fail.config / "replay detected").
 *
 * NOTE: the Durable Object class itself is exercised end-to-end against the
 * Workers runtime in integration; this file just pins the helper's binding
 * lookup so the contract is captured at unit level.
 */

import { describe, it, expect, vi } from "vitest";
import { AuthNonce, checkNonce } from "../auth/nonce_do.js";

/** Fake Durable Object storage for exercising AuthNonce.fetch()/alarm() directly. */
function fakeState(initial = new Map()) {
  let alarm = null;
  const storage = {
    _map: initial,
    async get(key) { return initial.get(key); },
    async put(key, value) { initial.set(key, value); },
    async list() { return new Map(initial); },
    async delete(keys) { for (const k of [].concat(keys)) initial.delete(k); },
    async getAlarm() { return alarm; },
    async setAlarm(when) { alarm = when; },
    get _alarm() { return alarm; },
  };
  return { storage };
}

/**
 * Build a fake DurableObjectNamespace whose stub.fetch() returns the given
 * { fresh: boolean } JSON envelope. The spies on idFromName/get let us
 * assert that checkNonce really did go through the binding under test.
 */
function makeNamespace(fresh) {
  const stub = {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ fresh }), {
        headers: { "Content-Type": "application/json" },
      }),
    ),
  };
  return {
    idFromName: vi.fn().mockReturnValue("global-id-1"),
    get: vi.fn().mockReturnValue(stub),
    _stub: stub,
  };
}

describe("checkNonce — env binding name wiring", () => {
  it("fail-closes as unavailable when env.AUTH_NONCE is missing", async () => {
    // Still a deny — but a misconfigured binding is our outage, not the
    // caller replaying, and the handler turns "unavailable" into 503 rather
    // than sending the user to re-authenticate against a broken login.
    expect(await checkNonce({}, "abc123hash")).toEqual({
      fresh: false,
      reason: "unavailable",
    });
  });

  it("fail-closes when env is null/undefined", async () => {
    expect(await checkNonce(null, "abc")).toMatchObject({ fresh: false, reason: "unavailable" });
    expect(await checkNonce(undefined, "abc")).toMatchObject({ fresh: false, reason: "unavailable" });
  });

  it("reads specifically env.AUTH_NONCE (not legacy AUTH_NONCE_DO)", async () => {
    // Regression: wrangler.toml previously named the binding AUTH_NONCE_DO
    // while nonce_do.js read env.AUTH_NONCE — checkNonce silently fail-closed
    // on every Telegram login. Pin the binding name contract here.
    const wrongBinding = makeNamespace(true);
    const ok = await checkNonce({ AUTH_NONCE_DO: wrongBinding }, "abc123hash");
    expect(ok).toMatchObject({ fresh: false, reason: "unavailable" });
    expect(wrongBinding.idFromName).not.toHaveBeenCalled();
  });

  it("returns true when env.AUTH_NONCE is bound and DO returns fresh=true", async () => {
    const ns = makeNamespace(true);
    const ok = await checkNonce({ AUTH_NONCE: ns }, "abc123hash");

    expect(ok).toMatchObject({ fresh: true });
    // Verify the helper actually used the binding (i.e. did not fail-close
    // on a config check before getting to the DO call).
    expect(ns.idFromName).toHaveBeenCalledWith("global");
    expect(ns.get).toHaveBeenCalledWith(
      "global-id-1",
      expect.objectContaining({ locationHint: "oc" }),
    );
    expect(ns._stub.fetch).toHaveBeenCalledOnce();

    // The body sent to the DO must include the hash so the DO can dedupe.
    const fetchCall = ns._stub.fetch.mock.calls[0];
    const init = fetchCall[1];
    const body = JSON.parse(init.body);
    expect(body.hash).toBe("abc123hash");
  });

  it("returns false (replay) when DO returns fresh=false", async () => {
    const ns = makeNamespace(false);
    const ok = await checkNonce({ AUTH_NONCE: ns }, "abc123hash");
    // Reached the DO and was told "seen before": the one case that is
    // genuinely the caller's fault, and the only one that may 401.
    expect(ok).toEqual({ fresh: false, reason: "replay" });
    expect(ns._stub.fetch).toHaveBeenCalledOnce();
  });

  it("fail-closes when the DO call throws", async () => {
    const ns = {
      idFromName: vi.fn().mockReturnValue("id"),
      get: vi.fn().mockImplementation(() => {
        throw new Error("simulated DO error");
      }),
    };
    const ok = await checkNonce({ AUTH_NONCE: ns }, "abc123hash");
    // An unreachable DO is an outage, not a replay.
    expect(ok).toEqual({ fresh: false, reason: "unavailable" });
  });
});

describe("AuthNonce storage pruning", () => {
  it("persists a nonce without an options argument (expirationTtl is a no-op KV option)", async () => {
    const { storage } = fakeState();
    const putSpy = vi.spyOn(storage, "put");
    const nonce = new AuthNonce({ storage }, {});
    await nonce.fetch(new Request("https://internal/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash: "hash-1" }),
    }));
    expect(putSpy).toHaveBeenCalledOnce();
    expect(putSpy.mock.calls[0]).toHaveLength(2);
  });

  it("schedules an alarm on first write when none exists", async () => {
    const { storage } = fakeState();
    const nonce = new AuthNonce({ storage }, {});
    expect(await storage.getAlarm()).toBeNull();
    await nonce.fetch(new Request("https://internal/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hash: "hash-1" }),
    }));
    expect(typeof (await storage.getAlarm())).toBe("number");
  });

  it("alarm() deletes entries older than one hour and keeps fresh ones", async () => {
    const now = Date.now();
    const { storage } = fakeState(new Map([
      ["old", now - 7_200_000],
      ["fresh", now],
    ]));
    const nonce = new AuthNonce({ storage }, {});
    await nonce.alarm();
    const remaining = await storage.list();
    expect([...remaining.keys()]).toEqual(["fresh"]);
  });

  it("re-arms only while entries remain", async () => {
    const now = Date.now();
    const { storage: storageWithFresh } = fakeState(new Map([["fresh", now]]));
    const nonceWithFresh = new AuthNonce({ storage: storageWithFresh }, {});
    await nonceWithFresh.alarm();
    expect(typeof (await storageWithFresh.getAlarm())).toBe("number");

    const { storage: storageAllExpired } = fakeState(new Map([["old", now - 7_200_000]]));
    const nonceAllExpired = new AuthNonce({ storage: storageAllExpired }, {});
    await nonceAllExpired.alarm();
    expect(await storageAllExpired.getAlarm()).toBeNull();
  });
});
