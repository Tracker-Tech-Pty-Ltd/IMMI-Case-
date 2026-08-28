import { beforeEach, describe, expect, it } from "vitest";

import { CostCapDO } from "../cost-cap-do";

/**
 * Minimal DurableObjectState double: only `storage.get`/`storage.put`, which is
 * the entire surface CostCapDO uses. Backed by a Map so a test can drive several
 * requests against one durable instance and observe the accumulated state — the
 * property every assertion here depends on.
 */
function fakeState() {
  const map = new Map<string, unknown>();
  return {
    storage: {
      get: async (key: string) => map.get(key),
      put: async (key: string, value: unknown) => { map.set(key, value); },
      delete: async (key: string) => { map.delete(key); },
    },
    _map: map,
  };
}

function makeDO() {
  return new CostCapDO(fakeState() as never);
}

const CAP = 5;

function remaining(cap = CAP) {
  return new Request(`https://cost/remaining?cap=${cap}`);
}

function reserve(body: Record<string, unknown>) {
  return new Request("https://cost/reserve", { method: "POST", body: JSON.stringify(body) });
}

function settle(body: Record<string, unknown>) {
  return new Request("https://cost/settle", { method: "POST", body: JSON.stringify(body) });
}

function release(body: Record<string, unknown>) {
  return new Request("https://cost/release", { method: "POST", body: JSON.stringify(body) });
}

describe("CostCapDO reservations make the cap refuse", () => {
  let cap: CostCapDO;
  beforeEach(() => { cap = makeDO(); });

  // The defect: extract.ts treated ANY remaining > 0 as go, so a run with $0.01
  // left happily spent $0.10. A reservation is the only way to decide before the
  // money is committed, because the true cost is not known until after the call.
  it("refuses a reservation that would exceed the cap", async () => {
    await cap.fetch(settle({ reservation_id: "seed", usd: 4.99 }));
    // seed had no reservation, so it must not have moved `spent` — settle only
    // converts a held reservation. Spend it the supported way instead:
    await cap.fetch(reserve({ reservation_id: "r0", usd: 4.99, cap: CAP }));
    await cap.fetch(settle({ reservation_id: "r0", usd: 4.99 }));

    const response = await cap.fetch(reserve({ reservation_id: "r1", usd: 0.1, cap: CAP }));
    const body = await response.json<{ ok: boolean; remaining_usd: number }>();
    expect(body.ok).toBe(false);
    expect(body.remaining_usd).toBeCloseTo(0.01, 6);
  });

  it("grants a reservation that fits exactly", async () => {
    const response = await cap.fetch(reserve({ reservation_id: "r1", usd: CAP, cap: CAP }));
    expect((await response.json<{ ok: boolean }>()).ok).toBe(true);
  });

  it("counts held reservations against remaining, so two runs cannot both fit", async () => {
    await cap.fetch(reserve({ reservation_id: "run-a", usd: 3, cap: CAP }));
    const second = await cap.fetch(reserve({ reservation_id: "run-b", usd: 3, cap: CAP }));
    expect((await second.json<{ ok: boolean }>()).ok).toBe(false);

    const view = await (await cap.fetch(remaining())).json<{ remaining_usd: number }>();
    expect(view.remaining_usd).toBeCloseTo(2, 6);
  });

  // Redelivery replays the identical reservation id. It must be a no-op, not a
  // second hold that eats the budget twice.
  it("is idempotent: replaying a reservation id does not double-hold", async () => {
    await cap.fetch(reserve({ reservation_id: "same", usd: 3, cap: CAP }));
    const replay = await cap.fetch(reserve({ reservation_id: "same", usd: 3, cap: CAP }));
    expect((await replay.json<{ ok: boolean }>()).ok).toBe(true);

    const view = await (await cap.fetch(remaining())).json<{ remaining_usd: number }>();
    expect(view.remaining_usd).toBeCloseTo(2, 6);
  });

  it("is idempotent: replaying a settle does not charge twice", async () => {
    await cap.fetch(reserve({ reservation_id: "r1", usd: 1, cap: CAP }));
    await cap.fetch(settle({ reservation_id: "r1", usd: 0.4 }));
    const replay = await cap.fetch(settle({ reservation_id: "r1", usd: 0.4 }));
    expect((await replay.json<{ ok: boolean }>()).ok).toBe(true);

    const view = await (await cap.fetch(remaining())).json<{ spent_usd: number; remaining_usd: number }>();
    expect(view.spent_usd).toBeCloseTo(0.4, 6);
    // the unused 0.6 of the hold is returned, not stranded
    expect(view.remaining_usd).toBeCloseTo(4.6, 6);
  });

  it("releases an unused reservation back to the budget", async () => {
    await cap.fetch(reserve({ reservation_id: "r1", usd: 2, cap: CAP }));
    await cap.fetch(release({ reservation_id: "r1" }));
    const view = await (await cap.fetch(remaining())).json<{ remaining_usd: number }>();
    expect(view.remaining_usd).toBeCloseTo(CAP, 6);
  });

  // This is the durable-debt property. A settle that never lands leaves the hold
  // in place, and the hold is what stops the next batch from spending money the
  // ledger cannot account for.
  it("keeps an unsettled reservation held, shrinking remaining until it is reconciled", async () => {
    await cap.fetch(reserve({ reservation_id: "stuck", usd: 4.5, cap: CAP }));
    // no settle, no release — simulating a Worker that died mid-flight
    const view = await (await cap.fetch(remaining())).json<{ remaining_usd: number; held_usd: number }>();
    expect(view.held_usd).toBeCloseTo(4.5, 6);
    expect(view.remaining_usd).toBeCloseTo(0.5, 6);

    const blocked = await cap.fetch(reserve({ reservation_id: "next", usd: 1, cap: CAP }));
    expect((await blocked.json<{ ok: boolean }>()).ok).toBe(false);
  });

  // /charge is the pre-reservation entry point. Anything still calling it must
  // not be able to push spend past the cap without saying so.
  it("reports an over-cap charge instead of silently accumulating", async () => {
    const response = await cap.fetch(new Request("https://cost/charge", {
      method: "POST",
      body: JSON.stringify({ usd: 9, cap: CAP }),
    }));
    const body = await response.json<{ spent_usd: number; over_cap: boolean }>();
    expect(body.spent_usd).toBeCloseTo(9, 6);
    expect(body.over_cap).toBe(true);
  });

  it("rejects a reservation with a non-positive or malformed amount", async () => {
    const zero = await cap.fetch(reserve({ reservation_id: "z", usd: 0, cap: CAP }));
    expect((await zero.json<{ ok: boolean }>()).ok).toBe(false);
    const junk = await cap.fetch(reserve({ reservation_id: "j", usd: "abc", cap: CAP }));
    expect((await junk.json<{ ok: boolean }>()).ok).toBe(false);
  });

  it("rejects a reservation with no id, so an anonymous hold can never be settled", async () => {
    const response = await cap.fetch(reserve({ usd: 1, cap: CAP }));
    expect((await response.json<{ ok: boolean }>()).ok).toBe(false);
  });
});
