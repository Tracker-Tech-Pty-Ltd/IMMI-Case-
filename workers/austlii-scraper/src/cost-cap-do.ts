/**
 * Durable cost ledger for the extraction pipeline.
 *
 * WHY RESERVATIONS AND NOT JUST A COUNTER
 *
 * The true cost of an extraction batch is not known until the paid backend has
 * already answered. A ledger that only accumulates after the fact therefore
 * cannot refuse anything: it learns the price once the money is gone. That is
 * precisely how a run with $0.01 of headroom spent $0.10 — `remaining > 0` was
 * read as permission, the container was called, and only then was the ledger
 * told.
 *
 * So the caller must commit to an UPPER BOUND before spending, and this object
 * either grants that hold or refuses it. Afterwards the caller settles with the
 * real figure and the unused remainder returns to the budget.
 *
 * THREE PROPERTIES THE CALLER RELIES ON
 *
 * 1. Atomicity. A Durable Object serialises requests to one instance, so
 *    read-check-write here has no interleaving. This is the whole reason the
 *    cap lives in a DO rather than in KV (see the Firecrawl cap in discover.ts
 *    for what the non-atomic version costs).
 *
 * 2. Idempotency by `reservation_id`. Queue redelivery replays the identical
 *    id, and a replay must not hold or charge twice. Callers derive the id
 *    deterministically from the run and the batch, never randomly.
 *
 * 3. Durable debt. A reservation that is never settled or released STAYS HELD
 *    and keeps shrinking `remaining_usd`. A Worker that dies between the paid
 *    call and the settle therefore blocks the next batch instead of quietly
 *    losing the spend — fail-closed is the correct direction for money. An
 *    operator clears it deliberately with /release or /reset.
 */

interface Reservation {
  usd: number;
}

type ReservationMap = Record<string, Reservation>;

const SPENT_KEY = "spent_usd";
const RESERVATIONS_KEY = "reservations";

export class CostCapDO {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/remaining") {
      const cap = positiveNumber(url.searchParams.get("cap"), 5);
      const spent = await this.readSpent();
      const held = await this.readHeld();
      return Response.json({
        spent_usd: spent,
        held_usd: held,
        cap_usd: cap,
        remaining_usd: Math.max(0, cap - spent - held),
      });
    }

    if (url.pathname === "/reserve" && request.method === "POST") {
      return this.reserve(await readJsonBody(request));
    }

    if (url.pathname === "/settle" && request.method === "POST") {
      return this.settle(await readJsonBody(request));
    }

    if (url.pathname === "/release" && request.method === "POST") {
      return this.release(await readJsonBody(request));
    }

    if (url.pathname === "/charge" && request.method === "POST") {
      return this.charge(await readJsonBody(request));
    }

    if (url.pathname === "/reset" && request.method === "POST") {
      await this.state.storage.put(SPENT_KEY, 0);
      await this.state.storage.put(RESERVATIONS_KEY, {});
      return Response.json({ spent_usd: 0, held_usd: 0 });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }

  private async reserve(body: Record<string, unknown>): Promise<Response> {
    const id = reservationId(body.reservation_id);
    const usd = Number(body.usd);
    const cap = positiveNumber(body.cap, 5);

    // An anonymous hold could never be settled or released, so it would strand
    // budget forever. Refuse rather than create one.
    if (!id) {
      return Response.json({ ok: false, error: "reservation_id is required" }, { status: 400 });
    }
    if (!Number.isFinite(usd) || usd <= 0) {
      return Response.json({ ok: false, error: "usd must be a positive number" }, { status: 400 });
    }

    const reservations = await this.readReservations();
    const spent = await this.readSpent();

    // Replay of an id we already hold: report the existing hold unchanged.
    const existing = reservations[id];
    if (existing) {
      return Response.json({
        ok: true,
        replayed: true,
        reserved_usd: existing.usd,
        remaining_usd: Math.max(0, cap - spent - sumHeld(reservations)),
      });
    }

    const held = sumHeld(reservations);
    const remaining = cap - spent - held;
    if (usd > remaining) {
      return Response.json({
        ok: false,
        error: "cost cap would be exceeded",
        requested_usd: usd,
        spent_usd: spent,
        held_usd: held,
        cap_usd: cap,
        remaining_usd: Math.max(0, remaining),
      });
    }

    reservations[id] = { usd };
    await this.state.storage.put(RESERVATIONS_KEY, reservations);
    return Response.json({
      ok: true,
      replayed: false,
      reserved_usd: usd,
      remaining_usd: Math.max(0, remaining - usd),
    });
  }

  private async settle(body: Record<string, unknown>): Promise<Response> {
    const id = reservationId(body.reservation_id);
    const usd = Number(body.usd);
    if (!id) {
      return Response.json({ ok: false, error: "reservation_id is required" }, { status: 400 });
    }
    const actual = Number.isFinite(usd) && usd >= 0 ? usd : 0;

    const reservations = await this.readReservations();
    const held = reservations[id];
    if (!held) {
      // Already settled (or released). Deliberately NOT an error and
      // deliberately NOT a charge: a redelivered settle must be a no-op, or
      // every retry would bill the run again.
      return Response.json({ ok: true, already_settled: true, spent_usd: await this.readSpent() });
    }

    // The real cost is authoritative even when it overshot the hold — the money
    // is spent either way, and under-recording it would let the next batch
    // reserve headroom that no longer exists.
    const spent = (await this.readSpent()) + actual;
    delete reservations[id];
    await this.state.storage.put(SPENT_KEY, spent);
    await this.state.storage.put(RESERVATIONS_KEY, reservations);
    return Response.json({ ok: true, already_settled: false, spent_usd: spent, released_usd: Math.max(0, held.usd - actual) });
  }

  private async release(body: Record<string, unknown>): Promise<Response> {
    const id = reservationId(body.reservation_id);
    if (!id) {
      return Response.json({ ok: false, error: "reservation_id is required" }, { status: 400 });
    }
    const reservations = await this.readReservations();
    const existed = Boolean(reservations[id]);
    delete reservations[id];
    await this.state.storage.put(RESERVATIONS_KEY, reservations);
    return Response.json({ ok: true, released: existed });
  }

  /**
   * Legacy post-hoc charge. Kept so an older caller cannot silently no-op, but
   * it now REPORTS when it pushes spend past the cap instead of accumulating in
   * silence. Prefer /reserve + /settle: this path still cannot refuse anything,
   * because by the time it is called the money is already gone.
   */
  private async charge(body: Record<string, unknown>): Promise<Response> {
    const usd = positiveNumber(body.usd, 0);
    const cap = positiveNumber(body.cap, 5);
    const spent = (await this.readSpent()) + usd;
    await this.state.storage.put(SPENT_KEY, spent);
    const held = await this.readHeld();
    return Response.json({
      spent_usd: spent,
      held_usd: held,
      cap_usd: cap,
      over_cap: spent + held > cap,
      remaining_usd: Math.max(0, cap - spent - held),
    });
  }

  private async readSpent(): Promise<number> {
    const value = await this.state.storage.get<number>(SPENT_KEY);
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  private async readReservations(): Promise<ReservationMap> {
    const value = await this.state.storage.get<ReservationMap>(RESERVATIONS_KEY);
    if (!value || typeof value !== "object") return {};
    const out: ReservationMap = {};
    for (const [key, entry] of Object.entries(value)) {
      const usd = Number((entry as Reservation)?.usd);
      if (Number.isFinite(usd) && usd > 0) out[key] = { usd };
    }
    return out;
  }

  private async readHeld(): Promise<number> {
    return sumHeld(await this.readReservations());
  }
}

function sumHeld(reservations: ReservationMap): number {
  return Object.values(reservations).reduce((total, entry) => total + entry.usd, 0);
}

function reservationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256) return null;
  return trimmed;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
