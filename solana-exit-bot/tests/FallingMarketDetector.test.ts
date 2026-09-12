import { describe, expect, test } from "vitest";
import { FallingMarketDetector } from "../src/risk/FallingMarketDetector.js";
import { RiskConfig } from "../src/types.js";

const config: RiskConfig = {
  stopLossEnabled: true,
  stopLossPct: 5,
  earlyExitEnabled: true,
  earlyExitPct: 2,
  fallingMarketEnabled: true,
  fallingWindowMs: 3000,
  fallingDropPct: 1.5,
  consecutiveLowerTicks: 3,
  riskScoreWarning: 40,
  riskScoreHigh: 60,
  riskScoreEmergency: 80,
  fallingWeightPriceDrop: 40,
  fallingWeightLowerTicks: 20,
  fallingWeightAcceleration: 20,
  fallingWeightVolumeImbalance: 10,
  fallingWeightLiquidity: 10,
  trailingStopEnabled: true,
  trailingActivationPct: 20,
  trailingStopPct: 8,
  takeProfitEnabled: true,
  takeProfitLevels: [],
  maxPriceImpactBps: 1500,
  decisionCooldownMs: 500
};

describe("FallingMarketDetector", () => {
  test("detects consecutive lower ticks and high score", () => {
    const detector = new FallingMarketDetector(config);
    const signal = detector.evaluate(
      [
        { mint: "m", price: 1, timestamp: 1, volumeBuy: 5, volumeSell: 30 },
        { mint: "m", price: 0.985, timestamp: 2, volumeBuy: 4, volumeSell: 32 },
        { mint: "m", price: 0.965, timestamp: 3, volumeBuy: 3, volumeSell: 34 },
        { mint: "m", price: 0.94, timestamp: 4, volumeBuy: 2, volumeSell: 36 }
      ],
      [
        { mint: "m", liquidityUsd: 10000, timestamp: 1 },
        { mint: "m", liquidityUsd: 5000, timestamp: 2 }
      ]
    );

    expect(signal.consecutiveLowerTicks).toBeGreaterThanOrEqual(3);
    expect(signal.score).toBeGreaterThanOrEqual(60);
  });

  test("handles stale/insufficient market series", () => {
    const detector = new FallingMarketDetector(config);
    const signal = detector.evaluate([{ mint: "m", price: 1, timestamp: 1 }], []);
    expect(signal.score).toBe(0);
  });
});
