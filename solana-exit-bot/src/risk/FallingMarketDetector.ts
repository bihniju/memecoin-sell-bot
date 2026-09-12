import { FallingSignal, LiquiditySnapshot, PriceTick, RiskConfig } from "../types.js";
import { clamp, pctChange } from "../utils/math.js";

export class FallingMarketDetector {
  constructor(private readonly config: RiskConfig) {}

  evaluate(prices: PriceTick[], liquidity: LiquiditySnapshot[]): FallingSignal {
    if (prices.length < 2) {
      return {
        score: 0,
        shortDropPct: 0,
        consecutiveLowerTicks: 0,
        acceleratingDecline: false,
        volumeImbalance: 0,
        liquidityDeterioration: 0
      };
    }

    const first = prices[0].price;
    const last = prices[prices.length - 1].price;
    const shortDropPct = Math.max(0, -pctChange(first, last));

    let consecutiveLowerTicks = 0;
    for (let i = prices.length - 1; i > 0; i -= 1) {
      if (prices[i].price < prices[i - 1].price) consecutiveLowerTicks += 1;
      else break;
    }

    const midpoint = Math.floor(prices.length / 2);
    const firstHalfDrop = Math.max(0, -pctChange(prices[0].price, prices[midpoint].price));
    const secondHalfDrop = Math.max(0, -pctChange(prices[midpoint].price, last));
    const acceleratingDecline = secondHalfDrop > firstHalfDrop && secondHalfDrop > 0;

    const buyVolume = prices.reduce((acc, p) => acc + (p.volumeBuy ?? 0), 0);
    const sellVolume = prices.reduce((acc, p) => acc + (p.volumeSell ?? 0), 0);
    const volumeImbalance = sellVolume + buyVolume === 0 ? 0 : clamp((sellVolume - buyVolume) / (sellVolume + buyVolume), 0, 1);

    let liquidityDeterioration = 0;
    if (liquidity.length > 1) {
      const liqStart = liquidity[0].liquidityUsd;
      const liqEnd = liquidity[liquidity.length - 1].liquidityUsd;
      liquidityDeterioration = clamp(Math.max(0, -pctChange(liqStart, liqEnd)) / 100, 0, 1);
    }

    let score = 0;
    if (shortDropPct >= this.config.fallingDropPct) score += this.config.fallingWeightPriceDrop;
    if (consecutiveLowerTicks >= this.config.consecutiveLowerTicks) score += this.config.fallingWeightLowerTicks;
    if (acceleratingDecline) score += this.config.fallingWeightAcceleration;
    score += this.config.fallingWeightVolumeImbalance * volumeImbalance;
    score += this.config.fallingWeightLiquidity * liquidityDeterioration;

    return {
      score: Math.round(clamp(score, 0, 100)),
      shortDropPct,
      consecutiveLowerTicks,
      acceleratingDecline,
      volumeImbalance,
      liquidityDeterioration
    };
  }
}
