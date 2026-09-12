import { Position, Quote } from "../types.js";

export interface QuoteProvider {
  getQuote(position: Position, sellPct: number): Promise<Quote>;
}

export class StaticQuoteProvider implements QuoteProvider {
  constructor(private readonly slippageBps = 250) {}

  async getQuote(position: Position, sellPct: number): Promise<Quote> {
    const inAmount = position.amount * (position.remainingPercentage / 100) * (sellPct / 100);
    const grossOut = inAmount * position.currentPrice;
    const outAmount = grossOut * (1 - this.slippageBps / 10000);
    return {
      inAmount,
      outAmount,
      priceImpactBps: this.slippageBps,
      routeAvailable: outAmount > 0,
      timestamp: Date.now()
    };
  }
}
