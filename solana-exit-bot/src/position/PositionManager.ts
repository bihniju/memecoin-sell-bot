import { Position, SellState } from "../types.js";
import { finiteOr, pctChange, safeMultiply, safeSubtract } from "../utils/math.js";

export class PositionManager {
  private readonly positions = new Map<string, Position>();

  upsert(position: Position): void {
    this.positions.set(position.mint, position);
  }

  get(mint: string): Position | undefined {
    return this.positions.get(mint);
  }

  all(): Position[] {
    return [...this.positions.values()];
  }

  updatePrice(mint: string, price: number): Position | undefined {
    const p = this.positions.get(mint);
    if (!p || !Number.isFinite(price) || price < 0) return p;

    p.currentPrice = price;
    p.highestPrice = Math.max(p.highestPrice, price);
    p.lowestPrice = Math.min(p.lowestPrice, price);

    const remainingAmount = safeMultiply(p.amount, p.remainingPercentage / 100);
    const priceDelta = safeSubtract(price, p.entryPrice);
    p.unrealizedPnL = finiteOr(safeMultiply(priceDelta, remainingAmount));
    return p;
  }

  markTakeProfitCompleted(mint: string, levelId: string): void {
    const p = this.positions.get(mint);
    if (!p) return;
    p.completedTakeProfitLevels.add(levelId);
  }

  applyFill(mint: string, sellPct: number, outValue: number, signature?: string): Position | undefined {
    const p = this.positions.get(mint);
    if (!p || !Number.isFinite(outValue)) return p;

    // sellPct is the percentage of the position's CURRENT remaining balance to sell.
    // Invalid values are rejected instead of allowing NaN to corrupt position state.
    if (!Number.isFinite(sellPct)) return p;
    const clampedSellPct = Math.max(0, Math.min(100, sellPct));
    const soldFractionOfRemaining = clampedSellPct / 100;
    const remainingFraction = p.remainingPercentage / 100;
    const soldAmount = safeMultiply(
      safeMultiply(p.amount, remainingFraction),
      soldFractionOfRemaining
    );
    const soldEntryValue = safeMultiply(soldAmount, p.entryPrice);
    const fillPnL = safeSubtract(outValue, soldEntryValue);

    p.realizedPnL = finiteOr(safeSubtract(p.realizedPnL, -fillPnL));
    p.remainingPercentage = Math.max(
      0,
      Math.min(100, p.remainingPercentage * (1 - soldFractionOfRemaining))
    );
    p.sellSignature = signature ?? p.sellSignature;
    p.sellState = p.remainingPercentage <= 0 ? "SOLD" : "PARTIALLY_SOLD";
    p.lastSellAttempt = Date.now();
    return p;
  }

  tryTransition(mint: string, from: SellState[], to: SellState): boolean {
    const p = this.positions.get(mint);
    if (!p) return false;
    if (!from.includes(p.sellState)) return false;
    p.sellState = to;
    return true;
  }

  setSellState(mint: string, state: SellState): void {
    const p = this.positions.get(mint);
    if (!p) return;
    p.sellState = state;
  }

  pnlPct(mint: string): number {
    const p = this.positions.get(mint);
    if (!p) return 0;
    return pctChange(p.entryPrice, p.currentPrice);
  }
}
