import { Position, TakeProfitLevel } from "../types.js";
import { pctChange } from "../utils/math.js";

export interface TakeProfitSignal {
  level: TakeProfitLevel;
  currentProfitPct: number;
}

export const nextTakeProfitTrigger = (position: Position, levels: TakeProfitLevel[]): TakeProfitSignal | undefined => {
  const currentProfitPct = pctChange(position.entryPrice, position.currentPrice);
  for (const level of levels) {
    if (position.completedTakeProfitLevels.has(level.id)) continue;
    if (currentProfitPct >= level.profitPct) {
      return { level, currentProfitPct };
    }
  }
  return undefined;
};
