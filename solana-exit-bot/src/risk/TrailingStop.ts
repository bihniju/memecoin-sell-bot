import { Position } from "../types.js";

export const isTrailingActive = (position: Position, activationPct: number): boolean => {
  const activationPrice = position.entryPrice * (1 + activationPct / 100);
  return position.highestPrice >= activationPrice;
};

export const trailingStopPrice = (position: Position, trailingStopPct: number): number => position.highestPrice * (1 - trailingStopPct / 100);

export const shouldTriggerTrailingStop = (position: Position, activationPct: number, trailingStopPct: number): boolean => {
  if (!isTrailingActive(position, activationPct)) return false;
  return position.currentPrice <= trailingStopPrice(position, trailingStopPct);
};
