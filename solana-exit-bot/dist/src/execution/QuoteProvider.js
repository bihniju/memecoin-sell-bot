export class StaticQuoteProvider {
    slippageBps;
    constructor(slippageBps = 250) {
        this.slippageBps = slippageBps;
    }
    async getQuote(position, sellPct) {
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
