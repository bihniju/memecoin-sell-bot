import { EventEmitter } from "node:events";
import { QuoteProvider } from "../execution/QuoteProvider.js";
import { LiquidityMonitor } from "./LiquidityMonitor.js";
import { PriceMonitor } from "./PriceMonitor.js";

export interface NormalizerSubscription {
  mint: string;
  outputMint: string;
  sampleAmount: bigint;
  slippageBps: number;
}

interface LatencyEvent {
  mint: string;
  marketEventAt: number;
  quoteRequestedAt: number;
  quoteReceivedAt: number;
}

export class MarketEventNormalizer extends EventEmitter {
  private readonly subscriptions = new Map<string, NormalizerSubscription>();
  private readonly inflight = new Set<string>();

  constructor(
    private readonly quoteProvider: QuoteProvider,
    private readonly priceMonitor: PriceMonitor,
    private readonly liquidityMonitor: LiquidityMonitor,
    private readonly debounceMs: number
  ) {
    super();
  }

  register(subscription: NormalizerSubscription): void {
    this.subscriptions.set(subscription.mint, subscription);
  }

  unregister(mint: string): void {
    this.subscriptions.delete(mint);
  }

  async handleMarketEvent(marketEventAt = Date.now()): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const sub of this.subscriptions.values()) {
      if (this.inflight.has(sub.mint)) continue;
      this.inflight.add(sub.mint);
      tasks.push(this.sampleMint(sub, marketEventAt).finally(() => {
        setTimeout(() => this.inflight.delete(sub.mint), this.debounceMs);
      }));
    }
    await Promise.allSettled(tasks);
  }

  private async sampleMint(sub: NormalizerSubscription, marketEventAt: number): Promise<void> {
    const quoteRequestedAt = Date.now();
    const quote = await this.quoteProvider.getQuote({
      inputMint: sub.mint,
      outputMint: sub.outputMint,
      amount: sub.sampleAmount,
      slippageBps: sub.slippageBps
    });
    const quoteReceivedAt = Date.now();

    if (!quote.routeAvailable || quote.expectedOutAmount <= 0n || quote.inAmount <= 0n) {
      this.emit("quoteUnavailable", { mint: sub.mint, quote, marketEventAt, quoteRequestedAt, quoteReceivedAt });
      return;
    }

    const price = Number(quote.expectedOutAmount) / Number(quote.inAmount);
    this.priceMonitor.ingest({
      mint: sub.mint,
      price,
      timestamp: quoteReceivedAt
    });
    this.liquidityMonitor.ingest({
      mint: sub.mint,
      liquidityUsd: Number(quote.expectedOutAmount),
      timestamp: quoteReceivedAt
    });

    this.emit("latency", {
      mint: sub.mint,
      marketEventAt,
      quoteRequestedAt,
      quoteReceivedAt
    } satisfies LatencyEvent);
  }
}
