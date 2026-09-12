import { Position, Quote, QuoteRequest } from "../types.js";

export interface QuoteProvider {
  getQuote(params: QuoteRequest): Promise<Quote>;
  quoteForPosition(position: Position, outputMint: string, sellPct: number, slippageBps: number): Promise<Quote>;
}

const parseBigInt = (value: unknown): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
};
const minimumAfterSlippage = (amount: bigint, slippageBps: number): bigint => {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.trunc(slippageBps))));
  return (amount * (10_000n - bps)) / 10_000n;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class JupiterQuoteProvider implements QuoteProvider {
  private readonly cache = new Map<string, { quote: Quote; expiresAt: number }>();
  constructor(private readonly endpoint: string, private readonly apiKey?: string, private readonly options: { timeoutMs?: number; retries?: number; cacheMs?: number } = {}) {}

  async getQuote(params: QuoteRequest): Promise<Quote> {
    if (params.amount <= 0n) throw new Error("Quote amount must be greater than zero");
    const query = new URLSearchParams({ inputMint: params.inputMint, outputMint: params.outputMint, amount: params.amount.toString(), slippageBps: Math.max(0, Math.min(10_000, Math.trunc(params.slippageBps))).toString() });
    if (params.onlyDirectRoutes !== undefined) query.set("onlyDirectRoutes", String(params.onlyDirectRoutes));
    const key = query.toString();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.quote;

    const attempts = Math.max(1, Math.trunc(this.options.retries ?? 2) + 1);
    const timeoutMs = Math.max(250, this.options.timeoutMs ?? 900);
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (this.apiKey) headers["x-api-key"] = this.apiKey;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try { res = await fetch(`${this.endpoint}?${key}`, { headers, signal: controller.signal }); } finally { clearTimeout(timeout); }
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          if (res.status < 500 && res.status !== 429) throw new Error(`Jupiter quote failed: ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`);
          throw new Error(`Jupiter quote transient failure: ${res.status}`);
        }
        const body = (await res.json()) as Record<string, unknown>;
        const outAmount = parseBigInt(body.outAmount);
        const routePlan = Array.isArray(body.routePlan) ? body.routePlan : undefined;
        const routeAvailable = outAmount > 0n && (routePlan === undefined || routePlan.length > 0);
        const priceImpactPct = Number(body.priceImpactPct ?? 0);
        const quote: Quote = {
          provider: "jupiter",
          inAmount: parseBigInt(body.inAmount ?? params.amount),
          expectedOutAmount: outAmount,
          minimumOutAmount: minimumAfterSlippage(outAmount, params.slippageBps),
          priceImpactBps: Number.isFinite(priceImpactPct) ? Math.max(0, Math.round(priceImpactPct * 10_000)) : 0,
          routeAvailable,
          routeInfo: body,
          timestamp: Date.now()
        };
        this.cache.set(key, { quote, expiresAt: Date.now() + Math.max(0, this.options.cacheMs ?? 100) });
        return quote;
      } catch (error) {
        lastError = error;
        if (attempt + 1 < attempts) await sleep(Math.min(100, 25 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async quoteForPosition(position: Position, outputMint: string, sellPct: number, slippageBps: number): Promise<Quote> {
    const clamped = Math.max(0, Math.min(100, sellPct));
    const baseRaw = position.amountRaw ?? BigInt(Math.max(0, Math.floor(position.amount)));
    const amountRaw = (baseRaw * BigInt(Math.round((position.remainingPercentage / 100) * (clamped / 100) * 1_000_000))) / 1_000_000n;
    const request = { inputMint: position.mint, outputMint, amount: amountRaw, slippageBps };
    const primary = await this.getQuote(request);
    if (primary.routeAvailable) return primary;

    // During a liquidity collapse, a normal multi-hop route can disappear before
    // a still-usable direct pool. Make one direct-route attempt before declaring
    // the asset unexecutable. This is deliberately not a blind transaction send.
    try {
      const direct = await this.getQuote({ ...request, onlyDirectRoutes: true });
      if (direct.routeAvailable) return direct;
    } catch {
      // Preserve the primary no-route result so the risk engine can escalate it.
    }
    return primary;
  }
}

export class SimulatedQuoteProvider implements QuoteProvider {
  constructor(private readonly slippageBps = 250) {}
  async getQuote(params: QuoteRequest): Promise<Quote> {
    const expectedOut = params.amount;
    return { provider: "simulated", inAmount: params.amount, expectedOutAmount: expectedOut, minimumOutAmount: minimumAfterSlippage(expectedOut, this.slippageBps), priceImpactBps: this.slippageBps, routeAvailable: expectedOut > 0n, routeInfo: { simulated: true }, timestamp: Date.now() };
  }
  async quoteForPosition(position: Position, outputMint: string, sellPct: number, slippageBps: number): Promise<Quote> {
    const clamped = Math.max(0, Math.min(100, sellPct));
    const baseRaw = position.amountRaw ?? BigInt(Math.max(0, Math.floor(position.amount)));
    const amountRaw = (baseRaw * BigInt(Math.round((position.remainingPercentage / 100) * (clamped / 100) * 1_000_000))) / 1_000_000n;
    const grossOut = Math.floor(Number(amountRaw) * position.currentPrice);
    return { provider: "simulated", inAmount: amountRaw, expectedOutAmount: BigInt(Math.max(0, grossOut)), minimumOutAmount: minimumAfterSlippage(BigInt(Math.max(0, grossOut)), slippageBps), priceImpactBps: this.slippageBps, routeAvailable: grossOut > 0, routeInfo: { simulated: true, outputMint }, timestamp: Date.now() };
  }
}
