import { Position } from "../types.js";

export const createPosition = (input: {
  mint: string;
  decimals: number;
  walletAddress: string;
  amount: number;
  entryPrice: number;
  entryTimestamp?: number;
}): Position => {
  const entryTimestamp = input.entryTimestamp ?? Date.now();
  const entryValue = input.entryPrice * input.amount;

  return {
    mint: input.mint,
    decimals: input.decimals,
    walletAddress: input.walletAddress,
    amount: input.amount,
    entryPrice: input.entryPrice,
    entryValue,
    entryTimestamp,
    currentPrice: input.entryPrice,
    highestPrice: input.entryPrice,
    lowestPrice: input.entryPrice,
    realizedPnL: 0,
    unrealizedPnL: 0,
    remainingPercentage: 100,
    sellState: "IDLE",
    completedTakeProfitLevels: new Set<string>()
  };
};
