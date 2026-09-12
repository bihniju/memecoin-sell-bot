import { Position, SellState } from "../types.js";
import { pctChange } from "../utils/math.js";

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
    if (!p) return;
    p.currentPrice = price;
    p.highestPrice = Math.max(p.highestPrice, price);
    p.lowestPrice = Math.min(p.lowestPrice, price);
    p.unrealizedPnL = (price - p.entryPrice) * (p.amount * (p.remainingPercentage / 100));
    return p;
  }

  markTakeProfitCompleted(mint: string, levelId: string): void {
    const p = this.positions.get(mint);
    if (!p) return;
    p.completedTakeProfitLevels.add(levelId);
  }

  applyFill(mint: string, sellPct: number, outValue: number, signature?: string): Position | undefined {
    const p = this.positions.get(mint);
    if (!p) return;

    // sellPct is the percentage of the position's CURRENT remaining balance to sell.
    // Keep this consistent with quoteForPosition(), which also derives the amount
    // from remainingPercentage * sellPct. This prevents a second 50% exit from
    // incorrectly marking the entire original position as sold.
    const clampedSellPct = Math.max(0, Math.min(100, sellPct));
    const soldFractionOfRemaining = clampedSellPct / 100;
    const remainingFraction = p.remainingPercentage / 100;
    const soldAmount = p.amount * remainingFraction * soldFractionOfRemaining;
    const soldEntryValue = soldAmount * p.entryPrice;

    p.realizedPnL += outValue - soldEntryValue;
    p.remainingPercentage = Math.max(
      0,
      p.remainingPercentage * (1 - soldFractionOfRemaining)
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
