import { pctChange } from "../utils/math.js";
export const nextTakeProfitTrigger = (position, levels) => {
    const currentProfitPct = pctChange(position.entryPrice, position.currentPrice);
    for (const level of levels) {
        if (position.completedTakeProfitLevels.has(level.id))
            continue;
        if (currentProfitPct >= level.profitPct) {
            return { level, currentProfitPct };
        }
    }
    return undefined;
};
