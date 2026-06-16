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
      return Response.json({ spent_usd: spent, cap_usd: cap, remaining_usd: Math.max(0, cap - spent) });
    }

    if (url.pathname === "/charge" && request.method === "POST") {
      const body = await request.json().catch(() => ({})) as { usd?: number };
      const usd = positiveNumber(body.usd, 0);
      const spent = await this.readSpent();
      const next = spent + usd;
      await this.state.storage.put("spent_usd", next);
      return Response.json({ spent_usd: next });
    }

    if (url.pathname === "/reset" && request.method === "POST") {
      await this.state.storage.put("spent_usd", 0);
      return Response.json({ spent_usd: 0 });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }

  private async readSpent(): Promise<number> {
    const value = await this.state.storage.get<number>("spent_usd");
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
}

function positiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
