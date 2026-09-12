import { LiquiditySnapshot, PriceTick } from "../types.js";

export interface MarketState {
  prices: PriceTick[];
  liquidity: LiquiditySnapshot[];
}
