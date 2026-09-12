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

export class JupiterQuoteProvider implements QuoteProvider {
  constructor(private readonly endpoint: string) {}

  async getQuote(params: QuoteRequest): Promise<Quote> {
    const query = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amount.toString(),
      slippageBps: params.slippageBps.toString(),
      onlyDirectRoutes: params.onlyDirectRoutes ? "true" : "false"
    });

    const res = await fetch(`${this.endpoint}?${query.toString()}`);
    if (!res.ok) {
      throw new Error(`Quote request failed: ${res.status}`);
    }

    const body = (await res.json()) as Record<string, unknown>;

    const outAmount = parseBigInt(body.outAmount);
    const routeAvailable = Boolean(body.routePlan || body.marketInfos) && outAmount > 0n;
    const slippagePct = Number(params.slippageBps) / 10_000;
    const minimumOutAmount = outAmount > 0n ? BigInt(Math.floor(Number(outAmount) * (1 - slippagePct))) : 0n;

    return {
      provider: "jupiter",
      inAmount: parseBigInt(body.inAmount ?? params.amount),
      expectedOutAmount: outAmount,
      minimumOutAmount,
      priceImpactBps: Math.round(Number(body.priceImpactPct ?? 0) * 10_000),
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

    return this.getQuote({
      inputMint: position.mint,
      outputMint,
      amount: amountRaw,
      slippageBps
    });
  }
}

export class SimulatedQuoteProvider implements QuoteProvider {
  constructor(private readonly slippageBps = 250) {}

  async getQuote(params: QuoteRequest): Promise<Quote> {
    const expectedOut = params.amount;
    const minOut = BigInt(Math.floor(Number(expectedOut) * (1 - this.slippageBps / 10_000)));

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
    const _ = outputMint;
    const clamped = Math.max(0, Math.min(100, sellPct));
    const amountRaw = BigInt(Math.floor(position.amount * (position.remainingPercentage / 100) * (clamped / 100)));
    const grossOut = Math.floor(Number(amountRaw) * position.currentPrice);
    const minOut = BigInt(Math.floor(grossOut * (1 - slippageBps / 10_000)));

    return {
      provider: "simulated",
      inAmount: amountRaw,
      expectedOutAmount: BigInt(grossOut),
      minimumOutAmount: minOut,
      priceImpactBps: this.slippageBps,
      routeAvailable: grossOut > 0,
      routeInfo: { simulated: true, outputMint },
      timestamp: Date.now()
    };
  }
}
