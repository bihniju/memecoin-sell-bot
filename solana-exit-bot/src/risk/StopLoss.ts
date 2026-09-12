import { Position } from "../types.js";

export const stopLossPrice = (position: Position, stopLossPct: number): number => position.entryPrice * (1 - stopLossPct / 100);

export const shouldTriggerStopLoss = (position: Position, stopLossPct: number): boolean => {
  const stop = stopLossPrice(position, stopLossPct);
  return position.currentPrice <= stop;
};
