import { pctChange } from "../utils/math.js";
export class PositionManager {
    positions = new Map();
    upsert(position) {
        this.positions.set(position.mint, position);
    }
    get(mint) {
        return this.positions.get(mint);
    }
    all() {
        return [...this.positions.values()];
    }
    updatePrice(mint, price) {
        const p = this.positions.get(mint);
        if (!p)
            return;
        p.currentPrice = price;
        p.highestPrice = Math.max(p.highestPrice, price);
        p.lowestPrice = Math.min(p.lowestPrice, price);
        p.unrealizedPnL = (price - p.entryPrice) * (p.amount * (p.remainingPercentage / 100));
        return p;
    }
    markTakeProfitCompleted(mint, levelId) {
        const p = this.positions.get(mint);
        if (!p)
            return;
        p.completedTakeProfitLevels.add(levelId);
    }
    applyFill(mint, sellPct, outValue, signature) {
        const p = this.positions.get(mint);
        if (!p)
            return;
        const clampedSellPct = Math.max(0, Math.min(100, sellPct));
        const soldFraction = clampedSellPct / 100;
        const soldAmount = p.amount * (p.remainingPercentage / 100) * soldFraction;
        const soldEntryValue = soldAmount * p.entryPrice;
        p.realizedPnL += outValue - soldEntryValue;
        p.remainingPercentage = Math.max(0, p.remainingPercentage - clampedSellPct);
        p.sellSignature = signature ?? p.sellSignature;
        p.sellState = p.remainingPercentage <= 0 ? "SOLD" : "PARTIALLY_SOLD";
        p.lastSellAttempt = Date.now();
        return p;
    }
    setSellState(mint, state) {
        const p = this.positions.get(mint);
        if (!p)
            return;
        p.sellState = state;
    }
    pnlPct(mint) {
        const p = this.positions.get(mint);
        if (!p)
            return 0;
        return pctChange(p.entryPrice, p.currentPrice);
    }
}
