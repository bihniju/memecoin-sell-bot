import { Position, Quote, QuoteRequest } from "../types.js";

export interface QuoteProvider {
  getQuote(params: QuoteRequest): Promise<Quote>;
  quoteForPosition(position: Position, outputMint: string, sellPct: number, slippageBps: number): Promise<Quote>;
}

const parseBigInt = (value: unknown): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  if (typeof value === "string") return BigInt(value);
  return 0n;
};

const minimumAfterSlippage = (amount: bigint, slippageBps: number): bigint => {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.trunc(slippageBps))));
  return (amount * (10_000n - bps)) / 10_000n;
};

export class JupiterQuoteProvider implements QuoteProvider {
  constructor(private readonly endpoint: string, private readonly apiKey?: string) {}

  async getQuote(params: QuoteRequest): Promise<Quote> {
    if (params.amount <= 0n) throw new Error("Quote amount must be greater than zero");

    const query = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount.toString(),
      slippageBps: Math.max(0, Math.min(10_000, Math.trunc(params.slippageBps))).toString()
    });
    if (params.onlyDirectRoutes !== undefined) query.set("onlyDirectRoutes", String(params.onlyDirectRoutes));

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    let res: Response;
    try {
      res = await fetch(`${this.endpoint}?${query.toString()}`, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Jupiter quote failed: ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`);
    }

    const body = (await res.json()) as Record<string, unknown>;
    const outAmount = parseBigInt(body.outAmount);
    const routePlan = Array.isArray(body.routePlan) ? body.routePlan : undefined;
    const routeAvailable = outAmount > 0n && (routePlan === undefined || routePlan.length > 0);
    const priceImpactPct = Number(body.priceImpactPct ?? 0);

    return {
      provider: "jupiter",
      inAmount: parseBigInt(body.inAmount ?? params.amount),
      expectedOutAmount: outAmount,
      minimumOutAmount: minimumAfterSlippage(outAmount, params.slippageBps),
      priceImpactBps: Number.isFinite(priceImpactPct) ? Math.max(0, Math.round(priceImpactPct * 10_000)) : 0,
      routeAvailable,
      routeInfo: body,
      timestamp: Date.now()
    };
  }

  async quoteForPosition(position: Position, outputMint: string, sellPct: number, slippageBps: number): Promise<Quote> {
    const clamped = Math.max(0, Math.min(100, sellPct));
    const remainingFraction = position.remainingPercentage / 100;
    const sellFraction = clamped / 100;
    const amountRaw = BigInt(Math.floor(position.amount * remainingFraction * sellFraction));

    return this.getQuote({ inputMint: position.mint, outputMint, amount: amountRaw, slippageBps });
  }
}

export class SimulatedQuoteProvider implements QuoteProvider {
  constructor(private readonly slippageBps = 250) {}

  async getQuote(params: QuoteRequest): Promise<Quote> {
    const expectedOut = params.amount;
    const minOut = minimumAfterSlippage(expectedOut, this.slippageBps);
    return {
      provider: "simulated",
      inAmount: params.amount,
      expectedOutAmount: expectedOut,
      minimumOutAmount: minOut,
      priceImpactBps: this.slippageBps,
      routeAvailable: expectedOut > 0n,
      routeInfo: { simulated: true },
      timestamp: Date.now()
    };
  }

  async quoteForPosition(position: Position, outputMint: string, sellPct: number, slippageBps: number): Promise<Quote> {
    const clamped = Math.max(0, Math.min(100, sellPct));
    const amountRaw = BigInt(Math.floor(position.amount * (position.remainingPercentage / 100) * (clamped / 100)));
    const grossOut = Math.floor(Number(amountRaw) * position.currentPrice);
    const minOut = minimumAfterSlippage(BigInt(Math.max(0, grossOut)), slippageBps);

    return {
      provider: "simulated",
      inAmount: amountRaw,
      expectedOutAmount: BigInt(Math.max(0, grossOut)),
      minimumOutAmount: minOut,
      priceImpactBps: this.slippageBps,
      routeAvailable: grossOut > 0,
      routeInfo: { simulated: true, outputMint },
      timestamp: Date.now()
    };
  }
}
