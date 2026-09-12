import { EventEmitter } from "node:events";
export class MarketEventNormalizer extends EventEmitter {
    quoteProvider;
    priceMonitor;
    liquidityMonitor;
    debounceMs;
    subscriptions = new Map();
    inflight = new Set();
    constructor(quoteProvider, priceMonitor, liquidityMonitor, debounceMs) {
        super();
        this.quoteProvider = quoteProvider;
        this.priceMonitor = priceMonitor;
        this.liquidityMonitor = liquidityMonitor;
        this.debounceMs = debounceMs;
    }
    register(subscription) {
        this.subscriptions.set(subscription.mint, subscription);
    }
    unregister(mint) {
        this.subscriptions.delete(mint);
    }
    async handleMarketEvent(marketEventAt = Date.now()) {
        const tasks = [];
        for (const sub of this.subscriptions.values()) {
            if (this.inflight.has(sub.mint))
                continue;
            this.inflight.add(sub.mint);
            tasks.push(this.sampleMint(sub, marketEventAt).finally(() => {
                setTimeout(() => this.inflight.delete(sub.mint), this.debounceMs);
            }));
        }
        await Promise.allSettled(tasks);
    }
    async sampleMint(sub, marketEventAt) {
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
        });
    }
}
